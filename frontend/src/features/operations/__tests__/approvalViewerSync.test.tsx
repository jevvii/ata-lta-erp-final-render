import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useSessionStore } from '@/lib/session';
import { getScopeGeneration, apiRequest, ApiError, queryClient as appQueryClient } from '@/lib/api';
import { operationsKeys } from '../api/queryKeys';
import { useWorkRequestCreationApprovals } from '../api/useWorkRequests';
import { useTaskMutations } from '../api/useTasks';
import { TaskResubmitModal } from '../components/TaskResubmitModal';
import { handleIncomingTabSyncMessage } from '@/lib/tabSync';
import { handleRealtimePayload, clearChannelRegistryForTesting } from '@/lib/realtime/useEntityRealtimeSync';
import type { Task, WorkRequest } from '../api/types';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, null, children)
    );

  return { queryClient, wrapper };
}

const mockManagerUser = {
  id: 'u-lead-mgr',
  email: 'lead@ata-lta.ph',
  name: 'Lead Manager',
  role: 'Manager',
  departments: ['Operations'],
  entities: ['ATA'],
};

const mockEmployeeUser = {
  id: 'u-emp-creator',
  email: 'emp@ata-lta.ph',
  name: 'Employee Creator',
  role: 'Employee',
  departments: ['Operations'],
  entities: ['ATA'],
};

const mockWr: WorkRequest = {
  id: 'wr-101',
  title: 'Quarterly Audit 2026',
  description: 'Audit engagement',
  clientId: 'c-1',
  phaseEnteredAt: null,
  entity: 'ATA',
  status: 'In Progress',
  phase: 'pre_processing',
  onHold: false,
  priority: 'Normal',
  archived: false,
  requestedBy: 'u-admin-1',
  assignedTo: 'u-lead-mgr',
  coAssignees: [],
  hasManagerLead: true,
  creationApprovalStatus: 'approved',
  version: 3,
  dueDate: '2026-11-30T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const mockRejectedTask: Task = {
  id: 'task-202',
  workRequestId: 'wr-101',
  title: 'Compile Receipts',
  description: 'Original description',
  phase: 'pre_processing',
  status: 'Draft',
  qaStatus: 'none',
  phaseEnteredAt: null,
  assigneeId: 'u-emp-creator',
  assigneeName: 'Employee Creator',
  assignees: ['u-emp-creator'],
  predecessors: [],
  dueDate: null,
  requiredLinkType: null,
  displayOrder: 1,
  approvalStatus: 'rejected',
  rejectionReason: 'Needs detailed itemization per receipt category',
  reviewedBy: 'u-lead-mgr',
  reviewedAt: '2026-10-03T10:00:00Z',
  createdBy: 'u-emp-creator',
  canResubmit: true,
  version: 2,
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-03T10:00:00Z',
};

describe('Multi-Viewer Synchronization, OCC and Caching (approval-viewer-sync)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockReset().mockResolvedValue({ data: [] });
    localStorage.clear();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    clearChannelRegistryForTesting();
    useSessionStore.getState().setSession({
      user: mockManagerUser,
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
    clearChannelRegistryForTesting();
  });

  describe('1. Visible-tab Authorized Polling Fallback (5-10s)', () => {
    it('refreshes another viewer through HTTP every eight visible seconds and immediately on focus', async () => {
      vi.useFakeTimers();
      const { wrapper } = createHarness();
      vi.mocked(apiRequest).mockResolvedValueOnce({ data: [{ id: 'wr-101', version: 1 }] })
        .mockResolvedValue({ data: [{ id: 'wr-101', version: 2 }] });
      const { result } = renderHook(() => useWorkRequestCreationApprovals({ status: 'pending' }), { wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(result.current.data?.[0]?.version).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
      expect(result.current.data?.[0]?.version).toBe(2);
      const calls = vi.mocked(apiRequest).mock.calls.length;
      await act(async () => { focusManager.setFocused(false); await vi.advanceTimersByTimeAsync(16000); });
      expect(apiRequest).toHaveBeenCalledTimes(calls);
      await act(async () => { focusManager.setFocused(true); await vi.advanceTimersByTimeAsync(1); });
      expect(vi.mocked(apiRequest).mock.calls.length).toBeGreaterThan(calls);
    });

    it('stops interval polling after access is denied', async () => {
      vi.useFakeTimers();
      vi.mocked(apiRequest).mockRejectedValue(new ApiError(403, 'Forbidden'));
      const { wrapper } = createHarness();
      const { result } = renderHook(() => useWorkRequestCreationApprovals(), { wrapper });
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(result.current.error).toMatchObject({ status: 403 });
      await act(async () => { await vi.advanceTimersByTimeAsync(24000); });
      expect(apiRequest).toHaveBeenCalledTimes(1);
    });

    it('operationsKeys.workRequestCreationApprovals with no args returns clean root prefix for broad invalidation', () => {
      const rootKey = operationsKeys.workRequestCreationApprovals();
      expect(rootKey).toEqual(['operations', 'workRequests', 'creationApprovals']);

      const scopedPending = operationsKeys.workRequestCreationApprovals('pending', 'mine');
      expect(scopedPending).toEqual(['operations', 'workRequests', 'creationApprovals', 'pending', 'mine']);

      expect(scopedPending.slice(0, rootKey.length)).toEqual(rootKey);
    });
  });

  describe('2. CDC & TabSync Invalidation over Raw Payload Injection', () => {
    it('tabSync ENTITY_MUTATED on operations domain invalidates query caches rather than setQueryData with raw objects', () => {
      const { queryClient } = createHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-101',
        entityData: { id: 'wr-101', title: 'Mutated in Tab A', canReview: true },
        originTabId: 'other-tab',
        timestamp: Date.now(),
      });

      expect(invalidateSpy).toHaveBeenCalled();
      expect(setQueryDataSpy).not.toHaveBeenCalled();
    });

    it('tasks CDC events invalidate target WR tasks and detail instead of injecting flat snake_case DB rows into cache', () => {
      const { queryClient } = createHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

      // Seed cache so task WR ID is resolvable
      queryClient.setQueryData(operationsKeys.tasks('wr-101'), [mockRejectedTask]);
      setQueryDataSpy.mockClear();
      useSessionStore.getState().updateUser?.({ role: 'Admin' });

      handleRealtimePayload(
        queryClient,
        { table: 'tasks' },
        {
          schema: 'public',
          table: 'tasks',
          commit_timestamp: '2026-10-26T12:00:00Z',
          eventType: 'UPDATE',
          new: {
            id: 'task-202',
            work_request_id: 'wr-101',
            approval_status: 'approved',
            version: 3,
          },
          old: { id: 'task-202', version: 2 },
          errors: null,
        }
      );

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.tasks('wr-101'),
        })
      );
      expect(setQueryDataSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Session, Role, and Context Switch Cache Isolation', () => {
    it('role switch increments scope generation and clears query cache to prevent permission leaks', () => {
      const initialGen = getScopeGeneration();

      act(() => {
        useSessionStore.getState().setSession({
          user: mockEmployeeUser,
          permissions: ['workflow:view'],
          activeEntity: 'ATA',
        });
      });

      expect(getScopeGeneration()).toBeGreaterThan(initialGen);
    });

    it('stale optimistic rollback does not overwrite cache if context switch occurred while mutation was in-flight', async () => {
      const { queryClient, wrapper } = createHarness();

      queryClient.setQueryData(operationsKeys.tasks('wr-101'), [
        { ...mockRejectedTask, status: 'Draft' },
      ]);

      const { result } = renderHook(() => useTaskMutations('wr-101'), { wrapper });

      let rejectMutationPromise: (err: unknown) => void = () => {};
      vi.mocked(apiRequest).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectMutationPromise = reject;
          })
      );

      const mutationPromise = result.current.updateTask(mockRejectedTask.id, { status: 'Completed' }).catch((error: unknown) => error);
      await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));

      // Context switch occurs while mutation is in-flight
      act(() => {
        useSessionStore.getState().setSession({
          user: mockEmployeeUser,
          permissions: ['workflow:view'],
          activeEntity: 'LTA',
        });
      });

      // Clear/reset cache for the new context
      queryClient.setQueryData(operationsKeys.tasks('wr-101'), []);

      // Now the in-flight mutation fails
      await act(async () => {
        rejectMutationPromise(new Error('Network error'));
        try {
          await mutationPromise;
        } catch {
          // Expected error
        }
      });

      // Cache must NOT have rolled back to the old snapshot
      const cacheAfterRollback = queryClient.getQueryData<Task[]>(operationsKeys.tasks('wr-101'));
      expect(cacheAfterRollback).toEqual([]);
    });
  });

  it('removes old account data from a mounted observer on an account switch', async () => {
    appQueryClient.clear();
    vi.mocked(apiRequest).mockResolvedValue({ data: [mockWr] });
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: appQueryClient }, children);
    const { result, unmount } = renderHook(() => useWorkRequestCreationApprovals(), { wrapper });
    await waitFor(() => expect(result.current.data?.[0]?.id).toBe(mockWr.id));
    vi.mocked(apiRequest).mockResolvedValue({ data: [] });
    act(() => { useSessionStore.getState().setSession({ user: mockEmployeeUser,
      permissions: ['workflow:view'], activeEntity: 'ATA' }); });
    await waitFor(() => expect(result.current.data).toEqual([]));
    unmount();
    appQueryClient.clear();
  });

  it('does not discard caches for a same-value session refresh', () => {
    const generation = getScopeGeneration();
    useSessionStore.getState().setSession({ user: { ...mockManagerUser, entities: ['ATA'] },
      permissions: new Set(['workflow:edit', 'workflow:view']), activeEntity: 'ATA' });
    expect(getScopeGeneration()).toBe(generation);
  });

  it.each(['conflict', 'late-success'] as const)('preserves newer review state and unrelated rows after %s', async (outcome) => {
    const { queryClient, wrapper } = createHarness();
    const original = { ...mockRejectedTask, approvalStatus: 'pending' as const, status: 'In Progress' as const };
    const other = { ...original, id: 'other-task', version: 1 };
    queryClient.setQueryData(operationsKeys.tasks('wr-101', 'ATA'), [original, other]);
    queryClient.setQueryData(operationsKeys.taskDetail('wr-101', original.id), original);
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    vi.mocked(apiRequest).mockImplementationOnce(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const { result } = renderHook(() => useTaskMutations('wr-101'), { wrapper });
    const mutation = result.current.updateTask(original.id, { status: 'Completed' }).catch((error: unknown) => error);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const winner = { ...original, approvalStatus: 'approved' as const, version: 5 };
    const otherWinner = { ...other, title: 'Edited by another viewer', version: 8 };
    queryClient.setQueryData(operationsKeys.tasks('wr-101', 'ATA'), [winner, otherWinner]);
    queryClient.setQueryData(operationsKeys.taskDetail('wr-101', original.id), winner);
    await act(async () => {
      if (outcome === 'conflict') reject(new ApiError(409, 'Conflict'));
      else resolve({ data: { ...original, status: 'Completed', version: 3 } });
      await mutation;
    });
    expect(queryClient.getQueryData(operationsKeys.tasks('wr-101', 'ATA'))).toEqual([winner, otherWinner]);
    expect(queryClient.getQueryData(operationsKeys.taskDetail('wr-101', original.id))).toEqual(winner);
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('cancels before sending when scope changes during asynchronous query cancellation', async () => {
    const { queryClient, wrapper } = createHarness();
    let release!: () => void;
    vi.spyOn(queryClient, 'cancelQueries').mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useTaskMutations('wr-101'), { wrapper });
    const mutation = result.current.updateTask('task-202', { status: 'Completed' }).catch((error: unknown) => error);
    await waitFor(() => expect(queryClient.cancelQueries).toHaveBeenCalled());
    useSessionStore.getState().setActiveEntity('LTA');
    await act(async () => { release(); await mutation; });
    expect(apiRequest).not.toHaveBeenCalled();
  });

  describe('4. OCC 409 Conflict Handling without Replay', () => {
    it('409 concurrency conflict on task creation approval invalidates tasks and detail without retrying stale version', async () => {
      const { queryClient, wrapper } = createHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      vi.mocked(apiRequest).mockRejectedValueOnce(
        new ApiError(409, 'Conflict', 'Version conflict', 'CONCURRENCY_CONFLICT')
      );

      const { result } = renderHook(() => useTaskMutations('wr-101'), { wrapper });

      await act(async () => {
        try {
          await result.current.approveOrRejectTaskCreation({
            workRequestId: 'wr-101',
            taskId: 'task-202',
            decision: 'approve',
            expectedVersion: 1,
          });
        } catch (err) {
          expect(err).toBeInstanceOf(ApiError);
        }
      });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.tasks('wr-101'),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.workRequestDetail('wr-101'),
        })
      );
    });
  });

  describe('5. TaskResubmitModal: Draft Preservation & Original Version Locking', () => {
    it('does not overwrite in-progress user draft or rebase expectedVersion when background polling updates task prop', async () => {
      useSessionStore.getState().setSession({
        user: mockEmployeeUser,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      const mockSuccess = vi.fn();

      const { rerender } = render(
        <TaskResubmitModal
          isOpen={true}
          task={mockRejectedTask}
          workRequest={mockWr}
          onClose={vi.fn()}
          onSuccess={mockSuccess}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('task-resubmit-modal')).toBeInTheDocument();

      // User modifies the title in the modal
      const titleInput = screen.getByTestId('task-resubmit-title-input') as HTMLInputElement;
      fireEvent.change(titleInput, { target: { value: 'Itemized Receipts 2026 - Corrected' } });
      expect(titleInput.value).toBe('Itemized Receipts 2026 - Corrected');

      // Simulate a background polling refetch delivering an updated task object with bumped version
      const backgroundRefetchedTask: Task = {
        ...mockRejectedTask,
        title: 'Compile Receipts (Server Title Stale)',
        version: 5,
      };

      rerender(
        <TaskResubmitModal
          isOpen={true}
          task={backgroundRefetchedTask}
          workRequest={mockWr}
          onClose={vi.fn()}
          onSuccess={mockSuccess}
        />
      );

      // User's typed draft must NOT be overwritten by the background refetch
      expect(titleInput.value).toBe('Itemized Receipts 2026 - Corrected');

      // Submitting must submit the CAPTURED original version (2), NOT auto-rebased (5)
      vi.mocked(apiRequest).mockResolvedValueOnce({
        data: { ...mockRejectedTask, version: 3, approvalStatus: 'pending' },
      });

      const submitButton = screen.getByTestId('task-resubmit-submit-btn');
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(apiRequest).toHaveBeenCalledWith(
          '/operations/work-requests/wr-101/tasks/task-202/resubmit-creation',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"expectedVersion":2'),
          })
        );
      });
    });
  });
});
