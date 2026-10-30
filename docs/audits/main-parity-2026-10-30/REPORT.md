# Main parity audit — 2026-10-30

Verdict: source parity passes for the requested integration; deployed parity and functional certification remain blocked.

## Pinned scope and evidence

Audited local main `4295e995`, after fetching origin and upstream (both point to the same GitHub repository). No application code, remote branch, hosted service, credentials, or database was changed. Evidence was collected around 09:50–09:58 Asia/Manila. Tests ran with installed dependencies on Node v26.8.1; backend Docker/CI use Node 22. No clean dependency installation or database migration was performed.

| Comparison | Result |
| --- | --- |
| main/backend vs staging/backend (`8d06e4d6`) | Entire Git tree identical: `508799d9b3c244c9c701f90d6d1c76713d6d4a57` |
| main/frontend vs enterprise-v2/frontend (`ac24af07`) | Entire Git tree identical: `f6225ee7aac6b5ffad475eba6a734c67162b91f5` |
| main vs admin-cleanup worktree (`feat/client-fund-billing-lifecycle`, `522179cd`) | Both backend and frontend trees identical; differences are outside these application directories |
| local staging vs origin/staging | 0 ahead / 0 behind |
| local enterprise-v2 vs origin/enterprise-v2 | 0 ahead / 0 behind |
| local main vs origin/main (`64c5ed4`) | 300 ahead / 0 behind |

This includes source, tests, dependency manifests/lockfiles, backend migrations and scripts, and frontend build configuration in those directories. The latest client-fund/billing lifecycle work is present in main. Different commit ancestry for admin-cleanup does not mean its application changes are missing.

All 37 worktrees were inventoried in [worktree-inventory.md](worktree-inventory.md), with detailed paths in [worktrees.json](worktrees.json). Other feedback-v1 and historical approval worktrees contain divergent files and some uncommitted edits. They are separate review candidates, not automatically approved missing features. No uncommitted changes were found in the requested main, staging, enterprise-v2, or admin-cleanup worktrees. Uncommitted work in mundane, feedback-v1-f16, feedback-v1-f35a, and resume documents was preserved; environment-file contents were not read.

## Findings

### Critical — public configuration can disclose the service credential

`backend/src/config/env.js:14` sets anonKey to SUPABASE_SERVICE_KEY if SUPABASE_ANON_KEY is missing. `backend/src/modules/config/controller.js:39` repeats that fallback and returns it through unauthenticated `/v1/config/public`. The blueprint prerequisites do not require an anon key. A deployment with only the documented service credential therefore returns that privileged credential to browsers.

Confirmed with an isolated Node invocation, a mocked Supabase module, and the synthetic string `audit-synthetic-service-role-marker`: publicConfigFallsBackToServiceCredential=true. No live configuration response or live key was collected. This is inherited from staging, not introduced by the main integration. Remove both service-key fallbacks, require a public anon/publishable key, and add a regression test that absence of that key never returns the service credential. If a deployed environment has operated without an anon key, assess exposure and rotate the service credential through the normal credential process.

### High — repository blueprint does not deploy this main integration

`render.yaml:33` and `:54` still select staging for both API and static site. Service names, frontend/API URLs, and environment group also remain staging. The React root (`frontend`), publish directory (`dist`), and SPA rewrite are correct in main, but branch selection controls which version of those settings and application files is deployed. Staging/frontend differs from enterprise-v2/frontend across 364 files. Selecting staging cannot reproduce main's integrated React tree.

A main deployment definition needs main branch selection and a coherent set of main service identities, API URL, CORS origin, and environment group. Confirm actual Render dashboard overrides separately; a local blueprint is not proof of live configuration. Do not deploy main's SPA against the staging API unintentionally.

### High — live main still serves the legacy frontend

Unauthenticated GET requests returned HTTP 200 for main and staging SPA roots, each containing `id="app-shell"` and legacy `js/*.js` scripts. The v2 SPA root returned HTTP 200 with `id="root"` and `/assets/index-DZR5R0Y2.js`. See [live-probes.json](live-probes.json). This confirms that the observed main Render URL has not switched to the integrated React frontend. It does not identify the live backend commit or prove that a custom domain has the same configuration.

Main and staging API health requests each exceeded the 20-second read timeout. Treat backend health as unverified; these timeouts alone do not establish downtime.

### High — functional checks are not all green

Focused backend regression checks pass (39/39), and the explicitly configured cross-worktree harness passes (46/46). Separate focused backend contract checks fail 8/53 assertions across retainer permissions, operations requests, and PDF entity scope. The same three files were run on staging and reproduced exactly the same eight failing test names (45 passed / 8 failed); see [verification-summary.json](verification-summary.json). Examples include manager template writes being accepted where tests expect 403, an operations fulfillment returning 403 where a test expects 200, and a voucher PDF request with LTA returning 200 where a test expects 404.

These are test/implementation disagreements, not all independently confirmed product bugs. For example, permissions.js explicitly grants Manager retainers:edit, so changing that behavior to satisfy an older test without confirming the intended policy would be unsafe. Resolve each against the accepted policy and database behavior before functional sign-off.

Focused frontend checks pass 52/53 assertions. The failing realtime test expects a task cache title to change from Active Task Before to Active Task After after an UPDATE with deleted_at:null, but observes the old title. Running the same realtime file directly on enterprise-v2 reproduces the same failure (25 pass / 1 fail). It is inherited, not evidence of an integration-only regression. The larger attempted frontend run also reported realtime mount, scoping, and invalidation failures before it was stopped; it did not produce a complete suite verdict.

### Medium — development and verification entry points still target the prototype

Root package.json:12, :26–33, scripts/dev.js:120/:132, scripts/setup-env.js, and docker-compose.dev.yml still launch, build, configure, install, or mount erp_prototype. npm run dev:main also falls through to the local backend because scripts/dev.js recognizes prod, staging, and uat but not main. A developer using the root commands is not exercising the integrated React frontend.

.github/workflows/ci.yml checks backend tests/lint/migrations only; it has no React test or build gate. deploy-prod.yml:78–84 installs the prototype and runs its smoke-test-readonly.js. That smoke test requires legacy app-shell/login-screen elements and env.js API injection, which the React frontend does not supply. It cannot certify React cutover. Update those entry points and add a React-aware, read-only smoke that verifies the expected API target, built assets, and deep-link fallback.

The production workflow also uses Node 20 despite package engines requiring >=22, and calls npm run migrate:up from repository root although that script exists only in backend/package.json. Its migration step has no backend working-directory. CI already explains why the mixed .js/.sql schema requires the custom migration runner. Align production migration execution with the validated runner and backup procedure before deployment.

### Medium — cross-worktree harness needs an explicit path

backend/tests/e2e/helpers.js:18–39 defaults to an old external sibling directory instead of this repository's frontend directory. The unconfigured cross-worktree run failed all 46 tests due to missing frontend path. Supplying ENTERPRISE_FRONTEND_PATH pointing at main/frontend makes all 46 pass. Use that setting for reproducibility, then make the monorepo frontend the default in a follow-up change. Some default backend e2e failures also use this helper, so the initial broad run is not a clean functional verdict.

## Verification

| Check | Result |
| --- | --- |
| frontend: npm run build | Pass; TypeScript and Vite completed; large-chunk warning |
| backend focused: me, config, clientFundBillingLifecycle, disbursementInvoiceTransmittalLinks | 4 files, 39 tests passed |
| backend: test:cross-worktree with ENTERPRISE_FRONTEND_PATH=main/frontend | 46 passed |
| backend focused: retainer-templates, operationsRequests, disbursements.print | 45 passed / 8 failed |
| staging backend baseline: same three contract files | 45 passed / same 8 failed |
| frontend focused: adminTypesAndSchemas, disbursementInvoiceTransmittalConnectivity, normalizationAndSoftDelete | 52 passed / 1 failed |
| enterprise-v2 realtime baseline: normalizationAndSoftDelete | 25 passed / same 1 failed |
| synthetic service-credential fallback reproduction | Vulnerable fallback confirmed |
| complete backend attempt | Incomplete: 18 failed suite headers observed, then Node heap exhaustion around 2 GB; no final totals |
| complete frontend attempt | Incomplete: realtime failures observed; stopped after resource pressure; no final totals |
| live SPA roots | main/staging legacy; v2 React; all returned 200 |
| live API /health | Both timed out after 20 seconds; health unverified |

Reproduce focused checks from backend with:

```sh
npm test -- --runInBand --silent tests/unit/modules/disbursements/clientFundBillingLifecycle.test.js tests/integration/me.test.js tests/integration/config.test.js tests/integration/disbursementInvoiceTransmittalLinks.test.js
ENTERPRISE_FRONTEND_PATH="$(realpath ../frontend)" npm run test:cross-worktree -- --silent
npm test -- --runInBand --silent tests/retainer-templates.spec.js tests/operationsRequests.test.js tests/disbursements.print.spec.js
```

From frontend:

```sh
npm run build
npm test -- src/features/admin/__tests__/adminTypesAndSchemas.test.ts src/features/disbursements/__tests__/disbursementInvoiceTransmittalConnectivity.test.tsx src/lib/realtime/__tests__/normalizationAndSoftDelete.challenger.test.ts
```

No authenticated user journeys, real-database acceptance suites, production migration ledger, database schema/data comparison, Render service settings, or custom-domain cutover were verified. Passing source identity and mock-backed checks cannot establish those properties. Existing database-gated tests require explicitly provisioned disposable databases; none were enabled against staging or production.

## Recommended completion order

1. Remove the public service-credential fallback and verify the intended public-key configuration.
2. Correct main deployment branch/environment routing, root React entry points, React CI/smoke checks, and the production migration command.
3. Triage inherited test/policy disagreements and rerun complete suites under Node 22 with adequate memory and explicit frontend path.
4. Compare required migrations with the target database's applied migration ledger using read-only access; rehearse any needed changes in a disposable environment.
5. Deploy the reviewed integration through the established release process, then verify health, API target, deep links, login and roles, task approvals, documents, client-fund billing, and receipt/PDF flows against the accepted staging QA checklist.

This audit makes the integrated source reviewable. It does not authorize or claim a production cutover.

Local note: this workspace excludes docs/* through the shared .git/info/exclude. These audit files were explicitly included for publication with the requested main remediation.

## Remediation follow-up

The requested remediation is recorded in [CUTOVER_VALIDATION.md](../../../CUTOVER_VALIDATION.md) and the exact deployment steps in [DEPLOYMENT.md](../../../DEPLOYMENT.md). Final checks passed: 2,206 backend tests, 2,765 frontend tests, 55 explicit PostgreSQL acceptance tests, 46 cross-worktree tests, lint with zero errors, and production-target build. The production ledger still requires 15 migrations, rehearsed locally; production API/SPA deployment and credential rotation remain release steps. The missing private backup bucket was created and verified.
