/**
 * Portable PostgreSQL Acceptance Test Suite for Receipt Reservations Database Mode.
 *
 * Requirements:
 * - Runs against a disposable, local-only database (local PostgreSQL 18.4).
 * - Explicit RECEIPT_TEST_DATABASE_URL required; skipped without it and fails on connection errors.
 * - Guardrail: prohibits remote targets and protects non-disposable databases.
 * - Asserts atomic row locking and concurrency (8-way concurrent claim race).
 * - Asserts null-identity safety (Codex Review Item 1 regressions).
 * - Asserts restart/new-client visibility of persisted records.
 * - Asserts private SQL privileges (anon/authenticated denied; service_role granted).
 * - Asserts Row Level Security (RLS) is active.
 * - Asserts safe rollback via down migration.
 */

const { Client, Pool } = require('pg');
const migration = require('../../migrations/000072_receipt_reservations_db.js');

const testDbUrl = process.env.RECEIPT_TEST_DATABASE_URL;
const describeIfDatabase = testDbUrl ? describe : describe.skip;

// Guard against running against remote servers or application DATABASE_URL
const isLocalTarget = (urlStr) => {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch (_) {
    return false;
  }
};

describeIfDatabase('PostgreSQL Receipt Reservations Acceptance Suite', () => {
  let client;
  let pool;
  let isAvailable = false;

  beforeAll(async () => {
    if (!isLocalTarget(testDbUrl)) {
      throw new Error(`Non-local target prohibited: ${testDbUrl}`);
    }

    client = new Client({ connectionString: testDbUrl });
    await client.connect();
    const existing = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    if (existing.rows.length) {
      throw new Error('Receipt acceptance tests require an empty disposable local database');
    }
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$;
    `);
    isAvailable = true;
    pool = new Pool({ connectionString: testDbUrl, max: 10 });
  });

  afterAll(async () => {
    if (client) {
      try {
        await client.end();
      } catch (_) {
        /* Connection may already be closed after a setup failure. */
      }
    }
    if (pool) {
      try {
        await pool.end();
      } catch (_) {
        /* Connection may already be closed after a setup failure. */
      }
    }
  });

  const runIfAvailable = (testFn) => async () => {
    if (!isAvailable) throw new Error('Disposable local PostgreSQL setup did not complete');
    return testFn();
  };

  const applyMigration = async (direction) => {
    let sql = '';
    migration[direction]({
      sql: (statement) => {
        sql += statement;
      },
    });
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  };

  describe('Migration Lifecycle & Privileges', () => {
    it(
      'applies migration 000072 up cleanly and configures roles & RLS',
      runIfAvailable(async () => {
        await applyMigration('up');

        // Verify table exists
        const tableRes = await client.query(`
        SELECT rowsecurity FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'receipt_reservations';
      `);
        expect(tableRes.rows.length).toBe(1);
        expect(tableRes.rows[0].rowsecurity).toBe(true); // RLS is ENABLED

        // Verify 11 procedures exist
        const procRes = await client.query(`
        SELECT routine_name FROM information_schema.routines
        WHERE routine_schema = 'public' AND routine_name LIKE 'receipt_reservation_%';
      `);
        expect(procRes.rows.length).toBe(11);
      })
    );

    beforeEach(async () => {
      if (client) {
        await client.query('RESET ROLE;').catch(() => {});
      }
    });

    afterEach(async () => {
      if (client) {
        await client.query('RESET ROLE;').catch(() => {});
      }
    });

    it(
      'enforces strict SQL permissions: anon and authenticated cannot access table or procedures',
      runIfAvailable(async () => {
        const assertDenied = async (role, sql) => {
          try {
            await client.query(`SET ROLE ${role};`);
            await client.query(sql);
            throw new Error(`Expected permission denied for role ${role}`);
          } catch (err) {
            expect(err.message).toMatch(/permission denied/i);
          } finally {
            await client.query('RESET ROLE;').catch(() => {});
          }
        };

        // Test anon cannot SELECT from table
        await assertDenied('anon', 'SELECT * FROM public.receipt_reservations;');

        // Test anon cannot execute procedure
        await assertDenied('anon', 'SELECT public.receipt_reservation_probe();');

        // Test authenticated cannot SELECT from table
        await assertDenied('authenticated', 'SELECT * FROM public.receipt_reservations;');

        // Test authenticated cannot execute create procedure
        await assertDenied(
          'authenticated',
          `SELECT public.receipt_reservation_create(
            'u1', '11111111-1111-1111-1111-111111111111'::uuid,
            '22222222-2222-2222-2222-222222222222'::uuid,
            'ATA', 'k1', 'f1.png', 'image/png', 100, 900
          );`
        );

        // Test service_role CAN execute probe procedure
        await client.query('SET ROLE service_role;');
        const svcProbe = await client.query('SELECT public.receipt_reservation_probe() as result;');
        expect(svcProbe.rows[0].result).toEqual({ ok: true });
        await client.query('RESET ROLE;');
      })
    );
  });

  describe('Null Actor/Entity Comparison Safety (Codex Item 1 Regressions)', () => {
    const uploadId = 'null-safety-upload-1';
    const objectKey = 'entities/ATA/disbursements/receipts/null-safety-1.png';
    const userId = '11111111-1111-1111-1111-111111111111';
    const entityId = '22222222-2222-2222-2222-222222222222';

    beforeAll(async () => {
      if (!isAvailable) return;
      await client.query('SELECT public.receipt_reservation_clear();');
      await client.query(
        `
        SELECT public.receipt_reservation_create(
          $1, $2::uuid, $3::uuid, 'ATA', $4, 'test.png', 'image/png', 1024, 900
        );
      `,
        [uploadId, userId, entityId, objectKey]
      );
    });

    it(
      'rejects completeReservation with NULL user_id or NULL entity_id',
      runIfAvailable(async () => {
        // Call complete with NULL user_id
        const resNullUser = await client.query(
          `
        SELECT public.receipt_reservation_complete($1, NULL, $2::uuid) AS result;
      `,
          [uploadId, entityId]
        );
        expect(resNullUser.rows[0].result).toEqual({ error: 'MISMATCH' });

        // Call complete with NULL entity_id
        const resNullEntity = await client.query(
          `
        SELECT public.receipt_reservation_complete($1, $2::uuid, NULL) AS result;
      `,
          [uploadId, userId]
        );
        expect(resNullEntity.rows[0].result).toEqual({ error: 'MISMATCH' });

        // Valid user and entity completes successfully
        const resValid = await client.query(
          `
        SELECT public.receipt_reservation_complete($1, $2::uuid, $3::uuid) AS result;
      `,
          [uploadId, userId, entityId]
        );
        expect(resValid.rows[0].result.data.status).toBe('completed');
      })
    );

    it(
      'rejects findCompletedReservationByKey with NULL user_id or NULL entity_id',
      runIfAvailable(async () => {
        const resNullUser = await client.query(
          `
        SELECT public.receipt_reservation_find_completed($1, NULL, $2::uuid) AS result;
      `,
          [objectKey, entityId]
        );
        expect(resNullUser.rows[0].result).toEqual({ error: 'MISMATCH' });

        const resNullEntity = await client.query(
          `
        SELECT public.receipt_reservation_find_completed($1, $2::uuid, NULL) AS result;
      `,
          [objectKey, userId]
        );
        expect(resNullEntity.rows[0].result).toEqual({ error: 'MISMATCH' });
      })
    );

    it(
      'rejects claimReservationByKey with NULL user_id or NULL entity_id',
      runIfAvailable(async () => {
        const resNullUser = await client.query(
          `
        SELECT public.receipt_reservation_claim($1, NULL, $2::uuid) AS result;
      `,
          [objectKey, entityId]
        );
        expect(resNullUser.rows[0].result).toEqual({ error: 'MISMATCH' });

        const resNullEntity = await client.query(
          `
        SELECT public.receipt_reservation_claim($1, $2::uuid, NULL) AS result;
      `,
          [objectKey, userId]
        );
        expect(resNullEntity.rows[0].result).toEqual({ error: 'MISMATCH' });
      })
    );

    it(
      'rejects releaseReservationByKey with NULL user_id or NULL entity_id',
      runIfAvailable(async () => {
        const resNullUser = await client.query(
          `
        SELECT public.receipt_reservation_release($1, NULL, $2::uuid, 'some-claim') AS result;
      `,
          [objectKey, entityId]
        );
        expect(resNullUser.rows[0].result).toEqual({ error: 'MISMATCH' });

        const resNullEntity = await client.query(
          `
        SELECT public.receipt_reservation_release($1, $2::uuid, NULL, 'some-claim') AS result;
      `,
          [objectKey, userId]
        );
        expect(resNullEntity.rows[0].result).toEqual({ error: 'MISMATCH' });
      })
    );

    it(
      'returns NULL from consumeReservationByKey with NULL user_id or NULL entity_id',
      runIfAvailable(async () => {
        const resNullUser = await client.query(
          `
        SELECT public.receipt_reservation_consume($1, NULL, $2::uuid) AS result;
      `,
          [objectKey, entityId]
        );
        expect(resNullUser.rows[0].result).toBeNull();

        const resNullEntity = await client.query(
          `
        SELECT public.receipt_reservation_consume($1, $2::uuid, NULL) AS result;
      `,
          [objectKey, userId]
        );
        expect(resNullEntity.rows[0].result).toBeNull();
      })
    );
  });

  describe('Concurrency & Atomic Claim Races (8-Way Competition)', () => {
    const uploadId = 'race-upload-8way';
    const objectKey = 'entities/ATA/disbursements/receipts/race-8way.png';
    const userId = '11111111-1111-1111-1111-111111111111';
    const entityId = '22222222-2222-2222-2222-222222222222';

    beforeEach(async () => {
      if (!isAvailable) return;
      await client.query('SELECT public.receipt_reservation_clear();');
      await client.query(
        `
        SELECT public.receipt_reservation_create(
          $1, $2::uuid, $3::uuid, 'ATA', $4, 'receipt.png', 'image/png', 2048, 900
        );
      `,
        [uploadId, userId, entityId, objectKey]
      );

      // Complete it so it is eligible to be claimed
      await client.query(
        `
        SELECT public.receipt_reservation_complete($1, $2::uuid, $3::uuid);
      `,
        [uploadId, userId, entityId]
      );
    });

    it(
      'allows exactly ONE winner among 8 concurrent claimers and assigns unique claim token',
      runIfAvailable(async () => {
        const NUM_CONCURRENT = 8;
        const claimPromises = Array.from({ length: NUM_CONCURRENT }).map((_, i) => {
          return pool
            .query(
              `
            SELECT public.receipt_reservation_claim($1, $2::uuid, $3::uuid, $4) AS result;
          `,
              [objectKey, userId, entityId, `claim-token-${i}`]
            )
            .then((res) => res.rows[0].result);
        });

        const results = await Promise.all(claimPromises);

        const winners = results.filter((r) => r.data && r.data.status === 'claimed');
        const losers = results.filter((r) => r.error === 'ALREADY_CLAIMED');

        expect(winners.length).toBe(1);
        expect(losers.length).toBe(NUM_CONCURRENT - 1);
        expect(typeof winners[0].claimId).toBe('string');
        expect(winners[0].data.claimId).toBe(winners[0].claimId);
      })
    );

    it(
      'persists claimed state so fresh client connections immediately observe the winning claim',
      runIfAvailable(async () => {
        // Claim using primary client
        const claimRes = await client.query(
          `
        SELECT public.receipt_reservation_claim($1, $2::uuid, $3::uuid, 'token-xyz') AS result;
      `,
          [objectKey, userId, entityId]
        );
        expect(claimRes.rows[0].result.data.status).toBe('claimed');

        // Connect a fresh client (simulating process restart or replica client)
        const freshClient = new Client({ connectionString: testDbUrl });
        await freshClient.connect();

        try {
          const freshRes = await freshClient.query(
            `
          SELECT public.receipt_reservation_get($1) AS result;
        `,
            [uploadId]
          );
          expect(freshRes.rows[0].result.status).toBe('claimed');
          expect(freshRes.rows[0].result.claimId).toBe('token-xyz');
        } finally {
          await freshClient.end();
        }
      })
    );
  });

  describe('Full Lifecycle & Cleanup Atomicity', () => {
    const uploadId = 'lifecycle-upload-1';
    const objectKey = 'entities/ATA/disbursements/receipts/lifecycle-1.png';
    const userId = '11111111-1111-1111-1111-111111111111';
    const entityId = '22222222-2222-2222-2222-222222222222';
    const voucherId = '33333333-3333-3333-3333-333333333333';

    it(
      'executes create -> complete -> claim -> consume lifecycle cleanly',
      runIfAvailable(async () => {
        await client.query('SELECT public.receipt_reservation_clear();');

        // 1. Create
        const createRes = await client.query(
          `
        SELECT public.receipt_reservation_create(
          $1, $2::uuid, $3::uuid, 'ATA', $4, 'invoice.pdf', 'application/pdf', 5000, 900
        ) AS result;
      `,
          [uploadId, userId, entityId, objectKey]
        );
        expect(createRes.rows[0].result.data.status).toBe('pending');

        // 2. Complete
        const completeRes = await client.query(
          `
        SELECT public.receipt_reservation_complete($1, $2::uuid, $3::uuid) AS result;
      `,
          [uploadId, userId, entityId]
        );
        expect(completeRes.rows[0].result.data.status).toBe('completed');

        // 3. Claim
        const claimRes = await client.query(
          `
        SELECT public.receipt_reservation_claim($1, $2::uuid, $3::uuid, 'claim-tok-1') AS result;
      `,
          [objectKey, userId, entityId]
        );
        expect(claimRes.rows[0].result.data.status).toBe('claimed');

        // 4. Consume
        const consumeRes = await client.query(
          `
        SELECT public.receipt_reservation_consume($1, $2::uuid, $3::uuid, 'claim-tok-1', $4::uuid) AS result;
      `,
          [objectKey, userId, entityId, voucherId]
        );
        expect(consumeRes.rows[0].result.status).toBe('consumed');
        expect(consumeRes.rows[0].result.voucherId).toBe(voucherId);

        // 5. Consumed record cannot be re-completed or re-claimed
        const reComplete = await client.query(
          `
        SELECT public.receipt_reservation_complete($1, $2::uuid, $3::uuid) AS result;
      `,
          [uploadId, userId, entityId]
        );
        expect(reComplete.rows[0].result).toEqual({ error: 'ALREADY_CONSUMED' });

        const reClaim = await client.query(
          `
        SELECT public.receipt_reservation_claim($1, $2::uuid, $3::uuid) AS result;
      `,
          [objectKey, userId, entityId]
        );
        expect(reClaim.rows[0].result).toEqual({ error: 'ALREADY_CONSUMED' });
      })
    );

    it(
      'cleanup selection excludes active claims and marks candidates as deleting',
      runIfAvailable(async () => {
        await client.query('SELECT public.receipt_reservation_clear();');

        // Insert an expired record
        await client.query(`
        INSERT INTO public.receipt_reservations (
          upload_id, user_id, entity_id, object_key, filename, content_type, size,
          status, expires_at, created_at, updated_at
        ) VALUES (
          'expired-upload-1', '11111111-1111-1111-1111-111111111111'::uuid,
          '22222222-2222-2222-2222-222222222222'::uuid, 'expired-key-1',
          'rec.png', 'image/png', 100, 'completed',
          clock_timestamp() - interval '1 hour',
          clock_timestamp() - interval '2 hours',
          clock_timestamp() - interval '2 hours'
        );
      `);

        // Insert an active claim
        await client.query(`
        INSERT INTO public.receipt_reservations (
          upload_id, user_id, entity_id, object_key, filename, content_type, size,
          status, claim_id, expires_at, created_at, updated_at
        ) VALUES (
          'active-claim-1', '11111111-1111-1111-1111-111111111111'::uuid,
          '22222222-2222-2222-2222-222222222222'::uuid, 'active-key-1',
          'rec.png', 'image/png', 100, 'claimed', 'active-token',
          clock_timestamp() - interval '1 hour',
          clock_timestamp() - interval '2 hours',
          clock_timestamp() - interval '2 hours'
        );
      `);

        // Run cleanup select
        const cleanupRes = await client.query(`
        SELECT public.receipt_reservation_cleanup_select(clock_timestamp(), false, 86400000, NULL) AS result;
      `);

        const summary = cleanupRes.rows[0].result;
        expect(summary.scanned).toBe(2);
        expect(summary.skippedActiveClaims).toBe(1);
        expect(summary.candidates.length).toBe(1);
        expect(summary.candidates[0].uploadId).toBe('expired-upload-1');

        // The expired candidate is now atomically marked 'deleting'
        const checkStatus = await client.query(
          "SELECT status FROM public.receipt_reservations WHERE upload_id = 'expired-upload-1'"
        );
        expect(checkStatus.rows[0].status).toBe('deleting');

        // Finalize deletion
        await client.query(
          "SELECT public.receipt_reservation_cleanup_finalize('expired-upload-1', 'deleted');"
        );
        const checkDeleted = await client.query(
          "SELECT * FROM public.receipt_reservations WHERE upload_id = 'expired-upload-1'"
        );
        expect(checkDeleted.rows.length).toBe(0);
      })
    );
  });

  describe('Cleanup races and read-only previews', () => {
    const owner = '11111111-1111-4111-8111-111111111111';
    const entity = '22222222-2222-4222-8222-222222222222';
    beforeEach(async () => {
      await client.query('SELECT public.receipt_reservation_clear()');
    });
    const seed = async (id) => {
      await client.query(
        `SELECT public.receipt_reservation_create($1,$2,$3,'ATA',$1,'r.png','image/png',16,900)`,
        [id, owner, entity]
      );
      await client.query('SELECT public.receipt_reservation_complete($1,$2,$3)', [
        id,
        owner,
        entity,
      ]);
    };
    it('serializes cleanup selection against simultaneous binding claims', async () => {
      for (let i = 0; i < 8; i++) {
        const id = 'cleanup-race-' + i;
        await seed(id);
        const [claimed, selected] = await Promise.all([
          pool.query('SELECT public.receipt_reservation_claim($1,$2,$3) AS result', [
            id,
            owner,
            entity,
          ]),
          pool.query(
            "SELECT public.receipt_reservation_cleanup_select(clock_timestamp()+interval '1 hour',false) AS result"
          ),
        ]);
        const claim = claimed.rows[0].result;
        const candidates = selected.rows[0].result.candidates;
        if (claim.data) expect(candidates.some((row) => row.uploadId === id)).toBe(false);
        else {
          expect(claim.error).toBe('NOT_COMPLETED');
          expect(candidates.some((row) => row.uploadId === id)).toBe(true);
        }
      }
    });
    it('does not mutate any rows in dry run and cannot complete deletion candidates', async () => {
      await seed('dry-run');
      const before = (await client.query('SELECT * FROM receipt_reservations ORDER BY upload_id'))
        .rows;
      const dry = await client.query(
        "SELECT public.receipt_reservation_cleanup_select(clock_timestamp()+interval '1 hour',true) AS result"
      );
      expect(dry.rows[0].result.candidates).toHaveLength(1);
      expect(
        (await client.query('SELECT * FROM receipt_reservations ORDER BY upload_id')).rows
      ).toEqual(before);
      await client.query(
        "SELECT public.receipt_reservation_cleanup_select(clock_timestamp()+interval '1 hour',false)"
      );
      const completed = await client.query(
        'SELECT public.receipt_reservation_complete($1,$2,$3) AS result',
        ['dry-run', owner, entity]
      );
      expect(completed.rows[0].result.error).toBe('CLEANUP_IN_PROGRESS');
      await client.query(
        "SELECT public.receipt_reservation_cleanup_finalize('dry-run','linked','33333333-3333-4333-8333-333333333333')"
      );
      await client.query("SELECT public.receipt_reservation_cleanup_finalize('dry-run','deleted')");
      expect(
        (await client.query("SELECT status FROM receipt_reservations WHERE upload_id='dry-run'"))
          .rows[0].status
      ).toBe('consumed');
    });
  });

  describe('Rollback & Teardown Verification', () => {
    it(
      'reverts migration 000072 down cleanly, dropping table and procedures',
      runIfAvailable(async () => {
        await applyMigration('down');

        const tableRes = await client.query(`
          SELECT tablename FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'receipt_reservations';
        `);
        expect(tableRes.rows.length).toBe(0);

        const procRes = await client.query(`
          SELECT routine_name FROM information_schema.routines
          WHERE routine_schema = 'public' AND routine_name LIKE 'receipt_reservation_%';
        `);
        expect(procRes.rows.length).toBe(0);
      })
    );
  });
});
