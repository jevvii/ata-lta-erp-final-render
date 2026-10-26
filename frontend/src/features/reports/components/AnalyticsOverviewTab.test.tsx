import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnalyticsOverviewTab } from './AnalyticsOverviewTab';
import { apiRequest } from '@/lib/api';
import { useSessionStore } from '@/lib/session';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn(),
  isConcurrencyConflictError: vi.fn().mockReturnValue(false),
}));

const mockUser = {
  id: 'usr-1',
  email: 'auditor@ata-lta.com',
  name: 'Test Auditor',
  role: 'super_admin' as const,
  departments: ['Executive', 'Finance'],
  entities: ['ATA', 'LTA'],
};

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { wrapper, queryClient };
}

describe('AnalyticsOverviewTab', () => {
  const singleEntityMock = {
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

  const consolidatedMock = {
    analyticsByEntity: {
      ATA: singleEntityMock,
      LTA: {
        ...singleEntityMock,
        clients: { total: 18 },
        workRequests: { total: 72 },
        documents: { total: 150 },
        invoices: {
          total: 35,
          totalBilled: 750000,
          totalCollected: 500000,
          totalOutstanding: 250000,
          byStatus: { Paid: 25, Sent: 10 },
        },
        disbursements: {
          total: 40,
          totalAmount: 200000,
          releasedAmount: 180000,
          byStatus: { Released: 35, Pending: 5 },
        },
        transmittals: {
          total: 15,
          byStatus: { Delivered: 10, 'In Transit': 5 },
        },
        revenue: {
          totalBilled: 750000,
          totalCollected: 500000,
          totalOutstanding: 250000,
          totalExpenses: 180000,
          netIncome: 320000,
        },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      user: mockUser,
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view']),
    });
  });

  describe('Single Entity View (ATA or LTA)', () => {
    it('renders neutral financial summary band with revenue fields and complete peso formatting', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: singleEntityMock });
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('section-revenue')).toBeInTheDocument();
      });

      // Neutral financial summary cards
      expect(screen.getByTestId('summary-billed')).toHaveTextContent('₱1,250,000.00');
      expect(screen.getByTestId('summary-collected')).toHaveTextContent('₱950,000.00');
      expect(screen.getByTestId('summary-outstanding')).toHaveTextContent('₱300,000.00');
      expect(screen.getByTestId('summary-net-income')).toHaveTextContent('₱570,000.00');

      // Supporting expenses row beneath summary band
      expect(screen.getByText('Supporting expenses (disbursements)')).toBeInTheDocument();
      expect(screen.getAllByText('₱380,000.00').length).toBe(2); // In supporting expenses & disbursement released
    });

    it('renders compact record totals with tabular numerals and exact counts', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: singleEntityMock });
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('analytics-kpi-grid')).toBeInTheDocument();
      });

      expect(screen.getByTestId('kpi-clients')).toHaveTextContent('42');
      expect(screen.getByTestId('kpi-work-requests')).toHaveTextContent('128');
      expect(screen.getByTestId('kpi-documents')).toHaveTextContent('350');
      expect(screen.getByTestId('kpi-invoices')).toHaveTextContent('65');
      expect(screen.getByTestId('kpi-disbursements')).toHaveTextContent('80');
      expect(screen.getByTestId('kpi-transmittals')).toHaveTextContent('30');
    });

    it('renders horizontal progress bars and preserved amounts in status breakdowns', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: singleEntityMock });
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('analytics-bento-grid')).toBeInTheDocument();
      });

      // Billing Summary
      expect(screen.getByText('Billing Summary')).toBeInTheDocument();
      expect(screen.getByText('Paid')).toBeInTheDocument();
      expect(screen.getByText('45')).toBeInTheDocument();
      expect(screen.getByText('(69%)')).toBeInTheDocument(); // 45 / 65 ~ 69%
      expect(screen.getByText('Sent')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();

      // Disbursement Summary with preserved amounts
      expect(screen.getByText('Disbursement Summary')).toBeInTheDocument();
      expect(screen.getByText('Total recorded')).toBeInTheDocument();
      expect(screen.getByText('₱420,000.00')).toBeInTheDocument();
      expect(screen.getByText('Released amount')).toBeInTheDocument();
      expect(screen.getByText('Released')).toBeInTheDocument();
      expect(screen.getByText('70')).toBeInTheDocument();
      expect(screen.getByText('(88%)')).toBeInTheDocument(); // 70 / 80 ~ 88%

      // Transmittal Summary
      expect(screen.getByText('Transmittal Summary')).toBeInTheDocument();
      expect(screen.getByText('Delivered')).toBeInTheDocument();
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('(83%)')).toBeInTheDocument(); // 25 / 30 ~ 83%
    });

    it('renders genuine zero values as ₱0.00 or 0 without coercing to dash', async () => {
      const zeroMock = {
        clients: { total: 0 },
        workRequests: { total: 0 },
        documents: { total: 0 },
        invoices: {
          total: 0,
          totalBilled: 0,
          totalCollected: 0,
          totalOutstanding: 0,
          byStatus: {},
        },
        disbursements: {
          total: 0,
          totalAmount: 0,
          releasedAmount: 0,
          byStatus: {},
        },
        transmittals: {
          total: 0,
          byStatus: {},
        },
        revenue: {
          totalBilled: 0,
          totalCollected: 0,
          totalOutstanding: 0,
          totalExpenses: 0,
          netIncome: 0,
        },
      };

      vi.mocked(apiRequest).mockResolvedValueOnce({ data: zeroMock });
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('summary-billed')).toHaveTextContent('₱0.00');
      });

      expect(screen.getByTestId('summary-collected')).toHaveTextContent('₱0.00');
      expect(screen.getByTestId('summary-outstanding')).toHaveTextContent('₱0.00');
      expect(screen.getByTestId('summary-net-income')).toHaveTextContent('₱0.00');
      expect(screen.getByTestId('kpi-clients')).toHaveTextContent('0');
      expect(screen.getAllByText('No status data recorded').length).toBe(3);
    });
  });

  describe('Consolidated ALL Entity View (ALL)', () => {
    beforeEach(() => {
      useSessionStore.setState({ activeEntity: 'ALL' });
    });

    it('renders aligned 4-column comparison tables without gradient hero or sub-entity switcher', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: consolidatedMock });
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('consolidated-analytics-view')).toBeInTheDocument();
      });

      // Verify no redundant switcher exists
      expect(screen.queryByText('Side-by-Side')).not.toBeInTheDocument();
      expect(screen.queryByText('ATA Only')).not.toBeInTheDocument();
      expect(screen.queryByText('LTA Only')).not.toBeInTheDocument();

      // Verify no unverified long names exist
      expect(screen.queryByText('Asian Trade Alliance')).not.toBeInTheDocument();
      expect(screen.queryByText('Luzon Trade Alliance')).not.toBeInTheDocument();

      // Section titles
      expect(screen.getByText('Consolidated Enterprise Analytics')).toBeInTheDocument();
      expect(screen.getByText('Financial metrics')).toBeInTheDocument();
      expect(screen.getByText('Record totals')).toBeInTheDocument();
      expect(screen.getByText('Status comparisons')).toBeInTheDocument();

      // Financial metrics comparison
      // ATA billed: 1,250,000, LTA billed: 750,000, Combined: 2,000,000
      expect(screen.getByText('₱2,000,000.00')).toBeInTheDocument();
      // Combined net income: 570,000 + 320,000 = 890,000
      expect(screen.getByText('₱890,000.00')).toBeInTheDocument();

      // Accurate record counts labeling
      expect(screen.getByText('Combined Clients')).toBeInTheDocument();
      expect(
        screen.getAllByText('Summed entity records (not deduplicated customers)').length
      ).toBeGreaterThanOrEqual(1);
      // Combined clients = 42 + 18 = 60
      expect(screen.getByText('60')).toBeInTheDocument();
      // Combined work requests = 128 + 72 = 200
      expect(screen.getByText('200')).toBeInTheDocument();
    });

    it('renders status comparison tables for invoices, disbursements, and transmittals', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: consolidatedMock });
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Status comparisons')).toBeInTheDocument();
      });

      expect(screen.getByText('Invoices by status')).toBeInTheDocument();
      expect(screen.getByText('Disbursements by status & amounts')).toBeInTheDocument();
      expect(screen.getByText('Transmittals by status')).toBeInTheDocument();

      // Combined disbursement total recorded amount: 420,000 + 200,000 = 620,000
      expect(screen.getByText('₱620,000.00')).toBeInTheDocument();
      // Combined disbursement released amount: 380,000 + 180,000 = 560,000 (appears in revenue expenses & released disbursements)
      expect(screen.getAllByText('₱560,000.00').length).toBe(2);
    });
  });

  describe('Toolbar, States, and Interactions', () => {
    it('renders toolbar with scope badge and triggers refetch on refresh click', async () => {
      vi.mocked(apiRequest).mockResolvedValue({ data: singleEntityMock });
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('analytics-toolbar')).toBeInTheDocument();
      });

      const refreshBtn = screen.getByTestId('analytics-refresh-button');
      expect(refreshBtn).toBeInTheDocument();
      fireEvent.click(refreshBtn);

      // Verify second request dispatched
      await waitFor(() => {
        expect(apiRequest).toHaveBeenCalledTimes(2);
      });
    });

    it('renders loading skeleton when fetching', async () => {
      vi.mocked(apiRequest).mockReturnValue(new Promise(() => {})); // Never resolves
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      expect(screen.getByTestId('analytics-loading')).toBeInTheDocument();
    });

    it('renders error state with retry button on request failure', async () => {
      vi.mocked(apiRequest).mockRejectedValueOnce(new Error('Network connection timeout'));
      const { wrapper } = createHarness();
      render(<AnalyticsOverviewTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('analytics-error')).toBeInTheDocument();
      });

      expect(screen.getByText('Network connection timeout')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });
});
