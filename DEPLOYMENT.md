# Deploy main to Render

This release combines the staging backend and enterprise-v2 React frontend. The backend and static site must use the same reviewed main commit. Apply these settings to the **existing main services**; leave staging and the v2 preview services in place.

## Verified preparation

The production publishable key was accepted by `https://nohelmujoswmmqedgern.supabase.co/auth/v1/settings` with HTTP 200 using a read-only request. The Blueprint declares `SUPABASE_ANON_KEY` on the API and `VITE_SUPABASE_ANON_KEY` on the frontend with `sync: false`; their values must be entered in Render, never in the YAML. The frontend receives only public configuration; never link its service to the backend secrets group.

A read-only production ledger check found 15 pending migrations: `000065` through `000079`. They include disbursement lifecycle/RLS, receipt reservations, creation approvals, serialization, item numbering, and client-fund billing. The migration runner now awaits asynchronous migrations and fails when a seed fails. Rehearsals passed on a blank local database and a schema-only production copy; neither copied customer records nor changed production. The schema rehearsal does not substitute for a recent recoverable production backup or validate every existing data row.

## 1. Prepare the existing Blueprint for sync

Use the existing Blueprint connected to this repository and select branch **main**, Blueprint path **render.yaml**. Keep Blueprint **Auto Sync disabled** until the backup and pending migrations finish. Turn service Auto-Deploy off for both existing main services as well. A manual Blueprint sync applies configuration changes and can redeploy services; `autoDeployTrigger: off` is not a deployment barrier for a manual sync.

Before publishing, record the currently successful deploy IDs/commits and custom domains. Schedule a quiet maintenance window before migrations. Publish the reviewed revision and wait for CI. Local main was 300 commits ahead of origin/main at the original audit baseline; ensure the selected remote main revision includes the integration and remediation.

Only these values need dashboard management:

| Location | Required settings |
| --- | --- |
| API's existing `erp-main-secrets` group | Production `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET`, `DATABASE_URL` |
| API service → Environment | `SUPABASE_ANON_KEY` = supplied production publishable key |
| Static site → Environment | `VITE_SUPABASE_ANON_KEY` = same supplied publishable key |

The key values are deliberately absent from Git. Both service variables use `sync: false`. **Existing Blueprint updates do not prompt for or populate these variables**; set them manually before syncing. Initial Blueprint creation prompts for them. Do not put `sync: false` entries inside an environment-group definition: Render does not support that.

Keep `erp-main-secrets` linked only to the API. Remove stale backend-secret group links from the static site manually; omission from YAML does not remove existing environment variables or links. Review/remove any old direct `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, or other private credentials on the static site too.

The Blueprint now declares services at the top level, preserving their existing Render project/environment placement. Do not create replacement services or move the secrets group. The existing group must be in the API's environment so the link is valid.

After the backup and migrations in §4 succeed, open **Blueprints → your existing Blueprint → Manual Sync**. Check the preview changes update only `ata-lta-erp-api-main` and `ata-lta-erp-spa-main`. The sync applies branch, directories, Docker/static build settings, URLs, readiness path, and SPA rewrite automatically. Stop if the preview creates duplicate services or proposes changing unrelated resources.

## 2. API settings applied by Blueprint sync

The sync configures **ata-lta-erp-api-main** as follows:

| Setting | Value |
| --- | --- |
| Repository | `jevvii/ata-lta-erp-final-render` |
| Branch | `main` |
| Runtime | Docker |
| Root Directory | `backend` |
| Dockerfile Path | `Dockerfile` relative to the service root |
| Health Check Path | `/readyz` |
| Auto-Deploy | Off for the coordinated release |
| Plan/region | Keep existing settings; blueprint retains Free/Singapore |

In **Environment**, link the existing `erp-main-secrets` group to the API only. It must contain the current production `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET`, and `DATABASE_URL`. Keep the private receipt bucket (`ata-lta-erp-documents-prod`) private. Retain any existing backend-only avatar or storage overrides.

Add/set these API environment variables:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `LOG_LEVEL` | `info` |
| `RESERVATION_STORE_DRIVER` | `database` |
| `FRONTEND_URL` | `https://ata-lta-erp-spa-main.onrender.com` |
| `SUPABASE_ANON_KEY` | The supplied production publishable key, entered manually in Render |

`SUPABASE_URL` must be `https://nohelmujoswmmqedgern.supabase.co`; the database and service key must belong to that same production project. Do not replace `SUPABASE_SERVICE_KEY` with the publishable key. Save changes without starting the deployment yet if Render offers **Save only**.

The API now returns 503 for public configuration when a browser-safe key is missing or privileged. Existing clients that cached an old service-role credential will reject and clear that stored key. If the old public endpoint operated without a proper public key, assess the service credential as potentially exposed and rotate it in Supabase and the backend/GitHub secrets together. Adding the publishable key alone does not revoke an exposed service credential.

## 3. Static-site settings applied by Blueprint sync

The sync configures **ata-lta-erp-spa-main** as follows:

| Setting | Value |
| --- | --- |
| Branch | `main` |
| Root Directory | `frontend` |
| Build Command | `npm ci && npm run build` |
| Publish Directory | `dist` |
| Auto-Deploy | Off for the coordinated release |

In **Redirects/Rewrites**, add the fallback rule **Source `/*` → Destination `/index.html` → Action Rewrite**. Keep real assets served directly; use Rewrite, not Redirect. This lets refreshed URLs such as `/operations` reach React Router.

Set these static-site environment variables:

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `ERP_API_BASE_URL` | `https://ata-lta-erp-api-main.onrender.com/v1` |
| `VITE_SUPABASE_URL` | `https://nohelmujoswmmqedgern.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The supplied production publishable key, entered manually in Render |

Remove any link from this static site to `erp-main-secrets` or `erp-staging-secrets`; it needs no database URL or service key. Remove stale `VITE_API_URL` overrides. Public runtime configuration and normal API requests now share the same API base. Vite values are embedded during the build, so saving a new environment value requires a new static-site deployment.

The Blueprint preserves service project/environment placement. Runtime API/project URLs are non-secret configuration and remain in YAML. The publishable key is browser-visible by design, but its actual value is managed in Render.

## 4. Back up and apply migrations

The GitHub workflow **Deploy Production** is now manual. Configure its `production` environment secrets:

- `PROD_DATABASE_URL`
- `BACKUP_ENCRYPTION_KEY`
- `PROD_SUPABASE_URL`
- `PROD_SUPABASE_SERVICE_KEY`
- `PROD_SPA_URL` = `https://ata-lta-erp-spa-main.onrender.com`

The missing `erp-db-backups` bucket was created during remediation and verified private. It is ready for the encrypted backup upload using the production service credential. Keep the backup decryption passphrase recoverable. The backup job encrypts the database dump before upload and stops the release if the dump, encryption, or upload fails.

In GitHub **Actions → Deploy Production → Run workflow**:

1. Choose main as the workflow branch.
2. Set `action` to **migrate**.
3. Set `revision` to the full reviewed commit SHA.
4. Run and wait for both **backup-before-migrate** and **migrate-prod** to pass. Confirm the encrypted backup upload succeeded.

The migration command is `node scripts/migrate-remote.js prod` from `backend`, using Node 22 and the production secrets. It applies mixed SQL/JS migrations through `remote_migrations`, preserving already-applied entries. Do not substitute `node-pg-migrate up`, reset the database, or edit the ledger to mark a failed migration complete.

For a read-only post-migration inventory from a configured checkout:

```sh
npm --prefix backend run migrate:check -- prod
```

It must report `pending: []`. If a migration fails, keep the maintenance window open and the old deploy IDs available; inspect the failure before continuing. Earlier successful migrations may already have committed. Do not run automatic down migrations: lifecycle/backfill changes may not be safely reversible.

## 5. Sync and verify deployments

After migration succeeds, manually sync the prepared Blueprint from the reviewed main revision. Configuration changes may redeploy both services. The maintenance window must stay open until the API is ready and the SPA verification passes. If a service does not redeploy during sync, or if you need explicit ordering, use the following manual deploy steps:

1. **API service → Manual Deploy → Deploy a specific commit**, select the reviewed SHA. Wait until the deploy is live and `/readyz` returns HTTP 200 with `status: ready`. Also check `/health` returns `status: ok`.
2. **SPA service → Manual Deploy → Deploy a specific commit**, select the same SHA. Use **Clear build cache & deploy** if Render is retaining legacy build settings.
3. Open `https://ata-lta-erp-spa-main.onrender.com/deployment.json`. It must identify `enterprise-v2`, the main API URL ending in `/v1`, and the reviewed commit SHA. A staging URL here requires fixing the static site's environment and rebuilding.
4. Refresh `/operations` directly. It should load the React login/application rather than a Render 404.

No custom-domain move is needed when replacing the frontend on the existing main static site. Existing CORS permits the main Render origin and `https://erp.ltabmcorp.com`. If using a different custom domain, add its exact origin to API configuration before testing it.

## 6. Verify and reopen access

Run **Deploy Production** again with `action: verify` and the same `revision`. Or run locally:

```sh
EXPECTED_COMMIT=<full-reviewed-SHA> EXPECTED_SUPABASE_URL=https://nohelmujoswmmqedgern.supabase.co npm run smoke:main
```

This check uses GET requests only. It verifies the React shell, built script assets, deep-link fallback, built API target, commit metadata, backend health/readiness, and browser-safe public configuration. It does not sign in or create ledger records.

Then perform the accepted staging QA journeys with an Admin and a staff account: login/session refresh; entity switching and denials; work-request/task creation review; document upload and protected deletion; invoice edits and PDF; client-fund invoice/voucher lifecycle; receipt paste/download; and role-based draft visibility. Reopen user access after those pass. Keep automatic deploys off until a future release process coordinates schema, API, and SPA changes.

If verification fails, retain maintenance and stop writes. Redeploying the prior frontend alone does not roll back database lifecycle changes. Use the recorded deploy IDs and encrypted backup with the existing rollback runbook; restore a database only through a deliberate recovery decision.

References: [Render deployments](https://render.com/docs/deploys), [Blueprint fields](https://render.com/docs/blueprint-spec), [static-site rewrites](https://render.com/docs/redirects-rewrites), [Supabase API key types](https://supabase.com/docs/guides/getting-started/api-keys).
