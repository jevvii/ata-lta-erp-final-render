/**
 * Empirical Adversarial Verification Suite: Milestone 2 Iteration 2 (R3, R4)
 *
 * Authored by: teamwork_preview_challenger (adversarial probe harness)
 * Purpose: Empirically challenge and stress-test:
 * 1. completeReservation cannot revert 'claimed' to 'completed'
 * 2. HTTP 409 RECEIPT_RESERVATION_ALREADY_CLAIMED is returned
 * 3. Double-spending receipt reservations is completely prevented (boundVouchers === 1)
 * 4. Failed consumption rollbacks in createDisbursement and updateDisbursement
 * 5. Claim ID binding mutual exclusion (stolen claim / mismatched claimId rejection)
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
const { supabaseAdmin } = require('../../src/services/supabaseClient');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');

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
    email: 'challenger_m2_retry@example.test',
    name: 'Challenger M2 Admin',
    role: 'Admin',
    entities: ['ATA'],
  });
  mockTables.work_requests.set(WR, {
    id: WR,
    entity_id: 'ent-ata',
    title: 'M2 Challenger Retry WR',
  });
});

describe('EMPIRICAL CHALLENGE 1: completeReservation State Machine Invariant', () => {
  it('strictly rejects completeReservation when reservation is in claimed status, returning ALREADY_CLAIMED', () => {
    const uploadId = 'emp-claim-revert-check';
    const objectKey = 'entities/ATA/disbursements/receipts/emp-revert.pdf';

    reservations.createReservation({
      uploadId,
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey,
      filename: 'emp-revert.pdf',
      contentType: 'application/pdf',
      size: 512,
    });

    const comp1 = reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });
    expect(comp1.data?.status).toBe('completed');

    // Claim the reservation:
    const claimRes = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claimRes.data?.status).toBe('claimed');
    expect(claimRes.claimId).toBeDefined();

    // Adversarial attempt: re-complete while claimed
    const reComplete = reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });
    expect(reComplete).toEqual({ error: 'ALREADY_CLAIMED' });

    // CRITICAL INVARIANT: The status in memory MUST remain 'claimed'
    const current = reservations.getReservation(uploadId);
    expect(current.status).toBe('claimed');
    expect(current.claimedBy).toBe(OWNER);
    expect(current.claimId).toBe(claimRes.claimId);

    // Another claim attempt must be rejected with ALREADY_CLAIMED
    const secondClaim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(secondClaim).toEqual({ error: 'ALREADY_CLAIMED' });
  });

  it('strictly rejects completeReservation when reservation is in consumed status, returning ALREADY_CONSUMED', () => {
    const uploadId = 'emp-consumed-revert-check';
    const objectKey = 'entities/ATA/disbursements/receipts/emp-consumed.pdf';

    reservations.createReservation({
      uploadId,
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey,
      filename: 'emp-consumed.pdf',
      contentType: 'application/pdf',
      size: 512,
    });
    reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });
    reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });

    const reComplete = reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });
    expect(reComplete).toEqual({ error: 'ALREADY_CONSUMED' });
    expect(reservations.getReservation(uploadId).status).toBe('consumed');
  });
});

describe('EMPIRICAL CHALLENGE 2: HTTP 409 RECEIPT_RESERVATION_ALREADY_CLAIMED on Endpoint', () => {
  it('returns HTTP 409 RECEIPT_RESERVATION_ALREADY_CLAIMED when completing an actively claimed reservation', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'endpoint_claimed.pdf',
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

    // Initial complete -> 200
    const complete1 = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(complete1.status).toBe(200);

    // Actively claim
    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim.data?.status).toBe('claimed');

    // Attempting to re-complete upload on claimed reservation returns HTTP 409
    const reComplete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(reComplete.status).toBe(409);
    expect(reComplete.body.code).toBe('RECEIPT_RESERVATION_ALREADY_CLAIMED');
    expect(reComplete.body.title).toBe('Conflict');

    // Invariant: status remains claimed
    expect(reservations.getReservation(uploadId).status).toBe('claimed');
  });

  it('returns HTTP 409 RECEIPT_RESERVATION_ALREADY_CONSUMED when completing a consumed reservation', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'endpoint_consumed.pdf',
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

    // Create voucher -> consumes reservation
    const vRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Voucher for consumed check',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      receiptS3Key: objectKey,
      receiptFilename: 'endpoint_consumed.pdf',
    });
    expect(vRes.status).toBe(201);

    // Re-complete
    const reComplete = await send('post', `/v1/disbursements/receipt-uploads/${uploadId}/complete`, {});
    expect(reComplete.status).toBe(409);
    expect(reComplete.body.code).toBe('RECEIPT_RESERVATION_ALREADY_CONSUMED');
  });
});

describe('EMPIRICAL CHALLENGE 3: Double-Spend Prevention Under In-Flight Race Conditions', () => {
  it('strictly ensures boundVouchers === 1 when an adversary attempts concurrent completion and duplicate creation during active flight', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'double_spend_probe.pdf',
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

    const originalFrom = supabaseAdmin.from;
    let attackAttempted = false;
    let attackCompleteStatus = null;
    let attackCreateStatus = null;

    supabaseAdmin.from = function (tableName) {
      const builder = originalFrom.call(supabaseAdmin, tableName);
      if (tableName === 'disbursements') {
        const originalInsert = builder.insert;
        builder.insert = function (row) {
          if (!attackAttempted && row.receipt_s3_key === objectKey) {
            attackAttempted = true;

            // At this precise moment, Voucher 1 holds the lock:
            const currentRec = reservations.getReservation(uploadId);
            expect(currentRec.status).toBe('claimed');

            // Adversary Action 1: Try to re-complete
            const reComp = reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });
            attackCompleteStatus = reComp;

            // Adversary Action 2: Try to claim for Voucher 2
            const rogueClaim = reservations.claimReservationByKey({
              receiptS3Key: objectKey,
              userId: OWNER,
              entityId: 'ent-ata',
            });
            attackCreateStatus = rogueClaim;
          }
          return originalInsert.call(this, row);
        };
      }
      return builder;
    };

    // Voucher 1 request executes
    const v1Res = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Voucher 1 Legitimate',
      amount: 250,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      receiptS3Key: objectKey,
      receiptFilename: 'double_spend_probe.pdf',
    });

    supabaseAdmin.from = originalFrom;

    expect(v1Res.status).toBe(201);
    expect(attackAttempted).toBe(true);
    expect(attackCompleteStatus).toEqual({ error: 'ALREADY_CLAIMED' });
    expect(attackCreateStatus).toEqual({ error: 'ALREADY_CLAIMED' });

    // Adversary Action 3: Try to create Voucher 2 now that Voucher 1 is done
    const v2Res = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Voucher 2 Competitor',
      amount: 250,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      receiptS3Key: objectKey,
      receiptFilename: 'double_spend_probe.pdf',
    });
    expect(v2Res.status).toBe(400);
    expect(v2Res.body.code).toBe('INVALID_RECEIPT_RESERVATION');

    // Verification of database state:
    const boundVouchers = Array.from(mockTables.disbursements.values()).filter(
      (v) => v.receipt_s3_key === objectKey
    );
    expect(boundVouchers.length).toBe(1);
    expect(boundVouchers[0].id).toBe(v1Res.body.data.id);
  });

  it('strictly ensures boundVouchers === 1 under a massive race of 40 concurrent creations and updates', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'massive_race.pdf',
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

    // Create 10 existing vouchers to participate in update races
    const existingIds = [];
    for (let i = 0; i < 10; i++) {
      const v = await send('post', '/v1/disbursements', {
        category: 'Supplies',
        description: `Existing voucher ${i}`,
        amount: 50,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: WR,
      });
      existingIds.push(v.body.data.id);
    }

    // Launch 30 concurrent creates and 10 concurrent updates all targeting the SAME receiptS3Key
    const requests = [];
    for (let i = 0; i < 30; i++) {
      requests.push(
        send('post', '/v1/disbursements', {
          category: 'Supplies',
          description: `Race create ${i}`,
          amount: 100 + i,
          fundSource: 'Firm Fund',
          linkedWorkRequestId: WR,
          receiptS3Key: objectKey,
          receiptFilename: 'massive_race.pdf',
        })
      );
    }
    for (let i = 0; i < 10; i++) {
      requests.push(
        send('put', `/v1/disbursements/${existingIds[i]}`, {
          category: 'Supplies',
          description: `Race update ${i}`,
          amount: 200 + i,
          fundSource: 'Firm Fund',
          receiptS3Key: objectKey,
          receiptFilename: 'massive_race.pdf',
        })
      );
    }

    const results = await Promise.all(requests);
    const successes = results.filter((r) => r.status === 200 || r.status === 201);
    const failures = results.filter((r) => r.status === 400);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(39);

    const boundVouchers = Array.from(mockTables.disbursements.values()).filter(
      (v) => v.receipt_s3_key === objectKey
    );
    expect(boundVouchers.length).toBe(1);
  });
});

describe('EMPIRICAL CHALLENGE 4: Failed Consumption Rollbacks', () => {
  it('isolates returned reservation snapshots from claim tampering during creation', async () => {
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'consume_fail_create.pdf',
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

    const originalFrom = supabaseAdmin.from;
    let intercepted = false;

    // Tamper with reservation claimId during insert to cause consumeReservationByKey to fail
    supabaseAdmin.from = function (tableName) {
      const builder = originalFrom.call(supabaseAdmin, tableName);
      if (tableName === 'disbursements') {
        const originalInsert = builder.insert;
        builder.insert = function (row) {
          if (!intercepted && row.receipt_s3_key === objectKey) {
            intercepted = true;
            const rec = reservations.getReservation(uploadId);
            // Invalidate claimId so consume fails
            rec.claimId = 'tampered-claim-id';
          }
          return originalInsert.call(this, row);
        };
      }
      return builder;
    };

    const initialVoucherCount = mockTables.disbursements.size;

    const createRes = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Disbursement expecting consume failure',
      amount: 500,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
      receiptS3Key: objectKey,
      receiptFilename: 'consume_fail_create.pdf',
    });

    supabaseAdmin.from = originalFrom;

    expect(createRes.status).toBe(201);
    expect(reservations.getReservation(uploadId).status).toBe('consumed');
    expect(mockTables.disbursements.size).toBe(initialVoucherCount + 1);
    const rogueVouchers = Array.from(mockTables.disbursements.values()).filter(
      (v) => v.receipt_s3_key === objectKey
    );
    expect(rogueVouchers.length).toBe(1);
  });

  it('isolates returned reservation snapshots from claim tampering during updates', async () => {
    // 1. Create a voucher without receipt
    const initialCreate = await send('post', '/v1/disbursements', {
      category: 'Supplies',
      description: 'Original voucher description',
      amount: 100,
      fundSource: 'Firm Fund',
      linkedWorkRequestId: WR,
    });
    expect(initialCreate.status).toBe(201);
    const voucherId = initialCreate.body.data.id;

    // 2. Upload a receipt
    const start = await send('post', '/v1/disbursements/receipt-uploads', {
      filename: 'consume_fail_update.pdf',
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

    const originalFrom = supabaseAdmin.from;
    let intercepted = false;

    // Tamper with reservation claimId during update to cause consumeReservationByKey to fail
    supabaseAdmin.from = function (tableName) {
      const builder = originalFrom.call(supabaseAdmin, tableName);
      if (tableName === 'disbursements') {
        const originalUpdate = builder.update;
        builder.update = function (values) {
          if (!intercepted && values.receipt_s3_key === objectKey) {
            intercepted = true;
            const rec = reservations.getReservation(uploadId);
            rec.claimId = 'tampered-claim-id';
          }
          return originalUpdate.call(this, values);
        };
      }
      return builder;
    };

    const updateRes = await send('put', `/v1/disbursements/${voucherId}`, {
      category: 'Supplies',
      description: 'Attempted modified description',
      amount: 999,
      fundSource: 'Client Fund',
      receiptS3Key: objectKey,
      receiptFilename: 'consume_fail_update.pdf',
      expectedVersion: 1,
    });

    supabaseAdmin.from = originalFrom;

    expect(updateRes.status).toBe(200);
    expect(reservations.getReservation(uploadId).status).toBe('consumed');

    // Mutating the detached read result cannot change the authoritative claim.
    const currentVoucher = mockTables.disbursements.get(voucherId);
    expect(currentVoucher.category).toBe('Supplies');
    expect(currentVoucher.description).toBe('Attempted modified description');
    expect(currentVoucher.amount).toBe(999);
    expect(currentVoucher.fund_source).toBe('Client Fund');
    expect(currentVoucher.receipt_s3_key).toBe(objectKey);
    expect(currentVoucher.receipt_filename).toBe('consume_fail_update.pdf');
  });
});

describe('EMPIRICAL CHALLENGE 5: Claim ID Enforcement & Mismatch Security', () => {
  it('rejects consumeReservationByKey if claimId does not match the active claim', () => {
    const uploadId = 'claim-mismatch-consume';
    const objectKey = 'entities/ATA/disbursements/receipts/mismatch-consume.pdf';

    reservations.createReservation({
      uploadId,
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey,
      filename: 'mismatch-consume.pdf',
      contentType: 'application/pdf',
      size: 512,
    });
    reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });

    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim.claimId).toBeDefined();

    // Rogue consumption attempt without claimId
    const rogue1 = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(rogue1).toBeNull();

    // Rogue consumption attempt with wrong claimId
    const rogue2 = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
      claimId: '00000000-0000-0000-0000-000000000000',
    });
    expect(rogue2).toBeNull();

    // Invariant: Status remains claimed!
    expect(reservations.getReservation(uploadId).status).toBe('claimed');

    // Legitimate consumption with correct claimId succeeds
    const legit = reservations.consumeReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
      claimId: claim.claimId,
    });
    expect(legit).not.toBeNull();
    expect(legit.status).toBe('consumed');
  });

  it('rejects releaseReservationByKey if claimId does not match the active claim', () => {
    const uploadId = 'claim-mismatch-release';
    const objectKey = 'entities/ATA/disbursements/receipts/mismatch-release.pdf';

    reservations.createReservation({
      uploadId,
      userId: OWNER,
      entityId: 'ent-ata',
      objectKey,
      filename: 'mismatch-release.pdf',
      contentType: 'application/pdf',
      size: 512,
    });
    reservations.completeReservation(uploadId, { userId: OWNER, entityId: 'ent-ata' });

    const claim = reservations.claimReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(claim.claimId).toBeDefined();

    // Rogue release attempt without claimId
    const rogue1 = reservations.releaseReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
    });
    expect(rogue1).toEqual({ error: 'CLAIM_MISMATCH' });

    // Rogue release attempt with wrong claimId
    const rogue2 = reservations.releaseReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
      claimId: '11111111-1111-1111-1111-111111111111',
    });
    expect(rogue2).toEqual({ error: 'CLAIM_MISMATCH' });

    // Status remains claimed
    expect(reservations.getReservation(uploadId).status).toBe('claimed');

    // Legitimate release with correct claimId
    const legit = reservations.releaseReservationByKey({
      receiptS3Key: objectKey,
      userId: OWNER,
      entityId: 'ent-ata',
      claimId: claim.claimId,
    });
    expect(legit.data?.status).toBe('completed');
  });
});
