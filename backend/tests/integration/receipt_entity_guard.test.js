/**
 * Receipt Entity Guard Integration & Unit Tests
 *
 * Verifies Contract C2 & Codex Guard Requirements:
 * 1. G01: Rejection of literal 'ALL' header (and 'all') with HTTP 400 RECEIPT_ENTITY_REQUIRED on both endpoints.
 * 2. G02: Rejection of omitted header for dual-entity users with HTTP 400 RECEIPT_ENTITY_REQUIRED on both endpoints.
 * 3. G03: Rejection of malformed / non-canonical headers ('INVALID', 'foo', 'ATA123') preventing normalization leaks.
 * 4. G04: Prevention of body entity, clientId, or workRequestId bypass in ALL view.
 * 5. G05: Zero side-effects on rejection (no storage presigning, no binary verification, no store mutations).
 * 6. G06: Rejection of unauthorized explicit entity via upstream entityScope (HTTP 403) before guard/storage.
 * 7. G07: Safe compatibility for single-entity users with omitted header.
 * 8. G08: Acceptance of canonical lowercase entity ('lta', 'ata') uppercased consistently upstream.
 * 9. G09: Unit verification of raw/scoped mismatch and non-canonical whitespace rejection.
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
  mockStorageObjects,
} = require('../fixtures/supabaseMock');
const reservations = require('../../src/modules/disbursements/receiptReservationStore');
const storageService = require('../../src/services/storageService');
const { receiptEntityGuard } = require('../../src/middleware/receiptEntityGuard');
const AppError = require('../../src/lib/AppError');

const DUAL_USER = '11111111-1111-4111-8111-111111111111';
const SINGLE_ATA_USER = '22222222-2222-4222-8222-222222222222';
const SINGLE_LTA_USER = '33333333-3333-4333-8333-333333333333';

let dualToken;
let singleAtaToken;
let singleLtaToken;

beforeEach(() => {
  resetMock();
  seedDefaults();
  reservations.clearReservations();

  dualToken = registerUser({
    id: DUAL_USER,
    email: 'dual_user@example.test',
    name: 'Dual Entity User',
    role: 'Admin',
    entities: ['ATA', 'LTA'],
  });

  singleAtaToken = registerUser({
    id: SINGLE_ATA_USER,
    email: 'single_ata@example.test',
    name: 'Single ATA User',
    role: 'Admin',
    entities: ['ATA'],
  });

  singleLtaToken = registerUser({
    id: SINGLE_LTA_USER,
    email: 'single_lta@example.test',
    name: 'Single LTA User',
    role: 'Admin',
    entities: ['LTA'],
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Receipt Entity Guard (C2 / RECEIPT-ENTITY-20261021)', () => {
  describe('G01: Literal ALL header', () => {
    it('rejects reservation with literal X-Active-Entity: ALL with HTTP 400 RECEIPT_ENTITY_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${dualToken}`)
        .set('X-Active-Entity', 'ALL')
        .send({ filename: 'receipt.pdf', contentType: 'application/pdf', size: 1024 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
      expect(res.body.detail).toBe('Select a specific ATA or LTA entity for this receipt upload.');
    });

    it('rejects reservation with lowercase X-Active-Entity: all with HTTP 400 RECEIPT_ENTITY_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${dualToken}`)
        .set('X-Active-Entity', 'all')
        .send({ filename: 'receipt.pdf', contentType: 'application/pdf', size: 1024 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
    });

    it('rejects completion with literal X-Active-Entity: ALL with HTTP 400 RECEIPT_ENTITY_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads/fake-upload-id/complete')
        .set('Authorization', `Bearer ${dualToken}`)
        .set('X-Active-Entity', 'ALL')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
      expect(res.body.detail).toBe('Select a specific ATA or LTA entity for this receipt upload.');
    });
  });

  describe('G02: Missing header with dual membership', () => {
    it('rejects reservation when X-Active-Entity is omitted for dual-entity user', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({ filename: 'receipt.png', contentType: 'image/png', size: 500 });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
      expect(res.body.detail).toBe('Select a specific ATA or LTA entity for this receipt upload.');
    });

    it('rejects completion when X-Active-Entity is omitted for dual-entity user', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads/fake-upload-id/complete')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
      expect(res.body.detail).toBe('Select a specific ATA or LTA entity for this receipt upload.');
    });
  });

  describe('G03: Malformed & non-canonical raw headers via HTTP', () => {
    it.each(['INVALID', 'foo', 'ATA123', 'LTA_EXTRA', '123', 'ATA LTA'])(
      'rejects reservation with malformed header "%s" with HTTP 400 RECEIPT_ENTITY_REQUIRED',
      async (malformedHeader) => {
        const res = await request(app)
          .post('/v1/disbursements/receipt-uploads')
          .set('Authorization', `Bearer ${dualToken}`)
          .set('X-Active-Entity', malformedHeader)
          .send({ filename: 'receipt.png', contentType: 'image/png', size: 500 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
      }
    );

    it.each(['INVALID', 'foo', 'ATA123', '123'])(
      'rejects completion with malformed header "%s" with HTTP 400 RECEIPT_ENTITY_REQUIRED',
      async (malformedHeader) => {
        const res = await request(app)
          .post('/v1/disbursements/receipt-uploads/some-upload-id/complete')
          .set('Authorization', `Bearer ${dualToken}`)
          .set('X-Active-Entity', malformedHeader)
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
      }
    );
  });

  describe('G04: Body-entity & reference bypass prevention', () => {
    it('rejects reservation with body entity in ALL context', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${dualToken}`)
        .set('X-Active-Entity', 'ALL')
        .send({
          filename: 'receipt.pdf',
          contentType: 'application/pdf',
          size: 1024,
          entity: 'ATA',
          clientId: 'client-uuid-1',
          workRequestId: 'wr-uuid-1',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
    });

    it('rejects completion with body entity in omitted-header ALL context', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads/fake-upload-id/complete')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({ entity: 'ATA' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('RECEIPT_ENTITY_REQUIRED');
    });
  });

  describe('G05: Zero side-effects on rejection', () => {
    it('ensures no storage signing or reservation insertion occurs on rejected reservation', async () => {
      const signSpy = jest.spyOn(storageService, 'getSignedUploadUrl');
      const createResSpy = jest.spyOn(reservations, 'createReservation');

      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${dualToken}`)
        .send({ filename: 'receipt.png', contentType: 'image/png', size: 500 });

      expect(res.status).toBe(400);
      expect(signSpy).not.toHaveBeenCalled();
      expect(createResSpy).not.toHaveBeenCalled();
    });

    it('ensures no binary verification or state mutation occurs on rejected completion', async () => {
      const verifySpy = jest.spyOn(storageService, 'verifyReceiptObject');
      const completeResSpy = jest.spyOn(reservations, 'completeReservation');

      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads/fake-upload-id/complete')
        .set('Authorization', `Bearer ${dualToken}`)
        .set('X-Active-Entity', 'ALL')
        .send({});

      expect(res.status).toBe(400);
      expect(verifySpy).not.toHaveBeenCalled();
      expect(completeResSpy).not.toHaveBeenCalled();
    });
  });

  describe('G06: Unauthorized explicit entity denial', () => {
    it('rejects unauthorized explicit entity with HTTP 403 via upstream entityScope', async () => {
      const signSpy = jest.spyOn(storageService, 'getSignedUploadUrl');
      const createResSpy = jest.spyOn(reservations, 'createReservation');

      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${singleAtaToken}`)
        .set('X-Active-Entity', 'LTA')
        .send({ filename: 'receipt.png', contentType: 'image/png', size: 500 });

      expect(res.status).toBe(403);
      expect(res.body.title).toBe('Forbidden');
      expect(res.body.detail).toContain('User does not have access to entity LTA');
      expect(signSpy).not.toHaveBeenCalled();
      expect(createResSpy).not.toHaveBeenCalled();
    });
  });

  describe('G07: Safe single-entity compatibility with omitted header', () => {
    it('permits single-entity ATA user to reserve and complete with omitted header', async () => {
      // 1. Reserve
      const start = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${singleAtaToken}`)
        .send({ filename: 'single_receipt.png', contentType: 'image/png', size: 16 });

      expect(start.status).toBe(201);
      expect(start.body.data.objectKey).toContain('entities/ATA/disbursements/receipts/');
      const { uploadId, objectKey } = start.body.data;

      // Mock storage binary
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      mockStorageObjects.set(objectKey, {
        buffer: Buffer.concat([pngHeader, Buffer.alloc(8, 0)]),
        size: 16,
        contentType: 'image/png',
      });

      // 2. Complete
      const done = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${singleAtaToken}`)
        .send({});

      expect(done.status).toBe(200);
      expect(done.body.data.receiptS3Key).toBe(objectKey);
    });

    it('permits single-entity LTA user to reserve and complete with omitted header', async () => {
      const start = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${singleLtaToken}`)
        .send({ filename: 'single_lta.png', contentType: 'image/png', size: 16 });

      expect(start.status).toBe(201);
      expect(start.body.data.objectKey).toContain('entities/LTA/disbursements/receipts/');
      const { uploadId, objectKey } = start.body.data;

      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      mockStorageObjects.set(objectKey, {
        buffer: Buffer.concat([pngHeader, Buffer.alloc(8, 0)]),
        size: 16,
        contentType: 'image/png',
      });

      const done = await request(app)
        .post(`/v1/disbursements/receipt-uploads/${uploadId}/complete`)
        .set('Authorization', `Bearer ${singleLtaToken}`)
        .send({});

      expect(done.status).toBe(200);
      expect(done.body.data.receiptS3Key).toBe(objectKey);
    });
  });

  describe('G08: Canonical lowercase entity acceptance', () => {
    it('accepts lowercase "lta" header and scopes reservation to LTA', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${dualToken}`)
        .set('X-Active-Entity', 'lta')
        .send({ filename: 'lower.png', contentType: 'image/png', size: 16 });

      expect(res.status).toBe(201);
      expect(res.body.data.objectKey).toContain('entities/LTA/disbursements/receipts/');
    });

    it('accepts lowercase "ata" header and scopes reservation to ATA', async () => {
      const res = await request(app)
        .post('/v1/disbursements/receipt-uploads')
        .set('Authorization', `Bearer ${dualToken}`)
        .set('X-Active-Entity', 'ata')
        .send({ filename: 'lower.png', contentType: 'image/png', size: 16 });

      expect(res.status).toBe(201);
      expect(res.body.data.objectKey).toContain('entities/ATA/disbursements/receipts/');
    });
  });

  describe('G09: Direct unit verification of raw/scoped mismatch & non-canonical whitespace', () => {
    it('rejects whitespace-padded header " LTA " when passed to receiptEntityGuard', () => {
      const req = {
        headers: { 'x-active-entity': ' LTA ' },
        activeEntity: 'ATA', // upstream fallback
      };
      let err;
      receiptEntityGuard(req, {}, (e) => {
        err = e;
      });
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('RECEIPT_ENTITY_REQUIRED');
      expect(err.detail).toBe('Select a specific ATA or LTA entity for this receipt upload.');
    });

    it('rejects whitespace-padded header " ATA "', () => {
      const req = {
        headers: { 'x-active-entity': ' ATA ' },
        activeEntity: 'ATA',
      };
      let err;
      receiptEntityGuard(req, {}, (e) => {
        err = e;
      });
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('RECEIPT_ENTITY_REQUIRED');
    });

    it('rejects raw/scoped disagreement defensively', () => {
      const req = {
        headers: { 'x-active-entity': 'LTA' },
        activeEntity: 'ATA', // discrepancy
      };
      let err;
      receiptEntityGuard(req, {}, (e) => {
        err = e;
      });
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('RECEIPT_ENTITY_REQUIRED');
    });
  });
});
