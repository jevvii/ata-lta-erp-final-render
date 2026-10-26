# ATA & LTA ERP — RBAC Permission Matrix

> **Contract Version:** `2.0.0`  
> **Frozen At:** `2026-10-04`  
> **Frozen By:** Parcel P0-H (Phase-0 Exit Gate)  
> **Source of Truth:** [`backend/src/lib/permissions.js`](file:///home/javvii/FreelanceProject/Project4_Final-Render/backend/src/lib/permissions.js)  
> **Regeneration Command:** `node backend/scripts/print-permission-matrix.js`

---

## 1. Overview & Evaluation Model

The system enforces Role-Based Access Control (RBAC) via concrete permission keys formatted as `<module>:<action>`.

### Resolution Rules (`buildPermissionSet`):
1. **Department Unions:** Effective permissions for a user are computed as the union of permissions associated with their assigned departments (`Management`, `Accounting`, `Operations`, `Documentation`, `HR`).
2. **Legacy Role Mapping & Role-Specific Exceptions:** A user with role `Manager` maps to `Management`. In addition, role `Manager` receives an explicit role-specific grant for `retainers:edit`. **Important:** Management department membership alone (e.g. `role: 'Staff', departments: ['Management']`) does NOT grant template editing; `retainers:edit` is restricted strictly to role `Manager` and role `Admin`. For staff roles matching department names, the role assignment grants that department's permissions.
3. **Admin Super-User:** Users with role `Admin` automatically inherit all department permissions across all departments plus Admin-only operational capabilities (`workflow:phase_transition`, `workflow:qa_review`, `disbursement:approve`, `timelog:edit_all`, `users:manage`, `clients:edit`, `transmittal:approve`) and the shared Admin/Manager template capability (`retainers:edit`).
4. **Data Scoping:** Departments and entities scope record visibility, but do NOT override permission key requirements.

### Wildcard Semantics for Frontend Consumers:
- Server-side route guards utilize `hasPermission(grantedSet, requiredPermission)`.
- Wildcards follow the format `<prefix>:*` (e.g., `approve_change:*` or `bypass_review:*`). A granted wildcard `<prefix>:*` satisfies any check for `<prefix>:<action>`.
- In `GET /v1/me`, the server returns a sorted array of concrete granted keys and explicit wildcards. When evaluating permission in React client hooks (`usePermission(action)`):
  - Check if the key exists directly in `data.permissions`.
  - Check if `<prefix>:*` exists in `data.permissions` for the target action's prefix.

---

## 2. Master Permission Matrix Table

<!-- BEGIN GENERATED PERMISSION MATRIX -->
| Permission Key | Admin | Management | Accounting | Operations | Documentation | HR |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `approve_change:*` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `approve_change:disbursements` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `approve_change:invoices` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `approve_change:tasks` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `audit:view_all` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `billing:delete` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:edit` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:edit_client_address` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:mark_paid` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `billing:payments` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:request` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `billing:templates` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `bypass_review:*` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `bypass_review:tasks` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `clients:edit` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `clients:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `disbursement:approve` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `disbursement:create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `disbursement:edit` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `disbursement:mark_released` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `disbursement:request` | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| `disbursement:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `dms:delete` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `dms:edit` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `dms:handover` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `dms:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `notifications:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `reports:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `retainers:edit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `retainers:use` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `timelog:create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `timelog:edit_all` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `timelog:edit_own` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `timelog:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `transmittal:approve` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `transmittal:create` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `transmittal:delete` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `transmittal:edit` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `transmittal:mark` | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| `transmittal:request` | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ |
| `transmittal:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `users:manage` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `users:view` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `workflow:edit` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `workflow:phase_transition` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `workflow:qa_review` | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `workflow:task_add` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `workflow:task_approve` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `workflow:task_upload` | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ |
| `workflow:transition_request` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| `workflow:view` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
<!-- END GENERATED PERMISSION MATRIX -->
