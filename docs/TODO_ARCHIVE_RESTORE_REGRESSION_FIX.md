# TODO: Fix Archive/Restore Regressions in Clients, Billing, Disbursements, and Operations

**Date:** 2026-07-21  
**Branch:** `uat`  
**Status:** Root-cause analysis complete; implementation plan ready for next agent  
**Scope:** Frontend archive/restore/trash/unarchive actions for Clients, Billing, Disbursements, and Operations/Workflow. Transmittals are not reported broken but share the same helpers; include them defensively where appropriate.

---

## 1. Summary of User-Reported Symptoms

After the blocking archive/restore flow was implemented, the following regressions appeared:

| Symptom | Modules affected |
|---|---|
| Archive from active list → loading → success modal → page reloads → item is still in active list, never moves to archive | Clients, Billing, Disbursements |
| Restore from archive does nothing | Clients |
| Archive tab nav counter shows `0` even though archived items exist for the entity | Clients |
| Operations archive eligibility changed: archive should be **only** for Completed WRs, but now non-Completed WRs also show Archive action | Operations |
| Cancelled WRs should land under Archive → **Cancelled**, but behavior is inconsistent | Operations |
| Operations archive list shows variable/ inconsistent item counts (nav counter accurate, list shows 0/1/2) | Operations |

---

## 2. Root-Cause Analysis

### 2.1 Clients, Billing, Disbursements: archived item stays in active list

The blocking flow now calls `this.invalidateCache()` (or `WorkflowData.invalidate()`) in `onAfterConfirm` **after** the success modal is dismissed. The intent was to wipe stale cache and force a fresh fetch. The actual behavior is the opposite of what was intended because of how each module's `render()` treats cache freshness:

- **Clients** (`clients.js:409-417`): `Clients.invalidateCache()` calls `ClientsData.invalidate()`, which sets `_clients = null`. `render()` then calls `ClientsData.ensure()`, which **re-fetches** via `window.apiClient.clients.list({})`. That API call returns **all non-deleted clients** (active + archived) because the active-list endpoint does not filter by status. The merge logic in `ClientsData._load()` then merges server records into the now-empty cache. Because the server record is the authoritative source and the local cache was wiped, the freshly archived client (status `Archived`) is **added back** into `ClientsData._clients`. `renderList()` filters by `status !== 'Archived'`, so the active list should exclude it, but `renderArchive()` also calls `getArchivedClients()` which queries `status=Archived`; if the backend's soft-delete/archive state is correct, the active list should not show it. The reported symptom implies the merge logic is preserving the pre-archive local record or the active-list fetch is returning the archived row.
  - **Real root cause in merge:** `ClientsData._load()` checks `localNewer` and, during a skip generation, preserves the **local status** (`if (localStatus !== undefined) existing.status = localStatus;`). After `invalidateCache()` clears `_skipFetchGeneration`, this should not fire, but if a concurrent background fetch or a second `App.handleRoute()` starts while the modal is still open, the pre-archive local record may be re-inserted by `ClientsData.replaceClientById()` in `onSuccess` and then preserved by a subsequent merge.
  - **Even simpler root cause:** in the single-id handlers, `onSuccess` writes the server response into `ClientsData._clients` via `replaceClientById`. Then `onAfterConfirm` calls `this.invalidateCache()`, which **deletes `_clients`**. The next `App.handleRoute()` re-fetches from the server. If the server is the source of truth, the active list should be correct. If the active list still shows the archived client, the backend's active-list query is returning it, which points to the soft-delete/archive filter on the backend.
    - `backend/src/modules/clients/service.js:143-147`: active list uses `.is('deleted_at', null)`, but the archive endpoint sets `deleted_at = now`. So archived clients should not appear in the active list. However, if the entity filter or the client's `deleted_at` is not set correctly by the archive service, the row leaks back.
    - **Verified:** `archiveClient` at `backend/src/modules/clients/service.js:440-450` sets `deleted_at: now`. So the backend is correct.
  - **Conclusion for Clients:** The active list re-shows the archived client because the blocking flow writes the server record to `ClientsData` in `onSuccess`, then **immediately wipes `ClientsData._clients` in `onAfterConfirm`**, then re-fetches. Between the wipe and the re-fetch, the module has no data. `App.handleRoute()` renders with a now-empty cache, and because the route skeleton is shown, the user perceives a full reload. When the fetch returns, it contains the archived client in the **all-clients list**, and because the merge logic or the `_refreshCounts` is derived from `ClientsData._clients` without filtering archived rows, the count may be wrong, and if the active-list filter is not applied before the server fetch lands, the archived client may flash in the active list.
  - **The deeper issue:** The blocking flow should **not** invalidate the entire module cache after every archive/restore. It should update the cache from the confirmed server response and let the existing render logic (which already knows how to filter active vs archived) re-render. Cache invalidation should only happen on hard failure or when the user explicitly refreshes. Wiping the cache on success destroys the optimistic feedback and reintroduces race conditions.

- **Billing** (`billing.js:152-169`): `invalidateCache()` clears `_detailCache` and `_listCache`. `render()` at line 537 calls `if (!this._isEntityFresh()) this.invalidateCache();`. After success, `_listCacheEntity` is null, so `render()` invalidates again, then `ensure()` re-fetches all invoices. The archive/trash handler wrote `inv` to `_detailCache` and `_addToListCache` in `onSuccess`. Then `invalidateCache()` deleted it. The re-fetch returns the full list from the server. The active list filters with `_isActiveInvoice`, which excludes archived/cancelled. If the backend archived the row correctly, it should not reappear. If it does, either the backend active list is returning archived rows, or the `_listCache` merge logic is preserving the pre-archive local record.
  - `billing.js:106-135`: `_loadInvoices` merges server records into `_listCache`. If the local record is newer by `updatedAt`, it is preserved. The local record was patched in `onSuccess` with the server response, so `updatedAt` should match the server. If the merge preserves the pre-archive local record because of an active skip generation or because the local `updatedAt` is considered newer, the active list will still show the invoice.
  - **Conclusion for Billing:** same as Clients — invalidating the cache after success is counter-productive. The module should keep the confirmed server record and re-render from the existing cache.

- **Disbursements** (`disbursement.js:400-418`): `invalidateCache(true)` clears `_items`, `_detailCache`, counts, skip generations, and templates. `render()` calls `ensure()`, which re-fetches. Same problem: the confirmed server record is written in `onSuccess`, then wiped, then refetched. If the backend archive is correct, the active list should be correct, but the wipe causes a visible reload and creates a window where stale data can re-enter through `backgroundRefresh()` or a concurrent route render.

### 2.2 Operations/Workflow anomalies

The blocking flow switched Operations archive/unarchive from `workRequests.update(...)` to the dedicated `workRequests.archive` / `workRequests.unarchive` endpoints (`workflow.js:2109, 2147`). This created two problems:

1. **Eligibility guard in `archiveWorkRequest` is now wrong.**
   - Old guard (before blocking flow): `if (!wr || wr.archived) return;` — allowed any non-archived WR to be archived.
   - New guard (current): `if (!wr || wr.archived || wr.status === 'Completed' || wr.status === 'Cancelled') return;` — this **blocks** Completed WRs from archiving, which is the opposite of the intended behavior.
   - UI action buttons already gate archive differently:
     - Table view (`workflow.js:4882-4886`): shows Archive only if `wr.status === 'Completed' && !wr.archived`.
     - Card/board action menu (`workflow.js:5150-5157`): shows Archive for any `!wr.archived` WR, regardless of status.
     - Bulk actions (`workflow.js:4952-4953`): allow archiving only Completed WRs.
   - **Fix:** `archiveWorkRequest` should allow archiving only when `wr.status === 'Completed' && !wr.archived`. Cancel should remain a separate action (`cancelWorkRequest`) that sets status `Cancelled` and `archived: true`, which already exists.

2. **Backend `archiveWorkRequest` only flips `archived: true`, it does NOT change status.**
   - `backend/src/modules/operations/service.js:389-407` sets `archived: true` and leaves `status` unchanged.
   - The old archive flow used `workRequests.update(..., { status: 'Cancelled', archived: true })`, which moved Completed WRs to archive as Cancelled. The new dedicated endpoint does not.
   - This means a Completed WR archived via the new endpoint becomes `status: 'Completed', archived: true`. The archive page categorizes `accomplished` as `archived === true && status === 'Completed'` (`workflow.js:12307-12312`), so it will appear under **Accomplished/Archived**, not **Cancelled**. That part is actually correct for completed WRs.
   - However, the user's mental model was "archive should be for completed WRs; cancel should put WRs under Cancelled." The new endpoint supports that model, but the guard was inverted.

3. **Inconsistent archive list counts.**
   - `renderArchive()` at `workflow.js:12274-12322` merges server-fetched archived WRs with local cached WRs. It uses `Workflow._activeSkipGeneration` and `Workflow._skipFetchGeneration` to decide whether to include local rows.
   - The blocking flow no longer uses `_startSkipGeneration()` / `_clearSkipGenerationIfLatest()`, so `_activeSkipGeneration` is always `0`. That means `isFirstPageOrSkip` is true only on page 1, and local rows are merged on page 1.
   - The `renderTabNav()` at `workflow.js:3980-3998` counts archive items from `WorkflowData.getWorkRequestsWhere(... !this._isActiveWorkRequest(wr) ...)`, which includes both `archived === true` and `status === 'Cancelled'`.
   - The archive list filter at `workflow.js:12307-12312` for `accomplished` requires `state.archived === true && state.status === 'Completed'`, and for `cancelled` requires `state.status === 'Cancelled && !Workflow._isActiveWorkRequest(state)`.
   - The mismatch between nav counter (all non-active WRs) and list categories (only Completed-archived + Cancelled) means a WR that is `archived: true` but `status !== 'Completed'` and `status !== 'Cancelled'` contributes to the nav counter but is not shown in any list category.
   - Additionally, if a WR is archived via the dedicated endpoint, its status remains whatever it was (e.g., `Draft`, `Processing`). Those WRs will be counted in nav but invisible in the archive list.
   - **Conclusion:** The archive list categories must match the nav counter definition, or the nav counter must match the categories. Either include all non-active WRs in the archive list, or change the nav counter to count only Completed-archived + Cancelled.

### 2.3 Clients restore does nothing / nav count shows 0

- `unarchiveClient` calls `window.apiClient.clients.unarchive(id)`, which sets `status='Active', deleted_at=null`. In `onSuccess`, it writes the server record to `ClientsData`. Then `onAfterConfirm` calls `this.invalidateCache()`, wiping `_clients`. The next render re-fetches all clients. The restored client should appear in the active list.
- If restore "does nothing," the most likely cause is that the active list and archive list are both driven by the same cache, and after the wipe the re-fetch returns the client with `status='Archived'` (because the backend unarchive failed or the frontend is reading from a stale cache). But assuming the backend unarchive succeeds, the issue is the **perceived delay / full reload** and the **count mismatch**.
- **Nav counter shows 0:** `renderTabNav()` uses `this._counts`, which is computed by `_recalcCounts()` from `ClientsData.getAllClients()`. If `ClientsData._clients` is `null` at render time (because `invalidateCache()` wiped it and the re-fetch hasn't completed), `_refreshCounts()` sets `this._counts = null`, and `renderTabNav()` shows `0`. This is the direct cause of the "0 but have 4 items" symptom.

---

## 3. Correct Design Principle

The blocking flow should:

1. **Not wipe the module cache on success.** It should update the cache from the confirmed server response and re-render.
2. **Invalidate counts only when needed.** Count caches (e.g., `window.apiClient.clients.invalidateCounts()`) should be invalidated because they are cheap to recompute and may be stale.
3. **Re-render the current view after the modal is dismissed.** If the current view is detail/form for the mutated item, route back to the module list; otherwise call `App.handleRoute()`.
4. **Use a fresh fetch only as a verification step, not as the primary update mechanism.** If a verification fetch is desired, do it inside the blocking overlay after the mutation succeeds, then update the cache and show the modal.

---

## 4. Implementation Plan

### 4.1 Remove aggressive cache invalidation from success paths

For **Clients, Billing, Disbursements, Transmittals, and Operations/Workflow**, remove the `this.invalidateCache()` / `WorkflowData.invalidate()` call from the `onAfterConfirm` of every `runBlockingArchiveAction` archive/restore/trash/unarchive handler.

Keep these invalidations:
- `window.apiClient.<module>.invalidateCounts()` — count caches should be cleared.
- `window.apiClient.clientCache.invalidate()` / `workRequestCache.invalidate()` — shared dropdown caches should be cleared because they may hold stale linked records.
- `App.updateSidebarNotifications()` — sidebar badges should refresh.

**Do not** wipe the module's own `_items` / `_listCache` / `_workRequests` / `_clients` on success.

### 4.2 Ensure `onSuccess` writes the confirmed server record correctly

Each handler's `onSuccess` should:
- Normalize `res.data`.
- Write it into the module cache in a way that replaces the old record (not merges field-by-field with stale local state).
- For Clients: `ClientsData.replaceClientById(id, normalized)` is fine because it replaces the whole object.
- For Billing: replace `this._detailCache[id]` and call `this._addToListCache(norm)`; but `_addToListCache` merges field-by-field. Consider replacing the list cache entry directly or clearing the specific old entry first.
- For Disbursements: `this._updateCachedDisbursement(id, norm)` merges patch into existing; ensure the server record replaces the existing entry. If `_updateCachedDisbursement` merges, the stale local record may survive. Replace the cached item directly instead.
- For Transmittals: `_updateCachedItem` already creates a new object `{ ...t, ...updates }`, so it is safe.
- For Workflow: `_applyServerRecordToCache` already merges carefully and preserves frontend-only fields; it is safe.

### 4.3 Fix Clients counts after cache update

After updating `ClientsData._clients` with the confirmed server record, call `Clients._refreshCounts()` so the tab nav re-renders with accurate active/archive counts. This should happen in `onSuccess` (or after `onSuccess` and before the modal) so the user sees the correct badge immediately, not after dismissal.

### 4.4 Fix Operations archive eligibility

Change `archiveWorkRequest` guard from:

```js
if (!wr || wr.archived || wr.status === 'Completed' || wr.status === 'Cancelled') return;
```

to:

```js
if (!wr || wr.archived || wr.status !== 'Completed') return;
```

This makes archive available **only** for Completed WRs. Remove the Archive action from the card/board action menu for non-Completed WRs (`workflow.js:5150-5157`), leaving only Cancel for those. Keep the table-view Archive button as-is (it already requires Completed).

### 4.5 Align Operations archive list categories with nav counter

The nav counter at `workflow.js:3980-3998` counts all non-active WRs (`!this._isActiveWorkRequest(wr)`). The archive list should also render all non-active WRs, categorized as:
- **Accomplished/Completed-Archived:** `archived === true && status === 'Completed'`.
- **Cancelled:** `status === 'Cancelled'` (regardless of archived, as long as not active).
- Add a third category **Archived (Other)** for WRs that are `archived === true` but `status !== 'Completed' && status !== 'Cancelled'`, OR change the nav counter to exclude those. The safer fix is to add the category so the list matches the counter.

Also, because the dedicated `archive` endpoint only sets `archived: true` without changing status, any WR archived while not Completed will be counted but invisible. Decide:
- **Option A (recommended):** Only allow archiving Completed WRs (section 4.4). Then all archived WRs are Completed or already Cancelled via `cancelWorkRequest`.
- **Option B:** If non-Completed archive must remain possible, add an "Archived" catch-all category.

Given the user requirement, implement **Option A** and remove/archive the catch-all.

### 4.6 Fix Operations cancel to remain blocking-compatible

`cancelWorkRequest` still uses `_optimisticUpdate`, which is fine for now. It sets `status: 'Cancelled', archived: true`. Ensure the cancelled WR appears under Archive → Cancelled. The archive list logic already handles `status === 'Cancelled' && !Workflow._isActiveWorkRequest(state)`. Verify that after cancel, the nav counter and archive list both update. If `_optimisticUpdate` is deprecated in the future, migrate cancel to `runBlockingArchiveAction` separately.

### 4.7 Remove fallback local patches (already done)

The previous hardening removed fallback local-patch branches. Do not re-introduce them. The cache should only be written from `res.data`.

### 4.8 Keep timeout and OK-only modal

The 30-second timeout and the success modal that only dismisses via OK are correct. Keep them.

### 4.9 Verify refresh and hard refresh survival

Because the cache is no longer wiped on success, the UI reflects the confirmed server state immediately. On refresh or hard refresh, the module fetches fresh data from the server. Since the backend is the source of truth and the mutation has already persisted, the state survives both refresh types.

---

## 5. Per-Module Checklist

### Clients (`erp_prototype/js/clients.js`)

- [ ] Remove `this.invalidateCache()` from `onAfterConfirm` in:
  - `archiveClientDirectly`
  - `archiveClientsDirectly`
  - `unarchiveClient`
  - `bulkUnarchiveClients`
- [ ] Keep `window.apiClient.clientCache.invalidate()` and `window.apiClient.clients.invalidateCounts()`.
- [ ] In each `onSuccess`, after writing the server record to `ClientsData`, call `this._refreshCounts()` (or ensure the render path calls it).
- [ ] Verify `ClientsData.replaceClientById` fully replaces the record.
- [ ] In `onAfterConfirm`, keep routing: if `this.editingId` or `#clients/form/<id>` matches the mutated id(s), set `location.hash = '#clients'`; otherwise `App.handleRoute()`.

### Billing (`erp_prototype/js/billing.js`)

- [ ] Remove `this.invalidateCache()` from `onAfterConfirm` in:
  - `trashInvoice`
  - `restoreInvoice`
  - `archiveInvoice`
  - `bulkArchiveInvoices`
  - `bulkTrashInvoices`
  - `unarchiveInvoice`
- [ ] Keep `window.apiClient.invoices.invalidateCounts()`.
- [ ] Ensure `_addToListCache` does not preserve stale fields. Consider replacing the list cache entry directly in `onSuccess`.
- [ ] Call `this._refreshCounts()` after writing the server record.
- [ ] Keep detail/form routing in `onAfterConfirm`.

### Disbursements (`erp_prototype/js/disbursement.js`)

- [ ] Remove `this.invalidateCache(true)` from `onAfterConfirm` in:
  - `archiveDisbursement`
  - `trashDisbursement`
  - `bulkArchiveDisbursements`
  - `unarchiveDisbursement`
- [ ] Keep `window.apiClient.disbursements.invalidateCounts()`.
- [ ] Ensure `_updateCachedDisbursement` fully replaces the cached item with the server record, not merges.
- [ ] Call `this._refreshCounts()` after writing the server record.
- [ ] Keep detail routing in `onAfterConfirm`.

### Operations/Workflow (`erp_prototype/js/workflow.js`)

- [ ] Remove `WorkflowData.invalidate()` from `onAfterConfirm` in:
  - `archiveWorkRequest`
  - `unarchiveWorkRequest`
  - `bulkArchiveWorkRequests`
  - the inline "Restore to Draft" action in `renderArchive()`
- [ ] Keep `window.apiClient.workRequestCache.invalidate()`, `window.apiClient.workRequests.invalidateCounts()`, and `WorkflowData.invalidateRelatedForWorkRequest()`.
- [ ] Change `archiveWorkRequest` guard to require `wr.status === 'Completed'`.
- [ ] Remove the Archive action from the card/board action menu for non-Completed WRs (`workflow.js:5150-5157`). Keep Cancel.
- [ ] Ensure the archive list categories match the nav counter definition. With the Completed-only archive guard, only Completed-archived and Cancelled WRs will exist in archive; verify the filters are correct.
- [ ] Verify `_applyServerRecordToCache` preserves task arrays and linked IDs after unarchive.

### Transmittals (`erp_prototype/js/transmittal.js`) — defensive

- [ ] Remove `this.invalidateCache()` from `onAfterConfirm` in archive/restore handlers unless a specific bug is observed.
- [ ] Keep counts invalidation.
- [ ] Ensure `_updateCachedItem` fully replaces the record.

---

## 6. Backend Notes

No backend changes are required for these regressions. The existing endpoints return fresh rows:
- `POST /clients/:id/archive` and `/clients/:id/unarchive`
- `POST /invoices/:id/archive` and `/invoices/:id/unarchive`
- `POST /disbursements/:id/archive` and `/disbursements/:id/unarchive`
- `POST /work-requests/:id/archive` and `/work-requests/:id/unarchive`

If after the frontend fixes the Operations archive list still miscounts, verify that the dedicated `archiveWorkRequest` endpoint only receives Completed WRs and that cancelled WRs use the existing cancel path.

---

## 7. Testing Checklist

After implementation, verify:

- [ ] **Clients:** Archive a client from the active list. After the success modal, the client leaves the active list and appears in the archive. The archive tab counter is correct. Restore it; it returns to the active list and leaves the archive. Refresh and hard refresh show the same state.
- [ ] **Billing:** Trash a Draft invoice. After the modal, it leaves the active list and appears in Archive → Cancelled. Archive a Paid invoice; it appears in Archive → Accomplished. Restore from Cancelled; it returns to Draft in the active list. Counter is correct.
- [ ] **Disbursements:** Archive a Funded disbursement. After the modal, it leaves the active list and appears in Archive → Funded. Unarchive it; it returns to the active list. Counter is correct.
- [ ] **Operations:** Only Completed WRs show the Archive action. Archiving a Completed WR moves it to Archive → Accomplished. Cancelling a non-Completed WR moves it to Archive → Cancelled. The nav counter matches the sum of visible archive items. Refresh and hard refresh are consistent.
- [ ] **No optimistic mutation:** During the loading overlay, the item does not disappear from the active list early.
- [ ] **Double-click protection:** Clicking archive twice while one action is in flight shows the "Action in progress" message and does not fire a second request.

---

## 8. Files Expected to Change

| File | Reason |
|---|---|
| `erp_prototype/js/clients.js` | Remove cache wipe; refresh counts |
| `erp_prototype/js/billing.js` | Remove cache wipe; ensure clean list-cache update |
| `erp_prototype/js/disbursement.js` | Remove cache wipe; ensure clean item-cache update |
| `erp_prototype/js/transmittal.js` | Defensive removal of cache wipe |
| `erp_prototype/js/workflow.js` | Fix archive eligibility, remove cache wipe, align archive list categories |

---

## 9. Constraints

- Do **not** re-introduce optimistic local patching before the server responds.
- Do **not** delete `_optimisticUpdate` or `_optimisticDelete`; keep them for non-archive transitions.
- Do **not** run Playwright tests unless explicitly requested.
- Do **not** commit unless explicitly requested.
- Keep the 30-second timeout and OK-only success modal from the previous hardening.

---

## 10. Definition of Done

- Archive/restore in Clients, Billing, and Disbursements causes the item to move between active and archive views immediately after the success modal.
- The archive tab counter in Clients shows the correct number.
- Operations archive is only available for Completed WRs; cancel moves WRs to Archive → Cancelled.
- Operations archive list count matches the nav counter.
- Refresh and hard refresh do not revert the UI to a stale state.
- No commits or Playwright runs were made without explicit user request.
