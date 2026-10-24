/**
 * Challenger Test Suite: Domain Component Mounts & Supabase CDC Realtime Event Handling
 *
 * Authored by: teamwork_preview_challenger_m2_1
 * Role: critic / specialist
 * Milestone: M2 (Domain Mounts & Comprehensive Verification)
 *
 * Verifies:
 * 1. WorkRequestList renders and subscribes to `cdc_work_requests` and `cdc_tasks`.
 *    Incoming CDC UPDATE, INSERT, DELETE events dynamically update UI and TanStack cache.
 *    Task CDC events update nested phase structures and invalidate operation counts.
 *    Unmounting cleans up subscriptions with zero memory leaks.
 * 2. InvoiceList renders and subscribes to `cdc_invoices`.
 *    Incoming CDC UPDATE, INSERT, DELETE events update UI badges, totals, and TanStack cache.
 *    Unmounting cleans up subscriptions with zero memory leaks.
 * 3. DisbursementsTable renders and subscribes to `cdc_disbursements`.
 *    Incoming CDC UPDATE, INSERT, DELETE events update UI status badges and TanStack cache.
 *    Unmounting cleans up subscriptions with zero memory leaks.
 * 4. Multi-Component Multiplexing & Coexistence:
 *    Multiple mounted components share underlying channels without unmount collisions.
 *    Cross-channel isolation is preserved.
 * 5. Rapid Mount / Unmount Stress:
 *    Ensures zero dangling channels and zero memory leaks under rapid cycling.
 * 6. Safety Guards Integration:
 *    Tenant isolation, stale version rejection, and loop prevention drop events at component level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkRequestList } from '@/features/operations/components/WorkRequestList';
import { InvoiceList } from '@/features/billing/components/InvoiceList';
import { DisbursementsTable } from '@/features/disbursements/components/DisbursementsTable';
import { supabase, MockSupabaseClient, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { clearChannelRegistryForTesting } from '../useEntityRealtimeSync';
import { getTabId, resetTabIdForTesting } from '@/lib/tabSync';
import { clearLocalMutationsForTesting } from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';
import type { WorkRequest, Task } from '@/features/operations/api/types';
import type { Invoice } from '@/features/billing/api/types';
import type { Disbursement } from '@/features/disbursements/api/types';

// ============================================================================
// Fixtures & Helper Types
// ============================================================================

interface CachedItem {
  id: string;
  title?: string;
  status?: string;
  balance?: number;
  description?: string;
  phases?: Record<string, { tasks?: Array<{ id: string; title?: string }> }>;
}

type CachedList = { data?: CachedItem[] } | CachedItem[];

const mockInitialTask: Task = {
  id: 't-101',
  workRequestId: 'wr-101',
  title: 'Gather Articles of Inc',
  description: null,
  status: 'In Progress',
  phase: 'pre_processing',
  qaStatus: 'none',
  phaseEnteredAt: null,
  assigneeId: null,
  assigneeName: null,
  assignees: [],
  predecessors: [],
  dueDate: null,
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const initialWorkRequests: WorkRequest[] = [
  {
    id: 'wr-101',
    title: 'SEC GIS 2026 Filing',
    description: 'Annual corporate submission',
    clientId: 'c-1',
    clientName: 'Acme Corporation',
    entity: 'ATA',
    status: 'In Progress',
    phase: 'pre_processing',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'Urgent',
    requestedBy: null,
    assignedTo: 'u-mgr-1',
    assignedToName: 'Maria Santos',
    coAssignees: [],
    dueDate: new Date(Date.now() + 86400000 * 5).toISOString(),
    archived: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: [],
    phases: {
      pre_processing: {
        tasks: [mockInitialTask],
      },
      processing: {
        tasks: [],
      },
    },
  },
  {
    id: 'wr-102',
    title: 'BIR Form 1702-RT Filing',
    description: 'Corporate Annual Income Tax Return',
    clientId: 'c-2',
    clientName: 'Beta Holdings Inc',
    entity: 'LTA',
    status: 'Draft',
    phase: 'processing',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'Normal',
    requestedBy: null,
    assignedTo: 'u-mgr-1',
    assignedToName: 'Maria Santos',
    coAssignees: [],
    dueDate: new Date(Date.now() + 86400000 * 10).toISOString(),
    archived: false,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: [],
  },
];

const initialInvoices: Invoice[] = [
  {
    id: 'inv-201',
    entity_id: 'ent-ata',
    entity_code: 'ATA',
    invoice_number: 'ATA-SI-2026-0201',
    client_id: 'c-1',
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    status: 'Draft',
    subtotal: 25000,
    total: 25000,
    amount_paid: 0,
    balance: 25000,
    address: '100 Ayala Avenue, Makati',
    notes: 'Q4 Retainer billing',
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    version: 1,
    clients: {
      name: 'Acme Corporation',
      tin: '123-456-789-000',
      address: '100 Ayala Avenue, Makati',
    },
    line_items: [
      {
        id: 'li-201',
        description: 'Monthly Retainer',
        amount: 25000,
        type: 'Professional Fee',
      },
    ],
  },
];

const initialDisbursements: Disbursement[] = [
  {
    id: 'disb-301',
    disbursement_number: 'DISB-ATA-20261008-301',
    entity_id: 'ent-ata',
    category: 'Transportation',
    description: 'Grab express delivery to BIR RDO 47',
    amount: 450,
    fund_source: 'Firm Fund',
    status: 'Pending',
    linked_work_request_id: 'wr-101',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const mockClients = [
  { id: 'c-1', name: 'Acme Corporation', entity: 'ATA', status: 'Active' },
  { id: 'c-2', name: 'Beta Holdings Inc', entity: 'LTA', status: 'Active' },
];

const mockTeam = [
  { id: 'u-mgr-1', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Manager' },
  { id: 'u-admin-1', name: 'System Admin', email: 'admin@ata-lta.ph', role: 'Admin' },
];

// ============================================================================
// Test Setup Helpers
// ============================================================================

function createTestHarness() {
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

function setupGlobalFetchMock(
  workRequests: WorkRequest[] = initialWorkRequests,
  invoices: Invoice[] = initialInvoices,
  disbursements: Disbursement[] = initialDisbursements
) {
  return vi.fn().mockImplementation((url: string) => {
    const u = String(url);
    if (u.includes('/clients')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: mockClients }),
      } as Response);
    }
    if (u.includes('/me/team')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: mockTeam }),
      } as Response);
    }
    if (u.includes('/operations/work-requests')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: workRequests, meta: { total: workRequests.length } }),
      } as Response);
    }
    if (u.includes('/invoices') || u.includes('/billing')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: invoices,
          meta: { total: invoices.length, page: 1, limit: 25 },
          total: invoices.reduce((acc, i) => acc + (i.total || 0), 0),
          paid: invoices.filter((i) => i.status === 'Paid').length,
          pending: invoices.filter((i) => i.status === 'Pending').length,
          overdue: invoices.filter((i) => i.status === 'Overdue').length,
        }),
      } as Response);
    }
    if (u.includes('/disbursements')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: disbursements,
          meta: { total: disbursements.length, page: 1, limit: 20 },
        }),
      } as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response);
  });
}

function setupSession(activeEntity: string = 'ALL') {
  useSessionStore.getState().setSession({
    user: {
      id: 'u-mgr-1',
      email: 'maria@ata-lta.ph',
      name: 'Maria Santos',
      role: 'Admin',
      departments: ['Operations', 'Billing', 'Administration'],
      entities: ['ATA', 'LTA'],
    },
    permissions: [
      'workflow:view',
      'workflow:edit',
      'workflow:phase_transition',
      'billing:view',
      'billing:edit',
      'billing:payments',
      'disbursement:view',
      'disbursement:approve',
      'disbursement:mark_released',
    ],
    activeEntity,
  });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Challenger M2-1: Domain Component Mounts & Supabase CDC Realtime Sync', () => {
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('challenger-m2-tab-1');
    setupSession('ALL');
    useBlockingModalStore.getState().reset();
    global.fetch = setupGlobalFetchMock();
    await supabase.removeAllChannels();
  });

  afterEach(async () => {
    await supabase.removeAllChannels();
    clearChannelRegistryForTesting();
    clearLocalMutationsForTesting();
    localStorage.clear();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. WorkRequestList Mount & CDC Realtime Sync
  // ==========================================================================

  describe('1. WorkRequestList Realtime Mount & Subscription', () => {
    it('subscribes to both cdc_work_requests and cdc_tasks upon mounting', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { wrapper } = createTestHarness();

      const { unmount } = render(<WorkRequestList />, { wrapper });

      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');
      expect(channelSpy).toHaveBeenCalledWith('cdc_tasks');

      const mockClient = supabase as unknown as MockSupabaseClient;
      expect(mockClient.getChannel('cdc_work_requests')).toBeDefined();
      expect(mockClient.getChannel('cdc_tasks')).toBeDefined();

      unmount();
    });

    it('empirically updates UI and query cache when cdc_work_requests emits an UPDATE event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('SEC GIS 2026 Filing')).toBeInTheDocument();
      });

      const wrChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_work_requests'
      ) as MockRealtimeChannel;
      expect(wrChannel).toBeDefined();

      const baseWr = initialWorkRequests[0]!;
      const updatedWr: WorkRequest = {
        ...baseWr,
        title: 'SEC GIS 2026 Filing (Updated by Peer)',
        phase: 'processing',
        version: 2,
      };

      act(() => {
        wrChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: updatedWr,
          old: initialWorkRequests[0],
        });
      });

      // Verify UI reflects the updated title
      await waitFor(() => {
        expect(screen.getByText('SEC GIS 2026 Filing (Updated by Peer)')).toBeInTheDocument();
      });

      // Verify TanStack cache was patched
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: operationsKeys.workRequests(),
      });
      expect(cachedList.length).toBeGreaterThan(0);
      const foundInCache = cachedList.some(([, data]) => {
        const items = Array.isArray(data) ? data : data?.data;
        return items?.some(
          (item: CachedItem) =>
            item.id === 'wr-101' && item.title === 'SEC GIS 2026 Filing (Updated by Peer)'
        );
      });
      expect(foundInCache).toBe(true);
    });

    it('empirically renders newly inserted work request upon cdc_work_requests INSERT event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('SEC GIS 2026 Filing')).toBeInTheDocument();
      });

      const wrChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_work_requests'
      ) as MockRealtimeChannel;

      const newWr: WorkRequest = {
        id: 'wr-live-999',
        title: 'Urgent Court Appearance Work Request',
        description: 'Motion hearing preparation',
        clientId: 'c-1',
        clientName: 'Acme Corporation',
        entity: 'ATA',
        status: 'In Progress',
        phase: 'pre_processing',
        onHold: false,
        phaseEnteredAt: null,
        priority: 'Urgent',
        requestedBy: null,
        assignedTo: 'u-mgr-1',
        assignedToName: 'Maria Santos',
        coAssignees: [],
        dueDate: new Date().toISOString(),
        archived: false,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks: [],
      };

      act(() => {
        wrChannel.emit('postgres_changes', {
          eventType: 'INSERT',
          new: newWr,
          old: null,
        });
      });

      // Verify UI renders the newly inserted row
      await waitFor(() => {
        expect(screen.getByText('Urgent Court Appearance Work Request')).toBeInTheDocument();
        expect(screen.getByTestId('wr-row-wr-live-999')).toBeInTheDocument();
      });

      // Verify TanStack cache contains the new item prepended
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: operationsKeys.workRequests(),
      });
      const foundInCache = cachedList.some(([, data]) => {
        const items = Array.isArray(data) ? data : data?.data;
        return items?.[0]?.id === 'wr-live-999';
      });
      expect(foundInCache).toBe(true);
    });

    it('empirically removes deleted work request from UI and cache upon cdc_work_requests DELETE event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('wr-row-wr-101')).toBeInTheDocument();
      });

      const wrChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_work_requests'
      ) as MockRealtimeChannel;

      act(() => {
        wrChannel.emit('postgres_changes', {
          eventType: 'DELETE',
          old: { id: 'wr-101', version: 1 },
        });
      });

      // Verify UI row is removed
      await waitFor(() => {
        expect(screen.queryByTestId('wr-row-wr-101')).not.toBeInTheDocument();
      });

      // Verify TanStack cache no longer contains the deleted item
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: operationsKeys.workRequests(),
      });
      for (const [, data] of cachedList) {
        const items = Array.isArray(data) ? data : data?.data;
        expect(items?.some((item: CachedItem) => item.id === 'wr-101')).toBeFalsy();
      }
    });

    it('updates embedded tasks and invalidates operation counts when cdc_tasks emits an event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('SEC GIS 2026 Filing')).toBeInTheDocument();
      });

      const taskChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_tasks'
      ) as MockRealtimeChannel;
      expect(taskChannel).toBeDefined();

      act(() => {
        taskChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: {
            id: 't-101',
            work_request_id: 'wr-101',
            title: 'Gather Articles of Inc (Amended)',
            version: 2,
          },
          old: {
            id: 't-101',
            work_request_id: 'wr-101',
            version: 1,
          },
        });
      });

      // Assert that operation count queries were invalidated
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['operations', 'workRequests', 'counts'],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['operations', 'counts'],
      });

      // Assert embedded phase task was patched in the work request cache
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: operationsKeys.workRequests(),
      });
      const wrWithPatchedTask = cachedList.some(([, data]) => {
        const items = Array.isArray(data) ? data : data?.data;
        const wr = items?.find((item: CachedItem) => item.id === 'wr-101');
        return wr?.phases?.pre_processing?.tasks?.some(
          (t: { id: string; title?: string }) => t.id === 't-101' && t.title === 'Gather Articles of Inc (Amended)'
        );
      });
      expect(wrWithPatchedTask).toBe(true);
    });

    it('cleanly unsubscribes and removes channels when WorkRequestList unmounts', async () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');
      const { wrapper } = createTestHarness();

      const { unmount } = render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('SEC GIS 2026 Filing')).toBeInTheDocument();
      });

      unmount();

      expect(removeChannelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'realtime:cdc_work_requests' })
      );
      expect(removeChannelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'realtime:cdc_tasks' })
      );

      // Verify no dangling channels remain
      const mockClient = supabase as unknown as MockSupabaseClient;
      expect(mockClient.getChannel('cdc_work_requests')).toBeUndefined();
      expect(mockClient.getChannel('cdc_tasks')).toBeUndefined();
    });
  });

  // ==========================================================================
  // 2. InvoiceList Mount & CDC Realtime Sync
  // ==========================================================================

  describe('2. InvoiceList Realtime Mount & Subscription', () => {
    it('subscribes to cdc_invoices channel upon mounting', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { wrapper } = createTestHarness();

      const { unmount } = render(<InvoiceList />, { wrapper });

      expect(channelSpy).toHaveBeenCalledWith('cdc_invoices');
      const mockClient = supabase as unknown as MockSupabaseClient;
      expect(mockClient.getChannel('cdc_invoices')).toBeDefined();

      unmount();
    });

    it('empirically updates UI status and cache when cdc_invoices emits an UPDATE event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<InvoiceList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ATA-SI-2026-0201')).toBeInTheDocument();
        expect(screen.getByTestId('badge-status-draft')).toBeInTheDocument();
      });

      const invChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_invoices'
      ) as MockRealtimeChannel;

      const baseInv = initialInvoices[0]!;
      const updatedInvoice: Invoice = {
        ...baseInv,
        status: 'Paid',
        amount_paid: 25000,
        balance: 0,
        version: 2,
      };

      act(() => {
        invChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: updatedInvoice,
          old: initialInvoices[0],
        });
      });

      // Verify UI reflects the updated status badge
      await waitFor(() => {
        expect(screen.getByTestId('badge-status-paid')).toBeInTheDocument();
        expect(screen.queryByTestId('badge-status-draft')).not.toBeInTheDocument();
      });

      // Verify TanStack cache was patched
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: billingKeys.invoices(),
      });
      const foundInCache = cachedList.some(([, data]) => {
        const items = Array.isArray(data) ? data : data?.data;
        return items?.some(
          (item: CachedItem) => item.id === 'inv-201' && item.status === 'Paid' && item.balance === 0
        );
      });
      expect(foundInCache).toBe(true);
    });

    it('empirically renders newly inserted invoice upon cdc_invoices INSERT event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<InvoiceList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ATA-SI-2026-0201')).toBeInTheDocument();
      });

      const invChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_invoices'
      ) as MockRealtimeChannel;

      const newInvoice: Invoice = {
        id: 'inv-live-888',
        entity_id: 'ent-ata',
        entity_code: 'ATA',
        invoice_number: 'ATA-SI-2026-0888',
        client_id: 'c-1',
        issue_date: '2026-10-08',
        due_date: '2026-11-08',
        status: 'Sent',
        subtotal: 50000,
        total: 50000,
        amount_paid: 0,
        balance: 50000,
        address: '100 Ayala Avenue, Makati',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        clients: {
          name: 'Acme Corporation',
          tin: '123-456-789-000',
          address: '100 Ayala Avenue, Makati',
        },
        line_items: [],
      };

      act(() => {
        invChannel.emit('postgres_changes', {
          eventType: 'INSERT',
          new: newInvoice,
          old: null,
        });
      });

      // Verify new invoice row renders in UI
      await waitFor(() => {
        expect(screen.getByText('ATA-SI-2026-0888')).toBeInTheDocument();
        expect(screen.getByTestId('invoice-row-inv-live-888')).toBeInTheDocument();
      });

      // Verify TanStack cache contains the new item prepended
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: billingKeys.invoices(),
      });
      const foundInCache = cachedList.some(([, data]) => {
        const items = Array.isArray(data) ? data : data?.data;
        return items?.[0]?.id === 'inv-live-888';
      });
      expect(foundInCache).toBe(true);
    });

    it('empirically removes deleted invoice from UI and cache upon cdc_invoices DELETE event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<InvoiceList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('invoice-row-inv-201')).toBeInTheDocument();
      });

      const invChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_invoices'
      ) as MockRealtimeChannel;

      act(() => {
        invChannel.emit('postgres_changes', {
          eventType: 'DELETE',
          old: { id: 'inv-201', version: 1 },
        });
      });

      // Verify UI row is removed
      await waitFor(() => {
        expect(screen.queryByTestId('invoice-row-inv-201')).not.toBeInTheDocument();
      });

      // Verify TanStack cache no longer contains deleted invoice
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: billingKeys.invoices(),
      });
      for (const [, data] of cachedList) {
        const items = Array.isArray(data) ? data : data?.data;
        expect(items?.some((item: CachedItem) => item.id === 'inv-201')).toBeFalsy();
      }
    });

    it('cleanly unsubscribes and removes cdc_invoices channel on unmount', async () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');
      const { wrapper } = createTestHarness();

      const { unmount } = render(<InvoiceList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ATA-SI-2026-0201')).toBeInTheDocument();
      });

      unmount();

      expect(removeChannelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'realtime:cdc_invoices' })
      );

      const mockClient = supabase as unknown as MockSupabaseClient;
      expect(mockClient.getChannel('cdc_invoices')).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. DisbursementsTable Mount & CDC Realtime Sync
  // ==========================================================================

  describe('3. DisbursementsTable Realtime Mount & Subscription', () => {
    it('subscribes to cdc_disbursements channel upon mounting', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { wrapper } = createTestHarness();

      const { unmount } = render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, {
        wrapper,
      });

      expect(channelSpy).toHaveBeenCalledWith('cdc_disbursements');
      const mockClient = supabase as unknown as MockSupabaseClient;
      expect(mockClient.getChannel('cdc_disbursements')).toBeDefined();

      unmount();
    });

    it('empirically updates status badge and cache when cdc_disbursements emits an UPDATE event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('DISB-ATA-20261008-301')).toBeInTheDocument();
        const badge = screen.getByTestId('disbursement-status-badge');
        expect(badge).toBeInTheDocument();
        expect(badge.getAttribute('data-test-status')).toBe('pending');
      });

      const disbChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_disbursements'
      ) as MockRealtimeChannel;

      const baseDisb = initialDisbursements[0]!;
      const updatedDisbursement: Disbursement = {
        ...baseDisb,
        status: 'Approved',
        version: 2,
      };

      act(() => {
        disbChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: updatedDisbursement,
          old: initialDisbursements[0],
        });
      });

      // Verify UI badge reflects Approved
      await waitFor(() => {
        const badge = screen.getByTestId('disbursement-status-badge');
        expect(badge.getAttribute('data-test-status')).toBe('approved');
      });

      // Verify TanStack cache was patched
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: disbursementKeys.lists(),
      });
      const foundInCache = cachedList.some(([, data]) => {
        const items = Array.isArray(data) ? data : data?.data;
        return items?.some(
          (item: CachedItem) => item.id === 'disb-301' && item.status === 'Approved'
        );
      });
      expect(foundInCache).toBe(true);
    });

    it('empirically renders newly inserted disbursement upon cdc_disbursements INSERT event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('DISB-ATA-20261008-301')).toBeInTheDocument();
      });

      const disbChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_disbursements'
      ) as MockRealtimeChannel;

      const newDisbursement: Disbursement = {
        id: 'disb-live-777',
        disbursement_number: 'DISB-ATA-20261008-777',
        entity_id: 'ent-ata',
        category: 'Government Fee',
        description: 'SEC Certified True Copy Stamp Duty',
        amount: 1250,
        fund_source: 'Client Fund',
        status: 'Approved',
        linked_work_request_id: 'wr-101',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      act(() => {
        disbChannel.emit('postgres_changes', {
          eventType: 'INSERT',
          new: newDisbursement,
          old: null,
        });
      });

      // Verify UI renders new disbursement row
      await waitFor(() => {
        expect(screen.getByText('DISB-ATA-20261008-777')).toBeInTheDocument();
        expect(screen.getByTestId('disbursement-row-disb-live-777')).toBeInTheDocument();
      });

      // Verify TanStack cache contains the new item prepended
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: disbursementKeys.lists(),
      });
      const foundInCache = cachedList.some(([, data]) => {
        const items = Array.isArray(data) ? data : data?.data;
        return items?.[0]?.id === 'disb-live-777';
      });
      expect(foundInCache).toBe(true);
    });

    it('empirically removes deleted disbursement from UI and cache upon cdc_disbursements DELETE event', async () => {
      const { queryClient, wrapper } = createTestHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('disbursement-row-disb-301')).toBeInTheDocument();
      });

      const disbChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_disbursements'
      ) as MockRealtimeChannel;

      act(() => {
        disbChannel.emit('postgres_changes', {
          eventType: 'DELETE',
          old: { id: 'disb-301', version: 1 },
        });
      });

      // Verify UI row is removed
      await waitFor(() => {
        expect(screen.queryByTestId('disbursement-row-disb-301')).not.toBeInTheDocument();
      });

      // Verify TanStack cache no longer contains deleted disbursement
      const cachedList = queryClient.getQueriesData<CachedList>({
        queryKey: disbursementKeys.lists(),
      });
      for (const [, data] of cachedList) {
        const items = Array.isArray(data) ? data : data?.data;
        expect(items?.some((item: CachedItem) => item.id === 'disb-301')).toBeFalsy();
      }
    });

    it('cleanly unsubscribes and removes cdc_disbursements channel on unmount', async () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');
      const { wrapper } = createTestHarness();

      const { unmount } = render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, {
        wrapper,
      });

      await waitFor(() => {
        expect(screen.getByText('DISB-ATA-20261008-301')).toBeInTheDocument();
      });

      unmount();

      expect(removeChannelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'realtime:cdc_disbursements' })
      );

      const mockClient = supabase as unknown as MockSupabaseClient;
      expect(mockClient.getChannel('cdc_disbursements')).toBeUndefined();
    });
  });

  // ==========================================================================
  // 4. Multi-Component Multiplexing & Coexistence Stress
  // ==========================================================================

  describe('4. Multi-Component Multiplexing & Coexistence Stress', () => {
    it('shares underlying channel when multiple components subscribe to same table, teardown occurs only on last unmount', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');
      const { wrapper } = createTestHarness();

      // Mount first WorkRequestList
      const comp1 = render(<WorkRequestList />, { wrapper });
      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');
      await waitFor(() => {
        expect(screen.getByTestId('wr-row-wr-101')).toBeInTheDocument();
      });

      // Mount second WorkRequestList concurrently
      const comp2 = render(<WorkRequestList />, { wrapper });

      // supabase.channel('cdc_work_requests') should return existing channel without creating a duplicate
      const wrChannels = (supabase as unknown as MockSupabaseClient)
        .getChannels()
        .filter((c) => c.topic.includes('cdc_work_requests'));
      expect(wrChannels.length).toBe(1);

      // Unmount first component
      comp1.unmount();

      // Channel should NOT be removed because comp2 is still active
      expect(removeChannelSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'realtime:cdc_work_requests' })
      );
      expect((supabase as unknown as MockSupabaseClient).getChannel('cdc_work_requests')).toBeDefined();

      // Emit event: comp2 should still receive it
      const wrChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_work_requests'
      ) as MockRealtimeChannel;

      act(() => {
        wrChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { ...initialWorkRequests[0], title: 'Dual Mount Verification Title', version: 3 },
          old: initialWorkRequests[0],
        });
      });

      await waitFor(() => {
        expect(screen.getByText('Dual Mount Verification Title')).toBeInTheDocument();
      });

      // Unmount second component
      comp2.unmount();

      // Now channel should be cleanly removed
      expect(removeChannelSpy).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'realtime:cdc_work_requests' })
      );
      expect((supabase as unknown as MockSupabaseClient).getChannel('cdc_work_requests')).toBeUndefined();
    });

    it('concurrently mounts all 3 domain components with cross-channel isolation', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const renderedAll = render(
        <div>
          <WorkRequestList />
          <InvoiceList />
          <DisbursementsTable onSelectDisbursement={vi.fn()} />
        </div>,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('wr-row-wr-101')).toBeInTheDocument();
        expect(screen.getByTestId('invoice-row-inv-201')).toBeInTheDocument();
        expect(screen.getByTestId('disbursement-row-disb-301')).toBeInTheDocument();
      });

      const mockClient = supabase as unknown as MockSupabaseClient;
      const wrChannel = mockClient.getChannel('cdc_work_requests') as MockRealtimeChannel;
      const invChannel = mockClient.getChannel('cdc_invoices') as MockRealtimeChannel;
      const disbChannel = mockClient.getChannel('cdc_disbursements') as MockRealtimeChannel;

      expect(wrChannel).toBeDefined();
      expect(invChannel).toBeDefined();
      expect(disbChannel).toBeDefined();

      // Emit on cdc_invoices: should NOT modify work_requests or disbursements cache
      act(() => {
        invChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { ...initialInvoices[0], notes: 'Isolated Invoice Note Update', version: 3 },
          old: initialInvoices[0],
        });
      });

      // Work request and disbursement data remain intact
      const wrQueries = queryClient.getQueriesData<CachedList>({
        queryKey: operationsKeys.workRequests(),
      });
      const disbQueries = queryClient.getQueriesData<CachedList>({
        queryKey: disbursementKeys.lists(),
      });

      const wrList = wrQueries
        .map(([, data]) => (Array.isArray(data) ? data : data?.data))
        .find((items) => items?.some((i: CachedItem) => i.id === 'wr-101'));
      expect(wrList?.find((i: CachedItem) => i.id === 'wr-101')?.title).toBe('SEC GIS 2026 Filing');

      const disbList = disbQueries
        .map(([, data]) => (Array.isArray(data) ? data : data?.data))
        .find((items) => items?.some((i: CachedItem) => i.id === 'disb-301'));
      expect(disbList?.find((i: CachedItem) => i.id === 'disb-301')?.description).toBe(
        'Grab express delivery to BIR RDO 47'
      );

      // Unmount all
      renderedAll.unmount();

      // All channels should be cleanly removed
      expect(mockClient.getChannel('cdc_work_requests')).toBeUndefined();
      expect(mockClient.getChannel('cdc_tasks')).toBeUndefined();
      expect(mockClient.getChannel('cdc_invoices')).toBeUndefined();
      expect(mockClient.getChannel('cdc_disbursements')).toBeUndefined();
    });
  });

  // ==========================================================================
  // 5. Rapid Mount / Unmount Stress (Zero Leaks)
  // ==========================================================================

  describe('5. Rapid Mount / Unmount Stress (Zero Channel Leaks)', () => {
    it('survives 15 rapid consecutive mount/unmount cycles without channel leakage', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      for (let i = 0; i < 15; i++) {
        const { wrapper } = createTestHarness();
        const { unmount } = render(
          <div>
            <WorkRequestList />
            <InvoiceList />
            <DisbursementsTable onSelectDisbursement={vi.fn()} />
          </div>,
          { wrapper }
        );

        // Immediate unmount
        unmount();

        expect(mockClient.getChannels().length).toBe(0);
      }

      expect(mockClient.getChannels()).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 6. Safety Guards Integration in Mounted Components
  // ==========================================================================

  describe('6. Safety Guards Integration in Mounted Components', () => {
    it('Tenant Isolation Guard: drops cross-tenant CDC events when activeEntity is ATA', async () => {
      setupSession('ATA');
      const { queryClient, wrapper } = createTestHarness();

      render(<InvoiceList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('ATA-SI-2026-0201')).toBeInTheDocument();
      });

      const invChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_invoices'
      ) as MockRealtimeChannel;

      // Cross-tenant payload belonging to LTA
      act(() => {
        invChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: {
            id: 'inv-201',
            entity_id: 'ent-lta',
            entity_code: 'LTA',
            invoice_number: 'ATA-SI-2026-0201',
            status: 'Paid',
            version: 5,
          },
          old: initialInvoices[0],
        });
      });

      // UI should NOT update to Paid
      expect(screen.getByTestId('badge-status-draft')).toBeInTheDocument();
      expect(screen.queryByTestId('badge-status-paid')).not.toBeInTheDocument();

      // Cache should remain Draft
      const cached = queryClient.getQueriesData<CachedList>({
        queryKey: billingKeys.invoices(),
      });
      for (const [, data] of cached) {
        const items = Array.isArray(data) ? data : data?.data;
        const item = items?.find((i: CachedItem) => i.id === 'inv-201');
        if (item) {
          expect(item.status).toBe('Draft');
        }
      }
    });

    it('Stale Version Rejection Guard: drops duplicate INSERT and lower UPDATE, accepts equal UPDATE (SPEC-002)', async () => {
      const { wrapper } = createTestHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      await waitFor(() => {
        const badge = screen.getByTestId('disbursement-status-badge');
        expect(badge).toBeInTheDocument();
        expect(badge.getAttribute('data-test-status')).toBe('pending');
      });

      const disbChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_disbursements'
      ) as MockRealtimeChannel;

      // Duplicate INSERT with equal version (1) -> Guard 2 drops it
      act(() => {
        disbChannel.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            ...initialDisbursements[0],
            status: 'Approved',
            version: 1, // duplicate equal INSERT
          },
        });
      });

      // UI badge should remain Pending
      const badgeAfterEqualInsert = screen.getByTestId('disbursement-status-badge');
      expect(badgeAfterEqualInsert.getAttribute('data-test-status')).toBe('pending');

      // Lower version (0)
      act(() => {
        disbChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: {
            ...initialDisbursements[0],
            status: 'Approved',
            version: 0, // lower version
          },
          old: initialDisbursements[0],
        });
      });

      const badgeAfterLower = screen.getByTestId('disbursement-status-badge');
      expect(badgeAfterLower.getAttribute('data-test-status')).toBe('pending');

      // Equal version (1) UPDATE -> Guard 2 accepts under SPEC-002
      act(() => {
        disbChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: {
            ...initialDisbursements[0],
            status: 'Approved',
            version: 1, // equal version UPDATE
          },
          old: initialDisbursements[0],
        });
      });

      await waitFor(() => {
        const badgeAfterEqualUpdate = screen.getByTestId('disbursement-status-badge');
        expect(badgeAfterEqualUpdate.getAttribute('data-test-status')).toBe('approved');
      });
    });

    it('Loop Prevention Guard: drops events originated by the current browser tab', async () => {
      const currentTab = getTabId();
      const { wrapper } = createTestHarness();

      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('SEC GIS 2026 Filing')).toBeInTheDocument();
      });

      const wrChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_work_requests'
      ) as MockRealtimeChannel;

      // Event stamped with current tab ID
      act(() => {
        wrChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: {
            ...initialWorkRequests[0],
            title: 'Self-Originated Title Update',
            origin_tab_id: currentTab,
            version: 5,
          },
          old: initialWorkRequests[0],
        });
      });

      // UI should NOT update to self-originated title
      expect(screen.getByText('SEC GIS 2026 Filing')).toBeInTheDocument();
      expect(screen.queryByText('Self-Originated Title Update')).not.toBeInTheDocument();
    });

    it('for non-admin staff, triggers query invalidation rather than blind cache injection (SHARED-PROJECT-VISIBILITY-20261024)', async () => {
      // Set session to non-admin Staff
      useSessionStore.getState().setSession({
        user: {
          id: 'u-staff-1',
          email: 'staff@ata-lta.ph',
          name: 'Staff Member',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });

      const { queryClient, wrapper } = createTestHarness();
      window.fetch = setupGlobalFetchMock();

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('SEC GIS 2026 Filing')).toBeInTheDocument();
      });

      const wrChannel = (supabase as unknown as MockSupabaseClient).getChannel(
        'cdc_work_requests'
      ) as MockRealtimeChannel;

      act(() => {
        wrChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: {
            ...initialWorkRequests[0],
            title: 'Staff Should Invalidate Not Inject',
            version: 2,
          },
          old: initialWorkRequests[0],
        });
      });

      // Query invalidation must be called for work requests
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: operationsKeys.workRequestDetail('wr-101') })
      );
    });
  });
});
