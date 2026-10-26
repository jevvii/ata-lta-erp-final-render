/**
 * Adversarial Challenger Suite for Backend Remediation (Parcel A)
 * Challenger 1: Empirical Verification against edge cases and attack vectors
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
      name: 'Adversarial Client C1',
      tin: `999-C1-${String(Math.random()).slice(2, 7)}`,
      entity,
    });
  return res.body.data;
};

describe('Adversarial Challenger Suite: Backend UAT Remediation', () => {
  let adminToken;
  let staffToken;
  let otherStaffToken;
  let client;

  const staffId = '11111111-1111-1111-1111-111111111111';
  const otherStaffId = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      email: 'admin-challenger@ata-lta.ph',
      name: 'Admin Challenger',
      role: 'Admin',
      entities: ['ATA'],
    });

    staffToken = registerUser({
      id: staffId,
      email: 'staff-assignee@ata-lta.ph',
      name: 'Staff Assignee',
      role: 'Operations',
      entities: ['ATA'],
    });

    otherStaffToken = registerUser({
      id: otherStaffId,
      email: 'staff-other@ata-lta.ph',
      name: 'Other Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    client = await createClient(adminToken, 'ATA');
  });

  describe('1. Locked Work Requests (COMPLETED_WR_LOCKED)', () => {
    let completedWr;
    let existingTask;

    beforeEach(async () => {
      // Create WR
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'Completed Lock Test WR', clientId: client.id, entity: 'ATA' })
        .expect(201);
      completedWr = wrRes.body.data;

      // Add a task while still open
      const taskRes = await request(app)
        .post(`/v1/work-requests/${completedWr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Pre-existing Task', status: 'Assigned', assigneeId: staffId })
        .expect(201);
      existingTask = taskRes.body.data;

      // Mark WR as Completed in mock DB
      mockTables.work_requests.get(completedWr.id).status = 'Completed';
    });

    test('1.1: Rejects adding new task to completed WR via POST /work-requests/:id/tasks (400 COMPLETED_WR_LOCKED)', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${completedWr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Illegal Task After Completion' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
      expect(res.body.detail).toMatch(/Completed Work Requests are locked/i);
    });

    test('1.2: Rejects updating task via PUT /work-requests/:wrId/tasks/:taskId on completed WR (400 COMPLETED_WR_LOCKED)', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${completedWr.id}/tasks/${existingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Modified Title Disallowed' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
      expect(res.body.detail).toMatch(/Completed Work Requests are locked/i);
    });

    test('1.3: Rejects updating task via direct PUT /tasks/:taskId on completed WR (400 COMPLETED_WR_LOCKED)', async () => {
      const res = await request(app)
        .put(`/v1/tasks/${existingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Direct PUT Disallowed' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
      expect(res.body.detail).toMatch(/Completed Work Requests are locked/i);
    });

    test('1.4: Rejects updating task via PATCH /work-requests/:wrId/tasks/:taskId on completed WR (400 COMPLETED_WR_LOCKED)', async () => {
      const res = await request(app)
        .patch(`/v1/work-requests/${completedWr.id}/tasks/${existingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
      expect(res.body.detail).toMatch(/Completed Work Requests are locked/i);
    });

    test('1.5: Rejects updating task via direct PATCH /tasks/:taskId on completed WR (400 COMPLETED_WR_LOCKED)', async () => {
      const res = await request(app)
        .patch(`/v1/tasks/${existingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
      expect(res.body.detail).toMatch(/Completed Work Requests are locked/i);
    });

    test('1.6: Rejects deleting task via DELETE /work-requests/:wrId/tasks/:taskId on completed WR (400 COMPLETED_WR_LOCKED)', async () => {
      const res = await request(app)
        .delete(`/v1/work-requests/${completedWr.id}/tasks/${existingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
      expect(res.body.detail).toMatch(/Completed Work Requests are locked/i);

      // Verify task was not soft-deleted
      const taskRecord = mockTables.tasks.get(existingTask.id);
      expect(taskRecord.deleted_at).toBeFalsy();
    });

    test('1.7: Rejects deleting task via direct DELETE /tasks/:taskId on completed WR (400 COMPLETED_WR_LOCKED)', async () => {
      const res = await request(app)
        .delete(`/v1/tasks/${existingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
      expect(res.body.detail).toMatch(/Completed Work Requests are locked/i);

      // Verify task was not soft-deleted
      const taskRecord = mockTables.tasks.get(existingTask.id);
      expect(taskRecord.deleted_at).toBeFalsy();
    });

    test('1.8: Non-completed WR in completion phase is NOT locked by COMPLETED_WR_LOCKED', async () => {
      // Set WR to status 'In Progress' and phase 'completion'
      mockTables.work_requests.get(completedWr.id).status = 'In Progress';
      mockTables.work_requests.get(completedWr.id).phase = 'completion';

      const res = await request(app)
        .patch(`/v1/work-requests/${completedWr.id}/tasks/${existingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Permitted in completion phase before completed status' });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe('Permitted in completion phase before completed status');
    });
  });

  describe('2. Work Request Phase Gate (WORK_REQUEST_PHASE_NOT_ACTIVE)', () => {
    let wr;
    let preTask;
    let procTask;

    beforeEach(async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'Phase Gate Test WR', clientId: client.id, entity: 'ATA' })
        .expect(201);
      wr = wrRes.body.data;

      const preRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Pre-processing Task', phase: 'pre_processing', status: 'Assigned' })
        .expect(201);
      preTask = preRes.body.data;

      const procRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Processing Task', phase: 'processing', status: 'Assigned' })
        .expect(201);
      procTask = procRes.body.data;
    });

    test('2.1: Incomplete pre-processing tasks trigger 409 PHASE_PREREQUISITE first', async () => {
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PHASE_PREREQUISITE');
    });

    test('2.2: When pre_processing tasks are complete but WR is still in pre_processing -> 409 WORK_REQUEST_PHASE_NOT_ACTIVE', async () => {
      // Complete pre_processing task
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' })
        .expect(200);

      // Verify WR is still in pre_processing phase
      expect(mockTables.work_requests.get(wr.id).phase).toBe('pre_processing');

      // Now attempt to advance processing task
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WORK_REQUEST_PHASE_NOT_ACTIVE');
      expect(res.body.detail).toMatch(/parent work request is currently in "pre_processing" phase and has not been routed to Processing/i);
    });

    test('2.3: Processing task with NO pre_processing tasks returns 409 WORK_REQUEST_PHASE_NOT_ACTIVE while WR is in pre_processing', async () => {
      // Delete the pre_processing task so none exist
      mockTables.tasks.delete(preTask.id);

      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('WORK_REQUEST_PHASE_NOT_ACTIVE');
    });

    test('2.4: Advancing processing task to "Assigned" or "Draft" is NOT blocked by phase gate', async () => {
      // Setting status to Assigned while WR is in pre_processing
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Assigned' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Assigned');
    });

    test('2.5: Advancing pre_processing task is NOT blocked by processing phase gate', async () => {
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('In Progress');
    });

    test('2.6: Advancing processing task SUCCEEDS once WR is advanced to processing phase', async () => {
      // Complete pre_processing task
      await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${preTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' })
        .expect(200);

      // Advance WR to processing
      await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ to_phase: 'processing' })
        .expect(200);

      expect(mockTables.work_requests.get(wr.id).phase).toBe('processing');

      // Now advancing processing task succeeds
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${procTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('In Progress');
    });
  });

  describe('3. Assignee Document Authorization (FORBIDDEN_TASK_ATTACHMENT)', () => {
    let taskAssignedToStaff;
    const validTaskId = '33333333-3333-3333-3333-333333333333';
    const nonExistentTaskId = '99999999-9999-9999-9999-999999999999';

    const validDocPayload = {
      fileName: 'attachment.pdf',
      contentType: 'application/pdf',
      fileSize: 2048,
      originalName: 'Attachment.pdf',
    };

    beforeEach(async () => {
      mockTables.tasks.set(validTaskId, {
        id: validTaskId,
        work_request_id: null,
        assignee_id: staffId,
      });
      taskAssignedToStaff = mockTables.tasks.get(validTaskId);
    });

    test('3.1: Non-assignee staff receives 403 FORBIDDEN_TASK_ATTACHMENT when linking to another user task', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocPayload,
          linkedTaskId: taskAssignedToStaff.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_TASK_ATTACHMENT');
      expect(res.body.detail).toMatch(/not assigned to this task/i);
    });

    test('3.2: Primary assignee succeeds with 201 Created', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocPayload,
          linkedTaskId: taskAssignedToStaff.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.document.linked_task_id).toBe(taskAssignedToStaff.id);
    });

    test('3.3: Co-assignee member in task_assignees succeeds with 201 Created', async () => {
      // Add otherStaffId to task_assignees for this task
      const taId = 'ta-row-999';
      mockTables.task_assignees.set(taId, {
        id: taId,
        task_id: taskAssignedToStaff.id,
        user_id: otherStaffId,
      });

      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocPayload,
          linkedTaskId: taskAssignedToStaff.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.document.linked_task_id).toBe(taskAssignedToStaff.id);
    });

    test('3.4: Admin bypasses task assignment and succeeds with 201 Created', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocPayload,
          linkedTaskId: taskAssignedToStaff.id,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.document.linked_task_id).toBe(taskAssignedToStaff.id);
    });

    test('3.5: Non-existent linkedTaskId returns 400 Validation Error', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocPayload,
          linkedTaskId: nonExistentTaskId,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/does not exist/i);
    });
  });

  describe('4. Disbursement Scoping without ___NONE___', () => {
    const WR_ID = 'wr-disb-scoping-1';

    beforeEach(() => {
      // Set concerned tasks for WR_ID
      mockTables.tasks.set('task-disb-staff', {
        id: 'task-disb-staff',
        work_request_id: WR_ID,
        assignee_id: staffId,
        deleted_at: null,
      });
      mockTables.tasks.set('task-disb-other', {
        id: 'task-disb-other',
        work_request_id: WR_ID,
        assignee_id: otherStaffId,
        deleted_at: null,
      });

      // Seed 1: Draft created by staffId
      mockTables.disbursements.set('disb-draft-staff', {
        id: 'disb-draft-staff',
        entity_id: 'ent-ata',
        category: 'Supplies',
        description: 'Staff draft',
        amount: 150,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffId,
        employee_id: null,
        linked_work_request_id: WR_ID,
        archived: false,
      });

      // Seed 2: Pending where employee is otherStaffId
      mockTables.disbursements.set('disb-pending-other', {
        id: 'disb-pending-other',
        entity_id: 'ent-ata',
        category: 'Travel',
        description: 'Other staff pending travel',
        amount: 300,
        fund_source: 'Firm Fund',
        status: 'Pending',
        created_by: 'someone-else',
        requested_by: otherStaffId,
        employee_id: otherStaffId,
        linked_work_request_id: WR_ID,
        archived: false,
      });

      // Seed 3: Released disbursement
      mockTables.disbursements.set('disb-released-common', {
        id: 'disb-released-common',
        entity_id: 'ent-ata',
        category: 'Filing',
        description: 'Common released filing',
        amount: 500,
        fund_source: 'Firm Fund',
        status: 'Released',
        created_by: 'third-party',
        employee_id: null,
        linked_work_request_id: WR_ID,
        archived: false,
      });
    });

    test('4.1: Creator querying status=Draft receives their draft disbursement', async () => {
      const res = await request(app)
        .get('/v1/disbursements?status=Draft')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.some((d) => d.id === 'disb-draft-staff')).toBe(true);
      expect(res.body.data.some((d) => d.id === 'disb-pending-other')).toBe(false);
    });

    test('4.2: Creator querying without status filter receives their draft, but not third-party released or other employee pending', async () => {
      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.some((d) => d.id === 'disb-draft-staff')).toBe(true);
      expect(res.body.data.some((d) => d.id === 'disb-released-common')).toBe(false);
      expect(res.body.data.some((d) => d.id === 'disb-pending-other')).toBe(false);
    });

    test('4.3: Employee querying status=Pending receives disbursement where they are employee_id', async () => {
      const res = await request(app)
        .get('/v1/disbursements?status=Pending')
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.some((d) => d.id === 'disb-pending-other')).toBe(true);
      expect(res.body.data.some((d) => d.id === 'disb-draft-staff')).toBe(false);
    });

    test('4.4: Other user cannot view staff draft via GET /v1/disbursements/:id (403 Forbidden)', async () => {
      await request(app)
        .get('/v1/disbursements/disb-draft-staff')
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);
    });

    test('4.5: Admin sees all disbursements regardless of creator or employee', async () => {
      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.some((d) => d.id === 'disb-draft-staff')).toBe(true);
      expect(res.body.data.some((d) => d.id === 'disb-pending-other')).toBe(true);
      expect(res.body.data.some((d) => d.id === 'disb-released-common')).toBe(true);
    });
  });

  describe('5. Assignee Task Status Updates (PUT and PATCH)', () => {
    let task;
    let wr;

    beforeEach(async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'Task Status Assignee Test WR', clientId: client.id, entity: 'ATA' })
        .expect(201);
      wr = wrRes.body.data;

      const taskRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Pre Task for Assignee', phase: 'pre_processing', status: 'Assigned', assigneeId: staffId })
        .expect(201);
      task = taskRes.body.data;
    });

    test('5.1: Assignee can update status to "In Progress" via PUT /v1/tasks/:taskId', async () => {
      const res = await request(app)
        .put(`/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('In Progress');
    });

    test('5.2: Assignee can update status to "Completed" via PATCH /v1/work-requests/:wrId/tasks/:taskId', async () => {
      const res = await request(app)
        .patch(`/v1/work-requests/${wr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Completed' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Completed');
    });

    test('5.3: Assignee attempting to modify non-status fields via PUT receives 403 Forbidden', async () => {
      const res = await request(app)
        .put(`/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress', title: 'Tampered Title' });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('Assignees may only update task status');

      // Verify title was not changed
      expect(mockTables.tasks.get(task.id).title).toBe('Pre Task for Assignee');
    });

    test('5.4: Assignee attempting to modify non-status fields via PATCH receives 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress', description: 'Tampered Description' });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('Assignees may only update task status');
    });

    test('5.5: Non-assignee staff receives 403 Forbidden on PUT or PATCH', async () => {
      const resPut = await request(app)
        .put(`/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(resPut.status).toBe(403);

      const resPatch = await request(app)
        .patch(`/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${otherStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'In Progress' });

      expect(resPatch.status).toBe(403);
    });

    test('5.6: Assignee attempting to set disallowed status receives 400 Bad Request', async () => {
      const res = await request(app)
        .put(`/v1/tasks/${task.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Draft' });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/Assignees may only update task status to "In Progress" or "Completed"/i);
    });
  });

  describe('6. Related Tasks Route (Task A.1) and Predecessors (Task A.7)', () => {
    let wr;
    let predTask;
    let task;

    beforeEach(async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'Related Route WR', clientId: client.id, entity: 'ATA' })
        .expect(201);
      wr = wrRes.body.data;

      const predRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Predecessor Task A', status: 'Completed' })
        .expect(201);
      predTask = predRes.body.data;

      const taskRes = await request(app)
        .post(`/v1/work-requests/${wr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Dependent Main Task',
          status: 'Assigned',
          predecessors: [predTask.id],
        })
        .expect(201);
      task = taskRes.body.data;
    });

    test('6.1: GET /operations/tasks/:id/related returns related data with 200 OK', async () => {
      const res = await request(app)
        .get(`/v1/operations/tasks/${task.id}/related`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.invoices).toBeDefined();
      expect(res.body.data.disbursements).toBeDefined();
      expect(res.body.data.transmittals).toBeDefined();
    });

    test('6.2: GET /operations/work-requests/:wrId/tasks/:id/related returns related data with 200 OK', async () => {
      const res = await request(app)
        .get(`/v1/operations/work-requests/${wr.id}/tasks/${task.id}/related`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.invoices).toBeDefined();
      expect(res.body.data.disbursements).toBeDefined();
      expect(res.body.data.transmittals).toBeDefined();
    });

    test('6.3: Predecessor details are hydrated on task fetch with title and status', async () => {
      const res = await request(app)
        .get(`/v1/work-requests/${wr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.predecessors).toEqual([predTask.id]);
      expect(res.body.data.predecessorDetails).toHaveLength(1);
      expect(res.body.data.predecessorDetails[0]).toEqual({
        id: predTask.id,
        title: 'Predecessor Task A',
        status: 'Completed',
      });
    });
  });
});
