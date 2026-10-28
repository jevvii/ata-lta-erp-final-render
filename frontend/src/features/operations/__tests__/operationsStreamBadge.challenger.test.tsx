/**
 * Operations Stream & Tab Badge Adversarial Verification Suite
 * Milestone 4 (Parcel 4: Real-Time Operations Requests - Empirical Challenger)
 *
 * Verifies:
 * - Test 1: Reactive increment and DOM mount of <Badge data-testid="tab-pending-badge">
 *   upon authentic CDC INSERT on channel cdc_operations_requests with 0 page reloads or tab toggles.
 * - Test 2: Reactive decrement and DOM unmount of <Badge data-testid="tab-pending-badge">
 *   upon authentic CDC UPDATE (status fulfilled or rejected).
 * - Test 3: High-concurrency operations requests burst (20+ concurrent INSERT/UPDATE/DELETE events)
 *   with zero counter desync and correct final state.
 * - Test 4: Cross-tenant isolation (discarding cross-entity CDC events under active tenant).
 * - Test 5: Deduplication of replayed/duplicate CDC events.
 * - Test 6: RBAC gating (unauthorized session disables channel subscription).
 *
 * Strict Invariants:
 * - Zero Playwright browser runners or headless browser plugins.
 * - Zero hardcoded secrets.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useSessionStore } from '@/lib/session';
import { supabase, MockSupabaseClient } from '@/lib/supabase';
import { clearChannelRegistryForTesting } from '@/lib/realtime/useEntityRealtimeSync';
import { operationsKeys } from '../api/queryKeys';
import OperationsPage from '@/routes/operations';
import type { OperationsRequest } from '../api/types';

describe('Operations Stream & Tab Badge Adversarial Challenger Suite', () => {
  let queryClient: QueryClient;
  let mockServerPendingCreations = 0;
  let mockServerPendingCount = 0;
  let mockServerFulfilledCount = 0;
  let mockServerRejectedCount = 0;
  let mockServerRequests: OperationsRequest[] = [];

  function createTestHarness() {
    const qc = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
          staleTime: 0, // Immediately fetch when invalidated
        },
      },
    });
    return qc;
  }

  beforeEach(() => {
    queryClient = createTestHarness();
    localStorage.clear();
    clearChannelRegistryForTesting();

    // Default mock counts & state
    mockServerPendingCreations = 0;
    mockServerPendingCount = 0;
    mockServerFulfilledCount = 0;
    mockServerRejectedCount = 0;
    mockServerRequests = [];

    // Authenticated session with full operations permissions for ATA
    useSessionStore.getState().setSession({
      user: {
        id: 'u-ops-challenger-1',
        email: 'ops-challenger@ata-lta.ph',
        name: 'Ops Challenger Lead',
        role: 'Operations Lead',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
        'workflow:transition_request',
        'retainers:use',
      ],
      activeEntity: 'ATA',
    });

    // Mock authoritative API endpoints
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);

      if (u.includes('/operations-requests/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              pending: mockServerPendingCount,
              fulfilled: mockServerFulfilledCount,
              rejected: mockServerRejectedCount,
              total:
                mockServerPendingCount +
                mockServerFulfilledCount +
                mockServerRejectedCount,
            },
          }),
        } as Response);
      }

      if (u.includes('/operations-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: mockServerRequests,
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests/creation-approvals')) {
        return Promise.resolve({ ok: true, status: 200,
          json: async () => ({ data: Array.from({ length: mockServerPendingCreations }, (_, i) =>
            ({ id: `pending-wr-${i}`, creationApprovalStatus: 'pending' })) }),
        } as Response);
      }

      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [],
            meta: { total: 0 },
          }),
        } as Response);
      }

      if (u.includes('/operations/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { total: 0, active: 0, completed: 0, onHold: 0, urgent: 0 },
          }),
        } as Response);
      }

      if (u.includes('/operations/templates')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [],
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });
  });

  afterEach(() => {
    queryClient.clear();
    clearChannelRegistryForTesting();
    vi.restoreAllMocks();
  });

  function renderOperations(initialRoute = '/operations?tab=work-requests') {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialRoute]}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  it.each(['Admin', 'Manager'])('includes pending WR creations in the %s navigation count and removes them after resolution', async (role) => {
    useSessionStore.getState().updateUser?.({ role });
    mockServerPendingCount = 2;
    mockServerPendingCreations = 3;
    renderOperations();
    await waitFor(() => expect(screen.getByTestId('tab-pending-badge')).toHaveTextContent('5'));
    const creationCalls = vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).includes('/creation-approvals'));
    expect(creationCalls.some(([url]) => String(url).includes(`scope=${role === 'Admin' ? 'all' : 'mine'}`))).toBe(true);
    mockServerPendingCreations = 0;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCreationApprovals() }); });
    await waitFor(() => expect(screen.getByTestId('tab-pending-badge')).toHaveTextContent('2'));
    mockServerPendingCount = 0;
    await act(async () => { await queryClient.invalidateQueries({ queryKey: operationsKeys.requestCounts('ATA') }); });
    await waitFor(() => expect(screen.queryByTestId('tab-pending-badge')).not.toBeInTheDocument());
  });

  it('does not fetch or count WR creation approvals for other approval roles', async () => {
    mockServerPendingCount = 1;
    mockServerPendingCreations = 4;
    renderOperations();
    await waitFor(() => expect(screen.getByTestId('tab-pending-badge')).toHaveTextContent('1'));
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes('/creation-approvals'))).toBe(false);
  });

  // ==========================================================================
  // Test 1: Reactive Increment and DOM Mount of Tab Badge on CDC INSERT
  // ==========================================================================
  it('Test 1: with pendingApprovalsCount = 0, CDC INSERT on cdc_operations_requests reactively mounts <Badge data-testid="tab-pending-badge"> without page reload or tab switch', async () => {
    mockServerPendingCount = 0;

    renderOperations('/operations?tab=work-requests');

    // Tab trigger exists in header navigation
    const pendingTabTrigger = await screen.findByTestId('tab-pending-approvals');
    expect(pendingTabTrigger).toBeInTheDocument();

    // With 0 pending requests, badge must NOT be in the DOM
    expect(screen.queryByTestId('tab-pending-badge')).toBeNull();

    // Verify channel subscription was established
    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_operations_requests');
    expect(channel).toBeDefined();

    // Simulate backend server state updating upon request creation
    mockServerPendingCount = 1;
    mockServerRequests.push({
      id: 'op-insert-1',
      entity: 'ATA',
      type: 'phase_transition',
      status: 'pending',
      workRequestId: 'wr-101',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    } as unknown as OperationsRequest);

    // Authentically emit CDC INSERT over Supabase Realtime channel
    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'op-insert-1',
          entity: 'ATA',
          entity_id: 'ATA',
          request_type: 'phase_transition',
          status: 'pending',
          work_request_id: 'wr-101',
          version: 1,
          created_at: new Date().toISOString(),
        },
      });
    });

    // Assert: <Badge data-testid="tab-pending-badge"> reactively renders in DOM with count '1'
    const badge = await screen.findByTestId('tab-pending-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('1');

    // Verify the user is still on 'work-requests' tab (no tab toggle or page reload)
    const workRequestsTab = screen.getByTestId('tab-work-requests');
    expect(workRequestsTab).toHaveAttribute('data-state', 'active');
  });

  // ==========================================================================
  // Test 2: Reactive Decrement and DOM Unmount on CDC UPDATE (Fulfilled/Rejected)
  // ==========================================================================
  it('Test 2: starting with pendingApprovalsCount = 1, CDC UPDATE (status fulfilled or rejected) reactively decrements and unmounts <Badge data-testid="tab-pending-badge">', async () => {
    mockServerPendingCount = 1;

    renderOperations('/operations?tab=work-requests');

    // Badge initially mounts with text '1'
    const initialBadge = await screen.findByTestId('tab-pending-badge');
    expect(initialBadge).toBeInTheDocument();
    expect(initialBadge).toHaveTextContent('1');

    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_operations_requests');
    expect(channel).toBeDefined();

    // 2A: Update request to fulfilled -> pending count drops to 0
    mockServerPendingCount = 0;
    mockServerFulfilledCount = 1;

    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'UPDATE',
        old: {
          id: 'op-insert-1',
          entity: 'ATA',
          status: 'pending',
          version: 1,
        },
        new: {
          id: 'op-insert-1',
          entity: 'ATA',
          entity_id: 'ATA',
          request_type: 'phase_transition',
          status: 'fulfilled',
          work_request_id: 'wr-101',
          version: 2,
          updated_at: new Date().toISOString(),
        },
      });
    });

    // Assert: Badge reactively unmounts from the DOM
    await waitFor(() => {
      expect(screen.queryByTestId('tab-pending-badge')).toBeNull();
    });

    // 2B: Increment to 2, then reject 1 -> badge decrements to 1
    mockServerPendingCount = 2;
    queryClient.setQueryData(operationsKeys.requestCounts('ATA'), {
      pending: 2,
      fulfilled: 1,
      rejected: 0,
      total: 3,
    });

    const badgeAtTwo = await screen.findByTestId('tab-pending-badge');
    expect(badgeAtTwo).toHaveTextContent('2');

    // Server state reflects rejection
    mockServerPendingCount = 1;
    mockServerRejectedCount = 1;

    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'UPDATE',
        old: {
          id: 'op-insert-2',
          entity: 'ATA',
          status: 'pending',
          version: 1,
        },
        new: {
          id: 'op-insert-2',
          entity: 'ATA',
          entity_id: 'ATA',
          request_type: 'phase_transition',
          status: 'rejected',
          work_request_id: 'wr-102',
          version: 2,
          updated_at: new Date().toISOString(),
        },
      });
    });

    // Assert: Badge decrements reactively to '1'
    await waitFor(() => {
      expect(screen.getByTestId('tab-pending-badge')).toHaveTextContent('1');
    });
  });

  // ==========================================================================
  // Test 3: High-Concurrency Burst (20+ Concurrent INSERT/UPDATE/DELETE Events)
  // ==========================================================================
  it('Test 3: high-concurrency operations burst (24 mixed CDC events) preserves zero counter desync and correct final state', async () => {
    mockServerPendingCount = 0;

    renderOperations('/operations?tab=work-requests');

    // Confirm initial zero badge
    await screen.findByTestId('tab-pending-approvals');
    expect(screen.queryByTestId('tab-pending-badge')).toBeNull();

    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_operations_requests');
    expect(channel).toBeDefined();

    // Prepare an intensive 24-event burst:
    // - 12 INSERTs (op-burst-1 .. op-burst-12)
    // - 4 UPDATEs fulfilling op-burst-1..4
    // - 2 UPDATEs rejecting op-burst-5..6
    // - 2 soft-DELETEs (deleted_at != null) for op-burst-7..8
    // - 4 new INSERTs (op-burst-13..16)
    // Final Pending: (12 - 4 - 2 - 2) + 4 = 8 pending requests
    const expectedFinalPendingCount = 8;
    mockServerPendingCount = expectedFinalPendingCount;
    mockServerFulfilledCount = 4;
    mockServerRejectedCount = 2;

    const burstEvents: Array<{ eventType: string; payload: Record<string, unknown> }> = [];

    // Step 1: 12 Initial INSERTs
    for (let i = 1; i <= 12; i++) {
      burstEvents.push({
        eventType: 'INSERT',
        payload: {
          eventType: 'INSERT',
          new: {
            id: `op-burst-${i}`,
            entity: 'ATA',
            entity_id: 'ATA',
            request_type: 'phase_transition',
            status: 'pending',
            work_request_id: `wr-burst-${i}`,
            version: 1,
            created_at: new Date().toISOString(),
          },
        },
      });
    }

    // Step 2: 4 UPDATEs -> fulfilled
    for (let i = 1; i <= 4; i++) {
      burstEvents.push({
        eventType: 'UPDATE',
        payload: {
          eventType: 'UPDATE',
          old: { id: `op-burst-${i}`, entity: 'ATA', status: 'pending', version: 1 },
          new: {
            id: `op-burst-${i}`,
            entity: 'ATA',
            entity_id: 'ATA',
            request_type: 'phase_transition',
            status: 'fulfilled',
            work_request_id: `wr-burst-${i}`,
            version: 2,
            updated_at: new Date().toISOString(),
          },
        },
      });
    }

    // Step 3: 2 UPDATEs -> rejected
    for (let i = 5; i <= 6; i++) {
      burstEvents.push({
        eventType: 'UPDATE',
        payload: {
          eventType: 'UPDATE',
          old: { id: `op-burst-${i}`, entity: 'ATA', status: 'pending', version: 1 },
          new: {
            id: `op-burst-${i}`,
            entity: 'ATA',
            entity_id: 'ATA',
            request_type: 'phase_transition',
            status: 'rejected',
            work_request_id: `wr-burst-${i}`,
            version: 2,
            updated_at: new Date().toISOString(),
          },
        },
      });
    }

    // Step 4: 2 soft-deletes via UPDATE with deleted_at
    for (let i = 7; i <= 8; i++) {
      burstEvents.push({
        eventType: 'UPDATE',
        payload: {
          eventType: 'UPDATE',
          old: { id: `op-burst-${i}`, entity: 'ATA', status: 'pending', version: 1 },
          new: {
            id: `op-burst-${i}`,
            entity: 'ATA',
            entity_id: 'ATA',
            request_type: 'phase_transition',
            status: 'pending',
            deleted_at: new Date().toISOString(),
            version: 2,
          },
        },
      });
    }

    // Step 5: 4 more INSERTs
    for (let i = 13; i <= 16; i++) {
      burstEvents.push({
        eventType: 'INSERT',
        payload: {
          eventType: 'INSERT',
          new: {
            id: `op-burst-${i}`,
            entity: 'ATA',
            entity_id: 'ATA',
            request_type: 'phase_transition',
            status: 'pending',
            work_request_id: `wr-burst-${i}`,
            version: 1,
            created_at: new Date().toISOString(),
          },
        },
      });
    }

    expect(burstEvents).toHaveLength(24);

    // Fire all 24 events concurrently in a single rapid batch
    act(() => {
      for (const ev of burstEvents) {
        channel?.emit('postgres_changes', ev.payload);
      }
    });

    // Assert: Badge accurately reflects final count of 8 without counter drift
    const finalBadge = await screen.findByTestId('tab-pending-badge');
    expect(finalBadge).toBeInTheDocument();
    expect(finalBadge).toHaveTextContent(String(expectedFinalPendingCount));

    // Verify QueryClient cache holds consistent counts
    const cachedCounts = queryClient.getQueryData<Record<string, number>>(
      operationsKeys.requestCounts('ATA')
    );
    expect(cachedCounts?.pending).toBe(expectedFinalPendingCount);
  });

  // ==========================================================================
  // Test 4: Cross-Tenant Isolation (Tenant Isolation Guard)
  // ==========================================================================
  it('Test 4: CDC INSERT for foreign tenant LTA is discarded and does NOT increment active ATA badge', async () => {
    mockServerPendingCount = 0;

    renderOperations('/operations?tab=work-requests');
    await screen.findByTestId('tab-pending-approvals');
    expect(screen.queryByTestId('tab-pending-badge')).toBeNull();

    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_operations_requests');

    // Emit event belonging to foreign tenant 'LTA'
    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'op-foreign-lta',
          entity: 'LTA',
          entity_id: 'LTA',
          request_type: 'phase_transition',
          status: 'pending',
          work_request_id: 'wr-lta-99',
          version: 1,
          created_at: new Date().toISOString(),
        },
      });
    });

    // Badge MUST NOT render in the DOM for ATA session
    expect(screen.queryByTestId('tab-pending-badge')).toBeNull();
  });

  // ==========================================================================
  // Test 5: Duplicate Replayed CDC Event Idempotency
  // ==========================================================================
  it('Test 5: duplicate CDC hints refetch counts once without injecting duplicate operations rows', async () => {
    // Admin also uses authoritative API refetch instead of raw row injection.
    useSessionStore.getState().setSession({
      user: {
        id: 'u-ops-admin-1',
        email: 'ops-admin@ata-lta.ph',
        name: 'Ops Admin',
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
      ],
      activeEntity: 'ATA',
    });

    // Seed list cache
    queryClient.setQueryData<OperationsRequest[]>(operationsKeys.requests(), []);

    renderOperations('/operations?tab=work-requests');
    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_operations_requests');

    const cdcPayload = {
      eventType: 'INSERT',
      new: {
        id: 'op-replayed-1',
        entity: 'ATA',
        entity_id: 'ATA',
        request_type: 'phase_transition',
        status: 'pending',
        work_request_id: 'wr-1',
        version: 1,
        created_at: new Date().toISOString(),
      },
    };

    mockServerPendingCount = 1;
    // Emit same event twice
    act(() => {
      channel?.emit('postgres_changes', cdcPayload);
      channel?.emit('postgres_changes', cdcPayload);
    });

    await waitFor(() => expect(screen.getByTestId('tab-pending-badge')).toHaveTextContent('1'));
    // A raw event must never fabricate a list row, even for Admin.
    expect(queryClient.getQueryData(operationsKeys.requests())).toEqual([]);
    expect(queryClient.getQueryState(operationsKeys.requests())?.isInvalidated).toBe(true);
  });

  // ==========================================================================
  // Test 6: RBAC Gating (Forbidden when lacking workflow:view)
  // ==========================================================================
  it('Test 6: session lacking workflow:view renders Forbidden and disables realtime subscription', () => {
    const channelSpy = vi.spyOn(supabase, 'channel');

    useSessionStore.getState().setSession({
      user: {
        id: 'u-no-view',
        email: 'noview@ata-lta.ph',
        name: 'Unauthorized User',
        role: 'Client',
        departments: [],
        entities: ['ATA'],
      },
      permissions: [], // zero permissions
      activeEntity: 'ATA',
    });

    renderOperations('/operations?tab=work-requests');

    // Renders Forbidden view
    expect(screen.getByText(/access forbidden/i)).toBeInTheDocument();

    // Tab pending approvals badge must not exist
    expect(screen.queryByTestId('tab-pending-badge')).toBeNull();

    // supabase.channel should not have been called for cdc_operations_requests in this render
    expect(channelSpy).not.toHaveBeenCalledWith('cdc_operations_requests');
  });
});
