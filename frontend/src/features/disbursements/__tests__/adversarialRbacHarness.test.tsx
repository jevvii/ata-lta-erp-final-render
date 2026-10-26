import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DisbursementsPage from '@/routes/disbursements';
import { AdminApprovalQueue } from '../components/AdminApprovalQueue';
import { FundsReleaseActions } from '../components/FundsReleaseActions';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { RejectReasonModal } from '@/features/operations/components/RejectReasonModal';
import {
  BlockingActionModal,
  useBlockingModalStore,
  runBlockingAction,
} from '@/features/operations/components/BlockingActionModal';
import { createDisbursementSchema } from '../api/schemas';
import { useSessionStore } from '@/lib/session';
import { ApiError, queryClient as globalQueryClient } from '@/lib/api';
import type { Disbursement } from '../api/types';

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

const mockDraftDisbursement: Disbursement = {
  id: 'disb-draft-1',
  disbursement_number: 'DISB-ATA-20261004-901',
  entity_id: 'ent-1',
  category: 'Transportation',
  description: 'Urgent courier filing fee',
  amount: 450,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: '11111111-1111-1111-1111-111111111111',
  version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockApprovedDisbursement: Disbursement = {
  id: 'disb-approved-1',
  disbursement_number: 'DISB-ATA-20261004-902',
  entity_id: 'ent-1',
  category: 'Government Fee',
  description: 'BIR 0605 renewal fee',
  amount: 1500,
  fund_source: 'Client Fund',
  status: 'Approved',
  lifecycle_version: 2,
  linked_work_request_id: '11111111-1111-1111-1111-111111111111',
  version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockFundedDisbursement: Disbursement = {
  id: 'disb-funded-1',
  disbursement_number: 'DISB-ATA-20261004-903',
  entity_id: 'ent-1',
  category: 'Professional Fee',
  description: 'Notary fee',
  amount: 800,
  fund_source: 'Firm Fund',
  status: 'Funded',
  lifecycle_version: 2,
  funded_by: 'u-other-preparer',
  linked_work_request_id: '11111111-1111-1111-1111-111111111111',
  version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('Adversarial Stress Test: RBAC, Modals, and UI Boundaries', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    globalQueryClient.clear();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
        entities: ['ATA'],
      },
      permissions: [
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
      ],
      activeEntity: 'ATA',
    });
  });

  // =========================================================================
  // SUITE 1: RBAC Permission Gating Across 6 Canonical Roles & Permissions
  // =========================================================================
  describe('RBAC Permission Gating', () => {
    const rolesConfig = [
      {
        role: 'Admin',
        permissions: [
          'disbursement:view',
          'disbursement:create',
          'disbursement:approve',
          'disbursement:mark_released',
          'disbursement:edit',
        ],
        canCreate: true,
        canApprove: true,
        canMarkReleased: true,
        canAccessQueue: true,
        queueTitle: /Admin Approval Queue/i,
      },
      {
        role: 'Manager',
        permissions: [
          'disbursement:view',
          'disbursement:create',
          'disbursement:edit',
          'disbursement:mark_released',
        ],
        canCreate: true,
        canApprove: false,
        canMarkReleased: false,
        canAccessQueue: false,
      },
      {
        role: 'Accounting',
        permissions: [
          'disbursement:view',
          'disbursement:create',
          'disbursement:edit',
        ],
        canCreate: true,
        canApprove: false,
        canMarkReleased: false,
        canAccessQueue: true,
        queueTitle: /Accounting Funds Tracking/i,
      },
      {
        role: 'Accounting',
        label: 'Accounting (with mark_released grant)',
        permissions: [
          'disbursement:view',
          'disbursement:create',
          'disbursement:edit',
          'disbursement:mark_released',
        ],
        canCreate: true,
        canApprove: false,
        canMarkReleased: false,
        canAccessQueue: true,
        queueTitle: /Accounting Funds Tracking/i,
      },
      {
        role: 'Operations',
        permissions: ['disbursement:view', 'disbursement:create'],
        canCreate: true,
        canApprove: false,
        canMarkReleased: false,
        canAccessQueue: false,
      },
      {
        role: 'Documentation',
        permissions: ['disbursement:view', 'disbursement:create'],
        canCreate: true,
        canApprove: false,
        canMarkReleased: false,
        canAccessQueue: false,
      },
      {
        role: 'HR',
        permissions: ['disbursement:view', 'disbursement:create'],
        canCreate: true,
        canApprove: false,
        canMarkReleased: false,
        canAccessQueue: false,
      },
    ];

    rolesConfig.forEach(({ role, label, permissions, canCreate, canMarkReleased, canAccessQueue, queueTitle }) => {
      it(`enforces RBAC rules for role: "${label || role}" correctly in UI components`, async () => {
        useSessionStore.getState().setSession({
          user: {
            id: `u-${role}`,
            email: `${role.toLowerCase()}@ata-lta.ph`,
            name: `${role} User`,
            role,
            departments: [role],
            entities: ['ATA'],
          },
          permissions,
          activeEntity: 'ATA',
        });

        // 1. Check DisbursementsPage header button "New Disbursement"
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: [],
            meta: { total: 0, page: 1, limit: 20 },
            active: 0,
            awaitingRelease: 0,
            rejected: 0,
            archived: 0,
          }),
        });

        const { wrapper } = createHarness();
        const { unmount } = render(<DisbursementsPage />, { wrapper });

        if (canCreate) {
          expect(screen.getByTestId('page-new-disbursement-btn')).toBeInTheDocument();
        } else {
          expect(screen.queryByTestId('page-new-disbursement-btn')).not.toBeInTheDocument();
        }
        unmount();

        // 2. Check AdminApprovalQueue gating
        render(<AdminApprovalQueue />, { wrapper });
        if (canAccessQueue) {
          expect(screen.getByTestId('admin-approval-queue')).toBeInTheDocument();
          expect(screen.getByText(queueTitle!)).toBeInTheDocument();
        } else {
          expect(screen.getByTestId('admin-approval-queue-unauthorized')).toBeInTheDocument();
          expect(screen.getByText(/Access Restricted/i)).toBeInTheDocument();
        }
        unmount();

        // 3. Check FundsReleaseActions for Funded status (Admin only in v2)
        const { container } = render(
          <FundsReleaseActions disbursement={mockFundedDisbursement} />,
          { wrapper }
        );
        if (canMarkReleased) {
          expect(
            screen.getByTestId('action-release-btn')
          ).toBeInTheDocument();
        } else {
          expect(container.firstChild).toBeNull();
        }
        unmount();
      });
    });

    it('DisbursementsPage strictly renders Forbidden if user lacks disbursement:view', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-restricted',
          email: 'restricted@ata-lta.ph',
          name: 'Restricted User',
          role: 'Operations',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['clients:view'], // NO disbursement:view
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<DisbursementsPage />, { wrapper });

      expect(screen.getByTestId('forbidden-screen')).toBeInTheDocument();
      expect(screen.getByText('disbursement:view')).toBeInTheDocument();
      expect(screen.queryByTestId('disbursements-page')).not.toBeInTheDocument();
    });

    it('DisbursementDetailDrawer conditionally gates Approve/Reject and Release/Fund actions', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/disbursements/disb-draft-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDraftDisbursement }),
          };
        }
        if (url.includes('/disbursements/disb-approved-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockApprovedDisbursement }),
          };
        }
        if (url.includes('/disbursements/disb-funded-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockFundedDisbursement }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();

      // Case A: User has NO admin or release permissions (standard staff)
      useSessionStore.getState().setSession({
        user: {
          id: 'u-staff',
          email: 'staff@ata-lta.ph',
          name: 'Staff',
          role: 'Operations',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:create'],
        activeEntity: 'ATA',
      });

      // Draft item: Staff should NOT see approve/reject buttons
      const { unmount: unmount1 } = render(
        <DisbursementDetailDrawer id="disb-draft-1" isOpen={true} onClose={() => {}} />,
        { wrapper }
      );
      await waitFor(() => {
        expect(screen.getByText('Urgent courier filing fee')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('drawer-direct-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('drawer-reject-btn')).not.toBeInTheDocument();
      unmount1();

      // Funded item: Staff should NOT see release button
      const { unmount: unmount2 } = render(
        <DisbursementDetailDrawer id="disb-funded-1" isOpen={true} onClose={() => {}} />,
        { wrapper }
      );
      await waitFor(() => {
        expect(screen.getByText('Notary fee')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('drawer-release-btn')).not.toBeInTheDocument();
      unmount2();

      // Case B: Admin user with full permissions
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin',
          email: 'admin@ata-lta.ph',
          name: 'Admin',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: [
          'disbursement:view',
          'disbursement:approve',
          'disbursement:mark_released',
        ],
        activeEntity: 'ATA',
      });

      // Draft item: Admin MUST see approve and reject buttons
      const { unmount: unmount3 } = render(
        <DisbursementDetailDrawer id="disb-draft-1" isOpen={true} onClose={() => {}} />,
        { wrapper }
      );
      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
        expect(screen.getByTestId('drawer-reject-btn')).toBeInTheDocument();
      });
      unmount3();

      // Funded item: Admin MUST see release button
      const { unmount: unmount4 } = render(
        <DisbursementDetailDrawer id="disb-funded-1" isOpen={true} onClose={() => {}} />,
        { wrapper }
      );
      await waitFor(() => {
        expect(screen.getByTestId('drawer-release-btn')).toBeInTheDocument();
      });
      unmount4();
    });
  });

  // =========================================================================
  // SUITE 2: RejectReasonModal Backwards Compatibility & Custom Prop Limits
  // =========================================================================
  describe('RejectReasonModal Non-Breaking Behavior & Boundary Limits', () => {
    it('Defaults to 2000 character limit and Operations semantics when no custom props provided', async () => {
      const { wrapper } = createHarness();
      const onClose = vi.fn();

      render(
        <RejectReasonModal
          isOpen={true}
          requestId="req-default-test"
          workRequestTitle="Default Ops Request"
          onClose={onClose}
        />,
        { wrapper }
      );

      // Verify default title and submit label
      expect(screen.getByText('Reject Phase Transition')).toBeInTheDocument();
      expect(screen.getByTestId('reject-reason-submit-btn').textContent).toBe(
        'Reject Transition'
      );

      // Boundary 0: empty
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-error')).toHaveTextContent(
          'Rejection reason is required (minimum 1 character)'
        );
      });

      // Boundary 2000 characters: valid
      const textarea = screen.getByTestId('reject-reason-textarea');
      const text2000 = 'A'.repeat(2000);
      fireEvent.change(textarea, { target: { value: text2000 } });
      expect(screen.getByText('2000 / 2000 characters')).toBeInTheDocument();
      expect(screen.queryByTestId('reject-reason-error')).not.toBeInTheDocument();

      // Boundary 2001 characters: rejected
      const text2001 = 'A'.repeat(2001);
      fireEvent.change(textarea, { target: { value: text2001 } });
      expect(screen.getByText('2001 / 2000 characters')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-error')).toHaveTextContent(
          'Rejection reason cannot exceed 2000 characters'
        );
      });
    });

    it('Enforces Disbursements 1–500 character limit and custom props when supplied', async () => {
      const { wrapper } = createHarness();
      const onClose = vi.fn();
      let rejectedId: string | null = null;
      let rejectedReason: string | null = null;

      const mockOnReject = vi.fn().mockImplementation(async (id: string, reason: string) => {
        rejectedId = id;
        rejectedReason = reason;
        return { success: true };
      });

      render(
        <RejectReasonModal
          isOpen={true}
          requestId="disb-999"
          title="Reject Disbursement Voucher"
          description="Provide justification for rejecting voucher (1–500 characters)."
          placeholder="e.g. Ineligible reimbursement item..."
          submitLabel="Reject Voucher"
          maxLength={500}
          onReject={mockOnReject}
          onClose={onClose}
        />,
        { wrapper }
      );

      // Verify custom title, submit label, and placeholder
      expect(screen.getByText('Reject Disbursement Voucher')).toBeInTheDocument();
      expect(screen.getByTestId('reject-reason-submit-btn').textContent).toBe('Reject Voucher');
      expect(
        screen.getByPlaceholderText('e.g. Ineligible reimbursement item...')
      ).toBeInTheDocument();

      // Boundary 0: empty blocked
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-error')).toHaveTextContent(
          'Rejection reason is required (minimum 1 character)'
        );
      });
      expect(mockOnReject).not.toHaveBeenCalled();

      // Boundary 501: blocked
      const textarea = screen.getByTestId('reject-reason-textarea');
      const text501 = 'B'.repeat(501);
      fireEvent.change(textarea, { target: { value: text501 } });
      expect(screen.getByText('501 / 500 characters')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-error')).toHaveTextContent(
          'Rejection reason cannot exceed 500 characters'
        );
      });
      expect(mockOnReject).not.toHaveBeenCalled();

      // Boundary 500: accepted and executes onReject
      const text500 = 'C'.repeat(500);
      fireEvent.change(textarea, { target: { value: text500 } });
      expect(screen.getByText('500 / 500 characters')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('reject-reason-submit-btn'));

      await waitFor(() => {
        expect(mockOnReject).toHaveBeenCalledWith('disb-999', text500);
      });
      expect(rejectedId).toBe('disb-999');
      expect(rejectedReason).toBe(text500);
    });
  });

  // =========================================================================
  // SUITE 3: Status Anti-Forgery Defense
  // =========================================================================
  describe('Status Anti-Forgery Guard', () => {
    it('Zod createDisbursementSchema explicitly rejects any payload with status field', () => {
      const validPayload = {
        category: 'Transportation',
        description: 'Client visit fare',
        amount: 250,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: '11111111-1111-1111-1111-111111111111',
      };

      // Valid payload passes
      expect(() => createDisbursementSchema.parse(validPayload)).not.toThrow();

      // Forged payload with status='Approved' MUST throw validation error
      const forgedPayload = {
        ...validPayload,
        status: 'Approved',
      };
      expect(() => createDisbursementSchema.parse(forgedPayload)).toThrow();

      // Forged payload with status='Draft' MUST also throw validation error
      const forgedDraft = {
        ...validPayload,
        status: 'Draft',
      };
      expect(() => createDisbursementSchema.parse(forgedDraft)).toThrow();
    });

    it('CreateDisbursementModal DOM never contains status selector or input', () => {
      const { wrapper } = createHarness();
      render(<CreateDisbursementModal isOpen={true} onClose={() => {}} />, { wrapper });

      expect(screen.queryByTestId('select-status')).not.toBeInTheDocument();
      expect(screen.queryByTestId('input-status')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // SUITE 4: Zero Optimistic Updates & Verbatim RFC 7807 Error Surfacing
  // =========================================================================
  describe('RFC 7807 Error Code & Detail Surfacing', () => {
    it('surfaces RFC 7807 error.code and error.detail verbatim in BlockingActionModal', async () => {
      const { wrapper } = createHarness();

      render(<BlockingActionModal />, { wrapper });

      const rfc7807Error = new ApiError(
        409,
        'Conflict: Current Status Invalid',
        'Cannot approve disbursement: current status is "Rejected". State machine conflict.',
        'CONFLICT_CURRENT_STATUS'
      );

      // Trigger blocking action that rejects with rfc7807Error
      let caughtError = false;
      try {
        await runBlockingAction({
          title: 'Approving Disbursement',
          message: 'Approving...',
          apiCall: async () => {
            throw rfc7807Error;
          },
        });
      } catch {
        caughtError = true;
      }

      expect(caughtError).toBe(true);

      // Modal should now be in error state
      await waitFor(() => {
        expect(screen.getByTestId('error-code-badge')).toBeInTheDocument();
        expect(screen.getByTestId('error-detail-body')).toBeInTheDocument();
      });

      // Verify code and detail are displayed verbatim
      expect(screen.getByTestId('error-code-badge').textContent).toBe(
        'CONFLICT_CURRENT_STATUS'
      );
      expect(screen.getByTestId('error-detail-body').textContent).toBe(
        'Cannot approve disbursement: current status is "Rejected". State machine conflict.'
      );
    });
  });
});
