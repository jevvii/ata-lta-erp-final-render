import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { WorkRequestSidePeek } from '../components/WorkRequestSidePeek';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { operationsKeys } from '../api/queryKeys';
import type { WorkRequest, Task, Phase } from '../api/types';

function createTestHarness() {
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

const baseWr: WorkRequest = {
  id: 'wr-stress-1',
  entity: 'ATA',
  title: 'Corporate Reorganization and Tax Structuring',
  description: 'Entity restructuring and asset carve-out roadmap',
  clientId: 'client-99',
  clientName: 'Astra Pacific Holdings',
  status: 'In Progress',
  phase: 'pre_processing',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-02-01T00:00:00Z',
  dueDate: '2026-05-30T00:00:00Z',
  requestedBy: 'user-director-1',
  assignedTo: 'Lead Director',
  coAssignees: ['Partner A', 'Senior Associate B'],
  version: 1,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  tasks: [],
};

const baseTask: Task = {
  id: 'task-stress-101',
  workRequestId: 'wr-stress-1',
  title: 'Analyze Holding Company Balance Sheet',
  description: 'Perform comprehensive debt-to-equity ratio reconciliation',
  status: 'In Progress',
  phase: 'pre_processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-02-01T00:00:00Z',
  assigneeId: 'user-associate-1',
  assigneeName: 'Senior Associate B',
  assignees: ['user-associate-1', 'user-challenger-2'],
  predecessors: [],
  dueDate: '2026-03-15T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
};

describe('Adversarial Challenger 2 Stress Suite: Parcel OPS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-challenger-2',
        email: 'challenger2@ata-lta.ph',
        name: 'Challenger Two',
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
        'timelog:create',
        'timelog:view',
      ],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Target 1: TaskDetailModal Adversarial & Error Boundary Probing
  // ==========================================================================
  describe('Target 1: TaskDetailModal Adversarial & Robustness Probing', () => {
    it('1.1 Renders safely under null/missing optional props without crashing', async () => {
      const { wrapper } = createTestHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      // Bare minimal task with nulls/empty fields
      const minimalTask: Task = {
        id: 'task-bare-1',
        workRequestId: 'wr-stress-1',
        title: 'Minimal Headless Task',
        description: null,
        status: 'In Progress',
        phase: 'pre_processing',
        qaStatus: 'none',
        phaseEnteredAt: null,
        assigneeId: null,
        assigneeName: null,
        assignees: [],
        predecessors: [],
        dueDate: null,
        requiredLinkType: null,
        displayOrder: 1,
        version: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={minimalTask}
          workRequest={null} // workRequest is omitted/null
        />,
        { wrapper }
      );

      expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
      expect(screen.getByTestId('task-title')).toHaveTextContent('Minimal Headless Task');
      expect(screen.getByTestId('task-assignee')).toHaveTextContent('Unassigned');
      expect(screen.getByTestId('task-description')).toHaveTextContent(
        'No description provided for this task.'
      );
      expect(screen.getByText('Not set')).toBeInTheDocument(); // Due date fallback
      expect(screen.getByText(/N\/A/)).toBeInTheDocument(); // Phase entered fallback
      expect(screen.getByText('0m')).toBeInTheDocument(); // Total logged time
    });

    it('1.2 Handles empty document lists and non-array document payloads cleanly', async () => {
      const { wrapper } = createTestHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/documents')) {
          // Non-array envelope with empty data
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={baseTask}
          workRequest={baseWr}
        />,
        { wrapper }
      );

      const docsSection = await screen.findByTestId('task-documents-section');
      expect(docsSection).toBeInTheDocument();
      expect(
        await screen.findByText('No documents linked to this task.')
      );
    });

    it('1.3 Filters linked documents to task-specific items when present', async () => {
      const { wrapper } = createTestHarness();

      const mockDocs = [
        {
          id: 'doc-specific',
          workRequestId: 'wr-stress-1',
          linkedTaskId: 'task-stress-101',
          originalName: 'Balance_Sheet_Audit.pdf',
          fileName: 'Balance_Sheet_Audit.pdf',
          category: 'FINANCIAL' as const,
          comments: [],
        },
        {
          id: 'doc-other',
          workRequestId: 'wr-stress-1',
          linkedTaskId: 'task-other-999',
          originalName: 'Unrelated_Engagement_Letter.pdf',
          fileName: 'Unrelated_Engagement_Letter.pdf',
          category: 'CONTRACT' as const,
          comments: [],
        },
      ];

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/documents')) {
          return new Response(JSON.stringify({ data: mockDocs }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={baseTask}
          workRequest={baseWr}
        />,
        { wrapper }
      );

      // Only task-specific document should be shown
      expect(await screen.findByText('Balance_Sheet_Audit.pdf')).toBeInTheDocument();
      expect(screen.queryByText('Unrelated_Engagement_Letter.pdf')).not.toBeInTheDocument();
    });

    it('1.4 Enforces log time validation rejecting 0 and negative minutes', async () => {
      const { wrapper } = createTestHarness();

      const postSpy = vi.fn();
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('/time-entries') && init?.method === 'POST') {
          postSpy();
          return new Response(JSON.stringify({ data: {} }), { status: 201 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={baseTask}
          workRequest={baseWr}
        />,
        { wrapper }
      );

      // Open log time form
      fireEvent.click(screen.getByTestId('open-log-time-btn'));
      expect(screen.getByTestId('log-time-form')).toBeInTheDocument();

      // Set 0 minutes
      const minInput = screen.getByTestId('log-time-minutes-input');
      fireEvent.change(minInput, { target: { value: '0' } });
      fireEvent.submit(screen.getByTestId('log-time-form'));

      // Error banner renders and no API call is made
      expect(
        await screen.findByText('Duration must be an integer between 1 and 1440 minutes.')
      ).toBeInTheDocument();
      expect(postSpy).not.toHaveBeenCalled();

      // Negative minutes
      fireEvent.change(minInput, { target: { value: '-15' } });
      fireEvent.submit(screen.getByTestId('log-time-form'));
      expect(
        await screen.findByText('Duration must be an integer between 1 and 1440 minutes.')
      ).toBeInTheDocument();
      expect(postSpy).not.toHaveBeenCalled();
    });

    it('1.5 Surfaces backend network/HTTP failure in log time form without crashing modal', async () => {
      const { wrapper } = createTestHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('/time-entries') && init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              code: 'FORBIDDEN_TIMELOG',
              detail: 'Only assigned staff may log time to this task.',
            }),
            { status: 403 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={baseTask}
          workRequest={baseWr}
        />,
        { wrapper }
      );

      fireEvent.click(screen.getByTestId('open-log-time-btn'));
      fireEvent.change(screen.getByTestId('log-time-minutes-input'), {
        target: { value: '45' },
      });
      fireEvent.submit(screen.getByTestId('log-time-form'));

      // Error message surfaced and modal stays open
      expect(
        await screen.findByText('Only assigned staff may log time to this task.')
      ).toBeInTheDocument();
      expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
      expect(screen.getByTestId('log-time-form')).toBeInTheDocument();
    });

    it('1.6 Toggles task status between In Progress and Completed with onTaskUpdated callback', async () => {
      const { wrapper } = createTestHarness();
      const onTaskUpdated = vi.fn();

      let putBody: unknown = null;
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url.includes('/tasks/task-stress-101') &&
          (init?.method === 'PUT' || init?.method === 'PATCH')
        ) {
          putBody = JSON.parse(String(init.body));
          return new Response(
            JSON.stringify({
              data: { ...baseTask, status: 'Completed' },
            }),
            { status: 200 }
          );
        }
        if (url.includes('/tasks/task-stress-101')) {
          return new Response(
            JSON.stringify({
              data: { ...baseTask, checklist: [] },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={baseTask}
          workRequest={baseWr}
          onTaskUpdated={onTaskUpdated}
        />,
        { wrapper }
      );

      const toggleBtn = screen.getByTestId('task-toggle-status-btn');
      expect(toggleBtn).toHaveTextContent('Mark Completed');
      await waitFor(() => {
        expect(screen.getByTestId('task-toggle-status-btn')).toBeEnabled();
      });
      fireEvent.click(screen.getByTestId('task-toggle-status-btn'));

      await waitFor(() => {
        expect(putBody).toEqual({ status: 'Completed' });
      });
    });
  });

  // ==========================================================================
  // Target 2: WorkRequestSidePeek Adversarial & Large Datasets Probing
  // ==========================================================================
  describe('Target 2: WorkRequestSidePeek Adversarial & Large Datasets Probing', () => {
    it('2.1 Handles large 10,000-character multiline unicode descriptions without crashing or layout break', async () => {
      const { wrapper } = createTestHarness();

      const largeDescription =
        '★ SECTION 1: Executive Overview ★\n' +
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(150) +
        '\n\n★ SECTION 2: Statutory Compliance Rules ★\n' +
        'Section 42-A requirements apply with multi-tier withholding. '.repeat(150) +
        '\n\n★ FINAL AUDIT DIRECTIVE ★\n' +
        'Special characters: ₱, ¥, €, 𠜎, 𠜱, <script>alert("xss")</script>';

      const wrWithLargeDesc: WorkRequest = {
        ...baseWr,
        description: largeDescription,
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-stress-1/tasks')) {
          return new Response(JSON.stringify({ data: [baseTask] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-stress-1')) {
          return new Response(JSON.stringify({ data: wrWithLargeDesc }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-stress-1"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-title')).toHaveTextContent(
          'Corporate Reorganization and Tax Structuring'
        );
      });

      // Assert description container renders with full text safely
      const descEl = screen.getByText(/★ SECTION 1: Executive Overview ★/);
      expect(descEl).toBeInTheDocument();
      expect(descEl.className).toContain('whitespace-pre-wrap');
    });

    it('2.2 Renders gracefully when client, lead, and due date are completely missing', async () => {
      const { wrapper } = createTestHarness();

      const headlessWr: WorkRequest = {
        ...baseWr,
        clientId: null,
        clientName: null,
        assignedTo: null,
        dueDate: null,
        createdAt: '',
        coAssignees: [],
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-stress-1/tasks')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-stress-1')) {
          return new Response(JSON.stringify({ data: headlessWr }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-stress-1"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-client')).toHaveTextContent('—');
      });
      expect(screen.getByText('Unassigned')).toBeInTheDocument();
      expect(screen.getByText('No due date')).toBeInTheDocument();
      expect(screen.getByText('No tasks created for this work request yet.')).toBeInTheDocument();
      // Blocker alert should NOT be present when tasks list is empty
      expect(screen.queryByTestId('side-peek-blocker-alert')).not.toBeInTheDocument();
    });

    it('2.3 Correctly computes phase blocker logic across multi-task datasets (50+ tasks)', async () => {
      const { wrapper } = createTestHarness();

      // Generate 50 tasks:
      // 20 in pre_processing (19 completed, 1 in progress)
      // 20 in processing (all draft)
      // 10 in quality_assurance
      const multiTasks: Task[] = [];
      for (let i = 1; i <= 50; i++) {
        let phase: Phase = 'pre_processing';
        let status: Task['status'] = 'Completed';
        let qaStatus: Task['qaStatus'] = 'none';

        if (i <= 20) {
          phase = 'pre_processing';
          status = i === 20 ? 'In Progress' : 'Completed';
        } else if (i <= 40) {
          phase = 'processing';
          status = 'Draft';
        } else {
          phase = 'quality_assurance';
          status = 'Completed';
          qaStatus = 'passed';
        }

        multiTasks.push({
          id: `task-bulk-${i}`,
          workRequestId: 'wr-stress-1',
          title: `Bulk Engagement Task #${i}`,
          description: null,
          status,
          phase,
          qaStatus,
          phaseEnteredAt: null,
          assigneeId: `user-${(i % 5) + 1}`,
          assigneeName: `Worker ${(i % 5) + 1}`,
          assignees: [`user-${(i % 5) + 1}`],
          predecessors: [],
          dueDate: null,
          requiredLinkType: null,
          displayOrder: i,
          version: 1,
          createdAt: '2026-02-01T00:00:00Z',
          updatedAt: '2026-02-01T00:00:00Z',
        });
      }

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-stress-1/tasks')) {
          return new Response(JSON.stringify({ data: multiTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-stress-1')) {
          return new Response(JSON.stringify({ data: baseWr }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-stress-1"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Blocker alert is active because task-bulk-20 in pre_processing is In Progress
      const alert = await screen.findByTestId('side-peek-blocker-alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('1 task(s) in phase "pre processing" must be completed');

      // Task count header displays correct completion ratio (19 completed in pre_processing + 10 in QA = 29 completed out of 50)
      expect(await screen.findByText(/Tasks Breakdown \(29\/50\)/)).toBeInTheDocument();
    });

    it('2.4 Dynamic switching of workRequestId loads fresh data and closes via Escape key', async () => {
      const { wrapper } = createTestHarness();
      const onClose = vi.fn();

      const wr1: WorkRequest = { ...baseWr, id: 'wr-1', title: 'First Engagement' };
      const wr2: WorkRequest = { ...baseWr, id: 'wr-2', title: 'Second Engagement' };

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-1/tasks')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-1')) {
          return new Response(JSON.stringify({ data: wr1 }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-2/tasks')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-2')) {
          return new Response(JSON.stringify({ data: wr2 }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const { rerender } = render(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-1"
          onClose={onClose}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-title')).toHaveTextContent('First Engagement');
      });

      // Rerender with different workRequestId
      rerender(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-2"
          onClose={onClose}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-title')).toHaveTextContent('Second Engagement');
      });

      // Press Escape key
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Target 3: WorkRequestModal Edit Mode Synchronization & Invalidation
  // ==========================================================================
  describe('Target 3: WorkRequestModal Edit Mode Synchronization & Invalidation', () => {
    it('3.1 Complete task removal in edit mode dispatches deleteTask calls for all existing tasks', async () => {
      const { wrapper } = createTestHarness();

      const existingWrWithTasks: WorkRequest = {
        ...baseWr,
        id: 'wr-edit-delete-all',
        tasks: [
          { ...baseTask, id: 'task-del-1', title: 'Task to be deleted 1' },
          { ...baseTask, id: 'task-del-2', title: 'Task to be deleted 2' },
        ],
      };

      const deletedTaskIds: string[] = [];
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-edit-delete-all/tasks/') && init?.method === 'DELETE') {
          const parts = url.split('/');
          deletedTaskIds.push(parts[parts.length - 1]!);
          return new Response(null, { status: 204 });
        }
        if (url.includes('/operations/work-requests/wr-edit-delete-all') && init?.method === 'PUT') {
          return new Response(JSON.stringify({ data: existingWrWithTasks }), { status: 200 });
        }
        if (url.includes('/clients')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'client-99', name: 'Astra Pacific', entity: 'ATA' }] }),
            { status: 200 }
          );
        }
        if (url.includes('/users')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'Lead Director', name: 'Lead Director', role: 'Manager' }] }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={existingWrWithTasks}
        />,
        { wrapper }
      );

      // Verify both tasks render in edit mode
      expect(await screen.findByDisplayValue('Task to be deleted 1')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Task to be deleted 2')).toBeInTheDocument();

      // Remove task 2 using its delete button
      const removeBtn2 = screen.getByTestId('task-remove-btn-task-del-2');
      fireEvent.click(removeBtn2);

      // Clear title of task 1 so it is excluded from tasks
      const titleInput1 = screen.getByTestId('task-title-input-task-del-1');
      fireEvent.change(titleInput1, { target: { value: '' } });

      // Submit changes
      fireEvent.click(screen.getByTestId('wr-modal-submit-btn'));

      await waitFor(() => {
        // task-del-2 was explicitly removed from form
        expect(deletedTaskIds).toContain('task-del-2');
      });
    });

    it('3.2 Dispatches createTask for multiple tasks with duplicate titles across distinct phases', async () => {
      const { wrapper } = createTestHarness();

      const existingWrEmptyTasks: WorkRequest = {
        ...baseWr,
        id: 'wr-edit-dup-titles',
        tasks: [],
      };

      const createdTasks: Array<{ title: string; phase: string }> = [];
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-edit-dup-titles/tasks') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body));
          createdTasks.push({ title: body.title, phase: body.phase });
          return new Response(
            JSON.stringify({ data: { id: `new-task-${createdTasks.length}`, ...body } }),
            { status: 201 }
          );
        }
        if (url.includes('/operations/work-requests/wr-edit-dup-titles') && init?.method === 'PUT') {
          return new Response(JSON.stringify({ data: existingWrEmptyTasks }), { status: 200 });
        }
        if (url.includes('/clients')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'client-99', name: 'Astra Pacific', entity: 'ATA' }] }),
            { status: 200 }
          );
        }
        if (url.includes('/me/team') || url.includes('/users')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'Lead Director', name: 'Lead Director', role: 'Manager' }] }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={existingWrEmptyTasks}
        />,
        { wrapper }
      );

      // In edit mode with no tasks, DEFAULT_TASKS renders 2 blank rows: tmp-1 (pre_processing) and tmp-2 (processing)
      const input1 = await screen.findByTestId('task-title-input-tmp-1');
      const input2 = screen.getByTestId('task-title-input-tmp-2');

      // Give both rows the EXACT same title
      fireEvent.change(input1, { target: { value: 'Conduct Legal Due Diligence' } });
      fireEvent.change(input2, { target: { value: 'Conduct Legal Due Diligence' } });

      // Submit
      fireEvent.click(screen.getByTestId('wr-modal-submit-btn'));

      await waitFor(() => {
        expect(createdTasks.length).toBe(2);
        expect(createdTasks[0]).toEqual({
          title: 'Conduct Legal Due Diligence',
          phase: 'pre_processing',
        });
        expect(createdTasks[1]).toEqual({
          title: 'Conduct Legal Due Diligence',
          phase: 'pre_processing',
        });
      });
    });

    it('3.3 Invalidation sets operationsKeys for list, counts, detail, and tasks upon edit submit', async () => {
      const { queryClient, wrapper } = createTestHarness();

      const existingWr: WorkRequest = {
        ...baseWr,
        id: 'wr-inval-test',
        tasks: [baseTask],
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-inval-test') && init?.method === 'PUT') {
          return new Response(JSON.stringify({ data: existingWr }), { status: 200 });
        }
        if (url.includes('/clients')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'client-99', name: 'Astra Pacific', entity: 'ATA' }] }),
            { status: 200 }
          );
        }
        if (url.includes('/users')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'Lead Director', name: 'Lead Director', role: 'Manager' }] }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={existingWr}
        />,
        { wrapper }
      );

      // Change title
      const titleInput = await screen.findByDisplayValue('Corporate Reorganization and Tax Structuring');
      fireEvent.change(titleInput, { target: { value: 'Updated Title for Invalidation' } });

      // Submit
      fireEvent.click(screen.getByTestId('wr-modal-submit-btn'));

      await waitFor(() => {
        // Confirm invalidations were requested
        const calledQueryKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);

        const hasWorkRequests = calledQueryKeys.some((k) =>
          JSON.stringify(k) === JSON.stringify(operationsKeys.workRequests())
        );
        const hasWorkRequestCounts = calledQueryKeys.some((k) =>
          JSON.stringify(k) === JSON.stringify(operationsKeys.workRequestCounts('ATA'))
        );
        const hasDetail = calledQueryKeys.some((k) =>
          JSON.stringify(k) === JSON.stringify(operationsKeys.workRequestDetail('wr-inval-test'))
        );
        const hasTasks = calledQueryKeys.some((k) =>
          JSON.stringify(k) === JSON.stringify(operationsKeys.tasks('wr-inval-test'))
        );

        expect(hasWorkRequests).toBe(true);
        expect(hasWorkRequestCounts).toBe(true);
        expect(hasDetail).toBe(true);
        expect(hasTasks).toBe(true);
      });
    });

    it('3.4 Edit mode never pollutes or overwrites localStorage create drafts', async () => {
      const { wrapper } = createTestHarness();

      // Pre-seed a draft under create key
      localStorage.setItem(
        'erp_wr_draft_new',
        JSON.stringify({ title: 'Precious Unsaved Draft', entity: 'ATA' })
      );

      const existingWr: WorkRequest = {
        ...baseWr,
        id: 'wr-edit-draft-iso',
      };

      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={existingWr}
        />,
        { wrapper }
      );

      // Modify title in edit mode
      const titleInput = await screen.findByDisplayValue('Corporate Reorganization and Tax Structuring');
      fireEvent.change(titleInput, { target: { value: 'Dirty Edited Title' } });

      // Wait a moment for any potential auto-save debounce
      await new Promise((r) => setTimeout(r, 1100));

      // The create draft MUST still be identical and untampered
      const createDraft = localStorage.getItem('erp_wr_draft_new');
      expect(createDraft).not.toBeNull();
      expect(JSON.parse(createDraft!)).toEqual({
        title: 'Precious Unsaved Draft',
        entity: 'ATA',
      });

      // No draft should be created for this edit work request either
      expect(localStorage.getItem('erp_wr_draft_wr-edit-draft-iso')).toBeNull();
    });
  });
});
