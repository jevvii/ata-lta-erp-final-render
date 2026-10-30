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
const { concurrencyConflict, resolveExpectedVersion } = require('../../lib/concurrency');
const { resolveEntityCode } = require('../../lib/entityResolver');
const { isUserAssignedToTask } = require('../operations/service');
const { getUserConcernedWorkRequestIds, fetchInPages } = require('../../lib/userScope');
const {
  validateRecordProjectLinkage,
  filterValidProjectRecords,
} = require('../../lib/projectLinkage');
const {
  resolveTrustedUser,
  assertTaskPhaseAndPrerequisitesSelectable,
} = require('../../lib/taskAssignment');

const resolveEffectiveUser = async (user, userId, internal = false) => {
  const effective = user || (await resolveTrustedUser({ user, userId }));
  if (!internal && !effective) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to modify transmittal',
    });
  }
  return effective;
};

const isDocumentationUser = (u) => {
  if (!u) return false;
  return (
    String(u.role || '').toLowerCase() === 'documentation' ||
    (u.departments || []).some((d) => String(d).toLowerCase() === 'documentation')
  );
};

const isNonAdminDocumentationUser = (u) => {
  if (!u) return false;
  if (String(u.role || '').toLowerCase() === 'admin') return false;
  return isDocumentationUser(u);
};

/**
 * Validate and link disbursements and invoices to a transmittal.
 */
const validateRecordsForTransmittal = async ({
  entityId,
  workRequestId,
  linkedDisbursementIds,
  linkedInvoiceIds,
}) => {
  const uniqueDisbIds = Array.isArray(linkedDisbursementIds)
    ? [...new Set(linkedDisbursementIds.filter(Boolean))]
    : [];
  const uniqueInvIds = Array.isArray(linkedInvoiceIds)
    ? [...new Set(linkedInvoiceIds.filter(Boolean))]
    : [];

  if (uniqueDisbIds.length > 0) {
    const { data: rows, error } = await supabaseAdmin
      .from('disbursements')
      .select('id, entity_id, linked_work_request_id, deleted_at')
      .in('id', uniqueDisbIds);

    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to validate linked disbursements',
      });
    }

    const foundMap = new Map((rows || []).map((r) => [r.id, r]));
    for (const disbId of uniqueDisbIds) {
      const row = foundMap.get(disbId);
      if (
        !row ||
        row.deleted_at ||
        (entityId && entityId !== 'ALL' && row.entity_id !== entityId)
      ) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          code: 'INVALID_DISBURSEMENT_LINK',
          detail: `Disbursement ${disbId} not found or does not belong to this entity.`,
        });
      }
      const rowWrId = row.linked_work_request_id || row.work_request_id;
      if (workRequestId && rowWrId && rowWrId !== workRequestId) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          code: 'REFERENCE_WR_MISMATCH',
          detail: `Disbursement ${disbId} belongs to a different work request.`,
        });
      }
    }
  }

  if (uniqueInvIds.length > 0) {
    const { data: rows, error } = await supabaseAdmin
      .from('invoices')
      .select('id, entity_id, work_request_id, deleted_at')
      .in('id', uniqueInvIds);

    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to validate linked invoices',
      });
    }

    const foundMap = new Map((rows || []).map((r) => [r.id, r]));
    for (const invId of uniqueInvIds) {
      const row = foundMap.get(invId);
      if (
        !row ||
        row.deleted_at ||
        (entityId && entityId !== 'ALL' && row.entity_id !== entityId)
      ) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          code: 'INVALID_INVOICE_LINK',
          detail: `Invoice ${invId} not found or does not belong to this entity.`,
        });
      }
      if (workRequestId && row.work_request_id && row.work_request_id !== workRequestId) {
        throw new AppError({
          statusCode: 400,
          title: 'Validation Error',
          code: 'REFERENCE_WR_MISMATCH',
          detail: `Invoice ${invId} belongs to a different work request.`,
        });
      }
    }
  }

  return { uniqueDisbIds, uniqueInvIds };
};

const applyTransmittalRecordLinks = async ({
  transmittalId,
  disbursementIds,
  invoiceIds,
  userId,
}) => {
  const now = new Date().toISOString();
  if (Array.isArray(disbursementIds) && disbursementIds.length > 0) {
    const { data: currentDisbs, error: fetchDisbErr } = await supabaseAdmin
      .from('disbursements')
      .select('id, entity_id, version, status, linked_transmittal_id')
      .in('id', disbursementIds);

    if (fetchDisbErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to fetch disbursements for transmittal linking',
      });
    }

    for (const row of currentDisbs || []) {
      if (row.linked_transmittal_id === transmittalId) continue;

      const currentVersion = Number(row.version) || 1;
      const nextVersion = currentVersion + 1;
      const auditEntry = {
        status: row.status,
        by: userId,
        at: now,
        action: 'transmittal_linked',
        linked_transmittal_id: transmittalId,
      };

      const { data: updatedDisbRows, error: disbErr } = await supabaseAdmin
        .from('disbursements')
        .update({
          linked_transmittal_id: transmittalId,
          version: nextVersion,
          updated_by: userId,
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('version', currentVersion)
        .select('id');

      if (disbErr) {
        throw new AppError({
          statusCode: 500,
          title: 'Database Error',
          detail: 'Failed to link disbursements to transmittal',
        });
      }

      if (!updatedDisbRows || updatedDisbRows.length === 0) {
        throw new AppError({
          statusCode: 409,
          title: 'Conflict',
          code: 'CONCURRENCY_CONFLICT',
          detail: `Disbursement ${row.id} was modified concurrently while linking to transmittal.`,
        });
      }

      await supabaseAdmin.from('status_history').insert({
        table_name: 'disbursements',
        record_id: row.id,
        old_status: row.status,
        new_status: row.status,
        actor_id: userId,
        entity_id: row.entity_id,
        details: auditEntry,
        created_at: now,
      });
    }
  }

  if (Array.isArray(invoiceIds) && invoiceIds.length > 0) {
    const { data: currentInvs, error: fetchInvErr } = await supabaseAdmin
      .from('invoices')
      .select('id, version, status, linked_transmittal_id')
      .in('id', invoiceIds);

    if (fetchInvErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to fetch invoices for transmittal linking',
      });
    }

    for (const row of currentInvs || []) {
      if (row.linked_transmittal_id === transmittalId) continue;

      const currentVersion = Number(row.version) || 1;
      const nextVersion = currentVersion + 1;

      const { data: updatedInvRows, error: invErr } = await supabaseAdmin
        .from('invoices')
        .update({
          linked_transmittal_id: transmittalId,
          version: nextVersion,
          updated_by: userId,
          updated_at: now,
        })
        .eq('id', row.id)
        .eq('version', currentVersion)
        .select('id');

      if (invErr) {
        throw new AppError({
          statusCode: 500,
          title: 'Database Error',
          detail: 'Failed to link invoices to transmittal',
        });
      }

      if (!updatedInvRows || updatedInvRows.length === 0) {
        throw new AppError({
          statusCode: 409,
          title: 'Conflict',
          code: 'CONCURRENCY_CONFLICT',
          detail: `Invoice ${row.id} was modified concurrently while linking to transmittal.`,
        });
      }
    }
  }
};

/**
 * List transmittals for the active entity.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.filters]
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listTransmittals = async ({ entityId, filters = {}, user }) => {
  if (!user) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to list transmittals',
    });
  }

  const {
    status,
    clientId,
    workRequestId,
    work_request_id,
    linkedWorkRequestId,
    linked_work_request_id,
    search,
    archived,
    includeDeleted,
    page = 1,
    limit = 50,
  } = filters;
  const isArchived = archived === true || archived === 'true';

  const isAdmin = user.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return { data: [], count: 0 };
    }
  }

  const effectiveFilterWrId =
    workRequestId || work_request_id || linkedWorkRequestId || linked_work_request_id;

  const makeQuery = () => {
    let q = supabaseAdmin.from('transmittals').select('*, clients(name, client_number)');

    if (includeDeleted !== true && includeDeleted !== 'true') {
      q = q.is('deleted_at', null);
    }

    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }

    if (isArchived) {
      q = q.eq('archived', true);
    } else if (archived === false || archived === 'false') {
      q = q.eq('archived', false);
    }
    if (status) q = q.eq('status', status);

    if (clientId) q = q.eq('client_id', clientId);
    if (effectiveFilterWrId) q = q.eq('work_request_id', effectiveFilterWrId);
    if (search) {
      q = q.or(
        `tracking_number.ilike.%${search}%,notes.ilike.%${search}%,recipient_name.ilike.%${search}%`
      );
    }
    return q.order('board_order', { ascending: true }).order('created_at', { ascending: false });
  };

  const rawRows = await fetchInPages(makeQuery);

  const validRows = await filterValidProjectRecords(rawRows || [], {
    user,
    entityId,
    concernedWrIds,
  });

  const total = validRows.length;
  const offset = (page - 1) * limit;
  const rows = validRows.slice(offset, offset + limit);

  const { data: entitiesData } = rows.length
    ? await supabaseAdmin.from('entities').select('id, code')
    : { data: [] };
  const entityCodeMap = new Map((entitiesData || []).map((e) => [e.id, e.code]));

  const ids = rows.map((row) => row.id);
  const { data: allItems } = ids.length
    ? await supabaseAdmin
        .from('transmittal_items')
        .select('*')
        .in('transmittal_id', ids)
        .order('sort_order', { ascending: true })
    : { data: [] };

  const itemsByTransmittal = new Map();
  for (const item of allItems || []) {
    const list = itemsByTransmittal.get(item.transmittal_id) || [];
    list.push(item);
    itemsByTransmittal.set(item.transmittal_id, list);
  }

  const wrIds = [...new Set(rows.map((r) => r.work_request_id).filter(Boolean))];
  let wrMap = new Map();
  if (wrIds.length > 0) {
    const { data: wrData } = await supabaseAdmin
      .from('work_requests')
      .select('id, title, work_request_number')
      .in('id', wrIds);
    wrMap = new Map((wrData || []).map((w) => [w.id, w]));
  }

  const mapped = rows.map((row) => {
    const wr = row.work_request_id ? wrMap.get(row.work_request_id) : null;
    const clientNumber = row.clients?.client_number || row.client_number || null;
    const wrNumber = wr?.work_request_number || null;
    return {
      ...row,
      clientNumber,
      client_number: clientNumber,
      workRequestNumber: wrNumber,
      work_request_number: wrNumber,
      work_request_title: wr?.title || null,
      entity_code: entityCodeMap.get(row.entity_id) || row.entity_id,
      items: itemsByTransmittal.get(row.id) || [],
    };
  });

  return { data: mapped, count: total };
};

/**
 * Count transmittals for the active entity (or all entities when entityId is 'ALL').
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<{ active: number, archived: number, total: number }>}
 */
const countTransmittals = async ({ entityId, user }) => {
  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    if (!user) return { active: 0, archived: 0, total: 0 };
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return { active: 0, archived: 0, total: 0 };
    }
  }

  const makeQuery = () => {
    let q = supabaseAdmin.from('transmittals').select('*').is('deleted_at', null);

    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }
    return q.order('created_at', { ascending: false });
  };

  const data = await fetchInPages(makeQuery);

  const validRows = await filterValidProjectRecords(data || [], {
    user,
    entityId,
    concernedWrIds,
  });

  const active = validRows.filter((t) => t.status !== 'Cancelled' && !t.archived).length;
  const archived = validRows.filter((t) => t.archived === true || t.status === 'Cancelled').length;

  return { active, archived, total: validRows.length };
};

/**
 * Authoritatively validates transmittal relationships:
 * - Checks linked task existence, entity, deletion, and that its parent WR matches workRequestId.
 * - Checks work request existence, entity, deletion, and that its client matches clientId.
 * - Enforces task requirement whenever a work request is set.
 * - Enforces task assignment for all non-Admin users (Admin bypass only).
 * - Enforces task selectability (rejecting Cancelled/Completed tasks on new/changed linkages).
 */
const validateTransmittalRelationships = async ({
  entityId,
  clientId,
  workRequestId,
  linkedTaskId,
  userId,
  caller,
  enforceMandatoryTask = true,
  isNewOrChanged = true,
}) => {
  const isAdmin = caller?.role === 'Admin';
  const isDoc = isNonAdminDocumentationUser(caller);

  const hasLinkedTask =
    linkedTaskId && typeof linkedTaskId === 'string' && linkedTaskId.trim() !== '';

  if ((enforceMandatoryTask || isDoc) && !hasLinkedTask) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'A valid linked task is required for transmittals',
      code: 'TASK_REQUIRED',
    });
  }

  let task = null;
  if (hasLinkedTask) {
    const { data: taskRow, error: taskErr } = await supabaseAdmin
      .from('tasks')
      .select('id, work_request_id, assignee_id, status, phase, predecessors, deleted_at')
      .eq('id', linkedTaskId)
      .maybeSingle();

    if (taskErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: taskErr.message,
      });
    }

    if (!taskRow || Boolean(taskRow.deleted_at)) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Linked task not found or has been deleted',
        code: 'TASK_NOT_FOUND',
      });
    }

    task = taskRow;

    const requireAssignment = enforceMandatoryTask ? !isAdmin : isDoc;
    if (requireAssignment) {
      const assigned = await isUserAssignedToTask(linkedTaskId, userId);
      if (!assigned) {
        throw new AppError({
          statusCode: 403,
          title: 'Forbidden',
          detail: 'You are not assigned to this task',
          code: 'TASK_ASSIGNMENT_REQUIRED',
        });
      }
    }

    if (workRequestId && task.work_request_id && task.work_request_id !== workRequestId) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Linked task does not belong to the specified work request',
        code: 'TASK_WR_MISMATCH',
      });
    }

    if (enforceMandatoryTask && isNewOrChanged && task.status) {
      const normStatus = String(task.status).trim().toLowerCase();
      if (normStatus === 'cancelled') {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Task is cancelled and cannot be linked',
          code: 'TASK_NOT_SELECTABLE',
        });
      }
      if (normStatus === 'completed' || normStatus === 'done') {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Completed tasks cannot be linked to this record',
          code: 'TASK_NOT_SELECTABLE',
        });
      }
    }
  }

  const effectiveWrId = workRequestId || (task ? task.work_request_id : null);
  let wr = null;
  if (effectiveWrId) {
    const { data: wrRow, error: wrErr } = await supabaseAdmin
      .from('work_requests')
      .select('id, client_id, entity_id, phase, deleted_at')
      .eq('id', effectiveWrId)
      .maybeSingle();

    if (wrErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: wrErr.message,
      });
    }

    if (!wrRow || Boolean(wrRow.deleted_at)) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Work request not found or has been deleted',
      });
    }

    wr = wrRow;

    if (entityId && entityId !== 'ALL' && wrRow.entity_id && wrRow.entity_id !== entityId) {
      const wrCode = await resolveEntityCode(wrRow.entity_id);
      const activeCode = await resolveEntityCode(entityId);
      if (
        wrCode &&
        activeCode &&
        wrCode !== 'ALL' &&
        activeCode !== 'ALL' &&
        String(wrCode).toUpperCase() !== String(activeCode).toUpperCase()
      ) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Work request does not belong to active entity',
        });
      }
    }

    if (clientId && wrRow.client_id && wrRow.client_id !== clientId) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Client does not match work request client',
      });
    }
  }

  if (task && enforceMandatoryTask && isNewOrChanged) {
    await assertTaskPhaseAndPrerequisitesSelectable(task, wr, 'transmittal');
  }
};

/**
 * Create a transmittal with items.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const createTransmittal = async ({ entityId, entityCode, userId, user, data }) => {
  const caller = await resolveEffectiveUser(user, userId);
  await validateTransmittalRelationships({
    entityId,
    clientId: data.clientId,
    workRequestId: data.workRequestId,
    linkedTaskId: data.linkedTaskId,
    userId,
    caller,
  });

  const { uniqueDisbIds, uniqueInvIds } = await validateRecordsForTransmittal({
    entityId,
    workRequestId: data.workRequestId,
    linkedDisbursementIds: data.linkedDisbursementIds,
    linkedInvoiceIds: data.linkedInvoiceIds,
  });

  let trackingNumber = data.trackingNumber;
  if (!trackingNumber) {
    const rawCode = entityCode || (await resolveEntityCode(entityId)) || 'ATA';
    const code = rawCode === 'ALL' ? 'ATA' : rawCode;
    const year = new Date().getFullYear();
    const prefix = `TR-${code}-${year}`;
    const { data: seq, error: seqErr } = await supabaseAdmin.rpc('next_document_sequence', {
      p_prefix: prefix,
    });
    if (seqErr) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Unable to generate tracking sequence',
      });
    }
    trackingNumber = (typeof seq === 'string' && seq.length > 0) ? seq : `${prefix}-0001`;
  }

  const row = {
    tracking_number: trackingNumber,
    entity_id: entityId,
    client_id: data.clientId,
    work_request_id: data.workRequestId || null,
    linked_task_id: data.linkedTaskId || null,
    status: 'Draft',
    approved: false,
    board_order: data.boardOrder ?? 0,
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
        detail: `Tracking number "${trackingNumber}" already exists for this entity`,
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

  if (uniqueDisbIds.length > 0 || uniqueInvIds.length > 0) {
    await applyTransmittalRecordLinks({
      transmittalId: transmittal.id,
      disbursementIds: uniqueDisbIds,
      invoiceIds: uniqueInvIds,
      userId,
    });
  }

  await auditService.log({
    action: 'transmittal.create',
    table: 'transmittals',
    recordId: transmittal.id,
    entity: entityId,
    userId,
    details: { trackingNumber, itemCount: items.length },
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
const getTransmittalById = async ({ entityId, id, user, internal = false }) => {
  let query = supabaseAdmin
    .from('transmittals')
    .select('*, clients(name, address, tin, client_number)')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data: transmittal, error } = await query.single();

  if (error || !transmittal) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Transmittal ${id} not found`,
    });
  }

  if (!internal) {
    if (!user) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Authentication required to view transmittal',
      });
    }

    await validateRecordProjectLinkage({
      record: transmittal,
      entityId,
      user,
      internal: false,
    });
  }

  const [
    { data: items },
    { data: entity },
    { data: linkedDisbursements },
    { data: linkedInvoices },
  ] = await Promise.all([
    supabaseAdmin
      .from('transmittal_items')
      .select('*')
      .eq('transmittal_id', id)
      .order('sort_order', { ascending: true }),
    supabaseAdmin
      .from('entities')
      .select('code')
      .eq('id', transmittal.entity_id)
      .maybeSingle(),
    supabaseAdmin
      .from('disbursements')
      .select(
        'id, disbursement_number, category, description, amount, fund_source, status, receipt_filename, created_at'
      )
      .eq('linked_transmittal_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('invoices')
      .select(
        'id, invoice_number, status, total, amount_paid, balance, issue_date, due_date'
      )
      .eq('linked_transmittal_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  let wrNumber = null;
  let wrTitle = null;
  if (transmittal.work_request_id) {
    const { data: wr } = await supabaseAdmin
      .from('work_requests')
      .select('id, title, work_request_number')
      .eq('id', transmittal.work_request_id)
      .maybeSingle();
    wrNumber = wr?.work_request_number || null;
    wrTitle = wr?.title || null;
  }

  const clientNumber = transmittal.clients?.client_number || transmittal.client_number || null;

  return {
    ...transmittal,
    clientNumber,
    client_number: clientNumber,
    workRequestNumber: wrNumber,
    work_request_number: wrNumber,
    work_request_title: wrTitle,
    entity_code: entity?.code || transmittal.entity_code,
    items: items || [],
    linked_disbursements: linkedDisbursements || [],
    linked_invoices: linkedInvoices || [],
  };
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
const updateTransmittal = async ({ entityId, id, userId, user, data, internal = false }) => {
  const caller = await resolveEffectiveUser(user, userId, internal);
  const existing = await getTransmittalById({ entityId, id, user: caller, internal });

  const isUserAdmin = caller?.role === 'Admin';

  // Board-order reordering is allowed for any status so the kanban board can
  // persist drag-and-drop order in Sent/Acknowledged columns. All other edits
  // remain restricted to Draft transmittals except for authenticated Admin corrections.
  const hasNonOrderEdit =
    data.clientId !== undefined ||
    data.workRequestId !== undefined ||
    data.linkedTaskId !== undefined ||
    data.notes !== undefined ||
    data.recipientName !== undefined ||
    data.recipientDetails !== undefined ||
    data.items !== undefined;

  if (existing.status !== 'Draft' && hasNonOrderEdit && !isUserAdmin) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Cannot edit transmittal in "${existing.status}" status. Only Draft transmittals can be edited.`,
    });
  }

  const isTaskSpecified = data.linkedTaskId !== undefined;
  const isWrSpecified = data.workRequestId !== undefined;
  const isLinkageInPayload = isTaskSpecified || isWrSpecified;
  const effectiveLinkedTaskId =
    isTaskSpecified ? data.linkedTaskId : existing.linked_task_id;
  const effectiveWorkRequestId =
    isWrSpecified ? data.workRequestId : existing.work_request_id;
  const effectiveClientId =
    data.clientId !== undefined ? data.clientId : existing.client_id;

  const isTaskChanged = isTaskSpecified && data.linkedTaskId !== existing.linked_task_id;
  const isWrChanged = isWrSpecified && data.workRequestId !== existing.work_request_id;
  const isLinkageChanged = isTaskChanged || isWrChanged;

  if (isLinkageInPayload) {
    if (
      !effectiveLinkedTaskId ||
      String(effectiveLinkedTaskId).trim() === '' ||
      !effectiveWorkRequestId ||
      String(effectiveWorkRequestId).trim() === ''
    ) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'A valid linked task is required for transmittals',
        code: 'TASK_REQUIRED',
      });
    }

    if (!isLinkageChanged && existing.linked_task_id && effectiveWorkRequestId) {
      const { data: storedTask } = await supabaseAdmin
        .from('tasks')
        .select('id, deleted_at')
        .eq('id', existing.linked_task_id)
        .maybeSingle();

      if (!storedTask || Boolean(storedTask.deleted_at)) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'The previously linked task has been deleted. A valid linked task is required.',
          code: 'TASK_REQUIRED',
        });
      }
    }
  }

  await validateTransmittalRelationships({
    entityId,
    clientId: effectiveClientId,
    workRequestId: effectiveWorkRequestId,
    linkedTaskId: effectiveLinkedTaskId,
    userId,
    caller,
    enforceMandatoryTask: isLinkageInPayload,
    isNewOrChanged: isLinkageChanged,
  });

  const { uniqueDisbIds, uniqueInvIds } = await validateRecordsForTransmittal({
    entityId: existing.entity_id || entityId,
    workRequestId: effectiveWorkRequestId,
    linkedDisbursementIds: data.linkedDisbursementIds,
    linkedInvoiceIds: data.linkedInvoiceIds,
  });

  const updates = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (data.clientId !== undefined) updates.client_id = data.clientId;
  if (data.workRequestId !== undefined) updates.work_request_id = data.workRequestId;
  if (data.linkedTaskId !== undefined) updates.linked_task_id = data.linkedTaskId;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.recipientName !== undefined) updates.recipient_name = data.recipientName;
  if (data.recipientDetails !== undefined) updates.recipient_details = data.recipientDetails;
  if (data.boardOrder !== undefined) updates.board_order = data.boardOrder;

  // OCC (Spec 2.2 / R-10): version-guard the update when the client declares
  // the version it read; zero matching rows become a 409 conflict.
  const expectedVersion = resolveExpectedVersion(data);
  if (expectedVersion !== null) {
    updates.version = (existing.version || 1) + 1;
  }

  let query = supabaseAdmin
    .from('transmittals')
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
      detail: 'Failed to update transmittal',
    });
  }

  if (!updated) {
    if (expectedVersion !== null) {
      throw concurrencyConflict();
    }
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Transmittal ${id} not found`,
    });
  }

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

  if (uniqueDisbIds.length > 0 || uniqueInvIds.length > 0) {
    await applyTransmittalRecordLinks({
      transmittalId: id,
      disbursementIds: uniqueDisbIds,
      invoiceIds: uniqueInvIds,
      userId,
    });
  }

  return attachItems(updated);
};

/**
 * Send a transmittal. Draft → Sent.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @returns {Promise<object>}
 */
/**
 * Approve a transmittal.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @returns {Promise<object>}
 */
const approveTransmittal = async ({ entityId, id, userId, user, internal = false }) => {
  const caller = await resolveEffectiveUser(user, userId, internal);
  const existing = await getTransmittalById({ entityId, id, user: caller, internal });

  if (existing.status !== 'Draft') {
    throw new AppError({
      statusCode: 409,
      title: 'Invalid State',
      detail: `Cannot approve a transmittal in "${existing.status}" status. Must be Draft.`,
    });
  }

  const updates = {
    approved: true,
    status: 'Sent',
    sent_at: new Date().toISOString(),
    sent_by: userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

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
      detail: 'Failed to approve transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.approve',
    table: 'transmittals',
    recordId: id,
    entity: existing.entity_code || 'ATA',
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  await auditService.log({
    action: 'transmittal.send',
    table: 'transmittals',
    recordId: id,
    entity: existing.entity_code || 'ATA',
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return attachItems(updated);
};

const sendTransmittal = async ({ entityId, id, userId, user, boardOrder, internal = false }) => {
  const caller = await resolveEffectiveUser(user, userId, internal);
  const existing = await getTransmittalById({ entityId, id, user: caller, internal });

  if (existing.status !== 'Draft') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Cannot send a transmittal in "${existing.status}" status. Must be Draft.`,
    });
  }

  const isUserAdmin = caller?.role === 'Admin';
  if (!isUserAdmin && !existing.approved) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Cannot send transmittal because it has not been approved by Admin.',
    });
  }

  await validateTransmittalRelationships({
    entityId,
    clientId: existing.client_id,
    workRequestId: existing.work_request_id,
    linkedTaskId: existing.linked_task_id,
    userId,
    caller,
    enforceMandatoryTask: false,
    isNewOrChanged: false,
  });

  const updates = {
    status: 'Sent',
    sent_at: new Date().toISOString(),
    sent_by: userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (isUserAdmin) {
    updates.approved = true;
  }
  if (boardOrder !== undefined) updates.board_order = boardOrder;

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
      detail: 'Failed to send transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.send',
    table: 'transmittals',
    recordId: id,
    entity: existing.entity_code || 'ATA',
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return attachItems(updated);
};

/**
 * Acknowledge a transmittal. Sent → Acknowledged.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @returns {Promise<object>}
 */
const acknowledgeTransmittal = async ({ entityId, id, userId, user, boardOrder, internal = false }) => {
  const caller = await resolveEffectiveUser(user, userId, internal);
  const existing = await getTransmittalById({ entityId, id, user: caller, internal });

  if (existing.status !== 'Sent') {
    throw new AppError({
      statusCode: 409,
      title: 'Invalid Transition',
      detail: `Cannot acknowledge a transmittal in "${existing.status}" status. Must be Sent.`,
    });
  }

  const updates = {
    status: 'Acknowledged',
    acknowledged_at: new Date().toISOString(),
    acknowledged_by: userId,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };
  if (boardOrder !== undefined) updates.board_order = boardOrder;

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
      detail: 'Failed to acknowledge transmittal',
    });
  }

  await auditService.log({
    action: 'transmittal.acknowledge',
    table: 'transmittals',
    recordId: id,
    entity: existing.entity_code || 'ATA',
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return attachItems(updated);
};

/**
 * Soft-delete a transmittal.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 */
const deleteTransmittal = async ({ entityId, id, userId, user, internal = false }) => {
  const caller = await resolveEffectiveUser(user, userId, internal);
  const existing = await getTransmittalById({ entityId, id, user: caller, internal });

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
    entity: existing.entity_code || 'ATA',
    userId,
    details: { trackingNumber: existing.tracking_number },
  });
};

const archiveTransmittal = async ({ entityId, id, userId, user, internal = false }) => {
  const caller = await resolveEffectiveUser(user, userId, internal);
  const existing = await getTransmittalById({ entityId, id, user: caller, internal });

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
    entity: existing.entity_code || 'ATA',
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return attachItems(updated);
};

const unarchiveTransmittal = async ({ entityId, id, userId, user, internal = false }) => {
  const caller = await resolveEffectiveUser(user, userId, internal);
  const existing = await getTransmittalById({ entityId, id, user: caller, internal });
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
    entity: existing.entity_code || 'ATA',
    userId,
    details: { trackingNumber: existing.tracking_number },
  });

  return attachItems(updated);
};

const attachItems = async (transmittal) => {
  if (!transmittal) return transmittal;
  const { data: items } = await supabaseAdmin
    .from('transmittal_items')
    .select('*')
    .eq('transmittal_id', transmittal.id)
    .order('sort_order', { ascending: true });
  return { ...transmittal, items: items || [] };
};

module.exports = {
  listTransmittals,
  countTransmittals,
  createTransmittal,
  getTransmittalById,
  updateTransmittal,
  approveTransmittal,
  sendTransmittal,
  acknowledgeTransmittal,
  archiveTransmittal,
  unarchiveTransmittal,
  deleteTransmittal,
  isDocumentationUser,
  isNonAdminDocumentationUser,
};
