import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransmittalFormModal } from '../components/TransmittalFormModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';

const WR_1 = '22222222-2222-4222-8222-222222222222';
const CLIENT_1 = '11111111-1111-4111-8111-111111111111';
const TASK_ASSIGNED = '33333333-3333-4333-8333-333333333333';
const TASK_UNASSIGNED = '44444444-4444-4444-8444-444444444444';
const CALLER_USER_ID = 'user-doc-caller';

let client: QueryClient;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useBlockingModalStore.getState().reset();
});

function setupMockFetch(posts: { url: string; body: Record<string, unknown> }[]) {
  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ data }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && /\/transmittals$/.test(url)) {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        return respond({ id: 'tx-created', status: 'Draft', ...body }, 201);
      }
      if (url.includes(`/operations/work-requests/${WR_1}/tasks`)) {
        return respond([
          {
            id: TASK_ASSIGNED,
            workRequestId: WR_1,
            title: 'Assigned Doc Task',
            assigneeId: CALLER_USER_ID,
            assignees: [CALLER_USER_ID],
          },
          {
            id: 'task-assigned-2',
            workRequestId: WR_1,
            title: 'Second Assigned Doc Task',
            assigneeId: CALLER_USER_ID,
            assignees: [CALLER_USER_ID],
          },
          {
            id: TASK_UNASSIGNED,
            workRequestId: WR_1,
            title: 'Unassigned Other Task',
            assigneeId: 'other-emp',
            assignees: ['other-emp'],
          },
        ]);
      }
      if (url.includes('/operations/work-requests')) {
        return respond([
          {
            id: WR_1,
            title: 'Client WR 1',
            client_id: CLIENT_1,
            clientId: CLIENT_1,
            status: 'In Progress',
            entity: 'ATA',
          },
        ]);
      }
      if (url.includes('/clients')) {
        return respond([
          {
            id: CLIENT_1,
            name: 'Acme Test Client',
            entity: 'ATA',
          },
        ]);
      }
      return respond({});
    })
  );
}

function renderModal(props?: Partial<ComponentProps<typeof TransmittalFormModal>>) {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <TransmittalFormModal
        isOpen={true}
        onClose={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
}

describe('Transmittal Task Scoping & Documentation Boundary Preservation', () => {
  it('Documentation user: task dropdown only includes assigned tasks (unassigned excluded)', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        email: 'doc.user@ata-lta.ph',
        name: 'Doc Specialist',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      },
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);

    renderModal({
      prefill: { workRequestId: WR_1, clientId: CLIENT_1 },
    });

    // Wait for task dropdown to load
    await waitFor(() => {
      expect(screen.getByTestId('task-select')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('task-select'));

    await waitFor(() => {
      const assignedOpt = screen.getByRole('option', { name: /^Assigned Doc Task/i });
      expect(assignedOpt).toBeInTheDocument();
      expect(assignedOpt).not.toHaveAttribute('aria-disabled', 'true');
      const unassignedOpt = screen.getByRole('option', { name: /Unassigned Other Task.*Not assigned to you/i });
      expect(unassignedOpt).toBeInTheDocument();
      expect(unassignedOpt).toHaveAttribute('aria-disabled', 'true');
    });
  });

  it('Documentation user: submitting without task selection is blocked with mandatory error', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        email: 'doc.user@ata-lta.ph',
        name: 'Doc Specialist',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      },
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);

    renderModal({
      prefill: { workRequestId: WR_1, clientId: CLIENT_1 },
    });

    // Fill valid document row description
    await waitFor(() => {
      expect(screen.getByTestId('item-description-input-0')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('item-description-input-0'), {
      target: { value: 'BIR Form 1701' },
    });

    // Submit without selecting a task (WR has multiple tasks, neither auto-selected)
    fireEvent.click(screen.getByTestId('submit-transmittal-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('task-error-message')).toHaveTextContent(
        /A valid linked task is required/i
      );
    });

    expect(posts).toHaveLength(0);
  });

  it('Documentation user: unassigned prefilled task is rejected on submit with actionable error', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        email: 'doc.user@ata-lta.ph',
        name: 'Doc Specialist',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      },
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);

    renderModal({
      prefill: { workRequestId: WR_1, clientId: CLIENT_1, taskId: TASK_UNASSIGNED },
    });

    // Fill valid document row description
    await waitFor(() => {
      expect(screen.getByTestId('item-description-input-0')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('item-description-input-0'), {
      target: { value: 'SEC GIS 2026' },
    });

    // Submit with unassigned prefill
    fireEvent.click(screen.getByTestId('submit-transmittal-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('task-error-message')).toHaveTextContent(
        'You are not assigned to this task'
      );
    });

    expect(posts).toHaveLength(0);
  });

  it('Documentation user: assigned task submits successfully', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        email: 'doc.user@ata-lta.ph',
        name: 'Doc Specialist',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      },
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);

    renderModal({
      prefill: { workRequestId: WR_1, clientId: CLIENT_1, taskId: TASK_ASSIGNED },
    });

    await waitFor(() => {
      expect(screen.getByTestId('item-description-input-0')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('item-description-input-0'), {
      target: { value: 'Original Contract Copy' },
    });

    fireEvent.click(screen.getByTestId('submit-transmittal-btn'));

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });

    expect(posts[0]!.body).toMatchObject({
      clientId: CLIENT_1,
      workRequestId: WR_1,
      linkedTaskId: TASK_ASSIGNED,
    });
  });

  it('Admin bypasses task assignment; non-Admin Manager requires task assignment', async () => {
    // 1. Manager is non-Admin: unassigned tasks are disabled with Not assigned to you
    useSessionStore.getState().setSession({
      user: {
        id: 'manager-user-id',
        email: 'mgr@ata-lta.ph',
        name: 'Operations Manager',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);

    const { unmount } = renderModal({
      prefill: { workRequestId: WR_1, clientId: CLIENT_1 },
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-select')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('task-select'));

    await waitFor(() => {
      const unassignedOpt = screen.getByRole('option', { name: /Unassigned Other Task.*Not assigned to you/i });
      expect(unassignedOpt).toHaveAttribute('aria-disabled', 'true');
    });

    unmount();
    cleanup();

    // 2. Admin can pick any task
    useSessionStore.getState().setSession({
      user: {
        id: 'admin-user-id',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    renderModal({
      prefill: { workRequestId: WR_1, clientId: CLIENT_1 },
    });

    await waitFor(() => {
      expect(screen.getByTestId('task-select')).not.toBeDisabled();
    });

    fireEvent.click(screen.getByTestId('task-select'));

    await waitFor(() => {
      const opt = screen.getByRole('option', { name: /Unassigned Other Task/i });
      expect(opt).not.toHaveAttribute('aria-disabled', 'true');
      expect(opt.textContent).not.toContain('Not assigned to you');
    });
  });
});
