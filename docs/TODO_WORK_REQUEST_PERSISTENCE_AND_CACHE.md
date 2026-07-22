# Work Request Persistence & Cache Fix — Follow-up Plan

**Date:** 2026-07-20
**Branch:** uat
**Status:** Implemented (not committed)

---

## What the User Reported

- Immediate feedback, clickability, and priority display are now working right after creation.
- After clicking the item or navigating to another page and back, the item disappears.
- After a hard refresh the item reappears, but priority is wrong (`Normal`).
- User is testing by hard-refreshing the browser **without restarting the backend server**.

---

## Root Cause Analysis

### Root Cause A — Backend changes are not yet active

The user has not:
1. Run the new database migration (`000029_add_work_request_priority.js`).
2. Restarted the Node.js backend server.

Until both happen:
- The old `backend/src/modules/operations/service.js` is still running, so it does not
  read or persist `priority`.
- The `priority` column does not exist in PostgreSQL/Supabase.
- The frontend sends `priority`, the backend strips/ignores it, and returns the WR
  without priority → UI falls back to `Normal`.
- If the server were restarted **before** the migration, every create would fail with
  a PostgreSQL column-not-found error.

### Root Cause B — Browser / service-worker cache serves stale list data

`backend/src/app.js` sets `Cache-Control: private, max-age=30, stale-while-revalidate=60`
for all GET `/v1/*` responses. The service worker (`erp_prototype/sw.js`) also caches
`/v1/work-requests` with a 5-minute stale-while-revalidate strategy.

Sequence that produces the symptom:
1. User opens Operations list → browser/SW caches the GET `/v1/work-requests` response.
2. User creates a work request (POST is not cached).
3. User navigates to Clients/Transmittal and back → the app clears the skip-generation
   flag but does **not** invalidate the browser/SW cache.
4. `WorkflowData.loadPage()` re-fetches the list → browser/SW serves the stale
   pre-creation cached response → new work request is missing.
5. Hard refresh bypasses the browser/SW cache → fresh response includes the record.

Clients and Transmittal appear to work because they use direct API creation and the
same cache behavior, but the user likely did not navigate back within the 30-second
HTTP/SW cache window when testing them. The underlying cache issue affects all modules.

---

## Required Manual Steps (must be done before testing)

1. **Run the priority migration** (adds the missing column):
   ```bash
   cd /home/javvii/FreelanceProject/Project4_Final-Render/backend
   npm run migrate:up
   # or for remote/UAT
   npm run migrate:remote:uat
   ```

2. **Restart the backend server** so the updated `service.js` / `schema.js` are loaded:
   ```bash
   # local dev
   npm run dev
   # or for UAT
   npm run dev:uat
   ```

3. **Clear browser cache / unregister the service worker** if testing a deployed build:
   - Dev: usually not needed because `IS_DEV_HOST` skips SW interception.
   - Production/UAT: open DevTools → Application → Service Workers → Unregister,
     then hard refresh.

---

## Code Fix Needed

Add cache busting to `WorkflowData._load()` and `WorkflowData.loadPage()` so that
after any work-request mutation, the next list fetch bypasses the browser/SW cache
and gets the newly created record immediately.

Approach:
- Add `WorkflowData._needsFreshFetch` flag.
- Set it to `true` in `invalidate()` and in every mutation method:
  `createWorkRequest`, `_adoptServerWorkRequest`, `createTask`, `updateWorkRequest`,
  `updateTask`, `deleteWorkRequest`, `deleteTask`, and the task-add bypass path.
- In `_load()` and `loadPage()`, when `_needsFreshFetch` is true, append a cache-busting
  `_t=<timestamp>` query parameter to `apiClient.workRequests.list()` and clear the flag.
- In `_load()`, only clear the flag after committing the data, so stale concurrent
  loads do not accidentally consume it.

This makes the creation flow behave like Clients/Transmittal: the new item is visible
immediately after creation and remains visible after navigation.

---

## Implementation Checklist

- [x] Added `_needsFreshFetch` flag to `WorkflowData`.
- [x] Set `_needsFreshFetch = true` in `WorkflowData.invalidate()` and all mutation methods.
- [x] Appended `_t=<timestamp>` cache-busting query param in `_load()` and `loadPage()`
  when the flag is set.
- [x] Fixed `_load()` to only clear the flag after committing data, not before.
- [x] Updated this TODO status to "Implemented (not committed)".
- [x] Verified `node --check` passes for all modified files.
- [x] Documented the required manual migration + server-restart steps below.

## Files Changed

- `erp_prototype/js/workflow.js` — added `WorkflowData._needsFreshFetch` flag and
  cache-busting logic in `_load()` and `loadPage()`.
- `docs/TODO_WORK_REQUEST_PERSISTENCE_AND_CACHE.md` — this file.

## Notes for Next Agents

- The `_needsFreshFetch` flag is intentionally cleared after the first fresh fetch so
  normal navigation can still benefit from the backend's 30-second cache.
- The flag is set by mutation methods directly because plain nav-link clicks and
  view-mode switches call `App.handleRoute()` directly (not `triggerSyncReload`),
  so relying only on `invalidate()` is insufficient.
- This fix does **not** remove the need to run the backend migration and restart the
  server; it only fixes the stale-list symptom after those steps are done.
