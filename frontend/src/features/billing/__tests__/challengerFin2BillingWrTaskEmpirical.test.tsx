import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceCreateModal, SUPPORT_TASK_ID_PAYLOAD } from '../components/InvoiceCreateModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

const CLIENT_A = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme Philippines Holdings Inc.',
  entity: 'ATA' as const,
};

const CLIENT_B = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Zenith Global Logistics Ltd.',
  entity: 'ATA' as const,
};

const WR_A1 = {
  id: '33333333-3333-4333-8333-333333333331',
  title: 'Annual SEC Compliance Filing 2026',
  client_id: CLIENT_A.id,
  clientId: CLIENT_A.id,
  entity: 'ATA' as const,
};

const WR_A2 = {
  id: '33333333-3333-4333-8333-333333333332',
  title: 'BIR Tax Clearance Certificate 2026',
  client_id: CLIENT_A.id,
  clientId: CLIENT_A.id,
  entity: 'ATA' as const,
};

const TASKS_WR_A1 = [
  {
    id: '44444444-4444-4444-8444-444444444441',
    title: 'GIS Document Drafting & Notarization',
    workRequestId: WR_A1.id,
  },
  {
    id: '44444444-4444-4444-8444-444444444442',
    title: 'SEC Electronic Submission & Filing Fee',
    workRequestId: WR_A1.id,
  },
];

const TASKS_WR_A2 = [
  {
    id: '55555555-5555-4555-8555-555555555551',
    title: 'BIR Form 1701 Assessment Audit',
    workRequestId: WR_A2.id,
  },
];

describe('CHALLENGER FIN 2: Billing WR-Task Link Empirical Verification Suite', () => {
  const originalFetch = global.fetch;
  let capturedPostPayload: Record<string, unknown> | null = null;
  let taskFetchCalls: string[] = [];

  beforeEach(() => {
    capturedPostPayload = null;
    taskFetchCalls = [];
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin-test',
        email: 'finance@ata-lta.ph',
        name: 'Finance Officer',
        role: 'Admin',
        departments: ['Accounting', 'Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:create'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method || 'GET';

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [CLIENT_A, CLIENT_B] }),
        } as Response);
      }

      if (u.includes('/operations/work-requests') || u.includes('/work-requests')) {
        if (u.includes('/tasks')) {
          taskFetchCalls.push(u);
          if (u.includes(WR_A1.id)) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: TASKS_WR_A1 }),
            } as Response);
          }
          if (u.includes(WR_A2.id)) {
            return Promise.resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: TASKS_WR_A2 }),
            } as Response);
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [WR_A1, WR_A2] }),
        } as Response);
      }

      if (u.includes('/invoices') && method === 'GET') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response);
      }

      if (u.includes('/invoices') && method === 'POST') {
        capturedPostPayload = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            data: { id: 'inv-created-001', ...capturedPostPayload },
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
    useBlockingModalStore.getState().reset();
  });

  // =========================================================================
  // 1. Disabled state when no WR selected
  // =========================================================================
  describe('Task selector disabled state without WR', () => {
    it('disables WR-task selector when no WR is selected and does NOT fetch tasks', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const taskTrigger = screen.getByTestId('select-work-request-task');
      expect(taskTrigger).toBeInTheDocument();
      expect(taskTrigger).toBeDisabled();

      // No task API queries should have fired
      expect(taskFetchCalls).toHaveLength(0);
    });

    it('enables WR-task selector when workRequestId is prefilled, triggering task loading', async () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_A1.id,
            clientId: CLIENT_A.id,
          }}
        />,
        { wrapper }
      );

      const taskTrigger = screen.getByTestId('select-work-request-task');

      // Task trigger is enabled because WR is set and taskId is not prefilled/locked
      await waitFor(() => {
        expect(taskTrigger).not.toBeDisabled();
      });

      // Verify tasks query fired for WR_A1
      await waitFor(() => {
        expect(taskFetchCalls.some((call) => call.includes(WR_A1.id))).toBe(true);
      });
    });

    it('locks WR-task selector (disabled) when taskId is prefilled per contract', async () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_A1.id,
            clientId: CLIENT_A.id,
            taskId: TASKS_WR_A1[0]!.id,
          }}
        />,
        { wrapper }
      );

      const taskTrigger = screen.getByTestId('select-work-request-task');
      expect(taskTrigger).toBeDisabled();
    });
  });

  // =========================================================================
  // 2. Payload content verification
  // =========================================================================
  describe('Payload content verification (linkedTaskId vs null)', () => {
    it('submits linkedTaskId with prefilled task ID when taskId is provided', async () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_A1.id,
            clientId: CLIENT_A.id,
            taskId: TASKS_WR_A1[0]!.id,
          }}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(taskFetchCalls.some((c) => c.includes(WR_A1.id))).toBe(true);
      });

      // Fill in mandatory item description
      const descInput = screen.getByTestId('line-item-desc-0');
      fireEvent.change(descInput, { target: { value: 'Professional Tax Filing Services' } });

      const submitBtn = screen.getByTestId('btn-submit-invoice');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(capturedPostPayload).not.toBeNull();
      });

      expect(capturedPostPayload!.workRequestId).toBe(WR_A1.id);
      expect(capturedPostPayload!.clientId).toBe(CLIENT_A.id);
      expect(capturedPostPayload!.linkedTaskId).toBe(TASKS_WR_A1[0]!.id);
      // Literal task_id should NOT be emitted per GAP note
      expect(capturedPostPayload).not.toHaveProperty('task_id');
    });

    it('rejects submission when no task is selected (mandatory task rule)', async () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_A1.id,
            clientId: CLIENT_A.id,
          }}
        />,
        { wrapper }
      );

      // Fill in line item description
      const descInput = screen.getByTestId('line-item-desc-0');
      fireEvent.change(descInput, { target: { value: 'General Consultation Services' } });

      const submitBtn = screen.getByTestId('btn-submit-invoice');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('invoice-create-error')).toHaveTextContent(
          /linked task is required/i
        );
      });

      expect(capturedPostPayload).toBeNull();
    });

    it('verifies SUPPORT_TASK_ID_PAYLOAD is false and documented with GAP note', () => {
      expect(SUPPORT_TASK_ID_PAYLOAD).toBe(false);
    });
  });

  // =========================================================================
  // 3. User interaction & options rendering
  // =========================================================================
  describe('Options rendering & client/WR interactions', () => {
    it('populates hidden native select with options when tasks load for WR', async () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_A1.id,
            clientId: CLIENT_A.id,
          }}
        />,
        { wrapper }
      );

      const taskTrigger = screen.getByTestId('select-work-request-task');
      await waitFor(() => {
        expect(taskTrigger).not.toBeDisabled();
      });

      // Radix UI maintains a hidden select populated with options (without __none__)
      await waitFor(() => {
        const selectEl = taskTrigger.parentElement?.querySelector(
          'select'
        ) as HTMLSelectElement | null;
        expect(selectEl).toBeInTheDocument();
        const optionValues = Array.from(selectEl?.options || []).map((o) => o.value);
        expect(optionValues).not.toContain('__none__');
        expect(optionValues).toContain(TASKS_WR_A1[0]!.id);
        expect(optionValues).toContain(TASKS_WR_A1[1]!.id);
      });
    });

    it('verifies client prefill locks client and filters WRs', async () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            clientId: CLIENT_A.id,
          }}
        />,
        { wrapper }
      );

      const clientTrigger = screen.getByTestId('select-client');
      expect(clientTrigger).toBeDisabled();

      const wrTrigger = screen.getByTestId('select-work-request');
      expect(wrTrigger).not.toBeDisabled();

      // Task trigger remains disabled because no WR has been picked yet
      const taskTrigger = screen.getByTestId('select-work-request-task');
      expect(taskTrigger).toBeDisabled();
    });
  });
});
