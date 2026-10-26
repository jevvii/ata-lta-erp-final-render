/**
 * Challenger M1-2 Independent Adversarial Verification Suite
 * Milestone 1 (R1, R2, R5)
 *
 * Requirements Tested:
 * - R1: Unconditional Payment & ExpectedVersion Validation on Approval & Release
 *   - Rejection of empty body {} with HTTP 400
 *   - Immutability of voucher state, payment fields, and version on rejected approval/release
 *   - Missing required fields: method, date, expectedVersion
 *   - Boundary validation on expectedVersion (positive integer only)
 *   - Calendar date boundary validation (impossible dates rejected, leap years accepted)
 * - R2: Staff Pending Changes Counts and Column Alignment
 *   - Query uses submitted_by matching migration 000015
 *   - Querying user_id fails with SQL 42703
 *   - Multi-tenant and submitter isolation for staff
 * - R5: Attachment Provenance, Replay Safety, and Paired Metadata
 *   - Re-submitting the same receipt key across multiple vouchers (replay prevention)
 *   - Retaining already persisted key on existing voucher
 *   - Cross-user reservation binding rejected with HTTP 403
 *   - Cross-entity reservation binding rejected with HTTP 403
 *   - Filename-only creates & updates rejected with HTTP 400
 *   - Key-only creates rejected with HTTP 400
 *   - Clean detachment (key null + filename null)
 * - Concurrency & Race Condition on Voucher Update Receipt Binding
 *   - Testing concurrent requests binding the same receipt reservation
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

const ENT_ATA = 'ent-ata';
const ENT_LTA = 'ent-lta';

const CLIENT_ATA = '11111111-aaaa-1111-aaaa-111111111111';
const WR_ATA = '33333333-cccc-3333-cccc-333333333333';
const WR_LTA = '44444444-dddd-4444-dddd-444444444444';

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const STAFF_ALICE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_BOB_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Challenger M1-2: Independent Adversarial Verification (R1, R2, R5)', () => {
  let adminToken;
  let aliceToken;
  let bobToken;

  beforeEach(() => {
    resetMock();
    reservations.clearReservations();

    // Seed entities
    mockTables.entities.set(ENT_ATA, { id: ENT_ATA, code: 'ATA', name: 'ATA Entity' });
    mockTables.entities.set(ENT_LTA, { id: ENT_LTA, code: 'LTA', name: 'LTA Entity' });

    mockTables.clients.set(CLIENT_ATA, {
      id: CLIENT_ATA,
      entity_id: ENT_ATA,
      name: 'ATA Client',
      status: 'Active',
    });

    mockTables.work_requests.set(WR_ATA, {
      id: WR_ATA,
      entity_id: ENT_ATA,
      client_id: CLIENT_ATA,
      title: 'WR ATA Challenger',
      status: 'In Progress',
    });

    mockTables.work_requests.set(WR_LTA, {
      id: WR_LTA,
      entity_id: ENT_LTA,
      title: 'WR LTA Challenger',
      status: 'In Progress',
    });

    adminToken = registerUser({
      id: ADMIN_ID,
      email: 'admin@challenge.test',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    // Alice is an Operations staff member who also has Accounting department for edit permissions
    aliceToken = registerUser({
      id: STAFF_ALICE_ID,
      email: 'alice@challenge.test',
      name: 'Staff Alice',
      role: 'Operations',
      departments: ['Operations', 'Accounting'],
      entities: ['ATA'],
    });
    mockTables.users.get(STAFF_ALICE_ID).user_departments = [
      { departments: { name: 'Operations' } },
      { departments: { name: 'Accounting' } },
    ];

    // Bob is another Operations staff member with Accounting department
    bobToken = registerUser({
      id: STAFF_BOB_ID,
      email: 'bob@challenge.test',
      name: 'Staff Bob',
      role: 'Operations',
      departments: ['Operations', 'Accounting'],
      entities: ['ATA'],
    });
    mockTables.users.get(STAFF_BOB_ID).user_departments = [
      { departments: { name: 'Operations' } },
      { departments: { name: 'Accounting' } },
    ];
  });

  const seedVoucher = (id, overrides = {}) => {
    const voucher = {
      id,
      entity_id: ENT_ATA,
      category: 'Meals',
      description: `Test voucher ${id}`,
      amount: 1000,
      fund_source: 'Firm Fund',
      status: 'Draft',
      lifecycle_version: 2,
      review_ready: true,
      version: 1,
      created_by: STAFF_ALICE_ID,
      requested_by: STAFF_ALICE_ID,
      employee_id: STAFF_ALICE_ID,
      linked_work_request_id: WR_ATA,
      archived: false,
      deleted_at: null,
      payment_method: null,
      payment_reference: null,
      payment_bank: null,
      payment_date: null,
      payment_processed_by: null,
      receipt_s3_key: null,
      receipt_filename: null,
      ...overrides,
    };
    mockTables.disbursements.set(id, voucher);
    return voucher;
  };

  // --------------------------------------------------------------------------
  // R1: UNCONDITIONAL PAYMENT & EXPECTEDVERSION VALIDATION ON APPROVAL & RELEASE
  // --------------------------------------------------------------------------
  describe('R1: Approval & Release Validation and Date Boundaries', () => {
    test('R1.1: POST /approve with empty body {} returns HTTP 400 and preserves voucher record completely', async () => {
      const voucherId = 'voucher-r1-approve-empty';
      seedVoucher(voucherId, { status: 'Pending' });

      const res = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Validation Error');

      const voucher = mockTables.disbursements.get(voucherId);
      expect(voucher.status).toBe('Pending');
      expect(voucher.version).toBe(1);
      expect(voucher.payment_method).toBeNull();
      expect(voucher.payment_reference).toBeNull();
      expect(voucher.payment_bank).toBeNull();
      expect(voucher.payment_date).toBeNull();
      expect(voucher.payment_processed_by).toBeNull();
    });

    test('R1.2: POST /release with empty body {} returns HTTP 400 and preserves voucher record completely', async () => {
      const voucherId = 'voucher-r1-release-empty';
      seedVoucher(voucherId, { status: 'Pending Admin Approval' });

      const res = await request(app)
        .post(`/v1/disbursements/${voucherId}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Validation Error');

      const voucher = mockTables.disbursements.get(voucherId);
      expect(voucher.status).toBe('Pending Admin Approval');
      expect(voucher.version).toBe(1);
      expect(voucher.payment_method).toBeNull();
      expect(voucher.payment_date).toBeNull();
    });

    test('R1.3: Approval & release reject missing payment method, date, or expectedVersion', async () => {
      const voucherId = 'voucher-r1-missing-fields';
      seedVoucher(voucherId, { status: 'Pending' });

      // Missing method
      const res1 = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ date: '2026-10-18', expectedVersion: 1 });
      expect(res1.status).toBe(400);

      // Missing date
      const res2 = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ method: 'Cash', expectedVersion: 1 });
      expect(res2.status).toBe(400);

      // Missing expectedVersion
      const res3 = await request(app)
        .post(`/v1/disbursements/${voucherId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ method: 'Cash', date: '2026-10-18' });
      expect(res3.status).toBe(400);

      // Voucher must be completely untouched
      const voucher = mockTables.disbursements.get(voucherId);
      expect(voucher.status).toBe('Pending');
      expect(voucher.version).toBe(1);
    });

    test('R1.4: ExpectedVersion boundary testing: reject zero, negative, float, string', async () => {
      const voucherId = 'voucher-r1-version-boundaries';
      seedVoucher(voucherId, { status: 'Pending' });

      const badVersions = [0, -1, -99, 1.5, '1', 'two', true, null];

      for (const expectedVersion of badVersions) {
        const res = await request(app)
          .post(`/v1/disbursements/${voucherId}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            method: 'Bank Transfer',
            date: '2026-10-18',
            expectedVersion,
          });

        expect(res.status).toBe(400);
      }

      const voucher = mockTables.disbursements.get(voucherId);
      expect(voucher.status).toBe('Pending');
      expect(voucher.version).toBe(1);
    });

    test('R1.5: Calendar Date Boundaries: impossible calendar dates are strictly rejected', async () => {
      const voucherId = 'voucher-r1-dates';
      seedVoucher(voucherId, { status: 'Approved' });

      const impossibleDates = [
        '2026-99-99',
        '2026-00-10',
        '2026-13-01',
        '2026-02-29', // 2026 is NOT a leap year
        '1900-02-29', // 1900 is NOT a leap year (divisible by 100, not 400)
        '2026-04-31', // April has 30 days
        '2026-06-31', // June has 30 days
        '2026-09-31', // September has 30 days
        '2026-11-31', // November has 30 days
        '2026-01-32', // January has 31 days
        '2026-04-00', // Day 0
        '18-10-2026', // wrong format
        '2026/10/18', // wrong separator
        '2026-1-1',   // missing padding
        '2026-10-18T00:00:00Z', // ISO datetime
        'invalid-string',
      ];

      for (const date of impossibleDates) {
        const res = await request(app)
          .post(`/v1/disbursements/${voucherId}/fund`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            method: 'Bank Transfer',
            bank: 'BDO',
            reference: 'REF-1',
            date,
            expectedVersion: 1,
          });

        expect(res.status).toBe(400);
      }

      // Valid leap year 2024-02-29 MUST be accepted
      const leapRes = await request(app)
        .post(`/v1/disbursements/${voucherId}/fund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Bank Transfer',
          bank: 'BDO',
          reference: 'REF-1',
          date: '2024-02-29',
          expectedVersion: 1,
        });

      expect(leapRes.status).toBe(200);
      const voucher = mockTables.disbursements.get(voucherId);
      expect(voucher.status).toBe('Funded');
      expect(voucher.payment_date).toBe('2024-02-29');
    });

    test('R1.6: Century leap year 2000-02-29 is accepted', async () => {
      const voucherId = 'voucher-r1-century-leap';
      seedVoucher(voucherId, { status: 'Approved' });

      const res = await request(app)
        .post(`/v1/disbursements/${voucherId}/fund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Bank Transfer',
          bank: 'BDO',
          reference: 'REF-1',
          date: '2000-02-29',
          expectedVersion: 1,
        });

      expect(res.status).toBe(200);
      const voucher = mockTables.disbursements.get(voucherId);
      expect(voucher.status).toBe('Funded');
      expect(voucher.payment_date).toBe('2000-02-29');
    });
  });

  // --------------------------------------------------------------------------
  // R2: FIX STAFF PENDING CHANGES COUNT COLUMN
  // --------------------------------------------------------------------------
  describe('R2: Staff Pending Changes Counts and Column Security', () => {
    test('R2.1: Staff /counts queries submitted_by and enforces multi-tenant & submitter isolation', async () => {
      // Register a pure Operations staff user (neither Admin nor Accounting)
      const STAFF_CHARLIE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
      const charlieToken = registerUser({
        id: STAFF_CHARLIE_ID,
        email: 'charlie@challenge.test',
        name: 'Staff Charlie',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      });
      mockTables.users.get(STAFF_CHARLIE_ID).user_departments = [
        { departments: { name: 'Operations' } },
      ];

      // Charlie has 1 rejected disbursement in ATA
      seedVoucher('disb-charlie-rej-ata', {
        status: 'Rejected',
        created_by: STAFF_CHARLIE_ID,
        requested_by: STAFF_CHARLIE_ID,
        entity_id: ENT_ATA,
      });

      // Bob has 1 rejected disbursement in ATA
      seedVoucher('disb-bob-rej-ata', {
        status: 'Rejected',
        created_by: STAFF_BOB_ID,
        requested_by: STAFF_BOB_ID,
        entity_id: ENT_ATA,
      });

      // Charlie has 1 draft disbursement in ATA (not rejected)
      seedVoucher('disb-charlie-pend-ata', {
        status: 'Draft',
        created_by: STAFF_CHARLIE_ID,
        requested_by: STAFF_CHARLIE_ID,
        entity_id: ENT_ATA,
      });

      // Charlie has 1 rejected change for invoices (different table)
      mockTables.pending_changes.set('pc-charlie-rej-inv', {
        id: 'pc-charlie-rej-inv',
        entity_id: ENT_ATA,
        table_name: 'invoices',
        status: 'rejected',
        submitted_by: STAFF_CHARLIE_ID,
      });

      // Charlie has 1 rejected disbursement in LTA (different entity)
      seedVoucher('disb-charlie-rej-lta', {
        status: 'Rejected',
        created_by: STAFF_CHARLIE_ID,
        requested_by: STAFF_CHARLIE_ID,
        entity_id: ENT_LTA,
      });

      // Charlie (pure staff: Operations only) requests counts for ATA
      const resCharlie = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${charlieToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      // Charlie must see exactly his own 1 rejected disbursement change (submitted_by === Charlie)
      expect(resCharlie.body.data.rejected).toBe(1);

      // Admin requests counts for ATA (sees Charlie + Bob = 2)
      const resAdmin = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(resAdmin.body.data.rejected).toBe(2);
    });

    test('R2.2: Verifying mock detects SQL 42703 if user_id is queried on pending_changes', async () => {
      const { supabaseAdmin } = require('../fixtures/supabaseMock');
      const queryResult = await supabaseAdmin
        .from('pending_changes')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', STAFF_ALICE_ID);

      expect(queryResult.error).toBeDefined();
      expect(queryResult.error.code).toBe('42703');
      expect(queryResult.error.message).toContain('does not exist');
    });
  });

  // --------------------------------------------------------------------------
  // R5: ATTACHMENT PROVENANCE & REPLAY SAFETY
  // --------------------------------------------------------------------------
  describe('R5: Attachment Provenance & Replay Prevention', () => {
    test('R5.1: Re-submitting the same receipt key across multiple vouchers is rejected (Replay Prevention)', async () => {
      // Alice creates and completes an upload reservation
      const resRecord = reservations.createReservation({
        uploadId: 'upload-replay-1',
        userId: STAFF_ALICE_ID,
        entityId: ENT_ATA,
        objectKey: 'entities/ATA/disbursements/receipts/replay-receipt.pdf',
        filename: 'replay-receipt.pdf',
        contentType: 'application/pdf',
        size: 2048,
      });
      reservations.completeReservation('upload-replay-1', {
        userId: STAFF_ALICE_ID,
        entityId: ENT_ATA,
      });

      // Alice has two vouchers: V1 and V2
      const v1Id = 'voucher-replay-v1';
      const v2Id = 'voucher-replay-v2';
      seedVoucher(v1Id, { status: 'Draft' });
      seedVoucher(v2Id, { status: 'Draft' });

      // Step 1: Alice binds the reservation to Voucher 1
      const update1 = await request(app)
        .put(`/v1/disbursements/${v1Id}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: resRecord.objectKey,
          receiptFilename: 'replay-receipt.pdf',
          expectedVersion: 1,
        })
        .expect(200);

      expect(update1.body.data.receipt_s3_key).toBe(resRecord.objectKey);

      // Verify the reservation is now marked 'consumed'
      const reservation = reservations.getReservation('upload-replay-1');
      expect(reservation.status).toBe('consumed');

      // Step 2: Alice attempts to replay the same key on Voucher 2
      const update2 = await request(app)
        .put(`/v1/disbursements/${v2Id}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: resRecord.objectKey,
          receiptFilename: 'replay-receipt.pdf',
          expectedVersion: 1,
        })
        .expect(400);

      expect(update2.body.code).toBe('INVALID_RECEIPT_RESERVATION');

      // Voucher 2 must NOT have acquired the key
      const v2 = mockTables.disbursements.get(v2Id);
      expect(v2.receipt_s3_key).toBeNull();
      expect(v2.version).toBe(1);

      // Step 3: Alice attempts to replay the same key on voucher creation
      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Replay creation voucher',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA,
          receiptS3Key: resRecord.objectKey,
          receiptFilename: 'replay-receipt.pdf',
        })
        .expect(400);

      expect(createRes.body.code).toBe('INVALID_RECEIPT_RESERVATION');
    });

    test('R5.2: Updating voucher while retaining already-persisted key succeeds', async () => {
      const voucherId = 'voucher-retain-key';
      const existingKey = 'entities/ATA/disbursements/receipts/already-bound.pdf';
      seedVoucher(voucherId, {
        status: 'Draft',
        receipt_s3_key: existingKey,
        receipt_filename: 'already-bound.pdf',
      });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          description: 'Updated description retaining key',
          receiptS3Key: existingKey,
          receiptFilename: 'already-bound.pdf',
          expectedVersion: 1,
        })
        .expect(200);

      expect(res.body.data.description).toBe('Updated description retaining key');
      expect(res.body.data.receipt_s3_key).toBe(existingKey);
      expect(res.body.data.version).toBe(2);
    });

    test('R5.3: Foreign user reservation binding is rejected with HTTP 403 RECEIPT_RESERVATION_MISMATCH', async () => {
      // Alice creates and completes an upload reservation
      const resRecord = reservations.createReservation({
        uploadId: 'upload-alice-only',
        userId: STAFF_ALICE_ID,
        entityId: ENT_ATA,
        objectKey: 'entities/ATA/disbursements/receipts/alice-only.pdf',
        filename: 'alice-only.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      reservations.completeReservation('upload-alice-only', {
        userId: STAFF_ALICE_ID,
        entityId: ENT_ATA,
      });

      // Bob has his own voucher
      const bobVoucherId = 'voucher-bob-draft';
      seedVoucher(bobVoucherId, {
        status: 'Draft',
        created_by: STAFF_BOB_ID,
        requested_by: STAFF_BOB_ID,
        employee_id: STAFF_BOB_ID,
      });

      // Bob tries to update his voucher with Alice's reservation key
      const res = await request(app)
        .put(`/v1/disbursements/${bobVoucherId}`)
        .set('Authorization', `Bearer ${bobToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: resRecord.objectKey,
          receiptFilename: 'alice-only.pdf',
          expectedVersion: 1,
        })
        .expect(403);

      expect(res.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');

      const bobVoucher = mockTables.disbursements.get(bobVoucherId);
      expect(bobVoucher.receipt_s3_key).toBeNull();
    });

    test('R5.4: Cross-entity reservation binding is rejected with HTTP 403 RECEIPT_RESERVATION_MISMATCH', async () => {
      // Admin creates reservation in entity LTA
      const resRecord = reservations.createReservation({
        uploadId: 'upload-lta-only',
        userId: ADMIN_ID,
        entityId: ENT_LTA,
        objectKey: 'entities/LTA/disbursements/receipts/lta-only.pdf',
        filename: 'lta-only.pdf',
        contentType: 'application/pdf',
        size: 1024,
      });
      reservations.completeReservation('upload-lta-only', {
        userId: ADMIN_ID,
        entityId: ENT_LTA,
      });

      // Admin has a voucher in entity ATA
      const ataVoucherId = 'voucher-ata-draft';
      seedVoucher(ataVoucherId, { status: 'Draft', entity_id: ENT_ATA });

      // Admin tries to update ATA voucher with LTA reservation key
      const res = await request(app)
        .put(`/v1/disbursements/${ataVoucherId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: resRecord.objectKey,
          receiptFilename: 'lta-only.pdf',
          expectedVersion: 1,
        })
        .expect(403);

      expect(res.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');
    });

    test('R5.5: Reject filename-only and key-only payloads on creation and update', async () => {
      // Filename-only on voucher creation
      const res1 = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Filename-only creation attempt',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA,
          receiptFilename: 'hack.pdf',
        })
        .expect(400);
      expect(res1.body.title).toBe('Validation Error');

      // Key-only on voucher creation
      const res2 = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          category: 'Meals',
          description: 'Key-only creation attempt',
          amount: 500,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR_ATA,
          receiptS3Key: 'some-key.pdf',
        })
        .expect(400);
      expect(res2.body.title).toBe('Validation Error');

      // Filename-only on voucher update (when voucher has no key)
      const voucherId = 'voucher-no-key';
      seedVoucher(voucherId, { status: 'Draft', receipt_s3_key: null });

      const res3 = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptFilename: 'hack.pdf',
          expectedVersion: 1,
        })
        .expect(400);
      expect(res3.body.code).toBe('INVALID_RECEIPT_ATTACHMENT');

      // Contradictory update: receiptS3Key: null with receiptFilename non-null
      const res4 = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          receiptS3Key: null,
          receiptFilename: 'hack.pdf',
          expectedVersion: 1,
        })
        .expect(400);
      expect(res4.body.title).toBe('Validation Error');
    });

    test('R5.6: Clean detachment: receiptS3Key: null and receiptFilename: null succeeds', async () => {
      const voucherId = 'voucher-clean-detach';
      seedVoucher(voucherId, {
        status: 'Draft',
        receipt_s3_key: 'entities/ATA/receipts/bound.pdf',
        receipt_filename: 'bound.pdf',
      });

      const res = await request(app)
        .put(`/v1/disbursements/${voucherId}`)
        .set('Authorization', `Bearer ${aliceToken}`)
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
  });

  // --------------------------------------------------------------------------
  // CONCURRENCY & RACE CONDITION ADVERSARIAL STRESS TEST
  // --------------------------------------------------------------------------
  describe('Concurrency & Race Condition Checks', () => {
    test('C1: Two concurrent voucher updates targeting the same receipt key cannot both bind it', async () => {
      // Create a single verified reservation for Alice
      const resRecord = reservations.createReservation({
        uploadId: 'upload-concurrent-race',
        userId: STAFF_ALICE_ID,
        entityId: ENT_ATA,
        objectKey: 'entities/ATA/disbursements/receipts/concurrent-race.pdf',
        filename: 'concurrent-race.pdf',
        contentType: 'application/pdf',
        size: 4096,
      });
      reservations.completeReservation('upload-concurrent-race', {
        userId: STAFF_ALICE_ID,
        entityId: ENT_ATA,
      });

      // Two different draft vouchers belonging to Alice
      const v1Id = 'voucher-concurrent-v1';
      const v2Id = 'voucher-concurrent-v2';
      seedVoucher(v1Id, { status: 'Draft' });
      seedVoucher(v2Id, { status: 'Draft' });

      // Dispatch concurrent updates trying to bind the same single reservation
      const [res1, res2] = await Promise.all([
        request(app)
          .put(`/v1/disbursements/${v1Id}`)
          .set('Authorization', `Bearer ${aliceToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            receiptS3Key: resRecord.objectKey,
            receiptFilename: 'concurrent-race.pdf',
            expectedVersion: 1,
          }),
        request(app)
          .put(`/v1/disbursements/${v2Id}`)
          .set('Authorization', `Bearer ${aliceToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            receiptS3Key: resRecord.objectKey,
            receiptFilename: 'concurrent-race.pdf',
            expectedVersion: 1,
          }),
      ]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 400]);

      const v1 = mockTables.disbursements.get(v1Id);
      const v2 = mockTables.disbursements.get(v2Id);

      const boundCount = (v1.receipt_s3_key ? 1 : 0) + (v2.receipt_s3_key ? 1 : 0);
      expect(boundCount).toBe(1);
    });

    test('C2: Two concurrent disbursement approvals on the same voucher: only one succeeds', async () => {
      const voucherId = 'voucher-concurrent-approval';
      seedVoucher(voucherId, { status: 'Draft', version: 1 });

      const [res1, res2] = await Promise.all([
        request(app)
          .post(`/v1/disbursements/${voucherId}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            expectedVersion: 1,
          }),
        request(app)
          .post(`/v1/disbursements/${voucherId}/approve`)
          .set('Authorization', `Bearer ${adminToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            expectedVersion: 1,
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const voucher = mockTables.disbursements.get(voucherId);
      expect(voucher.status).toBe('Approved');
      expect(voucher.version).toBe(2);
    });
  });
});
