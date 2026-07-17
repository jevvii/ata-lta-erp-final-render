# Rollback Runbook

**Last updated**: 2026-07-17

## Application Rollback

### Render Web Service

1. Go to the Render dashboard → select the affected service.
2. Click **Manual Deploy** → select the last known good commit.
3. Verify `/health` returns `{"status": "ok"}`.

### Alternative: Git Revert

```bash
git revert HEAD
git push origin uat  # or main for production
```

Render will auto-deploy the reverted commit.

## Database Rollback

### Using Migration Rollback

```bash
cd backend
npm run migrate:down
```

### Using Backup Restore

1. Download the latest backup artifact from GitHub Actions.
2. Restore:

```bash
psql "$DATABASE_URL" < backup-before-migration-YYYYMMDD-HHMMSS.sql
```

### Using Supabase Point-in-Time Recovery

1. Go to Supabase dashboard → Database → Backups.
2. Select a point-in-time before the failed migration.
3. Restore to a new project, then swap connection strings.

## Document (S3) Rollback

1. If S3 versioning is enabled, restore the previous version of the affected object.
2. For bulk restore, use AWS CLI:

```bash
aws s3api list-object-versions --bucket $S3_DOCUMENT_BUCKET --prefix <path>
```

3. Delete the current version to restore the previous one.

## Verification

After any rollback:

- [ ] `/health` returns `ok` with `supabase: true` and `s3: true`.
- [ ] SPA loads and authenticates successfully.
- [ ] Smoke tests pass.
