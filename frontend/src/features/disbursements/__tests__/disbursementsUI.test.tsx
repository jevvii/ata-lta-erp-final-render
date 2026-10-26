import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { AdminApprovalQueue } from '../components/AdminApprovalQueue';
import { FundsReleaseActions } from '../components/FundsReleaseActions';
import { DisbursementsTable } from '../components/DisbursementsTable';
import { DisbursementStatusBadge } from '../components/DisbursementStatusBadge';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import { DisbursementPrintModal } from '../components/DisbursementPrintModal';
import { useSessionStore, type SessionState } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { supabase } from '@/lib/supabase';
import type { Disbursement } from '../api/types';

// UAT-SH6: Isolate useSessionStore per test to prevent concurrent cross-suite state leakage
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  const { create } = await import('zustand');
  const isolatedStore = create<SessionState>((set) => ({
    user: null,
    permissions: new Set<string>(),
    activeEntity: 'ATA',
    unreadCount: 0,
    isAuthenticated: true,
    isLoading: false,

    setSession: ({ user, permissions, activeEntity, unreadCount }) => {
      const permSet = permissions instanceof Set ? permissions : new Set(permissions);
      set({
        user,
        permissions: permSet,
        activeEntity: activeEntity || 'ATA',
        unreadCount: unreadCount ?? 0,
        isAuthenticated: true,
        isLoading: false,
      });
    },
    setActiveEntity: (entity) => set({ activeEntity: entity }),
    setUnreadCount: (count) => set({ unreadCount: count }),
    clearSession: () => set({
      user: null,
      permissions: new Set<string>(),
      activeEntity: null,
      unreadCount: 0,
      isAuthenticated: false,
      isLoading: false,
    }),
    setLoading: (isLoading) => set({ isLoading }),
  }));

  return {
    ...actual,
    useSessionStore: isolatedStore,
  };
});

let activeQueryClients: QueryClient[] = [];

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  activeQueryClients.push(queryClient);

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const mockDisbursements: Disbursement[] = [
  {
    id: 'disb-101',
    disbursement_number: 'DISB-ATA-20261004-101',
    entity_id: 'ent-1',
    category: 'Transportation',
    description: 'Messenger delivery to SEC office',
    amount: 350,
    fund_source: 'Firm Fund',
    status: 'Draft',
    lifecycle_version: 2,
    review_ready: true,
    linked_work_request_id: '11111111-1111-1111-1111-111111111111',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'disb-102',
    disbursement_number: 'DISB-ATA-20261004-102',
    entity_id: 'ent-1',
    category: 'Government Fee',
    description: 'BIR 0605 renewal fee',
    amount: 500,
    fund_source: 'Client Fund',
    status: 'Approved',
    lifecycle_version: 2,
    review_ready: true,
    linked_work_request_id: '11111111-1111-1111-1111-111111111111',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'disb-103',
    disbursement_number: 'DISB-ATA-20261004-103',
    entity_id: 'ent-1',
    category: 'Professional Fee',
    description: 'Notary commission',
    amount: 2500,
    fund_source: 'Firm Fund',
    status: 'Funded',
    lifecycle_version: 2,
    review_ready: true,
    linked_work_request_id: '11111111-1111-1111-1111-111111111111',
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

describe('Disbursements UI Components & Integration', () => {
  const originalFetch = global.fetch;

  const setAdminSession = () => {
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
  };

  const defaultMockFetch = vi.fn().mockImplementation(async () => {
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        data: [],
        meta: { total: 0, page: 1, limit: 20 },
      }),
    };
  });

  beforeEach(() => {
    global.fetch = defaultMockFetch;
    setAdminSession();
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    activeQueryClients.forEach((qc) => {
      qc.cancelQueries();
      qc.clear();
    });
    activeQueryClients = [];
    vi.restoreAllMocks();
    useBlockingModalStore.getState().reset();
    setAdminSession();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('CreateDisbursementModal & Status Anti-Forgery', () => {
    it('renders form accessible to all authenticated users with NO status input field in DOM', () => {
      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      // Verify modal is visible
      expect(screen.getByTestId('create-disbursement-modal')).toBeInTheDocument();
      expect(screen.getByTestId('create-disbursement-form')).toBeInTheDocument();

      // Check required inputs (UAT2-12: dropdowns & auto-detected client display, manual inputs removed)
      expect(screen.getByTestId('select-work-request')).toBeInTheDocument();
      expect(screen.getByTestId('display-client-name')).toBeInTheDocument();
      expect(screen.getByTestId('select-work-request-task')).toBeInTheDocument();
      expect(screen.queryByTestId('input-work-request-id')).not.toBeInTheDocument();
      expect(screen.queryByTestId('input-client-id')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-client')).not.toBeInTheDocument();
      expect(screen.getByTestId('select-category')).toBeInTheDocument();
      expect(screen.getByTestId('select-fund-source')).toBeInTheDocument();
      expect(screen.getByTestId('input-amount')).toBeInTheDocument();
      expect(screen.getByTestId('textarea-description')).toBeInTheDocument();

      // STATUS ANTI-FORGERY TEST:
      // Status input MUST NOT exist anywhere in the DOM!
      expect(screen.queryByTestId('select-status')).not.toBeInTheDocument();
      expect(screen.queryByTestId('input-status')).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/status/i)).not.toBeInTheDocument();
    });

    it('submits valid form and dispatches payload without status property', async () => {
      let dispatchedBody: Record<string, unknown> | null = null;

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          dispatchedBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: 'new-disb-id',
                status: 'Draft',
                ...dispatchedBody,
              },
            }),
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
      const onClose = vi.fn();

      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={onClose}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      // Fill in amount
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1500.50' } });
      // Fill in description
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Official court filing fee payment' },
      });

      // Submit (triggers in-app no-receipt confirmation dialog)
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('no-receipt-confirm-dialog')).toBeInTheDocument();
      });

      // Confirm creation
      fireEvent.click(screen.getByTestId('btn-confirm-no-receipt'));

      await waitFor(() => {
        expect(dispatchedBody).not.toBeNull();
      });

      const body = dispatchedBody!;
      expect(body.amount).toBe(1500.5);
      expect(body.description).toBe('Official court filing fee payment');
      expect(body.linkedWorkRequestId).toBe('11111111-1111-1111-1111-111111111111');
      // Anti-forgery assertion:
      expect(body.status).toBeUndefined();
    });

    it('validates client-side constraints (amount > 0, Work Request required)', async () => {
      const { wrapper } = createHarness();

      render(
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      // Attempt to submit with invalid amount and unselected WR
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '-50' } });
      fireEvent.submit(screen.getByTestId('create-disbursement-form'));

      await waitFor(() => {
        expect(screen.getByTestId('error-amount')).toBeInTheDocument();
        expect(screen.getByTestId('error-work-request-id')).toBeInTheDocument();
      });
    });

    it('locks prefilled fields when FinancialPrefill is provided (UAT2-7-contract-side)', async () => {
      const { wrapper } = createHarness();

      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={() => {}}
          prefill={{
            workRequestId: '11111111-1111-1111-1111-111111111111',
            clientId: 'c1111111-1111-1111-1111-111111111111',
            taskId: 't1111111-1111-1111-1111-111111111111',
          }}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('select-work-request')).toBeDisabled();
      expect(screen.getByTestId('display-client-name')).toBeDisabled();
      expect(screen.getByTestId('select-work-request-task')).toBeDisabled();
    });

    it('renders locked requester display and receipt dropzone with clean label without optional or asterisk', async () => {
      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      // Verify locked requester display (R2/D1)
      const requesterDisplay = screen.getByTestId('requester-locked-display');
      expect(requesterDisplay).toBeInTheDocument();
      expect(requesterDisplay).toHaveTextContent('Session Locked');

      // Verify receipt-dropzone
      const receiptDropzone = screen.getByTestId('receipt-dropzone');
      expect(receiptDropzone).toBeInTheDocument();

      // Verify receipt attachment label is cleanly "Receipt Attachment" without "optional" and without "*"
      const receiptLabel = screen.getByText('Receipt Attachment');
      expect(receiptLabel).toBeInTheDocument();
      expect(receiptLabel.textContent).not.toMatch(/optional/i);
      expect(receiptLabel.textContent).not.toContain('*');

      // Verify no optional indicators in dropzone container
      expect(receiptDropzone.textContent).not.toMatch(/optional/i);
      expect(receiptDropzone.textContent).not.toContain('*');
    });

    it('submits successfully with session user identity and without receipt after in-app confirmation', async () => {
      let dispatchedBody: Record<string, unknown> | null = null;

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          dispatchedBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: 'new-disb-id',
                status: 'Draft',
                ...dispatchedBody,
              },
            }),
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
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={() => {}}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      // Fill in amount & description
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1200' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Travel allowance for client visit' },
      });

      // Submit without dropping any receipt -> in-app confirmation
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('no-receipt-confirm-dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('btn-confirm-no-receipt'));

      await waitFor(() => {
        expect(dispatchedBody).not.toBeNull();
      });

      expect(dispatchedBody!.employeeId).toBe('u-admin-1');
      expect(dispatchedBody!.receiptFilename).toBeNull();
      expect(dispatchedBody!.receiptS3Key).toBeNull();
    });

    it('submits successfully with receipt attached via dropzone using pre-signed upload flow', async () => {
      let dispatchedBody: Record<string, unknown> | null = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements/receipt-uploads/') && u.includes('/complete')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                receiptS3Key: 'entities/ATA/disbursements/receipts/opaque-uuid-receipt.pdf',
                receiptFilename: 'receipt.pdf',
              },
            }),
          };
        }
        if (u.includes('/disbursements/receipt-uploads')) {
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                uploadId: 'upload-reservation-1',
                uploadUrl: 'https://storage.test/upload-binary',
                objectKey: 'entities/ATA/disbursements/receipts/opaque-uuid-receipt.pdf',
                expiresAt: '2026-10-17T16:00:00.000Z',
              },
            }),
          };
        }
        if (u.includes('upload-binary') && init?.method === 'PUT') {
          return {
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => '',
          };
        }
        if (u.includes('/disbursements') && init?.method === 'POST') {
          dispatchedBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: 'new-disb-id',
                status: 'Draft',
                ...dispatchedBody,
              },
            }),
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
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={() => {}}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      // Fill in amount & description
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '3500' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Consultancy receipt payment' },
      });

      // Drop receipt file into receipt-dropzone
      const dropzone = screen.getByTestId('receipt-dropzone');
      const testFile = new File(['dummy-receipt-content'], 'receipt.pdf', { type: 'application/pdf' });
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [testFile],
        },
      });

      // Attached file name is displayed
      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
      });

      // Submit
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(dispatchedBody).not.toBeNull();
      });

      expect(dispatchedBody!.receiptFilename).toBe('receipt.pdf');
      expect(dispatchedBody!.receiptS3Key).toBe('entities/ATA/disbursements/receipts/opaque-uuid-receipt.pdf');
    });

    it('aborts creation and displays error when receipt upload fails', async () => {
      let dispatched = false;
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements/receipt-uploads')) {
          return {
            ok: false,
            status: 500,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ title: 'Internal Server Error', detail: 'Storage failure' }),
          };
        }
        if (u.includes('/disbursements') && init?.method === 'POST') {
          dispatched = true;
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'new-disb' } }),
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
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={() => {}}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '3500' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Consultancy receipt payment' },
      });

      const dropzone = screen.getByTestId('receipt-dropzone');
      const testFile = new File(['dummy-receipt-content'], 'receipt.pdf', { type: 'application/pdf' });
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [testFile],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
      });

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-receipt')).toBeInTheDocument();
      });
      expect(dispatched).toBe(false);
    });

    it('allows removing an attached receipt before submission', async () => {
      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={() => {}}
        />,
        { wrapper }
      );

      const dropzone = screen.getByTestId('receipt-dropzone');
      const testFile = new File(['content'], 'receipt.pdf', { type: 'application/pdf' });
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [testFile],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
      });

      // Click remove button
      const removeBtn = screen.getByTestId('remove-receipt-btn');
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('receipt-attached-filename')).not.toBeInTheDocument();
        expect(screen.getByText('Drag and drop receipt here, or browse')).toBeInTheDocument();
      });
    });

    it('prompts in-app confirmation when submitting without receipt and cancels when cancelled', async () => {
      let dispatched = false;

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          dispatched = true;
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'new-disb' } }),
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
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={() => {}}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Courier expenses' },
      });

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('no-receipt-confirm-dialog')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('btn-cancel-no-receipt'));

      expect(dispatched).toBe(false);
      expect(screen.queryByTestId('no-receipt-confirm-dialog')).not.toBeInTheDocument();
    });
  });

  describe('AdminApprovalQueue', () => {
    it('displays unauthorized notice for non-Admin staff user', () => {
      // Set session to staff without Admin or Accounting role
      useSessionStore.getState().setSession({
        user: {
          id: 'u-staff-1',
          email: 'staff@ata-lta.ph',
          name: 'Staff User',
          role: 'Operations',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:create'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      expect(screen.getByTestId('admin-approval-queue-unauthorized')).toBeInTheDocument();
      expect(screen.getByText(/Access Restricted/i)).toBeInTheDocument();
    });

    it('renders pending items for Admin and executes approve workflow via AdminApprovalModal', async () => {
      setAdminSession();
      let approvedCall = false;

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/disbursements/disb-101/approve')) {
          approvedCall = true;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'disb-101', status: 'Released', version: 2 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: [mockDisbursements[0]],
            meta: { total: 1, page: 1, limit: 20 },
          }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('pending-item-disb-101')).toBeInTheDocument();
      });

      expect(screen.getByText('Messenger delivery to SEC office')).toBeInTheDocument();

      // Click Approve opens AdminApprovalModal
      const approveBtn = screen.getByTestId('approve-btn-disb-101');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });

      // Submit payment details in modal
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(approvedCall).toBe(true);
      });
    });

    it('executes reject workflow opening RejectReasonModal with 1-500 char validation', async () => {
      setAdminSession();
      let rejectedReason: string | null = null;

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/disbursements/disb-101/reject')) {
          const body = JSON.parse(init?.body as string);
          rejectedReason = body.reason;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: { id: 'disb-101', status: 'Rejected', rejection_reason: rejectedReason },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: [mockDisbursements[0]],
            meta: { total: 1, page: 1, limit: 20 },
          }),
        };
      });

      const { wrapper } = createHarness();
      render(<AdminApprovalQueue />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('reject-btn-disb-101')).toBeInTheDocument();
      });

      // Open Reject Modal
      fireEvent.click(screen.getByTestId('reject-btn-disb-101'));

      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-modal')).toBeInTheDocument();
      });

      // 1. Try empty submission -> validation error
      const submitBtn = screen.getByTestId('reject-reason-submit-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('reject-reason-error')).toBeInTheDocument();
      });

      // 2. Type valid reason and submit
      const textarea = screen.getByTestId('reject-reason-textarea');
      fireEvent.change(textarea, { target: { value: 'Ineligible expense without formal receipt' } });

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(rejectedReason).toBe('Ineligible expense without formal receipt');
      });
    });
  });

  describe('FundsReleaseActions', () => {
    it('renders fund action for Approved status and release action for Funded status', async () => {
      const { wrapper } = createHarness();

      // Approved item -> Prepare Payment button visible
      const approvedItem = mockDisbursements[1]!;
      const { unmount } = render(
        <FundsReleaseActions disbursement={approvedItem} />,
        { wrapper }
      );

      expect(screen.getByTestId('action-fund-btn')).toBeInTheDocument();
      unmount();

      // Funded item -> Sanction Release button visible
      const fundedItem = mockDisbursements[2]!;
      render(
        <FundsReleaseActions disbursement={fundedItem} />,
        { wrapper }
      );

      expect(screen.getByTestId('action-release-btn')).toBeInTheDocument();
    });

    it('hides release actions when user lacks disbursement:mark_released permission', () => {
      // Set session to staff without mark_released
      useSessionStore.getState().setSession({
        user: {
          id: 'u-ops-1',
          email: 'ops@ata-lta.ph',
          name: 'Operations Staff',
          role: 'Operations',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      const approvedItem = mockDisbursements[1]!;
      const { container } = render(
        <FundsReleaseActions disbursement={approvedItem} />,
        { wrapper }
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('DisbursementsTable & Status Badges', () => {
    it('renders table and status badges correctly', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: mockDisbursements,
          meta: { total: 3, page: 1, limit: 20 },
        }),
      });

      const { wrapper } = createHarness();
      const onSelect = vi.fn();

      render(
        <DisbursementsTable onSelectDisbursement={onSelect} />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('disbursement-row-disb-101')).toBeInTheDocument();
        expect(screen.getByTestId('disbursement-row-disb-102')).toBeInTheDocument();
        expect(screen.getByTestId('disbursement-row-disb-103')).toBeInTheDocument();
      });

      // Check clicking a row
      const row101 = screen.getByTestId('disbursement-row-disb-101');
      fireEvent.click(row101);
      expect(onSelect).toHaveBeenCalledWith('disb-101');
      expect(row101).toHaveAttribute('aria-selected', 'true');
      expect(row101).toHaveClass('bg-selected');
    });

    it('exposes valid ARIA grid semantics with grid role, row roles, and columnheader/gridcell roles', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: mockDisbursements,
          meta: { total: 3, page: 1, limit: 20 },
        }),
      });

      const { wrapper } = createHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      const grid = await screen.findByRole('grid', { name: 'Disbursement vouchers' });
      expect(grid).toBeInTheDocument();
      expect(grid).toHaveAttribute('data-testid', 'disbursements-table');

      await waitFor(() => {
        expect(screen.getByTestId('disbursement-row-disb-101')).toBeInTheDocument();
      });

      const rows = within(grid).getAllByRole('row');
      expect(rows.length).toBe(4); // 1 header row + 3 data rows

      const columnHeaders = within(grid).getAllByRole('columnheader');
      expect(columnHeaders.length).toBeGreaterThanOrEqual(9);

      const gridCells = within(grid).getAllByRole('gridcell');
      expect(gridCells.length).toBeGreaterThan(0);
    });

    it('supports roving tabindex and keyboard navigation with Arrow keys, Home, and End', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: mockDisbursements,
          meta: { total: 3, page: 1, limit: 20 },
        }),
      });

      const { wrapper } = createHarness();
      const onSelect = vi.fn();

      render(
        <DisbursementsTable onSelectDisbursement={onSelect} />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('disbursement-row-disb-101')).toBeInTheDocument();
      });

      const row101 = screen.getByTestId('disbursement-row-disb-101');
      const row102 = screen.getByTestId('disbursement-row-disb-102');
      const row103 = screen.getByTestId('disbursement-row-disb-103');

      // Initial state: first row has tabIndex=0, others -1
      expect(row101).toHaveAttribute('tabIndex', '0');
      expect(row102).toHaveAttribute('tabIndex', '-1');
      expect(row103).toHaveAttribute('tabIndex', '-1');

      row101.focus();
      expect(document.activeElement).toBe(row101);

      // ArrowDown moves focus to next row and updates roving tabindex
      fireEvent.keyDown(row101, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(row102);
      expect(row101).toHaveAttribute('tabIndex', '-1');
      expect(row102).toHaveAttribute('tabIndex', '0');

      // End moves focus to the last row
      fireEvent.keyDown(row102, { key: 'End' });
      expect(document.activeElement).toBe(row103);
      expect(row103).toHaveAttribute('tabIndex', '0');
      expect(row102).toHaveAttribute('tabIndex', '-1');

      // Home moves focus to the first row
      fireEvent.keyDown(row103, { key: 'Home' });
      expect(document.activeElement).toBe(row101);
      expect(row101).toHaveAttribute('tabIndex', '0');
      expect(row103).toHaveAttribute('tabIndex', '-1');

      // Enter selects focused row
      fireEvent.keyDown(row101, { key: 'Enter' });
      expect(onSelect).toHaveBeenCalledWith('disb-101');

      // Space selects row 102
      row102.focus();
      fireEvent.keyDown(row102, { key: ' ' });
      expect(onSelect).toHaveBeenCalledWith('disb-102');
    });

    it('does not intercept Enter or Space when bubbling from inner control buttons', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: mockDisbursements,
          meta: { total: 3, page: 1, limit: 20 },
        }),
      });

      const { wrapper } = createHarness();
      const onSelect = vi.fn();

      render(<DisbursementsTable onSelectDisbursement={onSelect} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('view-action-disb-101')).toBeInTheDocument();
      });

      const actionBtn = screen.getByTestId('view-action-disb-101');
      actionBtn.focus();

      // Trigger Enter on inner button
      const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      actionBtn.dispatchEvent(keyEvent);

      // Event should NOT be defaultPrevented by handleRowKeyDown
      expect(keyEvent.defaultPrevented).toBe(false);
    });

    it('renders deadline indicators for items with and without due dates', async () => {
      const today = new Date();
      const pastDate = new Date(today);
      pastDate.setDate(today.getDate() - 3);
      const futureDate = new Date(today);
      futureDate.setDate(today.getDate() + 5);

      const formatLocalDate = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      const itemsWithDeadlines: Disbursement[] = [
        {
          ...mockDisbursements[0]!,
          id: 'disb-nodate',
          due_date: null,
        },
        {
          ...mockDisbursements[1]!,
          id: 'disb-overdue',
          due_date: formatLocalDate(pastDate),
        },
        {
          ...mockDisbursements[2]!,
          id: 'disb-future',
          due_date: formatLocalDate(futureDate),
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: itemsWithDeadlines,
          meta: { total: 3, page: 1, limit: 20 },
        }),
      });

      const { wrapper } = createHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('deadline-indicator-disb-nodate')).toHaveTextContent('—');
        expect(screen.getByTestId('deadline-indicator-disb-overdue')).toHaveTextContent('Overdue 3d');
        expect(screen.getByTestId('deadline-indicator-disb-future')).toHaveTextContent('Due in 5d');
      });
    });

    it('renders skeleton loading rows with row height when loading', () => {
      // Create harness with unsettled query
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
      const { wrapper } = createHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      const loadingContainer = screen.getByTestId('table-loading');
      expect(loadingContainer).toBeInTheDocument();
      expect(loadingContainer).toHaveAttribute('aria-busy', 'true');
      const skeletonRows = within(loadingContainer).getAllByRole('row');
      expect(skeletonRows.length).toBe(5);
      skeletonRows.forEach((row) => {
        expect(row).toHaveClass('h-[var(--row-height-default,48px)]');
      });
    });

    it('renders tokenized error state when fetch fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error: 500'));
      const { wrapper } = createHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('table-error')).toBeInTheDocument();
        expect(screen.getByText('Failed to load disbursements')).toBeInTheDocument();
        expect(screen.getByTestId('table-retry-btn')).toBeInTheDocument();
      });
    });

    it('renders tokenized empty state when no vouchers exist', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: [],
          meta: { total: 0, page: 1, limit: 20 },
        }),
      });
      const { wrapper } = createHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('table-empty')).toBeInTheDocument();
        expect(screen.getByText('No disbursements found')).toBeInTheDocument();
      });
    });

    it('renders DisbursementStatusBadge with proper test attributes', () => {
      const { container } = render(<DisbursementStatusBadge status="Approved" />);
      const badge = container.querySelector('[data-testid="disbursement-status-badge"]');
      expect(badge).toBeInTheDocument();
      expect(badge?.getAttribute('data-test-status')).toBe('approved');
      expect(badge?.textContent).toBe('Approved');
    });

    it('subscribes to realtime CDC channel for disbursements', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const { wrapper } = createHarness();
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      expect(channelSpy).toHaveBeenCalledWith('cdc_disbursements');
    });

    it('renders all lifecycle badges with corresponding styling', () => {
      const statusExpectations = [
        { status: 'Submitted', expectedClasses: ['bg-primary-light', 'text-primary-hover', 'border-blue-300'] },
        { status: 'Pending Admin Approval', expectedClasses: ['bg-warning-surface', 'text-warning', 'border-warning-border'] },
        { status: 'Archived', expectedClasses: ['bg-sidebar', 'text-muted', 'border-border'] },
        { status: 'Released', expectedClasses: ['bg-info-surface', 'text-info', 'border-info-border'] },
        { status: 'Funded', expectedClasses: ['bg-success-surface', 'text-success', 'border-success-border'] },
        { status: 'Rejected', expectedClasses: ['bg-danger-surface', 'text-danger', 'border-danger-border'] },
      ] as const;

      statusExpectations.forEach(({ status, expectedClasses }) => {
        const { container } = render(<DisbursementStatusBadge status={status} />);
        const badge = container.querySelector('[data-testid="disbursement-status-badge"]');
        expect(badge).toBeInTheDocument();
        expect(badge?.textContent).toBe(status);
        expectedClasses.forEach((cls) => {
          expect(badge).toHaveClass(cls);
        });
      });
    });
  });

  describe('DisbursementDetailDrawer & Governance', () => {
    it('renders amber Modified by Accounting banner when edited_by_accounting is true', () => {
      const modifiedItem: Disbursement = {
        ...mockDisbursements[0]!,
        id: 'disb-mod-1',
        entity_id: 'ent-1',
        edited_by_accounting: true,
        linked_work_request_name: 'SEC Annual Filing 2026',
        created_by_name: 'Maria Santos',
        approved_by_name: 'Atty. Lorein Wong',
      };

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          id="disb-mod-1"
          initialDisbursement={modifiedItem}
        />,
        { wrapper }
      );

      const banner = screen.getByTestId('modified-by-accounting-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/Modified by Accounting/i);
      expect(screen.getAllByText('SEC Annual Filing 2026').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Maria Santos/)).toBeInTheDocument();
    });

    it('renders rejection details and suppresses submit/approve buttons for rejected voucher', () => {
      const rejectedItem: Disbursement = {
        ...mockDisbursements[0]!,
        id: 'disb-rej-1',
        entity_id: 'ent-1',
        status: 'Rejected',
        rejection_reason: 'Missing official tax invoice from vendor',
        rejected_by_name: 'Atty. Lorein Wong',
        rejected_at: '2026-10-11T10:00:00Z',
      };

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          id="disb-rej-1"
          initialDisbursement={rejectedItem}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('drawer-rejection-banner')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-rejection-reason')).toHaveTextContent(
        'Missing official tax invoice from vendor'
      );
      expect(screen.getByText(/By Atty\. Lorein Wong/)).toBeInTheDocument();
      expect(screen.queryByTestId('drawer-submit-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('drawer-approve-btn')).not.toBeInTheDocument();
    });
  });

  describe('DisbursementPrintModal Human-Readable Names', () => {
    it('renders enriched human-readable names and Work Request name in print voucher', () => {
      const printDisb: Disbursement = {
        ...mockDisbursements[0]!,
        id: 'disb-print-1',
        entity_id: 'ent-1',
        status: 'Approved',
        employee_name: 'Maria Santos',
        approved_by_name: 'Atty. Lorein Wong',
        released_by_name: 'Jen Andoga',
        linked_work_request_name: 'BIR Tax Compromise Docket #889',
      };

      const { wrapper } = createHarness();
      render(
        <DisbursementPrintModal
          isOpen={true}
          onClose={vi.fn()}
          disbursement={printDisb}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('sig-prepared-by')).toHaveTextContent(/Maria Santos/i);
      expect(screen.getByTestId('sig-approved-by')).toHaveTextContent(/Atty\. Lorein Wong/i);
      expect(screen.getByTestId('print-work-request')).toHaveTextContent(
        'BIR Tax Compromise Docket #889'
      );
    });
  });
});
