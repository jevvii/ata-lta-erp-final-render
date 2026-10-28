import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useDisbursementsList,
  useDisbursementDetail,
  useDisbursementCounts,
  useCreateDisbursement,
  useUpdateDisbursement,
  useSubmitDisbursement,
  useApproveDisbursement,
  useRejectDisbursement,
  useReleaseDisbursement,
  useReleasePayment,
  useFundDisbursement,
} from '../api/useDisbursements';
import { disbursementKeys } from '../api/queryKeys';
import { ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import * as tabSync from '@/lib/tabSync';
import { extractRfc7807Error, useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

describe('Disbursements Data Layer & Zero Optimistic Updates Doctrine', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
      ],
      activeEntity: 'ATA',
    });
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    useBlockingModalStore.getState().reset();
  });

  describe('Query Hooks', () => {
    it('1. useDisbursementsList queries GET /v1/disbursements with active entity and filters', async () => {
      const mockList = {
        data: [
          {
            id: 'disb-1',
            disbursement_number: 'DISB-ATA-20261004-001',
            entity_id: 'ent-1',
            category: 'Transportation',
            description: 'Grab taxi fare to RTC Makati',
            amount: 450,
            fund_source: 'Firm Fund',
            status: 'Approved',
            linked_work_request_id: 'wr-1',
            version: 1,
            created_at: '2026-10-04T05:00:00Z',
            updated_at: '2026-10-04T05:00:00Z',
          },
        ],
        meta: { total: 1, page: 1, limit: 20 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockList,
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(
        () => useDisbursementsList({ status: 'Approved', search: 'Makati', page: 1 }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data).toHaveLength(1);
      expect(result.current.data?.data[0]?.disbursement_number).toBe('DISB-ATA-20261004-001');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const url = fetchCall[0] as string;
      const options = fetchCall[1] as RequestInit;

      expect(url).toContain('/disbursements');
      expect(url).toContain('status=Approved');
      expect(url).toContain('search=Makati');
      expect((options.headers as Record<string, string>)['X-Active-Entity']).toBe('ATA');
    });

    it('2. useDisbursementDetail queries GET /v1/disbursements/:id', async () => {
      const mockDetail = {
        data: {
          id: 'disb-1',
          disbursement_number: 'DISB-ATA-20261004-001',
          entity_id: 'ent-1',
          category: 'Government Fee',
          description: 'BIR 0605 payment',
          amount: 500,
          fund_source: 'Client Fund',
          status: 'Pending',
          linked_work_request_id: 'wr-1',
          version: 1,
          created_at: '2026-10-04T05:00:00Z',
          updated_at: '2026-10-04T05:00:00Z',
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockDetail,
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useDisbursementDetail('disb-1'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe('disb-1');
      expect(result.current.data?.status).toBe('Pending');
    });

    it('3. useDisbursementCounts queries GET /v1/disbursements/counts', async () => {
      const mockCounts = {
        data: {
          active: 8,
          archived: 2,
          rejected: 1,
          awaitingRelease: 3,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockCounts,
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useDisbursementCounts(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.active).toBe(8);
      expect(result.current.data?.awaitingRelease).toBe(3);
    });
  });

  describe('Mutation Hooks & Zero Optimistic Updates Doctrine', () => {
    it('4. useCreateDisbursement submits POST /v1/disbursements without status field and invalidates cache', async () => {
      const createdRecord = {
        id: 'disb-new',
        disbursement_number: 'DISB-ATA-20261004-099',
        entity_id: 'ent-1',
        category: 'Supplies',
        description: 'Legal forms folder supplies',
        amount: 1200,
        fund_source: 'Firm Fund',
        status: 'Draft',
        linked_work_request_id: '11111111-1111-1111-1111-111111111111',
        version: 1,
        created_at: '2026-10-04T05:30:00Z',
        updated_at: '2026-10-04T05:30:00Z',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: createdRecord }),
      });

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateDisbursement(), { wrapper });

      const payload = {
        category: 'Supplies',
        description: 'Legal forms folder supplies',
        amount: 1200,
        fundSource: 'Firm Fund' as const,
        linkedWorkRequestId: '11111111-1111-1111-1111-111111111111',
        linkedTaskId: '22222222-2222-2222-2222-222222222222',
      };

      const res = await result.current.createDisbursement(payload);
      expect(res.id).toBe('disb-new');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/disbursements');
      const body = JSON.parse(fetchCall[1]!.body as string);

      // Verify Status Anti-Forgery: NO status field in the sent JSON payload!
      expect(body.status).toBeUndefined();
      expect(body.description).toBe('Legal forms folder supplies');

      // Verify cache invalidation
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: disbursementKeys.counts('ATA'),
      });
    });

    it('5. useUpdateDisbursement updates via PUT /v1/disbursements/:id, pins cache, dispatches tabSync broadcast', async () => {
      const initialRecord = {
        id: 'disb-1',
        description: 'Original expense description',
        amount: 450,
        status: 'Draft',
        version: 1,
      };
      const updatedRecord = {
        ...initialRecord,
        description: 'Updated expense description',
        version: 2,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: updatedRecord }),
      });

      const broadcastSpy = vi.spyOn(tabSync, 'broadcastEntityChange');
      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      // Seed detail and list caches
      queryClient.setQueryData(disbursementKeys.detail('disb-1'), initialRecord);
      queryClient.setQueryData(disbursementKeys.list('ATA'), {
        data: [initialRecord],
        meta: { total: 1, page: 1, limit: 20 },
      });

      const { result } = renderHook(() => useUpdateDisbursement(), { wrapper });

      await result.current.updateDisbursement({
        id: 'disb-1',
        data: { description: 'Updated expense description', expectedVersion: 1 },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/disbursements/disb-1');
      expect(fetchCall[1]!.method).toBe('PUT');

      // 1. Authoritative server truth pinned into detail cache
      expect(queryClient.getQueryData(disbursementKeys.detail('disb-1'))).toEqual(updatedRecord);

      // 2. Authoritative server truth patched into list cache
      const cachedList = queryClient.getQueryData<{ data: typeof updatedRecord[] }>(
        disbursementKeys.list('ATA')
      );
      expect(cachedList?.data[0]?.description).toBe('Updated expense description');
      expect(cachedList?.data[0]?.version).toBe(2);

      // 3. Tab sync broadcast dispatched
      expect(broadcastSpy).toHaveBeenCalledWith({
        domain: 'disbursements',
        entityId: 'disb-1',
        entityData: updatedRecord,
      });

      // 4. Secondary counts invalidated, detail cache NEVER invalidated (eliminating flash-revert)
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: disbursementKeys.counts('ATA'),
      });
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: disbursementKeys.detail('disb-1'),
      });
    });

    it('6. useSubmitDisbursement submits Draft for review (POST /:id/submit)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { id: 'disb-1', status: 'Pending' } }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useSubmitDisbursement(), { wrapper });

      const res = await result.current.submitDisbursement('disb-1');
      expect(res.status).toBe('Pending');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/disbursements/disb-1/submit');
      expect(fetchCall[1]!.method).toBe('POST');
    });

    it('7. useApproveDisbursement approves Pending voucher, pins server truth, and broadcasts tabSync', async () => {
      const initialRecord = {
        id: 'disb-1',
        status: 'Pending',
        version: 1,
      };
      const approvedRecord = {
        ...initialRecord,
        status: 'Approved',
        version: 2,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: approvedRecord }),
      });

      const broadcastSpy = vi.spyOn(tabSync, 'broadcastEntityChange');
      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      queryClient.setQueryData(disbursementKeys.detail('disb-1'), initialRecord);
      queryClient.setQueryData(disbursementKeys.list('ATA'), {
        data: [initialRecord],
        meta: { total: 1, page: 1, limit: 20 },
      });

      const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

      const res = await result.current.approveDisbursement('disb-1');
      expect(res.status).toBe('Approved');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/disbursements/disb-1/approve');
      expect(fetchCall[1]!.method).toBe('POST');

      // Authoritative detail cache pinned
      expect(queryClient.getQueryData(disbursementKeys.detail('disb-1'))).toEqual(approvedRecord);

      // List cache patched in place
      const cachedList = queryClient.getQueryData<{ data: typeof approvedRecord[] }>(
        disbursementKeys.list('ATA')
      );
      expect(cachedList?.data[0]?.status).toBe('Approved');

      // Tab sync broadcast
      expect(broadcastSpy).toHaveBeenCalledWith({
        domain: 'disbursements',
        entityId: 'disb-1',
        entityData: approvedRecord,
      });

      // Secondary counts only
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: disbursementKeys.counts('ATA'),
      });
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: disbursementKeys.detail('disb-1'),
      });
    });

    it('8. useRejectDisbursement rejects Pending voucher with reason, pins server truth, and broadcasts tabSync', async () => {
      const initialRecord = {
        id: 'disb-1',
        status: 'Pending',
        version: 1,
      };
      const rejectedRecord = {
        ...initialRecord,
        status: 'Rejected',
        rejection_reason: 'Disallowed expenditure item',
        version: 2,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          data: rejectedRecord,
        }),
      });

      const broadcastSpy = vi.spyOn(tabSync, 'broadcastEntityChange');
      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      queryClient.setQueryData(disbursementKeys.detail('disb-1'), initialRecord);
      queryClient.setQueryData(disbursementKeys.list('ATA'), {
        data: [initialRecord],
        meta: { total: 1, page: 1, limit: 20 },
      });

      const { result } = renderHook(() => useRejectDisbursement(), { wrapper });

      const res = await result.current.rejectDisbursement({
        id: 'disb-1',
        reason: 'Disallowed expenditure item',
      });
      expect(res.status).toBe('Rejected');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/disbursements/disb-1/reject');
      expect(fetchCall[1]!.method).toBe('POST');
      const body = JSON.parse(fetchCall[1]!.body as string);
      expect(body.reason).toBe('Disallowed expenditure item');

      // Authoritative detail pinned
      expect(queryClient.getQueryData(disbursementKeys.detail('disb-1'))).toEqual(rejectedRecord);

      // Tab sync broadcast
      expect(broadcastSpy).toHaveBeenCalledWith({
        domain: 'disbursements',
        entityId: 'disb-1',
        entityData: rejectedRecord,
      });

      // Secondary counts only
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: disbursementKeys.counts('ATA'),
      });
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: disbursementKeys.detail('disb-1'),
      });
    });

    it('9. useReleaseDisbursement records payment release, pins server truth, and verifies useReleasePayment alias', async () => {
      const initialRecord = {
        id: 'disb-1',
        status: 'Approved',
        version: 2,
      };
      const releasedRecord = {
        ...initialRecord,
        status: 'Released',
        version: 3,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: releasedRecord }),
      });

      const broadcastSpy = vi.spyOn(tabSync, 'broadcastEntityChange');
      const { queryClient, wrapper } = createWrapper();

      queryClient.setQueryData(disbursementKeys.detail('disb-1'), initialRecord);
      queryClient.setQueryData(disbursementKeys.list('ATA'), {
        data: [initialRecord],
        meta: { total: 1, page: 1, limit: 20 },
      });

      // Contract alias verification
      expect(useReleasePayment).toBe(useReleaseDisbursement);

      const { result } = renderHook(() => useReleaseDisbursement(), { wrapper });

      const res = await result.current.releaseDisbursement({
        id: 'disb-1',
        data: {
          method: 'Check',
          reference: 'CHK-9021',
          bank: 'BDO',
        },
      });
      expect(res.status).toBe('Released');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/disbursements/disb-1/release');

      // Authoritative detail pinned
      expect(queryClient.getQueryData(disbursementKeys.detail('disb-1'))).toEqual(releasedRecord);

      // Tab sync broadcast
      expect(broadcastSpy).toHaveBeenCalledWith({
        domain: 'disbursements',
        entityId: 'disb-1',
        entityData: releasedRecord,
      });
    });

    it('10. useFundDisbursement marks as funded (POST /:id/fund)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { id: 'disb-1', status: 'Funded' } }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useFundDisbursement(), { wrapper });

      const res = await result.current.fundDisbursement('disb-1');
      expect(res.status).toBe('Funded');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/disbursements/disb-1/fund');
    });

    it('11. rolls back cache to snapshot on mutation failure (Phase 1 snapshot -> onError restore)', async () => {
      const initialRecord = {
        id: 'disb-rollback-1',
        status: 'Pending',
        description: 'Original description',
        version: 1,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          status: 409,
          code: 'ERR_CONCURRENCY_CONFLICT',
          detail: 'Record was modified by another user.',
        }),
      });

      const { queryClient, wrapper } = createWrapper();

      // Seed cache snapshot
      queryClient.setQueryData(disbursementKeys.detail('disb-rollback-1'), initialRecord);
      queryClient.setQueryData(disbursementKeys.list('ATA'), {
        data: [initialRecord],
        meta: { total: 1, page: 1, limit: 20 },
      });

      const { result } = renderHook(() => useUpdateDisbursement(), { wrapper });

      await expect(
        result.current.updateDisbursement({
          id: 'disb-rollback-1',
          data: { description: 'Conflicting edit', expectedVersion: 1 },
        })
      ).rejects.toThrow();

      // Cache remains exactly the snapshot version after rollback
      const detailAfterError = queryClient.getQueryData<typeof initialRecord>(
        disbursementKeys.detail('disb-rollback-1')
      );
      expect(detailAfterError?.description).toBe('Original description');
      expect(detailAfterError?.status).toBe('Pending');
      expect(detailAfterError?.version).toBe(1);

      const listAfterError = queryClient.getQueryData<{ data: typeof initialRecord[] }>(
        disbursementKeys.list('ATA')
      );
      expect(listAfterError?.data[0]?.description).toBe('Original description');
    });
  });

  describe('RFC 7807 Verbatim Error Surfacing & Zero Optimistic Updates', () => {
    it('surfaces backend 409 Conflict with verbatim code and detail', async () => {
      const rfc7807Response = {
        status: 409,
        title: 'Invalid Transition',
        code: 'CONFLICT_CURRENT_STATUS',
        detail: 'Cannot approve a disbursement in "Draft" status. Expected: Pending.',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => rfc7807Response,
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

      let thrownError: unknown = null;
      try {
        await result.current.approveDisbursement('disb-draft');
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(ApiError);
      const apiErr = thrownError as ApiError;
      expect(apiErr.status).toBe(409);
      expect(apiErr.code).toBe('CONFLICT_CURRENT_STATUS');
      expect(apiErr.detail).toBe(
        'Cannot approve a disbursement in "Draft" status. Expected: Pending.'
      );

      // Verify RFC 7807 extractor preserves verbatim values
      const extracted = extractRfc7807Error(apiErr);
      expect(extracted.code).toBe('CONFLICT_CURRENT_STATUS');
      expect(extracted.detail).toBe(
        'Cannot approve a disbursement in "Draft" status. Expected: Pending.'
      );
      expect(extracted.title).toBe('Conflict');
    });

    it('surfaces 400 Bad Request with STATUS_FORGERY_PROHIBITED verbatim', async () => {
      const rfc7807Response = {
        status: 400,
        title: 'Bad Request',
        code: 'STATUS_FORGERY_PROHIBITED',
        detail: 'Explicit status cannot be set on creation; status forgery is prohibited',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => rfc7807Response,
      });

      const apiErr = new ApiError(
        400,
        'Bad Request',
        rfc7807Response.detail,
        rfc7807Response.code
      );
      const extracted = extractRfc7807Error(apiErr);

      expect(extracted.code).toBe('STATUS_FORGERY_PROHIBITED');
      expect(extracted.detail).toBe(
        'Explicit status cannot be set on creation; status forgery is prohibited'
      );
    });
  });
});
