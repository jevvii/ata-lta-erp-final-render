# TODO: Fix Tab Nav Count Lag and Transmittal Soft Archive

> Target modules: **Operations/Workflow**, **Billing**, **Transmittal**  
> Reference implementations: `erp_prototype/js/disbursement.js`, `erp_prototype/js/clients.js`  
> Goal: Tab nav badges update synchronously with optimistic archive/unarchive, and the Transmittal row/bulk "Delete" actions become soft "Archive" actions.

---

## 1. Root Cause of Nav Count Lag

The row/card already leaves the active list and appears in the archive page for Operations and Billing, but the **numbers beside the tab nav items** update late or flicker. Two root causes:

1. **Tab nav badges wait on server count caches.**  
   `Billing.renderTabNav()` prefers `this._counts.active`/`this._counts.archived`, but `_counts` is loaded from the server by `loadCounts()` and refreshed after mutations by `_schedulePostMutationRefresh()`. That helper waits 600 ms, fetches `/invoices/counts`, then runs `backgroundRefresh()`, and only then re-renders. If the server count is briefly stale, the badge reverts to the old number before the background refresh catches up — this is the visible lag.

2. **Background refresh races with optimistic mutations.**  
   `Billing.renderList()` fires `backgroundRefresh()` unconditionally after rendering. During the optimistic skip window this can still overwrite local `archived` flags with stale server data, forcing an extra render and making the badge jump.  
   `Workflow` already guards `WorkflowData.backgroundRefresh()` with `shouldSkipServerFetch`, but `Workflow._counts` is only refreshed inside `WorkflowData._load()`. If a mutation happens while `_counts` is `null`/stale, `_updateCounts()` has to recompute, and the first render can briefly show the cached fallback value.

### Why Clients and Disbursement do not lag

- **Disbursement**: `renderTabNav()` derives active/archive counts **synchronously from the local cache** (`this._items`). It never waits for `loadCounts()`. `_optimisticUpdate()` patches the cache, calls `_refreshCounts()` (local recompute), then `App.handleRoute()` in the same tick. `backgroundRefresh()` is suppressed during the optimistic skip window.
- **Clients**: `renderTabNav()` uses the maintained local `_counts` object, which is updated immediately by `_updateCounts()` during mutations. Rejected counts are loaded asynchronously but only *after* the active/archived badges are already rendered.

The pattern to propagate: **compute tab nav badges from local state, synchronously, immediately after the optimistic cache patch; do not block rendering on server count APIs; suppress background refresh during the optimistic skip window.**

---

## 2. Implementation Plan

### 2.1 Operations / Workflow (`erp_prototype/js/workflow.js`)

1. **Call `_refreshCounts()` immediately inside `_optimisticUpdate()` and `_optimisticDelete()`** after patching `WorkflowData` so `_counts` reflects the new local state before `App.handleRoute()`.
2. **Make `renderTabNav()` always derive active/archive counts synchronously from `WorkflowData` cache** as the primary source, using `_counts` only as a cached copy that is kept in sync. This mirrors `Disbursement.renderTabNav()`.
3. Keep the existing `shouldSkipServerFetch` guard in `renderList()` — it already suppresses background refresh during skips.
4. Ensure `_countsEntity` invalidation already added in previous fixes is preserved.

### 2.2 Billing (`erp_prototype/js/billing.js`)

1. **Add `Billing._refreshCounts()`** that recomputes active/archived/rejected from `_listCache` locally.
2. **Refactor `_optimisticUpdate()` / `_optimisticDelete()`** to call `_refreshCounts()` immediately after patching `_listCache`/`_detailCache`, instead of only applying numeric deltas to a possibly-stale `_counts` object.
3. **Make `renderTabNav()` derive active/archive counts synchronously from `_listCache`** (like disbursement), using `_counts` only as a secondary cached value.
4. **Guard `renderList()` background refresh** so it does not fire while an optimistic skip generation is active.
5. **Replace `_schedulePostMutationRefresh()` server-count reload** with a lighter pattern: invalidate `apiClient.invoices.counts`, optionally schedule a quiet background refresh only when not skipping, but do not await server counts before re-rendering.
6. **Remove the blocking `loadCounts()` await from `ensure()`** for the purpose of rendering tab nav; counts can be loaded lazily without blocking `render()`.

### 2.3 Transmittal (`erp_prototype/js/transmittal.js`)

1. **Immediate count parity**
   - Call `_refreshCounts()` inside `_optimisticUpdate()` / `_optimisticDelete()` right after patching `_items`.
   - Make `renderTabNav()` derive active/archive counts synchronously from `_items` as the primary source, matching disbursement.

2. **Rename "Delete" to "Archive" and switch to soft archive**
   - Rename all row-level and bulk "Delete" buttons/labels in the active list, table, board, and compact views to **"Archive"**.
   - Rewire those handlers to call `archiveTransmittal(id)` instead of `permanentDeleteTransmittal(id)`.
   - Remove the Acknowledged-only restriction in the frontend `archiveTransmittal()` so any transmittal can be archived.
   - Update the backend `archiveTransmittal` service in `backend/src/modules/transmittals/service.js` to remove the `status !== 'Acknowledged'` guard, allowing archive of any non-deleted transmittal (matching disbursement archive behavior).
   - Keep the archive-page **"Delete Permanently"** action as a true delete for now, since it is in the archive context and the user only asked to rename the active-list delete action.

### 2.4 Backend (`backend/src/modules/transmittals/service.js`)

- In `archiveTransmittal`, remove the `if (existing.status !== 'Acknowledged')` block. The endpoint should set `archived = true` for any existing transmittal that is not soft-deleted.
- `unarchiveTransmittal` can remain unrestricted.
- `countTransmittals` already counts `archived === true` correctly; no change needed.

---

## 3. Shared / Cross-Cutting Conventions

- **Synchronous badge derivation from local cache is the source of truth.** Server `/counts` endpoints remain useful for initial load and invalidation, but must not block optimistic re-renders.
- **Suppress background refresh during optimistic skips.** Every module's list render must check the active skip generation before calling `backgroundRefresh()`.
- **Invalidate, do not reload, after mutation.** After a successful mutation, call `apiClient.<module>.invalidateCounts()` and let the next natural render derive from local cache. Only fetch fresh counts when the user explicitly switches entity or pulls to refresh.
- **Rollback on failure:** restore the original snapshot, restore counts, clear skip generation, and call `App.handleRoute()`.

---

## 4. Definition of Done

1. Clicking **Archive** on Operations/Billing/Transmittal updates the active-list tab count and archive-tab count within the same render frame as the row disappearing.
2. Restoring from the archive page updates both counts immediately.
3. Transmittal active-list "Delete" is renamed to "Archive" and performs a soft archive (item appears in the Archive tab, not removed from the database).
4. No background refresh overwrites optimistic archive state during the mutation window.
5. Existing create/edit/entity-switch flows continue to work.
6. Changes are validated by code review and `node --check`; no commits or Playwright tests are introduced.

---

## 5. Risks

- **Billing `_listCache` scanning on large datasets:** `renderTabNav()` scanning 10,000 cached invoices is acceptable for the expected volume (≤ a few thousand per entity) and keeps the UI synchronous. If volume grows, precomputed `_counts` can remain as a cache.
- **Transmittal backend relaxation:** Removing the Acknowledged-only archive guard allows archiving Draft/Sent transmittals. The archive filter and count logic already include all `archived === true` rows regardless of status, so UX is consistent.
- **Background refresh suppression:** Skipping background refresh during the optimistic window may briefly show "cached results" indicators; this is intentional and already used in Disbursement/Workflow.
