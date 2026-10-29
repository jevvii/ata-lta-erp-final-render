/**
 * Disbursement workflow: atomic transitions, versioning and read compatibility.
 * Existing records retain all saved values; only new requests use workflow version 2.
 * No legacy classification, reconciliation status or manual migration UI is required.
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- Add only technical workflow compatibility fields. Existing values are not rewritten.
    ALTER TABLE public.disbursements
      ADD COLUMN IF NOT EXISTS lifecycle_version integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS review_ready boolean NOT NULL DEFAULT true;

    -- 3. Indexes for queue performance
    CREATE INDEX IF NOT EXISTS idx_disbursements_lifecycle_v2_queues
      ON public.disbursements (entity_id, lifecycle_version, status, review_ready)
      WHERE deleted_at IS NULL;

    -- 4. Drop obsolete transition overloads from previous migrations
    DROP FUNCTION IF EXISTS public.disbursement_transition(uuid, text[], text, uuid, uuid, text, jsonb);
    DROP FUNCTION IF EXISTS public.disbursement_transition(uuid, text, text, uuid, uuid, text, jsonb);
    DROP FUNCTION IF EXISTS public.disbursement_transition(uuid, text, text, uuid, uuid);

    -- 5. Revoke browser mutation privileges from anon, authenticated, and PUBLIC
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.disbursements FROM anon, authenticated, PUBLIC;
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.status_history FROM anon, authenticated, PUBLIC;
    GRANT ALL ON public.disbursements TO service_role, postgres;
    GRANT ALL ON public.status_history TO service_role, postgres;
    GRANT SELECT ON public.disbursements TO authenticated;
    GRANT SELECT ON public.status_history TO authenticated;

    -- 5b. Update notifications type constraint to support disbursement.lifecycle
    ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
      'pending_request.resolved',
      'wr.transition_request.received',
      'wr.transition_request.resolved',
      'wr.qa_reroute',
      'disbursement.lifecycle'
    ));

    -- 6. Canonical 8-argument disbursement_transition procedure
    CREATE OR REPLACE FUNCTION public.disbursement_transition(
      p_id uuid,
      p_from_statuses text[],
      p_to_status text,
      p_user_id uuid,
      p_entity_id uuid,
      p_reason text DEFAULT NULL,
      p_payment_details jsonb DEFAULT NULL,
      p_expected_version integer DEFAULT NULL
    )
    RETURNS SETOF public.disbursements
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row disbursements%ROWTYPE;
      v_old_row disbursements%ROWTYPE;
      v_old_status text;
      v_actor users%ROWTYPE;
      v_entity_code text;
      v_details jsonb := '{}'::jsonb;
      v_prior_prep jsonb := NULL;
      v_is_accounting boolean := false;
    BEGIN
      -- Validate positive expected version for v2 concurrency guard
      IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'VERSION_REQUIRED' USING ERRCODE = 'P0001';
      END IF;

      -- Validate actor existence, active flag, and entity access
      SELECT * INTO v_actor
      FROM public.users
      WHERE id = p_user_id;

      IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'FORBIDDEN_INACTIVE_OR_INVALID_ACTOR' USING ERRCODE = '42501';
      END IF;

      SELECT code INTO v_entity_code
      FROM public.entities
      WHERE id = p_entity_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ENTITY_NOT_FOUND' USING ERRCODE = 'P0002';
      END IF;

      IF NOT COALESCE(v_entity_code = ANY(v_actor.entities), false) THEN
        RAISE EXCEPTION 'FORBIDDEN_ENTITY_ACCESS' USING ERRCODE = '42501';
      END IF;

      -- Check if actor has accounting membership
      IF v_actor.role = 'Accounting' OR EXISTS (
        SELECT 1 FROM public.user_departments ud
        JOIN public.departments d ON d.id = ud.department_id
        WHERE ud.user_id = p_user_id AND lower(d.name) = 'accounting'
      ) THEN
        v_is_accounting := true;
      END IF;

      -- Atomic row lock on target disbursement
      SELECT * INTO v_row
      FROM public.disbursements
      WHERE id = p_id AND entity_id = p_entity_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      -- Snapshot original row and status before any modification
      v_old_row := v_row;
      v_old_status := v_row.status;

      -- Soft-deleted or archived records cannot undergo transitions
      IF v_row.deleted_at IS NOT NULL OR v_row.archived IS TRUE THEN
        RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
      END IF;

      -- OCC Version check
      IF v_row.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_CONCURRENCY_CONFLICT' USING ERRCODE = 'P0001';
      END IF;

      -- Predecessor status check supplied by caller
      IF NOT (v_row.status = ANY(p_from_statuses)) THEN
        RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
      END IF;

      -- Previously saved records retain their original values and are read-only for new workflow actions
      IF v_row.lifecycle_version IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'SAVED_WORKFLOW_READ_ONLY' USING ERRCODE = 'P0003';
      END IF;

      -- Canonical V2 State Machine & Actor Authorization
      IF p_to_status = 'Approved' THEN
        -- Only Admin can approve
        IF v_actor.role IS DISTINCT FROM 'Admin' THEN
          RAISE EXCEPTION 'FORBIDDEN_ROLE_NOT_ADMIN' USING ERRCODE = '42501';
        END IF;

        -- Canonical predecessor: MUST be Draft
        IF v_row.status <> 'Draft' THEN
          RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
        END IF;

        -- The single Admin may approve their own request; preserve normal readiness/OCC checks.

        -- Review readiness check (returned draft cannot be approved before correction)
        IF v_row.review_ready IS NOT TRUE THEN
          RAISE EXCEPTION 'CONFLICT_NOT_REVIEW_READY' USING ERRCODE = 'P0002';
        END IF;

        -- Require a complete request and references scoped to the voucher entity.
        IF v_row.created_by IS NULL OR v_row.requested_by IS NULL OR
           v_row.amount IS NULL OR v_row.amount <= 0 OR
           trim(COALESCE(v_row.category, '')) = '' OR
           trim(COALESCE(v_row.description, '')) = '' OR
           v_row.fund_source IS NULL OR v_row.fund_source NOT IN ('Firm Fund', 'Client Fund') OR
           v_row.linked_work_request_id IS NULL OR NOT EXISTS (
             SELECT 1 FROM public.work_requests w
             WHERE w.id = v_row.linked_work_request_id AND w.entity_id = v_row.entity_id
               AND (v_row.client_id IS NULL OR w.client_id = v_row.client_id)
           ) OR (v_row.client_id IS NOT NULL AND NOT EXISTS (
             SELECT 1 FROM public.clients c WHERE c.id = v_row.client_id AND c.entity_id = v_row.entity_id
           )) THEN
          RAISE EXCEPTION 'INCOMPLETE_REQUEST' USING ERRCODE = '22023';
        END IF;

        v_details := jsonb_build_object(
          'action', 'approve',
          'previous_version', v_old_row.version
        );

        UPDATE public.disbursements
        SET status = 'Approved',
            approved_by = p_user_id,
            approved_at = now(),
            updated_by = p_user_id,
            updated_at = now(),
            version = version + 1
        WHERE id = p_id
        RETURNING * INTO v_row;

      ELSIF p_to_status = 'Funded' THEN
        -- Only Accounting or Admin can fund
        IF v_actor.role IS DISTINCT FROM 'Admin' AND NOT v_is_accounting THEN
          RAISE EXCEPTION 'FORBIDDEN_ROLE_NOT_ACCOUNTING' USING ERRCODE = '42501';
        END IF;

        -- Canonical predecessor: MUST be Approved
        IF v_row.status <> 'Approved' THEN
          RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
        END IF;

        -- Validate 4 required payment fields
        IF p_payment_details IS NULL OR
           trim(COALESCE(p_payment_details->>'method', '')) = '' OR
           trim(COALESCE(p_payment_details->>'bank', '')) = '' OR
           trim(COALESCE(p_payment_details->>'reference', '')) = '' OR
           trim(COALESCE(p_payment_details->>'date', '')) = '' THEN
          RAISE EXCEPTION 'PAYMENT_DETAILS_REQUIRED' USING ERRCODE = '22023';
        END IF;

        v_details := jsonb_build_object(
          'action', 'fund',
          'payment_details', p_payment_details,
          'previous_version', v_old_row.version
        );

        UPDATE public.disbursements
        SET status = 'Funded',
            funded_by = p_user_id,
            funded_at = now(),
            payment_method = trim(p_payment_details->>'method'),
            payment_bank = trim(p_payment_details->>'bank'),
            payment_reference = trim(p_payment_details->>'reference'),
            payment_date = (p_payment_details->>'date')::date,
            payment_processed_by = p_user_id,
            updated_by = p_user_id,
            updated_at = now(),
            version = version + 1
        WHERE id = p_id
        RETURNING * INTO v_row;

      ELSIF p_to_status = 'Released' THEN
        -- Only Admin can release
        IF v_actor.role IS DISTINCT FROM 'Admin' THEN
          RAISE EXCEPTION 'FORBIDDEN_ROLE_NOT_ADMIN' USING ERRCODE = '42501';
        END IF;

        -- Canonical predecessor: MUST be Funded (Draft -> Released is strictly forbidden!)
        IF v_row.status <> 'Funded' THEN
          RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
        END IF;

        -- A single Admin may also release the instrument they prepared.

        -- Persisted instrument check
        IF v_row.payment_method IS NULL OR
           v_row.payment_bank IS NULL OR
           v_row.payment_reference IS NULL OR
           v_row.payment_date IS NULL THEN
          RAISE EXCEPTION 'INCOMPLETE_PAYMENT_INSTRUMENT' USING ERRCODE = '22023';
        END IF;

        v_details := jsonb_build_object(
          'action', 'release',
          'payment_method', v_row.payment_method,
          'payment_bank', v_row.payment_bank,
          'payment_reference', v_row.payment_reference,
          'payment_date', v_row.payment_date,
          'previous_version', v_old_row.version
        );

        UPDATE public.disbursements
        SET status = 'Released',
            released_by = p_user_id,
            released_at = now(),
            updated_by = p_user_id,
            updated_at = now(),
            version = version + 1
        WHERE id = p_id
        RETURNING * INTO v_row;

      ELSIF p_to_status = 'Rejected' THEN
        -- Only Admin can reject
        IF v_actor.role IS DISTINCT FROM 'Admin' THEN
          RAISE EXCEPTION 'FORBIDDEN_ROLE_NOT_ADMIN' USING ERRCODE = '42501';
        END IF;

        -- Canonical predecessor: MUST be Draft or Funded
        IF v_row.status NOT IN ('Draft', 'Funded') THEN
          RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
        END IF;

        IF p_reason IS NULL OR length(trim(p_reason)) < 1 OR length(trim(p_reason)) > 500 THEN
          RAISE EXCEPTION 'INVALID_REJECTION_REASON' USING ERRCODE = '22023';
        END IF;

        v_details := jsonb_build_object(
          'action', 'reject',
          'reason', trim(p_reason),
          'previous_version', v_old_row.version
        );

        UPDATE public.disbursements
        SET status = 'Rejected',
            rejected_by = p_user_id,
            rejected_at = now(),
            rejection_reason = trim(p_reason),
            updated_by = p_user_id,
            updated_at = now(),
            version = version + 1
        WHERE id = p_id
        RETURNING * INTO v_row;

      ELSIF p_to_status = 'Draft' AND v_row.status = 'Rejected' THEN
        -- Only Admin can return rejected draft
        IF v_actor.role IS DISTINCT FROM 'Admin' THEN
          RAISE EXCEPTION 'FORBIDDEN_ROLE_NOT_ADMIN' USING ERRCODE = '42501';
        END IF;

        -- Resend draft from rejected: snapshot prior preparation in history before clearing current-cycle fields
        v_prior_prep := jsonb_build_object(
          'approved_by', v_row.approved_by,
          'approved_at', v_row.approved_at,
          'funded_by', v_row.funded_by,
          'funded_at', v_row.funded_at,
          'released_by', v_row.released_by,
          'released_at', v_row.released_at,
          'payment_method', v_row.payment_method,
          'payment_bank', v_row.payment_bank,
          'payment_reference', v_row.payment_reference,
          'payment_date', v_row.payment_date,
          'payment_processed_by', v_row.payment_processed_by
        );

        v_details := jsonb_build_object(
          'action', 'resend_draft',
          'prior_preparation', v_prior_prep,
          'rejection_reason', v_row.rejection_reason,
          'previous_version', v_old_row.version
        );

        UPDATE public.disbursements
        SET status = 'Draft',
            review_ready = false,
            approved_by = NULL,
            approved_at = NULL,
            funded_by = NULL,
            funded_at = NULL,
            released_by = NULL,
            released_at = NULL,
            payment_method = NULL,
            payment_bank = NULL,
            payment_reference = NULL,
            payment_date = NULL,
            payment_processed_by = NULL,
            updated_by = p_user_id,
            updated_at = now(),
            version = version + 1
        WHERE id = p_id
        RETURNING * INTO v_row;

      ELSE
        -- Any non-canonical transition is rejected
        RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
      END IF;

      -- Append event in status_history in the SAME transaction using the TRUE PREDECESSOR status
      INSERT INTO public.status_history (
        table_name,
        record_id,
        old_status,
        new_status,
        actor_id,
        entity_id,
        details,
        created_at
      ) VALUES (
        'disbursements',
        p_id,
        v_old_status,
        p_to_status,
        p_user_id,
        p_entity_id,
        v_details,
        now()
      );

      RETURN NEXT v_row;
    END;
    $$;

    REVOKE EXECUTE ON FUNCTION public.disbursement_transition(uuid, text[], text, uuid, uuid, text, jsonb, integer) FROM public, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.disbursement_transition(uuid, text[], text, uuid, uuid, text, jsonb, integer) TO service_role, postgres;

    -- 7. Stored Procedure: disbursement_archive_toggle
    CREATE OR REPLACE FUNCTION public.disbursement_archive_toggle(
      p_id uuid,
      p_entity_id uuid,
      p_user_id uuid,
      p_archive boolean,
      p_expected_version integer
    )
    RETURNS SETOF public.disbursements
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row disbursements%ROWTYPE;
      v_actor users%ROWTYPE;
      v_entity_code text;
    BEGIN
      IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'VERSION_REQUIRED' USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_actor FROM public.users WHERE id = p_user_id;
      IF NOT FOUND OR v_actor.is_active IS NOT TRUE OR v_actor.role IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'FORBIDDEN_ROLE_NOT_ADMIN' USING ERRCODE = '42501';
      END IF;

      SELECT code INTO v_entity_code FROM public.entities WHERE id = p_entity_id;
      IF NOT FOUND OR NOT COALESCE(v_entity_code = ANY(v_actor.entities), false) THEN
        RAISE EXCEPTION 'FORBIDDEN_ENTITY_ACCESS' USING ERRCODE = '42501';
      END IF;

      SELECT * INTO v_row
      FROM public.disbursements
      WHERE id = p_id AND entity_id = p_entity_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      IF v_row.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_CONCURRENCY_CONFLICT' USING ERRCODE = 'P0001';
      END IF;

      IF v_row.lifecycle_version IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'SAVED_WORKFLOW_READ_ONLY' USING ERRCODE = 'P0003';
      END IF;

      IF v_row.status <> 'Released' THEN
        RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
      END IF;

      IF p_archive THEN
        UPDATE public.disbursements
        SET archived = true,
            archived_at = now(),
            archived_by = p_user_id,
            updated_at = now(),
            updated_by = p_user_id,
            version = version + 1
        WHERE id = p_id
        RETURNING * INTO v_row;
      ELSE
        UPDATE public.disbursements
        SET archived = false,
            archived_at = NULL,
            archived_by = NULL,
            updated_at = now(),
            updated_by = p_user_id,
            version = version + 1
        WHERE id = p_id
        RETURNING * INTO v_row;
      END IF;

      INSERT INTO public.status_history (
        table_name, record_id, old_status, new_status, actor_id, entity_id, details, created_at
      ) VALUES (
        'disbursements', p_id, v_row.status, v_row.status, p_user_id, p_entity_id,
        jsonb_build_object(
          'action', CASE WHEN p_archive THEN 'archive' ELSE 'unarchive' END,
          'previous_version', p_expected_version
        ),
        now()
      );

      RETURN NEXT v_row;
    END;
    $$;

    REVOKE EXECUTE ON FUNCTION public.disbursement_archive_toggle(uuid, uuid, uuid, boolean, integer) FROM public, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.disbursement_archive_toggle(uuid, uuid, uuid, boolean, integer) TO service_role, postgres;

    -- Reconciliation is not part of the development workflow. Retire any local draft RPC.
    DROP FUNCTION IF EXISTS public.disbursement_legacy_review(uuid, uuid, uuid, text, text, integer);

    -- 9. Stored Procedure: disbursement_atomic_edit
    CREATE OR REPLACE FUNCTION public.disbursement_atomic_edit(
      p_id uuid,
      p_entity_id uuid,
      p_user_id uuid,
      p_updates jsonb,
      p_expected_version integer
    )
    RETURNS SETOF public.disbursements
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row disbursements%ROWTYPE;
      v_old_row disbursements%ROWTYPE;
      v_actor users%ROWTYPE;
      v_entity_code text;
      v_content_changed boolean := false;
      v_new_review_ready boolean;
      v_is_accounting boolean := false;
      v_has_financial_keys boolean := false;
    BEGIN
      IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'VERSION_REQUIRED' USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_actor FROM public.users WHERE id = p_user_id;
      IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'FORBIDDEN_INACTIVE_OR_INVALID_ACTOR' USING ERRCODE = '42501';
      END IF;

      SELECT code INTO v_entity_code FROM public.entities WHERE id = p_entity_id;
      IF NOT FOUND OR NOT COALESCE(v_entity_code = ANY(v_actor.entities), false) THEN
        RAISE EXCEPTION 'FORBIDDEN_ENTITY_ACCESS' USING ERRCODE = '42501';
      END IF;

      IF v_actor.role = 'Accounting' OR EXISTS (
        SELECT 1 FROM public.user_departments ud
        JOIN public.departments d ON d.id = ud.department_id
        WHERE ud.user_id = p_user_id AND lower(d.name) = 'accounting'
      ) THEN
        v_is_accounting := true;
      END IF;

      SELECT * INTO v_row
      FROM public.disbursements
      WHERE id = p_id AND entity_id = p_entity_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      v_old_row := v_row;

      IF v_row.deleted_at IS NOT NULL OR v_row.archived IS TRUE THEN
        RAISE EXCEPTION 'CONFLICT_CURRENT_STATUS' USING ERRCODE = 'P0002';
      END IF;

      IF v_row.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_CONCURRENCY_CONFLICT' USING ERRCODE = 'P0001';
      END IF;

      -- Check for financial / content keys
      IF (p_updates ? 'category') OR
         (p_updates ? 'description') OR
         (p_updates ? 'amount') OR
         (p_updates ? 'fund_source') OR
         (p_updates ? 'client_id') OR
         (p_updates ? 'linked_invoice_id') OR
         (p_updates ? 'linked_work_request_id') OR
         (p_updates ? 'linked_task_id') OR
         (p_updates ? 'task_id') OR
         (p_updates ? 'linked_transmittal_id') OR
         (p_updates ? 'due_date') OR
         (p_updates ? 'notes') OR
         (p_updates ? 'receipt_s3_key') OR
         (p_updates ? 'receipt_filename') THEN
        v_has_financial_keys := true;
      END IF;

      -- Financial edits are STRICTLY prohibited once approved or released
      IF v_has_financial_keys THEN
        IF v_row.status <> 'Draft' THEN
          RAISE EXCEPTION 'FINANCIAL_EDITS_LOCKED_AFTER_APPROVAL' USING ERRCODE = 'P0002';
        END IF;

        IF v_row.lifecycle_version IS DISTINCT FROM 2 THEN
          RAISE EXCEPTION 'SAVED_WORKFLOW_READ_ONLY' USING ERRCODE = 'P0003';
        END IF;

        -- In Draft: only Owner, Admin, or Accounting can edit
        IF v_row.created_by IS DISTINCT FROM p_user_id AND v_actor.role IS DISTINCT FROM 'Admin' AND NOT v_is_accounting THEN
          RAISE EXCEPTION 'FORBIDDEN_DRAFT_EDIT' USING ERRCODE = '42501';
        END IF;
      END IF;

      -- Print details edits: ONLY Admin
      IF (p_updates ? 'print_details') AND v_actor.role IS DISTINCT FROM 'Admin' THEN
        RAISE EXCEPTION 'FORBIDDEN_PRINT_DETAILS_ADMIN_ONLY' USING ERRCODE = '42501';
      END IF;

      -- Check whether content actually changed
      IF (p_updates ? 'category' AND COALESCE(p_updates->>'category', '') <> COALESCE(v_row.category, '')) OR
         (p_updates ? 'description' AND COALESCE(p_updates->>'description', '') <> COALESCE(v_row.description, '')) OR
         (p_updates ? 'amount' AND (p_updates->>'amount')::numeric <> v_row.amount) OR
         (p_updates ? 'fund_source' AND COALESCE(p_updates->>'fund_source', '') <> COALESCE(v_row.fund_source, '')) OR
         (p_updates ? 'client_id' AND COALESCE(p_updates->>'client_id', '') <> COALESCE(v_row.client_id::text, '')) OR
         (p_updates ? 'linked_invoice_id' AND COALESCE(p_updates->>'linked_invoice_id', '') <> COALESCE(v_row.linked_invoice_id::text, '')) OR
         (p_updates ? 'linked_work_request_id' AND COALESCE(p_updates->>'linked_work_request_id', '') <> COALESCE(v_row.linked_work_request_id::text, '')) OR
         (p_updates ? 'linked_task_id' AND COALESCE(p_updates->>'linked_task_id', '') <> COALESCE(v_row.linked_task_id::text, '')) OR
         (p_updates ? 'task_id' AND COALESCE(p_updates->>'task_id', '') <> COALESCE(v_row.task_id::text, '')) OR
         (p_updates ? 'linked_transmittal_id' AND COALESCE(p_updates->>'linked_transmittal_id', '') <> COALESCE(v_row.linked_transmittal_id::text, '')) OR
         (p_updates ? 'due_date' AND COALESCE(p_updates->>'due_date', '') <> COALESCE(v_row.due_date::text, '')) OR
         (p_updates ? 'notes' AND COALESCE(p_updates->>'notes', '') <> COALESCE(v_row.notes, '')) OR
         (p_updates ? 'receipt_s3_key' AND COALESCE(p_updates->>'receipt_s3_key', '') <> COALESCE(v_row.receipt_s3_key, '')) THEN
        v_content_changed := true;
      END IF;

      -- If review_ready was false and content actually changed, mark ready
      IF v_row.review_ready IS FALSE AND v_content_changed THEN
        v_new_review_ready := true;
      ELSE
        v_new_review_ready := v_row.review_ready;
      END IF;

      UPDATE public.disbursements
      SET category = CASE WHEN p_updates ? 'category' THEN p_updates->>'category' ELSE category END,
          description = CASE WHEN p_updates ? 'description' THEN p_updates->>'description' ELSE description END,
          amount = CASE WHEN p_updates ? 'amount' THEN (p_updates->>'amount')::numeric ELSE amount END,
          fund_source = CASE WHEN p_updates ? 'fund_source' THEN p_updates->>'fund_source' ELSE fund_source END,
          client_id = CASE WHEN p_updates ? 'client_id' THEN (p_updates->>'client_id')::uuid ELSE client_id END,
          linked_invoice_id = CASE WHEN p_updates ? 'linked_invoice_id' THEN (p_updates->>'linked_invoice_id')::uuid ELSE linked_invoice_id END,
          linked_work_request_id = CASE WHEN p_updates ? 'linked_work_request_id' THEN (p_updates->>'linked_work_request_id')::uuid ELSE linked_work_request_id END,
          linked_task_id = CASE WHEN p_updates ? 'linked_task_id' THEN (p_updates->>'linked_task_id')::uuid ELSE linked_task_id END,
          task_id = CASE WHEN p_updates ? 'task_id' THEN (p_updates->>'task_id')::uuid ELSE task_id END,
          linked_transmittal_id = CASE WHEN p_updates ? 'linked_transmittal_id' THEN (p_updates->>'linked_transmittal_id')::uuid ELSE linked_transmittal_id END,
          due_date = CASE WHEN p_updates ? 'due_date' THEN (p_updates->>'due_date')::date ELSE due_date END,
          notes = CASE WHEN p_updates ? 'notes' THEN p_updates->>'notes' ELSE notes END,
          receipt_s3_key = CASE WHEN p_updates ? 'receipt_s3_key' THEN p_updates->>'receipt_s3_key' ELSE receipt_s3_key END,
          receipt_filename = CASE WHEN p_updates ? 'receipt_filename' THEN p_updates->>'receipt_filename' ELSE receipt_filename END,
          print_details = CASE WHEN p_updates ? 'print_details' THEN (p_updates->'print_details') ELSE print_details END,
          review_ready = v_new_review_ready,
          version = version + 1,
          updated_by = p_user_id,
          updated_at = now()
      WHERE id = p_id
      RETURNING * INTO v_row;

      INSERT INTO public.status_history (
        table_name, record_id, old_status, new_status, actor_id, entity_id, details, created_at
      ) VALUES (
        'disbursements', p_id, v_row.status, v_row.status, p_user_id, p_entity_id,
        jsonb_build_object(
          'action', 'edit',
          'before', jsonb_build_object(
            'amount', v_old_row.amount,
            'category', v_old_row.category,
            'description', v_old_row.description,
            'fund_source', v_old_row.fund_source,
            'client_id', v_old_row.client_id,
            'linked_work_request_id', v_old_row.linked_work_request_id,
            'linked_task_id', v_old_row.linked_task_id,
            'due_date', v_old_row.due_date,
            'notes', v_old_row.notes,
            'receipt_s3_key', v_old_row.receipt_s3_key
          ),
          'after', p_updates,
          'content_changed', v_content_changed,
          'review_ready', v_new_review_ready,
          'previous_version', p_expected_version
        ),
        now()
      );

      RETURN NEXT v_row;
    END;
    $$;

    REVOKE EXECUTE ON FUNCTION public.disbursement_atomic_edit(uuid, uuid, uuid, jsonb, integer) FROM public, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.disbursement_atomic_edit(uuid, uuid, uuid, jsonb, integer) TO service_role, postgres;

    -- 10. Stored Procedure: disbursement_atomic_delete
    CREATE OR REPLACE FUNCTION public.disbursement_atomic_delete(
      p_id uuid,
      p_entity_id uuid,
      p_user_id uuid,
      p_expected_version integer
    )
    RETURNS SETOF public.disbursements
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_row disbursements%ROWTYPE;
      v_actor users%ROWTYPE;
      v_entity_code text;
      v_old_status text;
      v_now timestamptz := now();
      v_is_admin boolean := false;
      v_is_owner boolean := false;
    BEGIN
      IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
        RAISE EXCEPTION 'VERSION_REQUIRED' USING ERRCODE = 'P0001';
      END IF;

      SELECT * INTO v_actor FROM public.users WHERE id = p_user_id;
      IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
        RAISE EXCEPTION 'FORBIDDEN_INACTIVE_OR_INVALID_ACTOR' USING ERRCODE = '42501';
      END IF;

      SELECT code INTO v_entity_code FROM public.entities WHERE id = p_entity_id;
      IF NOT FOUND OR NOT COALESCE(v_entity_code = ANY(v_actor.entities), false) THEN
        RAISE EXCEPTION 'FORBIDDEN_ENTITY_ACCESS' USING ERRCODE = '42501';
      END IF;

      SELECT * INTO v_row
      FROM public.disbursements
      WHERE id = p_id AND entity_id = p_entity_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN;
      END IF;

      IF v_row.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'ALREADY_DELETED' USING ERRCODE = 'P0002';
      END IF;

      IF v_row.archived IS TRUE THEN
        RAISE EXCEPTION 'CANNOT_DELETE_ARCHIVED' USING ERRCODE = 'P0002';
      END IF;

      IF v_row.lifecycle_version <> 2 THEN
        RAISE EXCEPTION 'SAVED_WORKFLOW_READ_ONLY' USING ERRCODE = 'P0003';
      END IF;

      IF v_row.status <> 'Draft' THEN
        RAISE EXCEPTION 'CANNOT_DELETE_NON_DRAFT' USING ERRCODE = 'P0002';
      END IF;

      v_is_admin := v_actor.role = 'Admin';
      v_is_owner := (v_row.created_by = p_user_id OR v_row.requested_by = p_user_id);

      IF NOT (v_is_admin OR v_is_owner) THEN
        RAISE EXCEPTION 'FORBIDDEN_DELETE_PERMISSION' USING ERRCODE = '42501';
      END IF;

      IF v_row.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_CONCURRENCY_CONFLICT' USING ERRCODE = 'P0001';
      END IF;

      v_old_status := v_row.status;

      UPDATE public.disbursements
      SET deleted_at = v_now,
          updated_at = v_now,
          updated_by = p_user_id,
          version = version + 1
      WHERE id = p_id
      RETURNING * INTO v_row;

      INSERT INTO public.status_history (
        table_name, record_id, old_status, new_status, actor_id, entity_id, details, created_at
      ) VALUES (
        'disbursements', p_id, v_old_status, 'Deleted', p_user_id, p_entity_id,
        jsonb_build_object(
          'action', 'delete',
          'previous_status', v_old_status,
          'previous_version', p_expected_version,
          'deleted_at', v_now
        ),
        v_now
      );

      RETURN NEXT v_row;
    END;
    $$;

    REVOKE EXECUTE ON FUNCTION public.disbursement_atomic_delete(uuid, uuid, uuid, integer) FROM public, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.disbursement_atomic_delete(uuid, uuid, uuid, integer) TO service_role, postgres;

    -- 11. AFTER INSERT Trigger: insert initial status_history row for v2 disbursements atomically
    CREATE OR REPLACE FUNCTION public.trg_disbursement_initial_history()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_actor users%ROWTYPE;
      v_entity_code text;
    BEGIN
      IF NEW.lifecycle_version = 2 THEN
        IF NEW.created_by IS NOT NULL THEN
          SELECT * INTO v_actor FROM public.users WHERE id = NEW.created_by;
          IF NOT FOUND OR v_actor.is_active IS NOT TRUE THEN
            RAISE EXCEPTION 'FORBIDDEN_INACTIVE_OR_INVALID_ACTOR' USING ERRCODE = '42501';
          END IF;

          SELECT code INTO v_entity_code FROM public.entities WHERE id = NEW.entity_id;
          IF NOT FOUND OR NOT COALESCE(v_entity_code = ANY(v_actor.entities), false) THEN
            RAISE EXCEPTION 'FORBIDDEN_ENTITY_ACCESS' USING ERRCODE = '42501';
          END IF;
        END IF;

        INSERT INTO public.status_history (
          table_name,
          record_id,
          old_status,
          new_status,
          actor_id,
          entity_id,
          details,
          created_at
        ) VALUES (
          'disbursements',
          NEW.id,
          NULL,
          NEW.status,
          NEW.created_by,
          NEW.entity_id,
          jsonb_strip_nulls(jsonb_build_object(
            'action', 'create',
            'amount', NEW.amount,
            'category', NEW.category,
            'description', NEW.description,
            'disbursement_number', NEW.disbursement_number,
            'review_ready', NEW.review_ready,
            'lifecycle_version', NEW.lifecycle_version,
            'receipt_filename', NEW.receipt_filename,
            'receipt_s3_key', NEW.receipt_s3_key
          )),
          COALESCE(NEW.created_at, now())
        );
      END IF;

      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_disbursement_insert_history ON public.disbursements;
    CREATE TRIGGER trg_disbursement_insert_history
      AFTER INSERT ON public.disbursements
      FOR EACH ROW
      EXECUTE FUNCTION public.trg_disbursement_initial_history();
  `);
};

// Reverting these columns/RPCs would discard workflow and audit information.
// Restore a verified backup or use a separately reviewed forward migration instead.
exports.down = () => {
  throw new Error('Disbursement lifecycle rollback requires a reviewed recovery plan; automatic destructive rollback is disabled');
};
