import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import {
  updateInvoiceAction,
  updateClientAddressAction,
} from '../api/useBillingMutations';

import {
  useApproveDisbursement,
  useRejectDisbursement,
  useFundDisbursement,
  useReleaseDisbursement,
} from '../../disbursements/api/useDisbursements';

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
  id: 'inv-adv-probe-1',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-2026-ADV-PROBE',
  client_id: 'client-adv-1',
  issue_date: '2026-10-18',
  due_date: '2026-11-18',
  status: 'Draft',
  subtotal: 50000,
  total: 50000,
  amount_paid: 0,
  balance: 50000,
  address: '123 Test Street, Manila',
  notes: 'Adversarial probe notes',
  terms: 'Net 30 days',
  version: 1,
  created_at: '2026-10-18T00:00:00Z',
  updated_at: '2026-10-18T00:00:00Z',
  clients: {
    name: 'Probe Corporation',
    tin: '111-222-333-000',
    address: '123 Test Street, Manila',
  },
  line_items: [
    {
      id: 'li-1',
      description: 'Audit Consulting',
      amount: 50000,
      type: 'Professional Fee',
    },
  ],
  payments: [],
};

const mockDisbursement: Disbursement = {
  id: 'disb-adv-probe-1',
  disbursement_number: 'DISB-ATA-20261018-PROBE',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Filing Fees',
  description: 'Adversarial Probe Voucher',
  amount: 25000,
  fund_source: 'Firm Fund',
  status: 'Pending',
  linked_work_request_id: 'wr-probe-1',
  version: 1,
  created_at: '2026-10-18T00:00:00Z',
  updated_at: '2026-10-18T00:00:00Z',
  client_name: 'Probe Corporation',
};

describe('Challenger M3.2 Adversarial OCC Probe: Unconditional expectedVersion Preservation', () => {
  const originalFetch = global.fetch;
  let capturedBody: Record<string, unknown> | null = null;
  let capturedUrl: string = '';
  let capturedMethod: string = '';

  const FLAG_CASES: Array<{ label: string; value: string | null }> = [
    { label: "strict_occ = 'false'", value: 'false' },
    { label: "strict_occ = 'true'", value: 'true' },
    { label: "strict_occ = 'null'", value: 'null' },
    { label: "strict_occ = 'undefined'", value: 'undefined' },
    { label: "strict_occ = 'random_arbitrary_flag_XYZ_999'", value: 'random_arbitrary_flag_XYZ_999' },
    { label: 'strict_occ removed from localStorage', value: null },
  ];

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    capturedBody = null;
    capturedUrl = '';
    capturedMethod = '';

    global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
      capturedUrl = url;
      capturedMethod = opts?.method || 'GET';
      capturedBody = opts?.body ? JSON.parse(String(opts.body)) : null;

      if (url.includes('/invoices/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockInvoice, version: 2 } }),
        } as Response);
      }

      if (url.includes('/disbursements/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockDisbursement, version: 2 } }),
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
    localStorage.clear();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function setFlag(flagVal: string | null) {
    if (flagVal === null) {
      localStorage.removeItem('erp_feature_override_strict_occ');
    } else {
      localStorage.setItem('erp_feature_override_strict_occ', flagVal);
    }
  }

  describe('1. Billing: updateInvoiceAction payload preservation across all flag variations', () => {
    FLAG_CASES.forEach(({ label, value }) => {
      it(`preserves explicit expectedVersion when ${label}`, async () => {
        setFlag(value);
        await updateInvoiceAction(
          'inv-adv-probe-1',
          { terms: 'Net 15 days', notes: 'Updated notes' },
          12,
          'ATA'
        );

        expect(capturedUrl).toContain('/invoices/inv-adv-probe-1');
        expect(capturedMethod).toBe('PATCH');
        expect(capturedBody).not.toBeNull();
        expect(capturedBody?.expectedVersion).toBe(12);
        expect(capturedBody).toEqual({
          terms: 'Net 15 days',
          notes: 'Updated notes',
          expectedVersion: 12,
        });
      });

      it(`preserves data-embedded expectedVersion when ${label}`, async () => {
        setFlag(value);
        await updateInvoiceAction(
          'inv-adv-probe-1',
          { terms: 'Net 60 days', expectedVersion: 45 },
          undefined,
          'ATA'
        );

        expect(capturedBody?.expectedVersion).toBe(45);
        expect(capturedBody).toEqual({
          terms: 'Net 60 days',
          expectedVersion: 45,
        });
      });

      it(`preserves expectedVersion when 3rd arg is string entity and data has expectedVersion when ${label}`, async () => {
        setFlag(value);
        await updateInvoiceAction(
          'inv-adv-probe-1',
          { terms: 'Net 90 days', expectedVersion: 99 },
          'ATA'
        );

        expect(capturedBody?.expectedVersion).toBe(99);
      });

      it(`preserves boundary version 0 when ${label}`, async () => {
        setFlag(value);
        await updateInvoiceAction(
          'inv-adv-probe-1',
          { notes: 'Boundary zero' },
          0,
          'ATA'
        );

        expect(capturedBody?.expectedVersion).toBe(0);
      });
    });
  });

  describe('2. Billing: updateClientAddressAction payload preservation across all flag variations', () => {
    FLAG_CASES.forEach(({ label, value }) => {
      it(`preserves explicit expectedVersion when ${label}`, async () => {
        setFlag(value);
        await updateClientAddressAction(
          'inv-adv-probe-1',
          'Unit 404, Enterprise Center, Makati',
          33,
          'ATA'
        );

        expect(capturedUrl).toContain('/invoices/inv-adv-probe-1');
        expect(capturedMethod).toBe('PATCH');
        expect(capturedBody).not.toBeNull();
        expect(capturedBody?.expectedVersion).toBe(33);
        expect(capturedBody).toEqual({
          address: 'Unit 404, Enterprise Center, Makati',
          expectedVersion: 33,
        });
      });

      it(`preserves boundary version 0 when ${label}`, async () => {
        setFlag(value);
        await updateClientAddressAction(
          'inv-adv-probe-1',
          'Unit 404, Enterprise Center, Makati',
          0,
          'ATA'
        );

        expect(capturedBody?.expectedVersion).toBe(0);
      });
    });
  });

  describe('3. Disbursements: useApproveDisbursement payload preservation across all flag variations', () => {
    FLAG_CASES.forEach(({ label, value }) => {
      it(`preserves approval version and excludes payment fields when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

        await result.current.approveDisbursement({
          id: 'disb-adv-probe-1',
          method: 'Bank Transfer',
          reference: 'REF-7788',
          bank: 'BPI',
          date: '2026-10-18',
          expectedVersion: 50,
        });

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/approve');
        expect(capturedMethod).toBe('POST');
        expect(capturedBody?.expectedVersion).toBe(50);
        expect(capturedBody).toEqual({ expectedVersion: 50 });
      });

      it(`preserves expectedVersion in approveWithBlocking positional syntax when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

        await result.current.approveWithBlocking('disb-adv-probe-1', 51);

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/approve');
        expect(capturedBody?.expectedVersion).toBe(51);
        expect(capturedBody).toEqual({
          expectedVersion: 51,
        });
      });

      it(`preserves boundary version 0 in approveDisbursement when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

        await result.current.approveDisbursement({
          id: 'disb-adv-probe-1',
          expectedVersion: 0,
        });

        expect(capturedBody?.expectedVersion).toBe(0);
      });
    });
  });

  describe('4. Disbursements: useRejectDisbursement payload preservation across all flag variations', () => {
    FLAG_CASES.forEach(({ label, value }) => {
      it(`preserves expectedVersion in rejectDisbursement object syntax when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useRejectDisbursement(), { wrapper });

        await result.current.rejectDisbursement({
          id: 'disb-adv-probe-1',
          reason: 'Duplicate voucher request submitted',
          expectedVersion: 60,
        });

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/reject');
        expect(capturedMethod).toBe('POST');
        expect(capturedBody?.expectedVersion).toBe(60);
        expect(capturedBody).toEqual({
          reason: 'Duplicate voucher request submitted',
          expectedVersion: 60,
        });
      });

      it(`preserves expectedVersion in rejectWithBlocking positional syntax when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useRejectDisbursement(), { wrapper });

        await result.current.rejectWithBlocking(
          'disb-adv-probe-1',
          'Incorrect amount billed',
          61
        );

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/reject');
        expect(capturedBody?.expectedVersion).toBe(61);
        expect(capturedBody).toEqual({
          reason: 'Incorrect amount billed',
          expectedVersion: 61,
        });
      });
    });
  });

  describe('5. Disbursements: useReleaseDisbursement payload preservation across all flag variations', () => {
    FLAG_CASES.forEach(({ label, value }) => {
      it(`preserves release version without replacing the instrument when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useReleaseDisbursement(), { wrapper });

        await result.current.releaseDisbursement({
          id: 'disb-adv-probe-1',
          data: {
            method: 'Cash',
          },
          expectedVersion: 70,
        });

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/release');
        expect(capturedMethod).toBe('POST');
        expect(capturedBody?.expectedVersion).toBe(70);
        expect(capturedBody).toEqual({ expectedVersion: 70 });
      });

      it(`preserves expectedVersion in releaseWithBlocking positional syntax when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useReleaseDisbursement(), { wrapper });

        await result.current.releaseWithBlocking(
          'disb-adv-probe-1',
          { method: 'Bank Transfer' },
          71
        );

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/release');
        expect(capturedBody?.expectedVersion).toBe(71);
      });
    });
  });

  describe('6. Disbursements: useFundDisbursement payload preservation across all flag variations', () => {
    FLAG_CASES.forEach(({ label, value }) => {
      it(`preserves expectedVersion in fundDisbursement object syntax when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useFundDisbursement(), { wrapper });

        await result.current.fundDisbursement({
          id: 'disb-adv-probe-1',
          expectedVersion: 80,
        });

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/fund');
        expect(capturedMethod).toBe('POST');
        expect(capturedBody?.expectedVersion).toBe(80);
        expect(capturedBody).toEqual({
          expectedVersion: 80,
        });
      });

      it(`preserves expectedVersion in fundWithBlocking positional syntax when ${label}`, async () => {
        setFlag(value);
        const { wrapper } = createHarness();
        const { result } = renderHook(() => useFundDisbursement(), { wrapper });

        await result.current.fundWithBlocking('disb-adv-probe-1', 81);

        expect(capturedUrl).toContain('/disbursements/disb-adv-probe-1/fund');
        expect(capturedBody?.expectedVersion).toBe(81);
        expect(capturedBody).toEqual({
          expectedVersion: 81,
        });
      });
    });
  });

  describe('7. Absence / Non-numeric edge cases: does not fabricate or crash on non-version inputs', () => {
    it('updateInvoiceAction does not include expectedVersion when none is provided', async () => {
      await updateInvoiceAction(
        'inv-adv-probe-1',
        { notes: 'No version specified' },
        undefined,
        'ATA'
      );

      expect(capturedBody).not.toHaveProperty('expectedVersion');
    });

    it('updateInvoiceAction ignores non-numeric expectedVersion without crashing', async () => {
      await updateInvoiceAction(
        'inv-adv-probe-1',
        { notes: 'Invalid string version' },
        'not_a_number' as unknown as number,
        'ATA'
      );

      expect(capturedBody).not.toHaveProperty('expectedVersion');
    });

    it('useApproveDisbursement sends empty body or no expectedVersion when omitted', async () => {
      const { wrapper } = createHarness();
      const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

      await result.current.approveDisbursement('disb-adv-probe-1');

      expect(capturedBody).toBeNull();
    });

    it('useFundDisbursement sends empty body or no expectedVersion when string id only is passed', async () => {
      const { wrapper } = createHarness();
      const { result } = renderHook(() => useFundDisbursement(), { wrapper });

      await result.current.fundDisbursement('disb-adv-probe-1');

      expect(capturedBody).toBeNull();
    });
  });
});
