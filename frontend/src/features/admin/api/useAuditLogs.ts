import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiRequest, type ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { adminKeys } from './queryKeys';
import type { AuditLogFilterParams, AuditLogResponse } from './types';

function buildAuditQueryString(params?: AuditLogFilterParams): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();

  const limit = params.limit ?? 20;
  const page = params.page ?? 1;
  const offset = params.offset !== undefined ? params.offset : (page - 1) * limit;

  searchParams.set('limit', String(limit));
  searchParams.set('offset', String(offset));
  if (params.page !== undefined) searchParams.set('page', String(params.page));

  if (params.module && params.module !== 'ALL') searchParams.set('module', params.module);
  if (params.action && params.action !== 'ALL') searchParams.set('action', params.action);
  const tableVal = params.table || params.tableName;
  if (tableVal && tableVal !== 'ALL') searchParams.set('table', tableVal);

  const actor = params.userId || params.actor;
  if (actor && actor !== 'ALL') {
    searchParams.set('userId', actor);
    searchParams.set('actor', actor);
  }

  if (params.search && params.search.trim() !== '') {
    searchParams.set('search', params.search.trim());
  }

  if (params.date && params.date.trim() !== '') {
    searchParams.set('date', params.date.trim());
  }
  if (params.from && params.from.trim() !== '') {
    searchParams.set('from', params.from.trim());
  }
  if (params.to && params.to.trim() !== '') {
    searchParams.set('to', params.to.trim());
  }
  if (params.sortOrder) {
    searchParams.set('sortOrder', params.sortOrder);
  }

  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Queries the paginated system audit log (`/v1/admin/audit`).
 * Keeps previous page data during filter/page transitions (`keepPreviousData`).
 */
export function useAuditLogsList(params?: AuditLogFilterParams) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const effectiveEntity =
    params?.entity ?? (activeEntity !== 'ALL' ? activeEntity : undefined);

  return useQuery<AuditLogResponse, ApiError>({
    queryKey: adminKeys.auditLogs({ ...(params ?? {}), entity: effectiveEntity ?? 'ALL' }),
    queryFn: async () => {
      const qs = buildAuditQueryString(params);
      const res = await apiRequest<AuditLogResponse>(`/admin/audit${qs}`);
      const items = Array.isArray(res?.data) ? res.data : [];
      const limit = res?.meta?.limit ?? params?.limit ?? 20;
      const offset =
        res?.meta?.offset ??
        params?.offset ??
        ((params?.page ?? 1) - 1) * limit;
      const total = res?.meta?.total ?? items.length;
      const hasMore =
        typeof res?.meta?.hasMore === 'boolean'
          ? res.meta.hasMore
          : offset + items.length < total;

      return {
        data: items,
        meta: {
          total,
          limit,
          offset,
          hasMore,
        },
      };
    },
    enabled: params?.enabled ?? true,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * Queries the total count of audit log entries (`/v1/admin/audit/count`),
 * falling back to `meta.total` from `/admin/audit?limit=1` if needed.
 */
export function useAuditCount(options?: { entity?: string | null; enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const effectiveEntity =
    options?.entity ?? (activeEntity !== 'ALL' ? activeEntity : undefined);

  return useQuery<{ total: number; count?: number }, ApiError>({
    queryKey: adminKeys.auditCount(effectiveEntity),
    queryFn: async () => {
      try {
        const res = await apiRequest<{
          data?: { total?: number; count?: number };
          total?: number;
          count?: number;
        }>('/admin/audit/count');
        const val =
          res?.data?.total ??
          res?.data?.count ??
          res?.total ??
          res?.count;
        if (typeof val === 'number') {
          return { total: val, count: val };
        }
      } catch {
        // Fallback to meta.total from /admin/audit?limit=1
      }
      const listRes = await apiRequest<AuditLogResponse>('/admin/audit?limit=1&offset=0');
      const total = listRes?.meta?.total ?? listRes?.data?.length ?? 0;
      return { total, count: total };
    },
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  });
}
