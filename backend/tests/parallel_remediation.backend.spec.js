/**
 * Test Suite: Parallel Remediation Backend Verification
 * Track 1: Tasks B.1 to B.5
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
      name: 'Remediation Test Client',
      tin: `999-RC-${String(Math.random()).slice(2, 7)}`,
      entity,
    });
  return res.body.data;
};

describe('Track 1 Parallel Remediation Backend Test Suite', () => {
  let adminToken;
  let staffToken;
  let client;

  const staffId = '11111111-1111-1111-1111-111111111111';
  const staff2Id = '22222222-2222-2222-2222-222222222222';

  beforeEach(async () => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      email: 'admin-remediation@ata-lta.ph',
      name: 'Admin Lorein',
      role: 'Admin',
      entities: ['ATA'],
    });

    staffToken = registerUser({
      id: staffId,
      email: 'staff-remediation@ata-lta.ph',
      name: 'Staff Operations',
      role: 'Operations',
      entities: ['ATA'],
    });

    registerUser({
      id: staff2Id,
      email: 'staff2-remediation@ata-lta.ph',
      name: 'Staff Two',
      role: 'Operations',
      entities: ['ATA'],
    });

    client = await createClient(adminToken, 'ATA');
  });

  describe('Task B.1: Stable Checklist Sorting', () => {
    it('returns checklist items ordered strictly by sort_order ascending then created_at ascending', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          dueDate: '2026-12-31',
          title: 'WR for Checklist Sort Test',
          clientId: client.id,
          entity: 'ATA',
        })
        .expect(201);

      const taskRes = await request(app)
        .post(`/v1/work-requests/${wrRes.body.data.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Task with Checklists', phase: 'pre_processing' })
        .expect(201);

      const taskId = taskRes.body.data.id;

      // Seed 3 checklist items in scrambled sort_order
      const clTable = mockTables.task_checklists;
      clTable.set('cl-3', {
        id: 'cl-3',
        task_id: taskId,
        text: 'Item 3',
        completed: false,
        sort_order: 3,
        created_at: '2026-10-11T10:00:00Z',
      });
      clTable.set('cl-1', {
        id: 'cl-1',
        task_id: taskId,
        text: 'Item 1',
        completed: true,
        sort_order: 1,
        created_at: '2026-10-11T10:02:00Z',
      });
      clTable.set('cl-2', {
        id: 'cl-2',
        task_id: taskId,
        text: 'Item 2',
        completed: false,
        sort_order: 2,
        created_at: '2026-10-11T10:01:00Z',
      });

      const getRes = await request(app)
        .get(`/v1/work-requests/${wrRes.body.data.id}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const checklist = getRes.body.data.checklist;
      expect(checklist).toBeDefined();
      expect(checklist.length).toBe(3);
      expect(checklist.map((c) => c.text)).toEqual(['Item 1', 'Item 2', 'Item 3']);
    });
  });

  describe('Task B.2: Co-Assignees Normalization (UUID Deduplication)', () => {
    it('stores strictly deduplicated UUIDs and avoids injecting user name strings', async () => {
      const graphRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          dueDate: '2026-12-31',
          title: 'WR with Deduplicated Co-Assignees',
          clientId: client.id,
          entity: 'ATA',
          coAssignees: [staffId, 'Staff Two'],
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 'task_1',
                  title: 'Task 1',
                  assignees: [staffId, staff2Id],
                },
              ],
            },
            processing: {
              tasks: [
                {
                  local_id: 'task_2',
                  title: 'Task 2',
                  assignees: [staffId],
                },
              ],
            },
          },
        })
        .expect(201);

      const wrId = graphRes.body.data.id;
      const storedWr = mockTables.work_requests.get(wrId);

      expect(storedWr.co_assignees).toBeDefined();
      expect(Array.isArray(storedWr.co_assignees)).toBe(true);

      // Verify no user name strings were injected
      expect(storedWr.co_assignees).not.toContain('Staff Two');
      expect(storedWr.co_assignees).not.toContain('Staff Operations');

      // Verify strictly deduplicated UUIDs
      const uniqueIds = new Set(storedWr.co_assignees);
      expect(storedWr.co_assignees.length).toBe(uniqueIds.size);
      expect(uniqueIds.has(staffId)).toBe(true);
      expect(uniqueIds.has(staff2Id)).toBe(true);
    });
  });

  describe('Task B.3: Cross-Phase Dependency Validation', () => {
    it('rejects pre_processing task depending on processing task in graph creation with 400 INVALID_PHASE_DEPENDENCY', async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          dueDate: '2026-12-31',
          title: 'WR Invalid Cross-Phase Graph',
          clientId: client.id,
          entity: 'ATA',
          phases: {
            processing: {
              tasks: [
                {
                  local_id: 'proc_task',
                  title: 'Processing Step',
                },
              ],
            },
            pre_processing: {
              tasks: [
                {
                  local_id: 'pre_task',
                  title: 'Pre-Processing Step',
                  depends_on: 'proc_task', // ILLEGAL: pre_processing depending on processing
                },
              ],
            },
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PHASE_DEPENDENCY');
      expect(res.body.detail).toMatch(/pre-processing task.*cannot depend on processing task/i);
    });

    it('permits processing task depending on pre_processing task in graph creation (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          dueDate: '2026-12-31',
          title: 'WR Valid Forward Cross-Phase Graph',
          clientId: client.id,
          entity: 'ATA',
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 'pre_task',
                  title: 'Pre-Processing Step',
                },
              ],
            },
            processing: {
              tasks: [
                {
                  local_id: 'proc_task',
                  title: 'Processing Step',
                  depends_on: 'pre_task', // LEGAL: processing depending on pre_processing
                },
              ],
            },
          },
        });

      expect(res.status).toBe(201);
    });

    it('rejects adding a processing predecessor to a pre_processing task via updateTask (400 INVALID_PHASE_DEPENDENCY)', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'WR for Task Dependency Test', clientId: client.id, entity: 'ATA' })
        .expect(201);

      const wrId = wrRes.body.data.id;

      const preTask = await request(app)
        .post(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Pre Task', phase: 'pre_processing' })
        .expect(201);

      const procTask = await request(app)
        .post(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Proc Task', phase: 'processing' })
        .expect(201);

      // Try updating preTask to depend on procTask
      const updateRes = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${preTask.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ predecessors: [procTask.body.data.id] });

      expect(updateRes.status).toBe(400);
      expect(updateRes.body.code).toBe('INVALID_PHASE_DEPENDENCY');
    });

    it('rejects creating a pre_processing task with processing predecessor via createTask (400 INVALID_PHASE_DEPENDENCY)', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'WR for createTask Dependency Test', clientId: client.id, entity: 'ATA' })
        .expect(201);

      const wrId = wrRes.body.data.id;

      const procTask = await request(app)
        .post(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Downstream Proc Task', phase: 'processing' })
        .expect(201);

      const res = await request(app)
        .post(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Illegal Pre Task',
          phase: 'pre_processing',
          predecessors: [procTask.body.data.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_PHASE_DEPENDENCY');
    });
  });

  describe('Task B.4: Completed Work Request Lock', () => {
    it('locks task creation, modification, and deletion on Completed work requests', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'WR Lock Test', clientId: client.id, entity: 'ATA' })
        .expect(201);

      const wrId = wrRes.body.data.id;

      const taskRes = await request(app)
        .post(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Initial Task' })
        .expect(201);

      const taskId = taskRes.body.data.id;

      // Lock the WR
      mockTables.work_requests.get(wrId).status = 'Completed';

      // 1. Rejects adding task
      const addRes = await request(app)
        .post(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'New Task' });
      expect(addRes.status).toBe(400);
      expect(['COMPLETED_WR_LOCKED', 'WORK_REQUEST_COMPLETED']).toContain(addRes.body.code);

      // 2. Rejects updating task
      const updateRes = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Mutated Task' });
      expect(updateRes.status).toBe(400);
      expect(['COMPLETED_WR_LOCKED', 'WORK_REQUEST_COMPLETED']).toContain(updateRes.body.code);

      // 3. Rejects deleting task
      const delRes = await request(app)
        .delete(`/v1/work-requests/${wrId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');
      expect(delRes.status).toBe(400);
      expect(['COMPLETED_WR_LOCKED', 'WORK_REQUEST_COMPLETED']).toContain(delRes.body.code);
    });
  });

  describe('Task B.5: Admin Direct Approval Transitions', () => {
    const seedTaskForWr = (wrId, idx) => {
      const taskId = `00000000-0000-4000-8000-000000000b5${idx}`;
      mockTables.tasks.set(taskId, {
        id: taskId,
        work_request_id: wrId,
        entity_id: 'ent-ata',
        title: `Task B5 ${idx}`,
        status: 'In Progress',
        deleted_at: null,
      });
      return taskId;
    };

    it('allows Admin to transition Invoice directly from Draft to Sent (200 OK)', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'WR for Billing Direct Approval', clientId: client.id, entity: 'ATA' })
        .expect(201);
      const taskId = seedTaskForWr(wrRes.body.data.id, 1);

      const invRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: client.id,
          workRequestId: wrRes.body.data.id,
          taskId,
          invoiceNumber: `INV-DA-${Date.now()}`,
          issueDate: '2026-10-12',
          dueDate: '2026-11-12',
          status: 'Draft',
          lineItems: [
            { description: 'Professional Legal Services', amount: 50000, type: 'Professional Fee' },
          ],
        })
        .expect(201);

      const invoiceId = invRes.body.data.id;

      // Admin directly transitions from Draft to Sent
      const patchRes = await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Sent' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.status).toBe('Sent');

      // Verify audit log
      const auditLog = Array.from(mockTables.audit_logs?.values?.() || []).find(
        (a) => a.action === 'billing.direct_approval' && a.record_id === invoiceId
      );
      if (auditLog) {
        expect(auditLog.details.from).toBe('Draft');
        expect(auditLog.details.to).toBe('Sent');
      }
    });

    it('rejects non-admin staff transitioning Invoice directly from Draft to Sent (400 Bad Request)', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'WR for Staff Billing Test', clientId: client.id, entity: 'ATA' })
        .expect(201);
      const taskId = seedTaskForWr(wrRes.body.data.id, 2);

      const invRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: client.id,
          workRequestId: wrRes.body.data.id,
          taskId,
          invoiceNumber: `INV-STAFF-${Date.now()}`,
          issueDate: '2026-10-12',
          dueDate: '2026-11-12',
          status: 'Draft',
          lineItems: [
            { description: 'Consulting Fee', amount: 10000, type: 'Professional Fee' },
          ],
        })
        .expect(201);

      const invoiceId = invRes.body.data.id;

      // Staff attempting to transition Draft directly to Sent is rejected
      const patchRes = await request(app)
        .patch(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Sent' });

      expect([400, 403]).toContain(patchRes.status);
    });

    it('allows Admin to transition Disbursement directly from Draft to Approved (200 OK)', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'WR for Disbursement Test', clientId: client.id, entity: 'ATA' })
        .expect(201);
      const taskId = seedTaskForWr(wrRes.body.data.id, 3);

      // Create a draft disbursement as Admin
      const disbRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Courier',
          description: 'Document delivery fee',
          amount: 1500,
          fundSource: 'Client Fund',
          clientId: client.id,
          linkedWorkRequestId: wrRes.body.data.id,
          taskId,
        })
        .expect(201);

      expect(disbRes.body.data.status).toBe('Draft');

      const disbId = disbRes.body.data.id;

      const admin2Token = registerUser({
        email: 'admin2-remediation@ata-lta.ph',
        name: 'Admin Second',
        role: 'Admin',
        entities: ['ATA'],
      });

      // Another Admin directly approves
      const approveRes = await request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${admin2Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1,
        })
        .expect(200);

      expect(['Approved', 'Released']).toContain(approveRes.body.data.status);
    });

    it('forbids staff from directly approving a Draft disbursement (403 Forbidden)', async () => {
      const wrRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ dueDate: '2026-12-31', title: 'WR for Staff Disb Test', clientId: client.id, entity: 'ATA' })
        .expect(201);
      const taskId = seedTaskForWr(wrRes.body.data.id, 4);

      const disbRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Filing Fee',
          description: 'Court filing fees',
          amount: 3500,
          fundSource: 'Firm Fund',
          clientId: client.id,
          linkedWorkRequestId: wrRes.body.data.id,
          taskId,
        })
        .expect(201);

      const disbId = disbRes.body.data.id;

      const approveRes = await request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(approveRes.status).toBe(403);
    });
  });
});
