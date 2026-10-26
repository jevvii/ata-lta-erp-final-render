import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEntityRealtimeSync, handleRealtimePayload, clearChannelRegistryForTesting } from '../useEntityRealtimeSync';
import { supabase, MockRealtimeChannel, MockSupabaseClient } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { resetTabIdForTesting } from '@/lib/tabSync';
import { clearLocalMutationsForTesting } from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';

interface MockEntity {
  id?: string;
  title?: string;
  version?: number;
  entity?: string;
  entity_id?: string | null;
  invoiceNumber?: string;
  referenceNumber?: string;
  data?: MockEntity[];
  meta?: { total?: number };
}

describe('Challenger Stress Harness: useEntityRealtimeSync & Supabase Realtime', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-challenger-harness');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-challenger-realtime',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await supabase.removeAllChannels();
    clearChannelRegistryForTesting();
    queryClient.clear();
    localStorage.clear();
    clearLocalMutationsForTesting();
    resetTabIdForTesting();
  });

  // =========================================================================
  // Harness 1: Rapid Out-of-Order Version Events & Stale Rejection Oracle
  // =========================================================================
  describe('Harness 1: Out-of-Order Version Events & Stale Rejection Oracle', () => {
    it('properly drops inverted version sequence (V3 arriving before V2)', () => {
      // Seed detail cache with version 1
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-inv-1'), {
        id: 'wr-inv-1',
        title: 'Original V1',
        version: 1,
        entity: 'ATA',
      });

      // 1. Version 3 arrives out-of-order
      const v3Payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-inv-1', title: 'Future V3', version: 3, entity: 'ATA' },
        old: { id: 'wr-inv-1', version: 2 },
      };
      const processedV3 = handleRealtimePayload(queryClient, { table: 'work_requests' }, v3Payload);
      expect(processedV3).toBe(true);

      const cachedAfterV3 = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail('wr-inv-1'));
      expect(cachedAfterV3?.version).toBe(3);
      expect(cachedAfterV3?.title).toBe('Future V3');

      // 2. Delayed Version 2 arrives later
      const v2Payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-inv-1', title: 'Delayed V2', version: 2, entity: 'ATA' },
        old: { id: 'wr-inv-1', version: 1 },
      };
      const processedV2 = handleRealtimePayload(queryClient, { table: 'work_requests' }, v2Payload);
      expect(processedV2).toBe(false);

      // Cache MUST NOT regress to V2!
      const cachedAfterV2 = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail('wr-inv-1'));
      expect(cachedAfterV2?.version).toBe(3);
      expect(cachedAfterV2?.title).toBe('Future V3');

      // 3. Newest Version 4 arrives
      const v4Payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-inv-1', title: 'Latest V4', version: 4, entity: 'ATA' },
        old: { id: 'wr-inv-1', version: 3 },
      };
      const processedV4 = handleRealtimePayload(queryClient, { table: 'work_requests' }, v4Payload);
      expect(processedV4).toBe(true);

      const cachedAfterV4 = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail('wr-inv-1'));
      expect(cachedAfterV4?.version).toBe(4);
      expect(cachedAfterV4?.title).toBe('Latest V4');
    });

    it('stress oracle: evaluates 25 randomized out-of-order version updates and guarantees monotonic cache progression', () => {
      const entityId = 'wr-oracle-test';

      // Seed initial record at version 0
      queryClient.setQueryData(operationsKeys.workRequestDetail(entityId), {
        id: entityId,
        title: 'Initial V0',
        version: 0,
        entity: 'ATA',
      });

      // Construct 25 versions in pseudo-random out-of-order sequence
      const versionSequence = [
        5, 2, 8, 1, 14, 3, 11, 7, 20, 4, 18, 9, 25, 6, 12, 10, 15, 13, 22, 17, 16, 21, 24, 19, 23,
      ];

      let runningMaxVersion = 0;
      let acceptedCount = 0;
      let rejectedCount = 0;

      for (const ver of versionSequence) {
        const payload = {
          eventType: 'UPDATE',
          new: {
            id: entityId,
            title: `Title V${ver}`,
            version: ver,
            entity: 'ATA',
          },
          old: { id: entityId, version: ver - 1 },
        };

        const result = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);

        if (ver > runningMaxVersion) {
          // Monotonic invariant: newer version MUST be accepted
          expect(result).toBe(true);
          runningMaxVersion = ver;
          acceptedCount++;
        } else {
          // Monotonic invariant: older or equal version MUST be rejected
          expect(result).toBe(false);
          rejectedCount++;
        }

        // Cached version MUST equal runningMaxVersion after each step
        const currentCache = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail(entityId));
        expect(currentCache?.version).toBe(runningMaxVersion);
        expect(currentCache?.title).toBe(`Title V${runningMaxVersion}`);
      }

      // Verification: exactly 5 peaks in this sequence (5, 8, 14, 20, 25)
      expect(runningMaxVersion).toBe(25);
      expect(acceptedCount).toBe(5);
      expect(rejectedCount).toBe(20);
    });

    it('suppresses high-frequency duplicate INSERT version bursts without cache thrashing', () => {
      const entityId = 'wr-burst-test';
      queryClient.setQueryData(operationsKeys.workRequestDetail(entityId), {
        id: entityId,
        title: 'Burst Base',
        version: 10,
        entity: 'ATA',
      });

      // Burst of 15 identical version 10 duplicate INSERTs
      for (let i = 0; i < 15; i++) {
        const duplicatePayload = {
          eventType: 'INSERT',
          new: { id: entityId, title: `Burst Duplicate ${i}`, version: 10, entity: 'ATA' },
        };
        const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, duplicatePayload);
        expect(processed).toBe(false);
      }

      const cached = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail(entityId));
      expect(cached?.title).toBe('Burst Base');
      expect(cached?.version).toBe(10);
    });

    it('evaluates highest version across multiple list and detail caches', () => {
      const entityId = 'wr-multi-cache-version';

      // Detail cache has version 3
      queryClient.setQueryData(operationsKeys.workRequestDetail(entityId), {
        id: entityId,
        version: 3,
        entity: 'ATA',
      });

      // List cache 1 has version 5
      queryClient.setQueryData(['operations', 'workRequests', 'list', 'p1'], {
        data: [{ id: entityId, version: 5, entity: 'ATA' }],
        meta: { total: 1 },
      });

      // List cache 2 has version 2
      queryClient.setQueryData(['operations', 'workRequests', 'recent'], [
        { id: entityId, version: 2, entity: 'ATA' },
      ]);

      // An incoming payload with version 4 (greater than detail's 3, but LESS than list 1's 5)
      const payloadV4 = {
        eventType: 'UPDATE',
        new: { id: entityId, version: 4, title: 'V4 Update', entity: 'ATA' },
        old: { id: entityId, version: 3 },
      };

      const result = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadV4);

      // Must be rejected because list cache already has version 5!
      expect(result).toBe(false);

      // Detail cache should remain version 3
      const detail = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail(entityId));
      expect(detail?.version).toBe(3);
    });

    it('probes behaviour of out-of-order UPDATE following a DELETE', () => {
      const entityId = 'wr-del-race';

      // 1. Initial state at V3
      queryClient.setQueryData(operationsKeys.workRequestDetail(entityId), {
        id: entityId,
        title: 'Existing',
        version: 3,
        entity: 'ATA',
      });
      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [{ id: entityId, title: 'Existing', version: 3, entity: 'ATA' }],
        meta: { total: 1 },
      });

      // 2. DELETE arrives
      const deletePayload = {
        eventType: 'DELETE',
        old: { id: entityId, entity: 'ATA' },
      };
      const processedDelete = handleRealtimePayload(queryClient, { table: 'work_requests' }, deletePayload);
      expect(processedDelete).toBe(true);

      expect(queryClient.getQueryData(operationsKeys.workRequestDetail(entityId))).toBeUndefined();
      const listAfterDel = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestsList('ATA'));
      expect(listAfterDel?.data).toHaveLength(0);

      // 3. Stale UPDATE with V2 arrives AFTER deletion
      const staleUpdate = {
        eventType: 'UPDATE',
        new: { id: entityId, title: 'Stale V2 Resurrect?', version: 2, entity: 'ATA' },
        old: { id: entityId, version: 1 },
      };
      handleRealtimePayload(queryClient, { table: 'work_requests' }, staleUpdate);

      // The list cache should NOT contain the deleted item
      const listAfterStale = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestsList('ATA'));
      expect(listAfterStale?.data).toHaveLength(0);
    });
  });

  // =========================================================================
  // Harness 2: Edge Cases in Entity Matching & Tenant Isolation
  // =========================================================================
  describe('Harness 2: Entity Matching & Tenant Isolation Edge Cases', () => {
    it('handles tenant matching case-insensitively across mixed case entities', () => {
      // User is on 'ATA'
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-challenger-realtime',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });

      // Incoming payload with lowercase entity 'ata'
      const payloadLower = {
        eventType: 'UPDATE',
        new: { id: 'wr-case-1', entity: 'ata', title: 'Lowercase ata', version: 1 },
      };
      const resLower = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadLower);
      expect(resLower).toBe(true);

      // Incoming payload with mixed case entity 'AtA'
      const payloadMixed = {
        eventType: 'UPDATE',
        new: { id: 'wr-case-2', entity: 'AtA', title: 'Mixed AtA', version: 1 },
      };
      const resMixed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadMixed);
      expect(resMixed).toBe(true);

      // Session switch to lowercase 'lta'
      useSessionStore.setState({ activeEntity: 'lta' });

      // Incoming payload with uppercase 'LTA'
      const payloadUpperLTA = {
        eventType: 'UPDATE',
        new: { id: 'wr-case-3', entity: 'LTA', title: 'Upper LTA', version: 1 },
      };
      const resUpperLTA = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadUpperLTA);
      expect(resUpperLTA).toBe(true);

      // Incoming payload with 'ATA' when user is 'lta' must be rejected
      const payloadATAonLTA = {
        eventType: 'UPDATE',
        new: { id: 'wr-case-4', entity: 'ATA', title: 'Cross Tenant', version: 1 },
      };
      const resReject = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadATAonLTA);
      expect(resReject).toBe(false);
    });

    it('tests activeEntityUUID matching with case variance', () => {
      const lowerUUID = '123e4567-e89b-12d3-a456-426614174000';
      const upperUUID = '123E4567-E89B-12D3-A456-426614174000';

      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-challenger-realtime',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });

      // Case A: exact match
      const payloadExact = {
        eventType: 'UPDATE',
        new: { id: 'wr-uuid-1', entity_id: lowerUUID, version: 1 },
      };
      const resExact = handleRealtimePayload(
        queryClient,
        { table: 'work_requests', activeEntityUUID: lowerUUID },
        payloadExact
      );
      expect(resExact).toBe(true);

      // Case B: payload has uppercase UUID, option has lowercase UUID
      const payloadUpper = {
        eventType: 'UPDATE',
        new: { id: 'wr-uuid-2', entity_id: upperUUID, version: 1 },
      };
      const resUpper = handleRealtimePayload(
        queryClient,
        { table: 'work_requests', activeEntityUUID: lowerUUID },
        payloadUpper
      );
      // Remediated: UUID matching is case-insensitive, so uppercase UUID payload matches lowercase activeEntityUUID
      expect(resUpper).toBe(true);
    });

    it('probes behaviour when activeEntity is null and options.activeEntity is undefined', () => {
      // Session has activeEntity: null (e.g. before login or session unassigned)
      useSessionStore.setState({ activeEntity: null });

      const payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-null-session', entity: 'LTA', version: 1, title: 'Unassigned Test' },
      };

      const result = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);
      // Remediated: When activeEntity is null/undefined and activeEntity !== 'ALL', cross-tenant payloads are discarded
      expect(result).toBe(false);
    });

    it('probes behaviour when payload contains entity_id: null', () => {
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-challenger-realtime',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });

      const payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-null-entity-id', entity_id: null, version: 1, title: 'Null entity_id' },
      };

      const result = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);
      // Remediated: entity_id: null is detected as having an entity field and discarded for ATA session
      expect(result).toBe(false);
    });

    it('allows ALL mode regardless of payload entity value', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });

      const tenants = ['ATA', 'LTA', 'GLOBAL', 'UNKNOWN', 'xyz'];
      for (const t of tenants) {
        const payload = {
          eventType: 'UPDATE',
          new: { id: `wr-all-${t}`, entity: t, version: 1, title: `Tenant ${t}` },
        };
        const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);
        expect(processed).toBe(true);
      }
    });

    it('gracefully allows tables without entity fields such as tasks', () => {
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-challenger-realtime',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });

      const taskWithoutEntity = {
        eventType: 'UPDATE',
        new: { id: 'task-no-entity', work_request_id: 'wr-1', version: 1, title: 'No Entity Field' },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'tasks' }, taskWithoutEntity);
      expect(processed).toBe(true);
    });
  });

  // =========================================================================
  // Harness 3: Concurrent Subscriptions Across Multiple Channels/Tables
  // =========================================================================
  describe('Harness 3: Concurrent Multi-Channel Multiplexing', () => {
    it('multiplexes subscriptions across 4 domain tables concurrently on singleton client', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      const hookWR = renderHook(() => useEntityRealtimeSync({ table: 'work_requests' }), {
        wrapper: createWrapper(),
      });
      const hookTasks = renderHook(() => useEntityRealtimeSync({ table: 'tasks' }), {
        wrapper: createWrapper(),
      });
      const hookInvoices = renderHook(() => useEntityRealtimeSync({ table: 'invoices' }), {
        wrapper: createWrapper(),
      });
      const hookDisbursements = renderHook(() => useEntityRealtimeSync({ table: 'disbursements' }), {
        wrapper: createWrapper(),
      });

      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');
      expect(channelSpy).toHaveBeenCalledWith('cdc_tasks');
      expect(channelSpy).toHaveBeenCalledWith('cdc_invoices');
      expect(channelSpy).toHaveBeenCalledWith('cdc_disbursements');

      // Verify each channel receives only its domain events
      const wrChannel = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      const invChannel = supabase.channel('cdc_invoices') as unknown as MockRealtimeChannel;

      act(() => {
        wrChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-multiplex-1', entity: 'ATA', title: 'WR Event', version: 1 },
        });
      });

      // Work request detail query updated
      const wrCached = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail('wr-multiplex-1'));
      expect(wrCached?.title).toBe('WR Event');

      act(() => {
        invChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'inv-multiplex-1', entity: 'ATA', invoiceNumber: 'INV-MP-1', version: 1 },
        });
      });

      // Invoice detail query updated
      const invCached = queryClient.getQueryData<MockEntity>(billingKeys.invoiceDetail('inv-multiplex-1'));
      expect(invCached?.invoiceNumber).toBe('INV-MP-1');

      // Teardown WR hook only
      hookWR.unmount();

      // Invoices hook must still be alive and receive events
      act(() => {
        invChannel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'inv-multiplex-1', entity: 'ATA', invoiceNumber: 'INV-MP-2', version: 2 },
        });
      });
      const invCached2 = queryClient.getQueryData<MockEntity>(billingKeys.invoiceDetail('inv-multiplex-1'));
      expect(invCached2?.invoiceNumber).toBe('INV-MP-2');

      // Cleanup remaining hooks
      hookTasks.unmount();
      hookInvoices.unmount();
      hookDisbursements.unmount();
    });

    it('probes multiple hooks subscribed to the same table with explicit channel names', () => {
      // Component A uses custom channel name
      const hookA = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests', channelName: 'cdc_wr_view_a' }),
        { wrapper: createWrapper() }
      );

      // Component B uses custom channel name
      const hookB = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests', channelName: 'cdc_wr_view_b' }),
        { wrapper: createWrapper() }
      );

      const channelB = supabase.channel('cdc_wr_view_b') as unknown as MockRealtimeChannel;

      // Unmount hook A
      hookA.unmount();

      // Hook B should still receive events through its channel
      act(() => {
        channelB.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-isolated-ch', entity: 'ATA', title: 'Channel B Still Alive', version: 1 },
        });
      });

      const cached = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail('wr-isolated-ch'));
      expect(cached?.title).toBe('Channel B Still Alive');

      hookB.unmount();
    });

    it('probes concurrent hooks sharing default channel name and unmount order', async () => {
      // Component A mounts default channel 'cdc_work_requests'
      const hookA = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      // Component B mounts same table (default channel 'cdc_work_requests')
      const hookB = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      const channel = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;

      // Both receive events when both are mounted
      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-shared-1', entity: 'ATA', title: 'Both Mounted', version: 1 },
        });
      });
      expect(queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail('wr-shared-1'))?.title).toBe('Both Mounted');

      // Unmount Component A
      hookA.unmount();

      // Wait for async teardown microtask
      await new Promise((r) => setTimeout(r, 10));

      // Emit event on channel
      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-shared-2', entity: 'ATA', title: 'After Hook A Unmount', version: 1 },
        });
      });

      // Remediated: Hook B continues to receive events because activeChannelRegistry ref-counts subscribers
      const cachedAfterAUnmount = queryClient.getQueryData<MockEntity>(operationsKeys.workRequestDetail('wr-shared-2'));
      expect(cachedAfterAUnmount?.title).toBe('After Hook A Unmount');

      hookB.unmount();
    });
  });

  // =========================================================================
  // Harness 4: Rapid Mount/Unmount Subscription Cycling & Leak Verification
  // =========================================================================
  describe('Harness 4: Rapid Mount/Unmount Subscription Cycling', () => {
    it('survives 50 rapid mount and unmount cycles without channel or memory leaks', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      for (let i = 0; i < 50; i++) {
        const { unmount } = renderHook(
          () => useEntityRealtimeSync({ table: 'work_requests' }),
          { wrapper: createWrapper() }
        );
        unmount();
      }

      expect(channelSpy).toHaveBeenCalledTimes(50);
      expect(removeChannelSpy).toHaveBeenCalledTimes(50);

      // Verify no dangling channel entries in mock client after async teardown completes
      await vi.waitFor(() => {
        const mockClient = supabase as unknown as MockSupabaseClient;
        const channels = mockClient.getChannels ? mockClient.getChannels() : [];
        expect(channels).toHaveLength(0);
      });
    });

    it('handles table switching dynamically with clean channel replacement', () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { rerender, unmount } = renderHook(
        (props: { table: 'work_requests' | 'invoices' | 'disbursements' }) => useEntityRealtimeSync(props),
        {
          initialProps: { table: 'work_requests' },
          wrapper: createWrapper(),
        }
      );

      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');

      // Switch table to 'invoices'
      rerender({ table: 'invoices' });
      expect(removeChannelSpy).toHaveBeenCalled();
      expect(channelSpy).toHaveBeenCalledWith('cdc_invoices');

      // Switch table to 'disbursements'
      rerender({ table: 'disbursements' });
      expect(channelSpy).toHaveBeenCalledWith('cdc_disbursements');

      unmount();
    });

    it('handles rapid enabled prop toggling without dangling subscriptions', async () => {
      const { rerender, unmount } = renderHook(
        (props: { enabled: boolean }) =>
          useEntityRealtimeSync({ table: 'work_requests', enabled: props.enabled }),
        {
          initialProps: { enabled: true },
          wrapper: createWrapper(),
        }
      );

      for (let i = 0; i < 10; i++) {
        rerender({ enabled: false });
        rerender({ enabled: true });
      }

      unmount();
      await vi.waitFor(() => {
        const mockClient = supabase as unknown as MockSupabaseClient;
        const channels = mockClient.getChannels ? mockClient.getChannels() : [];
        expect(channels).toHaveLength(0);
      });
    });
  });
});
