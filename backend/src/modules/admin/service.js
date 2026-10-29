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
const { concurrencyConflict, resolveExpectedVersion } = require('../../lib/concurrency');
const { filterValidProjectRecords } = require('../../lib/projectLinkage');
const { normalizeTaskAndParentAliases } = require('../../lib/taskAssignment');
const {
  getUserConcernedWorkRequestIds,
  getUserAuthorizedClientIds,
  fetchInPages,
} = require('../../lib/userScope');

const ALLOWED_DEPARTMENTS = ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'];

const toApiUser = (row, departments = []) => {
  const isActive = row.is_active !== false;
  return {
    id: row.id,
    userNumber: row.user_number || null,
    user_number: row.user_number || null,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatar_url || null,
    avatar_url: row.avatar_url || null,
    departments,
    entities: row.entities || [],
    isActive,
    status: isActive ? 'Active' : 'Disabled',
    version: row.version ?? 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const extractEmbeddedDepartments = (userRow) => {
  if (!Array.isArray(userRow?.user_departments)) return [];
  return userRow.user_departments
    .map((ud) => ud?.departments?.name || ud?.name)
    .filter(Boolean);
};

const loadUserDepartments = async (userId, userRow = null) => {
  const { data: udRows, error } = await supabaseAdmin
    .from('user_departments')
    .select('department_id')
    .eq('user_id', userId);

  if (error) return extractEmbeddedDepartments(userRow);

  const deptIds = (udRows || []).map((row) => row.department_id).filter(Boolean);
  if (!deptIds.length) {
    return extractEmbeddedDepartments(userRow);
  }

  const { data: deptRows } = await supabaseAdmin
    .from('departments')
    .select('id, name')
    .in('id', deptIds);

  const nameById = new Map((deptRows || []).map((d) => [d.id, d.name]));
  return deptIds.map((id) => nameById.get(id)).filter(Boolean);
};

const loadUsersDepartmentsMap = async (users = []) => {
  const result = new Map();
  if (!Array.isArray(users) || users.length === 0) return result;

  const userIds = Array.from(new Set(users.map((u) => u?.id).filter(Boolean)));
  if (userIds.length === 0) return result;

  const { data: udRows, error } = await supabaseAdmin
    .from('user_departments')
    .select('user_id, department_id')
    .in('user_id', userIds);

  if (!error && Array.isArray(udRows) && udRows.length > 0) {
    const deptIds = Array.from(
      new Set(udRows.map((row) => row.department_id).filter(Boolean))
    );
    let nameById = new Map();
    if (deptIds.length > 0) {
      const { data: deptRows } = await supabaseAdmin
        .from('departments')
        .select('id, name')
        .in('id', deptIds);
      nameById = new Map((deptRows || []).map((d) => [d.id, d.name]));
    }

    for (const row of udRows) {
      if (!row?.user_id) continue;
      const deptName = nameById.get(row.department_id);
      if (!deptName) continue;
      const list = result.get(row.user_id) || [];
      if (!list.includes(deptName)) {
        list.push(deptName);
      }
      result.set(row.user_id, list);
    }
  }

  for (const u of users) {
    if (!u?.id) continue;
    if (!result.has(u.id)) {
      result.set(u.id, extractEmbeddedDepartments(u));
    }
  }

  return result;
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

const assertAccountCapNotReached = async () => {
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
};

const listUsers = async ({ entityId, entityCode } = {}) => {
  const scopeEntity = entityId || entityCode;
  const query = supabaseAdmin.from('users').select('*');

  const { data, error } = await query.order('name', { ascending: true });

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list users',
    });
  }

  const rows = (data || []).filter(
    (u) => !scopeEntity || scopeEntity === 'ALL' || (u.entities || []).includes(scopeEntity)
  );
  const departmentsByUserId = await loadUsersDepartmentsMap(rows);
  return rows.map((u) => toApiUser(u, departmentsByUserId.get(u.id) || []));
};

const createUser = async ({ data, createdBy: _createdBy }) => {
  if (data.isActive !== false) {
    await assertAccountCapNotReached();
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
    version: 1,
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
  const departments = await loadUserDepartments(id, data);
  return toApiUser(data, departments);
};

const updateUser = async ({ id, data = {}, currentUserId, updatedBy: _updatedBy }) => {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve user',
    });
  }

  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'User not found' });
  }

  let nextIsActive;
  if (data.isActive !== undefined) {
    nextIsActive = Boolean(data.isActive);
  } else if (data.status !== undefined) {
    nextIsActive = data.status === 'Active';
  } else {
    nextIsActive = existing.is_active !== false;
  }

  if (currentUserId && String(currentUserId) === String(id) && nextIsActive === false) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Cannot disable your own account',
      code: 'SELF_DEACTIVATION_FORBIDDEN',
    });
  }

  if (existing.is_active === false && nextIsActive === true) {
    await assertAccountCapNotReached();
  }

  const expectedVersion = resolveExpectedVersion(data);
  const authUserId = existing.auth_user_id;

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
    is_active: nextIsActive,
    version: (existing.version || 1) + 1,
    updated_at: new Date().toISOString(),
  };

  let updateQuery = supabaseAdmin.from('users').update(updates).eq('id', id);
  if (expectedVersion !== null) {
    updateQuery = updateQuery.eq('version', expectedVersion);
  }

  const { data: updatedRows, error } = await updateQuery.select();
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update user',
    });
  }

  if (expectedVersion !== null && (!updatedRows || updatedRows.length === 0)) {
    throw concurrencyConflict();
  }

  if (data.departments !== undefined) {
    await setDepartments(id, data.departments);
  }

  // R-13: role/entities/departments/is_active changed — drop the cached
  // profile so the next request re-reads the row instead of serving stale
  // permissions for up to the cache TTL.
  evictUserProfile(id);

  const updatedRow = updatedRows?.[0] || { ...existing, ...updates };
  const departments =
    data.departments !== undefined && data.departments.length === 0
      ? []
      : await loadUserDepartments(id, updatedRow);
  return toApiUser(updatedRow, departments);
};

const deleteUser = async ({ id, expectedVersion: rawExpectedVersion, deletedBy: _deletedBy }) => {
  const { data: existing, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (fetchError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve user',
    });
  }
  if (!existing) return null;

  const expectedVersion =
    typeof rawExpectedVersion === 'number' &&
    Number.isInteger(rawExpectedVersion) &&
    rawExpectedVersion > 0
      ? rawExpectedVersion
      : resolveExpectedVersion({ expectedVersion: rawExpectedVersion });

  const updates = {
    is_active: false,
    version: (existing.version || 1) + 1,
    updated_at: new Date().toISOString(),
  };

  let updateQuery = supabaseAdmin.from('users').update(updates).eq('id', id);
  if (expectedVersion !== null) {
    updateQuery = updateQuery.eq('version', expectedVersion);
  }

  const { data: updatedRows, error } = await updateQuery.select();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to disable user',
    });
  }

  if (expectedVersion !== null && (!updatedRows || updatedRows.length === 0)) {
    throw concurrencyConflict();
  }

  // R-13: the account is disabled — evict immediately so in-flight tokens no
  // longer authenticate against the stale cached profile.
  evictUserProfile(id);

  const updatedRow = updatedRows?.[0] || { ...existing, ...updates };
  const departments = await loadUserDepartments(id, updatedRow);
  return toApiUser(updatedRow, departments);
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

const normalizeAuditParams = (params = {}) => {
  const { entityCode, filters = {}, ...topLevel } = params;
  return {
    entityCode,
    mergedFilters: { ...filters, ...topLevel },
  };
};

const applyAuditBaseFilters = async (query, { entityCode, filters = {} }) => {
  const {
    userId,
    action,
    table,
    module: moduleFilter,
    actor,
    date,
    from,
    to,
  } = filters;

  let q = query;

  if (entityCode && entityCode !== 'ALL') {
    const entityUuid = await resolveEntityId(entityCode).catch(() => null);
    if (entityUuid && entityUuid !== entityCode) {
      q = q.or(`entity.eq.${entityCode},entity.eq.${entityUuid}`);
    } else {
      q = q.eq('entity', entityCode);
    }
  }

  if (actor) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor);
    if (isUuid) {
      q = q.eq('user_id', actor);
    } else {
      const { data: matchedUsers } = await supabaseAdmin
        .from('users')
        .select('id')
        .or(`email.ilike.%${actor}%,name.ilike.%${actor}%`);
      const matchedIds = (matchedUsers || []).map((u) => u.id);
      if (matchedIds.length > 0) {
        q = q.in('user_id', matchedIds);
      } else {
        return { query: q, empty: true };
      }
    }
  } else if (userId) {
    q = q.eq('user_id', userId);
  }

  if (action) {
    q = q.eq('action', action);
  }

  if (table) {
    q = q.eq('table_name', table);
  } else if (moduleFilter) {
    const modKey = moduleFilter.toLowerCase();
    const tables = MODULE_TABLE_MAP[modKey];
    if (tables && tables.length > 0) {
      q = q.in('table_name', tables);
    }
  }

  if (date) {
    const dateStr = date.includes('T') ? date.split('T')[0] : date;
    q = q.gte('created_at', `${dateStr}T00:00:00.000Z`);
    q = q.lte('created_at', `${dateStr}T23:59:59.999Z`);
  } else {
    if (from) {
      const fromIso = from.includes('T') ? from : `${from}T00:00:00.000Z`;
      q = q.gte('created_at', fromIso);
    }
    if (to) {
      const toIso = to.includes('T') ? to : `${to}T23:59:59.999Z`;
      q = q.lte('created_at', toIso);
    }
  }

  return { query: q, empty: false };
};

const resolveMatchingUserIdsForSearch = async (searchTerm) => {
  if (!searchTerm) return new Set();
  const { data: matchedUsers } = await supabaseAdmin
    .from('users')
    .select('id, name, email, user_number')
    .or(`email.ilike.%${searchTerm}%,name.ilike.%${searchTerm}%,user_number.ilike.%${searchTerm}%`);
  return new Set((matchedUsers || []).map((u) => u.id));
};

const matchesAuditSearch = (row, searchTerm, matchedUserIds) => {
  const actionRaw = String(row.action || '').toLowerCase();
  const actionHuman = actionRaw.replace(/[._-]+/g, ' ');
  const tableRaw = String(row.table_name || '').toLowerCase();
  const tableHuman = tableRaw.replace(/[._-]+/g, ' ');
  const recordId = String(row.record_id || '').toLowerCase();
  const auditNumber = String(row.audit_number || '').toLowerCase();
  const entity = String(row.entity || '').toLowerCase();
  const userId = String(row.user_id || '').toLowerCase();
  const detailsText =
    row.details !== null && row.details !== undefined
      ? (typeof row.details === 'string' ? row.details : JSON.stringify(row.details)).toLowerCase()
      : '';

  return (
    actionRaw.includes(searchTerm) ||
    actionHuman.includes(searchTerm) ||
    tableRaw.includes(searchTerm) ||
    tableHuman.includes(searchTerm) ||
    recordId.includes(searchTerm) ||
    auditNumber.includes(searchTerm) ||
    entity.includes(searchTerm) ||
    userId.includes(searchTerm) ||
    detailsText.includes(searchTerm) ||
    (Boolean(row.user_id) && matchedUserIds.has(row.user_id))
  );
};

/**
 * Count audit log entries for the active entity.
 * @param {object} params
 * @param {string} params.entityCode
 * @returns {Promise<number>}
 */
const getAuditLogCount = async (params = {}) => {
  const { entityCode, mergedFilters } = normalizeAuditParams(params);
  const searchTerm =
    typeof mergedFilters.search === 'string' ? mergedFilters.search.trim().toLowerCase() : '';

  if (!searchTerm) {
    const baseQuery = supabaseAdmin.from('audit_logs').select('*', { count: 'exact', head: true });
    const { query, empty } = await applyAuditBaseFilters(baseQuery, {
      entityCode,
      filters: mergedFilters,
    });
    if (empty) return 0;

    const { count, error } = await query;

    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Unable to count audit logs',
      });
    }

    return count || 0;
  }

  const baseQuery = supabaseAdmin.from('audit_logs').select('*');
  const { query, empty } = await applyAuditBaseFilters(baseQuery, {
    entityCode,
    filters: mergedFilters,
  });
  if (empty) return 0;

  const { data, error } = await query;
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to count audit logs',
    });
  }

  const matchedUserIds = await resolveMatchingUserIdsForSearch(searchTerm);
  const filteredRows = (data || []).filter((row) =>
    matchesAuditSearch(row, searchTerm, matchedUserIds)
  );
  return filteredRows.length;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuidStr = (val) => typeof val === 'string' && UUID_RE.test(val);

const safeSelectByIds = async (table, ids) => {
  const uniqueIds = Array.from(new Set(ids.filter(isUuidStr)));
  if (uniqueIds.length === 0) return new Map();
  try {
    const res = await supabaseAdmin.from(table).select('*').in('id', uniqueIds);
    const map = new Map();
    (res?.data || []).forEach((item) => {
      if (item && item.id) map.set(item.id, item);
    });
    return map;
  } catch {
    return new Map();
  }
};

/**
 * Batch-enriches paginated audit log rows with target record titles, business numbers,
 * and parent foreign keys (e.g. workRequestId on task/document logs) so deep-links
 * and Business Context cards work across all modules.
 */
const enrichAuditLogRows = async (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;

  try {
    const taskIds = [];
    const wrIds = [];
    const docIds = [];
    const invoiceIds = [];
    const disbursementIds = [];
    const transmittalIds = [];
    const clientIds = [];
    const templateIds = [];
    const opsReqIds = [];
    const targetUserIds = [];

    for (const row of rows) {
      const d = row.details && typeof row.details === 'object' ? row.details : {};
      const recId = row.record_id || d.recordId || d.record_id || d.id;
      const table = String(row.table_name || '').toLowerCase();

      if (table === 'users' && isUuidStr(recId)) targetUserIds.push(recId);
      if (isUuidStr(d.userId || d.user_id)) targetUserIds.push(d.userId || d.user_id);
      if (isUuidStr(d.targetUserId || d.target_user_id)) targetUserIds.push(d.targetUserId || d.target_user_id);

      if (table === 'tasks' && isUuidStr(recId)) taskIds.push(recId);
      if (isUuidStr(d.taskId || d.task_id)) taskIds.push(d.taskId || d.task_id);

      if (table === 'work_requests' && isUuidStr(recId)) wrIds.push(recId);
      if (isUuidStr(d.workRequestId || d.work_request_id || d.linkedWorkRequestId || d.linked_work_request_id)) {
        wrIds.push(d.workRequestId || d.work_request_id || d.linkedWorkRequestId || d.linked_work_request_id);
      }

      if (table === 'documents' && isUuidStr(recId)) docIds.push(recId);
      if (table === 'invoices' && isUuidStr(recId)) invoiceIds.push(recId);
      if (isUuidStr(d.invoiceId || d.invoice_id || d.linkedInvoiceId || d.linked_invoice_id)) {
        invoiceIds.push(d.invoiceId || d.invoice_id || d.linkedInvoiceId || d.linked_invoice_id);
      }

      if (table === 'disbursements' && isUuidStr(recId)) disbursementIds.push(recId);
      if (isUuidStr(d.disbursementId || d.disbursement_id)) {
        disbursementIds.push(d.disbursementId || d.disbursement_id);
      }

      if (table === 'transmittals' && isUuidStr(recId)) transmittalIds.push(recId);
      if (isUuidStr(d.transmittalId || d.transmittal_id || d.linkedTransmittalId || d.linked_transmittal_id)) {
        transmittalIds.push(d.transmittalId || d.transmittal_id || d.linkedTransmittalId || d.linked_transmittal_id);
      }

      if (table === 'clients' && isUuidStr(recId)) clientIds.push(recId);
      if (isUuidStr(d.clientId || d.client_id)) clientIds.push(d.clientId || d.client_id);

      if (table === 'retainer_templates' && isUuidStr(recId)) templateIds.push(recId);
      if (table === 'operations_requests' && isUuidStr(recId)) opsReqIds.push(recId);
    }

    const [
      tasksMap,
      docMap,
      invMap,
      disbMap,
      trkMap,
      tplMap,
      opsMap,
      targetUsersMap,
    ] = await Promise.all([
      safeSelectByIds('tasks', taskIds),
      safeSelectByIds('documents', docIds),
      safeSelectByIds('invoices', invoiceIds),
      safeSelectByIds('disbursements', disbursementIds),
      safeSelectByIds('transmittals', transmittalIds),
      safeSelectByIds('retainer_templates', templateIds),
      safeSelectByIds('operations_requests', opsReqIds),
      safeSelectByIds('users', targetUserIds),
    ]);

    for (const t of tasksMap.values()) {
      if (isUuidStr(t.work_request_id)) wrIds.push(t.work_request_id);
    }
    for (const doc of docMap.values()) {
      if (isUuidStr(doc.work_request_id)) wrIds.push(doc.work_request_id);
      if (isUuidStr(doc.client_id)) clientIds.push(doc.client_id);
    }
    for (const inv of invMap.values()) {
      if (isUuidStr(inv.work_request_id)) wrIds.push(inv.work_request_id);
      if (isUuidStr(inv.client_id)) clientIds.push(inv.client_id);
    }
    for (const disb of disbMap.values()) {
      if (isUuidStr(disb.linked_work_request_id)) wrIds.push(disb.linked_work_request_id);
      if (isUuidStr(disb.client_id)) clientIds.push(disb.client_id);
    }
    for (const trk of trkMap.values()) {
      if (isUuidStr(trk.work_request_id)) wrIds.push(trk.work_request_id);
      if (isUuidStr(trk.client_id)) clientIds.push(trk.client_id);
    }
    for (const ops of opsMap.values()) {
      if (isUuidStr(ops.work_request_id)) wrIds.push(ops.work_request_id);
    }

    const wrMap = await safeSelectByIds('work_requests', wrIds);
    for (const wr of wrMap.values()) {
      if (isUuidStr(wr.client_id)) clientIds.push(wr.client_id);
    }
    const clientMap = await safeSelectByIds('clients', clientIds);

    const entityIds = rows.map((r) => r.entity).filter(isUuidStr);
    const entityMap = await safeSelectByIds('entities', entityIds);
    const normalizeEntityVal = (val) => {
      if (!val) return val;
      if (val === 'a0000000-0000-0000-0000-000000000001') return 'ATA';
      if (val === 'a0000000-0000-0000-0000-000000000002') return 'LTA';
      const ent = entityMap.get(val);
      return ent?.code || val;
    };

    return rows.map((row) => {
      const rawDetails = row.details && typeof row.details === 'object' ? { ...row.details } : {};
      const recId = row.record_id || rawDetails.recordId || rawDetails.record_id || rawDetails.id;
      const table = String(row.table_name || '').toLowerCase();

      if (table === 'users' && recId && targetUsersMap.has(recId)) {
        const targetUser = targetUsersMap.get(recId);
        if (targetUser.user_number) {
          if (!rawDetails.userNumber) rawDetails.userNumber = targetUser.user_number;
          if (!rawDetails.user_number) rawDetails.user_number = targetUser.user_number;
        }
        if (!rawDetails.name && targetUser.name) rawDetails.name = targetUser.name;
        if (!rawDetails.email && targetUser.email) rawDetails.email = targetUser.email;
      }

      if (table === 'tasks' && recId && tasksMap.has(recId)) {
        const task = tasksMap.get(recId);
        if (!rawDetails.name && !rawDetails.title && task.title) rawDetails.name = task.title;
        if (!rawDetails.taskTitle && task.title) rawDetails.taskTitle = task.title;
        if (!rawDetails.workRequestId && !rawDetails.work_request_id && task.work_request_id) {
          rawDetails.workRequestId = task.work_request_id;
        }
        if (!rawDetails.status && task.status) rawDetails.status = task.status;
        if (!rawDetails.phase && task.phase) rawDetails.phase = task.phase;
        if (!rawDetails.dueDate && !rawDetails.due_date && task.due_date) {
          rawDetails.dueDate = task.due_date;
        }
        if (!rawDetails.assigneeId && !rawDetails.assignee_id && task.assignee_id) {
          rawDetails.assigneeId = task.assignee_id;
        }
      }

      if (table === 'work_requests' && recId && wrMap.has(recId)) {
        const wr = wrMap.get(recId);
        if (wr.work_request_number) {
          if (!rawDetails.workRequestNumber) rawDetails.workRequestNumber = wr.work_request_number;
          if (!rawDetails.workRequestNo) rawDetails.workRequestNo = wr.work_request_number;
          if (!rawDetails.work_request_number) rawDetails.work_request_number = wr.work_request_number;
        }
        if (!rawDetails.title && !rawDetails.name && wr.title) rawDetails.title = wr.title;
        if (!rawDetails.workRequestTitle && wr.title) rawDetails.workRequestTitle = wr.title;
        if (!rawDetails.workRequestId) rawDetails.workRequestId = wr.id;
        if (!rawDetails.status && wr.status) rawDetails.status = wr.status;
        if (!rawDetails.priority && wr.priority) rawDetails.priority = wr.priority;
        if (!rawDetails.phase && wr.phase) rawDetails.phase = wr.phase;
        if (!rawDetails.dueDate && !rawDetails.due_date && wr.due_date) {
          rawDetails.dueDate = wr.due_date;
        }
        if (!rawDetails.assignedTo && !rawDetails.assigned_to && wr.assigned_to) {
          rawDetails.assignedTo = wr.assigned_to;
        }
        if (rawDetails.archived === undefined && wr.archived !== undefined) {
          rawDetails.archived = wr.archived;
        }
        if (!rawDetails.clientId && !rawDetails.client_id && wr.client_id) {
          rawDetails.clientId = wr.client_id;
        }
      }

      if (table === 'documents' && recId && docMap.has(recId)) {
        const doc = docMap.get(recId);
        const docName = doc.original_name || doc.file_name;
        if (!rawDetails.name && !rawDetails.title && docName) rawDetails.name = docName;
        if (!rawDetails.category && (doc.category || doc.document_type)) {
          rawDetails.category = doc.category || doc.document_type;
        }
        if (!rawDetails.status && (doc.document_lifecycle || doc.status)) {
          rawDetails.status = doc.document_lifecycle || doc.status;
        }
        if (!rawDetails.workRequestId && !rawDetails.work_request_id && doc.work_request_id) {
          rawDetails.workRequestId = doc.work_request_id;
        }
        if (!rawDetails.taskId && !rawDetails.task_id && doc.linked_task_id) {
          rawDetails.taskId = doc.linked_task_id;
        }
        if (!rawDetails.clientId && !rawDetails.client_id && doc.client_id) {
          rawDetails.clientId = doc.client_id;
        }
      }

      if (table === 'disbursements' && recId && disbMap.has(recId)) {
        const disb = disbMap.get(recId);
        if (!rawDetails.disbursementNumber && disb.disbursement_number) {
          rawDetails.disbursementNumber = disb.disbursement_number;
        }
        if (!rawDetails.disbursement_number && disb.disbursement_number) {
          rawDetails.disbursement_number = disb.disbursement_number;
        }
        if (!rawDetails.description && disb.description) rawDetails.description = disb.description;
        if (!rawDetails.category && disb.category) rawDetails.category = disb.category;
        if (rawDetails.amount === undefined && disb.amount !== undefined) rawDetails.amount = disb.amount;
        if (!rawDetails.status && disb.status) rawDetails.status = disb.status;
        if (!rawDetails.workRequestId && disb.linked_work_request_id) {
          rawDetails.workRequestId = disb.linked_work_request_id;
        }
        if (!rawDetails.invoiceId && disb.linked_invoice_id) {
          rawDetails.invoiceId = disb.linked_invoice_id;
        }
        if (!rawDetails.transmittalId && disb.linked_transmittal_id) {
          rawDetails.transmittalId = disb.linked_transmittal_id;
        }
        if (!rawDetails.clientId && disb.client_id) rawDetails.clientId = disb.client_id;
      }

      if (table === 'invoices' && recId && invMap.has(recId)) {
        const inv = invMap.get(recId);
        if (!rawDetails.invoiceNumber && inv.invoice_number) {
          rawDetails.invoiceNumber = inv.invoice_number;
        }
        if (!rawDetails.invoice_number && inv.invoice_number) {
          rawDetails.invoice_number = inv.invoice_number;
        }
        if (rawDetails.amount === undefined && (inv.total_amount !== undefined || inv.amount !== undefined)) {
          rawDetails.amount = inv.total_amount ?? inv.amount;
        }
        if (!rawDetails.status && inv.status) rawDetails.status = inv.status;
        if (!rawDetails.workRequestId && inv.work_request_id) {
          rawDetails.workRequestId = inv.work_request_id;
        }
        if (!rawDetails.clientId && inv.client_id) rawDetails.clientId = inv.client_id;
      }

      if (table === 'transmittals' && recId && trkMap.has(recId)) {
        const trk = trkMap.get(recId);
        const trkNum = trk.tracking_number || trk.transmittal_number;
        if (!rawDetails.trackingNumber && trkNum) {
          rawDetails.trackingNumber = trkNum;
        }
        if (!rawDetails.tracking_number && trkNum) {
          rawDetails.tracking_number = trkNum;
        }
        if (!rawDetails.status && trk.status) rawDetails.status = trk.status;
        if (!rawDetails.workRequestId && trk.work_request_id) {
          rawDetails.workRequestId = trk.work_request_id;
        }
        if (!rawDetails.clientId && trk.client_id) rawDetails.clientId = trk.client_id;
      }

      if (table === 'clients' && recId && clientMap.has(recId)) {
        const cli = clientMap.get(recId);
        if (cli.client_number) {
          if (!rawDetails.clientNumber) rawDetails.clientNumber = cli.client_number;
          if (!rawDetails.client_number) rawDetails.client_number = cli.client_number;
        }
        if (!rawDetails.name && cli.name) rawDetails.name = cli.name;
        if (!rawDetails.clientName && cli.name) rawDetails.clientName = cli.name;
        if (!rawDetails.status && cli.status) rawDetails.status = cli.status;
      }

      if (table === 'retainer_templates' && recId && tplMap.has(recId)) {
        const tpl = tplMap.get(recId);
        const tplName = tpl.name || tpl.title;
        if (!rawDetails.name && !rawDetails.title && tplName) rawDetails.name = tplName;
      }

      if (table === 'operations_requests' && recId && opsMap.has(recId)) {
        const ops = opsMap.get(recId);
        if (!rawDetails.workRequestId && ops.work_request_id) {
          rawDetails.workRequestId = ops.work_request_id;
        }
        if (!rawDetails.taskId && ops.task_id) rawDetails.taskId = ops.task_id;
        if (!rawDetails.status && ops.status) rawDetails.status = ops.status;
      }

      const targetUid = rawDetails.targetUserId || rawDetails.target_user_id || rawDetails.userId || rawDetails.user_id;
      if (targetUid && targetUsersMap.has(targetUid)) {
        const tu = targetUsersMap.get(targetUid);
        if (tu.user_number) {
          if (!rawDetails.userNumber) rawDetails.userNumber = tu.user_number;
          if (!rawDetails.user_number) rawDetails.user_number = tu.user_number;
        }
      }

      const resolvedWrId =
        rawDetails.workRequestId ||
        rawDetails.work_request_id ||
        rawDetails.linkedWorkRequestId ||
        rawDetails.linked_work_request_id;
      if (resolvedWrId && wrMap.has(resolvedWrId)) {
        const parentWr = wrMap.get(resolvedWrId);
        if (parentWr.work_request_number) {
          if (!rawDetails.workRequestNumber) rawDetails.workRequestNumber = parentWr.work_request_number;
          if (!rawDetails.workRequestNo) rawDetails.workRequestNo = parentWr.work_request_number;
          if (!rawDetails.work_request_number) rawDetails.work_request_number = parentWr.work_request_number;
        }
        if (!rawDetails.workRequestTitle && !rawDetails.work_request_title && parentWr.title) {
          rawDetails.workRequestTitle = parentWr.title;
        }
        if (!rawDetails.clientId && !rawDetails.client_id && parentWr.client_id) {
          rawDetails.clientId = parentWr.client_id;
        }
      }

      const resolvedClientId = rawDetails.clientId || rawDetails.client_id;
      if (resolvedClientId && clientMap.has(resolvedClientId)) {
        const cli = clientMap.get(resolvedClientId);
        if (cli.client_number) {
          if (!rawDetails.clientNumber) rawDetails.clientNumber = cli.client_number;
          if (!rawDetails.client_number) rawDetails.client_number = cli.client_number;
        }
        if (!rawDetails.clientName && !rawDetails.client_name && cli.name) {
          rawDetails.clientName = cli.name;
        }
      }

      return {
        ...row,
        entity: normalizeEntityVal(row.entity),
        details: Object.keys(rawDetails).length > 0 ? rawDetails : row.details,
      };
    });
  } catch {
    return rows;
  }
};

/**
 * List audit log entries with optional filters and pagination.
 * @param {object} params
 * @param {string} params.entityCode
 * @param {object} params.filters
 * @returns {Promise<{ data: object[], meta: object }>}
 */
const getAuditLogs = async (params = {}) => {
  const { entityCode, mergedFilters } = normalizeAuditParams(params);
  const {
    page: pageParam,
    limit = 20,
    offset: offsetParam = 0,
    search,
    sortOrder = 'desc',
  } = mergedFilters;

  const limitNum = Number(limit);
  const page = pageParam ? Number(pageParam) : Math.floor(Number(offsetParam) / limitNum) + 1;
  const offset = pageParam ? (page - 1) * limitNum : Number(offsetParam);
  const ascending = sortOrder === 'asc';
  const searchTerm = typeof search === 'string' ? search.trim().toLowerCase() : '';

  const baseQuery = supabaseAdmin
    .from('audit_logs')
    .select('*', searchTerm ? undefined : { count: 'exact' });
  const { query, empty } = await applyAuditBaseFilters(baseQuery, {
    entityCode,
    filters: mergedFilters,
  });

  if (empty) {
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

  let rows = [];
  let total = 0;

  if (searchTerm) {
    const { data, error } = await query.order('created_at', { ascending });
    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Unable to list audit logs',
      });
    }
    const matchedUserIds = await resolveMatchingUserIdsForSearch(searchTerm);
    const filteredRows = (data || []).filter((row) =>
      matchesAuditSearch(row, searchTerm, matchedUserIds)
    );
    total = filteredRows.length;
    rows = filteredRows.slice(offset, offset + limitNum);
  } else {
    const { data, error, count } = await query
      .order('created_at', { ascending })
      .range(offset, offset + limitNum - 1);

    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Unable to list audit logs',
      });
    }

    rows = data || [];
    total = count !== undefined && count !== null ? count : rows.length;
  }

  // Enrich target record context and foreign keys for deep-linking
  rows = await enrichAuditLogRows(rows);

  // Enrich actor metadata
  const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
  const userMap = new Map();
  if (userIds.length > 0) {
    const { data: usersData } = await supabaseAdmin
      .from('users')
      .select('id, name, email, role, user_number, avatar_url')
      .in('id', userIds);
    (usersData || []).forEach((u) => userMap.set(u.id, u));
  }

  return {
    data: rows.map((row) => {
      const user = userMap.get(row.user_id) || null;
      return {
        id: row.id,
        auditNumber: row.audit_number || null,
        audit_number: row.audit_number || null,
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
              userNumber: user.user_number || null,
              user_number: user.user_number || null,
              avatarUrl: user.avatar_url || null,
              avatar_url: user.avatar_url || null,
            }
          : row.user_id
          ? { id: row.user_id }
          : null,
        actorUserNumber: user?.user_number || null,
        actorAvatarUrl: user?.avatar_url || null,
        actor_avatar_url: user?.avatar_url || null,
        userName: user?.name || null,
        userEmail: user?.email || null,
        userAvatarUrl: user?.avatar_url || null,
        user_avatar_url: user?.avatar_url || null,
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
  toApiUser,
  loadUserDepartments,
  loadUsersDepartmentsMap,
  assertAccountCapNotReached,
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
  countAuditLogs: getAuditLogCount,
  getAuditLogs,
  listAuditLogs: getAuditLogs,
};
