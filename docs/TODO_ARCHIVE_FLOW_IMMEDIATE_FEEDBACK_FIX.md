# Archive/Cancel/Trash Immediate-Feedback Fix — Hand-off Plan

**Date:** 2026-07-21  
**Branch:** `uat`  
**Status:** Root causes confirmed via dynamic multi-module audit; implementation queued for next agent  
**Related docs:**
- `docs/TODO_ARCHIVE_PATTERN_FIX.md` — broader archive/restore endpoint work (backend endpoints and entity scoping are already in place).
- `docs/CHECKPOINT_ENTITY_NAV_ARCHIVE.md` — reference implementation notes from Operations.

---

## 1. Executive Summary

The archive, cancel, and trash flows across **Clients, Operations, Billing, Disbursements, and Transmittals** are *mostly* wired to backend archive/unarchive endpoints, but items still linger on the active page or fail to appear instantly on the archive page after the user confirms.

The single biggest root cause is a **generation mismatch** in the frontend cache layer:

- Each module uses an **optimistic skip generation** (`_skipFetchGeneration` / `_activeSkipGeneration`) to stop new list fetches while a mutation is in flight.
- Each module also uses a **load generation** (`_loadGeneration` / `_listCacheGeneration`) inside its list loader to discard stale in-flight results.
- These two generations are **not synchronized**. An archive sets the skip flag, but it does **not** bump the load generation, so a list/background fetch that started *before* the confirmation can still land afterwards and overwrite the optimistic `archived=true` state. The row then reappears in the active list (or vanishes from the archive view) exactly when the user switches tabs or pages.

Secondary causes:

- **Clients** derive archive counts from a local cache that never contains archived rows, so the archive badge is wrong after a refresh.
- **Transmittals** derive counts from `GET /transmittals/counts`, which only refreshes after the API round-trip; the badge does not update at modal confirmation.
- **Operations** has an immediate crash in `archiveWorkRequest` (`WorkflowData.invalidateCounts()` does not exist) and miscategorises cancelled work requests under the archive page’s “Completed/accomplished” bucket.
- **Billing**’s Draft-trash path leaves records as `archived=true, status=Draft`, making them neither restorable nor correctly categorised.

This document hands off the exact P0 fixes. Implement them in the order listed; do not move to P1 polish until the P0 race is fixed in every module.

---

## 2. Cross-Cutting Fix Pattern

Apply this pattern in every module. The examples below use Billing field names; adapt to the equivalent fields in the other modules.

1. **Start of optimistic mutation**
   - Increment the module’s **load generation** (`_loadGeneration`, `_listCacheGeneration`, or `ClientsData._loadGeneration`) **and** set the active skip generation.
   - Example for Billing:
     ```js
     _beginSkipGeneration() {
       this._skipFetchGeneration = (this._skipFetchGeneration || 0) + 1;
       this._activeSkipGeneration = this._skipFetchGeneration;
       this._listCacheGeneration++;   // NEW: discard in-flight fetches
       return this._skipFetchGeneration;
     }
     ```
   - Example for Disbursement: `_setActiveSkipGeneration()` should also `this._loadGeneration++`.
   - Example for Clients: `Clients._startOptimisticSkip()` should also `ClientsData._loadGeneration++`.
   - Example for Transmittal: `_startSkipFetchGeneration()` should also `this._loadGeneration++`.
   - Example for Operations: `Workflow._startSkipGeneration()` should also `WorkflowData._loadGeneration++`.

2. **List loader guard**
   - In every `ensure() -> _load()` and `backgroundRefresh()` path, return early (do not merge or replace) when an optimistic skip is active:
     ```js
     async _load(loadGen) {
       // existing generation check
       if (loadGen !== this._loadGeneration || entityChanged) return;
       // NEW: skip applying server data during an optimistic mutation
       if (this._activeSkipGeneration > 0 && this._activeSkipGeneration === this._skipFetchGeneration) return;
       ...
     }
     ```
   - This prevents a pre-mutation fetch from clobbering the optimistic state.

3. **Defensive merge**
   - When merging server records into the local cache (`_mergeItems`, `_mergeWorkRequests`, `_loadInvoices` merge path, `_load` replacement), do **not** overwrite `archived` or `status` with an older server value while a mutation is in flight.
   - For Billing specifically, prefer replacing the whole array item with the optimistic snapshot rather than `Object.assign` when the local `updatedAt` is newer than the server `updatedAt`.

4. **Immediate count updates**
   - If counts are derived from local cache (Billing, Disbursements, Operations), keep the existing synchronous recompute and make sure it runs **before** `App.handleRoute()`.
   - If counts come from the API (Transmittals, Clients after the fix), either:
     - invalidate the API count cache and re-render after the API call, or
     - maintain a local optimistic delta and add it to the displayed badge until the server responds.

5. **No hard commits** without team coordination. The `uat` branch has uncommitted changes.

---

## 3. Module-by-Module P0 Tasks

### 3.1 Clients

| # | Change | File / Location | Notes |
|---|--------|-----------------|-------|
| 1 | Synchronize optimistic skip with `ClientsData._loadGeneration`. | `erp_prototype/js/clients.js` `Clients._startOptimisticSkip()` (`:192-196`) | Also increment `ClientsData._loadGeneration` so any in-flight `ClientsData._load()` is discarded. |
| 2 | Guard `ClientsData._load()` against active skip. | `erp_prototype/js/clients.js` `ClientsData._load()` (`:97-118`) | Return early when `Clients._activeSkipGeneration` matches `Clients._skipFetchGeneration`. |
| 3 | Fix the refresh button so it does **not** clear the active skip generation. | `erp_prototype/js/clients.js` refresh handler (`:914-917`) | Currently it resets `_activeSkipGeneration`, allowing a network fetch to overwrite an in-progress optimistic mutation. Skip the refresh while a mutation is in flight. |
| 4 | Re-insert or refetch restored clients. | `erp_prototype/js/clients.js` `unarchiveClient()` / `bulkUnarchiveClients()` (`:1598-1661`) | `ClientsData` only caches non-deleted rows, so a restored client is not in the cache. Call `ClientsData.invalidate()` on success so the next render fetches the restored record, or optimistically insert it. |
| 5 | Derive counts from the authoritative `/clients/counts` endpoint. | `erp_prototype/js/clients.js` `getClientCounts()` / `renderTabNav()` (`:380-449`) | Replace the local-cache-based `archivedCount` with `window.apiClient.clients.counts()`; the API count cache is already invalidated by archive/unarchive mutations. Keep the rejected-count overlay. |

**Verification:**
- Archive a client → row disappears immediately; active badge decrements; archive badge increments.
- Switch to Archive tab → client is listed.
- Switch away and back → client is still in Archive and not in Active.
- Refresh → archive badge still matches server count.
- Restore → client reappears in Active immediately; archive badge decrements.

---

### 3.2 Operations / Work Requests

| # | Change | File / Location | Notes |
|---|--------|-----------------|-------|
| 1 | Fix the crash in `archiveWorkRequest`. | `erp_prototype/js/workflow.js` `:1778` | `WorkflowData.invalidateCounts()` does not exist. Use `window.apiClient.workRequests.invalidateCounts()` (or remove the call, since the API client already invalidates counts on archive). |
| 2 | Synchronize skip generation with `WorkflowData._loadGeneration`. | `erp_prototype/js/workflow.js` `Workflow._startSkipGeneration()` (`:977-980`) | Also increment `WorkflowData._loadGeneration`. |
| 3 | Guard `WorkflowData._load()` and `backgroundRefresh()` against active skip. | `erp_prototype/js/workflow.js` `WorkflowData._load()` (`:259-299`) and `backgroundRefresh()` (`:335-344`) | Return early while `Workflow._activeSkipGeneration` is active. |
| 4 | Make `updateWorkRequest` not clear the active skip generation for multi-step mutations. | `erp_prototype/js/workflow.js` `updateWorkRequest()` (`:581-630`) | Only clear the skip generation that was held by the caller (e.g., pass the generation in and only clear if it matches). Currently it clears the active skip after its own API call, breaking bulk/cancel flows. |
| 5 | Route archive through `WorkflowData.updateWorkRequest({ archived: true })`. | `erp_prototype/js/workflow.js` `archiveWorkRequest()` (`:1774-1794`) | Direct mutation bypasses `_needsFreshFetch` and the safe merge path. Use the helper so the server response is merged safely. |
| 6 | Defensive merge for `archived` / `status`. | `erp_prototype/js/workflow.js` `_mergeWorkRequests()` (`:301-315`) | Do not `Object.assign` over local `archived`/`status` when the local record has a newer `updatedAt` or when a skip is active. |
| 7 | Fix archive-page categorisation. | `erp_prototype/js/workflow.js` `renderArchive()` (`:11705-11719`) | `accomplished` should require `status === 'Completed' && archived === true`; `cancelled` should include `status === 'Cancelled'` regardless of `archived`. |
| 8 | Add rollback to `deleteWorkRequest`. | `erp_prototype/js/workflow.js` `deleteWorkRequest()` (`:677-691`) | Snapshot the removed work request and restore it if `window.apiClient.workRequests.remove()` fails. |

**Verification:**
- Archive a Completed WR → disappears from active; archive badge increments.
- Cancel an active WR → moves to Cancelled column and is not shown as Completed in the archive page.
- Switch tabs/pages quickly after confirm → the WR does not reappear in Active.
- Refresh → archive/cancelled lists are stable.
- Unarchive/restore → returns to Active.

---

### 3.3 Billing

| # | Change | File / Location | Notes |
|---|--------|-----------------|-------|
| 1 | Synchronize skip generation with `_listCacheGeneration`. | `erp_prototype/js/billing.js` `_beginSkipGeneration()` (`:115-119`) | Also increment `_listCacheGeneration` so older in-flight fetches are discarded. |
| 2 | Guard `_loadInvoices()` / `backgroundRefresh()` / `fetchInvoices()` against active skip. | `erp_prototype/js/billing.js` `_loadInvoices()` (`:64-87`), `backgroundRefresh()` (`:89-96`), `fetchInvoices()` (`:726-756`) | Do not merge server data while `_activeSkipGeneration` is current. |
| 3 | Defensive merge in `_loadInvoices` merge path. | `erp_prototype/js/billing.js` `_loadInvoices()` merge branch (`:73-79`) | Do not overwrite `archived`/`status` with an older server value. Prefer the local optimistic record when its `updatedAt` is newer. |
| 4 | Fix Draft trash semantics. | `erp_prototype/js/billing.js` `trashInvoice()` (`:4044-4082`) and `bulkTrashInvoices()` (`:4202-4260`) | Set `status: 'Cancelled'` (not `archived=true` alone) so the record is restorable and appears under Cancelled in the archive view. For single trash, call the appropriate endpoint or use `update` with `status='Cancelled', archived=true`. For bulk trash, decide whether to soft-delete or archive; if soft-deleting, do not optimistically include `deleted_at` rows in the archive list. |
| 5 | Use the dedicated archive endpoint for bulk archive. | `erp_prototype/js/billing.js` `bulkArchiveInvoices()` (`:4148-4200`) | Call `window.apiClient.invoices.archive(id)` for each eligible invoice instead of `update`. |
| 6 | Add a restore action for cancelled/trashed Draft invoices. | `erp_prototype/js/billing.js` `renderArchive()` (`:4336-4370+`) | Expose a “Restore to Draft” action for `status === 'Cancelled'` records. |

**Verification:**
- Archive a Paid invoice → disappears from active, archive badge increments, appears in Archive under Paid.
- Trash a Draft invoice → disappears from active, appears in Archive under Cancelled, and is restorable.
- Switch tabs/pages quickly after confirm → the invoice does not reappear in Active.
- Bulk archive/trash → same behaviour; partial failures roll back cleanly.

---

### 3.4 Disbursements

| # | Change | File / Location | Notes |
|---|--------|-----------------|-------|
| 1 | Synchronize skip generation with `_loadGeneration`. | `erp_prototype/js/disbursement.js` `_setActiveSkipGeneration()` (`:253-257`) | Also increment `_loadGeneration`. |
| 2 | Guard `_load()` and `backgroundRefresh()` against active skip. | `erp_prototype/js/disbursement.js` `_load()` (`:294-339`), `backgroundRefresh()` (`:341-348`) | Return early while `_activeSkipGeneration` matches `_skipFetchGeneration`. |
| 3 | Defensive merge. | `erp_prototype/js/disbursement.js` `_mergeItems()` (`:328-339`) | Do not `Object.assign` over `archived` or `status` when the local record is newer or a skip is active. |
| 4 | Harden bulk archive. | `erp_prototype/js/disbursement.js` `bulkArchiveDisbursements()` (`:3691-3722`) | Continue on individual failures, collect failed IDs, roll back only failed items, and report partial success. |
| 5 | Respect pagination in `renderArchive()` merge. | `erp_prototype/js/disbursement.js` `renderArchive()` (`:3756-3906`) | Only merge local archived items on the first page or when the active skip is current; otherwise rely on the paginated server response to avoid duplicates on every page. |

**Verification:**
- Archive a Funded disbursement → card/row disappears from active board/table; active badge decrements; archive badge increments.
- Switch to board/table/archive quickly → card stays in Archive and does not reappear in Active.
- Bulk archive → selected cards move; failures roll back individually.

---

### 3.5 Transmittals

| # | Change | File / Location | Notes |
|---|--------|-----------------|-------|
| 1 | Synchronize skip generation with `_loadGeneration`. | `erp_prototype/js/transmittal.js` `_startSkipFetchGeneration()` (`:60-63`) | Also increment `_loadGeneration`. |
| 2 | Guard `_load()` / `ensure()` against active skip. | `erp_prototype/js/transmittal.js` `Transmittal._load()` (`:100-111`) and `ensure()` (`:82-98`) | Return early while `_activeSkipGeneration` is current; do not replace the whole `_items` array during a mutation. |
| 3 | Use immutable cache helpers for archive/unarchive. | `erp_prototype/js/transmittal.js` `archiveTransmittal()` / `unarchiveTransmittal()` (`:2306-2398`) | Use `_updateCachedItem(id, { archived: true/false, updatedAt: … })` instead of mutating `item.archived` in place. |
| 4 | Optimistic count update. | `erp_prototype/js/transmittal.js` `renderTabNav()` (`:401-435`) | Maintain a local `_counts` object updated synchronously when `_items` changes, or add an optimistic delta overlay so the badge updates at modal confirmation. Invalidate/refetch after the API resolves. |
| 5 | Re-render after permanent delete. | `erp_prototype/js/transmittal.js` `permanentDeleteTransmittal()` (`:2400-2439`) | Call `App.handleRoute()` after invalidating the cache on success so the archive list and counts repaint. |
| 6 | Harden bulk archive and delete rollback. | `erp_prototype/js/transmittal.js` `bulkArchiveTransmittals()` (`:2338-2369`) and `permanentDeleteTransmittal()` (`:2427-2431`) | Track per-ID results, restore failed items by ID rather than numeric index, and report partial success. |

**Verification:**
- Acknowledge a transmittal, then archive it → disappears from active list; archive badge increments; appears in Archive.
- Switch tabs/pages quickly → it does not reappear in Active.
- Unarchive → returns to Active.
- Delete from archive → row disappears immediately; badge updates.

---

## 4. P1 Follow-Ups (after P0 race is fixed everywhere)

1. **Standardise archive vs. delete language** in confirmation modals (many still say “Permanently Delete” while the backend soft-deletes).
2. **Add `/counts` invalidation** in the few remaining modules that still skip it (Operations after safe merge; Clients already fixed in P0).
3. **Audit `Documents / DMS`** archive flow (it has endpoints and count cache, but no UI archive tab yet). This is covered separately in `docs/TODO_ARCHIVE_PATTERN_FIX.md`.
4. **Integration tests** for archive/unarchive round-trips and `/counts` accuracy per module.

---

## 5. Verification Checklist

Run this for **each module** × **ATA / LTA / ALL**:

1. Create a record eligible for archive/cancel/trash.
2. Click the action and confirm in the modal.
3. **Immediately** after the modal closes:
   - the row/card disappears from the active list/board;
   - the active badge decrements;
   - the archive/cancelled badge increments.
4. Switch to the Archive/Cancelled tab → the record is listed within the same render.
5. Click another sidebar item and return → the record is still correctly categorised.
6. Refresh the browser → counts and lists match the server.
7. Restore/unarchive → the record returns to Active and the archive badge decrements.
8. Delete/trash (where applicable) → the record moves to Archive/Trash and is restorable.

### Static checks

- [ ] `node --check erp_prototype/js/clients.js`
- [ ] `node --check erp_prototype/js/workflow.js`
- [ ] `node --check erp_prototype/js/billing.js`
- [ ] `node --check erp_prototype/js/disbursement.js`
- [ ] `node --check erp_prototype/js/transmittal.js`
- [ ] `cd backend && PORT=0 npm test`

---

## 6. Notes for the Next Agent

1. **Operations is the reference for entity-aware caching**, but the generation-mismatch bug exists there too. Do not copy the skip-generation helpers blindly; apply the fixes above first.
2. **Do not use Playwright** unless explicitly requested. Verify in the browser and with backend tests.
3. **No commits** unless explicitly asked. The `uat` branch has uncommitted changes; coordinate before pushing.
4. **Dev server / service worker:** restart the prototype dev server after JS changes and hard-refresh the browser; `sw.js` is on `v2`.
5. **Backend tests:** `cd /home/javvii/FreelanceProject/Project4_Final-Render/backend && npm test`.
6. **Quick console helper:** `Auth.switchEntity('ATA' | 'LTA' | 'ALL')` to exercise entity switching.

---

*End of hand-off.*
