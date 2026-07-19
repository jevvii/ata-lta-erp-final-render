/**
 * Reports service.
 * Read-only analytics and report generation.
 * Queries data across all Phase 2–6 tables.
 *
 * Phase 7 — Agent B
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');
const logger = require('../../lib/logger');
const { resolveEntityId, resolveEntityCode } = require('../../lib/entityResolver');

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
 * @returns {Promise<object>}
 */
const computeAnalytics = async (entityId) => {
  const [
    { count: clientsCount },
    { count: wrCount },
    { count: docsCount },
    { data: invoices },
    { data: disbursements },
    { data: transmittals },
  ] = await Promise.all([
    supabaseAdmin
      .from('clients')
      .select('*', { count: 'exact', head: true })
      .eq('entity_id', entityId)
      .is('deleted_at', null),
    supabaseAdmin
      .from('work_requests')
      .select('*', { count: 'exact', head: true })
      .eq('entity_id', entityId)
      .is('deleted_at', null),
    supabaseAdmin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .eq('status', 'active'),
    supabaseAdmin
      .from('invoices')
      .select('status, total, amount_paid, balance')
      .eq('entity_id', entityId)
      .is('deleted_at', null),
    supabaseAdmin
      .from('disbursements')
      .select('status, amount')
      .eq('entity_id', entityId)
      .is('deleted_at', null),
    supabaseAdmin
      .from('transmittals')
      .select('status')
      .eq('entity_id', entityId)
      .is('deleted_at', null),
  ]);

  const invoiceSummary = {
    total: (invoices || []).length,
    totalBilled: 0,
    totalCollected: 0,
    totalOutstanding: 0,
    byStatus: {},
  };
  for (const inv of (invoices || [])) {
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
  for (const d of (disbursements || [])) {
    disbursementSummary.totalAmount += parseFloat(d.amount) || 0;
    if (d.status === 'Released') {
      disbursementSummary.releasedAmount += parseFloat(d.amount) || 0;
    }
    disbursementSummary.byStatus[d.status] = (disbursementSummary.byStatus[d.status] || 0) + 1;
  }

  const transmittalSummary = { total: (transmittals || []).length, byStatus: {} };
  for (const t of (transmittals || [])) {
    transmittalSummary.byStatus[t.status] = (transmittalSummary.byStatus[t.status] || 0) + 1;
  }

  return {
    clients: { total: clientsCount || 0 },
    workRequests: { total: wrCount || 0 },
    documents: { total: docsCount || 0 },
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
 * @returns {Promise<object>}
 */
const getAnalytics = async ({ entityId }) => {
  if (entityId === 'ALL') {
    const [ata, lta] = await Promise.all([
      getAnalyticsForEntityCode('ATA'),
      getAnalyticsForEntityCode('LTA'),
    ]);
    return { analyticsByEntity: { ATA: ata, LTA: lta } };
  }

  return getAnalyticsForEntityCode(entityId);
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
 * @param {string} entityUuid
 * @returns {Promise<Array>}
 */
const loadCalendarItemsForEntity = async (entityUuid) => {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Fetch open work requests with a due date: overdue items plus upcoming 30 days.
  // We keep the query simple (no complex OR) and let the small result-set be
  // post-filtered for the calendar view.
  const openStatuses = ['Draft', 'In Progress', 'For Review'];
  const [{ data: upcomingWrs }, { data: overdueWrs }, { data: upcomingDisbs }, { data: overdueDisbs }] = await Promise.all([
    supabaseAdmin
      .from('work_requests')
      .select('id, title, status, due_date, client_id, assigned_to, requested_by, entity_id')
      .eq('entity_id', entityUuid)
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .gte('due_date', today)
      .lte('due_date', thirtyDaysLater)
      .order('due_date', { ascending: true })
      .limit(200),
    supabaseAdmin
      .from('work_requests')
      .select('id, title, status, due_date, client_id, assigned_to, requested_by, entity_id')
      .eq('entity_id', entityUuid)
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .lt('due_date', today)
      .in('status', openStatuses)
      .order('due_date', { ascending: true })
      .limit(100),
    supabaseAdmin
      .from('disbursements')
      .select('id, disbursement_number, status, due_date, amount, client_id, entity_id')
      .eq('entity_id', entityUuid)
      .is('deleted_at', null)
      .not('due_date', 'is', null)
      .gte('due_date', today)
      .lte('due_date', thirtyDaysLater)
      .order('due_date', { ascending: true })
      .limit(200),
    supabaseAdmin
      .from('disbursements')
      .select('id, disbursement_number, status, due_date, amount, client_id, entity_id')
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

  const items = [];
  for (const wr of workRequests || []) {
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
 * @returns {Promise<object>}
 */
const getAnalyticsForEntityCode = async (codeOrUuid) => {
  const resolved = await resolveEntityIdOrAll(codeOrUuid);
  const cached = getCachedAnalytics(resolved);
  if (cached) return cached;
  const data = await computeAnalytics(resolved);
  setCachedAnalytics(resolved, data);
  return data;
};

/**
 * Optimized dashboard summary intended for the dashboard widget.
 * Attempts a single Supabase RPC call; falls back to the parallelized
 * computeAnalytics aggregator with a 30-second in-memory cache.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<object>}
 */
const getDashboardSummary = async ({ entityId }) => {
  // Consolidated view: compute both entities in parallel.
  if (entityId === 'ALL') {
    const cached = getCachedAnalytics('ALL');
    if (cached) return cached;

    try {
      const { data, error } = await supabaseAdmin.rpc('get_dashboard_summary', { entity_id: entityId });
      if (!error && data) {
        const result = Array.isArray(data) ? data[0] : data;
        if (result && typeof result === 'object') {
          setCachedAnalytics('ALL', result);
          return result;
        }
      }
    } catch (rpcErr) {
      logger.warn('getDashboardSummary rpc fallback', { entityId, error: rpcErr.message });
    }

    const [ataAnalytics, ltaAnalytics, ataCalendar, ltaCalendar] = await Promise.all([
      getAnalyticsForEntityCode('ATA'),
      getAnalyticsForEntityCode('LTA'),
      resolveEntityId('ATA').then(loadCalendarItemsForEntity),
      resolveEntityId('LTA').then(loadCalendarItemsForEntity),
    ]);

    const result = {
      analyticsByEntity: { ATA: ataAnalytics, LTA: ltaAnalytics },
      ATA: ataAnalytics,
      LTA: ltaAnalytics,
      calendar: [...ataCalendar, ...ltaCalendar],
    };
    setCachedAnalytics('ALL', result);
    return result;
  }

  const resolved = await resolveEntityIdOrAll(entityId);
  const cached = getCachedAnalytics(resolved);
  if (cached) {
    // If cached analytics came from an earlier request without calendar,
    // still compute calendar on the fly rather than returning stale/incomplete data.
    if (!cached.calendar) {
      const calendar = await loadCalendarItemsForEntity(resolved);
      return { ...cached, calendar };
    }
    return cached;
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('get_dashboard_summary', { entity_id: resolved });
    if (!error && data) {
      const result = Array.isArray(data) ? data[0] : data;
      if (result && typeof result === 'object') {
        setCachedAnalytics(resolved, result);
        return result;
      }
    }
  } catch (rpcErr) {
    logger.warn('getDashboardSummary rpc fallback', { entityId, error: rpcErr.message });
  }

  const [analytics, calendar] = await Promise.all([
    computeAnalytics(resolved),
    loadCalendarItemsForEntity(resolved),
  ]);
  const data = { ...analytics, calendar };
  setCachedAnalytics(resolved, data);
  return data;
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
const getDailyReport = async ({ entityId, date }) => {
  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  // Work requests created that day
  const { data: workRequests } = await supabaseAdmin
    .from('work_requests')
    .select('id, title, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  // Documents uploaded
  const { data: documents } = await supabaseAdmin
    .from('documents')
    .select('id, original_name, category, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  // Invoices issued
  const { data: invoices } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, total, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  // Payments received (scoped to entity via invoices; invoice_payments has no entity_id)
  const { data: invoiceRows } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('entity_id', entityId)
    .is('deleted_at', null);
  const invoiceIds = (invoiceRows || []).map((i) => i.id);

  const { data: payments } = invoiceIds.length
    ? await supabaseAdmin
      .from('invoice_payments')
      .select('id, amount, method, payment_date, invoice_id')
      .in('invoice_id', invoiceIds)
      .gte('created_at', dayStart)
      .lte('created_at', dayEnd)
    : { data: [] };

  // Disbursements filed
  const { data: disbursements } = await supabaseAdmin
    .from('disbursements')
    .select('id, disbursement_number, amount, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  // Transmittals
  const { data: transmittals } = await supabaseAdmin
    .from('transmittals')
    .select('id, tracking_number, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

  return {
    date,
    workRequests: workRequests || [],
    documents: documents || [],
    invoices: invoices || [],
    payments: payments || [],
    disbursements: disbursements || [],
    transmittals: transmittals || [],
    summary: {
      workRequests: (workRequests || []).length,
      documents: (documents || []).length,
      invoices: (invoices || []).length,
      invoicesTotal: (invoices || []).reduce((s, i) => s + parseFloat(i.total || 0), 0),
      payments: (payments || []).length,
      paymentsTotal: (payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0),
      disbursements: (disbursements || []).length,
      disbursementsTotal: (disbursements || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0),
      transmittals: (transmittals || []).length,
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
 * @returns {Promise<object>}
 */
const getWeeklyReport = async ({ entityId, date }) => {
  const { start, end } = getWeekBounds(date);
  const weekStart = `${start}T00:00:00.000Z`;
  const weekEnd = `${end}T23:59:59.999Z`;

  const { data: workRequests } = await supabaseAdmin
    .from('work_requests')
    .select('id, title, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', weekStart)
    .lte('created_at', weekEnd);

  const { data: invoices } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, total, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', weekStart)
    .lte('created_at', weekEnd);

  // Payments received (scoped to entity via invoices; invoice_payments has no entity_id)
  const { data: invoiceRows } = await supabaseAdmin
    .from('invoices')
    .select('id')
    .eq('entity_id', entityId)
    .is('deleted_at', null);
  const invoiceIds = (invoiceRows || []).map((i) => i.id);

  const { data: payments } = invoiceIds.length
    ? await supabaseAdmin
      .from('invoice_payments')
      .select('id, amount, method, created_at')
      .in('invoice_id', invoiceIds)
      .gte('created_at', weekStart)
      .lte('created_at', weekEnd)
    : { data: [] };

  const { data: disbursements } = await supabaseAdmin
    .from('disbursements')
    .select('id, disbursement_number, amount, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', weekStart)
    .lte('created_at', weekEnd);

  const { data: documents } = await supabaseAdmin
    .from('documents')
    .select('id, original_name, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', weekStart)
    .lte('created_at', weekEnd);

  const { data: transmittals } = await supabaseAdmin
    .from('transmittals')
    .select('id, tracking_number, status, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gte('created_at', weekStart)
    .lte('created_at', weekEnd);

  return {
    weekStart: start,
    weekEnd: end,
    summary: {
      workRequests: (workRequests || []).length,
      invoices: (invoices || []).length,
      invoicesTotal: (invoices || []).reduce((s, i) => s + parseFloat(i.total || 0), 0),
      payments: (payments || []).length,
      paymentsTotal: (payments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0),
      disbursements: (disbursements || []).length,
      disbursementsTotal: (disbursements || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0),
      documents: (documents || []).length,
      transmittals: (transmittals || []).length,
    },
    details: {
      workRequests: workRequests || [],
      invoices: invoices || [],
      payments: payments || [],
      disbursements: disbursements || [],
      documents: documents || [],
      transmittals: transmittals || [],
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
 * @returns {Promise<object>}
 */
const getMonthlyPending = async ({ entityId, month }) => {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const monthEnd = `${targetMonth}-31`; // Safe upper bound

  // Overdue invoices (due in or before this month, balance > 0)
  const { data: overdueInvoices } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, client_id, due_date, total, balance, status, clients(name)')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gt('balance', 0)
    .lte('due_date', monthEnd)
    .order('due_date', { ascending: true });

  // Pending disbursements
  const { data: pendingDisbursements } = await supabaseAdmin
    .from('disbursements')
    .select('id, disbursement_number, amount, status, category, created_at')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .in('status', ['Pending', 'Approved']);

  // Draft transmittals older than 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: staleDraftTransmittals } = await supabaseAdmin
    .from('transmittals')
    .select('id, tracking_number, client_id, created_at, clients(name)')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .eq('status', 'Draft')
    .lt('created_at', sevenDaysAgo.toISOString());

  return {
    month: targetMonth,
    overdueInvoices: {
      count: (overdueInvoices || []).length,
      totalOutstanding: (overdueInvoices || []).reduce((s, i) => s + parseFloat(i.balance || 0), 0),
      items: overdueInvoices || [],
    },
    pendingDisbursements: {
      count: (pendingDisbursements || []).length,
      totalAmount: (pendingDisbursements || []).reduce((s, d) => s + parseFloat(d.amount || 0), 0),
      items: pendingDisbursements || [],
    },
    staleTransmittals: {
      count: (staleDraftTransmittals || []).length,
      items: staleDraftTransmittals || [],
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
 * @returns {Promise<object>}
 */
const getAgingReport = async ({ entityId }) => {
  const { data: invoices, error } = await supabaseAdmin
    .from('invoices')
    .select('id, invoice_number, client_id, due_date, total, balance, clients(name)')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .gt('balance', 0);

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch aging data',
    });
  }

  const now = new Date();
  const buckets = {
    current: { total: 0, count: 0, invoices: [] },
    '1-30': { total: 0, count: 0, invoices: [] },
    '31-60': { total: 0, count: 0, invoices: [] },
    '61-90': { total: 0, count: 0, invoices: [] },
    '90+': { total: 0, count: 0, invoices: [] },
  };

  for (const inv of (invoices || [])) {
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
  getAnalytics,
  getDashboardSummary,
  getDailyReport,
  getWeeklyReport,
  getMonthlyPending,
  getAgingReport,
};
