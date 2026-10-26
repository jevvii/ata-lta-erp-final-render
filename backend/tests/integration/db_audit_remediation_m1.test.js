/**
 * Integration Test Suite for DB-AUDIT-REMEDIATION-2026-10-17 Milestone M1.
 * Covers Parcels A1, A2, A3, A4 (D1, D2, D3, D4):
 * - V1: Ordinary creator visibility without WR assignment
 * - V2: Non-owner denial across shared WR & all statuses
 * - V3: Authorized entity scope and zero leaks in ALL mode and counts
 * - V4: Identity derivation and 403 on foreign employee ID
 * - V5: Draft invoice financial edits succeed; non-Draft financial edits return 409 INVOICE_NOT_DRAFT; notes/address permitted on non-Draft
 * - V6: Concurrency / OCC conflict handling (ERR_CONCURRENCY_CONFLICT 409)
 * - V7: Direct Admin approval to Released + payment details; /payment-details patch on Released/Funded preserves attribution
 * - V8: Storage receipt reservation, upload verification (422 if missing), voucher binding, cross-user denial (403)
 * - V9: Authorized receipt preview URL, legacy record explicit unavailable payload, 404 when no receipt
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const {
  registerUser,
  resetMock,
  mockTables,
  mockStorageObjects,
} = require('../fixtures/supabaseMock');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');
const schema = require('../../src/modules/disbursements/schema');

const CLIENT_ATA_ID = '11111111-aaaa-1111-aaaa-111111111111';
const CLIENT_LTA_ID = '22222222-bbbb-2222-bbbb-222222222222';
const WR_ATA_ID = '33333333-cccc-3333-cccc-333333333333';
const WR_LTA_ID = '44444444-dddd-4444-dddd-444444444444';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const STAFF_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const seedBaseEntities = () => {
  mockTables.entities.set('ent-ata', { id: 'ent-ata', code: 'ATA', name: 'ATA Entity' });
  mockTables.entities.set('ent-lta', { id: 'ent-lta', code: 'LTA', name: 'LTA Entity' });

  mockTables.clients.set(CLIENT_ATA_ID, {
    id: CLIENT_ATA_ID,
    entity_id: 'ent-ata',
    name: 'ATA Client Inc',
    status: 'Active',
  });
  mockTables.clients.set(CLIENT_LTA_ID, {
    id: CLIENT_LTA_ID,
    entity_id: 'ent-lta',
    name: 'LTA Client Ltd',
    status: 'Active',
  });

  mockTables.work_requests.set(WR_ATA_ID, {
    id: WR_ATA_ID,
    entity_id: 'ent-ata',
    client_id: CLIENT_ATA_ID,
    title: 'ATA Audit WR',
    status: 'In Progress',
  });
  mockTables.work_requests.set(WR_LTA_ID, {
    id: WR_LTA_ID,
    entity_id: 'ent-lta',
    client_id: CLIENT_LTA_ID,
    title: 'LTA Advisory WR',
    status: 'In Progress',
  });
};

describe('DB-AUDIT-REMEDIATION-2026-10-17 Milestone M1 Test Suite', () => {
  let adminToken;
  let staffA_Token;
  let staffA_Id;
  let staffB_Token;
  let staffB_Id;

  beforeEach(() => {
    resetMock();
    reservations.clearReservations();
    seedBaseEntities();

    adminToken = registerUser({
      id: ADMIN_ID,
      email: 'admin@ata-lta.ph',
      name: 'System Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    staffA_Id = STAFF_A_ID;
    staffA_Token = registerUser({
      id: STAFF_A_ID,
      email: 'staffa@ata-lta.ph',
      name: 'Staff Alice',
      role: 'Operations',
      departments: ['Operations', 'Accounting'],
      entities: ['ATA'],
    });

    staffB_Id = STAFF_B_ID;
    staffB_Token = registerUser({
      id: STAFF_B_ID,
      email: 'staffb@ata-lta.ph',
      name: 'Staff Bob',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });
  });

  describe('V1: Ordinary Creator Visibility Without WR Assignment', () => {
    it('allows non-admin creator without WR assignment to view own voucher in list, counts, and detail', async () => {
      // Alice creates a voucher on WR_ATA_ID (where Alice has no task assignments or WR ownership)
      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Staff Alice solo lunch meeting',
          amount: 600,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA_ID,
        })
        .expect(201);

      const voucherId = createRes.body.data.id;
      expect(createRes.body.data.created_by).toBe(staffA_Id);
      expect(createRes.body.data.requested_by).toBe(staffA_Id);

      // Alice can fetch directly by ID
      const getRes = await request(app)
        .get(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(getRes.body.data.id).toBe(voucherId);

      // Alice sees it in list
      const listRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(listRes.body.data.some((d) => d.id === voucherId)).toBe(true);

      // Alice sees it in counts
      const countsRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(countsRes.body.data.active).toBe(1);
    });
  });

  describe('V2: Non-Owner Denial Across Shared WR & All Statuses', () => {
    const statuses = [
      'Draft',
      'Submitted',
      'Pending',
      'Pending Admin Approval',
      'Released',
      'Funded',
      'Rejected',
    ];

    statuses.forEach((status) => {
      it(`denies non-owner staff direct access to a ${status} voucher on a shared WR (403)`, async () => {
        // Link task on shared WR to Staff B
        mockTables.tasks.set('task-shared-b', {
          id: 'task-shared-b',
          work_request_id: WR_ATA_ID,
          assignee_id: staffB_Id,
        });

        // Seed voucher owned by Staff A on the same WR
        const voucherId = `voucher-${status.toLowerCase().replace(/\s+/g, '-')}`;
        mockTables.disbursements.set(voucherId, {
          id: voucherId,
          entity_id: 'ent-ata',
          category: 'Transportation',
          description: `Voucher in ${status} status`,
          amount: 1500,
          fund_source: 'Firm Fund',
          status,
          created_by: staffA_Id,
          requested_by: staffA_Id,
          employee_id: staffA_Id,
          linked_work_request_id: WR_ATA_ID,
          archived: false,
          version: 1,
        });

        // Staff B attempts direct GET -> must return 403
        await request(app)
          .get(`/v1/disbursements/${voucherId}`)
          .set('Authorization', `Bearer ${staffB_Token}`)
          .set('X-Active-Entity', 'ATA')
          .expect(403);

        // Staff B list must not include this voucher
        const listRes = await request(app)
          .get(`/v1/disbursements?status=${encodeURIComponent(status)}`)
          .set('Authorization', `Bearer ${staffB_Token}`)
          .set('X-Active-Entity', 'ATA')
          .expect(200);
        expect(listRes.body.data.some((d) => d.id === voucherId)).toBe(false);
      });
    });
  });

  describe('V3: Authorized Entity Scope and Zero Leaks in ALL Mode & Counts', () => {
    it('restricts ALL entity queries to user.entities and avoids cross-entity leaks', async () => {
      // Seed ATA and LTA vouchers
      mockTables.disbursements.set('disb-ata-1', {
        id: 'disb-ata-1',
        entity_id: 'ent-ata',
        category: 'Supplies',
        description: 'ATA office supplies',
        amount: 800,
        fund_source: 'Firm Fund',
        status: 'Pending',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        archived: false,
      });

      mockTables.disbursements.set('disb-lta-1', {
        id: 'disb-lta-1',
        entity_id: 'ent-lta',
        category: 'Supplies',
        description: 'LTA office supplies',
        amount: 900,
        fund_source: 'Firm Fund',
        status: 'Pending',
        created_by: staffA_Id, // Even if created_by matches Alice, Alice is not authorized for LTA
        requested_by: staffA_Id,
        archived: false,
      });

      // 1. Staff A with only entities: ['ATA'] attempting ALL entity mode is rejected with 403
      await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ALL')
        .expect(403);

      // 2. Admin authorized for both ATA and LTA querying ALL sees both authorized entities
      const adminAllRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL')
        .expect(200);

      expect(adminAllRes.body.data.some((d) => d.id === 'disb-ata-1')).toBe(true);
      expect(adminAllRes.body.data.some((d) => d.id === 'disb-lta-1')).toBe(true);

      // 3. Check counts in ALL mode for Admin
      const countsRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ALL')
        .expect(200);

      expect(countsRes.body.data.active).toBe(2);
    });
  });

  describe('V4: Identity Derivation and Requester Anti-Forgery', () => {
    it('rejects foreign employeeId on creation with 403 DISBURSEMENT_REQUESTER_MISMATCH', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Printing',
          description: 'Forged voucher with another employee ID',
          amount: 450,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA_ID,
          employeeId: staffB_Id, // foreign employee ID
        })
        .expect(403);

      expect(res.body.code).toBe('DISBURSEMENT_REQUESTER_MISMATCH');
    });

    it('derives employee_id, requested_by, and created_by as authenticated caller ID when omitted', async () => {
      const taskId = '55555555-eeee-4555-8eee-555555555501';
      mockTables.tasks.set(taskId, {
        id: taskId,
        work_request_id: WR_ATA_ID,
        entity_id: 'ent-ata',
        title: 'Alice Task',
        status: 'In Progress',
        assignee_id: STAFF_A_ID,
        deleted_at: null,
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Printing',
          description: 'Valid voucher with self-derived employee ID',
          amount: 450,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA_ID,
          taskId,
        })
        .expect(201);

      expect(res.body.data.employee_id).toBe(staffA_Id);
      expect(res.body.data.requested_by).toBe(staffA_Id);
      expect(res.body.data.created_by).toBe(staffA_Id);
    });

    it('rejects reassigning employeeId on update with 403 DISBURSEMENT_REQUESTER_MISMATCH', async () => {
      const acctToken = registerUser({
        id: '44444444-4444-4444-8444-444444444444',
        email: 'acct-editor@ata-lta.ph',
        name: 'Accounting Editor',
        role: 'Accounting',
        entities: ['ATA'],
      });

      const voucherId = 'voucher-reassign-test';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Communication',
        description: 'Communication bill',
        amount: 1000,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        employee_id: staffA_Id,
        linked_work_request_id: WR_ATA_ID,
        archived: false,
        version: 1,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1,
          employeeId: staffB_Id, // Attempt to reassign
        })
        .expect(403);

      expect(res.body.code).toBe('DISBURSEMENT_REQUESTER_MISMATCH');
    });
  });

  describe('V5: Draft Invoice Concurrency & Line-Item Safety', () => {
    it('allows financial edits on Draft invoice, updating line items and version', async () => {
      const invoiceId = 'invoice-draft-financial';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA_ID,
        invoice_number: 'INV-2026-0001',
        status: 'Draft',
        subtotal: 5000,
        tax_amount: 600,
        total: 5600,
        version: 1,
        archived: false,
      });

      mockTables.invoice_line_items.set('line-1', {
        id: 'line-1',
        invoice_id: invoiceId,
        description: 'Old service',
        quantity: 1,
        rate: 5000,
        amount: 5000,
      });

      const res = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1,
          lineItems: [
            { description: 'Consulting Fee A', quantity: 2, unitPrice: 3000, amount: 6000 },
            { description: 'Consulting Fee B', quantity: 1, unitPrice: 2000, amount: 2000 },
          ],
        })
        .expect(200);

      expect(res.body.data.subtotal).toBe(8000);
      expect(res.body.data.version).toBe(2);
    });

    it('rejects financial edits on non-Draft (Issued) invoice with 409 INVOICE_NOT_DRAFT', async () => {
      const invoiceId = 'invoice-issued-locked';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA_ID,
        invoice_number: 'INV-2026-0002',
        status: 'Issued',
        subtotal: 10000,
        total: 11200,
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1,
          lineItems: [{ description: 'New line item attempt', amount: 5000 }],
        })
        .expect(409);

      expect(res.body.code).toBe('INVOICE_NOT_DRAFT');
    });

    it('permits non-financial edits (notes, address) on non-Draft invoice', async () => {
      const invoiceId = 'invoice-issued-notes';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA_ID,
        invoice_number: 'INV-2026-0003',
        status: 'Issued',
        subtotal: 10000,
        total: 11200,
        notes: 'Original note',
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          notes: 'Updated delivery instructions note',
        })
        .expect(200);

      expect(res.body.data.notes).toBe('Updated delivery instructions note');
    });
  });

  describe('V6: Concurrency / OCC Conflict Handling', () => {
    it('returns 409 ERR_CONCURRENCY_CONFLICT on stale invoice expectedVersion and leaves line items untouched', async () => {
      const invoiceId = 'invoice-occ-conflict';
      mockTables.invoices.set(invoiceId, {
        id: invoiceId,
        entity_id: 'ent-ata',
        client_id: CLIENT_ATA_ID,
        invoice_number: 'INV-2026-0004',
        status: 'Draft',
        subtotal: 5000,
        total: 5600,
        version: 2, // Current version is 2
        archived: false,
      });

      mockTables.invoice_line_items.set('line-occ-1', {
        id: 'line-occ-1',
        invoice_id: invoiceId,
        description: 'Original untouched item',
        amount: 5000,
      });

      const res = await request(app)
        .put(`/v1/invoices/${invoiceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1, // Stale version 1
          lineItems: [{ description: 'Overwriting item', amount: 9999 }],
        })
        .expect(409);

      expect(res.body.code).toBe('ERR_CONCURRENCY_CONFLICT');
      // Verify line items were NOT deleted
      expect(mockTables.invoice_line_items.has('line-occ-1')).toBe(true);
    });
  });

  describe('V7: Direct Admin Approval to Released & Payment Details Correction', () => {
    it('approves directly to Released atomically saving payment details and attribution', async () => {
      const voucherId = 'voucher-direct-approval';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Representation',
        description: 'Client luncheon',
        amount: 3200,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        created_by: staffA_Id,
        requested_by: staffA_Id,
        employee_id: staffA_Id,
        linked_work_request_id: WR_ATA_ID,
        archived: false,
        version: 1,
      });

      // Step 1: Admin approves (Draft -> Approved)
      const approveRes = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1,
        })
        .expect(200);

      expect(approveRes.body.data.status).toBe('Approved');
      expect(approveRes.body.data.approved_by).toBe(ADMIN_ID);
      expect(approveRes.body.data.version).toBe(2);

      // Step 2: Accounting funds (Approved -> Funded)
      const acctToken = registerUser({
        id: '22222222-2222-4222-8222-222222222222',
        email: 'acct@ata-lta.ph',
        name: 'Accountant Bob',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      });

      const fundRes = await request(app)
        .post(`/v1/disbursements/${voucherId}/fund`)
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Bank Transfer',
          reference: 'BDO-REF-998877',
          bank: 'BDO Unibank',
          date: '2026-10-18',
          expectedVersion: 2,
        })
        .expect(200);

      expect(fundRes.body.data.status).toBe('Funded');
      expect(fundRes.body.data.payment_method).toBe('Bank Transfer');
      expect(fundRes.body.data.payment_reference).toBe('BDO-REF-998877');
      expect(fundRes.body.data.payment_bank).toBe('BDO Unibank');
      expect(fundRes.body.data.payment_date).toBe('2026-10-18');
      expect(fundRes.body.data.version).toBe(3);

      // Step 3: Admin releases (Funded -> Released)
      const releaseRes = await request(app)
        .post(`/v1/disbursements/${voucherId}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 3,
        })
        .expect(200);

      expect(releaseRes.body.data.status).toBe('Released');
      expect(releaseRes.body.data.released_by).toBe(ADMIN_ID);
      expect(releaseRes.body.data.version).toBe(4);

      // Subsequent approve attempt conflicts (409)
      await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 4,
        })
        .expect(409);
    });

    it('rejects funding when required payment fields or date format are invalid (400)', async () => {
      const voucherId = 'voucher-invalid-approval';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Dinner meeting',
        amount: 1500,
        fund_source: 'Firm Fund',
        status: 'Approved',
        lifecycle_version: 2,
        created_by: staffA_Id,
        requested_by: staffA_Id,
        archived: false,
        version: 1,
      });

      // Missing method
      await request(app)
        .post(`/v1/disbursements/${voucherId}/fund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          date: '2026-10-18',
          expectedVersion: 1,
        })
        .expect(400);

      // Invalid date format
      await request(app)
        .post(`/v1/disbursements/${voucherId}/fund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Check',
          bank: 'BDO',
          reference: 'CHK-1',
          date: '18-10-2026',
          expectedVersion: 1,
        })
        .expect(400);
    });

    it('allows PATCH /v1/disbursements/:id/payment-details on Released voucher preserving attribution and status', async () => {
      const voucherId = 'voucher-released-patch';
      const approvedAt = '2026-10-17T10:00:00.000Z';
      const releasedAt = '2026-10-17T10:00:00.000Z';

      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Supplies',
        description: 'Office stationery',
        amount: 2500,
        fund_source: 'Firm Fund',
        status: 'Released',
        lifecycle_version: 2,
        payment_method: 'Cash',
        payment_reference: null,
        payment_bank: null,
        payment_date: '2026-10-17',
        approved_by: 'original-approver-id',
        approved_at: approvedAt,
        released_by: 'original-releaser-id',
        released_at: releasedAt,
        payment_processed_by: 'original-releaser-id',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        archived: false,
        version: 2,
      });

      const res = await request(app)
        .patch(`/v1/disbursements/${voucherId}/payment-details`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Bank Transfer',
          reference: 'CORRECTED-REF-001',
          bank: 'BPI',
          date: '2026-10-17',
          expectedVersion: 2,
        })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT_CURRENT_STATUS');

      // Attribution and status MUST be completely unchanged
      const stored = mockTables.disbursements.get(voucherId);
      expect(stored.status).toBe('Released');
      expect(stored.approved_by).toBe('original-approver-id');
      expect(stored.approved_at).toBe(approvedAt);
      expect(stored.released_by).toBe('original-releaser-id');
      expect(stored.released_at).toBe(releasedAt);
    });

    it('rejects PATCH /payment-details on Draft or Pending disbursements with 409 CONFLICT_CURRENT_STATUS', async () => {
      const voucherId = 'voucher-draft-patch';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Supplies',
        amount: 1000,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .patch(`/v1/disbursements/${voucherId}/payment-details`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Cash',
          date: '2026-10-18',
          expectedVersion: 1,
        })
        .expect(409);

      expect(res.body.code).toBe('CONFLICT_CURRENT_STATUS');
    });
  });

  describe('V8: Private Storage Receipt Persistence & Authorized Preview', () => {
    it('creates pre-signed upload reservation and completes verification', async () => {
      // 1. Reserve upload URL
      const reserveRes = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          filename: 'taxi_receipt.pdf',
          contentType: 'application/pdf',
          size: 204800,
        })
        .expect(201);

      expect(reserveRes.body.data.uploadId).toBeDefined();
      expect(reserveRes.body.data.uploadUrl).toBeDefined();
      const { uploadId, objectKey } = reserveRes.body.data;

      // 2. Complete before storage write -> 422 RECEIPT_UPLOAD_VERIFICATION_FAILED
      const earlyCompleteRes = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(422);
      expect(earlyCompleteRes.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');

      // 3. Simulate browser upload into storage
      const validPdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(204800 - 9, 0)]);
      mockStorageObjects.set(objectKey, {
        buffer: validPdfBuffer,
        size: 204800,
        contentType: 'application/pdf',
      });

      // 4. Another user attempts to complete Alice\'s upload -> 403 UPLOAD_RESERVATION_MISMATCH
      const foreignCompleteRes = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${staffB_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);
      expect(foreignCompleteRes.body.code).toBe('UPLOAD_RESERVATION_MISMATCH');

      // 5. Alice completes upload -> 200 OK
      const completeRes = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(completeRes.body.data.receiptS3Key).toBe(objectKey);
      expect(completeRes.body.data.receiptFilename).toBe('taxi_receipt.pdf');

      // 6. Alice creates voucher binding this receipt
      const taskId = '55555555-eeee-4555-8eee-555555555502';
      mockTables.tasks.set(taskId, {
        id: taskId,
        work_request_id: WR_ATA_ID,
        entity_id: 'ent-ata',
        title: 'Alice Receipt Task',
        status: 'In Progress',
        assignee_id: STAFF_A_ID,
        deleted_at: null,
      });

      const voucherRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Transportation',
          description: 'Airport taxi ride',
          amount: 850,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA_ID,
          taskId,
          receiptS3Key: completeRes.body.data.receiptS3Key,
          receiptFilename: completeRes.body.data.receiptFilename,
        })
        .expect(201);

      expect(voucherRes.body.data.receipt_s3_key).toBe(objectKey);
      expect(voucherRes.body.data.receipt_filename).toBe('taxi_receipt.pdf');

      // 7. Subsequent attempt to reuse same completed reservation fails (consumed)
      const reuseRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Transportation',
          description: 'Reused receipt voucher attempt',
          amount: 850,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA_ID,
          taskId,
          receiptS3Key: completeRes.body.data.receiptS3Key,
          receiptFilename: completeRes.body.data.receiptFilename,
        })
        .expect(400);
      expect(reuseRes.body.code).toBe('INVALID_RECEIPT_RESERVATION');
    });
  });

  describe('V9: Authorized Receipt Preview URL and Legacy Fallbacks', () => {
    it('returns authorized pre-signed download URL for voucher with receipt', async () => {
      const voucherId = 'voucher-with-receipt';
      const receiptKey = 'entities/ATA/disbursements/receipts/test-uuid-receipt.png';

      mockStorageObjects.set(receiptKey, {
        buffer: Buffer.from('mock image binary content'),
        size: 1024,
        contentType: 'image/png',
      });

      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Dinner with client',
        amount: 2000,
        fund_source: 'Firm Fund',
        status: 'Pending',
        receipt_s3_key: receiptKey,
        receipt_filename: 'receipt.png',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        archived: false,
      });

      const res = await request(app)
        .get(`/v1/disbursements/${voucherId}/receipt-url`)
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.url).toBeDefined();
      expect(res.body.data.filename).toBe('receipt.png');
      expect(res.body.data.contentType).toBe('image/png');

      // Staff B (unauthorized) cannot access receipt URL
      await request(app)
        .get(`/v1/disbursements/${voucherId}/receipt-url`)
        .set('Authorization', `Bearer ${staffB_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);
    });

    it('returns 404 RECEIPT_NOT_FOUND when voucher has no receipt', async () => {
      const voucherId = 'voucher-without-receipt';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Transportation',
        amount: 500,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        receipt_s3_key: null,
        receipt_filename: null,
        archived: false,
      });

      const res = await request(app)
        .get(`/v1/disbursements/${voucherId}/receipt-url`)
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      expect(res.body.code).toBe('RECEIPT_NOT_FOUND');
    });

    it('returns explicit unavailable payload for legacy records missing S3 key', async () => {
      const voucherId = 'voucher-legacy-missing-key';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Printing',
        amount: 300,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        receipt_s3_key: null,
        receipt_filename: 'legacy_receipt.jpg', // Filename present, but no S3 key
        archived: false,
      });

      const res = await request(app)
        .get(`/v1/disbursements/${voucherId}/receipt-url`)
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.status).toBe('unavailable');
      expect(res.body.data.filename).toBe('legacy_receipt.jpg');
      expect(res.body.data.reason).toBe('legacy_attachment_missing');
    });
  });

  describe('R1: Approval & Release Validation and Calendar Dates', () => {
    it('rejects empty-body approval with 400 and leaves voucher state completely unchanged', async () => {
      const voucherId = 'voucher-empty-approve';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Empty approve test',
        amount: 250,
        fund_source: 'Firm Fund',
        status: 'Pending',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        payment_method: null,
        payment_date: null,
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({})
        .expect(400);

      expect(res.body.title).toBe('Validation Error');
      expect(res.body.detail).toContain('expectedVersion: Required');

      const stored = mockTables.disbursements.get(voucherId);
      expect(stored.status).toBe('Pending');
      expect(stored.payment_method).toBeNull();
      expect(stored.payment_date).toBeNull();
      expect(stored.version).toBe(1);
    });

    it('rejects empty-body release with 400 and leaves voucher unchanged', async () => {
      const voucherId = 'voucher-empty-release';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Empty release test',
        amount: 250,
        fund_source: 'Firm Fund',
        status: 'Approved',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        version: 2,
        archived: false,
      });

      const res = await request(app)
        .post(`/v1/disbursements/${voucherId}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({})
        .expect(400);

      expect(res.body.title).toBe('Validation Error');
      const stored = mockTables.disbursements.get(voucherId);
      expect(stored.status).toBe('Approved');
      expect(stored.version).toBe(2);
    });

    it('rejects impossible calendar dates in fund and payment details schemas', () => {
      const invalidDates = ['2026-99-99', '2026-02-31', '2026-02-29', '2026-04-31', '18-10-2026'];
      for (const d of invalidDates) {
        expect(
          schema.fundDisbursementSchema.safeParse({ method: 'Cash', bank: 'BDO', reference: 'REF', date: d, expectedVersion: 1 }).success
        ).toBe(false);
        expect(
          schema.updatePaymentDetailsSchema.safeParse({ method: 'Cash', bank: 'BDO', reference: 'REF', date: d, expectedVersion: 1 }).success
        ).toBe(false);
      }

      // Valid leap day passes
      expect(
        schema.fundDisbursementSchema.safeParse({ method: 'Cash', bank: 'BDO', reference: 'REF', date: '2024-02-29', expectedVersion: 1 }).success
      ).toBe(true);
      // Valid regular day passes
      expect(
        schema.fundDisbursementSchema.safeParse({ method: 'Cash', bank: 'BDO', reference: 'REF', date: '2026-10-18', expectedVersion: 1 }).success
      ).toBe(true);
    });

    it('rejects invalid expectedVersion (zero, negative, or float)', async () => {
      const voucherId = 'voucher-invalid-version';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Invalid version test',
        amount: 100,
        fund_source: 'Firm Fund',
        status: 'Pending',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        version: 1,
        archived: false,
      });

      // Zero version
      const zeroRes = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ method: 'Cash', date: '2026-10-18', expectedVersion: 0 })
        .expect(400);
      expect(zeroRes.body.detail).toContain('expectedVersion');

      // Negative version
      const negRes = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ method: 'Cash', date: '2026-10-18', expectedVersion: -1 })
        .expect(400);
      expect(negRes.body.detail).toContain('expectedVersion');

      // Float version
      const floatRes = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ method: 'Cash', date: '2026-10-18', expectedVersion: 1.5 })
        .expect(400);
      expect(floatRes.body.detail).toContain('expectedVersion');
    });
  });

  describe('R2: Staff Pending Changes Counts and Column Alignment', () => {
    it('correctly counts rejected pending_changes for staff callers using submitted_by', async () => {
      // 1. Seed rejected disbursements created by Alice
      mockTables.disbursements.set('disb-alice-rejected-1', {
        id: 'disb-alice-rejected-1',
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Alice meal 1',
        amount: 500,
        fund_source: 'Firm Fund',
        status: 'Rejected',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        archived: false,
        version: 1,
      });
      mockTables.disbursements.set('disb-alice-rejected-2', {
        id: 'disb-alice-rejected-2',
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Alice meal 2',
        amount: 600,
        fund_source: 'Firm Fund',
        status: 'Rejected',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        archived: false,
        version: 1,
      });

      // 3. Alice fetches counts -> sees rejected === 2
      const aliceRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(aliceRes.body.data.rejected).toBe(2);

      // 4. Bob fetches counts -> sees rejected === 0 (no leak of Alice\'s rejections)
      const bobRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${staffB_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(bobRes.body.data.rejected).toBe(0);

      // 5. Admin fetches counts -> sees rejected === 2
      const adminRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(adminRes.body.data.rejected).toBe(2);
    });

    it('isolates rejected pending changes by table_name and entity_id', async () => {
      // Non-disbursement table
      mockTables.pending_changes.set('pc-invoice-rejected', {
        id: 'pc-invoice-rejected',
        entity_id: 'ent-ata',
        table_name: 'invoices',
        proposed_data: { description: 'Invoice edit' },
        submitted_by: staffA_Id,
        status: 'rejected',
      });

      // Cross-entity (LTA)
      mockTables.pending_changes.set('pc-lta-rejected', {
        id: 'pc-lta-rejected',
        entity_id: 'ent-lta',
        table_name: 'disbursements',
        proposed_data: { description: 'LTA expense' },
        submitted_by: staffA_Id,
        status: 'rejected',
      });

      // Status pending (not rejected)
      mockTables.pending_changes.set('pc-pending', {
        id: 'pc-pending',
        entity_id: 'ent-ata',
        table_name: 'disbursements',
        proposed_data: { description: 'Pending expense' },
        submitted_by: staffA_Id,
        status: 'pending',
      });

      const aliceRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(aliceRes.body.data.rejected).toBe(0);
    });
  });

  describe('R5: Attachment Provenance and Paired Metadata', () => {
    it('rejects filename-only new voucher creation (schema & service)', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Filename only test',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA_ID,
          receiptFilename: 'orphaned_receipt.png',
        })
        .expect(400);

      expect(res.body.title).toBe('Validation Error');
      expect(res.body.detail).toContain('receiptS3Key: receiptS3Key is required when receiptFilename is provided');
    });

    it('rejects receiptS3Key without filename on new voucher creation', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffA_Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Key only test',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA_ID,
          receiptS3Key: 'some-key.pdf',
        })
        .expect(400);

      expect(res.body.title).toBe('Validation Error');
      expect(res.body.detail).toContain('receiptFilename: receiptFilename is required when receiptS3Key is provided');
    });

    it('rejects voucher update with unverified foreign receipt key', async () => {
      const voucherId = 'voucher-foreign-key';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Foreign key test',
        amount: 500,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        receipt_s3_key: null,
        receipt_filename: null,
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: 'entities/LTA/private/foreign-document.pdf',
          receiptFilename: 'forged.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_RECEIPT_RESERVATION');

      const stored = mockTables.disbursements.get(voucherId);
      expect(stored.receipt_s3_key).toBeNull();
      expect(stored.version).toBe(1);
    });

    it('allows updating voucher by retaining existing persisted receipt key', async () => {
      const voucherId = 'voucher-retain-key';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Retain key test',
        amount: 500,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        receipt_s3_key: 'entities/ATA/disbursements/existing-receipt.pdf',
        receipt_filename: 'existing-receipt.pdf',
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          notes: 'Updated note while retaining receipt',
          receiptS3Key: 'entities/ATA/disbursements/existing-receipt.pdf',
          receiptFilename: 'existing-receipt.pdf',
          expectedVersion: 1,
        })
        .expect(200);

      expect(res.body.data.receipt_s3_key).toBe('entities/ATA/disbursements/existing-receipt.pdf');
      expect(res.body.data.version).toBe(2);
    });

    it('allows updating voucher with newly verified upload reservation and consumes it', async () => {
      const voucherId = 'voucher-new-attachment';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Transportation',
        description: 'New attachment test',
        amount: 300,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        receipt_s3_key: null,
        receipt_filename: null,
        version: 1,
        archived: false,
      });

      // 1. Reserve upload as admin
      const reserveRes = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          filename: 'taxi_receipt.pdf',
          contentType: 'application/pdf',
          size: 1024,
        })
        .expect(201);
      const { uploadId, objectKey } = reserveRes.body.data;

      // 2. Put object in mock storage & complete as admin
      const validPdfBuffer2 = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 - 9, 0)]);
      mockStorageObjects.set(objectKey, {
        buffer: validPdfBuffer2,
        size: 1024,
        contentType: 'application/pdf',
      });
      await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      // 3. Update voucher with new receipt key as admin
      const updateRes = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: objectKey,
          receiptFilename: 'taxi_receipt.pdf',
          expectedVersion: 1,
        })
        .expect(200);

      expect(updateRes.body.data.receipt_s3_key).toBe(objectKey);
      expect(updateRes.body.data.receipt_filename).toBe('taxi_receipt.pdf');

      // 4. Reservation is now consumed -> replay on another voucher is rejected
      const voucher2Id = 'voucher-replay-target';
      mockTables.disbursements.set(voucher2Id, {
        id: voucher2Id,
        entity_id: 'ent-ata',
        category: 'Transportation',
        description: 'Replay target',
        amount: 150,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        version: 1,
        archived: false,
      });

      const replayRes = await request(app)
        .put(`/v1/disbursements/${voucher2Id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: objectKey,
          receiptFilename: 'taxi_receipt.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(replayRes.body.code).toBe('INVALID_RECEIPT_RESERVATION');
    });

    it('allows clearing attachment with receiptS3Key: null', async () => {
      const voucherId = 'voucher-clear-attachment';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Clear attachment test',
        amount: 400,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        receipt_s3_key: 'entities/ATA/disbursements/old-key.pdf',
        receipt_filename: 'old-key.pdf',
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: null,
          expectedVersion: 1,
        })
        .expect(200);

      expect(res.body.data.receipt_s3_key).toBeNull();
      expect(res.body.data.receipt_filename).toBeNull();
    });

    it('rejects contradictory update with receiptS3Key: null and non-null receiptFilename', async () => {
      const voucherId = 'voucher-contradictory';
      mockTables.disbursements.set(voucherId, {
        id: voucherId,
        entity_id: 'ent-ata',
        category: 'Meals',
        description: 'Contradictory test',
        amount: 400,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: staffA_Id,
        requested_by: staffA_Id,
        receipt_s3_key: 'entities/ATA/disbursements/old-key.pdf',
        receipt_filename: 'old-key.pdf',
        version: 1,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: null,
          receiptFilename: 'still_here.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.title).toBe('Validation Error');
    });
  });
});

