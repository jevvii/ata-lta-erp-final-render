/**
 * Prototype-verbatim print documents (Chromium print output parity).
 *
 * Ports the exact print HTML+CSS from erp_prototype/js/billing.js
 * (generateInvoice statement layout) and erp_prototype/js/transmittal.js
 * (openPrintLetter) into fresh about:blank windows — the same mechanism the
 * prototype uses — so the Chromium print dialog output matches the legacy
 * documents 1:1. All dynamic values are HTML-escaped.
 *
 * UAT-FIN5 / UAT-FIN8 / print parity.
 */

import { PRINT_PAGE_CSS, wrapPrintPage } from './printPage';

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatPHP = (n: number): string =>
  `₱${(Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Prototype formatDate: "Sep 28, 2026". */
const formatDate = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export function resolvePaymentProperties(
  p?: {
    amount?: number | null;
    method?: string | null;
    reference?: string | null;
    payment_method?: string | null;
    reference_number?: string | null;
    payment_date?: string | null;
  } | null
) {
  if (!p) return null;
  const method =
    p.method !== undefined && p.method !== null
      ? String(p.method)
      : p.payment_method !== undefined && p.payment_method !== null
        ? String(p.payment_method)
        : '';
  const reference =
    p.reference !== undefined && p.reference !== null
      ? String(p.reference)
      : p.reference_number !== undefined && p.reference_number !== null
        ? String(p.reference_number)
        : '';
  const payment_date = p.payment_date ? formatDate(p.payment_date) : '';
  const amount = p.amount;
  return { method, reference, payment_date, amount };
}

export function getAutomaticPaymentDetails(
  payment?: {
    amount?: number | null;
    method?: string | null;
    reference?: string | null;
    payment_method?: string | null;
    reference_number?: string | null;
    payment_date?: string | null;
  } | null
) {
  const resolved = resolvePaymentProperties(payment);
  if (!resolved || !resolved.method) {
    return {
      paymentDate: resolved?.payment_date ?? '',
      cash: '',
      checkNumber: '',
      bankBranch: '',
    };
  }
  if (resolved.method === 'Cash') {
    return {
      paymentDate: resolved.payment_date,
      cash:
        resolved.amount !== undefined && resolved.amount !== null ? formatPHP(resolved.amount) : '',
      checkNumber: '',
      bankBranch: '',
    };
  }
  if (resolved.method === 'Check') {
    return {
      paymentDate: resolved.payment_date,
      cash: '',
      checkNumber: resolved.reference || '',
      bankBranch: '',
    };
  }
  return {
    paymentDate: resolved.payment_date,
    cash:
      resolved.amount !== undefined && resolved.amount !== null ? formatPHP(resolved.amount) : '',
    checkNumber: resolved.reference || '',
    bankBranch: resolved.method,
  };
}

function openPrintWindow(title: string, css: string, bodyHtml: string): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(
    `<!doctype html><html><head><meta charset="UTF-8"><title>${esc(
      title
    )}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`
  );
  w.document.close();
  w.focus();
  window.setTimeout(() => w.print(), 300);
}

/* ------------------------------------------------------------------ */
/* Billing Statement (prototype generateInvoice, LTA/ATA variants)     */
/* ------------------------------------------------------------------ */

export interface InvoicePrintDetails {
  clientName?: string;
  clientTin?: string;
  paymentDate?: string;
  cash?: string;
  checkNumber?: string;
  bankBranch?: string;
  notedBy?: string;
  preparedBy?: string;
  receivedBy?: string;
}

export interface StatementPrintOptions {
  includeCompanyDetails?: boolean;
}

export interface StatementPrintInvoice {
  print_details?: InvoicePrintDetails | null;
  notes?: string | null;
  terms?: string | null;
  invoice_number: string;
  entity_code?: 'ATA' | 'LTA' | string;
  issue_date?: string | null;
  subtotal?: number;
  total: number;
  address?: string | null;
  clients?: {
    name?: string | null;
    tin?: string | null;
    address?: string | null;
    trade_name?: string | null;
  } | null;
  line_items?: Array<{ description?: string | null; amount: number }>;
  payments?: Array<{
    amount?: number | null;
    method?: string | null;
    reference?: string | null;
    payment_method?: string | null;
    reference_number?: string | null;
    payment_date?: string | null;
  }>;
}

/** Defaults shared by both admin editors; explicit empty strings remain empty. */
export function getInvoicePrintDetails(inv: StatementPrintInvoice): InvoicePrintDetails {
  const auto = getAutomaticPaymentDetails(inv.payments?.[0]);
  return {
    clientName: inv.clients?.name ?? '',
    clientTin: inv.clients?.tin ?? '',
    paymentDate: auto.paymentDate,
    cash: auto.cash,
    checkNumber: auto.checkNumber,
    bankBranch: auto.bankBranch,
    notedBy: 'HENRY WONG',
    preparedBy: '',
    receivedBy: '',
    ...inv.print_details,
  };
}

export const STATEMENT_CSS = `
* { box-sizing: border-box; }
@page { size: A4; margin: 15mm 20mm; }
body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #000; box-sizing: border-box; max-width: 210mm; margin: 0 auto; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

/* Generic Header Styles */
.generic-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
.generic-company-name { font-size: 15pt; font-weight: 800; color: #000; letter-spacing: 0.5px; font-family: 'Segoe UI', Arial, sans-serif; }
.generic-title { font-size: 24pt; font-weight: 800; letter-spacing: 2px; color: #000; }
.generic-header-divider { border-bottom: 2px solid #000; margin-bottom: 20px; }

/* ATA Header Styles */
.header-container-ata { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
.logo-area-ata { display: flex; align-items: center; background: linear-gradient(90deg, #e0f2fe 0%, #e0f2fe 80%, transparent 100%); padding: 6px 20px 6px 6px; border-radius: 40px 0 0 40px; width: 70%; }
.logo-oval-ata { width: 110px; height: 65px; background-color: #00A3E0; border-radius: 50% / 50%; display: flex; justify-content: center; align-items: center; overflow: hidden; margin-right: 15px; }
.logo-oval-ata img { width: 90%; height: 90%; object-fit: contain; }
.company-name-ata { font-size: 15pt; font-weight: 800; color: #002D62; letter-spacing: 0.5px; font-family: 'Arial Black', sans-serif; }
.statement-title-ata { font-size: 24pt; font-weight: 800; letter-spacing: 2px; color: #000; }
.header-divider-ata { border-bottom: 2px solid #000; margin-bottom: 20px; }

/* LTA Header Styles */
.header-container-lta { display: flex; align-items: stretch; height: 60px; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 6px; }
.logo-banner-lta { display: flex; align-items: center; background-color: #007cc0; color: white; padding: 0 15px; flex: 1; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.logo-img-lta { height: 40px; width: 40px; border-radius: 12px; background: #fff; padding: 2px; margin-right: 12px; object-fit: contain; }
.company-name-lta { font-size: 13pt; font-weight: 700; letter-spacing: 0.5px; }
.slanted-block-lta { background-color: #1e293b; color: white; display: flex; align-items: center; padding: 0 20px 0 30px; font-size: 13pt; font-weight: 700; clip-path: polygon(15px 0, 100% 0, 100% 100%, 0 100%); margin-left: -15px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.right-statement-lta { display: flex; align-items: center; padding: 0 15px; font-size: 20pt; font-weight: 800; color: #000; }

/* Common Layout */
.two-col { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.col-bill-to { border: 1.5px solid #000; padding: 10px; width: 55%; }
.bill-to-title { font-size: 10pt; font-weight: 700; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 6px; text-transform: uppercase; }
.bill-to-content { font-size: 10pt; line-height: 1.4; }
.bill-to-content p { margin: 2px 0; }
.col-details { width: 40%; display: flex; align-items: flex-start; justify-content: flex-end; }
.details-table { border-collapse: collapse; border: 1.5px solid #000; width: 100%; }
.details-table td { border: 1px solid #000; padding: 6px 10px; font-size: 9pt; }
.details-label { font-weight: 700; background-color: #f8fafc; width: 55%; }
.details-value { text-align: right; font-family: monospace; font-size: 10pt; }

/* Items Table */
.items-table { width: 100%; border-collapse: collapse; margin: 20px 0; border: 1.5px solid #000; }
.items-table th { border: 1px solid #000; padding: 8px; background-color: #f8fafc; font-weight: 700; font-size: 9pt; text-align: left; text-transform: uppercase; }
.items-table td { border: 1px solid #000; padding: 8px; font-size: 10pt; }
.items-table .num { text-align: right; font-family: monospace; }

/* Bottom Layout */
.bottom-container { display: flex; justify-content: space-between; margin-top: 20px; align-items: flex-start; }
.payment-details-box { border: 1.5px solid #000; padding: 10px; width: 45%; font-size: 9pt; }
.payment-details-title { font-weight: 700; margin-bottom: 8px; }
.payment-details-row { display: flex; margin-bottom: 6px; align-items: baseline; }
.payment-details-row span:first-child { margin-right: 5px; white-space: nowrap; }
.fill-line { flex-grow: 1; border-bottom: 1px dotted #000; min-height: 12px; margin-right: 15px; padding-bottom: 1px; }
.total-box-container { width: 50%; display: flex; justify-content: flex-end; }
.total-table { border-collapse: collapse; border: 2px double #000; width: 100%; }
.total-table td { padding: 10px; font-size: 11pt; font-weight: 700; border: 1px solid #000; }
.total-label { background-color: #f8fafc; width: 50%; }
.total-currency { text-align: center; width: 15%; }
.total-value { text-align: right; width: 35%; font-family: monospace; font-size: 12pt; }

/* Signatures */
.signature-row { display: flex; justify-content: space-between; margin-top: 40px; gap: 20px; }
.signature-box { width: 30%; display: flex; flex-direction: column; }
.signature-label { font-size: 10pt; font-weight: 700; margin-bottom: 40px; }
.signature-line-container { border-top: 1.5px solid #000; padding-top: 4px; text-align: center; }
.signature-name-printed { font-size: 9pt; font-weight: 700; text-transform: uppercase; }

/* Footer */
.footer-container { margin-top: 30px; text-align: center; }
.thank-you { font-size: 11pt; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
.footer-text { font-size: 9pt; font-weight: bold; }

.vat-breakdown { background: #f8fafc; padding: 12px; border-radius: 12px; margin-top: 12px; font-size: 9pt; border: 1px solid #cbd5e1; }
.vat-breakdown p { margin: 2px 0; }
`;

export function buildStatementDocument(
  inv: StatementPrintInvoice,
  options: StatementPrintOptions = {}
): string {
  const includeCompanyDetails = options.includeCompanyDetails !== false;
  const details = inv.print_details || {};
  const entity = inv.entity_code === 'LTA' ? 'LTA' : 'ATA';
  const companyName =
    entity === 'ATA' ? 'A.T.A. BUSINESS CONSULTANCY' : 'LTA BUSINESS MANAGEMENT CORP';

  const auto = getAutomaticPaymentDetails(inv.payments?.[0]);
  const dateVal = details.paymentDate ?? auto.paymentDate;
  const cashVal = details.cash ?? auto.cash;
  const checkVal = details.checkNumber ?? auto.checkNumber;
  const bankVal = details.bankBranch ?? auto.bankBranch;

  /* Keep the header's space for preprinted stationery. */
  let headerHtml: string;
  if (!includeCompanyDetails) {
    headerHtml =
      '<div class="generic-header" style="min-height:65px"><div></div><div class="generic-title">STATEMENT</div></div><div class="generic-header-divider"></div>';
  } else if (entity === 'ATA') {
    headerHtml =
      `<div class="header-container-ata">` +
      `<div style="display: flex; align-items: center;">` +
      `<img src="/ERP_Assets/ATA-LOGO.jpg" alt="ATA Logo" style="height: 65px; object-fit: contain; margin-right: 12px;" onerror="this.style.display='none'">` +
      `<span class="company-name-ata">${esc(companyName)}</span>` +
      `</div>` +
      `<div class="statement-title-ata">STATEMENT</div>` +
      `</div>` +
      `<div class="header-divider-ata"></div>`;
  } else {
    headerHtml =
      `<div class="header-container-lta">` +
      `<div class="logo-banner-lta">` +
      `<img src="/ERP_Assets/LTA-LOGO.jpg" class="logo-img-lta" alt="LTA Logo" onerror="this.style.display='none'">` +
      `<span class="company-name-lta">${esc(companyName)}</span>` +
      `</div>` +
      `<div class="slanted-block-lta">STATEMENT</div>` +
      `</div>`;
  }

  /* Bill To */
  const billToLines: string[] = [
    `<p><strong>${esc(details.clientName ?? inv.clients?.name ?? '—')}</strong></p>`,
  ];
  if (inv.clients?.trade_name) billToLines.push(`<p>(${esc(inv.clients.trade_name)})</p>`);
  billToLines.push(
    `<p data-testid="client-address-display">${esc(inv.address ?? inv.clients?.address ?? 'No address provided')}</p>`
  );
  if (details.clientTin ?? inv.clients?.tin)
    billToLines.push(`<p>TIN: ${esc(details.clientTin ?? inv.clients?.tin)}</p>`);

  const twoColHtml =
    `<div class="two-col">` +
    `<div class="col-bill-to" data-testid="bill-to-box">` +
    `<div class="bill-to-title">${entity === 'ATA' ? 'BILL TO' : 'BILL TO:'}</div>` +
    `<div class="bill-to-content">${billToLines.join('')}</div>` +
    `</div>` +
    `<div class="col-details"><table class="details-table"><tbody>` +
    `<tr><td class="details-label">STATEMENT NUMBER</td><td class="details-value">${esc(
      inv.invoice_number || ''
    )}</td></tr>` +
    `<tr><td class="details-label">STATEMENT DATE</td><td class="details-value">${esc(
      formatDate(inv.issue_date)
    )}</td></tr>` +
    `</tbody></table></div>` +
    `</div>`;

  /* Items table — generic/ATA layout 3 cols, LTA layout 4 cols (blank 10% spacer) */
  const isGenericLayout = !includeCompanyDetails || entity === 'ATA';
  const theadHtml = isGenericLayout
    ? `<tr><th style="width: 15%;">DATE</th><th style="width: 65%;">DESCRIPTION</th><th style="width: 20%; text-align: right;">AMOUNT DUE</th></tr>`
    : `<tr><th style="width: 15%;">DATE</th><th style="width: 55%;">DESCRIPTION</th><th style="width: 10%;"></th><th style="width: 20%; text-align: right;">AMOUNT DUE</th></tr>`;

  let tbodyHtml = isGenericLayout
    ? `<tr><td></td><td style="font-weight: bold; text-align: right;">BALANCE FORWARD:</td><td></td></tr>`
    : `<tr><td></td><td style="font-weight: bold; text-align: right;">BALANCE FORWARD:</td><td></td><td></td></tr>`;

  (inv.line_items || []).forEach((li, idx) => {
    const dateStr = idx === 0 ? formatDate(inv.issue_date) : '';
    const descStr = li.description || '—';
    const amountCell = `<td class="num">${esc(formatPHP(li.amount))}</td>`;
    tbodyHtml += isGenericLayout
      ? `<tr><td>${esc(dateStr)}</td><td>${esc(descStr)}</td>${amountCell}</tr>`
      : `<tr><td>${esc(dateStr)}</td><td>${esc(descStr)}</td><td></td>${amountCell}</tr>`;
  });

  const itemsTableHtml = `<table class="items-table" data-testid="line-items-table"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>`;

  /* Bottom: payment details + totals */
  const fillRow = (label: string, value: string) =>
    `<div class="payment-details-row"><span>${label}</span><span class="fill-line" style="padding-left: 5px; font-weight: bold;">${esc(
      value
    )}</span></div>`;

  const bottomHtml =
    `<div class="bottom-container">` +
    `<div class="payment-details-box">` +
    `<div class="payment-details-title">PAYMENT DETAILS:</div>` +
    fillRow('DATE:', dateVal) +
    fillRow('CASH:', cashVal) +
    fillRow('DATE/CHECK NO.:', checkVal) +
    fillRow('BANK/BRANCH:', bankVal) +
    `</div>` +
    `<div class="total-box-container" style="width: 50%;">` +
    `<table class="total-table"><tbody><tr>` +
    `<td class="total-label">TOTAL AMOUNT DUE</td>` +
    `<td class="total-currency">PHP</td>` +
    `<td class="total-value" data-testid="invoice-total">${esc(formatPHP(inv.total).replace('₱', '').trim())}</td>` +
    `</tr></tbody></table>` +
    `</div>` +
    `</div>`;

  /* VAT breakdown (prototype: shown when inv.vat > 0; v2 derives vat = total - subtotal) */
  const subtotal = inv.subtotal ?? inv.total;
  const vatAmount = Math.round((inv.total - subtotal) * 100) / 100;
  const vatHtml =
    vatAmount > 0
      ? `<div class="vat-breakdown">` +
        `<p><strong>VAT Breakdown</strong></p>` +
        `<p>VATable Sales: ${esc(formatPHP(subtotal))}</p>` +
        `<p>VAT Amount (12%): ${esc(formatPHP(vatAmount))}</p>` +
        `<p>Total Amount Due: ${esc(formatPHP(inv.total))}</p>` +
        `</div>`
      : '';

  const sigBox = (label: string, name: string) =>
    `<div class="signature-box"><div class="signature-label">${label}</div>` +
    `<div class="signature-line-container"><div class="signature-name-printed">${name ? esc(name) : '&nbsp;'}</div></div></div>`;

  const signaturesHtml =
    `<div class="signature-row">` +
    sigBox('Noted by:', details.notedBy ?? 'HENRY WONG') +
    sigBox('Prepared by:', details.preparedBy ?? '') +
    sigBox('Received by:', details.receivedBy ?? '') +
    `</div>`;

  const footerHtml =
    `<div class="footer-container"><div class="thank-you">THANK YOU !!!</div>` +
    (!includeCompanyDetails || entity === 'ATA'
      ? `<div class="footer-text">customer's copy</div>`
      : '') +
    `</div>`;

  const notesHtml = inv.notes
    ? `<p style="white-space:pre-wrap"><strong>Notes:</strong> ${esc(inv.notes)}</p>`
    : '';
  const termsHtml = inv.terms
    ? `<p style="white-space:pre-wrap"><strong>Terms:</strong> ${esc(inv.terms)}</p>`
    : '';
  return (
    headerHtml +
    twoColHtml +
    itemsTableHtml +
    bottomHtml +
    vatHtml +
    notesHtml +
    termsHtml +
    signaturesHtml +
    footerHtml
  );
}

export function printStatementDocument(
  inv: StatementPrintInvoice,
  options: StatementPrintOptions = {}
): void {
  openPrintWindow(
    `Statement ${inv.invoice_number || ''}`,
    STATEMENT_CSS + PRINT_PAGE_CSS,
    wrapPrintPage(buildStatementDocument(inv, options))
  );
}

/* ------------------------------------------------------------------ */
/* Transmittal Letter (prototype openPrintLetter, company details on)  */
/* ------------------------------------------------------------------ */

export interface TransmittalPrintData {
  tracking_number?: string | null;
  entity_code?: 'ATA' | 'LTA' | string;
  sent_at?: string | null;
  created_at?: string | null;
  status?: string | null;
  acknowledged_at?: string | null;
  received_by_name?: string | null;
  recipient_name?: string | null;
  recipient_details?: string | null;
  notes?: string | null;
  clients?: { name?: string | null; address?: string | null } | null;
  items?: Array<{
    id?: string;
    document_type?: string | null;
    documentType?: string | null;
    description?: string | null;
    quantity?: number;
  }>;
}

export interface TransmittalPrintOptions {
  includeCompanyDetails?: boolean;
  companyName?: string;
  companyAddress?: string;
}

export function defaultTransmittalCompany(entity?: string) {
  return {
    includeCompanyDetails: true,
    companyName: `${entity === 'LTA' ? 'LTA' : 'ATA'} BUSINESS CONSULTANCY SERVICES`,
    companyAddress:
      'RM 307 Republic Supermarket Bldg,\nSoler St., cor. F.Torres St.,\nSta. Cruz, Manila',
  };
}

/** Ignore blank draft rows; never pad or truncate the document manifest. */
export function printableTransmittalItems<T extends { description?: string | null }>(
  items?: T[]
): T[] {
  return (items || []).filter((item) => Boolean(item.description?.trim()));
}

const TRANSMITTAL_CSS = `
@page { size: letter; margin: 0; }
body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; color: #000; background-color: #fff; font-size: 10pt; line-height: 1.35; }
@media print { body { padding-top: 8mm; box-sizing: border-box; } }
.container { width: 100%; max-width: 680px; margin: 0 auto; position: relative; }
.header-table { width: 100%; border: 2px solid #000; border-collapse: collapse; margin-bottom: 15px; table-layout: fixed; }
.header-table td { border: 2px solid #000; padding: 6px 10px; vertical-align: top; word-break: break-word; word-break: break-all; overflow-wrap: anywhere; box-sizing: border-box; }
.title-cell { text-align: center; font-weight: bold; font-size: 12pt; letter-spacing: 0.5px; padding: 8px !important; word-break: break-word; overflow-wrap: anywhere; }
.doc-no-cell { width: 55%; word-break: break-word; word-break: break-all; overflow-wrap: anywhere; }
.date-cell { width: 45%; word-break: break-word; word-break: break-all; overflow-wrap: anywhere; }
.label-red { color: #c2272d; font-weight: bold; margin-right: 5px; }
.label-bold { font-weight: bold; margin-right: 5px; }
.value-bold { font-weight: bold; }
.from-cell { width: 55%; line-height: 1.4; word-break: break-word; word-break: break-all; overflow-wrap: anywhere; box-sizing: border-box; }
.to-cell { width: 45%; line-height: 1.4; word-break: break-word; word-break: break-all; overflow-wrap: anywhere; box-sizing: border-box; }
.underline-line { border-bottom: 1.5px solid #000; min-height: 16px; margin-top: 3px; padding-bottom: 1px; font-weight: bold; word-break: break-word; word-break: break-all; overflow-wrap: anywhere; }
.document-box { border: 2px solid #000; position: relative; margin-bottom: 15px; width: 100%; box-sizing: border-box; }
.document-title { font-weight: bold; padding: 6px 10px; border-bottom: 2px solid #000; background-color: #fff; font-size: 10pt; }
.document-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.table-header-cell { border-bottom: 2px solid #000; padding: 6px 10px; font-weight: bold; text-align: left; font-size: 10pt; }
.category-header-cell { width: 35%; border-right: 2px solid #000; }
.document-header-cell { width: 65%; }
.doc-row { break-inside: avoid; page-break-inside: avoid; }
.document-table thead { display: table-header-group; }
.signature-container { break-inside: avoid; }
.doc-cell { border-bottom: 1px solid #000; padding: 4px 10px; font-size: 10pt; text-align: left; word-break: break-word; overflow-wrap: anywhere; }
.category-cell { font-weight: bold; border-right: 1px solid #000; width: 35%; }
.document-cell { width: 65%; }
.document-table tr:last-child .doc-cell { border-bottom: none; }
.received-stamp { position: absolute; right: 12%; top: 50%; transform: translateY(-50%) rotate(-7deg); border: 4px double #1e40af; color: #1e40af; padding: 6px 12px; text-align: center; background: rgba(255, 255, 255, 0.95); border-radius: 12px; font-family: 'Courier New', Courier, monospace; font-weight: bold; pointer-events: none; z-index: 100; }
.stamp-title { font-size: 14pt; letter-spacing: 2px; border-bottom: 2px solid #1e40af; margin-bottom: 4px; padding-bottom: 1px; }
.stamp-date { font-size: 11pt; letter-spacing: 1px; }
.signature-container { margin-top: 30px; width: 100%; max-width: 400px; margin-left: auto; margin-right: auto; text-align: center; }
.sig-info { display: flex; justify-content: space-between; padding: 0 20px; font-weight: bold; font-size: 11pt; min-height: 20px; }
.sig-name { flex: 2; text-align: center; }
.sig-date { flex: 1; text-align: right; }
.sig-line { border-top: 1.5px solid #000; margin-top: 2px; }
.sig-label { font-size: 9pt; color: #333; margin-top: 6px; }
`;

export function printTransmittalDocument(
  t: TransmittalPrintData,
  options: TransmittalPrintOptions = {}
): void {
  const entity = t.entity_code === 'LTA' ? 'LTA' : 'ATA';
  const isATA = entity === 'ATA';

  const company = { ...defaultTransmittalCompany(entity), ...options };
  const companyName = company.companyName;
  const companyAddressLines = company.companyAddress
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  /* Entity-aware date: ATA uppercase long form, LTA M/D/YYYY */
  const dateObj = new Date(t.sent_at || t.created_at || new Date());
  const formattedDate = isATA
    ? dateObj
        .toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        .toUpperCase()
    : `${dateObj.getMonth() + 1}/${dateObj.getDate()}/${dateObj.getFullYear()}`;

  /* TO block: POC over client name; address split at first comma */
  const clientName = t.clients?.name || '';
  const pocName = t.recipient_name || '';
  const toLine1 = pocName || clientName || '';
  let toLine2 = '';
  if (pocName && clientName) {
    toLine2 = isATA ? `(${clientName})` : clientName;
  }
  const address = t.clients?.address || '';
  let toLine3 = '';
  let toLine4 = '';
  if (address) {
    const firstComma = address.indexOf(',');
    if (firstComma !== -1) {
      toLine3 = address.substring(0, firstComma).trim();
      toLine4 = address.substring(firstComma + 1).trim();
    } else {
      toLine3 = address;
    }
  }

  /* Signature / stamp from acknowledgment */
  let sigName = '';
  let sigDate = '';
  if (t.status === 'Acknowledged' && t.acknowledged_at) {
    const stampDateObj = new Date(t.acknowledged_at);
    if (t.received_by_name) {
      sigName = t.received_by_name.toUpperCase();
      sigDate = `${stampDateObj.getMonth() + 1}/${stampDateObj.getDate()}/${String(
        stampDateObj.getFullYear()
      ).slice(-2)}`;
    }
  }

  const rows = printableTransmittalItems(t.items).map((item) => ({
    category: (item.document_type || item.documentType || 'Others').toUpperCase(),
    document:
      (item.description || '').toUpperCase() +
      (item.quantity && item.quantity > 1 ? ` (QTY: ${item.quantity})` : ''),
  }));

  const rowsHtml = rows
    .map(
      (r) =>
        `<tr class="doc-row">` +
        `<td class="doc-cell category-cell">${r.category ? esc(r.category) : '&nbsp;'}</td>` +
        `<td class="doc-cell document-cell">${r.document ? esc(r.document) : '&nbsp;'}</td>` +
        `</tr>`
    )
    .join('');

  const bodyHtml =
    `<div class="container">` +
    `<table class="header-table">` +
    `<colgroup><col style="width: 55%;"><col style="width: 45%;"></colgroup>` +
    `<tr><td colspan="2" class="title-cell">DOCUMENT TRANSMITTAL FORM</td></tr>` +
    `<tr>` +
    `<td class="doc-no-cell"><span class="label-red">TRANSMITTAL DOC NO.:</span> <span class="value-bold">${esc(
      t.tracking_number || ''
    )}</span></td>` +
    `<td class="date-cell"><span class="label-bold">DATE:</span> <span class="value-bold">${esc(
      formattedDate
    )}</span></td>` +
    `</tr>` +
    `<tr>` +
    (company.includeCompanyDetails
      ? `<td class="from-cell"><strong>FROM:</strong> <strong>${esc(companyName)}</strong>` +
        companyAddressLines.map((l) => `<br>${esc(l)}`).join('') +
        `</td>`
      : '') +
    `<td class="to-cell"${company.includeCompanyDetails ? '' : ' colspan="2" style="width:100%"'}>` +
    `<div style="display: flex; gap: 8px; align-items: flex-start;">` +
    `<strong style="margin-top: 3px;">TO:</strong>` +
    `<div style="flex: 1; display: flex; flex-direction: column;">` +
    `<div class="underline-line">${toLine1 ? esc(toLine1) : ''}</div>` +
    `<div class="underline-line">${toLine2 ? esc(toLine2) : ''}</div>` +
    `<div class="underline-line">${toLine3 ? esc(toLine3) : ''}</div>` +
    `<div class="underline-line">${toLine4 ? esc(toLine4) : ''}</div>` +
    (t.recipient_details?.trim()
      ? `<div style="white-space:pre-line;margin-top:4px">${esc(t.recipient_details)}</div>`
      : '') +
    `</div></div>` +
    `</td>` +
    `</tr>` +
    `</table>` +
    `<div class="document-box">` +
    `<div class="document-title">Received the following documents and/or records:</div>` +
    `<table class="document-table">` +
    `<colgroup><col style="width: 35%;"><col style="width: 65%;"></colgroup>` +
    `<thead><tr class="header-row">` +
    `<th class="table-header-cell category-header-cell">CATEGORY</th>` +
    `<th class="table-header-cell document-header-cell">DOCUMENT</th>` +
    `</tr></thead>` +
    `<tbody>${rowsHtml}</tbody>` +
    `</table>` +
    `</div>` +
    (t.notes
      ? `<div style="margin: 10px 0; font-style: italic; font-size: 9.5pt; color: #555;">Notes: ${esc(
          t.notes
        )}</div>`
      : '') +
    `<div class="signature-container">` +
    `<div class="sig-info"><span class="sig-name">${esc(sigName)}</span><span class="sig-date">${esc(
      sigDate
    )}</span></div>` +
    `<div class="sig-line"></div>` +
    `<div class="sig-label">Signature over Printed name / Date Received</div>` +
    `</div>` +
    `</div>`;

  openPrintWindow(`Transmittal — ${t.tracking_number || ''}`, TRANSMITTAL_CSS, bodyHtml);
}
