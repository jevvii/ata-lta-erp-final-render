# Task Review Database & Write Serialization Parcel Handoff

**Date**: 2026-10-26  
**Worktree**: `/home/javvii/FreelanceProject/worktrees/task-review-db-staging`  
**Branches**:
- `feat/task-review-db-staging` (Migration 74 creator-membership fix: commit `b853a44d`)
- `feat/task-review-write-serialization-staging` (Migration 76 write serialization parcel)
**Database**: Dedicated local PostgreSQL at `127.0.0.1:55493`, database `task_review_test` (root `postgres` DB and `read_scope_test` reserved and untouched).

---

## 1. Scope & Ownership

The DB lane owns ONLY:
1. `backend/migrations/000074_task_creation_approval_review.js` (Preserved creator WR membership revalidation fix under lock + former-creator denial test)
2. `backend/migrations/000076_task_review_write_serialization.js` (Service-only transactional RPCs: `task_creation_review_create` and `task_material_update`)
3. `backend/tests/integration/acceptance.js` (65-test real PostgreSQL acceptance suite outside default Jest discovery)
4. Local handoff notes: `RESUME-TASK-DB.md`

No modifications made to service, controller, schema, mock, or frontend files. No remote database modifications or target merges/pushes.

---

## 2. Core Implemented Procedures (Migrations 74 & 76)

### 1. `public.task_creation_review_create` (Migration 76)
- **Signature**:
  ```sql
  task_creation_review_create(
    p_work_request_id uuid,
    p_entity_id uuid,
    p_actor_id uuid,
    p_data jsonb,
    p_assignees uuid[] DEFAULT NULL
  ) RETURNS SETOF public.tasks
  ```
- **Guards & Behavior**:
  - Service-only: `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`; `GRANT EXECUTE` to `service_role`.
  - **Parent-first row lock**: executes `SELECT * FROM public.work_requests WHERE id = p_work_request_id FOR UPDATE` before task insertion.
  - Validates WR admitted (`creation_approval_status = 'approved'`), writable (not archived, Cancelled, Completed), and entity match.
  - Validates active actor and entity entitlement under lock.
  - Validates normal WR membership (Admin allowed entitled; global Manager alone is NOT membership).
  - **Role-based Approval State**:
    - Employee creation requires an active, entitled Manager lead (`v_wr.assigned_to`); derives `approval_status = 'pending'`, sets immutable `created_by = p_actor_id`, `assigned_by = p_actor_id`, `version = 1`.
    - Admin or Manager creation derives `approval_status = 'approved'`, `version = 1`.
  - Whitelist validation: strictly rejects unknown and privileged fields (`approval_status`, `created_by`, `reviewed_by`, `reviewed_at`, `rejection_reason`, `version`, `work_request_id`, `deleted_at`).
  - Predecessors check: validates all dependencies belong to the same WR and are not deleted.
  - Assignee synchronization: validates active status and entity entitlement; atomically updates primary assignee and populates `public.task_assignees`.

### 2. `public.task_material_update` (Migration 76)
- **Signature**:
  ```sql
  task_material_update(
    p_task_id uuid,
    p_work_request_id uuid,
    p_entity_id uuid,
    p_actor_id uuid,
    p_expected_version integer,
    p_data jsonb DEFAULT '{}'::jsonb,
    p_assignees uuid[] DEFAULT NULL
  ) RETURNS SETOF public.tasks
  ```
- **Guards & Behavior**:
  - Service-only: `REVOKE ALL` from `PUBLIC`, `anon`, `authenticated`; `GRANT EXECUTE` to `service_role`.
  - **Parent-first row lock**: locks parent `work_requests` row before task row (`SELECT ... FOR UPDATE`).
  - Validates WR admitted, writable, entity match, and actor WR membership under lock.
  - Validates task belongs to WR and enforces OCC `version = p_expected_version`.
  - **Rejected Task Guard**: ordinary edits denied on rejected tasks (Policy R6: requires `task_creation_review_resubmit`).
  - Whitelist validation: rejects unknown and privileged fields (`approval_status`, `created_by`, `phase`, `qa_status`, `version`, etc.).
  - **Material Reset vs Routine Preservation**:
    - Material fields: `title`, `description`, `due_date`/`dueDate`, `required_link_type`, `predecessors`, `assignee_id`/`assignees`.
    - When an **employee** modifies material fields on an `approved` task:
      - Resets `approval_status = 'pending'`.
      - Clears `reviewed_by = NULL`, `reviewed_at = NULL`, `rejection_reason = NULL`.
      - Increments `version`.
      - Appends immutable audit event to `task_creation_review_events` with `event_type = 'material_update'`.
    - When an **employee** performs routine updates (e.g. `display_order` or `status`):
      - Preserves `approval_status = 'approved'`.
      - Does not reset reviewer fields; does not log an event.
    - When an **Admin or Manager** updates material fields:
      - Preserves `approval_status = 'approved'`.
  - Predecessors validation: checks same WR and denies self-dependencies.
  - Atomically synchronizes `task_assignees` table in same SQL transaction.

### 3. `public.task_creation_review_decide` (Migration 74)
- Enforces parent-before-task locking, Admin denial (Policy R5: NO Admin override), dynamic Manager lead revalidation under lock, entity entitlement, non-blank rejection reason, and OCC version guards.

### 4. `public.task_creation_review_resubmit` (Migration 74 + fix)
- Enforces creator-only check, creator active WR membership revalidation under lock (`TASK_REVIEW_FORBIDDEN: Actor is not a member of this work request`), rejected-only guard, whitelist validation, dependency checks, and resets status to `pending`.

---

## 3. Verification & Test Evidence

### Test Execution Command
```bash
cd backend && TASK_REVIEW_TEST_DATABASE_URL=postgres://javvii@127.0.0.1:55493/task_review_test ./node_modules/.bin/jest --testMatch="<rootDir>/tests/integration/acceptance.js" --runInBand
```

### Verified Test Outcome
- **Test File**: `backend/tests/integration/acceptance.js` (65 real PostgreSQL tests outside default Jest discovery).
- **Result**: `65 passed, 0 failed, 0 skipped` across all 15 requirement sections:
  1. Schema & Migration Integrity (4/4 passed)
  2. Security & RPC Privilege Gating (4/4 passed)
  3. Actor Authority, Admin Denial & Dynamic Lead Revocation (5/5 passed)
  4. Entity Entitlement & Linkage Validation (5/5 passed)
  5. Decision Validation & Execution (6/6 passed)
  6. OCC Concurrency Guards & Stale / Repeated Decisions (2/2 passed)
  7. Creator Correction & Resubmission + Former-Creator Denial (7/7 passed)
  8. Immutable History Audit Trail (1/1 passed)
  9. Concurrency Races (Row-Level Locking) (2/2 passed)
  10. Rejected-Work SQL Guards (4/4 passed)
  11. Sign-off & Completion Guards (5/5 passed)
  12. Migration Reversibility: Full Down/Up cycle for Migrations 76 & 74 (1/1 passed)
  13. Task Write Serialization: Creation Review RPC (`task_creation_review_create`) (10/10 passed)
  14. Task Write Serialization: Material Update RPC (`task_material_update`) (7/7 passed)
  15. Concurrent Serialization Races: Parent Row Locking (2/2 passed)
      - Proves strict parent-lock serialization: employee create blocks competing WR phase advancement.
      - Proves strict parent-lock serialization: employee material reset blocks competing WR phase advancement.

- **Unit Suites**: `74 passed, 74 total` on `backend/tests/unit/lib/`.
- **Linters**: ESLint ran clean with 0 errors across migrations and acceptance suite.

---

## 4. Exact Commits

1. **Commit `b853a44d`** (Branch `feat/task-review-db-staging`):
   `fix(operations): revalidate creator WR membership on task resubmit with former-creator denial test`
2. **Migration 76 Commit** (Branch `feat/task-review-write-serialization-staging`):
   `feat(operations): implement task review write serialization database parcel`
