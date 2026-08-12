# Implementation Plan: Transmittal Workflow & Verification Fixes

This plan outlines the changes needed to address the transmittal bugs and requirements.

## Proposed Changes

### 1. Transmittal Approval & Action Button UI Fixes
- **Backend (`backend/src/modules/transmittals/service.js`)**:
  - Update `approveTransmittal` to set the transmittal status to `'Sent'`, `sent_at` to the current time, and `sent_by` to the approving user. Log both `transmittal.approve` and `transmittal.send` actions in the audit log.
  - Update `sendTransmittal` to set `approved: true` if the action is performed directly by an `Admin`.
- **Frontend (`erp_prototype/js/transmittal.js`)**:
  - Restructure action button visibility on Draft transmittals.
  - Modify `canEditTransmittal(t)` to return `false` if the user is an Admin/approver (`Auth.can('transmittal:approve')`). This ensures approvers do not see the Edit button on Draft transmittals.
  - In `renderDetail` action rendering, change the Direct Edit check `Auth.can('transmittal:edit')` to `this.canEditTransmittal(t)`.
  - In detail actions, table row actions, compact list actions, and board card context menus, check if the transmittal is Draft and the user has approval permissions. If so, hide the "Archive" action to satisfy the constraint that they should "only see approve and mark as sent" on Draft transmittals.
  - Ensure "Mark as Sent" is shown to:
    1. Users who can approve from Draft (Admin).
    2. Users who created the transmittal (`t.createdBy === Auth.user?.id`) AND have the permission to move them in the phases (`Auth.can('transmittal:mark')`).

### 2. Item Erasing Bug Fix
- **Backend (`backend/src/modules/transmittals/service.js`)**:
  - Create a helper `attachItems(transmittal)` to query and append items to a transmittal object.
  - Apply `attachItems` to the returned transmittal data in all status update/modification endpoints:
    - `updateTransmittal`
    - `approveTransmittal`
    - `sendTransmittal`
    - `acknowledgeTransmittal`
    - `archiveTransmittal`
    - `unarchiveTransmittal`
  - This ensures the returned payload contains the transmittal line items, preventing the client-side cache from erasing items when syncing the updated record.

### 3. Linked Transmittals Section Fix
- **Backend (`backend/src/modules/operations/service.js`)**:
  - In `getWorkRequestRelated`, change the entity filter to query related records (invoices, disbursements, transmittals, documents) based on the work request's own entity (`wr.entity_id`) rather than the active entity header fallback (`relatedEntityId`). This resolves the issue where cross-entity users fail to see related documents/transmittals if their active entity is mismatched.

### 4. Tracking Number Generation & Uniqueness Fix
- **Backend (`backend/src/modules/transmittals/service.js` & `controller.js`)**:
  - Support `includeDeleted` filter in the backend `listTransmittals` method.
- **Frontend (`erp_prototype/js/utils.js`)**:
  - Add `nextTrackingNumber(entity)` function to `window.Utils` to fetch the transmittals list from the backend (including soft-deleted ones) and compute the next sequential number (`entity + '-TX-' + year + '-' + sequence`).
- **Frontend (`erp_prototype/js/transmittal.js` & `workflow.js`)**:
  - Update all forms and creation endpoints to call the async sequential `nextTrackingNumber` instead of the legacy random generator `generateTrackingNumber`.

### 5. Epoch Date Root Cause Fix
- **Frontend (`erp_prototype/js/utils.js`)**:
  - Modify `formatDate(d)` to return `'—'` when `d` is null, undefined, or empty, rather than parsing a null date into the epoch date (`Jan 1, 1970`).

### 6. Transmittal Item Category Dropdown Options Fix
- **Frontend (`erp_prototype/js/transmittal.js` & `workflow.js`)**:
  - Change category dropdown selections in both create/edit forms to: `"Original Copy"`, `"Photocopy"`, `"Generated Copy"`, and `"Others"`.
