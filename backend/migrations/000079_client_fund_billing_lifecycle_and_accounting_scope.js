/**
 * Migration 000079: Client fund billing lifecycle and accounting scope RLS update.
 *
 * Scopes non-Admin Accounting users so they can only SELECT disbursements
 * that are in ('Approved', 'Funded', 'Released') or that they created / requested.
 */
exports.up = (pgm) => {
  pgm.sql(`
    -- Overload public.disbursement_visible_to_session with 4 arguments:
    -- (entity_id, created_by, requested_by, status)
    CREATE OR REPLACE FUNCTION public.disbursement_visible_to_session(
      p_entity_id uuid,
      p_created_by uuid,
      p_requested_by uuid,
      p_status text
    ) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      SELECT EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.entities e ON e.id = p_entity_id
        WHERE u.auth_user_id::text = (
          NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        )
          AND u.is_active IS TRUE
          AND e.code = ANY(u.entities)
          AND (
            u.role = 'Admin'
            OR (
              -- Accounting user: Approved, Funded, Released OR own draft/request
              (
                u.role = 'Accounting'
                OR EXISTS (
                  SELECT 1 FROM public.user_departments ud
                  JOIN public.departments d ON d.id = ud.department_id
                  WHERE ud.user_id = u.id AND lower(d.name) = 'accounting'
                )
              )
              AND (
                p_status IN ('Approved', 'Funded', 'Released')
                OR u.id = p_created_by
                OR u.id = p_requested_by
              )
            )
            OR (
              -- Other non-admin users: only their own created/requested items
              u.role NOT IN ('Admin', 'Accounting')
              AND NOT EXISTS (
                SELECT 1 FROM public.user_departments ud
                JOIN public.departments d ON d.id = ud.department_id
                WHERE ud.user_id = u.id AND lower(d.name) = 'accounting'
              )
              AND (u.id = p_created_by OR u.id = p_requested_by)
            )
          )
      );
    $$;

    -- Backwards-compatible 2-argument wrapper
    CREATE OR REPLACE FUNCTION public.disbursement_visible_to_session(
      p_entity_id uuid,
      p_created_by uuid
    ) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
      SELECT public.disbursement_visible_to_session(p_entity_id, p_created_by, NULL::uuid, NULL::text);
    $$;

    REVOKE ALL ON FUNCTION public.disbursement_visible_to_session(uuid, uuid, uuid, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.disbursement_visible_to_session(uuid, uuid, uuid, text)
      TO anon, authenticated, service_role;

    REVOKE ALL ON FUNCTION public.disbursement_visible_to_session(uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.disbursement_visible_to_session(uuid, uuid)
      TO anon, authenticated, service_role;

    -- Update read policies on public.disbursements
    DROP POLICY IF EXISTS disbursement_session_read ON public.disbursements;
    DROP POLICY IF EXISTS disbursement_session_read_guard ON public.disbursements;

    CREATE POLICY disbursement_session_read ON public.disbursements
      FOR SELECT TO authenticated
      USING (deleted_at IS NULL AND public.disbursement_visible_to_session(entity_id, created_by, requested_by, status));

    CREATE POLICY disbursement_session_read_guard ON public.disbursements AS RESTRICTIVE
      FOR SELECT TO PUBLIC
      USING (deleted_at IS NULL AND public.disbursement_visible_to_session(entity_id, created_by, requested_by, status));
  `);
};

exports.down = (pgm) => {
  pgm.sql('-- Security rollback intentionally preserves lifecycle read/write guards.');
};
