import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import type { WorkRequest, Task } from '../api/types';

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
  id: 'wr-f4-test',
  entity: 'ATA',
  title: 'Audit and Corporate Structuring',
  description: 'Annual corporate audit review',
  clientId: 'client-f4',
  clientName: 'Astra Pacific Holdings',
  status: 'In Progress',
  phase: 'pre_processing',
  priority: 'Normal',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-02-01T00:00:00Z',
  dueDate: '2026-05-30T00:00:00Z',
  requestedBy: 'user-lead-1',
  assignedTo: 'Lead Director',
  coAssignees: [],
  version: 1,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  tasks: [],
};

const baseTask: Task = {
  id: 'task-f4-101',
  workRequestId: 'wr-f4-test',
  title: 'Analyze Financial Statements',
  description: 'Balance sheet reconciliation',
  status: 'In Progress',
  phase: 'pre_processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-02-01T00:00:00Z',
  assigneeId: 'user-lead-1',
  assigneeName: 'Lead Director',
  assignees: ['user-lead-1'],
  predecessors: [],
  dueDate: '2026-03-15T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  checklist: [],
};

describe('Parcel F4: Frontend State & ID Resolution (Sourcery Regressions)', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-f4-tester',
        email: 'tester@ata-lta.ph',
        name: 'F4 QA Tester',
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
  // F4.1: Temporary local ID dependency resolution in WorkRequestModal edit mode
  // ==========================================================================
  describe('F4.1: Temporary local ID dependency resolution in WorkRequestModal edit mode', () => {
    it('resolves temporary local predecessor IDs of newly created tasks to server UUIDs', async () => {
      const { wrapper } = createTestHarness();

      const existingWr: WorkRequest = {
        ...baseWr,
        id: 'wr-f4-resolve-edit',
        tasks: [],
      };

      const capturedPostBodies: any[] = [];
      const capturedPutBodies: any[] = [];

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';

        if (url.includes('/operations/work-requests/wr-f4-resolve-edit/tasks') && method === 'POST') {
          const body = JSON.parse(String(init?.body));
          capturedPostBodies.push(body);
          const serverAssignedId = `server-uuid-${capturedPostBodies.length}`;
          return new Response(
            JSON.stringify({ data: { id: serverAssignedId, ...body } }),
            { status: 201 }
          );
        }

        if (url.includes('/operations/work-requests/wr-f4-resolve-edit/tasks/') && method === 'PUT') {
          const body = JSON.parse(String(init?.body));
          capturedPutBodies.push(body);
          return new Response(
            JSON.stringify({ data: { id: url.split('/').pop(), ...body } }),
            { status: 200 }
          );
        }

        if (url.includes('/operations/work-requests/wr-f4-resolve-edit') && method === 'PUT') {
          return new Response(JSON.stringify({ data: existingWr }), { status: 200 });
        }

        if (url.includes('/clients')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'client-f4', name: 'Astra Pacific Holdings', entity: 'ATA' }] }),
            { status: 200 }
          );
        }

        if (url.includes('/me/team') || url.includes('/users')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'user-lead-1', name: 'Lead Director', role: 'Manager' }] }),
            { status: 200 }
          );
        }

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

      // In edit mode with tasks=[], DEFAULT_TASKS renders tmp-1 and tmp-2
      const input1 = await screen.findByTestId('task-title-input-tmp-1');
      const input2 = screen.getByTestId('task-title-input-tmp-2');

      fireEvent.change(input1, { target: { value: 'Task Predecessor Alpha' } });
      fireEvent.change(input2, { target: { value: 'Task Dependent Beta' } });

      // Open task 2's predecessor picker and check Task 1 (Alpha)
      const depTrigger2 = screen.getByTestId('task-dep-btn-tmp-2');
      fireEvent.click(depTrigger2);

      // Select candidate Alpha
      const alphaCandidateLabel = await screen.findByText('Task Predecessor Alpha');
      fireEvent.click(alphaCandidateLabel);

      // Submit the modal form
      fireEvent.click(screen.getByTestId('wr-modal-submit-btn'));

      await waitFor(() => {
        expect(capturedPostBodies.length).toBe(2);
      });

      // Verify that no temporary 'tmp-' ID was persisted into predecessors
      for (const postBody of capturedPostBodies) {
        if (postBody.predecessors) {
          for (const pred of postBody.predecessors) {
            expect(pred).not.toMatch(/^tmp-/);
          }
        }
      }

      // Check that the dependent task's dependency was resolved to server-assigned ID of task 1
      const allPredecessorsSaved = [
        ...capturedPostBodies.flatMap((p) => p.predecessors || []),
        ...capturedPutBodies.flatMap((p) => p.predecessors || []),
      ];

      expect(allPredecessorsSaved).toContain('server-uuid-1');
      expect(allPredecessorsSaved).not.toContain('tmp-1');
    });

    it('resolves newly created task ID when an existing task is updated to depend on it', async () => {
      const { wrapper } = createTestHarness();

      const existingTaskInWr: Task = {
        ...baseTask,
        id: 'existing-task-uuid-999',
        title: 'Existing Review Task',
        predecessors: [],
      };

      const existingWr: WorkRequest = {
        ...baseWr,
        id: 'wr-f4-existing-dep-test',
        tasks: [existingTaskInWr],
      };

      const capturedPostBodies: any[] = [];
      const capturedPutBodies: any[] = [];

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';

        if (url.includes('/operations/work-requests/wr-f4-existing-dep-test/tasks') && method === 'POST') {
          const body = JSON.parse(String(init?.body));
          capturedPostBodies.push(body);
          return new Response(
            JSON.stringify({ data: { id: 'new-server-task-uuid-1', ...body } }),
            { status: 201 }
          );
        }

        if (url.includes('/operations/work-requests/wr-f4-existing-dep-test/tasks/existing-task-uuid-999') && method === 'PUT') {
          const body = JSON.parse(String(init?.body));
          capturedPutBodies.push(body);
          return new Response(
            JSON.stringify({ data: { id: 'existing-task-uuid-999', ...body } }),
            { status: 200 }
          );
        }

        if (url.includes('/operations/work-requests/wr-f4-existing-dep-test') && method === 'PUT') {
          return new Response(JSON.stringify({ data: existingWr }), { status: 200 });
        }

        if (url.includes('/clients')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'client-f4', name: 'Astra Pacific Holdings', entity: 'ATA' }] }),
            { status: 200 }
          );
        }

        if (url.includes('/me/team') || url.includes('/users')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'user-lead-1', name: 'Lead Director', role: 'Manager' }] }),
            { status: 200 }
          );
        }

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

      // Add a new task row
      const addTaskBtn = await screen.findByRole('button', { name: /add task/i });
      fireEvent.click(addTaskBtn);

      // Find all title inputs
      const allInputs = screen.getAllByPlaceholderText(/task title/i);
      const newInput = allInputs[allInputs.length - 1]!;
      fireEvent.change(newInput, { target: { value: 'Newly Created Upstream Task' } });

      // Open existing task's predecessor picker
      const existingDepTrigger = screen.getByTestId('task-dep-btn-existing-task-uuid-999');
      fireEvent.click(existingDepTrigger);

      // Select newly added task as dependency for the existing task
      const newCandidateLabel = await screen.findByText('Newly Created Upstream Task');
      fireEvent.click(newCandidateLabel);

      // Submit modal
      fireEvent.click(screen.getByTestId('wr-modal-submit-btn'));

      await waitFor(() => {
        expect(capturedPostBodies.length).toBe(1);
        expect(capturedPutBodies.length).toBe(1);
      });

      // Assert that the existing task's updateTask received the server-assigned UUID, not tmp-
      expect(capturedPutBodies[0].predecessors).toContain('new-server-task-uuid-1');
      expect(capturedPutBodies[0].predecessors.some((p: string) => p.startsWith('tmp-'))).toBe(false);
    });
  });

  // ==========================================================================
  // F4.2: Checklist UUID generation in TaskDetailModal
  // ==========================================================================
  describe('F4.2: Checklist UUID generation in TaskDetailModal', () => {
    it('generates a valid RFC 4122 UUID (not cl- timestamp) when adding a checklist item', async () => {
      const { wrapper } = createTestHarness();

      let capturedUpdateData: any = null;

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';

        if (url.includes('/operations/work-requests/wr-f4-test/tasks/task-f4-101') && method === 'PUT') {
          capturedUpdateData = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({ data: { ...baseTask, ...capturedUpdateData } }),
            { status: 200 }
          );
        }

        if (url.includes('/time-entries')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }

        if (url.includes('/invoices') || url.includes('/disbursements') || url.includes('/transmittals')) {
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

      // Find the checklist input
      const input = await screen.findByPlaceholderText('Add a new checklist item...');
      fireEvent.change(input, { target: { value: 'Verify BIR 2307 Withholding Tax Certificates' } });

      // Click Add button
      const addBtn = screen.getByRole('button', { name: /add/i });
      fireEvent.click(addBtn);

      await waitFor(() => {
        expect(capturedUpdateData).not.toBeNull();
      });

      const checklistItems = capturedUpdateData.checklist;
      expect(checklistItems).toBeDefined();
      expect(checklistItems.length).toBe(1);

      const addedItem = checklistItems[0];
      expect(addedItem.text).toBe('Verify BIR 2307 Withholding Tax Certificates');

      // UUID verification
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(addedItem.id).toMatch(uuidRegex);
      expect(addedItem.id).not.toMatch(/^cl-/);
    });
  });

  // ==========================================================================
  // F4.3: URL query parameter sync in PhaseKanbanBoard
  // ==========================================================================
  describe('F4.3: URL query parameter sync in PhaseKanbanBoard', () => {
    it('synchronizes selectedWrId when wrId search parameter changes to a valid work request', async () => {
      const { wrapper } = createTestHarness();

      const wrList = [
        { ...baseWr, id: 'wr-alpha', title: 'Work Request Alpha' },
        { ...baseWr, id: 'wr-beta', title: 'Work Request Beta' },
      ];

      const tasksAlpha = [
        { ...baseTask, id: 'task-a1', workRequestId: 'wr-alpha', title: 'Task in Alpha' },
      ];
      const tasksBeta = [
        { ...baseTask, id: 'task-b1', workRequestId: 'wr-beta', title: 'Task in Beta' },
      ];

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: wrList }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-alpha/tasks')) {
          return new Response(JSON.stringify({ data: tasksAlpha }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-beta/tasks')) {
          return new Response(JSON.stringify({ data: tasksBeta }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-alpha')) {
          return new Response(JSON.stringify({ data: wrList[0] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-beta')) {
          return new Response(JSON.stringify({ data: wrList[1] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      // Helper component to navigate searchParams
      function TestContainer() {
        const [, setSearchParams] = useSearchParams();
        return (
          <div>
            <button
              data-testid="switch-to-beta-btn"
              onClick={() => setSearchParams({ wrId: 'wr-beta' })}
            >
              Switch to Beta
            </button>
            <PhaseKanbanBoard />
          </div>
        );
      }

      render(
        <MemoryRouter initialEntries={['/operations?wrId=wr-alpha']}>
          <TestContainer />
        </MemoryRouter>,
        { wrapper }
      );

      // Initially renders Alpha task
      expect(await screen.findByText('Task in Alpha')).toBeInTheDocument();

      // Trigger URL change to wr-beta
      fireEvent.click(screen.getByTestId('switch-to-beta-btn'));

      // Verify that board synchronizes to Beta
      expect(await screen.findByText('Task in Beta')).toBeInTheDocument();
    });

    it('does not desynchronize when wrId search parameter is invalid', async () => {
      const { wrapper } = createTestHarness();

      const wrList = [
        { ...baseWr, id: 'wr-alpha', title: 'Work Request Alpha' },
      ];

      const tasksAlpha = [
        { ...baseTask, id: 'task-a1', workRequestId: 'wr-alpha', title: 'Task in Alpha' },
      ];

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: wrList }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-alpha/tasks')) {
          return new Response(JSON.stringify({ data: tasksAlpha }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-alpha')) {
          return new Response(JSON.stringify({ data: wrList[0] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      function TestInvalidContainer() {
        const [, setSearchParams] = useSearchParams();
        return (
          <div>
            <button
              data-testid="switch-to-invalid-btn"
              onClick={() => setSearchParams({ wrId: 'non-existent-id' })}
            >
              Switch to Invalid
            </button>
            <PhaseKanbanBoard />
          </div>
        );
      }

      render(
        <MemoryRouter initialEntries={['/operations?wrId=wr-alpha']}>
          <TestInvalidContainer />
        </MemoryRouter>,
        { wrapper }
      );

      expect(await screen.findByText('Task in Alpha')).toBeInTheDocument();

      // Trigger URL change to non-existent ID
      fireEvent.click(screen.getByTestId('switch-to-invalid-btn'));

      // Board remains stable and does not switch to non-existent ID
      expect(screen.getByText('Task in Alpha')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // F4.4: Normal priority option in WorkRequestModal
  // ==========================================================================
  describe('F4.4: Normal priority option in WorkRequestModal', () => {
    it('restores Normal priority option in Priority Select dropdown', async () => {
      const { wrapper } = createTestHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/clients')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'client-f4', name: 'Astra Pacific Holdings', entity: 'ATA' }] }),
            { status: 200 }
          );
        }
        if (url.includes('/me/team') || url.includes('/users')) {
          return new Response(
            JSON.stringify({ data: [{ id: 'user-lead-1', name: 'Lead Director', role: 'Manager' }] }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Verify that Priority select trigger is present and shows 'Normal' by default
      const priorityLabel = await screen.findByText('Priority');
      expect(priorityLabel).toBeInTheDocument();

      // Find the Priority SelectTrigger
      const trigger = priorityLabel.parentElement?.querySelector('button');
      expect(trigger).not.toBeNull();
      expect(trigger).toHaveTextContent('Normal');

      // Click the trigger to open the options dropdown
      fireEvent.click(trigger!);

      // Verify 'Normal' item is rendered alongside Low, Medium, High, Urgent
      expect(screen.getByRole('option', { name: 'Normal' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Low' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Medium' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'High' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Urgent' })).toBeInTheDocument();
    });
  });
});
