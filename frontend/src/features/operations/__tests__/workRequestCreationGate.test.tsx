import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WorkRequestList } from '../components/WorkRequestList';
import { WorkRequestModal } from '../components/WorkRequestModal';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { PendingApprovalsInbox } from '../components/PendingApprovalsInbox';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { WorkRequest } from '../api/types';

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

const mockWorkRequests: WorkRequest[] = [
  {
    id: 'wr-approved-1',
    title: 'Grandfathered Approved Engagement',
    description: null,
    clientId: 'c-1',
    phaseEnteredAt: null,
    entity: 'ATA',
    status: 'In Progress',
    phase: 'pre_processing',
    onHold: false,
    priority: 'Normal',
    archived: false,
    requestedBy: 'u-admin-1',
    assignedTo: 'u-mgr-1',
    coAssignees: [],
    dueDate: new Date().toISOString(),
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    creationApprovalStatus: 'approved',
  },
  {
    id: 'wr-pending-1',
    title: 'Pending Manager Created Request',
    description: null,
    clientId: 'c-1',
    phaseEnteredAt: null,
    entity: 'ATA',
    status: 'Received',
    phase: 'pre_processing',
    onHold: false,
    priority: 'High',
    archived: false,
    requestedBy: 'u-mgr-1',
    assignedTo: 'u-mgr-1',
    coAssignees: [],
    dueDate: new Date().toISOString(),
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    creationApprovalStatus: 'pending',
  },
  {
    id: 'wr-rejected-1',
    title: 'Rejected Manager Request',
    description: null,
    clientId: 'c-1',
    phaseEnteredAt: null,
    entity: 'ATA',
    status: 'Received',
    phase: 'pre_processing',
    onHold: false,
    priority: 'Urgent',
    archived: false,
    requestedBy: 'u-mgr-1',
    assignedTo: 'u-mgr-1',
    coAssignees: [],
    dueDate: new Date().toISOString(),
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    creationApprovalStatus: 'rejected',
    rejectionReason: 'Scope too vague. Clarify SEC filing details.',
  },
];

describe('Parcel 3: Work Request Creation Gate UI', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method || 'GET';

      if (u.includes('/operations/work-requests/creation-approvals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              mockWorkRequests[1], // pending
              mockWorkRequests[2], // rejected
            ],
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests') && u.includes('/creation-approval') && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ...mockWorkRequests[1],
              creationApprovalStatus: body.decision === 'approve' ? 'approved' : 'rejected',
              rejectionReason: body.reason || null,
              version: (body.expectedVersion || 1) + 1,
            },
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests') && u.includes('/resubmit-creation') && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              ...mockWorkRequests[2],
              creationApprovalStatus: 'pending',
              rejectionReason: null,
              version: (body.expectedVersion || 1) + 1,
            },
          }),
        } as Response);
      }

      if (u.includes('/tasks') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response);
      }

      if (u.includes('/operations/work-requests') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockWorkRequests }),
        } as Response);
      }

      if (u.includes('/operations/counts')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { active: 1, archived: 0, pending: 1 } }),
        } as Response);
      }

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'c-1', name: 'Acme Corp', entity: 'ATA' }] }),
        } as Response);
      }

      if (u.includes('/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'u-admin-1', name: 'Admin Boss', role: 'Admin' },
              { id: 'u-mgr-1', name: 'Manager Maria', role: 'Manager' },
              { id: 'u-staff-1', name: 'Staff Employee', role: 'Staff' },
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

  describe('1. WorkRequestList Gating & Role Isolation', () => {
    it('excludes pending and rejected work requests from the main list', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-mgr-1',
          email: 'maria@ata-lta.ph',
          name: 'Manager Maria',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Grandfathered Approved Engagement')).toBeInTheDocument();
      });

      // Pending and Rejected must NOT be visible on regular list
      expect(screen.queryByText('Pending Manager Created Request')).not.toBeInTheDocument();
      expect(screen.queryByText('Rejected Manager Request')).not.toBeInTheDocument();
    });

    it('excludes pending and rejected work requests from PhaseKanbanBoard switcher dropdown', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-mgr-1',
          email: 'maria@ata-lta.ph',
          name: 'Manager Maria',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PhaseKanbanBoard initialWorkRequestId="wr-approved-1" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('phase-kanban-board')).toBeInTheDocument();
      });

      const switcher = screen.getByTestId('kanban-wr-select');
      expect(switcher).toBeInTheDocument();

      // Options inside select dropdown should contain approved/legacy but NOT pending/rejected
      expect(screen.getAllByText(/Grandfathered Approved Engagement/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Pending Manager Created Request/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Rejected Manager Request/i)).not.toBeInTheDocument();
    });

    it('hides "New Work Request" button from non-Admin, non-Manager employees', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-staff-1',
          email: 'staff@ata-lta.ph',
          name: 'Staff Employee',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<WorkRequestList onCreateNew={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText('Grandfathered Approved Engagement')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('new-wr-btn')).not.toBeInTheDocument();
    });

    it('shows "New Work Request" button for Admin and Manager', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin Boss',
          role: 'Admin',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<WorkRequestList onCreateNew={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('new-wr-btn')).toBeInTheDocument();
      });
    });
  });

  describe('2. WorkRequestModal Role Gating & Submit Behaviors', () => {
    it('blocks creation and displays warning when accessed by unauthorized employee', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-staff-1',
          email: 'staff@ata-lta.ph',
          name: 'Staff Employee',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      expect(screen.getByTestId('unauthorized-wr-creator-banner')).toBeInTheDocument();
      expect(
        screen.getByText(/Work Request creation is restricted to Admin and Manager roles/i)
      ).toBeInTheDocument();
      expect(screen.getByTestId('wr-modal-submit-btn')).toBeDisabled();
    });

    it('displays pending approval notice for Manager creating a work request', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-mgr-1',
          email: 'maria@ata-lta.ph',
          name: 'Manager Maria',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<WorkRequestModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      expect(screen.getByTestId('manager-wr-pending-notice')).toBeInTheDocument();
      expect(
        screen.getByText(/require Admin approval before appearing on the active board/i)
      ).toBeInTheDocument();
      expect(screen.getByTestId('wr-modal-submit-btn')).toHaveTextContent('Submit for Approval');
    });

    it('displays rejection reason and "Resubmit for Approval" button when editing rejected WR', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-mgr-1',
          email: 'maria@ata-lta.ph',
          name: 'Manager Maria',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <WorkRequestModal
          isOpen={true}
          workRequest={mockWorkRequests[2]} // rejected
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText('Resubmit Work Request')).toBeInTheDocument();
      expect(screen.getByTestId('rejection-reason-banner')).toBeInTheDocument();
      expect(screen.getByText('Scope too vague. Clarify SEC filing details.')).toBeInTheDocument();
      expect(screen.getByTestId('wr-modal-submit-btn')).toHaveTextContent('Resubmit for Approval');
    });
  });

  describe('3. Admin Creation Inbox & Manager Submissions in PendingApprovalsInbox', () => {
    it('allows Admin to switch to WR Creation Inbox and approve a pending request', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin Boss',
          role: 'Admin',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit', 'workflow:phase_transition'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PendingApprovalsInbox />, { wrapper });

      // Click "WR Creation Inbox" tab
      const creationTabBtn = screen.getByTestId('inbox-category-wr-creation');
      expect(creationTabBtn).toBeInTheDocument();
      fireEvent.click(creationTabBtn);

      await waitFor(() => {
        expect(screen.getByTestId('wr-creation-inbox')).toBeInTheDocument();
        expect(screen.getAllByText('Pending Manager Created Request').length).toBeGreaterThan(0);
      });

      // Select card
      fireEvent.click(screen.getByTestId('wr-creation-card-wr-pending-1'));

      // Check detail pane
      expect(screen.getByTestId('wr-creation-detail-pane')).toBeInTheDocument();
      expect(screen.getByTestId('approve-wr-creation-btn')).toBeInTheDocument();
      expect(screen.getByTestId('reject-wr-creation-btn')).toBeInTheDocument();

      // Click Approve
      fireEvent.click(screen.getByTestId('approve-wr-creation-btn'));

      await waitFor(() => {
        const fetchCalls = vi.mocked(global.fetch).mock.calls;
        const approvalCall = fetchCalls.find(
          ([url, init]) =>
            String(url).includes('/operations/work-requests/wr-pending-1/creation-approval') &&
            init?.method === 'POST'
        );
        expect(approvalCall).toBeDefined();
        const body = JSON.parse(String(approvalCall?.[1]?.body || '{}'));
        expect(body.decision).toBe('approve');
        expect(body.expectedVersion).toBe(1);
      });
    });

    it('enforces mandatory rejection reason when Admin rejects a pending WR', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin Boss',
          role: 'Admin',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit', 'workflow:phase_transition'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PendingApprovalsInbox />, { wrapper });

      // Click "WR Creation Inbox" tab
      fireEvent.click(screen.getByTestId('inbox-category-wr-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('wr-creation-inbox')).toBeInTheDocument();
        expect(screen.getByTestId('wr-creation-card-wr-pending-1')).toBeInTheDocument();
      });

      // Select card
      fireEvent.click(screen.getByTestId('wr-creation-card-wr-pending-1'));

      // Click Reject -> opens RejectReasonModal
      fireEvent.click(screen.getByTestId('reject-wr-creation-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-modal')).toBeInTheDocument();
      });

      // Try empty reason -> error
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-error')).toBeInTheDocument();
      });

      // Enter valid reason and submit
      const textarea = screen.getByTestId('reject-reason-textarea');
      fireEvent.change(textarea, {
        target: { value: 'Incomplete client requirements; please attach SEC reservation certificate.' },
      });
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));

      await waitFor(() => {
        const fetchCalls = vi.mocked(global.fetch).mock.calls;
        const rejectCall = fetchCalls.find(
          ([url, init]) =>
            String(url).includes('/operations/work-requests/wr-pending-1/creation-approval') &&
            init?.method === 'POST'
        );
        expect(rejectCall).toBeDefined();
        const body = JSON.parse(String(rejectCall?.[1]?.body || '{}'));
        expect(body.decision).toBe('reject');
        expect(body.reason).toBe(
          'Incomplete client requirements; please attach SEC reservation certificate.'
        );
        expect(body.expectedVersion).toBe(1);
      });
    });

    it('allows Manager to view My WR Submissions with rejection reason and resubmit trigger', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-mgr-1',
          email: 'maria@ata-lta.ph',
          name: 'Manager Maria',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PendingApprovalsInbox />, { wrapper });

      // Click "My WR Submissions" tab
      const mySubmissionsBtn = screen.getByTestId('inbox-category-wr-creation');
      expect(mySubmissionsBtn).toHaveTextContent('My WR Submissions');
      fireEvent.click(mySubmissionsBtn);

      await waitFor(() => {
        expect(screen.getByTestId('wr-creation-inbox')).toBeInTheDocument();
        expect(screen.getAllByText('Rejected Manager Request').length).toBeGreaterThan(0);
      });

      // Select rejected card
      fireEvent.click(screen.getByTestId('wr-creation-card-wr-rejected-1'));

      // Check rejection reason alert
      expect(screen.getByTestId('wr-creation-rejection-notice')).toBeInTheDocument();
      expect(screen.getAllByText(/Scope too vague/i).length).toBeGreaterThan(0);

      // Check Edit & Resubmit button
      const resubmitBtn = screen.getByTestId('resubmit-wr-creation-btn');
      expect(resubmitBtn).toBeInTheDocument();
      fireEvent.click(resubmitBtn);

      // Verify modal opens with resubmit state
      await waitFor(() => {
        expect(screen.getByText('Resubmit Work Request')).toBeInTheDocument();
      });
    });

    it('prevents stale rejection and does not retarget surviving WR if the intended WR is removed before confirmation', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Super Admin',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit', 'workflow:phase_transition'],
        activeEntity: 'ATA',
      });

      let currentApprovals = [
        {
          id: 'wr-pending-intended',
          title: 'Target Intended WR',
          clientId: 'c-1',
          entity: 'ATA',
          status: 'Received',
          phase: 'pre_processing',
          creationApprovalStatus: 'pending' as const,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'wr-pending-surviving',
          title: 'Surviving Other WR',
          clientId: 'c-1',
          entity: 'ATA',
          status: 'Received',
          phase: 'pre_processing',
          creationApprovalStatus: 'pending' as const,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      vi.mocked(global.fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : 'url' in input ? input.url : input.toString();
        const method = init?.method || 'GET';
        if (u.includes('/operations/work-requests/creation-approvals')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: currentApprovals }),
          } as Response);
        }
        if (u.includes('/creation-approval') && method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 'mock-rejected' } }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper, queryClient } = createHarness();
      render(<PendingApprovalsInbox />, { wrapper });

      // Click WR Creation Approvals
      fireEvent.click(screen.getByTestId('inbox-category-wr-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('wr-creation-card-wr-pending-intended')).toBeInTheDocument();
      });

      // Select intended WR
      fireEvent.click(screen.getByTestId('wr-creation-card-wr-pending-intended'));

      // Click Reject -> captures intent for wr-pending-intended
      fireEvent.click(screen.getByTestId('reject-wr-creation-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-modal')).toBeInTheDocument();
      });

      // Simulate target WR removed/deleted from server queue while modal was open
      currentApprovals = [currentApprovals[1]!]; // only wr-pending-surviving remains
      queryClient.setQueryData(
        ['operations', 'workRequests', 'creationApprovals', 'pending', 'all'],
        currentApprovals
      );

      // Enter rejection reason
      const textarea = screen.getByTestId('reject-reason-textarea');
      fireEvent.change(textarea, { target: { value: 'Rejecting intended item' } });

      // Submit rejection
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));

      // Ensure NO call was made to reject the surviving WR (never retarget stale action!)
      await waitFor(() => {
        const calls = vi.mocked(global.fetch).mock.calls;
        const badCall = calls.find(
          ([url, init]) =>
            String(url).includes('/operations/work-requests/wr-pending-surviving/creation-approval') &&
            init?.method === 'POST'
        );
        expect(badCall).toBeUndefined();
      });
    });

    it('renders only pending, rejected, approved tabs (no misleading All tab)', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Super Admin',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'workflow:edit', 'workflow:phase_transition'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<PendingApprovalsInbox />, { wrapper });

      fireEvent.click(screen.getByTestId('inbox-category-wr-creation'));

      await waitFor(() => {
        expect(screen.getByTestId('wr-creation-subtabs')).toBeInTheDocument();
      });

      expect(screen.getByTestId('wr-creation-tab-pending')).toBeInTheDocument();
      expect(screen.getByTestId('wr-creation-tab-rejected')).toBeInTheDocument();
      expect(screen.getByTestId('wr-creation-tab-approved')).toBeInTheDocument();
      expect(screen.queryByTestId('wr-creation-tab-all')).not.toBeInTheDocument();
    });
  });
});
