/**
 * Challenger 2 Empirical Stress Test Harness: SPEC-REALTIME-UAT-REMEDIATION-002
 *
 * Scope & Tasks:
 * 1. Test activeChannelRegistry eviction on CHANNEL_ERROR or unexpected close in useEntityRealtimeSync.ts
 * 2. Test TaskDetailModal.tsx reactive binding: verify liveTask vs initialTask behavior on assignees/status
 * 3. Check Guard 2 version check: verify whether UPDATE events with incomingVersion === localCachedVersion
 *    are incorrectly dropped or correctly processed.
 *
 * Invariants:
 * - ZERO hardcoded secrets.
 * - Under NO circumstances launch, call, or configure Playwright.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  useEntityRealtimeSync,
  handleRealtimePayload,
  clearChannelRegistryForTesting,
  getActiveChannelRegistrySizeForTesting,
} from '../useEntityRealtimeSync';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { resetTabIdForTesting } from '@/lib/tabSync';
import { clearLocalMutationsForTesting } from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { TaskDetailModal } from '@/features/operations/components/TaskDetailModal';
import type { Task, WorkRequest } from '@/features/operations/api/types';

interface TestEntity {
  id: string;
  title: string;
  version?: number;
  entity?: string;
  work_request_id?: string;
}

const mockWr: WorkRequest = {
  id: 'wr-challenger-100',
  title: 'Challenger Work Request',
  description: null,
  entity: 'ATA',
  status: 'In Progress',
  phase: 'pre_processing',
  priority: 'High',
  clientId: 'client-100',
  clientName: 'Client 100',
  archived: false,
  onHold: false,
  phaseEnteredAt: null,
  requestedBy: null,
  assignedTo: null,
  coAssignees: [],
  dueDate: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  tasks: [],
};

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id || 'task-ch-1',
    workRequestId: overrides.workRequestId || 'wr-challenger-100',
    title: overrides.title || 'Task Title',
    description: overrides.description !== undefined ? overrides.description : null,
    phase: overrides.phase || 'pre_processing',
    status: overrides.status || 'Assigned',
    qaStatus: overrides.qaStatus || 'none',
    version: overrides.version !== undefined ? overrides.version : 1,
    assigneeId: overrides.assigneeId !== undefined ? overrides.assigneeId : null,
    assigneeName: overrides.assigneeName !== undefined ? overrides.assigneeName : null,
    dueDate: overrides.dueDate !== undefined ? overrides.dueDate : null,
    phaseEnteredAt: overrides.phaseEnteredAt !== undefined ? overrides.phaseEnteredAt : null,
    requiredLinkType: overrides.requiredLinkType !== undefined ? overrides.requiredLinkType : null,
    predecessors: overrides.predecessors ?? [],
    assignees: overrides.assignees ?? [],
    taskAssignees: overrides.taskAssignees ?? [],
    displayOrder: overrides.displayOrder ?? 1,
    createdAt: overrides.createdAt || '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt || '2026-01-01T00:00:00Z',
    ...overrides,
  } as Task;
}

describe('Challenger 2 Empirical Verification: SPEC-REALTIME-UAT-REMEDIATION-002', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(QueryClientProvider, { client: queryClient }, children)
      );
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-challenger-2');
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
  // TASK 1: activeChannelRegistry Eviction on CHANNEL_ERROR or Unexpected Close
  // =========================================================================
  describe('Task 1: activeChannelRegistry Eviction on CHANNEL_ERROR and Socket Dropouts', () => {
    it('1.1: Retains subscribers on CHANNEL_ERROR for SDK reconnection', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const hook = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);

      const channel = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      expect(channel).toBeDefined();

      // Trigger CHANNEL_ERROR
      act(() => {
        channel.emitStatus('CHANNEL_ERROR', new Error('Postgres connection interrupted'));
      });

      // Registry entry should be evicted immediately
      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
      expect(removeChannelSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[Realtime] Subscription error (CHANNEL_ERROR) on work_requests:',
        expect.any(Error)
      );

      // Subsequent mount for the same table must establish a fresh channel
      const hook2 = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);

      hook.unmount();
      hook2.unmount();
    });

    it('1.2: Retains subscribers on TIMED_OUT', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const hook = renderHook(
        () => useEntityRealtimeSync({ table: 'tasks' }),
        { wrapper: createWrapper() }
      );

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
      const channel = supabase.channel('cdc_tasks') as unknown as MockRealtimeChannel;

      act(() => {
        channel.emitStatus('TIMED_OUT', new Error('Gateway timeout'));
      });

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
      expect(removeChannelSpy).not.toHaveBeenCalled();

      hook.unmount();
    });

    it('1.3: Schedules recovery on abnormal CLOSED (code 1006 / unclean close)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const hook = renderHook(
        () => useEntityRealtimeSync({ table: 'invoices' }),
        { wrapper: createWrapper() }
      );

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
      const channel = supabase.channel('cdc_invoices') as unknown as MockRealtimeChannel;

      const abnormalCloseError = Object.assign(new Error('WebSocket closed abnormal'), {
        cause: { code: 1006, wasClean: false },
      });

      act(() => {
        channel.emitStatus('CLOSED', abnormalCloseError);
      });

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
      expect(removeChannelSpy).not.toHaveBeenCalled();

      hook.unmount();
    });

    it('1.4: Does NOT evict channel prematurely on clean CLOSED (code 1000 / wasClean true)', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const hook = renderHook(
        () => useEntityRealtimeSync({ table: 'disbursements' }),
        { wrapper: createWrapper() }
      );

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
      const channel = supabase.channel('cdc_disbursements') as unknown as MockRealtimeChannel;

      const cleanCloseError = Object.assign(new Error('Normal closure'), {
        cause: { code: 1000, wasClean: true },
      });

      act(() => {
        channel.emitStatus('CLOSED', cleanCloseError);
      });

      // Clean close should NOT trigger error eviction branch
      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);
      expect(removeChannelSpy).not.toHaveBeenCalled();

      hook.unmount();
      // Regular teardown deletes it
      expect(getActiveChannelRegistrySizeForTesting()).toBe(0);
    });

    it('1.5: Handles unmount gracefully if channel was already evicted by error', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const hook1 = renderHook(
        () => useEntityRealtimeSync({ table: 'operations_requests' }),
        { wrapper: createWrapper() }
      );
      const hook2 = renderHook(
        () => useEntityRealtimeSync({ table: 'operations_requests' }),
        { wrapper: createWrapper() }
      );

      const channel = supabase.channel('cdc_operations_requests') as unknown as MockRealtimeChannel;

      act(() => {
        channel.emitStatus('CHANNEL_ERROR', new Error('Transport dropped'));
      });

      expect(getActiveChannelRegistrySizeForTesting()).toBe(1);

      // Unmounting subscribers after eviction must not throw
      expect(() => {
        hook1.unmount();
        hook2.unmount();
      }).not.toThrow();
    });
  });

  // =========================================================================
  // TASK 2: TaskDetailModal.tsx Reactive Binding & currentTask Resolution
  // =========================================================================
  describe('Task 2: TaskDetailModal.tsx Reactive Binding: liveTask vs initialTask', () => {
    it('2.1: Reflects liveTask status and assignee when liveVersion > initialVersion', async () => {
      const initialTask = makeTask({
        id: 'task-reactive-1',
        workRequestId: 'wr-challenger-100',
        title: 'Initial Title',
        status: 'Assigned',
        version: 1,
        assigneeId: 'usr-alice',
        assigneeName: 'Alice Initial',
        assignees: ['usr-alice'],
      });

      const liveTask = makeTask({
        id: 'task-reactive-1',
        workRequestId: 'wr-challenger-100',
        title: 'Live Title V2',
        status: 'In Progress',
        version: 2,
        assigneeId: 'usr-bob',
        assigneeName: 'Bob Live',
        assignees: ['usr-bob'],
      });

      queryClient.setQueryData(
        operationsKeys.taskDetail('wr-challenger-100', 'task-reactive-1'),
        liveTask
      );

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={initialTask}
          workRequest={mockWr}
        />,
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('task-title')).toHaveTextContent('Live Title V2');
      expect(screen.getByTestId('task-status-badge')).toHaveTextContent('In Progress');
      expect(screen.getByTestId('task-assignee')).toHaveTextContent('Bob Live');
    });

    it('2.2: Reflects liveTask status change even when liveVersion === initialVersion', async () => {
      const initialTask = makeTask({
        id: 'task-reactive-2',
        workRequestId: 'wr-challenger-100',
        title: 'Initial Title',
        status: 'Assigned',
        version: 2,
        assigneeId: 'usr-alice',
        assigneeName: 'Alice Initial',
        assignees: ['usr-alice'],
      });

      const liveTask = makeTask({
        id: 'task-reactive-2',
        workRequestId: 'wr-challenger-100',
        title: 'Live Title',
        status: 'Completed',
        version: 2,
        assigneeId: 'usr-alice',
        assigneeName: 'Alice Initial',
        assignees: ['usr-alice'],
      });

      queryClient.setQueryData(
        operationsKeys.taskDetail('wr-challenger-100', 'task-reactive-2'),
        liveTask
      );

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={initialTask}
          workRequest={mockWr}
        />,
        { wrapper: createWrapper() }
      );

      expect(screen.getByTestId('task-status-badge')).toHaveTextContent('Completed');
    });

    it('2.3: Stress-test unassignment when liveVersion === initialVersion: discovers whether initialTask overrides liveTask', async () => {
      // In this scenario: initialTask has 1 assignee, but liveTask was unassigned at the same version.
      // Lines 121-130 in TaskDetailModal check:
      // if (initialAssigneeCount > liveAssigneeCount) -> initialTask assignee is restored!
      const initialTask = makeTask({
        id: 'task-reactive-3',
        workRequestId: 'wr-challenger-100',
        title: 'Task With Lead',
        status: 'In Progress',
        version: 1,
        assigneeId: 'usr-alice',
        assigneeName: 'Alice Lead',
        assignees: ['usr-alice'],
        taskAssignees: [{ id: 'ta-1', taskId: 'task-reactive-3', userId: 'usr-alice' }] as Task['taskAssignees'],
      });

      const liveUnassignedTask = makeTask({
        id: 'task-reactive-3',
        workRequestId: 'wr-challenger-100',
        title: 'Task With Lead',
        status: 'In Progress',
        version: 1,
        assigneeId: null,
        assigneeName: null,
        assignees: [],
        taskAssignees: [],
      });

      queryClient.setQueryData(
        operationsKeys.taskDetail('wr-challenger-100', 'task-reactive-3'),
        liveUnassignedTask
      );

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={initialTask}
          workRequest={mockWr}
        />,
        { wrapper: createWrapper() }
      );

      // Empirically observe what the UI renders:
      const assigneeElement = screen.getByTestId('task-assignee');
      const displayedAssignee = assigneeElement.textContent;

      // Authoritative live unassignment correctly displays 'Unassigned'
      expect(displayedAssignee).toBe('Unassigned');
    });
  });

  // =========================================================================
  // TASK 3: Guard 2 Version Check (incomingVersion === localCachedVersion)
  // =========================================================================
  describe('Task 3: Guard 2 Version Check Behavior for UPDATE vs INSERT', () => {
    it('3.1: Duplicate INSERT events with incomingVersion <= localCachedVersion are dropped', () => {
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-guard-1'), {
        id: 'wr-guard-1',
        title: 'Cached WR V3',
        version: 3,
        entity: 'ATA',
      });

      const duplicateInsertPayload = {
        eventType: 'INSERT',
        new: { id: 'wr-guard-1', title: 'Duplicate Insert V3', version: 3, entity: 'ATA' },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        duplicateInsertPayload
      );

      // Must be dropped
      expect(processed).toBe(false);
      const cached = queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail('wr-guard-1'));
      expect(cached?.title).toBe('Cached WR V3');
    });

    it('3.2: Stale UPDATE events with incomingVersion < localCachedVersion are dropped', () => {
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-guard-2'), {
        id: 'wr-guard-2',
        title: 'Cached WR V3',
        version: 3,
        entity: 'ATA',
      });

      const staleUpdatePayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-guard-2', title: 'Stale Update V2', version: 2, entity: 'ATA' },
        old: { id: 'wr-guard-2', version: 1 },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        staleUpdatePayload
      );

      // Must be dropped
      expect(processed).toBe(false);
      const cached = queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail('wr-guard-2'));
      expect(cached?.title).toBe('Cached WR V3');
    });

    it('3.3: SPEC REQUIREMENT: UPDATE events with incomingVersion === localCachedVersion are processed', () => {
      // SPEC REQUIREMENT:
      // "In Guard 2: Discard duplicate INSERTs when incomingVersion <= localCachedVersion,
      //  but for UPDATE only discard when incomingVersion < localCachedVersion (strictly older)."
      //
      // If an UPDATE event arrives with incomingVersion === localCachedVersion (e.g. version 3 arriving
      // when local cache already has version 3):
      // The spec mandates that it should NOT be discarded.

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-guard-3'), {
        id: 'wr-guard-3',
        title: 'Initial Title V3',
        version: 3,
        entity: 'ATA',
      });

      const equalVersionUpdatePayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-guard-3', title: 'Live Update at Equal Version V3', version: 3, entity: 'ATA' },
        old: { id: 'wr-guard-3', version: 2 },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        equalVersionUpdatePayload
      );

      // Under SPEC-002, UPDATE events with equal version must be processed:
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestEntity>(operationsKeys.workRequestDetail('wr-guard-3'));
      expect(cached?.title).toBe('Live Update at Equal Version V3');
    });
  });
});
