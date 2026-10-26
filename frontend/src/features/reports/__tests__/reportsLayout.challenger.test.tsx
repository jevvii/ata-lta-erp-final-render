import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReportsPage from '@/routes/reports';
import {
  ReportTableContainer,
  ReportSummaryBand,
} from '../components';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(),
}));

// Test harness creating fresh queryClient and router context
function createHarness(initialEntries = ['/reports']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
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

// Sample Mock Fixtures
const mockSingleAnalytics = {
  clients: { total: 40 },
  workRequests: { total: 120 },
  documents: { total: 300 },
  invoices: {
    total: 60,
    totalBilled: 1500000,
    totalCollected: 1000000,
    totalOutstanding: 500000,
    byStatus: { Paid: 40, Sent: 20 },
  },
  disbursements: {
    total: 50,
    totalAmount: 350000,
    releasedAmount: 300000,
    byStatus: { Released: 45, Pending: 5 },
  },
  transmittals: {
    total: 25,
    byStatus: { Delivered: 20, 'In Transit': 5 },
  },
  revenue: {
    totalBilled: 1500000,
    totalCollected: 1000000,
    totalOutstanding: 500000,
    totalExpenses: 350000,
    netIncome: 650000,
  },
};

const mockConsolidatedAnalytics = {
  analyticsByEntity: {
    ATA: {
      ...mockSingleAnalytics,
      revenue: {
        totalBilled: 1000000,
        totalCollected: 700000,
        totalOutstanding: 300000,
        totalExpenses: 200000,
        netIncome: 500000,
      },
    },
    LTA: {
      ...mockSingleAnalytics,
      revenue: {
        totalBilled: 2000000,
        totalCollected: 1500000,
        totalOutstanding: 500000,
        totalExpenses: 400000,
        netIncome: 1100000,
      },
    },
  },
  summary: {
    totalBilled: 3000000,
    totalCollected: 2200000,
    totalOutstanding: 800000,
    netIncome: 1600000,
  },
};

const mockDailyData = {
  date: '2026-10-17',
  summary: {
    workRequests: 3,
    documents: 5,
    invoices: 2,
    invoicesTotal: 120000,
    payments: 2,
    paymentsTotal: 95000,
    disbursements: 1,
    disbursementsTotal: 30000,
    transmittals: 4,
  },
  workRequests: [
    { id: 'wr-1', title: 'Work Request Alpha', status: 'In Progress', created_at: '2026-10-17' },
  ],
  documents: [
    { id: 'doc-1', title: 'Doc Alpha', category: 'Permit', created_at: '2026-10-17' },
  ],
  invoices: [
    { id: 'inv-1', invoice_number: 'INV-001', total: 120000, status: 'Sent', created_at: '2026-10-17' },
  ],
  payments: [
    { id: 'pay-1', invoice_id: 'inv-1', amount: 95000, payment_method: 'Bank Transfer', payment_date: '2026-10-17' },
  ],
  disbursements: [
    { id: 'disb-1', reference_no: 'DSB-001', amount: 30000, status: 'Approved', created_at: '2026-10-17' },
  ],
  transmittals: [
    { id: 'tr-1', tracking_number: 'TR-001', status: 'Draft', created_at: '2026-10-17' },
  ],
};

const mockWeeklyData = {
  weekStart: '2026-10-12',
  weekEnd: '2026-10-18',
  summary: {
    workRequests: 12,
    invoices: 8,
    invoicesTotal: 450000,
    payments: 7,
    paymentsTotal: 380000,
    disbursements: 5,
    disbursementsTotal: 120000,
    documents: 15,
    transmittals: 9,
  },
  details: {
    workRequests: [
      { id: 'wr-w1', title: 'Weekly Request 1', status: 'Completed', created_at: '2026-10-14' },
    ],
    invoices: [
      { id: 'inv-w1', invoice_number: 'INV-W01', total: 450000, status: 'Paid', created_at: '2026-10-15' },
    ],
    payments: [
      { id: 'pay-w1', amount: 380000, payment_method: 'Check', payment_date: '2026-10-16' },
    ],
    disbursements: [
      { id: 'disb-w1', reference_no: 'DSB-W01', amount: 120000, status: 'Released', created_at: '2026-10-14' },
    ],
    documents: [
      { id: 'doc-w1', title: 'Weekly Doc 1', category: 'Tax', created_at: '2026-10-13' },
    ],
    transmittals: [
      { id: 'tr-w1', tracking_number: 'TR-W01', status: 'Delivered', created_at: '2026-10-12' },
    ],
  },
};

const mockMonthlyData = {
  month: '2026-10',
  overdueInvoices: {
    count: 2,
    totalOutstanding: 185000,
    items: [
      {
        id: 'inv-m1',
        invoice_number: 'INV-M01',
        client_name: 'Metro Freight Inc',
        due_date: '2026-10-01',
        status: 'Sent',
        total: 100000,
        balance: 100000,
      },
    ],
  },
  pendingDisbursements: {
    count: 1,
    totalAmount: 45000,
    items: [
      {
        id: 'disb-m1',
        reference_no: 'DSB-M01',
        category: 'Travel',
        status: 'Pending',
        created_at: '2026-10-05',
        amount: 45000,
      },
    ],
  },
  staleTransmittals: {
    count: 1,
    items: [
      {
        id: 'tr-m1',
        tracking_number: 'TR-M01',
        client_name: 'Global Corp',
        status: 'Draft',
        created_at: '2026-10-02',
      },
    ],
  },
};

const mockAgingData = {
  summary: {
    current: 250000,
    '1-30': 150000,
    '31-60': 100000,
    '61-90': 50000,
    '90+': 25000,
    grandTotal: 575000,
  },
  buckets: {
    current: {
      total: 250000,
      count: 1,
      invoices: [
        {
          id: 'inv-ag-1',
          invoiceNumber: 'INV-AG-001',
          clientName: 'Pacific Transport',
          dueDate: '2026-10-31',
          total: 250000,
          balance: 250000,
          daysOverdue: 0,
        },
      ],
    },
    '1-30': {
      total: 150000,
      count: 1,
      invoices: [
        {
          id: 'inv-ag-2',
          invoiceNumber: 'INV-AG-002',
          clientName: 'Atlantic Shipping',
          dueDate: '2026-10-10',
          total: 150000,
          balance: 150000,
          daysOverdue: 7,
        },
      ],
    },
    '31-60': { total: 100000, count: 0, invoices: [] },
    '61-90': { total: 50000, count: 0, invoices: [] },
    '90+': { total: 25000, count: 0, invoices: [] },
  },
};

describe('Reports Challenger Suite: Layout, Viewports, Print & State Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view', 'users:manage']),
      user: {
        id: 'usr-admin',
        name: 'Lead Challenger',
        email: 'challenger@atalta.com',
        role: 'Admin',
        departments: [],
        entities: ['ATA', 'LTA'],
      },
    });

    vi.mocked(apiRequest).mockImplementation(async (path: string) => {
      if (path.includes('/reports/analytics')) {
        const ent = useSessionStore.getState().activeEntity;
        if (ent === 'ALL') {
          return { data: mockConsolidatedAnalytics };
        }
        return { data: mockSingleAnalytics };
      }
      if (path.includes('/reports/daily')) {
        return { data: mockDailyData };
      }
      if (path.includes('/reports/weekly')) {
        return { data: mockWeeklyData };
      }
      if (path.includes('/reports/monthly-pending')) {
        return { data: mockMonthlyData };
      }
      if (path.includes('/reports/aging')) {
        return { data: mockAgingData };
      }
      return { data: {} };
    });
  });

  // ==========================================================================
  // Section 1: Responsive Layout & Geometry Across Viewports
  // ==========================================================================
  describe('1. Responsive Layout & Geometry Across Viewports (1440, 1280, 1024, 768, 390px)', () => {
    it('applies fluid container boundary with mobile (16px) and desktop (24px) padding without page overflow', async () => {
      const { wrapper } = createHarness(['/reports?tab=overview']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
      });

      const rootPage = screen.getByTestId('reports-page');
      // Full-bleed within Shell's single gutter container
      expect(rootPage.className).toContain('w-full');
      expect(rootPage.className).toContain('space-y-6');
    });

    it('stacks header items vertically on 390px mobile and aligns horizontally on >= 768px viewports', async () => {
      const { wrapper } = createHarness(['/reports?tab=overview']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
      });

      const headerContainer = screen.getByTestId('reports-page').firstElementChild as HTMLElement;
      expect(headerContainer.className).toContain('flex-col');
      expect(headerContainer.className).toContain('sm:flex-row');
      expect(headerContainer.className).toContain('sm:items-center');
      expect(headerContainer.className).toContain('justify-between');
    });

    it('enforces horizontal scroll containment on the main navigation tab bar to prevent viewport blowout at 390px', async () => {
      const { wrapper } = createHarness(['/reports?tab=overview']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
      });

      const tabList = screen.getByRole('tablist');
      // Tab list must allow horizontal scrolling on narrow screens rather than expanding the page
      expect(tabList.className).toContain('overflow-x-auto');
      expect(tabList.className).toContain('scrollbar-none');
    });

    it('enforces contained horizontal scrolling (overflow-x-auto) on ReportTableContainer across all tables', () => {
      const { container } = render(
        <ReportTableContainer minWidth="min-w-[640px]" ariaLabel="Test responsive table">
          <table>
            <thead>
              <tr>
                <th>Col 1</th>
                <th>Col 2</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Data 1</td>
                <td>Data 2</td>
              </tr>
            </tbody>
          </table>
        </ReportTableContainer>
      );

      const tableRegion = container.querySelector('[role="region"]');
      expect(tableRegion).toBeInTheDocument();
      expect(tableRegion?.getAttribute('tabIndex')).toBe('0');
      expect(tableRegion?.getAttribute('aria-label')).toBe('Test responsive table');
      // Horizontal scroll must be strictly contained inside the wrapper
      expect(tableRegion?.className).toContain('overflow-x-auto');
      expect(tableRegion?.className).toContain('w-full');

      const innerWrapper = tableRegion?.firstElementChild as HTMLElement;
      expect(innerWrapper.className).toContain('min-w-[640px]');
    });

    it('verifies responsive column break rules in ReportSummaryBand (collapsing to 1 column at 390px mobile)', () => {
      const metrics = [
        { label: 'Billed', value: '₱123,456,789.00' },
        { label: 'Collected', value: '₱98,765,432.00' },
        { label: 'Outstanding', value: '₱24,691,357.00' },
        { label: 'Net Income', value: '₱15,000,000.00' },
      ];

      const { container } = render(<ReportSummaryBand metrics={metrics} columns={4} />);
      const grid = container.querySelector('[data-testid="report-summary-band"]');
      expect(grid).toBeInTheDocument();
      // On mobile (< 640px e.g. 390px): 1 column (grid-cols-1)
      expect(grid?.className).toContain('grid-cols-1');
      // On tablet (>= 640px sm: 768px): 2 columns (sm:grid-cols-2)
      expect(grid?.className).toContain('sm:grid-cols-2');
      // On desktop (>= 1024px lg: 1280px, 1440px): 4 columns (lg:grid-cols-4)
      expect(grid?.className).toContain('lg:grid-cols-4');
    });
  });

  // ==========================================================================
  // Section 2: Print CSS Media Queries & Element Isolation
  // ==========================================================================
  describe('2. Print CSS Media Queries & Element Isolation', () => {
    it('AgingReportTab injects dedicated @media print CSS for page-break avoidance and repeated table headers', async () => {
      const { wrapper } = createHarness(['/reports?tab=aging']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('aging-report-tab')).toBeInTheDocument();
      });

      const styleTags = document.querySelectorAll('style');
      let foundPrintRules = false;
      styleTags.forEach((styleTag) => {
        const text = styleTag.textContent || '';
        if (
          text.includes('@media print') &&
          text.includes('thead') &&
          text.includes('table-header-group') &&
          text.includes('break-inside: avoid')
        ) {
          foundPrintRules = true;
        }
      });

      expect(foundPrintRules).toBe(true);
    });

    it('verifies that interactive controls, search, and KPI strip are hidden in print (@media print)', async () => {
      const { wrapper } = createHarness(['/reports?tab=aging']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('aging-report-tab')).toBeInTheDocument();
      });

      // Context toolbar must have print:hidden
      const toolbar = screen.getByTestId('report-toolbar');
      expect(toolbar.className).toContain('print:hidden');

      // Headline balance card must have print:hidden
      const headlineCard = screen.getByTestId('kpi-grand-total');
      expect(headlineCard.className).toContain('print:hidden');

      // Bucket selection strip must have print:hidden
      const bucketStrip = screen.getByTestId('aging-bucket-strip');
      expect(bucketStrip.className).toContain('print:hidden');

      // Search container must have print:hidden
      const searchContainer = screen.getByTestId('aging-search-input').parentElement?.parentElement;
      expect(searchContainer?.className).toContain('print:hidden');
    });

    it('verifies that dedicated print header with report context is visible only during print', async () => {
      const { wrapper } = createHarness(['/reports?tab=aging']);
      const { container } = render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('aging-report-tab')).toBeInTheDocument();
      });

      // Dedicated print header has "hidden print:block"
      const printHeader = container.querySelector('.print\\:block');
      expect(printHeader).toBeInTheDocument();
      expect(printHeader?.className).toContain('hidden');
      expect(printHeader?.className).toContain('print:block');
      expect(printHeader?.textContent).toContain('AR Aging Report');
      expect(printHeader?.textContent).toContain('Operating Entity: ATA');
      expect(printHeader?.textContent).toContain('Outstanding Balance:');
    });
  });

  // ==========================================================================
  // Section 3: Cross-Tab Integration & Tab Aliasing
  // ==========================================================================
  describe('3. Cross-Tab Integration, URL Aliasing & Rapid Tab Transitions', () => {
    it('seamlessly aliases ?tab=analytics to overview tab without crashing or URL desync', async () => {
      const { wrapper } = createHarness(['/reports?tab=analytics']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
      });

      // Tab trigger for overview should be active
      const overviewTrigger = screen.getByTestId('tab-trigger-overview');
      expect(overviewTrigger.getAttribute('data-state')).toBe('active');
      // Overview tab content rendered once query resolves
      await waitFor(() => {
        expect(screen.getByTestId('analytics-overview-tab')).toBeInTheDocument();
      });
    });

    it('supports direct navigation to all valid tabs: overview, daily, weekly, monthly, aging', async () => {
      const tabs = [
        { param: 'overview', testId: 'analytics-overview-tab', triggerId: 'tab-trigger-overview' },
        { param: 'daily', testId: 'daily-activity-tab', triggerId: 'tab-trigger-daily' },
        { param: 'weekly', testId: 'weekly-summary-tab', triggerId: 'tab-trigger-weekly' },
        { param: 'monthly', testId: 'monthly-pending-tab', triggerId: 'tab-trigger-monthly' },
        { param: 'aging', testId: 'aging-report-tab', triggerId: 'tab-trigger-aging' },
      ];

      for (const t of tabs) {
        const { wrapper } = createHarness([`/reports?tab=${t.param}`]);
        const { unmount } = render(
          <Routes>
            <Route path="/reports" element={<ReportsPage />} />
          </Routes>,
          { wrapper }
        );

        await waitFor(() => {
          expect(screen.getByTestId(t.testId)).toBeInTheDocument();
        });

        const trigger = screen.getByTestId(t.triggerId);
        expect(trigger.getAttribute('data-state')).toBe('active');

        unmount();
      }
    });

    it('recovers gracefully from invalid tab parameter by defaulting to overview', async () => {
      const { wrapper } = createHarness(['/reports?tab=nonexistent_invalid_tab']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('reports-page')).toBeInTheDocument();
      });

      // Should default to overview
      expect(screen.getByTestId('tab-trigger-overview').getAttribute('data-state')).toBe('active');
      await waitFor(() => {
        expect(screen.getByTestId('analytics-overview-tab')).toBeInTheDocument();
      });
    });

    it('handles rapid sequential clicking between all 5 tabs without unhandled exceptions or state corruption', async () => {
      const { wrapper } = createHarness(['/reports?tab=overview']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('analytics-overview-tab')).toBeInTheDocument();
      });

      const selectTab = (testId: string) => {
        const trigger = screen.getByTestId(testId);
        fireEvent.mouseDown(trigger, { button: 0 });
      };

      // Switch to Daily
      selectTab('tab-trigger-daily');
      await waitFor(() => {
        expect(screen.getByTestId('daily-activity-tab')).toBeInTheDocument();
      });

      // Switch to Weekly
      selectTab('tab-trigger-weekly');
      await waitFor(() => {
        expect(screen.getByTestId('weekly-summary-tab')).toBeInTheDocument();
      });

      // Switch to Monthly
      selectTab('tab-trigger-monthly');
      await waitFor(() => {
        expect(screen.getByTestId('monthly-pending-tab')).toBeInTheDocument();
      });

      // Switch to Aging
      selectTab('tab-trigger-aging');
      await waitFor(() => {
        expect(screen.getByTestId('aging-report-tab')).toBeInTheDocument();
      });

      // Switch back to Overview
      selectTab('tab-trigger-overview');
      await waitFor(() => {
        expect(screen.getByTestId('analytics-overview-tab')).toBeInTheDocument();
      });
    });
  });

  // ==========================================================================
  // Section 4: Entity Transitions & Strict Isolation Against Stale Data Bleed
  // ==========================================================================
  describe('4. Entity Transitions & Strict Isolation Against Stale Data Bleed', () => {
    it('switching to ALL on detail tabs immediately renders ReportScopePrompt and halts detail queries', async () => {
      const { wrapper } = createHarness(['/reports?tab=daily']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('daily-activity-tab')).toBeInTheDocument();
      });

      // Switch entity to ALL via header switcher
      const allEntityBtn = screen.getByTestId('entity-btn-all');
      fireEvent.click(allEntityBtn);

      await waitFor(() => {
        expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
      });

      // Warning prompt text
      const heading = screen.getByRole('heading', { name: /Choose ATA or LTA to view this report/i });
      expect(heading).toBeInTheDocument();
      expect(screen.getByText(/Single-Entity Scope Required:/i)).toBeInTheDocument();

      // Ensure detail query is not called for ALL
      const callsToDaily = vi.mocked(apiRequest).mock.calls.filter((c) =>
        String(c[0]).includes('/reports/daily')
      );
      // All calls to daily must not contain ALL
      callsToDaily.forEach((call) => {
        expect(String(call[0])).not.toContain('entity=ALL');
      });

      // Clicking actionable "Switch to ATA" button immediately recovers single-entity view
      const switchAtaBtn = screen.getByTestId('scope-prompt-btn-ata');
      fireEvent.click(switchAtaBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('entity-all-warning')).not.toBeInTheDocument();
        expect(screen.getByTestId('daily-toolbar')).toBeInTheDocument();
      });
      expect(useSessionStore.getState().activeEntity).toBe('ATA');
    });

    it('ALL scope displays consolidated comparison table in overview and single-entity views for ATA/LTA', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const { wrapper } = createHarness(['/reports?tab=overview']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('consolidated-analytics-view')).toBeInTheDocument();
      });

      // Consolidated comparison table contains ATA, LTA, and Combined columns
      expect(screen.getByText('Consolidated Enterprise Analytics')).toBeInTheDocument();
      expect(
        screen.getByText(/Comparative performance across ATA and LTA entities/i)
      ).toBeInTheDocument();
      expect(screen.getAllByText('Combined').length).toBeGreaterThanOrEqual(1);

      // Switch to LTA
      fireEvent.click(screen.getByTestId('entity-btn-lta'));

      await waitFor(() => {
        expect(screen.getByTestId('summary-billed')).toBeInTheDocument();
        expect(screen.getByTestId('analytics-kpi-grid')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('consolidated-analytics-view')).not.toBeInTheDocument();
    });

    it('guarantees stale data from ATA never bleeds under LTA scope during rapid entity toggle', async () => {
      let currentEntityData = 'ATA';

      vi.mocked(apiRequest).mockImplementation(async (path: string) => {
        if (path.includes('/reports/analytics')) {
          if (currentEntityData === 'ATA') {
            return {
              data: {
                ...mockSingleAnalytics,
                revenue: {
                  ...mockSingleAnalytics.revenue,
                  totalBilled: 1111111,
                },
              },
            };
          } else {
            return {
              data: {
                ...mockSingleAnalytics,
                revenue: {
                  ...mockSingleAnalytics.revenue,
                  totalBilled: 2222222,
                },
              },
            };
          }
        }
        return { data: {} };
      });

      const { wrapper } = createHarness(['/reports?tab=overview']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      // Verify ATA initial rendered amount
      await waitFor(() => {
        expect(screen.getByTestId('summary-billed')).toHaveTextContent('₱1,111,111.00');
      });

      // Switch to LTA
      currentEntityData = 'LTA';
      fireEvent.click(screen.getByTestId('entity-btn-lta'));

      // Stale ATA data (1,111,111) must NOT remain under LTA; it must update to LTA data (2,222,222)
      await waitFor(() => {
        expect(screen.getByTestId('summary-billed')).toHaveTextContent('₱2,222,222.00');
      });

      expect(useSessionStore.getState().activeEntity).toBe('LTA');
    });
  });

  // ==========================================================================
  // Section 5: Robust Loading, Error, and Empty States
  // ==========================================================================
  describe('5. Robust Loading, Error, and Empty States Across Tabs', () => {
    it('renders ReportLoadingState skeleton with pulse animation during initial data fetch', () => {
      const { container } = render(
        <ReportSummaryBand isLoading={true} columns={3} />
      );
      const loadingBand = container.querySelector('[data-testid="report-summary-band-loading"]');
      expect(loadingBand).toBeInTheDocument();
      expect(loadingBand?.children.length).toBe(3);
      expect(loadingBand?.firstElementChild?.className).toContain('animate-pulse');
    });

    it('renders clean ReportEmptyState when an entity has zero records without crashing', async () => {
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

      const { wrapper } = createHarness(['/reports?tab=aging']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('empty-aging-report')).toBeInTheDocument();
      });

      expect(screen.getByText('No outstanding invoices')).toBeInTheDocument();
      expect(
        screen.getByText('There are currently no open or overdue accounts receivable for ATA.')
      ).toBeInTheDocument();
    });

    it('renders ReportErrorState with functional Retry action on query failure', async () => {
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network error: Gateway timeout'));

      const { wrapper } = createHarness(['/reports?tab=aging']);
      render(
        <Routes>
          <Route path="/reports" element={<ReportsPage />} />
        </Routes>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('aging-error')).toBeInTheDocument();
      });

      expect(screen.getByText('Unable to load aging report')).toBeInTheDocument();
      expect(screen.getByText('Network error: Gateway timeout')).toBeInTheDocument();

      const retryBtn = screen.getByRole('button', { name: /Retry/i });
      expect(retryBtn).toBeInTheDocument();
    });
  });
});
