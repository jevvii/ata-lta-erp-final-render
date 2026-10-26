import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  DisbursementCodingGrid,
  DisbursementCodingDefinitionList,
  CODING_COLLAPSED_STORAGE_KEY,
} from '../components/workspace/DisbursementCodingGrid';
import { useSessionStore } from '@/lib/session';
import { toast } from '@/components/ui/toast';
import type { Disbursement } from '../api/types';

vi.mock('@/components/ui/toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

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

const mockDraftVoucher: Disbursement = {
  id: 'disb-draft-1',
  disbursement_number: 'DISB-ATA-20261025-001',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Transportation',
  description: 'Client filing trip taxi receipt',
  amount: 1500,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: 'wr-11111111-1111-1111-1111-111111111111',
  linked_work_request_order_number: 'WR-2026-0042',
  linked_work_request_name: 'SEC Company Compliance 2026',
  linked_task_id: 'task-55',
  linked_invoice_id: 'inv-88',
  linked_transmittal_id: 'trans-99',
  clients: {
    id: 'client-1',
    name: 'Alpha Holdings Inc.',
  },
  employee_id: 'emp-1',
  employee_name: 'Maria Santos',
  version: 2,
  created_at: '2026-10-25T08:00:00Z',
  updated_at: '2026-10-25T08:00:00Z',
};

const mockApprovedVoucher: Disbursement = {
  ...mockDraftVoucher,
  id: 'disb-appr-1',
  status: 'Approved',
  version: 3,
};

const mockFundedVoucher: Disbursement = {
  ...mockDraftVoucher,
  id: 'disb-fund-1',
  status: 'Funded',
  version: 4,
  payment_method: 'Check',
  payment_reference: 'CHK-123456',
};

describe('DisbursementCodingGrid Component (design/disb-06)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    // Default session: Admin
    useSessionStore.getState().setSession({
      user: {
        id: 'usr-admin-1',
        email: 'admin@ata.ph',
        role: 'Admin',
        name: 'Admin Partner',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: new Set(['disbursement:view', 'disbursement:create', 'disbursement:approve']),
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method || 'GET';

      if (u.includes('/disbursements/disb-draft-1') && method === 'PUT') {
        const body = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              ...mockDraftVoucher,
              ...body,
              version: (mockDraftVoucher.version ?? 1) + 1,
            },
          }),
        });
      }

      if (u.includes('/disbursements/disb-draft-1') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDraftVoucher }),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: {} }),
      });
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  // --------------------------------------------------------------------------
  // 1. Summary Strip
  // --------------------------------------------------------------------------
  describe('1. Summary Strip', () => {
    it('renders Amount, Fund source, Status, and Payment ("—" until funded) for Draft', () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      expect(screen.getByTestId('coding-summary-strip')).toBeInTheDocument();
      expect(screen.getByTestId('coding-summary-amount')).toHaveTextContent('₱1,500.00');
      expect(screen.getByTestId('coding-summary-fund-source')).toHaveTextContent('Firm Fund');
      expect(screen.getByTestId('coding-summary-status')).toHaveTextContent('Draft');
      expect(screen.getByTestId('coding-summary-payment')).toHaveTextContent('—');
    });

    it('renders Payment method and reference when funded', () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockFundedVoucher} />, { wrapper });

      expect(screen.getByTestId('coding-summary-payment')).toHaveTextContent('Check / CHK-123456');
    });

    it('renders placeholder state when no disbursement is selected', () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={null} />, { wrapper });

      expect(screen.getByTestId('coding-summary-amount')).toHaveTextContent('—');
      expect(screen.getByTestId('coding-summary-fund-source')).toHaveTextContent('—');
      expect(screen.getByTestId('coding-summary-status')).toHaveTextContent('—');
      expect(screen.getByTestId('coding-summary-payment')).toHaveTextContent('—');
      expect(screen.getByTestId('coding-grid-empty')).toHaveTextContent(
        'Select a voucher to view accounting coding'
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. Coding Grid Columns Order & Absence of Disallowed Columns
  // --------------------------------------------------------------------------
  describe('2. Coding Grid Columns Order & Architecture', () => {
    it('renders exactly the 9 approved columns in order and excludes disallowed columns', () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const headers = screen.getAllByRole('columnheader').map((th) => th.textContent?.trim());
      expect(headers).toEqual([
        'Entity',
        'Category',
        'Work Request',
        'Task',
        'Fund Source',
        'Client',
        'Employee',
        'Invoice / Transmittal',
        'Amount (PHP)',
      ]);

      // Verify NO Withholding/VAT/Net/Department/Vessel/Voyage columns
      expect(screen.queryByText(/withholding/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/vat/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/net/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/department/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/vessel/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/voyage/i)).not.toBeInTheDocument();

      // Verify cell data content
      expect(screen.getByTestId('coding-grid-entity')).toHaveTextContent('ATA');
      expect(screen.getByTestId('coding-grid-category')).toHaveTextContent('Transportation');
      expect(screen.getByTestId('coding-grid-work-request')).toHaveTextContent(
        'WR-2026-0042 — SEC Company Compliance 2026'
      );
      expect(screen.getByTestId('coding-grid-task')).toHaveTextContent('task-55');
      expect(screen.getByTestId('coding-grid-fund-source')).toHaveTextContent('Firm Fund');
      expect(screen.getByTestId('coding-grid-client')).toHaveTextContent('Alpha Holdings Inc.');
      expect(screen.getByTestId('coding-grid-employee')).toHaveTextContent('Maria Santos');
      expect(screen.getByTestId('coding-grid-invoice-transmittal')).toHaveTextContent('inv-88 / trans-99');
      expect(screen.getByTestId('coding-grid-amount')).toHaveTextContent('₱1,500.00');
    });

    it('resolves work request title when linked_work_request_name is a raw UUID and applies pr-16 for floating timer clearance', async () => {
      const rawUuidVoucher = {
        ...mockDraftVoucher,
        linked_work_request_id: '39ae64ae-17e5-47e5-b31d-6ed488ba65cb',
        linked_work_request_name: '39ae64ae-17e5-47e5-b31d-6ed488ba65cb', // raw UUID
        linked_work_request_order_number: 'WO-2026-0099',
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (String(url).includes('/operations/work-requests/39ae64ae-17e5-47e5-b31d-6ed488ba65cb')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: '39ae64ae-17e5-47e5-b31d-6ed488ba65cb',
                title: 'BIR Annual Return 2026',
                work_order_number: 'WO-2026-0099',
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: {} }),
        });
      });

      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={rawUuidVoucher} />, { wrapper });

      // Verifies pr-16 clearance for floating time studio button
      expect(screen.getByTestId('coding-summary-strip').parentElement).toHaveClass('pr-16');
      expect(screen.getByTestId('disbursement-coding-content')).toHaveClass('pr-16');

      // Verifies resolution to human-readable work request name and never displays the raw UUID
      expect(await screen.findByText(/BIR Annual Return 2026/)).toBeInTheDocument();
      expect(screen.queryByText('39ae64ae-17e5-47e5-b31d-6ed488ba65cb')).not.toBeInTheDocument();
    });

    it('toggles collapsible bottom pane with aria-expanded and localStorage persistence', () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const toggleBtn = screen.getByTestId('disb-toggle-coding');
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('disbursement-coding-table')).toBeInTheDocument();

      // Click to collapse
      fireEvent.click(toggleBtn);
      expect(localStorage.getItem(CODING_COLLAPSED_STORAGE_KEY)).toBe('true');
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('disbursement-coding-table')).not.toBeInTheDocument();

      // Click to expand again
      fireEvent.click(toggleBtn);
      expect(localStorage.getItem(CODING_COLLAPSED_STORAGE_KEY)).toBe('false');
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('disbursement-coding-table')).toBeInTheDocument();
    });

    it('restores collapsed state from localStorage on mount', () => {
      localStorage.setItem(CODING_COLLAPSED_STORAGE_KEY, 'true');
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const toggleBtn = screen.getByTestId('disb-toggle-coding');
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('disbursement-coding-table')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 3. RBAC: Read-Only for Accounting & Staff
  // --------------------------------------------------------------------------
  describe('3. RBAC: Non-Admin Permissions', () => {
    it('is fully read-only for Accounting role on v2 Draft', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'usr-acct-1',
          email: 'acct@ata.ph',
          role: 'Accounting',
          name: 'Accounting Staff',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: new Set(['disbursement:view']),
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      // Cells must not be clickable buttons
      const categoryCell = screen.getByTestId('coding-grid-category');
      expect(categoryCell).not.toHaveAttribute('role', 'button');
      fireEvent.click(categoryCell);
      expect(screen.queryByTestId('input-edit-category')).not.toBeInTheDocument();

      const amountCell = screen.getByTestId('coding-grid-amount');
      expect(amountCell).not.toHaveAttribute('role', 'button');
      fireEvent.click(amountCell);
      expect(screen.queryByTestId('input-edit-amount')).not.toBeInTheDocument();

      const fundSourceCell = screen.getByTestId('coding-grid-fund-source');
      expect(fundSourceCell).not.toHaveAttribute('role', 'button');
      fireEvent.click(fundSourceCell);
      expect(screen.queryByTestId('select-edit-fund-source')).not.toBeInTheDocument();
    });

    it('is fully read-only for Staff role on v2 Draft', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'usr-staff-1',
          email: 'staff@ata.ph',
          role: 'Staff',
          name: 'Regular Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: new Set(['disbursement:view']),
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const categoryCell = screen.getByTestId('coding-grid-category');
      expect(categoryCell).not.toHaveAttribute('role', 'button');
      fireEvent.click(categoryCell);
      expect(screen.queryByTestId('input-edit-category')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 4. RBAC: Admin on Approved / Non-Draft stages (No Financial Edits)
  // --------------------------------------------------------------------------
  describe('4. RBAC: Admin on Non-Draft Stages', () => {
    it('is not editable for Admin when voucher is in Approved status', () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockApprovedVoucher} />, { wrapper });

      const categoryCell = screen.getByTestId('coding-grid-category');
      expect(categoryCell).not.toHaveAttribute('role', 'button');
      fireEvent.click(categoryCell);
      expect(screen.queryByTestId('input-edit-category')).not.toBeInTheDocument();

      const amountCell = screen.getByTestId('coding-grid-amount');
      expect(amountCell).not.toHaveAttribute('role', 'button');
      fireEvent.click(amountCell);
      expect(screen.queryByTestId('input-edit-amount')).not.toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 5. Admin Editing on v2 Draft
  // --------------------------------------------------------------------------
  describe('5. Admin Editing on v2 Draft', () => {
    it('allows Admin to click or press Enter on Category to edit and save', async () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const categoryCell = screen.getByTestId('coding-grid-category');
      expect(categoryCell).toHaveAttribute('role', 'button');

      // Click to edit
      fireEvent.click(categoryCell);
      const input = screen.getByTestId('input-edit-category');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('Transportation');

      // Change category and save on Enter
      fireEvent.change(input, { target: { value: 'Courier & Freight' } });
      fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/disbursements/disb-draft-1'),
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('"category":"Courier & Freight"'),
          })
        );
      });

      expect(toast.success).toHaveBeenCalledWith('Disbursement updated successfully');
    });

    it('allows Admin to edit Amount and saves on blur', async () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const amountCell = screen.getByTestId('coding-grid-amount');
      fireEvent.click(amountCell);

      const input = screen.getByTestId('input-edit-amount');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue(1500);

      fireEvent.change(input, { target: { value: '2750.50' } });
      fireEvent.blur(input);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/disbursements/disb-draft-1'),
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('"amount":2750.5'),
          })
        );
      });
    });

    it('allows Admin to edit Fund source', async () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const fundSourceCell = screen.getByTestId('coding-grid-fund-source');
      fireEvent.click(fundSourceCell);

      const select = screen.getByTestId('select-edit-fund-source');
      expect(select).toBeInTheDocument();
      expect(select).toHaveValue('Firm Fund');

      fireEvent.change(select, { target: { value: 'Client Fund' } });
      fireEvent.blur(select);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/disbursements/disb-draft-1'),
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('"fundSource":"Client Fund"'),
          })
        );
      });
    });

    it('validates amount greater than zero and shows inline error under cell', async () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const amountCell = screen.getByTestId('coding-grid-amount');
      fireEvent.click(amountCell);

      const input = screen.getByTestId('input-edit-amount');
      fireEvent.change(input, { target: { value: '0' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByTestId('cell-error')).toHaveTextContent(
          'Enter an amount greater than zero.'
        );
      });
    });

    it('cancels edit and reverts value when Escape key is pressed', () => {
      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const categoryCell = screen.getByTestId('coding-grid-category');
      fireEvent.click(categoryCell);

      const input = screen.getByTestId('input-edit-category');
      fireEvent.change(input, { target: { value: 'Disallowed Name' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(screen.queryByTestId('input-edit-category')).not.toBeInTheDocument();
      expect(screen.getByTestId('coding-grid-category')).toHaveTextContent('Transportation');
    });
  });

  // --------------------------------------------------------------------------
  // 6. OCC Concurrency Conflict Path
  // --------------------------------------------------------------------------
  describe('6. OCC Concurrency Conflict Interception', () => {
    it('surfaces the exact existing conflict message when server responds with HTTP 409', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-draft-1') && method === 'PUT') {
          return Promise.resolve({
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Record was modified by another reviewer.',
            }),
          });
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDraftVoucher }),
        });
      });

      const { wrapper } = createHarness();
      render(<DisbursementCodingGrid disbursement={mockDraftVoucher} />, { wrapper });

      const categoryCell = screen.getByTestId('coding-grid-category');
      fireEvent.click(categoryCell);

      const input = screen.getByTestId('input-edit-category');
      fireEvent.change(input, { target: { value: 'Courier Fee' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() => {
        expect(screen.getByTestId('cell-error')).toHaveTextContent(
          'This voucher changed elsewhere. Your edits are preserved. Load the latest values before editing again.'
        );
      });

      expect(screen.getByTestId('cell-load-latest')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 7. Mobile Definition List (<1024px)
  // --------------------------------------------------------------------------
  describe('7. Mobile Definition List (<1024px)', () => {
    it('renders a definition list with all 9 fields for mobile sheet view', () => {
      render(<DisbursementCodingDefinitionList disbursement={mockDraftVoucher} />);

      const dl = screen.getByTestId('disbursement-coding-definition-list');
      expect(dl).toBeInTheDocument();
      expect(dl.tagName.toLowerCase()).toBe('dl');

      expect(screen.getByTestId('dl-coding-entity')).toHaveTextContent('ATA');
      expect(screen.getByTestId('dl-coding-category')).toHaveTextContent('Transportation');
      expect(screen.getByTestId('dl-coding-work-request')).toHaveTextContent(
        'WR-2026-0042 — SEC Company Compliance 2026'
      );
      expect(screen.getByTestId('dl-coding-task')).toHaveTextContent('task-55');
      expect(screen.getByTestId('dl-coding-fund-source')).toHaveTextContent('Firm Fund');
      expect(screen.getByTestId('dl-coding-client')).toHaveTextContent('Alpha Holdings Inc.');
      expect(screen.getByTestId('dl-coding-employee')).toHaveTextContent('Maria Santos');
      expect(screen.getByTestId('dl-coding-invoice-transmittal')).toHaveTextContent('inv-88 / trans-99');
      expect(screen.getByTestId('dl-coding-amount')).toHaveTextContent('₱1,500.00');
    });
  });
});
