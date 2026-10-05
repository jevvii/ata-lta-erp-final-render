/**
 * TanStack Query hooks for Clients Module (Parcel CLI / Module #8)
 *
 * Citation: Frozen API Contract clients@2.0.0 (docs/api-contracts/modules/clients.md)
 * Policy: Zero Optimistic Updates — all mutations use runBlockingAction.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { runBlockingAction } from '@/features/operations/components/BlockingActionModal';
import { clientKeys } from './queryKeys';
import {
  createClientSchema,
  updateClientSchema,
  clientSchema,
  clientCountsSchema,
} from './schemas';
import type {
  Client,
  ClientFilters,
  CreateClientInput,
  UpdateClientInput,
  ClientCounts,
  ClientListResponse,
  ClientDetailResponse,
  ClientCountsResponse,
} from './types';

// ============================================================================
// 1. Query Hooks
// ============================================================================

/**
 * 1. Fetch paginated/filtered list of clients.
 * Endpoint: GET /v1/clients
 */
export function useClientsList(filters?: ClientFilters) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const effectiveEntity = filters?.entity ?? activeEntity;

  return useQuery<ClientListResponse, ApiError>({
    queryKey: clientKeys.list(effectiveEntity, filters),
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (filters?.search) searchParams.append('search', filters.search);
      if (filters?.status) searchParams.append('status', filters.status);
      if (filters?.archived) searchParams.append('archived', 'true');
      if (filters?.page !== undefined) searchParams.append('page', String(filters.page));
      if (filters?.limit !== undefined) searchParams.append('limit', String(filters.limit));
      if (filters?.sortBy) searchParams.append('sortBy', filters.sortBy);
      if (filters?.sortOrder) searchParams.append('sortOrder', filters.sortOrder);

      const qs = searchParams.toString();
      const path = `/clients${qs ? `?${qs}` : ''}`;
      const res = await apiRequest<ClientListResponse>(path);

      // Validate array items
      const validatedData = res.data.map((c) => clientSchema.parse(c) as Client);
      return {
        data: validatedData,
        meta: res.meta,
      };
    },
    staleTime: 30 * 1000,
  });
}

/**
 * 2. Fetch client counts breakdown (Active vs Archived).
 * Endpoint: GET /v1/clients/counts
 */
export function useClientCounts() {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<ClientCounts, ApiError>({
    queryKey: clientKeys.counts(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<ClientCountsResponse>('/clients/counts');
      return clientCountsSchema.parse(res.data);
    },
    staleTime: 30 * 1000,
  });
}

/**
 * 3. Fetch single client detail.
 * Endpoint: GET /v1/clients/:id
 */
export function useClientDetail(id: string | undefined, includeArchived = false) {
  return useQuery<Client, ApiError>({
    queryKey: clientKeys.detail(id),
    queryFn: async () => {
      if (!id) throw new Error('Client ID is required');
      const qs = includeArchived ? '?includeArchived=true' : '';
      const res = await apiRequest<ClientDetailResponse>(`/clients/${id}${qs}`);
      return clientSchema.parse(res.data) as Client;
    },
    enabled: Boolean(id),
    staleTime: 30 * 1000,
  });
}

// ============================================================================
// 2. Mutation Hooks (Zero Optimistic Updates Doctrine)
// ============================================================================

/**
 * 4. Create a new client record.
 * Endpoint: POST /v1/clients
 */
export function useCreateClient() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<Client, ApiError, CreateClientInput>({
    mutationFn: async (input) => {
      const validated = createClientSchema.parse(input);
      const res = await apiRequest<ClientDetailResponse>('/clients', {
        method: 'POST',
        body: JSON.stringify(validated),
      });
      return clientSchema.parse(res.data) as Client;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });

  const createWithBlocking = async (input: CreateClientInput): Promise<Client> => {
    return runBlockingAction({
      title: 'Creating Client',
      message: 'Registering new client in the master directory...',
      actionName: 'Create Client',
      apiCall: async () => mutation.mutateAsync(input),
      invalidateQueries: [
        clientKeys.all,
        clientKeys.counts(activeEntity),
      ],
      successTitle: 'Client Created',
      successMessage: 'Client record has been registered successfully.',
    });
  };

  return {
    ...mutation,
    createClient: mutation.mutateAsync,
    createWithBlocking,
  };
}

/**
 * 5. Update an existing client.
 * Endpoint: PUT /v1/clients/:id
 */
export function useUpdateClient() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<Client, ApiError, { id: string; input: UpdateClientInput }>({
    mutationFn: async ({ id, input }) => {
      const validated = updateClientSchema.parse(input);
      const res = await apiRequest<ClientDetailResponse>(`/clients/${id}`, {
        method: 'PUT',
        body: JSON.stringify(validated),
      });
      return clientSchema.parse(res.data) as Client;
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(updated.id) });
      queryClient.invalidateQueries({ queryKey: clientKeys.lists() });
    },
  });

  const updateWithBlocking = async (id: string, input: UpdateClientInput): Promise<Client> => {
    return runBlockingAction({
      title: 'Updating Client',
      message: 'Saving client master record modifications...',
      actionName: 'Update Client',
      apiCall: async () => mutation.mutateAsync({ id, input }),
      invalidateQueries: [
        clientKeys.detail(id),
        clientKeys.lists(),
        clientKeys.counts(activeEntity),
      ],
      successTitle: 'Client Updated',
      successMessage: 'Client modifications have been saved.',
    });
  };

  return {
    ...mutation,
    updateClient: mutation.mutateAsync,
    updateWithBlocking,
  };
}

/**
 * 6. Archive a client (Soft delete).
 * Endpoint: POST /v1/clients/:id/archive
 */
export function useArchiveClient() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<Client, ApiError, string>({
    mutationFn: async (id) => {
      const res = await apiRequest<ClientDetailResponse>(`/clients/${id}/archive`, {
        method: 'POST',
      });
      return clientSchema.parse(res.data) as Client;
    },
    onSuccess: (archived) => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(archived.id) });
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });

  const archiveWithBlocking = async (id: string, clientName?: string): Promise<Client> => {
    return runBlockingAction({
      title: 'Archiving Client',
      message: `Moving ${clientName ? `"${clientName}"` : 'client'} to archive...`,
      actionName: 'Archive Client',
      apiCall: async () => mutation.mutateAsync(id),
      invalidateQueries: [
        clientKeys.all,
        clientKeys.counts(activeEntity),
      ],
      successTitle: 'Client Archived',
      successMessage: `${clientName ? `"${clientName}"` : 'Client'} has been moved to the archive.`,
    });
  };

  return {
    ...mutation,
    archiveClient: mutation.mutateAsync,
    archiveWithBlocking,
  };
}

/**
 * 7. Unarchive / Restore a client.
 * Endpoint: POST /v1/clients/:id/unarchive
 */
export function useUnarchiveClient() {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const mutation = useMutation<Client, ApiError, string>({
    mutationFn: async (id) => {
      const res = await apiRequest<ClientDetailResponse>(`/clients/${id}/unarchive`, {
        method: 'POST',
      });
      return clientSchema.parse(res.data) as Client;
    },
    onSuccess: (restored) => {
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(restored.id) });
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });

  const unarchiveWithBlocking = async (id: string, clientName?: string): Promise<Client> => {
    return runBlockingAction({
      title: 'Restoring Client',
      message: `Restoring ${clientName ? `"${clientName}"` : 'client'} to active status...`,
      actionName: 'Restore Client',
      apiCall: async () => mutation.mutateAsync(id),
      invalidateQueries: [
        clientKeys.all,
        clientKeys.counts(activeEntity),
      ],
      successTitle: 'Client Restored',
      successMessage: `${clientName ? `"${clientName}"` : 'Client'} has been restored to active status.`,
    });
  };

  return {
    ...mutation,
    unarchiveClient: mutation.mutateAsync,
    unarchiveWithBlocking,
  };
}
