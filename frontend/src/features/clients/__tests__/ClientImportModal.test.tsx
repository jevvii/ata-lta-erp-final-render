import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ClientsPage from '@/routes/clients';
import { ClientImportModal } from '../components/ClientImportModal';
import { toast } from '@/components/ui/toast';
import { useSessionStore, type SessionState } from '@/lib/session';

// Enable 'Clients' flag for UI tests
vi.mock('@/lib/flags', () => ({
  isModuleEnabled: () => true,
  ENABLED_MODULES: ['Clients'],
}));

// Isolate session store
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  const { create } = await import('zustand');
  const isolatedStore = create<SessionState>((set) => ({
    user: {
      id: 'u-admin',
      name: 'Admin User',
      email: 'admin@ata-lta.ph',
      role: 'Admin',
      departments: ['Management'],
      entities: ['ATA', 'LTA'],
    },
    permissions: new Set<string>(['clients:view', 'clients:edit', 'users:view']),
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

// Mock toast notifications
vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

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

describe('ClientImportModal Component', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('erp_access_token', 'mock-valid-token');
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/admin/users') || url.includes('/me/team')) {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    activeQueryClients.forEach((qc) => {
      qc.cancelQueries();
      qc.clear();
    });
    activeQueryClients = [];
    vi.restoreAllMocks();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('renders idle state with explanation, template download, and drop zone', () => {
    const { wrapper } = createWrapper();
    render(<ClientImportModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    expect(screen.getByText('Import Clients in Bulk')).toBeInTheDocument();
    expect(screen.getByTestId('download-template-btn')).toBeInTheDocument();
    expect(screen.getByTestId('csv-dropzone')).toBeInTheDocument();
    expect(screen.getByText(/Select a CSV file to import multiple clients at once/i)).toBeInTheDocument();
  });

  it('triggers CSV template download when clicking download button', () => {
    const clickMock = vi.fn();
    const createObjectURLMock = vi.fn().mockReturnValue('blob:test-template-url');
    const revokeObjectURLMock = vi.fn();
    window.URL.createObjectURL = createObjectURLMock;
    window.URL.revokeObjectURL = revokeObjectURLMock;

    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const el = origCreateElement(tagName);
      if (tagName === 'a') {
        el.click = clickMock;
      }
      return el;
    });

    const { wrapper } = createWrapper();
    render(<ClientImportModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.click(screen.getByTestId('download-template-btn'));

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(clickMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test-template-url');
  });

  it('supports keyboard interaction on the drop zone', () => {
    const { wrapper } = createWrapper();
    render(<ClientImportModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    const dropzone = screen.getByTestId('csv-dropzone');
    const fileInput = screen.getByTestId('csv-file-input');
    const clickSpy = vi.spyOn(fileInput, 'click');

    fireEvent.keyDown(dropzone, { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dropzone, { key: ' ' });
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it('shows error state when uploaded CSV has missing required headers', async () => {
    const { wrapper } = createWrapper();
    render(<ClientImportModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    const invalidCsv = 'Name,Entity\nAcme Corp,ATA';
    const file = new File([invalidCsv], 'invalid.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('csv-file-input');

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText('File Validation Error')).toBeInTheDocument();
      expect(screen.getByText(/Required headers missing/i)).toBeInTheDocument();
    });

    // Clicking "Choose Another File" returns to idle drop zone
    fireEvent.click(screen.getByTestId('reselect-file-btn'));
    expect(screen.getByTestId('csv-dropzone')).toBeInTheDocument();
  });

  it('validates rows, displays validation summary, and handles mixed valid/error rows', async () => {
    const { wrapper } = createWrapper();
    render(<ClientImportModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    const csvContent = [
      'Name,TIN,Entity,On Retainer,Retainer\'s Fee,RDO Code,Trade Name,Business Address,Point of Contact',
      'Valid Corp,123-456-789-00001,ATA,no,,,Valid Trade,123 Main St,',
      'Invalid Corp,bad-tin,ATA,yes,,,,Address,', // missing fee, invalid TIN
    ].join('\n');

    const file = new File([csvContent], 'clients.csv', { type: 'text/csv' });
    const fileInput = screen.getByTestId('csv-file-input');

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/1 records valid/i)).toBeInTheDocument();
      expect(screen.getByText(/1 records have errors/i)).toBeInTheDocument();
      expect(screen.getByTestId('validation-errors-list')).toBeInTheDocument();
    });

    expect(screen.getByText(/Row 3 \(Invalid Corp\):/i)).toBeInTheDocument();
    expect(screen.getByText(/TIN must be in format XXX-XXX-XXX-XXXXX/i)).toBeInTheDocument();
    expect(screen.getByText(/Retainer's Fee is required when On Retainer is checked/i)).toBeInTheDocument();

    // Import button shows count of valid records
    expect(screen.getByTestId('start-import-btn')).toHaveTextContent('Import 1 Client');
  });

  it('executes sequential import, reports progress, and surfaces successes and server errors', async () => {
    const validClientResponse = {
      id: 'c-created-1',
      entity: 'ATA',
      name: 'Alpha Corp',
      tin: '123-456-789-00001',
      retainer: false,
      status: 'Active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    global.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/clients') && options?.method === 'POST') {
        const body = JSON.parse((options.body as string) || '{}');
        if (body.name === 'Duplicate Corp') {
          return new Response(
            JSON.stringify({
              title: 'Conflict',
              detail: 'A client with TIN 123-456-789-00002 already exists in this entity',
            }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ data: { ...validClientResponse, name: body.name } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      });
    });

    const onCloseMock = vi.fn();
    const { wrapper } = createWrapper();
    render(<ClientImportModal isOpen={true} onClose={onCloseMock} />, { wrapper });

    const csvContent = [
      'Name,TIN,Entity,On Retainer,Retainer\'s Fee,RDO Code,Trade Name,Business Address,Point of Contact',
      'Alpha Corp,123-456-789-00001,ATA,no,,034,,Address 1,',
      'Duplicate Corp,123-456-789-00002,ATA,no,,034,,Address 2,',
    ].join('\n');

    const file = new File([csvContent], 'test_import.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('csv-file-input'), { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByTestId('start-import-btn')).toBeInTheDocument();
    });

    // Start Import
    fireEvent.click(screen.getByTestId('start-import-btn'));

    // Wait for results
    await waitFor(() => {
      expect(screen.getByText(/Import Results/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/✓ 1 Saved/i)).toBeInTheDocument();
    expect(screen.getByText(/✗ 1 Failed/i)).toBeInTheDocument();

    const resultsList = screen.getByTestId('import-results-list');
    expect(resultsList).toHaveTextContent('Alpha Corp');
    expect(resultsList).toHaveTextContent('Saved');
    expect(resultsList).toHaveTextContent('Duplicate Corp');
    expect(resultsList).toHaveTextContent('A client with TIN 123-456-789-00002 already exists');

    // Clicking Done closes modal and triggers toast
    fireEvent.click(screen.getByTestId('import-done-btn'));
    expect(onCloseMock).toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('1 imported, 1 failed')
    );
  });

  it('sends per-row X-Active-Entity header and displays cross-entity notice for mixed files', async () => {
    useSessionStore.getState().setActiveEntity('ATA');

    const capturedHeaders: Array<Record<string, string>> = [];
    global.fetch = vi.fn().mockImplementation(async (url: string, options?: RequestInit) => {
      if (url.includes('/clients') && options?.method === 'POST') {
        const body = JSON.parse((options.body as string) || '{}');
        const headers = (options.headers as Record<string, string>) || {};
        capturedHeaders.push({ ...headers });

        return new Response(
          JSON.stringify({
            data: {
              id: `c-${body.name}`,
              entity: body.entity,
              name: body.name,
              tin: body.tin,
              retainer: false,
              status: 'Active',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              version: 1,
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      });
    });

    const { wrapper } = createWrapper();
    render(<ClientImportModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    const csvContent = [
      'Name,TIN,Entity,On Retainer,Retainer\'s Fee,RDO Code,Trade Name,Business Address,Point of Contact',
      'ATA Client,123-456-789-00001,ATA,no,,034,,Makati,',
      'LTA Client,987-654-321-00002,LTA,no,,040,,Pasig,',
    ].join('\n');

    const file = new File([csvContent], 'mixed_entities.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('csv-file-input'), { target: { files: [file] } });

    // Informational note appears
    await waitFor(() => {
      expect(screen.getByTestId('cross-entity-note')).toBeInTheDocument();
    });
    expect(screen.getByTestId('cross-entity-note')).toHaveTextContent(
      '1 row will be created under LTA'
    );
    expect(screen.getByTestId('cross-entity-note')).toHaveTextContent(
      'current active entity is ATA'
    );

    // Start import
    fireEvent.click(screen.getByTestId('start-import-btn'));

    await waitFor(() => {
      expect(screen.getByText(/Import Results/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/✓ 2 Saved/i)).toBeInTheDocument();

    // Verify per-row X-Active-Entity header sent to API
    expect(capturedHeaders).toHaveLength(2);
    expect(capturedHeaders[0]!['X-Active-Entity']).toBe('ATA');
    expect(capturedHeaders[1]!['X-Active-Entity']).toBe('LTA');
  });

  describe('Route Gating Integration', () => {
    it('renders the "Import" button when user holds clients:edit permission', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin',
          name: 'Admin User',
          email: 'admin@ata-lta.ph',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['clients:view', 'clients:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createWrapper();
      render(
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>,
        { wrapper }
      );

      expect(screen.getByTestId('import-clients-btn')).toBeInTheDocument();
      expect(screen.getByTestId('new-client-btn')).toBeInTheDocument();

      // Clicking Import opens the import modal
      fireEvent.click(screen.getByTestId('import-clients-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('client-import-modal')).toBeInTheDocument();
      });
    });

    it('hides the "Import" button when user lacks clients:edit permission', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-readonly',
          name: 'Viewer User',
          email: 'viewer@ata-lta.ph',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['clients:view'], // Has view, lacks clients:edit
        activeEntity: 'ATA',
      });

      const { wrapper } = createWrapper();
      render(
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>,
        { wrapper }
      );

      expect(screen.queryByTestId('import-clients-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('new-client-btn')).not.toBeInTheDocument();
    });
  });
});
