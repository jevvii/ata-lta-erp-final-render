---
module: time-entries
contract_version: 2.0.0
frozen_at: 2026-10-04
frozen_by: P0-H
base_url: /v1/time-entries
---

# /v1/time-entries — Duration-Canonical Time Entries API Contract

## Overview
Provides duration-canonical logging of worker time entries against assigned operational tasks. Replaces legacy clock timers with explicit duration inputs (1–1440 minutes), forces authenticated creator identity, enforces task assignment checks via `task_assignees`, and provides a high-performance single-query daily summary.

- **Guards:** Authenticated, entity-scoped (`X-Active-Entity: ATA|LTA`).
- **Base URL:** `/v1/time-entries`
- **Architectural Tenet:** Strictly duration-based logging; zero timer, stopwatch, or cron daemons.

---

## 1. Security & RBAC Scoping

- **Forced Identity (Rule R2):** The authenticated user's ID (`req.user.id`) is strictly bound as the creator. Any client-supplied `user_id` in request payloads is ignored.
- **Task Assignee Verification (Rule R3):** Logging time requires the user to be an assigned worker on the task (verified via `task_assignees` attribution join or fallback `tasks.assignee_id`). Unassigned logging attempts return `403 Forbidden`.
- **Edit & Delete Isolation (Rule R4):** Non-admin workers can only view, edit, and delete their own time entries (`timelog:edit_own`). Users holding `timelog:edit_all` (Admin) may edit and delete entries across all workers.

---

## 2. Endpoints

### 2.1 `POST /v1/time-entries`
Logs a new duration-based time entry against a task.

- **Guards:** Authenticated, `timelog:create` + task assignment check.
- **Since-version:** `2.0.0` (P0-F).
- **Events Emitted:** None.

#### Request Body (Zod: `createTimeEntrySchema`)
| Field | Type | Required | Bounds / Validation | Description |
| :--- | :--- | :---: | :---: | :--- |
| `task_id` | UUID | Yes | Valid UUID | Target task identifier |
| `entry_date` | string | Yes | YYYY-MM-DD, `date <= today` | Date work was performed (future dates rejected) |
| `duration_minutes` | integer | Yes | 1 to 1440 | Duration in minutes (max 24 hours) |
| `note` | string (max 5000) \| null | No | — | Optional description of work performed |
| `user_id` | string | No | Ignored | Server forces `user_id = req.user.id` |

#### Response (201 Created)
```json
{
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "task_id": "uuid",
    "entry_date": "2026-10-04",
    "duration_minutes": 120,
    "note": "Document review and financial reconciliation",
    "created_at": "2026-10-04T02:00:00Z",
    "updated_at": "2026-10-04T02:00:00Z"
  }
}
```

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | `duration_minutes` outside 1–1440, future `entry_date`, or invalid format |
| `403 Forbidden` | `FORBIDDEN` | Caller lacks `timelog:create` or is not assigned to the specified `task_id` |
| `404 Not Found` | `NOT_FOUND` | Specified `task_id` does not exist |

---

### 2.2 `GET /v1/time-entries/summary`
Returns daily aggregated minutes and per-task breakdown for dashboard widgets using a single indexed query. Must precede `/:id` in route registration.

- **Guards:** Authenticated, `timelog:view`.
- **Since-version:** `2.0.0` (P0-F).
- **Events Emitted:** None.

#### Query Parameters (Zod: `summaryQuerySchema`)
| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `date` | string (YYYY-MM-DD) | Yes | Target summary date |
| `user_id` | UUID | No | Target user ID (Admin only; non-admins scoped to self) |

#### Response (200 OK)
```json
{
  "data": {
    "date": "2026-10-04",
    "total_minutes": 270,
    "by_task": [
      {
        "task_id": "uuid-1",
        "work_request_id": "uuid-wr-1",
        "title": "Review BIR forms",
        "minutes": 150
      },
      {
        "task_id": "uuid-2",
        "work_request_id": "uuid-wr-1",
        "title": "Client correspondence",
        "minutes": 120
      }
    ]
  }
}
```

---

### 2.3 `GET /v1/time-entries`
Lists time entries with date range and task filters. Scoped to the caller's own entries unless the caller holds `timelog:edit_all`.

- **Guards:** Authenticated, `timelog:view`.
- **Since-version:** `2.0.0` (P0-F).
- **Events Emitted:** None.

#### Query Parameters (Zod: `listQuerySchema`)
| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `from` | string (YYYY-MM-DD) | No | Start of date range |
| `to` | string (YYYY-MM-DD) | No | End of date range |
| `task_id` | UUID | No | Filter by specific task |
| `user_id` | UUID | No | Filter by user (Admin only; non-admins forced to self) |

List responses include nullable `user_name` and `user_role` fields, resolved from
the logger's profile after entry visibility is scoped. Legacy logs use their saved
worker name if the profile is unavailable. No additional profile fields are
exposed. `entry_date` is the work date; `created_at` is the logged timestamp.

---

### 2.4 `PATCH /v1/time-entries/:id`
Updates an existing time entry. Non-admin users can only edit their own entries.

- **Guards:** Authenticated, `timelog:edit_own` (own entries) or `timelog:edit_all` (any entry).
- **Since-version:** `2.0.0` (P0-F).
- **Events Emitted:** None.

#### Request Body (Zod: `updateTimeEntrySchema`)
Partial of `createTimeEntrySchema` (excluding `user_id`).

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | `duration_minutes` outside 1–1440 or future `entry_date` |
| `403 Forbidden` | `FORBIDDEN` | Caller attempting to edit another user's entry without `timelog:edit_all` |
| `404 Not Found` | `NOT_FOUND` | Time entry ID not found |

---

### 2.5 `DELETE /v1/time-entries/:id`
Deletes a time entry. Non-admin users can only delete their own entries.

- **Guards:** Authenticated, `timelog:edit_own` (own entries) or `timelog:edit_all` (any entry).
- **Since-version:** `2.0.0` (P0-F).
- **Events Emitted:** None.

#### Response (204 No Content)
Empty body.

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `403 Forbidden` | `FORBIDDEN` | Caller attempting to delete another user's entry without `timelog:edit_all` |
| `404 Not Found` | `NOT_FOUND` | Time entry ID not found |
