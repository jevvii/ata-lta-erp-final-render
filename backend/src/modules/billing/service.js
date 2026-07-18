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
const auditService = require('../../services/auditService');
const AppError = require('../../lib/AppError');

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
const listInvoices = async ({ entityId, filters = {} }) => {
  const { status, clientId, search, page = 1, limit = 50 } = filters;

  let query = supabaseAdmin
    .from('invoices')
    .select('*, clients!inner(name)', { count: 'exact' })
    .eq('entity_id', entityId)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status);
  if (clientId) query = query.eq('client_id', clientId);
  if (search) {
    query = query.or(`invoice_number.ilike.%${search}%,notes.ilike.%${search}%`);
  }

  const offset = (page - 1) * limit;
  query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to fetch invoices',
    });
  }

  return { data: data || [], count: count || 0 };
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
const createInvoice = async ({ entityId, userId, data }) => {
  const subtotal = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
  const total = subtotal; // Tax removed per prototype v3 schema
  const balance = total;

  const invoiceRow = {
    invoice_number: data.invoiceNumber,
    client_id: data.clientId,
    work_request_id: data.workRequestId || null,
    entity_id: entityId,
    issue_date: data.issueDate,
    due_date: data.dueDate,
    status: data.status || 'Draft',
    subtotal,
    tax_amount: 0,
    total,
    amount_paid: 0,
    balance,
    notes: data.notes || null,
    terms: data.terms || null,
    created_by: userId,
    updated_by: userId,
  };

  const { data: invoice, error: invoiceErr } = await supabaseAdmin
    .from('invoices')
    .insert(invoiceRow)
    .select()
    .single();

  if (invoiceErr) {
    if (invoiceErr.code === '23505') {
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

  // Insert line items
  const lineItems = data.lineItems.map((item, idx) => ({
    invoice_id: invoice.id,
    description: item.description,
    amount: item.amount,
    type: item.type || 'Professional Fee',
    sort_order: idx,
  }));

  const { error: lineErr } = await supabaseAdmin
    .from('invoice_line_items')
    .insert(lineItems);

  if (lineErr) {
    // Rollback: delete the invoice if line items fail
    await supabaseAdmin.from('invoices').delete().eq('id', invoice.id);
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to create invoice line items',
    });
  }

  await auditService.log({
    action: 'invoice.create',
    table: 'invoices',
    recordId: invoice.id,
    entity: entityId,
    userId,
    details: { invoiceNumber: data.invoiceNumber, total },
  });

  return { ...invoice, line_items: lineItems };
};

/**
 * Get a single invoice with line items and payments.
 * @param {object} params
 * @param {string} params.entityId
 * @param {string} params.id
 * @returns {Promise<object>}
 */
const getInvoiceById = async ({ entityId, id }) => {
  const { data: invoice, error } = await supabaseAdmin
    .from('invoices')
    .select('*, clients(name, tin, address)')
    .eq('id', id)
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .single();

  if (error || !invoice) {
    throw new AppError({
      statusCode: 404,
      title: 'Not Found',
      detail: `Invoice ${id} not found`,
    });
  }

  // Fetch line items
  const { data: lineItems } = await supabaseAdmin
    .from('invoice_line_items')
    .select('*')
    .eq('invoice_id', id)
    .order('sort_order', { ascending: true });

  // Fetch payments
  const { data: payments } = await supabaseAdmin
    .from('invoice_payments')
    .select('*')
    .eq('invoice_id', id)
    .order('payment_date', { ascending: false });

  return { ...invoice, line_items: lineItems || [], payments: payments || [] };
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
const updateInvoice = async ({ entityId, id, userId, data }) => {
  await getInvoiceById({ entityId, id });

  const updates = {
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  if (data.clientId !== undefined) updates.client_id = data.clientId;
  if (data.workRequestId !== undefined) updates.work_request_id = data.workRequestId;
  if (data.invoiceNumber !== undefined) updates.invoice_number = data.invoiceNumber;
  if (data.issueDate !== undefined) updates.issue_date = data.issueDate;
  if (data.dueDate !== undefined) updates.due_date = data.dueDate;
  if (data.status !== undefined) updates.status = data.status;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.terms !== undefined) updates.terms = data.terms;
  if (data.archived !== undefined) updates.archived = data.archived;

  // If line items provided, recalculate totals
  if (data.lineItems) {
    const subtotal = data.lineItems.reduce((sum, item) => sum + item.amount, 0);
    updates.subtotal = subtotal;
    updates.total = subtotal;

    // Get current amount_paid to recalculate balance
    const { data: current } = await supabaseAdmin
      .from('invoices')
      .select('amount_paid')
      .eq('id', id)
      .single();

    updates.balance = subtotal - (current?.amount_paid || 0);

    // Replace line items: delete old, insert new
    await supabaseAdmin.from('invoice_line_items').delete().eq('invoice_id', id);

    const lineItems = data.lineItems.map((item, idx) => ({
      invoice_id: id,
      description: item.description,
      amount: item.amount,
      type: item.type || 'Professional Fee',
      sort_order: idx,
    }));

    await supabaseAdmin.from('invoice_line_items').insert(lineItems);
  }

  const { data: updated, error } = await supabaseAdmin
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('entity_id', entityId)
    .select()
    .single();

  if (error) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to update invoice',
    });
  }

  return updated;
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
  await getInvoiceById({ entityId, id });

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
const recordPayment = async ({ entityId, invoiceId, userId, data }) => {
  const invoice = await getInvoiceById({ entityId, id: invoiceId });

  if (invoice.balance <= 0) {
    throw new AppError({
      statusCode: 409,
      title: 'Conflict',
      detail: 'Invoice is already fully paid',
    });
  }

  const paymentRow = {
    invoice_id: invoiceId,
    amount: data.amount,
    method: data.method,
    reference: data.reference || null,
    payment_date: data.date,
    recorded_by: userId,
    notes: data.notes || null,
  };

  const { data: payment, error: payErr } = await supabaseAdmin
    .from('invoice_payments')
    .insert(paymentRow)
    .select()
    .single();

  if (payErr) {
    throw new AppError({
      statusCode: 500,
      title: 'Database Error',
      detail: 'Failed to record payment',
    });
  }

  // Update invoice totals
  const newAmountPaid = parseFloat(invoice.amount_paid) + data.amount;
  const newBalance = parseFloat(invoice.total) - newAmountPaid;
  let newStatus = invoice.status;

  if (newBalance <= 0) {
    newStatus = 'Paid';
  } else if (newAmountPaid > 0) {
    newStatus = 'Partially Paid';
  }

  await supabaseAdmin
    .from('invoices')
    .update({
      amount_paid: newAmountPaid,
      balance: Math.max(newBalance, 0),
      status: newStatus,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq('id', invoiceId);

  await auditService.log({
    action: 'invoice.payment',
    table: 'invoice_payments',
    recordId: payment.id,
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
const generateInvoicePdf = async ({ entityId, entityCode, id }) => {
  const invoice = await getInvoiceById({ entityId, id });

  const code = entityCode || entityId;
  const html = buildInvoiceHtml(invoice, code);
  const pdfBuffer = await generatePdf({ html, options: { format: 'A4' } });

  const storagePath = `entities/${code}/invoices/${id}/pdf/${invoice.invoice_number}.pdf`;
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
const generateVoucherPdf = async ({ entityId, entityCode, id }) => {
  const invoice = await getInvoiceById({ entityId, id });

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
 * Build HTML for invoice PDF.
 * @param {object} invoice - Invoice with line_items and client
 * @param {string} entityId - Entity code
 * @returns {string} HTML string
 */
const buildInvoiceHtml = (invoice, entityId) => {
  const entityName = entityId === 'ATA'
    ? 'Amaya Tan & Associates'
    : 'LTA — Lanting Tan & Associates';

  const lineItemRows = (invoice.line_items || []).map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${item.description}</td>
      <td>${item.type}</td>
      <td style="text-align: right;">₱${Number(item.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1a365d; margin-bottom: 5px; }
    .header { border-bottom: 2px solid #1a365d; padding-bottom: 20px; margin-bottom: 20px; }
    .entity-name { font-size: 24px; font-weight: bold; color: #1a365d; }
    .invoice-title { font-size: 18px; color: #666; }
    .details { display: flex; justify-content: space-between; margin-bottom: 30px; }
    .details div { flex: 1; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
    th { background: #f0f4f8; font-weight: bold; }
    .total-row { font-weight: bold; background: #f0f4f8; }
    .footer { margin-top: 40px; font-size: 12px; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <div class="entity-name">${entityName}</div>
    <div class="invoice-title">INVOICE</div>
  </div>
  <div class="details">
    <div>
      <strong>Bill To:</strong><br>
      ${invoice.clients?.name || 'N/A'}<br>
      ${invoice.clients?.address || ''}<br>
      TIN: ${invoice.clients?.tin || 'N/A'}
    </div>
    <div style="text-align: right;">
      <strong>Invoice #:</strong> ${invoice.invoice_number}<br>
      <strong>Date:</strong> ${invoice.issue_date}<br>
      <strong>Due Date:</strong> ${invoice.due_date}<br>
      <strong>Status:</strong> ${invoice.status}
    </div>
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Description</th><th>Type</th><th style="text-align: right;">Amount</th></tr>
    </thead>
    <tbody>
      ${lineItemRows}
    </tbody>
    <tfoot>
      <tr class="total-row">
        <td colspan="3" style="text-align: right;">Total</td>
        <td style="text-align: right;">₱${Number(invoice.total).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr>
        <td colspan="3" style="text-align: right;">Amount Paid</td>
        <td style="text-align: right;">₱${Number(invoice.amount_paid).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
      </tr>
      <tr class="total-row">
        <td colspan="3" style="text-align: right;">Balance Due</td>
        <td style="text-align: right;">₱${Number(invoice.balance).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
      </tr>
    </tfoot>
  </table>
  ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
  ${invoice.terms ? `<p><strong>Terms:</strong> ${invoice.terms}</p>` : ''}
  <div class="footer">
    <p>This is a computer-generated invoice.</p>
  </div>
</body>
</html>`;
};

/**
 * Build HTML for payment voucher PDF.
 * @param {object} invoice - Invoice with payments
 * @param {string} entityId - Entity code
 * @returns {string} HTML string
 */
const buildVoucherHtml = (invoice, entityId) => {
  const entityName = entityId === 'ATA'
    ? 'Amaya Tan & Associates'
    : 'LTA — Lanting Tan & Associates';

  const paymentRows = (invoice.payments || []).map((p, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${p.payment_date}</td>
      <td>${p.method}</td>
      <td>${p.reference || '-'}</td>
      <td style="text-align: right;">₱${Number(p.amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</td>
    </tr>
  `).join('');

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
const getAgingReport = async ({ entityId }) => {
  const { data: invoices, error } = await supabaseAdmin
    .from('invoices')
    .select('*, clients(name)')
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
    current: { total: 0, invoices: [] },
    '1-30': { total: 0, invoices: [] },
    '31-60': { total: 0, invoices: [] },
    '61-90': { total: 0, invoices: [] },
    '90+': { total: 0, invoices: [] },
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
// Billing Templates
// ============================================================

/**
 * List billing templates for the entity.
 * @param {object} params
 * @param {string} params.entityId
 * @returns {Promise<object[]>}
 */
const listTemplates = async ({ entityId }) => {
  const { data, error } = await supabaseAdmin
    .from('billing_templates')
    .select('*, clients(name)')
    .eq('entity_id', entityId)
    .is('deleted_at', null)
    .eq('active', true)
    .order('name', { ascending: true });

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
    .select()
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
    .select()
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

module.exports = {
  listInvoices,
  createInvoice,
  getInvoiceById,
  updateInvoice,
  deleteInvoice,
  recordPayment,
  generateInvoicePdf,
  generateVoucherPdf,
  getAgingReport,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
