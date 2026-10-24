/**
 * Challenger Stress Harness: Cache Reconciliation Shapes, Loop Prevention 10s TTL,
 * and Synchronous Channel Teardown in MockSupabaseClient.
 *
 * Authored by: teamwork_preview_challenger_m1_it2_2
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useEntityRealtimeSync,
  handleRealtimePayload,
  clearChannelRegistryForTesting,
} from '../useEntityRealtimeSync';
import {
  supabase,
  MockSupabaseClient,
  MockRealtimeChannel,
} from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { resetTabIdForTesting, getTabId } from '@/lib/tabSync';
import {
  trackLocalMutation,
  isLocalMutation,
  isSelfOriginatedPayload,
  clearLocalMutationsForTesting,
} from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';

describe('Empirical Challenger: Cache Shapes, 10s TTL Loop Prevention & Synchronous Teardown', () => {
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
    resetTabIdForTesting('challenger-tab-emp-1');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-challenger',
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
    vi.useRealTimers();
  });

  // =========================================================================
  // Section 1: Cache Shape Reconciliation ({ data: [...] } and [...])
  // =========================================================================
  describe('Section 1: Cache Shape Reconciliation Across List Shapes and Detail', () => {
    it('simultaneously updates wrapped { data: [...] }, raw [...], and detail query on UPDATE', () => {
      const wrappedKey1 = ['operations', 'workRequests', 'list', { status: 'PENDING' }];
      const wrappedKey2 = ['operations', 'workRequests', 'list', { status: 'ALL' }];
      const rawListKey = ['operations', 'workRequests', 'active'];
      const detailKey = operationsKeys.workRequestDetail('wr-shape-100');

      // 1. Wrapped list query 1: { data: [...], meta: {...} }
      queryClient.setQueryData(wrappedKey1, {
        data: [
          { id: 'wr-shape-100', title: 'Original 100', status: 'PENDING', version: 1, entity: 'ATA' },
          { id: 'wr-shape-101', title: 'Original 101', status: 'PENDING', version: 1, entity: 'ATA' },
        ],
        meta: { total: 2, page: 1, limit: 10 },
      });

      // 2. Wrapped list query 2: custom extra metadata
      queryClient.setQueryData(wrappedKey2, {
        data: [
          { id: 'wr-shape-100', title: 'Original 100', status: 'PENDING', version: 1, entity: 'ATA' },
        ],
        meta: { total: 1 },
        customField: 'preserved_value',
      });

      // 3. Raw array query: [...]
      queryClient.setQueryData(rawListKey, [
        { id: 'wr-shape-100', title: 'Original 100', status: 'PENDING', version: 1, entity: 'ATA' },
        { id: 'wr-shape-102', title: 'Original 102', status: 'PENDING', version: 1, entity: 'ATA' },
      ]);

      // 4. Detail query
      queryClient.setQueryData(detailKey, {
        id: 'wr-shape-100',
        title: 'Original 100',
        status: 'PENDING',
        notes: 'Important notes',
        version: 1,
        entity: 'ATA',
      });

      // Fire UPDATE CDC event
      const updatePayload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-shape-100',
          title: 'Updated 100',
          status: 'IN_PROGRESS',
          version: 2,
          entity: 'ATA',
        },
        old: { id: 'wr-shape-100', version: 1 },
      };

      const accepted = handleRealtimePayload(queryClient, { table: 'work_requests' }, updatePayload);
      expect(accepted).toBe(true);

      // Verify Wrapped list 1
      const q1 = queryClient.getQueryData<any>(wrappedKey1);
      expect(q1.data).toHaveLength(2);
      expect(q1.data[0].id).toBe('wr-shape-100');
      expect(q1.data[0].title).toBe('Updated 100');
      expect(q1.data[0].status).toBe('IN_PROGRESS');
      expect(q1.data[0].version).toBe(2);
      expect(q1.data[1].title).toBe('Original 101');
      expect(q1.meta.total).toBe(2);

      // Verify Wrapped list 2
      const q2 = queryClient.getQueryData<any>(wrappedKey2);
      expect(q2.data[0].title).toBe('Updated 100');
      expect(q2.data[0].status).toBe('IN_PROGRESS');
      expect(q2.customField).toBe('preserved_value');

      // Verify Raw array
      const raw = queryClient.getQueryData<any[]>(rawListKey);
      expect(raw).toHaveLength(2);
      expect(raw?.[0].title).toBe('Updated 100');
      expect(raw?.[0].status).toBe('IN_PROGRESS');
      expect(raw?.[1].title).toBe('Original 102');

      // Verify Detail cache (partial merge retains notes)
      const detail = queryClient.getQueryData<any>(detailKey);
      expect(detail.title).toBe('Updated 100');
      expect(detail.status).toBe('IN_PROGRESS');
      expect(detail.notes).toBe('Important notes');
      expect(detail.version).toBe(2);
    });

    it('handles INSERT across { data: [...] } and raw [...] with deduplication', () => {
      const wrappedKey = ['billing', 'invoices', 'list', 'p1'];
      const rawKey = ['billing', 'invoices', 'all'];

      queryClient.setQueryData(wrappedKey, {
        data: [{ id: 'inv-existing', invoiceNumber: 'INV-1', version: 1, entity: 'ATA' }],
        meta: { total: 1, page: 1 },
      });

      queryClient.setQueryData(rawKey, [
        { id: 'inv-existing', invoiceNumber: 'INV-1', version: 1, entity: 'ATA' },
      ]);

      const insertPayload = {
        eventType: 'INSERT',
        new: { id: 'inv-fresh', invoiceNumber: 'INV-FRESH', version: 1, entity: 'ATA' },
      };

      const res1 = handleRealtimePayload(queryClient, { table: 'invoices' }, insertPayload);
      expect(res1).toBe(true);

      // Detail cache created
      const detail = queryClient.getQueryData<any>(billingKeys.invoiceDetail('inv-fresh'));
      expect(detail.invoiceNumber).toBe('INV-FRESH');

      // Wrapped list prepended
      const wrapped = queryClient.getQueryData<any>(wrappedKey);
      expect(wrapped.data).toHaveLength(2);
      expect(wrapped.data[0].id).toBe('inv-fresh');
      expect(wrapped.meta.total).toBe(2);

      // Raw array prepended
      const raw = queryClient.getQueryData<any[]>(rawKey);
      expect(raw).toHaveLength(2);
      expect(raw?.[0].id).toBe('inv-fresh');

      // Duplicate unversioned INSERT: should NOT duplicate item in list
      const duplicateInsertPayload = {
        eventType: 'INSERT',
        new: { id: 'inv-fresh', invoiceNumber: 'INV-FRESH', entity: 'ATA' },
      };
      const res2 = handleRealtimePayload(queryClient, { table: 'invoices' }, duplicateInsertPayload);
      expect(res2).toBe(true);

      const wrappedAfterDup = queryClient.getQueryData<any>(wrappedKey);
      expect(wrappedAfterDup.data).toHaveLength(2);

      const rawAfterDup = queryClient.getQueryData<any[]>(rawKey);
      expect(rawAfterDup).toHaveLength(2);
    });

    it('handles DELETE across { data: [...] } and raw [...] and clamps meta.total to zero', () => {
      const wrappedKey = [...disbursementKeys.lists(), 'page1'];
      const rawKey = [...disbursementKeys.lists(), 'summary'];
      const detailKey = disbursementKeys.detail('disb-del-1');

      queryClient.setQueryData(wrappedKey, {
        data: [{ id: 'disb-del-1', amount: 500, version: 1, entity: 'ATA' }],
        meta: { total: 1 },
      });

      queryClient.setQueryData(rawKey, [
        { id: 'disb-del-1', amount: 500, version: 1, entity: 'ATA' },
      ]);

      queryClient.setQueryData(detailKey, {
        id: 'disb-del-1',
        amount: 500,
        version: 1,
        entity: 'ATA',
      });

      const deletePayload = {
        eventType: 'DELETE',
        old: { id: 'disb-del-1', entity: 'ATA' },
      };

      const res = handleRealtimePayload(queryClient, { table: 'disbursements' }, deletePayload);
      expect(res).toBe(true);

      // Detail removed
      expect(queryClient.getQueryData(detailKey)).toBeUndefined();

      // Wrapped list empty, total clamped to 0
      const wrapped = queryClient.getQueryData<any>(wrappedKey);
      expect(wrapped.data).toHaveLength(0);
      expect(wrapped.meta.total).toBe(0);

      // Raw array empty
      const raw = queryClient.getQueryData<any[]>(rawKey);
      expect(raw).toHaveLength(0);
    });

    it('stress test: manages 50 heterogeneous query caches simultaneously under high mutation load', () => {
      const targetId = 'wr-stress-hetero';

      // Seed 25 wrapped queries and 25 raw queries
      for (let i = 0; i < 25; i++) {
        queryClient.setQueryData(['operations', 'workRequests', 'filter', i], {
          data: [
            { id: targetId, title: 'Stress Target', version: 1, entity: 'ATA' },
            { id: `wr-other-${i}`, title: `Other ${i}`, version: 1, entity: 'ATA' },
          ],
          meta: { total: 2, filterIndex: i },
        });
      }

      for (let i = 25; i < 50; i++) {
        queryClient.setQueryData(['operations', 'workRequests', 'raw', i], [
          { id: targetId, title: 'Stress Target', version: 1, entity: 'ATA' },
          { id: `wr-other-${i}`, title: `Other ${i}`, version: 1, entity: 'ATA' },
        ]);
      }

      // Mutate targetId through 5 version increments
      for (let ver = 2; ver <= 6; ver++) {
        const payload = {
          eventType: 'UPDATE',
          new: { id: targetId, title: `Stress Target V${ver}`, version: ver, entity: 'ATA' },
          old: { id: targetId, version: ver - 1 },
        };
        const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);
        expect(processed).toBe(true);
      }

      // Verify all 25 wrapped queries updated correctly
      for (let i = 0; i < 25; i++) {
        const q = queryClient.getQueryData<any>(['operations', 'workRequests', 'filter', i]);
        expect(q.data[0].version).toBe(6);
        expect(q.data[0].title).toBe('Stress Target V6');
        expect(q.data[1].id).toBe(`wr-other-${i}`);
        expect(q.meta.total).toBe(2);
      }

      // Verify all 25 raw queries updated correctly
      for (let i = 25; i < 50; i++) {
        const raw = queryClient.getQueryData<any[]>(['operations', 'workRequests', 'raw', i]);
        expect(raw?.[0].version).toBe(6);
        expect(raw?.[0].title).toBe('Stress Target V6');
        expect(raw?.[1].id).toBe(`wr-other-${i}`);
      }
    });
  });

  // =========================================================================
  // Section 2: Loop Prevention & 10s TTL Stress Tests
  // =========================================================================
  describe('Section 2: Loop Prevention Registry & 10s TTL Boundary Enforcement', () => {
    it('empirically enforces precise 10s (10,000ms) TTL expiration window', () => {
      vi.useFakeTimers();

      const table = 'work_requests';
      const id = 'wr-ttl-exact';
      const version = 3;

      trackLocalMutation(table, id, version);

      // t = 0ms: active
      expect(isLocalMutation(table, id, version)).toBe(true);

      // Advance 5,000ms: still active
      vi.advanceTimersByTime(5000);
      expect(isLocalMutation(table, id, version)).toBe(true);

      // Advance 4,999ms (t = 9,999ms): still active
      vi.advanceTimersByTime(4999);
      expect(isLocalMutation(table, id, version)).toBe(true);

      // Advance 1ms (t = 10,000ms): exact threshold
      vi.advanceTimersByTime(1);
      expect(isLocalMutation(table, id, version)).toBe(true);

      // Advance 1ms (t = 10,001ms): expired!
      vi.advanceTimersByTime(1);
      expect(isLocalMutation(table, id, version)).toBe(false);
    });

    it('suppresses self-originated updates within TTL window across all 4 tables', () => {
      const tables: Array<'work_requests' | 'tasks' | 'invoices' | 'disbursements'> = [
        'work_requests',
        'tasks',
        'invoices',
        'disbursements',
      ];

      for (const tbl of tables) {
        const id = `${tbl}-loop-test`;
        trackLocalMutation(tbl, id, 2);

        // Echo payload within TTL window
        const echoPayload = {
          eventType: 'UPDATE',
          new: { id, version: 2, entity: 'ATA', title: `${tbl} Echo` },
          old: { id, version: 1 },
        };

        const result = handleRealtimePayload(queryClient, { table: tbl }, echoPayload);
        expect(result).toBe(false); // Dropped by Guard 3!
      }
    });

    it('unversioned tracking suppresses all versions during TTL window, and allows them post-expiry', () => {
      vi.useFakeTimers();

      const table = 'invoices';
      const id = 'inv-unversioned';

      trackLocalMutation(table, id);

      // During TTL, any version is suppressed
      expect(isLocalMutation(table, id, 1)).toBe(true);
      expect(isLocalMutation(table, id, 2)).toBe(true);
      expect(isLocalMutation(table, id, 100)).toBe(true);

      // Advance 10,001ms
      vi.advanceTimersByTime(10001);

      // Post-expiry, mutations are no longer suppressed
      expect(isLocalMutation(table, id, 1)).toBe(false);
      expect(isLocalMutation(table, id, 2)).toBe(false);
      expect(isLocalMutation(table, id, 100)).toBe(false);
    });

    it('handles staggered multiple mutations with independent TTL expirations', () => {
      vi.useFakeTimers();

      // Mutation A at t = 0
      trackLocalMutation('work_requests', 'wr-a', 1);

      // Advance 4,000ms
      vi.advanceTimersByTime(4000);

      // Mutation B at t = 4,000ms
      trackLocalMutation('work_requests', 'wr-b', 1);

      // Advance 6,001ms (t = 10,001ms from start)
      vi.advanceTimersByTime(6001);

      // Mutation A should be expired (> 10s)
      expect(isLocalMutation('work_requests', 'wr-a', 1)).toBe(false);

      // Mutation B should STILL be active (only ~6s old)
      expect(isLocalMutation('work_requests', 'wr-b', 1)).toBe(true);

      // Advance another 4,000ms (t = 14,001ms from start)
      vi.advanceTimersByTime(4000);

      // Now Mutation B should also be expired (> 10s from t=4s)
      expect(isLocalMutation('work_requests', 'wr-b', 1)).toBe(false);
    });

    it('detects current tab origin across snake_case, camelCase, and top-level properties', () => {
      const myTab = getTabId();
      expect(myTab).toBe('challenger-tab-emp-1');

      // 1. new.origin_tab_id
      expect(
        isSelfOriginatedPayload({
          eventType: 'UPDATE',
          new: { id: 'x', origin_tab_id: myTab },
        })
      ).toBe(true);

      // 2. new.originTabId
      expect(
        isSelfOriginatedPayload({
          eventType: 'UPDATE',
          new: { id: 'x', originTabId: myTab },
        })
      ).toBe(true);

      // 3. top-level origin_tab_id
      expect(
        isSelfOriginatedPayload({
          origin_tab_id: myTab,
          eventType: 'DELETE',
          old: { id: 'x' },
        })
      ).toBe(true);

      // 4. top-level originTabId
      expect(
        isSelfOriginatedPayload({
          originTabId: myTab,
          eventType: 'DELETE',
          old: { id: 'x' },
        })
      ).toBe(true);

      // 5. foreign tab id -> not self
      expect(
        isSelfOriginatedPayload({
          eventType: 'UPDATE',
          new: { id: 'x', origin_tab_id: 'tab-peer-foreign-99' },
        })
      ).toBe(false);
    });
  });

  // =========================================================================
  // Section 3: Synchronous Channel Cleanup in MockSupabaseClient
  // =========================================================================
  describe('Section 3: Synchronous Channel Cleanup in MockSupabaseClient', () => {
    it('immediately deletes channel from getChannels synchronously without awaiting removeChannel', () => {
      const mockClient = new MockSupabaseClient();
      const ch1 = mockClient.channel('sync-test-1');
      const ch2 = mockClient.channel('sync-test-2');

      expect(mockClient.getChannels()).toHaveLength(2);
      expect(mockClient.getChannel('sync-test-1')).toBe(ch1);

      // Remove ch1 synchronously (no await)
      const promise1 = mockClient.removeChannel(ch1);
      expect(promise1).toBeInstanceOf(Promise);

      // Invariant: channel MUST be synchronously removed immediately from map
      expect(mockClient.getChannels()).toHaveLength(1);
      expect(mockClient.getChannel('sync-test-1')).toBeUndefined();
      expect(mockClient.getChannel('sync-test-2')).toBe(ch2);

      // Remove ch2 by string name synchronously (no await)
      void mockClient.removeChannel('sync-test-2');
      expect(mockClient.getChannels()).toHaveLength(0);
      expect(mockClient.getChannel('sync-test-2')).toBeUndefined();
    });

    it('immediately clears all channels synchronously without awaiting removeAllChannels', () => {
      const mockClient = new MockSupabaseClient();
      for (let i = 0; i < 20; i++) {
        mockClient.channel(`batch-ch-${i}`);
      }
      expect(mockClient.getChannels()).toHaveLength(20);

      // Call removeAllChannels without awaiting
      const promiseAll = mockClient.removeAllChannels();
      expect(promiseAll).toBeInstanceOf(Promise);

      // Invariant: channels MUST be immediately empty
      expect(mockClient.getChannels()).toHaveLength(0);
      for (let i = 0; i < 20; i++) {
        expect(mockClient.getChannel(`batch-ch-${i}`)).toBeUndefined();
      }
    });

    it('is idempotent and handles non-existent or null channels gracefully', async () => {
      const mockClient = new MockSupabaseClient();
      const ch = mockClient.channel('idem-ch');

      await mockClient.removeChannel(ch);
      expect(mockClient.getChannels()).toHaveLength(0);

      // Second removal of already removed channel: must not throw
      await expect(mockClient.removeChannel(ch)).resolves.toBe('ok');

      // Removal of non-existent string: must not throw
      await expect(mockClient.removeChannel('does-not-exist')).resolves.toBe('ok');

      // Removal with null/undefined: must not throw
      await expect(mockClient.removeChannel(null as any)).resolves.toBe('ok');
      await expect(mockClient.removeChannel(undefined as any)).resolves.toBe('ok');
    });

    it('resolves channel unsubscribe status to CLOSED and resets listeners', async () => {
      const mockClient = new MockSupabaseClient();
      const ch = mockClient.channel('status-test');
      ch.subscribe();
      expect(ch.status).toBe('SUBSCRIBED');

      ch.on('postgres_changes', { event: '*' }, () => {});
      expect(ch.getListeners()).toHaveLength(1);

      await mockClient.removeChannel(ch);
      expect(ch.status).toBe('CLOSED');
      expect(ch.getListeners()).toHaveLength(0);
    });

    it('stress test: 100 rapid concurrent channels created and removed synchronously', () => {
      const mockClient = new MockSupabaseClient();
      const createdChannels: MockRealtimeChannel[] = [];

      for (let i = 0; i < 100; i++) {
        createdChannels.push(mockClient.channel(`stress-${i}`));
      }
      expect(mockClient.getChannels()).toHaveLength(100);

      // Synchronously remove half by instance, half by name
      for (let i = 0; i < 50; i++) {
        void mockClient.removeChannel(createdChannels[i]!);
      }
      expect(mockClient.getChannels()).toHaveLength(50);

      for (let i = 50; i < 100; i++) {
        void mockClient.removeChannel(`stress-${i}`);
      }
      expect(mockClient.getChannels()).toHaveLength(0);
    });

    it('concurrent removal with Promise.all on identical channel is fully thread-safe and idempotent', async () => {
      const mockClient = new MockSupabaseClient();
      const ch = mockClient.channel('concurrent-del');
      expect(mockClient.getChannels()).toHaveLength(1);

      const results = await Promise.all([
        mockClient.removeChannel(ch),
        mockClient.removeChannel(ch),
        mockClient.removeChannel('concurrent-del'),
        mockClient.removeChannel(ch),
      ]);

      expect(results).toEqual(['ok', 'ok', 'ok', 'ok']);
      expect(mockClient.getChannels()).toHaveLength(0);
    });

    it('events emitted on removed channels do not trigger listeners', async () => {
      const mockClient = new MockSupabaseClient();
      const ch = mockClient.channel('dead-channel');
      const listener = vi.fn();
      ch.on('postgres_changes', { event: '*' }, listener);

      // Emit before removal
      ch.emit('postgres_changes', { eventType: 'INSERT', new: { id: 'x' } });
      expect(listener).toHaveBeenCalledTimes(1);

      // Remove channel
      await mockClient.removeChannel(ch);

      // Emit after removal
      ch.emit('postgres_changes', { eventType: 'INSERT', new: { id: 'y' } });
      expect(listener).toHaveBeenCalledTimes(1); // not called again!
    });

    it('ref-counted hook lifecycle: multi-mount on same table keeps channel open until last unmount', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const hook1 = renderHook(() => useEntityRealtimeSync({ table: 'work_requests' }), {
        wrapper: createWrapper(),
      });
      const hook2 = renderHook(() => useEntityRealtimeSync({ table: 'work_requests' }), {
        wrapper: createWrapper(),
      });

      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');

      // Unmount hook1: underlying channel MUST NOT be removed yet
      hook1.unmount();
      expect(removeChannelSpy).not.toHaveBeenCalled();

      // Hook2 continues receiving events
      const ch = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      act(() => {
        ch.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-refcount', entity: 'ATA', title: 'Hook2 Still Listens', version: 1 },
        });
      });

      const cached = queryClient.getQueryData<any>(operationsKeys.workRequestDetail('wr-refcount'));
      expect(cached?.title).toBe('Hook2 Still Listens');

      // Unmount hook2: now channel is removed
      hook2.unmount();
      expect(removeChannelSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Section 4: Boundary & Malformed Inputs Across Guards
  // =========================================================================
  describe('Section 4: Boundary Inputs & Zero Mutation Guarantees', () => {
    it('correctly handles version 0 tracking in local mutation registry', () => {
      trackLocalMutation('work_requests', 'wr-zero-ver', 0);
      expect(isLocalMutation('work_requests', 'wr-zero-ver', 0)).toBe(true);

      // Different version does not match
      expect(isLocalMutation('work_requests', 'wr-zero-ver', 1)).toBe(false);

      // Payload with version 0 is dropped
      const payloadZero = {
        eventType: 'UPDATE',
        new: { id: 'wr-zero-ver', version: 0, entity: 'ATA' },
      };
      const dropped = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadZero);
      expect(dropped).toBe(false);
    });

    it('guarantees TanStack Query cache is completely unmodified when any guard rejects payload', () => {
      const initialDetail = { id: 'wr-untouched', title: 'Immutable Original', version: 10, entity: 'ATA' };
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-untouched'), initialDetail);

      // 1. Rejected by Guard 1 (Cross Tenant)
      const crossTenantPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-untouched', title: 'Attacked by LTA', version: 11, entity: 'LTA' },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, crossTenantPayload)).toBe(false);
      expect(queryClient.getQueryData(operationsKeys.workRequestDetail('wr-untouched'))).toEqual(initialDetail);

      // 2. Rejected by Guard 2 (Stale version)
      const stalePayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-untouched', title: 'Stale Version Attack', version: 9, entity: 'ATA' },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, stalePayload)).toBe(false);
      expect(queryClient.getQueryData(operationsKeys.workRequestDetail('wr-untouched'))).toEqual(initialDetail);

      // 3. Rejected by Guard 3 (Self-originated origin tab)
      const selfPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-untouched', title: 'Self Loop Attack', version: 12, entity: 'ATA', origin_tab_id: getTabId() },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, selfPayload)).toBe(false);
      expect(queryClient.getQueryData(operationsKeys.workRequestDetail('wr-untouched'))).toEqual(initialDetail);

      // 4. Rejected by Guard 3 (Local mutation registry)
      trackLocalMutation('work_requests', 'wr-untouched', 13);
      const localEchoPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-untouched', title: 'Local Mutation Echo', version: 13, entity: 'ATA' },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, localEchoPayload)).toBe(false);
      expect(queryClient.getQueryData(operationsKeys.workRequestDetail('wr-untouched'))).toEqual(initialDetail);
    });

    it('safely handles empty cache lists on UPDATE and DELETE without exceptions or negative totals', () => {
      const emptyWrappedKey = ['operations', 'workRequests', 'list', 'empty'];
      const emptyRawKey = ['operations', 'workRequests', 'raw', 'empty'];

      queryClient.setQueryData(emptyWrappedKey, { data: [], meta: { total: 0 } });
      queryClient.setQueryData(emptyRawKey, []);

      // UPDATE on non-existent item (with standard CDC old record)
      const updateNonExistent = {
        eventType: 'UPDATE',
        new: { id: 'wr-none', title: 'None', version: 1, entity: 'ATA' },
        old: { id: 'wr-none', version: 0 },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, updateNonExistent)).toBe(true);

      const wrappedAfterUpd = queryClient.getQueryData<any>(emptyWrappedKey);
      expect(wrappedAfterUpd.data).toHaveLength(0);
      expect(wrappedAfterUpd.meta.total).toBe(0);

      // DELETE on non-existent item
      const deleteNonExistent = {
        eventType: 'DELETE',
        old: { id: 'wr-none', entity: 'ATA' },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, deleteNonExistent)).toBe(true);

      const wrappedAfterDel = queryClient.getQueryData<any>(emptyWrappedKey);
      expect(wrappedAfterDel.data).toHaveLength(0);
      expect(wrappedAfterDel.meta.total).toBe(0); // Clamped, not -1!
    });
  });
});
