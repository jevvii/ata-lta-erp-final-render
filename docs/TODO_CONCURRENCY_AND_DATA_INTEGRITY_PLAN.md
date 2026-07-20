# Concurrency & Data-Integrity Implementation Plan

**Date:** 2026-07-21  
**Branch:** `uat`  
**Status:** Research and audit complete; implementation queued for next agents  
**Approach:** Dynamic multi-agent workflow. No Playwright. No commits without coordination.  
**Related docs:**
- `docs/TODO_ARCHIVE_FLOW_IMMEDIATE_FEEDBACK_FIX.md`
- `docs/TODO_BILLING_DISBURSEMENT_TRANSMITTAL_PATTERN_PROPAGATION.md`
- `docs/TODO_CREATION_PERSISTENCE_CLIENT_PATTERN_PROPAGATION.md`
- `docs/PERFORMANCE_OPTIMIZATION_PLAN.md`

---

## 1. Executive Summary

The ERP is moving from a single-user/small-team prototype into daily use by **10–50 concurrent users** who share invoices, disbursements, work requests, tasks, clients, and transmittals. The current backend and frontend are **not concurrency-safe** in several critical dimensions:

- **No database transactions or atomic transitions.** Multi-step writes (invoice + lines, transmittal + items, client delete cascade, disbursement approval side effects) are sequences of separate HTTP calls to Supabase. A failure in step 2 leaves partial state.
- **No optimistic locking / versioning.** Two users editing the same record silently overwrite each other; there is no 409 conflict dialog.
- **Read-modify-write state-machine races.** Disbursement approve/release/fund, work-request status changes, operations-request fulfillment, and pending-approval approvals all read the current state in Node.js, then issue an unguarded `UPDATE`. Two concurrent approvers can both succeed.
- **No idempotency.** Retries and double-clicks can create duplicate clients, invoices, disbursements, payments, pending approvals, and operations requests.
- **Frontend singleton state and generation-only guards.** The app prevents stale *list-load* commits with generation counters, but it does not detect **cross-user edits**, protect forms from duplicate submit, or abort in-flight mutations on navigation.
- **Stale auth/profile cache and weak RBAC.** The backend caches user profiles for 5 minutes with no invalidation, and at least two mutating endpoints require only `workflow:view` or no permission at all.
- **Fire-and-forget audit logging.** Audit rows are written after the response and silently swallowed on error; failed mutations are not audited.
- **Service-role key bypasses RLS.** All DB access uses the Supabase service key, so application-level filtering is the only tenant/entity boundary.

This document gives a sequenced, cross-cutting plan to make concurrent usage, editing, updating, archiving, and restoring **non-destructive and predictable** while preserving Supabase data integrity, availability, and confidentiality.

---

## 2. Concurrency Principles to Adopt

1. **Database as the single source of truth for invariant-critical work.** Status transitions, multi-table writes, duplicate prevention, and authorization must be enforced inside PostgreSQL (RPC functions, `CHECK`/`UNIQUE` constraints, triggers, RLS). Node.js validates shape and forwards intent; the frontend renders the DB-returned state.
2. **Optimistic concurrency control (OCC).** Add a monotonic `version` integer (or `updated_at`) to every mutable row. GET returns it; PUT/PATCH/DELETE requires `WHERE id = ? AND version = ?`. A 0-row update returns `409 Conflict` with the current server row so the user can merge or reload.
3. **Atomic state-machine transitions.** Every transition lives in one RPC / guarded `UPDATE … WHERE status = <expected_from> RETURNING *`. If no row is returned, the transition already happened; return `409`/`422` with the current state.
4. **Idempotency for all mutations.** Client generates a stable `Idempotency-Key` per action and stores it in `sessionStorage`. Backend/RPC stores `(actor_scope, idempotency_key)` with a short TTL and returns the previously stored result on retry.
5. **Row-level security and tenant isolation as defense-in-depth.** Even though the backend currently uses the service key, add RLS policies keyed on `entity_id` / `auth.uid()` so a missing middleware filter cannot leak cross-tenant data.
6. **Short, explicit transaction boundaries via RPC.** Wrap invoice+lines, transmittal+items, client delete cascade, disbursement state change+audit, pending-approval apply+status flip inside a single PL/pgSQL function called with `supabase.rpc()`.
7. **Soft deletes, immutable audit logs, and stale-state reconciliation.** Use status / `deleted_at` rather than physical `DELETE`. Write history rows in the same transaction. Frontend optimistically hides/restores items, then invalidates and drops stale fetches.
8. **Request coalescing, cache invalidation, and backpressure.** Maintain one `AbortController` per endpoint; abort the previous request before a new one. Use server freshness (`max updated_at` / ETag) and clear module state on tab transitions.
9. **External-call isolation.** Do not hold a DB transaction while uploading to S3, calling a payment gateway, or generating PDFs. Stage the record as `pending_upload`, perform the external call outside the transaction, then update status.
10. **Trust but verify the frontend.** Every permission check happens at the API; the frontend hides actions based on role, but the server is the final authority.

---

## 3. Cross-Cutting Fix Patterns

Apply these patterns everywhere unless a module-specific task says otherwise.

### 3.1 Atomic transition pattern
```sql
UPDATE table_name
SET status = 'Approved',
    approved_by = p_user_id,
    approved_at = now(),
    version = version + 1
WHERE id = p_id
  AND entity_id = p_entity_id
  AND status = 'Pending'
RETURNING *;
```
Node.js translates “no row returned” to HTTP `409 Conflict` with `{ currentStatus, currentVersion }`. The frontend shows a conflict/reload dialog.

### 3.2 Optimistic-locking pattern
- Add `version INTEGER NOT NULL DEFAULT 1` to every mutable table.
- `GET /:id` returns `version`.
- `PUT /:id` sends `{ ..., version }`; service does `UPDATE … WHERE id = ? AND version = ? RETURNING *, version+1`.
- Frontend stores `version` when loading a form and sends it on save. On `409`, show a diff/merge dialog.

### 3.3 Idempotency-key pattern
- On form open, generate `idempotency-key = ${userId}:${entity}:${action}:${crypto.randomUUID()}` and keep it in `sessionStorage` until the action succeeds.
- Send `Idempotency-Key` header on every mutating request.
- Backend RPC stores `(actor_scope, idempotency_key, response_json, created_at)` with `UNIQUE(actor_scope, idempotency_key)`. Duplicate keys within 24 h return the stored response.

### 3.4 Soft-delete / archive pattern
- Never use physical `DELETE` for business objects.
- Add `archived BOOLEAN DEFAULT FALSE`, `archived_at`, `archived_by` (or reuse `deleted_at` consistently).
- `DELETE /:id` endpoints become `POST /:id/archive` and `POST /:id/unarchive`.
- List queries always filter active vs archived explicitly.

### 3.5 Audit-inside-transition pattern
- Move audit writes into the same RPC that changes state.
- If using Node orchestration, use `auditService.logOrFail()` and fail the request if the audit cannot be written.

### 3.6 Frontend request-coalescing pattern
- In `apiClient.js`, register `AbortController`s for **mutations** too, and cancel them in `abortRequests()` on route change.
- Every module list loader accepts an `AbortSignal` and forwards it to `apiClient.get()`.
- Use one signal per endpoint; abort the previous fetch before starting a new one.

---

## 4. Implementation Phases

**Do not mix phases.** Finish each phase and run module-level smoke tests before starting the next. The `uat` branch has uncommitted changes; coordinate commits.

### Phase 0 — Schema Hardening (foundation, no API changes)
**Goal:** Make the database reject invalid state before we add application logic.

| # | Task | Files / Tables | Acceptance Criteria |
|---|------|----------------|---------------------|
| 0.1 | Add `version` column to every mutable table. | `clients`, `invoices`, `invoice_line_items`, `disbursements`, `transmittals`, `transmittal_items`, `work_requests`, `tasks`, `operations_requests`, `pending_changes`, `documents` | Columns exist, default 1, not null. |
| 0.2 | Add `archived`/`archived_at`/`archived_by` or normalize existing `deleted_at`. | `clients`, `invoices`, `disbursements`, `transmittals`, `work_requests`, `documents` | No module relies on `status` alone for archive semantics. |
| 0.3 | Add `CHECK` constraints for status columns. | `disbursements.status`, `work_requests.status`, `tasks.status`, `operations_requests.status`, `documents.lifecycle` | Invalid statuses rejected at DB level. |
| 0.4 | Add missing `UNIQUE` constraints. | `disbursements(entity_id, disbursement_number)`, `invoices(entity_id, invoice_number)` | Duplicate numbers rejected. |
| 0.5 | Add partial unique indexes for active duplicates. | `clients(entity_id, tin) WHERE deleted_at IS NULL`, pending changes per submitter/record | Active duplicates prevented; deleted records can be recreated. |
| 0.6 | Add idempotency table. | New migration `000031_create_idempotency_keys` | `(actor_scope, idempotency_key)` unique, 24 h TTL. |
| 0.7 | Add `status_history` or `entity_events` table. | New migration `000032_create_status_history` | `(table_name, record_id, old_status, new_status, actor_id, created_at)`; RLS-scoped. |

### Phase 1 — Atomic RPC Transitions (highest business impact)
**Goal:** Eliminate read-modify-write races for state machines and approvals.

| # | Task | Files | Acceptance Criteria |
|---|------|-------|---------------------|
| 1.1 | Create `disbursement_transition(id, from_status, to_status, user_id, entity_id)` RPC. | `backend/migrations/000033_disbursement_transition_rpc.sql`, `backend/src/modules/disbursements/service.js:454-502` | Two concurrent approvals of the same `Pending` disbursement result in exactly one successful transition; second gets 409. |
| 1.2 | Create `work_request_transition` and `task_transition` RPCs. | `backend/src/modules/operations/service.js:341-385`, `backend/src/modules/operations/service.js:582-617` | Concurrent status changes are safe; full-field overwrites stop. |
| 1.3 | Create `operations_request_fulfill` and `operations_request_reject` RPCs. | `backend/src/modules/operationsRequests/service.js:141-202` | `WHERE status = 'pending'`; zero rows → 409. |
| 1.4 | Create `pending_change_approve` RPC that locks the row and applies side effects atomically. | `backend/src/modules/admin/service.js:464-493`, `backend/src/modules/admin/service.js:363-462` | Same pending change cannot be approved twice; side effects happen once. |
| 1.5 | Create `invoice_record_payment` RPC. | `backend/src/modules/billing/service.js:331-398` | `amount_paid` recalculated from `SUM(invoice_payments.amount)` atomically; overpayment rejected. |
| 1.6 | Create `client_archive_cascade` RPC. | `backend/src/modules/clients/service.js:507-552` | Client and related rows archived/unarchived atomically. |
| 1.7 | Create `document_delete_cleanup` RPC. | `backend/src/modules/documents/service.js:283-312` | Storage object removed in same transaction as metadata soft-delete. |

### Phase 2 — Optimistic Locking / ETags
**Goal:** Prevent silent overwrites when two users edit the same record.

| # | Task | Files | Acceptance Criteria |
|---|------|-------|---------------------|
| 2.1 | Return `version` on every `GET /:id` response. | All `service.js` `getById` functions | Frontend receives `version`. |
| 2.2 | Require `version` on `PUT /:id` and `PATCH /:id` and translate 0-row updates to 409. | All update service functions | Stale writes rejected; server returns current row. |
| 2.3 | Frontend stores `version` per loaded record and sends it on save. | `erp_prototype/js/billing.js`, `erp_prototype/js/clients.js`, `erp_prototype/js/disbursement.js`, `erp_prototype/js/transmittal.js`, `erp_prototype/js/workflow.js` | 409 triggers conflict dialog. |
| 2.4 | Add conflict dialog utility in `Utils`. | `erp_prototype/js/utils.js` | Shows server values vs local values; offers reload or merge. |

### Phase 3 — Idempotency and Duplicate-Submit Guards
**Goal:** Make retries and double-clicks safe.

| # | Task | Files | Acceptance Criteria |
|---|------|-------|---------------------|
| 3.1 | Backend `Idempotency-Key` middleware reads the header and forwards to RPC. | `backend/src/middleware/` or service helpers | Duplicate key within TTL returns stored response. |
| 3.2 | Apply idempotency to `createClient`, `createInvoice`, `createDisbursement`, `createTransmittal`, `createWorkRequest`, `recordPayment`, `releaseDisbursement`, `createOperationsRequest`, `approvePending`. | All `create`/`POST` service functions | Double-click creates one row. |
| 3.3 | Frontend generates and reuses `Idempotency-Key` per form/action. | `erp_prototype/js/billing.js`, `erp_prototype/js/clients.js`, `erp_prototype/js/disbursement.js`, `erp_prototype/js/transmittal.js`, `erp_prototype/js/workflow.js` | Key persists across retries. |
| 3.4 | Disable submit buttons and show loading state while mutation is in flight. | All form submit handlers | No duplicate UI submissions. |

### Phase 4 — Frontend State, Cache, and Request Hardening
**Goal:** Make the SPA behave correctly under multi-tab, multi-user, and navigation races.

| # | Task | Files | Acceptance Criteria |
|---|------|-------|---------------------|
| 4.1 | Register mutation `AbortController`s in `apiClient` and cancel them in `abortRequests()`. | `erp_prototype/js/apiClient.js:151-155`, `erp_prototype/js/apiClient.js:208-216` | Navigating away cancels in-flight POST/PUT/DELETE. |
| 4.2 | Pass an immutable route context (`routeId`, `entity`, `view`, `recordId`) into `module.render()` instead of relying on global module fields. | `erp_prototype/js/app.js:581-698`, `erp_prototype/js/billing.js`, `erp_prototype/js/disbursement.js`, `erp_prototype/js/transmittal.js`, `erp_prototype/js/clients.js`, `erp_prototype/js/workflow.js` | Rapid navigation cannot render/mutate the wrong record. |
| 4.3 | Namespace persisted filters/group/sort by entity: `erp_filters_${module}_${entity}`. | `erp_prototype/js/app.js:810-865` | Switching ATA→LTA does not leak stale filters. |
| 4.4 | Broadcast entity switches and cache invalidations across tabs via `BroadcastChannel` (with `localStorage` fallback). | `erp_prototype/js/auth.js`, `erp_prototype/js/app.js:347-397` | All tabs stay on the same entity. |
| 4.5 | Shorten reference-cache TTL and invalidate on mutation. | `erp_prototype/js/apiClient.js:232-318` | Stale assignees/clients/work requests refetch quickly. |
| 4.6 | Add server-side sequential invoice/transmittal/disbursement number generation and stop client-side numbering. | `backend/src/modules/billing/service.js:88-132`, `backend/src/modules/transmittals/service.js`, `backend/src/modules/disbursements/service.js:33-45` | No duplicate numbers under concurrency. |
| 4.7 | Make Billing detail status transitions use optimistic updates + skip generation + rollback. | `erp_prototype/js/billing.js:2686`, `erp_prototype/js/billing.js:1528` | Status changes appear instantly and revert on failure. |
| 4.8 | Extract a shared `MutationLock` helper for skip-generation logic. | New `erp_prototype/js/mutationLock.js` | All modules use the same start/clear/shouldSkip API. |

### Phase 5 — Auth, RBAC, Audit, and Infrastructure Hardening
**Goal:** Protect confidentiality and availability under concurrent load.

| # | Task | Files | Acceptance Criteria |
|---|------|-------|---------------------|
| 5.1 | Reduce profile cache TTL to 60 s and invalidate on user/role/entity/department changes. | `backend/src/middleware/auth.js:14-16`, `backend/src/modules/admin/service.js` (user update/disable) | Revoked permissions take effect within one minute. |
| 5.2 | Fix RBAC on mutating routes. | `backend/src/modules/operationsRequests/routes.js:31,46,54`, `backend/src/modules/admin/routes.js:49-72` | Mutating endpoints require appropriate `edit`/`approve_change:*` permission. |
| 5.3 | Move audit logging into atomic transitions or use `logOrFail()`. | `backend/src/services/auditService.js:19-36`, `backend/src/middleware/audit.js:18-45` | State change + audit succeed/fail together; failed mutations are audited. |
| 5.4 | Add RLS policies as defense-in-depth for entity-scoped tables. | All entity-scoped migrations | Missing app filter cannot leak cross-tenant rows. |
| 5.5 | Increase Supabase HTTP keep-alive pool and configure `freeSocketTimeout`. | `backend/src/config/supabase.js:31-32` | No head-of-line blocking under 50-user burst. |
| 5.6 | Split rate limits and skip `/health`. | `backend/src/app.js:85-98` | Stricter for writes/auth, looser for reads; health checks always succeed. |
| 5.7 | Set `trust proxy` when deployed behind Render. | `backend/src/app.js:37` | Rate limits keyed by real client IP. |
| 5.8 | Sanitize audit/log error detail. | `backend/src/services/auditService.js:31-35` | No Supabase query fragments in logs. |

---

## 5. Module-by-Module P0 Tasks

### 5.1 Billing (`backend/src/modules/billing`, `erp_prototype/js/billing.js`)
- **B-1:** Wrap invoice create + line items in RPC (`service.js:88-166`).
- **B-2:** Replace `recordPayment` read-modify-write with atomic RPC (`service.js:331-398`).
- **B-3:** Add `version` to invoice updates and line-item replacement (`service.js:219-285`).
- **B-4:** Restrict status changes to workflow endpoints; add transition guards (`service.js:219-285`, detail view buttons).
- **B-5:** Server-side invoice number generation; remove client-side numbering (`utils.js:222-253`, `billing.js:1904-1928`).
- **B-6:** Add duplicate-submit guard and idempotency key (`billing.js:1930`, `billing.js:2590`).
- **B-7:** Make detail status transitions and board drag-and-drop optimistic with rollback (`billing.js:2686`, `billing.js:1528`).

### 5.2 Disbursements (`backend/src/modules/disbursements`, `erp_prototype/js/disbursement.js`)
- **D-1:** Convert `submit/approve/release/fund/reject` to atomic RPC (`service.js:454-502`, `service.js:507-585`).
- **D-2:** Add `UNIQUE(entity_id, disbursement_number)` and server-side sequence (`service.js:33-45`, migration).
- **D-3:** Add `version` and idempotency to `releaseDisbursement` (`service.js:536-552`).
- **D-4:** Remove `archived` from generic update schema or reject it (`service.js:312-374`, `routes.js:62-67`).
- **D-5:** Add duplicate-submit guard and idempotency key (`disbursement.js:2214`).
- **D-6:** Add rollback for bulk archive partial success (`disbursement.js:3705`).

### 5.3 Clients (`backend/src/modules/clients`, `erp_prototype/js/clients.js`)
- **C-1:** Replace TIN pre-check with unique-constraint catch (`service.js:220-228`).
- **C-2:** Wrap contact details / related companies upsert in RPC (`service.js:294-328`).
- **C-3:** Make archive/unarchive explicit; do not derive `deleted_at` from status in `updateClient` (`service.js:403-405`).
- **C-4:** Make client delete cascade atomic (`service.js:507-552`).
- **C-5:** Fix Clients archive to use `archive` endpoint instead of `DELETE` (`clients.js:1455`).
- **C-6:** Add rollback to `ClientsData.updateClient` (`clients.js:171`).
- **C-7:** Add duplicate-submit guard (`clients.js:1260`).

### 5.4 Transmittals (`backend/src/modules/transmittals`, `erp_prototype/js/transmittal.js`)
- **T-1:** Wrap transmittal create + items in RPC (`service.js:118-183`).
- **T-2:** Wrap update item replacement in transaction + version check (`service.js:227-282`).
- **T-3:** Convert `send/acknowledge/archive` to atomic transitions (`service.js:292-465`).
- **T-4:** Server-side tracking-number generation (`transmittal.js:630-642`).
- **T-5:** Add duplicate-submit guard and idempotency key (`transmittal.js:1407`, `transmittal.js:1564`).

### 5.5 Operations / Work Requests (`backend/src/modules/operations`, `erp_prototype/js/workflow.js`)
- **O-1:** Convert `updateWorkRequest` and `updateTask` to guarded updates (`service.js:341-385`, `service.js:582-617`).
- **O-2:** Stop full-field overwrite; only update supplied fields (`service.js:358-374`, `service.js:588-604`).
- **O-3:** Replace checklist delete+insert with upsert-by-id (`service.js:555-566`).
- **O-4:** Pass `AbortSignal` through `WorkflowData.loadPage()` (`workflow.js:244`).
- **O-5:** Fix `archiveWorkRequest` crash and route through safe merge path (`workflow.js:1774-1794`).

### 5.6 Documents (`backend/src/modules/documents`)
- **DC-1:** Add cleanup for stale `pending_upload` rows or require confirm-upload within TTL (`service.js:132-197`).
- **DC-2:** Delete storage object atomically with metadata soft-delete (`service.js:283-312`).
- **DC-3:** Normalize comments/versions or add merge/append semantics with locking (`service.js:235-273`).
- **DC-4:** Enforce lifecycle state machine (`service.js:469-502`).

### 5.7 Admin / Pending Approvals (`backend/src/modules/admin`)
- **A-1:** Convert `approvePending` to locking RPC (`service.js:464-493`).
- **A-2:** Add `requirePermission` to create/reject pending-approval endpoints (`routes.js:49-72`).
- **A-3:** Add service-level permission check inside `approvePending`.
- **A-4:** Add partial unique index to prevent duplicate pending changes per submitter/record.

### 5.8 Operations Requests (`backend/src/modules/operationsRequests`)
- **OR-1:** Add status guard to fulfillment update (`service.js:141-202`).
- **OR-2:** Add idempotency / duplicate-submission prevention (`service.js:61-101`).
- **OR-3:** Define and enforce status transition rules (`service.js:141-170`).
- **OR-4:** Fix getter to include `cancelled` status or use soft-delete column (`service.js:211-240`, `service.js:110-130`).

---

## 6. Verification Checklist

### Backend
- [ ] Two concurrent POSTs to create a disbursement with the same auto-generated number result in exactly one success (or one deterministic retry).
- [ ] Two managers click “Approve” on the same pending disbursement; only one succeeds, the other gets a 409.
- [ ] Two users edit the same invoice lines; the second save gets a 409 conflict dialog.
- [ ] Recording two payments concurrently cannot overpay the invoice.
- [ ] Approving a pending change twice creates only one side effect.
- [ ] Archiving a client atomically archives linked work requests and documents.
- [ ] Deleting a document removes the S3 object.
- [ ] Audit rows exist for every approve/release/fund/reject/archive and for failed 403/409 attempts.
- [ ] Revoking a user’s role or disabling the user takes effect within 60 seconds.
- [ ] A user without `workflow:edit` cannot POST/PUT/DELETE operations requests.

### Frontend
- [ ] Two tabs: changing entity in one tab updates the other tab’s entity and reloads the route.
- [ ] Submitting a form twice rapidly creates one record.
- [ ] Navigating away from a form cancels the in-flight mutation.
- [ ] Switching ATA→LTA clears or renames filters so stale filters do not hide data.
- [ ] Another user edits a record while I have it open; my save shows a conflict dialog.
- [ ] Archive/unarchive/delete actions are non-destructive and restorable.
- [ ] Sidebar/tab counts reflect server state within 30 seconds of any mutation.

---

## 7. Metrics of Success

- **Data-integrity incidents:** zero lost-update or duplicate-payment reports in the first 30 days of multi-user use.
- **Concurrent-edit conflicts:** 409 responses handled gracefully in UI for all core record types.
- **Audit completeness:** 100% of state-machine mutations have an audit row; failed sensitive mutations are also logged.
- **Latency p95:** API p95 stays under 500 ms for list/mutation endpoints under 50 concurrent users.
- **Cache freshness:** reference caches invalidated within 90 seconds of mutation; entity switches synced across tabs.

---

## 8. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Moving all multi-step writes to RPC is a large change. | Phase 0/1 focus only on the six highest-risk flows first; others follow. |
| Adding `version` requires frontend changes in every module. | Add `version` to responses first, then enforce on writes in a separate phase. |
| RLS policies may break existing service-role queries if misconfigured. | Test on a Supabase shadow/UAT project before applying to production. |
| Strict rate limits could lock out users behind shared proxies. | Use authenticated user ID as the rate-limit key; trust proxy settings on Render. |
| Audit `logOrFail` could make mutations fail under DB load. | Use an outbox table for audit events if synchronous audit becomes a bottleneck. |

---

## 9. Next Implementer Notes

- Start with **Phase 0** (migrations) and **Phase 1** (atomic RPC transitions). These have the biggest impact on data integrity.
- Do **not** change the frontend’s archive/cancel/trash generation logic until `TODO_ARCHIVE_FLOW_IMMEDIATE_FEEDBACK_FIX.md` is complete, because the skip-generation fixes there are prerequisites for the broader conflict/reconciliation work in Phase 4.
- Keep the existing `apiClient` request-deduplication and count-cache pattern; extend it rather than replace it.
- For every new RPC, add a backend Jest test that exercises the race condition (e.g., two concurrent approve calls).
- For every frontend conflict dialog, add a Playwright or smoke test that simulates a 409 response.
