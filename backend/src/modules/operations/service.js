/**
 * Operations / Work Requests service.
 * CRUD, lifecycle transitions, task management, and visibility rules.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { randomUUID } = require('crypto');

const isValidUUID = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const VALID_TRANSITIONS = {
  Draft: ['Pre-processing', 'In Progress', 'Processing', 'Cancelled'],
  'Pre-processing': ['Processing', 'In Progress', 'For Review', 'Cancelled'],
  'In Progress': ['For Review', 'Completed', 'Processing', 'Cancelled'],
  Processing: ['Completed', 'Billing', 'Disbursement', 'For Review', 'Cancelled'],
  'For Review': ['Completed', 'In Progress', 'Processing', 'Cancelled'],
  Completed: ['Draft', 'Processing'],
  Cancelled: ['Draft', 'In Progress'],
};

/* ── Cached entity resolution ─────────────────────────────────────── */
const ENTITY_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const entityIdCache = new Map(); // code → { id, expiresAt }
const entityCodeCache = new Map(); // id   → { code, expiresAt }

const resolveEntityId = async (code) => {
  const cached = entityIdCache.get(code);
  if (cached && Date.now() < cached.expiresAt) return cached.id;

  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('id')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) {
    throw new AppError({ statusCode: 400, title: 'Bad Request', detail: `Unknown entity ${code}` });
  }
  entityIdCache.set(code, { id: data.id, expiresAt: Date.now() + ENTITY_CACHE_TTL_MS });
  return data.id;
};

const resolveEntityCode = async (id) => {
  const cached = entityCodeCache.get(id);
  if (cached && Date.now() < cached.expiresAt) return cached.code;

  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('code')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return id;
  entityCodeCache.set(id, { code: data.code, expiresAt: Date.now() + ENTITY_CACHE_TTL_MS });
  return data.code;
};

const toApiWorkRequest = (row, entityCode) => ({
  id: row.id,
  entity: entityCode,
  title: row.title,
  description: row.description || null,
  clientId: row.client_id,
  status: row.status,
  priority: row.priority || 'Normal',
  archived: row.archived ?? false,
  requestedBy: row.requested_by || null,
  assignedTo: row.assigned_to || null,
  dueDate: row.due_date || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const formatTimeManila = (dateTime) => {
  if (!dateTime) return null;
  const d = new Date(dateTime);
  if (isNaN(d.getTime())) return null;
  const options = {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value || '00';
  const minute = parts.find(p => p.type === 'minute')?.value || '00';
  return `${hour}:${minute}`;
};

const formatDateManila = (dateVal) => {
  if (!dateVal) return null;
  if (typeof dateVal === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return dateVal;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return dateVal;
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  const options = {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(d);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const toApiTask = (row, { checklist = [], timeLogs = [], taskDocuments = [] } = {}) => {
  const taskLevelLogs = timeLogs.filter(t => !t.checklist_item_id);

  return {
    id: row.id,
    workRequestId: row.work_request_id,
    title: row.title,
    description: row.description || null,
    status: row.status,
    assigneeId: row.assignee_id || null,
    assigneeName: row.assignee_name || null,
    predecessors: row.predecessors || [],
    dueDate: row.due_date || null,
    displayOrder: row.display_order,
    checklist: checklist.map((c) => {
      const itemLogs = timeLogs.filter(t => t.checklist_item_id === c.id);
      return {
        id: c.id,
        text: c.text,
        category: c.category || null,
        completed: c.completed,
        assigneeId: c.assignee_id || null,
        assigneeName: c.assignee_name || null,
        dependsOn: Array.isArray(c.depends_on)
          ? (c.depends_on[0] || null)
          : (c.depends_on || null),
        timeLogs: itemLogs.map((t) => ({
          id: t.id,
          startTime: formatTimeManila(t.start_time),
          endTime: formatTimeManila(t.end_time),
          date: formatDateManila(t.date),
          hours: Number(t.hours),
          userId: t.user_id || null,
          note: t.note || null,
          workerName: t.worker_name || null,
          checklistItemId: t.checklist_item_id || null,
        })),
      };
    }),
    timeLogs: taskLevelLogs.map((t) => ({
      id: t.id,
      startTime: formatTimeManila(t.start_time),
      endTime: formatTimeManila(t.end_time),
      date: formatDateManila(t.date),
      hours: Number(t.hours),
      userId: t.user_id || null,
      note: t.note || null,
      workerName: t.worker_name || null,
      checklistItemId: null,
    })),
    taskDocuments: taskDocuments.map((d) => ({
      documentId: d.id,
      fileName: d.file_name,
      uploadDate: d.upload_date ? new Date(d.upload_date).toISOString().slice(0, 10) : null,
      uploaderId: d.uploader_id,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const isBackOffice = (user) => {
  if (!user) return false;
  const depts = user.departments || [];
  return (
    user.role === 'Admin' ||
    user.role === 'Manager' ||
    depts.includes('Management') ||
    depts.includes('Accounting') ||
    depts.includes('Documentation')
  );
};

const loadTasksForWorkRequests = async (wrIds) => {
  const tasks = new Map();
  if (!wrIds.length) return tasks;
  const { data } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .in('work_request_id', wrIds)
    .is('deleted_at', null)
    .order('display_order', { ascending: true });

  (data || []).forEach((t) => {
    if (!tasks.has(t.work_request_id)) tasks.set(t.work_request_id, []);
    tasks.get(t.work_request_id).push(t);
  });
  return tasks;
};

const loadTaskExtras = async (taskIds) => {
  const checklist = new Map();
  const timeLogs = new Map();
  const taskDocuments = new Map();
  if (!taskIds.length) return { checklist, timeLogs, taskDocuments };
  const [{ data: clRows }, { data: tlRows }, { data: docRows }] = await Promise.all([
    supabaseAdmin.from('task_checklists').select('*').in('task_id', taskIds),
    supabaseAdmin.from('task_time_logs').select('*').in('task_id', taskIds),
    supabaseAdmin.from('documents').select('*').in('linked_task_id', taskIds).is('deleted_at', null),
  ]);
  (clRows || []).forEach((r) => {
    if (!checklist.has(r.task_id)) checklist.set(r.task_id, []);
    checklist.get(r.task_id).push(r);
  });
  (tlRows || []).forEach((r) => {
    if (!timeLogs.has(r.task_id)) timeLogs.set(r.task_id, []);
    timeLogs.get(r.task_id).push(r);
  });
  (docRows || []).forEach((r) => {
    if (!taskDocuments.has(r.linked_task_id)) taskDocuments.set(r.linked_task_id, []);
    taskDocuments.get(r.linked_task_id).push(r);
  });
  return { checklist, timeLogs, taskDocuments };
};

const canViewWorkRequest = (wr, user, taskMap) => {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  if (isBackOffice(user)) return true;
  if (wr.assigned_to === user.id || wr.requested_by === user.id) return true;
  const tasks = taskMap.get(wr.id) || [];
  return tasks.some((t) => {
    if (t.assignee_id === user.id || t.assignee_name === user.name) return true;
    return false;
  });
};

const listWorkRequests = async ({
  entityId,
  user,
  search,
  status,
  clientId,
  archived,
  page,
  limit,
  sortBy,
  sortOrder,
  includeTasks,
}) => {
  const isPaginated = page !== undefined || limit !== undefined;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const sortField = ['created_at', 'due_date', 'title', 'status'].includes(sortBy)
    ? sortBy
    : 'created_at';
  const sortAsc = String(sortOrder).toLowerCase() === 'asc';
  const isArchived = archived === true || archived === 'true';

  let query = supabaseAdmin
    .from('work_requests')
    .select('*')
    .is('deleted_at', null)
    .order(sortField, { ascending: sortAsc });

  if (isArchived) {
    query = query.eq('archived', true);
  } else if (archived === false || archived === 'false') {
    query = query.or('archived.is.null,archived.eq.false');
  }
  if (status) query = query.eq('status', status);
  if (clientId) {
    query = query.eq('client_id', clientId);
  }
  if (search) {
    const q = search.toLowerCase();
    query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list work requests',
    });
  }

  // For Admin users, skip the expensive visibility filter entirely.
  // For other users, pre-filter using WR-level assignment (which doesn't need tasks).
  // Task-level assignment check happens after pagination to avoid loading all tasks.
  let visibleRows;
  if (isBackOffice(user)) {
    visibleRows = data || [];
  } else {
    visibleRows = (data || []).filter(
      (row) => row.assigned_to === user.id || row.requested_by === user.id
    );
  }

  const withTasks = includeTasks === true || String(includeTasks).toLowerCase() === 'true';

  // Resolve entity code(s) — single lookup for scoped view, per-row for consolidated
  let entityCodeMap;
  let singleEntityCode;
  if (entityId && entityId !== 'ALL') {
    const code = await resolveEntityCode(entityId);
    entityCodeMap = null; // use single code
    singleEntityCode = code;
  } else {
    // Consolidated: build a lookup map from all entity_ids present in the result set
    const uniqueEntityIds = [...new Set(visibleRows.map((r) => r.entity_id).filter(Boolean))];
    entityCodeMap = new Map();
    await Promise.all(
      uniqueEntityIds.map(async (eid) => {
        const code = await resolveEntityCode(eid);
        entityCodeMap.set(eid, code);
      })
    );
  }

  // Paginate from the pre-filtered set
  const resultRows = isPaginated
    ? visibleRows.slice((pageNum - 1) * limitNum, pageNum * limitNum)
    : visibleRows;

  // Only load tasks for the paginated subset (not ALL work requests)
  const taskMap = withTasks
    ? await loadTasksForWorkRequests(resultRows.map((r) => r.id))
    : new Map();

  // Load checklist/time-log extras when embedding tasks so the client does not
  // overwrite a freshly-saved checklist with [] after refresh/page switch.
  let extras = { checklist: new Map(), timeLogs: new Map(), taskDocuments: new Map() };
  if (withTasks) {
    const allTaskIds = [];
    taskMap.forEach((tasks) => allTaskIds.push(...tasks.map((t) => t.id)));
    extras = await loadTaskExtras(allTaskIds);
  }

  const result = resultRows.map((row) => {
    const code = entityCodeMap
      ? entityCodeMap.get(row.entity_id) || row.entity_id
      : singleEntityCode;
    const wr = toApiWorkRequest(row, code);
    if (withTasks) {
      wr.tasks = (taskMap.get(row.id) || []).map((t) =>
        toApiTask(t, {
          checklist: extras.checklist.get(t.id) || [],
          timeLogs: extras.timeLogs.get(t.id) || [],
          taskDocuments: extras.taskDocuments.get(t.id) || [],
        })
      );
    }
    return wr;
  });

  if (!isPaginated) {
    return { data: result };
  }

  return {
    data: result,
    meta: {
      total: visibleRows.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(visibleRows.length / limitNum) || 1,
    },
  };
};

const createWorkRequest = async ({ entityId, data, user }) => {
  const id = data.id && isValidUUID(data.id) ? data.id : randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    entity_id: entityId,
    client_id: data.clientId,
    title: data.title,
    description: data.description || null,
    status: data.status || 'Draft',
    priority: data.priority || 'Normal',
    requested_by: data.requestedBy || user.id,
    assigned_to: data.assignedTo || null,
    due_date: data.dueDate || null,
    created_at: now,
    updated_at: now,
  };

  const { error } = await supabaseAdmin.from('work_requests').insert(record);
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to create work request',
    });
  }

  return getWorkRequestById({ id, entityId, user });
};

const getWorkRequestById = async ({ id, entityId, user }) => {
  const { data, error } = await supabaseAdmin
    .from('work_requests')
    .select('*')
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve work request',
    });
  }
  if (!data) return null;

  const taskMap = await loadTasksForWorkRequests([id]);
  if (!canViewWorkRequest(data, user, taskMap)) return null;

  const entityCode = await resolveEntityCode(entityId);
  return toApiWorkRequest(data, entityCode);
};

const updateWorkRequest = async ({ id, entityId, data, user }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  if (data.status && data.status !== existing.status) {
    const allowed = VALID_TRANSITIONS[existing.status] || [];
    if (!allowed.includes(data.status)) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: `Invalid status transition from ${existing.status} to ${data.status}`,
      });
    }
  }

  const updates = {
    title: data.title ?? existing.title,
    description: data.description ?? existing.description,
    client_id: data.clientId ?? existing.clientId,
    status: data.status ?? existing.status,
    priority: data.priority ?? existing.priority,
    assigned_to: data.assignedTo ?? existing.assignedTo,
    due_date: data.dueDate ?? existing.dueDate,
    updated_at: new Date().toISOString(),
  };

  if (data.archived !== undefined) updates.archived = data.archived;

  const { error } = await supabaseAdmin
    .from('work_requests')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId);
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update work request',
    });
  }

  return getWorkRequestById({ id, entityId, user });
};

const archiveWorkRequest = async ({ id, entityId, user }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  const { error } = await supabaseAdmin
    .from('work_requests')
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to archive work request' });
  }

  // Return the post-update row so the frontend sees the current archived flag.
  return getWorkRequestById({ id, entityId, user });
};

const unarchiveWorkRequest = async ({ id, entityId, user }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  const { error } = await supabaseAdmin
    .from('work_requests')
    .update({ archived: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to restore work request' });
  }

  // Return the post-update row so the frontend sees the current archived flag.
  return getWorkRequestById({ id, entityId, user });
};

const getWorkRequestCounts = async ({ entityId }) => {
  const baseQuery = () => {
    let q = supabaseAdmin
      .from('work_requests')
      .select('*', { count: 'exact', head: true })
      .is('deleted_at', null);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q;
  };

  const [{ count: activeCount }, { count: archivedCount }] = await Promise.all([
    baseQuery().or('archived.is.null,archived.eq.false'),
    baseQuery().eq('archived', true),
  ]);

  return { active: activeCount || 0, archived: archivedCount || 0 };
};

const deleteWorkRequest = async ({ id, entityId, user }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) return false;

  const { error } = await supabaseAdmin
    .from('work_requests')
    .update({
      deleted_at: new Date().toISOString(),
      status: 'Cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to delete work request',
    });
  }
  return true;
};

const listTasks = async ({ workRequestId, entityId: _entityId }) => {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('work_request_id', workRequestId)
    .is('deleted_at', null)
    .order('display_order', { ascending: true });

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list tasks',
    });
  }

  const taskIds = (data || []).map((t) => t.id);
  const extras = await loadTaskExtras(taskIds);
  return (data || []).map((t) =>
    toApiTask(t, {
      checklist: extras.checklist.get(t.id) || [],
      timeLogs: extras.timeLogs.get(t.id) || [],
      taskDocuments: extras.taskDocuments.get(t.id) || [],
    })
  );
};

const getTaskById = async ({ workRequestId, taskId, entityId: _entityId }) => {
  const { data, error } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('work_request_id', workRequestId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve task',
    });
  }
  if (!data) return null;

  const extras = await loadTaskExtras([taskId]);
  return toApiTask(data, {
    checklist: extras.checklist.get(taskId) || [],
    timeLogs: extras.timeLogs.get(taskId) || [],
    taskDocuments: extras.taskDocuments.get(taskId) || [],
  });
};

const createTask = async ({ workRequestId, entityId, data, user: _user }) => {
  const id = data.id && isValidUUID(data.id) ? data.id : randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    work_request_id: workRequestId,
    title: data.title,
    description: data.description || null,
    status: data.status || 'Draft',
    assignee_id: data.assigneeId || null,
    assignee_name: data.assigneeName || null,
    predecessors: Array.isArray(data.predecessors) ? data.predecessors.filter(isValidUUID) : [],
    due_date: data.dueDate || null,
    display_order: data.displayOrder ?? 0,
    created_at: now,
    updated_at: now,
  };

  const { error } = await supabaseAdmin.from('tasks').insert(record);
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to create task',
    });
  }

  if (data.checklist?.length) {
    await upsertChecklist(id, data.checklist);
    const checklistTimeLogs = [];
    data.checklist.forEach(item => {
      if (Array.isArray(item.timeLogs)) {
        item.timeLogs.forEach(log => {
          checklistTimeLogs.push({
            ...log,
            checklistItemId: item.id
          });
        });
      }
    });
    if (checklistTimeLogs.length) {
      await upsertTimeLogs(id, checklistTimeLogs, false);
    }
  }
  if (data.timeLogs?.length) {
    await upsertTimeLogs(id, data.timeLogs, true);
  }

  return getTaskById({ workRequestId, taskId: id, entityId });
};

const upsertChecklist = async (taskId, checklist) => {
  await supabaseAdmin.from('task_checklists').delete().eq('task_id', taskId);

  // Map temporary checklist IDs to new valid UUIDs to resolve dependsOn dependencies
  const chkIdMap = new Map();
  checklist.forEach((item) => {
    if (item.id) {
      const newId = isValidUUID(item.id) ? item.id : randomUUID();
      chkIdMap.set(item.id, newId);
    }
  });

  const rows = checklist.map((item) => {
    let dependsOn = Array.isArray(item.dependsOn)
      ? item.dependsOn
      : (item.dependsOn ? [item.dependsOn] : []);

    // Resolve dependencies using the map and ensure only valid UUIDs are persisted
    dependsOn = dependsOn.map((id) => chkIdMap.get(id) || id).filter(isValidUUID);

    const itemId = item.id ? (chkIdMap.get(item.id) || item.id) : randomUUID();

    return {
      id: isValidUUID(itemId) ? itemId : randomUUID(),
      task_id: taskId,
      text: item.text,
      category: item.category || null,
      completed: item.completed ?? false,
      assignee_id: item.assigneeId || null,
      assignee_name: item.assigneeName || null,
      depends_on: dependsOn,
    };
  });
  if (rows.length) await supabaseAdmin.from('task_checklists').insert(rows);
};

const upsertTimeLogs = async (taskId, timeLogs, deleteExisting = true) => {
  if (deleteExisting) {
    await supabaseAdmin.from('task_time_logs').delete().eq('task_id', taskId).is('checklist_item_id', null);
  }
  const rows = timeLogs.map((log) => {
    let startTimeStr = null;
    if (log.date && log.startTime) {
      if (log.startTime.includes('T') || log.startTime.includes(' ')) {
        startTimeStr = log.startTime;
      } else {
        startTimeStr = `${log.date}T${log.startTime}:00+08:00`;
      }
    }
    let endTimeStr = null;
    if (log.date && log.endTime) {
      if (log.endTime.includes('T') || log.endTime.includes(' ')) {
        endTimeStr = log.endTime;
      } else {
        endTimeStr = `${log.date}T${log.endTime}:00+08:00`;
      }
    }
    return {
      task_id: taskId,
      start_time: startTimeStr,
      end_time: endTimeStr,
      date: log.date || null,
      hours: log.hours ?? 0,
      user_id: log.userId || null,
      note: log.note || null,
      worker_name: log.workerName || null,
      checklist_item_id: log.checklistItemId || null,
    };
  });
  if (rows.length) await supabaseAdmin.from('task_time_logs').insert(rows);
};

const addTimeLogs = async ({ workRequestId, taskId, entityId, logs, user }) => {
  const existing = await getTaskById({ workRequestId, taskId, entityId });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found' });
  }

  const rows = logs.map((log) => {
    let startTimeStr = null;
    if (log.date && log.startTime) {
      if (log.startTime.includes('T') || log.startTime.includes(' ')) {
        startTimeStr = log.startTime;
      } else {
        startTimeStr = `${log.date}T${log.startTime}:00+08:00`;
      }
    }
    let endTimeStr = null;
    if (log.date && log.endTime) {
      if (log.endTime.includes('T') || log.endTime.includes(' ')) {
        endTimeStr = log.endTime;
      } else {
        endTimeStr = `${log.date}T${log.endTime}:00+08:00`;
      }
    }
    return {
      task_id: taskId,
      start_time: startTimeStr,
      end_time: endTimeStr,
      date: log.date || null,
      hours: log.hours ?? 0,
      user_id: log.userId || user.id,
      note: log.note || null,
      worker_name: log.workerName || null,
      checklist_item_id: log.checklistItemId || null,
    };
  });

  const { error } = await supabaseAdmin.from('task_time_logs').insert(rows);
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to save time logs',
    });
  }

  return getTaskById({ workRequestId, taskId, entityId });
};

const updateTask = async ({ workRequestId, taskId, entityId, data, user: _user }) => {
  const existing = await getTaskById({ workRequestId, taskId, entityId });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found' });
  }

  const updates = {
    title: data.title ?? existing.title,
    description: data.description ?? existing.description,
    status: data.status ?? existing.status,
    assignee_id: data.assigneeId ?? existing.assigneeId,
    assignee_name: data.assigneeName ?? existing.assigneeName,
    predecessors: data.predecessors !== undefined
      ? (Array.isArray(data.predecessors) ? data.predecessors.filter(isValidUUID) : [])
      : existing.predecessors,
    due_date: data.dueDate ?? existing.dueDate,
    display_order: data.displayOrder ?? existing.displayOrder,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('tasks')
    .update(updates)
    .eq('id', taskId)
    .eq('work_request_id', workRequestId);
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update task',
    });
  }

  if (data.checklist !== undefined) {
    await upsertChecklist(taskId, data.checklist);
    const checklistTimeLogs = [];
    data.checklist.forEach(item => {
      if (Array.isArray(item.timeLogs)) {
        item.timeLogs.forEach(log => {
          checklistTimeLogs.push({
            ...log,
            checklistItemId: item.id
          });
        });
      }
    });
    await supabaseAdmin.from('task_time_logs').delete().eq('task_id', taskId).not('checklist_item_id', 'is', null);
    if (checklistTimeLogs.length) {
      await upsertTimeLogs(taskId, checklistTimeLogs, false);
    }
  }
  if (data.timeLogs !== undefined) {
    await upsertTimeLogs(taskId, data.timeLogs, true);
  }

  return getTaskById({ workRequestId, taskId, entityId });
};

const deleteTask = async ({ workRequestId, taskId, entityId }) => {
  const existing = await getTaskById({ workRequestId, taskId, entityId });
  if (!existing) return false;

  const { error } = await supabaseAdmin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('work_request_id', workRequestId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to delete task',
    });
  }
  return true;
};

/**
 * Fetch related financial and document records linked to a work request.
 * Read-only; uses indexed work_request_id / linked_work_request_id columns.
 * @param {object} params
 * @param {string} params.id - Work request UUID
 * @param {string} params.entityId - Entity UUID
 * @returns {Promise<{ invoices: object[], disbursements: object[], transmittals: object[], documents: object[] }>}
 */
const getWorkRequestRelated = async ({ id, entityId }) => {
  const { data: wr } = await supabaseAdmin
    .from('work_requests')
    .select('id, entity_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!wr) {
    return { invoices: [], disbursements: [], transmittals: [], documents: [] };
  }

  const relatedEntityId = entityId && entityId !== 'ALL' ? entityId : wr.entity_id;

  const [{ data: invoices }, { data: disbursements }, { data: transmittals }, { data: documents }] =
    await Promise.all([
      supabaseAdmin
        .from('invoices')
        .select('*, clients(name)')
        .eq('entity_id', relatedEntityId)
        .eq('work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('disbursements')
        .select('*, clients(name)')
        .eq('entity_id', relatedEntityId)
        .eq('linked_work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('transmittals')
        .select('*, clients(name)')
        .eq('entity_id', relatedEntityId)
        .eq('work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('documents')
        .select('*')
        .eq('entity_id', relatedEntityId)
        .eq('work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ]);

  return {
    invoices: invoices || [],
    disbursements: disbursements || [],
    transmittals: transmittals || [],
    documents: documents || [],
  };
};

/**
 * Fetch related financial records linked to a task.
 * Because task linkage is stored through the parent work request, the endpoint
 * returns invoices/disbursements for the task's work request; callers filter by
 * linkedTaskId when they need task-scoped records.
 * @param {object} params
 * @param {string} params.id - Task UUID
 * @param {string} params.entityId - Entity UUID
 * @returns {Promise<{ invoices: object[], disbursements: object[] }>}
 */
const getTaskRelated = async ({ id, entityId }) => {
  const { data: task } = await supabaseAdmin
    .from('tasks')
    .select('id, work_request_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!task || !task.work_request_id) {
    return { invoices: [], disbursements: [] };
  }

  const { data: wr } = await supabaseAdmin
    .from('work_requests')
    .select('id, entity_id')
    .eq('id', task.work_request_id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!wr) {
    return { invoices: [], disbursements: [] };
  }

  const relatedEntityId = entityId && entityId !== 'ALL' ? entityId : wr.entity_id;

  const [{ data: invoices }, { data: disbursements }] = await Promise.all([
    supabaseAdmin
      .from('invoices')
      .select('*, clients(name)')
      .eq('entity_id', relatedEntityId)
      .eq('work_request_id', task.work_request_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('disbursements')
      .select('*, clients(name)')
      .eq('entity_id', relatedEntityId)
      .eq('linked_work_request_id', task.work_request_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  return {
    invoices: invoices || [],
    disbursements: disbursements || [],
  };
};

// ============================================================
// Retainer Templates
// ============================================================

const listRetainerTemplates = async ({ entityId }) => {
  const { data, error } = await supabaseAdmin
    .from('retainer_templates')
    .select('*, entities(code), clients(name)')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list retainer templates',
    });
  }

  return data || [];
};

const createRetainerTemplate = async ({ entityId, userId, data }) => {
  const row = {
    entity_id: entityId,
    name: data.title || data.name,
    description: data.description || null,
    client_id: data.clientId || null,
    schedule: data.schedule || null,
    priority: data.priority || 'Normal',
    assigned_to: data.assignedTo || null,
    pf_amount: data.pfAmount || 0,
    tasks: data.tasks || [],
    created_by: userId,
  };

  const { data: template, error } = await supabaseAdmin
    .from('retainer_templates')
    .insert(row)
    .select('*, entities(code), clients(name)')
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to create retainer template',
    });
  }

  return template;
};

const updateRetainerTemplate = async ({ entityId, id, data }) => {
  const updates = { updated_at: new Date().toISOString() };

  if (data.title !== undefined) updates.name = data.title;
  else if (data.name !== undefined) updates.name = data.name;
  if (data.description !== undefined) updates.description = data.description;
  if (data.clientId !== undefined) updates.client_id = data.clientId;
  if (data.schedule !== undefined) updates.schedule = data.schedule;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.assignedTo !== undefined) updates.assigned_to = data.assignedTo;
  if (data.pfAmount !== undefined) updates.pf_amount = data.pfAmount;
  if (data.tasks !== undefined) updates.tasks = data.tasks;

  const { data: updated, error } = await supabaseAdmin
    .from('retainer_templates')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .select('*, entities(code), clients(name)')
    .single();

  if (error || !updated) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Retainer template not found',
    });
  }

  return updated;
};

const deleteRetainerTemplate = async ({ entityId, id }) => {
  const { error } = await supabaseAdmin
    .from('retainer_templates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to delete retainer template',
    });
  }

  return true;
};

// ============================================================
// Ground Workers
// ============================================================

const listGroundWorkers = async ({ entityId }) => {
  let query = supabaseAdmin.from('ground_workers').select('*').order('name', { ascending: true });

  if (entityId) {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list ground workers',
    });
  }

  return data || [];
};

const createGroundWorker = async ({ entityId, userId, data }) => {
  const row = {
    entity_id: entityId,
    name: data.name,
    created_by: userId,
  };

  const { data: worker, error } = await supabaseAdmin
    .from('ground_workers')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to create ground worker',
    });
  }

  return worker;
};

module.exports = {
  listWorkRequests,
  createWorkRequest,
  getWorkRequestById,
  updateWorkRequest,
  archiveWorkRequest,
  unarchiveWorkRequest,
  getWorkRequestCounts,
  deleteWorkRequest,
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  resolveEntityId,
  getWorkRequestRelated,
  getTaskRelated,
  listRetainerTemplates,
  createRetainerTemplate,
  updateRetainerTemplate,
  deleteRetainerTemplate,
  listGroundWorkers,
  createGroundWorker,
  addTimeLogs,
};
