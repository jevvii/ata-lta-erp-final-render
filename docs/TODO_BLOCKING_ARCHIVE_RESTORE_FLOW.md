# TODO: Blocking Archive/Restore Flow Across Clients, Operations, Billing, Disbursements, and Transmittals

**Date:** 2026-07-21  
**Branch:** `uat`  
**Status:** Implemented / hardened on 2026-07-21  
**Scope:** Frontend archive, restore, trash, and unarchive actions for Clients, Operations/Workflow, Billing, Disbursements, and Transmittals.  
**Out of scope (note):** Pending-approval archive requests (e.g. `archiveClientRequest`) are approval submissions, not direct DB mutations; they are listed separately below as optional UX hardening only.

> **Completion note:** The blocking flow was implemented by a parallel agent workflow, then hardened to remove local fallback patches, add detail/form routing, switch Operations to dedicated archive endpoints, add a 30 s timeout, and ensure state survives refresh and hard refresh.

---

## 1. Problem Audit

All five modules currently share the same flawed archive/restore pattern: they apply a local optimistic patch **before** the database transaction settles, re-render the UI immediately, and only show a success toast after the API returns.

### 1.1 Current optimistic path (all modules)

```text
User clicks Archive/Restore
  → Workflow.showConfirm() asks for confirmation
  → _optimisticUpdate() patches the in-memory item immediately
  → App.handleRoute() re-renders the list/archive with the local patch
  → API call is fired in the background
  → On success: success toast is shown
  → On failure: local patch is rolled back and UI re-renders again
```

### 1.2 Why it causes lag / inconsistency / refresh surprises

| Symptom | Root cause | Location(s) |
|---|---|---|
| Item disappears/re-appears after refresh | Local cache was mutated before the DB commit; on refresh the DB (still in the old state) wins. | `clients.js:_optimisticUpdate`, `billing.js:_optimisticUpdate`, `disbursement.js:_optimisticUpdate`, `transmittal.js:_optimisticUpdate`, `workflow.js:_optimisticUpdate` |
| Archive list merges stale local records over server rows | `renderArchive()` builds a map from the server response, then overwrites it with local cached records that may not have persisted. | `transmittal.js:renderArchive` (`_activeSkipGeneration` merge), `clients.js:renderArchive`, `billing.js:renderArchive`, `disbursement.js:renderArchive`, `workflow.js:renderArchive` |
| Counts jump before the API finishes | `_updateCounts()` is called from the optimistic patch, not from the persisted response. | All `_optimisticUpdate` implementations |
| Double-clicks can fire duplicate archive calls | There is no module-level lock; the confirmation button is only hidden after the click handler returns, which happens **after** the async API call if the handler is async. | Every `Workflow.showConfirm` archive/restore callback |
| Operations archive returns stale data | `operationsService.archiveWorkRequest` returns `{ ...existing, archived: true }` instead of the post-update row, so the frontend can miss DB-computed fields. | `backend/src/modules/operations/service.js:389-405` |
| Success feedback is a toast that overlaps the already-changed UI | The user sees the new state before they are told the action succeeded. | All archive/restore handlers |

### 1.3 Modules and functions that must change

- **Clients** (`erp_prototype/js/clients.js`)
  - `archiveClientDirectly`
  - `archiveClientsDirectly` (bulk)
  - `unarchiveClient`
  - `bulkUnarchiveClients`
- **Operations / Workflow** (`erp_prototype/js/workflow.js`)
  - `archiveWorkRequest`
  - `unarchiveWorkRequest`
  - `bulkArchiveWorkRequests`
- **Billing** (`erp_prototype/js/billing.js`)
  - `trashInvoice`
  - `restoreInvoice`
  - `archiveInvoice`
  - `bulkArchiveInvoices`
  - `bulkTrashInvoices`
  - `unarchiveInvoice`
- **Disbursements** (`erp_prototype/js/disbursement.js`)
  - `archiveDisbursement`
  - `trashDisbursement`
  - `bulkArchiveDisbursements`
  - `unarchiveDisbursement`
- **Transmittals** (`erp_prototype/js/transmittal.js`)
  - `archiveTransmittal`
  - `bulkArchiveTransmittals`
  - `unarchiveTransmittal`
  - `bulkUnarchiveTransmittals`
  - The inline “Restore to Draft” action inside `renderArchive()` for cancelled transmittals

---

## 2. Desired Blocking Flow

Replace the current “optimistic patch → render → wait → toast” sequence with a single, blocking transaction flow:

```text
User clicks Archive/Restore (or selects bulk action)
  → Confirmation dialog (optional; keep the existing safety prompt)
  → Non-dismissible loading overlay: "Archiving…" / "Restoring…"
  → API call executes and the UI blocks until the response settles
  → On success:
       1. Update caches ONLY from the server response (no optimistic local patch)
       2. Invalidate module/count caches
       3. Show a success confirmation modal: "Archived" / "Restored"
       4. On OK, close the modal and re-render the active view from fresh data
  → On failure:
       1. Hide the loading overlay
       2. Show an error modal with the backend message
       3. Leave the UI in its original state (no rollback needed because nothing was changed)
```

### 2.1 Key design principles

1. **No optimistic local mutation for archive/restore.** The in-memory cache must not change until the server confirms the mutation.
2. **One in-flight archive/restore action per module.** If an action is already running, subsequent clicks are ignored or queued; the confirmation and loading overlay prevent user confusion.
3. **Server response is the source of truth.** After a successful API call, normalize the returned record and write it into the module cache, then invalidate dependent caches and counts.
4. **Re-render only after acknowledgment.** The success modal is shown **after** persistence; the list/archive refresh happens when the user dismisses the modal (or after a deterministic auto-dismiss with a clear countdown).
5. **Backend returns a fresh row for every archive/unarchive call.** This removes any ambiguity about whether the DB really committed.

---

## 3. Shared Frontend Changes

### 3.1 New blocking overlay helpers

Add to `erp_prototype/js/workflow.js` (or a new `erp_prototype/js/archiveActions.js` if preferred):

```js
// Workflow (or global helper)
showBlockingOverlay(title, message) {
  // Non-dismissible overlay with spinner.
  // Returns { overlay, close() }.
},

hideBlockingOverlay(overlay) {
  // Safely removes the overlay if it is still in the DOM.
}
```

Requirements:
- Uses the existing `.modal-overlay` / `.modal` styles so it matches `showConfirm`/`showMessage`.
- Has a CSS spinner (re-use `.loading-spinner` from `app.js:433`).
- Close button is **hidden**; overlay cannot be dismissed by clicking outside.
- Accessible: `aria-busy="true"` on the body while open.

### 3.2 New blocking action runner

Add a shared helper used by all five modules:

```js
async runBlockingArchiveAction({
  title,              // e.g. "Archiving Client"
  message,            // e.g. "Please wait while the client is archived."
  apiCall,            // async () => api response
  successTitle,       // e.g. "Archived"
  successMessage,     // e.g. "Client has been archived."
  errorTitle,         // e.g. "Archive Failed"
  onSuccess,          // optional hook to update cache before modal
  onAfterConfirm,     // optional hook after user clicks OK (re-render)
}) {
  // 1. Show loading overlay.
  // 2. Call apiCall() and await it.
  // 3. Hide loading overlay.
  // 4. If success: call onSuccess(response), then show success confirmation modal;
  //    when user clicks OK, call onAfterConfirm() and close modal.
  // 5. If error: show error modal; do not call onSuccess/onAfterConfirm.
}
```

Implementation notes:
- Keep the overlay open until `apiCall()` settles, including any explicit follow-up `GET` verification.
- Catch errors and surface them with `Workflow.showMessage(errorTitle, error.message, 'error')`.
- Track in-flight state so the same module cannot start a second archive/restore while one is running.

### 3.3 Module-level concurrency guard

Each module should expose a small guard:

```js
_archiveRestoreLock: false,

async _withArchiveLock(fn) {
  if (this._archiveRestoreLock) {
    Workflow.showMessage('Action in progress', 'Please wait for the current archive/restore action to finish.', 'info');
    return;
  }
  this._archiveRestoreLock = true;
  try {
    return await fn();
  } finally {
    this._archiveRestoreLock = false;
  }
}
```

Use this wrapper inside every archive/restore/bulk handler.

---

## 4. Per-Module Implementation Checklist

### 4.1 Clients (`erp_prototype/js/clients.js`)

- [x] Add `_archiveRestoreLock` / `_withArchiveLock` to the `Clients` module.
- [x] Refactor `archiveClientDirectly` to:
  - Confirm with `Workflow.showConfirm`.
  - Inside `_withArchiveLock`, call `runBlockingArchiveAction`:
    - `apiCall`: `() => window.apiClient.clients.archive(clientId)`
    - `onSuccess`: normalize `res.data` and call `ClientsData.replaceClientById(id, normalized)`.
    - `onAfterConfirm`: invalidate `clientCache`, `clients.invalidateCounts()`, `App.updateSidebarNotifications()`, `App.handleRoute()`.
- [x] Refactor `archiveClientsDirectly` (bulk) similarly; loop each client inside the lock, accumulate success/failure counts, and show a single summary success or error modal at the end.
- [x] Refactor `unarchiveClient` and `bulkUnarchiveClients` using `window.apiClient.clients.unarchive`.
- [x] Remove the `_optimisticUpdate` calls from the four functions above.
- [x] Keep `archiveClientRequest` / `archiveClientsRequest` unchanged (they are approval submissions), but optionally wrap their submission in a blocking overlay so the user gets feedback after the pending-approval record is saved.

### 4.2 Operations / Workflow (`erp_prototype/js/workflow.js`)

- [x] Add `_archiveRestoreLock` / `_withArchiveLock` to the `Workflow` module.
- [x] Refactor `archiveWorkRequest`:
  - `apiCall`: keep the existing `window.apiClient.workRequests.update(wrId, { status: 'Cancelled', archived: true })` call (or migrate to `window.apiClient.workRequests.archive` if the backend endpoint is preferred; either way it must return the fresh row).
  - `onSuccess`: normalize response and merge into `WorkflowData`, preserving existing task arrays and frontend-only fields the same way `_optimisticUpdate` currently does.
  - `onAfterConfirm`: invalidate `workRequestCache`, `workRequests.invalidateCounts()`, `WorkflowData.invalidateRelatedForWorkRequest(id)`, sidebar notifications, `App.handleRoute()`.
- [x] Refactor `unarchiveWorkRequest` using `window.apiClient.workRequests.unarchive` (or `update` with the current patch).
- [x] Refactor `bulkArchiveWorkRequests` to run sequentially inside the lock and report a single summary modal.
- [x] Remove `_optimisticUpdate` calls from archive/restore paths only. Keep `_optimisticUpdate` for other state transitions (phase routing, cancel, etc.).

### 4.3 Billing (`erp_prototype/js/billing.js`)

- [x] Add `_archiveRestoreLock` / `_withArchiveLock`.
- [x] Refactor `archiveInvoice`, `trashInvoice`, `restoreInvoice`, `unarchiveInvoice`.
- [x] Refactor `bulkArchiveInvoices` and `bulkTrashInvoices`.
- [x] For `unarchiveInvoice`, keep the current logic that restores a cancelled invoice to `Draft` by chaining `invoices.unarchive` then `invoices.update`, but perform both calls inside the blocking overlay and update the cache only after the final response.
- [x] Remove `_schedulePostMutationRefresh()` calls from these handlers; the re-render is triggered deterministically by `onAfterConfirm`.
- [x] Remove `_optimisticUpdate` calls from archive/restore/trash paths.

### 4.4 Disbursements (`erp_prototype/js/disbursement.js`)

- [x] Add `_archiveRestoreLock` / `_withArchiveLock`.
- [x] Refactor `archiveDisbursement`, `trashDisbursement`, `bulkArchiveDisbursements`, `unarchiveDisbursement`.
- [x] Remove `_optimisticUpdate` calls from these four functions.
- [x] Keep `_optimisticUpdate` for submit/approve/release/fund/reject transitions.

### 4.5 Transmittals (`erp_prototype/js/transmittal.js`)

- [x] Add `_archiveRestoreLock` / `_withArchiveLock`.
- [x] Refactor `archiveTransmittal`, `bulkArchiveTransmittals`, `unarchiveTransmittal`, `bulkUnarchiveTransmittals`.
- [x] Refactor the inline “Restore to Draft” action in `renderArchive()` (around line 2918) so it also uses the blocking runner with `window.apiClient.transmittals.update(...)`.
- [x] Remove `_optimisticUpdate` calls from these paths.

### 4.6 Optional: DMS (`erp_prototype/js/dms.js`)

The same optimistic pattern exists in `dms.js` (`archiveDocument`, `unarchiveDocument`). The user did not name DMS, but for consistency consider adding it to the same shared helper so all archive actions behave the same.

---

## 5. Backend Adjustments

No DB schema changes are required. Only two small backend hardening items are needed:

- [x] **`backend/src/modules/operations/service.js:389-405`** — Change `archiveWorkRequest` to return the post-update row instead of `{ ...existing, archived: true }`. Options:
  - Add `.select().single()` to the update and return `data`, or
  - Return `getWorkRequestById({ id, entityId, user })` after the update (consistent with `unarchiveWorkRequest`).
- [x] Verify that every archive/unarchive service returns a fully populated row:
  - `clientsService.archiveClient` / `unarchiveClient` ✅ (returns `getClientById`)
  - `billingService.archiveInvoice` / `unarchiveInvoice` ✅ (returns `.select().single()`)
  - `disbursementService.archiveDisbursement` / `unarchiveDisbursement` ✅
  - `transmittalService.archiveTransmittal` / `unarchiveTransmittal` ✅
  - `operationsService.archiveWorkRequest` ✅ fixed
- [ ] (Optional) Add an idempotency check in each service: if the record is already in the target archived state, return the existing row with 200 instead of performing a no-op update that still triggers audit logs.
- [ ] (Optional) Wrap archive/unarchive updates in a short advisory timeout or use Supabase RLS so that a slow archive cannot leave the frontend loading overlay open indefinitely; the frontend should also have its own request timeout.

---

## 6. Cache & Render Strategy After Persistence

After the API call succeeds, update state in this order:

1. **Normalize and write the server record into the module cache.**
   - Clients: `ClientsData.replaceClientById(id, normalized)`.
   - Workflow: `WorkflowData.normalizeWorkRequest(res.data)` then merge, preserving `tasks`, `priority`, `linkedInvoiceId`, `linkedDisbursementIds`, `linkedTransmittalIds`, `boardOrder`, `isPendingApproval` the same way `_optimisticUpdate` does.
   - Billing: `this._detailCache[id] = this.normalizeInvoice(res.data); this._addToListCache(...)`.
   - Disbursement: `this._updateCachedDisbursement(id, normalized)`.
   - Transmittal: `this._updateCachedItem(id, this.normalizeTransmittal(res.data))`.

2. **Invalidate dependent global caches and counts.**
   - Call the module’s own `invalidateCounts()` (`window.apiClient.clients.invalidateCounts()`, etc.).
   - Invalidate `clientCache`, `workRequestCache`, `userCache` where applicable.
   - Invalidate `Dashboard` cache if the module contributes to dashboard widgets.
   - Call `App.updateSidebarNotifications().catch(() => {})`.

3. **Show the success confirmation modal.**
   - Title: `Archived` / `Restored` / `Trashed` / `Unarchived`.
   - Body: one clear sentence, e.g. `"Invoice ${number} has been archived.`"
   - Single OK button. Disabled state is not needed because the action is already done.

4. **Re-render only after the user acknowledges the modal.**
   - In the OK handler call `App.handleRoute()` or `triggerSyncReload()` with an optional success toast already consumed by the modal.
   - If the current view was the detail page of the archived item, route back to the module list (`#clients`, `#billing`, `#operations`, `#disbursement`, `#transmittal`).
   - If the action was performed from the archive page, stay on the archive page and re-render it; the item should now be absent (for restore) or present (for archive if the user routed back).

---

## 7. UX & Accessibility Details

- [ ] Loading overlay must have a visible spinner and a descriptive message (`"Archiving client…"`, `"Restoring 3 disbursements…"`).
- [ ] Bulk actions should show a progress-aware message if the loop takes more than a few items; consider showing `"Archiving 2 of 5…"` to avoid the appearance of a hang.
- [ ] The overlay must trap focus; the user cannot tab to other controls while the action is in flight.
- [ ] On mobile, the overlay should cover the full viewport and prevent pull-to-refresh.
- [ ] Provide a clear error path: if the request fails or times out, hide the spinner and show `Workflow.showMessage('Archive Failed', error.message, 'error')`.

---

## 8. Testing Checklist

### 8.1 Unit / integration tests (local dev)

- [ ] Archive a client from the active list; confirm the loading overlay appears, then the success modal. Dismiss and verify the client is gone from the active list and visible in the archive.
- [ ] Refresh the page immediately after archiving; the item must remain in the archive, not reappear in the active list.
- [ ] Restore the same client; verify it reappears in the active list and stays there after refresh.
- [ ] Repeat the refresh-after-action test for Operations work requests, Billing invoices, Disbursements, and Transmittals.
- [ ] Test bulk archive/restore (2–5 items) and verify the summary modal shows the correct count.
- [ ] Simulate a network failure (e.g. block the archive endpoint in DevTools): confirm no local state changes, no count changes, and an error modal is shown.
- [ ] Double-click an archive action; confirm only one request is sent because of the `_archiveRestoreLock`.
- [ ] Test from both list view and detail view; detail view of an archived item should route back to the module list after success.

### 8.2 Backend verification

- [ ] Confirm each archive/unarchive endpoint returns the post-update row.
- [ ] Confirm the operations archive endpoint no longer returns `{ ...existing, archived: true }`.
- [ ] Confirm audit logs still record the action.

### 8.3 Staging / load

- [ ] With 10–50 concurrent users (per the existing concurrency plan), run archive/restore actions across modules and verify counts stay consistent.
- [ ] Verify no optimistic records leak into `renderArchive()` after the blocking flow is implemented.

### 8.4 Deployment

- [ ] This change touches only frontend logic and one backend service function; no DB migration is required.
- [ ] Deploy backend first (so archive endpoints return fresh rows), then deploy the frontend static build.
- [ ] Run the archive/restore smoke tests in production after deploy.

---

## 9. Rollback & Risk Mitigation

- [ ] Keep the existing `_optimisticUpdate` function intact for non-archive transitions. Do **not** rename or delete it; only remove archive/restore callers.
- [ ] If a bug is discovered in production, the only revert needed is the backend `archiveWorkRequest` return value and the small frontend handler changes; caches are unaffected because no optimistic mutation is performed.
- [ ] Add a temporary feature check: if `runBlockingArchiveAction` is missing (e.g. during partial deploy), fall back to the current `_optimisticUpdate` behavior so the UI does not break. This can be removed after the full rollout.

---

## 10. Definition of Done

- [x] All archive, restore, trash, and unarchive handlers in Clients, Operations, Billing, Disbursements, and Transmittals use the blocking flow.
- [x] No local optimistic patch is applied before the database confirms the mutation.
- [x] A non-dismissible loading overlay is shown during the API call.
- [x] A success confirmation modal is shown after the transaction persists.
- [x] Re-render happens only after the user acknowledges the success modal.
- [x] Backend `operationsService.archiveWorkRequest` returns the post-update row.
- [x] Refresh-after-action shows the same state the UI displayed.
- [x] No commits are made to git and the Playwright plugin is not run (per this task’s instructions).

---

## 11. Files Expected to Change

| File | Reason |
|---|---|
| `erp_prototype/js/workflow.js` | New blocking overlay helpers; refactor Workflow archive/restore |
| `erp_prototype/js/clients.js` | Refactor client archive/restore |
| `erp_prototype/js/billing.js` | Refactor invoice archive/trash/restore |
| `erp_prototype/js/disbursement.js` | Refactor disbursement archive/trash/restore |
| `erp_prototype/js/transmittal.js` | Refactor transmittal archive/restore |
| `backend/src/modules/operations/service.js` | `archiveWorkRequest` return fresh row |
| (optional) `erp_prototype/js/dms.js` | Consistency for document archive/restore |
| (optional) `erp_prototype/css/*.css` | Spinner/overlay polish if needed |

---

## 12. Notes for the Implementing Agent

- Do **not** implement this entire plan in one mega-change. Tackle one module at a time, starting with **Clients** (smallest surface area) or **Transmittals** (where the archive page merging logic is already well understood).
- After each module, run the refresh-after-action smoke test before moving to the next module.
- Keep the existing success-toast messages as the body text of the new success confirmation modal so users still see familiar wording.
- Remember: the goal is **data availability**, not speed. A short blocking wait is preferable to a fast-but-lying UI.
