# Migration Failure Runbook

**Last updated**: 2026-07-17

## Diagnosis

### 1. Check the CI/CD logs

- Go to GitHub Actions → find the failed workflow run.
- Read the migration step output for the specific error.

### 2. Common Failure Causes

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `relation already exists` | Migration ran partially before | Run `migrate:down` first, fix idempotency, re-run |
| `permission denied` | Wrong `DATABASE_URL` or missing privileges | Verify secrets in Render env group |
| `connection refused` | Database not reachable | Check Supabase status; verify connection string |
| `syntax error` | Bug in migration SQL | Fix the SQL and push a corrected migration |
| `timeout` | Long-running migration on large table | Add `SET statement_timeout = '0';` at top of migration |

### 3. Check Migration State

```bash
cd backend
npm run migrate -- status
```

## Recovery

### Option A: Fix Forward

1. Write a new migration that corrects the issue.
2. Test with `npm run migrate up -- --dry-run`.
3. Push and let CI/CD apply it.

### Option B: Rollback

1. Run `npm run migrate:down` to undo the last migration.
2. Restore from the pre-migration backup if needed (see ROLLBACK.md).

### Option C: Restore from Backup

1. Download the `*-pre-migration-backup` artifact from GitHub Actions.
2. Restore:

```bash
psql "$DATABASE_URL" < backup-before-migration-YYYYMMDD-HHMMSS.sql
```

## Prevention

- Always run `npm run migrate up -- --dry-run` locally before opening a PR.
- Never edit a migration after it has been merged into `uat` or `main`.
- Use transactions in migrations when possible.
