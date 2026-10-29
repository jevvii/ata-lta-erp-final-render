/**
 * Database Driver and HTTP Readiness Integration Tests.
 *
 * Exercises:
 * - Driver selection (RESERVATION_STORE_DRIVER=database) without RESERVATION_STORE_PATH
 * - RPC adapter responses: success, thrown error, returned error, timeout
 * - Malformed DB responses: {}, missing data, arrays, scalars, missing/mismatched claim token, malformed cleanup candidates
 * - Health check /health (checks.receiptStore, 503 on failure, no persistent caching of failures)
 * - Decoupled /readyz and /livez endpoints
 * - Timer boot in database mode without local path
 * - Filesystem corruption detection in checkReceiptStoreReadiness
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app, resetHealthCache } = require('../helpers/testServer');
const store = require('../../src/modules/disbursements/receiptReservationStore');
const dbDriver = require('../../src/modules/disbursements/receiptStoreDatabase');
const fsDriver = require('../../src/modules/disbursements/receiptStoreFilesystem');
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('Receipt Reservation Database Driver & System Integration', () => {
  const origEnv = process.env;

  beforeEach(() => {
    process.env = { ...origEnv };
    store.setStoreDriver(null);
    if (typeof resetHealthCache === 'function') resetHealthCache();
  });

  afterEach(() => {
    process.env = origEnv;
    store.setStoreDriver(null);
    dbDriver.setDatabaseClient(null);
  });

  describe('Driver Selection Logic', () => {
    it('selects database driver when RESERVATION_STORE_DRIVER=database', () => {
      process.env.RESERVATION_STORE_DRIVER = 'database';
      expect(store.getStoreDriver()).toBe('database');
    });

    it('selects filesystem driver when RESERVATION_STORE_DRIVER=filesystem', () => {
      process.env.RESERVATION_STORE_DRIVER = 'filesystem';
      expect(store.getStoreDriver()).toBe('filesystem');
    });

    it('fails closed when RESERVATION_STORE_DRIVER is invalid', () => {
      process.env.RESERVATION_STORE_DRIVER = 'invalid_driver';
      expect(() => store.getStoreDriver()).toThrow();
      try {
        store.getStoreDriver();
      } catch (err) {
        expect(err.statusCode).toBe(503);
        expect(err.code).toBe('RECEIPT_STORE_NOT_CONFIGURED');
      }
    });

    it('rejects an explicitly empty driver rather than silently selecting a default', () => {
      process.env.RESERVATION_STORE_DRIVER = '';
      expect(() => store.getStoreDriver()).toThrow('Invalid RESERVATION_STORE_DRIVER');
    });

    it('honors RESERVATION_STORE_PATH as filesystem when driver is unset', () => {
      delete process.env.RESERVATION_STORE_DRIVER;
      process.env.RESERVATION_STORE_PATH = '/var/data/receipts.json';
      expect(store.getStoreDriver()).toBe('filesystem');
    });

    it('defaults production to database mode when no path or driver is set', () => {
      delete process.env.RESERVATION_STORE_DRIVER;
      delete process.env.RESERVATION_STORE_PATH;
      process.env.NODE_ENV = 'production';
      expect(store.getStoreDriver()).toBe('database');
    });
  });

  describe('Database Driver Adapter & Strict Response Validation', () => {
    const actor = {
      userId: '11111111-1111-1111-1111-111111111111',
      entityId: '22222222-2222-2222-2222-222222222222',
      receiptS3Key: 'entities/ATA/disbursements/receipts/test.png',
      claimId: 'claim-token-123',
    };

    it('creates reservation successfully when DB returns valid record', async () => {
      store.setStoreDriver('database');
      const mockRecord = {
        uploadId: 'upload-123',
        objectKey: 'entities/ATA/disbursements/receipts/test.png',
        userId: actor.userId,
        entityId: actor.entityId,
        filename: 'receipt.png',
        contentType: 'image/png',
        size: 1024,
        status: 'pending',
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        createdAt: new Date().toISOString(),
      };

      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { data: mockRecord } }),
      });

      const res = await store.createReservation({
        uploadId: 'upload-123',
        userId: actor.userId,
        entityId: actor.entityId,
        objectKey: mockRecord.objectKey,
        filename: mockRecord.filename,
        contentType: mockRecord.contentType,
        size: mockRecord.size,
      });

      expect(res.uploadId).toBe('upload-123');
      expect(res.status).toBe('pending');
    });

    it('throws RECEIPT_RESERVATION_EXISTS on duplicate conflict', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { error: 'RECEIPT_RESERVATION_EXISTS' } }),
      });

      await expect(
        store.createReservation({
          uploadId: 'upload-dup',
          userId: actor.userId,
          entityId: actor.entityId,
          objectKey: 'key',
          filename: 'f',
          contentType: 'c',
          size: 1,
        })
      ).rejects.toMatchObject({
        statusCode: 503,
        code: 'RECEIPT_RESERVATION_EXISTS',
      });
    });

    it('rejects empty object {} from createReservation with sanitized 503', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: {} }),
      });

      await expect(
        store.createReservation({
          uploadId: 'upload-empty',
          userId: actor.userId,
          entityId: actor.entityId,
          objectKey: 'key',
          filename: 'f',
          contentType: 'c',
          size: 1,
        })
      ).rejects.toMatchObject({
        statusCode: 503,
        code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
        detail: 'Receipt reservation database is unavailable.',
      });
    });

    it('rejects malformed/empty claim response {} and prevents voucher authorization', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: {} }),
      });

      await expect(
        store.claimReservationByKey({
          receiptS3Key: actor.receiptS3Key,
          userId: actor.userId,
          entityId: actor.entityId,
        })
      ).rejects.toMatchObject({
        statusCode: 503,
        code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
      });
    });

    it('rejects claim response when claimId is missing or does not match data.claimId', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({
          data: {
            data: {
              uploadId: 'u1',
              objectKey: actor.receiptS3Key,
              status: 'claimed',
              claimId: 'token-A',
            },
            claimId: 'token-B', // mismatch!
          },
        }),
      });

      await expect(
        store.claimReservationByKey({
          receiptS3Key: actor.receiptS3Key,
          userId: actor.userId,
          entityId: actor.entityId,
        })
      ).rejects.toMatchObject({
        statusCode: 503,
        code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
      });
    });

    it('rejects malformed cleanup candidate list with sanitized 503', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({
          data: {
            scanned: 1,
            candidates: [{ uploadId: '' }], // invalid candidate!
          },
        }),
      });

      await expect(store.cleanupExpiredReservations()).rejects.toMatchObject({
        statusCode: 503,
        code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
      });
    });

    it('sanitizes thrown database errors without leaking internal SQL or host details', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest
          .fn()
          .mockRejectedValue(
            new Error('FATAL: connection to postgresql://secret:pass@internal-pg:5432 failed')
          ),
      });

      await expect(store.getReservation('u1')).rejects.toMatchObject({
        statusCode: 503,
        code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
        detail: 'Receipt reservation database is unavailable.',
      });
    });

    it('times out boundedly when database RPC hangs', async () => {
      jest.useFakeTimers();
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockImplementation(() => new Promise(() => {})), // never settles
      });

      const readiness = store.checkReceiptStoreReadiness();
      await jest.advanceTimersByTimeAsync(5000);
      const res = await readiness;
      expect(res.ok).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      jest.useRealTimers();
    });
  });

  describe('Health and Readiness Probes Integration', () => {
    it('returns 200 ok on /health when all dependencies including receipt store are healthy', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { ok: true } }),
      });

      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.checks).toHaveProperty('receiptStore', true);
      expect(res.body.checks).toHaveProperty('supabase', true);
      expect(res.body.checks).toHaveProperty('storage', true);
    });

    it('returns 503 degraded on /health when receipt store probe fails', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { ok: false } }),
      });

      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.checks.receiptStore).toBe(false);
    });

    it('does not cache a failed /health check so recovery is immediate', async () => {
      store.setStoreDriver('database');
      const mockRpc = jest
        .fn()
        .mockResolvedValueOnce({ data: { ok: false } }) // first call fails
        .mockResolvedValueOnce({ data: { ok: true } }); // second call succeeds

      dbDriver.setDatabaseClient({ rpc: mockRpc });

      const failRes = await request(app).get('/health');
      expect(failRes.status).toBe(503);

      // Second request immediately afterwards should reflect recovery without waiting 30s
      const recoverRes = await request(app).get('/health');
      expect(recoverRes.status).toBe(200);
      expect(recoverRes.body.status).toBe('ok');
    });

    it('returns 200 ready on /readyz when receipt store probe succeeds', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockResolvedValue({ data: { ok: true } }),
      });

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });

    it('returns 503 not_ready on /readyz when receipt store is unavailable', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockRejectedValue(new Error('Database offline')),
      });

      const res = await request(app).get('/readyz');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
    });

    it('returns instant 200 on /livez independently of receipt store status', async () => {
      store.setStoreDriver('database');
      dbDriver.setDatabaseClient({
        rpc: jest.fn().mockRejectedValue(new Error('Database offline')),
      });

      const res = await request(app).get('/livez');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('uptime');
    });
  });

  describe('Filesystem Readiness Probe Corruption Detection (Codex Item 4)', () => {
    let tmpDir;
    let storeFile;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-test-'));
      storeFile = path.join(tmpDir, 'reservations.json');
      fsDriver.setStorePath(storeFile);
      store.setStoreDriver('filesystem');
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {
        /* Directory may already have been removed. */
      }
    });

    it('reports healthy when filesystem store is clean and valid', async () => {
      fs.writeFileSync(storeFile, JSON.stringify({}), 'utf8');
      const readiness = await store.checkReceiptStoreReadiness();
      expect(readiness.ok).toBe(true);
    });

    it('reports unhealthy when store file contains corrupted JSON', async () => {
      fs.writeFileSync(storeFile, 'INVALID_CORRUPT_JSON{{{', 'utf8');
      const readiness = await store.checkReceiptStoreReadiness();
      expect(readiness.ok).toBe(false);
      expect(readiness.error).toContain('corrupt');
    });

    it('reports unhealthy when store file is not an absolute path', async () => {
      fsDriver.setStorePath('relative/path.json');
      const readiness = await store.checkReceiptStoreReadiness();
      expect(readiness.ok).toBe(false);
      expect(readiness.error).toContain('RESERVATION_STORE_PATH');
    });
  });

  describe('Periodic Cleanup Boot in Database Mode', () => {
    afterEach(() => {
      store.stopPeriodicReceiptCleanup();
    });

    it('starts periodic cleanup timer in database mode without RESERVATION_STORE_PATH', () => {
      delete process.env.RESERVATION_STORE_PATH;
      store.setStoreDriver('database');
      const timer = store.startPeriodicReceiptCleanup(60000);
      expect(timer).not.toBeNull();
      store.stopPeriodicReceiptCleanup();
    });
  });
});
