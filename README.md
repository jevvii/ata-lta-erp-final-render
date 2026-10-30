# ATA & LTA ERP

Monorepo for the ATA & LTA accounting firm ERP.

- `backend/` — Express API, Supabase/PostgreSQL, and Supabase Storage.
- `frontend/` — enterprise-v2 React application, served by Vite locally and as static assets in production.
- `erp_prototype/` — retained legacy frontend.
- `render.yaml` — main production API and React static-site configuration.

## Development

```sh
npm run install:all
npm run setup
npm run dev
```

Edit `backend/.env.development` and `frontend/.env.local` after setup. The React UI runs on port 8081. `npm run dev:staging` runs a local API using staging configuration. `npm run dev:main` and `dev:prod` run only the React development server against the remote production API. Those commands use real production data.

Build with an explicit API target using `npm run build:spa:main` or `npm run build:spa:staging`. Direct frontend builds require `ERP_API_BASE_URL` (including `/v1`).

## Deployment

Follow [DEPLOYMENT.md](DEPLOYMENT.md). Releases use an explicit backup/migration step, manual Render API and SPA deployments, and a read-only verification step. Pushes do not run production migrations. Main and staging configurations remain separate.
