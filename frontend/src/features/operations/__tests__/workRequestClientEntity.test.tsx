import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { useSessionStore } from '@/lib/session';
import type { WorkRequest } from '../api/types';

const mutations = vi.hoisted(() => ({ createWorkRequest: vi.fn(), updateWorkRequest: vi.fn() }));
vi.mock('../api/useWorkRequests', () => ({ useWorkRequestMutations: () => mutations }));
vi.mock('../api/useTeam', () => ({ useTeam: () => ({ data: [] }) }));
vi.mock('../api/useTasks', () => ({ useTaskMutations: () => ({}) }));
vi.mock('../components/TaskLineItems', () => ({ TaskLineItems: () => null }));
vi.mock('../components/AssignerSelect', () => ({ AssignerSelect: () => null }));
vi.mock('../components/BlockingActionModal', () => ({
  runBlockingAction: ({ apiCall }: { apiCall: () => Promise<unknown> }) => apiCall(),
}));

const clients = [
  { id: 'ata-client', name: 'ATA Client', entity: 'ATA' },
  { id: 'lta-client', name: 'LTA Client', entity: 'LTA' },
];

function renderModal(workRequest?: WorkRequest) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkRequestModal isOpen onClose={vi.fn()} workRequest={workRequest} />
    </QueryClientProvider>
  );
}

async function openClients() {
  fireEvent.keyDown(screen.getByTestId('wr-modal-client-select'), { key: 'ArrowDown' });
  await screen.findByRole('listbox');
}

describe('work request clients follow the operating entity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useSessionStore.setState({
      activeEntity: 'ALL',
      user: { id: 'admin-1', name: 'Admin', role: 'Admin', email: 'admin@example.com' } as any,
    });
    // Return both entities deliberately to verify the UI also filters stale or
    // mixed responses instead of relying only on the scoped request.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: clients }),
    }));
    HTMLElement.prototype.scrollIntoView = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows only ATA clients before selection in global ALL view', async () => {
    renderModal();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/clients?entity=ATA'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Active-Entity': 'ATA' }) })
    ));
    await openClients();
    expect(await screen.findByRole('option', { name: 'ATA Client (ATA)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'LTA Client (LTA)' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— No Client —' })).toBeInTheDocument();
  });

  it('switches to LTA clients and sends the LTA header when the form toggle changes', async () => {
    useSessionStore.setState({ activeEntity: 'ATA' });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'LTA' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/clients?entity=LTA'),
      expect.objectContaining({ headers: expect.objectContaining({ 'X-Active-Entity': 'LTA' }) })
    ));
    await openClients();
    expect(await screen.findByRole('option', { name: 'LTA Client (LTA)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ATA Client (ATA)' })).not.toBeInTheDocument();
    expect(useSessionStore.getState().activeEntity).toBe('ATA');
  });

  it('starts in LTA for an LTA session without querying unauthorized ATA clients', async () => {
    useSessionStore.setState({ activeEntity: 'LTA' });
    renderModal();
    await openClients();
    expect(await screen.findByRole('option', { name: 'LTA Client (LTA)' })).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('entity=ATA'))).toBe(true);
  });

  it('keeps client locking and permits changing entity after selecting No Client', async () => {
    renderModal();
    await openClients();
    fireEvent.click(await screen.findByRole('option', { name: 'ATA Client (ATA)' }));
    expect(screen.getByRole('button', { name: 'LTA' })).toBeDisabled();
    await openClients();
    fireEvent.click(screen.getByRole('option', { name: '— No Client —' }));
    expect(screen.getByRole('button', { name: 'LTA' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'LTA' }));
    await openClients();
    expect(await screen.findByRole('option', { name: 'LTA Client (LTA)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ATA Client (ATA)' })).not.toBeInTheDocument();
  });

  it('uses the edited work request entity even when global entity differs', async () => {
    useSessionStore.setState({ activeEntity: 'ATA' });
    renderModal({
      id: 'wr-lta', title: 'LTA engagement', entity: 'LTA', clientId: 'lta-client',
      status: 'Draft', priority: 'Normal', assignedTo: 'manager', tasks: [], version: 1,
    } as unknown as WorkRequest);
    await openClients();
    expect(await screen.findByRole('option', { name: 'LTA Client (LTA)' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ATA Client (ATA)' })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'ATA' })).toBeDisabled();
  });

  it('blocks a restored draft with an opposite-entity client instead of switching its entity', async () => {
    localStorage.setItem('erp_wr_draft_new', JSON.stringify({
      title: 'Old draft', entity: 'ATA', clientId: 'lta-client', dueDate: '2026-12-31',
      assignedTo: 'manager', tasks: [],
    }));
    renderModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    fireEvent.click(screen.getByTestId('wr-modal-submit-btn'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a client registered under ATA');
    expect(mutations.createWorkRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'LTA' })).toBeEnabled();
  });

  it('allows saving an unchanged existing client absent from the active directory', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ data: [] }),
    } as Response);
    renderModal({
      id: 'wr-ata', title: 'Existing engagement', entity: 'ATA', clientId: 'archived-client',
      status: 'Draft', priority: 'Normal', assignedTo: 'manager', tasks: [], version: 1,
    } as unknown as WorkRequest);
    fireEvent.click(screen.getByTestId('wr-modal-submit-btn'));
    await waitFor(() => expect(mutations.updateWorkRequest).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clientId: 'archived-client', entity: 'ATA' }) })
    ));
  });
});
