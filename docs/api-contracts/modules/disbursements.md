---
module: disbursements
contract_version: 2.0.0
frozen_at: 2026-10-04
frozen_by: P0-H
base_url: /v1/disbursements
---

# /v1/disbursements — Disbursements API Contract

## Overview
Manages firm and client fund expense disbursements, payment releases, funding reconciliation, and approval lifecycles. Enforces role-based initial status assignment (Staff create as `Pending`, Managers/Accounting/Admin create as `Draft`), status anti-forgery guards, and exclusive Admin approval/rejection (`disbursement:approve`).

- **Guards:** Authenticated, entity-scoped (`X-Active-Entity: ATA|LTA|ALL`). Omitted header defaults to `ALL` for authorized users.
- **Base URL:** `/v1/disbursements`

---

## 1. Status Lifecycle

```
                      ┌───────────────┐
                      │  Staff Create │
                      └───────┬───────┘
                              ▼
┌──────────────┐   submit   ┌─────────┐   approve   ┌──────────┐   release   ┌──────────┐   fund   ┌────────┐
│    Draft     ├───────────►│ Pending ├────────────►│ Approved ├────────────►│ Released ├─────────►│ Funded │
└──────────────┘            └────┬────┘             └──────────┘             └──────────┘          └────────┘
  ▲ (Mgmt/Acct/Admin              │
     Create)                      │ reject
                                  ▼
                            ┌──────────┐
                            │ Rejected │
                            └──────────┘
```

### Initial Creation Status
- **Staff** (`HR`, `Operations`, `Documentation`): Initialized directly in `Pending` awaiting approval.
- **Management, Accounting, Admin**: Initialized in `Draft` (requiring explicit `/submit` or direct processing).
- **Anti-Forgery Guard:** Providing any `status` field in the creation payload returns `400 Bad Request` (`status forgery is prohibited`).

---

## 2. Endpoints

### 2.1 `GET /v1/disbursements`
Lists disbursements for the active entity (or across entities when `X-Active-Entity: ALL`) with pagination and status filters.

- **Guards:** Authenticated, `disbursement:view`.
- **Since-version:** `1.0.0` (augmented in `2.1.0` with `taskId` filter and `ALL` cross-entity scoping).
- **Query Parameters:** `status`, `category`, `fundSource`, `workRequestId`, `taskId` (matches `task_id` or `linked_task_id`), `linkedTaskId`, `linkedTransmittalId`, `search`, `archived`, `page`, `limit`.
- **Events Emitted:** None.

---

### 2.2 `POST /v1/disbursements`
Creates a new disbursement record.

- **Guards:** Authenticated, `disbursement:create`.
- **Since-version:** `2.0.0` (augmented in `2.1.0` with `task_id` column dual-write and task WR matching validation).
- **Events Emitted:** None.

#### Request Body (Zod: `createDisbursementSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `category` | string (1–50) | Yes | Disbursement category (e.g. `Government Fee`, `Transportation`, `Supplies`) |
| `description` | string (1–2000) | Yes | Expense explanation and purpose |
| `amount` | number (> 0) | Yes | Positive disbursement amount |
| `fundSource` | enum (`Firm Fund`, `Client Fund`) | Yes | Source of disbursement funds |
| `linkedWorkRequestId` / `workRequestId` / `work_request_id` | UUID | Yes | Required link to parent work request |
| `clientId` | UUID \| null | No | Optional client association |
| `employeeId` | UUID \| null | No | Optional employee reimbursement target |
| `linkedInvoiceId` | UUID \| null | No | Optional invoice association |
| `taskId` / `task_id` / `linkedTaskId` | UUID \| null | No | Associated task ID. Validated against `tasks` table and work request. Dual-written to `task_id` and `linked_task_id`. |
| `linkedTransmittalId` | UUID \| null | No | Optional transmittal association |
| `dueDate` | ISO date string \| null | No | Expense due date |
| `notes` | string (max 2000) \| null | No | Internal notes |
| `receiptS3Key` | string (max 500) \| null | No | S3 key for uploaded receipt image/pdf |
| `receiptFilename` | string (max 255) \| null | No | Original filename of uploaded receipt |
| `status` | never | No | **Forbidden:** Setting explicit status triggers 400 Bad Request |

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | `amount <= 0`, missing required fields, or explicit `status` supplied |
| `400 Bad Request` | `TASK_NOT_FOUND` | Specified `taskId` does not exist in `tasks` table |
| `400 Bad Request` | `TASK_WR_MISMATCH` | Specified `taskId` belongs to a different work request |
| `403 Forbidden` | `FORBIDDEN` | Missing `disbursement:create` permission |

---

### 2.3 `GET /v1/disbursements/:id`

Lifecycle history entries include nullable `actor_name` and `actor_role` fields,
resolved from the current actor profile. Missing profiles preserve the original
history with null identity fields. Legacy summary fields include nullable
`created_by_role`, `approved_by_role`, `funded_by_role`, `released_by_role`, and
`rejected_by_role`. List and detail responses share this enrichment; existing
voucher visibility and entity restrictions still apply. Audit actions and stored
event details are unchanged.
Retrieves a single disbursement record with audit log and attachments.

- **Guards:** Authenticated, `disbursement:view`.
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.

---

### 2.4 `PUT /v1/disbursements/:id`
Updates a disbursement record in `Draft` or `Pending` status.

- **Guards:** Authenticated, `disbursement:edit`.
- **Since-version:** `1.0.0` (OCC `expectedVersion` added in `2.0.0`).
- **Events Emitted:** None.

---

### 2.5 `POST /v1/disbursements/:id/submit`
Submits a `Draft` disbursement for approval (moves to `Pending`).

- **Guards:** Authenticated, `disbursement:create`.
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.

---

### 2.6 `POST /v1/disbursements/:id/approve`
Approves a disbursement currently in `Pending` status. Moves to `Approved`.

- **Guards:** Authenticated, `disbursement:approve` (Admin only per P0-A manifest).
- **Since-version:** `2.0.0` (P0-G route guard enforcement).
- **Events Emitted:** None.

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `401 Unauthorized` | `UNAUTHORIZED` | Missing or invalid auth bearer token |
| `403 Forbidden` | `FORBIDDEN` | Caller lacks `disbursement:approve` (non-Admin role) |
| `404 Not Found` | `NOT_FOUND` | Disbursement not found |
| `409 Conflict` | `INVALID_STATUS` | Disbursement is not currently in `Pending` status |

---

### 2.7 `POST /v1/disbursements/:id/reject`
Rejects a disbursement currently in `Pending` status. Moves to `Rejected`.

- **Guards:** Authenticated, `disbursement:approve` (Admin only per P0-A manifest).
- **Since-version:** `2.0.0` (P0-G mandatory reason and in-app notification).
- **Events Emitted:** `pending_request.resolved` (dispatched to creator with `action: 'rejected'`).

#### Request Body (Zod: `rejectSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `reason` | string (trimmed, 1–500) | Yes | Required justification for rejection |

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Missing or whitespace-only rejection `reason` |
| `403 Forbidden` | `FORBIDDEN` | Caller lacks `disbursement:approve` |
| `404 Not Found` | `NOT_FOUND` | Disbursement not found |
| `409 Conflict` | `INVALID_STATUS` | Disbursement is not currently in `Pending` status |

---

### 2.8 `POST /v1/disbursements/:id/release`
Records funds release for an approved disbursement (`Approved` → `Released`).

- **Guards:** Authenticated, `disbursement:mark_released` (Accounting, Admin).
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.

---

### 2.9 `POST /v1/disbursements/:id/fund`
Marks a released disbursement as funded / reconciled (`Released` → `Funded`).

- **Guards:** Authenticated, `disbursement:mark_released` (Accounting, Admin).
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.

---

### 2.10 `GET /v1/disbursements/counts`
Returns badge counts of disbursements by status for the active entity or `ALL`.

- **Guards:** Authenticated, `disbursement:view`.
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.


## Receipt upload reservations

Receipt attachment uses these existing authenticated endpoints, scoped to an explicit authorized entity and requesting actor:

1. `POST /v1/disbursements/receipt-uploads` with `{ filename, contentType, size }` and header `X-Active-Entity: ATA|LTA` returns 201 `{ data: { uploadId, uploadUrl, objectKey, expiresAt } }`.
2. PUT the binary to `uploadUrl` using its content type.
3. `POST /v1/disbursements/receipt-uploads/:uploadId/complete` with header `X-Active-Entity: ATA|LTA` (matching reservation) verifies size and binary signature and returns `{ data: { receiptS3Key, receiptFilename } }`.
4. Submit that verified pair on voucher create/update with matching `X-Active-Entity: ATA|LTA`. Receipt claim executes atomically via database RPC `receipt_reservation_claim`. A key cannot be rebound after consumption; arbitrary direct uploads and Documents IDs are not valid receipt keys.

### Explicit Entity Requirement (RECEIPT-ENTITY-20261021)
- **Consolidated `ALL` View Requirement:** Clients operating in the consolidated `ALL` session MUST supply an explicit `X-Active-Entity: ATA|LTA` header matching the target work request across reserve, complete, and voucher create requests.
- **Fail-Closed Guard:** Requests to reserve or complete an upload with omitted entity header under dual-entity accounts or with literal `X-Active-Entity: ALL` or malformed headers are rejected before storage presigning or database writes with:
  ```json
  {
    "status": 400,
    "title": "Bad Request",
    "detail": "Select a specific ATA or LTA entity for this receipt upload.",
    "code": "RECEIPT_ENTITY_REQUIRED"
  }
  ```
- **Single-Entity Defaulting:** Single-entity accounts whose omitted header is unambiguously resolved by `entityScope` to their only authorized entity (`ATA` or `LTA`) remain compatible.
- **Rollout Compatibility:** Explicit `X-Active-Entity` headers are already accepted by the existing backend. Deploying the frontend change ensures consolidated requests send explicit targets before backend enforcement rejects ambiguous calls. Staging UI upload, create, and preview acceptance checks remain required before broad cutover.

Permitted types are PDF, PNG, and JPEG, with a positive size no greater than 10 MiB. Reservation metadata defaults to PostgreSQL in production; binaries remain private in Supabase Storage. The public upload protocol does not change with the backing reservation driver.

Store unavailability returns RFC 7807 HTTP 503. Clients should interpret `RECEIPT_STORE_NOT_CONFIGURED` as administrator action, `RECEIPT_STORE_DATABASE_UNAVAILABLE` / `RECEIPT_STORE_IO_ERROR` as unavailable persistence, and `RECEIPT_STORE_BUSY` as retryable contention. Preserve selected files and form input and abort voucher creation on upload failure. Do not use a selected receipt's filename as evidence of successful storage.

Migration 000072 and the selected driver's configuration must be ready before rollout. See [receipt operations and recovery](../../receipt-reservation-operations.md).
