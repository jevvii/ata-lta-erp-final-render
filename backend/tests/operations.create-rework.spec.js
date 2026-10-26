/**
 * P0-D PR-1 Test Suite: Creation Pipeline, Delimiter Tokenizer, Idempotency & Assignment Dual-Write.
 *
 * Verifies:
 * 1. Tokenizer unit tests (1-token passthrough, 2+ token splits on commas/semicolons/newlines/period+space,
 *    mixed delimiters, preservation of raw string, and >50 cap rejection with 400).
 * 2. Supertest tests for POST /v1/operations/work-requests and /v1/work-requests:
 *    - Full graph return (201) with phases, tasks, assignees.
 *    - Dual-write to task_assignees join table, legacy assignee columns, and WR co_assignees.
 *    - Dependency validation (rejects "0", empty string, unknown local_id, cycles).
 *    - Atomic rollback on mid-transaction failure.
 *    - Idempotency replay (returns cached 201 graph with Idempotent-Replay: true, no duplicate DB rows).
 *    - Retry with same key after mid-transaction error succeeds and creates exactly one WR graph.
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
const { tokenizeTask } = require('../src/lib/tokenizer');

const createClient = async (token, entity, overrides = {}) => {
  const res = await request(app)
    .post('/v1/clients')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity)
    .send({
      name: 'Test Client Corporation',
      tin: `123-456-789-${String(Math.random()).slice(2, 7)}`,
      entity,
      ...overrides,
    });
  return res.body.data;
};

describe('P0-D PR-1: Operations Creation Pipeline & Tokenizer Rework', () => {
  describe('Unit Tests: Delimiter Tokenizer (tokenizer.js)', () => {
    it('passes through a single token without splitting when no delimiters are present', () => {
      const input = 'Prepare preliminary trial balance schedule';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Prepare preliminary trial balance schedule']);
      expect(tokens.raw).toBe(input);
    });

    it('passes through trimmed text when delimiter results in only 1 non-empty token', () => {
      const input = 'Prepare preliminary trial balance schedule. ';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Prepare preliminary trial balance schedule.']);
    });

    it('splits on commas when >= 2 non-empty tokens result', () => {
      const input = 'Prepare balance sheet, Reconcile bank accounts, File VAT return';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual([
        'Prepare balance sheet',
        'Reconcile bank accounts',
        'File VAT return',
      ]);
    });

    it('splits on semicolons', () => {
      const input = 'Task Alpha; Task Beta; Task Gamma';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Task Alpha', 'Task Beta', 'Task Gamma']);
    });

    it('splits on newlines', () => {
      const input = 'Collect receipts\nVerify withholding tax\nSign certificate';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Collect receipts', 'Verify withholding tax', 'Sign certificate']);
    });

    it('splits on period followed by space', () => {
      const input = 'Draft audit plan. Review internal controls. Meet with CFO';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Draft audit plan', 'Review internal controls', 'Meet with CFO']);
    });

    it('does NOT split on period without space (e.g. version numbers or acronyms)', () => {
      const input = 'Review v1.0 specifications and SEC.Gov compliance form';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Review v1.0 specifications and SEC.Gov compliance form']);
    });

    it('splits on mixed delimiters and cleans extra whitespace and empty items', () => {
      const input = 'Task 1, Task 2; Task 3\nTask 4. Task 5';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5']);
    });

    it('filters out empty tokens and handles irregular punctuation', () => {
      const input = '   Task A  ,  ,  ;  \n   Task B   ';
      const tokens = tokenizeTask(input);
      expect(tokens).toEqual(['Task A', 'Task B']);
    });

    it('preserves the original raw submitted string for audit note persistence', () => {
      const rawString = 'Item 1, Item 2; Item 3';
      const tokens = tokenizeTask(rawString);
      expect(tokens.raw).toBe(rawString);
    });

    it('returns empty array when input is null, undefined, or empty string', () => {
      expect(tokenizeTask('')).toEqual([]);
      expect(tokenizeTask('   ')).toEqual([]);
      expect(tokenizeTask(null)).toEqual([]);
      expect(tokenizeTask(undefined)).toEqual([]);
    });

    it('rejects with 400 Bad Request when single task exceeds 50 tokens', () => {
      const items = Array.from({ length: 51 }, (_, i) => `Subtask ${i + 1}`).join(', ');
      expect(() => tokenizeTask(items)).toThrow();
      try {
        tokenizeTask(items);
      } catch (err) {
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('TASK_LIMIT_EXCEEDED');
      }
    });

    it('rejects with 400 Bad Request when cumulative tokens across request exceed 50', () => {
      expect(() => tokenizeTask('Task A, Task B', { currentTotal: 49 })).toThrow();
      try {
        tokenizeTask('Task A, Task B', { currentTotal: 49 });
      } catch (err) {
        expect(err.statusCode).toBe(400);
        expect(err.code).toBe('TASK_LIMIT_EXCEEDED');
      }
    });
  });

  describe('Integration Tests: Work-Request Creation Pipeline', () => {
    const nativeFrom = supabaseAdmin.from;
    let adminToken;
    let staffUser1;
    let staffUser2;
    let testClient;

    afterEach(() => {
      supabaseAdmin.from = nativeFrom;
    });

    beforeEach(async () => {
      resetMock();
      seedDefaults();
      supabaseAdmin.from = nativeFrom;

      adminToken = registerUser({
        id: 'admin-uuid-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin Elena',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      registerUser({
        id: 'staff-uuid-1',
        email: 'staff1@ata-lta.ph',
        name: 'Staff Maria',
        role: 'Operations',
        entities: ['ATA'],
      });
      staffUser1 = mockTables.users.get('staff-uuid-1');

      registerUser({
        id: 'staff-uuid-2',
        email: 'staff2@ata-lta.ph',
        name: 'Staff Juan',
        role: 'Documentation',
        entities: ['ATA'],
      });
      staffUser2 = mockTables.users.get('staff-uuid-2');

      testClient = await createClient(adminToken, 'ATA');
    });

    it('successfully creates WR graph (201) with tokenized tasks and dual-written assignees', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'Q3 Tax Compliance Filing',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_pre_1',
                title: 'Collect BIR 2307 forms',
                description: 'Verify withholding tax certificates',
                assignees: [staffUser1.id, staffUser2.id],
                depends_on: null,
              },
            ],
          },
          processing: {
            tasks: [
              {
                local_id: 't_proc_1',
                title: 'Compute VAT liability, Draft return schedule', // Tokenizes into 2 sibling tasks!
                description: 'Calculate input and output VAT',
                assignees: [staffUser2.id],
                depends_on: ['t_pre_1'],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(201);

      const wr = res.body.data;
      expect(wr.id).toBeDefined();
      expect(wr.title).toBe('Q3 Tax Compliance Filing');
      expect(wr.phase).toBe('pre_processing');
      expect(wr.status).toBe('Draft');

      // Verify phase graph
      expect(wr.phases).toBeDefined();
      expect(wr.phases.pre_processing.tasks).toHaveLength(1);
      expect(wr.phases.processing.tasks).toHaveLength(2); // 1 task tokenized into 2!

      // Pre-processing task verification
      const preTask = wr.phases.pre_processing.tasks[0];
      expect(preTask.title).toBe('Collect BIR 2307 forms');
      expect(preTask.phase).toBe('pre_processing');
      expect(preTask.status).toBe('Assigned');
      expect(preTask.assigneeId).toBe(staffUser1.id);
      expect(preTask.assignees).toContain(staffUser1.id);
      expect(preTask.assignees).toContain(staffUser2.id);

      // Processing sibling tasks verification
      const procTasks = wr.phases.processing.tasks;
      expect(procTasks[0].title).toBe('Compute VAT liability');
      expect(procTasks[0].local_id).toBe('t_proc_1');
      expect(procTasks[0].phase).toBe('processing');
      expect(procTasks[0].description).toContain('[audit_note] Original submission:');
      expect(procTasks[0].predecessors).toHaveLength(1);
      expect(procTasks[0].predecessors[0]).toBe(preTask.id);

      expect(procTasks[1].title).toBe('Draft return schedule');
      expect(procTasks[1].local_id).toBe('t_proc_1_s1');
      expect(procTasks[1].phase).toBe('processing');
      expect(procTasks[1].predecessors).toHaveLength(1);
      expect(procTasks[1].predecessors[0]).toBe(preTask.id);

      // Verify dual-write in task_assignees join table
      const allTaRows = Array.from(mockTables.task_assignees.values());
      const preTaskTa = allTaRows.filter((r) => r.task_id === preTask.id);
      expect(preTaskTa).toHaveLength(2);
      expect(preTaskTa.map((r) => r.user_id)).toEqual(
        expect.arrayContaining([staffUser1.id, staffUser2.id])
      );
      expect(preTaskTa[0].assigned_by).toBe('admin-uuid-1');
      expect(preTaskTa[0].assigned_at).toBeDefined();

      // Verify work_requests.co_assignees mirrored
      const wrRow = mockTables.work_requests.get(wr.id);
      expect(wrRow.co_assignees.some((c) => c === staffUser1.id || c === 'Staff Maria')).toBe(true);
      expect(wrRow.co_assignees.some((c) => c === staffUser2.id || c === 'Staff Juan')).toBe(true);
    });

    it('rejects dependency "0" with 400 Bad Request and field error', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Invalid Dependency Zero',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task Alpha',
                assignees: [],
                depends_on: '0', // Literal "0" from buggy client
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail).toMatch(/depends_on.*"0"/i);
    });

    it('rejects dependency ["0"] array with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Invalid Dependency Array Zero',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task Alpha',
                assignees: [],
                depends_on: ['0'],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail).toMatch(/depends_on.*"0"/i);
    });

    it('rejects dependency null inside array [null] with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Null Inside Dependency Array',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task Alpha',
                assignees: [],
                depends_on: [null],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects dependency [null, "task1"] with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Null and Valid Task Inside Dependency Array',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 'task1',
                title: 'Task Alpha',
                assignees: [],
                depends_on: null,
              },
              {
                local_id: 'task2',
                title: 'Task Beta',
                assignees: [],
                depends_on: [null, 'task1'],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/depends_on/i);
    });

    it('rejects empty string dependency "" with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Empty String Dependency',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task Alpha',
                assignees: [],
                depends_on: '',
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail).toMatch(/depends_on/i);
    });

    it('rejects unknown local_id dependency with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Unknown Local ID Dependency',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task Alpha',
                assignees: [],
                depends_on: 't_non_existent',
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail).toMatch(/t_non_existent/i);
    });

    it('rejects circular dependencies with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Circular Dependency',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task Alpha',
                assignees: [],
                depends_on: 't2',
              },
              {
                local_id: 't2',
                title: 'Task Beta',
                assignees: [],
                depends_on: 't1',
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail).toMatch(/circular dependency/i);
    });

    it('deduplicates user IDs in assignees array before inserting into task_assignees', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Duplicate Assignees in Task',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_dedupe',
                title: 'Task With Duplicate Assignees',
                assignees: [staffUser1.id, staffUser1.id],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(201);

      const task = res.body.phases.pre_processing.tasks[0];
      expect(task.assignees).toHaveLength(1);
      expect(task.assignees[0]).toBe(staffUser1.id);

      const allTaRows = Array.from(mockTables.task_assignees.values());
      const dbAssignees = allTaRows.filter((ta) => ta.task_id === task.id);
      expect(dbAssignees).toHaveLength(1);
      expect(dbAssignees[0].user_id).toBe(staffUser1.id);
    });

    it('rejects duplicate explicit local_id across tasks with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Duplicate Explicit Local IDs',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_dup',
                title: 'Task 1',
                assignees: [],
              },
              {
                local_id: 't_dup',
                title: 'Task 2',
                assignees: [],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/local_id/i);
    });

    it('rejects sibling local_id collisions within the request with 400 Bad Request', async () => {
      const payload = {
        dueDate: '2026-12-31',
        title: 'WR with Sibling Local ID Collision',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't_parent',
                title: 'Subtask 1, Subtask 2', // expands to t_parent and t_parent_s1
                assignees: [],
              },
              {
                local_id: 't_parent_s1', // collides with sibling t_parent_s1
                title: 'Conflicting Sibling Task',
                assignees: [],
              },
            ],
          },
        },
      };

      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
      expect(res.body.detail || res.body.message).toMatch(/local_id/i);
    });

    it('rolls back the entire work request graph if a task creation fails mid-transaction', async () => {
      // Mock failure specifically on the tasks insert operation
      let tasksInsertFailed = false;

      supabaseAdmin.from = (table) => {
        const builder = nativeFrom.call(supabaseAdmin, table);
        if (table === 'tasks') {
          return {
            ...builder,
            insert: () => {
              tasksInsertFailed = true;
              return Promise.resolve({
                data: null,
                error: { message: 'Forced DB disk error on tasks table', code: '50000' },
              });
            },
          };
        }
        return builder;
      };

      const payload = {
        dueDate: '2026-12-31',
        title: 'WR Mid Transaction Failure Test',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task will abort',
                assignees: [staffUser1.id],
                depends_on: null,
              },
            ],
          },
        },
      };

      await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(500);

      expect(tasksInsertFailed).toBe(true);

      // Verify complete rollback: zero rows created in work_requests, tasks, or task_assignees
      const wrRows = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'WR Mid Transaction Failure Test'
      );
      expect(wrRows).toHaveLength(0);

      const taskRows = Array.from(mockTables.tasks.values()).filter(
        (r) => r.title === 'Task will abort'
      );
      expect(taskRows).toHaveLength(0);

      const taRows = Array.from(mockTables.task_assignees.values());
      expect(taRows).toHaveLength(0);

      supabaseAdmin.from = nativeFrom;
    });

    it('replays identical response with Idempotent-Replay header and creates no duplicate records', async () => {
      const idempotencyKey = '77777777-8888-4444-9999-000000000001';
      const payload = {
        dueDate: '2026-12-31',
        idempotency_key: idempotencyKey,
        title: 'Idempotency Test Work Request',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Audit preparation step',
                assignees: [staffUser1.id],
                depends_on: null,
              },
            ],
          },
        },
      };

      // First submission
      const res1 = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);

      expect(res1.headers['idempotent-replay']).toBeUndefined();
      const firstWrId = res1.body.data.id;

      // Count in DB
      const initialWrCount = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Idempotency Test Work Request'
      ).length;
      expect(initialWrCount).toBe(1);

      // Duplicate submission with same Idempotency-Key
      const res2 = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);

      expect(res2.headers['idempotent-replay']).toBe('true');
      expect(res2.body.data.id).toBe(firstWrId);

      // Ensure zero duplicates were created
      const finalWrCount = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Idempotency Test Work Request'
      ).length;
      expect(finalWrCount).toBe(1);
    });

    it('honors client-supplied idempotency_key in request body without header', async () => {
      const idempotencyKey = '88888888-9999-4444-aaaa-bbbbbbbbbbbb';
      const payload = {
        dueDate: '2026-12-31',
        idempotency_key: idempotencyKey,
        title: 'Body Key Idempotency Test',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Review checklist',
                assignees: [],
                depends_on: null,
              },
            ],
          },
        },
      };

      // First call
      const res1 = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(201);

      const firstId = res1.body.data.id;

      // Replay
      const res2 = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(201);

      expect(res2.headers['idempotent-replay']).toBe('true');
      expect(res2.body.data.id).toBe(firstId);

      const count = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Body Key Idempotency Test'
      ).length;
      expect(count).toBe(1);
    });

    it('allows retry with same Idempotency-Key after mid-transaction failure and succeeds', async () => {
      const idempotencyKey = '99999999-aaaa-4444-bbbb-cccccccccccc';
      const payload = {
        dueDate: '2026-12-31',
        idempotency_key: idempotencyKey,
        title: 'Retry After Failure Test',
        clientId: testClient.id,
        entity: 'ATA',
        phases: {
          pre_processing: {
            tasks: [
              {
                local_id: 't1',
                title: 'Task one',
                assignees: [staffUser1.id],
                depends_on: null,
              },
            ],
          },
        },
      };

      // 1. First attempt fails mid-way
      let shouldFail = true;

      supabaseAdmin.from = (table) => {
        const builder = nativeFrom.call(supabaseAdmin, table);
        if (table === 'tasks' && shouldFail) {
          return {
            ...builder,
            insert: () =>
              Promise.resolve({
                data: null,
                error: { message: 'Temporary DB network drop', code: '50001' },
              }),
          };
        }
        return builder;
      };

      await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(500);

      // Verify DB is clean after rollback
      expect(
        Array.from(mockTables.work_requests.values()).filter(
          (r) => r.title === 'Retry After Failure Test'
        )
      ).toHaveLength(0);

      // 2. Network recovers
      shouldFail = false;
      supabaseAdmin.from = nativeFrom;

      // Retry with the SAME Idempotency-Key
      const retryRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);

      expect(retryRes.body.data.id).toBeDefined();

      // Exactly one WR created
      const wrCount = Array.from(mockTables.work_requests.values()).filter(
        (r) => r.title === 'Retry After Failure Test'
      ).length;
      expect(wrCount).toBe(1);

      // 3. Subsequent replay with the same key returns the created graph
      const replayRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload)
        .expect(201);

      expect(replayRes.headers['idempotent-replay']).toBe('true');
      expect(replayRes.body.data.id).toBe(retryRes.body.data.id);
    });

    it('maintains compatibility with legacy request bodies without phases', async () => {
      const legacyPayload = {
        dueDate: '2026-12-31',
        title: 'Legacy Annual Compilation',
        clientId: testClient.id,
        entity: 'ATA',
        status: 'Draft',
      };

      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(legacyPayload)
        .expect(201);

      expect(res.body.data.title).toBe('Legacy Annual Compilation');
      expect(res.body.data.status).toBe('Draft');
      expect(res.body.data.phase).toBe('pre_processing');

      // Can retrieve by ID via GET
      const getRes = await request(app)
        .get(`/v1/work-requests/${res.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(getRes.body.data.id).toBe(res.body.data.id);
      expect(getRes.body.data.phase).toBe('pre_processing');
    });
  });
});
