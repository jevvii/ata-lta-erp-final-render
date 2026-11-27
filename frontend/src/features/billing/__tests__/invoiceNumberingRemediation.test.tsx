import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceCreateModal } from '../components/InvoiceCreateModal';
import { createInvoiceAction } from '../api/useBillingMutations';
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
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, { initialEntries: ['/billing'] }, children)
    );

  return { queryClient, wrapper };
}

const CLIENT_ATA_ID = '11111111-1111-4111-8111-111111111111';
const CLIENT_LTA_ID = '22222222-2222-4222-8222-222222222222';
const WR_ATA_ID = '33333333-3333-4333-8333-333333333331';
const WR_LTA_ID = '33333333-3333-4333-8333-333333333332';
const TASK_ATA_ID = '44444444-4444-4444-8444-444444444441';
const TASK_LTA_ID = '44444444-4444-4444-8444-444444444442';
const CURRENT_YEAR = new Date().getFullYear();

describe('InvoiceCreateModal — Authoritative Invoice Number Preview & Collision-Free Submit', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('displays the server-authoritative next invoice number even when GET /invoices returns empty (rogue/deleted 001 hidden)', async () => {
    const requestedUrls: string[] = [];

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method || 'GET';
      requestedUrls.push(`${method} ${u}`);

      if (u.includes('/invoices/next-number')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              invoiceNumber: `ATA-SI-${CURRENT_YEAR}-0002`,
              prefix: `ATA-SI-${CURRENT_YEAR}`,
              nextSequence: 2,
              entityCode: 'ATA',
            },
          }),
        } as Response);
      }

      if (u.includes('/invoices') && method === 'GET') {
        // Simulates rogue/soft-deleted 001 hidden from listInvoices
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [], meta: { total: 0, page: 1, limit: 100 } }),
        } as Response);
      }

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: CLIENT_ATA_ID, name: 'Acme ATA', entity: 'ATA' }] }),
        } as Response);
      }

      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: WR_ATA_ID, title: 'ATA Filing', client_id: CLIENT_ATA_ID, entity: 'ATA' }],
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
    render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    const input = screen.getByTestId('input-invoice-number') as HTMLInputElement;
    expect(input.readOnly).toBe(true);

    await waitFor(() => {
      expect(input.value).toBe(`ATA-SI-${CURRENT_YEAR}-0002`);
    });
    expect(requestedUrls.some((entry) => entry.includes('/invoices/next-number'))).toBe(true);
  });

  it('omits client-guessed invoiceNumber on POST /invoices so the backend allocates a collision-free ID atomically', async () => {
    let postedBody: Record<string, unknown> | null = null;
    const onClose = vi.fn();

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method || 'GET';

      if (u.includes('/invoices/next-number')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              invoiceNumber: `ATA-SI-${CURRENT_YEAR}-0002`,
              prefix: `ATA-SI-${CURRENT_YEAR}`,
              nextSequence: 2,
              entityCode: 'ATA',
            },
          }),
        } as Response);
      }

      if (u.includes('/invoices') && method === 'POST') {
        postedBody = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              id: 'inv-created-2',
              invoice_number: `ATA-SI-${CURRENT_YEAR}-0002`,
              status: 'Draft',
              total: 15000,
              balance: 15000,
              version: 1,
            },
          }),
        } as Response);
      }

      if (u.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: TASK_ATA_ID,
                work_request_id: WR_ATA_ID,
                title: 'Prepare Billing',
                status: 'In Progress',
              },
            ],
          }),
        } as Response);
      }

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: CLIENT_ATA_ID, name: 'Acme ATA', entity: 'ATA' }] }),
        } as Response);
      }

      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: WR_ATA_ID, title: 'ATA Filing', client_id: CLIENT_ATA_ID, entity: 'ATA' }],
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
      <InvoiceCreateModal
        isOpen={true}
        onClose={onClose}
        prefill={{
          clientId: CLIENT_ATA_ID,
          workRequestId: WR_ATA_ID,
          taskId: TASK_ATA_ID,
        }}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect((screen.getByTestId('input-invoice-number') as HTMLInputElement).value).toBe(
        `ATA-SI-${CURRENT_YEAR}-0002`
      );
    });

    fireEvent.click(screen.getByTestId('btn-submit-invoice'));

    await waitFor(() => {
      expect(postedBody).not.toBeNull();
    });

    // Must NOT submit a hardcoded/client-guessed invoiceNumber that can collide on 001
    expect(postedBody!.invoiceNumber).toBeUndefined();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('updates the preview invoice number to LTA when activeEntity is ALL and an LTA work request is selected', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: '00000000-0000-4000-a000-000000000001',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ALL',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);

      if (u.includes('/invoices/next-number')) {
        const isLta = u.includes('entity=LTA') || u.includes(`workRequestId=${WR_LTA_ID}`) || u.includes(`clientId=${CLIENT_LTA_ID}`);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              invoiceNumber: isLta
                ? `LTA-SI-${CURRENT_YEAR}-0004`
                : `ATA-SI-${CURRENT_YEAR}-0002`,
              prefix: isLta ? `LTA-SI-${CURRENT_YEAR}` : `ATA-SI-${CURRENT_YEAR}`,
              nextSequence: isLta ? 4 : 2,
              entityCode: isLta ? 'LTA' : 'ATA',
            },
          }),
        } as Response);
      }

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: CLIENT_ATA_ID, name: 'Acme ATA', entity: 'ATA' },
              { id: CLIENT_LTA_ID, name: 'Beta LTA', entity: 'LTA' },
            ],
          }),
        } as Response);
      }

      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: WR_ATA_ID, title: 'ATA Audit', client_id: CLIENT_ATA_ID, entity: 'ATA' },
              { id: WR_LTA_ID, title: 'LTA Retainer', client_id: CLIENT_LTA_ID, entity: 'LTA' },
            ],
          }),
        } as Response);
      }

      if (u.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: TASK_LTA_ID,
                work_request_id: WR_LTA_ID,
                title: 'LTA Task',
                status: 'In Progress',
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

    const { wrapper } = createHarness();
    render(
      <InvoiceCreateModal
        isOpen={true}
        onClose={vi.fn()}
        prefill={{
          clientId: CLIENT_LTA_ID,
          workRequestId: WR_LTA_ID,
          taskId: TASK_LTA_ID,
        }}
      />,
      { wrapper }
    );

    const input = screen.getByTestId('input-invoice-number') as HTMLInputElement;
    await waitFor(() => {
      expect(input.value).toBe(`LTA-SI-${CURRENT_YEAR}-0004`);
    });
  });

  it('uses a clean blocking status message when invoiceNumber is omitted in createInvoiceAction', async () => {
    let observedMessage = '';
    const unsub = useBlockingModalStore.subscribe((state) => {
      if (state.message) observedMessage = state.message;
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        data: {
          id: 'inv-auto-1',
          invoice_number: `ATA-SI-${CURRENT_YEAR}-0002`,
          status: 'Draft',
        },
      }),
    } as Response);

    try {
      await createInvoiceAction(
        {
          clientId: CLIENT_ATA_ID,
          workRequestId: WR_ATA_ID,
          linkedTaskId: TASK_ATA_ID,
          issueDate: `${CURRENT_YEAR}-11-01`,
          dueDate: `${CURRENT_YEAR}-12-01`,
          status: 'Draft',
          lineItems: [{ description: 'Advisory', amount: 10000, type: 'Professional Fee' }],
        },
        'ATA'
      );
    } finally {
      unsub();
    }

    expect(observedMessage).not.toContain('undefined');
    expect(observedMessage).toContain('1 line item(s)');
  });
});
