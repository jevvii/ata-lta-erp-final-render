import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRINT_PAGE_CSS, wrapPrintPage } from '@/lib/printPage';
import {
  buildStatementDocument,
  getInvoicePrintDetails,
  printStatementDocument,
  STATEMENT_CSS,
  type StatementPrintInvoice,
} from '@/lib/printDocuments';

const invoice: StatementPrintInvoice = {
  invoice_number: 'ATA-100',
  issue_date: '2026-10-19',
  total: 1500,
  clients: { name: 'Manila Trading', address: 'Manila' },
  line_items: [{ description: '<script>alert(1)</script>', amount: 1500 }],
  print_details: {
    notedBy: 'Reyes & Cruz',
    preparedBy: 'M. Santos',
    receivedBy: 'L. Tan',
    bankBranch: 'BDO Manila',
    cash: '',
    checkNumber: '1234',
  },
};
afterEach(() => vi.restoreAllMocks());
describe('Canonical statement rendering', () => {
  it.each(['ATA', 'LTA'])(
    'shows branding by default and removes name/logo when omitted (%s)',
    (entity) => {
      const branded = buildStatementDocument({ ...invoice, entity_code: entity });
      const plain = buildStatementDocument(
        { ...invoice, entity_code: entity },
        { includeCompanyDetails: false }
      );
      for (const html of [branded, plain]) {
        expect(html).not.toMatch(/Should you have any (?:enquiries|inquiries)/i);
        expect(html).toContain('THANK YOU !!!');
      }
      expect(branded).toContain(`${entity}-LOGO.jpg`);
      expect(plain).not.toContain('<img');
      expect(plain).not.toContain('BUSINESS CONSULTANCY');
      expect(plain).not.toContain('BUSINESS MANAGEMENT');
      expect(plain).toContain('STATEMENT');
      expect(plain).toContain('min-height:65px');
      expect(plain).toContain('Reyes &amp; Cruz');
      expect(plain).toContain('BDO Manila');
      expect(plain).toContain('M. Santos');
      expect(plain).toContain('L. Tan');
      expect(plain).toContain('&lt;script&gt;');
      expect(plain).not.toContain('<script>');
    }
  );
  it('preserves deliberately cleared snapshot values', () => {
    const html = buildStatementDocument({
      ...invoice,
      address: '',
      print_details: { clientName: '', notedBy: '' },
    });
    expect(html).not.toContain('Manila Trading');
    expect(html).not.toContain('HENRY WONG');
    expect(html).not.toContain('No address provided');
  });
  it('prints the same document with no browser header/footer space and padding on every page', () => {
    const write = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      document: { open: vi.fn(), write, close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    } as unknown as Window);
    vi.spyOn(window, 'setTimeout').mockImplementation(
      () => 0 as unknown as ReturnType<typeof window.setTimeout>
    );
    printStatementDocument(invoice, { includeCompanyDetails: false });
    expect(write.mock.calls[0]![0]).toContain(
      wrapPrintPage(buildStatementDocument(invoice, { includeCompanyDetails: false }))
    );
    expect(write.mock.calls[0]![0]).toContain(STATEMENT_CSS + PRINT_PAGE_CSS);
    expect(PRINT_PAGE_CSS).toContain('@page { size: A4; margin: 0; }');
    expect(PRINT_PAGE_CSS).toContain('height: 15mm');
    expect(PRINT_PAGE_CSS).toContain('padding: 0 20mm');
  });

  it('handles canonical Cash payments (amount in cash, no check ref/bank)', () => {
    const inv: StatementPrintInvoice = {
      ...invoice,
      print_details: {},
      payments: [
        {
          amount: 500,
          method: 'Cash',
          reference: 'NOT-A-CHECK',
          payment_date: '2026-10-25',
        },
      ],
    };
    const html = buildStatementDocument(inv);
    expect(html).toContain('₱500.00');
    expect(html).not.toContain('NOT-A-CHECK');
    expect(html).toContain('Oct 25, 2026');
  });

  it('handles canonical Check payments (reference in check number, no cash amount)', () => {
    const inv: StatementPrintInvoice = {
      ...invoice,
      print_details: {},
      payments: [
        {
          amount: 500,
          method: 'Check',
          reference: 'CHK-7788',
          payment_date: '2026-10-25',
        },
      ],
    };
    const html = buildStatementDocument(inv);
    expect(html).toContain('CHK-7788');
    // Cash slot is empty
    const details = getInvoicePrintDetails(inv);
    expect(details.cash).toBe('');
    expect(details.checkNumber).toBe('CHK-7788');
    expect(details.bankBranch).toBe('');
    expect(details.paymentDate).toBe('Oct 25, 2026');
  });

  it('handles canonical Bank Transfer (amount in cash, reference in check number, method in bank)', () => {
    const inv: StatementPrintInvoice = {
      ...invoice,
      print_details: {},
      payments: [
        {
          amount: 1200,
          method: 'Bank Transfer',
          reference: 'BT-9900',
          payment_date: '2026-10-25',
        },
      ],
    };
    const details = getInvoicePrintDetails(inv);
    expect(details.cash).toBe('₱1,200.00');
    expect(details.checkNumber).toBe('BT-9900');
    expect(details.bankBranch).toBe('Bank Transfer');
    expect(details.paymentDate).toBe('Oct 25, 2026');
  });

  it('prioritizes canonical non-nullish method/reference over legacy aliases', () => {
    const inv: StatementPrintInvoice = {
      ...invoice,
      print_details: {},
      payments: [
        {
          amount: 800,
          method: 'Check',
          reference: 'CHK-CANONICAL',
          payment_method: 'Cash',
          reference_number: 'REF-LEGACY',
          payment_date: '2026-10-25',
        },
      ],
    };
    const details = getInvoicePrintDetails(inv);
    expect(details.cash).toBe('');
    expect(details.checkNumber).toBe('CHK-CANONICAL');
    expect(details.bankBranch).toBe('');
  });

  it('canonical explicit empty string wins over legacy fallback and does not infer cash/ref/bank', () => {
    const inv: StatementPrintInvoice = {
      ...invoice,
      print_details: {},
      payments: [
        {
          amount: 800,
          method: '',
          reference: '',
          payment_method: 'Cash',
          reference_number: 'REF-LEGACY',
          payment_date: '2026-10-25',
        },
      ],
    };
    const details = getInvoicePrintDetails(inv);
    expect(details.cash).toBe('');
    expect(details.checkNumber).toBe('');
    expect(details.bankBranch).toBe('');
  });

  it('supports legacy payment_method and reference_number when canonical properties are absent', () => {
    const inv: StatementPrintInvoice = {
      ...invoice,
      print_details: {},
      payments: [
        {
          amount: 350,
          payment_method: 'Check',
          reference_number: 'CHK-LEGACY-ONLY',
          payment_date: '2026-10-25',
        },
      ],
    };
    const details = getInvoicePrintDetails(inv);
    expect(details.cash).toBe('');
    expect(details.checkNumber).toBe('CHK-LEGACY-ONLY');
    expect(details.bankBranch).toBe('');
  });
});
