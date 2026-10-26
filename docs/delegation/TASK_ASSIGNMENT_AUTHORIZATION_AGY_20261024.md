# Task assignment authorization — AGY remediation specification

Spec ID: TASK-ASSIGNMENT-20261024. Coordinator/reviewer: Codex. Executors: AGY `gemini-3.8-flash-high`, explicit `--effort high` (availability verified with `agy models`).

## Objective and evidence

Close creation/request/relink paths that let non-admin users attach requests, disbursements, or invoices to tasks they are not assigned to. Lead and relational co-assignee both count. Parent work-request membership, sibling-task assignment, Manager role, and module permissions alone never substitute for target-task assignment on these paths.

Audit: `/home/deutz/Documents/Obsidian Vault/ATA-LTA/Task Request Authorization Audit - 2026-10-24/Audit Report.md`, with executable reproduction suites and logs in `evidence/`.

F01: generic billing/disbursement/transmittal requests lack target-task authorization. F02: standalone disbursement selector/submission bypasses task-panel scope. F03: parent/sibling membership enables request controls. F04: direct invoice creation accepts another employee's task. C01: non-admin Documentation transmittal assignment enforcement already works and must remain intact.

**Branch correction:** audit frontend reproductions used staging's older frontend. Execution frontend is enterprise-v2, which ALREADY filters Documentation transmittal tasks and has stronger Accounting task-panel restrictions. Inspect and preserve these; do not copy staging frontend wholesale or implement an unnecessary transmittal redesign. Jen's live profile/deployed build has not been inspected.

## Existing checkouts and ownership

| Lane | Checkout / branch | Starting HEAD |
| --- | --- | --- |
| Backend | `/home/deutz/Migration_Final-render/ata-lta-erp-final-render` / `staging` | `5f7f5be60fd72dcc726fdb68be8728e1b14b088a` |
| Frontend | `/home/deutz/Migration_Final-render/ata-lta-erp-enterprise-v2` / `enterprise-v2` | `1472352aa340d872274f62074975a7a2334163dd` |

Use these existing checkouts directly. No branch switching, new worktrees, reset/clean, rebase, dependency upgrades, deployment, remote migrations, or live-data changes. Preserve all pre-existing untracked files. Backend owns backend source/tests and narrowly necessary API docs. Frontend owns enterprise-v2 frontend source/tests only. Coordinator owns this spec, execution/review records, and Obsidian copies. One writer per lane. Workers leave source uncommitted and do not push or open PRs. This is local remediation and review, not remote release.

Artifacts: `/tmp/task-assignment-agy-20261024/`. Each lane writes a plan and, after coordinator approval, implementation/test handoff plus logs. Model/effort must not silently change.

## Frozen behavior contract

### Requests versus issuance

1. `POST /v1/operations-requests`, types billing/disbursement/transmittal: retain module/type permission checks, then require assignment for non-admin task-linked requests BEFORE deduplication or insertion. `workflow:edit` must not bypass assignment. Phase transitions and unrelated request types retain current behavior.
2. Invoice creation (`POST /v1/invoices`) remains a direct issuance capability governed by `billing:edit`. Accounting and Manager may create task-linked invoices only for tasks they lead/co-assigned. Operations/Documentation gain no invoice issuance permission.
3. Disbursement creation remains governed by `disbursement:create`; all applicable roles, including Accounting and Manager, need assignment when a task is linked. Draft/approval/funding/release and requester visibility rules stay intact.
4. Accounting is not presented as requesting an invoice; Documentation directly issues transmittals rather than using a transmittal request button. Preserve enterprise-v2's existing Accounting/Documentation request exclusions and backend's explicit Documentation billing-request denial, including mixed departments. Do not broaden role permissions to make buttons succeed. If a discovered UI/API policy mismatch needs an additional exclusion, document the precise choice for coordinator review.
5. Preserve existing non-admin Documentation transmittal create/update/send assignment checks and enterprise-v2 dropdown filtering. Do not expand the Documentation-specific issuance rule to Manager-only transmittal issuers in this task. Their current behavior is an explicit preserved boundary; task-linked generic transmittal REQUESTS still require assignment for Managers.
6. Admin retains its existing assignment exemption, but no invalid/missing/deleted/cross-entity task or wrong-parent relationship is authorized by Admin status. Use trusted authenticated role context, never request-body identity or email-based privilege for new server guards.
7. Keep existing WR-only invoice/disbursement/request workflows valid when there truly is no task link. Do not make a task universally mandatory. Documentation transmittals retain their existing mandatory-task rule. An omitted task cannot bypass authorization for an existing linked record being relinked/unlinked.

### Target resolution and server enforcement

- Reuse/factor the existing primary/relational assignment helper where appropriate. Avoid introducing circular module imports. Assignment query errors fail closed; do not treat DB errors as permission grants.
- Normalize supported camelCase/snake_case task and parent aliases before authorization. Reject conflicting nonempty aliases with a clear 400 validation error, rather than checking one target and persisting another. Null/empty alias combinations must not hide a supplied target. Preserve valid legacy payload compatibility.
- Resolve a real active task and its active parent work request; require matching selected work request and active entity. Also preserve existing client/reference validation. For optional parent IDs, derive/check the task's actual parent rather than skipping scope checks.
- For invoices/disbursements, existing stored ownership is canonical `task_id` with `linked_task_id` fallback only when canonical is null/missing. Malformed/conflicting linkage must not authorize the wrong task.
- Creation: authorize the normalized target before any write or receipt claim/deduplication side effect. Return 403 `TASK_ASSIGNMENT_REQUIRED` for a valid in-entity task the caller is not assigned to. Invalid/deleted/wrong-parent/out-of-entity references return controlled 400/404 consistent with existing conventions, with no data mutation. Avoid leaking foreign record details.
- Relinking updates: when task/work-request linkage is changed or cleared, authorize both the existing task (if linked) and destination task (if linked) for non-admins, validate effective parent consistency, and write a consistent canonical/legacy pair. Recognize explicit null/empty clear attempts and all supported aliases. Preserve OCC and atomic invoice updates. This prevents detaching someone else's task as an authorization bypass.
- Do not apply new assignment checks to unrelated invoice payments, voucher funding/release, or reads. Existing RBAC/ownership/lifecycle checks remain authoritative for those actions. No schema migration is expected.
- Stale assignments: server checks current database assignment when the operation is submitted, not cached client membership. Document any residual database transaction race rather than claiming atomic assignment locking without implementation/evidence.

### Frontend behavior (enterprise-v2)

- Remove parent/sibling-membership fallback from task REQUEST controls. Require target-task lead/co-assignee, keep direct issuance exclusions and existing effective permission requirements. Recognize legacy role and department-based profiles consistently. Preserve current Accounting billing-task-only restrictions on task status/time/upload/invoice panel controls and Accounting exclusion from task-panel disbursement/transmittal controls; this work must not expand those features.
- Standalone Billing and Disbursements task selectors show assigned/co-assigned tasks for non-admins; Admin sees eligible tasks under existing entity/WR rules. This filters task choices, not all task-read APIs globally. Standalone module creation permission remains unchanged. Do not impose a new billing-task-type restriction on the standalone invoice API; retain any existing stricter task-panel rule.
- Do not treat an empty filtered task list as permission to submit a stale/prefilled/hidden task ID. Validate selected task against current WR/entity/query data and assignment at submit time; block unknown/loading/stale target IDs. Clear or visibly invalidate selection when parent/entity/assignment changes, without wiping unrelated user input. Never submit previous WR's placeholder tasks during query transitions.
- Retain optional no-task mode for WR-only invoices/vouchers. An invalid prefilled task must fail visibly; silently clearing it and submitting a WR-only record is not acceptable.
- Preserve enterprise-v2's receipt reservation/claim transport, selected-target lifetime and async response protection; task-selection changes should participate in correct submission invalidation where required. No receipts can be uploaded/consumed or vouchers submitted for invalid task selection.
- Keep Transmittals' existing Documentation dropdown and required-task rule; add preservation tests. Do not change page layout/design or dependency versions.

## Acceptance matrix

Write behavioral regressions; current audit tests assert vulnerabilities and must NOT be copied as passing desired behavior unchanged.

| Case | Expected |
| --- | --- |
| Operations/Manager generic financial/document request on sibling/outsider task | 403; no request inserted; UI hidden |
| Authorized request lead/co-assignee | success under existing type/role policy |
| Unassigned Accounting/Manager invoice task link | 403; no invoice/line-item writes |
| Assigned Accounting/Manager invoice task link | success; Operations/Documentation issuance still denied |
| Unassigned Operations/Documentation/Accounting/Manager voucher link | 403; no voucher/receipt-claim side effects |
| Assigned voucher lead/co-assignee | success under current module policy |
| Admin valid task link | success without task assignment |
| Wrong WR/entity/deleted task, forged identity or conflicting aliases | rejected, no mutation |
| Alias-only and dual consistent aliases | same assignment semantics |
| Assignment removed after dropdown load | API rejects; frontend clears/blocks on refreshed state |
| Relink/unlink someone else's existing task, including explicit null and legacy aliases | denied without mutation |
| Relink own linked task to unassigned task | denied; authorized destination succeeds |
| WR-only invoice/voucher/requests | existing behavior preserved |
| Documentation transmittal assigned/co-assigned vs unassigned | success vs 403; existing dropdown excludes foreign task |
| Manager-only direct transmittal issuance | existing policy preserved; no new role expansion |
| Rapid duplicate request after unassignment | cannot return an unauthorized cached/deduped result |
| Old task query resolves after WR/entity switch | no foreign selectable/submitted task |

Cover both Admin and role/departments variants where behavior differs. Include mixed-department Documentation restrictions. Existing successful tests may need explicit assignment fixtures to retain their original purpose; do not weaken assertions or globally mock away the new guard. Unit fixtures are not evidence of real PostgreSQL behavior.

## Delegation protocol and review gates

1. AGY planning turn per lane: inspect checkout, relevant code/tests, and this contract; write `<lane>-plan.md` in the artifact directory. Identify exact files, baseline failures, risks, policy ambiguities and smallest test set. No production source edits in the planning turn. Return conversation ID via JSON response.
2. Codex reviews plans against actual code and approves/corrects via an explicit continuation of each AGY conversation, retaining model/effort and ownership.
3. AGY implements only its lane, runs focused meaningful tests, neighboring regressions, changed-file lint, diff whitespace checks; frontend also typecheck/build. Capture pre-fix failure evidence if feasible without reset or trampling work.
4. Handoff records exact changed files, commands, exit/results, test counts, skipped/blocked checks, remaining risks, and confirms no remote writes. Keep logs in artifact directory; do not print secrets or credentials.
5. Codex independently inspects diffs and runs acceptance checks, returns corrections to workers, and accepts only after resolving material defects. AGY SUCCESS is not acceptance by itself.
6. Execution record and Obsidian copy distinguish local implementation/test readiness from live staging/deployed verification. No automatic deployment, merge, push or migration follows local success.

## Subsequent publication authorization

After local implementation/review acceptance, the user authorized fetching upstream `staging` and `enterprise-v2`, placing the local remediation changes on top, pushing the matching branches to origin, and opening respective upstream PRs. The earlier no-commit/no-push constraints describe the AGY implementation phase; they do not prevent this separately authorized publication. No merge or deployment is authorized by this publication step. See the execution record for upstream bases and validation.
