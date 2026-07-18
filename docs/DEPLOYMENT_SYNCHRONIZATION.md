# Deployment Synchronization Guide

This document walks you through moving tested changes from your local
development environment into the UAT deployment on Render, and eventually into
production.

## The environments

| Environment | Where it runs | Data / auth source | Purpose |
|-------------|---------------|--------------------|---------|
| **local**   | Your machine (`http://localhost:3000` + `http://localhost:8080`) | Shared remote Supabase (often the UAT project) | Fast iteration without deploying |
| **uat**     | Render (`uat` branch) | UAT Supabase project | Client preview / pre-production validation |
| **prod**    | Render (`main` branch) | Production Supabase project | Live system |

Because the local backend can use the same remote Supabase as UAT, you can test
real data and auth behavior locally without deploying. The only thing that
changes when you deploy is the server that runs the API/SPA code.

## Pre-sync checklist

Before opening a PR or pushing to `uat`, make sure:

1. The full local stack is running cleanly:
   ```bash
   npm run dev
   ```
2. The non-Playwright smoke test passes:
   ```bash
   npm run smoke
   ```
3. Backend tests pass:
   ```bash
   cd backend && npm test
   ```
4. Lint passes in both workspaces:
   ```bash
   cd backend && npm run lint
   ```
5. Any new migrations have been applied locally and verified:
   ```bash
   cd backend && npm run migrate:up
   ```
6. No runtime env files are staged (they are gitignored, but double-check):
   ```bash
   git status
   ```

## Branch strategy

We use a simple trunk-based flow:

```
main  ────────────────────────────────►  production
       ▲
       │ merge when UAT is approved
uat    ├───────────────────────────────►  client preview
       ▲
       │ feature / fix branches merge here first
feature/foo
```

- `main` is the production branch.
- `uat` is the client preview / pre-production branch.
- Create short-lived feature or bugfix branches from `uat`, then merge them back
  into `uat` via pull request.

## Sync workflow: local → UAT

### 1. Finish your local work

```bash
# Make sure you are on uat and it is up to date
git checkout uat
git pull origin uat

# Create a feature branch
git checkout -b feature/your-change-name
```

### 2. Commit only source/config changes

```bash
git add -A
git status
```

Confirm that no `.env`, `env.js`, `node_modules/`, or coverage directories are
staged. Allowed staged files are typically:

- Source code under `backend/src/` and `erp_prototype/js/`, `css/`, `index.html`
- Migration files under `backend/migrations/` and seed files under `backend/seeds/`
- Documentation under `docs/`
- `package.json` and lockfiles when dependencies changed
- `render.yaml`, `Dockerfile`, `docker-compose*.yml`, and orchestration scripts

Then commit:

```bash
git commit -m "feat: describe the change"
```

### 3. Push to the remote and open a PR to `uat`

```bash
git push origin feature/your-change-name
```

Open a pull request **targeting the `uat` branch**. The PR body should include:

- What changed and why
- Which modules or screens are affected
- How you tested it locally
- Any migrations that need to run
- Whether the change depends on a new env var or Supabase bucket setup

Render does **not** automatically deploy PR preview branches on the free tier,
so the PR itself is for review only. Deployment happens after merge.

### 4. Merge to `uat`

After review and passing CI (tests/lint), merge the PR into `uat`.

### 5. Deploy to UAT

Because `render.yaml` is configured to deploy from the `uat` branch, Render will
automatically start the deployment once the merge lands on `uat`.

Monitor the deployment in the Render dashboard:

1. Open the Render project.
2. Watch `ata-lta-erp-api-uat` and `ata-lta-erp-spa-uat`.
3. Wait for both services to report **Healthy**.

You can also verify from your terminal:

```bash
npm run smoke:uat
```

This runs the lightweight smoke test against the Render UAT backend.

### 6. Run migrations on UAT (when needed)

If your branch added or changed migrations under `backend/migrations/`, you must
run them against the UAT database after deployment.

There are two common ways on Render free tier:

**Option A — Render Shell in the dashboard**

1. Open the `ata-lta-erp-api-uat` service in Render.
2. Click **Shell**.
3. Run:
   ```bash
   npm run migrate:up
   ```

**Option B — Run locally against the UAT database**

From your machine, with the UAT `DATABASE_URL` exported:

```bash
cd backend
export DATABASE_URL="postgresql://..."
npm run migrate:up
```

Make sure you are using the same migration files that were merged into `uat`.

## Sync workflow: UAT → production

Once the client has approved the UAT deployment:

### 1. Open a PR from `uat` to `main`

```bash
git checkout uat
git pull origin uat
git push origin uat   # ensure remote uat is current
```

Then open a pull request in GitHub: **base `main`, compare `uat`**.

### 2. Merge `uat` into `main`

After final review, merge. Render will deploy the production services from the
`main` branch (update `render.yaml` or your Render dashboard if production
services use different names).

### 3. Run migrations on production

Use the same migration commands as for UAT, targeting the production database.

## Environment-specific values

Values that differ between local, UAT, and production are never committed. They
are supplied by:

| Value | Local | UAT | Production |
|-------|-------|-----|------------|
| `SUPABASE_URL` | `backend/.env.development` | Render env group `erp-uat-secrets` | Render env group `erp-prod-secrets` |
| `SUPABASE_SERVICE_KEY` | `backend/.env.development` | Render env group | Render env group |
| `SUPABASE_STORAGE_BUCKET` | `backend/.env.development` | Render env group | Render env group |
| `DATABASE_URL` | `backend/.env.development` | Render env group | Render env group |
| `FRONTEND_URL` | `backend/.env.development` | Render `fromService` | Render `fromService` |
| `ERP_API_BASE_URL` | `erp_prototype/.env` or command line | Render `fromService` | Render `fromService` |

The root `.gitignore` prevents these files from being committed:

- `backend/.env.development`
- `backend/.env.uat`
- `backend/.env.production`
- `erp_prototype/.env`
- `erp_prototype/env.js`

## Render Blueprint behavior

`render.yaml` at the repository root defines the UAT services:

- `ata-lta-erp-api-uat` — Docker web service built from `backend/Dockerfile`
- `ata-lta-erp-spa-uat` — Static site built from `erp_prototype/`

The static site build runs:

```bash
npm run build
```

which executes `build.js` and writes `erp_prototype/env.js` pointing at the
UAT backend hostname.

For production, create a second environment group (e.g., `erp-prod-secrets`) and
link it in a production-specific Render Blueprint or manually in the Render
dashboard. Keep `render.yaml` as the UAT definition so free-tier limits are not
exceeded.

## What to do when deployments drift

If `uat` and `main` have diverged:

```bash
# Bring uat up to date with main first, then re-test locally
git checkout uat
git pull origin main
git push origin uat
npm run dev
npm run smoke
```

Resolve any conflicts, run tests again, then merge feature branches into the
fresh `uat`.

## Rollback on Render

If a UAT deploy breaks:

1. In the Render dashboard, open the affected service.
2. Go to the **Deploys** tab.
3. Select the previous successful deploy and click **Manual Deploy → Deploy
   latest commit** or use the commit hash to redeploy.

For the database, Render does not automatically roll back migrations. If a
migration was destructive, restore from a Supabase backup or write a
compensating migration.

## Summary commands

```bash
# Local development and smoke test
npm run dev
npm run smoke

# Backend tests
npm run dev:backend   # in another terminal, then:
cd backend && npm test && npm run lint

# Push feature branch and open PR to uat
git checkout -b feature/foo
git add -A
git commit -m "feat: foo"
git push origin feature/foo
# Open PR target = uat

# After merge, verify UAT
git checkout uat
git pull origin uat
npm run smoke:uat
```
