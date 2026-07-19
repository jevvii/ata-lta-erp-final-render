# Frontend Performance & UX Optimization Plan — Streamlined v2

## Context

The ATA & LTA ERP SPA is a plain HTML/CSS/JavaScript application (no framework) backed by a Node.js API and a remote Supabase database. It currently runs in two environments:

- **Development:** `npm run dev` serves the SPA locally and talks to a local or remote Supabase project.
- **UAT/Production:** Render hosts the Docker backend and a static site for the SPA.

Users report slow loads, blank screens during navigation, overlapping content after rapid clicks, and long waits after writes. This plan prioritizes the changes that move real web-vitals numbers first, then improves perceived performance, then optimizes data architecture.

> **Scope:** This plan intentionally covers only optimization work, not feature completion. Existing backend gaps (e.g., task-level report endpoints) are noted only when they block performance fixes.

---

## Current problems (verified by code review)

| # | Problem | Where it hurts | Evidence |
|---|---------|----------------|----------|
| 1 | **20+ synchronous, unminified script tags** load in `index.html` with no bundling, compression, or cache strategy. | First paint, TTI, bandwidth, free-tier static-host transfer. | `index.html` loads `utils.js`, `apiClient.js`, `dashboard.js`, `workflow.js`, etc. synchronously. |
| 2 | **No loading state during route switches.** `App.handleRoute()` clears `#content` and blocks on `await module.render()`. | Perceived responsiveness, INP, route-switch time. | `erp_prototype/js/app.js:572` does `content.innerHTML = ''` then awaits render. |
| 3 | **No request cancellation or race handling.** Rapid nav clicks can overwrite a slower render with a newer one (or vice versa). | Content overlap, wasted network/DOM work. | `apiClient.js` has no `AbortController`; `handleRoute()` has no route ID. |
| 4 | **Dashboard N+1 task fetching.** It loads all work requests + all disbursements, then fetches tasks for every work request in 5-at-a-time batches. | Free-tier cold-start pain, dashboard LCP, API round trips. | `dashboard.js:1663–1755` loops over work requests calling `listTasks`. |
| 5 | **`limit: 1000` on list calls and client-side filtering.** Several modules pull entire tables then filter/sort in memory. | Supabase transfer, browser memory, long renders. | 4 occurrences of `limit: 1000`; `clients.js` filters search results locally. |
| 6 | **Full-page reload after entity switch and some writes.** `triggerSyncReload()` calls `location.reload()`. | Seconds of wasted work after common actions. | `utils.js:1798` and `app.js:306`. |
| 7 | **~122 `innerHTML` / `outerHTML` assignments** and 60+ array loops in `dashboard.js` alone. | DOM thrashing, long tasks, main-thread blocking. | `grep` count across `erp_prototype/js`. |
| 8 | **No compression, CDN, resource hints, or font optimization.** CSS imports Google Fonts synchronously; Express does not serve gzipped assets. | LCP, FCP, TTFB. | `styles.css:6` blocks render; `app.js` has no `compression` middleware. |
| 9 | **Free-tier cold starts.** Render free web services sleep; Supabase free tier can take >5 s on first call. | TTFB, initial dashboard load. | UAT runs on Render `plan: free`. |
| 10 | **430 legacy `DB.*` references** still mixed with API calls. LocalStorage can block the main thread and stores redundant data. | Storage quota, parse time, consistency bugs. | `grep` count across `erp_prototype/js`. |

---

## Target metrics (modern standards)

Use these as the definition of success. Measure on **Lighthouse mobile** and on a **3G/4G throttled desktop** profile against the UAT deployment.

| Metric | Target | Notes |
|--------|--------|-------|
| **Largest Contentful Paint (LCP)** | ≤ 2.5 s | Login → dashboard first meaningful paint. |
| **Interaction to Next Paint (INP)** | ≤ 200 ms | Nav clicks, filter typing, tab switches. |
| **Cumulative Layout Shift (CLS)** | ≤ 0.1 | Skeletons must reserve exact space. |
| **First Contentful Paint (FCP)** | ≤ 1.8 s | First visible pixel after login. |
| **Time to Interactive (TTI)** | ≤ 3.5 s | Main thread idle, handlers wired. |
| **TTFB (Time to First Byte)** | ≤ 600 ms | Includes Render free-tier wake-up path. |
| **Route switch (cached data)** | ≤ 300 ms | From click to fully drawn content. |
| **Route switch (fresh data, warm backend)** | ≤ 1 s | Acceptable when cache is cold. |
| **Dashboard API calls on load** | ≤ 3 | Down from current N+1 pattern. |
| **Total JS transfer (gzipped)** | ≤ 250 kB | Currently ~20 unminified files, likely 500 kB+. |
| **Full-page reloads after writes** | 0 | Except explicit logout. |

> **Measurement tools:** Chrome DevTools Performance + Network panels, Lighthouse CI, WebPageTest (Filmstrip), Render request logs, a simple `performance.mark()` wrapper in `App.handleRoute()`.

---

## Recommended implementation order

1. **Phase 0 — Baseline & quick wins** (1–2 days): measure, add compression, minify, resource hints, font `display=swap`. This is the highest ROI work and proves the metric-driven approach.
2. **Phase 1 — Asset delivery** (2–3 days): bundle scripts, add gzip/Brotli, consider CDN, lazy-load non-critical modules. Moves LCP/FCP/TTI the most.
3. **Phase 2 — Route UX** (2–3 days): loading overlay, skeletons, race guard, nav debounce. Fixes INP and perceived slowness.
4. **Phase 3 — API architecture** (3–5 days): dashboard aggregation endpoint, embedded-tasks endpoint, pagination, AbortController, request deduplication. Fixes N+1 and TTFB.
5. **Phase 4 — Rendering engine** (3–5 days): reduce `innerHTML`, batch DOM updates, virtualize long lists, lazy widgets. Fixes INP and long tasks.
6. **Phase 5 — Runtime & deployment** (2–3 days): service worker (Cache-First shell + Stale-While-Revalidate API), Render keep-alive (UAT-only), DB index tuning, connection pooling. Improves repeat visits and cold starts.

Phases 0–2 can run largely in parallel. Phase 3 depends on Phase 2's race/loading guard. Phase 4 is safest after Phase 3 reduces the data volume being rendered.

---

## Phase 0 — Baseline & quick wins (highest ROI, lowest risk)

### 0.1 Establish a measurement dashboard
- Add `performance.mark()` / `performance.measure()` around `App.handleRoute()` start/end and `Dashboard.ensureData()`.
- Log route-switch duration, API call count, and render duration to the console in dev; send to a simple endpoint or sessionStorage summary in UAT.
- Run Lighthouse on UAT **before any changes** and save the report. This is the baseline.

### 0.2 Add Express compression middleware
- Install `compression`, add `app.use(compression())` in `backend/src/app.js` before static and API routes.
- Target: reduce JSON and JS/CSS transfer by 60–80%.

### 0.3 Enable gzip on the static site
- Render static sites serve files as-is; add a build step that emits `.gz` and `.br` files and teaches `dev-server.js` / Render to serve them with `Content-Encoding`.
- Alternative: move static hosting to a CDN (CloudFront/S3) that compresses on the fly.

### 0.4 Optimize the Google Fonts request
- Change `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');` to use `display=swap` (or `optional`) and `preconnect` hints.
- Better: self-host the font subset or use `font-display: swap` so text renders immediately with a fallback font.

### 0.5 Add resource hints
- In `index.html`: `<link rel="preconnect" href="https://fonts.googleapis.com">` and `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`.
- Add `<link rel="preconnect" href="<API_ORIGIN>">` once `env.js` knows the API origin (inject dynamically or use a placeholder).

### 0.6 Defer / async non-critical scripts
- Mark helper scripts that are not needed for the login screen (`dataTable.js`, `kanban.js`, `datepicker.js`, `timepicker.js`, `dashboard.js`, `workflow.js`, etc.) with `defer`.
- Keep `utils.js`, `auth.js`, `apiClient.js`, `app.js` as render-blocking only if truly required for first paint.

**Files:** `backend/src/app.js`, `erp_prototype/index.html`, `erp_prototype/css/styles.css`, `erp_prototype/build.js`, `erp_prototype/dev-server.js`.

---

## Phase 1 — Asset delivery & bundle architecture

### 1.1 Bundle and minify the SPA
- Introduce a minimal bundler (e.g., `esbuild` or `rollup`) in `erp_prototype/build.js`.
- Produce:
  - `app.bundle.js` — shell + router + auth + apiClient + utils.
  - `vendor.bundle.js` — optional third-party code (currently minimal).
  - `modules.bundle.js` — dashboard, workflow, billing, clients, etc., loaded with `defer`.
  - `styles.min.css` — minified CSS.
- Generate source maps for dev builds only; strip for UAT.

### 1.2 Split code by route
- Use dynamic `import()` for heavy modules (dashboard calendar, reports charts, PDF generation helpers, datepickers) so they load only when the route needs them.
- Keep the initial landing bundle under **150 kB gzipped**.

### 1.3 Add long-term caching headers
- Serve JS/CSS with `Cache-Control: public, max-age=31536000, immutable` and use content-hashed filenames (`app.abc123.js`).
- `index.html` must remain `no-cache` so new hashes are picked up.

### 1.4 Image and asset optimization
- The `ERP_Assets` logo images are large; serve WebP/AVIF fallbacks and lazy-load below-the-fold images.
- Replace `ui-avatars.com` calls in hot paths with a tiny inline SVG initial-avatar helper to avoid extra DNS/TLS/HTTP round trips.

### 1.5 Consider CDN for static assets
- If Render static-site transfer becomes a bottleneck, front the SPA with CloudFront or Cloudflare.
- This also reduces TTFB for users outside Render's origin region.

**Files:** `erp_prototype/build.js`, `erp_prototype/package.json`, `erp_prototype/index.html`, `erp_prototype/dev-server.js`, `erp_prototype/css/styles.css`.

---

## Phase 2 — Route UX: loading, skeletons, and race safety

### 2.1 Loading overlay during transitions
- Show a non-modal, pointer-events-blocking overlay over `#content` immediately when `App.handleRoute()` starts async work.
- Hide it only after `module.render()` and `module.init()` complete.
- Minimum display time: **120 ms** to avoid flashes; maximum display time: none (show real progress instead).

### 2.2 Per-route skeletons
- Dashboard: render KPI skeleton cards + calendar skeleton immediately.
- List views: render sticky header skeleton + 8–10 row skeletons.
- Detail/form views: render breadcrumb + form-field skeletons.
- Skeletons must use exact final dimensions so they do not cause CLS when replaced.

### 2.3 Route race guard
- Assign a monotonic route ID in `App.handleRoute()`.
- Pass the ID into `module.render()` and `apiClient` calls. Abort any in-flight request and discard any DOM commit whose ID is stale.
- Ignore or debounce nav clicks while a transition is in progress (100 ms debounce).

### 2.4 Replace full-page reloads
- Change `triggerSyncReload()` to invalidate the affected module cache and call `App.handleRoute()` for the current route.
- Keep the pending-toast behavior; drop `location.reload()`.
- Audit the 3 current `triggerSyncReload` / `location.reload` call sites and convert them.

### 2.5 Toast and notification improvements
- Move success/error toasts out of the synchronous render path so they do not delay INP.

**Files:** `erp_prototype/js/app.js`, `erp_prototype/js/utils.js`, `erp_prototype/js/apiClient.js`, `erp_prototype/css/styles.css`.

---

## Phase 3 — API architecture: fewer, faster, cancellable requests

### 3.1 Add a dashboard aggregation endpoint
Create `GET /v1/reports/dashboard` that returns, for the active entity (or both in one call for `ALL`):

- KPI counts (active WRs, revenue paid, outstanding, overdue tasks).
- Upcoming due-date items for the calendar, **with tasks embedded**.
- Calendar event metadata (id, type, status, title, dueDate, assignee, clientId) — no need for a separate task call per WR.

This replaces the current analytics + workRequests list + disbursements list + per-WR task calls.

### 3.2 Add `includeTasks=true` to work requests list
Create `GET /v1/work-requests?includeTasks=true` that returns work requests with their tasks already populated. Use this for operations and dashboard views that need task status.

### 3.3 Server-side pagination, search, and filtering
- Remove `limit: 1000` from the frontend.
- Add `limit`, `offset`, `search`, `status`, `clientId`, `sort` query params to `/v1/work-requests`, `/v1/clients`, `/v1/invoices`, `/v1/disbursements`, `/v1/transmittals`.
- Move all client-side search/filter/sort to the backend except for instant UI feedback on small already-loaded datasets.

### 3.4 Request cancellation and deduplication
- Add `AbortController` support to `apiClient.request()` so stale route IDs can cancel in-flight fetches.
- Dedupe identical in-flight requests (e.g., `clientCache.ensure()` called from multiple modules).

### 3.5 Cache reference data with TTL
- `userCache`, `clientCache`, `workRequestCache` already exist but are session-only and invalidated too aggressively.
- Keep them warm for 5–15 minutes; refresh in the background after writes.
- Pre-warm `userCache` and `clientCache` immediately after login so the first list render does not block on them.

### 3.6 Backend response caching (safe endpoints only)
- Add a short in-memory cache (30–60 s) for `/health` and read-only analytics endpoints. `/health` already has this; extend the pattern to `/v1/reports/analytics` and `/v1/reports/dashboard`.
- Use `Cache-Control: private, max-age=60` headers for these endpoints and re-validate on write.

**Files:** `backend/src/modules/reports/*.js`, `backend/src/modules/operations/*.js`, `backend/src/modules/clients/*.js`, `backend/src/app.js`, `erp_prototype/js/apiClient.js`, `erp_prototype/js/dashboard.js`, `erp_prototype/js/workflow.js`, `erp_prototype/js/clients.js`.

---

## Phase 4 — Rendering engine: less DOM work

### 4.1 Reduce `innerHTML` churn
- Audit the ~122 `innerHTML` / `outerHTML` assignments. Convert hot paths (dashboard calendar, table rows, filter dropdowns, kanban boards) to `DocumentFragment` + single append.
- Build strings only for static chunks, never inside loops that also touch the DOM.

### 4.2 Batch reads/writes
- Use `requestAnimationFrame` to coalesce DOM writes; avoid reading layout properties (`offsetHeight`, `getBoundingClientRect`) inside write loops.
- The sticky-offset helper in `App.updateStickyOffsets()` already uses `ResizeObserver`; extend that pattern.

### 4.3 Virtualize long lists and tables
- For lists/tables expected to exceed **100 rows**, render only visible rows + 2 buffers and recycle DOM nodes on scroll.
- Use a lightweight virtual-scroller or a simple `IntersectionObserver` + placeholder strategy if no library is introduced.
- Current `DataTable` should cap initial render at 50 rows and paginate or virtualize the rest.

### 4.4 Lazy-load heavy widgets
- Render dashboard KPIs and upcoming-week sidebar first; defer the full calendar grid until the main content is painted.
- Defer non-essential widgets (aging charts, full audit log, report detail tables) until `requestIdleCallback` or user interaction.

### 4.5 Remove or isolate the legacy `DB.*` layer
- The 430 `DB.*` references are a ticking performance and consistency problem. Treat removal as a separate, parallel track:
  - Module by module, replace `DB.getAll` / `DB.getWhere` with API calls + module-local caches.
  - Remove `data.js` seed data from production builds; keep it only for offline demos if still needed.
- This is not a single phase; it runs behind every other optimization and is gated by backend coverage.

**Files:** `erp_prototype/js/dashboard.js`, `erp_prototype/js/clients.js`, `erp_prototype/js/billing.js`, `erp_prototype/js/disbursement.js`, `erp_prototype/js/transmittal.js`, `erp_prototype/js/dataTable.js`, `erp_prototype/js/utils.js`, `erp_prototype/js/data.js`.

---

## Phase 5 — Runtime & deployment optimizations

### 5.1 Service worker for shell + API cache
- Add a lightweight `sw.js` registered from `index.html`.
- **Cache-First** for the SPA shell and static assets (versioned by build hash).
- **Stale-While-Revalidate** for safe GET API responses (`/me`, `/me/team`, `/clients`, `/reports/analytics`) with a 5-minute max age.
- Skip caching for writes, auth endpoints, and PDF endpoints.
- Provide an update toast and a forced refresh when a new build is detected.

### 5.2 Backend keep-alive (UAT/demo convenience only)
- Render free web services sleep after inactivity. Add a cron job (Render cron or cron-job.org) that hits `/health` every 10–14 minutes.
- Document clearly that this is a demo/UAT convenience, not a production architecture.
- Better long-term: upgrade to a paid Render plan or move compute to a service that does not sleep.

### 5.3 Supabase connection optimization
- Use the Supabase Connection Pooler (`DATABASE_URL` with PgBouncer) for backend DB connections to reduce connection overhead under load.
- Enable prepared-statement caching if the driver supports it.

### 5.4 Database index tuning
Current indexes are mostly good, but add these:

- `work_requests(entity_id, status) WHERE deleted_at IS NULL` (partial composite; matches invoices/disbursements pattern).
- `work_requests(entity_id, due_date) WHERE deleted_at IS NULL` (calendar filtering).
- `tasks(work_request_id, status, due_date) WHERE deleted_at IS NULL` (overdue task counts).
- `invoice_payments(payment_date, invoice_id)` (daily/weekly reports).
- `documents(entity_id, work_request_id, document_lifecycle) WHERE deleted_at IS NULL` (DMS list views).

### 5.5 Reduce backend query fan-out
- The reports service currently fires **22 separate `await supabaseAdmin` calls**. Batch analytics into fewer RPC calls or use Postgres aggregates / views.
- Example: a single `SELECT entity_id, status, COUNT(*), SUM(total), SUM(balance) FROM invoices WHERE deleted_at IS NULL GROUP BY entity_id, status` replaces multiple count queries.

### 5.6 Security/performance middleware
- Keep `helmet` and rate limiting; ensure CORS is tight and `X-Request-Id` is logged for tracing slow requests.
- Add request-duration logging alerts for endpoints > 1 s.

**Files:** `erp_prototype/index.html`, `erp_prototype/sw.js`, `erp_prototype/build.js`, `backend/src/app.js`, `backend/src/modules/reports/service.js`, `backend/migrations/*.sql` / `*.js`, `render.yaml`.

---

## Files likely to be modified

| File | Why |
|------|-----|
| `erp_prototype/index.html` | Resource hints, script loading strategy, service worker registration, fewer tags. |
| `erp_prototype/build.js` | Bundling, minification, gzip/Brotli, hashed filenames. |
| `erp_prototype/package.json` | Bundler dependency, build scripts. |
| `erp_prototype/dev-server.js` | Serve compressed files, env injection, SPA fallback. |
| `erp_prototype/css/styles.css` | Font optimization, skeleton styles, CLS-safe placeholders. |
| `erp_prototype/js/app.js` | Route race guard, loading overlay, nav debounce, metric marks. |
| `erp_prototype/js/utils.js` | `triggerSyncReload()` rewrite, skeleton helpers. |
| `erp_prototype/js/apiClient.js` | AbortController, request deduplication, cache TTL. |
| `erp_prototype/js/dashboard.js` | Aggregation endpoint consumer, skeletons, lazy calendar. |
| `erp_prototype/js/workflow.js` | Embedded-tasks endpoint, pagination. |
| `erp_prototype/js/clients.js` | Server-side search/pagination. |
| `erp_prototype/js/dataTable.js` | Virtualization or row cap. |
| `erp_prototype/sw.js` | New service worker. |
| `backend/src/app.js` | Compression, cache headers, request logging. |
| `backend/src/modules/reports/*.js` | Dashboard aggregation endpoint, query batching. |
| `backend/src/modules/operations/*.js` | `includeTasks` param, pagination. |
| `backend/src/modules/clients/*.js` | Server-side search/pagination. |
| `backend/migrations/*.sql` / `*.js` | Missing indexes. |

---

## Metrics verification checklist

Use this checklist after each phase. Do not consider a phase done until the relevant items are measured and improved.

1. **Lighthouse mobile score** ≥ 75 after Phase 1; ≥ 90 after Phase 5.
2. **LCP** on dashboard login ≤ 2.5 s.
3. **INP** on nav click ≤ 200 ms.
4. **CLS** ≤ 0.1 across all routes.
5. **Route switch time** measured via `performance.measure('route-switch')`.
6. **API call count on dashboard load** ≤ 3 after Phase 3.
7. **JS transfer size** ≤ 250 kB gzipped after Phase 1.
8. **Full-page reload count after writes** = 0 after Phase 2.
9. **Overlap test:** click 3 nav links rapidly; only the last module remains visible after Phase 2.
10. **Cold-start TTFB** ≤ 3 s with keep-alive after Phase 5.
11. **Repeat-visit dashboard load** ≤ 1 s with service worker after Phase 5.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Bundler breaks the legacy dev server | Keep `dev-server.js` backward-compatible; test both `npm run dev` and Render build before merging. |
| Skeletons cause CLS | Reserve exact final heights/widths; use CSS `aspect-ratio` and grid layouts. |
| Race guard drops legitimate renders | Only discard stale route IDs; newest always wins; use AbortController for network cancellation. |
| Service worker caches stale code | Version cache by build hash; show "Update available" toast; unregister on error. |
| Backend aggregation endpoint returns too much data | Add entity + date filters; paginate large sub-lists; cap task embedding depth. |
| Compression adds CPU overhead on Render free tier | Use static pre-compression at build time, not on-the-fly gzip. |
| Removing `DB.*` breaks modules still using it | Remove module-by-module behind feature flags or in separate PRs; keep integration tests green. |

---

## Definition of done

- [ ] Baseline Lighthouse report saved in `docs/` or project wiki.
- [ ] All static assets are minified, compressed, and served with long-term cache headers.
- [ ] `index.html` loads ≤ 5 scripts (shell, modules, deferred helpers, env, sw registration).
- [ ] Every route switch shows a loading state or skeleton and completes within target times.
- [ ] Rapid nav clicks never produce overlapping or mixed content.
- [ ] Dashboard load makes ≤ 3 API requests.
- [ ] Write operations no longer trigger full page reloads.
- [ ] All list endpoints support server-side pagination/search/filter.
- [ ] LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 on UAT.
- [ ] Legacy `DB.*` usage has a documented migration plan and at least the hot paths are removed.

---

## Notes for future agents

- **Do not add a frontend framework** as a "performance fix." Migration to React/Vue/Svelte is out of scope and would likely slow the project down.
- **Keep changes incremental.** Each phase should be mergeable on its own so UAT stays stable.
- **Test on real data volumes.** Local seed data is small; use UAT or generate 500+ work requests / 1000+ tasks to validate virtualization and pagination.
- **Respect free-tier limits.** The keep-alive ping is a temporary band-aid; the real fix is paid compute or a different hosting model.
