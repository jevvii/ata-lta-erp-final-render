# Receipt remediation verification — 2026-10-19

Implemented in the existing `integration/disbursement-billing-audit-20261017`
worktree, based on `e6ee1f3`. Base backend/frontend checkouts and their existing
uncommitted work were not modified. Changes are split into backend and frontend commits for PRs targeting
`staging` and `enterprise-v2`, respectively.

## Corrected defects

- Serialize every reservation read/check/write using an exclusive shared filesystem
  lock; reload under lock and persist with atomic replacement and fsync. Surface
  configuration, corruption, contention, and persistence failures explicitly.
- Cleanup defaults to the configured database client. Returned errors, thrown
  errors, unavailable clients, and malformed results cannot authorize deletion.
- Persist deletion intent before asynchronous verification, preventing a concurrent
  binding. Retain failed cleanup records and report unsuccessful CLI runs accurately.
- Never reclaim binding claims based only on age. Preserve committed voucher data
  and its claim when receipt consumption fails. Retain claims on ambiguous database
  outcomes rather than restoring stale snapshots or deleting committed vouchers.
- Reject completion if expiry/cleanup raced binary verification.
- Remove the queue's silent 50-page cap and fail explicitly on repeated pages.

## Evidence and limits

Backend integration tests: 636 passing across 36 suites. Regressions include real local filesystem failures and eight
independent Node processes competing for the same reservation file; exactly one
claim succeeds. Six concurrent creators preserve all unrelated records. HTTP tests
cover persistence failure after voucher create/update and ambiguous PostgreSQL
error outcomes. Tests formerly relying on mutating returned cache objects or
stealing old claims now assert the protected behavior.

Frontend disbursement tests: 177 passing across 15 files, including retrieval of
the 5,001st queue item and repeated-page rejection. Backend lint, frontend TypeScript
and production build pass. Vite reports a bundle-size warning. A backend run with
`--detectOpenHandles` passed and exited cleanly. Ordinary runs intermittently
report Jest’s delayed-exit warning after all assertions pass; no forced-exit flag
was used.

Database/storage calls in these tests use mocks. Live PostgreSQL concurrency and
private S3 round-trip acceptance remain unverified. Production requires an absolute
`RESERVATION_STORE_PATH` on a durable filesystem shared by all API/cleanup writers;
no infrastructure was provisioned. See [operations and recovery](receipt-reservation-operations.md).
Verification did not perform deployments or database migrations. Publication uses
separate backend and frontend PR branches; deployment configuration remains a
prerequisite before production rollout.
