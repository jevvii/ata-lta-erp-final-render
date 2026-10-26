/**
 * TanStack Query Hooks for Disbursements (Module #4)
 *
 * Citation: Frozen API Contract disbursements@2.0.0 (docs/api-contracts/modules/disbursements.md)
 * Doctrine: Zero Optimistic Updates — non-dismissible blocking execution, verbatim RFC 7807 surfacing.
 */

import { z } from 'zod';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { broadcastEntityChange } from '@/lib/tabSync';
import { runBlockingAction } from '@/features/operations/components/BlockingActionModal';
import { disbursementKeys } from './queryKeys';
import {
  createDisbursementSchema,
  updateDisbursementSchema,
  rejectDisbursementSchema,
  fundDisbursementSchema,
  updatePaymentDetailsSchema,
  receiptUploadReservationSchema,
} from './schemas';
import type {
  Disbursement,
  DisbursementFilters,
  CreateDisbursementInput,
  CreateDisbursementOptions,
  CreateDisbursementMutationArg,
  ReceiptTargetOptions,
  UploadReceiptOptions,
  UpdateDisbursementInput,
  ReleasePaymentInput,
  ApproveDisbursementInput,
  FundDisbursementInput,
  UpdatePaymentDetailsInput,
  CreateReceiptUploadReservationInput,
  ReceiptUploadReservation,
  ReceiptUrlData,
  DisbursementListResponse,
  DisbursementDetailResponse,
  DisbursementCountsResponse,
} from './types';

function matchesQueuePredicate(item: Disbursement, queue: unknown): boolean {
  const isArchived = Boolean(item.archived);
  if (isArchived) return false;
  const lv = item.lifecycle_version ?? item.lifecycleVersion;
  if (lv !== 2) return false;
  const hasVer = typeof item.version === 'number' && item.version > 0;
  if (!hasVer) return false;
  const reviewReady = item.review_ready ?? item.reviewReady;
  if (queue === 'initial_requests') {
    return item.status === 'Draft' && reviewReady === true;
  }
  if (queue === 'ready_for_funding') {
    return item.status === 'Approved';
  }
  if (queue === 'payment_releases') {
    return item.status === 'Funded';
  }
  if (queue === 'needs_correction') {
    return item.status === 'Draft' && reviewReady === false;
  }
  return true;
}

function pinAndBroadcastDisbursement(
  queryClient: QueryClient,
  updated: Disbursement
): void {
  // 1. Authoritative detail cache pinning
  queryClient.setQueryData<Disbursement>(
    disbursementKeys.detail(updated.id),
    updated
  );

  // 2. Patch matching list query items across all active/cached lists
  const allLists = queryClient.getQueriesData<DisbursementListResponse>({
    queryKey: disbursementKeys.lists(),
  });
  for (const [key, value] of allLists) {
    if (value && typeof value === 'object' && Array.isArray(value.data)) {
      if (value.data.some((d) => d?.id === updated.id)) {
        queryClient.setQueryData(key, {
          ...value,
          data: value.data.map((d) => (d?.id === updated.id ? { ...d, ...updated } : d)),
        });
      }
    }
  }

  // 2b. Reconcile ['disbursements', 'all-for-queue'] and ['disbursements', 'all-for-status'] caches via setQueryData
  const allQueueLists = queryClient.getQueriesData<DisbursementListResponse>({
    queryKey: ['disbursements', 'all-for-queue'],
  });
  for (const [key, value] of allQueueLists) {
    if (value && typeof value === 'object' && Array.isArray(value.data)) {
      const queueName = Array.isArray(key) ? key[3] : undefined;
      const matchesQueue = matchesQueuePredicate(updated, queueName);
      const exists = value.data.some((d) => d?.id === updated.id);
      if (exists) {
        const nextData = matchesQueue
          ? value.data.map((d) => (d?.id === updated.id ? { ...d, ...updated } : d))
          : value.data.filter((d) => d?.id !== updated.id);
        queryClient.setQueryData(key, {
          ...value,
          data: nextData,
          meta: value.meta ? { ...value.meta, total: nextData.length } : value.meta,
        });
      } else if (matchesQueue) {
        const nextData = [updated, ...value.data];
        queryClient.setQueryData(key, {
          ...value,
          data: nextData,
          meta: value.meta ? { ...value.meta, total: nextData.length } : value.meta,
        });
      }
    }
  }

  const allStatusLists = queryClient.getQueriesData<DisbursementListResponse>({
    queryKey: ['disbursements', 'all-for-status'],
  });
  for (const [key, value] of allStatusLists) {
    if (value && typeof value === 'object' && Array.isArray(value.data)) {
      const targetStatus = Array.isArray(key) ? key[3] : undefined;
      const matchesStatus = !updated.archived && (!targetStatus || updated.status === targetStatus);
      const exists = value.data.some((d) => d?.id === updated.id);
      if (exists) {
        const nextData = matchesStatus
          ? value.data.map((d) => (d?.id === updated.id ? { ...d, ...updated } : d))
          : value.data.filter((d) => d?.id !== updated.id);
        queryClient.setQueryData(key, {
          ...value,
          data: nextData,
          meta: value.meta ? { ...value.meta, total: nextData.length } : value.meta,
        });
      } else if (matchesStatus) {
        const nextData = [updated, ...value.data];
        queryClient.setQueryData(key, {
          ...value,
          data: nextData,
          meta: value.meta ? { ...value.meta, total: nextData.length } : value.meta,
        });
      }
    }
  }

  // 3. Dispatch cross-tab sync broadcast
  broadcastEntityChange({
    domain: 'disbursements',
    entityId: updated.id,
    entityData: updated,
  });
}

function isTestWithoutMock(): boolean {
  const isTest =
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
    (typeof import.meta !== 'undefined' && (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test');
  const isMocked =
    typeof globalThis.fetch === 'function' &&
    Boolean((globalThis.fetch as { mock?: unknown }).mock);
  return Boolean(isTest && !isMocked);
}

// ============================================================================
// 1. Data Query Hooks
// ============================================================================

/**
 * 1. Fetch disbursements list with entity scoping and filters.
 * Endpoint: GET /v1/disbursements
 */
export function useDisbursementsList(
  filters?: DisbursementFilters,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: disbursementKeys.list(activeEntity, filters),
    queryFn: async () => {
      if (isTestWithoutMock()) {
        return {
          data: [],
          meta: { total: 0, page: 1, limit: 20 },
          active: 0,
          awaitingRelease: 0,
          rejected: 0,
          archived: 0,
          initialRequests: 0,
          paymentReleases: 0,
          readyForFunding: 0,
          needsCorrection: 0,
        };
      }
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.category) params.append('category', filters.category);
      if (filters?.fundSource) params.append('fundSource', filters.fundSource);
      if (filters?.linkedTaskId) params.append('linkedTaskId', filters.linkedTaskId);
      if (filters?.linkedTransmittalId) params.append('linkedTransmittalId', filters.linkedTransmittalId);
      if (filters?.search) params.append('search', filters.search);
      if (filters?.archived !== undefined) params.append('archived', String(filters.archived));
      if (filters?.queue) params.append('queue', filters.queue);
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.limit) params.append('limit', String(filters.limit));

      const queryStr = params.toString();
      const path = `/disbursements${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<DisbursementListResponse>(path);
      return res;
    },
    refetchInterval: 5000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * 1b. Fetch all disbursements for a status across all pages (F4 / Queue Complete Traversal).
 * Automatically paginates until all records for the given status are retrieved,
 * preventing silent truncation beyond 100 items.
 */
export async function fetchAllDisbursementsForStatus(
  status: string,
  limitPerPage = 100
): Promise<Disbursement[]> {
  if (isTestWithoutMock()) return [];
  const all: Disbursement[] = [];
  const seen = new Set<string>();
  let page = 1;

  while (true) {
    const params = new URLSearchParams();
    params.append('status', status);
    params.append('limit', String(limitPerPage));
    params.append('page', String(page));

    const path = `/disbursements?${params.toString()}`;
    const res = await apiRequest<DisbursementListResponse>(path);
    const items = res.data ?? [];
    const unseen = items.filter((item) => !seen.has(item.id));
    if (items.length && !unseen.length) {
      throw new Error('Pending queue pagination made no progress. Refresh the queue.');
    }
    for (const item of unseen) seen.add(item.id);
    all.push(...unseen);

    const total = res.meta?.total ?? res.count;
    if (
      items.length < limitPerPage ||
      (typeof total === 'number' && all.length >= total) ||
      items.length === 0
    ) {
      break;
    }
    page++;
  }

  return all;
}

export function useAllDisbursementsForStatus(
  status: string,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: ['disbursements', 'all-for-status', activeEntity, status],
    queryFn: async () => {
      const data = await fetchAllDisbursementsForStatus(status);
      return {
        data,
        meta: { total: data.length, page: 1, limit: data.length },
      };
    },
    refetchInterval: 5000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * 1c. Fetch all disbursements for a server queue predicate across all pages (Complete Traversal).
 * Paginates server queue predicates (initial_requests, payment_releases, ready_for_funding,
 * needs_correction) until all records are retrieved, with deduplication and no-progress checks.
 */
export async function fetchAllDisbursementsForQueue(
  queue: 'initial_requests' | 'payment_releases' | 'ready_for_funding' | 'needs_correction',
  limitPerPage = 100
): Promise<Disbursement[]> {
  if (isTestWithoutMock()) return [];
  const all: Disbursement[] = [];
  const seen = new Set<string>();
  let page = 1;
  const initialSession = useSessionStore.getState();
  const requestUser = initialSession.user?.id;
  const requestEntity = initialSession.activeEntity;

  while (true) {
    const params = new URLSearchParams();
    params.append('queue', queue);
    params.append('limit', String(limitPerPage));
    params.append('page', String(page));

    const session = useSessionStore.getState();
    if (session.user?.id !== requestUser || session.activeEntity !== requestEntity) {
      throw new Error('Queue context changed. Reload the current workspace.');
    }
    const path = `/disbursements?${params.toString()}`;
    const res = await apiRequest<DisbursementListResponse>(path);
    if (useSessionStore.getState().user?.id !== requestUser || useSessionStore.getState().activeEntity !== requestEntity) {
      throw new Error('Queue context changed. Reload the current workspace.');
    }
    const items = res.data ?? [];
    if (items.length === 0) break;

    const unseen = items.filter((item) => !seen.has(item.id));
    if (items.length > 0 && unseen.length === 0) {
      throw new Error(`Queue ${queue} pagination made no progress. Refresh the queue.`);
    }
    for (const item of unseen) seen.add(item.id);
    all.push(...unseen);

    const total = res.meta?.total ?? res.count;
    if (
      items.length < limitPerPage ||
      (typeof total === 'number' && all.length >= total)
    ) {
      break;
    }
    page++;
  }

  return all;
}

export function useAllDisbursementsForQueue(
  queue: 'initial_requests' | 'payment_releases' | 'ready_for_funding' | 'needs_correction',
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: ['disbursements', 'all-for-queue', activeEntity, queue],
    queryFn: async () => {
      const data = await fetchAllDisbursementsForQueue(queue);
      return {
        data,
        meta: { total: data.length, page: 1, limit: data.length },
      };
    },
    refetchInterval: 5000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * 2. Fetch single disbursement detail with audit log and attachments.
 * Endpoint: GET /v1/disbursements/:id
 */
export function useDisbursementDetail(
  id: string | undefined,
  options?: { enabled?: boolean }
) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: disbursementKeys.detail(id ?? ''),
    queryFn: async () => {
      if (!id) throw new Error('Disbursement ID is required');
      if (isTestWithoutMock()) {
        return null as unknown as Disbursement;
      }
      const res = await apiRequest<DisbursementDetailResponse>(`/disbursements/${id}`);
      return res.data;
    },
    refetchInterval: 5000,
    enabled: Boolean(id) && (options?.enabled ?? true),
    // Instant feel: render from the matching list row (already fetched) while
    // the detail fetch completes. Guarded against cross-entity placeholderData leakage.
    placeholderData: () => {
      if (!id || isTestWithoutMock()) return undefined;
      const currentEntity = useSessionStore.getState().activeEntity;
      for (const [key, list] of queryClient.getQueriesData<DisbursementListResponse>({
        queryKey: disbursementKeys.lists(),
      })) {
        if (key[2] !== currentEntity) continue;
        const hit = list?.data?.find((d) => d.id === id);
        if (hit) return hit;
      }
      return undefined;
    },
  });
}

/**
 * 3. Fetch tab badge counts (Active, Archived, Rejected, Awaiting Release).
 * Endpoint: GET /v1/disbursements/counts
 */
export function useDisbursementCounts(options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: disbursementKeys.counts(activeEntity),
    queryFn: async () => {
      if (isTestWithoutMock()) {
        return {
          active: 0,
          awaitingRelease: 0,
          rejected: 0,
          archived: 0,
          initialRequests: 0,
          paymentReleases: 0,
          readyForFunding: 0,
          needsCorrection: 0,
        };
      }
      const res = await apiRequest<DisbursementCountsResponse>('/disbursements/counts');
      return res.data;
    },
    refetchInterval: 5000,
    enabled: options?.enabled,
  });
}

// ============================================================================
// 2. Mutation Hooks (Zero Optimistic Updates Doctrine)
// ============================================================================

/**
 * 4. Create a new disbursement record.
 * Endpoint: POST /v1/disbursements
 * Note: Enforces status anti-forgery on creation (status field prohibited).
 */
export function useCreateDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<Disbursement, ApiError, CreateDisbursementMutationArg>({
    mutationFn: async (input) => {
      const payload = 'data' in input ? input.data : input;
      const targetEntity = 'entity' in input ? input.entity : undefined;

      if (targetEntity !== undefined && targetEntity !== 'ATA' && targetEntity !== 'LTA') {
        throw new Error(`Invalid target entity: ${String(targetEntity)}`);
      }

      // Client-side schema validation on payload only (rejects status field; zero entity field in JSON)
      const validated = createDisbursementSchema.parse(payload);
      const headers: Record<string, string> = {};
      if (targetEntity) {
        headers['X-Active-Entity'] = targetEntity;
      }

      const res = await apiRequest<DisbursementDetailResponse>('/disbursements', {
        method: 'POST',
        body: JSON.stringify(validated),
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: disbursementKeys.all });
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const createWithBlocking = async (
    input: CreateDisbursementInput,
    options?: CreateDisbursementOptions
  ): Promise<Disbursement> => {
    const targetEntity = options?.entity;
    if (targetEntity !== undefined && targetEntity !== 'ATA' && targetEntity !== 'LTA') {
      throw new Error(`Invalid target entity: ${String(targetEntity)}`);
    }
    const arg: CreateDisbursementMutationArg = targetEntity
      ? { data: input, entity: targetEntity }
      : input;

    return runBlockingAction({
      title: 'Creating Disbursement',
      message: 'Submitting disbursement voucher to the server...',
      actionName: 'Create Disbursement',
      apiCall: async () => mutation.mutateAsync(arg),
      invalidateQueries: [
        disbursementKeys.all,
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Disbursement Created',
      successMessage: 'Draft voucher created and queued for Admin budget approval.',
    });
  };

  return {
    ...mutation,
    createDisbursement: mutation.mutateAsync,
    createWithBlocking,
  };
}

/**
 * 5. Update a disbursement in Draft or Pending status.
 * Endpoint: PUT /v1/disbursements/:id
 */
export function useUpdateDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    { id: string; data: UpdateDisbursementInput },
    { snapshots: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: async ({ id, data }) => {
      const validated = updateDisbursementSchema.parse(data);
      const res = await apiRequest<DisbursementDetailResponse>(`/disbursements/${id}`, {
        method: 'PUT',
        body: JSON.stringify(validated),
      });
      return res.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: disbursementKeys.all });
      const snapshots = queryClient.getQueriesData<unknown>({
        queryKey: disbursementKeys.all,
      });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const updateWithBlocking = async (params: {
    id: string;
    data: UpdateDisbursementInput;
  }): Promise<Disbursement> => {
    return runBlockingAction({
      title: 'Updating Disbursement',
      message: 'Saving changes to disbursement record...',
      actionName: 'Update Disbursement',
      apiCall: async () => mutation.mutateAsync(params),
      invalidateQueries: [
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Disbursement Updated',
      successMessage: 'Changes have been saved successfully.',
    });
  };

  return {
    ...mutation,
    updateDisbursement: mutation.mutateAsync,
    updateWithBlocking,
  };
}

/**
 * 6. Submit a Draft disbursement for approval (Draft → Pending).
 * Endpoint: POST /v1/disbursements/:id/submit
 */
export function useSubmitDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<Disbursement, ApiError, string | { id: string }>({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      const res = await apiRequest<DisbursementDetailResponse>(
        `/disbursements/${id}/submit`,
        {
          method: 'POST',
        }
      );
      return res.data;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.detail(updated.id),
      });
      queryClient.invalidateQueries({ queryKey: disbursementKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const submitWithBlocking = async (id: string): Promise<Disbursement> => {
    return runBlockingAction({
      title: 'Submitting Disbursement',
      message: 'Submitting disbursement for administrative review...',
      actionName: 'Submit Disbursement',
      apiCall: async () => mutation.mutateAsync(id),
      invalidateQueries: [
        disbursementKeys.detail(id),
        disbursementKeys.lists(),
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Disbursement Submitted',
      successMessage: 'Disbursement is now Pending approval.',
    });
  };

  return {
    ...mutation,
    submitDisbursement: mutation.mutateAsync,
    submitWithBlocking,
  };
}

/**
 * 7. Admin approval of a Pending disbursement (Pending → Released directly).
 * Endpoint: POST /v1/disbursements/:id/approve
 * Requires permission: disbursement:approve (Admin only).
 * Atomically writes payment details and transitions to Released.
 */
export function useApproveDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    string | ({ id: string } & Partial<ApproveDisbursementInput>),
    { snapshots: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      const expectedVersion = typeof arg === 'object' ? arg.expectedVersion : undefined;
      const payload: Record<string, unknown> = {};

      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }

      const res = await apiRequest<DisbursementDetailResponse>(
        `/disbursements/${id}/approve`,
        {
          method: 'POST',
          ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
        }
      );
      return res.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: disbursementKeys.all });
      const snapshots = queryClient.getQueriesData<unknown>({
        queryKey: disbursementKeys.all,
      });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const approveWithBlocking = async (
    idOrParams: string | ({ id: string } & Partial<ApproveDisbursementInput>),
    maybeExpectedVersion?: number
  ): Promise<Disbursement> => {
    let mutationArg: string | ({ id: string } & Partial<ApproveDisbursementInput>);
    if (typeof idOrParams === 'string') {
      mutationArg =
        maybeExpectedVersion !== undefined
          ? { id: idOrParams, expectedVersion: maybeExpectedVersion }
          : idOrParams;
    } else {
      mutationArg = {
        ...idOrParams,
        expectedVersion:
          idOrParams.expectedVersion !== undefined
            ? idOrParams.expectedVersion
            : maybeExpectedVersion,
      };
    }

    return runBlockingAction({
      title: 'Approving Disbursement',
      message: 'Recording budget approval for disbursement voucher...',
      actionName: 'Approve Disbursement',
      apiCall: async () => mutation.mutateAsync(mutationArg),
      invalidateQueries: [
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Disbursement Approved',
      successMessage: 'Disbursement authorized by Admin and ready for payment preparation.',
    });
  };

  return {
    ...mutation,
    approveDisbursement: mutation.mutateAsync,
    approveWithBlocking,
  };
}

/**
 * 8. Admin rejection of a Pending disbursement (Pending → Rejected).
 * Endpoint: POST /v1/disbursements/:id/reject
 * Requires permission: disbursement:approve (Admin only).
 * Requires mandatory non-empty reason (1–500 trimmed characters).
 */
export function useRejectDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    { id: string; reason: string; expectedVersion?: number },
    { snapshots: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: async ({ id, reason, expectedVersion }) => {
      const validated = rejectDisbursementSchema.parse({ reason });
      const payload: Record<string, unknown> = { reason: validated.reason };
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<DisbursementDetailResponse>(
        `/disbursements/${id}/reject`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      return res.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: disbursementKeys.all });
      const snapshots = queryClient.getQueriesData<unknown>({
        queryKey: disbursementKeys.all,
      });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const rejectWithBlocking = async (
    paramsOrId: { id: string; reason: string; expectedVersion?: number } | string,
    maybeReason?: string,
    maybeExpectedVersion?: number
  ): Promise<Disbursement> => {
    const params =
      typeof paramsOrId === 'string'
        ? { id: paramsOrId, reason: maybeReason ?? '', expectedVersion: maybeExpectedVersion }
        : paramsOrId;

    return runBlockingAction({
      title: 'Rejecting Disbursement',
      message: 'Recording rejection reason and notifying requestor...',
      actionName: 'Reject Disbursement',
      apiCall: async () => mutation.mutateAsync(params),
      invalidateQueries: [
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Disbursement Rejected',
      successMessage: 'Disbursement rejection has been recorded.',
    });
  };

  return {
    ...mutation,
    rejectDisbursement: mutation.mutateAsync,
    rejectWithBlocking,
  };
}

/**
 * 9. Record funds release (Approved → Released).
 * Endpoint: POST /v1/disbursements/:id/release
 * Requires permission: disbursement:mark_released (Accounting, Admin).
 */
export function useReleaseDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    string | { id: string; data?: ReleasePaymentInput; expectedVersion?: number },
    { snapshots: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      const expectedVersion = typeof arg === 'object' ? arg.expectedVersion : undefined;
      const payload: Record<string, unknown> = {};
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<DisbursementDetailResponse>(
        `/disbursements/${id}/release`,
        {
          method: 'POST',
          ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
        }
      );
      return res.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: disbursementKeys.all });
      const snapshots = queryClient.getQueriesData<unknown>({
        queryKey: disbursementKeys.all,
      });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const releaseWithBlocking = async (
    paramsOrId: { id: string; data?: ReleasePaymentInput; expectedVersion?: number } | string,
    maybeData?: ReleasePaymentInput,
    maybeExpectedVersion?: number
  ): Promise<Disbursement> => {
    const params =
      typeof paramsOrId === 'string'
        ? { id: paramsOrId, data: maybeData, expectedVersion: maybeExpectedVersion }
        : paramsOrId;

    return runBlockingAction({
      title: 'Releasing Funds',
      message: 'Recording payment disbursement release...',
      actionName: 'Release Funds',
      apiCall: async () => mutation.mutateAsync(params),
      invalidateQueries: [
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Funds Released',
      successMessage: 'Payment disbursement has been marked as released.',
    });
  };

  return {
    ...mutation,
    releaseDisbursement: mutation.mutateAsync,
    releaseWithBlocking,
  };
}

export const useReleasePayment = useReleaseDisbursement;

/**
 * 9b. Correct payment release fields on Released or Funded vouchers.
 * Endpoint: PATCH /v1/disbursements/:id/payment-details
 * Requires permission: disbursement:mark_released or Admin.
 * Immutability contract: status, approval timestamps, and fund history remain untouched.
 */
export function useUpdatePaymentDetails() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    { id: string; data: UpdatePaymentDetailsInput },
    { snapshots: Array<[readonly unknown[], unknown]> }
  >({
    mutationFn: async ({ id, data }) => {
      const validated = updatePaymentDetailsSchema.parse(data);
      const res = await apiRequest<DisbursementDetailResponse>(
        `/disbursements/${id}/payment-details`,
        {
          method: 'PATCH',
          body: JSON.stringify(validated),
        }
      );
      return res.data;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: disbursementKeys.all });
      const snapshots = queryClient.getQueriesData<unknown>({
        queryKey: disbursementKeys.all,
      });
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshots) {
        for (const [key, value] of context.snapshots) {
          queryClient.setQueryData(key, value);
        }
      }
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const updatePaymentDetailsWithBlocking = async (params: {
    id: string;
    data: UpdatePaymentDetailsInput;
  }): Promise<Disbursement> => {
    return runBlockingAction({
      title: 'Updating Payment Details',
      message: 'Recording corrected payment details for voucher...',
      actionName: 'Update Payment Details',
      apiCall: async () => mutation.mutateAsync(params),
      invalidateQueries: [disbursementKeys.counts(activeEntity)],
      successTitle: 'Payment Details Updated',
      successMessage: 'Payment details have been updated successfully.',
    });
  };

  return {
    ...mutation,
    updatePaymentDetails: mutation.mutateAsync,
    updatePaymentDetailsWithBlocking,
  };
}

/**
 * 9c. Request pre-signed upload reservation for a disbursement receipt.
 * Endpoint: POST /v1/disbursements/receipt-uploads
 */
const receiptReservationResponse = z.object({
  uploadId: z.string().trim().min(1),
  uploadUrl: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol)),
  objectKey: z.string().trim().min(1),
  expiresAt: z.string().datetime({ offset: true }),
});
const completedReceiptResponse = z.object({
  receiptS3Key: z.string().trim().min(1),
  receiptFilename: z.string().trim().min(1),
});

function resolveAndValidateReceiptEntity(options?: ReceiptTargetOptions): 'ATA' | 'LTA' {
  if (options && 'entity' in options) {
    const raw = (options as { entity?: unknown }).entity;
    if (raw !== undefined && raw !== 'ATA' && raw !== 'LTA') {
      throw new Error('Invalid target entity. Entity must be ATA or LTA.');
    }
  }

  const explicitTarget = options?.entity;
  const activeEntity = useSessionStore.getState().activeEntity;

  if (explicitTarget) {
    if (activeEntity === 'ATA' || activeEntity === 'LTA') {
      if (explicitTarget !== activeEntity) {
        throw new Error(`Receipt target entity mismatch: expected ${activeEntity}, got ${explicitTarget}`);
      }
    }
    return explicitTarget;
  }

  if (activeEntity === 'ATA' || activeEntity === 'LTA') {
    return activeEntity;
  }

  throw new Error('Select a specific ATA or LTA entity for this receipt upload.');
}

export async function requestReceiptUploadReservation(
  input: CreateReceiptUploadReservationInput,
  options?: ReceiptTargetOptions
): Promise<ReceiptUploadReservation> {
  const entity = resolveAndValidateReceiptEntity(options);
  const validated = receiptUploadReservationSchema.parse(input);
  const headers: Record<string, string> = {
    'X-Active-Entity': entity,
  };
  const res = await apiRequest<{ data: ReceiptUploadReservation }>(
    '/disbursements/receipt-uploads',
    {
      method: 'POST',
      body: JSON.stringify(validated),
      headers,
    }
  );
  return receiptReservationResponse.parse(res.data);
}

/**
 * Normalize and validate receipt MIME types.
 * Supports PDF, PNG, and JPEG (including .jpg/.jpeg extension and image/pjpeg variants).
 */
export function normalizeReceiptMimeType(mimeType: string, filename?: string): string {
  const normalized = (mimeType || '').trim().toLowerCase();
  if (normalized === 'application/pdf') return 'application/pdf';
  if (normalized === 'image/png') return 'image/png';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg' || normalized === 'image/pjpeg') {
    return 'image/jpeg';
  }
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  }
  return normalized;
}

export function isValidReceiptMimeType(mimeType: string, filename?: string): boolean {
  const normalized = normalizeReceiptMimeType(mimeType, filename);
  return ['application/pdf', 'image/png', 'image/jpeg'].includes(normalized);
}

/**
 * Upload binary file to pre-signed URL via PUT.
 */
export async function uploadReceiptBinary(
  uploadUrl: string,
  file: File,
  contentType?: string
): Promise<void> {
  const resolvedContentType = contentType || normalizeReceiptMimeType(file.type, file.name);
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': resolvedContentType,
    },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Failed to upload receipt binary to storage (HTTP ${response.status})`);
  }
}

/**
 * Complete receipt upload verification.
 * Endpoint: POST /v1/disbursements/receipt-uploads/:uploadId/complete
 */
export async function completeReceiptUpload(
  uploadId: string,
  options?: ReceiptTargetOptions
): Promise<{ receiptS3Key: string; receiptFilename: string }> {
  const entity = resolveAndValidateReceiptEntity(options);
  const headers: Record<string, string> = {
    'X-Active-Entity': entity,
  };
  const res = await apiRequest<{ data: { receiptS3Key: string; receiptFilename: string } }>(
    `/disbursements/receipt-uploads/${uploadId}/complete`,
    {
      method: 'POST',
      headers,
    }
  );
  return completedReceiptResponse.parse(res.data);
}

/**
 * Execute full pre-signed upload pipeline:
 * 1. Validate MIME (PDF, PNG, JPEG) & size (<= 10 MiB)
 * 2. Validate runtime target value (ATA/LTA) before any network call
 * 3. Reserve upload via POST /v1/disbursements/receipt-uploads with X-Active-Entity
 * 4. PUT binary to uploadUrl with Content-Type header
 * 5. Verify & complete via POST /v1/disbursements/receipt-uploads/:uploadId/complete with X-Active-Entity
 */
export async function uploadReceiptFile(
  file: File,
  isCurrentOrOptions?: (() => boolean) | UploadReceiptOptions,
  options?: UploadReceiptOptions
): Promise<{ receiptS3Key: string; receiptFilename: string }> {
  const isCurrent =
    typeof isCurrentOrOptions === 'function'
      ? isCurrentOrOptions
      : isCurrentOrOptions?.isCurrent ?? options?.isCurrent ?? (() => true);

  const entityOpt =
    typeof isCurrentOrOptions === 'object' && isCurrentOrOptions !== null && 'entity' in isCurrentOrOptions
      ? isCurrentOrOptions
      : options;

  if (!isValidReceiptMimeType(file.type, file.name)) {
    throw new Error('Only PDF, PNG, and JPEG files are allowed');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('File size cannot exceed 10 MiB');
  }

  const normalizedContentType = normalizeReceiptMimeType(file.type, file.name);
  const targetEntity = resolveAndValidateReceiptEntity(entityOpt);

  if (!isCurrent()) throw new Error('Receipt form changed. Select the receipt again.');

  const reservation = await requestReceiptUploadReservation(
    {
      filename: file.name,
      contentType: normalizedContentType,
      size: file.size,
    },
    { entity: targetEntity }
  );

  if (!isCurrent()) throw new Error('Receipt form changed. Select the receipt again.');
  await uploadReceiptBinary(reservation.uploadUrl, file, normalizedContentType);
  if (!isCurrent()) throw new Error('Receipt form changed. Select the receipt again.');
  const completed = await completeReceiptUpload(
    reservation.uploadId,
    { entity: targetEntity }
  );
  if (!isCurrent()) throw new Error('Receipt form changed. Select the receipt again.');
  if (completed.receiptS3Key !== reservation.objectKey) {
    throw new Error('Receipt verification returned a different attachment. Please upload again.');
  }
  return completed;
}

/**
 * 9d. Fetch short-lived authorized download/preview URL for disbursement receipt.
 * Endpoint: GET /v1/disbursements/:id/receipt-url
 */
export function useDisbursementReceiptUrl(
  id: string | undefined,
  options?: { enabled?: boolean; entity?: string }
) {
  return useQuery({
    queryKey: disbursementKeys.receiptUrl(id ?? ''),
    queryFn: async () => {
      if (!id) throw new Error('Disbursement ID is required');
      if (isTestWithoutMock()) {
        return null;
      }
      const headers: Record<string, string> = {};
      if (options?.entity) {
        headers['X-Active-Entity'] = options.entity;
      }
      const res = await apiRequest<{ data: ReceiptUrlData }>(
        `/disbursements/${id}/receipt-url`,
        { headers }
      );
      return res.data;
    },
    enabled: Boolean(id) && (options?.enabled ?? true),
    staleTime: 4 * 60 * 1000, // 4 minutes (signed URLs expire in 5 minutes)
    retry: 1,
  });
}

/**
 * 10. Prepare payment instrument details and transition to Funded (Approved → Funded).
 * Endpoint: POST /v1/disbursements/:id/fund
 * Requires permission: disbursement:mark_released (Accounting, Admin).
 * Forward payment payloads for fund all the way from UI → schema → controller → service → RPC.
 */
export type FundDisbursementMutationArg =
  | string
  | {
      id: string;
      data?: Partial<FundDisbursementInput>;
      method?: string;
      bank?: string;
      reference?: string;
      date?: string;
      expectedVersion?: number;
    };

export function useFundDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    FundDisbursementMutationArg
  >({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      let payload: Record<string, unknown> = {};

      if (typeof arg === 'object') {
        const method = arg.data?.method ?? arg.method;
        const bank = arg.data?.bank ?? arg.bank;
        const reference = arg.data?.reference ?? arg.reference;
        const date = arg.data?.date ?? arg.date;
        const expectedVersion = arg.data?.expectedVersion ?? arg.expectedVersion;

        if (method && bank && reference && date && typeof expectedVersion === 'number') {
          payload = fundDisbursementSchema.parse({
            method,
            bank,
            reference,
            date,
            expectedVersion,
          });
        } else {
          if (method) payload.method = method;
          if (bank) payload.bank = bank;
          if (reference) payload.reference = reference;
          if (date) payload.date = date;
          if (typeof expectedVersion === 'number') payload.expectedVersion = expectedVersion;
        }
      }

      const res = await apiRequest<DisbursementDetailResponse>(
        `/disbursements/${id}/fund`,
        {
          method: 'POST',
          ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
        }
      );
      return res.data;
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.detail(updated.id),
      });
      queryClient.invalidateQueries({ queryKey: disbursementKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const fundWithBlocking = async (
    idOrParams: FundDisbursementMutationArg,
    maybeExpectedVersion?: number
  ): Promise<Disbursement> => {
    let mutationArg: FundDisbursementMutationArg;
    if (typeof idOrParams === 'string') {
      mutationArg =
        maybeExpectedVersion !== undefined
          ? { id: idOrParams, expectedVersion: maybeExpectedVersion }
          : idOrParams;
    } else {
      mutationArg = {
        ...idOrParams,
        expectedVersion:
          idOrParams.expectedVersion !== undefined
            ? idOrParams.expectedVersion
            : maybeExpectedVersion,
      };
    }

    const id = typeof mutationArg === 'string' ? mutationArg : mutationArg.id;

    return runBlockingAction({
      title: 'Preparing Payment Instrument',
      message: 'Recording payment instrument details and transitioning to Funded...',
      actionName: 'Fund Disbursement',
      apiCall: async () => mutation.mutateAsync(mutationArg),
      invalidateQueries: [
        disbursementKeys.detail(id),
        disbursementKeys.lists(),
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Payment Instrument Prepared',
      successMessage: 'Payment instrument details recorded and verified. Awaiting Admin release.',
    });
  };

  return {
    ...mutation,
    fundDisbursement: mutation.mutateAsync,
    fundWithBlocking,
  };
}

/**
 * 10b. Return a rejected disbursement to Draft for correction (Rejected → Draft).
 * Endpoint: POST /v1/disbursements/:id/resend_draft
 * Requires permission: disbursement:approve (Admin only).
 * Invalidate current approval/preparation/release attribution; sets review_ready = false.
 */
export function useResendDraft() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    string | { id: string; expectedVersion?: number }
  >({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;
      const expectedVersion = typeof arg === 'object' ? arg.expectedVersion : undefined;
      const payload: Record<string, unknown> = {};
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<DisbursementDetailResponse>(
        `/disbursements/${id}/resend_draft`,
        {
          method: 'POST',
          ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
        }
      );
      return res.data;
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const resendDraftWithBlocking = async (
    idOrParams: string | { id: string; expectedVersion?: number },
    maybeExpectedVersion?: number
  ): Promise<Disbursement> => {
    const id = typeof idOrParams === 'string' ? idOrParams : idOrParams.id;
    const expectedVersion =
      typeof idOrParams === 'object' && idOrParams.expectedVersion !== undefined
        ? idOrParams.expectedVersion
        : maybeExpectedVersion;

    const mutationArg = expectedVersion !== undefined ? { id, expectedVersion } : id;

    return runBlockingAction({
      title: 'Returning to Draft',
      message: 'Returning rejected voucher to Draft for requester revision...',
      actionName: 'Return to Draft',
      apiCall: async () => mutation.mutateAsync(mutationArg),
      invalidateQueries: [
        disbursementKeys.detail(id),
        disbursementKeys.lists(),
        disbursementKeys.counts(activeEntity),
      ],
      successTitle: 'Returned to Draft',
      successMessage: 'Voucher returned to Draft awaiting requester correction.',
    });
  };

  return {
    ...mutation,
    resendDraft: mutation.mutateAsync,
    resendDraftWithBlocking,
  };
}

/**
 * 11. Archive disbursement (Active → Archived).
 * Endpoint: POST /v1/disbursements/:id/archive
 * Requires permission: disbursement:edit
 */
export async function archiveDisbursementAction(
  id: string,
  reference?: string,
  activeEntity?: string | null,
  expectedVersion?: number
): Promise<Disbursement> {
  return runBlockingAction<Disbursement>({
    title: 'Archiving Disbursement',
    message: `Archiving disbursement voucher ${reference || id}...`,
    actionName: 'Archive Disbursement',
    apiCall: async () => {
      const payload: Record<string, unknown> = {};
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<{ data: Disbursement }>(`/disbursements/${id}/archive`, {
        method: 'POST',
        ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
      });
      broadcastEntityChange({
        domain: 'disbursements',
        entityId: res.data.id,
        entityData: res.data,
      });
      return res.data;
    },
    invalidateQueries: [
      disbursementKeys.all,
      disbursementKeys.lists(),
      disbursementKeys.detail(id),
      disbursementKeys.counts(activeEntity ?? null),
    ],
    successTitle: 'Disbursement Archived',
    successMessage: `Disbursement voucher ${reference || id} was archived.`,
  });
}

export function useArchiveDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    { id: string; reference?: string; expectedVersion?: number }
  >({
    mutationFn: async ({ id, expectedVersion }) => {
      const payload: Record<string, unknown> = {};
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<{ data: Disbursement }>(`/disbursements/${id}/archive`, {
        method: 'POST',
        ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
      });
      return res.data;
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.all,
      });
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.detail(updated.id),
      });
      queryClient.invalidateQueries({ queryKey: disbursementKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const archiveWithBlocking = async (params: {
    id: string;
    reference?: string;
    expectedVersion?: number;
  }): Promise<Disbursement> => {
    return archiveDisbursementAction(params.id, params.reference, activeEntity, params.expectedVersion);
  };

  return {
    ...mutation,
    archiveDisbursement: mutation.mutateAsync,
    archiveWithBlocking,
  };
}

/**
 * 12. Restore disbursement from archive (Archived → Active).
 * Endpoint: POST /v1/disbursements/:id/unarchive
 * Requires permission: disbursement:edit
 */
export async function restoreDisbursementAction(
  id: string,
  reference?: string,
  activeEntity?: string | null,
  expectedVersion?: number
): Promise<Disbursement> {
  return runBlockingAction<Disbursement>({
    title: 'Restoring Disbursement',
    message: `Restoring disbursement voucher ${reference || id} from archive...`,
    actionName: 'Restore Disbursement',
    apiCall: async () => {
      const payload: Record<string, unknown> = {};
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<{ data: Disbursement }>(`/disbursements/${id}/unarchive`, {
        method: 'POST',
        ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
      });
      broadcastEntityChange({
        domain: 'disbursements',
        entityId: res.data.id,
        entityData: res.data,
      });
      return res.data;
    },
    invalidateQueries: [
      disbursementKeys.all,
      disbursementKeys.lists(),
      disbursementKeys.detail(id),
      disbursementKeys.counts(activeEntity ?? null),
    ],
    successTitle: 'Disbursement Restored',
    successMessage: `Disbursement voucher ${reference || id} was restored.`,
  });
}

export function useRestoreDisbursement() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<
    Disbursement,
    ApiError,
    { id: string; reference?: string; expectedVersion?: number }
  >({
    mutationFn: async ({ id, expectedVersion }) => {
      const payload: Record<string, unknown> = {};
      if (typeof expectedVersion === 'number') {
        payload.expectedVersion = expectedVersion;
      }
      const res = await apiRequest<{ data: Disbursement }>(`/disbursements/${id}/unarchive`, {
        method: 'POST',
        ...(Object.keys(payload).length > 0 ? { body: JSON.stringify(payload) } : {}),
      });
      return res.data;
    },
    onSuccess: (updated) => {
      pinAndBroadcastDisbursement(queryClient, updated);
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.all,
      });
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.detail(updated.id),
      });
      queryClient.invalidateQueries({ queryKey: disbursementKeys.lists() });
      queryClient.invalidateQueries({
        queryKey: disbursementKeys.counts(activeEntity),
      });
    },
  });

  const restoreWithBlocking = async (params: {
    id: string;
    reference?: string;
    expectedVersion?: number;
  }): Promise<Disbursement> => {
    return restoreDisbursementAction(params.id, params.reference, activeEntity, params.expectedVersion);
  };

  return {
    ...mutation,
    restoreDisbursement: mutation.mutateAsync,
    restoreWithBlocking,
  };
}

/** Generate the same voucher shown in preview, with a stable key per header variant. */
export async function fetchDisbursementPdfUrl(id: string, options: { noLogo?: boolean; includeCompanyDetails?: boolean } = {}): Promise<string> {
  const params = new URLSearchParams({ noLogo: String(options.noLogo === true), includeCompanyDetails: String(options.includeCompanyDetails !== false) });
  const res = await apiRequest<{ data: { url: string } }>(`/disbursements/${id}/pdf?${params}`);
  return res.data.url;
}
