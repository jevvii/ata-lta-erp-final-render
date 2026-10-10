/**
 * Adversarial Challenger Suite for Operations & Billing Remediation (Parcel B1)
 *
 * Challenges:
 * 1. Nullish coalescing on task lead unassign (assigneeId: null)
 * 2. Completed work request modification lock (HTTP 400 on edit, allowed on reopen)
 * 3. Predecessor dependency enforcement (TASK_PREDECESSORS_INCOMPLETE)
 * 4. Dual-role team member permissions (Operations admin/manager allowed, non-ops rejected)
 * 5. Billing request fulfillment draft invoice creation (Draft invoice, zero balances, idempotency)
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

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const ENTITY_ID = 'ent-ata';

describe('Parcel B1 Adversarial Challenger Suite', () => {
  let adminToken;
  let adminUser;
  let opsManagerUser;
  let opsAdminUser;
  let execManagerUser;
  let nonOpsAdminUser;
  let regularStaffUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Seed test users
    adminUser = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'System Admin',
      email: 'admin@ata-lta.ph',
      role: 'Admin',
      departments: ['Management'],
      entities: ['ATA'],
    };
    adminToken = registerUser(adminUser);
    mockTables.users.get(adminUser.id).departments = adminUser.departments;

    opsManagerUser = {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Lovelyn Rebong (Ops Mgr)',
      email: 'lovelyn@ata-lta.ph',
      role: 'Manager',
      departments: ['Operations'],
      entities: ['ATA'],
    };
    registerUser(opsManagerUser);
    mockTables.users.get(opsManagerUser.id).departments = opsManagerUser.departments;

    opsAdminUser = {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Ops Admin User',
      email: 'opsadmin@ata-lta.ph',
      role: 'Admin',
      departments: ['Operations'],
      entities: ['ATA'],
    };
    registerUser(opsAdminUser);
    mockTables.users.get(opsAdminUser.id).departments = opsAdminUser.departments;

    execManagerUser = {
      id: '00000000-0000-4000-8000-000000000004',
      name: 'Executive Manager',
      email: 'execmgr@ata-lta.ph',
      role: 'Manager',
      departments: ['Executive', 'Legal'],
      entities: ['ATA'],
    };
    registerUser(execManagerUser);
    mockTables.users.get(execManagerUser.id).departments = execManagerUser.departments;

    nonOpsAdminUser = {
      id: '00000000-0000-4000-8000-000000000005',
      name: 'HR Admin User',
      email: 'hradmin@ata-lta.ph',
      role: 'Admin',
      departments: ['HR'],
      entities: ['ATA'],
    };
    registerUser(nonOpsAdminUser);
    mockTables.users.get(nonOpsAdminUser.id).departments = nonOpsAdminUser.departments;

    regularStaffUser = {
      id: '00000000-0000-4000-8000-000000000006',
      name: 'Regular Staff',
      email: 'staff@ata-lta.ph',
      role: 'Staff',
      departments: ['Operations'],
      entities: ['ATA'],
    };
    registerUser(regularStaffUser);
    mockTables.users.get(regularStaffUser.id).departments = regularStaffUser.departments;

    // Seed Client
    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENTITY_ID,
      name: 'Acme Corp',
      tin: '123-456-789-00001',
      status: 'Active',
      created_by: adminUser.id,
      updated_by: adminUser.id,
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge 1: Nullish Coalescing on Task Lead Unassign
  // ───────────────────────────────────────────────────────────────────────────
  describe('Challenge 1: Task Lead Unassign Nullish Coalescing', () => {
    let wrId;
    let taskId;

    beforeEach(async () => {
      // Create work request
      const wrRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR for Lead Unassign Test',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
          phases: {
            pre_processing: {
              tasks: [
                {
                  title: 'Initial Task with Lead',
                  assigneeId: regularStaffUser.id,
                  assignees: [regularStaffUser.id],
                },
              ],
            },
          },
        });
      expect(wrRes.status).toBe(201);
      wrId = wrRes.body.data.id;

      // Fetch created task
      const tasksRes = await request(app)
        .get(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');
      expect(tasksRes.status).toBe(200);
      expect(tasksRes.body.data.length).toBeGreaterThan(0);
      taskId = tasksRes.body.data[0].id;
      expect(tasksRes.body.data[0].assigneeId).toBe(regularStaffUser.id);
    });

    it('clears assigneeId and assigneeName when assigneeId: null is passed', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          assigneeId: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBeNull();
      expect(res.body.data.assigneeName).toBeNull();

      // Check DB directly
      const dbTask = mockTables.tasks.get(taskId);
      expect(dbTask.assignee_id).toBeNull();
      expect(dbTask.assignee_name).toBeNull();
    });

    it('clears both when both assigneeId: null and assigneeName: null are passed', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          assigneeId: null,
          assigneeName: null,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBeNull();
      expect(res.body.data.assigneeName).toBeNull();
    });

    it('defensively overrides assigneeName to null when assigneeId: null even if assigneeName string was provided', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          assigneeId: null,
          assigneeName: 'Stale Ghost Name',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBeNull();
      expect(res.body.data.assigneeName).toBeNull();
    });

    it('preserves existing assignee when assigneeId is omitted (undefined)', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${taskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Updated title without touching assignee',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.assigneeId).toBe(regularStaffUser.id);
      expect(res.body.data.title).toBe('Updated title without touching assignee');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge 2: Completed Work Request Modification Lock
  // ───────────────────────────────────────────────────────────────────────────
  describe('Challenge 2: Completed Work Request Modification Lock', () => {
    let wrId;

    beforeEach(async () => {
      const wrRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR to be Completed',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
        });
      expect(wrRes.status).toBe(201);
      wrId = wrRes.body.data.id;

      // Set status directly to Completed in mock
      const record = mockTables.work_requests.get(wrId);
      record.status = 'Completed';
      record.phase = 'completion';
      mockTables.work_requests.set(wrId, record);
    });

    it('blocks general title/description modifications with HTTP 400', async () => {
      const res = await request(app)
        .put(`/v1/operations/work-requests/${wrId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Attempted edit to completed WR',
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('Completed Work Requests are locked and cannot be modified');
    });

    it('blocks priority modifications on completed WR with HTTP 400', async () => {
      const res = await request(app)
        .put(`/v1/operations/work-requests/${wrId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          priority: 'Urgent',
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('Completed Work Requests are locked and cannot be modified');
    });

    it('blocks transition to Cancelled from Completed with HTTP 400', async () => {
      const res = await request(app)
        .put(`/v1/operations/work-requests/${wrId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Cancelled',
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('Completed Work Requests are locked and cannot be modified');
    });

    it('permits reopening a completed work request to Draft (200 OK)', async () => {
      const res = await request(app)
        .put(`/v1/operations/work-requests/${wrId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Draft',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Draft');

      const dbWr = mockTables.work_requests.get(wrId);
      expect(dbWr.status).toBe('Draft');
    });

    it('permits reopening a completed work request to Processing (200 OK)', async () => {
      const res = await request(app)
        .put(`/v1/operations/work-requests/${wrId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Processing',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Processing');

      const dbWr = mockTables.work_requests.get(wrId);
      expect(dbWr.status).toBe('Processing');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge 3: Predecessor Dependency Enforcement
  // ───────────────────────────────────────────────────────────────────────────
  describe('Challenge 3: Predecessor Dependency Enforcement (TASK_PREDECESSORS_INCOMPLETE)', () => {
    let wrId;
    let predTask1Id;
    let predTask2Id;
    let dependentTaskId;

    beforeEach(async () => {
      const wrRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR with Task Dependencies',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
          phases: {
            processing: {
              tasks: [
                { title: 'Prerequisite Task 1' },
                { title: 'Prerequisite Task 2' },
                { title: 'Dependent Downstream Task' },
              ],
            },
          },
        });
      expect(wrRes.status).toBe(201);
      wrId = wrRes.body.data.id;

      const tasksRes = await request(app)
        .get(`/v1/work-requests/${wrId}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      const tasks = tasksRes.body.data;
      predTask1Id = tasks.find((t) => t.title === 'Prerequisite Task 1').id;
      predTask2Id = tasks.find((t) => t.title === 'Prerequisite Task 2').id;
      dependentTaskId = tasks.find((t) => t.title === 'Dependent Downstream Task').id;

      // Assign predecessors to dependent task in mock DB
      const depRecord = mockTables.tasks.get(dependentTaskId);
      depRecord.predecessors = [predTask1Id, predTask2Id];
      depRecord.status = 'In Progress';
      mockTables.tasks.set(dependentTaskId, depRecord);

      // Set predTask1 to Completed, predTask2 to In Progress
      const pred1 = mockTables.tasks.get(predTask1Id);
      pred1.status = 'Completed';
      mockTables.tasks.set(predTask1Id, pred1);

      const pred2 = mockTables.tasks.get(predTask2Id);
      pred2.status = 'In Progress';
      mockTables.tasks.set(predTask2Id, pred2);
    });

    it('rejects completing dependent task when an upstream predecessor is incomplete with HTTP 400 and code TASK_PREDECESSORS_INCOMPLETE', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${dependentTaskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Completed',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_PREDECESSORS_INCOMPLETE');
      expect(res.body.detail).toContain('Prerequisite Task 2');
      expect(res.body.detail).toContain('In Progress');
    });

    it('allows completing dependent task once ALL predecessors are Completed (200 OK)', async () => {
      // Complete predTask2
      const pred2 = mockTables.tasks.get(predTask2Id);
      pred2.status = 'Completed';
      mockTables.tasks.set(predTask2Id, pred2);

      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${dependentTaskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Completed',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Completed');
    });

    it('does not block moving dependent task to In Progress or other non-Completed statuses even if predecessors are incomplete', async () => {
      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${dependentTaskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'In Progress',
          description: 'Working on task while waiting for predecessor',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('In Progress');
    });

    it('allows completion when task has no predecessors declared', async () => {
      // predTask1 has no predecessors
      const res = await request(app)
        .put(`/v1/work-requests/${wrId}/tasks/${predTask1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'Completed',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Completed');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge 4: Dual-Role Team Member Permissions
  // ───────────────────────────────────────────────────────────────────────────
  describe('Challenge 4: Dual-Role Team Member Permissions', () => {
    it('allows assigning a Manager who belongs to Operations department (Lovelyn Rebong pattern)', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR with Dual Role Ops Manager Team Member',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
          coAssignees: [opsManagerUser.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.coAssignees).toContain(opsManagerUser.id);
    });

    it('allows assigning an Admin who belongs to Operations department', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR with Dual Role Ops Admin Team Member',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
          coAssignees: [opsAdminUser.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.coAssignees).toContain(opsAdminUser.id);
    });

    it('rejects assigning an Executive Manager who does NOT belong to Operations department (HTTP 400)', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR with Non-Ops Manager Member',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
          coAssignees: [execManagerUser.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Invalid Team Member');
      expect(res.body.detail).toContain('Executive Manager');
      expect(res.body.detail).toContain('Manager');
    });

    it('rejects assigning an Admin who does NOT belong to Operations department (HTTP 400)', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR with Non-Ops Admin Member',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
          coAssignees: [nonOpsAdminUser.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Invalid Team Member');
      expect(res.body.detail).toContain('HR Admin User');
    });

    it('correctly catches non-ops manager when mixed with valid staff and ops manager in coAssignees', async () => {
      const res = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR with Mixed Team Members',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
          coAssignees: [regularStaffUser.id, opsManagerUser.id, execManagerUser.id],
        });

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Invalid Team Member');
      expect(res.body.detail).toContain('Executive Manager');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Challenge 5: Billing Request Fulfillment Draft Invoice Creation
  // ───────────────────────────────────────────────────────────────────────────
  describe('Challenge 5: Billing Request Fulfillment Draft Invoice Creation', () => {
    let wrId;
    let billingReqId;

    beforeEach(async () => {
      // Create work request
      const wrRes = await request(app)
        .post('/v1/operations/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'WR for Billing Fulfillment Test',
          clientId: CLIENT_ID,
          assignedTo: opsManagerUser.id,
        });
      expect(wrRes.status).toBe(201);
      wrId = wrRes.body.data.id;

      // Seed an operations request of type 'billing'
      billingReqId = '33333333-3333-4333-8333-333333333333';
      mockTables.operations_requests.set(billingReqId, {
        id: billingReqId,
        entity_id: ENTITY_ID,
        type: 'billing',
        status: 'pending',
        work_request_id: wrId,
        client_id: CLIENT_ID,
        requested_by: adminUser.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    it('auto-creates a Draft invoice with INV number and 0 balances upon billing request fulfillment', async () => {
      const res = await request(app)
        .put(`/v1/operations-requests/${billingReqId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'fulfilled',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('fulfilled');

      // Check invoices table
      const invoices = Array.from(mockTables.invoices.values()).filter(
        (inv) => inv.work_request_id === wrId
      );
      expect(invoices.length).toBe(1);

      const invoice = invoices[0];
      expect(invoice.status).toBe('Draft');
      expect(invoice.client_id).toBe(CLIENT_ID);
      expect(invoice.work_request_id).toBe(wrId);
      expect(invoice.entity_id).toBe(ENTITY_ID);
      expect(invoice.invoice_number).toMatch(/^INV-\d{4}-\d{4}(-\d{4})?$/);
      expect(invoice.subtotal).toBe(0);
      expect(invoice.tax_amount).toBe(0);
      expect(invoice.total).toBe(0);
      expect(invoice.amount_paid).toBe(0);
      expect(invoice.balance).toBe(0);
      expect(invoice.notes).toContain(`Auto-generated draft upon approval of billing request ${billingReqId}`);
    });

    it('is idempotent: does not duplicate draft invoice if an invoice already exists for the work request', async () => {
      // Pre-seed an existing invoice for this work request
      const existingInvId = '44444444-4444-4444-8444-444444444444';
      mockTables.invoices.set(existingInvId, {
        id: existingInvId,
        invoice_number: 'INV-2026-9999',
        work_request_id: wrId,
        client_id: CLIENT_ID,
        entity_id: ENTITY_ID,
        status: 'Draft',
        total: 1500,
        balance: 1500,
      });

      const res = await request(app)
        .put(`/v1/operations-requests/${billingReqId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'fulfilled',
        });

      expect(res.status).toBe(200);

      // Check that still only 1 invoice exists for this WR
      const invoices = Array.from(mockTables.invoices.values()).filter(
        (inv) => inv.work_request_id === wrId
      );
      expect(invoices.length).toBe(1);
      expect(invoices[0].id).toBe(existingInvId);
      expect(invoices[0].invoice_number).toBe('INV-2026-9999');
    });

    it('does NOT create an invoice when fulfilling a non-billing request (e.g. disbursement)', async () => {
      const disbReqId = '55555555-5555-4555-8555-555555555555';
      mockTables.operations_requests.set(disbReqId, {
        id: disbReqId,
        entity_id: ENTITY_ID,
        type: 'disbursement',
        status: 'pending',
        work_request_id: wrId,
        client_id: CLIENT_ID,
        requested_by: adminUser.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const res = await request(app)
        .put(`/v1/operations-requests/${disbReqId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          status: 'fulfilled',
        });

      expect(res.status).toBe(200);

      const invoices = Array.from(mockTables.invoices.values()).filter(
        (inv) => inv.work_request_id === wrId
      );
      expect(invoices.length).toBe(0);
    });
  });
});
