/**
 * Task Assignment and Linkage Authorization Helper
 *
 * Provides authoritative resolution and validation for task/work-request targets,
 * alias normalization, fail-closed assignment checks, and relinking guards.
 */

const { supabaseAdmin } = require('../services/supabaseClient');
const AppError = require('./AppError');

const TASK_ALIAS_KEYS = ['taskId', 'task_id', 'linkedTaskId', 'linked_task_id'];
const WR_ALIAS_KEYS = [
  'workRequestId',
  'work_request_id',
  'linkedWorkRequestId',
  'linked_work_request_id',
];

/**
 * Resolves the existing stored task ID from a record using canonical nullish precedence.
 * Fails closed on malformed empty string or conflicting stored keys.
 *
 * @param {object} existing
 * @returns {string|null}
 */
const resolveExistingStoredTaskId = (existing) => {
  if (!existing) return null;

  const hasCanonical = existing.task_id !== undefined && existing.task_id !== null;
  const hasLegacy = existing.linked_task_id !== undefined && existing.linked_task_id !== null;

  if (hasCanonical && hasLegacy) {
    const canonical = String(existing.task_id).trim();
    const legacy = String(existing.linked_task_id).trim();

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
    const canonical = String(existing.task_id).trim();
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
    const legacy = String(existing.linked_task_id).trim();
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
 * Normalizes task and parent work request aliases from an input payload.
 * Inspects both root data and data.payload (for operationsRequests).
 * Rejects conflicting non-empty aliases with 400.
 * Preserves explicit null/empty clear intent (returning null) vs omission (returning undefined).
 *
 * @param {object} data
 * @returns {{ effectiveTaskId: string|null|undefined, effectiveWrId: string|null|undefined }}
 */
const normalizeTaskAndParentAliases = (data = {}) => {
  if (!data || typeof data !== 'object') {
    return { effectiveTaskId: undefined, effectiveWrId: undefined };
  }

  const payload = data.payload && typeof data.payload === 'object' ? data.payload : null;

  // 1. Task aliases
  const rawTaskValues = [];
  let taskKeyPresent = false;

  for (const key of TASK_ALIAS_KEYS) {
    if (key in data) {
      taskKeyPresent = true;
      rawTaskValues.push(data[key]);
    }
    if (payload && key in payload) {
      taskKeyPresent = true;
      rawTaskValues.push(payload[key]);
    }
  }

  const nonEmptyTasks = [
    ...new Set(
      rawTaskValues
        .filter((val) => val !== null && val !== undefined)
        .map((val) => String(val).trim())
        .filter((val) => val !== '')
    ),
  ];

  if (nonEmptyTasks.length > 1) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Conflicting task identifiers provided in request',
      code: 'CONFLICTING_TASK_ALIASES',
    });
  }

  let effectiveTaskId = undefined;
  if (nonEmptyTasks.length === 1) {
    effectiveTaskId = nonEmptyTasks[0];
  } else if (taskKeyPresent) {
    effectiveTaskId = null;
  }

  // 2. Work request aliases
  const rawWrValues = [];
  let wrKeyPresent = false;

  for (const key of WR_ALIAS_KEYS) {
    if (key in data) {
      wrKeyPresent = true;
      rawWrValues.push(data[key]);
    }
    if (payload && key in payload) {
      wrKeyPresent = true;
      rawWrValues.push(payload[key]);
    }
  }

  const nonEmptyWrs = [
    ...new Set(
      rawWrValues
        .filter((val) => val !== null && val !== undefined)
        .map((val) => String(val).trim())
        .filter((val) => val !== '')
    ),
  ];

  if (nonEmptyWrs.length > 1) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Conflicting work request identifiers provided in request',
      code: 'CONFLICTING_WORK_REQUEST_ALIASES',
    });
  }

  let effectiveWrId = undefined;
  if (nonEmptyWrs.length === 1) {
    effectiveWrId = nonEmptyWrs[0];
  } else if (wrKeyPresent) {
    effectiveWrId = null;
  }

  return { effectiveTaskId, effectiveWrId };
};

/**
 * Check whether a user is assigned to a specific task.
 * Checks relational task_assignees join table first, then legacy tasks.assignee_id.
 * Query errors fail closed (500).
 *
 * @param {string} taskId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
const isUserAssignedToTask = async (taskId, userId) => {
  if (!taskId || !userId) return false;

  // 1. Check relational join table task_assignees
  const { data: assignment, error: assignError } = await supabaseAdmin
    .from('task_assignees')
    .select('id')
    .eq('task_id', taskId)
    .eq('user_id', userId)
    .maybeSingle();

  if (assignError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: assignError.message,
    });
  }

  if (assignment) {
    return true;
  }

  // 2. Fallback: check tasks table for primary lead assignee_id
  const { data: task, error: taskError } = await supabaseAdmin
    .from('tasks')
    .select('id, assignee_id')
    .eq('id', taskId)
    .maybeSingle();

  if (taskError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: taskError.message,
    });
  }

  if (!task) {
    return false;
  }

  return task.assignee_id === userId;
};

/**
 * Resolves a trusted user object from context or database.
 * Never trusts request body identity. Fails closed on database query errors.
 *
 * @param {object} params
 * @param {object} [params.user]
 * @param {string} [params.userId]
 * @returns {Promise<object|null>}
 */
const resolveTrustedUser = async ({ user, userId }) => {
  if (user && user.role) {
    return user;
  }

  const lookupId = user?.id || userId;
  if (!lookupId) return null;

  const { data: u, error } = await supabaseAdmin
    .from('users')
    .select('id, role')
    .eq('id', lookupId)
    .maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: `Failed to resolve user context: ${error.message}`,
    });
  }

  if (u) {
    return { ...user, ...u };
  }

  return user || null;
};

/**
 * Enforces task status selectability rules on new or changed linkages.
 * Cancelled tasks are never selectable. Completed/done tasks are only selectable for invoices.
 *
 * @param {object} taskRow
 * @param {string} [recordType='other']
 */
const assertTaskSelectable = (taskRow, recordType = 'other') => {
  if (!taskRow || !taskRow.status) return;
  const normStatus = String(taskRow.status).trim().toLowerCase();
  if (normStatus === 'cancelled') {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Task is cancelled and cannot be linked',
      code: 'TASK_NOT_SELECTABLE',
    });
  }
  if ((normStatus === 'completed' || normStatus === 'done') && recordType !== 'invoice') {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Completed tasks cannot be linked to this record',
      code: 'TASK_NOT_SELECTABLE',
    });
  }
};

/**
 * Resolves and validates a target task and its parent work request.
 * Enforces entity boundaries and assignment authorization.
 *
 * @param {object} params
 * @param {string} params.entityId - Active entity UUID
 * @param {object} [params.user]
 * @param {string} [params.userId]
 * @param {string|null} [params.targetTaskId]
 * @param {string|null} [params.targetWorkRequestId]
 * @param {string|null} [params.clientId]
 * @param {boolean} [params.allowNoTask=true]
 * @param {string} [params.recordType='other'] - 'invoice' allows completed tasks when selectability is enforced
 * @param {boolean} [params.enforceSelectability=false] - Reject cancelled (and, for non-invoices, completed) tasks
 * @returns {Promise<{ task: object|null, workRequest: object|null, effectiveTaskId: string|null, effectiveWrId: string|null }>}
 */
const resolveAndAuthorizeTaskTarget = async ({
  entityId,
  user,
  userId,
  targetTaskId,
  targetWorkRequestId,
  clientId,
  allowNoTask = true,
  recordType = 'other',
  enforceSelectability = false,
}) => {
  const effectiveUser = await resolveTrustedUser({ user, userId });

  if (!targetTaskId) {
    if (!allowNoTask) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'A valid linked task is required',
        code: 'TASK_REQUIRED',
      });
    }

    return {
      task: null,
      workRequest: null,
      effectiveTaskId: null,
      effectiveWrId: targetWorkRequestId || null,
    };
  }

  // Task mutation must have resolved entity context; fail closed on missing/ALL (Correction 3)
  if (!entityId || entityId === 'ALL') {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'An explicit entity context is required for task-linked operations',
      code: 'ENTITY_CONTEXT_REQUIRED',
    });
  }

  // 1. Fetch and validate task
  const { data: taskRow, error: taskErr } = await supabaseAdmin
    .from('tasks')
    .select('id, work_request_id, assignee_id, status, deleted_at')
    .eq('id', targetTaskId)
    .maybeSingle();

  if (taskErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: taskErr.message,
    });
  }

  if (!taskRow || Boolean(taskRow.deleted_at)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Linked task "${targetTaskId}" was not found or has been deleted`,
      code: 'TASK_NOT_FOUND',
    });
  }

  // 2. Validate parent WR association
  if (targetWorkRequestId && taskRow.work_request_id !== targetWorkRequestId) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Task does not belong to work request',
      code: 'TASK_WR_MISMATCH',
    });
  }

  const effectiveWrId = targetWorkRequestId || taskRow.work_request_id;
  if (!effectiveWrId) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Task is not associated with an active work request',
      code: 'TASK_WR_MISMATCH',
    });
  }

  // 3. Fetch and validate parent work request
  const { data: wrRow, error: wrErr } = await supabaseAdmin
    .from('work_requests')
    .select('id, client_id, entity_id, deleted_at')
    .eq('id', effectiveWrId)
    .maybeSingle();

  if (wrErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: wrErr.message,
    });
  }

  if (!wrRow || Boolean(wrRow.deleted_at)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Work request not found or has been deleted',
      code: 'WORK_REQUEST_NOT_FOUND',
    });
  }

  // Exact resolved entity equality required; absent/malformed parent entity fails closed (Correction 4)
  if (!wrRow.entity_id || wrRow.entity_id !== entityId) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Work request does not belong to active entity',
      code: 'INVALID_WORK_REQUEST',
    });
  }

  if (clientId && wrRow.client_id !== clientId) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'The client must match the selected work request',
      code: 'CLIENT_WR_MISMATCH',
    });
  }

  // 4. Task selectability (only for new/changed linkages on mandatory-task records)
  if (enforceSelectability) {
    assertTaskSelectable(taskRow, recordType);
  }

  // 5. Task Assignment authorization
  const isAdmin = effectiveUser?.role === 'Admin';
  if (!isAdmin) {
    const callerId = effectiveUser?.id || userId;
    const assigned = await isUserAssignedToTask(targetTaskId, callerId);
    if (!assigned) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'You are not assigned to this task',
        code: 'TASK_ASSIGNMENT_REQUIRED',
      });
    }
  }

  return {
    task: taskRow,
    workRequest: wrRow,
    effectiveTaskId: targetTaskId,
    effectiveWrId,
  };
};

/**
 * Authorizes a relinking or unlinking attempt on an existing record.
 * Distinguishes actual effective linkage changes from ordinary edits that echo unchanged links.
 * Validates origin scope for both Admin and non-admin on actual changes (Correction 3).
 * Non-admin requires assignment to origin task. Destination clear cannot skip origin validation.
 * Normalizes and returns derived parent consistently (Correction 2).
 *
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.user]
 * @param {string} [params.userId]
 * @param {object} params.existing - Stored record row
 * @param {string|null|undefined} params.payloadTaskId - Normalized target task ID from payload
 * @param {string|null|undefined} params.payloadWrId - Normalized work request ID from payload
 * @param {string|null} [params.clientId]
 * @param {string} [params.recordType='other']
 * @param {boolean} [params.allowNoTask=true]
 * @returns {Promise<{ isLinkageChanged: boolean, effectiveTaskId: string|null, effectiveWrId: string|null, canonicalPair: { task_id: string|null, linked_task_id: string|null }|null }>}
 */
const authorizeTaskRelink = async ({
  entityId,
  user,
  userId,
  existing,
  payloadTaskId,
  payloadWrId,
  clientId,
  recordType = 'other',
  allowNoTask = true,
}) => {
  const effectiveUser = await resolveTrustedUser({ user, userId });

  const existingTaskId = resolveExistingStoredTaskId(existing);
  const existingWrId = existing.work_request_id || existing.linked_work_request_id || null;

  const isTaskSpecified = payloadTaskId !== undefined;
  const isWrSpecified = payloadWrId !== undefined;
  const isLinkageInPayload = isTaskSpecified || isWrSpecified;

  const taskChanged = isTaskSpecified && payloadTaskId !== existingTaskId;
  const wrChanged = isWrSpecified && payloadWrId !== existingWrId;

  const destinationTaskId = isTaskSpecified ? payloadTaskId : existingTaskId;
  let destinationWrId = isWrSpecified ? payloadWrId : existingWrId;

  // An effective linkage change occurs when:
  // - task is changed (different task or explicitly unlinked to null)
  // - OR parent WR is changed while a task is currently linked (changed parent-only payload)
  const isLinkageChanged = taskChanged || (Boolean(existingTaskId) && wrChanged);

  if (!isLinkageChanged) {
    if (isLinkageInPayload && !allowNoTask && destinationWrId) {
      if (!destinationTaskId) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'A valid linked task is required',
          code: 'TASK_REQUIRED',
        });
      }

      const { data: storedTask } = await supabaseAdmin
        .from('tasks')
        .select('id, deleted_at')
        .eq('id', existingTaskId)
        .maybeSingle();

      if (!storedTask || Boolean(storedTask.deleted_at)) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'The previously linked task has been deleted. A valid linked task is required.',
          code: 'TASK_REQUIRED',
        });
      }
    }

    return {
      isLinkageChanged: false,
      effectiveTaskId: existingTaskId,
      effectiveWrId: existingWrId,
      canonicalPair: null,
    };
  }

  // On an actual effective linkage change:
  // 1. Origin validation: validate origin active task/parent/entity for both non-admin and Admin! (Correction 3)
  // Non-admins also require assignment to origin task. Destination clear cannot skip this.
  const originClientId = existing.client_id || existing.clientId || null;
  if (existingTaskId) {
    await resolveAndAuthorizeTaskTarget({
      entityId,
      user: effectiveUser,
      userId,
      targetTaskId: existingTaskId,
      targetWorkRequestId: existingWrId,
      clientId: originClientId,
      allowNoTask: true,
      recordType,
      enforceSelectability: false,
    });
  }

  if (!destinationTaskId && destinationWrId && !allowNoTask) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'A valid linked task is required',
      code: 'TASK_REQUIRED',
    });
  }

  // 2. Destination validation: validate destination task if provided (Correction 2, 3)
  // Destination validation must use effective client (existing client when omitted, explicit payload when provided)
  const destinationClientId = clientId !== undefined ? clientId : originClientId;

  if (destinationTaskId) {
    const authDest = await resolveAndAuthorizeTaskTarget({
      entityId,
      user: effectiveUser,
      userId,
      targetTaskId: destinationTaskId,
      targetWorkRequestId: destinationWrId,
      clientId: destinationClientId,
      allowNoTask: false,
      recordType,
      enforceSelectability: true,
    });
    // Persist normalized derived parent consistently (Correction 2)
    destinationWrId = authDest.effectiveWrId;
  }

  return {
    isLinkageChanged: true,
    effectiveTaskId: destinationTaskId || null,
    effectiveWrId: destinationWrId || null,
    canonicalPair: {
      task_id: destinationTaskId || null,
      linked_task_id: destinationTaskId || null,
    },
  };
};

module.exports = {
  resolveExistingStoredTaskId,
  normalizeTaskAndParentAliases,
  isUserAssignedToTask,
  resolveTrustedUser,
  resolveAndAuthorizeTaskTarget,
  authorizeTaskRelink,
};
