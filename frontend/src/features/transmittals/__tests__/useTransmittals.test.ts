import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import React from 'react';
import {
  useTransmittalsList,
  useTransmittalDetail,
  useTransmittalCounts,
  useCreateTransmittal,
  useUpdateTransmittal,
  useApproveTransmittal,
  useSendTransmittal,
  useAcknowledgeTransmittal,
  useArchiveTransmittal,
  useUnarchiveTransmittal,
  useDeleteTransmittal,
} from '../api/useTransmittals';
import { transmittalKeys } from '../api/queryKeys';
import { ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import {
  extractRfc7807Error,
  useBlockingModalStore,
} from '@/features/operations/components/BlockingActionModal';
import type { TransmittalWithItems } from '../api/types';

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

describe('Transmittals Data Layer & Zero Optimistic Updates Doctrine', () => {
  const originalFetch = global.fetch;
  const validUuid = '11111111-1111-1111-1111-111111111111';

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
        'transmittal:view',
        'transmittal:create',
        'transmittal:edit',
        'transmittal:approve',
        'transmittal:mark',
        'transmittal:delete',
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

  // ==========================================================================
  // 1. Data Query Hooks
  // ==========================================================================

  describe('1. useTransmittalsList', () => {
    it('fetches transmittal list with filters and active entity scoping', async () => {
      const mockResponse = {
        data: [
          {
            id: 'tx-1',
            tracking_number: 'TR-ATA-2026-0001',
            status: 'Draft',
            approved: false,
            board_order: 0,
            version: 1,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { total: 1, page: 1, limit: 50 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(
        () => useTransmittalsList({ status: 'Draft', search: 'TR-ATA' }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data).toHaveLength(1);
      expect(result.current.data?.data[0]?.tracking_number).toBe('TR-ATA-2026-0001');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const url = fetchCall[0] as string;
      expect(url).toContain('/transmittals?');
      expect(url).toContain('status=Draft');
      expect(url).toContain('search=TR-ATA');
    });
  });

  describe('2. useTransmittalDetail', () => {
    it('fetches single transmittal detail by ID', async () => {
      const mockDetail: { data: TransmittalWithItems } = {
        data: {
          id: 'tx-1',
          tracking_number: 'TR-ATA-2026-0001',
          entity_id: 'ent-1',
          client_id: validUuid,
          status: 'Draft',
          approved: false,
          board_order: 0,
          archived: false,
          version: 1,
          created_at: new Date().toISOString(),
          items: [
            {
              id: 'item-1',
              description: 'Tax Declaration',
              document_type: 'Tax',
              quantity: 1,
            },
          ],
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockDetail,
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTransmittalDetail('tx-1'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.tracking_number).toBe('TR-ATA-2026-0001');
      expect(result.current.data?.items).toHaveLength(1);
    });
  });

  it('does not retry a missing detail on failure or window focus, but allows manual retry', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', json: async () => ({ detail: 'Transmittal not found' }) });
    const { wrapper, queryClient } = createWrapper();
    const { result, unmount } = renderHook(() => useTransmittalDetail('missing'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { focusManager.setFocused(false); focusManager.setFocused(true); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.refetch(); });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    unmount();
    queryClient.clear();
    focusManager.setFocused(undefined);
  });

  describe('3. useTransmittalCounts', () => {
    it('fetches tab badge counts', async () => {
      const mockCounts = {
        data: {
          active: 10,
          archived: 2,
          total: 12,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockCounts,
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useTransmittalCounts(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.active).toBe(10);
      expect(result.current.data?.archived).toBe(2);
      expect(result.current.data?.total).toBe(12);
    });
  });

  // ==========================================================================
  // 2. Mutation Hooks & Zero Optimistic Updates Doctrine
  // ==========================================================================

  describe('4. useCreateTransmittal', () => {
    it('creates transmittal via blocking action and invalidates cache', async () => {
      const createdRecord: TransmittalWithItems = {
        id: 'tx-created-1',
        tracking_number: 'TR-ATA-2026-9999',
        entity_id: 'ent-1',
        client_id: validUuid,
        status: 'Draft',
        approved: false,
        board_order: 0,
        archived: false,
        version: 1,
        created_at: new Date().toISOString(),
        items: [{ id: 'i-1', description: 'BIR 2316', quantity: 2 }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: createdRecord }),
      });

      const { queryClient, wrapper } = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateTransmittal(), { wrapper });

      const res = await result.current.mutateAsync({
        clientId: validUuid,
        workRequestId: validUuid,
        trackingNumber: 'TR-ATA-2026-9999',
        items: [{ description: 'BIR 2316', quantity: 2 }],
      });

      expect(res.id).toBe('tx-created-1');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: transmittalKeys.all });
    });
  });

  describe('5. useUpdateTransmittal', () => {
    it('updates transmittal with expectedVersion header for OCC', async () => {
      const updatedRecord: TransmittalWithItems = {
        id: 'tx-1',
        tracking_number: 'TR-ATA-2026-0001-REV',
        entity_id: 'ent-1',
        client_id: validUuid,
        status: 'Draft',
        approved: false,
        board_order: 3,
        archived: false,
        version: 2,
        created_at: new Date().toISOString(),
        items: [],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: updatedRecord }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useUpdateTransmittal(), { wrapper });

      await result.current.mutateAsync({
        id: 'tx-1',
        data: {
          trackingNumber: 'TR-ATA-2026-0001-REV',
          boardOrder: 3,
          expectedVersion: 1,
        },
      });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const headers = fetchCall[1]?.headers as Record<string, string>;
      expect(headers['If-Match']).toBe('1');
    });
  });

  describe('6. useApproveTransmittal', () => {
    it('executes Admin direct approval (Draft -> Sent)', async () => {
      const approvedRecord = {
        id: 'tx-1',
        status: 'Sent',
        approved: true,
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: approvedRecord }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useApproveTransmittal(), { wrapper });

      await result.current.mutateAsync('tx-1');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/transmittals/tx-1/approve');
    });
  });

  describe('7. useSendTransmittal', () => {
    it('executes send transmittal mutation', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { id: 'tx-1', status: 'Sent' } }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useSendTransmittal(), { wrapper });

      await result.current.mutateAsync({ id: 'tx-1', data: { boardOrder: 4 } });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/transmittals/tx-1/send');
      const body = JSON.parse(fetchCall[1]?.body as string);
      expect(body.boardOrder).toBe(4);
    });
  });

  describe('8. useAcknowledgeTransmittal', () => {
    it('executes receipt acknowledgment mutation', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { id: 'tx-1', status: 'Acknowledged' } }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useAcknowledgeTransmittal(), { wrapper });

      await result.current.mutateAsync({ id: 'tx-1' });

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/transmittals/tx-1/acknowledge');
    });
  });

  describe('9. useArchiveTransmittal & useUnarchiveTransmittal', () => {
    it('archives transmittal', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { id: 'tx-1', archived: true } }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useArchiveTransmittal(), { wrapper });

      await result.current.mutateAsync('tx-1');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/transmittals/tx-1/archive');
    });

    it('unarchives transmittal', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { id: 'tx-1', archived: false } }),
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useUnarchiveTransmittal(), { wrapper });

      await result.current.mutateAsync('tx-1');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/transmittals/tx-1/unarchive');
    });
  });

  describe('10. useDeleteTransmittal', () => {
    it('soft-deletes transmittal with 204 No Content', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
        text: async () => '',
      });

      const { wrapper } = createWrapper();
      const { result } = renderHook(() => useDeleteTransmittal(), { wrapper });

      await result.current.mutateAsync('tx-1');

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(fetchCall[0]).toContain('/transmittals/tx-1');
      expect(fetchCall[1]?.method).toBe('DELETE');
    });
  });

  // ==========================================================================
  // 3. RFC 7807 Verbatim Error Extraction
  // ==========================================================================

  describe('11. Verbatim RFC 7807 Error Surfacing', () => {
    it('extracts RFC 7807 problem details verbatim from ApiError', () => {
      const rfcError = new ApiError(
        409,
        'Conflict',
        'Cannot edit transmittal in "Sent" status. Only Draft transmittals can be edited.',
        'CONFLICT'
      );

      const extracted = extractRfc7807Error(rfcError);
      expect(extracted.status).toBe(409);
      expect(extracted.code).toBe('CONFLICT');
      expect(extracted.detail).toBe(
        'Cannot edit transmittal in "Sent" status. Only Draft transmittals can be edited.'
      );
      expect(extracted.title).toBe('Conflict');
    });

    it('surfaces dual-path admin rejection detail verbatim on unapproved send', () => {
      const sendRejection = new ApiError(
        403,
        'Forbidden',
        'Cannot send transmittal because it has not been approved by Admin.',
        'FORBIDDEN'
      );

      const extracted = extractRfc7807Error(sendRejection);
      expect(extracted.status).toBe(403);
      expect(extracted.code).toBe('FORBIDDEN');
      expect(extracted.detail).toBe(
        'Cannot send transmittal because it has not been approved by Admin.'
      );
    });

    it('surfaces OCC concurrency conflict code and detail verbatim', () => {
      const occConflict = new ApiError(
        409,
        'Conflict',
        'The record was modified by another user. Please reload the latest version before editing.',
        'ERR_CONCURRENCY_CONFLICT'
      );

      const extracted = extractRfc7807Error(occConflict);
      expect(extracted.code).toBe('ERR_CONCURRENCY_CONFLICT');
      expect(extracted.detail).toBe(
        'The record was modified by another user. Please reload the latest version before editing.'
      );
    });
  });
});
