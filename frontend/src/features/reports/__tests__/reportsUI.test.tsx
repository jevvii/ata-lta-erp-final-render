import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AnalyticsOverviewTab,
  DailyActivityTab,
  WeeklySummaryTab,
  MonthlyPendingTab,
  AgingReportTab,
} from '../components';
import ReportsPage from '@/routes/reports';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';
import { DateInput } from '@/components/ui/date-input';
import {
  formatCurrency,
  formatCount,
  formatManilaDate,
  formatDate,
  formatMonth,
  formatDateRange,
  escapeCsvCell,
} from '../utils/formatters';
import {
  useDailyReport,
  useWeeklyReport,
  useMonthlyPending,
  useAgingReport,
} from '../api/useReports';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(),
}));

function createHookWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },
  });

  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

function createHarness(initialEntries = ['/reports']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    },

  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, { initialEntries }, children)
    );

  return { queryClient, wrapper };
}

describe('Reports UI Components & Route Testing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view', 'workflow:view']),
    });
  });

  describe('AnalyticsOverviewTab', () => {
    const mockAnalytics = {
      clients: { total: 42 },
      workRequests: { total: 128 },
      documents: { total: 350 },
      invoices: {
        total: 65,
        totalBilled: 1250000,
        totalCollected: 950000,
        totalOutstanding: 300000,
        byStatus: { Paid: 45, Sent: 20 },
      },
      disbursements: {
        total: 80,
        totalAmount: 420000,
        releasedAmount: 380000,
        byStatus: { Released: 70, Pending: 10 },
      },
      transmittals: {
        total: 30,
        byStatus: { Delivered: 25, 'In Transit': 5 },
      },
      revenue: {
        totalBilled: 1250000,
        totalCollected: 950000,
        totalOutstanding: 300000,
        totalExpenses: 380000,
        netIncome: 570000,
      },
    };

    it('renders single-entity operational KPI cards and bento details', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAnalytics });

      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('analytics-overview-tab')).toBeInTheDocument();
      });

      expect(screen.getByTestId('kpi-clients')).toHaveTextContent('42');
      expect(screen.getByTestId('kpi-work-requests')).toHaveTextContent('128');
      expect(screen.getByTestId('kpi-documents')).toHaveTextContent('350');
      expect(screen.getByTestId('kpi-invoices')).toHaveTextContent('65');

      expect(screen.getByText('Billing Summary')).toBeInTheDocument();
      expect(screen.getByText('Disbursement Summary')).toBeInTheDocument();
      expect(screen.getByText('Revenue & P&L Summary')).toBeInTheDocument();
      expect(screen.getByText('Transmittal Summary')).toBeInTheDocument();
    });

    it('renders consolidated enterprise view when entity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const consolidatedData = {
        analyticsByEntity: {
          ATA: mockAnalytics,
          LTA: { ...mockAnalytics, clients: { total: 18 } },
        },
      };
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: consolidatedData });

      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('consolidated-analytics-view')).toBeInTheDocument();
      });

      expect(screen.getByText('Consolidated Enterprise Analytics')).toBeInTheDocument();
      expect(screen.getByText('Combined Clients')).toBeInTheDocument();
      expect(screen.getByText('60')).toBeInTheDocument(); // 42 + 18
    });
  });

  describe('DailyActivityTab', () => {
    it('renders 9 summary badges and 6 detail tables', async () => {
      const mockDaily = {
        date: '2026-10-04',
        workRequests: [{ id: 'wr-1', title: 'Tax Advice Request', status: 'In Progress', created_at: '2026-10-04T08:00:00Z' }],
        documents: [{ id: 'doc-1', original_name: 'BIR-1701.pdf', category: 'BIR', created_at: '2026-10-04T09:00:00Z' }],
        invoices: [{ id: 'inv-1', invoice_number: 'INV-2026-001', total: 25000, status: 'Sent', created_at: '2026-10-04T10:00:00Z' }],
        payments: [{ id: 'pay-1', amount: 25000, method: 'Check', created_at: '2026-10-04T11:00:00Z' }],
        disbursements: [{ id: 'db-1', disbursement_number: 'DB-2026-001', amount: 5000, status: 'Released', created_at: '2026-10-04T12:00:00Z' }],
        transmittals: [{ id: 'tr-1', tracking_number: 'TR-2026-001', status: 'Delivered', created_at: '2026-10-04T13:00:00Z' }],
        summary: {
          workRequests: 1,
          documents: 1,
          invoices: 1,
          invoicesTotal: 25000,
          payments: 1,
          paymentsTotal: 25000,
          disbursements: 1,
          disbursementsTotal: 5000,
          transmittals: 1,
        },
      };
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockDaily });

      const { wrapper } = createHarness();
      render(<DailyActivityTab />, { wrapper });

      await waitFor(() => {
        expect(screen.queryByTestId('daily-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('kpi-work-requests')).toHaveTextContent('1');
      expect(screen.getByTestId('kpi-invoices-total')).toHaveTextContent('₱25,000.00');
      expect(screen.getByText('Tax Advice Request')).toBeInTheDocument();
      expect(screen.getByText('BIR-1701.pdf')).toBeInTheDocument();
      expect(screen.getByText('INV-2026-001')).toBeInTheDocument();
      expect(screen.getByText('DB-2026-001')).toBeInTheDocument();
      expect(screen.getByText('TR-2026-001')).toBeInTheDocument();
    });
  });

  describe('WeeklySummaryTab', () => {
    it('computes Monday-Sunday week bounds and displays details', async () => {
      const mockWeekly = {
        weekStart: '2026-09-28',
        weekEnd: '2026-10-04',
        summary: {
          workRequests: 2,
          invoices: 1,
          invoicesTotal: 10000,
          payments: 1,
          paymentsTotal: 10000,
          disbursements: 1,
          disbursementsTotal: 3000,
          documents: 4,
          transmittals: 1,
        },
        details: {
          workRequests: [{ id: 'wr-1', title: 'Consulting WR', status: 'Approved', created_at: '2026-09-29T00:00:00Z' }],
          invoices: [{ id: 'inv-1', invoice_number: 'INV-WEEK-1', total: 10000, status: 'Paid', created_at: '2026-09-30T00:00:00Z' }],
          payments: [],
          disbursements: [],
          documents: [],
          transmittals: [],
        },
      };
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockWeekly });

      const { wrapper } = createHarness();
      render(<WeeklySummaryTab />, { wrapper });

      await waitFor(() => {
        expect(screen.queryByTestId('weekly-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('weekly-bounds-header')).toBeInTheDocument();
      expect(screen.getByText('Consulting WR')).toBeInTheDocument();
      expect(screen.getByText('INV-WEEK-1')).toBeInTheDocument();
    });
  });

  describe('MonthlyPendingTab', () => {
    it('renders 5 KPI badges and overdue/pending tables', async () => {
      const mockMonthly = {
        month: '2026-10',
        overdueInvoices: {
          count: 1,
          totalOutstanding: 75000,
          items: [
            {
              id: 'inv-1',
              invoice_number: 'INV-OVERDUE-1',
              due_date: '2026-09-15',
              total: 75000,
              balance: 75000,
              status: 'Sent',
              clients: { name: 'Manila Retailers' },
            },
          ],
        },
        pendingDisbursements: {
          count: 1,
          totalAmount: 18000,
          items: [
            {
              id: 'db-1',
              disbursement_number: 'DB-PENDING-1',
              amount: 18000,
              status: 'Pending',
              category: 'Legal Fees',
              created_at: '2026-10-01T00:00:00Z',
            },
          ],
        },
        staleTransmittals: {
          count: 1,
          items: [
            {
              id: 'tr-1',
              tracking_number: 'TR-STALE-1',
              clients: { name: 'Metro Logistic' },
              created_at: '2026-09-20T00:00:00Z',
              status: 'Draft',
            },
          ],
        },
      };
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockMonthly });

      const { wrapper } = createHarness();
      render(<MonthlyPendingTab />, { wrapper });

      await waitFor(() => {
        expect(screen.queryByTestId('monthly-loading')).not.toBeInTheDocument();
      });

      expect(screen.getByTestId('kpi-overdue-invoices')).toHaveTextContent('1');
      expect(screen.getByTestId('kpi-overdue-outstanding')).toHaveTextContent('₱75,000.00');
      expect(screen.getByText('INV-OVERDUE-1')).toBeInTheDocument();
      expect(screen.getByText('Manila Retailers')).toBeInTheDocument();
      expect(screen.getByText('DB-PENDING-1')).toBeInTheDocument();
      expect(screen.getByText('TR-STALE-1')).toBeInTheDocument();
    });
  });

  describe('AgingReportTab', () => {
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
              id: 'inv-c',
              invoiceNumber: 'INV-CURR',
              clientName: 'Apex Prime',
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
              id: 'inv-30',
              invoiceNumber: 'INV-30DAYS',
              clientName: 'Summit Corp',
              dueDate: '2026-09-25',
              total: 30000,
              balance: 30000,
              daysOverdue: 10,
            },
          ],
        },
        '31-60': { total: 20000, count: 0, invoices: [] },
        '61-90': { total: 15000, count: 0, invoices: [] },
        '90+': { total: 10000, count: 0, invoices: [] },
      },
    };

    it('renders aging buckets, search filtering, bucket toggle, and export triggers', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: mockAgingData });

      // Mock URL.createObjectURL and revokeObjectURL
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      window.URL.revokeObjectURL = vi.fn();
      window.print = vi.fn();

      const { wrapper } = createHarness();
      render(<AgingReportTab />, { wrapper });

      await waitFor(() => {
        expect(screen.queryByTestId('aging-loading')).not.toBeInTheDocument();
      });

      // Verify KPI values
      expect(screen.getByTestId('kpi-current')).toHaveTextContent('₱50,000.00');
      expect(screen.getByTestId('kpi-1-30')).toHaveTextContent('₱30,000.00');
      expect(screen.getByTestId('kpi-grand-total')).toHaveTextContent('₱125,000.00');

      // Verify invoice rows
      expect(screen.getByText('INV-CURR')).toBeInTheDocument();
      expect(screen.getByText('INV-30DAYS')).toBeInTheDocument();

      // Filter by search query
      const searchInput = screen.getByTestId('aging-search-input');
      fireEvent.change(searchInput, { target: { value: 'Summit' } });
      expect(screen.queryByText('INV-CURR')).not.toBeInTheDocument();
      expect(screen.getByText('INV-30DAYS')).toBeInTheDocument();

      // Clear search and test bucket toggle
      fireEvent.change(searchInput, { target: { value: '' } });
      const currentKpi = screen.getByTestId('kpi-current');
      fireEvent.click(currentKpi);
      expect(screen.getByText('INV-CURR')).toBeInTheDocument();
      expect(screen.queryByText('INV-30DAYS')).not.toBeInTheDocument();

      // Click again to toggle back to all
      fireEvent.click(currentKpi);
      expect(screen.getByText('INV-CURR')).toBeInTheDocument();
      expect(screen.getByText('INV-30DAYS')).toBeInTheDocument();

      // Test CSV Export
      const exportBtn = screen.getByTestId('aging-export-csv-button');
      fireEvent.click(exportBtn);
      expect(window.URL.createObjectURL).toHaveBeenCalled();

      // Test Print
      const printBtn = screen.getByTestId('aging-print-button');
      fireEvent.click(printBtn);
      expect(window.print).toHaveBeenCalled();
    });
  });

  describe('ReportsPage Route Assembly & RBAC', () => {
    it('renders tabs and single-entity warning banner when activeEntity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      vi.mocked(apiRequest).mockResolvedValue({
        data: {
          date: '2026-10-04',
          workRequests: [],
          documents: [],
          invoices: [],
          payments: [],
          disbursements: [],
          transmittals: [],
          summary: {
            workRequests: 0,
            documents: 0,
            invoices: 0,
            invoicesTotal: 0,
            payments: 0,
            paymentsTotal: 0,
            disbursements: 0,
            disbursementsTotal: 0,
            transmittals: 0,
          },
        },
      });

      const { wrapper } = createHarness(['/reports?tab=daily']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
      });

      // Warning banner must be present for daily tab with ALL entity
      expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
      expect(screen.getByText(/Single-Entity Scope Required:/i)).toBeInTheDocument();

      // Clicking Switch to ATA changes entity
      const ataBtn = screen.getByRole('button', { name: /Switch to ATA/i });
      fireEvent.click(ataBtn);
      expect(useSessionStore.getState().activeEntity).toBe('ATA');
    });

    it('renders forbidden screen when user lacks both reports:view and billing:view', async () => {
      useSessionStore.setState({ permissions: new Set(['operations:view']) });

      const { wrapper } = createHarness(['/reports']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
      });
      expect(screen.getByText('Access Forbidden')).toBeInTheDocument();
    });

    it('auto-selects aging tab when user has only billing:view', async () => {
      useSessionStore.setState({ permissions: new Set(['billing:view']) });
      vi.mocked(apiRequest).mockResolvedValue({
        data: {
          summary: { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0, grandTotal: 0 },
          buckets: {
            current: { total: 0, count: 0, invoices: [] },
            '1-30': { total: 0, count: 0, invoices: [] },
            '31-60': { total: 0, count: 0, invoices: [] },
            '61-90': { total: 0, count: 0, invoices: [] },
            '90+': { total: 0, count: 0, invoices: [] },
          },
        },
      });

      const { wrapper } = createHarness(['/reports']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
      });

      // General tabs are not rendered
      expect(screen.queryByTestId('tab-trigger-analytics')).not.toBeInTheDocument();
      expect(screen.queryByTestId('tab-trigger-daily')).not.toBeInTheDocument();

      // Aging tab is rendered and active
      expect(screen.getByTestId('tab-trigger-aging')).toBeInTheDocument();
      expect(screen.getByTestId('aging-report-tab')).toBeInTheDocument();
    });
  });

  describe('Formatters & Utility Functions', () => {
    describe('formatCurrency', () => {
      it('strictly separates missing data (—) from genuine zero (₱0.00)', () => {
        expect(formatCurrency(0)).toBe('₱0.00');
        expect(formatCurrency('0')).toBe('₱0.00');
        expect(formatCurrency(0.0)).toBe('₱0.00');
        expect(formatCurrency(undefined)).toBe('—');
        expect(formatCurrency(null)).toBe('—');
        expect(formatCurrency('')).toBe('—');
        expect(formatCurrency(NaN)).toBe('—');
        expect(formatCurrency('invalid-amount')).toBe('—');
      });

      it('formats positive and negative amounts correctly', () => {
        expect(formatCurrency(1250000)).toBe('₱1,250,000.00');
        expect(formatCurrency('12500.50')).toBe('₱12,500.50');
        expect(formatCurrency(-1250.5)).toBe('-₱1,250.50');
        expect(formatCurrency('-99.99')).toBe('-₱99.99');
      });

      it('supports custom fallback string', () => {
        expect(formatCurrency(null, { fallback: 'N/A' })).toBe('N/A');
        expect(formatCurrency(undefined, { fallback: '0.00' })).toBe('0.00');
      });
    });

    describe('formatCount', () => {
      it('strictly separates missing data (—) from genuine zero (0)', () => {
        expect(formatCount(0)).toBe('0');
        expect(formatCount('0')).toBe('0');
        expect(formatCount(undefined)).toBe('—');
        expect(formatCount(null)).toBe('—');
        expect(formatCount('')).toBe('—');
        expect(formatCount(NaN)).toBe('—');
      });

      it('formats positive integers with locale separators', () => {
        expect(formatCount(42)).toBe('42');
        expect(formatCount(1234567)).toBe('1,234,567');
      });
    });

    describe('formatManilaDate and formatDate', () => {
      it('formats calendar-only YYYY-MM-DD directly without UTC day shifts', () => {
        expect(formatManilaDate('2026-10-17')).toBe('Oct 17, 2026');
        expect(formatManilaDate('2026-01-05')).toBe('Jan 5, 2026');
        expect(formatDate('2026-12-31')).toBe('Dec 31, 2026');
      });

      it('returns placeholder for missing date strings', () => {
        expect(formatManilaDate(undefined)).toBe('—');
        expect(formatManilaDate(null)).toBe('—');
        expect(formatManilaDate('')).toBe('—');
      });
    });

    describe('formatMonth and formatDateRange', () => {
      it('formats YYYY-MM to full Month Year', () => {
        expect(formatMonth('2026-10')).toBe('October 2026');
        expect(formatMonth('2026-01')).toBe('January 2026');
        expect(formatMonth(null)).toBe('—');
      });

      it('formats date ranges with en-dash', () => {
        expect(formatDateRange('2026-10-12', '2026-10-18')).toBe('Oct 12, 2026 – Oct 18, 2026');
        expect(formatDateRange(null, null)).toBe('—');
      });
    });

    describe('escapeCsvCell formula injection protection', () => {
      it('neutralizes spreadsheet formula injection trigger characters (=, +, -, @, \\t, \\r)', () => {
        expect(escapeCsvCell('=SUM(A1:B2)')).toBe(`"'=SUM(A1:B2)"`);
        expect(escapeCsvCell('+12345')).toBe(`"'+12345"`);
        expect(escapeCsvCell('-12500')).toBe(`"'-12500"`);
        expect(escapeCsvCell('@COMMAND')).toBe(`"'@COMMAND"`);
        expect(escapeCsvCell('\tcmd')).toBe(`"'\tcmd"`);
        expect(escapeCsvCell('\rcmd')).toBe(`"'\rcmd"`);
      });

      it('safely quotes plain text and escapes double quotes', () => {
        expect(escapeCsvCell('Simple Text')).toBe('"Simple Text"');
        expect(escapeCsvCell('Text with "Quotes"')).toBe('"Text with ""Quotes"""');
        expect(escapeCsvCell(null)).toBe('""');
        expect(escapeCsvCell(undefined)).toBe('""');
      });
    });
  });

  describe('Detail Report Query Gating with activeEntity === "ALL"', () => {
    it('disables useDailyReport when activeEntity is ALL', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const { result } = renderHook(() => useDailyReport('2026-10-04'), {
        wrapper: createHookWrapper(),
      });
      expect(result.current.fetchStatus).toBe('idle');
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it('disables useWeeklyReport when activeEntity is ALL', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const { result } = renderHook(() => useWeeklyReport('2026-10-04'), {
        wrapper: createHookWrapper(),
      });
      expect(result.current.fetchStatus).toBe('idle');
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it('disables useMonthlyPending when activeEntity is ALL', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const { result } = renderHook(() => useMonthlyPending('2026-10'), {
        wrapper: createHookWrapper(),
      });
      expect(result.current.fetchStatus).toBe('idle');
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it('disables useAgingReport when activeEntity is ALL', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const { result } = renderHook(() => useAgingReport(), {
        wrapper: createHookWrapper(),
      });
      expect(result.current.fetchStatus).toBe('idle');
      expect(apiRequest).not.toHaveBeenCalled();
    });
  });

  describe('DateInput Styling & Contract Integrity', () => {
    it('applies font-sans, default 36px height, and minimum widths for date and month types', () => {
      const { container, rerender } = render(
        <DateInput value="2026-10-17" onValueChange={() => {}} aria-label="Test Date" />
      );
      const root = container.firstChild as HTMLElement;
      expect(root.className).toContain('font-sans');
      expect(root.className).toContain('h-9');
      expect(root.className).toContain('sm:min-w-[176px]');

      rerender(
        <DateInput type="month" value="2026-10" onValueChange={() => {}} aria-label="Test Month" />
      );
      const monthRoot = container.firstChild as HTMLElement;
      expect(monthRoot.className).toContain('sm:min-w-[184px]');
    });
  });
});
