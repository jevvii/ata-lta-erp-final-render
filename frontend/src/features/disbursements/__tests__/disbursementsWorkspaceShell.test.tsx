import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DisbursementsPage from '@/routes/disbursements';
import { useSessionStore } from '@/lib/session';

function createHarness(initialEntries = ['/disbursements']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
    </QueryClientProvider>
  );

  return { queryClient, wrapper };
}

describe('Disbursements Workspace Shell Integration (design/disb-02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();

    useSessionStore.getState().setSession({
      user: {
        id: 'usr-admin-1',
        email: 'admin@ata.ph',
        role: 'Admin',
        name: 'Admin Partner',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: new Set(['disbursement:view', 'disbursement:create', 'disbursement:approve']),
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const urlStr = String(url);
      if (urlStr.includes('/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              active: 12,
              awaitingRelease: 4,
              rejected: 2,
              archived: 8,
              initialRequests: 3,
              paymentReleases: 1,
              readyForFunding: 5,
              needsCorrection: 1,
            },
          }),
        });
      }
      if (urlStr.includes('/disbursements/disb-123')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              id: 'disb-123',
              disbursement_number: 'DISB-ATA-20261025-001',
              entity_id: 'ent-1',
              entity_code: 'ATA',
              category: 'Transportation',
              description: 'Client filing trip taxi receipt',
              amount: 1500,
              fund_source: 'Petty Cash',
              status: 'Approved',
              lifecycle_version: 2,
              review_ready: true,
              version: 1,
              created_at: new Date().toISOString(),
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: [],
          meta: { total: 0, page: 1, limit: 20 },
        }),
      });
    });
  });

  it('renders module header, queue bar, and multi-pane workspace layout', async () => {
    const { wrapper } = createHarness();
    render(<DisbursementsPage />, { wrapper });

    // Module header contract
    expect(screen.getByTestId('disbursements-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /disbursements & expenses/i })).toBeInTheDocument();
    expect(screen.getByTestId('disbursements-entity-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('page-new-disbursement-btn')).toBeInTheDocument();

    // Queue Bar
    expect(screen.getByTestId('disbursements-queue-bar')).toBeInTheDocument();
    expect(screen.getByTestId('queue-selector-segmented')).toBeInTheDocument();
    expect(screen.getByTestId('queue-selector-select')).toBeInTheDocument();

    // Workspace & Panes
    expect(screen.getByTestId('disbursement-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('disbursement-workspace-grid')).toBeInTheDocument();
    expect(screen.getByTestId('disbursement-workspace-detail')).toBeInTheDocument();
  });

  it('renders compact KPI chips with accurate counts and testids inside queue bar', async () => {
    const { wrapper } = createHarness();
    render(<DisbursementsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('kpi-active-count')).toHaveTextContent('12');
      expect(screen.getByTestId('kpi-awaiting-release-count')).toHaveTextContent('4');
      expect(screen.getByTestId('kpi-rejected-count')).toHaveTextContent('2');
      expect(screen.getByTestId('kpi-archived-count')).toHaveTextContent('8');
    });
  });

  it('preserves all queue tab triggers and testids with badge counts', async () => {
    const { wrapper } = createHarness();
    render(<DisbursementsPage />, { wrapper });

    expect(screen.getByTestId('tab-pending-approvals')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('badge-pending-approvals')).toHaveTextContent('4'); // 3 + 1
    });
    expect(screen.getByTestId('tab-all')).toBeInTheDocument();
    expect(screen.getByTestId('tab-drafts')).toBeInTheDocument();
    expect(screen.getByTestId('tab-approved')).toBeInTheDocument();
    expect(screen.getByTestId('tab-funded')).toBeInTheDocument();
    expect(screen.getByTestId('tab-released')).toBeInTheDocument();
    expect(screen.getByTestId('tab-rejected')).toBeInTheDocument();
    expect(screen.getByTestId('tab-archive')).toBeInTheDocument();
  });

  it('renders empty state in docked detail pane when no voucher is selected', () => {
    const { wrapper } = createHarness();
    render(<DisbursementsPage />, { wrapper });

    expect(screen.getByTestId('disbursement-detail-empty')).toBeInTheDocument();
    expect(screen.getByText('Select a voucher to see its details')).toBeInTheDocument();
  });

  it('renders docked voucher details when selected or via deep-link query param', async () => {
    const { wrapper } = createHarness(['/disbursements?disbursementId=disb-123']);
    render(<DisbursementsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('drawer-amount')).toHaveTextContent('₱1,500.00');
    });

    expect(screen.queryByTestId('disbursement-detail-empty')).not.toBeInTheDocument();
    expect(screen.getByText('DISB-ATA-20261025-001')).toBeInTheDocument();
  });

  it('toggles detail pane collapse and persists state in localStorage', () => {
    const { wrapper } = createHarness();
    render(<DisbursementsPage />, { wrapper });

    const toggleBtn = screen.getByTestId('disb-toggle-detail');
    expect(toggleBtn).toHaveTextContent('Hide details');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(localStorage.getItem('disb.detailCollapsed')).toBeNull();

    // Click to collapse
    fireEvent.click(toggleBtn);
    expect(localStorage.getItem('disb.detailCollapsed')).toBe('true');
    const collapsedBtn = screen.getByTestId('disb-toggle-detail');
    expect(collapsedBtn).toHaveTextContent('Show details');
    expect(collapsedBtn).toHaveAttribute('aria-expanded', 'false');

    // Click to re-expand
    fireEvent.click(collapsedBtn);
    expect(localStorage.getItem('disb.detailCollapsed')).toBe('false');
    const expandedBtn = screen.getByTestId('disb-toggle-detail');
    expect(expandedBtn).toHaveTextContent('Hide details');
    expect(expandedBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('restores collapsed state on initial load from localStorage', () => {
    localStorage.setItem('disb.detailCollapsed', 'true');
    const { wrapper } = createHarness();
    render(<DisbursementsPage />, { wrapper });

    const toggleBtn = screen.getByTestId('disb-toggle-detail');
    expect(toggleBtn).toHaveTextContent('Show details');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
  });

  it('falls back pending-approvals to all for unauthorized staff roles', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'usr-staff-1',
        email: 'staff@ata.ph',
        role: 'Staff',
        name: 'Staff Member',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: new Set(['disbursement:view']),
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness(['/disbursements?tab=pending-approvals']);
    render(<DisbursementsPage />, { wrapper });

    // Tab pending approvals should not exist for Staff
    expect(screen.queryByTestId('tab-pending-approvals')).not.toBeInTheDocument();
    // Grid displays All tab table
    expect(screen.getByTestId('tab-all')).toHaveAttribute('data-state', 'active');
  });

  it('renders drawer dialog on small screens (<1024px) when a voucher is selected', async () => {
    // Mock matchMedia for mobile (<1024px)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, // not >= 1024px
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { wrapper } = createHarness(['/disbursements?disbursementId=disb-123']);
    render(<DisbursementsPage />, { wrapper });

    // In mobile viewport (<1024px), DisbursementDetailDrawer opens with dialog
    await waitFor(() => {
      expect(screen.getByTestId('disbursement-detail-drawer')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-amount')).toHaveTextContent('₱1,500.00');
    });
  });
});
