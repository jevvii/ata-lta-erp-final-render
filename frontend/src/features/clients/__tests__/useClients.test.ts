import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useClientsList,
  useClientCounts,
  useClientDetail,
  useCreateClient,
  useUpdateClient,
  useArchiveClient,
  useUnarchiveClient,
} from '../api/useClients';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Client } from '../api/types';

const mockClients: Client[] = [
  {
    id: 'c-101',
    entity: 'ATA',
    name: 'Megaworld Prime Corp',
    tin: '111-222-333-000',
    rdoCode: '044',
    address: 'Uptown Mall, Taguig',
    tradeName: 'Megaworld',
    contactUserId: null,
    contactPerson: 'Andrew Tan',
    retainer: true,
    retainerFee: 50000,
    status: 'Active',
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    contactDetails: [{ type: 'email', value: 'contact@megaworld.com' }],
    relatedCompanies: [],
  },
  {
    id: 'c-102',
    entity: 'ATA',
    name: 'Ayala Land Inc.',
    tin: '444-555-666-000',
    rdoCode: '047',
    address: 'Makati Ave, Makati City',
    tradeName: 'Ayala',
    contactUserId: null,
    contactPerson: 'Jaime Zobel',
    retainer: false,
    retainerFee: null,
    status: 'Active',
    createdBy: 'u-1',
    updatedBy: 'u-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
    contactDetails: [{ type: 'phone', value: '09171234567' }],
    relatedCompanies: [],
  },
];

let activeQueryClients: QueryClient[] = [];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  activeQueryClients.push(queryClient);

  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
}

describe('Clients Module Query & Mutation Hooks', () => {
  const originalFetch = global.fetch;

  const defaultMockFetch = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/clients/counts')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { active: 2, archived: 1 } }),
      };
    }
    if (url.includes('/clients/c-101')) {
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: mockClients[0] }),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        data: mockClients,
        meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
      }),
    };
  });

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/clients/counts')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: { active: 2, archived: 1 } }),
        };
      }
      if (url.includes('/clients/c-101')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockClients[0] }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: mockClients,
          meta: { total: 2, page: 1, limit: 50, totalPages: 1 },
        }),
      };
    });
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    activeQueryClients.forEach((qc) => {
      qc.cancelQueries();
      qc.clear();
    });
    activeQueryClients = [];
    vi.restoreAllMocks();
    useBlockingModalStore.getState().reset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('fetches clients list successfully with filters', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useClientsList({ search: 'Mega' }), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.data).toHaveLength(2);
    expect(result.current.data?.data[0]?.name).toBe('Megaworld Prime Corp');
  });

  it('fetches client counts breakdown', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useClientCounts(), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toEqual({ active: 2, archived: 1 });
  });

  it('fetches single client detail by ID', async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useClientDetail('c-101'), { wrapper });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data?.id).toBe('c-101');
    expect(result.current.data?.retainer).toBe(true);
  });

  it('executes create client with blocking modal workflow', async () => {
    let createdPayload: unknown = null;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/clients') && init?.method === 'POST') {
        createdPayload = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              id: 'c-new',
              entity: 'ATA',
              name: 'Robinsons Land',
              tin: '777-888-999-000',
              status: 'Active',
              retainer: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1,
            },
          }),
        };
      }
      return defaultMockFetch(url);
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateClient(), { wrapper });

    let clientResult: Client | null = null;
    await act(async () => {
      clientResult = await result.current.createWithBlocking({
        name: 'Robinsons Land',
        tin: '777-888-999-000',
        entity: 'ATA',
      });
    });

    expect(clientResult).not.toBeNull();
    expect((clientResult as unknown as Client).id).toBe('c-new');
    expect(createdPayload).toEqual(
      expect.objectContaining({
        name: 'Robinsons Land',
        tin: '777-888-999-000',
        entity: 'ATA',
      })
    );
  });

  it('executes update client with OCC expectedVersion', async () => {
    let updatePayload: unknown = null;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/clients/c-101') && init?.method === 'PUT') {
        updatePayload = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              ...mockClients[0],
              address: 'Updated Address',
              version: 2,
            },
          }),
        };
      }
      return defaultMockFetch(url);
    });

    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateClient(), { wrapper });

    await act(async () => {
      await result.current.updateWithBlocking('c-101', {
        address: 'Updated Address',
        expectedVersion: 1,
      });
    });

    expect(updatePayload).toEqual(
      expect.objectContaining({
        address: 'Updated Address',
        expectedVersion: 1,
      })
    );
  });

  it('executes archive and restore workflows', async () => {
    let archived = false;
    let restored = false;

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/clients/c-101/archive')) {
        archived = true;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: { ...mockClients[0], status: 'Archived', deletedAt: new Date().toISOString() },
          }),
        };
      }
      if (url.includes('/clients/c-101/unarchive')) {
        restored = true;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: { ...mockClients[0], status: 'Active', deletedAt: null },
          }),
        };
      }
      return defaultMockFetch(url);
    });

    const { wrapper } = createWrapper();
    const { result: archiveHook } = renderHook(() => useArchiveClient(), { wrapper });
    const { result: unarchiveHook } = renderHook(() => useUnarchiveClient(), { wrapper });

    await act(async () => {
      await archiveHook.current.archiveWithBlocking('c-101', 'Megaworld');
    });
    expect(archived).toBe(true);

    await act(async () => {
      await unarchiveHook.current.unarchiveWithBlocking('c-101', 'Megaworld');
    });
    expect(restored).toBe(true);
  });
});
