import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import {
  updateInvoiceAction,
  updateClientAddressAction,
} from '../api/useBillingMutations';
import { billingKeys } from '../api/queryKeys';

import { DisbursementDetailDrawer } from '../../disbursements/components/DisbursementDetailDrawer';
import {
  useApproveDisbursement,
  useRejectDisbursement,
  useFundDisbursement,
  useReleaseDisbursement,
} from '../../disbursements/api/useDisbursements';
import { disbursementKeys } from '../../disbursements/api/queryKeys';

import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { queryClient as apiQueryClient } from '@/lib/api';
import type { Invoice } from '../api/types';
import type { Disbursement } from '../../disbursements/api/types';

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

const mockInvoice: Invoice = {
  id: 'inv-stress-101',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-2026-STRESS',
  client_id: 'client-stress-1',
  issue_date: '2026-10-10',
  due_date: '2026-11-10',
  status: 'Draft',
  subtotal: 75000,
  total: 75000,
  amount_paid: 25000,
  balance: 50000,
  address: 'Level 28 Ayala Tower One, Makati City',
  notes: 'Stress test baseline notes',
  terms: 'Net 30 days',
  version: 4,
  created_at: '2026-10-10T08:00:00Z',
  updated_at: '2026-10-10T08:00:00Z',
  clients: {
    name: 'Megaworld Prime Holdings',
    tin: '333-444-555-000',
    address: 'Level 28 Ayala Tower One, Makati City',
  },
  line_items: [
    {
      id: 'li-1',
      description: 'Corporate Restructuring Retainer',
      amount: 75000,
      type: 'Professional Fee',
    },
  ],
  payments: [],
};

const mockDisbursement: Disbursement = {
  id: 'disb-stress-201',
  disbursement_number: 'DISB-ATA-20261010-STRESS',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Filing Fees',
  description: 'Special SEC Registration Filing Expedited',
  amount: 15000,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: 'wr-stress-1',
  version: 5,
  created_at: '2026-10-10T08:00:00Z',
  updated_at: '2026-10-10T08:00:00Z',
  client_name: 'Megaworld Prime Holdings',
};

describe('Adversarial OCC & Conflict Resolution Modal Stress Harness (Parcels 2B & 2C)', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    localStorage.clear();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-stress-staff',
        email: 'staff@ata-lta.ph',
        name: 'Stress Staff',
        role: 'Staff',
        departments: ['Accounting', 'Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'billing:view',
        'billing:edit',
        'billing:payments',
        'billing:edit_client_address',
        'billing:delete',
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
      ],
      activeEntity: 'ATA',
    });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    localStorage.clear();
    await supabase.removeAllChannels();
    useBlockingModalStore.getState().reset();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: isConcurrencyConflictError Classification Oracle
  // =========================================================================
  describe('Dimension 1: RFC 7807 Conflict Classification Oracle', () => {
    it('accurately identifies valid 409 conflict permutations', () => {
      // Standard HTTP 409 status
      expect(isConcurrencyConflictError({ status: 409 })).toBe(true);
      // Code CONCURRENCY_CONFLICT
      expect(isConcurrencyConflictError({ code: 'CONCURRENCY_CONFLICT' })).toBe(true);
      // Code ERR_CONCURRENCY_CONFLICT
      expect(isConcurrencyConflictError({ code: 'ERR_CONCURRENCY_CONFLICT' })).toBe(true);
      // RFC 7807 full payload
      expect(
        isConcurrencyConflictError({
          status: 409,
          code: 'CONCURRENCY_CONFLICT',
          title: 'Conflict',
          detail: 'Version mismatch: expected 4, found 5',
        })
      ).toBe(true);
      // Status as string number conversion check (object property type check)
      expect(
        isConcurrencyConflictError({
          status: 409,
          error: 'VersionConflictError',
        })
      ).toBe(true);
    });

    it('rigorously rejects non-OCC error categories (500, network, 400, 403, primitives)', () => {
      // Internal Server Error
      expect(isConcurrencyConflictError({ status: 500, message: 'Internal Server Error' })).toBe(false);
      expect(isConcurrencyConflictError({ status: 502, code: 'BAD_GATEWAY' })).toBe(false);
      expect(isConcurrencyConflictError({ status: 503, code: 'SERVICE_UNAVAILABLE' })).toBe(false);
      // Validation error
      expect(isConcurrencyConflictError({ status: 400, code: 'VALIDATION_ERROR' })).toBe(false);
      expect(isConcurrencyConflictError({ status: 422, code: 'UNPROCESSABLE_ENTITY' })).toBe(false);
      // Forbidden / Unauthorized
      expect(isConcurrencyConflictError({ status: 401, code: 'UNAUTHORIZED' })).toBe(false);
      expect(isConcurrencyConflictError({ status: 403, code: 'FORBIDDEN' })).toBe(false);
      // Not found
      expect(isConcurrencyConflictError({ status: 404, code: 'NOT_FOUND' })).toBe(false);
      // Network & System Errors
      expect(isConcurrencyConflictError(new Error('Network request failed'))).toBe(false);
      expect(isConcurrencyConflictError(new TypeError('Failed to fetch'))).toBe(false);
      // Boundary primitives & empty states
      expect(isConcurrencyConflictError(null)).toBe(false);
      expect(isConcurrencyConflictError(undefined)).toBe(false);
      expect(isConcurrencyConflictError('')).toBe(false);
      expect(isConcurrencyConflictError('409 Conflict')).toBe(false);
      expect(isConcurrencyConflictError(409)).toBe(false);
      expect(isConcurrencyConflictError({})).toBe(false);
      expect(isConcurrencyConflictError({ status: 200 })).toBe(false);
    });
  });

  // =========================================================================
  // Dimension 2: Billing OCC Mutation Payloads With & Without strict_occ
  // =========================================================================
  describe('Dimension 2: Billing OCC Mutation Payloads Stress', () => {
    it('updateInvoiceAction enforces strict_occ flag contract across versions and edge cases', async () => {
      let capturedBody: Record<string, unknown> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : {};
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockInvoice, version: 5 } }),
        } as Response);
      });

      // 1. strict_occ ENABLED + explicit number version
      localStorage.setItem('erp_feature_override_strict_occ', 'true');
      await updateInvoiceAction('inv-stress-101', { notes: 'Note A' }, 4, 'ATA');
      expect(capturedBody).toEqual({ notes: 'Note A', expectedVersion: 4 });

      // 2. strict_occ ENABLED + version 0 (boundary version number)
      await updateInvoiceAction('inv-stress-101', { notes: 'Note 0' }, 0, 'ATA');
      expect(capturedBody).toEqual({ notes: 'Note 0', expectedVersion: 0 });

      // 3. strict_occ ENABLED + expectedVersion embedded in data object
      await updateInvoiceAction(
        'inv-stress-101',
        { notes: 'Note Embedded', expectedVersion: 7 },
        undefined,
        'ATA'
      );
      expect(capturedBody).toEqual({ notes: 'Note Embedded', expectedVersion: 7 });

      // 4. strict_occ DISABLED + explicit number version -> MUST NEVER STRIP expectedVersion
      localStorage.setItem('erp_feature_override_strict_occ', 'false');
      await updateInvoiceAction('inv-stress-101', { notes: 'Note B' }, 4, 'ATA');
      expect(capturedBody).toEqual({ notes: 'Note B', expectedVersion: 4 });
      expect(capturedBody.expectedVersion).toBe(4);

      // 5. strict_occ DISABLED + embedded expectedVersion in data -> MUST NEVER DELETE expectedVersion
      await updateInvoiceAction(
        'inv-stress-101',
        { notes: 'Note C', expectedVersion: 9 },
        9,
        'ATA'
      );
      expect(capturedBody).toEqual({ notes: 'Note C', expectedVersion: 9 });
      expect(capturedBody.expectedVersion).toBe(9);
    });

    it('updateClientAddressAction enforces strict_occ flag contract across versions and edge cases', async () => {
      let capturedBody: Record<string, unknown> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : {};
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockInvoice, version: 5 } }),
        } as Response);
      });

      // 1. strict_occ ENABLED + expectedVersion
      localStorage.setItem('erp_feature_override_strict_occ', 'true');
      await updateClientAddressAction(
        'inv-stress-101',
        '88 Enterprise Center, Makati',
        4,
        'ATA'
      );
      expect(capturedBody).toEqual({
        address: '88 Enterprise Center, Makati',
        expectedVersion: 4,
      });

      // 2. strict_occ ENABLED + boundary expectedVersion 0
      await updateClientAddressAction(
        'inv-stress-101',
        '88 Enterprise Center, Makati',
        0,
        'ATA'
      );
      expect(capturedBody).toEqual({
        address: '88 Enterprise Center, Makati',
        expectedVersion: 0,
      });

      // 3. strict_occ DISABLED -> MUST NEVER OMIT expectedVersion
      localStorage.setItem('erp_feature_override_strict_occ', 'false');
      await updateClientAddressAction(
        'inv-stress-101',
        '88 Enterprise Center, Makati',
        4,
        'ATA'
      );
      expect(capturedBody).toEqual({
        address: '88 Enterprise Center, Makati',
        expectedVersion: 4,
      });
      expect(capturedBody.expectedVersion).toBe(4);
    });
  });

  // =========================================================================
  // Dimension 3: Disbursements OCC Mutation Payloads With & Without strict_occ
  // =========================================================================
  describe('Dimension 3: Disbursements OCC Mutation Payloads Stress', () => {
    it('useApproveDisbursement correctly includes / omits expectedVersion under strict_occ', async () => {
      let capturedBody: Record<string, unknown> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : {};
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursement, status: 'Approved', version: 6 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

      // ENABLED: object syntax
      localStorage.setItem('erp_feature_override_strict_occ', 'true');
      await result.current.approveDisbursement({ id: 'disb-stress-201', expectedVersion: 5 });
      expect(capturedBody).toEqual({ expectedVersion: 5 });

      // ENABLED: approveWithBlocking positional syntax
      await result.current.approveWithBlocking('disb-stress-201', 5);
      expect(capturedBody).toEqual({ expectedVersion: 5 });

      // ENABLED: boundary version 0
      await result.current.approveDisbursement({ id: 'disb-stress-201', expectedVersion: 0 });
      expect(capturedBody).toEqual({ expectedVersion: 0 });

      // DISABLED: unconditionally passes expectedVersion
      localStorage.setItem('erp_feature_override_strict_occ', 'false');
      await result.current.approveDisbursement({ id: 'disb-stress-201', expectedVersion: 5 });
      expect(capturedBody).toEqual({ expectedVersion: 5 });

      // DISABLED: approveWithBlocking
      await result.current.approveWithBlocking('disb-stress-201', 5);
      expect(capturedBody).toEqual({ expectedVersion: 5 });
    });

    it('useRejectDisbursement correctly includes / omits expectedVersion under strict_occ', async () => {
      let capturedBody: Record<string, unknown> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : {};
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursement, status: 'Rejected', version: 6 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useRejectDisbursement(), { wrapper });

      // ENABLED: object syntax
      localStorage.setItem('erp_feature_override_strict_occ', 'true');
      await result.current.rejectDisbursement({
        id: 'disb-stress-201',
        reason: 'Disallowed reimbursement item',
        expectedVersion: 5,
      });
      expect(capturedBody).toEqual({
        reason: 'Disallowed reimbursement item',
        expectedVersion: 5,
      });

      // ENABLED: rejectWithBlocking positional
      await result.current.rejectWithBlocking('disb-stress-201', 'Invalid receipt', 5);
      expect(capturedBody).toEqual({
        reason: 'Invalid receipt',
        expectedVersion: 5,
      });

      // DISABLED: unconditionally passes expectedVersion
      localStorage.setItem('erp_feature_override_strict_occ', 'false');
      await result.current.rejectDisbursement({
        id: 'disb-stress-201',
        reason: 'Disallowed reimbursement item',
        expectedVersion: 5,
      });
      expect(capturedBody).toEqual({
        reason: 'Disallowed reimbursement item',
        expectedVersion: 5,
      });
      expect(capturedBody.expectedVersion).toBe(5);
    });

    it('useFundDisbursement correctly includes / omits expectedVersion under strict_occ', async () => {
      let capturedBody: Record<string, unknown> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : {};
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursement, status: 'Funded', version: 7 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useFundDisbursement(), { wrapper });

      // ENABLED: object syntax
      localStorage.setItem('erp_feature_override_strict_occ', 'true');
      await result.current.fundDisbursement({ id: 'disb-stress-201', expectedVersion: 6 });
      expect(capturedBody).toEqual({ expectedVersion: 6 });

      // ENABLED: fundWithBlocking positional
      await result.current.fundWithBlocking('disb-stress-201', 6);
      expect(capturedBody).toEqual({ expectedVersion: 6 });

      // DISABLED: unconditionally passes expectedVersion
      localStorage.setItem('erp_feature_override_strict_occ', 'false');
      await result.current.fundDisbursement({ id: 'disb-stress-201', expectedVersion: 6 });
      expect(capturedBody).toEqual({ expectedVersion: 6 });
    });

    it('useReleaseDisbursement correctly includes / omits expectedVersion under strict_occ', async () => {
      let capturedBody: Record<string, unknown> = {};
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : {};
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursement, status: 'Released', version: 6 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useReleaseDisbursement(), { wrapper });

      // ENABLED: object syntax with payment data
      localStorage.setItem('erp_feature_override_strict_occ', 'true');
      await result.current.releaseDisbursement({
        id: 'disb-stress-201',
        data: {
          method: 'Bank Transfer',
          reference: 'BT-998877',
          bank: 'BPI',
        },
        expectedVersion: 5,
      });
      expect(capturedBody).toEqual({ expectedVersion: 5 });

      // DISABLED: unconditionally passes expectedVersion
      localStorage.setItem('erp_feature_override_strict_occ', 'false');
      await result.current.releaseDisbursement({
        id: 'disb-stress-201',
        data: {
          method: 'Bank Transfer',
          reference: 'BT-998877',
          bank: 'BPI',
        },
        expectedVersion: 5,
      });
      expect(capturedBody).toEqual({ expectedVersion: 5 });
      expect(capturedBody.expectedVersion).toBe(5);
    });
  });

  // =========================================================================
  // Dimension 4: BlockingActionModal Unblocking & Conflict Modal Isolation
  // =========================================================================
  describe('Dimension 4: UI Unblocking Guarantees & Non-OCC Bypass', () => {
    it('Billing: Non-OCC 500 error does NOT open ConflictResolutionModal and leaves it closed', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-stress-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoice }),
          } as Response);
        }

        if (u.includes('/invoices/inv-stress-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({
              status: 500,
              code: 'INTERNAL_SERVER_ERROR',
              detail: 'Database connection failed unexpectedly',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-stress-101"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      // Attempt transition status (submit for approval)
      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      fireEvent.click(submitBtn);

      // Conflict resolution modal MUST NOT open for 500
      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });
    });

    it('Disbursements: Non-OCC 500 error does NOT open ConflictResolutionModal on approve', async () => {
      useSessionStore.setState({ user: { ...useSessionStore.getState().user!, role: 'Admin' } });
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-stress-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursement }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-stress-201/approve') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({
              status: 500,
              code: 'FATAL_DB_CRASH',
              detail: 'Deadlock detected on ledger write',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-stress-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });

      const approveBtn = screen.getByTestId('drawer-direct-approve-btn');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      // Wait for the actual 500 response, then verify it is not misclassified as a conflict.
      await waitFor(() => {
        expect(useBlockingModalStore.getState().status).toBe('error');
        expect(useBlockingModalStore.getState().error?.status).toBe(500);
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });
    });

    it('Billing: Archive action HTTP 409 unblocks BlockingActionModal and opens ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-stress-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoice }),
          } as Response);
        }

        if (u.includes('/invoices/inv-stress-101/archive') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Invoice was already modified by another admin.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-stress-101"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      const archiveBtn = screen.getByTestId('btn-archive-invoice');
      fireEvent.click(archiveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // Verify unblocking
      expect(useBlockingModalStore.getState().isOpen).toBe(false);
    });

    it('Billing: Delete action HTTP 409 unblocks BlockingActionModal and opens ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-stress-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoice }),
          } as Response);
        }

        if (u.includes('/invoices/inv-stress-101') && method === 'DELETE') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'CONCURRENCY_CONFLICT',
              detail: 'Invoice status changed concurrently, cannot delete.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-stress-101"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      const deleteBtn = screen.getByTestId('btn-delete-invoice');
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // Verify unblocking
      expect(useBlockingModalStore.getState().isOpen).toBe(false);
    });
  });

  // =========================================================================
  // Dimension 5: Cache Invalidation Exact Query Keys Stress
  // =========================================================================
  describe('Dimension 5: Cache Invalidation Exact Keys Contract', () => {
    it('Billing: "Refresh & Keep Latest" executes cache invalidations on billingKeys.invoiceDetail and billingKeys.invoices', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-stress-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoice }),
          } as Response);
        }

        if (u.includes('/invoices/inv-stress-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'CONCURRENCY_CONFLICT',
              detail: 'Modified on server',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const invalidateSpy = vi.spyOn(apiQueryClient, 'invalidateQueries');

      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-stress-101"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        // Assert EXACT query keys
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: billingKeys.invoiceDetail('inv-stress-101'),
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: billingKeys.invoices(),
        });
      });

      // Verify modal is dismissed
      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });
    });

    it('Disbursements: "Refresh & Keep Latest" executes cache invalidations on disbursementKeys.detail and disbursementKeys.lists', async () => {
      useSessionStore.setState({ user: { ...useSessionStore.getState().user!, role: 'Admin' } });
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-stress-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursement }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-stress-201/approve') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'CONCURRENCY_CONFLICT',
              detail: 'Voucher version mismatch',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper, queryClient } = createHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(
        <DisbursementDetailDrawer
          id="disb-stress-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });

      const approveBtn = screen.getByTestId('drawer-direct-approve-btn');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        // Assert EXACT query keys
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: disbursementKeys.detail('disb-stress-201'),
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: disbursementKeys.lists(),
        });
      });

      // Verify modal is dismissed
      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Dimension 6: Extreme Boundary Scenarios & Robustness
  // =========================================================================
  describe('Dimension 6: Extreme Boundary Scenarios & UI Robustness', () => {
    it('handles 4,000-character detail payload without crashing or layout blowout', async () => {
      const hugeDetail = 'OCC_CONFLICT_LONG_STRING_'.repeat(160); // 4000 chars

      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-stress-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoice }),
          } as Response);
        }

        if (u.includes('/invoices/inv-stress-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'CONCURRENCY_CONFLICT',
              detail: hugeDetail,
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-stress-101"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      expect(screen.getByText('Record Out of Sync')).toBeInTheDocument();
      expect(screen.getByTestId('conflict-refresh-btn')).toBeInTheDocument();
      expect(screen.getByTestId('conflict-cancel-btn')).toBeInTheDocument();
    });

    it('handles rapid sequential clicking on Cancel without unhandled rejection or state corruption', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-stress-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoice }),
          } as Response);
        }

        if (u.includes('/invoices/inv-stress-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'CONCURRENCY_CONFLICT',
              detail: 'Conflict',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-stress-101"
          initialInvoice={mockInvoice}
        />,
        { wrapper }
      );

      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      const cancelBtn = screen.getByTestId('conflict-cancel-btn');
      // Rapid 5x clicks
      fireEvent.click(cancelBtn);
      fireEvent.click(cancelBtn);
      fireEvent.click(cancelBtn);
      fireEvent.click(cancelBtn);
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });
    });
  });
});
