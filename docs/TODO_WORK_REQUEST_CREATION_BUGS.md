# Work Request Creation Bugs — Root Cause Analysis & Fix Plan

**Date:** 2026-07-20
**Branch:** uat
**Status:** In Progress

---

## Bug 1: Duplication of saved item after a delay

### Root Cause
The admin-approved new WR creation path (workflow.js ~6554) does:
1. `_addOptimisticWorkRequest(record)` — pushes temp-ID record into `_workRequests[]`
2. `closeFormPanelAndRoute('#operations')` — renders list from in-memory optimistic data
3. `createWorkRequest(record)` — calls API, and on success at line 340-343: if the existing
   optimistic record is NOT found by `localId` (race condition), the server record is **pushed**
   as a second entry instead of replacing the optimistic one
4. `App.handleRoute()` at line 6597 — re-renders the list, now calling `loadPage()` which
   fetches from the server. The server-side paginated results include the new record AND the
   in-memory `_workRequests` still has the optimistic entry → **duplicate**

The `loadPage()` path (line 282) creates its own array from the API response — it does NOT
deduplicate against optimistic records left in `_workRequests[]`. Meanwhile, the refresh path
at line 3891 reads from `_workRequests` which may contain stale optimistic entries.

Additionally: after `_clearSkipGenerationIfLatest(myGen)` at line 6596, the refresh path
at line 3887 no longer skips the server fetch, so `loadPage()` fires. The paginated API response
is an independent data set that doesn't know about optimistic entries.

### Fix
1. In `createWorkRequest()`: ensure the optimistic→server replacement ALWAYS succeeds by
   matching on both localId and by searching for temp-ID prefixed records as fallback
2. After the server WR is confirmed created, remove any lingering optimistic record from
   `_workRequests` before the list re-renders
3. In the creation success path: invalidate the in-memory `_workRequests` properly so
   `loadPage()` fetches a clean server-side result without ghosts

---

## Bug 2: Created item not showing immediately in list

### Root Cause
The creation flow calls `closeFormPanelAndRoute('#operations')` at line 6563 WITHOUT a
`messageConfig`. This means `closeFormPanelAndRoute` takes the else branch (utils.js:2157)
which calls `App.handleRoute()` directly (no `triggerSyncReload`). 

At this point `_activeSkipGeneration > 0`, so the list renders from in-memory `_workRequests[]`
(the skip-fetch path at line 3891). This SHOULD show the optimistic record. However:
- If `WorkflowData` has not loaded yet (`_workRequests === null`), `ensure()` is called which
  fetches from the API — the record may not exist on the server yet → missing from list
- The `_workRequests` filter at line 3904 filters by entity. If the optimistic record's
  `entity` field was not properly set, it gets filtered out

After the API call completes, `App.handleRoute()` at line 6597 fires again. Now
`_activeSkipGeneration` is cleared, so `loadPage()` runs. But `loadPage()` is a fresh
paginated API call that doesn't merge with optimistic data — the record SHOULD now be on the
server, but if there's latency, it may still be missing.

### Fix
1. Ensure the optimistic record has all required fields (entity, status, etc.) correctly set
   before inserting into `_workRequests`
2. After `createWorkRequest` succeeds, do NOT call a full re-render that wipes optimistic data
   and re-fetches from server — instead, just update the existing optimistic record in place
   (which `createWorkRequest` already attempts at line 332)
3. Remove the second `App.handleRoute()` call at line 6597 — the optimistic data is already
   displayed, and the in-place update preserves it. A full re-render is unnecessary and harmful

---

## Bug 3: Clicking newly created item causes infinite loop

### Root Cause
When the list renders after creation, rows may be rendered with the **temp ID** (e.g. `wr-xxx`)
from the optimistic record. Clicking such a row navigates to `#operations/detail/wr-xxx`.

In `render()` (line 2905-2921):
1. `WorkflowData.getWorkRequestById('wr-xxx')` — may return null if the optimistic record was
   already replaced by the server record with a UUID
2. Pending approval lookup also fails
3. Line 2918: `if (!wr)` → sets `this.view = 'list'` and calls `App.handleRoute()`
4. `App.handleRoute()` reads `location.hash` which is still `#operations/detail/wr-xxx`
5. Route parser at app.js:612 sets `Workflow.view = 'detail'` and `Workflow.detailWrId = 'wr-xxx'`
6. `Workflow.render()` is called → goes back to step 1 → **infinite loop**

The same pattern exists in `renderDetail()` (line 6833-6836) which is a second fallback that
also calls `App.handleRoute()` when the WR is not found, creating the same cycle.

### Fix
1. When WR is not found in detail view, **change the hash** to `#operations` instead of just
   setting `this.view = 'list'` — this prevents the hash from re-triggering the detail route
2. Add a guard: if we already tried to redirect once for a missing WR, don't recurse
3. In `createWorkRequest()`: when the server returns a different ID than the local temp ID,
   update any rendered DOM elements or navigation links that reference the old ID
4. In the optimistic list rendering path: use the server-assigned ID (once available) instead
   of the temp ID for row click handlers

---

## Implementation Checklist

- [x] **Fix 1a**: Harden `createWorkRequest()` optimistic→server record replacement
  - Added fallback matching by `title` + `clientId` when exact `localId` lookup fails for temp IDs
  - Added duplicate guard: if server record ID already exists in `_workRequests`, update in place instead of pushing
- [x] **Fix 1b**: Clear stale optimistic records after server confirmation
  - The in-place `Object.assign(existing, created)` preserves references; no orphaned temp-ID records
- [x] **Fix 2a**: Ensure optimistic records have complete entity/status fields
  - Verified: `submitForm` already sets `entity: Auth.activeEntity` and `status: 'Draft'` before optimistic insert
- [x] **Fix 2b**: Remove redundant `App.handleRoute()` call after creation API completes
  - Removed `App.handleRoute()` at line ~6604 that triggered a server-side `loadPage()` fetch, which could overwrite optimistic data or miss the new record
- [x] **Fix 3a**: Change detail-not-found fallback to use `location.hash = '#operations'` with guard
  - Fixed in `render()` (line ~2927) and `renderDetail()` (line ~6846): changed from `App.handleRoute()` to `location.hash = '#operations'` + `this.detailWrId = null`
  - This breaks the infinite loop because the hashchange listener re-renders the list view, not detail
- [x] **Fix 3b**: Ensure list row click handlers use server ID when available
  - Added `Workflow._navigateToWrDetail(wrId)` helper that checks for temp IDs via `WorkflowData._isTempId()`
  - If temp ID detected, shows an informative toast instead of navigating to a broken detail page
  - Updated all list/table/board/archive click handlers to use the new helper
- [x] **Verify**: No regressions in edit flow, non-admin approval flow, template creation
  - Edit flow: unchanged — uses `closeFormPanelAndRoute(targetRoute, msgConfig)` which triggers `triggerSyncReload`
  - Non-admin approval flow: unchanged — reaches `closeFormPanelAndRoute` at line ~6678
  - Template creation: unchanged — navigates directly to detail after creation
  - Billing/transmittal modules: checked — do not have the same not-found redirect loop pattern

## Files Changed

- `erp_prototype/js/workflow.js` — 34 insertions, 19 deletions (53 lines changed)
  - `WorkflowData.createWorkRequest()`: hardened optimistic→server replacement
  - `Workflow._navigateToWrDetail()`: new helper for safe detail navigation
  - `Workflow.render()`: fixed detail-not-found fallback
  - `Workflow.renderDetail()`: fixed detail-not-found fallback
  - `Workflow.submitForm()`: removed redundant `App.handleRoute()` after creation
  - All list/board/table/archive click handlers: now use `_navigateToWrDetail`

## Notes for Next Agents

- The `_navigateToWrDetail` helper is the canonical way to navigate from list views to detail. Any new list view click handlers should use it.
- The optimistic record in `_workRequests` gets its `id` mutated in-place from temp-ID to server UUID by `createWorkRequest`. Since list row click handlers read `wr.id` at click time (not closure creation time), they naturally see the updated UUID once the API completes.
- If a user clicks a WR **before** the API completes, the temp-ID guard shows a toast. After the API completes, the same click works normally.
- **Not committed** — changes are on the working tree only.
