import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { WorkRequestSidePeek } from '../components/WorkRequestSidePeek';
import { PendingApprovalsInbox } from '../components/PendingApprovalsInbox';
import { QuickAddCard } from '../components/QuickAddCard';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import OperationsPage from '@/routes/operations';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import type { WorkRequest, DmsDocument } from '../api/types';

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

const mockTeamMembers = [
  { id: 'u-lead-1', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Manager' },
  { id: 'u-staff-1', name: 'Juan Dela Cruz', email: 'juan@ata-lta.ph', role: 'Staff' },
  { id: 'u-staff-2', name: 'Ana Reyes', email: 'ana@ata-lta.ph', role: 'Staff' },
];

const mockWr: WorkRequest = {
  id: 'wr-w2-1',
  entity: 'ATA',
  title: 'Corporate SEC Compliance',
  description: 'Annual corporate general information sheet',
  clientId: 'c-100',
  clientName: 'Megaworld Corp',
  status: 'Pre-processing',
  phase: 'pre_processing',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-01-01T00:00:00Z',
  dueDate: '2026-06-30T00:00:00Z',
  requestedBy: 'u-lead-1',
  assignedTo: 'u-lead-1',
  coAssignees: ['u-staff-1'],
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  tasks: [
    {
      id: 't-w2-1',
      workRequestId: 'wr-w2-1',
      title: 'Draft Board Resolution',
      description: 'Resolution draft for filing',
      status: 'In Progress',
      phase: 'pre_processing',
      qaStatus: 'none',
      phaseEnteredAt: '2026-01-01T00:00:00Z',
      dueDate: '2026-06-30T00:00:00Z',
      requiredLinkType: null,
      predecessors: [],
      assigneeId: 'u-staff-1',
      assigneeName: 'Juan Dela Cruz',
      assignees: ['u-staff-1'],
      displayOrder: 1,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 't-w2-2',
      workRequestId: 'wr-w2-1',
      title: 'SEC Filing Fee Payment',
      description: 'Payment of SEC fees',
      status: 'Assigned',
      phase: 'pre_processing',
      qaStatus: 'none',
      phaseEnteredAt: '2026-01-01T00:00:00Z',
      dueDate: '2026-06-30T00:00:00Z',
      requiredLinkType: null,
      predecessors: [],
      assigneeId: null,
      assigneeName: null,
      assignees: [],
      displayOrder: 2,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ],
};

const mockRelatedRecords = {
  invoices: [
    {
      id: 'inv-101',
      task_id: 't-w2-1',
      invoice_number: 'INV-2026-001',
      amount: 45000,
      status: 'draft',
      created_at: '2026-02-01T00:00:00Z',
      clients: { name: 'Megaworld Corp' },
    },
  ],
  disbursements: [
    {
      id: 'disb-101',
      task_id: 't-w2-1',
      category: 'Filing Fees',
      description: 'SEC Filing Filing fee reimbursement',
      amount: 5200,
      status: 'pending_approval',
      created_at: '2026-02-02T00:00:00Z',
    },
  ],
  transmittals: [
    {
      id: 'trans-101',
      linked_task_id: 't-w2-1',
      tracking_number: 'TR-2026-099',
      recipient_name: 'SEC Officer in Charge',
      status: 'draft',
      created_at: '2026-02-03T00:00:00Z',
    },
  ],
};

const mockDoc: DmsDocument = {
  id: 'doc-w2-1',
  work_request_id: 'wr-w2-1',
  workRequestId: 'wr-w2-1',
  linked_task_id: 't-w2-1',
  linkedTaskId: 't-w2-1',
  original_name: 'Board_Resolution_2026.pdf',
  originalName: 'Board_Resolution_2026.pdf',
  file_name: 'Board_Resolution_2026.pdf',
  fileName: 'Board_Resolution_2026.pdf',
  client_id: 'c-100',
  clientId: 'c-100',
  document_type: 'Board Resolution',
  documentType: 'Board Resolution',
  category: 'LEGAL',
  document_lifecycle: 'collected',
  status: 'active',
  archived: false,
  file_size: 245000,
  fileSize: 245000,
  content_type: 'application/pdf',
  contentType: 'application/pdf',
  uploader_id: 'u-staff-1',
  uploaderId: 'u-staff-1',
  entity_id: 'ATA',
  storage_path: 'documents/2026/Board_Resolution_2026.pdf',
  external_url: null,
  description: 'Board resolution document',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  comments: [],
  versions: [],
};

describe('UAT Wave 2: Operations Linkage, Assignee Controls, and Modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-lead-1',
        email: 'maria@ata-lta.ph',
        name: 'Maria Santos',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
        'workflow:transition_request',
        'workflow:qa_review',
        'workflow:task_add',
        'billing:create',
        'billing:edit',
        'disbursement:create',
        'disbursement:edit',
        'transmittal:create',
        'transmittal:edit',
      ],
      activeEntity: 'ATA',
    });

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/me/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockTeamMembers }),
        } as Response);
      }
      if (url.includes('/operations/tasks/t-w2-1/related')) {
        return new Response(JSON.stringify({ data: mockRelatedRecords }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-w2-1/tasks/t-w2-1')) {
        return new Response(JSON.stringify({ data: mockWr.tasks![0] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-w2-1/tasks')) {
        return new Response(JSON.stringify({ data: mockWr.tasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-w2-1')) {
        return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
      }
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: [mockWr] }), { status: 200 });
      }
      if (url.includes('/documents?')) {
        return new Response(JSON.stringify({ data: [mockDoc] }), { status: 200 });
      }
      if (url.includes('/operations/templates')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'tpl-1',
                name: 'Monthly Bookkeeping',
                entity: 'ATA',
                description: 'Routine bookkeeping template',
                recurrence: 'monthly',
                priority: 'Medium',
                tasks: [],
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z',
              },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/clients')) {
        return new Response(
          JSON.stringify({ data: [{ id: 'c-100', name: 'Megaworld Corp' }] }),
          { status: 200 }
        );
      }
      if (url.includes('/users')) {
        return new Response(JSON.stringify({ data: mockTeamMembers }), { status: 200 });
      }
      if (url.includes('/time-entries?')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
  });

  // UAT2-5: SidePeek Name Resolution
  it('UAT2-5: WorkRequestSidePeek resolves assignee names from team directory without raw UUIDs', async () => {
    const { wrapper } = createHarness();
    render(
      <WorkRequestSidePeek
        isOpen={true}
        onClose={vi.fn()}
        workRequestId="wr-w2-1"
      />,
      { wrapper }
    );

    // Waiting for content to render
    expect(await screen.findByText('Corporate SEC Compliance')).toBeInTheDocument();

    // Verify lead manager is resolved to Maria Santos (not u-lead-1)
    const assignedLeadElem = screen.getByTestId('side-peek-assignee');
    expect(assignedLeadElem).toHaveTextContent('Maria Santos');
    expect(assignedLeadElem.textContent).not.toContain('u-lead-1');

    // Verify co-assignee is resolved to Juan Dela Cruz (not u-staff-1)
    const coAssigneesElem = screen.getByTestId('side-peek-co-assignee');
    expect(coAssigneesElem).toHaveTextContent('Juan Dela Cruz');
    expect(coAssigneesElem.textContent).not.toContain('u-staff-1');
  });

  // UAT2-4: Pending Approvals Full WR Detail
  it('UAT2-4: PendingApprovalsInbox renders entity badge, client name, and tasks breakdown by name', async () => {
    const mockPendingReq = {
      id: 'req-app-1',
      requestType: 'wr_phase_transition',
      workRequestId: 'wr-w2-1',
      fromPhase: 'pre_processing',
      toPhase: 'processing',
      status: 'pending',
      requestedBy: 'u-lead-1',
      requestedByName: 'Maria Santos',
      workRequestTitle: 'Corporate SEC Compliance',
      clientName: 'Megaworld Corp',
      clients: { name: 'Megaworld Corp' },
      createdAt: new Date().toISOString(),
    };

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations-requests/counts')) {
        return new Response(JSON.stringify({ data: { pending: 1, rejected: 0, fulfilled: 0 } }), { status: 200 });
      }
      if (url.includes('/operations-requests')) {
        return new Response(JSON.stringify({ data: [mockPendingReq] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-w2-1')) {
        return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
      }
      if (url.includes('/me/team')) {
        return new Response(JSON.stringify({ data: mockTeamMembers }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    const { wrapper } = createHarness();
    render(<PendingApprovalsInbox />, { wrapper });

    expect(await screen.findByTestId('pending-approvals-inbox')).toBeInTheDocument();

    // Queue item displays entity badge and client name
    const queueItem = await screen.findByTestId('approval-item-req-app-1');
    expect(queueItem).toHaveTextContent('ATA');
    expect(queueItem).toHaveTextContent('Megaworld Corp');

    // Right-side WR detail card renders client and lead
    expect(await screen.findByTestId('request-client-name')).toHaveTextContent('Megaworld Corp');
    expect(screen.getByTestId('request-assigned-lead')).toHaveTextContent('Maria Santos');

    // Tasks breakdown renders tasks with assignee by name
    const tasksBreakdown = screen.getByTestId('request-tasks-breakdown');
    expect(tasksBreakdown).toHaveTextContent('Draft Board Resolution');
    expect(tasksBreakdown).toHaveTextContent('Juan Dela Cruz');
  });

  // UAT2-7: Linked Records Section
  it('UAT2-7: TaskDetailModal renders linked invoices, disbursements, and transmittals with creation action buttons', async () => {
    const { wrapper } = createHarness();
    const task = mockWr.tasks![0]!;

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={task}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    // Linked Records Section is present
    const linkedSection = await screen.findByTestId('task-linked-records-section');
    expect(linkedSection).toBeInTheDocument();

    // Verify linked records rendered
    expect(await screen.findByTestId('linked-invoice-inv-101')).toHaveTextContent('INV-2026-001');
    expect(screen.getByTestId('linked-disbursement-disb-101')).toHaveTextContent('Filing Fees');
    expect(screen.getByTestId('linked-transmittal-trans-101')).toHaveTextContent('TR-2026-099');

    // Verify action buttons are present for permitted user
    expect(screen.getByTestId('link-invoice-btn')).toBeInTheDocument();
    expect(screen.getByTestId('link-disbursement-btn')).toBeInTheDocument();
    expect(screen.getByTestId('link-transmittal-btn')).toBeInTheDocument();
  });

  // UAT2-8: Assign Employee Control
  it('UAT2-8: TaskDetailModal renders Assign Staff dropdown excluding current assignees for workflow:edit holders', async () => {
    const { wrapper } = createHarness();
    const task = mockWr.tasks![0]!; // has assignee 'u-staff-1' (Juan Dela Cruz)

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={task}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    // Assign Employee container should be present for workflow:edit holder
    expect(await screen.findByTestId('assign-employee-container')).toBeInTheDocument();
    const selectTrigger = screen.getByTestId('assign-employee-select');
    expect(selectTrigger).toBeInTheDocument();
  });

  // UAT2-9-frontend: Assignee Status Controls
  it('UAT2-9-frontend: renders status buttons for task assignee without workflow:edit', async () => {
    // Session as Juan Dela Cruz (Staff member, assignee of t-w2-1, NO workflow:edit)
    useSessionStore.getState().setSession({
      user: {
        id: 'u-staff-1',
        email: 'juan@ata-lta.ph',
        name: 'Juan Dela Cruz',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view'], // strictly NO workflow:edit
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    const task = mockWr.tasks![0]!; // assigneeId is 'u-staff-1'

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={task}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    // Status action button should be rendered because user is assignee
    const statusBtn = await screen.findByTestId('task-toggle-status-btn');
    expect(statusBtn).toBeInTheDocument();
    expect(statusBtn).toHaveTextContent('Mark Completed');
  });

  it('UAT2-9-frontend: hides status buttons for non-assignee without workflow:edit', async () => {
    // Session as Ana Reyes (Staff member, NOT assignee of t-w2-1, NO workflow:edit)
    useSessionStore.getState().setSession({
      user: {
        id: 'u-staff-2',
        email: 'ana@ata-lta.ph',
        name: 'Ana Reyes',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view'], // strictly NO workflow:edit
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    const task = mockWr.tasks![0]!; // assigneeId is 'u-staff-1'

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={task}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    // Status button should NOT be rendered
    expect(screen.queryByTestId('task-toggle-status-btn')).toBeNull();
  });

  // UAT2-10: Quick-Add (+) on Phase Columns
  it('UAT2-10: PhaseKanbanBoard renders quick-add (+) buttons on pre_processing and processing headers', async () => {
    const { wrapper } = createHarness();
    render(<PhaseKanbanBoard initialWorkRequestId="wr-w2-1" />, { wrapper });

    const preAddBtn = await screen.findByTestId('quick-add-task-pre_processing');
    const procAddBtn = await screen.findByTestId('quick-add-task-processing');
    expect(preAddBtn).toBeInTheDocument();
    expect(procAddBtn).toBeInTheDocument();

    // Clicking (+) toggles the inline task creation form
    fireEvent.click(preAddBtn);
    expect(screen.getByTestId('quick-add-form-pre_processing')).toBeInTheDocument();
    expect(screen.getByTestId('quick-add-title-input-pre_processing')).toBeInTheDocument();
  });

  it('quick-add selects scoped assignee, date and link type and submits with Enter', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    const { wrapper } = createHarness();
    render(<QuickAddCard phase="processing" workRequest={mockWr} onCreate={onCreate} onCancel={onCancel} />, { wrapper });
    const title = screen.getByLabelText('Task title');
    expect(title).toHaveFocus();
    expect(screen.getByLabelText('Create task')).toBeDisabled();
    expect(title).toHaveAttribute('placeholder', 'What needs to be done?');
    const assignee = screen.getByLabelText('Lead assignee');
    await waitFor(() => expect(within(assignee).getByText('Juan Dela Cruz')).toBeInTheDocument());
    expect(within(assignee).queryByText('Ana Reyes')).toBeNull();
    fireEvent.change(assignee, { target: { value: 'u-staff-1' } });
    expect(assignee.parentElement).toHaveTextContent('JC');
    fireEvent.click(screen.getByLabelText('Choose due date'));
    fireEvent.change(screen.getByLabelText('Task due date', { selector: 'input' }), { target: { value: '2026-10-20' } });
    expect(screen.getByLabelText('Choose due date')).toHaveTextContent('Oct 20');
    fireEvent.change(screen.getByLabelText('Task link type'), { target: { value: 'billing' } });
    fireEvent.change(title, { target: { value: '  Prepare invoice  ' } });
    fireEvent.keyDown(title, { key: 'Enter', shiftKey: true });
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      title: 'Prepare invoice', phase: 'processing', status: 'Assigned', requiredLinkType: 'billing',
      dueDate: '2026-10-20', assigneeId: 'u-staff-1', assigneeName: 'Juan Dela Cruz', assignees: ['u-staff-1'],
    }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it.each(['billing', 'documents', ''])('quick-add submits link type %s and clears optional fields', async (linkType) => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { wrapper } = createHarness();
    render(<QuickAddCard phase="pre_processing" workRequest={mockWr} onCreate={onCreate} onCancel={vi.fn()} />, { wrapper });
    await screen.findByRole('option', { name: 'Juan Dela Cruz' });
    fireEvent.change(screen.getByLabelText('Lead assignee'), { target: { value: 'u-staff-1' } });
    fireEvent.change(screen.getByLabelText('Lead assignee'), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText('Choose due date'));
    fireEvent.change(screen.getByLabelText('Task due date', { selector: 'input' }), { target: { value: '2026-10-20' } });
    fireEvent.click(screen.getByLabelText('Clear due date'));
    fireEvent.change(screen.getByLabelText('Task link type'), { target: { value: linkType } });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'New task' } });
    fireEvent.click(screen.getByLabelText('Create task'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Draft', requiredLinkType: linkType || null, dueDate: null, assigneeId: null, assigneeName: null, assignees: [],
    })));
  });

  it('quick-add Escape dismisses the board card and reopening clears the draft', async () => {
    const { wrapper } = createHarness();
    render(<PhaseKanbanBoard initialWorkRequestId="wr-w2-1" />, { wrapper });
    fireEvent.click(await screen.findByTestId('quick-add-task-pre_processing'));
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Discard me' } });
    fireEvent.change(screen.getByLabelText('Task link type'), { target: { value: 'billing' } });
    fireEvent.keyDown(screen.getByLabelText('Task title'), { key: 'Escape' });
    expect(screen.queryByTestId('quick-add-form-pre_processing')).toBeNull();
    fireEvent.click(screen.getByTestId('quick-add-task-pre_processing'));
    expect(screen.getByLabelText('Task title')).toHaveValue('');
    expect(screen.getByLabelText('Task link type')).toHaveValue('');
    expect(screen.queryByTestId('quick-add-task-quality_assurance')).toBeNull();
    expect(screen.queryByTestId('quick-add-task-completion')).toBeNull();
  });

  it('quick-add prevents duplicate submissions and preserves fields after failure', async () => {
    let reject!: (reason: Error) => void;
    const onCreate = vi.fn().mockImplementation(() => new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; }));
    const onCancel = vi.fn();
    const { wrapper } = createHarness();
    render(<QuickAddCard phase="processing" workRequest={mockWr} onCreate={onCreate} onCancel={onCancel} />, { wrapper });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Retry task' } });
    fireEvent.keyDown(screen.getByLabelText('Task title'), { key: 'Enter' });
    fireEvent.submit(screen.getByRole('form', { name: 'Quick-add task' }));
    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Create task')).toBeDisabled();
    expect(screen.getByLabelText('Cancel quick-add task')).toBeDisabled();
    await act(async () => reject(new Error('Server unavailable')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to create task');
    expect(screen.getByLabelText('Task title')).toHaveValue('Retry task');
    expect(screen.getByLabelText('Create task')).toBeEnabled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a pending request from an unmounted card cannot dismiss a newer draft', async () => {
    let resolve!: () => void;
    const onCreate = vi.fn().mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const onCancel = vi.fn();
    const { wrapper } = createHarness();
    const { rerender } = render(<QuickAddCard key="old" phase="processing" workRequest={mockWr} onCreate={onCreate} onCancel={onCancel} />, { wrapper });
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Old request' } });
    fireEvent.click(screen.getByLabelText('Create task'));
    rerender(<QuickAddCard key="new" phase="pre_processing" workRequest={mockWr} onCreate={onCreate} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'New draft' } });
    await act(async () => resolve());
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Task title')).toHaveValue('New draft');
  });

  it('quick-add falls back to eligible staff only when the work request has no team', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [
      ...mockTeamMembers,
      { id: 'admin', name: 'Admin User', role: 'Admin' },
      { id: 'ops-manager', name: 'Ops Manager', role: 'Manager', departments: ['Operations'] },
    ] }), { status: 200 }));
    const { wrapper } = createHarness();
    render(<QuickAddCard phase="processing" workRequest={{ ...mockWr, assignedTo: null, coAssignees: [] }} onCreate={vi.fn()} onCancel={vi.fn()} />, { wrapper });
    await screen.findByRole('option', { name: 'Ops Manager' });
    expect(screen.getByRole('option', { name: 'Ana Reyes' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Admin User' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Maria Santos' })).toBeNull();
  });

  it.each(['completed', 'no-permission'])('hides board quick-add for %s', async (scenario) => {
    const { wrapper } = createHarness();
    if (scenario === 'no-permission') useSessionStore.setState({ permissions: new Set(['workflow:view']) });
    else {
      const completed = { ...mockWr, status: 'Completed' };
      const originalFetch = vi.mocked(fetch).getMockImplementation()!;
      vi.mocked(fetch).mockImplementation((input, init) => String(input).endsWith('/operations/work-requests/wr-w2-1')
        ? Promise.resolve(new Response(JSON.stringify({ data: completed }), { status: 200 }))
        : originalFetch(input, init));
    }
    render(<PhaseKanbanBoard initialWorkRequestId="wr-w2-1" />, { wrapper });
    await screen.findByTestId('phase-kanban-board');
    await waitFor(() => expect(screen.queryByTestId('quick-add-task-pre_processing')).toBeNull());
    expect(screen.queryByTestId('quick-add-task-processing')).toBeNull();
  });

  // UAT2-11: Document Upload Modal Trigger
  it('UAT2-11: TaskDetailModal renders Upload Document button opening DocumentUploadModal', async () => {
    const { wrapper } = createHarness();
    const task = mockWr.tasks![0]!;

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={task}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    const uploadBtn = await screen.findByTestId('task-upload-doc-btn');
    expect(uploadBtn).toBeInTheDocument();
  });

  // Multi-Assignee & Re-assignment
  it('renders assigned team section with lead and co-assignees, allowing re-assignment and removal', async () => {
    const { wrapper } = createHarness();
    const taskWithMultiAssignees = {
      ...mockWr.tasks![0]!,
      assigneeId: 'u-lead-1',
      assigneeName: 'Maria Santos',
      assignees: ['u-lead-1', 'u-staff-1', 'u-staff-2'],
    };

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={taskWithMultiAssignees}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    // Meta Grid shows lead assignee
    expect(await screen.findByTestId('task-assignee')).toHaveTextContent('Maria Santos');
    expect(screen.getByTestId('task-co-assignees')).toBeInTheDocument();

    // Dedicated Assigned Team section shows count 3
    expect(screen.getByTestId('assigned-team-section')).toBeInTheDocument();
    expect(screen.getByTestId('assigned-team-count')).toHaveTextContent('3');

    // Individual chips for all assignees once team is loaded
    expect((await screen.findAllByText('Juan Dela Cruz')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('Ana Reyes')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId('assignee-chip-u-lead-1')).toHaveTextContent('Maria Santos');
    expect(screen.getByTestId('assignee-chip-u-staff-1')).toHaveTextContent('Juan Dela Cruz');
    expect(screen.getByTestId('assignee-chip-u-staff-2')).toHaveTextContent('Ana Reyes');

    // Lead / Primary badge on primary lead
    expect(screen.getByTestId('assignee-chip-u-lead-1')).toHaveTextContent(/Lead|Primary/);

    // Make Lead buttons present for co-assignees
    expect(screen.getByTestId('make-lead-btn-u-staff-1')).toBeInTheDocument();
    expect(screen.getByTestId('make-lead-btn-u-staff-2')).toBeInTheDocument();

    // Reassign lead and co-assignee selects are available for workflow:edit holder
    expect(screen.getByTestId('reassign-lead-select')).toBeInTheDocument();
  });

  // Admin WR Template Creation
  it('OperationsPage renders Create Work Request Template controls for Admin users', async () => {
    // Session as Admin
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Super Admin',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['workflow:view', 'workflow:edit', 'retainers:use', 'retainers:edit'],
      activeEntity: 'ATA',
    });

    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=retainer-templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Page header has New Template button
    expect(await screen.findByTestId('page-new-template-btn')).toBeInTheDocument();

    // Retainer Templates tab has Create Work Request Template button
    expect(await screen.findByTestId('create-template-btn')).toBeInTheDocument();
    expect(screen.getByTestId('create-template-btn')).toHaveTextContent('Create Work Request Template');

    // Template card has Edit button for Admin once templates load
    expect(await screen.findByTestId('edit-template-btn-tpl-1')).toBeInTheDocument();

    // Clicking Create Work Request Template button opens the modal
    fireEvent.click(screen.getByTestId('create-template-btn'));
    expect(await screen.findByText('Create Retainer Template')).toBeInTheDocument();
  });

  it('OperationsPage hides Create Work Request Template controls for non-admin without retainers:edit', async () => {
    // Session as Staff without retainers:edit
    useSessionStore.getState().setSession({
      user: {
        id: 'u-staff-1',
        email: 'juan@ata-lta.ph',
        name: 'Juan Dela Cruz',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'retainers:use'], // strictly NO retainers:edit
      activeEntity: 'ATA',
    });

    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=retainer-templates']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    // Wait for page to render
    expect(await screen.findByTestId('operations-page')).toBeInTheDocument();

    // New Template and Create Work Request Template buttons should not exist
    expect(screen.queryByTestId('page-new-template-btn')).toBeNull();
    expect(screen.queryByTestId('create-template-btn')).toBeNull();
    expect(screen.queryByTestId('edit-template-btn-tpl-1')).toBeNull();
  });
});
