import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OperationsPage from '@/routes/operations';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { RetainerTemplate } from '../api/types';
import type { TeamMember } from '../api/useTeam';
import type { ClientSummary } from '../api/useClients';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, null, children)
    );

  return { queryClient, wrapper };
}

const mockRetainerTemplates: (RetainerTemplate & { assigned_to?: string; client_name?: string })[] = [
  {
    id: 'tpl-ret-1',
    entity: 'ATA',
    entity_id: 'ent-ata',
    name: 'Monthly Accounting & Tax Retainer',
    title: 'Monthly Accounting & Tax Retainer',
    description: 'Comprehensive monthly bookkeeping and BIR compliance',
    template_type: 'retainer',
    client_id: 'client-1',
    clientId: 'client-1',
    client_name: 'Acme Advisory Group',
    schedule: 'monthly',
    priority: 'Normal',
    defaultPriority: 'Normal',
    pf_amount: 25000,
    pfAmount: 25000,
    recurrence: 'annual',
    assigned_to: 'u-mgr-1',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    tasks: [
      {
        local_id: 'task_1',
        title: 'Review Books of Accounts',
        phase: 'pre_processing',
        assignees: ['u-staff-1'],
        requiredLinkType: null,
        checklist: [
          {
            id: 'chk-1',
            text: 'Verify Bank Reconciliation',
            completed: true,
            category: 'subtask',
          },
          {
            id: 'chk-2',
            text: 'Collect 2307 Certificates',
            completed: false,
            category: 'document',
            periodYear: 2026,
          },
        ],
      },
      {
        local_id: 'task_2',
        title: 'File BIR Form 2551Q',
        phase: 'processing',
        depends_on: 'task_1',
        assignees: ['u-mgr-1'],
        requiredLinkType: 'Form 2551Q',
      },
    ],
  },
];

const mockClients: ClientSummary[] = [
  {
    id: 'client-1',
    name: 'Acme Advisory Group',
    tin: '111-222-333-000',
    entity: 'ATA',
    status: 'Active',
  },
];

const mockTeam: TeamMember[] = [
  { id: 'u-admin-1', name: 'Alice Admin', email: 'alice@ata-lta.ph', role: 'Admin' },
  { id: 'u-mgr-1', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Manager', departments: ['Operations'] },
  { id: 'u-staff-1', name: 'Juan dela Cruz', email: 'juan@ata-lta.ph', role: 'Staff', departments: ['Operations'] },
];

describe('Retainer Templates Engine & Details Modal Tests', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();

    // Default session: Manager with retainers:use and retainers:edit
    useSessionStore.getState().setSession({
      user: {
        id: 'u-mgr-1',
        email: 'maria@ata-lta.ph',
        name: 'Maria Santos',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['workflow:view', 'workflow:edit', 'retainers:use', 'retainers:edit'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);

      if (u.includes('/operations/templates') && u.includes('type=retainer')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockRetainerTemplates }),
        });
      }

      if (u.includes('/operations/templates')) {
        if (opts?.method === 'DELETE') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: null }),
          });
        }
        if (opts?.method === 'PUT') {
          const body = JSON.parse(opts.body as string);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ data: { ...mockRetainerTemplates[0], ...body } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockRetainerTemplates }),
        });
      }

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockClients }),
        });
      }

      if (u.includes('/users') || u.includes('/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: mockTeam }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });
    });
  });

  it('renders Retainer Templates Directory grid with cards, badges, and action buttons', async () => {
    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByText('Retainer Templates Directory')).toBeInTheDocument();
    expect(screen.getByTestId('create-template-btn')).toBeInTheDocument();
    expect(screen.getByTestId('generate-template-btn')).toBeInTheDocument();

    // Template card
    const card = await screen.findByTestId('template-card-tpl-ret-1');
    expect(card).toBeInTheDocument();
    expect(screen.getByText('Monthly Accounting & Tax Retainer')).toBeInTheDocument();
    expect(screen.getByTestId('edit-template-btn-tpl-ret-1')).toBeInTheDocument();
    expect(screen.getByTestId('template-actions-menu-btn-tpl-ret-1')).toBeInTheDocument();
  });

  it('opens template-detail-modal when clicking Retainer Template card and displays metadata, tasks, checklist', async () => {
    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const card = await screen.findByTestId('template-card-tpl-ret-1');
    fireEvent.click(card);

    const modal = await screen.findByTestId('template-detail-modal');
    expect(modal).toBeInTheDocument();

    // Title and Badges
    expect(within(modal).getByText('Monthly Accounting & Tax Retainer')).toBeInTheDocument();
    expect(within(modal).getByText('Retainer Template')).toBeInTheDocument();
    expect(within(modal).getByText('Normal Priority')).toBeInTheDocument();
    expect(within(modal).getByText('annual recurrence')).toBeInTheDocument();

    // Metadata Grid
    expect(await within(modal).findByText('Acme Advisory Group')).toBeInTheDocument();
    expect(within(modal).getAllByText('Maria Santos').length).toBeGreaterThanOrEqual(1);
    expect(within(modal).getByText('annual (monthly)')).toBeInTheDocument();
    expect(within(modal).getByText('₱25,000.00')).toBeInTheDocument();

    // Description
    expect(
      within(modal).getByText('Comprehensive monthly bookkeeping and BIR compliance')
    ).toBeInTheDocument();

    // Task Blueprints
    expect(within(modal).getByText('Task Blueprints (2)')).toBeInTheDocument();
    expect(within(modal).getAllByText('Review Books of Accounts').length).toBeGreaterThanOrEqual(1);
    expect(within(modal).getByText('File BIR Form 2551Q')).toBeInTheDocument();
    expect(within(modal).getByText('Form 2551Q')).toBeInTheDocument();
    expect(within(modal).getByText('Depends on:')).toBeInTheDocument();

    // Checklist items
    expect(within(modal).getByText('Verify Bank Reconciliation')).toBeInTheDocument();
    expect(within(modal).getByText('Sub-task')).toBeInTheDocument();
    expect(within(modal).getByText('Collect 2307 Certificates')).toBeInTheDocument();
    expect(within(modal).getByText('Doc · 2026')).toBeInTheDocument();

    // Action buttons
    expect(screen.getByTestId('detail-edit-template-btn')).toBeInTheDocument();
    expect(screen.getByTestId('detail-delete-template-btn')).toBeInTheDocument();
    expect(screen.getByTestId('detail-close-template-btn')).toBeInTheDocument();
  });

  it('triggers Edit modal when clicking Edit inside Retainer template-detail-modal', async () => {
    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const card = await screen.findByTestId('template-card-tpl-ret-1');
    fireEvent.click(card);

    expect(await screen.findByTestId('template-detail-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('detail-edit-template-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('template-detail-modal')).not.toBeInTheDocument();
    });

    expect(screen.getByTestId('template-modal-submit-btn')).toHaveTextContent(
      'Save Template Changes'
    );
    expect(screen.getByTestId('template-modal-delete-btn')).toBeInTheDocument();
  });

  it('triggers Delete Confirmation modal and calls DELETE from Retainer template-detail-modal', async () => {
    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const card = await screen.findByTestId('template-card-tpl-ret-1');
    fireEvent.click(card);

    expect(await screen.findByTestId('template-detail-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('detail-delete-template-btn'));

    const confirmModal = await screen.findByTestId('delete-template-confirm-modal');
    expect(confirmModal).toBeInTheDocument();
    expect(screen.getByText('"Monthly Accounting & Tax Retainer"')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('confirm-delete-template-btn'));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const deleteCall = calls.find(
        (c) =>
          String(c[0]).includes('/operations/templates/tpl-ret-1') &&
          c[1]?.method === 'DELETE'
      );
      expect(deleteCall).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('delete-template-confirm-modal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('template-detail-modal')).not.toBeInTheDocument();
    });
  });

  it('triggers Delete Confirmation modal via three-dots menu on Retainer Template card', async () => {
    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const menuBtn = await screen.findByTestId('template-actions-menu-btn-tpl-ret-1');
    fireEvent.click(menuBtn);

    const deleteBtn = await screen.findByTestId('delete-template-btn-tpl-ret-1');
    expect(deleteBtn).toBeInTheDocument();

    fireEvent.click(deleteBtn);

    expect(await screen.findByTestId('delete-template-confirm-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-delete-template-btn'));

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls;
      const deleteCall = calls.find(
        (c) =>
          String(c[0]).includes('/operations/templates/tpl-ret-1') &&
          c[1]?.method === 'DELETE'
      );
      expect(deleteCall).toBeDefined();
    });
  });

  it('hides edit and delete capabilities for users without retainers:edit permission', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-viewer-1',
        email: 'viewer@ata-lta.ph',
        name: 'Vivian Viewer',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'retainers:use'], // NO retainers:edit
      activeEntity: 'ATA',
    });

    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const card = await screen.findByTestId('template-card-tpl-ret-1');
    expect(card).toBeInTheDocument();

    // No edit or three-dots menu on card
    expect(screen.queryByTestId('edit-template-btn-tpl-ret-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-actions-menu-btn-tpl-ret-1')).not.toBeInTheDocument();

    // Click card to open detail modal
    fireEvent.click(card);
    const modal = await screen.findByTestId('template-detail-modal');
    expect(modal).toBeInTheDocument();

    // No edit or delete button inside modal
    expect(screen.queryByTestId('detail-edit-template-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('detail-delete-template-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('detail-close-template-btn')).toBeInTheDocument();
  });
});
