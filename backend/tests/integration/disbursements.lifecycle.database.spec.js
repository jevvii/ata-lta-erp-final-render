/**
 * Portable PostgreSQL Acceptance Test Suite for Authorized Disbursement Lifecycle Redesign (v2)
 *
 * Gated by explicit DISBURSEMENT_TEST_DATABASE_URL.
 * Runs against a disposable, empty local test database inside a rolled-back transaction.
 * Fails safely if the target database already contains application tables.
 * Contains no absolute home paths, personal demo credentials, or copied application records.
 */

const { Client } = require('pg');
const lifecycleMigration = require('../../migrations/000070_disbursement_lifecycle_v2.js');
const readScopeMigration = require('../../migrations/000071_disbursement_read_scope.js');

const testDbUrl = process.env.DISBURSEMENT_TEST_DATABASE_URL;
const describeIfDb = testDbUrl ? describe : describe.skip;

describeIfDb('Disbursement Lifecycle PostgreSQL Database Acceptance Tests (v2)', () => {
  let db;

  // Synthetic fixture IDs
  let entityId;
  let deptOpsId;
  let deptAcctId;
  let opsUserId;
  let ops2UserId;
  let adminUserId;
  let acctUserId;
  let otherUserId;
  let testClientId;
  let testWrId;
  let otherEntityId;
  let otherClientId;
  let otherEntityWrId;

  const authOps = '11111111-1111-1111-1111-111111111111';
  const authOps2 = '22222222-2222-2222-2222-222222222222';
  const authAdmin = '33333333-3333-3333-3333-333333333333';
  const authAcct = '44444444-4444-4444-4444-444444444444';
  const authOther = '55555555-5555-5555-5555-555555555555';

  beforeAll(async () => {
    if (!testDbUrl) return;

    const parsedUrl = new URL(testDbUrl);
    if (parsedUrl.hostname !== '127.0.0.1' && parsedUrl.hostname !== 'localhost') {
      throw new Error(`Remote database targets prohibited for security. Target: ${parsedUrl.hostname}`);
    }

    db = new Client({ connectionString: testDbUrl });
    await db.connect();

    // Guard: target database must be empty and disposable
    const checkEmpty = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('disbursements', 'users', 'entities')
    `);
    if (checkEmpty.rows.length > 0) {
      throw new Error('Target database must be empty and disposable; refusing to run against populated database');
    }

    // Run suite inside a transaction that is rolled back in afterAll
    await db.query('BEGIN');
    inTransaction = true;

    // Supabase API roles are transactional fixtures on a plain PostgreSQL test cluster.
    await db.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
      END $$;
    `);

    // 1. Portable minimal baseline schema matching columns required by migrations 69 & 70
    await db.query(`
      CREATE TABLE entities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code text NOT NULL,
        name text
      );
      CREATE TABLE departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL
      );
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        auth_user_id uuid,
        name text,
        email text,
        role text,
        is_active boolean DEFAULT true,
        entities text[] DEFAULT '{}'
      );
      CREATE TABLE user_departments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id),
        department_id uuid REFERENCES departments(id)
      );
      CREATE TABLE clients (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id uuid REFERENCES entities(id),
        name text
      );
      CREATE TABLE work_requests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id uuid REFERENCES entities(id),
        client_id uuid REFERENCES clients(id),
        title text,
        status text
      );
      CREATE TABLE disbursements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_id uuid REFERENCES entities(id),
        client_id uuid REFERENCES clients(id),
        linked_invoice_id uuid,
        linked_work_request_id uuid REFERENCES work_requests(id),
        linked_task_id uuid,
        task_id uuid,
        linked_transmittal_id uuid,
        due_date date,
        disbursement_number text,
        category text NOT NULL,
        description text NOT NULL,
        amount numeric(14,2) NOT NULL,
        fund_source text NOT NULL,
        status text NOT NULL DEFAULT 'Draft',
        archived boolean NOT NULL DEFAULT false,
        payment_method text,
        payment_bank text,
        payment_reference text,
        payment_date date,
        payment_notes text,
        payment_processed_by uuid REFERENCES users(id),
        notes text,
        print_details jsonb DEFAULT '{}'::jsonb,
        receipt_s3_key text,
        receipt_filename text,
        created_by uuid REFERENCES users(id),
        requested_by uuid REFERENCES users(id),
        employee_id uuid REFERENCES users(id),
        approved_by uuid REFERENCES users(id),
        approved_at timestamptz,
        funded_by uuid REFERENCES users(id),
        funded_at timestamptz,
        released_by uuid REFERENCES users(id),
        released_at timestamptz,
        rejected_by uuid REFERENCES users(id),
        rejected_at timestamptz,
        rejection_reason text,
        deleted_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        updated_by uuid REFERENCES users(id)
      );
      CREATE TABLE status_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        table_name text NOT NULL,
        record_id uuid NOT NULL,
        old_status text,
        new_status text NOT NULL,
        action text,
        actor_id uuid REFERENCES users(id),
        entity_id uuid REFERENCES entities(id),
        notes text,
        details jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id),
        type text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        read_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT notifications_type_check CHECK (type IN (
          'pending_request.resolved',
          'wr.transition_request.received',
          'wr.transition_request.resolved',
          'wr.qa_reroute'
        ))
      );
    `);

    // 2. Apply migration 70
    const lifecycleSql = [];
    lifecycleMigration.up({ sql: (s) => lifecycleSql.push(s) });
    for (const sql of lifecycleSql) {
      await db.query(sql);
    }

    // 3. Apply migration 71
    const readScopeSql = [];
    readScopeMigration.up({ sql: (s) => readScopeSql.push(s) });
    for (const sql of readScopeSql) {
      await db.query(sql);
    }

    // 4. Seed synthetic test fixtures
    const entRes = await db.query("INSERT INTO entities(code, name) VALUES ('ATA', 'ATA Services Firm') RETURNING id");
    entityId = entRes.rows[0].id;

    const otherEntRes = await db.query("INSERT INTO entities(code, name) VALUES ('LTA', 'LTA Legal Firm') RETURNING id");
    otherEntityId = otherEntRes.rows[0].id;

    deptOpsId = (await db.query("INSERT INTO departments(name) VALUES ('Operations') RETURNING id")).rows[0].id;
    deptAcctId = (await db.query("INSERT INTO departments(name) VALUES ('Accounting') RETURNING id")).rows[0].id;

    opsUserId = (await db.query(
      "INSERT INTO users(auth_user_id, name, email, role, entities) VALUES ($1, 'Ops One', 'ops1@test.local', 'Operations', $2) RETURNING id",
      [authOps, ['ATA']]
    )).rows[0].id;
    await db.query('INSERT INTO user_departments(user_id, department_id) VALUES ($1, $2)', [opsUserId, deptOpsId]);

    ops2UserId = (await db.query(
      "INSERT INTO users(auth_user_id, name, email, role, entities) VALUES ($1, 'Ops Two', 'ops2@test.local', 'Operations', $2) RETURNING id",
      [authOps2, ['ATA']]
    )).rows[0].id;
    await db.query('INSERT INTO user_departments(user_id, department_id) VALUES ($1, $2)', [ops2UserId, deptOpsId]);

    adminUserId = (await db.query(
      "INSERT INTO users(auth_user_id, name, email, role, entities) VALUES ($1, 'Admin', 'admin@test.local', 'Admin', $2) RETURNING id",
      [authAdmin, ['ATA']]
    )).rows[0].id;

    acctUserId = (await db.query(
      "INSERT INTO users(auth_user_id, name, email, role, entities) VALUES ($1, 'Accounting Staff', 'acct@test.local', 'Accounting', $2) RETURNING id",
      [authAcct, ['ATA']]
    )).rows[0].id;
    await db.query('INSERT INTO user_departments(user_id, department_id) VALUES ($1, $2)', [acctUserId, deptAcctId]);

    otherUserId = (await db.query(
      "INSERT INTO users(auth_user_id, name, email, role, entities) VALUES ($1, 'Other Staff', 'other@test.local', 'Operations', $2) RETURNING id",
      [authOther, ['ATA']]
    )).rows[0].id;
    await db.query('INSERT INTO user_departments(user_id, department_id) VALUES ($1, $2)', [otherUserId, deptOpsId]);

    testClientId = (await db.query('INSERT INTO clients(entity_id, name) VALUES ($1, \'Acme Corp\') RETURNING id', [entityId])).rows[0].id;
    otherClientId = (await db.query('INSERT INTO clients(entity_id, name) VALUES ($1, \'Beta Corp\') RETURNING id', [entityId])).rows[0].id;

    testWrId = (await db.query(
      "INSERT INTO work_requests(entity_id, client_id, title, status) VALUES ($1, $2, 'Annual Audit', 'In Progress') RETURNING id",
      [entityId, testClientId]
    )).rows[0].id;

    otherEntityWrId = (await db.query(
      "INSERT INTO work_requests(entity_id, title, status) VALUES ($1, 'Cross Entity WR', 'In Progress') RETURNING id",
      [otherEntityId]
    )).rows[0].id;
  });

  afterAll(async () => {
    if (db) {
      try {
        await db.query('ROLLBACK');
      } catch (_err) {
        /* connection already closed or aborted */
      }
      await db.end();
    }
  });

  let inTransaction = false;

  beforeEach(async () => {
    if (inTransaction) {
      await db.query('SAVEPOINT test_case');
    }
  });

  afterEach(async () => {
    if (inTransaction) {
      await db.query('ROLLBACK TO SAVEPOINT test_case');
    }
  });

  const createV2 = async (overrides = {}) => {
    const defaults = {
      entity_id: entityId,
      category: 'Supplies',
      description: 'SQL lifecycle spec fixture',
      amount: 1500,
      fund_source: 'Firm Fund',
      status: 'Draft',
      lifecycle_version: 2,
      review_ready: true,
      created_by: opsUserId,
      requested_by: opsUserId,
      linked_work_request_id: testWrId,
      ...overrides,
    };
    const keys = Object.keys(defaults);
    const vals = Object.values(defaults);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
    const res = await db.query(`INSERT INTO disbursements(${keys.join(',')}) VALUES(${placeholders}) RETURNING *`, vals);
    return res.rows[0];
  };

  const createPreviousRecord = async (overrides = {}) => {
    const defaults = {
      entity_id: entityId,
      category: 'Supplies',
      description: 'Legacy v1 SQL spec fixture',
      amount: 1500,
      fund_source: 'Firm Fund',
      status: 'Draft',
      lifecycle_version: 1,
      review_ready: true,
      created_by: opsUserId,
      requested_by: opsUserId,
      linked_work_request_id: testWrId,
      ...overrides,
    };
    const keys = Object.keys(defaults);
    const vals = Object.values(defaults);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
    const res = await db.query(`INSERT INTO disbursements(${keys.join(',')}) VALUES(${placeholders}) RETURNING *`, vals);
    return res.rows[0];
  };

  const expectRollback = async (fn) => {
    await db.query('SAVEPOINT sub_sp');
    try {
      await fn();
      throw new Error('Expected function to fail but it succeeded');
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT sub_sp');
      return err;
    }
  };

  describe('Trigger-based Atomic Initial History (v2 Creation)', () => {
    it('AFTER INSERT trigger automatically creates initial Draft history record', async () => {
      const voucher = await createV2();
      const res = await db.query(
        "SELECT * FROM status_history WHERE record_id = $1 AND table_name = 'disbursements' ORDER BY created_at ASC",
        [voucher.id]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].old_status).toBeNull();
      expect(res.rows[0].new_status).toBe('Draft');
      expect(res.rows[0].details?.action).toBe('create');
      expect(res.rows[0].actor_id).toBe(opsUserId);
    });

    it('AFTER INSERT trigger rolls back transaction if creator is invalid', async () => {
      const bogusUserId = '99999999-9999-9999-9999-999999999999';
      const err = await expectRollback(async () => {
        await createV2({ created_by: bogusUserId, requested_by: bogusUserId });
      });
      expect(err.message).toMatch(/foreign key constraint|disbursements_created_by_fkey/i);
    });
  });

  describe('disbursement_transition Procedure: Canonical Graph & Separation of Duties', () => {
    it('blocks approval of an inherited request with unknown requester identity', async () => {
      const voucher = await createV2({ created_by: null, requested_by: null });
      const err = await expectRollback(() => db.query(
        'SELECT * FROM disbursement_transition($1, $2, $3, $4, $5, $6, $7, $8)',
        [voucher.id, ['Draft'], 'Approved', adminUserId, entityId, null, null, voucher.version]
      ));
      expect(err.message).toMatch(/INCOMPLETE_REQUEST/);
    });

    it('denies lifecycle authority when an actor role or entity membership is unknown', async () => {
      const voucher = await createV2();
      await db.query('UPDATE users SET role = NULL WHERE id = $1', [adminUserId]);
      let err = await expectRollback(() => db.query(
        'SELECT * FROM disbursement_transition($1, $2, $3, $4, $5, $6, $7, $8)',
        [voucher.id, ['Draft'], 'Approved', adminUserId, entityId, null, null, voucher.version]
      ));
      expect(err.message).toMatch(/FORBIDDEN_ROLE_NOT_ADMIN/);
      await db.query("UPDATE users SET role = 'Admin', entities = NULL WHERE id = $1", [adminUserId]);
      err = await expectRollback(() => db.query(
        'SELECT * FROM disbursement_transition($1, $2, $3, $4, $5, $6, $7, $8)',
        [voucher.id, ['Draft'], 'Approved', adminUserId, entityId, null, null, voucher.version]
      ));
      expect(err.message).toMatch(/FORBIDDEN_ENTITY_ACCESS/);
    });

    it('requires a positive expected version', async () => {
      const v = await createV2();
      const err = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, NULL)",
          [v.id, adminUserId, entityId]
        );
      });
      expect(err.message).toMatch(/VERSION_REQUIRED/);
    });

    it('allows the single Admin to approve their own request with versioned audit attribution', async () => {
      const ownVoucher = await createV2({ created_by: adminUserId, requested_by: adminUserId });
      const result = await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [ownVoucher.id, adminUserId, entityId, ownVoucher.version]
      );
      expect(result.rows[0]).toMatchObject({ status: 'Approved', approved_by: adminUserId, version: ownVoucher.version + 1 });
      const history = await db.query("SELECT old_status, new_status, actor_id FROM status_history WHERE record_id = $1 AND new_status = 'Approved'", [ownVoucher.id]);
      expect(history.rows).toEqual([{ old_status: 'Draft', new_status: 'Approved', actor_id: adminUserId }]);
      const stale = await expectRollback(() => db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [ownVoucher.id, adminUserId, entityId, ownVoucher.version]
      ));
      expect(stale.message).toMatch(/ERR_CONCURRENCY_CONFLICT/);
    });

    it('allows Admin to approve Draft created by another user and records true predecessor status in history', async () => {
      const v = await createV2();
      const res = await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [v.id, adminUserId, entityId, v.version]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].status).toBe('Approved');
      expect(res.rows[0].version).toBe(v.version + 1);

      const hist = await db.query(
        "SELECT old_status, new_status FROM status_history WHERE record_id = $1 AND new_status = 'Approved'",
        [v.id]
      );
      expect(hist.rows.length).toBe(1);
      expect(hist.rows[0].old_status).toBe('Draft');
      expect(hist.rows[0].new_status).toBe('Approved');
    });

    it('rejects initial approval if request is incomplete (missing linked_work_request_id)', async () => {
      const v = await createV2({ linked_work_request_id: null });
      const err = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
          [v.id, adminUserId, entityId, v.version]
        );
      });
      expect(err.message).toMatch(/INCOMPLETE_REQUEST/);
    });

    it('rejects initial approval if linked work request belongs to another entity', async () => {
      const v = await createV2({ linked_work_request_id: otherEntityWrId });
      const err = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
          [v.id, adminUserId, entityId, v.version]
        );
      });
      expect(err.message).toMatch(/INCOMPLETE_REQUEST/);
    });

    it('rejects initial approval if client_id mismatches linked work request client_id', async () => {
      const v = await createV2({ client_id: otherClientId, linked_work_request_id: testWrId });
      const err = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
          [v.id, adminUserId, entityId, v.version]
        );
      });
      expect(err.message).toMatch(/INCOMPLETE_REQUEST/);
    });

    it('rejects initial approval if amount <= 0 or description is blank', async () => {
      const vZero = await createV2({ amount: 0 });
      const errZero = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
          [vZero.id, adminUserId, entityId, vZero.version]
        );
      });
      expect(errZero.message).toMatch(/INCOMPLETE_REQUEST/);

      const vBlank = await createV2({ description: '   ' });
      const errBlank = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
          [vBlank.id, adminUserId, entityId, vBlank.version]
        );
      });
      expect(errBlank.message).toMatch(/INCOMPLETE_REQUEST/);
    });

    it('rejects forged state skip from Draft directly to Released', async () => {
      const v = await createV2();
      const err = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Released', $2, $3, NULL, NULL, $4)",
          [v.id, adminUserId, entityId, v.version]
        );
      });
      expect(err.message).toMatch(/CONFLICT_CURRENT_STATUS/);
    });

    it('requires Accounting role/department and 4 payment fields to fund Approved voucher', async () => {
      const v = await createV2();
      const approved = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [v.id, adminUserId, entityId, v.version]
      )).rows[0];

      // Non-accounting (ops user) fails
      const errRole = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Approved']::text[], 'Funded', $2, $3, NULL, '{\"method\":\"Cash\",\"bank\":\"Cash\",\"reference\":\"REF-1\",\"date\":\"2026-10-20\"}'::jsonb, $4)",
          [approved.id, opsUserId, entityId, approved.version]
        );
      });
      expect(errRole.message).toMatch(/FORBIDDEN_ROLE_NOT_ACCOUNTING/);

      // Missing payment details fails
      const errDetails = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Approved']::text[], 'Funded', $2, $3, NULL, '{\"method\":\"Cash\"}'::jsonb, $4)",
          [approved.id, acctUserId, entityId, approved.version]
        );
      });
      expect(errDetails.message).toMatch(/PAYMENT_DETAILS_REQUIRED/);

      // Valid accounting funding succeeds
      const funded = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Approved']::text[], 'Funded', $2, $3, NULL, '{\"method\":\"Cash\",\"bank\":\"Cash\",\"reference\":\"REF-1\",\"date\":\"2026-10-20\"}'::jsonb, $4)",
        [approved.id, acctUserId, entityId, approved.version]
      )).rows[0];
      expect(funded.status).toBe('Funded');
      expect(funded.payment_processed_by).toBe(acctUserId);
    });

    it('allows the same Admin to request, approve, prepare and release with full audit attribution', async () => {
      const v = await createV2({ created_by: adminUserId, requested_by: adminUserId });
      const approved = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [v.id, adminUserId, entityId, v.version]
      )).rows[0];

      const funded = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Approved']::text[], 'Funded', $2, $3, NULL, '{\"method\":\"Check\",\"bank\":\"BDO\",\"reference\":\"CHK-99\",\"date\":\"2026-10-20\"}'::jsonb, $4)",
        [approved.id, adminUserId, entityId, approved.version]
      )).rows[0];

      const released = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Funded']::text[], 'Released', $2, $3, NULL, NULL, $4)",
        [funded.id, adminUserId, entityId, funded.version]
      )).rows[0];
      expect(released).toMatchObject({ status: 'Released', approved_by: adminUserId, funded_by: adminUserId, payment_processed_by: adminUserId, released_by: adminUserId, payment_reference: 'CHK-99', version: funded.version + 1 });
      const history = (await db.query("SELECT old_status, new_status, actor_id FROM status_history WHERE record_id = $1 ORDER BY created_at, details->>'previous_version'", [v.id])).rows;
      expect(history).toContainEqual({ old_status: 'Funded', new_status: 'Released', actor_id: adminUserId });
      expect(history).toHaveLength(4);
      const stale = await expectRollback(() => db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Funded']::text[], 'Released', $2, $3, NULL, NULL, $4)",
        [funded.id, adminUserId, entityId, funded.version]
      ));
      expect(stale.message).toMatch(/ERR_CONCURRENCY_CONFLICT/);
    });

    it('allows rejection from Draft and Funded with non-empty reason', async () => {
      const v = await createV2();
      // Empty reason rejected
      const errEmpty = await expectRollback(async () => {
        await db.query(
          "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Rejected', $2, $3, '   ', NULL, $4)",
          [v.id, adminUserId, entityId, v.version]
        );
      });
      expect(errEmpty.message).toMatch(/INVALID_REJECTION_REASON/);

      // Non-empty reason succeeds
      const rej = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Rejected', $2, $3, 'Incomplete documentation', NULL, $4)",
        [v.id, adminUserId, entityId, v.version]
      )).rows[0];
      expect(rej.status).toBe('Rejected');
    });
  });

  describe('disbursement_atomic_delete Procedure: Soft Delete & Versioning', () => {
    it('allows owner to soft delete their own Draft voucher', async () => {
      const v = await createV2({ created_by: opsUserId });
      const del = (await db.query(
        'SELECT * FROM disbursement_atomic_delete($1, $2, $3, $4)',
        [v.id, entityId, opsUserId, v.version]
      )).rows[0];
      expect(del.deleted_at).not.toBeNull();
      expect(del.version).toBe(v.version + 1);

      const hist = (await db.query(
        "SELECT * FROM status_history WHERE record_id = $1 AND details->>'action' = 'delete'",
        [v.id]
      )).rows[0];
      expect(hist).toBeDefined();
      expect(hist.actor_id).toBe(opsUserId);
    });

    it('allows Admin to soft delete Draft voucher', async () => {
      const v = await createV2({ created_by: opsUserId });
      const del = (await db.query(
        'SELECT * FROM disbursement_atomic_delete($1, $2, $3, $4)',
        [v.id, entityId, adminUserId, v.version]
      )).rows[0];
      expect(del.deleted_at).not.toBeNull();
    });

    it('rejects delete with version mismatch', async () => {
      const v = await createV2({ created_by: opsUserId });
      const err = await expectRollback(async () => {
        await db.query(
          'SELECT * FROM disbursement_atomic_delete($1, $2, $3, $4)',
          [v.id, entityId, opsUserId, v.version + 5]
        );
      });
      expect(err.message).toMatch(/ERR_CONCURRENCY_CONFLICT/);
    });

    it('rejects delete by non-owner non-admin', async () => {
      const v = await createV2({ created_by: opsUserId });
      const err = await expectRollback(async () => {
        await db.query(
          'SELECT * FROM disbursement_atomic_delete($1, $2, $3, $4)',
          [v.id, entityId, ops2UserId, v.version]
        );
      });
      expect(err.message).toMatch(/FORBIDDEN_DELETE_PERMISSION/);
    });

    it('rejects delete of non-Draft voucher', async () => {
      const v = await createV2();
      const approved = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [v.id, adminUserId, entityId, v.version]
      )).rows[0];

      const err = await expectRollback(async () => {
        await db.query(
          'SELECT * FROM disbursement_atomic_delete($1, $2, $3, $4)',
          [approved.id, entityId, adminUserId, approved.version]
        );
      });
      expect(err.message).toMatch(/CANNOT_DELETE_NON_DRAFT/);
    });

    it('preserves previously saved vouchers against deletion through the new workflow', async () => {
      const r = await db.query(
        "INSERT INTO disbursements(entity_id, category, description, amount, fund_source, status, lifecycle_version, created_by, requested_by) VALUES($1, 'Supplies', 'Legacy v1', 100, 'Firm Fund', 'Draft', 1, $2, $2) RETURNING *",
        [entityId, opsUserId]
      );
      const leg = r.rows[0];

      const err = await expectRollback(async () => {
        await db.query(
          'SELECT * FROM disbursement_atomic_delete($1, $2, $3, $4)',
          [leg.id, entityId, opsUserId, leg.version]
        );
      });
      expect(err.message).toMatch(/SAVED_WORKFLOW_READ_ONLY/);
    });
  });

  describe('disbursement_atomic_edit Procedure: Financial Lock & Admin Print Customization', () => {
    it('freezes financial modifications once voucher is Approved', async () => {
      const v = await createV2();
      const approved = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [v.id, adminUserId, entityId, v.version]
      )).rows[0];

      const err = await expectRollback(async () => {
        await db.query(
          'SELECT * FROM disbursement_atomic_edit($1, $2, $3, $4, $5)',
          [approved.id, entityId, opsUserId, JSON.stringify({ amount: 9999 }), approved.version]
        );
      });
      expect(err.message).toMatch(/FINANCIAL_EDITS_LOCKED_AFTER_APPROVAL/);
    });

    it('allows Admin to edit nonfinancial print_details on Released vouchers with OCC guard', async () => {
      const v = await createV2();
      const approved = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Draft']::text[], 'Approved', $2, $3, NULL, NULL, $4)",
        [v.id, adminUserId, entityId, v.version]
      )).rows[0];
      const funded = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Approved']::text[], 'Funded', $2, $3, NULL, '{\"method\":\"Cash\",\"bank\":\"Cash\",\"reference\":\"REF-1\",\"date\":\"2026-10-20\"}'::jsonb, $4)",
        [approved.id, acctUserId, entityId, approved.version]
      )).rows[0];
      const released = (await db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Funded']::text[], 'Released', $2, $3, NULL, NULL, $4)",
        [funded.id, adminUserId, entityId, funded.version]
      )).rows[0];

      const customPrint = { preparedBy: 'P. Cruz', approvedBy: 'A. Reyes' };
      const res = await db.query(
        'SELECT * FROM disbursement_atomic_edit($1, $2, $3, $4, $5)',
        [released.id, entityId, adminUserId, JSON.stringify({ print_details: customPrint }), released.version]
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].print_details).toEqual(customPrint);
      expect(res.rows[0].version).toBe(released.version + 1);
    });
  });

  describe('Existing development records remain readable without a reconciliation feature', () => {
    it('reapplying the additive migration preserves saved statuses, values, attachment references and history', async () => {
      const before = [];
      for (const status of ['Draft', 'Submitted', 'Pending', 'Pending Admin Approval', 'Approved', 'Funded', 'Released', 'Rejected', 'Archived', 'Cancelled']) {
        before.push(await createPreviousRecord({ status, receipt_filename: 'saved.pdf', receipt_s3_key: 'saved/receipt.pdf', payment_reference: 'SAVED-REF', amount: 125.25 }));
      }
      const queries = [];
      lifecycleMigration.up({ sql: (sql) => queries.push(sql) });
      for (const sql of queries) await db.query(sql);
      for (const row of before) {
        const stored = (await db.query('SELECT * FROM disbursements WHERE id=$1', [row.id])).rows[0];
        expect(stored).toEqual(row);
        expect((await db.query('SELECT count(*)::int n FROM status_history WHERE record_id=$1', [row.id])).rows[0].n).toBe(0);
      }
    });

    it('has no legacy classification columns or reconciliation RPC in a fresh schema', async () => {
      const columns = await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='disbursements' AND column_name LIKE 'legacy_%'");
      expect(columns.rows).toEqual([]);
      const rpc = await db.query("SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='disbursement_legacy_review'");
      expect(rpc.rows).toEqual([]);
    });

    it('keeps previously saved payment records out of new financial actions without changing them', async () => {
      const row = await createPreviousRecord({ status: 'Funded', payment_reference: 'ORIGINAL', payment_method: 'Cash', payment_bank: 'Cash', payment_date: '2026-01-01' });
      const error = await expectRollback(() => db.query(
        "SELECT * FROM disbursement_transition($1, ARRAY['Funded']::text[], 'Released', $2, $3, NULL, NULL, $4)",
        [row.id, adminUserId, entityId, row.version]
      ));
      expect(error.message).toMatch(/SAVED_WORKFLOW_READ_ONLY/);
      expect((await db.query('SELECT * FROM disbursements WHERE id=$1', [row.id])).rows[0]).toEqual(row);
    });
  });

  describe('Migration Down Safety Guards (Migrations 70 & 71)', () => {
    it('migration 70 down refuses automatic destructive rollback', () => {
      expect(() => lifecycleMigration.down()).toThrow(
        /Disbursement lifecycle rollback requires a reviewed recovery plan; automatic destructive rollback is disabled/
      );
    });

    it('migration 71 down executes safely and preserves lifecycle read/write guards', () => {
      const sqlList = [];
      readScopeMigration.down({ sql: (s) => sqlList.push(s) });
      expect(sqlList.length).toBe(1);
      expect(sqlList[0]).toMatch(/Security rollback intentionally preserves lifecycle read\/write guards/);
    });
  });

  describe('PostgreSQL Authority Protection & RLS Privacy (Migrations 70 & 71)', () => {
    it('revokes direct table writes from anon, authenticated, and PUBLIC', async () => {
      const tables = ['disbursements', 'status_history', 'users', 'entities'];
      for (const t of tables) {
        const priv = await db.query(
          "SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name = $1 AND grantee IN ('anon', 'authenticated', 'PUBLIC') AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')",
          [t]
        );
        expect(priv.rows).toEqual([]);
      }
    });

    it('revokes RPC execution from browser roles (authenticated, anon, PUBLIC)', async () => {
      const procs = [
        'disbursement_transition',
        'disbursement_atomic_delete',
        'disbursement_atomic_edit',
        'disbursement_archive_toggle',
      ];
      for (const p of procs) {
        const r = await db.query(
          "SELECT proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname = $1",
          [p]
        );
        expect(r.rows.length).toBeGreaterThan(0);
        for (const row of r.rows) {
          expect(row.auth_exec).toBe(false);
          expect(row.anon_exec).toBe(false);
        }
      }
    });

    it('denies anonymous reads on disbursements and status_history', async () => {
      await db.query('SET LOCAL ROLE anon');
      const errDisb = await expectRollback(async () => {
        await db.query('SELECT count(*) FROM disbursements');
      });
      expect(errDisb.message).toMatch(/permission denied for table disbursements/i);

      const errHist = await expectRollback(async () => {
        await db.query('SELECT count(*) FROM status_history');
      });
      expect(errHist.message).toMatch(/permission denied for table status_history/i);
    });

    it('scopes authenticated browser reads to session owner, admin, or accounting via RLS', async () => {
      const v = await createV2({ created_by: opsUserId });

      // 1. Creator sees voucher
      await db.query('SAVEPOINT sp_owner');
      await db.query('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authOps })]);
      const ownerCount = (await db.query('SELECT count(*) FROM disbursements WHERE id = $1', [v.id])).rows[0].count;
      expect(Number(ownerCount)).toBe(1);
      await db.query('ROLLBACK TO SAVEPOINT sp_owner');

      // 2. Non-creator other staff does not see voucher
      await db.query('SAVEPOINT sp_other');
      await db.query('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authOther })]);
      const otherCount = (await db.query('SELECT count(*) FROM disbursements WHERE id = $1', [v.id])).rows[0].count;
      expect(Number(otherCount)).toBe(0);
      await db.query('ROLLBACK TO SAVEPOINT sp_other');

      // 3. Admin sees voucher
      await db.query('SAVEPOINT sp_admin');
      await db.query('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authAdmin })]);
      const adminCount = (await db.query('SELECT count(*) FROM disbursements WHERE id = $1', [v.id])).rows[0].count;
      expect(Number(adminCount)).toBe(1);
      await db.query('ROLLBACK TO SAVEPOINT sp_admin');

      // 4. Accounting staff sees voucher
      await db.query('SAVEPOINT sp_acct');
      await db.query('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authAcct })]);
      const acctCount = (await db.query('SELECT count(*) FROM disbursements WHERE id = $1', [v.id])).rows[0].count;
      expect(Number(acctCount)).toBe(1);
      await db.query('ROLLBACK TO SAVEPOINT sp_acct');
    });

    it('scopes status_history reads to session-accessible disbursements via RLS', async () => {
      const v = await createV2({ created_by: opsUserId });

      // Owner sees own history
      await db.query('SAVEPOINT sp_hist_owner');
      await db.query('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authOps })]);
      const ownerHist = (await db.query('SELECT count(*) FROM status_history WHERE record_id = $1', [v.id])).rows[0].count;
      expect(Number(ownerHist)).toBe(1);
      await db.query('ROLLBACK TO SAVEPOINT sp_hist_owner');

      // Other staff cannot see history of inaccessible voucher
      await db.query('SAVEPOINT sp_hist_other');
      await db.query('SET LOCAL ROLE authenticated');
      await db.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: authOther })]);
      const otherHist = (await db.query('SELECT count(*) FROM status_history WHERE record_id = $1', [v.id])).rows[0].count;
      expect(Number(otherHist)).toBe(0);
      await db.query('ROLLBACK TO SAVEPOINT sp_hist_other');
    });
  });

  describe('Notifications Database Constraint (disbursement.lifecycle)', () => {
    it('accepts disbursement.lifecycle in notifications table', async () => {
      const n = await db.query(
        "INSERT INTO notifications(user_id, type, payload) VALUES($1, 'disbursement.lifecycle', '{\"action\":\"approved\",\"request_id\":\"disb-1\"}'::jsonb) RETURNING *",
        [adminUserId]
      );
      expect(n.rows[0].type).toBe('disbursement.lifecycle');
    });

    it('rejects unsupported notification types at database constraint level', async () => {
      const err = await expectRollback(async () => {
        await db.query(
          "INSERT INTO notifications(user_id, type, payload) VALUES($1, 'unknown.notification.type', '{}'::jsonb)",
          [adminUserId]
        );
      });
      expect(err.message).toMatch(/notifications_type_check/);
    });
  });
});
