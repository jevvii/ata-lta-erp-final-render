/** @type {import('node-pg-migrate').Migration} */
exports.up = async (pgm) => {
  await pgm.sql(`
    CREATE OR REPLACE FUNCTION public.get_dashboard_summary(p_entity_id uuid)
    RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    DECLARE
      v_today date := current_date;
      v_later date := current_date + interval '30 days';
      v_entity_code text;
      result jsonb;
    BEGIN
      SELECT code INTO v_entity_code
      FROM public.entities
      WHERE id = p_entity_id;

      SELECT jsonb_build_object(
        'clients', jsonb_build_object('total', COALESCE(s.clients_total, 0)),
        'workRequests', jsonb_build_object('total', COALESCE(s.wr_total, 0)),
        'documents', jsonb_build_object('total', COALESCE(s.doc_total, 0)),
        'invoices', jsonb_build_object(
          'total', COALESCE(s.inv_total, 0),
          'totalBilled', COALESCE(s.inv_total_billed, 0),
          'totalCollected', COALESCE(s.inv_total_collected, 0),
          'totalOutstanding', COALESCE(s.inv_total_outstanding, 0),
          'byStatus', COALESCE(s.inv_by_status, '{}'::jsonb)
        ),
        'disbursements', jsonb_build_object(
          'total', COALESCE(s.disb_total, 0),
          'totalAmount', COALESCE(s.disb_total_amount, 0),
          'releasedAmount', COALESCE(s.disb_released_amount, 0),
          'byStatus', COALESCE(s.disb_by_status, '{}'::jsonb)
        ),
        'transmittals', jsonb_build_object(
          'total', COALESCE(s.tran_total, 0),
          'byStatus', COALESCE(s.tran_by_status, '{}'::jsonb)
        ),
        'revenue', jsonb_build_object(
          'totalBilled', COALESCE(s.inv_total_billed, 0),
          'totalCollected', COALESCE(s.inv_total_collected, 0),
          'totalOutstanding', COALESCE(s.inv_total_outstanding, 0),
          'totalExpenses', COALESCE(s.disb_released_amount, 0),
          'netIncome', COALESCE(s.inv_total_collected - s.disb_released_amount, 0)
        ),
        'calendar', COALESCE(cal.items, '[]'::jsonb)
      ) INTO result
      FROM (
        SELECT
          (SELECT COUNT(*) FROM public.clients WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS clients_total,
          (SELECT COUNT(*) FROM public.work_requests WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS wr_total,
          (SELECT COUNT(*) FROM public.documents WHERE entity_id = p_entity_id AND deleted_at IS NULL AND status = 'active') AS doc_total,
          (SELECT COUNT(*) FROM public.invoices WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS inv_total,
          (SELECT COALESCE(SUM(total), 0) FROM public.invoices WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS inv_total_billed,
          (SELECT COALESCE(SUM(amount_paid), 0) FROM public.invoices WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS inv_total_collected,
          (SELECT COALESCE(SUM(balance), 0) FROM public.invoices WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS inv_total_outstanding,
          (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
           FROM (
             SELECT status, COUNT(*) AS cnt
             FROM public.invoices
             WHERE entity_id = p_entity_id AND deleted_at IS NULL
             GROUP BY status
           ) x
          ) AS inv_by_status,
          (SELECT COUNT(*) FROM public.disbursements WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS disb_total,
          (SELECT COALESCE(SUM(amount), 0) FROM public.disbursements WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS disb_total_amount,
          (SELECT COALESCE(SUM(amount), 0) FROM public.disbursements WHERE entity_id = p_entity_id AND deleted_at IS NULL AND status = 'Released') AS disb_released_amount,
          (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
           FROM (
             SELECT status, COUNT(*) AS cnt
             FROM public.disbursements
             WHERE entity_id = p_entity_id AND deleted_at IS NULL
             GROUP BY status
           ) x
          ) AS disb_by_status,
          (SELECT COUNT(*) FROM public.transmittals WHERE entity_id = p_entity_id AND deleted_at IS NULL) AS tran_total,
          (SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
           FROM (
             SELECT status, COUNT(*) AS cnt
             FROM public.transmittals
             WHERE entity_id = p_entity_id AND deleted_at IS NULL
             GROUP BY status
           ) x
          ) AS tran_by_status
      ) s
      CROSS JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(item ORDER BY (item->>'dueDate')), '[]'::jsonb) AS items
        FROM (
          SELECT jsonb_build_object(
            'id', wr.id,
            'type', 'wr',
            'title', wr.title,
            'status', wr.status,
            'dueDate', wr.due_date::text,
            'clientId', wr.client_id,
            'assigneeId', COALESCE(wr.assigned_to, wr.requested_by),
            'entity', v_entity_code,
            'tasks', COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', t.id,
                'title', t.title,
                'status', t.status,
                'assigneeId', t.assignee_id,
                'assigneeName', t.assignee_name,
                'dueDate', t.due_date::text
              ) ORDER BY t.display_order, t.id)
              FROM public.tasks t
              WHERE t.work_request_id = wr.id AND t.deleted_at IS NULL
            ), '[]'::jsonb)
          ) AS item
          FROM public.work_requests wr
          WHERE wr.entity_id = p_entity_id
            AND wr.deleted_at IS NULL
            AND wr.due_date IS NOT NULL
            AND (
              (wr.due_date >= v_today AND wr.due_date <= v_later)
              OR (wr.due_date < v_today AND wr.status IN ('Draft', 'In Progress', 'For Review'))
            )
          UNION ALL
          SELECT jsonb_build_object(
            'id', d.id,
            'type', 'db',
            'title', COALESCE(d.disbursement_number, 'Disbursement'),
            'status', d.status,
            'dueDate', d.due_date::text,
            'clientId', d.client_id,
            'entity', v_entity_code,
            'amount', d.amount
          ) AS item
          FROM public.disbursements d
          WHERE d.entity_id = p_entity_id
            AND d.deleted_at IS NULL
            AND d.due_date IS NOT NULL
            AND (
              (d.due_date >= v_today AND d.due_date <= v_later)
              OR (d.due_date < v_today AND d.status IN ('Draft', 'Pending', 'Approved'))
            )
        ) combined
      ) cal;

      RETURN result;
    END;
    $$;
  `);
};

/** @type {import('node-pg-migrate').Migration} */
exports.down = async (pgm) => {
  await pgm.sql(`DROP FUNCTION IF EXISTS public.get_dashboard_summary(uuid);`);
};
