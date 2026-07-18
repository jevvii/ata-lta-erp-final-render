# ATA & LTA ERP Backend

Node.js / Express modular monolith for the ATA & LTA accounting firm ERP.

## Stack

- **Runtime**: Node.js 20
- **Framework**: Express 4
- **Database/Auth**: Supabase PostgreSQL + Supabase Auth
- **Object Storage**: AWS S3 + CloudFront signed URLs
- **Deployment**: AWS ECS Fargate + ALB + API Gateway
- **Migrations**: `node-pg-migrate`
- **Testing**: Jest + Supertest

## Getting Started

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in Supabase and AWS credentials.
```

### 3. Run locally (non-Docker)

```bash
# Local dev environment (uses .env.development)
npm run dev:local

# UAT spot-check (uses .env.uat)
npm run dev:uat
```

### 4. Run locally with Docker Compose

```bash
# Ensure backend/.env.development is created from .env.development.example first.
docker compose up
```

This starts:

- Express API on http://localhost:3000
- PostgreSQL on localhost:5432

Supabase Auth/Storage must be provided separately (Supabase CLI local or a
dedicated free-tier Supabase project).

### 5. Run tests

```bash
npm test
npm run lint
```

### 6. Run migrations

```bash
npm run migrate:up
```

When using Supabase CLI local, override `DATABASE_URL`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres npm run migrate:up
```

## Project Structure

See `AGENT_MIGRATION_PROMPT_AGENT_A.md` and `AGENT_MIGRATION_PROMPT_AGENT_B.md` for module ownership and phase planning.

## API Documentation

Module README files live under `/backend/src/modules/{module}/README.md`.

## Deployment

The backend is deployed to Render as a Docker web service. See the root
`render.yaml` and `docs/LOCAL_DEVELOPMENT.md` for environment details.
