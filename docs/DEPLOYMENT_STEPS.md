# ATA & LTA ERP — Deployment Steps

**Date**: 2026-07-17  
**Goal**: Deploy the UAT environment on Render + Supabase using **only free-tier services**.

This guide deploys UAT first. Production deployment requires a Render paid plan and is documented as a separate upgrade step at the end.

This guide assumes:
- The codebase is already in GitHub (`main` and `uat` branches exist).
- You have admin access to Render, Supabase, and GitHub.
- You have read `docs/ENVIRONMENT_CONFIGURATION.md` and gathered UAT secrets.

---

## Phase 0 — Pre-Flight Checklist

Before touching any dashboard, confirm the code is ready:

- [ ] `backend` tests pass locally: `cd backend && npm test`
- [ ] `backend` lint passes: `cd backend && npm run lint`
- [ ] SPA build script works: `cd erp_prototype && ERP_API_BASE_URL=https://example.com/v1 npm run build`
- [ ] `render.yaml` is present in the repo root.
- [ ] `.github/workflows/` contains `ci.yml`, `deploy-uat.yml`, `deploy-prod.yml`, `backup-uat.yml`, `backup-prod.yml`.
- [ ] `docs/ENVIRONMENT_CONFIGURATION.md` has UAT values filled in.
- [ ] You understand that production requires a paid Render plan (documented separately).

---

## Phase 1 — Supabase Setup

### 1.1 Create UAT Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New Project**.
3. Choose organization and region (recommend same region as Render, e.g., `ap-southeast-1`).
4. Set project name: `ata-lta-erp-uat`.
5. Choose a strong database password. **Save it immediately** in a password manager.
6. Wait for provisioning.

### 1.2 Collect UAT Supabase Credentials

1. Go to **Project Settings → API**.
2. Copy:
   - `URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_KEY`
   - `anon` key → (optional, for SPA direct auth if needed)
3. Go to **Database → Connection Pooling**.
4. Copy the **URI** with `?pgbouncer=true` → `DATABASE_URL`.

### 1.3 Create UAT Storage Bucket

1. Go to **Storage → New bucket**.
2. Name: `ata-lta-erp-documents-uat`.
3. Toggle **Public bucket** to **OFF**.
4. Click **Save**.
5. Click the bucket → **Policies**.
6. Add the following policies (replace `uat` with `prod` for production):

```sql
-- Allow service role full access
CREATE POLICY "Service role full access"
ON storage.objects
FOR ALL
TO service_role
USING (bucket_id = 'ata-lta-erp-documents-uat')
WITH CHECK (bucket_id = 'ata-lta-erp-documents-uat');

-- Allow authenticated users to upload to entity-scoped paths
CREATE POLICY "Authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ata-lta-erp-documents-uat'
  AND (storage.foldername(name))[1] = 'entities'
);

-- Allow authenticated users to read via signed URLs
CREATE POLICY "Authenticated reads"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'ata-lta-erp-documents-uat');
```

### 1.4 Configure Supabase Auth

1. Go to **Authentication → URL Configuration**.
2. Set **Site URL** to the expected UAT SPA URL, e.g.:
   ```
   https://ata-lta-erp-spa-uat.onrender.com
   ```
3. Add the same URL to **Redirect URLs**.
4. (Optional for UAT) Disable email confirmations to simplify test user creation:
   - **Authentication → Providers → Email** → Toggle **Confirm email** OFF.

### 1.5 Repeat for Production

Create a second Supabase project named `ata-lta-erp-prod` and repeat steps 1.2–1.4 with production values.

---

## Phase 2 — GitHub Setup

### 2.1 Add Repository Secrets (UAT Only)

1. Go to `https://github.com/jevvii/ata-lta-erp-final-render/settings/secrets/actions`.
2. Add UAT secrets from `docs/ENVIRONMENT_CONFIGURATION.md`:
   - `UAT_DATABASE_URL`
   - `UAT_SUPABASE_URL`
   - `UAT_SUPABASE_SERVICE_KEY`
   - `UAT_SUPABASE_STORAGE_BUCKET`
   - `UAT_FRONTEND_URL`
   - `UAT_SPA_URL`

Production secrets are added later when upgrading to a paid Render plan.

### 2.2 Configure GitHub Environments

1. Go to **Settings → Environments**.
2. Create `uat`:
   - Required reviewers: optional
   - Wait timer: 0

The `production` environment is created later when upgrading to a paid Render plan.

### 2.3 Push the `uat` Branch

Render reads `render.yaml` from the `uat` branch. It must exist on GitHub before creating the Blueprint.

```bash
git checkout uat
git push -u origin uat
```

### 2.4 Verify CI Works

1. Push any trivial change to the `uat` branch (or create a test PR).
2. Confirm `ci.yml` runs:
   - `test-and-lint` job passes.
   - `migration-dry-run` job passes.

---

## Phase 3 — Render Setup

### 3.1 Create Render Account / Team

1. Go to [render.com](https://render.com) and sign up/log in.
2. Create a team if needed for shared access.

### 3.2 Create Environment Group

> **Note**: The current `render.yaml` creates the environment group `erp-uat-secrets` inside the Blueprint's `uat` environment. You do **not** need to create it manually in the Render dashboard beforehand. If you already created one manually, delete it first to avoid the "different environment" error.

The `erp-prod-secrets` group is created later when upgrading to a paid Render plan.

### 3.3 Create Blueprint from `render.yaml`

> **Free tier only**: The current `render.yaml` deploys UAT services only. Production services require a paid plan and are not created now.

1. In Render dashboard, click **New → Blueprint**.
2. Connect the GitHub repository `jevvii/ata-lta-erp-final-render`.
3. Render will detect `render.yaml`.
4. On first deploy, it creates inside the existing **My project**:
   - A `uat` environment.
   - `ata-lta-erp-api-uat` (Web Service, Free plan).
   - `ata-lta-erp-spa-uat` (Static Site; static sites are free by default and do **not** declare `plan: free`).
   - The `erp-uat-secrets` environment group with placeholder values.
5. After creation, update `erp-uat-secrets` in the Render dashboard with real Supabase values.
6. Redeploy the `ata-lta-erp-api-uat` service to pick up the updated secrets.
7. Wait for both services to deploy.

If Render still shows a payment wall, verify:
- Only the backend service declares `plan: free`.
- The Static Site does **not** declare `plan`.
- You are creating the Blueprint from a personal Render account (not a team that requires billing).
- No other paid features (e.g., disks, custom domains, paid databases) are requested.

### 3.4 Verify UAT Backend Deploy

1. Open the `ata-lta-erp-api-uat` service logs.
2. Wait for the build to finish and the service to start.
3. Open a browser or terminal:
   ```bash
   curl https://ata-lta-erp-api-uat.onrender.com/health
   ```
4. Expected response:
   ```json
   {"status":"ok","timestamp":"...","checks":{"supabase":true,"storage":true}}
   ```

If `storage` is `false`, check:
- `SUPABASE_STORAGE_BUCKET` value matches an existing bucket.
- Service role key has storage permissions.
- Bucket RLS policies allow service role access.

### 3.5 Verify UAT Static Site

1. Open the Static Site URL.
2. Check that `env.js` is generated:
   ```bash
   curl https://ata-lta-erp-spa-uat.onrender.com/env.js
   ```
3. Expected:
   ```js
   window.__ERP_API_BASE_URL__ = "https://ata-lta-erp-api-uat.onrender.com/v1";
   ```
4. Open browser dev tools and confirm `window.__ERP_API_BASE_URL__` is set.

---

## Phase 4 — Run UAT Migrations

### 4.1 Trigger Deploy Workflow

Push the current `uat` branch to GitHub (or re-run the latest workflow):

```bash
git push origin uat
```

This triggers `.github/workflows/deploy-uat.yml`:
1. Backs up the UAT database.
2. Runs `npm run migrate:up` against UAT.
3. Runs smoke tests against `UAT_SPA_URL`.

### 4.2 Monitor the Workflow

1. Go to **GitHub → Actions → Deploy UAT**.
2. Watch each job:
   - `backup-before-migrate` must produce an artifact.
   - `migrate-uat` must succeed.
   - `smoke-uat` must succeed.

### 4.3 Seed Test Data

If the smoke tests fail because no users exist, seed the database:

```bash
cd backend
DATABASE_URL=$UAT_DATABASE_URL npx node-pg-migrate up  # if not already done
psql $UAT_DATABASE_URL -f seeds/agent-b-seed.sql      # or create minimal seed
```

Use the test users from `erp_prototype/smoke-test.js`:
- `admin@ata-lta.ph` / `password123`
- `accounting-ata@ata-lta.ph` / `password123`
- `docs@ata-lta.ph` / `password123`

You must create these users in Supabase Auth first, then add matching rows to the `users` table with appropriate roles and permissions.

---

## Phase 5 — UAT Validation

### 5.1 Manual Smoke Test

1. Open `https://ata-lta-erp-spa-uat.onrender.com`.
2. Log in with a test user.
3. Confirm the dashboard loads.
4. Navigate to Clients, Operations, Billing, Documents.
5. Test document upload:
   - Create a document.
   - Upload a file using the signed URL.
   - Confirm upload.
   - Download the file.
6. Test invoice PDF generation.

### 5.2 Browser Console Checks

- No CORS errors.
- No 401/403 errors for expected operations.
- `env.js` loads before `apiClient.js`.

### 5.3 Log Review

1. Go to Render dashboard → `ata-lta-erp-api-uat` → Logs.
2. Confirm structured JSON logs are visible.
3. Look for any `level: "error"` entries.

---

## Phase 6 — Monitoring and Backups

### 6.1 Set Up Uptime Monitoring

Use a free service such as UptimeRobot:

1. Add a monitor:
   - Type: HTTP(s)
   - URL: `https://ata-lta-erp-api-uat.onrender.com/health`
   - Interval: 5 minutes
2. Add alert email/Slack webhook.
3. (Optional) Add a second monitor for the Static Site URL.

### 6.2 Verify Nightly Backups

1. Wait for 02:00 UTC or manually trigger `.github/workflows/backup-uat.yml`.
2. Confirm artifact `uat-db-backup` is created.
3. Download and spot-check the SQL dump.

---

## Phase 7 — Production Promotion (Paid Plan Required)

Production promotion is **out of scope for the free-tier test run**. Documented here for when the team upgrades to a paid Render plan.

### 7.1 Pre-Production Checklist

- [ ] UAT smoke tests pass.
- [ ] UAT migrations applied successfully.
- [ ] Product owner approves UAT.
- [ ] Paid Render plan is active.
- [ ] Production Supabase project is ready.
- [ ] Production Render env group `erp-prod-secrets` is populated.
- [ ] Production GitHub secrets are set.
- [ ] `production` GitHub environment has required reviewers.

### 7.2 Open Promotion PR

1. Create a PR from `uat` → `main`.
2. Title: `Promote UAT to production`.
3. Include a summary of changes and UAT test results.
4. Request review from the lead.

### 7.3 Merge and Deploy

1. After approval, merge the PR.
2. This triggers:
   - Render auto-deploy of production services.
   - `.github/workflows/deploy-prod.yml`:
     - Backup production database.
     - Run migrations.
     - Run smoke tests.
3. Monitor GitHub Actions and Render logs.

### 7.4 Verify Production

```bash
curl https://ata-lta-erp-api-prod.onrender.com/health
curl https://ata-lta-erp-spa-prod.onrender.com/env.js
```

Run the same manual smoke tests as UAT.

---

## Phase 8 — Post-Deployment Tasks

### 8.1 Team Onboarding

1. Share `docs/AGENT_SYSTEM_PROMPT.md` with all agents.
2. Confirm everyone uses the fork-based workflow (`feature/*` → `uat` → `main`).
3. Enforce `shared-change-request` issues for cross-cutting changes.

### 8.2 Documentation Maintenance

Update these docs whenever infrastructure changes:
- `docs/DEPLOYMENT_SPECS.md`
- `docs/ENVIRONMENT_CONFIGURATION.md`
- `docs/DEPLOYMENT_STEPS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- Module READMEs and API contracts

### 8.3 Optional Production Hardening

- [ ] Add Sentry or Logtail for error tracking.
- [ ] Set up log-based alerting.
- [ ] Configure custom domain + SSL.
- [ ] Upgrade Render services from Free to Standard/Pro to avoid cold starts.
- [ ] Enable Supabase PITR on production.
- [ ] Schedule regular disaster-recovery drills.

---

## Troubleshooting

### `/health` returns `storage: false`

| Cause | Fix |
|-------|-----|
| Bucket does not exist | Create `SUPABASE_STORAGE_BUCKET` in Supabase Storage. |
| Wrong bucket name | Verify env var matches bucket ID exactly. |
| Service role lacks storage access | Use the `service_role` key; verify RLS policies. |
| Network timeout | Check Supabase status page. |

### Smoke tests fail on login

| Cause | Fix |
|-------|-----|
| Test users missing | Create users in Supabase Auth + `users` table. |
| CORS blocked | Verify `FRONTEND_URL` matches the Static Site URL. |
| Wrong API URL | Check `env.js` content. |

### Migrations fail

1. Check GitHub Actions logs for the specific error.
2. Follow `docs/runbooks/MIGRATION_FAILURE.md`.
3. Restore from pre-migration backup if needed.

---

## Summary of URLs After Deployment

| Service | UAT URL | Prod URL |
|---------|---------|----------|
| API Health | `https://ata-lta-erp-api-uat.onrender.com/health` | `https://ata-lta-erp-api-prod.onrender.com/health` |
| SPA | `https://ata-lta-erp-spa-uat.onrender.com` | `https://ata-lta-erp-spa-prod.onrender.com` |
| GitHub Actions | `.github/workflows/deploy-uat.yml` | `.github/workflows/deploy-prod.yml` |
| Supabase | `ata-lta-erp-uat` project | `ata-lta-erp-prod` project |
