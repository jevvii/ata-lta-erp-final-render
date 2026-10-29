/**
 * Migration 000077: Admin Users Optimistic Concurrency Control & Realtime Publication
 *
 * 1. Adds `version INTEGER NOT NULL DEFAULT 1` to `users` for Optimistic Concurrency Control (OCC).
 * 2. Adds admin & RBAC tables to the `supabase_realtime` publication for real-time change data
 *    capture (CDC) over WebSockets:
 *    - users
 *    - user_departments
 *    - audit_logs
 * 3. Sets REPLICA IDENTITY FULL on `users`, `user_departments`, and `audit_logs` so PostgreSQL
 *    logical replication includes the complete previous row (`payload.old`) on UPDATE and DELETE.
 *
 * Both up and down migrations are idempotent:
 * - Protected by DO $$ BEGIN ... END $$;
 * - Checks pg_publication for existence of 'supabase_realtime'
 * - Checks pg_publication_tables before adding or dropping tables
 * - Uses IF NOT EXISTS / IF EXISTS guards on column alterations
 *
 * @type {import('node-pg-migrate').Migration}
 */

exports.up = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

      IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'users') THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE users;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'user_departments') THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE user_departments;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'audit_logs') THEN
          ALTER PUBLICATION supabase_realtime ADD TABLE audit_logs;
        END IF;
      END IF;

      ALTER TABLE users REPLICA IDENTITY FULL;
      ALTER TABLE user_departments REPLICA IDENTITY FULL;
      ALTER TABLE audit_logs REPLICA IDENTITY FULL;
    END
    $$;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'users') THEN
          ALTER PUBLICATION supabase_realtime DROP TABLE users;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'user_departments') THEN
          ALTER PUBLICATION supabase_realtime DROP TABLE user_departments;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'audit_logs') THEN
          ALTER PUBLICATION supabase_realtime DROP TABLE audit_logs;
        END IF;
      END IF;

      ALTER TABLE users DROP COLUMN IF EXISTS version;
    END
    $$;
  `);
};
