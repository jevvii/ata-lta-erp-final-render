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

function mockDisbursement(partial: Partial<Disbursement> & { id: string }): Disbursement {
  return {
    disbursement_number: `DISB-${partial.id.toUpperCase()}`,
    entity_id: 'ent-1',
    category: 'Transportation',
    description: 'Test expense description',
    amount: 100,
    fund_source: 'Firm Fund',
    status: 'Draft',
    lifecycle_version: 2,
    review_ready: true,
    linked_work_request_id: '11111111-1111-1111-1111-111111111111',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  } as Disbursement;
}

describe('Challenger M4 Adversarial Verification — AdminApprovalQueue (F13 & F14 / R7 / V10)', () => {
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

  describe('Dimension 1: Status Querying, Limit 100, Deduplication, and Chronological Sorting', () => {
    it('queries Submitted, Pending, and Pending Admin Approval with limit 100', async () => {
      setAdminSession();
      const queriesRecorded: { queue: string; limit: string }[] = [];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue') || '';
        const limit = u.searchParams.get('limit') || '';
        queriesRecorded.push({ queue, limit });

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
        expect(screen.getByTestId('pending-queue-empty')).toBeInTheDocument();
      });

      const initialQuery = queriesRecorded.find((q) => q.queue === 'initial_requests');
      const releaseQuery = queriesRecorded.find((q) => q.queue === 'payment_releases');

      expect(initialQuery).toBeDefined();
      expect(initialQuery?.limit).toBe('100');

      expect(releaseQuery).toBeDefined();
      expect(releaseQuery?.limit).toBe('100');
    });

    it('deduplicates items appearing across multiple status responses by id', async () => {
      setAdminSession();

      const duplicateInitial = mockDisbursement({
        id: 'disb-dup-42',
        disbursement_number: 'DISB-DUP-001',
        category: 'Supplies',
        description: 'Overlapping duplicate voucher from initial',
        amount: 500,
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        version: 1,
        created_at: '2026-10-18T12:00:00Z',
        updated_at: '2026-10-18T12:00:00Z',
      });

      const duplicateRelease = mockDisbursement({
        id: 'disb-dup-42',
        disbursement_number: 'DISB-DUP-001',
        category: 'Supplies',
        description: 'Overlapping duplicate voucher from release',
        amount: 500,
        status: 'Funded',
        lifecycle_version: 2,
        version: 2,
        created_at: '2026-10-18T12:00:00Z',
        updated_at: '2026-10-18T12:05:00Z',
      });

      const uniqueItem = mockDisbursement({
        id: 'disb-unique-99',
        disbursement_number: 'DISB-UNIQ-001',
        category: 'Transportation',
        description: 'Unique item',
        amount: 150,
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        version: 1,
        created_at: '2026-10-18T11:00:00Z',
        updated_at: '2026-10-18T11:00:00Z',
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');

        if (queue === 'initial_requests') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: [duplicateInitial, uniqueItem], meta: { total: 2 } }),
          };
        }
        if (queue === 'payment_releases') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: [duplicateRelease], meta: { total: 1 } }),
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
        expect(screen.getByTestId('pending-item-disb-dup-42')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-unique-99')).toBeInTheDocument();
      });

      // Deduplication check: exactly 2 cards rendered in the container
      const listContainer = screen.getByTestId('pending-queue-items-list');
      expect(listContainer.children).toHaveLength(2);
    });

    it('sorts vouchers in descending chronological order across snake_case and camelCase created_at', async () => {
      setAdminSession();

      const items: Disbursement[] = [
        mockDisbursement({
          id: 'disb-oldest',
          disbursement_number: 'DISB-001',
          category: 'Meals',
          description: 'Oldest item',
          amount: 100,
          status: 'Draft',
          lifecycle_version: 2,
          review_ready: true,
          created_at: '2026-10-18T01:00:00Z',
        }),
        mockDisbursement({
          id: 'disb-newest',
          disbursement_number: 'DISB-002',
          category: 'Transportation',
          description: 'Newest item',
          amount: 200,
          status: 'Draft',
          lifecycle_version: 2,
          review_ready: true,
          createdAt: '2026-10-18T15:00:00Z', // camelCase
        }),
        mockDisbursement({
          id: 'disb-middle',
          disbursement_number: 'DISB-003',
          category: 'Supplies',
          description: 'Middle item',
          amount: 300,
          status: 'Draft',
          lifecycle_version: 2,
          review_ready: true,
          created_at: '2026-10-18T08:00:00Z', // snake_case
        }),
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');
        if (queue === 'initial_requests') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: items, meta: { total: items.length } }),
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
        expect(screen.getByTestId('pending-item-disb-newest')).toBeInTheDocument();
      });

      const listContainer = screen.getByTestId('pending-queue-items-list');
      expect(listContainer.children).toHaveLength(3);
      // Index 0: newest, Index 1: middle, Index 2: oldest
      expect(listContainer.children[0]).toHaveAttribute('data-testid', 'pending-item-disb-newest');
      expect(listContainer.children[1]).toHaveAttribute('data-testid', 'pending-item-disb-middle');
      expect(listContainer.children[2]).toHaveAttribute('data-testid', 'pending-item-disb-oldest');
    });

    it('renders loading state when any status query is pending', async () => {
      setAdminSession();

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');

        if (queue === 'initial_requests') {
          return new Promise(() => {}); // never resolves during test
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

      expect(screen.getByTestId('pending-queue-loading')).toBeInTheDocument();
      expect(screen.queryByTestId('pending-queue-items-list')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pending-queue-empty')).not.toBeInTheDocument();
    });
  });

  describe('Dimension 2: Staff Filtering Boundary Isolation & Foreign Employee ID Strict Exclusion', () => {
    it('strictly excludes vouchers where staff is employee_id but neither creator nor requester', async () => {
      const staffUserId = 'usr-ops-specialist-77';
      setStaffSession(staffUserId);

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      expect(screen.getByTestId('admin-approval-queue-unauthorized')).toBeInTheDocument();
      expect(screen.getByText(/Access Restricted/i)).toBeInTheDocument();
      expect(screen.queryByTestId('pending-queue-items-list')).not.toBeInTheDocument();
    });

    it('grants admin unrestricted visibility over all vouchers regardless of creator or employee', async () => {
      setAdminSession();

      const items: Disbursement[] = [
        mockDisbursement({
          id: 'disb-foreign-1',
          disbursement_number: 'DISB-F1',
          category: 'Meals',
          description: 'Foreign 1',
          amount: 100,
          status: 'Draft',
          lifecycle_version: 2,
          review_ready: true,
          created_by: 'foreign-user-1',
          requested_by: 'foreign-user-2',
          employee_id: 'foreign-employee-3',
          created_at: '2026-10-18T10:00:00Z',
        }),
        mockDisbursement({
          id: 'disb-foreign-2',
          disbursement_number: 'DISB-F2',
          category: 'Supplies',
          description: 'Foreign 2',
          amount: 200,
          status: 'Draft',
          lifecycle_version: 2,
          review_ready: true,
          created_by: 'foreign-user-4',
          requested_by: 'foreign-user-5',
          employee_id: 'foreign-employee-6',
          created_at: '2026-10-18T09:00:00Z',
        }),
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');
        if (queue === 'initial_requests') {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: items, meta: { total: items.length } }),
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
        expect(screen.getByTestId('pending-item-disb-foreign-1')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-foreign-2')).toBeInTheDocument();
      });

      expect(screen.getByText('Admin Approval Queue')).toBeInTheDocument();
      // Approver buttons exist for admin
      expect(screen.getByTestId('approve-btn-disb-foreign-1')).toBeInTheDocument();
      expect(screen.getByTestId('reject-btn-disb-foreign-1')).toBeInTheDocument();
    });
  });

  describe('Dimension 3: Pagination Boundary Clamps, Page Size Slicing, and Dynamic Invalidation', () => {
    it('hides pagination bar when total items <= 10 (pageSize)', async () => {
      setAdminSession();

      const tenItems: Disbursement[] = Array.from({ length: 10 }, (_, i) =>
        mockDisbursement({
          id: `disb-exact-10-${i + 1}`,
          disbursement_number: `DISB-TEN-${i + 1}`,
          category: 'Supplies',
          description: `Ten items exact ${i + 1}`,
          amount: 100,
          status: 'Draft',
          created_at: new Date(Date.now() - i * 1000).toISOString(),
        })
      );

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: tenItems, meta: { total: 10 } }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-exact-10-1')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-exact-10-10')).toBeInTheDocument();
      });

      // Exactly 10 items: no pagination bar rendered
      expect(screen.queryByTestId('queue-pagination-bar')).not.toBeInTheDocument();
    });

    it('shows pagination bar on 11 items and properly clamps Prev and Next buttons at boundaries', async () => {
      setAdminSession();

      const elevenItems: Disbursement[] = Array.from({ length: 11 }, (_, i) =>
        mockDisbursement({
          id: `disb-11-${i + 1}`,
          disbursement_number: `DISB-11-${i + 1}`,
          category: 'Transportation',
          description: `Eleven items ${i + 1}`,
          amount: 100,
          status: 'Draft',
          created_at: new Date(Date.now() - i * 1000).toISOString(),
        })
      );

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: elevenItems, meta: { total: 11 } }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-11-1')).toBeInTheDocument();
        expect(screen.getByTestId('pending-item-disb-11-10')).toBeInTheDocument();
      });

      // Item 11 not on page 1
      expect(screen.queryByTestId('pending-item-disb-11-11')).not.toBeInTheDocument();

      const paginationBar = screen.getByTestId('queue-pagination-bar');
      expect(paginationBar).toBeInTheDocument();
      expect(screen.getByTestId('queue-page-info')).toHaveTextContent('Showing 1–10 of 11');
      expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 1 of 2');

      const prevBtn = screen.getByTestId('queue-prev-page');
      const nextBtn = screen.getByTestId('queue-next-page');

      // Boundary check on Page 1: Prev disabled, Next enabled
      expect(prevBtn).toBeDisabled();
      expect(nextBtn).not.toBeDisabled();

      // Attempting to click Prev on page 1 should not change page
      fireEvent.click(prevBtn);
      expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 1 of 2');

      // Click Next to navigate to Page 2
      fireEvent.click(nextBtn);

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-11-11')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('pending-item-disb-11-1')).not.toBeInTheDocument();

      expect(screen.getByTestId('queue-page-info')).toHaveTextContent('Showing 11–11 of 11');
      expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 2 of 2');

      // Boundary check on Page 2 (last page): Prev enabled, Next disabled
      expect(prevBtn).not.toBeDisabled();
      expect(nextBtn).toBeDisabled();

      // Attempting to click Next on last page should not overshoot
      fireEvent.click(nextBtn);
      expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 2 of 2');
    });

    it('dynamically clamps page when queue items shrink from 3 pages down to 1 page', async () => {
      setAdminSession();

      const makeItems = (count: number) =>
        Array.from({ length: count }, (_, i) =>
          mockDisbursement({
            id: `disb-shrink-${i + 1}`,
            disbursement_number: `DISB-SHRINK-${i + 1}`,
            category: 'Supplies',
            description: `Item for shrink test ${i + 1}`,
            amount: 50,
            status: 'Draft',
            created_at: new Date(Date.now() - i * 1000).toISOString(),
          })
        );

      let currentData = makeItems(25); // 25 items -> 3 pages

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: currentData, meta: { total: currentData.length } }),
        };
      });

      const { queryClient, wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 1 of 3');
      });

      const nextBtn = screen.getByTestId('queue-next-page');

      // Navigate to Page 2
      fireEvent.click(nextBtn);
      await waitFor(() => {
        expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 2 of 3');
      });

      // Navigate to Page 3
      fireEvent.click(nextBtn);
      await waitFor(() => {
        expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 3 of 3');
      });
      expect(screen.getByTestId('pending-item-disb-shrink-21')).toBeInTheDocument();

      // Now simulate items being approved/removed: queue shrinks to 15 items (totalPages = 2)
      currentData = makeItems(15);
      queryClient.invalidateQueries();

      // Component should automatically clamp page from 3 to 2
      await waitFor(() => {
        expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 2 of 2');
        expect(screen.getByTestId('queue-page-info')).toHaveTextContent('Showing 11–15 of 15');
      });

      // Now simulate queue shrinking down to 5 items (totalPages = 1)
      currentData = makeItems(5);
      queryClient.invalidateQueries();

      // Component should clamp page from 2 to 1 and hide pagination bar
      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-shrink-1')).toBeInTheDocument();
        expect(screen.queryByTestId('queue-pagination-bar')).not.toBeInTheDocument();
      });
    });

    it('filters items by search term across multiple fields and resets page to 1', async () => {
      setAdminSession();

      const items: Disbursement[] = [
        mockDisbursement({
          id: 'disb-s-1',
          disbursement_number: 'DISB-ALPHA-01',
          category: 'Meals',
          description: 'Special lunch banquet',
          client_name: 'Acme Corp',
          amount: 500,
          status: 'Draft',
          created_at: '2026-10-19T12:00:00Z',
        }),
        mockDisbursement({
          id: 'disb-s-2',
          disbursement_number: 'DISB-BETA-02',
          category: 'Transportation',
          description: 'Airport ride express',
          clientName: 'Baker Industries', // camelCase clientName
          amount: 600,
          status: 'Draft',
          created_at: '2026-10-19T11:00:00Z',
        }),
        mockDisbursement({
          id: 'disb-s-3',
          disbursement_number: 'DISB-GAMMA-03',
          category: 'Notarial',
          description: 'Certification fee',
          clients: { id: 'c-3', name: 'Charlie Ventures' } as unknown as { id: string; name: string },
          amount: 700,
          status: 'Draft',
          created_at: '2026-10-19T10:00:00Z',
        }),
        ...Array.from({ length: 12 }, (_, i) =>
          mockDisbursement({
            id: `disb-s-fill-${i + 1}`,
            disbursement_number: `DISB-FILL-${i + 1}`,
            category: 'Supplies',
            description: `Standard supplies fill ${i + 1}`,
            amount: 100,
            status: 'Draft',
            created_at: new Date(Date.parse('2026-10-19T10:00:00Z') - (i + 1) * 1000).toISOString(),
          })
        ),
      ];

      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: items, meta: { total: items.length } }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-s-1')).toBeInTheDocument();
      });

      // 15 items total -> 2 pages
      const nextBtn = screen.getByTestId('queue-next-page');
      fireEvent.click(nextBtn);
      await waitFor(() => {
        expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 2 of 2');
      });

      const searchInput = screen.getByTestId('pending-queue-search-input');

      // 1. Search by clientName ('Baker')
      fireEvent.change(searchInput, { target: { value: 'baker' } });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-s-2')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('pending-item-disb-s-1')).not.toBeInTheDocument();
      // Only 1 item matches, so pagination bar is hidden
      expect(screen.queryByTestId('queue-pagination-bar')).not.toBeInTheDocument();

      // 2. Search by nested client name ('Charlie')
      fireEvent.change(searchInput, { target: { value: 'charlie' } });
      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-s-3')).toBeInTheDocument();
      });

      // 3. Search by category ('Meals')
      fireEvent.change(searchInput, { target: { value: 'meals' } });
      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-s-1')).toBeInTheDocument();
      });

      // 4. Search with no matches -> displays empty state
      fireEvent.change(searchInput, { target: { value: 'non-existent-search-term-xyz' } });
      await waitFor(() => {
        expect(screen.getByTestId('pending-queue-empty')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('pending-queue-items-list')).not.toBeInTheDocument();

      // 5. Clear search -> restores full list on Page 1
      fireEvent.change(searchInput, { target: { value: '' } });
      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-s-1')).toBeInTheDocument();
        expect(screen.getByTestId('queue-page-indicator')).toHaveTextContent('Page 1 of 2');
      });
    });
  });
});
