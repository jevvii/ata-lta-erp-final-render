/**
 * Project Linkage and Authorization Validator
 *
 * Enforces canonical task, legacy task, parent WR, and entity consistency
 * across invoices, disbursements, transmittals, and documents.
 * NOTE: tasks table has NO entity_id column; task entity is derived from its parent work_request.
 */

const { supabaseAdmin } = require('../services/supabaseClient');
const AppError = require('./AppError');
const {
  getUserConcernedWorkRequestIds,
  isUserEntitledToEntity,
  isValidUUID,
} = require('./userScope');

/**
 * Resolves the stored task ID from a record using canonical nullish precedence.
 * Fails closed on malformed empty string or conflicting non-empty keys.
 */
const resolveExistingStoredTaskId = (record) => {
  if (!record) return null;

  const hasCanonical = record.task_id !== undefined && record.task_id !== null;
  const hasLegacy = record.linked_task_id !== undefined && record.linked_task_id !== null;

  if (hasCanonical && hasLegacy) {
    const canonical = String(record.task_id).trim();
    const legacy = String(record.linked_task_id).trim();

    if (canonical && legacy && canonical !== legacy) {
      throw new AppError({
        statusCode: 400,
        title: 'Conflict',
        detail: 'Stored task linkage is corrupt (canonical task_id conflicts with legacy linked_task_id)',
        code: 'STORED_TASK_LINKAGE_CONFLICT',
      });
    }

    if (canonical === '') {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Stored canonical task_id is malformed',
        code: 'MALFORMED_STORED_TASK_ID',
      });
    }

    return canonical;
  }

  if (hasCanonical) {
    const canonical = String(record.task_id).trim();
    if (canonical === '') {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Stored canonical task_id is malformed',
        code: 'MALFORMED_STORED_TASK_ID',
      });
    }
    return canonical;
  }

  if (hasLegacy) {
    const legacy = String(record.linked_task_id).trim();
    if (legacy === '') {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Stored legacy linked_task_id is malformed',
        code: 'MALFORMED_STORED_TASK_ID',
      });
    }
    return legacy;
  }

  return null;
};

/**
 * Resolves the stored work request ID from a record using canonical nullish precedence.
 * Fails closed on malformed empty string or conflicting non-empty keys.
 */
const resolveExistingStoredWrId = (record) => {
  if (!record) return null;

  const hasCanonical = record.work_request_id !== undefined && record.work_request_id !== null;
  const hasLegacy =
    record.linked_work_request_id !== undefined && record.linked_work_request_id !== null;

  if (hasCanonical && hasLegacy) {
    const canonical = String(record.work_request_id).trim();
    const legacy = String(record.linked_work_request_id).trim();

    if (canonical && legacy && canonical !== legacy) {
      throw new AppError({
        statusCode: 400,
        title: 'Conflict',
        detail:
          'Stored work request linkage is corrupt (canonical work_request_id conflicts with legacy linked_work_request_id)',
        code: 'STORED_WR_LINKAGE_CONFLICT',
      });
    }

    if (canonical === '') {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Stored canonical work_request_id is malformed',
        code: 'MALFORMED_STORED_WR_ID',
      });
    }

    return canonical;
  }

  if (hasCanonical) {
    const canonical = String(record.work_request_id).trim();
    if (canonical === '') {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Stored canonical work_request_id is malformed',
        code: 'MALFORMED_STORED_WR_ID',
      });
    }
    return canonical;
  }

  if (hasLegacy) {
    const legacy = String(record.linked_work_request_id).trim();
    if (legacy === '') {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Stored legacy linked_work_request_id is malformed',
        code: 'MALFORMED_STORED_WR_ID',
      });
    }
    return legacy;
  }

  return null;
};

/**
 * Validate single record linkage and user authorization.
 *
 * @param {object} params
 * @param {object} params.record - Stored record
 * @param {string} [params.entityId] - Caller active entity
 * @param {object} [params.user] - Authenticated caller
 * @param {boolean} [params.internal=false] - When true, bypasses user project membership check
 * @returns {Promise<boolean>}
 */
const validateRecordProjectLinkage = async ({
  record,
  entityId,
  user,
  internal = false,
}) => {
  if (!record) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Record not found' });
  }

  // 1. Resolve canonical task ID and claimed WR ID with strict conflict / malformed checks
  const effectiveTaskId = resolveExistingStoredTaskId(record);
  const claimedWrId = resolveExistingStoredWrId(record);

  let effectiveWrId = claimedWrId;

  // 2. If task linked, validate task exists, is active, and matches WR
  // NOTE: tasks table has NO entity_id column; task entity is derived from its parent work_request.
  if (effectiveTaskId) {
    const { data: task, error: taskErr } = await supabaseAdmin
      .from('tasks')
      .select('id, work_request_id, deleted_at')
      .eq('id', effectiveTaskId)
      .maybeSingle();

    if (taskErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to retrieve task for record: ${taskErr.message || String(taskErr)}`,
      });
    }

    if (!task || task.deleted_at) {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Associated task not found or deleted',
      });
    }

    if (claimedWrId && task.work_request_id !== claimedWrId) {
      throw new AppError({
        statusCode: 400,
        title: 'Conflict',
        detail: 'Record claimed work request conflicts with canonical task work request',
        code: 'CONFLICTING_TASK_PARENT',
      });
    }

    effectiveWrId = task.work_request_id;
  }

  // 3. If parent WR exists, validate WR exists, is active, and matches entity
  if (effectiveWrId) {
    const { data: wr, error: wrErr } = await supabaseAdmin
      .from('work_requests')
      .select('id, entity_id, deleted_at, creation_approval_status')
      .eq('id', effectiveWrId)
      .maybeSingle();

    if (wrErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to retrieve parent work request: ${wrErr.message || String(wrErr)}`,
      });
    }

    if (!internal && (!wr || wr.deleted_at)) {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Parent work request not found or deleted',
      });
    }

    if (!wr) return true;

    if (!internal && wr.creation_approval_status && wr.creation_approval_status !== 'approved') {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Parent work request not found or deleted',
      });
    }

    if (record.entity_id && wr.entity_id && record.entity_id !== wr.entity_id) {
      throw new AppError({
        statusCode: 400,
        title: 'Conflict',
        detail: 'Record entity conflicts with parent work request entity',
        code: 'CONFLICTING_WR_ENTITY',
      });
    }

    // 4. Entity boundary verification against caller scope
    if (entityId && entityId !== 'ALL' && wr.entity_id && wr.entity_id !== entityId) {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Record not found for active entity',
      });
    }

    if (entityId === 'ALL' && user) {
      const entitled = await isUserEntitledToEntity(wr.entity_id, user);
      if (!entitled) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'You do not have permission to view records for this entity.',
          code: 'FORBIDDEN',
        });
      }
    }
  } else {
    // Record has no task and no WR (orphan / unlinked)
    if (!internal && user?.role !== 'Admin') {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Orphan record not accessible to non-admin users',
      });
    }
  }

  // 5. User authorization
  if (internal) return true;
  if (!user) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required',
    });
  }
  if (user.role === 'Admin') return true;

  const concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
  if (!effectiveWrId || !concernedWrIds.includes(effectiveWrId)) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'You do not have permission to view this record.',
      code: 'FORBIDDEN',
    });
  }

  return true;
};

/**
 * Filter a list of records in batch, removing conflicting, corrupt, deleted-parent,
 * or unauthorized project rows. Handles task-only legacy records by loading their
 * task's parent WR. Fails closed on database errors.
 *
 * @param {object[]} rows
 * @param {object} context
 * @param {object} context.user
 * @param {string} [context.entityId]
 * @param {string[]} [context.concernedWrIds]
 * @returns {Promise<object[]>}
 */
const filterValidProjectRecords = async (rows, { user, entityId, concernedWrIds }) => {
  if (!rows || rows.length === 0) return [];

  // Step 1: Safely resolve task IDs for all rows
  const rowTaskMap = new Map();
  const rowWrMap = new Map();
  const validTaskIds = new Set();
  const validClaimedWrIds = new Set();

  for (const row of rows) {
    try {
      const tId = resolveExistingStoredTaskId(row);
      if (tId) {
        rowTaskMap.set(row, tId);
        validTaskIds.add(tId);
      }
      const wId = resolveExistingStoredWrId(row);
      if (wId) {
        rowWrMap.set(row, wId);
        validClaimedWrIds.add(wId);
      }
    } catch {
      // Row has malformed or conflicting stored IDs; exclude from list results
      rowTaskMap.set(row, '__CONFLICT__');
    }
  }

  // Step 2: Batch load referenced tasks (NO tasks.entity_id!)
  const taskIdsArray = Array.from(validTaskIds).filter(isValidUUID);
  const loadedTasks = [];
  for (let i = 0; i < taskIdsArray.length; i += 500) {
    const chunk = taskIdsArray.slice(i, i + 500);
    const { data: tData, error: tErr } = await supabaseAdmin
      .from('tasks')
      .select('id, work_request_id, deleted_at')
      .in('id', chunk);

    if (tErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to batch load tasks: ${tErr.message || String(tErr)}`,
      });
    }
    if (tData) loadedTasks.push(...tData);
  }

  const taskMap = new Map(loadedTasks.map((t) => [t.id, t]));

  // Step 3: Collect all WR IDs to load (including parent WRs of task-only legacy records)
  const allWrIds = new Set(validClaimedWrIds);
  for (const t of loadedTasks) {
    if (t.work_request_id && isValidUUID(t.work_request_id)) {
      allWrIds.add(t.work_request_id);
    }
  }

  const wrIdsArray = Array.from(allWrIds).filter(isValidUUID);
  const loadedWrs = [];
  for (let i = 0; i < wrIdsArray.length; i += 500) {
    const chunk = wrIdsArray.slice(i, i + 500);
    const { data: wData, error: wErr } = await supabaseAdmin
      .from('work_requests')
      .select('id, entity_id, deleted_at, creation_approval_status')
      .in('id', chunk);

    if (wErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to batch load work requests: ${wErr.message || String(wErr)}`,
      });
    }
    if (wData) loadedWrs.push(...wData);
  }

  const wrMap = new Map(loadedWrs.map((w) => [w.id, w]));
  const isAdmin = user?.role === 'Admin';
  const allowedWrSet = concernedWrIds ? new Set(concernedWrIds) : null;

  return rows.filter((row) => {
    // Exclude rows with malformed or conflicting task/WR linkages
    if (rowTaskMap.get(row) === '__CONFLICT__') return false;

    const effectiveTaskId = rowTaskMap.get(row) || null;
    const claimedWrId = rowWrMap.get(row) || null;
    let effectiveWrId = claimedWrId;

    if (effectiveTaskId) {
      const task = taskMap.get(effectiveTaskId);
      if (!task || task.deleted_at) return false;
      if (claimedWrId && task.work_request_id !== claimedWrId) return false;
      effectiveWrId = task.work_request_id;
    }

    if (effectiveWrId) {
      const wr = wrMap.get(effectiveWrId);
      if (!wr || wr.deleted_at) return false;
      if (wr.creation_approval_status && wr.creation_approval_status !== 'approved') return false;
      if (row.entity_id && wr.entity_id && row.entity_id !== wr.entity_id) return false;

      // Entity scope filtering
      if (entityId && entityId !== 'ALL' && wr.entity_id !== entityId) return false;
    } else {
      // Orphan record without WR or task parent
      if (!isAdmin) return false;
    }

    if (!isAdmin) {
      if (!effectiveWrId || !allowedWrSet || !allowedWrSet.has(effectiveWrId)) {
        return false;
      }
    }

    return true;
  });
};

module.exports = {
  resolveExistingStoredTaskId,
  resolveExistingStoredWrId,
  validateRecordProjectLinkage,
  filterValidProjectRecords,
};
