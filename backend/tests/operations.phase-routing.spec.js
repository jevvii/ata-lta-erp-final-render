/**
 * P0-D PR-2 Test Suite: Phase-Lock Guards & Prerequisite Gates
 *
 * Verifies:
 * 1. Task Phase-Lock Guard:
 *    - Tasks receive phase from their section at creation (pre_processing or processing).
 *    - Task phase is immutable thereafter: any attempt to update, alter, or patch phase
 *      via PUT/PATCH /v1/work-requests/:wrId/tasks/:taskId, /v1/operations/tasks/:taskId,
 *      or /v1/tasks/:taskId returns 400 Bad Request with code: 'TASK_PHASE_IMMUTABLE'.
 * 2. Prerequisite Gates (Rule R5 & Spec §3.2):
 *    - A processing task cannot transition out of Draft or Assigned (e.g. to In Progress,
 *      For Review, Completed) while ANY active (non-Cancelled) pre_processing task of the
 *      same WR is not Completed -> returns 409 Conflict with code: 'PHASE_PREREQUISITE'.
 *    - Once all active pre_processing tasks of the same WR are Completed, the processing
 *      task transition succeeds with 200 OK.
 * 3. Cancelled Tasks Exclusion:
 *    - Cancelled pre_processing tasks are strictly excluded from the prerequisite gate check.
 *    - Cancelled pre_processing tasks do NOT block processing tasks.
 *    - Cancelling a processing task is allowed even if pre_processing tasks are open.
 * 4. Phase Model API Cleanliness:
 *    - toApiTask and toApiWorkRequest return phase, qaStatus/qa_status, phase_entered_at,
 *      and assignees with attribution.
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
      name: 'Phase Routing Test Client',
      tin: `999-000-${String(Math.random()).slice(2, 7)}`,
      entity,
    });
  return res.body.data;
};

describe('P0-D: Phase-Lock Guards, Prerequisite Gates & Phase Routing Operations', () => {
  let adminToken;
  let adminUser;
  let managerToken;
  let managerUser;
  let staffToken;
  let staffUser;
  let client;

  beforeEach(async () => {
    resetMock();
    seedDefaults();
    if (!mockTables.notifications) {
      mockTables.notifications = new Map();
    }
    mockTables.notifications.clear();

    adminUser = {
      id: '99999999-8888-7777-6666-555555555555',
      email: 'admin-routing@ata-lta.ph',
      name: 'Admin Routing',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    };
    adminToken = registerUser(adminUser);

    managerUser = {
      id: '88888888-8888-8888-8888-888888888888',
      email: 'manager-routing@ata-lta.ph',
      name: 'Manager Routing',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA', 'LTA'],
    };
    managerToken = registerUser(managerUser);

    staffUser = {
      id: '77777777-7777-7777-7777-777777777777',
      email: 'staff-routing@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
    };
    staffToken = registerUser(staffUser);

    client = await createClient(adminToken, 'ATA');
  });

  const createWorkRequestWithPhases = async (phasesConfig) => {
    const res = await request(app)
      .post('/v1/operations/work-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        dueDate: '2026-12-31',
        title: 'Phase Routing Integration WR',
        clientId: client.id,
        entity: 'ATA',
        phases: phasesConfig,
      });
    return res.body.data;
  };

  describe('1. Task Phase-Lock Guard (Task Phase Immutability)', () => {
    it('rejects attempt to mutate task phase via PUT /v1/work-requests/:wrId/tasks/:taskId with 400 Bad Request', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const preTask = wr.phases.pre_processing.tasks[0];
      expect(preTask.phase).toBe('pre_processing');

      // Attempt to mutate phase to 'processing'
      const putRes = await request(app)
        .put(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Pre Task 1 Renamed',
          phase: 'processing',
        });

      expect(putRes.status).toBe(400);
      expect(putRes.body.code).toBe('TASK_PHASE_IMMUTABLE');
      expect(putRes.body.detail).toMatch(/phase is immutable/i);

      // Verify phase remained unchanged in DB
      const taskInDb = mockTables.tasks.get(preTask.id);
      expect(taskInDb.phase).toBe('pre_processing');
    });

    it('rejects attempt to mutate task phase via PATCH /v1/work-requests/:wrId/tasks/:taskId with 400 Bad Request', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const task = wr.phases.pre_processing.tasks[0];

      const patchRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          phase: 'processing',
        });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.code).toBe('TASK_PHASE_IMMUTABLE');
    });

    it('rejects attempt to mutate task phase via PUT /v1/operations/tasks/:taskId with 400 Bad Request', async () => {
      const wr = await createWorkRequestWithPhases({
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const putRes = await request(app)
        .put(`/v1/operations/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          phase: 'pre_processing',
        });

      expect(putRes.status).toBe(400);
      expect(putRes.body.code).toBe('TASK_PHASE_IMMUTABLE');
    });

    it('rejects attempt to mutate task phase via PATCH /v1/operations/tasks/:taskId with 400 Bad Request', async () => {
      const wr = await createWorkRequestWithPhases({
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const patchRes = await request(app)
        .patch(`/v1/operations/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          phase: 'pre_processing',
        });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.code).toBe('TASK_PHASE_IMMUTABLE');
    });

    it('rejects attempt to mutate task phase via PATCH /v1/tasks/:taskId with 400 Bad Request', async () => {
      const wr = await createWorkRequestWithPhases({
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const patchRes = await request(app)
        .patch(`/v1/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          phase: null,
        });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.code).toBe('TASK_PHASE_IMMUTABLE');
    });

    it('rejects setting phase even if passed identical to existing phase value', async () => {
      const wr = await createWorkRequestWithPhases({
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const patchRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          phase: 'processing',
        });

      expect(patchRes.status).toBe(400);
      expect(patchRes.body.code).toBe('TASK_PHASE_IMMUTABLE');
    });

    it('allows updating non-phase task properties (title, description, dueDate) without error', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', description: 'Original', local_id: 'pre1' }],
        },
      });

      const preTask = wr.phases.pre_processing.tasks[0];

      const patchRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Updated Pre Task 1 Title',
          description: 'Updated Description',
        });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.title).toBe('Updated Pre Task 1 Title');
      expect(patchRes.body.data.description).toBe('Updated Description');
      expect(patchRes.body.data.phase).toBe('pre_processing');
    });
  });

  describe('2. Prerequisite Gates (Rule R5 & Spec §3.2)', () => {
    it('rejects advancing a processing task out of Draft while pre_processing tasks are open with 409 PHASE_PREREQUISITE', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Incomplete Pre Task', status: 'Draft', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      // Attempt to advance processing task to 'In Progress'
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'In Progress',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
      expect(res.body.detail).toMatch(/pre-processing task/i);
    });

    it('rejects advancing a processing task out of Assigned while a pre_processing task is In Progress with 409', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task In Progress', status: 'In Progress', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task Assigned', status: 'Assigned', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const res = await request(app)
        .put(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'In Progress',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
    });

    it('rejects advancing a processing task directly to Completed while pre_processing tasks are open with 409', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Open Pre Task', status: 'Draft', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Completed',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
    });

    it('rejects advancing a processing task to For Review while pre_processing tasks are open with 409', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Open Pre Task', status: 'In Progress', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'For Review',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
    });

    it('allows transitioning a processing task between Draft and Assigned without 409', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Open Pre Task', status: 'Draft', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      // Updating from Draft to Assigned is NOT advancing out of Draft/Assigned
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Assigned',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Assigned');
    });

    it('allows updating non-status fields of a processing task while pre_processing tasks are open', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Open Pre Task', status: 'Draft', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          description: 'Updated draft processing task description',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.description).toBe('Updated draft processing task description');
      expect(res.body.data.status).toBe('Draft');
    });

    it('allows advancing pre_processing tasks freely without prerequisite blocking', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1', status: 'Draft', local_id: 'pre1' },
            { title: 'Pre Task 2', status: 'Draft', local_id: 'pre2' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const preTask1 = wr.phases.pre_processing.tasks[0];

      // Advancing Pre Task 1 to In Progress while Pre Task 2 is Draft is completely valid
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask1.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'In Progress',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('In Progress');
    });
  });

  describe('3. Prerequisite Gate Resolution (Advancement Succeeds When All Pre-processing Completed)', () => {
    it('allows advancing a processing task out of Draft once all pre_processing tasks are Completed', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1', status: 'Draft', local_id: 'pre1' },
            { title: 'Pre Task 2', status: 'Draft', local_id: 'pre2' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const [pre1, pre2] = wr.phases.pre_processing.tasks;
      const procTask = wr.phases.processing.tasks[0];

      // Complete Pre Task 1
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      // Processing task still blocked because Pre Task 2 is not completed
      const blockedRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });
      expect(blockedRes.status).toBe(409);
      expect(blockedRes.body.code).toBe('PHASE_PREREQUISITE');

      // Complete Pre Task 2
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre2.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      // Before advancing WR: advance processing task returns 409 WORK_REQUEST_PHASE_NOT_ACTIVE
      const phaseBlockedRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });
      expect(phaseBlockedRes.status).toBe(409);
      expect(phaseBlockedRes.body.code).toBe('WORK_REQUEST_PHASE_NOT_ACTIVE');

      // Advance WR to processing
      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      // Now all pre_processing tasks are Completed and WR is in processing -> advancing processing task succeeds!
      const successRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(successRes.status).toBe(200);
      expect(successRes.body.data.status).toBe('In Progress');
      expect(successRes.body.data.phase).toBe('processing');
    });

    it('allows subsequent advancement of processing task through review and completion', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1', status: 'Completed', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'In Progress', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      // Advance to For Review
      const reviewRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'For Review' });
      expect(reviewRes.status).toBe(200);
      expect(reviewRes.body.data.status).toBe('For Review');

      // Advance to Completed
      const completedRes = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });
      expect(completedRes.status).toBe(200);
      expect(completedRes.body.data.status).toBe('Completed');
    });
  });

  describe('4. Cancelled Tasks Exclusion (Spec §3.2)', () => {
    it('does NOT block processing task when one pre_processing task is Completed and another is Cancelled', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Completed)', status: 'Completed', local_id: 'pre1' },
            { title: 'Pre Task 2 (Cancelled)', status: 'Cancelled', local_id: 'pre2' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      // Advance WR to processing
      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      // Cancelled task is strictly excluded from prerequisite check
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('In Progress');
    });

    it('does NOT block processing task when ALL pre_processing tasks are Cancelled', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Cancelled)', status: 'Cancelled', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      // Advance WR to processing
      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('In Progress');
    });

    it('still blocks processing task if a Cancelled pre_processing task exists alongside an incomplete active task', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Cancelled)', status: 'Cancelled', local_id: 'pre1' },
            { title: 'Pre Task 2 (Draft)', status: 'Draft', local_id: 'pre2' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
    });

    it('allows cancelling a processing task even when pre_processing tasks are open', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task Open', status: 'Draft', local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Processing Task', status: 'Draft', local_id: 'proc1' },
          ],
        },
      });

      const procTask = wr.phases.processing.tasks[0];

      // Cancelling processing task is allowed
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Cancelled' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Cancelled');
    });
  });

  describe('5. Phase Model & Assignees Attribution in API Contracts', () => {
    it('returns phase model fields cleanly in work request and task endpoints', async () => {
      const staffUser = {
        id: '11111111-2222-3333-4444-555555555555',
        email: 'staff-assignee@ata-lta.ph',
        name: 'Staff Assignee',
        role: 'Operations',
        entities: ['ATA'],
      };
      registerUser(staffUser);

      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            {
              title: 'Attributed Pre Task',
              assignees: [staffUser.id],
              local_id: 'pre1',
            },
          ],
        },
        processing: {
          tasks: [
            {
              title: 'Attributed Proc Task',
              assignees: [staffUser.id],
              local_id: 'proc1',
            },
          ],
        },
      });

      // Verify work request fields
      expect(wr.phase).toBe('pre_processing');
      expect(wr).toHaveProperty('onHold');
      expect(wr).toHaveProperty('phaseEnteredAt');
      expect(wr.phases.pre_processing.tasks).toHaveLength(1);
      expect(wr.phases.processing.tasks).toHaveLength(1);

      // Verify task fields via GET /v1/work-requests/:wrId/tasks/:taskId
      const preTaskId = wr.phases.pre_processing.tasks[0].id;
      const getTaskRes = await request(app)
        .get(`/v1/work-requests/${wr.id}/tasks/${preTaskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(getTaskRes.status).toBe(200);
      const taskData = getTaskRes.body.data;

      expect(taskData.phase).toBe('pre_processing');
      expect(taskData.qaStatus).toBe('none');
      expect(taskData.qa_status).toBe('none');
      expect(taskData.assignees).toContain(staffUser.id);
      expect(taskData.assignedBy).toBe(adminUser.id);

      // Verify task fields via GET /v1/work-requests/:id
      const getWrRes = await request(app)
        .get(`/v1/work-requests/${wr.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(getWrRes.status).toBe(200);
      const wrData = getWrRes.body.data;
      expect(wrData.phase).toBe('pre_processing');
    });
  });

  describe('6. Advancement Gate Matrix & Direct Advance (Spec §3.4)', () => {
    it('pre_processing -> processing gate fails (409) when an active pre_processing task is incomplete', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Draft)', local_id: 'pre1' },
          ],
        },
      });

      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ADVANCEMENT_GATE_FAILED');
      expect(res.body.detail).toMatch(/pre-processing task\(s\) are incomplete/i);

      // Verify phase remained pre_processing in DB
      const wrInDb = mockTables.work_requests.get(wr.id);
      expect(wrInDb.phase).toBe('pre_processing');
    });

    it('pre_processing -> processing gate succeeds (200) when all active pre_processing tasks are Completed', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1', local_id: 'pre1' },
            { title: 'Pre Task 2 (To Cancel)', local_id: 'pre2' },
          ],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      const pre2Id = wr.phases.pre_processing.tasks[1].id;

      // Complete pre1, cancel pre2
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Cancelled' });

      // Direct advance without specifying to_phase (defaults to next phase: processing)
      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.data.phase).toBe('processing');
      expect(res.body.data.status).toBe('Processing');

      // Verify notification emitted with { via: 'direct' }
      const notifs = Array.from(mockTables.notifications.values());
      const resolvedNotif = notifs.find(
        (n) => n.type === 'wr.transition_request.resolved' && n.payload.work_request_id === wr.id
      );
      expect(resolvedNotif).toBeTruthy();
      expect(resolvedNotif.payload.via).toBe('direct');
      expect(resolvedNotif.payload.outcome).toBe('approved');
      expect(resolvedNotif.payload.to_phase).toBe('processing');
    });

    it('processing -> quality_assurance gate fails (409) when an active processing task is incomplete', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      const proc1Id = wr.phases.processing.tasks[0].id;

      // Complete pre1 and advance WR to processing
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      // Move proc1 to In Progress (still incomplete)
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${proc1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      const res = await request(app)
        .post(`/v1/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ADVANCEMENT_GATE_FAILED');
      expect(res.body.detail).toMatch(/processing task\(s\) are incomplete/i);
    });

    it('processing -> quality_assurance gate succeeds (200) when all active processing tasks are Completed', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      const proc1Id = wr.phases.processing.tasks[0].id;

      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${proc1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      expect(res.status).toBe(200);
      expect(res.body.data.phase).toBe('quality_assurance');
      expect(res.body.data.status).toBe('Quality Assurance');
    });

    it('quality_assurance -> completion gate fails (409) if any task has qa_status !== passed', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      const proc1Id = wr.phases.processing.tasks[0].id;

      // Complete tasks and advance to QA
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${proc1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      // Attempt advance to completion while qa_status is 'none'
      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'completion' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('ADVANCEMENT_GATE_FAILED');
      expect(res.body.detail).toMatch(/qa_status = "passed"/i);
    });

    it('quality_assurance -> completion gate succeeds (200) when all tasks are Completed and qa_status is passed', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      const proc1Id = wr.phases.processing.tasks[0].id;

      // Complete tasks and advance to QA
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${proc1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      // QA Review: pass both tasks
      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/qa-review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          results: [
            { task_id: pre1Id, qa_status: 'passed' },
            { task_id: proc1Id, qa_status: 'passed' },
          ],
        });

      // Now advance to completion
      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'completion' });

      expect(res.status).toBe(200);
      expect(res.body.data.phase).toBe('completion');
      expect(res.body.data.status).toBe('Completed');
    });

    it('rejects direct jump skipping intermediate phases with 409 Conflict', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      // Direct jump from pre_processing to completion -> 409
      const jump1 = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'completion' });

      expect(jump1.status).toBe(409);
      expect(jump1.body.code).toBe('INVALID_PHASE_TRANSITION');
      expect(jump1.body.detail).toMatch(/Direct jump from "pre_processing" to "completion" is not permitted/i);

      // Direct jump from pre_processing to quality_assurance -> 409
      const jump2 = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      expect(jump2.status).toBe(409);
      expect(jump2.body.code).toBe('INVALID_PHASE_TRANSITION');
    });

    it('returns 403 Forbidden when non-Admin (Manager or Staff) calls POST /advance', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      // Manager POST /advance -> 403
      const mgrRes = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      expect(mgrRes.status).toBe(403);

      // Staff POST /advance -> 403
      const staffRes = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      expect(staffRes.status).toBe(403);
    });
  });

  describe('7. Transition Requests Pipeline (operationsRequests module)', () => {
    it('Manager can create wr_phase_transition request (201) and emits notification to Admins', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      // Complete task so gate passes
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      const reqRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          request_type: 'wr_phase_transition',
          payload: {
            work_request_id: wr.id,
            from_phase: 'pre_processing',
            to_phase: 'processing',
          },
          notes: 'Pre-processing tasks completed, ready for processing',
        });

      expect(reqRes.status).toBe(201);
      const reqData = reqRes.body.data;
      expect(reqData.type).toBe('wr_phase_transition');
      expect(reqData.status).toBe('pending');
      expect(reqData.work_request_id).toBe(wr.id);

      // Verify notification emitted to Admin users
      const notifs = Array.from(mockTables.notifications.values());
      const receivedNotif = notifs.find(
        (n) => n.type === 'wr.transition_request.received' && n.payload.work_request_id === wr.id
      );
      expect(receivedNotif).toBeTruthy();
      expect(receivedNotif.user_id).toBe(adminUser.id);
      expect(receivedNotif.payload.from_phase).toBe('pre_processing');
      expect(receivedNotif.payload.to_phase).toBe('processing');
    });

    it('Staff without workflow:transition_request receives 403 Forbidden on transition request creation', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const reqRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          request_type: 'wr_phase_transition',
          payload: {
            work_request_id: wr.id,
            from_phase: 'pre_processing',
            to_phase: 'processing',
          },
        });

      expect(reqRes.status).toBe(403);
    });

    it('rejects transition request creation with 409 if WR current phase does not match from_phase', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const reqRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          request_type: 'wr_phase_transition',
          payload: {
            work_request_id: wr.id,
            from_phase: 'processing', // WR is currently pre_processing
            to_phase: 'quality_assurance',
          },
        });

      expect(reqRes.status).toBe(409);
      expect(reqRes.body.detail).toMatch(/does not match requested from_phase/i);
    });

    it('rejects transition request creation with 409 if advancement gate fails', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1 (Draft)', local_id: 'pre1' }],
        },
      });

      // Tasks are open, so gate fails
      const reqRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          request_type: 'wr_phase_transition',
          payload: {
            work_request_id: wr.id,
            from_phase: 'pre_processing',
            to_phase: 'processing',
          },
        });

      expect(reqRes.status).toBe(409);
      expect(reqRes.body.code).toBe('ADVANCEMENT_GATE_FAILED');
    });

    it('Manager attempting PUT /operations-requests/:id to fulfill receives 403 Forbidden', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      const reqRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          request_type: 'wr_phase_transition',
          payload: {
            work_request_id: wr.id,
            from_phase: 'pre_processing',
            to_phase: 'processing',
          },
        });

      const requestId = reqRes.body.data.id;

      // Manager attempts to fulfill -> 403 Forbidden
      const fulfillRes = await request(app)
        .put(`/v1/operations-requests/${requestId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'fulfilled' });

      expect(fulfillRes.status).toBe(403);
    });

    it('Admin fulfills transition request: advances WR phase and emits resolved notification', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      const reqRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          request_type: 'wr_phase_transition',
          payload: {
            work_request_id: wr.id,
            from_phase: 'pre_processing',
            to_phase: 'processing',
          },
        });

      const requestId = reqRes.body.data.id;

      // Admin fulfills
      const fulfillRes = await request(app)
        .put(`/v1/operations-requests/${requestId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'fulfilled' });

      expect(fulfillRes.status).toBe(200);
      expect(fulfillRes.body.data.status).toBe('fulfilled');

      // Verify WR phase in DB
      const wrInDb = mockTables.work_requests.get(wr.id);
      expect(wrInDb.phase).toBe('processing');
      expect(wrInDb.status).toBe('Processing');

      // Verify notification emitted to Manager (requester)
      const notifs = Array.from(mockTables.notifications.values());
      const resolvedNotif = notifs.find(
        (n) => n.type === 'wr.transition_request.resolved' && n.payload.request_id === requestId
      );
      expect(resolvedNotif).toBeTruthy();
      expect(resolvedNotif.user_id).toBe(managerUser.id);
      expect(resolvedNotif.payload.outcome).toBe('approved');
      expect(resolvedNotif.payload.to_phase).toBe('processing');
    });

    it('Admin rejects transition request: requires rejectionReason and emits rejected notification', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      const reqRes = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          request_type: 'wr_phase_transition',
          payload: {
            work_request_id: wr.id,
            from_phase: 'pre_processing',
            to_phase: 'processing',
          },
        });

      const requestId = reqRes.body.data.id;

      // Reject without reason -> 400 Bad Request
      const rejectNoReason = await request(app)
        .put(`/v1/operations-requests/${requestId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'rejected' });

      expect(rejectNoReason.status).toBe(400);

      // Reject with reason -> 200 OK
      const rejectRes = await request(app)
        .put(`/v1/operations-requests/${requestId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'rejected',
          rejectionReason: 'Missing document validation from client',
        });

      expect(rejectRes.status).toBe(200);
      expect(rejectRes.body.data.status).toBe('rejected');
      expect(rejectRes.body.data.rejection_reason).toBe('Missing document validation from client');

      // WR phase remains unchanged
      const wrInDb = mockTables.work_requests.get(wr.id);
      expect(wrInDb.phase).toBe('pre_processing');

      // Verify notification emitted to Manager
      const notifs = Array.from(mockTables.notifications.values());
      const rejectedNotif = notifs.find(
        (n) => n.type === 'wr.transition_request.resolved' && n.payload.request_id === requestId
      );
      expect(rejectedNotif).toBeTruthy();
      expect(rejectedNotif.user_id).toBe(managerUser.id);
      expect(rejectedNotif.payload.outcome).toBe('rejected');
      expect(rejectedNotif.payload.reason).toBe('Missing document validation from client');
    });
  });

  describe('8. QA Review Endpoint (Spec §3.5)', () => {
    it('returns 409 Conflict if WR is not in quality_assurance phase', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const taskId = wr.phases.pre_processing.tasks[0].id;

      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/qa-review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          results: [{ task_id: taskId, qa_status: 'passed' }],
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_PHASE_FOR_QA_REVIEW');
    });

    it('returns 403 Forbidden when non-Admin calls QA review', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/qa-review`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          results: [{ task_id: wr.phases.pre_processing.tasks[0].id, qa_status: 'passed' }],
        });

      expect(res.status).toBe(403);
    });

    it('updates qa_status on tasks and logs audit row on successful QA review', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
        processing: {
          tasks: [{ title: 'Proc Task 1', local_id: 'proc1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      const proc1Id = wr.phases.processing.tasks[0].id;

      // Complete tasks and advance to QA
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${proc1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      // QA Review: pre1 passes, proc1 fails
      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/qa-review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          results: [
            { task_id: pre1Id, qa_status: 'passed' },
            { task_id: proc1Id, qa_status: 'failed' },
          ],
        });

      expect(res.status).toBe(200);

      // Verify task statuses in DB
      const pre1InDb = mockTables.tasks.get(pre1Id);
      const proc1InDb = mockTables.tasks.get(proc1Id);
      expect(pre1InDb.qa_status).toBe('passed');
      expect(proc1InDb.qa_status).toBe('failed');

      // Verify audit row logged
      const auditRows = Array.from(mockTables.audit_logs.values());
      const qaAudit = auditRows.find(
        (a) => a.action === 'work_request.qa_review' && a.record_id === wr.id
      );
      expect(qaAudit).toBeTruthy();
      expect(qaAudit.details.evaluations).toHaveLength(2);
    });
  });

  describe('9. Reroute Endpoint (Spec §3.6)', () => {
    it('returns 409 Conflict if WR is not in quality_assurance phase', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/reroute`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          to_phase: 'pre_processing',
          reason: 'Need rework',
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_PHASE_FOR_REROUTE');
    });

    it('returns 400 Bad Request if reason is missing or empty', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      // Advance directly into quality_assurance
      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      const res = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/reroute`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          to_phase: 'processing',
          reason: '   ', // empty whitespace
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/reason is required/i);
    });

    it('reopens ONLY failed tasks (In Progress, qa_status: none), leaves passed tasks untouched, and notifies assignees', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [
            { title: 'Pre Task 1 (Passed)', assignees: [staffUser.id], local_id: 'pre1' },
          ],
        },
        processing: {
          tasks: [
            { title: 'Proc Task 1 (Failed)', assignees: [staffUser.id], local_id: 'proc1' },
            { title: 'Proc Task 2 (Cancelled)', local_id: 'proc2' },
          ],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      const proc1Id = wr.phases.processing.tasks[0].id;
      const proc2Id = wr.phases.processing.tasks[1].id;

      // Complete pre1 and advance to processing
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      // Complete proc1, cancel proc2, advance to QA
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${proc1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${proc2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Cancelled' });

      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'quality_assurance' });

      // QA Review: pre1 passes, proc1 fails
      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/qa-review`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          results: [
            { task_id: pre1Id, qa_status: 'passed' },
            { task_id: proc1Id, qa_status: 'failed' },
          ],
        });

      // Clear notifications before reroute to test emission
      mockTables.notifications.clear();

      // Admin executes reroute back to processing
      const rerouteRes = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/reroute`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          to_phase: 'processing',
          reason: 'Tax calculation mismatch on Proc Task 1',
        });

      expect(rerouteRes.status).toBe(200);

      // Verify WR phase and status in DB
      const wrInDb = mockTables.work_requests.get(wr.id);
      expect(wrInDb.phase).toBe('processing');
      expect(wrInDb.status).toBe('Processing');

      // Verify ONLY proc1 was reopened
      const proc1InDb = mockTables.tasks.get(proc1Id);
      expect(proc1InDb.status).toBe('In Progress');
      expect(proc1InDb.qa_status).toBe('none');

      // Passed pre1 remains untouched
      const pre1InDb = mockTables.tasks.get(pre1Id);
      expect(pre1InDb.status).toBe('Completed');
      expect(pre1InDb.qa_status).toBe('passed');

      // Cancelled proc2 remains untouched
      const proc2InDb = mockTables.tasks.get(proc2Id);
      expect(proc2InDb.status).toBe('Cancelled');
      expect(proc2InDb.qa_status).toBe('none');

      // Verify audit row logged
      const auditRows = Array.from(mockTables.audit_logs.values());
      const rerouteAudit = auditRows.find(
        (a) => a.action === 'work_request.reroute' && a.record_id === wr.id
      );
      expect(rerouteAudit).toBeTruthy();
      expect(rerouteAudit.details.reason).toBe('Tax calculation mismatch on Proc Task 1');
      expect(rerouteAudit.details.reopened_task_ids).toEqual([proc1Id]);

      // Verify wr.qa_reroute notification emitted to assignee (staffUser)
      const notifs = Array.from(mockTables.notifications.values());
      const rerouteNotif = notifs.find(
        (n) => n.type === 'wr.qa_reroute' && n.payload.work_request_id === wr.id
      );
      expect(rerouteNotif).toBeTruthy();
      expect(rerouteNotif.user_id).toBe(staffUser.id);
      expect(rerouteNotif.payload.to_phase).toBe('processing');
      expect(rerouteNotif.payload.reason).toBe('Tax calculation mismatch on Proc Task 1');
      expect(rerouteNotif.payload.failed_task_ids).toEqual([proc1Id]);
    });
  });

  describe('10. Audit Trail Verification (Rule R8 & Spec §3.5/§3.6)', () => {
    it('verifies audit logs contain before and after phase states for all operations', async () => {
      const wr = await createWorkRequestWithPhases({
        pre_processing: {
          tasks: [{ title: 'Pre Task 1', local_id: 'pre1' }],
        },
      });

      const pre1Id = wr.phases.pre_processing.tasks[0].id;
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${pre1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      // Direct advance logs work_request.phase_advance
      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' });

      const auditRows = Array.from(mockTables.audit_logs.values());
      const advanceAudit = auditRows.find(
        (a) =>
          a.action === 'work_request.phase_advance' &&
          a.record_id === wr.id &&
          a.details.to_phase === 'processing'
      );

      expect(advanceAudit).toBeTruthy();
      expect(advanceAudit.details.from_phase).toBe('pre_processing');
      expect(advanceAudit.details.before).toBeDefined();
      expect(advanceAudit.details.after).toBeDefined();
    });
  });
});
