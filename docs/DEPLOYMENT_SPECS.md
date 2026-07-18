# ATA & LTA ERP — Deployment & Operations Specifications

**Date**: 2026-07-17  
**Scope**: Backend (`backend/`), Frontend prototype (`erp_prototype/`), Supabase, AWS S3/CloudFront, Render hosting.  
**Status**: UAT-ready architecture; production path defined.

---

## 1. Executive Summary

This document records the deployment direction for the ATA & LTA Accounting Firm ERP:

- **Compute moves from AWS ECS Fargate + ALB + API Gateway to Render.**
- **Database and auth remain on Supabase** (PostgreSQL + Auth).
- **Object storage and signed document delivery remain on AWS S3 + CloudFront.**
- **The UAT release is hosted entirely on Render Free tier**: Docker Web Service for the API, Static Site for the vanilla HTML/CSS/JS prototype.
- **CI/CD, backups, monitoring, and a UAT→production promotion stream are defined below.**

This is a deliberate simplification for the UAT/test-run phase. The architecture is portable: when traffic or SLA requirements grow, the backend can be upgraded to Render Standard/Pro or migrated back to AWS without changing the application code.

---

## 2. Current Codebase Snapshot

### 2.1 Backend (`backend/`)

- **Runtime**: Node.js 20 (Alpine Docker image).
- **Framework**: Express 4 modular monolith.
- **Auth/DB**: Supabase PostgreSQL + Supabase Auth.
- **Direct DB**: `node-pg-migrate` + `pg` driver via `DATABASE_URL` for migrations.
- **Object store**: AWS S3; downloads via CloudFront signed URLs (fallback to S3 signed URLs).
- **Validation**: Zod.
- **Testing**: Jest + Supertest; `PORT=0` for collision-free tests.
- **Lint/Format**: ESLint + Prettier.
- **Local dev**: Docker Compose with Postgres and LocalStack S3.

Key files:

| File | Purpose |
|------|---------|
| `src/app.js` | Express entry, middleware, route mounting |
| `src/config/env.js` | Centralized env var access |
| `src/config/supabase.js` | Supabase admin client |
| `src/config/aws.js` | S3 client |
| `src/middleware/auth.js` | Supabase JWT verification + profile load |
| `src/middleware/errorHandler.js` | RFC 7807 Problem Details |
| `src/services/s3Service.js` | Pre-signed upload/download + delete |
| `migrations/` | `node-pg-migrate` + raw SQL migrations |
| `Dockerfile` | Multi-stage production build |
| `docker-compose.yml` | Local dev stack |

### 2.2 Frontend (`erp_prototype/`)

- Vanilla HTML/CSS/JS SPA.
- Hash-based routing in `js/app.js`.
- API client in `js/apiClient.js` reads `window.__ERP_API_BASE_URL__`.
- No build step; a small build script will generate `env.js` for Render deployment.

---

## 3. Platform Decisions

### 3.1 Why Render for Compute?

| Factor | AWS ECS/Fargate (original) | Render (selected) |
|--------|---------------------------|-------------------|
| Operational overhead | High (ALB, API Gateway, ECR, IAM, VPC) | Low (git push → deploy) |
| Cost at low scale | Fixed baseline cost | Free tier for UAT; pay-as-you-go later |
| Cold starts | Fargate task startup time | Free tier spins down; paid tiers stay warm |
| SSL / custom domains | Manual ACM + ALB | Built-in |
| Team velocity | Slower iteration | Faster UAT feedback loops |

Render was chosen for the **initial UAT/test run** to reduce infrastructure friction and let the multi-agent team focus on feature completeness and bug fixes. AWS is retained for object storage because document S3 buckets and CloudFront distribution are already configured and cost-effective.

### 3.2 Why Keep Supabase?

- Auth, row-level security policies, and the PostgreSQL schema are already modeled in Supabase.
- Moving the database would require a migration project of its own.
- Render does not provide a managed Postgres with Auth out of the box; keeping Supabase preserves existing security and user-management investments.

### 3.3 Object Storage with Supabase Storage

- Documents are stored in **Supabase Storage** buckets.
- Uploads and downloads use Supabase signed URLs; the API never streams file bytes.
- The backend service role key manages bucket access; backend RBAC controls document permissions.
- Bucket RLS policies restrict uploads to authenticated users and entity-scoped paths.

---

## 4. Render Deployment Topology

### 4.1 Services (Free Tier UAT)

| Service | Render Type | Source | Notes |
|---------|-------------|--------|-------|
| `ata-lta-erp-api-uat` | Web Service (Docker) | `backend/Dockerfile`, `uat` branch | Free plan; sleeps after inactivity |
| `ata-lta-erp-spa-uat` | Static Site | `erp_prototype/` | Free plan; injects backend URL at build time |

Production services (`ata-lta-erp-api-prod`, `ata-lta-erp-spa-prod`) require a paid Render plan and are not included in the free-tier Blueprint.

### 4.2 Render Blueprint (`render.yaml`)

The free-tier Blueprint declares **only the UAT services**, each with `plan: free`. Production services are added later when upgrading to a paid plan.

### 4.3 Dockerfile Compatibility

The `backend/Dockerfile` uses Node.js 22 because `@supabase/supabase-js` requires the native `WebSocket` API available in Node 22+:

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
USER node
EXPOSE 3000
CMD ["node", "src/app.js"]
```

Render injects `$PORT` at runtime; `env.js` reads it via `process.env.PORT` with a fallback to `3000`.

### 4.4 SPA Build for Render Static Site

Add `erp_prototype/build.js`:

```js
const fs = require('fs');
const path = require('path');
const apiUrl = process.env.ERP_API_BASE_URL || 'http://localhost:3000/v1';
const out = `window.__ERP_API_BASE_URL__ = ${JSON.stringify(apiUrl)};`;
fs.writeFileSync(path.join(__dirname, 'env.js'), out);
```

Render Static Site settings:

- **Root directory**: `erp_prototype`
- **Build command**: `node build.js`
- **Publish directory**: `.`
- **Environment variable**: `ERP_API_BASE_URL=https://<backend-service>.onrender.com/v1`

Include `<script src="env.js"></script>` before `apiClient.js` in `index.html`.

### 4.5 Cold Starts and Free Tier Limitations

- Free Web Services spin down after ~15 minutes of inactivity.
- First request after spin-down can take 30–60 seconds.
- Mitigation for UAT: an uptime monitor pings `/health` every 5 minutes (see section 7).
- Mitigation for production: upgrade to Render Standard/Pro or keep the Free tier only for non-critical demo instances.

---

## 5. Environment Variables and Secrets

### 5.1 Render Environment Groups

Create two groups in the Render dashboard:

**`erp-uat-secrets`**

| Variable | Source | Notes |
|----------|--------|-------|
| `NODE_ENV` | Render | `production` even for UAT |
| `PORT` | Render | Injected automatically |
| `SUPABASE_URL` | Supabase UAT project settings | Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase UAT project settings | Service-role key; never in browser |
| `SUPABASE_STORAGE_BUCKET` | Supabase UAT Storage | e.g. `ata-lta-erp-documents-uat` |
| `DATABASE_URL` | Supabase UAT project settings | Pooled connection string (`?pgbouncer=true`) |
| `FRONTEND_URL` | Render Static Site | UAT SPA URL |
| `LOG_LEVEL` | Render | `info` |

**`erp-prod-secrets`** (same keys, production values; created after upgrading to a paid Render plan).

### 5.2 Supabase Storage Bucket

The bucket must be created in Supabase Storage and referenced by `SUPABASE_STORAGE_BUCKET`. The backend uses the service role key, which bypasses RLS by default. Keep the bucket private and rely on signed URLs for access.

### 5.3 Supabase Pooler vs Direct Connection

- Use the **Supabase connection pooler** (`5432` with `?pgbouncer=true`) for `DATABASE_URL`.
- `node-pg-migrate` works through the pooler in **transaction mode** for standard migrations.
- For very large migrations, temporarily switch to the direct Postgres URI from Supabase settings and add the flag `--no-transaction`.

---

## 6. Database Migrations and Schema Management

### 6.1 Migration Toolchain

- `node-pg-migrate` is the primary runner.
- Mixed migration formats exist: `.js` and `.sql`. Both are supported; new migrations should use `.sql` for schema changes and `.js` only when JavaScript logic is required.
- Migration files must be named with monotonically increasing prefixes to guarantee order.

### 6.2 Migration Rules for Multi-Agent Collaboration

1. **Never edit a merged migration.** If a merged migration is wrong, create a new migration to fix it.
2. **Add new migrations at the end of the directory** with the next available serial number.
3. **Run `npm run migrate:up -- --dry-run` in CI** before merge.
4. **Apply migrations in CI, not at container startup**, to avoid race conditions during rolling deploys.
5. **Back up before migrating** (section 8).

### 6.3 UAT Migration Job

GitHub Actions job after successful Render UAT deploy:

```yaml
migrate-uat:
  needs: deploy-uat
  runs-on: ubuntu-latest
  environment: uat
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: npm ci
    - run: npm run migrate:up
      env:
        DATABASE_URL: ${{ secrets.UAT_DATABASE_URL }}
```

### 6.4 Production Migration Job

Same pattern, triggered on merge to `main`:

```yaml
migrate-prod:
  needs: deploy-prod
  runs-on: ubuntu-latest
  environment: production
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: npm ci
    - run: npm run migrate:up
      env:
        DATABASE_URL: ${{ secrets.PROD_DATABASE_URL }}
```

---

## 7. Monitoring and Observability

### 7.1 Logging

Replace Morgan with a lightweight structured JSON logger.

Add `src/lib/logger.js`:

```js
const logger = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', msg, ...meta })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', msg, ...meta })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', msg, ...meta })),
};
module.exports = logger;
```

Update `src/app.js`:

```js
const logger = require('./lib/logger');
// replace morgan usage with a simple request logger middleware
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

Update `errorHandler.js` to log structured errors:

```js
logger.error('unhandled error', {
  status,
  title,
  detail,
  stack: env.isDevelopment ? err.stack : undefined,
  requestId: req.id,
});
```

### 7.2 Health Checks

Extend `/health` in `src/app.js` to verify Supabase and S3 connectivity:

```js
const { supabaseAdmin } = require('./services/supabaseClient');
const { s3Client } = require('./config/aws');
const { HeadBucketCommand } = require('@aws-sdk/client-s3');

app.get('/health', async (req, res) => {
  const checks = {
    supabase: false,
    s3: false,
  };
  try {
    await supabaseAdmin.rpc('pgmoon_available'); // lightweight no-op, or SELECT 1 via rpc
    checks.supabase = true;
  } catch (e) {
    checks.supabase = false;
  }
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: env.s3.documentBucket }));
    checks.s3 = true;
  } catch (e) {
    checks.s3 = false;
  }
  const ok = checks.supabase && checks.s3;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});
```

> Note: if `pgmoon_available` is not available, use a custom RPC or a simple `supabaseAdmin.from('entities').select('id').limit(1)`.

Render health check path: `/health`.

### 7.3 Uptime Monitoring

For UAT, configure a free external monitor (e.g., UptimeRobot) to:

- Ping `https://<backend>.onrender.com/health` every 5 minutes.
- Alert via email/Slack on 2 consecutive failures.

This also keeps the Free tier service warm.

### 7.4 Error Tracking (Production)

Defer Sentry/Logtail until production. When ready:

1. Add `@sentry/node` and `@sentry/profiling-node`.
2. Initialize Sentry at the top of `src/app.js`.
3. Send captured errors from `errorHandler.js` to Sentry.

---

## 8. Data Backups and Retention

### 8.1 Database Backups

| Environment | Method | Frequency | Retention |
|-------------|--------|-----------|-----------|
| UAT (Free/Starter Supabase) | GitHub Actions `pg_dump` | Nightly + pre-migration | 7 days |
| UAT (Pro Supabase) | Supabase native backups | Daily | Per plan |
| Production | Supabase native daily backups + `pg_dump` to S3 | Daily | 30 days |

Nightly UAT backup workflow:

```yaml
backup-uat:
  schedule:
    - cron: '0 2 * * *'
  runs-on: ubuntu-latest
  environment: uat
  steps:
    - uses: actions/checkout@v4
    - name: Install PostgreSQL 17 Client
      run: |
        sudo apt-get update
        sudo apt-get install -y postgresql-common
        sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
        sudo apt-get install -y postgresql-client-17
    - run: |
        /usr/lib/postgresql/17/bin/pg_dump "$DATABASE_URL" \
          --no-owner --no-acl --clean --if-exists \
          --file ata-lta-erp-uat-$(date +%Y%m%d-%H%M%S).sql
      env:
        DATABASE_URL: ${{ secrets.UAT_DATABASE_URL }}
    - uses: actions/upload-artifact@v4
      with:
        name: uat-db-backup
        path: ata-lta-erp-uat-*.sql
        retention-days: 7
```

### 8.2 Pre-Migration Backups

Every migration job must snapshot the database before applying changes:

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl --clean --if-exists > backup-before-migration.sql
```

### 8.3 Document Backups

| Bucket | Versioning | Lifecycle | Cross-region replication |
|--------|-----------|-----------|--------------------------|
| Production document bucket | Enabled | Current + noncurrent transitions per `infra/s3-lifecycle-rules.json` | Add in production |
| UAT document bucket | Disabled | Delete test uploads after 30 days | N/A |

Enable versioning on the production bucket and add a noncurrent-version lifecycle rule:

```json
{
  "Rules": [
    {
      "ID": "expire-old-versions",
      "Status": "Enabled",
      "Filter": { "Prefix": "entities/" },
      "NoncurrentVersionExpiration": { "NoncurrentDays": 30 }
    }
  ]
}
```

### 8.4 Disaster Recovery

- **Database**: Restore from the latest `pg_dump` into a fresh Supabase project or local Postgres, then verify with smoke tests.
- **Documents**: Re-enable from versioned S3 objects. With cross-region replication, fail over to the replica bucket by updating `S3_DOCUMENT_BUCKET` and `CLOUDFRONT_DOCUMENT_DOMAIN`.

---

## 9. CI/CD and Render Blueprint

### 9.1 Git Branching Model

| Branch | Purpose | Render Service |
|--------|---------|----------------|
| `feature/*` | Agent work in progress | None (tested in CI only) |
| `uat` | Integrated UAT release candidate | `ata-lta-erp-api-uat`, `ata-lta-erp-spa-uat` |
| `main` | Production release | `ata-lta-erp-api-prod`, `ata-lta-erp-spa-prod` |

Flow:

1. Agent opens PR from `feature/*` to `uat`.
2. GitHub Actions runs `npm test`, `npm run lint`, and migration dry-run.
3. On merge to `uat`, Render auto-deploys backend and static site.
4. GitHub Actions runs post-deploy smoke tests against UAT URL.
5. GitHub Actions applies UAT migrations.
6. After UAT sign-off, open promotion PR from `uat` → `main`.
7. On merge to `main`, Render auto-deploys production services.
8. GitHub Actions runs production smoke tests and applies production migrations.

### 9.2 GitHub Actions Workflow (`.github/workflows/ci.yml`)

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

### 9.3 Post-Deploy Smoke Tests

The existing `erp_prototype/smoke-test.js` uses Playwright against a local server. Adapt it to accept a `BASE_URL` env var and run against Render UAT:

```yaml
smoke-uat:
  needs: deploy-uat
  runs-on: ubuntu-latest
  environment: uat
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
    - run: npm ci
      working-directory: erp_prototype
    - run: node smoke-test.js
      env:
        BASE_URL: ${{ secrets.UAT_SPA_URL }}
```

### 9.4 Render Blueprint (`render.yaml`) — Free Tier UAT Only

```yaml
projects:
  - name: My project
    environments:
      - name: uat
        services:
          # ─── UAT Backend ────────────────────────────────────────────────
          - type: web
            name: ata-lta-erp-api-uat
            runtime: docker
            plan: free
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
              - key: FRONTEND_URL
                fromService:
                  name: ata-lta-erp-spa-uat
                  type: web
                  property: host
              - fromGroup: erp-uat-secrets

          # ─── UAT Frontend Static Site ──────────────────────────────────
          - type: web
            name: ata-lta-erp-spa-uat
            runtime: static
            repo: https://github.com/<org>/ata-lta-erp
            branch: uat
            rootDir: erp_prototype
            buildCommand: npm run build
            staticPublishPath: .
            envVars:
              - key: ERP_API_BASE_URL
                fromService:
                  name: ata-lta-erp-api-uat
                  type: web
                  property: host

        envVarGroups:
          - name: erp-uat-secrets
            envVars:
              - key: SUPABASE_URL
                value: REPLACE_WITH_UAT_SUPABASE_URL
              - key: SUPABASE_SERVICE_KEY
                value: REPLACE_WITH_UAT_SUPABASE_SERVICE_KEY
              - key: SUPABASE_STORAGE_BUCKET
                value: ata-lta-erp-documents-uat
              - key: DATABASE_URL
                value: REPLACE_WITH_UAT_DATABASE_URL
```

> Notes:
> - Both services and the env group live inside a `projects` → `uat` environment so `fromGroup` can link them.
> - `fromGroup` is a bare list item under `envVars`; it injects every variable from `erp-uat-secrets`.
> - `fromService.property: host` returns a bare hostname; the backend and build script prepend `https://` and the build script appends `/v1`.
> - Static sites are free by default — **do not** set `plan: free` on them.
> - Replace the placeholder env group values after the Blueprint creates the group, or set them in the Render dashboard.
> - Production services are not included because multiple services or production-grade plans trigger Render's payment wall on the free tier.

---

## 10. Production Testing Stream (UAT → Production)

### 10.1 Release Gates

Before promoting `uat` to `main`:

1. **Functional**: UAT smoke tests pass.
2. **Migrations**: Migration dry-run against production succeeds.
3. **Security**: No new secrets logged; env vars validated.
4. **Performance**: Load test optional; target < 500 ms p95 for API list endpoints.
5. **Sign-off**: Product owner approval documented in promotion PR.

### 10.2 Blue-Green on Render

Render Free tier does not support native blue-green. For production on paid tier:

- Maintain `ata-lta-erp-api-prod` and `ata-lta-erp-api-prod-staging`.
- Deploy `main` to staging first, run smoke tests, then promote image/tag to production via Render dashboard or API.
- Alternatively, rely on the `uat` branch as the green environment and promote by fast-forward merge.

For this project, the simpler two-branch model (`uat` → `main`) is sufficient until traffic justifies full blue-green.

### 10.3 Rollback Plan

| Layer | Rollback Action |
|-------|-----------------|
| Application | Revert merge commit; Render auto-deploys previous image |
| Database | Restore from pre-migration `pg_dump` or Supabase backup |
| Documents | Restore from Supabase Storage backups or re-upload from local copies |
| Config | Roll back env group values in Render dashboard |

Rollback SLA:

- Application: < 10 minutes via git revert.
- Database: < 1 hour via `pg_dump` restore.
- Documents: < 1 hour via Supabase Storage restore or re-upload.

---

## 11. Security and Compliance

### 11.1 Secrets

- All secrets live in Render environment groups or GitHub Actions secrets.
- `SUPABASE_SERVICE_KEY` is never committed.
- Rotate Supabase keys every 90 days; track rotation in a runbook.

### 11.2 CORS

Backend CORS origin is restricted to `FRONTEND_URL` in production:

```js
app.use(cors({
  origin: env.isDevelopment ? true : env.frontendUrl,
  credentials: true,
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Active-Entity'],
  exposedHeaders: ['X-Request-Id'],
}));
```

Set `FRONTEND_URL` to the exact Render Static Site URL.

### 11.3 Rate Limiting

Current rate limit: 200 requests per 15 minutes in production, 1000 in development. Monitor UAT logs and adjust before production.

### 11.4 Audit Logging

All state mutations are logged to `audit_logs` via `src/middleware/audit.js`. Backup retention for audit logs follows the database backup policy.

---

## 12. Multi-Agent Collaboration Rules

1. **Module ownership**: Agents A and B already own distinct backend modules. Respect existing ownership boundaries.
2. **Shared changes**: Any change to `src/config/`, `src/middleware/`, `src/lib/`, `migrations/`, `Dockerfile`, `render.yaml`, or GitHub Actions must be announced via a GitHub issue labeled `shared-change-request`.
3. **No inline merge conflicts**: Rebase feature branches onto `uat` before opening PRs.
4. **Single source of truth**: `docs/DEPLOYMENT_SPECS.md`, `docs/AGENT_SYSTEM_PROMPT.md`, and `docs/IMPLEMENTATION_PLAN.md` are owned by the lead; agents propose edits via PR.
5. **Code style**: Follow existing comment density, naming, and idiom. Run `npm run lint` and `npm test` before every PR.

---

## 13. Open Questions / Future Work

- [x] Convert repository to Git and connect to GitHub.
- [ ] Create UAT Supabase project and Storage bucket.
- [ ] Add `erp_prototype/build.js` and update `index.html` to load `env.js`.
- [x] Replace Morgan with structured logger and extend `/health`.
- [x] Write `render.yaml` and commit to repo root.
- [x] Create GitHub Actions workflows.
- [ ] Upgrade to paid Render plan and add production services.
- [ ] Configure UptimeRobot or Render health check notifications.
- [ ] Add Sentry integration for production.
- [ ] Document password reset / invite email flow.
- [ ] Define load-test plan for production readiness.

---

## 14. Glossary

| Term | Meaning |
|------|---------|
| ATA/LTA | Two operating entities of the accounting firm |
| DMS | Document Management System |
| PITR | Point-in-Time Recovery |
| SPA | Single Page Application |
| UAT | User Acceptance Testing |
| WR | Work Request |
