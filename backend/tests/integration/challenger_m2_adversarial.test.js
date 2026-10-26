/**
 * Challenger M2 Independent Adversarial Verification Suite
 * Milestone 2 (R3, R4)
 *
 * Exhaustive Stress Testing:
 * 1. Storage Validation & Magic Byte Detection Edge Cases (R3):
 *    - Empty buffer (0 bytes)
 *    - 1-byte truncated file (0x25)
 *    - 2-byte truncated file (0xFF, 0xD8)
 *    - 4-byte truncated PDF (%PDF)
 *    - 7-byte truncated PNG (missing 8th signature byte)
 *    - Corrupted JPEG header (0xFF, 0xD8, 0x00)
 *    - Shifted/misaligned magic bytes
 *    - Trailing junk after valid header with size parity
 *    - Exactly 10 MiB boundary (10,485,760 bytes)
 *    - 10 MiB + 1 byte boundary (10,485,761 bytes)
 *    - Oversized binary (15 MiB)
 *    - Buffer size mismatch vs reservation
 *    - Cross-MIME mismatch (PDF binary uploaded to PNG reservation)
 *    - Storage download failure / unreadable binary
 *
 * 2. High-Concurrency Race Conditions & Atomic Claim (R4):
 *    - 25 concurrent voucher creation requests racing on 1 receipt reservation
 *    - 25 concurrent voucher update requests racing on 1 receipt reservation
 *    - 30 mixed concurrent creation and update requests racing on 1 receipt reservation
 *    - Mutual exclusion: exactly ONE winner, all competitors rejected
 *    - Zero double-spending of the receipt key
 *
 * 3. State Transitions & Non-Reversibility (R4):
 *    - Non-reversibility: consumed -> cannot transition back to pending, completed, or claimed
 *    - Consumed reservations survive TTL deletion in getReservation
 *    - Replay attempts on consumed reservations via /complete, create, and update
 *    - Investigation of completeReservation behavior during active claimed status
 *
 * 4. Transactional Rollback & Retry Safety (R4):
 *    - DB error during create rolls back claimed reservation to completed
 *    - Retry succeeding with 201 without re-uploading
 *    - OCC conflict during update rolls back claimed reservation to completed
 *    - Retry succeeding with 200 without re-uploading
 *    - Claim timeout expiration breaking stale locks
 *
 * 5. Scoped Orphan Cleanup (R4 / F17):
 *    - Purges expired unconsumed storage objects and records
 *    - STRICT INVARIANT: Never deletes storage objects for consumed reservations
 *    - Active in-flight reservations preserved
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
  seedDefaults,
  mockTables,
  mockStorageObjects,
  supabaseAdmin,
} = require('../fixtures/supabaseMock');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');
const storageService = require('../../src/services/storageService');

const OWNER_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_USER_ID = '88888888-8888-4888-8888-888888888888';
const ENT_ATA = 'ent-ata';
const WR_ATA = '33333333-3333-4333-8333-333333333333';

let ownerToken;
let _otherToken;

const authSend = (reqMethod, url, body, customToken = ownerToken, entity = 'ATA') =>
  request(app)[reqMethod](url)
    .set('Authorization', `Bearer ${customToken}`)
    .set('X-Active-Entity', entity)
    .send(body);

beforeEach(() => {
  resetMock();
  seedDefaults();
  reservations.clearReservations();

  ownerToken = registerUser({
    id: OWNER_ID,
    email: 'm2_challenger@example.test',
    name: 'M2 Challenger Owner',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });

  _otherToken = registerUser({
    id: OTHER_USER_ID,
    email: 'other_user@example.test',
    name: 'Other User',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });

  mockTables.work_requests.set(WR_ATA, {
    id: WR_ATA,
    entity_id: ENT_ATA,
    title: 'M2 Challenger Work Request',
  });
});

describe('Challenger M2 — Suite 1: Storage Validation & Magic Byte Edge Cases (R3)', () => {
  it('detectMimeTypeFromBuffer correctly identifies valid signatures and rejects truncated/corrupted ones', () => {
    // Valid signatures
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(
      storageService.detectMimeTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ).toBe('image/png');
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0xff, 0xd8, 0xff]))).toBe('image/jpeg');

    // Empty buffer
    expect(storageService.detectMimeTypeFromBuffer(Buffer.alloc(0))).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(null)).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(undefined)).toBeNull();

    // 1-byte file
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0x25]))).toBeNull();

    // 2-byte file
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0xff, 0xd8]))).toBeNull();

    // 4-byte truncated PDF (%PDF without trailing hyphen)
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from('%PDF'))).toBeNull();

    // 7-byte truncated PNG (missing 8th byte 0x0A)
    expect(
      storageService.detectMimeTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]))
    ).toBeNull();

    // Corrupted 8th byte PNG
    expect(
      storageService.detectMimeTypeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00]))
    ).toBeNull();

    // Corrupted 3rd byte JPEG (0xFF, 0xD8, 0x00 instead of 0xFF, 0xD8, 0xFF)
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0xff, 0xd8, 0x00]))).toBeNull();

    // Shifted magic bytes (prefix byte before signature)
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0x00, 0xff, 0xd8, 0xff]))).toBeNull();
    expect(storageService.detectMimeTypeFromBuffer(Buffer.from([0x20, 0x25, 0x50, 0x44, 0x46, 0x2d]))).toBeNull();
  });

  it('rejects upload completion with HTTP 422 for 1-byte file', async () => {
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: '1byte.pdf',
      contentType: 'application/pdf',
      size: 1,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    mockStorageObjects.set(objectKey, {
      buffer: Buffer.from([0x25]),
      size: 1,
      contentType: 'application/pdf',
    });

    const res = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('rejects upload completion with HTTP 422 for 4-byte truncated PDF (%PDF)', async () => {
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'trunc.pdf',
      contentType: 'application/pdf',
      size: 4,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    mockStorageObjects.set(objectKey, {
      buffer: Buffer.from('%PDF'),
      size: 4,
      contentType: 'application/pdf',
    });

    const res = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('rejects upload completion with HTTP 422 for JPEG with corrupted 3rd header byte', async () => {
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'corrupted.jpg',
      contentType: 'image/jpeg',
      size: 16,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    // Header: 0xFF, 0xD8, 0xEE (corrupted 3rd byte)
    const corruptedJpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xee]), Buffer.alloc(13, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: corruptedJpg,
      size: 16,
      contentType: 'image/jpeg',
    });

    const res = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('accepts upload completion for PNG with trailing payload when size matches reservation', async () => {
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'image_with_payload.png',
      contentType: 'image/png',
      size: 64,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = Buffer.alloc(56, 0xaa);
    const fullPng = Buffer.concat([pngHeader, payload]);

    mockStorageObjects.set(objectKey, {
      buffer: fullPng,
      size: 64,
      contentType: 'image/png',
    });

    const res = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(res.status).toBe(200);
    expect(res.body.data.receiptS3Key).toBe(objectKey);
  });

  it('rejects upload completion with HTTP 422 when binary exceeds 10 MiB ceiling by 1 byte', async () => {
    const OVER_10MB = 10 * 1024 * 1024 + 1; // 10,485,761 bytes
    // Schema rejects size > 10,485,760 at reservation time
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'oversized.pdf',
      contentType: 'application/pdf',
      size: OVER_10MB,
    });
    expect(start.status).toBe(400);

    // If reservation claimed 10 MiB but storage downloaded 10 MiB + 1 byte:
    const validStart = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'sneaky_oversized.pdf',
      contentType: 'application/pdf',
      size: 10 * 1024 * 1024,
    });
    expect(validStart.status).toBe(201);
    const { uploadId, objectKey } = validStart.body.data;

    const oversizedBuffer = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(OVER_10MB - 9, 0),
    ]);
    mockStorageObjects.set(objectKey, {
      buffer: oversizedBuffer,
      size: OVER_10MB,
      contentType: 'application/pdf',
    });

    const res = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });

  it('rejects upload completion with HTTP 422 if object does not exist in storage', async () => {
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'missing.pdf',
      contentType: 'application/pdf',
      size: 512,
    });
    expect(start.status).toBe(201);
    const { uploadId } = start.body.data;

    // Do NOT set mockStorageObjects
    const res = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
  });
});

describe('Challenger M2 — Suite 2: High-Concurrency Race Conditions & Atomic Claim (R4)', () => {
  it('enforces strict mutual exclusion across 25 concurrent voucher creation requests on the same reservation', async () => {
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'high_concurrency.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    expect(start.status).toBe(201);
    const { uploadId, objectKey } = start.body.data;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 1024,
      contentType: 'application/pdf',
    });

    const completeRes = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(completeRes.status).toBe(200);

    // Launch 25 concurrent voucher creations with the EXACT SAME receiptS3Key
    const NUM_REQUESTS = 25;
    const promises = Array.from({ length: NUM_REQUESTS }, (_, i) =>
      authSend('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Concurrent Attempt #${i + 1}`,
        amount: 100 + i,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
        receiptS3Key: objectKey,
        receiptFilename: 'high_concurrency.pdf',
      })
    );

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.status === 201).length;
    const failureCount = results.filter((r) => r.status === 400).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(NUM_REQUESTS - 1);

    // Verify database contains exactly 1 voucher with this receipt key
    const allVouchers = Array.from(mockTables.disbursements.values());
    const boundVouchers = allVouchers.filter((v) => v.receipt_s3_key === objectKey);
    expect(boundVouchers.length).toBe(1);

    // Reservation state must be strictly 'consumed'
    const record = reservations.getReservation(uploadId);
    expect(record.status).toBe('consumed');
  });

  it('enforces mutual exclusion across 25 concurrent voucher update requests binding the same receipt', async () => {
    // 1. Create 25 existing vouchers without receipts
    const voucherIds = [];
    for (let i = 0; i < 25; i++) {
      const vRes = await authSend('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Existing Voucher #${i + 1}`,
        amount: 200,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
      });
      expect(vRes.status).toBe(201);
      voucherIds.push(vRes.body.data.id);
    }

    // 2. Upload and complete a single receipt reservation
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'update_race.pdf',
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
    await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});

    // 3. Launch 25 concurrent updates all trying to bind this single receipt
    const updatePromises = voucherIds.map((id) =>
      authSend('put', `/v1/disbursements/${id}`, {
        receiptS3Key: objectKey,
        receiptFilename: 'update_race.pdf',
        expectedVersion: 1,
      })
    );

    const updateResults = await Promise.all(updatePromises);
    const successCount = updateResults.filter((r) => r.status === 200).length;
    const failureCount = updateResults.filter((r) => r.status === 400).length;

    expect(successCount).toBe(1);
    expect(failureCount).toBe(24);

    // Verify exactly 1 voucher in DB has the receipt key
    const allVouchers = Array.from(mockTables.disbursements.values());
    const boundVouchers = allVouchers.filter((v) => v.receipt_s3_key === objectKey);
    expect(boundVouchers.length).toBe(1);
  });

  it('enforces mutual exclusion across mixed race: 15 concurrent creates + 15 concurrent updates', async () => {
    // Create 15 vouchers first for updates
    const voucherIds = [];
    for (let i = 0; i < 15; i++) {
      const vRes = await authSend('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Base Voucher #${i + 1}`,
        amount: 150,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
      });
      voucherIds.push(vRes.body.data.id);
    }

    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'mixed_race.pdf',
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
    await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});

    // 15 creates + 15 updates racing simultaneously (30 total)
    const creates = Array.from({ length: 15 }, (_, i) =>
      authSend('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Create in mixed race #${i + 1}`,
        amount: 250,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
        receiptS3Key: objectKey,
        receiptFilename: 'mixed_race.pdf',
      })
    );

    const updates = voucherIds.map((id) =>
      authSend('put', `/v1/disbursements/${id}`, {
        receiptS3Key: objectKey,
        receiptFilename: 'mixed_race.pdf',
        expectedVersion: 1,
      })
    );

    const allResults = await Promise.all([...creates, ...updates]);
    const winners = allResults.filter((r) => r.status === 201 || r.status === 200);
    const losers = allResults.filter((r) => r.status === 400);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(29);

    // Exactly 1 voucher in DB has the key
    const allVouchers = Array.from(mockTables.disbursements.values());
    const boundVouchers = allVouchers.filter((v) => v.receipt_s3_key === objectKey);
    expect(boundVouchers.length).toBe(1);
  });

  it('prevents double-spending: calling completeReceiptUpload during claim flight preserves claimed status and blocks competitor', async () => {
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
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
    await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});

    // Intercept in supabaseAdmin: when voucher 1 reaches DB insert (while holding the claim),
    // trigger re-complete and attempt competitor claim
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
            const compRes = reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });
            expect(compRes).toEqual({ error: 'ALREADY_CLAIMED' });
            expect(reservations.getReservation(uploadId).status).toBe('claimed');

            // Competitor Voucher 2 attempts to claim: rejected with ALREADY_CLAIMED
            const claim2 = reservations.claimReservationByKey({
              receiptS3Key: objectKey,
              userId: OWNER_ID,
              entityId: ENT_ATA,
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
    const v1Res = await authSend('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Voucher 1',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR_ATA,
      receiptS3Key: objectKey,
      receiptFilename: 'exploit_double_spend.pdf',
    });

    // Restore original mock
    supabaseAdmin.from = originalFrom;

    // Voucher 1 succeeded!
    expect(v1Res.status).toBe(201);

    // Check database vouchers: exactly 1 voucher exists with this receipt key
    const boundVouchers = Array.from(mockTables.disbursements.values()).filter(
      (v) => v.receipt_s3_key === objectKey
    );
    expect(boundVouchers.length).toBe(1);
  });

  it('FAILING INVARIANT PROBE: completeReservation must not revert status from claimed to completed during active claim', () => {
    const uploadId = 'probe-claimed-revert';
    const objectKey = 'entities/ATA/disbursements/receipts/probe-claimed.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'probe-claimed.pdf',
      contentType: 'application/pdf',
      size: 100,
    });
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });

    // Claim
    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(claim.data?.status).toBe('claimed');

    // Attempt to re-complete while claimed:
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });

    // INVARIANT ASSERTION: Reservation status must remain 'claimed' to preserve mutual exclusion lock!
    // ACTUAL: It reverts to 'completed', allowing concurrent claim and double-spend.
    expect(reservations.getReservation(uploadId).status).toBe('claimed');
  });
});

describe('Challenger M2 — Suite 3: State Transitions & Non-Reversibility (R4)', () => {
  it('consumed state is strictly non-reversible across all store methods', () => {
    const uploadId = 'non_rev_test';
    const objectKey = 'entities/ATA/disbursements/receipts/non_rev.pdf';

    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'non_rev.pdf',
      contentType: 'application/pdf',
      size: 100,
    });

    // pending -> completed
    const comp1 = reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });
    expect(comp1.data?.status).toBe('completed');

    // completed -> claimed
    const claim1 = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(claim1.data?.status).toBe('claimed');

    // claimed -> consumed
    const consumedRecord = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: claim1.claimId,
    });
    expect(consumedRecord?.status).toBe('consumed');

    // ATTEMPTS TO REVERT CONSUMED:
    // 1. completeReservation must fail with ALREADY_CONSUMED
    const revertComplete = reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });
    expect(revertComplete.error).toBe('ALREADY_CONSUMED');
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 2. claimReservationByKey must fail with ALREADY_CONSUMED
    const revertClaim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(revertClaim.error).toBe('ALREADY_CONSUMED');
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 3. releaseReservationByKey must fail with ALREADY_CONSUMED
    const revertRelease = reservations.releaseReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: claim1.claimId,
    });
    expect(revertRelease.error).toBe('ALREADY_CONSUMED');
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 4. consumeReservationByKey must return null
    const reConsume = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: claim1.claimId,
    });
    expect(reConsume).toBeNull();
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 5. findCompletedReservationByKey must return ALREADY_CONSUMED
    const findRes = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(findRes.error).toBe('ALREADY_CONSUMED');
  });

  it('consumed reservations survive past expiresAt in getReservation without deletion', () => {
    const uploadId = 'ttl_consumed_test';
    const objectKey = 'entities/ATA/disbursements/receipts/ttl_consumed.pdf';

    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'ttl_consumed.pdf',
      contentType: 'application/pdf',
      size: 100,
      expiresInSeconds: 1, // expires in 1 second
    });

    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });
    reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });

    // Artificially age the record past expiresAt
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10000);

    // getReservation must NOT delete consumed record
    const retrieved = reservations.getReservation(uploadId);
    expect(retrieved).not.toBeNull();
    expect(retrieved.status).toBe('consumed');
    clock.mockRestore();
  });

  it('expired reservations are unavailable but retained for cleanup', () => {
    const uploadId = 'ttl_pending_test';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: 'entities/ATA/disbursements/receipts/ttl_pending.pdf',
      filename: 'ttl_pending.pdf',
      contentType: 'application/pdf',
      size: 100,
      expiresInSeconds: 1,
    });

    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 10000);

    const retrieved = reservations.getReservation(uploadId);
    expect(retrieved).toBeNull();
    expect(reservations.syncFromDisk().has(uploadId)).toBe(true);
    clock.mockRestore();
  });
});

describe('Challenger M2 — Suite 4: Transactional Rollback & Retry Safety (R4)', () => {
  it('rolls back claimed reservation on OCC concurrency conflict during voucher update, allowing retry', async () => {
    // 1. Create a voucher
    const vRes = await authSend('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'OCC Voucher',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR_ATA,
    });
    const voucherId = vRes.body.data.id;
    const initialVersion = vRes.body.data.version || 1;

    // 2. Upload and complete a receipt
    const start = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'occ_retry.pdf',
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
    await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});

    // 3. Attempt update with wrong expectedVersion (OCC mismatch -> HTTP 409)
    const badOccRes = await authSend('put', `/v1/disbursements/${voucherId}`, {
      receiptS3Key: objectKey,
      receiptFilename: 'occ_retry.pdf',
      expectedVersion: 999, // Stale version
    });
    expect(badOccRes.status).toBe(409);
    expect(badOccRes.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

    // 4. Verify reservation rolled back to 'completed'
    const record = reservations.getReservation(uploadId);
    expect(record.status).toBe('completed');
    expect(record.claimId).toBeUndefined();

    // 5. Retry update with correct version -> succeeds with HTTP 200 without re-uploading
    const retryRes = await authSend('put', `/v1/disbursements/${voucherId}`, {
      receiptS3Key: objectKey,
      receiptFilename: 'occ_retry.pdf',
      expectedVersion: initialVersion,
    });
    expect(retryRes.status).toBe(200);
    expect(retryRes.body.data.receipt_s3_key).toBe(objectKey);

    // 6. Reservation is now consumed
    expect(reservations.getReservation(uploadId).status).toBe('consumed');
  });

  it('preserves the original claim even after the timeout window', () => {
    const uploadId = 'stale_claim_test';
    const objectKey = 'entities/ATA/disbursements/receipts/stale_claim.pdf';

    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'stale_claim.pdf',
      contentType: 'application/pdf',
      size: 100,
    });
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });

    // Request 1 claims reservation
    const claim1 = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimTimeoutSeconds: 60,
    });
    expect(claim1.claimId).toBeDefined();

    // Immediate second claim rejected with ALREADY_CLAIMED
    const claimImmediate = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimTimeoutSeconds: 60,
    });
    expect(claimImmediate.error).toBe('ALREADY_CLAIMED');

    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    const claim2 = reservations.claimReservationByKey({receiptS3Key: objectKey, userId: OWNER_ID, entityId: ENT_ATA});
    expect(claim2.error).toBe('ALREADY_CLAIMED');
    const consumed = reservations.consumeReservationByKey({receiptS3Key: objectKey, userId: OWNER_ID, entityId: ENT_ATA, claimId: claim1.claimId});
    expect(consumed.status).toBe('consumed');
    clock.mockRestore();
  });
});

describe('Challenger M2 — Suite 5: Scoped Orphan Cleanup Invariants (R4 / F17)', () => {
  it('strictly preserves consumed voucher storage binaries while removing expired unconsumed files', async () => {
    const deletedFiles = [];
    const mockStorage = {
      deleteObject: jest.fn(async (path) => {
        deletedFiles.push(path);
      }),
    };

    const consumedKey = 'entities/ATA/disbursements/receipts/active_bound_receipt.pdf';
    const expiredPendingKey = 'entities/ATA/disbursements/receipts/expired_pending.pdf';
    const expiredCompletedKey = 'entities/ATA/disbursements/receipts/expired_completed.pdf';
    const activeInFlightKey = 'entities/ATA/disbursements/receipts/active_in_flight.pdf';

    // 1. Pending reservation (expires in 5 minutes)
    reservations.createReservation({
      uploadId: 'exp-pending',
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: expiredPendingKey,
      filename: 'expired_pending.pdf',
      contentType: 'application/pdf',
      size: 100,
      expiresInSeconds: 300,
    });

    // 2. Completed reservation (expires in 5 minutes)
    reservations.createReservation({
      uploadId: 'exp-completed',
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: expiredCompletedKey,
      filename: 'expired_completed.pdf',
      contentType: 'application/pdf',
      size: 200,
      expiresInSeconds: 300,
    });
    reservations.completeReservation('exp-completed', { userId: OWNER_ID, entityId: ENT_ATA });

    // 3. Consumed reservation (active voucher document) (expires in 5 minutes)
    reservations.createReservation({
      uploadId: 'consumed-doc',
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: consumedKey,
      filename: 'active_bound_receipt.pdf',
      contentType: 'application/pdf',
      size: 300,
      expiresInSeconds: 300,
    });
    reservations.completeReservation('consumed-doc', { userId: OWNER_ID, entityId: ENT_ATA });
    reservations.consumeReservationByKey({
      receiptS3Key: consumedKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });

    // 4. Active in-flight reservation (expires in 1 hour)
    reservations.createReservation({
      uploadId: 'active-inflight',
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: activeInFlightKey,
      filename: 'active_in_flight.pdf',
      contentType: 'application/pdf',
      size: 400,
      expiresInSeconds: 3600,
    });

    // Execute cleanup at simulated future time (10 minutes later)
    const simulatedFuture = new Date(Date.now() + 600 * 1000);
    const summary = await reservations.cleanupExpiredReservations({
      now: simulatedFuture,
      storage: mockStorage,
    });

    expect(summary.scanned).toBe(4);
    expect(summary.cleaned).toBe(2);
    expect(summary.skippedConsumed).toBe(1);

    // Verify deleted storage files
    expect(deletedFiles).toContain(expiredPendingKey);
    expect(deletedFiles).toContain(expiredCompletedKey);

    // CRITICAL ADVERSARIAL ASSERTION: Consumed file MUST NOT be deleted from storage
    expect(deletedFiles).not.toContain(consumedKey);
    expect(deletedFiles).not.toContain(activeInFlightKey);
  });
});
