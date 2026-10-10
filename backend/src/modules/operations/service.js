/**
 * Operations / Work Requests service.
 * CRUD, lifecycle transitions, task management, and visibility rules.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { concurrencyConflict, resolveExpectedVersion } = require('../../lib/concurrency');
const { randomUUID } = require('crypto');
const { tokenizeTask } = require('../../lib/tokenizer');
const auditService = require('../../services/auditService');
const { notify } = require('../../services/notify');
const logger = require('../../lib/logger');

const PHASE_SEQUENCE = ['pre_processing', 'processing', 'quality_assurance', 'completion'];

const PHASE_STATUS_MAP = {
  pre_processing: 'Pre-processing',
  processing: 'Processing',
  quality_assurance: 'Quality Assurance',
  completion: 'Completed',
};

const isValidUUID = (v) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const isManager = (user) =>
  user?.role === 'Manager' && user?.role !== 'Admin';

const VALID_TRANSITIONS = {
  Draft: ['Pre-processing', 'In Progress', 'Processing', 'Cancelled'],
  'Pre-processing': ['Processing', 'In Progress', 'For Review', 'Cancelled'],
  'In Progress': ['For Review', 'Completed', 'Processing', 'Cancelled'],
  Processing: ['Completed', 'Billing', 'For Billing', 'Disbursement', 'For Review', 'Cancelled'],
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
  clientName: row.client_name || row.clients?.name || null,
  status: row.status,
  phase: row.phase || null,
  onHold: row.on_hold ?? false,
  on_hold: row.on_hold ?? false,
  phaseEnteredAt: row.phase_entered_at || null,
  phase_entered_at: row.phase_entered_at || null,
  priority: row.priority || 'Normal',
  archived: row.archived ?? false,
  requestedBy: row.requested_by || null,
  assignedTo: row.assigned_to || null,
  coAssignees: Array.isArray(row.co_assignees) ? row.co_assignees : (row.coAssignees || []),
  dueDate: row.due_date || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version || 1,
});

const formatTimeManila = (dateTime) => {
  if (!dateTime) return null;
  const d = new Date(dateTime);
  if (isNaN(d.getTime())) return null;
  const options = {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(d);
  const hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
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
    day: '2-digit',
  };
  const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(d);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
};

const toApiTask = (
  row,
  { checklist = [], timeLogs = [], taskDocuments = [], assignees = [], taskAssignees = [] } = {}
) => {
  const taskLevelLogs = timeLogs.filter((t) => !t.checklist_item_id);

  const resolvedAssignees =
    assignees && assignees.length > 0
      ? assignees
      : row.assignees && row.assignees.length > 0
        ? row.assignees
        : row.assignee_id
          ? [row.assignee_id]
          : [];

  return {
    id: row.id,
    workRequestId: row.work_request_id,
    title: row.title,
    description: row.description || null,
    status: row.status,
    phase: row.phase || null,
    qaStatus: row.qa_status || 'none',
    qa_status: row.qa_status || 'none',
    phaseEnteredAt: row.phase_entered_at || null,
    phase_entered_at: row.phase_entered_at || null,
    assigneeId: row.assignee_id || null,
    assigneeName: row.assignee_name || null,
    assignees: resolvedAssignees,
    taskAssignees: taskAssignees,
    task_assignees: taskAssignees,
    predecessors: row.predecessors || [],
    dueDate: row.due_date || null,
    requiredLinkType: row.required_link_type || null,
    displayOrder: row.display_order,
    version: row.version || 1,
    assignedBy: row.assigned_by || null,
    assigned_by: row.assigned_by || null,
    assignedAt: row.assigned_at || null,
    assigned_at: row.assigned_at || null,
    checklist: checklist.map((c) => {
      const itemLogs = timeLogs.filter((t) => t.checklist_item_id === c.id);
      return {
        id: c.id,
        text: c.text,
        category: c.category || null,
        completed: c.completed,
        assigneeId: c.assignee_id || null,
        assigneeName: c.assignee_name || null,
        dependsOn: Array.isArray(c.depends_on) ? c.depends_on[0] || null : c.depends_on || null,
        periodYear: c.period_year || null,
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
  return user.role === 'Admin';
};

const resolveAssigneeName = async (assigneeId, assigneeName) => {
  if (assigneeName && !isValidUUID(assigneeName)) {
    return assigneeName;
  }
  if (assigneeId && isValidUUID(assigneeId)) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('name')
      .eq('id', assigneeId)
      .maybeSingle();
    if (data?.name) return data.name;
  }
  return assigneeName || null;
};

const resolveTasksAssigneeNames = async (taskRows) => {
  const missingAssigneeIds = new Set();
  (taskRows || []).forEach((t) => {
    if (t.assignee_id && (!t.assignee_name || isValidUUID(t.assignee_name))) {
      missingAssigneeIds.add(t.assignee_id);
    }
  });

  if (missingAssigneeIds.size > 0) {
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .in('id', Array.from(missingAssigneeIds));
    const userNameMap = new Map((userRows || []).map((u) => [u.id, u.name]));
    (taskRows || []).forEach((t) => {
      if (t.assignee_id && (!t.assignee_name || isValidUUID(t.assignee_name))) {
        const resolved = userNameMap.get(t.assignee_id);
        if (resolved) {
          t.assignee_name = resolved;
        }
      }
    });
  }
  return taskRows;
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

  const taskRows = await resolveTasksAssigneeNames(data || []);

  taskRows.forEach((t) => {
    if (!tasks.has(t.work_request_id)) tasks.set(t.work_request_id, []);
    tasks.get(t.work_request_id).push(t);
  });
  return tasks;
};

const loadTaskExtras = async (taskIds) => {
  const checklist = new Map();
  const timeLogs = new Map();
  const taskDocuments = new Map();
  const assignees = new Map();
  const taskAssignees = new Map();
  if (!taskIds.length) return { checklist, timeLogs, taskDocuments, assignees, taskAssignees };
  const [{ data: clRows }, { data: tlRows }, { data: docRows }, { data: taRows }] =
    await Promise.all([
      supabaseAdmin.from('task_checklists').select('*').in('task_id', taskIds),
      supabaseAdmin.from('task_time_logs').select('*').in('task_id', taskIds),
      supabaseAdmin
        .from('documents')
        .select('*')
        .in('linked_task_id', taskIds)
        .is('deleted_at', null),
      supabaseAdmin.from('task_assignees').select('*').in('task_id', taskIds),
    ]);

  const checklistRows = clRows || [];
  const missingClAssigneeIds = new Set();
  checklistRows.forEach((c) => {
    if (c.assignee_id && (!c.assignee_name || isValidUUID(c.assignee_name))) {
      missingClAssigneeIds.add(c.assignee_id);
    }
  });
  if (missingClAssigneeIds.size > 0) {
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .in('id', Array.from(missingClAssigneeIds));
    const userNameMap = new Map((userRows || []).map((u) => [u.id, u.name]));
    checklistRows.forEach((c) => {
      if (c.assignee_id && (!c.assignee_name || isValidUUID(c.assignee_name))) {
        const resolved = userNameMap.get(c.assignee_id);
        if (resolved) {
          c.assignee_name = resolved;
        }
      }
    });
  }

  checklistRows.forEach((r) => {
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
  (taRows || []).forEach((r) => {
    if (!assignees.has(r.task_id)) assignees.set(r.task_id, []);
    assignees.get(r.task_id).push(r.user_id);
    if (!taskAssignees.has(r.task_id)) taskAssignees.set(r.task_id, []);
    taskAssignees.get(r.task_id).push({
      id: r.id,
      taskId: r.task_id,
      task_id: r.task_id,
      userId: r.user_id,
      user_id: r.user_id,
      assignedBy: r.assigned_by || null,
      assigned_by: r.assigned_by || null,
      assignedAt: r.assigned_at || null,
      assigned_at: r.assigned_at || null,
    });
  });
  return { checklist, timeLogs, taskDocuments, assignees, taskAssignees };
};

const canViewWorkRequest = (wr, user, taskMap) => {
  if (!user) return false;
  if (user.role === 'Admin') return true;
  if (
    wr.submitted_by === user.id ||
    wr.submittedBy === user.id ||
    wr.requested_by === user.id ||
    wr.requestedBy === user.id ||
    wr.assigned_to === user.id ||
    wr.assignedTo === user.id
  ) {
    return true;
  }
  const coAssignees = Array.isArray(wr.co_assignees) ? wr.co_assignees : (wr.coAssignees || []);
  if (coAssignees.some((ca) => ca === user.id || ca === user.name)) return true;
  const tasks = taskMap?.get ? (taskMap.get(wr.id) || []) : (wr.tasks || []);
  return tasks.some((t) => {
    if (t.assignee_id === user.id || t.assigneeId === user.id || t.assignee_name === user.name || t.assigneeName === user.name) return true;
    const taskCo = Array.isArray(t.co_assignees) ? t.co_assignees : (t.coAssignees || []);
    if (taskCo.some((ca) => ca === user.id || ca === user.name)) return true;
    if (Array.isArray(t.checklist) && t.checklist.some((item) => item.assignee_name === user.name || item.assigneeName === user.name || item.assignee_id === user.id || item.assigneeId === user.id)) return true;
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
    .select('*, clients(name)')
    .is('deleted_at', null)
    .order(sortField, { ascending: sortAsc });

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

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
  // For other users, filter by task-level assignment (where the user is assigned to at least one task).
  let visibleRows;
  let allTaskMap = null;
  if (isBackOffice(user)) {
    visibleRows = data || [];
  } else {
    const allWrIds = (data || []).map((r) => r.id);
    allTaskMap = await loadTasksForWorkRequests(allWrIds);
    visibleRows = (data || []).filter((row) => canViewWorkRequest(row, user, allTaskMap));
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
    ? allTaskMap || (await loadTasksForWorkRequests(resultRows.map((r) => r.id)))
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
          assignees: extras.assignees ? extras.assignees.get(t.id) || [] : [],
          taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(t.id) || [] : [],
        })
      );
      wr.phases = {
        pre_processing: {
          tasks: wr.tasks.filter((t) => t.phase === 'pre_processing'),
        },
        processing: {
          tasks: wr.tasks.filter((t) => t.phase === 'processing'),
        },
      };
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

// In-flight mutex map to guarantee idempotency against concurrent double-submits
const inFlightWorkRequests = new Map();

const validateProjectTeamRoles = async ({ assignedTo, coAssignees }) => {
  if (assignedTo) {
    const { data: assignedUser } = await supabaseAdmin
      .from('users')
      .select('id, name, role')
      .eq('id', assignedTo)
      .maybeSingle();
    if (assignedUser && (assignedUser.role || '').toLowerCase() !== 'manager') {
      throw new AppError({
        statusCode: 400,
        title: 'Invalid Manager',
        detail: `User "${assignedUser.name}" does not have the Manager role`,
      });
    }
  }

  if (coAssignees && Array.isArray(coAssignees) && coAssignees.length > 0) {
    const ids = coAssignees.filter(isValidUUID);
    const names = coAssignees.filter((v) => typeof v === 'string' && !isValidUUID(v));
    let matchedUsers = [];
    if (ids.length > 0) {
      const { data: usersById } = await supabaseAdmin
        .from('users')
        .select('id, name, role, user_departments(departments(name))')
        .in('id', ids);
      if (usersById) matchedUsers = matchedUsers.concat(usersById);
    }
    if (names.length > 0) {
      const { data: usersByName } = await supabaseAdmin
        .from('users')
        .select('id, name, role, user_departments(departments(name))')
        .in('name', names);
      if (usersByName) matchedUsers = matchedUsers.concat(usersByName);
    }
    const invalidMember = (matchedUsers || []).find((u) => {
      const r = (u.role || '').toLowerCase();
      let depts = [];
      if (Array.isArray(u.user_departments)) {
        depts = u.user_departments
          .map((ud) => String(ud.departments?.name || '').toLowerCase())
          .filter(Boolean);
      } else if (Array.isArray(u.departments)) {
        depts = u.departments.map((d) => String(d).toLowerCase());
      }
      const isOps = depts.includes('operations');
      if (isOps) return false;
      return r === 'admin' || r === 'manager';
    });
    if (invalidMember) {
      throw new AppError({
        statusCode: 400,
        title: 'Invalid Team Member',
        detail: `User "${invalidMember.name}" has the ${invalidMember.role} role and cannot be added as a team member`,
      });
    }
  }
};

const createWorkRequestGraph = async ({ entityId, data, user }) => {
  await validateProjectTeamRoles({ assignedTo: data.assignedTo, coAssignees: data.coAssignees });

  const rawPhases = data.phases || {};
  const validPhases = ['pre_processing', 'processing'];

  // Check if any tasks were passed in invalid phases (quality_assurance, completion, etc.)
  for (const phaseKey of Object.keys(rawPhases)) {
    if (!validPhases.includes(phaseKey)) {
      const phaseTasks = rawPhases[phaseKey]?.tasks;
      if (Array.isArray(phaseTasks) && phaseTasks.length > 0) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: `Tasks cannot be created in phase "${phaseKey}". Tasks may only be created in pre_processing or processing.`,
          code: 'INVALID_PHASE',
        });
      }
    }
  }

  // Check for duplicate explicit local_id across all phases
  const explicitLocalIds = new Set();
  for (const phaseName of validPhases) {
    const sectionTasks = rawPhases[phaseName]?.tasks || [];
    if (!Array.isArray(sectionTasks)) continue;
    for (const rawTask of sectionTasks) {
      const explicitId = rawTask.local_id || rawTask.localId;
      if (explicitId) {
        if (explicitLocalIds.has(explicitId)) {
          throw new AppError({
            statusCode: 400,
            title: 'Validation Error',
            detail: `Duplicate task local_id "${explicitId}". Task local_id must be unique across all tasks in the request.`,
            code: 'DUPLICATE_LOCAL_ID',
          });
        }
        explicitLocalIds.add(explicitId);
      }
    }
  }

  // 1. Delimiter Tokenization & Expansion
  let totalTokens = 0;
  const expandedTasks = [];
  const seenLocalIds = new Set();

  let autoIdCounter = 1;
  const getNextAutoLocalId = () => {
    while (explicitLocalIds.has(`t_${autoIdCounter}`) || seenLocalIds.has(`t_${autoIdCounter}`)) {
      autoIdCounter++;
    }
    const generated = `t_${autoIdCounter}`;
    autoIdCounter++;
    return generated;
  };

  const registerTask = (taskObj) => {
    if (seenLocalIds.has(taskObj.local_id)) {
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: `Duplicate task local_id "${taskObj.local_id}". Sibling task local_id collides with an existing task local_id.`,
        code: 'DUPLICATE_LOCAL_ID',
      });
    }
    seenLocalIds.add(taskObj.local_id);
    expandedTasks.push(taskObj);
  };

  for (const phaseName of validPhases) {
    const sectionTasks = rawPhases[phaseName]?.tasks || [];
    if (!Array.isArray(sectionTasks)) continue;

    for (const rawTask of sectionTasks) {
      const title = (rawTask.title || '').trim();
      if (!title) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: 'Task title is required and cannot be empty',
          code: 'VALIDATION_ERROR',
        });
      }

      const tokens = tokenizeTask(title, { max: 50, currentTotal: totalTokens });
      totalTokens += tokens.length;

      const baseLocalId = rawTask.local_id || rawTask.localId || getNextAutoLocalId();
      const dependsOn = rawTask.depends_on ?? rawTask.dependsOn ?? null;
      const rawAssignees = Array.isArray(rawTask.assignees) ? rawTask.assignees : [];
      const assignees = Array.from(new Set(rawAssignees));

      if (tokens.length >= 2) {
        // First task gets token 0, base local_id, and preserves raw string note
        const rawNote = `Original submission: "${tokens.raw || title}"`;
        const taskDescription = rawTask.description
          ? `${rawTask.description}\n\n[audit_note] ${rawNote}`
          : `[audit_note] ${rawNote}`;

        registerTask({
          local_id: baseLocalId,
          title: tokens[0],
          description: taskDescription,
          note: tokens.raw || title,
          phase: phaseName,
          assignees,
          depends_on: dependsOn,
          status: rawTask.status || (assignees.length > 0 ? 'Assigned' : 'Draft'),
          dueDate: rawTask.dueDate || null,
        });

        // Siblings
        for (let i = 1; i < tokens.length; i++) {
          registerTask({
            local_id: `${baseLocalId}_s${i}`,
            title: tokens[i],
            description: rawTask.description || null,
            note: null,
            phase: phaseName,
            assignees,
            depends_on: dependsOn,
            status: rawTask.status || (assignees.length > 0 ? 'Assigned' : 'Draft'),
            dueDate: rawTask.dueDate || null,
          });
        }
      } else {
        // Single token
        registerTask({
          local_id: baseLocalId,
          title: tokens[0],
          description: rawTask.description || null,
          note: tokens.raw || title,
          phase: phaseName,
          assignees,
          depends_on: dependsOn,
          status: rawTask.status || (assignees.length > 0 ? 'Assigned' : 'Draft'),
          dueDate: rawTask.dueDate || null,
        });
      }
    }
  }

  // 2. Dependency Validation
  const knownLocalIds = new Set(expandedTasks.map((t) => t.local_id));

  for (const task of expandedTasks) {
    let deps = task.depends_on;
    if (deps === null || deps === undefined) {
      continue;
    }

    if (!Array.isArray(deps)) {
      deps = [deps];
    }

    for (const dep of deps) {
      if (dep === null || dep === undefined || typeof dep !== 'string' || dep === '0' || dep.trim() === '') {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: `depends_on: Invalid dependency value "${dep}". Dependency "0", empty string, null, or non-string is not allowed.`,
          code: 'INVALID_DEPENDENCY',
        });
      }

      if (!knownLocalIds.has(dep)) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: `depends_on: Dependency "${dep}" does not match any valid same-WR task local_id.`,
          code: 'INVALID_DEPENDENCY',
        });
      }

      if (dep === task.local_id) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: `depends_on: Task "${task.local_id}" cannot depend on itself.`,
          code: 'INVALID_DEPENDENCY',
        });
      }
    }
  }

  // Cycle detection
  const adj = new Map();
  for (const t of expandedTasks) {
    adj.set(t.local_id, []);
  }
  for (const t of expandedTasks) {
    let deps = t.depends_on;
    if (deps && !Array.isArray(deps)) deps = [deps];
    if (Array.isArray(deps)) {
      for (const d of deps) {
        if (d && adj.has(d)) {
          adj.get(d).push(t.local_id);
        }
      }
    }
  }
  const visited = new Map();
  const hasCycle = (node) => {
    visited.set(node, 1);
    for (const neighbor of adj.get(node) || []) {
      if (visited.get(neighbor) === 1) return true;
      if (!visited.get(neighbor) && hasCycle(neighbor)) return true;
    }
    visited.set(node, 2);
    return false;
  };
  for (const t of expandedTasks) {
    if (!visited.get(t.local_id)) {
      if (hasCycle(t.local_id)) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: 'Circular dependency detected among tasks.',
          code: 'CIRCULAR_DEPENDENCY',
        });
      }
    }
  }

  // 3. Collect and resolve all assignees
  const allAssigneeIds = new Set();
  expandedTasks.forEach((t) => {
    t.assignees.forEach((a) => allAssigneeIds.add(a));
  });

  const usersMap = new Map();
  if (allAssigneeIds.size > 0) {
    const idList = Array.from(allAssigneeIds);
    const { data: usersById } = await supabaseAdmin
      .from('users')
      .select('id, name, role')
      .in('id', idList);
    (usersById || []).forEach((u) => usersMap.set(u.id, u));

    // Also try by name if not found by id
    const missing = idList.filter((id) => !usersMap.has(id));
    if (missing.length > 0) {
      const { data: usersByName } = await supabaseAdmin
        .from('users')
        .select('id, name, role')
        .in('name', missing);
      (usersByName || []).forEach((u) => {
        usersMap.set(u.id, u);
        usersMap.set(u.name, u);
      });
    }
  }

  // Co-assignees to mirror into work_requests.co_assignees
  const coAssigneeNamesSet = new Set(data.coAssignees || []);
  expandedTasks.forEach((t) => {
    t.assignees.forEach((a) => {
      const u = usersMap.get(a);
      coAssigneeNamesSet.add(u?.name || a);
    });
  });

  // 4. Atomic Execution with Rollback
  const cleanupStack = [];
  const wrId = data.id && isValidUUID(data.id) ? data.id : randomUUID();
  const now = new Date().toISOString();

  const wrRecord = {
    id: wrId,
    entity_id: entityId,
    client_id: data.clientId || null,
    title: data.title,
    description: data.description || null,
    status: data.status || 'Draft',
    phase: data.phase || 'pre_processing',
    phase_entered_at: now,
    on_hold: false,
    priority: data.priority || 'Normal',
    requested_by: data.requestedBy || user?.id || null,
    assigned_to: data.assignedTo || null,
    co_assignees: Array.from(coAssigneeNamesSet),
    due_date: data.dueDate || null,
    created_at: now,
    updated_at: now,
  };

  try {
    // Insert work request
    const { error: wrError } = await supabaseAdmin.from('work_requests').insert(wrRecord);
    if (wrError) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to insert work request: ${wrError.message || wrError}`,
      });
    }
    cleanupStack.push(async () => {
      await supabaseAdmin.from('work_requests').delete().eq('id', wrId);
    });

    // Map local_ids to task UUIDs
    const localIdToUuid = new Map();
    const taskRecords = [];
    const taskAssigneeRecords = [];

    expandedTasks.forEach((t, idx) => {
      const taskId = randomUUID();
      localIdToUuid.set(t.local_id, taskId);
      t.id = taskId;
      t.display_order = idx;
    });

    expandedTasks.forEach((t) => {
      // Resolve predecessors
      let deps = t.depends_on;
      if (deps && !Array.isArray(deps)) deps = [deps];
      const predecessorUuids = (deps || [])
        .map((d) => localIdToUuid.get(d))
        .filter(Boolean);

      // Resolve primary assignee
      const primaryAssigneeId = t.assignees[0] || null;
      const primaryUser = primaryAssigneeId ? usersMap.get(primaryAssigneeId) : null;
      const assigneeName = primaryUser?.name || primaryAssigneeId || null;
      const assigneeId = primaryUser?.id || primaryAssigneeId || null;

      taskRecords.push({
        id: t.id,
        work_request_id: wrId,
        title: t.title,
        description: t.description,
        status: t.status,
        phase: t.phase,
        qa_status: 'none',
        assignee_id: assigneeId,
        assignee_name: assigneeName,
        predecessors: predecessorUuids,
        due_date: t.dueDate,
        display_order: t.display_order,
        assigned_by: user?.id || null,
        assigned_at: now,
        created_at: now,
        updated_at: now,
      });

      // Prepare task_assignees rows
      const seenTaskUserIds = new Set();
      (t.assignees || []).forEach((a) => {
        const u = usersMap.get(a);
        const uid = u?.id || a;
        if (uid && !seenTaskUserIds.has(uid)) {
          seenTaskUserIds.add(uid);
          taskAssigneeRecords.push({
            id: randomUUID(),
            task_id: t.id,
            user_id: uid,
            assigned_by: user?.id || null,
            assigned_at: now,
            created_at: now,
          });
        }
      });
    });

    if (taskRecords.length > 0) {
      const { error: tasksError } = await supabaseAdmin.from('tasks').insert(taskRecords);
      if (tasksError) {
        throw new AppError({
          statusCode: 500,
          title: 'Database Error',
          detail: `Failed to insert tasks: ${tasksError.message || tasksError}`,
        });
      }
      cleanupStack.push(async () => {
        await supabaseAdmin.from('tasks').delete().in('id', taskRecords.map((t) => t.id));
      });
    }

    if (taskAssigneeRecords.length > 0) {
      const { error: taError } = await supabaseAdmin.from('task_assignees').insert(taskAssigneeRecords);
      if (taError) {
        throw new AppError({
          statusCode: 500,
          title: 'Database Error',
          detail: `Failed to insert task assignees: ${taError.message || taError}`,
        });
      }
      cleanupStack.push(async () => {
        await supabaseAdmin.from('task_assignees').delete().in('task_id', taskRecords.map((t) => t.id));
      });
    }

    // Build return graph
    const entityCode = await resolveEntityCode(entityId);
    const taskAssigneesMap = new Map();
    taskAssigneeRecords.forEach((ta) => {
      if (!taskAssigneesMap.has(ta.task_id)) taskAssigneesMap.set(ta.task_id, []);
      taskAssigneesMap.get(ta.task_id).push(ta.user_id);
    });

    const apiTasks = taskRecords.map((tr) => {
      const matchedExpanded = expandedTasks.find((et) => et.id === tr.id);
      return {
        id: tr.id,
        localId: matchedExpanded?.local_id || null,
        local_id: matchedExpanded?.local_id || null,
        workRequestId: wrId,
        title: tr.title,
        description: tr.description,
        note: matchedExpanded?.note || null,
        status: tr.status,
        phase: tr.phase,
        qaStatus: tr.qa_status || 'none',
        qa_status: tr.qa_status || 'none',
        phaseEnteredAt: tr.phase_entered_at || null,
        phase_entered_at: tr.phase_entered_at || null,
        assigneeId: tr.assignee_id,
        assigneeName: tr.assignee_name,
        assignees: taskAssigneesMap.get(tr.id) || (tr.assignee_id ? [tr.assignee_id] : []),
        taskAssignees: (taskAssigneeRecords || [])
          .filter((ta) => ta.task_id === tr.id)
          .map((ta) => ({
            id: ta.id,
            taskId: ta.task_id,
            task_id: ta.task_id,
            userId: ta.user_id,
            user_id: ta.user_id,
            assignedBy: ta.assigned_by || null,
            assigned_by: ta.assigned_by || null,
            assignedAt: ta.assigned_at || null,
            assigned_at: ta.assigned_at || null,
          })),
        task_assignees: (taskAssigneeRecords || [])
          .filter((ta) => ta.task_id === tr.id)
          .map((ta) => ({
            id: ta.id,
            taskId: ta.task_id,
            task_id: ta.task_id,
            userId: ta.user_id,
            user_id: ta.user_id,
            assignedBy: ta.assigned_by || null,
            assigned_by: ta.assigned_by || null,
            assignedAt: ta.assigned_at || null,
            assigned_at: ta.assigned_at || null,
          })),
        dependsOn: matchedExpanded?.depends_on || null,
        depends_on: matchedExpanded?.depends_on || null,
        predecessors: tr.predecessors,
        dueDate: tr.due_date,
        displayOrder: tr.display_order,
        assignedBy: tr.assigned_by,
        assigned_by: tr.assigned_by,
        assignedAt: tr.assigned_at,
        assigned_at: tr.assigned_at,
        version: tr.version || 1,
      };
    });

    const preProcessingTasks = apiTasks.filter((t) => t.phase === 'pre_processing');
    const processingTasks = apiTasks.filter((t) => t.phase === 'processing');

    const fullGraph = {
      id: wrId,
      entity: entityCode,
      title: wrRecord.title,
      description: wrRecord.description,
      clientId: wrRecord.client_id,
      status: wrRecord.status,
      phase: wrRecord.phase,
      onHold: wrRecord.on_hold,
      on_hold: wrRecord.on_hold,
      phaseEnteredAt: wrRecord.phase_entered_at,
      phase_entered_at: wrRecord.phase_entered_at,
      priority: wrRecord.priority,
      archived: false,
      requestedBy: wrRecord.requested_by,
      assignedTo: wrRecord.assigned_to,
      coAssignees: wrRecord.co_assignees,
      dueDate: wrRecord.due_date,
      createdAt: wrRecord.created_at,
      updatedAt: wrRecord.updated_at,
      version: 1,
      phases: {
        pre_processing: {
          tasks: preProcessingTasks,
        },
        processing: {
          tasks: processingTasks,
        },
      },
      tasks: apiTasks,
    };

    const userIsManager = isManager(user);
    const needsApproval = userIsManager || Boolean(data.requiresApproval);

    if (needsApproval) {
      try {
        const opReqRecord = {
          entity_id: entityId,
          type: 'wr_phase_transition',
          work_request_id: wrId,
          client_id: wrRecord.client_id || null,
          requested_by: user?.id || wrRecord.requested_by,
          status: 'pending',
          notes: JSON.stringify({
            from_phase: 'pre_processing',
            to_phase: 'processing',
            work_request_id: wrId,
            user_notes: data.notes || 'Manager work request creation awaiting phase advancement approval',
          }),
          created_at: now,
          updated_at: now,
        };

        const { data: opReq, error: opReqError } = await supabaseAdmin
          .from('operations_requests')
          .insert(opReqRecord)
          .select()
          .single();

        if (!opReqError && opReq) {
          await auditService.log({
            action: 'operations_request.create',
            table: 'operations_requests',
            recordId: opReq.id,
            entity: entityId,
            userId: user?.id || wrRecord.requested_by,
            details: { type: 'wr_phase_transition', status: 'pending', workRequestId: wrId },
          });

          // Emit notification to Admins
          const { data: admins } = await supabaseAdmin
            .from('users')
            .select('id')
            .eq('role', 'Admin')
            .eq('is_active', true);

          const adminUserIds = (admins || []).map((a) => a.id);
          if (adminUserIds.length > 0) {
            await notify(adminUserIds, 'wr.transition_request.received', {
              request_id: opReq.id,
              work_request_id: wrId,
              from_phase: 'pre_processing',
              to_phase: 'processing',
              requested_by: user?.id || wrRecord.requested_by,
              wr_title: wrRecord.title,
            });
          }
        }
      } catch (opReqErr) {
        logger.warn('Failed to create pending operations_request for manager WR', {
          error: opReqErr.message,
          workRequestId: wrId,
        });
      }
    }

    return fullGraph;
  } catch (err) {
    // Rollback all created records on any failure
    for (const rollback of cleanupStack.reverse()) {
      try {
        await rollback();
      } catch (cleanupErr) {
        // Rollback failure logged but not rethrown over primary error
      }
    }
    throw err;
  }
};

const createWorkRequest = async ({ entityId, data, user }) => {
  const reqBy = data.requestedBy || user?.id;
  const titleClean = (data.title || '').trim();
  const dedupeKey = `${entityId}:${reqBy || ''}:${data.clientId || ''}:${titleClean}`;

  if (inFlightWorkRequests.has(dedupeKey)) {
    return inFlightWorkRequests.get(dedupeKey);
  }

  const creationPromise = (async () => {
    try {
      if (data.phases && typeof data.phases === 'object') {
        return await createWorkRequestGraph({ entityId, data, user });
      }

      await validateProjectTeamRoles({ assignedTo: data.assignedTo, coAssignees: data.coAssignees });

      // Deduplication guard against rapid double-clicks (within 5 seconds)
      const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
      let dupQuery = supabaseAdmin
        .from('work_requests')
        .select('id')
        .eq('entity_id', entityId)
        .eq('client_id', data.clientId)
        .eq('title', data.title)
        .is('deleted_at', null)
        .gte('created_at', fiveSecondsAgo);

      if (reqBy) {
        dupQuery = dupQuery.eq('requested_by', reqBy);
      }

      const { data: existingDups } = await dupQuery.limit(1);
      if (existingDups && existingDups.length > 0) {
        return getWorkRequestById({ id: existingDups[0].id, entityId, user, includeTasks: true });
      }

      const id = data.id && isValidUUID(data.id) ? data.id : randomUUID();
      const now = new Date().toISOString();
      const record = {
        id,
        entity_id: entityId,
        client_id: data.clientId || null,
        title: data.title,
        description: data.description || null,
        status: data.status || 'Draft',
        phase: data.phase || 'pre_processing',
        phase_entered_at: now,
        on_hold: false,
        priority: data.priority || 'Normal',
        requested_by: data.requestedBy || user?.id || null,
        assigned_to: data.assignedTo || null,
        co_assignees: data.coAssignees || [],
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

      const userIsManager = isManager(user);
      const needsApproval = userIsManager || Boolean(data.requiresApproval);

      if (needsApproval) {
        try {
          const opReqRecord = {
            entity_id: entityId,
            type: 'wr_phase_transition',
            work_request_id: id,
            client_id: record.client_id || null,
            requested_by: user?.id || record.requested_by,
            status: 'pending',
            notes: JSON.stringify({
              from_phase: 'pre_processing',
              to_phase: 'processing',
              work_request_id: id,
              user_notes: data.notes || 'Manager work request creation awaiting phase advancement approval',
            }),
            created_at: now,
            updated_at: now,
          };

          const { data: opReq, error: opReqError } = await supabaseAdmin
            .from('operations_requests')
            .insert(opReqRecord)
            .select()
            .single();

          if (!opReqError && opReq) {
            await auditService.log({
              action: 'operations_request.create',
              table: 'operations_requests',
              recordId: opReq.id,
              entity: entityId,
              userId: user?.id || record.requested_by,
              details: { type: 'wr_phase_transition', status: 'pending', workRequestId: id },
            });

            // Emit notification to Admins
            const { data: admins } = await supabaseAdmin
              .from('users')
              .select('id')
              .eq('role', 'Admin')
              .eq('is_active', true);

            const adminUserIds = (admins || []).map((a) => a.id);
            if (adminUserIds.length > 0) {
              await notify(adminUserIds, 'wr.transition_request.received', {
                request_id: opReq.id,
                work_request_id: id,
                from_phase: 'pre_processing',
                to_phase: 'processing',
                requested_by: user?.id || record.requested_by,
                wr_title: record.title,
              });
            }
          }
        } catch (opReqErr) {
          logger.warn('Failed to create pending operations_request for manager WR', {
            error: opReqErr.message,
            workRequestId: id,
          });
        }
      }

      return getWorkRequestById({ id, entityId, user, includeTasks: true });
    } finally {
      inFlightWorkRequests.delete(dedupeKey);
    }
  })();

  inFlightWorkRequests.set(dedupeKey, creationPromise);
  return creationPromise;
};

const getWorkRequestById = async ({ id, entityId, user, includeTasks = false }) => {
  let query = supabaseAdmin
    .from('work_requests')
    .select('*, clients(name)')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const res = await query.maybeSingle();
  let data = res.data;
  const error = res.error;

  // Fallback: If not found under entityId (e.g. cross-entity lookup from consolidated view or link),
  // lookup by ID alone and verify user has access to that work request's entity
  if (!data && entityId && entityId !== 'ALL') {
    const fallbackRes = await supabaseAdmin
      .from('work_requests')
      .select('*, clients(name)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (fallbackRes.data) {
      data = fallbackRes.data;
    }
  }

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

  const entityCode = await resolveEntityCode(data.entity_id || entityId);
  const wr = toApiWorkRequest(data, entityCode);

  if (includeTasks) {
    const taskRows = taskMap.get(id) || [];
    const extras = await loadTaskExtras(taskRows.map((t) => t.id));
    wr.tasks = taskRows.map((t) =>
      toApiTask(t, {
        checklist: extras.checklist.get(t.id) || [],
        timeLogs: extras.timeLogs.get(t.id) || [],
        taskDocuments: extras.taskDocuments.get(t.id) || [],
        assignees: extras.assignees ? extras.assignees.get(t.id) || [] : [],
        taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(t.id) || [] : [],
      })
    );
    wr.phases = {
      pre_processing: {
        tasks: wr.tasks.filter((t) => t.phase === 'pre_processing'),
      },
      processing: {
        tasks: wr.tasks.filter((t) => t.phase === 'processing'),
      },
    };
  }

  return wr;
};

const updateWorkRequest = async ({ id, entityId, data, user }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  if (existing.status === 'Completed') {
    const isReopen = data.status === 'Draft' || data.status === 'Processing';
    if (!isReopen) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Completed Work Requests are locked and cannot be modified',
      });
    }
    const mutableFields = ['title', 'description', 'clientId', 'priority', 'dueDate', 'assignedTo', 'coAssignees', 'archived'];
    const modifiedFields = mutableFields.filter((f) => data[f] !== undefined);
    if (modifiedFields.length > 0) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: `Cannot modify work request fields (${modifiedFields.join(', ')}) while reopening a Completed request. Reopen status must be submitted independently.`,
        code: 'COMPLETED_WR_MODIFICATION_DISALLOWED',
      });
    }
  }

  if (data.status && data.status !== existing.status) {
    const isAdmin = Boolean(
      user &&
        (user.role === 'Admin' ||
          user.role?.toLowerCase() === 'admin' ||
          user.email?.toLowerCase() === 'lorein@ata-lta.ph')
    );
    if (!isAdmin) {
      const allowed = VALID_TRANSITIONS[existing.status] || [];
      if (!allowed.includes(data.status)) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: `Invalid status transition from ${existing.status} to ${data.status}`,
        });
      }
    }
  }

  const updates = {
    title: data.title ?? existing.title,
    description: data.description ?? existing.description,
    client_id: data.clientId ?? existing.clientId,
    status: data.status ?? existing.status,
    priority: data.priority ?? existing.priority,
    due_date: data.dueDate ?? existing.dueDate,
    updated_at: new Date().toISOString(),
  };

  if (data.archived !== undefined) updates.archived = data.archived;
  if (data.assignedTo !== undefined) updates.assigned_to = data.assignedTo;
  if (data.coAssignees !== undefined) {
    const rawCo = Array.isArray(data.coAssignees) ? data.coAssignees : [];
    updates.co_assignees = rawCo.filter(isValidUUID);
  }

  if (data.assignedTo !== undefined || data.coAssignees !== undefined) {
    await validateProjectTeamRoles({
      assignedTo: data.assignedTo !== undefined ? data.assignedTo : existing.assignedTo,
      coAssignees: data.coAssignees !== undefined ? data.coAssignees : existing.coAssignees,
    });
  }

  // OCC (Spec 2.2 / R-10): version-guard the update when the client declares
  // the version it read; zero matching rows means a concurrent edit landed
  // first and is reported as 409 instead of being silently overwritten.
  const expectedVersion = resolveExpectedVersion(data);
  if (expectedVersion !== null) {
    updates.version = (existing.version || 1) + 1;
  }

  let query = supabaseAdmin
    .from('work_requests')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null);

  if (existing.status !== 'Completed') {
    // Prevent overwriting a completed request if completed concurrently
    query = query.neq('status', 'Completed');
  } else {
    // If reopening, ensure request is still Completed
    query = query.eq('status', 'Completed');
  }

  if (expectedVersion !== null) {
    query = query.eq('version', expectedVersion);
  }
  const { data: updatedRows, error } = await query.select();
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update work request',
    });
  }

  if (!updatedRows || updatedRows.length === 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Work request was modified or completed concurrently. Please reload.',
      code: 'CONCURRENT_MODIFICATION',
    });
  }

  const updatedRow = updatedRows[0];
  return getWorkRequestById({ id, entityId: updatedRow.entity_id, user });
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
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to archive work request',
    });
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
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to restore work request',
    });
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

  const taskRows = await resolveTasksAssigneeNames(data || []);
  const taskIds = taskRows.map((t) => t.id);
  const extras = await loadTaskExtras(taskIds);
  return taskRows.map((t) =>
    toApiTask(t, {
      checklist: extras.checklist.get(t.id) || [],
      timeLogs: extras.timeLogs.get(t.id) || [],
      taskDocuments: extras.taskDocuments.get(t.id) || [],
      assignees: extras.assignees ? extras.assignees.get(t.id) || [] : [],
      taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(t.id) || [] : [],
    })
  );
};

const getTaskById = async ({ workRequestId, taskId, entityId: _entityId }) => {
  let query = supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .is('deleted_at', null);

  if (workRequestId) {
    query = query.eq('work_request_id', workRequestId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve task',
    });
  }
  if (!data) return null;

  if (data.assignee_id && (!data.assignee_name || isValidUUID(data.assignee_name))) {
    const resolved = await resolveAssigneeName(data.assignee_id, data.assignee_name);
    if (resolved) data.assignee_name = resolved;
  }

  const extras = await loadTaskExtras([taskId]);
  return toApiTask(data, {
    checklist: extras.checklist.get(taskId) || [],
    timeLogs: extras.timeLogs.get(taskId) || [],
    taskDocuments: extras.taskDocuments.get(taskId) || [],
    assignees: extras.assignees ? extras.assignees.get(taskId) || [] : [],
    taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(taskId) || [] : [],
  });
};

const createTask = async ({ workRequestId, entityId, data, user: _user }) => {
  let phase = data.phase || null;
  if (phase && !['pre_processing', 'processing'].includes(phase)) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: `Tasks cannot be created in phase "${phase}". Tasks may only be created in pre_processing or processing.`,
      code: 'INVALID_PHASE',
    });
  }

  if (!phase) {
    const { data: wr } = await supabaseAdmin
      .from('work_requests')
      .select('phase')
      .eq('id', workRequestId)
      .maybeSingle();
    phase = wr?.phase === 'processing' ? 'processing' : 'pre_processing';
  }

  // Prerequisite Gates: processing task cannot be created directly in active state if pre_processing tasks incomplete
  if (
    phase === 'processing' &&
    data.status &&
    !['Draft', 'Assigned', 'Cancelled'].includes(data.status)
  ) {
    const { data: preTasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, status')
      .eq('work_request_id', workRequestId)
      .eq('phase', 'pre_processing')
      .is('deleted_at', null);
    const activePre = (preTasks || []).filter((t) => t.status !== 'Cancelled');
    const incomplete = activePre.filter((t) => t.status !== 'Completed');
    if (incomplete.length > 0) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Cannot create active processing task: ${incomplete.length} active pre-processing task(s) are incomplete`,
        code: 'PHASE_PREREQUISITE',
      });
    }
  }

  const id = data.id && isValidUUID(data.id) ? data.id : randomUUID();
  const now = new Date().toISOString();
  let assigneeName = data.assigneeName || null;
  const primaryAssigneeId =
    data.assigneeId ||
    (Array.isArray(data.assignees) && data.assignees[0]) ||
    null;
  if ((!assigneeName || isValidUUID(assigneeName)) && primaryAssigneeId) {
    assigneeName = await resolveAssigneeName(primaryAssigneeId, assigneeName);
  }
  const record = {
    id,
    work_request_id: workRequestId,
    title: data.title,
    description: data.description || null,
    status: data.status || 'Draft',
    phase,
    qa_status: 'none',
    assignee_id: primaryAssigneeId,
    assignee_name: assigneeName,
    predecessors: Array.isArray(data.predecessors) ? data.predecessors.filter(isValidUUID) : [],
    due_date: data.dueDate || null,
    required_link_type: data.requiredLinkType || null,
    display_order: data.displayOrder ?? 0,
    assigned_by: _user?.id || null,
    assigned_at: primaryAssigneeId ? now : null,
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

  // Dual-write assignees to task_assignees join table
  const allAssigneeIds = Array.from(
    new Set(
      [
        ...(Array.isArray(data.assignees) ? data.assignees : []),
        ...(data.assigneeId ? [data.assigneeId] : []),
        ...(Array.isArray(data.coAssignees) ? data.coAssignees : []),
      ].filter(isValidUUID)
    )
  );

  if (allAssigneeIds.length > 0) {
    const taInserts = allAssigneeIds.map((userId) => ({
      id: randomUUID(),
      task_id: id,
      user_id: userId,
      assigned_by: _user?.id || null,
      assigned_at: now,
      created_at: now,
    }));
    await supabaseAdmin.from('task_assignees').insert(taInserts);
  }

  if (data.checklist?.length) {
    await upsertChecklist(id, data.checklist);
    const checklistTimeLogs = [];
    data.checklist.forEach((item) => {
      if (Array.isArray(item.timeLogs)) {
        item.timeLogs.forEach((log) => {
          checklistTimeLogs.push({
            ...log,
            checklistItemId: item.id,
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

  const missingUserIds = new Set();
  checklist.forEach((item) => {
    if (item.assigneeId && (!item.assigneeName || isValidUUID(item.assigneeName))) {
      missingUserIds.add(item.assigneeId);
    }
  });

  let userNameMap = new Map();
  if (missingUserIds.size > 0) {
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .in('id', Array.from(missingUserIds));
    userNameMap = new Map((userRows || []).map((u) => [u.id, u.name]));
  }

  const rows = checklist.map((item) => {
    let dependsOn = Array.isArray(item.dependsOn)
      ? item.dependsOn
      : item.dependsOn
        ? [item.dependsOn]
        : [];

    // Resolve dependencies using the map and ensure only valid UUIDs are persisted
    dependsOn = dependsOn.map((id) => chkIdMap.get(id) || id).filter(isValidUUID);

    const itemId = item.id ? chkIdMap.get(item.id) || item.id : randomUUID();
    let clAssigneeName = item.assigneeName || null;
    if ((!clAssigneeName || isValidUUID(clAssigneeName)) && item.assigneeId) {
      clAssigneeName = userNameMap.get(item.assigneeId) || clAssigneeName;
    }

    return {
      id: isValidUUID(itemId) ? itemId : randomUUID(),
      task_id: taskId,
      text: item.text,
      category: item.category || null,
      completed: item.completed ?? false,
      assignee_id: item.assigneeId || null,
      assignee_name: clAssigneeName,
      depends_on: dependsOn,
      period_year: item.periodYear || null,
    };
  });
  if (rows.length) await supabaseAdmin.from('task_checklists').insert(rows);
};

const upsertTimeLogs = async (taskId, timeLogs, deleteExisting = true) => {
  if (deleteExisting) {
    await supabaseAdmin
      .from('task_time_logs')
      .delete()
      .eq('task_id', taskId)
      .is('checklist_item_id', null);
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

/**
 * Verify whether a user is an assignee of a specific task.
 * Checks relational join table task_assignees first, with fallback to legacy tasks.assignee_id.
 *
 * @param {string} taskId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
const isUserAssignedToTask = async (taskId, userId) => {
  if (!taskId || !userId) return false;

  // 1. Check task_assignees join table (multi-assignee standard)
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

  // 2. Fallback: check tasks table for legacy assignee_id
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

const updateTask = async ({ workRequestId, taskId, entityId, data, user: _user }) => {
  if (data && data.phase !== undefined) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'Task phase is immutable once created',
      code: 'TASK_PHASE_IMMUTABLE',
    });
  }

  const existing = await getTaskById({ workRequestId, taskId, entityId });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found' });
  }

  const effectiveWrId = workRequestId || existing.workRequestId || existing.work_request_id;
  const isProcessingTask = existing.phase === 'processing';
  const targetStatus = data.status;

  // Prerequisite Gates (Rule R5 & Spec §3.2):
  // A processing task cannot transition out of Draft or Assigned
  // (e.g. to In Progress, For Review, Completed) while ANY active (non-Cancelled)
  // pre_processing task of the same WR is not Completed.
  if (
    isProcessingTask &&
    targetStatus !== undefined &&
    targetStatus !== existing.status &&
    ['Draft', 'Assigned'].includes(existing.status) &&
    !['Draft', 'Assigned', 'Cancelled'].includes(targetStatus)
  ) {
    if (effectiveWrId) {
      const { data: preTasks, error: preError } = await supabaseAdmin
        .from('tasks')
        .select('id, title, status, phase')
        .eq('work_request_id', effectiveWrId)
        .eq('phase', 'pre_processing')
        .is('deleted_at', null);

      if (preError) {
        throw new AppError({
          statusCode: 500,
          title: 'Database Error',
          detail: 'Unable to verify prerequisite tasks',
        });
      }

      const activePreTasks = (preTasks || []).filter((t) => t.status !== 'Cancelled');
      const incompletePreTasks = activePreTasks.filter((t) => t.status !== 'Completed');

      if (incompletePreTasks.length > 0) {
        const incompleteList = incompletePreTasks
          .map((t) => `"${t.title || t.id}" (${t.status})`)
          .join(', ');
        throw new AppError({
          statusCode: 409,
          title: 'Conflict',
          detail: `Cannot advance processing task: ${incompletePreTasks.length} active pre-processing task(s) are incomplete: ${incompleteList}`,
          code: 'PHASE_PREREQUISITE',
        });
      }
    }
  }

  // Task-level Predecessor Check (Issue 19b, B2.3, B2.4):
  // Cannot complete a task if any of its declared predecessors are not Completed
  const candidatePreds =
    data.predecessors !== undefined
      ? Array.isArray(data.predecessors)
        ? data.predecessors
        : []
      : Array.isArray(existing.predecessors)
        ? existing.predecessors
        : [];
  const validPredIds = candidatePreds.filter(isValidUUID);

  if (targetStatus === 'Completed' && validPredIds.length > 0) {
    let predQuery = supabaseAdmin
      .from('tasks')
      .select('id, title, status')
      .in('id', validPredIds)
      .is('deleted_at', null);

    if (effectiveWrId) {
      predQuery = predQuery.eq('work_request_id', effectiveWrId);
    }

    const { data: predTasks, error: predError } = await predQuery;
    if (predError) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to verify prerequisite tasks: ${predError.message || predError}`,
      });
    }

    const foundIds = new Set((predTasks || []).map((p) => p.id));
    const missingPredIds = validPredIds.filter((pId) => !foundIds.has(pId));
    if (missingPredIds.length > 0) {
      throw new AppError({
        statusCode: 400,
        title: 'Invalid Dependencies',
        detail: `Prerequisite task(s) do not exist or belong to another work request: ${missingPredIds.join(', ')}`,
        code: 'TASK_PREDECESSORS_NOT_FOUND',
      });
    }

    const incompletePreds = (predTasks || []).filter((p) => p.status !== 'Completed');
    if (incompletePreds.length > 0) {
      const predNames = incompletePreds.map((p) => `"${p.title || p.id}" (${p.status})`).join(', ');
      throw new AppError({
        statusCode: 400,
        title: 'Unfulfilled Dependencies',
        detail: `Cannot complete task: upstream prerequisite task(s) are incomplete: ${predNames}`,
        code: 'TASK_PREDECESSORS_INCOMPLETE',
      });
    }
  }

  let assigneeName = data.assigneeName !== undefined ? data.assigneeName : existing.assigneeName;
  const assigneeId = data.assigneeId !== undefined ? data.assigneeId : existing.assigneeId;
  if (assigneeId === null) {
    assigneeName = null;
  } else if ((!assigneeName || isValidUUID(assigneeName)) && assigneeId) {
    assigneeName = await resolveAssigneeName(assigneeId, assigneeName);
  }

  const updates = {
    title: data.title ?? existing.title,
    description: data.description ?? existing.description,
    status: data.status ?? existing.status,
    assignee_id: assigneeId,
    assignee_name: assigneeName,
    predecessors:
      data.predecessors !== undefined
        ? Array.isArray(data.predecessors)
          ? data.predecessors.filter(isValidUUID)
          : []
        : existing.predecessors,
    due_date: data.dueDate ?? existing.dueDate,
    display_order: data.displayOrder ?? existing.displayOrder,
    updated_at: new Date().toISOString(),
  };

  if (data.requiredLinkType !== undefined) {
    updates.required_link_type = data.requiredLinkType || null;
  }

  // OCC (Spec 2.2 / R-10): version-guard the update when the client declares
  // the version it read; zero matching rows become a 409 conflict.
  const expectedVersion = resolveExpectedVersion(data);
  if (expectedVersion !== null) {
    updates.version = (existing.version || 1) + 1;
  }

  // B2.5: Immediately prior to writing task completion, re-verify prerequisite tasks remain in Completed status
  if (targetStatus === 'Completed' && validPredIds.length > 0) {
    let recheckQuery = supabaseAdmin
      .from('tasks')
      .select('id, status')
      .in('id', validPredIds)
      .is('deleted_at', null);
    if (effectiveWrId) {
      recheckQuery = recheckQuery.eq('work_request_id', effectiveWrId);
    }
    const { data: recheckTasks, error: recheckError } = await recheckQuery;
    if (recheckError) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to verify prerequisite tasks: ${recheckError.message || recheckError}`,
      });
    }
    if (!recheckTasks || recheckTasks.length !== validPredIds.length || recheckTasks.some((t) => t.status !== 'Completed')) {
      throw new AppError({
        statusCode: 400,
        title: 'Unfulfilled Dependencies',
        detail: 'Cannot complete task: upstream prerequisite task(s) are incomplete',
        code: 'TASK_PREDECESSORS_INCOMPLETE',
      });
    }
  }

  let query = supabaseAdmin
    .from('tasks')
    .update(updates)
    .eq('id', taskId);
  if (effectiveWrId) {
    query = query.eq('work_request_id', effectiveWrId);
  }
  if (existing.status !== 'Completed' && targetStatus === 'Completed') {
    query = query.neq('status', 'Completed');
  }
  if (expectedVersion !== null) {
    query = query.eq('version', expectedVersion);
  }
  const { data: updatedRows, error } = await query.select();
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update task',
    });
  }

  if (!updatedRows || updatedRows.length === 0) {
    if (expectedVersion !== null) {
      throw concurrencyConflict();
    }
    if (existing.status !== 'Completed' && targetStatus === 'Completed') {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'Task was modified or completed concurrently. Please reload.',
        code: 'CONCURRENT_MODIFICATION',
      });
    }
  }

  // Dual-write assignees to task_assignees join table if assignees provided
  if (Array.isArray(data.assignees)) {
    await supabaseAdmin.from('task_assignees').delete().eq('task_id', taskId);
    const uniqueAssignees = Array.from(new Set(data.assignees.filter(isValidUUID)));
    if (uniqueAssignees.length > 0) {
      const now = new Date().toISOString();
      const taInserts = uniqueAssignees.map((uId) => ({
        id: randomUUID(),
        task_id: taskId,
        user_id: uId,
        assigned_by: _user?.id || null,
        assigned_at: now,
        created_at: now,
      }));
      await supabaseAdmin.from('task_assignees').insert(taInserts);
    }
  } else if (assigneeId === null && (existing.assigneeId || existing.assignee_id)) {
    const { error: delError } = await supabaseAdmin
      .from('task_assignees')
      .delete()
      .eq('task_id', taskId)
      .eq('user_id', existing.assigneeId || existing.assignee_id);
    if (delError) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to clear assignee from task_assignees: ${delError.message || delError}`,
      });
    }
  }

  if (data.checklist !== undefined) {
    await upsertChecklist(taskId, data.checklist);
    // Only delete and re-insert checklist time logs when at least one
    // checklist item explicitly provides a timeLogs array.  This prevents
    // accidental data loss when the frontend sends a checklist update that
    // is purely metadata (assignee, text, periodYear, etc.).
    const hasExplicitTimeLogs = data.checklist.some(
      (item) => Array.isArray(item.timeLogs) && item.timeLogs.length > 0
    );
    if (hasExplicitTimeLogs) {
      const checklistTimeLogs = [];
      data.checklist.forEach((item) => {
        if (Array.isArray(item.timeLogs)) {
          item.timeLogs.forEach((log) => {
            checklistTimeLogs.push({
              ...log,
              checklistItemId: item.id,
            });
          });
        }
      });
      await supabaseAdmin
        .from('task_time_logs')
        .delete()
        .eq('task_id', taskId)
        .not('checklist_item_id', 'is', null);
      if (checklistTimeLogs.length) {
        await upsertTimeLogs(taskId, checklistTimeLogs, false);
      }
    }
  }
  if (data.timeLogs !== undefined) {
    await upsertTimeLogs(taskId, data.timeLogs, true);
  }

  return getTaskById({ workRequestId: effectiveWrId, taskId, entityId });
};

const deleteTask = async ({ workRequestId, taskId, entityId }) => {
  const existing = await getTaskById({ workRequestId, taskId, entityId });
  if (!existing) return false;

  const effectiveWrId = workRequestId || existing.workRequestId || existing.work_request_id;
  let query = supabaseAdmin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', taskId);
  if (effectiveWrId) {
    query = query.eq('work_request_id', effectiveWrId);
  }

  const { error } = await query;
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
const getWorkRequestRelated = async ({ id, entityId: _entityId }) => {
  const { data: wr } = await supabaseAdmin
    .from('work_requests')
    .select('id, entity_id')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!wr) {
    return { invoices: [], disbursements: [], transmittals: [], documents: [] };
  }

  const relatedEntityId = wr.entity_id;

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
        .select('*, clients(name), transmittal_items(*)')
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

  const mappedTransmittals = (transmittals || []).map((t) => {
    const { transmittal_items, ...rest } = t;
    return {
      ...rest,
      items: transmittal_items || [],
    };
  });

  return {
    invoices: invoices || [],
    disbursements: disbursements || [],
    transmittals: mappedTransmittals,
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
    return { invoices: [], disbursements: [], transmittals: [] };
  }

  const relatedEntityId = entityId && entityId !== 'ALL' ? entityId : wr.entity_id;

  const [{ data: invoices }, { data: disbursements }, { data: transmittals }] = await Promise.all([
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
    supabaseAdmin
      .from('transmittals')
      .select('*, clients(name)')
      .eq('entity_id', relatedEntityId)
      .eq('work_request_id', task.work_request_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  return {
    invoices: invoices || [],
    disbursements: disbursements || [],
    transmittals: transmittals || [],
  };
};

// ============================================================
// Retainer Templates
// ============================================================

const listRetainerTemplates = async ({ entityId }) => {
  let query = supabaseAdmin
    .from('retainer_templates')
    .select('*, entities(code), clients(name)')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query;

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
    client_id: data.clientId || data.client_id || null,
    schedule: data.schedule || null,
    priority: data.priority || 'Normal',
    pf_amount: data.pfAmount ?? data.pf_amount ?? 0,
    recurrence: data.recurrence || 'none',
    assigned_to: data.assignedTo || data.assigned_to || null,
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
  else if (data.client_id !== undefined) updates.client_id = data.client_id;
  if (data.schedule !== undefined) updates.schedule = data.schedule;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.pfAmount !== undefined) updates.pf_amount = data.pfAmount;
  else if (data.pf_amount !== undefined) updates.pf_amount = data.pf_amount;
  if (data.recurrence !== undefined) updates.recurrence = data.recurrence;
  if (data.assignedTo !== undefined) updates.assigned_to = data.assignedTo;
  else if (data.assigned_to !== undefined) updates.assigned_to = data.assigned_to;
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

const generateRetainerTemplate = async ({ entityId, templateId, user, data = {} }) => {
  const { data: template, error: tplError } = await supabaseAdmin
    .from('retainer_templates')
    .select('*, entities(code), clients(name)')
    .eq('id', templateId)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .single();

  if (tplError || !template) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Retainer template not found',
    });
  }

  const rawPeriod = data.period_label ?? data.periodLabel ?? null;
  const periodLabel = typeof rawPeriod === 'string' && rawPeriod.trim() ? rawPeriod.trim() : null;

  if (template.recurrence === 'annual' && !periodLabel) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'period_label is required when template recurrence is annual',
      code: 'PERIOD_LABEL_REQUIRED',
    });
  }

  if (periodLabel) {
    const { data: existingGens } = await supabaseAdmin
      .from('retainer_template_generations')
      .select('id, template_id, period_label')
      .eq('template_id', templateId)
      .eq('period_label', periodLabel)
      .limit(1);

    if (existingGens && existingGens.length > 0) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'Period already generated for this template',
        code: 'PERIOD_ALREADY_GENERATED',
      });
    }
  }

  const overrides = data.overrides || {};
  const preProcessingTasks = [];
  const processingTasks = [];

  const templateTasks = Array.isArray(template.tasks) ? template.tasks : [];

  templateTasks.forEach((t, idx) => {
    const localId = t.local_id || t.localId || t.id || `tpl_t_${idx + 1}`;
    const assignees =
      t.default_assignees ||
      t.defaultAssignees ||
      t.assignees ||
      [
        ...(t.assigneeId ? [t.assigneeId] : []),
        ...(t.assigned_to ? [t.assigned_to] : []),
        ...(Array.isArray(t.coAssignees) ? t.coAssignees : []),
        ...(Array.isArray(t.co_assignees) ? t.co_assignees : []),
      ];
    const dependsOn =
      t.depends_on_local_id ??
      t.dependsOnLocalId ??
      t.depends_on ??
      t.dependsOn ??
      (Array.isArray(t.predecessors) && t.predecessors.length > 0 ? t.predecessors[0] : null);

    const taskObj = {
      local_id: localId,
      title: t.title,
      description: t.description || null,
      assignees: Array.isArray(assignees) ? Array.from(new Set(assignees.filter(Boolean))) : [],
      depends_on: dependsOn || null,
      dueDate: t.dueDate || t.due_date || null,
    };

    if (t.phase === 'processing') {
      processingTasks.push(taskObj);
    } else {
      preProcessingTasks.push(taskObj);
    }
  });

  const wrTitle =
    overrides.title ||
    (periodLabel ? `${template.name} - ${periodLabel}` : template.name);

  const wrPayload = {
    title: wrTitle,
    description: overrides.description !== undefined ? overrides.description : template.description,
    clientId: overrides.clientId || overrides.client_id || template.client_id || null,
    priority: overrides.priority || template.priority || 'Normal',
    assignedTo: overrides.assignedTo || overrides.assigned_to || template.assigned_to || null,
    coAssignees: overrides.coAssignees || overrides.co_assignees || [],
    dueDate: overrides.dueDate || overrides.due_date || null,
    phases: {
      pre_processing: { tasks: preProcessingTasks },
      processing: { tasks: processingTasks },
    },
  };

  const wrGraph = await createWorkRequest({
    entityId,
    data: wrPayload,
    user,
  });

  const generationRow = {
    template_id: template.id,
    work_request_id: wrGraph.id,
    period_label: periodLabel,
    generated_by: user.id,
    generated_at: new Date().toISOString(),
  };

  const { data: genRecord, error: genError } = await supabaseAdmin
    .from('retainer_template_generations')
    .insert(generationRow)
    .select()
    .single();

  if (genError) {
    try {
      await supabaseAdmin.from('work_requests').delete().eq('id', wrGraph.id);
    } catch (_rollbackErr) {
      // ignore
    }

    if (genError.code === '23505') {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'Period already generated for this template',
        code: 'PERIOD_ALREADY_GENERATED',
      });
    }

    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to record retainer template generation',
    });
  }

  return {
    ...wrGraph,
    generation: genRecord,
  };
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

// ============================================================
// Standard Task Templates
// ============================================================

const DEFAULT_STANDARD_TASK_TEMPLATES = [
  {
    id: '00000000-0000-0000-0000-000000000001',
    title: 'Gathering requirements and preparing documents for preprocessing',
    requiredLinkType: null,
    defaultChecklist: [
      { id: '00000000-0000-0000-0000-000000000011', text: 'SEC Certificate', category: 'document' },
      { id: '00000000-0000-0000-0000-000000000012', text: 'Articles of Incorporation', category: 'document' },
      { id: '00000000-0000-0000-0000-000000000013', text: "Mayor's Permit", category: 'document' },
      { id: '00000000-0000-0000-0000-000000000014', text: 'BIR Form 1901/1903', category: 'document' },
    ],
    coAssignees: [],
    sortOrder: 1,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000002',
    title: 'Gather requirements and prepare documents needed for processing',
    requiredLinkType: null,
    defaultChecklist: [
      { id: '00000000-0000-0000-0000-000000000021', text: 'SEC Certificate', category: 'document' },
      { id: '00000000-0000-0000-0000-000000000022', text: "Mayor's Permit", category: 'document' },
      { id: '00000000-0000-0000-0000-000000000023', text: 'BIR Form 1901/1903', category: 'document' },
      { id: '00000000-0000-0000-0000-000000000024', text: 'Articles of Incorporation', category: 'document' },
    ],
    coAssignees: ['Employee 1', 'Employee 2', 'Employee 3'],
    sortOrder: 2,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    title: 'Creation of ORUS account',
    requiredLinkType: null,
    defaultChecklist: [],
    coAssignees: [],
    sortOrder: 3,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000004',
    title: 'Registration of Books of Accounts',
    requiredLinkType: null,
    defaultChecklist: [],
    coAssignees: [],
    sortOrder: 4,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000005',
    title: 'Application and Received of Authority to Print',
    requiredLinkType: null,
    defaultChecklist: [],
    coAssignees: [],
    sortOrder: 5,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000006',
    title: 'Pickup of Sales/Service Invoice',
    requiredLinkType: null,
    defaultChecklist: [],
    coAssignees: [],
    sortOrder: 6,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000007',
    title: 'Billing',
    requiredLinkType: 'billing',
    defaultChecklist: [],
    coAssignees: [],
    sortOrder: 7,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000008',
    title: 'Disbursement',
    requiredLinkType: 'disbursement',
    defaultChecklist: [],
    coAssignees: [],
    sortOrder: 8,
    isSystemDefault: true,
  },
  {
    id: '00000000-0000-0000-0000-000000000009',
    title: 'Transmittal',
    requiredLinkType: 'transmittal',
    defaultChecklist: [],
    coAssignees: [],
    sortOrder: 9,
    isSystemDefault: true,
  },
];

let _standardTaskTemplatesFallback = null;

const initFallbackTemplates = () => {
  _standardTaskTemplatesFallback = new Map();
  DEFAULT_STANDARD_TASK_TEMPLATES.forEach((tmpl) => {
    _standardTaskTemplatesFallback.set(tmpl.id, {
      ...tmpl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });
};

const normalizeTemplateRow = (row) => ({
  id: row.id,
  title: row.title,
  requiredLinkType: row.required_link_type !== undefined ? row.required_link_type : row.requiredLinkType || null,
  defaultChecklist: row.default_checklist !== undefined ? row.default_checklist : row.defaultChecklist || [],
  coAssignees: row.co_assignees !== undefined ? row.co_assignees : row.coAssignees || [],
  sortOrder: row.sort_order ?? row.sortOrder ?? 0,
  isSystemDefault: row.is_system_default ?? row.isSystemDefault ?? false,
  createdAt: row.created_at || row.createdAt,
  updatedAt: row.updated_at || row.updatedAt,
});

const listStandardTaskTemplates = async () => {
  try {
    const { data, error } = await supabaseAdmin
      .from('standard_task_templates')
      .select('*')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      if (!_standardTaskTemplatesFallback) initFallbackTemplates();
      return Array.from(_standardTaskTemplatesFallback.values()).sort(
        (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
      );
    }

    if (!data || data.length === 0) {
      const rows = DEFAULT_STANDARD_TASK_TEMPLATES.map((t) => ({
        id: t.id,
        title: t.title,
        required_link_type: t.requiredLinkType,
        default_checklist: t.defaultChecklist,
        co_assignees: t.coAssignees,
        sort_order: t.sortOrder,
        is_system_default: true,
      }));
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('standard_task_templates')
        .insert(rows)
        .select('*');

      if (!insertErr && inserted && inserted.length > 0) {
        return inserted.map(normalizeTemplateRow);
      }
      return DEFAULT_STANDARD_TASK_TEMPLATES;
    }

    return data.map(normalizeTemplateRow);
  } catch (err) {
    if (!_standardTaskTemplatesFallback) initFallbackTemplates();
    return Array.from(_standardTaskTemplatesFallback.values()).sort(
      (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
    );
  }
};

const createStandardTaskTemplate = async ({ userId, data }) => {
  const row = {
    title: data.title,
    required_link_type: data.requiredLinkType || null,
    default_checklist: data.defaultChecklist || [],
    co_assignees: data.coAssignees || [],
    sort_order: data.sortOrder || 0,
    is_system_default: false,
    created_by: userId,
  };

  try {
    const { data: created, error } = await supabaseAdmin
      .from('standard_task_templates')
      .insert(row)
      .select('*')
      .single();

    if (!error && created) {
      return normalizeTemplateRow(created);
    }
  } catch (_e) {
    // Ignore error and fall back to in-memory store
  }

  if (!_standardTaskTemplatesFallback) initFallbackTemplates();
  const id = randomUUID();
  const record = {
    id,
    title: data.title,
    requiredLinkType: data.requiredLinkType || null,
    defaultChecklist: data.defaultChecklist || [],
    coAssignees: data.coAssignees || [],
    sortOrder: data.sortOrder || _standardTaskTemplatesFallback.size + 1,
    isSystemDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  _standardTaskTemplatesFallback.set(id, record);
  return record;
};

const updateStandardTaskTemplate = async ({ id, data }) => {
  const updates = {
    updated_at: new Date().toISOString(),
  };
  if (data.title !== undefined) updates.title = data.title;
  if (data.requiredLinkType !== undefined) updates.required_link_type = data.requiredLinkType;
  if (data.defaultChecklist !== undefined) updates.default_checklist = data.defaultChecklist;
  if (data.coAssignees !== undefined) updates.co_assignees = data.coAssignees;
  if (data.sortOrder !== undefined) updates.sort_order = data.sortOrder;

  try {
    const { data: updated, error } = await supabaseAdmin
      .from('standard_task_templates')
      .update(updates)
      .eq('id', id)
      .is('deleted_at', null)
      .select('*')
      .single();

    if (!error && updated) {
      return normalizeTemplateRow(updated);
    }
  } catch (_e) {
    // Ignore error and fall back to in-memory store
  }

  if (!_standardTaskTemplatesFallback) initFallbackTemplates();
  const existing = _standardTaskTemplatesFallback.get(id);
  if (!existing) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Standard task template not found',
    });
  }
  const updatedRecord = {
    ...existing,
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.requiredLinkType !== undefined ? { requiredLinkType: data.requiredLinkType } : {}),
    ...(data.defaultChecklist !== undefined ? { defaultChecklist: data.defaultChecklist } : {}),
    ...(data.coAssignees !== undefined ? { coAssignees: data.coAssignees } : {}),
    ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
    updatedAt: new Date().toISOString(),
  };
  _standardTaskTemplatesFallback.set(id, updatedRecord);
  return updatedRecord;
};

const deleteStandardTaskTemplate = async ({ id }) => {
  try {
    const { error } = await supabaseAdmin
      .from('standard_task_templates')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (!error) return true;
  } catch (_e) {
    // Ignore error and fall back to in-memory store
  }

  if (!_standardTaskTemplatesFallback) initFallbackTemplates();
  if (!_standardTaskTemplatesFallback.has(id)) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Standard task template not found',
    });
  }
  _standardTaskTemplatesFallback.delete(id);
  return true;
};

const resetStandardTaskTemplates = async ({ userId }) => {
  try {
    await supabaseAdmin
      .from('standard_task_templates')
      .update({ deleted_at: new Date().toISOString() })
      .is('deleted_at', null);

    const rows = DEFAULT_STANDARD_TASK_TEMPLATES.map((t) => ({
      id: t.id,
      title: t.title,
      required_link_type: t.requiredLinkType,
      default_checklist: t.defaultChecklist,
      co_assignees: t.coAssignees,
      sort_order: t.sortOrder,
      is_system_default: true,
      created_by: userId,
    }));

    const { data: inserted, error } = await supabaseAdmin
      .from('standard_task_templates')
      .insert(rows)
      .select('*');

    if (!error && inserted && inserted.length > 0) {
      return inserted.map(normalizeTemplateRow);
    }
  } catch (_e) {
    // Ignore error and fall back to in-memory store
  }

  initFallbackTemplates();
  return Array.from(_standardTaskTemplatesFallback.values()).sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
  );
};

// ============================================================
// Phase Routing: Advancement Gates, Direct Advance, QA Review & Reroute
// ============================================================

/**
 * Validate advancement gate conditions for a transition from fromPhase to toPhase.
 * @param {object} params
 * @param {string} params.workRequestId
 * @param {string} params.fromPhase
 * @param {string} params.toPhase
 * @returns {Promise<boolean>}
 */
const checkAdvancementGate = async ({ workRequestId, fromPhase, toPhase }) => {
  const fromIndex = PHASE_SEQUENCE.indexOf(fromPhase);
  const toIndex = PHASE_SEQUENCE.indexOf(toPhase);

  if (fromIndex === -1 || toIndex === -1) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Invalid phase values: from "${fromPhase}" to "${toPhase}"`,
    });
  }

  // Strictly sequential transitions: no skipping intermediate phases.
  if (toIndex !== fromIndex + 1) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Direct jump from "${fromPhase}" to "${toPhase}" is not permitted. Phases must advance sequentially: ${PHASE_SEQUENCE.join(' -> ')}`,
      code: 'INVALID_PHASE_TRANSITION',
    });
  }

  // Fetch all tasks for this work request
  const { data: tasks, error } = await supabaseAdmin
    .from('tasks')
    .select('id, title, status, phase, qa_status')
    .eq('work_request_id', workRequestId)
    .is('deleted_at', null);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to fetch tasks for advancement gate check',
    });
  }

  const activeTasks = (tasks || []).filter((t) => t.status !== 'Cancelled');

  if (fromPhase === 'pre_processing' && toPhase === 'processing') {
    // Every active (non-Cancelled) pre_processing task must be Completed
    const activePreTasks = activeTasks.filter((t) => t.phase === 'pre_processing');
    const incomplete = activePreTasks.filter((t) => t.status !== 'Completed');
    if (incomplete.length > 0) {
      const list = incomplete.map((t) => `"${t.title || t.id}" (${t.status})`).join(', ');
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Advancement gate failed: ${incomplete.length} active pre-processing task(s) are incomplete: ${list}`,
        code: 'ADVANCEMENT_GATE_FAILED',
      });
    }
  } else if (fromPhase === 'processing' && toPhase === 'quality_assurance') {
    // Every active (non-Cancelled) processing task must be Completed
    const activeProcTasks = activeTasks.filter((t) => t.phase === 'processing');
    const incomplete = activeProcTasks.filter((t) => t.status !== 'Completed');
    if (incomplete.length > 0) {
      const list = incomplete.map((t) => `"${t.title || t.id}" (${t.status})`).join(', ');
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Advancement gate failed: ${incomplete.length} active processing task(s) are incomplete: ${list}`,
        code: 'ADVANCEMENT_GATE_FAILED',
      });
    }
  } else if (fromPhase === 'quality_assurance' && toPhase === 'completion') {
    // Every active task (both phases) must be Completed AND all active tasks have qa_status = 'passed'
    const incomplete = activeTasks.filter((t) => t.status !== 'Completed');
    if (incomplete.length > 0) {
      const list = incomplete.map((t) => `"${t.title || t.id}" (${t.status})`).join(', ');
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Advancement gate failed: ${incomplete.length} active task(s) are incomplete: ${list}`,
        code: 'ADVANCEMENT_GATE_FAILED',
      });
    }
    const unpassed = activeTasks.filter((t) => t.qa_status !== 'passed');
    if (unpassed.length > 0) {
      const list = unpassed.map((t) => `"${t.title || t.id}" (qa_status: ${t.qa_status})`).join(', ');
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Advancement gate failed: all active tasks must have qa_status = "passed". Tasks not passed: ${list}`,
        code: 'ADVANCEMENT_GATE_FAILED',
      });
    }
  }

  return true;
};

/**
 * Advance a work request's phase.
 * @param {object} params
 * @param {string} params.id - Work request ID
 * @param {string} [params.entityId] - Entity ID
 * @param {string} [params.toPhase] - Target phase (defaults to next sequential phase)
 * @param {object} params.user - Current user
 * @param {string} [params.via='direct'] - 'direct' | 'request'
 * @returns {Promise<object>}
 */
const advanceWorkRequest = async ({ id, entityId, toPhase, user, via = 'direct' }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  const currentPhase = existing.phase || 'pre_processing';
  if (currentPhase === 'completion') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Work request is already in completion phase',
      code: 'INVALID_PHASE_TRANSITION',
    });
  }

  const fromIndex = PHASE_SEQUENCE.indexOf(currentPhase);
  const targetPhase = toPhase || PHASE_SEQUENCE[fromIndex + 1];

  await checkAdvancementGate({
    workRequestId: id,
    fromPhase: currentPhase,
    toPhase: targetPhase,
  });

  const now = new Date().toISOString();
  const newStatus = PHASE_STATUS_MAP[targetPhase] || 'In Progress';

  const { error } = await supabaseAdmin
    .from('work_requests')
    .update({
      phase: targetPhase,
      phase_entered_at: now,
      status: newStatus,
      updated_at: now,
    })
    .eq('id', id);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to advance work request phase',
    });
  }

  await auditService.log({
    action: 'work_request.phase_advance',
    table: 'work_requests',
    recordId: id,
    entity: existing.entity_id || entityId,
    userId: user?.id,
    details: {
      from_phase: currentPhase,
      to_phase: targetPhase,
      before: { phase: currentPhase, status: existing.status },
      after: { phase: targetPhase, status: newStatus },
      via,
    },
  });

  const requesterId = existing.requestedBy || existing.requested_by;
  if (requesterId) {
    try {
      await notify([requesterId], 'wr.transition_request.resolved', {
        request_id: null,
        work_request_id: id,
        from_phase: currentPhase,
        to_phase: targetPhase,
        outcome: 'approved',
        via,
      });
    } catch (_notifErr) {
      // Notification errors never fail business operations
    }
  }

  return getWorkRequestById({ id, entityId, user });
};

/**
 * Record QA review evaluations for tasks on a work request in quality_assurance phase.
 * @param {object} params
 * @param {string} params.id - Work request ID
 * @param {string} [params.entityId] - Entity ID
 * @param {Array<{ task_id?: string, taskId?: string, qa_status?: string, qaStatus?: string }>} params.results
 * @param {object} params.user - Current user
 * @returns {Promise<object>}
 */
const qaReviewWorkRequest = async ({ id, entityId, results, user }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  if (existing.phase !== 'quality_assurance') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `QA review can only be performed when work request is in "quality_assurance" phase (current phase: "${existing.phase}")`,
      code: 'INVALID_PHASE_FOR_QA_REVIEW',
    });
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'results must be a non-empty array of task QA evaluations',
    });
  }

  const { data: tasks, error: taskErr } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('work_request_id', id)
    .is('deleted_at', null);

  if (taskErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to fetch tasks for QA review',
    });
  }

  const tasksMap = new Map((tasks || []).map((t) => [t.id, t]));
  const evaluations = [];
  const now = new Date().toISOString();

  for (const item of results) {
    const taskId = item.task_id || item.taskId;
    const qaStatus = item.qa_status || item.qaStatus;

    if (!taskId || !['passed', 'failed'].includes(qaStatus)) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Each result must have a valid task_id and qa_status ("passed" or "failed")',
      });
    }

    const task = tasksMap.get(taskId);
    if (!task) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: `Task ${taskId} does not belong to work request ${id}`,
      });
    }

    evaluations.push({
      task_id: taskId,
      title: task.title,
      before_qa_status: task.qa_status || 'none',
      after_qa_status: qaStatus,
    });

    const { error: updateErr } = await supabaseAdmin
      .from('tasks')
      .update({
        qa_status: qaStatus,
        updated_at: now,
      })
      .eq('id', taskId);

    if (updateErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Unable to update QA status for task ${taskId}`,
      });
    }
  }

  await auditService.log({
    action: 'work_request.qa_review',
    table: 'work_requests',
    recordId: id,
    entity: existing.entity_id || entityId,
    userId: user?.id,
    details: {
      work_request_id: id,
      evaluations,
    },
  });

  return getWorkRequestById({ id, entityId, user });
};

/**
 * Reroute a work request from quality_assurance back to pre_processing or processing,
 * reopening ONLY failed tasks (qa_status = 'failed') and notifying their assignees.
 * @param {object} params
 * @param {string} params.id - Work request ID
 * @param {string} [params.entityId] - Entity ID
 * @param {string} params.toPhase - 'pre_processing' | 'processing'
 * @param {string} params.reason - Required non-empty explanation
 * @param {object} params.user - Current user
 * @returns {Promise<object>}
 */
const rerouteWorkRequest = async ({ id, entityId, toPhase, reason, user }) => {
  const existing = await getWorkRequestById({ id, entityId, user });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  if (existing.phase !== 'quality_assurance') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Reroute can only be performed when work request is in "quality_assurance" phase (current phase: "${existing.phase}")`,
      code: 'INVALID_PHASE_FOR_REROUTE',
    });
  }

  if (!['pre_processing', 'processing'].includes(toPhase)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'to_phase must be either "pre_processing" or "processing"',
    });
  }

  if (!reason || typeof reason !== 'string' || reason.trim() === '') {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'reason is required for reroute',
    });
  }

  const cleanReason = reason.trim();

  // Fetch all tasks for this WR
  const { data: tasks, error: taskErr } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('work_request_id', id)
    .is('deleted_at', null);

  if (taskErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to fetch tasks for reroute',
    });
  }

  const failedTasks = (tasks || []).filter((t) => t.qa_status === 'failed');
  const failedTaskIds = failedTasks.map((t) => t.id);
  const now = new Date().toISOString();

  // Reopen ONLY failed tasks: status := 'In Progress', qa_status := 'none'
  for (const failedTask of failedTasks) {
    const { error: reopenErr } = await supabaseAdmin
      .from('tasks')
      .update({
        status: 'In Progress',
        qa_status: 'none',
        updated_at: now,
      })
      .eq('id', failedTask.id);

    if (reopenErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Unable to reopen failed task ${failedTask.id}`,
      });
    }
  }

  const newStatus = PHASE_STATUS_MAP[toPhase] || 'In Progress';
  const { error: wrUpdateErr } = await supabaseAdmin
    .from('work_requests')
    .update({
      phase: toPhase,
      phase_entered_at: now,
      status: newStatus,
      updated_at: now,
    })
    .eq('id', id);

  if (wrUpdateErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update work request phase during reroute',
    });
  }

  // Gather assignees of failed tasks
  const failedAssigneeIds = new Set();
  failedTasks.forEach((t) => {
    if (t.assignee_id) failedAssigneeIds.add(t.assignee_id);
  });

  if (failedTaskIds.length > 0) {
    const { data: assignees } = await supabaseAdmin
      .from('task_assignees')
      .select('user_id')
      .in('task_id', failedTaskIds);

    (assignees || []).forEach((a) => {
      if (a.user_id) failedAssigneeIds.add(a.user_id);
    });
  }

  await auditService.log({
    action: 'work_request.reroute',
    table: 'work_requests',
    recordId: id,
    entity: existing.entity_id || entityId,
    userId: user?.id,
    details: {
      from_phase: 'quality_assurance',
      to_phase: toPhase,
      reason: cleanReason,
      reopened_task_ids: failedTaskIds,
      before: { phase: 'quality_assurance', status: existing.status },
      after: { phase: toPhase, status: newStatus },
    },
  });

  try {
    await notify(Array.from(failedAssigneeIds), 'wr.qa_reroute', {
      work_request_id: id,
      wr_title: existing.title,
      to_phase: toPhase,
      reason: cleanReason,
      failed_task_ids: failedTaskIds,
    });
  } catch (_notifErr) {
    // Notify error never fails business operation
  }

  const updatedWr = await getWorkRequestById({ id, entityId, user });
  return {
    ...updatedWr,
    reopened_tasks: failedTaskIds,
  };
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
  generateRetainerTemplate,
  listGroundWorkers,
  createGroundWorker,
  addTimeLogs,
  listStandardTaskTemplates,
  createStandardTaskTemplate,
  updateStandardTaskTemplate,
  deleteStandardTaskTemplate,
  resetStandardTaskTemplates,
  checkAdvancementGate,
  advanceWorkRequest,
  qaReviewWorkRequest,
  rerouteWorkRequest,
  isUserAssignedToTask,
  isManager,
  validateProjectTeamRoles,
  VALID_TRANSITIONS,
  PHASE_SEQUENCE,
  PHASE_STATUS_MAP,
};
