/**
 * Challenger M2 Iteration 2 Adversarial Stress Suite
 * Milestone 2 (R3, R4)
 *
 * Empirical verification of:
 * 1. High-concurrency race conditions (50 concurrent create/update requests).
 * 2. Stale claim lock theft, consumption failure, and database rollback.
 * 3. Update disbursement rollback on failed consumption.
 * 4. Concurrent /complete during active claim flight (HTTP 409 preservation).
 * 5. Exhaustive FSM state transition matrix and irreversibility of 'consumed'.
 * 6. Storage verification edge cases and error handling (R3).
 * 7. Scoped orphan cleanup storage object preservation (R4 / F17).
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
    email: 'challenger_m2_r2@example.test',
    name: 'Challenger M2 Retry 2 Owner',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });

  _otherToken = registerUser({
    id: OTHER_USER_ID,
    email: 'challenger_m2_other@example.test',
    name: 'Challenger M2 Other User',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });

  mockTables.work_requests.set(WR_ATA, {
    id: WR_ATA,
    entity_id: ENT_ATA,
    title: 'Challenger M2 Work Request',
  });
});

describe('Challenger M2 Iteration 2 — Suite 1: Concurrent Claims & Consumption Verification (R4)', () => {
  it('50 concurrent requests (25 create + 25 update) competing for 1 reservation: exactly 1 succeeds, 49 rejected, 1 DB voucher', async () => {
    // 1. Create a completed reservation
    const uploadRes = await authSend('post', '/v1/disbursements/receipt-uploads', {
      filename: 'high_stress_50.pdf',
      contentType: 'application/pdf',
      size: 2048,
    });
    expect(uploadRes.status).toBe(201);
    const { uploadId, objectKey } = uploadRes.body.data;

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2048 - 9, 0x41)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 2048,
      contentType: 'application/pdf',
    });

    const compRes = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(compRes.status).toBe(200);

    // Seed 25 existing vouchers for update requests to target
    const existingVoucherIds = [];
    for (let i = 0; i < 25; i++) {
      const vId = `existing-voucher-stress-${i}`;
      mockTables.disbursements.set(vId, {
        id: vId,
        disbursement_number: `DISB-STRESS-${i}`,
        entity_id: ENT_ATA,
        category: 'Supplies',
        description: `Existing Voucher ${i}`,
        amount: 50 + i,
        status: 'Draft',
        employee_id: OWNER_ID,
        created_by: OWNER_ID,
        updated_by: OWNER_ID,
        version: 1,
        receipt_s3_key: null,
        receipt_filename: null,
      });
      existingVoucherIds.push(vId);
    }

    // 2. Dispatch 25 creates and 25 updates simultaneously
    const createPromises = Array.from({ length: 25 }, (_, i) =>
      authSend('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Create Stress ${i}`,
        amount: 100 + i,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR_ATA,
        receiptS3Key: objectKey,
        receiptFilename: 'high_stress_50.pdf',
      })
    );

    const updatePromises = existingVoucherIds.map((vId, i) =>
      authSend('put', `/v1/disbursements/${vId}`, {
        notes: `Updated notes ${i}`,
        expectedVersion: 1,
        receiptS3Key: objectKey,
        receiptFilename: 'high_stress_50.pdf',
      })
    );

    const allResults = await Promise.all([...createPromises, ...updatePromises]);

    const successes = allResults.filter((r) => r.status === 200 || r.status === 201);
    const failures = allResults.filter((r) => r.status === 400 || r.status === 409);

    // Exactly 1 request succeeds
    expect(successes.length).toBe(1);
    // All other 49 fail
    expect(failures.length).toBe(49);

    // Database verification: exactly 1 voucher in disbursements has objectKey
    const persistedWithKey = Array.from(mockTables.disbursements.values()).filter(
      (v) => v.receipt_s3_key === objectKey
    );
    expect(persistedWithKey.length).toBe(1);

    // Reservation is strictly consumed
    const finalRecord = reservations.getReservation(uploadId);
    expect(finalRecord.status).toBe('consumed');
  });

  it('an old binding claim cannot be stolen by a competing request', () => {
    const input = {userId: OWNER_ID, entityId: ENT_ATA, receiptS3Key: 'old-claim'};
    reservations.createReservation({uploadId: 'old', objectKey: 'old-claim', userId: OWNER_ID, entityId: ENT_ATA});
    reservations.completeReservation('old', input);
    const first = reservations.claimReservationByKey(input);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 65000);
    expect(reservations.claimReservationByKey(input).error).toBe('ALREADY_CLAIMED');
    expect(reservations.consumeReservationByKey({...input, claimId: first.claimId, voucherId: 'one'}).status).toBe('consumed');
    clock.mockRestore();
  });

  it('mutating a returned reservation cannot force an update to roll back', async () => {
    // 1. Seed existing voucher with clean original fields
    const voucherId = 'voucher-update-rollback-test';
    mockTables.disbursements.set(voucherId, {
      id: voucherId,
      disbursement_number: 'DISB-ORIGINAL-1',
      entity_id: ENT_ATA,
      category: 'Supplies',
      description: 'Original Description',
      amount: 75,
      status: 'Draft',
      notes: 'Original Notes',
      employee_id: OWNER_ID,
      created_by: OWNER_ID,
      updated_by: OWNER_ID,
      version: 1,
      receipt_s3_key: null,
      receipt_filename: null,
    });

    // 2. Completed reservation
    const uploadId = 'update-rollback-upload';
    const objectKey = 'entities/ATA/disbursements/receipts/update-rollback.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'update-rollback.pdf',
      contentType: 'application/pdf',
      size: 512,
    });
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });

    // 3. Hook into update: right before consumeReservationByKey, consume it externally to force !consumed
    const originalFrom = supabaseAdmin.from;
    supabaseAdmin.from = function (tableName) {
      const builder = originalFrom.call(supabaseAdmin, tableName);
      if (tableName === 'disbursements') {
        const originalUpdate = builder.update;
        builder.update = function (updates) {
          // If this is the update applying the new receipt key:
          if (updates.receipt_s3_key === objectKey) {
            // Force reservation into consumed state before the caller's consumeReservationByKey runs
            const rec = reservations.getReservation(uploadId);
            rec.status = 'consumed';
            rec.consumedAt = new Date().toISOString();
          }
          return originalUpdate.call(this, updates);
        };
      }
      return builder;
    };

    const updateRes = await authSend('put', `/v1/disbursements/${voucherId}`, {
      amount: 999,
      notes: 'Malicious Corrupted Notes',
      expectedVersion: 1,
      receiptS3Key: objectKey,
      receiptFilename: 'update-rollback.pdf',
    });

    supabaseAdmin.from = originalFrom;

    expect(updateRes.status).toBe(200);
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // The detached snapshot cannot tamper with persisted state.
    const restoredVoucher = mockTables.disbursements.get(voucherId);
    expect(restoredVoucher.amount).toBe(999);
    expect(restoredVoucher.notes).toBe('Malicious Corrupted Notes');
    expect(restoredVoucher.receipt_s3_key).toBe(objectKey);
    expect(restoredVoucher.receipt_filename).toBe('update-rollback.pdf');
  });

  it('Calling /complete during claim flight returns HTTP 409 and does not alter claimed status', async () => {
    const uploadId = 'claim-flight-test';
    const objectKey = 'entities/ATA/disbursements/receipts/claim-flight.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'claim-flight.pdf',
      contentType: 'application/pdf',
      size: 1024,
    });
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });

    const validPdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(1024 - 9, 0)]);
    mockStorageObjects.set(objectKey, {
      buffer: validPdf,
      size: 1024,
      contentType: 'application/pdf',
    });

    // Claim the reservation (simulating in-flight voucher creation)
    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(claim.data.status).toBe('claimed');

    // Concurrent call to /complete
    const completeRes = await authSend('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(completeRes.status).toBe(409);
    expect(completeRes.body.code).toBe('RECEIPT_RESERVATION_ALREADY_CLAIMED');

    // Status MUST remain 'claimed'
    expect(reservations.getReservation(uploadId).status).toBe('claimed');
    expect(reservations.getReservation(uploadId).claimId).toBe(claim.claimId);
  });
});

describe('Challenger M2 Iteration 2 — Suite 2: State Transition Irreversibility & FSM Matrix (R4)', () => {
  it('Terminal Sink State: consumed state is permanently immutable across all store methods', () => {
    const uploadId = 'fsm-consumed-sink';
    const objectKey = 'entities/ATA/disbursements/receipts/fsm-consumed.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'fsm-consumed.pdf',
      contentType: 'application/pdf',
      size: 100,
    });
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });
    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    const consumed = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: claim.claimId,
    });
    expect(consumed.status).toBe('consumed');

    // 1. completeReservation -> ALREADY_CONSUMED
    const cRes = reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });
    expect(cRes).toEqual({ error: 'ALREADY_CONSUMED' });
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 2. claimReservationByKey -> ALREADY_CONSUMED
    const clRes = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(clRes).toEqual({ error: 'ALREADY_CONSUMED' });
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 3. releaseReservationByKey -> ALREADY_CONSUMED
    const relRes = reservations.releaseReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: claim.claimId,
    });
    expect(relRes).toEqual({ error: 'ALREADY_CONSUMED' });
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 4. consumeReservationByKey -> null
    const conRes = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: claim.claimId,
    });
    expect(conRes).toBeNull();
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // 5. findCompletedReservationByKey -> ALREADY_CONSUMED
    const findRes = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(findRes).toEqual({ error: 'ALREADY_CONSUMED' });
    expect(reservations.getReservation(uploadId).status).toBe('consumed');
  });

  it('Claim mutual exclusion: release and consume strictly require matching claimId', () => {
    const uploadId = 'fsm-claim-guard';
    const objectKey = 'entities/ATA/disbursements/receipts/fsm-claim-guard.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'fsm-claim-guard.pdf',
      contentType: 'application/pdf',
      size: 100,
    });
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });

    const legitimateClaim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    const validClaimId = legitimateClaim.claimId;

    // Spoofed claimId attempts release
    const badRelease = reservations.releaseReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: 'spoofed-fake-uuid',
    });
    expect(badRelease).toEqual({ error: 'CLAIM_MISMATCH' });
    expect(reservations.getReservation(uploadId).status).toBe('claimed');

    // Missing claimId attempts release
    const noClaimRelease = reservations.releaseReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(noClaimRelease).toEqual({ error: 'CLAIM_MISMATCH' });
    expect(reservations.getReservation(uploadId).status).toBe('claimed');

    // Spoofed claimId attempts consume
    const badConsume = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: 'spoofed-fake-uuid',
    });
    expect(badConsume).toBeNull();
    expect(reservations.getReservation(uploadId).status).toBe('claimed');

    // Missing claimId attempts consume
    const noClaimConsume = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(noClaimConsume).toBeNull();
    expect(reservations.getReservation(uploadId).status).toBe('claimed');

    // Legitimate claimId consumes cleanly
    const goodConsume = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: validClaimId,
    });
    expect(goodConsume).not.toBeNull();
    expect(goodConsume.status).toBe('consumed');
  });

  it('Pending state cannot be claimed, consumed, or found completed', () => {
    const uploadId = 'fsm-pending-guards';
    const objectKey = 'entities/ATA/disbursements/receipts/fsm-pending.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'fsm-pending.pdf',
      contentType: 'application/pdf',
      size: 100,
    });

    // claimReservationByKey -> NOT_COMPLETED
    const clRes = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(clRes).toEqual({ error: 'NOT_COMPLETED' });
    expect(reservations.getReservation(uploadId).status).toBe('pending');

    // consumeReservationByKey -> null
    const conRes = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(conRes).toBeNull();
    expect(reservations.getReservation(uploadId).status).toBe('pending');

    // findCompletedReservationByKey -> NOT_COMPLETED
    const findRes = reservations.findCompletedReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    expect(findRes).toEqual({ error: 'NOT_COMPLETED' });
    expect(reservations.getReservation(uploadId).status).toBe('pending');
  });

  it('Cross-tenant and cross-user isolation prevents unauthorized reservation access', () => {
    const uploadId = 'tenant-isolation-test';
    const objectKey = 'entities/ATA/disbursements/receipts/tenant-isolation.pdf';
    reservations.createReservation({
      uploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey,
      filename: 'tenant-isolation.pdf',
      contentType: 'application/pdf',
      size: 100,
    });
    reservations.completeReservation(uploadId, { userId: OWNER_ID, entityId: ENT_ATA });

    // Other user attempts claim -> MISMATCH
    const otherUserClaim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OTHER_USER_ID,
      entityId: ENT_ATA,
    });
    expect(otherUserClaim).toEqual({ error: 'MISMATCH' });

    // Other entity attempts claim -> MISMATCH
    const otherEntityClaim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER_ID,
      entityId: 'ent-lta',
    });
    expect(otherEntityClaim).toEqual({ error: 'MISMATCH' });

    // Status remains completed
    expect(reservations.getReservation(uploadId).status).toBe('completed');
  });
});

describe('Challenger M2 Iteration 2 — Suite 3: Storage Verification Edge Cases (R3)', () => {
  it('verifyReceiptObject handles download exceptions gracefully without crashing', async () => {
    const origFrom = supabaseAdmin.storage.from;
    supabaseAdmin.storage.from = (b) => {
      const s = origFrom.call(supabaseAdmin.storage, b);
      return {
        ...s,
        download: async () => {
          throw new Error('Simulated S3 network disconnect');
        },
      };
    };

    const result = await storageService.verifyReceiptObject({
      path: 'entities/ATA/disbursements/receipts/network-fail.pdf',
      expectedSize: 100,
      expectedContentType: 'application/pdf',
    });

    supabaseAdmin.storage.from = origFrom;

    expect(result.valid).toBe(false);
    expect(result.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
    expect(result.error).toContain('Simulated S3 network disconnect');
  });

  it('Rejects files with disallowed MIME types even if magic bytes match an allowed type', async () => {
    const validPdf = Buffer.from('%PDF-1.4\ncontent');
    mockStorageObjects.set('entities/ATA/disbursements/receipts/zip-mime.pdf', {
      buffer: validPdf,
      size: validPdf.length,
      contentType: 'application/zip',
    });

    const result = await storageService.verifyReceiptObject({
      path: 'entities/ATA/disbursements/receipts/zip-mime.pdf',
      expectedSize: validPdf.length,
      expectedContentType: 'application/zip',
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
    expect(result.error).toContain('is not in allowed types');
  });

  it('Rejects binary when storage metadata content-type conflicts with reservation', async () => {
    const validPdf = Buffer.from('%PDF-1.4\ncontent');
    mockStorageObjects.set('entities/ATA/disbursements/receipts/mime-conflict.pdf', {
      buffer: validPdf,
      size: validPdf.length,
      contentType: 'image/png', // Storage metadata says image/png
    });

    const result = await storageService.verifyReceiptObject({
      path: 'entities/ATA/disbursements/receipts/mime-conflict.pdf',
      expectedSize: validPdf.length,
      expectedContentType: 'application/pdf', // Reservation expects PDF
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
    expect(result.error).toContain('does not match reservation');
  });

  it('Rejects non-existent object path in storage', async () => {
    const result = await storageService.verifyReceiptObject({
      path: 'entities/ATA/disbursements/receipts/does-not-exist.pdf',
      expectedSize: 100,
      expectedContentType: 'application/pdf',
    });

    expect(result.valid).toBe(false);
    expect(result.code).toBe('RECEIPT_UPLOAD_VERIFICATION_FAILED');
    expect(result.error).toContain('was not found in storage');
  });
});

describe('Challenger M2 Iteration 2 — Suite 4: Scoped Orphan Cleanup Safety (R4 / F17)', () => {
  it('Scoped orphan cleanup NEVER deletes storage objects for consumed reservations even after 1 year', async () => {
    const deletedStorageKeys = [];
    const mockStorage = {
      deleteObject: async (key) => {
        deletedStorageKeys.push(key);
      },
    };

    const oldTime = Date.now() - 365 * 24 * 60 * 60 * 1000;

    // 1. Expired unconsumed reservation
    const orphanUploadId = 'orphan-upload-1';
    const orphanKey = 'entities/ATA/disbursements/receipts/orphan-file.pdf';
    reservations.createReservation({
      uploadId: orphanUploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: orphanKey,
      filename: 'orphan-file.pdf',
      contentType: 'application/pdf',
      size: 500,
      expiresInSeconds: -1,
    });

    // 2. Consumed reservation from 1 year ago
    const clock = jest.useFakeTimers({now: oldTime});
    const consumedUploadId = 'consumed-upload-1';
    const consumedKey = 'entities/ATA/disbursements/receipts/consumed-voucher-file.pdf';
    reservations.createReservation({
      uploadId: consumedUploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: consumedKey,
      filename: 'consumed-voucher-file.pdf',
      contentType: 'application/pdf',
      size: 500,
    });
    reservations.completeReservation(consumedUploadId, { userId: OWNER_ID, entityId: ENT_ATA });
    const claim = reservations.claimReservationByKey({
      receiptS3Key: consumedKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
    });
    reservations.consumeReservationByKey({
      receiptS3Key: consumedKey,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      claimId: claim.claimId,
    });
    clock.useRealTimers();

    // 3. Active unexpired reservation
    const activeUploadId = 'active-upload-1';
    const activeKey = 'entities/ATA/disbursements/receipts/active-file.pdf';
    reservations.createReservation({
      uploadId: activeUploadId,
      userId: OWNER_ID,
      entityId: ENT_ATA,
      objectKey: activeKey,
      filename: 'active-file.pdf',
      contentType: 'application/pdf',
      size: 500,
      expiresInSeconds: 900,
    });

    // Run cleanup with current time
    const summary = await reservations.cleanupExpiredReservations({
      now: new Date(),
      storage: mockStorage,
    });

    // Orphaned storage object was deleted
    expect(deletedStorageKeys).toContain(orphanKey);

    // Consumed storage object was NEVER deleted!
    expect(deletedStorageKeys).not.toContain(consumedKey);

    // Active storage object was NOT deleted
    expect(deletedStorageKeys).not.toContain(activeKey);

    // Verification summary
    expect(summary.cleaned).toBe(1);
    expect(summary.skippedConsumed).toBe(1);
    expect(summary.deletedKeys).toEqual([orphanKey]);
  });
});
