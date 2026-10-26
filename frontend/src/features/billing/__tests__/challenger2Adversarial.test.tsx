import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { RecordPaymentModal } from '../components/RecordPaymentModal';
import {
  useBlockingModalStore,
  BlockingActionModal,
} from '@/features/operations/components/BlockingActionModal';
import {
  updateClientAddressAction,
  recordPaymentAction,
} from '../api/useBillingMutations';
import { useSessionStore } from '@/lib/session';
import { queryClient as globalQueryClient } from '@/lib/api';
import type { Invoice } from '../api/types';

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

const baseInvoice: Invoice = {
  id: 'inv-test-challenger2-1',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-2026-CHALLENGE2',
  client_id: 'client-uuid-1',
  issue_date: '2026-10-01',
  due_date: '2026-10-31',
  status: 'Sent',
  subtotal: 100000,
  total: 100000,
  amount_paid: 25000,
  balance: 75000,
  address: 'Unit 1201 Ayala Triangle Gardens, Makati City',
  notes: 'Quarterly compliance advisory retainer',
  terms: 'Net 30 days',
  version: 2,
  created_at: '2026-10-01T08:00:00Z',
  updated_at: '2026-10-02T08:00:00Z',
  clients: {
    name: 'Megaworld Holdings Corp',
    tin: '987-654-321-000',
    address: 'Unit 1201 Ayala Triangle Gardens, Makati City',
  },
  line_items: [
    {
      id: 'li-1',
      description: 'Audit Retainer Milestone 1',
      amount: 100000,
      type: 'Professional Fee',
    },
  ],
  payments: [
    {
      id: 'pay-1',
      invoice_id: 'inv-test-challenger2-1',
      amount: 25000,
      payment_method: 'Bank Transfer',
      reference_number: 'BPI-DEP-9988',
      payment_date: '2026-10-02',
      notes: 'Initial down payment',
    },
  ],
};

describe('CHALLENGER 2: Adversarial Verification of Print Preview, Address Security, and Payments', () => {
  const originalFetch = global.fetch;
  const originalPrint = window.print;
  const originalOpen = window.open;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    window.print = vi.fn();
    window.open = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    globalQueryClient.clear();
    window.print = originalPrint;
    window.open = originalOpen;
    useBlockingModalStore.getState().reset();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // AREA 1: PrintPreviewModal Adversarial Challenges
  // ==========================================================================
  describe('Area 1: PrintPreviewModal Decoupling & A4 Sheet Fidelity', () => {
    it('renders exact A4 sheet layout on-screen with BIR footer and NEVER auto-prints on open', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin User',
          role: 'Admin',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit', 'billing:edit_client_address'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <PrintPreviewModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-test-challenger2-1"
          initialInvoice={baseInvoice}
        />,
        { wrapper }
      );

      // Verify A4 sheet layout
      const sheet = screen.getByTestId('a4-document-sheet');
      expect(sheet).toBeInTheDocument();
      expect(sheet.className).toContain('statement-document');

      // Preview uses the same official statement body as print and PDF.
      expect(screen.getByText('HENRY WONG')).toBeInTheDocument();
      expect(screen.getByText('Prepared by:')).toBeInTheDocument();
      expect(screen.getByText('Received by:')).toBeInTheDocument();

      // Verify Bill To box, line items, and totals
      expect(screen.getByTestId('bill-to-box')).toBeInTheDocument();
      expect(screen.getByTestId('line-items-table')).toBeInTheDocument();
      expect(screen.getByTestId('invoice-total')).toHaveTextContent('100,000.00');
      expect(sheet.textContent).toContain('TOTAL AMOUNT DUE');

      // CRITICAL ASSERTION: window.print must NOT be called on modal mount/open
      expect(window.print).not.toHaveBeenCalled();
    });

    it('explicitly triggers window.print() only when "Print Document" button is clicked', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin User',
          role: 'Admin',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['billing:view'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <PrintPreviewModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-test-challenger2-1"
          initialInvoice={baseInvoice}
        />,
        { wrapper }
      );

      expect(window.print).not.toHaveBeenCalled();

      // Explicit trigger opens the prototype-verbatim print window
      // (about:blank) — the modal no longer calls in-page window.print().
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      const printButton = screen.getByTestId('print-document-button');
      fireEvent.click(printButton);

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith('', '_blank');
      openSpy.mockRestore();
    });

    it('downloads PDF via fetchInvoicePdfUrl when "Download PDF" button is clicked', async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/invoices/inv-test-challenger2-1/pdf')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: { url: 'https://storage.example.com/invoice-pdf-download.pdf' },
            }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: baseInvoice }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <PrintPreviewModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-test-challenger2-1"
          initialInvoice={baseInvoice}
        />,
        { wrapper }
      );

      const downloadBtn = screen.getByTestId('download-pdf-button');
      fireEvent.click(downloadBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/invoices/inv-test-challenger2-1/pdf'),
          expect.anything()
        );
        expect(window.open).toHaveBeenCalledWith(
          'https://storage.example.com/invoice-pdf-download.pdf',
          '_blank'
        );
      });
    });

    it('gracefully renders fallback when invoice address is missing or empty', async () => {
      const invoiceNoAddress: Invoice = {
        ...baseInvoice,
        address: undefined,
        clients: {
          name: 'Acme Unknown',
          tin: undefined,
          address: undefined,
        },
      };

      const { wrapper } = createHarness();
      render(
        <PrintPreviewModal
          isOpen={true}
          onClose={vi.fn()}
          initialInvoice={invoiceNoAddress}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('client-address-display')).toHaveTextContent(
        'No address provided'
      );
    });
  });

  // ==========================================================================
  // AREA 2: Field-Level Client Address Security Adversarial Challenges
  // ==========================================================================
  describe('Area 2: Field-Level Client Address Security & Immutability', () => {
    it('restricts address editing from users without billing:edit_client_address (shows lock icon)', async () => {
      // User has billing:edit and billing:request, but lacks billing:edit_client_address
      useSessionStore.getState().setSession({
        user: {
          id: 'u-ops',
          email: 'ops@ata-lta.ph',
          name: 'Operations Associate',
          role: 'Operations',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit', 'billing:request'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();

      // In PrintPreviewModal
      const { unmount } = render(
        <PrintPreviewModal
          isOpen={true}
          onClose={vi.fn()}
          initialInvoice={baseInvoice}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('address-locked-indicator')).toBeInTheDocument();
      expect(screen.queryByTestId('edit-client-address-button')).not.toBeInTheDocument();
      unmount();

      // In InvoiceDetailModal
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          initialInvoice={baseInvoice}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('detail-address-locked')).toBeInTheDocument();
      expect(screen.queryByTestId('detail-edit-address-btn')).not.toBeInTheDocument();
    });

    it('permits authorized user with billing:edit_client_address to edit address snapshot via PATCH /v1/invoices/:id without touching clients master table', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-cpa',
          email: 'cpa@ata-lta.ph',
          name: 'Senior CPA',
          role: 'Accounting',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:edit', 'billing:edit_client_address'],
        activeEntity: 'ATA',
      });

      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-test-challenger2-1') && method === 'PATCH') {
          const body = JSON.parse(String(opts?.body || '{}'));
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                ...baseInvoice,
                address: body.address,
                version: 3,
              },
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: baseInvoice }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <PrintPreviewModal
          isOpen={true}
          onClose={vi.fn()}
          initialInvoice={baseInvoice}
        />,
        { wrapper }
      );

      const editBtn = screen.getByTestId('edit-client-address-button');
      fireEvent.click(editBtn);

      const input = screen.getByTestId('address-input');
      const updatedAddress = 'Penthouse Suite, 6750 Ayala Avenue, Makati City 1226';
      fireEvent.change(input, { target: { value: updatedAddress } });

      const saveBtn = screen.getByTestId('save-address-button');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        // Must issue PATCH /v1/invoices/:id with { address, expectedVersion }
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/invoices/inv-test-challenger2-1'),
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({
              address: updatedAddress,
              expectedVersion: 2,
            }),
          })
        );
      });

      // Assert that master clients table (/v1/clients) was NEVER targeted
      const calledUrls = vi.mocked(global.fetch).mock.calls.map((c) => String(c[0]));
      for (const u of calledUrls) {
        expect(u).not.toContain('/clients');
      }

      await waitFor(() => {
        expect(screen.getByTestId('address-update-success-banner')).toHaveTextContent(
          'Updated invoice snapshot address only. Master client record remains unchanged.'
        );
      });
    });

    it('surfaces verbatim RFC 7807 403 Forbidden details when unauthorized client attempts direct address update', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => ({
            status: 403,
            title: 'Forbidden',
            detail: 'Permission billing:edit_client_address is required to modify client address',
            code: 'FORBIDDEN',
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(<BlockingActionModal />, { wrapper });

      const promise = updateClientAddressAction(
        'inv-test-challenger2-1',
        'Direct Exploit Attempt Address',
        2,
        'ATA'
      );

      await expect(promise).rejects.toThrow();

      await waitFor(() => {
        expect(screen.getByTestId('error-code-badge')).toHaveTextContent('FORBIDDEN');
        expect(screen.getByTestId('error-detail-body')).toHaveTextContent(
          'Permission billing:edit_client_address is required to modify client address'
        );
      });
    });
  });

  // ==========================================================================
  // AREA 3: Payment Recording Adversarial Challenges
  // ==========================================================================
  describe('Area 3: Payment Recording Validation & Rejections', () => {
    it('validates and rejects non-positive payment amount (0 or negative) in modal UI', async () => {
      const { wrapper } = createHarness();
      render(
        <RecordPaymentModal
          isOpen={true}
          onClose={vi.fn()}
          invoice={baseInvoice}
        />,
        { wrapper }
      );

      const amountInput = screen.getByTestId('payment-amount-input');
      const submitBtn = screen.getByTestId('submit-payment-button');

      // Test zero
      fireEvent.change(amountInput, { target: { value: '0' } });
      fireEvent.click(submitBtn);

      expect(screen.getByTestId('payment-form-error')).toHaveTextContent(
        'Payment amount must be greater than 0.'
      );

      // Test negative
      fireEvent.change(amountInput, { target: { value: '-100' } });
      fireEvent.click(submitBtn);

      expect(screen.getByTestId('payment-form-error')).toHaveTextContent(
        'Payment amount must be greater than 0.'
      );
    });

    it('validates and rejects overpayment (> balance) in modal UI', async () => {
      const { wrapper } = createHarness();
      render(
        <RecordPaymentModal
          isOpen={true}
          onClose={vi.fn()}
          invoice={baseInvoice} // balance is 75,000
        />,
        { wrapper }
      );

      const amountInput = screen.getByTestId('payment-amount-input');
      const submitBtn = screen.getByTestId('submit-payment-button');

      // Attempt 75,000.01 (over remaining balance)
      fireEvent.change(amountInput, { target: { value: '75000.01' } });
      fireEvent.click(submitBtn);

      expect(screen.getByTestId('payment-form-error')).toHaveTextContent(
        'Payment amount cannot exceed remaining balance of ₱75,000.00.'
      );
    });

    it('hides "Record Payment" button on unreleased invoices (Draft or Pending) in InvoiceDetailModal', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-acct',
          email: 'acct@ata-lta.ph',
          name: 'Accountant',
          role: 'Accounting',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['billing:view', 'billing:payments', 'billing:edit'],
        activeEntity: 'ATA',
      });

      const draftInvoice: Invoice = {
        ...baseInvoice,
        status: 'Draft',
        amount_paid: 0,
        balance: 100000,
      };

      const pendingInvoice: Invoice = {
        ...baseInvoice,
        status: 'Pending',
        amount_paid: 0,
        balance: 100000,
      };

      const { wrapper } = createHarness();

      // 1. Draft
      const { unmount } = render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          initialInvoice={draftInvoice}
          onOpenRecordPayment={vi.fn()}
        />,
        { wrapper }
      );
      expect(screen.queryByTestId('detail-btn-record-payment')).not.toBeInTheDocument();
      unmount();

      // 2. Pending
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          initialInvoice={pendingInvoice}
          onOpenRecordPayment={vi.fn()}
        />,
        { wrapper }
      );
      expect(screen.queryByTestId('detail-btn-record-payment')).not.toBeInTheDocument();
    });

    it('rejects direct payment attempt on unreleased invoice with 400 Bad Request and surfaces detail verbatim', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({
            status: 400,
            title: 'Bad Request',
            detail:
              'Cannot record payment on invoice in "Draft" status. Payments can only be recorded once the invoice is released (Approved, Sent, Partially Paid, or Overdue).',
            code: 'VALIDATION_ERROR',
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(<BlockingActionModal />, { wrapper });

      const promise = recordPaymentAction(
        'inv-test-challenger2-1',
        {
          amount: 50000,
          method: 'Bank Transfer',
          date: '2026-10-04',
        },
        'ATA'
      );

      await expect(promise).rejects.toThrow();

      await waitFor(() => {
        expect(screen.getByTestId('error-detail-body')).toHaveTextContent(
          'Cannot record payment on invoice in "Draft" status. Payments can only be recorded once the invoice is released'
        );
      });
    });

    it('rejects concurrent overpayment with 409 Conflict OVERPAYMENT and surfaces RFC 7807 problem details', async () => {
      global.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          json: async () => ({
            status: 409,
            title: 'Overpayment',
            detail: 'Payment would exceed invoice balance',
            code: 'OVERPAYMENT',
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(<BlockingActionModal />, { wrapper });

      const promise = recordPaymentAction(
        'inv-test-challenger2-1',
        {
          amount: 75000,
          method: 'Cash',
          date: '2026-10-04',
        },
        'ATA'
      );

      await expect(promise).rejects.toThrow();

      await waitFor(() => {
        expect(screen.getByTestId('error-code-badge')).toHaveTextContent('OVERPAYMENT');
        expect(screen.getByTestId('error-detail-body')).toHaveTextContent(
          'Payment would exceed invoice balance'
        );
      });
    });

    it('successfully processes full balance payment via modal and triggers onPaymentRecorded callback', async () => {
      const recordedPayment = {
        id: 'payment-res-1',
        invoice_id: 'inv-test-challenger2-1',
        amount: 75000,
        payment_method: 'Check',
        reference_number: 'CHK-99881',
        payment_date: '2026-10-04',
        notes: 'Final settlement',
      };

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/invoices/inv-test-challenger2-1/payments')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ data: recordedPayment }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: baseInvoice }),
        } as Response);
      });

      const onClose = vi.fn();
      const onPaymentRecorded = vi.fn();
      const { wrapper } = createHarness();

      render(
        <RecordPaymentModal
          isOpen={true}
          onClose={onClose}
          invoice={baseInvoice}
          onPaymentRecorded={onPaymentRecorded}
        />,
        { wrapper }
      );

      // Click Pay Full Balance
      fireEvent.click(screen.getByTestId('pay-full-balance-button'));
      const amountInput = screen.getByTestId('payment-amount-input') as HTMLInputElement;
      expect(amountInput.value).toBe('75000');

      // Add reference
      fireEvent.change(screen.getByTestId('payment-reference-input'), {
        target: { value: 'CHK-99881' },
      });

      // Submit
      fireEvent.click(screen.getByTestId('submit-payment-button'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/invoices/inv-test-challenger2-1/payments'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('"amount":75000'),
          })
        );
        expect(onClose).toHaveBeenCalled();
        expect(onPaymentRecorded).toHaveBeenCalled();
      });
    });
  });
});
