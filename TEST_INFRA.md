# Test Infrastructure & Validation Framework (ATA/LTA ERP)

This repository incorporates test infrastructure for two remediation tracks:
- **Part 1: Real-Time Caching & CDC Synchronization Remediation (Pre-existing Framework)**
- **Part 2: RBAC & UI Remediation Validation Framework**

---

# Part 1: Real-Time Caching & CDC Synchronization Remediation (Pre-existing Framework)

**Version**: 2.1.0
**Target Architecture**: Real-Time Caching & CDC Synchronization Remediation (SPEC-REALTIME-SYNC-001)
**Test Engine**: Vitest 3.2.7 + Testing Library (React 19 / JSDOM)
**Total Target Test Files**: 97+
**Total Automated Tests**: >= 1,450
**Test Pass Rate**: 100% (0 failures, 0 regressions)
**TypeScript Diagnostic Errors**: 0 (`tsc -b` clean)

---

## 1. Architectural Testing Doctrine & Philosophy

The ATA/LTA ERP Real-Time Caching and CDC Synchronization test infrastructure adheres to five core architectural tenets:

### 1.1 Dual-Track E2E & Opaque-Box Testing Doctrine
- Testing operates along dual tracks: requirement-driven specification verification and empirical component-level integration.
- Tests exercise opaque-box system boundaries: Supabase Realtime WebSocket events, TanStack Query cache updates, Zustand session store states, and user-visible React components.
- Implementation details (internal helper closures, unexported state) are never coupled to test assertions. All tests target authoritative contracts defined in `PROJECT.md` and `SPEC-REALTIME-SYNC-001`.

### 1.2 Dual-Case Normalization Contract
- PostgreSQL CDC payloads arrive from the logical replication stream with raw `snake_case` database column names (`work_request_id`, `qa_status`, `due_date`, `display_order`, `assignee_id`, etc.).
- TanStack Query caches and React UI components (`PhaseKanbanBoard`, `TaskDetailModal`, `TaskCard`) consume camelCase properties (`workRequestId`, `qaStatus`, `dueDate`, `displayOrder`, `assigneeId`, etc.).
- Normalizers produce unified objects containing both camelCase and snake_case properties, preventing stale UI state while preserving backward compatibility with legacy consumers.

### 1.3 Strict Soft-Delete & Gate Integrity
- Deletion in PostgreSQL is soft (`deleted_at = now()`), arriving over WebSocket as an `UPDATE` event.
- The reconciler classifies `deleted_at != null || deletedAt != null` as `isDelete = true`.
- Deletions immediately evict detail query caches, filter item records from list queries, and purge embedded task objects from parent work request phase containers.
- Kanban gate calculations (`gateInfo`) and phase columns strictly exclude soft-deleted tasks (`!t.deletedAt && !t.deleted_at`).

### 1.4 Scoped Targeting & Cross-Domain Co-Invalidation
- Task CDC events are strictly scoped via `isTaskListOfTargetWr` to prevent cross-work-request cache pollution under `listRootKey`.
- Mutations trigger precise co-invalidations across domain boundaries:
  - Task updates invalidate parent `workRequestDetail(wrId)`, `workRequestCounts(entity)`, and `taskRelated(taskId)`.
  - Invoices, disbursements, transmittals, and documents invalidate `taskRelated(taskId)`.
  - Operations requests invalidate `requests()`, `requestCounts()`, and parent `workRequestDetail(wrId)`.

### 1.5 Strict Zero-Playwright & Zero-Secret Invariants
- Under **NO circumstances** is the Playwright browser runner or any headless browser plugin invoked, configured, or installed.
- All multi-user browser scenarios (Browser 1 and Browser 2) are modeled deterministically using concurrent Vitest React Testing Library contexts and in-memory `MockRealtimeChannel` WebSocket multiplexers.
- Zero hardcoded secrets (`sb_secret_*`, raw JWT tokens, API keys). Transient sessions are configured strictly via in-memory stores (`useSessionStore`).

---

## 2. Feature Inventory & Test Mapping

| # | Feature ID | Feature Name | Primary Test File | Coverage Tier |
|---|------------|--------------|-------------------|---------------|
| 1 | F-NORM | Dual-Case Normalization Engine (`normalizeCdcTask`, `normalizeCdcWorkRequest`, `normalizeCdcOperationsRequest`, `normalizeCdcNotification`, `normalizeCdcPayload`) | `src/lib/realtime/__tests__/cdcNormalization.test.ts` | Tier 1, Tier 2 |
| 2 | F-DEL | Accurate Soft-Delete Eviction (`deleted_at != null \|\| deletedAt != null` treated as `isDelete`) | `src/lib/realtime/__tests__/cdcSoftDeleteAndScope.test.ts` | Tier 1, Tier 2 |
| 3 | F-SCOPE | Scoped Task List Query Matcher (`isTaskListOfTargetWr`) | `src/lib/realtime/__tests__/cdcSoftDeleteAndScope.test.ts` | Tier 1, Tier 2 |
| 4 | F-COINV | Task & Cross-Domain Query Co-Invalidations (`workRequestDetail`, `taskRelated`, `requests`) | `src/lib/realtime/__tests__/cdcSoftDeleteAndScope.test.ts` | Tier 1, Tier 3 |
| 5 | F-NOTIF | User-Scoped Realtime Notifications Hook & Bell Mount (`useNotificationRealtimeSync`, `NotificationBellPanel`) | `src/features/dashboard/__tests__/notificationRealtime.test.tsx` | Tier 1, Tier 2, Tier 3 |
| 6 | F-OPS | Reactive Operations Requests & Approvals Inbox (`PendingApprovalsInbox`, `operations.tsx`) | `src/features/operations/__tests__/operationsRealtimeSync.test.tsx` | Tier 1, Tier 3, Tier 4 |
| 7 | F-KANBAN | Reactive Kanban Selection & Task Sync (`PhaseKanbanBoard`, `TaskDetailModal`) | `src/features/operations/__tests__/operationsRealtimeSync.test.tsx` | Tier 1, Tier 3, Tier 4 |
| 8 | F-E2E | Real-World Multi-User Application Scenarios (E2E-RT-1 through E2E-RT-8) | `src/features/operations/__tests__/operationsRealtimeSync.test.tsx` | Tier 4 |

---

## 3. Detailed Acceptance Criteria & Verification Matrix

### 3.1 Tier 1: Functional Feature Coverage (>=5 Tests Per Feature)
- **F-NORM (Dual-Case Normalization)**:
  1. `normalizeCdcTask` produces identical properties under both camelCase (`workRequestId`, `qaStatus`, `dueDate`, `displayOrder`, `assigneeId`) and snake_case (`work_request_id`, `qa_status`, `due_date`, `display_order`, `assignee_id`).
  2. `normalizeCdcWorkRequest` produces dual properties for `workRequestNo` & `work_request_no`, `clientId` & `client_id`, `clientName` & `client_name`, `onHold` & `on_hold`.
  3. `normalizeCdcOperationsRequest` normalizes `type` & `request_type`, `workRequestId` & `work_request_id`, `linkedTaskId` & `linked_task_id`.
  4. `normalizeCdcNotification` normalizes `userId` & `user_id`, `readAt` & `read_at`, `createdAt` & `created_at`.
  5. `normalizeCdcPayload` routes payloads correctly based on table name (`tasks`, `work_requests`, `operations_requests`, `notifications`).
- **F-DEL (Soft-Delete Eviction)**:
  1. Detects `deleted_at: '2026-10-10T12:00:00Z'` as `isDelete = true`.
  2. Detects `deletedAt: '2026-10-10T12:00:00Z'` on `UPDATE` event as `isDelete = true`.
  3. Evicts task record from detail query cache upon soft deletion.
  4. Removes soft-deleted item from list cache array and decrements list total count.
  5. Purges soft-deleted task from parent work request embedded `phases` containers.
- **F-SCOPE (Query Scoping)**:
  1. Prepending a task to target work request `wr-A` list query leaves sibling `wr-B` list query untouched.
  2. Updates to a task under `wr-A` only match queries containing `wr-A`.
  3. Detail query cache targeting matches specific work request and task ID tuple.
  4. List root query search respects explicit array query keys.
  5. Non-matching query keys are completely bypassed without cache mutations.
- **F-COINV (Co-Invalidations)**:
  1. Task update invalidates `operationsKeys.workRequestDetail(wrId)`.
  2. Task update invalidates `operationsKeys.workRequestCounts(entity)`.
  3. Task update invalidates `operationsKeys.taskRelated(taskId)`.
  4. Linked invoice with `task_id` invalidates `operationsKeys.taskRelated(taskId)`.
  5. Linked disbursement with `task_id` invalidates `operationsKeys.taskRelated(taskId)`.
  6. Linked transmittal and document invalidate `operationsKeys.taskRelated(taskId)`.
  7. Operations request mutation invalidates `operationsKeys.requests()` and `requestCounts(entity)`.
- **F-NOTIF (Real-Time Notifications)**:
  1. `useNotificationRealtimeSync` subscribes to table `notifications` filtered by `user_id=eq.${user.id}`.
  2. Incoming notification INSERT immediately increments `unreadCount` in `useSessionStore`.
  3. Incoming notification INSERT prepends item to `dashboardKeys.notifications.all` query cache.
  4. Marking notification as read decrements `unreadCount` in session store.
  5. `NotificationBellPanel` renders live notification bell badge reflecting unread count.
- **F-OPS (Operations Requests)**:
  1. Mounts `useEntityRealtimeSync({ table: 'operations_requests' })`.
  2. Creating an operations request reactively appends item to pending inbox list.
  3. Approving an operations request updates status badge in `PendingApprovalsInbox`.
  4. Rejecting an operations request reflects rejection reason reactively.
  5. Badge count for pending approvals decrements when request is resolved.
- **F-KANBAN (Kanban & Task Modal)**:
  1. `PhaseKanbanBoard` synchronizes `selectedTask` when live query cache task updates.
  2. Kanban board filters out soft-deleted tasks (`!t.deletedAt && !t.deleted_at`).
  3. Gate calculation (`gateInfo`) excludes soft-deleted tasks from unblocking criteria.
  4. `TaskDetailModal` binds to live task query cache falling back to task prop.
  5. Closing child financial/document modals invalidates `operationsKeys.taskRelated(taskId)`.

### 3.2 Tier 2: Boundary & Corner Cases (>=5 Tests Per Feature)
- **F-NORM Boundaries**:
  1. Handles missing, undefined, and null fields gracefully (sets sensible defaults: `qaStatus: 'none'`, `displayOrder: 0`, `onHold: false`).
  2. Preserves already camelCase payload without overwriting with defaults.
  3. Preserves unexpected extra payload fields (payload pass-through).
  4. Resists prototype pollution keys (`__proto__`, `constructor`).
  5. Correctly handles empty objects and malformed records.
- **F-DEL Boundaries**:
  1. Distinguishes `deleted_at: null` (active record) from `deleted_at: string` (soft-deleted).
  2. Handles empty string `deleted_at: ""` as falsy (active record).
  3. Handles `DELETE` event where `new` is null and `old` is populated.
  4. Handles `UPDATE` event where `old` is missing (partial CDC stream).
  5. Eviction survives missing parent phases container.
- **F-SCOPE Boundaries**:
  1. Malformed query keys (null, numbers, empty arrays) do not crash query search.
  2. Work request IDs with substrings (e.g. `wr-1` vs `wr-10`) do not cross-match.
  3. Handles empty cache list arrays without index errors.
  4. Prevents duplicate prepending if item already exists in target list.
  5. Supports pagination metadata `meta.total` boundary when decrementing at zero.
- **F-NOTIF Boundaries**:
  1. Unauthenticated / unassigned user (`user: null`) disables realtime subscription.
  2. Discards notification payloads belonging to a different user ID.
  3. Discards notification payloads when `realtime_sync` feature flag is disabled.
  4. Handles rapid successive notification INSERTs without race condition or duplicate badge counts.
  5. Handles notification payload with null or empty title/body.

### 3.3 Tier 3: Cross-Feature Combinations & Pairwise Interactions
1. **Normalization + Soft-Delete Interaction**:
   A soft-deleted task payload with snake_case keys (`deleted_at: '...'`, `qa_status: 'passed'`) is normalized and correctly evicted from both camelCase and snake_case query caches.
2. **Query Scoping + Co-Invalidation Interaction**:
   A task update under `wr-A` patches `tasks(wr-A)`, does not touch `tasks(wr-B)`, and successfully invalidates `workRequestDetail(wr-A)`.
3. **Cross-Domain Linked Record + Task Modal Interaction**:
   An invoice creation linking `taskId: 'task-1'` invalidates `operationsKeys.taskRelated('task-1')`, which triggers live re-render of linked invoices in open `TaskDetailModal`.
4. **Operations Request Approval + Notification Interaction**:
   When an admin approves a transition request in Browser 1, the operations request status updates in `PendingApprovalsInbox` while simultaneously triggering a notification CDC insert that increments the requester's notification bell badge.
5. **Phase Reroute + Gate Recalculation Interaction**:
   Rerouting a work request resets task status and invalidates `workRequestDetail`, dynamically resetting the Kanban board column and gate badges.

### 3.4 Tier 4: Real-World Multi-User Application Scenarios (Spec §5.2)

| Scenario ID | Test Steps | Expected Real-Time Behavior (Zero Page Reload) |
|---|---|---|
| **E2E-RT-1** | User A advances task to `In Progress` in Browser 1. | Browser 2 Kanban board immediately shifts task card to `In Progress` column. |
| **E2E-RT-2** | User A marks task `Completed` in Browser 1. | Browser 2 immediately shifts card to `Completed` and unlocks phase advancement gate. |
| **E2E-RT-3** | User A evaluates QA review: marks task `failed` in Browser 1. | Browser 2 displays red `Failed QA` badge on task card instantly. |
| **E2E-RT-4** | User A triggers phase reroute from QA to `processing`. | Browser 2 shifts work request phase back to `processing` and resets failed task to `In Progress` with `qaStatus: none`. |
| **E2E-RT-5** | User A removes task lead in `TaskDetailModal`. | Browser 2 Kanban card and open `TaskDetailModal` immediately update lead to `Unassigned`. |
| **E2E-RT-6** | User A soft-deletes task in Browser 1 (`deleted_at = now()`). | Browser 2 removes task card from Kanban board immediately. |
| **E2E-RT-7** | User A links invoice or disbursement to task. | Browser 2 `TaskDetailModal` immediately shows the new linked financial record. |
| **E2E-RT-8** | Admin approves transition request in Browser 1. | Requester's Browser 2 immediately increments notification bell count and removes item from pending tab. |

---

## 4. Test Execution & Verification Guide

### 4.1 Prerequisites
- Node.js 20+
- Dependencies installed in `/home/javvii/FreelanceProject/ata-lta-erp-v2/frontend`

### 4.2 TypeScript Typecheck
```bash
cd frontend
npm run typecheck
```
*Expected Output*: Exit code 0, 0 diagnostic errors (`tsc -b`).

### 4.3 Running Real-Time & CDC Test Suites
```bash
cd frontend
npx vitest run \
  src/lib/realtime/__tests__/cdcNormalization.test.ts \
  src/lib/realtime/__tests__/cdcSoftDeleteAndScope.test.ts \
  src/features/dashboard/__tests__/notificationRealtime.test.tsx \
  src/features/operations/__tests__/operationsRealtimeSync.test.tsx
```

### 4.4 Running Full Repository Regression Test Suite
```bash
cd frontend
npm test
```
*Expected Output*:
- **Test Files**: 97+ passed
- **Tests**: >= 1,450 passed
- **Status**: 100% pass rate with zero regressions

---

# Part 2: RBAC & UI Remediation Validation Framework

**Version**: 2.6.0
**Project**: RBAC & UI Remediation across ERP System
**Test Engine**: Jest 29 (Node.js Test Harness & Supertest)
**Target Worktrees**:
- Staging (`backend/` & `erp_prototype/` in `/home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-render`)
- Enterprise React Frontend (`frontend/` in `/home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-enterprise-v2`)

---

## 1. Architectural Testing Doctrine & Testing Philosophy

The test infrastructure for the RBAC & UI Remediation project enforces architectural tenets to guarantee opaque-box test validity, data isolation, and comprehensive coverage across both server-side and client-side boundaries.

### 1.1 Opaque-Box & Requirement-Driven E2E Testing
- All test assertions are derived directly from the authoritative specifications in `ORIGINAL_REQUEST.md` and `PROJECT.md`.
- Tests treat the system as an opaque boundary, evaluating observable behaviors: HTTP status codes (200, 201, 400, 403, 404, 409), RFC-7807 problem details responses, database record filtering, UI scoping functions, tab access guards, URL normalization, and scoped stylesheet rules.
- Test implementations do not couple to unexported internal helper closures or transient implementation quirks.

### 1.2 Strict Server-Side Authorization Authority
- The server is the ultimate authority for all authorization decisions.
- Regardless of client-side validation, all endpoints (`/v1/disbursements`, `/v1/transmittals`, `/v1/operations-requests`, `/v1/operations/templates`) reject unauthorized requests with appropriate status codes (`403 Forbidden`, `400 Bad Request`, `401 Unauthorized`).
- Client UI guards mirror server policies to provide clean UX, disable unauthorized triggers, and gracefully handle server rejection.

### 1.3 Strict Creator-Only Disbursement Privacy & Scoping
- Non-Admin and non-Accounting users can read only disbursements where the immutable `created_by` field matches the authenticated caller's ID.
- No exceptions are permitted for record status (`Released`, `Funded`, `Rejected`), payee (`employee_id`), requester (`requested_by`), managerial role (`Manager`), or Work Request team membership (`concernedWrIds`).
- Creators can view their own disbursements even if `linked_work_request_id` is null or tied to a Work Request where the user is not a member.
- Tab badge counts (`/v1/disbursements/counts`) strictly reflect the creator's scope without leaking counts of other users' records.

### 1.4 Transmittal Task Assignment Enforcement & Non-Blank Gate
- Documentation staff may create, link, update, or send task-linked transmittals ONLY for tasks where they are a primary assignee (`assignee_id`) or co-assignee (`task_assignees`).
- Membership in the parent Work Request team alone is insufficient.
- Submissions with blank or null `linkedTaskId` from Documentation staff are strictly rejected (`400 Bad Request`).
- Task assignments and parent work request relationships are re-verified at every mutation boundary (create, update/relink, send).
- The `tasks` table does not contain an `entity_id` column; entity ownership is strictly verified through the parent `work_requests.entity_id`.

### 1.5 Documentation Billing Request Denial
- Non-Admin accounts with effective Documentation membership (either role `Documentation` or department `Documentation`, including multi-department users such as Documentation + Operations) are strictly prohibited from creating billing requests (`POST /v1/operations-requests` with `type: 'billing'`).
- The server responds with `403 Forbidden` (`detail: 'Documentation users cannot request invoice billing'`).
- Admin and Accounting retain direct invoice linking capabilities.

### 1.6 Retainer Template Governance vs. Admin-Only Task Templates
- Retainer template management (`/v1/operations/templates`) is restricted to users with role `Admin` or role `Manager` via `retainers:edit`.
- Department name `Management` alone without the `Manager` role is insufficient.
- Standard Task Templates (`standard_task_templates`) remain strictly segregated and Admin-only (`403 Forbidden` for Managers and all non-Admins).

### 1.7 Zero-Secret & Clean-Room Data Isolation Invariant
- Tests run against in-memory mock repositories (`supabaseMock`) without external database side effects.
- No real credentials, API tokens, or secrets are hardcoded in test files.
- Each test is isolated with clean state teardown in `beforeEach` (`resetMock`, `seedDefaults`).

### 1.8 Self-Contained Default Backend Testing & Isolated Worktree Support
- Default backend test suites under `backend/tests/e2e/` are completely self-contained and run cleanly without any dependency on sibling checkouts.
- Cross-worktree testing that exercises enterprise React frontend code is isolated in `backend/tests/cross-worktree/` with its own Jest configuration (`backend/tests/cross-worktree/jest.config.js`). It is run via an explicit opt-in command: `npm run test:cross-worktree`, using the configurable `ENTERPRISE_FRONTEND_PATH` environment variable.

---

## 2. Feature Inventory & Test Mapping

| # | Feature ID | Feature Name | Primary Test Location |
|---|------------|--------------|-----------------------|
| 1 | `F01` | Disbursement Read Creator-Only Filter | `backend/tests/unit/modules/disbursements/service.test.js`, `backend/tests/integration/disbursements.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 2 | `F02` | Disbursement Badge Counts Creator Scoping | `backend/tests/unit/modules/disbursements/service.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 3 | `F03` | Disbursement Own Records Outside WR Membership | `backend/tests/unit/modules/disbursements/service.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 4 | `F04` | Related Disbursements Scoping | `backend/tests/unit/modules/operations/remediation.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 5 | `F05` | Invoice Request Documentation Denial | `backend/tests/operationsRequests.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 6 | `F06` | Transmittal Task Assignment Enforcement | `backend/tests/unit/modules/transmittals/service.test.js`, `backend/tests/integration/transmittals.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 7 | `F07` | Transmittal Blank/Whole-Project Rejection | `backend/tests/unit/modules/transmittals/service.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 8 | `F08` | Retainer Templates Manager Role Access | `backend/tests/permission-matrix.snapshot.spec.js`, `backend/tests/unit/lib/permissions.test.js`, `backend/tests/e2e/tier1-features.test.js` |
| 9 | `F09` | React Invoice Request UI Guard | `enterprise-v2/frontend/src/features/operations/__tests__/taskScopingRules.test.tsx`, `backend/tests/cross-worktree/` |
| 10 | `F10` | React Transmittals UI Assignment Guard | `enterprise-v2/frontend/src/features/operations/__tests__/laneCAlignmentGuards.test.tsx`, `backend/tests/cross-worktree/` |
| 11 | `F11` | React Retainer Templates Tab Guard | `enterprise-v2/frontend/src/features/operations/__tests__/laneCAlignmentGuards.test.tsx`, `backend/tests/cross-worktree/` |
| 12 | `F12` | React Pending Approvals Tab Guard | `enterprise-v2/frontend/src/features/operations/__tests__/laneCAlignmentGuards.test.tsx`, `backend/tests/cross-worktree/` |
| 13 | `F13` | React Date Field Layout Verification | `enterprise-v2/frontend/src/features/operations/__tests__/laneCAlignmentGuards.test.tsx`, `backend/tests/cross-worktree/` |
| 14 | `F14` | Prototype Disbursement Read Visibility | `backend/tests/challenger_prototype_alignment.test.js` |
| 15 | `F15` | Prototype Transmittal Modal Guard | `backend/tests/challenger_prototype_alignment.test.js` |
| 16 | `F16` | Prototype Retainer Templates Role Guard | `backend/tests/challenger_prototype_alignment.test.js` |
| 17 | `F17` | Prototype Datepicker Scoped Styling | `backend/tests/challenger_prototype_alignment.test.js` |
| 18 | `F18` | Cross-Worktree Integration & E2E Pass | `backend/tests/e2e/` (Tiers 1-4), `backend/tests/cross-worktree/` |

---

## 3. Test Execution Guide

### 3.1 Running Self-Contained Backend E2E Suites
```bash
cd /home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-render/backend
PORT=0 npm test -- tests/e2e/
```

### 3.2 Running Opt-In Cross-Worktree Integration Harness
```bash
cd /home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-render/backend
npm run test:cross-worktree
# Optionally specify custom frontend checkout path:
# ENTERPRISE_FRONTEND_PATH=/custom/path npm run test:cross-worktree
```

### 3.3 Running Enterprise-v2 React Operations Suites
```bash
cd /home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-enterprise-v2/frontend
npm test -- src/features/operations/
```
