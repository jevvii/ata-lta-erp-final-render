/**
 * Clients module service.
 * CRUD, search/filter, and soft delete scoped to entity.
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const { randomUUID } = require('crypto');

/**
 * Map a database row to the API client shape.
 * @param {object} row
 * @param {object} extras
 * @returns {object}
 */
const toApiClient = (row, extras = {}) => {
  if (!row) return null;
  return {
    id: row.id,
    entity: extras.entityCode || row.entity_code,
    name: row.name,
    tin: row.tin,
    rdoCode: row.rdo_code || null,
    address: row.address || null,
    tradeName: row.trade_name || null,
    contactUserId: row.contact_user_id || null,
    retainer: row.retainer,
    status: row.status,
    createdBy: row.created_by || null,
    updatedBy: row.updated_by || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at || null,
    contactDetails: (extras.contactDetails || []).map((cd) => ({
      id: cd.id,
      type: cd.type,
      value: cd.value,
      label: cd.label || null,
    })),
    relatedCompanies: (extras.relatedCompanies || []).map((rc) => ({
      id: rc.id,
      relatedClientId: rc.related_client_id,
      relationship: rc.relationship || null,
    })),
  };
};

/**
 * Resolve an entity UUID to its code.
 * @param {string} id
 * @returns {Promise<string>}
 */
const resolveEntityCode = async (id) => {
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('code')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return id;
  return data.code;
};

/**
 * Resolve an entity code to its UUID.
 * @param {string} code
 * @returns {Promise<string>}
 */
const resolveEntityId = async (code) => {
  const { data, error } = await supabaseAdmin
    .from('entities')
    .select('id')
    .eq('code', code)
    .maybeSingle();

  if (error || !data) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Unknown entity ${code}`,
    });
  }
  return data.id;
};

/**
 * Load related records for a set of client IDs.
 * @param {string[]} clientIds
 * @returns {Promise<{contactDetails: Map, relatedCompanies: Map}>}
 */
const loadRelated = async (clientIds) => {
  const contactDetails = new Map();
  const relatedCompanies = new Map();

  if (!clientIds.length) return { contactDetails, relatedCompanies };

  const [{ data: cdRows }, { data: rcRows }] = await Promise.all([
    supabaseAdmin.from('client_contact_details').select('*').in('client_id', clientIds),
    supabaseAdmin.from('client_related_companies').select('*').in('client_id', clientIds),
  ]);

  (cdRows || []).forEach((row) => {
    if (!contactDetails.has(row.client_id)) contactDetails.set(row.client_id, []);
    contactDetails.get(row.client_id).push(row);
  });

  (rcRows || []).forEach((row) => {
    if (!relatedCompanies.has(row.client_id)) relatedCompanies.set(row.client_id, []);
    relatedCompanies.get(row.client_id).push(row);
  });

  return { contactDetails, relatedCompanies };
};

/**
 * Fetch clients with optional filters and related records.
 * @param {Object} params
 * @param {string} params.entityId
 * @param {string} [params.search]
 * @param {string} [params.status]
 * @returns {Promise<Array>}
 */
const listClients = async ({ entityId, search, status }) => {
  let query = supabaseAdmin
    .from('clients')
    .select('*')
    .eq('entity_id', entityId)
    .is('deleted_at', null);

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('name', { ascending: true });

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to list clients',
    });
  }

  let rows = data || [];

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (row) =>
        (row.name || '').toLowerCase().includes(q) ||
        (row.trade_name || '').toLowerCase().includes(q) ||
        (row.tin || '').toLowerCase().includes(q)
    );
  }

  const clientIds = rows.map((r) => r.id);
  const [related, entityCode] = await Promise.all([
    loadRelated(clientIds),
    resolveEntityCode(entityId),
  ]);

  return rows.map((row) =>
    toApiClient(row, {
      entityCode,
      contactDetails: related.contactDetails.get(row.id) || [],
      relatedCompanies: related.relatedCompanies.get(row.id) || [],
    })
  );
};

/**
 * Create a client and related records.
 * @param {Object} params
 * @param {string} params.entityId
 * @param {object} params.data
 * @param {string} params.createdBy
 * @returns {Promise<object>}
 */
const createClient = async ({ entityId, data, createdBy }) => {
  const existing = await findClientByTin(entityId, data.tin);
  if (existing) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `A client with TIN ${data.tin} already exists in this entity`,
    });
  }

  const now = new Date().toISOString();
  const clientRecord = {
    id: randomUUID(),
    entity_id: entityId,
    name: data.name,
    tin: data.tin,
    rdo_code: data.rdoCode || null,
    address: data.address || null,
    trade_name: data.tradeName || null,
    contact_user_id: data.contactUserId || null,
    retainer: data.retainer ?? false,
    status: data.status || 'Active',
    created_by: createdBy,
    updated_by: createdBy,
    created_at: now,
    updated_at: now,
  };

  const { error } = await supabaseAdmin.from('clients').insert(clientRecord);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to create client',
    });
  }

  const clientId = clientRecord.id;

  if (data.contactDetails?.length) {
    await upsertContactDetails(clientId, data.contactDetails);
  }
  if (data.relatedCompanies?.length) {
    await upsertRelatedCompanies(clientId, data.relatedCompanies);
  }

  return getClientById({ id: clientId, entityId });
};

/**
 * Find an active client by TIN within an entity.
 * @param {string} entityId
 * @param {string} tin
 * @returns {Promise<object|null>}
 */
const findClientByTin = async (entityId, tin) => {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('entity_id', entityId)
    .eq('tin', tin)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) return null;
  return data || null;
};

/**
 * Upsert contact details for a client.
 * @param {string} clientId
 * @param {Array} contactDetails
 */
const upsertContactDetails = async (clientId, contactDetails) => {
  await supabaseAdmin.from('client_contact_details').delete().eq('client_id', clientId);

  const rows = contactDetails.map((cd) => ({
    client_id: clientId,
    type: cd.type,
    value: cd.value,
    label: cd.label || null,
  }));

  if (rows.length) {
    await supabaseAdmin.from('client_contact_details').insert(rows);
  }
};

/**
 * Upsert related companies for a client.
 * @param {string} clientId
 * @param {Array} relatedCompanies
 */
const upsertRelatedCompanies = async (clientId, relatedCompanies) => {
  await supabaseAdmin.from('client_related_companies').delete().eq('client_id', clientId);

  const rows = relatedCompanies
    .filter((rc) => rc.relatedClientId)
    .map((rc) => ({
      client_id: clientId,
      related_client_id: rc.relatedClientId,
      relationship: rc.relationship || null,
    }));

  if (rows.length) {
    await supabaseAdmin.from('client_related_companies').insert(rows);
  }
};

/**
 * Get a single client by ID.
 * @param {Object} params
 * @param {string} params.id
 * @param {string} params.entityId
 * @returns {Promise<object|null>}
 */
const getClientById = async ({ id, entityId }) => {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('*')
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to retrieve client',
    });
  }

  if (!data) return null;

  const [related, entityCode] = await Promise.all([
    loadRelated([id]),
    resolveEntityCode(entityId),
  ]);

  return toApiClient(data, {
    entityCode,
    contactDetails: related.contactDetails.get(id) || [],
    relatedCompanies: related.relatedCompanies.get(id) || [],
  });
};

/**
 * Update a client.
 * @param {Object} params
 * @param {string} params.id
 * @param {string} params.entityId
 * @param {object} params.data
 * @param {string} params.updatedBy
 * @returns {Promise<object>}
 */
const updateClient = async ({ id, entityId, data, updatedBy }) => {
  const existing = await getClientById({ id, entityId });
  if (!existing) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Client not found',
    });
  }

  const updates = {
    name: data.name ?? existing.name,
    tin: data.tin ?? existing.tin,
    rdo_code: data.rdoCode ?? existing.rdoCode,
    address: data.address ?? existing.address,
    trade_name: data.tradeName ?? existing.tradeName,
    contact_user_id: data.contactUserId ?? existing.contactUserId,
    retainer: data.retainer ?? existing.retainer,
    status: data.status ?? existing.status,
    updated_by: updatedBy,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from('clients')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to update client',
    });
  }

  if (data.contactDetails !== undefined) {
    await upsertContactDetails(id, data.contactDetails);
  }
  if (data.relatedCompanies !== undefined) {
    await upsertRelatedCompanies(id, data.relatedCompanies);
  }

  return getClientById({ id, entityId });
};

/**
 * Soft delete a client and cascade to its work requests and documents.
 * @param {Object} params
 * @param {string} params.id
 * @param {string} params.entityId
 * @param {string} params.deletedBy
 * @returns {Promise<boolean>}
 */
const deleteClient = async ({ id, entityId, deletedBy }) => {
  const existing = await getClientById({ id, entityId });
  if (!existing) return false;

  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from('clients')
    .update({
      status: 'Archived',
      deleted_at: now,
      updated_by: deletedBy,
    })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Unable to delete client',
    });
  }

  // Cascade: cancel related work requests and archive their documents.
  const { data: wrs } = await supabaseAdmin
    .from('work_requests')
    .select('id')
    .eq('client_id', id)
    .eq('entity_id', entityId);

  if (wrs && wrs.length) {
    const wrIds = wrs.map((wr) => wr.id);
    await supabaseAdmin
      .from('work_requests')
      .update({ status: 'Cancelled', updated_at: now, updated_by: deletedBy })
      .in('id', wrIds);

    await supabaseAdmin
      .from('documents')
      .update({ status: 'Archived', archived: true, updated_at: now })
      .in('work_request_id', wrIds);
  }

  return true;
};

module.exports = {
  listClients,
  createClient,
  getClientById,
  updateClient,
  deleteClient,
  resolveEntityId,
};
