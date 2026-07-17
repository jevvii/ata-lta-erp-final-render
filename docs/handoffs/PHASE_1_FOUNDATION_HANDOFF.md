# Phase 1 — Foundation Handoff

**Owner**: Agent A / Team A  
**Date**: 2026-07-12  
**Status**: Completed

## What was built

- Express app with Helmet, CORS, rate limiting, request ID, and global error handler.
- Supabase admin client and AWS S3/CloudFront signed URL helpers.
- Authentication middleware (`auth.js`) that verifies Supabase JWT and loads the ERP user profile.
- Entity scoping middleware (`entityScope.js`) enforcing `X-Active-Entity: ATA|LTA`.
- RBAC middleware (`rbac.js`) with `requirePermission()` and wildcard support.
- Audit service + middleware for append-only `audit_logs`.
- `AppError` + RFC 7807 `application/problem+json` error responses.
- `/v1/me` and `/v1/me/permissions` endpoints.
- Foundation migrations: `entities`, `departments`, `users`, `user_departments`, `audit_logs`.
- Seeded `ATA` and `LTA` entities plus all departments.
- Public `/v1/auth/signin` proxy so the SPA can obtain Supabase tokens without exposing the service key.
- Frontend `apiClient.js` and `Auth.login`/`restoreSession` wired to the backend.
- Test harness with a mocked Supabase client and `PORT=0` to avoid port collisions.

## Tests

```bash
cd backend
npm test
```

21 integration + unit tests pass.

## Next steps / blockers

- Agent B can now build on the shared infrastructure.
- Shared file changes require a GitHub issue labeled `shared-change-request`.
- Frontend auth cutover is functional but still falls back to local demo users when the API is unavailable.
