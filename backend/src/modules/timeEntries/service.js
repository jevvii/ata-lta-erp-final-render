/**
 * Time Entries service.
 * Handles database operations, assignee verification, scoped queries, and summary aggregation.
 */

const { randomUUID } = require('crypto');
const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { buildPermissionSet, hasPermission } = require('../../lib/permissions');
const { entryDateSchema } = require('./schema');

const databaseError = (error) => {
  if (error) throw new AppError({ statusCode: 500, title: 'Database Error', detail: error.message });
};

// The time table has no entity column; scope through its task's parent request.
const assertTaskScope = async (taskId, entityId, { activeOnly = false } = {}) => {
  const { data: task, error } = await supabaseAdmin.from('tasks')
    .select('id, work_request_id, deleted_at').eq('id', taskId).maybeSingle();
  databaseError(error);
  if (!task || (activeOnly && task.deleted_at)) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found' });
  }
  const { data: wr, error: wrError } = await supabaseAdmin.from('work_requests')
    .select('id, entity_id, deleted_at').eq('id', task.work_request_id).maybeSingle();
  databaseError(wrError);
  if (!wr || (entityId && wr.entity_id !== entityId) || (activeOnly && wr.deleted_at)) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found in the selected entity' });
  }
};

// Paginate the scope lookup so assignments past the PostgREST row cap are retained.
const readAll = async (makeQuery) => {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await makeQuery().range(offset, offset + 999);
    databaseError(error);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
};
const scopedTaskIds = async (entityId) => {
  if (!entityId) return null; // ALL is authorized by entityScope middleware.
  const requests = await readAll(() => supabaseAdmin.from('work_requests').select('id')
    .eq('entity_id', entityId).order('id'));
  const ids = [];
  for (let index = 0; index < requests.length; index += 100) {
    const tasks = await readAll(() => supabaseAdmin.from('tasks').select('id')
      .in('work_request_id', requests.slice(index, index + 100).map((wr) => wr.id)).order('id'));
    ids.push(...tasks.map((task) => task.id));
  }
  return ids;
};

const mapLegacyEntry = (row) => ({
  id: row.id, user_id: row.user_id, task_id: row.task_id,
  entry_date: row.date, duration_minutes: Math.round(Number(row.hours) * 60),
  note: row.note || null, created_at: row.created_at, updated_at: row.created_at,
  user_name: row.worker_name || null,
});

// Resolve identities only after entry visibility has been scoped. Batch the lookup
// for large lists and keep historical entries readable if a profile is missing.
const withLoggerProfiles = async (entries) => {
  const userIds = [...new Set(entries.map((entry) => entry.user_id).filter(Boolean))];
  const profiles = new Map();
  for (let index = 0; index < userIds.length; index += 100) {
    const { data, error } = await supabaseAdmin.from('users').select('id, name, role')
      .in('id', userIds.slice(index, index + 100));
    databaseError(error);
    (data || []).forEach((profile) => profiles.set(profile.id, profile));
  }
  return entries.map((entry) => ({
    ...entry,
    user_name: profiles.get(entry.user_id)?.name || entry.user_name || null,
    user_role: profiles.get(entry.user_id)?.role || null,
  }));
};

const readEntries = async ({ table, dateColumn, userId, filters, taskIds }) => {
  if (taskIds && !taskIds.length) return [];
  // Keep URL filters bounded even for large entities.
  const batches = taskIds ? Array.from({ length: Math.ceil(taskIds.length / 100) },
    (_, index) => taskIds.slice(index * 100, index * 100 + 100)) : [null];
  const rows = [];
  for (const batch of batches) {
    rows.push(...await readAll(() => {
      let query = supabaseAdmin.from(table).select('*');
      if (userId) query = query.eq('user_id', userId);
      if (batch) query = query.in('task_id', batch);
      if (filters.task_id) query = query.eq('task_id', filters.task_id);
      if (filters.from) query = query.gte(dateColumn, filters.from);
      if (filters.to) query = query.lte(dateColumn, filters.to);
      return query.order(dateColumn, { ascending: false }).order('id');
    }));
  }
  return rows;
};

/**
 * Helper to compute effective permissions for a user.
 * @param {object} user
 * @param {Set<string>} [providedPermissions]
 * @returns {Set<string>}
 */
const getEffectivePermissions = (user, providedPermissions) => {
  if (providedPermissions instanceof Set) {
    return providedPermissions;
  }
  return buildPermissionSet({
    role: user.role || '',
    departments: user.departments || [],
  });
};

/**
 * Verify whether a user is an assigned worker on a task.
 * Checks `task_assignees` join table first, with fallback to legacy `tasks.assignee_id`.
 *
 * @param {string} taskId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
const isUserAssignedToTask = async (taskId, userId) => {
  // 1. Check task_assignees join table (multi-assignee attribution standard)
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

  // 2. Fallback: check tasks table for task existence and legacy assignee_id
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
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Task not found',
      code: 'TASK_NOT_FOUND',
    });
  }

  return task.assignee_id === userId;
};

/**
 * Create a new time entry.
 *
 * @param {object} params
 * @param {string} params.userId Authenticated user ID (creator)
 * @param {string} params.taskId Target task UUID
 * @param {string} params.entryDate Entry date (YYYY-MM-DD, cannot be in future)
 * @param {number} params.durationMinutes Duration in minutes (1..1440)
 * @param {string} [params.note] Optional note
 * @returns {Promise<object>} Created time entry
 */
const createTimeEntry = async ({
  userId,
  entityId,
  taskId,
  entryDate,
  durationMinutes,
  note,
}) => {
  await assertTaskScope(taskId, entityId, { activeOnly: true });
  // Validate assignee scope (Rule R2)
  const isAssigned = await isUserAssignedToTask(taskId, userId);
  if (!isAssigned) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'You are not assigned to this task',
      code: 'FORBIDDEN',
    });
  }

  // Defensive validation on date and duration (Rule R3)
  if (!entryDateSchema.safeParse(entryDate).success) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'entry_date must be a valid calendar date and cannot be in the future',
      code: 'INVALID_ENTRY_DATE',
    });
  }

  if (
    typeof durationMinutes !== 'number' ||
    durationMinutes < 1 ||
    durationMinutes > 1440 ||
    !Number.isInteger(durationMinutes)
  ) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'duration_minutes must be an integer between 1 and 1440',
      code: 'INVALID_DURATION',
    });
  }

  const now = new Date().toISOString();
  const insertPayload = {
    id: randomUUID(),
    user_id: userId,
    task_id: taskId,
    entry_date: entryDate,
    duration_minutes: durationMinutes,
    note: note || null,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabaseAdmin
    .from('time_entries')
    .insert(insertPayload)
    .select('*')
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: error.message,
    });
  }

  return data;
};

/**
 * List time entries with optional filters and user scoping.
 *
 * @param {object} params
 * @param {object} params.user Authenticated user object
 * @param {Set<string>} [params.userPermissions]
 * @param {object} params.filters
 * @param {string} [params.filters.from] Start date (YYYY-MM-DD)
 * @param {string} [params.filters.to] End date (YYYY-MM-DD)
 * @param {string} [params.filters.task_id] Filter by task UUID
 * @param {string} [params.filters.user_id] Filter by user UUID (Admin only)
 * @returns {Promise<object[]>} List of time entries
 */
const listTimeEntries = async ({ user, userPermissions, entityId, filters = {} }) => {
  const perms = getEffectivePermissions(user, userPermissions);
  const hasEditAll = hasPermission(perms, 'timelog:edit_all');

  const taskIds = await scopedTaskIds(entityId);
  const userId = hasEditAll ? filters.user_id : user.id;
  const [entries, legacy] = await Promise.all([
    readEntries({ table: 'time_entries', dateColumn: 'entry_date', userId, filters, taskIds }),
    readEntries({ table: 'task_time_logs', dateColumn: 'date', userId, filters, taskIds }),
  ]);
  // Unattributed/zero-duration legacy placeholders are not employee time entries.
  const visibleEntries = [...entries, ...legacy.filter((row) => row.user_id && row.date && Number(row.hours) > 0)
    .map(mapLegacyEntry)].sort((a, b) => b.entry_date.localeCompare(a.entry_date) || a.id.localeCompare(b.id));
  return withLoggerProfiles(visibleEntries);
};

/**
 * Get a single time entry by ID.
 *
 * @param {string} id
 * @returns {Promise<object>}
 */
const getTimeEntryById = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('time_entries')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: error.message,
    });
  }

  if (!data) {
    const { data: legacy, error: legacyError } = await supabaseAdmin.from('task_time_logs')
      .select('*').eq('id', id).maybeSingle();
    databaseError(legacyError);
    if (legacy?.user_id && legacy.date && Number(legacy.hours) > 0) {
      return { ...mapLegacyEntry(legacy), legacy: true };
    }
  }

  if (!data) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Time entry not found',
      code: 'NOT_FOUND',
    });
  }

  return data;
};

/**
 * Update an existing time entry.
 * Creator only, with Admin override (timelog:edit_all).
 *
 * @param {object} params
 * @param {string} params.id Time entry UUID
 * @param {object} params.user Authenticated user
 * @param {Set<string>} [params.userPermissions]
 * @param {object} params.updates Update payload
 * @returns {Promise<object>} Updated entry
 */
const updateTimeEntry = async ({ id, user, userPermissions, entityId, updates }) => {
  const existing = await getTimeEntryById(id);
  await assertTaskScope(existing.task_id, entityId);

  const perms = getEffectivePermissions(user, userPermissions);
  const hasEditAll = hasPermission(perms, 'timelog:edit_all');
  const isCreator = existing.user_id === user.id;

  if (!isCreator && !hasEditAll) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'You do not have permission to modify this time entry',
      code: 'FORBIDDEN',
    });
  }

  // If task_id changes, the entry owner must be assigned to the destination task
  if (updates.task_id && updates.task_id !== existing.task_id) {
    await assertTaskScope(updates.task_id, entityId, { activeOnly: true });
    const isAssigned = await isUserAssignedToTask(updates.task_id, existing.user_id);
    if (!isAssigned) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'You are not assigned to this task',
        code: 'FORBIDDEN',
      });
    }
  }

  // If entry_date is being updated, verify not in future
  if (updates.entry_date !== undefined && !entryDateSchema.safeParse(updates.entry_date).success) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'entry_date must be a valid calendar date and cannot be in the future',
      code: 'INVALID_ENTRY_DATE',
    });
  }

  // If duration_minutes is being updated, verify range
  if (updates.duration_minutes !== undefined) {
    if (
      typeof updates.duration_minutes !== 'number' ||
      updates.duration_minutes < 1 ||
      updates.duration_minutes > 1440 ||
      !Number.isInteger(updates.duration_minutes)
    ) {
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: 'duration_minutes must be an integer between 1 and 1440',
        code: 'INVALID_DURATION',
      });
    }
  }

  const updatePayload = {
    ...(updates.duration_minutes !== undefined && { duration_minutes: updates.duration_minutes }),
    ...(updates.note !== undefined && { note: updates.note }),
    ...(updates.entry_date !== undefined && { entry_date: updates.entry_date }),
    ...(updates.task_id !== undefined && { task_id: updates.task_id }),
    updated_at: new Date().toISOString(),
  };

  if (existing.legacy) {
    const payload = {
      ...(updates.duration_minutes !== undefined && { hours: updates.duration_minutes / 60 }),
      ...(updates.note !== undefined && { note: updates.note }),
      ...(updates.entry_date !== undefined && { date: updates.entry_date }),
      ...(updates.task_id !== undefined && { task_id: updates.task_id }),
      ...(updates.task_id && updates.task_id !== existing.task_id && { checklist_item_id: null }),
    };
    const { data, error } = await supabaseAdmin.from('task_time_logs')
      .update(payload).eq('id', id).select('*').single();
    databaseError(error);
    return mapLegacyEntry(data);
  }

  const { data, error } = await supabaseAdmin
    .from('time_entries')
    .update(updatePayload)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: error.message,
    });
  }

  return data;
};

/**
 * Delete a time entry.
 * Creator only, with Admin override (timelog:edit_all).
 *
 * @param {object} params
 * @param {string} params.id Time entry UUID
 * @param {object} params.user Authenticated user
 * @param {Set<string>} [params.userPermissions]
 * @returns {Promise<{id: string, deleted: boolean}>}
 */
const deleteTimeEntry = async ({ id, user, userPermissions, entityId }) => {
  const existing = await getTimeEntryById(id);
  await assertTaskScope(existing.task_id, entityId);

  const perms = getEffectivePermissions(user, userPermissions);
  const hasEditAll = hasPermission(perms, 'timelog:edit_all');
  const isCreator = existing.user_id === user.id;

  if (!isCreator && !hasEditAll) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'You do not have permission to delete this time entry',
      code: 'FORBIDDEN',
    });
  }

  const { error } = await supabaseAdmin
    .from(existing.legacy ? 'task_time_logs' : 'time_entries')
    .delete()
    .eq('id', id);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: error.message,
    });
  }

  return { id, deleted: true };
};

/**
 * Summary endpoint aggregation (Rule R5).
 * Aggregates scoped, paginated canonical and legacy records with work-request linkage.
 *
 * @param {object} params
 * @param {object} params.user Authenticated user
 * @param {Set<string>} [params.userPermissions]
 * @param {string} params.date Target date (YYYY-MM-DD)
 * @param {string} [params.targetUserId] Optional target user ID (Admin only)
 * @returns {Promise<{date: string, total_minutes: number, by_task: Array<{task_id: string, work_request_id: string|null, title: string, minutes: number}>}>}
 */
const getSummary = async ({ user, userPermissions, entityId, date, targetUserId }) => {
  const perms = getEffectivePermissions(user, userPermissions);
  const hasEditAll = hasPermission(perms, 'timelog:edit_all');
  const effectiveUserId = hasEditAll && targetUserId ? targetUserId : user.id;

  const entries = await listTimeEntries({
    user, userPermissions, entityId,
    filters: { from: date, to: date, user_id: effectiveUserId },
  });

  // Resolve titles in bounded batches for both historical and canonical entries.
  const missingTaskIds = entries
    .filter((e) => !e.tasks || !e.tasks.title)
    .map((e) => e.task_id);

  if (missingTaskIds.length > 0) {
    const uniqueIds = Array.from(new Set(missingTaskIds));
    const taskRows = [];
    for (let index = 0; index < uniqueIds.length; index += 100) {
      const { data, error } = await supabaseAdmin.from('tasks')
        .select('id, title, work_request_id').in('id', uniqueIds.slice(index, index + 100));
      databaseError(error);
      taskRows.push(...(data || []));
    }
    const taskMap = new Map((taskRows || []).map((t) => [t.id, t]));
    entries.forEach((e) => {
      if (!e.tasks || !e.tasks.title) {
        e.tasks = taskMap.get(e.task_id) || {};
      }
    });
  }

  let total_minutes = 0;
  const taskGroupMap = new Map();

  entries.forEach((entry) => {
    const mins = Number(entry.duration_minutes) || 0;
    total_minutes += mins;

    const taskId = entry.task_id;
    const taskInfo = entry.tasks || {};
    const existing = taskGroupMap.get(taskId);

    if (existing) {
      existing.minutes += mins;
    } else {
      taskGroupMap.set(taskId, {
        task_id: taskId,
        work_request_id: taskInfo.work_request_id || null,
        title: taskInfo.title || '',
        minutes: mins,
      });
    }
  });

  return {
    date,
    total_minutes,
    by_task: Array.from(taskGroupMap.values()),
  };
};

module.exports = {
  createTimeEntry,
  listTimeEntries,
  getTimeEntryById,
  updateTimeEntry,
  deleteTimeEntry,
  getSummary,
  isUserAssignedToTask,
};
