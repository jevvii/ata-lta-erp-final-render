# Work Request 500 Error on Create — Diagnostic & Fix

**Date:** 2026-07-20
**Branch:** uat
**Status:** Migration applied to UAT — backend restart required

---

## Error

```
POST http://localhost:3001/v1/work-requests
HTTP/1.1 500 Internal Server Error
Error: Unable to create work request
```

---

## Root Cause

The backend server is running the **updated** code that expects the `priority`
column, but the database it is connected to does **not** have the `priority` column
yet. PostgreSQL returns a 500 when the app tries to insert `priority` into a
non-existent column.

Evidence:

- If the server were still running the old code, it would ignore `priority` and
  return `200`.
- A 500 on `POST /v1/work-requests` after the recent changes almost always means
  the migration has not been applied to the live database.

---

## Required Fix

### Step 1 — Find which database the running server uses

The server is on port `3001`, so check its environment. In the terminal where
`npm run dev` / `node src/app.js` is running, look for:

```bash
DATABASE_URL=...
SUPABASE_URL=...
```

Or check the process:

```bash
ps aux | grep "node src/app.js"
cat /proc/$(pgrep -f "node src/app.js")/environ 2>/dev/null | tr '\0' '\n' | grep -E "DATABASE_URL|SUPABASE|PORT"
```

### Step 2 — Apply the migration to that database

> ⚠️ **Important:** `npm run migrate:up` (local node-pg-migrate) is **not** the
> right command for this project because the migration folder mixes custom
> `migrate-remote.js` SQL/JS files with node-pg-migrate files. The local runner
> tries to re-apply already-applied migrations and fails on `019a_rename_s3_key...`.
>
> Use the **custom remote runner** (`migrate:remote:uat`) even for the local dev
> server, because that is what has been tracking the UAT database state.

If using Supabase UAT (your current setup):

```bash
cd /home/javvii/FreelanceProject/Project4_Final-Render/backend
# .env.uat should already contain SUPABASE_URL and SUPABASE_SERVICE_KEY
npm run migrate:remote:uat
```

If you need to point it at a different Supabase project:

```bash
cd /home/javvii/FreelanceProject/Project4_Final-Render/backend
export SUPABASE_URL="https://xxxx.supabase.co"
export SUPABASE_SERVICE_KEY="eyJ..."
npm run migrate:remote
```

The migration that must be applied is:

- `backend/migrations/000029_add_work_request_priority.js`

It adds:

```sql
ALTER TABLE work_requests ADD COLUMN priority varchar(50) NOT NULL DEFAULT 'Normal';
```

### Step 3 — Restart the backend server

After the migration succeeds, restart so the app reconnects cleanly:

```bash
# stop the current server (Ctrl+C) then:
npm run dev     # local
npm run dev:uat # UAT
```

### Step 4 — Clear the browser / service worker cache

After restart, unregister the service worker and hard refresh:

- DevTools → Application → Service Workers → Unregister
- Ctrl+Shift+R (or Cmd+Shift+R on Mac)

---

## How to Verify

1. Open DevTools → Network.
2. Create a work request.
3. The `POST /v1/work-requests` should return `201`.
4. The response body should contain `"priority": "Priority"` (or whatever was selected).
5. Navigate to another page and back — the item should still be visible.

---

## If the Error Persists After Migration

Check the backend logs for the exact error. Run the server with verbose logging:

```bash
LOG_LEVEL=debug npm run dev
```

Then reproduce the 500 and look for the PostgreSQL error code. Common causes:

- Migration applied to the wrong database (server is still pointed at the old one).
- Migration failed silently and the column is still missing.
- The `node-pg-migrate` migration table (`pgmigrations`) is out of sync.

To force a re-run of the priority migration (dangerous — only on dev/UAT):

```bash
# For the custom remote runner, the tracker is remote_migrations, not pgmigrations.
# Run this in the Supabase SQL Editor:
DELETE FROM remote_migrations WHERE name = '000029_add_work_request_priority';
-- Then re-run from the CLI:
npm run migrate:remote:uat
```

---

## Notes

- No frontend code changes are needed for this error.
- The cache-busting and optimistic-record fixes from earlier are still in place and
  will prevent the item from disappearing after navigation once the 500 is fixed.
- The migration file was updated to use the custom runner's API (`pgm.addColumns`
  and `pgm.dropColumns`) instead of the node-pg-migrate API (`pgm.addColumn` / `pgm.dropColumn`).
