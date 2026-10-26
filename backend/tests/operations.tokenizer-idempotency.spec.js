/**
 * Empirical Adversarial Challenge Suite: Tokenizer Boundary Conditions & Idempotency Replay Semantics
 * Agent: challenger_m2_2 (Tokenizer & Concurrency Challenger PR-1)
 *
 * Challenge 1: Tokenizer boundary conditions
 * - Exactly 50 tokens (allowed)
 * - 51 tokens (rejected with 400 TASK_LIMIT_EXCEEDED)
 * - Text with periods without spaces (must NOT split)
 * - Consecutive delimiters (multiple commas, semicolons, newlines, period-spaces, leading/trailing)
 * - Unicode characters and CRLF / \r\n newlines
 *
 * Challenge 2: Idempotency replay semantics
 * - Concurrent identical requests with same Idempotency-Key (no duplicate DB records)
 * - Mismatched payload with same Idempotency-Key returns 422 ERR_IDEMPOTENCY_KEY_REUSED (header & body)
 * - Concurrent mismatched payload conflict isolation
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

const flushWrites = () => new Promise((resolve) => setTimeout(resolve, 50));

const createClient = async (token, entity, overrides = {}) => {
  const res = await request(app)
    .post('/v1/clients')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity)
    .send({
      name: 'Challenger Client Corp',
      tin: `999-888-777-${String(Math.random()).slice(2, 7)}`,
      entity,
      ...overrides,
    });
  return res.body.data;
};

describe('Empirical Adversarial Challenge Suite: PR-1 Tokenizer & Idempotency (challenger_m2_2)', () => {
  let adminToken;
  let testClient;
  const nativeFrom = supabaseAdmin.from;

  beforeEach(async () => {
    resetMock();
    seedDefaults();
    supabaseAdmin.from = nativeFrom;

    adminToken = registerUser({
      id: 'challenger-admin-1',
      email: 'admin-challenger@ata-lta.ph',
      name: 'Admin Challenger',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    testClient = await createClient(adminToken, 'ATA');
  });

  afterEach(() => {
    supabaseAdmin.from = nativeFrom;
  });

  // =========================================================================
  // CHALLENGE 1: TOKENIZER BOUNDARY CONDITIONS
  // =========================================================================
  describe('Challenge 1: Tokenizer Boundary Conditions', () => {
    describe('1.1 Boundary: Exactly 50 tokens (allowed)', () => {
      it('unit: tokenizeTask accepts exactly 50 tokens without throwing', () => {
        const fiftyTasks = Array.from({ length: 50 }, (_, i) => `Subtask Item ${i + 1}`).join(
          ', '
        );
        const tokens = tokenizeTask(fiftyTasks);
        expect(tokens).toHaveLength(50);
        expect(tokens[0]).toBe('Subtask Item 1');
        expect(tokens[49]).toBe('Subtask Item 50');
      });

      it('unit: cumulative count reaching exactly 50 is allowed', () => {
        const tokens = tokenizeTask('Task A, Task B', { currentTotal: 48, max: 50 });
        expect(tokens).toHaveLength(2);
        expect(tokens).toEqual(['Task A', 'Task B']);
      });

      it('integration: POST /v1/operations/work-requests creates exactly 50 tasks for 50 tokens', async () => {
        const fiftyTasks = Array.from({ length: 50 }, (_, i) => `Audit Step ${i + 1}`).join(', ');
        const payload = {
          dueDate: '2026-12-31',
          title: 'WR with Exactly 50 Tokenized Tasks',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_fifty',
                  title: fiftyTasks,
                  assignees: [],
                  depends_on: null,
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
        expect(wr.phases.pre_processing.tasks).toHaveLength(50);
        expect(wr.tasks).toHaveLength(50);

        // First task retains raw submission in note
        expect(wr.phases.pre_processing.tasks[0].title).toBe('Audit Step 1');
        expect(wr.phases.pre_processing.tasks[0].local_id).toBe('t_fifty');
        expect(wr.phases.pre_processing.tasks[0].description).toContain(
          '[audit_note] Original submission:'
        );

        // Last sibling task verification
        expect(wr.phases.pre_processing.tasks[49].title).toBe('Audit Step 50');
        expect(wr.phases.pre_processing.tasks[49].local_id).toBe('t_fifty_s49');

        // Confirm database contains exactly 50 task rows
        const dbTasks = Array.from(mockTables.tasks.values()).filter(
          (t) => t.work_request_id === wr.id
        );
        expect(dbTasks).toHaveLength(50);
      });
    });

    describe('1.2 Boundary: 51 tokens (rejected with 400 TASK_LIMIT_EXCEEDED)', () => {
      it('unit: tokenizeTask rejects 51 tokens with 400 and TASK_LIMIT_EXCEEDED', () => {
        const fiftyOneTasks = Array.from({ length: 51 }, (_, i) => `Subtask ${i + 1}`).join(', ');
        expect(() => tokenizeTask(fiftyOneTasks)).toThrow();
        try {
          tokenizeTask(fiftyOneTasks);
        } catch (err) {
          expect(err.statusCode).toBe(400);
          expect(err.code).toBe('TASK_LIMIT_EXCEEDED');
          expect(err.detail).toContain('exceed limit of 50');
        }
      });

      it('unit: cumulative count exceeding 50 (e.g. 49 + 2 = 51) throws TASK_LIMIT_EXCEEDED', () => {
        expect(() =>
          tokenizeTask('Task A, Task B', { currentTotal: 49, max: 50 })
        ).toThrow();
        try {
          tokenizeTask('Task A, Task B', { currentTotal: 49, max: 50 });
        } catch (err) {
          expect(err.statusCode).toBe(400);
          expect(err.code).toBe('TASK_LIMIT_EXCEEDED');
        }
      });

      it('integration: POST /v1/operations/work-requests rejects single task with 51 tokens with 400 TASK_LIMIT_EXCEEDED', async () => {
        const fiftyOneTasks = Array.from(
          { length: 51 },
          (_, i) => `Exceeding Task ${i + 1}`
        ).join('; ');

        const payload = {
          dueDate: '2026-12-31',
          title: 'WR with 51 Tokens in Single Task',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_excess',
                  title: fiftyOneTasks,
                  assignees: [],
                  depends_on: null,
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

        expect(res.body.code).toBe('TASK_LIMIT_EXCEEDED');
        expect(res.body.detail).toMatch(/exceed limit of 50/i);

        // Ensure zero records created in DB
        const wrs = Array.from(mockTables.work_requests.values()).filter(
          (w) => w.title === 'WR with 51 Tokens in Single Task'
        );
        expect(wrs).toHaveLength(0);
      });

      it('integration: POST /v1/operations/work-requests rejects cumulative tokens > 50 across multiple tasks', async () => {
        const twentySixTasks = Array.from(
          { length: 26 },
          (_, i) => `Phase 1 Task ${i + 1}`
        ).join(', ');
        const twentyFiveTasks = Array.from(
          { length: 25 },
          (_, i) => `Phase 2 Task ${i + 1}`
        ).join(', ');

        const payload = {
          dueDate: '2026-12-31',
          title: 'WR with Cumulative 51 Tokens Across Tasks',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_p1',
                  title: twentySixTasks, // 26 tokens
                  assignees: [],
                  depends_on: null,
                },
              ],
            },
            processing: {
              tasks: [
                {
                  local_id: 't_p2',
                  title: twentyFiveTasks, // 25 tokens -> cumulative 51!
                  assignees: [],
                  depends_on: null,
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

        expect(res.body.code).toBe('TASK_LIMIT_EXCEEDED');
        expect(res.body.detail).toMatch(/exceed limit of 50/i);
      });
    });

    describe('1.3 Boundary: Periods without spaces must NOT split', () => {
      it('unit: filenames, version numbers, domains, acronyms, and IP addresses do not split', () => {
        const cases = [
          'Review financial_statement.v2.final.xlsx file',
          'Upgrade server to Node.js v22.1.0 and postgres.16',
          'Consult SEC.gov and bir.gov.ph regulatory documentation',
          'Configure database host 192.168.1.100 port 5432',
          'Analyze filing Form 17-A.Part.I.Item.1',
          'Calculate ratio: 12.345 to 67.890',
        ];

        for (const c of cases) {
          const tokens = tokenizeTask(c);
          expect(tokens).toEqual([c]);
        }
      });

      it('unit: sentence with period followed by space splits while periods without space inside tokens do NOT split', () => {
        const input =
          'Download BIR form 2307 from bir.gov.ph. Verify v1.0.4 compatibility. Upload to drive.google.com';
        const tokens = tokenizeTask(input);
        expect(tokens).toEqual([
          'Download BIR form 2307 from bir.gov.ph',
          'Verify v1.0.4 compatibility',
          'Upload to drive.google.com',
        ]);
      });

      it('integration: creates single task when input contains periods without spaces', async () => {
        const payload = {
          dueDate: '2026-12-31',
          title: 'WR Period Without Space Test',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_no_split',
                  title: 'Audit v1.2.3 patch at tax.portal.gov',
                  assignees: [],
                  depends_on: null,
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

        expect(res.body.data.phases.pre_processing.tasks).toHaveLength(1);
        expect(res.body.data.phases.pre_processing.tasks[0].title).toBe(
          'Audit v1.2.3 patch at tax.portal.gov'
        );
      });
    });

    describe('1.4 Boundary: Consecutive delimiters', () => {
      it('unit: multiple consecutive commas, semicolons, and newlines clean gracefully without empty tokens', () => {
        const input = 'Task Alpha,,,,,, Task Beta;;;;; Task Gamma\n\n\n\nTask Delta';
        const tokens = tokenizeTask(input);
        expect(tokens).toEqual(['Task Alpha', 'Task Beta', 'Task Gamma', 'Task Delta']);
      });

      it('unit: mixed consecutive delimiters with irregular spacing', () => {
        const input = '   ,,,;;;\n  Task 1  ; ; , \n\n  Task 2  \n\n  ;  Task 3  ,,,   ';
        const tokens = tokenizeTask(input);
        expect(tokens).toEqual(['Task 1', 'Task 2', 'Task 3']);
      });

      it('unit: period followed by multiple spaces and consecutive period-spaces', () => {
        const input = 'First Step.   .     . Second Step.    Third Step';
        const tokens = tokenizeTask(input);
        expect(tokens).toEqual(['First Step', 'Second Step', 'Third Step']);
      });

      it('unit: text containing only delimiters and whitespace returns single trimmed string or empty', () => {
        expect(tokenizeTask(',,,,, ;;;;; \n\n')).toEqual([',,,,, ;;;;;']);
      });

      it('integration: POST /v1/operations/work-requests handles consecutive delimiters cleanly', async () => {
        const payload = {
          dueDate: '2026-12-31',
          title: 'WR Consecutive Delimiters Test',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_delim',
                  title: 'Prepare Trial Balance,,, ;;; \n\n Reconcile Cash Accounts',
                  assignees: [],
                  depends_on: null,
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

        const tasks = res.body.data.phases.pre_processing.tasks;
        expect(tasks).toHaveLength(2);
        expect(tasks[0].title).toBe('Prepare Trial Balance');
        expect(tasks[1].title).toBe('Reconcile Cash Accounts');
      });
    });

    describe('1.5 Boundary: Unicode and Newlines', () => {
      it('unit: handles international characters, accents, CJK, and emojis', () => {
        const input =
          'Ihanda ang dokumento para kay Señor Peña, 決算書監査; 🚀 Launch filing\n📝 Review contracts';
        const tokens = tokenizeTask(input);
        expect(tokens).toEqual([
          'Ihanda ang dokumento para kay Señor Peña',
          '決算書監査',
          '🚀 Launch filing',
          '📝 Review contracts',
        ]);
      });

      it('unit: Windows CRLF (\\r\\n) newlines split cleanly and strip \\r', () => {
        const input = 'Line One\r\nLine Two\r\nLine Three';
        const tokens = tokenizeTask(input);
        expect(tokens).toEqual(['Line One', 'Line Two', 'Line Three']);
        // Verify carriage return is not present
        expect(tokens[0]).not.toContain('\r');
        expect(tokens[1]).not.toContain('\r');
        expect(tokens[2]).not.toContain('\r');
      });

      it('integration: preserves Unicode text in created work request tasks and respects period-without-space', async () => {
        const payload = {
          dueDate: '2026-12-31',
          title: 'WR Unicode Audit: Peña & 鈴木',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_uni',
                  title: 'Pirmahan ni Atty.Muñoz, 監査確認; 🌟 Expedited',
                  assignees: [],
                  depends_on: null,
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

        const tasks = res.body.data.phases.pre_processing.tasks;
        expect(tasks).toHaveLength(3);
        expect(tasks[0].title).toBe('Pirmahan ni Atty.Muñoz');
        expect(tasks[1].title).toBe('監査確認');
        expect(tasks[2].title).toBe('🌟 Expedited');
      });
    });
  });

  // =========================================================================
  // CHALLENGE 2: IDEMPOTENCY REPLAY SEMANTICS
  // =========================================================================
  describe('Challenge 2: Idempotency Replay Semantics', () => {
    describe('2.1 Concurrent identical requests with same Idempotency-Key', () => {
      it('header-key: 10 concurrent identical requests do NOT create duplicate records', async () => {
        const idempotencyKey = '11112222-3333-4444-5555-666677778888';
        const payload = {
          dueDate: '2026-12-31',
          title: 'Concurrent Idempotency Stress Test',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_c1',
                  title: 'Concurrent Step Alpha, Concurrent Step Beta',
                  assignees: [],
                  depends_on: null,
                },
              ],
            },
          },
        };

        // Fire 10 identical requests simultaneously
        const concurrentCount = 10;
        const requests = Array.from({ length: concurrentCount }, () =>
          request(app)
            .post('/v1/operations/work-requests')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Active-Entity', 'ATA')
            .set('Idempotency-Key', idempotencyKey)
            .send(payload)
        );

        const responses = await Promise.all(requests);

        // All 10 requests must succeed with 201
        for (const res of responses) {
          expect(res.status).toBe(201);
          expect(res.body.data).toBeDefined();
        }

        // All 10 responses must return the EXACT same Work Request ID
        const firstWrId = responses[0].body.data.id;
        for (let i = 1; i < concurrentCount; i++) {
          expect(responses[i].body.data.id).toBe(firstWrId);
        }

        // Verify exactly 1 work_request record exists in database
        const dbWrs = Array.from(mockTables.work_requests.values()).filter(
          (w) => w.title === 'Concurrent Idempotency Stress Test'
        );
        expect(dbWrs).toHaveLength(1);

        // Verify exactly 2 tasks exist (1 tokenized into 2 sibling tasks)
        const dbTasks = Array.from(mockTables.tasks.values()).filter(
          (t) => t.work_request_id === firstWrId
        );
        expect(dbTasks).toHaveLength(2);
      });

      it('body-key: 5 concurrent identical requests with body idempotency_key do NOT create duplicate records', async () => {
        const idempotencyKey = '99998888-7777-6666-5555-444433332222';
        const payload = {
          dueDate: '2026-12-31',
          idempotency_key: idempotencyKey,
          title: 'Concurrent Body Key Stress Test',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_cb1',
                  title: 'Task Single',
                  assignees: [],
                  depends_on: null,
                },
              ],
            },
          },
        };

        const requests = Array.from({ length: 5 }, () =>
          request(app)
            .post('/v1/operations/work-requests')
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Active-Entity', 'ATA')
            .send(payload)
        );

        const responses = await Promise.all(requests);

        for (const res of responses) {
          expect(res.status).toBe(201);
        }

        const firstId = responses[0].body.data.id;
        for (const res of responses) {
          expect(res.body.data.id).toBe(firstId);
        }

        const dbWrs = Array.from(mockTables.work_requests.values()).filter(
          (w) => w.title === 'Concurrent Body Key Stress Test'
        );
        expect(dbWrs).toHaveLength(1);
      });
    });

    describe('2.2 Mismatched payload with same key returns 422 ERR_IDEMPOTENCY_KEY_REUSED', () => {
      it('header-key: re-using same key with different title returns 422 Unprocessable Entity', async () => {
        const idempotencyKey = 'aaaaaaaa-bbbb-4444-cccc-dddddddddddd';
        const originalPayload = {
          dueDate: '2026-12-31',
          title: 'Original Title Work Request',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't1',
                  title: 'Original Task',
                  assignees: [],
                  depends_on: null,
                },
              ],
            },
          },
        };

        // 1. Initial request succeeds
        const res1 = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .set('Idempotency-Key', idempotencyKey)
          .send(originalPayload)
          .expect(201);

        expect(res1.body.data.id).toBeDefined();

        await flushWrites();

        // 2. Mismatched request with DIFFERENT title but SAME key
        const mismatchedPayload = {
          dueDate: '2026-12-31',
          ...originalPayload,
          title: 'Tampered Different Title Work Request',
        };

        const res2 = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .set('Idempotency-Key', idempotencyKey)
          .send(mismatchedPayload)
          .expect(422);

        expect(res2.body.code).toBe('ERR_IDEMPOTENCY_KEY_REUSED');
        expect(res2.body.detail).toMatch(/different request payload/i);

        // Verify tampered WR was NOT created
        const tamperedWrs = Array.from(mockTables.work_requests.values()).filter(
          (w) => w.title === 'Tampered Different Title Work Request'
        );
        expect(tamperedWrs).toHaveLength(0);
      });

      it('header-key: re-using same key with different task graph returns 422', async () => {
        const idempotencyKey = 'bbbbbbbb-cccc-4444-dddd-eeeeeeeeeeee';
        const originalPayload = {
          dueDate: '2026-12-31',
          title: 'Task Structure Sensitivity Test',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't1',
                  title: 'Task A',
                  assignees: [],
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
          .set('Idempotency-Key', idempotencyKey)
          .send(originalPayload)
          .expect(201);

        await flushWrites();

        // Mismatched task structure
        const mismatchedPayload = {
          dueDate: '2026-12-31',
          ...originalPayload,
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't1',
                  title: 'Task A',
                  assignees: [],
                  depends_on: null,
                },
                {
                  local_id: 't2',
                  title: 'Injected Task B',
                  assignees: [],
                  depends_on: null,
                },
              ],
            },
          },
        };

        const res = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .set('Idempotency-Key', idempotencyKey)
          .send(mismatchedPayload)
          .expect(422);

        expect(res.body.code).toBe('ERR_IDEMPOTENCY_KEY_REUSED');
      });

      it('body-key: re-using body idempotency_key with different payload returns 422', async () => {
        const idempotencyKey = 'cccccccc-dddd-4444-eeee-ffffffffffff';
        const originalPayload = {
          dueDate: '2026-12-31',
          idempotency_key: idempotencyKey,
          title: 'Body Key Payload A',
          clientId: testClient.id,
          entity: 'ATA',
        };

        const res1 = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send(originalPayload)
          .expect(201);

        expect(res1.body.data.id).toBeDefined();

        // Second call with different title but SAME idempotency_key in body
        const mismatchedPayload = {
          dueDate: '2026-12-31',
          idempotency_key: idempotencyKey,
          title: 'Body Key Payload B (Mismatched)',
          clientId: testClient.id,
          entity: 'ATA',
        };

        const res2 = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send(mismatchedPayload)
          .expect(422);

        expect(res2.body.code).toBe('ERR_IDEMPOTENCY_KEY_REUSED');
        expect(res2.body.detail).toMatch(/different request payload/i);
      });
    });

    describe('2.3 Exact Replay Header & Integrity', () => {
      it('subsequent request with identical payload returns Idempotent-Replay header and byte-identical graph', async () => {
        const idempotencyKey = 'dddddddd-eeee-4444-ffff-000000000000';
        const payload = {
          dueDate: '2026-12-31',
          title: 'Exact Replay Verification',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_rep',
                  title: 'Replay Task 1, Replay Task 2',
                  assignees: [],
                  depends_on: null,
                },
              ],
            },
          },
        };

        const res1 = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .set('Idempotency-Key', idempotencyKey)
          .send(payload)
          .expect(201);

        expect(res1.headers['idempotent-replay']).toBeUndefined();
        const originalData = res1.body.data;

        await flushWrites();

        const res2 = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .set('Idempotency-Key', idempotencyKey)
          .send(payload)
          .expect(201);

        expect(res2.headers['idempotent-replay']).toBe('true');
        expect(res2.body.data.id).toBe(originalData.id);
        expect(res2.body.data.title).toBe(originalData.title);
        expect(res2.body.data.phases.pre_processing.tasks).toHaveLength(2);
      });
    });

    describe('2.4 Additional Adversarial Stress Tests', () => {
      it('rejects malformed Idempotency-Key (empty string) with 422 ERR_INVALID_IDEMPOTENCY_KEY', async () => {
        const payload = {
          dueDate: '2026-12-31',
          title: 'Empty Key Test',
          clientId: testClient.id,
          entity: 'ATA',
        };

        const res = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .set('Idempotency-Key', '')
          .send(payload)
          .expect(422);

        expect(res.body.code).toBe('ERR_INVALID_IDEMPOTENCY_KEY');
      });

      it('rejects excessively long Idempotency-Key (> 255 chars) with 422 ERR_INVALID_IDEMPOTENCY_KEY', async () => {
        const payload = {
          dueDate: '2026-12-31',
          title: 'Too Long Key Test',
          clientId: testClient.id,
          entity: 'ATA',
        };

        const longKey = 'a'.repeat(256);
        const res = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .set('Idempotency-Key', longKey)
          .send(payload)
          .expect(422);

        expect(res.body.code).toBe('ERR_INVALID_IDEMPOTENCY_KEY');
      });

      it('cross-phase boundary: 25 tasks in pre_processing + 25 tasks in processing (total 50) succeeds with 201', async () => {
        const twentyFivePre = Array.from({ length: 25 }, (_, i) => `Pre Task ${i + 1}`).join(', ');
        const twentyFiveProc = Array.from({ length: 25 }, (_, i) => `Proc Task ${i + 1}`).join(', ');

        const payload = {
          dueDate: '2026-12-31',
          title: 'Split Phase Exactly 50 Tasks',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [{ local_id: 't_pre', title: twentyFivePre }],
            },
            processing: {
              tasks: [{ local_id: 't_proc', title: twentyFiveProc }],
            },
          },
        };

        const res = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send(payload)
          .expect(201);

        expect(res.body.data.phases.pre_processing.tasks).toHaveLength(25);
        expect(res.body.data.phases.processing.tasks).toHaveLength(25);
        expect(res.body.data.tasks).toHaveLength(50);
      });

      it('cross-phase boundary: 25 tasks in pre_processing + 26 tasks in processing (total 51) fails with 400 TASK_LIMIT_EXCEEDED', async () => {
        const twentyFivePre = Array.from({ length: 25 }, (_, i) => `Pre Task ${i + 1}`).join(', ');
        const twentySixProc = Array.from({ length: 26 }, (_, i) => `Proc Task ${i + 1}`).join(', ');

        const payload = {
          dueDate: '2026-12-31',
          title: 'Split Phase 51 Tasks Exceeded',
          clientId: testClient.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [{ local_id: 't_pre', title: twentyFivePre }],
            },
            processing: {
              tasks: [{ local_id: 't_proc', title: twentySixProc }],
            },
          },
        };

        const res = await request(app)
          .post('/v1/operations/work-requests')
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send(payload)
          .expect(400);

        expect(res.body.code).toBe('TASK_LIMIT_EXCEEDED');
      });
    });
  });
});
