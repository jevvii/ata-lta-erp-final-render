import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisbursementActionRail } from '../components/workspace/DisbursementActionRail';
import { useSessionStore } from '@/lib/session';
import type { Disbursement } from '../api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

const baseDisbursement: Disbursement = {
  id: 'disb-test-1',
  disbursement_number: 'DISB-ATA-20261025-001',
  entity_id: 'ent-1',
  entity_code: 'ATA',
  category: 'Transportation',
  description: 'Courier delivery fee for client files',
  amount: 2500,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  version: 1,
  created_by: 'user-staff-owner',
  requested_by: 'user-staff-owner',
  linked_work_request_id: 'wr-101',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('DisbursementActionRail RBAC & Status Parity (design/disb-05)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Empty / Unselected State
  describe('Unselected / Empty State', () => {
    it('renders disabled-looking hint "Select a voucher to act on it" and no action buttons when nothing is selected', () => {
      const { wrapper } = createHarness();
      render(<DisbursementActionRail selectedId={null} selectedDisbursement={null} />, {
        wrapper,
      });

      expect(screen.getByTestId('disbursement-action-rail-empty')).toBeInTheDocument();
      expect(screen.getByText('Select a voucher to act on it')).toBeInTheDocument();
      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-fund-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-edit-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-print-btn')).not.toBeInTheDocument();
    });
  });

  // 2. Admin Role across all statuses
  describe('Admin Role Parity', () => {
    beforeEach(() => {
      useSessionStore.getState().setSession({
        user: {
          id: 'admin-1',
          email: 'admin@ata.ph',
          role: 'Admin',
          name: 'Managing Partner',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:approve', 'disbursement:edit'],
        activeEntity: 'ATA',
      });
    });

    it('Admin on Draft (review_ready=true): sees Direct Approve (enabled), Reject, Edit Voucher, Print', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Draft', review_ready: true };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      const approveBtn = screen.getByTestId('rail-approve-btn');
      expect(approveBtn).toBeInTheDocument();
      expect(approveBtn).toBeEnabled();

      expect(screen.getByTestId('rail-reject-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-btn')).toHaveTextContent('Edit Voucher');
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      // Inactive / unpermitted workflow buttons must be hidden
      expect(screen.queryByTestId('rail-fund-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-resend-draft-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-archive-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-restore-btn')).not.toBeInTheDocument();
    });

    it('Admin on Draft (review_ready=false, returned draft): Direct Approve is DISABLED with explanation title', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Draft', review_ready: false };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      const approveBtn = screen.getByTestId('rail-approve-btn');
      expect(approveBtn).toBeInTheDocument();
      expect(approveBtn).toBeDisabled();
      expect(approveBtn).toHaveAttribute('title', 'Returned draft awaiting requester correction');

      expect(screen.getByTestId('rail-reject-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();
    });

    it('Admin on Approved: sees Prepare Payment, Edit Printed Details, Print', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Approved' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-fund-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-btn')).toHaveTextContent('Edit Printed Details');
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-archive-btn')).not.toBeInTheDocument();
    });

    it('Admin on Funded: sees Sanction Release, Reject, Edit Payment Details, Edit Printed Details, Print', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Funded' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-release-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-reject-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-payment-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-btn')).toHaveTextContent('Edit Printed Details');
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-fund-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-archive-btn')).not.toBeInTheDocument();
    });

    it('Admin on Released (active): sees Archive Voucher, Edit Payment Details, Edit Printed Details, Print', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Released', archived: false };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-archive-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-payment-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-btn')).toHaveTextContent('Edit Printed Details');
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-restore-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
    });

    it('Admin on Released (archived or isArchiveTab): sees Restore Voucher, Print', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Released', archived: true };

      render(<DisbursementActionRail selectedDisbursement={disb} isArchiveTab={true} />, {
        wrapper,
      });

      expect(screen.getByTestId('rail-restore-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-archive-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-edit-btn')).not.toBeInTheDocument(); // archived cannot be edited
      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
    });

    it('Admin on Rejected: sees Return to Draft, Edit Printed Details, Print', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Rejected' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-resend-draft-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-edit-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-fund-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
    });
  });

  // 3. Accounting Role across statuses
  describe('Accounting Role Parity', () => {
    beforeEach(() => {
      useSessionStore.getState().setSession({
        user: {
          id: 'acct-1',
          email: 'acct@ata.ph',
          role: 'Accounting',
          name: 'Senior Accountant',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:create'],
        activeEntity: 'ATA',
      });
    });

    it('Accounting on Draft: can Edit Voucher (privileged creator) and Print; NEVER Direct Approve or Reject', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Draft' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-edit-btn')).toHaveTextContent('Edit Voucher');
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
    });

    it('Accounting on Approved: sees Prepare Payment and Print; NEVER Approve or Sanction Release', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Approved' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-fund-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-edit-btn')).not.toBeInTheDocument();
    });

    it('Accounting on Funded: sees Edit Payment Details and Print; NEVER Sanction Release', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Funded' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-edit-payment-btn')).toBeInTheDocument();
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
    });

    it('Accounting on Rejected: sees Print only; NEVER Return to Draft', () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Rejected' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();
      expect(screen.queryByTestId('rail-resend-draft-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
    });
  });

  // 4. Staff Owner vs Staff Non-Owner
  describe('Staff Role (Owner vs Non-Owner) Parity', () => {
    it('Staff Owner on Draft: can Edit Voucher and Print; NEVER sees Direct Approve, Reject, or Submit button', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-staff-owner',
          email: 'staff.owner@ata.ph',
          role: 'Staff',
          name: 'Staff Owner',
          departments: ['Audit'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:create'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Draft' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-edit-btn')).toHaveTextContent('Edit Voucher');
      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-fund-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
    });

    it('Staff Non-Owner on Draft: sees Print only; cannot Edit Voucher nor Approve', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-staff-other',
          email: 'staff.other@ata.ph',
          role: 'Staff',
          name: 'Staff Other',
          departments: ['Tax'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Draft' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();

      expect(screen.queryByTestId('rail-edit-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
    });

    it('Staff Non-Owner on Approved / Funded / Released / Rejected: sees Print only', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-staff-other',
          email: 'staff.other@ata.ph',
          role: 'Staff',
          name: 'Staff Other',
          departments: ['Tax'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();

      (['Approved', 'Funded', 'Released', 'Rejected'] as const).forEach((status) => {
        const { unmount } = render(
          <DisbursementActionRail
            selectedDisbursement={{ ...baseDisbursement, status }}
          />,
          { wrapper }
        );

        expect(screen.getByTestId('rail-print-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('rail-approve-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('rail-reject-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('rail-fund-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('rail-release-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('rail-edit-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('rail-archive-btn')).not.toBeInTheDocument();

        unmount();
      });
    });
  });

  // 5. Modal and Interaction Triggers
  describe('Modal and Mutation Triggers', () => {
    beforeEach(() => {
      useSessionStore.getState().setSession({
        user: {
          id: 'admin-1',
          email: 'admin@ata.ph',
          role: 'Admin',
          name: 'Admin User',
          departments: ['Management', 'Accounting'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:approve', 'disbursement:edit'],
        activeEntity: 'ATA',
      });
    });

    it('clicking Direct Approve opens AdminApprovalModal', async () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Draft', review_ready: true };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      fireEvent.click(screen.getByTestId('rail-approve-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
    });

    it('clicking Prepare Payment opens FundDisbursementModal', async () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Approved' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      fireEvent.click(screen.getByTestId('rail-fund-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('fund-disbursement-modal')).toBeInTheDocument();
      });
    });

    it('clicking Sanction Release opens ReleaseFundsModal', async () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Funded' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      fireEvent.click(screen.getByTestId('rail-release-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('release-funds-modal')).toBeInTheDocument();
      });
    });

    it('clicking Print Voucher opens DisbursementPrintModal', async () => {
      const { wrapper } = createHarness();
      render(<DisbursementActionRail selectedDisbursement={baseDisbursement} />, { wrapper });

      fireEvent.click(screen.getByTestId('rail-print-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('disbursement-print-modal')).toBeInTheDocument();
      });
    });

    it('clicking Reject Voucher opens RejectReasonModal', async () => {
      const { wrapper } = createHarness();
      const disb: Disbursement = { ...baseDisbursement, status: 'Draft' };

      render(<DisbursementActionRail selectedDisbursement={disb} />, { wrapper });

      fireEvent.click(screen.getByTestId('rail-reject-btn'));
      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-modal')).toBeInTheDocument();
      });
    });
  });
});
