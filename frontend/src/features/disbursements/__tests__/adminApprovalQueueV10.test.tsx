import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminApprovalQueue } from '../components/AdminApprovalQueue';
import { useSessionStore } from '@/lib/session';
import type { Disbursement } from '../api/types';

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

describe('AdminApprovalQueue Governance & Reliability (F13 & F14 / R7 / V10)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const setAdminSession = () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
        entities: ['ATA'],
      },
      permissions: ['disbursement:view', 'disbursement:approve'],
      activeEntity: 'ATA',
    });
  };

  const setStaffSession = (userId = 'u-staff-1') => {
    useSessionStore.getState().setSession({
      user: {
        id: userId,
        email: 'staff@ata-lta.ph',
        name: 'Staff User',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });
  };

  describe('Requirement 1: Server queue predicates and v2 governance', () => {
    it('queries server queues initial_requests and payment_releases and displays actionable v2 vouchers', async () => {
      setAdminSession();
      const queriedQueues: string[] = [];

      const mockDraftActionable: Disbursement = {
        id: 'disb-draft-1',
        disbursement_number: 'DISB-ATA-DRAFT-001',
        entity_id: 'ent-1',
        category: 'Transportation',
        description: 'Actionable draft courier expense',
        amount: 250,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: '2026-10-18T10:00:00Z',
        updated_at: '2026-10-18T10:00:00Z',
      };

      const mockReturnedDraft: Disbursement = {
        id: 'disb-returned-1',
        disbursement_number: 'DISB-ATA-RET-001',
        entity_id: 'ent-1',
        category: 'Supplies',
        description: 'Returned draft awaiting requester correction',
        amount: 1500,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: false, // Must NOT enter actionable queue
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: '2026-10-18T09:00:00Z',
        updated_at: '2026-10-18T09:00:00Z',
      };

      const mockPaymentRelease: Disbursement = {
        id: 'disb-release-1',
        disbursement_number: 'DISB-ATA-REL-001',
        entity_id: 'ent-1',
        category: 'Government Fee',
        description: 'Funded voucher awaiting final release',
        amount: 3000,
        fund_source: 'Client Fund',
        status: 'Funded',
        lifecycle_version: 2,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: '2026-10-18T08:00:00Z',
        updated_at: '2026-10-18T08:00:00Z',
      };

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');
        if (queue) queriedQueues.push(queue);

        if (queue === 'initial_requests') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: [mockDraftActionable, mockReturnedDraft], meta: { total: 2 } }),
          };
        }
        if (queue === 'payment_releases') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: [mockPaymentRelease], meta: { total: 1 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], meta: { total: 0 } }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-draft-1')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-release-1')).toBeInTheDocument();
      });

      // Returned draft with review_ready=false must be excluded
      expect(screen.queryByTestId('pending-item-disb-returned-1')).not.toBeInTheDocument();

      expect(queriedQueues).toContain('initial_requests');
      expect(queriedQueues).toContain('payment_releases');
    });
  });

  it('lets the single Admin open approval for their own ready Draft', async () => {
    setAdminSession();
    const ownDraft: Disbursement = {
      id: 'admin-own-draft', disbursement_number: 'DISB-SELF-001', entity_id: 'ent-1', linked_work_request_id: '11111111-1111-1111-1111-111111111111',
      category: 'Supplies', description: 'Admin own expense', amount: 250, fund_source: 'Firm Fund',
      status: 'Draft', lifecycle_version: 2, review_ready: true, version: 1,
      created_by: 'u-admin-1', requested_by: 'u-admin-1',
      created_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-20T08:00:00Z',
    };
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const initial = String(url).includes('queue=initial_requests');
      return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ data: initial ? [ownDraft] : [], meta: { total: initial ? 1 : 0 } }) };
    });
    const { wrapper } = createHarness();
    render(<AdminApprovalQueue />, { wrapper });
    const approve = await screen.findByTestId('approve-btn-admin-own-draft');
    expect(approve).toBeEnabled();
    expect(screen.queryByTestId('duty-sep-own-admin-own-draft')).not.toBeInTheDocument();
    fireEvent.click(approve);
    expect(await screen.findByTestId('admin-approval-modal')).toBeInTheDocument();
    expect(screen.getByTestId('btn-confirm-approve')).toBeEnabled();
  });

  describe('Requirement 2: Role gating and duty separation', () => {
    it('strictly blocks staff from approval queue and allows accounting funds tracking', async () => {
      // 1. Staff role access -> Unauthorized
      setStaffSession('u-staff-42');
      const { wrapper: staffWrapper } = createHarness();
      const { unmount } = render(<AdminApprovalQueue />, { wrapper: staffWrapper });

      expect(screen.getByTestId('admin-approval-queue-unauthorized')).toBeInTheDocument();
      expect(screen.getByText(/Access Restricted/i)).toBeInTheDocument();
      unmount();

      // 2. Accounting role access -> Allowed funds tracking
      useSessionStore.getState().setSession({
        user: {
          id: 'u-acct-1',
          email: 'accounting@ata-lta.ph',
          name: 'Accounting User',
          role: 'Accounting',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:create'],
        activeEntity: 'ATA',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [], meta: { total: 0 } }),
      });

      const { wrapper: acctWrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper: acctWrapper });

      expect(screen.getByTestId('admin-approval-queue')).toBeInTheDocument();
      expect(screen.getByText(/Accounting Funds Tracking/i)).toBeInTheDocument();
    });
  });

  describe('Requirement 3: Queue pagination', () => {
    it('paginates 15 items with pageSize=10, controls navigation and resets on search', async () => {
      setAdminSession();

      const fifteenItems: Disbursement[] = Array.from({ length: 15 }, (_, i) => ({
        id: `disb-page-${i + 1}`,
        disbursement_number: `DISB-PAGE-${String(i + 1).padStart(3, '0')}`,
        entity_id: 'ent-1',
        category: 'Transportation',
        description: `Expense item number ${i + 1}`,
        amount: 100 * (i + 1),
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: new Date(Date.now() - i * 60000).toISOString(),
        updated_at: new Date(Date.now() - i * 60000).toISOString(),
      }));

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');
        if (queue === 'initial_requests') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: fifteenItems, meta: { total: 15 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], meta: { total: 0 } }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue pageSize={10} />, { wrapper });

      // Page 1: Items 1 to 10 visible, 11 to 15 not visible
      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-page-1')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-page-10')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('pending-item-disb-page-11')).not.toBeInTheDocument();

      // Verify page info & indicator
      expect(screen.getByTestId('queue-page-info')).toHaveTextContent('Showing 1–10 of 15');
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

      // Prev disabled on page 1, Next enabled
      const prevBtn = screen.getByTestId('queue-prev-page');
      const nextBtn = screen.getByTestId('queue-next-page');
      expect(prevBtn).toBeDisabled();
      expect(nextBtn).not.toBeDisabled();

      // Navigate to Page 2
      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-page-11')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-page-15')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('pending-item-disb-page-1')).not.toBeInTheDocument();

      // Verify page info on page 2
      expect(screen.getByTestId('queue-page-info')).toHaveTextContent('Showing 11–15 of 15');
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      expect(prevBtn).not.toBeDisabled();
      expect(nextBtn).toBeDisabled();

      // Navigate back to Page 1
      fireEvent.click(prevBtn);

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-page-1')).toBeInTheDocument();
      });
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

      // Typing in search input resets page to 1
      fireEvent.click(nextBtn);
      await waitFor(() => {
        expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
      });

      const searchInput = screen.getByTestId('pending-queue-search-input');
      fireEvent.change(searchInput, { target: { value: 'item number' } });

      await waitFor(() => {
        expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
      });
    });
  });

  describe('Requirement 4 (F4): Complete page traversal beyond 100 items per queue', () => {
    it('fetches all pages for queue with >100 records and enables search and access for the 101st record', async () => {
      setAdminSession();

      const totalItems = 105;
      const allItems: Disbursement[] = Array.from({ length: totalItems }, (_, i) => ({
        id: `disb-huge-${i + 1}`,
        disbursement_number: `DISB-HUGE-${String(i + 1).padStart(3, '0')}`,
        entity_id: 'ent-1',
        category: 'Legal Fee',
        description: `High-volume item ${i + 1}`,
        amount: 200,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        updated_at: new Date(Date.now() - i * 1000).toISOString(),
      }));

      const queriedUrls: string[] = [];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        queriedUrls.push(url);
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');
        const page = parseInt(u.searchParams.get('page') || '1', 10);
        const limit = parseInt(u.searchParams.get('limit') || '100', 10);

        if (queue === 'initial_requests') {
          const start = (page - 1) * limit;
          const pageData = allItems.slice(start, start + limit);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: pageData,
              meta: { total: totalItems, page, limit },
            }),
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], meta: { total: 0 } }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue pageSize={10} />, { wrapper });

      // Page 1 displays items 1 to 10
      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-huge-1')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-huge-10')).toBeInTheDocument();
      });

      // Total pages should be ceil(105 / 10) = 11
      expect(screen.getByText('Page 1 of 11')).toBeInTheDocument();
      expect(screen.getByTestId('queue-page-info')).toHaveTextContent('Showing 1–10 of 105');

      // Verify page traversal occurred during fetch
      const initialUrls = queriedUrls.filter((u) => u.includes('queue=initial_requests'));
      expect(initialUrls.some((u) => u.includes('page=1'))).toBe(true);
      expect(initialUrls.some((u) => u.includes('page=2'))).toBe(true);

      // Search for item 101 which was returned on server page 2
      const searchInput = screen.getByTestId('pending-queue-search-input');
      fireEvent.change(searchInput, { target: { value: 'item 101' } });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-huge-101')).toBeInTheDocument();
      });

      // Clear search and navigate directly to page 11 to verify items 101–105
      fireEvent.change(searchInput, { target: { value: '' } });
      await waitFor(() => {
        expect(screen.getByText('Page 1 of 11')).toBeInTheDocument();
      });

      const nextBtn = screen.getByTestId('queue-next-page');
      for (let p = 1; p < 11; p++) {
        fireEvent.click(nextBtn);
      }

      await waitFor(() => {
        expect(screen.getByText('Page 11 of 11')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-huge-101')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-huge-105')).toBeInTheDocument();
      });
      expect(screen.getByTestId('queue-page-info')).toHaveTextContent('Showing 101–105 of 105');
    });

    it('Requirement 5: default pageSize is 20 so 14 items fit on Page 1 without pagination bar', async () => {
      setAdminSession();

      const fourteenItems: Disbursement[] = Array.from({ length: 14 }, (_, i) => ({
        id: `disb-14-${i + 1}`,
        disbursement_number: `DISB-14-${i + 1}`,
        entity_id: 'ent-1',
        category: 'Transportation',
        description: `Item ${i + 1}`,
        amount: 250,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        updated_at: new Date(Date.now() - i * 1000).toISOString(),
      }));

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');
        if (queue === 'initial_requests') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: fourteenItems, meta: { total: 14 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], meta: { total: 0 } }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-14-1')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-14-14')).toBeInTheDocument();
      });

      // All 14 items fit on Page 1 because default pageSize = 20
      expect(screen.queryByTestId('queue-pagination-bar')).not.toBeInTheDocument();
    });

    it('Requirement 6: auto-switches activeTab to payment releases when initialCount is 0 and releaseCount > 0', async () => {
      setAdminSession();

      const releaseItems: Disbursement[] = [
        {
          id: 'disb-rel-1',
          disbursement_number: 'DISB-REL-01',
          entity_id: 'ent-1',
          category: 'Office Supplies',
          description: 'Payment release item 1',
          amount: 500,
          fund_source: 'Client Fund',
          status: 'Funded',
          lifecycle_version: 2,
          linked_work_request_id: '11111111-1111-1111-1111-111111111111',
          version: 2,
          created_at: '2026-10-20T10:00:00Z',
          updated_at: '2026-10-20T10:00:00Z',
        },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        if (u.pathname.includes('/counts')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                initialRequests: 0,
                paymentReleases: 1,
                readyForFunding: 0,
              },
            }),
          };
        }
        const queue = u.searchParams.get('queue');
        if (queue === 'payment_releases') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: releaseItems, meta: { total: 1 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], meta: { total: 0 } }),
        };
      });

      const onTabChange = vi.fn();
      const { wrapper } = createHarness();
      render(<AdminApprovalQueue onTabChange={onTabChange} />, { wrapper });

      await waitFor(() => {
        expect(onTabChange).toHaveBeenCalledWith('payment_releases');
      });

      // The Payment Releases subtab should be marked active
      const releaseSubtab = screen.getByTestId('queue-subtab-payment-releases');
      expect(releaseSubtab).toHaveClass('bg-surface');
      expect(screen.getByTestId('pending-item-disb-rel-1')).toBeInTheDocument();
    });
  });
});
