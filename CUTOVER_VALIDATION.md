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

## Follow-up: assigned task status defaults

Integrated backend `b624c26a7ca0c0c3f07fff8d22b0d7e4db5a400c` and frontend `5d800a214d2a31b0df8be645c6231f65c1ab619f` on top of main `a59075781045883b289147a634fbb505e752089c`.

Review corrected migration 000080 to preserve migration 000076's Manager entitlement checks, supported qaStatus alias, JSON object validation, and serialized write safeguards. Added a working rollback to the preceding RPC definitions and 12 real SQL checks in CI. Quick Add now rejects a selected assignee removed from the work-request team; its regression test failed before the fix and passed after it. Incoming lint errors were corrected without suppressions.

Verification: full backend 2,226 passed; full frontend 2,779 passed; real PostgreSQL assigned-status checks 12 passed; cross-worktree checks 46 passed; production build passed; lint has zero errors. Migration 000080 passed both a schema-only production-copy rehearsal and the blank-database migration chain. A read-only production check found only migration 000080 pending. No production schema/data changes were applied.

The live frontend metadata check reported commit 406e97e on both the main Render static-site URL and its custom domain, independently of the API Docker deploy. Deploy the reviewed revision to both services after its backup/migration workflow succeeds; verify uses the frontend's deployment.json commit.


## Follow-up: direct task financial creation

Integrated staging `2b7062da34f70ab5be9a3ed114d0b8acd6a25e8e` and enterprise-v2 `7a603976a326b7f88ce0ba2777d9b4084ca5d000` on top of main `45809f6e8dd5bf21c2aa553673202a79e4024ae3`. The frontend removes task-level invoice/transmittal request actions and their pending-request query; direct creation retains the existing task-assignment and permission guards. Staging updates the corresponding cross-worktree expectation. No backend runtime, migration, dependency, secret, workflow or Render blueprint changes are included.

Verification: operations frontend suite 55 files / 900 tests passed; cross-worktree harness 46 passed; production-target TypeScript/Vite build passed; frontend lint zero errors with 16 existing warnings. Temporarily re-enabling invoice requests caused the new regression test to fail as expected, and the source was restored byte-for-byte. Existing bundle-size warnings remain. The full backend suite and real SQL tests were not repeated because their runtime code and migrations are unchanged. Deploy the reviewed revision to both main Render services and run production verification against that same revision; this integration adds no migration beyond 000080.
