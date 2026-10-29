/**
 * Integration Test Suite: Operations Work Request & Task Approval Read Scope
 *
 * Validates real PostgreSQL Row Level Security (RLS) enforcement and role denial
 * per READ-SCOPE-REQUIREMENTS.md and CONTRACT.md (Policy R8).
 *
 * Features tested:
 * 1. Anonymous and public direct SELECT denied.
 * 2. Authenticated direct mutations (INSERT, UPDATE, DELETE) denied.
 * 3. service_role bypasses RLS and retains administrative read/write access.
 * 4. Pending/rejected WRs and their tasks hidden from direct table reads (even to creator/Admin).
 * 5. Entity entitlement strictly enforced (including ALL and Admin empty-entities).
 * 6. Role & membership isolation: Manager role alone never confers read access.
 *    Active membership requires lead, co_assignees, or non-deleted task assignment.
 * 7. Soft-deleted records and soft-deleted task assignments do not grant visibility.
 * 8. Inactive user accounts denied all visibility.
 * 9. Mutating procedures and summary RPC revoked from public/anon/authenticated.
 * 10. Descendant tables (task_assignees, task_checklists, task_time_logs, operations_requests)
 *     inherit parent WR admission.
 * 11. Fail-closed rollback preserves read/write security guards.
 */

const { Client } = require('pg');
const migration = require('../../migrations/000075_operations_approval_read_scope.js');

const testDbUrl = process.env.OPERATIONS_READ_SCOPE_TEST_DB_URL;

function assertSafeLocalDatabase(urlStr) {
  if (!urlStr) {
    throw new Error(
      'Missing OPERATIONS_READ_SCOPE_TEST_DB_URL environment variable. ' +
      'An explicit local PostgreSQL test database URL is required (e.g. OPERATIONS_READ_SCOPE_TEST_DB_URL=postgres://<user>@127.0.0.1:55493/read_scope_test).'
    );
  }
  const parsed = new URL(urlStr);
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(`Safety guard triggered: only local databases allowed, got ${parsed.hostname}`);
  }
  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName === 'postgres' && !process.env.ALLOW_ORCHESTRATOR_DB_MUTATION) {
    throw new Error(
      `Safety guard: target database cannot be 'postgres' (orchestrator owns postgres DB state). Use dedicated test DB.`
    );
  }
}

describe('Operations Approval Read Scope Database Acceptance Suite', () => {
  let adminClient;

  // Test Fixture UUIDs
  const ENTITY_ATA_ID = 'e0000000-0000-4000-8000-000000000001';
  const ENTITY_LTA_ID = 'e0000000-0000-4000-8000-000000000002';

  const CLIENT_ATA_ID = 'd0000000-0000-4000-8000-000000000001';
  const CLIENT_LTA_ID = 'd0000000-0000-4000-8000-000000000002';

  // Users
  const USER_ADMIN_ATA_ID = 'a0000000-0000-4000-8000-000000000001';
  const AUTH_ADMIN_ATA_SUB = 'a0000000-0000-4000-8000-000000000001';

  const USER_ADMIN_UNRESTRICTED_ID = 'a0000000-0000-4000-8000-000000000002';
  const AUTH_ADMIN_UNRESTRICTED_SUB = 'a0000000-0000-4000-8000-000000000002';

  const USER_LEAD_MGR_ID = 'b0000000-0000-4000-8000-000000000001';
  const AUTH_LEAD_MGR_SUB = 'b0000000-0000-4000-8000-000000000001';

  const USER_OTHER_MGR_ID = 'b0000000-0000-4000-8000-000000000002';
  const AUTH_OTHER_MGR_SUB = 'b0000000-0000-4000-8000-000000000002';

  const USER_EMP_TASK_PRIMARY_ID = 'c0000000-0000-4000-8000-000000000001';
  const AUTH_EMP_TASK_PRIMARY_SUB = 'c0000000-0000-4000-8000-000000000001';

  const USER_EMP_OTHER_ID = 'c0000000-0000-4000-8000-000000000002';
  const AUTH_EMP_OTHER_SUB = 'c0000000-0000-4000-8000-000000000002';

  const USER_EMP_RELATIONAL_ID = 'c0000000-0000-4000-8000-000000000003';
  const AUTH_EMP_RELATIONAL_SUB = 'c0000000-0000-4000-8000-000000000003';

  const USER_EMP_INACTIVE_ID = 'c0000000-0000-4000-8000-000000000004';
  const AUTH_EMP_INACTIVE_SUB = 'c0000000-0000-4000-8000-000000000004';

  const USER_EMP_CO_ASSIGNEE_ID = 'c0000000-0000-4000-8000-000000000005';
  const AUTH_EMP_CO_ASSIGNEE_SUB = 'c0000000-0000-4000-8000-000000000005';

  const USER_CREATOR_ONLY_ID = 'c0000000-0000-4000-8000-000000000006';
  const AUTH_CREATOR_ONLY_SUB = 'c0000000-0000-4000-8000-000000000006';

  // Work Requests
  const WR_APPROVED_ATA_ID = 'f0000000-0000-4000-8000-000000000001';
  const WR_APPROVED_OTHER_ATA_ID = 'f0000000-0000-4000-8000-000000000002';
  const WR_APPROVED_LTA_ID = 'f0000000-0000-4000-8000-000000000003';
  const WR_PENDING_ATA_ID = 'f0000000-0000-4000-8000-000000000004';
  const WR_REJECTED_ATA_ID = 'f0000000-0000-4000-8000-000000000005';
  const WR_DELETED_ATA_ID = 'f0000000-0000-4000-8000-000000000006';

  // Tasks
  const TASK_APPROVED_WR1_ID = '10000000-0000-4000-8000-000000000001';
  const TASK_APPROVED_WR2_ID = '10000000-0000-4000-8000-000000000002';
  const TASK_APPROVED_LTA_ID = '10000000-0000-4000-8000-000000000003';
  const TASK_ON_PENDING_WR_ID = '10000000-0000-4000-8000-000000000004';
  const TASK_ON_REJECTED_WR_ID = '10000000-0000-4000-8000-000000000005';
  const TASK_DELETED_ON_WR1_ID = '10000000-0000-4000-8000-000000000006';

  beforeAll(async () => {
    assertSafeLocalDatabase(testDbUrl);

    adminClient = new Client({ connectionString: testDbUrl });
    await adminClient.connect();

    // Ensure required Supabase roles exist in PostgreSQL cluster
    await adminClient.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN BYPASSRLS;
        END IF;
      END $$;
    `);

    // Reset and initialize schema tables
    await adminClient.query(`
      DROP TABLE IF EXISTS public.task_time_logs CASCADE;
      DROP TABLE IF EXISTS public.task_checklists CASCADE;
      DROP TABLE IF EXISTS public.operations_requests CASCADE;
      DROP TABLE IF EXISTS public.task_assignees CASCADE;
      DROP TABLE IF EXISTS public.tasks CASCADE;
      DROP TABLE IF EXISTS public.work_requests CASCADE;
      DROP TABLE IF EXISTS public.clients CASCADE;
      DROP TABLE IF EXISTS public.users CASCADE;
      DROP TABLE IF EXISTS public.entities CASCADE;

      CREATE TABLE public.entities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(10) NOT NULL UNIQUE,
        name varchar(255) NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      );

      CREATE TABLE public.users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_user_id uuid NOT NULL UNIQUE,
        email varchar(255) NOT NULL,
        name varchar(255) NOT NULL,
        role varchar(50) NOT NULL,
        entities text[] DEFAULT '{}'::text[] NOT NULL,
        is_active boolean DEFAULT true NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        avatar_url text,
        preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
        password_updated_at timestamptz
      );

      CREATE TABLE public.clients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id uuid NOT NULL REFERENCES public.entities(id),
        name varchar(255) NOT NULL,
        tin varchar(50) NOT NULL,
        status varchar(50) DEFAULT 'Active' NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      );

      CREATE TABLE public.work_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id uuid NOT NULL REFERENCES public.entities(id),
        client_id uuid NOT NULL REFERENCES public.clients(id),
        title varchar(255) NOT NULL,
        description text,
        status varchar(50) DEFAULT 'Draft' NOT NULL,
        requested_by uuid REFERENCES public.users(id),
        assigned_to uuid REFERENCES public.users(id),
        due_date timestamptz,
        deleted_at timestamptz,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        priority varchar(50) DEFAULT 'Normal' NOT NULL,
        archived boolean DEFAULT false NOT NULL,
        version integer DEFAULT 1 NOT NULL,
        co_assignees jsonb DEFAULT '[]'::jsonb,
        phase text,
        on_hold boolean DEFAULT false NOT NULL,
        submitted_by uuid REFERENCES public.users(id),
        creation_approval_status varchar(30) DEFAULT 'approved' NOT NULL
      );

      CREATE TABLE public.tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        work_request_id uuid NOT NULL REFERENCES public.work_requests(id),
        title varchar(255) NOT NULL,
        description text,
        status varchar(50) DEFAULT 'Draft' NOT NULL,
        assignee_id uuid REFERENCES public.users(id),
        due_date timestamptz,
        deleted_at timestamptz,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        version integer DEFAULT 1 NOT NULL,
        phase text,
        approval_status varchar(30) DEFAULT 'approved' NOT NULL
      );

      CREATE TABLE public.task_assignees (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        assigned_at timestamptz DEFAULT now() NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      );

      CREATE TABLE public.task_checklists (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
        text varchar(500) NOT NULL,
        completed boolean DEFAULT false NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      );

      CREATE TABLE public.task_time_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
        user_id uuid REFERENCES public.users(id),
        hours numeric(10,2) DEFAULT 0 NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      );

      CREATE TABLE public.operations_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id uuid NOT NULL REFERENCES public.entities(id),
        type varchar(50) NOT NULL,
        work_request_id uuid REFERENCES public.work_requests(id) ON DELETE SET NULL,
        linked_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
        requested_by uuid NOT NULL REFERENCES public.users(id),
        status varchar(50) DEFAULT 'pending' NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      );
    `);

    // Run migration 75 UP
    let migrationSql = '';
    migration.up({
      sql: (q) => {
        migrationSql = q;
      },
    });
    await adminClient.query(migrationSql);

    // Seed test fixtures
    await adminClient.query(`
      -- Entities
      INSERT INTO public.entities(id, code, name) VALUES
        ('${ENTITY_ATA_ID}', 'ATA', 'Synthetic ATA Entity'),
        ('${ENTITY_LTA_ID}', 'LTA', 'Synthetic LTA Entity');

      -- Users
      INSERT INTO public.users(id, auth_user_id, email, name, role, entities, is_active) VALUES
        ('${USER_ADMIN_ATA_ID}', '${AUTH_ADMIN_ATA_SUB}', 'admin-ata@example.test', 'Admin ATA', 'Admin', ARRAY['ATA'], true),
        ('${USER_ADMIN_UNRESTRICTED_ID}', '${AUTH_ADMIN_UNRESTRICTED_SUB}', 'admin-unres@example.test', 'Admin Unrestricted', 'Admin', ARRAY[]::text[], true),
        ('${USER_LEAD_MGR_ID}', '${AUTH_LEAD_MGR_SUB}', 'lead-mgr@example.test', 'Lead Manager', 'Manager', ARRAY['ATA'], true),
        ('${USER_OTHER_MGR_ID}', '${AUTH_OTHER_MGR_SUB}', 'other-mgr@example.test', 'Other Manager', 'Manager', ARRAY['ATA'], true),
        ('${USER_EMP_TASK_PRIMARY_ID}', '${AUTH_EMP_TASK_PRIMARY_SUB}', 'emp-primary@example.test', 'Primary Assignee Employee', 'Operations', ARRAY['ATA'], true),
        ('${USER_EMP_OTHER_ID}', '${AUTH_EMP_OTHER_SUB}', 'emp-other@example.test', 'Other Team Employee', 'Operations', ARRAY['ATA'], true),
        ('${USER_EMP_RELATIONAL_ID}', '${AUTH_EMP_RELATIONAL_SUB}', 'emp-relational@example.test', 'Relational Assignee Employee', 'Operations', ARRAY['ATA'], true),
        ('${USER_EMP_INACTIVE_ID}', '${AUTH_EMP_INACTIVE_SUB}', 'emp-inactive@example.test', 'Inactive Employee', 'Operations', ARRAY['ATA'], false),
        ('${USER_EMP_CO_ASSIGNEE_ID}', '${AUTH_EMP_CO_ASSIGNEE_SUB}', 'emp-coassignee@example.test', 'Co-Assignee Employee', 'Operations', ARRAY['ATA'], true),
        ('${USER_CREATOR_ONLY_ID}', '${AUTH_CREATOR_ONLY_SUB}', 'creator-only@example.test', 'Creator Only', 'Operations', ARRAY['ATA'], true);

      -- Clients
      INSERT INTO public.clients(id, entity_id, name, tin) VALUES
        ('${CLIENT_ATA_ID}', '${ENTITY_ATA_ID}', 'Client ATA', 'TIN-ATA-001'),
        ('${CLIENT_LTA_ID}', '${ENTITY_LTA_ID}', 'Client LTA', 'TIN-LTA-001');

      -- Work Requests
      INSERT INTO public.work_requests(id, entity_id, client_id, title, assigned_to, requested_by, creation_approval_status, co_assignees) VALUES
        ('${WR_APPROVED_ATA_ID}', '${ENTITY_ATA_ID}', '${CLIENT_ATA_ID}', 'Approved WR Team 1', '${USER_LEAD_MGR_ID}', '${USER_CREATOR_ONLY_ID}', 'approved', '["${USER_EMP_CO_ASSIGNEE_ID}"]'::jsonb),
        ('${WR_APPROVED_OTHER_ATA_ID}', '${ENTITY_ATA_ID}', '${CLIENT_ATA_ID}', 'Approved WR Other Team', '${USER_OTHER_MGR_ID}', '${USER_OTHER_MGR_ID}', 'approved', '[]'::jsonb),
        ('${WR_APPROVED_LTA_ID}', '${ENTITY_LTA_ID}', '${CLIENT_LTA_ID}', 'Approved LTA WR', '${USER_LEAD_MGR_ID}', '${USER_LEAD_MGR_ID}', 'approved', '[]'::jsonb),
        ('${WR_PENDING_ATA_ID}', '${ENTITY_ATA_ID}', '${CLIENT_ATA_ID}', 'Pending WR', '${USER_LEAD_MGR_ID}', '${USER_CREATOR_ONLY_ID}', 'pending', '[]'::jsonb),
        ('${WR_REJECTED_ATA_ID}', '${ENTITY_ATA_ID}', '${CLIENT_ATA_ID}', 'Rejected WR', '${USER_LEAD_MGR_ID}', '${USER_CREATOR_ONLY_ID}', 'rejected', '[]'::jsonb),
        ('${WR_DELETED_ATA_ID}', '${ENTITY_ATA_ID}', '${CLIENT_ATA_ID}', 'Soft-deleted WR', '${USER_LEAD_MGR_ID}', '${USER_LEAD_MGR_ID}', 'approved', '[]'::jsonb);

      UPDATE public.work_requests SET deleted_at = now() WHERE id = '${WR_DELETED_ATA_ID}';

      -- Tasks
      INSERT INTO public.tasks(id, work_request_id, title, assignee_id, approval_status) VALUES
        ('${TASK_APPROVED_WR1_ID}', '${WR_APPROVED_ATA_ID}', 'Task WR1 Primary', '${USER_EMP_TASK_PRIMARY_ID}', 'approved'),
        ('${TASK_APPROVED_WR2_ID}', '${WR_APPROVED_OTHER_ATA_ID}', 'Task WR2 Other Team', '${USER_EMP_OTHER_ID}', 'approved'),
        ('${TASK_APPROVED_LTA_ID}', '${WR_APPROVED_LTA_ID}', 'Task LTA WR', '${USER_EMP_TASK_PRIMARY_ID}', 'approved'),
        ('${TASK_ON_PENDING_WR_ID}', '${WR_PENDING_ATA_ID}', 'Task on Pending WR', '${USER_EMP_TASK_PRIMARY_ID}', 'approved'),
        ('${TASK_ON_REJECTED_WR_ID}', '${WR_REJECTED_ATA_ID}', 'Task on Rejected WR', '${USER_EMP_TASK_PRIMARY_ID}', 'approved'),
        ('${TASK_DELETED_ON_WR1_ID}', '${WR_APPROVED_ATA_ID}', 'Soft Deleted Task on WR1', '${USER_EMP_OTHER_ID}', 'approved');

      UPDATE public.tasks SET deleted_at = now() WHERE id = '${TASK_DELETED_ON_WR1_ID}';

      -- Task Assignees (Relational assignment for USER_EMP_RELATIONAL_ID on Task 1)
      INSERT INTO public.task_assignees(task_id, user_id) VALUES
        ('${TASK_APPROVED_WR1_ID}', '${USER_EMP_RELATIONAL_ID}');

      -- Checklists
      INSERT INTO public.task_checklists(task_id, text) VALUES
        ('${TASK_APPROVED_WR1_ID}', 'WR1 Checklist Item 1'),
        ('${TASK_ON_PENDING_WR_ID}', 'Pending WR Checklist Item');

      -- Time Logs
      INSERT INTO public.task_time_logs(task_id, user_id, hours) VALUES
        ('${TASK_APPROVED_WR1_ID}', '${USER_EMP_TASK_PRIMARY_ID}', 2.5),
        ('${TASK_ON_PENDING_WR_ID}', '${USER_EMP_TASK_PRIMARY_ID}', 1.0);

      -- Operations Requests
      INSERT INTO public.operations_requests(id, entity_id, type, work_request_id, requested_by) VALUES
        ('20000000-0000-4000-8000-000000000001', '${ENTITY_ATA_ID}', 'phase_transition', '${WR_APPROVED_ATA_ID}', '${USER_LEAD_MGR_ID}'),
        ('20000000-0000-4000-8000-000000000002', '${ENTITY_ATA_ID}', 'phase_transition', '${WR_PENDING_ATA_ID}', '${USER_LEAD_MGR_ID}');
    `);
  });

  afterAll(async () => {
    if (adminClient) {
      await adminClient.end();
    }
  });

  /** Helper to execute queries inside a transactional user session */
  async function queryInSession(authSub, sqlText, role = 'authenticated') {
    const client = new Client({ connectionString: testDbUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET ROLE ${role}`);
      if (authSub) {
        await client.query(`SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: authSub })}'`);
      } else {
        await client.query(`SET LOCAL request.jwt.claims = ''`);
      }
      const res = await client.query(sqlText);
      await client.query('COMMIT');
      return res.rows;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      await client.end();
    }
  }

  describe('1. Direct Table Mutations and Anonymous Access Revocation', () => {
    test('Anonymous direct SELECT on work_requests is denied by permission check', async () => {
      await expect(
        queryInSession(null, 'SELECT * FROM work_requests', 'anon')
      ).rejects.toThrow(/permission denied/i);
    });

    test('Anonymous direct SELECT on tasks is denied by permission check', async () => {
      await expect(
        queryInSession(null, 'SELECT * FROM tasks', 'anon')
      ).rejects.toThrow(/permission denied/i);
    });

    test('Anonymous direct SELECT on task_assignees is denied by permission check', async () => {
      await expect(
        queryInSession(null, 'SELECT * FROM task_assignees', 'anon')
      ).rejects.toThrow(/permission denied/i);
    });

    test('Authenticated direct INSERT on work_requests is denied', async () => {
      await expect(
        queryInSession(
          AUTH_ADMIN_ATA_SUB,
          `INSERT INTO work_requests(entity_id, client_id, title) VALUES ('${ENTITY_ATA_ID}', '${CLIENT_ATA_ID}', 'Hacked')`
        )
      ).rejects.toThrow(/permission denied/i);
    });

    test('Authenticated direct UPDATE on work_requests is denied', async () => {
      await expect(
        queryInSession(
          AUTH_ADMIN_ATA_SUB,
          `UPDATE work_requests SET title = 'Hacked' WHERE id = '${WR_APPROVED_ATA_ID}'`
        )
      ).rejects.toThrow(/permission denied/i);
    });

    test('Authenticated direct DELETE on work_requests is denied', async () => {
      await expect(
        queryInSession(
          AUTH_ADMIN_ATA_SUB,
          `DELETE FROM work_requests WHERE id = '${WR_APPROVED_ATA_ID}'`
        )
      ).rejects.toThrow(/permission denied/i);
    });

    test('Authenticated direct UPDATE on tasks is denied', async () => {
      await expect(
        queryInSession(
          AUTH_EMP_TASK_PRIMARY_SUB,
          `UPDATE tasks SET title = 'Hacked' WHERE id = '${TASK_APPROVED_WR1_ID}'`
        )
      ).rejects.toThrow(/permission denied/i);
    });

    test('service_role retains administrative read and write capabilities', async () => {
      const rows = await queryInSession(
        null,
        `SELECT count(*) FROM work_requests WHERE id = '${WR_APPROVED_ATA_ID}'`,
        'service_role'
      );
      expect(Number(rows[0].count)).toBe(1);

      const updateRows = await queryInSession(
        null,
        `UPDATE work_requests SET title = 'Title Updated by Service Role' WHERE id = '${WR_APPROVED_ATA_ID}' RETURNING id, title`,
        'service_role'
      );
      expect(updateRows[0].title).toBe('Title Updated by Service Role');
    });
  });

  describe('2. Pending & Rejected Work Request Isolation (No Direct Leakage)', () => {
    test('Pending WR is hidden from direct table SELECT even for Admin ATA', async () => {
      const rows = await queryInSession(
        AUTH_ADMIN_ATA_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_PENDING_ATA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Pending WR is hidden from direct table SELECT for the creator/lead', async () => {
      const rows = await queryInSession(
        AUTH_LEAD_MGR_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_PENDING_ATA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Rejected WR is hidden from direct table SELECT for Admin and creator', async () => {
      const adminRows = await queryInSession(
        AUTH_ADMIN_ATA_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_REJECTED_ATA_ID}'`
      );
      expect(adminRows).toHaveLength(0);

      const creatorRows = await queryInSession(
        AUTH_CREATOR_ONLY_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_REJECTED_ATA_ID}'`
      );
      expect(creatorRows).toHaveLength(0);
    });

    test('Tasks under a Pending WR are hidden from direct table SELECT', async () => {
      const rows = await queryInSession(
        AUTH_EMP_TASK_PRIMARY_SUB,
        `SELECT id FROM tasks WHERE work_request_id = '${WR_PENDING_ATA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Tasks under a Rejected WR are hidden from direct table SELECT', async () => {
      const rows = await queryInSession(
        AUTH_ADMIN_ATA_SUB,
        `SELECT id FROM tasks WHERE work_request_id = '${WR_REJECTED_ATA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('3. Entity Entitlement & Cross-Entity Isolation', () => {
    test('Admin restricted to ATA sees ATA approved WRs, but NOT LTA WRs', async () => {
      const rows = await queryInSession(
        AUTH_ADMIN_ATA_SUB,
        `SELECT id FROM work_requests ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(WR_APPROVED_ATA_ID);
      expect(ids).toContain(WR_APPROVED_OTHER_ATA_ID);
      expect(ids).not.toContain(WR_APPROVED_LTA_ID);
    });

    test('Admin with empty entities array ({}) is unrestricted and sees all approved WRs', async () => {
      const rows = await queryInSession(
        AUTH_ADMIN_UNRESTRICTED_SUB,
        `SELECT id FROM work_requests ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(WR_APPROVED_ATA_ID);
      expect(ids).toContain(WR_APPROVED_OTHER_ATA_ID);
      expect(ids).toContain(WR_APPROVED_LTA_ID);
    });

    test('Lead Manager entitled to ATA cannot see LTA WR even if assigned as lead', async () => {
      const rows = await queryInSession(
        AUTH_LEAD_MGR_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_APPROVED_LTA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('4. Role & Membership Isolation (Manager Role Alone Insufficient)', () => {
    test('Manager role alone does NOT confer read access to unassigned WRs in the same entity', async () => {
      const rows = await queryInSession(
        AUTH_LEAD_MGR_SUB,
        `SELECT id FROM work_requests ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      // Lead Manager is assigned to WR1, but NOT WR2
      expect(ids).toContain(WR_APPROVED_ATA_ID);
      expect(ids).not.toContain(WR_APPROVED_OTHER_ATA_ID);
    });

    test('Other Manager sees WR2 where assigned, but cannot see WR1', async () => {
      const rows = await queryInSession(
        AUTH_OTHER_MGR_SUB,
        `SELECT id FROM work_requests ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(WR_APPROVED_OTHER_ATA_ID);
      expect(ids).not.toContain(WR_APPROVED_ATA_ID);
    });

    test('Primary task assignee can read parent approved WR', async () => {
      const rows = await queryInSession(
        AUTH_EMP_TASK_PRIMARY_SUB,
        `SELECT id FROM work_requests ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(WR_APPROVED_ATA_ID);
      expect(ids).not.toContain(WR_APPROVED_OTHER_ATA_ID);
    });

    test('Relational task assignee (in task_assignees) can read parent approved WR', async () => {
      const rows = await queryInSession(
        AUTH_EMP_RELATIONAL_SUB,
        `SELECT id FROM work_requests ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(WR_APPROVED_ATA_ID);
      expect(ids).not.toContain(WR_APPROVED_OTHER_ATA_ID);
    });

    test('Co-assignee on work_requests can read approved WR', async () => {
      const rows = await queryInSession(
        AUTH_EMP_CO_ASSIGNEE_SUB,
        `SELECT id FROM work_requests ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(WR_APPROVED_ATA_ID);
      expect(ids).not.toContain(WR_APPROVED_OTHER_ATA_ID);
    });

    test('Creator / requested_by alone without lead/co-assignee/task assignment CANNOT read approved WR', async () => {
      const rows = await queryInSession(
        AUTH_CREATOR_ONLY_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_APPROVED_ATA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Primary task assignee can see tasks belonging to their admitted WR, but not other WRs', async () => {
      const rows = await queryInSession(
        AUTH_EMP_TASK_PRIMARY_SUB,
        `SELECT id FROM tasks ORDER BY id`
      );
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(TASK_APPROVED_WR1_ID);
      expect(ids).not.toContain(TASK_APPROVED_WR2_ID);
    });
  });

  describe('5. Soft-Deleted Records and Inactive Accounts Isolation', () => {
    test('Soft-deleted WR is hidden from all members and Admin', async () => {
      const adminRows = await queryInSession(
        AUTH_ADMIN_ATA_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_DELETED_ATA_ID}'`
      );
      expect(adminRows).toHaveLength(0);

      const leadRows = await queryInSession(
        AUTH_LEAD_MGR_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_DELETED_ATA_ID}'`
      );
      expect(leadRows).toHaveLength(0);
    });

    test('Soft-deleted task is hidden from members', async () => {
      const rows = await queryInSession(
        AUTH_EMP_TASK_PRIMARY_SUB,
        `SELECT id FROM tasks WHERE id = '${TASK_DELETED_ON_WR1_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Assignment to a soft-deleted task does not confer WR membership', async () => {
      // USER_EMP_OTHER_ID is only assigned to TASK_DELETED_ON_WR1_ID on WR1
      const rows = await queryInSession(
        AUTH_EMP_OTHER_SUB,
        `SELECT id FROM work_requests WHERE id = '${WR_APPROVED_ATA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Inactive user accounts cannot see any work requests or tasks', async () => {
      const wrRows = await queryInSession(
        AUTH_EMP_INACTIVE_SUB,
        `SELECT id FROM work_requests`
      );
      expect(wrRows).toHaveLength(0);

      const taskRows = await queryInSession(
        AUTH_EMP_INACTIVE_SUB,
        `SELECT id FROM tasks`
      );
      expect(taskRows).toHaveLength(0);
    });
  });

  describe('6. Descendant Tables Protection (Checklists, Time Logs, Operations Requests)', () => {
    test('Task checklists on admitted WR are readable by authorized members', async () => {
      const rows = await queryInSession(
        AUTH_EMP_TASK_PRIMARY_SUB,
        `SELECT id FROM task_checklists WHERE task_id = '${TASK_APPROVED_WR1_ID}'`
      );
      expect(rows.length).toBeGreaterThan(0);
    });

    test('Task checklists on pending WR are hidden from direct table reads', async () => {
      const rows = await queryInSession(
        AUTH_EMP_TASK_PRIMARY_SUB,
        `SELECT id FROM task_checklists WHERE task_id = '${TASK_ON_PENDING_WR_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Task time logs on pending WR are hidden from direct table reads', async () => {
      const rows = await queryInSession(
        AUTH_EMP_TASK_PRIMARY_SUB,
        `SELECT id FROM task_time_logs WHERE task_id = '${TASK_ON_PENDING_WR_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Operations request linked to pending WR is hidden from direct table reads', async () => {
      const rows = await queryInSession(
        AUTH_LEAD_MGR_SUB,
        `SELECT id FROM operations_requests WHERE work_request_id = '${WR_PENDING_ATA_ID}'`
      );
      expect(rows).toHaveLength(0);
    });

    test('Operations request linked to approved WR is readable by authorized lead', async () => {
      const rows = await queryInSession(
        AUTH_LEAD_MGR_SUB,
        `SELECT id FROM operations_requests WHERE work_request_id = '${WR_APPROVED_ATA_ID}'`
      );
      expect(rows).toHaveLength(1);
    });
  });

  describe('7. Mutating Procedures Revocation & Rollback Safety', () => {
    test('public.work_request_transition execution is revoked from authenticated', async () => {
      // Create RPC if absent to test revocation enforcement
      await adminClient.query(`
        CREATE OR REPLACE FUNCTION public.work_request_transition(
          p_id uuid, p_from_statuses text[], p_to_status text, p_user_id uuid, p_entity_id uuid, p_archived boolean DEFAULT NULL
        ) RETURNS SETOF work_requests LANGUAGE sql AS $$ SELECT * FROM work_requests WHERE id = p_id; $$;
      `);

      // Run revocation part of migration
      let sql = '';
      migration.up({
        sql: (q) => {
          sql = q;
        },
      });
      await adminClient.query(sql);

      await expect(
        queryInSession(
          AUTH_ADMIN_ATA_SUB,
          `SELECT * FROM public.work_request_transition('${WR_APPROVED_ATA_ID}', ARRAY['Draft']::text[], 'In Progress', '${USER_ADMIN_ATA_ID}', '${ENTITY_ATA_ID}')`
        )
      ).rejects.toThrow(/permission denied/i);
    });

    test('Migration down is fail-closed and preserves read/write security guards', async () => {
      let downSql = '';
      migration.down({
        sql: (q) => {
          downSql = q;
        },
      });
      await adminClient.query(downSql);

      // Verify that RLS remains active and anon SELECT remains blocked
      await expect(
        queryInSession(null, 'SELECT * FROM work_requests', 'anon')
      ).rejects.toThrow(/permission denied/i);

      // Verify that direct mutation remains blocked for authenticated users
      await expect(
        queryInSession(
          AUTH_ADMIN_ATA_SUB,
          `UPDATE work_requests SET title = 'Hacked' WHERE id = '${WR_APPROVED_ATA_ID}'`
        )
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
