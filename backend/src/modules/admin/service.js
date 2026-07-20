/**
 * Admin / Users service.
 * User management, Supabase Auth provisioning, and pending approvals.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { randomUUID } = require('crypto');
const clientsService = require('../clients/service');
const operationsService = require('../operations/service');

const ALLOWED_DEPARTMENTS = ['Management', 'Accounting', 'Operations', 'Documentation'];

const toApiUser = (row, departments = []) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role,
  departments,
  entities: row.entities || [],
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const loadUserDepartments = async (userId) => {
  const { data: udRows, error } = await supabaseAdmin
    .from('user_departments')
    .select('department_id')
    .eq('user_id', userId);

  if (error) return [];

  const deptIds = (udRows || []).map((row) => row.department_id).filter(Boolean);
  if (!deptIds.length) return [];

  const { data: deptRows } = await supabaseAdmin
    .from('departments')
    .select('id, name')
    .in('id', deptIds);

  const nameById = new Map((deptRows || []).map((d) => [d.id, d.name]));
  return deptIds.map((id) => nameById.get(id)).filter(Boolean);
};

const resolveEntityId = async (code) => {
  if (code === 'ALL') return 'ALL';
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('id')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) {
    throw new AppError({ statusCode: 400, title: 'Bad Request', detail: `Unknown entity ${code}` });
  }
  return data.id;
};

const setDepartments = async (userId, departmentNames) => {
  await supabaseAdmin.from('user_departments').delete().eq('user_id', userId);

  if (!departmentNames?.length) return;

  const invalid = departmentNames.filter((n) => !ALLOWED_DEPARTMENTS.includes(n));
  if (invalid.length) {
    throw new AppError({ statusCode: 400, title: 'Bad Request', detail: `Invalid departments: ${invalid.join(', ')}. Allowed: ${ALLOWED_DEPARTMENTS.join(', ')}` });
  }

  const { data: deptRows } = await supabaseAdmin
    .from('departments')
    .select('id, name')
    .in('name', departmentNames);

  const deptMap = new Map((deptRows || []).map((d) => [d.name, d.id]));
  const missing = departmentNames.filter((n) => !deptMap.has(n));
  if (missing.length) {
    throw new AppError({ statusCode: 400, title: 'Bad Request', detail: `Unknown departments: ${missing.join(', ')}` });
  }

  const rows = departmentNames.map((name) => ({
    user_id: userId,
    department_id: deptMap.get(name),
  }));

  await supabaseAdmin.from('user_departments').insert(rows);
};

const listUsers = async ({ entityId } = {}) => {
  const query = supabaseAdmin.from('users').select('*').eq('is_active', true);

  const { data, error } = await query.order('name', { ascending: true });

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to list users' });
  }

  const rows = (data || []).filter((u) => !entityId || entityId === 'ALL' || (u.entities || []).includes(entityId));
  const usersWithDepts = await Promise.all(
    rows.map(async (u) => {
      const departments = await loadUserDepartments(u.id);
      return toApiUser(u, departments);
    })
  );
  return usersWithDepts;
};

const createUser = async ({ data, createdBy: _createdBy }) => {
  // Enforce a global cap of 15 active user accounts.
  const { count, error: countError } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true);

  if (countError) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to verify user limit' });
  }

  if (count >= 15) {
    throw new AppError({ statusCode: 403, title: 'Forbidden', detail: 'Maximum number of user accounts (15) reached. Contact the administrator to disable an existing account before adding a new one.', code: 'USER_LIMIT_REACHED' });
  }

  const password = data.password || 'ChangeMe123!';

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password,
    email_confirm: true,
  });

  if (authError || !authData?.user) {
    throw new AppError({ statusCode: 500, title: 'Auth Error', detail: authError?.message || 'Unable to create auth user' });
  }

  const now = new Date().toISOString();
  const userRecord = {
    id: randomUUID(),
    auth_user_id: authData.user.id,
    email: data.email,
    name: data.name,
    role: data.role,
    entities: data.entities || [],
    is_active: data.isActive !== false,
    created_at: now,
    updated_at: now,
  };

  const { error } = await supabaseAdmin.from('users').insert(userRecord);
  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to create ERP user profile' });
  }

  if (data.departments?.length) {
    await setDepartments(userRecord.id, data.departments);
  }

  return getUserById(userRecord.id);
};

const getUserById = async (id) => {
  const { data, error } = await supabaseAdmin.from('users').select('*').eq('id', id).maybeSingle();
  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to retrieve user' });
  }
  if (!data) return null;
  const departments = await loadUserDepartments(id);
  return toApiUser(data, departments);
};

const updateUser = async ({ id, data, updatedBy: _updatedBy }) => {
  const existing = await getUserById(id);
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'User not found' });
  }

  const updates = {
    name: data.name ?? existing.name,
    role: data.role ?? existing.role,
    entities: data.entities ?? existing.entities,
    is_active: data.isActive ?? existing.isActive,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from('users').update(updates).eq('id', id);
  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to update user' });
  }

  if (data.departments !== undefined) {
    await setDepartments(id, data.departments);
  }

  return getUserById(id);
};

const deleteUser = async ({ id, deletedBy: _deletedBy }) => {
  const existing = await getUserById(id);
  if (!existing) return false;

  const { error } = await supabaseAdmin
    .from('users')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to disable user' });
  }
  return true;
};

const toApiPendingChange = (row) => ({
  id: row.id,
  tableName: row.table_name,
  parentRecordId: row.parent_record_id || null,
  proposedData: row.proposed_data,
  submittedBy: row.submitted_by,
  status: row.status,
  createdAt: row.created_at,
});

const listPendingApprovals = async ({ entityId, user: _user, status, tableName, parentRecordId, submittedBy } = {}) => {
  let query = supabaseAdmin
    .from('pending_changes')
    .select('*');

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  if (status) {
    query = query.eq('status', status);
  } else {
    query = query.eq('status', 'pending');
  }

  if (tableName) {
    query = query.eq('table_name', tableName);
  }

  if (parentRecordId !== undefined && parentRecordId !== null && parentRecordId !== '') {
    query = query.eq('parent_record_id', parentRecordId);
  }

  if (submittedBy) {
    query = query.eq('submitted_by', submittedBy);
  }

  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to list pending approvals' });
  }

  return (data || []).map(toApiPendingChange);
};

const createPendingChange = async ({ entityId, userId, data }) => {
  const now = new Date().toISOString();
  const record = {
    entity_id: entityId,
    table_name: data.tableName,
    parent_record_id: data.parentRecordId || null,
    proposed_data: data.proposedData,
    submitted_by: userId,
    status: 'pending',
    created_at: now,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from('pending_changes')
    .insert(record)
    .select();

  if (error || !inserted?.length) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to create pending change' });
  }

  return toApiPendingChange(inserted[0]);
};

const getPendingChangeById = async ({ entityId, id }) => {
  let query = supabaseAdmin
    .from('pending_changes')
    .select('*')
    .eq('id', id);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to retrieve pending change' });
  }

  if (!data) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Pending change not found' });
  }

  return toApiPendingChange(data);
};

const applyPendingChange = async (change, user) => {
  const proposed = change.proposed_data || {};

  if (change.table_name === 'clients') {
    if (change.parent_record_id) {
      await clientsService.updateClient({
        id: change.parent_record_id,
        entityId: change.entity_id,
        data: proposed,
        updatedBy: user.id,
      });
    } else {
      await clientsService.createClient({
        entityId: change.entity_id,
        data: proposed,
        createdBy: user.id,
      });
    }
    return;
  }

  if (change.table_name === 'work_requests') {
    if (change.parent_record_id) {
      await operationsService.updateWorkRequest({
        id: change.parent_record_id,
        entityId: change.entity_id,
        data: proposed,
        user,
      });
    } else {
      await operationsService.createWorkRequest({
        entityId: change.entity_id,
        data: proposed,
        user,
      });
    }
    return;
  }

  if (change.table_name === 'tasks' && proposed.workRequestId) {
    await operationsService.updateTask({
      workRequestId: proposed.workRequestId,
      taskId: change.parent_record_id,
      entityId: change.entity_id,
      data: proposed,
      user,
    });
    return;
  }
};

const approvePending = async ({ id, user }) => {
  const { data: change, error } = await supabaseAdmin
    .from('pending_changes')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .maybeSingle();

  if (error || !change) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Pending change not found' });
  }

  await applyPendingChange(change, user);

  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from('pending_changes')
    .update({ status: 'approved', reviewed_by: user.id, reviewed_at: now })
    .eq('id', id);

  if (updateError) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to approve change' });
  }

  return { id, status: 'approved' };
};

/**
 * Count audit log entries for the active entity.
 * @param {object} params
 * @param {string} params.entityCode
 * @returns {Promise<number>}
 */
const getAuditLogCount = async ({ entityCode }) => {
  let query = supabaseAdmin
    .from('audit_logs')
    .select('*', { count: 'exact', head: true });

  if (entityCode && entityCode !== 'ALL') {
    query = query.eq('entity', entityCode);
  }

  const { count, error } = await query;

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to count audit logs' });
  }

  return count || 0;
};

/**
 * List audit log entries with optional filters and pagination.
 * @param {object} params
 * @param {string} params.entityCode
 * @param {object} params.filters
 * @returns {Promise<{ data: object[], meta: object }>}
 */
const getAuditLogs = async ({ entityCode, filters = {} }) => {
  const {
    userId,
    action,
    table,
    from,
    to,
    limit = 20,
    offset = 0,
  } = filters;

  let query = supabaseAdmin
    .from('audit_logs')
    .select('*', { count: 'exact' });

  if (entityCode && entityCode !== 'ALL') {
    query = query.eq('entity', entityCode);
  }

  if (userId) {
    query = query.eq('user_id', userId);
  }

  if (action) {
    query = query.eq('action', action);
  }

  if (table) {
    query = query.eq('table_name', table);
  }

  if (from) {
    query = query.gte('created_at', from);
  }

  if (to) {
    query = query.lte('created_at', to);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to list audit logs' });
  }

  const rows = data || [];
  const total = count !== undefined && count !== null ? count : rows.length;

  return {
    data: rows.map((row) => ({
      id: row.id,
      action: row.action,
      tableName: row.table_name,
      recordId: row.record_id,
      entity: row.entity,
      userId: row.user_id,
      details: row.details,
      createdAt: row.created_at,
    })),
    meta: {
      total,
      limit,
      offset,
      hasMore: offset + rows.length < total,
    },
  };
};

const rejectPending = async ({ id, user, reason }) => {
  const { data: change, error } = await supabaseAdmin
    .from('pending_changes')
    .select('*')
    .eq('id', id)
    .eq('status', 'pending')
    .maybeSingle();

  if (error || !change) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Pending change not found' });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from('pending_changes')
    .update({ status: 'rejected', reviewed_by: user.id, reviewed_at: now, rejection_reason: reason })
    .eq('id', id);

  if (updateError) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to reject change' });
  }

  return { id, status: 'rejected' };
};

module.exports = {
  listUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  listPendingApprovals,
  createPendingChange,
  getPendingChangeById,
  approvePending,
  rejectPending,
  resolveEntityId,
  getAuditLogCount,
  getAuditLogs,
};
