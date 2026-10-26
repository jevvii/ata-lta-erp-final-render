# Receipt reservation storage and recovery

The backend provides two pluggable storage drivers for receipt upload reservations:
1. **`database` (Recommended / Production default)**: Persists reservations in a dedicated private PostgreSQL table (`receipt_reservations`) via atomic stored procedures executed by the backend's Supabase service client.
2. **`filesystem` (Compatibility / Local development default)**: Coordinates Node processes through an exclusive filesystem lock directory and synchronous atomic file rewrite/fsync.

## Driver selection

The driver is configured via the environment variable:
```bash
RESERVATION_STORE_DRIVER=database|filesystem
```

- Explicit invalid values fail closed returning HTTP 503 `RECEIPT_STORE_NOT_CONFIGURED`.
- When unset:
  - If `RESERVATION_STORE_PATH` is set, `filesystem` mode is selected for backwards compatibility.
  - Otherwise, `NODE_ENV=production` defaults to `database`.
  - Development and test default to `filesystem` with temporary local storage.
- Never falls back silently from database errors to a local file or memory. Database persistence failures return HTTP 503 `RECEIPT_STORE_DATABASE_UNAVAILABLE`.

## Database driver deployment & security

In `database` mode:
- Reservation records are stored in `public.receipt_reservations`.
- Row-level mutations and claims are managed by atomic PostgreSQL procedures with row locks (`FOR UPDATE` / `SKIP LOCKED`).
- **Security & Authorization**: All privileges on `receipt_reservations` and its associated RPC procedures are REVOKED from `PUBLIC`, `anon`, and `authenticated`. Only the backend `service_role` has execute and table permissions. Row Level Security (RLS) is enabled. Browser clients cannot read, query, or mutate reservations directly.
- **Render deployment**: Free tier web services on Render lack persistent disks. After migration 000072 is applied, `RESERVATION_STORE_DRIVER=database` stores reservation metadata independently of the service filesystem; no disk mount is required. Receipt binaries remain in the configured private Supabase bucket.

## Filesystem driver deployment requirement

If retaining `filesystem` mode in production:
- Production must set `RESERVATION_STORE_PATH` to an absolute JSON file path on a **durable shared volume used by every API worker and cleanup process for that environment** (e.g., `/var/lib/erp/receipts/reservations.json`).
- The directory must be writable only by the application account. The filesystem must support atomic mkdir/rename and fsync.
- Filesystem busy states return HTTP 503 `RECEIPT_STORE_BUSY`. I/O failures return HTTP 503 `RECEIPT_STORE_IO_ERROR`.

## Health and readiness probes

- `/health`: Includes `checks.receiptStore` (in addition to `supabase` and `storage`). Returns 200 `ok` when all checks pass; returns 503 `degraded` if any check fails. Successful checks are cached for 30s; failed checks are un-cached so service recovery is recognized immediately.
- `/readyz`: Uncached live readiness check that executes bounded timeouts against database, Supabase Storage, and receipt store readiness. Returns 200 `ready` or 503 `not_ready`.
- `/livez`: Decoupled liveness probe returning instant 200 as long as the event loop is responsive.

## Cleanup

Expired receipt reservations and orphaned storage binaries are cleaned up periodically:
- The API worker starts periodic cleanup automatically on server boot (`startPeriodicReceiptCleanup`), running every 15 minutes. In `database` mode, this starts without requiring a filesystem path.
- CLI execution:
  ```bash
  cd backend && npm run cleanup:receipts -- [--dry-run] [--ttl-ms 900000] [--retention-ms 86400000]
  ```
- Exit status is nonzero (1) if any object fails its verification or deletion step.
- Cleanup atomically marks candidates with `status = 'deleting'` before issuing storage deletion requests.
- Active claims (`status = 'claimed'`) and records linked to vouchers in `disbursements` are **never** deleted.
- Deletion is idempotent and retryable. Storage failures transition the record to `cleanup_failed` with retry metadata.

## Cutover and rollback runbook

### Migration-before-application rollout
1. **Apply Migration 000072**: Run `000072_receipt_reservations_db.js` against target database using service credentials before deploying the application build. Verify table and functions exist.
2. **Quiesce existing writers** (if transitioning from active filesystem mode):
   - Quiesce API writers and cleanup workers.
   - Inspect active claims in the filesystem store. Reconcile any claims that correspond to created vouchers.
   - Keep the existing service explicitly in `filesystem` mode while outstanding reservations drain. Resolve every active binding claim against the voucher database; do not delete claims based on age.
   - For completed unbound uploads, either finish the voucher before cutover or let the owner restart the upload after the old reservation expires and controlled cleanup runs. Do not delete or silently abandon the JSON file.
   - Back up the old store while all writers are stopped. This change does not include an importer. If reservations must be preserved across the switch, defer the switch until a separately validated import/reconciliation is available.
   - Wait for in-flight requests to complete, and confirm no active claims remain before switching drivers.
3. **Deploy application configuration**:
   - Set `RESERVATION_STORE_DRIVER=database`.
   - Verify `/health` and `/readyz` return 200 and report `checks.receiptStore: true`.
4. **Rollback plan**:
   - If rolling back application code, existing vouchers retain their storage keys and stay readable because voucher preview/download relies directly on voucher records in PostgreSQL and signed storage URLs, not on reservation rows.
   - Prefer rolling back the application while keeping a compatible database reservation driver and additive migration in place. Switching drivers is a data cutover, not just an environment toggle.
   - To return to filesystem mode, quiesce DB writers/cleanup, reconcile every DB claim and pending/completed reservation, and drain or explicitly migrate them before re-enabling the old file. Configure `RESERVATION_STORE_PATH` on a durable shared volume. A Free Render instance does not provide such a volume.
   - Never run the down migration against active reservations: it drops metadata. Down is supplied for disposable-test rollback; production rollback requires a reviewed backup/reconciliation plan.
   - Use separate databases/projects for separate environments; never point staging and production at the same reservation table with independent cleanup policies.

## Verification

- `tests/integration/receipt_reservation_database.test.js`: Validates database driver adapter, RPC handling, malformed response rejections, and health/readiness probe integration.
- `tests/integration/receipt_store_safety.test.js` & `tests/integration/receipt_reservation_lifecycle.test.js`: Validate filesystem safety, lifecycle, single-consumer claims, and binary validation.
- `tests/integration/receipt_reservation_postgres.spec.js`: Standalone portable PostgreSQL acceptance suite exercising concurrent claims, privileges, and rollback on a clean local database.

### Local verification

The PostgreSQL suite requires an explicit empty, disposable local database:

```bash
RECEIPT_TEST_DATABASE_URL=postgresql://test_user@127.0.0.1:55432/receipt_test \
  npm test -- --runInBand tests/integration/receipt_reservation_postgres.spec.js
```

The suite is skipped when the variable is absent. An explicit unreachable/non-local/populated target fails rather than reporting passing assertions. It never uses application `DATABASE_URL`. Its migration and teardown modify only the explicitly supplied disposable database; API roles are test fixtures created by the test owner if absent.

The database driver bounds RPC calls to five seconds. A timed-out RPC may still commit on the server; callers must treat that result as ambiguous. Retain binding claims and reconcile against the voucher row as described below rather than automatically reclaiming them. Concurrent cleanup may retry an already `deleting` object; deletion must remain idempotent, and a deleting record can never be rebound.

### Ambiguous writes and stuck claims

Inspect the reservation and `disbursements.receipt_s3_key` while writers are stopped. A linked object must be preserved and its reservation reconciled to consumed. If a database write outcome is uncertain, retain the claim until the writer is known to have stopped and the authoritative voucher query succeeds. Do not release by age, blindly delete metadata, or replay a voucher create after an ambiguous response. Database and object-storage effects are separate transactions; the claim and deletion-intent states protect those boundaries.
