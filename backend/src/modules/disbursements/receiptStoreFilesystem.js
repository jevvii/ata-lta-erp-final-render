/**
 * Shared-filesystem receipt store driver.
 * All operations lock, reload and durably write.
 * Never steal locks or binding claims by age; reconcile crashed writers manually.
 * See docs/receipt-reservation-operations.md for the deployment requirements.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const storageService = require('../../services/storageService');
const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');

const STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  CLAIMED: 'claimed',
  CONSUMED: 'consumed',
  CLEANUP_FAILED: 'cleanup_failed',
  DELETING: 'deleting',
});

let storeFilePath =
  process.env.RESERVATION_STORE_PATH ||
  (process.env.NODE_ENV === 'production'
    ? null
    : path.join(
        os.tmpdir(),
        `ata_lta_receipt_reservations${process.env.NODE_ENV === 'test' ? `_${process.pid}` : ''}.json`
      ));

const storeError = (code, detail) =>
  new AppError({ statusCode: 503, title: 'Receipt store unavailable', code, detail });

function readRecords() {
  try {
    const records = JSON.parse(fs.readFileSync(storeFilePath, 'utf8'));
    if (!records || Array.isArray(records) || typeof records !== 'object')
      throw new Error('Invalid receipt store');
    return records;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function writeRecords(records) {
  const temporary = `${storeFilePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(records), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, storeFilePath);
    const directory = fs.openSync(path.dirname(storeFilePath), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Short synchronous critical section; no network awaits while locked. */
function transaction(operation, write = true) {
  if (!storeFilePath || !path.isAbsolute(storeFilePath)) {
    throw storeError(
      'RECEIPT_STORE_NOT_CONFIGURED',
      'Set RESERVATION_STORE_PATH to an absolute path on a shared durable volume.'
    );
  }
  const lockPath = `${storeFilePath}.lock`;
  let locked = false;
  try {
    fs.mkdirSync(path.dirname(storeFilePath), { recursive: true });
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      locked = true;
    } catch (err) {
      if (err.code === 'EEXIST')
        throw storeError('RECEIPT_STORE_BUSY', 'Receipt store is busy. Retry this operation.');
      throw err;
    }
    const records = readRecords(); // Always reload: mtime is not a consistency primitive.
    const result = operation(records);
    if (write) writeRecords(records);
    return result === undefined ? undefined : structuredClone(result);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw storeError(
      'RECEIPT_STORE_IO_ERROR',
      `Receipt reservation persistence failed: ${err.message}`
    );
  } finally {
    if (locked) fs.rmdirSync(lockPath);
  }
}

const getStorePath = () => storeFilePath;
const setStorePath = (customPath) => {
  storeFilePath = customPath;
};
const syncFromDisk = () => transaction((records) => new Map(Object.entries(records)), false);
const persistToDisk = () => transaction(() => undefined); // No mutable cache to flush.
const clearReservations = () =>
  transaction((records) => {
    for (const id of Object.keys(records)) delete records[id];
  });
const expired = (record, now = Date.now()) => now > Date.parse(record.expiresAt);
const matches = (record, actor) =>
  record.userId === actor.userId && record.entityId === actor.entityId;
const byKey = (records, key) => Object.values(records).find((record) => record.objectKey === key);

const createReservation = (input) =>
  transaction((records) => {
    if (records[input.uploadId] || byKey(records, input.objectKey))
      throw storeError('RECEIPT_RESERVATION_EXISTS', 'Reservation already exists');
    const { expiresInSeconds = 900, ...fields } = input;
    const record = {
      ...fields,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      status: STATUS.PENDING,
      createdAt: new Date().toISOString(),
    };
    records[record.uploadId] = record;
    return record;
  });

const getReservation = (id) =>
  transaction((records) => {
    const record = records[id];
    return !record || (record.status !== STATUS.CONSUMED && expired(record)) ? null : record;
  }, false);

const completeReservation = (id, actor) =>
  transaction((records) => {
    const record = records[id];
    if (!record) return { error: 'NOT_FOUND' };
    if (!matches(record, actor)) return { error: 'MISMATCH' };
    if (record.status === STATUS.CONSUMED) return { error: 'ALREADY_CONSUMED' };
    if (record.status === STATUS.CLAIMED) return { error: 'ALREADY_CLAIMED' };
    if (![STATUS.PENDING, STATUS.COMPLETED].includes(record.status))
      return { error: 'CLEANUP_IN_PROGRESS' };
    if (expired(record)) return { error: 'EXPIRED' };
    record.status = STATUS.COMPLETED;
    return { data: record };
  });

function eligible(record, actor) {
  if (!record) return { error: 'NOT_FOUND' };
  if (!matches(record, actor)) return { error: 'MISMATCH' };
  if (record.status === STATUS.CONSUMED) return { error: 'ALREADY_CONSUMED' };
  if (record.status === STATUS.CLAIMED) return { error: 'ALREADY_CLAIMED' };
  if (expired(record)) return { error: 'EXPIRED' };
  if (record.status !== STATUS.COMPLETED) return { error: 'NOT_COMPLETED' };
  return { data: record };
}

const findCompletedReservationByKey = (actor) =>
  transaction((records) => eligible(byKey(records, actor.receiptS3Key), actor), false);

const claimReservationByKey = (actor) =>
  transaction((records) => {
    const result = eligible(byKey(records, actor.receiptS3Key), actor);
    if (result.error) return result;
    const claimId = crypto.randomUUID();
    Object.assign(result.data, {
      status: STATUS.CLAIMED,
      claimId,
      claimedBy: actor.userId,
      claimedAt: new Date().toISOString(),
    });
    return { ...result, claimId };
  });

const releaseReservationByKey = (actor) =>
  transaction((records) => {
    const record = byKey(records, actor.receiptS3Key);
    if (!record) return null;
    if (!matches(record, actor)) return { error: 'MISMATCH' };
    if (record.status === STATUS.CONSUMED) return { error: 'ALREADY_CONSUMED' };
    if (record.status !== STATUS.CLAIMED) return { error: 'NOT_CLAIMED' };
    if (!actor.claimId || record.claimId !== actor.claimId) return { error: 'CLAIM_MISMATCH' };
    record.status = STATUS.COMPLETED;
    delete record.claimId;
    delete record.claimedAt;
    delete record.claimedBy;
    return { data: record };
  });

const consumeReservationByKey = (actor) =>
  transaction((records) => {
    const record = byKey(records, actor.receiptS3Key);
    if (!record || !matches(record, actor)) return null;
    if (![STATUS.CLAIMED, STATUS.COMPLETED].includes(record.status)) return null;
    if (record.status === STATUS.CLAIMED && (!actor.claimId || record.claimId !== actor.claimId))
      return null;
    Object.assign(record, {
      status: STATUS.CONSUMED,
      consumedAt: new Date().toISOString(),
      voucherId: actor.voucherId || null,
    });
    delete record.claimId;
    delete record.claimedAt;
    delete record.claimedBy;
    return record;
  });

const cleanupExpiredReservations = async ({
  now = new Date(),
  dryRun = false,
  storage = storageService,
  db = supabaseAdmin,
  consumedRetentionMs = 86400000,
  maxAgeMs,
  ttlMs,
} = {}) => {
  const currentTime = new Date(now).getTime();
  if (!Number.isFinite(currentTime)) throw new Error('Invalid cleanup time');
  const summary = {
    scanned: 0,
    cleaned: 0,
    skippedConsumed: 0,
    skippedActiveClaims: 0,
    linkedToVoucher: 0,
    prunedConsumedRecords: 0,
    deletedKeys: [],
    errors: [],
  };
  const candidates = transaction((records) => {
    const selected = [];
    for (const [id, record] of Object.entries(records)) {
      summary.scanned++;
      if (record.status === STATUS.CONSUMED) {
        summary.skippedConsumed++;
        if (
          !dryRun &&
          currentTime - Date.parse(record.consumedAt || record.expiresAt) >
            (maxAgeMs || consumedRetentionMs)
        ) {
          delete records[id];
          summary.prunedConsumedRecords++;
        }
        continue;
      }
      if (record.status === STATUS.CLAIMED) {
        summary.skippedActiveClaims++;
        continue;
      }
      const isExpired = ttlMs
        ? currentTime - Date.parse(record.createdAt) > ttlMs
        : expired(record, currentTime);
      if (isExpired || [STATUS.DELETING, STATUS.CLEANUP_FAILED].includes(record.status)) {
        if (!dryRun) record.status = STATUS.DELETING;
        selected.push(record);
      }
    }
    return selected;
  }, !dryRun);

  for (const record of candidates) {
    try {
      if (!db || typeof db.from !== 'function')
        throw new Error('Database linkage verification is unavailable');
      const { data, error } = await db
        .from('disbursements')
        .select('id')
        .eq('receipt_s3_key', record.objectKey)
        .limit(1);
      if (error)
        throw new Error(`Database linkage verification failed: ${error.message || String(error)}`);
      if (!Array.isArray(data)) throw new Error('Invalid database linkage result');
      if (data.length) {
        summary.linkedToVoucher++;
        summary.skippedConsumed++;
        if (!dryRun)
          transaction((records) => {
            const current = records[record.uploadId];
            if (current && [STATUS.DELETING, STATUS.CLEANUP_FAILED].includes(current.status)) {
              Object.assign(current, {
                status: STATUS.CONSUMED,
                voucherId: data[0].id,
                consumedAt: new Date().toISOString(),
              });
            }
          });
        continue;
      }
      if (!dryRun) {
        if (!storage || typeof storage.deleteObject !== 'function')
          throw new Error('Storage deletion is unavailable');
        await storage.deleteObject(record.objectKey);
        transaction((records) => {
          const current = records[record.uploadId];
          if (current && [STATUS.DELETING, STATUS.CLEANUP_FAILED].includes(current.status))
            delete records[record.uploadId];
        });
      }
      summary.cleaned++;
      summary.deletedKeys.push(record.objectKey);
    } catch (err) {
      summary.errors.push({
        uploadId: record.uploadId,
        objectKey: record.objectKey,
        error: err.message,
      });
      if (!dryRun)
        transaction((records) => {
          const current = records[record.uploadId];
          if (current && [STATUS.DELETING, STATUS.CLEANUP_FAILED].includes(current.status)) {
            Object.assign(current, {
              status: STATUS.CLEANUP_FAILED,
              retryCount: (current.retryCount || 0) + 1,
              lastCleanupError: err.message,
              lastCleanupAttemptAt: new Date().toISOString(),
            });
          }
        });
    }
  }
  return summary;
};

const checkReadiness = async () => {
  if (!storeFilePath || !path.isAbsolute(storeFilePath)) {
    return {
      ok: false,
      error: 'Set RESERVATION_STORE_PATH to an absolute path on a shared durable volume.',
    };
  }

  // 1. Validate read and JSON parse of existing store via transaction
  try {
    transaction((records) => {
      if (!records || typeof records !== 'object' || Array.isArray(records)) {
        throw new Error('Receipt store contains invalid records structure');
      }
      return true;
    }, false);
  } catch (err) {
    return {
      ok: false,
      error: `Receipt filesystem store is not readable or corrupt: ${err.message}`,
    };
  }

  // 2. Validate directory writability via disposable probe file
  const dir = path.dirname(storeFilePath);
  const testFile = path.join(dir, `.probe.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(testFile, 'probe', 'utf8');
    fs.unlinkSync(testFile);
    return { ok: true };
  } catch (err) {
    try {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    } catch (_) {
      /* Preserve the original readiness failure. */
    }
    return { ok: false, error: `Receipt filesystem store is not writable: ${err.message}` };
  }
};

module.exports = {
  STATUS,
  createReservation,
  getReservation,
  completeReservation,
  findCompletedReservationByKey,
  claimReservationByKey,
  releaseReservationByKey,
  consumeReservationByKey,
  consumeClaimedReservationByKey: consumeReservationByKey,
  cleanupExpiredReservations,
  clearReservations,
  setStorePath,
  getStorePath,
  syncFromDisk,
  persistToDisk,
  checkReadiness,
};
