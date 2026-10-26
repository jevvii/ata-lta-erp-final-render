/**
 * Adversarial Challenger Suite for P0-D PR-1
 *
 * Targets:
 * - Challenge 1: Invalid dependency inputs:
 *     - "0"
 *     - ["0"]
 *     - null inside array ([null], ["t1", null])
 *     - empty string ("")
 *     - array with empty string ([""])
 *     - malformed UUID ("not-a-real-uuid", ["bad-uuid"])
 *     - non-string / numeric dependencies (0, [0])
 * - Challenge 2: Mid-transaction failure followed by retry with same Idempotency-Key
 *     - Failure during tasks insert
 *     - Failure during task_assignees insert
 *     - Rollback verification across all tables
 *     - Retry with identical Idempotency-Key (header and body)
 *     - Exactly one WR with identical task graph in DB and replayed response
 * - Challenge 3: Co-assignees persistence & attribution across all 3 stores:
 *     - task_assignees join table
 *     - tasks.assignee_id & assignee_name
 *     - work_requests.co_assignees
 *     - 201 response graph & GET detail verification
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  supabaseAdmin,
} = require('./fixtures/supabaseMock');

const createClient = async (token, entity, overrides = {}) => {
  const res = await request(app)
    .post('/v1/clients')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity)
    .send({
      name: 'Adversarial Test Client',
      tin: `999-888-777-${String(Math.random()).slice(2, 7)}`,
      entity,
      ...overrides,
    });
  return res.body.data;
};

describe('Adversarial Challenger Suite: PR-1 (challenger_m2_1)', () => {
  const nativeFrom = supabaseAdmin.from;
  let adminToken;
  let staff1;
  let staff2;
  let staff3;
  let testClient;

  beforeEach(async () => {
    resetMock();
    seedDefaults();
    supabaseAdmin.from = nativeFrom;

    adminToken = registerUser({
      id: 'admin-uuid-001',
      email: 'admin.adversarial@ata-lta.ph',
      name: 'Admin Verifier',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    registerUser({
      id: 'staff-uuid-101',
      email: 'staff1@ata-lta.ph',
      name: 'Staff Alice',
      role: 'Operations',
      entities: ['ATA'],
    });
    staff1 = mockTables.users.get('staff-uuid-101');

    registerUser({
      id: 'staff-uuid-102',
      email: 'staff2@ata-lta.ph',
      name: 'Staff Bob',
      role: 'Documentation',
      entities: ['ATA'],
    });
    staff2 = mockTables.users.get('staff-uuid-102');

    registerUser({
      id: 'staff-uuid-103',
      email: 'staff3@ata-lta.ph',
      name: 'Staff Charlie',
      role: 'Operations',
      entities: ['ATA'],
    });
    staff3 = mockTables.users.get('staff-uuid-103');

    testClient = await createClient(adminToken, 'ATA');
  });

  afterEach(() => {
    supabaseAdmin.from = nativeFrom;
  });

  // =========================================================================
  // CHALLENGE 1: DEPENDENCY VALIDATION
  // =========================================================================
  describe('Challenge 1: Dependency validation rejects invalid values with 400 Bad Request', () => {
    const makePayloadWithDep = (depValue) => ({
      dueDate: '2026-12-31',
      title: 'Adversarial Dependency Test',
      clientId: testClient.id,
      entity: 'ATA',
      phases: {
        pre_processing: {
          tasks: [
            {
              local_id: 'task_alpha',
              title: 'Alpha Task',
              assignees: [staff1.id],
              depends_on: null,
            },
            {
              local_id: 'task_beta',
              title: 'Beta Task',
              assignees: [staff2.id],
              depends_on: depValue,
            },
          ],
        },
      },
    });

    it('rejects dependency "0" with 400 Bad Request and field error', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep('0'));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
      expect(res.body.detail || res.body.message).toMatch(/"0"/);
    });

    it('rejects dependency ["0"] with 400 Bad Request and field error', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep(['0']));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
      expect(res.body.detail || res.body.message).toMatch(/"0"/);
    });

    it('rejects dependency null inside array [null] with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep([null]));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects dependency [null, "task_alpha"] with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep([null, 'task_alpha']));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects empty string dependency "" with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep(''));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects whitespace-only dependency "   " with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep('   '));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects array containing empty string [""] with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep(['']));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects malformed UUID string "not-a-valid-uuid" with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep('not-a-valid-uuid'));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects malformed UUID inside array ["12345-bad-uuid"] with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep(['12345-bad-uuid']));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects non-string numeric dependency 0 or [0] with 400 Bad Request', async () => {
      const resNumber = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep(0));

      expect(resNumber.status).toBe(400);
      expect(resNumber.body.title).toMatch(/validation error|bad request/i);

      const resArrayNumber = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep([0]));

      expect(resArrayNumber.status).toBe(400);
      expect(resArrayNumber.body.title).toMatch(/validation error|bad request/i);
    });

    it('rejects cross-WR or nonexistent UUID dependency with 400 Bad Request', async () => {
      const crossWrUuid = 'c8b45678-1234-4000-8000-123456789abc';
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(makePayloadWithDep(crossWrUuid));

      expect(res.status).toBe(400);
      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
      expect(res.body.detail || res.body.message).toMatch(new RegExp(crossWrUuid));
    });
  });

  // =========================================================================
  // CHALLENGE 2: MID-TRANSACTION FAILURE & IDEMPOTENT RETRY
  // =========================================================================
  describe('Challenge 2: Mid-transaction failure and idempotent retry', () => {
    it('mid-transaction abort during tasks insert rolled back cleanly, retry with same key yields exactly one WR', async () => {
      const idempotencyKey = 'c2-task-fail-key-000000000001';
      const payload = {
        dueDate: '2026-12-31',
        title: 'Transaction Abort Tasks Test',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_init_1',
                title: 'Initial review',
                assignees: [staff1.id],
                depends_on: null,
              },
            ],
          },
          processing: {
            tasks: [
              {
                local_id: 't_proc_1',
                title: 'Data processing',
                assignees: [staff2.id],
                depends_on: ['t_init_1'],
              },
            ],
          },
        },
      };

      // 1. Force error during tasks table insertion
      let taskFailActive = true;
      supabaseAdmin.from = (table) => {
        const builder = nativeFrom.call(supabaseAdmin, table);
        if (table === 'tasks' && taskFailActive) {
          return {
            ...builder,
            insert: () =>
              Promise.resolve({
                data: null,
                error: { message: 'Simulated connection drop on tasks', code: '57P01' },
              }),
          };
        }
        return builder;
      };

      const failRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(failRes.status).toBe(500);

      // Verify ZERO records persisted in any table
      const wrRows = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Transaction Abort Tasks Test'
      );
      expect(wrRows).toHaveLength(0);

      const taskRows = Array.from(mockTables.tasks.values()).filter(
        (t) => t.title === 'Initial review' || t.title === 'Data processing'
      );
      expect(taskRows).toHaveLength(0);

      const taRows = Array.from(mockTables.task_assignees.values());
      expect(taRows).toHaveLength(0);

      // 2. Recovery: Disable simulated error and retry with the EXACT SAME Idempotency-Key
      taskFailActive = false;
      supabaseAdmin.from = nativeFrom;

      const retryRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(retryRes.status).toBe(201);
      const createdWr = retryRes.body.data;
      expect(createdWr.id).toBeDefined();
      expect(createdWr.title).toBe('Transaction Abort Tasks Test');

      // Verify exactly ONE WR in DB
      const postRetryWrRows = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Transaction Abort Tasks Test'
      );
      expect(postRetryWrRows).toHaveLength(1);
      expect(postRetryWrRows[0].id).toBe(createdWr.id);

      // Verify DB tasks match graph
      const postRetryTasks = Array.from(mockTables.tasks.values()).filter(
        (t) => t.work_request_id === createdWr.id
      );
      expect(postRetryTasks).toHaveLength(2);

      // 3. Subsequent replay returns identical response with Idempotent-Replay header
      const replayRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(replayRes.status).toBe(201);
      expect(replayRes.headers['idempotent-replay']).toBe('true');
      expect(replayRes.body.data.id).toBe(createdWr.id);
      expect(replayRes.body.data.phases.pre_processing.tasks).toHaveLength(1);
      expect(replayRes.body.data.phases.processing.tasks).toHaveLength(1);

      // Still exactly 1 WR in DB
      const finalWrRows = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Transaction Abort Tasks Test'
      );
      expect(finalWrRows).toHaveLength(1);
    });

    it('mid-transaction abort during task_assignees insert rolled back cleanly, retry succeeds', async () => {
      const idempotencyKey = 'c2-ta-fail-key-000000000002';
      const payload = {
        dueDate: '2026-12-31',
        title: 'Transaction Abort Assignees Test',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_ta_1',
                title: 'Assignee task',
                assignees: [staff1.id, staff2.id],
                depends_on: null,
              },
            ],
          },
        },
      };

      // 1. Force error during task_assignees insert
      let taFailActive = true;
      supabaseAdmin.from = (table) => {
        const builder = nativeFrom.call(supabaseAdmin, table);
        if (table === 'task_assignees' && taFailActive) {
          return {
            ...builder,
            insert: () =>
              Promise.resolve({
                data: null,
                error: { message: 'Deadlock on task_assignees', code: '40P01' },
              }),
          };
        }
        return builder;
      };

      const failRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(failRes.status).toBe(500);

      // Check DB is rolled back completely
      expect(
        Array.from(mockTables.work_requests.values()).filter(
          (r) => r.title === 'Transaction Abort Assignees Test'
        )
      ).toHaveLength(0);
      expect(
        Array.from(mockTables.tasks.values()).filter((t) => t.title === 'Assignee task')
      ).toHaveLength(0);
      expect(Array.from(mockTables.task_assignees.values())).toHaveLength(0);

      // 2. Retry succeeds
      taFailActive = false;
      supabaseAdmin.from = nativeFrom;

      const retryRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.id).toBeDefined();

      const wrInDb = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Transaction Abort Assignees Test'
      );
      expect(wrInDb).toHaveLength(1);
    });

    it('mid-transaction abort with body-only idempotency_key rolled back, retry succeeds, subsequent replay returns cached response', async () => {
      const idempotencyKey = 'c2-body-key-fail-000000000003';
      const payload = {
        dueDate: '2026-12-31',
        idempotency_key: idempotencyKey,
        title: 'Body Key Failure & Retry Test',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_body_1',
                title: 'Body task',
                assignees: [staff1.id],
                depends_on: null,
              },
            ],
          },
        },
      };

      // 1. Force failure on tasks table
      let failTasks = true;
      supabaseAdmin.from = (table) => {
        const builder = nativeFrom.call(supabaseAdmin, table);
        if (table === 'tasks' && failTasks) {
          return {
            ...builder,
            insert: () =>
              Promise.resolve({
                data: null,
                error: { message: 'Database I/O error', code: '58030' },
              }),
          };
        }
        return builder;
      };

      const failRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload);

      expect(failRes.status).toBe(500);

      // Verify zero rows in work_requests and idempotency_keys
      expect(
        Array.from(mockTables.work_requests.values()).filter(
          (r) => r.title === 'Body Key Failure & Retry Test'
        )
      ).toHaveLength(0);

      const keysInDb = Array.from(mockTables.idempotency_keys.values()).filter(
        (k) => k.idempotency_key === idempotencyKey
      );
      expect(keysInDb).toHaveLength(0);

      // 2. Recovery: retry with the SAME body idempotency_key
      failTasks = false;
      supabaseAdmin.from = nativeFrom;

      const retryRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload);

      expect(retryRes.status).toBe(201);
      const createdId = retryRes.body.data.id;
      expect(createdId).toBeDefined();

      // Exactly 1 WR in DB
      expect(
        Array.from(mockTables.work_requests.values()).filter(
          (r) => r.title === 'Body Key Failure & Retry Test'
        )
      ).toHaveLength(1);

      // 3. Replay with same body key returns cached response
      const replayRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload);

      expect(replayRes.status).toBe(201);
      expect(replayRes.headers['idempotent-replay']).toBe('true');
      expect(replayRes.body.data.id).toBe(createdId);

      // Still exactly 1 WR in DB
      expect(
        Array.from(mockTables.work_requests.values()).filter(
          (r) => r.title === 'Body Key Failure & Retry Test'
        )
      ).toHaveLength(1);
    });

    it('rejects idempotency key reuse with modified payload with 422 Unprocessable Entity', async () => {
      const idempotencyKey = 'c2-tamper-key-000000000004';
      const originalPayload = {
        dueDate: '2026-12-31',
        idempotency_key: idempotencyKey,
        title: 'Original Title Payload',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [{ local_id: 't1', title: 'Task 1', assignees: [] }],
          },
        },
      };

      // 1. Initial success
      const res1 = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(originalPayload);

      expect(res1.status).toBe(201);

      // 2. Reuse same key with different title
      const modifiedPayload = {
        dueDate: '2026-12-31',
        ...originalPayload,
        title: 'Tampered Title Payload',
      };

      const res2 = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(modifiedPayload);

      expect(res2.status).toBe(422);
      expect(res2.body.code).toBe('ERR_IDEMPOTENCY_KEY_REUSED');
    });
  });

  // =========================================================================
  // CHALLENGE 3: CO-ASSIGNEES PERSISTENCE & DUAL-WRITE CONSISTENCY
  // =========================================================================
  describe('Challenge 3: Co-assignees reliably persist and dual-write across all stores', () => {
    it('reliably persists co-assignees in task_assignees, tasks legacy columns, and work_requests.co_assignees', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'Dual-Write Assignment Verification',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_audit_prep',
                title: 'Audit preparation',
                description: 'Initial intake with primary and co-assignees',
                assignees: [staff1.id, staff2.id, staff3.id], // 3 assignees!
                depends_on: null,
              },
            ],
          },
          processing: {
            tasks: [
              {
                local_id: 't_recon',
                title: 'Account reconciliation',
                description: 'Solo task with staff2',
                assignees: [staff2.id],
                depends_on: ['t_audit_prep'],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload);

      expect(res.status).toBe(201);
      const wr = res.body.data;

      // 1. Check 201 Response Envelope
      expect(wr.id).toBeDefined();
      expect(wr.coAssignees).toBeDefined();
      expect(wr.coAssignees.some((c) => c === staff1.id || c === 'Staff Alice')).toBe(true);
      expect(wr.coAssignees.some((c) => c === staff2.id || c === 'Staff Bob')).toBe(true);
      expect(wr.coAssignees.some((c) => c === staff3.id || c === 'Staff Charlie')).toBe(true);

      const prepTask = wr.phases.pre_processing.tasks[0];
      expect(prepTask.assigneeId).toBe(staff1.id); // Primary
      expect(prepTask.assigneeName).toBe('Staff Alice');
      expect(prepTask.assignees).toHaveLength(3);
      expect(prepTask.assignees).toEqual(
        expect.arrayContaining([staff1.id, staff2.id, staff3.id])
      );

      // 2. Verify task_assignees Join Table Rows in DB
      const allTa = Array.from(mockTables.task_assignees.values());
      const prepTaRows = allTa.filter((r) => r.task_id === prepTask.id);
      expect(prepTaRows).toHaveLength(3);

      prepTaRows.forEach((row) => {
        expect(row.assigned_by).toBe('admin-uuid-001');
        expect(row.assigned_at).toBeDefined();
        expect(new Date(row.assigned_at).getTime()).toBeLessThanOrEqual(Date.now());
      });

      const assignedUserIds = prepTaRows.map((r) => r.user_id);
      expect(assignedUserIds).toContain(staff1.id);
      expect(assignedUserIds).toContain(staff2.id);
      expect(assignedUserIds).toContain(staff3.id);

      // 3. Verify Legacy tasks table columns in DB
      const taskInDb = mockTables.tasks.get(prepTask.id);
      expect(taskInDb).toBeDefined();
      expect(taskInDb.assignee_id).toBe(staff1.id);
      expect(taskInDb.assignee_name).toBe('Staff Alice');
      expect(taskInDb.assigned_by).toBe('admin-uuid-001');
      expect(taskInDb.assigned_at).toBeDefined();

      // 4. Verify work_requests.co_assignees in DB
      const wrInDb = mockTables.work_requests.get(wr.id);
      expect(wrInDb).toBeDefined();
      expect(wrInDb.co_assignees.some((c) => c === staff1.id || c === 'Staff Alice')).toBe(true);
      expect(wrInDb.co_assignees.some((c) => c === staff2.id || c === 'Staff Bob')).toBe(true);
      expect(wrInDb.co_assignees.some((c) => c === staff3.id || c === 'Staff Charlie')).toBe(true);

      // 5. Verify GET /v1/operations/work-requests/:id returns the complete assignment graph
      const getRes = await request(app)
        .get(`/v1/operations/work-requests/${wr.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(getRes.status).toBe(200);
      const fetchedWr = getRes.body.data;
      expect(fetchedWr.id).toBe(wr.id);
      expect(fetchedWr.coAssignees.some((c) => c === staff1.id || c === 'Staff Alice')).toBe(true);
      expect(fetchedWr.coAssignees.some((c) => c === staff2.id || c === 'Staff Bob')).toBe(true);
      expect(fetchedWr.coAssignees.some((c) => c === staff3.id || c === 'Staff Charlie')).toBe(true);
    });
  });
});
