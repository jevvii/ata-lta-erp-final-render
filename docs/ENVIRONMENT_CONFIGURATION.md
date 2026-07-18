# ATA & LTA ERP — Environment Configuration

**Date**: 2026-07-17  
**Applies to**: UAT and Production deployments on Render + Supabase.

This document lists every secret, environment variable, and Supabase setting required to deploy the ERP. Keep these values in **Render environment groups** and **GitHub Actions secrets** only. Never commit them to the repository.

---

## 1. Overview

After migrating from AWS S3/CloudFront to Supabase Storage, the only external platforms are:

- **Render** — compute (backend Web Service + frontend Static Site)
- **Supabase** — PostgreSQL database, Auth, and object Storage
- **GitHub** — source control and CI/CD secrets

### Environment separation

| Environment | Supabase Project | Render Services | GitHub Environment |
|-------------|------------------|-----------------|-------------------|
| UAT | `ata-lta-erp-uat` | `ata-lta-erp-api-uat`, `ata-lta-erp-spa-uat` | `uat` |
| Production | `ata-lta-erp-prod` | `ata-lta-erp-api-prod`, `ata-lta-erp-spa-prod` | `production` |

---

## 2. Supabase Configuration

### 2.1 Required Supabase Settings (per project)

| Setting | Where to find | Example / Notes |
|---------|--------------|-----------------|
| **Project URL** | Supabase Dashboard → Project Settings → API | `https://xxxx.supabase.co` |
| **Service Role Key** | Supabase Dashboard → Project Settings → API → `service_role` key | Starts with `eyJ...`. Never expose to the browser. |
| **Anon/Public Key** | Supabase Dashboard → Project Settings → API | Used by the SPA for login only. |
| **JWT Secret** | Supabase Dashboard → Project Settings → API | Only needed if verifying tokens locally. Not required for current backend. |
| **Database Connection String (Pooler)** | Supabase Dashboard → Database → Connection Pooling | `postgresql://postgres.xxx:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true` |
| **Direct Database Connection String** | Supabase Dashboard → Database → Connection String | Use only for large non-transactional migrations. |

### 2.2 Supabase Storage Bucket

Create one bucket per environment:

| Bucket Name | Purpose |
|-------------|---------|
| `ata-lta-erp-documents-uat` | UAT documents and generated PDFs |
| `ata-lta-erp-documents-prod` | Production documents and generated PDFs |

#### Bucket settings

- **Public bucket**: No (documents should only be accessible via signed URLs)
- **RLS policies**: Enabled
- **Allowed MIME types**: `application/pdf`, `image/*`, `application/msword`, `application/vnd.openxmlformats-officedocument.*`, `text/plain`, `application/vnd.ms-excel`
- **Max file size**: 50 MB (adjust as needed)

### 2.3 Supabase Storage RLS Policies

Run these SQL snippets in the Supabase SQL Editor for each bucket.

#### Allow authenticated users to upload

```sql
CREATE POLICY "Allow authenticated uploads"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ata-lta-erp-documents-uat'
  AND (storage.foldername(name))[1] = 'entities'
);
```

#### Allow service role unrestricted access

The backend uses the `service_role` key, which bypasses RLS by default. If you create a custom key with restricted access, ensure it has `ALL` privileges on the bucket.

For simplicity, the recommended setup is to use the service role key for backend operations and rely on backend RBAC for access control.

### 2.4 Supabase Auth Settings

- **Site URL**: Set to the SPA URL (e.g., `https://ata-lta-erp-spa-uat.onrender.com`)
- **Redirect URLs**: Same as Site URL
- **Email templates**: Use default or customize as needed
- **Disable email confirmations for testing** (UAT only) if you want to create test users without email verification

### 2.5 Supabase Database Setup

1. Create the Supabase project.
2. Ensure the `pgcrypto` extension is enabled (required for `gen_random_uuid()`).
3. Run migrations via GitHub Actions or locally using `node-pg-migrate`.

---

## 3. Render Environment Groups

Create the `erp-uat-secrets` environment group manually under **My project → uat** before syncing the Blueprint. This avoids the environment mismatch error that occurs when a group of the same name exists in the default Production environment.

If a conflicting group already exists, delete it first.

### 3.1 UAT Environment Group (`erp-uat-secrets`)

Use these exact key names (no `UAT_` prefix — the group is already scoped to the uat environment):

| Key | Source | Example |
|-----|--------|---------|
| `SUPABASE_URL` | Supabase UAT project settings | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase UAT project settings | `eyJ...` |
| `SUPABASE_STORAGE_BUCKET` | Supabase UAT Storage | `ata-lta-erp-documents-uat` |
| `DATABASE_URL` | Supabase UAT connection pooler | `postgresql://postgres.xxx:...@...pooler.supabase.com:6543/postgres?pgbouncer=true` |

### 3.2 Production Environment Group (`erp-prod-secrets`) — Paid Plan

Same keys as UAT, but pointing to the production Supabase project. Created only after upgrading to a paid Render plan.

| Key | Source | Example |
|-----|--------|---------|
| `SUPABASE_URL` | Supabase prod project settings | `https://yyyy.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Supabase prod project settings | `eyJ...` |
| `SUPABASE_STORAGE_BUCKET` | Supabase prod Storage | `ata-lta-erp-documents-prod` |
| `DATABASE_URL` | Supabase prod connection pooler | `postgresql://postgres.yyy:...@...pooler.supabase.com:6543/postgres?pgbouncer=true` |

### 3.3 Render Static Site Env Vars

Render Static Sites do not use environment groups. Each Static Site has its own env vars:

| Static Site | Key | Value |
|-------------|-----|-------|
| `ata-lta-erp-spa-uat` | `ERP_API_BASE_URL` | `https://ata-lta-erp-api-uat.onrender.com/v1` |
| `ata-lta-erp-spa-prod` | `ERP_API_BASE_URL` | `https://ata-lta-erp-api-prod.onrender.com/v1` |

> Note: `render.yaml` uses `fromService` to inject the backend URL automatically, but you may need to append `/v1` manually in the Static Site settings if Render does not support suffix concatenation.

---

## 4. GitHub Repository Secrets

Go to **GitHub Repository → Settings → Secrets and variables → Actions** and add the following.

### 4.1 UAT Secrets

| Secret Name | Value | Used By |
|-------------|-------|---------|
| `UAT_DATABASE_URL` | Supabase UAT pooled connection string | `deploy-uat.yml`, `backup-uat.yml`, `ci.yml` |
| `UAT_SUPABASE_URL` | Supabase UAT project URL | Optional: future scripts |
| `UAT_SUPABASE_SERVICE_KEY` | Supabase UAT service role key | Optional: future scripts |
| `UAT_SUPABASE_STORAGE_BUCKET` | `ata-lta-erp-documents-uat` | Optional: future scripts |
| `UAT_FRONTEND_URL` | `https://ata-lta-erp-spa-uat.onrender.com` | Optional: CORS verification |
| `UAT_SPA_URL` | `https://ata-lta-erp-spa-uat.onrender.com` | `deploy-uat.yml` smoke tests |

### 4.2 Production Secrets — Paid Plan

| Secret Name | Value | Used By |
|-------------|-------|---------|
| `PROD_DATABASE_URL` | Supabase prod pooled connection string | `deploy-prod.yml`, `backup-prod.yml`, `ci.yml` |
| `PROD_SUPABASE_URL` | Supabase prod project URL | Optional |
| `PROD_SUPABASE_SERVICE_KEY` | Supabase prod service role key | Optional |
| `PROD_SUPABASE_STORAGE_BUCKET` | `ata-lta-erp-documents-prod` | Optional |
| `PROD_FRONTEND_URL` | `https://ata-lta-erp-spa-prod.onrender.com` | Optional |
| `PROD_SPA_URL` | `https://ata-lta-erp-spa-prod.onrender.com` | `deploy-prod.yml` smoke tests |

### 4.3 GitHub Environments

| Environment | Required Reviewers | Protection Rules | When to create |
|-------------|-------------------|------------------|--------------|
| `uat` | Optional | Wait timer: 0 | Now |
| `production` | At least 1 lead reviewer | Prevent self-review | After upgrading to paid Render plan |

---

## 5. Local Development Environment

Copy `backend/.env.example` to `backend/.env` and fill in:

```bash
NODE_ENV=development
PORT=3000
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
SUPABASE_STORAGE_BUCKET=ata-lta-erp-documents-dev
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ata_lta_erp
FRONTEND_URL=http://localhost:8080
LOG_LEVEL=info
```

For local storage testing, either:
- Point to a dev Supabase project bucket, or
- Use `docker compose up` with local Postgres only (storage calls will fail unless mocked).

---

## 6. Secret Rotation Checklist

### Supabase Service Key

1. Generate new key in Supabase Dashboard → Project Settings → API.
2. Update Render environment group.
3. Redeploy affected Web Service.
4. Verify `/health` returns `supabase: true`.
5. Revoke old key.

### Supabase Storage Bucket Policy

If you rotate bucket names:
1. Create new bucket.
2. Apply RLS policies.
3. Update `SUPABASE_STORAGE_BUCKET` in Render.
4. Redeploy.
5. Verify `/health` returns `storage: true`.

### Database Connection String

1. Reset database password in Supabase Dashboard.
2. Update `DATABASE_URL` in GitHub secrets and Render env group.
3. Re-run migrations via GitHub Actions.
4. Verify backup and migration jobs succeed.

---

## 7. Validation Commands

After configuring secrets, verify each layer:

```bash
# Backend health (after deploy)
curl https://<backend>.onrender.com/health
# Expected: {"status":"ok","checks":{"supabase":true,"storage":true}}

# SPA env.js (after Static Site deploy)
curl https://<spa>.onrender.com/env.js
# Expected: window.__ERP_API_BASE_URL__ = "https://<backend>.onrender.com/v1";
```

---

## 8. Summary Table

| Layer | What to configure | Where |
|-------|-------------------|-------|
| Supabase UAT | Project, Storage bucket, Auth, DB connection | Supabase Dashboard |
| Supabase Prod | Project, Storage bucket, Auth, DB connection | Supabase Dashboard |
| Render UAT | Environment group `erp-uat-secrets`, Blueprint | Render Dashboard |
| Render Prod | Environment group `erp-prod-secrets`, Blueprint | Render Dashboard |
| GitHub UAT | Repository secrets + `uat` environment | GitHub Settings |
| GitHub Prod | Repository secrets + `production` environment | GitHub Settings |
| Local dev | `.env` file | Local machine |
