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

```bash
cd backend
npm run migrate:up
```

Seed SQL files live in `backend/seeds/`.

### 5. Start the full local stack

From the repository root:

```bash
npm run dev
```

This starts:

- Backend API at `http://localhost:3000`
- SPA dev server at `http://localhost:8080` (already pointed at the local API)

Both processes are prefixed in the terminal. Press `Ctrl+C` once to stop both.

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

Both services print the ports they bind to. To override:

```bash
PORT=4000 npm run dev:backend       # backend
PORT=8090 npm run dev:frontend      # frontend
```
