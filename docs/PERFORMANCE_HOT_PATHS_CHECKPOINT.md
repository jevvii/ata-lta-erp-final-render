# Performance Hot Paths — Remaining Work Checkpoint

> Status: the main optimization plan from `PERFORMANCE_NEXT_STEPS.md` is implemented on `uat` branch.
> This document tracks the remaining `DB.*` / localStorage hot paths that still affect render time, INP, or consistency.
> Last updated: 2026-07-19.

## What is already done

- `limit: 1000` removed from all production list calls.
- Modules bundle split into `modules-core` / `modules-billing` / `modules-admin`.
- Total gzipped JS ≤ 250 KB.
- Dashboard uses `GET /v1/reports/dashboard` (≤ 3 API calls).
- `AbortController`, request deduplication, 5-minute TTL caches, route race guard, skeleton overlay.
- Service worker, compression, telemetry helper, `sw-update-available` event.
- Most billing/disbursement/transmittal/users detail lookups moved to API-backed caches.
- **Track A — Tab-badge counts:** `GET /v1/invoices/counts`, `/v1/disbursements/counts`, `/v1/admin/audit/count` added; billing/disbursement/users tab-badge scans removed from the render hot path.
- **Track B — Archive pagination:** `GET /v1/invoices?archived=true` and `/v1/disbursements?archived=true` with server-side pagination; billing/disbursement archive list `DB.getWhere` scans removed.
- **Track C — Workflow linked-record lookups:** `GET /v1/work-requests/:id/related` and `/v1/tasks/:id/related` added; workflow wr-level/task-level invoice/disbursement/transmittal scans replaced with cached API calls.

## Current DB.* inventory

| Module | Remaining `DB.*` calls | Main tables hit |
|---|---|---|
| `workflow.js` | ~75 | `pendingChanges`, `operationsRequests`, `retainerTemplates`, `groundWorkers`, plus a few `documents` / `invoices` / `disbursements` fallbacks |
| `disbursement.js` | ~55 | `disbursements`, `disbursementTemplates`, `pendingChanges`, `operationsRequests`, `invoices`, `workRequests`, `clients`, `users` |
| `billing.js` | ~45 | `invoices`, `billingTemplates`, `pendingChanges`, `operationsRequests`, `workRequests` |
| `pendingChanges.js` | ~39 | `pendingChanges` (helper module) |
| `users.js` | ~31 | `auditLog`, `operationsRequests`, `disbursements`, `invoices`, `transmittals`, `workRequests` |
| `clients.js` | ~10 | `pendingChanges`, `operationsRequests`, `clients` |
| `utils.js` | ~9 | `pendingChanges`, `operationsRequests`, `groundWorkers` (legacy sync helpers) |
| `transmittal.js` | ~7 | `operationsRequests`, `workRequests` (mostly moved to cache) |
| `app.js` / `auth.js` | ~3 each | session/theme/localStorage UI state only |
| `dashboard.js` / `reports.js` / `dms.js` | ~1 each | mostly comments / cold fallback |

### Progress since last checkpoint

Total `DB.*` call sites dropped from ~430 to ~298. The biggest reductions:
- `DB.getWhere`: 99 → 80
- `DB.getById`: 149 → 64 (also reflects helpers rewritten as single reads)
- Invoice/disbursement main/archive list scans moved to backend.
- Workflow per-render linked-record scans moved to backend.

## Tracks for the next agent

Tracks are ordered by **user-facing impact first**, then by risk.

---

### Track A — Module tab-badge counts ✅ COMPLETED

**Implemented:**
- Backend: `GET /v1/invoices/counts`, `GET /v1/disbursements/counts`, `GET /v1/admin/audit/count`.
- Frontend: `_counts` caches, `loadCounts()` pre-fetched in module `render()`, `renderTabNav()` reads counts synchronously.
- Tests: backend 88/88 passing; smoke tests 4/4 source and dist.

**Remaining in this area:**
- `erp_prototype/js/disbursement.js:360` still scans `DB.getWhere('disbursementTemplates', ...)` for the Templates tab count (local-only table).
- `erp_prototype/js/users.js` still computes pending-approvals badge via `getPendingCategories()` → local `pendingChanges` / `operationsRequests` scan.

---

### Track B — Archive list views ✅ COMPLETED (main archive scans)

**Implemented:**
- Backend: `GET /v1/invoices?archived=true&page=&limit=` and `GET /v1/disbursements?archived=true&page=&limit=`.
- Frontend: `renderArchive()` is async, fetches paginated archived records, renders Previous/Next controls.

**Remaining in this area:**
- The "Rejected" archive sections still merge local `pendingChanges` and `operationsRequests` scans (`billing.js:3549-3562`, `disbursement.js:3001-3009`). These are usually small but still localStorage-backed.

---

### Track C — Workflow linked-record lookups ✅ COMPLETED (API path + cache)

**Implemented:**
- Backend: `GET /v1/work-requests/:id/related` → `{ invoices, disbursements, transmittals, documents }`.
- Backend: `GET /v1/tasks/:id/related` → `{ invoices, disbursements }`.
- Frontend: related-record cache per WR/task ID; replaced wr-level and task-level per-render scans.

**Remaining in this area:**
- Cold-path fallbacks `_buildRelatedFromDb()` / `_buildTaskRelatedFromDb()` still contain `DB.getWhere` scans for when the cache is empty or backend fails.
- Workflow still has many other `DB.*` hot paths for `pendingChanges`, `operationsRequests`, `retainerTemplates`, `groundWorkers`.

---

### Track D — Template and reference-data tables

**Problem:** Several modules keep local-only tables that duplicate backend data or are pure UI convenience:

| Table | Used by | Proposed solution |
|---|---|---|
| `billingTemplates` | `billing.js` | Backend has `billing_templates` table; frontend should use API and stop maintaining local copy. |
| `disbursementTemplates` | `disbursement.js` | Add a backend `disbursement_templates` table + CRUD, or treat as local-only UI convenience and keep minimal. |
| `retainerTemplates` | `workflow.js` | Migrate to backend `retainer_templates` table or to a simple in-memory cache (not localStorage). |
| `groundWorkers` | `workflow.js`, `utils.js` | Simple reference list; move to backend `ground_workers` table or to a single in-memory array. |
| `departments` | `users.js`, `auth.js` | Already on `Auth.DEPARTMENTS`; remove `DB.getAll('departments')` fallback. |

**Work:**
1. For `billingTemplates`: switch to `window.apiClient.invoices.listTemplates()` entirely; remove local insert/update/delete sync.
2. For `disbursementTemplates` / `retainerTemplates`: decide whether backend coverage exists. If not, convert localStorage table to an in-memory array (no persistence) or create backend tables + endpoints.
3. For `groundWorkers`: create `GET /v1/ground-workers` and `POST /v1/ground-workers` endpoints; replace localStorage reads/writes.
4. Remove `DB.getAll('departments')` fallback in `users.js:848`.

**Success checkpoint:**
- `billingTemplates` no longer written to localStorage.
- `DB.getAll('departments')` removed.
- `groundWorkers` no longer persisted in localStorage (backend or in-memory only).

---

### Track E — Pending changes and operations requests

**Problem:** `pendingChanges` and `operationsRequests` are local-only tables used for the approval/request workflow across modules. They are read and written heavily.

**Files:**
- `erp_prototype/js/pendingChanges.js`
- `erp_prototype/js/utils.js` (legacy sync helpers)
- Callers in `billing.js`, `disbursement.js`, `clients.js`, `workflow.js`, `users.js`

**Work:**
1. Decide the long-term home:
   - **Option A (recommended):** migrate to backend as a new `approvals` or `requests` module with endpoints like `GET /v1/requests`, `POST /v1/requests`, `PUT /v1/requests/:id/approve`, etc.
   - **Option B:** keep local-only but refactor `pendingChanges.js` into a state module backed by an in-memory Map + `Map`-based filters instead of `localStorage` JSON parse/stringify on every read.
2. If Option A: create backend migration, service, controller, routes; update frontend `apiClient.js`; replace `DB.*` calls module-by-module behind a feature flag if needed.
3. If Option B: rewrite `DB.getWhere('pendingChanges', ...)` and `DB.getWhere('operationsRequests', ...)` to use module-level Maps; keep writes for durability only, batched.

**Success checkpoint:**
- No `DB.getWhere('pendingChanges', ...)` or `DB.getWhere('operationsRequests', ...)` in render/tab-nav/detail hot paths.
- Either backend endpoints exist or the local module uses Map-based lookups.

---

### Track F — Remove `data.js` from production bundles

**Problem:** `data.js` is still bundled into `modules-core` because `clients.js` and `pendingChanges.js` still have `DB.*` fallbacks that may trigger localStorage seed initialization.

**Files:**
- `erp_prototype/js/data.js`
- `erp_prototype/js/clients.js:1236-1249`
- `erp_prototype/js/pendingChanges.js`

**Work:**
1. Remove `clients.js` localStorage import fallback (`erp_prototype/js/clients.js:1236-1249`).
2. Ensure `pendingChanges.js` does not depend on `data.js` initialization.
3. Move `data.js` out of `modules-core` in `build.js` and load it only for demo/offline builds (or delete it if no longer needed).

**Success checkpoint:**
- `data.js` not included in production `modules-core` bundle.
- `modules-core` gzipped size drops further.
- Demo mode (if any) still works.

---

### Track G — Synchronous form/detail paths

**Problem:** Some detail views and forms still read `DB.getById` synchronously because the form panel contract expects a DOM node immediately.

**Files:**
- `erp_prototype/js/billing.js:16-18` (`getInvoiceById` fallback)
- `erp_prototype/js/disbursement.js:1265-1266` (`renderForm`)
- `erp_prototype/js/billing.js:3193` (template form)
- `erp_prototype/js/disbursement.js:2707` (template form)

**Work:**
1. For each, decide if it is a legitimate cold-path fallback or a hot path.
2. Hot paths: fetch the record asynchronously in the render entry point and then render the form.
3. Cold paths: keep the `DB.getById` fallback but ensure it is only hit when the API record is not in cache.

**Success checkpoint:**
- Form/detail renderers that are opened frequently do not block on `DB.getById`.

---

## Recommended next implementation order

Tracks A/B/C are done. The next agent should start from:

1. **Track D** — templates/ground workers/departments (reference data cleanup; low risk, high repetition).
2. **Track G** — synchronous form/detail paths (UI responsiveness; medium risk because of form-panel contracts).
3. **Track E** — pending changes / operations requests (largest change; gated by backend design decision).
4. **Track F** — remove `data.js` from bundle (final cleanup once DB.* fallbacks are gone).

## Measurement checkpoints

After each track:

- [ ] `npm run build:prod` succeeds and total gzipped JS ≤ 250 KB.
- [ ] `cd backend && npm test` passes 88/88.
- [ ] Source smoke test passes (`node dev-server.js` + `node smoke-dev.js`).
- [ ] Dist smoke test passes (`ERP_SERVE_DIST=1 PORT=8081 node dev-server.js` + `BASE_URL=http://localhost:8081 node smoke-dev.js`).
- [ ] `node -c` passes for every modified `.js` file.
- [ ] No new `limit: 1000` or larger client-side limits introduced.
- [ ] Route switch telemetry shows no regression.

## Global constraints to preserve

- Stay vanilla JS/CSS (no React/Vue/Svelte).
- Preserve `window.*` global contracts until an explicit module migration is planned.
- Do not commit or push unless explicitly asked.
- Do not use Playwright for automated testing.
- Keep API response shapes backward-compatible.
- Any new backend endpoint must have tests or be exercised by existing tests.

## Quick commands for the next agent

```bash
# Audit remaining DB.* usage by module
cd /home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype/js
for f in billing.js disbursement.js users.js workflow.js clients.js pendingChanges.js utils.js; do
  echo "--- $f ---"
  grep -on "DB\.[a-zA-Z_]*" "$f" | sort | uniq -c | sort -rn
done

# Run the test matrix
cd /home/javvii/FreelanceProject/Project4_Final-Render/backend && npm test
cd /home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype && npm run build:prod
cd /home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype && node dev-server.js & sleep 2 && node smoke-dev.js
cd /home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype && ERP_SERVE_DIST=1 PORT=8081 node dev-server.js & sleep 2 && BASE_URL=http://localhost:8081 node smoke-dev.js
```
