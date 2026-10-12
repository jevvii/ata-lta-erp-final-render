/**
 * Disbursements service.
 * Business logic for disbursement management with approval workflow.
 *
 * Status flow: Draft → Pending → Approved → Released
 *              (Rejected branches from Pending or Approved)
 *
 * Phase 6 — Agent B
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');
const { concurrencyConflict, resolveExpectedVersion } = require('../../lib/concurrency');
const { buildPermissionSet, hasPermission } = require('../../lib/permissions');
const { resolveEntityCode } = require('../../lib/entityResolver');

/** Valid status transitions */
const VALID_TRANSITIONS = {
  submit: { from: ['Draft'], to: 'Submitted' },
  forward_admin: { from: ['Submitted', 'Pending'], to: 'Pending Admin Approval' },
  approve: { from: ['Pending Admin Approval', 'Submitted', 'Pending', 'Draft'], to: 'Released' },
  release: { from: ['Approved', 'Pending Admin Approval'], to: 'Released' },
  fund: { from: ['Released'], to: 'Funded' },
  reject: { from: ['Submitted', 'Pending', 'Pending Admin Approval', 'Draft'], to: 'Rejected' },
};

/**
 * Non-blocking notification dispatch helper (P0-B / Rule R5).
 * Swallows any error to preserve caller operation success.
 */
const safeNotify = async (userIds, type, payload) => {
  try {
    let notifyModule = null;
    try {
      notifyModule = require('../../services/notify');
    } catch (_err) {
      notifyModule = null;
    }

    if (notifyModule && typeof notifyModule.notify === 'function') {
      await notifyModule.notify(userIds, type, payload);
    }
  } catch (err) {
    // Non-blocking: swallow error per Rule R5 / P0-B R3
    // eslint-disable-next-line no-console
    console.warn('[NOTIFY] Failed to dispatch notification:', err?.message || err);
  }
};

/**
 * Generate a disbursement number.
 * Format: DISB-{ENTITY_CODE}-{YYYYMMDD}-{seq}
 *
 * Allocation is delegated to the next_document_sequence() RPC (migration
 * 000047, Spec 2.4 / R-11), whose single-statement upsert takes a row lock on
 * the daily prefix, so concurrent creators can never read the same count and
 * collide. The previous count(*)+1 approach raced under parallel submits.
 *
 * @param {string} _entityId - UUID of the entity (kept for signature stability)
 * @param {string} entityCode - entity code (ATA or LTA)
 * @returns {Promise<string>}
 */
const generateDisbursementNumber = async (_entityId, entityCode) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `DISB-${entityCode}-${today}`;

  const { data, error } = await supabaseAdmin.rpc('next_document_sequence', {
    p_prefix: prefix,
  });

  if (error || !data) {
    throw new AppError({
      statusCode: 500,
      title: 'Sequence Error',
      detail: 'Failed to allocate a disbursement number',
    });
  }

  return data;
};

// ============================================================
// Counts for tab badges (no full-table scans)
// ============================================================

/**
 * Count disbursements grouped for module tab badges.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<{ active: number, archived: number, rejected: number }>}
 */
const VALID_ENTITY_CODES = ['ATA', 'LTA'];

const getDisbursementCounts = async ({ entityId, user }) => {
  const resolve = async (code) => {
    const { data } = await supabaseAdmin
      .from('entities')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    return data?.id;
  };

  const entityIds = [];
  if (entityId === 'ALL') {
    const codes = (user?.entities || []).filter((c) =>
      VALID_ENTITY_CODES.includes(c.toUpperCase())
    );
    const resolved = await Promise.all(codes.map(resolve));
    entityIds.push(...resolved.filter(Boolean));
  } else {
    entityIds.push(entityId);
  }

  if (entityIds.length === 0) {
    return { active: 0, archived: 0, rejected: 0, awaitingRelease: 0 };
  }

  const isAdmin = user?.role === 'Admin';
  const isAccounting =
    (user?.departments || []).includes('Accounting') || user?.role === 'Accounting';
  let concernedWrIds = [];
  if (!isAdmin && !isAccounting) {
    const { getUserConcernedWorkRequestIds } = require('../../lib/userScope');
    concernedWrIds = await getUserConcernedWorkRequestIds(user);
    if (concernedWrIds.length === 0) {
      return { active: 0, archived: 0, rejected: 0, awaitingRelease: 0 };
    }
  }

  const runCount = async (query) => {
    const { count, error } = await query;
    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to count disbursements',
      });
    }
    return count || 0;
  };

  const baseQuery = () => {
    let q = supabaseAdmin
      .from('disbursements')
      .select('*', { count: 'exact', head: true })
      .in('entity_id', entityIds)
      .is('deleted_at', null);
    if (!isAdmin && !isAccounting) {
      q = q.in('linked_work_request_id', concernedWrIds);
    }
    return q;
  };

  const canRelease = (() => {
    if (!user) return false;
    const permissions = buildPermissionSet({
      role: user.role || '',
      departments: user.departments || [],
    });
    return hasPermission(permissions, 'disbursement:mark_released');
  })();

  let activeQuery = baseQuery().neq('archived', true).neq('status', 'Cancelled');
  if (!isAdmin && !isAccounting) {
    activeQuery = activeQuery.in('status', ['Released', 'Funded', 'Rejected']);
  }

  const [active, archivedCount, cancelledCount, pendingRejected, opsRejected, awaitingRelease] =
    await Promise.all([
      runCount(activeQuery),
      runCount(baseQuery().eq('archived', true)),
      runCount(baseQuery().eq('status', 'Cancelled').eq('archived', false)),
      runCount(
        supabaseAdmin
          .from('pending_changes')
          .select('*', { count: 'exact', head: true })
          .in('entity_id', entityIds)
          .eq('table_name', 'disbursements')
          .eq('status', 'rejected')
      ),
      runCount(
        (() => {
          let q = supabaseAdmin
            .from('operations_requests')
            .select('*', { count: 'exact', head: true })
            .in('entity_id', entityIds)
            .eq('type', 'disbursement')
            .eq('status', 'rejected');
          if (!isAdmin && !isAccounting) {
            q = q.in('work_request_id', concernedWrIds);
          }
          return q;
        })()
      ),
      canRelease
        ? runCount(baseQuery().eq('status', 'Approved').eq('archived', false))
        : Promise.resolve(0),
    ]);

  const archived = archivedCount + cancelledCount;
  const rejected = pendingRejected + opsRejected;

  return {
    active: Math.max(active, 0),
    archived,
    rejected,
    awaitingRelease,
  };
};

/**
 * Enrich disbursement rows with human-readable names and parent work request info (Task A.4).
 * @param {object[]} rows
 * @returns {Promise<object[]>}
 */
const enrichDisbursementExtras = async (rows = []) => {
  if (!rows || rows.length === 0) return [];

  const wrIds = [
    ...new Set(
      rows.map((r) => r.linked_work_request_id || r.work_request_id).filter(Boolean)
    ),
  ];
  const userIds = [
    ...new Set(
      rows
        .flatMap((r) => [
          r.employee_id,
          r.requested_by,
          r.created_by,
          r.approved_by,
          r.released_by,
          r.rejected_by,
          r.payment_processed_by,
        ])
        .filter(Boolean)
    ),
  ];

  let wrMap = new Map();
  if (wrIds.length > 0) {
    const { data: wrs } = await supabaseAdmin
      .from('work_requests')
      .select('id, title, work_order_number')
      .in('id', wrIds);
    wrMap = new Map((wrs || []).map((w) => [w.id, w]));
  }

  let userMap = new Map();
  if (userIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name')
      .in('id', userIds);
    userMap = new Map((users || []).map((u) => [u.id, u]));
  }

  return rows.map((row) => {
    const wrId = row.linked_work_request_id || row.work_request_id;
    const wr = wrId ? wrMap.get(wrId) : null;
    const editedByAccounting = Boolean(
      row.edited_by_accounting ||
        (row.notes && row.notes.includes('Edited by Accounting'))
    );

    return {
      ...row,
      linked_work_request_name: wr?.title || null,
      linked_work_request_order_number: wr?.work_order_number || null,
      employee_name: userMap.get(row.employee_id)?.name || null,
      requested_by_name: userMap.get(row.requested_by)?.name || null,
      created_by_name: userMap.get(row.created_by)?.name || null,
      approved_by_name: userMap.get(row.approved_by)?.name || null,
      released_by_name: userMap.get(row.released_by)?.name || null,
      rejected_by_name: userMap.get(row.rejected_by)?.name || null,
      edited_by_accounting: editedByAccounting,
    };
  });
};

/**
 * List disbursements for the active entity.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.filters]
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listDisbursements = async ({ entityId, filters = {}, user }) => {
  const {
    status,
    category,
    fundSource,
    linkedTaskId,
    taskId,
    task_id,
    linkedTransmittalId,
    search,
    archived,
    page = 1,
    limit = 50,
  } = filters;
  const isArchived = archived === true || archived === 'true';

  let query = supabaseAdmin
    .from('disbursements')
    .select('*, clients(name)', { count: 'exact' })
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  if (isArchived) {
    query = query.eq('archived', true);
  } else if (archived === false || archived === 'false') {
    query = query.eq('archived', false);
  }

  // Role restriction and scoping
  const isAdmin = user?.role === 'Admin';
  const isAccounting =
    (user?.departments || []).includes('Accounting') || user?.role === 'Accounting';
  if (!isAdmin && !isAccounting) {
    // Non-admin, non-accounting staff can see:
    // 1. Released/Funded disbursements, OR
    // 2. Any disbursement where they are the creator or employee
    if (status) {
      if (['Draft', 'Pending', 'Submitted', 'Under Review', 'Approved'].includes(status)) {
        // Only return if created by or assigned to this user
        query = query.eq('status', status).or(`created_by.eq.${user.id},employee_id.eq.${user.id}`);
      } else {
        query = query.eq('status', status);
      }
    } else {
      query = query.or(`status.in.(Released,Funded,Rejected),created_by.eq.${user.id},employee_id.eq.${user.id}`);
    }
  } else {
    if (status) query = query.eq('status', status);
  }

  if (category) query = query.eq('category', category);
  if (fundSource) query = query.eq('fund_source', fundSource);
  const effectiveFilterTaskId = taskId || task_id || linkedTaskId;
  if (effectiveFilterTaskId) {
    query = query.or(`task_id.eq.${effectiveFilterTaskId},linked_task_id.eq.${effectiveFilterTaskId}`);
  }
  if (linkedTransmittalId) query = query.eq('linked_transmittal_id', linkedTransmittalId);
  if (search) {
    query = query.or(`description.ilike.%${search}%,disbursement_number.ilike.%${search}%`);
  }

  if (!isAdmin && !isAccounting) {
    const { getUserConcernedWorkRequestIds } = require('../../lib/userScope');
    const concernedWrIds = await getUserConcernedWorkRequestIds(user);
    if (concernedWrIds.length === 0) {
      return { data: [], count: 0 };
    }
    query = query.in('linked_work_request_id', concernedWrIds);
  }


  const offset = (page - 1) * limit;
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch disbursements',
    });
  }

  const rows = data || [];
  const { data: entitiesData } = rows.length
    ? await supabaseAdmin.from('entities').select('id, code')
    : { data: [] };
  const entityCodeMap = new Map((entitiesData || []).map((e) => [e.id, e.code]));

  const mapped = rows.map((row) => ({
    ...row,
    entity_code: entityCodeMap.get(row.entity_id) || row.entity_id,
  }));

  const enriched = await enrichDisbursementExtras(mapped);
  return { data: enriched, count: count || 0 };
};

/**
 * Create a new disbursement.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const createDisbursement = async ({ entityId, entityCode, userId, data }) => {
  // Reject client-supplied status forgery (AC-1, R1)
  if (data.status !== undefined && data.status !== null) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Explicit status cannot be set on creation; status forgery is prohibited',
      code: 'STATUS_FORGERY_PROHIBITED',
    });
  }

  // Determine initial status based on creator's role (AC-1)
  // Staff roles (HR, Operations, Documentation) -> 201 with 'Pending'
  // Management, Accounting, Admin -> 201 with 'Draft' (unchanged behavior)
  let isStaff = false;
  if (userId) {
    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', userId)
      .maybeSingle();

    if (userRecord) {
      const role = userRecord.role;
      if (['Operations', 'Documentation', 'HR'].includes(role)) {
        isStaff = true;
      }
    }
  }

  const initialStatus = isStaff ? 'Pending' : 'Draft';
  const MAX_RETRIES = 5;

  const effectiveTaskId = data.taskId || data.task_id || data.linkedTaskId || null;
  const effectiveWrId =
    data.linkedWorkRequestId || data.workRequestId || data.work_request_id || null;

  // Validation: Task existence & WR association (UAT2-6/12)
  if (effectiveTaskId) {
    const { data: task, error: taskErr } = await supabaseAdmin
      .from('tasks')
      .select('id, work_request_id')
      .eq('id', effectiveTaskId)
      .maybeSingle();

    if (taskErr || !task) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: `Linked task "${effectiveTaskId}" was not found`,
        code: 'TASK_NOT_FOUND',
      });
    }

    if (effectiveWrId && task.work_request_id !== effectiveWrId) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Task does not belong to work request',
        code: 'TASK_WR_MISMATCH',
      });
    }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const disbursementNumber = await generateDisbursementNumber(
      entityId,
      entityCode || entityId,
      attempt
    );

    const row = {
      disbursement_number: disbursementNumber,
      entity_id: entityId,
      category: data.category,
      description: data.description,
      amount: data.amount,
      fund_source: data.fundSource,
      status: initialStatus,
      client_id: data.clientId || null,
      employee_id: data.employeeId || null,
      linked_invoice_id: data.linkedInvoiceId || null,
      linked_work_request_id: effectiveWrId,
      linked_task_id: effectiveTaskId,
      task_id: effectiveTaskId,
      linked_transmittal_id: data.linkedTransmittalId || null,
      requested_by: userId,
      due_date: data.dueDate || null,
      notes: data.notes || null,
      receipt_s3_key: data.receiptS3Key || null,
      receipt_filename: data.receiptFilename || null,
      created_by: userId,
      updated_by: userId,
    };

    const { data: disbursement, error } = await supabaseAdmin
      .from('disbursements')
      .insert(row)
      .select()
      .single();

    if (!error) {
      await auditService.log({
        action: 'disbursement.create',
        table: 'disbursements',
        recordId: disbursement.id,
        entity: entityId,
        userId,
        details: { disbursementNumber, total: data.amount },
      });

      const entityCodeResolved = await resolveEntityCode(disbursement.entity_id);
      return { ...disbursement, entity_code: entityCodeResolved };
    }

    if (error.code !== '23505') {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to create disbursement',
      });
    }
  }

  throw new AppError({
    statusCode: 409,
    title: 'Conflict',
    detail: 'Unable to generate a unique disbursement number. Please retry.',
    code: 'DUPLICATE_DISBURSEMENT_NUMBER',
  });
};

/**
 * Get a single disbursement by ID.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<object>}
 */
const getDisbursementById = async ({ entityId, id, user }) => {
  let query = supabaseAdmin
    .from('disbursements')
    .select('*, clients(name)')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Disbursement ${id} not found`,
    });
  }

  // Role restriction
  if (user) {
    const isAdmin = user.role === 'Admin';
    const isAccounting =
      (user.departments || []).includes('Accounting') || user.role === 'Accounting';
    const isManager =
      user.role === 'Manager' || (user.departments || []).includes('Management');
    const isSelf =
      data.requested_by === user.id ||
      data.created_by === user.id ||
      data.employee_id === user.id;

    if (!isAdmin && !isAccounting) {
      if (
        !isManager &&
        !isSelf &&
        ['Draft', 'Pending', 'Submitted', 'Under Review', 'Approved'].includes(data.status)
      ) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'You do not have permission to view this disbursement in its current status.',
        });
      }

      if (!isSelf) {
        const { getUserConcernedWorkRequestIds } = require('../../lib/userScope');
        const concernedWrIds = await getUserConcernedWorkRequestIds(user);
        if (!data.linked_work_request_id || !concernedWrIds.includes(data.linked_work_request_id)) {
          throw new AppError({
            statusCode: 403,
            title: 'Forbidden',
            detail: 'You do not have permission to view this disbursement.',
          });
        }
      }
    }
  }

  const entityCode = await resolveEntityCode(data.entity_id);
  const enriched = await enrichDisbursementExtras([{ ...data, entity_code: entityCode }]);
  return enriched[0];
};

/**
 * Update a disbursement (only if status is Draft).
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const updateDisbursement = async ({ entityId, id, userId, data, user }) => {
  const existing = await getDisbursementById({ entityId, id });

  if (data.status === 'Approved' && existing.status === 'Draft') {
    return approveDisbursement({ entityId, id, userId, user });
  }

  let effectiveUser = user;
  if (!effectiveUser && userId) {
    const { data: u } = await supabaseAdmin
      .from('users')
      .select('id, name, role, departments')
      .eq('id', userId)
      .maybeSingle();
    effectiveUser = u;
  }

  const isAccountingUser =
    effectiveUser?.role === 'Accounting' ||
    (effectiveUser?.departments || []).includes('Accounting');
  const isAdminUser = effectiveUser?.role === 'Admin';

  const financialFields = ['category', 'description', 'amount', 'fundSource'];
  const isEditingFinancial = financialFields.some((f) => data[f] !== undefined);

  const contentFields = [
    'category',
    'description',
    'amount',
    'fundSource',
    'clientId',
    'employeeId',
    'linkedInvoiceId',
    'linkedWorkRequestId',
    'workRequestId',
    'work_request_id',
    'linkedTaskId',
    'taskId',
    'task_id',
    'linkedTransmittalId',
    'dueDate',
    'notes',
  ];
  const isUpdatingContent = contentFields.some((field) => data[field] !== undefined);

  const isReviewStatus = ['Draft', 'Submitted', 'Pending', 'Pending Admin Approval'].includes(
    existing.status
  );

  if (isUpdatingContent && existing.status !== 'Draft') {
    if ((isAccountingUser || isAdminUser) && isReviewStatus) {
      // Allowed for Accounting/Admin in review stages
    } else {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Cannot edit disbursement in "${existing.status}" status. Only Draft disbursements can be edited.`,
      });
    }
  }

  const effectiveTaskId =
    data.taskId !== undefined
      ? data.taskId
      : data.task_id !== undefined
      ? data.task_id
      : data.linkedTaskId !== undefined
      ? data.linkedTaskId
      : undefined;

  const effectiveWrId =
    data.linkedWorkRequestId !== undefined
      ? data.linkedWorkRequestId
      : data.workRequestId !== undefined
      ? data.workRequestId
      : data.work_request_id !== undefined
      ? data.work_request_id
      : existing.linked_work_request_id;

  // Validation: Task existence & WR association (UAT2-6/12)
  if (effectiveTaskId) {
    const { data: task, error: taskErr } = await supabaseAdmin
      .from('tasks')
      .select('id, work_request_id')
      .eq('id', effectiveTaskId)
      .maybeSingle();

    if (taskErr || !task) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: `Linked task "${effectiveTaskId}" was not found`,
        code: 'TASK_NOT_FOUND',
      });
    }

    if (effectiveWrId && task.work_request_id !== effectiveWrId) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Task does not belong to work request',
        code: 'TASK_WR_MISMATCH',
      });
    }
  } else if (
    effectiveTaskId === undefined &&
    (data.linkedWorkRequestId !== undefined ||
      data.workRequestId !== undefined ||
      data.work_request_id !== undefined)
  ) {
    // If only WR is updated, check existing linked task against new WR
    const existingTaskId = existing.task_id || existing.linked_task_id;
    if (existingTaskId && effectiveWrId) {
      const { data: task } = await supabaseAdmin
        .from('tasks')
        .select('id, work_request_id')
        .eq('id', existingTaskId)
        .maybeSingle();
      if (task && task.work_request_id !== effectiveWrId) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Task does not belong to work request',
          code: 'TASK_WR_MISMATCH',
        });
      }
    }
  }

  const updates = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (data.category !== undefined) updates.category = data.category;
  if (data.description !== undefined) updates.description = data.description;
  if (data.amount !== undefined) updates.amount = data.amount;
  if (data.fundSource !== undefined) updates.fund_source = data.fundSource;
  if (data.clientId !== undefined) updates.client_id = data.clientId;
  if (data.employeeId !== undefined) updates.employee_id = data.employeeId;
  if (data.linkedInvoiceId !== undefined) updates.linked_invoice_id = data.linkedInvoiceId;
  if (
    data.linkedWorkRequestId !== undefined ||
    data.workRequestId !== undefined ||
    data.work_request_id !== undefined
  ) {
    updates.linked_work_request_id = effectiveWrId;
  }
  if (effectiveTaskId !== undefined) {
    updates.linked_task_id = effectiveTaskId;
    updates.task_id = effectiveTaskId;
  }
  if (data.linkedTransmittalId !== undefined)
    updates.linked_transmittal_id = data.linkedTransmittalId;
  if (data.dueDate !== undefined) updates.due_date = data.dueDate;
  if (data.status !== undefined) updates.status = data.status;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.archived !== undefined) updates.archived = data.archived;
  if (data.receiptS3Key !== undefined) updates.receipt_s3_key = data.receiptS3Key;
  if (data.receiptFilename !== undefined) updates.receipt_filename = data.receiptFilename;

  // Prepend Accounting edit notes and set edited_by_accounting: true (Task A.5)
  if (isAccountingUser && isEditingFinancial) {
    const editPrefix = `[Edited by Accounting on ${new Date().toLocaleDateString('en-PH')} by ${effectiveUser?.name || 'Accounting Staff'}] `;
    const currentNotes = data.notes !== undefined ? data.notes : (existing.notes || '');
    updates.notes = currentNotes ? `${editPrefix}${currentNotes}` : editPrefix.trim();
    updates.edited_by_accounting = true;
  }

  // OCC (Spec 2.2 / R-10): version-guard the update when the client declares
  // the version it read; zero matching rows become a 409 conflict.
  const expectedVersion = resolveExpectedVersion(data);
  if (expectedVersion !== null) {
    updates.version = (existing.version || 1) + 1;
  }

  let query = supabaseAdmin
    .from('disbursements')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId);
  if (expectedVersion !== null) {
    query = query.eq('version', expectedVersion);
  }
  const { data: updated, error } = await query.select().maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update disbursement',
    });
  }

  if (!updated) {
    if (expectedVersion !== null) {
      throw concurrencyConflict();
    }
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Disbursement ${id} not found`,
    });
  }

  const enriched = await enrichDisbursementExtras([updated]);
  return enriched[0];
};

/**
 * Archive a disbursement.
 */
const archiveDisbursement = async ({ entityId, id, userId }) => {
  const existing = await getDisbursementById({ entityId, id });
  const { data: updated, error } = await supabaseAdmin
    .from('disbursements')
    .update({ archived: true, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to archive disbursement',
    });
  }

  await auditService.log({
    action: 'disbursement.archive',
    table: 'disbursements',
    recordId: id,
    entity: entityId,
    userId,
    details: { disbursementNumber: existing.disbursement_number },
  });

  const entityCode = await resolveEntityCode(updated.entity_id);
  return { ...updated, entity_code: entityCode };
};

/**
 * Unarchive a disbursement.
 */
const unarchiveDisbursement = async ({ entityId, id, userId }) => {
  const existing = await getDisbursementById({ entityId, id });
  const { data: updated, error } = await supabaseAdmin
    .from('disbursements')
    .update({ archived: false, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to unarchive disbursement',
    });
  }

  await auditService.log({
    action: 'disbursement.unarchive',
    table: 'disbursements',
    recordId: id,
    entity: entityId,
    userId,
    details: { disbursementNumber: existing.disbursement_number },
  });

  const entityCode = await resolveEntityCode(updated.entity_id);
  return { ...updated, entity_code: entityCode };
};

/**
 * Helper to perform a status transition.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @param {string} params.action - Transition action name
 * @param {object} [params.extraUpdates] - Additional fields to set
 * @returns {Promise<object>}
 */
const performTransition = async ({ entityId, id, userId, action, extraUpdates = {}, user }) => {
  const transition = VALID_TRANSITIONS[action];
  const validFrom = Array.isArray(transition.from) ? [...transition.from] : [transition.from];

  if (action === 'approve') {
    let effectiveUser = user;
    if (!effectiveUser && userId) {
      const { data: u } = await supabaseAdmin
        .from('users')
        .select('id, name, role, departments')
        .eq('id', userId)
        .maybeSingle();
      effectiveUser = u;
    }
    const permissions = effectiveUser
      ? (effectiveUser.permissions instanceof Set
          ? effectiveUser.permissions
          : buildPermissionSet({ role: effectiveUser.role || '', departments: effectiveUser.departments || [] }))
      : new Set();
    const canDirectApprove =
      effectiveUser?.role === 'Admin' ||
      hasPermission(permissions, 'disbursement:approve') ||
      hasPermission(permissions, 'disbursement:*');

    if (canDirectApprove && !validFrom.includes('Draft')) {
      validFrom.push('Draft');
    }
  }

  const paymentDetails =
    action === 'release'
      ? {
          method: extraUpdates.payment_method,
          reference: extraUpdates.payment_reference,
          bank: extraUpdates.payment_bank,
          date: extraUpdates.payment_date,
        }
      : undefined;

  const reason = action === 'reject' ? extraUpdates.rejection_reason : undefined;

  const { data: rows, error: rpcError } = await supabaseAdmin.rpc('disbursement_transition', {
    p_id: id,
    p_from_statuses: validFrom,
    p_to_status: transition.to,
    p_user_id: userId,
    p_entity_id: entityId,
    p_reason: reason,
    p_payment_details: paymentDetails,
  });

  if (rpcError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: `Failed to ${action} disbursement`,
    });
  }

  if (!rows || rows.length === 0) {
    const current = await getDisbursementById({ entityId, id });
    throw new AppError({
      statusCode: 409,
      title: 'Invalid Transition',
      detail: `Cannot ${action} a disbursement in "${current?.status || 'unknown'}" status. Expected: ${validFrom.join(' or ')}.`,
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }

  const updated = rows[0];

  await auditService.log({
    action: `disbursement.${action}`,
    table: 'disbursements',
    recordId: id,
    entity: entityId,
    userId,
    details: { from: validFrom, to: transition.to },
  });

  if (action === 'approve' && !updated.approved_by) {
    await supabaseAdmin
      .from('disbursements')
      .update({ approved_by: userId, approved_at: new Date().toISOString() })
      .eq('id', id);
    updated.approved_by = userId;
    updated.approved_at = new Date().toISOString();
  }

  const entityCode = await resolveEntityCode(updated.entity_id);
  const enriched = await enrichDisbursementExtras([{ ...updated, entity_code: entityCode }]);
  return enriched[0];
};

/**
 * Submit a disbursement for approval. Draft → Submitted.
 */
const submitDisbursement = async ({ entityId, id, userId }) => {
  return performTransition({
    entityId,
    id,
    userId,
    action: 'submit',
    extraUpdates: {},
  });
};

/**
 * Forward a disbursement to Admin approval. [Submitted, Pending] → Pending Admin Approval.
 */
const forwardDisbursement = async ({ entityId, id, userId }) => {
  return performTransition({
    entityId,
    id,
    userId,
    action: 'forward_admin',
    extraUpdates: {},
  });
};

/**
 * Approve a disbursement. Pending → Approved (or Draft → Approved for Admin).
 */
const approveDisbursement = async ({ entityId, id, userId, user }) => {
  const result = await performTransition({
    entityId,
    id,
    userId,
    user,
    action: 'approve',
    extraUpdates: {
      approved_by: userId,
      approved_at: new Date().toISOString(),
    },
  });

  const creatorId = result.requested_by || result.created_by;
  if (creatorId) {
    await safeNotify([creatorId], 'pending_request.resolved', {
      request_id: result.id,
      table_name: 'disbursements',
      outcome: 'approved',
      title: result.disbursement_number || result.description,
    });
  }

  return result;
};

/**
 * Release a disbursement. Approved → Released.
 */
const releaseDisbursement = async ({ entityId, id, userId, paymentDetails = {} }) => {
  return performTransition({
    entityId,
    id,
    userId,
    action: 'release',
    extraUpdates: {
      released_by: userId,
      released_at: new Date().toISOString(),
      payment_method: paymentDetails.method || null,
      payment_reference: paymentDetails.reference || null,
      payment_bank: paymentDetails.bank || null,
      payment_date: paymentDetails.date || new Date().toISOString().slice(0, 10),
      payment_processed_by: userId,
    },
  });
};

/**
 * Fund a disbursement. Released → Funded.
 */
const fundDisbursement = async ({ entityId, id, userId }) => {
  return performTransition({
    entityId,
    id,
    userId,
    action: 'fund',
    extraUpdates: {
      funded_by: userId,
      funded_at: new Date().toISOString(),
    },
  });
};

/**
 * Reject a disbursement. Pending → Rejected.
 */
const rejectDisbursement = async ({ entityId, id, userId, reason }) => {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Rejection reason is required',
      code: 'REJECTION_REASON_REQUIRED',
    });
  }

  const trimmedReason = reason.trim();
  const result = await performTransition({
    entityId,
    id,
    userId,
    action: 'reject',
    extraUpdates: {
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: trimmedReason,
    },
  });

  const creatorId = result.requested_by || result.created_by;
  if (creatorId) {
    await safeNotify([creatorId], 'pending_request.resolved', {
      request_id: result.id,
      table_name: 'disbursements',
      outcome: 'rejected',
      reason: trimmedReason,
      title: result.disbursement_number || result.description,
    });
  }

  return result;
};

/**
 * Update disbursement status directly.
 * Allows transition from 'Draft' directly to 'Approved' if user.role === 'Admin' or user has disbursement:approve.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @param {string} params.status
 * @param {object} [params.user]
 * @param {string} [params.rejectionReason]
 * @param {object} [params.paymentDetails]
 * @returns {Promise<object>}
 */
const updateDisbursementStatus = async ({
  entityId,
  id,
  userId,
  status,
  user,
  rejectionReason,
  paymentDetails,
}) => {
  if (status === 'Approved') {
    return approveDisbursement({ entityId, id, userId, user });
  }
  if (status === 'Pending') {
    return submitDisbursement({ entityId, id, userId });
  }
  if (status === 'Released') {
    return releaseDisbursement({ entityId, id, userId, paymentDetails });
  }
  if (status === 'Rejected') {
    return rejectDisbursement({ entityId, id, userId, reason: rejectionReason });
  }
  throw new AppError({
    statusCode: 400,
    title: 'Bad Request',
    detail: `Unknown status transition target: "${status}"`,
  });
};

// ============================================================
// Disbursement Templates
// ============================================================

/**
 * List disbursement templates for the entity.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<object[]>}
 */
const listDisbursementTemplates = async ({ entityId }) => {
  let query = supabaseAdmin
    .from('disbursement_templates')
    .select('*, entities(code)')
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
      detail: 'Failed to fetch disbursement templates',
    });
  }

  return data || [];
};

/**
 * Create a disbursement template.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const createDisbursementTemplate = async ({ entityId, userId, data }) => {
  const row = {
    entity_id: entityId,
    name: data.name,
    category: data.category,
    amount: data.amount,
    fund_source: data.fundSource || null,
    schedule: data.schedule || null,
    description: data.description || null,
    linked_work_request_id: data.linkedWorkRequestId || null,
    linked_invoice_id: data.linkedInvoiceId || null,
    linked_transmittal_id: data.linkedTransmittalId || null,
    created_by: userId,
  };

  const { data: template, error } = await supabaseAdmin
    .from('disbursement_templates')
    .insert(row)
    .select('*, entities(code)')
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create disbursement template',
    });
  }

  return template;
};

/**
 * Update a disbursement template.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const updateDisbursementTemplate = async ({ entityId, id, data }) => {
  const updates = { updated_at: new Date().toISOString() };

  if (data.name !== undefined) updates.name = data.name;
  if (data.category !== undefined) updates.category = data.category;
  if (data.amount !== undefined) updates.amount = data.amount;
  if (data.fundSource !== undefined) updates.fund_source = data.fundSource;
  if (data.schedule !== undefined) updates.schedule = data.schedule;
  if (data.description !== undefined) updates.description = data.description;
  if (data.linkedWorkRequestId !== undefined)
    updates.linked_work_request_id = data.linkedWorkRequestId;
  if (data.linkedInvoiceId !== undefined) updates.linked_invoice_id = data.linkedInvoiceId;
  if (data.linkedTransmittalId !== undefined)
    updates.linked_transmittal_id = data.linkedTransmittalId;

  const { data: updated, error } = await supabaseAdmin
    .from('disbursement_templates')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .select('*, entities(code)')
    .single();

  if (error || !updated) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Disbursement template ${id} not found`,
    });
  }

  return updated;
};

/**
 * Soft-delete a disbursement template.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<void>}
 */
const deleteDisbursementTemplate = async ({ entityId, id }) => {
  const { error } = await supabaseAdmin
    .from('disbursement_templates')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to delete disbursement template',
    });
  }
};

module.exports = {
  listDisbursements,
  createDisbursement,
  getDisbursementById,
  updateDisbursement,
  archiveDisbursement,
  unarchiveDisbursement,
  submitDisbursement,
  approveDisbursement,
  releaseDisbursement,
  fundDisbursement,
  rejectDisbursement,
  forwardDisbursement,
  enrichDisbursementExtras,
  getDisbursementCounts,
  listDisbursementTemplates,
  createDisbursementTemplate,
  updateDisbursementTemplate,
  deleteDisbursementTemplate,
  updateDisbursementStatus,
};

/**
 * Soft-delete a disbursement.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @returns {Promise<void>}
 */
const deleteDisbursement = async ({ entityId, id, userId }) => {
  const existing = await getDisbursementById({ entityId, id });
  const { error } = await supabaseAdmin
    .from('disbursements')
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to delete disbursement',
    });
  }

  await auditService.log({
    action: 'disbursement.delete',
    table: 'disbursements',
    recordId: id,
    entity: entityId,
    userId,
    details: { disbursementNumber: existing.disbursement_number },
  });
};

module.exports.deleteDisbursement = deleteDisbursement;
