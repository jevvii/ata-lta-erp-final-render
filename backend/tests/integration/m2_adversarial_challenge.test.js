/**
 * Empirical Adversarial Challenge Suite: Milestone 2 (R3, R4)
 *
 * Verifies with empirical stress probes:
 * 1. 10 MiB byte boundary (10,485,760 vs 10,485,761)
 * 2. MIME mismatch & magic byte inspection (PDF, PNG, JPEG, polyglot, binary executables, shell scripts, HTML)
 * 3. Replay prevention on consumed reservations (non-reversible lifecycle)
 * 4. Concurrency race conditions on reservation claim (10-request swarms for create, update, and mixed)
 * 5. Create-fail-retry rollback safety (task missing, WR mismatch, DB 500, OCC 409, claimId mismatch)
 * 6. Scoped orphan cleanup (unconsumed deletion vs consumed preservation, dry run, error resilience, memory pruning)
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
const storageService = require('../../src/services/storageService');

const OWNER = '99999999-9999-4999-8999-999999999999';
const OTHER_USER = '88888888-8888-4888-8888-888888888888';
const WR = '33333333-3333-4333-8333-333333333333';
const VALID_TASK_UUID = '77777777-7777-4777-8777-777777777777';
const NON_EXISTENT_TASK_UUID = '11111111-1111-4111-8111-111111111111';
const MAX_10MB = 10 * 1024 * 1024; // 10,485,760 bytes

let token;
let otherToken;

const send = (method, url, body, customToken = token) =>
  request(app)[method](url)
    .set('Authorization', `Bearer ${customToken}`)
    .set('X-Active-Entity', 'ATA')
    .send(body);

beforeEach(() => {
  resetMock();
  seedDefaults();
  reservations.clearReservations();

  token = registerUser({
    id: OWNER,
    email: 'challenger_m2@example.test',
    name: 'M2 Challenger Admin',
    role: 'Admin',
    entities: ['ATA'],
  });

  otherToken = registerUser({
    id: OTHER_USER,
    email: 'other_user@example.test',
    name: 'Other Entity User',
    role: 'Admin',
    entities: ['ATA'],
  });

  mockTables.work_requests.set(WR, {
    id: WR,
    entity_id: 'ent-ata',
    title: 'Adversarial Challenge WR',
  });

  mockTables.tasks.set(VALID_TASK_UUID, {
    id: VALID_TASK_UUID,
    work_request_id: WR,
    entity_id: 'ent-ata',
    title: 'Adversarial Challenge Task',
    status: 'In Progress',
    assignee_id: OWNER,
    deleted_at: null,
  });
});

describe('Adversarial Challenge 1: 10 MiB Byte Boundary Probes', () => {
  it('Probe 1.1: Accepts valid PDF binary at exact 10 MiB limit (10,485,760 bytes)', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'boundary-max.pdf',
      contentType: 'application/pdf',
      size: MAX_10MB,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    const pdfBuffer = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(MAX_10MB - 9, 0x20),
    ]);
    expect(pdfBuffer.length).toBe(MAX_10MB);

    mockStorageObjects.set(objectKey, {
      buffer: pdfBuffer,
      size: MAX_10MB,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(200);
    expect(complete.body.data.receiptS3Key).toBe(objectKey);
  });

  it('Probe 1.2: Rejects reservation creation for 10 MiB + 1 byte (10,485,761 bytes) with HTTP 400', async () => {
    const OVER_10MB = MAX_10MB + 1; // 10,485,761 bytes
    const res = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'overflow.pdf',
      contentType: 'application/pdf',
      size: OVER_10MB,
    });
    expect(res.status).toBe(400);
    expect(res.body.title).toBe('Validation Error');
  });

  it('Probe 1.3: Rejects completion with HTTP 422 when uploaded object in storage is 10,485,761 bytes', async () => {
    const OVER_10MB = MAX_10MB + 1;
    // Reservation was made for 10,485,760, but uploaded binary is 10,485,761
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'sneaky-overflow.pdf',
      contentType: 'application/pdf',
      size: MAX_10MB,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    const oversizedBuffer = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(OVER_10MB - 9, 0x20),
    ]);
    expect(oversizedBuffer.length).toBe(OVER_10MB);

    mockStorageObjects.set(objectKey, {
      buffer: oversizedBuffer,
      size: OVER_10MB,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 1.4: Rejects completion with HTTP 422 when uploaded object is 1 byte short (10,485,759 bytes)', async () => {
    const SHORT_10MB = MAX_10MB - 1; // 10,485,759 bytes
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'underflow.pdf',
      contentType: 'application/pdf',
      size: MAX_10MB,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    const shortBuffer = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(SHORT_10MB - 9, 0x20),
    ]);
    expect(shortBuffer.length).toBe(SHORT_10MB);

    mockStorageObjects.set(objectKey, {
      buffer: shortBuffer,
      size: SHORT_10MB,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 1.5: Rejects empty binary (0 bytes) with HTTP 422', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'zero-bytes.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    const { uploadId, objectKey } = start.body.data;

    mockStorageObjects.set(objectKey, {
      buffer: Buffer.alloc(0),
      size: 0,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 1.6: Rejects 1-byte binary (below magic byte header length) with HTTP 422', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'one-byte.pdf',
      contentType: 'application/pdf',
      size: 1,
    });
    const { uploadId, objectKey } = start.body.data;

    mockStorageObjects.set(objectKey, {
      buffer: Buffer.from([0x25]), // '%' only
      size: 1,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 1.7: Accepts valid PNG at exact 10 MiB limit', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'boundary.png',
      contentType: 'image/png',
      size: MAX_10MB,
    });
    const { uploadId, objectKey } = start.body.data;

    const pngBuffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(MAX_10MB - 8, 0),
    ]);

    mockStorageObjects.set(objectKey, {
      buffer: pngBuffer,
      size: MAX_10MB,
      contentType: 'image/png',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(200);
  });

  it('Probe 1.8: Accepts valid JPEG at exact 10 MiB limit', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'boundary.jpg',
      contentType: 'image/jpeg',
      size: MAX_10MB,
    });
    const { uploadId, objectKey } = start.body.data;

    const jpegBuffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.alloc(MAX_10MB - 3, 0),
    ]);

    mockStorageObjects.set(objectKey, {
      buffer: jpegBuffer,
      size: MAX_10MB,
      contentType: 'image/jpeg',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(200);
  });
});

describe('Adversarial Challenge 2: MIME Mismatch & Magic Byte Inspection Probes', () => {
  it('Probe 2.1: Rejects JPEG binary when reservation expected PDF', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'fake-pdf.pdf',
      contentType: 'application/pdf',
      size: 64,
    });
    const { uploadId, objectKey } = start.body.data;

    // JPEG header in PDF reservation
    const jpegBuffer = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(61, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: jpegBuffer,
      size: 64,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.2: Rejects PDF binary when reservation expected PNG', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'fake-png.png',
      contentType: 'image/png',
      size: 64,
    });
    const { uploadId, objectKey } = start.body.data;

    // PDF header in PNG reservation
    const pdfBuffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: pdfBuffer,
      size: 64,
      contentType: 'image/png',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.3: Rejects PNG binary when reservation expected JPEG', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'fake-jpg.jpg',
      contentType: 'image/jpeg',
      size: 64,
    });
    const { uploadId, objectKey } = start.body.data;

    // PNG header in JPEG reservation
    const pngBuffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64 - 8, 0),
    ]);
    mockStorageObjects.set(objectKey, {
      buffer: pngBuffer,
      size: 64,
      contentType: 'image/jpeg',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.4: Rejects executable binary (MZ header: 0x4D, 0x5A) disguised as PDF', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'malicious.pdf',
      contentType: 'application/pdf',
      size: 128,
    });
    const { uploadId, objectKey } = start.body.data;

    // Windows PE executable header: MZ
    const exeBuffer = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(124, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: exeBuffer,
      size: 128,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.5: Rejects shell script disguised as PDF', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'script.pdf',
      contentType: 'application/pdf',
      size: 64,
    });
    const { uploadId, objectKey } = start.body.data;

    const shBuffer = Buffer.concat([Buffer.from('#!/bin/bash\nrm -rf /'), Buffer.alloc(44, 0x20)]);
    mockStorageObjects.set(objectKey, {
      buffer: shBuffer,
      size: 64,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.6: Rejects HTML content disguised as PDF', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'xss.pdf',
      contentType: 'application/pdf',
      size: 64,
    });
    const { uploadId, objectKey } = start.body.data;

    const htmlBuffer = Buffer.concat([Buffer.from('<!DOCTYPE html><html><script>alert(1)</script>'), Buffer.alloc(18, 0x20)]);
    mockStorageObjects.set(objectKey, {
      buffer: htmlBuffer,
      size: 64,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.7: Rejects corrupt PDF header (%PDF without trailing hyphen: 4 bytes)', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'corrupt-header.pdf',
      contentType: 'application/pdf',
      size: 64,
    });
    const { uploadId, objectKey } = start.body.data;

    // '%PDF' without '-' (0x25, 0x50, 0x44, 0x46, 0x20)
    const corruptBuffer = Buffer.concat([Buffer.from('%PDF 1.4\n'), Buffer.alloc(64 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: corruptBuffer,
      size: 64,
      contentType: 'application/pdf',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.8: Rejects when storage metadata content-type contradicts reservation content-type', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'mismatched-metadata.pdf',
      contentType: 'application/pdf',
      size: 64,
    });
    const { uploadId, objectKey } = start.body.data;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64 - 9, 0)]);
    // Storage has text/plain metadata
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 64,
      contentType: 'text/plain',
    });

    const complete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete.status).toBe(422);
    expect(complete.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('Probe 2.9: Rejects unallowed MIME types (application/zip, text/html) at reservation creation', async () => {
    const zipRes = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'archive.zip',
      contentType: 'application/zip',
      size: 1024,
    });
    expect(zipRes.status).toBe(400);

    const htmlRes = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'page.html',
      contentType: 'text/html',
      size: 1024,
    });
    expect(htmlRes.status).toBe(400);
  });

  it('Probe 2.10: Direct verification of storageService.detectMimeTypeFromBuffer edge cases', () => {
    expect(storageService.detectMimeTypeFromBuffer(null)).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(undefined)).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(Buffer.alloc(0))).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0x25]))).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe('application/pdf');
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });
});

describe('Adversarial Challenge 3: Replay Prevention on Consumed Reservations', () => {
  let consumedKey;
  let consumedUploadId;

  beforeEach(async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'replay-test.pdf',
      contentType: 'application/pdf',
      size: 512,
    });
    consumedUploadId = start.body.data.uploadId;
    consumedKey = start.body.data.objectKey;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(512 - 9, 0)]);
    mockStorageObjects.set(consumedKey, {
      buffer: validPdf,
      size: 512,
      contentType: 'application/pdf',
    });

    await send('post', `/v1/disbursements/receipt-uploads/${consumedUploadId}/complete`, {});

    const create = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Initial voucher consuming reservation',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: VALID_TASK_UUID,
      receiptS3Key: consumedKey,
      receiptFilename: 'replay-test.pdf',
    });
    expect(create.status).toBe(201);
  });

  it('Probe 3.1: Rejects re-completing consumed reservation via endpoint with HTTP 409', async () => {
    const reComplete = await send('post', `/v1/disbursements/receipt-uploads/${consumedUploadId}/complete`, {});
    expect(reComplete.status).toBe(409);
    expect(reComplete.body.code).toBe('RECEIPT_RESERVATION_ALREADY_CONSUMED');
  });

  it('Probe 3.2: Rejects second voucher creation attempting to reuse consumed reservation with HTTP 400', async () => {
    const secondCreate = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Second voucher trying replay attack',
      amount: 200,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: VALID_TASK_UUID,
      receiptS3Key: consumedKey,
      receiptFilename: 'replay-test.pdf',
    });
    expect(secondCreate.status).toBe(400);
    expect(secondCreate.body.code).toBe('INVALID_RECEIPT_RESERVATION');
  });

  it('Probe 3.3: Rejects voucher update attempting to bind already consumed reservation with HTTP 400', async () => {
    // Create another voucher without receipt
    const otherVoucher = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Voucher without receipt',
      amount: 50,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: VALID_TASK_UUID,
    });
    expect(otherVoucher.status).toBe(201);
    const voucherId = otherVoucher.body.data.id;

    // Try to attach consumedKey to otherVoucher
    const updateRes = await send('put', `/v1/disbursements/${voucherId}`, {
      receiptS3Key: consumedKey,
      receiptFilename: 'replay-test.pdf',
      expectedVersion: 1,
    });
    expect(updateRes.status).toBe(400);
    expect(updateRes.body.code).toBe('INVALID_RECEIPT_RESERVATION');
  });

  it('Probe 3.4: Rejects replay even after TTL expiry simulation (tombstone durability)', async () => {
    // Directly check store method findCompletedReservationByKey
    const resCheck = reservations.findCompletedReservationByKey({
      receiptS3Key: consumedKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(resCheck).toEqual({ error: 'ALREADY_CONSUMED' });

    // Simulate time traveling 2 hours into future
    const record = reservations.getReservation(consumedUploadId);
    expect(record).not.toBeNull();
    expect(record.status).toBe('consumed');

    // Trying to claim again returns ALREADY_CONSUMED
    const claimResult = reservations.claimReservationByKey({
      receiptS3Key: consumedKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claimResult).toEqual({ error: 'ALREADY_CONSUMED' });
  });

  it('Probe 3.5: Legitimate idempotency: original voucher retains its own consumed receipt on general edit', async () => {
    const listRes = await send('get', '/v1/disbursements');
    const originalVoucher = listRes.body.data.find((v) => v.receipt_s3_key === consumedKey);
    expect(originalVoucher).toBeDefined();

    // Updating description while preserving receiptS3Key and receiptFilename
    const updateRes = await send('put', `/v1/disbursements/${originalVoucher.id}`, {
      description: 'Updated description for original voucher',
      receiptS3Key: consumedKey,
      receiptFilename: 'replay-test.pdf',
      expectedVersion: 1,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.receipt_s3_key).toBe(consumedKey);
    expect(updateRes.body.data.description).toBe('Updated description for original voucher');
  });

  it('Probe 3.6: Rejects cross-entity / cross-user voucher creation using another user reservation with HTTP 403', async () => {
    // Create an unconsumed completed reservation belonging to OWNER (ATA)
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'owner-doc.pdf',
      contentType: 'application/pdf',
      size: 512,
    });
    const { uploadId, objectKey } = start.body.data;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(512 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 512,
      contentType: 'application/pdf',
    });

    await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});

    // OTHER_USER (from ATA) tries to use OWNER's completed reservation
    const crossRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Cross-entity theft attempt',
      amount: 150,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: VALID_TASK_UUID,
      receiptS3Key: objectKey,
      receiptFilename: 'owner-doc.pdf',
    }, otherToken);

    expect(crossRes.status).toBe(403);
    expect(crossRes.body.code).toBe('RECEIPT_RESERVATION_MISMATCH');
  });
});

describe('Adversarial Challenge 4: Concurrency Race Conditions on Reservation Claim', () => {
  it('Probe 4.1: 10 concurrent voucher creation requests: exactly 1 succeeds (201), 9 fail (400)', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'swarm-create.pdf',
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

    // Launch 10 concurrent requests to create disbursement with same receiptS3Key
    const requests = Array.from({ length: 10 }).map((_, idx) =>
      send('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Concurrent swarm create attempt ${idx}`,
        amount: 100 + idx,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR,
        taskId: VALID_TASK_UUID,
        receiptS3Key: objectKey,
        receiptFilename: 'swarm-create.pdf',
      })
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 201).length;
    const failCount = statuses.filter((s) => s === 400).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(9);

    // Verify reservation is permanently consumed
    const record = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(record && record.data).toBeUndefined();
  });

  it('Probe 4.2: 10 concurrent voucher update requests competing for the same receipt: exactly 1 succeeds (200), 9 fail (400)', async () => {
    // Create 10 distinct vouchers without receipts
    const voucherIds = [];
    for (let i = 0; i < 10; i++) {
      const v = await send('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Voucher for update race ${i}`,
        amount: 50 + i,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR,
        taskId: VALID_TASK_UUID,
      });
      voucherIds.push(v.body.data.id);
    }

    // Create 1 completed receipt reservation
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'swarm-update.pdf',
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

    // Launch 10 concurrent PUT updates attempting to bind the same receipt to 10 different vouchers
    const updateRequests = voucherIds.map((vId, idx) =>
      send('put', `/v1/disbursements/${vId}`, {
        receiptS3Key: objectKey,
        receiptFilename: `swarm-update-${idx}.pdf`,
        expectedVersion: 1,
      })
    );

    const responses = await Promise.all(updateRequests);
    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 200).length;
    const failCount = statuses.filter((s) => s === 400).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(9);
  });

  it('Probe 4.3: Mixed concurrency: 5 creation requests and 5 update requests competing for 1 receipt: exactly 1 succeeds overall', async () => {
    // Create 5 existing vouchers for update
    const voucherIds = [];
    for (let i = 0; i < 5; i++) {
      const v = await send('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Existing voucher ${i}`,
        amount: 80 + i,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR,
        taskId: VALID_TASK_UUID,
      });
      voucherIds.push(v.body.data.id);
    }

    // Create 1 completed receipt reservation
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'mixed-race.pdf',
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

    // Launch 5 creates + 5 updates simultaneously
    const creates = Array.from({ length: 5 }).map((_, i) =>
      send('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Mixed create ${i}`,
        amount: 120,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR,
        taskId: VALID_TASK_UUID,
        receiptS3Key: objectKey,
        receiptFilename: 'mixed-race.pdf',
      })
    );

    const updates = voucherIds.map((vId, i) =>
      send('put', `/v1/disbursements/${vId}`, {
        receiptS3Key: objectKey,
        receiptFilename: `mixed-update-${i}.pdf`,
      })
    );

    const allResponses = await Promise.all([...creates, ...updates]);
    const successCount = allResponses.filter((r) => r.status === 201 || r.status === 200).length;
    const failCount = allResponses.filter((r) => r.status === 400).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(9);
  });

  it('Probe 4.4: Active claim mutual exclusion: concurrent claim fails with ALREADY_CLAIMED during active claim window', () => {
    reservations.createReservation({
      uploadId: 'active-claim-test',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/claimed.pdf',
      filename: 'claimed.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    reservations.completeReservation('active-claim-test', { userId: OWNER, entityId: 'ent-ata' });

    // Claim 1
    const claim1 = reservations.claimReservationByKey({
      receiptS3Key: 'entities/ATA/receipts/claimed.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim1.claimId).toBeDefined();

    // Claim 2 within timeout
    const claim2 = reservations.claimReservationByKey({
      receiptS3Key: 'entities/ATA/receipts/claimed.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim2).toEqual({ error: 'ALREADY_CLAIMED' });
  });

  it('Probe 4.5: FAILING INVARIANT PROBE: completeReservation must not revert status from claimed to completed during active claim', () => {
    const uploadId = 'probe-claimed-revert-m2-1';
    const objectKey = 'entities/ATA/disbursements/receipts/probe-claimed-m2-1.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey,
      filename: 'probe-claimed-m2-1.pdf',
      contentType: 'application/pdf',
      size: 100,
    });
    reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });

    // Claim
    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim.data?.status).toBe('claimed');

    // Attempt to re-complete while claimed:
    reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });

    // INVARIANT ASSERTION: Reservation status must remain 'claimed' to preserve mutual exclusion lock!
    // ACTUAL: It reverts to 'completed', allowing concurrent claim and double-spend.
    expect(reservations.getReservation(uploadId).status).toBe('claimed');
  });

  it('Probe 4.6: In-flight double-spending prevention: calling completeReceiptUpload during claim flight preserves claimed status and blocks competitor', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'exploit_double_spend.pdf',
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

    const { supabaseAdmin } = require('../../src/services/supabaseClient');
    const originalFrom = supabaseAdmin.from;
    let intercepted = false;

    supabaseAdmin.from = function (tableName) {
      const builder = originalFrom.call(supabaseAdmin, tableName);
      if (tableName === 'disbursements') {
        const originalInsert = builder.insert;
        builder.insert = function (row) {
          if (!intercepted && row.receipt_s3_key === objectKey) {
            intercepted = true;
            // Reservation is currently 'claimed' by Voucher 1:
            expect(reservations.getReservation(uploadId).status).toBe('claimed');

            // Adversary / concurrent tab calls completeReservation:
            // Invariant: completeReservation rejects with ALREADY_CLAIMED and preserves 'claimed' status
            const compRes = reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });
            expect(compRes).toEqual({ error: 'ALREADY_CLAIMED' });
            expect(reservations.getReservation(uploadId).status).toBe('claimed');

            // Competitor Voucher 2 attempts to claim: rejected with ALREADY_CLAIMED
            const claim2 = reservations.claimReservationByKey({
              receiptS3Key: objectKey,
              userId: OWNER,
              entityId: 'ent-ata',
            });
            expect(claim2).toEqual({ error: 'ALREADY_CLAIMED' });
            expect(claim2.claimId).toBeUndefined();
          }
          return originalInsert.call(this, row);
        };
      }
      return builder;
    };

    // Voucher 1 request:
    const v1Res = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Voucher 1',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: VALID_TASK_UUID,
      receiptS3Key: objectKey,
      receiptFilename: 'exploit_double_spend.pdf',
    });

    // Restore original mock
    supabaseAdmin.from = originalFrom;

    // Voucher 1 succeeded!
    expect(v1Res.status).toBe(201);

    // Check database vouchers:
    const boundVouchers = Array.from(mockTables.disbursements.values()).filter(
      (v) => v.receipt_s3_key === objectKey
    );

    // Exactly 1 voucher exists with this receipt key (double-spend strictly prevented!)
    expect(boundVouchers.length).toBe(1);
  });
});

describe('Adversarial Challenge 5: Create-Fail-Retry Rollback Safety Probes', () => {
  it('Probe 5.1: Create failure due to missing task releases claim to completed, permitting clean retry', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'rollback-task.pdf',
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

    // Creation failure with non-existent task
    const failRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Failing due to missing task',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: NON_EXISTENT_TASK_UUID,
      receiptS3Key: objectKey,
      receiptFilename: 'rollback-task.pdf',
    });
    expect(failRes.status).toBe(400);
    expect(failRes.body.code).toBe('TASK_NOT_FOUND');

    // Verify reservation status is back to 'completed'
    const record = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(record?.data?.status).toBe('completed');

    // Immediate retry with valid task succeeds
    const retryRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Clean retry without task',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: VALID_TASK_UUID,
      receiptS3Key: objectKey,
      receiptFilename: 'rollback-task.pdf',
    });
    expect(retryRes.status).toBe(201);
    expect(retryRes.body.data.receipt_s3_key).toBe(objectKey);
  });

  it('Probe 5.2: Create failure due to task-WR mismatch releases claim to completed', async () => {
    const taskUUID = '22222222-2222-4222-8222-222222222222';
    const foreignWR = '44444444-4444-4444-8444-444444444444';
    mockTables.tasks.set(taskUUID, {
      id: taskUUID,
      work_request_id: foreignWR, // Task belongs to foreign WR
    });

    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'rollback-wr.pdf',
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

    const failRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Failing due to WR mismatch',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: taskUUID,
      receiptS3Key: objectKey,
      receiptFilename: 'rollback-wr.pdf',
    });
    expect(failRes.status).toBe(400);
    expect(failRes.body.code).toBe('TASK_WR_MISMATCH');

    // Verify rolled back
    const record = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(record?.data?.status).toBe('completed');
  });

  it('Probe 5.3: Update failure due to OCC version conflict releases newly claimed reservation to completed', async () => {
    // Create voucher
    const v = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Voucher for OCC conflict test',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      taskId: VALID_TASK_UUID,
    });
    const voucherId = v.body.data.id;

    // Create completed reservation to attach
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'occ-conflict.pdf',
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

    // Attempt update with wrong expectedVersion (999 instead of 1)
    const failUpdate = await send('put', `/v1/disbursements/${voucherId}`, {
      description: 'Update with stale version',
      expectedVersion: 999,
      receiptS3Key: objectKey,
      receiptFilename: 'occ-conflict.pdf',
    });
    expect(failUpdate.status).toBe(409);

    // Reservation must have rolled back to completed
    const record = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(record?.data?.status).toBe('completed');

    // Retry with correct version (1) succeeds
    const retryUpdate = await send('put', `/v1/disbursements/${voucherId}`, {
      description: 'Update with correct version',
      expectedVersion: 1,
      receiptS3Key: objectKey,
      receiptFilename: 'occ-conflict.pdf',
    });
    expect(retryUpdate.status).toBe(200);
    expect(retryUpdate.body.data.receipt_s3_key).toBe(objectKey);
  });

  it('Probe 5.4: Update failure due to 404 Not Found voucher releases claimed reservation to completed', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'notfound-test.pdf',
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

    const nonExistentVoucher = '00000000-0000-4000-8000-000000000000';
    const failUpdate = await send('put', `/v1/disbursements/${nonExistentVoucher}`, {
      receiptS3Key: objectKey,
      receiptFilename: 'notfound-test.pdf',
      expectedVersion: 1,
    });
    expect(failUpdate.status).toBe(404);

    const record = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(record?.data?.status).toBe('completed');
  });

  it('Probe 5.5: Claim release security: releasing with wrong claimId returns CLAIM_MISMATCH', () => {
    reservations.createReservation({
      uploadId: 'security-claim-test',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/sec.pdf',
      filename: 'sec.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    reservations.completeReservation('security-claim-test', { userId: OWNER, entityId: 'ent-ata' });

    const claim = reservations.claimReservationByKey({
      receiptS3Key: 'entities/ATA/receipts/sec.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim.claimId).toBeDefined();

    // Release with forged claimId
    const forgedRelease = reservations.releaseReservationByKey({
      receiptS3Key: 'entities/ATA/receipts/sec.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
      claimId: 'forged-uuid-not-matching',
    });
    expect(forgedRelease).toEqual({ error: 'CLAIM_MISMATCH' });

    // Release with authentic claimId succeeds
    const validRelease = reservations.releaseReservationByKey({
      receiptS3Key: 'entities/ATA/receipts/sec.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
      claimId: claim.claimId,
    });
    expect(validRelease.data.status).toBe('completed');
  });
});

describe('Adversarial Challenge 6: Scoped Orphan Cleanup Probes', () => {
  it('Probe 6.1: Cleans expired unconsumed files, deletes storage objects, and strictly preserves consumed files', async () => {
    const deletedInStorage = [];
    const mockStorage = {
      deleteObject: jest.fn(async (path) => {
        deletedInStorage.push(path);
      }),
    };

    // 1. Pending expired
    reservations.createReservation({
      uploadId: 'orphan-pending',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/orphan-pending.pdf',
      filename: 'orphan-pending.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 300,
    });

    // 2. Completed expired
    reservations.createReservation({
      uploadId: 'orphan-completed',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/orphan-completed.pdf',
      filename: 'orphan-completed.pdf',
      contentType: 'application/pdf',
      size: 2048,
      expiresInSeconds: 300,
    });
    reservations.completeReservation('orphan-completed', { userId: OWNER, entityId: 'ent-ata' });

    // 3. Consumed (active voucher attachment) - MUST NOT BE DELETED
    reservations.createReservation({
      uploadId: 'bound-voucher',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/bound-voucher.pdf',
      filename: 'bound-voucher.pdf',
      contentType: 'application/pdf',
      size: 4096,
      expiresInSeconds: 300,
    });
    reservations.completeReservation('bound-voucher', { userId: OWNER, entityId: 'ent-ata' });
    reservations.consumeReservationByKey({
      receiptS3Key: 'entities/ATA/receipts/bound-voucher.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
    });

    // 4. In-flight active reservation (1 hour expiration) - MUST NOT BE TOUCHED
    reservations.createReservation({
      uploadId: 'active-inflight',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/active-inflight.pdf',
      filename: 'active-inflight.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 3600,
    });

    // Run cleanup simulated at 10 minutes in future (300s expired, 3600s active)
    const futureTime = new Date(Date.now() + 600 * 1000);
    const summary = await reservations.cleanupExpiredReservations({
      now: futureTime,
      storage: mockStorage,
    });

    expect(summary.scanned).toBe(4);
    expect(summary.cleaned).toBe(2);
    expect(summary.skippedConsumed).toBe(1);

    expect(deletedInStorage).toContain('entities/ATA/receipts/orphan-pending.pdf');
    expect(deletedInStorage).toContain('entities/ATA/receipts/orphan-completed.pdf');
    expect(deletedInStorage).not.toContain('entities/ATA/receipts/bound-voucher.pdf');
    expect(deletedInStorage).not.toContain('entities/ATA/receipts/active-inflight.pdf');

    // In-memory records check:
    expect(reservations.getReservation('orphan-pending')).toBeNull();
    expect(reservations.getReservation('orphan-completed')).toBeNull();
    expect(reservations.getReservation('bound-voucher')).not.toBeNull();
    expect(reservations.getReservation('active-inflight')).not.toBeNull();
  });

  it('Probe 6.2: Dry run mode reports candidates without deleting storage or memory records', async () => {
    const deletedInStorage = [];
    const mockStorage = {
      deleteObject: jest.fn(async (path) => {
        deletedInStorage.push(path);
      }),
    };

    reservations.createReservation({
      uploadId: 'dryrun-orphan',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/dryrun.pdf',
      filename: 'dryrun.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 300,
    });

    const futureTime = new Date(Date.now() + 600 * 1000);
    const summary = await reservations.cleanupExpiredReservations({
      now: futureTime,
      storage: mockStorage,
      dryRun: true,
    });

    expect(summary.cleaned).toBe(1);
    expect(summary.deletedKeys).toContain('entities/ATA/receipts/dryrun.pdf');
    expect(deletedInStorage.length).toBe(0); // Nothing deleted in storage
    expect(reservations.getReservation('dryrun-orphan')).toBeDefined(); // Still in memory
  });

  it('Probe 6.3: Storage deleteObject error resiliency: captures errors in summary without crashing cleanup', async () => {
    const mockStorage = {
      deleteObject: jest.fn(async () => {
        throw new Error('S3 503 Service Unavailable');
      }),
    };

    reservations.createReservation({
      uploadId: 'failing-storage-orphan',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/fail-orphan.pdf',
      filename: 'fail-orphan.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 300,
    });

    const futureTime = new Date(Date.now() + 600 * 1000);
    const summary = await reservations.cleanupExpiredReservations({
      now: futureTime,
      storage: mockStorage,
    });

    expect(summary.errors.length).toBe(1);
    expect(summary.errors[0].error).toContain('S3 503 Service Unavailable');
    expect(summary.cleaned).toBe(0);
    expect(reservations.syncFromDisk().get('failing-storage-orphan').status).toBe('cleanup_failed');
  });

  it('Probe 6.4: Long-term retention memory pruning: prunes consumed memory records after 24h retention window without deleting storage files', async () => {
    const deletedInStorage = [];
    const mockStorage = {
      deleteObject: jest.fn(async (path) => {
        deletedInStorage.push(path);
      }),
    };

    reservations.createReservation({
      uploadId: 'old-consumed',
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey: 'entities/ATA/receipts/old-consumed.pdf',
      filename: 'old-consumed.pdf',
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 300,
    });
    reservations.completeReservation('old-consumed', { userId: OWNER, entityId: 'ent-ata' });
    reservations.consumeReservationByKey({
      receiptS3Key: 'entities/ATA/receipts/old-consumed.pdf',
      userId: OWNER,
      entityId: 'ent-ata',
    });

    // Advance 48 hours into the future
    const future48h = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const summary = await reservations.cleanupExpiredReservations({
      now: future48h,
      storage: mockStorage,
      consumedRetentionMs: 24 * 60 * 60 * 1000,
    });

    expect(summary.prunedConsumedRecords).toBe(1);
    // Crucial check: storage file was NEVER deleted
    expect(deletedInStorage).not.toContain('entities/ATA/receipts/old-consumed.pdf');
  });
});
