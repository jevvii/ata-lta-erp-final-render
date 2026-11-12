import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceList } from '../components/InvoiceList';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { supabase } from '@/lib/supabase';
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

const mockInvoices: Invoice[] = [
  {
    id: 'inv-1',
    entity_id: 'ent-ata',
    entity_code: 'ATA',
    invoice_number: 'ATA-SI-2026-0001',
    client_id: 'c-1',
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    status: 'Draft',
    subtotal: 15000,
    total: 15000,
    amount_paid: 0,
    balance: 15000,
    address: '100 Ayala Avenue, Makati',
    notes: 'Draft retainer fees',
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    clients: {
      name: 'Acme Philippines Corp',
      tin: '123-456-789-000',
      address: '100 Ayala Avenue, Makati',
    },
    line_items: [
      {
        id: 'li-1',
        description: 'Monthly Accounting Retainer',
        amount: 15000,
        type: 'Professional Fee',
      },
    ],
  },
  {
    id: 'inv-2',
    entity_id: 'ent-ata',
    entity_code: 'ATA',
    invoice_number: 'ATA-SI-2026-0002',
    client_id: 'c-1',
    issue_date: '2026-10-05',
    due_date: '2026-11-05',
    status: 'Sent',
    subtotal: 25000,
    total: 25000,
    amount_paid: 0,
    balance: 25000,
    address: '100 Ayala Avenue, Makati',
    notes: 'Quarterly compliance invoice',
    created_at: '2026-10-05T08:00:00Z',
    updated_at: '2026-10-05T08:00:00Z',
    clients: {
      name: 'Acme Philippines Corp',
      tin: '123-456-789-000',
      address: '100 Ayala Avenue, Makati',
    },
    line_items: [
      {
        id: 'li-2',
        description: 'Quarterly Compliance Review',
        amount: 25000,
        type: 'Professional Fee',
      },
    ],
  },
  {
    id: 'inv-3',
    entity_id: 'ent-lta',
    entity_code: 'LTA',
    invoice_number: 'LTA-SI-2026-0003',
    client_id: 'c-2',
    issue_date: '2026-09-01',
    due_date: '2026-10-01',
    status: 'Partially Paid',
    subtotal: 50000,
    total: 50000,
    amount_paid: 30000,
    balance: 20000,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-15T08:00:00Z',
    clients: {
      name: 'Beta Holdings Inc',
      tin: '987-654-321-000',
      address: '456 BGC High Street, Taguig',
    },
    line_items: [
      {
        id: 'li-3',
        description: 'Corporate Restructuring Advisory',
        amount: 50000,
        type: 'Professional Fee',
      },
    ],
    payments: [
      {
        id: 'pay-1',
        invoice_id: 'inv-3',
        amount: 30000,
        payment_method: 'Bank Transfer',
        payment_date: '2026-09-15',
      },
    ],
  },
  {
    id: 'inv-4',
    entity_id: 'ent-ata',
    entity_code: 'ATA',
    invoice_number: 'ATA-SI-2026-0004',
    client_id: 'c-2',
    issue_date: '2026-08-01',
    due_date: '2026-08-31',
    status: 'Overdue',
    subtotal: 10000,
    total: 10000,
    amount_paid: 0,
    balance: 10000,
    created_at: '2026-08-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    clients: {
      name: 'Beta Holdings Inc',
      tin: '987-654-321-000',
      address: '456 BGC High Street, Taguig',
    },
    line_items: [
      {
        id: 'li-4',
        description: 'Late Penalty Assessment',
        amount: 10000,
        type: 'Government Fee',
      },
    ],
  },
];

const mockClients = [
  { id: 'c-1', name: 'Acme Philippines Corp', entity: 'ATA' as const, status: 'Active' },
  { id: 'c-2', name: 'Beta Holdings Inc', entity: 'LTA' as const, status: 'Active' },
];

describe('InvoiceList Component', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'billing:view',
        'billing:edit',
        'billing:payments',
        'billing:edit_client_address',
        'billing:delete',
      ],
      activeEntity: 'ALL',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockClients }),
        } as Response);
      }

      if (u.includes('/invoices')) {
        let filtered = [...mockInvoices];

        if (u.includes('status=Draft')) {
          filtered = filtered.filter((i) => i.status === 'Draft');
        } else if (u.includes('status=Sent')) {
          filtered = filtered.filter((i) => i.status === 'Sent');
        } else if (u.includes('status=Partially+Paid') || u.includes('status=Partially%20Paid')) {
          filtered = filtered.filter((i) => i.status === 'Partially Paid');
        } else if (u.includes('status=Overdue')) {
          filtered = filtered.filter((i) => i.status === 'Overdue');
        }

        if (u.includes('search=ATA-SI-2026-0001')) {
          filtered = filtered.filter((i) => i.invoice_number.includes('0001'));
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: filtered,
            meta: { total: filtered.length, page: 1, limit: 25 },
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('filters relative due dates across all authorized rows before displaying a page', async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    const { wrapper } = createHarness();
    render(<InvoiceList />, { wrapper });
    await screen.findByTestId('due-date-filter-select');
    fireEvent.click(screen.getByTestId('due-date-filter-select'));
    fireEvent.click(await screen.findByRole('option', { name: 'No Due Date' }));
    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/invoices?'));
      expect(calls.some((url) => url.includes('limit=all') && !url.includes('dueDate='))).toBe(true);
    });
  });

  it('renders invoice list with stats bar and correct calculated totals', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceList />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('ATA-SI-2026-0001')).toBeInTheDocument();
    });

    // Verify stats bar metrics
    expect(screen.getByTestId('stat-total-invoices')).toHaveTextContent('4');
    expect(screen.getByTestId('stat-total-value')).toHaveTextContent('₱100,000.00');
    expect(screen.getByTestId('stat-outstanding-balance')).toHaveTextContent('₱70,000.00');
    expect(screen.getByTestId('stat-overdue-count')).toHaveTextContent('1');

    // Verify rows rendered
    expect(screen.getByText('ATA-SI-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('ATA-SI-2026-0002')).toBeInTheDocument();
    expect(screen.getByText('LTA-SI-2026-0003')).toBeInTheDocument();
    expect(screen.getByText('ATA-SI-2026-0004')).toBeInTheDocument();
  });

  it('switches between Table view and Card view', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceList />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('ATA-SI-2026-0001')).toBeInTheDocument();
    });

    // Default is Table view
    expect(screen.getByTestId('invoice-row-inv-1')).toBeInTheDocument();

    // Click Card view mode button
    const cardViewBtn = screen.getByTestId('view-mode-cards');
    fireEvent.click(cardViewBtn);

    // Card view should be visible
    expect(screen.getByTestId('invoice-cards')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-card-inv-1')).toBeInTheDocument();

    // Click Table view mode button
    const tableViewBtn = screen.getByTestId('view-mode-table');
    fireEvent.click(tableViewBtn);
    expect(screen.getByTestId('invoice-row-inv-1')).toBeInTheDocument();
  });

  it('filters invoices when clicking status tabs', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceList />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('ATA-SI-2026-0001')).toBeInTheDocument();
    });

    // Click 'Draft' status tab
    const draftTab = screen.getByTestId('tab-draft');
    fireEvent.click(draftTab);

    await waitFor(() => {
      expect(screen.getByText('ATA-SI-2026-0001')).toBeInTheDocument();
      expect(screen.queryByText('ATA-SI-2026-0002')).not.toBeInTheDocument();
    });
  });

  it('triggers onSelectInvoice when a row is clicked', async () => {
    const onSelectInvoice = vi.fn();
    const { wrapper } = createHarness();
    render(<InvoiceList onSelectInvoice={onSelectInvoice} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('invoice-row-inv-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('invoice-row-inv-1'));
    expect(onSelectInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1', invoice_number: 'ATA-SI-2026-0001' })
    );
  });

  it('triggers onPrintPreview when print button on row is clicked', async () => {
    const onPrintPreview = vi.fn();
    const { wrapper } = createHarness();
    render(<InvoiceList onPrintPreview={onPrintPreview} />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('btn-print-preview-inv-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-print-preview-inv-1'));
    expect(onPrintPreview).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-1' })
    );
  });

  it('triggers onRecordPayment when record payment button on row is clicked', async () => {
    const onRecordPayment = vi.fn();
    const { wrapper } = createHarness();
    render(<InvoiceList onRecordPayment={onRecordPayment} />, { wrapper });

    // inv-2 is 'Sent' with balance > 0, so record payment button is visible
    await waitFor(() => {
      expect(screen.getByTestId('btn-record-payment-inv-2')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-record-payment-inv-2'));
    expect(onRecordPayment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inv-2' })
    );
  });

  it('renders search input and allows resetting filters', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceList />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('invoice-search-input')).toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('invoice-search-input');
    fireEvent.change(searchInput, { target: { value: 'ATA-SI-2026-0001' } });

    await waitFor(() => {
      expect(screen.getByTestId('clear-filters-button')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('clear-filters-button'));
    expect(screen.queryByTestId('clear-filters-button')).not.toBeInTheDocument();
  });

  it('subscribes to realtime CDC channel for invoices', () => {
    const channelSpy = vi.spyOn(supabase, 'channel');
    const { wrapper } = createHarness();
    render(<InvoiceList />, { wrapper });

    expect(channelSpy).toHaveBeenCalledWith('cdc_invoices');
  });
});
