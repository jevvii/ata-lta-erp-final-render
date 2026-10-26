import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useWorkRequests,
  useWorkRequestDetail,
  useWorkRequestCounts,
  useWorkRequestMutations,
  useTaskMutations,
  usePhaseTransitions,
  useQaReview,
  useRetainerMutations,
  operationsKeys,
} from '../api';
import { ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import * as tabSync from '@/lib/tabSync';
import * as flags from '@/lib/flags';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

describe('useWorkRequests & Operations Data Layer (Zero Optimistic Updates Doctrine)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['workflow:edit', 'workflow:phase_transition', 'workflow:qa_review'],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Queries', () => {
    it('useWorkRequests fetches work requests list with filters and active entity', async () => {
      const mockList = [
        {
          id: 'wr-1',
          entity: 'ATA',
          title: 'SEC Annual Report',
          status: 'In Progress',
          phase: 'pre_processing',
          onHold: false,
          priority: 'Normal',
          archived: false,
          coAssignees: [],
          tasks: [],
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: mockList, meta: { total: 1 } }),
      } as Response);

      const { wrapper } = createWrapper();
      const { result } = renderHook(
        () => useWorkRequests({ status: 'In Progress', phase: 'pre_processing' }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.data).toHaveLength(1);
      expect(result.current.data?.data[0]?.title).toBe('SEC Annual Report');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall).toBeDefined();
      expect(fetchCall![0]).toContain('/operations/work-requests?status=In+Progress&phase=pre_processing');
      expect(fetchCall![1].headers['X-Active-Entity']).toBe('ATA');
    });

    it('useWorkRequestDetail fetches single work request graph', async () => {
      const mockDetail = {
        id: 'wr-1',
        title: 'BIR Form 1702Q',
        phase: 'processing',
        tasks: [
          {
            id: 'task-1',
            title: 'Gather Receipts',
            phase: 'processing',
            status: 'Completed',
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: mockDetail }),
      } as Response);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWorkRequestDetail('wr-1'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe('wr-1');
      expect(result.current.data?.tasks).toHaveLength(1);
    });

    it('useWorkRequestCounts fetches counter breakdown', async () => {
      const mockCounts = {
        all: 10,
        pre_processing: 3,
        processing: 4,
        quality_assurance: 2,
        completion: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: mockCounts }),
      } as Response);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWorkRequestCounts(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.all).toBe(10);
      expect(result.current.data?.processing).toBe(4);
    });
  });

  describe('Work Request Mutations & Invalidation Doctrine', () => {
    it('createWorkRequest executes POST and invalidates workRequests and counts without optimistic writes', async () => {
      const newWr = {
        id: 'wr-new-1',
        title: 'Draft Financial Statements',
        phase: 'pre_processing',
        status: 'Draft',
        entity: 'ATA',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: newWr }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      // Cache starts completely empty (zero optimistic updates)
      expect(queryClient.getQueryData(operationsKeys.workRequests())).toBeUndefined();

      const created = await result.current.createWorkRequest({ dueDate: '2026-12-31',
        title: 'Draft Financial Statements',
        entity: 'ATA',
        phase: 'pre_processing',
      });

      expect(created.id).toBe('wr-new-1');

      // Verifies cache invalidations
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
    });

    it('updateWorkRequest executes PUT and invalidates detail and list', async () => {
      const updatedWr = {
        id: 'wr-1',
        title: 'Updated Title',
        phase: 'pre_processing',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: updatedWr }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.updateWorkRequest({
        id: 'wr-1',
        data: { title: 'Updated Title' },
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
    });

    it('archiveWorkRequest executes POST /archive and invalidates detail, list, and counts', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'wr-1', archived: true } }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.archiveWorkRequest('wr-1');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
    });

    it('restoreWorkRequest executes POST /unarchive and invalidates detail, list, and counts', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'wr-1', archived: false } }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.restoreWorkRequest('wr-1');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
    });

    it('cancelWorkRequest executes DELETE and invalidates detail, list, and counts', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => null,
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.cancelWorkRequest('wr-1');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
    });

    it('statusOptimistic updates cache immediately, commits confirmed server response, and persists', async () => {
      const initialWr = {
        id: 'wr-1',
        title: 'Audit Report',
        entity: 'ATA',
        status: 'In Progress',
        phase: 'processing',
      };
      const updatedServerWr = {
        ...initialWr,
        status: 'For Supervisor Review',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: updatedServerWr }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      // Seed detail and list cache
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-1'), initialWr);
      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [initialWr],
        meta: { total: 1 },
      });

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.statusOptimistic({
        id: 'wr-1',
        status: 'For Supervisor Review',
        entity: 'ATA',
      });

      // Verify detail cache has confirmed server truth
      const detail = queryClient.getQueryData<typeof initialWr>(
        operationsKeys.workRequestDetail('wr-1')
      );
      expect(detail?.status).toBe('For Supervisor Review');

      // Verify list cache has updated status in place
      const listData = queryClient.getQueryData<{ data: Array<typeof initialWr> }>(
        operationsKeys.workRequestsList('ATA')
      );
      expect(listData?.data[0]?.status).toBe('For Supervisor Review');
    });

    it('statusOptimistic attaches expectedVersion when strict_occ is enabled', async () => {
      vi.spyOn(flags, 'isFeatureEnabled').mockImplementation((flag) => flag === 'strict_occ');

      const initialWr = {
        id: 'wr-occ-1',
        title: 'Tax Assessment',
        entity: 'ATA',
        status: 'In Progress',
        version: 3,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { ...initialWr, status: 'Completed', version: 4 } }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-occ-1'), initialWr);

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.statusOptimistic({
        id: 'wr-occ-1',
        status: 'Completed',
        entity: 'ATA',
        expectedVersion: 3,
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall).toBeDefined();
      const body = JSON.parse(fetchCall![1].body as string);
      expect(body.expectedVersion).toBe(3);
      expect(body.status).toBe('Completed');
    });

    it('statusOptimistic omits expectedVersion when strict_occ is disabled', async () => {
      vi.spyOn(flags, 'isFeatureEnabled').mockImplementation(() => false);

      const initialWr = {
        id: 'wr-occ-2',
        title: 'Financial Review',
        entity: 'ATA',
        status: 'Draft',
        version: 2,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { ...initialWr, status: 'In Progress', version: 3 } }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-occ-2'), initialWr);

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.statusOptimistic({
        id: 'wr-occ-2',
        status: 'In Progress',
        entity: 'ATA',
        expectedVersion: 2,
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall).toBeDefined();
      const body = JSON.parse(fetchCall![1].body as string);
      expect(body.expectedVersion).toBeUndefined();
      expect(body.status).toBe('In Progress');
    });

    it('statusOptimistic rolls back optimistic cache on 409 concurrency conflict', async () => {
      const initialWr = {
        id: 'wr-conflict-1',
        title: 'SEC Registration',
        entity: 'ATA',
        status: 'Received',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({
          status: 409,
          code: 'ERR_CONCURRENCY_CONFLICT',
          title: 'Conflict',
          detail: 'The record was modified by another user. Please reload the latest version before editing.',
        }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-conflict-1'), initialWr);
      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [initialWr],
        meta: { total: 1 },
      });

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      let caughtConflictError: unknown;
      try {
        await result.current.statusOptimistic({
          id: 'wr-conflict-1',
          status: 'In Progress',
          entity: 'ATA',
          expectedVersion: 1,
        });
      } catch (err) {
        caughtConflictError = err;
      }

      expect(caughtConflictError).toBeDefined();
      expect(caughtConflictError).toBeInstanceOf(ApiError);
      expect((caughtConflictError as ApiError).status).toBe(409);
      expect(isConcurrencyConflictError(caughtConflictError)).toBe(true);

      // Verify cache rolled back to original status
      const detail = queryClient.getQueryData<typeof initialWr>(
        operationsKeys.workRequestDetail('wr-conflict-1')
      );
      expect(detail?.status).toBe('Received');

      const listData = queryClient.getQueryData<{ data: Array<typeof initialWr> }>(
        operationsKeys.workRequestsList('ATA')
      );
      expect(listData?.data[0]?.status).toBe('Received');
    });

    it('statusOptimistic omits expectedVersion when expectedVersion is omitted (undefined) even if strict_occ is enabled', async () => {
      vi.spyOn(flags, 'isFeatureEnabled').mockImplementation((flag) => flag === 'strict_occ');

      const initialWr = {
        id: 'wr-occ-undef-1',
        title: 'Tax Assessment Undefined',
        entity: 'ATA',
        status: 'In Progress',
        version: 3,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { ...initialWr, status: 'Completed', version: 4 } }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-occ-undef-1'), initialWr);

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.statusOptimistic({
        id: 'wr-occ-undef-1',
        status: 'Completed',
        entity: 'ATA',
        expectedVersion: undefined,
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(fetchCall).toBeDefined();
      const body = JSON.parse(fetchCall![1].body as string);
      expect(body.expectedVersion).toBeUndefined();
      expect(body.status).toBe('Completed');
    });

    it('statusOptimistic rolls back cache on non-409 error (HTTP 500) and bypasses conflict modal', async () => {
      const initialWr = {
        id: 'wr-500-1',
        title: 'Server Crash Test',
        entity: 'ATA',
        status: 'Draft',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({
          status: 500,
          code: 'INTERNAL_SERVER_ERROR',
          title: 'Internal Server Error',
          detail: 'Database pool connection exhausted',
        }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-500-1'), initialWr);
      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [initialWr],
        meta: { total: 1 },
      });

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      let caughtError: unknown;
      try {
        await result.current.statusOptimistic({
          id: 'wr-500-1',
          status: 'In Progress',
          entity: 'ATA',
          expectedVersion: 1,
        });
      } catch (err) {
        caughtError = err;
      }

      // 1. Verify mutation re-throws ApiError with HTTP 500
      expect(caughtError).toBeInstanceOf(ApiError);
      expect((caughtError as ApiError).status).toBe(500);
      expect((caughtError as ApiError).code).toBe('INTERNAL_SERVER_ERROR');

      // 2. Verify cache rolls back to original pre-mutation status
      const detail = queryClient.getQueryData<typeof initialWr>(
        operationsKeys.workRequestDetail('wr-500-1')
      );
      expect(detail?.status).toBe('Draft');

      const listData = queryClient.getQueryData<{ data: Array<typeof initialWr> }>(
        operationsKeys.workRequestsList('ATA')
      );
      expect(listData?.data[0]?.status).toBe('Draft');

      // 3. Verify error is NOT recognized as a concurrency conflict (bypasses ConflictResolutionModal)
      expect(isConcurrencyConflictError(caughtError)).toBe(false);
    });

    it('statusOptimistic dispatches broadcastEntityChange on mutation success', async () => {
      const broadcastSpy = vi.spyOn(tabSync, 'broadcastEntityChange');

      const initialWr = {
        id: 'wr-broadcast-1',
        title: 'Quarterly Filing',
        entity: 'ATA',
        status: 'In Progress',
        version: 5,
      };
      const serverWr = {
        ...initialWr,
        status: 'For Supervisor Review',
        version: 6,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: serverWr }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-broadcast-1'), initialWr);

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await result.current.statusOptimistic({
        id: 'wr-broadcast-1',
        status: 'For Supervisor Review',
        entity: 'ATA',
        expectedVersion: 5,
      });

      expect(broadcastSpy).toHaveBeenCalledWith({
        domain: 'operations',
        entityId: 'wr-broadcast-1',
        entityData: serverWr,
      });
    });

    it('propagates verbatim RFC 7807 code and detail when createWorkRequest fails with TASK_LIMIT_EXCEEDED', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          status: 400,
          title: 'Bad Request',
          code: 'TASK_LIMIT_EXCEEDED',
          detail: 'Delimiter tokenizer exceeded maximum limit: 52 tasks created (maximum is 50)',
        }),
      } as Response);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      await expect(
        result.current.createWorkRequest({ dueDate: '2026-12-31',
          title: 'Task with too many delimiters...',
          entity: 'ATA',
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.code).toBe('TASK_LIMIT_EXCEEDED');
        expect(apiErr.detail).toBe(
          'Delimiter tokenizer exceeded maximum limit: 52 tasks created (maximum is 50)'
        );
        return true;
      });
    });
  });

  describe('Task Mutations & Task Phase Immutability', () => {
    it('createTask invalidates workRequestDetail and tasks', async () => {
      const mockTask = {
        id: 'task-new-1',
        workRequestId: 'wr-1',
        title: 'New Subtask',
        phase: 'pre_processing',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: mockTask }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useTaskMutations('wr-1'), { wrapper });

      await result.current.createTask({
        title: 'New Subtask',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.tasks('wr-1'),
      });
    });

    it('surfaces TASK_PHASE_IMMUTABLE verbatim when attempting to mutate task phase', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          status: 400,
          title: 'Bad Request',
          code: 'TASK_PHASE_IMMUTABLE',
          detail: 'Task phase is immutable once created',
        }),
      } as Response);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTaskMutations('wr-1'), { wrapper });

      await expect(
        result.current.updateTask('task-1', {
          title: 'Renamed Task',
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('TASK_PHASE_IMMUTABLE');
        expect(apiErr.detail).toBe('Task phase is immutable once created');
        return true;
      });
    });

    it('deleteTask removes task and invalidates detail and tasks cache', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => null,
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useTaskMutations('wr-1'), { wrapper });

      await result.current.deleteTask('task-1');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.tasks('wr-1'),
      });
    });
  });

  describe('Phase Transitions & QA Review', () => {
    it('advancePhase invalidates detail, tasks, and counts on advancement success', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { id: 'wr-1', phase: 'processing' },
        }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => usePhaseTransitions('wr-1'), { wrapper });

      await result.current.advancePhase('processing');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.tasks('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
    });

    it('surfaces GATE_PREREQUISITE_FAILED verbatim when active tasks are incomplete', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({
          status: 409,
          code: 'GATE_PREREQUISITE_FAILED',
          detail: 'Advancement gate failed: 2 active task(s) in phase "pre_processing" are incomplete',
        }),
      } as Response);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => usePhaseTransitions('wr-1'), { wrapper });

      await expect(result.current.advancePhase('processing')).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(409);
        expect(apiErr.code).toBe('GATE_PREREQUISITE_FAILED');
        expect(apiErr.detail).toContain('2 active task(s) in phase "pre_processing" are incomplete');
        return true;
      });
    });

    it('submitReroute reopens failed tasks and invalidates detail and tasks cache', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { id: 'wr-1', phase: 'processing', reopenedTaskIds: ['task-1'] },
        }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useQaReview('wr-1'), { wrapper });

      await result.current.submitReroute({
        to_phase: 'processing',
        reason: 'Document signature missing on page 3',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.tasks('wr-1'),
      });
    });
  });

  describe('Retainer Generation', () => {
    it('generateFromTemplate executes POST and invalidates workRequests and counts', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({
          data: { id: 'wr-gen-1', title: 'Monthly Retainer - FY-2026' },
        }),
      } as Response);

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useRetainerMutations(), { wrapper });

      await result.current.generateFromTemplate({
        templateId: 'tpl-1',
        period_label: 'FY-2026',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
    });

    it('surfaces DUPLICATE_PERIOD_GENERATION verbatim on duplicate recurrence attempt', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({
          status: 409,
          code: 'DUPLICATE_PERIOD_GENERATION',
          detail: 'Retainer template has already been generated for period "FY-2026"',
        }),
      } as Response);

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useRetainerMutations(), { wrapper });

      await expect(
        result.current.generateFromTemplate({
          templateId: 'tpl-1',
          period_label: 'FY-2026',
        })
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(409);
        expect(apiErr.code).toBe('DUPLICATE_PERIOD_GENERATION');
        expect(apiErr.detail).toBe('Retainer template has already been generated for period "FY-2026"');
        return true;
      });
    });
  });
});
