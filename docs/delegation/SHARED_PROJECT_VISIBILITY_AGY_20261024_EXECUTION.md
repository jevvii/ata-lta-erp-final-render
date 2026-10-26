# Shared project visibility — execution and independent review

Specification: [SHARED_PROJECT_VISIBILITY_AGY_20261024.md](SHARED_PROJECT_VISIBILITY_AGY_20261024.md). Coordinator/reviewer: Codex. Executors: AGY `gemini-3.8-flash-high`, explicit `--effort high`.

## Result and publication

Local remediation accepted after independent review. Backend enforcement covers current WR lead/co-assignee and primary/relational task assignment; Admin alone has global project visibility within entity entitlement. Frontend exposes authorized WR financial/transmittal records and suppresses retained protected records after denial or scope changes. Existing task association and mutation capability rules remain in place.

Frontend: commit `298260c518492d7b739ca3995a8f3c3ed961d5ba`, pushed to origin `enterprise-v2`; upstream PR [#207](https://github.com/jevvii/ata-lta-erp-final-render/pull/207), base `enterprise-v2`. Backend is accepted for the requested corresponding `staging` publication. The final backend commit, PR URL and remote-head verification are recorded in the Obsidian audit's `Remediation Publication.md` after commit creation. Neither PR is merged or deployed by this work.

Both upstream branches were fetched; they matched the original local bases. Thus the reviewed local commits sit directly on the corresponding upstream branches without a history rewrite. Publication checks fetch and verify these bases again. Pre-existing untracked material is excluded from both commits.

## Existing checkouts and delegation

| Lane | Checkout / branch | Original base |
| --- | --- | --- |
| Backend | `ata-lta-erp-final-render` / `staging` | `4eab99a4b1c273b0ec9586d1deb36d113ee75b81` |
| Frontend | `ata-lta-erp-enterprise-v2` / `enterprise-v2` | `5e39d4304d41a07ebac6e56bb52e29e2e155c8eb` |

The user requested specification, delegation, execution coordination, review, upstream integration, origin pushes and separate upstream PRs. Work used the existing checkouts. Tracked trees were clean initially; unrelated untracked files were inventoried in `initial-state.json` and preserved.

`agy --help` and `agy models` verified the actual supported model and interface:

```text
agy --model gemini-3.8-flash-high --effort high --mode accept-edits --output-format json --add-dir <artifacts> --add-dir <specs> --add-dir <audit> --conversation <lane-id> --print <prompt>
```

Backend conversation: `38202427-54ba-4de3-a0ff-924fb17df12e`. Frontend conversation: `d28bc6d8-5366-49db-ad29-c70446f23d0d`. Planning preceded implementation; the coordinator reviewed plans and continued the same conversations with concrete corrections. Workers left source uncommitted; Codex owns commits, remotes and PRs.

AGY reached a quota limit during backend regression work. After the user switched accounts, the same conversation continued and delivered the remaining changes and handoff. Its final JSON retains `status: ERROR` and the earlier quota text despite containing the completed response; this is not represented as a successful CLI status. Independent execution and source review establish acceptance. Frontend's final financial-guard turn returned `SUCCESS`.

## Independent evidence and corrections

Historical audit files remain unchanged. Independent copies of the harness and evaluator live in `/tmp/shared-project-visibility-agy-20261024/`, with durable copies in the Obsidian audit's `evidence/remediation/`.

Before fixes, 33 characterization scenarios completed 1,287 fixture HTTP requests. Selected policy evaluation: 485 passed / 833 failed among 1,318 checks. All 16 additional desired-behavior checks failed. This establishes the before-fix result; characterization success alone does not establish policy compliance.

Review corrected nonexistent task-column queries (actual tasks have `assignee_id` and `work_request_id`, without `entity_id`, `co_assignees` or `assigned_to`), relational assignment membership, malformed/contradictory parent aliases, deleted parents, public mutation response bypasses, row-cap truncation, consolidated reports and alternate request/approval queues. Production UUID validation remains strict. Test fixtures now use valid project memberships/UUIDs for lifecycle and concurrency scenarios; obsolete global Accounting, creator-only and requester/name grants were replaced by explicit project-policy assertions.

Codex's final queue correction replaced duplicated partial-target checks with complete stored-record retrieval and the shared canonical project validator. Missing existing targets cannot fall back to proposed parents; new creation proposals require validated WR/task linkage. Six durable regressions cover entity/alias/deleted/missing targets and authorized creation proposals. Database lookup failures propagate rather than broadening visibility.

Frontend review corrected an indefinite Loading state after WR denial, retained task props after account/entity changes, stale responses after logout/account A–B–A changes, refresh retries under a different account, actual-Admin CDC guards, missing relational assignment invalidation, and fresh-200 restoration that mistakenly accepted stale placeholder data. Final review extended these protections to invoice detail/print preview, voucher detail, document viewer and transmittal detail.

## Final local verification

| Check | Independently observed result |
| --- | --- |
| Backend audit-derived acceptance | 73 / 73 tests pass |
| Historical HTTP/policy evaluation after fixes | 1,287 responses, 33 scenarios, 1,318 / 1,318 selected checks pass |
| Backend regression group | 387 / 387 tests, 16 / 16 suites pass |
| Backend syntax / changed-file ESLint | 29 JS files pass; zero lint diagnostics |
| Frontend operations/realtime/API-refresh | 947 / 947 tests across 56 actual files pass |
| Frontend financial/document/transmittal neighbors | 107 / 107 tests across 8 files pass, including 12 new privacy cases |
| Independent frontend API/session-race checks | 8 / 8 pass |
| Frontend TypeScript and production build | Pass; existing bundle-size warning remains |
| Frontend changed-file ESLint | 32 files pass; two older edited realtime test files retain 44 baseline `no-explicit-any` errors, independently reproduced from the original commit |
| Whitespace | Both reviewed diffs pass `git diff --check` |

Backend regression files: sharedProjectTeamVisibility, task-assignment-authorization, task-related-isolation, billing, disbursements, transmittals, documents, clients, reports, challenger_m3_1_billing_occ, concurrency-races, receipt_store_safety, receipt_all_view_regression, receipt_entity_guard, receipt_reservation_lifecycle, and workRequestAssigneeVisibility. OCC/action/lifecycle assertions remain exercised by authorized actors.

Evidence contains exact commands/configurations and JSON/log output: `coordinator-backend-final*`, `coordinator-backend-final-neighbors*`, `coordinator-backend-final-static.log`, `policy-results.json`, `coordinator-frontend-final-broad*`, `coordinator-frontend-financial-neighbors*`, `coordinator-frontend-accepted-api*`, build/lint reports and source SHA256 manifests. Worker handoffs are supporting evidence, not substitutes for these independent results. Their broad completion language and occasional per-file counts should not be treated as stronger evidence than the actual JSON reports.

Four unrelated billing tests were independently reproduced as failing before frontend changes (61 pass / 4 fail) and still fail in that separate baseline group. No unrelated billing fix is included. Backend's original dashboard ALL blanket-denial expectation was obsolete under the new project-scoped ALL rule and now tests scoped output.

## Browser review and limits

Actual React components were checked in Chromium using synthetic GET-only fixtures, without live data writes. WR/task views passed at 1440/768/390 widths: authorized rendering, stable denial without stale secrets, delayed account/entity changes, and restored membership after a fresh 200. Invoice detail/preview, voucher, document and transmittal views passed denial checks at 1440/390 without runtime errors. Screenshots and result JSON are archived; temporary harness entry files were removed from the checkout.

The design-taste-frontend existing-component workflow was applied without redesign. Its inspector encountered a CDP navigation timeout; no inspector pass is claimed. Direct Playwright inspection/screenshots provide the fallback evidence.

These checks exercise local Express middleware/controllers/services and real frontend components against in-memory or synthetic HTTP fixtures. PDF generation/storage are mocked in backend tests. They do not establish deployed PostgreSQL RLS, storage permissions or wire-level realtime delivery isolation. Previously issued signed URLs may remain usable until expiration. No migration, deployment, live-data change or dependency upgrade was performed.
