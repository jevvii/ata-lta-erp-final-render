# ATA & LTA ERP

Monorepo for the ATA & LTA accounting firm ERP.

- `backend/` — Node.js / Express API (Supabase + PostgreSQL + Supabase Storage)
- `erp_prototype/` — Plain HTML/JS single-page application frontend
- `render.yaml` — Render Blueprint for the UAT environment

## Quick start

```bash
# Install all dependencies
npm run install:all

# Bootstrap environment files from templates
npm run setup

# Start the full local stack
npm run dev
```

See [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md) for the complete
toggleable development environment guide, including UAT/prod spot-checks,
Docker stack, and non-Playwright smoke testing.

## Deployment

UAT is deployed automatically via Render using `render.yaml` on the `uat`
branch. Production uses the same blueprint on the `main` branch with the
appropriate environment group.
