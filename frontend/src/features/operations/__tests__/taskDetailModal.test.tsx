import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useSessionStore } from '@/lib/session';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { operationsKeys } from '../api/queryKeys';
import type { Task, WorkRequest } from '../api/types';

// Mock DocumentUploadModal to inspect props passed by TaskDetailModal
const mockDocumentUploadModalProps: Record<string, unknown>[] = [];
vi.mock('@/features/documents/components/DocumentUploadModal', () => ({
  DocumentUploadModal: (props: Record<string, unknown>) => {
    mockDocumentUploadModalProps.push(props);
    return (
      <div data-testid="mock-document-upload-modal">
        <span data-testid="mock-task-id">{String(props.defaultTaskId || '')}</span>
        <span data-testid="mock-wr-id">{String(props.defaultWorkRequestId || '')}</span>
        <button
          type="button"
          data-testid="mock-upload-success-btn"
          onClick={() => {
            if (typeof props.onSuccess === 'function') {
              props.onSuccess({ id: 'doc-uploaded', linked_task_id: props.defaultTaskId });
            }
          }}
        >
          Simulate Upload Success
        </button>
        <button
          type="button"
          data-testid="mock-upload-close-btn"
          onClick={() => {
            if (typeof props.onClose === 'function') {
              props.onClose();
            }
          }}
        >
          Simulate Close
        </button>
      </div>
    );
  },
}));

// Mock useDocuments to provide task-linked document data and spy on refetchDocs
const mockRefetchDocs = vi.fn();
const mockDocsList = [
  {
    id: 'doc-task-linked',
    file_name: 'Audit_Report.pdf',
    original_name: 'Audit Report.pdf',
    fileName: 'Audit Report.pdf',
    originalName: 'Audit Report.pdf',
    category: 'FINANCIAL',
    workRequestId: 'wr-888',
    work_request_id: 'wr-888',
    linkedTaskId: 'task-777',
    linked_task_id: 'task-777',
    status: 'active',
  },
];

vi.mock('../api/useDocuments', () => ({
  useDocuments: () => ({
    data: mockDocsList,
    isLoading: false,
    refetch: mockRefetchDocs,
  }),
}));

const mockTask: Task = {
  id: 'task-777',
  workRequestId: 'wr-888',
  title: 'Audit Execution Task',
  description: 'Perform compliance audit steps',
  status: 'In Progress',
  phase: 'processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  assigneeId: 'user-admin',
  assigneeName: 'Lorein Wong',
  assignees: ['user-admin'],
  taskAssignees: [
    {
      taskId: 'task-777',
      userId: 'user-admin',
      assignedBy: null,
      assignedAt: null,
      userName: 'Lorein Wong',
    },
  ],
  predecessors: [],
  dueDate: '2026-04-15T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

const mockWr: WorkRequest = {
  id: 'wr-888',
  title: 'Corporate Year-End Review',
  description: 'Work request for year-end review',
  entity: 'ATA',
  clientId: 'client-101',
  clientName: 'Acme Philippines Inc.',
  phase: 'processing',
  status: 'In Progress',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  dueDate: '2026-04-30T00:00:00Z',
  requestedBy: 'user-req-1',
  assignedTo: 'user-admin',
  assignedToName: 'Lorein Wong',
  coAssignees: [],
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  tasks: [mockTask],
};

describe('TaskDetailModal Document Linking & Query Invalidation', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    mockDocumentUploadModalProps.length = 0;
    mockRefetchDocs.mockReset();
    vi.clearAllMocks();

    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'lorein@ata-lta.ph',
        name: 'Lorein Wong',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it.each([
    ['user-admin', ['timelog:edit_own'], true],
    ['coworker', ['timelog:edit_own'], false],
    ['coworker', ['timelog:edit_all'], true],
    ['user-admin', [], false],
    ['coworker', ['timelog:*'], true],
  ] as const)('scopes inline actions for logger %s and permissions %j', async (loggerId, grants, visible) => {
    useSessionStore.setState({ permissions: new Set(['workflow:view', 'timelog:view', ...grants]) });
    vi.mocked(global.fetch).mockImplementation(async (url) => new Response(JSON.stringify({
      data: String(url).includes('/time-entries') ? [{ id: 'permission-entry', user_id: loggerId,
        user_name: 'Maria Reyes', user_role: 'Staff', task_id: mockTask.id, entry_date: '2026-09-20',
        duration_minutes: 60, note: 'Full work note', created_at: '2026-09-21T01:30:00Z', updated_at: '2026-09-21T01:30:00Z' }] : [],
    }), { status: 200 }));
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={mockTask} workRequest={mockWr} />, { wrapper });
    const row = await screen.findByTestId('time-entry-item-permission-entry');
    expect(within(row).queryByRole('button', { name: 'Edit' }) !== null).toBe(visible);
    expect(within(row).queryByRole('button', { name: 'Delete' }) !== null).toBe(visible);
  });

  it('keeps a deletion failure visible after the optimistic row is restored', async () => {
    useSessionStore.setState({ permissions: new Set(['workflow:view', 'timelog:view', 'timelog:edit_own']) });
    vi.mocked(global.fetch).mockImplementation(async (url, options) => {
      if (options?.method === 'DELETE') return new Response(JSON.stringify({ title: 'Forbidden', detail: 'Deletion denied.' }), { status: 403 });
      return new Response(JSON.stringify({ data: String(url).includes('/time-entries') ? [{
        id: 'delete-entry', user_id: 'user-admin', task_id: mockTask.id, entry_date: '2026-09-20',
        duration_minutes: 60, note: 'Retained note', created_at: '2026-09-21T01:30:00Z', updated_at: '2026-09-21T01:30:00Z',
      }] : [] }), { status: 200 });
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={mockTask} workRequest={mockWr} />, { wrapper });
    const row = await screen.findByTestId('time-entry-item-delete-entry');
    fireEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirm Delete' }));
    await waitFor(() => expect(screen.getByText('Deletion denied.')).toHaveAttribute('role', 'alert'));
    expect(await screen.findByTestId('time-entry-item-delete-entry')).toHaveTextContent('Retained note');
  });

  it('lets duration clear completely and submit 60 without a leading zero', async () => {
    useSessionStore.setState({ permissions: new Set(['workflow:view', 'timelog:create', 'timelog:view']) });
    const writes: Record<string, unknown>[] = [];
    vi.mocked(global.fetch).mockImplementation(async (_url, options) => {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body));
        writes.push(body);
        return new Response(JSON.stringify({ data: { id: 'new-entry', user_id: 'user-admin',
          ...body, created_at: '2026-10-01T01:00:00Z', updated_at: '2026-10-01T01:00:00Z' } }), { status: 201 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={mockTask} workRequest={mockWr} />, { wrapper });
    fireEvent.click(screen.getByTestId('open-log-time-btn'));
    const input = screen.getByTestId('log-time-minutes-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    expect(input.validity.valueMissing).toBe(true);
    fireEvent.change(input, { target: { value: '60' } });
    expect(input.value).toBe('60');
    expect(input.checkValidity()).toBe(true);
    fireEvent.click(screen.getByTestId('log-time-submit-btn'));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.duration_minutes).toBe(60);
  });

  it('accepts every whole-minute duration and rejects out-of-range or fractional values', () => {
    useSessionStore.setState({ permissions: new Set(['workflow:view', 'timelog:create', 'timelog:view']) });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={mockTask} workRequest={mockWr} />, { wrapper });
    fireEvent.click(screen.getByTestId('open-log-time-btn'));
    const input = screen.getByTestId('log-time-minutes-input') as HTMLInputElement;
    for (const minutes of [1, 15, 30, 56, 60, 61, 120, 1440]) {
      fireEvent.change(input, { target: { value: String(minutes) } });
      expect(input.checkValidity(), `${minutes} minutes`).toBe(true);
    }
    for (const minutes of [0, -1, 1.5, 1441]) {
      fireEvent.change(input, { target: { value: String(minutes) } });
      expect(input.checkValidity(), `${minutes} minutes`).toBe(false);
    }
    fireEvent.click(screen.getByRole('button', { name: '60m' }));
    expect(input.value).toBe('60');
    expect(input.checkValidity()).toBe(true);
  });

  it.each(['taskAssignees', 'task_assignees'] as const)('identifies every co-assignee in the summary using %s names without the team directory', (key) => {
    const task: Task = { ...mockTask, assignees: ['user-admin'], taskAssignees: [],
      [key]: ['co-one', 'co-two'].map((userId, index) => ({ taskId: mockTask.id, userId,
        assignedBy: null, assignedAt: null, userName: ['Twinkle Marquez', 'Alexandra Long Surname'][index] })) };
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={task} workRequest={mockWr} />, { wrapper });
    const summary = screen.getByTestId('task-co-assignees');
    expect(within(summary).getByText('Twinkle Marquez')).toBeInTheDocument();
    expect(within(summary).getByText('Alexandra Long Surname')).toBeInTheDocument();
    expect(within(summary).getAllByRole('listitem')).toHaveLength(2);
    expect(summary).not.toHaveTextContent('Lorein Wong');
    expect(screen.queryByText(/\+2 co-assignees/)).not.toBeInTheDocument();
  });

  it('passes defaultTaskId={task.id} to DocumentUploadModal when opening upload modal from task', async () => {
    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    // Click Upload Document button
    const uploadBtn = screen.getByTestId('task-upload-doc-btn');
    expect(uploadBtn).toBeInTheDocument();
    fireEvent.click(uploadBtn);

    // Verify mock modal is rendered with defaultTaskId
    await waitFor(() => {
      expect(screen.getByTestId('mock-document-upload-modal')).toBeInTheDocument();
    });

    expect(screen.getByTestId('mock-task-id')).toHaveTextContent('task-777');
    expect(screen.getByTestId('mock-wr-id')).toHaveTextContent('wr-888');

    const lastProps = mockDocumentUploadModalProps[mockDocumentUploadModalProps.length - 1];
    expect(lastProps?.defaultTaskId).toBe('task-777');
    expect(lastProps?.defaultWorkRequestId).toBe('wr-888');
    expect(lastProps?.defaultClientId).toBe('client-101');
  });

  it('invalidates task-related queries when DocumentUploadModal is closed', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    fireEvent.click(screen.getByTestId('task-upload-doc-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-upload-close-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-upload-close-btn'));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-777'),
      });
    });
  });

  it('invalidates task-related queries, documents, and refetches docs on upload success', async () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    fireEvent.click(screen.getByTestId('task-upload-doc-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('mock-upload-success-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('mock-upload-success-btn'));

    await waitFor(() => {
      expect(mockRefetchDocs).toHaveBeenCalled();
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.taskRelated('task-777'),
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: operationsKeys.documents(),
      });
    });
  });

  it('renders linked documents filtered to current task', async () => {
    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('linked-doc-item-doc-task-linked')).toBeInTheDocument();
      expect(screen.getByText('Audit Report.pdf')).toBeInTheDocument();
    });
  });

  it('renders editable task type selector when user has workflow:edit and read-only badge otherwise', async () => {
    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    const typeSelect = screen.getByTestId('task-detail-type-select');
    expect(typeSelect).toBeInTheDocument();
    expect(typeSelect).toHaveValue('');

    fireEvent.change(typeSelect, { target: { value: 'billing' } });
    expect(typeSelect).toHaveValue('billing');

    cleanup();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-staff',
        email: 'staff@ata-lta.ph',
        name: 'Staff User',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
    });

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={{ ...mockTask, requiredLinkType: 'documents' }}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    expect(screen.queryByTestId('task-detail-type-select')).toBeNull();
    expect(screen.getByTestId('task-detail-type-badge')).toHaveTextContent('Documents');
  });

  it('preserves checklist metadata in the actual task update request', async () => {
    const item = {
      id: 'a3512c21-578d-4194-82d9-ea56c4b367fe', text: 'Tax certificate', completed: false,
      category: 'document', periodYear: '2025/2026', assigneeId: 'owner-id', assigneeName: 'Filing owner',
      dependsOn: ['prerequisite-a', 'prerequisite-b'], timeLogs: [{ id: 'history', date: '2026-10-01', hours: 1 }],
    };
    let live = { ...mockTask, checklist: [item] };
    const updates: Array<Record<string, unknown>> = [];
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/operations/work-requests/wr-888/tasks/task-777')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          updates.push(body);
          live = { ...live, ...body, version: live.version + 1 };
        }
        return new Response(JSON.stringify({ data: live }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={live} workRequest={mockWr} />, { wrapper });
    const input = screen.getByLabelText('New checklist item');
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: 'Review filing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toMatchObject({ expectedVersion: 1, checklist: [
      { id: item.id, text: item.text, completed: false, category: 'document', periodYear: '2025/2026',
        assigneeId: 'owner-id', assigneeName: 'Filing owner', dependsOn: ['prerequisite-a', 'prerequisite-b'] },
      { text: 'Review filing', category: 'subtask' },
    ] });
    expect((updates[0]?.checklist as Array<Record<string, unknown>>)[0]).not.toHaveProperty('timeLogs');
  });

  it.each([
    ['Admin', true, true], ['Manager', true, true], ['Operations', true, false], ['Operations', false, false],
  ] as const)('separates %s checklist editing from completion (assigned=%s)', async (role, assigned, editor) => {
    const item = { id: 'a3512c21-578d-4194-82d9-ea56c4b367fe', text: 'Company records', category: 'document', completed: false, periodYear: null };
    const userId = assigned ? 'user-admin' : 'unassigned-viewer';
    useSessionStore.getState().setSession({
      user: { id: userId, role, name: 'Checklist user', email: 'worker@example.test', departments: ['Operations'], entities: ['ATA'] },
      permissions: ['workflow:view', 'workflow:edit'], activeEntity: 'ATA',
    });
    let live = { ...mockTask, checklist: [item] };
    const updates: Array<Record<string, unknown>> = [];
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/operations/work-requests/wr-888/tasks/task-777')) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body));
          updates.push(body);
          live = { ...live, checklist: [{ ...item, completed: true }], version: live.version + 1 };
        }
        return new Response(JSON.stringify({ data: live }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={live} workRequest={mockWr} />, { wrapper });
    await screen.findByText('Checklist (0/1)');
    const edit = screen.queryByRole('button', { name: 'Edit checklist item Company records' });
    if (editor) expect(edit).toBeInTheDocument(); else expect(edit).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Document year for Company records')).not.toBeInTheDocument();
    const checkbox = screen.getByRole('checkbox', { name: item.text });
    if (assigned || editor) {
      await waitFor(() => expect(checkbox).toBeEnabled());
      fireEvent.click(checkbox);
      await waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0]).toEqual({ expectedVersion: 1, checklistCompletions: [{ id: item.id, completed: true }] });
      expect(updates[0]).not.toHaveProperty('checklist');
    } else {
      expect(checkbox).toBeDisabled();
      expect(updates).toHaveLength(0);
    }
  });

  it('keeps Mark Completed disabled until the last checklist tick is saved', async () => {
    const item = { id: 'a3512c21-578d-4194-82d9-ea56c4b367fe', text: 'Verify records', category: 'subtask', completed: false };
    let live = { ...mockTask, checklist: [item] };
    let finishSave!: () => void;
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      if (String(input).endsWith('/operations/work-requests/wr-888/tasks/task-777')) {
        if (init?.method === 'PUT') {
          await new Promise<void>((resolve) => { finishSave = resolve; });
          live = { ...live, checklist: [{ ...item, completed: true }], version: 2 };
        }
        return new Response(JSON.stringify({ data: live }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={live} workRequest={mockWr} />, { wrapper });
    const mark = screen.getByRole('button', { name: 'Mark Completed' });
    const checkbox = await screen.findByRole('checkbox', { name: item.text });
    await waitFor(() => expect(checkbox).toBeEnabled());
    expect(mark).toBeDisabled();
    expect(mark).toHaveAttribute('title', 'Check all checklist items first (1 remaining).');
    fireEvent.click(checkbox);
    await waitFor(() => expect(finishSave).toBeTypeOf('function'));
    expect(mark).toBeDisabled();
    finishSave();
    await waitFor(() => expect(mark).toBeEnabled());
    expect(screen.getByRole('checkbox', { name: item.text })).toBeChecked();
  });

  it('allows completing a successfully loaded task with no checklist items', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => new Response(JSON.stringify({
      data: String(input).endsWith('/operations/work-requests/wr-888/tasks/task-777') ? { ...mockTask, checklist: [] } : [],
    }), { status: 200 }));
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={mockTask} workRequest={mockWr} />, { wrapper });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Completed' })).toBeEnabled());
  });

  it('keeps Mark Completed disabled after a failed final checklist tick', async () => {
    const live = { ...mockTask, checklist: [{ id: 'a3512c21-578d-4194-82d9-ea56c4b367fe', text: 'Verify records', completed: false }] };
    vi.mocked(global.fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ title: 'Save failed', detail: 'Unable to save checklist' }), { status: 500 });
      return new Response(JSON.stringify({ data: String(input).endsWith('/operations/work-requests/wr-888/tasks/task-777') ? live : [] }), { status: 200 });
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={live} workRequest={mockWr} />, { wrapper });
    const checkbox = await screen.findByRole('checkbox', { name: 'Verify records' });
    await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Mark Completed' })).toBeDisabled();
    expect(checkbox).not.toBeChecked();
  });

  it('shows a failed checklist read and prevents adding against fallback task data', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => {
      if (String(input).endsWith('/operations/work-requests/wr-888/tasks/task-777')) {
        return new Response(JSON.stringify({ title: 'Database Error', detail: 'Unable to load task checklist' }), { status: 500 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={mockTask} workRequest={mockWr} />, { wrapper });
    expect(await screen.findByText('Unable to load checklist. Retry before making changes.')).toBeInTheDocument();
    expect(screen.getByLabelText('New checklist item')).toBeDisabled();
    expect(screen.queryByText('No checklist items yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark Completed' })).toBeDisabled();
    expect(vi.mocked(global.fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });

  it('locks task actions when task phase does not match active work request phase and unlocks when rerouted back', async () => {
    vi.mocked(global.fetch).mockImplementation(async (input) => new Response(JSON.stringify({
      data: String(input).endsWith('/operations/work-requests/wr-888/tasks/task-777')
        ? { ...mockTask, phase: 'pre_processing', checklist: [] } : [],
    }), { status: 200 }));
    // 1. Task is in pre_processing, but WR has moved to processing -> locked
    const { rerender } = render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={{ ...mockTask, phase: 'pre_processing', qaStatus: 'none' }}
        workRequest={{ ...mockWr, phase: 'processing' }}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('phase-locked-banner')).toBeInTheDocument();
    expect(screen.getByText('Phase Completed (Locked)')).toBeInTheDocument();
    expect(screen.getByTestId('task-toggle-status-btn')).toBeDisabled();
    expect(screen.getByTestId('task-upload-doc-btn')).toBeDisabled();

    // 2. WR is in quality_assurance -> task in pre_processing is still locked and shows QA: Under Review
    rerender(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={{ ...mockTask, phase: 'pre_processing', qaStatus: 'none' }}
        workRequest={{ ...mockWr, phase: 'quality_assurance' }}
      />
    );
    expect(screen.getByTestId('phase-locked-banner')).toBeInTheDocument();
    expect(screen.getByText('QA: Under Review')).toBeInTheDocument();
    expect(screen.getByTestId('task-toggle-status-btn')).toBeDisabled();
    expect(screen.getByTestId('task-upload-doc-btn')).toBeDisabled();

    // 3. Admin reroutes WR back to pre_processing -> task unlocks
    rerender(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={{ ...mockTask, phase: 'pre_processing', qaStatus: 'none' }}
        workRequest={{ ...mockWr, phase: 'pre_processing' }}
      />
    );
    expect(screen.queryByTestId('phase-locked-banner')).toBeNull();
    expect(screen.getByText('Active Phase')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('task-toggle-status-btn')).not.toBeDisabled());
    expect(screen.getByTestId('task-upload-doc-btn')).not.toBeDisabled();
  });
});
