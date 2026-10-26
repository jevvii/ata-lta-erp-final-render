import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  handleRealtimePayload,
  findWrIdForTaskFromCache,
  clearChannelRegistryForTesting,
  getActiveChannelRegistrySizeForTesting,
  useEntityRealtimeSync,
} from '../useEntityRealtimeSync';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { resetTabIdForTesting } from '@/lib/tabSync';
import { clearLocalMutationsForTesting } from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';

interface TestTask {
  id: string;
  work_request_id?: string;
  workRequestId?: string;
  title?: string;
  status?: string;
  version?: number;
  deleted_at?: string | null;
  deletedAt?: string | null;
}

interface TestWorkRequest {
  id: string;
  entity?: string;
  title?: string;
  version?: number;
  deleted_at?: string | null;
  deletedAt?: string | null;
  phases?: Record<string, { tasks: TestTask[] }>;
}

describe('Challenger 1 Empirical Verification: SPEC-REALTIME-UAT-REMEDIATION-002', () => {
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
    resetTabIdForTesting('tab-challenger-001');
    useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: 'admin-1',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('recreates an unexpectedly closed channel without losing mounted subscribers, and cancels teardown recovery', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const remove = vi.spyOn(supabase, 'removeChannel');
    const first = renderHook(() => useEntityRealtimeSync({ table: 'tasks' }), { wrapper: createWrapper() });
    const second = renderHook(() => useEntityRealtimeSync({ table: 'tasks' }), { wrapper: createWrapper() });
    await act(async () => { await Promise.resolve(); });
    const old = supabase.channel('cdc_tasks') as unknown as MockRealtimeChannel;
    old.emitStatus('CHANNEL_ERROR', Object.assign(new Error('socket closed: 1001'), { cause: { code: 1001, wasClean: true } }));
    expect(warn).not.toHaveBeenCalled();
    old.emitStatus('CLOSED');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(remove).toHaveBeenCalledWith(old);
    expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
    const replacement = supabase.channel('cdc_tasks') as unknown as MockRealtimeChannel;
    expect(replacement).not.toBe(old);
    first.unmount();
    expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
    replacement.emitStatus('CLOSED');
    second.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
    expect(getActiveChannelRegistrySizeForTesting()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  describe('Adversarial Test 1: Guard 2 Version Check for UPDATE vs INSERT', () => {
    it('SPEC REQUIREMENT: UPDATE event where incomingVersion === localCachedVersion must be processed (not discarded)', () => {
      // Setup local cached work request with version 5
      const detailKey = operationsKeys.workRequestDetail('wr-occ-1');
      queryClient.setQueryData(detailKey, {
        id: 'wr-occ-1',
        entity: 'ATA',
        version: 5,
        title: 'Original Title at V5',
      });

      // An UPDATE event arrives at the SAME version 5 (e.g. concurrent attribute update or re-delivered update)
      const updatePayloadSameVersion = {
        eventType: 'UPDATE' as const,
        new: {
          id: 'wr-occ-1',
          entity: 'ATA',
          version: 5,
          title: 'Modified Title at V5',
        },
        old: {
          id: 'wr-occ-1',
          entity: 'ATA',
          version: 5,
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        updatePayloadSameVersion
      );

      // SPEC-REALTIME-UAT-REMEDIATION-002 explicitly mandates:
      // "In Guard 2: Discard duplicate INSERTs when incomingVersion <= localCachedVersion,
      //  but for UPDATE only discard when incomingVersion < localCachedVersion (strictly older)."
      // Therefore, for UPDATE with incomingVersion === localCachedVersion, it MUST be processed (true),
      // and local cache must reflect the updated record.
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestWorkRequest>(detailKey);
      expect(cached?.title).toBe('Modified Title at V5');
    });

    it('Guard 2 strictly discards UPDATE event when incomingVersion < localCachedVersion (strictly older)', () => {
      const detailKey = operationsKeys.workRequestDetail('wr-occ-1');
      queryClient.setQueryData(detailKey, {
        id: 'wr-occ-1',
        entity: 'ATA',
        version: 5,
        title: 'Current V5',
      });

      const staleUpdatePayload = {
        eventType: 'UPDATE' as const,
        new: {
          id: 'wr-occ-1',
          entity: 'ATA',
          version: 4,
          title: 'Stale V4',
        },
        old: {
          id: 'wr-occ-1',
          entity: 'ATA',
          version: 3,
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        staleUpdatePayload
      );

      expect(processed).toBe(false);
      const cached = queryClient.getQueryData<TestWorkRequest>(detailKey);
      expect(cached?.title).toBe('Current V5');
    });

    it('Guard 2 discards duplicate INSERT event when incomingVersion <= localCachedVersion', () => {
      const detailKey = operationsKeys.workRequestDetail('wr-occ-2');
      queryClient.setQueryData(detailKey, {
        id: 'wr-occ-2',
        entity: 'ATA',
        version: 3,
        title: 'Cached WR V3',
      });

      const duplicateInsertPayload = {
        eventType: 'INSERT' as const,
        new: {
          id: 'wr-occ-2',
          entity: 'ATA',
          version: 3,
          title: 'Duplicate Insert V3',
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        duplicateInsertPayload
      );

      expect(processed).toBe(false);
      const cached = queryClient.getQueryData<TestWorkRequest>(detailKey);
      expect(cached?.title).toBe('Cached WR V3');
    });
  });

  describe('Adversarial Test 2: Soft-Delete Arrival with Equal or Lower Version', () => {
    it('processes soft-delete event and purges cache when incoming version === localCachedVersion', () => {
      const wrId = 'wr-soft-1';
      const detailKey = operationsKeys.workRequestDetail(wrId);
      queryClient.setQueryData(detailKey, {
        id: wrId,
        entity: 'ATA',
        version: 5,
        title: 'Active WR V5',
      });

      // Soft delete arrives as UPDATE with non-null deleted_at and EQUAL version 5
      const softDeletePayload = {
        eventType: 'UPDATE' as const,
        new: {
          id: wrId,
          entity: 'ATA',
          version: 5,
          title: 'Active WR V5',
          deleted_at: '2026-10-11T06:00:00Z',
        },
        old: {
          id: wrId,
          entity: 'ATA',
          version: 5,
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        softDeletePayload
      );

      expect(processed).toBe(true);
      // Cache detail must be purged
      const cached = queryClient.getQueryData(detailKey);
      expect(cached).toBeUndefined();
    });

    it('processes soft-delete event and purges cache when incoming version < localCachedVersion', () => {
      const wrId = 'wr-soft-2';
      const detailKey = operationsKeys.workRequestDetail(wrId);
      queryClient.setQueryData(detailKey, {
        id: wrId,
        entity: 'ATA',
        version: 5,
        title: 'Active WR V5',
      });

      // Soft delete arrives with LOWER version 4 (out of order CDC)
      const softDeleteLowerVersionPayload = {
        eventType: 'UPDATE' as const,
        new: {
          id: wrId,
          entity: 'ATA',
          version: 4,
          title: 'Active WR',
          deleted_at: '2026-10-11T06:00:00Z',
        },
        old: {
          id: wrId,
          entity: 'ATA',
          version: 4,
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        softDeleteLowerVersionPayload
      );

      expect(processed).toBe(true);
      const cached = queryClient.getQueryData(detailKey);
      expect(cached).toBeUndefined();
    });
  });

  describe('Adversarial Test 3: Bare CDC DELETE with only { id } & Cache Resolution', () => {
    it('findWrIdForTaskFromCache resolves targetWrId from taskDetail query key', () => {
      const wrId = 'wr-parent-99';
      const taskId = 'task-bare-1';
      const taskDetailKey = operationsKeys.taskDetail(wrId, taskId);

      queryClient.setQueryData(taskDetailKey, {
        id: taskId,
        work_request_id: wrId,
        title: 'Cached Task',
      });

      const resolvedWrId = findWrIdForTaskFromCache(queryClient, taskId);
      expect(resolvedWrId).toBe(wrId);
    });

    it('findWrIdForTaskFromCache resolves targetWrId from workRequestDetail phases container', () => {
      const wrId = 'wr-parent-88';
      const taskId = 'task-bare-2';
      const wrDetailKey = operationsKeys.workRequestDetail(wrId);

      queryClient.setQueryData(wrDetailKey, {
        id: wrId,
        entity: 'ATA',
        phases: {
          phase_1: {
            tasks: [{ id: taskId, title: 'Embedded Phase Task' }],
          },
        },
      });

      const resolvedWrId = findWrIdForTaskFromCache(queryClient, taskId);
      expect(resolvedWrId).toBe(wrId);
    });

    it('processes bare CDC DELETE payload lacking work_request_id and triggers phase purge & co-invalidation', () => {
      const wrId = 'wr-parent-77';
      const taskId = 'task-bare-3';
      const wrDetailKey = operationsKeys.workRequestDetail(wrId);
      const taskDetailKey = operationsKeys.taskDetail(wrId, taskId);

      // Populate query cache
      queryClient.setQueryData(taskDetailKey, {
        id: taskId,
        work_request_id: wrId,
        title: 'Task To Delete',
      });
      queryClient.setQueryData(wrDetailKey, {
        id: wrId,
        entity: 'ATA',
        phases: {
          intake: {
            tasks: [
              { id: taskId, title: 'Task To Delete' },
              { id: 'task-keep-1', title: 'Task To Keep' },
            ],
          },
        },
      });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Bare CDC DELETE: payload ONLY has id, no work_request_id
      const bareDeletePayload = {
        eventType: 'DELETE' as const,
        old: { id: taskId },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        bareDeletePayload
      );

      expect(processed).toBe(true);

      // 1. Task detail query should be removed
      expect(queryClient.getQueryData(taskDetailKey)).toBeUndefined();

      // 2. Embedded task in work request phases must be purged
      const wrData = queryClient.getQueryData<TestWorkRequest>(wrDetailKey);
      expect(wrData?.phases?.intake?.tasks.some((t) => t.id === taskId)).toBe(false);
      expect(wrData?.phases?.intake?.tasks.some((t) => t.id === 'task-keep-1')).toBe(true);

      // 3. Co-invalidations must be triggered for wrId and taskId
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail(wrId),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated(taskId),
      });
    });
  });

  describe('Adversarial Test 4: Channel Error Eviction from activeChannelRegistry', () => {
    it('retains channel subscribers during SDK recovery upon CHANNEL_ERROR', () => {
      expect(getActiveChannelRegistrySizeForTesting()).toBe(0);

      renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      // Channel registered
      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);

      const channel = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      expect(channel).toBeDefined();

      // Simulate channel error event from Supabase subscription
      channel.emitStatus('CHANNEL_ERROR', new Error('Connection refused'));

      // Mounted listeners must survive transport errors.
      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
    });
  });
});
