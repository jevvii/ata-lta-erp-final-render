# Operations Task Creation Bugs — Root Causes & Implementation Plan

**Date:** 2026-07-21  
**Branch:** `uat` (all changes below are uncommitted)  
**Scope:** Work-request task creation, inline subtasks, board view, routing transitions  
**Status:** Root-cause analysis complete; implementation TODO list below for the implementer agent.  

---

## Issues Reported

1. Inline subtasks created in the **task creation form** show `🔒 Waiting for: Unknown` and the dependency map shows `Unknown -> <task>: <item>`. Adding subtasks to an **existing** task does not show this.
2. Creating a work request with an **inline task** on an admin account produces a **duplicate task** after save.
3. The **board view** of the task list throws a `TypeError`.
4. **Routing a work request** throws `PUT /v1/work-requests/:id 500 Internal Server Error` with message `Unable to update work request`.

---

## Root Cause #1 — Inline subtasks show "Waiting for: Unknown"

### Where it surfaces
- `erp_prototype/js/workflow.js:5903` — renders `Waiting for: Unknown` when `prereq` is not found.
- `erp_prototype/js/workflow.js:6433` — dependency map renders `Unknown` for the same reason.
- Both call sites expect `item.dependsOn` to be a **single string ID** or `'*'`.

### Why it happens only in the add-task form
1. The add-task form creates checklist items with `generateId('chk')` (`erp_prototype/js/workflow.js:10960`), which produces IDs like `chk-timestamp-random`. These are **not UUIDs**.
2. The dependency `dependsOn` is stored as a **single string** (`erp_prototype/js/workflow.js:10939`).
3. On the **existing-task subtask adder**, `WorkflowData.updateTask` (line ~748) merges the server checklist with the local checklist and **preserves the local string `dependsOn`**:
   ```js
   return ec ? { ...ec, ...c, dependsOn: ec.dependsOn || null, ... } : c;
   ```
   This masks the mismatch for updates.
4. For **new tasks** there is no local checklist to preserve, so the server response wins. The backend stores `dependsOn` in a `uuid[]` column and returns it as an **array**, which the UI cannot resolve.

### Backend/storage details
- `backend/migrations/000035_add_task_checklist_depends_on.js` added `depends_on uuid[]`.
- `backend/src/modules/operations/schema.js:14` declares `dependsOn: z.array(z.string().uuid()).optional().nullable()`.
- `backend/src/modules/operations/service.js:574-585` `upsertChecklist` inserts rows without preserving `item.id` and stores `depends_on: item.dependsOn || []`, which does not handle a single string and discards the frontend ID.
- `backend/src/modules/operations/service.js:82` `toApiTask` returns `dependsOn: c.depends_on || []`, leaking the array shape into the UI.

---

## Root Cause #2 — Duplicate inline tasks after WR creation (admin bypass)

### Where it happens
- `erp_prototype/js/workflow.js:499-551` `_adoptServerWorkRequest`.

### Sequence
1. `submitForm` builds `taskRecords` and calls `_addOptimisticWorkRequest(record)` after clearing `record.tasks`, then restores `record.tasks = taskRecords`.
2. It calls `_addOptimisticTask(t)` for each inline task, pushing one normalized object into `_tasks` and the **same object** into `wr.tasks`.
3. Admin bypass creates the WR and each task separately; the backend gives each task a **real UUID** different from the temp `t-…` id.
4. `_adoptServerWorkRequest` first updates all optimistic tasks from `oldId` to the new WR id at lines 514-516, **invalidating** the `localId` match used at line 540.
5. Because the title match at line 540 now fails, each server task is pushed as a new object in `_tasks` (line 548), while the original optimistic task remains. `parentWr.tasks` then contains the server copies only, but `_tasks` contains **both** the optimistic and server copies for the same task.
6. Board card and detail view read from `_tasks` (`WorkflowData.getTasksWhere`), so duplicates render.

### Contributing factor
- `erp_prototype/js/pendingChanges.js:121` includes `'id'` in `allowedTaskFields`, so the disposable temp id is sent to the backend even though it is immediately replaced by a real UUID, making id-based matching impossible.

---

## Root Cause #3 — Board view TypeError

### Where it happens
- `erp_prototype/js/workflow.js:8600` `renderCard(t)` is declared `async` but has no `await` and returns a DOM element. KanbanBoard expects a DOM element and immediately accesses `card.dataset.itemId` (`erp_prototype/js/kanban.js:476`), which fails on the returned `Promise<HTMLElement>`.
- `erp_prototype/js/workflow.js:5069` `renderBoardCard` also has a board-specific null-safety issue: `usr.name.toLowerCase()` assumes every cached user has a `name`.

### Why list/table work
They render task rows directly without invoking `KanbanBoard.render`.

---

## Root Cause #4 — Work request routing 500 error

### Where it happens
- `backend/src/modules/operations/service.js:388-398` catches a database error and returns `500 Unable to update work request`.
- The underlying error is a `CHECK` constraint violation.

### Why
- `backend/migrations/000031_concurrency_schema_hardening.js:42-45` defines:
  ```sql
  CHECK (status IN ('Draft', 'In Progress', 'On Hold', 'Completed', 'Cancelled'))
  ```
- The application lifecycle uses `Pre-processing`, `Processing`, `For Review`, `Billing`, and `Disbursement` (`backend/src/modules/operations/service.js:10-18` `VALID_TRANSITIONS`).
- Frontend `transitionWorkRequest` (`erp_prototype/js/workflow.js:2038`) sends one of these application statuses, which violates the DB constraint.
- `backend/src/modules/operations/schema.js:38` does not restrict `status` to the allowed set, so invalid values reach the DB instead of being rejected early with `400`.

---

## Implementation Plan / TODO List

### A. Fix checklist `dependsOn` data model (frontend ↔ backend mismatch)

1. **Frontend checklist IDs must be UUIDs**
   - Replace `generateId('chk')` with a UUID generator for checklist items so IDs survive the backend insert and dependency references remain valid.
   - Key locations:
     - `erp_prototype/js/workflow.js:135` — `normalizeTask` fallback checklist ID
     - `erp_prototype/js/workflow.js:10960` — add-task form builder
     - `erp_prototype/js/workflow.js:11500` — edit-task modal builder
     - `erp_prototype/js/workflow.js:6137` and `erp_prototype/js/workflow.js:9483` — existing-task side-pane subtask adder
     - `erp_prototype/js/workflow.js:2521` — template expansion

2. **Backend schema accepts string-or-array `dependsOn`**
   - In `backend/src/modules/operations/schema.js:14` change to:
     ```js
     dependsOn: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional().nullable(),
     ```

3. **Backend `upsertChecklist` preserves item ID and normalizes `dependsOn`**
   - In `backend/src/modules/operations/service.js:574-585`:
     - Include `id: item.id` in the insert row when `item.id` is a valid UUID; otherwise let the DB generate one.
     - Normalize `dependsOn` to a `uuid[]` column value:
       ```js
       depends_on: Array.isArray(item.dependsOn)
         ? item.dependsOn
         : (item.dependsOn ? [item.dependsOn] : []),
       ```

4. **Backend `toApiTask` normalizes `depends_on` back to a single string or null**
   - In `backend/src/modules/operations/service.js:82`:
     ```js
     dependsOn: Array.isArray(c.depends_on)
       ? (c.depends_on[0] || null)
       : (c.depends_on || null),
     ```

5. **Frontend `WorkflowData.normalizeTask` normalizes any backend array to string/null**
   - In `erp_prototype/js/workflow.js:141`:
     ```js
     dependsOn: Array.isArray(item.dependsOn)
       ? (item.dependsOn[0] || null)
       : (item.dependsOn || null),
     ```

6. **Verify rendering sites still handle `'*'` and `null` correctly**
   - `erp_prototype/js/workflow.js:5885-5903` and `erp_prototype/js/workflow.js:6425-6433` should work once `dependsOn` is a stable string or `null`.

### B. Fix duplicate inline tasks after WR creation

7. **Fix `_adoptServerWorkRequest` task matching**
   - In `erp_prototype/js/workflow.js:510-551`:
     - Capture the list of optimistic tasks for `localId` **before** updating their `workRequestId` to the real WR id.
     - Match server tasks to captured optimistic tasks by a stable criterion (e.g., title + original temp id, or order) and update the optimistic object in place instead of pushing a new copy.
     - Rebuild `parentWr.tasks` from `_tasks` after the merge instead of pushing separate server-copy objects.

8. **Stop sending disposable temp task `id` to the backend**
   - In `erp_prototype/js/pendingChanges.js:121` remove `'id'` from `allowedTaskFields`, or explicitly delete `t.id` before sending.

### C. Fix board view TypeError

9. **Remove `async` from `renderCard`**
   - In `erp_prototype/js/workflow.js:8600`, change `async renderCard(t) {` to `renderCard(t) {` because the body is synchronous.

10. **Guard user name lookup in `renderBoardCard`**
    - In `erp_prototype/js/workflow.js:5069` change:
      ```js
      const u = (window.apiClient.userCache._users || [])
        .filter(usr => (usr.name || '').toLowerCase() === name.toLowerCase())[0];
      ```
    - Apply the same guard to `resolveAssignee` (`erp_prototype/js/workflow.js:1615`) and the assignee dropdown resolution (`erp_prototype/js/workflow.js:1729`).

### D. Fix work-request routing 500 error

11. **Align DB `work_requests` CHECK constraint with application statuses**
    - In `backend/migrations/000031_concurrency_schema_hardening.js:42-45` expand to:
      ```sql
      CHECK (status IN ('Draft', 'Pre-processing', 'In Progress', 'Processing', 'For Review', 'Billing', 'Disbursement', 'On Hold', 'Completed', 'Cancelled'))
      ```
    - Create a new idempotent migration to apply the same change to existing databases, e.g. `backend/migrations/000036_fix_work_request_status_constraint.js`.

12. **Harden `updateWorkRequestSchema` to fail fast**
    - In `backend/src/modules/operations/schema.js:38` restrict `status` to the allowed enum so invalid values return `400` before hitting the DB:
      ```js
      status: z.enum(['Draft', 'Pre-processing', 'In Progress', 'Processing', 'For Review', 'Billing', 'Disbursement', 'On Hold', 'Completed', 'Cancelled']).optional(),
      ```

### E. Verification steps

13. Run `node --check` on all modified files.
14. Run backend tests: `npm test` (target: 128 passing).
15. Manual/QA checks:
    - Add a subtask with a dependency in the **Add task** form and refresh the page; dependency should resolve correctly (not Unknown).
    - Add a subtask with a dependency to an **existing** task; should still work.
    - Create a WR with multiple inline tasks as admin; verify no duplicates in detail/board/list views.
    - Open board view of operations list; verify no TypeError.
    - Create a WR in Draft, add a task, assign it, then click Route/Transition to Pre-processing; verify 200 and no 500.

---

## Files to Modify

| File | Changes |
|------|---------|
| `erp_prototype/js/workflow.js` | UUID checklist IDs; normalize `dependsOn`; fix `_adoptServerWorkRequest` matching; remove `async` from `renderCard`; guard user name lookups. |
| `erp_prototype/js/pendingChanges.js` | Remove `'id'` from `allowedTaskFields` for WR nested tasks. |
| `backend/src/modules/operations/schema.js` | Accept string-or-array `dependsOn`; restrict `status` enum. |
| `backend/src/modules/operations/service.js` | Preserve checklist `id` in `upsertChecklist`; normalize `dependsOn` storage and API response. |
| `backend/migrations/000031_concurrency_schema_hardening.js` | Expand `chk_work_requests_status`. |
| `backend/migrations/000036_fix_work_request_status_constraint.js` | New idempotent migration for existing DBs. |

---

## Notes for Implementer

- All of the above are **uncommitted** changes on the `uat` branch.
- Do **not** use Playwright for these fixes.
- The checklist `depends_on` migration (`000035_add_task_checklist_depends_on.js`) is already present on disk but the data flow between frontend string and backend array is not yet normalized — that is the bulk of Root Cause #1.
- The WR status CHECK constraint mismatch is a recently-introduced regression from the concurrency schema hardening migration.
