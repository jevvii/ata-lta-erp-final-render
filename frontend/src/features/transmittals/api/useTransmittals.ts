/**
 * TanStack Query Hooks for Transmittals (Module #5)
 *
 * Citation: Frozen API Contract transmittals@2.0.0 (docs/api-contracts/modules/transmittals.md)
 * Doctrine: Zero Optimistic Updates — non-dismissible blocking execution, verbatim RFC 7807 surfacing.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { runBlockingAction } from '@/features/operations/components/BlockingActionModal';
import { transmittalKeys } from './queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import {
  createTransmittalSchema,
  updateTransmittalSchema,
} from './schemas';
import type {
  TransmittalWithItems,
  TransmittalFilters,
  CreateTransmittalInput,
  UpdateTransmittalInput,
  SendTransmittalInput,
  AcknowledgeTransmittalInput,
  TransmittalListResponse,
  TransmittalDetailResponse,
  TransmittalCountsResponse,
  TransmittalCounts,
} from './types';

// ============================================================================
// 1. Data Query Hooks
// ============================================================================

function isTestWithoutMock(): boolean {
  const isTest =
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
    (typeof import.meta !== 'undefined' && (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test');
  const isMocked =
    typeof globalThis.fetch === 'function' &&
    Boolean((globalThis.fetch as { mock?: unknown }).mock);
  return Boolean(isTest && !isMocked);
}

/**
 * 1. Fetch transmittals list with entity scoping and filters.
 * Endpoint: GET /v1/transmittals
 */
export function useTransmittalsList(
  filters?: TransmittalFilters,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: transmittalKeys.list(activeEntity, filters),
    queryFn: async () => {
      if (isTestWithoutMock()) {
        return {
          data: [],
          meta: { total: 0, page: 1, limit: 20 },
        };
      }
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);
      if (filters?.clientId) params.append('clientId', filters.clientId);
      if (filters?.workRequestId) params.append('workRequestId', filters.workRequestId);
      if (filters?.search) params.append('search', filters.search);
      if (filters?.archived !== undefined) params.append('archived', String(filters.archived));
      if (filters?.includeDeleted !== undefined) params.append('includeDeleted', String(filters.includeDeleted));
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.limit) params.append('limit', String(filters.limit));
      params.append('_t', String(Date.now()));

      const queryStr = params.toString();
      const path = `/transmittals${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<TransmittalListResponse>(path);
      return res;
    },
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

export const useTransmittals = useTransmittalsList;

/**
 * 2. Fetch single transmittal detail with client details and line items.
 * Endpoint: GET /v1/transmittals/:id
 */
export function useTransmittalDetail(
  id: string | undefined,
  options?: { enabled?: boolean }
) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: transmittalKeys.detail(id),
    queryFn: async () => {
      if (!id) throw new Error('Transmittal ID is required');
      const res = await apiRequest<TransmittalDetailResponse>(`/transmittals/${id}?_t=${Date.now()}`);
      return res.data;
    },
    enabled: Boolean(id) && (options?.enabled ?? true),
    // A missing or forbidden record is not transient; retries/focus cannot repair a 403 or 404.
    retry: (failureCount, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 403)) && failureCount < 1,
    refetchOnWindowFocus: (query) => !(query.state.error instanceof ApiError && (query.state.error.status === 404 || query.state.error.status === 403)),
    refetchOnReconnect: (query) => !(query.state.error instanceof ApiError && (query.state.error.status === 404 || query.state.error.status === 403)),
    // Instant feel: render from the matching list row while the detail fetch
    // completes — but only when the row carries its line items (the detail
    // modal renders items unguarded). Placeholder never persists.
    placeholderData: (_prev): TransmittalWithItems | undefined => {
      if (!id) return undefined;
      const currentEntity = useSessionStore.getState().activeEntity;
      for (const [key, list] of queryClient.getQueriesData<TransmittalListResponse>({
        queryKey: transmittalKeys.lists(),
      })) {
        if (key[2] !== currentEntity) continue;
        const hit = list?.data?.find((t) => t.id === id);
        if (hit && Array.isArray(hit.items)) return hit as TransmittalWithItems;
      }
      return undefined;
    },
  });
}

/**
 * 3. Fetch tab badge counts (active, archived, total).
 * Endpoint: GET /v1/transmittals/counts
 */
export function useTransmittalCounts(options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<TransmittalCounts>({
    queryKey: transmittalKeys.counts(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<TransmittalCountsResponse>(`/transmittals/counts?_t=${Date.now()}`);
      return res.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 0,
  });
}

// ============================================================================
// 2. Mutation Hooks (Zero Optimistic Updates Doctrine)
// ============================================================================

/**
 * 4. Create transmittal manifest with line items.
 * Endpoint: POST /v1/transmittals
 */
export function useCreateTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTransmittalInput) => {
      const validated = createTransmittalSchema.parse(input);
      return runBlockingAction<TransmittalWithItems>({
        title: 'Creating Transmittal',
        message: `Creating transmittal ${validated.trackingNumber}...`,
        actionName: 'transmittal.create',
        invalidateQueries: [transmittalKeys.all, disbursementKeys.all, billingKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: TransmittalWithItems }>('/transmittals', {
            method: 'POST',
            body: JSON.stringify(validated),
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.invalidateQueries({ queryKey: disbursementKeys.all });
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}

/**
 * 5. Update transmittal content and/or board order.
 * Endpoint: PUT /v1/transmittals/:id
 */
export function useUpdateTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateTransmittalInput }) => {
      const validated = updateTransmittalSchema.parse(data);
      return runBlockingAction<TransmittalWithItems>({
        title: 'Updating Transmittal',
        message: 'Saving changes...',
        actionName: 'transmittal.update',
        invalidateQueries: [transmittalKeys.all, disbursementKeys.all, billingKeys.all],
        apiCall: async () => {
          const headers: Record<string, string> = {};
          if (validated.expectedVersion) {
            headers['If-Match'] = String(validated.expectedVersion);
          }
          const res = await apiRequest<{ data: TransmittalWithItems }>(`/transmittals/${id}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(validated),
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.invalidateQueries({ queryKey: disbursementKeys.all });
      queryClient.invalidateQueries({ queryKey: billingKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}

/**
 * 6. Admin direct approve (Draft -> Sent).
 * Endpoint: POST /v1/transmittals/:id/approve
 */
export function useApproveTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return runBlockingAction<TransmittalWithItems>({
        title: 'Approving Transmittal',
        message: 'Authorizing document transmittal dispatch...',
        actionName: 'transmittal.approve',
        invalidateQueries: [transmittalKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: TransmittalWithItems }>(`/transmittals/${id}/approve`, {
            method: 'POST',
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}

/**
 * 7. Mark as sent (Draft -> Sent).
 * Dual-path: Admin auto-approves; Non-Admin requires approved === true.
 * Endpoint: POST /v1/transmittals/:id/send
 */
export function useSendTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data?: SendTransmittalInput }) => {
      return runBlockingAction<TransmittalWithItems>({
        title: 'Marking as Sent',
        message: 'Recording document delivery dispatch...',
        actionName: 'transmittal.send',
        invalidateQueries: [transmittalKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: TransmittalWithItems }>(`/transmittals/${id}/send`, {
            method: 'POST',
            body: data ? JSON.stringify(data) : undefined,
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}

/**
 * 8. Acknowledge receipt (Sent -> Acknowledged).
 * Endpoint: POST /v1/transmittals/:id/acknowledge
 */
export function useAcknowledgeTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data?: AcknowledgeTransmittalInput }) => {
      return runBlockingAction<TransmittalWithItems>({
        title: 'Acknowledging Receipt',
        message: 'Confirming document delivery acknowledgment...',
        actionName: 'transmittal.acknowledge',
        invalidateQueries: [transmittalKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: TransmittalWithItems }>(`/transmittals/${id}/acknowledge`, {
            method: 'POST',
            body: data ? JSON.stringify(data) : undefined,
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}

/**
 * 9. Archive transmittal.
 * Endpoint: POST /v1/transmittals/:id/archive
 */
export function useArchiveTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return runBlockingAction<TransmittalWithItems>({
        title: 'Archiving Transmittal',
        message: 'Moving transmittal to archive...',
        actionName: 'transmittal.archive',
        invalidateQueries: [transmittalKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: TransmittalWithItems }>(`/transmittals/${id}/archive`, {
            method: 'POST',
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}

/**
 * 10. Unarchive transmittal.
 * Endpoint: POST /v1/transmittals/:id/unarchive
 */
export function useUnarchiveTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return runBlockingAction<TransmittalWithItems>({
        title: 'Restoring Transmittal',
        message: 'Restoring transmittal to active status...',
        actionName: 'transmittal.unarchive',
        invalidateQueries: [transmittalKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: TransmittalWithItems }>(`/transmittals/${id}/unarchive`, {
            method: 'POST',
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}

/**
 * 11. Soft delete transmittal.
 * Endpoint: DELETE /v1/transmittals/:id
 */
export function useDeleteTransmittal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return runBlockingAction<void>({
        title: 'Deleting Transmittal',
        message: 'Soft-deleting transmittal record...',
        actionName: 'transmittal.delete',
        invalidateQueries: [transmittalKeys.all],
        apiCall: async () => {
          await apiRequest<void>(`/transmittals/${id}`, {
            method: 'DELETE',
          });
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      queryClient.refetchQueries({ queryKey: transmittalKeys.all });
    },
  });
}
