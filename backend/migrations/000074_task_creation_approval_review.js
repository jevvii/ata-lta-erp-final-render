/**
 * Migration 000074: Task Creation Approval Review
 *
 * Implements the database parcel for task creation review per CONTRACT.md (Policy R3-R8)
 * and TASK-DB-PARCEL.md:
 * - Adds approval_status, created_by, reviewed_by, reviewed_at, rejection_reason to tasks table.
 * - Legacy existing tasks remain 'approved' by default.
 * - Adds immutable append-only task_creation_review_events table with service_role-only access
 *   and explicit trigger-level UPDATE/DELETE denial to protect history integrity.
 * - Implements atomic RPC procedures:
 *     1. public.task_creation_review_decide
 *     2. public.task_creation_review_resubmit
 * - Implements transactional checks under locks:
 *     - Parent-before-task lock order (protects against concurrent race and deadlocks).
 *     - Current active DB user verification.
 *     - Entity entitlement validation (including ALL).
 *     - Assigned Manager lead validation (Admin strictly denied from deciding tasks).
 *     - Parent admission and writable state guards (archived, Cancelled, and Completed rejected).
 *     - Task version optimistic concurrency control (OCC).
 *     - Explicit validation rejecting NULL decision and missing/invalid expected_version.
 *     - Creator-only resubmission with strict field whitelist and dependency validation.
 *     - Atomic immutable event logging preserving review history.
 * - Adds SQL guards/triggers:
 *     - Blocks WR phase advancement and completion when pending/rejected tasks exist.
 *     - Blocks ordinary work mutations on rejected tasks (status/material edits, checklists, time).
 *     - Enforces append-only history on review events.
 *
 * @type {import('node-pg-migrate').Migration}
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Extend tasks table with creation review columns
    ALTER TABLE public.tasks
      ADD COLUMN IF NOT EXISTS approval_status varchar(30) NOT NULL DEFAULT 'approved',
      ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
      ADD COLUMN IF NOT EXISTS rejection_reason text;

    ALTER TABLE public.tasks
      DROP CONSTRAINT IF EXISTS chk_tasks_approval_status,
      ADD CONSTRAINT chk_tasks_approval_status
      CHECK (approval_status IN ('approved', 'pending', 'rejected'));

    CREATE INDEX IF NOT EXISTS idx_tasks_approval_status
      ON public.tasks (work_request_id, approval_status)
      WHERE deleted_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_tasks_created_by
      ON public.tasks (created_by)
      WHERE deleted_at IS NULL;

    -- 2. Create immutable review events table
    CREATE TABLE IF NOT EXISTS public.task_creation_review_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
      work_request_id uuid NOT NULL REFERENCES public.work_requests(id) ON DELETE CASCADE,
      entity_id uuid NOT NULL,
      event_type varchar(50) NOT NULL CHECK (event_type IN ('decision', 'resubmission')),
      decision varchar(30) CHECK (decision IN ('approved', 'rejected')),
      actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
      reason text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );

    CREATE INDEX IF NOT EXISTS idx_task_creation_review_events_task_id
      ON public.task_creation_review_events (task_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_task_creation_review_events_wr_id
      ON public.task_creation_review_events (work_request_id);

    REVOKE ALL ON TABLE public.task_creation_review_events FROM PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, INSERT ON TABLE public.task_creation_review_events TO service_role;
    ALTER TABLE public.task_creation_review_events ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS task_creation_review_events_service_role ON public.task_creation_review_events;
    CREATE POLICY task_creation_review_events_service_role ON public.task_creation_review_events
      FOR SELECT TO service_role USING (true);

    DROP POLICY IF EXISTS task_creation_review_events_insert_service_role ON public.task_creation_review_events;
    CREATE POLICY task_creation_review_events_insert_service_role ON public.task_creation_review_events
      FOR INSERT TO service_role WITH CHECK (true);

    -- Enforce append-only denial trigger: UPDATE and DELETE are strictly prohibited even for service_role
    CREATE OR REPLACE FUNCTION public.deny_task_creation_review_events_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RAISE EXCEPTION 'TASK_REVIEW_STATE: task_creation_review_events is append-only and cannot be updated or deleted'
        USING ERRCODE = '42501';
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_task_creation_review_events_immutable ON public.task_creation_review_events;
    CREATE TRIGGER trg_task_creation_review_events_immutable
      BEFORE UPDATE OR DELETE ON public.task_creation_review_events
      FOR EACH ROW
      EXECUTE FUNCTION public.deny_task_creation_review_events_mutation();

    DROP TRIGGER IF EXISTS trg_task_creation_review_events_truncate ON public.task_creation_review_events;
    CREATE TRIGGER trg_task_creation_review_events_truncate
      BEFORE TRUNCATE ON public.task_creation_review_events
      FOR EACH STATEMENT
      EXECUTE FUNCTION public.deny_task_creation_review_events_mutation();

    -- 3. Helper: Phase ranking for advancement check
    CREATE OR REPLACE FUNCTION public._phase_rank(p_phase text) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
      SELECT CASE p_phase
        WHEN 'pre_processing' THEN 1
        WHEN 'processing' THEN 2
        WHEN 'quality_assurance' THEN 3
        WHEN 'completion' THEN 4
        ELSE 0
      END;
    $$;

    -- 4. Work request guard: block phase advancement & completion with pending/rejected tasks
    CREATE OR REPLACE FUNCTION public.check_work_requests_task_review_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      -- Block phase advancement or setting status to Completed if any non-deleted task is pending or rejected
      IF (
        (NEW.status = 'Completed' AND (OLD.status IS DISTINCT FROM 'Completed'))
        OR
        (_phase_rank(NEW.phase) > _phase_rank(OLD.phase))
      ) THEN
        IF EXISTS (
          SELECT 1 FROM public.tasks
          WHERE work_request_id = NEW.id
            AND deleted_at IS NULL
            AND approval_status IN ('pending', 'rejected')
        ) THEN
          RAISE EXCEPTION 'TASK_REVIEW_REQUIRED: Cannot advance phase or complete work request with pending or rejected tasks'
            USING ERRCODE = 'P0002';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_work_requests_task_review_guard ON public.work_requests;
    CREATE TRIGGER trg_work_requests_task_review_guard
      BEFORE UPDATE ON public.work_requests
      FOR EACH ROW
      EXECUTE FUNCTION public.check_work_requests_task_review_guard();

    -- 5. Tasks guard: block ordinary work mutations on rejected tasks
    CREATE OR REPLACE FUNCTION public.check_tasks_rejected_guard()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      -- If task is rejected, block modifications unless it is transitioning to 'pending' via resubmission
      IF OLD.approval_status = 'rejected' THEN
        IF NEW.approval_status <> 'pending' THEN
          RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Cannot modify rejected task without resubmission'
            USING ERRCODE = 'P0002';
        END IF;
      END IF;

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_tasks_rejected_guard ON public.tasks;
    CREATE TRIGGER trg_tasks_rejected_guard
      BEFORE UPDATE ON public.tasks
      FOR EACH ROW
      EXECUTE FUNCTION public.check_tasks_rejected_guard();

    -- 6. Descendant guards: checklists and time logs cannot be added/modified on rejected tasks
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_checklists') THEN
        CREATE OR REPLACE FUNCTION public.check_task_checklists_rejected_guard()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $chk$
        DECLARE
          v_app_status varchar(30);
        BEGIN
          SELECT approval_status INTO v_app_status
          FROM public.tasks
          WHERE id = NEW.task_id;

          IF v_app_status = 'rejected' THEN
            RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Cannot modify checklists on a rejected task'
              USING ERRCODE = 'P0002';
          END IF;

          RETURN NEW;
        END;
        $chk$;

        DROP TRIGGER IF EXISTS trg_task_checklists_rejected_guard ON public.task_checklists;
        CREATE TRIGGER trg_task_checklists_rejected_guard
          BEFORE INSERT OR UPDATE ON public.task_checklists
          FOR EACH ROW
          EXECUTE FUNCTION public.check_task_checklists_rejected_guard();
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_time_logs') THEN
        CREATE OR REPLACE FUNCTION public.check_task_time_logs_rejected_guard()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $time$
        DECLARE
          v_app_status varchar(30);
        BEGIN
          SELECT approval_status INTO v_app_status
          FROM public.tasks
          WHERE id = NEW.task_id;

          IF v_app_status = 'rejected' THEN
            RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Cannot log time on a rejected task'
              USING ERRCODE = 'P0002';
          END IF;

          RETURN NEW;
        END;
        $time$;

        DROP TRIGGER IF EXISTS trg_task_time_logs_rejected_guard ON public.task_time_logs;
        CREATE TRIGGER trg_task_time_logs_rejected_guard
          BEFORE INSERT OR UPDATE ON public.task_time_logs
          FOR EACH ROW
          EXECUTE FUNCTION public.check_task_time_logs_rejected_guard();
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'time_entries') THEN
        CREATE OR REPLACE FUNCTION public.check_time_entries_rejected_guard()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public, pg_temp
        AS $tent$
        DECLARE
          v_app_status varchar(30);
        BEGIN
          SELECT approval_status INTO v_app_status
          FROM public.tasks
          WHERE id = NEW.task_id;

          IF v_app_status = 'rejected' THEN
            RAISE EXCEPTION 'TASK_REJECTED_LOCKED: Cannot log time on a rejected task'
              USING ERRCODE = 'P0002';
          END IF;

          RETURN NEW;
        END;
        $tent$;

        DROP TRIGGER IF EXISTS trg_time_entries_rejected_guard ON public.time_entries;
        CREATE TRIGGER trg_time_entries_rejected_guard
          BEFORE INSERT OR UPDATE ON public.time_entries
          FOR EACH ROW
          EXECUTE FUNCTION public.check_time_entries_rejected_guard();
      END IF;
    END $$;

    -- 7. RPC 1: task_creation_review_decide
    CREATE OR REPLACE FUNCTION public.task_creation_review_decide(
      p_task_id uuid,
      p_work_request_id uuid,
      p_entity_id uuid,
      p_actor_id uuid,
      p_expected_version integer,
      p_decision text,
      p_reason text DEFAULT NULL
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
      v_norm_decision text;
      v_trimmed_reason text;
    BEGIN
      -- Validate required identifiers
      IF p_task_id IS NULL OR p_work_request_id IS NULL OR p_entity_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Missing required parameters' USING ERRCODE = '22023';
      END IF;

      -- Explicitly reject missing or non-positive expectedVersion
      IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: expectedVersion is required and must be a positive integer' USING ERRCODE = 'P0001';
      END IF;

      -- Explicitly reject missing or invalid decision (NULL evaluates to UNKNOWN in NOT IN)
      IF p_decision IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Decision is required (must be approve or reject)' USING ERRCODE = '22023';
      END IF;

      v_norm_decision := lower(trim(p_decision));
      IF v_norm_decision NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Invalid decision % (must be approve or reject)', p_decision USING ERRCODE = '22023';
      END IF;

      v_trimmed_reason := NULLIF(trim(p_reason), '');
      IF v_norm_decision = 'reject' AND v_trimmed_reason IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_REQUIRED: Rejection reason is required' USING ERRCODE = '22023';
      END IF;

      -- Parent-before-task lock order: lock work request first to serialize review with WR state changes
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

      -- Verify actor existence and active status
      SELECT * INTO v_actor
      FROM public.users
      WHERE id = p_actor_id;

      IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Inactive or invalid actor' USING ERRCODE = '42501';
      END IF;

      -- Admin is explicitly forbidden to decide tasks (Policy R5: NO Admin override)
      IF v_actor.role = 'Admin' THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Admin is not permitted to review task creation' USING ERRCODE = '42501';
      END IF;

      -- Only Manager role can review tasks
      IF v_actor.role <> 'Manager' THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Only Manager role can review task creation' USING ERRCODE = '42501';
      END IF;

      -- Under parent row lock: verify current assigned lead
      IF v_wr.assigned_to IS NULL OR v_wr.assigned_to <> p_actor_id THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Only the assigned work request Manager lead can decide task creation' USING ERRCODE = '42501';
      END IF;

      -- Check actor entity entitlement under lock
      SELECT upper(trim(code)) INTO v_entity_code
      FROM public.entities
      WHERE id = p_entity_id;

      IF NOT FOUND OR v_entity_code IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Entity not found' USING ERRCODE = 'P0002';
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(v_actor.entities, ARRAY[]::text[])) ue
        WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
      ) THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Actor not entitled to entity' USING ERRCODE = '42501';
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

      -- Task state check: must be pending
      IF v_task.approval_status <> 'pending' THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Task is not pending review' USING ERRCODE = 'P0002';
      END IF;

      -- Insert immutable review event atomically
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
        'decision',
        CASE WHEN v_norm_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
        p_actor_id,
        CASE WHEN v_norm_decision = 'reject' THEN v_trimmed_reason ELSE NULL END,
        jsonb_build_object(
          'prior_approval_status', v_task.approval_status,
          'prior_version', v_task.version,
          'new_version', v_task.version + 1,
          'prior_reviewed_by', v_task.reviewed_by,
          'prior_reviewed_at', v_task.reviewed_at,
          'prior_rejection_reason', v_task.rejection_reason
        ),
        clock_timestamp()
      );

      -- Update task row and return
      RETURN QUERY
      UPDATE public.tasks
      SET approval_status = CASE WHEN v_norm_decision = 'approve' THEN 'approved'::varchar(30) ELSE 'rejected'::varchar(30) END,
          reviewed_by = p_actor_id,
          reviewed_at = clock_timestamp(),
          rejection_reason = CASE WHEN v_norm_decision = 'reject' THEN v_trimmed_reason ELSE NULL END,
          version = v_task.version + 1,
          updated_at = clock_timestamp()
      WHERE id = p_task_id
      RETURNING *;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.task_creation_review_decide(uuid, uuid, uuid, uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.task_creation_review_decide(uuid, uuid, uuid, uuid, integer, text, text) TO service_role;

    -- 8. RPC 2: task_creation_review_resubmit
    CREATE OR REPLACE FUNCTION public.task_creation_review_resubmit(
      p_task_id uuid,
      p_work_request_id uuid,
      p_entity_id uuid,
      p_actor_id uuid,
      p_expected_version integer,
      p_data jsonb DEFAULT '{}'::jsonb
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
      v_corrections jsonb;

      v_title text;
      v_description text;
      v_due_date timestamptz;
      v_required_link_type varchar(50);
      v_assignee_id uuid;
      v_assignee_name varchar(255);
      v_predecessors uuid[];

      v_pred_id uuid;
      v_uid uuid;
      v_assignee_user public.users%ROWTYPE;
    BEGIN
      -- Validate required identifiers
      IF p_task_id IS NULL OR p_work_request_id IS NULL OR p_entity_id IS NULL OR p_actor_id IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: Missing required parameters' USING ERRCODE = '22023';
      END IF;

      -- Explicitly reject missing or non-positive expectedVersion
      IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'TASK_REVIEW_CONFLICT: expectedVersion is required and must be a positive integer' USING ERRCODE = 'P0001';
      END IF;

      v_corrections := COALESCE(p_data, '{}'::jsonb);

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

      SELECT upper(trim(code)) INTO v_entity_code
      FROM public.entities
      WHERE id = p_entity_id;

      IF NOT FOUND OR v_entity_code IS NULL THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Entity not found' USING ERRCODE = 'P0002';
      END IF;

      -- Entity entitlement check (Admin with empty array or ALL / specific entity)
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

      -- Canonical task creator check (Policy R6, TASK-DB-PARCEL: creator only)
      IF v_task.created_by IS NULL OR v_task.created_by <> p_actor_id THEN
        RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Only the task creator can resubmit' USING ERRCODE = '42501';
      END IF;

      -- Current ordinary WR membership under lock (creator must still have active membership)
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

      -- Only rejected tasks can be resubmitted
      IF v_task.approval_status <> 'rejected' THEN
        RAISE EXCEPTION 'TASK_REVIEW_STATE: Only rejected tasks can be resubmitted' USING ERRCODE = 'P0002';
      END IF;

      -- Whitelist validation of p_data keys
      FOR v_key IN SELECT jsonb_object_keys(v_corrections)
      LOOP
        IF v_key NOT IN (
          'title', 'description', 'dueDate', 'due_date',
          'assigneeId', 'assignee_id', 'assignees',
          'predecessors', 'requiredLinkType', 'required_link_type'
        ) THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Unsupported field in resubmit data: %', v_key USING ERRCODE = '22023';
        END IF;
      END LOOP;

      -- Initialize with current task values (preserves execution status, phase, etc.)
      v_title := v_task.title;
      v_description := v_task.description;
      v_due_date := v_task.due_date;
      v_required_link_type := v_task.required_link_type;
      v_assignee_id := v_task.assignee_id;
      v_assignee_name := v_task.assignee_name;
      v_predecessors := v_task.predecessors;

      -- Validate and apply title
      IF v_corrections ? 'title' THEN
        v_title := trim(v_corrections->>'title');
        IF v_title IS NULL OR v_title = '' THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Task title cannot be empty' USING ERRCODE = '22023';
        END IF;
      END IF;

      -- Validate and apply description
      IF v_corrections ? 'description' THEN
        v_description := v_corrections->>'description';
      END IF;

      -- Validate and apply dueDate
      IF v_corrections ? 'dueDate' OR v_corrections ? 'due_date' THEN
        DECLARE
          v_raw_due text := COALESCE(v_corrections->>'dueDate', v_corrections->>'due_date');
        BEGIN
          IF v_raw_due IS NULL OR trim(v_raw_due) = '' THEN
            v_due_date := NULL;
          ELSE
            v_due_date := v_raw_due::timestamptz;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: Invalid dueDate format' USING ERRCODE = '22023';
        END;
      END IF;

      -- Validate and apply requiredLinkType
      IF v_corrections ? 'requiredLinkType' OR v_corrections ? 'required_link_type' THEN
        v_required_link_type := NULLIF(trim(COALESCE(v_corrections->>'requiredLinkType', v_corrections->>'required_link_type')), '');
      END IF;

      -- Validate and apply predecessors
      IF v_corrections ? 'predecessors' THEN
        IF jsonb_typeof(v_corrections->'predecessors') <> 'array' THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: predecessors must be an array' USING ERRCODE = '22023';
        END IF;

        v_predecessors := ARRAY[]::uuid[];
        FOR v_pred_id IN SELECT (jsonb_array_elements_text(v_corrections->'predecessors'))::uuid
        LOOP
          IF v_pred_id = v_task.id THEN
            RAISE EXCEPTION 'TASK_REVIEW_STATE: Task cannot depend on itself' USING ERRCODE = '22023';
          END IF;

          -- Must exist in same WR and not soft-deleted
          IF NOT EXISTS (
            SELECT 1 FROM public.tasks
            WHERE id = v_pred_id AND work_request_id = p_work_request_id AND deleted_at IS NULL
          ) THEN
            RAISE EXCEPTION 'TASK_REVIEW_STATE: Predecessor task % does not belong to same work request', v_pred_id USING ERRCODE = '22023';
          END IF;

          IF NOT (v_pred_id = ANY(v_predecessors)) THEN
            v_predecessors := array_append(v_predecessors, v_pred_id);
          END IF;
        END LOOP;
      END IF;

      -- Validate and apply assigneeId
      IF v_corrections ? 'assigneeId' OR v_corrections ? 'assignee_id' THEN
        DECLARE
          v_raw_assignee text := COALESCE(v_corrections->>'assigneeId', v_corrections->>'assignee_id');
        BEGIN
          IF v_raw_assignee IS NULL OR trim(v_raw_assignee) = '' THEN
            v_assignee_id := NULL;
            v_assignee_name := NULL;
          ELSE
            v_assignee_id := v_raw_assignee::uuid;
            SELECT * INTO v_assignee_user FROM public.users WHERE id = v_assignee_id;
            IF NOT FOUND OR v_assignee_user.is_active IS NOT TRUE THEN
              RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Assignee is inactive or invalid' USING ERRCODE = '42501';
            END IF;

            IF NOT (
              (v_assignee_user.role = 'Admin' AND (v_assignee_user.entities IS NULL OR cardinality(v_assignee_user.entities) = 0))
              OR EXISTS (
                SELECT 1 FROM unnest(COALESCE(v_assignee_user.entities, ARRAY[]::text[])) ue
                WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
              )
            ) THEN
              RAISE EXCEPTION 'TASK_REVIEW_FORBIDDEN: Assignee not entitled to entity' USING ERRCODE = '42501';
            END IF;
            v_assignee_name := v_assignee_user.name;
          END IF;
        END;
      END IF;

      -- Validate and apply assignees array
      IF v_corrections ? 'assignees' THEN
        IF jsonb_typeof(v_corrections->'assignees') <> 'array' THEN
          RAISE EXCEPTION 'TASK_REVIEW_STATE: assignees must be an array' USING ERRCODE = '22023';
        END IF;

        FOR v_uid IN SELECT (jsonb_array_elements_text(v_corrections->'assignees'))::uuid
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

        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_assignees') THEN
          DELETE FROM public.task_assignees WHERE task_id = v_task.id;
          FOR v_uid IN SELECT (jsonb_array_elements_text(v_corrections->'assignees'))::uuid
          LOOP
            INSERT INTO public.task_assignees (task_id, user_id, assigned_by, assigned_at)
            VALUES (v_task.id, v_uid, p_actor_id, clock_timestamp());
          END LOOP;
        END IF;

        IF NOT (v_corrections ? 'assigneeId' OR v_corrections ? 'assignee_id') THEN
          IF jsonb_array_length(v_corrections->'assignees') > 0 THEN
            v_assignee_id := (v_corrections->'assignees'->>0)::uuid;
            SELECT name INTO v_assignee_name FROM public.users WHERE id = v_assignee_id;
          ELSE
            v_assignee_id := NULL;
            v_assignee_name := NULL;
          END IF;
        END IF;
      END IF;

      -- Insert immutable review event atomically (recording corrections and prior state)
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
        'resubmission',
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
          'corrections', v_corrections
        ),
        clock_timestamp()
      );

      -- Update task: returns to 'pending', clears reviewer fields, increments version
      RETURN QUERY
      UPDATE public.tasks
      SET approval_status = 'pending'::varchar(30),
          title = v_title,
          description = v_description,
          due_date = v_due_date,
          required_link_type = v_required_link_type,
          assignee_id = v_assignee_id,
          assignee_name = v_assignee_name,
          predecessors = v_predecessors,
          reviewed_by = NULL,
          reviewed_at = NULL,
          rejection_reason = NULL,
          version = v_task.version + 1,
          updated_at = clock_timestamp()
      WHERE id = p_task_id
      RETURNING *;
    END;
    $$;

    REVOKE ALL ON FUNCTION public.task_creation_review_resubmit(uuid, uuid, uuid, uuid, integer, jsonb) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.task_creation_review_resubmit(uuid, uuid, uuid, uuid, integer, jsonb) TO service_role;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- 1. Drop procedures
    DROP FUNCTION IF EXISTS public.task_creation_review_decide(uuid, uuid, uuid, uuid, integer, text, text);
    DROP FUNCTION IF EXISTS public.task_creation_review_resubmit(uuid, uuid, uuid, uuid, integer, jsonb);

    -- 2. Drop triggers & trigger functions
    DROP TRIGGER IF EXISTS trg_task_creation_review_events_immutable ON public.task_creation_review_events;
    DROP TRIGGER IF EXISTS trg_task_creation_review_events_truncate ON public.task_creation_review_events;
    DROP FUNCTION IF EXISTS public.deny_task_creation_review_events_mutation();

    DROP TRIGGER IF EXISTS trg_work_requests_task_review_guard ON public.work_requests;
    DROP FUNCTION IF EXISTS public.check_work_requests_task_review_guard();

    DROP TRIGGER IF EXISTS trg_tasks_rejected_guard ON public.tasks;
    DROP FUNCTION IF EXISTS public.check_tasks_rejected_guard();

    DROP TRIGGER IF EXISTS trg_task_checklists_rejected_guard ON public.task_checklists;
    DROP FUNCTION IF EXISTS public.check_task_checklists_rejected_guard();

    DROP TRIGGER IF EXISTS trg_task_time_logs_rejected_guard ON public.task_time_logs;
    DROP FUNCTION IF EXISTS public.check_task_time_logs_rejected_guard();

    DROP TRIGGER IF EXISTS trg_time_entries_rejected_guard ON public.time_entries;
    DROP FUNCTION IF EXISTS public.check_time_entries_rejected_guard();

    DROP FUNCTION IF EXISTS public._phase_rank(text);

    -- 3. Drop event table
    DROP TABLE IF EXISTS public.task_creation_review_events CASCADE;

    -- 4. Drop columns and indexes from tasks
    DROP INDEX IF EXISTS idx_tasks_created_by;
    DROP INDEX IF EXISTS idx_tasks_approval_status;

    ALTER TABLE public.tasks
      DROP CONSTRAINT IF EXISTS chk_tasks_approval_status,
      DROP COLUMN IF EXISTS approval_status,
      DROP COLUMN IF EXISTS created_by,
      DROP COLUMN IF EXISTS reviewed_by,
      DROP COLUMN IF EXISTS reviewed_at,
      DROP COLUMN IF EXISTS rejection_reason;
  `);
};
