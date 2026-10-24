import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiRequest, ApiError, queryClient } from '@/lib/api';
import { isFeatureEnabled } from '@/lib/flags';
import { broadcastEntityChange } from '@/lib/tabSync';
import { useSessionStore } from '@/lib/session';
import { operationsKeys } from './queryKeys';
import type {
  WorkRequest,
  WorkRequestStatus,
  WorkRequestFilters,
  CreateWorkRequestInput,
  UpdateWorkRequestInput,
  WorkRequestListResponse,
  WorkRequestDetailResponse,
  WorkRequestCountsResponse,
  WorkRequestRelatedResponse,
} from './types';

type QuerySnapshot = Array<[readonly unknown[], unknown]>;

// ============================================================================
// Queries
// ============================================================================

export function useWorkRequests(
  filters?: WorkRequestFilters,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.workRequestsList(activeEntity, filters),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (filters?.search) params.append('search', filters.search);
      if (filters?.status) params.append('status', filters.status);
      if (filters?.phase) params.append('phase', filters.phase);
      if (filters?.clientId) params.append('clientId', filters.clientId);
      if (filters?.assigneeId) params.append('assigneeId', filters.assigneeId);
      if (filters?.priority) params.append('priority', filters.priority);
      if (filters?.archived !== undefined) params.append('archived', String(filters.archived));
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.limit) params.append('limit', String(filters.limit));
      if (filters?.sortBy) params.append('sortBy', filters.sortBy);
      if (filters?.sortOrder) params.append('sortOrder', filters.sortOrder);
      if (filters?.includeTasks) params.append('includeTasks', String(filters.includeTasks));

      const queryStr = params.toString();
      const path = `/operations/work-requests${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<WorkRequestListResponse>(path, { signal });
      return res;
    },
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

/** Alias to satisfy contract citation */
export const useWorkRequestList = useWorkRequests;

export function useWorkRequestDetail(
  id: string | undefined,
  options?: { enabled?: boolean }
) {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.workRequestDetail(id ?? ''),
    queryFn: async ({ signal }): Promise<WorkRequest> => {
      if (!id) throw new Error('Work request ID is required');
      const res = await apiRequest<WorkRequestDetailResponse>(
        `/operations/work-requests/${id}`,
        { signal }
      );
      return res.data;
    },
    enabled: Boolean(id) && (options?.enabled ?? true),
    // Instant feel: render the side peek from the matching list row (already
    // fetched) while the detail fetch completes. Scoped to active entity.
    placeholderData: (_prev): WorkRequest | undefined => {
      if (!id) return undefined;
      for (const [, list] of queryClient.getQueriesData<WorkRequestListResponse>({
        queryKey: operationsKeys.workRequestsList(activeEntity),
      })) {
        const hit = list?.data?.find((wr) => wr.id === id);
        if (hit) return hit;
      }
      return undefined;
    },
  });
}

/**
 * Pre-warm the detail cache on row hover/focus so opening the side peek is
 * instant even before the placeholder paint completes.
 */
export function prefetchWorkRequestDetail(id: string): void {
  void queryClient.prefetchQuery({
    queryKey: operationsKeys.workRequestDetail(id),
    queryFn: async () => {
      const res = await apiRequest<WorkRequestDetailResponse>(
        `/operations/work-requests/${id}`
      );
      return res.data;
    },
    staleTime: 30 * 1000,
  });
}

export function useWorkRequestCounts() {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.workRequestCounts(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<WorkRequestCountsResponse>('/operations/counts');
      return res.data;
    },
  });
}

export function useWorkRequestRelated(
  id: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: operationsKeys.workRequestRelated(id ?? ''),
    queryFn: async ({ signal }) => {
      if (!id) throw new Error('Work request ID is required');
      const res = await apiRequest<WorkRequestRelatedResponse>(
        `/operations/work-requests/${id}/related`,
        { signal }
      );
      return res.data;
    },
    enabled: Boolean(id) && (options?.enabled ?? true),
  });
}

// ============================================================================
// Mutations (Zero Optimistic Updates Doctrine — sole sanctioned exception:
// the admin WR status transition, mutation #3 below, is optimistic-with-
// rollback per product request for instant feedback)
// ============================================================================

export function useWorkRequestMutations() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  // 1. Create Work Request (Single-transaction atomic graph)
  const createMutation = useMutation<WorkRequest, ApiError, CreateWorkRequestInput>({
    mutationFn: async (input) => {
      const res = await apiRequest<WorkRequestDetailResponse>(
        '/operations/work-requests',
        {
          method: 'POST',
          body: JSON.stringify(input),
        }
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  // 2. Update Work Request
  const updateMutation = useMutation<
    WorkRequest,
    ApiError,
    { id: string; data: UpdateWorkRequestInput; entity?: string }
  >({
    mutationFn: async ({ id, data, entity }) => {
      const headers: Record<string, string> = {};
      const targetEntity = entity || data.entity;
      if (targetEntity) {
        headers['X-Active-Entity'] = targetEntity;
      }
      const res = await apiRequest<WorkRequestDetailResponse>(
        `/operations/work-requests/${id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestDetail(updated.id),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.tasks(updated.id),
      });
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  // 3. Admin Status Transition — OPTIMISTIC (single sanctioned exception to the
  // zero-optimistic doctrine, per product request). The status badge and all
  // open lists/boards flip instantly; the server call runs underneath. On
  // 3. Admin Status Transition — OPTIMISTIC:
  // The status flips immediately on click across both detail and list caches.
  // On success, confirmed server truth is pinned directly into the caches so
  // background refetches cannot revert the status. On failure, snapshots
  // rollback and the error re-throws.
  const statusOptimisticMutation = useMutation<
    WorkRequest,
    ApiError,
    { id: string; status: WorkRequestStatus; entity?: string; expectedVersion?: number },
    { snapshots: QuerySnapshot }
  >({
    mutationFn: async ({ id, status, entity, expectedVersion }) => {
      const headers: Record<string, string> = {};
      if (entity && entity !== 'ALL') headers['X-Active-Entity'] = entity;

      const bodyPayload: Record<string, unknown> = {
        status,
        ...(entity && entity !== 'ALL' ? { entity } : {}),
      };

      if (isFeatureEnabled('strict_occ') && typeof expectedVersion === 'number') {
        bodyPayload.expectedVersion = expectedVersion;
      }

      const res = await apiRequest<WorkRequestDetailResponse>(
        `/operations/work-requests/${id}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify(bodyPayload),
        }
      );
      return res.data;
    },
    onMutate: async ({ id, status }) => {
      // Cancel active workRequest queries so in-flight requests don't overwrite optimistic data
      await queryClient.cancelQueries({ queryKey: operationsKeys.workRequests() });

      // Snapshot every operations/workRequests cache before mutating
      const snapshots = queryClient.getQueriesData<unknown>({
        queryKey: operationsKeys.workRequests(),
      }) as QuerySnapshot;

      // Detail cache: store or update the bare WorkRequest
      const detailKey = operationsKeys.workRequestDetail(id);
      const prevDetail = queryClient.getQueryData<WorkRequest>(detailKey);
      if (prevDetail) {
        queryClient.setQueryData<WorkRequest>(detailKey, { ...prevDetail, status });
      } else {
        // Seed detail cache from list snapshots if not yet populated
        for (const [, value] of snapshots) {
          const list = value as WorkRequestListResponse | undefined;
          const hit = list?.data?.find((wr) => wr.id === id);
          if (hit) {
            queryClient.setQueryData<WorkRequest>(detailKey, { ...hit, status });
            break;
          }
        }
      }

      // List caches: rewrite the item in place
      for (const [key, value] of snapshots) {
        const list = value as WorkRequestListResponse | undefined;
        if (list && typeof list === 'object' && Array.isArray(list.data)) {
          if (list.data.some((wr) => wr.id === id)) {
            queryClient.setQueryData(key, {
              ...list,
              data: list.data.map((wr) => (wr.id === id ? { ...wr, status } : wr)),
            });
          }
        }
      }

      return { snapshots };
    },
    onSuccess: (serverWr, { id }) => {
      if (!serverWr) return;
      // 1. Immediately pin confirmed server truth into the detail cache
      const detailKey = operationsKeys.workRequestDetail(id);
      queryClient.setQueryData<WorkRequest>(detailKey, serverWr);

      // 2. Immediately pin confirmed server truth into all list caches
      const allListQueries = queryClient.getQueriesData<WorkRequestListResponse>({
        queryKey: operationsKeys.workRequests(),
      });
      for (const [key, value] of allListQueries) {
        if (value && typeof value === 'object' && Array.isArray(value.data)) {
          if (value.data.some((wr) => wr.id === id)) {
            queryClient.setQueryData(key, {
              ...value,
              data: value.data.map((wr) => (wr.id === id ? { ...wr, ...serverWr } : wr)),
            });
          }
        }
      }

      // 3. Cross-Tab Synchronization
      broadcastEntityChange({
        domain: 'operations',
        entityId: serverWr.id,
        entityData: serverWr,
      });
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
    },
    onSettled: (_data, _err, { id }) => {
      // Reconcile secondary counters and tasks without blasting the confirmed detail cache
      queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(id) });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  // 4. Archive Work Request (Blocking flow)
  const archiveMutation = useMutation<WorkRequest, ApiError, { id: string; entity?: string }>({
    mutationFn: async ({ id, entity }) => {
      const headers: Record<string, string> = {};
      if (entity) headers['X-Active-Entity'] = entity;
      const res = await apiRequest<WorkRequestDetailResponse>(
        `/operations/work-requests/${id}/archive`,
        {
          method: 'POST',
          headers,
        }
      );
      return res.data;
    },
    onSuccess: (archived) => {
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestDetail(archived.id),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.tasks(archived.id),
      });
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  // 4. Restore / Unarchive Work Request (Blocking flow)
  const restoreMutation = useMutation<WorkRequest, ApiError, { id: string; entity?: string }>({
    mutationFn: async ({ id, entity }) => {
      const headers: Record<string, string> = {};
      if (entity) headers['X-Active-Entity'] = entity;
      const res = await apiRequest<WorkRequestDetailResponse>(
        `/operations/work-requests/${id}/unarchive`,
        {
          method: 'POST',
          headers,
        }
      );
      return res.data;
    },
    onSuccess: (restored) => {
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestDetail(restored.id),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.tasks(restored.id),
      });
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  // 5. Cancel / Delete Work Request
  const cancelMutation = useMutation<void, ApiError, { id: string; entity?: string }>({
    mutationFn: async ({ id, entity }) => {
      const headers: Record<string, string> = {};
      if (entity) headers['X-Active-Entity'] = entity;
      await apiRequest<void>(`/operations/work-requests/${id}`, {
        method: 'DELETE',
        headers,
      });
    },
    onSuccess: (_res, { id }) => {
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestDetail(id),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.tasks(id),
      });
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  return {
    createWorkRequest: createMutation.mutateAsync,
    updateWorkRequest: async (
      arg1: string | { id: string; data: UpdateWorkRequestInput; entity?: string },
      arg2?: UpdateWorkRequestInput
    ) => {
      const payload =
        typeof arg1 === 'string'
          ? { id: arg1, data: arg2! }
          : arg1;
      return updateMutation.mutateAsync(payload);
    },
    archiveWorkRequest: async (arg: string | { id: string; entity?: string }) => {
      const payload = typeof arg === 'string' ? { id: arg } : arg;
      return archiveMutation.mutateAsync(payload);
    },
    restoreWorkRequest: async (arg: string | { id: string; entity?: string }) => {
      const payload = typeof arg === 'string' ? { id: arg } : arg;
      return restoreMutation.mutateAsync(payload);
    },
    cancelWorkRequest: async (arg: string | { id: string; entity?: string }) => {
      const payload = typeof arg === 'string' ? { id: arg } : arg;
      return cancelMutation.mutateAsync(payload);
    },
    statusOptimistic: statusOptimisticMutation.mutateAsync,
    isStatusOptimisticPending: statusOptimisticMutation.isPending,
    createMutation,
    updateMutation,
    archiveMutation,
    restoreMutation,
    cancelMutation,
    isPending:
      createMutation.isPending ||
      updateMutation.isPending ||
      archiveMutation.isPending ||
      restoreMutation.isPending ||
      cancelMutation.isPending,
  };
}
