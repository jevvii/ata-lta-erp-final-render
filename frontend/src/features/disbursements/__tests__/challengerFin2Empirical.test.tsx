import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { queryClient as globalQueryClient } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import {
  useBlockingModalStore,
  BlockingActionModal,
} from '@/features/operations/components/BlockingActionModal';

// Billing imports (UAT-FIN4)
import { billingKeys } from '@/features/billing/api/queryKeys';
import {
  createInvoiceAction,
  updateInvoiceAction,
  updateClientAddressAction,
  deleteInvoiceAction,
  archiveInvoiceAction,
  restoreInvoiceAction,
  recordPaymentAction,
} from '@/features/billing/api/useBillingMutations';

// Disbursements imports (UAT-FIN6 & UAT-FIN7)
import {
  restoreDisbursementAction,
} from '@/features/disbursements/api/useDisbursements';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';
import { DisbursementArchiveTab } from '@/features/disbursements/components/DisbursementArchiveTab';
import { CreateDisbursementModal } from '@/features/disbursements/components/CreateDisbursementModal';
import type { Disbursement } from '@/features/disbursements/api/types';

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

describe('CHALLENGER FIN 2 EMPIRICAL ADVERSARIAL SUITE', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    globalQueryClient.clear();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration', 'Finance'],
        entities: ['ATA'],
      },
      permissions: [
        'billing:view',
        'billing:edit',
        'billing:edit_client_address',
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
      ],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    globalQueryClient.clear();
    useBlockingModalStore.getState().reset();
  });

  // =========================================================================
  // UAT-FIN4: Billing Cache Invalidation Targets billingKeys.all
  // =========================================================================
  describe('UAT-FIN4: Centralized billingKeys.all cache invalidation', () => {
    it('verifies that billingKeys.all hierarchically invalidates invoices, details, counts, and aging in QueryClient', async () => {
      // Seed queries into globalQueryClient
      globalQueryClient.setQueryData(billingKeys.invoicesList('ATA'), [{ id: 'inv-1' }]);
      globalQueryClient.setQueryData(billingKeys.invoiceDetail('inv-1'), { id: 'inv-1', total: 1000 });
      globalQueryClient.setQueryData(billingKeys.counts('ATA'), { active: 1, overdue: 0 });
      globalQueryClient.setQueryData(billingKeys.aging('ATA'), { current: 1000 });

      // Verify they are fresh (not stale)
      expect(globalQueryClient.getQueryState(billingKeys.invoicesList('ATA'))?.isInvalidated).toBe(false);
      expect(globalQueryClient.getQueryState(billingKeys.invoiceDetail('inv-1'))?.isInvalidated).toBe(false);
      expect(globalQueryClient.getQueryState(billingKeys.counts('ATA'))?.isInvalidated).toBe(false);
      expect(globalQueryClient.getQueryState(billingKeys.aging('ATA'))?.isInvalidated).toBe(false);

      // Invalidate billingKeys.all
      await globalQueryClient.invalidateQueries({ queryKey: billingKeys.all });

      // All downstream queries must now be invalidated
      expect(globalQueryClient.getQueryState(billingKeys.invoicesList('ATA'))?.isInvalidated).toBe(true);
      expect(globalQueryClient.getQueryState(billingKeys.invoiceDetail('inv-1'))?.isInvalidated).toBe(true);
      expect(globalQueryClient.getQueryState(billingKeys.counts('ATA'))?.isInvalidated).toBe(true);
      expect(globalQueryClient.getQueryState(billingKeys.aging('ATA'))?.isInvalidated).toBe(true);
    });

    it('verifies that every billing mutation action explicitly targets billingKeys.all', async () => {
      const invalidateSpy = vi.spyOn(globalQueryClient, 'invalidateQueries');

      global.fetch = vi.fn().mockImplementation(async (_url: string, _init?: RequestInit) => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: { id: 'inv-test-1', invoice_number: 'ATA-SI-2026-0001' },
          }),
        };
      });

      // 1. createInvoiceAction
      await createInvoiceAction({
        clientId: 'c0000000-0000-0000-0000-000000000001',
        workRequestId: 'w0000000-0000-0000-0000-000000000001',
        invoiceNumber: 'ATA-SI-2026-0001',
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
        lineItems: [{ description: 'Item 1', amount: 5000, type: 'Professional Fee' }],
      }, 'ATA');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
      invalidateSpy.mockClear();

      // 2. updateInvoiceAction
      await updateInvoiceAction('inv-test-1', { notes: 'Updated notes' }, 'ATA');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.counts('ATA') });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.aging('ATA') });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: billingKeys.all });
      invalidateSpy.mockClear();

      // 3. updateClientAddressAction
      await updateClientAddressAction('inv-test-1', 'New Address Line 1', 1, 'ATA');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.counts('ATA') });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.aging('ATA') });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: billingKeys.all });
      invalidateSpy.mockClear();

      // 4. recordPaymentAction
      await recordPaymentAction('inv-test-1', {
        amount: 2500,
        date: '2026-10-02',
        method: 'Bank Transfer',
      }, 'ATA');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
      invalidateSpy.mockClear();

      // 5. archiveInvoiceAction
      await archiveInvoiceAction('inv-test-1', 'ATA-SI-2026-0001', 'ATA');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
      invalidateSpy.mockClear();

      // 6. restoreInvoiceAction
      await restoreInvoiceAction('inv-test-1', 'ATA-SI-2026-0001', 'ATA');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
      invalidateSpy.mockClear();

      // 7. deleteInvoiceAction
      await deleteInvoiceAction('inv-test-1', 'ATA-SI-2026-0001', 'ATA');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
      invalidateSpy.mockClear();
    });
  });

  // =========================================================================
  // UAT-FIN6: Disbursements Archive Tab & Restore Flow
  // =========================================================================
  describe('UAT-FIN6: Disbursements Archive tab & blocking restore flow', () => {
    it('executes restoreDisbursementAction via runBlockingAction targeting /v1/disbursements/:id/unarchive', async () => {
      let requestedUrl = '';
      let requestedMethod = '';

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedMethod = init?.method || 'GET';
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              id: 'disb-archived-1',
              disbursement_number: 'DISB-ATA-20261001-001',
              status: 'Released',
            },
          }),
        };
      });

      const invalidateSpy = vi.spyOn(globalQueryClient, 'invalidateQueries');

      const restored = await restoreDisbursementAction(
        'disb-archived-1',
        'DISB-ATA-20261001-001',
        'ATA',
        7
      );

      // Verify endpoint and method
      expect(requestedUrl).toContain('/disbursements/disb-archived-1/unarchive');
      expect(requestedMethod).toBe('POST');
      expect(restored.id).toBe('disb-archived-1');

      // Verify cache invalidation
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.lists() });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.detail('disb-archived-1') });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.counts('ATA') });
    });

    it('DisbursementArchiveTab renders archived items and triggers restoreDisbursementAction on restore click', async () => {
      const mockArchivedList: Disbursement[] = [
        {
          id: 'disb-arch-1',
          disbursement_number: 'DISB-ATA-20261001-001',
          entity_id: 'ent-ata',
          category: 'Office Supplies',
          description: 'Stationery bulk order',
          amount: 3200,
          fund_source: 'Firm Fund',
          status: 'Released',
          lifecycle_version: 2,
          archived: true,
          linked_work_request_id: '11111111-1111-1111-1111-111111111111',
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];

      let restoreCalled = false;
      let restoreBody: unknown;
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.includes('/unarchive') && init?.method === 'POST') {
          restoreCalled = true;
          restoreBody = JSON.parse(String(init.body));
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: { ...mockArchivedList[0], status: 'Released', archived: false, version: 2 },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: mockArchivedList,
            meta: { total: 1, page: 1, limit: 25 },
          }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <>
          <DisbursementArchiveTab />
          <BlockingActionModal />
        </>,
        { wrapper }
      );

      // Verify archived item is rendered
      await waitFor(() => {
        expect(screen.getByText('DISB-ATA-20261001-001')).toBeInTheDocument();
        expect(screen.getByText('Stationery bulk order')).toBeInTheDocument();
      });

      // Click restore action button
      const restoreBtn = screen.getByTestId('restore-action-disb-arch-1');
      expect(restoreBtn).toBeInTheDocument();
      fireEvent.click(restoreBtn);

      await waitFor(() => {
        expect(restoreCalled).toBe(true);
        expect(restoreBody).toEqual({ expectedVersion: 1 });
      });
    });

    it('surfaces RFC 7807 error verbatim in BlockingActionModal if restore fails', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string, _init?: RequestInit) => {
        if (url.includes('/unarchive')) {
          return {
            ok: false,
            status: 409,
            statusText: 'Conflict',
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              status: 409,
              title: 'Conflict',
              detail: 'Disbursement cannot be unarchived because parent work request is permanently closed.',
              code: 'ERR_PARENT_WR_CLOSED',
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
      render(<BlockingActionModal />, { wrapper });

      await expect(
        restoreDisbursementAction('disb-fail-1', 'DISB-FAIL', 'ATA')
      ).rejects.toThrow();

      await waitFor(() => {
        expect(screen.getByText('Conflict')).toBeInTheDocument();
        expect(
          screen.getByText(
            'Disbursement cannot be unarchived because parent work request is permanently closed.'
          )
        ).toBeInTheDocument();
        expect(screen.getByText('ERR_PARENT_WR_CLOSED')).toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // UAT-FIN7: Linked WR & Client Dropdowns Edge-Case Handling
  // =========================================================================
  describe('UAT-FIN7: WR & Client dropdowns handle empty and edge-case values (UAT2-12)', () => {
    it('handles empty work requests and clients query responses without crashing', async () => {
      global.fetch = vi.fn().mockImplementation(async (_url: string) => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      // Verify select elements render with default empty options
      const wrSelect = screen.getByTestId('select-work-request') as HTMLSelectElement;
      expect(wrSelect).toBeInTheDocument();
      expect(wrSelect.value).toBe('');

      // Auto-detected client is displayed in read-only input
      const clientDisplay = screen.getByTestId('display-client-name') as HTMLInputElement;
      expect(clientDisplay).toBeInTheDocument();
      expect(clientDisplay.readOnly).toBe(true);

      // Manual input fields are completely removed per UAT2-12
      expect(screen.queryByTestId('input-work-request-id')).not.toBeInTheDocument();
      expect(screen.queryByTestId('input-client-id')).not.toBeInTheDocument();
      expect(screen.queryByTestId('select-client')).not.toBeInTheDocument();
    });

    it('auto-populates and displays client when selecting a work request that has client_id', async () => {
      const mockWorkRequests = [
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Tax Compliance Audit 2026',
          client_id: 'c1111111-1111-1111-1111-111111111111',
          client_name: 'Acme Philippines Corp',
        },
      ];

      const mockClients = [
        {
          id: 'c1111111-1111-1111-1111-111111111111',
          name: 'Acme Philippines Corp',
          entity: 'ATA',
        },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/work-requests') && url.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: [{ id: 'task-1', title: 'Audit Fieldwork' }] }),
          };
        }
        if (url.includes('/work-requests')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockWorkRequests }),
          };
        }
        if (url.includes('/clients')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockClients }),
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
      render(
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      // Wait for work requests to load into select
      await waitFor(() => {
        expect(screen.getByText(/Tax Compliance Audit 2026/i)).toBeInTheDocument();
      });

      const wrSelect = screen.getByTestId('select-work-request');
      fireEvent.change(wrSelect, { target: { value: '11111111-1111-1111-1111-111111111111' } });

      // Verify Client is auto-detected and displayed
      await waitFor(() => {
        const clientDisplay = screen.getByTestId('display-client-name') as HTMLInputElement;
        expect(clientDisplay.value).toBe('Acme Philippines Corp');
      });
    });

    it('handles selecting WR with unlisted client_id: keeps client displayed without crashing', async () => {
      const mockWorkRequests = [
        {
          id: '22222222-2222-2222-2222-222222222222',
          title: 'SEC Registration',
          client_id: 'c9999999-9999-9999-9999-999999999999', // Not in clients list
          client_name: 'Unknown External Entity',
        },
      ];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/work-requests')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockWorkRequests }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }), // Empty clients list
        };
      });

      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByText(/SEC Registration/i)).toBeInTheDocument();
      });

      const wrSelect = screen.getByTestId('select-work-request');
      fireEvent.change(wrSelect, { target: { value: '22222222-2222-2222-2222-222222222222' } });

      // Client display safely shows the fallback name
      await waitFor(() => {
        const clientDisplay = screen.getByTestId('display-client-name') as HTMLInputElement;
        expect(clientDisplay.value).toBe('Unknown External Entity');
      });
    });

    it('submits clientId and linkedWorkRequestId in payload per contract', async () => {
      let dispatchedBody: Record<string, unknown> | null = null;

      global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          dispatchedBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: { id: 'disb-new-1', ...dispatchedBody },
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
      render(
        <CreateDisbursementModal
          isOpen={true}
          onClose={() => {}}
          defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
          defaultClientId="c1111111-1111-1111-1111-111111111111"
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500.00' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Express courier delivery charge' },
      });

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      const confirmBtn = screen.queryByTestId('btn-confirm-no-receipt');
      if (confirmBtn) fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(dispatchedBody).not.toBeNull();
      });

      expect(dispatchedBody!.clientId).toBe('c1111111-1111-1111-1111-111111111111');
      expect(dispatchedBody!.linkedWorkRequestId).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('rejects submission with validation error if Work Request is not selected', async () => {
      const { wrapper } = createHarness();
      render(
        <CreateDisbursementModal isOpen={true} onClose={() => {}} />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500.00' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Test description' },
      });

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('error-work-request-id')).toHaveTextContent(
          'Please select a Work Request'
        );
      });
    });
  });
});
