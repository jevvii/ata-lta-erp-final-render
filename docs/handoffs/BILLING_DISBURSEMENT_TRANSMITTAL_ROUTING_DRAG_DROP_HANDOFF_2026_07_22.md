# Billing / Disbursements / Transmittals — Routing & Drag-Drop Follow-up Handoff

**Date:** 2026-07-22  
**Branch:** `uat` (all changes below are uncommitted or staged for next agents)  
**Scope:** Apply the Operations blocking-flow pattern to Billing/Disbursements/Transmittals status routing, preserve RBAC, and fix drag-and-drop (especially transmittal kanban).  

---

## Context

The shared blocking archive/restore flow (`Workflow.runBlockingArchiveAction`) was recently extended to Operations work-request creation, task creation/editing, and work-request routing. It provides:

1. A confirmation dialog before the action.
2. A non-dismissible blocking overlay with spinner + shimmer progress bar.
3. A 30-second client-side timeout.
4. A success modal that requires an explicit OK.
5. Cache sync and re-render only after confirmed server persistence.
6. Rollback of optimistic state on failure.

Billing, Disbursements, and Transmittals still use the older optimistic-update pattern (`_optimisticUpdate` or inline `Workflow.showConfirm` + manual `App.handleRoute`). This creates the same refresh/survivability and UX trust issues that the archive/restore and Operations fixes addressed.

Transmittal board view also explicitly disables drag-and-drop because the backend has no `board_order` column. This is the only module where kanban cards cannot be dragged.

---

## TODO List

### A. Billing invoice status routing

1. **Identify all invoice status-transition entry points**
   - `erp_prototype/js/billing.js:1712` `onDrop` in board drag config (`Draft` → `Pending` → `Approved` → `Sent`/`Release Pending Approval` → `Partially Paid` → `Paid`).
   - `erp_prototype/js/billing.js:2909` detail-view **Approve** button.
   - `erp_prototype/js/billing.js:2926` detail-view **Send for Approval** button.
   - `erp_prototype/js/billing.js:2946` detail-view status-change handler.
   - Any list/table row action buttons that call `window.apiClient.invoices.update(... { status })`.

2. **Define a Billing-specific `_syncInvoiceToCaches` helper**
   - Update `Billing._items` (or `window.apiClient.invoiceCache` if it exists) from the confirmed server response.
   - If no shared invoice cache exists, use `Billing._updateCachedItem` with the normalized server record.
   - Call `window.apiClient.invoices.invalidateCounts()` and `App.updateSidebarNotifications()` after success.

3. **Refactor board drag `onDrop` to use blocking flow**
   - Preserve existing permission gates:
     - `targetStatus === 'Approved'` → requires `billing:approve`.
     - `targetStatus === 'Sent'` → direct release requires `billing:release` (Admin/Managerial), otherwise becomes `Release Pending Approval`.
     - `targetStatus === 'Paid'` → requires payment total ≥ invoice total.
     - Backward moves remain denied (silent).
   - Use `Workflow.runBlockingArchiveAction` for the actual API call.
   - On success, sync confirmed record to cache, show success modal, then `App.handleRoute()`.
   - On failure, rollback optimistic patch already applied by drag preview (current code only rolls back on API error in `applyMove`; make sure blocking overlay also rolls back).

4. **Refactor detail-view approve / send-for-approval / status change buttons**
   - Wrap each in `Workflow.runBlockingArchiveAction`.
   - Keep current permission checks (`billing:approve`, `billing:release`, Admin/Managerial fallback).
   - Keep current pending-approval behavior for non-Admin releases.

5. **Add `_needsFreshFetch` default to Billing data layer (if absent)**
   - Initialize to `true` so fresh logins/refetches get latest state, matching Operations fix.

6. **Verification**
   - `node --check` on `billing.js`.
   - Backend tests still pass (128 tests).
   - Manual/QA: drag invoice to each allowed column; confirm blocked moves show permission/payment warnings; refresh preserves routed status.

---

### B. Disbursement status routing

1. **Identify all disbursement status-transition entry points**
   - `erp_prototype/js/disbursement.js:1803` `onDrop` in board drag config (`Draft` → `Pending`/`Submitted`/`Under Review` → `Approved` → `Released` → `Funded`).
   - `erp_prototype/js/disbursement.js:2590` detail-view **Approve Expense** button.
   - `erp_prototype/js/disbursement.js:2611` detail-view **Release** button.
   - Any list/table actions.

2. **Add `_syncDisbursementToCaches` helper**
   - Update `Disbursement._items` from confirmed server response.
   - Call `window.apiClient.disbursements.invalidateCounts()` and `App.updateSidebarNotifications()`.

3. **Refactor board drag `onDrop` to use blocking flow**
   - Preserve existing RBAC:
     - `Approved` requires `disbursement:approve`.
     - `Released` requires `disbursement:mark_released` or `disbursement:approve`.
     - Map pre-approval statuses to canonical `Pending` for flow validation (existing behavior).
   - Keep release-dialog behavior for `Released` target.
   - Use `Workflow.runBlockingArchiveAction` for `submit`/`approve`/`fund` endpoints and for simple status+boardOrder updates.
   - Rollback on failure.

4. **Refactor detail-view approve / release / fund buttons**
   - Wrap in blocking action.
   - Keep the "cannot approve your own expense" guard.

5. **Add `_needsFreshFetch` default to Disbursement data layer (if absent)**
   - Initialize to `true`.

6. **Verification**
   - `node --check` on `disbursement.js`.
   - Backend tests still pass.
   - Manual/QA: drag through allowed flow; verify permission blocks; refresh preserves status.

---

### C. Transmittal status routing + drag-and-drop

#### C.1 Make transmittal kanban draggable

1. **Add `board_order` persistence to transmittals**
   - Add `board_order integer DEFAULT 0` to the `transmittals` table via a new idempotent migration, e.g. `backend/migrations/000037_add_transmittal_board_order.js`.
   - Include `board_order` in `backend/src/modules/transmittals/service.js` `listTransmittals`, `createTransmittal`, `updateTransmittal`, and the response objects from `sendTransmittal` / `acknowledgeTransmittal`.
   - Add `boardOrder` to `backend/src/modules/transmittals/schema.js` `updateTransmittalSchema` (number, optional).

2. **Update frontend normalization**
   - In `erp_prototype/js/transmittal.js` `normalizeTransmittal`, map `board_order` / `boardOrder`.

3. **Enable drag in `renderBoardView`**
   - Replace `const boardDrag = { enabled: false };` (`transmittal.js:1383`) with a real drag config similar to Billing/Disbursements:
     - `canDrag`: allow `transmittal:mark` (or `transmittal:edit`/`transmittal:create` for Draft) and no pending change.
     - `canDrop`: enforce `Draft` → `Sent` → `Acknowledged` forward flow only; same status allows reorder.
     - `orderField: 'boardOrder'`.
     - `onDrop`: if same status, call `window.apiClient.transmittals.update(id, { boardOrder })`; if status change, call `window.apiClient.transmittals.send(id)` for `Draft→Sent` or `window.apiClient.transmittals.acknowledge(id)` for `Sent→Acknowledged`, passing `boardOrder` where supported.
   - Ensure grouped-board view (`renderGroupedKanbanBoard`) receives the same `drag` config.

#### C.2 Apply blocking flow to transmittal routing

4. **Identify all transmittal status-transition entry points**
   - New board drag `onDrop`.
   - `erp_prototype/js/transmittal.js:514` detail-view **Mark as Sent**.
   - `erp_prototype/js/transmittal.js:1136` table-view **Mark Sent**.
   - `erp_prototype/js/transmittal.js:1327` board card menu **Mark as Sent**.
   - `erp_prototype/js/transmittal.js:1972` `showAcknowledgeDialog`.
   - `erp_prototype/js/transmittal.js:1167` / `1368` board/table **Acknowledge** buttons.

5. **Add `_syncTransmittalToCaches` helper**
   - Update `Transmittal._items` from confirmed server response.
   - Call `window.apiClient.transmittals.invalidateCounts()` and `App.updateSidebarNotifications()`.

6. **Refactor send and acknowledge actions**
   - Wrap in `Workflow.runBlockingArchiveAction`.
   - Preserve RBAC: `transmittal:mark` is required (`transmittal:send`/`transmittal:acknowledge` endpoints already guarded by this permission).
   - For acknowledge, keep the received-by/received-date form but perform the actual API call inside the blocking action.
   - On success, sync confirmed response, show success modal, then re-render.
   - On failure, rollback optimistic update.

7. **Add `_needsFreshFetch` default to Transmittal data layer**
   - Initialize to `true`.

8. **Verification**
   - `node --check` on `transmittal.js`.
   - Run backend migration script in test/dev DB.
   - Backend tests still pass.
   - Manual/QA:
     - Drag transmittal cards between Draft/Sent/Acknowledged columns.
     - Verify same-column reorder persists after refresh.
     - Send and acknowledge via detail/table/board and confirm blocking overlay + success modal.
     - Refresh / revisit page / new login session preserves routed status.

---

## Files likely to modify

| File | Changes |
|------|---------|
| `erp_prototype/js/billing.js` | Blocking flow for invoice routing; cache-sync helper; `_needsFreshFetch` default. |
| `erp_prototype/js/disbursement.js` | Blocking flow for disbursement routing; cache-sync helper; `_needsFreshFetch` default. |
| `erp_prototype/js/transmittal.js` | Enable board drag, blocking flow for send/acknowledge, cache-sync helper, `_needsFreshFetch` default. |
| `backend/migrations/000037_add_transmittal_board_order.js` | New idempotent migration adding `board_order` to `transmittals`. |
| `backend/src/modules/transmittals/schema.js` | Allow `boardOrder` in update schema. |
| `backend/src/modules/transmittals/service.js` | Persist/return `board_order`; include it in list/update responses. |
| `backend/src/modules/transmittals/controller.js` | Return `board_order` from send/acknowledge if not already. |

---

## RBAC rules to preserve

### Billing
- `billing:approve` → can move to `Approved`.
- `billing:release` (or Admin/Managerial) → can move to `Sent`; otherwise becomes `Release Pending Approval`.
- `billing:mark_paid` / Admin/Managerial → can move to `Paid` when payments cover total.
- `billing:edit` / Admin/Managerial → can drag/manage non-pending invoices.

### Disbursements
- `disbursement:approve` → can move to `Approved`.
- `disbursement:mark_released` or `disbursement:approve` → can move to `Released`.
- Admin/Managerial fallback applies for direct release.
- Cannot approve your own expense.

### Transmittals
- `transmittal:mark` → can send (Draft→Sent) and acknowledge (Sent→Acknowledged).
- `transmittal:edit`/`transmittal:create` → can create/edit Draft transmittals.
- `transmittal:delete` → can delete.
- Board drag should only be enabled for users with `transmittal:mark` (or higher) and no pending change.

---

## Notes for implementer

- Reuse `Workflow.runBlockingArchiveAction` from `erp_prototype/js/workflow.js` — do not duplicate overlay/success-modal logic.
- Avoid full module cache wipes (`invalidateCache`) on success; instead sync the confirmed server record and refresh counts/sidebar. This prevents the stale-record regression that required a follow-up fix for archive/restore.
- Keep existing `Workflow.showConfirm` pre-prompts for high-impact transitions (`Approved`, `Sent`, `Paid`, `Released`, `Funded`, `Acknowledged`).
- For transmittal drag, the grouped board (`renderGroupedKanbanBoard`) already supports the `drag` config and `KanbanBoard.attachDrag`; just pass a real `drag` object instead of `{ enabled: false }`.
- Do **not** commit or push changes.
- Do **not** use the Playwright plugin.
- Run `node --check` on all modified JS files and keep `npm test` passing (128 tests across 17 suites).

---

## Related memory / handoffs

- [[operations-task-creation-checkpoint-2026-07-22.md]]
- [[work-request-task-creation-fixes-2026-07-21.md]]
- [[blocking-archive-restore-flow-plan.md]]
- [[workflow-routing-task-drag-drop-rbac-analysis.md]]
- [[propagate-archive-pattern-plan-2026-07-21.md]]
