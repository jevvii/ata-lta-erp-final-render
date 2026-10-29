# Documents Module

**Owner:** Agent B / Team B  
**Phase:** 3

## Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/v1/documents` | `dms:view` | List documents with filters |
| `POST` | `/v1/documents` | `dms:edit` | Create metadata + get upload URL |
| `GET` | `/v1/documents/:id` | `dms:view` | Get single document |
| `PUT` | `/v1/documents/:id` | `dms:edit` | Update metadata |
| `DELETE` | `/v1/documents/:id` | `dms:delete` | Soft-delete document |
| `POST` | `/v1/documents/:id/confirm-upload` | `dms:edit` | Mark upload complete |
| `GET` | `/v1/documents/:id/download-url` | `dms:view` | Get signed download URL |
| `PUT` | `/v1/documents/:id/lifecycle` | `dms:handover` | Transition lifecycle state |

## Upload Flow

1. `POST /v1/documents` — creates metadata, returns `{ document, uploadUrl }`
2. Client PUTs file bytes directly to Supabase Storage using `uploadUrl`
3. `POST /v1/documents/:id/confirm-upload` — marks status as `active`

## Download Flow

1. `GET /v1/documents/:id/download-url` — returns `{ url, fileName }`
2. Client opens/redirects to the signed URL

## Lifecycle States

`collected` → `with_documentations` → `scanned` → `in_envelope` → `stored`

## Storage Path Layout

```
entities/{entity_id}/clients/{client_id}/documents/{document_id}/{filename}
entities/{entity_id}/work-requests/{wr_id}/documents/{document_id}/{filename}
entities/{entity_id}/general/documents/{document_id}/{filename}
```

## Categories

SEC, BIR, CONTRACT, PERMIT, FINANCIAL, CORRESPONDENCE, LEGAL, HR, OTHER

## Collaborative comments

Apply migration `000064_atomic_document_comments.js` before deploying the new API.
All comment mutations require authentication, an active entity, and document/project visibility.
For task-linked documents, the primary assignee and relational co-assignees may comment
regardless of department or `dms:edit`. Managers must also be assigned to that specific
task; parent project membership or sibling-task assignment does not grant comment access.
Admins bypass the assignment requirement. Documents without a linked task retain the
`dms:edit` requirement. The service rechecks access on every add, edit, and delete.
Document detail and successful comment responses include the caller-specific boolean
`can_comment`; clients must hide comment controls unless it is explicitly true.
Deploy this API change before the frontend that consumes this capability. No new migration is needed.

- `POST /v1/documents/:id/comments` accepts `{ "text": "..." }` and returns 201.
- `PUT /v1/documents/:id/comments/:commentId` accepts the same body, author only.
- `DELETE /v1/documents/:id/comments/:commentId` allows the author or an Admin.

Each returns `{ data: document }`. Text is trimmed and limited to 1–4000 characters.
The service-only PostgreSQL function locks the document row before checking ownership
and changing the array. The server derives UUIDs, author identity, and timestamps.
The metadata PUT endpoint rejects `comments` to prevent stale whole-thread overwrites.
Missing/deleted/cross-entity documents or missing comments return 404; forbidden
comment ownership returns 403. Legacy comments without IDs remain visible but cannot
be edited or deleted through the individual endpoints.

`tests/integration/documentComments.test.js` runs with the normal Supabase mock.
For actual SQL concurrency verification, set `DOCUMENT_COMMENTS_TEST_DATABASE_URL`
to a disposable database named `astra_comments_test` with `users`, `documents`, and
migration 000064 installed. This mode truncates those two tables, then drives the
same HTTP scenarios through real PostgreSQL RPC calls and checks the final thread.
