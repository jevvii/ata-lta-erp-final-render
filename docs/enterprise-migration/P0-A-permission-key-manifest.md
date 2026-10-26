---
id: P0-A
phase: 0
depends_on: []
touches: [backend/src/lib/permissions.js, backend/src/middleware/rbac.js, backend/src/modules/me/, backend/tests/]
status: pending
---

# P0-A — Permission-Key Manifest (RBAC Foundation)

## 1. Mission

Convert the backend's permission data into the single source of truth every later parcel (and the React app) consumes. Good news: the machinery already exists — this parcel **extends the existing key catalog and flips the frontend contract**, it does not rebuild the engine. Done = an updated key catalog covering all UAT-driven rules, `/me` returning the resolved key set in a React-ready shape, and matrix tests proving every role→key mapping.

## 2. Ground Truth (verified 2026-10-03)

- `backend/src/lib/permissions.js` ALREADY holds `DEPARTMENT_PERMISSIONS` as data (e.g. `workflow:view`, `billing:edit`, wildcard `approve_change:*`), plus `buildPermissionSet({role, departments})` returning a `Set<string>` (union of department perms + legacy role shim; Admin gets all + `users:manage`, `clients:edit`, `transmittal:approve`).
- `backend/src/middleware/rbac.js` ALREADY exports `requirePermission(actionOrActions)` (any-of semantics, wildcard-aware via `hasPermission`) and `requireAdmin`.
- `backend/src/modules/me/routes.js` ALREADY mounts `GET /v1/me` and `GET /v1/me/permissions`.
- `erp_prototype/js/auth.js` is the string-literal soup (`role === 'Admin'`, `Manager → Management` shim) — **out of scope here** (vanilla freeze); it keeps working because today's keys remain valid (R6).

## 3. Contract

### 3.1 New permission keys (additions only; `module:action` style, consistent with existing)

| Key | Granted To | UAT Driver |
| :--- | :--- | :--- |
| `workflow:phase_transition` | Admin only | WR phase advancement is admin-driven |
| `workflow:transition_request` | Management (Manager), Admin | Managers "Notify Admin" — creates transition request |
| `workflow:qa_review` | Admin only | Per-task compliance review at QA gate |
| `retainers:use` | Management, Admin | Managers generate WRs from templates |
| `retainers:edit` | Admin, Manager (role exception) | Admin and role Manager create/edit templates (role-specific exception; Management department staff without role Manager excluded) |
| `disbursement:approve` | Admin only | New approval gate (see P0-G) |
| `billing:edit_client_address` | Accounting, Management, Admin | Accounting edits client address on billing |
| `timelog:view` / `timelog:create` / `timelog:edit_own` | ALL departments + Admin | Dashboard time logging (P0-F) |
| `timelog:edit_all` | Admin only | Admin correction path |
| `notifications:view` | every authenticated user | Bell/badges (P0-B) |

> **Note on `retainers:edit`:** Per the RBAC remediation specification, `retainers:edit` is granted to role `Manager` as an explicit role-specific grant. Management department membership alone (e.g. `role: 'Staff', departments: ['Management']`) does NOT grant template editing.

### 3.2 Key changes to EXISTING grants

- `disbursement:create` → grant to **Operations, Documentation, HR** (currently only Management + Accounting). Approval gate replaces the old create-restriction (P0-G wires the gate; this parcel only moves the key).
- Retainer template actions currently implied under `billing:templates` are **split out** into the `retainers:*` keys above. `billing:templates` remains for billing-side payment templates; do not delete it.

### 3.3 `/me` payload (additive — no field removed)

```json
{
  "data": {
    "user": { "id": "…", "role": "…", "departments": ["…"] },
    "permissions": ["workflow:view", "timelog:create", "…"]
  }
}
```

`permissions` = sorted array form of the resolved set (same data as `GET /v1/me/permissions`, embedded so the React shell needs one round-trip). Wildcards resolved server-side (React receives concrete keys; wildcards may also be included as-is — document the choice in `docs/api-contracts/`).

## 4. Rules

- R1. `DEPARTMENT_PERMISSIONS` remains plain data in `lib/permissions.js` — no logic migrates into the map. Logic stays in `buildPermissionSet`/`hasPermission`.
- R2. All keys in §3.1 exist in the map exactly as spelled. No synonyms.
- R3. `disbursement:create` granted to all five departments.
- R4. `requirePermission` signature/behavior unchanged; all existing route guards keep passing.
- R5. `GET /v1/me` embeds `permissions` array; `GET /v1/me/permissions` keeps working unchanged.
- R6. **Backward compatibility:** zero existing keys renamed or removed. The vanilla app must behave identically before and after this parcel.
- R7. Department list (`DEPARTMENTS`) unchanged; departments remain scoping, never new permission sources.

## 5. Acceptance Criteria

- AC-1 (R1,R4): `npm run lint` clean; existing suite green with zero modifications to existing tests.
- AC-2 (R2,R3): new matrix tests pass for every (department × new key) cell in §3.1–3.2, including negative cases (e.g. Operations lacks `workflow:phase_transition`).
- AC-3 (R5): Supertest: `GET /v1/me` as a Manager includes `workflow:transition_request` and excludes `workflow:phase_transition`; as staff includes `timelog:create`.
- AC-4 (R6): grep of `erp_prototype/` behaviors is unnecessary — instead: no existing test expectation changed (proves compatibility).

## 6. Tests Required

- `backend/tests/permissions/matrix.test.js` — full (role ∪ departments) × key matrix assertions.
- `backend/tests/me.spec.js` (extend) — `/me` embeds permissions; sorted; matches `/me/permissions`.

## 7. Explicit Non-Goals

- ❌ No frontend changes of any kind.
- ❌ No route refactor (wiring new keys into routes happens in P0-D/E/F/G).
- ❌ No approval-flow logic (that is P0-G).
- ❌ No rename/removal of legacy keys, no `Manager → Management` shim removal.

## 8. Working Constraints

Branch `feat/p0-a-permission-keys` off `staging`. This parcel blocks P0-B/C/E/F/G — prioritize review turnaround. Publish the resulting matrix table in the PR description verbatim (P0-H will canonize it).

## 9. Handoff

Produces: (a) frozen key catalog used by P0-D/E/F/G route guards; (b) `/me` contract consumed by P1's `usePermission()` hook; (c) matrix table input for P0-H.

## 10. References

Vault master spec §D8 · memory `enterprise-migration-spa-alignment-2026-10-03` · `docs/api-contracts/agent-a-contracts.md`.
