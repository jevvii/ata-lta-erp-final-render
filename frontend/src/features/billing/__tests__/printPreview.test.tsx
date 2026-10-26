import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { Invoice } from '../api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const mockInvoiceForPrint: Invoice = {
  id: 'inv-print-1',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-2026-0088',
  client_id: 'c-1',
  issue_date: '2026-10-15',
  due_date: '2026-11-15',
  status: 'Sent',
  subtotal: 75000,
  total: 75000,
  amount_paid: 0,
  balance: 75000,
  address: '100 Ayala Avenue, Makati City, Metro Manila',
  notes: 'Audit retainer fee',
  terms: 'Due within 30 days',
  version: 1,
  created_at: '2026-10-15T08:00:00Z',
  updated_at: '2026-10-15T08:00:00Z',
  clients: {
    name: 'Acme Corporation',
    tin: '123-456-789-000',
    address: '100 Ayala Avenue, Makati City, Metro Manila',
  },
  line_items: [
    {
      id: 'li-1',
      description: 'Annual Financial Audit Services',
      amount: 75000,
      type: 'Professional Fee',
    },
  ],
};

describe('PrintPreviewModal Component (Decoupled Print & Address Security)', () => {
  const originalFetch = global.fetch;
  const originalPrint = window.print;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    window.print = vi.fn();

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method || 'GET';

      if (u.includes('/invoices/inv-print-1') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockInvoiceForPrint }),
        } as Response);
      }

      if (u.includes('/invoices/inv-print-1') && method === 'PATCH') {
        const body = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ...mockInvoiceForPrint,
              ...body,
              version: 2,
            },
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.print = originalPrint;
    vi.clearAllMocks();
  });

  it('renders exact on-screen document layout DECOUPLED from window.print (does not auto-print on open)', async () => {
    // Set user session
    useSessionStore.getState().setSession({
      user: {
        id: 'user-acct',
        email: 'accounting@ata-lta.ph',
        name: 'Accounting Staff',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:edit_client_address'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    render(
      <PrintPreviewModal
        isOpen={true}
        onClose={vi.fn()}
        invoiceId="inv-print-1"
        initialInvoice={mockInvoiceForPrint}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('print-preview-modal')).toBeInTheDocument();
    expect(screen.getByTestId('a4-document-sheet')).toBeInTheDocument();
    expect(screen.getAllByText(/A.T.A. BUSINESS CONSULTANCY/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('ATA-SI-2026-0088').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Acme Corporation')).toBeInTheDocument();

    // Verify window.print was NOT invoked on open
    expect(window.print).not.toHaveBeenCalled();

    // Explicit click opens the prototype-verbatim print window (about:blank);
    // the modal no longer calls in-page window.print().
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const printBtn = screen.getByTestId('print-document-button');
    fireEvent.click(printBtn);
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    openSpy.mockRestore();
  });

  it('forbids unauthorized users from editing client address (displays lock indicator)', async () => {
    // Operations user lacking 'billing:edit_client_address'
    useSessionStore.getState().setSession({
      user: {
        id: 'user-ops',
        email: 'ops@ata-lta.ph',
        name: 'Operations Staff',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:request'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    render(
      <PrintPreviewModal
        isOpen={true}
        onClose={vi.fn()}
        invoiceId="inv-print-1"
        initialInvoice={mockInvoiceForPrint}
      />,
      { wrapper }
    );

    // Verify lock badge is shown
    expect(screen.getByTestId('address-locked-indicator')).toBeInTheDocument();
    // Edit button is NOT rendered
    expect(screen.queryByTestId('edit-client-address-button')).not.toBeInTheDocument();
  });

  it('allows authorized users with billing:edit_client_address to inline edit address snapshot', async () => {
    // Accounting user holding 'billing:edit_client_address'
    useSessionStore.getState().setSession({
      user: {
        id: 'user-acct',
        email: 'accounting@ata-lta.ph',
        name: 'Accounting Staff',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:edit_client_address'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    render(
      <PrintPreviewModal
        isOpen={true}
        onClose={vi.fn()}
        invoiceId="inv-print-1"
        initialInvoice={mockInvoiceForPrint}
      />,
      { wrapper }
    );

    // Edit button should be present
    const editBtn = screen.getByTestId('edit-client-address-button');
    expect(editBtn).toBeInTheDocument();

    // Click edit
    fireEvent.click(editBtn);

    // Inline editor should open
    expect(screen.getByTestId('inline-address-editor')).toBeInTheDocument();
    const addressInput = screen.getByTestId('address-input');

    // Change address
    const newAddress = 'Suite 800, 456 Corporate Center, BGC, Taguig';
    fireEvent.change(addressInput, { target: { value: newAddress } });

    // Click Save Snapshot
    const saveBtn = screen.getByTestId('save-address-button');
    fireEvent.click(saveBtn);

    // Verify API called with address only
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/invoices/inv-print-1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ address: newAddress, expectedVersion: 1 }),
        })
      );
    });

    // Verify confirmation feedback
    await waitFor(() => {
      expect(screen.getByTestId('address-update-success-banner')).toHaveTextContent(
        'Updated invoice snapshot address only. Master client record remains unchanged.'
      );
    });
  });
});

describe('Company details controls', () => {
  afterEach(() => vi.restoreAllMocks());
  it('omits branding in preview and print, and passes the same option to PDF generation', async () => {
    const originalFetch = global.fetch;
    const write = vi.fn();
    const printWindow = {
      document: { open: vi.fn(), write, close: vi.fn() },
      focus: vi.fn(),
      print: vi.fn(),
    };
    const popup = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(printWindow as unknown as Window);
    global.fetch = vi
      .fn()
      .mockImplementation(async (url) => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: String(url).includes('/pdf')
            ? { url: 'https://example.test/plain.pdf' }
            : mockInvoiceForPrint,
        }),
      }));
    try {
      const { wrapper } = createHarness();
      const { rerender } = render(
        <PrintPreviewModal isOpen onClose={vi.fn()} initialInvoice={mockInvoiceForPrint} />,
        { wrapper }
      );
      expect(screen.getByAltText('ATA Logo')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('company-details-checkbox'));
      expect(screen.queryByAltText('ATA Logo')).not.toBeInTheDocument();
      expect(screen.getByTestId('a4-document-sheet')).not.toHaveTextContent(
        'A.T.A. BUSINESS CONSULTANCY'
      );
      fireEvent.click(screen.getByTestId('print-document-button'));
      expect(write.mock.calls[0]![0]).not.toContain('<img');
      open.mockReturnValue(popup as unknown as Window);
      fireEvent.click(screen.getByTestId('download-pdf-button'));
      await waitFor(() => expect(popup.location.href).toBe('https://example.test/plain.pdf'));
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/pdf?includeCompanyDetails=false'),
        expect.anything()
      );
      rerender(
        <PrintPreviewModal isOpen={false} onClose={vi.fn()} initialInvoice={mockInvoiceForPrint} />
      );
      rerender(<PrintPreviewModal isOpen onClose={vi.fn()} initialInvoice={mockInvoiceForPrint} />);
      expect(screen.getByTestId('company-details-checkbox')).not.toBeChecked();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('suppresses print preview and PDF download on non-access query failure (HTTP 500)', async () => {
    let shouldFail = true;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/invoices/inv-preview-fail') && shouldFail) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ title: 'Server Error', detail: 'Database error' }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { ...mockInvoiceForPrint, id: 'inv-preview-fail' } }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(
      <PrintPreviewModal
        isOpen={true}
        onClose={vi.fn()}
        invoiceId="inv-preview-fail"
        initialInvoice={mockInvoiceForPrint}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('print-preview-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Unable to Load Print Preview')).toBeInTheDocument();
    expect(screen.queryByTestId('a4-document-sheet')).not.toBeInTheDocument();

    shouldFail = false;
    fireEvent.click(screen.getByTestId('print-preview-error-retry-btn'));
    await waitFor(() => {
      expect(screen.queryByTestId('print-preview-error')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('a4-document-sheet')).toBeInTheDocument();
  });
});
