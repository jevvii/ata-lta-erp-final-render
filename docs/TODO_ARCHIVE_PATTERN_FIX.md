# Archive Pattern Fix — Implementation Hand-off

**Date:** 2026-07-21  
**Branch:** `uat`  
**Status:** Root causes identified via dynamic workflow; implementation queued for the next agent  
**Approach:** Dynamic workflow investigation. No Playwright. No commits without team coordination.

---

## 1. Executive Summary

The five primary ERP modules — **Clients, Operations, Billing, Disbursements, and Transmittals** — all have some form of soft-delete, but the *archive* semantics are inconsistent and several modules cannot actually archive/unarchive records. The most visible symptoms are:

1. **Archived items remain on the active page** (Operations archive is frontend-only; billing/disbursement optimistic updates can be overwritten by background refresh; clients unarchive is broken because archived rows also get `deleted_at` set).
2. **Archived items do not appear on a dedicated archive page** (Clients archive view is empty because of the `deleted_at` filter; Transmittals has no archive endpoints or tab; Documents has no archive UI at all).
3. **Navigation badges and counts do not update immediately** because they are derived from client-side filtering and are not invalidated/re-fetched from authoritative `/counts` endpoints after mutations.
4. **There is no immediate visual feedback** in some paths, and the UI still labels soft-deletes as “Permanently Delete” even though every module now uses `deleted_at`.

This document hands off the exact fix to the next agent. It supersedes the archive-specific portions of `docs/CHECKPOINT_ENTITY_NAV_ARCHIVE.md` and `docs/TODO_BILLING_DISBURSEMENT_TRANSMITTAL_PATTERN_PROPAGATION.md` for the scope described here.

---

## 2. Root-Cause Summary

Investigation used a dynamic workflow that read the backend service/controller/routes and frontend JS for every module. The root causes are:

1. **Inconsistent archive representation.**
   - `clients` uses `status='Archived'` **plus** `deleted_at`.
   - `operations` has no `archived` column; the frontend sends `{ archived: true }` but `updateWorkRequest` ignores it.
   - `billing` / `disbursements` use an `archived` boolean plus `deleted_at` only on delete.
   - `transmittals` has an `archived` boolean and a `/counts` endpoint, but no archive/unarchive route.
   - `documents` has an `archived` boolean but no archive UI or endpoint.

2. **No dedicated archive/unarchive toggle endpoints.**
   - Archive is currently forced through generic `PUT /:id` or `DELETE /:id` with the wrong validation:
     - `disbursements` rejects non-Draft edits, so `{ archived: true }` on a Funded disbursement fails.
     - `clients` unarchive fails because `getClientById` filters `deleted_at IS NULL`.
     - `operations` simply does not persist `archived`.
     - `transmittals` and `documents` have no endpoint at all.

3. **List/get filters mix soft-delete with archive state.**
   - `clients` always applies `.is('deleted_at', null)`, so archived rows vanish from the archive view and cannot be restored.
   - `billing` returns archived/cancelled rows by default, relying on the frontend to filter them out.
   - `documents` drops archived records client-side but has no archive view.

4. **Frontend counts are client-side only and race with background refresh.**
   - Badges are computed from in-memory filters, not from authoritative `/counts`.
   - Optimistic `archived=true` flags are overwritten by `Object.assign`/background merges when the server row still returns `archived=false`.

---

## 3. Module-by-Module Implementation Plan

Complete the modules in the order below. Each phase should be finished and verified before moving on.

### Phase 0 — Shared foundation (do first)

1. **Standardize the meaning of “archive”.**
   - An **archived** record is still visible in the *Archive* tab and is restorable.
   - A **soft-deleted / trashed** record is an archived record that may also have `deleted_at` set, but it must still be restorable from the Archive tab (except Documents storage, see Phase 5).
   - No primary DB row should ever be `DELETE`d; all `DELETE` endpoints must continue to set `deleted_at`.

2. **Add dedicated archive/unarchive routes to every module that needs them.**
   - Pattern:
     ```
     POST /v1/:module/:id/archive
     POST /v1/:module/:id/unarchive
     ```
   - Each route calls a service method that only flips the archive state and logs a `module.archive` / `module.unarchive` audit action.

3. **Add or fix `/counts` endpoints** so the frontend can show authoritative active/archive/rejected counts.
   - Use targeted Supabase `.select('*', { count: 'exact', head: true })` queries, not in-memory filtering of full tables.

---

### Phase 1 — Disbursements (P0)

**Why first:** archive/unarchive is the most broken here because the update schema rejects non-Draft edits.

| # | Change | File | Notes |
|---|--------|------|-------|
| 1.1 | Add `archived: z.boolean().optional()` to `updateDisbursementSchema`. | `backend/src/modules/disbursements/schema.js:47` | Currently the schema is `createDisbursementSchema.partial()` and does not include `archived`. |
| 1.2 | Remove/relax the unconditional `existing.status !== 'Draft'` guard in `updateDisbursement`; apply `data.archived` when provided. | `backend/src/modules/disbursements/service.js:314-358` | Archive should work on `Funded` records; only *content* edits should stay Draft-only. |
| 1.3 | Ensure `_optimisticUpdate` keeps the `archived` flag and only rolls back on real API failure. | `erp_prototype/js/disbursement.js:631-666` | Make sure the skip-generation covers the async API window and background merges do not wipe the optimistic flag. |
| 1.4 | Update the board/card delete action to use archive semantics (or rename the label). | `erp_prototype/js/disbursement.js:1747`, `2600` | Currently triggers `archiveDisbursement` or `permanentDeleteDisbursement`. Keep soft-delete behavior, fix labels. |

**Verification:**
- Create a Funded disbursement, click Archive → card disappears from active board, active badge decrements, archive badge increments.
- Refresh → archived row is still in the Archive tab.
- Click Unarchive → row returns to active board, archive badge decrements.

---

### Phase 2 — Clients (P0)

**Why first:** unarchive is currently impossible because `getClientById` filters out `deleted_at` rows.

| # | Change | File | Notes |
|---|--------|------|-------|
| 2.1 | Make `.is('deleted_at', null)` conditional in `listClients`: omit it when `filters.archived === true` or `status === 'Archived'`. | `backend/src/modules/clients/service.js:127-148` | Otherwise the archive view returns nothing. |
| 2.2 | Add an `includeArchived` option to `getClientById` and use it from `updateClient`. | `backend/src/modules/clients/service.js:331`, `374-375` | `updateClient` must be able to find a soft-deleted row so it can restore it. |
| 2.3 | Populate the archive cache or fetch archived rows in the frontend for the archive view and badge. | `erp_prototype/js/clients.js:380-385`, `1663-1672` | `getClientCounts()` currently counts from `ClientsData.getAllClients()`, which only loads active rows. |
| 2.4 | Make sure archive/unarchive call the new dedicated endpoints (Phase 0) instead of generic `remove`/`update` when possible, or fix the current paths. | `erp_prototype/js/clients.js:1404-1660` | If dedicated endpoints are not added yet, at minimum fix `updateClient` to see archived rows. |

**Verification:**
- Archive a client → row disappears from Active Clients immediately; archive badge increments.
- Open Archive tab → client is listed.
- Click Restore → client returns to Active Clients, archive badge decrements.

---

### Phase 3 — Operations / Work Requests (P0)

**Why first:** archive is currently frontend-only; after refresh the work request reappears in active.

| # | Change | File | Notes |
|---|--------|------|-------|
| 3.1 | Add `archived BOOLEAN DEFAULT FALSE` column to `work_requests`. | New migration or `backend/migrations/000010_create_work_requests.js` | The frontend already expects `wr.archived`. |
| 3.2 | Add `archived: z.boolean().optional()` to `updateWorkRequestSchema`. | `backend/src/modules/operations/schema.js:37` |  |
| 3.3 | Persist `data.archived` in `updateWorkRequest` and return it from `toApiWorkRequest` / `listWorkRequests`. | `backend/src/modules/operations/service.js:339-381` |  |
| 3.4 | Preserve the local `archived` flag when the server record omits it in `WorkflowData.normalizeWorkRequest`. | `erp_prototype/js/workflow.js:301-314` | Do not overwrite existing `.archived` with normalized `false`. |
| 3.5 | Use the new `/work-requests/counts` endpoint (or an existing one) for tab badges and invalidate after mutations. | `erp_prototype/js/workflow.js:3412-3451` |  |

**Verification:**
- Archive a Completed work request → row disappears from active, archive badge increments.
- Refresh → row remains in Archive tab and does not reappear in Active.
- Unarchive → row returns to active.

---

### Phase 4 — Transmittals (P0)

**Why first:** there is no archive function at all; the archive tab is hidden.

| # | Change | File | Notes |
|---|--------|------|-------|
| 4.1 | Add `POST /:id/archive` and `POST /:id/unarchive` routes. | `backend/src/modules/transmittals/routes.js` | Place after the existing `/` routes, before `/:id`. |
| 4.2 | Add controller methods and service methods. | `backend/src/modules/transmittals/controller.js`, `service.js` | Only allow archive when `status='Acknowledged'`. Audit `transmittal.archive` / `transmittal.unarchive`. |
| 4.3 | Unstub the archive helpers in the frontend and enable the archive tab. | `erp_prototype/js/transmittal.js:2304-2306`, `440-443`, `387-391` | Remove the redirect from `#transmittal/archive` back to `#transmittal`. |
| 4.4 | Render the archive page using `renderArchive()` and wire unarchive actions. | `erp_prototype/js/transmittal.js` |  |
| 4.5 | Add `/counts` invalidation after send/acknowledge/archive/unarchive/delete. | `erp_prototype/js/transmittal.js` |  |

**Verification:**
- Acknowledge a transmittal, click Archive → it moves to Archive tab and view.
- Unarchive → returns to Active.
- Send/acknowledge update badges immediately.

---

### Phase 5 — Documents / DMS (P1)

| # | Change | File | Notes |
|---|--------|------|-------|
| 5.1 | Add `POST /:id/archive` and `POST /:id/unarchive` routes. | `backend/src/modules/documents/routes.js` |  |
| 5.2 | Implement `archiveDocument` service method near `updateDocument`. | `backend/src/modules/documents/service.js` | Flip the `archived` boolean only. |
| 5.3 | Add `GET /counts` route and `countDocuments` service method. | `backend/src/modules/documents/controller.js`, `service.js` | Use targeted count queries. |
| 5.4 | Add archive action buttons, an Archive tab/view, and pass `archived=true|false` query params in the DMS list. | `erp_prototype/js/dms.js` |  |
| 5.5 | Make document deletion non-destructive to storage. | `backend/src/modules/documents/service.js:273-302` | Do **not** call `deleteObject` on soft-delete. Either keep the file or move it to an archive S3 prefix so restoration keeps the download link. |

**Verification:**
- Archive a document → disappears from active, appears in Archive view, badge updates.
- Soft-delete a document → restore it → download URL still works and the file is still in storage.

---

### Phase 6 — Billing active-list hardening (P1)

| # | Change | File | Notes |
|---|--------|------|-------|
| 6.1 | Make `listInvoices` exclude archived/cancelled rows when `archived` is false or undefined. | `backend/src/modules/billing/service.js:27-47` | Active list should not rely only on frontend filtering. |
| 6.2 | Pass `archived: false` from the active-list fetch. | `erp_prototype/js/billing.js:61-64` | `_loadInvoices` currently fetches all rows. |
| 6.3 | Protect optimistic archive/trash from background refresh races. | `erp_prototype/js/billing.js:86-93`, `4039-4334` | Abort or ignore stale background fetches; merge server data defensively so `archived=true` is not overwritten. |

**Verification:**
- Archive a Paid invoice → active list no longer includes it.
- Call `GET /v1/invoices` without `archived` → archived row is not returned.
- Call `GET /v1/invoices?archived=true` → archived row is returned.

---

### Phase 7 — Navigation badge counts (P1)

| # | Change | File | Notes |
|---|--------|------|-------|
| 7.1 | Consume the `/counts` endpoint for Clients archive badge. | `erp_prototype/js/clients.js:380-426` | Currently counts only from rejected items + stale active cache. |
| 7.2 | Consume the `/work-requests/counts` endpoint for Operations. | `erp_prototype/js/workflow.js:3412-3451` | Refresh after every mutation. |
| 7.3 | Display the computed archive count in Transmittals once the archive tab is enabled. | `erp_prototype/js/transmittal.js:406-443` |  |
| 7.4 | Keep Disbursement counts derived from local cache, but re-derive after every mutation and after `/counts` invalidation. | `erp_prototype/js/disbursement.js` | Already mostly done; verify consistency. |

**Verification:**
- Archive/unarchive items and observe the tab badges match the backend `/counts` response immediately after the API call completes.

---

### Phase 8 — Standardize archive toggle endpoints everywhere (P2)

After the P0/P1 fixes are stable, move all frontend archive/unarchive handlers to the dedicated endpoints added in Phase 0.

| Module | Files |
|--------|-------|
| Clients | `erp_prototype/js/clients.js` |
| Operations | `erp_prototype/js/workflow.js` |
| Billing | `erp_prototype/js/billing.js` |
| Disbursements | `erp_prototype/js/disbursement.js` |
| Transmittals | `erp_prototype/js/transmittal.js` |
| Documents | `erp_prototype/js/dms.js` |

Also update backend routes:
- `backend/src/modules/clients/routes.js`
- `backend/src/modules/operations/routes.js`
- `backend/src/modules/billing/routes.js`
- `backend/src/modules/disbursements/routes.js`
- `backend/src/modules/transmittals/routes.js`
- `backend/src/modules/documents/routes.js`

**Verification:**
- All archive/unarchive actions use a single, explicit endpoint.
- Integration tests cover archive/unarchive round-trips and `/counts` accuracy for every module.

---

## 4. Cross-Cutting Rules for the Next Agent

1. **No hard deletes of primary rows.** All `DELETE` endpoints must continue to set `deleted_at`.
2. **Rename misleading UI labels.** Change “Permanently Delete” to “Delete” / “Move to Trash” where the backend is only soft-deleting. If a module has both archive and delete, make the distinction clear:
   - **Archive** = hide from active, keep restorable.
   - **Delete/Trash** = soft-delete, restorable from Archive/Trash.
3. **Optimistic updates must:**
   - Mutate the local cache **before** the API call.
   - Start a skip-generation so in-flight background fetches do not overwrite the mutation.
   - Roll back only on real API failure.
   - Invalidate `/counts` and re-render after success.
4. **Counts must be authoritative.** Derive badges from the same backend `/counts` endpoint after mutations, or at least recompute from the local cache immediately and refresh from the backend within the same mutation flow.
5. **Preserve entity scoping.** Active/Archive filters and counts must respect `Auth.activeEntity` (`ATA` / `LTA` / `ALL`).
6. **Do not introduce new frameworks.** Keep the existing global-variable SPA architecture (`window.*` modules).

---

## 5. Verification Checklist

### Manual end-to-end (every module)

1. Create a record.
2. Archive it → confirm it disappears from the active list/board and the archive badge increments.
3. Switch to the Archive tab/view → confirm the record is listed.
4. Refresh the browser → confirm the record is still in Archive and not in Active.
5. Unarchive → confirm it returns to Active and the archive badge decrements.
6. Delete/Trash → confirm it moves to Archive (not permanently removed) and is restorable.
7. Repeat under `ATA`, `LTA`, and `ALL` views.

### Static / automated

- [ ] `node --check erp_prototype/js/clients.js`
- [ ] `node --check erp_prototype/js/workflow.js`
- [ ] `node --check erp_prototype/js/billing.js`
- [ ] `node --check erp_prototype/js/disbursement.js`
- [ ] `node --check erp_prototype/js/transmittal.js`
- [ ] `node --check erp_prototype/js/dms.js`
- [ ] `cd backend && PORT=0 npm test`
- [ ] Add integration tests for archive/unarchive round-trips and `/counts` accuracy for each module.

---

## 6. Notes

- **Do not use Playwright** unless explicitly requested. Rely on `node --check`, backend tests, and manual browser verification.
- **No commits** unless explicitly asked. The `uat` branch has uncommitted changes; coordinate with the team before committing/pushing.
- This plan was produced by a dynamic workflow that read every relevant backend service/controller/route and frontend JS module. The file references and line numbers are approximate; verify them before editing because the `uat` branch may have shifted since this hand-off was written.
- Reference implementations:
  - `erp_prototype/js/workflow.js` — good optimistic update and count-from-cache pattern.
  - `backend/src/modules/billing/service.js` — good entity-code mapping for list/create/get.

---

*End of hand-off.*
