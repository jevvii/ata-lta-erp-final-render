import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useEntityRealtimeSync,
  handleRealtimePayload,
  clearChannelRegistryForTesting,
} from '../useEntityRealtimeSync';
import { supabase, MockRealtimeChannel, MockSupabaseClient } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { resetTabIdForTesting } from '@/lib/tabSync';
import {
  trackLocalMutation,
  isLocalMutation,
  isSelfOriginatedPayload,
  clearLocalMutationsForTesting,
} from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';

interface TestEntity {
  id?: string;
  title?: string;
  version?: number;
  entity?: string;
  entity_id?: string | null;
  [key: string]: unknown;
}

describe('Empirical Adversarial Challenge Suite: useEntityRealtimeSync & Supabase Realtime', () => {
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
    resetTabIdForTesting('tab-empirical-challenger');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-empirical',
        email: 'admin@ata-lta.ph',
        name: 'Admin Empirical',
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
  // Challenge 1: Out-of-Order Versions, Monotonic Progression & Duplicate Bursts
  // =========================================================================
  describe('Challenge 1: Out-of-Order Versions, Monotonic Progression & Duplicate Bursts', () => {
    it('empirical oracle: verifies strict monotonic progression under 100 randomly permuted versions', () => {
      const entityId = 'wr-monotonic-100';

      // Seed initial cache at version 0
      queryClient.setQueryData(operationsKeys.workRequestDetail(entityId), {
        id: entityId,
        title: 'Initial V0',
        version: 0,
        entity: 'ATA',
      });

      // Generate 100 unique version numbers (1..100) and shuffle them with Fisher-Yates
      const versions = Array.from({ length: 100 }, (_, i) => i + 1);
      // Deterministic pseudorandom shuffle for reproducible empirical testing
      let seed = 42;
      const pseudoRandom = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };

      for (let i = versions.length - 1; i > 0; i--) {
        const j = Math.floor(pseudoRandom() * (i + 1));
        const temp = versions[i]!;
        versions[i] = versions[j]!;
        versions[j] = temp;
      }

      let runningMaxVersion = 0;
      let totalAccepted = 0;
      let totalRejected = 0;

      for (const ver of versions) {
        const payload = {
          eventType: 'UPDATE',
          new: {
            id: entityId,
            title: `Version-${ver}`,
            version: ver,
            entity: 'ATA',
          },
          old: { id: entityId, version: ver - 1 },
        };

        const result = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);

        if (ver > runningMaxVersion) {
          expect(result).toBe(true);
          runningMaxVersion = ver;
          totalAccepted++;
        } else {
          expect(result).toBe(false);
          totalRejected++;
        }

        // Cache must strictly reflect runningMaxVersion at all times
        const currentCache = queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail(entityId));
        expect(currentCache?.version).toBe(runningMaxVersion);
        expect(currentCache?.title).toBe(`Version-${runningMaxVersion}`);
      }

      expect(runningMaxVersion).toBe(100);
      expect(totalAccepted + totalRejected).toBe(100);
      expect(totalAccepted).toBeGreaterThan(0);
      expect(totalRejected).toBeGreaterThan(0);
    });

    it('interleaved multi-record stress: maintains independent monotonic version state across 10 records concurrently', () => {
      const recordCount = 10;
      const records = Array.from({ length: recordCount }, (_, i) => ({
        id: `wr-concurrent-${i}`,
        currentVersion: 0,
      }));

      // Seed all records in detail cache
      for (const rec of records) {
        queryClient.setQueryData(operationsKeys.workRequestDetail(rec.id), {
          id: rec.id,
          title: `Initial V0 for ${rec.id}`,
          version: 0,
          entity: 'ATA',
        });
      }

      // Generate 200 interleaved version events across all 10 records
      const events: Array<{ id: string; version: number }> = [];
      for (let i = 0; i < 200; i++) {
        const recIndex = i % recordCount;
        // Generate pseudo-random version jump between 1 and 50
        const randomVer = ((i * 17 + recIndex * 31) % 50) + 1;
        const targetRec = records[recIndex];
        if (targetRec) {
          events.push({ id: targetRec.id, version: randomVer });
        }
      }

      for (const evt of events) {
        const payload = {
          eventType: 'UPDATE',
          new: {
            id: evt.id,
            title: `Title V${evt.version}`,
            version: evt.version,
            entity: 'ATA',
          },
          old: { id: evt.id },
        };

        const result = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);

        const rec = records.find((r) => r.id === evt.id)!;
        if (evt.version >= rec.currentVersion) {
          expect(result).toBe(true);
          rec.currentVersion = evt.version;
        } else {
          expect(result).toBe(false);
        }

        const cached = queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail(evt.id));
        expect(cached?.version).toBe(rec.currentVersion);
        expect(cached?.title).toBe(`Title V${rec.currentVersion}`);
      }
    });

    it('handles zero and negative versions properly', () => {
      const entityId = 'wr-negative-ver';

      // Seed with version -1
      queryClient.setQueryData(operationsKeys.workRequestDetail(entityId), {
        id: entityId,
        title: 'V-1',
        version: -1,
        entity: 'ATA',
      });

      // Version 0 arrives (greater than -1) -> accepted
      const v0Payload = {
        eventType: 'UPDATE',
        new: { id: entityId, title: 'V0', version: 0, entity: 'ATA' },
      };
      const resV0 = handleRealtimePayload(queryClient, { table: 'work_requests' }, v0Payload);
      expect(resV0).toBe(true);

      // Version 0 arrives again as duplicate INSERT -> equal version, rejected
      const v0InsertDup = {
        eventType: 'INSERT',
        new: { id: entityId, title: 'V0 Duplicate Insert', version: 0, entity: 'ATA' },
      };
      const resV0Dup = handleRealtimePayload(queryClient, { table: 'work_requests' }, v0InsertDup);
      expect(resV0Dup).toBe(false);

      // Version -1 arrives -> lower version, rejected
      const vNegPayload = {
        eventType: 'UPDATE',
        new: { id: entityId, title: 'V-1 Stale', version: -1, entity: 'ATA' },
      };
      const resNeg = handleRealtimePayload(queryClient, { table: 'work_requests' }, vNegPayload);
      expect(resNeg).toBe(false);
    });

    it('handles non-numeric or missing versions gracefully without throwing', () => {
      const entityId = 'wr-non-numeric-ver';

      queryClient.setQueryData(operationsKeys.workRequestDetail(entityId), {
        id: entityId,
        title: 'V1',
        version: 1,
        entity: 'ATA',
      });

      // String version
      const stringVerPayload = {
        eventType: 'UPDATE',
        new: { id: entityId, title: 'V String', version: '2' as unknown as number, entity: 'ATA' },
      };
      expect(() => {
        const res = handleRealtimePayload(queryClient, { table: 'work_requests' }, stringVerPayload);
        // Guard 2 only checks `typeof incomingVersion === 'number'`. Non-numeric version bypasses Guard 2
        expect(typeof res).toBe('boolean');
      }).not.toThrow();

      // Undefined version
      const unversionedPayload = {
        eventType: 'UPDATE',
        new: { id: entityId, title: 'No Version', entity: 'ATA' },
      };
      expect(() => {
        const res = handleRealtimePayload(queryClient, { table: 'work_requests' }, unversionedPayload);
        expect(res).toBe(true);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // Challenge 2: Multi-Component Coexisting Subscriptions & Unmount Collision
  // =========================================================================
  describe('Challenge 2: Multi-Component Coexisting Channels & Teardown Collision', () => {
    it('maintains channel for remaining subscribers when 3 coexisting components unmount sequentially', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      // 1. Mount 3 distinct hook instances watching same table 'work_requests'
      const hookA = renderHook(() => useEntityRealtimeSync({ table: 'work_requests' }), {
        wrapper: createWrapper(),
      });
      const hookB = renderHook(() => useEntityRealtimeSync({ table: 'work_requests' }), {
        wrapper: createWrapper(),
      });
      const hookC = renderHook(() => useEntityRealtimeSync({ table: 'work_requests' }), {
        wrapper: createWrapper(),
      });

      // Channel should be requested and single multiplexed listener registered
      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');
      const ch = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      expect(ch).toBeDefined();

      // Emit event 1 -> All 3 hooks receive it and update cache
      act(() => {
        ch.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-triplet', title: 'Triple Mounted', version: 1, entity: 'ATA' },
        });
      });
      expect(
        queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail('wr-triplet'))?.title
      ).toBe('Triple Mounted');

      // 2. Unmount Hook A only
      hookA.unmount();
      await new Promise((r) => setTimeout(r, 10));

      // Underlying channel MUST NOT be removed yet because Hook B and C are still mounted!
      expect(removeChannelSpy).not.toHaveBeenCalled();

      // Emit event 2 -> Hook B and C still receive it and update cache
      act(() => {
        ch.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-triplet', title: 'After Hook A Unmount', version: 2, entity: 'ATA' },
        });
      });
      expect(
        queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail('wr-triplet'))?.title
      ).toBe('After Hook A Unmount');

      // 3. Unmount Hook B only
      hookB.unmount();
      await new Promise((r) => setTimeout(r, 10));

      // Channel MUST STILL NOT be removed because Hook C is still mounted!
      expect(removeChannelSpy).not.toHaveBeenCalled();

      // Emit event 3 -> Hook C still receives it
      act(() => {
        ch.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-triplet', title: 'After Hook B Unmount', version: 3, entity: 'ATA' },
        });
      });
      expect(
        queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail('wr-triplet'))?.title
      ).toBe('After Hook B Unmount');

      // 4. Finally unmount Hook C (all subscribers now gone)
      hookC.unmount();
      await new Promise((r) => setTimeout(r, 10));

      // NOW removeChannel must be called exactly once
      expect(removeChannelSpy).toHaveBeenCalledTimes(1);

      // Verify channel is removed from MockSupabaseClient
      const mockClient = supabase as unknown as MockSupabaseClient;
      expect(mockClient.getChannels()).toHaveLength(0);

      // 5. Mount a brand new Hook D on the same table
      const hookD = renderHook(() => useEntityRealtimeSync({ table: 'work_requests' }), {
        wrapper: createWrapper(),
      });

      const newCh = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      act(() => {
        newCh.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-triplet', title: 'Hook D Resurrected', version: 4, entity: 'ATA' },
        });
      });
      expect(
        queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail('wr-triplet'))?.title
      ).toBe('Hook D Resurrected');

      hookD.unmount();
    });

    it('stress oracle: 50 cycles of random mount/unmount batches leaves zero dangling channels', async () => {
      const mockClient = supabase as unknown as MockSupabaseClient;

      for (let cycle = 0; cycle < 50; cycle++) {
        // Mount 1 to 4 hooks
        const hookCount = (cycle % 4) + 1;
        const hooks = Array.from({ length: hookCount }, () =>
          renderHook(() => useEntityRealtimeSync({ table: 'invoices' }), {
            wrapper: createWrapper(),
          })
        );

        // Unmount in reverse order or arbitrary order
        for (const h of hooks) {
          h.unmount();
        }
      }

      await new Promise((r) => setTimeout(r, 10));
      expect(mockClient.getChannels()).toHaveLength(0);
    });
  });

  // =========================================================================
  // Challenge 3: Tenant Isolation, RFC 4122 UUID Case & Null Entity Handling
  // =========================================================================
  describe('Challenge 3: Tenant Isolation, RFC 4122 UUID Case & Null Entity Handling', () => {
    it('verifies RFC 4122 case-insensitive UUID matching across all casing permutations and whitespaces', () => {
      const baseUUID = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
      const upperUUID = 'A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D';
      const mixedUUID = 'A1b2C3d4-E5f6-7A8b-9C0d-1E2f3A4b5C6d';
      const whitespaceUUID = '  a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d  ';
      const whitespaceUpper = '  A1B2C3D4-E5F6-7A8B-9C0D-1E2F3A4B5C6D  ';

      const permutations = [baseUUID, upperUUID, mixedUUID, whitespaceUUID, whitespaceUpper];

      let caseIndex = 0;
      for (const sessionUUID of permutations) {
        for (const payloadUUID of permutations) {
          caseIndex++;
          const payload = {
            eventType: 'UPDATE',
            new: { id: `wr-uuid-test-${caseIndex}`, entity_id: payloadUUID, version: 1, title: 'Permutation' },
          };

          const result = handleRealtimePayload(
            queryClient,
            { table: 'work_requests', activeEntityUUID: sessionUUID },
            payload
          );

          // All permutations of the same UUID MUST match!
          expect(result).toBe(true);
        }
      }

      // Negative check: different UUID must be rejected
      const differentUUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const rejectPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-uuid-diff', entity_id: differentUUID, version: 1, title: 'Different' },
      };
      const rejectResult = handleRealtimePayload(
        queryClient,
        { table: 'work_requests', activeEntityUUID: baseUUID },
        rejectPayload
      );
      expect(rejectResult).toBe(false);
    });

    it('handles entity_id: null and entity: null strictly across all tenant states', () => {
      // 1. Session is 'ATA' -> entity_id: null MUST be dropped
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-empirical',
        email: 'admin@ata-lta.ph',
        name: 'Admin Empirical',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });
      const payloadNullId = {
        eventType: 'UPDATE',
        new: { id: 'wr-null-1', entity_id: null, version: 1 },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadNullId)).toBe(false);

      // 2. Session is 'ATA' -> entity: null MUST be dropped
      const payloadNullEntity = {
        eventType: 'UPDATE',
        new: { id: 'wr-null-2', entity: null as unknown as string, version: 1 },
      };
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadNullEntity)).toBe(false);

      // 3. Unassigned session (activeEntity: null) -> entity_id: null MUST be dropped
      useSessionStore.setState({ activeEntity: null });
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadNullId)).toBe(false);

      // 4. Session is 'ALL' -> entity_id: null MUST be accepted
      useSessionStore.setState({ activeEntity: 'ALL' });
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadNullId)).toBe(true);
    });

    it('drops tenant-scoped payloads when activeEntity is unassigned (null/undefined)', () => {
      useSessionStore.setState({ activeEntity: null });

      const ataPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-unassigned-1', entity: 'ATA', version: 1 },
      };
      const ltaPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-unassigned-2', entity_id: '123e4567-e89b-12d3-a456-426614174000', version: 1 },
      };

      // Both must be rejected because activeEntity is null and not 'ALL'
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, ataPayload)).toBe(false);
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, ltaPayload)).toBe(false);
    });

    it('un-partitioned tables (tasks) without entity fields pass Guard 1 cleanly under any session', () => {
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-empirical',
        email: 'admin@ata-lta.ph',
        name: 'Admin Empirical',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });
      const taskATA = {
        eventType: 'UPDATE',
        new: { id: 'task-no-entity-1', work_request_id: 'wr-1', version: 1 },
      };
      expect(handleRealtimePayload(queryClient, { table: 'tasks' }, taskATA)).toBe(true);

      useSessionStore.setState({ activeEntity: null });
      const taskUnassigned = {
        eventType: 'UPDATE',
        new: { id: 'task-no-entity-2', work_request_id: 'wr-2', version: 1 },
      };
      expect(handleRealtimePayload(queryClient, { table: 'tasks' }, taskUnassigned)).toBe(true);
    });
  });

  // =========================================================================
  // Challenge 4: Loop Prevention & Self-Origination
  // =========================================================================
  describe('Challenge 4: Loop Prevention & Tab Isolation', () => {
    it('drops self-originated mutations across camelCase and snake_case properties at root and nested levels', () => {
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-empirical',
        email: 'admin@ata-lta.ph',
        name: 'Admin Empirical',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });
      const myTab = 'tab-empirical-challenger';

      const cases = [
        { new: { id: 'wr-1', origin_tab_id: myTab, version: 1, entity: 'ATA' } },
        { new: { id: 'wr-2', originTabId: myTab, version: 1, entity: 'ATA' } },
        { origin_tab_id: myTab, new: { id: 'wr-3', version: 1, entity: 'ATA' } },
        { originTabId: myTab, new: { id: 'wr-4', version: 1, entity: 'ATA' } },
      ];

      for (const c of cases) {
        const payload = { eventType: 'UPDATE', ...c };
        expect(isSelfOriginatedPayload(payload)).toBe(true);
        expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, payload)).toBe(false);
      }

      // Foreign tab ID is allowed
      const foreignPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-foreign', origin_tab_id: 'tab-peer-777', version: 1, entity: 'ATA' },
      };
      expect(isSelfOriginatedPayload(foreignPayload)).toBe(false);
      expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, foreignPayload)).toBe(true);
    });

    it('suppresses 20 concurrent local mutations in local mutation registry with version pinning', () => {
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-empirical',
        email: 'admin@ata-lta.ph',
        name: 'Admin Empirical',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });

      for (let i = 0; i < 20; i++) {
        trackLocalMutation('work_requests', `wr-local-${i}`, i + 1);
      }

      for (let i = 0; i < 20; i++) {
        // Echo of same version is suppressed
        const echoPayload = {
          eventType: 'UPDATE',
          new: { id: `wr-local-${i}`, version: i + 1, entity: 'ATA' },
        };
        expect(isLocalMutation('work_requests', `wr-local-${i}`, i + 1)).toBe(true);
        expect(handleRealtimePayload(queryClient, { table: 'work_requests' }, echoPayload)).toBe(false);

        // Different version (external update) is NOT suppressed by local mutation guard
        // (though Guard 2 would check version order)
        expect(isLocalMutation('work_requests', `wr-local-${i}`, i + 2)).toBe(false);
      }
    });
  });

  // =========================================================================
  // Challenge 5: Cache Reconciliation Edge Cases
  // =========================================================================
  describe('Challenge 5: Cache Reconciliation Edge Cases', () => {
    it('handles DELETE payloads with old record and removes from both detail and list caches', () => {
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-empirical',
        email: 'admin@ata-lta.ph',
        name: 'Admin Empirical',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });

      // Seed detail and list cache
      queryClient.setQueryData(billingKeys.invoiceDetail('inv-del-1'), {
        id: 'inv-del-1',
        invoiceNumber: 'INV-DEL',
        version: 1,
        entity: 'ATA',
      });
      queryClient.setQueryData(billingKeys.invoicesList('ATA'), {
        data: [{ id: 'inv-del-1', invoiceNumber: 'INV-DEL', version: 1, entity: 'ATA' }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      const deletePayload = {
        eventType: 'DELETE',
        old: { id: 'inv-del-1', entity: 'ATA' },
      };

      const result = handleRealtimePayload(queryClient, { table: 'invoices' }, deletePayload);
      expect(result).toBe(true);

      expect(queryClient.getQueryData(billingKeys.invoiceDetail('inv-del-1'))).toBeUndefined();
      const list = queryClient.getQueryData<{ data: TestEntity[]; meta: { total: number } }>(
        billingKeys.invoicesList('ATA')
      );
      expect(list?.data).toHaveLength(0);
      expect(list?.meta?.total).toBe(0);
    });

    it('drops malformed or empty payloads safely with zero uncaught exceptions', () => {
      const weirdPayloads = [
        null,
        undefined,
        {},
        { eventType: 'UPDATE' },
        { new: null },
        { old: null },
        { new: { id: '' } },
        { new: { id: null } },
        { new: { id: undefined } },
      ];

      for (const p of weirdPayloads) {
        expect(() => {
          const res = handleRealtimePayload(queryClient, { table: 'work_requests' }, p);
          expect(res).toBe(false);
        }).not.toThrow();
      }
    });
  });
});
