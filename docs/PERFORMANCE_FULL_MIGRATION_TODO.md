# Full localStorage → Supabase Migration TODO

> Continues from `docs/PERFORMANCE_HOT_PATHS_CHECKPOINT.md`.  
> Goal: migrate every remaining `DB.*` / localStorage-backed prototype remain to the Node.js + Supabase backend, make all templates persist in the database, purge `data.js`, and wire the SPA end-to-end to the API.  
> Constraints: do **not** commit changes; do **not** use the Playwright plugin.

---

## Global handoff checkpoints (to be updated after each phase)

1. `git status --short` and `git diff --stat` saved in the final summary.
2. `node -c` on every modified `.js` file passes.
3. `cd backend && npm test` passes 88/88 after each backend phase.
4. `cd erp_prototype && npm run build:prod` succeeds and total gzipped JS ≤ 250 KB after each frontend phase.
5. DB.* audit counts updated in this file after each phase.
6. Source + dist smoke tests 4/4 after each frontend phase.

---

## Phase 1 — Backend foundations (P0)

### 1.1 Operations-requests module
**Files to create:**
- `backend/migrations/023-create-operations-requests-full.sql` (if migration 000014 is incomplete, add any missing columns)
- `backend/src/modules/operationsRequests/routes.js`
- `backend/src/modules/operationsRequests/controller.js`
- `backend/src/modules/operationsRequests/service.js`
- `backend/src/modules/operationsRequests/schema.js`
- `backend/tests/operationsRequests.test.js`

**Endpoints required:**
- `GET /v1/operations-requests?status=&type=&workRequestId=&clientId=&requestedBy=&page=&limit=`
- `GET /v1/operations-requests/:id`
- `POST /v1/operations-requests`
- `PUT /v1/operations-requests/:id` (for updates / cancel / fulfill)
- `DELETE /v1/operations-requests/:id`
- `GET /v1/operations-requests/counts` (returns `{ active: number, pending: number, rejected: number, byType: object }`)

**Schema columns to use (from migration 000014):** `id`, `entity_id`, `type` (`billing` | `disbursement` | `transmittal` | `client` | `workflow`), `work_request_id`, `client_id`, `requested_by`, `amount`, `status` (`pending` | `fulfilled` | `rejected` | `cancelled`), `notes`, `rejection_reason`, `fulfilled_by`, `fulfilled_at`, `created_at`, `updated_at`.

**Rules:**
- `type='billing'` is a request to create an invoice.
- `type='disbursement'` is a request to file an expense.
- `type='transmittal'` is a request to send documents.
- `type='client'` is a request to archive a client.
- `type='workflow'` is a generic workflow routing request (if used).
- Fulfill: `status='fulfilled'`, set `fulfilled_by` and `fulfilled_at`.
- Reject: `status='rejected'`, set `rejection_reason`.
- Cancel: `status='cancelled'` (soft via `deleted_at` or status).

### 1.2 Pending-approvals enhancements
**Files to edit:**
- `backend/src/modules/admin/routes.js`
- `backend/src/modules/admin/controller.js`
- `backend/src/modules/admin/service.js`
- `backend/src/modules/admin/schema.js`

**Changes:**
- `GET /v1/admin/pending-approvals` accepts `?status=pending|rejected|approved&tableName=&parentRecordId=&submittedBy=`.
- `GET /v1/admin/pending-approvals/:id`
- `POST /v1/admin/pending-approvals` — non-admins submit a structural change for review.
- Tests cover all new params.

### 1.3 Audit-log list endpoint
**Files to edit:**
- `backend/src/modules/admin/routes.js`
- `backend/src/modules/admin/controller.js`
- `backend/src/modules/admin/service.js`

**Changes:**
- `GET /v1/admin/audit?userId=&clientId=&action=&page=&limit=&sortOrder=` — paginated list of `audit_logs`.
- Response shape: `{ data: [...], meta: { total, page, limit } }`.

### 1.4 Template persistence tables
**Migrations to create:**
- `backend/migrations/024-create-disbursement-templates.sql`
- `backend/migrations/025-create-retainer-templates.sql`
- `backend/migrations/026-create-ground-workers.sql`

**Tables:**
- `disbursement_templates` (id, entity_id, name, category, amount, fund_source, schedule, description, linked_work_request_id, linked_invoice_id, created_by, created_at, updated_at, deleted_at)
- `retainer_templates` (id, entity_id, name, description, client_id, schedule, pf_amount, tasks JSONB, created_by, created_at, updated_at, deleted_at)
- `ground_workers` (id, entity_id, name, created_by, created_at, updated_at)

**Modules to create/edit:**
- Disbursement templates: add routes/controller/service/schema under `backend/src/modules/disbursements/` or a new `disbursement-templates` module; expose `GET /v1/disbursements/templates`, `POST /v1/disbursements/templates`, `PUT /v1/disbursements/templates/:id`, `DELETE /v1/disbursements/templates/:id`.
- Retainer templates: add under `backend/src/modules/operations/` or a new module; expose `GET /v1/operations/templates`, `POST /v1/operations/templates`, `PUT /v1/operations/templates/:id`, `DELETE /v1/operations/templates/:id`.
- Ground workers: add `GET /v1/ground-workers` and `POST /v1/ground-workers` under `backend/src/modules/operations/` or a new module.

### 1.5 Linkage columns
**Migration:**
- `backend/migrations/027-add-linked-task-id.sql` adds `linked_task_id UUID REFERENCES tasks(id)` to `invoices`, `disbursements`, and `documents`.

**Update services:**
- Billing service: read/write `linked_task_id`.
- Disbursement service: read/write `linked_task_id`.
- Documents service: read/write `linked_task_id` and filter by it.

### 1.6 Count endpoints
**Files to edit:**
- `backend/src/modules/disbursements/routes.js`, `controller.js`, `service.js`
- `backend/src/modules/operationsRequests/routes.js`, `controller.js`, `service.js`

**Changes:**
- `GET /v1/disbursements/counts` already exists; add `awaitingRelease` for current handler if user has `disbursement:mark_released`.
- `GET /v1/operations-requests/counts` for the My Requests badge and sidebar.

---

## Phase 2 — apiClient wiring

**File:** `erp_prototype/js/apiClient.js`

Add helpers:
- `apiClient.operationsRequests.list(query)`, `.create(data)`, `.get(id)`, `.update(id, data)`, `.delete(id)`, `.counts(entityId)`
- `apiClient.pendingApprovals.list(query)`, `.submit(data)`, `.get(id)`
- `apiClient.admin.listAudit(query)`
- `apiClient.disbursements.listTemplates()`, `.createTemplate(data)`, `.updateTemplate(id, data)`, `.deleteTemplate(id)`
- `apiClient.operations.listRetainerTemplates()`, `.createRetainerTemplate(data)`, `.updateRetainerTemplate(id, data)`, `.deleteRetainerTemplate(id)`
- `apiClient.groundWorkers.list()`, `.create(data)`

Keep response-shape normalization on the frontend side where needed.

---

## Phase 3 — Frontend DB.* purge by module

### 3.1 `pendingChanges.js`
- Remove localStorage hydration entirely.
- `submit()` → `POST /v1/admin/pending-approvals` when not bypassing.
- `approve()` admin bypass → use the appropriate resource API (clients, workRequests, invoices, disbursements, transmittals, documents) instead of `DB.insert/update`.
- Remove all `DB.getById` / `DB.getWhere` / `DB.update` / `DB.insert` / `DB.delete` calls.

### 3.2 `operationsRequests.js` (new module)
- Create a small state module if needed, but prefer direct `apiClient.operationsRequests.*` usage.
- Replace all `DB.getWhere('operationsRequests', ...)` / `DB.getById('operationsRequests', ...)` / `DB.insert('operationsRequests', ...)` / `DB.update('operationsRequests', ...)` calls across billing, disbursement, transmittal, workflow, clients, users, and app.js.

### 3.3 `users.js`
- `refreshAuditLog()` → `apiClient.admin.listAudit(...)` paginated.
- `getPendingCategories()` / My Requests → `apiClient.operationsRequests.list(...)` + counts.
- Remove `DB.getAll('auditLog')`.
- Remove all `DB.update/delete` on local tables for approving/rejecting; use resource APIs.

### 3.4 `billing.js`
- Remove all `DB.update('invoices', ...)` cache-sync calls; rely on `_detailCache` invalidation.
- Remove `DB.update('workRequests', ..., { linkedInvoiceId })` dead writes.
- Replace rejected archive scans with `apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'invoices' })`.
- Replace operations-request reads/writes with `apiClient.operationsRequests.*`.
- Remove local `DB.insert('invoices', ...)` after create; API response is the source of truth.

### 3.5 `disbursement.js`
- Remove `DB.getById('disbursements', ...)` fallback inside `loadDisbursement`.
- Remove all `DB.update('disbursements', ...)` cache-sync calls.
- Remove `DB.update('workRequests', ..., { linkedDisbursementIds })` dead writes.
- Replace operations-request reads/writes with `apiClient.operationsRequests.*`.
- Switch disbursement templates to API persistence (no localStorage backup).

### 3.6 `transmittal.js`
- Replace rejected archive scans with `apiClient.admin.listPendingApprovals({ status: 'rejected', tableName: 'transmittals' })` and `apiClient.operationsRequests.list({ status: 'rejected', type: 'transmittal' })`.
- Replace operations-request reads/writes with `apiClient.operationsRequests.*`.
- Remove `DB.update('workRequests', ..., { linkedTransmittalIds })` dead writes.

### 3.7 `workflow.js`
- Switch retainer templates to API persistence.
- Switch ground workers to API persistence.
- Remove all `DB.insert/update/delete/getById/getWhere/getAll` for `workRequests`, `tasks`, `invoices`, `disbursements`, `transmittals`, `documents`, `pendingChanges`, `operationsRequests`.
- Replace `_buildRelatedFromDb()` cold fallbacks with API calls.
- Remove the seeding IIFE that reads `DB.getAll('groundWorkers')` / `DB.getAll('retainerTemplates')`.
- Stop writing `linkedInvoiceId`, `linkedDisbursementIds`, `linkedTransmittalIds` on work requests.

### 3.8 `clients.js`
- Replace `DB.getWhere('pendingChanges', ...)` duplicate checks with `apiClient.admin.listPendingApprovals(...)`.
- Replace rejected client archive scans with `apiClient.operationsRequests.list({ status: 'rejected', type: 'client' })`.
- Remove the commented-out `migrateClientsFromLocalStorage()` and any other localStorage prototype remains.

### 3.9 `app.js`
- `updateSidebarNotifications()` → use `apiClient.disbursements.counts()` and `apiClient.operationsRequests.counts()`.
- Remove `DB.getWhere` calls for pending request/disbursement counts.

### 3.10 `auth.js`
- `canViewWr()` / `canViewDisbursement()` → use `apiClient.workRequestCache` only; remove `DB.getById('workRequests', ...)`.

### 3.11 `utils.js`
- Remove `DB.getById` / `DB.getWhere` / `DB.getAll` / `DB.delete` fallbacks.
- `nextInvoiceNumber()` → either call `apiClient.invoices.list({})` and scan the page, or add/use `apiClient.invoices.nextNumber()`.
- Remove `generateSequentialId()` if no callers remain.
- Remove `getChronologicalSequenceMap()` if no callers remain.

### 3.12 `data.js`
- Delete `erp_prototype/js/data.js`.
- Remove the `demo` bundle from `build.js`.
- Update any comments referencing `data.js`.

---

## Phase 4 — Verification

Run after every sub-phase:
1. `cd backend && npm test` → 88/88 passing.
2. `cd erp_prototype && npm run build:prod` → succeeds, gzipped JS ≤ 250 KB.
3. `node -c` on all modified `.js` files.
4. Source smoke test: `node dev-server.js` + `node smoke-dev.js` → 4/4.
5. Dist smoke test: `ERP_SERVE_DIST=1 PORT=8081 node dev-server.js` + `BASE_URL=http://localhost:8081 node smoke-dev.js` → 4/4.
6. DB.* audit: `for f in *.js; do grep -on "DB\.[a-zA-Z_]*" "$f"; done` → should show **zero** business-data DB.* calls (only allow comments mentioning the legacy DB if any).
7. localStorage audit: `grep -n "localStorage" *.js` → only theme, sidebar, session, pane-mode, telemetry, and filter-persistence remain; no `erp_*` business tables.

---

## Context-window handoff format

If the next agent takes over mid-implementation, the previous agent must leave:
1. Which TODO phases are `completed`, `in_progress`, or `pending`.
2. The exact files modified so far and a one-line reason per file.
3. The latest DB.* audit counts per file.
4. The latest test/build/smoke results.
5. Any blockers or decisions that need user input.

Use this file (`docs/PERFORMANCE_FULL_MIGRATION_TODO.md`) as the canonical source of truth; update the phase status and checkpoint sections before ending the turn.

---

## Phase status (updated by implementing agent)

| Phase | Status | Owner | Notes |
|---|---|---|---|
| 1.1 Operations-requests module | pending | — | Biggest blocker; used across billing/disbursement/transmittal/clients/workflow/users/app |
| 1.2 Pending-approvals enhancements | pending | — | Need create + filter endpoints |
| 1.3 Audit-log list endpoint | pending | — | Replaces users.js DB.getAll('auditLog') |
| 1.4 Template persistence tables | pending | — | Disbursement + retainer templates + ground workers |
| 1.5 Linkage columns | pending | — | linked_task_id on invoices/disbursements/documents |
| 1.6 Count endpoints | pending | — | operationsRequests + disbursements awaitingRelease |
| 2 apiClient wiring | pending | — | Must happen after Phase 1 |
| 3.1 pendingChanges.js | pending | — | Remove all DB.* |
| 3.2 operationsRequests.js frontend | pending | — | New state/helper module if needed |
| 3.3 users.js | pending | — | Audit log + my requests |
| 3.4 billing.js | pending | — | Remove dead WR writes + request flows |
| 3.5 disbursement.js | pending | — | API template persistence |
| 3.6 transmittal.js | pending | — | Request flows |
| 3.7 workflow.js | pending | — | Templates, ground workers, related fallbacks |
| 3.8 clients.js | pending | — | Remove prototype remains |
| 3.9 app.js | pending | — | Sidebar counts |
| 3.10 auth.js | pending | — | Visibility helpers |
| 3.11 utils.js | pending | — | nextInvoiceNumber + sequence helpers |
| 3.12 data.js deletion | pending | — | Final cleanup |
| 4 Verification | pending | — | Run full matrix |
