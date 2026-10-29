// Keep document content in sync with frontend/src/lib/printDocuments.ts.
// PDF page margins differ from browser printing; pdfService disables headers/footers.
'use strict';
Object.defineProperty(exports, '__esModule', { value: true });

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatPHP(n) {
  return `₱${(Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function resolvePaymentProperties(p) {
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

function getAutomaticPaymentDetails(payment) {
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
        resolved.amount !== undefined && resolved.amount !== null
          ? formatPHP(resolved.amount)
          : '',
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
      resolved.amount !== undefined && resolved.amount !== null
        ? formatPHP(resolved.amount)
        : '',
    checkNumber: resolved.reference || '',
    bankBranch: resolved.method,
  };
}

function getInvoicePrintDetails(inv) {
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

exports.STATEMENT_CSS = void 0;
exports.esc = esc;
exports.resolvePaymentProperties = resolvePaymentProperties;
exports.getAutomaticPaymentDetails = getAutomaticPaymentDetails;
exports.getInvoicePrintDetails = getInvoicePrintDetails;
exports.buildStatementDocument = buildStatementDocument;
exports.STATEMENT_CSS = `
* { box-sizing: border-box; }
/* Use actual page margins for consistent PDF spacing on every sheet. */
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
function buildStatementDocument(inv, options = {}) {
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
  let headerHtml;
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
  const billToLines = [
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
    `<tr><td class="details-label">STATEMENT NUMBER</td><td class="details-value">${esc(inv.invoice_number || '')}</td></tr>` +
    `<tr><td class="details-label">STATEMENT DATE</td><td class="details-value">${esc(formatDate(inv.issue_date))}</td></tr>` +
    `</tbody></table></div>` +
    `</div>`;
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
  const fillRow = (label, value) =>
    `<div class="payment-details-row"><span>${label}</span><span class="fill-line" style="padding-left: 5px; font-weight: bold;">${esc(value)}</span></div>`;
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
  const sigBox = (label, name) =>
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
