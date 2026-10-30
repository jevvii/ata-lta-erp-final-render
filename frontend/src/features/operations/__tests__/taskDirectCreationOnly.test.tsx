import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { canRequestInvoice, canRequestTransmittal } from '../lib/taskScope';
import type { Task, WorkRequest } from '../api/types';

describe('Task Direct Creation Only (No Requests Entirely)', () => {
  const mockTask: Task = {
    id: 'task-scope-1',
    workRequestId: 'wr-scope-1',
    title: 'Audit Client Records Task',
    description: 'Detailed financial worksheets review',
    status: 'In Progress',
    phase: 'processing',
    qaStatus: 'none',
    phaseEnteredAt: '2026-03-01T00:00:00Z',
    assigneeId: 'emp-assigned-1',
    assigneeName: 'Assigned Lead Staff',
    assignees: ['emp-assigned-1'],
    taskAssignees: [
      { taskId: 'task-scope-1', userId: 'emp-assigned-1', assignedBy: null, assignedAt: null, userName: 'Assigned Lead Staff' },
    ],
    predecessors: [],
    dueDate: '2026-11-01',
    requiredLinkType: null,
    displayOrder: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    version: 1,
  };

  const mockWr: WorkRequest = {
    id: 'wr-scope-1',
    title: 'Tax Compliance 2026',
    description: 'Tax review operations',
    entity: 'ATA',
    clientId: 'client-1',
    clientName: 'Alpha Corp',
    phase: 'processing',
    status: 'In Progress',
    priority: 'Normal',
    archived: false,
    onHold: false,
    phaseEnteredAt: '2026-03-01T00:00:00Z',
    dueDate: '2026-11-30T00:00:00Z',
    requestedBy: 'user-req-1',
    assignedTo: 'mgr-lead-1',
    assignedToName: 'Manager Lead',
    coAssignees: ['emp-assigned-1'],
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    tasks: [mockTask],
  };

  const assignedStaffUser: UserProfile = {
    id: 'emp-assigned-1',
    email: 'staff@ata-lta.ph',
    name: 'Assigned Lead Staff',
    role: 'Staff',
    departments: ['Operations'],
    entities: ['ATA'],
  };

  const billingUser: UserProfile = {
    id: 'emp-assigned-1',
    email: 'billing@ata-lta.ph',
    name: 'Assigned Billing Staff',
    role: 'Staff',
    departments: ['Operations'],
    entities: ['ATA'],
  };

  const adminUser: UserProfile = {
    id: 'admin-1',
    email: 'admin@ata-lta.ph',
    name: 'System Admin',
    role: 'Admin',
    departments: ['Management'],
    entities: ['ATA'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/time-entries') || url.includes('/documents') || url.includes('/operations-requests')) {
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
            data: [{ id: 'emp-assigned-1', name: 'Assigned Lead Staff', role: 'Staff' }],
          }),
          { status: 200 }
        );
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

  it('verifies canRequestInvoice and canRequestTransmittal return false for all users', () => {
    expect(canRequestInvoice(assignedStaffUser, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canRequestInvoice(billingUser, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canRequestInvoice(adminUser, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canRequestInvoice(null, mockTask, mockWr, [mockTask])).toBe(false);

    expect(canRequestTransmittal(assignedStaffUser, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canRequestTransmittal(billingUser, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canRequestTransmittal(adminUser, mockTask, mockWr, [mockTask])).toBe(false);
    expect(canRequestTransmittal(null, mockTask, mockWr, [mockTask])).toBe(false);
  });

  it('renders direct "+ Invoice" creation button for user with billing:create permission and NO request buttons', async () => {
    useSessionStore.getState().setSession({
      user: billingUser,
      permissions: ['workflow:view', 'billing:create'],
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

    // Direct creation button must be present
    expect(screen.getByTestId('link-invoice-btn')).toBeInTheDocument();

    // Request buttons must NOT be present entirely
    expect(screen.queryByTestId('request-invoice-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('request-transmittal-btn')).not.toBeInTheDocument();
  });

  it('renders direct "+ Transmittal" creation button for user with transmittal:create permission and NO request buttons', async () => {
    useSessionStore.getState().setSession({
      user: assignedStaffUser,
      permissions: ['workflow:view', 'transmittal:create'],
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

    // Direct creation button must be present
    expect(screen.getByTestId('link-transmittal-btn')).toBeInTheDocument();

    // Request buttons must NOT be present entirely
    expect(screen.queryByTestId('request-invoice-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('request-transmittal-btn')).not.toBeInTheDocument();
  });

  it('does NOT render request buttons or direct creation buttons for assigned staff without creation permissions', async () => {
    useSessionStore.getState().setSession({
      user: assignedStaffUser,
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

    // No direct creation without permissions
    expect(screen.queryByTestId('link-invoice-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('link-transmittal-btn')).not.toBeInTheDocument();

    // No request buttons entirely
    expect(screen.queryByTestId('request-invoice-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('request-transmittal-btn')).not.toBeInTheDocument();
  });

  it('renders direct creation buttons for Admin and NO request buttons entirely', async () => {
    useSessionStore.getState().setSession({
      user: adminUser,
      permissions: [
        'workflow:view',
        'workflow:edit',
        'billing:create',
        'billing:edit',
        'transmittal:create',
        'transmittal:edit',
        'disbursement:create',
      ],
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

    // Direct creation buttons must be present
    expect(screen.getByTestId('link-invoice-btn')).toBeInTheDocument();
    expect(screen.getByTestId('link-transmittal-btn')).toBeInTheDocument();
    expect(screen.getByTestId('link-disbursement-btn')).toBeInTheDocument();

    // Request buttons must NOT be present entirely
    expect(screen.queryByTestId('request-invoice-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('request-transmittal-btn')).not.toBeInTheDocument();
  });
});
