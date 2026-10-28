/**
 * Migration 000075: Operations Approval Read Scope & RLS Hardening
 *
 * Implements strict database-level read security and row-level security (RLS)
 * for work requests, tasks, and descendant content per READ-SCOPE-REQUIREMENTS.md:
 * - Revokes direct browser mutations (INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)
 *   from PUBLIC, anon, and authenticated. Mutations must proceed through the backend API.
 * - Revokes direct SELECT from PUBLIC and anon.
 * - Enables Row Level Security (RLS) on work_requests, tasks, task_assignees,
 *   task_checklists, task_time_logs, and operations_requests.
 * - Implements RESTRICTIVE security guards to constrain any previously permissive policies.
 * - Restricts direct browser table reads to admitted non-deleted work requests,
 *   active session users with verified entity entitlement, and Admin or current WR members
 *   (assigned lead, co-assignee, or assignee of an active task).
 * - Pending and rejected work requests are NEVER directly readable via browser tables,
 *   even to creator or Admin.
 * - Preserves service_role access for backend operations and authorized realtime CDC.
 * - Fail-closed rollback.
 *
 * @type {import('node-pg-migrate').Migration}
 */
exports.up = (pgm) => {
  return pgm.sql(`
    -- 1. Ensure prerequisite column creation_approval_status exists on work_requests
    -- (from concurrent migration 73). Default 'approved' preserves legacy records.
    ALTER TABLE public.work_requests
      ADD COLUMN IF NOT EXISTS creation_approval_status varchar(30) NOT NULL DEFAULT 'approved';

    -- 2. Revoke browser mutations and direct anon SELECT, enable RLS
    DO $$
    DECLARE
      tbl text;
      tables text[] := ARRAY['work_requests', 'tasks', 'task_assignees', 'task_checklists', 'task_time_logs', 'operations_requests'];
    BEGIN
      FOREACH tbl IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
          EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM PUBLIC, anon, authenticated', tbl);
          EXECUTE format('REVOKE ALL ON public.%I FROM anon', tbl);
          EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC', tbl);
          EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl);
          EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
        END IF;
      END LOOP;
    END $$;

    -- 3. Security definer visibility helper function: work_request_visible_to_session (full params)
    CREATE OR REPLACE FUNCTION public.work_request_visible_to_session(
      p_work_request_id uuid,
      p_entity_id uuid,
      p_creation_approval_status text,
      p_assigned_to uuid,
      p_co_assignees jsonb
    ) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $func$
    DECLARE
      v_auth_sub text;
      v_user RECORD;
      v_entity_code text;
    BEGIN
      -- Admitted non-deleted WR check:
      -- Pending and rejected WRs are NEVER directly readable via table SELECT, even to creator or Admin.
      -- Grandfathered / null status defaults to approved.
      IF COALESCE(p_creation_approval_status, 'approved') <> 'approved' THEN
        RETURN false;
      END IF;

      -- Resolve session user strictly from JWT claims sub (no actor-id spoofing)
      BEGIN
        v_auth_sub := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
      EXCEPTION WHEN OTHERS THEN
        v_auth_sub := NULL;
      END;

      IF v_auth_sub IS NULL THEN
        RETURN false;
      END IF;

      SELECT u.id, u.role, u.entities, u.is_active
      INTO v_user
      FROM public.users u
      WHERE u.auth_user_id::text = v_auth_sub;

      IF NOT FOUND OR v_user.is_active IS NOT TRUE THEN
        RETURN false;
      END IF;

      -- Entity entitlement check matching isUserEntitledToEntity semantics
      IF p_entity_id IS NULL THEN
        RETURN false;
      END IF;

      SELECT upper(trim(e.code))
      INTO v_entity_code
      FROM public.entities e
      WHERE e.id = p_entity_id;

      IF NOT FOUND OR v_entity_code IS NULL THEN
        RETURN false;
      END IF;

      -- Admin with empty/null entities array has unrestricted entity entitlement
      IF v_user.role = 'Admin' AND (v_user.entities IS NULL OR cardinality(v_user.entities) = 0) THEN
        RETURN true;
      END IF;

      -- Non-empty entities array: must contain 'ALL' or the specific entity code
      IF NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(v_user.entities, ARRAY[]::text[])) ue
        WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
      ) THEN
        RETURN false;
      END IF;

      -- Admin with entity entitlement has read access to all admitted WRs in that entity
      IF v_user.role = 'Admin' THEN
        RETURN true;
      END IF;

      -- Manager role or Management department alone NEVER confers read access.
      -- User must have actual current WR membership:
      -- 1. Assigned lead
      IF p_assigned_to IS NOT NULL AND p_assigned_to = v_user.id THEN
        RETURN true;
      END IF;

      -- 2. Co-assignees array
      IF p_co_assignees IS NOT NULL AND jsonb_typeof(p_co_assignees) = 'array' THEN
        IF EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(p_co_assignees) ca
          WHERE lower(trim(ca)) = lower(v_user.id::text)
        ) THEN
          RETURN true;
        END IF;
      END IF;

      -- 3. Primary task assignee of a non-deleted task
      IF EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.work_request_id = p_work_request_id
          AND t.deleted_at IS NULL
          AND t.assignee_id = v_user.id
      ) THEN
        RETURN true;
      END IF;

      -- 4. Relational task assignee of a non-deleted task
      IF EXISTS (
        SELECT 1 FROM public.task_assignees ta
        JOIN public.tasks t ON t.id = ta.task_id
        WHERE t.work_request_id = p_work_request_id
          AND t.deleted_at IS NULL
          AND ta.user_id = v_user.id
      ) THEN
        RETURN true;
      END IF;

      RETURN false;
    END;
    $func$;

    -- 4. Overloaded single-argument helper for looking up WR by ID
    CREATE OR REPLACE FUNCTION public.work_request_visible_to_session(p_work_request_id uuid)
    RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $func$
    DECLARE
      v_wr RECORD;
    BEGIN
      IF p_work_request_id IS NULL THEN
        RETURN false;
      END IF;

      SELECT id, entity_id, creation_approval_status, assigned_to, co_assignees, deleted_at
      INTO v_wr
      FROM public.work_requests
      WHERE id = p_work_request_id;

      IF NOT FOUND OR v_wr.deleted_at IS NOT NULL THEN
        RETURN false;
      END IF;

      IF COALESCE(v_wr.creation_approval_status, 'approved') <> 'approved' THEN
        RETURN false;
      END IF;

      RETURN public.work_request_visible_to_session(
        v_wr.id,
        v_wr.entity_id,
        v_wr.creation_approval_status,
        v_wr.assigned_to,
        v_wr.co_assignees
      );
    END;
    $func$;

    -- 5. Helper for task visibility
    CREATE OR REPLACE FUNCTION public.task_visible_to_session(p_task_id uuid)
    RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $func$
    DECLARE
      v_task RECORD;
    BEGIN
      IF p_task_id IS NULL THEN
        RETURN false;
      END IF;

      SELECT id, work_request_id, deleted_at
      INTO v_task
      FROM public.tasks
      WHERE id = p_task_id;

      IF NOT FOUND OR v_task.deleted_at IS NOT NULL THEN
        RETURN false;
      END IF;

      RETURN public.work_request_visible_to_session(v_task.work_request_id);
    END;
    $func$;

    -- 6. Helper for operations requests (if table exists)
    CREATE OR REPLACE FUNCTION public.operations_request_visible_to_session(
      p_request_id uuid,
      p_entity_id uuid,
      p_work_request_id uuid,
      p_linked_task_id uuid,
      p_requested_by uuid
    ) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $func$
    DECLARE
      v_auth_sub text;
      v_user RECORD;
      v_entity_code text;
    BEGIN
      -- If linked to a WR, WR must be admitted and visible to session
      IF p_work_request_id IS NOT NULL THEN
        IF NOT public.work_request_visible_to_session(p_work_request_id) THEN
          RETURN false;
        END IF;
      END IF;

      -- If linked to a task, task must be active and visible to session
      IF p_linked_task_id IS NOT NULL THEN
        IF NOT public.task_visible_to_session(p_linked_task_id) THEN
          RETURN false;
        END IF;
      END IF;

      -- Resolve session user
      BEGIN
        v_auth_sub := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
      EXCEPTION WHEN OTHERS THEN
        v_auth_sub := NULL;
      END;

      IF v_auth_sub IS NULL THEN
        RETURN false;
      END IF;

      SELECT u.id, u.role, u.entities, u.is_active
      INTO v_user
      FROM public.users u
      WHERE u.auth_user_id::text = v_auth_sub;

      IF NOT FOUND OR v_user.is_active IS NOT TRUE THEN
        RETURN false;
      END IF;

      -- Entity entitlement
      IF p_entity_id IS NOT NULL THEN
        SELECT upper(trim(e.code))
        INTO v_entity_code
        FROM public.entities e
        WHERE e.id = p_entity_id;

        IF NOT FOUND OR v_entity_code IS NULL THEN
          RETURN false;
        END IF;

        IF v_user.role = 'Admin' AND (v_user.entities IS NULL OR cardinality(v_user.entities) = 0) THEN
          RETURN true;
        END IF;

        IF NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(v_user.entities, ARRAY[]::text[])) ue
          WHERE upper(trim(ue)) = 'ALL' OR upper(trim(ue)) = v_entity_code
        ) THEN
          RETURN false;
        END IF;
      END IF;

      IF v_user.role = 'Admin' THEN
        RETURN true;
      END IF;

      -- If linked to WR or task, visibility was already verified above
      IF p_work_request_id IS NOT NULL OR p_linked_task_id IS NOT NULL THEN
        RETURN true;
      END IF;

      -- Unlinked operations requests: requester or Manager
      IF p_requested_by IS NOT NULL AND p_requested_by = v_user.id THEN
        RETURN true;
      END IF;

      IF v_user.role = 'Manager' THEN
        RETURN true;
      END IF;

      RETURN false;
    END;
    $func$;

    -- 7. Privileges on visibility helper functions
    REVOKE ALL ON FUNCTION public.work_request_visible_to_session(uuid, uuid, text, uuid, jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.work_request_visible_to_session(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.task_visible_to_session(uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.operations_request_visible_to_session(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;

    GRANT EXECUTE ON FUNCTION public.work_request_visible_to_session(uuid, uuid, text, uuid, jsonb) TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.work_request_visible_to_session(uuid) TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.task_visible_to_session(uuid) TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.operations_request_visible_to_session(uuid, uuid, uuid, uuid, uuid) TO anon, authenticated, service_role;

    -- 8. Policies on work_requests
    DROP POLICY IF EXISTS work_requests_session_read ON public.work_requests;
    DROP POLICY IF EXISTS work_requests_session_read_guard ON public.work_requests;

    CREATE POLICY work_requests_session_read ON public.work_requests
      FOR SELECT TO authenticated
      USING (
        deleted_at IS NULL
        AND COALESCE(creation_approval_status, 'approved') = 'approved'
        AND public.work_request_visible_to_session(id, entity_id, creation_approval_status, assigned_to, co_assignees)
      );

    CREATE POLICY work_requests_session_read_guard ON public.work_requests AS RESTRICTIVE
      FOR SELECT TO PUBLIC
      USING (
        deleted_at IS NULL
        AND COALESCE(creation_approval_status, 'approved') = 'approved'
        AND public.work_request_visible_to_session(id, entity_id, creation_approval_status, assigned_to, co_assignees)
      );

    -- 9. Policies on tasks
    DROP POLICY IF EXISTS tasks_session_read ON public.tasks;
    DROP POLICY IF EXISTS tasks_session_read_guard ON public.tasks;

    CREATE POLICY tasks_session_read ON public.tasks
      FOR SELECT TO authenticated
      USING (
        deleted_at IS NULL
        AND public.work_request_visible_to_session(work_request_id)
      );

    CREATE POLICY tasks_session_read_guard ON public.tasks AS RESTRICTIVE
      FOR SELECT TO PUBLIC
      USING (
        deleted_at IS NULL
        AND public.work_request_visible_to_session(work_request_id)
      );

    -- 10. Policies on task_assignees
    DROP POLICY IF EXISTS task_assignees_session_read ON public.task_assignees;
    DROP POLICY IF EXISTS task_assignees_session_read_guard ON public.task_assignees;

    CREATE POLICY task_assignees_session_read ON public.task_assignees
      FOR SELECT TO authenticated
      USING (
        public.task_visible_to_session(task_id)
      );

    CREATE POLICY task_assignees_session_read_guard ON public.task_assignees AS RESTRICTIVE
      FOR SELECT TO PUBLIC
      USING (
        public.task_visible_to_session(task_id)
      );

    -- 11. Conditional policies on task_checklists, task_time_logs, operations_requests
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_checklists') THEN
        EXECUTE 'DROP POLICY IF EXISTS task_checklists_session_read ON public.task_checklists';
        EXECUTE 'DROP POLICY IF EXISTS task_checklists_session_read_guard ON public.task_checklists';
        EXECUTE 'CREATE POLICY task_checklists_session_read ON public.task_checklists FOR SELECT TO authenticated USING (public.task_visible_to_session(task_id))';
        EXECUTE 'CREATE POLICY task_checklists_session_read_guard ON public.task_checklists AS RESTRICTIVE FOR SELECT TO PUBLIC USING (public.task_visible_to_session(task_id))';
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'task_time_logs') THEN
        EXECUTE 'DROP POLICY IF EXISTS task_time_logs_session_read ON public.task_time_logs';
        EXECUTE 'DROP POLICY IF EXISTS task_time_logs_session_read_guard ON public.task_time_logs';
        EXECUTE 'CREATE POLICY task_time_logs_session_read ON public.task_time_logs FOR SELECT TO authenticated USING (public.task_visible_to_session(task_id))';
        EXECUTE 'CREATE POLICY task_time_logs_session_read_guard ON public.task_time_logs AS RESTRICTIVE FOR SELECT TO PUBLIC USING (public.task_visible_to_session(task_id))';
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'operations_requests') THEN
        EXECUTE 'DROP POLICY IF EXISTS operations_requests_session_read ON public.operations_requests';
        EXECUTE 'DROP POLICY IF EXISTS operations_requests_session_read_guard ON public.operations_requests';
        EXECUTE 'CREATE POLICY operations_requests_session_read ON public.operations_requests FOR SELECT TO authenticated USING (public.operations_request_visible_to_session(id, entity_id, work_request_id, linked_task_id, requested_by))';
        EXECUTE 'CREATE POLICY operations_requests_session_read_guard ON public.operations_requests AS RESTRICTIVE FOR SELECT TO PUBLIC USING (public.operations_request_visible_to_session(id, entity_id, work_request_id, linked_task_id, requested_by))';
      END IF;
    END $$;

    -- 12. Revoke execution on RPC procedures that can bypass RLS or mutate WR/tasks directly
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'get_dashboard_summary') THEN
        REVOKE EXECUTE ON FUNCTION public.get_dashboard_summary(uuid) FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.get_dashboard_summary(uuid) TO service_role;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'work_request_transition') THEN
        REVOKE EXECUTE ON FUNCTION public.work_request_transition FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.work_request_transition TO service_role;
      END IF;

      IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = 'public' AND p.proname = 'task_transition') THEN
        REVOKE EXECUTE ON FUNCTION public.task_transition FROM PUBLIC, anon, authenticated;
        GRANT EXECUTE ON FUNCTION public.task_transition TO service_role;
      END IF;
    END $$;
  `);
};

exports.down = (pgm) => {
  // Retain the deny-by-default permissions and RLS on rollback. Opening browser
  // writes or removing read guards requires an explicit, separately reviewed plan.
  return pgm.sql('-- Security rollback intentionally preserves operations approval read/write guards.');
};
