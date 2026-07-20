# Entity Handling, Nav Totals, and Archive-Feedback Checkpoint

**Date:** 2026-07-20  
**Branch:** `uat`  
**Scope:** Clients, Operations, Billing, Disbursement, and Transmittal list views.  
**Status:** Operations is the reference implementation. The other four modules still need the fixes below. No commits made.

---

## Context

Parallel subagents audited five modules for three related problems:

1. **Entity-aware list caching** — Does the module show the correct records after switching `Auth.activeEntity` (ATA ↔ LTA ↔ ALL)?
2. **Nav total synchronization** — Do the Active / Archive / Cancelled tab badges match the rows actually rendered?
3. **Immediate archive/cancel/delete feedback** — Does the item disappear from the list or board as soon as the user confirms, without waiting for a full round-trip + re-fetch?

The **Operations** page is already fixed and should be treated as the reference implementation. The relevant patterns were merged into `erp_prototype/js/workflow.js`, `erp_prototype/js/app.js`, `erp_prototype/js/utils.js`, and `backend/src/app.js` during the recent `uat` commits. See also `docs/PERFORMANCE_LOADING_SPEED_TODO.md` for the broader loading/performance goals these fixes support.

What already works in Operations:

- `WorkflowData` has an entity-tagged cache: `_entity`, `_loadingEntity`, `_loadGeneration`, `hasData()`, `_isEntityFresh()`, and `invalidate()`.
- `_load()` discards stale in-flight results after an entity switch or invalidation.
- `renderTabNav()` derives active, archive, and rejected counts from the same filtered client-side dataset that feeds `renderList()` and the Kanban board.
- `Auth.switchEntity()` and `triggerSyncReload()` reset Operations cache and suppress redundant hash-change events; sidebar counts update in the background.
- Board-specific local fields such as `boardOrder` are normalized in memory only; they do not trigger `PUT`s on every render.
- Mutations (`updateWorkRequest`, `cancelWorkRequest`, `archiveWorkRequest`, `deleteWorkRequest`, etc.) patch the local cache optimistically before the API call, then `App.handleRoute()` re-renders from the warm cache.

---

## Goals

### Goal A: Generalize Operations-style entity handling and nav sync

Apply the same entity-tagging, cache invalidation, and count-from-cache logic to **Clients**, **Billing**, **Disbursement**, and **Transmittal** list views. After switching entities, every module must immediately show rows scoped to the newly selected entity and matching tab badges.

### Goal B: Fix slow archive/cancel/delete feedback across all five modules

Make rows/cards disappear the instant the user confirms an archive, cancel, trash, or delete action. Tab badges and global sidebar counts must update synchronously, before the API response arrives, with a safe rollback on failure.

---

## Operations Page — Reference Implementation Checklist

Copy/adapt these exact patterns in the order listed.

### Backend — `Vary: X-Active-Entity` on list GETs

- File: `backend/src/app.js`
- Current state: Helmet CORP is disabled; CORS and entity middleware are present. `Vary: X-Active-Entity` may already be emitted by the cache-control middleware, but verify it is present on every list endpoint (`/v1/clients`, `/v1/invoices`, `/v1/disbursements`, `/v1/transmittals`, `/v1/work-requests`).
- TODO: Add or confirm `Vary: X-Active-Entity` header on all GET list responses so browser/CDN caches key responses by active entity.

### Frontend data cache — entity-tagged cache

- File: `erp_prototype/js/workflow.js` (lines ~84–432)
- Pattern to copy: `WorkflowData._entity`, `hasData()`, `_isEntityFresh()`, `_loadGeneration`, `ensure()`, `_load()`, and `invalidate()`.
- TODO: Create equivalent helpers in each module (`ClientsData`, `BillingData`, `DisbursementData`, `TransmittalData`). If a module already has a partial cache (Disbursement `_items`, Billing `_detailCache`), wrap it with the same entity/generation guards.

### Frontend list render — refresh guard + filtered visible set

- File: `erp_prototype/js/workflow.js` (`renderList()`, lines ~1320–1434 and ~3732+)
- Pattern to copy:
  1. Use `WorkflowData.ensure()` and check `force` / `_loadGeneration`.
  2. Filter out archived/cancelled/trashed rows **before** rendering and before computing counts.
  3. Use the same predicate for the "no records" empty state and the "filters hiding records" hint.
- TODO: Apply to `renderList()` in `clients.js`, `billing.js`, `disbursement.js`, and `transmittal.js`.

### Frontend nav totals — counts from client-side cache

- File: `erp_prototype/js/workflow.js` (`renderTabNav()`, lines ~2972–3042)
- Pattern to copy: compute active, archive, and rejected counts synchronously from the same filtered local array used by the list/board.
- TODO: Replace API-driven `getClientCounts()`, `loadCounts()` badges, etc. with local-cache counts, or at minimum ensure the count fetch shares the same invalidation trigger as the list fetch.

### Entity switch — async `triggerSyncReload` with hash suppression

- Files: `erp_prototype/js/app.js`, `erp_prototype/js/utils.js`, `erp_prototype/js/auth.js`
- Pattern to copy:
  1. `Auth.switchEntity()` updates `Auth.activeEntity`, resets module view/detail IDs, and calls `triggerSyncReload()`.
  2. `triggerSyncReload()` invalidates `WorkflowData`, `clientCache`, `workRequestCache`, and `Dashboard` caches.
  3. Hash-change handler suppresses redundant events during the switch.
  4. Sidebar counts refresh in the background without blocking route rendering.
- TODO: Add `Billing.invalidateCache()`, `Disbursement.invalidateCache()`, and `Transmittal.invalidateCache()` calls inside `triggerSyncReload()`.

### Board-specific — local-only frontend fields

- Files: `erp_prototype/js/workflow.js` and `erp_prototype/js/kanban.js`
- Pattern to copy: board order/status are kept in frontend-only fields. On drag/drop, update the local record and emit one debounced `PUT` with only server-persisted fields. Never send the local field back to the server on every render.
- TODO: Audit Billing/Disbursement/Transmittal boards for any computed/local fields being serialized into `PUT` bodies.

---

## Per-Module TODO Table

| Module | Current State | Specific TODOs | Files to Modify | Verification Steps |
|---|---|---|---|---|
| **Clients** | Entity handling: **good** — no module list cache; `renderList()` and `getClientCounts()` fetch fresh each render. Nav totals: **accurate but expensive** — counts come from API on every `renderTabNav()`. Archive feedback: **slow** — `archiveClientDirectly()` / `bulkArchiveClientsDirectly()` call API, then `clientCache.invalidate()`, then `App.handleRoute()`; rows stay until re-render. Uses native `confirm()` instead of `Workflow.showConfirm`. | 1. Wrap client list in an entity-tagged cache with `invalidateCache()` and generation guard. 2. Compute active/archived tab counts from the same cached list. 3. Optimistically mark/remove the client in the cache before API, then re-render. 4. Replace native `confirm()`/`alert()` with `Workflow.showConfirm()` / `Workflow.showMessage()`. 5. Add `Clients.invalidateCache()` to `triggerSyncReload()`. | `erp_prototype/js/clients.js`  <br>`erp_prototype/js/utils.js` (`triggerSyncReload`) | 1. Switch ATA → LTA → ALL; confirm list and badges match active entity. 2. Archive a client; row should disappear immediately and active badge decrement. 3. Bulk archive 3 clients; all rows disappear at once. 4. Confirm native confirm no longer appears. |
| **Operations** | Entity handling: **good** — `WorkflowData` entity-tagged cache with generation guard. Nav totals: **good** — derived from local cache. Archive feedback: **good** — optimistic cache mutation before API. | None — this is the reference implementation. Use it as the source for the patterns above. | `erp_prototype/js/workflow.js` (reference) | 1. Confirm existing behavior still works after copying patterns. 2. Regression-test board drag/drop and archive/cancel. |
| **Billing** | Entity handling: **partial** — no list cache, so list re-fetches correctly; `_detailCache` is keyed by ID only and not entity-tagged, risking wrong-entity detail data. Nav totals: **partial** — `_counts` loaded fresh per `render()`, but not invalidated on archive/trash/delete/restore; badge may lag. Archive feedback: **slow** — `archiveInvoice()`, `trashInvoice()`, `permanentDeleteInvoice()`, and bulk actions call API then `App.handleRoute()`; rows remain visible during round-trip. | 1. Add `Billing.invalidateCache()` clearing `_detailCache` and `_counts`. 2. Entity-tag `_detailCache` entries or clear detail cache on entity switch. 3. Maintain a local invoice list cache so archive/trash/restore can splice immediately. 4. Decrement/increment `_counts` optimistically after mutation, then call `App.handleRoute()`. 5. Add `Billing.invalidateCache()` to `triggerSyncReload()`. 6. For detail delete, route away first, then show toast. | `erp_prototype/js/billing.js`  <br>`erp_prototype/js/utils.js` (`triggerSyncReload`) | 1. Switch entity on an invoice detail; confirm wrong-entity record is not shown. 2. Trash an invoice; row disappears immediately and active count decrements. 3. Restore from archive; row reappears and archive count decrements. 4. Delete from detail; user returns to list without seeing stale detail. |
| **Disbursement** | Entity handling: **bad** — `Disbursement._items` is a single global cache with no entity tag; `loadDisbursements()` returns cached `_items` regardless of `Auth.activeEntity`. Nav totals: **partial** — `_counts` from API `loadCounts()`; badge can disagree with stale `_items` list. Archive feedback: **bad** — `archiveDisbursement()`, `permanentDeleteDisbursement()`, and board/table delete call API then `App.handleRoute()` but **never call `invalidateCache()`**; archived/deleted cards stay visible. | 1. Add `_entity` + generation tracking to `_items` / `_counts` or switch to fresh server fetch. 2. Call `Disbursement.invalidateCache()` and `window.apiClient.disbursements.invalidateCounts()` after every archive/delete/unarchive/submit. 3. Add `Disbursement.invalidateCache()` to `triggerSyncReload()`. 4. Optimistically splice/remove from `_items` before API, re-render, and rollback on failure. 5. Invalidate `Dashboard._dataCache` from disbursement mutation handlers so calendar/sidebar events stay consistent. | `erp_prototype/js/disbursement.js`  <br>`erp_prototype/js/dashboard.js`  <br>`erp_prototype/js/utils.js` (`triggerSyncReload`) | 1. Switch ATA → LTA; confirm board/table shows only LTA disbursements. 2. Archive a board card; card disappears immediately and active badge updates. 3. Delete from table; row disappears and does not reappear after `App.handleRoute()`. 4. Confirm dashboard calendar no longer shows removed item. 5. Ensure no "badge N, board N+1" mismatch. |
| **Transmittal** | Entity handling: **good** — no persistent list cache; `_listForActiveEntity()` fetches fresh. Nav totals: **partial** — `_getCounts()` hits API each render but count cache is not invalidated on send/acknowledge/delete; badge may lag. Archive feedback: **non-functional** — `archiveTransmittal()`, `bulkArchiveTransmittals()`, and `unarchiveTransmittal()` are stubs showing "Not Supported"; `permanentDeleteTransmittal()` waits for API then re-renders. | 1. Decide whether backend supports transmittal archive. If yes, implement it and add optimistic local flag update + re-render. If no, hide/disable archive UI actions. 2. Add a lightweight entity-tagged `_items` cache with `invalidateCache()` so delete can be optimistic. 3. Invalidate count cache on send/acknowledge/delete. 4. Add `Transmittal.invalidateCache()` to `triggerSyncReload()`. 5. Invalidate `Dashboard._dataCache` on delete. | `erp_prototype/js/transmittal.js`  <br>`erp_prototype/js/dashboard.js`  <br>`erp_prototype/js/utils.js` (`triggerSyncReload`) | 1. Confirm send/acknowledge updates badge immediately. 2. Delete a transmittal; row disappears and badge decrements. 3. If archive is kept, test archive/unarchive end-to-end; otherwise confirm archive UI is hidden. |

---

## Cross-Cutting Implementation Plan

Order by risk/impact. Complete each phase before moving to the next.

### Phase 1 — Add entity-tagged caches to each module's data store

- Highest impact. Start with Disbursement (worst current state).
- Add `_entity`, `_loadingEntity`, `_loadGeneration`, `hasData()`, `ensure()`, `_load()`, and `invalidateCache()` helpers.
- Make caches return `null`/`force reload` when the stored entity does not match `Auth.activeEntity`.

### Phase 2 — Add `Vary: X-Active-Entity` to backend list endpoints

- Verify the header in `backend/src/app.js` cache-control middleware covers:
  - `GET /v1/clients`
  - `GET /v1/invoices`
  - `GET /v1/disbursements`
  - `GET /v1/transmittals`
  - `GET /v1/work-requests` (already done)
- Add targeted middleware if any endpoint is missing the header.

### Phase 3 — Unify nav total computation and immediate update after mutations

- Replace per-module API count calls with counts derived from the same filtered local array, where possible.
- Where counts must stay API-driven (e.g., large datasets), add explicit invalidation after every create/update/archive/restore/delete and use the same invalidation trigger for both list and counts.
- Update `App.updateSidebarNotifications()` after every mutation so global badges stay in sync.

### Phase 4 — Add optimistic removal + nav decrement for archive/cancel/delete

- Operations: already done; use as template.
- Clients: optimistic local cache mutation before API, rollback on error.
- Billing: optimistic splice + count update, route away before delete toast on detail view.
- Disbursement: optimistic splice + `_counts` update + `Dashboard._dataCache` invalidation.
- Transmittal: optimistic delete; implement or remove archive UI.

### Phase 5 — Smoke-test entity switch, nav totals, and archive feedback in every module

- Test matrix: each module × ATA / LTA / ALL × Active / Archive tabs × archive, restore, delete, cancel where applicable.
- Confirm no console errors and no mismatch between badge and rendered rows.

---

## Expected Metrics / User-Perceived Outcomes

These map back to `docs/PERFORMANCE_LOADING_SPEED_TODO.md`:

| Metric / Outcome | Before | After (Target) | Maps to Performance TODO |
|---|---|---|---|
| Entity switch re-fetch cost | Full list re-fetch on every switch, sometimes stale (Disbursement) | Warm entity-tagged cache where possible; only miss on first visit | Phase 3 (DB pagination + client caching) |
| Nav badge vs list mismatch | Common in Disbursement; possible in Billing/Transmittal | Badges always match visible rows | Phase 3 / Phase 5 |
| Archive/delete perceived latency | Round-trip wait + skeleton flash | Instant row removal, async API + rollback | Phase 4 / Phase 5 |
| API call volume | Counts fetched on every `renderTabNav()` | Counts computed from local cache after first load | Phase 3 |
| Detail view wrong-entity risk | Billing `_detailCache` not entity-tagged | Detail cache cleared/entity-tagged on switch | Phase 1 / Phase 3 |
| Dashboard/event consistency | Removed disbursements/operations linger in calendar | `Dashboard._dataCache` invalidated from mutation handlers | Phase 5 |

---

## Notes for the Next Agent

1. **Preserve the global-variable architecture** — modules expose themselves on `window.*` (`window.Clients`, `window.Billing`, `window.Disbursement`, `window.Transmittal`, `window.Workflow`, `window.WorkflowData`). Do not introduce ES modules, bundlers, or frameworks.
2. **Do not use Playwright** for this work. Verify by hand in the browser and with existing backend unit/integration tests (`cd backend && npm test`).
3. **No commits** unless explicitly asked. This checkpoint is intentionally uncommitted on `uat`.
4. **Dev server restart** after changing `erp_prototype/js/*.js` — the prototype dev server may cache JS in memory. Restart `node erp_prototype/dev-server.js` or the equivalent `npm run dev` command.
5. **Service Worker / cache busting** — `sw.js` was recently updated (bumped to `v2`). Hard-refresh the browser or unregister the SW if stale JS is served. Check the Network tab for `Vary: X-Active-Entity`.
6. **Backend test command** — `cd /home/javvii/FreelanceProject/Project4_Final-Render/backend && npm test`.
7. **Frontend local backend** — `cd /home/javvii/FreelanceProject/Project4_Final-Render/backend && PORT=3000 npm run dev` (or `node src/app.js`) and open the SPA at the dev-server port (commonly `8080`).
8. **Entity switch helper** — use `Auth.switchEntity('ATA' | 'LTA' | 'ALL')` in the console to exercise paths quickly.
9. **Rollback discipline** — whenever you mutate a local cache optimistically, wrap the API call in `try/catch` and revert the local change on failure, then show `Workflow.showMessage('Error', …)`.
10. **Keep the Operations file as the source of truth** — when in doubt, read `erp_prototype/js/workflow.js` and mirror the pattern exactly.
