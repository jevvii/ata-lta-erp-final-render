import { describe, it, expect, vi, afterEach } from 'vitest';
import { PRINT_PAGE_CSS, wrapPrintPage } from '@/lib/printPage';
import {
  buildDisbursementDocument,
  disbursementAmountInWords,
  formatMmDdYyyy,
  getDisbursementPrintDetails,
  printDisbursementDocument,
  DISBURSEMENT_PAGE_CSS,
} from '@/lib/disbursementDocument';
const item = {
  id: 'd-1',
  disbursement_number: 'ATA-100',
  category: 'Transportation',
  description: 'Site visit',
  amount: 1500.5,
  fund_source: 'Firm Fund',
  status: 'Funded',
  entity_code: 'ATA',
  employee_name: 'M. Santos',
  approved_by_name: 'A. Reyes',
  released_by_name: 'R. Tan',
  linked_work_request_name: 'Manila audit',
  payment_date: '2026-10-15',
  released_at: '2026-10-19T08:00:00Z',
  payment_reference: 'CHK-123',
};
afterEach(() => vi.restoreAllMocks());
describe('Canonical expense document', () => {
  it.each(['ATA', 'LTA'])('supports branded, generic, and blank company headers (%s)', (entity) => {
    const branded = buildDisbursementDocument({ ...item, entity_code: entity });
    const generic = buildDisbursementDocument({ ...item, entity_code: entity }, { noLogo: true });
    const blank = buildDisbursementDocument(
      { ...item, entity_code: entity },
      { includeCompanyDetails: false, noLogo: true }
    );
    expect(branded).toContain(`${entity}-LOGO.jpg`);
    expect(generic).not.toContain('<img');
    expect(generic).toContain(`${entity} Accounting Services Firm`);
    expect(blank).not.toContain('<img');
    expect(blank).not.toContain('Accounting Services Firm');
    for (const html of [branded, generic, blank]) {
      expect(html).not.toContain('THANK YOU');
      expect(html).not.toContain('Official Internal Payment Authorization');
      expect(html).not.toContain('voucher-footer');
      expect(html).toContain('Expense Report');
      expect(html).toContain('M. Santos');
      expect(html).toContain('A. Reyes');
      expect(html).toContain('R. Tan');
      expect(html).toContain('1,500.50');
      expect(html).not.toContain('Amount in Words');
      expect(html).not.toContain('amount-in-words');
      expect(html).toContain('10/15/2026');
      expect(html).toContain('Manila audit');
    }
  });

  it('formats dates as mmddyyyy (MM/DD/YYYY) across print details and edge cases', () => {
    expect(formatMmDdYyyy('2026-10-25')).toBe('10/25/2026');
    expect(formatMmDdYyyy('2026-01-05T08:30:00.000Z')).toBe('01/05/2026');
    expect(formatMmDdYyyy('10/25/2026')).toBe('10/25/2026');
    expect(formatMmDdYyyy('')).toBe('');
    expect(formatMmDdYyyy(null)).toBe('');
    expect(formatMmDdYyyy(undefined)).toBe('');

    const details = getDisbursementPrintDetails({
      id: 'd-test-dates',
      category: 'Meals',
      description: 'Client lunch',
      amount: 450,
      status: 'Funded',
      created_at: '2026-10-26T04:12:00Z',
      payment_date: '2026-10-28',
    });
    expect(details.submittedDate).toBe('10/26/2026');
    expect(details.paymentDate).toBe('10/28/2026');
  });
  it('escapes notes, description, and editable names and preserves intentional blank fields', () => {
    const html = buildDisbursementDocument({
      ...item,
      description: '<script>bad</script>',
      notes: '<img src=x>',
      print_details: { preparedBy: '<svg onload=bad>', approvedBy: '', paymentReference: '' },
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;svg onload=bad&gt;');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('A. Reyes');
    expect(html).not.toContain('CHK-123');
  });
  it('does not print internal identity keys when display names are absent', () => {
    const details = getDisbursementPrintDetails({
      id: 'd-1',
      category: 'Travel',
      description: 'Travel',
      amount: 1,
      status: 'Draft',
    });
    expect(details.preparedBy).toBe('');
    expect(details.approvedBy).toBe('');
    expect(details.releasedBy).toBe('');
  });
  it.each([
    [0, 'ZERO PESOS ONLY'],
    [1.999, 'TWO PESOS ONLY'],
    [0.5, 'ZERO PESOS AND FIFTY CENTAVOS ONLY'],
    [1000000000, 'ONE BILLION PESOS ONLY'],
  ])('keeps amount words consistent with currency rounding (%s)', (value, expected) =>
    expect(disbursementAmountInWords(Number(value))).toBe(expected)
  );
  it('prints the canonical document without browser headers/footers and with page padding', async () => {
    const write = vi.fn();
    const print = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      document: { open: vi.fn(), write, close: vi.fn(), images: [] },
      focus: vi.fn(),
      print,
    } as unknown as Window);
    printDisbursementDocument(item, { noLogo: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(write.mock.calls[0]![0]).toContain(
      wrapPrintPage(
        `<main class="disbursement-document">${buildDisbursementDocument(item, { noLogo: true })}</main>`
      )
    );
    expect(write.mock.calls[0]![0]).not.toContain('Print Document');
    expect(print).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]![0]).toContain(DISBURSEMENT_PAGE_CSS);
    expect(write.mock.calls[0]![0]).toContain(PRINT_PAGE_CSS);
    expect(PRINT_PAGE_CSS).toContain('@page { size: A4; margin: 0; }');
    expect(PRINT_PAGE_CSS).toContain('height: 15mm');
    expect(PRINT_PAGE_CSS).toContain('padding: 0 20mm');
  });
});
