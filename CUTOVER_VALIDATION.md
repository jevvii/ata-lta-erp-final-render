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


## Follow-up: client CSV retainer fees (2026-11-06)

Reviewed the existing local merge `f259fe63d1cbebd826a82b80d19de20b0276b3ea`, which includes enterprise-v2 `7b46012db5e6ed13d904e8d0be0487e4a0190436`, against published main `77a0aa44a838bf5620fbb6feb07e324b2f410149`. The change parses currency/grouped retainer fees and previews validated client records before import. Review added guards for overflowing numeric amounts and extra columns remaining after grouped-fee repair; both regressions failed before the guards and passed afterward.

Verification on Node v26.8.1: full frontend 191 files / 2,799 tests passed, focused client tests 7 files / 101 passed, cross-worktree harness 46 passed, production-target TypeScript/Vite build passed, frontend lint zero errors with 16 existing warnings, and diff whitespace checks passed. Existing bundle-size warnings and jsdom navigation diagnostics remain non-failing. Backend runtime, migrations, dependencies, secret handling, CI and Render configuration are unchanged. No production database or Render deployment actions were performed for this integration.


## Follow-up: financial PDFs, client selection and phase locks (2026-11-07)

Integrated staging `417f54fa38662b4104219a3215e5d550e04ab28f` and enterprise-v2 `fedac3b7843dc39de93b6fd937b1dd7384373dc3` on published main `bfa00e1fadd7418f765c66d55e652ba054af0780`. Incoming changes add financial branding and Chromium support, attachment downloads with browser print fallback, client TIN/DBA search and sorting, bidirectional client/work-request selection, and task phase indicators/locks. Resolved the dashboard test conflict by preserving main's task-picker authorization, completion and cross-user isolation coverage.

Review fixes preserve concrete selected-entity PDF scope while retaining explicit ALL-entity branding; escape fallback document titles and prevent cached printing after access errors; keep client sorting hooks unconditional across permission changes; reject locked time-entry submissions/reassignment; stabilize new client-list memo dependencies; and use semantic colors in the disbursement filter. Reset scripts now share transactional truncation, disable only the truncate guard, restore it before commit, roll back failures, and reject references outside the supplied table scope. New entity-scope, HTML-title, hook-order and phase-lock regressions reproduced the incoming defects before their fixes. No checks or security boundaries were weakened.

Final verification uses checksum-verified Node v22.23.4, matching Render's major runtime: backend 113 suites / 2,256 tests passed with 67 database-gated tests skipped in the default run; cross-worktree 46 passed; frontend full run 193 files / 2,849 passed with one static token-guard failure. Replacing the two raw colors with existing semantic utilities resolved that failure; the final token/disbursement UI rerun passed all 51 tests. Focused client, dashboard and print suites passed 127, 120 and 23 tests respectively. Final production TypeScript/Vite build passed. Lint has zero errors (backend two warnings, frontend 18 warnings); dependency audits report zero vulnerabilities in both packages. Existing bundle-size and non-failing jsdom navigation diagnostics remain. The initial Node 26 backend run exhausted its default heap; the successful Node 22 run used two workers with a 512 MB idle-worker recycle limit.

A disposable local PostgreSQL instance verified rollback restores data/protection after injected failure, foreign keys outside reset scope prevent truncation, and a successful reset preserves users and restores the audit trigger. Five automated reset-helper checks passed. Real local Chromium generated a valid PDF through the service with an explicit executable path. The overridden migration glob discovered all 88 migration files. The Alpine Docker image could not be built locally because this user's Docker daemon access is denied; Render still needs its normal image build/deploy. No migrations were added, and no production database, storage or Render actions were performed. Deploy the same reviewed revision to both main services, then run production verification against it.


## Follow-up: separate RDO column and sorting (2026-11-07)

Integrated staging `2495755d3b38b1efa8ff51fc00e3436cfde7218b` and enterprise-v2 `dd03a02683049588e936e1a4ad3726682fd30fe7` on main `7cdec0eae85cdfae4f990f0bfa7fce4b69ba49b5`. The client directory now separates TIN and RDO, offers RDO sorting, and accepts both backend sort aliases. Resolved the client-page conflict by retaining main's unconditional sorting hook and reusing the shared RDO comparator.

Review reproduced ascending/descending page-order errors when natural RDO sorting occurred after database pagination. RDO queries now fetch all authorized matching rows in batches, sort before slicing, compute the correct total, and load related data only for the selected page. Regression coverage verifies ordering, missing values last, metadata, aliases, entity isolation and results beyond 1,000 clients. RDO sorting therefore has memory/read cost proportional to the matching client set; other sorting paths retain their existing server pagination. No database migration or dependency change was needed.

Validation on Node v22.23.4: frontend 193 files / 2,853 tests passed; backend 113 suites / 2,264 tests passed, with the existing 67 database-gated tests skipped; cross-worktree 46 passed; focused client frontend 130 and backend 34 passed. The pagination regressions failed before the fix and passed afterward. Production-target TypeScript/Vite build and both linters passed (zero errors; existing two backend and 18 frontend warnings). Existing bundle-size and jsdom navigation diagnostics remain non-failing. PDF entity restrictions, reset protections, migration files, secret handling, workflows and Render configuration are unchanged. No production database, Storage or Render deployment actions were performed for this merge. Deploy the same reviewed main revision to both Render services, then run production verification against that SHA.


## Follow-up: templates, external receipts and realtime disbursements (2026-11-08)

Integrated staging `6edfdd8ff45892ccc29319e53ac970b090ec5757` and enterprise-v2 `b7a78f89bed5703d59f76eb6756891d69a871b61` on published main `55d0900c4c55a1b43ff99c369a895787f0dc67bc`. Incoming changes add template entity selection, checklists, drafts, task ordering and generation/team synchronization; external receipt links and Google Drive previews; financial document branding, consolidated NOTE fields and invoice-number locking; and new-disbursement selection/realtime updates. The disbursement table conflict preserves existing semantic color tokens.

Review fixed template source/target entity authorization and client/entity consistency, receipt embedding before an authorized URL response, realtime insertions into incompatible entity/filter/legacy-lifecycle caches, and drafts shared across signed-in users. Regression tests reproduced the authorization, receipt, cache and draft defects before their fixes. Incoming lint errors were corrected using existing types without suppressions. Draft storage is now scoped to the signed-in user; unowned legacy drafts are not automatically restored.

Validation on checksum-verified Node v22.23.4: backend 114 suites / 2,291 tests passed, with 67 existing database-gated tests skipped; cross-worktree harness 46 passed. The full frontend run passed 193 files / 2,900 tests and found three fixture mismatches in two files. Updating the invoice NOTE placeholder expectation and supplying the actual API entity in mutation fixtures resolved all three; the complete affected-file rerun passed 26 tests. No runtime code changed after that full run. Focused template/draft, authorized receipt and realtime regression checks also passed. Production TypeScript/Vite build, type checking and both linters passed (zero errors; two backend and 20 frontend warnings). Both dependency audits report zero vulnerabilities. Existing bundle-size warnings and non-failing jsdom navigation diagnostics remain.

No migrations, dependencies, secrets, workflows or Render configuration changed. No production database, Storage or Render deployment actions were performed. Deploy the same reviewed main SHA to both main Render services, then run production verification against that SHA; pushing main does not itself deploy when auto-deploy is disabled.


## Follow-up: task workspace and compact assignees (2026-11-08)

Integrated enterprise-v2 `9d76f80c987ae71e11a19e6d4db323fbcdc5f7df` on main `729524e10ad279608d80b39d44495184376be6c2`. Fetched staging `6edfdd8ff45892ccc29319e53ac970b090ec5757` was already included in main. The incoming frontend updates the task modal workspace, attachment cards, assigned-team display, checklist progress, background-refetch completion behavior, and board/side-peek assignee avatars and compaction. The merge had no conflicts.

Review preserved task access-denial handling, entity/user scope invalidation, phase/prerequisite locks, expected-version writes, and existing permission guards. A local Chromium check reproduced header controls extending beyond the modal at a 390 px viewport; wrapping the header/action groups keeps the controls within the modal at both 390 and 1366 px. Both browser checks used synthetic local data and produced no uncaught page errors. Added visible keyboard focus to the collapsible section controls. Removed hidden duplicate assignee markup introduced solely to satisfy test assertions, and moved those checks to the visible team list. Helper tests now import the owning taskScope module directly. Deliberately breaking lead detection caused the corresponding assignee regression to fail; the original code was restored before final validation.

Validation uses checksum-verified Node v22.23.4. Focused task/board/side-peek tests passed 82; permission/realtime regression tests passed 41; cross-worktree tests passed 46. The final full frontend run passed 194 files / 2,917 tests and found one outdated reference to the removed hidden assignee markup. After correcting that test reference, all 21 tests in the affected file passed. No runtime code changed after the final full run started. Production TypeScript/Vite build and type checking passed; frontend lint reports zero errors and the same 20 warnings as main. Root, backend and frontend npm audits each report zero known vulnerabilities. An added-line credential-pattern scan found no matches. Audits and source review do not guarantee the absence of all vulnerabilities. Existing bundle-size warnings and non-failing jsdom navigation diagnostics remain.

Backend runtime, migrations, dependencies, secrets, workflows and Render configuration are unchanged; the full backend suite was not repeated for this frontend-only delta. No production database, Storage or Render deployment actions were performed. Deploy the same reviewed main SHA to both main Render services, then run production verification against that SHA.


## Follow-up: template details and entity-scoped soft-delete (2026-11-09)

Integrated staging `56dc5c88491b7a1405d46ae43e598516d8ed546f` and enterprise-v2 `a59c6ccede71e32eabbe55f4792aeb7429c89682` on main `130520083180d7a22e28dbc879034f206af79c38`. Both merges completed without conflicts. The frontend adds retainer/other template detail views, deletion menus, and a confirmation dialog. The backend supports the X-Entity header alias and returns not-found for missing, previously deleted, or out-of-scope templates while retaining soft deletion and permission checks.

Review fixed template dialogs retaining selections after a user, active entity or permission change. All three regression cases failed before the fix and passed afterward; deletion is guarded against a stale dialog scope. Added single-entity manager authorization tests for both entity-header forms. Replaced 15 incoming explicit-any lint errors with canonical typed metadata and removed impossible checklist/client fallbacks. Also corrected the scalar assigned_to fallback in the new detail view.

Verification: full frontend 196 files / 2,932 tests passed on system Node v26.8.1. Full backend 115 suites / 2,306 tests passed with 67 database-gated tests skipped; an existing backfill suite initially failed because its default database was unavailable, then passed all 21 tests against a disposable local PostgreSQL database. The complete backend suite subsequently passed against that local database on both Node 26 and checksum-verified official Node v22.23.4. Node 22 also passed the 48 focused template tests and the production TypeScript/Vite build. Cross-worktree checks passed 46. Both linters have zero errors (20 existing frontend warnings and two backend warnings). Local Chromium verified detail opening and deletion cancellation at 1366 and 390 px with synthetic data and no uncaught page errors. Temporary preview files were removed and the disposable database stopped.

Root, backend and frontend npm audits each report zero known vulnerabilities; an added-line credential-pattern scan found no matches. These checks and source review do not guarantee that every vulnerability is absent. Existing bundle-size warnings, dependency comment-annotation warnings and non-failing jsdom navigation diagnostics remain. No migrations, dependencies, secrets, workflows or Render settings changed, and no production database, Storage or deployment actions were performed. Deploy the same reviewed main SHA to both main Render services, then run production verification against that SHA.
