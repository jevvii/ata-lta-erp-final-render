import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import { DisbursementDetailBody } from '../components/DisbursementDetailBody';
import { useSessionStore } from '@/lib/session';
import type { Disbursement } from '../api/types';

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

const mockDisbWithoutReceipt: Disbursement = {
  id: 'disb-no-rcpt',
  disbursement_number: 'DISB-ATA-20261025-001',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Transportation',
  description: 'Site inspection taxi fare',
  amount: 850,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: 'wr-1001',
  linked_work_request_name: 'SEC Company Compliance 2026',
  linked_work_request_order_number: 'WR-2026-0042',
  linked_task_id: 'task-55',
  linked_invoice_id: 'inv-88',
  linked_transmittal_id: 'trans-99',
  client_name: 'Alpha Holdings Inc.',
  employee_name: 'Juan Dela Cruz',
  created_by_name: 'Maria Santos',
  due_date: '2026-11-01',
  notes: 'Urgent reimbursement request for transport',
  version: 1,
  created_at: '2026-10-25T08:00:00Z',
  updated_at: '2026-10-25T08:00:00Z',
};

const mockDisbWithImageReceipt: Disbursement = {
  ...mockDisbWithoutReceipt,
  id: 'disb-img-rcpt',
  receipt_filename: 'taxi_receipt.png',
  receipt_s3_key: 'entities/ATA/receipts/taxi_receipt.png',
  status: 'Approved',
  approved_by_name: 'Atty. Lorein Wong',
  approved_at: '2026-10-25T10:00:00Z',
};

const mockDisbWithPdfReceipt: Disbursement = {
  ...mockDisbWithoutReceipt,
  id: 'disb-pdf-rcpt',
  receipt_filename: 'official_invoice.pdf',
  receipt_s3_key: 'entities/ATA/receipts/official_invoice.pdf',
  status: 'Released',
  payment_method: 'Bank Transfer',
  payment_bank: 'BDO Unibank',
  payment_reference: 'REF-TXN-998811',
  payment_date: '2026-10-25',
  payment_processed_by_name: 'Jen Andoga',
  funded_by_name: 'Accounting Dept',
  funded_at: '2026-10-25T11:00:00Z',
  released_by_name: 'Admin Partner',
  released_at: '2026-10-25T12:00:00Z',
  lifecycle_history: [
    {
      action: 'Created',
      actor_name: 'Maria Santos',
      new_status: 'Draft',
      created_at: '2026-10-25T08:00:00Z',
    },
    {
      action: 'Approved',
      actor_name: 'Atty. Lorein Wong',
      old_status: 'Draft',
      new_status: 'Approved',
      created_at: '2026-10-25T10:00:00Z',
    },
    {
      action: 'Released',
      actor_name: 'Admin Partner',
      old_status: 'Funded',
      new_status: 'Released',
      created_at: '2026-10-25T12:00:00Z',
    },
  ],
};

const mockDisbRejected: Disbursement = {
  ...mockDisbWithoutReceipt,
  id: 'disb-rejected',
  status: 'Rejected',
  rejection_reason: 'Missing official BIR registered vendor receipt',
  rejected_by_name: 'Admin Reviewer',
  rejected_at: '2026-10-25T09:30:00Z',
};

describe('Branch 04: Detail Pane Tabs & Receipt Attachment Viewer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();

    useSessionStore.getState().setSession({
      user: {
        id: 'usr-admin',
        email: 'admin@ata.ph',
        role: 'Admin',
        name: 'Admin User',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: new Set(['disbursement:view', 'disbursement:create', 'disbursement:approve']),
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('disb-img-rcpt/receipt-url')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              url: 'https://storage.test/receipts/taxi_receipt.png',
              contentType: 'image/png',
              status: 'available',
            },
          }),
        };
      }
      if (u.includes('disb-pdf-rcpt/receipt-url')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              url: 'https://storage.test/receipts/official_invoice.pdf',
              contentType: 'application/pdf',
              status: 'available',
            },
          }),
        };
      }
      if (u.includes('/disbursements/disb-no-rcpt')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDisbWithoutReceipt }),
        };
      }
      if (u.includes('/disbursements/disb-img-rcpt')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDisbWithImageReceipt }),
        };
      }
      if (u.includes('/disbursements/disb-pdf-rcpt')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDisbWithPdfReceipt }),
        };
      }
      if (u.includes('/disbursements/disb-rejected')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockDisbRejected }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: null }),
      };
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  // --------------------------------------------------------------------------
  // 1. Unified Tab Strip Contract (TOKENS.md §4.3)
  // --------------------------------------------------------------------------
  describe('Unified Tab Strip Contract', () => {
    it('renders all 5 tabs: Attachment (with count badge), Information, Approval, Payment, Log', () => {
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithImageReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('tab-attachment')).toBeInTheDocument();
      expect(screen.getByTestId('tab-information')).toBeInTheDocument();
      expect(screen.getByTestId('tab-approval')).toBeInTheDocument();
      expect(screen.getByTestId('tab-payment')).toBeInTheDocument();
      expect(screen.getByTestId('tab-log')).toBeInTheDocument();
    });

    it('shows Attachment count badge 1 when receipt exists, and defaults to Attachment tab', async () => {
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithImageReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const attachmentTab = screen.getByTestId('tab-attachment');
      expect(attachmentTab).toHaveTextContent('1');
      expect(attachmentTab).toHaveAttribute('data-state', 'active');

      await waitFor(() => {
        expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument();
      });
    });

    it('shows Attachment count badge 0 and defaults to Information tab when no receipt exists', () => {
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithoutReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const attachmentTab = screen.getByTestId('tab-attachment');
      expect(attachmentTab).toHaveTextContent('0');

      const infoTab = screen.getByTestId('tab-information');
      expect(infoTab).toHaveAttribute('data-state', 'active');
      expect(screen.getByText('Alpha Holdings Inc.')).toBeInTheDocument();
    });

    it('remembers last selected tab in sessionStorage (disb.detailTab)', () => {
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithoutReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Switch to Payment tab
      fireEvent.click(screen.getByTestId('tab-payment'));
      expect(screen.getByTestId('tab-payment')).toHaveAttribute('data-state', 'active');
      expect(sessionStorage.getItem('disb.detailTab')).toBe('payment');

      // Switch to Log tab
      fireEvent.click(screen.getByTestId('tab-log'));
      expect(screen.getByTestId('tab-log')).toHaveAttribute('data-state', 'active');
      expect(sessionStorage.getItem('disb.detailTab')).toBe('log');
    });

    it('restores previous active tab from sessionStorage on mount', () => {
      sessionStorage.setItem('disb.detailTab', 'approval');

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithImageReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('tab-approval')).toHaveAttribute('data-state', 'active');
      expect(screen.getByText('Approval State')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 2. Information Tab Content
  // --------------------------------------------------------------------------
  describe('Information Tab Content', () => {
    it('renders voucher details: entity, category, description, amount, fund source, linkages, client, employee, requester, due date, notes', () => {
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithoutReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Verify fields in Information tab
      expect(screen.getByTestId('detail-voucher-number')).toHaveTextContent('Voucher #DISB-ATA-20261025-001');
      expect(screen.getByText('Transportation')).toBeInTheDocument();
      expect(screen.getAllByText('Firm Fund').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Alpha Holdings Inc.')).toBeInTheDocument();
      expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
      expect(screen.getByText('Maria Santos')).toBeInTheDocument();
      expect(screen.getByText('2026-11-01')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-work-request')).toHaveTextContent(
        'WR-2026-0042 — SEC Company Compliance 2026'
      );
      expect(screen.getByText('task-55')).toBeInTheDocument();
      expect(screen.getByText('inv-88')).toBeInTheDocument();
      expect(screen.getByText('trans-99')).toBeInTheDocument();
      expect(screen.getByText('Site inspection taxi fare')).toBeInTheDocument();
      expect(screen.getByText('Urgent reimbursement request for transport')).toBeInTheDocument();
    });
  });

  // --------------------------------------------------------------------------
  // 3. Approval Tab Content
  // --------------------------------------------------------------------------
  describe('Approval Tab Content', () => {
    it('renders approved by and approved at details when voucher is approved', () => {
      sessionStorage.setItem('disb.detailTab', 'approval');
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithImageReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByText(/Authorized by/i)).toHaveTextContent('Atty. Lorein Wong');
      expect(screen.getByText('Ready for Review')).toBeInTheDocument();
    });

    it('renders rejection reason, reviewer, and review-ready state when rejected', () => {
      sessionStorage.setItem('disb.detailTab', 'approval');
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbRejected}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('drawer-rejection-banner')).toBeInTheDocument();
      expect(screen.getByTestId('drawer-rejection-reason')).toHaveTextContent(
        'Missing official BIR registered vendor receipt'
      );
      expect(screen.getByText('Rejection Justification')).toBeInTheDocument();
      expect(screen.getAllByText(/Admin Reviewer/).length).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Payment Tab Content & Edit Modal Entry Point
  // --------------------------------------------------------------------------
  describe('Payment Tab Content & Governance', () => {
    it('renders method, bank, reference, date, processed by, funded by, and released by', () => {
      sessionStorage.setItem('disb.detailTab', 'payment');
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithPdfReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('detail-payment-method')).toHaveTextContent('Bank Transfer');
      expect(screen.getByTestId('detail-payment-bank')).toHaveTextContent('BDO Unibank');
      expect(screen.getByTestId('detail-payment-reference')).toHaveTextContent('REF-TXN-998811');
      expect(screen.getByTestId('detail-payment-date')).toHaveTextContent('2026-10-25');
      expect(screen.getByText('Jen Andoga')).toBeInTheDocument();
      expect(screen.getByText(/Accounting Dept/)).toBeInTheDocument();
      expect(screen.getByText(/Admin Partner/)).toBeInTheDocument();
    });

    it('renders Correct Payment Details button and opens modal for authorized users', () => {
      sessionStorage.setItem('disb.detailTab', 'payment');
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithPdfReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const editBtn = screen.getByTestId('btn-edit-payment-details');
      expect(editBtn).toBeInTheDocument();
      fireEvent.click(editBtn);

      expect(screen.getByTestId('edit-payment-details-modal')).toBeInTheDocument();
      expect(screen.getByTestId('input-edit-payment-reference')).toHaveValue('REF-TXN-998811');
    });
  });

  // --------------------------------------------------------------------------
  // 5. Log Tab Content
  // --------------------------------------------------------------------------
  describe('Log Tab Content', () => {
    it('renders lifecycle timeline with actor, action, status transition, and timestamp', () => {
      sessionStorage.setItem('disb.detailTab', 'log');
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithPdfReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const timeline = screen.getByTestId('lifecycle-history-timeline');
      expect(timeline).toBeInTheDocument();
      expect(within(timeline).getAllByText('Approved').length).toBeGreaterThan(0);
      expect(within(timeline).getAllByTestId('disbursement-status-badge').map((badge) => badge.textContent)).toContain('Draft');
      expect(within(timeline).getAllByText('Released').length).toBeGreaterThan(0);
      expect(within(timeline).getAllByTestId('disbursement-status-badge').map((badge) => badge.textContent)).toContain('Funded');
    });
  });

  // --------------------------------------------------------------------------
  // 6. Eyeshare Inline Receipt Viewer & Toolbar
  // --------------------------------------------------------------------------
  describe('Receipt Viewer & Toolbar Controls', () => {
    it('renders "No receipt attached" empty state when no receipt exists', () => {
      sessionStorage.setItem('disb.detailTab', 'attachment');
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithoutReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('receipt-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No receipt attached')).toBeInTheDocument();
    });

    it('renders a compact toolbar with Modal, Download, and inline preview', async () => {
      const { wrapper } = createHarness();
      render(<DisbursementDetailBody isOpen initialDisbursement={mockDisbWithImageReceipt} onClose={vi.fn()} />, { wrapper });
      await waitFor(() => expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument());
      expect(screen.queryByTestId('receipt-attachment-row')).not.toBeInTheDocument();
      expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute('href', 'https://storage.test/receipts/taxi_receipt.png');
      expect(screen.getByRole('img')).toBeInTheDocument();
      expect(screen.getByTestId('receipt-viewer-container').textContent).not.toContain('entities/');
      fireEvent.click(screen.getByTestId('btn-open-modal-receipt'));
      expect(await screen.findByTestId('doc-preview-image')).toHaveAttribute('src', 'https://storage.test/receipts/taxi_receipt.png');
      expect(screen.queryByTestId('document-details-panel')).not.toBeInTheDocument();
      expect(screen.queryByTestId('comments-scroll-container')).not.toBeInTheDocument();
    });

    it('opens the canonical viewer, expands, returns to windowed mode and closes', async () => {
      const { wrapper } = createHarness();
      render(<DisbursementDetailBody isOpen initialDisbursement={mockDisbWithImageReceipt} onClose={vi.fn()} />, { wrapper });
      await waitFor(() => expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('btn-open-modal-receipt'));
      const modal = await screen.findByTestId('document-viewer-modal');
      fireEvent.click(screen.getByTestId('toggle-fullpage-preview'));
      expect(modal).toHaveClass('w-screen');
      fireEvent.click(screen.getByTestId('toggle-fullpage-preview'));
      expect(modal).not.toHaveClass('w-screen');
      fireEvent.click(within(modal).getAllByRole('button', { name: 'Close' })[0]!);
      await waitFor(() => expect(screen.queryByTestId('document-viewer-modal')).not.toBeInTheDocument());
      expect(screen.getByTestId('receipt-viewer-container')).toBeInTheDocument();
    });

    it('opens PDF in the canonical modal viewer', async () => {
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailBody
          isOpen
          initialDisbursement={mockDisbWithPdfReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('btn-open-modal-receipt'));
      const iframe = await screen.findByTestId('doc-preview-pdf');
      expect(iframe).toHaveAttribute('src', 'https://storage.test/receipts/official_invoice.pdf');
    });
  });

  // --------------------------------------------------------------------------
  // 7. Mobile Sheet (<1024px Viewport)
  // --------------------------------------------------------------------------
  describe('Mobile Sheet Viewport (<1024px)', () => {
    it('renders the same tabs and receipt viewer inside full-height sheet modal', async () => {
      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          initialDisbursement={mockDisbWithImageReceipt}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const drawer = screen.getByTestId('disbursement-detail-drawer');
      expect(drawer).toBeInTheDocument();
      expect(drawer).toHaveClass('h-full');

      // Verify tabs inside drawer
      expect(screen.getByTestId('tab-attachment')).toBeInTheDocument();
      expect(screen.getByTestId('tab-information')).toBeInTheDocument();
      expect(screen.getByTestId('tab-approval')).toBeInTheDocument();
      expect(screen.getByTestId('tab-payment')).toBeInTheDocument();
      expect(screen.getByTestId('tab-log')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument();
      });
    });
  });
});
