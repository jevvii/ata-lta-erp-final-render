# Performance Loading Speed — Implementation TODO

> **Created:** 2026-07-19 — Comprehensive audit of slow page loading causes and actionable fixes.
> **Status:** ✅ All 14 tasks implemented. All 117 backend tests passing. Committed to `uat` (not pushed).
> **Branch:** `uat`

---

## Root Cause Summary

The ERP SPA suffers from slow page loads due to **three compounding bottleneck layers**:

1. **Frontend Asset Bloat** — 1.58 MB of unminified JS (19 files) + 387 KB CSS loaded on every page
2. **Backend Auth Overhead** — 3 network round-trips per API request (JWT verify + 2 DB queries)
3. **Missing Backend Caching** — No HTTP cache headers, no user profile caching, no connection reuse

### Load Waterfall (Current State)
```
Browser requests index.html
  → 387KB styles.css (render-blocking)
  → 19 JS files (~1.58MB total, no minification in dev)
    → utils.js (148KB), apiClient.js (22KB), auth.js (13KB) — parser-blocking
    → 16 deferred scripts including workflow.js (502KB!)
  → Auth: session restore → API call → backend auth middleware:
    → supabaseAdmin.auth.getUser(token)     [~100-300ms network]
    → SELECT from users                     [~50-100ms]
    → SELECT from user_departments          [~50-100ms]
  → Dashboard: 5-8 parallel API calls, each repeating auth overhead
```

---

## Phase 1: Backend Auth & Middleware Optimization [HIGH IMPACT]
*Estimated improvement: 200-500ms per API request*

### Task 1.1 — Cache User Profiles in Auth Middleware ✅
- **File:** `backend/src/middleware/auth.js`
- **Problem:** `loadUserProfile()` makes 2 sequential DB queries on every request
- **Fix:** Add in-memory LRU cache (5-min TTL) for user profiles. Combine the two queries
  into a single Supabase query using `.select('..., user_departments(departments(name))')`.
- **Priority:** CRITICAL

### Task 1.2 — Add HTTP Keep-Alive to Supabase Client ✅
- **File:** `backend/src/config/supabase.js`
- **Problem:** Each Supabase HTTP request opens a new TCP/TLS connection
- **Fix:** Pass a custom fetch with `https.Agent({ keepAlive: true })` to reuse connections
- **Priority:** HIGH

### Task 1.3 — Add Cache-Control Headers for GET Responses ✅
- **File:** `backend/src/app.js`
- **Problem:** No `Cache-Control` or `ETag` headers — browsers re-fetch everything
- **Fix:** Add middleware that sets `Cache-Control: private, max-age=30` for authenticated
  GET responses and `no-store` for mutations
- **Priority:** HIGH

### Task 1.4 — Cache Entity ID/Code Lookups ✅
- **File:** `backend/src/modules/operations/service.js`
- **Problem:** `resolveEntityId()` and `resolveEntityCode()` query DB on every call
- **Fix:** Add simple in-memory Map cache with 10-min TTL for entity lookups
- **Priority:** MEDIUM

---

## Phase 2: Frontend Asset Loading Optimization [HIGH IMPACT]
*Estimated improvement: 1-3 seconds on initial page load*

### Task 2.1 — Enable Production Build Pipeline ✅
- **File:** `erp_prototype/build.js` (already exists, needs integration)
- **Problem:** Dev server serves raw unminified files; build.js exists but isn't part of workflow
- **Fix:** Ensure `npm run build` in `erp_prototype/package.json` runs the build script.
  The build already: bundles into 5 chunks, minifies via esbuild, generates .gz/.br files.
- **Priority:** CRITICAL

### Task 2.2 — Add Lazy Bundle Loading to Dev Mode ✅
- **File:** `erp_prototype/index.html`
- **Problem:** All 19 JS files loaded on every page in development
- **Fix:** Split scripts into core (loaded immediately: utils, apiClient, auth, app, dataTable,
  kanban, datepicker, timepicker, dashboard, clients, workflow) and lazy bundles
  (billing, disbursement, transmittal loaded on-demand; pendingChanges, users, reports,
  profile, dms loaded on-demand). Use the existing `App.loadBundle()` mechanism.
- **Priority:** HIGH

### Task 2.3 — Add CSS Critical Path + Deferred Loading ✅
- **File:** `erp_prototype/index.html` and `erp_prototype/css/styles.css`
- **Problem:** 387KB CSS is fully render-blocking
- **Fix:** Extract critical above-the-fold CSS (~5KB) inline in `<head>`, load full CSS
  with `media="print" onload="this.media='all'"` pattern for non-blocking load.
- **Priority:** HIGH

### Task 2.4 — Add Resource Hints ✅
- **File:** `erp_prototype/index.html`
- **Problem:** No `<link rel="preload">` for critical resources
- **Fix:** Add preload hints for critical JS files (utils.js, apiClient.js, auth.js)
  and preconnect for API origin
- **Priority:** MEDIUM

---

## Phase 3: Backend Query Optimization [MEDIUM IMPACT]
*Estimated improvement: 100-500ms per list endpoint*

### Task 3.1 — Push Pagination to Database in Clients Service ✅
- **File:** `backend/src/modules/clients/service.js`
- **Problem:** Fetches ALL clients then paginates in memory with `Array.slice()`
- **Fix:** Use Supabase `.range(offset, offset + limit - 1)` for DB-level pagination.
  Move text search to DB: `.or('name.ilike.%q%,tin.ilike.%q%')`.
- **Priority:** HIGH

### Task 3.2 — Fix N+1 in Operations Service ✅
- **File:** `backend/src/modules/operations/service.js`
- **Problem:** Fetches all work requests, then all tasks for all WRs, then filters in memory
- **Fix:** Use `.range()` for DB pagination. Only fetch tasks for the paginated subset.
  Combine task fetch into a single query with `.in('work_request_id', wrIds)`.
- **Priority:** HIGH

### Task 3.3 — Add Billing/Disbursement Pagination Guard ✅
- **File:** `backend/src/modules/billing/service.js`, `backend/src/modules/disbursements/`
- **Problem:** `limit: 1000` on list queries returns excessive data
- **Fix:** Enforce default pagination (limit=50, max=200) on list endpoints
- **Priority:** MEDIUM

---

## Phase 4: Service Worker & Caching Strategy [LOW-MEDIUM IMPACT]
*Estimated improvement: Instant loads on repeat visits*

### Task 4.1 — Update Service Worker Cache List ✅
- **File:** `erp_prototype/sw.js`
- **Problem:** SHELL_URLS references deleted `logos.js`; stale cache version
- **Fix:** Remove `/js/logos.js` from SHELL_URLS, bump `CACHE_VERSION` to 'v2'
- **Priority:** LOW

### Task 4.2 — Add Cache-Busting Query Params ✅
- **File:** `erp_prototype/sw.js`
- **Problem:** Stale service worker version string 'v1' never updated
- **Fix:** Bump cache version to force re-cache of updated assets
- **Priority:** LOW

---

## Phase 5: Dashboard-Specific Optimizations [MEDIUM IMPACT]

### Task 5.1 — Parallelize Dashboard Badge API Calls ✅
- **File:** `erp_prototype/js/app.js` (updateSidebarNotifications)
- **Problem:** Badge count API calls are sequential: `await disbursements.counts()` then
  `await operationsRequests.counts()`
- **Fix:** Use `Promise.allSettled()` to fetch both counts in parallel
- **Priority:** MEDIUM

---

## Implementation Order (by impact)

| Order | Task | Impact | Effort | Risk |
|-------|------|--------|--------|------|
| 1 | 1.1 Auth profile caching + query merge | CRITICAL | Medium | Low |
| 2 | 1.2 HTTP Keep-Alive on Supabase client | HIGH | Low | Low |
| 3 | 1.3 Cache-Control headers | HIGH | Low | Low |
| 4 | 2.1 Production build pipeline integration | CRITICAL | Low | Low |
| 5 | 2.2 Lazy bundle loading in dev mode | HIGH | Medium | Medium |
| 6 | 2.3 Critical CSS + deferred loading | HIGH | Medium | Low |
| 7 | 2.4 Resource hints (preload/preconnect) | MEDIUM | Low | Low |
| 8 | 3.1 Clients DB pagination | HIGH | Medium | Low |
| 9 | 3.2 Operations N+1 fix | HIGH | High | Medium |
| 10 | 3.3 Billing/Disbursement pagination | MEDIUM | Low | Low |
| 11 | 1.4 Entity lookup caching | MEDIUM | Low | Low |
| 12 | 4.1 Service worker cleanup | LOW | Low | Low |
| 13 | 4.2 Cache version bump | LOW | Low | Low |
| 14 | 5.1 Parallel badge counts | MEDIUM | Low | Low |

---

## Expected Outcomes

| Metric | Before | After (Target) |
|--------|--------|----------------|
| Auth middleware per-request overhead | ~300-500ms | ~5-50ms (cached) |
| Initial JS payload (dev) | ~1.58 MB (19 files) | ~450 KB (3 core bundles) |
| CSS blocking time | 387 KB parse | ~5 KB critical inline |
| API list response time (clients) | ~500ms+ (all rows) | ~50-100ms (paginated) |
| Dashboard total load time | ~3-5s | ~1-2s |
| Repeat visit load time | Full re-fetch | Instant (SW cache) |

---

## Notes for Subsequent Agents

1. **Do NOT modify the global-variable architecture** — modules expose themselves on `window.*`.
   The SPA relies on this contract. Any bundling/lazy-loading must preserve global exposure.
2. **Test auth changes carefully** — the auth middleware is the gateway for ALL API requests.
   Any caching must invalidate when users are deactivated or roles change.
3. **The build.js already handles production bundling** — it splits into shell/vendor/modules-core/
   modules-billing/modules-admin bundles. Focus dev-mode optimization on lazy-loading.
4. **Supabase uses PostgREST** — pagination uses `.range()` not SQL LIMIT/OFFSET directly.
5. **Entity scoping is mandatory** — all list queries must filter by `entity_id`.
