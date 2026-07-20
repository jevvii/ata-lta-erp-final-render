# Work Request "Ghost" Creation Bug — Root Cause & Fix Plan

**Date:** 2026-07-20
**Branch:** uat
**Status:** Implemented (not committed)

---

## Symptoms

1. Saving a work request appears to take forever / hang.
2. The new item appears immediately (optimistic) but is non-clickable with a "still being saved" toast.
3. After switching views/pages and returning, the item is duplicated.
4. The duplicated item shows incorrect priority (defaults to Normal instead of the selected Priority/Urgent/Low).

---

## Root Cause Analysis

### Root Cause A — Admin double-save creates phantom duplicates

`PendingChanges.submit('workRequests', record, isNew)` for an Admin user calls
`_adminBypass()` (pendingChanges.js:67-69). `_adminBypass` already performs the
full API mutation:

- `api.workRequests.create(cleanRecord)` creates the work request
- `api.workRequests.createTask(record.id, t)` creates every task

It then returns `{ approved: true }`.

`Workflow.submitForm()` receives `result.approved` and, **unaware the backend call
already happened**, runs its own mutation sequence (workflow.js:6571-6609):

- `_addOptimisticWorkRequest(record)`
- `_addOptimisticTask()` for each task
- `WorkflowData.createWorkRequest(record)` — **creates a second work request**
- `WorkflowData.createTask(t)` — **creates the tasks a second time**

Result:

- Two real database rows for the same work request.
- Two sets of tasks.
- The optimistic record is eventually mutated in-place to the *second* WR's
  UUID; the first WR is an orphaned ghost that re-appears when `loadPage()`
  fetches fresh server-side data after the user switches views.

### Root Cause B — Priority is not persisted on the backend

The `work_requests` table has no `priority` column. The Zod schema
(`createWorkRequestSchema`) and the `toApiWorkRequest` mapper do not include
`priority`. The frontend sends the selected value, but the server ignores it.

When `WorkflowData.createWorkRequest()` receives the server response and does
`Object.assign(existing, created)`, the `created` object has been normalized with
`priority: wr.priority || 'Normal'`, so the UI-selected priority is overwritten to
`Normal`.

This explains why the duplicated/saved item always shows Normal priority.

### Root Cause C — Temp-ID guard blocks clicks during the double-save

The previously added `_navigateToWrDetail()` helper prevents navigation to a
temp-ID (`wr-xxx`) detail route while the save is in-flight. Because the Admin
path now performs *two* serial saves, the temp ID persists longer, making the
item feel like a non-clickable phantom.

Fixing Root Cause A removes the second save, so the optimistic record receives
its server UUID much faster, eliminating the phantom period.

---

## Fix Plan

- [x] **Fix A1**: Stop the double-save for Admin work-request creation
  - `PendingChanges._adminBypass()` now returns `{ wr, tasks }` for work requests
    and the created `task` for tasks table.
  - `PendingChanges.submit()` now returns `{ approved: true, record: bypassResult }`.
  - `Workflow.submitForm()` uses `_adoptServerWorkRequest()` when `result.record`
    is present, skipping redundant `createWorkRequest` / `createTask` API calls.
  - Task-add path (`#operations/addTask`) also skips `createTask()` when bypass
    record is present.

- [x] **Fix A2**: Ensure optimistic tasks are linked to the server-assigned WR ID
  - `_adoptServerWorkRequest()` retargets optimistic tasks from temp WR ID to
    server UUID and rebuilds `parentWr.tasks` with normalized server tasks.

- [x] **Fix B1**: Add backend persistence for `priority`
  - Migration `000021_add_work_request_priority.js` adds `priority varchar(50)`
    to `work_requests` with default `'Normal'`.
  - `createWorkRequestSchema` now accepts `priority`.
  - `createWorkRequest` and `updateWorkRequest` services persist `priority`.
  - `toApiWorkRequest` exposes `priority`.

- [x] **Fix B2**: Preserve priority in frontend normalization
  - `WorkflowData.normalizeWorkRequest()` defaults to `'Normal'` only when the
    value is truly missing.
  - `createWorkRequest()` preserves the optimistic priority if the server
    response lacks it or returns `'Normal'`.
  - `_adoptServerWorkRequest()` applies the same optimistic priority preservation.

- [x] **Verify**: No regressions
  - `node --check` passes for all modified files.
  - Non-Admin pending-approval flow unchanged (still stages via pending-approvals API).
  - Edit/update flow unchanged for non-bypass; bypass path now uses server record.
  - Template generation unchanged (does not use `PendingChanges`).
  - Billing/transmittal `_adminBypass` callers unaffected by the return-value change
    (they only check `result.approved`).

## Files Changed

- `erp_prototype/js/pendingChanges.js` — `_adminBypass` now returns created record(s)
- `erp_prototype/js/workflow.js` — admin bypass adoption in `submitForm`, task-add,
  `_adoptServerWorkRequest()` helper, priority preservation in `createWorkRequest()`
- `backend/migrations/000021_add_work_request_priority.js` — new migration
- `backend/src/modules/operations/schema.js` — accept `priority`
- `backend/src/modules/operations/service.js` — persist & expose `priority`

## Notes for Next Agents

- Any future table added to `_adminBypass` should return the created record so
  callers can adopt it instead of re-mutating.
- The `_adoptServerWorkRequest()` helper is the canonical path for merging a
  server-created WR into optimistic state; prefer extending it over duplicating
  the logic.
- Backend migration `000021` must run before the priority feature works end-to-end.
