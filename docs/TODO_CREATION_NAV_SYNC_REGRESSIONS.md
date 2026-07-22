# TODO: Fix Creation Nav-Sync Regressions

**Date:** 2026-07-20  
**Branch:** `uat`  
**Status:** First cascade implemented; remaining regressions need fixes before this work is usable.  
**No commits.** No Playwright. Verify with `node --check` and `cd backend && npm test`.

---

## 1. Background

The first implementation of `docs/TODO_CREATION_NAV_SYNC.md` applied optimistic cache + immediate nav-sync to creation/template flows. It fixed syntax and backend tests, but live usage shows several regressions:

- Created items **appear briefly, then disappear** when the success modal closes.
- **Temp-id records are sent to the backend** in follow-up requests, causing `404 Not Found`.
- **Work request creation** still errors and duplicates.
- **Admin user creation** is reported blocked.
- **Billing / disbursement board/table** re-normalization mutates optimistic records and fires server updates for temp ids.

This TODO isolates each failure and gives a per-module recipe.

---

## 2. Root Causes

### 2.1 Optimistic records leak into backend-bound renderers

`Billing.refreshBoard` re-normalizes `boardOrder` for **every** invoice in the visible set and calls `window.apiClient.invoices.update(inv.id, { boardOrder })`. If `inv.id` is a temp id, the PUT 404s. The catch handler only logs, but the failed network round-trip plus the local mutation of `inv.boardOrder` can corrupt the optimistic record before the real server response replaces it.

Same risk exists in **Disbursement** if it ever adds board-order normalization.

### 2.2 Related-data loaders fetch for temp work-request ids

`WorkflowData.getRelatedForWorkRequest(id)` / `loadRelatedForWorkRequest(id)` do not check whether `id` is a client-generated temp id. As soon as the Operations board renders the optimistic WR, `renderCardMenuItems` calls `getPhaseTransitionStatus(wr.id)`, which calls `getRelatedForWorkRequest(tempId)`, which fires `GET /v1/work-requests/{tempId}/related` → 404.

### 2.3 Work-request creation sequence races the server replacement

`Workflow.submitForm` calls `App.handleRoute()` before the API. The board render sees the optimistic WR. Then the API runs. `WorkflowData.createWorkRequest` is supposed to replace the temp WR, but:
- If the server returns a different id, the temp record may not be found/replaced.
- `App.handleRoute()` is also called inside `createWorkRequest` success path by `_addRetainerTemplate` / other hooks, causing multiple renders.
- Tasks are added optimistically with temp ids, then `createTask` is called. If the first `App.handleRoute()` re-renders before the WR is replaced, the board shows the optimistic WR with temp-id tasks and triggers related-data fetches.

### 2.4 Billing list cache is not robust for optimistic inserts

`_addToListCache` was patched to initialize an empty cache, but the surrounding `refresh` path in `renderList` still calls `fetchInvoices` after a warm render when `_skipNextListFetch` is true. The warm render should be the **only** render for that cycle; otherwise the subsequent server fetch can overwrite the optimistic record before the API response arrives.

### 2.5 `_skipNextListFetch` is consumed too early

Several modules set `_skipNextListFetch = true`, route, render from cache once, then immediately set `_skipNextListFetch = false`. If `App.handleRoute()` is called again before the API response arrives (e.g., by a toast, modal, or sidebar count update), the second render re-fetches and wipes the optimistic record.

### 2.6 Admin user creation blocked

The `Users.submitUserForm` creation path has two issues:
- The `try/catch` around the whole form wraps the API call; if the outer `catch` fires it shows a generic message, but the inner creation path is inside another `try`.
- Admin user creation may be rejected by the backend if required fields are missing or the role mapping is wrong. The optimistic user object must match the backend's expected shape.
- The user list render path uses `this.users` directly; if the optimistic insert happens while `renderUserList` is already rendering, the list may not reflect it until a refetch.

### 2.7 Form dropdown caches may still be cold

While `renderForm` in billing/disbursement/transmittal now `ensure()`s caches, request modals (`showRequestInvoiceModal`, `showRequestDisbursementModal`, `showRequestTransmittalModal`) and inline selects still read `._clients` / `._wrs` / `._users` synchronously. If those caches are empty (e.g., after an earlier invalidation or a cold route), dropdowns are empty.

---

## 3. Reusable Fix Recipe

For every creation/template flow:

1. **Tag optimistic ids clearly.** Use a prefix like `tmp-` or `opt-` so other code can detect them without a regex.
2. **Never send optimistic ids to the backend.** Any renderer, normalizer, related-loader, or action menu must guard:
   ```js
   if (!id || this._isTempId(id)) return;
   ```
3. **Render from cache exactly once after a mutation.** Set `_skipNextListFetch = true`, call `App.handleRoute()`, and do **not** clear the flag until the next user-initiated refresh or entity switch.
4. **Replace the optimistic record as soon as the server responds.** The replacement must search by the **optimistic temp id**, not the server id, and must preserve array order.
5. **If the server response does not include full nested data, merge rather than replace.** For example, keep the optimistic task list if the server WR response returns no tasks.
6. **Dropdown reads must be preceded by `.ensure()`.** If a dropdown is rendered synchronously, warm the cache before building options.

---

## 4. Per-Module Fixes

### 4.1 `erp_prototype/js/billing.js`

**Fix A: Board re-normalization must skip temp ids.**

In `refreshBoard`, inside the `colInvs.forEach` loop:
```js
if (this._isTempId(inv.id)) {
  inv.boardOrder = newOrder; // local-only
  return;
}
window.apiClient.invoices.update(inv.id, { boardOrder: newOrder }).catch(...);
```

Add helper:
```js
_isTempId(id) {
  return typeof id === 'string' && id.startsWith('temp-');
}
```

**Fix B: Render from cache exactly once after create.**

In `submitForm` (create branch):
- Do **not** call `App.handleRoute()` a second time after the server response.
- Instead, after replacing the optimistic record, call `App.handleRoute()` once and rely on `_skipNextListFetch` to render from warm cache.
- Remove the extra `this._skipNextListFetch = true; App.handleRoute();` block at the bottom of the create success path.

**Fix C: `_replaceInListCache` must preserve order and handle missing temp records.**

Current code falls back to prepending, which can duplicate. Change to:
```js
_replaceInListCache(tempId, record) {
  if (!tempId || !record) return;
  if (!Array.isArray(this._listCache)) {
    this._listCache = [record];
    return;
  }
  const idx = this._listCache.findIndex(i => i.id === tempId);
  if (idx >= 0) {
    this._listCache[idx] = record;
  } else {
    this._listCache.unshift(record);
  }
}
```

**Fix D: `generateFromTemplate` and bulk generate must not double-render.**

After adding the optimistic record and calling `App.handleRoute()`, remove the second `App.handleRoute()` on success. Just replace in cache and keep `_skipNextListFetch = true`.

**Fix E: Dropdown cache warming in request modal.**

`showRequestInvoiceModal` (if it exists) should `await window.apiClient.clientCache.ensure()` and `workRequestCache.ensure()` before reading `._wrs`.

### 4.2 `erp_prototype/js/disbursement.js`

**Fix A: `renderList` must not re-fetch after a warm render.**

Current `refreshList` checks `_skipNextListFetch`, renders from `this._items`, then sets `_skipNextListFetch = false`. Ensure that no second `App.handleRoute()` during the same tick triggers another fetch.

**Fix B: Board/table must skip temp ids for backend mutations.**

If disbursement board ever normalizes order, skip temp ids. Even if not, ensure the optimistic disbursement is not sent in any PUT/POST.

**Fix C: `_replaceOptimisticCreate` must preserve order and not duplicate.**

Current `_replaceInItems` falls back to `unshift`, which can duplicate. Use the same pattern as billing: replace in place or unshift if missing.

**Fix D: Request modal cache warming.**

`showRequestDisbursementModal` reads `workRequestCache._wrs` synchronously. Warm the cache at the start:
```js
await window.apiClient.workRequestCache.ensure();
```

### 4.3 `erp_prototype/js/workflow.js`

**Fix A: Never fetch related data for temp ids.**

Add helpers:
```js
_isTempId(id) {
  return typeof id === 'string' && (id.startsWith('tmp-') || id.startsWith('wr-') || id.startsWith('t-'));
},
```

In `getRelatedForWorkRequest(id)` and `getRelatedForTask(id)`, return the empty fallback immediately if the id is temp:
```js
if (this._isTempId(id)) return this._emptyWrRelated();
```

In `loadRelatedForWorkRequest(id)` and `loadRelatedForTask(id)`, return early for temp ids.

**Fix B: `createWorkRequest` replacement must preserve tasks and order.**

In `createWorkRequest`:
- If an existing optimistic record is found by `localId`, replace it in place.
- If the server response does not include `tasks`, preserve the existing tasks.
- If the server id differs from `localId`, also update any tasks whose `workRequestId` still points to `localId`.
- Do **not** push a duplicate if replacement succeeds.

**Fix C: `createTask` replacement must update parent WR task list by temp id.**

When replacing a temp task with the server task, also update the parent WR's `tasks` array by the temp id.

**Fix D: `submitForm` create flow must avoid double `App.handleRoute()`.**

Call `App.handleRoute()` once after optimistic WR + task insert. After the API completes and replacements are done, do **not** call `App.handleRoute()` again unless the server id changed and the detail route needs updating.

**Fix E: Suppress abort-error noise in `loadPage`.**

The console warning `Failed to load paginated work requests: route-change` is an `AbortError` from a stale in-flight request. Change the catch to only log non-abort errors:
```js
.catch(err => {
  if (!isAbortError(err)) console.warn('Failed to load paginated work requests:', err);
  return { workRequests: [], tasks: [], meta: {} };
});
```

**Fix F: `getPhaseTransitionStatus` must guard temp ids.**

If the WR id is temp, return `{ canTransition: false, reason: 'Saving...' }` so the board menu does not trigger related fetches.

### 4.4 `erp_prototype/js/clients.js`

Already reported working. Only minor hardening:
- Ensure `ClientsData.replaceClientById` preserves order and does not fall back to `unshift` when the temp record is missing (to avoid future duplicates).

### 4.5 `erp_prototype/js/transmittal.js`

Already reported working. Minor hardening:
- Ensure `_replaceInCache` preserves order.
- Warm `workRequestCache` in request modal.

### 4.6 `erp_prototype/js/users.js`

**Fix A: Admin creation path must not be blocked.**

- The outer `try/catch` in `submitUserForm` should not swallow errors. Ensure the inner creation `try` propagates errors to the outer catch so `Workflow.showMessage('Save User', ...)` is shown.
- The optimistic user should be inserted only after basic validation passes.
- If the backend returns a validation error, roll back the optimistic insert.

**Fix B: Shared cache patch must handle missing `_users`.**

Current code creates `_users = [serverUser]` if missing, but if the cache was never loaded it may lack other users. Still acceptable for dropdown warmth, but mark `_loadedAt`.

**Fix C: Dropdown cache warming.**

`renderAuditSection` reads `userCache._users` / `clientCache._clients` synchronously for filter options. Warm them before rendering:
```js
await Promise.all([window.apiClient.userCache.ensure(), window.apiClient.clientCache.ensure()]);
```

---

## 5. Cross-Cutting Helpers to Add

### 5.1 `erp_prototype/js/utils.js` or per-module

Add a shared temp-id detector:
```js
function isTempId(id) {
  return typeof id === 'string' && /^(tmp-|temp-|opt-|usr-opt-|tx-temp-)/.test(id);
}
```

If `utils.js` already exports `isTempId`, reuse it; otherwise add it there and reference it from each module.

### 5.2 `App.handleRoute` guard

If a module has `_skipNextListFetch === true`, `App.handleRoute()` should not trigger background fetches for that module on the same route. The current module renderers already check the flag, but repeated calls during a mutation can consume it early. Consider making the flag sticky until the next explicit refresh or entity switch, OR make each renderer only consume it on the first render after it was set.

Simplest: in each module's renderList, only clear `_skipNextListFetch` after the **first** warm render, and ignore it on subsequent renders if another mutation has not reset it.

---

## 6. Implementation Order

1. **Billing board temp-id guard** — highest user-visible failure (item disappears).
2. **Workflow related-data temp-id guard** — stops 404 spam and board menu errors.
3. **Workflow create replacement/order fixes** — stops duplicates.
4. **Disbursement warm-render fixes** — stops item disappearance.
5. **User admin creation + audit dropdown cache warming**.
6. **Syntax check + backend tests**.

---

## 7. Verification Checklist

For each of the 6 forms (Clients, Operations, Billing, Disbursement, Transmittal, Users):

- [ ] Create from full-page route; item appears immediately and stays after success toast.
- [ ] Nav badge increments immediately.
- [ ] No 404 requests for temp ids in Network tab.
- [ ] No `Failed to load paginated work requests: route-change` warnings (only genuine errors).
- [ ] Switching view modes (table/list/board) does not duplicate the new item.
- [ ] Manual refresh or entity switch replaces the temp record with the server record.
- [ ] Other forms' client/work-request/user dropdowns remain populated after creating an item.
- [ ] `node --check` passes on every modified frontend file.
- [ ] `cd backend && npm test` passes all suites.

---

## 8. Notes for Implementing Agents

1. **Preserve global-variable architecture** — no ES modules, no bundlers.
2. **No commits.**
3. **No Playwright.** Verify by hand in browser + backend tests.
4. **Restart dev server** after JS changes.
5. **Hard-refresh browser** to clear service-worker cached JS.
6. When in doubt, mirror the **Clients** and **Transmittal** modules, which are reported working.
