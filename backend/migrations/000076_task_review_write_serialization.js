/**
 * Migration 000076: Task Review Write Serialization
 *
 * Implements service-only transactional database RPCs for task creation and material updates
 * per TASK-WRITE-SERIALIZATION.md, TASK-DB-PARCEL.md, and CONTRACT.md (Policy R3, R7, R8):
 *
 * 1. public.task_creation_review_create:
 *    - Signature: task_creation_review_create(p_work_request_id uuid, p_entity_id uuid, p_actor_id uuid, p_data jsonb, p_assignees uuid[] DEFAULT NULL) RETURNS SETOF public.tasks
 *    - Service-only: REVOKE from PUBLIC/anon/authenticated, GRANT EXECUTE to service_role.
 *    - Parent-before-task lock order: SELECT * FROM public.work_requests WHERE id = p_work_request_id FOR UPDATE
 *    - Validates admitted (approved) and writable (not archived, Cancelled, Completed) parent WR under lock.
 *    - Validates active actor, entity entitlement, and current normal WR membership (Admin allowed entitled; global Manager alone not membership).
 *    - Role policy: Employee creation requires active entitled Manager lead on WR, derives pending, sets immutable creator/assigner from actor. Admin/Manager creates approved.
 *    - Whitelist validation: rejects unknown and privileged fields (approval_status, created_by, reviewed_by, reviewed_at, rejection_reason, version, work_request_id, deleted_at).
 *    - Validates predecessor tasks belong to same WR and prevents self-dependencies.
 *    - Validates assignees (active, entity-entitled) and synchronizes public.task_assignees atomically in same SQL transaction.
 *
 * 2. public.task_material_update:
 *    - Signature: task_material_update(p_task_id uuid, p_work_request_id uuid, p_entity_id uuid, p_actor_id uuid, p_expected_version integer, p_data jsonb DEFAULT '{}'::jsonb, p_assignees uuid[] DEFAULT NULL) RETURNS SETOF public.tasks
 *    - Service-only: REVOKE from PUBLIC/anon/authenticated, GRANT EXECUTE to service_role.
 *    - Parent-before-task lock order: locks work_requests, then locks tasks row FOR UPDATE.
 *    - Validates admitted/writable parent, active actor, entity entitlement, and current WR membership under lock.
 *    - Validates exact task-WR-entity linkage and OCC version match.
 *    - Denies ordinary edits to rejected tasks (requires task_creation_review_resubmit).
 *    - Rejects privileged and execution fields (approval_status, created_by, reviewed_by, reviewed_at, rejection_reason, version, work_request_id, deleted_at, status, phase, qa_status).
 *    - Supports routine display_order changes without resetting approval status.
 *    - Material patch (title, description, due_date, required_link_type, predecessors, assignees) applied atomically.
 *    - Employee material changes reset approval_status to 'pending', clear review fields, increment version once, and append immutable event ('material_update') to task_creation_review_events.
 *    - Admin/Manager material changes preserve approval status and increment version without resetting to pending.
 *
 * 3. Extend task_creation_review_events constraint:
 *    - Adds 'material_update' and 'material_reset' to event_type check constraint.
 *
 * @type {import('node-pg-migrate').Migration}
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Extend task_creation_review_events event_type CHECK constraint to support material_update and material_reset
    ALTER TABLE public.task_creation_review_events
      DROP CONSTRAINT IF EXISTS task_creation_review_events_event_type_check,
      ADD CONSTRAINT task_creation_review_events_event_type_check
      CHECK (event_type IN ('decision', 'resubmission', 'material_update', 'material_reset'));

    -- 2. Procedure: public.task_creation_review_create
    CREATE OR REPLACE FUNCTION public.task_creation_review_create(
      p_work_request_id uuid,
      p_entity_id uuid,
      p_actor_id uuid,
      p_data jsonb,
      p_assignees uuid[] DEFAULT NULL
    )
    RETURNS SETOF public.tasks
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_wr public.work_requests%ROWTYPE;
      v_actor public.users%ROWTYPE;
      v_lead public.users%ROWTYPE;
      v_entity_code text;
      v_approval_status varchar(30);

      v_task_id uuid;
      v_title text;
      v_description text;
      v_status varchar(50);
      v_phase text;
      v_due_date timestamptz;
      v_required_link_type varchar(50);
      v_display_order integer;
      v_qa_status text;
      v_predecessors uuid[];
      v_assignees uuid[];

      v_assignee_id uuid;
      v_assignee_name varchar(255);
      v_assignee_user public.users%ROWTYPE;
      v_uid uuid;
      v_pred_id uuid;
      v_key text;
      v_task public.tasks%ROWTYPE;
    BEGIN
      -- Validate required identifiers
      IF p_work_request_id IS NULL OR p_entity_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Missing required parameters' USING ERRCODE = '22023';
      END IF;

      IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: p_data must be a jsonb object' USING ERRCODE = '22023';
      END IF;

      -- Parent-before-task lock order: lock work request first
      SELECT * INTO v_wr
      FROM public.work_requests
      WHERE id = p_work_request_id
      FOR UPDATE;

      IF NOT FOUND OR v_wr.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'WORK_REQUEST_NOT_FOUND' USING ERRCODE = 'P0002';
      END IF;

      IF v_wr.entity_id <> p_entity_id THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Work request entity mismatch' USING ERRCODE = '42501';
      END IF;

      -- Admitted parent check: WR must be approved
      IF COALESCE(v_wr.creation_approval_status, 'approved') <> 'approved' THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Work request is not admitted' USING ERRCODE = 'P0002';
      END IF;

      -- Writable parent check: cannot be archived, Cancelled, or Completed
      IF v_wr.archived IS TRUE OR v_wr.status IN ('Cancelled', 'Completed') THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Work request is archived, cancelled, or completed' USING ERRCODE = 'P0002';
      END IF;

      -- Verify actor
      SELECT * INTO v_actor
      FROM public.users
      WHERE id = p_actor_id;

      IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Inactive or invalid actor' USING ERRCODE = '42501';
      END IF;

      -- Entity entitlement check
      SELECT upper(trim(code)) INTO v_entity_code
      FROM public.entities
      WHERE id = p_entity_id;

      IF NOT FOUND OR v_entity_code IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Entity not found' USING ERRCODE = 'P0002';
      END IF;

      IF NOT (
        (v_actor.role = 'Admin' AND (v_actor.entities IS NULL OR cardinality(v_actor.entities) = 0))
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(v_actor.entities, ARRAY[]::text[])) ue
          WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
        )
      ) THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Actor not entitled to entity' USING ERRCODE = '42501';
      END IF;

      -- Current normal WR membership under lock (Admin allowed entitled; global Manager alone not membership)
      IF v_actor.role <> 'Admin' THEN
        DECLARE
          v_has_membership boolean := false;
        BEGIN
          IF v_wr.assigned_to = p_actor_id THEN
            v_has_membership := true;
          ELSIF v_wr.co_assignees IS NOT NULL AND (
            v_wr.co_assignees @> to_jsonb(p_actor_id::text)
            OR jsonb_path_exists(v_wr.co_assignees, '$[*] ? (@ == $actor)', jsonb_build_object('actor', p_actor_id::text))
          ) THEN
            v_has_membership := true;
          ELSIF EXISTS (
            SELECT 1 FROM public.tasks
            WHERE work_request_id = v_wr.id
              AND deleted_at IS NULL
              AND assignee_id = p_actor_id
          ) THEN
            v_has_membership := true;
          ELSIF to_regclass('public.task_assignees') IS NOT NULL THEN
            EXECUTE 'SELECT EXISTS (
              SELECT 1 FROM public.tasks t
              JOIN public.task_assignees ta ON ta.task_id = t.id
              WHERE t.work_request_id = $1
                AND t.deleted_at IS NULL
                AND ta.user_id = $2
            )' INTO v_has_membership USING v_wr.id, p_actor_id;
          END IF;

          IF NOT v_has_membership THEN
            RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Actor is not a member of this work request' USING ERRCODE = '42501';
          END IF;
        END;
      END IF;

      -- Role-based creation policy: Employee requires active entitled Manager lead, derives pending. Admin/Manager creates approved.
      IF v_actor.role NOT IN ('Admin', 'Manager') THEN
        IF v_wr.assigned_to IS NULL THEN
          RAISE EXCEPTION 'TASK_REVIEW_REQUIRED: Work request has no assigned Manager lead' USING ERRCODE = '42501';
        END IF;

        SELECT * INTO v_lead
        FROM public.users
        WHERE id = v_wr.assigned_to;

        IF NOT FOUND OR v_lead.is_active IS NOT TRUE OR v_lead.role <> 'Manager' THEN
          RAISE EXCEPTION 'TASK_REVIEW_REQUIRED: Assigned lead is not an active Manager lead' USING ERRCODE = '42501';
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(v_lead.entities, ARRAY[]::text[])) ue
          WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
        ) THEN
          RAISE EXCEPTION 'TASK_REVIEW_REQUIRED: Assigned lead is not entitled to work request entity' USING ERRCODE = '42501';
        END IF;

        v_approval_status := 'pending';
      ELSE
        v_approval_status := 'approved';
      END IF;

      -- Whitelist validation of p_data keys & Reject unknown/privileged fields
      FOR v_key IN SELECT jsonb_object_keys(p_data)
      LOOP
        IF v_key IN ('approval_status', 'created_by', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'version', 'work_request_id', 'deleted_at') THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Unsupported or privileged field %', v_key USING ERRCODE = '22023';
        END IF;

        IF v_key NOT IN (
          'id', 'title', 'description', 'status', 'phase', 'due_date', 'dueDate',
          'required_link_type', 'requiredLinkType', 'display_order', 'displayOrder',
          'qa_status', 'qaStatus', 'predecessors', 'assignee_id', 'assigneeId', 'assignees'
        ) THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Unsupported field %', v_key USING ERRCODE = '22023';
        END IF;
      END LOOP;

      -- Extract and validate fields
      IF p_data ? 'id' AND p_data->>'id' IS NOT NULL THEN
        v_task_id := (p_data->>'id')::uuid;
      ELSE
        v_task_id := gen_random_uuid();
      END IF;

      IF NOT (p_data ? 'title') OR trim(COALESCE(p_data->>'title', '')) = '' THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: title is required' USING ERRCODE = '22023';
      END IF;
      v_title := trim(p_data->>'title');

      v_description := NULLIF(trim(COALESCE(p_data->>'description', '')), '');

      IF p_data ? 'status' AND p_data->>'status' IS NOT NULL THEN
        v_status := trim(p_data->>'status');
        IF v_status NOT IN ('Draft', 'Assigned', 'In Progress', 'For Review', 'Completed', 'Cancelled') THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Invalid status %', v_status USING ERRCODE = '22023';
        END IF;
      ELSE
        v_status := 'Draft';
      END IF;

      IF p_data ? 'phase' AND p_data->>'phase' IS NOT NULL THEN
        v_phase := trim(p_data->>'phase');
        IF v_phase NOT IN ('pre_processing', 'processing') THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Invalid phase %', v_phase USING ERRCODE = '22023';
        END IF;
      ELSE
        v_phase := COALESCE(v_wr.phase, 'pre_processing');
      END IF;

      IF p_data ? 'due_date' OR p_data ? 'dueDate' THEN
        DECLARE
          v_raw_due text := COALESCE(p_data->>'due_date', p_data->>'dueDate');
        BEGIN
          IF v_raw_due IS NOT NULL AND trim(v_raw_due) <> '' THEN
            v_due_date := v_raw_due::timestamptz;
          ELSE
            v_due_date := NULL;
          END IF;
        END;
      ELSE
        v_due_date := NULL;
      END IF;

      IF p_data ? 'required_link_type' OR p_data ? 'requiredLinkType' THEN
        v_required_link_type := NULLIF(trim(COALESCE(p_data->>'required_link_type', p_data->>'requiredLinkType', '')), '');
      ELSE
        v_required_link_type := NULL;
      END IF;

      IF p_data ? 'display_order' OR p_data ? 'displayOrder' THEN
        v_display_order := COALESCE((COALESCE(p_data->>'display_order', p_data->>'displayOrder'))::integer, 0);
      ELSE
        v_display_order := 0;
      END IF;

      IF p_data ? 'qa_status' OR p_data ? 'qaStatus' THEN
        v_qa_status := trim(COALESCE(p_data->>'qa_status', p_data->>'qaStatus'));
        IF v_qa_status NOT IN ('none', 'passed', 'failed') THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Invalid qa_status %', v_qa_status USING ERRCODE = '22023';
        END IF;
      ELSE
        v_qa_status := 'none';
      END IF;

      -- Predecessor dependencies validation
      IF p_data ? 'predecessors' AND p_data->'predecessors' IS NOT NULL THEN
        IF jsonb_typeof(p_data->'predecessors') <> 'array' THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: predecessors must be an array' USING ERRCODE = '22023';
        END IF;

        v_predecessors := ARRAY[]::uuid[];
        FOR v_pred_id IN SELECT (jsonb_array_elements_text(p_data->'predecessors'))::uuid
        LOOP
          IF v_pred_id = v_task_id THEN
            RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Task cannot depend on itself' USING ERRCODE = '22023';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM public.tasks
            WHERE id = v_pred_id
              AND work_request_id = p_work_request_id
              AND deleted_at IS NULL
          ) THEN
            RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Predecessor task % does not belong to work request', v_pred_id USING ERRCODE = 'P0002';
          END IF;

          v_predecessors := array_append(v_predecessors, v_pred_id);
        END LOOP;
      ELSE
        v_predecessors := ARRAY[]::uuid[];
      END IF;

      -- Assignees resolution and validation
      IF p_assignees IS NOT NULL THEN
        v_assignees := p_assignees;
      ELSIF p_data ? 'assignees' AND p_data->'assignees' IS NOT NULL THEN
        IF jsonb_typeof(p_data->'assignees') <> 'array' THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: assignees must be an array' USING ERRCODE = '22023';
        END IF;
        v_assignees := ARRAY[]::uuid[];
        FOR v_uid IN SELECT (jsonb_array_elements_text(p_data->'assignees'))::uuid
        LOOP
          v_assignees := array_append(v_assignees, v_uid);
        END LOOP;
      ELSIF (p_data ? 'assignee_id' OR p_data ? 'assigneeId') AND NULLIF(trim(COALESCE(p_data->>'assignee_id', p_data->>'assigneeId', '')), '') IS NOT NULL THEN
        v_assignees := ARRAY[(COALESCE(p_data->>'assignee_id', p_data->>'assigneeId'))::uuid];
      ELSE
        v_assignees := ARRAY[]::uuid[];
      END IF;

      -- Validate each assignee: active and entitled to entity
      FOREACH v_uid IN ARRAY v_assignees
      LOOP
        SELECT * INTO v_assignee_user FROM public.users WHERE id = v_uid;
        IF NOT FOUND OR v_assignee_user.is_active IS NOT TRUE THEN
          RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Assignee % is inactive or invalid', v_uid USING ERRCODE = '42501';
        END IF;

        IF NOT (
          (v_assignee_user.role = 'Admin' AND (v_assignee_user.entities IS NULL OR cardinality(v_assignee_user.entities) = 0))
          OR EXISTS (
            SELECT 1 FROM unnest(COALESCE(v_assignee_user.entities, ARRAY[]::text[])) ue
            WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
          )
        ) THEN
          RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Assignee % not entitled to entity', v_uid USING ERRCODE = '42501';
        END IF;
      END LOOP;

      -- Determine primary assignee
      IF (p_data ? 'assignee_id' OR p_data ? 'assigneeId') AND NULLIF(trim(COALESCE(p_data->>'assignee_id', p_data->>'assigneeId', '')), '') IS NOT NULL THEN
        v_assignee_id := (COALESCE(p_data->>'assignee_id', p_data->>'assigneeId'))::uuid;
      ELSIF cardinality(v_assignees) > 0 THEN
        v_assignee_id := v_assignees[1];
      ELSE
        v_assignee_id := NULL;
      END IF;

      IF v_assignee_id IS NOT NULL THEN
        SELECT name INTO v_assignee_name FROM public.users WHERE id = v_assignee_id;
      ELSE
        v_assignee_name := NULL;
      END IF;

      -- Insert task row with explicit columns and defaults
      INSERT INTO public.tasks (
        id,
        work_request_id,
        title,
        description,
        status,
        assignee_id,
        assignee_name,
        predecessors,
        due_date,
        display_order,
        created_at,
        updated_at,
        version,
        required_link_type,
        phase,
        qa_status,
        assigned_by,
        assigned_at,
        approval_status,
        created_by,
        reviewed_by,
        reviewed_at,
        rejection_reason
      ) VALUES (
        v_task_id,
        p_work_request_id,
        v_title,
        v_description,
        v_status,
        v_assignee_id,
        v_assignee_name,
        v_predecessors,
        v_due_date,
        v_display_order,
        clock_timestamp(),
        clock_timestamp(),
        1,
        v_required_link_type,
        v_phase,
        v_qa_status,
        p_actor_id,
        CASE WHEN v_assignee_id IS NOT NULL THEN clock_timestamp() ELSE NULL END,
        v_approval_status,
        p_actor_id,
        NULL,
        NULL,
        NULL
      ) RETURNING * INTO v_task;

      -- Synchronize task_assignees in same SQL transaction
      IF to_regclass('public.task_assignees') IS NOT NULL THEN
        DELETE FROM public.task_assignees WHERE task_id = v_task_id;
        FOREACH v_uid IN ARRAY v_assignees
        LOOP
          INSERT INTO public.task_assignees (task_id, user_id, assigned_by, assigned_at)
          VALUES (v_task_id, v_uid, p_actor_id, clock_timestamp());
        END LOOP;
      END IF;

      RETURN NEXT v_task;
      RETURN;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.task_creation_review_create(uuid, uuid, uuid, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.task_creation_review_create(uuid, uuid, uuid, jsonb, uuid[]) TO service_role;

    -- 3. Procedure: public.task_material_update
    CREATE OR REPLACE FUNCTION public.task_material_update(
      p_task_id uuid,
      p_work_request_id uuid,
      p_entity_id uuid,
      p_actor_id uuid,
      p_expected_version integer,
      p_data jsonb DEFAULT '{}'::jsonb,
      p_assignees uuid[] DEFAULT NULL
    )
    RETURNS SETOF public.tasks
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_wr public.work_requests%ROWTYPE;
      v_task public.tasks%ROWTYPE;
      v_actor public.users%ROWTYPE;
      v_entity_code text;
      v_key text;
      v_patch jsonb;

      v_title text;
      v_description text;
      v_due_date timestamptz;
      v_required_link_type varchar(50);
      v_display_order integer;
      v_assignee_id uuid;
      v_assignee_name varchar(255);
      v_predecessors uuid[];
      v_assignees uuid[];

      v_assignee_user public.users%ROWTYPE;
      v_uid uuid;
      v_pred_id uuid;

      v_new_approval_status varchar(30);
      v_reviewed_by uuid;
      v_reviewed_at timestamptz;
      v_rejection_reason text;
      v_is_material_change boolean := false;
    BEGIN
      -- Validate required identifiers
      IF p_task_id IS NULL OR p_work_request_id IS NULL OR p_entity_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Missing required parameters' USING ERRCODE = '22023';
      END IF;

      -- Explicitly reject missing or non-positive expectedVersion
      IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: expectedVersion is required and must be a positive integer' USING ERRCODE = 'P0001';
      END IF;

      v_patch := COALESCE(p_data, '{}'::jsonb);
      IF jsonb_typeof(v_patch) <> 'object' THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: p_data must be a jsonb object' USING ERRCODE = '22023';
      END IF;

      -- Parent-before-task lock order: lock work request first
      SELECT * INTO v_wr
      FROM public.work_requests
      WHERE id = p_work_request_id
      FOR UPDATE;

      IF NOT FOUND OR v_wr.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'WORK_REQUEST_NOT_FOUND' USING ERRCODE = 'P0002';
      END IF;

      IF v_wr.entity_id <> p_entity_id THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Work request entity mismatch' USING ERRCODE = '42501';
      END IF;

      -- Admitted parent check: WR must be approved
      IF COALESCE(v_wr.creation_approval_status, 'approved') <> 'approved' THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Work request is not admitted' USING ERRCODE = 'P0002';
      END IF;

      -- Writable parent check: cannot be archived, Cancelled, or Completed
      IF v_wr.archived IS TRUE OR v_wr.status IN ('Cancelled', 'Completed') THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Work request is archived, cancelled, or completed' USING ERRCODE = 'P0002';
      END IF;

      -- Verify actor
      SELECT * INTO v_actor
      FROM public.users
      WHERE id = p_actor_id;

      IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Inactive or invalid actor' USING ERRCODE = '42501';
      END IF;

      -- Entity entitlement check
      SELECT upper(trim(code)) INTO v_entity_code
      FROM public.entities
      WHERE id = p_entity_id;

      IF NOT FOUND OR v_entity_code IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Entity not found' USING ERRCODE = 'P0002';
      END IF;

      IF NOT (
        (v_actor.role = 'Admin' AND (v_actor.entities IS NULL OR cardinality(v_actor.entities) = 0))
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(v_actor.entities, ARRAY[]::text[])) ue
          WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
        )
      ) THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Actor not entitled to entity' USING ERRCODE = '42501';
      END IF;

      -- Current normal WR membership under lock (Admin allowed entitled; global Manager alone not membership)
      IF v_actor.role <> 'Admin' THEN
        DECLARE
          v_has_membership boolean := false;
        BEGIN
          IF v_wr.assigned_to = p_actor_id THEN
            v_has_membership := true;
          ELSIF v_wr.co_assignees IS NOT NULL AND (
            v_wr.co_assignees @> to_jsonb(p_actor_id::text)
            OR jsonb_path_exists(v_wr.co_assignees, '$[*] ? (@ == $actor)', jsonb_build_object('actor', p_actor_id::text))
          ) THEN
            v_has_membership := true;
          ELSIF EXISTS (
            SELECT 1 FROM public.tasks
            WHERE work_request_id = v_wr.id
              AND deleted_at IS NULL
              AND assignee_id = p_actor_id
          ) THEN
            v_has_membership := true;
          ELSIF to_regclass('public.task_assignees') IS NOT NULL THEN
            EXECUTE 'SELECT EXISTS (
              SELECT 1 FROM public.tasks t
              JOIN public.task_assignees ta ON ta.task_id = t.id
              WHERE t.work_request_id = $1
                AND t.deleted_at IS NULL
                AND ta.user_id = $2
            )' INTO v_has_membership USING v_wr.id, p_actor_id;
          END IF;

          IF NOT v_has_membership THEN
            RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Actor is not a member of this work request' USING ERRCODE = '42501';
          END IF;
        END;
      END IF;

      -- Lock task (parent-before-task lock order)
      SELECT * INTO v_task
      FROM public.tasks
      WHERE id = p_task_id
      FOR UPDATE;

      IF NOT FOUND OR v_task.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Task not found' USING ERRCODE = 'P0002';
      END IF;

      IF v_task.work_request_id <> p_work_request_id THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Task does not belong to work request' USING ERRCODE = 'P0002';
      END IF;

      -- OCC version check
      IF v_task.version <> p_expected_version THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Task version mismatch' USING ERRCODE = 'P0001';
      END IF;

      -- Ordinary edits to rejected tasks are denied (Policy R6, must use task_creation_review_resubmit)
      IF v_task.approval_status = 'rejected' THEN
        RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Cannot modify rejected task without resubmission' USING ERRCODE = 'P0002';
      END IF;

      -- Whitelist validation of p_data keys & Reject unknown/privileged fields
      FOR v_key IN SELECT jsonb_object_keys(v_patch)
      LOOP
        IF v_key IN ('approval_status', 'created_by', 'reviewed_by', 'reviewed_at', 'rejection_reason', 'version', 'work_request_id', 'deleted_at', 'status', 'phase', 'qa_status', 'qaStatus') THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Cannot supply privileged or routine execution field %', v_key USING ERRCODE = '22023';
        END IF;

        IF v_key NOT IN (
          'title', 'description', 'due_date', 'dueDate',
          'required_link_type', 'requiredLinkType', 'display_order', 'displayOrder',
          'predecessors', 'assignee_id', 'assigneeId', 'assignees'
        ) THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Unsupported field %', v_key USING ERRCODE = '22023';
        END IF;
      END LOOP;

      -- Apply patch values or preserve current
      v_title := v_task.title;
      IF v_patch ? 'title' THEN
        IF trim(COALESCE(v_patch->>'title', '')) = '' THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: title cannot be blank' USING ERRCODE = '22023';
        END IF;
        v_title := trim(v_patch->>'title');
        v_is_material_change := true;
      END IF;

      v_description := v_task.description;
      IF v_patch ? 'description' THEN
        v_description := NULLIF(trim(COALESCE(v_patch->>'description', '')), '');
        v_is_material_change := true;
      END IF;

      v_due_date := v_task.due_date;
      IF v_patch ? 'due_date' OR v_patch ? 'dueDate' THEN
        DECLARE
          v_raw_due text := COALESCE(v_patch->>'due_date', v_patch->>'dueDate');
        BEGIN
          IF v_raw_due IS NOT NULL AND trim(v_raw_due) <> '' THEN
            v_due_date := v_raw_due::timestamptz;
          ELSE
            v_due_date := NULL;
          END IF;
          v_is_material_change := true;
        END;
      END IF;

      v_required_link_type := v_task.required_link_type;
      IF v_patch ? 'required_link_type' OR v_patch ? 'requiredLinkType' THEN
        v_required_link_type := NULLIF(trim(COALESCE(v_patch->>'required_link_type', v_patch->>'requiredLinkType', '')), '');
        v_is_material_change := true;
      END IF;

      v_display_order := v_task.display_order;
      IF v_patch ? 'display_order' OR v_patch ? 'displayOrder' THEN
        v_display_order := COALESCE((COALESCE(v_patch->>'display_order', v_patch->>'displayOrder'))::integer, 0);
      END IF;

      -- Predecessors
      v_predecessors := v_task.predecessors;
      IF v_patch ? 'predecessors' THEN
        IF v_patch->'predecessors' IS NOT NULL THEN
          IF jsonb_typeof(v_patch->'predecessors') <> 'array' THEN
            RAISE EXCEPTION 'TASK_REVIEW_STATE: predecessors must be an array' USING ERRCODE = '22023';
          END IF;

          v_predecessors := ARRAY[]::uuid[];
          FOR v_pred_id IN SELECT (jsonb_array_elements_text(v_patch->'predecessors'))::uuid
          LOOP
            IF v_pred_id = v_task.id THEN
              RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Task cannot depend on itself' USING ERRCODE = '22023';
            END IF;

            IF NOT EXISTS (
              SELECT 1 FROM public.tasks
              WHERE id = v_pred_id
                AND work_request_id = p_work_request_id
                AND deleted_at IS NULL
            ) THEN
              RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Predecessor task % does not belong to work request', v_pred_id USING ERRCODE = 'P0002';
            END IF;

            v_predecessors := array_append(v_predecessors, v_pred_id);
          END LOOP;
        ELSE
          v_predecessors := ARRAY[]::uuid[];
        END IF;
        v_is_material_change := true;
      END IF;

      -- Assignees handling
      v_assignee_id := v_task.assignee_id;
      v_assignee_name := v_task.assignee_name;

      IF p_assignees IS NOT NULL THEN
        v_assignees := p_assignees;
        v_is_material_change := true;
      ELSIF v_patch ? 'assignees' AND v_patch->'assignees' IS NOT NULL THEN
        IF jsonb_typeof(v_patch->'assignees') <> 'array' THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: assignees must be an array' USING ERRCODE = '22023';
        END IF;
        v_assignees := ARRAY[]::uuid[];
        FOR v_uid IN SELECT (jsonb_array_elements_text(v_patch->'assignees'))::uuid
        LOOP
          v_assignees := array_append(v_assignees, v_uid);
        END LOOP;
        v_is_material_change := true;
      ELSIF (v_patch ? 'assignee_id' OR v_patch ? 'assigneeId') THEN
        IF NULLIF(trim(COALESCE(v_patch->>'assignee_id', v_patch->>'assigneeId', '')), '') IS NOT NULL THEN
          v_assignees := ARRAY[(COALESCE(v_patch->>'assignee_id', v_patch->>'assigneeId'))::uuid];
        ELSE
          v_assignees := ARRAY[]::uuid[];
        END IF;
        v_is_material_change := true;
      ELSE
        v_assignees := NULL; -- not changing assignees
      END IF;

      IF v_assignees IS NOT NULL THEN
        -- Validate each assignee
        FOREACH v_uid IN ARRAY v_assignees
        LOOP
          SELECT * INTO v_assignee_user FROM public.users WHERE id = v_uid;
          IF NOT FOUND OR v_assignee_user.is_active IS NOT TRUE THEN
            RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Assignee % is inactive or invalid', v_uid USING ERRCODE = '42501';
          END IF;

          IF NOT (
            (v_assignee_user.role = 'Admin' AND (v_assignee_user.entities IS NULL OR cardinality(v_assignee_user.entities) = 0))
            OR EXISTS (
              SELECT 1 FROM unnest(COALESCE(v_assignee_user.entities, ARRAY[]::text[])) ue
              WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
            )
          ) THEN
            RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Assignee % not entitled to entity', v_uid USING ERRCODE = '42501';
          END IF;
        END LOOP;

        -- Update primary assignee
        IF (v_patch ? 'assignee_id' OR v_patch ? 'assigneeId') AND NULLIF(trim(COALESCE(v_patch->>'assignee_id', v_patch->>'assigneeId', '')), '') IS NOT NULL THEN
          v_assignee_id := (COALESCE(v_patch->>'assignee_id', v_patch->>'assigneeId'))::uuid;
        ELSIF cardinality(v_assignees) > 0 THEN
          v_assignee_id := v_assignees[1];
        ELSE
          v_assignee_id := NULL;
        END IF;

        IF v_assignee_id IS NOT NULL THEN
          SELECT name INTO v_assignee_name FROM public.users WHERE id = v_assignee_id;
        ELSE
          v_assignee_name := NULL;
        END IF;

        -- Sync task_assignees
        IF to_regclass('public.task_assignees') IS NOT NULL THEN
          DELETE FROM public.task_assignees WHERE task_id = p_task_id;
          FOREACH v_uid IN ARRAY v_assignees
          LOOP
            INSERT INTO public.task_assignees (task_id, user_id, assigned_by, assigned_at)
            VALUES (p_task_id, v_uid, p_actor_id, clock_timestamp());
          END LOOP;
        END IF;
      END IF;

      -- Determine approval status & event logging:
      -- Employee material changes reset pending/reviewer fields, increment version once, append immutable event.
      -- Admin/Manager material edits do NOT reset approval.
      IF v_actor.role NOT IN ('Admin', 'Manager') AND v_is_material_change THEN
        v_new_approval_status := 'pending';
        v_reviewed_by := NULL;
        v_reviewed_at := NULL;
        v_rejection_reason := NULL;

        -- Append immutable review event
        INSERT INTO public.task_creation_review_events (
          task_id,
          work_request_id,
          entity_id,
          event_type,
          decision,
          actor_id,
          reason,
          metadata,
          created_at
        ) VALUES (
          v_task.id,
          p_work_request_id,
          p_entity_id,
          'material_update',
          NULL,
          p_actor_id,
          NULL,
          jsonb_build_object(
            'prior_approval_status', v_task.approval_status,
            'prior_version', v_task.version,
            'new_version', v_task.version + 1,
            'prior_reviewed_by', v_task.reviewed_by,
            'prior_reviewed_at', v_task.reviewed_at,
            'prior_rejection_reason', v_task.rejection_reason,
            'changes', v_patch
          ),
          clock_timestamp()
        );
      ELSE
        v_new_approval_status := v_task.approval_status;
        v_reviewed_by := v_task.reviewed_by;
        v_reviewed_at := v_task.reviewed_at;
        v_rejection_reason := v_task.rejection_reason;
      END IF;

      -- Update task row, increment version once, and return
      RETURN QUERY
      UPDATE public.tasks
      SET approval_status = v_new_approval_status,
          title = v_title,
          description = v_description,
          due_date = v_due_date,
          required_link_type = v_required_link_type,
          display_order = v_display_order,
          assignee_id = v_assignee_id,
          assignee_name = v_assignee_name,
          predecessors = v_predecessors,
          reviewed_by = v_reviewed_by,
          reviewed_at = v_reviewed_at,
          rejection_reason = v_rejection_reason,
          version = v_task.version + 1,
          updated_at = clock_timestamp()
      WHERE id = p_task_id
      RETURNING *;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.task_material_update(uuid, uuid, uuid, uuid, integer, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.task_material_update(uuid, uuid, uuid, uuid, integer, jsonb, uuid[]) TO service_role;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS public.task_material_update(uuid, uuid, uuid, uuid, integer, jsonb, uuid[]);
    DROP FUNCTION IF EXISTS public.task_creation_review_create(uuid, uuid, uuid, jsonb, uuid[]);
  `);
};
