import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ReportToolbar,
  ReportToolbarGroup,
  ReportSummaryBand,
  ReportSummaryCard,
  ReportSection,
  ReportTableContainer,
  ReportScopePrompt,
  ReportLoadingState,
  ReportErrorState,
  ReportEmptyState,
} from '../components';
import ReportsPage from '@/routes/reports';
import { useSessionStore } from '@/lib/session';

vi.mock('@/lib/api', () => ({
  apiRequest: vi.fn().mockResolvedValue({ data: {} }),
}));

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

describe('Shared Presentation Components', () => {
  describe('ReportToolbar & ReportToolbarGroup', () => {
    it('renders toolbar and aligned groups cleanly', () => {
      render(
        <ReportToolbar dataTestId="test-toolbar">
          <ReportToolbarGroup align="left">
            <span data-testid="left-control">Date Picker</span>
          </ReportToolbarGroup>
          <ReportToolbarGroup align="right">
            <button data-testid="right-btn">Refresh</button>
          </ReportToolbarGroup>
        </ReportToolbar>
      );

      expect(screen.getByTestId('test-toolbar')).toBeInTheDocument();
      expect(screen.getByTestId('left-control')).toBeInTheDocument();
      expect(screen.getByTestId('right-btn')).toBeInTheDocument();
    });
  });

  describe('ReportSummaryBand & ReportSummaryCard', () => {
    it('renders metric items with tabular numerals and sentence case labels', () => {
      const metrics = [
        { label: 'Total billed', value: '₱1,250,000.00', dataTestId: 'metric-billed' },
        { label: 'Total collected', value: '₱950,000.00', dataTestId: 'metric-collected' },
        {
          label: 'Outstanding balance',
          value: '₱300,000.00',
          attention: true,
          subtext: '5 overdue',
          dataTestId: 'metric-outstanding',
        },
      ];

      render(<ReportSummaryBand metrics={metrics} columns={3} />);

      const billed = screen.getByTestId('metric-billed');
      expect(billed).toHaveTextContent('Total billed');
      expect(billed).toHaveTextContent('₱1,250,000.00');

      const outstanding = screen.getByTestId('metric-outstanding');
      expect(outstanding).toHaveTextContent('5 overdue');
      // Attention styling
      expect(outstanding.className).toContain('border-warning-border');
    });

    it('renders ReportSummaryCard directly with custom subtext and attention indicator', () => {
      render(
        <ReportSummaryCard
          label="Custom Net Income"
          value="₱570,000.00"
          subtext="After operating expenses"
          attention={false}
          dataTestId="direct-card"
        />
      );

      const card = screen.getByTestId('direct-card');
      expect(card).toHaveTextContent('Custom Net Income');
      expect(card).toHaveTextContent('₱570,000.00');
      expect(card).toHaveTextContent('After operating expenses');
    });

    it('renders skeleton pulse cards in loading state', () => {
      render(<ReportSummaryBand isLoading={true} columns={4} />);
      expect(screen.getByTestId('report-summary-band-loading')).toBeInTheDocument();
    });
  });

  describe('ReportSection', () => {
    it('renders title, badge count, and custom actions', () => {
      render(
        <ReportSection
          title="Invoices Issued"
          badgeCount={12}
          action={<button>Export</button>}
          dataTestId="section-invoices"
        >
          <div>Table content</div>
        </ReportSection>
      );

      expect(screen.getByText('Invoices Issued')).toBeInTheDocument();
      expect(screen.getByTestId('section-invoices-badge')).toHaveTextContent('12');
      expect(screen.getByText('Export')).toBeInTheDocument();
      expect(screen.getByText('Table content')).toBeInTheDocument();
    });

    it('supports collapsible toggle with aria-expanded', () => {
      render(
        <ReportSection
          title="Collapsible Section"
          collapsible={true}
          defaultOpen={true}
          dataTestId="collapsible-section"
        >
          <div>Collapsible body</div>
        </ReportSection>
      );

      const toggleBtn = screen.getByRole('button', { name: /Collapse Collapsible Section/i });
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Collapsible body')).toBeInTheDocument();

      fireEvent.click(toggleBtn);
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Collapsible body')).not.toBeInTheDocument();
    });
  });

  describe('ReportTableContainer', () => {
    it('renders responsive overflow container with accessible role and minWidth', () => {
      render(
        <ReportTableContainer minWidth="min-w-[700px]" dataTestId="test-table-container">
          <table>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>INV-001</td>
                <td className="tabular-nums">₱5,000.00</td>
              </tr>
            </tbody>
          </table>
        </ReportTableContainer>
      );

      const container = screen.getByTestId('test-table-container');
      expect(container).toHaveAttribute('role', 'region');
      expect(container).toHaveAttribute('tabIndex', '0');
      expect(screen.getByText('INV-001')).toBeInTheDocument();
      expect(screen.getByText('₱5,000.00')).toBeInTheDocument();
    });
  });

  describe('ReportScopePrompt', () => {
    it('renders actionable Switch to ATA and Switch to LTA buttons', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const onSelect = vi.fn();

      render(
        <ReportScopePrompt
          message="Choose ATA or LTA to view this report"
          onSelectEntity={onSelect}
          dataTestId="custom-scope-prompt"
        />
      );

      expect(screen.getByText('Choose ATA or LTA to view this report')).toBeInTheDocument();
      expect(screen.getByText(/Single-Entity Scope Required:/i)).toBeInTheDocument();

      const ataBtn = screen.getByTestId('scope-prompt-btn-ata');
      fireEvent.click(ataBtn);
      expect(onSelect).toHaveBeenCalledWith('ATA');

      const ltaBtn = screen.getByTestId('scope-prompt-btn-lta');
      fireEvent.click(ltaBtn);
      expect(onSelect).toHaveBeenCalledWith('LTA');
    });

    it('defaults to updating session store when onSelectEntity is omitted', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });

      render(<ReportScopePrompt />);

      const ataBtn = screen.getByTestId('scope-prompt-btn-ata');
      fireEvent.click(ataBtn);
      expect(useSessionStore.getState().activeEntity).toBe('ATA');
    });
  });

  describe('ReportStates', () => {
    it('ReportLoadingState renders skeleton variations', () => {
      const { rerender } = render(<ReportLoadingState type="summary" columns={3} />);
      expect(screen.getByTestId('report-loading-state')).toBeInTheDocument();

      rerender(<ReportLoadingState type="table" rows={3} />);
      expect(screen.getByTestId('report-loading-state')).toBeInTheDocument();

      rerender(<ReportLoadingState type="full" />);
      expect(screen.getByTestId('report-loading-state')).toBeInTheDocument();
    });

    it('ReportErrorState renders error message and retry action', () => {
      const onRetry = vi.fn();
      render(
        <ReportErrorState
          title="Failed to load daily report"
          message="Server timed out"
          onRetry={onRetry}
          staleDataNotice={true}
        />
      );

      expect(screen.getByText('Failed to load daily report')).toBeInTheDocument();
      expect(screen.getByText('Server timed out')).toBeInTheDocument();
      expect(screen.getByText('Showing previously loaded data')).toBeInTheDocument();

      const retryBtn = screen.getByTestId('report-error-retry-btn');
      fireEvent.click(retryBtn);
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('ReportEmptyState renders title, description, and reset button', () => {
      const onReset = vi.fn();
      render(
        <ReportEmptyState
          title="No activity recorded"
          description="Try selecting a different date or clearing filters."
          onReset={onReset}
          resetLabel="Reset date"
        />
      );

      expect(screen.getByText('No activity recorded')).toBeInTheDocument();
      expect(
        screen.getByText('Try selecting a different date or clearing filters.')
      ).toBeInTheDocument();

      const resetBtn = screen.getByTestId('report-empty-reset-btn');
      expect(resetBtn).toHaveTextContent('Reset date');
      fireEvent.click(resetBtn);
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ReportsPage Redesigned Shell Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ATA',
      permissions: new Set(['reports:view', 'billing:view', 'workflow:view']),
      user: { id: 'u-1', email: 'admin@atalta.com', role: 'Admin' } as any,
    });
  });

  it('renders H1 "Reports" without BarChart3 decorative icon and has concise subtitle', async () => {
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

    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Reports');
    expect(
      screen.getByText('Review activity, balances, and pending items.')
    ).toBeInTheDocument();
  });

  it('supports URL tab alias ?tab=analytics mapping to overview without redirect loop', async () => {
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

    const overviewTrigger = screen.getByTestId('tab-trigger-overview');
    expect(overviewTrigger).toHaveAttribute('data-state', 'active');
  });

  it('renders brutalist active underline styling on active tab triggers', async () => {
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

    const dailyTrigger = screen.getByTestId('tab-trigger-daily');
    expect(dailyTrigger).toHaveAttribute('data-state', 'active');
    expect(dailyTrigger.className).toContain('data-[state=active]:border-b-2');
    expect(dailyTrigger.className).toContain('data-[state=active]:border-[#1D4ED8]');
    expect(dailyTrigger.className).toContain('data-[state=active]:text-[#1E40AF]');
  });

  it('renders ReportScopePrompt instead of detail tab when activeEntity is ALL on daily tab', async () => {
    useSessionStore.setState({
      activeEntity: 'ALL',
      permissions: new Set(['reports:view', 'billing:view', 'users:manage']),
      user: { id: 'u-1', email: 'admin@atalta.com', role: 'Admin' } as any,
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

    // Scope prompt must be rendered inside tab content
    expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
    expect(screen.getByText('Choose ATA or LTA to view this report')).toBeInTheDocument();
    expect(screen.getByTestId('scope-prompt-btn-ata')).toBeInTheDocument();
    expect(screen.getByTestId('scope-prompt-btn-lta')).toBeInTheDocument();

    // Switching to ATA immediately updates entity
    fireEvent.click(screen.getByTestId('scope-prompt-btn-ata'));
    expect(useSessionStore.getState().activeEntity).toBe('ATA');
  });

  it('renders ReportScopePrompt on weekly, monthly, and aging tabs when activeEntity is ALL', async () => {
    useSessionStore.setState({
      activeEntity: 'ALL',
      permissions: new Set(['reports:view', 'billing:view', 'users:manage']),
      user: { id: 'u-1', email: 'admin@atalta.com', role: 'Admin' } as any,
    });

    const { wrapper } = createHarness(['/reports?tab=aging']);
    render(
      <Routes>
        <Route path="/reports" element={<ReportsPage />} />
      </Routes>,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('reports-page')).toBeInTheDocument();
    });

    expect(screen.getByTestId('entity-all-warning')).toBeInTheDocument();
    expect(screen.getByText('Choose ATA or LTA to view this report')).toBeInTheDocument();
  });
});
