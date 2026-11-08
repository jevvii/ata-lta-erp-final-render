import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReceiptViewer } from '../components/ReceiptViewer';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { DisbursementEditModal } from '../components/DisbursementEditModal';
import { InvoiceEditModal } from '@/features/billing/components/InvoiceEditModal';
import { InvoiceCreateModal } from '@/features/billing/components/InvoiceCreateModal';
import { useSessionStore } from '@/lib/session';
import { setTokens } from '@/lib/api';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Disbursement } from '../api/types';
import type { Invoice } from '@/features/billing/api/types';

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WR_ID = '22222222-2222-2222-2222-222222222222';
const TASK_ID = '33333333-3333-3333-3333-333333333333';

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

const mockDraftDisbursement: Disbursement = {
  id: 'disb-external-test-1',
  disbursement_number: 'DISB-ATA-20261025-0099',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Transportation',
  description: 'Site visit taxi fare',
  amount: 1250,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  linked_work_request_id: WR_ID,
  linked_work_request_name: 'Audit 2026',
  linked_task_id: TASK_ID,
  client_name: 'Metro Manila Corp',
  employee_name: 'A. Cruz',
  receipt_filename: 'taxi_receipt.png',
  receipt_s3_key: 'entities/ATA/receipts/taxi_receipt.png',
  version: 1,
  created_at: '2026-10-25T08:00:00Z',
  updated_at: '2026-10-25T08:00:00Z',
};

const mockDraftInvoice: Invoice = {
  id: 'inv-test-1',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-2026-0999',
  client_id: CLIENT_ID,
  work_request_id: WR_ID,
  linked_task_id: TASK_ID,
  task_id: TASK_ID,
  issue_date: '2026-10-20',
  due_date: '2026-11-20',
  status: 'Draft',
  subtotal: 10000,
  total: 10000,
  amount_paid: 0,
  balance: 10000,
  notes: 'Original note',
  terms: 'Original terms',
  version: 2,
  created_at: '2026-10-20T08:00:00Z',
  updated_at: '2026-10-20T08:00:00Z',
  line_items: [
    {
      id: 'item-1',
      description: 'Professional Consultancy',
      amount: 10000,
      type: 'Professional Fee',
    },
  ],
};

describe('Disbursement External Link Receipts & Adjustments', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    setTokens('mock-access-token');
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Accounting', 'Administration'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['disbursement:view', 'disbursement:create', 'disbursement:edit', 'billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: TASK_ID,
                work_request_id: WR_ID,
                workRequestId: WR_ID,
                title: 'Tax Consultation',
                status: 'in_progress',
                phase: 'processing',
                assignees: [{ user_id: 'user-admin' }],
              },
            ],
          }),
        } as Response);
      }
      if (u.includes('/me/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'user-admin', name: 'Admin User', role: 'Admin', email: 'admin@ata-lta.ph' },
            ],
          }),
        } as Response);
      }
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: CLIENT_ID, name: 'Metro Manila Corp', entity: 'ATA' }],
          }),
        } as Response);
      }
      if (u.includes('/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: WR_ID,
                order_number: 'WR-2026-0001',
                title: 'Audit 2026',
                client_id: CLIENT_ID,
                entity: 'ATA',
                phase: 'processing',
                tasks: [{ id: TASK_ID, title: 'Tax Consultation' }],
              },
            ],
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('ReceiptViewer Google Drive inline preview', () => {
    it('does not preview a cached external link before receipt authorization completes', () => {
      render(<ReceiptViewer receiptS3Key="https://drive.google.com/file/d/private123/view" receiptFileName="Private receipt.pdf" isLoadingReceipt onRefetchReceiptUrl={vi.fn()} />);
      expect(screen.queryByTestId('receipt-gdrive-frame')).not.toBeInTheDocument();
      expect(screen.queryByTestId('btn-open-modal-receipt')).not.toBeInTheDocument();
    });

    it('renders Google Drive iframe preview and open link when receipt is a Drive URL', () => {
      const gdriveUrl = 'https://drive.google.com/file/d/1234567890abcdef/view?usp=sharing';
      render(
        <ReceiptViewer
          receiptS3Key={gdriveUrl}
          receiptData={{ url: gdriveUrl, filename: "BIR Official Receipt.pdf", contentType: "text/html", isExternal: true }}
          receiptFileName="BIR Official Receipt.pdf"
          onRefetchReceiptUrl={vi.fn()}
          isDocked={true}
        />
      );

      // Google Drive header and link
      expect(screen.getByText('Google Drive Receipt Preview')).toBeInTheDocument();
      const openLink = screen.getByRole('link', { name: /Open in Google Drive/i });
      expect(openLink).toHaveAttribute('href', gdriveUrl);

      // Inline preview iframe
      const iframe = screen.getByTestId('receipt-gdrive-frame');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute('src', 'https://drive.google.com/file/d/1234567890abcdef/preview');

      // Verify height classes for docked Google Drive preview (aligned with PDF)
      const container = screen.getByTestId('receipt-viewer-container');
      expect(container.className).toContain('flex-1 min-h-0 h-full');
      expect(iframe.className).toContain('min-h-0 h-full');
    });

    it('applies min-h-[70vh] on receipt-gdrive-frame when isDocked is false', () => {
      const gdriveUrl = 'https://drive.google.com/file/d/1234567890abcdef/view?usp=sharing';
      render(
        <ReceiptViewer
          receiptS3Key={gdriveUrl}
          receiptData={{ url: gdriveUrl, filename: "BIR Official Receipt.pdf", contentType: "text/html", isExternal: true }}
          receiptFileName="BIR Official Receipt.pdf"
          onRefetchReceiptUrl={vi.fn()}
          isDocked={false}
        />
      );

      const container = screen.getByTestId('receipt-viewer-container');
      expect(container.className).toContain('flex-1 min-h-0 h-full');
      const iframe = screen.getByTestId('receipt-gdrive-frame');
      expect(iframe.className).toContain('min-h-[70vh]');
    });

    it('passes external_url to DocumentViewerModal when opening modal preview', async () => {
      const { wrapper } = createHarness();
      const gdriveUrl = 'https://drive.google.com/file/d/1234567890abcdef/view?usp=sharing';
      render(
        <ReceiptViewer
          receiptS3Key={gdriveUrl}
          receiptData={{ url: gdriveUrl, filename: "BIR Official Receipt.pdf", contentType: "text/html", isExternal: true }}
          receiptFileName="BIR Official Receipt.pdf"
          onRefetchReceiptUrl={vi.fn()}
          isDocked={true}
        />,
        { wrapper }
      );

      const modalBtn = screen.getByTestId('btn-open-modal-receipt');
      fireEvent.click(modalBtn);

      const modal = await screen.findByTestId('document-viewer-modal');
      expect(modal).toBeInTheDocument();
      expect(modal.textContent).toContain('Google Drive Document Preview');
    });
  });

  describe('CreateDisbursementModal External Link mode', () => {
    it('toggles to external link mode, detects Google Drive, and submits external receipt payload', async () => {
      let createdPayload: Record<string, unknown> | null = null;
      const baseFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'POST' && u.includes('/disbursements')) {
          createdPayload = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: 'new-disb-id',
                ...createdPayload,
                status: 'Draft',
                version: 1,
              },
            }),
          } as Response);
        }
        return (baseFetch as unknown as (url: string, init?: RequestInit) => Promise<Response>)(url, init);
      });

      const { wrapper } = createHarness();
      const onClose = vi.fn();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={onClose}
          prefill={{
            workRequestId: WR_ID,
            taskId: TASK_ID,
            clientId: CLIENT_ID,
          }}
        />,
        { wrapper }
      );

      // Wait for description to be present
      await waitFor(() => {
        expect(screen.getByTestId('textarea-description')).toBeInTheDocument();
      });

      // Fill in required basic fields
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'BIR Registration and filing' },
      });
      fireEvent.change(screen.getByTestId('input-amount'), {
        target: { value: '2500' },
      });

      // Switch to External Link mode
      const linkModeBtn = screen.getByTestId('receipt-mode-link-btn');
      fireEvent.click(linkModeBtn);

      const urlInput = screen.getByTestId('disbursement-external-url-input');
      const nameInput = screen.getByTestId('disbursement-external-name-input');
      expect(urlInput).toBeInTheDocument();
      expect(nameInput).toBeInTheDocument();

      // Enter Google Drive link
      fireEvent.change(urlInput, {
        target: { value: 'https://drive.google.com/file/d/1234567890abcdef/view?usp=sharing' },
      });

      // Badge detected and auto-suggests display name
      expect(
        await screen.findByText(/Google Drive link detected — will be configured for inline preview/i)
      ).toBeInTheDocument();
      expect(nameInput).toHaveValue('Google Drive Receipt');

      // Custom display name
      fireEvent.change(nameInput, { target: { value: 'BIR Official Receipt 2026' } });

      // Wait for submit button to be enabled
      await waitFor(() => {
        expect(screen.getByTestId('submit-create-disbursement-btn')).not.toBeDisabled();
      });

      // Submit
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => expect(createdPayload).not.toBeNull());
      expect(createdPayload!.externalUrl).toBe('https://drive.google.com/file/d/1234567890abcdef/view?usp=sharing');
      expect(createdPayload!.receiptS3Key).toBeUndefined();
      expect(createdPayload!.receiptFilename).toBe('BIR Official Receipt 2026');
    });
  });

  describe('DisbursementEditModal Receipt Attachment', () => {
    it('allows attaching external link and clearing receipt for Draft vouchers', async () => {
      let patchedPayload: Record<string, unknown> | null = null;
      const baseFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'PUT' && u.includes('/disbursements/disb-external-test-1')) {
          patchedPayload = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                ...mockDraftDisbursement,
                ...patchedPayload,
                version: 2,
              },
            }),
          } as Response);
        }
        return (baseFetch as unknown as (url: string, init?: RequestInit) => Promise<Response>)(url, init);
      });

      const { wrapper } = createHarness();
      const onClose = vi.fn();
      render(
        <DisbursementEditModal
          isOpen={true}
          onClose={onClose}
          disbursement={mockDraftDisbursement}
        />,
        { wrapper }
      );

      // Verify clear receipt button clears the existing receipt
      const clearBtn = screen.getByTestId('clear-receipt-btn');
      fireEvent.click(clearBtn);

      // Switch to External Link
      fireEvent.click(screen.getByTestId('edit-receipt-mode-link-btn'));
      const urlInput = screen.getByTestId('edit-disbursement-external-url-input');
      const nameInput = screen.getByTestId('edit-disbursement-external-name-input');

      fireEvent.change(urlInput, { target: { value: 'https://example.com/receipt.pdf' } });
      fireEvent.change(nameInput, { target: { value: 'Scanned Vendor Invoice' } });

      // Save
      fireEvent.click(screen.getByTestId('save-disbursement-edit'));

      await waitFor(() => expect(patchedPayload).not.toBeNull());
      expect(patchedPayload!.externalUrl).toBe('https://example.com/receipt.pdf');
      expect(patchedPayload!.receiptS3Key).toBeUndefined();
      expect(patchedPayload!.receiptFilename).toBe('Scanned Vendor Invoice');
    });
  });

  describe('InvoiceEditModal & InvoiceCreateModal Adjustments', () => {
    it('makes Invoice Number strictly immutable in InvoiceEditModal for Admin on Draft invoice', () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceEditModal
          isOpen={true}
          onClose={vi.fn()}
          invoice={mockDraftInvoice}
        />,
        { wrapper }
      );

      const invoiceNumberInput = screen.getByTestId('input-edit-invoice-number');
      expect(invoiceNumberInput).toBeDisabled();
      expect(invoiceNumberInput).toHaveAttribute('readonly');
      expect(invoiceNumberInput.className).toContain('cursor-not-allowed');
    });

    it('consolidates NOTE field in InvoiceEditModal and syncs terms and notes on save', async () => {
      let patchedBody: Record<string, unknown> | null = null;
      const baseFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'PATCH' && u.includes('/invoices/inv-test-1')) {
          patchedBody = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                ...mockDraftInvoice,
                ...patchedBody,
                version: 3,
              },
            }),
          } as Response);
        }
        return (baseFetch as unknown as (url: string, init?: RequestInit) => Promise<Response>)(url, init);
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceEditModal
          isOpen={true}
          onClose={vi.fn()}
          invoice={mockDraftInvoice}
        />,
        { wrapper }
      );

      const noteTextarea = screen.getByTestId('input-edit-terms');
      expect(noteTextarea).toHaveValue('Original terms');

      fireEvent.change(noteTextarea, {
        target: { value: 'Payment due on receipt. Please deposit to BDO account.' },
      });

      fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

      await waitFor(() => expect(patchedBody).not.toBeNull());
      expect(patchedBody!.terms).toBe('Payment due on receipt. Please deposit to BDO account.');
      expect(patchedBody!.notes).toBe('Payment due on receipt. Please deposit to BDO account.');
    });

    it('InvoiceCreateModal consolidates NOTE field and syncs terms and notes on submit', async () => {
      let postedBody: Record<string, unknown> | null = null;
      const baseFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'POST' && u.includes('/invoices')) {
          postedBody = JSON.parse(init.body as string);
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: 'inv-new-2',
                ...postedBody,
                status: 'Draft',
                version: 1,
              },
            }),
          } as Response);
        }
        return (baseFetch as unknown as (url: string, init?: RequestInit) => Promise<Response>)(url, init);
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            clientId: CLIENT_ID,
            workRequestId: WR_ID,
            taskId: TASK_ID,
          }}
        />,
        { wrapper }
      );

      // Verify label is NOTE
      expect(screen.getByLabelText('NOTE')).toBeInTheDocument();
      const termsInput = screen.getByTestId('input-terms');
      fireEvent.change(termsInput, {
        target: { value: 'Strictly 15 days credit term.' },
      });

      // Submit
      fireEvent.click(screen.getByTestId('btn-submit-invoice'));

      await waitFor(() => expect(postedBody).not.toBeNull());
      expect(postedBody!.terms).toBe('Strictly 15 days credit term.');
      expect(postedBody!.notes).toBe('Strictly 15 days credit term.');
    });
  });
});
