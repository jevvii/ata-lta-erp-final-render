# Statement details remediation — execution and independent review

Specification: [STATEMENT_DETAILS_AGY_20261025.md](STATEMENT_DETAILS_AGY_20261025.md). Coordinator/reviewer: Codex. Core implementation: AGY `gemini-3.8-flash-high`, explicit `--effort high`. Final frontend corrections and acceptance: Codex.

## Result

Accepted for publication after independent source review and local acceptance. Statements consume canonical payment properties with legacy document-input fallbacks. Invoice child-read errors stop detail/export before rendering/storage. Invoice and voucher editors persist sparse intentional overrides, support deliberate blanks and reset to automatic values, and no longer freeze defaults over later payments/actors. Client changes preserve custom bill-to values while updating inherited defaults. Invoice detail/preview provide retryable errors without stale financial actions; unpaid/template/manual fields are explained.

The user authorized fetching upstream, placing reviewed changes on top, pushing origin branches and separate upstream PRs. Both upstream/origin branch pairs were fetched before dispatch and again after acceptance; upstream still matches the local starting bases. Reviewed commits can sit directly on those bases without rebasing or rewriting remote history. Final commit/PR identities and remote-head verification are recorded in the Obsidian audit's `Remediation Publication.md`. No merge, remote migration, live record edit or manual deployment forms part of this work.

## Checkouts and delegation

| Lane | Existing checkout / branch | Starting base |
| --- | --- | --- |
| Backend | `ata-lta-erp-final-render` / `staging` | `9b5533d8aac33c92121dd66b985925bf8ca766a2` |
| Frontend | `ata-lta-erp-enterprise-v2` / `enterprise-v2` | `154fdb5cc6261dc17590cba0e7651047db832ad0` |

Both tracked trees were clean initially. Pre-existing untracked notes/audits were inventoried, preserved and excluded from task commits. No new worktrees, branch switches or dependency changes were used. Workers owned only their source/test lane and left changes uncommitted; Codex owns Git/publication and independent evidence.

`agy --help` and `agy models` verified the CLI and requested model. The dispatcher pinned each cwd, model, effort, edit mode and conversation. Planning preceded review and resumed execution:

```text
agy --model gemini-3.8-flash-high --effort high --mode accept-edits --output-format json --add-dir <artifacts> --add-dir <spec> --add-dir <audit> --conversation <lane-id> --print <prompt>
```

Backend conversation: `0e6634c0-c967-4494-b9f8-0bfb0e875b66`; frontend: `ce5bb622-518f-4d08-b91a-d64f0b2bb2de`. Backend plan, implementation and correction turns returned SUCCESS. Frontend delivered the implementation, durable tests and successful checks but continued re-review without a final handoff. Codex intentionally interrupted that turn and its subsequent correction turn, then took sole write ownership for final corrections. Their CLI ERROR/interruption statuses are preserved and are not described as successful completed handoffs. No model substitution occurred. Acceptance rests on actual source and independent validation.

## Independent validation

| Check | Observed result |
| --- | --- |
| Backend desired-behavior acceptance | 13 / 13 pass; baseline 2 pass / 11 fail |
| Backend statement/address/billing/OCC/voucher neighbors | 196 / 196 pass across 5 suites |
| Frontend financial/print/privacy/OCC/lifecycle/API neighbors | 120 / 120 pass across 12 files |
| Independent rendered editor acceptance | 6 / 6 pass; baseline all 6 fail |
| Frontend/backend canonical/legacy/override document checks | 30 / 30 pass, including output parity |
| Real Chromium interaction acceptance | 24 / 24 pass at 1440/768/390 |
| Real Chromium client selection | 2 / 2 pass, inherited and custom bill-to cases |
| New control metrics | 6 / 6 views pass: 12px metadata, 32px desktop/tablet and 44px phone reset targets, visible 2px keyboard focus, no page overflow |
| TypeScript and production build | Pass; existing bundle-size warning remains |
| Backend/frontend changed-file ESLint | Pass, zero errors/warnings |
| Final invoice-detail/privacy check after removing unrelated formatting | 21 / 21 pass; TypeScript passes |
| Whitespace | Both diffs pass `git diff --check` |

Backend group: billing.statement, billing.address, integration/billing, challenger_m3_1_billing_occ, disbursements.print. Frontend group: invoiceClientPrintDefaults, invoiceEditModal, statementDocument, invoiceDetail, printPreview, disbursementDocument, disbursementPrintEditing, scopedFinancialDocumentPrivacy, invoicePresenceAndOcc, disbursementPresenceAndOcc, adminApprovalAndPaymentModals and useDisbursements.

Tests use fixtures/mocked persistence, auth, PDF renderer and storage. Real browser tests render the actual React components against in-memory HTTP responses; browser mutations never target live financial records. No real PDF-byte or deployed-environment acceptance is claimed.

## Review corrections and baseline repairs

Canonical non-nullish `method`/`reference` take precedence over aliases; explicit canonical blanks suppress fallback. An empty method infers no cash/reference/bank, Cash has no check field, and Check has no cash amount. Sparse replacement semantics remain unchanged: missing key inherits, explicit empty string deliberately blanks, `{}` resets all overrides. No migration or ambiguous snapshot cleanup was introduced.

Codex confirmed and corrected the client selector's remaining writes to clientName/clientTin overrides using real-browser reproduction. Selected client data now supplies inherited defaults while explicit names/TINs remain intact. Two durable client tests cover preservation and reset against the new client. New error dialogs have associated accessible titles/descriptions. New metadata is 12px with adequate contrast; reset controls have visible focus and phone targets. Obsolete voucher payment-edit guidance was replaced with accurate print-only guidance.

Review rejected production access to React's private `_valueTracker` added during synthetic-test repair. Those refs were removed; inputs use normal controlled events and functional state updates. An old voucher test dispatched a change to the exact same release name already inherited, then expected a saved override. It now changes to a genuinely different name and asserts untouched paymentDate remains absent; the test title correctly identifies its Draft fixture. Normal browser interactions and all regression tests pass without private React manipulation.

Baseline comparison archived original tracked backend sources in a temporary directory (not a Git worktree): the three affected suites had 29 pass / 7 fail before changes. Six neighbor failures involved missing project memberships or LTA vouchers with ATA parents; the seventh was the statement financial-lock fixture. Test-only repairs supply deterministic WR membership and coherent LTA client/WR links, preserving expected statuses, outsider rejection and runtime authorization. A pre-existing frontend date assertion was updated to the DateInput's existing locale display; DateInput runtime was not changed.

The backend plan reran historical reproductions that refresh output files. Codex restored the two refreshed artifacts from the original vault copy and verified the original audit's entire checksum manifest before final archival. Historical findings/evidence remain unchanged. A client-switch Vitest prototype was unsuitable for Radix portal interaction and was replaced by real-browser evidence and a durable editor test with an explicit native-select test double.

Unrelated whole-file formatting in invoice detail was removed before publication. No private tooling, temporary browser entry, unrelated audit, credentials or pre-existing untracked notes are included in the commits.

Sourcery completed both initial PR reviews successfully, with no frontend inline findings. Its two backend findings requested stronger test coverage for the exact recorded payment date and the Bank Transfer bank/branch value in statement HTML. Codex added those assertions, reran the 26-test statement suite and lint, and published a focused follow-up test commit on staging using a normal push. No runtime change or history rewrite was needed; the backend PR therefore contains two task commits and the frontend PR one.

## Browser assessment and evidence

The `design-taste-frontend` existing-component workflow was used without a redraw or redesign. Before and after were captured at all three widths and the final invoice inspector reports 0 FAIL / 1 WARN. Its small-text warning is retained deliberately: the existing compact billing screen uses 12px body/labels, and the new metadata also uses readable 12px rather than changing the surrounding type system. Controls wrap without overflow. The existing narrow phone line-item editor is outside this correction's scope. An intermediate inspector CDP timeout is preserved; the final run succeeded. Actual voucher/reset and error/retry states were independently inspected in Chromium.

Working evidence: `/tmp/statement-details-agy-20261025/`. Durable evidence: Obsidian `ATA-LTA/Audits/Disbursement Statement Details 2026-10-25/evidence/remediation/`. It includes CLI discovery, prompts/JSON/statuses, plans/handoffs, baseline/final acceptance, source fingerprints, browser fixtures/screenshots/metrics, inspector reports and publication metadata. Scripts must run from the documented workspace with its existing dependencies; do not execute historical characterization writers as remediation acceptance.

Existing snapshot intent cannot be inferred automatically; administrators retain deliberate controls to reset overrides. No claim is made about the exact screenshot record, deployed revisions, production data, live PostgreSQL/RLS or storage policies. The original audit remains historical; this record establishes reviewed local remediation and publication readiness.
