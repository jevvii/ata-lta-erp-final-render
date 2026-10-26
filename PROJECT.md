# ATA & LTA ERP — System Projects & Architecture Documentation

This repository tracks two major remediation milestones:
1. **Real-Time Caching & CDC Synchronization Remediation** (Milestones M1–M6, documented in Part 1).
2. **RBAC & UI Remediation across ERP System** (Lanes A–D & E2E Track, documented in Part 2).

---

# Part 1: Real-Time Caching & CDC Synchronization Remediation

## Architecture
The system comprises a Node.js/Express backend (`Project4_Final-Render` / `backend`) and a React 19 single-page application (`ata-lta-erp-v2` / `frontend`). Database and change data capture (CDC) are powered by Supabase (PostgreSQL with Row Level Security and Realtime logical replication via publication `supabase_realtime`).

Data flow:
1. Database mutation occurs via backend API (or direct client action where permitted).
2. PostgreSQL logical replication publishes CDC payload (`INSERT`, `UPDATE`, `DELETE`) to the `supabase_realtime` publication with `REPLICA IDENTITY FULL`.
3. Frontend client subscribes via `useEntityRealtimeSync` hook over WebSocket channel `entity-sync:${table}:${activeEntity}`.
4. Payload passes through normalization dictionary producing dual camelCase / snake_case properties.
5. TanStack Query cache is patched in-place (or invalidated) and relevant cross-entity query keys are co-invalidated.
6. React UI updates reactively without page reload.

## Feature Inventory
| # | Feature Name | Description | Milestone | Spec Section | Status |
|---|--------------|-------------|-----------|--------------|--------|
| 1 | Enable Collaborative Realtime Publication & Replica Identity | Add tables (`operations_requests`, `notifications`, `transmittals`, `documents`, `task_assignees`) to `supabase_realtime` publication with `REPLICA IDENTITY FULL` | M1 | SPEC §4 Parcel 1 | DONE |
| 2 | Verification Unit Tests for Publication Migration | Automated unit test verifying migration script creates publication tables and sets replica identity | M1 | SPEC §4 Parcel 1 | DONE |
| 3 | Core CDC Reconciler Overhaul | Rewrite `useEntityRealtimeSync.ts` to implement single-record detail patching, array-item patching, soft-delete eviction, and parent phase container patching | M2 | SPEC §4 Parcel 2 | DONE |
| 4 | Dual-Case Normalization Engine | Build normalization dictionary (`normalizeCdcTask`, `normalizeCdcWorkRequest`, `normalizeCdcOperationsRequest`, `normalizeCdcNotification`, `normalizeCdcPayload`) ensuring dual camelCase/snake_case keys | M2 | SPEC §4 Parcel 2 | DONE |
| 5 | Accurate Soft-Delete Eviction | Detect soft-deletes (`deleted_at != null || deletedAt != null`) as `isDelete = true`, evicting detail cache, filtering list queries, and removing embedded task from parent WR | M2 | SPEC §4 Parcel 2 | DONE |
| 6 | Scoped Task List Query Matcher | Enforce `isTaskListOfTargetWr` so task mutations under `wr-A` never pollute `wr-B` task lists | M2 | SPEC §4 Parcel 2 | DONE |
| 7 | Task Mutation Cross-Domain Co-Invalidations | When tasks update, co-invalidate `workRequestDetail(wrId)`, `workRequestCounts(entity)`, and `taskRelated(taskId)` | M2 | SPEC §4 Parcel 2 | DONE |
| 8 | Linked Entity Co-Invalidations | Invoices, disbursements, transmittals, and documents co-invalidate `taskRelated(taskId)` on relevant mutations | M2 | SPEC §4 Parcel 2 | DONE |
| 9 | Operations Requests Co-Invalidations | Request mutations co-invalidate `requests()`, `requestCounts()`, and parent `workRequestDetail(wrId)` | M2 | SPEC §4 Parcel 2 | DONE |
| 10 | User-Scoped Realtime Notification Hook | Implement `useNotificationRealtimeSync` hook subscribing to `notifications` filtered by `user_id=eq.${user.id}` | M3 | SPEC §4 Parcel 3 | DONE |
| 11 | Immediate Unread Counter Store Mutation | Increment `unreadCount` in `useSessionStore` and prepend incoming notification to `dashboardKeys.notifications.all` on INSERT | M3 | SPEC §4 Parcel 3 | DONE |
| 12 | Notification Bell Panel Live Mount | Mount `useNotificationRealtimeSync` in `NotificationBellPanel.tsx` ensuring instant badge counter increments | M3 | SPEC §4 Parcel 3 | DONE |
| 13 | Operations Requests Real-Time Subscription | Mount `useEntityRealtimeSync({ table: 'operations_requests' })` in `frontend/src/routes/operations.tsx` | M4 | SPEC §4 Parcel 4 | DONE |
| 14 | Reactive Approvals Inbox & Tab Badge | Ensure pending approvals inbox and `pendingCount` tab badges reactively update on request creation, approval, and rejection | M4 | SPEC §4 Parcel 4 | DONE |
| 15 | Kanban Reactive Task Selection Synchronization | Synchronize `selectedTask` with live TanStack tasks query cache in `PhaseKanbanBoard.tsx` when task attributes change | M5 | SPEC §4 Parcel 5 | DONE |
| 16 | Soft-Deleted Task Filtering in Kanban Board | Exclude soft-deleted tasks (`!t.deletedAt && !t.deleted_at`) from `activeTasks` gate calculations and phase column views | M5 | SPEC §4 Parcel 5 | DONE |
| 17 | Task Detail Modal Live Query Binding | Bind `TaskDetailModal.tsx` to `useTaskDetail(task?.workRequestId, task?.id)` falling back to prop `currentTask = liveTask || task` | M5 | SPEC §4 Parcel 5 | DONE |
| 18 | Modal Close Linked Entity Invalidation | Invalidate `operationsKeys.taskRelated(task.id)` on closure of Invoice, Disbursement, Transmittal, and Document child modals | M5 | SPEC §4 Parcel 5 | DONE |
| 19 | Dual-Track E2E Test Suite & Adversarial Hardening | Comprehensive test coverage across all tiers, 100% pass on backend (48/48 suites) and frontend (`realtime`, `operations`, `dashboard`), clean typecheck, adversarial stress testing | M6 | SPEC §5 Verification | DONE |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend Realtime Publication & Replica Identity | `backend/migrations/000061_enable_collaborative_realtime_publication.js`, unit test in `backend/tests/unit/` | none | DONE |
| M2 | Frontend Core CDC Reconciler Overhaul | `frontend/src/lib/realtime/useEntityRealtimeSync.ts`, unit tests in `frontend/src/lib/realtime/` | none | DONE |
| M3 | Real-Time Notifications Engine | `frontend/src/features/dashboard/api/useNotifications.ts`, `frontend/src/features/dashboard/components/NotificationBellPanel.tsx` | M2 | DONE |
| M4 | Real-Time Operations Requests | `frontend/src/routes/operations.tsx`, `frontend/src/features/operations/components/PendingApprovalsInbox.tsx` | M2 | DONE |
| M5 | Kanban & Task Detail Modal Reactive Binding | `frontend/src/features/operations/components/PhaseKanbanBoard.tsx`, `frontend/src/features/operations/components/TaskDetailModal.tsx` | M2 | DONE |
| M6 | E2E Test Suite Verification & Adversarial Hardening | Full backend test suite (48/48 suites), frontend test suites (`realtime`, `operations`, `dashboard`), type checks, adversarial test coverage | M1, M2, M3, M4, M5 | DONE |

## Interface Contracts

### 1. Backend Realtime Publication Contract
- Publication name: `supabase_realtime`
- Newly registered tables: `operations_requests`, `notifications`, `transmittals`, `documents`, `task_assignees`
- Replica Identity: `FULL` on `work_requests`, `tasks`, `operations_requests`, `notifications`, `disbursements`, `invoices`, `transmittals`, `documents`, `task_assignees`
- Migration file: `backend/migrations/000061_enable_collaborative_realtime_publication.js`

### 2. Normalization Dictionary Contract
- `normalizeCdcTask(record)`:
  - Produces dual keys: `workRequestId` & `work_request_id`, `qaStatus` & `qa_status`, `dueDate` & `due_date`, `displayOrder` & `display_order`, `assigneeId` & `assignee_id`, `assigneeName` & `assignee_name`, `requiredLinkType` & `required_link_type`, `phaseEnteredAt` & `phase_entered_at`, `assignedBy` & `assigned_by`, `assignedAt` & `assigned_at`, `deletedAt` & `deleted_at`.
- `normalizeCdcWorkRequest(record)`:
  - Produces dual keys: `workRequestNo` & `work_request_no`, `clientId` & `client_id`, `clientName` & `client_name`, `onHold` & `on_hold`, `phaseEnteredAt` & `phase_entered_at`, `requestedBy` & `requested_by`, `assignedTo` & `assigned_to`, `coAssignees` & `co_assignees`, `dueDate` & `due_date`, `deletedAt` & `deleted_at`.
- `normalizeCdcOperationsRequest(record)`:
  - Normalizes `request_type` -> `type` & `request_type`, `work_request_id` -> `workRequestId` & `work_request_id`, `linked_task_id` -> `linkedTaskId` & `linked_task_id`, `client_id` -> `clientId` & `client_id`, `rejection_reason` -> `rejectionReason` & `rejection_reason`.
- `normalizeCdcNotification(record)`:
  - Normalizes `user_id` -> `userId` & `user_id`, `read_at` -> `readAt` & `read_at`, `created_at` -> `createdAt` & `created_at`.

### 3. Soft-Delete Contract
- `isSoftDeleted`: `Boolean(incomingRecord.deleted_at) || Boolean(incomingRecord.deletedAt)`
- `isDelete`: `eventType === 'DELETE' || isSoftDeleted || (eventType !== 'UPDATE' && !payloadObj.new && Boolean(payloadObj.old))`
- When `isDelete === true`:
  - Detail query cache: set to `null` or remove
  - List queries: filter out `item.id !== id`
  - Parent WorkRequest phase containers: call `patchTaskInPhases(wr, id, undefined)`

### 4. Query Scope & Co-Invalidation Contract
- Task query targeting: `isTaskListOfTargetWr` checks `Array.isArray(qKey) && qKey.includes('tasks') && qKey.includes(targetWrId)`.
- Task mutations co-invalidate:
  - `operationsKeys.workRequestDetail(targetWrId)`
  - `operationsKeys.workRequestCounts(activeEntity)`
  - `operationsKeys.taskRelated(id)`
- Linked entity co-invalidations:
  - Invoices / Disbursements with `task_id` -> `operationsKeys.taskRelated(taskId)`
  - Transmittals / Documents with `linked_task_id` -> `operationsKeys.taskRelated(taskId)`
  - Operations requests -> `operationsKeys.requests()`, `operationsKeys.requestCounts(activeEntity)`, and `operationsKeys.workRequestDetail(workRequestId)`

### 5. Notification Real-Time Contract
- Channel: `useEntityRealtimeSync<RawNotificationItemApi>` on table `'notifications'`
- Filter: `user_id=eq.${user.id}`
- Root Key: `dashboardKeys.notifications.all`
- On INSERT: Immediately increment `unreadCount` in `useSessionStore` and prepend to notifications list.

---

# Part 2: RBAC & UI Remediation across ERP System

## Architecture
The system comprises a Node.js/Express backend, an enterprise React frontend (`ata-lta-erp-final-enterprise-v2`), and a legacy prototype SPA (`erp_prototype/` in `ata-lta-erp-final-render`).
Database access utilizes Supabase (PostgreSQL with Row Level Security and service-role admin access in backend services).

Data flow & Enforcement model:
1. **Server-Side Authorization Authority**: All authorization decisions for Disbursements reads, Invoice Requests, Transmittal operations, and Retainer Template modifications are strictly enforced in backend controllers and services.
2. **Client Alignment**: React and Prototype UIs reflect server-side permissions to provide clean UX, disable/hide unauthorized triggers, normalize deep links, and gracefully handle any unauthorized attempts.
3. **Dual Worktree Structure**:
   - `ata-lta-erp-final-render` (`staging` branch @ `2efa1da`): Backend APIs (`backend/`) and Prototype SPA (`erp_prototype/`).
   - `ata-lta-erp-final-enterprise-v2` (`enterprise-v2` branch @ `bde5aa2`): Enterprise React frontend (`frontend/`).

---

## Feature Inventory
Every feature identified during the Survey phase is enumerated here with its assigned milestone:

| # | Feature ID | Feature Name | Description | Milestone | Source |
|---|---|---|---|---|---|
| 1 | `F01` | Disbursement Read Creator-Only Filter | For non-Admin/non-Accounting users, `listDisbursements` and `getDisbursementById` strictly require `created_by === caller.id`. Remove status, payee, requester, and WR bypasses. | M1 | Survey / Spec §3, §5 |
| 2 | `F02` | Disbursement Badge Counts Creator Scoping | `getDisbursementCounts` counts only records where `created_by === caller.id` for non-Admin/non-Accounting users. | M1 | Survey / Spec §3, §5 |
| 3 | `F03` | Disbursement Own Records Outside WR Membership | Users can view own created disbursements even if `linked_work_request_id` is null or in a WR where user is not a team member. | M1 | Survey / Spec §3, §5 |
| 4 | `F04` | Related Disbursements Scoping | `getWorkRequestRelated` and `getTaskRelated` in operations service filter disbursements by `created_by === caller.id` for non-Admin/non-Accounting callers. | M1 | Survey / Audit §4 |
| 5 | `F05` | Invoice Request Documentation Denial | Non-Admin accounts with effective Documentation membership cannot create billing requests (`type: 'billing'`), returning 403 Forbidden. | M2 | Survey / Spec §3, §6 |
| 6 | `F06` | Transmittal Task Assignment Enforcement | Transmittal create, update, and send require non-Admin Documentation users to be primary or co-assignee on the linked task (`isTaskAssignee`). | M2 | Survey / Spec §3, §6 |
| 7 | `F07` | Transmittal Blank/Whole-Project Rejection | Submitting a transmittal without a valid task selection is rejected (400 Bad Request) for restricted Documentation users. | M2 | Survey / Spec §3, §6 |
| 8 | `F08` | Retainer Templates Manager Role Access | Grant `retainers:edit` to role `Manager` in permissions matrix, while department name alone is insufficient and task templates remain Admin-only. | M2 | Survey / Spec §3, §8 |
| 9 | `F09` | React Invoice Request UI Guard | `canRequestInvoice` returns false for users with Documentation membership. Admin/Accounting direct linking preserved. | M3 | Survey / Spec §3, §6 |
| 10 | `F10` | React Transmittals UI Assignment & Task Guard | `canLinkTransmittal` requires `isTaskAssignee` for Documentation. `TransmittalFormModal` filters tasks and rejects blank selections. | M3 | Survey / Spec §3, §6 |
| 11 | `F11` | React Retainer Templates Tab & Deep-Link Guard | Guard `retainer-templates` tab trigger and content to Admin and role Manager. Normalize unauthorized tab URLs to `work-requests`. | M3 | Survey / Spec §3, §7 |
| 12 | `F12` | React Pending Approvals Tab & Deep-Link Guard | Guard `pending-approvals` tab trigger, content, and queries to users with approval authority. Normalize unauthorized tab URLs to `work-requests`. | M3 | Survey / Spec §3, §7 |
| 13 | `F13` | React Date Field Layout Verification | Verify Work Request modal date picker layout across viewports (confirmed non-defective in React; keep layout stable). | M3 | Survey / Spec §7 |
| 14 | `F14` | Prototype Disbursement Read Visibility Alignment | `canViewDisbursement` restricts non-Admin/non-Accounting to `d.createdBy === this.user.id`. Remove status and WR team bypasses. | M4 | Survey / Spec §8 |
| 15 | `F15` | Prototype Transmittal Modal Whole-Project & Task Guard | Remove "Whole Project" option and filter task dropdown to assigned tasks for Documentation users in transmittal modal. | M4 | Survey / Spec §8 |
| 16 | `F16` | Prototype Retainer Templates Role Guard | Gating in `workflow.js` updated to allow `Admin` and `Manager` (replacing `workflow:approve`). | M4 | Survey / Spec §8 |
| 17 | `F17` | Prototype Work Request Datepicker Scoped Styling | Apply scoped CSS rule (`#wr-form .notion-prop--due-date .mdp-wrapper { max-width: 220px; width: 100%; }`) to prevent flex stretching in WR modal. | M4 | Survey / Spec §8, Audit §1 |
| 18 | `F18` | Cross-Worktree Integration & E2E Test Suite | Comprehensive opaque-box E2E test verification across Tiers 1-4 and adversarial Tier 5, with final evidence report. | M5 | Survey / ORIGINAL_REQUEST |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|---|---|---|---|
| E2E | E2E Testing Track | Design and build comprehensive opaque-box test suite across Tiers 1-4, publish TEST_READY.md | none | DONE |
| M1 | Lane A: Disbursements Backend | F01, F02, F03, F04: Server-side creator-only read enforcement and counts scoping | none | DONE |
| M2 | Lane B: Billing & Transmittals Backend | F05, F06, F07, F08: Server-side billing request denial, transmittal task assignment, and retainer template permissions | none | DONE |
| M3 | Lane C: React Frontend | F09, F10, F11, F12, F13: Client-side UI guards, tab normalization, and date field stability | M1, M2 interface contracts | DONE |
| M4 | Lane D: Prototype UI | F14, F15, F16, F17: Legacy SPA authorization alignment and scoped datepicker CSS fix | M1, M2 interface contracts | DONE |
| M5 | Final Milestone: Integration & E2E Pass | F18: Pass 100% of E2E test suite (Tiers 1-4), adversarial hardening (Tier 5), and generate Final Evidence Report | M1, M2, M3, M4, E2E | DONE |

---

## Interface Contracts

### 1. Operations Requests (`POST /v1/operations-requests`)
- **Request Body**: `{ type: 'billing', workRequestId: string, taskId: string, ... }`
- **Caller Context**: `req.user` with `role` and `departments` array.
- **Authorization Rule**: If `user.role !== 'Admin'` AND (`user.role === 'Documentation'` OR `user.departments.includes('Documentation')`), return `403 Forbidden`:
  `{ title: 'Forbidden', detail: 'Documentation users cannot request invoice billing' }`.
- **Exemptions**: Admin and Accounting can link invoices directly without operations requests.

### 2. Transmittals API (`/v1/transmittals`)
- **Schema & Entity Derivation**:
  - The `tasks` table contains no `entity_id` column in the checked-in schema. Entity scope is derived authoritative from `work_requests.entity_id` via the task's parent work request relationship.
  - Queries must not select `tasks.entity_id`.
- **Create (`POST /`)**:
  - `data.linkedTaskId` is mandatory for Documentation users. If missing or blank -> `400 Bad Request` (`detail: 'A valid linked task is required for transmittals'`).
  - Verify caller is primary or co-assignee via `isUserAssignedToTask(data.linkedTaskId, req.user.id)`. If false -> `403 Forbidden`.
  - Validate task belongs to the requested work request and matches entity and client boundaries.
- **Update (`PUT /:id`)**:
  - Re-verify task assignment for effective `linkedTaskId`. Reject clearing `linkedTaskId` to null for Documentation users.
- **Send (`POST /:id/send`)**:
  - Re-verify caller assignment on linked task at send time. If false -> `403 Forbidden`.

### 3. Disbursements API (`/v1/disbursements`)
- **List (`GET /`) & Detail (`GET /:id`) & Counts (`GET /counts`)**:
  - If `user.role === 'Admin'` OR `user.role === 'Accounting'` OR `user.departments.includes('Accounting')`: full entity access.
  - All other users: strictly `created_by === req.user.id`.
  - No exceptions for `status`, `employee_id` (payee), `requested_by` (requester), `Manager` role, or WR team membership.
  - Own records do not require `linked_work_request_id` to be in `concernedWrIds`.

### 4. Retainer Templates API (`/v1/operations/templates`, `/retainer-templates`)
- Access restricted to `user.role === 'Admin'` OR `user.role === 'Manager'`.
- Granted via `retainers:edit` permission assigned to role `Manager`.
- Department name `Management` alone without Manager role is insufficient.

---

## Code Layout

### Staging Worktree (`/home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-render`)
- **Lane A Ownership**:
  - `backend/src/modules/disbursements/**`
  - `backend/tests/unit/modules/disbursements/**`
  - `backend/tests/integration/disbursements.test.js`
- **Lane B Ownership**:
  - `backend/src/modules/transmittals/**`
  - `backend/src/modules/operationsRequests/**`
  - `backend/tests/unit/modules/transmittals/**`
  - `backend/tests/integration/transmittals.test.js`
  - `backend/tests/operationsRequests.test.js`
- **Lane D Ownership**:
  - `erp_prototype/js/auth.js`
  - `erp_prototype/js/workflow.js`
  - `erp_prototype/js/users.js`
  - `erp_prototype/css/styles.css`
- **Shared / Coordinator Files**:
  - `backend/src/lib/permissions.js`
  - `backend/src/modules/operations/**`
  - `backend/src/modules/reports/**`
- **E2E & Cross-Worktree Test Harness**:
  - Default self-contained E2E suites: `backend/tests/e2e/tier1-features.test.js`, `tier2-boundaries.test.js`, `tier3-cross-feature.test.js`, `tier4-application-scenarios.test.js` (runnable in isolation with zero sibling dependency).
  - Opt-in cross-worktree integration: `backend/tests/cross-worktree/` (invoked via `npm run test:cross-worktree`).

### Enterprise-v2 Worktree (`/home/kyle/render-ata-lta-erp-final/ata-lta-erp-final-enterprise-v2`)
- **Lane C Ownership**:
  - `frontend/src/features/operations/lib/taskScope.ts`
  - `frontend/src/features/operations/components/TaskDetailModal.tsx`
  - `frontend/src/features/operations/components/WorkRequestModal.tsx`
  - `frontend/src/features/operations/components/TransmittalFormModal.tsx`
  - `frontend/src/routes/operations.tsx`
  - `frontend/src/features/operations/__tests__/**`
