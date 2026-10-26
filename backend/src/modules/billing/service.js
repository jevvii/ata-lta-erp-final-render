/**
 * Billing service.
 * Business logic for invoices, payments, aging, PDF generation,
 * and billing templates.
 *
 * Phase 5 — Agent B
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const { uploadBuffer } = require('../../services/storageService');
const { generatePdf } = require('../../services/pdfService');
const {
  buildStatementDocument,
  STATEMENT_CSS,
  resolvePaymentProperties,
  esc,
} = require('./statementDocument');
const fs = require('fs');
const path = require('path');
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');
const { resolveEntityCode } = require('../../lib/entityResolver');
const { buildPermissionSet, hasPermission } = require('../../lib/permissions');
const {
  normalizeTaskAndParentAliases,
  resolveTrustedUser,
  resolveAndAuthorizeTaskTarget,
  authorizeTaskRelink,
} = require('../../lib/taskAssignment');
const { getUserConcernedWorkRequestIds, fetchInPages } = require('../../lib/userScope');
const {
  validateRecordProjectLinkage,
  filterValidProjectRecords,
} = require('../../lib/projectLinkage');

// ============================================================
// Invoice CRUD
// ============================================================

/**
 * List invoices for the active entity.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.filters]
 * @returns {Promise<{ data: object[], count: number }>}
 */
const listInvoices = async ({ entityId, filters = {}, user }) => {
  if (!user) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to list invoices',
    });
  }

  const {
    status,
    clientId,
    taskId,
    task_id,
    linkedTaskId,
    linkedTransmittalId,
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

  const effectiveFilterTaskId = taskId || task_id || linkedTaskId;

  const makeQuery = () => {
    let q = supabaseAdmin.from('invoices').select('*, clients(name)');
    if (includeDeleted !== true && includeDeleted !== 'true') {
      q = q.is('deleted_at', null);
    }
    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }
    if (isArchived) {
      q = q.or('archived.eq.true,status.eq.Cancelled');
    } else if (archived === false || archived === 'false') {
      q = q.eq('archived', false).neq('status', 'Cancelled');
    }
    if (status) q = q.eq('status', status);
    if (clientId) q = q.eq('client_id', clientId);
    if (effectiveFilterTaskId) {
      q = q.or(
        `task_id.eq.${effectiveFilterTaskId},linked_task_id.eq.${effectiveFilterTaskId}`
      );
    }
    if (linkedTransmittalId) q = q.eq('linked_transmittal_id', linkedTransmittalId);
    if (search) {
      q = q.or(`invoice_number.ilike.%${search}%,notes.ilike.%${search}%`);
    }
    return q.order('created_at', { ascending: false });
  };

  const rawRows = await fetchInPages(makeQuery);

  // Batch filter to exclude conflicting, corrupt, deleted-parent, or unauthorized rows
  const validRows = await filterValidProjectRecords(rawRows || [], {
    user,
    entityId,
    concernedWrIds,
  });

  const total = validRows.length;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 50);
  const offset = (pageNum - 1) * limitNum;
  const rows = validRows.slice(offset, offset + limitNum);
  const { data: entitiesData } = rows.length
    ? await supabaseAdmin.from('entities').select('id, code')
    : { data: [] };
  const entityCodeMap = new Map((entitiesData || []).map((e) => [e.id, e.code]));

  // Batch resolve parent Work Request and creator (Task A.3)
  const wrIds = [...new Set(rows.map((r) => r.work_request_id).filter(Boolean))];
  let wrMap = new Map();
  let userMap = new Map();

  if (wrIds.length > 0) {
    const { data: wrData } = await supabaseAdmin
      .from('work_requests')
      .select('id, title, work_order_number, created_by')
      .in('id', wrIds);

    const wrs = wrData || [];
    const creatorUserIds = [...new Set(wrs.map((w) => w.created_by).filter(Boolean))];
    if (creatorUserIds.length > 0) {
      const { data: usersData } = await supabaseAdmin
        .from('users')
        .select('id, name, email')
        .in('id', creatorUserIds);
      userMap = new Map((usersData || []).map((u) => [u.id, u]));
    }
    wrMap = new Map(wrs.map((w) => [w.id, w]));
  }

  const mapped = rows.map((row) => {
    const wr = row.work_request_id ? wrMap.get(row.work_request_id) : null;
    const creator = wr?.created_by ? userMap.get(wr.created_by) : null;
    return {
      ...row,
      entity_code: entityCodeMap.get(row.entity_id) || row.entity_id,
      work_request_title: wr?.title || null,
      work_request_creator_name: creator?.name || null,
      work_request: wr
        ? {
            id: wr.id,
            title: wr.title,
            workOrderNumber: wr.work_order_number || null,
            creatorName: creator?.name || null,
            creatorEmail: creator?.email || null,
          }
        : null,
    };
  });

  return { data: mapped, count: total };
};

/**
 * Create an invoice with line items.
 * Calculates subtotal, total, and balance from line items.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.userId
 * @param {object} params.data - Validated invoice data
 * @returns {Promise<object>}
 */
const createInvoice = async ({ entityId, userId, user, data }) => {
  const effectiveUser = await resolveTrustedUser({ user, userId });
  const subtotal = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
  const total = subtotal; // Tax removed per prototype v3 schema

  const requestedStatus = data.status || 'Draft';
  if (['Paid', 'Partially Paid', 'Sent'].includes(requestedStatus)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `New invoices cannot be created directly in "${requestedStatus}" status. Invoices must start in Draft or Pending status.`,
    });
  }

  // Normalize aliases once across root data (Correction 3)
  const { effectiveTaskId, effectiveWrId } = normalizeTaskAndParentAliases(data);

  const authorized = await resolveAndAuthorizeTaskTarget({
    entityId,
    user: effectiveUser,
    userId,
    targetTaskId: effectiveTaskId,
    targetWorkRequestId: effectiveWrId,
    clientId: data.clientId,
    allowNoTask: false,
    recordType: 'invoice',
    enforceSelectability: true,
  });
  const validatedWrId = authorized.effectiveWrId;

  // Atomic create (Spec 2.3 / R-11): the invoice row and its line items are
  // inserted by invoice_create_transactional() inside a single PostgreSQL
  // function transaction. The previous two-round-trip flow attempted a
  // best-effort delete() rollback when the line-item insert failed; a crash or
  // network partition in between left orphaned ₱0 invoices.
  const lineItems = data.lineItems.map((item, idx) => ({
    description: item.description,
    amount: item.amount,
    type: item.type || 'Professional Fee',
    sort_order: idx,
  }));

  const { data: invoice, error: invoiceErr } = await supabaseAdmin.rpc(
    'invoice_create_transactional',
    {
      p_invoice_data: {
        clientId: data.clientId,
        workRequestId: validatedWrId,
        linkedTaskId: effectiveTaskId || null,
        taskId: effectiveTaskId || null,
        task_id: effectiveTaskId || null,
        linkedTransmittalId: data.linkedTransmittalId || null,
        invoiceNumber: data.invoiceNumber,
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        status: requestedStatus,
        subtotal,
        total,
        notes: data.notes || null,
        terms: data.terms || null,
      },
      p_line_items: lineItems,
      p_user_id: userId,
      p_entity_id: entityId,
    }
  );

  if (invoiceErr || !invoice) {
    if (invoiceErr?.code === '23505') {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: `Invoice number "${data.invoiceNumber}" already exists for this entity`,
      });
    }
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create invoice',
    });
  }

  // Shape the returned line items as the callers expect (with invoice_id).
  const createdLineItems = lineItems.map((item) => ({
    ...item,
    invoice_id: invoice.id,
  }));

  await auditService.log({
    action: 'invoice.create',
    table: 'invoices',
    recordId: invoice.id,
    entity: entityId,
    userId,
    details: { invoiceNumber: data.invoiceNumber, total },
  });

  const entityCode = await resolveEntityCode(invoice.entity_id);
  return { ...invoice, entity_code: entityCode, line_items: createdLineItems };
};

/**
 * Get a single invoice with line items and payments.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<object>}
 */
const getInvoiceById = async ({
  entityId,
  id,
  user,
  allowFallback = false,
  checkViewPermissions = true,
  internal = false,
}) => {
  let query = supabaseAdmin
    .from('invoices')
    .select('*, clients(name, tin, address)')
    .eq('id', id)
    .is('deleted_at', null);

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  let { data: invoice, error } = await query.single();

  if ((error || !invoice) && entityId && entityId !== 'ALL' && allowFallback) {
    const { data: fallbackInvoice } = await supabaseAdmin
      .from('invoices')
      .select('*, clients(name, tin, address)')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();

    if (fallbackInvoice) {
      const isAdmin = user?.role === 'Admin';
      const userEntities = (user?.entities || []).map((e) => e.toUpperCase());
      const fallbackEntityCode = await resolveEntityCode(fallbackInvoice.entity_id);
      if (!user || isAdmin || userEntities.includes(fallbackEntityCode)) {
        invoice = fallbackInvoice;
        error = null;
      }
    }
  }

  if (error || !invoice) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Invoice ${id} not found`,
    });
  }

  // Enforce project linkage consistency and user authorization
  if (checkViewPermissions && !internal) {
    await validateRecordProjectLinkage({
      record: invoice,
      entityId: allowFallback ? invoice.entity_id : entityId,
      user,
      internal: false,
    });
  }

  // Fetch line items
  const { data: lineItems, error: lineItemsError } = await supabaseAdmin
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order', { ascending: true });

  if (lineItemsError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: `Failed to retrieve line items for invoice ${id}`,
      code: 'FAILED_LINE_ITEMS_READ',
    });
  }

  // Fetch payments
  const { data: payments, error: paymentsError } = await supabaseAdmin
    .from('invoice_payments')
    .select('*')
    .eq('invoice_id', id)
    .order('payment_date', { ascending: false });

  if (paymentsError) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: `Failed to retrieve payments for invoice ${id}`,
      code: 'FAILED_PAYMENTS_READ',
    });
  }

  // Fetch parent Work Request and creator (Task A.3)
  let workRequestInfo = null;
  if (invoice.work_request_id) {
    const { data: wr } = await supabaseAdmin
      .from('work_requests')
      .select('id, title, work_order_number, created_by')
      .eq('id', invoice.work_request_id)
      .maybeSingle();

    if (wr) {
      let creatorUser = null;
      if (wr.created_by) {
        const { data: u } = await supabaseAdmin
          .from('users')
          .select('id, name, email')
          .eq('id', wr.created_by)
          .maybeSingle();
        creatorUser = u;
      }
      workRequestInfo = {
        id: wr.id,
        title: wr.title,
        workOrderNumber: wr.work_order_number || null,
        creatorName: creatorUser?.name || null,
        creatorEmail: creatorUser?.email || null,
      };
    }
  }

  const entityCode = await resolveEntityCode(invoice.entity_id);
  return {
    ...invoice,
    entity_code: entityCode,
    line_items: lineItems || [],
    payments: payments || [],
    work_request: workRequestInfo,
    work_request_title: workRequestInfo?.title || null,
    work_request_creator_name: workRequestInfo?.creatorName || null,
  };
};

/**
 * Update an invoice and optionally replace line items.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const updateInvoice = async ({ entityId, id, userId, data, user }) => {
  let effectiveUser = user;
  if (!effectiveUser && userId) {
    const { data: u } = await supabaseAdmin
      .from('users')
      .select('id, name, role, departments, entities')
      .eq('id', userId)
      .maybeSingle();
    effectiveUser = u;
  }

  const existing = await getInvoiceById({
    entityId,
    id,
    user: effectiveUser,
    allowFallback: true,
    checkViewPermissions: Boolean(effectiveUser && effectiveUser.role !== 'Admin'),
  });

  const permissions = effectiveUser
    ? effectiveUser.permissions instanceof Set
      ? effectiveUser.permissions
      : buildPermissionSet({
          role: effectiveUser.role || '',
          departments: effectiveUser.departments || [],
        })
    : new Set();
  const isAdminOrBillingEditor =
    effectiveUser?.role === 'Admin' ||
    hasPermission(permissions, 'billing:edit') ||
    hasPermission(permissions, 'billing:*');

  if (data.status !== undefined && data.status !== existing.status) {
    const targetStatus = data.status;
    const currentStatus = existing.status;
    const amountPaid = Number(existing.amount_paid || 0);
    const total = Number(existing.total || 0);
    const balance = Number(existing.balance || 0);

    const isApproving = targetStatus === 'Sent' && ['Draft', 'Pending'].includes(currentStatus);
    const isRejecting = targetStatus === 'Draft' && currentStatus === 'Pending';

    if ((isApproving || isRejecting) && effectiveUser?.role !== 'Admin') {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'Only System Administrators can approve or reject invoices.',
        code: 'FORBIDDEN_INVOICE_APPROVAL',
      });
    }

    // Validate Paid status requirement
    if (targetStatus === 'Paid') {
      if (balance > 0 || amountPaid < total || total <= 0) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: `Cannot set status to Paid — invoice balance is ₱${balance.toFixed(2)}. Full payment must be recorded first.`,
        });
      }
    }

    // Validate Partially Paid status requirement
    if (targetStatus === 'Partially Paid') {
      if (amountPaid <= 0) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Cannot set status to Partially Paid — no payments have been recorded yet.',
        });
      }
      if (balance <= 0) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Invoice is fully paid and cannot be set to Partially Paid.',
        });
      }
    }

    // Validate Overdue status requirement
    if (targetStatus === 'Overdue') {
      const todayStr = new Date().toISOString().slice(0, 10);
      const isPastDue = existing.due_date && existing.due_date.slice(0, 10) < todayStr;
      if (!isPastDue || balance <= 0) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail:
            'Invoice can only be marked Overdue if the due date has passed and balance remains unpaid.',
        });
      }
    }

    // Block direct jump from Draft to Sent/Released (without approval) or Draft/Pending directly to Paid/Partially Paid without payments
    if (currentStatus === 'Draft' && ['Sent', 'Paid', 'Partially Paid'].includes(targetStatus)) {
      if (targetStatus === 'Sent' && isAdminOrBillingEditor) {
        // Allowed: Admin or billing:edit / billing:* can transition from Draft directly to Sent
      } else {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: `Cannot transition invoice directly from Draft to ${targetStatus}. Invoices must be submitted for approval first.`,
        });
      }
    }

    if (currentStatus === 'Pending' && ['Paid', 'Partially Paid'].includes(targetStatus)) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: `Cannot transition invoice directly from Pending to ${targetStatus}. Payments can only be recorded on released invoices.`,
      });
    }
  }

  // Normalize aliases once across update payload (Correction 3)
  const { effectiveTaskId: payloadTaskId, effectiveWrId: payloadWrId } =
    normalizeTaskAndParentAliases(data);

  // Authorize relink / linkage change (Correction 1, 5)
  const relinkResult = await authorizeTaskRelink({
    entityId,
    user: effectiveUser,
    userId,
    existing,
    payloadTaskId,
    payloadWrId,
    clientId: data.clientId,
    recordType: 'invoice',
    allowNoTask: false,
  });

  const effectiveWrId = relinkResult.isLinkageChanged
    ? relinkResult.effectiveWrId
    : payloadWrId !== undefined
      ? payloadWrId
      : existing.work_request_id;
  const effectiveTaskId = relinkResult.isLinkageChanged
    ? relinkResult.effectiveTaskId
    : payloadTaskId !== undefined
      ? payloadTaskId
      : undefined;

  // Restrict financial field, line item, and date/terms edits strictly to Draft invoices (R4 / D3)
  const FINANCIAL_FIELDS = [
    'clientId',
    'workRequestId',
    'work_request_id',
    'linkedWorkRequestId',
    'linked_work_request_id',
    'taskId',
    'task_id',
    'linkedTaskId',
    'linked_task_id',
    'linkedTransmittalId',
    'invoiceNumber',
    'issueDate',
    'dueDate',
    'lineItems',
    'terms',
  ];
  const hasFinancialEdit = FINANCIAL_FIELDS.some((field) => data[field] !== undefined);

  const isAdmin = effectiveUser?.role === 'Admin';
  if (data.printDetails !== undefined && !isAdmin) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only administrators can edit statement details.',
    });
  }
  if (hasFinancialEdit && existing.status !== 'Draft' && !isAdmin) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail:
        'Financial fields and line items can only be modified while invoice is in Draft status.',
      code: 'INVOICE_NOT_DRAFT',
    });
  }

  // Atomic update (Spec 2.3 / R-11) with OCC guard (Spec 2.2 / R-10): field
  // updates, line-item replacement, total/balance recomputation, and the
  // version bump happen inside one PostgreSQL function transaction. When
  // expectedVersion is supplied, a stale write matches zero rows and surfaces
  // as a 409 conflict instead of silently overwriting the other user's edit.
  const expectedVersion =
    data.expectedVersion !== undefined && data.expectedVersion !== null
      ? Number(data.expectedVersion)
      : null;

  if (
    data.lineItems &&
    data.lineItems.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) <
      Math.round(Number(existing.amount_paid || 0) * 100)
  ) {
    throw new AppError({
      statusCode: 400,
      title: 'Invalid total',
      detail: 'Total amount cannot be less than payments already recorded.',
    });
  }
  const rpcUpdates = {};
  if (data.printDetails !== undefined) rpcUpdates.print_details = data.printDetails;
  if (data.clientId !== undefined) rpcUpdates.client_id = data.clientId;
  if (
    data.workRequestId !== undefined ||
    data.work_request_id !== undefined ||
    data.linkedWorkRequestId !== undefined ||
    data.linked_work_request_id !== undefined
  ) {
    rpcUpdates.work_request_id = effectiveWrId;
  }
  if (relinkResult.isLinkageChanged) {
    rpcUpdates.linked_task_id = relinkResult.canonicalPair.linked_task_id;
    rpcUpdates.task_id = relinkResult.canonicalPair.task_id;
  } else if (effectiveTaskId !== undefined) {
    rpcUpdates.linked_task_id = effectiveTaskId;
    rpcUpdates.task_id = effectiveTaskId;
  }
  if (data.linkedTransmittalId !== undefined)
    rpcUpdates.linked_transmittal_id = data.linkedTransmittalId;
  if (data.invoiceNumber !== undefined) rpcUpdates.invoice_number = data.invoiceNumber;
  if (data.issueDate !== undefined) rpcUpdates.issue_date = data.issueDate;
  if (data.dueDate !== undefined) rpcUpdates.due_date = data.dueDate;
  if (data.status !== undefined) rpcUpdates.status = data.status;
  if (data.notes !== undefined) rpcUpdates.notes = data.notes;
  if (data.terms !== undefined) rpcUpdates.terms = data.terms;
  if (data.archived !== undefined) rpcUpdates.archived = data.archived;

  const hasAddress = data.address !== undefined || data.clientAddress !== undefined;
  if (hasAddress) {
    const newAddress = data.address !== undefined ? data.address : data.clientAddress;
    rpcUpdates.address = newAddress;
  }

  const rpcLineItems = data.lineItems
    ? data.lineItems.map((item, idx) => ({
        description: item.description,
        amount: item.amount,
        type: item.type || 'Professional Fee',
        sort_order: idx,
      }))
    : null;

  const { data: updated, error } = await supabaseAdmin.rpc('invoice_update_transactional', {
    p_invoice_id: id,
    p_updates: rpcUpdates,
    p_line_items: rpcLineItems,
    p_user_id: userId,
    p_entity_id: existing.entity_id || entityId,
    p_expected_version: expectedVersion,
  });

  if (error) {
    if (error.message?.includes('INVOICE_TOTAL_BELOW_PAID')) {
      throw new AppError({
        statusCode: 400,
        title: 'Invalid total',
        detail: 'Total amount cannot be less than payments already recorded.',
      });
    }
    if (error.message?.includes('ERR_CONCURRENCY_CONFLICT') || error.code === 'P0001') {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail:
          'The record was modified by another user. Please reload the latest version before editing.',
        code: 'ERR_CONCURRENCY_CONFLICT',
      });
    }
    if (error.message?.includes('INVOICE_NOT_DRAFT') || error.code === 'P0002') {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail:
          'Financial fields and line items can only be modified while invoice is in Draft status.',
        code: 'INVOICE_NOT_DRAFT',
      });
    }
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update invoice',
    });
  }

  if (!updated) {
    // Zero rows updated: the record was fetched above, so it exists — a NULL
    // return means the version guard rejected a stale write.
    if (expectedVersion !== null) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail:
          'The record was modified by another user. Please reload the latest version before editing.',
        code: 'ERR_CONCURRENCY_CONFLICT',
      });
    }
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Invoice ${id} not found`,
    });
  }

  // Field-level audit logging for client address update on billing record (AC-4, R4).
  // Master clients table row is NOT mutated.
  if (hasAddress) {
    const newAddress = data.address !== undefined ? data.address : data.clientAddress;
    let oldAddress = existing.address || existing.clients?.address || null;
    if (!oldAddress && (existing.client_id || existing.clientId)) {
      const clientId = existing.client_id || existing.clientId;
      const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('address')
        .eq('id', clientId)
        .maybeSingle();
      if (clientRow?.address) {
        oldAddress = clientRow.address;
      }
    }
    await auditService.log({
      action: 'billing.address_update',
      table: 'invoices',
      recordId: id,
      entity: entityId,
      userId,
      details: {
        field: 'address',
        from: oldAddress,
        to: newAddress,
      },
    });
  }

  if (data.status === 'Sent' && existing.status === 'Draft' && isAdminOrBillingEditor) {
    await auditService.log({
      action: 'billing.direct_approval',
      table: 'invoices',
      recordId: id,
      entity: entityId,
      userId,
      details: {
        from: 'Draft',
        to: 'Sent',
        note: `Directly approved and issued by Admin: ${effectiveUser?.name || userId}`,
      },
    });
  }

  const entityCode = await resolveEntityCode(updated.entity_id);
  return { ...updated, entity_code: entityCode };
};

/**
 * Update invoice status directly (e.g. for status transitions).
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @param {string} params.status
 * @param {object} [params.user]
 * @returns {Promise<object>}
 */
const updateInvoiceStatus = async ({ entityId, id, userId, status, user }) => {
  return updateInvoice({ entityId, id, userId, data: { status }, user });
};

/**
 * Soft-delete an invoice.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {string} params.userId
 * @returns {Promise<void>}
 */
const deleteInvoice = async ({ entityId, id, userId }) => {
  await getInvoiceById({ entityId, id, internal: true });

  const { error } = await supabaseAdmin
    .from('invoices')
    .update({
      deleted_at: new Date().toISOString(),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to delete invoice',
    });
  }
};

// ============================================================
// Payments
// ============================================================

/**
 * Record a payment against an invoice.
 * Updates the invoice's amount_paid, balance, and status.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.invoiceId
 * @param {string} params.userId
 * @param {object} params.data - Payment data
 * @returns {Promise<object>}
 */
const recordPayment = async ({ entityId, invoiceId, userId, user, data }) => {
  const invoice = await getInvoiceById({ entityId, id: invoiceId, user });
  const releasedStatuses = ['Sent', 'Approved', 'Partially Paid', 'Overdue'];

  if (!releasedStatuses.includes(invoice.status)) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Cannot record payment on invoice in "${invoice.status}" status. Payments can only be recorded once the invoice is released (Approved, Sent, Partially Paid, or Overdue).`,
    });
  }

  const { data: result, error: rpcError } = await supabaseAdmin.rpc('invoice_record_payment', {
    p_invoice_id: invoiceId,
    p_amount: data.amount,
    p_method: data.method,
    p_reference: data.reference || null,
    p_payment_date: data.date,
    p_recorded_by: userId,
    p_entity_id: entityId,
    p_notes: data.notes || null,
  });

  if (rpcError) {
    if (rpcError.code === 'P0001') {
      throw new AppError({
        statusCode: 409,
        title: 'Overpayment',
        detail: rpcError.message || 'Payment would exceed invoice balance',
        code: 'OVERPAYMENT',
      });
    }
    if (rpcError.code === 'P0002') {
      throw new AppError({
        statusCode: 404,
        title: 'Not Found',
        detail: 'Invoice not found',
      });
    }
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to record payment',
    });
  }

  const payment = result?.payment;

  await auditService.log({
    action: 'invoice.payment',
    table: 'invoice_payments',
    recordId: payment?.id,
    entity: entityId,
    userId,
    details: { invoiceId, amount: data.amount, method: data.method },
  });

  return payment;
};

// ============================================================
// PDF Generation
// ============================================================

/**
 * Generate an invoice PDF.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id - Invoice UUID
 * @returns {Promise<{ url: string }>}
 */
const generateInvoicePdf = async ({ entityId, entityCode, id, includeCompanyDetails = true, user }) => {
  const invoice = await getInvoiceById({ entityId, id, user });

  const code = entityCode || entityId;
  let body = buildStatementDocument({ ...invoice, entity_code: code }, { includeCompanyDetails });
  // Embed deployed backend assets: PDF rendering has no frontend base URL.
  if (includeCompanyDetails) {
    const logo = code === 'LTA' ? 'LTA-LOGO.jpg' : 'ATA-LOGO.jpg';
    const data = fs.readFileSync(path.join(__dirname, 'assets', logo)).toString('base64');
    body = body.replace(`/ERP_Assets/${logo}`, `data:image/jpeg;base64,${data}`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${STATEMENT_CSS}</style></head><body>${body}</body></html>`;
  const pdfBuffer = await generatePdf({ html, options: { format: 'A4', preferCSSPageSize: true } });

  // Preserve the documented branded filename and replace each variant on regeneration.
  const suffix = includeCompanyDetails ? '' : '-no-company-details';
  const storagePath = `entities/${code}/invoices/${id}/pdf/${invoice.invoice_number}${suffix}.pdf`;
  const downloadUrl = await uploadBuffer({
    path: storagePath,
    buffer: pdfBuffer,
    contentType: 'application/pdf',
  });

  return { url: downloadUrl };
};

/**
 * Generate a voucher PDF for an invoice.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id - Invoice UUID
 * @returns {Promise<{ url: string }>}
 */
const generateVoucherPdf = async ({ entityId, entityCode, id, user }) => {
  const invoice = await getInvoiceById({ entityId, id, user });

  const code = entityCode || entityId;
  const html = buildVoucherHtml(invoice, code);
  const pdfBuffer = await generatePdf({ html, options: { format: 'A4' } });

  const storagePath = `entities/${code}/invoices/${id}/voucher/${invoice.invoice_number}-voucher.pdf`;
  const downloadUrl = await uploadBuffer({
    path: storagePath,
    buffer: pdfBuffer,
    contentType: 'application/pdf',
  });

  return { url: downloadUrl };
};

/**
 * Build HTML for payment voucher PDF.
 * @param {object} invoice - Invoice with payments
 * @param {string} entityId - Entity code
 * @returns {string} HTML string
 */
const buildVoucherHtml = (invoice, entityId) => {
  const entityName =
    entityId === 'ATA' ? 'Amaya Tan & Associates' : 'LTA — Lanting Tan & Associates';

  const paymentRows = (invoice.payments || [])
    .map((p, idx) => {
      const resolved = resolvePaymentProperties(p);
      const dateVal = p.payment_date || resolved?.payment_date || '-';
      const methodVal = resolved?.method || '-';
      const refVal = resolved?.reference || '-';
      const amountVal = Number(resolved?.amount ?? p.amount ?? 0);
      return `
    <tr>
      <td>${idx + 1}</td>
      <td>${esc(dateVal)}</td>
      <td>${esc(methodVal)}</td>
      <td>${esc(refVal)}</td>
      <td style="text-align: right;">₱${amountVal.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
    </tr>
  `;
    })
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    .header { border-bottom: 2px solid #1a365d; padding-bottom: 20px; margin-bottom: 20px; }
    .entity-name { font-size: 24px; font-weight: bold; color: #1a365d; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
    th { background: #f0f4f8; }
    .signatures { display: flex; justify-content: space-between; margin-top: 60px; }
    .sig-block { text-align: center; width: 200px; border-top: 1px solid #333; padding-top: 5px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="entity-name">${entityName}</div>
    <div>PAYMENT VOUCHER</div>
  </div>
  <p><strong>Invoice #:</strong> ${invoice.invoice_number}</p>
  <p><strong>Client:</strong> ${invoice.clients?.name || 'N/A'}</p>
  <p><strong>Total Amount:</strong> ₱${Number(invoice.total).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
  <table>
    <thead><tr><th>#</th><th>Date</th><th>Method</th><th>Reference</th><th style="text-align: right;">Amount</th></tr></thead>
    <tbody>${paymentRows || '<tr><td colspan="5">No payments recorded</td></tr>'}</tbody>
  </table>
  <p><strong>Balance:</strong> ₱${Number(invoice.balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</p>
  <div class="signatures">
    <div class="sig-block">Prepared By</div>
    <div class="sig-block">Approved By</div>
    <div class="sig-block">Received By</div>
  </div>
</body>
</html>`;
};

// ============================================================
// Aging Report
// ============================================================

/**
 * Calculate accounts receivable aging report.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<{ summary: object, details: object[] }>}
 */
const getAgingReport = async ({ entityId, user }) => {
  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    if (!user) {
      return {
        summary: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, grandTotal: 0 },
        details: {
          current: { total: 0, invoices: [] },
          '1-30': { total: 0, invoices: [] },
          '31-60': { total: 0, invoices: [] },
          '61-90': { total: 0, invoices: [] },
          '90+': { total: 0, invoices: [] },
        },
      };
    }
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return {
        summary: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, grandTotal: 0 },
        details: {
          current: { total: 0, invoices: [] },
          '1-30': { total: 0, invoices: [] },
          '31-60': { total: 0, invoices: [] },
          '61-90': { total: 0, invoices: [] },
          '90+': { total: 0, invoices: [] },
        },
      };
    }
  }

  const makeQuery = () => {
    let q = supabaseAdmin
      .from('invoices')
      .select('*, clients(name)')
      .is('deleted_at', null)
      .gt('balance', 0);

    if (entityId && entityId !== 'ALL') {
      q = q.eq('entity_id', entityId);
    }
    return q.order('created_at', { ascending: false });
  };

  const rawInvoices = await fetchInPages(makeQuery);

  const invoices = await filterValidProjectRecords(rawInvoices || [], {
    user,
    entityId,
    concernedWrIds,
  });

  const now = new Date();
  const buckets = {
    current: { total: 0, invoices: [] },
    '1-30': { total: 0, invoices: [] },
    '31-60': { total: 0, invoices: [] },
    '61-90': { total: 0, invoices: [] },
    '90+': { total: 0, invoices: [] },
  };

  for (const inv of invoices || []) {
    const dueDate = new Date(inv.due_date);
    const daysOverdue = Math.floor((now - dueDate) / (1000 * 60 * 60 * 24));
    const balance = parseFloat(inv.balance);

    const entry = {
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      clientName: inv.clients?.name || 'Unknown',
      clientId: inv.client_id,
      dueDate: inv.due_date,
      total: parseFloat(inv.total),
      balance,
      daysOverdue: Math.max(daysOverdue, 0),
    };

    if (daysOverdue <= 0) {
      buckets.current.total += balance;
      buckets.current.invoices.push(entry);
    } else if (daysOverdue <= 30) {
      buckets['1-30'].total += balance;
      buckets['1-30'].invoices.push(entry);
    } else if (daysOverdue <= 60) {
      buckets['31-60'].total += balance;
      buckets['31-60'].invoices.push(entry);
    } else if (daysOverdue <= 90) {
      buckets['61-90'].total += balance;
      buckets['61-90'].invoices.push(entry);
    } else {
      buckets['90+'].total += balance;
      buckets['90+'].invoices.push(entry);
    }
  }

  const grandTotal = Object.values(buckets).reduce((sum, b) => sum + b.total, 0);

  return {
    summary: {
      current: buckets.current.total,
      '1-30': buckets['1-30'].total,
      '31-60': buckets['31-60'].total,
      '61-90': buckets['61-90'].total,
      '90+': buckets['90+'].total,
      grandTotal,
    },
    details: buckets,
  };
};

// ============================================================
// Counts for tab badges (no full-table scans)
// ============================================================

/**
 * Count invoices grouped for module tab badges.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<{ active: number, archived: number, rejected: number, templates: number }>}
 */
const VALID_ENTITY_CODES = ['ATA', 'LTA'];

const getInvoiceCounts = async ({ entityId, user }) => {
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
    return { active: 0, archived: 0, rejected: 0, templates: 0 };
  }

  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = [];
  if (!isAdmin) {
    if (!user) return { active: 0, archived: 0, rejected: 0, templates: 0 };
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return { active: 0, archived: 0, rejected: 0, templates: 0 };
    }
  }

  const runCount = async (query) => {
    const { count, error } = await query;
    if (error) {
      throw new AppError({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Failed to count invoices',
      });
    }
    return count || 0;
  };

  const baseQuery = () => {
    let q = supabaseAdmin
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .in('entity_id', entityIds)
      .is('deleted_at', null);
    if (!isAdmin) {
      q = q.in('work_request_id', concernedWrIds);
    }
    return q;
  };

  const activeQuery = baseQuery().neq('status', 'Cancelled').neq('archived', true);

  const [active, cancelled, paidArchived, pendingRejected, opsRejected, templates] =
    await Promise.all([
      runCount(activeQuery),
      runCount(baseQuery().eq('status', 'Cancelled')),
      runCount(baseQuery().eq('status', 'Paid').eq('archived', true)),
      runCount(
        supabaseAdmin
          .from('pending_changes')
          .select('*', { count: 'exact', head: true })
          .in('entity_id', entityIds)
          .eq('table_name', 'invoices')
          .eq('status', 'rejected')
      ),
      runCount(
        (() => {
          let q = supabaseAdmin
            .from('operations_requests')
            .select('*', { count: 'exact', head: true })
            .in('entity_id', entityIds)
            .eq('type', 'billing')
            .eq('status', 'rejected');
          if (!isAdmin) {
            q = q.in('work_request_id', concernedWrIds);
          }
          return q;
        })()
      ),
      runCount(
        supabaseAdmin
          .from('billing_templates')
          .select('*', { count: 'exact', head: true })
          .in('entity_id', entityIds)
          .is('deleted_at', null)
      ),
    ]);

  const archived = cancelled + paidArchived;
  const rejected = pendingRejected + opsRejected;

  return {
    active: Math.max(active, 0),
    archived,
    rejected,
    templates,
  };
};

// ============================================================
// Billing Templates
// ============================================================

/**
 * List billing templates for the entity.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<object[]>}
 */
const listTemplates = async ({ entityId }) => {
  let query = supabaseAdmin
    .from('billing_templates')
    .select('*, entities(code), clients(name)')
    .is('deleted_at', null)
    .eq('active', true)
    .order('name', { ascending: true });

  if (entityId && entityId !== 'ALL') {
    query = query.eq('entity_id', entityId);
  }

  const { data, error } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch billing templates',
    });
  }

  return data || [];
};

/**
 * Create a billing template.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.userId
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const createTemplate = async ({ entityId, userId, data }) => {
  const row = {
    name: data.name,
    entity_id: entityId,
    client_id: data.clientId || null,
    schedule: data.schedule || null,
    pf_amount: data.pfAmount || 0,
    line_items: data.lineItems || [],
    active: true,
    created_by: userId,
  };

  const { data: template, error } = await supabaseAdmin
    .from('billing_templates')
    .insert(row)
    .select('*, entities(code), clients(name)')
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create billing template',
    });
  }

  return template;
};

/**
 * Update a billing template.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @param {object} params.data
 * @returns {Promise<object>}
 */
const updateTemplate = async ({ entityId, id, data }) => {
  const updates = { updated_at: new Date().toISOString() };

  if (data.name !== undefined) updates.name = data.name;
  if (data.clientId !== undefined) updates.client_id = data.clientId;
  if (data.schedule !== undefined) updates.schedule = data.schedule;
  if (data.pfAmount !== undefined) updates.pf_amount = data.pfAmount;
  if (data.lineItems !== undefined) updates.line_items = data.lineItems;

  const { data: updated, error } = await supabaseAdmin
    .from('billing_templates')
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
      detail: `Billing template ${id} not found`,
    });
  }

  return updated;
};

/**
 * Soft-delete a billing template.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<void>}
 */
const deleteTemplate = async ({ entityId, id }) => {
  const { error } = await supabaseAdmin
    .from('billing_templates')
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq('id', id)
    .eq('entity_id', entityId);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to delete billing template',
    });
  }
};

const archiveInvoice = async ({ entityId, id, userId, user, caller, internal = false }) => {
  const effectiveUser = caller || user;
  const isInternal = Boolean(internal || !effectiveUser);
  const existing = await getInvoiceById({
    entityId,
    id,
    user: effectiveUser,
    caller: effectiveUser,
    internal: isInternal,
  });
  if (!existing) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Invoice not found',
    });
  }
  const { data: updated, error } = await supabaseAdmin
    .from('invoices')
    .update({ archived: true, updated_by: userId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to archive invoice',
    });
  }

  await auditService.log({
    action: 'invoice.archive',
    table: 'invoices',
    recordId: id,
    entity: entityId,
    userId,
    details: { invoiceNumber: existing.invoice_number },
  });

  return updated;
};

const unarchiveInvoice = async ({ entityId, id, userId, user, caller, internal = false }) => {
  const effectiveUser = caller || user;
  const isInternal = Boolean(internal || !effectiveUser);
  const existing = await getInvoiceById({
    entityId,
    id,
    user: effectiveUser,
    caller: effectiveUser,
    internal: isInternal,
  });
  if (!existing) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Invoice not found',
    });
  }
  const updateData = { archived: false, updated_by: userId, updated_at: new Date().toISOString() };
  if (existing && existing.status === 'Cancelled') {
    updateData.status = 'Draft';
  }
  const { data: updated, error } = await supabaseAdmin
    .from('invoices')
    .update(updateData)
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to unarchive invoice',
    });
  }

  await auditService.log({
    action: 'invoice.unarchive',
    table: 'invoices',
    recordId: id,
    entity: entityId,
    userId,
    details: { invoiceNumber: existing.invoice_number },
  });

  return updated;
};

module.exports = {
  listInvoices,
  createInvoice,
  getInvoiceById,
  updateInvoice,
  archiveInvoice,
  unarchiveInvoice,
  deleteInvoice,
  recordPayment,
  generateInvoicePdf,
  generateVoucherPdf,
  getAgingReport,
  getInvoiceCounts,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  updateInvoiceStatus,
};
