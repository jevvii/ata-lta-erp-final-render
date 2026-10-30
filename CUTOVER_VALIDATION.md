# Main cutover remediation — validation record

Prepared from main `4295e995` on 2026-10-30. This record covers the application fixes and deployment instructions prepared for publication to main. No Render deployment, production migration, or production credential rotation was performed during remediation. The missing private `erp-db-backups` storage bucket was created and its private status verified.

## Changes

- Public configuration accepts Supabase publishable or legacy anon keys only; missing/privileged keys return 503 without exposing service credentials. Browser storage rejects old privileged credentials.
- PDF and receipt downloads retain the selected entity rather than falling back to ALL after a scoped 404.
- Related work-request/task voucher aggregations reuse the canonical Accounting draft visibility policy.
- Malformed task-assignee entries no longer crash visibility checks, and test mode no longer bypasses a missing scoped parent.
- Document page hooks retain a stable call order when permissions change.
- Main blueprint selects main API/React services with production API/project settings; secrets group is backend-only. Top-level services preserve existing project placement, and public-key values use dashboard-managed `sync: false` declarations.
- Development/build/setup/Docker commands use frontend. Main/prod development starts React against the remote API, rather than accidentally starting a local backend.
- Production backup/migrate/verify workflow is explicit, pinned to a reviewed revision, and uses Node 22 plus the mixed SQL/JS migration runner. Async migrations are awaited and seed failures stop the run.
- React deployment metadata and GET-only smoke checks verify API target, reviewed commit, scripts, deep links, readiness and public configuration.
- CI checks backend and frontend tests/lint/build, and uses disposable PostgreSQL for schema and database acceptance checks.
- Stale tests were aligned to the current role, project membership, pending creation review, and backend-authorized realtime-refetch policies. No checks were disabled or test thresholds lowered.

## Production preflight

The supplied publishable key returned HTTP 200 from the production project's auth-settings endpoint. The production project URL is `https://nohelmujoswmmqedgern.supabase.co`.

Read-only ledger inventory found 87 migration files, 72 applied and 15 pending (`000065`–`000079`). No customer-data or schema writes were issued; the only production change was creating the private backup bucket. The migration chain passed on a blank local PostgreSQL database. The 15 pending migrations also passed against a local production schema-only copy plus its migration ledger; no customer records were copied. These checks establish schema compatibility, not data-backfill correctness for every production row. A recoverable backup and controlled maintenance window are still required.

## Verification evidence

All commands used the official Node v22.23.4 binary, verified against the published SHA256 checksum.

| Check | Result |
| --- | --- |
| Full backend suite | 109 suites passed; 2,206 tests passed; 55 database-gated tests skipped in default run |
| Explicit disposable PostgreSQL lifecycle/receipt/invoice suites | All 55 tests passed |
| Cross-worktree integration harness, using monorepo frontend by default | 46 passed |
| Final full frontend suite | 189 files / 2,765 tests passed |
| New document permission transition reproduction | Failed before fix; passed after fix |
| Browser preview | Direct /operations redirects to React login; bootstrap calls main API; no uncaught errors |
| React smoke harness | Six positive/negative local-server tests passed |
| Production-target React build | Verified; explicit API target and deployment.json emitted |
| Lint | Backend and frontend have zero errors; existing warnings remain |
| YAML | Blueprint, CI, production workflow and Docker compose parse successfully |

Final production-target build and typecheck passed after the lint corrections; the full frontend rerun includes the new document permission-transition regression. Large bundle-size warnings and non-failing React test act warnings remain; no performance threshold was reduced.

## Deployment

Follow [DEPLOYMENT.md](DEPLOYMENT.md) for the exact existing-service settings and ordered release steps. The first dashboard action is disabling auto-deploy on both main services before publishing the reviewed revision. Keep the maintenance window open until migrations, API, SPA, smoke and authenticated QA complete. See that guide for the potentially exposed old service credential and coordinated rotation procedure.
