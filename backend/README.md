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

### 3. Run locally with Docker Compose

```bash
docker compose up
```

This starts:

- Express API on http://localhost:3000
- PostgreSQL on localhost:5432
- LocalStack S3 on localhost:4566

### 4. Run tests

```bash
npm test
npm run lint
```

### 5. Run migrations

```bash
npm run migrate:up
```

## Project Structure

See `AGENT_MIGRATION_PROMPT_AGENT_A.md` and `AGENT_MIGRATION_PROMPT_AGENT_B.md` for module ownership and phase planning.

## API Documentation

Module README files live under `/backend/src/modules/{module}/README.md`.

## Deployment

The `Dockerfile` is built and pushed to Amazon ECR via CI/CD. ECS Fargate runs the container behind an ALB and API Gateway.
