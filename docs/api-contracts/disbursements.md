# Disbursements API Contract (v2 Redesign)

> **Owner**: Backend Team / Authorized Redesign Workstream
> **Status**: Authorized Redesign v2
> **Date**: 2026-10-20
>
> Downstream modules (Frontend Disbursements Module, P0-H Contract, Accounting & Admin Dashboards) depend on these contracts.

---

## 1. Authentication & Common Headers

All HTTP endpoints require:
- `Authorization: Bearer <supabase-jwt>`
- `X-Active-Entity: ATA|LTA` (or `ALL` for badge counters and list views where authorized)

### 1.1 Receipt Upload Entity Scoping (RECEIPT-ENTITY-20261021)
Receipt upload reservation (`POST /v1/disbursements/receipt-uploads`) and completion (`POST /v1/disbursements/receipt-uploads/:uploadId/complete`) routes require an explicit, canonical `X-Active-Entity: ATA|LTA` header matching the target work request.
- Submissions in consolidated `ALL` contexts with omitted or literal `ALL` headers return HTTP **400 `RECEIPT_ENTITY_REQUIRED`** before storage signing or database writes.
- Malformed entity headers are rejected with 400 `RECEIPT_ENTITY_REQUIRED` rather than falling back upstream.
- Single-entity user accounts with omitted header remain defaulted to their single authorized entity.
- Receipt claim during voucher creation executes atomically via database RPC `receipt_reservation_claim`.

All mutation requests on v2 vouchers require optimistic concurrency control (OCC) via `expectedVersion` (positive non-null integer).

All error responses conform to RFC 7807 `application/problem+json`:
```json
{
  "status": 403,
  "title": "Forbidden",
  "detail": "Permission disbursement:approve is required",
  "code": "FORBIDDEN"
}
```

---

## 2. Canonical Status Lifecycle (v2)

Disbursement records follow this deterministic lifecycle:
```
                ┌────────────────────────────────┐
                │        Creator (Any Staff)     │
                └───────────────┬────────────────┘
                                │ POST /v1/disbursements
                                ▼
                       ┌─────────────────┐
                       │      Draft      │◄───────────────────────────┐
                       │ review_ready: T │                            │
                       └────────┬────────┘                            │
                                │ POST /:id/approve                   │
                                │ (Admin only; non-self)              │
                                ▼                                     │
                       ┌─────────────────┐                            │
                       │    Approved     │                            │
                       └────────┬────────┘                            │
                                │ POST /:id/fund                      │
                                │ (Accounting/Admin; 4 payment fields)│
                                ▼                                     │
                       ┌─────────────────┐   POST /:id/resend_draft   │
                       │     Funded      ├────────────────────────────┤
                       └────────┬────────┘   (Admin only;             │
                                │             review_ready: false)    │
                                │ POST /:id/release                   │
                                │ (Admin only; preparer allowed)          │
                                ▼                                     │
                       ┌─────────────────┐                            │
                       │    Released     │                            │
                       └────────┬────────┘                            │
                                │ POST /:id/archive                   │
                                │ (Admin only)                        │
                                ▼                                     │
                       ┌─────────────────┐                            │
                       │    Archived     │                            │
                       │ archived: true  │                            │
                       └─────────────────┘                            │
                                                                      │
  Rejection Flow:                                                     │
  - From Draft or Funded: POST /:id/reject ──► [ Rejected ]          │
  - Resend Draft Flow:                                                │
    From Rejected: POST /:id/resend_draft ──────────────────┘
```

### 2.1 Governance Rules & Invariants
1. **Creation Routing**: All new v2 vouchers enter `status = 'Draft'` with `lifecycle_version = 2`, `review_ready = true`. Creation status is never role-dependent. Status forgery in creation payload returns HTTP `400 Bad Request`.
2. **Initial History**: Automatically recorded in `status_history` via database trigger in the creation transaction (`old_status: null, new_status: 'Draft', action: 'create'`).
3. **Admin Authority & Auditability**:
   - `Admin` may approve their own ready Draft request. A second Admin is not required for initial approval; attribution, version checks and audit history are still mandatory.
   - Admin may release a payment they prepared, including their own request. Existing Funded state, persisted instrument fields, expectedVersion, role/entity access and atomic history are still required.
4. **Funding Gate**: Strict `Accounting` role/department (or `Admin`). Management roles lacking explicit Accounting department membership cannot fund. Requires 4 payment fields: `method`, `bank`, `reference`, `date`.
5. **Rejection**: Allowed only from `Draft` and `Funded`. Forbidden from `Approved` or `Released`. Requires non-empty `reason` string (1-500 chars).
6. **Return for Correction (`POST /:id/resend_draft`)**: Transitions from `Rejected` back to `Draft` with `review_ready = false`. Clears previous approval/funding attribution. Actual edit (`PUT /:id`) with content changes flips `review_ready` back to `true`.
7. **Archival**: Archiving is a flag (`archived: true`), not a status. Only v2 `Released` vouchers can be archived.
8. **Financial Freeze**: Once `Approved`, financial fields are frozen. Only `Admin` may edit nonfinancial `print_details` on `Released` vouchers.
9. **Existing-record compatibility**: Previously saved test vouchers retain their saved status, amount, payment attribution and attachments. They remain viewable/printable and stay outside the new financial-action queues. There is no classification status, reconciliation endpoint or review tab. Create a new request to exercise the updated workflow.

---

## 3. Endpoints

### 3.1 Create Disbursement
- **Method**: `POST`
- **Path**: `/v1/disbursements`
- **Guard**: `disbursement:create`
- **Payload**:
```json
{
  "category": "Transportation",
  "description": "Travel expenses for client onsite visit",
  "amount": 2500,
  "fundSource": "Firm Fund",
  "clientId": "11111111-1111-1111-1111-111111111111",
  "linkedWorkRequestId": "33333333-3333-3333-3333-333333333333",
  "linkedTaskId": "44444444-4444-4444-4444-444444444444",
  "dueDate": "2026-10-31",
  "notes": "Original receipt submitted to admin"
}
```
- **Response (201 Created)**:
```json
{
  "data": {
    "id": "c1f54790-21a4-4f9e-a0e2-638bc93a8d11",
    "disbursement_number": "DISB-ATA-20261020-0001",
    "entity_id": "ent-ata",
    "entity_code": "ATA",
    "category": "Transportation",
    "description": "Travel expenses for client onsite visit",
    "amount": 2500,
    "fund_source": "Firm Fund",
    "status": "Draft",
    "lifecycle_version": 2,
    "review_ready": true,
    "archived": false,
    "version": 1,
    "created_at": "2026-10-20T01:00:00.000Z"
  }
}
```

---

### 3.2 Approve Disbursement
- **Method**: `POST`
- **Path**: `/v1/disbursements/:id/approve`
- **Guard**: `Admin` only (`disbursement:approve`)
- **Payload**:
```json
{
  "expectedVersion": 1
}
```
- **Response (200 OK)**: Returns updated voucher with `status = 'Approved'`, `version = 2`, `approved_by`, `approved_at`.

---

### 3.3 Fund Disbursement
- **Method**: `POST`
- **Path**: `/v1/disbursements/:id/fund`
- **Guard**: `Accounting` or `Admin` (`disbursement:fund`)
- **Payload**:
```json
{
  "expectedVersion": 2,
  "payment_method": "Bank Transfer",
  "payment_bank": "BDO Corporate",
  "payment_reference": "BDO-20261020-992",
  "payment_date": "2026-10-20"
}
```
*(Also accepts camelCase aliases: `paymentMethod`, `paymentBank`, `paymentReference`, `paymentDate`)*
- **Response (200 OK)**: Returns updated voucher with `status = 'Funded'`, `funded_by`, `funded_at`, and payment details.

---

### 3.4 Release Disbursement
- **Method**: `POST`
- **Path**: `/v1/disbursements/:id/release`
- **Guard**: `Admin` only (`disbursement:mark_released`)
- **Payload**:
```json
{
  "expectedVersion": 3
}
```
- **Response (200 OK)**: Returns updated voucher with `status = 'Released'`, `released_by`, `released_at`.

---

### 3.5 Reject Disbursement
- **Method**: `POST`
- **Path**: `/v1/disbursements/:id/reject`
- **Guard**: `Admin` only (`disbursement:approve`)
- **Payload**:
```json
{
  "expectedVersion": 1,
  "reason": "Missing supporting official receipt."
}
```
- **Response (200 OK)**: Returns updated voucher with `status = 'Rejected'`, `rejection_reason`, `rejected_by`, `rejected_at`.

---

### 3.6 Resend Draft (Return for Correction)
- **Method**: `POST`
- **Path**: `/v1/disbursements/:id/resend_draft`
- **Guard**: `Admin` only
- **Payload**:
```json
{
  "expectedVersion": 2,
  "reason": "Please attach complete breakdown of transportation items."
}
```
- **Response (200 OK)**: Returns updated voucher with `status = 'Draft'`, `review_ready = false`, and cleared approval/funding fields.

---

### 3.7 Archive & Unarchive
- **Method**: `POST`
- **Path**: `/v1/disbursements/:id/archive` and `/v1/disbursements/:id/unarchive`
- **Guard**: `Admin` only
- **Payload**:
```json
{
  "expectedVersion": 4,
  "reason": "Archived after fiscal year reconciliation."
}
```
- **Response (200 OK)**: Returns updated voucher with `archived = true` (or `false`), `archived_at`, `archived_by`.

---

### 3.8 Existing saved test vouchers

Existing records can be read and printed using the standard endpoints. No manual classification API is exposed. Their original saved values are preserved. New requests alone enter the current approval/payment queues; older saved records cannot accidentally be interpreted as a fresh payment awaiting release.

---

## 4. Work Queues & Queue Predicates

`GET /v1/disbursements?queue=<queue_name>` supports five server-side filtered queues:

1. `initial_requests`:
   - `lifecycle_version = 2 AND status = 'Draft' AND review_ready = true AND archived = false`
2. `ready_for_funding`:
   - `lifecycle_version = 2 AND status = 'Approved' AND archived = false`
3. `payment_releases`:
   - `lifecycle_version = 2 AND status = 'Funded' AND archived = false`
4. `needs_correction`:
   - `lifecycle_version = 2 AND status = 'Draft' AND review_ready = false AND archived = false`


`GET /v1/disbursements/counts` returns counts for all five queues plus status totals.
