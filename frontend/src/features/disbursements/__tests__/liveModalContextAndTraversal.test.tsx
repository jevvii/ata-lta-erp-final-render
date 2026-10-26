import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminApprovalModal } from '../components/AdminApprovalModal';
import { FundDisbursementModal } from '../components/FundDisbursementModal';
import { ReleaseFundsModal } from '../components/FundsReleaseActions';
import { fetchAllDisbursementsForQueue } from '../api/useDisbursements';
import { useSessionStore } from '@/lib/session';
import type { Disbursement } from '../api/types';

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

describe('Live Modal Context, Deferred Promises & Complete Queue Traversal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
        entities: ['ATA'],
      },
      permissions: [
        'disbursement:view',
        'disbursement:create',
        'disbursement:approve',
        'disbursement:mark_released',
        'disbursement:edit',
      ],
      activeEntity: 'ATA',
    });
  });

  describe('Modal Async Guards with Deferred Promises', () => {
    it('AdminApprovalModal discards late resolution when modal closes during flight', async () => {
      let resolvePromise: (val: unknown) => void = () => {};
      const deferredPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/approve')) {
          await deferredPromise;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'disb-async-1', status: 'Approved', version: 2 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const mockDisbursement: Disbursement = {
        id: 'disb-async-1',
        disbursement_number: 'DISB-ASYNC-001',
        entity_id: 'ent-1',
        category: 'Transportation',
        description: 'Async test item',
        amount: 500,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const onClose = vi.fn();
      const onSuccess = vi.fn();

      const { wrapper } = createHarness();
      const { rerender } = render(
        <AdminApprovalModal
          isOpen={true}
          disbursement={mockDisbursement}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
        { wrapper }
      );

      // Click Confirm Approval -> initiates request
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      // Simulate user closing the modal before API settles
      rerender(
        <AdminApprovalModal
          isOpen={false}
          disbursement={mockDisbursement}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      );

      // Now resolve the deferred API promise
      resolvePromise(true);

      // Allow microtasks to execute
      await new Promise((r) => setTimeout(r, 20));

      // Because the modal was closed when API settled, isStale() was true, so callbacks must NOT be called again
      expect(onSuccess).not.toHaveBeenCalled();
    });

    it('FundDisbursementModal discards late resolution when active session user switches during flight', async () => {
      let resolvePromise: (val: unknown) => void = () => {};
      const deferredPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/fund')) {
          await deferredPromise;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'disb-fund-async', status: 'Funded', version: 2 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const mockApproved: Disbursement = {
        id: 'disb-fund-async',
        disbursement_number: 'DISB-FUND-001',
        entity_id: 'ent-1',
        category: 'Supplies',
        description: 'Async fund item',
        amount: 1200,
        fund_source: 'Firm Fund',
        status: 'Approved',
        lifecycle_version: 2,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const onClose = vi.fn();
      const onSuccess = vi.fn();

      const { wrapper } = createHarness();
      render(
        <FundDisbursementModal
          isOpen={true}
          disbursement={mockApproved}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
        { wrapper }
      );

      // Fill in required payment instrument fields
      fireEvent.change(screen.getByTestId('input-fund-bank'), { target: { value: 'BDO Unibank' } });
      fireEvent.change(screen.getByTestId('input-fund-reference'), { target: { value: 'CHK-99881122' } });

      // Click Confirm & Record Payment
      fireEvent.click(screen.getByTestId('btn-confirm-fund'));

      // Switch session user while request is in flight
      useSessionStore.getState().setSession({
        user: {
          id: 'u-other-user-999',
          email: 'other@ata-lta.ph',
          name: 'Other User',
          role: 'Admin',
          departments: ['Administration'],
          entities: ['ATA'],
        },
        permissions: ['disbursement:view'],
        activeEntity: 'ATA',
      });

      // Now resolve the API promise
      resolvePromise(true);

      await new Promise((r) => setTimeout(r, 20));

      // Because user identity changed, response must be discarded
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('ReleaseFundsModal discards late resolution when active entity switches during flight', async () => {
      let resolvePromise: (val: unknown) => void = () => {};
      const deferredPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/release')) {
          await deferredPromise;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'disb-rel-async', status: 'Released', version: 2 } }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const mockFunded: Disbursement = {
        id: 'disb-rel-async',
        disbursement_number: 'DISB-REL-001',
        entity_id: 'ent-1',
        category: 'Professional Fee',
        description: 'Async release item',
        amount: 800,
        fund_source: 'Firm Fund',
        status: 'Funded',
        lifecycle_version: 2,
        version: 1,
        funded_by: 'u-different-preparer',
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const onClose = vi.fn();
      const onSuccess = vi.fn();

      const { wrapper } = createHarness();
      render(
        <ReleaseFundsModal
          isOpen={true}
          disbursement={mockFunded}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
        { wrapper }
      );

      // Click Confirm & Sanction Release
      fireEvent.click(screen.getByTestId('submit-release-funds-btn'));

      // Switch active entity during flight
      useSessionStore.getState().setActiveEntity('LTA');

      // Resolve the deferred API response
      resolvePromise(true);

      await new Promise((r) => setTimeout(r, 20));

      // Must be discarded due to entity switch
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('Complete Queue Traversal Across >100 Records', () => {
    it('fetchAllDisbursementsForQueue paginates and aggregates 250 records across 3 pages', async () => {
      const totalItems = 250;
      const allMockItems: Disbursement[] = Array.from({ length: totalItems }, (_, i) => ({
        id: `disb-trav-${i + 1}`,
        disbursement_number: `DISB-TRAV-${String(i + 1).padStart(3, '0')}`,
        entity_id: 'ent-1',
        category: 'Legal Fee',
        description: `Traversed item ${i + 1}`,
        amount: 100 * (i + 1),
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: new Date(Date.now() - i * 1000).toISOString(),
        updated_at: new Date(Date.now() - i * 1000).toISOString(),
      }));

      const queriedPages: number[] = [];

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const queue = u.searchParams.get('queue');
        const page = parseInt(u.searchParams.get('page') || '1', 10);
        const limit = parseInt(u.searchParams.get('limit') || '100', 10);

        if (queue === 'initial_requests') {
          queriedPages.push(page);
          const start = (page - 1) * limit;
          const pageData = allMockItems.slice(start, start + limit);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: pageData,
              meta: { total: totalItems, page, limit },
            }),
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [], meta: { total: 0 } }),
        };
      });

      const result = await fetchAllDisbursementsForQueue('initial_requests');

      // Must traverse pages 1, 2, and 3
      expect(queriedPages).toEqual([1, 2, 3]);
      // Must collect all 250 items without omission
      expect(result).toHaveLength(250);
      expect(result[0]!.id).toBe('disb-trav-1');
      expect(result[100]!.id).toBe('disb-trav-101');
      expect(result[249]!.id).toBe('disb-trav-250');
    });

    it('fetchAllDisbursementsForQueue throws deduplication no-progress guard when server returns repeat page', async () => {
      const hundredItems: Disbursement[] = Array.from({ length: 100 }, (_, i) => ({
        id: `disb-stuck-${i + 1}`,
        disbursement_number: `DISB-STUCK-${i + 1}`,
        entity_id: 'ent-1',
        category: 'Supplies',
        description: `Stuck item ${i + 1}`,
        amount: 100,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = new URL(url, 'http://localhost');
        const page = parseInt(u.searchParams.get('page') || '1', 10);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: hundredItems, // Page 1 and Page 2 both return same 100 items
            meta: { total: 200, page, limit: 100 },
          }),
        };
      });

      await expect(fetchAllDisbursementsForQueue('initial_requests')).rejects.toThrow(
        /pagination made no progress/i
      );
    });
  });
});
