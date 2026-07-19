# Performance Optimization — Next Steps / Checkpoint

> Status: performance plan implementation is **merged in working tree on `uat` branch**, not committed or pushed.
> Last updated: 2026-07-19.
> This doc is the handoff checkpoint for the next agent.

## What is already done

### Backend
- [x] Express `compression` middleware added (`backend/src/app.js`).
- [x] Slow-request logging (>1 s) added.
- [x] `GET /v1/reports/dashboard` returns analytics KPIs + upcoming calendar items (WRs with embedded tasks + disbursements) with 30 s in-memory cache.
- [x] `GET /v1/work-requests` supports `includeTasks=true`, pagination, status/clientId/search/sort.
- [x] `GET /v1/clients` supports pagination, search, status, sort.
- [x] Reports analytics parallelized and cached; `invoice_payments` entity scoping fixed via invoice join.
- [x] `ALL` consolidated entity view works for dashboard/reports; other modules fall back to the user's first real entity.
- [x] Performance indexes migration created (`backend/migrations/000020_performance_indexes.js`).
- [x] Backend tests pass: **83/83**.

### Frontend
- [x] `index.html` has preconnect hints, deferred non-critical scripts, service-worker registration.
- [x] `App.handleRoute()` has monotonic route ID, skeleton overlay, nav debounce, race guard, performance marks.
- [x] `apiClient.js` has `AbortController` support, GET deduplication, 5-minute TTL caches.
- [x] `triggerSyncReload()` no longer calls `location.reload()`.
- [x] Dashboard uses `/v1/reports/dashboard` + `/v1/work-requests?includeTasks=true` (≤3 requests on load).
- [x] Workflow uses `includeTasks=true` and server-side pagination for list views.
- [x] `dataTable.js` caps initial render at 50 rows and supports virtualization option.
- [x] `innerHTML = ''` cleared in main list paths; replaced with `replaceChildren()` where safe.
- [x] `sw.js` added with Cache-First shell + Stale-While-Revalidate safe API cache.
- [x] `build.js` produces hashed/minified bundles, `.gz`/`.br` files, and a `dist/index.html`.
- [x] `dev-server.js` serves unbundled source by default; `dist/` when `ERP_SERVE_DIST=1` or `NODE_ENV=production`.
- [x] Smoke tests pass for both source and dist serving modes.

### Dev/Runtime
- [x] `scripts/keep-alive.js` + `docs/KEEP_ALIVE.md` added.
- [x] `package.json` root script `"keep-alive"` added.

## Current metrics

| Metric | Current state | Target | Notes |
|---|---|---|---|
| First paint resource hints | ✅ preconnect + defer | — | done |
| JS bundles (gzipped) | **~266 KB total** | ≤250 KB | close; needs code splitting |
| Dashboard API calls | **2 requests** | ≤3 | done |
| Route race guard | ✅ | — | done |
| Service worker | ✅ registered | — | needs UAT testing |
| Backend compression | ✅ | — | done |
| Backend tests | 83/83 | green | done |

## TODO list for the next agent

### Phase 1 finish — reduce JS bundle size to ≤250 KB
- [ ] **1.1 Profile the modules bundle** to identify the largest contributors.
  - `erp_prototype/js/workflow.js` is ~480 KB raw and likely the biggest slice.
  - `erp_prototype/js/billing.js`, `disbursement.js`, `transmittal.js`, `users.js`, `reports.js` are also heavy.
- [ ] **1.2 Split the modules bundle by route** in `erp_prototype/build.js`:
  - `modules-core.bundle.js` — dashboard + clients + workflow (needed for first dashboard paint).
  - `modules-billing.bundle.js` — billing + disbursement + transmittal.
  - `modules-admin.bundle.js` — users + reports + profile + dms.
  - Update `dist/index.html` to load route-specific bundles on demand, or load non-core bundles after `DOMContentLoaded` / first interaction.
- [ ] **1.3 Lazy-load heavy widgets**:
  - invoice/voucher/disbursement PDF print preview builders.
  - kanban board rendering if not used on dashboard.
  - report charts / aging views.
- [ ] **1.4 Remove dead code**:
  - `logos.js` if unused in production.
  - legacy `DB.*` helpers that are no longer called.
  - duplicated helpers across modules.
- [ ] **1.5 Verify** with `npm run build:prod` and check total gzipped JS ≤250 KB.

### Phase 2 — remove remaining `limit: 1000` and legacy `DB.*` hot paths
- [ ] **2.1 Billing list (`erp_prototype/js/billing.js:fetchInvoices`)**
  - Replace `{ limit: 1000 }` with server-side pagination.
  - Update `renderList()` to call `window.apiClient.invoices.list({ page, limit, status, clientId, search, sortBy, sortOrder })`.
  - Add Previous/Next pagination controls.
- [ ] **2.2 Billing aging / next invoice number**
  - Move aging source from `DB.getWhere('invoices', ...)` to `window.apiClient.invoices.list({ status: 'Unpaid', ... })`.
  - Make `nextInvoiceNumber()` read only the current page or use a dedicated backend endpoint.
- [ ] **2.3 Disbursement, transmittal, users modules**
  - Audit and replace remaining `DB.getAll` / `DB.getWhere` calls that hit hot paths.
  - Keep cold-path fallbacks if backend coverage is still missing.
- [ ] **2.4 Backend endpoints to support the above**
  - `GET /v1/invoices` already supports pagination/filters; ensure `GET /v1/invoices/aging` supports `ALL` fallback.
  - Add `search` to `/v1/invoices` if not present.

### Phase 3 — implement `get_dashboard_summary` Supabase RPC
- [ ] **3.1 Create migration** defining Postgres function `get_dashboard_summary(entity_id uuid)`.
  - Returns same JSON shape as the JS aggregator: clients, workRequests, documents, invoices, disbursements, transmittals, revenue.
  - Uses Postgres aggregates (`COUNT`, `SUM`, `GROUP BY`) for speed.
- [ ] **3.2 For `ALL`**, either:
  - create `get_dashboard_summary_all()` that returns both entities, or
  - keep the JS parallel path in `getDashboardSummary()` (already implemented).
- [ ] **3.3 Test fallback** still works if RPC is absent.

### Phase 4 — runtime measurement & polish
- [ ] **4.1 Add a lightweight telemetry helper** in `erp_prototype/js/app.js` or `utils.js`:
  - Log `performance.measure('route-switch-<id>')` values to console in dev.
  - Send a summary to a simple backend endpoint or sessionStorage in UAT.
- [ ] **4.2 Capture Lighthouse baseline** against UAT before any further changes.
- [ ] **4.3 Verify Core Web Vitals targets** once deployed:
  - LCP ≤2.5 s
  - INP ≤200 ms
  - CLS ≤0.1
  - Route switch cached ≤300 ms, fresh ≤1 s
- [ ] **4.4 Service worker smoke test on UAT**
  - Confirm `/sw.js` registers.
  - Confirm repeat-visit dashboard loads shell from cache.
  - Confirm update flow fires `sw-update-available` event.

### Phase 5 — consolidated view completeness
- [ ] **5.1 Decide on `ALL` strategy for non-report modules**
  - Option A: keep current fallback to first real entity (safe, but not truly consolidated).
  - Option B: implement true consolidation in backend services by querying both `ATA`/`LTA` and merging results; update pagination meta to reflect combined totals.
- [ ] **5.2 If Option B**, update these services/controllers:
  - `clients/service.js`
  - `operations/service.js`
  - `billing/service.js`
  - `disbursements/service.js`
  - `transmittals/service.js`
  - `documents/service.js`
- [ ] **5.3 Frontend entity switcher** should reset filters when switching to `ALL` and show a clear “Consolidated” indicator.

### Phase 6 — cleanup before commit
- [ ] **6.1 Remove `dist/` and `.gz`/`.br` artifacts** from the working tree (they should be generated at deploy time, not committed).
- [ ] **6.2 Run full test matrix**:
  - `cd backend && npm test`
  - `cd erp_prototype && npm run build:prod`
  - `cd erp_prototype && node smoke-dev.js`
  - `cd erp_prototype && ERP_SERVE_DIST=1 PORT=8081 node dev-server.js` + `BASE_URL=http://localhost:8081 node smoke-dev.js`
- [ ] **6.3 Review git diff** for accidental changes (e.g. `package-lock.json`, binary files).
- [ ] **6.4 Stage and commit** only source changes; do not commit generated `dist/`.
- [ ] **6.5 Push to remote `uat`** only if CI passes locally.

## Important constraints to preserve

- **Do not add a frontend framework** (React/Vue/Svelte). Stay vanilla JS/CSS.
- **Do not commit or push unless explicitly asked** by the user.
- **Do not use Playwright** for automated testing unless the user opts in.
- Keep changes incremental and mergeable per phase.
- Preserve all `window.*` global contracts until an explicit module migration is planned.
- Any change to `/v1/clients` or `/v1/work-requests` response shape must remain backward-compatible (return `meta` only when pagination params are present).

## Quick commands for the next agent

```bash
# Backend tests
cd /home/javvii/FreelanceProject/Project4_Final-Render/backend && npm test

# Production frontend build
cd /home/javvii/FreelanceProject/Project4_Final-Render/erp_prototype && npm run build:prod

# Source dev-server smoke test
node dev-server.js &
sleep 2 && node smoke-dev.js

# Dist dev-server smoke test
ERP_SERVE_DIST=1 PORT=8081 node dev-server.js &
sleep 2 && BASE_URL=http://localhost:8081 node smoke-dev.js

# Syntax check a file
node -c path/to/file.js
```

## File map of completed changes

| File | What changed |
|---|---|
| `backend/src/app.js` | compression, slow-request logging |
| `backend/src/lib/entityResolver.js` | UUID idempotency |
| `backend/src/middleware/entityScope.js` | `ALL` support + restrictions |
| `backend/src/middleware/resolveEntity.js` | configurable factory with `allowAll` |
| `backend/src/modules/reports/*.js` | dashboard aggregation, calendar data, caching |
| `backend/src/modules/operations/*.js` | pagination, `includeTasks`, filters |
| `backend/src/modules/clients/*.js` | pagination, sorting, filters |
| `backend/src/modules/{billing,disbursements,transmittals,documents}/routes.js` | `resolveEntity()` factory |
| `backend/migrations/000020_performance_indexes.js` | new indexes |
| `erp_prototype/index.html` | preconnect, defer, SW registration |
| `erp_prototype/build.js` | esbuild bundles, hashed names, gzip/brotli |
| `erp_prototype/dev-server.js` | source-by-default, dist with flag |
| `erp_prototype/sw.js` | cache strategies |
| `erp_prototype/smoke-dev.js` | source + dist aware |
| `erp_prototype/js/app.js` | route guard, skeletons, performance marks |
| `erp_prototype/js/apiClient.js` | AbortController, dedup, cache TTL |
| `erp_prototype/js/utils.js` | non-reloading sync, skeleton helpers, toast fallback |
| `erp_prototype/js/dashboard.js` | dashboard endpoint, includeTasks, calendar merge |
| `erp_prototype/js/workflow.js` | embedded tasks, server pagination |
| `erp_prototype/js/dataTable.js` | row cap, virtualization |
| `erp_prototype/js/{clients,billing,disbursement,transmittal}.js` | replaceChildren reductions |
| `erp_prototype/package.json` | esbuild devDependency, build scripts |
| `package.json` | `keep-alive` script |
| `scripts/keep-alive.js` + `docs/KEEP_ALIVE.md` | Render free-tier keep-alive |

