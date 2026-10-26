import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import BillingPage from '@/routes/billing';
import { InvoiceDetailModal } from '@/features/billing/components/InvoiceDetailModal';
import { InvoiceList } from '@/features/billing/components/InvoiceList';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { useSessionStore, type SessionState } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { supabase } from '@/lib/supabase';
import type { Invoice } from '@/features/billing/api/types';
import type { Disbursement } from '../api/types';

// Isolate useSessionStore per test to prevent concurrent cross-suite state leakage
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

let activeQueryClient: QueryClient | null = null;

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  activeQueryClient = queryClient;

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, { initialEntries: ['/billing'] }, children)
    );

  return { queryClient, wrapper };
}

const mockDraftInvoice: Invoice = {
  id: 'inv-draft-001',
  invoice_number: 'INV-2026-001',
  entity_id: 'ent-1',
  client_id: 'c-1',
  clients: { name: 'Acme Legal Corp' },
  issue_date: '2026-10-10',
  due_date: '2026-11-10',
  status: 'Draft',
  subtotal: 10000,
  total: 11200,
  amount_paid: 0,
  balance: 11200,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  version: 1,
};

const mockPendingInvoice: Invoice = {
  ...mockDraftInvoice,
  id: 'inv-pending-002',
  invoice_number: 'INV-2026-002',
  status: 'Pending',
};

const mockDraftDisbursement: Disbursement = {
  id: 'disb-draft-101',
  disbursement_number: 'DISB-ATA-20261011-101',
  entity_id: 'ent-1',
  category: 'Transportation',
  description: 'Courier fee to Manila City Hall',
  amount: 450,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: 'wr-101',
  version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  client_name: 'Acme Legal Corp',
};

describe('Empirical Challenger: Track 2B Adversarial Verification Harness', () => {
  const originalFetch = global.fetch;
  const safeMockFetch = vi.fn().mockImplementation(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ data: [] }),
    })
  );

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useBlockingModalStore.getState().reset();
    global.fetch = safeMockFetch;
  });

  afterEach(async () => {
    if (activeQueryClient) {
      activeQueryClient.cancelQueries();
      activeQueryClient.clear();
      activeQueryClient = null;
    }
    cleanup();
    global.fetch = safeMockFetch;
    localStorage.clear();
    await supabase.removeAllChannels();
    useBlockingModalStore.getState().reset();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Challenge 1: Button Deduplication (FB.1)
  // =========================================================================
  describe('Challenge 1: Button Deduplication (FB.1)', () => {
    it('InvoiceList NEVER renders create-invoice-button even if onCreateInvoice callback is passed', () => {
      // Setup session as Admin
      useSessionStore.getState().setSession({
        user: {
          id: 'admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Super Admin',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:create', 'billing:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      const legacyCreateHandler = vi.fn();

      render(
        <InvoiceList
          onCreateInvoice={legacyCreateHandler}
          onSelectInvoice={vi.fn()}
        />,
        { wrapper }
      );

      // Must be strictly null
      expect(screen.queryByTestId('create-invoice-button')).toBeNull();
      expect(legacyCreateHandler).not.toHaveBeenCalled();
    });

    it('InvoiceList NEVER renders create-invoice-button for Staff or Manager roles', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'staff-1',
          email: 'staff@ata-lta.ph',
          name: 'Staff Member',
          role: 'Staff',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:create'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<InvoiceList onSelectInvoice={vi.fn()} />, { wrapper });

      expect(screen.queryByTestId('create-invoice-button')).toBeNull();
    });

    it('BillingPage renders header-create-invoice-button, clicking it opens invoice-create-modal, and create-invoice-button is absent', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/invoices/counts')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { active: 1, archived: 0, overdue: 0 } }),
          });
        }
        if (u.includes('/invoices')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: [mockDraftInvoice],
              meta: { total: 1, page: 1, limit: 25 },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        });
      });

      useSessionStore.getState().setSession({
        user: {
          id: 'admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Super Admin',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:create', 'billing:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<BillingPage />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('billing-page')).toBeInTheDocument();
      });

      // Verify header button is present
      const headerBtn = screen.getByTestId('header-create-invoice-button');
      expect(headerBtn).toBeInTheDocument();

      // Verify list button is absent
      expect(screen.queryByTestId('create-invoice-button')).toBeNull();

      // Click header button to open modal
      fireEvent.click(headerBtn);

      await waitFor(() => {
        expect(screen.getByTestId('invoice-create-modal')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Challenge 2: Admin Direct Approval for Invoices (FB.2)
  // =========================================================================
  describe('Challenge 2: Admin Direct Approval for Invoices (FB.2)', () => {
    it('Admin on Draft invoice sees btn-approve-and-issue (transitions to Sent) and NEVER btn-submit-for-approval', async () => {
      let patchedStatus: string | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'PATCH' && u.includes('/invoices/inv-draft-001')) {
          const body = JSON.parse(init.body as string);
          patchedStatus = body.status;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { ...mockDraftInvoice, status: patchedStatus } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDraftInvoice }),
        });
      });

      useSessionStore.getState().setSession({
        user: {
          id: 'admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin User',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-draft-001"
          initialInvoice={mockDraftInvoice}
        />,
        { wrapper }
      );

      // Verify buttons
      expect(screen.queryByTestId('btn-submit-for-approval')).toBeNull();
      const approveBtn = screen.getByTestId('btn-approve-and-issue');
      expect(approveBtn).toBeInTheDocument();
      expect(approveBtn).toHaveTextContent('Approve & Issue');

      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(patchedStatus).toBe('Sent');
      });
    });

    it('does not grant invoice administrator rights from an email address alone', async () => {
      let patchedStatus: string | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'PATCH' && u.includes('/invoices/inv-draft-001')) {
          const body = JSON.parse(init.body as string);
          patchedStatus = body.status;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { ...mockDraftInvoice, status: patchedStatus } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDraftInvoice }),
        });
      });

      // The server requires the Admin role; an email address alone does not grant approval.
      useSessionStore.getState().setSession({
        user: {
          id: 'admin-lorein',
          email: 'lorein@ata-lta.ph',
          name: 'Lorein Partner',
          role: 'Staff',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-draft-001"
          initialInvoice={mockDraftInvoice}
        />,
        { wrapper }
      );

      expect(screen.queryByTestId('btn-approve-and-issue')).toBeNull();
      const approveBtn = screen.getByTestId('btn-submit-for-approval');
      expect(approveBtn).toBeInTheDocument();

      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(patchedStatus).toBe('Pending');
      });
    });

    it('Non-admin on Draft invoice sees btn-submit-for-approval (transitions to Pending) and NEVER btn-approve-and-issue', async () => {
      let patchedStatus: string | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'PATCH' && u.includes('/invoices/inv-draft-001')) {
          const body = JSON.parse(init.body as string);
          patchedStatus = body.status;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { ...mockDraftInvoice, status: patchedStatus } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDraftInvoice }),
        });
      });

      useSessionStore.getState().setSession({
        user: {
          id: 'staff-1',
          email: 'billing-staff@ata-lta.ph',
          name: 'Billing Staff',
          role: 'Staff',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit', 'billing:request'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-draft-001"
          initialInvoice={mockDraftInvoice}
        />,
        { wrapper }
      );

      expect(screen.queryByTestId('btn-approve-and-issue')).toBeNull();
      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      expect(submitBtn).toBeInTheDocument();

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(patchedStatus).toBe('Pending');
      });
    });

    it('Pending invoice shows btn-approve-and-issue AND btn-reject-to-draft (transitions to Draft)', async () => {
      let patchedStatus: string | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'PATCH' && u.includes('/invoices/inv-pending-002')) {
          const body = JSON.parse(init.body as string);
          patchedStatus = body.status;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { ...mockPendingInvoice, status: patchedStatus } }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockPendingInvoice }),
        });
      });

      useSessionStore.getState().setSession({
        user: {
          id: 'admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin User',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-pending-002"
          initialInvoice={mockPendingInvoice}
        />,
        { wrapper }
      );

      const approveBtn = screen.getByTestId('btn-approve-and-issue');
      const rejectBtn = screen.getByTestId('btn-reject-to-draft');

      expect(approveBtn).toBeInTheDocument();
      expect(rejectBtn).toBeInTheDocument();

      // Click reject to draft
      fireEvent.click(rejectBtn);

      await waitFor(() => {
        expect(patchedStatus).toBe('Draft');
      });
    });
  });

  // =========================================================================
  // Challenge 3: Admin Direct Approval for Disbursements (FB.3)
  // =========================================================================
  describe('Challenge 3: Admin Direct Approval for Disbursements (FB.3)', () => {
    it('Admin on Draft voucher gets drawer-direct-approve-btn (transitions to Approved) and NEVER drawer-submit-btn', async () => {
      let approvedCalled = false;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'POST' && u.includes('/disbursements/disb-draft-101/approve')) {
          approvedCalled = true;
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { ...mockDraftDisbursement, status: 'Approved' } }),
          });
        }
        if (u.includes('/disbursements/disb-draft-101')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDraftDisbursement }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: {} }),
        });
      });

      useSessionStore.getState().setSession({
        user: {
          id: 'admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin User',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:approve'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          id="disb-draft-101"
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('disbursement-detail-drawer')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('drawer-submit-btn')).toBeNull();
      const directApproveBtn = screen.getByTestId('drawer-direct-approve-btn');
      expect(directApproveBtn).toHaveTextContent('Direct Approve');

      fireEvent.click(directApproveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(approvedCalled).toBe(true);
      });
    });

    it('Non-admin on Draft voucher NEVER gets drawer-direct-approve-btn nor dead submit button', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-draft-101')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDraftDisbursement }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: {} }),
        });
      });

      useSessionStore.getState().setSession({
        user: {
          id: 'staff-1',
          email: 'staff@ata-lta.ph',
          name: 'Staff User',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view', 'disbursement:create'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          id="disb-draft-101"
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('disbursement-detail-drawer')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('drawer-direct-approve-btn')).toBeNull();
      expect(screen.queryByTestId('drawer-submit-btn')).toBeNull();
    });
  });

  // =========================================================================
  // Challenge 4: Disbursement Voucher Usability & Dropzone (FB.4)
  // =========================================================================
  describe('Challenge 4: Disbursement Voucher Usability & Dropzone (FB.4)', () => {
    const mockTeam = [
      { id: '11111111-1111-1111-1111-111111111111', name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Staff' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Juan Dela Cruz', email: 'juan@ata-lta.ph', role: 'Manager' },
    ];

    it('select-employee populates accurately from useTeam() and binds UUID', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/me/team')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockTeam }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        });
      });

      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          defaultWorkRequestId="wr-101"
        />,
        { wrapper }
      );

      const employeeSelect = screen.getByTestId('select-employee') as HTMLSelectElement;
      expect(employeeSelect).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Maria Santos')).toBeInTheDocument();
        expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
      });

      fireEvent.change(employeeSelect, {
        target: { value: '22222222-2222-2222-2222-222222222222' },
      });

      expect(employeeSelect.value).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('strictly satisfies UI Constraint: clean label "Receipt Attachment" with ZERO occurrences of "OPTIONAL", "(Optional)", or "*"', () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      });

      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const dropzone = screen.getByTestId('receipt-dropzone');
      expect(dropzone).toBeInTheDocument();

      // Find the label for receipt
      const receiptLabel = screen.getByText('Receipt Attachment');
      expect(receiptLabel).toBeInTheDocument();

      // Assert label text has zero "optional" and zero "*"
      expect(receiptLabel.textContent).toBe('Receipt Attachment');
      expect(receiptLabel.textContent).not.toMatch(/optional/i);
      expect(receiptLabel.textContent).not.toContain('*');

      // Assert entire dropzone container text has zero "optional" and zero "*"
      expect(dropzone.parentElement?.textContent).not.toMatch(/optional/i);
      expect(dropzone.parentElement?.textContent).not.toContain('*');
    });

    it('handles file input via native file input and dropzone drag-and-drop, plus remove button reset', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      });

      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const fileInput = screen.getByTestId('receipt-file-input');
      const testFile = new File(['sample receipt data'], 'official_receipt_2026.pdf', {
        type: 'application/pdf',
      });

      // 1. Test native file input change
      fireEvent.change(fileInput, {
        target: { files: [testFile] },
      });

      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent(
          'official_receipt_2026.pdf'
        );
      });

      // 2. Test remove button
      const removeBtn = screen.getByTestId('remove-receipt-btn');
      fireEvent.click(removeBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('receipt-attached-filename')).toBeNull();
        expect(screen.getByText('Drag and drop receipt here, or browse')).toBeInTheDocument();
      });

      // 3. Test drag and drop
      const dropzone = screen.getByTestId('receipt-dropzone');
      const droppedFile = new File(['dropped data'], 'invoice_receipt.jpg', {
        type: 'image/jpeg',
      });

      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [droppedFile],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent(
          'invoice_receipt.jpg'
        );
      });
    });

    it('form submission succeeds smoothly with receipt attached', async () => {
      let createdPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (_url.endsWith('/receipt-uploads')) return Promise.resolve({ ok: true, status: 201, json: async () => ({ data: { uploadId: 'receipt-1', uploadUrl: 'https://storage.test/put', objectKey: 'entities/ATA/receipts/court.pdf', expiresAt: '2026-10-20T12:00:00Z' } }) });
        if (_url === 'https://storage.test/put') return Promise.resolve({ ok: true, status: 200 });
        if (_url.endsWith('/receipt-uploads/receipt-1/complete')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { receiptS3Key: 'entities/ATA/receipts/court.pdf', receiptFilename: 'court_receipt.pdf' } }) });
        if (init?.method === 'POST') {
          createdPayload = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: 'new-disb-with-file',
                status: 'Draft',
                ...createdPayload,
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        });
      });

      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '2500' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Legal filing fee' },
      });

      const dropzone = screen.getByTestId('receipt-dropzone');
      const file = new File(['content'], 'court_receipt.pdf', { type: 'application/pdf' });
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [file],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('court_receipt.pdf');
      });

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(createdPayload).not.toBeNull();
      });

      expect(createdPayload!.receiptFilename).toBe('court_receipt.pdf');
    });

    it('form submission succeeds smoothly without receipt file (receiptFilename is null)', async () => {
      let createdPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          createdPayload = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: 'new-disb-without-file',
                status: 'Draft',
                ...createdPayload,
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        });
      });

      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '800' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Transportation cash allowance' },
      });

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      const confirmBtn = screen.queryByTestId('btn-confirm-no-receipt');
      if (confirmBtn) fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(createdPayload).not.toBeNull();
      });

      expect(createdPayload!.receiptFilename).toBeNull();
    });
  });
});
