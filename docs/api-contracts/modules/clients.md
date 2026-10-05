---
module: clients
contract_version: 2.0.0
frozen_at: 2026-10-05
frozen_by: UAT-CL1-Freeze
base_url: /v1/clients
---

# /v1/clients — Clients & Master Records API Contract

## Overview
Manages firm clients, contact persons, contact details (email, mobile, phone, landline, other), related corporate entities, tax identification numbers (TIN), RDO codes, retainer agreements, and lifecycle statuses (Active, Inactive, Archived).
Enforces entity scoping (`X-Active-Entity: ATA|LTA|ALL`), RBAC permissions per `rbac-matrix.md` (`clients:view`, `clients:edit`), optimistic concurrency control (OCC via `expectedVersion` or `If-Match`), and unique TIN constraint guards on client restoration.

- **Guards:** Authenticated (`Authorization: Bearer <token>`), entity-scoped (`X-Active-Entity: ATA|LTA` or omitted/`ALL`).
- **Base URL:** `/v1/clients`
- **Audit Logging:** Mutations (`POST`, `PUT`, `POST /:id/archive`, `POST /:id/unarchive`, `DELETE`) emit structured audit records (`client.created`, `client.updated`, `client.archived`, `client.unarchived`).

---

## 1. Security & RBAC Scoping

| Endpoint | Method | Required Permission | Allowed Roles / Departments |
| :--- | :--- | :--- | :--- |
| `/v1/clients/counts` | `GET` | `clients:view` | All authenticated staff holding `clients:view` |
| `/v1/clients` | `GET` | `clients:view` | All authenticated staff holding `clients:view` |
| `/v1/clients/:id` | `GET` | `clients:view` | All authenticated staff holding `clients:view` |
| `/v1/clients` | `POST` | `clients:edit` | Admin only (`clients:edit`) |
| `/v1/clients/:id` | `PUT` | `clients:edit` | Admin only (`clients:edit`) |
| `/v1/clients/:id/archive` | `POST` | `clients:edit` | Admin only (`clients:edit`) |
| `/v1/clients/:id/unarchive`| `POST` | `clients:edit` | Admin only (`clients:edit`) |
| `/v1/clients/:id` | `DELETE` | `clients:edit` | Admin only (`clients:edit`) |

---

## 2. Endpoints Specification

### 2.1 `GET /v1/clients/counts`
Retrieves client counts by lifecycle status for the active entity.

- **Guards:** Authenticated, `clients:view`, entity-scoped (`allowAll: true`).
- **Query Parameters:** None.
- **Response Shape (200 OK):**
```json
{
  "data": {
    "active": 42,
    "archived": 3
  }
}
```

---

### 2.2 `GET /v1/clients`
Lists clients matching filter criteria with pagination and related contact/company information.

- **Guards:** Authenticated, `clients:view`, entity-scoped (`allowAll: true`).
- **Query Parameters:**
  | Param | Type | Required | Description |
  | :--- | :--- | :---: | :--- |
  | `search` | string | No | Substring search against `name`, `tin`, or `tradeName` |
  | `status` | string | No | Filter by exact status (e.g. `Active`, `Inactive`, `Archived`) |
  | `archived` | boolean \| string | No | `true` to list archived/soft-deleted clients |
  | `page` | integer | No | 1-indexed page number (triggers paginated response) |
  | `limit` | integer | No | Items per page (default: 50, max: 100) |
  | `sortBy` | string | No | Column: `name` (default), `created_at`, `updated_at`, `status` |
  | `sortOrder` | string | No | Direction: `asc` (default) or `desc` |

- **Response Shape (200 OK — Paginated):**
```json
{
  "data": [
    {
      "id": "c1111111-1111-1111-1111-111111111111",
      "entity": "ATA",
      "name": "Acme Holdings Corp.",
      "tin": "123-456-789-000",
      "rdoCode": "044",
      "address": "Unit 1001 Enterprise Tower, Makati City",
      "tradeName": "Acme Group",
      "contactUserId": null,
      "contactPerson": "Jane Doe",
      "retainer": true,
      "retainerFee": 25000.00,
      "status": "Active",
      "createdBy": "u-admin-1",
      "updatedBy": "u-admin-1",
      "createdAt": "2026-01-15T08:00:00.000Z",
      "updatedAt": "2026-03-20T10:30:00.000Z",
      "deletedAt": null,
      "version": 1,
      "contactDetails": [
        {
          "id": "cd-1",
          "type": "email",
          "value": "accounting@acme.com",
          "label": "Accounting Office"
        }
      ],
      "relatedCompanies": [
        {
          "id": "rc-1",
          "relatedClientId": "c2222222-2222-2222-2222-222222222222",
          "relationship": "Parent Company"
        }
      ]
    }
  ],
  "meta": {
    "total": 1,
    "page": 1,
    "limit": 50,
    "totalPages": 1
  }
}
```

---

### 2.3 `GET /v1/clients/:id`
Retrieves a single client record with contact details and related companies.

- **Guards:** Authenticated, `clients:view`, entity-scoped (`allowAll: true`).
- **Query Parameters:**
  | Param | Type | Required | Description |
  | :--- | :--- | :---: | :--- |
  | `includeArchived` | boolean | No | If `true`, returns record even if archived/deleted |
- **Response Shape (200 OK):** Single client object wrapped in `{ data: Client }`.
- **Error Responses:** 404 Not Found if client does not exist or belongs to another entity.

---

### 2.4 `POST /v1/clients`
Creates a new client record.

- **Guards:** Authenticated, `clients:edit`, entity-scoped.
- **Request Body (Zod: `createClientSchema`):**
  | Field | Type | Required | Description |
  | :--- | :--- | :---: | :--- |
  | `name` | string (1–255) | Yes | Registered corporate or individual client name |
  | `tin` | string (max 50) | Yes | Tax Identification Number |
  | `rdoCode` | string (max 20) | No | Bureau of Internal Revenue Revenue District Office code |
  | `address` | string (max 500) | No | Official physical or billing address |
  | `entity` | enum `['ATA', 'LTA']`| Yes | Entity code (must match active entity header) |
  | `retainer` | boolean | No | Whether the client is on a retainer agreement (default: false) |
  | `retainerFee` | number (>= 0) \| null | No | Monthly/periodic retainer fee amount |
  | `tradeName` | string (max 255) | No | Business/trade trade name (DBA) |
  | `contactUserId` | UUID \| null | No | Internal user account ID assigned as client representative |
  | `contactPerson` | string (max 255) | No | Name of primary external contact person |
  | `contactDetails`| array of contactDetail | No | Array of contact methods |
  | `relatedCompanies` | array of relatedCompany | No | Array of affiliate/subsidiary associations |

#### Contact Detail Schema
```json
{
  "type": "email | mobile | phone | landline | other",
  "value": "string (1-255)",
  "label": "string (max 50, optional)"
}
```

#### Related Company Schema
```json
{
  "relatedClientId": "UUID",
  "relationship": "string (max 100, optional)"
}
```

- **Response (201 Created):** `{ data: Client }`.
- **Errors:**
  - 400 Bad Request: Validation failure or entity mismatch.
  - 409 Conflict: Client with exact TIN already exists in the entity (`23505`).

---

### 2.5 `PUT /v1/clients/:id`
Updates an existing client record with OCC concurrency guard.

- **Guards:** Authenticated, `clients:edit`, entity-scoped.
- **Headers:** `If-Match: "<version>"` (optional fallback for OCC).
- **Request Body (Zod: `updateClientSchema`):**
  Partial of `createClientSchema` with optional `expectedVersion: number`.
- **Response (200 OK):** `{ data: Client }`.
- **Errors:**
  - 404 Not Found: Client ID does not exist.
  - 409 Conflict: `CONCURRENCY_CONFLICT` — record was modified by another user (`expectedVersion` mismatch).

---

### 2.6 `POST /v1/clients/:id/archive`
Soft-archives a client record (`status = 'Archived'`, `deleted_at = now()`).

- **Guards:** Authenticated, `clients:edit`, entity-scoped.
- **Response (200 OK):** `{ data: Client }`.

---

### 2.7 `POST /v1/clients/:id/unarchive`
Restores an archived client record (`status = 'Active'`, `deleted_at = null`).

- **Guards:** Authenticated, `clients:edit`, entity-scoped.
- **Response (200 OK):** `{ data: Client }`.
- **Errors:**
  - 409 Conflict: `DUPLICATE_TIN` — cannot restore if another active client in the entity shares the same TIN.

---

### 2.8 `DELETE /v1/clients/:id`
Soft-deletes a client record.

- **Guards:** Authenticated, `clients:edit`, entity-scoped.
- **Response (204 No Content):** Empty body.
