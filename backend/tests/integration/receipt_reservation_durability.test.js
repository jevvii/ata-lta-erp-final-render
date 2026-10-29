/**
 * Integration Test Suite: Receipt Reservation Durability, Active-Claim Safety,
 * Database Voucher Linkage Verification, and Orphan Cleanup Retry (F1–F3 / AC1–AC4).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../../src/modules/disbursements/receiptReservationStore');
const emptyDb = { from: () => ({ select() { return this; }, eq() { return this; }, limit: async () => ({ data: [], error: null }) }) };
const cleanupScript = require('../../src/scripts/cleanupOrphanReceipts');

describe('Receipt Reservation Durability & Cleanup Lifecycle (F1–F3)', () => {
  let testStorePath;

  beforeEach(() => {
    testStorePath = path.join(os.tmpdir(), `test_receipt_reservations_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    store.setStorePath(testStorePath);
    store.clearReservations();
  });

  afterEach(() => {
    store.clearReservations();
    try {
      if (fs.existsSync(testStorePath)) {
        fs.unlinkSync(testStorePath);
      }
    } catch (_) {
      // Ignore cleanup error
    }
  });

  describe('F1: Shared Store Durability Across Restarts and Instances', () => {
    it('persists completed reservation to shared disk store and reloads in a fresh instance', () => {
      const uploadId = 'res-restart-test';
      const actor = { userId: 'u-101', entityId: 'ent-ata' };

      // Instance 1 creates and completes the reservation
      store.createReservation({
        uploadId,
        ...actor,
        objectKey: 'receipts/restart-test.pdf',
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 2048,
        expiresInSeconds: 900,
      });

      const completed = store.completeReservation(uploadId, actor);
      expect(completed.data?.status).toBe(store.STATUS.COMPLETED);

      // Verify that disk file exists and contains the completed reservation
      expect(fs.existsSync(testStorePath)).toBe(true);

      // Simulate a fresh Node module/worker by clearing in-memory cache and syncing from disk
      store.syncFromDisk();
      const retrieved = store.getReservation(uploadId);
      expect(retrieved).not.toBeNull();
      expect(retrieved.status).toBe(store.STATUS.COMPLETED);
      expect(retrieved.objectKey).toBe('receipts/restart-test.pdf');

      // Instance claims it
      const claimed = store.claimReservationByKey({
        receiptS3Key: 'receipts/restart-test.pdf',
        ...actor,
      });
      expect(claimed.data?.status).toBe(store.STATUS.CLAIMED);

      // Verify persistence of claim state
      const diskContent = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
      expect(diskContent[uploadId].status).toBe(store.STATUS.CLAIMED);
      expect(diskContent[uploadId].claimId).toBe(claimed.claimId);
    });
  });

  describe('F2: Active Claim Exclusion & Database Voucher Linkage Verification', () => {
    it('excludes actively claimed reservations from cleanup deletion', async () => {
      const uploadId = 'res-active-claim';
      const actor = { userId: 'u-102', entityId: 'ent-ata' };
      const deletedKeys = [];

      store.createReservation({
        uploadId,
        ...actor,
        objectKey: 'receipts/in-flight.png',
        filename: 'receipt.png',
        contentType: 'image/png',
        size: 1024,
        expiresInSeconds: 900,
      });
      store.completeReservation(uploadId, actor);
      store.claimReservationByKey({ receiptS3Key: 'receipts/in-flight.png', ...actor });

      const mockStorage = {
        deleteObject: jest.fn(async (key) => deletedKeys.push(key)),
      };

      // Run cleanup with simulated future time (claims still active within 60s)
      const summary = await store.cleanupExpiredReservations({
        now: new Date(Date.now() + 10000), // 10s into the claim
        storage: mockStorage,
        claimTimeoutMs: 60000,
      });

      expect(summary.skippedActiveClaims).toBe(1);
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
      expect(deletedKeys).toEqual([]);
    });

    it('verifies DB voucher linkage before deleting and marks linked objects as consumed', async () => {
      const uploadId = 'res-linked-voucher';
      const actor = { userId: 'u-103', entityId: 'ent-ata' };
      const deletedKeys = [];

      // Create an expired reservation
      store.createReservation({
        uploadId,
        ...actor,
        objectKey: 'receipts/already-linked.jpg',
        filename: 'receipt.jpg',
        contentType: 'image/jpeg',
        size: 500,
        expiresInSeconds: -10, // Already expired
      });

      const mockStorage = {
        deleteObject: jest.fn(async (key) => deletedKeys.push(key)),
      };

      // Mock database returning an existing linked voucher
      const mockDb = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'voucher-existing-uuid' }],
                error: null,
              }),
            }),
          }),
        }),
      };

      const summary = await store.cleanupExpiredReservations({
        now: new Date(),
        storage: mockStorage,
        db: mockDb,
      });

      expect(summary.linkedToVoucher).toBe(1);
      expect(summary.skippedConsumed).toBe(1);
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
      expect(deletedKeys).toEqual([]);

      // Verify that reservation status transitioned to CONSUMED
      const diskContent = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
      expect(diskContent[uploadId].status).toBe(store.STATUS.CONSUMED);
      expect(diskContent[uploadId].voucherId).toBe('voucher-existing-uuid');
    });

    it('safely skips deletion if database voucher linkage check errors', async () => {
      const uploadId = 'res-db-error';
      const actor = { userId: 'u-104', entityId: 'ent-ata' };

      store.createReservation({
        uploadId,
        ...actor,
        objectKey: 'receipts/db-error.png',
        filename: 'doc.png',
        contentType: 'image/png',
        size: 100,
        expiresInSeconds: -10,
      });

      const mockStorage = {
        deleteObject: jest.fn(),
      };

      const failingDb = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockRejectedValue(new Error('Postgres connection failed')),
            }),
          }),
        }),
      };

      const summary = await store.cleanupExpiredReservations({
        now: new Date(),
        storage: mockStorage,
        db: failingDb,
      });

      expect(summary.errors.length).toBe(1);
      expect(summary.errors[0].error).toContain('Postgres connection failed');
      expect(mockStorage.deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('F3: Expired Lookup Preservation & Cleanup Failure Retries', () => {
    it('preserves reservation record for orphan cleanup when getReservation encounters expired entry', async () => {
      const uploadId = 'res-lookup-preserve';
      const actor = { userId: 'u-105', entityId: 'ent-ata' };

      store.createReservation({
        uploadId,
        ...actor,
        objectKey: 'receipts/preserve-me.pdf',
        filename: 'preserve.pdf',
        contentType: 'application/pdf',
        size: 1200,
        expiresInSeconds: -10,
      });

      // getReservation returns null to callers to prevent upload usage
      const lookup = store.getReservation(uploadId);
      expect(lookup).toBeNull();

      // But record must STILL exist in the store for cleanup!
      const deletedKeys = [];
      const mockStorage = {
        deleteObject: jest.fn(async (key) => deletedKeys.push(key)),
      };

      const summary = await store.cleanupExpiredReservations({
        now: new Date(),
        storage: mockStorage,
        db: emptyDb,
      });

      expect(summary.scanned).toBe(1);
      expect(summary.cleaned).toBe(1);
      expect(deletedKeys).toEqual(['receipts/preserve-me.pdf']);
    });

    it('retains reservation with CLEANUP_FAILED and retryCount when deleteObject throws, enabling retry', async () => {
      const uploadId = 'res-failed-storage';
      const actor = { userId: 'u-106', entityId: 'ent-ata' };

      store.createReservation({
        uploadId,
        ...actor,
        objectKey: 'receipts/fail-then-retry.png',
        filename: 'fail.png',
        contentType: 'image/png',
        size: 500,
        expiresInSeconds: -10,
      });

      // Run 1: Storage throws error
      const failingStorage = {
        deleteObject: jest.fn().mockRejectedValue(new Error('S3 503 Service Unavailable')),
      };

      const run1 = await store.cleanupExpiredReservations({
        now: new Date(),
        storage: failingStorage,
        db: emptyDb,
      });

      expect(run1.errors.length).toBe(1);
      expect(run1.deletedKeys.length).toBe(0);

      // Verify record is preserved on disk with retry metadata
      const diskContent = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
      expect(diskContent[uploadId].status).toBe(store.STATUS.CLEANUP_FAILED);
      expect(diskContent[uploadId].retryCount).toBe(1);
      expect(diskContent[uploadId].lastCleanupError).toContain('S3 503');

      // Run 2: Storage is now healthy, retry succeeds!
      const healthyStorage = {
        deleteObject: jest.fn().mockResolvedValue(true),
      };

      const run2 = await store.cleanupExpiredReservations({
        now: new Date(),
        storage: healthyStorage,
        db: emptyDb,
      });

      expect(run2.scanned).toBe(1);
      expect(run2.cleaned).toBe(1);
      expect(run2.deletedKeys).toEqual(['receipts/fail-then-retry.png']);

      // Record is now deleted after successful cleanup
      const finalDisk = JSON.parse(fs.readFileSync(testStorePath, 'utf8'));
      expect(finalDisk[uploadId]).toBeUndefined();
    });

    it('operational cleanup script parses CLI args and executes cleanup', async () => {
      const summary = await cleanupScript.run();
      expect(summary).toBeDefined();
      expect(typeof summary.scanned).toBe('number');
    });
  });
});
