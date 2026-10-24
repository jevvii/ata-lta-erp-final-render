# Shared project team visibility — AGY remediation specification

Spec ID: SHARED-PROJECT-VISIBILITY-20261024. Coordinator/reviewer: Codex. Implementers: AGY `gemini-3.8-flash-high`, explicit `--effort high`; availability verified with `agy models` on 2026-10-24.

## Objective and authoritative evidence

Implement the 360° Shared Project Team Visibility Rule: every current WR lead, WR co-assignee or worker assigned to any task within a WR can read all that project's tasks, documents, invoices/payment status, disbursements/receipts and transmittals across departments. No non-admin can discover/read unrelated projects, including another WR for the same client. Only Admin has global project read visibility, within existing entity/lifecycle authorization.

Audit: `/home/deutz/Documents/Obsidian Vault/ATA-LTA/Audits/360 Shared Project Team Visibility 2026-10-24/Audit Report.md`. Companion: `Read Policy and Acceptance.md`, `evidence/Observed Matrix.md`. Repository copy: `docs/audits/shared-project-team-visibility-2026-10-24/`. Historical fixture evidence records 33 scenarios, 1,287 HTTP responses and 833 failures among 1,318 selected policy checks; characterization success is not desired behavior.

This is a read-policy correction. Preserve task-specific request/create/relink/write guards introduced by task-assignment remediation. A teammate may open Task B and read B's records, but does not thereby gain B's mutation permissions. Task A must still display only records actually linked to A. Preserve financial lifecycle/OCC, receipt claims and all existing department action capabilities.

## Existing checkouts and ownership

| Lane | Existing checkout | Branch | Baseline |
| --- | --- | --- | --- |
| Backend | `/home/deutz/Migration_Final-render/ata-lta-erp-final-render` | `staging` | `4eab99a4b1c273b0ec9586d1deb36d113ee75b81` |
| Frontend | `/home/deutz/Migration_Final-render/ata-lta-erp-enterprise-v2` | `enterprise-v2` | `5e39d4304d41a07ebac6e56bb52e29e2e155c8eb` |

Use these checkouts directly; no new worktrees/branch switching/reset/clean/dependency upgrades. Both tracked trees were clean at dispatch; pre-existing untracked material must remain untouched. Backend owns backend source/tests and narrowly relevant API docs. Frontend owns enterprise-v2 frontend source/tests. Codex owns this specification, execution/review/publication records, independent acceptance artifacts and Obsidian copies. Do not edit the other lane, original audit evidence or coordinator acceptance files.

Artifacts: `/tmp/shared-project-visibility-agy-20261024/`. Workers write lane plans, logs and handoffs there, leave application changes uncommitted, and never fetch/rebase/commit/push/open PRs/merge/deploy/run remote migrations/change live data. Codex handles final publication after independent review. No schema migration or live data modification is expected; identify any migration requirement before implementing it.

## Findings to close

| ID | Required outcome |
| --- | --- |
| F01 | WR/task lists/details/related endpoints and all aliases enforce current project membership and actual entity before loading child records. Close cross-entity task and WR-related bypasses. |
| F02 | DMS list/search/count/detail/download URLs use project scope; optional filters cannot substitute for authorization. |
| F03 | Accounting no longer bypasses project scope for invoice/voucher lists, counts, details, receipts and exports. |
| F04 | Documentation and historical record creator do not bypass transmittal project scope. |
| F05 | Legitimate teammates can read others' disbursements/receipts in list/detail/related/count paths; creator-only read limits are removed. |
| F06 | Primary and relational task assignees resolve identically to WR members across every module. |
| F07 | Draft/Pending invoice reads are permitted to the same project team as other statuses. |
| F08 | Invoice PDF/payment-voucher generators receive trusted caller authorization before render/storage side effects. |
| F09 | Client directory/details, aging/reports/analytics/dashboard results and badges do not expose unassigned WRs or aggregates. Authorization-aware caches prevent cross-user reuse. |
| F10 | Requester/submitter/creator and display names alone do not grant membership. Use current UUID assignments; revocation removes historical access. |

## Backend contract

### Canonical scope and references

1. Establish one reusable membership resolver used by Operations, Billing, Disbursements, Documents, Transmittals, Clients and Reports. Membership includes `work_requests.assigned_to`, UUID `co_assignees`, primary `tasks.assignee_id`, relational `task_assignees.user_id` and any supported UUID task co-assignee arrays. Only active, non-deleted parent/task assignment counts. Do not infer membership from display names, creator/requester/submitter or an unrelated checklist item. Fail closed on database errors with a controlled unavailable/error response, never a broadened result.
2. Resolve trusted authenticated caller and entity authorization independently of project membership. Admin alone bypasses the project predicate; Admin does not authorize a malformed/deleted/wrong-parent link or unauthorized entity. Support `ALL` only by intersecting the caller's allowed entities. Remove ID-only fallback grants that cross this boundary.
3. A protected record's project is derived from its stored, validated WR/task linkage, not a request query/filter. For invoices/vouchers canonical `task_id` takes precedence, `linked_task_id` is fallback only when canonical is absent/null. Transmittals/documents use their established linked task column. Reject or exclude inconsistent task/WR/entity links rather than accidentally authorize either parent. Lists/search/counts must not expose deleted or unauthorized parent records. Task-linked legacy rows lacking a WR may derive their real task parent if validated; otherwise unlinked/client-only/malformed/orphan records fail closed for non-admins. Do not silently assign them to all WRs for the client.
4. Apply authorization predicates before pagination/count/aggregate. A non-admin client directory may show only clients represented by authorized WRs; client detail must not include unauthorized WR/task/financial subrecords. A client match does not grant access to all that client's projects. Templates/team reference catalogs are not automatically project records; preserve legitimate reference selection without leaking project detail.

### Read endpoints and internal service callers

5. Enforce scope on every public read path and route alias: WR and task lists/details/counts, WR/task related routes, DMS list/search/count/detail/download, invoice list/status/count/detail/aging/PDF/payment voucher, voucher list/queues/count/detail/receipt/PDF, transmittal list/count/detail, client lists/counts/details, reports/dashboard/aging/analytics. Review rejected/pending request sublists used by counts/queues so those cannot reveal unrelated target details. Avoid expanding writes or unrelated functionality.
6. No public read may interpret missing `user` as unrestricted access. Audit all existing internal service call sites before changing a read signature. Use an explicit, narrow internal path only after existing action authorization, where required to preserve billing payments, voucher lifecycle, task updates and request fulfillment. Do not replace a missing caller with an Admin identity, introduce broad userless defaults, or let external input select an internal bypass. Provide internal callers enough trusted context or an isolated helper so reads remain secure without breaking existing approved writes.
7. Remove department and record-creator exemptions and disbursement creator-only READ filters. Do not remove requester-only correction/receipt ownership or financial action checks. All current project teammates see all statuses/archives under existing lifecycle exclusions. All linked record arrays in the WR aggregate are complete; task aggregates remain correctly task-linked.
8. Scope both rows and totals in analytics/aging/dashboard/calendar/daily/weekly/monthly reports and counts. An entity-only cache cannot hold final user-specific output. Either key by authorization scope with revocation-safe invalidation or recompute scoped results; do not serve another user's stale aggregate. Fresh reads after assignment removal must deny previously visible records. Preserve Admin results.
9. Authorize before generating/signing/uploading files. Include receipt/PDF/URL denial tests verifying renderer/storage functions were not called for outsiders. Existing issued signed URLs may survive until expiry; document that residual window and avoid claiming instantaneous storage revocation without evidence. PostgreSQL/RLS and realtime delivery state are not established by fixture tests.

### Tests

10. Add meaningful behavior tests for all F01–F10, with current UUID lead/co/primary/relational memberships, Manager/Accounting/Documentation, outsider and Admin. Include same-client different WRs, unrelated client, name collision, historical requester/creator, assignment removal between requests, deleted/cross-entity parents, canonical/legacy conflicts, `ALL`, counts, pagination and report cache isolation. Existing positive tests may need explicit membership fixtures; preserve their purpose and assertions, never mock away the scope guard globally or weaken denial expectations. Clearly classify genuinely obsolete creator-only/global-department assertions under the new rule.
11. Keep API response shape/URLs compatible. Preserve the task request/create/relink suite, financial lifecycle/OCC/receipt store tests, and task record-association isolation. Run changed-file lint and relevant neighboring suites. Record any broader pre-existing failures accurately with reproduction.

## Frontend contract (enterprise-v2)

1. Inspect active enterprise-v2 implementation; do not copy staging's older frontend. Preserve the existing department module read gates and task-specific write controls. Teammates may open any task in their authorized WR and view linked records regardless of specific-task assignment; eliminate any local creator/assignment/department checks that wrongly hide read data. Task ownership filters remain, so a task displays its own records.
2. Make WR-level records discoverable from the existing WR interface using the existing WR aggregate API where appropriate, with document/invoice/voucher/transmittal read access. Keep this a restrained extension of existing components, with no redesign or dependency changes. If the current interface already provides complete access, prove it rather than adding duplicate UI. Do not implement security by hiding buttons or trusting local filters.
3. Treat 403/404 after membership removal as loss of access: stop showing protected stale list/detail/related/file data, close/clear affected views or show a concise access-lost state. Session/account/entity switches must not show previous scope data through query `initialData`, placeholder data or unscoped detail keys. Include user/entity/target scope as needed without breaking existing invalidation prefixes. Cancel/invalidate protected queries on assignment changes and prevent late responses restoring revoked data.
4. Review realtime cache reconciliation: non-admin raw CDC payloads must not insert unauthorized project records into lists/details or resurrect removed data. Prefer authenticated API refetch/invalidation for protected data when membership cannot be established from an event. Assignment events (WR/task/relational assignees) must invalidate relevant protected read caches; don't claim database/RLS or wire-level realtime isolation if not verified/implemented.
5. Cover Operations reading Accounting's invoice/payment status, Liaison #1 reading Liaison #2's voucher/receipt/form, Accounting reading Operations milestones, and Documentation reading approvals/payment status. Include read-success versus write-denial, relational assignees, known outsider IDs, failed/refetched authorization, rapid entity/WR/account changes, delayed responses and unchanged task ownership filtering.
6. Run meaningful rendered/hook tests, task assignment/association neighboring regressions, changed-file lint, `npm run typecheck`, and `npm run build`. Do not modify package manifests/lockfiles unless a genuine existing dependency issue requires coordinator review. No cosmetic changes are needed; no visual redesign is requested.

## Coordination and review protocol

1. Planning turn per lane: inspect actual code/spec/audit, write `<lane>-plan.md` with file list, shared API assumptions, risk/tradeoff/internal-call strategy, acceptance tests and expected baseline issues. No application edits during planning. Return AGY conversation ID via JSON output.
2. Codex reviews plans and supplies corrections through the same conversations, pinned to `gemini-3.8-flash-high` and `--effort high`. Never silently substitute a model. One writer per lane.
3. Implement after Codex's continuation. Capture meaningful pre-fix failure evidence where practical, run tests, write `<lane>-handoff.md` with exact files/commands/counts/failures/limits. AGY success is not independent acceptance.
4. Codex reviews diffs and independently executes audit-derived desired-behavior checks, neighboring regressions, lint/typecheck/build. Return material defects to their owner and repeat until resolved. Do not change historical audit response files; independent after-fix output goes to the remediation artifact directory.
5. Archive plans/prompts/responses/handoffs/results/specification and execution record under the existing Obsidian audit's `evidence/remediation/`. Preserve original audit history. No claim of deployed remediation follows local fixture success.

## Publication authorized by the user

After independent acceptance, Codex fetches upstream `staging` and `enterprise-v2`, preserves pre-existing local/untracked work, and places the reviewed lane commits on the corresponding latest upstream base. Use clean focused commits, one per lane if practical; no accidental unrelated files. Rebase only the reviewed unpublished commits if needed, resolve any conflicts deliberately, and rerun checks affected by upstream/conflict changes. Do not reset/clean away user work or force-push.

Push backend `staging` and frontend `enterprise-v2` to their matching `origin` branches, then open/update separate PRs in `jevvii/ata-lta-erp-final-render` targeting `staging` and `enterprise-v2` respectively, using `deutzgalila` as head owner. Confirm actual remotes and branch divergence before publishing. PR descriptions state final behavior, local validation and remaining deployed verification. The user already authorized these publication steps. PR merge and deployment are outside this request.
