import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OperationsPage from '@/routes/operations';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { RetainerTemplate } from '../api/types';

function createHarness(initialEntries = ['/operations?tab=retainer-templates']) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );

  return { queryClient, wrapper };
}

const mockTemplates: RetainerTemplate[] = [
  {
    id: 'tpl-smoke-1',
    entity_id: 'ent-ata',
    name: 'SMOKE Annual Compliance Retainer',
    description: 'Statutory compliance template for smoke verification',
    client_id: 'c-1',
    schedule: 'annual',
    priority: 'Normal',
    pf_amount: 50000,
    recurrence: 'annual',
    tasks: [
      {
        local_id: 'task_1',
        title: 'Collect Trial Balance',
        phase: 'pre_processing',
      },
      {
        local_id: 'task_2',
        title: 'Reconcile Bank Statements',
        phase: 'processing',
        depends_on_local_id: 'task_1',
      },
    ],
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
  {
    id: 'tpl-adhoc-2',
    entity_id: 'ent-ata',
    name: 'Monthly Advisory Retainer',
    description: 'Ad-hoc consulting',
    client_id: null,
    schedule: 'monthly',
    priority: 'High',
    pf_amount: 20000,
    recurrence: 'none',
    tasks: [
      {
        local_id: 'task_1',
        title: 'Review Tax Inquiries',
        phase: 'pre_processing',
      },
    ],
    created_at: '2026-10-02T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
  },
];

describe('Operations Retainer Templates Tab — Create & Edit Template Integration', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['workflow:view', 'workflow:edit', 'retainers:use', 'retainers:edit'],
      activeEntity: 'ALL',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/templates')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockTemplates }),
        } as Response);
      }
      if (u.includes('/operations/requests/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { pending: 0, approved: 0, rejected: 0 } }),
        } as Response);
      }
      if (u.includes('/operations/work-requests/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { total: 2, active: 2, archived: 0 } }),
        } as Response);
      }
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'c-1', name: 'Acme Philippines Corp', entity: 'ATA' }] }),
        } as Response);
      }
      if (u.includes('/admin/users')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'u-1', name: 'Maria Santos', role: 'Operations', departments: ['Operations'] }],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders "Create Template" button when user possesses retainers:edit permission', async () => {
    const { wrapper } = createHarness();
    render(<OperationsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('create-template-btn')).toBeInTheDocument();
    });

    expect(screen.getByTestId('create-template-btn')).toHaveTextContent('Create Template');
    expect(screen.getByTestId('tab-generate-template-btn')).toBeInTheDocument();
  });

  it('hides "Create Template" and card edit buttons when user lacks retainers:edit', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'user-ops',
        email: 'ops@ata-lta.ph',
        name: 'Ops Specialist',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      // Missing retainers:edit
      permissions: ['workflow:view', 'workflow:edit', 'retainers:use'],
      activeEntity: 'ALL',
    });

    const { wrapper } = createHarness();
    render(<OperationsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('tab-generate-template-btn')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('create-template-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('edit-template-btn-tpl-smoke-1')).not.toBeInTheDocument();
  });

  it('opens RetainerTemplateModal when "Create Template" is clicked', async () => {
    const { wrapper } = createHarness();
    render(<OperationsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('create-template-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('create-template-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('retainer-template-modal')).toBeInTheDocument();
    });

    expect(screen.getByText('New Retainer Template Builder')).toBeInTheDocument();
    expect(screen.getByTestId('template-name-input')).toHaveValue('');
  });

  it('opens RetainerTemplateModal in edit mode when "Edit" on a template card is clicked', async () => {
    const { wrapper } = createHarness();
    render(<OperationsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('edit-template-btn-tpl-smoke-1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('edit-template-btn-tpl-smoke-1'));

    await waitFor(() => {
      expect(screen.getByTestId('retainer-template-modal')).toBeInTheDocument();
    });

    expect(screen.getByText(/Edit Template: SMOKE Annual Compliance Retainer/)).toBeInTheDocument();
    expect(screen.getByTestId('template-name-input')).toHaveValue('SMOKE Annual Compliance Retainer');
  });

  it('renders "Create First Template" button in empty state when templates array is empty', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/templates')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(<OperationsPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('empty-templates-container')).toBeInTheDocument();
    });

    expect(screen.getByTestId('empty-create-template-btn')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('empty-create-template-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('retainer-template-modal')).toBeInTheDocument();
    });

    expect(screen.getByText('New Retainer Template Builder')).toBeInTheDocument();
  });
});
