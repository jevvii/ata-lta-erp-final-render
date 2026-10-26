/**
 * Integrated ALL-View Receipt Lifecycle Regression Tests
 *
 * Verifies End-to-End Explicit Entity Workflow:
 * 1. R01: ALL-view with explicit LTA target (ATA-first dual user):
 *    - Reserve with X-Active-Entity: LTA -> S3 key under entities/LTA/...
 *    - Upload mock binary to storage
 *    - Complete with X-Active-Entity: LTA -> completed
 *    - Create voucher with X-Active-Entity: LTA & LTA WR -> 201 Created, claimed and consumed.
 *    - Zero 403 RECEIPT_RESERVATION_MISMATCH errors.
 * 2. R02: Inverse ALL-view with explicit ATA target (LTA-first dual user):
 *    - Reserve with X-Active-Entity: ATA -> S3 key under entities/ATA/...
 *    - Upload mock binary
 *    - Complete with X-Active-Entity: ATA -> completed
 *    - Create voucher with X-Active-Entity: ATA & ATA WR -> 201 Created, claimed and consumed.
 * 3. R03: Bind-once enforcement:
 *    - Attempting to reuse an already-consumed receiptS3Key in a second voucher creation is rejected (HTTP 400).
 * 4. R04: Foreign user denial:
 *    - Different user cannot complete or claim a reservation owned by another user (HTTP 403).
 * 5. R05: Cross-entity claim denial:
 *    - Attempting to bind an ATA receipt to an LTA voucher is rejected with HTTP 403 RECEIPT_RESERVATION_MISMATCH.
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

const USER_ATA_FIRST = '11111111-1111-4111-8111-111111111111';
const USER_LTA_FIRST = '22222222-2222-4222-8222-222222222222';
const FOREIGN_USER = '33333333-3333-4333-8333-333333333333';

const ATA_ENTITY_ID = 'ent-ata';
const LTA_ENTITY_ID = 'ent-lta';

const CLIENT_ATA = '77777777-7777-4777-8777-777777777777';
const CLIENT_LTA = '88888888-8888-4888-8888-888888888888';

const WR_ATA = '55555555-5555-4555-8555-555555555555';
const WR_LTA = '66666666-6666-4666-8666-666666666666';

let tokenAtaFirst;
let tokenLtaFirst;
let tokenForeign;

beforeEach(() => {
  resetMock();
  seedDefaults();
  reservations.clearReservations();

  // Dual user with ATA as first entity in array
  tokenAtaFirst = registerUser({
    id: USER_ATA_FIRST,
    email: 'ata_first@example.test',
    name: 'ATA First Staff',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });

  // Dual user with LTA as first entity in array
  tokenLtaFirst = registerUser({
    id: USER_LTA_FIRST,
    email: 'lta_first@example.test',
    name: 'LTA First Staff',
    role: 'Admin',
    entities: ['LTA', 'ATA'],
  });

  // Another dual user
  tokenForeign = registerUser({
    id: FOREIGN_USER,
    email: 'foreign_user@example.test',
    name: 'Foreign Staff',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });

  // Seed reference data
  mockTables.clients.set(CLIENT_ATA, {
    id: CLIENT_ATA,
    entity_id: ATA_ENTITY_ID,
    name: 'ATA Client Corp',
    deleted_at: null,
  });

  mockTables.clients.set(CLIENT_LTA, {
    id: CLIENT_LTA,
    entity_id: LTA_ENTITY_ID,
    name: 'LTA Client Inc',
    deleted_at: null,
  });

  mockTables.work_requests.set(WR_ATA, {
    id: WR_ATA,
    entity_id: ATA_ENTITY_ID,
    client_id: CLIENT_ATA,
    title: 'ATA Audit WR',
    deleted_at: null,
  });

  mockTables.work_requests.set(WR_LTA, {
    id: WR_LTA,
    entity_id: LTA_ENTITY_ID,
    client_id: CLIENT_LTA,
    title: 'LTA Tax Filing WR',
    deleted_at: null,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('ALL-View Receipt Lifecycle Regressions', () => {
  it('R01: succeeds when ATA-first user explicitly uploads and binds under LTA', async () => {
    // 1. Reserve receipt with explicit LTA header
    const reserveRes = await request(app)
      .post('/v1/disbursements/receipt-uploads')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'LTA')
      .send({ filename: 'lta_invoice.png', contentType: 'image/png', size: 16 });

    expect(reserveRes.status).toBe(201);
    const { uploadId, objectKey } = reserveRes.body.data;
    expect(objectKey).toContain('entities/LTA/disbursements/receipts/');

    // 2. Put binary in mock storage
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockStorageObjects.set(objectKey, {
      buffer: Buffer.concat([pngHeader, Buffer.alloc(8, 0)]),
      size: 16,
      contentType: 'image/png',
    });

    // 3. Complete receipt with explicit LTA header
    const completeRes = await request(app)
      .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'LTA')
      .send({});

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.receiptS3Key).toBe(objectKey);
    const { receiptS3Key, receiptFilename } = completeRes.body.data;

    // Verify reservation status in store is completed
    const reservationState = reservations.getReservation(uploadId);
    expect(reservationState.status).toBe('completed');
    expect(reservationState.entityId).toBe(LTA_ENTITY_ID);

    // 4. Create voucher with explicit LTA header and LTA work request
    const createRes = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'LTA')
      .send({
        category: 'Transportation',
        description: 'LTA onsite transport',
        amount: 350,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_LTA,
        clientId: CLIENT_LTA,
        receiptS3Key,
        receiptFilename,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.status).toBe('Draft');
    expect(createRes.body.data.receipt_s3_key).toBe(receiptS3Key);

    // Reservation is now consumed
    const consumedState = reservations.getReservation(uploadId);
    expect(consumedState.status).toBe('consumed');
  });

  it('R02: succeeds when LTA-first user explicitly uploads and binds under ATA', async () => {
    // 1. Reserve receipt with explicit ATA header
    const reserveRes = await request(app)
      .post('/v1/disbursements/receipt-uploads')
      .set('Authorization', `Bearer ${tokenLtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({ filename: 'ata_receipt.png', contentType: 'image/png', size: 16 });

    expect(reserveRes.status).toBe(201);
    const { uploadId, objectKey } = reserveRes.body.data;
    expect(objectKey).toContain('entities/ATA/disbursements/receipts/');

    // 2. Mock storage binary
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockStorageObjects.set(objectKey, {
      buffer: Buffer.concat([pngHeader, Buffer.alloc(8, 0)]),
      size: 16,
      contentType: 'image/png',
    });

    // 3. Complete receipt with explicit ATA header
    const completeRes = await request(app)
      .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
      .set('Authorization', `Bearer ${tokenLtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({});

    expect(completeRes.status).toBe(200);
    const { receiptS3Key, receiptFilename } = completeRes.body.data;

    // 4. Create voucher with explicit ATA header and ATA work request
    const createRes = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${tokenLtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        category: 'Supplies',
        description: 'ATA office supplies',
        amount: 120,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
        clientId: CLIENT_ATA,
        receiptS3Key,
        receiptFilename,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.receipt_s3_key).toBe(receiptS3Key);

    const consumedState = reservations.getReservation(uploadId);
    expect(consumedState.status).toBe('consumed');
  });

  it('R03: enforces bind-once by rejecting reuse of an already-consumed receipt', async () => {
    // 1. Reserve and complete under ATA
    const reserveRes = await request(app)
      .post('/v1/disbursements/receipt-uploads')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({ filename: 'one_time.png', contentType: 'image/png', size: 16 });

    const { uploadId, objectKey } = reserveRes.body.data;
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockStorageObjects.set(objectKey, {
      buffer: Buffer.concat([pngHeader, Buffer.alloc(8, 0)]),
      size: 16,
      contentType: 'image/png',
    });

    const completeRes = await request(app)
      .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({});

    const { receiptS3Key, receiptFilename } = completeRes.body.data;

    // 2. First voucher creation succeeds
    const firstVoucher = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        category: 'Meals',
        description: 'First voucher binding',
        amount: 80,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
        clientId: CLIENT_ATA,
        receiptS3Key,
        receiptFilename,
      });
    expect(firstVoucher.status).toBe(201);

    // 3. Second voucher creation attempting to reuse the same receiptS3Key is rejected
    const secondVoucher = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        category: 'Meals',
        description: 'Second voucher duplicate attempt',
        amount: 90,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
        clientId: CLIENT_ATA,
        receiptS3Key,
        receiptFilename,
      });

    expect(secondVoucher.status).toBe(400);
    expect(secondVoucher.body.code).toBe('INVALID_RECEIPT_RESERVATION');
    expect(secondVoucher.body.detail).toContain('already consumed');
  });

  it('R04: prevents foreign user from completing or claiming another user reservation', async () => {
    // 1. User A reserves under LTA
    const reserveRes = await request(app)
      .post('/v1/disbursements/receipt-uploads')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'LTA')
      .send({ filename: 'user_a.png', contentType: 'image/png', size: 16 });

    const { uploadId, objectKey } = reserveRes.body.data;

    // 2. User B (Foreign) attempts to complete User A's reservation
    const foreignComplete = await request(app)
      .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
      .set('Authorization', `Bearer ${tokenForeign}`)
      .set('X-Active-Entity', 'LTA')
      .send({});

    expect(foreignComplete.status).toBe(403);
    expect(foreignComplete.body.code).toBe('UPLOAD_RESERVATION_MISMATCH');

    // Complete properly with User A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockStorageObjects.set(objectKey, {
      buffer: Buffer.concat([pngHeader, Buffer.alloc(8, 0)]),
      size: 16,
      contentType: 'image/png',
    });

    const userAComplete = await request(app)
      .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'LTA')
      .send({});
    expect(userAComplete.status).toBe(200);

    // 3. User B attempts to claim User A's completed receipt in voucher create
    const foreignClaim = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${tokenForeign}`)
      .set('X-Active-Entity', 'LTA')
      .send({
        category: 'Travel',
        description: 'Foreign user claim attempt',
        amount: 200,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_LTA,
        clientId: CLIENT_LTA,
        receiptS3Key: objectKey,
        receiptFilename: 'user_a.png',
      });

    expect(foreignClaim.status).toBe(403);
    expect(foreignClaim.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');
  });

  it('R05: rejects cross-entity binding with 403 RECEIPT_RESERVATION_MISMATCH', async () => {
    // 1. Reserve and complete under ATA
    const reserveRes = await request(app)
      .post('/v1/disbursements/receipt-uploads')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({ filename: 'ata_receipt.png', contentType: 'image/png', size: 16 });

    const { uploadId, objectKey } = reserveRes.body.data;
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    mockStorageObjects.set(objectKey, {
      buffer: Buffer.concat([pngHeader, Buffer.alloc(8, 0)]),
      size: 16,
      contentType: 'image/png',
    });

    await request(app)
      .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'ATA')
      .send({});

    // 2. Attempt to bind ATA receipt key to an LTA voucher create
    const crossEntityCreate = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${tokenAtaFirst}`)
      .set('X-Active-Entity', 'LTA')
      .send({
        category: 'Travel',
        description: 'Cross-entity claim mismatch',
        amount: 150,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_LTA,
        clientId: CLIENT_LTA,
        receiptS3Key: objectKey,
        receiptFilename: 'ata_receipt.png',
      });

    expect(crossEntityCreate.status).toBe(403);
    expect(crossEntityCreate.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');
    expect(crossEntityCreate.body.detail).toContain(
      'Receipt reservation does not belong to the authenticated user or entity.'
    );

    // Ensure reservation remained in completed state (not consumed or corrupted)
    const state = reservations.getReservation(uploadId);
    expect(state.status).toBe('completed');
  });
});
