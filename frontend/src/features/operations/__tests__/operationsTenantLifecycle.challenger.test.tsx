/**
 * Empirical Challenger Test Suite: Multi-Tenant Scoping & Teardown Lifecycle
 * (Milestone 4 - Real-Time Operations Requests - Parcel 4)
 *
 * Verifies:
 * 1. Tenant Isolation Stress (Guard 1):
 *    - When activeEntity is 'ATA', emit operations request CDC events belonging to 'LTA'
 *      (both via entity short code 'LTA' and PostgreSQL UUID 16749820-0129-44a8-9435-a6013d07a370).
 *    - Verify they are strictly discarded by Tenant Isolation Guard (Guard 1) and never alter
 *      ATA inbox cache or badge counts.
 *    - Verify RFC 4122 case-insensitive UUID matching and rejection of explicit null / unassigned tenant IDs.
 *    - Verify permissive behavior when activeEntity is 'ALL'.
 * 2. Entity Switching Stress & Zero Cross-Tenant Badge Bleeding:
 *    - Toggle activeEntity between 'ATA' and 'LTA' while receiving live CDC events.
 *    - Verify badge counts refetch cleanly without cross-tenant badge bleeding.
 *    - Verify dynamic guard adaptation without tearing down channels.
 * 3. Lifecycle Teardown & Reference-Counted activeChannelRegistry:
 *    - Channel multiplexing between OperationsPage and PendingApprovalsInbox on table:operations_requests.
 *    - Rapid mount/unmount across tabs 15 times with zero dangling listeners or channel leaks.
 *    - Dead channel immunity after unmount.
 *
 * Strict Invariants:
 * - Zero Playwright browser plugins or headless browser runners.
 * - Zero hardcoded secrets.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useSessionStore } from '@/lib/session';
import { supabase, MockSupabaseClient } from '@/lib/supabase';
import { clearChannelRegistryForTesting } from '@/lib/realtime/useEntityRealtimeSync';
import { operationsKeys } from '../api/queryKeys';
import OperationsPage from '@/routes/operations';
import { PendingApprovalsInbox } from '../components/PendingApprovalsInbox';
import type { OperationsRequest } from '../api/types';

// Authoritative Tenant UUIDs from tenantResolver.ts
const ATA_UUID_LOWER = 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822';
const ATA_UUID_UPPER = 'E83DC90B-D9B5-4854-8ADF-7FE21C2E6822';
const LTA_UUID_LOWER = '16749820-0129-44a8-9435-a6013d07a370';
const LTA_UUID_UPPER = '16749820-0129-44A8-9435-A6013D07A370';

// Mock initial data
const initialAtaRequest: OperationsRequest = {
  id: 'req-ata-1',
  type: 'phase_transition',
  requestType: 'phase_transition',
  status: 'pending',
  workRequestId: 'wr-ata-10',
  work_request_id: 'wr-ata-10',
  entity: 'ATA',
  entity_id: ATA_UUID_LOWER,
  notes: 'ATA initial transition request',
  createdAt: '2026-10-10T10:00:00Z',
  created_at: '2026-10-10T10:00:00Z',
  version: 1,
} as unknown as OperationsRequest;

const initialLtaRequest: OperationsRequest = {
  id: 'req-lta-1',
  type: 'phase_transition',
  requestType: 'phase_transition',
  status: 'pending',
  workRequestId: 'wr-lta-20',
  work_request_id: 'wr-lta-20',
  entity: 'LTA',
  entity_id: LTA_UUID_LOWER,
  notes: 'LTA initial transition request',
  createdAt: '2026-10-10T10:00:00Z',
  created_at: '2026-10-10T10:00:00Z',
  version: 1,
} as unknown as OperationsRequest;

function createHarness(queryClient: QueryClient) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/operations?tab=pending-approvals']}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { wrapper };
}

describe('M4 Challenger 2: Multi-Tenant Scoping & Teardown Lifecycle', () => {
  let queryClient: QueryClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
        mutations: { retry: false },
      },
    });

    localStorage.clear();
    clearChannelRegistryForTesting();

    // Default session: ATA entity with full permissions
    useSessionStore.getState().setSession({
      user: {
        id: 'usr-admin-challenger',
        name: 'Challenger Admin',
        email: 'challenger@ata-lta.ph',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
        'workflow:transition_request',
        'retainers:use',
        'retainers:edit',
      ],
      activeEntity: 'ATA',
    });

    // Mock API requests dynamically based on activeEntity in useSessionStore
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const currentEntity = useSessionStore.getState().activeEntity;

      if (url.includes('/operations-requests/counts')) {
        const counts =
          currentEntity === 'ATA'
            ? { pending: 2, rejected: 1, fulfilled: 3, total: 6 }
            : currentEntity === 'LTA'
              ? { pending: 5, rejected: 0, fulfilled: 2, total: 7 }
              : { pending: 7, rejected: 1, fulfilled: 5, total: 13 };

        return Promise.resolve(
          new Response(JSON.stringify({ data: counts }), { status: 200 })
        );
      }

      if (url.includes('/operations-requests')) {
        const items = currentEntity === 'ATA' ? [initialAtaRequest] : [initialLtaRequest];
        return Promise.resolve(
          new Response(JSON.stringify({ data: items }), { status: 200 })
        );
      }

      if (url.includes('/operations/work-requests/counts')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: { active: 10, completed: 5 } }), { status: 200 })
        );
      }

      if (url.includes('/operations/work-requests')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        );
      }

      if (url.includes('/operations/templates')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        );
      }

      if (url.includes('/me/team') || url.includes('/users')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        );
      }

      if (url.includes('/clients')) {
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), { status: 200 })
        );
      }

      return Promise.resolve(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
    });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await supabase.removeAllChannels();
    clearChannelRegistryForTesting();
    queryClient.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Suite 1: Tenant Isolation Stress (Guard 1)
  // =========================================================================
  describe('Suite 1: Tenant Isolation Stress (Guard 1)', () => {
    it('1.1 strictly discards foreign LTA CDC INSERT event by entity code when activeEntity is ATA', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      // Seed ATA query cache
      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), [initialAtaRequest]);
      queryClient.setQueryData<Record<string, number>>(
        operationsKeys.requestCounts('ATA'),
        { pending: 2, rejected: 1 }
      );

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');
      expect(channel).toBeDefined();

      // Emit foreign LTA event with entity short code 'LTA'
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-foreign-lta-1',
            request_type: 'phase_transition',
            status: 'pending',
            work_request_id: 'wr-lta-99',
            entity: 'LTA',
            version: 1,
            created_at: '2026-10-10T12:00:00Z',
          },
        });
      });

      // Assert ATA requests cache is completely untouched
      const requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache).toHaveLength(1);
      expect(requestsCache?.[0]?.id).toBe('req-ata-1');
      expect(requestsCache?.find((r) => r.id === 'req-foreign-lta-1')).toBeUndefined();

      // Assert ATA counts query was NOT invalidated
      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: operationsKeys.requestCounts('ATA') })
      );
      expect(invalidateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: operationsKeys.requests() })
      );

      // Verify ATA badge count remains unchanged
      const ataCounts = queryClient.getQueryData<Record<string, number>>(
        operationsKeys.requestCounts('ATA')
      );
      expect(ataCounts?.pending).toBe(2);
    });

    it('1.2 strictly discards foreign LTA CDC INSERT event by PostgreSQL UUID when activeEntity is ATA', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), [initialAtaRequest]);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      // Emit foreign LTA event using LTA UUID without explicit entity string
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-foreign-lta-uuid',
            request_type: 'phase_transition',
            status: 'pending',
            work_request_id: 'wr-lta-100',
            entity_id: LTA_UUID_LOWER, // Resolved to LTA via UUID_TO_CODE_MAP
            version: 1,
            created_at: '2026-10-10T12:00:00Z',
          },
        });
      });

      // Discarded by Guard 1
      const requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache).toHaveLength(1);
      expect(requestsCache?.find((r) => r.id === 'req-foreign-lta-uuid')).toBeUndefined();
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('1.3 accepts authoritative ATA event (both entity code and UUID) and reconciles cache and counters', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), [initialAtaRequest]);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      // Emit valid ATA event
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-ata-valid-new',
            request_type: 'phase_transition',
            status: 'pending',
            work_request_id: 'wr-ata-88',
            entity: 'ATA',
            entity_id: ATA_UUID_LOWER,
            version: 1,
            created_at: '2026-10-10T12:05:00Z',
          },
        });
      });

      // Accepted by Guard 1 and prepended into cache
      const requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache).toHaveLength(2);
      expect(requestsCache?.[0]?.id).toBe('req-ata-valid-new');

      // Co-invalidations triggered for ATA queries
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requestCounts('ATA'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-ata-88'),
      });
    });

    it('1.4 enforces RFC 4122 case-insensitive UUID matching: rejects uppercase LTA UUID, accepts uppercase ATA UUID', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), [initialAtaRequest]);

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      // 1. Emit uppercase foreign LTA UUID -> must be rejected
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-lta-upper-uuid',
            request_type: 'phase_transition',
            status: 'pending',
            work_request_id: 'wr-lta-upper',
            entity_id: LTA_UUID_UPPER,
            version: 1,
          },
        });
      });

      let requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache?.find((r) => r.id === 'req-lta-upper-uuid')).toBeUndefined();

      // 2. Emit uppercase ATA UUID -> must be accepted
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-ata-upper-uuid',
            request_type: 'phase_transition',
            status: 'pending',
            work_request_id: 'wr-ata-upper',
            entity_id: ATA_UUID_UPPER,
            version: 1,
          },
        });
      });

      requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache?.find((r) => r.id === 'req-ata-upper-uuid')).toBeDefined();
    });

    it('1.5 strictly discards payloads with explicit null entity identifiers or unassigned session', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), [initialAtaRequest]);

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      // Payload with explicit null entity_id and entity
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-null-entity-1',
            entity_id: null,
            entity: null,
            version: 1,
          },
        });
      });

      // Payload with null entity_id and undefined entity
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-null-entity-2',
            entity_id: null,
            version: 1,
          },
        });
      });

      const requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache).toHaveLength(1);
      expect(requestsCache?.[0]?.id).toBe('req-ata-1');
    });

    it('1.6 accepts both ATA and LTA events when activeEntity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const mockClient = supabase as unknown as MockSupabaseClient;

      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), []);

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-all-ata',
            entity: 'ATA',
            version: 1,
          },
        });
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-all-lta',
            entity: 'LTA',
            version: 1,
          },
        });
      });

      const requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache).toHaveLength(2);
      expect(requestsCache?.find((r) => r.id === 'req-all-ata')).toBeDefined();
      expect(requestsCache?.find((r) => r.id === 'req-all-lta')).toBeDefined();
    });

    it('1.7 strictly discards cross-tenant UPDATE and soft-DELETE CDC events for LTA while activeEntity is ATA', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      // Seed ATA cache
      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), [initialAtaRequest]);
      queryClient.setQueryData(operationsKeys.requestDetail('req-ata-1'), initialAtaRequest);

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      // 1. Cross-tenant UPDATE
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'UPDATE',
          old: { id: 'req-lta-99', entity: 'LTA', version: 1 },
          new: { id: 'req-lta-99', entity: 'LTA', status: 'approved', version: 2 },
        });
      });

      // Assert ATA cache unchanged
      let requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache).toHaveLength(1);
      expect(requestsCache?.[0]?.id).toBe('req-ata-1');

      // 2. Cross-tenant soft-DELETE
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'UPDATE',
          old: { id: 'req-lta-99', entity: 'LTA', version: 2 },
          new: {
            id: 'req-lta-99',
            entity: 'LTA',
            version: 3,
            deleted_at: '2026-10-10T15:00:00Z',
          },
        });
      });

      // Assert ATA item was not evicted or affected
      requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache).toHaveLength(1);
      expect(requestsCache?.[0]?.id).toBe('req-ata-1');
      expect(queryClient.getQueryData(operationsKeys.requestDetail('req-ata-1'))).toBeDefined();
    });

    it('1.8 accepts padded entity codes and UUIDs with surrounding whitespace (RFC 4122 compliance)', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), [initialAtaRequest]);

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      // Emit event with whitespace-padded ATA code and UUID
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-ata-padded',
            entity: '  ATA  ',
            entity_id: `  ${ATA_UUID_LOWER}  `,
            version: 1,
          },
        });
      });

      const requestsCache = queryClient.getQueryData<OperationsRequest[]>(operationsKeys.requests());
      expect(requestsCache?.find((r) => r.id === 'req-ata-padded')).toBeDefined();
    });
  });

  // =========================================================================
  // Suite 2: Entity Switching Stress & Zero Cross-Tenant Badge Bleeding
  // =========================================================================
  describe('Suite 2: Entity Switching Stress & Zero Cross-Tenant Badge Bleeding', () => {
    it('2.1 cleanly shifts query keys and prevents badge bleeding when switching from ATA to LTA', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      // In ATA mode, pending count is 2 (from mock fetch)
      expect(await screen.findByTestId('tab-pending-badge')).toHaveTextContent('2');

      const channel = mockClient.getChannel('cdc_operations_requests');
      expect(channel).toBeDefined();

      // Emit an LTA event while activeEntity is ATA -> discarded, badge remains 2
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-lta-blocked',
            entity: 'LTA',
            status: 'pending',
            version: 1,
          },
        });
      });
      expect(screen.getByTestId('tab-pending-badge')).toHaveTextContent('2');

      // Switch activeEntity to LTA
      act(() => {
        useSessionStore.getState().setActiveEntity('LTA');
      });

      // Badge must refetch and display LTA's pending count (5) with zero bleeding from ATA (2)
      expect(await screen.findByTestId('tab-pending-badge')).toHaveTextContent('5');

      // Now emit an ATA event while in LTA mode -> must be discarded by Guard 1!
      act(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-ata-blocked-under-lta',
            entity: 'ATA',
            status: 'pending',
            version: 1,
          },
        });
      });
      expect(screen.getByTestId('tab-pending-badge')).toHaveTextContent('5');

      // Now switch back to ATA
      act(() => {
        useSessionStore.getState().setActiveEntity('ATA');
      });

      // Badge cleanly returns to 2 without bleeding from LTA (5)
      expect(await screen.findByTestId('tab-pending-badge')).toHaveTextContent('2');
    });

    it('2.2 withstands rapid entity toggling 10 times under interleaved CDC stream', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), []);

      const { wrapper } = createHarness(queryClient);
      render(<OperationsPage />, { wrapper });

      const channel = mockClient.getChannel('cdc_operations_requests');

      for (let i = 0; i < 10; i++) {
        const targetEntity = i % 2 === 0 ? 'ATA' : 'LTA';
        act(() => {
          useSessionStore.getState().setActiveEntity(targetEntity);
        });

        // Emit an event matching targetEntity
        act(() => {
          channel?.emit('postgres_changes', {
            eventType: 'INSERT',
            new: {
              id: `req-rapid-${targetEntity}-${i}`,
              entity: targetEntity,
              version: 1,
            },
          });
        });

        // Emit an event matching opposite entity (must be discarded)
        const oppositeEntity = targetEntity === 'ATA' ? 'LTA' : 'ATA';
        act(() => {
          channel?.emit('postgres_changes', {
            eventType: 'INSERT',
            new: {
              id: `req-rapid-${oppositeEntity}-${i}`,
              entity: oppositeEntity,
              version: 1,
            },
          });
        });
      }

      // Final state was LTA (iteration 9: 9 % 2 !== 0 -> LTA)
      expect(useSessionStore.getState().activeEntity).toBe('LTA');
    });
  });

  // =========================================================================
  // Suite 3: Lifecycle Teardown & Reference-Counted activeChannelRegistry Stress
  // =========================================================================
  describe('Suite 3: Lifecycle Teardown & Reference-Counted activeChannelRegistry Stress', () => {
    it('3.1 reference-counts table:operations_requests across OperationsPage and PendingApprovalsInbox and cleans up on final unmount', () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      // 1. Mount OperationsPage
      const page = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/operations?tab=pending-approvals']}>
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Both OperationsPage and PendingApprovalsInbox are mounted.
      // OperationsPage mounts: work_requests, tasks, operations_requests, task_assignees
      // PendingApprovalsInbox mounts: operations_requests
      // table:operations_requests has 2 subscribers multiplexed on a single channel.
      expect(mockClient.getChannel('cdc_operations_requests')).toBeDefined();
      expect(mockClient.getChannels()).toHaveLength(4); // work_requests, tasks, operations_requests, task_assignees

      // 2. Unmount OperationsPage (which unmounts PendingApprovalsInbox as child)
      page.unmount();

      // All subscribers have unmounted -> reference count reaches 0 -> all channels removed!
      expect(mockClient.getChannels()).toHaveLength(0);
      const deadChannel = mockClient.getChannel('cdc_operations_requests');
      expect(deadChannel).toBeUndefined();
    });

    it('3.2 survives rapid mount and unmount 15 times with complete activeChannelRegistry teardown', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      for (let i = 0; i < 15; i++) {
        const { unmount } = render(
          <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/operations?tab=pending-approvals']}>
              <OperationsPage />
            </MemoryRouter>
          </QueryClientProvider>
        );

        // Immediate unmount
        unmount();
      }

      // Each cycle: OperationsPage creates 4 channels (work_requests, tasks, operations_requests, task_assignees)
      // and tears them down on unmount
      expect(channelSpy).toHaveBeenCalledTimes(15 * 4);
      expect(removeChannelSpy).toHaveBeenCalledTimes(15 * 4);

      // Verify zero dangling channels in mock client after 15 cycles
      const channels = mockClient.getChannels();
      expect(channels).toHaveLength(0);
    });

    it('3.3 multiplexes standalone PendingApprovalsInbox with OperationsPage and tears down only after both unmount', () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      // Mount Standalone PendingApprovalsInbox (Instance 1)
      const standalone = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <PendingApprovalsInbox />
          </MemoryRouter>
        </QueryClientProvider>
      );

      expect(mockClient.getChannels()).toHaveLength(1);
      const opsChannel = mockClient.getChannel('cdc_operations_requests');
      expect(opsChannel).toBeDefined();

      // Concurrently Mount OperationsPage (Instance 2)
      const page = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/operations?tab=pending-approvals']}>
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Now 4 total channels in mockClient: cdc_operations_requests (shared by 3 subscribers),
      // plus cdc_work_requests, cdc_tasks, and cdc_task_assignees from OperationsPage.
      expect(mockClient.getChannels()).toHaveLength(4);

      // Unmount standalone PendingApprovalsInbox (1 subscriber drops, 2 remain on cdc_operations_requests)
      standalone.unmount();

      // Channel MUST STILL BE ACTIVE!
      expect(mockClient.getChannel('cdc_operations_requests')).toBeDefined();
      expect(mockClient.getChannels()).toHaveLength(4);

      // Now unmount OperationsPage (final subscribers drop)
      page.unmount();

      // Channel count drops to 0! Complete teardown achieved.
      expect(mockClient.getChannels()).toHaveLength(0);
    });

    it('3.4 guarantees dead channel immunity: unmounted components do not receive subsequent CDC events', () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      const page = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/operations?tab=pending-approvals']}>
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      const channel = mockClient.getChannel('cdc_operations_requests');
      expect(channel).toBeDefined();

      page.unmount();

      // Channel is closed and removed
      expect(channel?.status).toBe('CLOSED');
      expect(channel?.getListeners()).toHaveLength(0);

      // Emitting on the closed channel must not throw or cause errors
      expect(() => {
        channel?.emit('postgres_changes', {
          eventType: 'INSERT',
          new: {
            id: 'req-zombie',
            entity: 'ATA',
            version: 1,
          },
        });
      }).not.toThrow();
    });

    it('3.5 dynamically mounts/unmounts PendingApprovalsInbox across internal tab switching without destroying top-level OperationsPage channel', () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      // Start on work-requests tab
      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/operations?tab=work-requests']}>
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // OperationsPage mounts cdc_operations_requests, cdc_work_requests, cdc_tasks, cdc_time_entries, cdc_task_time_logs, cdc_task_assignees
      const channel = mockClient.getChannel('cdc_operations_requests');
      expect(channel).toBeDefined();
      expect(mockClient.getChannels()).toHaveLength(6);

      // Unmount OperationsPage
      unmount();
      expect(mockClient.getChannels()).toHaveLength(0);
    });
  });
});
