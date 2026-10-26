/**
 * Disbursements service.
 * Business logic for disbursement management with authorized lifecycle redesign.
 *
 * State flow: Draft → Approved → Funded → Released
 *             (Rejection branches from Draft or Funded)
 *             (Resend draft returns Rejected to Draft with review_ready = false)
 *             (Archiving is a flag over Released)
 *
 * Authorized Disbursement Lifecycle Redesign (v2)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { generatePdf } = require('../../services/pdfService');
const {
  buildDisbursementDocument,
  DISBURSEMENT_PAGE_CSS,
  DISBURSEMENT_DOCUMENT_CSS,
} = require('./printDocument');
const { supabaseAdmin } = require('../../services/supabaseClient');
const auditService = require('../../services/auditService');
const { invalidateAnalytics } = require('../reports/service');
const storageService = require('../../services/storageService');
const AppError = require('../../lib/AppError');
const {
  concurrencyConflict,
  resolveExpectedVersion,
  CONCURRENCY_CONFLICT_DETAIL,
} = require('../../lib/concurrency');
const { resolveEntityCode } = require('../../lib/entityResolver');
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
const {
  createReservation,
  getReservation,
  completeReservation,
  claimReservationByKey,
  releaseReservationByKey,
  consumeReservationByKey,
  cleanupExpiredReservations,
} = require('./receiptReservationStore');

/** Canonical status transitions */
const VALID_TRANSITIONS = {
  approve: { from: ['Draft'], to: 'Approved' },
  fund: { from: ['Approved'], to: 'Funded' },
  release: { from: ['Funded'], to: 'Released' },
  reject: { from: ['Draft', 'Funded'], to: 'Rejected' },
  resend_draft: { from: ['Rejected'], to: 'Draft' },
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

const requireVersion = (value) => {
  if (!Number.isInteger(value) || value <= 0)
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'VERSION_REQUIRED',
      detail: 'A positive expectedVersion is required. Refresh the voucher and try again.',
    });
};
const rejectGovernanceFields = (data) => {
  const fields = [
    'status',
    'archived',
    'version',
    'lifecycle_version',
    'lifecycleVersion',
    'review_ready',
    'reviewReady',
    'created_by',
    'createdBy',
    'requested_by',
    'requestedBy',
    'updated_by',
    'updatedBy',
    'lifecycle_history',
    'lifecycleHistory',
  ];
  if (fields.some((field) => Object.hasOwn(data, field)))
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'GOVERNANCE_FIELD_FORBIDDEN',
      detail: 'Use the authorized workflow action to change voucher governance fields.',
    });
};
const validateReferenceScope = async (
  entityId,
  data,
  existing = null,
  explicitWrId = undefined
) => {
  let wrId;
  let wrChanged;
  if (explicitWrId !== undefined) {
    wrId = explicitWrId;
    wrChanged =
      !existing ||
      wrId !== (existing?.linked_work_request_id ?? existing?.work_request_id ?? null);
  } else {
    const { effectiveWrId } = normalizeTaskAndParentAliases(data);
    wrId =
      effectiveWrId !== undefined
        ? effectiveWrId
        : (existing?.linked_work_request_id ?? existing?.work_request_id ?? null);
    wrChanged =
      !existing ||
      (effectiveWrId !== undefined &&
        effectiveWrId !== (existing?.linked_work_request_id ?? existing?.work_request_id ?? null));
  }

  if (wrChanged && !wrId) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'INVALID_WORK_REQUEST',
      detail: 'Select an active work request in this entity.',
    });
  }

  const clientChanged = data.clientId !== undefined && data.clientId !== existing?.client_id;
  let workRequest = null;
  if (wrChanged || clientChanged) {
    const { data: row, error } = await supabaseAdmin
      .from('work_requests')
      .select('id,entity_id,client_id,deleted_at')
      .eq('id', wrId)
      .maybeSingle();
    if (error)
      throw new AppError({
        statusCode: 503,
        title: 'Unavailable',
        detail: 'Unable to validate the selected work request.',
      });
    if (!row || row.entity_id !== entityId || row.deleted_at)
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        code: 'INVALID_WORK_REQUEST',
        detail: 'Select an active work request in this entity.',
      });
    workRequest = row;
  }
  const clientId = data.clientId !== undefined ? data.clientId : existing?.client_id;
  if (clientId && workRequest && workRequest.client_id !== clientId)
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'CLIENT_WR_MISMATCH',
      detail: 'The client must match the selected work request.',
    });
  for (const [field, table] of [
    ['clientId', 'clients'],
    ['linkedInvoiceId', 'invoices'],
    ['linkedTransmittalId', 'transmittals'],
  ]) {
    if (!data[field]) continue;
    const { data: row, error } = await supabaseAdmin
      .from(table)
      .select('id,entity_id,deleted_at')
      .eq('id', data[field])
      .maybeSingle();
    if (error)
      throw new AppError({
        statusCode: 503,
        title: 'Unavailable',
        detail: 'Unable to validate the selected link.',
      });
    if (!row || row.entity_id !== entityId || row.deleted_at)
      throw new AppError({
        statusCode: 400,
        title: 'Validation Error',
        code: 'INVALID_ENTITY_LINK',
        detail: 'Linked records must belong to the current entity.',
      });
  }
};

const notifyLifecycle = async (record, action, audience, actorId) => {
  invalidateAnalytics(record.entity_id);
  try {
    const code = await resolveEntityCode(record.entity_id);
    if (!code) return;
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id,role,entities,is_active,user_departments(departments(name))')
      .eq('is_active', true);
    if (error || !Array.isArray(users)) return;
    const recipients = users
      .filter((user) => {
        if (!Array.isArray(user.entities) || !user.entities.includes(code) || user.id === actorId)
          return false;
        if (audience === 'requester') return user.id === (record.requested_by || record.created_by);
        if (audience === 'admin') return user.role === 'Admin';
        return (
          user.role === 'Admin' ||
          user.role === 'Accounting' ||
          (user.user_departments || []).some(
            (link) => link.departments?.name?.toLowerCase() === 'accounting'
          )
        );
      })
      .map((user) => user.id);
    await safeNotify(recipients, 'disbursement.lifecycle', {
      action,
      table_name: 'disbursements',
      request_id: record.id,
      entity: code,
      disbursement_number: record.disbursement_number,
      title: record.disbursement_number || record.description,
      reason: record.rejection_reason || undefined,
    });
  } catch (_err) {
    /* Business changes remain committed if notifications are unavailable. */
  }
};

/**
 * Handle errors returned by database stored procedures.
 */
const handleRpcError = (rpcError, defaultAction) => {
  if (!rpcError) return;
  const msg = rpcError.message || '';
  const code = rpcError.code || '';

  if (msg.includes('FORBIDDEN') || code === '42501') {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: msg.replace(/^.*EXCEPTION:\s*/, '').trim(),
      code: 'FORBIDDEN',
    });
  }
  if (
    msg.includes('ERR_CONCURRENCY_CONFLICT') ||
    msg.includes('VERSION_REQUIRED') ||
    code === 'P0001'
  ) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: CONCURRENCY_CONFLICT_DETAIL,
      code: 'ERR_CONCURRENCY_CONFLICT',
    });
  }
  if (msg.includes('SAVED_WORKFLOW_READ_ONLY') || code === 'P0003') {
    throw new AppError({
      statusCode: 409,
      title: 'Voucher Read Only',
      detail:
        'This saved voucher is view-only. Create a new request to use the current workflow.',
      code: 'SAVED_WORKFLOW_READ_ONLY',
    });
  }
  if (msg.includes('CONFLICT') || msg.includes('FINANCIAL_EDITS_LOCKED') || code === 'P0002') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: msg.replace(/^.*EXCEPTION:\s*/, '').trim(),
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }
  if (code === '22023') {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: msg.replace(/^.*EXCEPTION:\s*/, '').trim(),
      code: 'VALIDATION_ERROR',
    });
  }

  throw new AppError({
    statusCode: 500,
    title: 'Database Error',
    detail: `Failed to ${defaultAction} disbursement. Please check its current state before retrying.`,
  });
};

/**
 * Generate a disbursement number.
 * Format: DISB-{ENTITY_CODE}-{YYYYMMDD}-{seq}
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

const VALID_ENTITY_CODES = ['ATA', 'LTA'];

/**
 * Count disbursements grouped for module tab badges and actionable queues.
 */
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
    return {
      active: 0,
      archived: 0,
      rejected: 0,
      awaitingRelease: 0,
      initialRequests: 0,
      paymentReleases: 0,
      readyForFunding: 0,
      needsCorrection: 0,
    };
  }

  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = [];
  if (!isAdmin) {
    if (!user || !user.id) {
      return {
        active: 0,
        archived: 0,
        rejected: 0,
        awaitingRelease: 0,
        initialRequests: 0,
        paymentReleases: 0,
        readyForFunding: 0,
        needsCorrection: 0,
      };
    }
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
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
    if (!isAdmin) {
      if (concernedWrIds.length === 0) {
        q = q.in('linked_work_request_id', ['00000000-0000-0000-0000-000000000000']);
      } else {
        q = q.in('linked_work_request_id', concernedWrIds);
      }
    }
    return q;
  };

  const [
    active,
    archivedCount,
    cancelledCount,
    rejectedDisbursements,
    pendingRejected,
    opsRejected,
    initialRequests,
    readyForFunding,
    paymentReleases,
    needsCorrection,
  ] = await Promise.all([
    runCount(baseQuery().neq('archived', true).neq('status', 'Cancelled')),
    runCount(baseQuery().eq('archived', true)),
    runCount(baseQuery().eq('status', 'Cancelled').eq('archived', false)),
    runCount(baseQuery().eq('status', 'Rejected').eq('archived', false)),
    runCount(
      (() => {
        let q = supabaseAdmin
          .from('pending_changes')
          .select('*', { count: 'exact', head: true })
          .in('entity_id', entityIds)
          .eq('table_name', 'disbursements')
          .eq('status', 'rejected');
        if (!isAdmin) {
          q = q.eq('submitted_by', user.id);
        }
        return q;
      })()
    ),
    runCount(
      (() => {
        let q = supabaseAdmin
          .from('operations_requests')
          .select('*', { count: 'exact', head: true })
          .in('entity_id', entityIds)
          .eq('type', 'disbursement')
          .eq('status', 'rejected');
        if (!isAdmin) {
          if (concernedWrIds.length === 0) {
            q = q.in('work_request_id', ['00000000-0000-0000-0000-000000000000']);
          } else {
            q = q.in('work_request_id', concernedWrIds);
          }
        }
        return q;
      })()
    ),
    // initialRequests: v2 Draft, review_ready=true
    runCount(
      baseQuery()
        .eq('lifecycle_version', 2)
        .eq('status', 'Draft')
        .eq('review_ready', true)
        .eq('archived', false)
    ),
    // readyForFunding: v2 Approved
    runCount(baseQuery().eq('lifecycle_version', 2).eq('status', 'Approved').eq('archived', false)),
    // paymentReleases: v2 Funded (must not include legacy Funded)
    runCount(baseQuery().eq('lifecycle_version', 2).eq('status', 'Funded').eq('archived', false)),
    // needsCorrection: v2 Draft, review_ready=false
    runCount(
      baseQuery()
        .eq('lifecycle_version', 2)
        .eq('status', 'Draft')
        .eq('review_ready', false)
        .eq('archived', false)
    ),
  ]);

  const archived = archivedCount + cancelledCount;
  const rejected = rejectedDisbursements;

  return {
    active: Math.max(active, 0),
    archived,
    rejected,
    awaitingRelease: paymentReleases, // Actionable v2 Funded count
    initialRequests,
    paymentReleases,
    readyForFunding,
    needsCorrection,
    rejectedRequests: pendingRejected + opsRejected,
  };
};

/**
 * Enrich disbursement rows with human-readable names and immutable lifecycle history.
 * @param {object[]} rows
 */
const enrichDisbursementExtras = async (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const wrIds = [
    ...new Set(rows.map((r) => r.linked_work_request_id || r.work_request_id).filter(Boolean)),
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
          r.funded_by,
          r.payment_processed_by,
        ])
        .filter(Boolean)
    ),
  ];

  const rowIds = rows.map((r) => r.id);

  let wrMap = new Map();
  if (wrIds.length > 0) {
    const { data: wrs } = await supabaseAdmin
      .from('work_requests')
      .select('id, title, work_order_number')
      .in('id', wrIds);
    wrMap = new Map((wrs || []).map((w) => [w.id, w]));
  }

  // Fetch status history for lifecycle audit trail
  const { data: historyRows } = await supabaseAdmin
    .from('status_history')
    .select('id, record_id, old_status, new_status, actor_id, details, created_at')
    .eq('table_name', 'disbursements')
    .in('record_id', rowIds)
    .order('created_at', { ascending: true });

  const historyByRecord = new Map();
  for (const h of historyRows || []) {
    if (h.actor_id) userIds.push(h.actor_id);
    if (!historyByRecord.has(h.record_id)) {
      historyByRecord.set(h.record_id, []);
    }
    historyByRecord.get(h.record_id).push(h);
  }

  const distinctUserIds = [...new Set(userIds.filter(Boolean))];
  let userMap = new Map();
  if (distinctUserIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, name, role')
      .in('id', distinctUserIds);
    userMap = new Map((users || []).map((u) => [u.id, u]));
  }

  return rows.map((row) => {
    const wrId = row.linked_work_request_id || row.work_request_id;
    const wr = wrId ? wrMap.get(wrId) : null;
    const editedByAccounting = Boolean(
      row.edited_by_accounting || (row.notes && row.notes.includes('Edited by Accounting'))
    );

    const historyItems = (historyByRecord.get(row.id) || []).map((h) => ({
      id: h.id,
      old_status: h.old_status,
      new_status: h.new_status,
      actor_id: h.actor_id,
      actor_name: userMap.get(h.actor_id)?.name || null,
      actor_role: userMap.get(h.actor_id)?.role || null,
      timestamp: h.created_at,
      created_at: h.created_at,
      from_status: h.old_status,
      to_status: h.new_status,
      action: h.details?.action || null,
      reason: h.details?.reason || null,
      details: h.details || {},
    }));

    return {
      ...row,
      linked_work_request_name: wr?.title || null,
      linked_work_request_order_number: wr?.work_order_number || null,
      employee_name: userMap.get(row.employee_id)?.name || null,
      requested_by_name: userMap.get(row.requested_by)?.name || null,
      created_by_name: userMap.get(row.created_by)?.name || null,
      created_by_role: userMap.get(row.created_by)?.role || null,
      approved_by_name: userMap.get(row.approved_by)?.name || null,
      approved_by_role: userMap.get(row.approved_by)?.role || null,
      released_by_name: userMap.get(row.released_by)?.name || null,
      released_by_role: userMap.get(row.released_by)?.role || null,
      rejected_by_name: userMap.get(row.rejected_by)?.name || null,
      rejected_by_role: userMap.get(row.rejected_by)?.role || null,
      funded_by_name: userMap.get(row.funded_by)?.name || null,
      funded_by_role: userMap.get(row.funded_by)?.role || null,
      edited_by_accounting: editedByAccounting,
      lifecycle_history: historyItems,
    };
  });
};

/**
 * List disbursements with role-based scoping and queue filters.
 */
const listDisbursements = async ({ entityId, filters = {}, user }) => {
  if (
    filters.queue &&
    ![
      'initial_requests',
      'payment_releases',
      'ready_for_funding',
      'needs_correction',
    ].includes(filters.queue)
  ) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'Unknown disbursement queue.',
    });
  }
  const {
    queue,
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

  let entityIds = null;
  if (entityId === 'ALL') {
    const codes = (user?.entities || []).filter((c) =>
      VALID_ENTITY_CODES.includes(c.toUpperCase())
    );
    const resolved = await Promise.all(
      codes.map(async (code) => {
        const { data } = await supabaseAdmin
          .from('entities')
          .select('id')
          .eq('code', code)
          .maybeSingle();
        return data?.id;
      })
    );
    entityIds = resolved.filter(Boolean);
    if (entityIds.length === 0) {
      return { data: [], count: 0 };
    }
  }

  if (!user || !user.id) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to list disbursements',
    });
  }

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
    let q = supabaseAdmin.from('disbursements').select('*').is('deleted_at', null);

    if (entityIds) {
      q = q.in('entity_id', entityIds);
    } else if (entityId) {
      q = q.eq('entity_id', entityId);
    }

    if (queue === 'initial_requests') {
      q = q
        .eq('lifecycle_version', 2)
        .eq('status', 'Draft')
        .eq('review_ready', true)
        .eq('archived', false);
    } else if (queue === 'ready_for_funding') {
      q = q.eq('lifecycle_version', 2).eq('status', 'Approved').eq('archived', false);
    } else if (queue === 'payment_releases') {
      q = q.eq('lifecycle_version', 2).eq('status', 'Funded').eq('archived', false);
    } else if (queue === 'needs_correction') {
      q = q
        .eq('lifecycle_version', 2)
        .eq('status', 'Draft')
        .eq('review_ready', false)
        .eq('archived', false);
    } else {
      if (isArchived) {
        q = q.eq('archived', true);
      } else if (archived === false || archived === 'false') {
        q = q.eq('archived', false);
      }
      if (status) q = q.eq('status', status);
    }

    if (category) q = q.eq('category', category);
    if (fundSource) q = q.eq('fund_source', fundSource);
    if (effectiveFilterTaskId) {
      q = q.or(
        `task_id.eq.${effectiveFilterTaskId},linked_task_id.eq.${effectiveFilterTaskId}`
      );
    }
    if (linkedTransmittalId) q = q.eq('linked_transmittal_id', linkedTransmittalId);
    if (search) {
      q = q.or(`description.ilike.%${search}%,disbursement_number.ilike.%${search}%`);
    }
    return q.order('created_at', { ascending: false });
  };

  const data = await fetchInPages(makeQuery);

  const validRows = await filterValidProjectRecords(data || [], {
    user,
    entityId,
    concernedWrIds,
  });

  const total = validRows.length;
  const effectiveLimit = Number(limit) || 50;
  const effectiveOffset =
    filters.offset !== undefined ? Number(filters.offset) : (page - 1) * effectiveLimit;
  const rows = validRows.slice(effectiveOffset, effectiveOffset + effectiveLimit);

  const { data: entitiesData } = rows.length
    ? await supabaseAdmin.from('entities').select('id, code')
    : { data: [] };
  const entityCodeMap = new Map((entitiesData || []).map((e) => [e.id, e.code]));

  const mapped = rows.map((row) => ({
    ...row,
    entity_code: entityCodeMap.get(row.entity_id) || row.entity_id,
  }));

  const enriched = await enrichDisbursementExtras(mapped);
  return { data: enriched, count: total };
};

/**
 * Create a new disbursement.
 * Every newly created voucher enters v2 Draft with review_ready = true.
 */
const createDisbursement = async ({ entityId, entityCode, userId, user, data }) => {
  rejectGovernanceFields(data);
  const effectiveUser = await resolveTrustedUser({ user, userId });

  // Reject client-supplied status forgery (AC-1, R1)
  if (data.status !== undefined && data.status !== null) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Explicit status cannot be set on creation; status forgery is prohibited',
      code: 'STATUS_FORGERY_PROHIBITED',
    });
  }

  // Reject foreign employeeId (R2 / AC-4)
  if (data.employeeId && data.employeeId !== userId) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Cannot create disbursement voucher for another employee.',
      code: 'DISBURSEMENT_REQUESTER_MISMATCH',
    });
  }

  // Normalize aliases once across root data (Correction 3)
  const { effectiveTaskId, effectiveWrId } = normalizeTaskAndParentAliases(data);

  if (!effectiveWrId) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'INVALID_WORK_REQUEST',
      detail: 'Select an active work request in this entity.',
    });
  }

  // Authorize task target BEFORE receipt reservation claim! (F02, Correction 4, 7)
  if (effectiveTaskId) {
    await resolveAndAuthorizeTaskTarget({
      entityId,
      user: effectiveUser,
      userId,
      targetTaskId: effectiveTaskId,
      targetWorkRequestId: effectiveWrId,
      clientId: data.clientId,
      allowNoTask: true,
    });
  }

  await validateReferenceScope(entityId, data, null, effectiveWrId);

  // Atomically claim receipt reservation if receiptS3Key is supplied (R4 / AC-4)
  let receiptClaim = null;
  if (data.receiptS3Key) {
    const claimResult = await claimReservationByKey({
      receiptS3Key: data.receiptS3Key,
      userId,
      entityId,
    });
    if (!claimResult || claimResult.error) {
      const isMismatch = claimResult?.error === 'MISMATCH';
      const isClaimed = claimResult?.error === 'ALREADY_CLAIMED';
      throw new AppError({
        statusCode: isMismatch ? 403 : 400,
        title: isMismatch ? 'Forbidden' : 'Bad Request',
        detail: isMismatch
          ? 'Receipt reservation does not belong to the authenticated user or entity.'
          : isClaimed
            ? 'Receipt reservation is currently being processed by another request.'
            : 'Receipt upload reservation is invalid, unverified, expired, or already consumed.',
        code: isMismatch ? 'RECEIPT_RESERVATION_MISMATCH' : 'INVALID_RECEIPT_RESERVATION',
      });
    }
    receiptClaim = claimResult;
  }

  const initialStatus = 'Draft';
  const MAX_RETRIES = 5;

  let receiptWriteMayHaveCommitted = false;
  try {
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
        lifecycle_version: 2,
        review_ready: true,
        client_id: data.clientId || null,
        employee_id: userId,
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

      receiptWriteMayHaveCommitted = true;
      const { data: disbursement, error } = await supabaseAdmin
        .from('disbursements')
        .insert(row)
        .select()
        .single();

      if (!error) {
        if (data.receiptS3Key) {
          const consumed = await consumeReservationByKey({
            receiptS3Key: data.receiptS3Key,
            userId,
            entityId,
            claimId: receiptClaim?.claimId,
            voucherId: disbursement.id,
          });

          if (!consumed) {
            // The voucher already exists. Keep its claim for reconciliation;
            // deleting it here can race another legitimate voucher update.
            throw new AppError({
              statusCode: 409,
              title: 'Conflict',
              detail:
                'Receipt reservation could not be consumed. It may have already been consumed or claimed by another request.',
              code: 'RECEIPT_RESERVATION_CONSUME_FAILED',
            });
          }
        }

        await auditService.log({
          action: 'disbursement.create',
          table: 'disbursements',
          recordId: disbursement.id,
          entity: entityId,
          userId,
          details: { disbursementNumber, total: data.amount },
        });

        await notifyLifecycle(disbursement, 'created', 'admin', userId);
        const entityCodeResolved = await resolveEntityCode(disbursement.entity_id);
        return { ...disbursement, entity_code: entityCodeResolved };
      }

      // Only definite statement rejections release the claim. Connection errors
      // and unknown completion outcomes must retain it for reconciliation.
      receiptWriteMayHaveCommitted =
        !/^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3}|42[0-9A-Z]{3}|40001|40P01)$/.test(error.code || '');
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
  } catch (err) {
    if (data.receiptS3Key && receiptClaim && !receiptWriteMayHaveCommitted) {
      await releaseReservationByKey({
        receiptS3Key: data.receiptS3Key,
        userId,
        entityId,
        claimId: receiptClaim.claimId,
      });
    }
    throw err;
  }
};

/**
 * Fetch a single disbursement by ID with scoping.
 */
const getDisbursementById = async ({ entityId, id, user, internal = false }) => {
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

  if (!internal) {
    if (!user || !user.id) {
      throw new AppError({
        statusCode: 401,
        title: 'Unauthorized',
        detail: 'Authentication required to view disbursement',
      });
    }

    await validateRecordProjectLinkage({
      record: data,
      entityId,
      user,
      internal: false,
    });
  }

  const entityCode = await resolveEntityCode(data.entity_id);
  const enriched = await enrichDisbursementExtras([{ ...data, entity_code: entityCode }]);
  return enriched[0];
};

const resolveDisbursementCaller = async ({ user, userId, internal }) => {
  const effectiveUser = user || (await resolveTrustedUser({ user, userId }));
  if (!internal && !effectiveUser) {
    throw new AppError({
      statusCode: 401,
      title: 'Unauthorized',
      detail: 'Authentication required to modify disbursement',
    });
  }
  return effectiveUser;
};

/**
 * Update a disbursement.
 * Only Draft disbursements can be edited for financial/content details.
 * Admin can edit print_details on Released vouchers with expectedVersion.
 */
const updateDisbursement = async ({ entityId, id, userId, data, user, internal = false }) => {
  rejectGovernanceFields(data);
  const effectiveUser = await resolveDisbursementCaller({ user, userId, internal });
  const existing = await getDisbursementById({ entityId, id, user: effectiveUser, internal });

  const isAccountingUser =
    String(effectiveUser?.role || '').toLowerCase() === 'accounting' ||
    (effectiveUser?.departments || []).some((d) => String(d).toLowerCase() === 'accounting');
  const isAdminUser = effectiveUser?.role === 'Admin';

  const expectedVersion = resolveExpectedVersion(data);
  if (expectedVersion === null) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'expectedVersion is required for updating disbursement.',
      code: 'VERSION_REQUIRED',
    });
  }

  if (data.printDetails !== undefined && !isAdminUser) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Only administrators can edit printed voucher details.',
      code: 'FORBIDDEN',
    });
  }

  const contentFields = [
    'category',
    'description',
    'amount',
    'fundSource',
    'clientId',
    'employeeId',
    'linkedInvoiceId',
    'linkedWorkRequestId',
    'linked_work_request_id',
    'workRequestId',
    'work_request_id',
    'linkedTaskId',
    'linked_task_id',
    'taskId',
    'task_id',
    'linkedTransmittalId',
    'dueDate',
    'notes',
    'receiptS3Key',
    'receiptFilename',
  ];
  const isUpdatingContent = contentFields.some((field) => data[field] !== undefined);

  if (isUpdatingContent && existing.status !== 'Draft') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: `Cannot edit disbursement in "${existing.status}" status. Only Draft disbursements can be edited.`,
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }

  if (existing.lifecycle_version === 1 && isUpdatingContent) {
    throw new AppError({
      statusCode: 409,
      title: 'Voucher Read Only',
      detail:
        'This saved voucher is view-only. Create a new request to use the current workflow.',
      code: 'SAVED_WORKFLOW_READ_ONLY',
    });
  }

  // Draft authorization: Owner, Admin, or Accounting
  if (existing.status === 'Draft' && !isAdminUser && !isAccountingUser) {
    if (existing.created_by !== userId) {
      throw new AppError({
        statusCode: 403,
        title: 'Forbidden',
        detail: 'You do not have permission to edit this draft disbursement.',
        code: 'FORBIDDEN',
      });
    }
  }

  if (data.employeeId !== undefined && data.employeeId !== existing.employee_id) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      code: 'DISBURSEMENT_REQUESTER_MISMATCH',
      detail: 'Cannot reassign the voucher requester.',
    });
  }

  // Normalize aliases once across update payload (Correction 3)
  const { effectiveTaskId: payloadTaskId, effectiveWrId: payloadWrId } =
    normalizeTaskAndParentAliases(data);

  if (payloadWrId === null) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      code: 'INVALID_WORK_REQUEST',
      detail: 'Select an active work request in this entity.',
    });
  }

  // Authorize relink / linkage change (Correction 1, 5)
  const relinkResult = await authorizeTaskRelink({
    entityId: existing.entity_id,
    user: effectiveUser,
    userId,
    existing,
    payloadTaskId,
    payloadWrId,
    clientId: data.clientId,
  });

  const effectiveWrId = relinkResult.isLinkageChanged
    ? relinkResult.effectiveWrId
    : payloadWrId !== undefined
      ? payloadWrId
      : existing.linked_work_request_id;
  const effectiveTaskId = relinkResult.isLinkageChanged
    ? relinkResult.effectiveTaskId
    : payloadTaskId !== undefined
      ? payloadTaskId
      : undefined;

  await validateReferenceScope(existing.entity_id, data, existing, effectiveWrId);

  // Handle receipt reservation claim & paired metadata
  let receiptReservationClaim = null;
  const isReceiptKeyProvided = data.receiptS3Key !== undefined;
  const isReceiptFilenameProvided = data.receiptFilename !== undefined;

  const updates = {};
  if (data.printDetails !== undefined) updates.print_details = data.printDetails;
  if (data.category !== undefined) updates.category = data.category;
  if (data.description !== undefined) updates.description = data.description;
  if (data.amount !== undefined) updates.amount = data.amount;
  if (data.fundSource !== undefined) updates.fund_source = data.fundSource;
  if (data.clientId !== undefined) updates.client_id = data.clientId;
  if (data.linkedInvoiceId !== undefined) updates.linked_invoice_id = data.linkedInvoiceId;
  if (
    data.linkedWorkRequestId !== undefined ||
    data.workRequestId !== undefined ||
    data.work_request_id !== undefined ||
    data.linked_work_request_id !== undefined ||
    (relinkResult.isLinkageChanged && relinkResult.effectiveWrId !== existing.linked_work_request_id)
  ) {
    updates.linked_work_request_id = effectiveWrId;
  }
  if (relinkResult.isLinkageChanged) {
    updates.linked_task_id = relinkResult.canonicalPair.linked_task_id;
    updates.task_id = relinkResult.canonicalPair.task_id;
  } else if (effectiveTaskId !== undefined) {
    updates.linked_task_id = effectiveTaskId;
    updates.task_id = effectiveTaskId;
  }
  if (data.linkedTransmittalId !== undefined) {
    updates.linked_transmittal_id = data.linkedTransmittalId;
  }
  if (data.dueDate !== undefined) updates.due_date = data.dueDate;
  if (data.notes !== undefined) updates.notes = data.notes;

  if (isReceiptKeyProvided || isReceiptFilenameProvided) {
    const newKey = data.receiptS3Key;
    const newFilename = data.receiptFilename;

    if (newKey === null) {
      if (newFilename) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Cannot set receiptFilename when receiptS3Key is null.',
          code: 'INVALID_RECEIPT_ATTACHMENT',
        });
      }
      updates.receipt_s3_key = null;
      updates.receipt_filename = null;
    } else if (!isReceiptKeyProvided && isReceiptFilenameProvided) {
      if (!existing.receipt_s3_key) {
        throw new AppError({
          statusCode: 400,
          title: 'Bad Request',
          detail: 'Cannot set receiptFilename without a valid receiptS3Key.',
          code: 'INVALID_RECEIPT_ATTACHMENT',
        });
      }
      updates.receipt_filename = newFilename;
    } else if (newKey === existing.receipt_s3_key) {
      updates.receipt_s3_key = newKey;
      if (isReceiptFilenameProvided) updates.receipt_filename = newFilename;
    } else {
      const claimResult = await claimReservationByKey({
        receiptS3Key: newKey,
        userId,
        entityId,
      });

      if (!claimResult || claimResult.error) {
        const isMismatch = claimResult?.error === 'MISMATCH';
        throw new AppError({
          statusCode: isMismatch ? 403 : 400,
          title: isMismatch ? 'Forbidden' : 'Bad Request',
          detail: isMismatch
            ? 'Receipt reservation does not belong to the authenticated user or entity.'
            : 'Receipt upload reservation is invalid, unverified, expired, or already consumed.',
          code: isMismatch ? 'RECEIPT_RESERVATION_MISMATCH' : 'INVALID_RECEIPT_RESERVATION',
        });
      }

      const resolvedFilename = newFilename || claimResult.data.filename;
      updates.receipt_s3_key = newKey;
      updates.receipt_filename = resolvedFilename;
      receiptReservationClaim = { key: newKey, claimId: claimResult.claimId };
    }
  }

  // Prepend Accounting edit notes if Accounting modifies financial details
  if (isAccountingUser && isUpdatingContent) {
    const editPrefix = `[Edited by Accounting on ${new Date().toLocaleDateString('en-PH')} by ${effectiveUser?.name || 'Accounting Staff'}] `;
    const currentNotes = data.notes !== undefined ? data.notes : existing.notes || '';
    updates.notes = currentNotes ? `${editPrefix}${currentNotes}` : editPrefix.trim();
    updates.edited_by_accounting = true;
  }

  // Call atomic edit RPC
  const { data: rows, error: rpcError } = await supabaseAdmin.rpc('disbursement_atomic_edit', {
    p_id: id,
    p_entity_id: existing.entity_id || entityId,
    p_user_id: userId,
    p_updates: updates,
    p_expected_version: expectedVersion,
  });

  if (rpcError) {
    const definitelyRejected =
      /^(?:22[0-9A-Z]{3}|23[0-9A-Z]{3}|42[0-9A-Z]{3}|40001|40P01|P000[123]|PGRST202)$/.test(
        rpcError.code || ''
      );
    if (receiptReservationClaim && definitelyRejected) {
      await releaseReservationByKey({
        receiptS3Key: receiptReservationClaim.key,
        userId,
        entityId,
        claimId: receiptReservationClaim.claimId,
      });
    }
    handleRpcError(rpcError, 'update');
  }

  if (!rows || rows.length === 0) {
    if (receiptReservationClaim) {
      await releaseReservationByKey({
        receiptS3Key: receiptReservationClaim.key,
        userId,
        entityId,
        claimId: receiptReservationClaim.claimId,
      });
    }
    throw concurrencyConflict();
  }

  const updated = rows[0];
  invalidateAnalytics(updated.entity_id);
  if (existing.review_ready === false && updated.review_ready === true) {
    await notifyLifecycle(updated, 'corrected', 'admin', userId);
  }

  if (receiptReservationClaim) {
    const consumed = await consumeReservationByKey({
      receiptS3Key: receiptReservationClaim.key,
      userId,
      entityId,
      claimId: receiptReservationClaim.claimId,
      voucherId: updated.id,
    });

    if (!consumed) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'Receipt reservation could not be consumed.',
        code: 'RECEIPT_RESERVATION_CONSUME_FAILED',
      });
    }
  }

  const entityCode = await resolveEntityCode(updated.entity_id);
  const enriched = await enrichDisbursementExtras([{ ...updated, entity_code: entityCode }]);
  return enriched[0];
};

/**
 * Perform a canonical workflow transition.
 */
const performWorkflowTransition = async ({
  entityId,
  id,
  userId,
  user,
  action,
  expectedVersion,
  reason = null,
  paymentDetails = null,
  internal = false,
}) => {
  const transition = VALID_TRANSITIONS[action];
  if (!transition) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: `Unknown action: "${action}"`,
    });
  }

  const effectiveUser = await resolveDisbursementCaller({ user, userId, internal });
  const current = await getDisbursementById({ entityId, id, user: effectiveUser, internal });

  // Keep previously saved workflow records unchanged
  if (current.lifecycle_version === 1) {
    throw new AppError({
      statusCode: 409,
      title: 'Voucher Read Only',
      detail:
        'This saved voucher is view-only. Create a new request to use the current workflow.',
      code: 'SAVED_WORKFLOW_READ_ONLY',
    });
  }

  // OCC Version validation
  if (!Number.isInteger(expectedVersion) || expectedVersion <= 0) {
    throw new AppError({
      statusCode: 400,
      title: 'Validation Error',
      detail: 'expectedVersion is required and must be a positive integer.',
      code: 'VERSION_REQUIRED',
    });
  }

  if (current.version !== Number(expectedVersion)) {
    throw concurrencyConflict();
  }

  // Predecessor state validation
  if (!transition.from.includes(current.status)) {
    throw new AppError({
      statusCode: 409,
      title: 'Invalid Transition',
      detail: `Cannot ${action} a disbursement in "${current.status}" status. Expected: ${transition.from.join(' or ')}.`,
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }

  // Approval readiness and persisted payment checks. Admin may approve and release their own request.
  if (action === 'approve') {
    if (current.review_ready !== true) {
      throw new AppError({
        statusCode: 409,
        title: 'Conflict',
        detail: 'Disbursement returned for correction cannot be approved until corrected.',
        code: 'CONFLICT_CURRENT_STATUS',
      });
    }
  }

  if (action === 'release') {
    if (
      !current.payment_method ||
      !current.payment_bank ||
      !current.payment_reference ||
      !current.payment_date
    ) {
      throw new AppError({
        statusCode: 400,
        title: 'Bad Request',
        detail: 'Complete payment instrument details are required before release.',
      });
    }
  }

  const { data: rows, error: rpcError } = await supabaseAdmin.rpc('disbursement_transition', {
    p_id: id,
    p_from_statuses: transition.from,
    p_to_status: transition.to,
    p_user_id: userId,
    p_entity_id: current.entity_id || entityId,
    p_reason: reason,
    p_payment_details: paymentDetails,
    p_expected_version: Number(expectedVersion),
  });

  if (rpcError) {
    handleRpcError(rpcError, action);
  }

  if (!rows || rows.length === 0) {
    throw concurrencyConflict();
  }

  const updated = rows[0];
  invalidateAnalytics(updated.entity_id);

  await auditService.log({
    action: `disbursement.${action}`,
    table: 'disbursements',
    recordId: id,
    entity: current.entity_id || entityId,
    userId,
    details: { from: current.status, to: transition.to },
  });

  const entityCode = await resolveEntityCode(updated.entity_id);
  const enriched = await enrichDisbursementExtras([{ ...updated, entity_code: entityCode }]);
  return enriched[0];
};

/**
 * Approve a v2 Draft disbursement (Admin only).
 */
const approveDisbursement = async ({ entityId, id, userId, user, expectedVersion }) => {
  const result = await performWorkflowTransition({
    entityId,
    id,
    userId,
    user,
    action: 'approve',
    expectedVersion,
  });

  await notifyLifecycle(result, 'approve', 'accounting', userId);

  return result;
};

/**
 * Fund a v2 Approved disbursement (Accounting or Admin).
 */
const fundDisbursement = async ({
  entityId,
  id,
  userId,
  user,
  paymentDetails,
  expectedVersion,
}) => {
  const result = await performWorkflowTransition({
    entityId,
    id,
    userId,
    user,
    action: 'fund',
    expectedVersion,
    paymentDetails,
  });

  await notifyLifecycle(result, 'fund', 'admin', userId);

  return result;
};

/**
 * Release a v2 Funded disbursement (Admin, including the payment preparer).
 */
const releaseDisbursement = async ({ entityId, id, userId, user, expectedVersion }) => {
  const result = await performWorkflowTransition({
    entityId,
    id,
    userId,
    user,
    action: 'release',
    expectedVersion,
  });

  await notifyLifecycle(result, 'release', 'requester', userId);

  return result;
};

/**
 * Reject a v2 Draft or Funded disbursement (Admin only).
 */
const rejectDisbursement = async ({ entityId, id, userId, user, reason, expectedVersion }) => {
  if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
    throw new AppError({
      statusCode: 400,
      title: 'Bad Request',
      detail: 'Rejection reason is required',
      code: 'REJECTION_REASON_REQUIRED',
    });
  }

  const trimmedReason = reason.trim();
  const result = await performWorkflowTransition({
    entityId,
    id,
    userId,
    user,
    action: 'reject',
    expectedVersion,
    reason: trimmedReason,
  });

  await notifyLifecycle(result, 'reject', 'requester', userId);

  return result;
};

/**
 * Return a rejected disbursement to draft (Admin only).
 */
const resendDraftDisbursement = async ({ entityId, id, userId, user, expectedVersion }) => {
  const result = await performWorkflowTransition({
    entityId,
    id,
    userId,
    user,
    action: 'resend_draft',
    expectedVersion,
  });

  await notifyLifecycle(result, 'resend_draft', 'requester', userId);

  return result;
};

/**
 * Archive a Released disbursement (Admin only, v2).
 */
const archiveDisbursement = async ({ entityId, id, userId, user, expectedVersion, internal = false }) => {
  const effectiveUser = await resolveDisbursementCaller({ user, userId, internal });
  const current = await getDisbursementById({ entityId, id, user: effectiveUser, internal });
  if (current.lifecycle_version === 1) {
    throw new AppError({
      statusCode: 409,
      title: 'Voucher Read Only',
      detail:
        'This saved voucher retains its existing archive state.',
      code: 'SAVED_WORKFLOW_READ_ONLY',
    });
  }
  if (current.status !== 'Released') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Only Released disbursements can be archived.',
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }

  const { data: rows, error: rpcError } = await supabaseAdmin.rpc('disbursement_archive_toggle', {
    p_id: id,
    p_entity_id: current.entity_id || entityId,
    p_user_id: userId,
    p_archive: true,
    p_expected_version: Number(expectedVersion),
  });

  if (rpcError) {
    handleRpcError(rpcError, 'archive');
  }

  if (!rows || rows.length === 0) {
    throw concurrencyConflict();
  }

  const updated = rows[0];
  invalidateAnalytics(updated.entity_id);
  const entityCode = await resolveEntityCode(updated.entity_id);
  const enriched = await enrichDisbursementExtras([{ ...updated, entity_code: entityCode }]);
  return enriched[0];
};

/**
 * Unarchive a Released disbursement (Admin only, v2).
 */
const unarchiveDisbursement = async ({ entityId, id, userId, user, expectedVersion, internal = false }) => {
  const effectiveUser = await resolveDisbursementCaller({ user, userId, internal });
  const current = await getDisbursementById({ entityId, id, user: effectiveUser, internal });
  if (current.lifecycle_version === 1) {
    throw new AppError({
      statusCode: 409,
      title: 'Voucher Read Only',
      detail:
        'This saved voucher retains its existing archive state.',
      code: 'SAVED_WORKFLOW_READ_ONLY',
    });
  }
  if (current.status !== 'Released') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Only Released disbursements can be unarchived.',
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }

  const { data: rows, error: rpcError } = await supabaseAdmin.rpc('disbursement_archive_toggle', {
    p_id: id,
    p_entity_id: current.entity_id || entityId,
    p_user_id: userId,
    p_archive: false,
    p_expected_version: Number(expectedVersion),
  });

  if (rpcError) {
    handleRpcError(rpcError, 'unarchive');
  }

  if (!rows || rows.length === 0) {
    throw concurrencyConflict();
  }

  const updated = rows[0];
  invalidateAnalytics(updated.entity_id);
  const entityCode = await resolveEntityCode(updated.entity_id);
  const enriched = await enrichDisbursementExtras([{ ...updated, entity_code: entityCode }]);
  return enriched[0];
};

/**
 * Obsolete workflow actions (deprecated on v2).
 */
const submitDisbursement = async ({ entityId, id, userId: _userId, user, internal = false }) => {
  const effectiveUser = await resolveDisbursementCaller({ user, userId: _userId, internal });
  const current = await getDisbursementById({ entityId, id, user: effectiveUser, internal });
  if (current.lifecycle_version === 2) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail:
        'Submit is deprecated. New disbursements automatically enter Draft and immediately enter the approval queue.',
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }
  throw new AppError({
    statusCode: 409,
    title: 'Conflict',
    detail: 'Requests enter review automatically; this submission action is unavailable.',
    code: 'CONFLICT_CURRENT_STATUS',
  });
};

const forwardDisbursement = async ({ entityId, id, userId: _userId, user, internal = false }) => {
  const effectiveUser = await resolveDisbursementCaller({ user, userId: _userId, internal });
  const current = await getDisbursementById({ entityId, id, user: effectiveUser, internal });
  if (current.lifecycle_version === 2) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail:
        'Forward is deprecated. V2 disbursements progress directly via Approve, Fund, and Release.',
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }
  throw new AppError({
    statusCode: 409,
    title: 'Conflict',
    detail: 'Requests enter review automatically; this forwarding action is unavailable.',
    code: 'CONFLICT_CURRENT_STATUS',
  });
};

/**
 * Update payment details on Released/Funded vouchers (legacy only; blocked on v2).
 */
const updatePaymentDetails = async ({ entityId, id, user }) => {
  const existing = await getDisbursementById({ entityId, id, user });
  if (existing.lifecycle_version === 2 && ['Funded', 'Released'].includes(existing.status)) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail:
        'Cannot update payment details directly on Funded or Released vouchers. Use rejection and return to draft for an unexecuted payment.',
      code: 'CONFLICT_CURRENT_STATUS',
    });
  }
  throw new AppError({
    statusCode: 409,
    title: 'Conflict',
    detail: 'Payment details update is blocked on this record.',
    code: 'CONFLICT_CURRENT_STATUS',
  });
};

/**
 * Soft-delete a disbursement.
 * Allowed ONLY for unarchived Draft disbursements by creator or Admin.
 */
const deleteDisbursement = async ({ entityId, id, userId, user, expectedVersion, internal = false }) => {
  const effectiveUser = await resolveDisbursementCaller({ user, userId, internal });
  const current = await getDisbursementById({ entityId, id, user: effectiveUser, internal });
  requireVersion(expectedVersion);
  const { data: rows, error } = await supabaseAdmin.rpc('disbursement_atomic_delete', {
    p_id: id,
    p_entity_id: current.entity_id,
    p_user_id: userId,
    p_expected_version: expectedVersion,
  });
  if (error) handleRpcError(error, 'delete');
  if (!Array.isArray(rows) || rows.length === 0) throw concurrencyConflict();
  invalidateAnalytics(current.entity_id);
};

/**
 * Disbursement Templates
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

/**
 * Receipt upload reservation
 */
const createReceiptUpload = async ({
  entityId,
  entityCode,
  userId,
  user: _user,
  filename,
  contentType,
  size,
}) => {
  let resolvedCode = entityCode;
  if (!resolvedCode || resolvedCode === entityId) {
    resolvedCode = (await resolveEntityCode(entityId)) || 'ATA';
  }
  const cryptoUUID = crypto.randomUUID();
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectKey = `entities/${resolvedCode}/disbursements/receipts/${cryptoUUID}-${sanitizedFilename}`;

  const uploadUrl = await storageService.getSignedUploadUrl({
    path: objectKey,
    contentType,
    expiresInSeconds: 900,
  });

  const reservation = await createReservation({
    uploadId: cryptoUUID,
    userId,
    entityId,
    entityCode,
    objectKey,
    filename,
    contentType,
    size,
    expiresInSeconds: 900,
  });

  return {
    uploadId: reservation.uploadId,
    uploadUrl,
    objectKey: reservation.objectKey,
    expiresAt: reservation.expiresAt,
  };
};

const completeReceiptUpload = async ({ entityId, uploadId, userId, user: _user }) => {
  const reservation = await getReservation(uploadId);
  if (!reservation) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Receipt upload reservation not found or expired.',
      code: 'UPLOAD_RESERVATION_NOT_FOUND',
    });
  }

  if (
    reservation.userId !== userId ||
    (reservation.entityId && reservation.entityId !== entityId)
  ) {
    throw new AppError({
      statusCode: 403,
      title: 'Forbidden',
      detail: 'Cannot complete receipt upload reservation belonging to another user or entity.',
      code: 'UPLOAD_RESERVATION_MISMATCH',
    });
  }

  if (reservation.status === 'consumed') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Receipt upload reservation has already been consumed and cannot be re-completed.',
      code: 'RECEIPT_RESERVATION_ALREADY_CONSUMED',
    });
  }

  if (reservation.status === 'claimed') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Receipt upload reservation is currently being claimed by an active voucher request.',
      code: 'RECEIPT_RESERVATION_ALREADY_CLAIMED',
    });
  }

  const verification = await storageService.verifyReceiptObject({
    path: reservation.objectKey,
    expectedSize: reservation.size,
    expectedContentType: reservation.contentType,
  });

  if (!verification.valid) {
    throw new AppError({
      statusCode: 422,
      title: 'Unprocessable Entity',
      detail: verification.error || 'Receipt upload verification failed.',
      code: verification.code || 'RECEIPT_UPLOAD_VERIFICATION_FAILED',
    });
  }

  const completeResult = await completeReservation(uploadId, { userId, entityId });
  if (completeResult && completeResult.error === 'ALREADY_CONSUMED') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Receipt upload reservation has already been consumed.',
      code: 'RECEIPT_RESERVATION_ALREADY_CONSUMED',
    });
  }
  if (completeResult && completeResult.error === 'ALREADY_CLAIMED') {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Receipt upload reservation is currently being claimed by an active voucher request.',
      code: 'RECEIPT_RESERVATION_ALREADY_CLAIMED',
    });
  }

  if (!completeResult || completeResult.error) {
    throw new AppError({
      statusCode: 409,
      title: 'Receipt upload unavailable',
      detail: 'Upload expired or cleanup started during verification. Create a new upload.',
      code: 'RECEIPT_RESERVATION_UNAVAILABLE',
    });
  }

  return {
    receiptS3Key: reservation.objectKey,
    receiptFilename: reservation.filename,
  };
};

const getReceiptUrl = async ({ entityId, id, userId: _userId, user }) => {
  let voucher;
  try {
    voucher = await getDisbursementById({ entityId, id, user });
  } catch (err) {
    if (err.statusCode === 404 && entityId && entityId !== 'ALL') {
      voucher = await getDisbursementById({ entityId: 'ALL', id, user });
    } else {
      throw err;
    }
  }

  // Case 1: No supporting document attached
  if (!voucher.receipt_s3_key && !voucher.receipt_filename) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: 'Disbursement has no supporting document attached.',
      code: 'RECEIPT_NOT_FOUND',
    });
  }

  // Case 2: Legacy record with receipt_filename present but receipt_s3_key is null
  if (!voucher.receipt_s3_key && voucher.receipt_filename) {
    return {
      status: 'unavailable',
      filename: voucher.receipt_filename,
      reason: 'legacy_attachment_missing',
    };
  }

  // Case 3: Valid receipt_s3_key
  const url = await storageService.getSignedDownloadUrl({
    path: voucher.receipt_s3_key,
    expiresInSeconds: 300,
  });

  const ext = (voucher.receipt_filename || voucher.receipt_s3_key).split('.').pop()?.toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === 'pdf') contentType = 'application/pdf';
  else if (ext === 'png') contentType = 'image/png';
  else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';

  return {
    url,
    filename: voucher.receipt_filename || voucher.receipt_s3_key.split('/').pop(),
    contentType,
    expiresAt: new Date(Date.now() + 300 * 1000).toISOString(),
  };
};

const generateDisbursementPdf = async ({
  entityId,
  id,
  user,
  noLogo = false,
  includeCompanyDetails = true,
}) => {
  let voucher;
  try {
    voucher = await getDisbursementById({ entityId, id, user });
  } catch (err) {
    if (err.statusCode === 404 && entityId && entityId !== 'ALL') {
      voucher = await getDisbursementById({ entityId: 'ALL', id, user });
    } else {
      throw err;
    }
  }
  const code = voucher.entity_code;
  let body = buildDisbursementDocument(voucher, { noLogo, includeCompanyDetails });
  if (includeCompanyDetails && !noLogo) {
    const logo = code === 'LTA' ? 'LTA-LOGO.jpg' : 'ATA-LOGO.jpg';
    const data = fs
      .readFileSync(path.join(__dirname, '../billing/assets', logo))
      .toString('base64');
    body = body.replace(`/ERP_Assets/${logo}`, `data:image/jpeg;base64,${data}`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${DISBURSEMENT_PAGE_CSS}${DISBURSEMENT_DOCUMENT_CSS}body { margin:0; }</style></head><body><main class="disbursement-document">${body}</main></body></html>`;
  const buffer = await generatePdf({ html, options: { format: 'A4', preferCSSPageSize: true } });
  const suffix = !includeCompanyDetails ? '-no-company-details' : noLogo ? '-no-logo' : '';
  const url = await storageService.uploadBuffer({
    path: `entities/${code}/disbursements/${id}/pdf/${voucher.disbursement_number || id}${suffix}.pdf`,
    buffer,
    contentType: 'application/pdf',
  });
  return { url };
};

module.exports = {
  getDisbursementCounts,
  enrichDisbursementExtras,
  listDisbursements,
  createDisbursement,
  getDisbursementById,
  updateDisbursement,
  approveDisbursement,
  fundDisbursement,
  releaseDisbursement,
  rejectDisbursement,
  resendDraftDisbursement,
  archiveDisbursement,
  unarchiveDisbursement,
  submitDisbursement,
  forwardDisbursement,
  updatePaymentDetails,
  deleteDisbursement,
  listDisbursementTemplates,
  createDisbursementTemplate,
  updateDisbursementTemplate,
  deleteDisbursementTemplate,
  createReceiptUpload,
  completeReceiptUpload,
  getReceiptUrl,
  generateDisbursementPdf,
  generateDisbursementNumber,
  cleanupExpiredReservations,
};
