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
