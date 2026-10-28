import { operationsViewerRefresh } from './viewerRefresh';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError, queryClient, getScopeGeneration } from '@/lib/api';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
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
  WorkRequestCreationApprovalsParams,
  WorkRequestCreationApprovalInput,
  ResubmitWorkRequestCreationInput,
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
    placeholderData: (previous, query) => query?.queryKey?.[3] === activeEntity ? previous : undefined,
    enabled: options?.enabled ?? true,
    ...operationsViewerRefresh,
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
    ...operationsViewerRefresh,
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

export function useWorkRequestCreationApprovals(
  params?: WorkRequestCreationApprovalsParams,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: operationsKeys.workRequestCreationApprovals(params?.status, params?.scope),
    queryFn: async ({ signal }) => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.append('status', params.status);
      if (params?.scope) searchParams.append('scope', params.scope);
      const queryStr = searchParams.toString();
      const res = await apiRequest<{ data: WorkRequest[]; meta?: unknown }>(
        `/operations/work-requests/creation-approvals${queryStr ? `?${queryStr}` : ''}`,
        { signal }
      );
      return res.data;
    },
    enabled: options?.enabled ?? true,
    ...operationsViewerRefresh,
  });
}

/** Counts the same authorized pending creations shown by the inbox. */
export function usePendingWorkRequestCreationCount(options?: { enabled?: boolean }) {
  const role = useSessionStore((state) => state.user?.role);
  const eligible = role === 'Admin' || role === 'Manager';
  const query = useWorkRequestCreationApprovals(
    { status: 'pending', scope: role === 'Admin' ? 'all' : 'mine' },
    { enabled: eligible && (options?.enabled ?? true) }
  );
  const denied = [401, 403, 404].includes((query.error as ApiError | null)?.status ?? 0);
  return eligible && !denied ? query.data?.length ?? 0 : 0;
}

export function useWorkRequestCounts(options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.workRequestCounts(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<WorkRequestCountsResponse>('/operations/counts');
      return res.data;
    },
    enabled: options?.enabled ?? true,
    ...operationsViewerRefresh,
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
    ...operationsViewerRefresh,
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
    { snapshots: QuerySnapshot; prevTargetWr?: WorkRequest; scopeGeneration: number }
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
      const scopeGeneration = getScopeGeneration();

      // Cancel active workRequest queries so in-flight requests don't overwrite optimistic data
      await queryClient.cancelQueries({ queryKey: operationsKeys.workRequests() });

      // Recheck scope generation after await cancelQueries before writing to optimistic cache
      if (scopeGeneration !== getScopeGeneration()) {
        throw new ApiError(499, 'Action cancelled: account or entity changed.');
      }

      // Snapshot every operations/workRequests cache before mutating
      const snapshots = queryClient.getQueriesData<unknown>({
        queryKey: operationsKeys.workRequests(),
      }) as QuerySnapshot;

      // Detail cache: store or update the bare WorkRequest
      const detailKey = operationsKeys.workRequestDetail(id);
      let prevTargetWr = queryClient.getQueryData<WorkRequest>(detailKey);
      if (prevTargetWr) {
        queryClient.setQueryData<WorkRequest>(detailKey, { ...prevTargetWr, status });
      } else {
        // Seed detail cache from list snapshots if not yet populated
        for (const [, value] of snapshots) {
          const list = value as WorkRequestListResponse | undefined;
          const hit = list?.data?.find((wr) => wr.id === id);
          if (hit) {
            prevTargetWr = hit;
            queryClient.setQueryData<WorkRequest>(detailKey, { ...hit, status });
            break;
          }
        }
      }

      // List caches: rewrite ONLY the target item in place
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

      return { snapshots, prevTargetWr, scopeGeneration };
    },
    onSuccess: (serverWr, { id }, context) => {
      if (context?.scopeGeneration !== undefined && context.scopeGeneration !== getScopeGeneration()) {
        return;
      }
      if (!serverWr) return;

      // 1. Immediately pin confirmed server truth into detail cache IF not older than cached version
      const detailKey = operationsKeys.workRequestDetail(id);
      const currentDetail = queryClient.getQueryData<WorkRequest>(detailKey);
      if (
        currentDetail &&
        typeof currentDetail.version === 'number' &&
        typeof serverWr.version === 'number' &&
        currentDetail.version > serverWr.version
      ) {
        // Never pin older success response over higher-version cache
        return;
      }
      queryClient.setQueryData<WorkRequest>(detailKey, serverWr);

      // 2. Immediately pin confirmed server truth into list caches IF not older
      const allListQueries = queryClient.getQueriesData<WorkRequestListResponse>({
        queryKey: operationsKeys.workRequests(),
      });
      for (const [key, value] of allListQueries) {
        if (value && typeof value === 'object' && Array.isArray(value.data)) {
          if (value.data.some((wr) => wr.id === id)) {
            queryClient.setQueryData(key, {
              ...value,
              data: value.data.map((wr) => {
                if (wr.id !== id) return wr;
                if (
                  typeof wr.version === 'number' &&
                  typeof serverWr.version === 'number' &&
                  wr.version > serverWr.version
                ) {
                  return wr;
                }
                return { ...wr, ...serverWr };
              }),
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
    onError: (err, variables, context) => {
      if (context?.scopeGeneration !== undefined && context.scopeGeneration !== getScopeGeneration()) {
        return;
      }

      const id = variables.id;
      const prevTargetWr = context?.prevTargetWr;
      const originalVersion = prevTargetWr?.version;

      // Target detail cache: restore ONLY if current cached item is not higher version
      const detailKey = operationsKeys.workRequestDetail(id);
      const currentDetail = queryClient.getQueryData<WorkRequest>(detailKey);
      if (currentDetail && prevTargetWr) {
        if (
          currentDetail.status === variables.status &&
          (currentDetail.version ?? 0) <= (originalVersion ?? 0)
        ) {
          queryClient.setQueryData(detailKey, prevTargetWr);
        }
      }

      // List caches: restore ONLY the target record; NEVER whole-snapshot restore over newer server state!
      if (prevTargetWr) {
        const allListQueries = queryClient.getQueriesData<WorkRequestListResponse>({
          queryKey: operationsKeys.workRequests(),
        });
        for (const [key, value] of allListQueries) {
          if (value && typeof value === 'object' && Array.isArray(value.data)) {
            if (value.data.some((wr) => wr.id === id)) {
              queryClient.setQueryData(key, {
                ...value,
                data: value.data.map((wr) => {
                  if (wr.id !== id) return wr; // preserve all unrelated rows!
                  if (
                    wr.status !== variables.status ||
                    (wr.version ?? 0) > (originalVersion ?? 0)
                  ) {
                    return wr; // preserve winning higher version!
                  }
                  return prevTargetWr;
                }),
              });
            }
          }
        }
      }

      // WR status 409 must invalidate/refetch WR detail/list too (not just tasks/counts)
      if (isConcurrencyConflictError(err) || (err instanceof ApiError && err.status === 409)) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(id) });
        void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
        void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
        void queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(id) });
      }
    },
    onSettled: (_data, _err, { id }, context) => {
      if (context?.scopeGeneration !== undefined && context.scopeGeneration !== getScopeGeneration()) {
        return;
      }
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

  // 7. Creation Approval (Admin decision)
  const creationApprovalMutation = useMutation<
    WorkRequest,
    ApiError,
    { id: string } & WorkRequestCreationApprovalInput
  >({
    mutationFn: async ({ id, decision, reason, expectedVersion }) => {
      const res = await apiRequest<{ data: WorkRequest }>(
        `/operations/work-requests/${id}/creation-approval`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, reason, expectedVersion }),
        }
      );
      return res.data;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCreationApprovals(),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestDetail(updated.id),
      });
    },
    onError: (err, variables) => {
      if (isConcurrencyConflictError(err)) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
        void queryClient.invalidateQueries({
          queryKey: operationsKeys.workRequestCounts(activeEntity),
        });
        void queryClient.invalidateQueries({
          queryKey: operationsKeys.workRequestCreationApprovals(),
        });
        void queryClient.invalidateQueries({
          queryKey: operationsKeys.workRequestDetail(variables.id),
        });
      }
    },
  });

  // 8. Resubmit Creation (Manager correction after rejection)
  const resubmitCreationMutation = useMutation<
    WorkRequest,
    ApiError,
    { id: string } & ResubmitWorkRequestCreationInput
  >({
    mutationFn: async ({ id, expectedVersion, data }) => {
      const res = await apiRequest<{ data: WorkRequest }>(
        `/operations/work-requests/${id}/resubmit-creation`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedVersion, data }),
        }
      );
      return res.data;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCreationApprovals(),
      });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestDetail(updated.id),
      });
    },
    onError: (err, variables) => {
      if (isConcurrencyConflictError(err)) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
        void queryClient.invalidateQueries({
          queryKey: operationsKeys.workRequestCounts(activeEntity),
        });
        void queryClient.invalidateQueries({
          queryKey: operationsKeys.workRequestCreationApprovals(),
        });
        void queryClient.invalidateQueries({
          queryKey: operationsKeys.workRequestDetail(variables.id),
        });
      }
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
    approveOrRejectCreation: creationApprovalMutation.mutateAsync,
    resubmitCreation: resubmitCreationMutation.mutateAsync,
    statusOptimistic: statusOptimisticMutation.mutateAsync,
    isStatusOptimisticPending: statusOptimisticMutation.isPending,
    createMutation,
    updateMutation,
    archiveMutation,
    restoreMutation,
    cancelMutation,
    creationApprovalMutation,
    resubmitCreationMutation,
    isPending:
      createMutation.isPending ||
      updateMutation.isPending ||
      archiveMutation.isPending ||
      restoreMutation.isPending ||
      cancelMutation.isPending ||
      creationApprovalMutation.isPending ||
      resubmitCreationMutation.isPending,
  };
}
