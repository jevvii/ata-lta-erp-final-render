# TODO: Propagate the Disbursement Archive Pattern

> Target modules: **Clients**, **Billing**, **Transmittal**, **Operations**  
> Reference implementation: `erp_prototype/js/disbursement.js`  
> Goal: 1:1 UX/cache/count parity with the Disbursement module for archive, trash, restore, and bulk actions.

---

## 1. Executive Summary of the Disbursement Reference Pattern

The Disbursement module uses a deterministic, repeatable optimistic-mutation flow:

1. **Optimistic local mutation** — patch the in-memory cached record (`this._items` / `_detailCache`) immediately.
2. **Skip-generation cache guard** — increment `_skipFetchGeneration` and `_activeSkipGeneration` (and the data-layer `_loadGeneration`) before the API call. This tells `ensure()` / `_load()` to **skip server merges** for that record until the mutation completes, preventing the server snapshot from overwriting the optimistic change.
3. **Instant re-render** — call `App.handleRoute()` so the list/table/board/archive view reflects the new state before the network round-trip.
4. **Count refresh** — update the module's local badge counts (`_counts`) immediately and invalidate the `apiClient` count cache so the next tab render is correct.
5. **API call** — execute the real mutation (`archive`, `unarchive`, `update`, etc.).
6. **Clear skip + re-render** — on success, clear the active skip generation and call `App.handleRoute()` again, then show a toast.
7. **Rollback** — on failure, restore the original snapshot, clear the skip generation, re-render, and show an error toast.

Key reference symbols in `disbursement.js`:
- `_setActiveSkipGeneration()` / `_clearSkipGenerationIfCurrent()` (lines 253-264)
- `_optimisticUpdate()` (lines 652-693)
- `_optimisticDelete()` (lines 695-734)
- `_updateCachedDisbursement()` (lines 474-485)
- `_removeCachedDisbursement()` (lines 487-495)
- `_refreshCounts()` / `_recalcCounts()` (lines 440-455)
- `renderArchive()` (lines 3783+)

This plan applies the same contract to the four remaining modules.

---

## 2. Per-Module Changes

### 2.1 Clients (`erp_prototype/js/clients.js`)

#### a. Current state summary
- `ClientsData` already has a generation-tagged cache and optimistic-skip helpers (`_startOptimisticSkip`, `_clearOptimisticSkipIfCurrent`, lines 212-225).
- `ClientsData._load()` already honors the skip guard and preserves local `status` when skipping (lines 117-128).
- Archive/unarchive functions exist (`archiveClientDirectly`, `bulkArchiveClientsDirectly`, `unarchiveClient`, `bulkUnarchiveClients`, lines 1439-1698).
- An `ArchivePage` archive view exists (`renderArchive`, lines 1711-1838).
- **Gaps**: counts are always re-fetched from `/clients/counts`; there is no immediate local count delta. Single/bulk archive code is hand-rolled rather than using a reusable `_optimisticUpdate` helper. `archiveClientDirectly` calls `clients.remove(id)` instead of the canonical `clients.archive(id)` endpoint.

#### b. Exact code changes required
1. **Add local count helpers** near the cache helpers (~line 230):
   - `_recalcCounts()` — derive active/archived from `ClientsData._clients` for the active entity.
   - `_updateCounts(activeDelta, archivedDelta)` — mutate a cached `_counts` object immediately (mirroring `Billing._updateCounts`, billing.js:279-283).
2. **Add reusable optimistic helpers** after the existing archive functions (~line 1631):
   - `Clients._optimisticUpdate(id, patch, apiCall, errorTitle)` — snapshot via `ClientsData.getClientById`, apply patch, start skip, `App.handleRoute()`, call `apiCall()`, invalidate `clients.counts`, clear skip, re-render, toast.
   - `Clients._optimisticDelete(id, apiCall, errorTitle)` — remove from `ClientsData._clients`, start skip, re-render, call API, restore on failure.
3. **Refactor `archiveClientDirectly` (line 1439)** to use `window.apiClient.clients.archive(id)` (apiClient.js:374) instead of `.remove(id)`. Keep `status = 'Archived'` in the optimistic patch.
4. **Refactor `unarchiveClient` (line 1633)** to set `status = 'Active'` and `archived = false` optimistically via `_optimisticUpdate`, then call `window.apiClient.clients.unarchive(id)`.
5. **Refactor `bulkArchiveClientsDirectly` (line 1533)** to snapshot the original `status` for each selected client, apply `_optimisticUpdate` per row, and roll back only the failed rows.
6. **Refactor `bulkUnarchiveClients` (line 1654)** similarly.
7. **Update `renderTabNav` (line 420)** to prefer the local `_counts` when fresh and only fall back to `getClientCounts()` when the cache is empty/stale; this avoids waiting for the network after a mutation.

#### c. New methods / handlers to add
- `Clients._recalcCounts()`
- `Clients._updateCounts(activeDelta, archivedDelta)`
- `Clients._optimisticUpdate(id, patch, apiCall, errorTitle)`
- `Clients._optimisticDelete(id, apiCall, errorTitle)`
- Keep public handlers but rewire their internals:
  - `archiveClientDirectly(clientId)`
  - `unarchiveClient(clientId)`
  - `bulkArchiveClientsDirectly(clientIds)`
  - `bulkUnarchiveClients(clientIds)`

#### d. Cache / count / render changes
- `ClientsData.invalidate()` already resets skip generations (lines 66-76); keep.
- After any archive/unarchive, call `window.apiClient.clientCache.invalidate()` and `window.apiClient.clients.invalidateCounts()` so pickers and nav badges refresh.
- `renderList` (line 511) must continue filtering `c.status !== 'Archived'` and `!c.archived`.
- `renderArchive` (line 1711) must continue merging server-archived rows with local-archived rows so pagination does not drop optimistic changes.

#### e. UI/UX changes
- Active list: keep the per-row trash/archive icon for Admins (line 809-830) and the floating bulk archive bar (line 532-650).
- Archive tab: keep `ArchivePage.render()` with **Restore** actions and bulk **Restore Selected** (lines 1716-1837).
- Add `Workflow.showConfirm` before every single/bulk archive/unarchive (already present in most paths).
- Toast copy: "Client archived", "Client restored".

#### f. API endpoint dependencies and backend gaps
- `POST /clients/:id/archive` and `POST /clients/:id/unarchive` already exist (apiClient.js:374-375). Switch `archiveClientDirectly` to use them.
- `GET /clients/counts?entityId=...` already exists (apiClient.js:365-369). Confirm backend counts archived clients by `status = 'Archived'` or `archived = true` consistently.

---

### 2.2 Billing (`erp_prototype/js/billing.js`)

#### a. Current state summary
- Billing already has the most complete implementation: `_listCache`, `_detailCache`, `_counts`, `_skipFetchGeneration`, `_beginSkipGeneration`, `_endSkipGeneration`, `_updateCounts`, `_schedulePostMutationRefresh`, and full archive/trash/restore flows.
- Existing handlers: `trashInvoice`, `restoreInvoice`, `archiveInvoice`, `bulkArchiveInvoices`, `bulkTrashInvoices`, `unarchiveInvoice`, `permanentDeleteInvoice` (lines 4108-4442).
- **Gaps**: each handler still manually snapshots, mutates, rolls back, and schedules refreshes. There is no `_optimisticUpdate` / `_optimisticDelete` helper, so fixes must be applied in multiple places. `renderTabNav` sometimes shows stale `_counts` because `loadCounts()` is async and `_updateCounts()` may race with it.

#### b. Exact code changes required
1. **Introduce `_optimisticUpdate` and `_optimisticDelete` helpers** near the cache helpers (~line 305, after `_schedulePostMutationRefresh`):
   - `_optimisticUpdate(id, patch, apiCall, errorTitle)` — snapshot via `_snapshotInvoice`, patch `_detailCache[id]` and `_addToListCache`, `_updateCounts(deltaActive, deltaArchived)`, start skip, `App.handleRoute()`, call `apiCall()`, apply server response, clear skip, re-render, toast.
   - `_optimisticDelete(id, apiCall, errorTitle)` — snapshot, `_removeFromListCache`, `_updateCounts`, start skip, route away from detail if needed, call API, clear skip, re-render; on failure restore snapshot.
2. **Refactor single handlers** to call the helpers:
   - `trashInvoice` (line 4108) → `_optimisticUpdate(id, { status:'Cancelled', archived:true }, ...)`.
   - `archiveInvoice` (line 4191) → `_optimisticUpdate(id, { archived:true }, ...)`.
   - `restoreInvoice` (line 4149) → `_optimisticUpdate(id, { status:'Draft', archived:false }, ...)`.
   - `unarchiveInvoice` (line 4355) → `_optimisticUpdate(id, { archived:false, status:targetStatus }, ...)`.
   - `permanentDeleteInvoice` (line 4401) → `_optimisticDelete(id, ...)`.
3. **Refactor bulk handlers** (`bulkArchiveInvoices` line 4229, `bulkTrashInvoices` line 4289) to iterate eligible rows, snapshot each, apply patches via `_optimisticUpdate` (or a batch variant), and roll back only failures.
4. **Stabilize `renderTabNav` (line 533)** by reading `_counts` first and only triggering `loadCounts(true)` when stale; ensure `_updateCounts` is the source of truth during skip generations.

#### c. New methods / handlers to add
- `Billing._optimisticUpdate(id, patch, apiCall, errorTitle)`
- `Billing._optimisticDelete(id, apiCall, errorTitle)`
- Optional: `Billing._batchOptimisticUpdate(ids, patchFactory, apiCallFactory)` for bulk operations.

#### d. Cache / count / render changes
- `_updateCounts(activeDelta, archivedDelta)` (line 279) already exists; ensure every mutation path uses it.
- `_schedulePostMutationRefresh()` (line 159) already schedules a background refresh; keep it but make sure it does not fire during an active skip generation.
- `_beginSkipGeneration()` / `_endSkipGeneration()` (lines 146-157) already exist; helpers must use them.
- `renderArchive` (line 4444) already merges local archived rows; keep the merge logic and pagination.

#### e. UI/UX changes
- List view: keep row-level **Trash** for Draft and **Archive** for Paid (lines 1233-1247); keep DataTable bulk actions (lines 1291-1311).
- Archive page: keep **Unarchive**, **Restore to Draft**, **Delete Permanently** actions (lines 4516-4540) and category tabs `accomplished | cancelled | rejected`.
- Detail view: keep the action bar buttons (lines 410-430 area in render/detail branch); ensure archive/trash use the new helpers.

#### f. API endpoint dependencies and backend gaps
- `POST /invoices/:id/archive`, `POST /invoices/:id/unarchive`, `DELETE /invoices/:id` already exist (apiClient.js:480-482).
- `GET /invoices/counts?entityId=...` exists (apiClient.js:471-475). Confirm backend returns `{active, archived, rejected, templates}` and that `archived` includes both paid-archived and cancelled rows.

---

### 2.3 Transmittal (`erp_prototype/js/transmittal.js`)

#### a. Current state summary
- `_items` cache + `_skipFetchGeneration` / `_startSkipFetchGeneration` / `_clearActiveSkipGeneration` exist (lines 79-93).
- `_updateCachedItem()` / `_removeFromCache()` helpers exist for snapshots (lines 163-191).
- Archive/unarchive handlers exist (`archiveTransmittal`, `bulkArchiveTransmittals`, `unarchiveTransmittal`, `permanentDeleteTransmittal`, lines 2485-2630+).
- `renderArchive` exists with pagination (lines ~2630+ / 2700+).
- **Gaps**: no reusable `_optimisticUpdate` helper; no local `_counts` object (tab counts are derived from `_items`, which works but diverges from Billing/Disbursement); no `bulkUnarchiveTransmittals` helper; board/table/list archive actions are duplicated.

#### b. Exact code changes required
1. **Add `_counts` and count helpers** near `_rejectedArchiveCounts` (~line 21):
   - `_recalcCounts()` — count active (`!archived && status !== 'Cancelled'`) and archived (`archived || status === 'Cancelled'`) from `_items` for the active entity.
   - `_updateCounts(activeDelta, archivedDelta)` — mutate `_counts`.
2. **Add `_optimisticUpdate` / `_optimisticDelete` helpers** after `_updateCachedItem` (~line 191):
   - Use `_updateCachedItem()` for snapshots.
   - Use `_startSkipFetchGeneration()` / `_clearActiveSkipGeneration()` for the guard.
   - Call `window.apiClient.transmittals.invalidateCounts()` after success.
3. **Refactor handlers** to use the helpers:
   - `archiveTransmittal` (line 2485)
   - `bulkArchiveTransmittals` (line 2528)
   - `unarchiveTransmittal` (line 2580)
   - `permanentDeleteTransmittal` (line 2615)
4. **Add `bulkUnarchiveTransmittals(ids)`** and wire the archive-page bulk action to it instead of looping over single `unarchiveTransmittal` (lines 2828-2843).
5. **Stabilize `renderTabNav` (line 493)** to read from `_counts` when fresh; fallback to deriving from `_items` only when stale.

#### c. New methods / handlers to add
- `Transmittal._recalcCounts()`
- `Transmittal._updateCounts(activeDelta, archivedDelta)`
- `Transmittal._optimisticUpdate(id, patch, apiCall, errorTitle)`
- `Transmittal._optimisticDelete(id, apiCall, errorTitle)`
- `Transmittal.bulkUnarchiveTransmittals(ids)`
- Rewired public handlers: `archiveTransmittal`, `bulkArchiveTransmittals`, `unarchiveTransmittal`, `permanentDeleteTransmittal`.

#### d. Cache / count / render changes
- `_items` is already preserved during skip generations (line 135-149 in `_load()`).
- After any mutation, call `window.apiClient.transmittals.invalidateCounts()` (already done in several places; standardize).
- `renderList` / `refreshList` (lines 686-943) already filters `!t.archived && t.status !== 'Cancelled'`; keep.
- `renderArchive` (lines ~2630+) already merges server + local archived rows and shows rejected operation requests; keep.

#### e. UI/UX changes
- Detail view: keep **Archive** / **Unarchive** / **Delete** buttons for Admin (lines 378-391).
- Table view: keep row **Archive** for Acknowledged and **Delete** for Admin (lines 990-998); keep bulk **Archive** and **Delete** (lines 1025-1048).
- Board view: keep card menu **Archive** / **Delete** (lines 1196-1210).
- Compact list: keep the same actions (lines 1294-1303).
- Archive page: keep category tabs `acknowledged | cancelled | rejected`, restore/delete actions, and bulk **Restore Selected** / **Delete Selected**.

#### f. API endpoint dependencies and backend gaps
- `POST /transmittals/:id/archive`, `POST /transmittals/:id/unarchive`, `DELETE /transmittals/:id` already exist (apiClient.js:541-543).
- `GET /transmittals/counts?entityId=...` exists (apiClient.js:530-534). Confirm backend returns `{active, archived, total}`.

---

### 2.4 Operations / Workflow (`erp_prototype/js/workflow.js`)

#### a. Current state summary
- `WorkflowData` has a generation-tagged cache and already honors `Workflow._activeSkipGeneration` during `_load()` (lines 288, 307-320, 349).
- `Workflow` has `_startSkipGeneration()` / `_clearSkipGenerationIfLatest()` / `_resetSkipGenerations()` (lines 1044-1060).
- Archive/unarchive handlers exist (`archiveWorkRequest`, `unarchiveWorkRequest`, `bulkArchiveWorkRequests`, lines 1844-1914).
- `renderArchive` exists with pagination and rejected pending-change merge (lines 11763-11925).
- **Gaps**: there is no reusable `_optimisticUpdate` helper. `archiveWorkRequest` mutates `wr.archived` directly and sets `_needsFreshFetch = true` instead of snapshotting and rolling back via a helper. Bulk archive calls `WorkflowData.updateWorkRequest()` but does not handle per-row API failures or rollback. Counts are derived entirely from `WorkflowData` cache and are not updated via a local `_counts` object (this is acceptable, but the pattern diverges from Disbursement/Billing).

#### b. Exact code changes required
1. **Add snapshot helpers** on `WorkflowData` near `getWorkRequestById` (~line 391):
   - `_snapshotWorkRequest(id)` — deep clone of the cached WR.
   - `_restoreWorkRequest(id, snapshot)` — replace the cached WR with the snapshot.
2. **Add `Workflow._optimisticUpdate` / `_optimisticDelete` helpers** near `_startSkipGeneration` (~line 1060):
   - For update: snapshot WR, apply patch, start skip, `App.handleRoute()`, call API, clear skip, re-render, toast.
   - For delete/cancel: snapshot, mark status/Archived, start skip, re-render, call API, restore on failure.
3. **Refactor `archiveWorkRequest` (line 1844)** to use `_optimisticUpdate`:
   - Patch `{ archived: true, updatedAt: now }`.
   - Call `window.apiClient.workRequests.archive(wrId)`.
   - Keep `WorkflowData.invalidateRelatedForWorkRequest(wrId)` after success.
4. **Refactor `unarchiveWorkRequest` (line 1871)** similarly with `window.apiClient.workRequests.unarchive(wrId)`.
5. **Refactor `bulkArchiveWorkRequests` (line 1891)** to snapshot each eligible WR, apply optimistic patches, call API per row, and restore only failed rows.
6. **Refactor `cancelWorkRequest` (around line 1780)** to use `_optimisticUpdate` and set `{ status:'Cancelled', archived:true }` (it already does this, but wrap it for consistent rollback).
7. **Keep `renderTabNav` (line 3500)** deriving counts from `WorkflowData` cache; add a small local `_counts` cache that is updated optimistically so the badge does not flicker on slow counts.

#### c. New methods / handlers to add
- `WorkflowData._snapshotWorkRequest(id)`
- `WorkflowData._restoreWorkRequest(id, snapshot)`
- `Workflow._optimisticUpdate(id, patch, apiCall, errorTitle)`
- `Workflow._optimisticDelete(id, apiCall, errorTitle)`
- Rewired: `archiveWorkRequest(wrId)`, `unarchiveWorkRequest(wrId)`, `bulkArchiveWorkRequests(ids)`, `cancelWorkRequest(wrId)`.

#### d. Cache / count / render changes
- `WorkflowData._mergeWorkRequests()` already preserves local `archived` and `status === 'Cancelled'` during skip generations (lines 314-320); keep.
- After archive/unarchive/cancel, call `window.apiClient.workRequests.invalidateCounts()` and `WorkflowData.invalidateRelatedForWorkRequest(id)`.
- `renderList` (line 4224+) already uses `shouldSkipServerFetch`; keep.
- `renderArchive` (line 11763+) already merges local archived/cancelled; keep.

#### e. UI/UX changes
- Active list/table: keep **Archive** button on Completed WRs and **Cancel** for managerial users (lines 4402-4412); keep bulk **Archive** and **Cancel** actions (lines 4476-4495).
- Board view: keep card menu **Archive** / **Cancel** (lines ~4680+).
- Archive page: keep **Unarchive** for accomplished, **Restore to Draft** for cancelled, and rejected pending-change cards (lines 11819-11853).

#### f. API endpoint dependencies and backend gaps
- `POST /work-requests/:id/archive`, `POST /work-requests/:id/unarchive` already exist (apiClient.js:419-420).
- `GET /work-requests/counts?entityId=...` exists (apiClient.js:410-414) but is not currently used by Operations; consider consuming it in `renderTabNav` for consistency, falling back to cache derivation.

---

## 3. Shared / Cross-Cutting Changes

### 3.1 `erp_prototype/js/app.js`
- `App.handleRoute()` already checks `module.hasCachedData(entity)` to skip the route skeleton (lines 747-750). Ensure every module implements `hasCachedData(entity)` consistently:
  - Clients: `ClientsData.hasData() && ClientsData._entity === entity` (already present at line 228).
  - Billing: `_detailCacheEntity === entity && _listCacheEntity === entity && _countsEntity === entity` (already present at line 169-177).
  - Transmittal: `Array.isArray(this._items) && this._isEntityFresh()` (already present at line 60-62).
  - Operations: `WorkflowData.hasData() && WorkflowData._entity === entity` (already present at line 1072-1074).
- `App.updateSidebarNotifications()` (line 206) only refreshes disbursement and operations counts. Extend it to invalidate/refresh counts for the currently visible module after an archive/unarchive mutation, or move that responsibility into each module's optimistic helper.
- `renderEntitySwitcher()` already resets `Billing.view`, `Disbursement.view`, `Transmittal.view`, `Workflow.view`, and `Clients.editingId` on entity switch (lines 373-387). Ensure module caches are also invalidated on entity switch (clients/billing/transmittal already do; confirm Operations does via `WorkflowData.invalidate()` if not already called).

### 3.2 `erp_prototype/js/apiClient.js`
- Count endpoints exist for all modules (clients, invoices, workRequests, transmittals, disbursements, operationsRequests). Confirm each `counts` response shape matches the module's expectations.
- Archive/unarchive endpoints exist for clients, invoices, workRequests, transmittals, disbursements, documents. No new backend endpoints are required for the front-end refactor.
- Ensure every mutating `apiClient` helper calls `invalidateCounts` for its module (already present for most). Standardize if any are missing.

### 3.3 Shared helpers / conventions
- **Naming convention**: use `_startSkipGeneration` / `_endSkipGeneration` (or `_clearSkipGenerationIfCurrent`) in every module. Disbursement uses `_setActiveSkipGeneration` / `_clearSkipGenerationIfCurrent`; Billing uses `_beginSkipGeneration` / `_endSkipGeneration`; Transmittal uses `_startSkipFetchGeneration` / `_clearActiveSkipGeneration`; Operations uses `_startSkipGeneration` / `_clearSkipGenerationIfLatest`. For 1:1 parity, align on one naming pair per module but keep existing public names to avoid regressions.
- **Toast/error handling**: all mutations must use `Workflow.showConfirm` for confirmation, `Workflow.showMessage` for success/error, and must re-call `App.handleRoute()` after rollback.
- **Route-away rule**: if the current view is the detail of the mutated record and the record is archived/deleted, navigate to the module base route before re-rendering (Billing already does this in `trashInvoice` / `permanentDeleteInvoice`).

---

## 4. Implementation Task List (in order)

### Priority 1 — Foundation / shared helpers
1. [ ] In `apiClient.js`, verify and standardize `invalidateCounts()` calls on every archive/unarchive/delete/update method.
2. [ ] In `app.js`, ensure `updateSidebarNotifications` refreshes module counts after mutations (or document that each module will do it locally).
3. [ ] Add shared optimistic-helper stubs/sketch in a scratch branch to ensure naming does not conflict.

### Priority 2 — Billing (closest to reference, highest ROI)
4. [ ] Add `Billing._optimisticUpdate(id, patch, apiCall, errorTitle)` and `Billing._optimisticDelete(...)` (~line 305).
5. [ ] Refactor `trashInvoice` (line 4108) to use `_optimisticUpdate`.
6. [ ] Refactor `archiveInvoice` (line 4191) to use `_optimisticUpdate`.
7. [ ] Refactor `restoreInvoice` (line 4149) to use `_optimisticUpdate`.
8. [ ] Refactor `unarchiveInvoice` (line 4355) to use `_optimisticUpdate`.
9. [ ] Refactor `permanentDeleteInvoice` (line 4401) to use `_optimisticDelete`.
10. [ ] Refactor `bulkArchiveInvoices` (line 4229) to batch snapshots and per-row rollback.
11. [ ] Refactor `bulkTrashInvoices` (line 4289) to batch snapshots and per-row rollback.
12. [ ] Stabilize `renderTabNav` (line 533) to prefer local `_counts` and avoid flicker.

### Priority 3 — Transmittal
13. [ ] Add `Transmittal._counts`, `_recalcCounts()`, `_updateCounts()` (~line 21).
14. [ ] Add `Transmittal._optimisticUpdate()` / `_optimisticDelete()` (~line 191).
15. [ ] Refactor `archiveTransmittal` (line 2485) to use helper.
16. [ ] Refactor `bulkArchiveTransmittals` (line 2528) to use helper with per-row rollback.
17. [ ] Refactor `unarchiveTransmittal` (line 2580) to use helper.
18. [ ] Refactor `permanentDeleteTransmittal` (line 2615) to use helper.
19. [ ] Add `bulkUnarchiveTransmittals(ids)` and wire archive-page bulk action (lines 2828-2843).
20. [ ] Update `renderTabNav` (line 493) to read `_counts` first.

### Priority 4 — Clients
21. [ ] Add `Clients._counts`, `_recalcCounts()`, `_updateCounts()` (~line 230).
22. [ ] Add `Clients._optimisticUpdate()` / `_optimisticDelete()` (~line 1631).
23. [ ] Refactor `archiveClientDirectly` (line 1439) to use `clients.archive(id)` and helper.
24. [ ] Refactor `unarchiveClient` (line 1633) to use helper.
25. [ ] Refactor `bulkArchiveClientsDirectly` (line 1533) to batch snapshots and per-row rollback.
26. [ ] Refactor `bulkUnarchiveClients` (line 1654) similarly.
27. [ ] Update `renderTabNav` (line 420) to prefer local `_counts`.

### Priority 5 — Operations
28. [ ] Add `WorkflowData._snapshotWorkRequest(id)` and `_restoreWorkRequest(id, snapshot)` (~line 391).
29. [ ] Add `Workflow._optimisticUpdate()` / `_optimisticDelete()` (~line 1060).
30. [ ] Refactor `archiveWorkRequest` (line 1844) to use helper.
31. [ ] Refactor `unarchiveWorkRequest` (line 1871) to use helper.
32. [ ] Refactor `bulkArchiveWorkRequests` (line 1891) to batch snapshots and per-row rollback.
33. [ ] Refactor `cancelWorkRequest` (~line 1780) to use helper.
34. [ ] Add/update `Workflow._counts` cache and make `renderTabNav` (line 3500) read it first.

### Priority 6 — Verification
35. [ ] Code review: confirm no direct cache mutation remains outside the helpers.
36. [ ] Manual smoke test each module: archive → list refresh → count badge → archive page → restore → count badge.
37. [ ] Test failure rollback by forcing a 500 on archive endpoints (e.g., via browser devtools request blocking).

---

## 5. Risks and Testing Notes

### Risks
- **Generation mismatch / stale items**: If a mutation completes while a background `ensure()` is in flight, the older server payload may overwrite the optimistic record if `_loadGeneration` is not bumped or `_activeSkipGeneration` is cleared too early. Helpers must bump `_loadGeneration` when starting the skip and only clear `_activeSkipGeneration` after `App.handleRoute()` in the finally/success path.
- **Count flicker**: Calling `loadCounts()` from the network after every mutation can briefly show the old count. Local `_updateCounts` must run **before** `App.handleRoute()`, and network count refreshes must be scheduled or invalidated, not awaited.
- **Entity / ALL view bugs**: In consolidated (`ALL`) mode, modules fall back to the user's first entity. Archive mutations must preserve the record's entity code so it does not disappear from the active entity or reappear in the wrong one.
- **Bulk partial failure**: A loop that fires all API calls concurrently makes rollback complex. Process bulk archives sequentially so each failure can be rolled back independently before the next request.
- **Route-away timing**: Deleting/archiving the currently viewed detail record must change `location.hash` to the module base route before `App.handleRoute()` so the UI does not render a stale detail skeleton.

### Testing notes (manual / code-only)
- Confirm that after clicking **Archive**, the row disappears from the active list and the archive tab count increments within one frame.
- Confirm that after a failed archive (blocked request), the row reappears and the count returns to the original value.
- Confirm that navigating to the archive page shows the newly archived row without a full reload.
- Confirm that restoring from the archive page increments the active tab count and decrements the archive tab count immediately.
- Confirm that switching entity clears the skip generation and re-fetches the correct counts.
- No Playwright or automated browser tests are required for this plan; validation is by code review plus manual UI smoke tests.

---

## 6. Definition of Done (1:1 parity with Disbursement)

A module is considered done when:

1. **Optimistic archive/trash/restore/delete** — every mutation updates the local cache first, then calls the API, then clears the skip generation.
2. **Skip-generation guard** — `ensure()` / `_load()` respects `_activeSkipGeneration === _skipFetchGeneration` so server responses cannot clobber optimistic records during the mutation window.
3. **Instant re-render** — `App.handleRoute()` is called immediately after the optimistic patch and again after the API completes.
4. **Count parity** — tab badges update from local state without waiting for the network; server count caches are invalidated on mutation.
5. **Rollback** — on API failure, the original record state is restored, the skip generation is cleared, the UI re-renders, and an error toast is shown.
6. **Archive page parity** — the archive tab/page supports server+local merge, pagination, category tabs, per-row restore/delete actions, and bulk actions where applicable.
7. **No regressions** — existing create/edit flows, pending approvals, and entity switching continue to work.
8. **Code-only validation** — no Playwright or automated browser tests are introduced; changes are verifiable by inspection and manual smoke tests.

---

*Plan generated 2026-07-21 for the `uat` branch. Implement module-by-module, starting with Billing, then Transmittal, Clients, and Operations.*
