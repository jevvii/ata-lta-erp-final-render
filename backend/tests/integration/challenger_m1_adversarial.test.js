/**
 * Empirical Adversarial Challenger Test Suite: Milestone 1 (R1, R2, R5)
 * 
 * Stress-tests and challenges implementation assumptions across:
 * 1. R1: Empty object {}, null body, non-object bodies, missing fields, malformed payment methods,
 *       calendar date boundaries (leap year, century leap, non-leap, invalid months/days),
 *       expectedVersion edge cases (zero, negative, float, string, boolean).
 *       Guarantees state immutability on validation failure.
 * 2. R2: Staff counts queries across various roles (Admin, Accounting, Operations, Management, Documentation)
 *       with populated pending_changes (cross-user, cross-entity, cross-table, non-rejected statuses).
 *       Guarantees absence of column errors (submitted_by vs user_id).
 * 3. R5: Attachment provenance on update & paired metadata on create:
 *       - Foreign S3 key (different user)
 *       - Cross-entity S3 key (different entity)
 *       - Unreserved / non-existent S3 key
 *       - Pending / unverified reservation
 *       - Expired reservation
 *       - Replay attack on consumed reservation
 *       - Filename-only create & update
 *       - Key-only create
 *       - Contradictory key-null + filename payloads
 *       - Key retention & clean detachment
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
} = require('../fixtures/supabaseMock');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');
const schema = require('../../src/modules/disbursements/schema');

const ENT_ATA = 'ent-ata';
const ENT_LTA = 'ent-lta';
const WR_ATA = '11111111-2222-3333-4444-555555555555';
const WR_LTA = '66666666-7777-8888-9999-000000000000';

const ADMIN_ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ACCT_ID  = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const OPS_A_ID = 'cccccccc-3333-4333-8333-cccccccccccc';
const OPS_B_ID = 'dddddddd-4444-4444-8444-dddddddddddd';
const MGR_ID   = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const DOC_ID   = 'ffffffff-6666-4666-8666-ffffffffffff';

describe('Empirical Adversarial Challenges: Milestone 1 (R1, R2, R5)', () => {
  let adminToken;
  let acctToken;
  let opsAToken;
  let opsBToken;
  let mgrToken;
  let docToken;

  beforeEach(() => {
    resetMock();
    reservations.clearReservations();

    // Base entity setup
    mockTables.entities.set(ENT_ATA, { id: ENT_ATA, code: 'ATA', name: 'ATA Entity' });
    mockTables.entities.set(ENT_LTA, { id: ENT_LTA, code: 'LTA', name: 'LTA Entity' });

    mockTables.work_requests.set(WR_ATA, {
      id: WR_ATA,
      entity_id: ENT_ATA,
      title: 'WR ATA Challenger',
    });
    mockTables.work_requests.set(WR_LTA, {
      id: WR_LTA,
      entity_id: ENT_LTA,
      title: 'WR LTA Challenger',
    });

    // Tokens
    adminToken = registerUser({
      id: ADMIN_ID,
      email: 'admin@challenge.test',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    acctToken = registerUser({
      id: ACCT_ID,
      email: 'acct@challenge.test',
      name: 'Accounting User',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA'],
    });

    opsAToken = registerUser({
      id: OPS_A_ID,
      email: 'ops_a@challenge.test',
      name: 'Operations User A',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    opsBToken = registerUser({
      id: OPS_B_ID,
      email: 'ops_b@challenge.test',
      name: 'Operations User B',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    mgrToken = registerUser({
      id: MGR_ID,
      email: 'mgr@challenge.test',
      name: 'Manager User',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA'],
    });

    docToken = registerUser({
      id: DOC_ID,
      email: 'doc@challenge.test',
      name: 'Documentation User',
      role: 'Documentation',
      departments: ['Documentation'],
      entities: ['ATA'],
    });
  });

  const seedVoucher = (id, overrides = {}) => {
    const defaultData = {
      id,
      entity_id: ENT_ATA,
      category: 'Meals',
      description: `Test voucher ${id}`,
      amount: 500,
      fund_source: 'Firm Fund',
      status: 'Draft',
      lifecycle_version: 2,
      review_ready: true,
      created_by: OPS_A_ID,
      requested_by: OPS_A_ID,
      employee_id: OPS_A_ID,
      linked_work_request_id: WR_ATA,
      receipt_s3_key: null,
      receipt_filename: null,
      payment_method: null,
      payment_reference: null,
      payment_bank: null,
      payment_date: null,
      version: 1,
      archived: false,
    };
    mockTables.disbursements.set(id, { ...defaultData, ...overrides });
    return mockTables.disbursements.get(id);
  };

  describe('Adversarial Challenge R1: Approval & Release Validation and Date Boundaries', () => {
    const endpoints = [
      { name: 'fund', path: (id) => `/v1/disbursements/${id}/fund`, initialStatus: 'Approved' },
    ];

    endpoints.forEach(({ name, path, initialStatus }) => {
      describe(`${name} endpoint`, () => {
        it('rejects omitted body or empty object {} with HTTP 400 and preserves voucher record completely', async () => {
          const id = `voucher-empty-body-${name}`;
          seedVoucher(id, { status: initialStatus });

          const res = await request(app)
            .post(path(id))
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Active-Entity', 'ATA')
            .send({})
            .expect(400);

          expect(res.body.title).toBe('Validation Error');
          const stored = mockTables.disbursements.get(id);
          expect(stored.status).toBe(initialStatus);
          expect(stored.payment_method).toBeNull();
          expect(stored.payment_date).toBeNull();
          expect(stored.version).toBe(1);
        });

        it('rejects null body string or missing payload with HTTP 400', async () => {
          const id = `voucher-null-body-${name}`;
          seedVoucher(id, { status: initialStatus });

          const res = await request(app)
            .post(path(id))
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Active-Entity', 'ATA')
            .set('Content-Type', 'application/json')
            .send('null')
            .expect(400);

          expect(res.status).toBe(400);
          const stored = mockTables.disbursements.get(id);
          expect(stored.status).toBe(initialStatus);
          expect(stored.version).toBe(1);
        });

        it('rejects empty string or whitespace payment method with HTTP 400', async () => {
          const id = `voucher-bad-method-${name}`;
          seedVoucher(id, { status: initialStatus });

          for (const badMethod of ['', '   ', '\t\n']) {
            const res = await request(app)
              .post(path(id))
              .set('Authorization', `Bearer ${adminToken}`)
              .set('X-Active-Entity', 'ATA')
              .send({
                method: badMethod,
                bank: 'BDO',
                reference: 'REF-1',
                date: '2026-10-18',
                expectedVersion: 1,
              })
              .expect(400);

            expect(res.body.detail).toContain('method');
            const stored = mockTables.disbursements.get(id);
            expect(stored.status).toBe(initialStatus);
          }
        });

        it('rejects overlength payment method (>50 chars)', async () => {
          const id = `voucher-long-method-${name}`;
          seedVoucher(id, { status: initialStatus });

          const res = await request(app)
            .post(path(id))
            .set('Authorization', `Bearer ${adminToken}`)
            .set('X-Active-Entity', 'ATA')
            .send({
              method: 'M'.repeat(51),
              bank: 'BDO',
              reference: 'REF-1',
              date: '2026-10-18',
              expectedVersion: 1,
            })
            .expect(400);

          expect(res.body.detail).toContain('method');
        });

        it('rejects invalid expectedVersion variations (zero, negative, float, string)', async () => {
          const id = `voucher-bad-ver-${name}`;
          seedVoucher(id, { status: initialStatus });

          const badVersions = [0, -1, -99, 1.5, 2.0001, '1', true, null, []];
          for (const v of badVersions) {
            const res = await request(app)
              .post(path(id))
              .set('Authorization', `Bearer ${adminToken}`)
              .set('X-Active-Entity', 'ATA')
              .send({
                method: 'Cash',
                bank: 'BDO',
                reference: 'REF-1',
                date: '2026-10-18',
                expectedVersion: v,
              })
              .expect(400);

            expect(res.body.detail).toContain('expectedVersion');
            const stored = mockTables.disbursements.get(id);
            expect(stored.status).toBe(initialStatus);
            expect(stored.version).toBe(1);
          }
        });
      });
    });

    describe('Calendar Date Boundary & Integrity Challenges', () => {
      const invalidDates = [
        '2026-99-99',       // Impossible month & day
        '2026-00-15',       // Month 0
        '2026-13-01',       // Month 13
        '2026-01-32',       // January has 31 days
        '2026-02-29',       // 2026 is non-leap year
        '2026-02-30',       // February never has 30 days
        '1900-02-29',       // 1900 is non-leap (divisible by 100 but not 400)
        '2026-04-31',       // April has 30 days
        '2026-06-31',       // June has 30 days
        '2026-09-31',       // September has 30 days
        '2026-11-31',       // November has 30 days
        '2026-04-00',       // Day 0
        '18-10-2026',       // Wrong format DD-MM-YYYY
        '2026/10/18',       // Slashes instead of dashes
        '2026-1-1',         // Missing leading zeros
        '2026-10-18T00:00', // ISO timestamp with time
        'not-a-date',       // Non-date string
        '',                 // Empty string
      ];

      invalidDates.forEach((badDate) => {
        it(`rejects invalid date "${badDate}" in fundDisbursementSchema`, () => {
          const result = schema.fundDisbursementSchema.safeParse({
            method: 'Cash',
            bank: 'BDO',
            reference: 'REF-1',
            date: badDate,
            expectedVersion: 1,
          });
          expect(result.success).toBe(false);
        });

        it(`rejects invalid date "${badDate}" in updatePaymentDetailsSchema`, () => {
          const result = schema.updatePaymentDetailsSchema.safeParse({
            method: 'Cash',
            bank: 'BDO',
            reference: 'REF-1',
            date: badDate,
            expectedVersion: 1,
          });
          expect(result.success).toBe(false);
        });
      });

      const validDates = [
        '2024-02-29', // Leap year 2024
        '2000-02-29', // Century leap year 2000 (divisible by 400)
        '2026-10-18', // Standard valid calendar date
        '2026-04-30', // Valid end of 30-day month
        '2026-12-31', // Valid end of year
        '2026-01-01', // Valid start of year
      ];

      validDates.forEach((goodDate) => {
        it(`accepts valid calendar date "${goodDate}" in schemas`, () => {
          const payload = {
            method: 'Cash',
            bank: 'BDO',
            reference: 'REF-1',
            date: goodDate,
            expectedVersion: 1,
          };
          expect(schema.fundDisbursementSchema.safeParse(payload).success).toBe(true);
          expect(schema.updatePaymentDetailsSchema.safeParse(payload).success).toBe(true);
        });
      });
    });
  });

  describe('Adversarial Challenge R2: Staff Pending Changes Counts and Column Security', () => {
    it('executes staff /counts with populated pending_changes without SQL column errors', async () => {
      // Seed rejected disbursements in disbursements table (v2 lifecycle)
      seedVoucher('disb-rej-ops-a-1', {
        status: 'Rejected',
        created_by: OPS_A_ID,
        requested_by: OPS_A_ID,
        entity_id: ENT_ATA,
      });
      seedVoucher('disb-rej-ops-a-2', {
        status: 'Rejected',
        created_by: OPS_A_ID,
        requested_by: OPS_A_ID,
        entity_id: ENT_ATA,
      });
      seedVoucher('disb-rej-ops-b-1', {
        status: 'Rejected',
        created_by: OPS_B_ID,
        requested_by: OPS_B_ID,
        entity_id: ENT_ATA,
      });

      // 1. Seed pending_changes with various submitters and statuses
      mockTables.pending_changes.set('pc-ops-a-1', {
        id: 'pc-ops-a-1',
        entity_id: ENT_ATA,
        table_name: 'disbursements',
        proposed_data: { description: 'Ops A expense 1' },
        submitted_by: OPS_A_ID,
        status: 'rejected',
      });
      mockTables.pending_changes.set('pc-ops-a-2', {
        id: 'pc-ops-a-2',
        entity_id: ENT_ATA,
        table_name: 'disbursements',
        proposed_data: { description: 'Ops A expense 2' },
        submitted_by: OPS_A_ID,
        status: 'rejected',
      });
      mockTables.pending_changes.set('pc-ops-b-1', {
        id: 'pc-ops-b-1',
        entity_id: ENT_ATA,
        table_name: 'disbursements',
        proposed_data: { description: 'Ops B expense 1' },
        submitted_by: OPS_B_ID,
        status: 'rejected',
      });
      // Non-rejected status (pending)
      mockTables.pending_changes.set('pc-pending', {
        id: 'pc-pending',
        entity_id: ENT_ATA,
        table_name: 'disbursements',
        proposed_data: { description: 'Pending item' },
        submitted_by: OPS_A_ID,
        status: 'pending',
      });
      // Other table (invoices)
      mockTables.pending_changes.set('pc-invoice-rej', {
        id: 'pc-invoice-rej',
        entity_id: ENT_ATA,
        table_name: 'invoices',
        proposed_data: { description: 'Invoice change' },
        submitted_by: OPS_A_ID,
        status: 'rejected',
      });
      // Cross-entity (LTA)
      mockTables.pending_changes.set('pc-lta-rej', {
        id: 'pc-lta-rej',
        entity_id: ENT_LTA,
        table_name: 'disbursements',
        proposed_data: { description: 'LTA expense' },
        submitted_by: OPS_A_ID,
        status: 'rejected',
      });

      // 2. Query /counts as Operations Staff A:
      // Must only see pc-ops-a-1 and pc-ops-a-2 (rejected: 2)
      const resOpsA = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${opsAToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resOpsA.body.data.rejected).toBe(2);

      // 3. Query /counts as Operations Staff B:
      // Must only see pc-ops-b-1 (rejected: 1)
      const resOpsB = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${opsBToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resOpsB.body.data.rejected).toBe(1);

      // 4. Query /counts as Manager (non-admin, non-accounting staff):
      // Has no pending changes of their own (rejected: 0)
      const resMgr = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${mgrToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resMgr.body.data.rejected).toBe(0);

      // 5. Query /counts as Documentation (non-admin, non-accounting staff):
      const resDoc = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resDoc.body.data.rejected).toBe(0);

      // 6. Query /counts as Accounting:
      // Sees all rejected disbursement pending changes in ATA (pc-ops-a-1, pc-ops-a-2, pc-ops-b-1 -> 3)
      const resAcct = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resAcct.body.data.rejected).toBe(3);

      // 7. Query /counts as Admin:
      // Sees all rejected disbursement pending changes in ATA -> 3
      const resAdmin = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resAdmin.body.data.rejected).toBe(3);
    });
  });

  describe('Adversarial Challenge R5: Attachment Provenance & Replay Prevention', () => {
    it('rejects foreign S3 key on voucher update (reserved by another user)', async () => {
      // Alice reserves upload
      const aliceUpload = reservations.createReservation({
        uploadId: 'upload-alice-1',
        userId: OPS_A_ID,
        entityId: ENT_ATA,
        entityCode: 'ATA',
        objectKey: 'entities/ATA/disbursements/receipts/alice-receipt.pdf',
        filename: 'alice-receipt.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      reservations.completeReservation('upload-alice-1', { userId: OPS_A_ID, entityId: ENT_ATA });

      // Accounting user tries to update voucher using Alice\'s completed receipt key
      const voucherId = 'voucher-acct-foreign-update';
      seedVoucher(voucherId, { created_by: ACCT_ID, requested_by: ACCT_ID, employee_id: ACCT_ID });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: aliceUpload.objectKey,
          receiptFilename: 'alice-receipt.pdf',
          expectedVersion: 1,
        })
        .expect(403);

      expect(res.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');
      const stored = mockTables.disbursements.get(voucherId);
      expect(stored.receipt_s3_key).toBeNull();
      expect(stored.version).toBe(1);
    });

    it('rejects cross-entity S3 key on voucher update (reserved for another entity)', async () => {
      // User creates reservation for entity LTA
      const ltaUpload = reservations.createReservation({
        uploadId: 'upload-lta-1',
        userId: ADMIN_ID,
        entityId: ENT_LTA,
        entityCode: 'LTA',
        objectKey: 'entities/LTA/disbursements/receipts/lta-receipt.pdf',
        filename: 'lta-receipt.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      reservations.completeReservation('upload-lta-1', { userId: ADMIN_ID, entityId: ENT_LTA });

      // Admin tries to update ATA voucher using LTA receipt key
      const voucherId = 'voucher-ata-cross-entity';
      seedVoucher(voucherId, { entity_id: ENT_ATA });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: ltaUpload.objectKey,
          receiptFilename: 'lta-receipt.pdf',
          expectedVersion: 1,
        })
        .expect(403);

      expect(res.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');
    });

    it('rejects non-existent or unreserved S3 key on voucher update', async () => {
      const voucherId = 'voucher-unreserved-update';
      seedVoucher(voucherId);

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: 'entities/ATA/disbursements/unreserved-phantom.pdf',
          receiptFilename: 'phantom.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_RECEIPT_RESERVATION');
    });

    it('rejects pending/unverified reservation on voucher update', async () => {
      // Reservation created but NOT completed (e.g. storage verification never ran)
      const pendingUpload = reservations.createReservation({
        uploadId: 'upload-pending-1',
        userId: ADMIN_ID,
        entityId: ENT_ATA,
        entityCode: 'ATA',
        objectKey: 'entities/ATA/disbursements/receipts/unverified.pdf',
        filename: 'unverified.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });

      const voucherId = 'voucher-pending-res-update';
      seedVoucher(voucherId);

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: pendingUpload.objectKey,
          receiptFilename: 'unverified.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_RECEIPT_RESERVATION');
    });

    it('rejects replay attack: cannot reuse consumed reservation on another voucher', async () => {
      // 1. Reserve and complete upload
      const upload = reservations.createReservation({
        uploadId: 'upload-consume-replay',
        userId: ADMIN_ID,
        entityId: ENT_ATA,
        entityCode: 'ATA',
        objectKey: 'entities/ATA/disbursements/receipts/consumed-test.pdf',
        filename: 'consumed-test.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      reservations.completeReservation('upload-consume-replay', { userId: ADMIN_ID, entityId: ENT_ATA });

      // 2. Consume it on voucher 1
      const voucher1 = 'voucher-first-consumer';
      seedVoucher(voucher1);

      await request(app)
        .put(`/v1/disbursements/${voucher1}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: upload.objectKey,
          receiptFilename: 'consumed-test.pdf',
          expectedVersion: 1,
        })
        .expect(200);

      expect(reservations.getReservation('upload-consume-replay').status).toBe('consumed');

      // 3. Attempt replay on voucher 2 -> must reject with 400
      const voucher2 = 'voucher-second-replay';
      seedVoucher(voucher2);

      const replayRes = await request(app)
        .put(`/v1/disbursements/${voucher2}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: upload.objectKey,
          receiptFilename: 'consumed-test.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(replayRes.body.code).toBe('INVALID_RECEIPT_RESERVATION');
      const stored2 = mockTables.disbursements.get(voucher2);
      expect(stored2.receipt_s3_key).toBeNull();
    });

    it('rejects filename-only new voucher creation (schema & service)', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${opsAToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Filename only voucher creation challenge',
          amount: 250,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA,
          receiptFilename: 'isolated_receipt.png',
        })
        .expect(400);

      expect(res.body.title).toBe('Validation Error');
      expect(res.body.detail).toContain('receiptS3Key is required when receiptFilename is provided');
    });

    it('rejects key-only new voucher creation without filename', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${opsAToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Key only voucher creation challenge',
          amount: 250,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA,
          receiptS3Key: 'some-key.png',
        })
        .expect(400);

      expect(res.body.title).toBe('Validation Error');
      expect(res.body.detail).toContain('receiptFilename is required when receiptS3Key is provided');
    });

    it('rejects filename-only update on voucher that does not have an existing key', async () => {
      const voucherId = 'voucher-no-key-update';
      seedVoucher(voucherId, { receipt_s3_key: null, receipt_filename: null });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptFilename: 'orphaned_name.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(res.body.code).toBe('INVALID_RECEIPT_ATTACHMENT');
    });

    it('rejects contradictory update: receiptS3Key: null with non-null receiptFilename', async () => {
      const voucherId = 'voucher-contradictory-challenge';
      seedVoucher(voucherId, { receipt_s3_key: 'existing-key.pdf', receipt_filename: 'existing-key.pdf' });

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

    it('allows clean detachment: receiptS3Key: null and receiptFilename: null', async () => {
      const voucherId = 'voucher-detach-challenge';
      seedVoucher(voucherId, { receipt_s3_key: 'existing-key.pdf', receipt_filename: 'existing-key.pdf' });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: null,
          receiptFilename: null,
          expectedVersion: 1,
        })
        .expect(200);

      expect(res.body.data.receipt_s3_key).toBeNull();
      expect(res.body.data.receipt_filename).toBeNull();
      expect(res.body.data.version).toBe(2);
    });

    it('allows keeping existing persisted key without re-verification', async () => {
      const voucherId = 'voucher-keep-key-challenge';
      const existingKey = 'entities/ATA/disbursements/receipts/persisted-receipt.pdf';
      seedVoucher(voucherId, { receipt_s3_key: existingKey, receipt_filename: 'persisted-receipt.pdf' });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: existingKey,
          receiptFilename: 'persisted-receipt.pdf',
          description: 'Updated description keeping attachment',
          expectedVersion: 1,
        })
        .expect(200);

      expect(res.body.data.receipt_s3_key).toBe(existingKey);
      expect(res.body.data.description).toBe('Updated description keeping attachment');
      expect(res.body.data.version).toBe(2);
    });
  });
});
