/**
 * PostgreSQL / Supabase Database Receipt Store Driver.
 *
 * Implements durable receipt reservation storage in PostgreSQL.
 * All mutations run atomically through service-role-only stored procedures.
 * Strictly validates all database responses before authorizing voucher binding or deletion.
 * Never leaks database internals or credentials to callers.
 */
const storageService = require('../../services/storageService');
const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const logger = require('../../lib/logger');

const STATUS = Object.freeze({
  PENDING: 'pending',
  COMPLETED: 'completed',
  CLAIMED: 'claimed',
  CONSUMED: 'consumed',
  CLEANUP_FAILED: 'cleanup_failed',
  DELETING: 'deleting',
});

const getDbTimeoutMs = () => parseInt(process.env.DB_RPC_TIMEOUT_MS, 10) || 5000;
let customDbClient = null;

const setDatabaseClient = (client) => {
  customDbClient = client;
};

const getDatabaseClient = () => {
  return customDbClient || supabaseAdmin;
};

const dbUnavailableError = (internalDetail) => {
  if (internalDetail) {
    logger.error('Receipt store database unavailable', { error: internalDetail });
  }
  return new AppError({
    statusCode: 503,
    title: 'Receipt store unavailable',
    code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
    detail: 'Receipt reservation database is unavailable.',
  });
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isValidRecord = (r) =>
  isObject(r) &&
  ['uploadId', 'objectKey', 'userId', 'entityId', 'filename', 'contentType'].every(
    (field) => typeof r[field] === 'string' && r[field].length > 0
  ) &&
  Object.values(STATUS).includes(r.status) &&
  Number.isSafeInteger(r.size) &&
  r.size > 0 &&
  r.size <= 10485760 &&
  ['application/pdf', 'image/png', 'image/jpeg'].includes(r.contentType) &&
  typeof r.expiresAt === 'string' &&
  Number.isFinite(Date.parse(r.expiresAt)) &&
  typeof r.createdAt === 'string' &&
  Number.isFinite(Date.parse(r.createdAt));

const assertRecordMatches = (record, expected) => {
  if (
    !isValidRecord(record) ||
    Object.entries(expected).some(([key, value]) => value !== undefined && record[key] !== value)
  )
    throw dbUnavailableError('Reservation record does not match the requested operation');
};

const finalizeCleanup = async (params, db) => {
  const result = await callRpc('receipt_reservation_cleanup_finalize', params, { db });
  if (!isObject(result) || result.ok !== true) {
    throw dbUnavailableError('Invalid cleanup finalization response');
  }
  return result;
};

const callRpc = async (rpcName, params, options = {}) => {
  const client = options.db || getDatabaseClient();
  if (!client || typeof client.rpc !== 'function') {
    throw dbUnavailableError('Supabase client or rpc function is not available');
  }

  let timer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Database RPC timeout')), getDbTimeoutMs());
    });

    const response = await Promise.race([client.rpc(rpcName, params), timeoutPromise]);

    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw new Error('Malformed database response structure');
    }
    if (!Object.prototype.hasOwnProperty.call(response, 'data')) {
      throw new Error('Missing database result');
    }
    if (response.error) {
      throw new Error(response.error.message || String(response.error));
    }
    if (response.data === undefined) throw new Error('Missing database result');
    return response.data;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw dbUnavailableError(err.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const createReservation = async (input) => {
  const result = await callRpc('receipt_reservation_create', {
    p_upload_id: input.uploadId,
    p_user_id: input.userId,
    p_entity_id: input.entityId,
    p_entity_code: input.entityCode || null,
    p_object_key: input.objectKey,
    p_filename: input.filename,
    p_content_type: input.contentType,
    p_size: input.size,
    p_expires_in_seconds: input.expiresInSeconds ?? 900,
  });

  if (result?.error === 'RECEIPT_RESERVATION_EXISTS') {
    throw new AppError({
      statusCode: 503,
      title: 'Receipt store unavailable',
      code: 'RECEIPT_RESERVATION_EXISTS',
      detail: 'Reservation already exists',
    });
  }

  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !result.data ||
    !isValidRecord(result.data)
  ) {
    throw dbUnavailableError('Malformed reservation record from database response');
  }

  assertRecordMatches(result.data, {
    uploadId: input.uploadId,
    userId: input.userId,
    entityId: input.entityId,
    objectKey: input.objectKey,
    filename: input.filename,
    contentType: input.contentType,
    size: input.size,
    status: STATUS.PENDING,
  });
  return result.data;
};

const getReservation = async (uploadId) => {
  const result = await callRpc('receipt_reservation_get', {
    p_upload_id: uploadId,
  });

  if (result === null) {
    return null;
  }

  if (!isValidRecord(result)) {
    throw dbUnavailableError('Malformed getReservation response from database');
  }

  assertRecordMatches(result, { uploadId });
  return result;
};

const completeReservation = async (uploadId, actor) => {
  const result = await callRpc('receipt_reservation_complete', {
    p_upload_id: uploadId,
    p_user_id: actor.userId,
    p_entity_id: actor.entityId,
  });

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw dbUnavailableError('Malformed complete reservation response from database');
  }

  const validErrors = [
    'NOT_FOUND',
    'MISMATCH',
    'ALREADY_CONSUMED',
    'ALREADY_CLAIMED',
    'CLEANUP_IN_PROGRESS',
    'EXPIRED',
  ];

  if (typeof result.error === 'string' && validErrors.includes(result.error)) {
    return { error: result.error };
  }

  if (result.data) {
    if (!isValidRecord(result.data) || result.data.status !== STATUS.COMPLETED) {
      throw dbUnavailableError('Malformed complete reservation record in database response');
    }
    assertRecordMatches(result.data, {
      userId: actor.userId,
      entityId: actor.entityId,
      uploadId,
    });
    return { data: result.data };
  }

  throw dbUnavailableError('Empty or invalid complete reservation response from database');
};

const findCompletedReservationByKey = async (actor) => {
  const result = await callRpc('receipt_reservation_find_completed', {
    p_receipt_s3_key: actor.receiptS3Key,
    p_user_id: actor.userId,
    p_entity_id: actor.entityId,
  });

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw dbUnavailableError('Malformed find completed reservation response from database');
  }

  const validErrors = [
    'NOT_FOUND',
    'MISMATCH',
    'ALREADY_CONSUMED',
    'ALREADY_CLAIMED',
    'EXPIRED',
    'NOT_COMPLETED',
  ];

  if (typeof result.error === 'string' && validErrors.includes(result.error)) {
    return { error: result.error };
  }

  if (result.data) {
    if (!isValidRecord(result.data) || result.data.status !== STATUS.COMPLETED) {
      throw dbUnavailableError('Malformed find completed reservation record in database response');
    }
    assertRecordMatches(result.data, {
      userId: actor.userId,
      entityId: actor.entityId,
      objectKey: actor.receiptS3Key,
    });
    return { data: result.data };
  }

  throw dbUnavailableError('Empty or invalid find completed reservation response from database');
};

const claimReservationByKey = async (actor) => {
  const result = await callRpc('receipt_reservation_claim', {
    p_receipt_s3_key: actor.receiptS3Key,
    p_user_id: actor.userId,
    p_entity_id: actor.entityId,
    p_claim_id: actor.claimId || null,
  });

  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw dbUnavailableError('Malformed claim reservation response from database');
  }

  const validErrors = [
    'NOT_FOUND',
    'MISMATCH',
    'ALREADY_CONSUMED',
    'ALREADY_CLAIMED',
    'EXPIRED',
    'NOT_COMPLETED',
  ];

  if (typeof result.error === 'string' && validErrors.includes(result.error)) {
    return { error: result.error };
  }

  if (result.data) {
    if (!isValidRecord(result.data) || result.data.status !== STATUS.CLAIMED) {
      throw dbUnavailableError('Malformed claim reservation record in database response');
    }
    if (
      typeof result.claimId !== 'string' ||
      result.claimId.length === 0 ||
      result.claimId !== result.data.claimId
    ) {
      throw dbUnavailableError('Missing or mismatched claim token in database response');
    }
    assertRecordMatches(result.data, {
      userId: actor.userId,
      entityId: actor.entityId,
      objectKey: actor.receiptS3Key,
    });
    return { data: result.data, claimId: result.claimId };
  }

  throw dbUnavailableError('Empty or invalid claim reservation response from database');
};

const releaseReservationByKey = async (actor) => {
  const result = await callRpc('receipt_reservation_release', {
    p_receipt_s3_key: actor.receiptS3Key,
    p_user_id: actor.userId,
    p_entity_id: actor.entityId,
    p_claim_id: actor.claimId,
  });

  if (result === null) {
    return null;
  }

  if (typeof result !== 'object' || Array.isArray(result)) {
    throw dbUnavailableError('Malformed release reservation response from database');
  }

  const validErrors = ['MISMATCH', 'ALREADY_CONSUMED', 'NOT_CLAIMED', 'CLAIM_MISMATCH'];

  if (typeof result.error === 'string' && validErrors.includes(result.error)) {
    return { error: result.error };
  }

  if (result.data) {
    if (!isValidRecord(result.data) || result.data.status !== STATUS.COMPLETED) {
      throw dbUnavailableError('Malformed release reservation record in database response');
    }
    assertRecordMatches(result.data, {
      userId: actor.userId,
      entityId: actor.entityId,
      objectKey: actor.receiptS3Key,
    });
    return { data: result.data };
  }

  throw dbUnavailableError('Empty or invalid release reservation response from database');
};

const consumeReservationByKey = async (actor) => {
  const result = await callRpc('receipt_reservation_consume', {
    p_receipt_s3_key: actor.receiptS3Key,
    p_user_id: actor.userId,
    p_entity_id: actor.entityId,
    p_claim_id: actor.claimId || null,
    p_voucher_id: actor.voucherId || null,
  });

  if (result === null) {
    return null;
  }

  if (!isValidRecord(result) || result.status !== STATUS.CONSUMED) {
    throw dbUnavailableError('Malformed consume reservation response from database');
  }

  assertRecordMatches(result, {
    userId: actor.userId,
    entityId: actor.entityId,
    objectKey: actor.receiptS3Key,
    voucherId: actor.voucherId || null,
  });
  return result;
};

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

  const selectResult = await callRpc(
    'receipt_reservation_cleanup_select',
    {
      p_now: new Date(currentTime).toISOString(),
      p_dry_run: Boolean(dryRun),
      p_consumed_retention_ms: maxAgeMs || consumedRetentionMs,
      p_ttl_ms: ttlMs || null,
    },
    { db }
  );

  if (!selectResult || typeof selectResult !== 'object' || Array.isArray(selectResult)) {
    throw dbUnavailableError('Malformed cleanup select response');
  }

  if (!Array.isArray(selectResult.candidates)) {
    throw dbUnavailableError('Malformed cleanup candidates list from database');
  }

  summary.scanned = Number(selectResult.scanned) || 0;
  summary.skippedConsumed = Number(selectResult.skippedConsumed) || 0;
  summary.skippedActiveClaims = Number(selectResult.skippedActiveClaims) || 0;
  summary.prunedConsumedRecords = Number(selectResult.prunedConsumedRecords) || 0;

  for (const candidate of selectResult.candidates) {
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      typeof candidate.uploadId !== 'string' ||
      !candidate.uploadId ||
      typeof candidate.objectKey !== 'string' ||
      !candidate.objectKey ||
      ![STATUS.DELETING, STATUS.CLEANUP_FAILED, STATUS.PENDING, STATUS.COMPLETED].includes(
        candidate.status
      ) ||
      (!dryRun && candidate.status !== STATUS.DELETING)
    ) {
      throw dbUnavailableError('Malformed cleanup candidate record in candidate list');
    }
  }

  for (const field of [
    'scanned',
    'skippedConsumed',
    'skippedActiveClaims',
    'prunedConsumedRecords',
  ]) {
    if (!Number.isSafeInteger(selectResult[field]) || selectResult[field] < 0) {
      throw dbUnavailableError('Invalid cleanup summary');
    }
  }
  const candidates = selectResult.candidates;

  for (const candidate of candidates) {
    try {
      if (!db || typeof db.from !== 'function') {
        throw new Error('Database linkage verification is unavailable');
      }
      const { data, error } = await db
        .from('disbursements')
        .select('id')
        .eq('receipt_s3_key', candidate.objectKey)
        .limit(1);

      if (error) {
        throw new Error(`Database linkage verification failed: ${error.message || String(error)}`);
      }
      if (!Array.isArray(data)) {
        throw new Error('Invalid database linkage result');
      }

      if (data.length > 0) {
        summary.linkedToVoucher++;
        summary.skippedConsumed++;
        if (!dryRun) {
          await finalizeCleanup(
            {
              p_upload_id: candidate.uploadId,
              p_action: 'linked',
              p_voucher_id: data[0].id,
            },
            db
          );
        }
        continue;
      }

      if (!dryRun) {
        if (!storage || typeof storage.deleteObject !== 'function') {
          throw new Error('Storage deletion is unavailable');
        }
        await storage.deleteObject(candidate.objectKey);
        await finalizeCleanup(
          {
            p_upload_id: candidate.uploadId,
            p_action: 'deleted',
          },
          db
        );
      }
      summary.cleaned++;
      summary.deletedKeys.push(candidate.objectKey);
    } catch (err) {
      summary.errors.push({
        uploadId: candidate.uploadId,
        objectKey: candidate.objectKey,
        error: err.message,
      });
      if (!dryRun) {
        try {
          await finalizeCleanup(
            {
              p_upload_id: candidate.uploadId,
              p_action: 'failed',
              p_error: err.message,
            },
            db
          );
        } catch (_finalizeErr) {
          // Swallow finalize error to preserve batch progress
        }
      }
    }
  }

  return summary;
};

const clearReservations = async () => {
  const result = await callRpc('receipt_reservation_clear', {});
  if (!isObject(result) || result.ok !== true) throw dbUnavailableError('Invalid clear response');
};

const checkReadiness = async () => {
  try {
    const result = await callRpc('receipt_reservation_probe', {});
    if (typeof result?.ok !== 'boolean' || result.ok !== true) {
      return { ok: false, error: 'Database readiness probe returned non-ok result.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'Receipt reservation database probe failed.' };
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
  checkReadiness,
  setDatabaseClient,
  getDatabaseClient,
};
