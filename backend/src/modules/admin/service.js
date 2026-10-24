/**
 * Admin / Users service.
 * User management, Supabase Auth provisioning, and pending approvals.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { randomUUID } = require('crypto');
const clientsService = require('../clients/service');
const operationsService = require('../operations/service');
const billingService = require('../billing/service');
const disbursementsService = require('../disbursements/service');
const transmittalsService = require('../transmittals/service');
const { computePermissions } = require('../../middleware/rbac');
const { hasPermission } = require('../../lib/permissions');
const { evictUserProfile } = require('../../middleware/auth');
const { filterValidProjectRecords } = require('../../lib/projectLinkage');
const { normalizeTaskAndParentAliases } = require('../../lib/taskAssignment');
const {
  getUserConcernedWorkRequestIds,
  getUserAuthorizedClientIds,
  fetchInPages,
} = require('../../lib/userScope');

const ALLOWED_DEPARTMENTS = ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'];

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

const getEntityCodeById = async (entityId) => {
  if (!entityId || entityId === 'ALL') return null;
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('code')
    .eq('id', entityId)
    .maybeSingle();
  if (error || !data) return null;
  return data.code;
};

const setDepartments = async (userId, departmentNames) => {
  await supabaseAdmin.from('user_departments').delete().eq('user_id', userId);

  if (!departmentNames?.length) return;

  const invalid = departmentNames.filter((n) => !ALLOWED_DEPARTMENTS.includes(n));
  if (invalid.length) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Invalid departments: ${invalid.join(', ')}. Allowed: ${ALLOWED_DEPARTMENTS.join(', ')}`,
    });
  }

  const { data: deptRows } = await supabaseAdmin
    .from('departments')
    .select('id, name')
    .in('name', departmentNames);

  const deptMap = new Map((deptRows || []).map((d) => [d.name, d.id]));
  const missing = departmentNames.filter((n) => !deptMap.has(n));
  if (missing.length) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Unknown departments: ${missing.join(', ')}`,
    });
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
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list users',
    });
  }

  const rows = (data || []).filter(
    (u) => !entityId || entityId === 'ALL' || (u.entities || []).includes(entityId)
  );
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
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to verify user limit',
    });
  }

  if (count >= 15) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail:
        'Maximum number of user accounts (15) reached. Contact the administrator to disable an existing account before adding a new one.',
      code: 'USER_LIMIT_REACHED',
    });
  }

  const password = data.password || 'ChangeMe123!';

  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password,
    email_confirm: true,
  });

  if (authError || !authData?.user) {
    throw new AppError({
      statusCode: 500,
      title: 'Auth Error',
      detail: authError?.message || 'Unable to create auth user',
    });
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
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to create ERP user profile',
    });
  }

  if (data.departments?.length) {
    await setDepartments(userRecord.id, data.departments);
  }

  return getUserById(userRecord.id);
};

const getUserById = async (id) => {
  const { data, error } = await supabaseAdmin.from('users').select('*').eq('id', id).maybeSingle();
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve user',
    });
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

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('auth_user_id')
    .eq('id', id)
    .maybeSingle();

  const authUserId = userRow?.auth_user_id;

  if (authUserId) {
    if (data.email && data.email !== existing.email) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        email: data.email,
      });
      if (authError) {
        throw new AppError({
          statusCode: 500,
          title: 'Auth Error',
          detail: authError.message || 'Unable to update email in Supabase Auth',
        });
      }
    }

    if (data.password) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        password: data.password,
      });
      if (authError) {
        throw new AppError({
          statusCode: 500,
          title: 'Auth Error',
          detail: authError.message || 'Unable to update password in Supabase Auth',
        });
      }
    }
  }

  const updates = {
    name: data.name ?? existing.name,
    email: data.email ?? existing.email,
    role: data.role ?? existing.role,
    entities: data.entities ?? existing.entities,
    is_active: data.isActive ?? existing.isActive,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from('users').update(updates).eq('id', id);
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update user',
    });
  }

  if (data.departments !== undefined) {
    await setDepartments(id, data.departments);
  }

  // R-13: role/entities/departments/is_active changed — drop the cached
  // profile so the next request re-reads the row instead of serving stale
  // permissions for up to the cache TTL.
  evictUserProfile(id);

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
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to disable user',
    });
  }

  // R-13: the account is disabled — evict immediately so in-flight tokens no
  // longer authenticate against the stale cached profile.
  evictUserProfile(id);

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
  reviewedBy: row.reviewed_by || null,
  reviewedAt: row.reviewed_at || null,
  rejectionReason: row.rejection_reason || null,
});

const filterPendingApprovalsByProject = async (rows, user, entityId) => {
  if (!rows?.length || !user) return [];
  if (user.role === 'Admin') return rows;

  const concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
  const projectTables = new Set([
    'work_requests', 'tasks', 'invoices', 'disbursements', 'transmittals', 'documents',
  ]);
  const targets = new Map();
  for (const table of [...projectTables, 'clients']) {
    const ids = [...new Set(rows
      .filter((r) => (r.table_name === 'workRequests' ? 'work_requests' : r.table_name) === table)
      .map((r) => r.parent_record_id).filter(Boolean))];
    const records = [];
    for (let offset = 0; offset < ids.length; offset += 500) {
      const chunk = ids.slice(offset, offset + 500);
      records.push(...await fetchInPages(() =>
        supabaseAdmin.from(table).select('*').in('id', chunk)
      ));
    }
    targets.set(table, new Map(records.map((r) => [r.id, r])));
  }
  const allowedClientIds = rows.some((r) => r.table_name === 'clients')
    ? new Set(await getUserAuthorizedClientIds(user, entityId)) : new Set();

  const candidates = [];
  const records = [];
  for (const row of rows) {
    const table = row.table_name === 'workRequests' ? 'work_requests' : row.table_name;
    if (!projectTables.has(table) && table !== 'clients') {
      candidates.push({ row }); // Preserve existing non-project/HR queue policy.
      continue;
    }
    const target = row.parent_record_id ? targets.get(table).get(row.parent_record_id) : null;
    // Existing target lookup failures cannot fall back to a proposed parent.
    if (row.parent_record_id && (!target || target.deleted_at)) continue;
    if (table === 'clients') {
      if (target && allowedClientIds.has(target.id)) candidates.push({ row });
      continue;
    }
    if (target && row.entity_id && target.entity_id && row.entity_id !== target.entity_id) continue;

    let record = target;
    if (target && table === 'work_requests') {
      record = { ...target, work_request_id: target.id };
    } else if (target && table === 'tasks') {
      record = { ...target, task_id: target.id };
    } else if (!target) {
      try {
        const { effectiveTaskId, effectiveWrId } = normalizeTaskAndParentAliases(row.proposed_data || {});
        record = { entity_id: row.entity_id, task_id: effectiveTaskId, work_request_id: effectiveWrId };
      } catch (error) {
        if (error.statusCode === 400) continue;
        throw error;
      }
    }
    candidates.push({ row, record });
    records.push(record);
  }
  const valid = new Set(await filterValidProjectRecords(records, { user, entityId, concernedWrIds }));
  return candidates.filter(({ record }) => !record || valid.has(record)).map(({ row }) => row);
};

const listPendingApprovals = async ({
  entityId,
  user,
  status,
  tableName,
  parentRecordId,
  submittedBy,
} = {}) => {
  const makeQuery = () => {
    let q = supabaseAdmin.from('pending_changes').select('*');

    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }

    if (status) {
      q = q.eq('status', status);
    } else {
      q = q.eq('status', 'pending');
    }

    if (tableName) {
      q = q.eq('table_name', tableName);
    }

    if (parentRecordId !== undefined && parentRecordId !== null && parentRecordId !== '') {
      q = q.eq('parent_record_id', parentRecordId);
    }

    if (submittedBy) {
      q = q.eq('submitted_by', submittedBy);
    }

    return q.order('created_at', { ascending: false });
  };

  const rawRows = await fetchInPages(makeQuery);
  const filtered = await filterPendingApprovalsByProject(rawRows, user, entityId);
  return filtered.map(toApiPendingChange);
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
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to create pending change',
    });
  }

  return toApiPendingChange(inserted[0]);
};

const getPendingChangeById = async ({ entityId, id }) => {
  let query = supabaseAdmin.from('pending_changes').select('*').eq('id', id);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve pending change',
    });
  }

  if (!data) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Pending change not found' });
  }

  return toApiPendingChange(data);
};

const applyPendingChange = async (change, user) => {
  const proposed = change.proposed_data || {};

  // Normalize table_name: the frontend sends camelCase (e.g. 'workRequests')
  // but the comparisons below use snake_case (e.g. 'work_requests').
  const TABLE_NAME_MAP = {
    workRequests: 'work_requests',
    work_requests: 'work_requests',
    clients: 'clients',
    tasks: 'tasks',
    workRequestPhaseRouting: 'work_request_phase_routing',
    work_request_phase_routing: 'work_request_phase_routing',
    invoices: 'invoices',
    disbursements: 'disbursements',
    transmittals: 'transmittals',
  };
  const tableName = TABLE_NAME_MAP[change.table_name] || change.table_name;

  if (tableName === 'clients') {
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

  if (tableName === 'work_requests') {
    if (change.parent_record_id) {
      await operationsService.updateWorkRequest({
        id: change.parent_record_id,
        entityId: change.entity_id,
        data: proposed,
        user,
      });
    } else {
      // Map the temporary work request ID to a new UUID
      const wrUuid = randomUUID();
      proposed.id = wrUuid;

      // If there are tasks, map their temporary IDs to new UUIDs
      const taskIdMap = {};
      if (Array.isArray(proposed.tasks)) {
        proposed.tasks.forEach((t) => {
          const taskUuid = randomUUID();
          taskIdMap[t.id] = taskUuid;
          t.id = taskUuid;
          t.workRequestId = wrUuid;
        });

        // Resolve predecessors using the map
        proposed.tasks.forEach((t) => {
          if (Array.isArray(t.predecessors)) {
            t.predecessors = t.predecessors
              .map((oldId) => taskIdMap[oldId] || oldId)
              .filter(Boolean);
          }
        });
      }

      // Preserve the originally requesting manager's ID
      if (!proposed.requestedBy && change.submitted_by) {
        proposed.requestedBy = change.submitted_by;
      }

      const createdWr = await operationsService.createWorkRequest({
        entityId: change.entity_id,
        data: proposed,
        user,
      });

      if (Array.isArray(proposed.tasks)) {
        for (const t of proposed.tasks) {
          await operationsService.createTask({
            workRequestId: createdWr.id,
            entityId: change.entity_id,
            data: t,
            user,
          });
        }
      }
    }
    return;
  }

  if (tableName === 'tasks' && proposed.workRequestId) {
    if (change.parent_record_id) {
      await operationsService.updateTask({
        workRequestId: proposed.workRequestId,
        taskId: change.parent_record_id,
        entityId: change.entity_id,
        data: proposed,
        user,
      });
    } else {
      await operationsService.createTask({
        workRequestId: proposed.workRequestId,
        entityId: change.entity_id,
        data: proposed,
        user,
      });
    }
    return;
  }

  if (tableName === 'work_request_phase_routing') {
    const wrId = change.parent_record_id || proposed.id;
    await operationsService.updateWorkRequest({
      id: wrId,
      entityId: change.entity_id,
      data: { status: proposed.status },
      user,
    });
    return;
  }

  if (tableName === 'invoices') {
    if (change.parent_record_id) {
      await billingService.updateInvoice({
        entityId: change.entity_id,
        id: change.parent_record_id,
        userId: user.id,
        user,
        data: proposed,
      });
    } else {
      await billingService.createInvoice({
        entityId: change.entity_id,
        userId: user.id,
        user,
        data: proposed,
      });
    }
    return;
  }

  if (tableName === 'disbursements') {
    if (change.parent_record_id) {
      await disbursementsService.updateDisbursement({
        entityId: change.entity_id,
        id: change.parent_record_id,
        userId: user.id,
        user,
        data: proposed,
      });
    } else {
      const entityCode = await getEntityCodeById(change.entity_id);
      await disbursementsService.createDisbursement({
        entityId: change.entity_id,
        entityCode: entityCode || 'ATA',
        userId: user.id,
        user,
        data: proposed,
      });
    }
    return;
  }

  if (tableName === 'transmittals') {
    if (change.parent_record_id) {
      await transmittalsService.updateTransmittal({
        entityId: change.entity_id,
        id: change.parent_record_id,
        userId: user.id,
        data: proposed,
      });
    } else {
      await transmittalsService.createTransmittal({
        entityId: change.entity_id,
        userId: user.id,
        data: proposed,
      });
    }
    return;
  }
};

const approvePending = async ({ id, user }) => {
  const { data: change, error } = await supabaseAdmin
    .from('pending_changes')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !change) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Pending change not found' });
  }

  const permissions = computePermissions(user);
  const TABLE_NAME_MAP = {
    workRequests: 'work_requests',
    work_requests: 'work_requests',
    clients: 'clients',
    tasks: 'tasks',
    workRequestPhaseRouting: 'work_request_phase_routing',
    work_request_phase_routing: 'work_request_phase_routing',
    invoices: 'invoices',
    disbursements: 'disbursements',
    transmittals: 'transmittals',
  };
  const norm = TABLE_NAME_MAP[change.table_name] || change.table_name;
  const canApprove =
    hasPermission(permissions, 'approve_change:*') ||
    hasPermission(permissions, `approve_change:${norm}`) ||
    hasPermission(permissions, `approve_change:${change.table_name}`);
  if (!canApprove) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'You are not authorized to approve this pending change',
    });
  }

  const { data: rows, error: rpcError } = await supabaseAdmin.rpc('pending_change_approve', {
    p_id: id,
    p_user_id: user.id,
    p_entity_id: change.entity_id,
  });

  if (rpcError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to approve change',
    });
  }

  if (!rows || rows.length === 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'This pending change has already been reviewed',
      code: 'PENDING_CHANGE_ALREADY_REVIEWED',
    });
  }

  await applyPendingChange(change, user);

  return { id, status: 'approved' };
};

/**
 * Count audit log entries for the active entity.
 * @param {object} params
 * @param {string} params.entityCode
 * @returns {Promise<number>}
 */
const getAuditLogCount = async ({ entityCode }) => {
  let query = supabaseAdmin.from('audit_logs').select('*', { count: 'exact', head: true });

  if (entityCode && entityCode !== 'ALL') {
    const entityUuid = await resolveEntityId(entityCode).catch(() => null);
    if (entityUuid && entityUuid !== entityCode) {
      query = query.or(`entity.eq.${entityCode},entity.eq.${entityUuid}`);
    } else {
      query = query.eq('entity', entityCode);
    }
  }

  const { count, error } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to count audit logs',
    });
  }

  return count || 0;
};

const MODULE_TABLE_MAP = {
  operations: ['work_requests', 'tasks'],
  billing: ['invoices', 'invoice_line_items', 'invoice_payments'],
  disbursements: ['disbursements', 'disbursement_templates'],
  documents: ['documents'],
  transmittals: ['transmittals', 'transmittal_items'],
  admin: [
    'users',
    'user_roles',
    'clients',
    'entities',
    'stages',
    'retainer_templates',
    'operations_requests',
  ],
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
    module: moduleFilter,
    actor,
    date,
    from,
    to,
    page: pageParam,
    limit = 20,
    offset: offsetParam = 0,
  } = filters;

  const limitNum = Number(limit);
  const page = pageParam ? Number(pageParam) : Math.floor(Number(offsetParam) / limitNum) + 1;
  const offset = pageParam ? (page - 1) * limitNum : Number(offsetParam);

  let query = supabaseAdmin.from('audit_logs').select('*', { count: 'exact' });

  if (entityCode && entityCode !== 'ALL') {
    const entityUuid = await resolveEntityId(entityCode).catch(() => null);
    if (entityUuid && entityUuid !== entityCode) {
      query = query.or(`entity.eq.${entityCode},entity.eq.${entityUuid}`);
    } else {
      query = query.eq('entity', entityCode);
    }
  }

  // Actor / User filter
  if (actor) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor);
    if (isUuid) {
      query = query.eq('user_id', actor);
    } else {
      const { data: matchedUsers } = await supabaseAdmin
        .from('users')
        .select('id')
        .or(`email.ilike.%${actor}%,name.ilike.%${actor}%`);
      const matchedIds = (matchedUsers || []).map((u) => u.id);
      if (matchedIds.length > 0) {
        query = query.in('user_id', matchedIds);
      } else {
        return {
          data: [],
          meta: {
            total: 0,
            page,
            limit: limitNum,
            offset,
            hasMore: false,
          },
        };
      }
    }
  } else if (userId) {
    query = query.eq('user_id', userId);
  }

  if (action) {
    query = query.eq('action', action);
  }

  if (table) {
    query = query.eq('table_name', table);
  } else if (moduleFilter) {
    const modKey = moduleFilter.toLowerCase();
    const tables = MODULE_TABLE_MAP[modKey];
    if (tables && tables.length > 0) {
      query = query.in('table_name', tables);
    }
  }

  if (date) {
    const dateStr = date.includes('T') ? date.split('T')[0] : date;
    query = query.gte('created_at', `${dateStr}T00:00:00.000Z`);
    query = query.lte('created_at', `${dateStr}T23:59:59.999Z`);
  } else {
    if (from) {
      query = query.gte('created_at', from);
    }
    if (to) {
      query = query.lte('created_at', to);
    }
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list audit logs',
    });
  }

  const rows = data || [];
  const total = count !== undefined && count !== null ? count : rows.length;

  // Enrich actor metadata
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
  const userMap = new Map();
  if (userIds.length > 0) {
    const { data: usersData } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role')
      .in('id', userIds);
    (usersData || []).forEach((u) => userMap.set(u.id, u));
  }

  return {
    data: rows.map((row) => {
      const user = userMap.get(row.user_id) || null;
      return {
        id: row.id,
        action: row.action,
        tableName: row.table_name,
        recordId: row.record_id,
        entity: row.entity,
        userId: row.user_id,
        actor: user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              role: user.role,
            }
          : row.user_id
          ? { id: row.user_id }
          : null,
        userName: user?.name || null,
        userEmail: user?.email || null,
        details: row.details,
        createdAt: row.created_at,
      };
    }),
    meta: {
      total,
      page,
      limit: limitNum,
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

  const permissions = computePermissions(user);
  const TABLE_NAME_MAP = {
    workRequests: 'work_requests',
    work_requests: 'work_requests',
    clients: 'clients',
    tasks: 'tasks',
    workRequestPhaseRouting: 'work_request_phase_routing',
    work_request_phase_routing: 'work_request_phase_routing',
    invoices: 'invoices',
    disbursements: 'disbursements',
    transmittals: 'transmittals',
  };
  const norm = TABLE_NAME_MAP[change.table_name] || change.table_name;
  const canApprove =
    hasPermission(permissions, 'approve_change:*') ||
    hasPermission(permissions, `approve_change:${norm}`) ||
    hasPermission(permissions, `approve_change:${change.table_name}`);
  if (change.submitted_by !== user.id && !canApprove) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'You are not authorized to reject this pending change',
    });
  }

  const now = new Date().toISOString();
  const finalReason = (typeof reason === 'string' && reason.trim()) ? reason.trim() : 'No reason provided';
  const { error: updateError } = await supabaseAdmin
    .from('pending_changes')
    .update({
      status: 'rejected',
      reviewed_by: user.id,
      reviewed_at: now,
      rejection_reason: finalReason,
    })
    .eq('id', id);

  if (updateError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to reject change',
    });
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
