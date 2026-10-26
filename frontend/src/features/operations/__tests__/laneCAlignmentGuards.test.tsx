import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import OperationsPage from '@/routes/operations';
import { TransmittalFormModal } from '@/features/transmittals/components/TransmittalFormModal';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { canRequestInvoice, canLinkTransmittal } from '../lib/taskScope';
import type { Task, WorkRequest } from '../api/types';

const baseTask: Task = {
  id: 't-100',
  workRequestId: 'wr-100',
  title: 'Audit Tax Declaration',
  description: 'Review declaration forms',
  status: 'In Progress',
  phase: 'processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  assigneeId: 'emp-assigned-1',
  assigneeName: 'Assigned User',
  assignees: ['emp-assigned-1'],
  taskAssignees: [
    { taskId: 't-100', userId: 'emp-assigned-1', assignedBy: null, assignedAt: null, userName: 'Assigned User' },
  ],
  predecessors: [],
  dueDate: '2026-04-15T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

const unassignedTask: Task = {
  ...baseTask,
  id: 't-200',
  title: 'Unassigned Task Step',
  assigneeId: 'emp-other-1',
  assignees: ['emp-other-1'],
  taskAssignees: [
    { taskId: 't-200', userId: 'emp-other-1', assignedBy: null, assignedAt: null, userName: 'Other User' },
  ],
};

const baseWr: WorkRequest = {
  id: 'wr-100',
  title: 'Corporate Filing 2026',
  description: 'Annual corporate filing',
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
  coAssignees: ['emp-assigned-1', 'emp-doc-1'],
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  tasks: [baseTask, unassignedTask],
};

const adminUser: UserProfile = {
  id: 'u-admin-1',
  email: 'admin@ata-lta.ph',
  name: 'Admin Boss',
  role: 'Admin',
  departments: ['Management'],
  entities: ['ATA', 'LTA'],
};

const managerUser: UserProfile = {
  id: 'u-mgr-1',
  email: 'manager@ata-lta.ph',
  name: 'Operations Manager',
  role: 'Manager',
  departments: ['Operations'],
  entities: ['ATA', 'LTA'],
};

const docOnlyUser: UserProfile = {
  id: 'emp-doc-1',
  email: 'doc@ata-lta.ph',
  name: 'Documentation Clerk',
  role: 'Staff',
  departments: ['Documentation'],
  entities: ['ATA', 'LTA'],
};

const docAssignedUser: UserProfile = {
  id: 'emp-assigned-1',
  email: 'doc.assigned@ata-lta.ph',
  name: 'Documentation Lead',
  role: 'Staff',
  departments: ['Documentation'],
  entities: ['ATA', 'LTA'],
};

const docAndOpsUser: UserProfile = {
  id: 'emp-assigned-1',
  email: 'doc.ops@ata-lta.ph',
  name: 'Cross Dept Staff',
  role: 'Staff',
  departments: ['Operations', 'Documentation'],
  entities: ['ATA', 'LTA'],
};

const accountingUser: UserProfile = {
  id: 'emp-acct-1',
  email: 'acct@ata-lta.ph',
  name: 'Accounting Officer',
  role: 'Staff',
  departments: ['Accounting'],
  entities: ['ATA', 'LTA'],
};

const opsAssignedUser: UserProfile = {
  id: 'emp-assigned-1',
  email: 'ops@ata-lta.ph',
  name: 'Operations Staff',
  role: 'Staff',
  departments: ['Operations'],
  entities: ['ATA', 'LTA'],
};

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

describe('Lane C: Task Scoping Rules (taskScope.ts)', () => {
  describe('canRequestInvoice', () => {
    it('denies Documentation users even when assigned to task', () => {
      expect(canRequestInvoice(docAssignedUser, baseTask, baseWr, [baseTask])).toBe(false);
    });

    it('denies Documentation users with role Documentation', () => {
      const docRoleUser: UserProfile = { ...docAssignedUser, role: 'Documentation', departments: [] };
      expect(canRequestInvoice(docRoleUser, baseTask, baseWr, [baseTask])).toBe(false);
    });

    it('denies multi-department users with Documentation + Operations', () => {
      expect(canRequestInvoice(docAndOpsUser, baseTask, baseWr, [baseTask])).toBe(false);
    });

    it('returns false for Admin (Admin links invoices directly)', () => {
      expect(canRequestInvoice(adminUser, baseTask, baseWr, [baseTask])).toBe(false);
    });

    it('returns false for Accounting (Accounting links invoices directly)', () => {
      expect(canRequestInvoice(accountingUser, baseTask, baseWr, [baseTask])).toBe(false);
    });

    it('allows non-Documentation assigned Operations staff to request invoice', () => {
      expect(canRequestInvoice(opsAssignedUser, baseTask, baseWr, [baseTask])).toBe(true);
    });

    it('denies unassigned users not in WR team', () => {
      const unassignedUser: UserProfile = {
        id: 'u-stranger',
        email: 'stranger@ata-lta.ph',
        name: 'Stranger',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      };
      expect(canRequestInvoice(unassignedUser, baseTask, baseWr, [baseTask])).toBe(false);
    });
  });

  describe('canLinkTransmittal', () => {
    it('requires Documentation user to be task assignee (returns true if assigned)', () => {
      expect(canLinkTransmittal(docAssignedUser, baseTask, baseWr, [baseTask, unassignedTask])).toBe(true);
    });

    it('denies Documentation user who is WR team member but NOT task assignee (eliminates WR team fallback)', () => {
      // docOnlyUser is in baseWr.coAssignees but NOT assigned to unassignedTask
      expect(canLinkTransmittal(docOnlyUser, unassignedTask, baseWr, [baseTask, unassignedTask])).toBe(false);
    });

    it('allows Admin to link transmittals without task assignment', () => {
      expect(canLinkTransmittal(adminUser, unassignedTask, baseWr, [baseTask, unassignedTask])).toBe(true);
    });

    it('allows non-Documentation assigned staff to link transmittal', () => {
      expect(canLinkTransmittal(opsAssignedUser, baseTask, baseWr, [baseTask, unassignedTask])).toBe(true);
    });

    it('denies non-Documentation unassigned staff from linking transmittal', () => {
      expect(canLinkTransmittal(opsAssignedUser, unassignedTask, baseWr, [baseTask, unassignedTask])).toBe(false);
    });
  });
});

describe('Lane C: TransmittalFormModal UI Restrictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();

    // Mock API
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'client-1', name: 'Alpha Corp', entity: 'ATA' }] }),
        });
      }
      if (u.includes('/operations/work-requests/wr-100/tasks') || u.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [baseTask, unassignedTask] }),
        });
      }
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [baseWr] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });
    });
  });

  it('filters selectable tasks for Documentation users to assigned tasks and disables blank option', async () => {
    useSessionStore.getState().setSession({
      user: docAssignedUser,
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    const secondAssignedTask: Task = {
      ...baseTask,
      id: 't-101',
      title: 'Second Assigned Task',
    };
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/work-requests/wr-100/tasks') || u.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [baseTask, secondAssignedTask, unassignedTask] }),
        });
      }
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [baseWr] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });
    });

    const { wrapper } = createHarness();
    render(
      <TransmittalFormModal
        isOpen={true}
        onClose={vi.fn()}
        prefill={{ workRequestId: 'wr-100', clientId: 'client-1' }}
      />,
      { wrapper }
    );

    // Task select trigger should be present
    const taskTrigger = await screen.findByTestId('task-select');
    expect(taskTrigger).toBeInTheDocument();

    // Submit without selecting a task should fail with validation error
    const submitBtn = screen.getByTestId('submit-transmittal-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('task-error-message')).toHaveTextContent(
        /A valid linked task is required/i
      );
    });
  });

  it('allows Admin users to submit with any selectable task', async () => {
    useSessionStore.getState().setSession({
      user: adminUser,
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createHarness();
    render(
      <TransmittalFormModal
        isOpen={true}
        onClose={vi.fn()}
        prefill={{ workRequestId: 'wr-100', clientId: 'client-1', taskId: 't-200' }}
      />,
      { wrapper }
    );

    const taskTrigger = await screen.findByTestId('task-select');
    expect(taskTrigger).toBeInTheDocument();

    // Fill valid document item
    const descInput = screen.getByTestId('item-description-input-0');
    fireEvent.change(descInput, { target: { value: 'Annual Report 2026' } });

    // Submit with task succeeds (no task-error-message)
    const submitBtn = screen.getByTestId('submit-transmittal-btn');
    fireEvent.click(submitBtn);

    expect(screen.queryByTestId('task-error-message')).toBeNull();
  });
});

describe('Lane C: OperationsPage Tab Guards & Deep-Link Normalization', () => {
  let capturedCountsFetch = false;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCountsFetch = false;
    useBlockingModalStore.getState().reset();

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations-requests/counts')) {
        capturedCountsFetch = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { pending: 3, rejected: 0, fulfilled: 1 } }),
        });
      }
      if (u.includes('/operations/work-requests/counts') || u.includes('/operations/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { active: 5, total: 10 } }),
        });
      }
      if (u.includes('/operations/templates')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }),
        });
      }
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [baseWr] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });
    });
  });

  it('allows Admin to view retainer-templates and pending-approvals tabs', async () => {
    useSessionStore.getState().setSession({
      user: adminUser,
      permissions: ['workflow:view', 'retainers:use', 'retainers:edit', 'workflow:phase_transition'],
      activeEntity: 'ATA',
    });

    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=work-requests']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('tab-work-requests')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('tab-work-requests-badge')).toHaveTextContent('5');
    });
    expect(screen.getByTestId('tab-retainer-templates')).toBeInTheDocument();
    expect(screen.getByTestId('tab-pending-approvals')).toBeInTheDocument();
    expect(capturedCountsFetch).toBe(true);
  });

  it('allows Manager with retainers:use to view retainer-templates and pending-approvals tabs', async () => {
    useSessionStore.getState().setSession({
      user: managerUser,
      permissions: ['workflow:view', 'retainers:use', 'workflow:phase_transition'],
      activeEntity: 'ATA',
    });

    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=work-requests']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('tab-work-requests')).toBeInTheDocument();
    expect(screen.getByTestId('tab-retainer-templates')).toBeInTheDocument();
    expect(screen.getByTestId('tab-pending-approvals')).toBeInTheDocument();
  });

  it('hides retainer-templates and pending-approvals tabs for Documentation-only staff and normalizes deep-links', async () => {
    useSessionStore.getState().setSession({
      user: docOnlyUser,
      permissions: ['workflow:view', 'transmittal:view', 'transmittal:create'], // Documentation role permissions: NO approval, NO retainers
      activeEntity: 'ATA',
    });

    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=pending-approvals']}>
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('tab-work-requests')).toBeInTheDocument();

    // Tabs triggers must NOT exist for Documentation-only users
    expect(screen.queryByTestId('tab-retainer-templates')).toBeNull();
    expect(screen.queryByTestId('tab-pending-approvals')).toBeNull();

    // Deep-linked pending approvals inbox must NOT be rendered
    expect(screen.queryByTestId('pending-approvals-inbox')).toBeNull();

    // Counts query must NOT have been executed
    expect(capturedCountsFetch).toBe(false);
  });

  it('normalizes unauthorized retainer-templates deep link to work-requests', async () => {
    useSessionStore.getState().setSession({
      user: docOnlyUser,
      permissions: ['workflow:view', 'transmittal:view'],
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

    expect(await screen.findByTestId('tab-work-requests')).toBeInTheDocument();
    expect(screen.queryByTestId('tab-retainer-templates')).toBeNull();
    // Retainer templates directory should not be in the DOM
    expect(screen.queryByText('Retainer Templates Directory')).toBeNull();
  });
});
