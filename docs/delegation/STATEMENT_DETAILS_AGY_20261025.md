# Statement and disbursement details — AGY remediation specification

Spec ID: STATEMENT-DETAILS-20261025. Coordinator and final reviewer: Codex. Backend and frontend executors: AGY `gemini-3.8-flash-high`, explicit `--effort high`. Model and CLI flags verified with `agy --help` and `agy models` on 2026-10-25.

## Objective and authority

Resolve F01–F03 in `docs/audits/disbursement-statement-details-2026-10-25/Audit Report.md` and make unpaid/inherited/overridden statement values understandable. Audit in Obsidian: `ATA-LTA/Audits/Disbursement Statement Details 2026-10-25/`. Original evidence is historical characterization and must remain unchanged.

The user authorizes implementation, coordination, review, fetching upstream `staging` and `enterprise-v2`, placing reviewed local changes on top, pushing matching branches to origin, and opening separate PRs to upstream matching branches. Codex alone handles Git mutations/publication. No deployment, PR merge, live record edits or remote migrations are authorized by this workflow.

## Existing checkouts and exclusive ownership

| Lane | Checkout | Branch | Starting commit |
| --- | --- | --- | --- |
| Backend | `/home/deutz/Migration_Final-render/ata-lta-erp-final-render` | `staging` | `9b5533d8aac33c92121dd66b985925bf8ca766a2` |
| Frontend | `/home/deutz/Migration_Final-render/ata-lta-erp-enterprise-v2` | `enterprise-v2` | `154fdb5cc6261dc17590cba0e7651047db832ad0` |

Both tracked trees are initially clean. Upstream and origin were fetched; local branches equal upstream at dispatch. Existing unrelated untracked files must be preserved and excluded from commits. Use these checkouts directly. No new worktrees, branch switches, dependency upgrades, reset/clean, commits, pushes, PRs, merges or deployment by workers. Backend writes backend source/tests and narrowly relevant API docs. Frontend writes enterprise-v2 frontend source/tests only. Codex owns this spec, independent acceptance evidence, execution/publication records and Obsidian copies. Do not edit coordinator acceptance tests or original audit artifacts. One worker per lane.

Worker artifacts: `/tmp/statement-details-agy-20261025/`. Plan and final handoff must name actual changed files, test commands/results, unresolved concerns and schema/compatibility decisions. Never print credentials or env file contents.

## Shared behavior contract

### Payment representation and provenance (F01)

1. Canonical invoice payment properties are `method`, `reference`, `payment_date`, `amount`; this matches table/RPC/raw invoice-detail responses. Preserve these API properties. No schema migration is needed.
2. Frontend types, history, defaults, browser print and backend statement defaults/PDF HTML must consume the canonical properties. Support existing legacy-shaped input using `payment_method` and `reference_number` only as compatibility fallbacks. Canonical non-nullish values win over aliases; explicit canonical empty strings remain empty. Use one small resolver per codebase if it reduces duplicated branches. Keep frontend/backend behavior aligned.
3. Cash: amount in cash, no check reference/bank inferred from unrelated fields. Check: reference in check field, no cash amount. Bank Transfer/other nonempty methods: preserve current layout semantics (amount in cash/amount slot, reference, method in bank/method slot). A structured bank/branch is not captured by invoice payments; do not invent one or add a new financial data model in this fix.
4. Statement details and statement document must agree for the same payment. Keep existing latest-payment selection/order; no aggregation redesign. Invoice collection and disbursement funding remain separate transactions.
5. Preserve template `HENRY WONG` default unless manually overridden; label/explain template defaults so they are not presented as recorded approval evidence. Prepared/received signatures stay blank unless intentionally supplied; do not invent identities.

### Print overrides versus automatic defaults (F02)

1. Keep existing `printDetails` request and `print_details` storage contract: submitted objects replace the previous overrides object atomically with existing version checks and admin authorization. `{}` is valid and removes all overrides. No backend merge semantics or new migration is required.
2. Editors initialize override state from the raw persisted overrides object, **not** from fully resolved defaults. Compute automatic values separately from the current record with its overrides omitted. Render each input from an own-property override if present, otherwise its automatic value. `''` is an intentional blank override; missing key means automatic. Do not use `||` to erase explicit blanks.
3. On a user input change, update only that field's override, preserving every other saved override. Saving unrelated notes/financial fields must not materialize inherited defaults, blank payment values or blank lifecycle signature names. Submit the sparse complete overrides object, preserving replacement semantics.
   Changing the invoice client updates inherited bill-to name/TIN from the selected client's available data without inserting override keys. Existing deliberate bill-to overrides remain until changed/reset by the administrator.
4. Each field needs a clear automatic/custom/blank state and an accessible **Use automatic** reset control for overridden fields. Reset removes the key, showing its latest automatic value, and persists that removal on Save. Setting a field to empty remains a supported deliberate action. Manual overrides, deliberate blanks and resets must survive reload and match browser/server print.
5. Existing snapshots are ambiguous: preserve their overrides exactly unless the administrator resets a field. Do not silently strip empty values or bulk-rewrite saved snapshots. Explain that resetting restores automatic data without editing ledger/workflow identities.
6. Both inline and modal invoice/voucher editors follow this model. Preserve Admin-only print edits, OCC/version conflicts and existing financial/lifecycle edit restrictions.
7. Approval, funding and release after an unrelated Draft save must populate voucher payment and actor signature defaults. Later invoice payments must appear after unrelated saves. Preserve canonical audit actors, ledger values and all project/entity/task access guards.

### Failed child reads and truthful UI (F03)

1. Backend must inspect both invoice line-item and invoice-payment query errors and throw a useful `AppError` (500, stable error identification if consistent with current conventions). A failed child query must not be returned as an empty ledger or incomplete successful invoice.
2. Invoice PDF and voucher export paths that use the invoice detail loader must fail before rendering/uploading when required child reads fail. Do not swallow the error, issue a misleading PDF or misrepresent retrieval failure as unpaid status.
3. Invoice detail and print-preview surfaces must show a clear retryable data-load error on non-access query failures, and suppress incomplete/cached fallback actions/content while that failure is active. Preserve existing 403/404 denial and account/entity scope guards; do not weaken or broadly refactor the shared privacy hook. Add narrow local handling as needed.
4. For a successfully loaded invoice with no payments, show a concise explanatory message (e.g. "No payments recorded. Payment details appear after a payment is recorded."). Keep actual overrides visible. Explain manual signature/template data concisely; no fictitious recorded actor. Do not label a query failure as no payments.

## Backend lane deliverables

- Correct actual/legacy payment-property handling in canonical statement helper and builder, keeping the API response contract unchanged. Audit other invoice export consumers for this same defect within scope.
- Reject child-query errors in the invoice loader and exports with regression coverage for line items and payments; assert renderer/storage are not called on failure.
- Verify `{}` and sparse override replacement, intentional blanks, missing-key fallback, admin-only writes, stale/missing version protection and unchanged payment/workflow audit identities.
- Durable tests should exercise API-recorded Cash, Check and Bank Transfer using actual schema fields, rather than only synthetic alias-shaped fixtures. Update obsolete assertions only with an explicit behavioral reason.
- Document canonical payment properties and print override semantics in module docs. No remote database operations or migrations.

## Frontend lane deliverables

- Fix `InvoicePayment` types and all affected statement/history/print consumers; canonical/legacy precedence must match backend.
- Implement sparse print override state/reset controls in invoice and disbursement editors, preserving untouched saved overrides and intentional blanks; no wholesale snapshot of default-derived values.
- Add unpaid explanation and template/manual-signature guidance, plus invoice detail/preview data-read error/retry state. Suppress stale print/payment actions on failed loads; retain current access-denial protections.
- Meaningful rendered tests: unrelated save before payment/funding; existing override retention; deliberate blank; reset to auto; later payment and voucher actor defaults; canonical/legacy payment shape and method cases; stale child-load errors and retry; inline/modal and OCC behavior.
- Run TypeScript, focused neighbor tests, changed-file lint and production build. Preserve existing routes/design/components. Apply `design-taste-frontend` existing-component rules; no redesign, font/color changes or decorative additions. Codex will independently inspect real components in a browser at 1440/768/390.
- Keep new metadata legible (at least 11px, appropriate contrast), provide visible keyboard focus and adequate reset touch targets, and give new error dialogs associated accessible titles/descriptions.

## Coordinator independent acceptance and review

Keep the historical audit's seven HTTP and sixteen document characterizations intact; copy/adapt acceptance into a separate remediation evidence directory with desired assertions. Required independent checks:

| Scenario | Required result |
| --- | --- |
| API-created Cash/Check/Bank Transfer | Correct canonical method/ref/date in response, detail/history and statement HTML; Check has no cash; aliases supported only as fallbacks |
| Unrelated invoice save, then payment | Empty overrides object remains empty; date/ref appear automatically |
| Second invoice payment | Current selection policy reflected; no accidental frozen first-payment snapshot |
| Unrelated Draft voucher save, then approve/fund/release | Canonical payment and actor names visible in print; ledger/status/identity unchanged by print edits |
| Intentional custom/blank override | Retained on reload/export and unaffected by unrelated save |
| Reset an override | Key removed, latest automatic value restored, other overrides retained |
| Change invoice client | Inherited bill-to fields track the selected client without creating overrides; explicit bill-to customizations remain unchanged |
| Child read fails | Invoice GET/export fail; no renderer/storage call; frontend shows retryable failure rather than no-payments/cached print |
| Existing security/OCC/lifecycle | Non-admin print edits, stale versions and existing unauthorized actions remain rejected |

Codex reviews the complete source diff, independently runs focused/broader relevant tests, checks frontend/backend parity, TypeScript/build/lint, and inspects actual changed controls in Chromium. Use fixture data for mutation tests. No claim of deployed verification follows fixture success. Record baseline failures separately; do not hide them or expand into unrelated repairs.

## Delegation and publication workflow

1. Verify AGY CLI/model. Start two noninteractive AGY sessions with explicit cwd, `--model gemini-3.8-flash-high --effort high --mode accept-edits --output-format json`. First prompt requests plan-only; review plans, then resume the same conversation for implementation and corrections. Do not substitute models if quota/unavailability occurs; report it to Codex.
2. Workers leave reviewed changes uncommitted. Coordinator maintains prompts, JSON responses/conversation IDs, plans, handoffs, independent checks and review corrections in the evidence directory.
3. Once accepted, fetch upstream/origin again. Preserve unrelated untracked work. Create backup refs before any necessary rebase. If upstream moved, put only reviewed task commits on top of the matching upstream branch and resolve conflicts under coordinator review. Do not use force pushes; handle any origin divergence explicitly without discarding commits.
4. Stage exact task-owned files only. Backend staging commit includes backend remediation and this specification/execution record; frontend enterprise-v2 commit includes frontend remediation. Exclude original/unrelated audits, private tooling/env files, temporary harnesses and pre-existing untracked notes.
5. Push origin `staging` and `enterprise-v2` normally. Open separate PRs to `jevvii/ata-lta-erp-final-render`, bases `staging` and `enterprise-v2`, heads `deutzgalila:staging` and `deutzgalila:enterprise-v2`. Describe final behavior, pairing/dependency and actual validation. Verify remote head IDs, PR diff scope and CI results. No merge/deploy.
6. Copy the spec, execution/review results and final publication record into the existing Obsidian audit under new remediation files/evidence; preserve historical evidence byte-for-byte.
