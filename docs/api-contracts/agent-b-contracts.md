# Agent B API Contracts

All endpoints require `Authorization: Bearer <jwt>` and `X-Active-Entity: ATA|LTA` headers.

---

## Phase 3 — Documents / DMS

### `GET /v1/documents`
**Permission:** `dms:view`  
**Query:** `?category=&status=&lifecycle=&clientId=&workRequestId=&search=&archived=&page=1&limit=50`  
**Response:** `{ data: Document[], meta: { total, page, limit } }`

### `POST /v1/documents`
**Permission:** `dms:edit`  
**Body:**
```json
{
  "fileName": "contract.pdf",
  "contentType": "application/pdf",
  "fileSize": 102400,
  "clientId": "uuid",
  "category": "CONTRACT",
  "description": "Service agreement"
}
```
**Response (201):** `{ data: { document: Document, uploadUrl: "https://s3..." } }`

### `GET /v1/documents/:id`
**Permission:** `dms:view`  
**Response:** `{ data: Document }`

### `PUT /v1/documents/:id`
**Permission:** `dms:edit`  
**Body:** Partial document metadata  
**Response:** `{ data: Document }`

### `DELETE /v1/documents/:id`
**Permission:** `dms:delete`  
**Response:** `204 No Content`

### `POST /v1/documents/:id/confirm-upload`
**Permission:** `dms:edit`  
**Response:** `{ data: Document }`

### `GET /v1/documents/:id/download-url`
**Permission:** `dms:view`  
**Response:** `{ data: { url: "https://...", fileName: "file.pdf" } }`

### `PUT /v1/documents/:id/lifecycle`
**Permission:** `dms:handover`  
**Body:** `{ "lifecycle": "scanned" }`  
**Response:** `{ data: Document }`

---

## Phase 5 — Billing / Invoices

### `GET /v1/invoices`
**Permission:** `billing:view`  
**Query:** `?status=&clientId=&search=&page=1&limit=50`  
**Response:** `{ data: Invoice[], meta: { total, page, limit } }`

### `POST /v1/invoices`
**Permission:** `billing:edit`  
**Body:**
```json
{
  "clientId": "uuid",
  "invoiceNumber": "INV-ATA-2026-001",
  "issueDate": "2026-07-01",
  "dueDate": "2026-08-01",
  "lineItems": [
    { "description": "Monthly retainer", "amount": 15000, "type": "Professional Fee" }
  ],
  "notes": "For July 2026 services"
}
```
**Response (201):** `{ data: Invoice }`

### `POST /v1/invoices/:id/payments`
**Permission:** `billing:payments`  
**Body:**
```json
{
  "amount": 10000,
  "method": "Bank Transfer",
  "reference": "REF-123",
  "date": "2026-07-15"
}
```
**Response (201):** `{ data: Payment }`

### `GET /v1/invoices/:id/pdf`
**Permission:** `billing:view`  
**Response:** `{ data: { url: "https://..." } }`

### `GET /v1/invoices/:id/voucher`
**Permission:** `billing:view`  
**Response:** `{ data: { url: "https://..." } }`

### `GET /v1/invoices/aging`
**Permission:** `billing:view`  
**Response:** `{ data: { summary: {...}, buckets: {...} } }`

### Templates: `GET|POST /v1/invoices/templates`, `PUT|DELETE /v1/invoices/templates/:id`

---

## Phase 6 — Disbursements

### `GET /v1/disbursements`
**Permission:** `disbursement:view`  
**Query:** `?status=&category=&fundSource=&search=&page=1&limit=50`

### `POST /v1/disbursements`
**Permission:** `disbursement:create`  
**Body:**
```json
{
  "category": "Professional Fee",
  "description": "BIR filing fee",
  "amount": 500,
  "fundSource": "Client Fund",
  "clientId": "uuid"
}
```

### Workflow Actions
- `POST /v1/disbursements/:id/submit` — Draft → Pending
- `POST /v1/disbursements/:id/approve` — Pending → Approved
- `POST /v1/disbursements/:id/release` — Approved → Released (body: payment details)
- `POST /v1/disbursements/:id/reject` — Pending/Approved → Rejected (body: `{ "reason": "..." }`)

---

## Phase 6b — Transmittals

### `GET /v1/transmittals`
**Permission:** `transmittal:view`  
**Query:** `?status=&clientId=&search=&page=1&limit=50`

### `POST /v1/transmittals`
**Permission:** `transmittal:create`  
**Body:**
```json
{
  "clientId": "uuid",
  "trackingNumber": "TR-ATA-2026-001",
  "items": [
    { "description": "GIS 2025", "documentType": "SEC", "quantity": 1 }
  ],
  "recipientName": "Client Contact"
}
```

### Workflow Actions
- `POST /v1/transmittals/:id/send` — Draft → Sent
- `POST /v1/transmittals/:id/acknowledge` — Sent → Acknowledged

---

## Phase 7 — Reports

### `GET /v1/reports/analytics`
**Permission:** `reports:view`

### `GET /v1/reports/daily?date=2026-07-12`
**Permission:** `reports:view`

### `GET /v1/reports/weekly?date=2026-07-12`
**Permission:** `reports:view`

### `GET /v1/reports/monthly-pending?month=2026-07`
**Permission:** `reports:view`

### `GET /v1/reports/aging`
**Permission:** `billing:view`
