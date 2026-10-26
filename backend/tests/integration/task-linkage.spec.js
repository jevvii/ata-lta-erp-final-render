/**
 * Integration Test Suite: Task Linkage & Validation for Invoices and Disbursements (UAT2-6, UAT2-12)
 *
 * Verifies:
 * 1. Invoice creation/update rejects non-existent taskId with 400 TASK_NOT_FOUND.
 * 2. Invoice creation/update rejects taskId not belonging to WR with 400 TASK_WR_MISMATCH.
 * 3. Invoice creation dual-writes task_id and linked_task_id.
 * 4. Invoice list filters by taskId query parameter.
 * 5. Disbursement creation/update rejects non-existent taskId with 400 TASK_NOT_FOUND.
 * 6. Disbursement creation/update rejects taskId not belonging to WR with 400 TASK_WR_MISMATCH.
 * 7. Disbursement creation dual-writes task_id and linked_task_id.
 * 8. Disbursement list filters by taskId query parameter.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('../fixtures/supabaseMock');

describe('Invoice and Disbursement Task Linkage & Validation (UAT2-6/12)', () => {
  let adminToken;
  const clientId = 'a0000000-0000-0000-0000-000000000001';
  const wr1Id = 'b0000000-0000-0000-0000-000000000001';
  const wr2Id = 'b0000000-0000-0000-0000-000000000002';
  const task1Id = 'c0000000-0000-0000-0000-000000000001';
  const task2Id = 'c0000000-0000-0000-0000-000000000002';
  const nonExistentTaskId = 'c9999999-9999-9999-9999-999999999999';

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      id: '11111111-aaaa-bbbb-cccc-000000000001',
      email: 'UAT-admin-linkage@ata-lta.ph',
      name: 'UAT Admin Linkage',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    mockTables.clients.set(clientId, {
      id: clientId,
      name: 'Test Client',
      deleted_at: null,
    });

    // Seed work requests
    mockTables.work_requests.set(wr1Id, {
      id: wr1Id,
      entity_id: 'ent-ata',
      title: 'WR 1',
      status: 'In Progress',
      client_id: clientId,
      deleted_at: null,
    });
    mockTables.work_requests.set(wr2Id, {
      id: wr2Id,
      entity_id: 'ent-ata',
      title: 'WR 2',
      status: 'In Progress',
      client_id: clientId,
      deleted_at: null,
    });

    // Seed tasks
    mockTables.tasks.set(task1Id, {
      id: task1Id,
      work_request_id: wr1Id,
      title: 'Task 1 in WR 1',
      status: 'Pending',
      deleted_at: null,
    });
    mockTables.tasks.set(task2Id, {
      id: task2Id,
      work_request_id: wr2Id,
      title: 'Task 2 in WR 2',
      status: 'Pending',
      deleted_at: null,
    });
  });

  describe('Invoices Task Linkage', () => {
    it('rejects invoice creation with non-existent taskId', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: 'INV-TEST-001',
          clientId,
          workRequestId: wr1Id,
          taskId: nonExistentTaskId,
          issueDate: '2026-10-01',
          dueDate: '2026-10-15',
          lineItems: [{ description: 'Fee', amount: 1000 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_NOT_FOUND');
    });

    it('rejects invoice creation when taskId does not belong to workRequestId', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: 'INV-TEST-002',
          clientId,
          workRequestId: wr1Id,
          taskId: task2Id, // belongs to wr2Id
          issueDate: '2026-10-01',
          dueDate: '2026-10-15',
          lineItems: [{ description: 'Fee', amount: 1000 }],
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_WR_MISMATCH');
    });

    it('creates invoice with matching taskId and dual-writes task_id and linked_task_id', async () => {
      const res = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: 'INV-TEST-003',
          clientId,
          workRequestId: wr1Id,
          taskId: task1Id,
          issueDate: '2026-10-01',
          dueDate: '2026-10-15',
          lineItems: [{ description: 'Fee', amount: 1000 }],
        });

      expect(res.status).toBe(201);
      const invoiceId = res.body.data.id;
      const stored = mockTables.invoices.get(invoiceId);
      expect(stored.task_id).toBe(task1Id);
      expect(stored.linked_task_id).toBe(task1Id);
    });

    it('rejects invoice update when changing to non-existent taskId or mismatched WR', async () => {
      // First create valid invoice
      const createRes = await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: 'INV-TEST-004',
          clientId,
          workRequestId: wr1Id,
          taskId: task1Id,
          issueDate: '2026-10-01',
          dueDate: '2026-10-15',
          lineItems: [{ description: 'Fee', amount: 1000 }],
        });
      expect(createRes.status).toBe(201);
      const invoiceId = createRes.body.data.id;

      // Update with non-existent taskId
      const notFoundRes = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ taskId: nonExistentTaskId });
      expect(notFoundRes.status).toBe(400);
      expect(notFoundRes.body.code).toBe('TASK_NOT_FOUND');

      // Update with mismatched taskId
      const mismatchRes = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ taskId: task2Id }); // task2Id belongs to wr2Id, invoice has wr1Id
      expect(mismatchRes.status).toBe(400);
      expect(mismatchRes.body.code).toBe('TASK_WR_MISMATCH');
    });

    it('filters invoices by taskId query parameter', async () => {
      await request(app)
        .post('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          invoiceNumber: 'INV-TEST-005',
          clientId,
          workRequestId: wr1Id,
          taskId: task1Id,
          issueDate: '2026-10-01',
          dueDate: '2026-10-15',
          lineItems: [{ description: 'Fee', amount: 1000 }],
        });

      const listRes = await request(app)
        .get(`/v1/invoices?taskId=${task1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].invoice_number).toBe('INV-TEST-005');
    });
  });

  describe('Disbursements Task Linkage', () => {
    it('rejects disbursement creation with non-existent taskId', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'SEC filing fee',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: wr1Id,
          taskId: nonExistentTaskId,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_NOT_FOUND');
    });

    it('rejects disbursement creation when taskId does not belong to workRequestId', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'SEC filing fee',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: wr1Id,
          taskId: task2Id, // belongs to wr2Id
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_WR_MISMATCH');
    });

    it('creates disbursement with matching taskId and dual-writes task_id and linked_task_id', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'SEC filing fee',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: wr1Id,
          taskId: task1Id,
        });

      expect(res.status).toBe(201);
      const disbId = res.body.data.id;
      const stored = mockTables.disbursements.get(disbId);
      expect(stored.task_id).toBe(task1Id);
      expect(stored.linked_task_id).toBe(task1Id);
      expect(stored.linked_work_request_id).toBe(wr1Id);
    });

    it('rejects disbursement update when changing to non-existent taskId or mismatched WR', async () => {
      // Create valid draft disbursement
      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'SEC filing fee',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: wr1Id,
          taskId: task1Id,
        });
      expect(createRes.status).toBe(201);
      const disbId = createRes.body.data.id;

      // Update with non-existent taskId
      const notFoundRes = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ taskId: nonExistentTaskId, expectedVersion: 1 });
      expect(notFoundRes.status).toBe(400);
      expect(notFoundRes.body.code).toBe('TASK_NOT_FOUND');

      // Update with mismatched taskId
      const mismatchRes = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ taskId: task2Id, expectedVersion: 1 });
      expect(mismatchRes.status).toBe(400);
      expect(mismatchRes.body.code).toBe('TASK_WR_MISMATCH');
    });

    it('filters disbursements by taskId query parameter', async () => {
      await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Government Fee',
          description: 'Filterable disbursement',
          amount: 750,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: wr1Id,
          taskId: task1Id,
        });

      const listRes = await request(app)
        .get(`/v1/disbursements?taskId=${task1Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
      expect(listRes.body.data[0].description).toBe('Filterable disbursement');
    });
  });
});
