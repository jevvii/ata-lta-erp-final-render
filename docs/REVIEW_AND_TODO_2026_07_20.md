# ERP Prototype — Incident Review & Remaining Work Plan

**Date:** 2026-07-20  
**Branch:** `uat`  
**Scope:** Console/Network errors reported in the browser, plus remaining performance work identified in `PERFORMANCE_LOADING_SPEED_TODO.md`.  
**Status:** Six critical runtime issues resolved by parallel subagents. No commits made. No Playwright used.

---

## 1. Executive Summary

This review consolidates fixes applied to six production-blocking runtime defects discovered through browser DevTools logs, and maps them to the broader performance plan.  

All six root causes were localized to mismatches between the frontend SPA, the backend Express API, and the remote Supabase schema state:

| # | Symptom (browser console / network) | Severity | Root cause class | Fixed in |
|---|-------------------------------------|----------|------------------|----------|
| 1 | `Unable to list retainer templates` + `GET /v1/work-requests/templates` 500 | **High** | Missing remote migrations | DB only |
| 2 | `NS_ERROR_DOM_CORP_FAILED` on `/v1/work-requests/{id}/related` | **High** | Helmet default CORP header blocked cross-origin API | `backend/src/app.js` |
| 3 | `Work request entity must match active entity` on PUT | **High** | Frontend sent immutable `entity` + used `ALL` active entity | `erp_prototype/js/workflow.js`, `apiClient.js` |
| 4 | `Failed to fetch disbursement templates` + `GET /v1/disbursements/templates` 500 | **High** | Backend joined `clients(name)` on table with no `client_id` | `backend/src/modules/disbursements/service.js`, `erp_prototype/js/disbursement.js` |
| 5 | `limit: Number must be less than or equal to 100` on admin audit | **Medium** | Frontend requested 1000 rows; backend limit is 100 | `erp_prototype/js/users.js` |
| 6 | `Weekly report failed route-change` at `reports.js:479` | **Medium** | Abort-error detection was brittle | `erp_prototype/js/reports.js`, `apiClient.js` |

All changes preserve the existing global-variable SPA architecture (`window.apiClient`, `window.WorkflowData`, `window.Reports`, etc.) and do not introduce a module bundler or framework.

---

## 2. Chronological Review of Resolved Issues

### 2.1 `GET /v1/work-requests/templates` — 500 / "Unable to list retainer templates"

**DevTools anchor**
- Console: `[Workflow] failed to load retainer templates Error: Unable to list retainer templates`
- Call stack: `workflow.js:659` → `window.apiClient.operations.listTemplates()` → `GET /v1/work-requests/templates`

**Symptom**
The Workflow page tried to load retainer templates and received HTTP 500.  The UI logged the exact `AppError` detail returned by the backend.

**Root cause**
`public.retainer_templates` did not exist on the remote Supabase database. `remote_migrations` showed the schema only through `022-create-transmittals-tables.sql`. The Phase 7 migrations and the JS performance/dashboard migrations had never been applied:

- `000020_performance_indexes.js`
- `000021_dashboard_summary_rpc.js`
- `024-create-disbursement-templates.sql`
- `025-create-retainer-templates.sql`
- `026-create-ground-workers.sql`
- `027-add-linked-task-id.sql`

When `operationsService.listRetainerTemplates` queried the missing table, Supabase threw an error, which the service wrapped as `AppError("Unable to list retainer templates")`.

**Fix applied**
Ran `node scripts/migrate-remote.js local` from `/home/javvii/FreelanceProject/Project4_Final-Render/backend`, applying the six pending migrations. Verified `public.retainer_templates` exists with the expected columns and foreign key to `clients(id)`. Verified the REST query `retainer_templates?select=*,clients(name)` now returns HTTP 200.

**Files changed**
No repository source files were modified. The fix was database-only.

**Verification steps**
1. Query migration state for the six migration names in `remote_migrations`.
2. Confirm `retainer_templates` exists in `information_schema.tables`.
3. Run backend operations integration tests: `cd backend && npm test -- tests/integration/operations.test.js`.
4. Open the SPA workflow page; the console error should be gone.

> **Watch item:** The backend currently returns raw snake_case fields (`entity_id`, `client_id`, `pf_amount`) while the frontend expects `entity`, `clientId`, `pfAmount`. The 500 is resolved, but entity-scoped filtering may still be ineffective until the service maps rows to the camelCase shape the SPA expects.

---

### 2.2 `GET /v1/work-requests/{id}/related` — `NS_ERROR_DOM_CORP_FAILED`

**DevTools anchor**
- Console: `NS_ERROR_DOM_CORP_FAILED` (Firefox) / equivalent CORP failure in other browsers
- Network tab: `GET /v1/work-requests/{id}/related` blocked before body use

**Symptom**
Opening a work request and fetching related financial/document data failed at the browser security layer, not the application layer.

**Root cause**
Helmet's default `Cross-Origin-Resource-Policy: same-origin` header was attached to every API response. The SPA origin differs from the API origin in both development (`localhost:8080` → `localhost:3000`) and production (separate Render services). A cross-origin `fetch()` therefore failed the browser CORP check before JavaScript could read the response.

The route itself (`/:id/related`) was wired correctly; only the header was wrong.

**Fix applied**
In `backend/src/app.js`, changed:

```js
app.use(helmet())
```

to:

```js
app.use(helmet({ crossOriginResourcePolicy: false }))
```

All other Helmet headers remain active. CORS, auth, entity scoping, and routing were left untouched.

**Files changed**
- `/home/javvii/FreelanceProject/Project4_Final-Render/backend/src/app.js`

**Verification steps**
1. Start backend on a non-default port, e.g. `PORT=3001 node src/app.js`.
2. `curl` the related endpoint from a different origin with dummy token and `X-Active-Entity: ATA`.
3. Confirm `Access-Control-Allow-Origin` is present and `Cross-Origin-Resource-Policy` is absent.
4. Open SPA in Firefox, navigate to a work request, confirm no `NS_ERROR_DOM_CORP_FAILED` and related data loads.
5. Run backend operations integration tests.

---

### 2.3 `PUT /v1/work-requests/{id}` — 400 "Work request entity must match active entity"

**DevTools anchor**
- Console: `Failed to update work request Error: Work request entity must match active entity`
- Network: `PUT /v1/work-requests/{id}` returns 400
- Call stack: `workflow.js` `updateWorkRequest()`

**Symptom**
Managers/admins with consolidated `ALL` entity access could not update a work request's status or board order.

**Root cause**
`WorkflowData.updateWorkRequest()` sent the full merged record, including the concrete `entity` field (e.g. `ATA` or `LTA`), in the PUT body. The `X-Active-Entity` header came from the global `Auth.activeEntity`. When the user selected `ALL`:

- `entityScope` allowed `ALL`.
- `resolveEntity()` fell back to the user's first real entity but kept `req.entityCode` as `ALL`.
- The controller compared `payload.entity` (`ATA`/`LTA`) to `req.entityCode` (`ALL`) and rejected the request.

**Fix applied**
Two coordinated frontend changes:

1. `apiClient.js` — `request()` now only sets `X-Active-Entity` if the caller did not already supply one. `put()` and `window.apiClient.workRequests.update()` accept an optional third `options` argument for custom headers, remaining backward-compatible.
2. `workflow.js` — `updateWorkRequest()` now:
   - strips `entity` from the local state and from the PUT payload,
   - scopes the request to the record's own entity by passing `headers: { 'X-Active-Entity': existing.entity }`,
   - falls back to `Auth.activeEntity` only if the record has no entity.

**Files changed**
- `/home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype/js/workflow.js`
- `/home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype/js/apiClient.js`

**Verification steps**
1. `node --check` both modified files.
2. Run backend operations integration tests (`PORT=0 npx jest tests/integration/operations.test.js --runInBand`).
3. In browser, sign in as a multi-entity user, set global entity to `ALL`, open a work request, change status or board order. DevTools should show:
   - PUT body without `entity`,
   - `X-Active-Entity` matching the work request's concrete entity,
   - `200 OK` response.

---

### 2.4 `GET /v1/disbursements/templates` — 500 / "Failed to fetch disbursement templates"

**DevTools anchor**
- Console: `Failed to fetch disbursement templates`
- Network: `GET /v1/disbursements/templates` returns 500

**Symptom**
The Disbursement module Templates tab failed to load.

**Root cause**
`listDisbursementTemplates` in `backend/src/modules/disbursements/service.js` queried `disbursement_templates` with `.select('*, clients(name)')`. That table has no `client_id` column; its foreign keys are `entity_id`, `linked_work_request_id`, and `linked_invoice_id`. Supabase/PostgREST could not resolve the relationship and returned a database error.

Additionally, the frontend's `normalizeTemplate` mapped `entity_id` (a UUID) directly to the `entity` field, while the rest of the UI filters by entity code (`ATA`/`LTA`). Even after the 500 was fixed, templates would have disappeared from entity-scoped filters without the frontend change.

**Fix applied**
1. Backend — replaced the invalid `clients(name)` join with a valid `entities(code)` join in `listDisbursementTemplates`, `createDisbursementTemplate`, and `updateDisbursementTemplate`.
2. Frontend — updated `normalizeTemplate` to derive `entity` from `entities.code` / `entity_code` first, falling back to `entity` / `entity_id`, so filtering by `ATA`/`LTA` works.

**Files changed**
- `/home/javvii/FreelanceProject/Project4_Final-Render/backend/src/modules/disbursements/service.js`
- `/home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype/js/disbursement.js`

**Verification steps**
1. Run backend disbursement tests: `cd backend && npm test -- --testPathPattern="disbursements"` (18 tests).
2. Open Disbursement module → Templates tab; confirm no console error.
3. Verify `GET /v1/disbursements/templates` returns 200 with `entities: { code: 'ATA' | 'LTA' }` on each row and correct entity-scoped rendering.

---

### 2.5 `GET /v1/admin/audit?limit=1000` — 400 "limit: Number must be less than or equal to 100"

**DevTools anchor**
- Console: validation error from admin audit endpoint
- Network: `GET /v1/admin/audit?limit=1000` returns 400
- Call stack: `Users.refreshAuditLog`

**Symptom**
The Audit Log under Users failed to load when more than 100 audit rows were requested.

**Root cause**
`Users.refreshAuditLog` called `window.apiClient.admin.listAudit({ limit: 1000 })`, but the backend `admin` module's `listAuditQuerySchema` enforces `limit <= 100`. The frontend was still using an old "fetch up to 1000 rows for client-side filtering" assumption.

**Fix applied**
Replaced the single `limit: 1000` request with a pagination loop:

- Fetch `limit: 100` (the backend maximum) repeatedly.
- Advance `offset` until `res.meta.hasMore` is false.
- Concatenate all paged results into `allLogs` before applying existing client-side filters, search, sort, and rendering.

**Files changed**
- `/home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype/js/users.js`

**Verification steps**
1. `node --check erp_prototype/js/users.js`.
2. Run backend audit tests: `cd backend && npm test -- admin-pending-audit.test.js` (9 tests, including `limit=200` rejection).
3. In browser, open Users → Audit Log; confirm no validation error and filters/sort work across the full log set.

---

### 2.6 `Weekly report failed route-change` — `reports.js:479`

**DevTools anchor**
- Console: `Weekly report failed route-change` at `reports.js:479`
- Call stack: async report refresh aborted by `App.handleRoute()`

**Symptom**
Navigating away from Reports before an in-flight request completed logged a false error and rendered a red error state.

**Root cause**
`App.handleRoute()` calls `window.apiClient.abortRequests('route-change')`. `apiClient.request()`'s pre-flight abort path threw a plain `Error` with message `route-change` but `name` left as `Error`. `reports.js` only suppressed errors matching `e.message === 'route-change'` or `e.name === 'AbortError'`. In some browser/environments the detection failed, so the abort leaked to `console.error('Weekly report failed', e)` at line 479.

The backend weekly route and data were correct; only abort detection was brittle.

**Fix applied**
1. `reports.js` — added `Reports.isAbortError(e)` helper that detects:
   - native `AbortError`,
   - `route-change` / `Request aborted` messages from `apiClient`,
   - message/reason variants containing `AbortError`.
   Replaced the brittle guard in all four report catch blocks (analytics, daily, weekly, monthly pending) with `this.isAbortError(e)`.
2. `apiClient.js` — pre-flight aborts now throw an `Error` whose `name` is explicitly set to `AbortError`, making abort guards more reliable everywhere.

**Files changed**
- `/home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype/js/reports.js`
- `/home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype/js/apiClient.js`

**Verification steps**
1. `node --check` both modified files.
2. Open SPA → Reports → Weekly Summary, quickly navigate away before loading completes.
3. Confirm console no longer shows `Weekly report failed route-change` and reports pane does not show red error state.
4. Return to Weekly Summary and verify normal load.

---

## 3. Remaining Work / Implementation Plan

The runtime fixes above unblock users, but the performance plan in `docs/PERFORMANCE_LOADING_SPEED_TODO.md` remains the next priority. The table below is ordered by impact/risk, reusing the task identifiers from the performance TODO.

| Order | Task | Impact | Effort | Risk | Why it matters now |
|-------|------|--------|--------|------|------------------|
| 1 | **1.1 Auth profile caching + query merge** | CRITICAL | Medium | Low | Every one of the six fixed issues above involved an API round-trip. Removing ~200-500 ms of auth overhead per request multiplies across all list/template/related/audit/report calls. |
| 2 | **1.2 HTTP Keep-Alive on Supabase client** | HIGH | Low | Low | The CORP fix, audit pagination loop, and report abort path all issue many short-lived requests. Connection reuse cuts TCP/TLS overhead. |
| 3 | **1.3 Cache-Control headers for GETs** | HIGH | Low | Low | Prevents browsers from re-fetching static lists (templates, clients, audit logs) on every route change. |
| 4 | **2.1 Production build pipeline integration** | CRITICAL | Low | Low | Dev currently serves 1.58 MB unminified JS; production bundle is ~450 KB and already implemented in `build.js`. |
| 5 | **2.2 Lazy bundle loading in dev mode** | HIGH | Medium | Medium | Avoid loading billing/disbursement/users/reports/profile/DMS bundles until the route needs them. Must preserve `window.*` globals. |
| 6 | **2.3 Critical CSS + deferred loading** | HIGH | Medium | Low | 387 KB CSS is render-blocking. Inline ~5 KB critical CSS and load the rest asynchronously. |
| 7 | **2.4 Resource hints (preload/preconnect)** | MEDIUM | Low | Low | Preload `utils.js`, `apiClient.js`, `auth.js`; preconnect API origin. |
| 8 | **3.1 Clients DB pagination** | HIGH | Medium | Low | Operations and clients lists currently fetch all rows; move pagination and search to DB with `.range()` and `.ilike()`. |
| 9 | **3.2 Operations N+1 fix** | HIGH | High | Medium | Work-requests list fetches all WRs then all tasks; restrict task fetch to paginated subset using `.in('work_request_id', wrIds)`. |
| 10 | **3.3 Billing/Disbursement pagination guard** | MEDIUM | Low | Low | Enforce `limit=50, max=200` defaults; audit templates already showed the risk of oversized requests. |
| 11 | **1.4 Entity ID/code lookup caching** | MEDIUM | Low | Low | `resolveEntityId()` / `resolveEntityCode()` hit DB per call; 10-min in-memory TTL is safe because entities are static. |
| 12 | **5.1 Parallel dashboard badge counts** | MEDIUM | Low | Low | `updateSidebarNotifications` awaits counts sequentially; use `Promise.allSettled()`. |
| 13 | **4.1 Service worker cache cleanup** | LOW | Low | Low | Remove deleted `/js/logos.js` from `SHELL_URLS`, bump `CACHE_VERSION` to `v2`. |
| 14 | **4.2 Cache-busting version bump** | LOW | Low | Low | Force re-cache of updated assets after the above changes. |
| 15 | **Retainer template API-shape mismatch** | MEDIUM | Low | Low | Follow-up from §2.1: map `entity_id`/`client_id`/`pf_amount` to `entity`/`clientId`/`pfAmount` in `operationsService.listRetainerTemplates`, or update SPA expectations. |

### 3.1 Suggested next sprint (do first)

1. Implement **Task 1.1–1.4** (auth/middleware caching + keep-alive + Cache-Control + entity lookup cache). These are low-risk, high-impact, and touch the same `app.js` / `auth.js` files already modified for the CORP fix.
2. Implement **Task 2.1–2.4** (build integration, lazy bundles, critical CSS, resource hints). Coordinate with the retainer-template shape fix so lazy-loaded `workflow.js` receives the expected API response.
3. Implement **Task 3.1–3.3** (DB pagination). Validate against the disbursement/operations integration tests.
4. Tackle **Task 5.1** and service-worker cleanup last.

---

## 4. Performance Metric Mapping

The table below maps each resolved issue and each remaining task to the forecasted performance metrics from `PERFORMANCE_LOADING_SPEED_TODO.md`.

| Issue / Task | Affected metric(s) | Before | After target |
|--------------|--------------------|--------|--------------|
| **Resolved: retainer templates 500** | Per-request failure rate, user-perceived reliability | 100% failure on Workflow load | 0% failure; templates load in one round-trip |
| **Resolved: CORP failure** | Per-request failure rate on cross-origin API | Cross-origin related-data requests blocked | All related-data requests complete; no extra latency |
| **Resolved: PUT entity mismatch** | Mutation latency / user friction | Every update blocked under `ALL` entity | Updates succeed in one request |
| **Resolved: disbursement templates 500** | Per-request failure rate, entity-filter accuracy | 100% failure; would have filtered incorrectly | 0% failure; correct `ATA`/`LTA` grouping |
| **Resolved: audit `limit=1000` 400** | Audit load reliability, payload size | Audit log failed; attempted 1000-row transfer | Fetches only needed 100-row pages; full log available via pagination |
| **Resolved: weekly report abort leak** | Error-state noise, perceived stability | False error on every fast navigation | Silent cancellation; no false error state |
| **Task 1.1 Auth profile caching** | Auth middleware per-request overhead | ~300-500 ms | ~5-50 ms (cached) |
| **Task 1.2 Keep-Alive** | TCP/TLS setup per Supabase request | New connection each request | Reused connection; ~50-150 ms saved per request |
| **Task 1.3 Cache-Control** | Repeat list fetch overhead | Full re-fetch on every route change | `private, max-age=30` for lists; immediate cache hits |
| **Task 2.1 Production build** | Initial JS payload | ~1.58 MB across 19 files | ~450 KB in 3 core bundles |
| **Task 2.2 Lazy dev bundles** | Initial JS payload in dev | Same 1.58 MB | Only core modules load initially |
| **Task 2.3 Critical CSS** | CSS blocking time | 387 KB parse-blocking | ~5 KB critical inline, full CSS deferred |
| **Task 2.4 Resource hints** | Time-to-first-byte for critical assets | Assets discovered after HTML parse | Preloaded/prepared ahead of parse |
| **Task 3.1 Clients DB pagination** | API list response time | ~500 ms+ fetching all rows | ~50-100 ms paginated |
| **Task 3.2 Operations N+1** | Work-request list latency | All WRs + all tasks fetched and filtered in memory | Single paginated WR query + one batched task query |
| **Task 3.3 Billing/Disbursement pagination guard** | Payload size / memory | Up to 1000 rows possible | Capped at 200 rows per request |
| **Task 5.1 Parallel badge counts** | Dashboard total load time | Sequential awaits | Parallel fetches; ~100-300 ms saved |
| **Task 4.1 / 4.2 Service worker** | Repeat visit load time | Full re-fetch | Instant from cache |
| **Retainer shape mismatch follow-up** | Template filtering accuracy | Templates present but invisible in entity filters | Correct mapping and visible filtering |

---

## 5. Notes for the Next Agent

1. **Do not break the global-variable architecture.** All modules expose themselves on `window.*` (`window.apiClient`, `window.WorkflowData`, `window.Reports`, `window.Users`, etc.). Any bundling or lazy-loading must keep this contract intact.
2. **Auth changes are high blast-radius.** The auth middleware is the gateway for every API request. Profile caching must invalidate when users are deactivated, roles change, or departments are updated.
3. **Supabase/PostgREST conventions.** Use `.range(offset, offset + limit - 1)` for pagination, not raw SQL LIMIT/OFFSET. Use `.in()` for batched relational queries.
4. **Entity scoping is mandatory.** Every list query must filter by `entity_id` / `entity_code`. The PUT fix in `workflow.js` shows the correct pattern: scope the request header to the record's own entity, not the global selector.
5. **Continue to avoid Playwright** unless explicitly requested. Use `node --check`, Jest integration tests, and manual browser verification.
6. **Do not commit yet.** The `uat` branch currently has uncommitted changes from these fixes and the prior performance TODO. Coordinate with the team before committing/pushing.
7. **Migration discipline.** Always run `node scripts/migrate-remote.js local` (or the appropriate environment target) after pulling new migrations. The retainer-templates incident happened because migrations were in the repo but not applied remotely.
8. **Cross-origin testing.** Use `curl -H 'Origin: ...'` to verify CORS and CORP headers after any Helmet/CORS change.
9. **Abort-error consistency.** Future abort guards should use `e.name === 'AbortError'` or the `isAbortError` pattern added in `reports.js`; if adding new abort paths in `apiClient.js`, set the thrown error's `name` to `'AbortError'`.

---

## 6. Quick Reference: Files Touched by This Round

| File | Why it changed |
|------|----------------|
| `backend/src/app.js` | Disabled Helmet CORP header; CORS unaffected |
| `backend/src/modules/disbursements/service.js` | Fixed invalid `clients(name)` join; replaced with `entities(code)` |
| `erp_prototype/js/workflow.js` | Strips `entity` from PUT; sends per-record `X-Active-Entity` |
| `erp_prototype/js/apiClient.js` | Allows per-request header overrides; abort errors named `AbortError` |
| `erp_prototype/js/disbursement.js` | `normalizeTemplate` derives `entity` from entity code |
| `erp_prototype/js/users.js` | Audit log pagination loop (`limit: 100`) |
| `erp_prototype/js/reports.js` | Robust `isAbortError()` helper across all report catch blocks |
| `backend/src/modules/operationsRequests/service.js` | Skip `entity_id` filter when `entityId === 'ALL'` in counts/list |
| `backend/src/modules/operations/routes.js` | Allow `ALL` active entity for `GET /work-requests/:id/related` |
| `backend/src/modules/operations/service.js` | Derive real entity from parent row when `ALL`; scope related records |
| `backend/src/modules/transmittals/service.js` | Skip `entity_id` filter for `ALL`; map `entity_code` |
| `backend/src/modules/transmittals/controller.js` | Added `countTransmittals` / `GET /v1/transmittals/counts` |
| `backend/src/modules/transmittals/routes.js` | Use `resolveEntity({ allowAll: true })` |
| `erp_prototype/js/transmittal.js` | Use counts endpoint for tab badges; `normalizeTransmittal` uses backend `entity_code` |
| `erp_prototype/js/dashboard.js` | Switch `Auth.activeEntity` to record entity before routing from schedule |

---

## 7. Additional Fixes Applied After Initial Review (2026-07-20)

After the initial six issues were documented, three additional consolidated-view and navigation defects were found and fixed by parallel subagents.

| # | Symptom | Root cause class | Fixed in |
|---|---------|------------------|----------|
| 7.1 | Consolidated `ALL` entity view does not aggregate across entities; `operations-requests/counts?entityId=ALL` returns 500; `work-requests/{id}/related` returns 404 for non-default entity records | `ALL` string treated as a real UUID; related endpoint rejected `ALL` active entity | `backend/src/modules/operationsRequests/service.js`, `backend/src/modules/operations/routes.js`, `backend/src/modules/operations/service.js` |
| 7.2 | Inner tab nav total indicators are inaccurate (e.g. Transmittals tab shows `0` when transmittals exist) | Badge counts derived from paginated list; backend did not honor `ALL` selector | `backend/src/modules/transmittals/service.js`, `backend/src/modules/transmittals/controller.js`, `backend/src/modules/transmittals/routes.js`, `erp_prototype/js/apiClient.js`, `erp_prototype/js/transmittal.js` |
| 7.3 | Dashboard calendar/schedule item clicks clear the view instead of routing to the corresponding page | `ALL` active entity persisted when routing to per-entity detail pages | `erp_prototype/js/dashboard.js` |

### 7.1 Consolidated `ALL` entity view — 500 on counts, 404 on related

**Symptom**
The consolidated `ALL` entity selector, meant to let managerial users view records across both ATA and LTA, failed in two ways:
- `GET /v1/operations-requests/counts?entityId=ALL` returned HTTP 500.
- `GET /v1/work-requests/{id}/related` returned HTTP 404 for work requests belonging to the user's non-default entity.

**Root cause**
`resolveEntity({ allowAll: true })` keeps `req.activeEntity` as the string `'ALL'`, but the `operationsRequests` service treated any truthy `entityId` as a real UUID and ran `.eq('entity_id', 'ALL')`, causing a database type error. Its `listRequests` method had the same bug, so the consolidated view never aggregated.

Separately, `GET /v1/work-requests/:id/related` used `resolveEntity()` without `allowAll`, so in `ALL` mode it fell back to the user's first real entity and could not find work requests from the other entity. The related service also required a UUID entity filter on every related query, so it could not handle the `ALL` case even when the work request itself was found.

**Fix applied**
- In `backend/src/modules/operationsRequests/service.js`, skip the `entity_id` equality filter when `entityId === 'ALL'` in both `listRequests` and `getCounts`, so consolidated counts/lists aggregate across both accessible entities.
- In `backend/src/modules/operations/routes.js`, changed `GET /work-requests/:id/related` to use `resolveEntity({ allowAll: true })`.
- In `backend/src/modules/operations/service.js`, updated `getWorkRequestRelated` and `getTaskRelated` to fetch the parent record without an entity filter when `entityId` is `ALL`/null, derive the real entity UUID from the returned row, and scope the related invoices, disbursements, transmittals, and documents to that entity.

**Files changed**
- `backend/src/modules/operationsRequests/service.js`
- `backend/src/modules/operations/routes.js`
- `backend/src/modules/operations/service.js`

**Verification steps**
1. Sign in as a manager/admin with access to both ATA and LTA, switch to "Consolidated View", and open the browser Network tab.
2. Confirm `GET /v1/operations-requests/counts?entityId=ALL` returns 200 with aggregated `total`, `pending`, `fulfilled`, `rejected`, and `awaitingFulfillment` counts from both entities.
3. Navigate to Operations, open a work request whose entity is the user's non-default entity, and confirm `GET /v1/work-requests/{id}/related` returns 200 with related invoices, disbursements, transmittals, and documents.
4. Confirm `GET /v1/operations-requests` returns 200 and includes records from both entities when the active entity is `ALL`.
5. Run the backend test subset: `PORT=0 npx jest tests/operationsRequests.test.js tests/integration/operations.test.js --runInBand`.

### 7.2 Transmittals inner tab badge counts — inaccurate totals / `0` badge

**Symptom**
The Transmittals module's inner tab badge showed `0` even when transmittals existed, and the badge did not reflect the consolidated view.

**Root cause**
The Transmittal module computed its inner tab badge counts by loading the paginated `/transmittals` list and counting active/archived rows in memory. The backend list endpoint always filtered by a single resolved entity UUID and did not honor the consolidated `ALL` selector, so in `ALL` mode the frontend either fell back to one entity or had to merge per-entity pages.

**Fix applied**
- Backend `listTransmittals` now skips the `entity_id` filter when `entityId === 'ALL'` and maps each row's `entity_id` to an `entity_code` for the SPA.
- Added backend `countTransmittals` and new `GET /v1/transmittals/counts` endpoint returning `{ active, archived, total }` with `ALL` support.
- Transmittals router now uses `resolveEntity({ allowAll: true })`.
- `apiClient.transmittals.counts()` added with the same `cachedCount` pattern used for invoices/disbursements; mutations invalidate the count cache.
- `Transmittal._getCounts()` now consumes the counts endpoint instead of deriving counts from a paginated list fetch.
- `Transmittal._listForActiveEntity()` simplified to a single backend call now that the backend handles `ALL`.
- `normalizeTransmittal()` prefers the backend-supplied `entity_code`/`entityCode` so rows keep their real ATA/LTA code in consolidated mode.

**Files changed**
- `backend/src/modules/transmittals/service.js`
- `backend/src/modules/transmittals/controller.js`
- `backend/src/modules/transmittals/routes.js`
- `erp_prototype/js/apiClient.js`
- `erp_prototype/js/transmittal.js`

**Verification steps**
1. Run `node --check` on the five modified JS files.
2. Run backend transmittal unit tests: `cd backend && npx jest tests/unit/modules/transmittals/service.test.js --runInBand`.
3. Sign in as a user with access to both ATA and LTA, select "Consolidated View" (`ALL`), and open the Transmittals module.
4. Confirm the "Transmittals" tab badge reflects the active transmittal count across both entities.
5. Create, send, or acknowledge a transmittal and verify the badge updates within the 30-second cache window or after a route refresh.
6. Switch the entity selector to a single entity and confirm the badge shows only that entity's count.

### 7.3 Dashboard schedule-item routing — view clears on click

**Symptom**
Clicking "View Tasks" or "View Disbursement" on a dashboard calendar/schedule item cleared the view instead of routing to the corresponding detail page.

**Root cause**
The consolidated `ALL` entity selector is only meant to return true consolidated data on `#dashboard` and `#reports`. Every other module expects a real entity (`ATA` or `LTA`). When a user in consolidated mode clicked a schedule item button, `dashboard.js` changed `location.hash` to the per-entity detail route but left `Auth.activeEntity === 'ALL'`. The backend's entity resolver then fell back to the user's first real entity for non-consolidated endpoints, so records from the other entity became invisible to the target module. The module could not find the record, fell back to its list view, and the content area appeared to clear.

**Fix applied**
- Added `Dashboard._switchToItemEntity(item)` helper that switches `Auth.activeEntity` to the record's own entity before routing, falling back to the user's first real entity if the record has no entity.
- Updated the schedule sidebar "View Tasks" / "View Disbursement" button handlers to call `_switchToItemEntity(item)` before setting the detail hash.
- The helper re-renders the entity switcher and updates the entity badge so the UI stays in sync with the new active entity.

**Files changed**
- `erp_prototype/js/dashboard.js`

**Verification steps**
1. Sign in as a user with access to both `ATA` and `LTA` (Admin or Manager).
2. Select "Consolidated View" in the entity switcher and open the Dashboard.
3. In the calendar sidebar, expand a work request that belongs to the non-default entity and click "View Tasks"; confirm the URL becomes `#operations/detail/<id>`, the entity badge switches to the record's entity, and the work-request detail renders.
4. Repeat for a disbursement and confirm it routes to `#disbursement/detail/<id>` and renders the disbursement detail.
5. Switch back to an entity-scoped dashboard and verify schedule-item routing still works normally.

### 7.4 Remaining Work from this round

1. **Apply the consolidated `ALL` pattern to any remaining modules** that still treat `entityId === 'ALL'` as a literal UUID or reject it. Operations-requests, transmittals, dashboard, and the original workflow/disbursement fixes show the pattern; clients, billing, users, and DMS lists should be audited for the same bug.
2. **Run backend test subsets** for operations-requests and transmittals before committing:
   - `PORT=0 npx jest tests/operationsRequests.test.js tests/integration/operations.test.js --runInBand`
   - `npx jest tests/unit/modules/transmittals/service.test.js --runInBand`
3. **Verify count cache invalidation** for transmittals under both `ALL` and single-entity modes; the 30-second cache window may delay badge updates if mutations do not explicitly invalidate.
4. **Audit dashboard schedule items** for other record types (invoices, transmittals, tasks) to ensure `_switchToItemEntity` is applied consistently before routing to any per-entity detail page.

---

*End of review. No commits made. No Playwright used.*
