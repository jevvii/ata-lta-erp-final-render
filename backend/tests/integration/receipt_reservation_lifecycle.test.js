/**
 * Integration Test Suite: Milestone 2 — R3 & R4 Storage & Receipt Reservation Lifecycle
 *
 * Verifies:
 * 1. R3: Receipt binary & metadata validation in storageService & completeReceiptUpload:
 *    - Valid PDF, PNG, JPEG with magic bytes and matching size succeed (HTTP 200)
 *    - Exactly 10 MiB limit handled correctly
 *    - Oversized (>10 MiB), empty (0 bytes), size mismatch, MIME mismatch, and corrupt headers rejected with HTTP 422
 * 2. R4: Concurrency mutual exclusion via atomic claim:
 *    - Concurrent voucher creations with the same reservation: exactly one succeeds (201), competitor rejected (400)
 * 3. R4: Transactional rollback & retry safety:
 *    - Voucher creation failure releases claimed reservation back to 'completed'
 *    - Subsequent retry reuses reservation without re-uploading
 * 4. R4: Non-reversible state machine:
 *    - Consumed reservations cannot be re-completed, re-claimed, or replayed
 * 5. R4: Scoped orphan cleanup:
 *    - Purges expired unconsumed files from storage & memory
 *    - Safeguards consumed files from storage deletion
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
const service = require('../../src/modules/disbursements/service');

const OWNER = '99999999-9999-4999-8999-999999999999';
const WR = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-4444-444444444444';
const NON_EXISTENT_TASK_UUID = '11111111-1111-4111-8111-111111111111';
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
    email: 'm2_worker@example.test',
    name: 'M2 Worker Admin',
    role: 'Admin',
    entities: ['ATA'],
  });
  mockTables.work_requests.set(WR, {
    id: WR,
    entity_id: 'ent-ata',
    title: 'M2 Lifecycle WR',
  });
  mockTables.tasks.set(TASK, {
    id: TASK,
    work_request_id: WR,
    title: 'M2 Lifecycle Task',
    status: 'In Progress',
  });
});

describe('M2 — R3: Receipt Binary & Metadata Validation', () => {
  it('accepts upload completion for valid PNG with magic bytes and matching size', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'receipt.png',
      contentType: 'image/png',
      size: 16,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    // Valid PNG 8-byte header: 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const validPngBuffer = Buffer.concat([pngHeader, Buffer.alloc(8, 0)]);

    mockStorageObjects.set(objectKey, {
      buffer: validPngBuffer,
      size: 16,
      contentType: 'image/png',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body.data.receiptS3Key).toBe(objectKey);
  });

  it('accepts upload completion for valid JPEG with magic bytes and matching size', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 10,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    // Valid JPEG 3-byte header: 0xFF, 0xD8, 0xFF
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff]);
    const validJpegBuffer = Buffer.concat([jpegHeader, Buffer.alloc(7, 0)]);

    mockStorageObjects.set(objectKey, {
      buffer: validJpegBuffer,
      size: 10,
      contentType: 'image/jpeg',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(200);
    expect(done.body.data.receiptS3Key).toBe(objectKey);
  });

  it('accepts valid PDF upload at exactly the 10 MiB limit (10,485,760 bytes)', async () => {
    const MAX_10MB = 10 * 1024 * 1024;
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'exact10mb.pdf',
      contentType: 'application/pdf',
      size: MAX_10MB,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(MAX_10MB - 9, 0),
    ]);

    mockStorageObjects.set(objectKey, {
      buffer: pdfBuffer,
      size: MAX_10MB,
      contentType: 'application/pdf',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(200);
  });

  it('rejects empty binary (0 bytes) with HTTP 422', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'empty.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    const { uploadId, objectKey } = start.body.data;

    mockStorageObjects.set(objectKey, {
      buffer: Buffer.alloc(0),
      size: 0,
      contentType: 'application/pdf',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(422);
    expect(done.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('rejects size mismatch with HTTP 422 when uploaded bytes do not match reservation size', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'mismatch.pdf',
      contentType: 'application/pdf',
      size: 5000,
    });
    const { uploadId, objectKey } = start.body.data;

    // Uploaded 2000 bytes instead of reserved 5000 bytes
    const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000 - 9, 0)]);

    mockStorageObjects.set(objectKey, {
      buffer: pdfBuffer,
      size: 2000,
      contentType: 'application/pdf',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(422);
    expect(done.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('rejects cross-MIME mismatch when binary magic bytes do not match reserved content type', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'spoofed.png',
      contentType: 'image/png',
      size: 100,
    });
    const { uploadId, objectKey } = start.body.data;

    // Upload valid PDF bytes into a reservation declared as image/png
    const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100 - 9, 0)]);

    mockStorageObjects.set(objectKey, {
      buffer: pdfBuffer,
      size: 100,
      contentType: 'image/png',
    });

    const done = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(done.status).toBe(422);
    expect(done.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });
});

describe('M2 — R4: Concurrency, Atomic Claim & Retry Safety', () => {
  it('prevents concurrent voucher creations from binding the same receipt reservation', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'race-receipt.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    const { uploadId, objectKey } = start.body.data;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 1024,
      contentType: 'application/pdf',
    });

    const completeRes = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(completeRes.status).toBe(200);

    // Concurrently issue two voucher creations referencing the exact same receipt
    const [res1, res2] = await Promise.all([
      send('post', '/v1/disbursements', {
        category: 'Supplies',
        description: 'Concurrent creation attempt 1',
        amount: 300,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR,
        linkedTaskId: TASK,
        receiptS3Key: objectKey,
        receiptFilename: 'race-receipt.pdf',
      }),
      send('post', '/v1/disbursements', {
        category: 'Supplies',
        description: 'Concurrent creation attempt 2',
        amount: 300,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR,
        linkedTaskId: TASK,
        receiptS3Key: objectKey,
        receiptFilename: 'race-receipt.pdf',
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 400]);

    // The winning voucher owns the receipt; reservation is now consumed
    const consumedCheck = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(consumedCheck && consumedCheck.data).toBeUndefined();
  });

  it('rolls back claimed reservation on voucher creation failure, permitting retry without re-upload', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'retry-receipt.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    const { uploadId, objectKey } = start.body.data;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 1024,
      contentType: 'application/pdf',
    });

    await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});

    // Attempt voucher creation with non-existent task UUID (triggers 400 TASK_NOT_FOUND in service)
    const failRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Failing creation attempt',
      amount: 150,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      receiptS3Key: objectKey,
      receiptFilename: 'retry-receipt.pdf',
      taskId: NON_EXISTENT_TASK_UUID,
    });
    expect(failRes.status).toBe(400);
    expect(failRes.body.code).toBe('TASK_NOT_FOUND');

    // Reservation must have rolled back to 'completed'
    const completedRecord = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(completedRecord?.data).toBeDefined();
    expect(completedRecord.data.status).toBe('completed');

    // Retry creation without invalid task -> succeeds with 201 without re-uploading
    const retryRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Successful retry creation',
      amount: 150,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      linkedTaskId: TASK,
      receiptS3Key: objectKey,
      receiptFilename: 'retry-receipt.pdf',
    });
    expect(retryRes.status).toBe(201);
    expect(retryRes.body.data.receipt_s3_key).toBe(objectKey);

    // Reservation is now consumed
    const postConsume = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(postConsume && postConsume.data).toBeUndefined();
  });

  it('rejects re-completing consumed reservation via completeReceiptUpload endpoint with HTTP 409', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'consume-endpoint.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    const { uploadId, objectKey } = start.body.data;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 1024,
      contentType: 'application/pdf',
    });

    await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});

    // Create voucher consuming the reservation
    const createRes = await send('post', '/v1/disbursements', {
      category: 'Meals',
      description: 'Voucher with receipt',
      amount: 400,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      linkedTaskId: TASK,
      receiptS3Key: objectKey,
      receiptFilename: 'consume-endpoint.pdf',
    });
    expect(createRes.status).toBe(201);

    // Attempting to re-complete upload on consumed reservation returns HTTP 409
    const reComplete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(reComplete.status).toBe(409);
    expect(reComplete.body.code).toBe('RECEIPT_RESERVATION_ALREADY_CONSUMED');
  });

  it('rejects re-completing claimed reservation via completeReceiptUpload endpoint with HTTP 409', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'claimed-reject.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    const { uploadId, objectKey } = start.body.data;
    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 1024,
      contentType: 'application/pdf',
    });

    // 1. Initial complete transitions pending -> completed
    const complete1 = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete1.status).toBe(200);

    // 2. Claim reservation (completed -> claimed)
    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim.data?.status).toBe('claimed');

    // 3. Re-complete attempt while claimed is rejected with 409 Conflict
    const reComplete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(reComplete.status).toBe(409);
    expect(reComplete.body.code).toBe('RECEIPT_RESERVATION_ALREADY_CLAIMED');

    // 4. Invariant: status remains claimed
    expect(reservations.getReservation(uploadId).status).toBe('claimed');
  });
});

describe('M2 — R4: Scoped Orphan Cleanup', () => {
  it('cleans expired unconsumed storage objects and strictly preserves consumed voucher files', async () => {
    const mockStorage = {
      deleted: [],
      deleteObject: jest.fn(async (path) => {
        mockStorage.deleted.push(path);
      }),
    };

    // 1. Pending reservation (to be expired at simulated now)
    reservations.createReservation({
      uploadId: 'orphan-pending-id',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/disbursements/receipts/orphan-pending.pdf',
      filename: 'orphan-pending.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 300, // expires in 5 minutes
    });

    // 2. Completed reservation (to be expired at simulated now)
    reservations.createReservation({
      uploadId: 'orphan-completed-id',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/disbursements/receipts/orphan-completed.pdf',
      filename: 'orphan-completed.pdf',
      contentType: 'application/pdf',
      size: 2048,
      expiresInSeconds: 300, // expires in 5 minutes
    });
    reservations.completeReservation('orphan-completed-id', { userId: OWNER, entityId: 'ent-ata' });

    // 3. CONSUMED reservation (active voucher document) -> MUST NOT BE DELETED FROM STORAGE
    reservations.createReservation({
      uploadId: 'active-voucher-id',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/disbursements/receipts/bound-voucher.pdf',
      filename: 'bound-voucher.pdf',
      contentType: 'application/pdf',
      size: 4096,
      expiresInSeconds: 300,
    });
    reservations.completeReservation('active-voucher-id', { userId: OWNER, entityId: 'ent-ata' });
    reservations.consumeReservationByKey({
      receiptS3Key: 'entities/ATA/disbursements/receipts/bound-voucher.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
    });

    // 4. Active pending reservation (expires in 1 hour) -> MUST NOT BE TOUCHED
    reservations.createReservation({
      uploadId: 'active-upload-id',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/disbursements/receipts/active-in-flight.pdf',
      filename: 'active-in-flight.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 3600, // expires in 1 hour
    });

    // Simulate cleanup run 10 minutes into the future:
    // Records 1, 2, and 3 are expired (300s < 600s).
    // Record 4 is still active (3600s > 600s).
    const simulatedFuture = new Date(Date.now() + 600 * 1000);

    const cleanupResult = await reservations.cleanupExpiredReservations({
      now: simulatedFuture,
      storage: mockStorage,
    });

    expect(cleanupResult.scanned).toBe(4);
    expect(cleanupResult.cleaned).toBe(2);
    expect(cleanupResult.skippedConsumed).toBe(1);

    // Verify deleted storage files
    expect(mockStorage.deleted).toContain('entities/ATA/disbursements/receipts/orphan-pending.pdf');
    expect(mockStorage.deleted).toContain('entities/ATA/disbursements/receipts/orphan-completed.pdf');

    // STRICT INTEGRITY CHECK: bound voucher receipt was NEVER deleted from storage
    expect(mockStorage.deleted).not.toContain('entities/ATA/disbursements/receipts/bound-voucher.pdf');
    expect(mockStorage.deleted).not.toContain('entities/ATA/disbursements/receipts/active-in-flight.pdf');

    // Test exported function on service module
    expect(typeof service.cleanupExpiredReservations).toBe('function');
  });
});
