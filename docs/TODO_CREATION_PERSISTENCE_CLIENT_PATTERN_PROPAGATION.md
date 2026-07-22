# Creation Persistence & Client-Pattern Propagation — Implementation Plan

**Date:** 2026-07-20  
**Branch:** `uat`  
**Status:** Analysis complete; implementation queued for next agents  
**Approach:** Dynamic workflow only. No Playwright. No commits.

---

## 1. Executive Summary

The **Clients** module already has a creation flow that is stable, persistent, and
self-consistent:

- New clients appear instantly in the list.
- They remain visible after switching tabs, views, or pages.
- They survive a hard refresh because they are persisted to the DB.
- Related pickers/dropdowns and downstream forms stay synchronized.

The **Operations**, **Billing**, and **Disbursement** modules have *immediate*
feedback after creation, but the newly created item disappears when the user
switches view modes (table ↔ board ↔ compact list), revisits the page, or
navigates away and back. The item is persisted in the database, but the list
rendering path falls back to paginated server fetches that do not reliably
include the new record immediately after creation.

This document extracts the Clients pattern, identifies the exact root causes in
the other modules, and gives a step-by-step implementation plan so subsequent
agents can make Operations, Billing, and Disbursement behave identically to
Clients.

---

## 2. Working Reference Pattern — Clients Module

### 2.1 Files

- `erp_prototype/js/clients.js` — module controller + UI rendering.
- `erp_prototype/js/app.js` — routing logic (unchanged for this fix).

### 2.2 Data layer

Clients uses a dedicated, entity-tagged cache object `ClientsData`:

```js
const ClientsData = {
  _clients: null,        // single source of truth for the list
  _loadingPromise: null,
  _loadingEntity: null,
  _loadGeneration: 0,
  _entity: null,

  hasData() { return Array.isArray(this._clients) && this._isEntityFresh(); },

  invalidate() {
    this._clients = null;
    this._loadingPromise = null;
    this._loadingEntity = null;
    this._loadGeneration++;
    this._entity = null;
  },

  async ensure() {
    if (this.hasData()) return;
    // ...fetch once per entity, discard stale in-flight loads
  },

  addClient(client) { this._clients.unshift(client); this._entity = activeEntity; },
  replaceClientById(tempId, client) { /* in-place swap */ },
  _removeFromCache(id) { /* rollback */ }
};
```

Key properties:

1. `_clients` is the **single source of truth** for `Clients.renderList()`.
2. `renderList()` never calls a paginated server endpoint directly; it calls
   `ClientsData.ensure()` and then reads `ClientsData.getAllClients()`.
3. The cache is entity-tagged: `_entity` must equal `Auth.activeEntity` for the
   cache to be considered fresh.
4. `invalidate()` clears everything only on entity switch, explicit refresh, or
   logout — not on every route change.
5. Optimistic insert → API call → in-place replacement keeps the same array
   reference, so any re-render sees the updated server UUID immediately.

### 2.3 Creation flow

In `Clients.submitForm()`:

1. Build the final record.
2. Generate a temp ID and create an optimistic client object.
3. `this._startOptimisticSkip()`.
4. `ClientsData.addClient(optimisticClient)`.
5. Close the form panel and route to `#clients`.
6. Fire the API create call.
7. On success: `ClientsData.replaceClientById(tempId, serverClient)`.
8. Update shared `clientCache` so pickers stay usable.
9. `App.handleRoute()` re-renders while still skipping the server fetch.
10. Clear the optimistic skip generation.

Because the list always renders from `_clients`, and the optimistic record is
already in `_clients`, the new item is visible instantly and stays visible across
subsequent `App.handleRoute()` calls until the cache is explicitly invalidated.

---

## 3. Root-Cause Analysis — Operations / Workflow

### 3.1 Symptom

- Work request creation succeeds.
- The new work request appears instantly in the active list/board/table view.
- Clicking it routes to the correct detail page (server UUID).
- Switching the Operations view mode (Table ↔ Board ↔ List) or revisiting the
  page removes the new item.
- A hard refresh or waiting several seconds may bring it back.

### 3.2 Root cause A — List rendering bypasses the in-memory cache

`erp_prototype/js/workflow.js` contains `WorkflowData`, which **does** maintain an
entity-tagged in-memory cache (`_workRequests`, `_tasks`, `_entity`). However,
`Workflow.renderList()` uses a server-paginated path for normal rendering:

```js
// workflow.js ~3995-4100
const shouldSkipServerFetch = Workflow._activeSkipGeneration > 0
  && Workflow._activeSkipGeneration === Workflow._skipFetchGeneration;

if (shouldSkipServerFetch) {
  // Renders from WorkflowData._workRequests — item is visible
  ...
} else {
  // Renders from WorkflowData.loadPage(serverParams) — item often missing
  const pageResult = await WorkflowData.loadPage(serverParams);
  let wrs = pageResult.workRequests;
  ...
}
```

The skip-generation guard is only active for the **first** render after creation.
When the user switches view modes, `App.handleRoute()` is called again,
`Workflow.render()` runs, and `Workflow.renderList()` re-enters the refresh loop
with the skip generation already cleared. The code then calls
`WorkflowData.loadPage({ page, limit, sortBy: 'dueDate', sortOrder: 'asc' })`.

This fresh server fetch ignores the in-memory cache and may exclude the new work
request because:

- It is sorted by `dueDate` ascending; a new work request with an empty or
  far-future due date can fall outside page 1.
- It is filtered by `Auth.canViewWrWithTasks`, which depends on tasks already
  being loaded; an edge case can hide the record until the related cache warms.
- Replication/indexing latency on Supabase means the row may not yet be visible
  to the paginated query even though the create API returned success.

### 3.3 Root cause B — The in-memory cache is not the source of truth

`WorkflowData.ensure()` is called at the top of `Workflow.render()`, but its result
is only used indirectly. The actual list content comes from `loadPage()`, not
from `WorkflowData.getAllWorkRequests()`. Therefore the optimistic record, which
is correctly inserted into `_workRequests`, is silently ignored on the next
render cycle.

### 3.4 Root cause C — Cache invalidation vs. background refresh is unbalanced

The module sets `WorkflowData._needsFreshFetch = true` after mutations and adds a
cache-busting `_t` parameter. This fixes browser/service-worker staleness, but it
does **not** fix the pagination problem: the fresh server response is still
paginated and may still miss the new record in the first page.

### 3.5 Existing related TODOs

- `docs/TODO_WORK_REQUEST_PERSISTENCE_AND_CACHE.md` — fixed browser/SW cache.
- `docs/TODO_WORK_REQUEST_CREATION_BUGS.md` — fixed duplicate saves and detail
  navigation loops.
- `docs/TODO_WORK_REQUEST_CREATION_FEEDBACK_FIX.md` — fixed optimistic record
  being wiped by `ensure()`.

This plan addresses the remaining gap: **make the list always render from the
in-memory cache and treat server fetches as background refreshes, like Clients.**

---

## 4. Root-Cause Analysis — Billing

### 4.1 Symptom

- New invoice appears immediately after creation.
- After switching billing views or revisiting the page, the invoice may disappear.

### 4.2 Root cause

`erp_prototype/js/billing.js` has `_listCache`, `_skipFetchGeneration`, and
`_activeSkipGeneration`, and `renderList()` already has a warm-cache branch:

```js
// billing.js ~1033
const shouldSkip = this._activeSkipGeneration > 0 && ...;
if (shouldSkip) {
  await refresh(this._listCache || []);
} else {
  if (cacheWarm) await refresh(this._listCache);
  await refresh();          // fetches from server
}
```

`refresh()` with no argument calls `this.fetchInvoices(serverQuery)`, which is a
paginated server fetch. After the skip generation clears, the next render will
execute `refresh()` (server fetch). The new invoice can be missing if:

- It falls outside the first page because `sortBy: 'createdAt'` descending
  includes other recent rows.
- A pending-approval invoice staged via `PendingChanges` is not yet approved.
- The warm-cache path is short-circuited because `cacheWarm` is false or because
  the server fetch overwrites the cache before the warm render completes.

The optimistic record is correctly added to `_listCache`, but the list rendering
still gives priority to the paginated server response.

---

## 5. Root-Cause Analysis — Disbursement

### 5.1 Symptom

- New disbursement appears immediately.
- After switching views or revisiting, it may disappear.

### 5.2 Root cause

`erp_prototype/js/disbursement.js` maintains `_items` (entity-tagged) and also
uses skip generations. The list rendering likely falls back to a server fetch
when the skip generation is inactive, similar to Billing. The optimistic record
is inserted into `_items`, but a subsequent paginated server fetch can overwrite
or ignore it.

---

## 6. Target Architecture (Extracted from Clients)

Make Operations, Billing, and Disbursement match the Clients pattern:

| Concern | Clients (working) | Operations/Billing/Disbursement (broken) | Target |
|---|---|---|---|
| Source of truth for list | `ClientsData._clients` | `WorkflowData._workRequests` / `Billing._listCache` / `Disbursement._items` exist but are **not** used as source of truth | Always render from the in-memory cache |
| List render path | `renderList()` → `ensure()` → `_clients` | `renderList()` → `loadPage()` / `fetchInvoices()` paginated fetch | `renderList()` → `ensure()` → cache |
| Server fetch role | Populate cache when empty/stale | Directly drive list content | Background refresh only |
| Filter/search | Client-side on full cache | Mixed client/server | Client-side on full cache |
| Pagination | Client-side on full cache | Server-side | Client-side on full cache |
| Optimistic insert | `addClient()` | `_addOptimisticWorkRequest()` / `_addToListCache()` / `_addOptimisticDisbursement()` | Keep, but ensure list reads from cache |
| Optimistic replace | `replaceClientById()` | `_adoptServerWorkRequest()` / `_replaceInListCache()` / `_replaceOptimisticCreate()` | Keep, but ensure list reads from cache |
| Entity freshness | `_entity` tag | Present but not decisive for list | `_entity` tag must gate all cache use |
| Explicit refresh | `invalidateCache()` → refetch | Already exists | Keep |
| Background refresh | Not needed (cache stays warm) | Needed because cache is bypassed | Background refresh should merge, not replace |

---

## 7. Implementation Plan

### Phase 1 — Operations / Workflow

#### 1.1 Make `WorkflowData` the single source of truth for `Workflow.renderList()`

- [ ] Refactor `Workflow.renderList()` so the primary data source is
  `WorkflowData.getAllWorkRequests()` after `WorkflowData.ensure()`.
- [ ] Remove the unconditional `WorkflowData.loadPage()` call from the active list
  rendering path.
- [ ] Keep `WorkflowData.loadPage()` as a private helper, but only call it during
  explicit refresh or when the cache is empty/stale.
- [ ] Apply existing client-side filters (`activeFilters`, `searchQuery`,
  `groupBy`) to the cached `wrs` array instead of to a paginated server result.
- [ ] Implement client-side pagination over the filtered cached array.

#### 1.2 Harden the optimistic lifecycle

- [ ] Verify that `_addOptimisticWorkRequest()` already sets `this._entity =
  this._getActiveEntity()` (it does; do not regress).
- [ ] Verify that `_adoptServerWorkRequest()` and `createWorkRequest()` already
  set `this._entity` and `this._needsFreshFetch = true` (they do; do not
  regress).
- [ ] Ensure `WorkflowData.invalidate()` clears `_workRequests`, `_tasks`,
  `_entity`, and skip generations only on:
  - entity switch,
  - explicit refresh button click,
  - logout / auth reset,
  - successful delete/archive that removes the record from the DB.

#### 1.3 Add a safe background refresh

- [ ] After the optimistic skip generation is cleared, do **not** immediately
  replace `_workRequests` with a paginated fetch.
- [ ] Instead, trigger a background `WorkflowData.load()` (full fetch, not
  paginated) that merges server records into `_workRequests` by ID, preserving
  optimistic records that are not yet confirmed.
- [ ] If the background fetch fails or is aborted, keep the current cache and log
  a warning.

#### 1.4 Synchronize downstream forms

- [ ] When a work request is created, ensure `window.apiClient.workRequestCache`
  is updated (or invalidated) so that client/work-request pickers in Billing and
  Disbursement forms see the new work request.
- [ ] Ensure `Dashboard.invalidateCache()` (or `_dataCache = null`) is called so
  dashboard counts/cards refresh.
- [ ] Verify that the `linkedInvoiceId` / `linkedDisbursementIds` fields on the
  parent work request are updated when invoices/disbursements are created from
  it.

#### 1.5 Verify board, table, and compact list views

- [ ] Ensure `refreshTable()`, `refreshBoard()`, and `refreshListCompact()` all
  receive the same merged cached array.
- [ ] Confirm that switching view modes (Table ↔ Board ↔ List) no longer makes
  the new item disappear.

### Phase 2 — Billing

#### 2.1 Make `_listCache` the single source of truth

- [ ] Refactor `Billing.renderList()` so the primary data source is
  `Billing._listCache` after it is ensured.
- [ ] Remove the unconditional server fetch in the `refresh()` function; call
  `Billing.fetchInvoices()` only when `_listCache` is empty/stale or on explicit
  refresh.
- [ ] Apply client-side filters and pagination to `_listCache`.

#### 2.2 Harden optimistic lifecycle

- [ ] Verify `_addToListCache()`, `_replaceInListCache()`, and
  `_removeFromListCache()` are correct (they are; preserve).
- [ ] Ensure `_detailCache[optimisticId]` and `_listCache` stay in sync.
- [ ] Ensure `_beginSkipGeneration()` / `_endSkipGeneration()` are not cleared
  too early; the warm cache should be honored for at least one full route cycle
  after creation.

#### 2.3 Background refresh and cascading sync

- [ ] Add a background full fetch that merges server invoices into `_listCache`
  by ID.
- [ ] Update linked work-request `linkedInvoiceIds` in
  `window.apiClient.workRequestCache` (already partially done in
  `_invalidateRelatedCaches`; verify it runs for the new record).
- [ ] Invalidate dashboard cache on creation.

### Phase 3 — Disbursement

#### 3.1 Make `_items` the single source of truth

- [ ] Refactor `Disbursement.renderList()` to render from `_items` after
  `ensure()`.
- [ ] Add an `ensure()`-style loader if not already present, or ensure the
  existing one is used as the source of truth.
- [ ] Remove unconditional server fetches from the normal list render path.

#### 3.2 Harden optimistic lifecycle

- [ ] Verify `_addOptimisticDisbursement()`, `_replaceOptimisticCreate()`, and
  `_rollbackOptimisticCreate()` keep `_items` consistent.
- [ ] Ensure `_entity` is set on `_items` when the cache is initialized from an
  optimistic record.

#### 3.3 Background refresh and cascading sync

- [ ] Add a background full fetch that merges server disbursements into `_items`
  by ID.
- [ ] Update linked work-request `linkedDisbursementIds` in
  `window.apiClient.workRequestCache`.
- [ ] Invalidate dashboard cache on creation.

### Phase 4 — Shared utilities and cross-module consistency

#### 4.1 Abstract the pattern (optional but recommended)

- [ ] Consider adding a small helper module (e.g.
  `erp_prototype/js/entityCache.js`) that implements:
  - `ensure()`, `invalidate()`, `add()`, `replaceByTempId()`, `remove()`
  - entity-tagging and generation guards
- [ ] Refactor `ClientsData`, `WorkflowData`, `Billing`, and `Disbursement` to
  use the helper if time permits. If not, copy the proven logic carefully.

#### 4.2 Form picker synchronization

- [ ] Audit every form that selects a work request, client, or invoice
  (Billing form, Disbursement form, Operations form client selector, etc.).
- [ ] Ensure that after creation, the corresponding shared cache
  (`clientCache`, `workRequestCache`) is updated so the new record appears in
  dropdowns without a manual refresh.

#### 4.3 Route-level guards

- [ ] Ensure `App.handleRoute()` does not accidentally reset module view state
  in a way that drops the optimistic record. (The current routing for
  `#operations`, `#billing`, `#disbursement` resets to list view but preserves
  module object state; this should be sufficient once the list renders from
  cache.)

### Phase 5 — Verification

#### 5.1 Manual end-to-end checks

For **Operations**, **Billing**, and **Disbursement**:

1. Create a new record.
2. Confirm it appears instantly in the list/table/board view.
3. Click it and confirm routing to the detail page works.
4. Switch view modes (table/board/list) and confirm the item remains.
5. Navigate to another module and back; confirm the item remains.
6. Refresh the browser; confirm the item remains.
7. Open a related form (e.g., create invoice from work request) and confirm the
   new parent record is selectable.

#### 5.2 Automated / static checks

- [ ] Run `node --check` on every modified frontend file.
- [ ] Run backend tests for affected modules:
  - `cd backend && PORT=0 npx jest tests/integration/operations.test.js --runInBand`
  - `cd backend && PORT=0 npx jest tests/integration/disbursements.test.js --runInBand`
  - Any billing integration tests.
- [ ] Run the full backend test suite if any shared service was changed.

#### 5.3 Edge cases

- [ ] Create a record while offline or with a slow network; confirm optimistic
  record remains visible and is either replaced on success or rolled back on
  failure.
- [ ] Create a record under `ALL` consolidated entity view; confirm it appears
  and remains visible when switching to the single entity that owns it.
- [ ] Create a record with null/empty optional fields (e.g., work request with no
  due date) and confirm it still appears after view switches.

---

## 8. Files to Modify

| File | Why |
|---|---|
| `erp_prototype/js/workflow.js` | Make `Workflow.renderList()` read from `WorkflowData._workRequests`; add background refresh; keep optimistic lifecycle intact. |
| `erp_prototype/js/billing.js` | Make `Billing.renderList()` read from `_listCache`; add background refresh. |
| `erp_prototype/js/disbursement.js` | Make `Disbursement.renderList()` read from `_items`; add background refresh. |
| `erp_prototype/js/clients.js` | Reference only; verify the pattern is preserved. |
| `erp_prototype/js/app.js` | Reference only unless routing changes are needed. |

---

## 9. Notes for Next Agents

1. **Do not introduce new dependencies or frameworks.** Stay within the existing
   global-variable SPA architecture (`window.WorkflowData`, `window.Billing`,
   `window.Disbursement`, `window.ClientsData`).
2. **Do not use Playwright** for this task unless explicitly requested. Rely on
   `node --check`, backend tests, and manual browser verification.
3. **Do not commit yet.** The `uat` branch already contains many uncommitted
   changes; coordinate with the team before committing.
4. **Preserve the existing `_needsFreshFetch` cache-busting** in `WorkflowData`;
   it is still valuable for browser/service-worker staleness. This plan adds the
   missing in-memory-cache layer on top of it.
5. **Start with Operations.** It is the most complex and the one the user
   reported. Once it matches Clients, propagate the same changes to Billing and
   Disbursement.
6. **Be careful with `loadPage()` and `fetchInvoices()`.** They may still be used
   by archive/history views or by the dashboard. Do not delete them; just make
   the active list view no longer depend on them.
7. **Preserve server-side pagination for very large datasets if needed.** If the
   product later requires true server pagination, implement it as an opt-in
   fallback, not as the default path for the active list.

---

## 10. Definition of Done

- [ ] Operations work-request creation behaves exactly like client creation:
  instant feedback, persistent across view switches and page revisits, correct
  detail routing, DB persistence.
- [ ] Billing invoice creation behaves the same way.
- [ ] Disbursement expense creation behaves the same way.
- [ ] Newly created records appear immediately in related form pickers/dropdowns.
- [ ] No regressions in edit, archive, approve, or template flows.
- [ ] All modified files pass `node --check`.
- [ ] Backend tests for operations and disbursements pass.
- [ ] Manual browser verification confirms the checklist in §5.1.
