# ATA & LTA ERP — Implementation Plan

**Version**: 1.0  
**Date**: 2026-07-17  
**Goal**: Complete the Render-based UAT deployment, then establish the production-ready operations stream (backups, monitoring, CI/CD, and multi-agent consistency).

---

## 0. Prerequisites

Before starting, ensure:

- [ ] The project directory is initialized as a Git repository.
- [ ] A GitHub repository exists for the project.
- [ ] Render account and team are created.
- [ ] Supabase UAT project is created.
- [ ] AWS UAT S3 bucket and IAM user are created.
- [ ] GitHub repository secrets for UAT are configured:
  - `UAT_DATABASE_URL`
  - `UAT_SUPABASE_URL`
  - `UAT_SUPABASE_SERVICE_KEY`
  - `UAT_AWS_ACCESS_KEY_ID`
  - `UAT_AWS_SECRET_ACCESS_KEY`
  - `UAT_S3_DOCUMENT_BUCKET`
  - `UAT_CLOUDFRONT_KEY_ID`
  - `UAT_CLOUDFRONT_PRIVATE_KEY`
  - `UAT_CLOUDFRONT_DOCUMENT_DOMAIN`
  - `UAT_FRONTEND_URL`
  - `UAT_SPA_URL`

---

## Phase 1 — Repository and Tooling Setup

**Owner**: Lead  
**Objective**: Put the codebase under version control and create the shared workflows for CI/CD.

### 1.1 Initialize Git and Connect to GitHub

> **Responsibility split**: the project lead initializes the canonical repository on this machine. Teammates who execute these specs from their own machines will fork the canonical repo and work from their personal forks, opening pull requests back to the canonical `uat`/`main` branches.

#### On this machine (canonical repository)

```bash
cd /home/javvii/FreelanceProject/Project4_Final-Render
git init
git add .
git commit -m "Initial commit: backend and erp_prototype"
git branch -M main
git remote add origin https://github.com/<org>/ata-lta-erp.git
git push -u origin main
git checkout -b uat
git push -u origin uat
```

#### On a teammate's machine (fork-based workflow)

1. Fork the canonical repository on GitHub.
2. Clone the fork locally:

```bash
git clone https://github.com/<teammate>/ata-lta-erp.git
cd ata-lta-erp
git remote add upstream https://github.com/<org>/ata-lta-erp.git
```

3. Keep the fork in sync before starting work:

```bash
git fetch upstream
git checkout uat
git reset --hard upstream/uat
```

4. Create feature branches from the fork's `uat`, push them to the fork, and open pull requests against the canonical `uat` branch.

### 1.2 Confirm Branch Topology

After step 1.1, the canonical GitHub repository must contain:

- `main` — production branch.
- `uat` — integrated UAT release candidate branch.

Teammates working from forks must branch from the latest `upstream/uat` and target pull requests back to the canonical `uat` branch. Promotion from UAT to production is performed by the lead via a pull request from `uat` → `main`.

### 1.3 Add `.gitignore` Enhancements

Ensure root `.gitignore` and `backend/.gitignore` exclude:

```gitignore
.env
node_modules/
*.log
dist/
build/
.DS_Store
```

### 1.4 Add Shared GitHub Actions Workflows

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
    branches: [uat, main]
  push:
    branches: [uat, main]

jobs:
  test-and-lint:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm test
      - run: npm run lint

  migration-dry-run:
    needs: test-and-lint
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
      - run: npm run migrate up -- --dry-run
        env:
          DATABASE_URL: ${{ github.ref == 'refs/heads/main' && secrets.PROD_DATABASE_URL || secrets.UAT_DATABASE_URL }}
```

Create `.github/workflows/deploy-uat.yml`:

```yaml
name: Deploy UAT

on:
  push:
    branches: [uat]

jobs:
  backup-before-migrate:
    runs-on: ubuntu-latest
    environment: uat
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get install -y postgresql-client
      - run: |
          pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists \
            --file backup-before-migration-$(date +%Y%m%d-%H%M%S).sql
        env:
          DATABASE_URL: ${{ secrets.UAT_DATABASE_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: uat-pre-migration-backup
          path: backup-before-migration-*.sql
          retention-days: 7

  migrate-uat:
    needs: backup-before-migrate
    runs-on: ubuntu-latest
    environment: uat
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npm run migrate:up
        env:
          DATABASE_URL: ${{ secrets.UAT_DATABASE_URL }}

  smoke-uat:
    needs: migrate-uat
    runs-on: ubuntu-latest
    environment: uat
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: erp_prototype/package-lock.json
      - run: npm ci
        working-directory: erp_prototype
      - run: node smoke-test.js
        env:
          BASE_URL: ${{ secrets.UAT_SPA_URL }}
```

Create `.github/workflows/backup-uat.yml`:

```yaml
name: Nightly UAT Backup

on:
  schedule:
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  backup-uat:
    runs-on: ubuntu-latest
    environment: uat
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get install -y postgresql-client
      - run: |
          pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists \
            --file ata-lta-erp-uat-$(date +%Y%m%d-%H%M%S).sql
        env:
          DATABASE_URL: ${{ secrets.UAT_DATABASE_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: uat-db-backup
          path: ata-lta-erp-uat-*.sql
          retention-days: 7
```

---

## Phase 2 — Backend Production Readiness

**Owner**: Lead / Agent A / Agent B  
**Objective**: Make the backend healthy, observable, and Render-compatible without changing business logic.

### 2.1 Add Structured Logger

Create `backend/src/lib/logger.js`:

```js
/**
 * Minimal structured JSON logger.
 */
const logger = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', msg, ...meta })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ...meta })),
};

module.exports = logger;
```

### 2.2 Replace Morgan with Request Logger

In `backend/src/app.js`:

```js
const logger = require('./lib/logger');

// Remove: app.use(morgan(...))
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - start,
      requestId: req.id,
    });
  });
  next();
});
```

Remove `morgan` from `package.json` or keep it only as a dev dependency.

### 2.3 Update Error Handler

In `backend/src/middleware/errorHandler.js`, log structured errors:

```js
logger.error('unhandled error', {
  status,
  title,
  detail,
  stack: env.isDevelopment ? err.stack : undefined,
  requestId: req.id,
});
```

### 2.4 Extend `/health` Endpoint

Update `backend/src/app.js`:

```js
const { supabaseAdmin } = require('./services/supabaseClient');
const { s3Client } = require('./config/aws');
const { HeadBucketCommand } = require('@aws-sdk/client-s3');

app.get('/health', async (req, res) => {
  const checks = { supabase: false, s3: false };
  try {
    await supabaseAdmin.from('entities').select('id').limit(1);
    checks.supabase = true;
  } catch (e) {
    logger.warn('health check failed: supabase', { error: e.message, requestId: req.id });
  }
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: env.s3.documentBucket }));
    checks.s3 = true;
  } catch (e) {
    logger.warn('health check failed: s3', { error: e.message, requestId: req.id });
  }
  const ok = checks.supabase && checks.s3;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});
```

### 2.5 Add Startup Log

In `src/app.js`, replace the startup console.log with:

```js
logger.info('server started', { port: env.port, env: env.nodeEnv });
```

### 2.6 Verify Dockerfile

The existing `Dockerfile` is already correct. No changes needed unless new build-time dependencies are introduced.

---

## Phase 3 — Frontend Build for Render Static Site

**Owner**: Lead / Agent A  
**Objective**: Make the vanilla SPA deployable on Render Static Site with the correct backend URL injected at build time.

### 3.1 Add Build Script

Create `erp_prototype/build.js`:

```js
const fs = require('fs');
const path = require('path');

const apiUrl = process.env.ERP_API_BASE_URL;
if (!apiUrl) {
  console.error('ERP_API_BASE_URL is required');
  process.exit(1);
}

const normalizedUrl = apiUrl.endsWith('/v1') ? apiUrl : `${apiUrl.replace(/\/$/, '')}/v1`;
const output = `window.__ERP_API_BASE_URL__ = ${JSON.stringify(normalizedUrl)};\n`;

fs.writeFileSync(path.join(__dirname, 'env.js'), output);
console.log('Generated env.js with API base URL:', normalizedUrl);
```

### 3.2 Update `index.html`

Add `env.js` before `apiClient.js`:

```html
<script src="js/utils.js"></script>
<script src="env.js"></script>
<script src="js/apiClient.js"></script>
```

### 3.3 Add `erp_prototype/package.json` Scripts

Update to include:

```json
{
  "scripts": {
    "build": "node build.js",
    "smoke": "node smoke-test.js"
  }
}
```

### 3.4 Adapt Smoke Tests

Modify `erp_prototype/smoke-test.js` to read `BASE` from `process.env.BASE_URL`:

```js
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8899';
```

---

## Phase 4 — Render Blueprint and Deployment

**Owner**: Lead  
**Objective**: Declare the Render services in code and connect auto-deploy to Git branches.

### 4.1 Create `render.yaml`

Place in the repository root:

```yaml
services:
  - type: web
    name: ata-lta-erp-api-uat
    runtime: docker
    repo: https://github.com/<org>/ata-lta-erp
    branch: uat
    rootDir: backend
    dockerfilePath: Dockerfile
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: LOG_LEVEL
        value: info
      - key: SUPABASE_URL
        fromGroup: erp-uat-secrets
      - key: SUPABASE_SERVICE_KEY
        fromGroup: erp-uat-secrets
      - key: DATABASE_URL
        fromGroup: erp-uat-secrets
      - key: AWS_REGION
        fromGroup: erp-uat-secrets
      - key: AWS_ACCESS_KEY_ID
        fromGroup: erp-uat-secrets
      - key: AWS_SECRET_ACCESS_KEY
        fromGroup: erp-uat-secrets
      - key: S3_DOCUMENT_BUCKET
        fromGroup: erp-uat-secrets
      - key: CLOUDFRONT_KEY_ID
        fromGroup: erp-uat-secrets
      - key: CLOUDFRONT_PRIVATE_KEY
        fromGroup: erp-uat-secrets
      - key: CLOUDFRONT_DOCUMENT_DOMAIN
        fromGroup: erp-uat-secrets
      - key: FRONTEND_URL
        fromService:
          name: ata-lta-erp-spa-uat
          type: static_site
          property: url

  - type: static_site
    name: ata-lta-erp-spa-uat
    repo: https://github.com/<org>/ata-lta-erp
    branch: uat
    rootDir: erp_prototype
    buildCommand: npm run build
    publishDir: .
    envVars:
      - key: ERP_API_BASE_URL
        fromService:
          name: ata-lta-erp-api-uat
          type: web
          property: url

  - type: web
    name: ata-lta-erp-api-prod
    runtime: docker
    repo: https://github.com/<org>/ata-lta-erp
    branch: main
    rootDir: backend
    dockerfilePath: Dockerfile
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: LOG_LEVEL
        value: info
      - key: SUPABASE_URL
        fromGroup: erp-prod-secrets
      - key: SUPABASE_SERVICE_KEY
        fromGroup: erp-prod-secrets
      - key: DATABASE_URL
        fromGroup: erp-prod-secrets
      - key: AWS_REGION
        fromGroup: erp-prod-secrets
      - key: AWS_ACCESS_KEY_ID
        fromGroup: erp-prod-secrets
      - key: AWS_SECRET_ACCESS_KEY
        fromGroup: erp-prod-secrets
      - key: S3_DOCUMENT_BUCKET
        fromGroup: erp-prod-secrets
      - key: CLOUDFRONT_KEY_ID
        fromGroup: erp-prod-secrets
      - key: CLOUDFRONT_PRIVATE_KEY
        fromGroup: erp-prod-secrets
      - key: CLOUDFRONT_DOCUMENT_DOMAIN
        fromGroup: erp-prod-secrets
      - key: FRONTEND_URL
        fromService:
          name: ata-lta-erp-spa-prod
          type: static_site
          property: url

  - type: static_site
    name: ata-lta-erp-spa-prod
    repo: https://github.com/<org>/ata-lta-erp
    branch: main
    rootDir: erp_prototype
    buildCommand: npm run build
    publishDir: .
    envVars:
      - key: ERP_API_BASE_URL
        fromService:
          name: ata-lta-erp-api-prod
          type: web
          property: url
```

### 4.2 Create Render Environment Groups

In the Render dashboard:

1. Create `erp-uat-secrets` and `erp-prod-secrets`.
2. Populate keys from section 5.1 of `docs/DEPLOYMENT_SPECS.md`.
3. For CloudFront private key, paste the single-line `\n`-escaped version.

### 4.3 Deploy UAT

1. Push `render.yaml` to `uat`.
2. In Render dashboard, create a new Blueprint from the repo.
3. Verify both services deploy.
4. Check `/health` on the backend URL.
5. Open the Static Site URL and confirm the SPA loads and calls the backend.

---

## Phase 5 — Backups and Retention

**Owner**: Lead / DevOps  
**Objective**: Protect UAT data and document assets with automated backups.

### 5.1 UAT Database Backups

The nightly workflow from Phase 1 already covers this. Verify artifacts are created after the first run.

### 5.2 Production Database Backups

Create `.github/workflows/backup-prod.yml`:

```yaml
name: Nightly Production Backup

on:
  schedule:
    - cron: '0 3 * * *'
  workflow_dispatch:

jobs:
  backup-prod:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get install -y postgresql-client
      - run: |
          pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists \
            --file ata-lta-erp-prod-$(date +%Y%m%d-%H%M%S).sql
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: prod-db-backup
          path: ata-lta-erp-prod-*.sql
          retention-days: 30
```

### 5.3 Document Versioning

For the production S3 bucket:

1. Enable versioning in the S3 console or via AWS CLI.
2. Add a lifecycle rule to expire noncurrent versions after 30 days.
3. For disaster recovery, configure cross-region replication to a separate bucket in a different region.

For the UAT bucket, keep versioning disabled and add a lifecycle rule to delete objects after 30 days.

---

## Phase 6 — Monitoring and Alerting

**Owner**: Lead  
**Objective**: Gain visibility into UAT health and errors.

### 6.1 Configure Render Health Checks

Ensure each Web Service has:

- Health check path: `/health`
- Initial delay: 10 seconds
- Timeout: 5 seconds
- Interval: 30 seconds

### 6.2 External Uptime Monitor

Set up a free monitor (e.g., UptimeRobot):

- URL: `https://<backend-service>.onrender.com/health`
- Interval: 5 minutes
- Alert email/Slack webhook

### 6.3 Production Error Tracking

When moving to production:

1. Sign up for Sentry or Logtail.
2. Add `@sentry/node` to `backend/package.json`.
3. Initialize Sentry at the top of `src/app.js`.
4. Send errors from `errorHandler.js` to Sentry.
5. Store Sentry DSN in Render env group.

---

## Phase 7 — Production Deployment

**Owner**: Lead + Product Owner  
**Objective**: Promote the validated UAT release to production.

### 7.1 Production Prerequisites

- [ ] Render paid plan provisioned for production services.
- [ ] Supabase production project created.
- [ ] AWS production S3 bucket + CloudFront distribution ready.
- [ ] GitHub repository secrets for production configured.
- [ ] DNS records for custom domain configured (optional).

### 7.2 Production Workflow

Create `.github/workflows/deploy-prod.yml`:

```yaml
name: Deploy Production

on:
  push:
    branches: [main]

jobs:
  backup-before-migrate:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get install -y postgresql-client
      - run: |
          pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists \
            --file backup-before-migration-$(date +%Y%m%d-%H%M%S).sql
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: prod-pre-migration-backup
          path: backup-before-migration-*.sql
          retention-days: 30

  migrate-prod:
    needs: backup-before-migrate
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: backend/package-lock.json
      - run: npm ci
        working-directory: backend
      - run: npm run migrate:up
        env:
          DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}

  smoke-prod:
    needs: migrate-prod
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: erp_prototype/package-lock.json
      - run: npm ci
        working-directory: erp_prototype
      - run: node smoke-test.js
        env:
          BASE_URL: ${{ secrets.PROD_SPA_URL }}
```

### 7.3 Promotion Checklist

Before merging `uat` into `main`:

- [ ] UAT smoke tests pass.
- [ ] UAT migration dry-run and actual migration succeed.
- [ ] Product owner signs off on UAT.
- [ ] Production migration dry-run passes.
- [ ] Rollback plan reviewed.
- [ ] Secrets and env groups verified.

---

## Phase 8 — Documentation and Team Onboarding

**Owner**: Lead  
**Objective**: Ensure every agent understands and follows the new deployment and collaboration rules.

### 8.1 Distribute System Prompt

All agents must read and follow `docs/AGENT_SYSTEM_PROMPT.md`.

### 8.2 Maintain Living Specs

- Update `docs/DEPLOYMENT_SPECS.md` when infrastructure changes.
- Update `docs/IMPLEMENTATION_PLAN.md` when task sequencing changes.
- Update module READMEs and API contracts for endpoint changes.

### 8.3 Runbook

Create `docs/runbooks/` with:

- `ROLLBACK.md`: how to revert application, database, and documents.
- `SECRET_ROTATION.md`: how to rotate Supabase and AWS keys.
- `MIGRATION_FAILURE.md`: how to diagnose and recover from failed migrations.
- `INCIDENT_RESPONSE.md`: on-call checklist and escalation path.

---

## 9. Timeline (Estimated)

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| 1. Repository + CI/CD | 1 day | GitHub repo, Render account |
| 2. Backend readiness | 1–2 days | Phase 1 |
| 3. Frontend build | 0.5 day | Phase 1 |
| 4. Render deployment | 1 day | Phases 2–3, UAT Supabase/S3 |
| 5. Backups | 0.5 day | Phase 4 |
| 6. Monitoring | 0.5 day | Phase 4 |
| 7. Production deploy | 1 day | UAT sign-off, prod infra |
| 8. Documentation | ongoing | All phases |

**Total UAT-ready effort**: 4–5 days.  
**Total production-ready effort**: 6–7 days.

---

## 10. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Free tier cold starts | UAT feels slow | Uptime monitor keeps service warm; upgrade for production |
| Migration conflict between agents | Broken deploys | Shared-change-request issues; dry-run in CI |
| Secrets leaked in logs | Security breach | Never log secrets; scan with `detect-secret` |
| UAT data corrupts production | Data loss | Separate Supabase project; no direct data copy |
| Render service outage | UAT unavailable | Document rollback to local Docker Compose for demos |
| CloudFront key misformat | Downloads fail | `env.js` replaces `\n`; validate in health check |

---

## 11. Success Criteria

The implementation plan is complete when:

1. `uat` branch auto-deploys to Render on push.
2. `/health` returns `ok` with `supabase: true` and `s3: true`.
3. SPA loads from Render Static Site and calls the backend successfully.
4. GitHub Actions CI passes on every PR.
5. Nightly UAT database backup runs and produces an artifact.
6. Smoke tests pass against the deployed UAT URL.
7. `main` branch can be promoted and deployed to production with one merge.
8. All agents follow `docs/AGENT_SYSTEM_PROMPT.md`.

---

## 12. Next Immediate Actions

1. Initialize Git and push to GitHub.
2. Create the `uat` branch.
3. Add the three GitHub Actions workflows from Phase 1.
4. Implement the structured logger and health check (Phase 2).
5. Add `erp_prototype/build.js` and update `index.html` (Phase 3).
6. Write `render.yaml` and create Render environment groups (Phase 4).
7. Deploy UAT and run the first smoke test.
