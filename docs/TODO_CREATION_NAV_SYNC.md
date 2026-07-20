# TODO: Cascade Instant Archive Reflection + Nav Total Sync to All Creation Forms

**Date:** 2026-07-20  
**Branch:** `uat`  
**Scope:** Extend the Operations-style optimistic cache + instant nav-sync pattern to *every* creation and template-generation flow in the ERP SPA.  
**Status:** List/archive mutations already fixed; creation/template flows still need the same treatment.  
**Constraints:**
- Use the dynamic workflow / subagent-driven implementation model.
- No commits unless explicitly requested.
- No Playwright plugin runs; verify by hand and with `cd backend && npm test`.
- Preserve the global-variable architecture (`window.Clients`, `window.Workflow`, `window.Billing`, `window.Disbursement`, `window.Transmittal`, `window.Users`).

---

## 1. Background / Reference Patterns

The previous checkpoint (`docs/CHECKPOINT_ENTITY_NAV_ARCHIVE.md`) implemented:

1. **Entity-tagged module caches** with `_entity`, `_loadingEntity`, `_loadGeneration`, `hasData()`, `ensure()`, `_load()`, `invalidateCache()`.
2. **Nav totals derived from the local cache** instead of per-render `/counts` API calls.
3. **Optimistic mutation → re-render from cache → async API → rollback** for archive, cancel, delete, send, acknowledge.
4. **`_skipNextListFetch` flag** in `workflow.js`, `billing.js`, `disbursement.js`, `transmittal.js`, and `clients.js` so the next list render after a mutation is drawn from the warm cache and does not immediately hit the server and redraw the old state.

Use those files as the source of truth.  The goal of *this* document is to apply the same discipline to **create and template-generate** flows.

### What “cascade” means here

For every creation endpoint listed below, after a successful create/generate:

1. The new record must appear in the module’s local cache **immediately**.
2. The active nav badge must increment (or update) **synchronously**.
3. `App.handleRoute()` must render from the warm cache without a stale server fetch.
4. On API failure, the local cache mutation must be rolled back and a `Workflow.showMessage('Error', …)` shown.
5. Related caches that surface the new item (Dashboard, clientCache, workRequestCache, userCache) must be invalidated/updated as appropriate.

---

## 2. Creation / Template Flows to Fix

| # | Flow | Module / File | Mutation Handler(s) | What the new record affects |
|---|---|---|---|---|
| 2.1 | **Client creation** | `Clients` / `erp_prototype/js/clients.js` | `submitForm()` → `window.apiClient.clients.create(record)` | Clients active list + active badge. |
| 2.2 | **Work Request creation** | `Workflow` / `erp_prototype/js/workflow.js` | `submitForm()` → `WorkflowData.createWorkRequest(record)` (when `result.approved`) | Operations active list + active badge; Dashboard tasks. |
| 2.3 | **Work Request task creation** | `Workflow` / `erp_prototype/js/workflow.js` | `WorkflowData.createTask()` called from `submitForm()` (new WR) and add-task form (`renderAddTaskForm` / `showAddTaskPanel`) | Parent WR detail task count + Operations board/list task columns + Dashboard tasks. |
| 2.4 | **Billing invoice creation** | `Billing` / `erp_prototype/js/billing.js` | `submitForm()` → `window.apiClient.invoices.create(apiPayload)` | Billing active list + Invoices badge. |
| 2.5 | **Billing template creation** | `Billing` / `erp_prototype/js/billing.js` | `renderTemplateForm()` submit handler → `window.apiClient.invoices.createTemplate(payload)` | Templates tab badge + templates list. |
| 2.6 | **Billing generate-from-template** | `Billing` / `erp_prototype/js/billing.js` | `generateFromTemplate(t)` | Active invoice list + Invoices badge. |
| 2.7 | **Billing bulk-generate-from-templates** | `Billing` / `erp_prototype/js/billing.js` | `bulkGenerateFromTemplates(templateIds)` | Active invoice list + Invoices badge. |
| 2.8 | **Disbursement expense creation** | `Disbursement` / `erp_prototype/js/disbursement.js` | `submitForm()` → `window.apiClient.disbursements.create(payload)` | Disbursement active list + Disbursements badge + Dashboard. |
| 2.9 | **Disbursement template creation** | `Disbursement` / `erp_prototype/js/disbursement.js` | `renderTemplateForm()` submit handler → `window.apiClient.disbursements.createTemplate(payload)` | Templates tab badge + templates list. |
| 2.10 | **Disbursement generate-from-template** | `Disbursement` / `erp_prototype/js/disbursement.js` | `generateFromTemplate(template)` | Active disbursement list + Disbursements badge + Dashboard. |
| 2.11 | **Transmittal creation** | `Transmittal` / `erp_prototype/js/transmittal.js` | `submitForm()` → `window.apiClient.transmittals.create(payload)` | Transmittal active list + Transmittals badge + Dashboard. |
| 2.12 | **User creation** | `Users` / `erp_prototype/js/users.js` | `submitUserForm()` → `window.apiClient.admin.createUser(record)` | Users list + Admin > Users count (if any) + `window.apiClient.userCache`. |
| 2.13 | **Operations retainer template creation** | `Workflow` / `erp_prototype/js/workflow.js` | `_addRetainerTemplate()` → `window.apiClient.operations.createTemplate(record)` (and template form handler around line 11132) | Templates tab badge + templates list. |
| 2.14 | **Operations generate-from-template / bulk generate** | `Workflow` / `erp_prototype/js/workflow.js` | `generateFromTemplate()`, `bulkGenerateFromTemplates()` | Operations active list + Work Requests badge + Dashboard. |

---

## 3. Reusable Implementation Recipe

For each flow above, apply the following recipe exactly.

### 3.1 Before the API call — optimistic local cache update

1. Build a fully normalized local record with a stable temporary ID if the backend has not returned one yet.
2. Insert/update it in the module’s local cache:
   - For list caches: `unshift` new records to the front (or append at the end if that matches server sort order).
   - For detail caches: store by ID.
   - For template caches: push to `_templates`.
   - For user cache: update `window.apiClient.userCache` via its public API if available, otherwise invalidate it.
3. Update the module’s count object or recalc counts so `renderTabNav()` reads the new value.
4. Set `Module._skipNextListFetch = true` so the next `App.handleRoute()` renders from cache.
5. Call `App.handleRoute()` **before** the API call.

### 3.2 API call with rollback

Wrap the create API call in `try/catch`:

```js
let serverRecord = null;
try {
  const res = await window.apiClient.<module>.create(payload);
  serverRecord = this.normalize<Record>(res.data);
  // Replace the optimistic record by id with the server-approved one.
  this._replaceInCache(localId, serverRecord);
  Workflow.showMessage('Created', '<Record> created successfully.', 'success');
} catch (e) {
  console.error('Failed to create <record>', e);
  // Rollback local cache.
  this._removeFromCache(localId);
  this._recalcCounts();
  this._skipNextListFetch = true;
  App.handleRoute();
  Workflow.showMessage('Error', e.message || 'Unable to create <record>.', 'error');
  return;
}
```

### 3.3 Cross-cache invalidation

After a successful create:

- **Clients** created → invalidate `window.apiClient.clientCache` and `Dashboard._dataCache` (client picker/dashboard widgets).
- **Work Requests** created → already handled by `WorkflowData`; ensure `Dashboard._dataCache` is invalidated.
- **Work Request tasks** created → parent WR is already in `WorkflowData`; ensure `Dashboard._dataCache` is invalidated.
- **Invoices** created → invalidate `window.apiClient.workRequestCache` if the WR links the invoice; invalidate `Dashboard._dataCache`.
- **Disbursements** created → invalidate `Dashboard._dataCache`; if linked to a work request, also invalidate `WorkflowData` so the WR financial badge updates.
- **Transmittals** created → invalidate `Dashboard._dataCache`; if linked to a WR, invalidate `WorkflowData`.
- **Users** created → invalidate `window.apiClient.userCache` and `Users.users`; refresh sidebar/pending counts.
- **Templates** created → no cross-cache invalidation needed unless templates feed into other modules.

### 3.4 Route navigation

- If the form was submitted from a full-page or side-peek route, use `closeFormPanelAndRoute('#<module>', msgConfig)`.
- If the form stays on the same page, just `App.handleRoute()`.
- Ensure `_skipNextListFetch` is set **before** either call.

---

## 4. Per-File Implementation Notes

### 4.1 `erp_prototype/js/clients.js`

- `ClientsData` already has `addClient(client)` / `updateClient()` helpers (added in prior checkpoint).  
- In `submitForm()`:
  - After validation, build the normalized client record with `status: 'Active'`.
  - Call `ClientsData.addClient(optimisticClient)` and `Clients._skipNextListFetch = true`, then `App.handleRoute()`.
  - Fire `window.apiClient.clients.create(apiRecord)`.
  - On success, replace the optimistic record with the server response via `ClientsData.updateClient(serverClient.id, serverClient)`.
  - On failure, rollback via `ClientsData.deleteClient(optimisticId)` and re-render.
- Invalidate `window.apiClient.clientCache` after success so client pickers elsewhere are fresh.

### 4.2 `erp_prototype/js/workflow.js`

#### Work Request creation (`submitForm`)
- When `result.approved` and `isNew`, the code already calls `WorkflowData.createWorkRequest(record)` **after** the API.  Move the local cache insertion to **before** the API:
  1. `WorkflowData._workRequests.push(normalizedRecord)` with `status: 'Draft'`, `archived: false`, generated id.
  2. Set `Workflow._skipNextListFetch = true` and call `App.handleRoute()`.
  3. Then call the API.
  4. On success, replace by id with server response.
  5. On failure, remove from `_workRequests` and re-render.
- If `result.approved` is false (pending approval), do not add to the active cache; rely on `PendingChanges`.

#### Task creation paths
- `WorkflowData.createTask()` already pushes to `_tasks`.  Ensure callers set `Workflow._skipNextListFetch = true` before `App.handleRoute()`:
  - New WR flow in `submitForm()` (lines ~6375–6386).
  - Add-task panel (`renderAddTaskForm` / `showAddTaskPanel`).
- For the add-task panel, also update the parent WR in `WorkflowData._workRequests` so the task count/badge in the WR detail/board updates.

#### Retainer template creation (`_addRetainerTemplate` / template form handler)
- `_retainerTemplates` already gets pushed after API.  Add an optimistic push before the API and set `Workflow._skipNextListFetch = true` + `App.handleRoute()`.
- On failure, splice out the optimistic template and show error.

#### Generate / bulk-generate from retainer templates
- `generateFromTemplate()` and `bulkGenerateFromTemplates()` already call `WorkflowData.createWorkRequest()`.
- Add `Workflow._skipNextListFetch = true` **before** the loop starts and re-render after each WR is added to cache, or render once after the loop.
- For bulk generate, if any individual create fails, continue the loop but roll back that specific optimistic WR and show a summary error at the end.

### 4.3 `erp_prototype/js/billing.js`

- `_addToListCache(inv)` helper already exists but currently only accepts active invoices.  Confirm it now accepts all entity-matching invoices (see prior checkpoint change).
- In `submitForm()`:
  - After validation, build normalized invoice with `status: 'Draft'`.
  - If `isNew`, call `_addToListCache(optimisticInv)`, `_updateCounts(1, 0)`, `this._skipNextListFetch = true`, then `App.handleRoute()`.
  - Fire API.
  - On success replace by id; on failure remove from cache, rollback counts, re-render.
- In template create/update handler:
  - Optimistically push/update `_templates` and set `_skipNextListFetch = true` if routing to `#billing` (templates tab).
- In `generateFromTemplate(t)` and `bulkGenerateFromTemplates(ids)`:
  - Already partially implemented in `generateFromTemplate`.  Extend to bulk generate: optimistic add each generated invoice, update counts, set `_skipNextListFetch = true`, `App.handleRoute()`, then fire API calls.
  - On any failure, remove the optimistic invoice(s) created in the loop and continue/rollback based on user expectation (best UX: continue loop, report per-item errors in a single summary toast).

### 4.4 `erp_prototype/js/disbursement.js`

- `submitForm()` already inserts into `_items` after API.  Move insertion before API:
  1. Build normalized disbursement with `status: 'Draft'` (or appropriate initial status).
  2. `this._items.unshift(record)` + `_refreshCounts()` + `_invalidateDashboardCache()` + `_skipNextListFetch = true` + `App.handleRoute()`.
  3. Fire API.
  4. Replace by id on success; on failure remove and rollback.
- Template creation handler: optimistic push to `_templates`, set `_skipNextListFetch = true` if routing to templates tab.
- `generateFromTemplate(template)`:
  - Currently only calls API.  Add optimistic record to `_items`, update counts/dashboard, set `_skipNextListFetch = true`, `App.handleRoute()`, then API.
  - Rollback on failure.

### 4.5 `erp_prototype/js/transmittal.js`

- `submitForm()` already updates `_items` after API.  Move/add optimistic insert before API:
  1. Build normalized transmittal with `status: 'Draft'`.
  2. `this._items = [optimisticT, ...this._items]` + `_skipNextListFetch = true` + `App.handleRoute()`.
  3. Fire API.
  4. Replace by id on success; on failure remove and rollback.
- Invalidate `Dashboard._dataCache` on success.

### 4.6 `erp_prototype/js/users.js`

- `renderUserList()` currently calls `await this.loadUsers()` every render.  Add a user-list cache (`Users._usersCache`, `_usersCacheEntity`, `_skipNextListFetch`) OR simply keep `this.users` as the cache and avoid the server fetch when `_skipNextListFetch` is true.
- In `submitUserForm()`:
  - After validation, build normalized user record.
  - If creating, `this.users.unshift(optimisticUser)` and set `Users._skipNextListFetch = true`, then `App.handleRoute()`.
  - Fire API.
  - On success, replace by id and invalidate `window.apiClient.userCache`.
  - On failure, remove optimistic user, re-render, show `Workflow.showMessage('Error', …)`.
- Bulk disable/delete actions already call `App.handleRoute()`; add optimistic removal with rollback and `_skipNextListFetch = true`.
- Replace the remaining `alert()` calls in bulk disable/delete with `Workflow.showMessage`.

---

## 5. Backend Considerations

- Ensure each create endpoint returns the full created record (with `id`, timestamps, and normalized fields) so the frontend can replace the optimistic record accurately.
- Verify `Vary: X-Active-Entity` remains on all list GETs (already covered globally in `backend/src/app.js` and targeted for `/v1/reports`).
- No backend changes are expected for this checkpoint unless a create endpoint is missing fields needed for optimistic rendering.

---

## 6. Cross-Cutting Changes

### 6.1 `triggerSyncReload()` in `erp_prototype/js/utils.js`

Already updated in the prior checkpoint to invalidate `Clients`, `Billing`, `Disbursement`, `Transmittal`, `Dashboard`, `WorkflowData`, `clientCache`, `workRequestCache`, and `userCache`.  Add `Users.invalidateCache()` if/when it exists after this work.

### 6.2 `App.handleRoute()` in `erp_prototype/js/app.js`

Already uses `module.hasCachedData(entity)` generically.  Ensure `Users` exposes `hasCachedData(entity)` if a cache is introduced.

### 6.3 Shared helper suggestion (optional)

Consider adding a tiny helper in `utils.js`:

```js
function withOptimisticRender(moduleName, mutateCache, apiCall, rollback, options = {}) {
  // mutateCache: () => void
  // apiCall: async () => serverRecord
  // rollback: () => void
  // options.module: object with _skipNextListFetch
}
```

But only if it does not complicate the existing module-specific flows.  Prefer keeping the pattern inline and explicit so future agents can read it directly.

---

## 7. Implementation Order (Risk / Impact)

1. **Operations (workflow.js)** — Work Request creation, task creation, retainer template creation, generate/bulk-generate.  
   *Why first:* Operations is the reference module; if this breaks, every other module loses its example.
2. **Clients (clients.js)** — Client creation.  
   *Why second:* Small surface area, high visibility, tests the `ClientsData` cache helpers added earlier.
3. **Billing (billing.js)** — Invoice creation, template creation, generate/bulk-generate.  
   *Why third:* Most complex list cache; verify the all-invoice `_listCache` design holds for creates.
4. **Disbursement (disbursement.js)** — Expense creation, template creation, generate.  
   *Why fourth:* Similar to Billing but with Dashboard linkage.
5. **Transmittal (transmittal.js)** — Transmittal creation.  
   *Why fifth:* Lightweight; no archive support on backend.
6. **Users (users.js)** — User creation + bulk disable/delete optimistic handling.  
   *Why last:* Separate module, separate cache shape, lowest risk to core workflow.

---

## 8. Verification Checklist

For every flow in section 2:

- [ ] Create from a full-page route; confirm the item appears immediately in the list/board and the nav badge increments.
- [ ] Create from a side-peek panel; confirm the underlying list updates without closing the panel unexpectedly.
- [ ] Generate from a template; confirm the generated record appears immediately.
- [ ] Bulk generate from templates; confirm all generated records appear immediately (or per-item errors are surfaced).
- [ ] Simulate API failure (block endpoint in DevTools / offline); confirm the optimistic item disappears, counts roll back, and `Workflow.showMessage('Error', …)` is shown.
- [ ] Confirm the next manual refresh or entity switch fetches fresh data and the optimistic item is replaced by the server record (timestamps/ID match).
- [ ] Confirm `Dashboard._dataCache` is invalidated for flows that affect dashboard widgets (operations, disbursement, transmittal, clients).
- [ ] Run `cd backend && npm test` — all suites should pass.
- [ ] Run `node --check` on every modified frontend file.

---

## 9. Notes for the Next Agent

1. **Preserve the global-variable architecture** — no ES modules, no bundlers.
2. **Do not use Playwright** for this work.  Verify by hand and with backend tests.
3. **No commits** unless explicitly asked.  This remains uncommitted on `uat`.
4. **Dev server restart** after changing `erp_prototype/js/*.js`.
5. **Service Worker / cache busting** — hard-refresh or unregister `sw.js` if stale JS is served.
6. **Backend test command** — `cd /home/javvii/FreelanceProject/Project4_Final-Render/backend && npm test`.
7. **Entity switch helper** — use `Auth.switchEntity('ATA' | 'LTA' | 'ALL')` in the console.
8. **Rollback discipline** — every optimistic mutation needs a matching rollback path.
9. **Count discipline** — never call a `/counts` endpoint from `renderTabNav()`; derive counts from the local cache.
10. **Keep the prior checkpoints as the source of truth** — when in doubt, mirror `workflow.js`, `billing.js`, `disbursement.js`, `transmittal.js`, and `clients.js` exactly.
