import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceEditModal } from '../components/InvoiceEditModal';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
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

const mockDraftInvoice: Invoice = {
  id: 'inv-edit-1',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-2026-0042',
  client_id: 'c-11111111-1111-1111-1111-111111111111',
  work_request_id: 'wr-11111111-1111-1111-1111-111111111111',
  linked_task_id: 'task-11111111-1111-1111-1111-111111111111',
  task_id: 'task-11111111-1111-1111-1111-111111111111',
  issue_date: '2026-10-17',
  due_date: '2026-11-17',
  status: 'Draft',
  subtotal: 25000,
  total: 25000,
  amount_paid: 5000,
  balance: 20000,
  address: '100 Ayala Avenue, Makati',
  notes: 'Quarterly compliance professional fee',
  terms: 'Net 30 days',
  version: 3,
  created_at: '2026-10-17T08:00:00Z',
  updated_at: '2026-10-17T08:00:00Z',
  clients: {
    name: 'Acme Philippines Corp',
    tin: '123-456-789-000',
    address: '100 Ayala Avenue, Makati',
  },
  line_items: [
    {
      id: 'li-1',
      description: 'Corporate Secretarial Services',
      amount: 15000,
      type: 'Professional Fee',
    },
    {
      id: 'li-2',
      description: 'SEC Statutory Filing Fees',
      amount: 10000,
      type: 'Government Fee',
    },
  ],
};

const mockNonDraftInvoice: Invoice = {
  ...mockDraftInvoice,
  id: 'inv-edit-2',
  invoice_number: 'ATA-SI-2026-0043',
  status: 'Sent',
  version: 4,
};

describe('InvoiceEditModal Component (R4 / D3)', () => {
  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:payments'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/clients')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: [{ id: 'c-11111111-1111-1111-1111-111111111111', name: 'Acme Philippines Corp' }],
          }),
        };
      }
      if (u.includes('/work-requests')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: [
              { id: 'wr-11111111-1111-1111-1111-111111111111', title: 'Corporate Retainer WR' },
            ],
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
  });

  it('renders prefilled form fields, line items, and live financial calculations', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={mockDraftInvoice} />, {
      wrapper,
    });

    expect(screen.getByTestId('invoice-edit-modal')).toBeInTheDocument();
    expect(screen.getByTestId('input-edit-invoice-number')).toHaveValue('ATA-SI-2026-0042');
    // DateInput displays formatted locale date (en-US MM/DD/YYYY)
    expect(screen.getByTestId('input-edit-issue-date')).toHaveValue('10/17/2026');
    expect(screen.getByTestId('input-edit-due-date')).toHaveValue('11/17/2026');

    // Line items prefilled
    expect(screen.getByTestId('line-item-desc-0')).toHaveValue('Corporate Secretarial Services');
    expect(screen.getByTestId('line-item-amount-0')).toHaveValue(15000);
    expect(screen.getByTestId('line-item-desc-1')).toHaveValue('SEC Statutory Filing Fees');
    expect(screen.getByTestId('line-item-amount-1')).toHaveValue(10000);

    // Initial totals calculation
    expect(screen.getByTestId('edit-calc-subtotal')).toHaveTextContent('₱25,000.00');
    expect(screen.getByTestId('edit-calc-total')).toHaveTextContent('₱25,000.00');
    expect(screen.getByTestId('edit-calc-balance')).toHaveTextContent('₱20,000.00');

    // Modify line item amount and check live recalculation
    fireEvent.change(screen.getByTestId('line-item-amount-0'), { target: { value: '20000' } });
    expect(screen.getByTestId('edit-calc-subtotal')).toHaveTextContent('₱30,000.00');
    expect(screen.getByTestId('edit-calc-total')).toHaveTextContent('₱30,000.00');
    expect(screen.getByTestId('edit-calc-balance')).toHaveTextContent('₱25,000.00');
  });

  it('supports dynamic line item operations: add, remove, and reorder', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={mockDraftInvoice} />, {
      wrapper,
    });

    // Add item
    fireEvent.click(screen.getByTestId('btn-add-line-item'));
    expect(screen.getByTestId('line-item-row-2')).toBeInTheDocument();

    // Type description and amount for new item
    fireEvent.change(screen.getByTestId('line-item-desc-2'), {
      target: { value: 'Documentary Stamp Tax' },
    });
    fireEvent.change(screen.getByTestId('line-item-amount-2'), { target: { value: '5000' } });

    expect(screen.getByTestId('edit-calc-total')).toHaveTextContent('₱30,000.00');

    // Remove middle item
    fireEvent.click(screen.getByTestId('btn-remove-item-1'));
    expect(screen.queryByTestId('line-item-row-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('line-item-desc-1')).toHaveValue('Documentary Stamp Tax');

    // Reorder: Move second item up
    fireEvent.click(screen.getByTestId('btn-move-up-1'));
    expect(screen.getByTestId('line-item-desc-0')).toHaveValue('Documentary Stamp Tax');
    expect(screen.getByTestId('line-item-desc-1')).toHaveValue('Corporate Secretarial Services');
  });

  it.each([false, true])(
    'allows admins to persist released invoice fields in modal/inline mode (%s)',
    async (inline) => {
      let payload: Record<string, unknown> | undefined;
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') {
          payload = JSON.parse(String(init.body));
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { ...mockNonDraftInvoice, version: 5 } }),
          };
        }
        return originalFetch(url, init);
      });
      const { wrapper } = createHarness();
      render(
        <InvoiceEditModal inline={inline} isOpen invoice={mockNonDraftInvoice} onClose={vi.fn()} />,
        { wrapper }
      );
      expect(screen.getByTestId('line-item-amount-0')).toBeEnabled();
      fireEvent.change(screen.getByTestId('line-item-amount-0'), { target: { value: '18000' } });
      fireEvent.change(screen.getByLabelText('Noted by'), { target: { value: 'R. Cruz' } });
      fireEvent.change(screen.getByLabelText('Prepared by'), { target: { value: 'M. Santos' } });
      fireEvent.change(screen.getByLabelText('Received by'), { target: { value: 'L. Tan' } });
      fireEvent.change(screen.getByLabelText('Bank / branch'), { target: { value: 'BDO Manila' } });
      fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));
      await waitFor(() => expect(payload).toBeDefined());
      expect(payload!.expectedVersion).toBe(4);
      expect(payload!.printDetails).toMatchObject({
        notedBy: 'R. Cruz',
        preparedBy: 'M. Santos',
        receivedBy: 'L. Tan',
        bankBranch: 'BDO Manila',
      });
      expect((payload!.lineItems as Array<{ amount: number }>)[0]!.amount).toBe(18000);
    }
  );

  it('restricts non-admin financial edits and line items on non-Draft invoices', async () => {
    useSessionStore.setState((state) => ({ user: { ...state.user!, role: 'Accounting' } }));
    const { wrapper } = createHarness();
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={mockNonDraftInvoice} />, {
      wrapper,
    });

    // Warning banner displayed
    expect(screen.getByTestId('non-draft-warning')).toBeInTheDocument();
    expect(screen.getByTestId('non-draft-warning')).toHaveTextContent(
      /Financial fields and line items can only be modified while invoice is in Draft status/i
    );

    // Financial inputs disabled
    expect(screen.getByTestId('input-edit-invoice-number')).toBeDisabled();
    expect(screen.getByTestId('input-edit-issue-date')).toBeDisabled();
    expect(screen.getByTestId('input-edit-due-date')).toBeDisabled();
    expect(screen.getByTestId('line-item-desc-0')).toBeDisabled();
    expect(screen.getByTestId('line-item-amount-0')).toBeDisabled();
    expect(screen.getByTestId('btn-add-line-item')).toBeDisabled();
    expect(screen.getByTestId('btn-save-invoice-edit')).toBeDisabled();
  });

  it('submits updated draft invoice with expectedVersion and OCC protection', async () => {
    let patchedBody: Record<string, unknown> | null = null;
    let patchedUrl = '';

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'PATCH' && u.includes('/invoices/inv-edit-1')) {
        patchedUrl = u;
        patchedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              ...mockDraftInvoice,
              version: 4,
              ...patchedBody,
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
    const onUpdated = vi.fn();
    const onClose = vi.fn();

    render(
      <InvoiceEditModal
        isOpen={true}
        onClose={onClose}
        invoice={mockDraftInvoice}
        onUpdated={onUpdated}
      />,
      { wrapper }
    );

    // Update note and first item
    fireEvent.change(screen.getByTestId('textarea-edit-notes'), {
      target: { value: 'Updated note for revised draft invoice' },
    });
    fireEvent.change(screen.getByTestId('line-item-desc-0'), {
      target: { value: 'General Retainer & Legal Advisory' },
    });
    fireEvent.change(screen.getByTestId('line-item-amount-0'), {
      target: { value: '18000' },
    });

    // Save
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => {
      expect(patchedBody).not.toBeNull();
    });

    expect(patchedUrl).toContain('/invoices/inv-edit-1');
    expect(patchedBody!.expectedVersion).toBe(3); // Version from invoice
    expect(patchedBody!.notes).toBe('Updated note for revised draft invoice');
    expect((patchedBody!.lineItems as Array<{ description: string }>)[0]!.description).toBe(
      'General Retainer & Legal Advisory'
    );
    expect(onClose).toHaveBeenCalled();
    expect(onUpdated).toHaveBeenCalled();
  });

  it('retains user form modifications on HTTP 409 concurrency conflict and allows resolution', async () => {
    let callCount = 0;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'PATCH' && u.includes('/invoices/inv-edit-1')) {
        callCount++;
        if (callCount === 1) {
          // Trigger 409 Conflict
          return {
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/problem+json' }),
            json: async () => ({
              status: 409,
              title: 'Conflict',
              detail: 'Invoice was modified by another session.',
              code: 'ERR_CONCURRENCY_CONFLICT',
            }),
          };
        }
        // Second call succeeds
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              ...mockDraftInvoice,
              version: 4,
            },
          }),
        };
      }
      if (u.includes('/invoices/inv-edit-1')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              ...mockDraftInvoice,
              version: 4,
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
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={mockDraftInvoice} />, {
      wrapper,
    });

    // Modify a line item
    fireEvent.change(screen.getByTestId('line-item-desc-0'), {
      target: { value: 'My Unsaved Modification' },
    });

    // Try save -> triggers 409
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('edit-conflict-alert')).toBeInTheDocument();
    });

    // CRITICAL REQUIREMENT: User modifications MUST NOT be wiped out
    expect(screen.getByTestId('line-item-desc-0')).toHaveValue('My Unsaved Modification');
  });

  it('integrates with InvoiceDetailModal via Edit Invoice button for Draft status', async () => {
    const { wrapper } = createHarness();
    render(
      <InvoiceDetailModal isOpen={true} onClose={() => {}} initialInvoice={mockDraftInvoice} />,
      { wrapper }
    );

    // Edit button visible for Draft invoice
    const editBtn = screen.getByTestId('btn-edit-invoice');
    expect(editBtn).toBeInTheDocument();

    // Click opens InvoiceEditModal
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByTestId('invoice-edit-modal')).toBeInTheDocument();
      expect(screen.getByTestId('input-edit-invoice-number')).toHaveValue('ATA-SI-2026-0042');
    });
  });

  it('unrelated save sends {} and does not materialize inherited automatic print values', async () => {
    let payload: Record<string, unknown> | null = null;
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes('/invoices/inv-edit-1') && opts?.method === 'PATCH') {
        payload = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockDraftInvoice, ...payload, version: 2 } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: mockDraftInvoice }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={mockDraftInvoice} />, {
      wrapper,
    });

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Updated audit notes' } });
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => expect(payload).not.toBeNull());
    expect((payload as unknown as { printDetails?: unknown })?.printDetails).toEqual({});
  });

  it('preserves existing custom and blank overrides when saving unrelated fields', async () => {
    let payload: Record<string, unknown> | null = null;
    const invoiceWithOverrides: Invoice = {
      ...mockDraftInvoice,
      print_details: {
        preparedBy: 'Elena Cruz',
        paymentDate: '',
      },
    };

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes('/invoices/inv-edit-1') && opts?.method === 'PATCH') {
        payload = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...invoiceWithOverrides, ...payload, version: 2 } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: invoiceWithOverrides }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={invoiceWithOverrides} />, {
      wrapper,
    });

    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Updated notes' } });
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => expect(payload).not.toBeNull());
    expect((payload as unknown as { printDetails?: unknown })?.printDetails).toEqual({
      preparedBy: 'Elena Cruz',
      paymentDate: '',
    });
  });

  it('resets an override to automatic and persists removal on save', async () => {
    let payload: Record<string, unknown> | null = null;
    const invoiceWithCustomCheck: Invoice = {
      ...mockDraftInvoice,
      payments: [
        {
          id: 'pay-1',
          invoice_id: mockDraftInvoice.id,
          amount: 500,
          method: 'Check',
          reference: 'CHK-LIVE-888',
          payment_date: '2026-10-25',
        },
      ],
      print_details: {
        checkNumber: 'OLD-CHECK-OVERRIDE',
        receivedBy: 'Elena Cruz',
      },
    };

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes('/invoices/inv-edit-1') && opts?.method === 'PATCH') {
        payload = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...invoiceWithCustomCheck, ...payload, version: 2 } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: invoiceWithCustomCheck }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={invoiceWithCustomCheck} />, {
      wrapper,
    });

    // Reset check number override
    const resetBtn = screen.getByRole('button', {
      name: /use automatic for date \/ check number/i,
    });
    fireEvent.click(resetBtn);

    // Value immediately reflects live automatic default
    expect(screen.getByLabelText('Date / check number')).toHaveValue('CHK-LIVE-888');

    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));
    await waitFor(() => expect(payload).not.toBeNull());
    expect((payload as unknown as { printDetails?: unknown })?.printDetails).toEqual({
      receivedBy: 'Elena Cruz',
    });
  });

  it('persists intentional blank override when field is deliberately cleared', async () => {
    let payload: Record<string, unknown> | null = null;
    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (String(url).includes('/invoices/inv-edit-1') && opts?.method === 'PATCH') {
        payload = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockDraftInvoice, ...payload, version: 2 } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: mockDraftInvoice }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(<InvoiceEditModal isOpen={true} onClose={() => {}} invoice={mockDraftInvoice} />, {
      wrapper,
    });

    // Explicitly clear Noted by (which defaults to HENRY WONG)
    fireEvent.change(screen.getByLabelText('Noted by'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => expect(payload).not.toBeNull());
    expect((payload as unknown as { printDetails?: unknown })?.printDetails).toEqual({
      notedBy: '',
    });
  });
});
