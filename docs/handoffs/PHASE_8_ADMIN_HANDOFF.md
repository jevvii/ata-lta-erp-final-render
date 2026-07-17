# Phase 8 — Admin / Users + Pending Approvals Handoff

**Owner**: Agent A / Team A  
**Date**: 2026-07-12  
**Status**: Completed

## What was built

- Migration: `pending_changes`.
- Admin users CRUD under `/v1/admin/users`.
  - `POST` creates a Supabase Auth user + ERP profile.
  - `PUT` updates profile, entities, departments, and active status.
  - `DELETE` is a soft disable (`is_active = false`).
- Pending approvals endpoints under `/v1/admin/pending-approvals`.
  - Supports approve/reject with audit logging.
  - Applies approved client and work-request changes via the existing services.
- RBAC: `users:view`, `users:manage`, `approve_change:*`.
- API contract published in `/docs/api-contracts/agent-a-contracts.md`.
- Frontend `Auth.login` and `Auth.restoreSession` now use the backend `/v1/auth/signin` and `/v1/me` endpoints, with localStorage fallback.

## Tests

```bash
cd backend
npm test -- tests/integration/admin.test.js
```

## Known limitations

- Pending approvals currently auto-apply only `clients` and `work_requests` tables.
- Password reset / invite email flow uses Supabase defaults.
