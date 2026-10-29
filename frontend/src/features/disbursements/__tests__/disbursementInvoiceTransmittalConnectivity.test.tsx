import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisbursementDetailBody } from '../components/DisbursementDetailBody';
import { FundDisbursementModal } from '../components/FundDisbursementModal';
import { ReleaseFundsModal } from '../components/FundsReleaseActions';
import { DisbursementCodingGrid } from '../components/workspace/DisbursementCodingGrid';
import { DisbursementActionRail } from '../components/workspace/DisbursementActionRail';
import { LinkBillingTransmittalModal } from '../components/LinkBillingTransmittalModal';
import { InvoiceDetailModal } from '@/features/billing/components/InvoiceDetailModal';
import { TransmittalDetailModal } from '@/features/transmittals/components/TransmittalDetailModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import {
  handleRealtimePayload,
  mergeCdcRecordPreservingEnrichedLinks,
  getDefaultDetailQueryKey,
  getDefaultListRootKey,
} from '@/lib/realtime/useEntityRealtimeSync';
import { handleIncomingTabSyncMessage } from '@/lib/tabSync';
import { disbursementKeys } from '../api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import { transmittalKeys } from '@/features/transmittals/api/queryKeys';
import type { Disbursement } from '../api/types';
import type { Invoice } from '@/features/billing/api/types';
import type { Transmittal } from '@/features/transmittals/api/types';

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

describe('Disbursement ↔ Invoice & Transmittal Cross-Module Connectivity', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response);
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration', 'Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
        'billing:view',
        'billing:edit',
        'transmittal:view',
        'transmittal:edit',
      ],
      activeEntity: 'ATA',
    });
  });

  it('renders SOP Step 2.5 Client Fund Verification warning banner and enriched Linked Invoice & Transmittal badges in DisbursementDetailBody', () => {
    const clientFundDisb: Disbursement = {
      id: 'disb-cf-1',
      disbursement_number: 'DISB-ATA-20261029-001',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Government Fee',
      description: 'BIR Registration Fee',
      amount: 12500,
      source_of_funds: 'Client Fund',
      status: 'Approved',
      lifecycle_version: 2,
      work_request_id: 'wr-1',
      linked_invoice_id: 'inv-1',
      linked_transmittal_id: 'trn-1',
      linked_invoice_summary: {
        id: 'inv-1',
        invoice_number: 'INV-ATA-202610-001',
        status: 'Issued',
        total: 25000,
        amount_paid: 0,
        balance: 25000,
      },
      linked_transmittal_summary: {
        id: 'trn-1',
        tracking_number: 'ATA-TRN-20261029-001',
        status: 'Sent',
        recipient_name: 'Juan Dela Cruz',
      },
      version: 2,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    const { wrapper } = createHarness();
    render(
      <DisbursementDetailBody
        id={clientFundDisb.id}
        initialDisbursement={clientFundDisb}
        isOpen={true}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('sop-step-2-5-warning-banner')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-linked-invoice')).toHaveTextContent('INV-ATA-202610-001');
    expect(screen.getByTestId('drawer-linked-invoice')).toHaveTextContent('Issued');
    expect(screen.getByTestId('drawer-linked-transmittal')).toHaveTextContent('ATA-TRN-20261029-001');
    expect(screen.getByTestId('drawer-linked-transmittal')).toHaveTextContent('Juan Dela Cruz');
    expect(screen.getByTestId('edit-disbursement-button')).toBeInTheDocument();
  });

  it('requires SOP Step 2.5 confirmation checkbox before funding a Client Fund disbursement with unpaid linked invoice', () => {
    const approvedClientFund: Disbursement = {
      id: 'disb-cf-2',
      disbursement_number: 'DISB-ATA-20261029-002',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Filing Fee',
      description: 'SEC Filing Fee',
      amount: 8000,
      source_of_funds: 'Client Fund',
      status: 'Approved',
      lifecycle_version: 2,
      linked_invoice_id: 'inv-2',
      linked_invoice_summary: {
        id: 'inv-2',
        invoice_number: 'INV-ATA-202610-002',
        status: 'Partially Paid',
        total: 10000,
        amount_paid: 4000,
        balance: 6000,
      },
      version: 2,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    const { wrapper } = createHarness();
    render(
      <FundDisbursementModal
        isOpen={true}
        disbursement={approvedClientFund}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('sop-client-fund-gate')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('input-fund-bank'), {
      target: { value: 'BDO Makati' },
    });
    fireEvent.change(screen.getByTestId('input-fund-reference'), {
      target: { value: 'CHK-100200' },
    });

    const submitBtn = screen.getByTestId('btn-confirm-fund');
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('sop-client-fund-confirm-checkbox'));
    expect(submitBtn).toBeEnabled();
  });

  it('requires SOP Step 2.5 confirmation checkbox before releasing funds for a Client Fund disbursement without Paid invoice', () => {
    const fundedClientFund: Disbursement = {
      id: 'disb-cf-3',
      disbursement_number: 'DISB-ATA-20261029-003',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Filing Fee',
      description: 'Registry of Deeds Fee',
      amount: 15000,
      source_of_funds: 'Client Fund',
      status: 'Funded',
      lifecycle_version: 2,
      payment_method: 'Check',
      payment_reference: 'CHK-555',
      payment_date: '2026-10-29',
      version: 3,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    const { wrapper } = createHarness();
    render(
      <ReleaseFundsModal
        isOpen={true}
        disbursement={fundedClientFund}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('sop-client-fund-gate')).toBeInTheDocument();
    const submitBtn = screen.getByTestId('submit-release-funds-btn');
    expect(submitBtn).toBeDisabled();

    fireEvent.click(screen.getByTestId('sop-client-fund-confirm-checkbox'));
    expect(submitBtn).toBeEnabled();
  });

  it('renders human-readable invoice, transmittal, and task numbers in DisbursementCodingGrid', () => {
    const disbWithSummaries: Disbursement = {
      id: 'disb-grid-1',
      disbursement_number: 'DISB-ATA-20261029-009',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Transportation',
      description: 'Courier Delivery to BIR',
      amount: 450,
      source_of_funds: 'Firm Fund',
      status: 'Released',
      work_request_id: 'wr-1',
      linked_task_id: 'task-uuid-1',
      linked_invoice_id: 'inv-uuid-1',
      linked_transmittal_id: 'trn-uuid-1',
      linked_task_summary: {
        id: 'task-uuid-1',
        task_number: 'TSK-ATA-0042',
        title: 'Deliver BIR Registration Certificate',
        status: 'In Progress',
      },
      linked_invoice_summary: {
        id: 'inv-uuid-1',
        invoice_number: 'INV-ATA-202610-088',
        status: 'Paid',
        total: 15000,
        amount_paid: 15000,
        balance: 0,
      },
      linked_transmittal_summary: {
        id: 'trn-uuid-1',
        tracking_number: 'ATA-TRN-20261029-077',
        status: 'Acknowledged',
        recipient_name: 'Acme Corp',
      },
      version: 1,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    const { wrapper } = createHarness();
    render(<DisbursementCodingGrid disbursement={disbWithSummaries} />, { wrapper });

    expect(screen.getByText(/TSK-ATA-0042/)).toBeInTheDocument();
    expect(screen.getByTestId(' coding-grid-invoice-transmittal'.trim())).toHaveTextContent(
      'INV-ATA-202610-088 / ATA-TRN-20261029-077'
    );
  });

  it('renders Linked Transmittal and Linked Disbursements table in InvoiceDetailModal', async () => {
    const mockInvoiceWithLinks: Invoice = {
      id: 'inv-links-1',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      invoice_number: 'INV-ATA-202610-100',
      client_id: 'c-1',
      work_request_id: 'wr-1',
      linked_transmittal_id: 'trn-100',
      linked_transmittal_summary: {
        id: 'trn-100',
        tracking_number: 'ATA-TRN-20261029-100',
        status: 'Sent',
        recipient_name: 'Metro Holdings',
      },
      linked_disbursements: [
        {
          id: 'disb-100',
          disbursement_number: 'DISB-ATA-20261029-100',
          category: 'Filing Fee',
          description: 'SEC Filing Fee Reimbursement',
          amount: 5500,
          status: 'Released',
          source_of_funds: 'Firm Fund',
        },
      ],
      issue_date: '2026-10-29',
      due_date: '2026-11-29',
      status: 'Issued',
      subtotal: 25500,
      total: 25500,
      amount_paid: 0,
      balance: 25500,
      version: 1,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
      clients: {
        name: 'Metro Holdings Inc.',
      },
      line_items: [
        {
          id: 'li-1',
          description: 'Filing Fee — SEC Filing Fee Reimbursement (DISB-ATA-20261029-100)',
          amount: 5500,
          type: 'Reimbursable Expense',
        },
      ],
      payments: [],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: mockInvoiceWithLinks }),
    } as Response);

    const { wrapper } = createHarness();
    render(
      <InvoiceDetailModal
        invoiceId="inv-links-1"
        isOpen={true}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('invoice-linked-transmittal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('invoice-linked-transmittal')).toHaveTextContent('ATA-TRN-20261029-100');
    expect(screen.getByTestId('invoice-linked-disbursements')).toBeInTheDocument();
    expect(screen.getByTestId('invoice-linked-disbursement-disb-100')).toHaveTextContent('DISB-ATA-20261029-100');
  });

  it('renders Linked Disbursements & Invoices and + Request Disbursement button in TransmittalDetailModal', async () => {
    const mockTransmittalWithLinks: Transmittal = {
      id: 'trn-links-1',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      tracking_number: 'ATA-TRN-20261029-200',
      client_id: 'c-1',
      work_request_id: 'wr-1',
      linked_task_id: 'task-1',
      status: 'Sent',
      approved: true,
      recipient_name: 'Maria Clara',
      recipient_details: 'Makati City',
      notes: 'Deliver via LBC',
      archived: false,
      version: 1,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
      items: [
        {
          id: 'ti-1',
          description: 'Official Receipt — DISB-ATA-20261029-200: LBC Courier Fee',
          document_type: 'Others',
          quantity: 1,
        },
      ],
      linked_disbursements: [
        {
          id: 'disb-200',
          disbursement_number: 'DISB-ATA-20261029-200',
          category: 'Transportation',
          description: 'LBC Courier Fee',
          amount: 350,
          status: 'Released',
        },
      ],
      linked_invoices: [
        {
          id: 'inv-200',
          invoice_number: 'INV-ATA-202610-200',
          status: 'Issued',
          total: 18000,
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: mockTransmittalWithLinks }),
    } as Response);

    const { wrapper } = createHarness();
    render(
      <TransmittalDetailModal
        transmittalId="trn-links-1"
        isOpen={true}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('transmittal-linked-records')).toBeInTheDocument();
    });
    expect(screen.getByTestId('transmittal-linked-disb-disb-200')).toHaveTextContent('DISB-ATA-20261029-200');
    expect(screen.getByTestId('transmittal-linked-invoice-inv-200')).toHaveTextContent('INV-ATA-202610-200');
    expect(screen.getByTestId('transmittal-request-disbursement-btn')).toBeInTheDocument();
  });

  it('renders Create Billing and Link Billing & Transmittal actions in DisbursementActionRail and opens prefilled InvoiceCreateModal / LinkBillingTransmittalModal', async () => {
    const unbilledDisb: Disbursement = {
      id: 'disb-rail-1',
      disbursement_number: 'DISB-ATA-20261029-301',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Filing Fee',
      description: 'SEC Amendment Filing Fee',
      amount: 6500,
      fund_source: 'Client Fund',
      source_of_funds: 'Client Fund',
      status: 'Approved',
      lifecycle_version: 2,
      linked_work_request_id: 'wr-301',
      client_id: 'c-301',
      linked_task_id: 'task-301',
      version: 2,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    const { wrapper } = createHarness();
    render(<DisbursementActionRail selectedDisbursement={unbilledDisb} />, { wrapper });

    const createBillingBtn = screen.getByTestId('rail-create-billing-btn');
    const linkRecordsBtn = screen.getByTestId('rail-link-billing-transmittal-btn');
    expect(createBillingBtn).toBeInTheDocument();
    expect(createBillingBtn).toBeEnabled();
    expect(createBillingBtn).toHaveTextContent('Create Billing');
    expect(linkRecordsBtn).toBeInTheDocument();

    // Open Link Billing & Transmittal modal first
    fireEvent.click(linkRecordsBtn);
    await waitFor(() => {
      expect(screen.getByTestId('link-billing-transmittal-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('modal-select-linked-invoice')).toBeInTheDocument();
    expect(screen.getByTestId('modal-select-linked-transmittal')).toBeInTheDocument();
    expect(screen.getByTestId('modal-create-billing-shortcut-btn')).toBeInTheDocument();

    // Click shortcut inside LinkBillingTransmittalModal to jump directly into Create Billing
    fireEvent.click(screen.getByTestId('modal-create-billing-shortcut-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('invoice-create-modal')).toBeInTheDocument();
    });
    expect(screen.getByTestId('attached-disbursement-banner')).toHaveTextContent(
      'Attached to Disbursement DISB-ATA-20261029-301'
    );
    expect(screen.getByTestId('line-item-desc-0')).toHaveValue(
      '[DISB-ATA-20261029-301] SEC Amendment Filing Fee'
    );
    expect(screen.getByTestId('line-item-amount-0')).toHaveValue(6500);
  });

  it('disables Create Billing button in DisbursementActionRail when voucher already has a linked invoice', () => {
    const linkedDisb: Disbursement = {
      id: 'disb-rail-2',
      disbursement_number: 'DISB-ATA-20261029-302',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Filing Fee',
      description: 'BIR Documentary Stamp Tax',
      amount: 12000,
      fund_source: 'Client Fund',
      status: 'Approved',
      lifecycle_version: 2,
      linked_work_request_id: 'wr-301',
      linked_invoice_id: 'inv-existing-301',
      version: 2,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    const { wrapper } = createHarness();
    render(<DisbursementActionRail selectedDisbursement={linkedDisb} />, { wrapper });

    const createBillingBtn = screen.getByTestId('rail-create-billing-btn');
    expect(createBillingBtn).toBeDisabled();
    expect(createBillingBtn).toHaveTextContent('Billing Linked');
    expect(screen.getByTestId('rail-link-billing-transmittal-btn')).toBeEnabled();
  });

  it('preserves enriched linked_invoice_summary on raw CDC UPDATE when FK is unchanged and invalidates when FK changes', () => {
    const { queryClient } = createHarness();
    const detailKey = disbursementKeys.detail('disb-cdc-1');
    const listKey = disbursementKeys.list({ page: 1 });

    const initialDisb: Disbursement = {
      id: 'disb-cdc-1',
      disbursement_number: 'DISB-ATA-20261029-401',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Filing Fee',
      description: 'SEC Filing Fee',
      amount: 5000,
      fund_source: 'Client Fund',
      status: 'Draft',
      lifecycle_version: 2,
      linked_invoice_id: 'inv-401',
      linked_invoice_number: 'INV-ATA-202610-401',
      linked_invoice_status: 'Sent',
      linked_invoice_summary: {
        id: 'inv-401',
        invoice_number: 'INV-ATA-202610-401',
        status: 'Sent',
        total_amount: 5000,
      },
      version: 1,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    queryClient.setQueryData(detailKey, initialDisb);
    queryClient.setQueryData(listKey, { data: [initialDisb] });

    // 1. Raw PostgreSQL CDC UPDATE where status changes to Approved, linked_invoice_id is still 'inv-401',
    // and raw payload omits API-joined linked_invoice_summary
    handleRealtimePayload(
      queryClient,
      { table: 'disbursements', activeEntity: 'ATA' },
      {
        eventType: 'UPDATE',
        new: {
          id: 'disb-cdc-1',
          entity_code: 'ATA',
          status: 'Approved',
          linked_invoice_id: 'inv-401',
          version: 2,
        },
        old: {
          id: 'disb-cdc-1',
          status: 'Draft',
          linked_invoice_id: 'inv-401',
          version: 1,
        },
      }
    );

    const afterStatusUpdate = queryClient.getQueryData<Disbursement>(detailKey);
    expect(afterStatusUpdate?.status).toBe('Approved');
    expect(afterStatusUpdate?.version).toBe(2);
    expect(afterStatusUpdate?.linked_invoice_summary?.invoice_number).toBe('INV-ATA-202610-401');
    expect(afterStatusUpdate?.linked_invoice_status).toBe('Sent');

    // 2. Raw PostgreSQL CDC UPDATE where linked_invoice_id is changed to 'inv-402'
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const mergeRes = mergeCdcRecordPreservingEnrichedLinks(
      'disbursements',
      afterStatusUpdate as unknown as Record<string, unknown>,
      {
        id: 'disb-cdc-1',
        linked_invoice_id: 'inv-402',
        version: 3,
      }
    );
    expect(mergeRes.linksChanged).toBe(true);
    expect(mergeRes.merged.linked_invoice_summary).toBeNull();

    handleRealtimePayload(
      queryClient,
      { table: 'disbursements', activeEntity: 'ATA' },
      {
        eventType: 'UPDATE',
        new: {
          id: 'disb-cdc-1',
          entity_code: 'ATA',
          status: 'Approved',
          linked_invoice_id: 'inv-402',
          version: 3,
        },
        old: {
          id: 'disb-cdc-1',
          status: 'Approved',
          linked_invoice_id: 'inv-401',
          version: 2,
        },
      }
    );

    const afterFkChange = queryClient.getQueryData<Disbursement>(detailKey);
    expect(afterFkChange?.linked_invoice_id).toBe('inv-402');
    expect(afterFkChange?.linked_invoice_summary).toBeNull();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: detailKey });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.lists() });
  });

  it('co-invalidates linked domains on Realtime CDC and BroadcastChannel tabSync events', () => {
    const { queryClient } = createHarness();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    expect(getDefaultDetailQueryKey('transmittals', 'tr-99')).toEqual(
      transmittalKeys.detail('tr-99')
    );
    expect(getDefaultListRootKey('transmittals')).toEqual(transmittalKeys.lists());

    // 1. CDC event on invoices co-invalidates disbursements & transmittals
    handleRealtimePayload(
      queryClient,
      { table: 'invoices', activeEntity: 'ATA' },
      {
        eventType: 'UPDATE',
        new: {
          id: 'inv-co-1',
          entity_code: 'ATA',
          status: 'Paid',
          version: 4,
        },
      }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: transmittalKeys.all });

    invalidateSpy.mockClear();

    // 1b. CDC event on disbursements co-invalidates billing & transmittals
    handleRealtimePayload(
      queryClient,
      { table: 'disbursements', activeEntity: 'ATA' },
      {
        eventType: 'UPDATE',
        new: {
          id: 'disb-co-1',
          entity_code: 'ATA',
          status: 'Released',
          version: 4,
        },
      }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: transmittalKeys.all });

    invalidateSpy.mockClear();

    // 2. TabSync ENTITY_MUTATED on billing co-invalidates disbursements & transmittals
    handleIncomingTabSyncMessage(queryClient, {
      type: 'ENTITY_MUTATED',
      domain: 'billing',
      entityId: 'inv-co-1',
      entityData: { id: 'inv-co-1', status: 'Paid', version: 4 },
      originTabId: 'other-tab',
      timestamp: Date.now(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['disbursements'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transmittals'] });

    invalidateSpy.mockClear();

    // 3. TabSync ENTITY_MUTATED on disbursements co-invalidates billing & transmittals
    handleIncomingTabSyncMessage(queryClient, {
      type: 'ENTITY_MUTATED',
      domain: 'disbursements',
      entityId: 'disb-co-1',
      entityData: { id: 'disb-co-1', linked_invoice_id: 'inv-co-1', version: 5 },
      originTabId: 'other-tab',
      timestamp: Date.now(),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['billing'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['transmittals'] });
  });

  it('reactively updates DisbursementActionRail when TanStack Query cache is patched via CDC while selectedDisbursement prop is static', async () => {
    const initialDisb: Disbursement = {
      id: 'disb-rail-live',
      disbursement_number: 'DISB-ATA-20261029-501',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Filing Fee',
      description: 'SEC Filing Fee Live Sync',
      amount: 4500,
      fund_source: 'Client Fund',
      status: 'Approved',
      lifecycle_version: 2,
      linked_work_request_id: 'wr-501',
      linked_invoice_id: null,
      version: 2,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    const { queryClient, wrapper } = createHarness();
    queryClient.setQueryData(disbursementKeys.detail('disb-rail-live'), initialDisb);

    render(<DisbursementActionRail selectedDisbursement={initialDisb} />, { wrapper });

    expect(screen.getByTestId('rail-create-billing-btn')).toBeEnabled();
    expect(screen.getByTestId('rail-create-billing-btn')).toHaveTextContent('Create Billing');

    // Simulate another user linking an invoice via Realtime CDC UPDATE (version 2 -> 3)
    act(() => {
      handleRealtimePayload(
        queryClient,
        { table: 'disbursements', activeEntity: 'ATA' },
        {
          eventType: 'UPDATE',
          new: {
            id: 'disb-rail-live',
            entity_code: 'ATA',
            status: 'Approved',
            linked_invoice_id: 'inv-live-501',
            version: 3,
          },
          old: {
            id: 'disb-rail-live',
            status: 'Approved',
            linked_invoice_id: null,
            version: 2,
          },
        }
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('rail-create-billing-btn')).toBeDisabled();
      expect(screen.getByTestId('rail-create-billing-btn')).toHaveTextContent('Billing Linked');
    });
  });

  it('surfaces ConflictResolutionModal when LinkBillingTransmittalModal encounters a 409 Concurrency Conflict', async () => {
    const disb: Disbursement = {
      id: 'disb-occ-1',
      disbursement_number: 'DISB-ATA-20261029-601',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      category: 'Filing Fee',
      description: 'OCC Conflict Voucher',
      amount: 3200,
      fund_source: 'Client Fund',
      status: 'Approved',
      lifecycle_version: 2,
      linked_work_request_id: 'wr-601',
      version: 2,
      created_at: '2026-10-29T08:00:00Z',
      updated_at: '2026-10-29T08:00:00Z',
    };

    window.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const u = String(url);
      if ((init?.method === 'PUT' || init?.method === 'PATCH') && u.includes('/disbursements/disb-occ-1')) {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: async () => ({
            error: {
              code: 'CONCURRENCY_CONFLICT',
              message: 'Disbursement was modified by another user (expected v2, current v3).',
            },
          }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(
      <LinkBillingTransmittalModal
        isOpen={true}
        disbursement={disb}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    fireEvent.click(screen.getByTestId('submit-link-billing-transmittal-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
    });
  });
});
