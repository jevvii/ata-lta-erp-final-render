import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useWorkRequestMutations,
  useTaskMutations,
  usePhaseTransitions,
  useQaReview,
  useDocumentMutations,
  operationsKeys,
} from '../api';
import {
  runBlockingAction,
  useBlockingModalStore,
} from '../components/BlockingActionModal';
import { ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

describe('Adversarial Challenge Suite — Milestone 1 TanStack Query Data Layer', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-challenger-1',
        email: 'challenger@ata-lta.ph',
        name: 'Challenger',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:task_add',
        'workflow:phase_transition',
        'workflow:transition_request',
        'workflow:qa_review',
        'retainers:use',
        'retainers:edit',
      ],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    useBlockingModalStore.getState().reset();
  });

  // ==========================================================================
  // CHALLENGE 1: Concurrency Safety & Mutex Lock Stress Testing
  // ==========================================================================
  describe('Concurrency & Pointer Lock Under Rapid Double-Clicks', () => {
    it('prevents duplicate in-flight requests on rapid simultaneous double/multi-clicks', async () => {
      let callCount = 0;
      let resolveFirstCall: (val: unknown) => void = () => {};

      const delayedApiCall = () =>
        new Promise((resolve) => {
          callCount++;
          resolveFirstCall = resolve;
        });

      // Rapidly fire 5 simultaneous actions
      const promise1 = runBlockingAction({
        title: 'Action 1',
        message: 'Processing...',
        apiCall: delayedApiCall,
      });

      const promise2 = runBlockingAction({
        title: 'Action 2 (Rapid Click)',
        message: 'Processing...',
        apiCall: delayedApiCall,
      });

      const promise3 = runBlockingAction({
        title: 'Action 3 (Rapid Click)',
        message: 'Processing...',
        apiCall: delayedApiCall,
      });

      const promise4 = runBlockingAction({
        title: 'Action 4 (Rapid Click)',
        message: 'Processing...',
        apiCall: delayedApiCall,
      });

      const promise5 = runBlockingAction({
        title: 'Action 5 (Rapid Click)',
        message: 'Processing...',
        apiCall: delayedApiCall,
      });

      // Subsequent 4 calls must immediately reject with concurrency error
      await expect(promise2).rejects.toThrow(
        'Another operation is already in progress. Please wait.'
      );
      await expect(promise3).rejects.toThrow(
        'Another operation is already in progress. Please wait.'
      );
      await expect(promise4).rejects.toThrow(
        'Another operation is already in progress. Please wait.'
      );
      await expect(promise5).rejects.toThrow(
        'Another operation is already in progress. Please wait.'
      );

      // Verify ONLY ONE network request was initiated
      expect(callCount).toBe(1);

      // Complete the first call
      resolveFirstCall({ success: true });
      const result1 = await promise1;
      expect(result1).toEqual({ success: true });

      // After first call finishes, lock must be released
      expect(useBlockingModalStore.getState().isLocked).toBe(false);

      // Now a new action can run
      const promise6 = runBlockingAction({
        title: 'Action 6 (Subsequent Call)',
        message: 'Processing...',
        apiCall: async () => ({ subsequent: true }),
      });

      const result6 = await promise6;
      expect(result6).toEqual({ subsequent: true });
    });

    it('releases mutex lock when mutation fails with RFC 7807 error', async () => {
      const failingApiCall = async () => {
        throw new ApiError(409, 'Conflict', 'Gate prerequisite failed', 'GATE_PREREQUISITE_FAILED');
      };

      await expect(
        runBlockingAction({
          title: 'Advance Phase',
          message: 'Advancing...',
          apiCall: failingApiCall,
        })
      ).rejects.toThrow();

      // Mutex lock must be released even though error is displayed
      const state = useBlockingModalStore.getState();
      expect(state.status).toBe('error');
      expect(state.isLocked).toBe(false);
      expect(state.error?.code).toBe('GATE_PREREQUISITE_FAILED');
      expect(state.error?.detail).toBe('Gate prerequisite failed');
    });

    it('triggers watchdog abort signal and cancels hanging in-flight request after 30s', async () => {
      vi.useFakeTimers();

      let signalAborted = false;
      const hangingApiCall = (signal: AbortSignal) => {
        signal.addEventListener('abort', () => {
          signalAborted = true;
        });
        return new Promise(() => {}); // Never resolves
      };

      try {
        const actionPromise = runBlockingAction({
          title: 'Hanging Request',
          message: 'Waiting...',
          timeoutMs: 30000,
          apiCall: hangingApiCall,
        });

        // Fast-forward 29.9s -> still in progress
        vi.advanceTimersByTime(29900);
        expect(signalAborted).toBe(false);
        expect(useBlockingModalStore.getState().isLocked).toBe(true);

        // Advance over 30s threshold
        vi.advanceTimersByTime(100);

        await expect(actionPromise).rejects.toSatisfy((err: unknown) => {
          expect(err).toBeInstanceOf(ApiError);
          const apiErr = err as ApiError;
          expect(apiErr.status).toBe(504);
          expect(apiErr.code).toBe('WATCHDOG_TIMEOUT');
          return true;
        });

        expect(signalAborted).toBe(true);
        expect(useBlockingModalStore.getState().isLocked).toBe(false);
        expect(useBlockingModalStore.getState().status).toBe('error');
        expect(useBlockingModalStore.getState().error?.code).toBe('WATCHDOG_TIMEOUT');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ==========================================================================
  // CHALLENGE 2: ZERO OPTIMISTIC UPDATES Stress Testing
  // ==========================================================================
  describe('ZERO OPTIMISTIC UPDATES Doctrine (Cache Untouched During In-Flight)', () => {
    it('work request update: cache remains untouched during mutation in-flight, updates only upon server resolution', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const initialWr = {
        id: 'wr-100',
        title: 'Original Title',
        phase: 'pre_processing',
        status: 'Draft',
        archived: false,
      };

      // Seed query cache with initial server state
      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-100'), initialWr);

      let resolveServerMutation: (val: unknown) => void = () => {};
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((resolve) => {
          resolveServerMutation = (updatedData) => {
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: updatedData }),
            } as Response);
          };
        })
      );

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      // Trigger mutation
      const mutationPromise = result.current.updateWorkRequest({
        id: 'wr-100',
        data: { title: 'Optimistically Spoofed Title' },
      });

      // EMPIRICAL ASSERTION 1: Mutation is in flight
      await waitFor(() => {
        expect(result.current.updateMutation.isPending).toBe(true);
      });

      // EMPIRICAL ASSERTION 2: Cache MUST be 100% byte-identical to original state
      const cacheDuringFlight = queryClient.getQueryData(
        operationsKeys.workRequestDetail('wr-100')
      );
      expect(cacheDuringFlight).toEqual(initialWr);
      expect((cacheDuringFlight as typeof initialWr).title).toBe('Original Title');

      // EMPIRICAL ASSERTION 3: Query is NOT prematurely invalidated during in-flight
      const queryStateDuringFlight = queryClient.getQueryState(
        operationsKeys.workRequestDetail('wr-100')
      );
      expect(queryStateDuringFlight?.isInvalidated).toBe(false);

      // Resolve the server mutation
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      const serverUpdatedWr = {
        ...initialWr,
        title: 'Server Confirmed Title',
      };
      resolveServerMutation(serverUpdatedWr);

      await mutationPromise;

      // EMPIRICAL ASSERTION 4: Query is invalidated ONLY after server response
      const queryStateAfterSettlement = queryClient.getQueryState(
        operationsKeys.workRequestDetail('wr-100')
      );
      expect(queryStateAfterSettlement?.isInvalidated).toBe(true);
    });

    it('task creation: task list cache is untouched during in-flight and unaffected if mutation fails', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const initialTasks = [
        { id: 't-1', title: 'Task 1', phase: 'pre_processing', status: 'Draft' },
        { id: 't-2', title: 'Task 2', phase: 'pre_processing', status: 'Draft' },
      ];

      queryClient.setQueryData(operationsKeys.tasks('wr-100'), initialTasks);

      let rejectServerMutation: (err: unknown) => void = () => {};
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((_resolve, reject) => {
          rejectServerMutation = reject;
        })
      );

      const { result } = renderHook(() => useTaskMutations('wr-100'), { wrapper });

      const mutationPromise = result.current.createTask({
        title: 'Failing New Task',
      });

      // While in-flight: cache contains strictly 2 tasks
      await waitFor(() => {
        expect(result.current.createMutation.isPending).toBe(true);
      });
      const cacheDuringFlight = queryClient.getQueryData(operationsKeys.tasks('wr-100'));
      expect(cacheDuringFlight).toHaveLength(2);
      expect(cacheDuringFlight).toEqual(initialTasks);

      // Wait for fetch to be called before rejecting
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Simulate server rejection (e.g. 400 Bad Request)
      rejectServerMutation(
        new ApiError(400, 'Bad Request', 'Task title invalid', 'VALIDATION_ERROR')
      );

      await expect(mutationPromise).rejects.toThrow();

      // After failure: cache STILL contains original 2 tasks untouched, no ghost entries
      const cacheAfterFailure = queryClient.getQueryData(operationsKeys.tasks('wr-100'));
      expect(cacheAfterFailure).toEqual(initialTasks);
      expect(cacheAfterFailure).toHaveLength(2);
    });

    it('archive work request: archived state is NOT optimistically flipped in cache', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const initialWr = {
        id: 'wr-200',
        title: 'Active Work Request',
        archived: false,
      };

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-200'), initialWr);

      let resolveServer: (data: unknown) => void = () => {};
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((resolve) => {
          resolveServer = (data) =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ data }),
            } as Response);
        })
      );

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      const mutationPromise = result.current.archiveWorkRequest('wr-200');

      // Assert during flight: archived is still false
      const cacheDuringFlight = queryClient.getQueryData(
        operationsKeys.workRequestDetail('wr-200')
      );
      expect((cacheDuringFlight as typeof initialWr).archived).toBe(false);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
      resolveServer({ ...initialWr, archived: true });
      await mutationPromise;

      // Query state invalidated after server settlement
      const queryState = queryClient.getQueryState(operationsKeys.workRequestDetail('wr-200'));
      expect(queryState?.isInvalidated).toBe(true);
    });

    it('phase advancement: phase is NOT optimistically advanced in cache', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const initialWr = {
        id: 'wr-300',
        title: 'Phase Gate Test',
        phase: 'pre_processing',
      };

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-300'), initialWr);

      let rejectServer: (err: unknown) => void = () => {};
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((_resolve, reject) => {
          rejectServer = reject;
        })
      );

      const { result } = renderHook(() => usePhaseTransitions('wr-300'), { wrapper });

      const mutationPromise = result.current.advancePhase('processing');

      // During in-flight: phase remains strictly 'pre_processing'
      const cacheDuringFlight = queryClient.getQueryData(
        operationsKeys.workRequestDetail('wr-300')
      );
      expect((cacheDuringFlight as typeof initialWr).phase).toBe('pre_processing');

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });

      // Server rejects with GATE_PREREQUISITE_FAILED
      rejectServer(
        new ApiError(
          409,
          'Conflict',
          'Advancement gate failed: active tasks incomplete',
          'GATE_PREREQUISITE_FAILED'
        )
      );

      await expect(mutationPromise).rejects.toThrow();

      // Cache still has 'pre_processing'
      const cacheAfterFail = queryClient.getQueryData(
        operationsKeys.workRequestDetail('wr-300')
      );
      expect((cacheAfterFail as typeof initialWr).phase).toBe('pre_processing');
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Invalidation Matrix Adherence Verification
  // ==========================================================================
  describe('Invalidation Matrix Adherence Across All Operations Mutations', () => {
    it('workRequestMutations invalidate exact keys per matrix', async () => {
      const { queryClient, wrapper } = createTestHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Seed unrelated cache
      queryClient.setQueryData(operationsKeys.templates(), [{ id: 'tpl-1' }]);
      queryClient.setQueryData(operationsKeys.documents(), [{ id: 'doc-1' }]);

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: 'wr-1', title: 'Test WR', archived: false } }),
      } as Response);

      const { result } = renderHook(() => useWorkRequestMutations(), { wrapper });

      // 1. Create
      await result.current.createWorkRequest({ dueDate: '2026-12-31', title: 'New WR', entity: 'ATA' });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });

      invalidateSpy.mockClear();

      // 2. Update
      await result.current.updateWorkRequest({ id: 'wr-1', data: { title: 'Updated' } });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });

      invalidateSpy.mockClear();

      // 3. Archive
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

      invalidateSpy.mockClear();

      // 4. Restore
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

      // Verify un-related queries were NEVER invalidated
      expect(queryClient.getQueryState(operationsKeys.templates())?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(operationsKeys.documents())?.isInvalidated).toBe(false);
    });

    it('phaseTransitions and requests invalidate exact keys per matrix', async () => {
      const { queryClient, wrapper } = createTestHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { id: 'req-1', work_request_id: 'wr-1', status: 'pending' },
        }),
      } as Response);

      const { result } = renderHook(() => usePhaseTransitions('wr-1'), { wrapper });

      // 1. requestTransition (Manager submits)
      await result.current.requestTransition({
        from_phase: 'pre_processing',
        to_phase: 'processing',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requestCounts('ATA'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });

      invalidateSpy.mockClear();

      // 2. fulfillRequest (Admin approves)
      await result.current.fulfillRequest('req-1');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requestCounts('ATA'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestCounts('ATA'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.tasks('wr-1'),
      });

      invalidateSpy.mockClear();

      // 3. rejectRequest (Admin rejects with reason)
      await result.current.rejectRequest('req-1', 'Prerequisite tasks incomplete');

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requests(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.requestCounts('ATA'),
      });
    });

    it('documentMutations invalidate documents and parent work request detail', async () => {
      const { queryClient, wrapper } = createTestHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Mock 3-step signed upload
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              document: { id: 'doc-1', workRequestId: 'wr-50' },
              uploadUrl: 'https://storage.test/upload',
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            data: { id: 'doc-1', workRequestId: 'wr-50' },
          }),
        } as Response);

      const { result } = renderHook(() => useDocumentMutations(), { wrapper });

      const testFile = new File(['content'], 'test.pdf', { type: 'application/pdf' });
      await result.current.uploadDocument({
        file: testFile,
        metadata: { workRequestId: 'wr-50' },
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.documents(),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-50'),
      });
    });

    it('submitReroute invalidates workRequestDetail, tasks, and workRequests', async () => {
      const { queryClient, wrapper } = createTestHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: { id: 'wr-qa-1', phase: 'processing', reopenedTaskIds: ['task-1'] },
        }),
      } as Response);

      const { result } = renderHook(() => useQaReview('wr-qa-1'), { wrapper });

      await result.current.submitReroute({
        to_phase: 'processing',
        reason: 'Document signature missing on page 2',
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequestDetail('wr-qa-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.tasks('wr-qa-1'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.workRequests(),
      });
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Verbatim Error Surfacing Under Boundary Conditions
  // ==========================================================================
  describe('Verbatim RFC 7807 Error Code & Detail Surfacing', () => {
    const errorCodes = [
      {
        code: 'TASK_LIMIT_EXCEEDED',
        status: 400,
        detail: 'Delimiter tokenizer exceeded maximum limit: 52 tasks created (maximum is 50)',
      },
      {
        code: 'TASK_PHASE_IMMUTABLE',
        status: 400,
        detail: 'Task phase is immutable once created',
      },
      {
        code: 'INVALID_DEPENDENCY',
        status: 400,
        detail: 'Task depends_on references invalid local id: 0',
      },
      {
        code: 'CIRCULAR_DEPENDENCY',
        status: 400,
        detail: 'Circular dependency detected between tasks t1 -> t2 -> t1',
      },
      {
        code: 'GATE_PREREQUISITE_FAILED',
        status: 409,
        detail: 'Advancement gate failed: 2 active task(s) in phase "pre_processing" are incomplete',
      },
      {
        code: 'PHASE_PREREQUISITE',
        status: 409,
        detail: 'Cannot transition processing task: active pre-processing tasks remain incomplete',
      },
      {
        code: 'INVALID_PHASE_TRANSITION',
        status: 409,
        detail: 'Attempted phase jump skipping intermediate phases is strictly forbidden',
      },
      {
        code: 'DUPLICATE_PERIOD_GENERATION',
        status: 409,
        detail: 'Retainer template has already been generated for period "FY-2026"',
      },
      {
        code: 'CONCURRENCY_CONFLICT',
        status: 409,
        detail: 'Work request was modified by another user (expectedVersion: 2, current: 3)',
      },
    ];

    for (const { code, status, detail } of errorCodes) {
      it(`surfaces RFC 7807 code "${code}" and detail verbatim in blocking action runner`, async () => {
        const errorToThrow = new ApiError(status, 'Error', detail, code);

        await expect(
          runBlockingAction({
            title: `Testing ${code}`,
            message: 'Running...',
            apiCall: async () => {
              throw errorToThrow;
            },
          })
        ).rejects.toThrow();

        const state = useBlockingModalStore.getState();
        expect(state.status).toBe('error');
        expect(state.error?.code).toBe(code);
        expect(state.error?.detail).toBe(detail);
        expect(state.error?.status).toBe(status);
      });
    }
  });
});
