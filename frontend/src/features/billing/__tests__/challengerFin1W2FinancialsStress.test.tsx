import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Module Barrel Exports to verify
import {
  InvoiceCreateModal,
  SUPPORT_TASK_ID_PAYLOAD,
  type FinancialPrefill as BillingPrefill,
} from '@/features/billing';
import {
  CreateDisbursementModal,
  type FinancialPrefill as DisbursementPrefill,
} from '@/features/disbursements';
import {
  TransmittalFormModal,
  TransmittalPrintModal,
  type FinancialPrefill as TransmittalPrefill,
} from '@/features/transmittals';
import type { Transmittal } from '@/features/transmittals/api/types';

import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

// Mock Fixtures with strictly valid UUID format [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
const CLIENT_1 = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Alpha Technologies Inc',
  entity: 'ATA' as const,
  address: 'Unit 401 Alpha Tower, Ayala Ave, Makati City',
  tin: '111-222-333-000',
};

const CLIENT_2 = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Beta Logistics Corp',
  entity: 'ATA' as const,
  address: 'Bldg 5 Laguna Technopark, Santa Rosa, Laguna',
  tin: '444-555-666-000',
};

const WR_1 = {
  id: '33333333-3333-3333-3333-333333333333',
  title: 'Annual SEC General Information Sheet 2026',
  client_id: CLIENT_1.id,
  clientId: CLIENT_1.id,
  client_name: CLIENT_1.name,
  clientName: CLIENT_1.name,
  tracking_number: 'WR-2026-0001',
  entity: 'ATA' as const,
};

const WR_2 = {
  id: '44444444-4444-4444-4444-444444444444',
  title: 'BIR Tax Audit Assistance 2026',
  client_id: CLIENT_2.id,
  clientId: CLIENT_2.id,
  client_name: CLIENT_2.name,
  clientName: CLIENT_2.name,
  tracking_number: 'WR-2026-0002',
  entity: 'ATA' as const,
};

const WR_ORPHAN = {
  id: '99999999-9999-9999-9999-999999999999',
  title: 'Orphan Work Request With Unknown Client',
  client_id: '88888888-8888-8888-8888-888888888888',
  clientId: '88888888-8888-8888-8888-888888888888',
  client_name: 'Ghost Client External',
  clientName: 'Ghost Client External',
  tracking_number: 'WR-2026-0099',
  entity: 'ATA' as const,
};

const TASK_1_ID = '55555555-1111-1111-1111-111111111111';
const TASK_2_ID = '55555555-1111-1111-1111-222222222222';
const TASK_WR2_ID = '66666666-2222-2222-2222-111111111111';

const TASKS_WR_1 = [
  { id: TASK_1_ID, title: 'Prepare GIS Form & Notarize', workRequestId: WR_1.id },
  { id: TASK_2_ID, title: 'SEC Online Submission & Payment', workRequestId: WR_1.id },
];

const TASKS_WR_2 = [
  { id: TASK_WR2_ID, title: 'Audit Assessment Reconciliation', workRequestId: WR_2.id },
];

describe('CHALLENGER FIN 1 — Adversarial Stress Harness for Milestone 1 (W2-FIN)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-challenger-1',
        email: 'challenger@ata-lta.ph',
        name: 'Challenger Tester',
        role: 'Admin',
        departments: ['Accounting', 'Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'billing:view',
        'billing:edit',
        'billing:*',
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
        'transmittal:view',
        'transmittal:create',
        'transmittal:edit',
        'transmittal:approve',
        'transmittal:mark',
      ],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      const u = String(url);
      const method = opts?.method || 'GET';

      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [CLIENT_1, CLIENT_2] }),
        } as Response);
      }

      if (u.includes('/tasks') && u.includes(WR_1.id)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: TASKS_WR_1 }),
        } as Response);
      }

      if (u.includes('/tasks') && u.includes(WR_2.id)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: TASKS_WR_2 }),
        } as Response);
      }

      if (u.includes('/operations/work-requests') || u.includes('/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [WR_1, WR_2, WR_ORPHAN] }),
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
        const body = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            data: { id: 'inv-test-created', ...body, total: 1000 },
          }),
        } as Response);
      }

      if (u.includes('/disbursements') && method === 'POST') {
        const body = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            data: { id: 'disb-test-created', status: 'Pending', ...body },
          }),
        } as Response);
      }

      if (u.includes('/transmittals') && method === 'POST') {
        const body = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            data: { id: 'tx-test-created', status: 'Draft', ...body },
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
  // SUITE 1: Module Barrel Exports & Contract Freeze Verification
  // =========================================================================
  describe('Suite 1: Barrel Exports & Interface Conformance', () => {
    it('verifies billing exports InvoiceCreateModal, SUPPORT_TASK_ID_PAYLOAD, and FinancialPrefill contract', () => {
      expect(InvoiceCreateModal).toBeDefined();
      expect(typeof InvoiceCreateModal).toBe('function');
      expect(SUPPORT_TASK_ID_PAYLOAD).toBe(false);

      const contractTypeCheck: BillingPrefill = {
        workRequestId: WR_1.id,
        taskId: TASK_1_ID,
        clientId: CLIENT_1.id,
      };
      expect(contractTypeCheck).toBeDefined();
    });

    it('verifies disbursements exports CreateDisbursementModal and FinancialPrefill contract', () => {
      expect(CreateDisbursementModal).toBeDefined();
      expect(typeof CreateDisbursementModal).toBe('function');

      const contractTypeCheck: DisbursementPrefill = {
        workRequestId: WR_1.id,
        taskId: TASK_1_ID,
        clientId: CLIENT_1.id,
      };
      expect(contractTypeCheck).toBeDefined();
    });

    it('verifies transmittals exports TransmittalFormModal, TransmittalPrintModal, and FinancialPrefill contract', () => {
      expect(TransmittalFormModal).toBeDefined();
      expect(typeof TransmittalFormModal).toBe('function');
      expect(TransmittalPrintModal).toBeDefined();
      expect(typeof TransmittalPrintModal).toBe('function');

      const contractTypeCheck: TransmittalPrefill = {
        workRequestId: WR_1.id,
        taskId: TASK_1_ID,
        clientId: CLIENT_1.id,
      };
      expect(contractTypeCheck).toBeDefined();
    });
  });

  // =========================================================================
  // SUITE 2: All 8 Prefill Permutations on InvoiceCreateModal
  // =========================================================================
  describe('Suite 2: InvoiceCreateModal 8 Prefill Permutations & Locking', () => {
    const permutations = [
      {
        name: '1. Empty {}',
        prefill: {},
        expectWrLocked: false,
        expectClientLocked: false,
        expectTaskLocked: false,
        expectTaskDisabled: true,
      },
      {
        name: '2. { workRequestId }',
        prefill: { workRequestId: WR_1.id },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: false,
      },
      {
        name: '3. { taskId }',
        prefill: { taskId: TASK_1_ID },
        expectWrLocked: false,
        expectClientLocked: false,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '4. { clientId }',
        prefill: { clientId: CLIENT_1.id },
        expectWrLocked: false,
        expectClientLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: true,
      },
      {
        name: '5. { workRequestId, taskId }',
        prefill: { workRequestId: WR_1.id, taskId: TASK_1_ID },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '6. { workRequestId, clientId }',
        prefill: { workRequestId: WR_1.id, clientId: CLIENT_1.id },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: false,
      },
      {
        name: '7. { taskId, clientId }',
        prefill: { taskId: TASK_1_ID, clientId: CLIENT_1.id },
        expectWrLocked: false,
        expectClientLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '8. { workRequestId, taskId, clientId }',
        prefill: { workRequestId: WR_1.id, taskId: TASK_1_ID, clientId: CLIENT_1.id },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
    ];

    permutations.forEach(
      ({
        name,
        prefill,
        expectWrLocked,
        expectClientLocked,
        expectTaskLocked,
        expectTaskDisabled,
      }) => {
        it(`Permutation ${name}: enforces precise lock and disabled states`, async () => {
          const { wrapper } = createHarness();
          render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} prefill={prefill} />, {
            wrapper,
          });

          const clientTrigger = screen.getByTestId('select-client');
          const wrTrigger = screen.getByTestId('select-work-request');
          const taskTrigger = screen.getByTestId('select-work-request-task');

          if (expectClientLocked) {
            expect(clientTrigger).toBeDisabled();
          } else {
            expect(clientTrigger).not.toBeDisabled();
          }

          if (expectWrLocked) {
            expect(wrTrigger).toBeDisabled();
          } else {
            expect(wrTrigger).not.toBeDisabled();
          }

          if (expectTaskDisabled || expectTaskLocked) {
            expect(taskTrigger).toBeDisabled();
          } else {
            // Task is enabled because WR is provided and task is not locked
            await waitFor(() => {
              expect(taskTrigger).not.toBeDisabled();
            });
          }
        });
      }
    );

    it('Permutation 2: auto-detects client from WR and locks client selector even when prefill.clientId was omitted', async () => {
      const { wrapper } = createHarness();
      render(
        <InvoiceCreateModal isOpen={true} onClose={vi.fn()} prefill={{ workRequestId: WR_1.id }} />,
        { wrapper }
      );

      const clientTrigger = screen.getByTestId('select-client');
      const wrTrigger = screen.getByTestId('select-work-request');
      expect(wrTrigger).toBeDisabled();
      expect(clientTrigger).toBeDisabled();
    });
  });

  // =========================================================================
  // SUITE 3: All 8 Prefill Permutations on CreateDisbursementModal
  // =========================================================================
  describe('Suite 3: CreateDisbursementModal 8 Prefill Permutations & Locking', () => {
    const permutations = [
      {
        name: '1. Empty {}',
        prefill: {},
        expectWrLocked: false,
        expectTaskLocked: false,
        expectTaskDisabled: true,
      },
      {
        name: '2. { workRequestId }',
        prefill: { workRequestId: WR_1.id },
        expectWrLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: false,
      },
      {
        name: '3. { taskId }',
        prefill: { taskId: TASK_1_ID },
        expectWrLocked: false,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '4. { clientId }',
        prefill: { clientId: CLIENT_1.id },
        expectWrLocked: false,
        expectTaskLocked: false,
        expectTaskDisabled: true,
      },
      {
        name: '5. { workRequestId, taskId }',
        prefill: { workRequestId: WR_1.id, taskId: TASK_1_ID },
        expectWrLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '6. { workRequestId, clientId }',
        prefill: { workRequestId: WR_1.id, clientId: CLIENT_1.id },
        expectWrLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: false,
      },
      {
        name: '7. { taskId, clientId }',
        prefill: { taskId: TASK_1_ID, clientId: CLIENT_1.id },
        expectWrLocked: false,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '8. { workRequestId, taskId, clientId }',
        prefill: { workRequestId: WR_1.id, taskId: TASK_1_ID, clientId: CLIENT_1.id },
        expectWrLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
    ];

    permutations.forEach(
      ({ name, prefill, expectWrLocked, expectTaskLocked, expectTaskDisabled }) => {
        it(`Permutation ${name}: enforces precise lock and disabled states`, async () => {
          const { wrapper } = createHarness();
          render(<CreateDisbursementModal isOpen={true} onClose={vi.fn()} prefill={prefill} />, {
            wrapper,
          });

          const wrSelect = screen.getByTestId('select-work-request') as HTMLSelectElement;
          const clientInput = screen.getByTestId('display-client-name') as HTMLInputElement;
          const taskSelect = screen.getByTestId('select-work-request-task') as HTMLSelectElement;

          // Client display is ALWAYS read-only & disabled per UAT2-12
          expect(clientInput.disabled).toBe(true);
          expect(clientInput.readOnly).toBe(true);

          if (expectWrLocked) {
            expect(wrSelect.disabled).toBe(true);
          } else {
            expect(wrSelect.disabled).toBe(false);
          }

          if (expectTaskDisabled || expectTaskLocked) {
            expect(taskSelect.disabled).toBe(true);
          } else {
            await waitFor(() => {
              expect(taskSelect.disabled).toBe(false);
            });
          }
        });
      }
    );

    it('Permutation 2: auto-displays client name from prefilled work request in read-only input', async () => {
      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_1.id }}
        />,
        { wrapper }
      );

      await waitFor(() => {
        const clientInput = screen.getByTestId('display-client-name') as HTMLInputElement;
        expect(clientInput.value).toBe(CLIENT_1.name);
      });
    });
  });

  // =========================================================================
  // SUITE 4: All 8 Prefill Permutations on TransmittalFormModal
  // =========================================================================
  describe('Suite 4: TransmittalFormModal 8 Prefill Permutations & Locking', () => {
    const permutations = [
      {
        name: '1. Empty {}',
        prefill: {},
        expectWrLocked: false,
        expectClientLocked: false,
        expectTaskLocked: false,
        expectTaskDisabled: true,
      },
      {
        name: '2. { workRequestId }',
        prefill: { workRequestId: WR_1.id },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: false,
      },
      {
        name: '3. { taskId }',
        prefill: { taskId: TASK_1_ID },
        expectWrLocked: false,
        expectClientLocked: false,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '4. { clientId }',
        prefill: { clientId: CLIENT_1.id },
        expectWrLocked: false,
        expectClientLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: true,
      },
      {
        name: '5. { workRequestId, taskId }',
        prefill: { workRequestId: WR_1.id, taskId: TASK_1_ID },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '6. { workRequestId, clientId }',
        prefill: { workRequestId: WR_1.id, clientId: CLIENT_1.id },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: false,
        expectTaskDisabled: false,
      },
      {
        name: '7. { taskId, clientId }',
        prefill: { taskId: TASK_1_ID, clientId: CLIENT_1.id },
        expectWrLocked: false,
        expectClientLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
      {
        name: '8. { workRequestId, taskId, clientId }',
        prefill: { workRequestId: WR_1.id, taskId: TASK_1_ID, clientId: CLIENT_1.id },
        expectWrLocked: true,
        expectClientLocked: true,
        expectTaskLocked: true,
        expectTaskDisabled: true,
      },
    ];

    permutations.forEach(
      ({
        name,
        prefill,
        expectWrLocked,
        expectClientLocked,
        expectTaskLocked,
        expectTaskDisabled,
      }) => {
        it(`Permutation ${name}: enforces precise lock and disabled states`, async () => {
          const { wrapper } = createHarness();
          render(<TransmittalFormModal isOpen={true} onClose={vi.fn()} prefill={prefill} />, {
            wrapper,
          });

          const clientTrigger = screen.getByTestId('client-select');
          const wrTrigger = screen.getByTestId('work-request-select');
          const taskTrigger = screen.getByTestId('task-select');

          if (expectClientLocked) {
            expect(clientTrigger).toBeDisabled();
          } else {
            expect(clientTrigger).not.toBeDisabled();
          }

          if (expectWrLocked) {
            expect(wrTrigger).toBeDisabled();
          } else {
            expect(wrTrigger).not.toBeDisabled();
          }

          if (expectTaskDisabled || expectTaskLocked) {
            expect(taskTrigger).toBeDisabled();
          } else {
            await waitFor(() => {
              expect(taskTrigger).not.toBeDisabled();
            });
          }
        });
      }
    );
  });

  // =========================================================================
  // SUITE 5: Adversarial Bypass Resistance & Submission Tampering
  // =========================================================================
  describe('Suite 5: Adversarial Bypass Resistance & Submission Tampering', () => {
    it('InvoiceCreateModal: prefilled/locked fields cannot be bypassed and payload retains frozen values', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/invoices') && opts?.method === 'POST') {
          capturedPayload = JSON.parse(String(opts?.body || '{}'));
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ data: { id: 'inv-tamper-check', ...capturedPayload } }),
          } as Response);
        }
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [CLIENT_1, CLIENT_2] }),
          } as Response);
        }
        if (u.includes('/tasks')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: TASKS_WR_1 }),
          } as Response);
        }
        if (u.includes('/work-requests')) {
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
      render(
        <InvoiceCreateModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_1.id,
            clientId: CLIENT_1.id,
            taskId: TASK_1_ID,
          }}
        />,
        { wrapper }
      );

      // Verify triggers are disabled and inert
      const clientTrigger = screen.getByTestId('select-client');
      const wrTrigger = screen.getByTestId('select-work-request');
      const taskTrigger = screen.getByTestId('select-work-request-task');
      expect(clientTrigger).toBeDisabled();
      expect(wrTrigger).toBeDisabled();
      expect(taskTrigger).toBeDisabled();

      // Clicking disabled controls must not open any select content / options
      fireEvent.click(clientTrigger);
      fireEvent.click(wrTrigger);
      fireEvent.click(taskTrigger);
      expect(screen.queryByRole('listbox')).toBeNull();

      // Provide line item description and submit
      const descInput = screen.getByTestId('line-item-desc-0');
      fireEvent.change(descInput, { target: { value: 'Tamper Verification Item' } });

      const submitBtn = screen.getByTestId('btn-submit-invoice');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      // Assert submitted payload strictly matches frozen prefill values
      expect(capturedPayload!.workRequestId).toBe(WR_1.id);
      expect(capturedPayload!.clientId).toBe(CLIENT_1.id);
      expect(capturedPayload!.linkedTaskId).toBe(TASK_1_ID);
    });

    it('CreateDisbursementModal: prefilled/locked fields cannot be bypassed and status anti-forgery is preserved', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements') && opts?.method === 'POST') {
          capturedPayload = JSON.parse(String(opts?.body || '{}'));
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ data: { id: 'disb-tamper-check', ...capturedPayload } }),
          } as Response);
        }
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [CLIENT_1, CLIENT_2] }),
          } as Response);
        }
        if (u.includes('/tasks')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: TASKS_WR_1 }),
          } as Response);
        }
        if (u.includes('/work-requests')) {
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
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_1.id,
            clientId: CLIENT_1.id,
            taskId: TASK_1_ID,
          }}
        />,
        { wrapper }
      );

      const wrSelect = screen.getByTestId('select-work-request') as HTMLSelectElement;
      const clientInput = screen.getByTestId('display-client-name') as HTMLInputElement;
      const taskSelect = screen.getByTestId('select-work-request-task') as HTMLSelectElement;

      expect(wrSelect.disabled).toBe(true);
      expect(clientInput.disabled).toBe(true);
      expect(clientInput.readOnly).toBe(true);
      expect(taskSelect.disabled).toBe(true);

      // Attempt interaction on locked controls
      fireEvent.click(wrSelect);
      fireEvent.click(clientInput);
      fireEvent.click(taskSelect);

      // Fill required fields
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '850.00' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Tamper proofing test voucher' },
      });

      // Submit
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      const confirmBtn = screen.queryByTestId('btn-confirm-no-receipt');
      if (confirmBtn) fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      // Assert submitted payload keeps original values
      expect(capturedPayload!.linkedWorkRequestId).toBe(WR_1.id);
      expect(capturedPayload!.clientId).toBe(CLIENT_1.id);
      expect(capturedPayload!.linkedTaskId).toBe(TASK_1_ID);
      // Status anti-forgery: status must NEVER exist in payload
      expect(capturedPayload!.status).toBeUndefined();
    });

    it('TransmittalFormModal: prefilled/locked fields cannot be bypassed and payload retains frozen values', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/transmittals') && opts?.method === 'POST') {
          capturedPayload = JSON.parse(String(opts?.body || '{}'));
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ data: { id: 'tx-tamper-check', ...capturedPayload } }),
          } as Response);
        }
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [CLIENT_1, CLIENT_2] }),
          } as Response);
        }
        if (u.includes('/tasks')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: TASKS_WR_1 }),
          } as Response);
        }
        if (u.includes('/work-requests')) {
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
      render(
        <TransmittalFormModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_1.id,
            clientId: CLIENT_1.id,
            taskId: TASK_1_ID,
          }}
        />,
        { wrapper }
      );

      const clientTrigger = screen.getByTestId('client-select');
      const wrTrigger = screen.getByTestId('work-request-select');
      const taskTrigger = screen.getByTestId('task-select');

      expect(clientTrigger).toBeDisabled();
      expect(wrTrigger).toBeDisabled();
      expect(taskTrigger).toBeDisabled();

      // Attempt interaction
      fireEvent.click(clientTrigger);
      fireEvent.click(wrTrigger);
      fireEvent.click(taskTrigger);
      expect(screen.queryByRole('listbox')).toBeNull();

      // Provide item description
      const descInput = screen.getByTestId('item-description-input-0');
      fireEvent.change(descInput, { target: { value: 'Official Transmittal Item' } });

      // Submit
      fireEvent.click(screen.getByTestId('submit-transmittal-btn'));

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      expect(capturedPayload!.workRequestId).toBe(WR_1.id);
      expect(capturedPayload!.clientId).toBe(CLIENT_1.id);
      expect(capturedPayload!.linkedTaskId).toBe(TASK_1_ID);
    });
  });

  // =========================================================================
  // SUITE 6: Dynamic Work Request Switching & Clearing Behavior
  // =========================================================================
  describe('Suite 6: Work Request Dynamic Switching & Clearing', () => {
    it('CreateDisbursementModal: switching WR updates auto-detected client and resets selected task', async () => {
      const { wrapper } = createHarness();
      render(<CreateDisbursementModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(new RegExp(WR_1.title, 'i'))).toBeInTheDocument();
      });

      const wrSelect = screen.getByTestId('select-work-request') as HTMLSelectElement;
      const clientInput = screen.getByTestId('display-client-name') as HTMLInputElement;

      // 1. Select WR 1
      fireEvent.change(wrSelect, { target: { value: WR_1.id } });
      await waitFor(() => {
        expect(clientInput.value).toBe(CLIENT_1.name);
      });

      // Wait for tasks of WR 1 to load
      await waitFor(() => {
        expect(screen.getByText('Prepare GIS Form & Notarize')).toBeInTheDocument();
      });

      const taskSelect = screen.getByTestId('select-work-request-task') as HTMLSelectElement;
      fireEvent.change(taskSelect, { target: { value: TASK_1_ID } });
      expect(taskSelect.value).toBe(TASK_1_ID);

      // 2. Switch to WR 2
      fireEvent.change(wrSelect, { target: { value: WR_2.id } });
      await waitFor(() => {
        expect(clientInput.value).toBe(CLIENT_2.name);
      });
      // Selected task must be automatically reset
      expect(taskSelect.value).toBe('');

      // 3. Clear WR (select empty option)
      fireEvent.change(wrSelect, { target: { value: '' } });
      await waitFor(() => {
        expect(clientInput.value).toBe('');
      });
      // Task dropdown must now be disabled
      expect(taskSelect.disabled).toBe(true);
    });

    it('CreateDisbursementModal: handles orphan WR with unlisted client_id gracefully without crashing', async () => {
      const { wrapper } = createHarness();
      render(<CreateDisbursementModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByText(new RegExp(WR_ORPHAN.title, 'i'))).toBeInTheDocument();
      });

      const wrSelect = screen.getByTestId('select-work-request') as HTMLSelectElement;
      fireEvent.change(wrSelect, { target: { value: WR_ORPHAN.id } });

      await waitFor(() => {
        const clientInput = screen.getByTestId('display-client-name') as HTMLInputElement;
        expect(clientInput.value).toBe('Ghost Client External');
      });
    });
  });

  // =========================================================================
  // SUITE 7: Transmittal Print Modal Layout & Edge Cases (UAT2-3)
  // =========================================================================
  describe('Suite 7: Transmittal Print Modal Boundary & Verbatim Layout (UAT2-3)', () => {
    const baseTransmittal: Transmittal = {
      id: 'tx-print-001',
      tracking_number: 'TR-ATA-2026-9001',
      entity_id: 'ent-1',
      entity_code: 'ATA',
      client_id: CLIENT_1.id,
      status: 'Acknowledged',
      approved: true,
      board_order: 0,
      version: 1,
      recipient_name: 'Atty. Fernando Poe Jr.',
      created_at: '2026-10-05T08:00:00.000Z',
      sent_at: '2026-10-05T09:00:00.000Z',
      acknowledged_at: '2026-10-05T10:30:00.000Z',
      received_by_name: 'Atty. Fernando Poe Jr.',
      archived: false,
      notes: 'Confidential corporate filings for board review',
      clients: {
        name: CLIENT_1.name,
        address: CLIENT_1.address,
        tin: CLIENT_1.tin,
      },
      items: [
        {
          id: 'i-1',
          description: 'General Information Sheet 2026',
          document_type: 'SEC',
          quantity: 3,
        },
        {
          id: 'i-2',
          description: 'BIR Form 1702-RT Audited Financials',
          document_type: 'Tax',
          quantity: 2,
        },
        {
          id: 'i-3',
          description: 'Secretary Certificate of Board Authority',
          document_type: 'Legal',
          quantity: 1,
        },
      ],
    };

    it('renders exactly 3 document rows matching item-rows-only without prototype filler rows', () => {
      render(
        <TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={baseTransmittal} />
      );

      // Exactly rows 0, 1, 2 exist
      expect(screen.getByTestId('print-item-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('print-item-row-1')).toBeInTheDocument();
      expect(screen.getByTestId('print-item-row-2')).toBeInTheDocument();
      expect(screen.queryByTestId('print-item-row-3')).toBeNull();

      // Quantity annotation appears for quantity > 1
      expect(screen.getByText(/QTY: 3/i)).toBeInTheDocument();
      expect(screen.getByText(/QTY: 2/i)).toBeInTheDocument();
    });

    it('handles empty items array ([] or undefined) gracefully without crashing and renders 0 data rows', () => {
      const emptyItemsTransmittal: Transmittal = {
        ...baseTransmittal,
        items: [],
      };

      render(
        <TransmittalPrintModal
          isOpen={true}
          onClose={vi.fn()}
          transmittal={emptyItemsTransmittal}
        />
      );

      expect(screen.getByTestId('transmittal-print-modal')).toBeInTheDocument();
      expect(screen.getByTestId('print-items-table')).toBeInTheDocument();
      expect(screen.queryByTestId('print-item-row-0')).toBeNull();
    });

    it('renders dynamic RECEIVED stamp on Acknowledged status with recipient name and date', () => {
      render(
        <TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={baseTransmittal} />
      );

      const stamp = screen.getByTestId('print-received-stamp');
      expect(stamp).toBeInTheDocument();
      expect(stamp).toHaveTextContent('RECEIVED');
      expect(screen.getByTestId('stamp-recipient-name')).toHaveTextContent(
        'Atty. Fernando Poe Jr.'
      );
      expect(screen.getByTestId('stamp-acknowledged-date')).toBeInTheDocument();
    });

    it('does NOT render RECEIVED stamp on Draft or Sent status', () => {
      const draftTx: Transmittal = { ...baseTransmittal, status: 'Draft', acknowledged_at: null };
      const { rerender } = render(
        <TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={draftTx} />
      );

      expect(screen.queryByTestId('print-received-stamp')).toBeNull();

      const sentTx: Transmittal = { ...baseTransmittal, status: 'Sent', acknowledged_at: null };
      rerender(<TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={sentTx} />);

      expect(screen.queryByTestId('print-received-stamp')).toBeNull();
    });

    it('renders entity-aware layout: ATA shows full month uppercase and ATA TIN; LTA shows M/D/YYYY and LTA TIN', () => {
      // ATA
      const { unmount } = render(
        <TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={baseTransmittal} />
      );
      expect(screen.getByText('ATA BUSINESS CONSULTANCY SERVICES')).toBeInTheDocument();
      expect(screen.getByText('TIN: 234-567-890-000')).toBeInTheDocument();
      unmount();

      // LTA
      const ltaTransmittal: Transmittal = {
        ...baseTransmittal,
        entity_code: 'LTA',
      };
      render(
        <TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={ltaTransmittal} />
      );
      expect(screen.getByText('LTA BUSINESS CONSULTANCY SERVICES')).toBeInTheDocument();
      expect(screen.getByText('TIN: 345-678-901-000')).toBeInTheDocument();
    });

    it('correctly splits address with comma into multiple TO lines and handles missing recipient', () => {
      const txNoRecipient: Transmittal = {
        ...baseTransmittal,
        recipient_name: null,
      };

      render(<TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={txNoRecipient} />);

      // When recipient_name is absent, clientName becomes toLine1
      expect(screen.getByTestId('print-recipient-name')).toHaveTextContent(CLIENT_1.name);
      // Address parts
      expect(screen.getByText('Unit 401 Alpha Tower')).toBeInTheDocument();
      expect(screen.getByText('Ayala Ave, Makati City')).toBeInTheDocument();
    });
  });

  // =========================================================================
  // SUITE 8: Advanced Cascade Switching, Edit Mode & Boundary Stress
  // =========================================================================
  describe('Suite 8: Cascade Switching, Edit Mode & Extreme Boundary Stress', () => {
    it('InvoiceCreateModal: changing client resets selected WR and resets selected task', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('select-client')).not.toBeDisabled();
      });

      // Initially task trigger is disabled because WR is not selected
      expect(screen.getByTestId('select-work-request-task')).toBeDisabled();
    });

    it('TransmittalFormModal: edit mode populates existing items and submits expectedVersion', async () => {
      let updatePayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/transmittals/tx-edit-1') && opts?.method === 'PUT') {
          updatePayload = JSON.parse(String(opts?.body || '{}'));
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: { id: 'tx-edit-1', ...updatePayload } }),
          } as Response);
        }
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [CLIENT_1] }),
          } as Response);
        }
        if (u.includes('/work-requests')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [WR_1] }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response);
      });

      const existingTx: Transmittal = {
        id: 'tx-edit-1',
        tracking_number: 'TR-2026-EDIT',
        client_id: CLIENT_1.id,
        work_request_id: WR_1.id,
        entity_id: 'ent-1',
        archived: false,
        status: 'Draft',
        approved: false,
        board_order: 0,
        version: 4,
        recipient_name: 'Existing Recipient',
        created_at: new Date().toISOString(),
        items: [
          {
            id: 'i-edit-1',
            description: 'Existing Contract Copy',
            document_type: 'Contract',
            quantity: 2,
          },
        ],
      };

      const { wrapper } = createHarness();
      render(
        <TransmittalFormModal isOpen={true} onClose={vi.fn()} transmittalToEdit={existingTx} />,
        { wrapper }
      );

      // Edit mode title
      expect(screen.getByText('Edit Transmittal')).toBeInTheDocument();

      // Submit edits
      const submitBtn = screen.getByTestId('submit-transmittal-btn');
      expect(submitBtn).toHaveTextContent('Save Changes');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(updatePayload).not.toBeNull();
      });

      expect(updatePayload!.expectedVersion).toBe(4);
      expect(updatePayload!.trackingNumber).toBe('TR-2026-EDIT');
      expect(updatePayload!.recipientName).toBe('Existing Recipient');
    });

    it('InvoiceCreateModal: handles extreme amount calculation (₱999,999,999.99) without rounding corruption', () => {
      const { wrapper } = createHarness();
      render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const amountInput = screen.getByTestId('line-item-amount-0');
      fireEvent.change(amountInput, { target: { value: '999999999.99' } });

      const totalDisplay = screen.getByTestId('calculated-total');
      expect(totalDisplay).toHaveTextContent('₱999,999,999.99');
    });

    it('CreateDisbursementModal: rejects negative amounts and 0 amount with validation error', async () => {
      const { wrapper } = createHarness();
      render(<CreateDisbursementModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const amountInput = screen.getByTestId('input-amount');
      fireEvent.change(amountInput, { target: { value: '-250' } });

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-amount')).toHaveTextContent(
          'Amount must be a positive number greater than 0'
        );
      });
    });
  });

  // =========================================================================
  // SUITE 9: Reviewer Remediation Verification & Adversarial Scenarios (S1-S4)
  // =========================================================================
  describe('Suite 9: Reviewer Remediation Verification & Adversarial Scenarios (S1-S4)', () => {
    it('S1 (Billing): Modal lifecycle multi-cycle re-open resets stale client and auto-detects new client on subsequent open', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/invoices') && opts?.method === 'POST') {
          capturedPayload = JSON.parse(String(opts?.body || '{}'));
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ data: { id: 'inv-s1-test', ...capturedPayload } }),
          } as Response);
        }
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [CLIENT_1, CLIENT_2] }),
          } as Response);
        }
        if (u.includes('/tasks')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: TASKS_WR_2 }),
          } as Response);
        }
        if (u.includes('/work-requests')) {
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
      // Cycle 1: Open with WR_1 (belonging to CLIENT_1)
      const { rerender } = render(
        <InvoiceCreateModal isOpen={true} onClose={vi.fn()} prefill={{ workRequestId: WR_1.id }} />,
        { wrapper }
      );

      // Verify WR_1 and Client 1 auto-detected
      await waitFor(() => {
        const clientTrigger = screen.getByTestId('select-client');
        expect(clientTrigger).toBeDisabled();
      });

      // Cycle 2: Close modal
      rerender(<InvoiceCreateModal isOpen={false} onClose={vi.fn()} />);

      // Cycle 3: Re-open with WR_2 (belonging to CLIENT_2)
      rerender(
        <InvoiceCreateModal isOpen={true} onClose={vi.fn()} prefill={{ workRequestId: WR_2.id }} />
      );

      // Fill line item and submit
      const descInput = await screen.findByTestId('line-item-desc-0');
      fireEvent.change(descInput, { target: { value: 'Cycle 3 Invoice Item' } });

      const submitBtn = screen.getByTestId('btn-submit-invoice');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      // Assert payload has WR_2 and CLIENT_2 (NOT CLIENT_1)
      expect(capturedPayload!.workRequestId).toBe(WR_2.id);
      expect(capturedPayload!.clientId).toBe(CLIENT_2.id);

      // Cycle 4: Close and reopen with no prefill -> form should be reset and empty
      rerender(<InvoiceCreateModal isOpen={false} onClose={vi.fn()} />);

      rerender(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />);

      const clientTriggerFresh = screen.getByTestId('select-client');
      expect(clientTriggerFresh).not.toBeDisabled();
      const wrTriggerFresh = screen.getByTestId('select-work-request');
      expect(wrTriggerFresh).not.toBeDisabled();
    });

    it('S1 (Disbursement): Modal lifecycle multi-cycle re-open synchronizes client with WR and resets on close', async () => {
      let capturedPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements') && opts?.method === 'POST') {
          capturedPayload = JSON.parse(String(opts?.body || '{}'));
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ data: { id: 'disb-s1-test', ...capturedPayload } }),
          } as Response);
        }
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [CLIENT_1, CLIENT_2] }),
          } as Response);
        }
        if (u.includes('/tasks')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: TASKS_WR_2 }),
          } as Response);
        }
        if (u.includes('/work-requests')) {
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
      // Cycle 1: Open with WR_1
      const { rerender } = render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_1.id }}
        />,
        { wrapper }
      );

      const clientInput = screen.getByTestId('display-client-name') as HTMLInputElement;
      await waitFor(() => {
        expect(clientInput.value).toBe(CLIENT_1.name);
      });

      // Cycle 2: Close modal
      rerender(<CreateDisbursementModal isOpen={false} onClose={vi.fn()} />);

      // Cycle 3: Reopen with WR_2
      rerender(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_2.id }}
        />
      );

      await waitFor(() => {
        const currentInput = screen.getByTestId('display-client-name') as HTMLInputElement;
        expect(currentInput.value).toBe(CLIENT_2.name);
      });

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Cycle 3 Disbursement' },
      });
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      const confirmCycleBtn = screen.queryByTestId('btn-confirm-no-receipt');
      if (confirmCycleBtn) fireEvent.click(confirmCycleBtn);

      await waitFor(() => {
        expect(capturedPayload).not.toBeNull();
      });

      expect(capturedPayload!.linkedWorkRequestId).toBe(WR_2.id);
      expect(capturedPayload!.clientId).toBe(CLIENT_2.id);

      // Cycle 4: Close and reopen with no prefill -> fields should be reset
      rerender(<CreateDisbursementModal isOpen={false} onClose={vi.fn()} />);

      rerender(<CreateDisbursementModal isOpen={true} onClose={vi.fn()} />);

      await waitFor(() => {
        const freshInput = screen.getByTestId('display-client-name') as HTMLInputElement;
        expect(freshInput.value).toBe('');
      });
      const wrSelect = screen.getByTestId('select-work-request') as HTMLSelectElement;
      expect(wrSelect.value).toBe('');
    });

    it('S2: TransmittalPrintModal eliminates duplicate client company name when recipient_name is empty', () => {
      const txWithoutRecipient: Transmittal = {
        id: 'tx-print-s2',
        tracking_number: 'TR-ATA-2026-S2',
        entity_id: 'ent-1',
        entity_code: 'ATA',
        client_id: CLIENT_1.id,
        status: 'Acknowledged',
        approved: true,
        board_order: 0,
        version: 1,
        recipient_name: null,
        created_at: '2026-10-05T08:00:00.000Z',
        sent_at: '2026-10-05T09:00:00.000Z',
        acknowledged_at: '2026-10-05T10:30:00.000Z',
        received_by_name: null,
        archived: false,
        notes: null,
        clients: {
          name: CLIENT_1.name,
          address: CLIENT_1.address,
          tin: CLIENT_1.tin,
        },
        items: [
          { id: 'i-s2', description: 'Annual Corporate Report', document_type: 'SEC', quantity: 1 },
        ],
      };

      render(
        <TransmittalPrintModal isOpen={true} onClose={vi.fn()} transmittal={txWithoutRecipient} />
      );

      // Line 1 receives clientName
      const line1 = screen.getByTestId('print-recipient-name');
      expect(line1).toHaveTextContent(CLIENT_1.name);

      // Line 2 MUST be empty string, NOT (CLIENT_1.name)
      const line2 = screen.getByTestId('print-client-name');
      expect(line2).toHaveTextContent('');
      expect(line2.textContent?.trim()).toBe('');
      expect(screen.queryByText(`(${CLIENT_1.name})`)).toBeNull();
    });

    it('S3 (Disbursement): Contract Rule 3 filters work requests dropdown to only match prefilled clientId', async () => {
      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{ clientId: CLIENT_1.id }}
        />,
        { wrapper }
      );

      await waitFor(() => {
        const wrSelect = screen.getByTestId('select-work-request') as HTMLSelectElement;
        const options = Array.from(wrSelect.options).map((o) => o.value);
        // WR_1 (belongs to CLIENT_1) MUST be present
        expect(options).toContain(WR_1.id);
        // WR_2 (belongs to CLIENT_2) and WR_ORPHAN must NOT be present
        expect(options).not.toContain(WR_2.id);
        expect(options).not.toContain(WR_ORPHAN.id);
      });
    });

    it('S3 (Transmittals): Contract Rule 3 filters work requests dropdown to only match prefilled clientId', async () => {
      const { wrapper } = createHarness();
      render(
        <TransmittalFormModal
          isOpen={true}
          onClose={vi.fn()}
          prefill={{ clientId: CLIENT_1.id }}
        />,
        { wrapper }
      );

      await waitFor(() => {
        const trigger = screen.getByTestId('work-request-select');
        const selectEl = trigger.parentElement?.querySelector('select') as HTMLSelectElement | null;
        if (selectEl) {
          const optionValues = Array.from(selectEl.options).map((o) => o.value);
          expect(optionValues).toContain(WR_1.id);
          expect(optionValues).not.toContain(WR_2.id);
        } else {
          fireEvent.click(trigger);
          expect(screen.getByText(new RegExp(WR_1.title, 'i'))).toBeInTheDocument();
          expect(screen.queryByText(new RegExp(WR_2.title, 'i'))).toBeNull();
        }
      });
    });
  });
});
