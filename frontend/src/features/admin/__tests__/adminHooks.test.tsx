import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useUsersList,
  useUserDetail,
  createUserAction,
  updateUserAction,
  disableUserAction,
} from '../api/useUsers';
import {
  useAuditLogsList,
  useAuditCount,
} from '../api/useAuditLogs';
import { isLocalMutation } from '@/lib/realtime';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { AdminUser, AuditLogResponse } from '../api/types';

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

const mockUsers: AdminUser[] = [
  {
    id: 'u-1',
    name: 'Juan Dela Cruz',
    email: 'juan@ata-lta.ph',
    role: 'Admin',
    departments: ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'],
    entities: ['ATA', 'LTA'],
    isActive: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'u-2',
    name: 'Maria Santos',
    email: 'maria@ata-lta.ph',
    role: 'Operations',
    departments: ['Operations'],
    entities: ['ATA'],
    isActive: true,
    version: 3,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
  },
];

const mockAuditLogs: AuditLogResponse = {
  data: [
    {
      id: 'aud-1',
      action: 'user.updated',
      tableName: 'users',
      recordId: 'u-2',
      entity: 'ATA',
      userId: 'u-1',
      details: {
        before: { role: 'Operations' },
        after: { role: 'Manager' },
      },
      createdAt: '2026-10-04T08:00:00Z',
    },
  ],
  meta: {
    total: 1,
    limit: 20,
    offset: 0,
    hasMore: false,
  },
};

describe('Admin Data Layer: TanStack Query Hooks, OCC, CDC Loop Prevention & Audit Logs', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-1',
        email: 'juan@ata-lta.ph',
        name: 'Juan Dela Cruz',
        role: 'Admin',
        departments: ['Management', 'Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: ['users:view', 'users:manage', 'retainers:use', 'retainers:edit'],
      activeEntity: 'ALL',
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    useBlockingModalStore.getState().reset();
  });

  describe('User Query Hooks', () => {
    it('useUsersList fetches users array from /v1/admin/users', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: mockUsers }),
      } as Response);

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useUsersList(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.length).toBe(2);
      expect(result.current.data?.[0]?.name).toBe('Juan Dela Cruz');
    });

    it('useUserDetail fetches individual user details', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: mockUsers[1] }),
      } as Response);

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useUserDetail('u-2'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.id).toBe('u-2');
      expect(result.current.data?.role).toBe('Operations');
    });
  });

  describe('User Mutation Actions (runBlockingAction + OCC + Loop Prevention)', () => {
    it('createUserAction executes POST, registers local mutation, and handles success', async () => {
      const newUser: AdminUser = {
        id: 'u-3',
        name: 'Pedro Reyes',
        email: 'pedro@ata-lta.ph',
        role: 'Documentation',
        departments: ['Documentation'],
        entities: ['LTA'],
        isActive: true,
        version: 1,
        createdAt: '2026-10-04T00:00:00Z',
        updatedAt: '2026-10-04T00:00:00Z',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ data: newUser }),
      } as Response);

      const res = await createUserAction({
        name: 'Pedro Reyes',
        email: 'pedro@ata-lta.ph',
        role: 'Documentation',
        departments: ['Documentation'],
        entities: ['LTA'],
      });

      expect(res.id).toBe('u-3');
      expect(res.email).toBe('pedro@ata-lta.ph');
      expect(isLocalMutation('users', 'u-3', 1)).toBe(true);
    });

    it('createUserAction surfaces USER_LIMIT_REACHED error verbatim', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          status: 403,
          title: 'Forbidden',
          detail:
            'Maximum number of user accounts (15) reached. Contact the administrator to disable an existing account before adding a new one.',
          code: 'USER_LIMIT_REACHED',
        }),
      } as Response);

      await expect(
        createUserAction({
          name: 'Extra User',
          email: 'extra@ata-lta.ph',
          role: 'HR',
          entities: ['ATA'],
        })
      ).rejects.toThrow();

      const modalState = useBlockingModalStore.getState();
      expect(modalState.error?.code).toBe('USER_LIMIT_REACHED');
      expect(modalState.error?.detail).toContain('Maximum number of user accounts (15) reached');
    });

    it('updateUserAction executes PUT with expectedVersion (If-Match) and registers local mutation', async () => {
      const updatedUser: AdminUser = {
        ...mockUsers[1]!,
        name: 'Maria Santos-Valdez',
        version: 4,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: updatedUser }),
      } as Response);
      global.fetch = fetchMock;

      const res = await updateUserAction('u-2', {
        name: 'Maria Santos-Valdez',
        expectedVersion: 3,
      });

      expect(res.name).toBe('Maria Santos-Valdez');
      expect(res.version).toBe(4);
      expect(isLocalMutation('users', 'u-2', 4)).toBe(true);

      const [, reqInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = reqInit.headers as Record<string, string>;
      expect(headers['If-Match']).toBe('3');
    });

    it('updateUserAction resets blocking modal store on HTTP 409 Concurrency Conflict so ConflictResolutionModal is not covered', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          status: 409,
          title: 'Conflict',
          code: 'CONCURRENCY_CONFLICT',
          detail: 'User record was modified by another administrator.',
        }),
      } as Response);

      await expect(
        updateUserAction('u-2', {
          name: 'Stale Write',
          expectedVersion: 2,
        })
      ).rejects.toMatchObject({
        status: 409,
        code: 'CONCURRENCY_CONFLICT',
      });

      expect(useBlockingModalStore.getState().status).toBe('idle');
    });

    it('disableUserAction executes DELETE to soft-disable user', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      } as Response);

      await disableUserAction('u-2', 'Maria Santos', 'ALL', 3);
      const modalState = useBlockingModalStore.getState();
      expect(modalState.status).toBe('success');
      expect(modalState.successTitle).toBe('User Disabled');
      expect(isLocalMutation('users', 'u-2', 4)).toBe(true);
    });
  });

  describe('Audit Log Query Hooks (useAuditLogsList & useAuditCount)', () => {
    it('useAuditLogsList queries /admin/audit with filter params', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockAuditLogs,
      } as Response);
      global.fetch = fetchMock;

      const { wrapper } = createHarness();
      const { result } = renderHook(
        () =>
          useAuditLogsList({
            page: 1,
            limit: 20,
            module: 'users',
            search: 'Maria',
            sortOrder: 'desc',
          }),
        { wrapper }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.data.length).toBe(1);
      expect(result.current.data?.meta.total).toBe(1);

      const calledUrl = String(fetchMock.mock.calls[0]?.[0] ?? '');
      expect(calledUrl).toContain('/admin/audit');
      expect(calledUrl).toContain('module=users');
      expect(calledUrl).toContain('search=Maria');
      expect(calledUrl).toContain('sortOrder=desc');
    });

    it('useAuditCount queries /admin/audit/count', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: { total: 777 } }),
      } as Response);

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useAuditCount(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.total).toBe(777);
    });
  });
});
