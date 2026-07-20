/**
 * Operations Requests service.
 * Business logic for operations request CRUD and workflow transitions.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');
const { buildPermissionSet, hasPermission } = require('../../lib/permissions');

/**
 * List operations requests for the active entity.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.filters]
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listRequests = async ({ entityId, filters = {} }) => {
  const { status, type, workRequestId, clientId, linkedTaskId, requestedBy, page = 1, limit = 50 } = filters;

  let query = supabaseAdmin
    .from('operations_requests')
    .select('*, clients(name), work_requests(title)', { count: 'exact' })
    .or('status.eq.pending,status.eq.fulfilled,status.eq.rejected');

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  if (status) query = query.eq('status', status);
  if (type) query = query.eq('type', type);
  if (workRequestId) query = query.eq('work_request_id', workRequestId);
  if (clientId) query = query.eq('client_id', clientId);
  if (linkedTaskId) query = query.eq('linked_task_id', linkedTaskId);
  if (requestedBy) query = query.eq('requested_by', requestedBy);

  const offset = (page - 1) * limit;
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch operations requests',
    });
  }

  return { data: data || [], count: count || 0 };
};

/**
 * Create a new operations request.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const createRequest = async ({ entityId, userId, data }) => {
  const row = {
    entity_id: entityId,
    type: data.type,
    work_request_id: data.workRequestId || null,
    client_id: data.clientId || null,
    linked_task_id: data.linkedTaskId || null,
    requested_by: userId,
    amount: data.amount ?? null,
    status: 'pending',
    notes: data.notes || null,
    rejection_reason: null,
    fulfilled_by: null,
    fulfilled_at: null,
  };

  const { data: request, error } = await supabaseAdmin
    .from('operations_requests')
    .insert(row)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create operations request',
    });
  }

  await auditService.log({
    action: 'operations_request.create',
    table: 'operations_requests',
    recordId: request.id,
    entity: entityId,
    userId,
    details: { type: data.type, amount: data.amount, status: 'pending' },
  });

  return request;
};

/**
 * Get a single operations request by ID.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<object>}
 */
const getRequestById = async ({ entityId, id }) => {
  const { data, error } = await supabaseAdmin
    .from('operations_requests')
    .select(
      '*, clients(name), work_requests(title), requester:requested_by(name), fulfiller:fulfilled_by(name)'
    )
    .eq('id', id)
    .eq('entity_id', entityId)
    .or('status.eq.pending,status.eq.fulfilled,status.eq.rejected')
    .single();

  if (error || !data) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Operations request ${id} not found`,
    });
  }

  return data;
};

/**
 * Update an operations request.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const updateRequest = async ({ entityId, id, userId, data }) => {
  const existing = await getRequestById({ entityId, id });

  if (existing.status !== 'pending') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Cannot edit operations request in "${existing.status}" status. Only pending requests can be updated.`,
    });
  }

  // Atomic transition for the two terminal statuses.
  if (data.status === 'fulfilled') {
    const { data: rows, error: rpcError } = await supabaseAdmin.rpc('operations_request_fulfill', {
      p_id: id,
      p_fulfilled_by: data.fulfilledBy || userId,
      p_entity_id: entityId,
    });

    if (rpcError) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to fulfill operations request',
      });
    }

    if (!rows || rows.length === 0) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'This operations request has already been fulfilled or rejected',
        code: 'OPERATIONS_REQUEST_ALREADY_RESOLVED',
      });
    }

    await auditService.log({
      action: 'operations_request.update',
      table: 'operations_requests',
      recordId: id,
      entity: entityId,
      userId,
      details: { status: 'fulfilled', fulfilledBy: data.fulfilledBy || userId },
    });

    return rows[0];
  }

  if (data.status === 'rejected') {
    const { data: rows, error: rpcError } = await supabaseAdmin.rpc('operations_request_reject', {
      p_id: id,
      p_rejection_reason: data.rejectionReason || null,
      p_user_id: userId,
      p_entity_id: entityId,
    });

    if (rpcError) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to reject operations request',
      });
    }

    if (!rows || rows.length === 0) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'This operations request has already been fulfilled or rejected',
        code: 'OPERATIONS_REQUEST_ALREADY_RESOLVED',
      });
    }

    await auditService.log({
      action: 'operations_request.update',
      table: 'operations_requests',
      recordId: id,
      entity: entityId,
      userId,
      details: { status: 'rejected', rejectionReason: data.rejectionReason || null },
    });

    return rows[0];
  }

  const updates = {
    updated_at: new Date().toISOString(),
  };

  if (data.status !== undefined) updates.status = data.status;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.rejectionReason !== undefined) updates.rejection_reason = data.rejectionReason;
  if (data.fulfilledBy !== undefined) updates.fulfilled_by = data.fulfilledBy;

  if (updates.status === 'pending') {
    updates.fulfilled_by = null;
    updates.fulfilled_at = null;
    updates.rejection_reason = null;
  }

  const { data: updated, error } = await supabaseAdmin
    .from('operations_requests')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update operations request',
    });
  }

  await auditService.log({
    action: 'operations_request.update',
    table: 'operations_requests',
    recordId: id,
    entity: entityId,
    userId,
    details: {
      status: updates.status,
      rejectionReason: updates.rejection_reason,
      fulfilledBy: updates.fulfilled_by,
    },
  });

  return updated;
};

/**
 * Soft-delete an operations request by marking it cancelled.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<object>}
 */
const deleteRequest = async ({ entityId, id }) => {
  const existing = await getRequestById({ entityId, id });

  const { data: deleted, error } = await supabaseAdmin
    .from('operations_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to delete operations request',
    });
  }

  await auditService.log({
    action: 'operations_request.delete',
    table: 'operations_requests',
    recordId: id,
    entity: entityId,
    userId: existing.requested_by,
    details: { previousStatus: existing.status },
  });

  return deleted;
};

/**
 * Count operations requests grouped by status for the active entity.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<object>}
 */
const getCounts = async ({ entityId, user }) => {
  const baseQuery = () => {
    let q = supabaseAdmin
      .from('operations_requests')
      .select('*', { count: 'exact', head: true })
      .or('status.eq.pending,status.eq.fulfilled,status.eq.rejected');
    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }
    return q;
  };

  const runCount = async (query) => {
    const { count, error } = await query;
    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to count operations requests',
      });
    }
    return count || 0;
  };

  const canFulfill = (() => {
    if (!user) return false;
    const permissions = buildPermissionSet({
      role: user.role || '',
      departments: user.departments || [],
    });
    return hasPermission(permissions, 'workflow:edit');
  })();

  const [total, pending, fulfilled, rejected, awaitingFulfillment] = await Promise.all([
    runCount(baseQuery()),
    runCount(baseQuery().eq('status', 'pending')),
    runCount(baseQuery().eq('status', 'fulfilled')),
    runCount(baseQuery().eq('status', 'rejected')),
    canFulfill ? runCount(baseQuery().eq('status', 'pending')) : Promise.resolve(0),
  ]);

  return { total, pending, fulfilled, rejected, awaitingFulfillment };
};

module.exports = {
  listRequests,
  createRequest,
  getRequestById,
  updateRequest,
  deleteRequest,
  getCounts,
};
