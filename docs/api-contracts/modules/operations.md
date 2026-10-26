---
module: operations
contract_version: 2.0.0
frozen_at: 2026-10-04
frozen_by: P0-H
base_url: /v1/operations
---

# /v1/operations — Work Requests, Tasks, and Phase-Routing API Contract

## Overview
Manages the core operational workflow of work requests and tasks through a deterministic four-phase progression (`pre_processing` → `processing` → `quality_assurance` → `completion`). Enforces atomic graph creation, server-side delimiter tokenization, task phase immutability, prerequisite gates, multi-assignee attribution joins, and QA review / reroute workflows.

- **Guards:** Authenticated, entity-scoped (`X-Active-Entity: ATA|LTA|ALL`).
- **Base Paths:** Mounted at `/v1/operations` (with legacy backward-compatible alias `/v1/work-requests`).
- **Dual-Write Discipline:** During the Phase-0 through Phase-3 transition window, legacy columns (`tasks.assignee_id`, `tasks.assignee_name`, `work_requests.co_assignees`, `work_requests.status`) are maintained alongside relational tables and phase columns.

---

## 1. Phase-Routing Lifecycle & Advancement Gates

```
┌──────────────────┐       Gate 1       ┌────────────┐       Gate 2       ┌───────────────────┐       Gate 3       ┌────────────┐
│  pre_processing  ├───────────────────►│ processing ├───────────────────►│ quality_assurance ├───────────────────►│ completion │
└──────────────────┘                    └─────▲──────┘                    └─────────┬─────────┘                    └────────────┘
                                              │                                     │
                                              └─────────────── Reroute ─────────────┘
                                                       (reopens failed tasks only)
```

### Advancement Gates
| Transition | Gate Rule | Failure Code |
| :--- | :--- | :--- |
| `pre_processing` → `processing` | All non-Cancelled `pre_processing` tasks must be `Completed`. | `GATE_PREREQUISITE_FAILED` (409) |
| `processing` → `quality_assurance` | All non-Cancelled `processing` tasks must be `Completed`. | `GATE_PREREQUISITE_FAILED` (409) |
| `quality_assurance` → `completion` | All non-Cancelled tasks must be `Completed` **and** have `qa_status = 'passed'`. | `GATE_PREREQUISITE_FAILED` (409) |
| Any skip direct to `completion` | Skipping intermediate phases is strictly forbidden. | `INVALID_PHASE_TRANSITION` (409) |

---

## 2. Endpoints

### 2.1 `POST /v1/operations/work-requests` (and `/v1/operations`)
Creates a complete work request graph within a single atomic database transaction.

- **Guards:** Authenticated, `workflow:edit`.
- **Since-version:** `2.0.0` (P0-D single-transaction graph creation, tokenizer, multi-assignee dual-write).
- **Events Emitted:** None.

#### Request Body (Zod: `createWorkRequestSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `title` | string (1–255) | Yes | Title of the work request |
| `description` | string | No | Optional detailed description |
| `clientId` | UUID | No | Client ID association |
| `entity` | enum (`ATA`, `LTA`, `ALL`) | No | Owning entity |
| `status` | string (max 50) | No | Legacy status (defaults to `Draft` / `Pre-processing`) |
| `phase` | string (max 50) | No | Initial phase (defaults to `pre_processing`) |
| `requestedBy` | UUID | No | Requesting user ID |
| `assignedTo` | UUID \| null | No | Primary assignee user ID |
| `coAssignees` | array of strings | No | Multi-assignee user UUIDs (defaults to `[]`) |
| `dueDate` | ISO date or timestamp string | Yes | Required for creation; valid calendar date (`YYYY-MM-DD`) or ISO timestamp. Missing, null, empty, or invalid dates return `400 VALIDATION_ERROR`. |
| `priority` | string (max 50) | No | Priority (e.g. `Low`, `Medium`, `High`, `Urgent`) |
| `idempotency_key` / `idempotencyKey` | string | No | Client idempotency token |
| `phases` | object (`phasesSchema`) | No | Phase container containing `pre_processing` and `processing` task arrays |

#### `phaseTaskSchema` (Inside `phases.pre_processing.tasks` and `phases.processing.tasks`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `title` | string (min 1) | Yes | Task title. Delimiter-tokenized on `[,;\n]` and `. ` into sibling tasks when $\ge 2$ tokens result. |
| `description` | string | No | Task description. Tokenized if title has 1 token and description has $\ge 2$ tokens. |
| `assignees` | array of UUIDs | No | User IDs assigned to the task (stored in `task_assignees`). |
| `depends_on` / `dependsOn` | string \| array | No | References sibling task by `local_id`. Rejects `"0"`, `""`, or unknown local IDs. |
| `local_id` / `localId` | string | No | Local identifier used for intra-graph dependency references |
| `status` | string | No | Initial status (defaults to `Draft` or `In Progress`) |
| `dueDate` | ISO date string | No | Task due date |

#### Response (201 Created)
Returns complete created work request object with embedded `tasks` array including persisted UUIDs, assigned phase, and `task_assignees`.

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Title missing, invalid UUIDs, or delimiter tokenization produces > 50 tasks (`TASK_LIMIT_EXCEEDED`) |
| `400 Bad Request` | `INVALID_DEPENDENCY` | `depends_on` references `"0"`, invalid string, or unknown `local_id` |
| `400 Bad Request` | `CIRCULAR_DEPENDENCY` | Cyclic dependency detected within task graph |
| `403 Forbidden` | `FORBIDDEN` | Missing `workflow:edit` permission |

---

### 2.2 `GET /v1/operations/work-requests` (and `/v1/operations`)
Lists work requests matching query filters.

- **Guards:** Authenticated, `workflow:view`.
- **Since-version:** `1.0.0` (augmented in `2.0.0` with `phase` filtering and counters).
- **Events Emitted:** None.

---

### 2.3 `GET /v1/operations/work-requests/:id`
Retrieves a single work request by ID with its tasks, dependencies, and assignees.

- **Guards:** Authenticated, `workflow:view`.
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.

---

### 2.4 `PUT /v1/operations/work-requests/:id`
Updates work request attributes.

- **Guards:** Authenticated, `workflow:edit`.
- **Since-version:** `1.0.0` (OCC `expectedVersion` added in `2.0.0`).
- **Events Emitted:** None.

---

### 2.5 `POST /v1/operations/work-requests/:id/advance`
Directly advances a work request to the next lifecycle phase (Admin only).

- **Guards:** Authenticated, `workflow:phase_transition` (Admin only).
- **Since-version:** `2.0.0` (P0-D).
- **Events Emitted:** `wr.transition_request.resolved` with `{ outcome: 'approved', via: 'direct' }`.

#### Request Body (Zod: `advanceWorkRequestSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `to_phase` / `toPhase` | enum (`processing`, `quality_assurance`, `completion`) | No | Target phase. If omitted, defaults to sequential next phase. |

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `403 Forbidden` | `FORBIDDEN` | Caller lacks `workflow:phase_transition` |
| `404 Not Found` | `NOT_FOUND` | Work request not found |
| `409 Conflict` | `GATE_PREREQUISITE_FAILED` | Incomplete prerequisite tasks in current phase or unpassed QA tasks |
| `409 Conflict` | `INVALID_PHASE_TRANSITION` | Attempted jump skipping intermediate phases |

---

### 2.6 `POST /v1/operations/work-requests/:id/qa-review`
Submits QA review evaluations for tasks in a work request currently in `quality_assurance` phase.

- **Guards:** Authenticated, `workflow:qa_review` (Admin only).
- **Since-version:** `2.0.0` (P0-D).
- **Events Emitted:** None.

#### Request Body (Zod: `qaReviewSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `results` | array of `qaReviewTaskResultSchema` | Yes | Minimum 1 result item required |

#### `qaReviewTaskResultSchema`
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `task_id` / `taskId` | UUID | Yes | Task identifier |
| `qa_status` / `qaStatus` | enum (`passed`, `failed`) | Yes | QA verdict |

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Empty results array or invalid UUID/status enum |
| `403 Forbidden` | `FORBIDDEN` | Caller lacks `workflow:qa_review` |
| `404 Not Found` | `NOT_FOUND` | Work request or task not found |
| `409 Conflict` | `INVALID_PHASE` | Work request is not currently in `quality_assurance` phase |

---

### 2.7 `POST /v1/operations/work-requests/:id/reroute`
Reroutes a work request in `quality_assurance` back to `pre_processing` or `processing`, reopening only tasks marked `qa_status = 'failed'`.

- **Guards:** Authenticated, `workflow:qa_review` (Admin only).
- **Since-version:** `2.0.0` (P0-D).
- **Events Emitted:** `wr.qa_reroute` (dispatched to assignees of reopened tasks).

#### Request Body (Zod: `rerouteSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `to_phase` / `toPhase` | enum (`pre_processing`, `processing`) | Yes | Target phase to return to |
| `reason` | string (trimmed, min 1) | Yes | Required audit rationale for reroute |

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Missing `to_phase` or missing non-empty `reason` |
| `403 Forbidden` | `FORBIDDEN` | Caller lacks `workflow:qa_review` |
| `404 Not Found` | `NOT_FOUND` | Work request not found |
| `409 Conflict` | `INVALID_PHASE` | Work request is not currently in `quality_assurance` phase |

---

### 2.8 `POST /v1/operations/work-requests/:wrId/tasks`
Creates a new task under a work request.

- **Guards:** Authenticated, `workflow:task_add`.
- **Since-version:** `1.0.0` (`phase` assignment enforced in `2.0.0`).
- **Events Emitted:** None.

#### Request Body (Zod: `createTaskSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `title` | string (1–255) | Yes | Task title |
| `description` | string | No | Task description |
| `phase` | enum (`pre_processing`, `processing`) | No | Assigned phase (defaults from context) |
| `status` | string (max 50) | No | Task status |
| `assigneeId` | UUID \| null | No | Primary assignee user ID |
| `assignees` | array of UUIDs | No | Multi-assignee user IDs |
| `dueDate` | ISO date string | No | Due date |
| `checklist` | array of checklist items | No | Task checklist items |

---

### 2.9 `PUT /v1/operations/work-requests/:wrId/tasks/:taskId`
Updates a task. Enforces task phase immutability and prerequisite advancement gates.

- **Guards:** Authenticated, `workflow:edit`.
- **Since-version:** `1.0.0` (`TASK_PHASE_IMMUTABLE` and `PHASE_PREREQUISITE` added in `2.0.0`).
- **Events Emitted:** None.

#### Request Body (Zod: `updateTaskSchema`)
Partial of `createTaskSchema`. Note: Any payload containing `phase` is rejected.

---

### 2.10 `PATCH /v1/operations/work-requests/:wrId/tasks/:taskId` (and `/v1/tasks/:taskId`)
Partially updates a task with dual authorization:

- **Guards:** Authenticated, `workflow:edit` OR Task Assignee (`requireWorkflowEditOrTaskAssignee`).
- **Since-version:** `2.1.0` (UAT2-9 assignee self-service status mutation).
- **Authorization Rules:**
  * **Users with `workflow:edit`**: Permitted full update across all permitted mutable fields.
  * **Task Assignees (without `workflow:edit`)**:
    - Permitted to update `status` to `'In Progress'` or `'Completed'` (case-normalized; `'Complete'` accepted as `'Completed'`).
    - May supply optional `expectedVersion` concurrency guard.
    - Supplying any other field returns `403 Forbidden` (`Assignees may only update task status`).
    - Requesting any other status returns `400 Bad Request`.
    - Phase prerequisite enforcement remains active (`409 Conflict`, `PHASE_PREREQUISITE`).
  * **Users without `workflow:edit` who are NOT assigned to task**: Rejected with `403 Forbidden` (`One of permissions [workflow:edit] is required`).

---

### 2.11 Retainer Templates & Entity Scoping
- `GET /v1/operations/templates` and `GET /v1/operations/retainer-templates`:
  * Supports `X-Active-Entity: ALL` (and omitted header for authorized users) returning consolidated cross-entity retainer templates.

### 2.12 Manager Work Request Creation & Pending Approvals
- When a Manager (role `Manager` or department `Management`, or with `requiresApproval = true`) creates a Work Request via `POST /v1/operations/work-requests` or `/v1/operations`:
  * An `operations_requests` record with `type: 'wr_phase_transition'`, `status: 'pending'`, `from_phase: 'pre_processing'`, and `to_phase: 'processing'` is automatically inserted into the database.
  * Notifications are emitted to active Admins (`wr.transition_request.received`).
  * The work request is routed to the Admin Pending Approvals Inbox for review.

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `TASK_PHASE_IMMUTABLE` | Payload includes `phase` (task phase cannot be mutated after creation) |
| `403 Forbidden` | `FORBIDDEN` | Caller lacks `workflow:edit` |
| `409 Conflict` | `PHASE_PREREQUISITE` | Attempted transition of `processing` task out of `Draft`/`Assigned` while active `pre_processing` tasks remain incomplete |
| `409 Conflict` | `CONCURRENCY_CONFLICT` | OCC version mismatch (`expectedVersion` does not match DB version) |
