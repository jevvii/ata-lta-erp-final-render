import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    status: 'Pending',
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
    status: 'Released',
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

      // Submit
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

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

    it('renders Employee select dropdown and receipt dropzone with clean label without optional or asterisk', async () => {
      const mockTeamMembers = [
        { id: '11111111-2222-3333-4444-555555555555', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Staff' },
        { id: '22222222-3333-4444-5555-666666666666', name: 'Juan Dela Cruz', email: 'juan@ata-lta.ph', role: 'Manager' },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/me/team')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockTeamMembers }),
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
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      // Verify select-employee dropdown
      const employeeSelect = screen.getByTestId('select-employee') as HTMLSelectElement;
      expect(employeeSelect).toBeInTheDocument();

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

      // Verify options in employee select
      await waitFor(() => {
        expect(screen.getByText('Maria Santos')).toBeInTheDocument();
        expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
      });
    });

    it('submits successfully with employee selected and without receipt (receiptFilename is null)', async () => {
      let dispatchedBody: Record<string, unknown> | null = null;
      const mockTeamMembers = [
        { id: '11111111-2222-3333-4444-555555555555', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Staff' },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
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
        if (u.includes('/me/team')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockTeamMembers }),
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

      await waitFor(() => {
        expect(screen.getByText('Maria Santos')).toBeInTheDocument();
      });

      // Select employee
      fireEvent.change(screen.getByTestId('select-employee'), {
        target: { value: '11111111-2222-3333-4444-555555555555' },
      });

      // Fill in amount & description
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1200' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Travel allowance for client visit' },
      });

      // Submit without dropping any receipt
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(dispatchedBody).not.toBeNull();
      });

      expect(dispatchedBody!.employeeId).toBe('11111111-2222-3333-4444-555555555555');
      expect(dispatchedBody!.receiptFilename).toBeNull();
    });

    it('submits successfully with receipt attached via dropzone (receiptFilename is receipt.pdf)', async () => {
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

    it('prompts soft-warning when submitting without receipt and cancels when rejected', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
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

      expect(confirmSpy).toHaveBeenCalledWith(
        'No Government Assessment Document attached. Proceed anyway?'
      );
      expect(dispatched).toBe(false);
      confirmSpy.mockRestore();
    });
  });

  describe('AdminApprovalQueue', () => {
    it('displays My Submitted Approvals view for non-Admin user', () => {
      // Set session to staff without disbursement:approve
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

      expect(screen.getByText(/My Submitted Approvals/i)).toBeInTheDocument();
      expect(screen.queryByTestId('admin-approval-queue-unauthorized')).not.toBeInTheDocument();
    });

    it('renders pending items for Admin and executes approve workflow', async () => {
      setAdminSession();
      let approvedCall = false;

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/disbursements/disb-101/approve')) {
          approvedCall = true;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'disb-101', status: 'Approved' } }),
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

      // Click Approve
      const approveBtn = screen.getByTestId('approve-btn-disb-101');
      fireEvent.click(approveBtn);

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
    it('renders release action for Approved status and fund action for Released status (gated by disbursement:mark_released)', async () => {
      const { wrapper } = createHarness();

      // Approved item -> Release button visible
      const approvedItem = mockDisbursements[1]!;
      const { unmount } = render(
        <FundsReleaseActions disbursement={approvedItem} />,
        { wrapper }
      );

      expect(screen.getByTestId('release-btn-disb-102')).toBeInTheDocument();
      unmount();

      // Released item -> Mark Funded button visible
      const releasedItem = mockDisbursements[2]!;
      render(
        <FundsReleaseActions disbursement={releasedItem} />,
        { wrapper }
      );

      expect(screen.getByTestId('fund-btn-disb-103')).toBeInTheDocument();
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
      fireEvent.click(screen.getByTestId('disbursement-row-disb-101'));
      expect(onSelect).toHaveBeenCalledWith('disb-101');
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
      const statuses = ['Submitted', 'Pending Admin Approval', 'Archived', 'Released', 'Funded', 'Rejected'] as const;
      statuses.forEach((st) => {
        const { container } = render(<DisbursementStatusBadge status={st} />);
        const badge = container.querySelector('[data-testid="disbursement-status-badge"]');
        expect(badge).toBeInTheDocument();
        expect(badge?.textContent).toBe(st);
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
      expect(screen.getByText('SEC Annual Filing 2026')).toBeInTheDocument();
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

      render(
        <DisbursementPrintModal
          isOpen={true}
          onClose={vi.fn()}
          disbursement={printDisb}
        />
      );

      expect(screen.getByTestId('sig-prepared-by')).toHaveTextContent(/Maria Santos/i);
      expect(screen.getByTestId('sig-approved-by')).toHaveTextContent(/Atty\. Lorein Wong/i);
      expect(screen.getByTestId('print-work-request')).toHaveTextContent(
        'BIR Tax Compromise Docket #889'
      );
    });
  });
});
