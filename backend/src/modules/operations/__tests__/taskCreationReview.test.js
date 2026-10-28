/**
 * Comprehensive Tests for Parcel 2: Task Creation Approval Review
 * Covers CONTRACT.md Policies R3 through R8 and HTTP endpoints.
 */

jest.mock('../../../services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../../tests/fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../../../../tests/helpers/testServer');
const { registerUser, seedDefaults, resetMock } = require('../../../../tests/fixtures/supabaseMock');

describe('Parcel 2: Task Creation Approval Review', () => {
  let adminToken;
  let adminUser;
  let managerLeadToken;
  let managerLeadUser;
  let managerOtherToken;
  let managerOtherUser;
  let _managerLtaOnlyToken;
  let managerLtaOnlyUser;
  let employeeToken;
  let employeeUser;
  let employee2Token;
  let employee2User;
  let client;
  let admittedWr;

  beforeEach(async () => {
    resetMock();
    seedDefaults();

    adminUser = {
      id: '11111111-1111-4111-a111-111111111111',
      email: 'admin-task-review@ata-lta.ph',
      name: 'Admin Task Review',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    };
    adminToken = registerUser(adminUser);

    managerLeadUser = {
      id: '22222222-2222-4222-a222-222222222222',
      email: 'manager-lead@ata-lta.ph',
      name: 'Manager Lead',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
    };
    managerLeadToken = registerUser(managerLeadUser);

    managerOtherUser = {
      id: '33333333-3333-4333-a333-333333333333',
      email: 'manager-other@ata-lta.ph',
      name: 'Manager Other',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
    };
    managerOtherToken = registerUser(managerOtherUser);

    managerLtaOnlyUser = {
      id: '44444444-4444-4444-a444-444444444444',
      email: 'manager-lta-only@ata-lta.ph',
      name: 'Manager LTA Only',
      role: 'Manager',
      entities: ['LTA'],
    };
    _managerLtaOnlyToken = registerUser(managerLtaOnlyUser);

    employeeUser = {
      id: '55555555-5555-4555-a555-555555555555',
      email: 'staff-task-creator@ata-lta.ph',
      name: 'Staff Task Creator',
      role: 'Operations',
      departments: ['Management', 'Operations'],
      entities: ['ATA', 'LTA'],
    };
    employeeToken = registerUser(employeeUser);

    employee2User = {
      id: '66666666-6666-4666-a666-666666666666',
      email: 'staff-task-other@ata-lta.ph',
      name: 'Staff Task Other',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
    };
    employee2Token = registerUser(employee2User);

    // Create client
    const clientRes = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Task Review Client Corp',
        tin: '555-666-777-000',
        entity: 'ATA',
      })
      .expect(201);
    client = clientRes.body.data;

    // Create admitted WR with assigned Manager lead and employee as coAssignee
    const wrRes = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Admitted WR for Task Review',
        clientId: client.id,
        entity: 'ATA',
        assignedTo: managerLeadUser.id,
        coAssignees: [employeeUser.id],
        dueDate: '2026-12-31',
      })
      .expect(201);
    admittedWr = wrRes.body.data;
  });

  describe('Policy R3: Employee Task Creation & Lead Guard', () => {
    it('employee creates task on admitted WR with entitled Manager lead -> pending with canonical creator', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Employee Pending Task',
          description: 'Task pending approval',
          phase: 'pre_processing',
        })
        .expect(201);

      const task = res.body.data;
      expect(task.title).toBe('Employee Pending Task');
      expect(task.approvalStatus).toBe('pending');
      expect(task.createdBy).toBe(employeeUser.id);
      expect(task.reviewedBy).toBeNull();
      expect(task.reviewedAt).toBeNull();
      expect(task.rejectionReason).toBeNull();
      expect(task.canReview).toBe(false); // Employee cannot review
      expect(task.canResubmit).toBe(false); // Not rejected yet
    });

    it('rejects task creation if WR has no assigned lead with 400 MANAGER_LEAD_REQUIRED', async () => {
      // Create WR without lead
      const noLeadWrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR Without Lead',
          clientId: client.id,
          entity: 'ATA',
          coAssignees: [employeeUser.id],
          dueDate: '2026-12-31',
        })
        .expect(201);
      const noLeadWr = noLeadWrRes.body.data;

      const res = await request(app)
        .post(`/v1/work-requests/${noLeadWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Task on No Lead WR',
        })
        .expect(400);

      expect(res.body.code).toBe('MANAGER_LEAD_REQUIRED');
    });

    it('rejects task creation if WR assigned lead is not a Manager with 400 MANAGER_LEAD_REQUIRED', async () => {
      // Create WR with valid lead first, then mutate mock to simulate non-manager lead row
      const nonMgrWrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR With Non Manager Lead',
          clientId: client.id,
          entity: 'ATA',
          assignedTo: managerLeadUser.id,
          coAssignees: [employeeUser.id],
          dueDate: '2026-12-31',
        })
        .expect(201);
      const nonMgrWr = nonMgrWrRes.body.data;
      const { mockTables } = require('../../../../tests/fixtures/supabaseMock');
      mockTables.work_requests.get(nonMgrWr.id).assigned_to = employee2User.id;

      const res = await request(app)
        .post(`/v1/work-requests/${nonMgrWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Task on Non-Mgr Lead WR',
        })
        .expect(400);

      expect(res.body.code).toBe('MANAGER_LEAD_REQUIRED');
    });

    it('rejects task creation if WR assigned lead is not entitled to WR entity with 400 MANAGER_LEAD_REQUIRED', async () => {
      // managerLtaOnlyUser is entitled to LTA only, but WR is in ATA
      const unentitledLeadWrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR With Unentitled Lead',
          clientId: client.id,
          entity: 'ATA',
          assignedTo: managerLtaOnlyUser.id,
          coAssignees: [employeeUser.id],
          dueDate: '2026-12-31',
        })
        .expect(201);
      const unentitledLeadWr = unentitledLeadWrRes.body.data;

      const res = await request(app)
        .post(`/v1/work-requests/${unentitledLeadWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Task with unentitled lead',
        })
        .expect(400);

      expect(res.body.code).toBe('MANAGER_LEAD_REQUIRED');
    });

    it('rejects employee task creation if employee is not a member of the WR with 403 Forbidden', async () => {
      // employee2User is NOT in assignees or coAssignees of admittedWr
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employee2Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Non-member task creation',
        })
        .expect(403);

      expect(res.body.title).toBe('Forbidden');
    });

    it('strips client-forged approval fields in task creation payload', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Forged Task',
          approvalStatus: 'approved',
          reviewedBy: adminUser.id,
          reviewedAt: '2020-01-01T00:00:00.000Z',
          rejectionReason: 'Forged reason',
        })
        .expect(201);

      const task = res.body.data;
      expect(task.approvalStatus).toBe('pending');
      expect(task.reviewedBy).toBeNull();
      expect(task.reviewedAt).toBeNull();
      expect(task.rejectionReason).toBeNull();
    });

    it('rejects task creation with wrong-WR predecessors with 400 TASK_PREDECESSORS_NOT_FOUND', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Task with Wrong Predecessor',
          predecessors: ['99999999-9999-4999-a999-999999999999'],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_PREDECESSORS_NOT_FOUND');
    });
  });

  describe('Policy R4: Visibility & Usability', () => {
    let pendingTask;

    beforeEach(async () => {
      const taskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Visibility Test Task',
          assigneeId: employeeUser.id,
          phase: 'pre_processing',
        })
        .expect(201);
      pendingTask = taskRes.body.data;
    });

    it('pending task is immediately visible to WR members on getTaskById and listTasks', async () => {
      // Check getTaskById
      const getRes = await request(app)
        .get(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(getRes.body.data.id).toBe(pendingTask.id);
      expect(getRes.body.data.approvalStatus).toBe('pending');

      // Check listTasks
      const listRes = await request(app)
        .get(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const found = listRes.body.data.find((t) => t.id === pendingTask.id);
      expect(found).toBeDefined();
      expect(found.approvalStatus).toBe('pending');
    });

    it('Admin or Manager creates an approved task directly', async () => {
      const adminTaskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Admin Created Task',
          phase: 'pre_processing',
        })
        .expect(201);

      expect(adminTaskRes.body.data.approvalStatus).toBe('approved');
      expect(adminTaskRes.body.data.reviewedBy).toBe(adminUser.id);

      const managerTaskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Manager Created Task',
          phase: 'pre_processing',
        })
        .expect(201);

      expect(managerTaskRes.body.data.approvalStatus).toBe('approved');
      expect(managerTaskRes.body.data.reviewedBy).toBe(managerLeadUser.id);
    });

    it('tasks in an unadmitted (pending) parent WR return 404 to regular employees', async () => {
      // Manager creates pending WR
      const pendingWrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Pending Parent WR',
          clientId: client.id,
          entity: 'ATA',
          assignedTo: managerLeadUser.id,
          dueDate: '2026-12-31',
          phases: {
            pre_processing: {
              tasks: [{ title: 'Initial Task in Pending WR' }],
            },
          },
        })
        .expect(201);
      const pendingWr = pendingWrRes.body.data;
      const initialTask = pendingWr.phases.pre_processing.tasks[0];

      // Regular employee accessing task on unadmitted WR gets 404
      await request(app)
        .get(`/v1/work-requests/${pendingWr.id}/tasks/${initialTask.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      await request(app)
        .get(`/v1/work-requests/${pendingWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);
    });

    it('pending task can transition execution status (independent lifecycle)', async () => {
      const updateRes = await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'In Progress',
          expectedVersion: pendingTask.version,
        })
        .expect(200);

      expect(updateRes.body.data.status).toBe('In Progress');
      expect(updateRes.body.data.approvalStatus).toBe('pending');
    });
  });

  describe('Policy R5: Strict Manager Lead Review Authority', () => {
    let pendingTask;

    beforeEach(async () => {
      const taskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Review Authority Task',
          phase: 'pre_processing',
        })
        .expect(201);
      pendingTask = taskRes.body.data;
    });

    it('assigned Manager lead approves pending task', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingTask.version,
        })
        .expect(200);

      const task = res.body.data;
      expect(task.approvalStatus).toBe('approved');
      expect(task.reviewedBy).toBe(managerLeadUser.id);
      expect(task.reviewedAt).toBeDefined();
      expect(task.rejectionReason).toBeNull();
      expect(task.version).toBe(pendingTask.version + 1);
    });

    it('assigned Manager lead rejects pending task (requires reason)', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Scope is too broad. Please break into subtasks.',
          expectedVersion: pendingTask.version,
        })
        .expect(200);

      const task = res.body.data;
      expect(task.approvalStatus).toBe('rejected');
      expect(task.reviewedBy).toBe(managerLeadUser.id);
      expect(task.reviewedAt).toBeDefined();
      expect(task.rejectionReason).toBe('Scope is too broad. Please break into subtasks.');
      expect(task.version).toBe(pendingTask.version + 1);
    });

    it('rejects rejection without reason with 400', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: '',
          expectedVersion: pendingTask.version,
        })
        .expect(400);

      expect(['REASON_REQUIRED', 'VALIDATION_ERROR']).toContain(res.body.code);
    });

    it('Admin CANNOT approve or reject tasks (strict R5, 403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingTask.version,
        })
        .expect(403);

      expect(res.body.code).toBe('TASK_REVIEW_FORBIDDEN');
    });

    it('co-assignee or other Manager CANNOT approve or reject tasks (403 Forbidden)', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerOtherToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingTask.version,
        })
        .expect(403);

      expect(res.body.code).toBe('TASK_REVIEW_FORBIDDEN');
    });

    it('cannot decide a task that is already decided (409 TASK_REVIEW_STATE)', async () => {
      // Approve first
      await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingTask.version,
        })
        .expect(200);

      // Try deciding again
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Too late to reject',
          expectedVersion: pendingTask.version + 1,
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REVIEW_STATE');
    });

    it('returns canReview: true only for assigned Manager lead when task is pending', async () => {
      const getLeadRes = await request(app)
        .get(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(getLeadRes.body.data.canReview).toBe(true);

      const getAdminRes = await request(app)
        .get(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(getAdminRes.body.data.canReview).toBe(false);

      const getEmployeeRes = await request(app)
        .get(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(getEmployeeRes.body.data.canReview).toBe(false);
    });
  });

  describe('Policy R6: Rejected Task Locking & Creator Resubmission & Material Edits', () => {
    let rejectedTask;

    beforeEach(async () => {
      const taskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'To Be Rejected Task',
          assigneeId: employeeUser.id,
          phase: 'pre_processing',
        })
        .expect(201);
      const pendingTask = taskRes.body.data;

      const rejectRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Needs revision',
          expectedVersion: pendingTask.version,
        })
        .expect(200);
      rejectedTask = rejectRes.body.data;
    });

    it('rejected task blocks ordinary modifications with 409 TASK_REJECTED_LOCKED', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${rejectedTask.id}`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Directly Modified Title',
          expectedVersion: rejectedTask.version,
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
    });

    it('rejected task blocks time logging with 409 TASK_REJECTED_LOCKED', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${rejectedTask.id}/time-logs`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          logs: [{ date: '2026-10-26', hours: 2, note: 'Work attempted' }],
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
    });

    it('creator resubmits rejected task successfully -> returns to pending', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${rejectedTask.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedTask.version,
          data: {
            title: 'Revised Task Title',
            description: 'Revised detailed description',
          },
        })
        .expect(200);

      const task = res.body.data;
      expect(task.title).toBe('Revised Task Title');
      expect(task.description).toBe('Revised detailed description');
      expect(task.approvalStatus).toBe('pending');
      expect(task.reviewedBy).toBeNull();
      expect(task.reviewedAt).toBeNull();
      expect(task.rejectionReason).toBeNull();
      expect(task.version).toBe(rejectedTask.version + 1);
    });

    it('non-creator cannot resubmit rejected task (403 Forbidden)', async () => {
      // employee2User didn't create the task
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${rejectedTask.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${employee2Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedTask.version,
          data: { title: 'Unauthorized Resubmit' },
        })
        .expect(403);

      expect(res.body.title).toBe('Forbidden');
    });

    it('cannot resubmit a task that is not rejected (409 TASK_REVIEW_STATE)', async () => {
      // Create another task that is approved
      const approvedTaskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Already Approved Task',
          phase: 'pre_processing',
        })
        .expect(201);
      const approvedTask = approvedTaskRes.body.data;

      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${approvedTask.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: approvedTask.version,
          data: { title: 'Resubmit on Approved' },
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REVIEW_STATE');
    });

    it('material employee edits on approved task reset approvalStatus to pending', async () => {
      // Create approved task
      const approvedTaskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Approved Material Task',
          assigneeId: employeeUser.id,
          phase: 'pre_processing',
        })
        .expect(201);
      const task = approvedTaskRes.body.data;

      // Employee makes material edit (title)
      const res = await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Employee Material Title Change',
          expectedVersion: task.version,
        })
        .expect(200);

      expect(res.body.data.approvalStatus).toBe('pending');
      expect(res.body.data.reviewedBy).toBeNull();
      expect(res.body.data.reviewedAt).toBeNull();
    });

    it('routine status transition on approved task does NOT reset approvalStatus', async () => {
      // Create approved task
      const approvedTaskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Routine Status Task',
          assigneeId: employeeUser.id,
          phase: 'pre_processing',
        })
        .expect(201);
      const task = approvedTaskRes.body.data;

      // Assignee transitions status to In Progress
      const res = await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'In Progress',
          expectedVersion: task.version,
        })
        .expect(200);

      expect(res.body.data.status).toBe('In Progress');
      expect(res.body.data.approvalStatus).toBe('approved');
    });
  });

  describe('Policy R7: Phase Advancement & WR Completion Gate', () => {
    let _task1;
    let task2;

    beforeEach(async () => {
      // Create task1 (completed & approved)
      const t1Res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Pre Task 1',
          phase: 'pre_processing',
          status: 'Completed',
        })
        .expect(201);
      _task1 = t1Res.body.data;

      // Create task2 by employee -> pending creation review
      const t2Res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Pre Task 2 Pending Review',
          phase: 'pre_processing',
          assigneeId: employeeUser.id,
        })
        .expect(201);
      task2 = t2Res.body.data;
    });

    it('pending task blocks phase advancement with 409 TASK_REVIEW_REQUIRED', async () => {
      // Mark task2 completed in execution, but creation review is still pending
      await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${task2.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Completed',
          expectedVersion: task2.version,
        })
        .expect(200);

      // Attempt to advance WR from pre_processing to processing
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          toPhase: 'processing',
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REVIEW_REQUIRED');
    });

    it('rejected task blocks phase advancement with 409 TASK_REVIEW_REQUIRED', async () => {
      // Reject task2
      await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${task2.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Unacceptable',
          expectedVersion: task2.version,
        })
        .expect(200);

      // Attempt to advance WR
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          toPhase: 'processing',
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REVIEW_REQUIRED');
    });

    it('pending or rejected task blocks direct WR completion with 409 TASK_CREATION_REVIEW_PENDING', async () => {
      // Attempt to set WR status to Completed directly
      const res = await request(app)
        .put(`/v1/work-requests/${admittedWr.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Completed',
          expectedVersion: admittedWr.version,
        })
        .expect(409);

      expect(['TASK_CREATION_REVIEW_PENDING', 'TASK_REVIEW_REQUIRED']).toContain(res.body.code);
    });

    it('soft-deleted pending task does NOT block phase advancement', async () => {
      // Delete task2
      await request(app)
        .delete(`/v1/work-requests/${admittedWr.id}/tasks/${task2.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(204);

      // Advance WR -> succeeds now because remaining task1 is completed & approved
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          toPhase: 'processing',
        })
        .expect(200);

      expect(res.body.data.phase).toBe('processing');
    });
  });

  describe('Policy R8: Atomic Version Concurrency & Linkage Validation', () => {
    let pendingTask;

    beforeEach(async () => {
      const taskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Concurrency Test Task',
          phase: 'pre_processing',
        })
        .expect(201);
      pendingTask = taskRes.body.data;
    });

    it('returns 409 on version conflict during decision', async () => {
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: 999, // Wrong version
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REVIEW_CONFLICT');
    });

    it('returns 409 on version conflict during resubmission', async () => {
      // Reject task first
      const rejectRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Needs correction',
          expectedVersion: pendingTask.version,
        })
        .expect(200);
      const rejectedTask = rejectRes.body.data;

      // Resubmit with stale version
      const res = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${rejectedTask.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 999, // Stale version
          data: { title: 'Updated' },
        })
        .expect(409);

      expect(res.body.code).toBe('TASK_REVIEW_CONFLICT');
    });

    it('denies decision and resubmission on WR / task ID mismatch with 404', async () => {
      const foreignWrId = '00000000-0000-4000-a000-000000000000';

      await request(app)
        .post(`/v1/work-requests/${foreignWrId}/tasks/${pendingTask.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingTask.version,
        })
        .expect(404);

      await request(app)
        .post(`/v1/work-requests/${foreignWrId}/tasks/${pendingTask.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: pendingTask.version,
          data: { title: 'Updated' },
        })
        .expect(404);
    });

    it('ordinary updateTask CAS compares existing.version even when expectedVersion is omitted', async () => {
      // Create a task on admitted WR
      const taskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'CAS Version Task',
          phase: 'pre_processing',
        })
        .expect(201);

      const task = taskRes.body.data;

      // Simulate a concurrent update that bumps task version in DB
      await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Concurrent Title Bump',
        })
        .expect(200);

      // Now attempt an update with stale declared expectedVersion -> 409 ERR_CONCURRENCY_CONFLICT
      const staleRes = await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Stale Attempt',
          expectedVersion: task.version, // stale version
        })
        .expect(409);

      expect(staleRes.body.code).toBe('ERR_CONCURRENCY_CONFLICT');
    });

    it('ordinary updateTask blocks intervening rejection with 409 TASK_REJECTED_LOCKED', async () => {
      // Employee creates a pending task
      const taskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Task Before Intervening Rejection',
          phase: 'pre_processing',
        })
        .expect(201);

      const task = taskRes.body.data;
      expect(task.approvalStatus).toBe('pending');

      // Manager lead rejects the task
      await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Scope too vague',
          expectedVersion: task.version,
        })
        .expect(200);

      // Ordinary update must be rejected with 409 TASK_REJECTED_LOCKED, not overwrite rejection
      const updateRes = await request(app)
        .put(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Ordinary Overwrite Attempt',
        })
        .expect(409);

      expect(updateRes.body.code).toBe('TASK_REJECTED_LOCKED');
    });

    it('rejects competing task decisions on same version with 409 TASK_REVIEW_CONFLICT', async () => {
      // Employee creates a pending task
      const taskRes = await request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Task for Competing Decisions',
          phase: 'pre_processing',
        })
        .expect(201);

      const task = taskRes.body.data;

      const approveReq = request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: task.version,
        });

      const rejectReq = request(app)
        .post(`/v1/work-requests/${admittedWr.id}/tasks/${task.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerLeadToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Late rejection decision',
          expectedVersion: task.version,
        });

      const [res1, res2] = await Promise.all([approveReq, rejectReq]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });
});
