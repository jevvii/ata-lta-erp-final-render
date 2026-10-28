# RESUME-READ-SCOPE.md

## Overview & Execution Context
- **Worktree**: `/home/javvii/FreelanceProject/worktrees/operations-approval-read-scope-staging`
- **Branch**: `feat/operations-approval-read-scope-staging` (branching from `staging` / `a3ad162e`)
- **Parcel**: Database Read-Security Parcel (Required for CONTRACT.md R8 and READ-SCOPE-REQUIREMENTS.md)
- **Status**: Migration and portable real PostgreSQL acceptance test suite implemented, verified, and committed (34/34 passing).

---

## Deliverables Authored
1. `backend/migrations/000075_operations_approval_read_scope.js`:
   - Prerequisite column alignment: Idempotently ensures `work_requests.creation_approval_status varchar(30) DEFAULT 'approved'` is present (matches concurrent migration 73).
   - Privilege hardening: Revokes `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` on `work_requests`, `tasks`, `task_assignees`, `task_checklists`, `task_time_logs`, and `operations_requests` from `PUBLIC`, `anon`, and `authenticated`.
   - Read restriction: Revokes `SELECT` on all guarded tables from `PUBLIC` and `anon`. Grants `SELECT` to `authenticated` and `ALL` to `service_role`.
   - Security-definer visibility helpers:
     - `public.work_request_visible_to_session(p_work_request_id uuid, p_entity_id uuid, p_creation_approval_status text, p_assigned_to uuid, p_co_assignees jsonb)`
     - `public.work_request_visible_to_session(p_work_request_id uuid)`
     - `public.task_visible_to_session(p_task_id uuid)`
     - `public.operations_request_visible_to_session(p_id uuid, p_entity_id uuid, p_work_request_id uuid, p_linked_task_id uuid, p_requested_by uuid)`
     - Helpers enforce: fixed `search_path = public, pg_temp`, session resolution strictly from JWT `request.jwt.claims ->> 'sub'`, active user check (`is_active IS TRUE`), entity entitlement parity with `userScope.isUserEntitledToEntity` (including `'ALL'` and Admin empty-entities), non-deleted admission (`COALESCE(creation_approval_status, 'approved') = 'approved'`), and strict role & membership rules (Manager role alone confers no access; non-admin users must be lead, in `co_assignees` jsonb array, or assigned to a non-deleted task).
   - Procedures and RPC hardening: Revokes `EXECUTE` on `work_request_transition`, `task_transition`, and `get_dashboard_summary` from `PUBLIC`, `anon`, and `authenticated`; grants strictly to `service_role`.
   - Row Level Security (RLS) policies: Dual permissive and RESTRICTIVE guards (`AS RESTRICTIVE FOR SELECT TO PUBLIC`) on `work_requests`, `tasks`, `task_assignees`, `task_checklists`, `task_time_logs`, and `operations_requests`.
   - Fail-closed rollback: Down migration preserves read/write security guards.

2. `backend/tests/integration/operations_approval_read_scope_database.acceptance.js`:
   - 34 real PostgreSQL acceptance tests running against isolated local test DB `read_scope_test` on `127.0.0.1:55493`.
   - Renamed from `*.spec.js` to `*.acceptance.js` outside default Jest discovery to protect standard test runs from missing local database setups.
   - Requires explicit `OPERATIONS_READ_SCOPE_TEST_DB_URL` environment variable; zero hardcoded user-specific fallback.
   - Throws clear fail-closed configuration error if test DB env var is missing (no `describe.skip` or silent skipping).
   - Zero mutation or alteration of orchestrator-owned `postgres` database (enforced by `assertSafeLocalDatabase`).
   - Executed via explicit `--testMatch` command.

---

## Test Execution Commands & Evidence

### 1. Real PostgreSQL Acceptance Test (Explicit Test DB URL & `--testMatch`)
Command:
```bash
OPERATIONS_READ_SCOPE_TEST_DB_URL="postgres://javvii@127.0.0.1:55493/read_scope_test" npm --prefix backend test -- --testMatch "<rootDir>/tests/integration/operations_approval_read_scope_database.acceptance.js"
```

Evidence:
```
PASS tests/integration/operations_approval_read_scope_database.acceptance.js
  Operations Approval Read Scope Database Acceptance Suite
    1. Direct Table Mutations and Anonymous Access Revocation
      ✓ Anonymous direct SELECT on work_requests is denied by permission check (18 ms)
      ✓ Anonymous direct SELECT on tasks is denied by permission check (8 ms)
      ✓ Anonymous direct SELECT on task_assignees is denied by permission check (7 ms)
      ✓ Authenticated direct INSERT on work_requests is denied (7 ms)
      ✓ Authenticated direct UPDATE on work_requests is denied (8 ms)
      ✓ Authenticated direct DELETE on work_requests is denied (8 ms)
      ✓ Authenticated direct UPDATE on tasks is denied (7 ms)
      ✓ service_role retains administrative read and write capabilities (17 ms)
    2. Pending & Rejected Work Request Isolation (No Direct Leakage)
      ✓ Pending WR is hidden from direct table SELECT even for Admin ATA (7 ms)
      ✓ Pending WR is hidden from direct table SELECT for the creator/lead (7 ms)
      ✓ Rejected WR is hidden from direct table SELECT for Admin and creator (14 ms)
      ✓ Tasks under a Pending WR are hidden from direct table SELECT (9 ms)
      ✓ Tasks under a Rejected WR are hidden from direct table SELECT (8 ms)
    3. Entity Entitlement & Cross-Entity Isolation
      ✓ Admin restricted to ATA sees ATA approved WRs, but NOT LTA WRs (10 ms)
      ✓ Admin with empty entities array ({}) is unrestricted and sees all approved WRs (10 ms)
      ✓ Lead Manager entitled to ATA cannot see LTA WR even if assigned as lead (9 ms)
    4. Role & Membership Isolation (Manager Role Alone Insufficient)
      ✓ Manager role alone does NOT confer read access to unassigned WRs in the same entity (10 ms)
      ✓ Other Manager sees WR2 where assigned, but cannot see WR1 (10 ms)
      ✓ Primary task assignee can read parent approved WR (10 ms)
      ✓ Relational task assignee (in task_assignees) can read parent approved WR (10 ms)
      ✓ Co-assignee on work_requests can read approved WR (10 ms)
      ✓ Creator / requested_by alone without lead/co-assignee/task assignment CANNOT read approved WR (9 ms)
      ✓ Primary task assignee can see tasks belonging to their admitted WR, but not other WRs (11 ms)
    5. Soft-Deleted Records and Inactive Accounts Isolation
      ✓ Soft-deleted WR is hidden from all members and Admin (14 ms)
      ✓ Soft-deleted task is hidden from members (7 ms)
      ✓ Assignment to a soft-deleted task does not confer WR membership (10 ms)
      ✓ Inactive user accounts cannot see any work requests or tasks (18 ms)
    6. Descendant Tables Protection (Checklists, Time Logs, Operations Requests)
      ✓ Task checklists on admitted WR are readable by authorized members (10 ms)
      ✓ Task checklists on pending WR are hidden from direct table reads (9 ms)
      ✓ Task time logs on pending WR are hidden from direct table reads (9 ms)
      ✓ Operations request linked to pending WR is hidden from direct table reads (9 ms)
      ✓ Operations request linked to approved WR is readable by authorized lead (10 ms)
    7. Mutating Procedures Revocation & Rollback Safety
      ✓ public.work_request_transition execution is revoked from authenticated (16 ms)
      ✓ Migration down is fail-closed and preserves read/write security guards (15 ms)

Test Suites: 1 passed, 1 total
Tests:       34 passed, 34 total
Snapshots:   0 total
Time:        1.038 s
Ran all test suites.
```

### 2. Missing DB URL Validation (Explicit Fail-Closed Guard)
Command:
```bash
npm --prefix backend test -- --testMatch "<rootDir>/tests/integration/operations_approval_read_scope_database.acceptance.js"
```

Evidence:
```
FAIL tests/integration/operations_approval_read_scope_database.acceptance.js
  ● Operations Approval Read Scope Database Acceptance Suite › 1. Direct Table Mutations and Anonymous Access Revocation › Anonymous direct SELECT on work_requests is denied by permission check

    Missing OPERATIONS_READ_SCOPE_TEST_DB_URL environment variable. An explicit local PostgreSQL test database URL is required (e.g. OPERATIONS_READ_SCOPE_TEST_DB_URL=postgres://<user>@127.0.0.1:55493/read_scope_test).
```

### 3. Relevant Unit Suite Verification
Command:
```bash
npm --prefix backend test -- backend/tests/unit/lib/
```

Result:
```
PASS tests/unit/lib/permissions.matrix.test.js
PASS tests/unit/lib/logger.test.js
PASS tests/unit/lib/permissions.test.js

Test Suites: 3 passed, 3 total
Tests:       74 passed, 74 total
Snapshots:   0 total
Time:        0.619 s
```

### 4. ESLint Verification
Command:
```bash
npx --prefix backend eslint backend/migrations/000075_operations_approval_read_scope.js backend/tests/integration/operations_approval_read_scope_database.acceptance.js
```

Result:
Clean exit (code 0).

---

## Assumptions
1. Feature migrations 73 (`000073_wr_creation_approval_gate.js`) and 74 (`000074_task_creation_approval_review.js`) are authored concurrently on separate branches. Migration 75 references `work_requests.creation_approval_status` with `ADD COLUMN IF NOT EXISTS` fallback to ensure deterministic standalone migration application without breaking concurrent migrations.
2. In Supabase Realtime (CDC), WebSocket filtering strictly evaluates PostgreSQL RLS policies against the connecting client's authenticated JWT claims. Enforcing RLS on `work_requests`, `tasks`, and `task_assignees` natively secures CDC without disrupting authorized admitted members.
3. Dedicated pending/rejected creation review endpoints operate via the backend API (`service_role`), which bypasses RLS as intended.

---

## Risks & Mitigations
- **Recursive RLS Risk**: If a security-definer helper queries a guarded table without proper definer scoping or parameterization, PostgreSQL can detect policy recursion.
  - *Mitigation*: The primary helper `public.work_request_visible_to_session` receives row attributes (`id`, `entity_id`, `creation_approval_status`, `assigned_to`, `co_assignees`) directly in the `work_requests` policy, evaluating without re-querying `work_requests`. Definer helpers run under migration owner privilege without `FORCE ROW LEVEL SECURITY`.
- **Existence Oracle Risk**: Functions returning errors or detailed records could leak information about unadmitted WRs.
  - *Mitigation*: All helpers return boolean `false` immediately on any non-admitted, unauthorized, or missing records.
- **Orchestrator DB State Isolation**:
  - *Mitigation*: `assertSafeLocalDatabase` prohibits connecting to the orchestrator's `postgres` database, running all fixture teardown and verification against a separate `read_scope_test` database.
- **Test Portability**:
  - *Mitigation*: Acceptance suite is excluded from default Jest test discovery (`*.acceptance.js`), requires explicit `OPERATIONS_READ_SCOPE_TEST_DB_URL` with no user-specific fallback.

---

## Missing Verification / Follow-Up
1. **Full Integration with Migrations 73 & 74**: Once branch `feat/wr-creation-gate-staging` (migration 73) and `feat/task-creation-review-staging` (migration 74) are composed by the orchestrator on the planned staging integration branch, the orchestrator should run `node-pg-migrate up` across all three migrations sequentially (73 -> 74 -> 75).
2. **Supabase Realtime Live Channel Verification**: Verified locally via PostgreSQL RLS execution; live WebSocket event filtering should be validated during the orchestrator's staging test run with the frontend development server.
