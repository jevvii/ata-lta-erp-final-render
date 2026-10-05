import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ClientsPage from '@/routes/clients';
import { useSessionStore, type SessionState } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Client } from '../api/types';

// Isolate session store to prevent cross-suite concurrency leaks
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  const { create } = await import('zustand');
  const isolatedStore = create<SessionState>((set) => ({
    user: null,
    permissions: new Set<string>(),
    activeEntity: 'ATA',
    unreadCount: 0,
    isAuthenticated: true,
    isLoading: false,

    setSession: ({ user, permissions, activeEntity, unreadCount }) => {
      const permSet = permissions instanceof Set ? permissions : new Set(permissions);
      set({
        user,
        permissions: permSet,
        activeEntity: activeEntity || 'ATA',
        unreadCount: unreadCount ?? 0,
        isAuthenticated: true,
        isLoading: false,
      });
    },
    setActiveEntity: (entity) => set({ activeEntity: entity }),
    setUnreadCount: (count) => set({ unreadCount: count }),
    clearSession: () => set({
      user: null,
      permissions: new Set<string>(),
      activeEntity: null,
      unreadCount: 0,
      isAuthenticated: false,
      isLoading: false,
    }),
    setLoading: (isLoading) => set({ isLoading }),
  }));

  return {
    ...actual,
    useSessionStore: isolatedStore,
  };
});

// Enable 'Clients' flag for UI tests
vi.mock('@/lib/flags', () => ({
  isModuleEnabled: () => true,
  ENABLED_MODULES: ['Clients'],
}));

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
    contactDetails: [{ type: 'email', value: 'contact@megaworld.com', label: 'Primary' }],
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
    contactDetails: [{ type: 'phone', value: '09171234567', label: 'Mobile' }],
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
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(MemoryRouter, { initialEntries: ['/clients'] }, children)
      ),
  };
}

describe('Clients UI Components & RBAC Integration', () => {
  const originalFetch = global.fetch;

  const setAdminSession = () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
        entities: ['ATA'],
      },
      permissions: ['clients:view', 'clients:edit'],
      activeEntity: 'ATA',
    });
  };

  const setStaffSession = () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-staff-1',
        email: 'staff@ata-lta.ph',
        name: 'Operations Staff',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['clients:view'], // Has view, but NOT clients:edit
      activeEntity: 'ATA',
    });
  };

  const setUnprivilegedSession = () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-external-1',
        email: 'guest@ata-lta.ph',
        name: 'Guest User',
        role: 'Guest',
        departments: [],
        entities: ['ATA'],
      },
      permissions: [], // No permissions
      activeEntity: 'ATA',
    });
  };

  const createDefaultMockFetch = () =>
    vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/clients/counts')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: { active: 2, archived: 1 } }),
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
    global.fetch = createDefaultMockFetch();
    setAdminSession();
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

  describe('RBAC Gating & Route Protection', () => {
    it('renders <Forbidden /> when user lacks clients:view permission', () => {
      setUnprivilegedSession();
      const { wrapper } = createWrapper();
      render(<ClientsPage />, { wrapper });

      expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
      expect(screen.getByText('Access Forbidden')).toBeInTheDocument();
      expect(screen.queryByTestId('clients-page')).not.toBeInTheDocument();
    });

    it('renders client directory for Staff with clients:view, but hides create, edit, and archive buttons', async () => {
      setStaffSession();
      const { wrapper } = createWrapper();
      render(<ClientsPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('client-name-c-101')).toBeInTheDocument();
      });

      // Staff CAN view the client row and click view details
      expect(screen.getByTestId('view-client-btn-c-101')).toBeInTheDocument();

      // Staff CANNOT see New Client button, Edit button, or Archive button
      expect(screen.queryByTestId('new-client-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('edit-client-btn-c-101')).not.toBeInTheDocument();
      expect(screen.queryByTestId('archive-client-btn-c-101')).not.toBeInTheDocument();
    });

    it('displays New Client, Edit, and Archive buttons for Admin with clients:edit', async () => {
      setAdminSession();
      const { wrapper } = createWrapper();
      render(<ClientsPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('client-name-c-101')).toBeInTheDocument();
      });

      // Admin CAN see New Client, Edit, and Archive
      expect(screen.getByTestId('new-client-btn')).toBeInTheDocument();
      expect(screen.getByTestId('edit-client-btn-c-101')).toBeInTheDocument();
      expect(screen.getByTestId('archive-client-btn-c-101')).toBeInTheDocument();
    });
  });

  describe('Directory Features & Modals', () => {
    it('opens ClientDetailModal on clicking view button', async () => {
      const { wrapper } = createWrapper();
      render(<ClientsPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('view-client-btn-c-101')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('view-client-btn-c-101'));

      await waitFor(() => {
        expect(screen.getByTestId('client-detail-modal')).toBeInTheDocument();
      });

      expect(screen.getByTestId('client-detail-name')).toHaveTextContent('Megaworld Prime Corp');
      expect(screen.getByTestId('client-detail-tin')).toHaveTextContent('111-222-333-000');
      expect(screen.getByTestId('client-detail-rdo')).toHaveTextContent('RDO 044');
      expect(screen.getByTestId('client-detail-retainer-badge')).toBeInTheDocument();
    });

    it('opens ClientModal on clicking New Client and validates required fields', async () => {
      const { wrapper } = createWrapper();
      render(<ClientsPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('new-client-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('new-client-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('client-modal')).toBeInTheDocument();
      });

      // Try empty submission -> validation triggers
      const submitBtn = screen.getByTestId('client-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('error-client-name')).toBeInTheDocument();
        expect(screen.getByTestId('error-client-tin')).toBeInTheDocument();
      });
    });

    it('submits valid New Client and calls create API', async () => {
      let createdData: unknown = null;
      const defaultMock = createDefaultMockFetch();
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/clients') && init?.method === 'POST') {
          createdData = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: 'c-new',
                entity: 'ATA',
                name: 'SM Prime Holdings',
                tin: '999-888-777-000',
                status: 'Active',
                retainer: false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                version: 1,
              },
            }),
          };
        }
        return defaultMock(url);
      });

      const { wrapper } = createWrapper();
      render(<ClientsPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('new-client-btn')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('new-client-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('client-input-name')).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId('client-input-name'), {
        target: { value: 'SM Prime Holdings' },
      });
      fireEvent.change(screen.getByTestId('client-input-tin'), {
        target: { value: '999-888-777-000' },
      });

      fireEvent.click(screen.getByTestId('client-submit-btn'));

      await waitFor(() => {
        expect(createdData).toEqual(
          expect.objectContaining({
            name: 'SM Prime Holdings',
            tin: '999-888-777-000',
            entity: 'ATA',
          })
        );
      });
    });
  });
});
