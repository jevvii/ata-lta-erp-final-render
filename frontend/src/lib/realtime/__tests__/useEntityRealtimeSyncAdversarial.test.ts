import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEntityRealtimeSync, handleRealtimePayload } from '../useEntityRealtimeSync';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { getTabId, resetTabIdForTesting } from '@/lib/tabSync';
import {
  trackLocalMutation,
  isLocalMutation,
  isSelfOriginatedPayload,
  clearLocalMutationsForTesting,
} from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';

describe('Adversarial & Stress Tests: CDC Realtime Hook & Loop Prevention', () => {
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
    resetTabIdForTesting('tab-challenger-01');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-adversarial',
        email: 'admin@ata-lta.ph',
        name: 'Admin Adversarial',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    queryClient.clear();
    localStorage.clear();
    clearLocalMutationsForTesting();
    resetTabIdForTesting();
    vi.useRealTimers();
  });

  // =========================================================================
  // Dimension 1: Multi-Query List Caches & Heterogeneous Cache Shapes
  // =========================================================================
  describe('Dimension 1: Multi-Query List Caches & Heterogeneous Cache Shapes', () => {
    it('correctly updates matching queries and preserves unrelated queries under listRootKey on UPDATE', () => {
      const page1Key = ['operations', 'workRequests', 'list', { page: 1 }];
      const page2Key = ['operations', 'workRequests', 'list', { page: 2 }];
      const rawListKey = ['operations', 'workRequests', 'recent'];
      const unrelatedListKey = ['operations', 'workRequests', 'archived'];

      // Query 1: standard { data: [...], meta: {...} } shape
      queryClient.setQueryData(page1Key, {
        data: [
          { id: 'wr-1', title: 'WR 1 Initial', status: 'DRAFT', version: 1, entity: 'ATA' },
          { id: 'wr-2', title: 'WR 2 Initial', status: 'DRAFT', version: 1, entity: 'ATA' },
        ],
        meta: { total: 2, page: 1, limit: 10 },
      });

      // Query 2: second page not containing wr-1
      queryClient.setQueryData(page2Key, {
        data: [
          { id: 'wr-3', title: 'WR 3 Initial', status: 'DRAFT', version: 1, entity: 'ATA' },
        ],
        meta: { total: 3, page: 2, limit: 10 },
      });

      // Query 3: direct raw array shape [...]
      queryClient.setQueryData(rawListKey, [
        { id: 'wr-1', title: 'WR 1 Initial', status: 'DRAFT', version: 1, entity: 'ATA' },
        { id: 'wr-9', title: 'WR 9 Initial', status: 'DRAFT', version: 1, entity: 'ATA' },
      ]);

      // Query 4: list without wr-1
      queryClient.setQueryData(unrelatedListKey, {
        data: [
          { id: 'wr-99', title: 'Archived WR', status: 'ARCHIVED', version: 1, entity: 'ATA' },
        ],
        meta: { total: 1 },
      });

      // Detail query cache
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-1'), {
        id: 'wr-1',
        title: 'WR 1 Initial',
        status: 'DRAFT',
        version: 1,
        entity: 'ATA',
      });

      const updatePayload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-1',
          title: 'WR 1 Mutated',
          status: 'APPROVED',
          version: 2,
          entity: 'ATA',
        },
        old: { id: 'wr-1', version: 1, entity: 'ATA' },
      };

      const result = handleRealtimePayload(queryClient, { table: 'work_requests' }, updatePayload);
      expect(result).toBe(true);

      // Verify Page 1: wr-1 updated, wr-2 untouched, meta preserved
      const page1 = queryClient.getQueryData<any>(page1Key);
      expect(page1.data[0].title).toBe('WR 1 Mutated');
      expect(page1.data[0].status).toBe('APPROVED');
      expect(page1.data[0].version).toBe(2);
      expect(page1.data[1].title).toBe('WR 2 Initial');
      expect(page1.meta.total).toBe(2);

      // Verify Page 2: completely untouched
      const page2 = queryClient.getQueryData<any>(page2Key);
      expect(page2.data).toHaveLength(1);
      expect(page2.data[0].id).toBe('wr-3');

      // Verify Raw array: wr-1 updated, wr-9 untouched
      const rawList = queryClient.getQueryData<any[]>(rawListKey);
      expect(rawList?.[0].title).toBe('WR 1 Mutated');
      expect(rawList?.[1].title).toBe('WR 9 Initial');

      // Verify Unrelated list: untouched
      const unrelated = queryClient.getQueryData<any>(unrelatedListKey);
      expect(unrelated.data[0].id).toBe('wr-99');

      // Verify Detail cache updated
      const detail = queryClient.getQueryData<any>(operationsKeys.workRequestDetail('wr-1'));
      expect(detail.title).toBe('WR 1 Mutated');
      expect(detail.status).toBe('APPROVED');
      expect(detail.version).toBe(2);
    });

    it('prepends on INSERT across multiple list formats and does not create duplicate items', () => {
      const pageKey = ['billing', 'invoices', 'list', 'ATA'];
      const rawKey = ['billing', 'invoices', 'active'];

      queryClient.setQueryData(pageKey, {
        data: [{ id: 'inv-existing', invoiceNumber: 'INV-100', version: 1, entity: 'ATA' }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      queryClient.setQueryData(rawKey, [
        { id: 'inv-existing', invoiceNumber: 'INV-100', version: 1, entity: 'ATA' },
      ]);

      const insertPayload = {
        eventType: 'INSERT',
        new: { id: 'inv-new', invoiceNumber: 'INV-200', version: 1, entity: 'ATA' },
      };

      const res1 = handleRealtimePayload(queryClient, { table: 'invoices' }, insertPayload);
      expect(res1).toBe(true);

      const pageAfterInsert = queryClient.getQueryData<any>(pageKey);
      expect(pageAfterInsert.data).toHaveLength(2);
      expect(pageAfterInsert.data[0].id).toBe('inv-new');
      expect(pageAfterInsert.meta.total).toBe(2);

      const rawAfterInsert = queryClient.getQueryData<any[]>(rawKey);
      expect(rawAfterInsert).toHaveLength(2);
      expect(rawAfterInsert?.[0].id).toBe('inv-new');

      // 1. Fire duplicate INSERT with same version (1) -> Guard 2 drops it
      const res2 = handleRealtimePayload(queryClient, { table: 'invoices' }, insertPayload);
      expect(res2).toBe(false); // Discarded by Guard 2 (equal version)

      // Verify list remains length 2 (no duplicate items)
      const pageAfterDuplicate = queryClient.getQueryData<any>(pageKey);
      expect(pageAfterDuplicate.data).toHaveLength(2);

      // 2. Fire duplicate INSERT without version (bypassing Guard 2) -> list reconciliation prevents duplicate
      const unversionedInsertPayload = {
        eventType: 'INSERT',
        new: { id: 'inv-new', invoiceNumber: 'INV-200', entity: 'ATA' },
      };
      const res3 = handleRealtimePayload(queryClient, { table: 'invoices' }, unversionedInsertPayload);
      expect(res3).toBe(true);

      // Verify list STILL remains length 2 (deduplication check prevented duplicate entry)
      const pageAfterUnversionedDuplicate = queryClient.getQueryData<any>(pageKey);
      expect(pageAfterUnversionedDuplicate.data).toHaveLength(2);
      const rawAfterUnversionedDuplicate = queryClient.getQueryData<any[]>(rawKey);
      expect(rawAfterUnversionedDuplicate).toHaveLength(2);
    });

    it('removes on DELETE and clamps meta.total gracefully across list formats', () => {
      const pageKey = ['disbursements', 'list', 'p1'];
      const rawKey = ['disbursements', 'list', 'recent'];

      queryClient.setQueryData(pageKey, {
        data: [{ id: 'disb-target', referenceNumber: 'REF-1', version: 1, entity: 'ATA' }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      queryClient.setQueryData(rawKey, [
        { id: 'disb-target', referenceNumber: 'REF-1', version: 1, entity: 'ATA' },
        { id: 'disb-other', referenceNumber: 'REF-2', version: 1, entity: 'ATA' },
      ]);

      const deletePayload = {
        eventType: 'DELETE',
        old: { id: 'disb-target', entity: 'ATA' },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'disbursements' }, deletePayload);
      expect(processed).toBe(true);

      const pageAfterDelete = queryClient.getQueryData<any>(pageKey);
      expect(pageAfterDelete.data).toHaveLength(0);
      expect(pageAfterDelete.meta.total).toBe(0);

      const rawAfterDelete = queryClient.getQueryData<any[]>(rawKey);
      expect(rawAfterDelete).toHaveLength(1);
      expect(rawAfterDelete?.[0].id).toBe('disb-other');
    });
  });

  // =========================================================================
  // Dimension 2: Cache Resilience Under Missing Fields & Non-Existent Items
  // =========================================================================
  describe('Dimension 2: Resilience Against Missing Fields & Non-Existent Items', () => {
    it('preserves existing entity fields when an UPDATE payload contains only partial fields', () => {
      // Existing rich detail and list cache
      const initialRecord = {
        id: 'wr-partial-1',
        title: 'Full Request Title',
        description: 'Detailed description of work',
        priority: 'HIGH',
        estimatedHours: 40,
        version: 1,
        entity: 'ATA',
      };

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-partial-1'), initialRecord);
      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [initialRecord],
        meta: { total: 1 },
      });

      // Partial update containing ONLY status and version bump
      const partialUpdatePayload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-partial-1',
          status: 'IN_PROGRESS',
          version: 2,
          entity: 'ATA',
        },
        old: { id: 'wr-partial-1', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, partialUpdatePayload);
      expect(processed).toBe(true);

      // Detail cache must retain title, description, priority, and estimatedHours!
      const updatedDetail = queryClient.getQueryData<any>(operationsKeys.workRequestDetail('wr-partial-1'));
      expect(updatedDetail.id).toBe('wr-partial-1');
      expect(updatedDetail.title).toBe('Full Request Title');
      expect(updatedDetail.description).toBe('Detailed description of work');
      expect(updatedDetail.priority).toBe('HIGH');
      expect(updatedDetail.estimatedHours).toBe(40);
      expect(updatedDetail.status).toBe('IN_PROGRESS');
      expect(updatedDetail.version).toBe(2);

      // List cache must also retain all merged properties
      const updatedList = queryClient.getQueryData<any>(operationsKeys.workRequestsList('ATA'));
      expect(updatedList.data[0].title).toBe('Full Request Title');
      expect(updatedList.data[0].status).toBe('IN_PROGRESS');
      expect(updatedList.data[0].version).toBe(2);
    });

    it('does not corrupt list cache when UPDATE or DELETE arrives for non-existent item', () => {
      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [
          { id: 'wr-real-1', title: 'Real 1', version: 1, entity: 'ATA' },
          { id: 'wr-real-2', title: 'Real 2', version: 1, entity: 'ATA' },
        ],
        meta: { total: 2 },
      });

      // UPDATE for item not in list
      const nonExistentUpdate = {
        eventType: 'UPDATE',
        new: { id: 'wr-ghost-99', title: 'Ghost', version: 1, entity: 'ATA' },
        old: { id: 'wr-ghost-99', version: 0 },
      };

      const resUpdate = handleRealtimePayload(queryClient, { table: 'work_requests' }, nonExistentUpdate);
      expect(resUpdate).toBe(true);

      const listAfterUpdate = queryClient.getQueryData<any>(operationsKeys.workRequestsList('ATA'));
      expect(listAfterUpdate.data).toHaveLength(2);
      expect(listAfterUpdate.data.some((i: any) => i.id === 'wr-ghost-99')).toBe(false);

      // DELETE for item not in list
      const nonExistentDelete = {
        eventType: 'DELETE',
        old: { id: 'wr-ghost-99', entity: 'ATA' },
      };

      const resDelete = handleRealtimePayload(queryClient, { table: 'work_requests' }, nonExistentDelete);
      expect(resDelete).toBe(true);

      const listAfterDelete = queryClient.getQueryData<any>(operationsKeys.workRequestsList('ATA'));
      expect(listAfterDelete.data).toHaveLength(2);
      expect(listAfterDelete.meta.total).toBe(2); // total should NOT be decremented!
    });

    it('survives corrupted cache entries (nulls, primitives, sparse arrays) without throwing', () => {
      // 1. Primitive query
      queryClient.setQueryData(['operations', 'workRequests', 'count-query'], 42);

      // 2. Query with null data
      queryClient.setQueryData(['operations', 'workRequests', 'null-data'], { data: null });

      // 3. Query with sparse raw array containing null/undefined
      queryClient.setQueryData(['operations', 'workRequests', 'sparse-raw'], [
        null,
        undefined,
        { id: 'wr-survivor', title: 'Survivor', version: 1, entity: 'ATA' },
      ]);

      // 4. Query with sparse { data: [...] }
      queryClient.setQueryData(['operations', 'workRequests', 'sparse-wrapped'], {
        data: [
          null,
          undefined,
          { id: 'wr-survivor', title: 'Survivor', version: 1, entity: 'ATA' },
        ],
      });

      const updatePayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-survivor', title: 'Survivor Updated', version: 2, entity: 'ATA' },
        old: { id: 'wr-survivor', version: 1 },
      };

      expect(() => {
        handleRealtimePayload(queryClient, { table: 'work_requests' }, updatePayload);
      }).not.toThrow();

      // Check sparse raw
      const raw = queryClient.getQueryData<any[]>(['operations', 'workRequests', 'sparse-raw']);
      expect(raw?.[0]).toBeNull();
      expect(raw?.[1]).toBeUndefined();
      expect(raw?.[2].title).toBe('Survivor Updated');

      // Check sparse wrapped
      const wrapped = queryClient.getQueryData<any>(['operations', 'workRequests', 'sparse-wrapped']);
      expect(wrapped.data[0]).toBeNull();
      expect(wrapped.data[2].title).toBe('Survivor Updated');

      // Check primitive unaffected
      expect(queryClient.getQueryData(['operations', 'workRequests', 'count-query'])).toBe(42);
    });

    it('safely drops completely malformed payloads', () => {
      const hostilePayloads = [
        null,
        undefined,
        '',
        12345,
        {},
        { eventType: 'UPDATE' },
        { new: null, old: null },
        { new: {} },
        { new: { title: 'No ID' } },
        { new: { id: '' } },
      ];

      for (const hostile of hostilePayloads) {
        expect(() => {
          const res = handleRealtimePayload(queryClient, { table: 'work_requests' }, hostile);
          expect(res).toBe(false);
        }).not.toThrow();
      }
    });
  });

  // =========================================================================
  // Dimension 3: Loop Prevention Registry, TTL & Tab Origin Tracking
  // =========================================================================
  describe('Dimension 3: Loop Prevention Registry, TTL & Tab Origin', () => {
    it('suppresses local echo within TTL window, but allows subsequent external updates', () => {
      // 1. Local mutation dispatched by current tab (pinned to version 2)
      trackLocalMutation('work_requests', 'wr-echo-test', 2);

      // Verify that local echo with version 2 is suppressed
      expect(isLocalMutation('work_requests', 'wr-echo-test', 2)).toBe(true);

      const localEchoPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-echo-test', version: 2, title: 'Local Echo', entity: 'ATA' },
        old: { id: 'wr-echo-test', version: 1 },
      };
      const processedEcho = handleRealtimePayload(queryClient, { table: 'work_requests' }, localEchoPayload);
      expect(processedEcho).toBe(false);

      // 2. An external update from peer tab arrives with version 3 (within same TTL window)
      expect(isLocalMutation('work_requests', 'wr-echo-test', 3)).toBe(false);

      const externalPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-echo-test', version: 3, title: 'External Update', entity: 'ATA' },
        old: { id: 'wr-echo-test', version: 2 },
      };
      const processedExternal = handleRealtimePayload(queryClient, { table: 'work_requests' }, externalPayload);
      expect(processedExternal).toBe(true);

      // Verify cache updated with version 3
      const detail = queryClient.getQueryData<any>(operationsKeys.workRequestDetail('wr-echo-test'));
      expect(detail.title).toBe('External Update');
      expect(detail.version).toBe(3);
    });

    it('cleans up local mutation registry entries after 10-second TTL expires', () => {
      vi.useFakeTimers();

      trackLocalMutation('work_requests', 'wr-ttl-expire', 5);
      expect(isLocalMutation('work_requests', 'wr-ttl-expire', 5)).toBe(true);

      // Advance 9.5 seconds: still within TTL
      vi.advanceTimersByTime(9500);
      expect(isLocalMutation('work_requests', 'wr-ttl-expire', 5)).toBe(true);

      // Advance past 10 seconds (total 10.5 seconds): TTL expired
      vi.advanceTimersByTime(1000);
      expect(isLocalMutation('work_requests', 'wr-ttl-expire', 5)).toBe(false);
    });

    it('unversioned tracking suppresses any version during TTL, then allows updates after expiry', () => {
      vi.useFakeTimers();

      trackLocalMutation('work_requests', 'wr-unversioned');
      expect(isLocalMutation('work_requests', 'wr-unversioned', 1)).toBe(true);
      expect(isLocalMutation('work_requests', 'wr-unversioned', 2)).toBe(true);

      // Advance past 10 seconds
      vi.advanceTimersByTime(10500);
      expect(isLocalMutation('work_requests', 'wr-unversioned', 1)).toBe(false);
      expect(isLocalMutation('work_requests', 'wr-unversioned', 2)).toBe(false);
    });

    it('drops payloads with origin_tab_id matching current tab, allows foreign tab IDs', () => {
      const currentTab = getTabId();

      // Self tab payload (new.origin_tab_id)
      expect(
        isSelfOriginatedPayload({
          eventType: 'UPDATE',
          new: { id: 'wr-1', origin_tab_id: currentTab },
        })
      ).toBe(true);

      // Self tab payload (new.originTabId camelCase)
      expect(
        isSelfOriginatedPayload({
          eventType: 'UPDATE',
          new: { id: 'wr-1', originTabId: currentTab },
        })
      ).toBe(true);

      // Self tab payload (top-level origin_tab_id)
      expect(
        isSelfOriginatedPayload({
          origin_tab_id: currentTab,
          eventType: 'UPDATE',
          new: { id: 'wr-1' },
        })
      ).toBe(true);

      // Foreign tab payload
      expect(
        isSelfOriginatedPayload({
          eventType: 'UPDATE',
          new: { id: 'wr-1', origin_tab_id: 'tab-peer-999' },
        })
      ).toBe(false);
    });
  });

  // =========================================================================
  // Dimension 4: Feature Flag Gating & Dynamic Toggle Lifecycle
  // =========================================================================
  describe('Dimension 4: Feature Flag Gating & Dynamic Toggling', () => {
    it('does not create channel when realtime_sync feature flag is false', () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      expect(channelSpy).not.toHaveBeenCalled();
    });

    it('subscribes when feature flag is re-enabled', () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { rerender } = renderHook(
        (props: { table: any }) => useEntityRealtimeSync(props),
        {
          initialProps: { table: 'work_requests' },
          wrapper: createWrapper(),
        }
      );
      expect(channelSpy).not.toHaveBeenCalled();

      // Enable feature flag and change table (or trigger remount)
      localStorage.setItem('erp_feature_override_realtime_sync', 'true');
      rerender({ table: 'invoices' });

      expect(channelSpy).toHaveBeenCalledWith('cdc_invoices');
    });

    it('cleans up channel when options.enabled transitions from true to false', () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const { rerender } = renderHook(
        (props: { enabled: boolean }) =>
          useEntityRealtimeSync({ table: 'work_requests', enabled: props.enabled }),
        {
          initialProps: { enabled: true },
          wrapper: createWrapper(),
        }
      );

      // Transition enabled: true -> false
      rerender({ enabled: false });
      expect(removeChannelSpy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Dimension 5: Work Request Phase Embedded Tasks Reconciliation
  // =========================================================================
  describe('Dimension 5: Work Request Phases Embedded Tasks Patching', () => {
    it('patches task embedded deep inside work request phases container on UPDATE', () => {
      const wrWithPhases = {
        id: 'wr-with-tasks',
        entity: 'ATA',
        title: 'Parent WR',
        phases: {
          phase_intake: {
            tasks: [
              { id: 'task-10', title: 'Task 10 Initial', status: 'TODO', version: 1 },
              { id: 'task-11', title: 'Task 11 Initial', status: 'TODO', version: 1 },
            ],
          },
          phase_execution: {
            tasks: [
              { id: 'task-20', title: 'Task 20 Initial', status: 'TODO', version: 1 },
            ],
          },
        },
      };

      // Seed work request in list cache
      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [wrWithPhases],
        meta: { total: 1 },
      });

      // CDC UPDATE for task-11
      const taskUpdatePayload = {
        eventType: 'UPDATE',
        new: {
          id: 'task-11',
          work_request_id: 'wr-with-tasks',
          title: 'Task 11 Completed',
          status: 'COMPLETED',
          version: 2,
        },
        old: { id: 'task-11', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'tasks' }, taskUpdatePayload);
      expect(processed).toBe(true);

      const updatedList = queryClient.getQueryData<any>(operationsKeys.workRequestsList('ATA'));
      const wr = updatedList.data[0];

      // Task 11 updated in phase_intake
      expect(wr.phases.phase_intake.tasks[1].title).toBe('Task 11 Completed');
      expect(wr.phases.phase_intake.tasks[1].status).toBe('COMPLETED');
      expect(wr.phases.phase_intake.tasks[1].version).toBe(2);

      // Task 10 and Task 20 unchanged
      expect(wr.phases.phase_intake.tasks[0].title).toBe('Task 10 Initial');
      expect(wr.phases.phase_execution.tasks[0].title).toBe('Task 20 Initial');
    });

    it('removes task embedded inside work request phases container on DELETE', () => {
      const wrWithPhases = {
        id: 'wr-delete-task',
        entity: 'ATA',
        phases: {
          phase_intake: {
            tasks: [
              { id: 'task-del-1', title: 'Task Del 1' },
              { id: 'task-keep', title: 'Task Keep' },
            ],
          },
        },
      };

      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [wrWithPhases],
        meta: { total: 1 },
      });

      const taskDeletePayload = {
        eventType: 'DELETE',
        old: { id: 'task-del-1' },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'tasks' }, taskDeletePayload);
      expect(processed).toBe(true);

      const updatedList = queryClient.getQueryData<any>(operationsKeys.workRequestsList('ATA'));
      const tasksInIntake = updatedList.data[0].phases.phase_intake.tasks;
      expect(tasksInIntake).toHaveLength(1);
      expect(tasksInIntake[0].id).toBe('task-keep');
    });
  });

  // =========================================================================
  // Dimension 6: Live WebSocket Mock Channel Subscription & Event Propagation
  // =========================================================================
  describe('Dimension 6: Live WebSocket Channel Event Routing', () => {
    it('routes incoming mock channel events to cache correctly', () => {
      useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-adversarial',
        email: 'admin@ata-lta.ph',
        name: 'Admin Adversarial',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['*'],
      activeEntity: 'ATA',
    });

      renderHook(
        () => useEntityRealtimeSync({ table: 'invoices' }),
        { wrapper: createWrapper() }
      );

      const channel = supabase.channel('cdc_invoices') as unknown as MockRealtimeChannel;
      expect(channel).toBeDefined();

      // Query cache seeded with initial invoice
      queryClient.setQueryData(billingKeys.invoiceDetail('inv-live-1'), {
        id: 'inv-live-1',
        entity: 'ATA',
        status: 'DRAFT',
        version: 1,
      });

      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'inv-live-1', entity: 'ATA', status: 'PAID', version: 2 },
          old: { id: 'inv-live-1', entity: 'ATA', version: 1 },
        });
      });

      const updatedInvoice = queryClient.getQueryData<any>(billingKeys.invoiceDetail('inv-live-1'));
      expect(updatedInvoice.status).toBe('PAID');
      expect(updatedInvoice.version).toBe(2);
    });
  });

  // =========================================================================
  // Dimension 7: Out-of-Order Packet Arrival & Race Defense
  // =========================================================================
  describe('Dimension 7: Out-of-Order Packet Arrival & Race Defense', () => {
    it('rejects an out-of-order older packet that arrives after a newer packet has been processed', () => {
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-race-1'), {
        id: 'wr-race-1',
        title: 'Initial V1',
        version: 1,
        entity: 'ATA',
      });

      // Packet with version 3 arrives first (faster network path)
      const packetV3 = {
        eventType: 'UPDATE',
        new: { id: 'wr-race-1', title: 'Newer V3', version: 3, entity: 'ATA' },
        old: { id: 'wr-race-1', version: 2 },
      };
      const resV3 = handleRealtimePayload(queryClient, { table: 'work_requests' }, packetV3);
      expect(resV3).toBe(true);

      const detailV3 = queryClient.getQueryData<any>(operationsKeys.workRequestDetail('wr-race-1'));
      expect(detailV3.title).toBe('Newer V3');
      expect(detailV3.version).toBe(3);

      // Packet with version 2 arrives late (out-of-order delayed packet)
      const packetV2Late = {
        eventType: 'UPDATE',
        new: { id: 'wr-race-1', title: 'Delayed V2', version: 2, entity: 'ATA' },
        old: { id: 'wr-race-1', version: 1 },
      };
      const resV2 = handleRealtimePayload(queryClient, { table: 'work_requests' }, packetV2Late);
      expect(resV2).toBe(false); // MUST be dropped by Guard 2!

      // Cache remains strictly at V3
      const detailFinal = queryClient.getQueryData<any>(operationsKeys.workRequestDetail('wr-race-1'));
      expect(detailFinal.title).toBe('Newer V3');
      expect(detailFinal.version).toBe(3);
    });
  });

  // =========================================================================
  // Dimension 8: Domain Counter Invalidation
  // =========================================================================
  describe('Dimension 8: Domain Counter Invalidation', () => {
    it('invalidates counter queries for the respective domain on CDC events', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Test work_requests invalidation
      handleRealtimePayload(queryClient, { table: 'work_requests' }, {
        eventType: 'UPDATE',
        new: { id: 'wr-c1', entity: 'ATA', version: 2 },
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['operations', 'workRequests', 'counts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['operations', 'counts'] });

      // Test billing invalidation
      invalidateSpy.mockClear();
      handleRealtimePayload(queryClient, { table: 'invoices' }, {
        eventType: 'INSERT',
        new: { id: 'inv-c1', entity: 'ATA', version: 1 },
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['billing', 'counts'] });

      // Test disbursements invalidation
      invalidateSpy.mockClear();
      handleRealtimePayload(queryClient, { table: 'disbursements' }, {
        eventType: 'DELETE',
        old: { id: 'disb-c1', entity: 'ATA' },
      });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['disbursements', 'counts'] });
    });
  });

  // =========================================================================
  // Dimension 9: Multi-Hook Channel Multiplexing & Teardown
  // =========================================================================
  describe('Dimension 9: Channel Multiplexing & Independence', () => {
    it('manages independent channels for different tables', () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const hook1 = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );
      const hook2 = renderHook(
        () => useEntityRealtimeSync({ table: 'invoices' }),
        { wrapper: createWrapper() }
      );

      const ch1 = supabase.channel('cdc_work_requests');
      const ch2 = supabase.channel('cdc_invoices');
      expect(ch1).toBeDefined();
      expect(ch2).toBeDefined();

      // Unmount hook1: only hook1 channel removed
      hook1.unmount();
      expect(removeChannelSpy).toHaveBeenCalledWith(ch1);

      // Clean up hook2
      hook2.unmount();
      expect(removeChannelSpy).toHaveBeenCalledWith(ch2);
    });
  });
});
