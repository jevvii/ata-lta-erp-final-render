# Checkpoint: Archive Work Request Visibility

## Problem

Archiving a work request from the Operations page currently makes the item disappear from the Operations active list and archive tab, but it **remains visible** in work-request dropdowns on creation forms (billing, disbursement, transmittal, and retainer template forms).

Expected behavior: archive should behave like **cancel** — the work request moves to the **Archive** tab in Operations and is **removed from all active creation-form dropdowns** automatically.

## Root Cause

1. **Frontend `archiveWorkRequest` only toggles `archived: true` without changing `status`.**  
   The Operations archive tab filters by `status === 'Cancelled' || (status === 'Completed' && archived)`. A work request that is archived while still `In Progress`, `Draft`, etc. does not match any archive category, so it vanishes from Operations UI. Meanwhile `workRequestCache._wrs` still contains it, so creation forms still show it.

2. **`workRequestCache` and creation-form dropdowns have no active/archived filter.**  
   Dropdowns directly iterate `window.apiClient.workRequestCache._wrs` and only check `entity`, not `archived` or `status === 'Cancelled'`. Archived/cancelled work requests therefore leak into pickers.

3. **`WorkflowData` and `workRequestCache` are separate caches.**  
   Cancelling a work request updates `WorkflowData` but does not always invalidate `workRequestCache`, and vice versa. Creation forms read from `workRequestCache`, so stale entries persist until a hard refresh.

4. **Restored work request lingers in the archive page.**  
   `WorkflowData.updateWorkRequest()` always preserved the local `archived` flag from `existing.archived`, even when the server response returned `archived: false`. This caused the archive page's merge/filter logic to keep treating the restored work request as archived. Additionally, the backend `unarchiveWorkRequest` service returned the pre-update snapshot (with the old `archived: true`), and the archive page did not re-check the current local cache state when categorising server rows.

## Implementation Plan

### 1. Make archive behave like cancel in `erp_prototype/js/workflow.js`

- Change `archiveWorkRequest(wrId)` so the optimistic patch is `{ status: 'Cancelled', archived: true }` and the API call uses `window.apiClient.workRequests.update(wrId, { status: 'Cancelled', archived: true })` (same as cancel).
- Update `bulkArchiveWorkRequests()` eligibility from `status === 'Completed'` to allow any non-terminal work request, and apply the same `status: 'Cancelled', archived: true` patch.
- Keep `unarchiveWorkRequest()` restoring to a sensible active status (`Draft` if it was cancelled, otherwise clear `archived` and leave status as-is). Provide rollback snapshots.

### 2. Hide archived/cancelled work requests from creation-form dropdowns

Add a shared active-work-request predicate and apply it everywhere a dropdown is populated:

- `erp_prototype/js/billing.js`:
  - `getWorkRequestOptions()` in filter toolbar
  - invoice form work-request select (`renderForm`)
  - request billing modal work-request select
- `erp_prototype/js/disbursement.js`:
  - `getWorkRequestOptions()` in filter toolbar
  - expense form linked-work-request select
  - retainer template form linked-work-request select
- `erp_prototype/js/transmittal.js`:
  - transmittal form work-request select and populateWRs
  - request transmittal modal work-request select

Predicate: active if `!wr.archived && wr.status !== 'Cancelled'`.

### 3. Fix lingering restored work request in Operations archive page

- In `erp_prototype/js/workflow.js`, update `WorkflowData.updateWorkRequest()` to only preserve the local `archived` flag when the server response omits it; honor an explicit `archived: false` from the server.
- In the archive page's **Restore to Draft** action, call `Workflow._refreshCounts()` and `window.apiClient.workRequestCache.invalidate()` after a successful restore.
- In `Workflow.renderArchive()`, re-check the current local `WorkflowData` cache state when categorising server rows, and exclude any work request that is currently active (`Workflow._isActiveWorkRequest`).
- In `backend/src/modules/operations/service.js`, change `unarchiveWorkRequest` to return the post-update row via `getWorkRequestById()` instead of the pre-update snapshot.

### 4. Keep caches in sync

- After any archive/unarchive/cancel mutation in `workflow.js`, call `window.apiClient.workRequestCache.invalidate()` so the next creation form render fetches fresh work requests.
- Ensure `WorkflowData._load()` also refreshes `workRequestCache` when it receives updated work requests (optional: invalidate or merge into `workRequestCache`).

### 5. Verify no regressions

- Archive a work request: it moves to Operations Archive tab.
- Open billing/disbursement/transmittal creation forms: the archived work request no longer appears.
- Unarchive the work request: it returns to Operations active list and reappears in creation-form dropdowns.
- Cancel still behaves the same as before.

## Definition of Done

1. `archiveWorkRequest` sets `status: 'Cancelled', archived: true`.
2. Archived/cancelled work requests do not appear in any creation-form work-request dropdown.
3. `workRequestCache` is invalidated after archive/unarchive/cancel so dropdowns refresh automatically.
4. Restored work requests disappear from the Operations Archive page and remain in the active list.
5. All modified files pass `node --check`.
6. No commits or Playwright tests introduced.
