import { PRINT_PAGE_CSS, wrapPrintPage } from './printPage';

/** Canonical expense report used by preview, print, and the equivalent backend PDF renderer. */
export interface DisbursementPrintDetails {
  requesterName?: string;
  referenceNumber?: string;
  submittedDate?: string;
  workRequestName?: string;
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  paymentBank?: string;
  preparedBy?: string;
  approvedBy?: string;
  releasedBy?: string;
}
export interface DisbursementDocumentData {
  id: string;
  entity_code?: string;
  entityCode?: string;
  disbursement_number?: string | null;
  disbursementNumber?: string | null;
  category: string;
  description: string;
  amount: number;
  fund_source?: string;
  fundSource?: string;
  status: string;
  notes?: string | null;
  created_at?: string;
  createdAt?: string;
  payment_date?: string | null;
  paymentDate?: string | null;
  released_at?: string | null;
  releasedAt?: string | null;
  payment_method?: string | null;
  paymentMethod?: string | null;
  payment_reference?: string | null;
  paymentReference?: string | null;
  payment_bank?: string | null;
  paymentBank?: string | null;
  employee_name?: string | null;
  employeeName?: string | null;
  requested_by_name?: string | null;
  requestedByName?: string | null;
  created_by_name?: string | null;
  createdByName?: string | null;
  approved_by_name?: string | null;
  approvedByName?: string | null;
  released_by_name?: string | null;
  releasedByName?: string | null;
  linked_work_request_name?: string | null;
  linked_work_request_order_number?: string | null;
  print_details?: DisbursementPrintDetails | null;
}
export interface DisbursementPrintOptions {
  includeCompanyDetails?: boolean;
  noLogo?: boolean;
}
const esc = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const dateOnly = (value?: string | null): string => value?.slice(0, 10) ?? '';

export function getDisbursementPrintDetails(d: DisbursementDocumentData): DisbursementPrintDetails {
  const requester =
    d.employee_name ||
    d.employeeName ||
    d.requested_by_name ||
    d.requestedByName ||
    d.created_by_name ||
    d.createdByName ||
    '';
  const paid = ['Released', 'Funded'].includes(d.status);
  return {
    requesterName: requester,
    referenceNumber: d.disbursement_number || d.disbursementNumber || d.id,
    submittedDate: dateOnly(d.created_at || d.createdAt),
    workRequestName: d.linked_work_request_name || d.linked_work_request_order_number || '',
    paymentDate: paid
      ? dateOnly(d.payment_date || d.paymentDate || d.released_at || d.releasedAt)
      : '',
    paymentMethod: paid ? d.payment_method || d.paymentMethod || '' : '',
    paymentReference: paid ? d.payment_reference || d.paymentReference || '' : '',
    paymentBank: paid ? d.payment_bank || d.paymentBank || '' : '',
    preparedBy: requester,
    approvedBy: d.approved_by_name || d.approvedByName || '',
    releasedBy: d.released_by_name || d.releasedByName || '',
    ...d.print_details,
  };
}

export function disbursementAmountInWords(amount: number): string {
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = [
    '',
    '',
    'Twenty',
    'Thirty',
    'Forty',
    'Fifty',
    'Sixty',
    'Seventy',
    'Eighty',
    'Ninety',
  ];
  const convert = (n: number): string => {
    if (n < 20) return ones[n] || '';
    if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? ' ' + ones[n % 10] : ''}`;
    if (n < 1000)
      return `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ' and ' + convert(n % 100) : ''}`;
    for (const [scale, label] of [
      [1e12, 'Trillion'],
      [1e9, 'Billion'],
      [1e6, 'Million'],
      [1e3, 'Thousand'],
    ] as const) {
      if (n >= scale)
        return `${convert(Math.floor(n / scale))} ${label}${n % scale ? ' ' + convert(n % scale) : ''}`;
    }
    return '';
  };
  const cents = Math.round((Number(amount) || 0) * 100);
  const whole = Math.floor(cents / 100);
  return `${convert(whole) || 'Zero'} Pesos${cents % 100 ? ' and ' + convert(cents % 100) + ' Centavos' : ''} Only`.toUpperCase();
}
export const DISBURSEMENT_PAGE_CSS = `@page { size: A4; margin: 15mm 20mm; }`;
export const DISBURSEMENT_DOCUMENT_CSS = `
.disbursement-document { font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.5; color: #111; background: white; }
.disbursement-document * { box-sizing: border-box; }
.disbursement-document p, .disbursement-document h1, .disbursement-document h3, .disbursement-document h4 { margin: 0; color: #111; }
.disbursement-document strong { font-weight: 700; }
.disbursement-document .voucher-header { display: flex; justify-content: space-between; align-items: center; gap: 20px; min-height: 72px; padding-bottom: 12px; margin-bottom: 24px; border-bottom: 2px solid #111; }
.disbursement-document .voucher-company { display: flex; align-items: center; gap: 12px; flex: 1; }
.disbursement-document .voucher-logo { height: 48px; max-width: 100px; object-fit: contain; }
.disbursement-document .voucher-company-name { font-size: 13pt; font-weight: 700; }
.disbursement-document .voucher-title { font-size: 20pt; font-weight: 700; line-height: 1.15; text-align: right; }
.disbursement-document .voucher-subtitle { font-size: 9pt; text-align: right; margin-top: 5px; }
.disbursement-document .voucher-meta { display: grid; grid-template-columns: 1.2fr 1fr; gap: 24px; margin-bottom: 24px; }
.disbursement-document .voucher-box { border: 1px solid #111; padding: 12px; }
.disbursement-document .voucher-label { display: block; font-size: 9pt; font-weight: 700; margin-bottom: 8px; }
.disbursement-document .voucher-field { margin-top: 5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.disbursement-document .voucher-metadata-row { display: grid; grid-template-columns: 1fr 1.2fr; gap: 8px; margin-bottom: 6px; }
.disbursement-document .voucher-metadata-row span:last-child { text-align: right; overflow-wrap: anywhere; }
.disbursement-document .voucher-items { width: 100%; border-collapse: collapse; margin-bottom: 24px; table-layout: fixed; }
.disbursement-document .voucher-items th, .disbursement-document .voucher-items td { border: 1px solid #111; padding: 9px; font-size: 9pt; text-align: left; overflow-wrap: anywhere; vertical-align: top; }
.disbursement-document .voucher-items th { background: #f5f5f5; font-weight: 700; }
.disbursement-document .voucher-items .voucher-number { text-align: right; font-variant-numeric: tabular-nums; }
.disbursement-document .voucher-totals { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
.disbursement-document .voucher-total { border: 3px double #111; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px; }
.disbursement-document .voucher-total-amount { font-size: 16pt; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.disbursement-document .voucher-payment { margin-bottom: 24px; break-inside: avoid; }
.disbursement-document .voucher-payment-fields { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap: 16px; }
.disbursement-document .voucher-fill { min-height: 22px; border-bottom: 1px dotted #888; white-space: pre-wrap; overflow-wrap: anywhere; }
.disbursement-document .voucher-notes { margin-bottom: 24px; white-space: pre-wrap; overflow-wrap: anywhere; }
.disbursement-document .voucher-signatures { display: flex; gap: 30px; margin-top: 45px; break-inside: avoid; }
.disbursement-document .voucher-signature { flex: 1; text-align: center; padding-top: 45px; min-width: 0; }
.disbursement-document .voucher-signature-name { min-height: 24px; padding-top: 6px; border-top: 1px solid #111; font-weight: 700; text-transform: uppercase; overflow-wrap: anywhere; }
.disbursement-document .voucher-signature-label { font-size: 9pt; }
.disbursement-document .voucher-meta, .disbursement-document .voucher-totals { break-inside: avoid; }
`;
export function buildDisbursementDocument(
  d: DisbursementDocumentData,
  options: DisbursementPrintOptions = {}
): string {
  const entity = (d.entity_code || d.entityCode) === 'LTA' ? 'LTA' : 'ATA';
  const company = `${entity} Accounting Services Firm`;
  const includeCompany = options.includeCompanyDetails !== false;
  const details = getDisbursementPrintDetails(d);
  const formatAmount = (n: number): string =>
    (Number(n) || 0).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  const metadata = (label: string, value?: string) =>
    `<div class="voucher-metadata-row"><span>${label}</span><span>${esc(value)}</span></div>`;
  const payment = (label: string, value?: string) =>
    `<div><span class="voucher-label">${label}</span><div class="voucher-fill">${esc(value)}</div></div>`;
  const signature = (label: string, value: string | undefined, testId: string) =>
    `<div class="voucher-signature"><div class="voucher-signature-name" data-testid="${testId}">${esc(value)}</div><span class="voucher-signature-label">${label} / Date</span></div>`;
  return `<header class="voucher-header"><div class="voucher-company">${includeCompany ? `${options.noLogo ? '' : `<img class="voucher-logo" src="/ERP_Assets/${entity}-LOGO.jpg" alt="${entity} Logo">`}<div class="voucher-company-name">${esc(company)}</div>` : ''}</div><div><h1 class="voucher-title">Expense Report</h1><p class="voucher-subtitle">Payment Voucher</p></div></header>
  <div class="voucher-meta"><section class="voucher-box" data-testid="requester-box"><h3 class="voucher-label">Employee / Requester</h3><p class="voucher-field"><strong>${esc(details.requesterName)}</strong></p><p class="voucher-field">Status: ${esc(d.status)}</p><p class="voucher-field">Fund Source: ${esc(d.fund_source || d.fundSource || 'Firm Fund')}</p></section><section class="voucher-box">${metadata('Ref No.:', details.referenceNumber)}${metadata('Date Submitted:', details.submittedDate)}${details.workRequestName ? `<div data-testid="print-work-request">${metadata('Work Request:', details.workRequestName)}</div>` : ''}</section></div>
  <table class="voucher-items" data-testid="disbursement-items-table"><colgroup><col style="width:22%"><col style="width:40%"><col style="width:18%"><col style="width:20%"></colgroup><thead><tr><th>Category</th><th>Description</th><th>Fund Source</th><th class="voucher-number">Amount</th></tr></thead><tbody><tr><td>${esc(d.category)}</td><td style="white-space:pre-wrap">${esc(d.description)}</td><td>${esc(d.fund_source || d.fundSource || 'Firm Fund')}</td><td class="voucher-number">₱${esc(formatAmount(d.amount))}</td></tr></tbody></table>
  <div class="voucher-totals"><section class="voucher-box"><span class="voucher-label">Amount in Words</span><p data-testid="amount-in-words">${esc(disbursementAmountInWords(d.amount))}</p></section><section class="voucher-total"><strong>Total Amount:</strong><div>PHP <span class="voucher-total-amount" data-testid="disbursement-total-amount">${esc(formatAmount(d.amount))}</span></div></section></div>
  <section class="voucher-box voucher-payment"><h4 class="voucher-label">Payment Details</h4><div class="voucher-payment-fields">${payment('Date:', details.paymentDate)}${payment('Method:', details.paymentMethod)}${payment('Check/Ref No.:', details.paymentReference)}${payment('Bank/Branch:', details.paymentBank)}</div></section>
  ${d.notes ? `<section class="voucher-notes"><strong>Notes:</strong><p>${esc(d.notes)}</p></section>` : ''}
  <div class="voucher-signatures" data-testid="signatures-section">${signature('Prepared By', details.preparedBy, 'sig-prepared-by')}${signature('Approved By', details.approvedBy, 'sig-approved-by')}${signature('Released By', details.releasedBy, 'sig-released-by')}</div>`;
}
export function printDisbursementDocument(
  d: DisbursementDocumentData,
  options: DisbursementPrintOptions = {}
): void {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>Expense Report ${esc(d.disbursement_number || d.id)}</title><style>${DISBURSEMENT_PAGE_CSS}${DISBURSEMENT_DOCUMENT_CSS}${PRINT_PAGE_CSS}body { margin: 0; }</style></head><body>${wrapPrintPage(`<main class="disbursement-document">${buildDisbursementDocument(d, options)}</main>`)}</body></html>`
  );
  w.document.close();
  w.focus();
  const images = Array.from(w.document.images);
  void Promise.all(images.map((img) => img.decode().catch(() => {}))).then(() => {
    w.print();
  });
}
