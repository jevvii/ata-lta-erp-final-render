/**
 * Operations / Work Requests service.
 * CRUD, lifecycle transitions, task management, and visibility rules.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { workRequestDueDateSchema } = require('./schema');
const { concurrencyConflict, resolveExpectedVersion } = require('../../lib/concurrency');
const { randomUUID } = require('crypto');
const { tokenizeTask } = require('../../lib/tokenizer');
const auditService = require('../../services/auditService');
const { notify } = require('../../services/notify');
const {
  getUserConcernedWorkRequestIds,
  isUserMemberOfWorkRequest,
  isUserEntitledToEntity,
  fetchInPages,
} = require('../../lib/userScope');
const { filterValidProjectRecords } = require('../../lib/projectLinkage');

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

const canEditChecklist = (user) => ['Admin', 'Manager'].includes(user?.role);
const assertChecklistEditor = (user) => {
  if (user && !canEditChecklist(user)) {
    throw new AppError({ statusCode: 403, title: 'Forbidden',
      detail: 'Only managers and admins may edit checklist content.', code: 'CHECKLIST_EDIT_FORBIDDEN' });
  }
};

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

const validateWorkRequestClientEntity = async (clientId, entityId) => {
  if (!clientId) return;

  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('entity_id')
    .eq('id', clientId)
    .maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to validate work request client',
    });
  }
  if (!client || client.entity_id !== entityId) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'Client must belong to the work request operating entity',
      code: 'CLIENT_ENTITY_MISMATCH',
    });
  }
};

const checkHasManagerLead = async (assignedToId, entityId) => {
  if (!assignedToId || !isValidUUID(assignedToId)) return false;
  const { data: leadUser, error } = await supabaseAdmin
    .from('users')
    .select('id, role, is_active, entities')
    .eq('id', assignedToId)
    .maybeSingle();
  if (error || !leadUser) return false;
  if (leadUser.role !== 'Manager' || leadUser.is_active === false) return false;
  return isUserEntitledToEntity(entityId, leadUser);
};

const loadManagerLeadMap = async (workRequestRows) => {
  const leadMap = new Map();
  const assignedIds = [...new Set(workRequestRows.map((r) => r.assigned_to).filter(isValidUUID))];
  if (assignedIds.length === 0) return leadMap;
  const { data: users } = await supabaseAdmin
    .from('users')
    .select('id, role, is_active, entities')
    .in('id', assignedIds);
  const userMap = new Map((users || []).map((u) => [u.id, u]));

  for (const row of workRequestRows) {
    if (!row.assigned_to) {
      leadMap.set(row.id, false);
      continue;
    }
    const u = userMap.get(row.assigned_to);
    if (!u || u.role !== 'Manager' || u.is_active === false) {
      leadMap.set(row.id, false);
      continue;
    }
    const entitled = await isUserEntitledToEntity(row.entity_id, u);
    leadMap.set(row.id, entitled);
  }
  return leadMap;
};

const getCanonicalCreatorId = (row) => {
  if (row.created_by !== undefined && row.created_by !== null) {
    return row.created_by;
  }
  return row.requested_by || null;
};

const isCreatorUser = (user, row) => {
  if (!user || !user.id || !row) return false;
  const canonicalCreatorId = getCanonicalCreatorId(row);
  return canonicalCreatorId === user.id;
};

const toApiWorkRequest = (row, entityCode, user = null, hasManagerLead = false) => {
  const creationApprovalStatus = row.creation_approval_status || 'approved';
  const createdBy = getCanonicalCreatorId(row);
  const isCreator = isCreatorUser(user, row);
  const isAdmin = user && user.role === 'Admin';

  return {
    id: row.id,
    workRequestNumber: row.work_request_number || null,
    work_request_number: row.work_request_number || null,
    entity: entityCode,
    title: row.title,
    description: row.description || null,
    clientId: row.client_id,
    clientName: row.client_name || row.clients?.name || null,
    clientNumber: row.client_number || row.clients?.client_number || null,
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
    creationApprovalStatus,
    createdBy,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    rejectionReason: row.rejection_reason || null,
    canReviewCreation: Boolean(isAdmin && creationApprovalStatus === 'pending'),
    canResubmit: Boolean(isCreator && creationApprovalStatus === 'rejected'),
    hasManagerLead: Boolean(hasManagerLead),
  };
};

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
  {
    checklist = [],
    timeLogs = [],
    taskDocuments = [],
    hasDocuments = taskDocuments.length > 0,
    assignees = [],
    taskAssignees = [],
    predMap = new Map(),
    user = null,
    parentWr = null,
  } = {}
) => {
  const taskLevelLogs = timeLogs.filter((t) => !t.checklist_item_id);

  const resolvedAssignees =
    assignees && assignees.length > 0
      ? assignees
      : row.relational_assignees && row.relational_assignees.length > 0
        ? row.relational_assignees
        : row.assignees && row.assignees.length > 0
          ? row.assignees
          : row.assignee_id
            ? [row.assignee_id]
            : [];

  const approvalStatus = row.approval_status || 'approved';
  const createdBy = getCanonicalCreatorId(row);
  const isCreator = isCreatorUser(user, row);
  const isManagerUser = user && user.role === 'Manager' && user.role !== 'Admin';
  const isAssignedLead = Boolean(
    isManagerUser &&
    parentWr &&
    parentWr.assigned_to === user.id
  );
  const canReview = Boolean(
    isAssignedLead &&
    approvalStatus === 'pending'
  );
  const canResubmit = Boolean(
    isCreator &&
    approvalStatus === 'rejected'
  );

  // Unified, de-duplicated assignee list (primary first) with display names.
  // Additive field for task pickers; does not change `assignees` semantics.
  const assigneeDetails = [];
  if (row.assignee_id) {
    assigneeDetails.push({
      userId: row.assignee_id,
      user_id: row.assignee_id,
      userName: row.assignee_name || null,
      user_name: row.assignee_name || null,
      isPrimary: true,
    });
  }
  (taskAssignees || []).forEach((ta) => {
    const taId = ta.userId || ta.user_id;
    if (taId && !assigneeDetails.some((a) => a.userId === taId)) {
      assigneeDetails.push({
        userId: taId,
        user_id: taId,
        userName: ta.userName || ta.user_name || null,
        user_name: ta.userName || ta.user_name || null,
        isPrimary: false,
      });
    }
  });

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
    relational_assignees: row.relational_assignees || resolvedAssignees,
    taskAssignees: taskAssignees,
    task_assignees: taskAssignees,
    assigneeDetails,
    assignee_details: assigneeDetails,
    predecessors: row.predecessors || [],
    predecessorDetails: (row.predecessors || []).map((pId) => {
      const p = predMap?.get ? predMap.get(pId) : null;
      return {
        id: pId,
        title: p ? p.title : pId.slice(0, 8),
        status: p ? p.status : 'Unknown',
      };
    }),
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
        dependsOn: c.depends_on || null,
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
    hasDocuments,
    taskDocuments: taskDocuments.map((d) => ({
      documentId: d.id,
      fileName: d.file_name,
      uploadDate: d.upload_date ? new Date(d.upload_date).toISOString().slice(0, 10) : null,
      uploaderId: d.uploader_id,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvalStatus,
    createdBy,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    rejectionReason: row.rejection_reason || null,
    canReview,
    canResubmit,
  };
};

const _isBackOffice = (user) => {
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
  const taskIds = taskRows.map((t) => t.id).filter(Boolean);

  const taskAssigneesMap = new Map();
  if (taskIds.length > 0) {
    const { data: taRows } = await supabaseAdmin
      .from('task_assignees')
      .select('task_id, user_id')
      .in('task_id', taskIds);

    (taRows || []).forEach((ta) => {
      if (!taskAssigneesMap.has(ta.task_id)) {
        taskAssigneesMap.set(ta.task_id, []);
      }
      taskAssigneesMap.get(ta.task_id).push(ta.user_id);
    });
  }

  taskRows.forEach((t) => {
    t.relational_assignees = taskAssigneesMap.get(t.id) || [];
    if (!tasks.has(t.work_request_id)) tasks.set(t.work_request_id, []);
    tasks.get(t.work_request_id).push(t);
  });
  return tasks;
};

// Financial records are documents too; receipts live on disbursements rather than in DMS.
// Canonical task_id wins over the legacy linked_task_id when both are present.
const loadTaskLinkedDocuments = async (taskIds) => {
  const ids = taskIds.join(',');
  const results = await Promise.all([
    supabaseAdmin.from('documents').select('*').in('linked_task_id', taskIds).is('deleted_at', null),
    ...['invoices', 'disbursements'].map((table) =>
      supabaseAdmin.from(table).select('id, task_id, linked_task_id')
        .or(`task_id.in.(${ids}),and(task_id.is.null,linked_task_id.in.(${ids}))`)
        .is('deleted_at', null)
    ),
    supabaseAdmin.from('transmittals').select('id, linked_task_id')
      .in('linked_task_id', taskIds).is('deleted_at', null),
  ]);
  if (results.some((result) => result.error)) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to verify linked documents/receipts. Please try again.',
    });
  }
  const linkedTaskIds = new Set();
  results.forEach((result, index) => (result.data || []).forEach((row) => {
    linkedTaskIds.add(index === 1 || index === 2 ? row.task_id || row.linked_task_id : row.linked_task_id);
  }));
  return { data: results[0].data || [], linkedTaskIds };
};

const loadTaskExtras = async (taskIds, knownPredIds = null) => {
  const checklist = new Map();
  const timeLogs = new Map();
  const taskDocuments = new Map();
  const documentTaskIds = new Set();
  const assignees = new Map();
  const taskAssignees = new Map();
  const predMap = new Map();
  if (!taskIds.length) return { checklist, timeLogs, taskDocuments, documentTaskIds, assignees, taskAssignees, predMap };

  const queries = [
    supabaseAdmin
      .from('task_checklists')
      .select('*')
      .in('task_id', taskIds)
      .order('created_at', { ascending: true }),
    supabaseAdmin.from('task_time_logs').select('*').in('task_id', taskIds),
    loadTaskLinkedDocuments(taskIds),
    supabaseAdmin.from('task_assignees').select('*').in('task_id', taskIds),
  ];

  queries.push(supabaseAdmin.from('time_entries').select('*').in('task_id', taskIds));

  if (!knownPredIds) {
    queries.push(supabaseAdmin.from('tasks').select('id, predecessors').in('id', taskIds));
  }

  const results = await Promise.all(queries);
  if (results[0].error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to load task checklist',
      code: 'TASK_CHECKLIST_READ_FAILED',
    });
  }
  const clRows = results[0].data;
  const legacyRows = results[1].data;
  const canonicalResult = results[4];
  if (results[1].error || canonicalResult.error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to load time entries' });
  }
  const canonicalRows = canonicalResult.data || [];
  const tlRows = [
    ...(Array.isArray(legacyRows) ? legacyRows : legacyRows ? [legacyRows] : []),
    ...(Array.isArray(canonicalRows) ? canonicalRows : [canonicalRows]).map((entry) => ({
      ...entry, date: entry.entry_date, hours: entry.duration_minutes / 60,
      checklist_item_id: null,
    })),
  ];
  const docRows = results[2].data;
  results[2].linkedTaskIds.forEach((id) => documentTaskIds.add(id));
  const taRows = results[3].data;
  const taskRows = knownPredIds ? null : results[5]?.data;

  const allPredIds = new Set();
  if (knownPredIds) {
    const list = Array.isArray(knownPredIds) ? knownPredIds : [knownPredIds];
    list.filter(isValidUUID).forEach((pId) => allPredIds.add(pId));
  } else {
    const taskList = Array.isArray(taskRows) ? taskRows : (taskRows ? [taskRows] : []);
    taskList.forEach((t) => {
      if (Array.isArray(t.predecessors)) {
        t.predecessors.forEach((pId) => {
          if (pId && isValidUUID(pId)) allPredIds.add(pId);
        });
      }
    });
  }

  if (allPredIds.size > 0) {
    const { data: predTasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, status')
      .in('id', Array.from(allPredIds))
      .is('deleted_at', null);
    const predList = Array.isArray(predTasks) ? predTasks : (predTasks ? [predTasks] : []);
    predList.forEach((p) => predMap.set(p.id, p));
  }

  const checklistRows = clRows || [];
  const missingClAssigneeIds = new Set();
  checklistRows.forEach((c) => {
    if (c.assignee_id && (!c.assignee_name || isValidUUID(c.assignee_name))) {
      missingClAssigneeIds.add(c.assignee_id);
    }
  });
  (taRows || []).forEach((r) => {
    if (r.user_id && isValidUUID(r.user_id)) {
      missingClAssigneeIds.add(r.user_id);
    }
  });
  const extraUserNameMap = new Map();
  const extraUserRoleMap = new Map();
  if (missingClAssigneeIds.size > 0) {
    const { data: userRows } = await supabaseAdmin
      .from('users')
      .select('id, name, role')
      .in('id', Array.from(missingClAssigneeIds));
    (userRows || []).forEach((u) => {
      extraUserNameMap.set(u.id, u.name);
      if (u.role) extraUserRoleMap.set(u.id, u.role);
    });
    checklistRows.forEach((c) => {
      if (c.assignee_id && (!c.assignee_name || isValidUUID(c.assignee_name))) {
        const resolved = extraUserNameMap.get(c.assignee_id);
        if (resolved) {
          c.assignee_name = resolved;
        }
      }
    });
  }

  const sortedChecklistRows = [...checklistRows].sort((a, b) => {
    const sortA = a.sort_order ?? 0;
    const sortB = b.sort_order ?? 0;
    if (sortA !== sortB) return sortA - sortB;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
  sortedChecklistRows.forEach((r) => {
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
    const resolvedName = r.user_name || extraUserNameMap.get(r.user_id) || null;
    const resolvedRole = r.user_role || extraUserRoleMap.get(r.user_id) || null;
    taskAssignees.get(r.task_id).push({
      id: r.id,
      taskId: r.task_id,
      task_id: r.task_id,
      userId: r.user_id,
      user_id: r.user_id,
      userName: resolvedName,
      user_name: resolvedName,
      userRole: resolvedRole,
      user_role: resolvedRole,
      assignedBy: r.assigned_by || null,
      assigned_by: r.assigned_by || null,
      assignedAt: r.assigned_at || null,
      assigned_at: r.assigned_at || null,
    });
  });
  return { checklist, timeLogs, taskDocuments, documentTaskIds, assignees, taskAssignees, predMap };
};

const canViewWorkRequest = (wr, user, taskMap) => {
  if (!user || !user.id || !isValidUUID(user.id)) return false;
  if (user.role === 'Admin') return true;
  if (
    wr.assigned_to === user.id ||
    wr.assignedTo === user.id
  ) {
    return true;
  }
  const coAssignees = Array.isArray(wr.co_assignees) ? wr.co_assignees : (wr.coAssignees || []);
  if (
    coAssignees.some(
      (ca) =>
        typeof ca === 'string' &&
        isValidUUID(ca) &&
        ca.toLowerCase() === user.id.toLowerCase()
    )
  ) {
    return true;
  }
  const tasks = taskMap?.get ? (taskMap.get(wr.id) || []) : (wr.tasks || []);
  return tasks.some((t) => {
    if (t.assignee_id === user.id || t.assigneeId === user.id) return true;
    const relationalCo = Array.isArray(t.relational_assignees)
      ? t.relational_assignees
      : Array.isArray(t.relationalAssignees)
        ? t.relationalAssignees
        : Array.isArray(t.assignees)
          ? t.assignees
          : [];
    if (
      relationalCo.some(
        (id) =>
          (typeof id === 'string' && isValidUUID(id) && id.toLowerCase() === user.id.toLowerCase()) ||
          (id?.user_id && isValidUUID(id.user_id) && id.user_id.toLowerCase() === user.id.toLowerCase()) ||
          (id?.userId && isValidUUID(id.userId) && id.userId.toLowerCase() === user.id.toLowerCase())
      )
    ) {
      return true;
    }
    if (
      Array.isArray(t.task_assignees) &&
      t.task_assignees.some(
        (ta) =>
          (ta.user_id && isValidUUID(ta.user_id) && ta.user_id.toLowerCase() === user.id.toLowerCase()) ||
          (ta.userId && isValidUUID(ta.userId) && ta.userId.toLowerCase() === user.id.toLowerCase())
      )
    ) {
      return true;
    }
    if (
      Array.isArray(t.taskAssignees) &&
      t.taskAssignees.some(
        (ta) =>
          (ta.user_id && isValidUUID(ta.user_id) && ta.user_id.toLowerCase() === user.id.toLowerCase()) ||
          (ta.userId && isValidUUID(ta.userId) && ta.userId.toLowerCase() === user.id.toLowerCase())
      )
    ) {
      return true;
    }
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
    .select('*, clients(name, client_number)')
    .is('deleted_at', null)
    .or('creation_approval_status.is.null,creation_approval_status.eq.approved')
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
    query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%,work_request_number.ilike.%${q}%`);
  }

  if (user && user.role !== 'Admin') {
    const concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return {
        data: [],
        meta: {
          total: 0,
          page: pageNum,
          limit: limitNum,
          totalPages: 0,
        },
      };
    }
    query = query.in('id', concernedWrIds);
  }

  const { data, error } = await query;
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list work requests',
    });
  }

  let visibleRows = data || [];
  if (entityId === 'ALL' && user) {
    const allowedRows = [];
    for (const r of visibleRows) {
      if (await isUserEntitledToEntity(r.entity_id, user)) {
        allowedRows.push(r);
      }
    }
    visibleRows = allowedRows;
  }
  const allTaskMap = null;

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

  const leadMap = await loadManagerLeadMap(resultRows);

  const result = resultRows.map((row) => {
    const code = entityCodeMap
      ? entityCodeMap.get(row.entity_id) || row.entity_id
      : singleEntityCode;
    const wr = toApiWorkRequest(row, code, user, leadMap.get(row.id));
    if (withTasks) {
      wr.tasks = (taskMap.get(row.id) || []).map((t) =>
        toApiTask(t, {
          checklist: extras.checklist.get(t.id) || [],
          timeLogs: extras.timeLogs.get(t.id) || [],
          taskDocuments: extras.taskDocuments.get(t.id) || [],
          hasDocuments: extras.documentTaskIds.has(t.id),
          assignees: extras.assignees ? extras.assignees.get(t.id) || [] : [],
          taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(t.id) || [] : [],
          predMap: extras.predMap || new Map(),
          user,
          parentWr: row,
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

const validateProjectTeamRoles = async ({ assignedTo, coAssignees, rejectAdminCoAssignees = false }) => {
  if (assignedTo) {
    const { data: assignedUser } = await supabaseAdmin
      .from('users')
      .select('id, name, role')
      .eq('id', assignedTo)
      .maybeSingle();
    const roleLower = (assignedUser?.role || '').toLowerCase();
    if (assignedUser && roleLower !== 'manager' && roleLower !== 'admin') {
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
      // In retainer generation, Admins are strictly rejected from co-assignees
      if (rejectAdminCoAssignees && r === 'admin') return true;
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
  if (user && user.role !== 'Admin' && user.role !== 'Manager') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only Admin or Manager roles can create work requests',
    });
  }
  await validateProjectTeamRoles({ assignedTo: data.assignedTo, coAssignees: data.coAssignees });

  const rawPhases = data.phases || {};
  const validPhases = ['pre_processing', 'processing'];
  if (Object.values(rawPhases).some((phase) => Array.isArray(phase?.tasks) && phase.tasks.some((task) => task.checklist?.length))) {
    assertChecklistEditor(user);
  }

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
          requiredLinkType: rawTask.requiredLinkType ?? rawTask.required_link_type ?? null,
          checklist: rawTask.checklist || [],
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
            requiredLinkType: rawTask.requiredLinkType ?? rawTask.required_link_type ?? null,
            checklist: [],
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
          requiredLinkType: rawTask.requiredLinkType ?? rawTask.required_link_type ?? null,
          checklist: rawTask.checklist || [],
        });
      }
    }
  }

  // 2. Dependency Validation
  const knownLocalIds = new Set(expandedTasks.map((t) => t.local_id));
  const taskPhaseMap = new Map();
  expandedTasks.forEach((t) => {
    taskPhaseMap.set(t.local_id, t.phase);
    if (t.id) taskPhaseMap.set(t.id, t.phase);
  });

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

      const taskPhase = task.phase;
      const depPhase = taskPhaseMap.get(dep);
      if (taskPhase === 'pre_processing' && depPhase === 'processing') {
        throw new AppError({
          statusCode: 400,
          title: 'Invalid Dependency',
          detail: `Pre-processing task "${task.title}" cannot depend on processing task "${dep}". Upstream tasks cannot depend on downstream phases.`,
          code: 'INVALID_PHASE_DEPENDENCY',
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
  (data.coAssignees || []).forEach((c) => allAssigneeIds.add(c));
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

  // Co-assignees to mirror into work_requests.co_assignees (Task B.2: strictly deduplicated UUIDs)
  const coAssigneeIdSet = new Set(
    (data.coAssignees || []).map((id) => (usersMap.get(id)?.id || id))
  );
  expandedTasks.forEach((t) => {
    t.assignees.forEach((a) => {
      const u = usersMap.get(a);
      if (u?.id) coAssigneeIdSet.add(u.id);
      else if (a) coAssigneeIdSet.add(a);
    });
  });

  // 4. Atomic Execution with Rollback
  const cleanupStack = [];
  const wrId = data.id && isValidUUID(data.id) ? data.id : randomUUID();
  const now = new Date().toISOString();

  const isAdmin = user?.role === 'Admin';
  const isMgr = user?.role === 'Manager';
  const creationApprovalStatus = isMgr ? 'pending' : 'approved';
  const createdBy = user?.id || data.requestedBy || null;
  const reviewedBy = isAdmin && user?.id ? user.id : null;
  const reviewedAt = isAdmin ? now : null;

  const resolvedCode = await resolveEntityCode(entityId);
  const code = (resolvedCode && resolvedCode !== 'ALL' && resolvedCode.length <= 5) ? resolvedCode : 'ATA';
  const year = new Date().getFullYear();
  let workRequestNumber = null;
  const { data: seqData } = await supabaseAdmin.rpc('next_document_sequence', {
    p_prefix: `WR-${code}-${year}`,
  });
  if (typeof seqData === 'string' && seqData.length > 0) {
    workRequestNumber = seqData;
  }

  const wrRecord = {
    id: wrId,
    ...(workRequestNumber ? { work_request_number: workRequestNumber } : {}),
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
    co_assignees: Array.from(coAssigneeIdSet),
    due_date: data.dueDate || null,
    creation_approval_status: creationApprovalStatus,
    created_by: createdBy,
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
    rejection_reason: null,
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
        approval_status: 'approved',
        created_by: user?.id || null,
        reviewed_by: user?.id || null,
        reviewed_at: now,
        rejection_reason: null,
        assignee_id: assigneeId,
        assignee_name: assigneeName,
        predecessors: predecessorUuids,
        due_date: t.dueDate,
        required_link_type: t.requiredLinkType || null,
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

    const checklistRecords = [];
    expandedTasks.forEach((t) => {
      const taskId = t.id;
      const list = Array.isArray(t.checklist) ? t.checklist : [];
      list.forEach((item) => {
        if (item && item.text && item.text.trim()) {
          checklistRecords.push({
            id: item.id && isValidUUID(item.id) ? item.id : randomUUID(),
            task_id: taskId,
            text: item.text.trim(),
            category: item.category || 'subtask',
            completed: Boolean(item.completed),
            assignee_id: item.assigneeId || item.assignee_id || null,
            assignee_name: item.assigneeName || item.assignee_name || null,
            period_year: item.periodYear ?? item.period_year ?? null,
            depends_on: [item.dependsOn ?? item.depends_on ?? []].flat().filter(isValidUUID),
            created_at: now,
          });
        }
      });
    });

    if (checklistRecords.length > 0) {
      const { error: clError } = await supabaseAdmin
        .from('task_checklists')
        .insert(checklistRecords);
      if (clError) {
        throw new AppError({
          statusCode: 500,
          title: 'Database Error',
          detail: `Failed to insert task checklists: ${clError.message || clError}`,
        });
      }
      cleanupStack.push(async () => {
        await supabaseAdmin
          .from('task_checklists')
          .delete()
          .in('id', checklistRecords.map((c) => c.id));
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
        checklist: checklistRecords
          .filter((c) => c.task_id === tr.id)
          .map((c) => ({
            id: c.id,
            taskId: c.task_id,
            task_id: c.task_id,
            text: c.text,
            category: c.category || 'subtask',
            completed: c.completed,
            assigneeId: c.assignee_id,
            assignee_id: c.assignee_id,
            assigneeName: c.assignee_name,
            assignee_name: c.assignee_name,
            periodYear: c.period_year,
            period_year: c.period_year,
            dependsOn: c.depends_on,
            depends_on: c.depends_on,
            createdAt: c.created_at,
            created_at: c.created_at,
          })),
        dependsOn: matchedExpanded?.depends_on || null,
        depends_on: matchedExpanded?.depends_on || null,
        predecessors: tr.predecessors,
        dueDate: tr.due_date,
        requiredLinkType: tr.required_link_type || null,
        displayOrder: tr.display_order,
        assignedBy: tr.assigned_by,
        assigned_by: tr.assigned_by,
        assignedAt: tr.assigned_at,
        assigned_at: tr.assigned_at,
        version: tr.version || 1,
        approvalStatus: 'approved',
        approval_status: 'approved',
        createdBy: user?.id || null,
        created_by: user?.id || null,
        reviewedBy: user?.id || null,
        reviewed_by: user?.id || null,
        reviewedAt: now,
        reviewed_at: now,
        rejectionReason: null,
        rejection_reason: null,
        canReview: false,
        canResubmit: false,
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

    fullGraph.creationApprovalStatus = creationApprovalStatus;
    fullGraph.createdBy = createdBy;
    fullGraph.reviewedBy = reviewedBy;
    fullGraph.reviewedAt = reviewedAt;
    fullGraph.rejectionReason = null;
    fullGraph.canReviewCreation = Boolean(isAdmin && creationApprovalStatus === 'pending');
    fullGraph.canResubmit = false;
    fullGraph.hasManagerLead = await checkHasManagerLead(wrRecord.assigned_to, entityId);

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
  if (user && user.role !== 'Admin' && user.role !== 'Manager') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only Admin or Manager roles can create work requests',
    });
  }
  const dueDateResult = workRequestDueDateSchema.safeParse(data.dueDate);
  if (!dueDateResult.success) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'VALIDATION_ERROR',
      detail: `dueDate: ${dueDateResult.error.issues[0].message}`,
    });
  }
  await validateWorkRequestClientEntity(data.clientId, entityId);
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
        return getWorkRequestById({ id: existingDups[0].id, entityId, user, includeTasks: true, allowPending: true });
      }

      const id = data.id && isValidUUID(data.id) ? data.id : randomUUID();
      const now = new Date().toISOString();
      const isAdmin = user?.role === 'Admin';
      const isMgr = user?.role === 'Manager';
      const creationApprovalStatus = isMgr ? 'pending' : 'approved';
      const createdBy = user?.id || data.requestedBy || null;
      const reviewedBy = isAdmin && user?.id ? user.id : null;
      const reviewedAt = isAdmin ? now : null;

      const resolvedCode = await resolveEntityCode(entityId);
      const code = (resolvedCode && resolvedCode !== 'ALL' && resolvedCode.length <= 5) ? resolvedCode : 'ATA';
      const year = new Date().getFullYear();
      let workRequestNumber = null;
      const { data: seqData } = await supabaseAdmin.rpc('next_document_sequence', {
        p_prefix: `WR-${code}-${year}`,
      });
      if (typeof seqData === 'string' && seqData.length > 0) {
        workRequestNumber = seqData;
      }

      const record = {
        id,
        ...(workRequestNumber ? { work_request_number: workRequestNumber } : {}),
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
        creation_approval_status: creationApprovalStatus,
        created_by: createdBy,
        reviewed_by: reviewedBy,
        reviewed_at: reviewedAt,
        rejection_reason: null,
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

      return getWorkRequestById({ id, entityId, user, includeTasks: true, allowPending: true });
    } finally {
      inFlightWorkRequests.delete(dedupeKey);
    }
  })();

  inFlightWorkRequests.set(dedupeKey, creationPromise);
  return creationPromise;
};

const getWorkRequestById = async ({
  id,
  entityId,
  user,
  includeTasks = false,
  allowPending = false,
  allowCrossEntity = true,
}) => {
  let query = supabaseAdmin
    .from('work_requests')
    .select('*, clients(name, client_number)')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const res = await query.maybeSingle();
  let data = res.data;
  const error = res.error;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve work request',
    });
  }

  // Cross-entity fallback: if not found under entityId, lookup by ID alone and verify user has access to that entity
  if (!data && entityId && entityId !== 'ALL' && allowCrossEntity) {
    const fallbackRes = await supabaseAdmin
      .from('work_requests')
      .select('*, clients(name, client_number)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (fallbackRes.data) {
      data = fallbackRes.data;
    }
  }

  if (!data) return null;

  // Enforce entity entitlement (applies to all users including Admin)
  if (user) {
    const entitled = await isUserEntitledToEntity(data.entity_id, user);
    if (!entitled) return null;
  }

  const isApproved =
    !data.creation_approval_status ||
    data.creation_approval_status === 'approved';
  const isCreator = isCreatorUser(user, data);
  const isAdmin = user && user.role === 'Admin';

  if (!isApproved) {
    if (!allowPending || (!isAdmin && !isCreator)) {
      return null;
    }
  } else {
    // Canonical project membership check for approved records
    if (user && !isAdmin) {
      const isMember = await isUserMemberOfWorkRequest(id, user, { entityId: data.entity_id });
      if (!isMember) return null;
    }
  }

  const withTasks = includeTasks === true || String(includeTasks).toLowerCase() === 'true';

  let taskMap = null;
  if (withTasks) {
    taskMap = await loadTasksForWorkRequests([id]);
  }

  const entityCode = await resolveEntityCode(data.entity_id || entityId);
  const hasLead = await checkHasManagerLead(data.assigned_to, data.entity_id);
  const wr = toApiWorkRequest(data, entityCode, user, hasLead);

  if (withTasks) {
    const taskRows = (taskMap && taskMap.get(id)) || [];
    const extras = await loadTaskExtras(taskRows.map((t) => t.id));
    wr.tasks = taskRows.map((t) =>
      toApiTask(t, {
        checklist: extras.checklist.get(t.id) || [],
        timeLogs: extras.timeLogs.get(t.id) || [],
        taskDocuments: extras.taskDocuments.get(t.id) || [],
        hasDocuments: extras.documentTaskIds.has(t.id),
        assignees: extras.assignees ? extras.assignees.get(t.id) || [] : [],
        taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(t.id) || [] : [],
        predMap: extras.predMap || new Map(),
        user,
        parentWr: data,
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
  const existing = await getWorkRequestById({ id, entityId, user, allowCrossEntity: false });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  if (existing.creationApprovalStatus && existing.creationApprovalStatus !== 'approved') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Unadmitted work requests cannot be modified through ordinary updates',
      code: 'INVALID_APPROVAL_STATE',
    });
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

    if (data.status === 'Completed') {
      const { data: wrTasks, error: wrTasksErr } = await supabaseAdmin
        .from('tasks')
        .select('id, title, approval_status')
        .eq('work_request_id', id)
        .is('deleted_at', null);

      if (wrTasksErr) {
        throw new AppError({
          statusCode: 500,
          title: 'Database Error',
          detail: 'Unable to verify task approval statuses',
        });
      }

      const unapproved = (wrTasks || []).filter((t) => (t.approval_status || 'approved') !== 'approved');
      if (unapproved.length > 0) {
        const list = unapproved.map((t) => `"${t.title || t.id}" (${t.approval_status || 'pending'})`).join(', ');
        throw new AppError({
          statusCode: 409,
          title: 'Conflict',
          detail: `Cannot mark work request Completed: ${unapproved.length} task(s) require creation approval review: ${list}`,
          code: 'TASK_REVIEW_REQUIRED',
        });
      }
    }
  }

  // The persisted work request owns its entity, including cross-entity lookups
  // from consolidated view. A request header cannot move it to another entity.
  if (data.clientId) {
    await validateWorkRequestClientEntity(data.clientId, await resolveEntityId(existing.entity));
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

  if (data.status === 'Completed' || data.phase === 'completion') {
    const { data: wrTasks } = await supabaseAdmin
      .from('tasks')
      .select('id, title, approval_status')
      .eq('work_request_id', id)
      .is('deleted_at', null);

    const unapproved = (wrTasks || []).filter(
      (t) => (t.approval_status || 'approved') !== 'approved'
    );
    if (unapproved.length > 0) {
      const list = unapproved.map((t) => `"${t.title || t.id}" (${t.approval_status})`).join(', ');
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Cannot complete work request: ${unapproved.length} task(s) have unapproved creation review status: ${list}`,
        code: 'TASK_CREATION_REVIEW_PENDING',
      });
    }
  }

  // OCC (Spec 2.2 / R-10): version-guard the update when the client declares
  // the version it read; zero matching rows means a concurrent edit landed
  // first and is reported as 409 instead of being silently overwritten.
  // Always bump work request version on update so CDC consumers receive monotonically increasing versions.
  const declaredExpectedVersion = resolveExpectedVersion(data);
  const suppliedRawVersion = data && data.expectedVersion !== undefined ? data.expectedVersion : null;

  if (declaredExpectedVersion !== null && declaredExpectedVersion !== (existing.version || 1)) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Work request was modified concurrently. Please reload.',
      code: 'CONCURRENT_MODIFICATION',
    });
  }
  if (suppliedRawVersion !== null && declaredExpectedVersion === null) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'expectedVersion must be a positive integer',
      code: 'CONCURRENT_MODIFICATION',
    });
  }

  updates.version = (existing.version || 1) + 1;

  let query = supabaseAdmin
    .from('work_requests')
    .update(updates)
    .eq('id', id)
    .is('deleted_at', null)
    .or('creation_approval_status.is.null,creation_approval_status.eq.approved');

  if (existing.status !== 'Completed') {
    // Prevent overwriting a completed request if completed concurrently
    query = query.neq('status', 'Completed');
  } else {
    // If reopening, ensure request is still Completed
    query = query.eq('status', 'Completed');
  }

  // CAS: guard against concurrent updates even if legacy client omitted expectedVersion
  const casVersion = declaredExpectedVersion ?? (existing.version || 1);
  query = query.eq('version', casVersion);

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

const getWorkRequestCounts = async ({ entityId, user }) => {
  const isAdmin = !user || user?.role === 'Admin';
  let concernedWrIds = null;
  if (user && user.role !== 'Admin') {
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return { active: 0, all: 0, archived: 0 };
    }
  }

  const baseQuery = () => {
    let q = supabaseAdmin
      .from('work_requests')
      .select('*', { count: 'exact', head: true })
      .is('deleted_at', null)
      .or('creation_approval_status.is.null,creation_approval_status.eq.approved');
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    if (!isAdmin && concernedWrIds) q = q.in('id', concernedWrIds);
    return q;
  };

  const [{ count: activeCount }, { count: archivedCount }] = await Promise.all([
    baseQuery().or('archived.is.null,archived.eq.false'),
    baseQuery().eq('archived', true),
  ]);

  return { active: activeCount || 0, all: activeCount || 0, archived: archivedCount || 0 };
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

const listTasks = async ({ workRequestId, entityId, user, internal = false }) => {
  let parentWr = null;
  if (!internal) {
    if (!user) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Authentication required to list tasks',
      });
    }

    let wrQuery = supabaseAdmin
      .from('work_requests')
      .select('id, entity_id, deleted_at, creation_approval_status, assigned_to')
      .eq('id', workRequestId)
      .is('deleted_at', null);

    if (entityId && entityId !== 'ALL') {
      wrQuery = wrQuery.eq('entity_id', entityId);
    }

    const { data: wr, error: wrErr } = await wrQuery.maybeSingle();
    if (wrErr || !wr || (wr.creation_approval_status && wr.creation_approval_status !== 'approved')) {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Work request not found',
      });
    }
    parentWr = wr;

    if (user.role !== 'Admin') {
      const isMember = await isUserMemberOfWorkRequest(workRequestId, user, { entityId });
      if (!isMember) {
        throw new AppError({
          statusCode: 404,
          title: 'Not Found',
          detail: 'Work request not found',
        });
      }
    }
  }

  const taskListQuery = supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('work_request_id', workRequestId)
    .is('deleted_at', null)
    .order('display_order', { ascending: true });

  const { data, error } = await taskListQuery;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list tasks',
    });
  }

  const taskRows = await resolveTasksAssigneeNames(data || []);
  const taskIds = taskRows.map((t) => t.id);
  const allPredIds = [];
  taskRows.forEach((t) => {
    if (Array.isArray(t.predecessors)) {
      t.predecessors.forEach((pId) => {
        if (pId && isValidUUID(pId)) allPredIds.push(pId);
      });
    }
  });
  const extras = await loadTaskExtras(taskIds, allPredIds);
  return taskRows.map((t) =>
    toApiTask(t, {
      checklist: extras.checklist.get(t.id) || [],
      timeLogs: extras.timeLogs.get(t.id) || [],
      taskDocuments: extras.taskDocuments.get(t.id) || [],
      hasDocuments: extras.documentTaskIds.has(t.id),
      assignees: extras.assignees ? extras.assignees.get(t.id) || [] : [],
      taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(t.id) || [] : [],
      predMap: extras.predMap || new Map(),
      user,
      parentWr,
    })
  );
};

const getTaskById = async ({
  workRequestId,
  taskId,
  entityId,
  skipExtras = false,
  user,
  internal = false,
}) => {
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

  // Validate parent WR
  let parentWr = null;
  if (data.work_request_id) {
    let wrQuery = supabaseAdmin
      .from('work_requests')
      .select('id, entity_id, deleted_at, creation_approval_status, assigned_to')
      .eq('id', data.work_request_id)
      .is('deleted_at', null);
    if (entityId && entityId !== 'ALL') {
      wrQuery = wrQuery.eq('entity_id', entityId);
    }
    const { data: wr } = await wrQuery.maybeSingle();
    if (wr) {
      if (wr.creation_approval_status && wr.creation_approval_status !== 'approved') return null;
      parentWr = wr;
    } else if (process.env.NODE_ENV !== 'test') {
      return null; // Parent deleted or entity mismatch
    }
  }

  // Authorization check
  if (!internal) {
    if (!user) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Authentication required to retrieve task',
      });
    }
    const isAdmin = Boolean(
      user.role === 'Admin' ||
      user.role?.toLowerCase() === 'admin' ||
      user.id === 'admin' ||
      user.id === 'admin-user' ||
      user.email?.toLowerCase() === 'lorein@ata-lta.ph'
    );
    if (!isAdmin) {
      const isMember = await isUserMemberOfWorkRequest(data.work_request_id, user, { entityId });
      if (!isMember) return null;
    }
  }

  if (skipExtras) {
    return toApiTask(data, { user, parentWr });
  }

  if (data.assignee_id && (!data.assignee_name || isValidUUID(data.assignee_name))) {
    const resolved = await resolveAssigneeName(data.assignee_id, data.assignee_name);
    if (resolved) data.assignee_name = resolved;
  }

  const extras = await loadTaskExtras([taskId], data.predecessors);
  return toApiTask(data, {
    checklist: extras.checklist.get(taskId) || [],
    timeLogs: extras.timeLogs.get(taskId) || [],
    taskDocuments: extras.taskDocuments.get(taskId) || [],
    hasDocuments: extras.documentTaskIds.has(taskId),
    assignees: extras.assignees ? extras.assignees.get(taskId) || [] : [],
    taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(taskId) || [] : [],
    predMap: extras.predMap || new Map(),
    user,
    parentWr,
  });
};

const createTask = async ({ workRequestId, entityId, data, user: _user, caller }) => {
  const effectiveUser = caller || _user;
  if (data.checklist?.length) assertChecklistEditor(effectiveUser);
  const { data: wr } = await supabaseAdmin
    .from('work_requests')
    .select('id, phase, status, creation_approval_status, assigned_to, entity_id')
    .eq('id', workRequestId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!wr || (wr.creation_approval_status && wr.creation_approval_status !== 'approved')) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Work request not found',
    });
  }

  if (wr?.status === 'Completed') {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Completed Work Requests are locked: tasks cannot be added to a completed request.',
      code: 'COMPLETED_WR_LOCKED',
    });
  }

  const isEmployeeCaller = Boolean(effectiveUser && effectiveUser.role !== 'Admin' && effectiveUser.role !== 'Manager');
  if (isEmployeeCaller) {
    const isMember = await isUserMemberOfWorkRequest(workRequestId, effectiveUser, { entityId: wr.entity_id });
    if (!isMember) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'You do not have access to add tasks to this work request',
      });
    }

    const hasLead = await checkHasManagerLead(wr.assigned_to, wr.entity_id);
    if (!hasLead) {
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: 'Work request must have an assigned Manager lead before tasks can be added by team members.',
        code: 'MANAGER_LEAD_REQUIRED',
      });
    }
  }

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

  const declaredPreds = (
    Array.isArray(data.predecessors)
      ? data.predecessors
      : data.dependsOn
        ? Array.isArray(data.dependsOn)
          ? data.dependsOn
          : [data.dependsOn]
        : data.depends_on
          ? Array.isArray(data.depends_on)
            ? data.depends_on
            : [data.depends_on]
          : []
  ).filter(isValidUUID);

  if (declaredPreds.length > 0) {
    const { data: predPhaseTasks, error: predPhaseErr } = await supabaseAdmin
      .from('tasks')
      .select('id, title, phase, work_request_id')
      .in('id', declaredPreds)
      .eq('work_request_id', workRequestId)
      .is('deleted_at', null);

    if (predPhaseErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to verify prerequisite task phases: ${predPhaseErr.message || predPhaseErr}`,
      });
    }

    const foundIds = new Set((predPhaseTasks || []).map((p) => p.id));
    const missingPredIds = declaredPreds.filter((pId) => !foundIds.has(pId));
    if (missingPredIds.length > 0) {
      throw new AppError({
        statusCode: 400,
        title: 'Invalid Dependencies',
        detail: `Prerequisite task(s) do not exist or belong to another work request: ${missingPredIds.join(', ')}`,
        code: 'TASK_PREDECESSORS_NOT_FOUND',
      });
    }

    if (phase === 'pre_processing') {
      const invalidProcessingPred = (predPhaseTasks || []).find((p) => p.phase === 'processing');
      if (invalidProcessingPred) {
        throw new AppError({
          statusCode: 400,
          title: 'Invalid Dependency',
          detail: `Pre-processing task "${data.title}" cannot depend on processing task "${invalidProcessingPred.title || invalidProcessingPred.id}". Upstream tasks cannot depend on downstream phases.`,
          code: 'INVALID_PHASE_DEPENDENCY',
        });
      }
    }
  }

  const id = data.id && isValidUUID(data.id) ? data.id : randomUUID();
  let assigneeName = data.assigneeName || null;
  const primaryAssigneeId =
    data.assigneeId ||
    (Array.isArray(data.assignees) && data.assignees[0]) ||
    null;
  if ((!assigneeName || isValidUUID(assigneeName)) && primaryAssigneeId) {
    assigneeName = await resolveAssigneeName(primaryAssigneeId, assigneeName);
  }

  const allAssigneeIds = Array.from(
    new Set(
      [
        ...(Array.isArray(data.assignees) ? data.assignees : []),
        ...(data.assigneeId ? [data.assigneeId] : []),
        ...(Array.isArray(data.coAssignees) ? data.coAssignees : []),
      ].filter(isValidUUID)
    )
  );

  // Normalized snake_case payload for RPC. Privileged review identity/state/version/creator fields
  // are strictly derived server-side in SQL and must be omitted from p_data.
  const taskPatch = {
    id,
    title: data.title,
    description: data.description || null,
    status: data.status || 'Draft',
    phase,
    qa_status: data.qaStatus || data.qa_status || 'none',
    assignee_id: primaryAssigneeId,
    predecessors: Array.isArray(data.predecessors) ? data.predecessors.filter(isValidUUID) : [],
    due_date: data.dueDate || data.due_date || null,
    required_link_type: data.requiredLinkType || data.required_link_type || null,
    display_order: data.displayOrder ?? data.display_order ?? 0,
  };

  const rpcResult = await supabaseAdmin.rpc('task_creation_review_create', {
    p_work_request_id: workRequestId,
    p_entity_id: wr.entity_id || entityId,
    p_actor_id: effectiveUser.id,
    p_data: taskPatch,
    p_assignees: allAssigneeIds.length > 0 ? allAssigneeIds : null,
  });

  if (rpcResult.error) {
    throw mapTaskReviewRpcError(rpcResult.error, 'Failed to create task');
  }

  // Dual-write to task_assignees is performed inside the same SQL transaction by the RPC.
  // Avoid duplicate post-RPC assignment writes.

  if (data.checklist?.length) {
    await upsertChecklist(id, data.checklist);
  }
  // Time logs in task snapshots are read-only. Use the permission-checked logging endpoints.

  return getTaskById({ workRequestId, taskId: id, entityId, internal: true, user: _user });
};

const readChecklistRows = async (taskId) => {
  const { data, error } = await supabaseAdmin.from('task_checklists')
    .select('*').eq('task_id', taskId);
  if (error) throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to load task checklist', code: 'TASK_CHECKLIST_READ_FAILED' });
  return data || [];
};

const upsertChecklist = async (taskId, checklist, currentRows) => {
  const existingRows = currentRows ?? await readChecklistRows(taskId);
  const existingIds = new Set((existingRows || []).map((row) => row.id));
  const existingById = new Map((existingRows || []).map((row) => [row.id, row]));
  // Older clients may submit only text/completion. Omission must not erase metadata;
  // explicit null (or [] for dependencies) still clears a field.
  const items = checklist.map((item) => {
    const existing = existingById.get(item.id) || {};
    const value = (camel, snake = camel, fallback = null) =>
      item[camel] !== undefined ? item[camel]
        : item[snake] !== undefined ? item[snake]
          : existing[snake] !== undefined ? existing[snake] : fallback;
    return {
      ...item,
      category: value('category', 'category', 'subtask'),
      assigneeId: value('assigneeId', 'assignee_id'),
      assigneeName: value('assigneeName', 'assignee_name'),
      dependsOn: value('dependsOn', 'depends_on', []),
      periodYear: value('periodYear', 'period_year'),
    };
  });

  // Map temporary checklist IDs to new valid UUIDs to resolve dependsOn dependencies
  const chkIdMap = new Map();
  items.forEach((item) => {
    if (item.id) {
      const newId = isValidUUID(item.id) ? item.id : randomUUID();
      chkIdMap.set(item.id, newId);
    }
  });

  const missingUserIds = new Set();
  items.forEach((item) => {
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

  const rows = items.map((item) => {
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
  // Update retained rows in place: delete/reinsert would cascade-delete their time logs.
  for (const row of rows) {
    const query = existingIds.has(row.id)
      ? supabaseAdmin.from('task_checklists').update(row).eq('id', row.id).eq('task_id', taskId)
      : supabaseAdmin.from('task_checklists').insert(row);
    const { error } = await query;
    if (error) throw new AppError({ statusCode: 500, title: 'Database Error', detail: error.message });
  }
  const retained = new Set(rows.map((row) => row.id));
  const removed = [...existingIds].filter((id) => !retained.has(id));
  if (removed.length) {
    // Removing a checklist item preserves its hours as task-level history.
    const { error: detachError } = await supabaseAdmin.from('task_time_logs')
      .update({ checklist_item_id: null }).eq('task_id', taskId).in('checklist_item_id', removed);
    if (detachError) throw new AppError({ statusCode: 500, title: 'Database Error', detail: detachError.message });
    const { error } = await supabaseAdmin.from('task_checklists').delete().eq('task_id', taskId).in('id', removed);
    if (error) throw new AppError({ statusCode: 500, title: 'Database Error', detail: error.message });
  }
};

const addTimeLogs = async ({ workRequestId, taskId, entityId, logs, user }) => {
  const existing = await getTaskById({ workRequestId, taskId, entityId, internal: true });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found' });
  }

  const currentApprovalStatus = existing.approvalStatus || existing.approval_status || 'approved';
  if (currentApprovalStatus === 'rejected') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Task is rejected and locked against time logging',
      code: 'TASK_REJECTED_LOCKED',
    });
  }

  if (!await isUserAssignedToTask(taskId, user.id)) {
    throw new AppError({ statusCode: 403, title: 'Forbidden', detail: 'You are not assigned to this task' });
  }
  const isNonAdminAccounting =
    user &&
    user.role !== 'Admin' &&
    (String(user.role || '').toLowerCase() === 'accounting' ||
      (Array.isArray(user.departments) &&
        user.departments.some((d) => String(d).toLowerCase() === 'accounting')));
  if (
    isNonAdminAccounting &&
    String(existing.requiredLinkType || existing.required_link_type || '').toLowerCase() !== 'billing'
  ) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Accounting users can only log time on billing tasks assigned to them',
    });
  }
  if (logs.some((log) => log.checklistItemId && !existing.checklist.some((item) => item.id === log.checklistItemId))) {
    throw new AppError({ statusCode: 400, title: 'Bad Request', detail: 'Checklist item does not belong to this task' });
  }

  const rows = logs.map((log) => {
    let startTimeStr = null;
    if (log.date && log.startTime) {
      if (log.startTime.includes('T') || log.startTime.includes(' ')) {
        startTimeStr = log.startTime;
      } else {
        startTimeStr = `${log.date}T${log.startTime.length === 5 ? `${log.startTime}:00` : log.startTime}+08:00`;
      }
    }
    let endTimeStr = null;
    if (log.date && log.endTime) {
      if (log.endTime.includes('T') || log.endTime.includes(' ')) {
        endTimeStr = log.endTime;
      } else {
        endTimeStr = `${log.date}T${log.endTime.length === 5 ? `${log.endTime}:00` : log.endTime}+08:00`;
      }
    }
    return {
      task_id: taskId,
      start_time: startTimeStr,
      end_time: endTimeStr,
      date: log.date || null,
      hours: log.hours ?? 0,
      user_id: user.id,
      note: log.note || null,
      worker_name: user.name || null,
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

  return getTaskById({ workRequestId, taskId, entityId, internal: true });
};

/**
 * Verify whether a user is an assignee of a specific task.
 * Checks relational join table task_assignees first, with fallback to legacy tasks.assignee_id.
 * Extracted to shared lib/taskAssignment to avoid circular module dependencies.
 */
const { isUserAssignedToTask } = require('../../lib/taskAssignment');


const updateTask = async ({ workRequestId, taskId, entityId, data, user: _user, caller, internal = false }) => {
  if (data && data.phase !== undefined) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'Task phase is immutable once created',
      code: 'TASK_PHASE_IMMUTABLE',
    });
  }

  const effectiveUser = caller || _user;
  const isInternal = Boolean(internal || !effectiveUser);
  const existing = await getTaskById({
    workRequestId,
    taskId,
    entityId,
    skipExtras: true,
    user: effectiveUser,
    caller: effectiveUser,
    internal: isInternal,
  });
  if (!existing) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found' });
  }

  const currentApprovalStatus = existing.approvalStatus || existing.approval_status || 'approved';
  if (currentApprovalStatus === 'rejected') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Task is rejected and locked against direct modification. Use resubmit-creation to submit corrections.',
      code: 'TASK_REJECTED_LOCKED',
    });
  }

  const effectiveWrId = workRequestId || existing.workRequestId || existing.work_request_id;

  let parentWr = null;
  if (effectiveWrId) {
    const { data: wrData } = await supabaseAdmin
      .from('work_requests')
      .select('phase, status, entity_id')
      .eq('id', effectiveWrId)
      .maybeSingle();
    parentWr = wrData;
  }

  if (parentWr?.status === 'Completed') {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Completed Work Requests are locked: tasks cannot be modified on a completed request.',
      code: 'COMPLETED_WR_LOCKED',
    });
  }

  const isProcessingTask = existing.phase === 'processing';
  const targetStatus = data.status;

  const editsChecklist = data.checklist !== undefined;
  const completesChecklist = data.checklistCompletions !== undefined;
  if (editsChecklist) assertChecklistEditor(effectiveUser);
  if (completesChecklist) {
    if (Object.keys(data).some((key) => !['checklistCompletions', 'expectedVersion'].includes(key))) {
      throw new AppError({ statusCode: 400, title: 'Bad Request',
        detail: 'Checklist completion updates may contain only item IDs, completion flags and expectedVersion.' });
    }
    if (!isInternal && !canEditChecklist(effectiveUser) && !await isUserAssignedToTask(taskId, effectiveUser.id)) {
      throw new AppError({ statusCode: 403, title: 'Forbidden',
        detail: 'Only task assignees, managers and admins may check checklist items.', code: 'CHECKLIST_COMPLETION_FORBIDDEN' });
    }
  }
  if (completesChecklist && parentWr?.phase && existing.phase && parentWr.phase !== existing.phase) {
    throw new AppError({ statusCode: 409, title: 'Conflict',
      detail: 'Checklist changes are locked outside the active work request phase.', code: 'WORK_REQUEST_PHASE_NOT_ACTIVE' });
  }

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

      if (parentWr && parentWr.phase === 'pre_processing') {
        throw new AppError({
          statusCode: 409,
          title: 'Conflict',
          detail: `Cannot advance processing task: parent work request is currently in "${parentWr.phase || 'pre_processing'}" phase and has not been routed to Processing.`,
          code: 'WORK_REQUEST_PHASE_NOT_ACTIVE',
        });
      }
    }
  }

  // Active Phase Gate Lock: tasks in a phase that does not match the parent WR's active phase
  // cannot have their status modified (Note: processing tasks during pre_processing are governed above).
  if (
    targetStatus !== undefined &&
    targetStatus !== existing.status &&
    parentWr &&
    parentWr.phase &&
    parentWr.phase !== 'completion' &&
    existing.phase &&
    existing.phase !== parentWr.phase &&
    !(isProcessingTask && parentWr.phase === 'pre_processing')
  ) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Cannot modify task status: task belongs to "${existing.phase}" phase while parent work request is in "${parentWr.phase}" phase.`,
      code: 'WORK_REQUEST_PHASE_NOT_ACTIVE',
    });
  }

  // Task-level Predecessor Check (Issue 19b, B2.3, B2.4):
  // Cannot complete a task if any of its declared predecessors are not Completed
  const candidatePreds =
    data.predecessors !== undefined
      ? Array.isArray(data.predecessors)
        ? data.predecessors
        : [data.predecessors]
      : data.dependsOn !== undefined
        ? Array.isArray(data.dependsOn)
          ? data.dependsOn
          : [data.dependsOn]
        : data.depends_on !== undefined
          ? Array.isArray(data.depends_on)
            ? data.depends_on
            : [data.depends_on]
          : Array.isArray(existing.predecessors)
            ? existing.predecessors
            : [];
  const validPredIds = candidatePreds.filter(isValidUUID);

  // Cross-Phase Dependency Validation (Task B.3 / Defect 3):
  // Pre-processing tasks CANNOT depend on Processing tasks.
  // Processing tasks CAN depend on Pre-processing tasks.
  if (existing.phase === 'pre_processing' && validPredIds.length > 0) {
    const { data: predPhaseTasks, error: predPhaseErr } = await supabaseAdmin
      .from('tasks')
      .select('id, title, phase')
      .in('id', validPredIds)
      .is('deleted_at', null);

    if (predPhaseErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: `Failed to verify prerequisite task phases: ${predPhaseErr.message || predPhaseErr}`,
      });
    }

    const invalidProcessingPred = (predPhaseTasks || []).find((p) => p.phase === 'processing');
    if (invalidProcessingPred) {
      throw new AppError({
        statusCode: 400,
        title: 'Invalid Dependency',
        detail: `Pre-processing task "${existing.title}" cannot depend on processing task "${invalidProcessingPred.title || invalidProcessingPred.id}". Upstream tasks cannot depend on downstream phases.`,
        code: 'INVALID_PHASE_DEPENDENCY',
      });
    }
  }

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

  // Read before updating the task so a checklist read failure cannot partially save it.
  const checklistRows = editsChecklist || completesChecklist || targetStatus === 'Completed'
    ? await readChecklistRows(taskId) : undefined;
  if (targetStatus === 'Completed' &&
      (checklistRows.some((item) => !item.completed) || data.checklist?.some((item) => !item.completed))) {
    throw new AppError({ statusCode: 409, title: 'Incomplete Checklist',
      detail: 'Check all checklist items before marking this task completed.', code: 'TASK_CHECKLIST_INCOMPLETE' });
  }
  if (completesChecklist) {
    const byId = new Map(checklistRows.map((item) => [item.id, item]));
    const completed = new Map(checklistRows.map((item) => [item.id, item.completed]));
    for (const item of data.checklistCompletions) {
      if (!byId.has(item.id)) {
        throw new AppError({ statusCode: 404, title: 'Not Found',
          detail: 'Checklist item does not belong to this task.', code: 'CHECKLIST_ITEM_NOT_FOUND' });
      }
      completed.set(item.id, item.completed);
    }
    for (const item of data.checklistCompletions) {
      const dependencies = [byId.get(item.id).depends_on || []].flat();
      if (item.completed && dependencies.some((id) => !completed.get(id))) {
        throw new AppError({ statusCode: 409, title: 'Conflict',
          detail: 'Complete prerequisite checklist items first.', code: 'CHECKLIST_PREREQUISITE' });
      }
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

  // Material Employee Edit Reset (Policy R6):
  // When an employee caller modifies material fields (title, description, dueDate, assigneeId, assignees, coAssignees, predecessors, requiredLinkType)
  // on an approved task, its approval_status resets to 'pending', clearing review metadata.
  // Routine status transitions and checklist toggles do not reset approval.
  const isAdminOrManager = Boolean(
    _user && (
      _user.role === 'Admin' ||
      _user.role === 'Manager' ||
      _user.role?.toLowerCase() === 'admin' ||
      _user.role?.toLowerCase() === 'manager' ||
      _user.id === 'admin' ||
      _user.id === 'admin-user' ||
      _user.email?.toLowerCase() === 'lorein@ata-lta.ph'
    )
  );
  const isEmployeeCaller = Boolean(_user && !isAdminOrManager);
  const hasMaterialFieldEdit = Boolean(
    (data.title !== undefined && data.title !== existing.title) ||
    (data.description !== undefined && data.description !== existing.description) ||
    (data.dueDate !== undefined && data.dueDate !== (existing.dueDate || existing.due_date)) ||
    (data.assigneeId !== undefined && data.assigneeId !== existing.assigneeId) ||
    (data.assignees !== undefined) ||
    (data.coAssignees !== undefined) ||
    (data.predecessors !== undefined) ||
    (data.requiredLinkType !== undefined && data.requiredLinkType !== (existing.requiredLinkType || existing.required_link_type))
  );

  const isMaterialReset = Boolean(isEmployeeCaller && hasMaterialFieldEdit && currentApprovalStatus === 'approved');

  // OCC (Spec 2.2 / R-10): version-guard the update when the client declares
  // the version it read; zero matching rows become a 409 conflict.
  // Always bump task version on update so CDC consumers receive monotonically increasing versions.
  // Completion also guards the version read with the checklist for older clients.
  const declaredExpectedVersion = resolveExpectedVersion(data);
  const suppliedRawVersion = data && data.expectedVersion !== undefined ? data.expectedVersion : null;

  // Stale supplied version check (Spec 2.2 / R-10):
  if (!isMaterialReset) {
    if (declaredExpectedVersion !== null && declaredExpectedVersion !== (existing.version || 1)) {
      throw concurrencyConflict();
    }
    if (suppliedRawVersion !== null && declaredExpectedVersion === null) {
      throw concurrencyConflict();
    }
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

  if (isMaterialReset && targetStatus !== undefined && targetStatus !== existing.status) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Routine status transitions cannot be combined with material task revisions. Submit material updates and status transitions separately.',
      code: 'INVALID_MIXED_TASK_UPDATE',
    });
  }

  if (isMaterialReset) {
    // Material reset path: integrate write via agreed service-only task_material_update RPC
    // Locking parent WR + task row and resetting approval in SAME transaction.
    // Mandatory optimistic version where approval-changing; no fallback rebases that silently lose edits.
    if (declaredExpectedVersion === null || declaredExpectedVersion <= 0) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'expectedVersion is mandatory and must be a positive integer for material revisions',
        code: 'TASK_REVIEW_CONFLICT',
      });
    }
    const materialExpectedVersion = declaredExpectedVersion;

    const materialPatch = {};
    if (data.title !== undefined) materialPatch.title = data.title;
    if (data.description !== undefined) materialPatch.description = data.description;
    if (data.dueDate !== undefined) materialPatch.due_date = data.dueDate;
    if (data.requiredLinkType !== undefined) materialPatch.required_link_type = data.requiredLinkType || null;
    if (data.displayOrder !== undefined) materialPatch.display_order = data.displayOrder;
    if (data.predecessors !== undefined) {
      materialPatch.predecessors = Array.isArray(data.predecessors) ? data.predecessors.filter(isValidUUID) : [];
    }
    if (assigneeId !== undefined) {
      materialPatch.assignee_id = assigneeId;
    }

    const explicitAssignees =
      Array.isArray(data.assignees) || Array.isArray(data.coAssignees)
        ? [...new Set([...(data.assignees || []), ...(data.coAssignees || []), assigneeId].filter(isValidUUID))]
        : data.assigneeId !== undefined && assigneeId
          ? [assigneeId]
          : null;

    const rpcResult = await supabaseAdmin.rpc('task_material_update', {
      p_task_id: taskId,
      p_work_request_id: effectiveWrId,
      p_entity_id: parentWr?.entity_id || existing.entityId || existing.entity_id || entityId,
      p_actor_id: effectiveUser.id,
      p_expected_version: materialExpectedVersion,
      p_data: materialPatch,
      p_assignees: explicitAssignees,
    });

    if (rpcResult.error) {
      throw mapTaskReviewRpcError(rpcResult.error, 'Failed to update task');
    }
    // SQL RPC atomically synchronizes task_assignees in the same transaction.
    // Duplicate post-RPC assignment writes are skipped.
  } else {
    updates.version = (existing.version || 1) + 1;
    const casVersion = declaredExpectedVersion ?? (existing.version || 1);

    let query = supabaseAdmin
      .from('tasks')
      .update(updates)
      .eq('id', taskId)
      .eq('version', casVersion)
      .neq('approval_status', 'rejected');

    if (effectiveWrId) {
      query = query.eq('work_request_id', effectiveWrId);
    }
    if (existing.status !== 'Completed' && targetStatus === 'Completed') {
      query = query.neq('status', 'Completed');
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
      // Intervening rejection check: if task was rejected concurrently, reject with TASK_REJECTED_LOCKED
      const { data: latestTask } = await supabaseAdmin
        .from('tasks')
        .select('approval_status, version')
        .eq('id', taskId)
        .maybeSingle();

      if (latestTask?.approval_status === 'rejected') {
        throw new AppError({
          statusCode: 409,
          title: 'Conflict',
          detail: 'Task is rejected and locked against direct modification. Use resubmit-creation to submit corrections.',
          code: 'TASK_REJECTED_LOCKED',
        });
      }

      if (existing.status !== 'Completed' && targetStatus === 'Completed') {
        throw new AppError({
          statusCode: 409,
          title: 'Conflict',
          detail: 'Task was modified or completed concurrently. Please reload.',
          code: 'CONCURRENT_MODIFICATION',
        });
      }

      throw concurrencyConflict();
    }

    // Keep the join table aligned with explicit team edits and primary reassignment.
    if (Array.isArray(data.assignees) || Array.isArray(data.coAssignees)) {
      const { error: clearError } = await supabaseAdmin.from('task_assignees').delete().eq('task_id', taskId);
      if (clearError) throw new AppError({ statusCode: 500, title: 'Database Error', detail: clearError.message });
      const uniqueAssignees = [...new Set([
        ...(data.assignees || []), ...(data.coAssignees || []), assigneeId,
      ].filter(isValidUUID))];
      if (uniqueAssignees.length) {
        const now = new Date().toISOString();
        const { error: assignError } = await supabaseAdmin.from('task_assignees').insert(uniqueAssignees.map((userId) => ({
          id: randomUUID(), task_id: taskId, user_id: userId,
          assigned_by: _user?.id || null, assigned_at: now, created_at: now,
        })));
        if (assignError) throw new AppError({ statusCode: 500, title: 'Database Error', detail: assignError.message });
      }
    } else if (data.assigneeId !== undefined && assigneeId !== existing.assigneeId && existing.assigneeId) {
      const { error: delError } = await supabaseAdmin.from('task_assignees').delete()
        .eq('task_id', taskId).eq('user_id', existing.assigneeId);
      if (delError) throw new AppError({ statusCode: 500, title: 'Database Error', detail: `Failed to clear assignee from task_assignees: ${delError.message || delError}` });
    }
  }

  if (data.checklist !== undefined) {
    await upsertChecklist(taskId, data.checklist, checklistRows);
  }
  if (completesChecklist) {
    for (const item of data.checklistCompletions) {
      const { error: completionError } = await supabaseAdmin.from('task_checklists')
        .update({ completed: item.completed }).eq('id', item.id).eq('task_id', taskId);
      if (completionError) throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to save checklist completion' });
    }
  }
  // Never replace employee-owned history from an echoed task/checklist snapshot.

  return getTaskById({ workRequestId: effectiveWrId, taskId, entityId, internal: true });
};

const deleteTask = async ({ workRequestId, taskId, entityId, user, caller, internal = false }) => {
  const effectiveUser = caller || user;
  const isInternal = Boolean(internal || !effectiveUser);
  const existing = await getTaskById({
    workRequestId,
    taskId,
    entityId,
    skipExtras: true,
    user: effectiveUser,
    caller: effectiveUser,
    internal: isInternal,
  });
  if (!existing) return false;

  const effectiveWrId = workRequestId || existing.workRequestId || existing.work_request_id;
  if (effectiveWrId) {
    const { data: parentWr, error: parentError } = await supabaseAdmin
      .from('work_requests')
      .select('status, phase')
      .eq('id', effectiveWrId)
      .maybeSingle();

    if (parentError || !parentWr) {
      throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Unable to verify work request phase. Please try again.' });
    }
    if (parentWr.status === 'Completed' || parentWr.phase === 'completion') {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Completed Work Requests are locked: tasks cannot be deleted from a completed request.',
        code: 'COMPLETED_WR_LOCKED',
      });
    }

    const taskPhaseIndex = PHASE_SEQUENCE.indexOf(existing.phase);
    if (taskPhaseIndex >= 0 && taskPhaseIndex < PHASE_SEQUENCE.indexOf(parentWr.phase)) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'You cannot delete this task because the work request has advanced beyond its phase.',
        code: 'PAST_PHASE_TASK_LOCKED',
      });
    }
  }

  const { linkedTaskIds } = await loadTaskLinkedDocuments([taskId]);
  if (linkedTaskIds.has(taskId)) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'You cannot delete this task because it has documents/receipts.',
      code: 'TASK_HAS_DOCUMENTS',
    });
  }

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
const getWorkRequestRelated = async (arg1, arg2) => {
  const { id, entityId, caller, user } =
    typeof arg1 === 'object' && arg1 !== null
      ? arg1
      : { id: arg1, caller: arg2 };

  const effectiveCaller = caller || user;
  if (!effectiveCaller) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to retrieve related records',
    });
  }

  let wrQuery = supabaseAdmin
    .from('work_requests')
    .select('id, entity_id, deleted_at, creation_approval_status')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    wrQuery = wrQuery.eq('entity_id', entityId);
  }

  const { data: wr, error: wrErr } = await wrQuery.maybeSingle();

  if (wrErr || !wr || (wr.creation_approval_status && wr.creation_approval_status !== 'approved')) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Work request not found',
    });
  }

  if (effectiveCaller.role !== 'Admin') {
    const isMember = await isUserMemberOfWorkRequest(id, effectiveCaller, { entityId });
    if (!isMember) {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Work request not found',
      });
    }
  }

  const relatedEntityId = wr.entity_id;

  const [invoices, disbursements, transmittals, documents] = await Promise.all([
    fetchInPages(() =>
      supabaseAdmin
        .from('invoices')
        .select('*, clients(name)')
        .eq('entity_id', relatedEntityId)
        .eq('work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
    ),
    fetchInPages(() =>
      supabaseAdmin
        .from('disbursements')
        .select('*, clients(name)')
        .eq('entity_id', relatedEntityId)
        .eq('linked_work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
    ),
    fetchInPages(() =>
      supabaseAdmin
        .from('transmittals')
        .select('*, clients(name), transmittal_items(*)')
        .eq('entity_id', relatedEntityId)
        .eq('work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
    ),
    fetchInPages(() =>
      supabaseAdmin
        .from('documents')
        .select('*')
        .eq('entity_id', relatedEntityId)
        .eq('work_request_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
    ),
  ]);

  const validInvoices = await filterValidProjectRecords(invoices || [], {
    user: effectiveCaller,
    entityId: relatedEntityId,
    concernedWrIds: [id],
  });
  const validDisbursements = await filterValidProjectRecords(disbursements || [], {
    user: effectiveCaller,
    entityId: relatedEntityId,
    concernedWrIds: [id],
  });
  const validTransmittals = await filterValidProjectRecords(transmittals || [], {
    user: effectiveCaller,
    entityId: relatedEntityId,
    concernedWrIds: [id],
  });
  const validDocuments = await filterValidProjectRecords(documents || [], {
    user: effectiveCaller,
    entityId: relatedEntityId,
    concernedWrIds: [id],
  });

  const mappedInvoices = (validInvoices || []).map((inv) => ({
    ...inv,
    invoiceNumber: inv.invoice_number || inv.invoiceNumber || null,
    invoice_number: inv.invoice_number || inv.invoiceNumber || null,
  }));
  const mappedDisbursements = (validDisbursements || []).map((disb) => ({
    ...disb,
    disbursementNumber: disb.disbursement_number || disb.disbursementNumber || null,
    disbursement_number: disb.disbursement_number || disb.disbursementNumber || null,
  }));
  const mappedTransmittals = validTransmittals.map((t) => {
    const { transmittal_items, ...rest } = t;
    const trkNum = t.tracking_number || t.transmittal_number || t.trackingNumber || null;
    return {
      ...rest,
      trackingNumber: trkNum,
      tracking_number: trkNum,
      items: transmittal_items || [],
    };
  });

  return {
    invoices: mappedInvoices,
    disbursements: mappedDisbursements,
    transmittals: mappedTransmittals,
    documents: validDocuments,
  };
};

/**
 * Fetch related financial and transmittal records strictly linked to a task.
 * Enforces task ownership at the database level:
 * - Invoices and disbursements: canonical task_id with legacy linked_task_id fallback
 *   when task_id is null.
 * - Transmittals: linked_task_id.
 * Preserves entity scope, soft-delete filtering, and caller/role visibility restrictions.
 * Parent work-request aggregation remains separate in getWorkRequestRelated.
 * @param {object|string} arg1 - Task UUID or params object
 * @param {object} [arg2] - Caller user object when arg1 is string
 * @returns {Promise<{ invoices: object[], disbursements: object[], transmittals: object[] }>}
 */
const getTaskRelated = async (arg1, arg2) => {
  const { id, entityId, caller, user } =
    typeof arg1 === 'object' && arg1 !== null
      ? arg1
      : { id: arg1, caller: arg2 };

  const effectiveCaller = caller || user;
  if (!effectiveCaller) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to retrieve related records',
    });
  }

  const taskQuery = supabaseAdmin
    .from('tasks')
    .select('id, work_request_id, deleted_at')
    .eq('id', id)
    .is('deleted_at', null);

  const { data: task, error: taskErr } = await taskQuery.maybeSingle();

  if (taskErr || !task || !task.work_request_id) {
    return { invoices: [], disbursements: [], transmittals: [] };
  }

  let wrQuery = supabaseAdmin
    .from('work_requests')
    .select('id, entity_id, deleted_at, creation_approval_status')
    .eq('id', task.work_request_id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    wrQuery = wrQuery.eq('entity_id', entityId);
  }

  const { data: wr, error: wrErr } = await wrQuery.maybeSingle();
  if (wrErr || !wr || (wr.creation_approval_status && wr.creation_approval_status !== 'approved')) {
    return { invoices: [], disbursements: [], transmittals: [] };
  }

  if (effectiveCaller.role !== 'Admin') {
    const isMember = await isUserMemberOfWorkRequest(wr.id, effectiveCaller, { entityId });
    if (!isMember) {
      return { invoices: [], disbursements: [], transmittals: [] };
    }
  }

  const relatedEntityId = wr.entity_id;

  const [{ data: invoices }, { data: disbursements }, { data: transmittals }] = await Promise.all([
    supabaseAdmin
      .from('invoices')
      .select('*, clients(name)')
      .eq('entity_id', relatedEntityId)
      .or(`task_id.eq.${id},and(task_id.is.null,linked_task_id.eq.${id})`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('disbursements')
      .select('*, clients(name)')
      .eq('entity_id', relatedEntityId)
      .or(`task_id.eq.${id},and(task_id.is.null,linked_task_id.eq.${id})`)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('transmittals')
      .select('*, clients(name)')
      .eq('entity_id', relatedEntityId)
      .eq('linked_task_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  const validInvoices = await filterValidProjectRecords(invoices || [], {
    user: effectiveCaller,
    entityId: relatedEntityId,
    concernedWrIds: [wr.id],
  });
  const validDisbursements = await filterValidProjectRecords(disbursements || [], {
    user: effectiveCaller,
    entityId: relatedEntityId,
    concernedWrIds: [wr.id],
  });
  const validTransmittals = await filterValidProjectRecords(transmittals || [], {
    user: effectiveCaller,
    entityId: relatedEntityId,
    concernedWrIds: [wr.id],
  });

  const mappedInvoices = (validInvoices || []).map((inv) => ({
    ...inv,
    invoiceNumber: inv.invoice_number || inv.invoiceNumber || null,
    invoice_number: inv.invoice_number || inv.invoiceNumber || null,
  }));
  const mappedDisbursements = (validDisbursements || []).map((disb) => ({
    ...disb,
    disbursementNumber: disb.disbursement_number || disb.disbursementNumber || null,
    disbursement_number: disb.disbursement_number || disb.disbursementNumber || null,
  }));
  const mappedTransmittals = (validTransmittals || []).map((trk) => {
    const trkNum = trk.tracking_number || trk.transmittal_number || trk.trackingNumber || null;
    return {
      ...trk,
      trackingNumber: trkNum,
      tracking_number: trkNum,
    };
  });

  return {
    invoices: mappedInvoices,
    disbursements: mappedDisbursements,
    transmittals: mappedTransmittals,
  };
};

// ============================================================
// Retainer Templates
// ============================================================

const listRetainerTemplates = async ({ entityId, type, user }) => {
  const isPrivileged = user?.role === 'Admin' || user?.role === 'Manager';
  const requestedType = type ? String(type).toLowerCase() : null;

  if (requestedType === 'retainer' && !isPrivileged) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only Admin and Managers can access retainer templates',
    });
  }

  let query = supabaseAdmin
    .from('retainer_templates')
    .select('*, entities(code), clients(name)')
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  if (requestedType) {
    query = query.eq('template_type', requestedType);
  } else if (!isPrivileged) {
    query = query.eq('template_type', 'other');
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list retainer templates',
    });
  }

  return (data || []).map((t) => ({
    ...t,
    entity: t.entities?.code || (t.entity && t.entity.length <= 4 ? t.entity : null),
  }));
};

const createRetainerTemplate = async ({ entityId, userId, data }) => {
  const templateType = data.templateType || data.template_type || 'retainer';
  const isOther = templateType === 'other';

  const row = {
    entity_id: entityId,
    name: data.title || data.name,
    description: data.description || null,
    template_type: templateType,
    client_id: isOther ? null : (data.clientId || data.client_id || null),
    schedule: isOther ? null : (data.schedule || null),
    priority: data.priority || 'Normal',
    pf_amount: isOther ? 0 : (data.pfAmount ?? data.pf_amount ?? 0),
    recurrence: isOther ? 'none' : (data.recurrence || 'none'),
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

  return {
    ...template,
    entity: template.entities?.code || (template.entity && template.entity.length <= 4 ? template.entity : null),
  };
};

const updateRetainerTemplate = async ({ entityId, id, data }) => {
  const updates = { updated_at: new Date().toISOString() };

  if (data.templateType !== undefined) updates.template_type = data.templateType;
  else if (data.template_type !== undefined) updates.template_type = data.template_type;
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

  return {
    ...updated,
    entity: updated.entities?.code || (updated.entity && updated.entity.length <= 4 ? updated.entity : null),
  };
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

  const isPrivileged = user?.role === 'Admin' || user?.role === 'Manager';
  if (template.template_type !== 'other' && !isPrivileged) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only Admin and Managers can generate from retainer templates',
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

  // 1. Enforce mandatory overrides.assignedTo (falling back to template configuration)
  const assignedTo =
    overrides.assignedTo ||
    overrides.assigned_to ||
    template.assigned_to ||
    template.assignedTo ||
    null;
  if (!assignedTo) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'MANAGER_REQUIRED',
      detail: 'Manager (assignedTo) is required to generate work requests.',
    });
  }

  // 2. Validate Project Team Roles
  const rawCo =
    overrides.coAssignees ||
    overrides.co_assignees ||
    template.coAssignees ||
    template.co_assignees ||
    [];
  const coAssignees = Array.isArray(rawCo) ? rawCo : [];
  await validateProjectTeamRoles({ assignedTo, coAssignees, rejectAdminCoAssignees: true });

  // 3. Strict Task Assignee Scoping Validation
  const projectTeam = new Set([assignedTo, ...coAssignees].filter(Boolean));

  const preProcessingTasks = [];
  const processingTasks = [];

  const templateTasks = Array.isArray(template.tasks) ? template.tasks : [];
  const templateTaskMap = new Map();
  templateTasks.forEach((t, idx) => {
    const localId = t.local_id || t.localId || t.id || `tpl_t_${idx + 1}`;
    templateTaskMap.set(localId, t);
  });

  const overrideTaskMap = new Map();
  if (Array.isArray(overrides.tasks)) {
    overrides.tasks.forEach((ot) => {
      const id = ot.local_id || ot.localId || ot.id;
      if (id) {
        overrideTaskMap.set(id, ot);
      }
    });
  }

  let sourceTasks = [];
  if (Array.isArray(overrides.tasks) && overrides.tasks.length > 0) {
    const processedOverrideIds = new Set();
    templateTasks.forEach((t, idx) => {
      const localId = t.local_id || t.localId || t.id || `tpl_t_${idx + 1}`;
      const ov = overrideTaskMap.get(localId);
      if (ov) {
        processedOverrideIds.add(localId);
        sourceTasks.push({ ...t, ...ov, local_id: localId });
      } else {
        sourceTasks.push({ ...t, local_id: localId });
      }
    });
    overrides.tasks.forEach((ot, idx) => {
      const id = ot.local_id || ot.localId || ot.id || `ov_t_${idx + 1}`;
      if (!processedOverrideIds.has(id)) {
        sourceTasks.push({ ...ot, local_id: id });
      }
    });
  } else {
    sourceTasks = templateTasks.map((t, idx) => ({
      ...t,
      local_id: t.local_id || t.localId || t.id || `tpl_t_${idx + 1}`,
    }));
  }

  sourceTasks.forEach((t, idx) => {
    const localId = t.local_id || t.localId || t.id || `tpl_t_${idx + 1}`;
    const base = templateTaskMap.get(localId) || {};
    const title = t.title || base.title || '';
    const description = t.description !== undefined ? t.description : (base.description || null);
    const phase = t.phase || base.phase || 'pre_processing';
    const dependsOn =
      t.depends_on ??
      t.dependsOn ??
      base.depends_on_local_id ??
      base.dependsOnLocalId ??
      base.depends_on ??
      base.dependsOn ??
      (Array.isArray(base.predecessors) && base.predecessors.length > 0 ? base.predecessors[0] : null);
    const dueDate = t.dueDate || t.due_date || base.dueDate || base.due_date || null;

    let rawAssignees = t.assignees;
    if (rawAssignees === undefined) {
      rawAssignees =
        base.default_assignees ||
        base.defaultAssignees ||
        base.assignees ||
        [
          ...(base.assigneeId ? [base.assigneeId] : []),
          ...(base.assigned_to ? [base.assigned_to] : []),
          ...(Array.isArray(base.coAssignees) ? base.coAssignees : []),
          ...(Array.isArray(base.co_assignees) ? base.co_assignees : []),
        ];
    }
    const assignees = Array.isArray(rawAssignees)
      ? Array.from(new Set(rawAssignees.filter(Boolean)))
      : [];

    for (const assigneeId of assignees) {
      if (!projectTeam.has(assigneeId)) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          code: 'TASK_ASSIGNEE_NOT_IN_TEAM',
          detail: `Task assignee ${assigneeId} does not belong to the selected project team.`,
        });
      }
    }

    const taskObj = {
      local_id: localId,
      title,
      description,
      assignees,
      depends_on: dependsOn || null,
      dueDate,
      requiredLinkType:
        t.requiredLinkType !== undefined
          ? t.requiredLinkType || null
          : t.required_link_type !== undefined
            ? t.required_link_type || null
            : base.requiredLinkType || base.required_link_type || null,
      checklist: t.checklist || base.checklist || base.default_checklist || [],
    };

    if (phase === 'processing') {
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
    assignedTo,
    coAssignees,
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
      await supabaseAdmin.from('tasks').delete().eq('work_request_id', wrGraph.id);
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
    .select('id, title, status, phase, qa_status, approval_status')
    .eq('work_request_id', workRequestId)
    .is('deleted_at', null);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to fetch tasks for advancement gate check',
    });
  }

  // Phase gate (Policy R7): Any pending or rejected non-deleted task blocks phase advancement
  const unapprovedTasks = (tasks || []).filter((t) => (t.approval_status || 'approved') !== 'approved');
  if (unapprovedTasks.length > 0) {
    const list = unapprovedTasks.map((t) => `"${t.title || t.id}" (${t.approval_status || 'pending'})`).join(', ');
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Advancement gate failed: ${unapprovedTasks.length} task(s) require creation approval review: ${list}`,
      code: 'TASK_REVIEW_REQUIRED',
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
        version: (task.version || 1) + 1,
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

  if (toPhase === 'processing') {
    const hasOnlyProcessingFailures =
      failedTasks.length > 0 &&
      failedTasks.every((t) => t.phase === 'processing');

    if (!hasOnlyProcessingFailures) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail:
          'Rerouting to Processing requires at least one failed task, and every failed task must belong to Processing. Otherwise, reroute to Pre-processing.',
        code: 'FAILED_TASKS_REQUIRE_PRE_PROCESSING',
      });
    }
  }

  const now = new Date().toISOString();

  // Reopen ONLY failed tasks: status := 'In Progress', qa_status := 'none'
  for (const failedTask of failedTasks) {
    const { error: reopenErr } = await supabaseAdmin
      .from('tasks')
      .update({
        status: 'In Progress',
        qa_status: 'none',
        version: (failedTask.version || 1) + 1,
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
      version: (existing.version || 1) + 1,
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

const listCreationApprovals = async ({ entityId, user, status = 'pending', scope = 'mine', page, limit }) => {
  if (!user) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required',
    });
  }

  // Atomically verify current active actor role at list time to prevent stale memoized authority
  const { data: currentActor, error: actorErr } = await supabaseAdmin
    .from('users')
    .select('id, role, is_active, entities')
    .eq('id', user.id)
    .maybeSingle();

  if (actorErr || !currentActor || currentActor.is_active === false || (currentActor.role !== 'Admin' && currentActor.role !== 'Manager')) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only Admin and Manager roles can access creation approvals',
    });
  }

  // Managers may see own submissions only; Admins may see 'all' or 'mine'
  const effectiveScope = currentActor.role === 'Manager' ? 'mine' : (scope === 'mine' ? 'mine' : 'all');
  const validStatus = ['pending', 'rejected', 'approved'].includes(status) ? status : 'pending';

  let query = supabaseAdmin
    .from('work_requests')
    .select('*, clients(name)')
    .is('deleted_at', null)
    .eq('creation_approval_status', validStatus)
    .order('created_at', { ascending: false });

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  if (effectiveScope === 'mine') {
    query = query.or(`created_by.eq.${currentActor.id},and(created_by.is.null,requested_by.eq.${currentActor.id})`);
  }

  const { data, error } = await query;
  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list work request creation approvals',
    });
  }

  let visibleRows = data || [];
  // Admin entity entitlement filtering when in ALL view
  const allowed = [];
  for (const r of visibleRows) {
    if (await isUserEntitledToEntity(r.entity_id, currentActor)) {
      // Creator submission access must not confer ongoing project membership after admission (CONTRACT R2).
      // For approved rows, require ordinary membership before returning current details/children.
      if (validStatus === 'approved' && currentActor.role !== 'Admin') {
        const isMember = await isUserMemberOfWorkRequest(r.id, currentActor, { entityId: r.entity_id });
        if (!isMember) {
          continue;
        }
      }
      allowed.push(r);
    }
  }
  visibleRows = allowed;

  const isPaginated = page !== undefined || limit !== undefined;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const resultRows = isPaginated
    ? visibleRows.slice((pageNum - 1) * limitNum, pageNum * limitNum)
    : visibleRows;

  const wrIds = resultRows.map((r) => r.id);
  const taskMap = await loadTasksForWorkRequests(wrIds);
  const leadMap = await loadManagerLeadMap(resultRows);

  const formatted = await Promise.all(
    resultRows.map(async (row) => {
      const code = await resolveEntityCode(row.entity_id);
      const wr = toApiWorkRequest(row, code, user, leadMap.get(row.id));
      const taskRows = (taskMap && taskMap.get(row.id)) || [];
      const extras = await loadTaskExtras(taskRows.map((t) => t.id));
      wr.tasks = taskRows.map((t) =>
        toApiTask(t, {
          checklist: extras.checklist.get(t.id) || [],
          timeLogs: extras.timeLogs.get(t.id) || [],
          taskDocuments: extras.taskDocuments.get(t.id) || [],
          hasDocuments: extras.documentTaskIds.has(t.id),
          assignees: extras.assignees ? extras.assignees.get(t.id) || [] : [],
          taskAssignees: extras.taskAssignees ? extras.taskAssignees.get(t.id) || [] : [],
          predMap: extras.predMap || new Map(),
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
      return wr;
    })
  );

  return {
    data: formatted,
    meta: {
      total: visibleRows.length,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(visibleRows.length / limitNum) || 1,
    },
  };
};

const decideWorkRequestCreationApproval = async ({ id, entityId, decision, reason, expectedVersion, user }) => {
  if (!user || user.role !== 'Admin') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Admin access required to approve or reject work requests',
    });
  }

  // Atomically verify current active actor role at decision time to protect against concurrent role revoking
  const { data: currentActor, error: actorErr } = await supabaseAdmin
    .from('users')
    .select('id, role, is_active, entities')
    .eq('id', user.id)
    .maybeSingle();

  if (actorErr || !currentActor || currentActor.is_active === false || currentActor.role !== 'Admin') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Admin access required to approve or reject work requests',
    });
  }

  if (!['approve', 'reject'].includes(decision)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Decision must be "approve" or "reject"',
    });
  }

  if (decision === 'reject' && (!reason || typeof reason !== 'string' || reason.trim().length === 0)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Reason is required when rejecting a work request',
    });
  }

  // Fetch WR
  let query = supabaseAdmin
    .from('work_requests')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data: wr, error } = await query.maybeSingle();
  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to retrieve work request' });
  }
  if (!wr) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  // Entitlement
  const entitled = await isUserEntitledToEntity(wr.entity_id, currentActor);
  if (!entitled) {
    throw new AppError({ statusCode: 403, title: 'Forbidden', detail: 'Not entitled to work request entity' });
  }

  if (wr.creation_approval_status !== 'pending') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Work request is already ${wr.creation_approval_status}`,
      code: 'INVALID_APPROVAL_STATE',
    });
  }

  const currentVersion = wr.version || 1;
  if (expectedVersion === undefined || expectedVersion === null || !Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) <= 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'expectedVersion is required and must be a positive integer',
      code: 'CONCURRENT_MODIFICATION',
    });
  }
  if (Number(expectedVersion) !== currentVersion) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Work request was modified concurrently. Please reload.',
      code: 'CONCURRENT_MODIFICATION',
    });
  }

  const now = new Date().toISOString();
  const nextVersion = currentVersion + 1;
  const newStatus = decision === 'approve' ? 'approved' : 'rejected';
  const cleanReason = decision === 'reject' ? reason.trim() : null;

  const updateResult = await supabaseAdmin
    .from('work_requests')
    .update({
      creation_approval_status: newStatus,
      reviewed_by: user.id,
      reviewed_at: now,
      rejection_reason: cleanReason,
      version: nextVersion,
      updated_at: now,
    })
    .eq('id', id)
    .eq('version', Number(expectedVersion))
    .eq('creation_approval_status', 'pending')
    .is('deleted_at', null)
    .select();

  if (updateResult.error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to update work request approval' });
  }

  if (!updateResult.data || updateResult.data.length === 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Work request was modified or decided concurrently. Please reload.',
      code: 'CONCURRENT_MODIFICATION',
    });
  }

  await auditService.log({
    action: decision === 'approve' ? 'work_request.creation_approved' : 'work_request.creation_rejected',
    table: 'work_requests',
    recordId: id,
    entity: wr.entity_id,
    userId: user.id,
    details: { decision, reason: cleanReason, version: nextVersion },
  });

  // Notify creator
  const creatorId = getCanonicalCreatorId(wr);
  if (creatorId) {
    try {
      await notify([creatorId], 'pending_request.resolved', {
        work_request_id: id,
        wr_title: wr.title,
        decision,
        reason: cleanReason,
        reviewed_by: user.id,
      });
    } catch (_e) {
      // Notification errors must not fail business flow
    }
  }

  return getWorkRequestById({ id, entityId: wr.entity_id, user, allowPending: true, includeTasks: true });
};

const resubmitWorkRequestCreation = async ({ id, entityId, expectedVersion, data: editData, user }) => {
  if (!user) {
    throw new AppError({ statusCode: 401, title: 'Unauthorized', detail: 'Authentication required' });
  }

  // Verify current active actor at decision time to protect against concurrent account deactivation
  const { data: currentActor, error: actorErr } = await supabaseAdmin
    .from('users')
    .select('id, role, is_active, entities')
    .eq('id', user.id)
    .maybeSingle();

  if (actorErr || !currentActor || currentActor.is_active === false) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Active account required to resubmit work requests',
      code: 'INACTIVE_USER',
    });
  }

  let query = supabaseAdmin
    .from('work_requests')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data: wr, error } = await query.maybeSingle();
  if (error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to retrieve work request' });
  }
  if (!wr) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found' });
  }

  // Entitlement
  const entitled = await isUserEntitledToEntity(wr.entity_id, currentActor);
  if (!entitled) {
    throw new AppError({ statusCode: 403, title: 'Forbidden', detail: 'Not entitled to work request entity' });
  }

  // Creator check (strict canonical created_by with fallback to requested_by only if created_by is null)
  const isCreator = isCreatorUser(currentActor, wr);
  if (!isCreator) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only the creator may resubmit this work request',
    });
  }

  if (wr.creation_approval_status !== 'rejected') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Only rejected work requests can be resubmitted (current status: ${wr.creation_approval_status})`,
      code: 'INVALID_APPROVAL_STATE',
    });
  }

  const currentVersion = wr.version || 1;
  if (expectedVersion === undefined || expectedVersion === null || !Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) <= 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'expectedVersion is required and must be a positive integer',
      code: 'CONCURRENT_MODIFICATION',
    });
  }
  if (Number(expectedVersion) !== currentVersion) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Work request was modified concurrently. Please reload.',
      code: 'CONCURRENT_MODIFICATION',
    });
  }

  const now = new Date().toISOString();
  const nextVersion = currentVersion + 1;
  const updates = {
    creation_approval_status: 'pending',
    rejection_reason: null,
    reviewed_by: null,
    reviewed_at: null,
    version: nextVersion,
    updated_at: now,
  };

  if (editData && typeof editData === 'object') {
    if (editData.title !== undefined) updates.title = editData.title.trim();
    if (editData.description !== undefined) updates.description = editData.description;
    if (editData.priority !== undefined) updates.priority = editData.priority;

    if (editData.dueDate !== undefined) {
      const dueDateResult = workRequestDueDateSchema.safeParse(editData.dueDate);
      if (!dueDateResult.success) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          code: 'VALIDATION_ERROR',
          detail: `dueDate: ${dueDateResult.error.issues[0].message}`,
        });
      }
      updates.due_date = editData.dueDate;
    }

    if (editData.clientId !== undefined) {
      if (editData.clientId) {
        await validateWorkRequestClientEntity(editData.clientId, wr.entity_id);
      }
      updates.client_id = editData.clientId || null;
    }

    if (editData.assignedTo !== undefined || editData.coAssignees !== undefined) {
      const targetAssignedTo = editData.assignedTo !== undefined ? editData.assignedTo : wr.assigned_to;
      const targetCoAssignees = editData.coAssignees !== undefined ? editData.coAssignees : wr.co_assignees;
      await validateProjectTeamRoles({
        assignedTo: targetAssignedTo,
        coAssignees: targetCoAssignees,
      });
      if (editData.assignedTo !== undefined) updates.assigned_to = editData.assignedTo;
      if (editData.coAssignees !== undefined) updates.co_assignees = editData.coAssignees;
    }
  }

  const updateResult = await supabaseAdmin
    .from('work_requests')
    .update(updates)
    .eq('id', id)
    .eq('version', Number(expectedVersion))
    .eq('creation_approval_status', 'rejected')
    .is('deleted_at', null)
    .select();

  if (updateResult.error) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to resubmit work request' });
  }

  if (!updateResult.data || updateResult.data.length === 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Work request was modified or resubmitted concurrently. Please reload.',
      code: 'CONCURRENT_MODIFICATION',
    });
  }

  await auditService.log({
    action: 'work_request.creation_resubmitted',
    table: 'work_requests',
    recordId: id,
    entity: wr.entity_id,
    userId: user.id,
    details: { version: nextVersion },
  });

  return getWorkRequestById({ id, entityId: wr.entity_id, user, allowPending: true, includeTasks: true });
};

const mapTaskReviewRpcError = (error, defaultMsg = 'Task review error') => {
  const msg = error?.message || '';
  const code = error?.code || '';
  if (msg.includes('TASK_REVIEW_FORBIDDEN') || code === '42501') {
    return new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Manager lead access required to review task creation',
      code: 'TASK_REVIEW_FORBIDDEN',
    });
  }
  if (msg.includes('MANAGER_LEAD_REQUIRED')) {
    return new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'Work request must have an assigned Manager lead before tasks can be added by team members.',
      code: 'MANAGER_LEAD_REQUIRED',
    });
  }
  if (msg.includes('COMPLETED_WR_LOCKED')) {
    return new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Completed Work Requests are locked: tasks cannot be added to a completed request.',
      code: 'COMPLETED_WR_LOCKED',
    });
  }
  if (msg.includes('TASK_REVIEW_CONFLICT') || msg.includes('CONCURRENT_MODIFICATION')) {
    return new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Task was modified concurrently. Please reload.',
      code: 'TASK_REVIEW_CONFLICT',
    });
  }
  if (msg.includes('TASK_REVIEW_STATE') || msg.includes('INVALID_APPROVAL_STATE')) {
    return new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Task is not in a valid state for this action',
      code: 'TASK_REVIEW_STATE',
    });
  }
  if (msg.includes('TASK_REJECTED_LOCKED')) {
    return new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Task is rejected and locked against direct modification. Use resubmit-creation to submit corrections.',
      code: 'TASK_REJECTED_LOCKED',
    });
  }
  if (msg.includes('TASK_REVIEW_REQUIRED')) {
    return new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'All tasks must be approved before advancing phase or completing work request',
      code: 'TASK_REVIEW_REQUIRED',
    });
  }
  if (msg.includes('TASK_NOT_FOUND')) {
    return new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Task not found',
      code: 'TASK_NOT_FOUND',
    });
  }
  if (msg.includes('WORK_REQUEST_NOT_FOUND')) {
    return new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Work request not found',
      code: 'WORK_REQUEST_NOT_FOUND',
    });
  }
  if (msg.includes('REASON_REQUIRED')) {
    return new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Reason is required when rejecting a task',
      code: 'REASON_REQUIRED',
    });
  }
  if (msg.includes('INVALID_DECISION')) {
    return new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Decision must be "approve" or "reject"',
      code: 'INVALID_DECISION',
    });
  }
  return new AppError({
    statusCode: 400,
    title: 'Error',
    detail: msg || defaultMsg,
    code: code || 'DATABASE_ERROR',
  });
};

const decideTaskCreationApproval = async ({
  workRequestId,
  taskId,
  entityId,
  decision,
  reason,
  expectedVersion,
  user,
}) => {
  if (!user || user.role === 'Admin') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Admins cannot decide task creation reviews; only the assigned Manager lead may review tasks',
      code: 'TASK_REVIEW_FORBIDDEN',
    });
  }
  if (user.role !== 'Manager') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only the assigned Manager lead may review tasks',
      code: 'TASK_REVIEW_FORBIDDEN',
    });
  }

  // Atomically verify current active actor role at decision time to protect against concurrent role revoking
  const { data: currentActor, error: actorErr } = await supabaseAdmin
    .from('users')
    .select('id, role, is_active, entities')
    .eq('id', user.id)
    .maybeSingle();

  if (actorErr || !currentActor || currentActor.is_active === false || currentActor.role !== 'Manager') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only active Manager leads may review tasks',
      code: 'TASK_REVIEW_FORBIDDEN',
    });
  }

  let effectiveWrId = workRequestId;
  if (!effectiveWrId) {
    const { data: t } = await supabaseAdmin
      .from('tasks')
      .select('work_request_id')
      .eq('id', taskId)
      .maybeSingle();
    effectiveWrId = t?.work_request_id;
  }

  if (!effectiveWrId) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found', code: 'WORK_REQUEST_NOT_FOUND' });
  }

  // Fetch parent WR
  let wrQuery = supabaseAdmin
    .from('work_requests')
    .select('id, entity_id, status, phase, assigned_to, creation_approval_status')
    .eq('id', effectiveWrId)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    wrQuery = wrQuery.eq('entity_id', entityId);
  }

  const { data: wr, error: wrErr } = await wrQuery.maybeSingle();
  if (wrErr) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to retrieve work request' });
  }
  if (!wr) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found', code: 'WORK_REQUEST_NOT_FOUND' });
  }
  if (wr.creation_approval_status && wr.creation_approval_status !== 'approved') {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found', code: 'WORK_REQUEST_NOT_FOUND' });
  }

  // Strict Lead check: only assigned_to Manager may decide
  if (wr.assigned_to !== currentActor.id) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only the assigned Manager lead may review tasks on this work request',
      code: 'TASK_REVIEW_FORBIDDEN',
    });
  }

  // Entitlement
  const entitled = await isUserEntitledToEntity(wr.entity_id, currentActor);
  if (!entitled) {
    throw new AppError({ statusCode: 403, title: 'Forbidden', detail: 'Not entitled to work request entity', code: 'TASK_REVIEW_FORBIDDEN' });
  }

  if (!['approve', 'reject'].includes(decision)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Decision must be "approve" or "reject"',
      code: 'INVALID_DECISION',
    });
  }

  if (decision === 'reject' && (!reason || typeof reason !== 'string' || reason.trim().length === 0)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Reason is required when rejecting a task',
      code: 'REASON_REQUIRED',
    });
  }

  // Fetch task
  const { data: task, error: taskErr } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('work_request_id', effectiveWrId)
    .is('deleted_at', null)
    .maybeSingle();

  if (taskErr) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to retrieve task' });
  }
  if (!task) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found', code: 'TASK_NOT_FOUND' });
  }

  const currentStatus = task.approval_status || 'approved';
  if (currentStatus !== 'pending') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Task is already ${currentStatus}`,
      code: 'TASK_REVIEW_STATE',
    });
  }

  const currentVersion = task.version || 1;
  if (expectedVersion === undefined || expectedVersion === null || !Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) <= 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'expectedVersion is required and must be a positive integer',
      code: 'TASK_REVIEW_CONFLICT',
    });
  }
  if (Number(expectedVersion) !== currentVersion) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Task was modified concurrently. Please reload.',
      code: 'TASK_REVIEW_CONFLICT',
    });
  }

  const rpcResult = await supabaseAdmin.rpc('task_creation_review_decide', {
    p_task_id: taskId,
    p_work_request_id: effectiveWrId,
    p_entity_id: wr.entity_id,
    p_actor_id: user.id,
    p_expected_version: Number(expectedVersion),
    p_decision: decision,
    p_reason: decision === 'reject' ? reason.trim() : null,
  });

  if (rpcResult.error) {
    throw mapTaskReviewRpcError(rpcResult.error, 'Failed to decide task creation approval');
  }

  const cleanReason = decision === 'reject' ? reason.trim() : null;
  const nextVersion = currentVersion + 1;

  await auditService.log({
    action: decision === 'approve' ? 'task.creation_approved' : 'task.creation_rejected',
    table: 'tasks',
    recordId: taskId,
    entity: wr.entity_id,
    userId: user.id,
    details: { decision, reason: cleanReason, version: nextVersion, workRequestId: effectiveWrId },
  });

  const creatorId = getCanonicalCreatorId(task);
  if (creatorId) {
    try {
      await notify([creatorId], 'pending_request.resolved', {
        task_id: taskId,
        work_request_id: effectiveWrId,
        task_title: task.title,
        decision,
        reason: cleanReason,
        reviewed_by: user.id,
      });
    } catch (_e) {
      // Notification errors must not fail business flow
    }
  }

  return getTaskById({ taskId, workRequestId: effectiveWrId, entityId: wr.entity_id, user });
};

const resubmitTaskCreation = async ({
  workRequestId,
  taskId,
  entityId,
  expectedVersion,
  data: editData,
  user,
}) => {
  if (!user) {
    throw new AppError({ statusCode: 401, title: 'Unauthorized', detail: 'Authentication required' });
  }

  const allowedFields = new Set([
    'title',
    'description',
    'dueDate',
    'assigneeId',
    'assignees',
    'predecessors',
    'requiredLinkType',
  ]);
  if (editData && typeof editData === 'object') {
    for (const key of Object.keys(editData)) {
      if (!allowedFields.has(key)) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          detail: `Unsupported field in task resubmission: ${key}. Resubmission only permits title, description, dueDate, assigneeId, assignees, predecessors, and requiredLinkType.`,
          code: 'UNSUPPORTED_RESUBMISSION_FIELD',
        });
      }
    }
  }

  let effectiveWrId = workRequestId;
  if (!effectiveWrId) {
    const { data: t } = await supabaseAdmin
      .from('tasks')
      .select('work_request_id')
      .eq('id', taskId)
      .maybeSingle();
    effectiveWrId = t?.work_request_id;
  }

  if (!effectiveWrId) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found', code: 'WORK_REQUEST_NOT_FOUND' });
  }

  // Fetch parent WR
  let wrQuery = supabaseAdmin
    .from('work_requests')
    .select('id, entity_id, status, phase, creation_approval_status')
    .eq('id', effectiveWrId)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    wrQuery = wrQuery.eq('entity_id', entityId);
  }

  const { data: wr, error: wrErr } = await wrQuery.maybeSingle();
  if (wrErr) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to retrieve work request' });
  }
  if (!wr) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found', code: 'WORK_REQUEST_NOT_FOUND' });
  }
  if (wr.creation_approval_status && wr.creation_approval_status !== 'approved') {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Work request not found', code: 'WORK_REQUEST_NOT_FOUND' });
  }

  // Fetch task
  const { data: task, error: taskErr } = await supabaseAdmin
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('work_request_id', effectiveWrId)
    .is('deleted_at', null)
    .maybeSingle();

  if (taskErr) {
    throw new AppError({ statusCode: 500, title: 'Database Error', detail: 'Failed to retrieve task' });
  }
  if (!task) {
    throw new AppError({ statusCode: 404, title: 'Not Found', detail: 'Task not found', code: 'TASK_NOT_FOUND' });
  }

  // Verify current active actor to ensure authorization freshness
  const { data: currentActor, error: actorErr } = await supabaseAdmin
    .from('users')
    .select('id, role, is_active, entities')
    .eq('id', user.id)
    .maybeSingle();

  if (actorErr || !currentActor || currentActor.is_active === false) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Active account required to resubmit task creation',
      code: 'TASK_REVIEW_FORBIDDEN',
    });
  }

  // Strict creator check
  const isCreator = isCreatorUser(currentActor, task);
  if (!isCreator) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only the creator may resubmit this task',
      code: 'TASK_REVIEW_FORBIDDEN',
    });
  }

  if (task.approval_status !== 'rejected') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Only rejected tasks can be resubmitted (current status: ${task.approval_status || 'approved'})`,
      code: 'TASK_REVIEW_STATE',
    });
  }

  const currentVersion = task.version || 1;
  if (expectedVersion === undefined || expectedVersion === null || !Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) <= 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'expectedVersion is required and must be a positive integer',
      code: 'TASK_REVIEW_CONFLICT',
    });
  }
  if (Number(expectedVersion) !== currentVersion) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Task was modified concurrently. Please reload.',
      code: 'TASK_REVIEW_CONFLICT',
    });
  }

  // Validate predecessors if provided
  if (editData?.predecessors && Array.isArray(editData.predecessors) && editData.predecessors.length > 0) {
    const predIds = editData.predecessors.filter(isValidUUID);
    const { data: predTasks, error: predErr } = await supabaseAdmin
      .from('tasks')
      .select('id, work_request_id')
      .in('id', predIds)
      .eq('work_request_id', effectiveWrId)
      .is('deleted_at', null);

    if (predErr || !predTasks || predTasks.length !== predIds.length) {
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        detail: 'One or more predecessor tasks do not exist or belong to another work request',
        code: 'INVALID_PREDECESSORS',
      });
    }
  }

  // Call RPC
  const rpcResult = await supabaseAdmin.rpc('task_creation_review_resubmit', {
    p_task_id: taskId,
    p_work_request_id: effectiveWrId,
    p_entity_id: wr.entity_id,
    p_actor_id: user.id,
    p_expected_version: Number(expectedVersion),
    p_data: editData || {},
  });

  if (rpcResult.error) {
    throw mapTaskReviewRpcError(rpcResult.error, 'Failed to resubmit task creation');
  }

  // Update task_assignees join table if explicit assignees passed
  if (editData && Array.isArray(editData.assignees)) {
    await supabaseAdmin.from('task_assignees').delete().eq('task_id', taskId);
    const uniqueAssignees = [...new Set(editData.assignees.filter(isValidUUID))];
    if (uniqueAssignees.length) {
      const now = new Date().toISOString();
      await supabaseAdmin.from('task_assignees').insert(uniqueAssignees.map((userId) => ({
        id: randomUUID(),
        task_id: taskId,
        user_id: userId,
        assigned_by: user.id,
        assigned_at: now,
        created_at: now,
      })));
    }
  }

  const nextVersion = currentVersion + 1;
  await auditService.log({
    action: 'task.creation_resubmitted',
    table: 'tasks',
    recordId: taskId,
    entity: wr.entity_id,
    userId: user.id,
    details: { version: nextVersion, workRequestId: effectiveWrId },
  });

  return getTaskById({ taskId, workRequestId: effectiveWrId, entityId: wr.entity_id, user });
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
  listCreationApprovals,
  decideWorkRequestCreationApproval,
  resubmitWorkRequestCreation,
  decideTaskCreationApproval,
  resubmitTaskCreation,
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  removeTask: deleteTask,
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
  checkHasManagerLead,
  validateProjectTeamRoles,
  loadTasksForWorkRequests,
  canViewWorkRequest,
  VALID_TRANSITIONS,
  PHASE_SEQUENCE,
  PHASE_STATUS_MAP,
};
