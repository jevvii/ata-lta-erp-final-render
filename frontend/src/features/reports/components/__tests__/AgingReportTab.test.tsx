import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgingReportTab } from '../AgingReportTab';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(),
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { wrapper, queryClient };
}

const mockAgingData = {
  summary: {
    current: 50000,
    '1-30': 30000,
    '31-60': 20000,
    '61-90': 15000,
    '90+': 10000,
    grandTotal: 125000,
  },
  buckets: {
    current: {
      total: 50000,
      count: 1,
      invoices: [
        {
          id: 'inv-curr-1',
          invoiceNumber: 'INV-2026-001',
          clientName: 'Acme Logistics',
          dueDate: '2026-10-30',
          total: 50000,
          balance: 50000,
          daysOverdue: 0,
        },
      ],
    },
    '1-30': {
      total: 30000,
      count: 1,
      invoices: [
        {
          id: 'inv-30-1',
          invoiceNumber: 'INV-2026-002',
          clientName: 'Summit Freight',
          dueDate: '2026-10-05',
          total: 30000,
          balance: 30000,
          daysOverdue: 12,
        },
      ],
    },
    '31-60': {
      total: 20000,
      count: 1,
      invoices: [
        {
          id: 'inv-60-1',
          invoiceNumber: '=CMD|calc!A0', // formula injection trigger test
          clientName: 'Pacific Imports',
          dueDate: '2026-09-10',
          total: 20000,
          balance: 20000,
          daysOverdue: 37,
        },
      ],
    },
    '61-90': {
      total: 15000,
      count: 1,
      invoices: [
        {
          id: 'inv-90-1',
          invoiceNumber: 'INV-2026-004',
          clientName: 'Metro Shipping',
          dueDate: '2026-08-05',
          total: 15000,
          balance: 15000,
          daysOverdue: 73,
        },
      ],
    },
    '90+': {
      total: 10000,
      count: 1,
      invoices: [
        {
          id: 'inv-old-1',
          invoiceNumber: 'INV-2026-005',
          clientName: 'Oceanic Global',
          dueDate: '2026-06-01',
          total: 10000,
          balance: 10000,
          daysOverdue: 138,
        },
      ],
    },
  },
};

describe('AgingReportTab Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ activeEntity: 'ATA' });
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-csv-url');
    window.URL.revokeObjectURL = vi.fn();
    window.print = vi.fn();
  });

  it('renders single headline balance summary figure and accessible bucket selection strip', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });

    const { wrapper } = createHarness();
    render(<AgingReportTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
    });

    // Headline grand total summary card
    const grandTotalCard = screen.getByTestId('kpi-grand-total');
    expect(grandTotalCard).toHaveTextContent('Outstanding balance');
    expect(grandTotalCard).toHaveTextContent('₱125,000.00');

    // Bucket selection strip buttons
    const currentBtn = screen.getByTestId('kpi-current');
    expect(currentBtn).toHaveTextContent('Current');
    expect(currentBtn).toHaveTextContent('₱50,000.00');
    expect(currentBtn).toHaveTextContent('1 invoice');
    expect(currentBtn).toHaveAttribute('aria-pressed', 'false');

    const bucket1to30 = screen.getByTestId('kpi-1-30');
    expect(bucket1to30).toHaveTextContent('1–30 Days');
    expect(bucket1to30).toHaveTextContent('₱30,000.00');
    expect(bucket1to30).toHaveTextContent('1 invoice');

    const bucket31to60 = screen.getByTestId('kpi-31-60');
    expect(bucket31to60).toHaveTextContent('31–60 Days');
    expect(bucket31to60).toHaveTextContent('₱20,000.00');

    const bucket61to90 = screen.getByTestId('kpi-61-90');
    expect(bucket61to90).toHaveTextContent('61–90 Days');
    expect(bucket61to90).toHaveTextContent('₱15,000.00');

    const bucket90Plus = screen.getByTestId('kpi-90-plus');
    expect(bucket90Plus).toHaveTextContent('90+ Days');
    expect(bucket90Plus).toHaveTextContent('₱10,000.00');

    // All button initially active
    const allBtn = screen.getByTestId('bucket-btn-all');
    expect(allBtn).toHaveAttribute('aria-pressed', 'true');

    // Table rows
    expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
    expect(screen.getByText('Summit Freight')).toBeInTheDocument();
    expect(screen.getByText('Pacific Imports')).toBeInTheDocument();
  });

  it('toggles bucket filtering and preserves server bucket keys', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });

    const { wrapper } = createHarness();
    render(<AgingReportTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
    });

    const currentBtn = screen.getByTestId('kpi-current');
    fireEvent.click(currentBtn);

    // Selected state aria-pressed is true
    expect(currentBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('bucket-btn-all')).toHaveAttribute('aria-pressed', 'false');

    // Only Current invoice visible
    expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
    expect(screen.queryByText('INV-2026-002')).not.toBeInTheDocument();

    // Filter label displays distinct filtered balance
    expect(screen.getByTestId('aging-filter-summary')).toHaveTextContent('Showing 1 of 5 invoices');
    expect(screen.getByTestId('aging-filter-summary')).toHaveTextContent('Filtered balance: ₱50,000.00');

    // Headline total remains intact
    expect(screen.getByTestId('kpi-grand-total')).toHaveTextContent('₱125,000.00');

    // Toggle 90+ bucket
    const bucket90Plus = screen.getByTestId('kpi-90-plus');
    fireEvent.click(bucket90Plus);
    expect(bucket90Plus).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('INV-2026-005')).toBeInTheDocument();
    expect(screen.queryByText('INV-2026-001')).not.toBeInTheDocument();

    // Toggle back to All
    fireEvent.click(screen.getByTestId('bucket-btn-all'));
    expect(screen.getByTestId('bucket-btn-all')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
    expect(screen.getByText('INV-2026-005')).toBeInTheDocument();
  });

  it('filters by search query without mutating headline report total', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });

    const { wrapper } = createHarness();
    render(<AgingReportTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('aging-search-input');
    fireEvent.change(searchInput, { target: { value: 'Summit' } });

    expect(screen.getByText('Summit Freight')).toBeInTheDocument();
    expect(screen.queryByText('Acme Logistics')).not.toBeInTheDocument();

    // Headline total remains ₱125,000.00
    expect(screen.getByTestId('kpi-grand-total')).toHaveTextContent('₱125,000.00');

    // Distinct summary line
    expect(screen.getByTestId('aging-filter-summary')).toHaveTextContent('Showing 1 of 5 invoices');
    expect(screen.getByTestId('aging-filter-summary')).toHaveTextContent('Filtered balance: ₱30,000.00');
  });

  it('displays "No invoices match these filters." with reset affordance when empty', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });

    const { wrapper } = createHarness();
    render(<AgingReportTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
    });

    const searchInput = screen.getByTestId('aging-search-input');
    fireEvent.change(searchInput, { target: { value: 'NonexistentClientXYZ' } });

    const emptyCard = screen.getByTestId('empty-aging-report');
    expect(emptyCard).toBeInTheDocument();
    expect(screen.getByText('No invoices match these filters.')).toBeInTheDocument();
    expect(screen.queryByText('No overdue invoices found')).not.toBeInTheDocument();

    // Clear filters button resets search and bucket
    const resetBtn = screen.getByRole('button', { name: /clear filters/i });
    fireEvent.click(resetBtn);

    expect(screen.getByText('Acme Logistics')).toBeInTheDocument();
    expect((searchInput as HTMLInputElement).value).toBe('');
  });

  it('safely generates CSV export with formula injection shielding and unified dataset', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });

    let capturedBlob: Blob | null = null;
    window.URL.createObjectURL = vi.fn().mockImplementation((blob) => {
      capturedBlob = blob;
      return 'blob:mock-aging-csv';
    });

    const { wrapper } = createHarness();
    render(<AgingReportTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
    });

    // Filter to 31–60 days which contains '=CMD|calc!A0'
    const bucket31to60 = screen.getByTestId('kpi-31-60');
    fireEvent.click(bucket31to60);

    const exportBtn = screen.getByTestId('aging-export-csv-button');
    expect(exportBtn).not.toBeDisabled();
    fireEvent.click(exportBtn);

    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);

    // Read the blob text
    if (capturedBlob) {
      const reader = new FileReader();
      const textPromise = new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string);
      });
      reader.readAsText(capturedBlob);
      const csvText = await textPromise;

      // Verify formula injection shield: '=CMD|calc!A0' prefixed with single quote
      expect(csvText).toContain("\"'=CMD|calc!A0\"");
      expect(csvText).toContain('"Pacific Imports"');
      // Verify other buckets not included in filtered export
      expect(csvText).not.toContain('Acme Logistics');
    }
  });

  it('renders clean printable report context and print styling', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });

    const { wrapper } = createHarness();
    const { container } = render(<AgingReportTab />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
    });

    // Print button triggers window.print
    const printBtn = screen.getByTestId('aging-print-button');
    fireEvent.click(printBtn);
    expect(window.print).toHaveBeenCalledTimes(1);

    // Printable report context header
    expect(screen.getByText('AR Aging Report')).toBeInTheDocument();
    expect(screen.getByText('Operating Entity:')).toBeInTheDocument();
    expect(screen.getByText('As of Date:')).toBeInTheDocument();

    // Verify style tag contains print rules
    const styleTags = container.querySelectorAll('style');
    const printStyles = Array.from(styleTags).map((s) => s.textContent).join('\n');
    expect(printStyles).toContain('table-header-group');
    expect(printStyles).toContain('break-inside: avoid');
  });

  it('renders ReportScopePrompt when activeEntity is ALL and suppresses backend queries', async () => {
    useSessionStore.setState({ activeEntity: 'ALL' });

    const { wrapper } = createHarness();
    render(<AgingReportTab />, { wrapper });

    expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
    expect(screen.getByText('Choose ATA or LTA to view this report')).toBeInTheDocument();

    // Backend apiRequest was never called for aging
    expect(apiRequest).not.toHaveBeenCalled();

    // Switching entity works
    const ataBtn = screen.getByTestId('scope-prompt-btn-ata');
    fireEvent.click(ataBtn);
    expect(useSessionStore.getState().activeEntity).toBe('ATA');
  });

  it('invokes onSelectInvoiceId when clicking a row or pressing Enter', async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });
    const onSelectMock = vi.fn();

    const { wrapper } = createHarness();
    render(<AgingReportTab onSelectInvoiceId={onSelectMock} />, { wrapper });

    await waitFor(() => {
      expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
    });

    const row = screen.getByTestId('aging-row-inv-curr-1');
    fireEvent.click(row);
    expect(onSelectMock).toHaveBeenCalledWith('inv-curr-1');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelectMock).toHaveBeenCalledTimes(2);
  });

  it('renders error state and retries on failure', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network timeout'));

    const { wrapper } = createHarness();
    render(<AgingReportTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('aging-error')).toBeInTheDocument();
    });

    expect(screen.getByText('Unable to load aging report')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();

    // Retry
    vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });
    const retryBtn = screen.getByTestId('report-error-retry-btn');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('aging-error')).not.toBeInTheDocument();
      expect(screen.getByText('Acme Logistics')).toBeInTheDocument();
    });
  });
});
