import { operationsViewerRefresh } from './viewerRefresh';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { operationsKeys } from './queryKeys';
import type {
  WorkRequest,
  Phase,
  OperationsRequest,
  OperationsRequestFilters,
  OperationsRequestListResponse,
  OperationsRequestSingleResponse,
  AdvancePhaseTarget,
} from './types';

// ============================================================================
// Queries
// ============================================================================



export function useOperationsRequests(
  filters?: OperationsRequestFilters,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.requestsList(activeEntity, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.type) params.append('type', filters.type);
      if (filters?.workRequestId) params.append('workRequestId', filters.workRequestId);
      if (filters?.clientId) params.append('clientId', filters.clientId);
      if (filters?.linkedTaskId) params.append('linkedTaskId', filters.linkedTaskId);
      if (filters?.requestedBy) params.append('requestedBy', filters.requestedBy);
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.limit) params.append('limit', String(filters.limit));

      const queryStr = params.toString();
      const path = `/operations-requests${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<OperationsRequestListResponse>(path);
      return res;
    },
    enabled: options?.enabled ?? true,
    ...operationsViewerRefresh,
  });
}

export function useOperationsRequestCounts(options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.requestCounts(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<{ data: Record<string, number> }>(
        '/operations-requests/counts'
      );
      return res.data;
    },
    enabled: options?.enabled ?? true,
    ...operationsViewerRefresh,
  });
}

// ============================================================================
// Mutations (Zero Optimistic Updates Doctrine)
// ============================================================================

export interface AdvancePhaseVariables {
  workRequestId?: string;
  to_phase?: AdvancePhaseTarget;
}

export interface RequestTransitionVariables {
  workRequestId?: string;
  from_phase: Phase;
  to_phase: Phase;
  notes?: string;
}

export interface FulfillRequestVariables {
  requestId: string;
  workRequestId?: string;
  notes?: string;
}

export interface RejectRequestVariables {
  requestId: string;
  rejectionReason: string;
  notes?: string;
}

export function usePhaseTransitions(boundWorkRequestId?: string) {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  // 1. Admin Direct Advance (POST /v1/operations/work-requests/:id/advance)
  const advanceMutation = useMutation<WorkRequest, ApiError, AdvancePhaseVariables>({
    mutationFn: async ({ workRequestId = boundWorkRequestId, to_phase }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const res = await apiRequest<{ data: WorkRequest }>(
        `/operations/work-requests/${workRequestId}/advance`,
        {
          method: 'POST',
          body: JSON.stringify({ to_phase }),
        }
      );
      return res.data;
    },
    onSuccess: (updatedWr) => {
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestDetail(updatedWr.id),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.tasks(updatedWr.id),
      });
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  // 2. Manager Submit Transition Request (POST /v1/operations-requests)
  const requestTransitionMutation = useMutation<
    OperationsRequest,
    ApiError,
    RequestTransitionVariables
  >({
    mutationFn: async ({
      workRequestId = boundWorkRequestId,
      from_phase,
      to_phase,
      notes,
    }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const res = await apiRequest<OperationsRequestSingleResponse>(
        '/operations-requests',
        {
          method: 'POST',
          body: JSON.stringify({
            request_type: 'wr_phase_transition',
            work_request_id: workRequestId,
            from_phase,
            to_phase,
            notes,
          }),
        }
      );
      return res.data;
    },
    onSuccess: (_req, variables) => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.requests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.requestCounts(activeEntity),
      });
      const wrId = variables.workRequestId || boundWorkRequestId;
      if (wrId) {
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
      }
    },
  });

  // 3. Admin Fulfill Transition Request (PUT /v1/operations-requests/:id)
  const fulfillMutation = useMutation<
    OperationsRequest,
    ApiError,
    FulfillRequestVariables
  >({
    mutationFn: async ({ requestId, notes }) => {
      const res = await apiRequest<OperationsRequestSingleResponse>(
        `/operations-requests/${requestId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status: 'fulfilled',
            notes,
          }),
        }
      );
      return res.data;
    },
    onSuccess: (_req, variables) => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.requests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.requestCounts(activeEntity),
      });
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
      const wrId = variables.workRequestId || boundWorkRequestId;
      if (wrId) {
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
        queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
      }
    },
  });

  // 4. Admin Reject Transition Request (PUT /v1/operations-requests/:id)
  const rejectMutation = useMutation<
    OperationsRequest,
    ApiError,
    RejectRequestVariables
  >({
    mutationFn: async ({ requestId, rejectionReason, notes }) => {
      if (!rejectionReason || !rejectionReason.trim()) {
        throw new ApiError(
          400,
          'Bad Request',
          'rejectionReason is required when status is rejected',
          'BAD_REQUEST'
        );
      }
      const res = await apiRequest<OperationsRequestSingleResponse>(
        `/operations-requests/${requestId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status: 'rejected',
            rejectionReason: rejectionReason.trim(),
            notes,
          }),
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.requests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.requestCounts(activeEntity),
      });
    },
  });

  // 5. Cancel Transition Request (DELETE /v1/operations-requests/:id)
  const cancelRequestMutation = useMutation<void, ApiError, { requestId: string }>({
    mutationFn: async ({ requestId }) => {
      await apiRequest<void>(`/operations-requests/${requestId}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.requests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.requestCounts(activeEntity),
      });
    },
  });

  return {
    advancePhase: async (arg?: AdvancePhaseTarget | AdvancePhaseVariables) => {
      const payload: AdvancePhaseVariables =
        typeof arg === 'string'
          ? { workRequestId: boundWorkRequestId, to_phase: arg }
          : arg ?? { workRequestId: boundWorkRequestId };
      return advanceMutation.mutateAsync(payload);
    },
    requestTransition: async (arg: RequestTransitionVariables) => {
      const payload: RequestTransitionVariables = {
        workRequestId: boundWorkRequestId,
        ...arg,
      };
      return requestTransitionMutation.mutateAsync(payload);
    },
    fulfillRequest: async (arg: string | FulfillRequestVariables) => {
      const payload: FulfillRequestVariables =
        typeof arg === 'string'
          ? { requestId: arg, workRequestId: boundWorkRequestId }
          : { workRequestId: boundWorkRequestId, ...arg };
      return fulfillMutation.mutateAsync(payload);
    },
    rejectRequest: async (
      arg1: string | RejectRequestVariables,
      rejectionReason?: string,
      notes?: string
    ) => {
      const payload: RejectRequestVariables =
        typeof arg1 === 'string'
          ? { requestId: arg1, rejectionReason: rejectionReason ?? '', notes }
          : arg1;
      return rejectMutation.mutateAsync(payload);
    },
    cancelRequest: async (arg: string | { requestId: string }) => {
      const payload = typeof arg === 'string' ? { requestId: arg } : arg;
      return cancelRequestMutation.mutateAsync(payload);
    },
    advanceMutation,
    requestTransitionMutation,
    fulfillMutation,
    rejectMutation,
    cancelRequestMutation,
    isPending:
      advanceMutation.isPending ||
      requestTransitionMutation.isPending ||
      fulfillMutation.isPending ||
      rejectMutation.isPending ||
      cancelRequestMutation.isPending,
  };
}

export interface CreateOperationsRequestInput {
  type: 'billing' | 'transmittal' | 'disbursement' | 'client' | 'workflow' | 'wr_phase_transition';
  workRequestId?: string;
  clientId?: string;
  linkedTaskId?: string;
  notes?: string;
  amount?: number;
}

export function useCreateOperationsRequest() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useMutation<OperationsRequest, ApiError, CreateOperationsRequestInput>({
    mutationFn: async (variables) => {
      const res = await apiRequest<OperationsRequestSingleResponse>(
        '/operations-requests',
        {
          method: 'POST',
          body: JSON.stringify({
            request_type: variables.type,
            type: variables.type,
            work_request_id: variables.workRequestId,
            workRequestId: variables.workRequestId,
            client_id: variables.clientId,
            clientId: variables.clientId,
            linked_task_id: variables.linkedTaskId,
            linkedTaskId: variables.linkedTaskId,
            notes: variables.notes,
            amount: variables.amount,
          }),
        }
      );
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.requests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.requestCounts(activeEntity),
      });
      if (variables.workRequestId) {
        queryClient.invalidateQueries({
          queryKey: operationsKeys.workRequestDetail(variables.workRequestId),
        });
      }
    },
  });
}

