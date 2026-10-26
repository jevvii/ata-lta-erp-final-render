/**
 * Migration 000066: Repair invoice_update_transactional OCC & Atomicity Contract (Defect D3 / R4)
 * and update disbursement_transition to enforce expected_version and direct approval attribution (Defect D2 / R3).
 *
 * Requirements:
 * 1. Lock invoice parent row exclusively with FOR UPDATE and verify entity before child mutation.
 * 2. Enforce p_expected_version before line-item deletions (raises ERR_CONCURRENCY_CONFLICT on mismatch).
 * 3. Enforce Draft status check before financial field or line-item mutations (raises INVOICE_NOT_DRAFT on mismatch).
 * 4. Atomically delete and replace line items, recalculate totals, bump version.
 * 5. Update disbursement_transition to accept p_expected_version and set approval & release attribution on direct release.
 * 6. Provide reversible down migration restoring 000057 and 000033 definitions.
 *
 * @type {import('node-pg-migrate').Migration}
 */

exports.up = (pgm) => {
  pgm.sql(`
    -- 1. Repaired invoice_update_transactional
    CREATE OR REPLACE FUNCTION public.invoice_update_transactional(
      p_invoice_id uuid,
      p_updates jsonb,
      p_line_items jsonb,
      p_user_id uuid,
      p_entity_id uuid,
      p_expected_version integer DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_invoice invoices%ROWTYPE;
      v_item jsonb;
      v_idx integer := 0;
      v_subtotal numeric;
      v_has_task_update boolean := false;
      v_effective_task_id uuid := NULL;
      v_is_financial boolean := false;
    BEGIN
      -- STEP 1: Lock parent row exclusively and verify entity
      SELECT * INTO v_invoice
      FROM invoices
      WHERE id = p_invoice_id AND entity_id = p_entity_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RETURN NULL;
      END IF;

      -- STEP 2: Verify OCC version lock BEFORE any child mutation
      IF p_expected_version IS NOT NULL AND v_invoice.version <> p_expected_version THEN
        RAISE EXCEPTION 'ERR_CONCURRENCY_CONFLICT: Invoice version mismatch (expected %, found %)',
          p_expected_version, v_invoice.version
          USING ERRCODE = 'P0001';
      END IF;

      -- STEP 3: Verify Draft status if line items or financial fields are modified
      v_is_financial := (p_line_items IS NOT NULL) OR
                        (p_updates ? 'client_id') OR
                        (p_updates ? 'work_request_id') OR
                        (p_updates ? 'task_id') OR
                        (p_updates ? 'linked_task_id') OR
                        (p_updates ? 'taskId') OR
                        (p_updates ? 'linkedTaskId') OR
                        (p_updates ? 'linked_transmittal_id') OR
                        (p_updates ? 'invoice_number') OR
                        (p_updates ? 'issue_date') OR
                        (p_updates ? 'due_date') OR
                        (p_updates ? 'terms');

      IF v_is_financial AND v_invoice.status <> 'Draft' THEN
        RAISE EXCEPTION 'INVOICE_NOT_DRAFT: Cannot modify financial fields or line items of non-draft invoice (current status %)',
          v_invoice.status
          USING ERRCODE = 'P0002';
      END IF;

      -- STEP 4: Mutate child line items safely
      IF p_line_items IS NOT NULL THEN
        DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id;

        FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
        LOOP
          INSERT INTO invoice_line_items (
            invoice_id, description, amount, type, sort_order
          ) VALUES (
            p_invoice_id,
            v_item->>'description',
            (v_item->>'amount')::numeric,
            COALESCE(v_item->>'type', 'Professional Fee'),
            v_idx
          );
          v_idx := v_idx + 1;
        END LOOP;

        SELECT COALESCE(SUM(amount), 0) INTO v_subtotal
        FROM invoice_line_items
        WHERE invoice_id = p_invoice_id;
      END IF;

      -- STEP 5: Task ID handling
      IF (p_updates ? 'task_id') OR (p_updates ? 'linked_task_id') OR (p_updates ? 'taskId') OR (p_updates ? 'linkedTaskId') THEN
        v_has_task_update := true;
        v_effective_task_id := COALESCE(
          (p_updates->>'task_id')::uuid,
          (p_updates->>'taskId')::uuid,
          (p_updates->>'linked_task_id')::uuid,
          (p_updates->>'linkedTaskId')::uuid
        );
      END IF;

      -- STEP 6: Update invoice parent row and bump version
      UPDATE invoices SET
        client_id             = CASE WHEN p_updates ? 'client_id'             THEN (p_updates->>'client_id')::uuid   ELSE client_id END,
        work_request_id       = CASE WHEN p_updates ? 'work_request_id'       THEN (p_updates->>'work_request_id')::uuid ELSE work_request_id END,
        linked_task_id        = CASE WHEN v_has_task_update                   THEN v_effective_task_id               ELSE linked_task_id END,
        task_id               = CASE WHEN v_has_task_update                   THEN v_effective_task_id               ELSE task_id END,
        linked_transmittal_id = CASE WHEN p_updates ? 'linked_transmittal_id' THEN (p_updates->>'linked_transmittal_id')::uuid ELSE linked_transmittal_id END,
        invoice_number        = CASE WHEN p_updates ? 'invoice_number'        THEN p_updates->>'invoice_number'      ELSE invoice_number END,
        issue_date            = CASE WHEN p_updates ? 'issue_date'            THEN (p_updates->>'issue_date')::date  ELSE issue_date END,
        due_date              = CASE WHEN p_updates ? 'due_date'              THEN (p_updates->>'due_date')::date    ELSE due_date END,
        status                = CASE WHEN p_updates ? 'status'                THEN p_updates->>'status'              ELSE status END,
        notes                 = CASE WHEN p_updates ? 'notes'                 THEN p_updates->>'notes'               ELSE notes END,
        terms                 = CASE WHEN p_updates ? 'terms'                 THEN p_updates->>'terms'               ELSE terms END,
        address               = CASE WHEN p_updates ? 'address'               THEN p_updates->>'address'             ELSE address END,
        archived              = CASE WHEN p_updates ? 'archived'              THEN (p_updates->>'archived')::boolean ELSE archived END,
        subtotal              = COALESCE(v_subtotal, subtotal),
        total                 = COALESCE(v_subtotal, total),
        balance               = CASE WHEN v_subtotal IS NOT NULL THEN v_subtotal - amount_paid ELSE balance END,
        updated_by            = p_user_id,
        updated_at            = now(),
        version               = version + 1
      WHERE id = p_invoice_id
      RETURNING * INTO v_invoice;

      RETURN to_jsonb(v_invoice);
    END;
    $$;

    -- 2. Updated disbursement_transition with p_expected_version and direct release attribution
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
    RETURNS SETOF disbursements
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      UPDATE disbursements
      SET status = p_to_status,
          updated_by = p_user_id,
          updated_at = now(),
          version = version + 1,
          approved_by = CASE
            WHEN p_to_status IN ('Approved', 'Released') AND approved_by IS NULL THEN p_user_id
            ELSE approved_by
          END,
          approved_at = CASE
            WHEN p_to_status IN ('Approved', 'Released') AND approved_at IS NULL THEN now()
            ELSE approved_at
          END,
          released_by = CASE WHEN p_to_status = 'Released' THEN p_user_id ELSE released_by END,
          released_at = CASE WHEN p_to_status = 'Released' THEN now() ELSE released_at END,
          funded_by = CASE WHEN p_to_status = 'Funded' THEN p_user_id ELSE funded_by END,
          funded_at = CASE WHEN p_to_status = 'Funded' THEN now() ELSE funded_at END,
          rejected_by = CASE WHEN p_to_status = 'Rejected' THEN p_user_id ELSE rejected_by END,
          rejected_at = CASE WHEN p_to_status = 'Rejected' THEN now() ELSE rejected_at END,
          rejection_reason = CASE WHEN p_to_status = 'Rejected' THEN p_reason ELSE rejection_reason END,
          payment_method = CASE WHEN p_to_status = 'Released'
                                THEN COALESCE(p_payment_details->>'method', payment_method)
                                ELSE payment_method END,
          payment_reference = CASE WHEN p_to_status = 'Released'
                                   THEN COALESCE(p_payment_details->>'reference', payment_reference)
                                   ELSE payment_reference END,
          payment_bank = CASE WHEN p_to_status = 'Released'
                              THEN COALESCE(p_payment_details->>'bank', payment_bank)
                              ELSE payment_bank END,
          payment_date = CASE WHEN p_to_status = 'Released'
                              THEN COALESCE((p_payment_details->>'date')::date, payment_date)
                              ELSE payment_date END,
          payment_processed_by = CASE WHEN p_to_status = 'Released' THEN p_user_id ELSE payment_processed_by END
      WHERE id = p_id
        AND entity_id = p_entity_id
        AND status = ANY(p_from_statuses)
        AND (p_expected_version IS NULL OR version = p_expected_version)
      RETURNING *;
    END;
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Revert invoice_update_transactional to migration 000057 definition
    CREATE OR REPLACE FUNCTION public.invoice_update_transactional(
      p_invoice_id uuid,
      p_updates jsonb,
      p_line_items jsonb,
      p_user_id uuid,
      p_entity_id uuid,
      p_expected_version integer DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_invoice invoices%ROWTYPE;
      v_item jsonb;
      v_idx integer := 0;
      v_subtotal numeric;
      v_has_task_update boolean := false;
      v_effective_task_id uuid := NULL;
    BEGIN
      IF p_line_items IS NOT NULL THEN
        DELETE FROM invoice_line_items WHERE invoice_id = p_invoice_id;

        FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items)
        LOOP
          INSERT INTO invoice_line_items (
            invoice_id, description, amount, type, sort_order
          ) VALUES (
            p_invoice_id,
            v_item->>'description',
            (v_item->>'amount')::numeric,
            COALESCE(v_item->>'type', 'Professional Fee'),
            v_idx
          );
          v_idx := v_idx + 1;
        END LOOP;

        SELECT COALESCE(SUM(amount), 0) INTO v_subtotal
        FROM invoice_line_items
        WHERE invoice_id = p_invoice_id;
      END IF;

      IF (p_updates ? 'task_id') OR (p_updates ? 'linked_task_id') OR (p_updates ? 'taskId') OR (p_updates ? 'linkedTaskId') THEN
        v_has_task_update := true;
        v_effective_task_id := COALESCE(
          (p_updates->>'task_id')::uuid,
          (p_updates->>'taskId')::uuid,
          (p_updates->>'linked_task_id')::uuid,
          (p_updates->>'linkedTaskId')::uuid
        );
      END IF;

      UPDATE invoices SET
        client_id             = CASE WHEN p_updates ? 'client_id'             THEN (p_updates->>'client_id')::uuid   ELSE client_id END,
        work_request_id       = CASE WHEN p_updates ? 'work_request_id'       THEN (p_updates->>'work_request_id')::uuid ELSE work_request_id END,
        linked_task_id        = CASE WHEN v_has_task_update                   THEN v_effective_task_id               ELSE linked_task_id END,
        task_id               = CASE WHEN v_has_task_update                   THEN v_effective_task_id               ELSE task_id END,
        linked_transmittal_id = CASE WHEN p_updates ? 'linked_transmittal_id' THEN (p_updates->>'linked_transmittal_id')::uuid ELSE linked_transmittal_id END,
        invoice_number        = CASE WHEN p_updates ? 'invoice_number'        THEN p_updates->>'invoice_number'      ELSE invoice_number END,
        issue_date            = CASE WHEN p_updates ? 'issue_date'            THEN (p_updates->>'issue_date')::date  ELSE issue_date END,
        due_date              = CASE WHEN p_updates ? 'due_date'              THEN (p_updates->>'due_date')::date    ELSE due_date END,
        status                = CASE WHEN p_updates ? 'status'                THEN p_updates->>'status'              ELSE status END,
        notes                 = CASE WHEN p_updates ? 'notes'                 THEN p_updates->>'notes'               ELSE notes END,
        terms                 = CASE WHEN p_updates ? 'terms'                 THEN p_updates->>'terms'               ELSE terms END,
        archived              = CASE WHEN p_updates ? 'archived'              THEN (p_updates->>'archived')::boolean ELSE archived END,
        subtotal              = COALESCE(v_subtotal, subtotal),
        total                 = COALESCE(v_subtotal, total),
        balance               = CASE WHEN v_subtotal IS NOT NULL THEN v_subtotal - amount_paid ELSE balance END,
        updated_by            = p_user_id,
        updated_at            = now(),
        version               = version + 1
      WHERE id = p_invoice_id
        AND entity_id = p_entity_id
        AND (p_expected_version IS NULL OR version = p_expected_version)
      RETURNING * INTO v_invoice;

      IF NOT FOUND THEN
        RETURN NULL;
      END IF;

      RETURN to_jsonb(v_invoice);
    END;
    $$;

    -- Revert disbursement_transition to migration 000033 definition
    CREATE OR REPLACE FUNCTION public.disbursement_transition(
      p_id uuid,
      p_from_statuses text[],
      p_to_status text,
      p_user_id uuid,
      p_entity_id uuid,
      p_reason text DEFAULT NULL,
      p_payment_details jsonb DEFAULT NULL
    )
    RETURNS SETOF disbursements
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      UPDATE disbursements
      SET status = p_to_status,
          updated_by = p_user_id,
          updated_at = now(),
          version = version + 1,
          approved_by = CASE WHEN p_to_status = 'Approved' THEN p_user_id ELSE approved_by END,
          approved_at = CASE WHEN p_to_status = 'Approved' THEN now() ELSE approved_at END,
          released_by = CASE WHEN p_to_status = 'Released' THEN p_user_id ELSE released_by END,
          released_at = CASE WHEN p_to_status = 'Released' THEN now() ELSE released_at END,
          funded_by = CASE WHEN p_to_status = 'Funded' THEN p_user_id ELSE funded_by END,
          funded_at = CASE WHEN p_to_status = 'Funded' THEN now() ELSE funded_at END,
          rejected_by = CASE WHEN p_to_status = 'Rejected' THEN p_user_id ELSE rejected_by END,
          rejected_at = CASE WHEN p_to_status = 'Rejected' THEN now() ELSE rejected_at END,
          rejection_reason = CASE WHEN p_to_status = 'Rejected' THEN p_reason ELSE rejection_reason END,
          payment_method = CASE WHEN p_to_status = 'Released'
                                THEN COALESCE(p_payment_details->>'method', payment_method)
                                ELSE payment_method END,
          payment_reference = CASE WHEN p_to_status = 'Released'
                                   THEN COALESCE(p_payment_details->>'reference', payment_reference)
                                   ELSE payment_reference END,
          payment_bank = CASE WHEN p_to_status = 'Released'
                              THEN COALESCE(p_payment_details->>'bank', payment_bank)
                              ELSE payment_bank END,
          payment_date = CASE WHEN p_to_status = 'Released'
                              THEN COALESCE((p_payment_details->>'date')::date, payment_date)
                              ELSE payment_date END,
          payment_processed_by = CASE WHEN p_to_status = 'Released' THEN p_user_id ELSE payment_processed_by END
      WHERE id = p_id
        AND entity_id = p_entity_id
        AND status = ANY(p_from_statuses)
      RETURNING *;
    END;
    $$;
  `);
};
