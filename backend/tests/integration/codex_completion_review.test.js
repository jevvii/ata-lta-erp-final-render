/**
 * Permanent Regression Test Suite: DB Audit 2026-10-18 Remediation
 * Inverts the 7 independent reproduction probes into permanent passing regression tests.
 * 
 * Verifies:
 * 1. Empty-body approval/release rejection with HTTP 400 (preserving voucher state/payment/version)
 * 2. Upload completion rejection with HTTP 422 on oversized (>10 MiB) or mismatched bytes
 * 3. Reservation replay prevention returning ALREADY_CONSUMED on consumed reservations
 * 4. Rejection of unverified/foreign S3 keys on voucher update (PUT/PATCH)
 * 5. Rejection of impossible calendar dates (e.g., 2026-99-99, 2026-02-29) in payment schemas
 * 6. Rejection of filename-only voucher creation (requiring paired verified receiptS3Key)
 * 7. Rejection of Draft invoice financial/line-item edits without positive integer expectedVersion
 */

jest.mock('../../src/services/supabaseClient', () => ({
  supabaseAdmin: require('../fixtures/supabaseMock').supabaseAdmin,
}));

const request = require('supertest');
const { app } = require('../helpers/testServer');
const {
  registerUser,
  resetMock,
  seedDefaults,
  mockTables,
  mockStorageObjects,
} = require('../fixtures/supabaseMock');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');
const schema = require('../../src/modules/disbursements/schema');

const OWNER = '99999999-9999-4999-8999-999999999999';
const WR = '33333333-3333-4333-8333-333333333333';
let token;

const send = (method, url, body) =>
  request(app)[method](url)
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', 'ATA')
    .send(body);

beforeEach(() => {
  resetMock();
  seedDefaults();
  reservations.clearReservations();
  token = registerUser({
    id: OWNER,
    email: 'review@example.test',
    name: 'Review Admin',
    role: 'Admin',
    entities: ['ATA'],
  });
  mockTables.work_requests.set(WR, {
    id: WR,
    entity_id: 'ent-ata',
    title: 'Review WR',
  });
});

const seedVoucher = (id, status = 'Pending') =>
  mockTables.disbursements.set(id, {
    id,
    entity_id: 'ent-ata',
    status,
    version: 1,
    created_by: OWNER,
    requested_by: OWNER,
    employee_id: OWNER,
    description: 'Review voucher',
    amount: 100,
    category: 'Meals',
    fund_source: 'Firm Fund',
    archived: false,
  });

describe('Codex Completion Review Regression Suite (R1–R6)', () => {
  // Probe 1 / R1: Empty-body approval must fail with HTTP 400 and preserve state
  it('rejects empty-body approval with HTTP 400 leaving voucher state, payment fields, and version unchanged', async () => {
    seedVoucher('review-voucher');
    const res = await send('post', '/v1/disbursements/review-voucher/approve', {});
    expect(res.status).toBe(400);

    const voucher = mockTables.disbursements.get('review-voucher');
    expect(voucher.status).toBe('Pending');
    expect(voucher.payment_method === null || voucher.payment_method === undefined).toBe(true);
    expect(voucher.payment_date === null || voucher.payment_date === undefined).toBe(true);
    expect(voucher.version).toBe(1);
  });

  it('rejects empty-body release with HTTP 400 leaving voucher state unchanged', async () => {
    seedVoucher('review-voucher-release');
    const res = await send('post', '/v1/disbursements/review-voucher-release/release', {});
    expect(res.status).toBe(400);

    const voucher = mockTables.disbursements.get('review-voucher-release');
    expect(voucher.status).toBe('Pending');
    expect(voucher.version).toBe(1);
  });

  // Probe 2 / R3: Upload completion must validate actual bytes and reject oversized/mismatched uploads
  it('rejects completion with HTTP 422 for oversized or mismatched uploaded bytes', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'receipt.png',
      contentType: 'image/png',
      size: 10,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    // Simulate oversized upload (>10 MiB)
    mockStorageObjects.set(objectKey, {
      buffer: Buffer.alloc(10485761, 65),
      size: 10485761,
      contentType: 'application/octet-stream',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(422);
    expect(done.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('rejects completion with HTTP 422 when uploaded MIME type mismatches reservation', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'receipt.png',
      contentType: 'image/png',
      size: 100,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    // Uploaded as octet-stream instead of reserved image/png
    mockStorageObjects.set(objectKey, {
      buffer: Buffer.alloc(100, 65),
      size: 100,
      contentType: 'application/octet-stream',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(422);
  });

  // Probe 3 / R4: Consumed reservation must be durable and non-reversible
  it('rejects re-completing consumed reservations with ALREADY_CONSUMED preventing replay', () => {
    reservations.createReservation({
      uploadId: 'replay',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'receipt-key',
      filename: 'r.png',
      contentType: 'image/png',
      size: 10,
    });
    reservations.completeReservation('replay', { userId: OWNER, entityId: 'ent-ata' });
    const claim = reservations.claimReservationByKey({ receiptS3Key: 'receipt-key', userId: OWNER, entityId: 'ent-ata' });
    reservations.consumeReservationByKey({ receiptS3Key: 'receipt-key', userId: OWNER, entityId: 'ent-ata', claimId: claim.claimId });
    expect(reservations.getReservation('replay').status).toBe('consumed');

    // Attempt to re-complete consumed reservation must return ALREADY_CONSUMED error
    let error;
    try {
      const res = reservations.completeReservation('replay', { userId: OWNER, entityId: 'ent-ata' });
      if (res && res.error) {
        error = res.error;
      }
    } catch (e) {
      error = e.code || e.message;
    }
    expect(error).toBe('ALREADY_CONSUMED');

    // Reservation must remain consumed and not completed
    const completed = reservations.findCompletedReservationByKey({
      receiptS3Key: 'receipt-key',
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(completed && completed.data).toBeUndefined();
    expect(reservations.getReservation('replay').status).toBe('consumed');
  });

  // Probe 4 / R5: Rejection of foreign or unverified S3 keys on voucher update
  it('rejects voucher update with unverified foreign receipt key', async () => {
    seedVoucher('review-voucher', 'Draft');
    const res = await send('put', '/v1/disbursements/review-voucher', {
      receiptS3Key: 'entities/LTA/private/foreign-document.pdf',
      receiptFilename: 'forged.pdf',
      expectedVersion: 1,
    });
    expect([400, 403, 422]).toContain(res.status);

    const stored = mockTables.disbursements.get('review-voucher');
    expect(stored.receipt_s3_key).not.toBe('entities/LTA/private/foreign-document.pdf');
  });

  // Probe 5 / R1: Calendar date validation in schema rejecting impossible dates
  it('rejects impossible calendar dates in payment schema', () => {
    // 2026-99-99 (impossible month & day)
    expect(
      schema.fundDisbursementSchema.safeParse({
        method: 'Cash',
        bank: 'Cash',
        reference: 'REF-1',
        date: '2026-99-99',
        expectedVersion: 1,
      }).success
    ).toBe(false);

    // 2026-02-29 (not a leap year)
    expect(
      schema.fundDisbursementSchema.safeParse({
        method: 'Cash',
        bank: 'Cash',
        reference: 'REF-1',
        date: '2026-02-29',
        expectedVersion: 1,
      }).success
    ).toBe(false);

    // 2026-04-31 (April has only 30 days)
    expect(
      schema.fundDisbursementSchema.safeParse({
        method: 'Cash',
        bank: 'Cash',
        reference: 'REF-1',
        date: '2026-04-31',
        expectedVersion: 1,
      }).success
    ).toBe(false);

    // Valid real date must pass
    expect(
      schema.fundDisbursementSchema.safeParse({
        method: 'Cash',
        bank: 'Cash',
        reference: 'REF-1',
        date: '2026-10-18',
        expectedVersion: 1,
      }).success
    ).toBe(true);
  });

  // Probe 6 / R5: Rejection of filename-only voucher creation
  it('rejects filename-only new voucher creation', async () => {
    const res = await send('post', '/v1/disbursements', {
      category: 'Meals',
      description: 'Review filename-only voucher',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      receiptFilename: 'not-uploaded.png',
    });
    expect([400, 422]).toContain(res.status);
    expect(res.status).not.toBe(201);
  });

  // Probe 7 / R6: Rejection of Draft financial edit without expectedVersion
  it('rejects Draft financial edit without expectedVersion with HTTP 400', async () => {
    mockTables.invoices.set('review-invoice', {
      id: 'review-invoice',
      entity_id: 'ent-ata',
      invoice_number: 'INV-REVIEW',
      status: 'Draft',
      version: 1,
      total: 100,
      subtotal: 100,
      amount_paid: 0,
      balance: 100,
      archived: false,
    });

    const res = await send('patch', '/v1/invoices/review-invoice', {
      terms: 'Changed without a version',
    });
    expect(res.status).toBe(400);

    const inv = mockTables.invoices.get('review-invoice');
    expect(inv.terms).not.toBe('Changed without a version');
  });
});
