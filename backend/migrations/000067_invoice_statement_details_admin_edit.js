/** Persist statement fields and allow administrators to correct released invoices atomically. */
exports.up = (pgm) => {
  pgm.sql(
    `ALTER TABLE public.invoices ADD COLUMN print_details jsonb NOT NULL DEFAULT '{}'::jsonb;`
  );
  pgm.sql(`
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
      v_is_admin boolean := false;
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

      SELECT EXISTS(SELECT 1 FROM users WHERE id = p_user_id AND role = 'Admin') INTO v_is_admin;
      IF p_updates ? 'print_details' AND NOT v_is_admin THEN
        RAISE EXCEPTION 'Only administrators can edit statement details' USING ERRCODE = '42501';
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

      IF v_is_financial AND v_invoice.status <> 'Draft' AND NOT v_is_admin THEN
        RAISE EXCEPTION 'INVOICE_NOT_DRAFT: Cannot modify financial fields or line items of non-draft invoice (current status %)',
          v_invoice.status
          USING ERRCODE = 'P0002';
      END IF;

      -- STEP 4: Mutate child line items safely
      IF p_line_items IS NOT NULL THEN
        SELECT COALESCE(SUM(round((item->>'amount')::numeric, 2)), 0) INTO v_subtotal
        FROM jsonb_array_elements(p_line_items) item;
        IF v_subtotal < COALESCE(v_invoice.amount_paid, 0) THEN
          RAISE EXCEPTION 'INVOICE_TOTAL_BELOW_PAID' USING ERRCODE = '22023';
        END IF;

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
        status                = CASE
          WHEN p_updates ? 'status' THEN p_updates->>'status'
          WHEN v_subtotal IS NOT NULL AND amount_paid > 0 AND status IN ('Paid', 'Partially Paid', 'Sent', 'Approved', 'Overdue')
            THEN CASE WHEN v_subtotal = amount_paid THEN 'Paid' ELSE 'Partially Paid' END
          ELSE status END,
        print_details         = CASE WHEN p_updates ? 'print_details' THEN p_updates->'print_details' ELSE print_details END,
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
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
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
  `);
  pgm.sql('ALTER TABLE public.invoices DROP COLUMN print_details;');
};
