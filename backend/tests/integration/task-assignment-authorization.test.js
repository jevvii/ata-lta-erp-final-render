/**
 * Focused behavioral test suite for task assignment authorization remediation.
 * Tests:
 * 1. Receipt reservation claim protection: unassigned disbursement creation rejects before claiming reservation.
 * 2. Denied row & line-item absence on 403 rejections.
 * 3. Consistent dual aliases vs conflicting non-empty aliases.
 * 4. Relink origin and destination scope verification.
 * 5. Admin change approval path in admin/service.js.
 * 6. Preserved WR-only workflows across modules.
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
const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('../fixtures/supabaseMock');
const receiptReservationStore = require('../../src/modules/disbursements/receiptReservationStore');
const adminService = require('../../src/modules/admin/service');

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WR_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ASSIGNED = '33333333-3333-4333-8333-333333333333';
const TASK_UNASSIGNED = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_USER_ID = '66666666-6666-4666-8666-666666666666';

let serial = 0;

describe('Task Assignment Authorization Deep Verifications', () => {
  let userToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();
    jest.clearAllMocks();

    userToken = registerUser({
      id: USER_ID,
      email: `test-user-${++serial}@ata-lta.ph`,
      name: 'Test Staff',
      role: 'Staff',
      departments: ['Accounting', 'Operations'],
      entities: ['ATA'],
    });

    registerUser({
      email: `test-admin-${++serial}@ata-lta.ph`,
      name: 'Test Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Test Client',
      status: 'Active',
    });

    mockTables.work_requests.set(WR_ID, {
      id: WR_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Target Work Request',
      status: 'In Progress',
      assigned_to: USER_ID,
      deleted_at: null,
    });

    // Assigned task: primary assignee is USER_ID
    mockTables.tasks.set(TASK_ASSIGNED, {
      id: TASK_ASSIGNED,
      work_request_id: WR_ID,
      entity_id: 'ent-ata',
      title: 'Assigned Task',
      assignee_id: USER_ID,
      deleted_at: null,
    });

    // Unassigned task: primary assignee is OTHER_USER_ID
    mockTables.tasks.set(TASK_UNASSIGNED, {
      id: TASK_UNASSIGNED,
      work_request_id: WR_ID,
      entity_id: 'ent-ata',
      title: 'Unassigned Task',
      assignee_id: OTHER_USER_ID,
      deleted_at: null,
    });
  });

  describe('1. Receipt Reservation Claim Protection', () => {
    it('does NOT call claimReservationByKey when task authorization fails for unassigned caller', async () => {
      const claimSpy = jest.spyOn(receiptReservationStore, 'claimReservationByKey');

      const payload = {
        category: 'Transportation',
        description: 'Site visit taxi',
        amount: 250,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ID,
        linkedTaskId: TASK_UNASSIGNED,
        receiptS3Key: 'receipts/test-taxi.jpg',
        receiptFilename: 'test-taxi.jpg',
      };

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload)
        .expect(403);

      expect(res.body.code).toBe('TASK_ASSIGNMENT_REQUIRED');
      // Critical check: claimReservationByKey was never invoked!
      expect(claimSpy).not.toHaveBeenCalled();
      // Zero rows inserted
      expect(mockTables.disbursements.size).toBe(0);

      claimSpy.mockRestore();
    });
  });

  describe('2. Absence of Persisted Records on 403', () => {
    it('does not insert an operations request row when unassigned caller requests billing', async () => {
      const initialCount = mockTables.operations_requests.size;

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WR_ID,
          linkedTaskId: TASK_UNASSIGNED,
          notes: 'Unassigned billing request',
        })
        .expect(403);

      expect(res.body.code).toBe('TASK_ASSIGNMENT_REQUIRED');
      expect(mockTables.operations_requests.size).toBe(initialCount);
    });

    it('does not insert an invoice or invoice line items when unassigned caller creates invoice', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          linkedTaskId: TASK_UNASSIGNED,
          issueDate: '2026-10-24',
          dueDate: '2026-11-24',
          lineItems: [{ description: 'Audit', amount: 5000, type: 'Professional Fee' }],
        })
        .expect(403);

      expect(res.body.code).toBe('TASK_ASSIGNMENT_REQUIRED');
      expect(mockTables.invoices.size).toBe(0);
      expect(mockTables.invoice_line_items.size).toBe(0);
    });
  });

  describe('3. Alias Consistency and Conflict Detection', () => {
    it('accepts dual consistent aliases for task (taskId and linkedTaskId)', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          taskId: TASK_ASSIGNED,
          linkedTaskId: TASK_ASSIGNED,
          issueDate: '2026-10-24',
          dueDate: '2026-11-24',
          lineItems: [{ description: 'Legal service', amount: 2000, type: 'Professional Fee' }],
        })
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(TASK_ASSIGNED);
    });

    it('rejects conflicting nonempty task aliases with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: `INV-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          taskId: TASK_ASSIGNED,
          linkedTaskId: TASK_UNASSIGNED,
          issueDate: '2026-10-24',
          dueDate: '2026-11-24',
          lineItems: [{ description: 'Legal service', amount: 2000, type: 'Professional Fee' }],
        })
        .expect(400);

      expect(res.body.code).toBe('CONFLICTING_TASK_ALIASES');
      expect(mockTables.invoices.size).toBe(0);
    });
  });

  describe('4. Relink Origin and Destination Scope Authorization', () => {
    const INVOICE_ID = '77777777-7777-4777-8777-777777777777';

    it('prevents non-admin from unlinking a task they do not own', async () => {
      mockTables.invoices.set(INVOICE_ID, {
        id: INVOICE_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_ID,
        task_id: TASK_UNASSIGNED,
        linked_task_id: TASK_UNASSIGNED,
        status: 'Draft',
        version: 1,
        total: 1000,
        subtotal: 1000,
        balance: 1000,
        amount_paid: 0,
        created_by: OTHER_USER_ID,
      });

      const res = await request(app)
        .put(`/v1/invoices/${INVOICE_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          linkedTaskId: null,
          expectedVersion: 1,
        })
        .expect(403);

      expect(res.body.code).toBe('TASK_ASSIGNMENT_REQUIRED');
      // Task link is preserved
      expect(mockTables.invoices.get(INVOICE_ID).task_id).toBe(TASK_UNASSIGNED);
    });

    it('allows assigned user to unlink their own task (setting to null)', async () => {
      mockTables.invoices.set(INVOICE_ID, {
        id: INVOICE_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_ID,
        task_id: TASK_ASSIGNED,
        linked_task_id: TASK_ASSIGNED,
        status: 'Draft',
        version: 1,
        total: 1000,
        subtotal: 1000,
        balance: 1000,
        amount_paid: 0,
        created_by: USER_ID,
      });

      const res = await request(app)
        .put(`/v1/invoices/${INVOICE_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          linkedTaskId: null,
          expectedVersion: 1,
        })
        .expect(200);

      expect(res.body.data.linked_task_id).toBeNull();
      const saved = mockTables.invoices.get(INVOICE_ID);
      expect(saved.task_id).toBeNull();
      expect(saved.linked_task_id).toBeNull();
    });
  });

  describe('5. Admin Change Approval Path', () => {
    it('successfully processes admin change approvals for invoices and disbursements', async () => {
      const adminUser = {
        id: 'admin-uuid-1',
        name: 'System Admin',
        role: 'Admin',
        entities: ['ATA'],
      };

      const changeId = 'change-uuid-1';
      mockTables.pending_changes.set(changeId, {
        id: changeId,
        entity_id: 'ent-ata',
        table_name: 'invoices',
        parent_record_id: null,
        status: 'pending',
        proposed_data: {
          invoiceNumber: `INV-ADMIN-${++serial}`,
          clientId: CLIENT_ID,
          workRequestId: WR_ID,
          linkedTaskId: TASK_UNASSIGNED, // Admin is exempt from task assignment
          issueDate: '2026-10-24',
          dueDate: '2026-11-24',
          lineItems: [{ description: 'Admin billing', amount: 500, type: 'Professional Fee' }],
        },
      });

      // Test invoice creation via admin approval
      await adminService.approvePending({
        id: changeId,
        user: adminUser,
      });

      expect(mockTables.invoices.size).toBe(1);
    });
  });

  describe('6. Regression Tests for Review 3 Findings', () => {
    const VOUCHER_ID = '88888888-8888-4888-8888-888888888888';
    const FOREIGN_WR_ID = '99999999-9999-4999-9999-999999999999';
    const CLIENT_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const WR_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const TASK_B_ASSIGNED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

    it('rejects foreign-entity WR on snake_case linked_work_request_id update of WR-only voucher without mutation', async () => {
      mockTables.disbursements.set(VOUCHER_ID, {
        id: VOUCHER_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WR_ID,
        task_id: null,
        linked_task_id: null,
        status: 'Draft',
        version: 1,
        lifecycle_version: 2,
        amount: 300,
        category: 'Transportation',
        description: 'Transit fare',
        fund_source: 'Firm Fund',
        created_by: USER_ID,
        requested_by: USER_ID,
        employee_id: USER_ID,
      });

      mockTables.work_requests.set(FOREIGN_WR_ID, {
        id: FOREIGN_WR_ID,
        entity_id: 'ent-lta', // Foreign entity!
        client_id: CLIENT_ID,
        title: 'LTA Work Request',
        status: 'In Progress',
        deleted_at: null,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${VOUCHER_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          linked_work_request_id: FOREIGN_WR_ID,
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_WORK_REQUEST');
      // Persisted voucher is strictly unmodified
      const persisted = mockTables.disbursements.get(VOUCHER_ID);
      expect(persisted.linked_work_request_id).toBe(WR_ID);
    });

    it('rejects linked_task_id update on Released voucher with 409 without mutation, but succeeds on Draft', async () => {
      mockTables.disbursements.set(VOUCHER_ID, {
        id: VOUCHER_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WR_ID,
        task_id: null,
        linked_task_id: null,
        status: 'Released',
        version: 1,
        lifecycle_version: 2,
        amount: 300,
        category: 'Transportation',
        description: 'Transit fare',
        fund_source: 'Firm Fund',
        created_by: USER_ID,
        requested_by: USER_ID,
        employee_id: USER_ID,
      });

      // 1. Released voucher mutation attempt fails with 409
      const res = await request(app)
        .put(`/v1/disbursements/${VOUCHER_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          linked_task_id: TASK_ASSIGNED,
          expectedVersion: 1,
        })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT_CURRENT_STATUS');
      const persistedReleased = mockTables.disbursements.get(VOUCHER_ID);
      expect(persistedReleased.task_id).toBeNull();
      expect(persistedReleased.linked_task_id).toBeNull();

      // 2. Draft voucher mutation succeeds with 200 (valid transition)
      mockTables.disbursements.get(VOUCHER_ID).status = 'Draft';
      const validRes = await request(app)
        .put(`/v1/disbursements/${VOUCHER_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          linked_task_id: TASK_ASSIGNED,
          expectedVersion: 1,
        })
        .expect(200);

      expect(validRes.body.data.linked_task_id).toBe(TASK_ASSIGNED);
      const persistedDraft = mockTables.disbursements.get(VOUCHER_ID);
      expect(persistedDraft.task_id).toBe(TASK_ASSIGNED);
      expect(persistedDraft.linked_task_id).toBe(TASK_ASSIGNED);
    });

    it('rejects invoice relink across clients when clientId is omitted, but succeeds when explicit destination clientId provided', async () => {
      const INVOICE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

      mockTables.clients.set(CLIENT_B, {
        id: CLIENT_B,
        entity_id: 'ent-ata',
        name: 'Client B',
      });

      mockTables.work_requests.set(WR_B_ID, {
        id: WR_B_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_B,
        title: 'WR for Client B',
        status: 'In Progress',
        deleted_at: null,
      });

      mockTables.tasks.set(TASK_B_ASSIGNED, {
        id: TASK_B_ASSIGNED,
        work_request_id: WR_B_ID,
        entity_id: 'ent-ata',
        title: 'Task on WR B',
        assignee_id: USER_ID,
        deleted_at: null,
      });

      mockTables.invoices.set(INVOICE_ID, {
        id: INVOICE_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_ID,
        task_id: TASK_ASSIGNED,
        linked_task_id: TASK_ASSIGNED,
        status: 'Draft',
        version: 1,
        total: 1000,
        subtotal: 1000,
        balance: 1000,
        amount_paid: 0,
        created_by: USER_ID,
      });

      // 1. Relinking to TASK_B_ASSIGNED with omitted clientId fails with 400 without mutation
      const rejectRes = await request(app)
        .put(`/v1/invoices/${INVOICE_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          workRequestId: WR_B_ID,
          linkedTaskId: TASK_B_ASSIGNED,
          expectedVersion: 1,
        })
        .expect(400);

      expect(rejectRes.body.code).toBe('CLIENT_WR_MISMATCH');
      const persistedAfterReject = mockTables.invoices.get(INVOICE_ID);
      expect(persistedAfterReject.work_request_id).toBe(WR_ID);
      expect(persistedAfterReject.task_id).toBe(TASK_ASSIGNED);
      expect(persistedAfterReject.client_id).toBe(CLIENT_ID);

      // 2. Relinking with explicit matching clientId succeeds (valid transition)
      const successRes = await request(app)
        .put(`/v1/invoices/${INVOICE_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_B,
          workRequestId: WR_B_ID,
          linkedTaskId: TASK_B_ASSIGNED,
          expectedVersion: 1,
        })
        .expect(200);

      expect(successRes.body.data.linked_task_id).toBe(TASK_B_ASSIGNED);
      const persistedAfterSuccess = mockTables.invoices.get(INVOICE_ID);
      expect(persistedAfterSuccess.work_request_id).toBe(WR_B_ID);
      expect(persistedAfterSuccess.task_id).toBe(TASK_B_ASSIGNED);
      expect(persistedAfterSuccess.client_id).toBe(CLIENT_B);
    });

    it('rejects linkedWorkRequestId modifications on non-Draft invoice via FINANCIAL_FIELDS guard', async () => {
      const INVOICE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

      mockTables.invoices.set(INVOICE_ID, {
        id: INVOICE_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_ID,
        task_id: TASK_ASSIGNED,
        linked_task_id: TASK_ASSIGNED,
        status: 'Sent', // Non-draft
        version: 1,
        total: 1000,
        subtotal: 1000,
        balance: 1000,
        amount_paid: 0,
        created_by: USER_ID,
      });

      const res = await request(app)
        .put(`/v1/invoices/${INVOICE_ID}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          linkedWorkRequestId: WR_ID,
          expectedVersion: 1,
        })
        .expect(409);

      expect(res.body.code).toBe('INVOICE_NOT_DRAFT');
    });
  });
});
