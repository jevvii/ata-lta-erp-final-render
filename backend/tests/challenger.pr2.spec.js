/**
 * Adversarial Challenger Suite for P0-D PR-2 (challenger_m3)
 *
 * Targets:
 * - Challenge 1: Sneaky phase mutation vectors
 *     - Body with same value ({ phase: 'pre_processing' }) -> 400 TASK_PHASE_IMMUTABLE
 *     - Body with different case ({ phase: 'PROCESSING' }, { phase: 'Processing' }, { phase: 'PRE_PROCESSING' }) -> 400 TASK_PHASE_IMMUTABLE
 *     - Body with uppercase key ({ Phase: 'processing' }, { PHASE: 'processing' }) -> verification of DB immutability & response
 *     - Query parameters (?phase=processing, ?phase=pre_processing) -> verification of DB immutability & response
 *     - Nested payloads ({ data: { phase: 'processing' } }, { phase: { target: 'processing' } }) -> verification of DB immutability & response
 *     - Null / boolean / array phase in body ({ phase: null }, { phase: false }, { phase: ['processing'] }) -> 400 TASK_PHASE_IMMUTABLE
 *     - All task update routes (nested under WR, direct under /operations/tasks, direct under /tasks)
 * - Challenge 2: Prerequisite gate with complex mixes:
 *     - 1 Completed, 1 In Progress, 1 Cancelled pre_processing task
 *     - Processing task transitioning out of Draft/Assigned must return 409 PHASE_PREREQUISITE
 * - Challenge 3: Clean transition when blocking task completes:
 *     - When In Progress pre_processing task is Completed (2 Completed, 1 Cancelled)
 *     - Processing task transitions cleanly to In Progress (200 OK)
 *     - And subsequently transitions through review and completed (200 OK)
 * - Challenge 4: Task creation directly into In Progress for processing phase:
 *     - Direct creation in 'In Progress' while pre_processing is incomplete -> 409 PHASE_PREREQUISITE
 *     - Direct creation in 'For Review' or 'Completed' while pre_processing is incomplete -> 409 PHASE_PREREQUISITE
 *     - Direct creation in 'In Progress' when pre_processing tasks are all Completed/Cancelled -> 201 Created
 *     - Direct creation in 'Draft' or 'Assigned' while pre_processing is incomplete -> 201 Created
 * - Challenge 5: Cross-WR isolation & Soft-delete edge cases:
 *     - Incomplete pre_processing tasks on WR-A must NOT block processing tasks on WR-B
 *     - Soft-deleted pre_processing tasks must NOT block processing tasks
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
} = require('./fixtures/supabaseMock');

const createClient = async (token, entity = 'ATA') => {
  const res = await request(app)
    .post('/v1/clients')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity)
    .send({
      name: 'Adversarial Client PR2',
      tin: `999-PR2-${String(Math.random()).slice(2, 7)}`,
      entity,
    });
  return res.body.data;
};

describe('Adversarial Challenger Suite: PR-2 (challenger_m3)', () => {
  let adminToken;
  let adminUser;
  let client;

  beforeEach(async () => {
    resetMock();
    seedDefaults();

    adminUser = {
      id: '99999999-8888-7777-6666-555555555555',
      email: 'admin-challenger-pr2@ata-lta.ph',
      name: 'Admin Challenger PR2',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    };
    adminToken = registerUser(adminUser);
    client = await createClient(adminToken, 'ATA');
  });

  const createWorkRequestWithPhases = async (phasesConfig) => {
    const res = await request(app)
      .post('/v1/operations/work-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        dueDate: '2026-12-31',
        title: 'Adversarial WR PR-2',
        clientId: client.id,
        entity: 'ATA',
        phases: phasesConfig,
      });
    return res.body.data;
  };

  describe('Vector 1: Sneaky Phase Mutation Attempts', () => {
    let wr;
    let preTask;
    let procTask;

    beforeEach(async () => {
      wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task Alpha', local_id: 'pre1' }],
        },
        processing: {
          tasks: [{ title: 'Proc Task Beta', local_id: 'proc1' }],
        },
      });
      preTask = wr.phases.pre_processing.tasks[0];
      procTask = wr.phases.processing.tasks[0];
    });

    it('rejects phase mutation with identical value (no-op phase update) with 400 TASK_PHASE_IMMUTABLE', async () => {
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ phase: 'pre_processing' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_PHASE_IMMUTABLE');

      // Verify DB record unchanged
      const inDb = mockTables.tasks.get(preTask.id);
      expect(inDb.phase).toBe('pre_processing');
    });

    it('rejects phase mutation with different casing in value with 400 TASK_PHASE_IMMUTABLE', async () => {
      const variants = ['PROCESSING', 'Processing', 'PRE_PROCESSING', 'Pre_Processing', 'pRe_pRoCeSsInG'];

      for (const variant of variants) {
        const res = await request(app)
          .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ phase: variant });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('TASK_PHASE_IMMUTABLE');

        const inDb = mockTables.tasks.get(preTask.id);
        expect(inDb.phase).toBe('pre_processing');
      }
    });

    it('rejects phase mutation with non-string types (null, boolean, object, array) with 400 TASK_PHASE_IMMUTABLE', async () => {
      const nonStringTypes = [null, false, true, ['processing'], { target: 'processing' }, 123];

      for (const val of nonStringTypes) {
        const res = await request(app)
          .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({ phase: val });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('TASK_PHASE_IMMUTABLE');

        const inDb = mockTables.tasks.get(preTask.id);
        expect(inDb.phase).toBe('pre_processing');
      }
    });

    it('ensures query parameter ?phase= cannot mutate task phase in database', async () => {
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}?phase=processing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Title Updated via Query Param Attack' });

      // If accepted, title is updated but phase MUST REMAIN pre_processing
      expect(res.status).toBe(200);
      expect(res.body.data.phase).toBe('pre_processing');

      const inDb = mockTables.tasks.get(preTask.id);
      expect(inDb.phase).toBe('pre_processing');
      expect(inDb.title).toBe('Title Updated via Query Param Attack');
    });

    it('ensures casing in key (Phase, PHASE) cannot sneak a phase change into database', async () => {
      const res1 = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ Phase: 'processing', title: 'Casing Attack 1' });

      expect(res1.status).toBe(200);
      // If schema strips unknown keys, verify phase is untouched in DB and response
      const inDb1 = mockTables.tasks.get(preTask.id);
      expect(inDb1.phase).toBe('pre_processing');

      const res2 = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ PHASE: 'processing', title: 'Casing Attack 2' });

      expect(res2.status).toBe(200);
      const inDb2 = mockTables.tasks.get(preTask.id);
      expect(inDb2.phase).toBe('pre_processing');
    });

    it('ensures nested payload cannot sneak a phase mutation into database', async () => {
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Nested Payload Attack',
          data: { phase: 'processing' },
          task: { phase: 'processing' },
        });

      expect(res.status).toBe(200);
      const inDb = mockTables.tasks.get(preTask.id);
      expect(inDb.phase).toBe('pre_processing');
      expect(inDb.title).toBe('Nested Payload Attack');
    });

    it('rejects phase mutation across ALL routes (/work-requests/:wrId/tasks/:taskId, /operations/tasks/:taskId, /tasks/:taskId)', async () => {
      // 1. PUT /v1/work-requests/:wrId/tasks/:taskId
      const r1 = await request(app)
        .put(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ phase: 'pre_processing' });
      expect(r1.status).toBe(400);
      expect(r1.body.code).toBe('TASK_PHASE_IMMUTABLE');

      // 2. PATCH /v1/operations/tasks/:taskId
      const r2 = await request(app)
        .patch(`/v1/operations/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ phase: 'pre_processing' });
      expect(r2.status).toBe(400);
      expect(r2.body.code).toBe('TASK_PHASE_IMMUTABLE');

      // 3. PUT /v1/tasks/:taskId
      const r3 = await request(app)
        .put(`/v1/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ phase: 'pre_processing' });
      expect(r3.status).toBe(400);
      expect(r3.body.code).toBe('TASK_PHASE_IMMUTABLE');

      // 4. PATCH /v1/tasks/:taskId
      const r4 = await request(app)
        .patch(`/v1/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ phase: 'pre_processing' });
      expect(r4.status).toBe(400);
      expect(r4.body.code).toBe('TASK_PHASE_IMMUTABLE');
    });
  });

  describe('Vector 2: Prerequisite Gate with Complex Mix (1 Completed, 1 In Progress, 1 Cancelled)', () => {
    it('blocks advancing processing task with 409 PHASE_PREREQUISITE when 1 is Completed, 1 is In Progress, 1 is Cancelled', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Done)', status: 'Completed', local_id: 'pre1' },
            { title: 'Pre Task 2 (Busy)', status: 'In Progress', local_id: 'pre2' },
            { title: 'Pre Task 3 (Dropped)', status: 'Cancelled', local_id: 'pre3' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Proc Task 1', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      // Attempt advancing from Draft to In Progress
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
      expect(res.body.detail).toContain('Pre Task 2 (Busy)');
      expect(res.body.detail).not.toContain('Pre Task 1 (Done)');
      expect(res.body.detail).not.toContain('Pre Task 3 (Dropped)');

      // Verify processing task status did NOT change
      const inDb = mockTables.tasks.get(procTask.id);
      expect(inDb.status).toBe('Draft');
    });

    it('also blocks advancing processing task from Assigned to For Review with 409', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Done)', status: 'Completed', local_id: 'pre1' },
            { title: 'Pre Task 2 (Busy)', status: 'In Progress', local_id: 'pre2' },
            { title: 'Pre Task 3 (Dropped)', status: 'Cancelled', local_id: 'pre3' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Proc Task 1', status: 'Assigned', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'For Review' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
    });
  });

  describe('Vector 3: Prerequisite Gate Resolution (2 Completed, 1 Cancelled -> 200 OK)', () => {
    it('allows clean transition of processing task once In Progress pre_processing task reaches Completed', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Done)', status: 'Completed', local_id: 'pre1' },
            { title: 'Pre Task 2 (Busy)', status: 'In Progress', local_id: 'pre2' },
            { title: 'Pre Task 3 (Dropped)', status: 'Cancelled', local_id: 'pre3' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Proc Task 1', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const busyPreTask = wr.phases.pre_processing.tasks.find((t) => t.title.includes('Busy'));
      const procTask = wr.phases.processing.tasks[0];

      // Verify initial block
      const blockedRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });
      expect(blockedRes.status).toBe(409);
      expect(blockedRes.body.code).toBe('PHASE_PREREQUISITE');

      // Now complete the busy pre_processing task (Pre Task 2)
      const completePreRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${busyPreTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });
      expect(completePreRes.status).toBe(200);
      expect(completePreRes.body.data.status).toBe('Completed');

      // Now the mix is: 2 Completed, 1 Cancelled. Advance WR to processing phase (Task A.3)
      mockTables.work_requests.get(wr.id).phase = 'processing';

      // The processing task MUST transition cleanly!
      const unblockedRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(unblockedRes.status).toBe(200);
      expect(unblockedRes.body.data.status).toBe('In Progress');
      expect(unblockedRes.body.data.phase).toBe('processing');

      // Verify it can continue through the pipeline
      const reviewRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'For Review' });
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.data.status).toBe('For Review');

      const doneRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });
      expect(doneRes.status).toBe(200);
      expect(doneRes.body.data.status).toBe('Completed');
    });
  });

  describe('Vector 4: Direct Task Creation into In Progress for Processing Phase', () => {
    it('rejects creating a processing task directly in In Progress when pre_processing tasks are incomplete with 409', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Incomplete Pre Task', status: 'Draft', local_id: 'pre1' },
          ],
        },
      });

      // Attempt to create a processing task directly in 'In Progress'
      const createRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Direct Active Processing Task',
          phase: 'processing',
          status: 'In Progress',
        });

      expect(createRes.status).toBe(409);
      expect(createRes.body.code).toBe('PHASE_PREREQUISITE');
      expect(createRes.body.detail).toMatch(/pre-processing task\(s\) are incomplete/i);
    });

    it('rejects creating a processing task directly in Completed or For Review when pre_processing tasks are incomplete with 409', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Incomplete Pre Task', status: 'In Progress', local_id: 'pre1' },
          ],
        },
      });

      const forReviewRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Direct Review Task',
          phase: 'processing',
          status: 'For Review',
        });
      expect(forReviewRes.status).toBe(409);
      expect(forReviewRes.body.code).toBe('PHASE_PREREQUISITE');

      const completedRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Direct Completed Task',
          phase: 'processing',
          status: 'Completed',
        });
      expect(completedRes.status).toBe(409);
      expect(completedRes.body.code).toBe('PHASE_PREREQUISITE');
    });

    it('allows creating a processing task in Draft or Assigned even when pre_processing tasks are incomplete (201 Created)', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Incomplete Pre Task', status: 'Draft', local_id: 'pre1' },
          ],
        },
      });

      const draftRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Draft Processing Task',
          phase: 'processing',
          status: 'Draft',
        });
      expect(draftRes.status).toBe(201);
      expect(draftRes.body.data.phase).toBe('processing');
      expect(draftRes.body.data.status).toBe('Draft');

      const assignedRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Assigned Processing Task',
          phase: 'processing',
          status: 'Assigned',
        });
      expect(assignedRes.status).toBe(201);
      expect(assignedRes.body.data.phase).toBe('processing');
      expect(assignedRes.body.data.status).toBe('Assigned');
    });

    it('allows creating a processing task directly in In Progress when all pre_processing tasks are Completed or Cancelled (201 Created)', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Done)', status: 'Completed', local_id: 'pre1' },
            { title: 'Pre Task 2 (Dropped)', status: 'Cancelled', local_id: 'pre2' },
          ],
        },
      });

      const createRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Direct Active Processing Task Allowed',
          phase: 'processing',
          status: 'In Progress',
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.status).toBe('In Progress');
      expect(createRes.body.data.phase).toBe('processing');
    });
  });

  describe('Vector 5: Cross-WR Isolation & Soft-Delete Edge Cases', () => {
    it('ensures incomplete pre_processing tasks in WR-A do NOT block processing tasks in WR-B', async () => {
      // WR-A has incomplete pre_processing task
      const wrA = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'WR-A Pre Task (Incomplete)', status: 'Draft', local_id: 'preA' }],
        },
        processing: {
          tasks: [{ title: 'WR-A Proc Task', status: 'Draft', local_id: 'procA' }],
        },
      });

      // WR-B has completed pre_processing task
      const wrB = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'WR-B Pre Task (Done)', status: 'Completed', local_id: 'preB' }],
        },
        processing: {
          tasks: [{ title: 'WR-B Proc Task', status: 'Draft', local_id: 'procB' }],
        },
      });

      const procTaskA = wrA.phases.processing.tasks[0];
      const procTaskB = wrB.phases.processing.tasks[0];

      // WR-A proc task must be blocked (409)
      const resA = await request(app)
        .patch(`/v1/work-requests/${wrA.id}/tasks/${procTaskA.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });
      expect(resA.status).toBe(409);
      expect(resA.body.code).toBe('PHASE_PREREQUISITE');

      // WR-B proc task must succeed (200) without interference from WR-A
      mockTables.work_requests.get(wrB.id).phase = 'processing';
      const resB = await request(app)
        .patch(`/v1/work-requests/${wrB.id}/tasks/${procTaskB.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });
      expect(resB.status).toBe(200);
      expect(resB.body.data.status).toBe('In Progress');
    });

    it('ensures soft-deleted incomplete pre_processing task does NOT block processing task advancement', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task to be deleted', status: 'Draft', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Proc Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const preTask = wr.phases.pre_processing.tasks[0];
      const procTask = wr.phases.processing.tasks[0];

      // Delete the pre_processing task via DELETE endpoint
      const delRes = await request(app)
        .delete(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');
      expect(delRes.status).toBe(204);

      // Now processing task can advance freely because no active pre_processing tasks remain (Task A.3)
      mockTables.work_requests.get(wr.id).phase = 'processing';
      const advRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });
      expect(advRes.status).toBe(200);
      expect(advRes.body.data.status).toBe('In Progress');
    });
  });
});
