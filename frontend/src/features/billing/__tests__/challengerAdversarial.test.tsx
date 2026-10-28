import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceCreateModal } from '../components/InvoiceCreateModal';
import { InvoiceList } from '../components/InvoiceList';
import { createInvoiceSchema, updateInvoiceSchema } from '../api/schemas';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { queryClient as globalQueryClient } from '@/lib/api';
import type { Invoice } from '../api/types';

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

const mockClients = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Acme Philippines Corp', entity: 'ATA' as const, status: 'Active' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Beta Holdings Inc', entity: 'LTA' as const, status: 'Active' },
];

const mockWorkRequests = [
  { id: '33333333-3333-3333-3333-333333333333', title: 'Tax Filing 2026', entity: 'ATA' as const },
];

const testInvoices: Invoice[] = [
  {
    id: 'inv-ata-1',
    entity_id: 'ent-ata',
    entity_code: 'ATA',
    invoice_number: 'ATA-SI-2026-0001',
    client_id: '11111111-1111-1111-1111-111111111111',
    issue_date: '2026-10-01',
    due_date: '2026-10-31',
    status: 'Draft',
    subtotal: 10000,
    total: 10000,
    amount_paid: 0,
    balance: 10000,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    clients: { name: 'Acme Philippines Corp' },
  },
  {
    id: 'inv-ata-2',
    entity_id: 'ent-ata',
    entity_code: 'ATA',
    invoice_number: 'ATA-SI-2026-0002',
    client_id: '11111111-1111-1111-1111-111111111111',
    issue_date: '2026-10-02',
    due_date: '2026-11-02',
    status: 'Sent',
    subtotal: 20000,
    total: 20000,
    amount_paid: 5000,
    balance: 15000,
    created_at: '2026-10-02T08:00:00Z',
    updated_at: '2026-10-02T08:00:00Z',
    clients: { name: 'Acme Philippines Corp' },
  },
  {
    id: 'inv-lta-1',
    entity_id: 'ent-lta',
    entity_code: 'LTA',
    invoice_number: 'LTA-SI-2026-0003',
    client_id: '22222222-2222-2222-2222-222222222222',
    issue_date: '2026-09-01',
    due_date: '2026-10-01',
    status: 'Overdue',
    subtotal: 30000,
    total: 30000,
    amount_paid: 0,
    balance: 30000,
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    clients: { name: 'Beta Holdings Inc' },
  },
];

describe('Challenger Adversarial Stress Tests: Billing Module', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-challenger',
        email: 'challenger@ata-lta.ph',
        name: 'Challenger',
        role: 'Admin',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:payments', 'billing:delete'],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    globalQueryClient.clear();
    useBlockingModalStore.getState().reset();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // Group 1: Dynamic Line Items Manipulation & Bounds
  // ==========================================================================
  describe('Group 1: Dynamic Line Items Manipulation & Bounds', () => {
    beforeEach(() => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
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
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });
    });

    it('reorders items up and down while respecting boundary buttons', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      // Starts with 1 item: move up and move down must both be disabled
      const moveUp0 = screen.getByTestId('btn-move-up-0');
      const moveDown0 = screen.getByTestId('btn-move-down-0');
      expect(moveUp0).toBeDisabled();
      expect(moveDown0).toBeDisabled();

      // Add 2 more items (total 3 items)
      const addBtn = screen.getByTestId('btn-add-line-item');
      fireEvent.click(addBtn); // item 1
      fireEvent.click(addBtn); // item 2

      // Set distinct descriptions and amounts
      const desc0 = screen.getByTestId('line-item-desc-0');
      const amount0 = screen.getByTestId('line-item-amount-0');
      fireEvent.change(desc0, { target: { value: 'Item Alpha' } });
      fireEvent.change(amount0, { target: { value: '1000' } });

      const desc1 = screen.getByTestId('line-item-desc-1');
      const amount1 = screen.getByTestId('line-item-amount-1');
      fireEvent.change(desc1, { target: { value: 'Item Beta' } });
      fireEvent.change(amount1, { target: { value: '2000' } });

      const desc2 = screen.getByTestId('line-item-desc-2');
      const amount2 = screen.getByTestId('line-item-amount-2');
      fireEvent.change(desc2, { target: { value: 'Item Gamma' } });
      fireEvent.change(amount2, { target: { value: '3000' } });

      // Total must be 1000 + 2000 + 3000 = ₱6,000.00
      expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱6,000.00');

      // Boundary check on item 0: move up is disabled, move down is enabled
      expect(screen.getByTestId('btn-move-up-0')).toBeDisabled();
      expect(screen.getByTestId('btn-move-down-0')).not.toBeDisabled();

      // Boundary check on item 2: move up is enabled, move down is disabled
      expect(screen.getByTestId('btn-move-up-2')).not.toBeDisabled();
      expect(screen.getByTestId('btn-move-down-2')).toBeDisabled();

      // Move Item 1 DOWN to position 2
      fireEvent.click(screen.getByTestId('btn-move-down-1'));

      // Now position 1 should be Item Gamma and position 2 should be Item Beta
      expect(screen.getByTestId('line-item-desc-1')).toHaveValue('Item Gamma');
      expect(screen.getByTestId('line-item-desc-2')).toHaveValue('Item Beta');

      // Total remains invariant at ₱6,000.00
      expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱6,000.00');

      // Move Item Gamma UP to position 0
      fireEvent.click(screen.getByTestId('btn-move-up-1'));
      expect(screen.getByTestId('line-item-desc-0')).toHaveValue('Item Gamma');
      expect(screen.getByTestId('line-item-desc-1')).toHaveValue('Item Alpha');
      expect(screen.getByTestId('line-item-desc-2')).toHaveValue('Item Beta');
    });

    it('strictly forbids reducing line items count below 1 in the UI', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      // Single item: remove button is disabled
      const removeBtn0 = screen.getByTestId('btn-remove-item-0');
      expect(removeBtn0).toBeDisabled();

      // Attempting to click does not remove it
      fireEvent.click(removeBtn0);
      expect(screen.getByTestId('line-item-row-0')).toBeInTheDocument();

      // Add an item -> remove button is enabled
      fireEvent.click(screen.getByTestId('btn-add-line-item'));
      expect(screen.getByTestId('btn-remove-item-0')).not.toBeDisabled();
      expect(screen.getByTestId('btn-remove-item-1')).not.toBeDisabled();

      // Remove the second item -> remove button on item 0 becomes disabled again
      fireEvent.click(screen.getByTestId('btn-remove-item-1'));
      expect(screen.getByTestId('btn-remove-item-0')).toBeDisabled();
    });

    it('handles live subtotals, decimal precision, and negative/invalid inputs gracefully', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceCreateModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const amount0 = screen.getByTestId('line-item-amount-0');

      // Test fractional cents: 1234.56 + 7890.44 = 9125.00
      fireEvent.change(amount0, { target: { value: '1234.56' } });
      fireEvent.click(screen.getByTestId('btn-add-line-item'));
      const amount1 = screen.getByTestId('line-item-amount-1');
      fireEvent.change(amount1, { target: { value: '7890.44' } });

      expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱9,125.00');

      // Test typing non-numeric string or empty: should fallback to 0 in subtotal calculation without NaN
      fireEvent.change(amount1, { target: { value: '' } });
      expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱1,234.56');

      // Test typing negative number: calculation treats negative as 0, avoiding negative totals
      fireEvent.change(amount1, { target: { value: '-500' } });
      expect(screen.getByTestId('calculated-total')).toHaveTextContent('₱1,234.56');
    });

    it('rejects submission with negative amount or 0 line items via schema validation', async () => {
      const validPayload = {
        clientId: '11111111-1111-1111-1111-111111111111',
        workRequestId: '33333333-3333-3333-3333-333333333333',
        linkedTaskId: '44444444-4444-4444-4444-444444444444',
        invoiceNumber: 'INV-TEST-001',
        issueDate: '2026-10-01',
        dueDate: '2026-10-31',
        lineItems: [{ description: 'Valid Item', amount: 5000, type: 'Professional Fee' as const }],
      };

      // Valid case passes
      const validResult = createInvoiceSchema.safeParse(validPayload);
      expect(validResult.success).toBe(true);

      // 0 line items rejected
      const zeroItemsResult = createInvoiceSchema.safeParse({
        ...validPayload,
        lineItems: [],
      });
      expect(zeroItemsResult.success).toBe(false);
      if (!zeroItemsResult.success) {
        expect(zeroItemsResult.error.errors[0]?.message).toBe('At least one line item is required');
      }

      // Negative amount rejected
      const negativeAmountResult = createInvoiceSchema.safeParse({
        ...validPayload,
        lineItems: [{ description: 'Negative Item', amount: -100, type: 'Professional Fee' as const }],
      });
      expect(negativeAmountResult.success).toBe(false);
      if (!negativeAmountResult.success) {
        expect(negativeAmountResult.error.errors[0]?.message).toBe('Amount must be non-negative');
      }

      // Invalid status rejected (only Draft and Pending permitted on creation)
      const invalidStatusResult = createInvoiceSchema.safeParse({
        ...validPayload,
        status: 'Paid',
      });
      expect(invalidStatusResult.success).toBe(false);

      const invalidStatusSentResult = createInvoiceSchema.safeParse({
        ...validPayload,
        status: 'Sent',
      });
      expect(invalidStatusSentResult.success).toBe(false);
    });
  });

  // ==========================================================================
  // Group 2: List View Filtering, Debouncing, and Entity Partitioning
  // ==========================================================================
  describe('Group 2: List View Filtering, Debouncing, and Entity Partitioning', () => {
    let capturedUrls: string[] = [];

    beforeEach(() => {
      capturedUrls = [];
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        capturedUrls.push(u);
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockClients }),
          } as Response);
        }
        if (u.includes('/invoices')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              data: testInvoices,
              meta: { total: testInvoices.length, page: 1, limit: 25 },
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

    it('sends correct status filter query parameter and updates tab selection', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('tab-sent')).toBeInTheDocument();
      });

      // Initial render with All tab omits status parameter
      expect(capturedUrls.some((u) => u.includes('/invoices') && !u.includes('status='))).toBe(true);

      // Click Sent tab
      const sentTab = screen.getByTestId('tab-sent');
      fireEvent.click(sentTab);

      await waitFor(() => {
        const hasSent = capturedUrls.some((u) => u.includes('status=Sent') && u.includes('archived=false'));
        expect(hasSent).toBe(true);
      });

      // Click Overdue tab
      const overdueTab = screen.getByTestId('tab-overdue');
      fireEvent.click(overdueTab);

      await waitFor(() => {
        const hasOverdue = capturedUrls.some((u) => u.includes('status=Overdue'));
        expect(hasOverdue).toBe(true);
      });
    });

    it('debounces search input before sending search query parameter', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('invoice-search-input')).toBeInTheDocument();
      });

      const searchInput = screen.getByTestId('invoice-search-input');
      fireEvent.change(searchInput, { target: { value: 'ATA-SI-2026' } });

      // After debounce delay (~300ms), search query parameter should be emitted
      await waitFor(
        () => {
          const hasSearch = capturedUrls.some((u) => u.includes('search=ATA-SI-2026'));
          expect(hasSearch).toBe(true);
        },
        { timeout: 2000 }
      );
    });

    it('computes stats bar accurately from list invoices and total meta', async () => {
      const { wrapper } = createHarness();
      render(<InvoiceList />, { wrapper });

      // Total count from meta: 3
      // Total value: 10000 + 20000 + 30000 = ₱60,000.00
      // Outstanding balance: 10000 + 15000 + 30000 = ₱55,000.00
      // Overdue count: 1
      await waitFor(() => {
        expect(screen.getByTestId('stat-total-invoices')).toHaveTextContent('3');
      });

      expect(screen.getByTestId('stat-total-value')).toHaveTextContent('₱60,000.00');
      expect(screen.getByTestId('stat-outstanding-balance')).toHaveTextContent('₱55,000.00');
      expect(screen.getByTestId('stat-overdue-count')).toHaveTextContent('1');
    });

    it('validates OCC concurrency expectedVersion schema requirements', async () => {
      // Valid positive integer expectedVersion
      const validOCC = updateInvoiceSchema.safeParse({ expectedVersion: 4 });
      expect(validOCC.success).toBe(true);

      // Zero or negative expectedVersion rejected
      const invalidOCCZero = updateInvoiceSchema.safeParse({ expectedVersion: 0 });
      expect(invalidOCCZero.success).toBe(false);

      const invalidOCCNeg = updateInvoiceSchema.safeParse({ expectedVersion: -2 });
      expect(invalidOCCNeg.success).toBe(false);

      // Non-integer rejected
      const invalidOCCFloat = updateInvoiceSchema.safeParse({ expectedVersion: 3.14 });
      expect(invalidOCCFloat.success).toBe(false);
    });
  });
});
