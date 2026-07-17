/**
 * Reports service.
 * Read-only analytics and report generation.
 * Queries data across all Phase 2–6 tables.
 *
 * Phase 7 — Agent B
 */

const { supabaseAdmin } = require('../../services/supabaseClient');
const AppError = require('../../lib/AppError');

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
// Analytics
// ============================================================

/**
 * Get dashboard-level analytics for an entity.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<object>}
 */
const getAnalytics = async ({ entityId }) => {
  // Clients count
  const { count: clientsCount } = await supabaseAdmin
    .from('clients')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .is('deleted_at', null);

  // Work requests
  const { count: wrCount } = await supabaseAdmin
    .from('work_requests')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .is('deleted_at', null);

  // Documents
  const { count: docsCount } = await supabaseAdmin
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .eq('status', 'active');

  // Invoices summary
  const { data: invoices } = await supabaseAdmin
    .from('invoices')
    .select('status, total, amount_paid, balance')
    .eq('entity_id', entityId)
    .is('deleted_at', null);

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

  // Disbursements summary
  const { data: disbursements } = await supabaseAdmin
    .from('disbursements')
    .select('status, amount')
    .eq('entity_id', entityId)
    .is('deleted_at', null);

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

  // Transmittals summary
  const { data: transmittals } = await supabaseAdmin
    .from('transmittals')
    .select('status')
    .eq('entity_id', entityId)
    .is('deleted_at', null);

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

  // Payments received
  const { data: payments } = await supabaseAdmin
    .from('invoice_payments')
    .select('id, amount, method, payment_date, invoice_id')
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd);

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

  const { data: payments } = await supabaseAdmin
    .from('invoice_payments')
    .select('id, amount, method, created_at')
    .gte('created_at', weekStart)
    .lte('created_at', weekEnd);

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
  getDailyReport,
  getWeeklyReport,
  getMonthlyPending,
  getAgingReport,
};
