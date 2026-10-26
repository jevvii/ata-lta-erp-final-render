import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  mapRawNotificationItem,
} from '../api/useNotifications';
import { dashboardKeys } from '../api/queryKeys';
import { NotificationBellPanel } from '../components/NotificationBellPanel';
import { useSessionStore } from '@/lib/session';
import * as api from '@/lib/api';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Notifications API & NotificationBellPanel (notifications@2.0.0)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(BrowserRouter, null, children)
      );
  };

  const sampleNotifications = [
    {
      id: 'notif-1',
      user_id: 'user-1',
      type: 'wr.transition_request.received' as const,
      payload: {
        request_id: 'req-1',
        work_request_id: 'wr-1',
        work_request_title: 'Annual Tax Filing',
        from_phase: 'pre_processing',
        to_phase: 'processing',
        requested_by_name: 'Dev Manager',
      },
      read_at: null,
      created_at: '2026-10-04T09:00:00Z',
    },
    {
      id: 'notif-2',
      user_id: 'user-1',
      type: 'wr.transition_request.resolved' as const,
      payload: {
        work_request_id: 'wr-2',
        work_request_title: 'Quarterly Audit',
        outcome: 'approved',
        resolved_phase: 'completion',
        resolved_by_name: 'Dev Admin',
      },
      read_at: '2026-10-04T08:00:00Z',
      created_at: '2026-10-04T07:30:00Z',
    },
    {
      id: 'notif-3',
      user_id: 'user-1',
      type: 'wr.qa_reroute' as const,
      payload: {
        work_request_id: 'wr-3',
        work_request_title: 'BIR Reconciliation',
        reason: 'Missing supporting attachment',
        target_phase: 'processing',
      },
      read_at: null,
      created_at: '2026-10-04T09:30:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-1',
        email: 'user@ata-lta.ph',
        name: 'Test User',
        role: 'Manager',
        departments: [],
        entities: ['ATA'],
      },
      permissions: ['notifications:view', 'timelog:view', 'timelog:create'],
      unreadCount: 2,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useNotifications', () => {
    it('fetches notification list and synchronizes unreadCount with session store', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: sampleNotifications,
        meta: {
          unread_count: 2,
          has_more: false,
        },
      });

      const { result } = renderHook(() => useNotifications({ limit: 50 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.data).toHaveLength(3);
      expect(useSessionStore.getState().unreadCount).toBe(2);
    });
  });

  describe('useMarkNotificationRead & useMarkAllNotificationsRead', () => {
    it('marks a single notification as read and decrements session count', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: { id: 'notif-1', read_at: '2026-10-04T10:00:00Z' },
      });

      const wrapper = createWrapper();
      // Seed the list cache the way the bell panel would have loaded it: the
      // optimistic decrement fires only for an item observed unread in cache.
      queryClient.setQueryData(dashboardKeys.notifications.list({ limit: 50 }), {
        data: sampleNotifications.map(mapRawNotificationItem),
        meta: { unreadCount: 2, hasMore: false },
      });

      const { result } = renderHook(() => useMarkNotificationRead(), { wrapper });

      await result.current.mutateAsync('notif-1');

      expect(useSessionStore.getState().unreadCount).toBe(1);
    });

    it('marks all notifications as read and resets unread count to 0', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: { updated_count: 2 },
      });

      const wrapper = createWrapper();
      const { result } = renderHook(() => useMarkAllNotificationsRead(), { wrapper });

      await result.current.mutateAsync();

      expect(useSessionStore.getState().unreadCount).toBe(0);
    });
  });

  describe('NotificationBellPanel Component', () => {
    it('renders bell button with unread count badge', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: sampleNotifications,
        meta: { unread_count: 2 },
      });

      render(<NotificationBellPanel />, { wrapper: createWrapper() });

      expect(screen.getByTestId('notification-bell-btn')).toBeInTheDocument();
      expect(screen.getByTestId('unread-badge')).toHaveTextContent('2');
    });

    it('opens dropdown panel on click and displays unread-first sorted items', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: sampleNotifications,
        meta: { unread_count: 2 },
      });

      render(<NotificationBellPanel />, { wrapper: createWrapper() });

      fireEvent.click(screen.getByTestId('notification-bell-btn'));

      expect(screen.getByTestId('notifications-dropdown')).toBeInTheDocument();
      expect(screen.getByText('Notifications')).toBeInTheDocument();
      expect(screen.getByTestId('mark-all-read-btn')).toBeInTheDocument();

      // Check items exist after async query resolves
      expect(await screen.findByTestId('notification-item-notif-1')).toBeInTheDocument();
      expect(await screen.findByTestId('notification-item-notif-2')).toBeInTheDocument();
      expect(await screen.findByTestId('notification-item-notif-3')).toBeInTheDocument();
    });

    it('filters between All and Unread items', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: sampleNotifications,
        meta: { unread_count: 2 },
      });

      render(<NotificationBellPanel />, { wrapper: createWrapper() });
      fireEvent.click(screen.getByTestId('notification-bell-btn'));

      expect(await screen.findByTestId('notification-item-notif-1')).toBeInTheDocument();

      // Click Unread filter
      fireEvent.click(screen.getByTestId('filter-unread-btn'));

      expect(screen.getByTestId('notification-item-notif-1')).toBeInTheDocument();
      expect(screen.getByTestId('notification-item-notif-3')).toBeInTheDocument();
      expect(screen.queryByTestId('notification-item-notif-2')).not.toBeInTheDocument();
    });

    it('marks notification as read and navigates to deep link target on click', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string, options?: api.RequestOptions) => {
        if (path.includes('/notifications') && options?.method === 'POST') {
          const match = path.match(/\/notifications\/([^/]+)\/read/);
          const notifId = match?.[1] ?? 'notif-1';
          return { data: { id: notifId, read_at: '2026-10-04T10:00:00Z' } } as never;
        }
        if (path.includes('/notifications')) {
          return {
            data: sampleNotifications,
            meta: { unread_count: 2, has_more: false },
          } as never;
        }
        if (path.includes('/me')) {
          return {
            data: {
              id: 'user-1',
              email: 'user@ata-lta.ph',
              name: 'Test User',
              role: 'Manager',
              departments: [],
              entities: ['ATA'],
              unread_notifications: 1,
            },
          } as never;
        }
        return { data: [] } as never;
      });

      render(<NotificationBellPanel />, { wrapper: createWrapper() });
      fireEvent.click(screen.getByTestId('notification-bell-btn'));

      const notifItem = await screen.findByTestId('notification-item-notif-1');
      fireEvent.click(notifItem);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/operations?tab=pending-approvals');
      });
    });

    it('renders a lifecycle event and opens its voucher under an authorized entity', async () => {
      useSessionStore.setState((state) => ({ user: { ...state.user!, entities: ['ATA', 'LTA'] }, activeEntity: 'ATA' }));
      vi.spyOn(api, 'apiRequest').mockResolvedValue({
        data: [{ id: 'disb-note', user_id: 'user-1', type: 'disbursement.lifecycle', payload: {
          request_id: 'voucher-1', entity: 'LTA', action: 'fund', disbursement_number: 'DISB-LTA-001',
        }, read_at: '2026-10-20T10:00:00Z', created_at: '2026-10-20T09:00:00Z' }],
        meta: { unread_count: 0 },
      });
      render(<NotificationBellPanel />, { wrapper: createWrapper() });
      fireEvent.click(screen.getByTestId('notification-bell-btn'));
      const note = await screen.findByTestId('notification-item-disb-note');
      expect(note).toHaveTextContent('Payment prepared');
      fireEvent.click(note);
      await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/disbursements?disbursementId=voucher-1'));
      expect(useSessionStore.getState().activeEntity).toBe('LTA');
    });

    it('navigates to board view with wrId for QA reroute notification', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string, options?: api.RequestOptions) => {
        if (path.includes('/notifications') && options?.method === 'POST') {
          const match = path.match(/\/notifications\/([^/]+)\/read/);
          const notifId = match?.[1] ?? 'notif-3';
          return { data: { id: notifId, read_at: '2026-10-04T10:00:00Z' } } as never;
        }
        if (path.includes('/notifications')) {
          return {
            data: sampleNotifications,
            meta: { unread_count: 2, has_more: false },
          } as never;
        }
        if (path.includes('/me')) {
          return {
            data: {
              id: 'user-1',
              email: 'user@ata-lta.ph',
              name: 'Test User',
              role: 'Manager',
              departments: [],
              entities: ['ATA'],
              unread_notifications: 1,
            },
          } as never;
        }
        return { data: [] } as never;
      });

      render(<NotificationBellPanel />, { wrapper: createWrapper() });
      fireEvent.click(screen.getByTestId('notification-bell-btn'));

      const notifItem = await screen.findByTestId('notification-item-notif-3');
      fireEvent.click(notifItem);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/operations?tab=work-requests&view=board&wrId=wr-3');
      });
    });
  });
});
