import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { QuickAddCard } from '../components/QuickAddCard';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { useSessionStore } from '@/lib/session';
import type { WorkRequest } from '../api/types';

vi.mock('../api/useTeam', () => ({
  useTeam: () => ({
    data: [
      {
        id: 'u-lead-mgr',
        name: 'Lead Manager Maria',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA'],
        avatarUrl: null,
      },
      {
        id: 'u-emp-1',
        name: 'Staff John',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
        avatarUrl: null,
      },
    ],
    isLoading: false,
    isError: false,
  }),
  getEligibleStaff: (team: any[]) => team,
}));

vi.mock('../api/useClients', () => ({
  useClients: () => ({
    data: [
      { id: 'c-1', name: 'Acme Corp', entity_id: 'ent-1', entity: 'ATA' },
    ],
    isLoading: false,
  }),
}));

const mockCreateTask = vi.fn().mockResolvedValue({ id: 'task-new-123' });
const mockUpdateTask = vi.fn().mockResolvedValue({ id: 'task-updated-123' });
const mockDeleteTask = vi.fn().mockResolvedValue(undefined);

vi.mock('../api/useTasks', () => ({
  useTaskMutations: () => ({
    createTask: mockCreateTask,
    updateTask: mockUpdateTask,
    deleteTask: mockDeleteTask,
  }),
}));

const mockCreateWorkRequest = vi.fn().mockResolvedValue({ id: 'wr-new-123' });
const mockUpdateWorkRequest = vi.fn().mockResolvedValue({ id: 'wr-updated-123' });
const mockResubmitCreation = vi.fn().mockResolvedValue({ id: 'wr-resubmit-123' });

vi.mock('../api/useWorkRequests', () => ({
  useWorkRequestMutations: () => ({
    createWorkRequest: mockCreateWorkRequest,
    updateWorkRequest: mockUpdateWorkRequest,
    resubmitCreation: mockResubmitCreation,
  }),
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, null, children)
    );

  return { queryClient, wrapper };
}

const mockWr: WorkRequest = {
  id: 'wr-1',
  title: 'Operations Engagement',
  description: 'Operations request',
  clientId: 'c-1',
  phaseEnteredAt: null,
  entity: 'ATA',
  status: 'In Progress',
  phase: 'pre_processing',
  onHold: false,
  priority: 'Normal',
  archived: false,
  requestedBy: 'u-admin-1',
  assignedTo: 'u-lead-mgr',
  coAssignees: ['u-emp-1'],
  hasManagerLead: true,
  creationApprovalStatus: 'approved',
  version: 1,
  dueDate: '2026-11-30T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  tasks: [],
};

describe('Assigned Task Status Default Frontend Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    useSessionStore.setState({
      user: {
        id: 'u-lead-mgr',
        email: 'lead@ata-lta.ph',
        name: 'Lead Manager Maria',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      activeEntity: 'ATA',
    });
  });

  describe('QuickAddCard', () => {
    it('1. submits status: "Assigned" when task has an assignee selected', async () => {
      const { wrapper } = createHarness();
      const handleCreate = vi.fn().mockResolvedValue(undefined);
      const handleCancel = vi.fn();

      render(
        <QuickAddCard
          phase="pre_processing"
          workRequest={mockWr}
          onCreate={handleCreate}
          onCancel={handleCancel}
        />,
        { wrapper }
      );

      const titleInput = screen.getByTestId('quick-add-title-input-pre_processing');
      fireEvent.change(titleInput, { target: { value: 'Prepare financial schedules' } });

      const assigneeSelect = screen.getByTestId('quick-add-assignee-trigger-pre_processing');
      fireEvent.change(assigneeSelect, { target: { value: 'u-emp-1' } });

      const submitBtn = screen.getByTestId('quick-add-submit-btn-pre_processing');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(handleCreate).toHaveBeenCalledTimes(1);
      });

      expect(handleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Prepare financial schedules',
          status: 'Assigned',
          assigneeId: 'u-emp-1',
          assignees: ['u-emp-1'],
        })
      );
    });

    it('2. submits status: "Draft" when task has no assignee selected', async () => {
      const { wrapper } = createHarness();
      const handleCreate = vi.fn().mockResolvedValue(undefined);
      const handleCancel = vi.fn();

      render(
        <QuickAddCard
          phase="pre_processing"
          workRequest={mockWr}
          onCreate={handleCreate}
          onCancel={handleCancel}
        />,
        { wrapper }
      );

      const titleInput = screen.getByTestId('quick-add-title-input-pre_processing');
      fireEvent.change(titleInput, { target: { value: 'Unassigned intake review' } });

      const submitBtn = screen.getByTestId('quick-add-submit-btn-pre_processing');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(handleCreate).toHaveBeenCalledTimes(1);
      });

      expect(handleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Unassigned intake review',
          status: 'Draft',
          assigneeId: null,
          assignees: [],
        })
      );
    });

    it('3. supports snake_case assigned_to and co_assignees on workRequest', async () => {
      const { wrapper } = createHarness();
      const handleCreate = vi.fn().mockResolvedValue(undefined);
      const handleCancel = vi.fn();

      const snakeWr: any = {
        ...mockWr,
        assignedTo: undefined,
        coAssignees: undefined,
        assigned_to: 'u-lead-mgr',
        co_assignees: ['u-emp-1'],
      };

      render(
        <QuickAddCard
          phase="pre_processing"
          workRequest={snakeWr}
          onCreate={handleCreate}
          onCancel={handleCancel}
        />,
        { wrapper }
      );

      const titleInput = screen.getByTestId('quick-add-title-input-pre_processing');
      fireEvent.change(titleInput, { target: { value: 'Snake case WR task' } });

      const assigneeSelect = screen.getByTestId('quick-add-assignee-trigger-pre_processing');
      fireEvent.change(assigneeSelect, { target: { value: 'u-emp-1' } });

      const submitBtn = screen.getByTestId('quick-add-submit-btn-pre_processing');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(handleCreate).toHaveBeenCalledTimes(1);
      });

      expect(handleCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Snake case WR task',
          status: 'Assigned',
          assigneeId: 'u-emp-1',
          assignees: ['u-emp-1'],
        })
      );
    });
  });

  describe('WorkRequestModal (Edit mode task addition)', () => {
    it('4. creates newly added task with status: "Assigned" if assignee is present', async () => {
      const { wrapper } = createHarness();
      const existingWrWithNoTasks: WorkRequest = {
        ...mockWr,
        tasks: [],
      };

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={existingWrWithNoTasks}
        />,
        { wrapper }
      );

      // Find the first task title input in TaskLineItems
      const taskTitleInputs = screen.getAllByPlaceholderText('Task title');
      fireEvent.change(taskTitleInputs[0]!, { target: { value: 'Newly added assigned task' } });

      // Click the assignee trigger and select Staff John
      const assigneeTrigger = screen.getByTestId('task-assignee-trigger-tmp-1');
      fireEvent.click(assigneeTrigger);

      const option = await screen.findByRole('option', { name: /Staff John/i });
      fireEvent.click(option);

      // Click save changes submit button
      const submitBtn = screen.getByTestId('wr-modal-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledTimes(1);
      });

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          workRequestId: 'wr-1',
          data: expect.objectContaining({
            title: 'Newly added assigned task',
            status: 'Assigned',
            assigneeId: 'u-emp-1',
            assignees: ['u-emp-1'],
          }),
        })
      );
    });

    it('5. creates newly added task with status: "Draft" if no assignee is present', async () => {
      const { wrapper } = createHarness();
      const existingWrWithNoTasks: WorkRequest = {
        ...mockWr,
        tasks: [],
      };

      render(
        <WorkRequestModal
          isOpen={true}
          onClose={vi.fn()}
          workRequest={existingWrWithNoTasks}
        />,
        { wrapper }
      );

      // Find the first task title input in TaskLineItems
      const taskTitleInputs = screen.getAllByPlaceholderText('Task title');
      fireEvent.change(taskTitleInputs[0]!, { target: { value: 'Newly added unassigned task' } });

      // Click save changes submit button
      const submitBtn = screen.getByTestId('wr-modal-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(mockCreateTask).toHaveBeenCalledTimes(1);
      });

      expect(mockCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          workRequestId: 'wr-1',
          data: expect.objectContaining({
            title: 'Newly added unassigned task',
            status: 'Draft',
            assigneeId: null,
            assignees: [],
          }),
        })
      );
    });
  });
});
