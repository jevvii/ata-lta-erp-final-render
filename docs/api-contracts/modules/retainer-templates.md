---
module: retainer-templates
contract_version: 2.0.0
frozen_at: 2026-10-04
frozen_by: P0-H
base_url: /v1/operations/templates
---

# /v1/operations/templates — Retainer Templates & Recurrence API Contract

## Overview
Provides reusable templates for recurring client service retainers. Manages template definitions, manual annual recurrence schedules, and idempotent work request graph generation. Template generation reuses the P0-D work request creation pipeline directly to produce full four-phase workflows with anti-duplicate period tracking.

- **Guards:** Authenticated, entity-scoped (`X-Active-Entity: ATA|LTA`).
- **Base Paths:** `/v1/operations/templates` and `/v1/operations/retainer-templates` (aliased under `/v1/work-requests/templates`).
- **Recurrence Doctrine:** Strictly manual; no background scheduler or cron daemons.

---

## 1. RBAC Permissions Matrix

| Endpoint | Action | Allowed Roles | Guard Key |
| :--- | :--- | :--- | :--- |
| `GET /templates` | List active templates | Manager, Admin | `retainers:use` |
| `POST /templates` | Create template | Admin only | `retainers:edit` |
| `PUT /templates/:id` | Update template | Admin only | `retainers:edit` |
| `DELETE /templates/:id` | Delete template | Admin only | `retainers:edit` |
| `POST /templates/:id/generate` | Generate work request | Manager, Admin | `retainers:use` |

---

## 2. Endpoints

### 2.1 `GET /v1/operations/templates`
Lists active (non-deleted) retainer templates for the current entity.

- **Guards:** Authenticated, `retainers:use`.
- **Since-version:** `1.0.0` (recurrence metadata added in `2.0.0`).
- **Events Emitted:** None.

---

### 2.2 `POST /v1/operations/templates`
Creates a new retainer template.

- **Guards:** Authenticated, `retainers:edit` (Admin only).
- **Since-version:** `2.0.0` (P0-E `recurrence` column support).
- **Events Emitted:** None.

#### Request Body (Zod: `retainerTemplateSchema`)
| Field | Type | Required | Default | Description |
| :--- | :--- | :---: | :---: | :--- |
| `name` / `title` | string (1–255) | Yes | — | Template display name |
| `description` | string (max 2000) \| null | No | — | Template description |
| `clientId` / `client_id` | UUID \| null | No | — | Associated client ID |
| `schedule` | string (max 50) \| null | No | — | Schedule description |
| `priority` | string (max 50) \| null | No | `Normal` | Default WR priority |
| `pfAmount` / `pf_amount` | number (non-negative) | No | 0 | Professional fee amount |
| `recurrence` | enum (`none`, `annual`) | No | `none` | Recurrence type |
| `tasks` | array of `taskTemplateSchema` | No | `[]` | Pre-configured task template blueprints |

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Missing title/name or invalid recurrence enum value |
| `403 Forbidden` | `FORBIDDEN` | Missing `retainers:edit` (Manager gets 403) |

---

### 2.3 `PUT /v1/operations/templates/:templateId`
Updates an existing retainer template.

- **Guards:** Authenticated, `retainers:edit` (Admin only).
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.

---

### 2.4 `DELETE /v1/operations/templates/:templateId`
Soft-deletes a retainer template (`deleted_at = now()`).

- **Guards:** Authenticated, `retainers:edit` (Admin only).
- **Since-version:** `1.0.0`.
- **Events Emitted:** None.

---

### 2.5 `POST /v1/operations/templates/:templateId/generate`
Generates a complete phase-model work request from the template, recording a generation entry in `retainer_template_generations`.

- **Guards:** Authenticated, `retainers:use` (Manager and Admin).
- **Since-version:** `2.0.0` (P0-E P0-D pipeline reuse, anti-duplicate period label).
- **Events Emitted:** None.

#### Request Body (Zod: `generateRetainerTemplateSchema`)
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `period_label` / `periodLabel` | string (trimmed, 1–50) | No | Unique recurrence label for the period (e.g. `FY-2026`) |
| `overrides` | object | Yes | Override properties applied to the generated work request; must include a due date |

#### `overrides` Object Schema
| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `title` | string (1–255) | No | Work request title override |
| `description` | string (max 2000) | No | Description override |
| `clientId` / `client_id` | UUID | No | Client ID override |
| `priority` | string (max 50) | No | Priority override |
| `assignedTo` / `assigned_to` | UUID | No | Primary assignee override |
| `coAssignees` / `co_assignees` | array of strings | No | Multi-assignee override |
| `dueDate` / `due_date` | ISO date or timestamp string | Yes (one alias) | Required due date for both retainer and other template generation. Missing, null, empty, or invalid dates return `400 VALIDATION_ERROR`. |

#### Response (201 Created)
Returns generated work request object with embedded `generation` metadata containing `period_label`, `template_id`, and `generated_at`.

#### Error Vocabulary
| Status | Code | Trigger Condition |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR` | Invalid UUID or period label formatting |
| `403 Forbidden` | `FORBIDDEN` | Missing `retainers:use` |
| `404 Not Found` | `NOT_FOUND` | Template ID not found or deleted |
| `409 Conflict` | `DUPLICATE_PERIOD_GENERATION` | Template has already been generated for the specified `period_label` |
