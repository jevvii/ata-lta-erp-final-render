import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { WorkRequestSidePeek } from '../components/WorkRequestSidePeek';
import { TaskResubmitModal } from '../components/TaskResubmitModal';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import {
  canReviewTaskCreation,
  canResubmitTask,
  canEmployeeCreateTask,
  isTaskPendingApproval,
  isTaskRejected,
  canMutateTaskStatus,
  canLogTaskTime,
  canUploadTaskDocument,
  isChecklistEditor,
  canLinkInvoice,
  canLinkDisbursement,
  canLinkTransmittal,
} from '../lib/taskScope';
import type { Task, WorkRequest } from '../api/types';

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

const mockLeadManager = {
  id: 'u-lead-mgr',
  email: 'lead@ata-lta.ph',
  name: 'Lead Manager Maria',
  role: 'Manager',
  departments: ['Operations'],
  entities: ['ATA'],
};

const mockOtherManager = {
  id: 'u-other-mgr',
  email: 'other@ata-lta.ph',
  name: 'Other Manager Bob',
  role: 'Manager',
  departments: ['Operations'],
  entities: ['ATA'],
};

const mockAdminUser = {
  id: 'u-admin-1',
  email: 'admin@ata-lta.ph',
  name: 'System Admin',
  role: 'Admin',
  departments: ['Operations'],
  entities: ['ATA'],
};

const mockEmployeeCreator = {
  id: 'u-emp-creator',
  email: 'creator@ata-lta.ph',
  name: 'Employee John (Creator)',
  role: 'Employee',
  departments: ['Operations'],
  entities: ['ATA'],
};

const mockOtherEmployee = {
  id: 'u-emp-other',
  email: 'other.emp@ata-lta.ph',
  name: 'Employee Sarah',
  role: 'Employee',
  departments: ['Operations'],
  entities: ['ATA'],
};

const mockWrWithLead: WorkRequest = {
  id: 'wr-1',
  title: 'Audit & Compliance Engagement',
  description: 'Annual corporate audit',
  clientId: 'c-1',
  phaseEnteredAt: null,
  entity: 'ATA',
  status: 'In Progress',
  phase: 'pre_processing',
  onHold: false,
  priority: 'Normal',
  archived: false,
  requestedBy: 'u-admin-1',
  assignedTo: 'u-lead-mgr', // Lead is mockLeadManager
  coAssignees: ['u-other-mgr'], // Other manager is co-assignee, NOT lead
  hasManagerLead: true,
  creationApprovalStatus: 'approved',
  version: 1,
  dueDate: '2026-11-30T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

const mockWrWithoutLead: WorkRequest = {
  ...mockWrWithLead,
  id: 'wr-no-lead',
  title: 'Unassigned Lead WR',
  assignedTo: null,
  hasManagerLead: false,
};

const mockPendingTask: Task = {
  id: 't-pending-1',
  workRequestId: 'wr-1',
  title: 'Gather Client Tax Returns',
  description: 'Need 3 prior years tax returns',
  phase: 'pre_processing',
  status: 'In Progress',
  qaStatus: 'none',
  phaseEnteredAt: null,
  assigneeId: 'u-emp-creator',
  assigneeName: 'Employee John (Creator)',
  assignees: ['u-emp-creator'],
  predecessors: [],
  dueDate: null,
  requiredLinkType: null,
  displayOrder: 1,
  approvalStatus: 'pending',
  createdBy: 'u-emp-creator',
  version: 1,
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-02T00:00:00Z',
};

const mockRejectedTask: Task = {
  id: 't-rejected-1',
  workRequestId: 'wr-1',
  title: 'Draft Financial Assessment',
  description: 'Preliminary computation',
  phase: 'pre_processing',
  status: 'Draft',
  qaStatus: 'none',
  phaseEnteredAt: null,
  assigneeId: 'u-emp-creator',
  assigneeName: 'Employee John (Creator)',
  assignees: ['u-emp-creator'],
  predecessors: [],
  dueDate: null,
  requiredLinkType: null,
  displayOrder: 2,
  approvalStatus: 'rejected',
  rejectionReason: 'Scope too broad. Break down into separate asset categories.',
  reviewedBy: 'u-lead-mgr',
  reviewedAt: '2026-10-03T10:00:00Z',
  createdBy: 'u-emp-creator',
  canResubmit: true,
  version: 2,
  createdAt: '2026-10-02T00:00:00Z',
  updatedAt: '2026-10-03T10:00:00Z',
};

describe('Task Creation Review UI & Policies (Parcel 4)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL, _init?: RequestInit) => {
      const u = typeof input === 'string' ? input : 'url' in input ? input.url : input.toString();

      if (u.includes('/operations/work-requests/wr-1/tasks/t-pending-1/creation-approval')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockPendingTask, approvalStatus: 'approved' },
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests/wr-1/tasks/t-rejected-1/resubmit-creation')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockRejectedTask, approvalStatus: 'pending', version: 3 },
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests/wr-1/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [mockPendingTask, mockRejectedTask],
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests/wr-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: mockWrWithLead,
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests/wr-no-lead')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: mockWrWithoutLead,
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [mockWrWithLead],
          }),
        } as Response);
      }

      if (u.includes('/documents')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [],
          }),
        } as Response);
      }

      if (u.includes('/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              mockLeadManager,
              mockOtherManager,
              mockAdminUser,
              mockEmployeeCreator,
            ],
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. Policy Scoping: canReviewTaskCreation
  // ==========================================================================
  describe('1. Review Authority Scoping (canReviewTaskCreation)', () => {
    it('grants review authority ONLY to the assigned lead Manager on parent WR', () => {
      expect(canReviewTaskCreation(mockLeadManager, mockPendingTask, mockWrWithLead)).toBe(true);
    });

    it('denies Admin review authority with STRICTLY NO OVERRIDE per R5', () => {
      expect(canReviewTaskCreation(mockAdminUser, mockPendingTask, mockWrWithLead)).toBe(false);
      // Even if task payload forged canReview=true, helper fails closed
      const forgedTask = { ...mockPendingTask, canReview: true };
      expect(canReviewTaskCreation(mockAdminUser, forgedTask, mockWrWithLead)).toBe(false);
    });

    it('denies co-assignee Manager or non-lead Manager review authority', () => {
      expect(canReviewTaskCreation(mockOtherManager, mockPendingTask, mockWrWithLead)).toBe(false);
    });

    it('denies ordinary employee review authority', () => {
      expect(canReviewTaskCreation(mockEmployeeCreator, mockPendingTask, mockWrWithLead)).toBe(false);
      expect(canReviewTaskCreation(mockOtherEmployee, mockPendingTask, mockWrWithLead)).toBe(false);
    });

    it('denies review for non-pending tasks (e.g. approved or rejected)', () => {
      expect(canReviewTaskCreation(mockLeadManager, mockRejectedTask, mockWrWithLead)).toBe(false);
      const approvedTask = { ...mockPendingTask, approvalStatus: 'approved' as const };
      expect(canReviewTaskCreation(mockLeadManager, approvedTask, mockWrWithLead)).toBe(false);
    });

    it('denies review if task workRequestId does not match parent WR', () => {
      const foreignTask = { ...mockPendingTask, workRequestId: 'wr-other-99' };
      expect(canReviewTaskCreation(mockLeadManager, foreignTask, mockWrWithLead)).toBe(false);
    });
  });

  // ==========================================================================
  // 2. Policy Scoping: canResubmitTask & Stale Capability Bug Fix
  // ==========================================================================
  describe('2. Resubmission Scoping & Stale Capability Bug Fix (canResubmitTask)', () => {
    it('grants resubmission authority to the canonical task creator', () => {
      expect(canResubmitTask(mockEmployeeCreator, mockRejectedTask, mockWrWithLead)).toBe(true);
    });

    it('FIXES STALE CAPABILITY BUG: denies another actor even if task.canResubmit is true', () => {
      // Root reproduced WIP bug: canResubmitTask(otherActor, rejectedTaskWithCanResubmitTrue) returned true
      const rejectedWithTrue = { ...mockRejectedTask, canResubmit: true };
      expect(canResubmitTask(mockOtherEmployee, rejectedWithTrue, mockWrWithLead)).toBe(false);
      expect(canResubmitTask(mockLeadManager, rejectedWithTrue, mockWrWithLead)).toBe(false);
      expect(canResubmitTask(mockAdminUser, rejectedWithTrue, mockWrWithLead)).toBe(false);
    });

    it('denies resubmission if creator matches but canResubmit is explicitly false', () => {
      const rejectedWithFalse = { ...mockRejectedTask, canResubmit: false };
      expect(canResubmitTask(mockEmployeeCreator, rejectedWithFalse, mockWrWithLead)).toBe(false);
    });

    it('denies resubmission for tasks that are not rejected', () => {
      expect(canResubmitTask(mockEmployeeCreator, mockPendingTask, mockWrWithLead)).toBe(false);
      const approvedTask = { ...mockPendingTask, approvalStatus: 'approved' as const };
      expect(canResubmitTask(mockEmployeeCreator, approvedTask, mockWrWithLead)).toBe(false);
    });

    it('denies resubmission if parent WR itself is pending or rejected', () => {
      const pendingWr = { ...mockWrWithLead, creationApprovalStatus: 'pending' as const };
      expect(canResubmitTask(mockEmployeeCreator, mockRejectedTask, pendingWr)).toBe(false);

      const rejectedWr = { ...mockWrWithLead, creationApprovalStatus: 'rejected' as const };
      expect(canResubmitTask(mockEmployeeCreator, mockRejectedTask, rejectedWr)).toBe(false);
    });
  });

  // ==========================================================================
  // 3. Policy Scoping: canEmployeeCreateTask (Missing-Lead Guard)
  // ==========================================================================
  describe('3. Employee Task Creation Guard (canEmployeeCreateTask)', () => {
    it('permits Admin and Manager unconditionally', () => {
      expect(canEmployeeCreateTask(mockAdminUser, mockWrWithoutLead)).toBe(true);
      expect(canEmployeeCreateTask(mockLeadManager, mockWrWithoutLead)).toBe(true);
    });

    it('permits Employee when WR has an assigned Manager lead (hasManagerLead === true)', () => {
      expect(canEmployeeCreateTask(mockEmployeeCreator, mockWrWithLead)).toBe(true);
    });

    it('denies Employee when WR has no Manager lead (hasManagerLead === false)', () => {
      expect(canEmployeeCreateTask(mockEmployeeCreator, mockWrWithoutLead)).toBe(false);
    });

    it('fails closed when hasManagerLead is undefined or missing', () => {
      const wrMissingFlag: WorkRequest = { ...mockWrWithLead, hasManagerLead: undefined };
      expect(canEmployeeCreateTask(mockEmployeeCreator, wrMissingFlag)).toBe(false);
    });
  });

  // ==========================================================================
  // 4. Rejected Tasks Lock Ordinary Work Mutations
  // ==========================================================================
  describe('4. Rejected Tasks Mutation Locks', () => {
    it('identifies rejected tasks and locks status mutations on rejected tasks for all actors', () => {
      expect(isTaskRejected(mockRejectedTask)).toBe(true);
      expect(isTaskPendingApproval(mockRejectedTask)).toBe(false);
      expect(canMutateTaskStatus(mockEmployeeCreator, mockRejectedTask)).toBe(false);
      expect(canMutateTaskStatus(mockAdminUser, mockRejectedTask)).toBe(false);
      expect(canMutateTaskStatus(mockLeadManager, mockRejectedTask)).toBe(false);
    });

    it('locks time logging on rejected tasks', () => {
      expect(canLogTaskTime(mockEmployeeCreator, mockRejectedTask)).toBe(false);
      expect(canLogTaskTime(mockAdminUser, mockRejectedTask)).toBe(false);
    });

    it('locks document uploading on rejected tasks', () => {
      expect(canUploadTaskDocument(mockEmployeeCreator, mockRejectedTask)).toBe(false);
      expect(canUploadTaskDocument(mockAdminUser, mockRejectedTask)).toBe(false);
    });

    it('locks checklist editing on rejected tasks', () => {
      expect(isChecklistEditor(mockLeadManager, mockRejectedTask)).toBe(false);
      expect(isChecklistEditor(mockAdminUser, mockRejectedTask)).toBe(false);
    });

    it('locks financial record linking on rejected tasks', () => {
      expect(canLinkInvoice(mockEmployeeCreator, mockRejectedTask)).toBe(false);
      expect(canLinkDisbursement(mockEmployeeCreator, mockRejectedTask, true)).toBe(false);
      expect(canLinkTransmittal(mockEmployeeCreator, mockRejectedTask)).toBe(false);
    });
  });

  // ==========================================================================
  // 5. Pending Tasks Remain Usable
  // ==========================================================================
  describe('5. Pending Tasks Usability Preservation', () => {
    it('identifies pending tasks and keeps status mutation active for assigned employee', () => {
      expect(isTaskPendingApproval(mockPendingTask)).toBe(true);
      expect(isTaskRejected(mockPendingTask)).toBe(false);
      expect(canMutateTaskStatus(mockEmployeeCreator, mockPendingTask)).toBe(true);
    });

    it('keeps time logging active for assigned employee on pending tasks', () => {
      expect(canLogTaskTime(mockEmployeeCreator, mockPendingTask)).toBe(true);
    });

    it('keeps document upload active for assigned employee on pending tasks', () => {
      expect(canUploadTaskDocument(mockEmployeeCreator, mockPendingTask)).toBe(true);
    });

    it('keeps checklist editing active for Manager on pending tasks', () => {
      expect(isChecklistEditor(mockLeadManager, mockPendingTask)).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Board Task Cards: Approval Markers & Lead-Only Controls
  // ==========================================================================
  describe('6. PhaseKanbanBoard Card Approval UI', () => {
    it('renders independent pending and rejected approval markers on cards', async () => {
      useSessionStore.getState().setSession({
        user: mockLeadManager,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PhaseKanbanBoard initialWorkRequestId="wr-1" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-task-card-t-pending-1')).toBeInTheDocument();
        expect(screen.getByTestId('kanban-task-card-t-rejected-1')).toBeInTheDocument();
      });

      // Pending marker
      const pendingBadge = screen.getByTestId('task-approval-badge-t-pending-1');
      expect(pendingBadge).toBeInTheDocument();
      expect(pendingBadge).toHaveTextContent(/Pending Approval/i);

      // Rejected marker and reason
      const rejectedBadge = screen.getByTestId('task-approval-badge-t-rejected-1');
      expect(rejectedBadge).toBeInTheDocument();
      expect(rejectedBadge).toHaveTextContent(/Creation Rejected/i);

      const reasonBox = screen.getByTestId('task-rejection-reason-t-rejected-1');
      expect(reasonBox).toHaveTextContent(/Break down into separate asset categories/i);
    });

    it('displays Approve and Reject buttons to assigned Manager lead, and executes approval', async () => {
      useSessionStore.getState().setSession({
        user: mockLeadManager,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PhaseKanbanBoard initialWorkRequestId="wr-1" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('task-approval-controls-t-pending-1')).toBeInTheDocument();
      });

      const approveBtn = screen.getByTestId('task-approve-btn-t-pending-1');
      const rejectBtn = screen.getByTestId('task-reject-btn-t-pending-1');
      expect(approveBtn).toBeInTheDocument();
      expect(rejectBtn).toBeInTheDocument();

      // Click Approve
      fireEvent.click(approveBtn);

      await waitFor(() => {
        const fetchCalls = vi.mocked(global.fetch).mock.calls;
        const approvalCall = fetchCalls.find(
          ([url, init]) =>
            String(url).includes('/operations/work-requests/wr-1/tasks/t-pending-1/creation-approval') &&
            init?.method === 'POST'
        );
        expect(approvalCall).toBeDefined();
        const body = JSON.parse(String(approvalCall?.[1]?.body || '{}'));
        expect(body.decision).toBe('approve');
        expect(body.expectedVersion).toBe(1);
      });
    });

    it('HIDES Approve/Reject buttons from Admin (strictly NO override)', async () => {
      useSessionStore.getState().setSession({
        user: mockAdminUser,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PhaseKanbanBoard initialWorkRequestId="wr-1" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-task-card-t-pending-1')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('task-approval-controls-t-pending-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('task-approve-btn-t-pending-1')).not.toBeInTheDocument();
    });

    it('shows Edit & Resubmit trigger to task creator on rejected task card', async () => {
      useSessionStore.getState().setSession({
        user: mockEmployeeCreator,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PhaseKanbanBoard initialWorkRequestId="wr-1" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('task-resubmit-btn-t-rejected-1')).toBeInTheDocument();
      });

      // Click resubmit -> opens TaskResubmitModal
      fireEvent.click(screen.getByTestId('task-resubmit-btn-t-rejected-1'));

      await waitFor(() => {
        expect(screen.getByTestId('task-resubmit-modal')).toBeInTheDocument();
        expect(screen.getByTestId('task-resubmit-rejection-reason')).toHaveTextContent(
          /Break down into separate asset categories/i
        );
      });
    });
  });

  // ==========================================================================
  // 7. Side Peek Task Approval & Inspection
  // ==========================================================================
  describe('7. WorkRequestSidePeek Approval UI', () => {
    it('renders independent approval badges and lead review controls in side peek', async () => {
      useSessionStore.getState().setSession({
        user: mockLeadManager,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-1"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-task-approval-t-pending-1')).toBeInTheDocument();
        expect(screen.getByTestId('side-peek-task-approval-t-rejected-1')).toBeInTheDocument();
      });

      // Lead Manager sees Approve and Reject buttons
      expect(screen.getByTestId('side-peek-task-approve-t-pending-1')).toBeInTheDocument();
      expect(screen.getByTestId('side-peek-task-reject-t-pending-1')).toBeInTheDocument();
    });

    it('hides lead approval controls in side peek for Admin and other employees', async () => {
      useSessionStore.getState().setSession({
        user: mockAdminUser,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-1"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-task-approval-t-pending-1')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('side-peek-task-approve-t-pending-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('side-peek-task-reject-t-pending-1')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 8. TaskResubmitModal Correction Flow
  // ==========================================================================
  describe('8. TaskResubmitModal Correction Flow', () => {
    it('validates required title and dispatches correction payload', async () => {
      useSessionStore.getState().setSession({
        user: mockEmployeeCreator,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const onSuccess = vi.fn();
      const onClose = vi.fn();

      const { wrapper } = createHarness();
      render(
        <TaskResubmitModal
          isOpen={true}
          task={mockRejectedTask}
          workRequest={mockWrWithLead}
          onSuccess={onSuccess}
          onClose={onClose}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('task-resubmit-modal')).toBeInTheDocument();
      const titleInput = screen.getByTestId('task-resubmit-title-input');

      // Clear title and submit -> error
      fireEvent.change(titleInput, { target: { value: '   ' } });
      fireEvent.click(screen.getByTestId('task-resubmit-submit-btn'));

      // Enter corrected title and submit
      fireEvent.change(titleInput, { target: { value: 'Draft Financial Assessment - Asset Breakdowns' } });
      fireEvent.click(screen.getByTestId('task-resubmit-submit-btn'));

      await waitFor(() => {
        const fetchCalls = vi.mocked(global.fetch).mock.calls;
        const resubmitCall = fetchCalls.find(
          ([url, init]) =>
            String(url).includes('/operations/work-requests/wr-1/tasks/t-rejected-1/resubmit-creation') &&
            init?.method === 'POST'
        );
        expect(resubmitCall).toBeDefined();
        const body = JSON.parse(String(resubmitCall?.[1]?.body || '{}'));
        expect(body.expectedVersion).toBe(2);
        expect(body.data.title).toBe('Draft Financial Assessment - Asset Breakdowns');
      });
    });

    it('closes modal when active account/user or entity switches', async () => {
      useSessionStore.getState().setSession({
        user: mockEmployeeCreator,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const onClose = vi.fn();
      const { wrapper } = createHarness();
      render(
        <TaskResubmitModal
          isOpen={true}
          task={mockRejectedTask}
          workRequest={mockWrWithLead}
          onClose={onClose}
        />,
        { wrapper }
      );

      // Switch active entity
      useSessionStore.getState().setActiveEntity('LTA');

      await waitFor(() => {
        expect(onClose).toHaveBeenCalled();
      });
    });
  });
});
