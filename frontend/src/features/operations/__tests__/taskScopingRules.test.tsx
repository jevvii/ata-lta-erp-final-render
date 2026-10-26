import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { TaskDetailModal } from '../components/TaskDetailModal';
import {
  isTaskAssignee,
  isWrTeamMember,
  isUserAdmin,
  canMutateTaskStatus,
  canLogTaskTime,
  canUploadTaskDocument,
  canLinkInvoice,
  canLinkTransmittal,
  canLinkDisbursement,
  canRequestInvoice,
  canRequestTransmittal,
} from '../lib/taskScope';
import type { Task, WorkRequest } from '../api/types';

const mockTask: Task = {
  id: 'task-scope-1',
  workRequestId: 'wr-scope-1',
  title: 'Quarterly Review Audit',
  description: 'Detailed financial worksheets review',
  status: 'In Progress',
  phase: 'processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  assigneeId: 'emp-assigned-1',
  assigneeName: 'Assigned Lead Staff',
  assignees: ['emp-assigned-1', 'emp-assigned-2'],
  taskAssignees: [
    { taskId: 'task-scope-1', userId: 'emp-assigned-1', assignedBy: null, assignedAt: null, userName: 'Assigned Lead Staff' },
    { taskId: 'task-scope-1', userId: 'emp-assigned-2', assignedBy: null, assignedAt: null, userName: 'Assigned Co Staff' },
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
  id: 'wr-scope-1',
  title: 'Q1 Corporate Review',
  description: 'Detailed financial worksheets review',
  entity: 'ATA',
  clientId: 'client-1',
  clientName: 'Alpha Corp',
  phase: 'processing',
  status: 'In Progress',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  dueDate: '2026-04-30T00:00:00Z',
  requestedBy: 'user-req-1',
  assignedTo: 'mgr-lead-1',
  assignedToName: 'Manager Lead',
  coAssignees: ['emp-assigned-1', 'emp-assigned-2', 'emp-accounting-1', 'emp-doc-1'],
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  tasks: [mockTask],
};

const userAdmin: UserProfile = {
  id: 'user-lorein',
  email: 'lorein@ata-lta.ph',
  name: 'Lorein Wong',
  role: 'Admin',
  departments: ['Management'],
  entities: ['ATA', 'LTA'],
};

const userAssignedStaff: UserProfile = {
  id: 'emp-assigned-1',
  email: 'worker1@ata-lta.ph',
  name: 'Assigned Lead Staff',
  role: 'Staff',
  departments: ['Operations'],
  entities: ['ATA', 'LTA'],
};

const userUnassignedManager: UserProfile = {
  id: 'mgr-unassigned',
  email: 'unassigned.mgr@ata-lta.ph',
  name: 'Unassigned Manager',
  role: 'Manager',
  departments: ['Operations'],
  entities: ['ATA', 'LTA'],
};

const userAccountingTeam: UserProfile = {
  id: 'emp-accounting-1',
  email: 'acct@ata-lta.ph',
  name: 'Accounting Staff',
  role: 'Staff',
  departments: ['Accounting'],
  entities: ['ATA', 'LTA'],
};

const userDocTeam: UserProfile = {
  id: 'emp-doc-1',
  email: 'doc@ata-lta.ph',
  name: 'Documentation Staff',
  role: 'Staff',
  departments: ['Documentation'],
  entities: ['ATA', 'LTA'],
};

describe('Task Scoping Utility Unit Tests (taskScope.ts)', () => {
  it('correctly determines task assignee membership', () => {
    expect(isTaskAssignee(userAssignedStaff, mockTask)).toBe(true);
    expect(isTaskAssignee({ ...userAssignedStaff, id: 'emp-assigned-2' }, mockTask)).toBe(true);
    expect(isTaskAssignee(userUnassignedManager, mockTask)).toBe(false);
    expect(isTaskAssignee(userAdmin, mockTask)).toBe(false);
  });

  it('correctly determines work request team membership', () => {
    expect(isWrTeamMember(userAccountingTeam, mockWr, [mockTask])).toBe(true);
    expect(isWrTeamMember(userUnassignedManager, mockWr, [mockTask])).toBe(false);
    expect(isWrTeamMember(userAssignedStaff, mockWr, [mockTask])).toBe(true);
  });

  it('correctly identifies Admin users including Lorein Wong', () => {
    expect(isUserAdmin(userAdmin)).toBe(true);
    expect(isUserAdmin({ id: 'any-id', email: 'lorein@ata-lta.ph', name: 'Lorein Wong', role: 'Staff', departments: [], entities: [] })).toBe(true);
    expect(isUserAdmin(userAssignedStaff)).toBe(false);
    expect(isUserAdmin(userUnassignedManager)).toBe(false);
  });

  it('enforces status mutation permissions (only assigned employee or Admin)', () => {
    expect(canMutateTaskStatus(userAssignedStaff, mockTask)).toBe(true);
    expect(canMutateTaskStatus(userAdmin, mockTask)).toBe(true);
    expect(canMutateTaskStatus(userUnassignedManager, mockTask)).toBe(false);
    expect(canMutateTaskStatus(userAccountingTeam, mockTask)).toBe(false);
  });

  it.each([null, 'billing', 'invoice', 'document', 'disbursement', 'transmittal'])(
    'allows Accounting primary and co-assignees to update status for task type %s',
    (requiredLinkType) => {
      const accounting = { ...userAccountingTeam, id: 'emp-assigned-1' };
      const task = { ...mockTask, requiredLinkType } as Task;
      expect(canMutateTaskStatus(accounting, task)).toBe(true);
      expect(canMutateTaskStatus({ ...accounting, id: 'emp-assigned-2', role: 'Accounting', departments: [] }, task)).toBe(true);
      expect(canMutateTaskStatus(userAccountingTeam, task)).toBe(false);
    }
  );

  it('requires assignment for time logging, including Admins', () => {
    expect(canLogTaskTime(userAssignedStaff, mockTask)).toBe(true);
    expect(canLogTaskTime(userAdmin, mockTask)).toBe(false);
    expect(canLogTaskTime(userUnassignedManager, mockTask)).toBe(false);
    expect(canLogTaskTime(userAccountingTeam, mockTask)).toBe(false);
  });

  it('enforces document upload permissions (only assigned employee or Admin; Accounting only on assigned billing tasks)', () => {
    expect(canUploadTaskDocument(userAssignedStaff, mockTask)).toBe(true);
    expect(canUploadTaskDocument(userAdmin, mockTask)).toBe(true);
    expect(canUploadTaskDocument(userUnassignedManager, mockTask)).toBe(false);
    expect(canUploadTaskDocument(userDocTeam, mockTask)).toBe(false);

    // Accounting user assigned to non-billing task -> denied
    const userAcctAssigned: UserProfile = {
      ...userAccountingTeam,
      id: 'emp-assigned-1',
    };
    expect(canUploadTaskDocument(userAcctAssigned, { ...mockTask, requiredLinkType: null })).toBe(false);
    expect(canUploadTaskDocument(userAcctAssigned, { ...mockTask, requiredLinkType: 'documents' })).toBe(false);

    // Accounting user assigned to billing task -> allowed
    expect(canUploadTaskDocument(userAcctAssigned, { ...mockTask, requiredLinkType: 'billing' })).toBe(true);
    // Unassigned Accounting user on billing task -> denied
    expect(canUploadTaskDocument(userAccountingTeam, { ...mockTask, requiredLinkType: 'billing' })).toBe(false);
  });

  it('enforces billing invoice permissions (Admin direct; Accounting only on assigned billing tasks; non-Admin Doc denied; others request)', () => {
    // Direct link
    expect(canLinkInvoice(userAdmin, mockTask, mockWr, [mockTask])).toBe(true);
    expect(canLinkInvoice(userAssignedStaff, mockTask, mockWr, [mockTask])).toBe(true);
    // Unassigned Accounting user on WR is NOT allowed to link invoice
    expect(canLinkInvoice(userAccountingTeam, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canLinkInvoice(userAccountingTeam, { ...mockTask, requiredLinkType: 'billing' }, mockWr, [mockTask])).toBe(false);
    // Assigned Accounting user on non-billing task is NOT allowed to link invoice
    const userAcctAssigned: UserProfile = {
      ...userAccountingTeam,
      id: 'emp-assigned-1',
    };
    expect(canLinkInvoice(userAcctAssigned, { ...mockTask, requiredLinkType: null }, mockWr, [mockTask])).toBe(false);
    expect(canLinkInvoice(userAcctAssigned, { ...mockTask, requiredLinkType: 'documents' }, mockWr, [mockTask])).toBe(false);
    // Assigned Accounting user on billing task IS allowed to link invoice
    expect(canLinkInvoice(userAcctAssigned, { ...mockTask, requiredLinkType: 'billing' }, mockWr, [mockTask])).toBe(true);
    expect(canLinkInvoice(userUnassignedManager, mockTask, mockWr, [mockTask])).toBe(false);

    // Request from accounting
    expect(canRequestInvoice(userUnassignedManager, mockTask, mockWr, [mockTask])).toBe(false); // Unassigned manager not in WR
    expect(canRequestInvoice(userAccountingTeam, mockTask, mockWr, [mockTask])).toBe(false); // Accounting links directly
    expect(canRequestInvoice(userAdmin, mockTask, mockWr, [mockTask])).toBe(false); // Admin links directly

    // Documentation users strictly denied invoice requests
    expect(canRequestInvoice(userDocTeam, mockTask, mockWr, [mockTask])).toBe(false);

    // Documentation user assigned to task is still denied invoice request
    const userDocAssigned: UserProfile = {
      ...userDocTeam,
      id: 'emp-assigned-1',
    };
    expect(canRequestInvoice(userDocAssigned, mockTask, mockWr, [mockTask])).toBe(false);

    // Multi-department user with Documentation + Operations is still denied invoice request
    const userDocAndOps: UserProfile = {
      ...userAssignedStaff,
      departments: ['Operations', 'Documentation'],
    };
    expect(canRequestInvoice(userDocAndOps, mockTask, mockWr, [mockTask])).toBe(false);

    // Assigned staff without Documentation CAN request invoice
    expect(canRequestInvoice(userAssignedStaff, mockTask, mockWr, [mockTask])).toBe(true);
  });

  it('enforces transmittal permissions (Admin and assigned can link; Doc requires task assignee, no WR fallback)', () => {
    // Direct link
    expect(canLinkTransmittal(userAdmin, mockTask, mockWr, [mockTask])).toBe(true);
    expect(canLinkTransmittal(userAssignedStaff, mockTask, mockWr, [mockTask])).toBe(true);
    // Unassigned Documentation user in WR is NOT allowed (no WR fallback)
    expect(canLinkTransmittal(userDocTeam, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canLinkTransmittal(userUnassignedManager, mockTask, mockWr, [mockTask])).toBe(false);

    // Assigned Documentation user CAN link transmittal
    const userDocAssigned: UserProfile = {
      ...userDocTeam,
      id: 'emp-assigned-1',
    };
    expect(canLinkTransmittal(userDocAssigned, mockTask, mockWr, [mockTask])).toBe(true);

    // Request from documentation
    expect(canRequestTransmittal(userDocTeam, mockTask, mockWr, [mockTask])).toBe(false); // Doc links directly
    expect(canRequestTransmittal(userAdmin, mockTask, mockWr, [mockTask])).toBe(false); // Admin links directly
    expect(canRequestTransmittal(userAssignedStaff, mockTask, mockWr, [mockTask])).toBe(true); // Assigned staff can request transmittal
  });

  it('enforces disbursement permissions (Admin or assigned employee with permission)', () => {
    expect(canLinkDisbursement(userAdmin, mockTask, true)).toBe(true);
    expect(canLinkDisbursement(userAdmin, mockTask, false)).toBe(true);
    expect(canLinkDisbursement(userAssignedStaff, mockTask, true)).toBe(true);
    expect(canLinkDisbursement(userAssignedStaff, mockTask, false)).toBe(false);
    expect(canLinkDisbursement(userUnassignedManager, mockTask, true)).toBe(false);
  });
});

describe('TaskDetailModal UI Scoping Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/time-entries')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/documents')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/operations/tasks/task-scope-1/related')) {
        return new Response(
          JSON.stringify({
            data: { invoices: [], disbursements: [], transmittals: [] },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/me/team')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'emp-assigned-1', name: 'Assigned Lead Staff', role: 'Staff' },
              { id: 'emp-assigned-2', name: 'Assigned Co Staff', role: 'Staff' },
              { id: 'mgr-unassigned', name: 'Unassigned Manager', role: 'Manager', departments: ['Operations'] },
            ],
          }),
          { status: 200 }
        );
      }
      if (url.includes('/operations-requests')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
  });

  const createWrapper = () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
  };

  it('renders status, log time, and upload buttons for assigned staff', async () => {
    useSessionStore.getState().setSession({
      user: userAssignedStaff,
      permissions: ['workflow:view', 'timelog:create'],
      activeEntity: 'ATA',
    });

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper: createWrapper() }
    );

    // Status button should be present
    expect(screen.getByTestId('task-toggle-status-btn')).toBeInTheDocument();
    // Log Time button should be present
    expect(screen.getByTestId('open-log-time-btn')).toBeInTheDocument();
    // Upload Document button should be present
    expect(screen.getByTestId('task-upload-doc-btn')).toBeInTheDocument();
  });

  it.each(['Draft', 'Assigned'] as const)('offers both status actions for an owned %s task', (status) => {
    useSessionStore.getState().setSession({
      user: userAssignedStaff,
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={{ ...mockTask, status }} workRequest={mockWr} />,
      { wrapper: createWrapper() });
    const start = screen.getByTestId('task-status-inprogress-btn');
    const complete = screen.getByTestId('task-toggle-status-btn');
    expect(start).toHaveTextContent('Mark In Progress');
    expect(complete).toHaveTextContent('Mark Completed');
    expect(start.parentElement).toBe(complete.parentElement);
  });

  it.each([
    ['primary', 'Assigned', 'In Progress', 'task-status-inprogress-btn'],
    ['primary', 'Assigned', 'Completed', 'task-toggle-status-btn'],
    ['co-assignee', 'Assigned', 'In Progress', 'task-status-inprogress-btn'],
    ['co-assignee', 'In Progress', 'Completed', 'task-toggle-status-btn'],
    ['primary', 'Completed', 'In Progress', 'task-toggle-status-btn'],
  ] as const)('Accounting %s changes a regular task from %s to %s', async (assignment, status, nextStatus, buttonId) => {
    useSessionStore.getState().setSession({
      user: { ...userAccountingTeam, id: assignment === 'primary' ? 'emp-assigned-1' : 'emp-assigned-2' },
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
    });
    const task = { ...mockTask, status, requiredLinkType: null };
    const onTaskUpdated = vi.fn();
    const originalFetch = vi.mocked(global.fetch).getMockImplementation()!;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      if ((!init?.method || init.method === 'GET') && String(input).endsWith('/operations/work-requests/wr-scope-1/tasks/task-scope-1')) {
        return new Response(JSON.stringify({ data: { ...task, checklist: [] } }), { status: 200 });
      }
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ data: { ...task, status: nextStatus } }), { status: 200 });
      }
      return originalFetch(input, init);
    });
    render(<TaskDetailModal isOpen onClose={vi.fn()} task={task} workRequest={mockWr} onTaskUpdated={onTaskUpdated} />,
      { wrapper: createWrapper() });
    await waitFor(() => expect(screen.getByTestId('task-toggle-status-btn')).toBeEnabled());
    if (status === 'Assigned') {
      expect(screen.getByTestId('task-status-inprogress-btn')).toBeEnabled();
      expect(screen.getByTestId('task-toggle-status-btn')).toBeEnabled();
    }
    fireEvent.click(screen.getByTestId(buttonId));
    await waitFor(() => expect(onTaskUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: nextStatus })));
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/operations/work-requests/wr-scope-1/tasks/task-scope-1'),
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: nextStatus }) })
    );
    expect(screen.queryByTestId('edit-task-description-btn')).not.toBeInTheDocument();
  });

  it.each(['unassigned', 'completed work request', 'inactive phase'] as const)(
    'preserves Accounting status restrictions for %s', (condition) => {
      useSessionStore.getState().setSession({
        user: { ...userAccountingTeam, id: condition === 'unassigned' ? userAccountingTeam.id : 'emp-assigned-1' },
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });
      const wr = { ...mockWr, ...(condition === 'completed work request' ? { status: 'Completed' as const } : {}),
        ...(condition === 'inactive phase' ? { phase: 'pre_processing' as const } : {}) };
      render(<TaskDetailModal isOpen onClose={vi.fn()} task={{ ...mockTask, status: 'Assigned' }} workRequest={wr} />,
        { wrapper: createWrapper() });
      if (condition === 'inactive phase') {
        expect(screen.getByTestId('task-status-inprogress-btn')).toBeDisabled();
        expect(screen.getByTestId('task-toggle-status-btn')).toBeDisabled();
      } else {
        expect(screen.queryByTestId('task-status-inprogress-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('task-toggle-status-btn')).not.toBeInTheDocument();
      }
    }
  );

  it('HIDES status, log time, and upload buttons for unassigned manager', async () => {
    useSessionStore.getState().setSession({
      user: userUnassignedManager,
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper: createWrapper() }
    );

    // Status button MUST be hidden for unassigned manager
    expect(screen.queryByTestId('task-toggle-status-btn')).not.toBeInTheDocument();
    // Log time button MUST be hidden for unassigned manager
    expect(screen.queryByTestId('open-log-time-btn')).not.toBeInTheDocument();
    // Upload doc button MUST be hidden for unassigned manager
    expect(screen.queryByTestId('task-upload-doc-btn')).not.toBeInTheDocument();
  });

  it('renders all action controls for Admin and formats direct approval', async () => {
    useSessionStore.getState().setSession({
      user: userAdmin,
      permissions: ['workflow:view', 'workflow:edit', 'billing:create', 'disbursement:create', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    let patchedData: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (
        url.includes('/operations/work-requests/wr-scope-1/tasks/task-scope-1') &&
        (init?.method === 'PUT' || init?.method === 'PATCH')
      ) {
        patchedData = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ data: { ...mockTask, status: 'Completed' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: url.endsWith('/operations/work-requests/wr-scope-1/tasks/task-scope-1') ? { ...mockTask, checklist: [] } : [] }), { status: 200 });
    });

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTask}
        workRequest={mockWr}
      />,
      { wrapper: createWrapper() }
    );

    // Controls present
    expect(screen.getByTestId('task-toggle-status-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('open-log-time-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('task-upload-doc-btn')).toBeInTheDocument();
    expect(screen.getByTestId('link-invoice-btn')).toBeInTheDocument();
    expect(screen.getByTestId('link-disbursement-btn')).toBeInTheDocument();
    expect(screen.getByTestId('link-transmittal-btn')).toBeInTheDocument();

    // Trigger Admin status change after the authoritative checklist read.
    await waitFor(() => expect(screen.getByTestId('task-toggle-status-btn')).toBeEnabled());
    fireEvent.click(screen.getByTestId('task-toggle-status-btn'));
    await waitFor(() => {
      expect(patchedData).toEqual({ status: 'Completed' });
    });
  });
});
