# Billing & Disbursement — Propagate Transmittal Creation Persistence Pattern

**Date:** 2026-07-20  
**Branch:** `uat`  
**Status:** Root causes identified; implementation queued for next agents  
**Approach:** Dynamic workflow only. No Playwright. No commits.

---

## 1. Executive Summary

The **Transmittal** module has a stable creation flow:

- New transmittals appear instantly in the list.
- They remain visible after view-mode switches, page revisits, and hard refreshes.
- Related pickers and downstream forms stay synchronized.

**Billing** and **Disbursement** already copied Transmittal's *client-side* optimistic-create plumbing (temp IDs, skip-fetch generations, in-memory cache, modal-then-API ordering), but a **data-shape mismatch** remains: the backend returns `entity_id` (UUID), the list filter expects the entity *code* (`ATA`/`LTA`), and the frontend normalizers do not fall back to the active entity code the way `Transmittal.normalizeTransmittal()` does.

Result:

- The **optimistic** record (created before the API call) has the correct entity code, so it appears instantly.
- After the server responds, the optimistic record is replaced by the **server** record whose `entity` field becomes a UUID (Billing) or `null` (Disbursement).
- The list filter removes that record, so it disappears when the confirmation modal closes / on view switch / on revisit.
- The row is safely in the DB (`SELECT * FROM invoices` / `SELECT * FROM disbursements` shows it), but the UI never renders it again.

This document hands off the exact fix to the next agents.

---

## 2. Working Reference Pattern — Transmittal

### 2.1 Backend: always expose `entity_code`

In `backend/src/modules/transmittals/service.js`:

```js
// listTransmittals — joins entities(id, code) and maps entity_id -> entity_code
const { data: entitiesData } = rows.length
  ? await supabaseAdmin.from('entities').select('id, code')
  : { data: [] };
const entityCodeMap = new Map((entitiesData || []).map((e) => [e.id, e.code]));

const mapped = rows.map((row) => ({
  ...row,
  entity_code: entityCodeMap.get(row.entity_id) || row.entity_id,
}));
return { data: mapped, count: count || 0 };
```

### 2.2 Frontend: normalize with active-entity fallback

In `erp_prototype/js/transmittal.js`:

```js
normalizeTransmittal(t, entityCodeHint) {
  const entity = entityCodeHint
    || t.entityCode
    || t.entity_code
    || t.entity
    || this._entityCodeFromId(t.entity_id)
    || Auth.activeEntity;
  // ...
},

_entityCodeFromId(entityId) {
  if (!entityId) return null;
  return Auth.activeEntity !== 'ALL' ? Auth.activeEntity : null;
}
```

This guarantees that even when a single-record endpoint (`create`, `getById`) omits `entity_code`, the cached record still carries a usable entity code.

### 2.3 List filter uses the code

```js
_isActiveInvoice(inv, entity) {
  return this._entityMatches(inv?.entity, entity) && ...;
}
```

With the correct code on `inv.entity`, the record survives every subsequent render.

---

## 3. Root-Cause Analysis — Billing

### 3.1 Symptom

New invoice appears after creation, then disappears after the confirmation modal / view switch / revisit. `SELECT * FROM invoices` shows the row.

### 3.2 Root cause A — Backend does not return `entity_code`

`backend/src/modules/billing/service.js`:

- `listInvoices()` selects `*, clients!inner(name)` but never joins `entities(code)` or maps `entity_id` → `entity_code`.
- `createInvoice()` returns `{ ...invoice, line_items: lineItems }` with only `entity_id` (UUID).
- `getInvoiceById()` also returns only `entity_id`.

### 3.3 Root cause B — Frontend maps UUID onto `entity`

`erp_prototype/js/billing.js:632`:

```js
entity: doc.entity_id || doc.entity,
```

Because the backend returns `entity_id` as a UUID, every server-fetched invoice stores `entity: '<uuid>'`.

### 3.4 Root cause C — List filter expects a code

`erp_prototype/js/billing.js:31-43`:

```js
_entityMatches(invEntity, entity) {
  const u = (invEntity || '').toUpperCase();
  if (entity === 'ALL') {
    return Auth.user?.entities?.map(e => e.toUpperCase()).includes(u) || false;
  }
  return u === (entity || '').toUpperCase();
}
```

A UUID is not `ATA`/`LTA`, so `_isActiveInvoice()` and `_isArchiveInvoice()` return `false` for every server-backed record.

### 3.5 Root cause D — Modal close invalidates the cache before the API returns

`erp_prototype/js/billing.js:2013`:

```js
await closeFormPanelAndRoute(targetRoute, msgConfig);
```

`closeFormPanelAndRoute()` calls `triggerSyncReload()` (`erp_prototype/js/utils.js:2053-2109`), which invalidates `Billing._listCache` and resets skip generations. The optimistic record (with the correct code) is flushed, a fresh server fetch runs, and the server records it returns are immediately filtered out because of Root Causes B+C.

---

## 4. Root-Cause Analysis — Disbursement

### 4.1 Symptom

New disbursement appears after creation, then disappears after the confirmation modal / view switch / revisit. `SELECT * FROM disbursements` shows the row.

### 4.2 Root cause A — Backend does not return `entity_code`

`backend/src/modules/disbursements/service.js`:

- `listDisbursements()` selects `*, clients(name)` but never joins `entities(code)` or maps `entity_id` → `entity_code`.
- `createDisbursement()` returns the inserted row with only `entity_id` (UUID).
- `getDisbursementById()` also returns only `entity_id`.

### 4.3 Root cause B — Frontend normalization has no active-entity fallback

`erp_prototype/js/disbursement.js:176`:

```js
entity: d.entity_code || d.entity || null,
```

When the backend omits `entity_code` and `entity`, the normalized `entity` becomes `null`.

### 4.4 Root cause C — List filter drops null entities

`erp_prototype/js/disbursement.js:1302`:

```js
let items = allItems.filter(d => (entity === 'ALL'
  ? Auth.user.entities.includes(d.entity)
  : d.entity === entity));
```

Records with `entity: null` never pass this filter.

### 4.5 Root cause D — Modal close invalidates the cache before the API returns

Same as Billing: `closeFormPanelAndRoute()` at `erp_prototype/js/disbursement.js:2236` flushes the optimistic record and triggers a server fetch before `disbursements.create()` resolves.

---

## 5. Implementation Plan

### Phase 1 — Billing Backend

In `backend/src/modules/billing/service.js`:

- [ ] In `listInvoices()`, after fetching rows, load `entities(id, code)` and map each row to include `entity_code` (mirror `transmittals/service.js:55-63`).
- [ ] In `createInvoice()`, include the entity code in the returned object. Either:
  - join `entities(code)` in the insert-select, or
  - accept an `entityCode` parameter and return `{ ...invoice, entity_code: entityCode, line_items: lineItems }`.
- [ ] In `getInvoiceById()`, similarly attach `entity_code` to the returned object.
- [ ] Update any billing backend tests that assert response shape.

### Phase 2 — Billing Frontend

In `erp_prototype/js/billing.js`:

- [ ] Add an `_entityCodeFromId(entityId)` helper (or import/share Transmittal's) that returns `Auth.activeEntity` when not `ALL`.
- [ ] Change `normalizeInvoice()` line 632 to:
  ```js
  entity: doc.entity_code || doc.entity_code || doc.entity || this._entityCodeFromId(doc.entity_id) || Auth.activeEntity,
  ```
  (Keep `doc.entity_id` stored separately as `entityId` if needed; do not use the UUID as the list-filter `entity`.)
- [ ] Ensure `_isActiveInvoice()` / `_isArchiveInvoice()` still receive a code.
- [ ] Verify `_addToListCache()` and `_replaceInListCache()` preserve the corrected `entity` field.

### Phase 3 — Disbursement Backend

In `backend/src/modules/disbursements/service.js`:

- [ ] In `listDisbursements()`, load `entities(id, code)` and map rows to include `entity_code` (mirror transmittals).
- [ ] In `createDisbursement()`, return `{ ...disbursement, entity_code: entityCode }`.
- [ ] In `getDisbursementById()`, attach `entity_code`.
- [ ] Update backend tests if needed.

### Phase 4 — Disbursement Frontend

In `erp_prototype/js/disbursement.js`:

- [ ] Add an `_entityCodeFromId(entityId)` helper.
- [ ] Change `normalizeDisbursement()` line 176 to:
  ```js
  entity: d.entity_code || d.entity || this._entityCodeFromId(d.entity_id) || Auth.activeEntity,
  ```
- [ ] Verify the list filter at line 1302 receives a code.
- [ ] Verify `_addOptimisticDisbursement()` / `_replaceOptimisticCreate()` preserve the corrected `entity`.

### Phase 5 — Harden the modal-close / cache-invalidation timing

Both Billing and Disbursement already `await closeFormPanelAndRoute(...)` before the API call. That utility still invalidates caches through `triggerSyncReload`. The fix above (correct `entity` on every server record) makes the post-modal server fetch return visible records. Optionally, next agents may also:

- [ ] Consider suppressing the cross-module cache invalidation for the creating module itself during an active skip generation, so the optimistic record is not flushed before the API responds. This is a polish step, not the root cause.
- [ ] If implemented, ensure it does not break related-picker synchronization.

### Phase 6 — Cascading synchronization

- [ ] Verify `Billing._invalidateRelatedCaches()` (`erp_prototype/js/billing.js:200-230`) and `Disbursement` equivalent still patch `window.apiClient.workRequestCache` and `WorkflowData` so linked invoice/disbursement IDs appear in Operations forms.
- [ ] Verify `Dashboard.invalidateCache()` is triggered on creation.
- [ ] Verify work-request dropdowns in new Billing and Disbursement forms show the latest state.

---

## 6. Files to Modify

| File | Why |
|---|---|
| `backend/src/modules/billing/service.js` | Return `entity_code` for invoices in list/create/get. |
| `backend/src/modules/disbursements/service.js` | Return `entity_code` for disbursements in list/create/get. |
| `erp_prototype/js/billing.js` | Normalize `entity` from `entity_code` / active entity, not UUID. |
| `erp_prototype/js/disbursement.js` | Normalize `entity` from `entity_code` / active entity, not `null`. |
| `erp_prototype/js/transmittal.js` | Reference only; verify the pattern is preserved. |
| `backend/tests/integration/billing.test.js` | Update if response-shape assertions break. |
| `backend/tests/integration/disbursements.test.js` | Update if response-shape assertions break. |

---

## 7. Verification Checklist

### Manual end-to-end (Billing, Disbursement, Transmittal)

1. Create a new record.
2. Confirm it appears instantly in the active list/table/board view.
3. Click it and confirm routing to detail works.
4. Switch view modes (table ↔ board ↔ compact list) and confirm the item remains.
5. Navigate to another module and back; confirm the item remains.
6. Refresh the browser; confirm the item remains.
7. Open a related form and confirm the parent work request shows the new child record.
8. Repeat under `ALL` consolidated view and under each single entity.
9. Throttle the network; confirm the optimistic record stays visible until the server responds.

### Static / automated

- [ ] `node --check erp_prototype/js/billing.js`
- [ ] `node --check erp_prototype/js/disbursement.js`
- [ ] `node --check erp_prototype/js/transmittal.js`
- [ ] `cd backend && PORT=0 npx jest tests/integration/billing.test.js --runInBand`
- [ ] `cd backend && PORT=0 npx jest tests/integration/disbursements.test.js --runInBand`
- [ ] If shared service logic changes, run the full backend suite: `cd backend && PORT=0 npm test`.

### Edge cases

- [ ] Create under `ALL` view; record appears and remains visible when switching to owning single entity.
- [ ] Create with null optional fields; record still appears.
- [ ] Rapidly create two records; both appear and skip generations are handled.
- [ ] Background refresh race: server record returned before optimistic replacement; no duplicates.

---

## 8. Notes for Next Agents

1. **Stay within the existing architecture.** No new frameworks or dependencies.
2. **Do not use Playwright** unless explicitly requested. Rely on `node --check`, backend tests, and manual browser verification.
3. **Do not commit yet.** The `uat` branch has uncommitted changes; coordinate with the team before committing/pushing.
4. **The root cause is entity-code normalization, not the optimistic-create pattern itself.** Billing and Disbursement already have the temp-ID / skip-generation / cache plumbing. The missing piece is making every server-backed record carry the entity *code* that the list filter expects.
5. **Mirror Transmittal exactly.** If in doubt, copy the backend `entities(id, code)` join and the frontend `entityCodeHint || entity_code || entity || _entityCodeFromId(entity_id) || Auth.activeEntity` fallback chain.
6. **Keep `entityId` separate from `entity`.** Store the UUID in `entityId` for API calls, but use the code in `entity` for UI filtering and display.
7. **Preserve paginated endpoints.** Do not remove `fetchInvoices()` / `fetchDisbursements()` / paginated server routes; just ensure the active list no longer depends on them as its primary source.

---

## 9. Definition of Done

- [ ] Billing invoice creation behaves like Transmittal: instant feedback, persistent across view switches and page revisits, correct detail routing, DB persistence.
- [ ] Disbursement expense creation behaves the same way.
- [ ] Server-fetched invoices and disbursements have `entity` set to `ATA`/`LTA` (or the active entity code), never a UUID or `null`.
- [ ] Newly created records appear immediately in related form pickers/dropdowns.
- [ ] No regressions in edit, archive, approve, template, or pending-approval flows.
- [ ] All modified frontend files pass `node --check`.
- [ ] Backend tests for billing and disbursements pass.
- [ ] Manual browser verification confirms the checklist in §7.

---

*End of hand-off. No Playwright expected. No commits without team coordination.*
