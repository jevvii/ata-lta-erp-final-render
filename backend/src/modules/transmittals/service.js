/**
 * Transmittals service.
 * Business logic for transmittal management with send/acknowledge workflow.
 *
 * Status flow: Draft → Sent → Acknowledged
 *
 * Phase 6 — Agent B
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');

/**
 * List transmittals for the active entity.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.filters]
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listTransmittals = async ({ entityId, filters = {} }) => {
  const { status, clientId, search, archived, page = 1, limit = 50 } = filters;
  const isArchived = archived === true || archived === 'true';

  let query = supabaseAdmin
    .from('transmittals')
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
  if (status) query = query.eq('status', status);

  if (clientId) query = query.eq('client_id', clientId);
  if (search) {
    query = query.or(
      `tracking_number.ilike.%${search}%,notes.ilike.%${search}%,recipient_name.ilike.%${search}%`
    );
  }

  const offset = (page - 1) * limit;
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch transmittals',
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
 * Count transmittals for the active entity (or all entities when entityId is 'ALL').
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<{ active: number, archived: number, total: number }>}
 */
const countTransmittals = async ({ entityId }) => {
  let query = supabaseAdmin
    .from('transmittals')
    .select('*', { count: 'exact' })
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data, error, count } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to count transmittals',
    });
  }

  const rows = data || [];
  const active = rows.filter(
    (t) => t.status !== 'Cancelled' && !(t.status === 'Acknowledged' && t.archived)
  ).length;
  const archived = rows.filter((t) => t.status === 'Acknowledged' && t.archived).length;

  return { active, archived, total: count || rows.length };
};

/**
 * Create a transmittal with items.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const createTransmittal = async ({ entityId, userId, data }) => {
  const row = {
    tracking_number: data.trackingNumber,
    entity_id: entityId,
    client_id: data.clientId,
    work_request_id: data.workRequestId || null,
    status: 'Draft',
    notes: data.notes || null,
    recipient_name: data.recipientName || null,
    recipient_details: data.recipientDetails || null,
    created_by: userId,
    updated_by: userId,
  };

  const { data: transmittal, error: trErr } = await supabaseAdmin
    .from('transmittals')
    .insert(row)
    .select()
    .single();

  if (trErr) {
    if (trErr.code === '23505') {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Tracking number "${data.trackingNumber}" already exists for this entity`,
      });
    }
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create transmittal',
    });
  }

  // Insert items
  const items = data.items.map((item, idx) => ({
    transmittal_id: transmittal.id,
    description: item.description,
    document_type: item.documentType || null,
    quantity: item.quantity || 1,
    sort_order: idx,
  }));

  const { error: itemErr } = await supabaseAdmin.from('transmittal_items').insert(items);

  if (itemErr) {
    await supabaseAdmin.from('transmittals').delete().eq('id', transmittal.id);
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create transmittal items',
    });
  }

  await auditService.log({
    action: 'transmittal.create',
    table: 'transmittals',
    recordId: transmittal.id,
    entity: entityId,
    userId,
    details: { trackingNumber: data.trackingNumber, itemCount: items.length },
  });

  return { ...transmittal, items };
};

/**
 * Get a single transmittal with items.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<object>}
 */
const getTransmittalById = async ({ entityId, id }) => {
  const { data: transmittal, error } = await supabaseAdmin
    .from('transmittals')
    .select('*, clients(name, address, tin)')
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .single();

  if (error || !transmittal) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Transmittal ${id} not found`,
    });
  }

  const { data: items } = await supabaseAdmin
    .from('transmittal_items')
    .select('*')
    .eq('transmittal_id', id)
    .order('sort_order', { ascending: true });

  return { ...transmittal, items: items || [] };
};

/**
 * Update a transmittal (only if Draft).
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const updateTransmittal = async ({ entityId, id, userId, data }) => {
  const existing = await getTransmittalById({ entityId, id });

  if (existing.status !== 'Draft') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Cannot edit transmittal in "${existing.status}" status. Only Draft transmittals can be edited.`,
    });
  }

  const updates = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (data.clientId !== undefined) updates.client_id = data.clientId;
  if (data.workRequestId !== undefined) updates.work_request_id = data.workRequestId;
  if (data.trackingNumber !== undefined) updates.tracking_number = data.trackingNumber;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.recipientName !== undefined) updates.recipient_name = data.recipientName;
  if (data.recipientDetails !== undefined) updates.recipient_details = data.recipientDetails;

  // Replace items if provided
  if (data.items) {
    await supabaseAdmin.from('transmittal_items').delete().eq('transmittal_id', id);

    const items = data.items.map((item, idx) => ({
      transmittal_id: id,
      description: item.description,
      document_type: item.documentType || null,
      quantity: item.quantity || 1,
      sort_order: idx,
    }));

    await supabaseAdmin.from('transmittal_items').insert(items);
  }

  const { data: updated, error } = await supabaseAdmin
    .from('transmittals')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update transmittal',
    });
  }

  return updated;
};

/**
 * Send a transmittal. Draft → Sent.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @returns {Promise<object>}
 */
const sendTransmittal = async ({ entityId, id, userId }) => {
  const existing = await getTransmittalById({ entityId, id });

  if (existing.status !== 'Draft') {
    throw new AppError({
      statusCode: 409,
      title: 'Invalid Transition',
      detail: `Cannot send a transmittal in "${existing.status}" status. Must be Draft.`,
    });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('transmittals')
    .update({
      status: 'Sent',
      sent_at: new Date().toISOString(),
      sent_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to send transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.send',
    table: 'transmittals',
    recordId: id,
    entity: entityId,
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return updated;
};

/**
 * Acknowledge a transmittal. Sent → Acknowledged.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @returns {Promise<object>}
 */
const acknowledgeTransmittal = async ({ entityId, id, userId }) => {
  const existing = await getTransmittalById({ entityId, id });

  if (existing.status !== 'Sent') {
    throw new AppError({
      statusCode: 409,
      title: 'Invalid Transition',
      detail: `Cannot acknowledge a transmittal in "${existing.status}" status. Must be Sent.`,
    });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('transmittals')
    .update({
      status: 'Acknowledged',
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to acknowledge transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.acknowledge',
    table: 'transmittals',
    recordId: id,
    entity: entityId,
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return updated;
};

/**
 * Soft-delete a transmittal.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 */
const deleteTransmittal = async ({ entityId, id, userId }) => {
  const existing = await getTransmittalById({ entityId, id });

  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('transmittals')
    .update({
      deleted_at: now,
      updated_by: userId,
      updated_at: now,
    })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to delete transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.delete',
    table: 'transmittals',
    recordId: id,
    entity: entityId,
    userId,
    details: { trackingNumber: existing.tracking_number },
  });
};

const archiveTransmittal = async ({ entityId, id, userId }) => {
  const existing = await getTransmittalById({ entityId, id });
  if (existing.status !== 'Acknowledged') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Only Acknowledged transmittals can be archived',
    });
  }

  const { data: updated, error } = await supabaseAdmin
    .from('transmittals')
    .update({ archived: true, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to archive transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.archive',
    table: 'transmittals',
    recordId: id,
    entity: entityId,
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return updated;
};

const unarchiveTransmittal = async ({ entityId, id, userId }) => {
  const existing = await getTransmittalById({ entityId, id });
  const { data: updated, error } = await supabaseAdmin
    .from('transmittals')
    .update({ archived: false, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to unarchive transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.unarchive',
    table: 'transmittals',
    recordId: id,
    entity: entityId,
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return updated;
};

module.exports = {
  listTransmittals,
  countTransmittals,
  createTransmittal,
  getTransmittalById,
  updateTransmittal,
  sendTransmittal,
  acknowledgeTransmittal,
  archiveTransmittal,
  unarchiveTransmittal,
  deleteTransmittal,
};
