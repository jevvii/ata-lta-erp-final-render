/** @type {import('node-pg-migrate').Migration} */
exports.up = (pgm) => {
  pgm.sql(`
    -- 1.1 Generic disbursement state-machine transition.
    -- Returns zero rows when the expected from_status does not match (race/invalid transition).
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

    -- 1.2 Generic work-request transition. Returns zero rows on stale state.
    CREATE OR REPLACE FUNCTION public.work_request_transition(
      p_id uuid,
      p_from_status text,
      p_to_status text,
      p_user_id uuid,
      p_entity_id uuid,
      p_archived boolean DEFAULT NULL
    )
    RETURNS SETOF work_requests
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      UPDATE work_requests
      SET status = p_to_status,
          updated_by = p_user_id,
          updated_at = now(),
          version = version + 1,
          archived = COALESCE(p_archived, archived)
      WHERE id = p_id
        AND entity_id = p_entity_id
        AND status = ANY(p_from_statuses)
      RETURNING *;
    END;
    $$;

    -- 1.2 Generic task transition. Returns zero rows on stale state.
    CREATE OR REPLACE FUNCTION public.task_transition(
      p_id uuid,
      p_work_request_id uuid,
      p_from_status text,
      p_to_status text,
      p_user_id uuid
    )
    RETURNS SETOF tasks
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      UPDATE tasks
      SET status = p_to_status,
          updated_at = now(),
          version = version + 1
      WHERE id = p_id
        AND work_request_id = p_work_request_id
        AND status = ANY(p_from_statuses)
      RETURNING *;
    END;
    $$;

    -- 1.3 Fulfill an operations request atomically.
    CREATE OR REPLACE FUNCTION public.operations_request_fulfill(
      p_id uuid,
      p_fulfilled_by uuid,
      p_entity_id uuid
    )
    RETURNS SETOF operations_requests
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      UPDATE operations_requests
      SET status = 'fulfilled',
          fulfilled_by = p_fulfilled_by,
          fulfilled_at = now(),
          updated_at = now(),
          version = version + 1
      WHERE id = p_id
        AND entity_id = p_entity_id
        AND status = 'pending'
      RETURNING *;
    END;
    $$;

    -- 1.3 Reject an operations request atomically.
    CREATE OR REPLACE FUNCTION public.operations_request_reject(
      p_id uuid,
      p_rejection_reason text,
      p_user_id uuid,
      p_entity_id uuid
    )
    RETURNS SETOF operations_requests
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      UPDATE operations_requests
      SET status = 'rejected',
          rejection_reason = p_rejection_reason,
          updated_at = now(),
          version = version + 1
      WHERE id = p_id
        AND entity_id = p_entity_id
        AND status = 'pending'
      RETURNING *;
    END;
    $$;

    -- 1.4 Approve a pending change atomically. Side effects remain orchestrated in Node,
    -- but the status flip is guarded so only one caller can win.
    CREATE OR REPLACE FUNCTION public.pending_change_approve(
      p_id uuid,
      p_user_id uuid,
      p_entity_id uuid
    )
    RETURNS SETOF pending_changes
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    BEGIN
      RETURN QUERY
      UPDATE pending_changes
      SET status = 'approved',
          reviewed_by = p_user_id,
          reviewed_at = now(),
          version = version + 1
      WHERE id = p_id
        AND entity_id = p_entity_id
        AND status = 'pending'
      RETURNING *;
    END;
    $$;

    -- 1.5 Record an invoice payment atomically; reject overpayments.
    CREATE OR REPLACE FUNCTION public.invoice_record_payment(
      p_invoice_id uuid,
      p_amount numeric,
      p_method text,
      p_reference text,
      p_payment_date date,
      p_recorded_by uuid,
      p_entity_id uuid,
      p_notes text DEFAULT NULL
    )
    RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_invoice invoices%ROWTYPE;
      v_payment invoice_payments%ROWTYPE;
      v_total_paid numeric;
      v_balance numeric;
      v_status text;
    BEGIN
      SELECT * INTO v_invoice
      FROM invoices
      WHERE id = p_invoice_id
        AND entity_id = p_entity_id
        AND deleted_at IS NULL
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found' USING ERRCODE = 'P0002';
      END IF;

      INSERT INTO invoice_payments (
        invoice_id, amount, method, reference, payment_date, recorded_by, notes
      ) VALUES (
        p_invoice_id, p_amount, p_method, p_reference, p_payment_date, p_recorded_by, p_notes
      ) RETURNING * INTO v_payment;

      SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
      FROM invoice_payments
      WHERE invoice_id = p_invoice_id;

      v_balance := v_invoice.total - v_total_paid;

      IF v_balance < 0 THEN
        RAISE EXCEPTION 'Overpayment: payment would exceed invoice balance'
          USING ERRCODE = 'P0001', DETAIL = format('total_paid=%s, total=%s', v_total_paid, v_invoice.total);
      END IF;

      IF v_balance = 0 THEN
        v_status := 'Paid';
      ELSE
        v_status := 'Partially Paid';
      END IF;

      UPDATE invoices
      SET amount_paid = v_total_paid,
          balance = v_balance,
          status = v_status,
          updated_at = now(),
          updated_by = p_recorded_by,
          version = version + 1
      WHERE id = p_invoice_id;

      -- Refresh the locked row to return the latest values
      SELECT * INTO v_invoice
      FROM invoices
      WHERE id = p_invoice_id;

      RETURN jsonb_build_object(
        'payment', row_to_json(v_payment),
        'invoice', row_to_json(v_invoice)
      );
    END;
    $$;

    -- 1.6 Archive a client and cascade to its work requests / documents atomically.
    CREATE OR REPLACE FUNCTION public.client_archive_cascade(
      p_id uuid,
      p_user_id uuid,
      p_entity_id uuid,
      p_unarchive boolean DEFAULT FALSE
    )
    RETURNS SETOF clients
    LANGUAGE plpgsql
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_status text;
      v_deleted_at timestamptz;
    BEGIN
      IF p_unarchive THEN
        v_status := 'Active';
        v_deleted_at := NULL;
      ELSE
        v_status := 'Archived';
        v_deleted_at := now();
      END IF;

      RETURN QUERY
      WITH updated_client AS (
        UPDATE clients
        SET status = v_status,
            deleted_at = v_deleted_at,
            archived_at = CASE WHEN p_unarchive THEN NULL ELSE now() END,
            archived_by = CASE WHEN p_unarchive THEN NULL ELSE p_user_id END,
            updated_by = p_user_id,
            updated_at = now(),
            version = version + 1
        WHERE id = p_id
          AND entity_id = p_entity_id
        RETURNING *
      ),
      updated_work_requests AS (
        UPDATE work_requests
        SET status = CASE WHEN p_unarchive THEN status ELSE 'Cancelled' END,
            updated_at = now(),
            updated_by = p_user_id,
            version = version + 1
        FROM updated_client
        WHERE work_requests.client_id = updated_client.id
          AND work_requests.entity_id = p_entity_id
        RETURNING work_requests.id
      )
      UPDATE documents
      SET status = CASE WHEN p_unarchive THEN status ELSE 'Archived' END,
          archived = CASE WHEN p_unarchive THEN archived ELSE TRUE END,
          archived_at = CASE WHEN p_unarchive THEN archived_at ELSE now() END,
          archived_by = CASE WHEN p_unarchive THEN archived_by ELSE p_user_id END,
          updated_at = now(),
          version = version + 1
      FROM updated_work_requests
      WHERE documents.work_request_id = updated_work_requests.id
        AND documents.entity_id = p_entity_id;

      RETURN QUERY SELECT * FROM clients WHERE id = p_id AND entity_id = p_entity_id;
    END;
    $$;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION IF EXISTS public.client_archive_cascade(uuid, uuid, uuid, boolean);
    DROP FUNCTION IF EXISTS public.invoice_record_payment(uuid, numeric, text, text, date, uuid, uuid, text);
    DROP FUNCTION IF EXISTS public.pending_change_approve(uuid, uuid, uuid);
    DROP FUNCTION IF EXISTS public.operations_request_reject(uuid, text, uuid, uuid);
    DROP FUNCTION IF EXISTS public.operations_request_fulfill(uuid, uuid, uuid);
    DROP FUNCTION IF EXISTS public.task_transition(uuid, uuid, text, text, uuid);
    DROP FUNCTION IF EXISTS public.work_request_transition(uuid, text, text, uuid, uuid, boolean);
    DROP FUNCTION IF EXISTS public.disbursement_transition(uuid, text, text, uuid, uuid, text, jsonb);
  `);
};
