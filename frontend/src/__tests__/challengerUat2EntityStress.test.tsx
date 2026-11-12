import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { apiRequest } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { useDocuments } from '@/features/operations/api/useDocuments';
import { useAssignedTasks } from '@/features/dashboard/api/useAssignedTasks';
import { useClients } from '@/features/operations/api/useClients';
import { useClientsList } from '@/features/clients/api/useClients';
import { useInvoices } from '@/features/billing/api/useInvoices';
import { useDisbursementsList } from '@/features/disbursements/api/useDisbursements';
import { useTransmittalsList } from '@/features/transmittals/api/useTransmittals';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';

describe('Adversarial Verification Suite: Parcel 1 W2-ENTITY (Branch fix/uat2-entity)', () => {
  let queryClient: QueryClient;
  let lastRequestUrl: string;
  let lastRequestHeaders: Record<string, string>;

  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.getState().clearSession();

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      lastRequestUrl = url;
      lastRequestHeaders = { ...(init?.headers as Record<string, string>) };
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      };
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  // ==========================================================================
  // Section 1: apiRequest Permutations and Header Resolution
  // ==========================================================================
  describe('1. apiRequest Entity Header Resolution Matrix', () => {
    const sessionEntities = ['ALL', 'ATA', 'LTA', null, undefined] as const;

    it.each(sessionEntities)(
      'resolves outgoing headers correctly when activeEntity is %s without custom headers',
      async (entity) => {
        useSessionStore.setState({ activeEntity: (entity ?? null) as string | null });
        await apiRequest('/v1/test');

        if (entity === 'ATA' || entity === 'LTA') {
          expect(lastRequestHeaders['X-Active-Entity']).toBe(entity);
        } else {
          expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
          expect(lastRequestHeaders['x-active-entity']).toBeUndefined();
        }
      }
    );

    it('strips caller-supplied X-Active-Entity: "ALL" when activeEntity is "ALL"', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      await apiRequest('/v1/test', { headers: { 'X-Active-Entity': 'ALL' } });
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('strips caller-supplied lowercase x-active-entity: "ALL" when activeEntity is "ALL"', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      await apiRequest('/v1/test', { headers: { 'x-active-entity': 'ALL' } });
      expect(lastRequestHeaders['x-active-entity']).toBeUndefined();
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('preserves caller-supplied X-Active-Entity override when activeEntity is "ATA"', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      await apiRequest('/v1/test', { headers: { 'X-Active-Entity': 'LTA' } });
      expect(lastRequestHeaders['X-Active-Entity']).toBe('LTA');
    });

    it('preserves caller-supplied x-active-entity override when activeEntity is "ATA"', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      await apiRequest('/v1/test', { headers: { 'x-active-entity': 'LTA' } });
      expect(lastRequestHeaders['x-active-entity']).toBe('LTA');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('strips caller-supplied X-Active-Entity: "ALL" even when activeEntity in store is "ATA"', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      await apiRequest('/v1/test', { headers: { 'X-Active-Entity': 'ALL' } });
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('strips caller-supplied x-active-entity: "ALL" even when activeEntity in store is "ATA"', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      await apiRequest('/v1/test', { headers: { 'x-active-entity': 'ALL' } });
      expect(lastRequestHeaders['x-active-entity']).toBeUndefined();
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('strips uppercase X-ACTIVE-ENTITY when ALL and avoids duplicate when ATA', async () => {
      // 1. Omission of ALL regardless of uppercase casing:
      useSessionStore.setState({ activeEntity: 'ALL' });
      await apiRequest('/v1/test', { headers: { 'X-ACTIVE-ENTITY': 'ALL' } });
      expect(lastRequestHeaders['X-ACTIVE-ENTITY']).toBeUndefined();
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
      expect(lastRequestHeaders['x-active-entity']).toBeUndefined();

      // 2. Preserves uppercase custom header without injecting duplicate header:
      useSessionStore.setState({ activeEntity: 'ATA' });
      await apiRequest('/v1/test', { headers: { 'X-ACTIVE-ENTITY': 'LTA' } });
      expect(lastRequestHeaders['X-ACTIVE-ENTITY']).toBe('LTA');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Section 2: useDocuments Hook Stress-Testing
  // ==========================================================================
  describe('2. useDocuments Hook (Operations DMS)', () => {
    it('incorporates activeEntity into queryKey for cache differentiation', () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      const { result: resA } = renderHook(() => useDocuments({ workRequestId: 'wr-1' }), { wrapper });
      expect(resA.current.isFetching).toBe(true);

      // Verify queryKey contains activeEntity
      const queryKeyA = queryClient.getQueryCache().getAll()[0]?.queryKey;
      expect(queryKeyA).toEqual(['documents', 'list', { workRequestId: 'wr-1' }, 'ATA']);
    });

    it('updates queryKey when activeEntity switches from ATA to ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      const { rerender } = renderHook(() => useDocuments(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

      // Switch entity to ALL
      useSessionStore.setState({ activeEntity: 'ALL' });
      rerender();

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));

      const queryKeys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(queryKeys).toContainEqual(['documents', 'list', {}, 'ATA']);
      expect(queryKeys).toContainEqual(['documents', 'list', {}, 'ALL']);
    });

    it('never appends ?entity=ALL or any entity query parameter to URL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      renderHook(() => useDocuments({ workRequestId: 'wr-123' }), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).toContain('/documents?workRequestId=wr-123');
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Section 3: useAssignedTasks Hook Stress-Testing
  // ==========================================================================
  describe('3. useAssignedTasks Hook (Dashboard)', () => {
    it('incorporates activeEntity into queryKey', () => {
      useSessionStore.setState({
        user: { id: 'user-42', email: 'test@example.com', name: 'Tester', role: 'Staff', departments: [], entities: ['ATA', 'LTA'] },
        activeEntity: 'ATA',
      });

      renderHook(() => useAssignedTasks(), { wrapper });

      const queryKey = queryClient.getQueryCache().getAll()[0]?.queryKey;
      expect(queryKey).toEqual(['assigned-tasks', 'user-42', 'ATA']);
    });

    it('triggers refetch and generates separate cache entry when activeEntity switches to ALL', async () => {
      useSessionStore.setState({
        user: { id: 'user-42', email: 'test@example.com', name: 'Tester', role: 'Staff', departments: [], entities: ['ATA', 'LTA'] },
        activeEntity: 'ATA',
      });

      const { rerender } = renderHook(() => useAssignedTasks(), { wrapper });
      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

      // Switch to ALL
      useSessionStore.setState({ activeEntity: 'ALL' });
      rerender();

      await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
      const queryKeys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(queryKeys).toContainEqual(['assigned-tasks', 'user-42', 'ATA']);
      expect(queryKeys).toContainEqual(['assigned-tasks', 'user-42', 'ALL']);
    });

    it('never leaks entity parameter in URL for useAssignedTasks', async () => {
      useSessionStore.setState({
        user: { id: 'user-42', email: 'test@example.com', name: 'Tester', role: 'Staff', departments: [], entities: ['ATA', 'LTA'] },
        activeEntity: 'ALL',
      });

      renderHook(() => useAssignedTasks(), { wrapper });
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());

      expect(lastRequestUrl).toContain('/operations/work-requests?archived=false&limit=100');
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Section 4: useClients Hook Stress-Testing (Operations)
  // ==========================================================================
  describe('4. useClients Hook (Operations Module)', () => {
    it('omits entity search parameter when activeEntity is ALL and filters is undefined', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      renderHook(() => useClients(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).toBe('https://ata-lta-erp-api-staging.onrender.com/v1/clients?limit=all');
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('appends entity search parameter when activeEntity is ATA', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      renderHook(() => useClients(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).toMatch(/\/clients\?(?:[^#]*&)?entity=ATA(?:&|$)/);
      expect(lastRequestHeaders['X-Active-Entity']).toBe('ATA');
    });

    it('allows explicit filter to override activeEntity when valid entity is passed', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      renderHook(() => useClients({ entity: 'LTA' }), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).toMatch(/\/clients\?(?:[^#]*&)?entity=LTA(?:&|$)/);
    });

    it('differentiates query cache keys between ALL and ATA', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      const { rerender } = renderHook(() => useClients(), { wrapper });

      const keyAll = queryClient.getQueryCache().getAll()[0]?.queryKey;
      expect(keyAll).toEqual(['clients', 'list', undefined, undefined, undefined]);

      useSessionStore.setState({ activeEntity: 'ATA' });
      rerender();

      const queryKeys = queryClient.getQueryCache().getAll().map((q) => q.queryKey);
      expect(queryKeys).toContainEqual(['clients', 'list', undefined, undefined, undefined]);
      expect(queryKeys).toContainEqual(['clients', 'list', 'ATA', undefined, undefined]);
    });

    it('omits entity search parameter and header when filters.entity is "ALL" even when activeEntity in store is ATA', async () => {
      useSessionStore.setState({ activeEntity: 'ATA' });
      renderHook(() => useClients({ entity: 'ALL' }), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).toBe('https://ata-lta-erp-api-staging.onrender.com/v1/clients?limit=all');
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });
  });

  // ==========================================================================
  // Section 5: Cross-Module Verification Matrix
  // ==========================================================================
  describe('5. Cross-Module List Hooks Compliance', () => {
    it('useClientsList (Clients module) omits entity query param and header when activeEntity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      renderHook(() => useClientsList(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('useInvoices (Billing module) omits entity query param and header when activeEntity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      renderHook(() => useInvoices(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('useDisbursementsList (Disbursements module) omits entity query param and header when activeEntity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      renderHook(() => useDisbursementsList(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('useTransmittalsList (Transmittals module) omits entity query param and header when activeEntity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      renderHook(() => useTransmittalsList(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });

    it('useWorkRequests (Operations module) omits entity query param and header when activeEntity is ALL', async () => {
      useSessionStore.setState({ activeEntity: 'ALL' });
      renderHook(() => useWorkRequests(), { wrapper });

      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      expect(lastRequestUrl).not.toContain('entity=');
      expect(lastRequestHeaders['X-Active-Entity']).toBeUndefined();
    });
  });
});
