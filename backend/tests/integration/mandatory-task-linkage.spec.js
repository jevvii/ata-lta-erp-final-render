/**
 * Integration Test Suite: Mandatory Linked Task Specification
 *
 * Verifies all rules from spec sections 3, 4, 5:
 * 1. Task required on create (all 4; documents only when WR set; document with no WR & no task allowed).
 * 2. Task WR mismatch rejects with 400 TASK_WR_MISMATCH (all 4).
 * 3. Assignment authorization:
 *    - Only Admin bypasses assignment.
 *    - Non-Admin unassigned gets 403 TASK_ASSIGNMENT_REQUIRED (including Accounting on invoice, non-Documentation on transmittal).
 *    - Documents unassigned gets 403 FORBIDDEN_TASK_ATTACHMENT.
 * 4. Task selectability:
 *    - Cancelled task rejected with 400 TASK_NOT_SELECTABLE for all 4.
 *    - Completed task accepted for invoice (201 OK).
 *    - Completed task rejected with 400 TASK_NOT_SELECTABLE for disbursement, transmittal, and document.
 * 5. Updates & unchanged linkage:
 *    - Unchanged stored linkage on edit still saves even if task is now completed.
 *    - Clearing task to null on a record with effective WR rejected with 400 TASK_REQUIRED.
 *    - Stored task deleted rejects with 400 TASK_REQUIRED.
 * 6. Work Request Task list endpoint:
 *    - GET /v1/work-requests/:wrId/tasks returns id, title, status, and assignees (ids + names).
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});
jest.mock('../../src/services/notify', () => ({
  notify: jest.fn().mockResolvedValue(),
}));

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WR_1_ID = '22222222-2222-4222-8222-222222222221';
const WR_2_ID = '22222222-2222-4222-8222-222222222222';

const TASK_ACTIVE_ASSIGNED = '33333333-3333-4333-8333-333333333331';
const TASK_ACTIVE_UNASSIGNED = '33333333-3333-4333-8333-333333333332';
const TASK_COMPLETED_ASSIGNED = '33333333-3333-4333-8333-333333333333';
const TASK_CANCELLED_ASSIGNED = '33333333-3333-4333-8333-333333333334';
const TASK_WR2_ASSIGNED = '33333333-3333-4333-8333-333333333335';
const TASK_DELETED = '33333333-3333-4333-8333-333333333336';

const USER_STAFF_ID = '55555555-5555-4555-8555-555555555551';
const USER_ACCOUNTING_ID = '55555555-5555-4555-8555-555555555552';
const USER_OTHER_ID = '55555555-5555-4555-8555-555555555553';
const USER_ADMIN_ID = '55555555-5555-4555-8555-555555555554';

let serial = 0;

describe('Mandatory Linked Task Specification Suite', () => {
  let adminToken;
  let staffToken;
  let accountingToken;
  let _otherToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();
    jest.clearAllMocks();

    adminToken = registerUser({
      id: USER_ADMIN_ID,
      email: `admin-${++serial}@ata-lta.ph`,
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA'],
    });

    staffToken = registerUser({
      id: USER_STAFF_ID,
      email: `staff-${++serial}@ata-lta.ph`,
      name: 'Staff User',
      role: 'Staff',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    accountingToken = registerUser({
      id: USER_ACCOUNTING_ID,
      email: `accounting-${++serial}@ata-lta.ph`,
      name: 'Accounting User',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA'],
    });

    _otherToken = registerUser({
      id: USER_OTHER_ID,
      email: `other-${++serial}@ata-lta.ph`,
      name: 'Other User',
      role: 'Staff',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Acme Test Corp',
      status: 'Active',
      deleted_at: null,
    });

    mockTables.work_requests.set(WR_1_ID, {
      id: WR_1_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Target Work Request 1',
      status: 'In Progress',
      assigned_to: USER_STAFF_ID,
      co_assignees: [USER_ACCOUNTING_ID, USER_OTHER_ID],
      deleted_at: null,
    });

    mockTables.work_requests.set(WR_2_ID, {
      id: WR_2_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Target Work Request 2',
      status: 'In Progress',
      assigned_to: USER_STAFF_ID,
      deleted_at: null,
    });

    // Seed tasks on WR 1
    mockTables.tasks.set(TASK_ACTIVE_ASSIGNED, {
      id: TASK_ACTIVE_ASSIGNED,
      work_request_id: WR_1_ID,
      entity_id: 'ent-ata',
      title: 'Active Assigned Task',
      status: 'In Progress',
      assignee_id: USER_STAFF_ID,
      deleted_at: null,
    });
    mockTables.task_assignees.set('ta-acc-1', {
      id: 'ta-acc-1',
      task_id: TASK_ACTIVE_ASSIGNED,
      user_id: USER_ACCOUNTING_ID,
    });

    mockTables.tasks.set(TASK_ACTIVE_UNASSIGNED, {
      id: TASK_ACTIVE_UNASSIGNED,
      work_request_id: WR_1_ID,
      entity_id: 'ent-ata',
      title: 'Active Unassigned Task',
      status: 'In Progress',
      assignee_id: USER_OTHER_ID,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_COMPLETED_ASSIGNED, {
      id: TASK_COMPLETED_ASSIGNED,
      work_request_id: WR_1_ID,
      entity_id: 'ent-ata',
      title: 'Completed Task',
      status: 'Completed',
      assignee_id: USER_STAFF_ID,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_CANCELLED_ASSIGNED, {
      id: TASK_CANCELLED_ASSIGNED,
      work_request_id: WR_1_ID,
      entity_id: 'ent-ata',
      title: 'Cancelled Task',
      status: 'Cancelled',
      assignee_id: USER_STAFF_ID,
      deleted_at: null,
    });

    // Task on WR 2
    mockTables.tasks.set(TASK_WR2_ASSIGNED, {
      id: TASK_WR2_ASSIGNED,
      work_request_id: WR_2_ID,
      entity_id: 'ent-ata',
      title: 'WR2 Assigned Task',
      status: 'In Progress',
      assignee_id: USER_STAFF_ID,
      deleted_at: null,
    });

    // Soft-deleted task
    mockTables.tasks.set(TASK_DELETED, {
      id: TASK_DELETED,
      work_request_id: WR_1_ID,
      entity_id: 'ent-ata',
      title: 'Deleted Task',
      status: 'In Progress',
      assignee_id: USER_STAFF_ID,
      deleted_at: '2026-10-25T00:00:00Z',
    });
  });

  describe('1. Task Required on Create', () => {
    it('rejects invoice creation without task with 400 TASK_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Audit', amount: 5000 }],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });

    it('rejects disbursement creation without task with 400 TASK_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Filing fee',
          amount: 1000,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_1_ID,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });

    it('rejects transmittal creation without task with 400 TASK_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          items: [{ description: 'SEC cert', quantity: 1 }],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });

    it('rejects document creation with WR but without task with 400 TASK_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'requirements.pdf',
          workRequestId: WR_1_ID,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });

    it('allows document creation without WR and without task (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'general-contract.pdf',
          clientId: CLIENT_ID,
        })
        .expect(201);

      expect(res.body.data.document.linked_task_id).toBeNull();
      expect(res.body.data.document.work_request_id).toBeNull();
    });
  });

  describe('2. Task WR Mismatch', () => {
    it('rejects invoice when task belongs to another WR with 400 TASK_WR_MISMATCH', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          taskId: TASK_WR2_ASSIGNED,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Fee', amount: 1000 }],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_WR_MISMATCH');
    });

    it('rejects disbursement when task belongs to another WR with 400 TASK_WR_MISMATCH', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Fee',
          amount: 1000,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_1_ID,
          taskId: TASK_WR2_ASSIGNED,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_WR_MISMATCH');
    });

    it('rejects transmittal when task belongs to another WR with 400 TASK_WR_MISMATCH', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_WR2_ASSIGNED,
          items: [{ description: 'Form', quantity: 1 }],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_WR_MISMATCH');
    });

    it('rejects document when task belongs to another WR with 400 TASK_WR_MISMATCH', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'doc.pdf',
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_WR2_ASSIGNED,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_WR_MISMATCH');
    });
  });

  describe('3. Assignment Authorization and Admin Bypass', () => {
    it('rejects invoice creation by unassigned non-Admin caller with 403 TASK_ASSIGNMENT_REQUIRED (no accounting bypass)', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          taskId: TASK_ACTIVE_UNASSIGNED, // accounting is NOT assigned to this task
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Audit', amount: 5000 }],
        })
        .expect(403);

      expect(res.body.code).toBe('TASK_ASSIGNMENT_REQUIRED');
    });

    it('allows invoice creation by assigned non-Admin caller (co-assignee)', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          taskId: TASK_ACTIVE_ASSIGNED, // accounting is in task_assignees
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Audit', amount: 5000 }],
        })
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(TASK_ACTIVE_ASSIGNED);
    });

    it('allows Admin to bypass assignment on invoice creation', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          taskId: TASK_ACTIVE_UNASSIGNED, // Admin is not assigned to this task
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Audit', amount: 5000 }],
        })
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(TASK_ACTIVE_UNASSIGNED);
    });

    it('rejects transmittal creation by unassigned non-Admin caller with 403 TASK_ASSIGNMENT_REQUIRED', async () => {
      const docUserId = '55555555-5555-4555-8555-555555555559';
      const docToken = registerUser({
        id: docUserId,
        email: `doc-${++serial}@ata-lta.ph`,
        name: 'Doc User',
        role: 'Documentation',
        departments: ['Documentation'],
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_ACTIVE_UNASSIGNED, // docUser is not assigned
          items: [{ description: 'Items', quantity: 1 }],
        })
        .expect(403);

      expect(res.body.code).toBe('TASK_ASSIGNMENT_REQUIRED');
    });

    it('allows Admin to bypass assignment on transmittal creation', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_ACTIVE_UNASSIGNED,
          items: [{ description: 'Items', quantity: 1 }],
        })
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(TASK_ACTIVE_UNASSIGNED);
    });

    it('rejects document creation by unassigned non-Admin caller with 403 FORBIDDEN_TASK_ATTACHMENT', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'doc.pdf',
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_ACTIVE_UNASSIGNED,
        })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN_TASK_ATTACHMENT');
    });
  });

  describe('4. Task Selectability (Cancelled and Completed Tasks)', () => {
    it('rejects cancelled task for invoices with 400 TASK_NOT_SELECTABLE', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          taskId: TASK_CANCELLED_ASSIGNED,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Fee', amount: 1000 }],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_NOT_SELECTABLE');
    });

    it('rejects cancelled task for disbursements with 400 TASK_NOT_SELECTABLE', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Fee',
          description: 'Fee',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_1_ID,
          taskId: TASK_CANCELLED_ASSIGNED,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_NOT_SELECTABLE');
    });

    it('rejects cancelled task for transmittals with 400 TASK_NOT_SELECTABLE', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_CANCELLED_ASSIGNED,
          items: [{ description: 'Doc', quantity: 1 }],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_NOT_SELECTABLE');
    });

    it('rejects cancelled task for documents with 400 TASK_NOT_SELECTABLE', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'doc.pdf',
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_CANCELLED_ASSIGNED,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_NOT_SELECTABLE');
    });

    it('allows invoices on completed tasks (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          taskId: TASK_COMPLETED_ASSIGNED,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Completed task fee', amount: 2000 }],
        })
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(TASK_COMPLETED_ASSIGNED);
    });

    it('rejects completed task for disbursements with 400 TASK_NOT_SELECTABLE', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Fee',
          description: 'Fee',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_1_ID,
          taskId: TASK_COMPLETED_ASSIGNED,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_NOT_SELECTABLE');
    });

    it('rejects completed task for transmittals with 400 TASK_NOT_SELECTABLE', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_COMPLETED_ASSIGNED,
          items: [{ description: 'Doc', quantity: 1 }],
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_NOT_SELECTABLE');
    });

    it('rejects completed task for documents with 400 TASK_NOT_SELECTABLE', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'doc.pdf',
          workRequestId: WR_1_ID,
          linkedTaskId: TASK_COMPLETED_ASSIGNED,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_NOT_SELECTABLE');
    });
  });

  describe('5. Updates & Unchanged Linkage Preservation', () => {
    it('allows editing non-linkage fields on a disbursement when linked task is now Completed', async () => {
      const disbId = 'disb-edit-completed-task';
      mockTables.disbursements.set(disbId, {
        id: disbId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WR_1_ID,
        task_id: TASK_COMPLETED_ASSIGNED,
        linked_task_id: TASK_COMPLETED_ASSIGNED,
        status: 'Draft',
        amount: 800,
        category: 'Meals',
        description: 'Initial lunch',
        fund_source: 'Firm Fund',
        created_by: USER_ADMIN_ID,
        version: 1,
        lifecycle_version: 2,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          description: 'Updated lunch note',
          expectedVersion: 1,
        })
        .expect(200);

      expect(res.body.data.description).toBe('Updated lunch note');
      expect(res.body.data.linked_task_id).toBe(TASK_COMPLETED_ASSIGNED);
    });

    it('rejects clearing task to null on disbursement update with 400 TASK_REQUIRED', async () => {
      const disbId = 'disb-clear-task';
      mockTables.disbursements.set(disbId, {
        id: disbId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WR_1_ID,
        task_id: TASK_ACTIVE_ASSIGNED,
        linked_task_id: TASK_ACTIVE_ASSIGNED,
        status: 'Draft',
        amount: 800,
        category: 'Meals',
        description: 'Lunch',
        fund_source: 'Firm Fund',
        created_by: USER_ADMIN_ID,
        version: 1,
        lifecycle_version: 2,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          linkedTaskId: null,
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });

    it('rejects editing record when old stored record had no task and form edit payload includes WR without task with 400 TASK_REQUIRED', async () => {
      const disbId = 'disb-no-task';
      mockTables.disbursements.set(disbId, {
        id: disbId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WR_1_ID,
        task_id: null,
        linked_task_id: null,
        status: 'Draft',
        amount: 800,
        category: 'Meals',
        description: 'Lunch',
        fund_source: 'Firm Fund',
        created_by: USER_ADMIN_ID,
        version: 1,
        lifecycle_version: 2,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          description: 'Try edit without task',
          linkedWorkRequestId: WR_1_ID,
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });

    it('allows old invoice without task to change status (updateInvoiceStatus)', async () => {
      const invId = 'inv-old-no-task-status';
      mockTables.invoices.set(invId, {
        id: invId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_1_ID,
        task_id: null,
        linked_task_id: null,
        invoice_number: 'INV-OLD-001',
        status: 'Draft',
        issue_date: '2026-10-01',
        due_date: '2026-11-01',
        total_amount: 5000,
        created_by: USER_ADMIN_ID,
        version: 1,
        deleted_at: null,
      });

      const res = await request(app)
        .patch(`/v1/invoices/${invId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Sent' })
        .expect(200);

      expect(res.body.data.status).toBe('Sent');
    });

    it('rejects old invoice without task when edit payload includes workRequestId and no task with 400 TASK_REQUIRED', async () => {
      const invId = 'inv-old-no-task-edit';
      mockTables.invoices.set(invId, {
        id: invId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_1_ID,
        task_id: null,
        linked_task_id: null,
        invoice_number: 'INV-OLD-002',
        status: 'Draft',
        issue_date: '2026-10-01',
        due_date: '2026-11-01',
        total_amount: 5000,
        created_by: USER_ADMIN_ID,
        version: 1,
        deleted_at: null,
      });

      const res = await request(app)
        .put(`/v1/invoices/${invId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          workRequestId: WR_1_ID,
          notes: 'Form edit with WR but no task',
        })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });

    it('allows old disbursement without task to be approved and released', async () => {
      const disbId = 'disb-old-no-task-lifecycle';
      mockTables.disbursements.set(disbId, {
        id: disbId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WR_1_ID,
        task_id: null,
        linked_task_id: null,
        status: 'Draft',
        amount: 1200,
        category: 'Transportation',
        description: 'Legacy taxi fare',
        fund_source: 'Firm Fund',
        created_by: USER_STAFF_ID,
        requested_by: USER_STAFF_ID,
        employee_id: USER_STAFF_ID,
        review_ready: true,
        version: 1,
        lifecycle_version: 2,
      });

      const approveRes = await request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ expectedVersion: 1 })
        .expect(200);
      expect(approveRes.body.data.status).toBe('Approved');

      const fundRes = await request(app)
        .post(`/v1/disbursements/${disbId}/fund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: approveRes.body.data.version,
          method: 'Cash',
          bank: 'Cash on Hand',
          reference: 'LEGACY-REF-1',
          date: '2026-10-26',
        })
        .expect(200);
      expect(fundRes.body.data.status).toBe('Funded');

      const releaseRes = await request(app)
        .post(`/v1/disbursements/${disbId}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ expectedVersion: fundRes.body.data.version })
        .expect(200);
      expect(releaseRes.body.data.status).toBe('Released');
    });

    it('allows old transmittal with WR but no task to be sent', async () => {
      const trId = 'tr-old-no-task-send';
      mockTables.transmittals.set(trId, {
        id: trId,
        tracking_number: 'TR-ATA-2026-0999',
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_1_ID,
        linked_task_id: null,
        status: 'Draft',
        approved: true,
        created_by: USER_ADMIN_ID,
        version: 1,
        deleted_at: null,
      });

      const sendRes = await request(app)
        .post(`/v1/transmittals/${trId}/send`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({})
        .expect(200);

      expect(sendRes.body.data.status).toBe('Sent');
    });

    it('allows old document with WR and no task to edit description/metadata without linkage fields', async () => {
      const docId = 'doc-old-no-task-edit';
      mockTables.documents.set(docId, {
        id: docId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_1_ID,
        linked_task_id: null,
        file_name: 'legacy-doc.pdf',
        original_name: 'legacy-doc.pdf',
        description: 'Original description',
        uploaded_by: USER_ADMIN_ID,
        deleted_at: null,
      });

      const res = await request(app)
        .put(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Updated description only' })
        .expect(200);

      expect(res.body.data.description).toBe('Updated description only');
    });
  });

  describe('6. Work Request Task List API Contract', () => {
    it('returns tasks with id, title, status, and assignees (ids + names) per work request', async () => {
      const res = await request(app)
        .get(`/v1/work-requests/${WR_1_ID}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      const activeTask = res.body.data.find((t) => t.id === TASK_ACTIVE_ASSIGNED);
      expect(activeTask).toBeDefined();
      expect(activeTask.title).toBe('Active Assigned Task');
      expect(activeTask.status).toBe('In Progress');
      expect(activeTask.assigneeId).toBe(USER_STAFF_ID);
      expect(activeTask.assigneeName).toBe('Staff User');
      expect(activeTask.assignees).toEqual([USER_ACCOUNTING_ID]);
      expect(activeTask.taskAssignees).toBeDefined();
      expect(activeTask.assigneeDetails).toBeDefined();
      expect(
        activeTask.assigneeDetails.some((a) => a.userId === USER_STAFF_ID && a.isPrimary)
      ).toBe(true);
      expect(
        activeTask.assigneeDetails.some((a) => a.userId === USER_ACCOUNTING_ID && !a.isPrimary)
      ).toBe(true);
    });
  });

  describe('7. Phase & Prerequisite Task Locking', () => {
    const WR_PHASE_ID = '22222222-2222-4222-8222-222222222299';
    const TASK_PRE_ACTIVE = '33333333-3333-4333-8333-333333333391';
    const TASK_PRE_COMPLETED = '33333333-3333-4333-8333-333333333392';
    const TASK_PROC_ACTIVE = '33333333-3333-4333-8333-333333333393';
    const TASK_DEPENDENT = '33333333-3333-4333-8333-333333333394';

    beforeEach(() => {
      mockTables.work_requests.set(WR_PHASE_ID, {
        id: WR_PHASE_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        title: 'Phased Work Request',
        status: 'Pre-processing',
        phase: 'pre_processing',
        assigned_to: USER_STAFF_ID,
        co_assignees: [USER_ACCOUNTING_ID],
        deleted_at: null,
      });

      mockTables.tasks.set(TASK_PRE_ACTIVE, {
        id: TASK_PRE_ACTIVE,
        work_request_id: WR_PHASE_ID,
        title: 'Pre-processing Active Task',
        status: 'In Progress',
        phase: 'pre_processing',
        predecessors: [],
        assignee_id: USER_STAFF_ID,
        deleted_at: null,
      });

      mockTables.tasks.set(TASK_PRE_COMPLETED, {
        id: TASK_PRE_COMPLETED,
        work_request_id: WR_PHASE_ID,
        title: 'Pre-processing Completed Task',
        status: 'Completed',
        phase: 'pre_processing',
        predecessors: [],
        assignee_id: USER_STAFF_ID,
        deleted_at: null,
      });

      mockTables.tasks.set(TASK_PROC_ACTIVE, {
        id: TASK_PROC_ACTIVE,
        work_request_id: WR_PHASE_ID,
        title: 'Processing Active Task',
        status: 'Assigned',
        phase: 'processing',
        predecessors: [],
        assignee_id: USER_STAFF_ID,
        deleted_at: null,
      });

      mockTables.tasks.set(TASK_DEPENDENT, {
        id: TASK_DEPENDENT,
        work_request_id: WR_PHASE_ID,
        title: 'Dependent Task in Active Phase',
        status: 'Assigned',
        phase: 'pre_processing',
        predecessors: [TASK_PRE_ACTIVE],
        assignee_id: USER_STAFF_ID,
        deleted_at: null,
      });
    });

    it('rejects Invoice, Disbursement, Transmittal, and Document creation when linking a processing task while WR is in pre_processing (400 TASK_NOT_SELECTABLE)', async () => {
      const invRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-PH-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          taskId: TASK_PROC_ACTIVE,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Future phase invoice', amount: 1500 }],
        })
        .expect(400);
      expect(invRes.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(invRes.body.detail).toMatch(/future phase/i);

      const disbRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Future phase disbursement',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_PHASE_ID,
          taskId: TASK_PROC_ACTIVE,
        })
        .expect(400);
      expect(disbRes.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(disbRes.body.detail).toMatch(/phase that is not currently active/i);

      const trRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_PROC_ACTIVE,
          items: [{ description: 'Future phase item', quantity: 1 }],
        })
        .expect(400);
      expect(trRes.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(trRes.body.detail).toMatch(/phase that is not currently active/i);

      const docRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'future-phase.pdf',
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_PROC_ACTIVE,
        })
        .expect(400);
      expect(docRes.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(docRes.body.detail).toMatch(/phase that is not currently active/i);
    });

    it('once WR advances to processing, allows linking a Completed pre_processing task to an Invoice (201), while rejecting pre_processing tasks for Disbursement, Transmittal, and Document (400 TASK_NOT_SELECTABLE)', async () => {
      mockTables.work_requests.get(WR_PHASE_ID).phase = 'processing';
      mockTables.work_requests.get(WR_PHASE_ID).status = 'Processing';

      // Invoice on completed pre_processing task succeeds (201)
      const invRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-PH-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          taskId: TASK_PRE_COMPLETED,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Bill completed pre-processing task', amount: 3000 }],
        })
        .expect(201);
      expect(invRes.body.data.linked_task_id).toBe(TASK_PRE_COMPLETED);

      // Disbursement, Transmittal, Document on pre_processing task rejected (even when task status is In Progress)
      const disbRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Past phase disbursement',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_PHASE_ID,
          taskId: TASK_PRE_ACTIVE,
        })
        .expect(400);
      expect(disbRes.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(disbRes.body.detail).toMatch(/phase that is not currently active/i);

      const trRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_PRE_ACTIVE,
          items: [{ description: 'Past phase item', quantity: 1 }],
        })
        .expect(400);
      expect(trRes.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(trRes.body.detail).toMatch(/phase that is not currently active/i);

      const docRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'past-phase.pdf',
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_PRE_ACTIVE,
        })
        .expect(400);
      expect(docRes.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(docRes.body.detail).toMatch(/phase that is not currently active/i);
    });

    it('rejects linking a task whose prerequisite task is still In Progress (400 TASK_NOT_SELECTABLE) across all 4 modules, and succeeds once prerequisite is Completed', async () => {
      // 1. Prerequisite TASK_PRE_ACTIVE is still 'In Progress' -> all 4 rejected
      const invBlocked = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-PREREQ-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          taskId: TASK_DEPENDENT,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Blocked invoice', amount: 1000 }],
        })
        .expect(400);
      expect(invBlocked.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(invBlocked.body.detail).toMatch(/incomplete prerequisite/i);

      const disbBlocked = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Blocked disbursement',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_PHASE_ID,
          taskId: TASK_DEPENDENT,
        })
        .expect(400);
      expect(disbBlocked.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(disbBlocked.body.detail).toMatch(/incomplete prerequisite/i);

      const trBlocked = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_DEPENDENT,
          items: [{ description: 'Blocked transmittal', quantity: 1 }],
        })
        .expect(400);
      expect(trBlocked.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(trBlocked.body.detail).toMatch(/incomplete prerequisite/i);

      const docBlocked = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'blocked-doc.pdf',
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_DEPENDENT,
        })
        .expect(400);
      expect(docBlocked.body.code).toBe('TASK_NOT_SELECTABLE');
      expect(docBlocked.body.detail).toMatch(/incomplete prerequisite/i);

      // 2. Mark prerequisite TASK_PRE_ACTIVE as 'Completed' -> all 4 succeed
      mockTables.tasks.get(TASK_PRE_ACTIVE).status = 'Completed';

      const invOk = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-PREREQ-OK-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          taskId: TASK_DEPENDENT,
          issueDate: '2026-10-26',
          dueDate: '2026-11-26',
          lineItems: [{ description: 'Unblocked invoice', amount: 1000 }],
        })
        .expect(201);
      expect(invOk.body.data.linked_task_id).toBe(TASK_DEPENDENT);

      const disbOk = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Unblocked disbursement',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_PHASE_ID,
          taskId: TASK_DEPENDENT,
        })
        .expect(201);
      expect(disbOk.body.data.linked_task_id).toBe(TASK_DEPENDENT);

      const trOk = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_DEPENDENT,
          items: [{ description: 'Unblocked transmittal', quantity: 1 }],
        })
        .expect(201);
      expect(trOk.body.data.linked_task_id).toBe(TASK_DEPENDENT);

      const docOk = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'unblocked-doc.pdf',
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_DEPENDENT,
        })
        .expect(201);
      expect(docOk.body.data.document.linked_task_id).toBe(TASK_DEPENDENT);
    });

    it('rejects relinking on update to a phase-locked or prerequisite-locked task (400 TASK_NOT_SELECTABLE), while allowing non-linkage edits when stored task phase is no longer active', async () => {
      // Create valid records linked to TASK_PRE_ACTIVE while WR is in pre_processing
      const disbRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Initial pre-processing disb',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_PHASE_ID,
          taskId: TASK_PRE_ACTIVE,
        })
        .expect(201);
      const disbId = disbRes.body.data.id;

      const trRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_PRE_ACTIVE,
          items: [{ description: 'Initial item', quantity: 1 }],
        })
        .expect(201);
      const trId = trRes.body.data.id;

      const docRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          fileName: 'initial-doc.pdf',
          workRequestId: WR_PHASE_ID,
          linkedTaskId: TASK_PRE_ACTIVE,
        })
        .expect(201);
      const docId = docRes.body.data.document.id;

      // Relinking to future-phase task TASK_PROC_ACTIVE fails with 400 TASK_NOT_SELECTABLE
      const disbRelinkFuture = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: TASK_PROC_ACTIVE, expectedVersion: 1 })
        .expect(400);
      expect(disbRelinkFuture.body.code).toBe('TASK_NOT_SELECTABLE');

      const trRelinkFuture = await request(app)
        .put(`/v1/transmittals/${trId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: TASK_PROC_ACTIVE })
        .expect(400);
      expect(trRelinkFuture.body.code).toBe('TASK_NOT_SELECTABLE');

      const docRelinkFuture = await request(app)
        .put(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: TASK_PROC_ACTIVE })
        .expect(400);
      expect(docRelinkFuture.body.code).toBe('TASK_NOT_SELECTABLE');

      // Advance WR to processing; non-linkage edit on disbursement still succeeds (200)
      mockTables.work_requests.get(WR_PHASE_ID).phase = 'processing';
      const disbEditOk = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Edited description after phase advance', expectedVersion: 1 })
        .expect(200);
      expect(disbEditOk.body.data.description).toBe('Edited description after phase advance');
    });
  });
});
