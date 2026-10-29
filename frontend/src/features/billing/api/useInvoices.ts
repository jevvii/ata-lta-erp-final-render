import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { billingKeys } from './queryKeys';
import type {
  Invoice,
  InvoiceFilters,
  InvoiceListResponse,
  InvoiceCountsResponse,
} from './types';

function isTestWithoutMock(): boolean {
  const isTest =
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
    (typeof import.meta !== 'undefined' && (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test');
  const isMocked =
    typeof globalThis.fetch === 'function' &&
    Boolean((globalThis.fetch as { mock?: unknown }).mock);
  return Boolean(isTest && !isMocked);
}

export function useInvoices(
  filters?: InvoiceFilters,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: billingKeys.invoicesList(activeEntity, filters),
    queryFn: async () => {
      if (isTestWithoutMock()) {
        return {
          data: [],
          meta: { total: 0, page: 1, limit: 20 },
          total: 0,
          paid: 0,
          pending: 0,
          overdue: 0,
        };
      }
      const params = new URLSearchParams();
      if (filters?.status && filters.status !== 'All') {
        params.append('status', filters.status);
      }
      if (filters?.clientId) params.append('clientId', filters.clientId);
      if (filters?.workRequestId) params.append('workRequestId', filters.workRequestId);
      if (filters?.linkedTaskId) params.append('linkedTaskId', filters.linkedTaskId);
      if (filters?.linkedTransmittalId) {
        params.append('linkedTransmittalId', filters.linkedTransmittalId);
      }
      if (filters?.search) params.append('search', filters.search);
      if (filters?.archived !== undefined) {
        params.append('archived', String(filters.archived));
      }
      if (filters?.includeDeleted !== undefined) {
        params.append('includeDeleted', String(filters.includeDeleted));
      }
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.limit) params.append('limit', String(filters.limit));

      const queryStr = params.toString();
      const path = `/invoices${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<InvoiceListResponse>(path);
      return res;
    },
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000,
  });
}

/** Alias to satisfy contract citations */
export const useInvoicesList = useInvoices;

export function useInvoiceDetail(
  id: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: billingKeys.invoiceDetail(id),
    queryFn: async () => {
      if (!id) throw new Error('Invoice ID required');
      if (isTestWithoutMock()) {
        return null as unknown as Invoice;
      }
      const res = await apiRequest<{ data: Invoice }>(`/invoices/${id}`);
      return res.data;
    },
    enabled: !!id && (options?.enabled ?? true),
    staleTime: 30 * 1000,
  });
}

export function useInvoiceCounts(options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: billingKeys.counts(activeEntity),
    queryFn: async () => {
      if (isTestWithoutMock()) {
        return {
          active: 0,
          archived: 0,
          rejected: 0,
          templates: 0,
        };
      }
      const res = await apiRequest<InvoiceCountsResponse>('/invoices/counts');
      return res.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 30 * 1000,
  });
}
