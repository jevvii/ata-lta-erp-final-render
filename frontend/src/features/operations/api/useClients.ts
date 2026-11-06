import { useQuery } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';

export interface ClientSummary {
  id: string;
  name: string;
  entity?: 'ATA' | 'LTA' | 'BOTH' | string;
  tin?: string | null;
  tradeName?: string | null;
  trade_name?: string | null;
  clientNumber?: string | null;
  client_number?: string | null;
  retainerAmount?: number;
  status?: string;
  email?: string;
  contactPerson?: string;
  rdoCode?: string | null;
  address?: string | null;
  retainer?: boolean;
}

export interface ClientListResponse {
  data: ClientSummary[];
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

export interface ClientFilters {
  entity?: string | null;
  search?: string;
  status?: string;
}

export function useClients(filters?: ClientFilters, options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const requestedEntity =
    filters?.entity !== undefined
      ? (filters.entity || 'ALL')
      : activeEntity;
  const effectiveEntity =
    requestedEntity && requestedEntity !== 'ALL' ? requestedEntity : undefined;

  return useQuery<ClientSummary[], ApiError>({
    queryKey: ['clients', 'list', effectiveEntity, filters?.search, filters?.status],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (effectiveEntity) {
        searchParams.append('entity', effectiveEntity);
      }
      if (filters?.search) {
        searchParams.append('search', filters.search);
      }
      if (filters?.status) {
        searchParams.append('status', filters.status);
      }
      const queryStr = searchParams.toString();
      const path = `/clients${queryStr ? `?${queryStr}` : ''}`;
      const headers: Record<string, string> = {};
      if (filters?.entity !== undefined) {
        headers['X-Active-Entity'] = filters.entity || 'ALL';
      }
      const res = await apiRequest<ClientListResponse>(
        path,
        Object.keys(headers).length > 0 ? { headers } : undefined
      );
      return res.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
  });
}
