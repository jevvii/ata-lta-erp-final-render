import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import OperationsPage from '@/routes/operations';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArchiveConfirmModal } from '../components/ArchiveConfirmModal';
import { OperationsArchiveTab } from '../components/OperationsArchiveTab';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { WorkRequest } from '../api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const mockArchivedRequests: WorkRequest[] = [
  {
    id: 'wr-arch-1',
    title: 'Completed SEC Filing 2024',
    description: null,
    clientId: null,
    entity: 'ATA',
    status: 'Completed',
    phase: 'completion',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'Normal',
    requestedBy: null,
    assignedTo: null,
    coAssignees: [],
    dueDate: null,
    archived: true,
    version: 3,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'wr-arch-2',
    title: 'Cancelled Audit Engagement',
    description: null,
    clientId: null,
    entity: 'LTA',
    status: 'Cancelled',
    phase: 'pre_processing',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'High',
    requestedBy: null,
    assignedTo: null,
    coAssignees: [],
    dueDate: null,
    archived: true,
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

describe('Archive, Cancel, and Restore Blocking Flow', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin Boss',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockArchivedRequests }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders ArchiveConfirmModal for archive action and triggers blocking action', async () => {
    const { wrapper } = createHarness();
    const onClose = vi.fn();

    render(
      <ArchiveConfirmModal
        isOpen={true}
        actionType="archive"
        workRequest={mockArchivedRequests[0] || null}
        onClose={onClose}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('archive-confirm-modal')).toBeInTheDocument();
    expect(screen.getAllByText('Archive Work Request').length).toBeGreaterThan(0);

    const confirmBtn = screen.getByTestId('archive-confirm-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(useBlockingModalStore.getState().title).toBe('Archiving Work Request');
    });
  });

  it('renders ArchiveConfirmModal for cancel action and captures cancellation note', async () => {
    const { wrapper } = createHarness();
    const onClose = vi.fn();

    render(
      <ArchiveConfirmModal
        isOpen={true}
        actionType="cancel"
        workRequest={mockArchivedRequests[1] || null}
        onClose={onClose}
      />,
      { wrapper }
    );

    expect(screen.getAllByText('Cancel Work Request').length).toBeGreaterThan(0);
    expect(screen.getByTestId('cancel-reason-input')).toBeInTheDocument();

    const textarea = screen.getByTestId('cancel-reason-input');
    fireEvent.change(textarea, { target: { value: 'Client discontinued engagement' } });

    const confirmBtn = screen.getByTestId('archive-confirm-btn');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(useBlockingModalStore.getState().title).toBe('Cancelling Work Request');
    });
  });

  it('renders OperationsArchiveTab with categories and restore actions', async () => {
    const { wrapper } = createHarness();
    render(<OperationsArchiveTab />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('operations-archive-tab')).toBeInTheDocument();
      expect(screen.getByText('Completed SEC Filing 2024')).toBeInTheDocument();
      expect(screen.getByText('Cancelled Audit Engagement')).toBeInTheDocument();
    });

    // Filter by Accomplished
    const compBtn = screen.getByTestId('archive-cat-completed');
    fireEvent.click(compBtn);

    expect(screen.getByText('Completed SEC Filing 2024')).toBeInTheDocument();
    expect(screen.queryByText('Cancelled Audit Engagement')).not.toBeInTheDocument();

    // Filter by Cancelled
    const cancBtn = screen.getByTestId('archive-cat-cancelled');
    fireEvent.click(cancBtn);

    expect(screen.getByText('Cancelled Audit Engagement')).toBeInTheDocument();
    expect(screen.queryByText('Completed SEC Filing 2024')).not.toBeInTheDocument();
  });

  it('opens archived work request details from the operations archive route and closes back to the archive', async () => {
    const archived = { ...mockArchivedRequests[0]!, tasks: [] };
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const path = new URL(String(url), 'http://localhost').pathname;
      let data: unknown = [];
      if (path.endsWith(`/work-requests/${archived.id}`)) data = archived;
      else if (path.endsWith('/work-requests')) data = [archived];
      else if (path.endsWith('/counts')) data = { archived: 1, active: 0 };
      else if (path.endsWith('/related')) data = { billingStatements: [], disbursements: [], transmittals: [] };
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data }) } as Response);
    });
    const { wrapper } = createHarness();
    render(
      <MemoryRouter initialEntries={['/operations?tab=archive']}>
        <OperationsPage />
      </MemoryRouter>,
      { wrapper }
    );
    fireEvent.click(await screen.findByTitle('View Details'));
    expect(await screen.findByTestId('wr-side-peek')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('wr-side-peek')).toHaveTextContent(archived.title));
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) => String(url).includes(`/work-requests/${archived.id}`))).toBe(true);
    fireEvent.click(screen.getByTestId('side-peek-close-btn'));
    expect(screen.queryByTestId('wr-side-peek')).not.toBeInTheDocument();
    expect(screen.getByTestId('operations-archive-tab')).toBeVisible();
  });

});
