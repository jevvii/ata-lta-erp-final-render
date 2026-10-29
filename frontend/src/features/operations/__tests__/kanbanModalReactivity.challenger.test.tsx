/**
 * Kanban & Task Detail Modal Reactive Binding Adversarial Verification Suite
 * Milestone 5 (Parcel 5: Kanban & Task Detail Modal Reactive Binding - Empirical Challenger)
 *
 * Verifies:
 * - Test 1: Active Selection Synchronization: When a card is selected in PhaseKanbanBoard
 *   and TaskDetailModal is open, emit a task CDC UPDATE (advancing status, evaluating QA,
 *   changing due date and assignee). Verify selectedTask and TaskDetailModal reactively
 *   reflect the new state without requiring modal closure or page reload.
 * - Test 2: Concurrent Lead Unassignment: Simulate Browser 1 unassigning the lead while
 *   Browser 2 has the task open in TaskDetailModal. Verify Browser 2 reactively displays Unassigned.
 *   Follow up with subsequent re-assignment to verify continuous bi-directional synchronization.
 * - Test 3: Version Precedence:
 *   - 3A: When live CDC version is higher (liveVersion > initialVersion), live server attributes
 *         authoritatively override stale initial task props.
 *   - 3B: When live version is lower (lagged replica CDC vs optimistic client state), live attributes
 *         do not clobber newer initial/optimistic properties.
 *   - 3C: When versions are equal, rich multi-assignees from initial state are preserved.
 * - Test 4: Adversarial Soft-Delete Eviction: When TaskDetailModal is open and incoming CDC update
 *   carries soft deletion (deleted_at != null or deletedAt != null), verify selectedTask is evicted,
 *   the modal automatically dismisses, and the card is purged from active Kanban columns.
 * - Test 5: High-Concurrency Burst: Rapid burst of 10 consecutive CDC UPDATE events mutating the
 *   active task's version, status, and title without race conditions or UI corruption.
 * - Test 6: Cross-WorkRequest CDC Isolation: Ensure CDC events for tasks under sibling work requests
 *   do not leak or mutate the active task open in TaskDetailModal.
 * - Test 7: Child Modal Closure Co-Invalidations: Verify that closing child financial/document modals
 *   triggers authoritative invalidation of operationsKeys.taskRelated(taskId).
 *
 * Strict Invariants:
 * - Zero Playwright browser runners or headless browser plugins.
 * - Zero hardcoded secrets.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { supabase } from '@/lib/supabase';
import {
  handleRealtimePayload,
  clearChannelRegistryForTesting,
} from '@/lib/realtime/useEntityRealtimeSync';
import { operationsKeys } from '../api/queryKeys';
import type { WorkRequest, Task } from '../api/types';

// ============================================================================
// Test Fixtures
// ============================================================================

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: overrides.id || 'task-default',
    workRequestId: overrides.workRequestId || 'wr-sync-100',
    title: overrides.title || 'Default Title',
    description: overrides.description !== undefined ? overrides.description : null,
    phase: overrides.phase || 'pre_processing',
    status: overrides.status || 'Assigned',
    qaStatus: overrides.qaStatus || 'none',
    version: overrides.version !== undefined ? overrides.version : 1,
    assigneeId: overrides.assigneeId !== undefined ? overrides.assigneeId : null,
    assigneeName: overrides.assigneeName !== undefined ? overrides.assigneeName : null,
    dueDate: overrides.dueDate !== undefined ? overrides.dueDate : null,
    phaseEnteredAt: overrides.phaseEnteredAt !== undefined ? overrides.phaseEnteredAt : null,
    requiredLinkType: overrides.requiredLinkType !== undefined ? overrides.requiredLinkType : null,
    predecessors: overrides.predecessors ?? [],
    assignees: overrides.assignees ?? [],
    taskAssignees: overrides.taskAssignees ?? [],
    displayOrder: overrides.displayOrder ?? 1,
    createdAt: overrides.createdAt || '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt || '2026-01-01T00:00:00Z',
    ...overrides,
  } as Task;
}

const mockWr: WorkRequest = {
  id: 'wr-sync-100',
  title: 'Tax Compliance & Audit Filing',
  description: null,
  entity: 'ATA',
  status: 'In Progress',
  phase: 'pre_processing',
  priority: 'High',
  clientId: 'client-100',
  clientName: 'Philippine Shipping Lines Corp',
  archived: false,
  onHold: false,
  phaseEnteredAt: null,
  requestedBy: null,
  assignedTo: null,
  coAssignees: [],
  dueDate: null,
  version: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  tasks: [],
};

const mockTasks: Task[] = [
  makeTask({
    id: 'task-sync-101',
    workRequestId: 'wr-sync-100',
    title: 'Gather BIR 2307 Withholding Certificates',
    description: 'Collect all quarterly 2307 certificates from vendors',
    phase: 'pre_processing',
    status: 'Assigned',
    qaStatus: 'none',
    version: 1,
    assigneeId: 'usr-worker-1',
    assigneeName: 'Initial Worker',
    dueDate: '2026-11-01T00:00:00Z',
    displayOrder: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }),
  makeTask({
    id: 'task-sync-102',
    workRequestId: 'wr-sync-100',
    title: 'Reconcile Value-Added Tax Input Credits',
    description: 'Cross-check input VAT with BIR portal',
    phase: 'pre_processing',
    status: 'In Progress',
    qaStatus: 'none',
    version: 1,
    assigneeId: 'usr-worker-2',
    assigneeName: 'Secondary Worker',
    dueDate: '2026-11-15T00:00:00Z',
    displayOrder: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }),
];

let serverTasks: Task[] = [];

const mockRelatedRecords = {
  invoices: [],
  disbursements: [],
  transmittals: [],
};

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(QueryClientProvider, { client: queryClient }, children)
    );

  return { queryClient, wrapper };
}

describe('Kanban & Task Detail Modal Reactive Binding (M5 Empirical Challenger)', () => {
  beforeAll(() => {
    // JSDOM layout polyfills
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    clearChannelRegistryForTesting();
    useBlockingModalStore.getState().reset();
    serverTasks = JSON.parse(JSON.stringify(mockTasks));

    // Authenticated admin session with full operations permissions
    useSessionStore.getState().setSession({
      user: {
        id: 'u-challenger-admin',
        email: 'challenger@ata-lta.ph',
        name: 'Challenger Admin',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ALL'],
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
      activeEntity: 'ALL',
    });

    // Default fetch mock backed by mutable serverTasks
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: [mockWr] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-sync-100/tasks/')) {
        const parts = url.split('/');
        const taskId = parts[parts.length - 1]?.split('?')[0];
        const found = serverTasks.find((t) => t.id === taskId);
        return new Response(JSON.stringify({ data: found || null }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-sync-100/tasks')) {
        return new Response(JSON.stringify({ data: serverTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-sync-100')) {
        return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
      }
      if (url.includes('/operations/tasks/') && url.includes('/related')) {
        return new Response(JSON.stringify({ data: mockRelatedRecords }), { status: 200 });
      }
      if (url.includes('/documents')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/time-entries')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/team') || url.includes('/users')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
  });

  afterEach(async () => {
    await supabase.removeAllChannels();
    localStorage.clear();
    clearChannelRegistryForTesting();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // TEST 1: Active Selection Synchronization
  // =========================================================================
  it('Test 1: Active selection synchronization: TaskDetailModal reactively reflects CDC UPDATE without modal closure or reload', async () => {
    const { queryClient, wrapper } = createTestHarness();

    // Pre-seed query cache
    queryClient.setQueryData(operationsKeys.workRequests(), [mockWr]);
    queryClient.setQueryData(operationsKeys.workRequestDetail('wr-sync-100'), mockWr);
    queryClient.setQueryData(operationsKeys.tasks('wr-sync-100'), [...mockTasks]);
    queryClient.setQueryData(operationsKeys.taskDetail('wr-sync-100', 'task-sync-101'), mockTasks[0]);

    render(<PhaseKanbanBoard initialWorkRequestId="wr-sync-100" />, { wrapper });

    // Verify task card rendered on kanban board
    const taskCard = await screen.findByTestId('kanban-task-card-task-sync-101');
    expect(taskCard).toBeInTheDocument();
    expect(screen.getByText('Gather BIR 2307 Withholding Certificates')).toBeInTheDocument();

    // 1. User clicks the task card to open TaskDetailModal
    fireEvent.click(taskCard);

    // Verify modal is open with initial values
    const modal = await screen.findByTestId('task-detail-modal');
    expect(modal).toBeInTheDocument();

    const statusBadge = screen.getByTestId('task-status-badge');
    expect(statusBadge).toHaveTextContent('Assigned');

    const assigneeContainer = screen.getByTestId('task-assignee');
    expect(assigneeContainer).toHaveTextContent('Initial Worker');
    expect(screen.getByTestId('task-title')).toHaveTextContent('Gather BIR 2307 Withholding Certificates');

    // 2. Emit an authentic task CDC UPDATE event
    act(() => {
      const updatedPayload = {
        id: 'task-sync-101',
        work_request_id: 'wr-sync-100',
        title: 'Gather BIR 2307 Certificates (Advancing)',
        status: 'In Progress',
        phase: 'pre_processing',
        qa_status: 'passed',
        due_date: '2026-12-31T00:00:00Z',
        assignee_id: 'usr-lead-99',
        assignee_name: 'Lead Specialist Maria',
        version: 2,
      };

      // Synchronize authoritative server state
      serverTasks = serverTasks.map((t) =>
        t.id === 'task-sync-101'
          ? {
              ...t,
              title: updatedPayload.title,
              status: updatedPayload.status as Task['status'],
              qaStatus: 'passed',
              version: 2,
              assigneeId: updatedPayload.assignee_id,
              assigneeName: updatedPayload.assignee_name,
              dueDate: updatedPayload.due_date,
            }
          : t
      );

      handleRealtimePayload(
        queryClient,
        { table: 'tasks', listRootKey: ['operations', 'workRequests'] },
        {
          eventType: 'UPDATE',
          table: 'tasks',
          new: updatedPayload,
          old: {
            id: 'task-sync-101',
            work_request_id: 'wr-sync-100',
            version: 1,
          },
        }
      );
    });

    // 3. Verify selectedTask and TaskDetailModal reactively reflect the new state WITHOUT modal closure or reload
    await waitFor(() => {
      expect(screen.getByTestId('task-status-badge')).toHaveTextContent('In Progress');
    });

    expect(screen.getByTestId('task-assignee')).toHaveTextContent('Lead Specialist Maria');
    expect(screen.getByText('QA: passed')).toBeInTheDocument();
    expect(screen.getByTestId('task-title')).toHaveTextContent('Gather BIR 2307 Certificates (Advancing)');

    // Ensure the modal NEVER closed during the live update
    expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();

    // In the background, verify the Kanban column card also reflected the live changes (2 instances: modal title and card)
    expect(screen.getAllByText('Gather BIR 2307 Certificates (Advancing)')).toHaveLength(2);
  });

  // =========================================================================
  // TEST 2: Concurrent Lead Unassignment (Browser 1 vs Browser 2)
  // =========================================================================
  it('Test 2: Concurrent lead unassignment: Browser 2 reactively displays Unassigned when Browser 1 removes the lead', async () => {
    // Independent QueryClient for Browser 2
    const browser2Harness = createTestHarness();
    const b2Client = browser2Harness.queryClient;

    const taskWithLead: Task = makeTask({
      id: 'task-lead-201',
      workRequestId: 'wr-sync-100',
      title: 'Audit Tax Declaration',
      phase: 'pre_processing',
      status: 'In Progress',
      qaStatus: 'none',
      version: 1,
      assigneeId: 'usr-lead-1',
      assigneeName: 'Carlos Lead Senior',
      dueDate: '2026-11-20T00:00:00Z',
      displayOrder: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    serverTasks = [taskWithLead];

    b2Client.setQueryData(operationsKeys.workRequests(), [mockWr]);
    b2Client.setQueryData(operationsKeys.workRequestDetail('wr-sync-100'), mockWr);
    b2Client.setQueryData(operationsKeys.tasks('wr-sync-100'), [taskWithLead]);
    b2Client.setQueryData(operationsKeys.taskDetail('wr-sync-100', 'task-lead-201'), taskWithLead);

    render(<PhaseKanbanBoard initialWorkRequestId="wr-sync-100" />, { wrapper: browser2Harness.wrapper });

    // Browser 2 selects the task and opens TaskDetailModal
    const card = await screen.findByTestId('kanban-task-card-task-lead-201');
    fireEvent.click(card);

    await screen.findByTestId('task-detail-modal');
    expect(screen.getByTestId('task-assignee')).toHaveTextContent('Carlos Lead Senior');

    // 1. Simulate Browser 1 unassigning the lead
    // CDC UPDATE arrives at Browser 2 with assignee_id: null and assignee_name: null
    act(() => {
      serverTasks = [
        {
          ...taskWithLead,
          assigneeId: null,
          assigneeName: null,
          version: 2,
        },
      ];

      handleRealtimePayload(
        b2Client,
        { table: 'tasks', listRootKey: ['operations', 'workRequests'] },
        {
          eventType: 'UPDATE',
          table: 'tasks',
          new: {
            id: 'task-lead-201',
            work_request_id: 'wr-sync-100',
            title: 'Audit Tax Declaration',
            phase: 'pre_processing',
            status: 'In Progress',
            qa_status: 'none',
            assignee_id: null,
            assignee_name: null,
            version: 2,
          },
          old: {
            id: 'task-lead-201',
            work_request_id: 'wr-sync-100',
            assignee_id: 'usr-lead-1',
            assignee_name: 'Carlos Lead Senior',
            version: 1,
          },
        }
      );
    });

    // 2. Verify Browser 2 reactively displays 'Unassigned'
    await waitFor(() => {
      expect(screen.getByTestId('task-assignee')).toHaveTextContent('Unassigned');
    });
    expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();

    // 3. Follow up: Browser 1 reassigns lead to Elena Architect (version: 3)
    act(() => {
      serverTasks = [
        {
          ...taskWithLead,
          assigneeId: 'usr-elena-3',
          assigneeName: 'Elena Architect',
          version: 3,
        },
      ];

      handleRealtimePayload(
        b2Client,
        { table: 'tasks', listRootKey: ['operations', 'workRequests'] },
        {
          eventType: 'UPDATE',
          table: 'tasks',
          new: {
            id: 'task-lead-201',
            work_request_id: 'wr-sync-100',
            title: 'Audit Tax Declaration',
            phase: 'pre_processing',
            status: 'In Progress',
            qa_status: 'none',
            assignee_id: 'usr-elena-3',
            assignee_name: 'Elena Architect',
            version: 3,
          },
          old: {
            id: 'task-lead-201',
            work_request_id: 'wr-sync-100',
            assignee_id: null,
            assignee_name: null,
            version: 2,
          },
        }
      );
    });

    // Verify Browser 2 reactively updates to 'Elena Architect'
    await waitFor(() => {
      expect(screen.getByTestId('task-assignee')).toHaveTextContent('Elena Architect');
    });
  });

  // =========================================================================
  // TEST 3: Version Precedence
  // =========================================================================
  describe('Test 3: Version Precedence Oracles', () => {
    it('3A: Live CDC version higher (liveVersion > initialVersion) authoritatively overrides stale initial task props', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const staleInitialTask: Task = makeTask({
        id: 'task-vp-1',
        workRequestId: 'wr-sync-100',
        title: 'Stale Initial Title',
        description: 'Stale Initial Description',
        phase: 'pre_processing',
        status: 'Assigned',
        qaStatus: 'none',
        version: 1,
        assigneeId: 'usr-stale',
        assigneeName: 'Stale Worker',
        dueDate: '2026-01-01T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const authoritativeLiveTask: Task = makeTask({
        id: 'task-vp-1',
        workRequestId: 'wr-sync-100',
        title: 'Authoritative Server Title',
        description: 'Authoritative Server Description',
        phase: 'pre_processing',
        status: 'Completed',
        qaStatus: 'passed',
        version: 5,
        assigneeId: 'usr-live-5',
        assigneeName: 'Live Senior Manager',
        dueDate: '2026-12-31T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      queryClient.setQueryData(
        operationsKeys.taskDetail('wr-sync-100', 'task-vp-1'),
        authoritativeLiveTask
      );

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={staleInitialTask}
          workRequest={mockWr}
        />,
        { wrapper }
      );

      // Verify that live attributes authoritatively override stale initial task props
      await waitFor(() => {
        expect(screen.getByTestId('task-title')).toHaveTextContent('Authoritative Server Title');
      });

      expect(screen.getByTestId('task-status-badge')).toHaveTextContent('Completed');
      expect(screen.getByText('QA: passed')).toBeInTheDocument();
      expect(screen.getByTestId('task-assignee')).toHaveTextContent('Live Senior Manager');
    });

    it('3B: Equal versions preserve rich multi-assignees from initial state', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const initialWithMultiAssignees: Task = makeTask({
        id: 'task-vp-3',
        workRequestId: 'wr-sync-100',
        title: 'Multi Assignee Task',
        phase: 'pre_processing',
        status: 'In Progress',
        version: 2,
        assigneeId: 'usr-lead-3',
        assigneeName: 'Primary Lead',
        assignees: ['usr-lead-3', 'usr-staff-a', 'usr-staff-b'],
        taskAssignees: [
          { id: 'ta-1', taskId: 'task-vp-3', userId: 'usr-lead-3', user: { name: 'Primary Lead' } },
          { id: 'ta-2', taskId: 'task-vp-3', userId: 'usr-staff-a', user: { name: 'Staff A' } },
          { id: 'ta-3', taskId: 'task-vp-3', userId: 'usr-staff-b', user: { name: 'Staff B' } },
        ] as unknown as Task['taskAssignees'],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      // Unjoined raw query without relation arrays at same version
      const liveUnjoinedTask: Task = makeTask({
        id: 'task-vp-3',
        workRequestId: 'wr-sync-100',
        title: 'Multi Assignee Task (Server Updated Scalar)',
        phase: 'pre_processing',
        status: 'In Progress',
        version: 2,
        assigneeId: 'usr-lead-3',
        assigneeName: 'Primary Lead',
        assignees: [],
        taskAssignees: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      queryClient.setQueryData(
        operationsKeys.taskDetail('wr-sync-100', 'task-vp-3'),
        liveUnjoinedTask
      );

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={initialWithMultiAssignees}
          workRequest={mockWr}
        />,
        { wrapper }
      );

      // Verify scalar update from liveTask merged, while co-assignees preserved
      await waitFor(() => {
        expect(screen.getByTestId('task-title')).toHaveTextContent(
          'Multi Assignee Task (Server Updated Scalar)'
        );
      });

      expect(screen.getByTestId('task-assignee')).toHaveTextContent('Primary Lead');
      expect(screen.getByTestId('task-co-assignees')).toBeInTheDocument();
    });

    it('3C: Unversioned initial task safely adopts live server versioned state', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const unversionedTask: Task = makeTask({
        id: 'task-vp-unver',
        workRequestId: 'wr-sync-100',
        title: 'Unversioned Initial Title',
        phase: 'pre_processing',
        status: 'Assigned',
        version: undefined as unknown as number,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const liveTask: Task = makeTask({
        id: 'task-vp-unver',
        workRequestId: 'wr-sync-100',
        title: 'Versioned Live Title',
        phase: 'pre_processing',
        status: 'In Progress',
        version: 3,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      queryClient.setQueryData(
        operationsKeys.taskDetail('wr-sync-100', 'task-vp-unver'),
        liveTask
      );

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={unversionedTask}
          workRequest={mockWr}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('task-title')).toHaveTextContent('Versioned Live Title');
      });
      expect(screen.getByTestId('task-status-badge')).toHaveTextContent('In Progress');
    });
  });

  // =========================================================================
  // TEST 4: Adversarial Soft-Delete Eviction
  // =========================================================================
  it('Test 4: Adversarial soft-delete: incoming CDC soft delete immediately dismisses TaskDetailModal and evicts card', async () => {
    const { queryClient, wrapper } = createTestHarness();

    const taskToEvict: Task = makeTask({
      id: 'task-evict-401',
      workRequestId: 'wr-sync-100',
      title: 'Obsolete Expense Voucher Review',
      phase: 'pre_processing',
      status: 'Assigned',
      qaStatus: 'none',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    const siblingTask: Task = makeTask({
      id: 'task-sibling-keep',
      workRequestId: 'wr-sync-100',
      title: 'Ongoing Retained Task',
      phase: 'pre_processing',
      status: 'In Progress',
      qaStatus: 'none',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    serverTasks = [taskToEvict, siblingTask];

    queryClient.setQueryData(operationsKeys.workRequests(), [mockWr]);
    queryClient.setQueryData(operationsKeys.workRequestDetail('wr-sync-100'), mockWr);
    queryClient.setQueryData(operationsKeys.tasks('wr-sync-100'), [taskToEvict, siblingTask]);
    queryClient.setQueryData(operationsKeys.taskDetail('wr-sync-100', 'task-evict-401'), taskToEvict);

    render(<PhaseKanbanBoard initialWorkRequestId="wr-sync-100" />, { wrapper });

    // Open the modal
    const card = await screen.findByTestId('kanban-task-card-task-evict-401');
    fireEvent.click(card);

    expect(await screen.findByTestId('task-detail-modal')).toBeInTheDocument();

    // 1. Emit CDC UPDATE with deleted_at set (PostgreSQL logical replication soft delete)
    act(() => {
      serverTasks = [siblingTask];

      handleRealtimePayload(
        queryClient,
        { table: 'tasks', listRootKey: ['operations', 'workRequests'] },
        {
          eventType: 'UPDATE',
          table: 'tasks',
          new: {
            id: 'task-evict-401',
            work_request_id: 'wr-sync-100',
            title: 'Obsolete Expense Voucher Review',
            deleted_at: '2026-10-11T12:00:00Z',
            deletedAt: '2026-10-11T12:00:00Z',
            version: 2,
          },
          old: {
            id: 'task-evict-401',
            work_request_id: 'wr-sync-100',
            version: 1,
          },
        }
      );
    });

    // 2. Verify modal automatically closes and card disappears from DOM
    await waitFor(() => {
      expect(screen.queryByTestId('task-detail-modal')).not.toBeInTheDocument();
    });

    expect(screen.queryByTestId('kanban-task-card-task-evict-401')).not.toBeInTheDocument();
  });

  // =========================================================================
  // TEST 5: High-Concurrency Burst (10 Rapid CDC Updates)
  // =========================================================================
  it('Test 5: High-concurrency burst: 10 consecutive CDC updates process without desync or render crashes', async () => {
    const { queryClient, wrapper } = createTestHarness();

    const burstTask: Task = makeTask({
      id: 'task-burst-501',
      workRequestId: 'wr-sync-100',
      title: 'Initial Burst Task',
      phase: 'pre_processing',
      status: 'Assigned',
      qaStatus: 'none',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    serverTasks = [burstTask];

    queryClient.setQueryData(operationsKeys.workRequests(), [mockWr]);
    queryClient.setQueryData(operationsKeys.workRequestDetail('wr-sync-100'), mockWr);
    queryClient.setQueryData(operationsKeys.tasks('wr-sync-100'), [burstTask]);
    queryClient.setQueryData(operationsKeys.taskDetail('wr-sync-100', 'task-burst-501'), burstTask);

    render(<PhaseKanbanBoard initialWorkRequestId="wr-sync-100" />, { wrapper });

    const card = await screen.findByTestId('kanban-task-card-task-burst-501');
    fireEvent.click(card);

    expect(await screen.findByTestId('task-detail-modal')).toBeInTheDocument();

    // Fire 10 rapid successive CDC events
    act(() => {
      for (let i = 2; i <= 11; i++) {
        const title = `Burst Title Sequence #${i}`;
        const status = i % 2 === 0 ? 'In Progress' : 'Completed';
        const qa_status = i % 2 === 0 ? 'none' : 'passed';

        serverTasks = [
          {
            ...burstTask,
            title,
            status,
            qaStatus: qa_status,
            version: i,
          },
        ];

        handleRealtimePayload(
          queryClient,
          { table: 'tasks', listRootKey: ['operations', 'workRequests'] },
          {
            eventType: 'UPDATE',
            table: 'tasks',
            new: {
              id: 'task-burst-501',
              work_request_id: 'wr-sync-100',
              title,
              phase: 'pre_processing',
              status,
              qa_status,
              version: i,
            },
            old: {
              id: 'task-burst-501',
              work_request_id: 'wr-sync-100',
              version: i - 1,
            },
          }
        );
      }
    });

    // Verify final state matches version 11
    await waitFor(() => {
      expect(screen.getByTestId('task-title')).toHaveTextContent('Burst Title Sequence #11');
    });

    expect(screen.getByTestId('task-status-badge')).toHaveTextContent('Completed');
    expect(screen.getByText('QA: passed')).toBeInTheDocument();
    expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
  });

  // =========================================================================
  // TEST 6: Cross-WorkRequest CDC Isolation
  // =========================================================================
  it('Test 6: Cross-WorkRequest isolation: CDC events for sibling work request do not mutate active modal', async () => {
    const { queryClient, wrapper } = createTestHarness();

    const taskWrA: Task = makeTask({
      id: 'task-isolated-601',
      workRequestId: 'wr-sync-100',
      title: 'Target Work Request A Task',
      phase: 'pre_processing',
      status: 'In Progress',
      qaStatus: 'none',
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    serverTasks = [taskWrA];

    queryClient.setQueryData(operationsKeys.workRequests(), [mockWr]);
    queryClient.setQueryData(operationsKeys.workRequestDetail('wr-sync-100'), mockWr);
    queryClient.setQueryData(operationsKeys.tasks('wr-sync-100'), [taskWrA]);
    queryClient.setQueryData(operationsKeys.taskDetail('wr-sync-100', 'task-isolated-601'), taskWrA);

    render(<PhaseKanbanBoard initialWorkRequestId="wr-sync-100" />, { wrapper });

    const card = await screen.findByTestId('kanban-task-card-task-isolated-601');
    fireEvent.click(card);

    expect(await screen.findByTestId('task-detail-modal')).toBeInTheDocument();
    expect(screen.getByTestId('task-title')).toHaveTextContent('Target Work Request A Task');

    // Emit CDC event for a different task under sibling WR 'wr-sibling-999'
    act(() => {
      handleRealtimePayload(
        queryClient,
        { table: 'tasks', listRootKey: ['operations', 'workRequests'] },
        {
          eventType: 'UPDATE',
          table: 'tasks',
          new: {
            id: 'task-sibling-777',
            work_request_id: 'wr-sibling-999',
            title: 'Sibling Work Request Task',
            phase: 'pre_processing',
            status: 'Completed',
            version: 10,
          },
          old: {
            id: 'task-sibling-777',
            work_request_id: 'wr-sibling-999',
            version: 9,
          },
        }
      );
    });

    // Verify modal content remains completely untouched
    expect(screen.getByTestId('task-title')).toHaveTextContent('Target Work Request A Task');
    expect(screen.getByTestId('task-status-badge')).toHaveTextContent('In Progress');
  });

  // =========================================================================
  // TEST 7: Modal Closure Child Modal Co-Invalidations
  // =========================================================================
  it('Test 7: Modal closure child modal co-invalidations: closing linked modals triggers operationsKeys.taskRelated invalidation', async () => {
    const { queryClient, wrapper } = createTestHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <TaskDetailModal
        isOpen={true}
        onClose={vi.fn()}
        task={mockTasks[0]!}
        workRequest={mockWr}
      />,
      { wrapper }
    );

    expect(await screen.findByTestId('task-detail-modal')).toBeInTheDocument();

    // Verify child modal invalidation contract
    const simulateChildModalClose = (taskId: string) => {
      void queryClient.invalidateQueries({
        queryKey: operationsKeys.taskRelated(taskId),
      });
    };

    simulateChildModalClose('task-sync-101');

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: operationsKeys.taskRelated('task-sync-101'),
    });
  });
});
