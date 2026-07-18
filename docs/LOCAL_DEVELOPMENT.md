# Local Development Guide

This document describes how to run the full ATA & LTA ERP stack locally for
development and smoke testing before pushing changes to the UAT CI/CD pipeline.

## Overview

The project is organized as a small monorepo:

```
.
├── backend/          Node.js / Express API
├── erp_prototype/    Plain HTML/JS SPA frontend
├── scripts/          Shared dev / smoke-test helpers
└── docker-compose.dev.yml   Optional containerized stack
```

## Environment model

We follow a simple `local → uat → prod` progression while staying inside free
 tiers:

| Environment | Backend target                | Frontend dev server | Purpose                  |
|-------------|-------------------------------|---------------------|--------------------------|
| `local`     | `http://localhost:3000/v1`    | `http://localhost:8080` | Daily feature work       |
| `uat`       | `https://ata-lta-erp-api-uat.onrender.com/v1` | `http://localhost:8080` | Pre-render validation    |
| `prod`      | `https://ata-lta-erp-api.onrender.com/v1`     | `http://localhost:8080` | Production spot-checks   |

The local backend can safely point to the **same remote Supabase project** used
by UAT. Because the local API is a separate process, you can change backend code
and immediately see the result in the local SPA without redeploying to Render.

If you want data isolation (e.g., to experiment with destructive migrations),
create a separate free-tier Supabase project and point `backend/.env.development`
at it.

## Quick start

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Create environment files

```bash
npm run setup
```

This copies the `.env.*.example` templates to their working counterparts
without overwriting existing files.

### 3. Configure Supabase credentials

Edit `backend/.env.development`:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
SUPABASE_STORAGE_BUCKET=ata-lta-erp-documents-dev
DATABASE_URL=postgresql://postgres:[password]@db.xxxx.supabase.co:5432/postgres
FRONTEND_URL=http://localhost:8080
```

Values can be copied from the Supabase dashboard or from the Render UAT
environment group if you want to share the project for dev work.

### 4. Apply migrations and seed data

With `backend/.env.development` pointing at your remote Supabase database:

```bash
cd backend
npm run migrate:remote
```

This applies all `.js` and `.sql` migrations in numeric order, then applies the
SQL files in `backend/seeds/`. Progress is tracked in a `remote_migrations` table
so reruns are idempotent.

### 5. Create the Supabase Storage bucket

The app stores documents and generated PDFs in Supabase Storage. Create the
bucket from the terminal:

```bash
cd backend
npm run create-bucket
```

Then open the Supabase dashboard, go to Storage → Policies, and add a policy
that lets authenticated users upload/download objects in the bucket.

### 6. Start the full local stack

From the repository root:

```bash
npm run dev
```

This starts:

- Backend API at the port configured in `backend/.env.development` (default 3000)
- SPA dev server at `http://localhost:8080`, automatically pointed at the backend's actual port

Both processes are prefixed in the terminal. Press `Ctrl+C` once to stop both.

If your backend uses a non-default port (e.g., `PORT=3001`), the orchestrator
reads it from `backend/.env.development` and injects the matching
`ERP_API_BASE_URL` into the SPA dev server, so the frontend and smoke test both
target the correct backend.

## Targeting other environments

### UAT

```bash
npm run dev:uat
```

The SPA dev server will inject the Render UAT backend URL, while the backend
process starts using `backend/.env.uat`. Make sure that file contains the UAT
Supabase credentials, or export them in your shell before starting.

### Production

```bash
npm run dev:prod
```

## Manual component startup

If you prefer to start services individually:

```bash
# Terminal 1 — backend (local)
npm run dev:backend

# Terminal 2 — frontend (local API)
npm run dev:frontend

# Terminal 2 — frontend (UAT API)
npm run dev:frontend:uat   # not provided by default; set ERP_API_BASE_URL manually
```

## Optional Docker stack

```bash
docker compose -f docker-compose.dev.yml up --build
```

This brings up the API and the SPA dev server in containers. You still need a
valid Supabase URL/key in `backend/.env.development`.

## Smoke testing (no Playwright)

Verify the local stack without a browser:

```bash
# With the full stack running
npm run smoke
```

This checks:

- SPA dev server health
- `env.js` is injecting the correct backend URL
- `index.html` loads the app shell
- Local backend `/health` responds when the SPA targets `localhost:3000`

To smoke-test against UAT without starting the local backend:

```bash
npm run smoke:uat
```

## Build artifacts for deployment

The SPA still supports the Render build flow:

```bash
# Local/build pipeline default
cd erp_prototype && npm run build

# UAT
cd erp_prototype && npm run build:uat
```

These generate `erp_prototype/env.js`, which is gitignored.

## Troubleshooting

### Backend fails with "SUPABASE_URL and SUPABASE_SERVICE_KEY are required"

You have not created `backend/.env.development` or it is missing those keys.
Run `npm run setup` and fill in the file.

### Frontend calls the wrong backend

The SPA reads the backend URL from `window.__ERP_API_BASE_URL__`, which is set
by the dev server or by `build.js`. When using the dev server, set
`ERP_API_BASE_URL` in `erp_prototype/.env` or on the command line.

### `npm run dev:uat` cannot find UAT credentials

`backend/.env.uat` must contain the real Supabase URL/key, or those variables
must be exported in your shell. Render injects them automatically on UAT deploys,
but locally you must supply them.

### Port conflicts

If you see `EADDRINUSE: address already in use 127.0.0.1:8080`, another process
is using port 8080. Common culprits are another `dev-server.js` instance, a
Docker container, or a different project.

To use a different port for the SPA:

```bash
PORT=8081 npm run dev
```

The orchestrator forwards `PORT` to the SPA dev server. The backend stays on
port 3000 unless you also override it:

```bash
PORT=8081 npm run dev              # SPA on 8081, backend on 3000
PORT=8081 PORT_API=4000 npm run dev # not supported; start services separately
```

If you need both ports changed, start the services individually:

```bash
# Terminal 1
PORT=4000 npm run dev:backend

# Terminal 2
PORT=8081 ERP_API_BASE_URL=http://localhost:4000/v1 npm run dev:frontend
```

To find what is using a port:

```bash
# Linux
lsof -i :8080
# or
ss -tlnp | grep :8080
```
