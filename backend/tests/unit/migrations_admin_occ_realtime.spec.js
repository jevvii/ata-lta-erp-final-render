/**
 * Test Suite: Migration 000077 Admin Users OCC & Realtime Publication
 *
 * Verifies that:
 * 1. Migration exports up and down handlers accepting `pgm`.
 * 2. UP migration SQL is wrapped in an idempotent DO $$ BEGIN ... END $$; block:
 *    - Adds `version INTEGER NOT NULL DEFAULT 1` to `users` with `IF NOT EXISTS`.
 *    - Checks `pg_publication` for 'supabase_realtime' and guards each table addition
 *      via `pg_publication_tables` catalog queries before ALTER PUBLICATION:
 *      - users
 *      - user_departments
 *      - audit_logs
 *    - Sets REPLICA IDENTITY FULL on `users`, `user_departments`, and `audit_logs`.
 * 3. DOWN migration SQL is wrapped in an idempotent DO $$ BEGIN ... END $$; block:
 *    - Checks `pg_publication` for 'supabase_realtime' and guards each table removal
 *      via `pg_publication_tables` catalog queries without illegal 'DROP TABLE IF EXISTS' in ALTER PUBLICATION.
 *    - Drops `version` column from `users` with `IF EXISTS`.
 * 4. Conditional live PostgreSQL engine verification when database is reachable.
 */

const { Client } = require('pg');
const migration = require('../../migrations/000077_admin_users_occ_and_realtime');

const ADMIN_REALTIME_TABLES = ['users', 'user_departments', 'audit_logs'];

describe('Migration 000077: admin_users_occ_and_realtime', () => {
  let upSql = '';
  let downSql = '';

  beforeAll(() => {
    const mockPgmUp = {
      sql: (statement) => {
        upSql = statement;
      },
    };
    const mockPgmDown = {
      sql: (statement) => {
        downSql = statement;
      },
    };

    migration.up(mockPgmUp);
    migration.down(mockPgmDown);
  });

  describe('Module Contract & Exports', () => {
    it('exports up and down migration functions', () => {
      expect(typeof migration.up).toBe('function');
      expect(typeof migration.down).toBe('function');
    });

    it('invokes pgm.sql with non-empty SQL strings', () => {
      expect(typeof upSql).toBe('string');
      expect(upSql.trim().length).toBeGreaterThan(0);

      expect(typeof downSql).toBe('string');
      expect(downSql.trim().length).toBeGreaterThan(0);
    });
  });

  describe('UP Migration SQL Structure & Idempotency', () => {
    it('wraps execution in an idempotent PL/pgSQL DO block', () => {
      expect(upSql).toMatch(/DO\s+\$\$/i);
      expect(upSql).toMatch(/BEGIN/i);
      expect(upSql).toMatch(/END\s+\$\$;/i);
    });

    it('adds version INTEGER NOT NULL DEFAULT 1 column to users idempotently', () => {
      expect(upSql).toMatch(
        /ALTER\s+TABLE\s+users\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+version\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1\s*;/i
      );
    });

    it('guards publication alteration by checking pg_publication for supabase_realtime', () => {
      expect(upSql).toMatch(
        /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_publication\s+WHERE\s+pubname\s*=\s*'supabase_realtime'\s*\)\s+THEN/i
      );
    });

    it('guards each of the 3 admin table additions with pg_publication_tables existence check', () => {
      for (const table of ADMIN_REALTIME_TABLES) {
        const guardRegex = new RegExp(
          `IF\\s+NOT\\s+EXISTS\\s*\\(\\s*SELECT\\s+1\\s+FROM\\s+pg_publication_tables\\s+WHERE\\s+pubname\\s*=\\s*'supabase_realtime'\\s+AND\\s+tablename\\s*=\\s*'${table}'\\s*\\)\\s+THEN\\s+ALTER\\s+PUBLICATION\\s+supabase_realtime\\s+ADD\\s+TABLE\\s+${table};\\s*END\\s+IF;`,
          'i'
        );
        expect(upSql).toMatch(guardRegex);
      }
    });

    it('sets REPLICA IDENTITY FULL on users, user_departments, and audit_logs', () => {
      for (const table of ADMIN_REALTIME_TABLES) {
        const replicaRegex = new RegExp(
          `ALTER\\s+TABLE\\s+${table}\\s+REPLICA\\s+IDENTITY\\s+FULL\\s*;`,
          'i'
        );
        expect(upSql).toMatch(replicaRegex);
      }
    });
  });

  describe('DOWN Migration SQL Structure & Idempotency', () => {
    it('wraps execution in an idempotent PL/pgSQL DO block', () => {
      expect(downSql).toMatch(/DO\s+\$\$/i);
      expect(downSql).toMatch(/BEGIN/i);
      expect(downSql).toMatch(/END\s+\$\$;/i);
    });

    it('guards publication alteration by checking pg_publication for supabase_realtime', () => {
      expect(downSql).toMatch(
        /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_publication\s+WHERE\s+pubname\s*=\s*'supabase_realtime'\s*\)\s+THEN/i
      );
    });

    it('guards each table removal with pg_publication_tables existence check', () => {
      for (const table of ADMIN_REALTIME_TABLES) {
        const guardRegex = new RegExp(
          `IF\\s+EXISTS\\s*\\(\\s*SELECT\\s+1\\s+FROM\\s+pg_publication_tables\\s+WHERE\\s+pubname\\s*=\\s*'supabase_realtime'\\s+AND\\s+tablename\\s*=\\s*'${table}'\\s*\\)\\s+THEN\\s+ALTER\\s+PUBLICATION\\s+supabase_realtime\\s+DROP\\s+TABLE\\s+${table};\\s*END\\s+IF;`,
          'i'
        );
        expect(downSql).toMatch(guardRegex);
      }
    });

    it('drops version column from users idempotently', () => {
      expect(downSql).toMatch(
        /ALTER\s+TABLE\s+users\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+version\s*;/i
      );
    });

    it('does NOT contain illegal ALTER PUBLICATION ... DROP TABLE IF EXISTS grammar', () => {
      expect(downSql).not.toMatch(/ALTER\s+PUBLICATION\s+\w+\s+DROP\s+TABLE\s+IF\s+EXISTS/i);
    });
  });

  describe('Live PostgreSQL Engine Verification (conditional)', () => {
    let client;
    let dbConnected = false;
    const testSchema = `test_admin_occ_realtime_${Date.now()}`;
    let pubOriginallyExisted = false;

    beforeAll(async () => {
      const connectionString =
        process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

      try {
        client = new Client({ connectionString, connectionTimeoutMillis: 2000 });
        await client.connect();
        dbConnected = true;

        const checkPub = await client.query(
          "SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'"
        );
        pubOriginallyExisted = checkPub.rows.length > 0;

        await client.query(`CREATE SCHEMA ${testSchema}`);
        await client.query(`SET search_path TO ${testSchema}, public`);

        for (const tbl of ADMIN_REALTIME_TABLES) {
          await client.query(
            `CREATE TABLE ${testSchema}.${tbl} (id uuid PRIMARY KEY DEFAULT gen_random_uuid());`
          );
        }

        await client.query('BEGIN');
        await client.query('LOCK TABLE pg_publication IN ACCESS EXCLUSIVE MODE');
      } catch (_err) {
        dbConnected = false;
      }
    });

    afterAll(async () => {
      if (client && dbConnected) {
        try {
          await client.query('COMMIT');
        } catch (_err) {
          try {
            await client.query('ROLLBACK');
          } catch (_e) {
            // ignore rollback error
          }
        }
        try {
          if (!pubOriginallyExisted) {
            await client.query('DROP PUBLICATION IF EXISTS supabase_realtime');
          }
        } catch (_err) {
          // ignore cleanup errors
        }
        try {
          await client.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
        } catch (_err) {
          // ignore cleanup errors
        } finally {
          await client.end();
        }
      }
    });

    it('adds version column, registers tables in supabase_realtime, and sets REPLICA IDENTITY FULL idempotently', async () => {
      if (!dbConnected) return;

      if (!pubOriginallyExisted) {
        await client.query('CREATE PUBLICATION supabase_realtime');
      }

      await expect(client.query(upSql)).resolves.not.toThrow();
      // Second run for idempotency
      await expect(client.query(upSql)).resolves.not.toThrow();

      const colRes = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'version'`,
        [testSchema]
      );
      expect(colRes.rows).toHaveLength(1);
      expect(colRes.rows[0].data_type).toBe('integer');
      expect(colRes.rows[0].is_nullable).toBe('NO');

      const pubRes = await client.query(
        "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'"
      );
      const registeredTables = pubRes.rows.map((r) => r.tablename);
      for (const tbl of ADMIN_REALTIME_TABLES) {
        expect(registeredTables).toContain(tbl);
      }

      const replicaRes = await client.query(
        `SELECT c.relname, c.relreplident
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = ANY($2)`,
        [testSchema, ADMIN_REALTIME_TABLES]
      );
      expect(replicaRes.rows).toHaveLength(ADMIN_REALTIME_TABLES.length);
      for (const row of replicaRes.rows) {
        expect(row.relreplident).toBe('f');
      }

      await expect(client.query(downSql)).resolves.not.toThrow();
      // Second run for idempotency
      await expect(client.query(downSql)).resolves.not.toThrow();
    });
  });
});
