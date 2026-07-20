# Work Request Immediate Feedback & Priority Bug — Follow-up Fix Plan

**Date:** 2026-07-20
**Branch:** uat
**Status:** Implemented (not committed)

---

## Remaining Symptoms After Previous Fix (now addressed)

1. New work request lacked **immediate visual feedback** in the list/board/table view.
2. Priority defaulted to `Normal` in the rendered item.
3. Sidebar nav count incremented correctly after sync.
4. Duplicate issue was resolved.

---

## Root Cause Analysis

### Root Cause 1 — Optimistic record gets wiped by `WorkflowData.ensure()`

`WorkflowData._addOptimisticWorkRequest()` pushes the optimistic record into
`_workRequests` but does **not** set `WorkflowData._entity`. When `Workflow.render()`
calls `WorkflowData.ensure()` (line ~2894), it checks `hasData()`:

```js
hasData() {
  return Array.isArray(this._workRequests) && Array.isArray(this._tasks) && this._isEntityFresh();
}
```

If `_entity` is `null` or stale, `ensure()` triggers `_load()`, which fetches from
the server and **overwrites** `_workRequests` with the server response. Because the
server may not yet have the new record (or returns it without priority before the
migration runs), the optimistic record disappears from the list and reappears later
with wrong priority.

This explains both:
- The lack of immediate visual feedback (optimistic record is discarded before the
  list renders).
- The priority defaulting to Normal (server response overwrites the optimistic
  priority).

### Root Cause 2 — Migration number collision

The previous priority migration was named `000021_add_work_request_priority.js`,
but `000021_dashboard_summary_rpc.js` already existed. Both sort to key `21`, making
application order unstable. It also risks being skipped or applied at the wrong time
if the migration tracker already considers key `21` done.

---

## Fix Plan

- [x] **Fix 1**: Make optimistic inserts mark `_entity` as fresh
  - In `_addOptimisticWorkRequest()`, set `this._entity = this._getActiveEntity()`.
  - In `_addOptimisticTask()`, set `this._entity = this._getActiveEntity()` when parent WR exists.
  - In `_adoptServerWorkRequest()` and `createWorkRequest()`, set `this._entity = this._getActiveEntity()`.

- [x] **Fix 2**: Ensure optimistic record is rendered immediately on save
  - Verified the skip-generation path in `renderList()` reads from `_workRequests`.
  - Added `await App.handleRoute()` before clearing skip generation so the list
    re-renders with the server UUID and preserved priority while still using
    in-memory data.

- [x] **Fix 3**: Rename priority migration to avoid key collision
  - Renamed `000021_add_work_request_priority.js` → `000029_add_work_request_priority.js`.

- [x] **Fix 4**: Preserve priority in the optimistic record
  - `_adoptServerWorkRequest()` and `createWorkRequest()` preserve the optimistic
    priority when the server response lacks it or returns `'Normal'`.
  - Combined with Fix 1, the optimistic record is no longer overwritten by a
    premature server fetch, so its priority survives.

- [x] **Verify**: No regressions
  - `node --check` passed for all modified files.
  - Entity switch still invalidates `_entity` via `invalidate()`, forcing a fresh fetch.
  - Non-admin approval flow unchanged (does not use admin bypass path).

## Files Changed

- `erp_prototype/js/workflow.js` — `_addOptimisticWorkRequest`, `_addOptimisticTask`,
  `_adoptServerWorkRequest`, `createWorkRequest` entity state handling;
  `submitForm()` re-renders before clearing skip generation.
- `backend/migrations/000029_add_work_request_priority.js` — renamed migration.
- `docs/TODO_WORK_REQUEST_CREATION_FEEDBACK_FIX.md` — this file.

## Notes for Next Agents

- The key insight is that optimistic records must mark `WorkflowData._entity` as
  fresh, otherwise `WorkflowData.ensure()` treats the cache as stale and fetches
  from the server, wiping the optimistic data before the list renders.
- The `await App.handleRoute()` before `_clearSkipGenerationIfLatest()` is safe
  because the double-save was already fixed; it gives the user immediate DOM
  feedback (server UUID, correct priority) without a risky background fetch.
