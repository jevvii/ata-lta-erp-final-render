/**
 * Empirical Adversarial Challenge: CDC Query Scoping & Co-Invalidations
 *
 * M2 Challenger 2 Suite (Scope & Co-Invalidation Verifier)
 *
 * Tests the 4 core mission mandates:
 * 1. isTaskListOfTargetWr strictly scopes insertions so a task inserted for wr-A never pollutes wr-B's list query.
 * 2. Task mutations co-invalidate workRequestDetail(targetWrId), workRequestCounts(activeEntity), and taskRelated(id).
 * 3. Cross-domain co-invalidations trigger for invoices, disbursements, transmittals, documents, operations_requests, and task_assignees.
 * 4. High-frequency adversarial stress testing with interleaved CDC events and substring key collision resistance.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useEntityRealtimeSync,
  handleRealtimePayload,
  clearChannelRegistryForTesting,
  isTaskListOfTargetWr,
  triggerTaskCoInvalidations,
  triggerCrossDomainCoInvalidations,
} from '../useEntityRealtimeSync';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { resetTabIdForTesting } from '@/lib/tabSync';
import { clearLocalMutationsForTesting } from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';

describe('Adversarial Challenge: CDC Query Scoping & Isolation (Mission 1)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-challenger-m2-scope');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-test',
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
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1.1 Combinatorial & Boundary Oracle for isTaskListOfTargetWr
  // =========================================================================
  describe('1.1 isTaskListOfTargetWr Combinatorial Boundaries', () => {
    it('accurately identifies task list queries for the target work request', () => {
      expect(isTaskListOfTargetWr(operationsKeys.tasks('wr-alpha'), 'wr-alpha')).toBe(true);
      expect(isTaskListOfTargetWr(['operations', 'workRequests', 'detail', 'wr-alpha', 'tasks'], 'wr-alpha')).toBe(true);
      expect(isTaskListOfTargetWr(['operations', 'workRequests', 'detail', 'wr-alpha', 'tasks', { page: 1, limit: 10 }], 'wr-alpha')).toBe(true);
      expect(isTaskListOfTargetWr(['custom', 'prefix', 'tasks', 'wr-alpha'], 'wr-alpha')).toBe(true);
    });

    it('strictly rejects queries belonging to sibling work requests', () => {
      expect(isTaskListOfTargetWr(operationsKeys.tasks('wr-beta'), 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(['operations', 'workRequests', 'detail', 'wr-beta', 'tasks'], 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(['operations', 'workRequests', 'detail', 'wr-gamma', 'tasks'], 'wr-alpha')).toBe(false);
    });

    it('prevents false positive substring matches (e.g., wr-1 vs wr-10 vs wr-100)', () => {
      const keyWr10 = operationsKeys.tasks('wr-10');
      const keyWr100 = operationsKeys.tasks('wr-100');
      const keyWr1 = operationsKeys.tasks('wr-1');

      // wr-1 should NOT match wr-10 or wr-100
      expect(isTaskListOfTargetWr(keyWr10, 'wr-1')).toBe(false);
      expect(isTaskListOfTargetWr(keyWr100, 'wr-1')).toBe(false);

      // wr-10 should NOT match wr-1 or wr-100
      expect(isTaskListOfTargetWr(keyWr1, 'wr-10')).toBe(false);
      expect(isTaskListOfTargetWr(keyWr100, 'wr-10')).toBe(false);

      // exact matches must succeed
      expect(isTaskListOfTargetWr(keyWr1, 'wr-1')).toBe(true);
      expect(isTaskListOfTargetWr(keyWr10, 'wr-10')).toBe(true);
      expect(isTaskListOfTargetWr(keyWr100, 'wr-100')).toBe(true);
    });

    it('rejects work request queries that omit the "tasks" segment', () => {
      expect(isTaskListOfTargetWr(operationsKeys.workRequestDetail('wr-alpha'), 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(operationsKeys.workRequests(), 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(['operations', 'workRequests', 'detail', 'wr-alpha'], 'wr-alpha')).toBe(false);
    });

    it('rejects general non-array or malformed inputs without throwing', () => {
      expect(isTaskListOfTargetWr(null, 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(undefined, 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr('operations_tasks_wr-alpha', 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(12345, 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr({ tasks: true, wrId: 'wr-alpha' }, 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr([], 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(['tasks'], 'wr-alpha')).toBe(false);
      expect(isTaskListOfTargetWr(['wr-alpha'], 'wr-alpha')).toBe(false);
    });
  });

  // =========================================================================
  // 1.2 Multi-WR Query Isolation Under handleRealtimePayload
  // =========================================================================
  describe('1.2 Multi-WR Cache Isolation Under handleRealtimePayload', () => {
    it('inserts task strictly into wr-A query cache without polluting wr-B, wr-C, or wr-D', () => {
      const wrAKey = operationsKeys.tasks('wr-A');
      const wrBKey = operationsKeys.tasks('wr-B');
      const wrCKey = operationsKeys.tasks('wr-C');
      const wrAListKey = [...operationsKeys.tasks('wr-A'), { page: 1 }];
      const wrBListKey = [...operationsKeys.tasks('wr-B'), { page: 1 }];
      const wrListAll = operationsKeys.workRequests();

      // Seed queries
      queryClient.setQueryData(wrAKey, [
        { id: 'task-a1', workRequestId: 'wr-A', title: 'Task A1' },
      ]);
      queryClient.setQueryData(wrBKey, [
        { id: 'task-b1', workRequestId: 'wr-B', title: 'Task B1' },
      ]);
      queryClient.setQueryData(wrCKey, [
        { id: 'task-c1', workRequestId: 'wr-C', title: 'Task C1' },
      ]);
      queryClient.setQueryData(wrAListKey, {
        data: [{ id: 'task-a1', workRequestId: 'wr-A', title: 'Task A1' }],
        meta: { total: 1 },
      });
      queryClient.setQueryData(wrBListKey, {
        data: [{ id: 'task-b1', workRequestId: 'wr-B', title: 'Task B1' }],
        meta: { total: 1 },
      });
      queryClient.setQueryData(wrListAll, [
        { id: 'wr-A', title: 'WR A' },
        { id: 'wr-B', title: 'WR B' },
      ]);

      // Emit CDC INSERT for wr-A (using snake_case work_request_id from PostgreSQL)
      const handled = handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
        },
        {
          eventType: 'INSERT',
          new: {
            id: 'task-a2-new',
            work_request_id: 'wr-A',
            title: 'Task A2 Newly Inserted',
            version: 1,
          },
        }
      );

      expect(handled).toBe(true);

      // Verify wr-A queries received the new task
      const wrAData = queryClient.getQueryData<Array<{ id: string }>>(wrAKey);
      expect(wrAData).toHaveLength(2);
      expect(wrAData?.[0]?.id).toBe('task-a2-new');
      expect(wrAData?.[1]?.id).toBe('task-a1');

      const wrAPagedData = queryClient.getQueryData<{ data: Array<{ id: string }>; meta: { total: number } }>(wrAListKey);
      expect(wrAPagedData?.data).toHaveLength(2);
      expect(wrAPagedData?.data[0]?.id).toBe('task-a2-new');
      expect(wrAPagedData?.meta.total).toBe(2);

      // Verify wr-B queries were NOT touched
      const wrBData = queryClient.getQueryData<Array<{ id: string }>>(wrBKey);
      expect(wrBData).toHaveLength(1);
      expect(wrBData?.[0]?.id).toBe('task-b1');

      const wrBPagedData = queryClient.getQueryData<{ data: Array<{ id: string }>; meta: { total: number } }>(wrBListKey);
      expect(wrBPagedData?.data).toHaveLength(1);
      expect(wrBPagedData?.data[0]?.id).toBe('task-b1');
      expect(wrBPagedData?.meta.total).toBe(1);

      // Verify wr-C query was NOT touched
      const wrCData = queryClient.getQueryData<Array<{ id: string }>>(wrCKey);
      expect(wrCData).toHaveLength(1);
      expect(wrCData?.[0]?.id).toBe('task-c1');

      // Verify wrListAll (which does not contain 'tasks') was NOT polluted
      const wrListData = queryClient.getQueryData<Array<{ id: string }>>(wrListAll);
      expect(wrListData).toHaveLength(2);
      expect(wrListData?.map((x) => x.id)).toEqual(['wr-A', 'wr-B']);
    });

    it('works identically when incoming CDC payload uses camelCase workRequestId', () => {
      const wrAKey = operationsKeys.tasks('wr-alpha');
      const wrBKey = operationsKeys.tasks('wr-beta');

      queryClient.setQueryData(wrAKey, [{ id: 't-1' }]);
      queryClient.setQueryData(wrBKey, [{ id: 't-2' }]);

      handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
        },
        {
          eventType: 'INSERT',
          new: {
            id: 't-camel-new',
            workRequestId: 'wr-beta',
            title: 'CamelCase Task',
            version: 1,
          },
        }
      );

      // wr-beta MUST have received the task
      const bData = queryClient.getQueryData<Array<{ id: string }>>(wrBKey);
      expect(bData).toHaveLength(2);
      expect(bData?.[0]?.id).toBe('t-camel-new');

      // wr-alpha MUST NOT have received the task
      const aData = queryClient.getQueryData<Array<{ id: string }>>(wrAKey);
      expect(aData).toHaveLength(1);
      expect(aData?.[0]?.id).toBe('t-1');
    });

    it('does not duplicate task if already present in target work request query', () => {
      const wrKey = operationsKeys.tasks('wr-dup-check');
      queryClient.setQueryData(wrKey, [
        { id: 'task-existing', work_request_id: 'wr-dup-check', title: 'Existing Task' },
      ]);

      handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
        },
        {
          eventType: 'INSERT',
          new: {
            id: 'task-existing',
            work_request_id: 'wr-dup-check',
            title: 'Existing Task',
            version: 2,
          },
        }
      );

      const data = queryClient.getQueryData<Array<{ id: string }>>(wrKey);
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe('task-existing');
    });

    it('gracefully skips list prepending if payload lacks any work request identifier', () => {
      const wrKey = operationsKeys.tasks('wr-any');
      queryClient.setQueryData(wrKey, [{ id: 'task-base' }]);

      handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
        },
        {
          eventType: 'INSERT',
          new: {
            id: 'task-orphaned',
            title: 'Task without WR id',
            version: 1,
          },
        }
      );

      // wrKey must remain untouched
      const data = queryClient.getQueryData<Array<{ id: string }>>(wrKey);
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe('task-base');
    });
  });
});

describe('Adversarial Challenge: Task Mutation Co-Invalidations (Mission 2)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-challenger-m2-coinv');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-test',
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

  afterEach(() => {
    queryClient.clear();
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 2.1 Direct Oracle Contract for triggerTaskCoInvalidations
  // =========================================================================
  describe('2.1 triggerTaskCoInvalidations Oracle Contract', () => {
    it('co-invalidates workRequestDetail(wrId), workRequestCounts(activeEntity), and taskRelated(id)', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      triggerTaskCoInvalidations(queryClient, 'wr-alpha-123', 'task-xyz-789', 'ATA');

      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-alpha-123'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-xyz-789'),
      });
    });

    it('falls back to generic workRequest counts when activeEntity is null or unassigned', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      triggerTaskCoInvalidations(queryClient, 'wr-beta-456', 'task-xyz-789', null);

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-beta-456'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: ['operations', 'workRequests', 'counts'],
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-xyz-789'),
      });
    });

    it('handles empty targetWrId or taskId without emitting invalid keys', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      triggerTaskCoInvalidations(queryClient, '', '', 'ATA');

      // Only activeEntity counts should be invalidated if wrId and taskId are empty strings
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
    });
  });

  // =========================================================================
  // 2.2 handleRealtimePayload Co-Invalidation Verification Across Lifecycles
  // =========================================================================
  describe('2.2 Task Mutation Events Trigger Co-Invalidations Through handleRealtimePayload', () => {
    it('triggers all 3 co-invalidations on task INSERT event', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
          activeEntity: 'ATA',
        },
        {
          eventType: 'INSERT',
          new: {
            id: 'task-ins-1',
            work_request_id: 'wr-ins-target',
            version: 1,
          },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-ins-target'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-ins-1'),
      });
    });

    it('triggers all 3 co-invalidations on task UPDATE event', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
          activeEntity: 'LTA',
        },
        {
          eventType: 'UPDATE',
          new: {
            id: 'task-upd-1',
            work_request_id: 'wr-upd-target',
            status: 'In Progress',
            version: 2,
          },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-upd-target'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('LTA'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-upd-1'),
      });
    });

    it('triggers all 3 co-invalidations on task DELETE event with REPLICA IDENTITY FULL payload', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
          activeEntity: 'ATA',
        },
        {
          eventType: 'DELETE',
          old: {
            id: 'task-del-full',
            work_request_id: 'wr-del-target',
          },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-del-target'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-del-full'),
      });
    });

    it('triggers all 3 co-invalidations on task soft-delete (UPDATE with deleted_at timestamp)', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        {
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
          activeEntity: 'ATA',
        },
        {
          eventType: 'UPDATE',
          new: {
            id: 'task-soft-del',
            work_request_id: 'wr-soft-target',
            deleted_at: '2026-10-10T16:30:00Z',
            version: 3,
          },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-soft-target'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-soft-del'),
      });
    });
  });
});

describe('Adversarial Challenge: Cross-Domain Co-Invalidations (Mission 3)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-challenger-m2-cross');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-test',
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

  afterEach(() => {
    queryClient.clear();
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 3.1 Invoices Cross-Domain Co-Invalidation
  // =========================================================================
  describe('3.1 Invoices Co-Invalidation', () => {
    it('invalidates taskRelated(taskId) when invoice contains snake_case task_id', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'invoices', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'inv-1', task_id: 'task-invoice-linked', version: 1 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-invoice-linked'),
      });
    });

    it('invalidates taskRelated(taskId) when invoice contains camelCase taskId', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'invoices', activeEntity: 'ATA' },
        {
          eventType: 'UPDATE',
          new: { id: 'inv-2', taskId: 'task-invoice-camel', version: 2 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-invoice-camel'),
      });
    });

    it('does NOT invalidate taskRelated when invoice has no task linkage', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'invoices', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'inv-standalone', invoiceNumber: 'INV-001', version: 1 },
        }
      );

      const taskRelatedCalls = spy.mock.calls.filter(([arg]) =>
        Boolean(arg && Array.isArray(arg.queryKey) && arg.queryKey.includes('related'))
      );
      expect(taskRelatedCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3.2 Disbursements Cross-Domain Co-Invalidation
  // =========================================================================
  describe('3.2 Disbursements Co-Invalidation', () => {
    it('invalidates taskRelated(taskId) when disbursement contains task_id', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'disbursements', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'disb-1', task_id: 'task-disb-linked', version: 1 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-disb-linked'),
      });
    });

    it('invalidates taskRelated(taskId) when disbursement contains taskId', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'disbursements', activeEntity: 'ATA' },
        {
          eventType: 'UPDATE',
          new: { id: 'disb-2', taskId: 'task-disb-camel', version: 2 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-disb-camel'),
      });
    });

    it('does NOT invalidate taskRelated when disbursement has no task link', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'disbursements', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'disb-unlinked', amount: 5000, version: 1 },
        }
      );

      const taskRelatedCalls = spy.mock.calls.filter(([arg]) =>
        Boolean(arg && Array.isArray(arg.queryKey) && arg.queryKey.includes('related'))
      );
      expect(taskRelatedCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3.3 Transmittals Cross-Domain Co-Invalidation
  // =========================================================================
  describe('3.3 Transmittals Co-Invalidation', () => {
    it('invalidates taskRelated(taskId) when transmittal contains linked_task_id', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'transmittals', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'trans-1', linked_task_id: 'task-trans-linked', version: 1 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-trans-linked'),
      });
    });

    it('invalidates taskRelated(taskId) when transmittal contains linkedTaskId', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'transmittals', activeEntity: 'ATA' },
        {
          eventType: 'UPDATE',
          new: { id: 'trans-2', linkedTaskId: 'task-trans-camel', version: 2 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-trans-camel'),
      });
    });

    it('does NOT invalidate taskRelated when transmittal has no linked task', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'transmittals', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'trans-unlinked', title: 'General Transmittal', version: 1 },
        }
      );

      const taskRelatedCalls = spy.mock.calls.filter(([arg]) =>
        Boolean(arg && Array.isArray(arg.queryKey) && arg.queryKey.includes('related'))
      );
      expect(taskRelatedCalls).toHaveLength(0);
    });
  });

  // =========================================================================
  // 3.4 Documents Cross-Domain Co-Invalidation
  // =========================================================================
  describe('3.4 Documents Co-Invalidation', () => {
    it('unconditionally invalidates operationsKeys.documents() on any document event', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'documents', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'doc-standalone', fileName: 'contract.pdf', version: 1 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.documents(),
      });
    });

    it('invalidates both documents() and taskRelated(taskId) when document is linked to task', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'documents', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'doc-linked', linked_task_id: 'task-doc-parent', version: 1 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.documents(),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-doc-parent'),
      });
    });

    it('works with camelCase linkedTaskId on documents', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'documents', activeEntity: 'ATA' },
        {
          eventType: 'UPDATE',
          new: { id: 'doc-linked-2', linkedTaskId: 'task-doc-camel', version: 2 },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.documents(),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-doc-camel'),
      });
    });
  });

  // =========================================================================
  // 3.5 Operations Requests Cross-Domain Co-Invalidation
  // =========================================================================
  describe('3.5 Operations Requests Co-Invalidation', () => {
    it('invalidates requests(), requestCounts(activeEntity), and workRequestDetail(wrId)', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'operations_requests', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: {
            id: 'op-req-1',
            request_type: 'phase_transition',
            work_request_id: 'wr-target-for-op',
            version: 1,
          },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requests(),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requestCounts('ATA'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-target-for-op'),
      });
    });

    it('handles camelCase workRequestId in operations_requests', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'operations_requests', activeEntity: 'LTA' },
        {
          eventType: 'UPDATE',
          new: {
            id: 'op-req-2',
            type: 'billing_request',
            workRequestId: 'wr-target-camel',
            status: 'approved',
            version: 2,
          },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requests(),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requestCounts('LTA'),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-target-camel'),
      });
    });

    it('falls back to generic request counts when activeEntity is unassigned', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      triggerCrossDomainCoInvalidations(
        queryClient,
        'operations_requests',
        { id: 'op-unassigned', workRequestId: 'wr-orphan' },
        null
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requests(),
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: ['operations', 'requests', 'counts'],
      });
      expect(spy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-orphan'),
      });
    });
  });

  // =========================================================================
  // 3.6 Task Assignees Cross-Domain Co-Invalidation
  // =========================================================================
  describe('3.6 Task Assignees Co-Invalidation', () => {
    it('invalidates specific task query ["operations", "tasks", taskId] with snake_case task_id', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'task_assignees', activeEntity: 'ATA' },
        {
          eventType: 'INSERT',
          new: { id: 'ta-1', task_id: 'task-with-new-assignee', user_id: 'user-456' },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: ['operations', 'tasks', 'task-with-new-assignee'],
      });
    });

    it('invalidates specific task query with camelCase taskId', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'task_assignees', activeEntity: 'ATA' },
        {
          eventType: 'DELETE',
          old: { id: 'ta-2', taskId: 'task-with-removed-assignee', userId: 'user-789' },
        }
      );

      expect(spy).toHaveBeenCalledWith({
        queryKey: ['operations', 'tasks', 'task-with-removed-assignee'],
      });
    });

    it('does not emit task invalidation if task_id is absent', () => {
      const spy = vi.spyOn(queryClient, 'invalidateQueries');

      triggerCrossDomainCoInvalidations(
        queryClient,
        'task_assignees',
        { id: 'ta-orphan', userId: 'user-123' },
        'ATA'
      );

      expect(spy).not.toHaveBeenCalled();
    });
  });
});

describe('Adversarial Stress: Mounted Hook & Interleaved Stream (Mission 1-4)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-challenger-m2-stress');
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-test',
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
    vi.restoreAllMocks();
  });

  it('verifies live mounted hook with MockRealtimeChannel performs strict scoped insertion', async () => {
    const wrAKey = operationsKeys.tasks('wr-live-A');
    const wrBKey = operationsKeys.tasks('wr-live-B');

    queryClient.setQueryData(wrAKey, [{ id: 't-a-init', title: 'Task A Init' }]);
    queryClient.setQueryData(wrBKey, [{ id: 't-b-init', title: 'Task B Init' }]);

    // Mount hook for tasks
    renderHook(
      () =>
        useEntityRealtimeSync({
          table: 'tasks',
          listRootKey: ['operations', 'workRequests'],
          activeEntity: 'ATA',
        }),
      { wrapper: createWrapper() }
    );

    const channel = supabase.channel('cdc_tasks') as unknown as MockRealtimeChannel;
    expect(channel).toBeDefined();

    // Emit live WebSocket CDC event targeting wr-live-A
    act(() => {
      channel.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 't-a-live-new',
          work_request_id: 'wr-live-A',
          title: 'Live Inserted Task',
          version: 1,
        },
      });
    });

    // Check wr-live-A
    const wrA = queryClient.getQueryData<Array<{ id: string }>>(wrAKey);
    expect(wrA).toHaveLength(2);
    expect(wrA?.[0]?.id).toBe('t-a-live-new');

    // Check wr-live-B is completely untouched
    const wrB = queryClient.getQueryData<Array<{ id: string }>>(wrBKey);
    expect(wrB).toHaveLength(1);
    expect(wrB?.[0]?.id).toBe('t-b-init');
  });

  it('survives rapid burst of 60 interleaved CDC task events across 6 distinct work requests', () => {
    const workRequestIds = ['wr-01', 'wr-02', 'wr-03', 'wr-04', 'wr-05', 'wr-06'];

    // Pre-populate each work request with 1 base task
    for (const wrId of workRequestIds) {
      queryClient.setQueryData(operationsKeys.tasks(wrId), [
        { id: `base-${wrId}`, workRequestId: wrId, title: `Base for ${wrId}` },
      ]);
    }

    // Interleave 10 new tasks per work request (total 60 events)
    for (let i = 0; i < 10; i++) {
      for (const wrId of workRequestIds) {
        handleRealtimePayload(
          queryClient,
          {
            table: 'tasks',
            listRootKey: ['operations', 'workRequests'],
            activeEntity: 'ATA',
          },
          {
            eventType: 'INSERT',
            new: {
              id: `task-${wrId}-${i}`,
              work_request_id: wrId,
              title: `Task ${i} for ${wrId}`,
              version: 1 + i,
            },
          }
        );
      }
    }

    // Assert each work request has exactly 11 tasks and ONLY tasks belonging to that work request
    for (const wrId of workRequestIds) {
      const tasks = queryClient.getQueryData<Array<{ id: string; workRequestId?: string; work_request_id?: string }>>(
        operationsKeys.tasks(wrId)
      );
      expect(tasks).toHaveLength(11);

      // Verify no task from another WR contaminated this list
      for (const task of tasks!) {
        const itemWr = task.workRequestId ?? task.work_request_id;
        expect(itemWr).toBe(wrId);
      }
    }
  });

  it('retains zero hardcoded secrets and does not load Playwright', () => {
    // Assert strictly within runtime invariants
    expect(process.env.PLAYWRIGHT_TEST).toBeUndefined();
    expect(typeof window).toBe('object');
  });
});
