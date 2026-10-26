# Operations Phase-Routing API Contract

> **Owner**: Worker-OPS (Parcel P0-D)  
> **Status**: Frozen (Wave 2)  
> **Date**: 2026-10-04  
>
> Downstream modules (P0-E Retainers, P0-F Time Entries, P0-H Contract Freeze, P2 Operations React Module) depend on these contracts.

---

## 1. Authentication & Common Headers

All HTTP endpoints require:
- `Authorization: Bearer <supabase-jwt>`
- `X-Active-Entity: ATA|LTA` (or `ALL` for multi-entity read views)
- `Idempotency-Key: <uuid>` *(optional on mutation endpoints, strongly recommended on `POST /v1/operations/work-requests`)*

All error responses conform to RFC 7807 `application/problem+json`:
```json
{
  "status": 409,
  "title": "Conflict",
  "detail": "Processing task cannot transition out of Draft/Assigned while 1 active pre-processing task(s) remain incomplete: Collect BIR 2307 forms",
  "code": "PHASE_PREREQUISITE",
  "invalidParams": [
    {
      "name": "status",
      "reason": "Active pre-processing tasks must be Completed first"
    }
  ]
}
```

---

## 2. Phase-Routing Lifecycle & Architecture

The operations workflow progresses sequentially through four explicit lifecycle phases:
```
┌──────────────────┐       gate 1       ┌────────────┐       gate 2       ┌───────────────────┐       gate 3       ┌────────────┐
│  pre_processing  ├───────────────────►│ processing ├───────────────────►│ quality_assurance ├───────────────────►│ completion │
└──────────────────┘                    └─────▲──────┘                    └─────────┬─────────┘                    └────────────┘
                                              │                                     │
                                              └─────────────── reroute ─────────────┘
                                                       (reopens failed tasks only)
```

### 2.1 Advancement Gates (§3.4)

| Transition | Gate Rule | Gate Failure Response |
| :--- | :--- | :--- |
| `pre_processing` → `processing` | Every active (non-Cancelled) `pre_processing` task must be `Completed`. | `409 Conflict` (`code: 'GATE_PREREQUISITE_FAILED'`) |
| `processing` → `quality_assurance` | Every active (non-Cancelled) `processing` task must be `Completed`. | `409 Conflict` (`code: 'GATE_PREREQUISITE_FAILED'`) |
| `quality_assurance` → `completion` | Every active task in the WR must be `Completed` **and** have `qa_status = 'passed'`. | `409 Conflict` (`code: 'GATE_PREREQUISITE_FAILED'`) |
| Any skip direct to `completion` | Skipping intermediate phases is strictly forbidden. | `409 Conflict` (`code: 'INVALID_PHASE_TRANSITION'`) |

*Note: Cancelled tasks (`status = 'Cancelled'`) are strictly excluded from all gate checks.*

### 2.2 Task Phase-Lock Guard & Prerequisite Gate (§3.2, Rule R5)
- **Phase Immutability**: Task `phase` is assigned at creation from its section (`pre_processing` or `processing`) and is permanently immutable. Any update payload containing a `phase` property returns HTTP `400 Bad Request` (`code: 'TASK_PHASE_IMMUTABLE'`).
- **Prerequisite Gate**: A `processing` task cannot transition out of `Draft` or `Assigned` (e.g. to `In Progress`, `For Review`, `Completed`) while any active `pre_processing` task of the same work request is not `Completed`. Attempting such transition returns HTTP `409 Conflict` (`code: 'PHASE_PREREQUISITE'`).

### Task deletion protection (2026-10-26)

Task deletion requires `workflow:edit` and applies the same checks to all route aliases, including `/v1/tasks/:taskId`:

| Condition | Response |
| --- | --- |
| Parent status is `Completed` or phase is `completion` | `400 COMPLETED_WR_LOCKED` |
| Task phase precedes the parent's current phase | `409 PAST_PHASE_TASK_LOCKED` |
| Task has active uploaded documents, invoices, disbursements (including receipts), or transmittals | `409 TASK_HAS_DOCUMENTS` |
| Parent phase or linked documents cannot be verified | `500` and no deletion |

Document protection returns: “You cannot delete this task because it has documents/receipts.” It applies to Admins too. Soft-deleted records do not count; financial linkage uses canonical `task_id`, falling back to `linked_task_id` only when `task_id` is null. Work-request-wide records without a task link do not block unrelated tasks.

Task list, detail, and embedded work request task responses expose `hasDocuments: boolean`, covering uploaded files and linked financial/transmittal records. The frontend disables removal and shows the reason in both the board and work request edit form. The API rechecks protection on every deletion.

### 2.3 Assignment Dual-Write Discipline (F4 Transition Window)
During the transition window before P3 cutover:
1. Join assignments are inserted into `task_assignees` with attribution (`assigned_by = req.user.id`, `assigned_at = now()`).
2. Legacy task columns `assignee_id` and `assignee_name` receive the primary (first) assignee.
3. Legacy `work_requests.co_assignees` mirrors team member names for vanilla compatibility.
4. Legacy `work_requests.status` is dual-written alongside `phase` in all phase transitions.

---

## 3. RBAC Permissions Matrix

| Key | Granted Roles | Action Scopes |
| :--- | :--- | :--- |
| `workflow:edit` | Admin, Manager, Operations Staff | Create/update work requests, tasks, retainers |
| `workflow:transition_request` | Admin, Manager | Submit phase transition request (`wr_phase_transition`) |
| `workflow:phase_transition` | Admin | Fulfill transition requests, directly advance WR phase |
| `workflow:qa_review` | Admin | Perform task QA compliance evaluation, reroute WR |

---

## 4. Endpoints

### 4.1 Create Work Request Graph (Additive Pipeline)

- **Method**: `POST`
- **Paths**: `/v1/operations/work-requests`, `/v1/work-requests`
- **Guard**: `workflow:edit`
- **Transaction Guarantee**: Entire graph (work request, phases, tokenized tasks, and multi-assignees) executes in a single database transaction. Any failure triggers atomic rollback with zero dangling records.
- **Idempotency**: Honors client-supplied `Idempotency-Key` header or `idempotency_key` in request body. Replaying an identical key returns cached 201 graph with response header `Idempotent-Replay: true`. Retrying after a mid-transaction network abort succeeds without duplicate rows.
- **Delimiter Tokenizer Rule (R4)**: Any task `title` or `description` containing commas `,`, semicolons `;`, newlines `\n`, or period followed by space `. ` is server-tokenized into sibling tasks when $\ge 2$ tokens result. Periods without spaces (e.g. `v1.0.4`, `SEC.gov`) do not split. Raw submitted text is preserved on the first task's note field (`[audit_note] Original submission: ...`). Cumulative token limit is capped at 50 tasks per request (HTTP 400 `TASK_LIMIT_EXCEEDED` beyond 50).
- **Dependency Validation (R3)**: `depends_on` must reference a valid same-WR task by `local_id`. Literal `"0"`, `["0"]`, `[null]`, `""`, cross-WR IDs, and circular dependencies reject with HTTP `400 Bad Request` (`code: 'INVALID_DEPENDENCY'` or `'CIRCULAR_DEPENDENCY'`).

#### Request Body
```json
{
  "title": "Annual Tax Compliance Filing & Audit",
  "description": "Comprehensive annual filing and preliminary audit checklist",
  "clientId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "entity": "ATA",
  "idempotency_key": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "phases": {
    "pre_processing": {
      "tasks": [
        {
          "local_id": "t_intake",
          "title": "Collect BIR 2307 forms",
          "description": "Gather withholding certificates from accounting",
          "assignees": ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
          "depends_on": null,
          "dueDate": "2026-10-15"
        }
      ]
    },
    "processing": {
      "tasks": [
        {
          "local_id": "t_calc",
          "title": "Compute VAT liability, Draft return schedule",
          "description": "Calculate input and output tax schedules",
          "assignees": ["22222222-2222-2222-2222-222222222222"],
          "depends_on": ["t_intake"],
          "dueDate": "2026-10-20"
        }
      ]
    }
  }
}
```

#### Response `201 Created`
```json
{
  "data": {
    "id": "wr-1111-2222-3333-4444",
    "title": "Annual Tax Compliance Filing & Audit",
    "phase": "pre_processing",
    "status": "Draft",
    "phase_entered_at": "2026-10-04T02:00:00.000Z",
    "on_hold": false,
    "client_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "co_assignees": ["Staff Maria", "Staff Juan"],
    "phases": {
      "pre_processing": {
        "tasks": [
          {
            "id": "task-uuid-1",
            "local_id": "t_intake",
            "title": "Collect BIR 2307 forms",
            "phase": "pre_processing",
            "status": "Assigned",
            "qa_status": "none",
            "assigneeId": "11111111-1111-1111-1111-111111111111",
            "assignees": [
              "11111111-1111-1111-1111-111111111111",
              "22222222-2222-2222-2222-222222222222"
            ],
            "taskAssignees": [
              {
                "userId": "11111111-1111-1111-1111-111111111111",
                "assignedBy": "99999999-8888-7777-6666-555555555555",
                "assignedAt": "2026-10-04T02:00:00.000Z"
              },
              {
                "userId": "22222222-2222-2222-2222-222222222222",
                "assignedBy": "99999999-8888-7777-6666-555555555555",
                "assignedAt": "2026-10-04T02:00:00.000Z"
              }
            ],
            "predecessors": []
          }
        ]
      },
      "processing": {
        "tasks": [
          {
            "id": "task-uuid-2",
            "local_id": "t_calc",
            "title": "Compute VAT liability",
            "phase": "processing",
            "status": "Draft",
            "qa_status": "none",
            "description": "Calculate input and output tax schedules\n\n[audit_note] Original submission: Compute VAT liability, Draft return schedule",
            "assignees": ["22222222-2222-2222-2222-222222222222"],
            "predecessors": ["task-uuid-1"]
          },
          {
            "id": "task-uuid-3",
            "local_id": "t_calc_s1",
            "title": "Draft return schedule",
            "phase": "processing",
            "status": "Draft",
            "qa_status": "none",
            "assignees": ["22222222-2222-2222-2222-222222222222"],
            "predecessors": ["task-uuid-1"]
          }
        ]
      }
    }
  }
}
```

---

### 4.2 Submit Phase Transition Request

- **Method**: `POST`
- **Path**: `/v1/operations-requests`
- **Guard**: `workflow:transition_request` (Manager or Admin)
- **Description**: Submits a request to advance a work request to the next phase. Upfront gate check (§3.4) validates that the work request satisfies advancement criteria before the request is created. Emits in-app notification `wr.transition_request.received` to all active Admins.

#### Request Body
```json
{
  "request_type": "wr_phase_transition",
  "work_request_id": "wr-1111-2222-3333-4444",
  "from_phase": "pre_processing",
  "to_phase": "processing",
  "notes": "Pre-processing tasks are completed. Requesting transition to processing."
}
```

#### Response `201 Created`
```json
{
  "data": {
    "id": "req-9999-8888-7777-6666",
    "type": "wr_phase_transition",
    "work_request_id": "wr-1111-2222-3333-4444",
    "requested_by": "88888888-8888-8888-8888-888888888888",
    "status": "pending",
    "notes": "{\"from_phase\":\"pre_processing\",\"to_phase\":\"processing\",\"work_request_id\":\"wr-1111-2222-3333-4444\",\"user_notes\":\"Pre-processing tasks are completed. Requesting transition to processing.\"}",
    "created_at": "2026-10-04T02:05:00.000Z"
  }
}
```

#### Transition Request Resolution: `PUT /v1/operations-requests/:id`
- **Guard**: `workflow:phase_transition` (Admin only; Managers receive `403 Forbidden`)
- **Fulfill (`status: 'fulfilled'`)**: Advances WR phase, dual-writes legacy status, logs audit row, and emits `wr.transition_request.resolved` (`outcome: 'approved'`) to the requester.
- **Reject (`status: 'rejected'`)**: Requires `rejectionReason` (length $\ge 1$; returns 400 Bad Request if missing), marks request rejected, and emits `wr.transition_request.resolved` (`outcome: 'rejected'`, `reason`) to the requester.

---

### 4.3 Direct Advance Work Request

- **Method**: `POST`
- **Paths**: `/v1/operations/work-requests/:id/advance`, `/v1/work-requests/:id/advance`
- **Guard**: `workflow:phase_transition` (Admin only; non-Admin receives `403 Forbidden`)
- **Description**: Advances work request directly to target phase without prior transition request. Verifies gate criteria (§3.4), dual-writes legacy `status`, updates `phase_entered_at`, records audit row (`work_request.phase_advance` with `via: 'direct'`), and emits `wr.transition_request.resolved` with `{ via: 'direct' }`.

#### Request Body
```json
{
  "to_phase": "processing"
}
```
*(Body is optional; if omitted, automatically targets the next sequential phase).*

#### Response `200 OK`
```json
{
  "data": {
    "id": "wr-1111-2222-3333-4444",
    "title": "Annual Tax Compliance Filing & Audit",
    "phase": "processing",
    "status": "In Progress",
    "phase_entered_at": "2026-10-04T02:10:00.000Z"
  }
}
```

#### Error Responses
- `403 Forbidden`: Actor lacks `workflow:phase_transition`.
- `409 Conflict`: Target phase is invalid, skipping intermediate phases, or gate prerequisites are not met (e.g. active tasks incomplete or missing QA pass).

---

### 4.4 QA Review Evaluation

- **Method**: `POST`
- **Paths**: `/v1/operations/work-requests/:id/qa-review`, `/v1/work-requests/:id/qa-review`
- **Guard**: `workflow:qa_review` (Admin only; non-Admin receives `403 Forbidden`)
- **Description**: Evaluates task compliance during `quality_assurance` phase. Sets `qa_status = 'passed' | 'failed'` per task and records audit log row (`work_request.qa_review`).
- **Prerequisite**: Work request must currently be in `quality_assurance` phase (returns `409 Conflict` if in any other phase).

#### Request Body
```json
{
  "results": [
    {
      "task_id": "task-uuid-2",
      "qa_status": "passed"
    },
    {
      "task_id": "task-uuid-3",
      "qa_status": "failed"
    }
  ]
}
```

#### Response `200 OK`
```json
{
  "data": {
    "id": "wr-1111-2222-3333-4444",
    "phase": "quality_assurance",
    "status": "Quality Assurance",
    "phases": {
      "processing": {
        "tasks": [
          {
            "id": "task-uuid-2",
            "qa_status": "passed"
          },
          {
            "id": "task-uuid-3",
            "qa_status": "failed"
          }
        ]
      }
    }
  }
}
```

---

### 4.5 Reroute Work Request

- **Method**: `POST`
- **Paths**: `/v1/operations/work-requests/:id/reroute`, `/v1/work-requests/:id/reroute`
- **Guard**: `workflow:qa_review` (Admin only; non-Admin receives `403 Forbidden`)
- **Description**: Reroutes a work request from `quality_assurance` back to `pre_processing` or `processing`.
  1. Reopens **ONLY** tasks with `qa_status = 'failed'` (resets `status := 'In Progress'`, `qa_status := 'none'`).
  2. Tasks with `qa_status = 'passed'` or `status = 'Cancelled'` remain strictly untouched.
  3. Updates WR phase back to `to_phase` (dual-writing legacy status `In Progress`).
  4. Emits `wr.qa_reroute` in-app notification to all assignees of failed tasks.
  5. Logs audit trail entry (`work_request.reroute`) with before/after state and mandatory reason.
- **Prerequisite**: Work request must be in `quality_assurance` phase (returns `409 Conflict` if not). `reason` is required and non-empty (returns `400 Bad Request` if omitted).

#### Request Body
```json
{
  "to_phase": "processing",
  "reason": "VAT return schedule computation discrepancy on Schedule 3. Recalculate input tax."
}
```

#### Response `200 OK`
```json
{
  "data": {
    "id": "wr-1111-2222-3333-4444",
    "phase": "processing",
    "status": "In Progress",
    "reopened_tasks": [
      "task-uuid-3"
    ]
  }
}
```

---

## 5. Audit Trail Event Schema

All phase mutations record audit events via `auditService.log`:

| Action | Table | Details Payload Shape |
| :--- | :--- | :--- |
| `work_request.created` | `work_requests` | `{ title, phase, client_id, tasks_count }` |
| `work_request.phase_advance` | `work_requests` | `{ from_phase, to_phase, before: { phase, status }, after: { phase, status }, via: 'direct'|'request', request_id }` |
| `work_request.qa_review` | `work_requests` | `{ work_request_id, evaluations: [{ task_id, title, before_qa_status, after_qa_status }] }` |
| `work_request.reroute` | `work_requests` | `{ from_phase: 'quality_assurance', to_phase, reason, reopened_task_ids, before, after }` |
| `operations_request.create` | `operations_requests` | `{ type: 'wr_phase_transition', status: 'pending' }` |
| `operations_request.update` | `operations_requests` | `{ status: 'fulfilled'|'rejected', fulfilledBy }` |

---

## 6. Notification Schema Integration

This parcel integrates the 4 frozen in-app notification types from P0-B:

| Event Trigger | Type | Target Recipients | Payload Shape |
| :--- | :--- | :--- | :--- |
| Transition request created | `wr.transition_request.received` | All active Admins | `{ request_id, work_request_id, wr_title, from_phase, to_phase, requested_by }` |
| Transition request approved | `wr.transition_request.resolved` | Requester | `{ request_id, work_request_id, from_phase, to_phase, outcome: 'approved' }` |
| Transition request rejected | `wr.transition_request.resolved` | Requester | `{ request_id, work_request_id, from_phase, to_phase, outcome: 'rejected', reason }` |
| Direct phase advance | `wr.transition_request.resolved` | WR Creator (`requested_by`) | `{ request_id: null, work_request_id, from_phase, to_phase, outcome: 'approved', via: 'direct' }` |
| Reroute from QA | `wr.qa_reroute` | Assignees of failed tasks | `{ work_request_id, wr_title, to_phase, reason, failed_task_ids }` |
