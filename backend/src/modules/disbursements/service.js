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
const { buildPermissionSet, hasPermission } = require('../../lib/permissions');
const { resolveEntityCode } = require('../../lib/entityResolver');

/** Valid status transitions */
const VALID_TRANSITIONS = {
  submit: { from: 'Draft', to: 'Pending' },
  approve: { from: 'Pending', to: 'Approved' },
  release: { from: 'Approved', to: 'Released' },
  fund: { from: 'Released', to: 'Funded' },
  reject: { from: ['Pending', 'Approved'], to: 'Rejected' },
};

/**
 * Generate a disbursement number.
 * Format: DISB-{ENTITY_CODE}-{YYYYMMDD}-{seq}
 * @param {string} entityId - UUID of the entity
 * @param {string} entityCode - entity code (ATA or LTA)
 * @returns {Promise<string>}
 */
const generateDisbursementNumber = async (entityId, entityCode, attempt = 0) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `DISB-${entityCode}-${today}`;

  const { count } = await supabaseAdmin
    .from('disbursements')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .ilike('disbursement_number', `${prefix}%`);

  const seq = String((count || 0) + 1 + attempt).padStart(4, '0');
  return `${prefix}-${seq}`;
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

  const baseQuery = () =>
    supabaseAdmin
      .from('disbursements')
      .select('*', { count: 'exact', head: true })
      .in('entity_id', entityIds)
      .is('deleted_at', null);

  const canRelease = (() => {
    if (!user) return false;
    const permissions = buildPermissionSet({
      role: user.role || '',
      departments: user.departments || [],
    });
    return hasPermission(permissions, 'disbursement:mark_released');
  })();

  const isAdmin = user?.role === 'Admin';
  const isAccounting = (user?.departments || []).includes('Accounting') || user?.role === 'Accounting';

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
        supabaseAdmin
          .from('operations_requests')
          .select('*', { count: 'exact', head: true })
          .in('entity_id', entityIds)
          .eq('type', 'disbursement')
          .eq('status', 'rejected')
      ),
      canRelease ? runCount(baseQuery().eq('status', 'Approved').eq('archived', false)) : Promise.resolve(0),
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

  // Role restriction: non-admin and non-accounting cannot see Draft or Pending phases/statuses.
  const isAdmin = user?.role === 'Admin';
  const isAccounting = (user?.departments || []).includes('Accounting') || user?.role === 'Accounting';
  if (!isAdmin && !isAccounting) {
    if (status) {
      if (['Draft', 'Pending', 'Submitted', 'Under Review', 'Approved'].includes(status)) {
        query = query.eq('status', '___NONE___');
      } else {
        query = query.eq('status', status);
      }
    } else {
      query = query.in('status', ['Released', 'Funded', 'Rejected']);
    }
  } else {
    if (status) query = query.eq('status', status);
  }

  if (category) query = query.eq('category', category);
  if (fundSource) query = query.eq('fund_source', fundSource);
  if (linkedTaskId) query = query.eq('linked_task_id', linkedTaskId);
  if (search) {
    query = query.or(`description.ilike.%${search}%,disbursement_number.ilike.%${search}%`);
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

  return { data: mapped, count: count || 0 };
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
  const MAX_RETRIES = 5;

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
      status: 'Draft',
      client_id: data.clientId || null,
      employee_id: data.employeeId || null,
      linked_invoice_id: data.linkedInvoiceId || null,
      linked_work_request_id: data.linkedWorkRequestId || null,
      linked_task_id: data.linkedTaskId || null,
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
  const { data, error } = await supabaseAdmin
    .from('disbursements')
    .select('*, clients(name)')
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .single();

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
    const isAccounting = (user.departments || []).includes('Accounting') || user.role === 'Accounting';
    if (!isAdmin && !isAccounting && ['Draft', 'Pending', 'Submitted', 'Under Review', 'Approved'].includes(data.status)) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'You do not have permission to view this disbursement in its current status.',
      });
    }
  }

  const entityCode = await resolveEntityCode(data.entity_id);
  return { ...data, entity_code: entityCode };
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
const updateDisbursement = async ({ entityId, id, userId, data }) => {
  const existing = await getDisbursementById({ entityId, id });

  const contentFields = [
    'category',
    'description',
    'amount',
    'fundSource',
    'clientId',
    'employeeId',
    'linkedInvoiceId',
    'linkedWorkRequestId',
    'linkedTaskId',
    'dueDate',
    'notes',
  ];
  const isUpdatingContent = contentFields.some((field) => data[field] !== undefined);

  if (isUpdatingContent && existing.status !== 'Draft') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Cannot edit disbursement in "${existing.status}" status. Only Draft disbursements can be edited.`,
    });
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
  if (data.linkedWorkRequestId !== undefined)
    updates.linked_work_request_id = data.linkedWorkRequestId;
  if (data.linkedTaskId !== undefined) updates.linked_task_id = data.linkedTaskId;
  if (data.dueDate !== undefined) updates.due_date = data.dueDate;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.archived !== undefined) updates.archived = data.archived;
  if (data.receiptS3Key !== undefined) updates.receipt_s3_key = data.receiptS3Key;
  if (data.receiptFilename !== undefined) updates.receipt_filename = data.receiptFilename;

  const { data: updated, error } = await supabaseAdmin
    .from('disbursements')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update disbursement',
    });
  }

  return updated;
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
const performTransition = async ({ entityId, id, userId, action, extraUpdates = {} }) => {
  const transition = VALID_TRANSITIONS[action];
  const validFrom = Array.isArray(transition.from) ? transition.from : [transition.from];

  const paymentDetails = action === 'release' ? {
    method: extraUpdates.payment_method,
    reference: extraUpdates.payment_reference,
    bank: extraUpdates.payment_bank,
    date: extraUpdates.payment_date,
  } : undefined;

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

  const entityCode = await resolveEntityCode(updated.entity_id);
  return { ...updated, entity_code: entityCode };
};

/**
 * Submit a disbursement for approval. Draft → Pending.
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
 * Approve a disbursement. Pending → Approved.
 */
const approveDisbursement = async ({ entityId, id, userId }) => {
  return performTransition({
    entityId,
    id,
    userId,
    action: 'approve',
    extraUpdates: {
      approved_by: userId,
      approved_at: new Date().toISOString(),
    },
  });
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
 * Reject a disbursement. Pending/Approved → Rejected.
 */
const rejectDisbursement = async ({ entityId, id, userId, reason }) => {
  return performTransition({
    entityId,
    id,
    userId,
    action: 'reject',
    extraUpdates: {
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    },
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
  const { data, error } = await supabaseAdmin
    .from('disbursement_templates')
    .select('*, entities(code)')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

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
  getDisbursementCounts,
  listDisbursementTemplates,
  createDisbursementTemplate,
  updateDisbursementTemplate,
  deleteDisbursementTemplate,
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
