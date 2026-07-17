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

/** Valid status transitions */
const VALID_TRANSITIONS = {
  submit: { from: 'Draft', to: 'Pending' },
  approve: { from: 'Pending', to: 'Approved' },
  release: { from: 'Approved', to: 'Released' },
  reject: { from: ['Pending', 'Approved'], to: 'Rejected' },
};

/**
 * Generate a disbursement number.
 * Format: DISB-{ENTITY_CODE}-{YYYYMMDD}-{seq}
 * @param {string} entityId - UUID of the entity
 * @param {string} entityCode - entity code (ATA or LTA)
 * @returns {Promise<string>}
 */
const generateDisbursementNumber = async (entityId, entityCode) => {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `DISB-${entityCode}-${today}`;

  const { count } = await supabaseAdmin
    .from('disbursements')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .ilike('disbursement_number', `${prefix}%`);

  const seq = String((count || 0) + 1).padStart(4, '0');
  return `${prefix}-${seq}`;
};

/**
 * List disbursements for the active entity.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.filters]
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listDisbursements = async ({ entityId, filters = {} }) => {
  const { status, category, fundSource, search, page = 1, limit = 50 } = filters;

  let query = supabaseAdmin
    .from('disbursements')
    .select('*, clients(name)', { count: 'exact' })
    .eq('entity_id', entityId)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (fundSource) query = query.eq('fund_source', fundSource);
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

  return { data: data || [], count: count || 0 };
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
  const disbursementNumber = await generateDisbursementNumber(entityId, entityCode || entityId);

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
    requested_by: userId,
    due_date: data.dueDate || null,
    notes: data.notes || null,
    created_by: userId,
    updated_by: userId,
  };

  const { data: disbursement, error } = await supabaseAdmin
    .from('disbursements')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create disbursement',
    });
  }

  await auditService.log({
    action: 'disbursement.create',
    table: 'disbursements',
    recordId: disbursement.id,
    entity: entityId,
    userId,
    details: { disbursementNumber, amount: data.amount, category: data.category },
  });

  return disbursement;
};

/**
 * Get a single disbursement by ID.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<object>}
 */
const getDisbursementById = async ({ entityId, id }) => {
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

  return data;
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

  if (existing.status !== 'Draft') {
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
  if (data.linkedWorkRequestId !== undefined) updates.linked_work_request_id = data.linkedWorkRequestId;
  if (data.dueDate !== undefined) updates.due_date = data.dueDate;
  if (data.notes !== undefined) updates.notes = data.notes;

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
  const existing = await getDisbursementById({ entityId, id });
  const transition = VALID_TRANSITIONS[action];

  const validFrom = Array.isArray(transition.from)
    ? transition.from
    : [transition.from];

  if (!validFrom.includes(existing.status)) {
    throw new AppError({
      statusCode: 409,
      title: 'Invalid Transition',
      detail: `Cannot ${action} a disbursement in "${existing.status}" status. Expected: ${validFrom.join(' or ')}.`,
    });
  }

  const updates = {
    status: transition.to,
    updated_by: userId,
    updated_at: new Date().toISOString(),
    ...extraUpdates,
  };

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
      detail: `Failed to ${action} disbursement`,
    });
  }

  await auditService.log({
    action: `disbursement.${action}`,
    table: 'disbursements',
    recordId: id,
    entity: entityId,
    userId,
    details: { from: existing.status, to: transition.to },
  });

  return updated;
};

/**
 * Submit a disbursement for approval. Draft → Pending.
 */
const submitDisbursement = async ({ entityId, id, userId }) => {
  return performTransition({
    entityId, id, userId,
    action: 'submit',
    extraUpdates: {},
  });
};

/**
 * Approve a disbursement. Pending → Approved.
 */
const approveDisbursement = async ({ entityId, id, userId }) => {
  return performTransition({
    entityId, id, userId,
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
    entityId, id, userId,
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
 * Reject a disbursement. Pending/Approved → Rejected.
 */
const rejectDisbursement = async ({ entityId, id, userId, reason }) => {
  return performTransition({
    entityId, id, userId,
    action: 'reject',
    extraUpdates: {
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: reason,
    },
  });
};

module.exports = {
  listDisbursements,
  createDisbursement,
  getDisbursementById,
  updateDisbursement,
  submitDisbursement,
  approveDisbursement,
  releaseDisbursement,
  rejectDisbursement,
};
