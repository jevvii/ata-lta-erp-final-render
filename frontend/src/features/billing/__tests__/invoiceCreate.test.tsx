import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceCreateModal } from '../components/InvoiceCreateModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

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

const mockClients = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Acme Philippines Corp', entity: 'ATA' as const },
];

const mockWorkRequests = [
  { id: '22222222-2222-2222-2222-222222222222', title: 'Annual Tax Filing 2026', entity: 'ATA' as const },
];

describe('InvoiceCreateModal Component', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method || 'GET';

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockClients }),
        } as Response);
      }

      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockWorkRequests }),
        } as Response);
      }

      if (u.includes('/invoices') && method === 'POST') {
        const body = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              id: 'inv-new-1',
              ...body,
              total: body.lineItems.reduce((acc: number, item: { amount: number }) => acc + item.amount, 0),
              balance: body.lineItems.reduce((acc: number, item: { amount: number }) => acc + item.amount, 0),
            },
          }),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('renders creation form with initial line item and calculated total', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    expect(screen.getByTestId('invoice-create-modal')).toBeInTheDocument();
    expect(screen.getByTestId('input-invoice-number')).toBeInTheDocument();
    expect(screen.getByTestId('line-item-row-0')).toBeInTheDocument();

    // Default amount 15000 -> Calculated total is ₱15,000.00 (total = subtotal)
    expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱15,000.00');
  });

  it('supports dynamically adding, modifying, and removing line items', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    // Initial item has amount 15000
    const addBtn = screen.getByTestId('btn-add-line-item');
    fireEvent.click(addBtn);

    // Row 1 should exist
    expect(screen.getByTestId('line-item-row-1')).toBeInTheDocument();

    // Edit row 1 amount to 5000
    const amountInput1 = screen.getByTestId('line-item-amount-1');
    fireEvent.change(amountInput1, { target: { value: '5000' } });

    // Calculated total should update to 15000 + 5000 = ₱20,000.00
    expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱20,000.00');

    // Remove row 1
    const removeBtn1 = screen.getByTestId('btn-remove-item-1');
    fireEvent.click(removeBtn1);

    // Total returns to ₱15,000.00
    expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱15,000.00');
    expect(screen.queryByTestId('line-item-row-1')).not.toBeInTheDocument();
  });

  it('validates required fields before submitting to API', async () => {
    const { wrapper } = createHarness();
    render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    // Click submit without filling client or invoice number
    const submitBtn = screen.getByTestId('btn-submit-invoice');
    fireEvent.click(submitBtn);

    // Error alert should be displayed
    await waitFor(() => {
      expect(screen.getByTestId('invoice-create-error')).toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/invoices'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('renders optional WR-task selector and respects prefill contract with field locking (UAT2-6, UAT2-7)', async () => {
    const { wrapper } = createHarness();
    render(
      <InvoiceCreateModal
        isOpen={true}
        onClose={vi.fn()}
        prefill={{
          workRequestId: '22222222-2222-2222-2222-222222222222',
          clientId: '11111111-1111-1111-1111-111111111111',
          taskId: '33333333-3333-3333-3333-333333333333',
        }}
      />,
      { wrapper }
    );

    // Client, WR, and Task should be locked (disabled)
    const clientSelect = screen.getByTestId('select-client');
    const wrTrigger = screen.getByTestId('select-work-request');
    const taskTrigger = screen.getByTestId('select-work-request-task');

    expect(clientSelect).toBeDisabled();
    await waitFor(() => {
      expect(clientSelect).toHaveTextContent('Acme Philippines Corp');
    });
    expect(wrTrigger).toBeDisabled();
    expect(taskTrigger).toBeDisabled();
  });

  it('selecting a Work Request auto-detects Client AND selecting a Client filters Work Requests', async () => {
    const CLIENT_1 = { id: '11111111-1111-1111-1111-111111111111', name: 'Acme Philippines Corp', entity: 'ATA' as const };
    const CLIENT_2 = { id: '44444444-4444-4444-4444-444444444444', name: 'Beta Solutions Corp', entity: 'ATA' as const };
    const WR_1 = { id: '22222222-2222-2222-2222-222222222222', title: 'Annual Tax Filing 2026', client_id: CLIENT_1.id, entity: 'ATA' as const };
    const WR_2 = { id: '33333333-3333-3333-3333-333333333333', title: 'Consulting Retainer 2026', client_id: CLIENT_2.id, entity: 'ATA' as const };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [CLIENT_1, CLIENT_2] }),
        } as Response);
      }
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [WR_1, WR_2] }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      } as Response);
    });

    const { wrapper } = createHarness();
    render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    const clientSelect = screen.getByTestId('select-client');
    const wrTrigger = screen.getByTestId('select-work-request');

    // Both should be enabled when not prefilled
    expect(clientSelect).not.toBeDisabled();
    expect(wrTrigger).not.toBeDisabled();

    // 1. Selecting WR_1 auto-detects CLIENT_1
    fireEvent.keyDown(wrTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const wr1Opt = await screen.findByRole('option', { name: new RegExp(WR_1.title, 'i') });
    fireEvent.click(wr1Opt);

    await waitFor(() => {
      expect(clientSelect).toHaveTextContent(CLIENT_1.name);
    });

    // 2. Explicitly selecting CLIENT_2 filters WRs to WR_2
    fireEvent.keyDown(clientSelect, { key: 'ArrowDown', code: 'ArrowDown' });
    const client2Opt = await screen.findByRole('option', { name: new RegExp(CLIENT_2.name, 'i') });
    fireEvent.click(client2Opt);

    await waitFor(() => {
      expect(clientSelect).toHaveTextContent(CLIENT_2.name);
    });

    // Opening WR dropdown shows WR_2 but NOT WR_1
    fireEvent.keyDown(wrTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    expect(await screen.findByRole('option', { name: new RegExp(WR_2.title, 'i') })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: new RegExp(WR_1.title, 'i') })).not.toBeInTheDocument();
  });
});

