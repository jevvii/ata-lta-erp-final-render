# Agent A API Contracts

> **Owner**: Agent A / Team A (Foundation, Clients, Operations, Admin)
> **Status**: Phase 2 stable; Phase 4 and Phase 8 draft
>
> Agent B modules depend on these contracts. Coordinate shared changes via
> GitHub issues labeled `shared-change-request`.

---

## Authentication

All endpoints require:

- `Authorization: Bearer <supabase-jwt>`
- `X-Active-Entity: ATA|LTA`

Responses use `application/problem+json` for errors.

---

## Clients

Base path: `/v1/clients`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/` | `clients:view` | List/search clients for active entity |
| POST | `/` | `clients:edit` | Create client |
| GET | `/:id` | `clients:view` | Get client by ID |
| PUT | `/:id` | `clients:edit` | Update client |
| DELETE | `/:id` | `clients:edit` | Soft delete (archive) client |

### Client shape

```json
{
  "id": "uuid",
  "entity": "ATA|LTA",
  "name": "string",
  "tin": "string",
  "rdoCode": "string|null",
  "address": "string|null",
  "tradeName": "string|null",
  "contactUserId": "uuid|null",
  "retainer": "boolean",
  "status": "Active|Archived",
  "contactDetails": [
    { "id": "uuid", "type": "email|mobile|phone|other", "value": "string", "label": "string|null" }
  ],
  "relatedCompanies": [
    { "id": "uuid", "relatedClientId": "uuid", "relationship": "string|null" }
  ],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### Query parameters

- `search` – matches name, trade name, or TIN
- `status` – exact status filter

---

## Work Requests

Base path: `/v1/work-requests`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/` | `workflow:view` | List work requests visible to the user |
| POST | `/` | `workflow:edit` | Create work request |
| GET | `/:id` | `workflow:view` | Get work request by ID |
| PUT | `/:id` | `workflow:edit` | Update work request |
| DELETE | `/:id` | `workflow:edit` | Delete work request |

### WorkRequest shape

```json
{
  "id": "uuid",
  "title": "string",
  "description": "string|null",
  "clientId": "uuid",
  "entity": "ATA|LTA",
  "status": "string",
  "requestedBy": "uuid",
  "assignedTo": "uuid|null",
  "dueDate": "ISO-8601|null",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Visibility rules match the prototype:

- Admin sees all work requests.
- Managerial users see work requests they own, submitted, or requested.
- Staff see work requests they are assigned to via tasks or checklist items.

---

## Tasks

Base path: `/v1/work-requests/:wrId/tasks`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/` | `workflow:view` | List tasks for a work request |
| POST | `/` | `workflow:task_add` | Create task |
| PUT | `/:taskId` | `workflow:edit` | Update task |
| DELETE | `/:taskId` | `workflow:edit` | Delete task |

### Task shape

```json
{
  "id": "uuid",
  "workRequestId": "uuid",
  "title": "string",
  "description": "string|null",
  "status": "string",
  "assigneeId": "uuid|null",
  "assigneeName": "string|null",
  "predecessors": ["uuid"],
  "dueDate": "ISO-8601|null",
  "checklist": [
    { "id": "uuid", "text": "string", "completed": "boolean", "assigneeId": "uuid|null", "assigneeName": "string|null" }
  ],
  "timeLogs": [
    { "id": "uuid", "startTime": "string", "endTime": "string", "date": "string", "hours": "number", "userId": "uuid|null", "note": "string|null" }
  ],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

---

## Current User / Permissions

Base path: `/v1/me`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Current user profile + active entity |
| GET | `/permissions` | String array of allowed actions |

### Me shape

```json
{
  "data": {
    "id": "uuid",
    "email": "string",
    "name": "string",
    "role": "Admin|Manager|Accounting|Operations|Documentation|HR",
    "departments": ["string"],
    "entities": ["ATA", "LTA"],
    "activeEntity": "ATA|LTA",
    "permissions": ["clients:view", "clients:edit", ...]
  }
}
```

---

## Admin / Users

Base path: `/v1/admin`

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| GET | `/users` | `users:view` | List users |
| POST | `/users` | `users:manage` | Create Supabase Auth user + ERP profile |
| GET | `/users/:id` | `users:view` | Get user by ID |
| PUT | `/users/:id` | `users:manage` | Update user |
| DELETE | `/users/:id` | `users:manage` | Soft delete / disable user |
| GET | `/pending-approvals` | `approve_change:*` or `bypass_review:*` | List pending approvals |
| POST | `/pending-approvals/:id/approve` | `approve_change:*` or `bypass_review:*` | Approve pending change |
| POST | `/pending-approvals/:id/reject` | `approve_change:*` or `bypass_review:*` | Reject pending change |

### User shape

```json
{
  "id": "uuid",
  "email": "string",
  "name": "string",
  "role": "string",
  "departments": ["string"],
  "entities": ["ATA", "LTA"],
  "isActive": "boolean",
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

---

## Migration Endpoints

Temporary endpoints used during data cutover:

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| POST | `/v1/migrate/clients` | `clients:edit` | Bulk import prototype clients (deduplicated by TIN) |

---

## Change Log

- 2026-07-12 — Phase 2 clients contract published.
- 2026-07-12 — Phase 4 operations contract drafted.
- 2026-07-12 — Phase 8 admin contract drafted.
