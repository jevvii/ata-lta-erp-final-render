import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest, setTokens } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { Topbar } from '@/components/layout/Topbar';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { OperationsArchiveTab } from '../components/OperationsArchiveTab';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { operationsKeys } from '../api/queryKeys';
import type { WorkRequest, Task } from '../api/types';

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

const mockWr: WorkRequest = {
  id: 'wr-uat-100',
  entity: 'LTA',
  title: 'Q2 Transfer Pricing Advisory',
  description: 'Detailed analysis of cross-border intercompany services',
  clientId: 'client-100',
  clientName: 'Global Logistics Ltd',
  status: 'In Progress',
  phase: 'pre_processing',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-02-01T00:00:00Z',
  dueDate: '2026-04-15T00:00:00Z',
  requestedBy: 'user-manager-1',
  assignedTo: 'Maria Manager',
  coAssignees: ['Carlos Analyst', 'Diana Specialist'],
  version: 2,
  createdAt: '2026-02-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  tasks: [],
};

const mockTasks: Task[] = [
  {
    id: 'task-201',
    workRequestId: 'wr-uat-100',
    title: 'Gather benchmark financial data',
    description: 'Pull comparable company EBIT margins from database',
    status: 'In Progress',
    phase: 'pre_processing',
    qaStatus: 'none',
    phaseEnteredAt: '2026-02-01T00:00:00Z',
    assigneeId: 'user-carlos',
    assigneeName: 'Carlos Analyst',
    assignees: ['user-carlos'],
    predecessors: [],
    dueDate: '2026-02-28T00:00:00Z',
    requiredLinkType: null,
    displayOrder: 1,
    version: 1,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
  {
    id: 'task-202',
    workRequestId: 'wr-uat-100',
    title: 'Draft economic analysis report',
    description: 'Assemble intercompany benchmark study and narrative',
    status: 'Completed',
    phase: 'pre_processing',
    qaStatus: 'passed',
    phaseEnteredAt: '2026-02-01T00:00:00Z',
    assigneeId: 'user-diana',
    assigneeName: 'Diana Specialist',
    assignees: ['user-diana'],
    predecessors: ['task-201'],
    dueDate: '2026-03-15T00:00:00Z',
    requiredLinkType: null,
    displayOrder: 2,
    version: 1,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
];

describe('Empirical Adversarial Challenge Suite: Parcel OPS UAT Fixes', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setTokens('mock-access-token', 'mock-refresh-token');
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-manager-1',
        email: 'manager@ata-lta.ph',
        name: 'Maria Manager',
        role: 'Manager',
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
      ],
      activeEntity: 'ATA',
    });

    // Default global fetch mock to prevent unhandled background queries from failing
    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/clients')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      if (url.includes('/me/team')) {
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  // =========================================================================
  // CHALLENGE 1: UAT-GEN1 Entity Header Emission Matrix & Topbar Fallback
  // =========================================================================
  describe('Challenge 1: Entity Header Emission & Topbar Fallback', () => {
    it('1.1 Omits X-Active-Entity when activeEntity is ALL and strips caller-supplied ALL', async () => {
      useSessionStore.getState().setActiveEntity('ALL');

      let capturedHeaders1: Record<string, string> = {};
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (_input, init) => {
        capturedHeaders1 = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      await apiRequest('/test-route-1');
      expect(capturedHeaders1['X-Active-Entity']).toBeUndefined();

      // Stress test: caller explicitly passes headers: { 'X-Active-Entity': 'ALL' }
      let capturedHeaders2: Record<string, string> = {};
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (_input, init) => {
        capturedHeaders2 = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      await apiRequest('/test-route-2', {
        headers: { 'X-Active-Entity': 'ALL' },
      });
      expect(capturedHeaders2['X-Active-Entity']).toBeUndefined();
    });

    it('1.2 Emits X-Active-Entity for single entity (ATA and LTA) and preserves caller overrides', async () => {
      // Test ATA
      useSessionStore.getState().setActiveEntity('ATA');
      let capturedHeaders: Record<string, string> = {};
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (_input, init) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });
      await apiRequest('/test-ata');
      expect(capturedHeaders['X-Active-Entity']).toBe('ATA');

      // Test LTA
      useSessionStore.getState().setActiveEntity('LTA');
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (_input, init) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });
      await apiRequest('/test-lta');
      expect(capturedHeaders['X-Active-Entity']).toBe('LTA');

      // Test override: Session is ATA, but caller explicitly requests LTA
      useSessionStore.getState().setActiveEntity('ATA');
      vi.spyOn(global, 'fetch').mockImplementationOnce(async (_input, init) => {
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });
      await apiRequest('/test-override', {
        headers: { 'X-Active-Entity': 'LTA' },
      });
      expect(capturedHeaders['X-Active-Entity']).toBe('LTA');
    });

    it('1.3 Topbar defaults to user.entities[0] when activeEntity is unset', () => {
      const { wrapper } = createHarness();
      useSessionStore.getState().setSession({
        user: {
          id: 'user-lta-only',
          email: 'lta.user@ata-lta.ph',
          name: 'LTA Specialist',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['LTA'],
        },
        permissions: ['workflow:view'],
        activeEntity: '',
      });

      render(
        <MemoryRouter>
          <Topbar />
        </MemoryRouter>,
        { wrapper }
      );
      const selectTrigger = screen.getByTestId('entity-switcher');
      expect(selectTrigger).toHaveTextContent('LTA');
    });
  });

  // =========================================================================
  // CHALLENGE 2: UAT-OPS1 WorkRequestModal Draft Auto-Save Debounce & Restore
  // =========================================================================
  describe('Challenge 2: Draft Auto-Save Debounce & Restore Verification', () => {
    it('2.1 Pristine mount does NOT overwrite pre-existing draft in localStorage', async () => {
      vi.useFakeTimers();
      const existingDraft = {
        title: 'Crucial Saved Draft Title',
        entity: 'LTA',
        priority: 'High',
        description: 'Crucial scope notes that must not be deleted on reload',
      };
      localStorage.setItem('erp_wr_draft_new', JSON.stringify(existingDraft));

      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      // Draft banner should appear
      expect(screen.getByTestId('draft-restore-banner')).toBeInTheDocument();

      // Fast-forward 2000ms past the 1000ms debounce timer
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      // Assert draft in localStorage is STILL the original draft!
      const currentStored = localStorage.getItem('erp_wr_draft_new');
      expect(currentStored).not.toBeNull();
      const parsed = JSON.parse(currentStored!);
      expect(parsed.title).toBe('Crucial Saved Draft Title');
      expect(parsed.description).toBe('Crucial scope notes that must not be deleted on reload');

      vi.useRealTimers();
    });

    it('2.2 Restoring draft populates fields, dismisses banner, and allows editing with updated save', async () => {
      vi.useFakeTimers();
      const savedDraft = {
        title: 'Restorable Draft',
        entity: 'LTA',
        priority: 'Urgent',
        description: 'Important tax restructuring',
        tasks: [
          {
            localId: 'draft-task-1',
            id: 'draft-task-1',
            title: 'Draft task item',
            phase: 'pre_processing',
            assigneeId: null,
            coAssignees: [],
          },
        ],
      };
      localStorage.setItem('erp_wr_draft_new', JSON.stringify(savedDraft));

      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      // Click restore draft button
      const restoreBtn = screen.getByRole('button', { name: 'Restore' });
      act(() => {
        fireEvent.click(restoreBtn);
      });

      // Banner should disappear
      expect(screen.queryByTestId('draft-restore-banner')).not.toBeInTheDocument();

      // Fields should be populated
      const titleInput = screen.getByTestId('wr-modal-title-input') as HTMLInputElement;
      expect(titleInput.value).toBe('Restorable Draft');

      // Edit field
      act(() => {
        fireEvent.change(titleInput, { target: { value: 'Restorable Draft - Modified' } });
      });

      // Advance debounce timer
      act(() => {
        vi.advanceTimersByTime(1500);
      });

      // Verify updated draft is saved
      const updatedStored = JSON.parse(localStorage.getItem('erp_wr_draft_new')!);
      expect(updatedStored.title).toBe('Restorable Draft - Modified');

      vi.useRealTimers();
    });

    it('2.3 Discarding draft clears localStorage and resets form', () => {
      const savedDraft = { title: 'To Be Discarded', entity: 'ATA' };
      localStorage.setItem('erp_wr_draft_new', JSON.stringify(savedDraft));

      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const discardBtn = screen.getByRole('button', { name: 'Discard' });
      fireEvent.click(discardBtn);

      expect(localStorage.getItem('erp_wr_draft_new')).toBeNull();
      expect(screen.queryByTestId('draft-restore-banner')).not.toBeInTheDocument();
      const titleInput = screen.getByTestId('wr-modal-title-input') as HTMLInputElement;
      expect(titleInput.value).toBe('');
    });

    it('2.4 Edit mode never triggers auto-save to new draft key', () => {
      vi.useFakeTimers();
      const { wrapper } = createHarness();
      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={mockWr}
        />,
        { wrapper }
      );

      const titleInput = screen.getByTestId('wr-modal-title-input');
      act(() => {
        fireEvent.change(titleInput, { target: { value: 'Updated Existing WR Title' } });
        vi.advanceTimersByTime(2000);
      });

      expect(localStorage.getItem('erp_wr_draft_new')).toBeNull();
      vi.useRealTimers();
    });
  });

  // =========================================================================
  // CHALLENGE 3: UAT-OPS2 OperationsArchiveTab Restore & Header Parameter
  // =========================================================================
  describe('Challenge 3: OperationsArchiveTab Restore & Header Verification', () => {
    it('3.1 Restoring archived WR passes resource entity in X-Active-Entity and triggers refetch', async () => {
      const { wrapper } = createHarness();

      let unarchiveCalled = false;
      let capturedEntityHeader = '';
      let archiveListCalls = 0;

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const headers = (init?.headers as Record<string, string>) || {};

        if (url.includes('/operations/work-requests') && url.includes('archived=true')) {
          archiveListCalls++;
          return new Response(
            JSON.stringify({
              data: [
                {
                  ...mockWr,
                  id: 'wr-archived-lta',
                  entity: 'LTA',
                  archived: true,
                },
              ],
            }),
            { status: 200 }
          );
        }

        if (url.includes('/operations/work-requests/wr-archived-lta/unarchive')) {
          unarchiveCalled = true;
          capturedEntityHeader = headers['X-Active-Entity'] || '';
          return new Response(
            JSON.stringify({
              data: {
                ...mockWr,
                id: 'wr-archived-lta',
                entity: 'LTA',
                archived: false,
              },
            }),
            { status: 200 }
          );
        }

        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<OperationsArchiveTab />, { wrapper });

      // Wait for table to load
      const restoreBtn = await screen.findByTestId('restore-btn-wr-archived-lta');
      expect(restoreBtn).toBeInTheDocument();

      // Click restore button to open confirmation modal
      fireEvent.click(restoreBtn);

      const confirmBtn = await screen.findByTestId('archive-confirm-btn');
      expect(confirmBtn).toBeInTheDocument();

      // Initial query call count
      const initialListCalls = archiveListCalls;

      // Confirm restore
      fireEvent.click(confirmBtn);

      // Verify unarchive was called with X-Active-Entity: LTA
      await waitFor(() => {
        expect(unarchiveCalled).toBe(true);
        expect(capturedEntityHeader).toBe('LTA');
      });

      // Verify refetch() was executed
      await waitFor(() => {
        expect(archiveListCalls).toBeGreaterThan(initialListCalls);
      });
    });
  });

  // =========================================================================
  // CHALLENGE 4: UAT-OPS3 WorkRequestModal Edit Mode Task Synchronization
  // =========================================================================
  describe('Challenge 4: WR Edit Mode Task Modifications, Additions & Deletions', () => {
    it('4.1 Synchronizes deleted tasks, modified tasks, and new tasks on edit submission', async () => {
      const { wrapper, queryClient } = createHarness();

      const existingWrWithTasks: WorkRequest = {
        ...mockWr,
        id: 'wr-edit-target',
        version: 3,
        tasks: [
          {
            id: 'task-keep-modify',
            workRequestId: 'wr-edit-target',
            title: 'Original Task Keep',
            description: null,
            assigneeName: null,
            phase: 'pre_processing',
            status: 'In Progress',
            qaStatus: 'none',
            phaseEnteredAt: '2026-01-01T00:00:00Z',
            assigneeId: null,
            assignees: [],
            predecessors: [],
            dueDate: null,
            requiredLinkType: null,
            displayOrder: 1,
            version: 1,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
          {
            id: 'task-to-delete',
            workRequestId: 'wr-edit-target',
            title: 'Task To Delete',
            description: null,
            assigneeName: null,
            phase: 'pre_processing',
            status: 'In Progress',
            qaStatus: 'none',
            phaseEnteredAt: '2026-01-01T00:00:00Z',
            assigneeId: null,
            assignees: [],
            predecessors: [],
            dueDate: null,
            requiredLinkType: null,
            displayOrder: 2,
            version: 1,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      };

      const deletedTaskIds: string[] = [];
      const updatedTasks: unknown[] = [];
      const createdTasks: unknown[] = [];
      let wrUpdated = false;

      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method || 'GET';

        // Check task-specific endpoints first to avoid substring collision with work request endpoint
        if (url.includes('/tasks/task-to-delete') && method === 'DELETE') {
          deletedTaskIds.push('task-to-delete');
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.includes('/tasks/task-keep-modify') && method === 'PUT') {
          updatedTasks.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ data: existingWrWithTasks.tasks![0] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-edit-target/tasks') && method === 'POST') {
          createdTasks.push(JSON.parse(String(init?.body)));
          return new Response(JSON.stringify({ data: { id: 'task-brand-new', title: 'New Task' } }), { status: 201 });
        }
        if (url.endsWith('/operations/work-requests/wr-edit-target') && method === 'PUT') {
          wrUpdated = true;
          return new Response(JSON.stringify({ data: existingWrWithTasks }), { status: 200 });
        }

        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={existingWrWithTasks}
        />,
        { wrapper }
      );

      // 1. Delete task-to-delete using data-testid="task-remove-btn-task-to-delete"
      const removeBtn = screen.getByTestId('task-remove-btn-task-to-delete');
      fireEvent.click(removeBtn);

      // 2. Modify task-keep-modify title
      const keepTitleInput = screen.getByTestId('task-title-input-task-keep-modify');
      fireEvent.change(keepTitleInput, { target: { value: 'Modified Kept Task' } });

      // 3. Add brand new task
      const addTaskBtn = screen.getByTestId('add-task-btn');
      fireEvent.click(addTaskBtn);

      const updatedTaskInputs = screen.getAllByPlaceholderText(/Task title/i);
      const newTaskInput = updatedTaskInputs[updatedTaskInputs.length - 1]!;
      fireEvent.change(newTaskInput, { target: { value: 'Brand New Task 3' } });

      // Submit modal
      const submitBtn = screen.getByTestId('wr-modal-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(wrUpdated).toBe(true);
        expect(deletedTaskIds).toContain('task-to-delete');
        expect(updatedTasks.length).toBeGreaterThan(0);
        expect((updatedTasks[0] as { title: string }).title).toBe('Modified Kept Task');
        expect(createdTasks.length).toBeGreaterThan(0);
        expect((createdTasks[0] as { title: string }).title).toBe('Brand New Task 3');
      });

      // Verify query cache invalidation
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.tasks('wr-edit-target'),
        })
      );
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: operationsKeys.workRequestDetail('wr-edit-target'),
        })
      );
    });
  });

  // =========================================================================
  // CHALLENGE 5: UAT-OPS4 & UAT-OPS5 PhaseKanbanBoard Drag Removal & Modal
  // =========================================================================
  describe('Challenge 5: PhaseKanbanBoard Drag Removal & Deep-Link Card Click', () => {
    it('5.1 Task cards are strictly non-draggable and GripVertical drag handle is absent', async () => {
      const { wrapper } = createHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-uat-100/tasks')) {
          return new Response(JSON.stringify({ data: mockTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-uat-100')) {
          return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
        }
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: [mockWr] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-uat-100" />, { wrapper });

      const card = await screen.findByTestId('kanban-task-card-task-201');
      expect(card).toBeInTheDocument();
      expect(card).toHaveAttribute('draggable', 'false');

      // Assert GripVertical or grab cursor is NOT present
      expect(card.querySelector('.cursor-grab')).toBeNull();
      expect(card.querySelector('[data-lucide="grip-vertical"]')).toBeNull();
    });

    it('5.2 QA pass/fail buttons do not trigger TaskDetailModal open', async () => {
      const { wrapper } = createHarness();

      const qaTask: Task = {
        ...mockTasks[0]!,
        phase: 'quality_assurance',
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-uat-100/tasks')) {
          return new Response(JSON.stringify({ data: [qaTask] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-uat-100')) {
          return new Response(JSON.stringify({ data: { ...mockWr, phase: 'quality_assurance' } }), { status: 200 });
        }
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: [{ ...mockWr, phase: 'quality_assurance' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-uat-100" />, { wrapper });

      const passBtn = await screen.findByTestId('qa-pass-btn-task-201');
      fireEvent.click(passBtn);

      // TaskDetailModal should NOT be open
      expect(screen.queryByTestId('task-detail-modal')).not.toBeInTheDocument();
    });

    it('5.3 Deep linking via ?taskId=task-202 automatically opens TaskDetailModal', async () => {
      const { wrapper } = createHarness();

      // Set URL search param cleanly via pushState
      window.history.pushState({}, '', '/operations?taskId=task-202');

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-uat-100/tasks')) {
          return new Response(JSON.stringify({ data: mockTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-uat-100')) {
          return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
        }
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: [mockWr] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-uat-100" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
        expect(screen.getByTestId('task-title')).toHaveTextContent('Draft economic analysis report');
      });

      // Cleanup URL
      window.history.pushState({}, '', '/operations');
    });
  });

  // =========================================================================
  // CHALLENGE 6: TaskDetailModal Status Toggle & Document Viewer Integration
  // =========================================================================
  describe('Challenge 6: TaskDetailModal Status Toggle & Document Viewer', () => {
    it('6.1 Clicking linked document opens DocumentViewerModal', async () => {
      const { wrapper } = createHarness();

      const mockDoc = {
        id: 'doc-benchmarks',
        work_request_id: 'wr-uat-100',
        linked_task_id: 'task-201',
        original_name: 'TP_Benchmark_Study.pdf',
        file_name: 'TP_Benchmark_Study.pdf',
        file_path: '/uploads/TP_Benchmark_Study.pdf',
        category: 'WORKING_PAPER',
        mime_type: 'application/pdf',
        file_size: 1048576,
        uploaded_by: 'user-carlos',
        uploaded_at: '2026-02-15T00:00:00Z',
        comments: [],
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/documents')) {
          return new Response(JSON.stringify({ data: [mockDoc] }), { status: 200 });
        }
        if (url.includes('/time-entries')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTasks[0]!}
          workRequest={mockWr}
        />,
        { wrapper }
      );

      const docItem = await screen.findByTestId('linked-doc-item-doc-benchmarks');
      expect(docItem).toBeInTheDocument();

      fireEvent.click(docItem);

      // DocumentViewerModal should open
      await waitFor(() => {
        expect(screen.getByTestId('document-viewer-modal')).toBeInTheDocument();
      });
    });

    it('6.2 Toggling task status triggers blocking action modal and updates status', async () => {
      useSessionStore.getState().setSession({
        ...useSessionStore.getState(),
        user: {
          id: 'user-carlos',
          email: 'carlos@ata-lta.ph',
          name: 'Carlos Analyst',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA', 'LTA'],
        },
      });

      const { wrapper } = createHarness();

      let patchedStatus = '';
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (
          url.includes('/operations/work-requests/wr-uat-100/tasks/task-201') &&
          (init?.method === 'PUT' || init?.method === 'PATCH')
        ) {
          const body = JSON.parse(String(init.body));
          patchedStatus = body.status;
          return new Response(
            JSON.stringify({
              data: { ...mockTasks[0]!, status: body.status },
            }),
            { status: 200 }
          );
        }
        if (url.includes('/operations/work-requests/wr-uat-100/tasks/task-201')) {
          return new Response(
            JSON.stringify({
              data: { ...mockTasks[0]!, checklist: [] },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const onTaskUpdated = vi.fn();

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTasks[0]!}
          workRequest={mockWr}
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
        expect(patchedStatus).toBe('Completed');
      });
    });
  });
});
