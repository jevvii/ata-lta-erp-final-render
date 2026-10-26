# Receipt entity context — AGY 3.8 Flash High specification

Spec ID: RECEIPT-ENTITY-20261021. Executor: **AGY `gemini-3.8-flash-high`, effort `high`**. Coordinator: **Codex**, responsible for contract decisions, plan approval, independent review, verification, corrections and explicit-path local commits. Status: implemented, reviewed and rebased onto refreshed upstream branches for authorized PR publication; live staging acceptance outstanding. Backend commit `419f2f3`; frontend commit `bc8d4bd`. See [execution and review record](RECEIPT_ENTITY_CONTEXT_AGY_20261021_EXECUTION.md) for actual verification and AGY/Codex ownership.

## 1. Problem and intended behavior

From the ALL view, receipt reservation/completion omit the selected work-request context and fall back to the user's first entity. Voucher creation includes the selected client/work request and resolves to its entity. The same user can consequently receive 403 `RECEIPT_RESERVATION_MISMATCH` after a successful upload. The defect reproduces in both entity directions using the actual middleware/service/driver and disposable local PostgreSQL.

Audit: `/home/deutz/Documents/Obsidian Vault/ATA-LTA/2026-10-21 - Receipt Reservation Mismatch Audit/Audit Report.md`. Reproduction and evidence are under that folder's `evidence`. Migration 000072 is already applied on configured staging, and receipt health/readiness pass. This task corrects the application context; no schema migration is expected.

Required outcome: selecting an ATA or LTA work request in ALL must reserve, complete and submit with that same specific, authorized entity. Receipt ownership remains private and immutable. Selecting another work request, changing session/entity, or closing the form invalidates an in-progress upload or completed receipt reuse as appropriate. The global ALL session must remain ALL.

## 2. Existing worktrees and ownership

| Lane | Existing checkout / branch | Starting commit | Owned paths |
| --- | --- | --- | --- |
| A — backend | `/home/deutz/Migration_Final-render/ata-lta-erp-final-render`, `staging` | `33d79ce107217d60bfec1dc10896c614afda1555` | Receipt-specific routes/middleware, relevant backend tests, narrow API documentation |
| B — frontend | `/home/deutz/Migration_Final-render/ata-lta-erp-enterprise-v2`, `enterprise-v2` | `7c915d3d7c4996425ecaf75ce0dd0fbaae4d22f0` | `frontend/src/features/disbursements` receipt/form/API context and relevant tests; existing shared modal hook only if required |
| Coordinator | Both checkouts plus Obsidian | — | This specification, execution record, independent integration/review and commits |

Reuse those checkouts directly, as requested. Do not create worktrees, switch branches, reset or clean. Both contain unrelated untracked files; preserve all of them. Each lane has one writer and must not edit the other lane. Backend checkout's old frontend is outside scope. Handoffs/logs go in `/tmp/receipt-entity-agy-20261021/`, not into unrelated docs.

## 3. Frozen contract

### C1. Entity transport

Use the existing **`X-Active-Entity: ATA|LTA` header** to bind each reserve, complete and voucher-create request to a specific entity. Header values are canonical codes, not UUIDs. Existing entity-scope middleware remains the authority for authorization; receipt SQL stores UUIDs resolved on the server.

The frontend resolves the selected work request's canonical `entity` value; inspect the actual operations response/types. Do not hard-code project UUIDs or infer entity from the receipt object key. Under a specific session entity, verify any known selected work-request entity agrees with it. In ALL, block before uploading if the selected work request or its entity is absent/unresolved. Do not guess from `user.entities[0]`, associated-client ordering, or a default ATA value. If a trustworthy canonical entity is unavailable in an existing response, report the gap and propose a narrow fetch/mapping to the coordinator before changing contracts.

The API wrapper already permits explicit headers and omits the global ALL header. Carry the chosen entity through local helper/mutation options. Do not add transport metadata to persisted voucher JSON or serialize it through the business input schema. Existing helper callsites without context must either retain safe behavior in a specific entity or receive clear validation errors; no silent guessing in ALL.

Receipt request/response bodies remain compatible:

```text
POST /v1/disbursements/receipt-uploads
  header X-Active-Entity: ATA|LTA
  body { filename, contentType, size }
  201 { data: { uploadId, uploadUrl, objectKey, expiresAt } }
PUT uploadUrl (binary, Content-Type)
POST /v1/disbursements/receipt-uploads/:uploadId/complete
  header X-Active-Entity: same ATA|LTA
  200 { data: { receiptS3Key, receiptFilename } }
POST /v1/disbursements
  header X-Active-Entity: same ATA|LTA
  body existing validated voucher input
```

### C2. Backend fail-closed guard

Receipt reservation and completion routes must reject unresolved **ALL** context with HTTP **400**, code **`RECEIPT_ENTITY_REQUIRED`**, safe detail: “Select a specific ATA or LTA entity for this receipt upload.” Do this **before** the shared `resolveEntity()` fallback, storage signing, reservation writes or binary verification. Guard both receipt endpoints. A single-entity user whose omitted header is unambiguously defaulted by the existing authorized entityScope to ATA/LTA can remain compatible. A dual-entity user with omitted header or literal ALL is ambiguous and must fail.

Keep normal `resolveEntity()` behavior for other modules/routes. Prefer registering these receipt routes with their own guard plus the existing resolver before the module-wide resolver. Do not broadly change global entity fallback. Existing entityScope must reject unauthorized explicit entity requests with 403 before signing/writes. Avoid inadvertently accepting arbitrary invalid raw headers as authorized explicit entity context; inspect upstream normalization and, if necessary, reject malformed headers narrowly at the receipt guard.

Body `entity`, client IDs, URL UUIDs and receipt keys must not bypass this receipt header contract when the scoped context is ALL. Wrong-user/wrong-entity completion and binding remain forbidden. No SQL ownership weakening, reassignment or migration changes.

### C3. Frontend lifetime and retry

Capture target work-request ID, associated client ID, canonical entity and session identity before any asynchronous upload. Carry the captured target through reserve/complete/create. Stale responses must not restore uploadedReceipt, submit under a changed work request, or close/reset another form.

Selected work-request/client/target changes invalidate the prior completed receipt metadata even when global session remains ALL. Keep the selected file where safe so the user can upload it again deliberately; do not reuse the old key under a different work request/target. The file input itself must be cleared when file state is cleared. After a proven ownership mismatch (4xx), invalidate cached upload and give actionable inline guidance; user input remains available. Do not swallow an error in the blocking action layer as successful creation.

Preserve the existing no-file confirmation, MIME/size limits, complete-before-bind flow, disabled/double-submit protection, stale-session guards, pending-create tracking, and uncertainty after lost network/5xx responses. Never make an ambiguous create retryable merely by changing target/file. Distinguish upload validation from an already started voucher create. A busy/pending request in another context must not be released by stale callbacks.

### C4. Constraints

Rules (echo these in each plan):

- R1: One explicit, authorized entity for reserve, complete and create; ALL must never become a receipt owner.
- R2: Preserve user/entity ownership, reservation state transitions, private storage/RPC grants and verification.
- R3: Invalidate stale/cached attachment context on target or session changes without enabling duplicate or ambiguous creates.
- R4: Reject ambiguous receipt context before any storage/reservation side effect.
- R5: Preserve unrelated dirty/untracked files and keep one writer per existing checkout.
- R6: No worker commit, push, PR, deploy, remote write/migration, credential output or other-agent spawning. Codex reviews and commits owned files.
- R7: Report exact tests, failures, skips and fixture boundaries. Do not label mock storage or fixture-backed HTTP as a live acceptance test.

Non-goals (echo these in each plan): no visual redesign, generic role/permission rewrite, global entity resolver rewrite, old prototype remediation, schema/RPC alteration, financial lifecycle change, reservation reassignment, cloud configuration change, or remote acceptance writes.

## 4. Lane A — backend assignment

1. Read audit/spec and actual request middleware order. Produce a short plan listing owned paths and tests; wait for Codex's plan approval before editing implementation.
2. Implement C2 in the existing receipt routes without double-running the resolver or affecting other disbursement routes. Prefer a small receipt-specific guard with useful unit/HTTP coverage.
3. Test literal ALL, missing-header dual membership, malformed entity header, body-entity bypass, no side effects, unauthorized explicit entity, and safe single-entity compatibility. Both endpoints must be covered.
4. Add an integrated regression using actual receipt/entity middleware and real service behavior, with scoped reference fixtures and safe local/mock binary verification. Show ALL-origin requests with explicit LTA succeed despite ATA-first membership; inverse ATA with LTA-first also succeeds; consume/bind once where fixtures support it. Foreign users/entities must remain blocked. Do not claim PostgreSQL concurrency from mocks. The coordinator will review and may add an independent local SQL check.
5. Update relevant receipt API contract documentation with required explicit entity in consolidated clients, stable error and rollout compatibility. Existing application defaults, readonly listing/preview and other upload paths remain unchanged.
6. Run appropriate receipt/integration suites, changed-file lint and diff checks. Leave edits uncommitted. Handoff changed paths, exact commands/results, any prior-suite assumptions now obsolete, and rollout limitations.

## 5. Lane B — frontend assignment

1. Read audit/spec and actual WorkRequest entity mapping. Produce a short plan of types/API helpers/mutation/form context and tests; wait for Codex approval before editing implementation.
2. Add typed target entity transport to receipt reserve/complete helpers and voucher creation. Preserve public helper usability and keep request headers separate from voucher business fields. Use the captured selected work request's canonical entity; never alter global session.
3. Add appropriate context invalidation for work request/client/target changes, including changes while upload or completion is in flight and reuse after a 4xx rejection. Preserve uncertainty/double-submit behavior under async create responses.
4. Handle `RECEIPT_ENTITY_REQUIRED` with useful selection guidance and invalidate cached receipt on ownership mismatch. Keep form input/file when appropriate; upload errors must abort voucher creation, and a genuine no-file action keeps its confirmation.
5. Write tests asserting **actual fetch headers and payloads** for all three requests in ALL→LTA and ALL→ATA. Verify unresolved targets do not reserve/PUT/complete/create; changed work request during or after upload does not reuse a stale key; unchanged-context rejected create can reuse a safe completed receipt; mismatch recovery requires fresh upload; foreign/session changes abort. Include ambiguous 5xx/timeout result protections and double-submit regressions.
6. Run targeted tests, changed-file lint, TypeScript and production build. Report prior failures separately. No dependency changes without a demonstrated need. Leave edits uncommitted and produce exact results/limitations in handoff.

## 6. Acceptance and coordinator review

| ID | Gate |
| --- | --- |
| E01 | ALL→LTA with ATA-first and ALL→ATA with LTA-first: same explicit target on reserve, complete, create; completed receipt can bind once |
| E02 | Missing/literal ALL receipt context rejected before signing, creation or verification; specific single-entity compatibility retained |
| E03 | Unauthorized entity, foreign-user completion/binding, cross-entity claim/replay still denied |
| E04 | Target/client/work-request changes during reserve/PUT/complete invalidate callbacks and cached metadata; global ALL stays ALL |
| E05 | Proven mismatch clears cached receipt and guides re-upload; safe unchanged-context retries retain allowed reuse |
| E06 | Lost create response, 5xx/timeout, cross-context change and double submit do not create a duplicate or clear a still-pending outcome |
| E07 | No-receipt confirmation, storage failures, MIME/10 MiB validation, preview, health and existing SQL ownership remain intact |
| E08 | Changed-file lint, targeted tests, frontend TypeScript/build and diff checks pass; any broader failures explicitly attributed |
| E09 | Evidence distinguishes local SQL, fixtures/mocks, live readonly checks and unperformed cloud acceptance |

Codex approves plans, reviews diffs for authorization/context races, runs independent verification and fixes findings before local commits. AGY handoffs are claims to verify. Run existing receipt regressions and inspect the source coverage gap rather than merely updating expected statuses. Do not weaken test assertions to make the guard pass.

PR readiness verdict must distinguish code/test readiness from live acceptance. Staging UI upload/create/preview acceptance is not authorized by this spec; report it outstanding. Backend-first rollout may reject ambiguous ALL uploads from an older frontend; coordinate both changes or deploy frontend first because explicit headers are already supported by the current backend. No new migration is needed.

## 7. Dispatch and artifacts

Use exact AGY model/effort flags: `--model gemini-3.8-flash-high --effort high`. If unavailable, report it; no silent substitute. Worker plans, execution and review summaries go to `/tmp/receipt-entity-agy-20261021/{backend,frontend}-{plan,handoff}.md`. The coordinator maintains the execution record next to this spec and copies specs/results into the audit's Obsidian folder.

Plan phase prompt: “Read RECEIPT-ENTITY-20261021. You own lane A/B only in its named existing worktree. Produce a plan with Rules and Non-goals echoed, owned paths, contract details, tests and risks. Do not edit implementation yet. Save the plan artifact and return the conversation ID for coordinator review.”

Implementation phase: Codex resumes the same AGY conversation with written plan approval or corrections, authorizes only that lane, and requires an uncommitted handoff. No worker asks the human to approve a routine implementation choice that Codex can resolve within this contract. Scope changes return to Codex.
