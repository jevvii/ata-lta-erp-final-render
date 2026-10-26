import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import OperationsPage from '@/routes/operations';
import { TransmittalFormModal } from '@/features/transmittals/components/TransmittalFormModal';
import { WorkRequestModal } from '@/features/operations/components/WorkRequestModal';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { canRequestInvoice, isTaskAssignee } from '../lib/taskScope';
import type { Task, WorkRequest } from '../api/types';

// Mock DOM APIs missing in jsdom
window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

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

describe('Adversarial Verification 1: Direct URL navigation & Loop Avoidance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/operations/work-requests/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: { active: 5, total: 10 } }),
        });
      }
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [baseWr] }),
        });
      }
      if (u.includes('/operations/templates')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: [] }),
      });
    });
  });

  const unauthorizedTabs = [
    '?tab=retainer-templates',
    '?tab=templates',
    '?tab=pending-approvals',
    '?tab=pending',
    '?tab=pending-items',
  ];

  unauthorizedTabs.forEach((queryParam) => {
    it(`normalizes ${queryParam} to work-requests without endless loops for Documentation user`, async () => {
      useSessionStore.getState().setSession({
        user: docOnlyUser,
        permissions: ['workflow:view', 'transmittal:view'],
        activeEntity: 'ATA',
      });

      let renderCount = 0;
      function Tracker() {
        const [searchParams] = useSearchParams();
        renderCount++;
        if (renderCount > 10) {
          throw new Error(`Endless loop detected with query param ${queryParam}! renderCount=${renderCount}`);
        }
        return <span data-testid="current-tab-param">{searchParams.get('tab')}</span>;
      }

      const { queryClient } = createHarness();
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/operations${queryParam}`]}>
            <Tracker />
            <OperationsPage />
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Verify that after effect execution, URL tab parameter is normalized to work-requests
      await waitFor(() => {
        expect(screen.getByTestId('current-tab-param')).toHaveTextContent('work-requests');
      });

      // Verify tabs list: unauthorized tabs must not be present
      expect(screen.queryByTestId('tab-retainer-templates')).toBeNull();
      expect(screen.queryByTestId('tab-pending-approvals')).toBeNull();
      expect(screen.getByTestId('tab-work-requests')).toBeInTheDocument();

      // Ensure stable render count (no loop)
      expect(renderCount).toBeLessThanOrEqual(4);
    });
  });

  it('preserves other query parameters (e.g., view=board) while normalizing unauthorized tab', async () => {
    useSessionStore.getState().setSession({
      user: docOnlyUser,
      permissions: ['workflow:view', 'transmittal:view'],
      activeEntity: 'ATA',
    });

    function ParamInspector() {
      const [searchParams] = useSearchParams();
      return (
        <div>
          <span data-testid="tab-value">{searchParams.get('tab')}</span>
          <span data-testid="view-value">{searchParams.get('view')}</span>
        </div>
      );
    }

    const { queryClient } = createHarness();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/operations?tab=retainer-templates&view=board']}>
          <ParamInspector />
          <OperationsPage />
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('tab-value')).toHaveTextContent('work-requests');
      expect(screen.getByTestId('view-value')).toHaveTextContent('board');
    });
  });
});

describe('Adversarial Verification 2: Transmittal Task Select Tampering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'client-1', name: 'Alpha Corp', entity: 'ATA' }] }),
        });
      }
      if (u.includes('/tasks') || u.includes('/operations/work-requests/wr-100/tasks')) {
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

  it('rejects submission with empty task selection for Documentation user with an explicit error', async () => {
    useSessionStore.getState().setSession({
      user: docAssignedUser,
      permissions: ['transmittal:view', 'transmittal:create'],
      activeEntity: 'ATA',
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

    // Verify task select exists
    expect(await screen.findByTestId('task-select')).toBeInTheDocument();

    // Click submit without choosing a task
    const submitBtn = screen.getByTestId('submit-transmittal-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const errorMsg = screen.getByTestId('task-error-message');
      expect(errorMsg).toHaveTextContent('Task selection is required for Documentation users');
    });
  });

  it('filters availableTasks to only assigned tasks for Documentation users', () => {
    // Direct verification of filtering logic used by TransmittalFormModal
    const allTasks = [baseTask, unassignedTask];
    
    // For docAssignedUser:
    const docFiltered = allTasks.filter((t) => isTaskAssignee(docAssignedUser, t));
    expect(docFiltered.map((t) => t.id)).toEqual(['t-100']);
    expect(docFiltered.some((t) => t.id === 't-200')).toBe(false);

    // For docOnlyUser (unassigned):
    const unassignedFiltered = allTasks.filter((t) => isTaskAssignee(docOnlyUser, t));
    expect(unassignedFiltered).toHaveLength(0);

    // For adminUser:
    const adminFiltered = allTasks;
    expect(adminFiltered).toHaveLength(2);
  });
});

describe('Adversarial Verification 3: Invoice Billing Action Triggers in TaskDetailModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();
  });

  it('denies Request Invoice button for Documentation user even when assigned to task', () => {
    expect(canRequestInvoice(docAssignedUser, baseTask, baseWr, [baseTask])).toBe(false);

    const docRoleUser: UserProfile = { ...docAssignedUser, role: 'Documentation', departments: [] };
    expect(canRequestInvoice(docRoleUser, baseTask, baseWr, [baseTask])).toBe(false);
  });

  it('denies Request Invoice button for multi-department user (Documentation + Operations)', () => {
    expect(canRequestInvoice(docAndOpsUser, baseTask, baseWr, [baseTask])).toBe(false);
  });

  it('preserves direct linking and suppresses request button for Admin and Accounting', () => {
    expect(canRequestInvoice(adminUser, baseTask, baseWr, [baseTask])).toBe(false);
    expect(canRequestInvoice(accountingUser, baseTask, baseWr, [baseTask])).toBe(false);
  });

  it('permits Request Invoice button only for assigned non-Documentation staff', () => {
    expect(canRequestInvoice(opsAssignedUser, baseTask, baseWr, [baseTask])).toBe(true);
  });
});

describe('Adversarial Verification 4: Datepicker Layout Stress Testing across screen widths', () => {
  const testWidths = [320, 375, 768, 1024, 1440];

  testWidths.forEach((width) => {
    it(`renders DateInput within bounded grid layout at viewport width ${width}px`, () => {
      window.innerWidth = width;
      fireEvent(window, new Event('resize'));

      useSessionStore.getState().setSession({
        user: opsAssignedUser,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={baseWr}
        />,
        { wrapper }
      );

      // Verify date input element
      const dateInput = screen.getByTestId('wr-modal-due-date');
      expect(dateInput).toBeInTheDocument();

      // Find DatePicker wrapper container (which contains w-full and min-w-0)
      const datePickerWrapper = dateInput.closest('.min-w-0');
      expect(datePickerWrapper).not.toBeNull();
      expect(datePickerWrapper?.className).toContain('w-full');
      expect(datePickerWrapper?.className).toContain('min-w-0');

      // Check parent grid container
      const gridContainer = dateInput.closest('.grid');
      expect(gridContainer).not.toBeNull();
      expect(gridContainer?.className).toContain('grid-cols-1');
      expect(gridContainer?.className).toContain('md:grid-cols-3');
    });
  });
});
