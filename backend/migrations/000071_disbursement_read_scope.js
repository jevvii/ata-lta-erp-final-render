/** Keep lifecycle authority server-owned and financial reads scoped to the signed-in user. */
exports.up = (pgm) => {
  pgm.sql(`
    -- Browser clients use the authenticated API for mutations. They cannot grant
    -- themselves lifecycle authority by editing the identity/department tables.
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
      ON public.users, public.user_departments, public.departments, public.entities,
         public.disbursements, public.status_history
      FROM PUBLIC, anon, authenticated;

    CREATE OR REPLACE FUNCTION public.disbursement_visible_to_session(
      p_entity_id uuid, p_created_by uuid
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
            u.role IN ('Admin', 'Accounting') OR u.id = p_created_by
            OR EXISTS (
              SELECT 1 FROM public.user_departments ud
              JOIN public.departments d ON d.id = ud.department_id
              WHERE ud.user_id = u.id AND lower(d.name) = 'accounting'
            )
          )
      );
    $$;
    REVOKE ALL ON FUNCTION public.disbursement_visible_to_session(uuid, uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.disbursement_visible_to_session(uuid, uuid)
      TO anon, authenticated, service_role;

    ALTER TABLE public.disbursements ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.status_history ENABLE ROW LEVEL SECURITY;
    REVOKE SELECT ON public.disbursements, public.status_history FROM PUBLIC, anon;
    GRANT SELECT ON public.disbursements, public.status_history TO authenticated;
    GRANT ALL ON public.disbursements, public.status_history TO service_role;

    -- Restrictive guards also constrain any previously deployed permissive policy.
    DROP POLICY IF EXISTS disbursement_session_read ON public.disbursements;
    DROP POLICY IF EXISTS disbursement_session_read_guard ON public.disbursements;
    CREATE POLICY disbursement_session_read ON public.disbursements
      FOR SELECT TO authenticated
      USING (deleted_at IS NULL AND public.disbursement_visible_to_session(entity_id, created_by));
    CREATE POLICY disbursement_session_read_guard ON public.disbursements AS RESTRICTIVE
      FOR SELECT TO PUBLIC
      USING (deleted_at IS NULL AND public.disbursement_visible_to_session(entity_id, created_by));

    DROP POLICY IF EXISTS disbursement_history_session_read ON public.status_history;
    DROP POLICY IF EXISTS disbursement_history_session_read_guard ON public.status_history;
    CREATE POLICY disbursement_history_session_read ON public.status_history
      FOR SELECT TO authenticated USING (
        table_name = 'disbursements' AND EXISTS (
          SELECT 1 FROM public.disbursements d WHERE d.id = status_history.record_id
        )
      );
    CREATE POLICY disbursement_history_session_read_guard ON public.status_history AS RESTRICTIVE
      FOR SELECT TO PUBLIC USING (
        table_name = 'disbursements' AND EXISTS (
          SELECT 1 FROM public.disbursements d WHERE d.id = status_history.record_id
        )
      );
  `);
};

exports.down = (pgm) => {
  // Retain the deny-by-default permissions and RLS on rollback. Opening browser
  // writes or removing read guards requires an explicit, separately reviewed plan.
  pgm.sql('-- Security rollback intentionally preserves lifecycle read/write guards.');
};
