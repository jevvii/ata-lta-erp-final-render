/**
 * Receipt Reservation Store Facade.
 *
 * Coordinates driver selection between PostgreSQL database storage and shared-filesystem storage.
 * Follows contract C2:
 *   - RESERVATION_STORE_DRIVER=database|filesystem
 *   - Explicit invalid values fail closed (RECEIPT_STORE_NOT_CONFIGURED).
 *   - If unset: honors RESERVATION_STORE_PATH for filesystem compatibility;
 *     otherwise production chooses database and development/test use filesystem default.
 *   - Never silently falls back from database errors to a local file or memory.
 */
const fsDriver = require('./receiptStoreFilesystem');
const dbDriver = require('./receiptStoreDatabase');
const AppError = require('../../lib/AppError');
const logger = require('../../lib/logger');

let explicitDriver = null;

const storeError = (code, detail) =>
  new AppError({ statusCode: 503, title: 'Receipt store unavailable', code, detail });

const resolveDriver = () => {
  if (explicitDriver) {
    return explicitDriver;
  }

  const envDriver = process.env.RESERVATION_STORE_DRIVER;
  if (envDriver !== undefined) {
    const normalized = String(envDriver).trim().toLowerCase();
    if (normalized === 'database' || normalized === 'filesystem') {
      return normalized;
    }
    throw storeError(
      'RECEIPT_STORE_NOT_CONFIGURED',
      `Invalid RESERVATION_STORE_DRIVER: "${envDriver}". Must be "database" or "filesystem".`
    );
  }

  if (process.env.RESERVATION_STORE_PATH) {
    return 'filesystem';
  }

  if (process.env.NODE_ENV === 'production') {
    return 'database';
  }

  return 'filesystem';
};

const setStoreDriver = (driver) => {
  if (driver === null || driver === undefined) {
    explicitDriver = null;
    return;
  }
  const normalized = String(driver).trim().toLowerCase();
  if (normalized === 'database' || normalized === 'filesystem') {
    explicitDriver = normalized;
    return;
  }
  throw storeError(
    'RECEIPT_STORE_NOT_CONFIGURED',
    `Invalid RESERVATION_STORE_DRIVER: "${driver}". Must be "database" or "filesystem".`
  );
};

const getStoreDriver = () => resolveDriver();

const getActiveDriver = () => {
  const driver = resolveDriver();
  return driver === 'database' ? dbDriver : fsDriver;
};

// Delegated methods: synchronous when using fsDriver, asynchronous when using dbDriver.
const createReservation = (input) => getActiveDriver().createReservation(input);
const getReservation = (id) => getActiveDriver().getReservation(id);
const completeReservation = (id, actor) => getActiveDriver().completeReservation(id, actor);
const findCompletedReservationByKey = (actor) =>
  getActiveDriver().findCompletedReservationByKey(actor);
const claimReservationByKey = (actor) => getActiveDriver().claimReservationByKey(actor);
const releaseReservationByKey = (actor) => getActiveDriver().releaseReservationByKey(actor);
const consumeReservationByKey = (actor) => getActiveDriver().consumeReservationByKey(actor);
const cleanupExpiredReservations = (options) =>
  getActiveDriver().cleanupExpiredReservations(options);
const clearReservations = () => getActiveDriver().clearReservations();

const checkReceiptStoreReadiness = async () => {
  try {
    const driver = resolveDriver();
    const active = driver === 'database' ? dbDriver : fsDriver;
    return await active.checkReadiness();
  } catch (err) {
    if (err instanceof AppError && err.code === 'RECEIPT_STORE_NOT_CONFIGURED') {
      return { ok: false, error: err.detail };
    }
    return { ok: false, error: err.message };
  }
};

let periodicCleanupTimer = null;

const startPeriodicReceiptCleanup = (intervalMs = 900000, options = {}) => {
  if (periodicCleanupTimer) return periodicCleanupTimer;

  try {
    const driver = resolveDriver();
    if (driver === 'filesystem') {
      const storePath = fsDriver.getStorePath();
      if (!storePath) return null;
    }
  } catch (_err) {
    return null;
  }

  periodicCleanupTimer = setInterval(() => {
    cleanupExpiredReservations(options)
      .then((summary) => {
        if (summary.errors && summary.errors.length) {
          logger.error('[receipt-cleanup]', { errors: summary.errors });
        }
      })
      .catch((err) => {
        logger.error('[receipt-cleanup]', { error: err.message });
      });
  }, intervalMs);

  periodicCleanupTimer.unref();
  return periodicCleanupTimer;
};

const stopPeriodicReceiptCleanup = () => {
  if (periodicCleanupTimer) {
    clearInterval(periodicCleanupTimer);
    periodicCleanupTimer = null;
  }
};

module.exports = {
  STATUS: fsDriver.STATUS,
  resolveDriver,
  setStoreDriver,
  getStoreDriver,
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
  checkReceiptStoreReadiness,
  startPeriodicReceiptCleanup,
  stopPeriodicReceiptCleanup,
  // Filesystem backward-compatibility exports
  getStorePath: fsDriver.getStorePath,
  setStorePath: fsDriver.setStorePath,
  syncFromDisk: fsDriver.syncFromDisk,
  persistToDisk: fsDriver.persistToDisk,
  // Database test helpers
  setDatabaseClient: dbDriver.setDatabaseClient,
  getDatabaseClient: dbDriver.getDatabaseClient,
};
