import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceDetailModal } from '@/features/billing/components/InvoiceDetailModal';
import { PrintPreviewModal } from '@/features/billing/components/PrintPreviewModal';
import { DisbursementDetailDrawer } from '@/features/disbursements/components/DisbursementDetailDrawer';
import { DocumentViewerModal } from '@/features/documents/components/DocumentViewerModal';
import { TransmittalDetailModal } from '@/features/transmittals/components/TransmittalDetailModal';
import { useSessionStore } from '@/lib/session';
import type { Invoice } from '@/features/billing/api/types';
import type { Disbursement } from '@/features/disbursements/api/types';
import type { DmsDocument } from '@/features/documents/api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const mockInvoice: Invoice = {
  id: 'inv-secret-1',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-SECRET-001',
  client_id: 'c-secret',
  issue_date: '2026-10-10',
  due_date: '2026-11-10',
  status: 'Draft',
  subtotal: 99000,
  total: 99000,
  amount_paid: 0,
  balance: 99000,
  address: 'Confidential Client Address 123',
  notes: 'Highly confidential legal retainers',
  terms: 'Net 30 days',
  version: 1,
  created_at: '2026-10-10T08:00:00Z',
  updated_at: '2026-10-10T08:00:00Z',
  clients: {
    name: 'Top Secret Client Philippines Inc',
    tin: '999-888-777-000',
    address: 'Confidential Client Address 123',
  },
  line_items: [
    {
      id: 'li-secret-1',
      invoice_id: 'inv-secret-1',
      description: 'Secret Investigation Services',
      amount: 99000,
      type: 'Professional Fee',
    },
  ],
  payments: [],
};

const mockDisbursement: Disbursement = {
  id: 'disb-secret-1',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  disbursement_number: 'DV-SECRET-0042',
  category: 'Legal Retainer Filing',
  description: 'Secret Agent Escrow',
  amount: 45000,
  client_name: 'Top Secret Client Philippines Inc',
  clientName: 'Top Secret Client Philippines Inc',
  status: 'Draft',
  fund_source: 'Firm Fund',
  fundSource: 'Firm Fund',
  notes: 'Confidential voucher filing notes',
  version: 1,
  lifecycle_version: 2,
  created_at: '2026-10-15T08:00:00Z',
  receipt_filename: 'confidential_receipt.pdf',
  receipt_s3_key: 'receipts/confidential_receipt.pdf',
  linked_work_request_id: 'wr-1',
  updated_at: '2026-10-15T08:00:00Z',
};

const mockDoc: DmsDocument = {
  id: 'doc-secret-1',
  work_request_id: 'wr-1',
  client_id: 'c-1',
  file_name: 'confidential_contract.pdf',
  original_name: 'confidential_contract.pdf',
  category: 'CONTRACT',
  file_size: 1048576,
  content_type: 'application/pdf',
  upload_date: '2026-10-20T08:00:00Z',
  created_at: '2026-10-20T08:00:00Z',
  uploader_id: 'u-1',
  comments: [],
  linked_task_id: null,
  document_type: null,
  description: null,
  entity_id: 'ent-ata',
  status: 'active',
  document_lifecycle: 'collected',
  archived: false,
  storage_path: null,
  external_url: null,
  versions: [],
  updated_at: '2026-10-20T08:00:00Z',
};

describe('360° Scoped Financial & Document Privacy Protection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-qa-worker',
        email: 'qa@ata-lta.ph',
        name: 'QA Worker',
        role: 'Operations Lead',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'disbursement:view', 'document:view', 'transmittal:view'],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. InvoiceDetailModal Privacy & Stale Scope
  // =========================================================================
  describe('InvoiceDetailModal Privacy & Stale Scope', () => {
    it('suppresses retained initialInvoice and shows access-denied dialog upon 403 refetch', async () => {
      const { wrapper } = createHarness();

      // Detail fetch returns 403 access denial
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          title: 'Forbidden',
          detail: 'You do not have permission to view this invoice',
        }),
      } as Response);

      render(
        <InvoiceDetailModal
          isOpen
          onClose={() => {}}
          invoiceId="inv-secret-1"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      // Access denied dialog must be rendered
      await waitFor(() => {
        expect(screen.getByTestId('invoice-access-denied-dialog')).toBeInTheDocument();
      });

      // Confidential invoice details must NOT be present in DOM
      expect(screen.queryByText('ATA-SI-SECRET-001')).not.toBeInTheDocument();
      expect(screen.queryByText('Top Secret Client Philippines Inc')).not.toBeInTheDocument();
      expect(screen.queryByText('Confidential Client Address 123')).not.toBeInTheDocument();
      expect(screen.queryByText('Secret Investigation Services')).not.toBeInTheDocument();
      expect(screen.queryByTestId('detail-btn-record-payment')).not.toBeInTheDocument();
      expect(screen.queryByTestId('detail-btn-print-preview')).not.toBeInTheDocument();
    });

    it('immediately hides initialInvoice when active entity changes during delayed read', async () => {
      const { wrapper } = createHarness();
      const onClose = vi.fn();

      // Delayed network fetch simulating context transition
      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000))
      );

      const { rerender } = render(
        <InvoiceDetailModal
          isOpen
          onClose={onClose}
          invoiceId="inv-secret-1"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      // Initially authorized under ATA
      expect(screen.getByText('ATA-SI-SECRET-001')).toBeInTheDocument();

      // User changes active entity to LTA
      act(() => {
        useSessionStore.getState().setActiveEntity('LTA');
      });

      rerender(
        <InvoiceDetailModal
          isOpen
          onClose={onClose}
          invoiceId="inv-secret-1"
          initialInvoice={mockInvoice}
        />
      );

      // Confidential content must immediately disappear; no initialInvoice leak during delayed read
      expect(screen.queryByText('ATA-SI-SECRET-001')).not.toBeInTheDocument();
      expect(screen.queryByText('Top Secret Client Philippines Inc')).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
    });

    it('restores invoice details when fresh 200 arrives after initial 403 denial', async () => {
      const { queryClient, wrapper } = createHarness();
      let mode: 'denied' | 'restored' = 'denied';

      global.fetch = vi.fn().mockImplementation(async () => {
        if (mode === 'denied') {
          return {
            ok: false,
            status: 403,
            json: async () => ({ status: 403, title: 'Forbidden', detail: 'Denied' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: mockInvoice }),
        } as Response;
      });

      render(
        <InvoiceDetailModal
          isOpen
          onClose={() => {}}
          invoiceId="inv-secret-1"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      // 1. Initial 403 denial
      await waitFor(() => {
        expect(screen.getByTestId('invoice-access-denied-dialog')).toBeInTheDocument();
      });

      // 2. Fresh 200 restoration
      mode = 'restored';
      await act(async () => {
        await queryClient.invalidateQueries();
      });

      await waitFor(() => {
        expect(screen.getByText('ATA-SI-SECRET-001')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('invoice-access-denied-dialog')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. DisbursementDetailDrawer Privacy & Stale Scope
  // =========================================================================
  describe('DisbursementDetailDrawer Privacy & Stale Scope', () => {
    it('suppresses retained initialDisbursement and receipt query upon 403 refetch', async () => {
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          title: 'Forbidden',
          detail: 'You do not have access to this disbursement',
        }),
      } as Response);

      render(
        <DisbursementDetailDrawer
          isOpen
          onClose={() => {}}
          id="disb-secret-1"
          initialDisbursement={mockDisbursement}
        />,
        { wrapper }
      );

      // Access denied state must be shown
      await waitFor(() => {
        expect(screen.getByTestId('disbursement-access-denied')).toBeInTheDocument();
      });

      // Confidential amounts, payee, and details must NOT be in the DOM
      expect(screen.queryByText('DV-SECRET-0042')).not.toBeInTheDocument();
      expect(screen.queryByText('Secret Agent Escrow')).not.toBeInTheDocument();
      expect(screen.queryByText('Top Secret Client Philippines Inc')).not.toBeInTheDocument();
      expect(screen.queryByTestId('drawer-amount')).not.toBeInTheDocument();
    });

    it('immediately hides initialDisbursement when user account switches during delayed read', async () => {
      const { wrapper } = createHarness();
      const onClose = vi.fn();

      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000))
      );

      const { rerender } = render(
        <DisbursementDetailDrawer
          isOpen
          onClose={onClose}
          id="disb-secret-1"
          initialDisbursement={mockDisbursement}
        />,
        { wrapper }
      );

      expect(screen.getByText('DV-SECRET-0042')).toBeInTheDocument();

      // Switch user account
      act(() => {
        useSessionStore.getState().setSession({
          user: {
            id: 'u-different-worker',
            email: 'different@ata-lta.ph',
            name: 'Different Worker',
            role: 'Client',
            departments: [],
            entities: ['ATA'],
          },
          permissions: [],
          activeEntity: 'ATA',
        });
      });

      rerender(
        <DisbursementDetailDrawer
          isOpen
          onClose={onClose}
          id="disb-secret-1"
          initialDisbursement={mockDisbursement}
        />
      );

      // Stale voucher must immediately vanish
      expect(screen.queryByText('DV-SECRET-0042')).not.toBeInTheDocument();
      expect(screen.queryByText('Secret Agent Escrow')).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. PrintPreviewModal Privacy & Stale Scope
  // =========================================================================
  describe('PrintPreviewModal Privacy & Stale Scope', () => {
    it('suppresses retained initialInvoice in print preview upon 403 refetch', async () => {
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          title: 'Forbidden',
          detail: 'Access denied',
        }),
      } as Response);

      render(
        <PrintPreviewModal
          isOpen
          onClose={() => {}}
          invoiceId="inv-secret-1"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('print-preview-access-denied-dialog')).toBeInTheDocument();
      });

      expect(screen.queryByText('Top Secret Client Philippines Inc')).not.toBeInTheDocument();
      expect(screen.queryByText('Confidential Client Address 123')).not.toBeInTheDocument();
      expect(screen.queryByText('Download PDF')).not.toBeInTheDocument();
    });

    it('immediately hides preview when active entity changes during delayed read', async () => {
      const { wrapper } = createHarness();
      const onClose = vi.fn();

      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000))
      );

      const { rerender } = render(
        <PrintPreviewModal
          isOpen
          onClose={onClose}
          invoiceId="inv-secret-1"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      expect(screen.getByText('Top Secret Client Philippines Inc')).toBeInTheDocument();

      act(() => {
        useSessionStore.getState().setActiveEntity('LTA');
      });

      rerender(
        <PrintPreviewModal
          isOpen
          onClose={onClose}
          invoiceId="inv-secret-1"
          initialInvoice={mockInvoice}
        />
      );

      expect(screen.queryByText('Top Secret Client Philippines Inc')).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. DocumentViewerModal Privacy & File Preview
  // =========================================================================
  describe('DocumentViewerModal Privacy & File Preview', () => {
    it('suppresses document content and download preview when detail returns 403', async () => {
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          title: 'Forbidden',
          detail: 'Access denied to document',
        }),
      } as Response);

      render(
        <DocumentViewerModal
          isOpen
          onClose={() => {}}
          document={mockDoc}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('document-access-denied')).toBeInTheDocument();
      });

      expect(screen.queryByText('confidential_contract.pdf')).not.toBeInTheDocument();
      expect(screen.queryByTestId('doc-preview-pdf')).not.toBeInTheDocument();
      expect(screen.queryByText('Post Comment')).not.toBeInTheDocument();
    });

    it('suppresses preview when download url endpoint returns 403 even if metadata loaded', async () => {
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/download-url')) {
          return {
            ok: false,
            status: 403,
            json: async () => ({ status: 403, title: 'Forbidden', detail: 'URL access denied' }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: mockDoc }),
        } as Response;
      });

      render(
        <DocumentViewerModal
          isOpen
          onClose={() => {}}
          document={mockDoc}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('document-access-denied')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('doc-preview-pdf')).not.toBeInTheDocument();
    });

    it('immediately hides document when active entity changes during delayed read', async () => {
      const { wrapper } = createHarness();
      const onClose = vi.fn();

      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000))
      );

      const { rerender } = render(
        <DocumentViewerModal
          isOpen
          onClose={onClose}
          document={mockDoc}
        />,
        { wrapper }
      );

      expect(screen.getByText('confidential_contract.pdf')).toBeInTheDocument();

      act(() => {
        useSessionStore.getState().setActiveEntity('LTA');
      });

      rerender(
        <DocumentViewerModal
          isOpen
          onClose={onClose}
          document={mockDoc}
        />
      );

      expect(screen.queryByText('confidential_contract.pdf')).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 5. TransmittalDetailModal Privacy & Stale Scope
  // =========================================================================
  describe('TransmittalDetailModal Privacy & Stale Scope', () => {
    it('renders access denied state when transmittal detail returns 403', async () => {
      const { wrapper } = createHarness();

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          title: 'Forbidden',
          detail: 'Access denied to transmittal',
        }),
      } as Response);

      render(
        <TransmittalDetailModal
          isOpen
          onClose={() => {}}
          transmittalId="tr-secret-1"
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('transmittal-access-denied')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('detail-items-table')).not.toBeInTheDocument();
      expect(screen.queryByTestId('detail-client-name')).not.toBeInTheDocument();
    });

    it('immediately closes and suppresses transmittal when active entity changes during delayed read', async () => {
      const { wrapper } = createHarness();
      const onClose = vi.fn();

      global.fetch = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 2000))
      );

      const { rerender } = render(
        <TransmittalDetailModal
          isOpen
          onClose={onClose}
          transmittalId="tr-secret-1"
        />,
        { wrapper }
      );

      act(() => {
        useSessionStore.getState().setActiveEntity('LTA');
      });

      rerender(
        <TransmittalDetailModal
          isOpen
          onClose={onClose}
          transmittalId="tr-secret-1"
        />
      );

      expect(onClose).toHaveBeenCalled();
    });
  });
});
