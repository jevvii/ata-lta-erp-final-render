/**
 * Reports service.
 * Read-only analytics and report generation.
 * Queries data across all Phase 2–6 tables.
 *
 * Phase 7 — Agent B
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const _AppError = require('../../lib/AppError');
const _logger = require('../../lib/logger');
const { resolveEntityId, resolveEntityCode } = require('../../lib/entityResolver');
const {
  getUserConcernedWorkRequestIds,
  getUserAuthorizedClientIds,
  fetchInPages,
} = require('../../lib/userScope');
const { filterValidProjectRecords } = require('../../lib/projectLinkage');

// Mirror of the operations module's back-office gate: only these roles may see
// work requests they are not directly involved in (assignee / requester).
const _isBackOfficeUser = (user) => {
  if (!user) return false;
  return user.role === 'Admin';
};

// Mirror of the disbursements module's list gate for calendar disbursements.
const _isAccountingUser = (user) =>
  !!user && ((user.departments || []).includes('Accounting') || user.role === 'Accounting');

// Disbursement statuses visible to non-admin/non-accounting users, matching
// the disbursements module list restriction.
const _STAFF_VISIBLE_DISB_STATUSES = ['Released', 'Funded', 'Rejected'];

// ============================================================
// Helper: get Monday and Sunday of the week containing a date
// ============================================================
const getWeekBounds = (dateStr) => {
  const d = new Date(dateStr + 'T12:00:00Z'); // Noon UTC avoids timezone edge
  const day = d.getUTCDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() + diffToMon);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    start: monday.toISOString().slice(0, 10),
    end: sunday.toISOString().slice(0, 10),
  };
};

// ============================================================
// Shared: 30-second in-memory cache for analytics/dashboard
// ============================================================
const ANALYTICS_CACHE_TTL_MS = 30_000;
const analyticsCache = new Map();

const invalidateAnalytics = (entityId) => analyticsCache.delete(entityId);

const getCachedAnalytics = (entityId) => {
  const entry = analyticsCache.get(entityId);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  analyticsCache.delete(entityId);
  return null;
};

const setCachedAnalytics = (entityId, data) => {
  analyticsCache.set(entityId, { data, expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS });
};

// ============================================================
// Analytics
// ============================================================

/**
 * Aggregate the six independent analytics queries into the dashboard shape.
 * @param {string} entityId
 * @param {object} [user]
 * @returns {Promise<object>}
 */
const computeAnalytics = async (entityId, user) => {
  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  let authorizedClientIds = null;

  if (!isAdmin) {
    if (!user) {
      return {
        clients: { total: 0 },
        workRequests: { total: 0 },
        documents: { total: 0 },
        invoices: { total: 0, totalBilled: 0, totalCollected: 0, totalOutstanding: 0, byStatus: {} },
        disbursements: { total: 0, totalAmount: 0, releasedAmount: 0, byStatus: {} },
        transmittals: { total: 0, byStatus: {} },
        revenue: { totalBilled: 0, totalCollected: 0, totalOutstanding: 0, totalExpenses: 0, netIncome: 0 },
      };
    }
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    authorizedClientIds = await getUserAuthorizedClientIds(user, entityId);
    if (concernedWrIds.length === 0) {
      return {
        clients: { total: 0 },
        workRequests: { total: 0 },
        documents: { total: 0 },
        invoices: { total: 0, totalBilled: 0, totalCollected: 0, totalOutstanding: 0, byStatus: {} },
        disbursements: { total: 0, totalAmount: 0, releasedAmount: 0, byStatus: {} },
        transmittals: { total: 0, byStatus: {} },
        revenue: { totalBilled: 0, totalCollected: 0, totalOutstanding: 0, totalExpenses: 0, netIncome: 0 },
      };
    }
  }

  let clientsQuery = supabaseAdmin
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);

  let wrQuery = supabaseAdmin
    .from('work_requests')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null)
    .or('creation_approval_status.is.null,creation_approval_status.eq.approved');

  if (entityId && entityId !== 'ALL') {
    clientsQuery = clientsQuery.eq('entity_id', entityId);
    wrQuery = wrQuery.eq('entity_id', entityId);
  }

  if (!isAdmin) {
    if (authorizedClientIds) clientsQuery = clientsQuery.in('id', authorizedClientIds);
    if (concernedWrIds) wrQuery = wrQuery.in('id', concernedWrIds);
  }

  const [
    { count: clientsCount },
    { count: wrCount },
    rawDocs,
    rawInvoices,
    rawDisbursements,
    rawTransmittals,
  ] = await Promise.all([
    clientsQuery,
    wrQuery,
    fetchInPages(() => {
      let q = supabaseAdmin
        .from('documents')
        .select('*')
        .is('deleted_at', null)
        .eq('status', 'active');
      if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
      return q;
    }),
    fetchInPages(() => {
      let q = supabaseAdmin
        .from('invoices')
        .select('*')
        .is('deleted_at', null);
      if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
      return q;
    }),
    fetchInPages(() => {
      let q = supabaseAdmin
        .from('disbursements')
        .select('*')
        .is('deleted_at', null);
      if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
      return q;
    }),
    fetchInPages(() => {
      let q = supabaseAdmin
        .from('transmittals')
        .select('*')
        .is('deleted_at', null);
      if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
      return q;
    }),
  ]);

  const [docs, invoices, disbursements, transmittals] = await Promise.all([
    filterValidProjectRecords(rawDocs || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawInvoices || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawDisbursements || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawTransmittals || [], { user, entityId, concernedWrIds }),
  ]);

  const invoiceSummary = {
    total: (invoices || []).length,
    totalBilled: 0,
    totalCollected: 0,
    totalOutstanding: 0,
    byStatus: {},
  };
  for (const inv of invoices || []) {
    invoiceSummary.totalBilled += parseFloat(inv.total) || 0;
    invoiceSummary.totalCollected += parseFloat(inv.amount_paid) || 0;
    invoiceSummary.totalOutstanding += parseFloat(inv.balance) || 0;
    invoiceSummary.byStatus[inv.status] = (invoiceSummary.byStatus[inv.status] || 0) + 1;
  }

  const disbursementSummary = {
    total: (disbursements || []).length,
    totalAmount: 0,
    releasedAmount: 0,
    byStatus: {},
  };
  for (const d of disbursements || []) {
    disbursementSummary.totalAmount += parseFloat(d.amount) || 0;
    if (d.status === 'Released') {
      disbursementSummary.releasedAmount += parseFloat(d.amount) || 0;
    }
    disbursementSummary.byStatus[d.status] = (disbursementSummary.byStatus[d.status] || 0) + 1;
  }

  const transmittalSummary = { total: (transmittals || []).length, byStatus: {} };
  for (const t of transmittals || []) {
    transmittalSummary.byStatus[t.status] = (transmittalSummary.byStatus[t.status] || 0) + 1;
  }

  return {
    clients: { total: clientsCount || 0 },
    workRequests: { total: wrCount || 0 },
    documents: { total: (docs || []).length },
    invoices: invoiceSummary,
    disbursements: disbursementSummary,
    transmittals: transmittalSummary,
    revenue: {
      totalBilled: invoiceSummary.totalBilled,
      totalCollected: invoiceSummary.totalCollected,
      totalOutstanding: invoiceSummary.totalOutstanding,
      totalExpenses: disbursementSummary.releasedAmount,
      netIncome: invoiceSummary.totalCollected - disbursementSummary.releasedAmount,
    },
  };
};

// ============================================================
// Analytics
// ============================================================

/**
 * Get dashboard-level analytics for an entity.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.user]
 * @returns {Promise<object>}
 */
const getAnalytics = async ({ entityId, user }) => {
  if (entityId === 'ALL') {
    const [ata, lta] = await Promise.all([
      getAnalyticsForEntityCode('ATA', user),
      getAnalyticsForEntityCode('LTA', user),
    ]);
    return { analyticsByEntity: { ATA: ata, LTA: lta } };
  }

  return getAnalyticsForEntityCode(entityId, user);
};

/**
 * Resolve an entity identifier (code or UUID) to a UUID. For 'ALL' returns 'ALL'.
 * @param {string} entityId
 * @returns {Promise<string>}
 */
const resolveEntityIdOrAll = async (entityId) => {
  if (entityId === 'ALL') return 'ALL';
  if (entityId === 'ATA' || entityId === 'LTA') return resolveEntityId(entityId);
  return entityId;
};

/**
 * Load upcoming calendar items for a single entity UUID.
 * Returns work requests (with embedded tasks) and disbursements due soon.
 *
 * Visibility is user-scoped, mirroring the owning modules:
 * - Work requests: back-office users (Admin / Manager / Management) see all;
 *   staff only see WRs they submitted, requested, or are assigned a task on.
 * - Disbursements: Admin/Accounting see all; others only see Released/Funded/
 *   Rejected disbursements linked to a work request they are concerned with.
 * @param {string} entityUuid
 * @param {object} [user] - authenticated user (null/omitted = most restrictive view)
 * @returns {Promise<Array>}
 */
const loadCalendarItemsForEntity = async (entityUuid, user) => {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  // Fetch open work requests with a due date: overdue items plus upcoming 30 days.
  // We keep the query simple (no complex OR) and let the small result-set be
  // post-filtered for the calendar view.
  const openStatuses = ['Draft', 'In Progress', 'For Review'];
  const [
    { data: upcomingWrs },
    { data: overdueWrs },
    { data: upcomingDisbs },
    { data: overdueDisbs },
  ] = await Promise.all([
    supabaseAdmin
      .from('work_requests')
      .select(
        'id, title, status, due_date, client_id, assigned_to, requested_by, submitted_by, entity_id'
      )
      .eq('entity_id', entityUuid)
      .or('creation_approval_status.is.null,creation_approval_status.eq.approved')
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .gte('due_date', today)
      .lte('due_date', thirtyDaysLater)
      .order('due_date', { ascending: true })
      .limit(200),
    supabaseAdmin
      .from('work_requests')
      .select(
        'id, title, status, due_date, client_id, assigned_to, requested_by, submitted_by, entity_id'
      )
      .eq('entity_id', entityUuid)
      .or('creation_approval_status.is.null,creation_approval_status.eq.approved')
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .in('status', openStatuses)
      .order('due_date', { ascending: true })
      .limit(100),
    supabaseAdmin
      .from('disbursements')
      .select(
        'id, disbursement_number, status, due_date, amount, client_id, entity_id, linked_work_request_id'
      )
      .eq('entity_id', entityUuid)
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .gte('due_date', today)
      .lte('due_date', thirtyDaysLater)
      .order('due_date', { ascending: true })
      .limit(200),
    supabaseAdmin
      .from('disbursements')
      .select(
        'id, disbursement_number, status, due_date, amount, client_id, entity_id, linked_work_request_id'
      )
      .eq('entity_id', entityUuid)
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .in('status', ['Draft', 'Pending', 'Approved'])
      .order('due_date', { ascending: true })
      .limit(100),
  ]);

  const workRequests = [...(upcomingWrs || []), ...(overdueWrs || [])];
  const disbursements = [...(upcomingDisbs || []), ...(overdueDisbs || [])];

  const wrIds = (workRequests || []).map((wr) => wr.id);
  const { data: taskRows } = wrIds.length
    ? await supabaseAdmin
        .from('tasks')
        .select('*')
        .in('work_request_id', wrIds)
        .is('deleted_at', null)
        .order('display_order', { ascending: true })
    : { data: [] };

  const tasksByWr = new Map();
  (taskRows || []).forEach((t) => {
    if (!tasksByWr.has(t.work_request_id)) tasksByWr.set(t.work_request_id, []);
    tasksByWr.get(t.work_request_id).push(t);
  });

  const entityCode = await resolveEntityCode(entityUuid);

  // Per-user visibility scope: only Admin sees all projects.
  // Other users are strictly limited to their concerned projects.
  const seeAllWrs = user?.role === 'Admin';
  const canSeeAllDisbursements = user?.role === 'Admin';
  let concernedWrSet = null;
  if (!seeAllWrs || !canSeeAllDisbursements) {
    const ids = await getUserConcernedWorkRequestIds(user, { entityId: entityUuid });
    concernedWrSet = new Set(ids);
  }

  const items = [];
  for (const wr of workRequests || []) {
    if (!seeAllWrs && (!concernedWrSet || !concernedWrSet.has(wr.id))) continue;
    items.push({
      id: wr.id,
      type: 'wr',
      title: wr.title,
      status: wr.status,
      dueDate: wr.due_date,
      clientId: wr.client_id,
      assigneeId: wr.assigned_to || wr.requested_by,
      entity: entityCode,
      tasks: (tasksByWr.get(wr.id) || []).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        assigneeId: t.assignee_id,
        assigneeName: t.assignee_name,
        dueDate: t.due_date,
      })),
    });
  }

  for (const d of disbursements || []) {
    if (!canSeeAllDisbursements) {
      if (!d.linked_work_request_id || !concernedWrSet || !concernedWrSet.has(d.linked_work_request_id)) continue;
    }
    items.push({
      id: d.id,
      type: 'db',
      title: d.disbursement_number || 'Disbursement',
      status: d.status,
      dueDate: d.due_date,
      clientId: d.client_id,
      entity: entityCode,
      amount: parseFloat(d.amount) || 0,
    });
  }

  return items.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
};

/**
 * Internal helper that accepts either an entity code ('ATA'/'LTA') or UUID.
 * @param {string} codeOrUuid
 * @param {object} [user]
 * @returns {Promise<object>}
 */
const getAnalyticsForEntityCode = async (codeOrUuid, user) => {
  const resolved = await resolveEntityIdOrAll(codeOrUuid);
  const isAdmin = user?.role === 'Admin';
  if (isAdmin) {
    const cached = getCachedAnalytics(resolved);
    if (cached) return cached;
    const data = await computeAnalytics(resolved, user);
    setCachedAnalytics(resolved, data);
    return data;
  }
  // Non-admin: fresh computation without caching so revocation is immediate
  return computeAnalytics(resolved, user);
};

/**
 * Optimized dashboard summary intended for the dashboard widget.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.user] - authenticated user for calendar and analytics visibility
 * @returns {Promise<object>}
 */
const getDashboardSummary = async ({ entityId, user }) => {
  const isAdmin = user?.role === 'Admin';

  if (entityId === 'ALL') {
    let analyticsPayload = isAdmin ? getCachedAnalytics('ALL') : null;
    if (!analyticsPayload) {
      const [ataAnalytics, ltaAnalytics] = await Promise.all([
        getAnalyticsForEntityCode('ATA', user),
        getAnalyticsForEntityCode('LTA', user),
      ]);
      analyticsPayload = {
        analyticsByEntity: { ATA: ataAnalytics, LTA: ltaAnalytics },
        ATA: ataAnalytics,
        LTA: ltaAnalytics,
      };
      if (isAdmin) {
        setCachedAnalytics('ALL', analyticsPayload);
      }
    }

    const [ataCalendar, ltaCalendar] = await Promise.all([
      resolveEntityId('ATA').then((uuid) => loadCalendarItemsForEntity(uuid, user)),
      resolveEntityId('LTA').then((uuid) => loadCalendarItemsForEntity(uuid, user)),
    ]);

    return { ...analyticsPayload, calendar: [...ataCalendar, ...ltaCalendar] };
  }

  const resolved = await resolveEntityIdOrAll(entityId);
  const calendarPromise = loadCalendarItemsForEntity(resolved, user);

  if (isAdmin) {
    const cached = getCachedAnalytics(resolved);
    if (cached) {
      const { calendar: _ignoredCalendar, ...analytics } = cached;
      return { ...analytics, calendar: await calendarPromise };
    }

    // Gate/replace raw get_dashboard_summary RPC: the stored procedure does not filter
    // creation_approval_status = 'approved', which would leak unadmitted work requests to Admin.
    // Use the filtered computeAnalytics query aggregation instead.
    const analytics = await computeAnalytics(resolved, user);
    setCachedAnalytics(resolved, analytics);
    return { ...analytics, calendar: await calendarPromise };
  }

  // Non-admin: fresh computation without caching
  const analytics = await computeAnalytics(resolved, user);
  return { ...analytics, calendar: await calendarPromise };
};

// ============================================================
// Daily Report
// ============================================================

/**
 * Get activity report for a specific date.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.date - YYYY-MM-DD
 * @returns {Promise<object>}
 */
const getDailyReport = async ({ entityId, date, user }) => {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    if (!user) {
      return {
        date,
        workRequests: [],
        documents: [],
        invoices: [],
        payments: [],
        disbursements: [],
        transmittals: [],
        summary: {
          workRequests: 0,
          documents: 0,
          invoices: 0,
          invoicesTotal: 0,
          payments: 0,
          paymentsTotal: 0,
          disbursements: 0,
          disbursementsTotal: 0,
          transmittals: 0,
        },
      };
    }
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return {
        date,
        workRequests: [],
        documents: [],
        invoices: [],
        payments: [],
        disbursements: [],
        transmittals: [],
        summary: {
          workRequests: 0,
          documents: 0,
          invoices: 0,
          invoicesTotal: 0,
          payments: 0,
          paymentsTotal: 0,
          disbursements: 0,
          disbursementsTotal: 0,
          transmittals: 0,
        },
      };
    }
  }

  // Work requests created that day
  const rawWrs = await fetchInPages(() => {
    let wrQ = supabaseAdmin
      .from('work_requests')
      .select('id, title, status, created_at, entity_id')
      .is('deleted_at', null)
      .or('creation_approval_status.is.null,creation_approval_status.eq.approved')
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);
    if (entityId && entityId !== 'ALL') wrQ = wrQ.eq('entity_id', entityId);
    if (!isAdmin && concernedWrIds) wrQ = wrQ.in('id', concernedWrIds);
    return wrQ.order('created_at', { ascending: false });
  });

  // Documents uploaded
  const rawDocs = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  // Invoices issued
  const rawInvoices = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('invoices')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  // Disbursements filed
  const rawDisb = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('disbursements')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  // Transmittals
  const rawTrans = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('transmittals')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  const [documents, invoices, disbursements, transmittals] = await Promise.all([
    filterValidProjectRecords(rawDocs || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawInvoices || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawDisb || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawTrans || [], { user, entityId, concernedWrIds }),
  ]);

  const validInvoiceIds = (invoices || []).map((i) => i.id);
  const payments = [];
  if (validInvoiceIds.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < validInvoiceIds.length; i += CHUNK_SIZE) {
      const chunk = validInvoiceIds.slice(i, i + CHUNK_SIZE);
      const chunkPayments = await fetchInPages(() =>
        supabaseAdmin
          .from('invoice_payments')
          .select('id, amount, method, payment_date, invoice_id, created_at')
          .in('invoice_id', chunk)
          .gte('created_at', dayStart)
          .lte('created_at', dayEnd)
          .order('created_at', { ascending: false })
      );
      if (chunkPayments) payments.push(...chunkPayments);
    }
  }

  const workRequests = rawWrs || [];

  return {
    date,
    workRequests,
    documents,
    invoices,
    payments: payments || [],
    disbursements,
    transmittals,
    summary: {
      workRequests: workRequests.length,
      documents: documents.length,
      invoices: invoices.length,
      invoicesTotal: invoices.reduce((s, i) => s + parseFloat(i.total || 0), 0),
      payments: (payments || []).length,
      paymentsTotal: (payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0),
      disbursements: disbursements.length,
      disbursementsTotal: disbursements.reduce((s, d) => s + parseFloat(d.amount || 0), 0),
      transmittals: transmittals.length,
    },
  };
};

// ============================================================
// Weekly Report
// ============================================================

/**
 * Get activity report for the week containing the given date.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.date - YYYY-MM-DD
 * @param {object} [params.user]
 * @returns {Promise<object>}
 */
const getWeeklyReport = async ({ entityId, date, user }) => {
  const { start, end } = getWeekBounds(date);
  const weekStart = `${start}T00:00:00.000Z`;
  const weekEnd = `${end}T23:59:59.999Z`;

  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    if (!user) {
      return {
        weekStart: start,
        weekEnd: end,
        summary: {
          workRequests: 0,
          invoices: 0,
          invoicesTotal: 0,
          payments: 0,
          paymentsTotal: 0,
          disbursements: 0,
          disbursementsTotal: 0,
          documents: 0,
          transmittals: 0,
        },
        details: {
          workRequests: [],
          invoices: [],
          payments: [],
          disbursements: [],
          documents: [],
          transmittals: [],
        },
      };
    }
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return {
        weekStart: start,
        weekEnd: end,
        summary: {
          workRequests: 0,
          invoices: 0,
          invoicesTotal: 0,
          payments: 0,
          paymentsTotal: 0,
          disbursements: 0,
          disbursementsTotal: 0,
          documents: 0,
          transmittals: 0,
        },
        details: {
          workRequests: [],
          invoices: [],
          payments: [],
          disbursements: [],
          documents: [],
          transmittals: [],
        },
      };
    }
  }

  const rawWrs = await fetchInPages(() => {
    let wrQ = supabaseAdmin
      .from('work_requests')
      .select('id, title, status, created_at, entity_id')
      .is('deleted_at', null)
      .or('creation_approval_status.is.null,creation_approval_status.eq.approved')
      .gte('created_at', weekStart)
      .lte('created_at', weekEnd);
    if (entityId && entityId !== 'ALL') wrQ = wrQ.eq('entity_id', entityId);
    if (!isAdmin && concernedWrIds) wrQ = wrQ.in('id', concernedWrIds);
    return wrQ.order('created_at', { ascending: false });
  });

  const rawInvoices = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('invoices')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', weekStart)
      .lte('created_at', weekEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  const rawDisb = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('disbursements')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', weekStart)
      .lte('created_at', weekEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  const rawDocs = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('documents')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', weekStart)
      .lte('created_at', weekEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  const rawTrans = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('transmittals')
      .select('*')
      .is('deleted_at', null)
      .gte('created_at', weekStart)
      .lte('created_at', weekEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  const [documents, invoices, disbursements, transmittals] = await Promise.all([
    filterValidProjectRecords(rawDocs || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawInvoices || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawDisb || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawTrans || [], { user, entityId, concernedWrIds }),
  ]);

  const validInvoiceIds = (invoices || []).map((i) => i.id);
  const payments = [];
  if (validInvoiceIds.length > 0) {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < validInvoiceIds.length; i += CHUNK_SIZE) {
      const chunk = validInvoiceIds.slice(i, i + CHUNK_SIZE);
      const chunkPayments = await fetchInPages(() =>
        supabaseAdmin
          .from('invoice_payments')
          .select('id, amount, method, created_at, invoice_id')
          .in('invoice_id', chunk)
          .gte('created_at', weekStart)
          .lte('created_at', weekEnd)
          .order('created_at', { ascending: false })
      );
      if (chunkPayments) payments.push(...chunkPayments);
    }
  }

  const workRequests = rawWrs || [];

  return {
    weekStart: start,
    weekEnd: end,
    summary: {
      workRequests: workRequests.length,
      invoices: invoices.length,
      invoicesTotal: invoices.reduce((s, i) => s + parseFloat(i.total || 0), 0),
      payments: (payments || []).length,
      paymentsTotal: (payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0),
      disbursements: disbursements.length,
      disbursementsTotal: disbursements.reduce((s, d) => s + parseFloat(d.amount || 0), 0),
      documents: documents.length,
      transmittals: transmittals.length,
    },
    details: {
      workRequests,
      invoices,
      payments: payments || [],
      disbursements,
      documents,
      transmittals,
    },
  };
};

// ============================================================
// Monthly Pending
// ============================================================

/**
 * Get items pending attention for a given month.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} [params.month] - YYYY-MM, defaults to current
 * @param {object} [params.user]
 * @returns {Promise<object>}
 */
const getMonthlyPending = async ({ entityId, month, user }) => {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const monthEnd = `${targetMonth}-31`; // Safe upper bound

  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    if (!user) {
      return {
        month: targetMonth,
        overdueInvoices: { count: 0, totalOutstanding: 0, items: [] },
        pendingDisbursements: { count: 0, totalAmount: 0, items: [] },
        staleTransmittals: { count: 0, items: [] },
      };
    }
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return {
        month: targetMonth,
        overdueInvoices: { count: 0, totalOutstanding: 0, items: [] },
        pendingDisbursements: { count: 0, totalAmount: 0, items: [] },
        staleTransmittals: { count: 0, items: [] },
      };
    }
  }

  // Overdue invoices (due in or before this month, balance > 0)
  const rawInvoices = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('invoices')
      .select('*, clients(name)')
      .is('deleted_at', null)
      .gt('balance', 0)
      .lte('due_date', monthEnd);
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('due_date', { ascending: true });
  });

  // Pending disbursements
  const rawDisb = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('disbursements')
      .select('*')
      .is('deleted_at', null)
      .or(
        'and(lifecycle_version.eq.2,status.in.(Draft,Approved,Funded)),and(lifecycle_version.eq.1,status.in.(Pending,Approved))'
      );
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  // Draft transmittals older than 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const rawTrans = await fetchInPages(() => {
    let q = supabaseAdmin
      .from('transmittals')
      .select('*, clients(name)')
      .is('deleted_at', null)
      .eq('status', 'Draft')
      .lt('created_at', sevenDaysAgo.toISOString());
    if (entityId && entityId !== 'ALL') q = q.eq('entity_id', entityId);
    return q.order('created_at', { ascending: false });
  });

  const [overdueInvoices, pendingDisbursements, staleDraftTransmittals] = await Promise.all([
    filterValidProjectRecords(rawInvoices || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawDisb || [], { user, entityId, concernedWrIds }),
    filterValidProjectRecords(rawTrans || [], { user, entityId, concernedWrIds }),
  ]);

  return {
    month: targetMonth,
    overdueInvoices: {
      count: overdueInvoices.length,
      totalOutstanding: overdueInvoices.reduce((s, i) => s + parseFloat(i.balance || 0), 0),
      items: overdueInvoices,
    },
    pendingDisbursements: {
      count: pendingDisbursements.length,
      totalAmount: pendingDisbursements.reduce((s, d) => s + parseFloat(d.amount || 0), 0),
      items: pendingDisbursements,
    },
    staleTransmittals: {
      count: staleDraftTransmittals.length,
      items: staleDraftTransmittals,
    },
  };
};

// ============================================================
// Aging Report
// ============================================================

/**
 * Calculate accounts receivable aging report.
 * @param {object} params
 * @param {string} params.entityId
 * @param {object} [params.user]
 * @returns {Promise<object>}
 */
const getAgingReport = async ({ entityId, user }) => {
  const isAdmin = user?.role === 'Admin';
  let concernedWrIds = null;
  if (!isAdmin) {
    if (!user) {
      return {
        summary: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, grandTotal: 0 },
        buckets: {
          current: { total: 0, count: 0, invoices: [] },
          '1-30': { total: 0, count: 0, invoices: [] },
          '31-60': { total: 0, count: 0, invoices: [] },
          '61-90': { total: 0, count: 0, invoices: [] },
          '90+': { total: 0, count: 0, invoices: [] },
        },
      };
    }
    concernedWrIds = await getUserConcernedWorkRequestIds(user, { entityId });
    if (concernedWrIds.length === 0) {
      return {
        summary: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, grandTotal: 0 },
        buckets: {
          current: { total: 0, count: 0, invoices: [] },
          '1-30': { total: 0, count: 0, invoices: [] },
          '31-60': { total: 0, count: 0, invoices: [] },
          '61-90': { total: 0, count: 0, invoices: [] },
          '90+': { total: 0, count: 0, invoices: [] },
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
    current: { total: 0, count: 0, invoices: [] },
    '1-30': { total: 0, count: 0, invoices: [] },
    '31-60': { total: 0, count: 0, invoices: [] },
    '61-90': { total: 0, count: 0, invoices: [] },
    '90+': { total: 0, count: 0, invoices: [] },
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

    let bucket;
    if (daysOverdue <= 0) bucket = 'current';
    else if (daysOverdue <= 30) bucket = '1-30';
    else if (daysOverdue <= 60) bucket = '31-60';
    else if (daysOverdue <= 90) bucket = '61-90';
    else bucket = '90+';

    buckets[bucket].total += balance;
    buckets[bucket].count += 1;
    buckets[bucket].invoices.push(entry);
  }

  const grandTotal = Object.values(buckets).reduce((s, b) => s + b.total, 0);

  return {
    summary: {
      current: buckets.current.total,
      '1-30': buckets['1-30'].total,
      '31-60': buckets['31-60'].total,
      '61-90': buckets['61-90'].total,
      '90+': buckets['90+'].total,
      grandTotal,
    },
    buckets,
  };
};

module.exports = {
  invalidateAnalytics,
  getAnalytics,
  getDashboardSummary,
  getDailyReport,
  getWeeklyReport,
  getMonthlyPending,
  getAgingReport,
};
