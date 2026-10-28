# Implementation Plan: System Integration

## Backend Implementation Plan

# Backend Implementation Plan: Operations WR & Task Approval Revalidation

## Overview
Implement approved WR creation admission gating (Parcel 1) and task creation review (Parcel 2) per CONTRACT.md policy R1–R10.

## Parcel 1: Work Request Creation Gate (`feat/wr-creation-gate-staging`)
- [x] DB Migration `000073_wr_creation_approval_gate.js`:
  - `creation_approval_status` text/varchar(30) default `'approved'` (CHECK: `approved`, `pending`, `rejected`)
  - `created_by` uuid NULL references `users(id)`
  - `reviewed_by` uuid NULL references `users(id)`
  - `reviewed_at` timestamptz NULL
  - `rejection_reason` text NULL
  - Index on `(entity_id, creation_approval_status)`
- [x] Model & Serialization in `service.js` / `schema.js`:
  - Map `creationApprovalStatus`, `createdBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`
  - Compute `canReviewCreation`, `canResubmit`, `hasManagerLead`
  - Strip client-supplied approval fields from create/update payloads
- [x] Creation Gate Logic:
  - Enforce explicit Admin or Manager role at authoritative WR entry points
  - Admin creates `approved` WR (reviewedBy = actor, reviewedAt = now)
  - Manager creates `pending` WR (reviewedBy = null, reviewedAt = null)
  - Stop enqueueing old fake `wr_phase_transition` operations request
  - Ensure creator can view their newly created pending WR on return
- [x] Gated Visibility:
  - Exclude `creation_approval_status != 'approved'` from normal lists, boards, counts, search, dashboard, task operations
  - Restore cross-entity retrieval fallback for entitled users
- [x] HTTP Endpoints:
  - `GET /v1/operations/work-requests/creation-approvals`
  - `POST /v1/operations/work-requests/:id/creation-approval` (Admin only, reason required on rejection)
  - `POST /v1/operations/work-requests/:id/resubmit-creation` (Creator only, rejected only)
- [x] Parcel 1 Tests & Verification:
  - Dedicated test suite `src/modules/operations/__tests__/wrCreationApprovalGate.test.js` (16/16 passing)
  - Verify existing suites (44/44 passing across operations tests; 19/19 passing integration/operations.test.js)
  - Run backend lint (0 errors on `eslint src`)

## Parcel 2: Task Creation Review (`feat/task-creation-review-staging`)
- [x] Branch Creation: Create `feat/task-creation-review-staging` from verified Parcel 1 commit (`076e08ae`)
- [x] DB Migration `000074_task_creation_approval_review.js`:
  - `approval_status` text/varchar(30) default `'approved'` (CHECK: `approved`, `pending`, `rejected`)
  - `created_by` uuid NULL references `users(id)`
  - `reviewed_by` uuid NULL references `users(id)`
  - `reviewed_at` timestamptz NULL
  - `rejection_reason` text NULL
- [x] Model & Serialization:
  - Map `approvalStatus`, `createdBy`, `reviewedBy`, `reviewedAt`, `rejectionReason`, `canReview`, `canResubmit`
- [x] Task Creation Guard:
  - Pre-insert check: verify parent WR exists, admitted (`creationApprovalStatus === 'approved'`), writable
  - Employee check: require WR `assigned_to` is active Manager entitled to entity; reject before insert if missing
  - Employee creates `pending` task; Admin/Manager creates `approved` task
- [x] Strict Lead-Only Review:
  - Only assigned Manager lead approves/rejects; NO Admin override; co-assignees denied
  - `POST /v1/operations/work-requests/:wrId/tasks/:taskId/creation-approval`
  - `POST /v1/operations/work-requests/:wrId/tasks/:taskId/resubmit-creation`
- [x] Mutation Locks & Material Edits:
  - Lock rejected task mutations (status, checklist, time logs, comments, reorder)
  - Employee material edits (title, description, assignees, dependencies, due date) on approved task reset to `pending`
- [x] Phase & Completion Gates:
  - Pending/rejected tasks block phase advancement and WR completion
- [x] Parcel 2 Tests & Verification:
  - Dedicated test suite `src/modules/operations/__tests__/taskCreationReview.test.js` (32/32 passing)
  - Cherry-picked database acceptance suite `backend/tests/integration/acceptance.js` (45/45 passing on real PostgreSQL)
  - Verify all affected suites and lint (82/82 operations unit tests, 27/27 integration tests, 0 ESLint errors)


---

## Frontend Implementation Plan

# Frontend Implementation Plan: WR Creation Gate & Task Creation Review

**Target Worktree:** `/home/javvii/FreelanceProject/worktrees/wr-creation-gate-enterprise-v2`
**Baseline Commit:** Based on `upstream/enterprise-v2` (`f0aadb85`)
**Parcels & Branches:**
- **Parcel 3 (WR Creation Gate UI):** `feat/wr-creation-gate-enterprise-v2` (current branch)
- **Parcel 4 (Task Creation Review UI):** `feat/task-creation-review-enterprise-v2` (to be branched from verified Parcel 3 commit)

---

## 1. Contract & Policy Foundations

Derived from `/home/javvii/FreelanceProject/worktrees/operations-wr-approval-revalidation/docs/wr-approval-revalidation/CONTRACT.md` and `REVIEW.md`:

### Policy Rules Summary
* **R1 (Role Gate):** Only explicit `Admin` and `Manager` roles can create WRs. Admin creates approved WRs. Manager creates pending WRs (`creationApprovalStatus: 'pending'`). Non-manager/non-admin employees cannot create WRs.
* **R2 (WR Visibility Isolation):** Pending/rejected WRs stay out of regular active lists (`WorkRequestList`), boards (`PhaseKanbanBoard`), counts, search, and dashboard. Entitled Admins see all pending creation requests via creation inbox (`scope=all`); Managers see their own submissions (`scope=mine`). Admins can Approve or Reject (reason mandatory). Creators can correct and resubmit rejected WRs calling dedicated `resubmit-creation` API (`POST /operations/work-requests/:id/resubmit-creation`).
* **R3 (Employee Task Gate):** Employees (roles other than Admin/Manager) can only add tasks to admitted, writable WRs with an active Manager lead (`workRequest.hasManagerLead === true`). Fail-closed: `undefined` or missing is NOT eligible. If `hasManagerLead !== true`, employee task creation is disabled with clear feedback.
* **R4 (Task Pending Usability):** Employee-created tasks are `approvalStatus: 'pending'`, but immediately usable (time logging, status, checklists, inspection) within existing permissions.
* **R5 (Designated Lead Review Authority):** ONLY the WR's assigned Manager lead (`workRequest.assignedTo === user.id` AND `user.role === 'Manager'`) can Approve/Reject employee tasks. **STRICTLY NO Admin override**; never trust a loose capability flag to grant Admin review.
* **R6 (Task Rejection & Resubmission):** Rejection mandates a reason. Rejected tasks are locked from ordinary mutations (status, time logging, checklists). Creator may edit and resubmit (`resubmit-creation` at `POST /operations/work-requests/:wrId/tasks/:taskId/resubmit-creation`), resetting status to `pending`.
* **R8 / Reviewer Identity:** Reviewed by authenticated actor, optimistic concurrency via `version` / `expectedVersion`. Scope/identity must validate matching both task ID and WR ID.
* **Cache & Identity Safeguards:** Invalidate scoped queries properly. Eliminate cross-WR previous-data leaks (`keepPreviousData` across WR keys) and eliminate wrong-ID array fallbacks (`res.data[0]`).

---

## 2. Parcel 3: Work Request Creation Gate UI (`feat/wr-creation-gate-enterprise-v2`)

### 2.1 Domain Types & API Client (`frontend/src/features/operations/api/`)
- Update `WorkRequest` in `types.ts`:
  - `creationApprovalStatus?: 'approved' | 'pending' | 'rejected'`
  - `createdBy?: string | null`
  - `reviewedBy?: string | null`
  - `reviewedAt?: string | null`
  - `rejectionReason?: string | null`
  - `canReviewCreation?: boolean`
  - `canResubmit?: boolean`
  - `hasManagerLead?: boolean`
- Update `queryKeys.ts`:
  - `operationsKeys.workRequestCreationApprovals: (status?: string, scope?: 'mine' | 'all') => ['operations', 'workRequests', 'creationApprovals', status, scope]`
- Add API functions in `useWorkRequests.ts`:
  - `useWorkRequestCreationApprovals(params: { status?: 'pending' | 'rejected' | 'approved'; scope?: 'mine' | 'all' }, options?: { enabled?: boolean })` -> calls `GET /operations/work-requests/creation-approvals?status=...&scope=...`
  - Mutation `useWorkRequestCreationApproval()` -> calls `POST /operations/work-requests/:id/creation-approval` with `{ decision: 'approve' | 'reject', reason?: string, expectedVersion: number }`
  - Mutation `useResubmitWorkRequestCreation()` -> calls `POST /operations/work-requests/:id/resubmit-creation` with `{ expectedVersion: number, data?: UpdateWorkRequestInput }`

### 2.2 Role-Gated WR Creation UI
- Update `WorkRequestModal.tsx`:
  - Check `canCreateWr = user?.role === 'Admin' || user?.role === 'Manager'`. If not, render permission restriction notice and disable creation.
  - If `user?.role === 'Manager'`, display an informative indicator that Manager-created WRs enter pending Admin approval.
  - On submit:
    - Success messaging: "Work Request Submitted for Admin Approval" for Manager vs "Work Request Created" for Admin.
    - Modal closes cleanly, draft cleared.
- Update `WorkRequestList.tsx` and `operations.tsx`:
  - Gate "New Work Request" action button behind `user?.role === 'Admin' || user?.role === 'Manager'`.
- In `RetainerGenerateModal.tsx` & `OtherTemplateGenerateModal.tsx`:
  - Ensure WR creation is restricted to Admin & Manager.

### 2.3 Exclude Pending / Rejected WRs from Regular Lists & Boards
- In `WorkRequestList.tsx`:
  - Filter out `wr.creationApprovalStatus === 'pending' || wr.creationApprovalStatus === 'rejected'`. Grandfathered records (undefined or 'approved') remain visible.
- In `PhaseKanbanBoard.tsx`:
  - Filter `workRequests` dropdown switcher to exclude `creationApprovalStatus === 'pending' || wr.creationApprovalStatus === 'rejected'`.
- In `operations.tsx`:
  - Ensure count badges reflect active/approved requests.

### 2.4 Admin Creation Inbox & Manager Own Submissions UI
- Extend `PendingApprovalsInbox.tsx` (or embed dedicated sub-views):
  - Segmented control / sub-nav:
    - If `user.role === 'Admin'`: "Phase Transitions" vs "WR Creation Approvals" (inbox of pending WRs awaiting Admin sign-off).
    - If `user.role === 'Manager'`: "Phase Transitions" vs "My WR Submissions" (list of Manager's own created WRs: pending, rejected, approved).
  - Admin Creation Inbox view:
    - Displays pending WR submissions with requester, client, entity, priority, requested tasks preview.
    - Actions: **Approve** (calls `/operations/work-requests/:id/creation-approval` with `{ decision: 'approve', expectedVersion }`), **Reject** (opens `RejectReasonModal`, calls with `{ decision: 'reject', reason, expectedVersion }`).
    - Stale / OCC conflict handling (`expectedVersion`).
  - Manager Own Submissions view:
    - Displays user's submitted WRs with badge (`Pending Approval`, `Rejected`, `Approved`).
    - If rejected, displays `rejectionReason` prominently with a call to action.
    - Action: **Edit & Resubmit** (opens edit modal or inline sheet, submits to `/operations/work-requests/:id/resubmit-creation` with `{ expectedVersion, data }`).

### 2.5 Verification & Commit (Parcel 3)
- Run Vitest on affected and new tests.
- Run typecheck and lint on changed files.
- Run build.
- Commit to `feat/wr-creation-gate-enterprise-v2`.

---

## 3. Parcel 4: Task Creation Review UI (`feat/task-creation-review-enterprise-v2`)

### 3.1 Domain Types & API Client (`frontend/src/features/operations/api/`)
- Update `Task` in `types.ts`:
  - `approvalStatus?: 'approved' | 'pending' | 'rejected'`
  - `createdBy?: string | null`
  - `reviewedBy?: string | null`
  - `reviewedAt?: string | null`
  - `rejectionReason?: string | null`
  - `canReview?: boolean`
  - `canResubmit?: boolean`
- In `useTasks.ts`:
  - Fix cross-WR leak: In `useWorkRequestTasks`, ensure `placeholderData` does not leak data across distinct `workRequestId` keys.
  - Fix wrong-ID fallback: In `useTaskDetail`, return `null` if requested task is not in array (`find(...) ?? null`).
  - Add `useTaskCreationApproval()` -> calls `POST /operations/work-requests/:wrId/tasks/:taskId/creation-approval` with `{ decision: 'approve' | 'reject', reason?: string, expectedVersion: number }`.
  - Add `useResubmitTaskCreation()` -> calls `POST /operations/work-requests/:wrId/tasks/:taskId/resubmit-creation` with `{ expectedVersion: number, data?: UpdateTaskInput }`.
  - Standardize query key dimensions and cache invalidations.

### 3.2 Task Creation Gating (Manager Lead Guard)
- In `QuickAddCard.tsx` / `PhaseKanbanBoard.tsx`:
  - Check `currentWr?.hasManagerLead`:
    - If user is Employee and `hasManagerLead === false`: Disable task creation with explicit alert/tooltip: *"Task creation is disabled: this Work Request has no assigned Manager lead."*
    - If user is Admin or Manager, exempt from lead requirement.
  - When employee creates a task, optimistic / local state reflects `approvalStatus: 'pending'`, but task is immediately usable.

### 3.3 Independent Task Approval Markers (Board Cards & Side Peek)
- Design tokens from `.taste-skill/direction.json` (humanist, institutional ledger):
  - Pending marker: Amber badge (`bg-[#FEFCE8] text-[#854D0E] border-[#FDE047]`) with `Clock` icon and text `Pending Lead Approval`.
  - Rejected marker: Crimson badge (`bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5]`) with `XCircle` icon and text `Review Rejected`.
  - Independent of execution status (`Draft`, `In Progress`, `Completed`) and QA status (`Passed`, `Failed`).
- Rendered on:
  1. **Kanban task cards** (`PhaseKanbanBoard.tsx`)
  2. **Side peek task breakdown rows** (`WorkRequestSidePeek.tsx`)
  3. **Task detail modal header** (`TaskDetailModal.tsx`)

### 3.4 Authorized Assigned Manager Lead-Only Review Actions
- Check authorization in `taskScope.ts`:
  - `canReviewTaskCreation(user, task, workRequest)`:
    - Only true if `workRequest.assignedTo === user.id` AND `user.role === 'Manager'` (or `task.canReview === true`).
    - **NO Admin override** (explicitly enforced!).
- When authorized:
  - Board cards and side peek display quick actions:
    - **Approve** button (check icon)
    - **Reject** button (X icon -> triggers `RejectReasonModal`)
- When rejected:
  - Task is visibly locked: mutations disabled (status change, time logging, checklists).
  - Creator sees rejection reason and **Edit & Resubmit** button.

### 3.5 Cross-WR Query Caching & Isolation Remediation
- In `PhaseKanbanBoard.tsx`:
  - Reset `selectedTask` to `null` on WR switch.
- In `WorkRequestSidePeek.tsx`:
  - Reset `expandedTaskIds`, preview/viewer doc states when `workRequestId` changes.
- In `TaskDetailModal.tsx`:
  - Add `isTaskOfWorkRequest(task, effectiveWrId)` check; close modal or disallow stale display.

### 3.6 Verification & Commit (Parcel 4)
- Run Vitest on task creation review tests.
- Run typecheck and lint on changed files.
- Run build.
- Commit to `feat/task-creation-review-enterprise-v2`.

---

## 4. Verification Matrix & Evidence Tracker

| Check | Target | Status |
| :--- | :--- | :--- |
| Baseline Vitest (3 files, 37 tests) | Frontend | PASS |
| Baseline Typecheck (`tsc -b`) | Frontend | PASS |
| Baseline Build (`vite build`) | Frontend | PASS |
| Parcel 3 WR Creation Gate Tests (4 files, 47 tests) | Frontend | PASS |
| Parcel 3 Typecheck / Lint / Build | Frontend | PASS |
| Parcel 4 Task Review Tests | Frontend | PENDING |
| Parcel 4 Typecheck / Lint / Build | Frontend | PENDING |
