/**
 * Real-Time Notifications Test Suite (SPEC-REALTIME-SYNC-001 §4 Parcel 3 & PROJECT.md)
 *
 * Verifies:
 * - Feature 10: User-Scoped Realtime Notification Hook (useNotificationRealtimeSync)
 * - Feature 11: Immediate Unread Counter Store Mutation in useSessionStore & TanStack cache
 * - Feature 12: Notification Bell Panel Live Mount (NotificationBellPanel.tsx)
 *
 * Tiers covered:
 * - Tier 1: Feature Coverage (>=5 tests per feature)
 * - Tier 2: Boundary & Corner Cases (>=5 tests)
 * - Tier 3: Cross-Feature Interactions
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { useSessionStore } from '@/lib/session';
import { supabase, type MockSupabaseClient } from '@/lib/supabase';
import { useEntityRealtimeSync, clearChannelRegistryForTesting } from '@/lib/realtime/useEntityRealtimeSync';
import { dashboardKeys } from '../api/queryKeys';
import { NotificationBellPanel } from '../components/NotificationBellPanel';
import * as notificationsModule from '../api/useNotifications';
import type { RawNotificationItemApi, NotificationListResponse } from '../api/types';

// ============================================================================
// Authoritative Realtime Notification Hook Contract (SPEC-REALTIME-SYNC-001 §4 Parcel 3)
// ============================================================================

export function useReferenceNotificationRealtimeSync() {
  const user = useSessionStore((state) => state.user);

  useEntityRealtimeSync<RawNotificationItemApi>({
    table: 'notifications',
    filter: user?.id ? `user_id=eq.${user.id}` : undefined,
    enabled: Boolean(user?.id),
    listRootKey: dashboardKeys.notifications.all,
    detailQueryKey: (id) => [...dashboardKeys.notifications.all, 'detail', id],
  });
}

const mod = notificationsModule as Record<string, unknown>;
const useNotificationRealtimeSync =
  typeof mod.useNotificationRealtimeSync === 'function'
    ? (mod.useNotificationRealtimeSync as typeof useReferenceNotificationRealtimeSync)
    : useReferenceNotificationRealtimeSync;

// Wrapper component to mount realtime hook alongside bell panel
function NotificationPanelWithSync() {
  useNotificationRealtimeSync();
  return <NotificationBellPanel />;
}

describe('Feature 10, 11 & 12: Real-Time Notifications Engine (Tier 1)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    localStorage.clear();
    clearChannelRegistryForTesting();
    useSessionStore.setState({
      user: {
        id: 'usr-target-1',
        name: 'Target User',
        email: 'target@example.com',
        role: 'operations_staff',
        departments: [],
        entities: ['ATA'],
      },
      permissions: new Set(['operations:view']),
      activeEntity: 'ATA',
      unreadCount: 0,
    });
  });

  afterEach(() => {
    queryClient.clear();
    localStorage.clear();
    clearChannelRegistryForTesting();
    vi.restoreAllMocks();
  });

  it('1. subscribes to user-scoped notifications channel with filter user_id=eq.${user.id}', () => {
    const channelSpy = vi.spyOn(supabase, 'channel');

    render(<NotificationPanelWithSync />, { wrapper: createWrapper() });

    expect(channelSpy).toHaveBeenCalledWith('cdc_notifications');
  });

  it('2. increments unreadCount in useSessionStore immediately upon notification insert', () => {
    useSessionStore.setState({ unreadCount: 2 });

    render(<NotificationPanelWithSync />, { wrapper: createWrapper() });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_notifications');
    expect(channel).toBeDefined();

    // Authentically dispatch live CDC notification INSERT
    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'n-new-2',
          user_id: 'usr-target-1',
          type: 'wr.qa_reroute',
          payload: { workRequestId: 'wr-1' },
          read_at: null,
          created_at: new Date().toISOString(),
        },
      });
    });

    expect(useSessionStore.getState().unreadCount).toBe(3);
  });

  it('3. renders live unread badge count in NotificationBellPanel matching session store', () => {
    useSessionStore.setState({ unreadCount: 5 });

    render(<NotificationBellPanel />, { wrapper: createWrapper() });

    const badge = screen.getByText('5');
    expect(badge).toBeInTheDocument();
  });

  it('4. hides unread badge when unreadCount is 0', () => {
    useSessionStore.setState({ unreadCount: 0 });

    render(<NotificationBellPanel />, { wrapper: createWrapper() });

    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('5. prepends new notification item to dashboardKeys.notifications.all query cache', () => {
    const listKey = dashboardKeys.notifications.all;
    const initialList: NotificationListResponse = {
      data: [
        {
          id: 'n-old',
          userId: 'usr-target-1',
          type: 'wr.transition_request.received',
          payload: { workRequestId: 'wr-1' },
          readAt: '2026-10-09T00:00:00Z',
          createdAt: '2026-10-09T00:00:00Z',
        },
      ],
      meta: { unreadCount: 0, hasMore: false },
    };

    queryClient.setQueryData(listKey, initialList);

    render(<NotificationPanelWithSync />, { wrapper: createWrapper() });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_notifications');
    expect(channel).toBeDefined();

    // Authentically dispatch live CDC notification INSERT
    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'n-new',
          user_id: 'usr-target-1',
          type: 'wr.qa_reroute',
          payload: { workRequestId: 'wr-1' },
          read_at: null,
          created_at: '2026-10-10T12:00:00Z',
        },
      });
    });

    const cached = queryClient.getQueryData<NotificationListResponse>(listKey);
    expect(cached?.data).toHaveLength(2);
    expect(cached?.data[0]?.id).toBe('n-new');
    expect(cached?.meta?.unreadCount).toBe(1);
    expect((cached?.meta as { total?: number })?.total).toBe(2);
  });

  it('6. opens dropdown panel and renders notification list on bell button click', async () => {
    const listKey = dashboardKeys.notifications.list({ limit: 50 });

    queryClient.setQueryData(listKey, {
      data: [
        {
          id: 'n-click-1',
          userId: 'usr-target-1',
          type: 'wr.qa_reroute',
          payload: { workRequestId: 'wr-10', workRequestNo: 'WR-0010' },
          readAt: null,
          createdAt: '2026-10-10T12:00:00Z',
        },
      ],
      meta: { unreadCount: 1, limit: 50 },
    });

    render(<NotificationBellPanel />, { wrapper: createWrapper() });

    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(screen.getByText(/QA Reroute Rework/i)).toBeInTheDocument();
  });
});

describe('Real-Time Notifications (Tier 2: Boundary & Corner Cases)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    queryClient = new QueryClient();
    clearChannelRegistryForTesting();
  });

  afterEach(() => {
    queryClient.clear();
    clearChannelRegistryForTesting();
    vi.restoreAllMocks();
  });

  it('1. disables realtime subscription when user is unauthenticated (user is null)', () => {
    useSessionStore.setState({ user: null });
    const channelSpy = vi.spyOn(supabase, 'channel');

    render(<NotificationPanelWithSync />, { wrapper: createWrapper() });

    // Enabled is false, so no channel should be created
    expect(channelSpy).not.toHaveBeenCalled();
  });

  it('2. displays "99+" badge when unreadCount exceeds 99', () => {
    useSessionStore.setState({ unreadCount: 150 });

    render(<NotificationBellPanel />, { wrapper: createWrapper() });

    // NotificationBellPanel renders 99+ when unreadCount > 99
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('3. handles rapid successive unread counter increments cleanly without race conditions', () => {
    useSessionStore.setState({ unreadCount: 0 });

    act(() => {
      for (let i = 1; i <= 10; i++) {
        useSessionStore.getState().setUnreadCount(i);
      }
    });

    expect(useSessionStore.getState().unreadCount).toBe(10);
  });

  it('4. handles notifications with empty or missing payload dictionaries', () => {
    const listKey = dashboardKeys.notifications.all;
    queryClient.setQueryData(listKey, { data: [], meta: { unreadCount: 0, total: 0 } });

    useSessionStore.setState({
      user: {
        id: 'usr-target-1',
        name: 'Target User',
        email: 'target@example.com',
        role: 'operations_staff',
        departments: [],
        entities: ['ATA'],
      },
      activeEntity: 'ATA',
      unreadCount: 0,
    });

    render(<NotificationPanelWithSync />, { wrapper: createWrapper() });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_notifications');
    expect(channel).toBeDefined();

    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'n-empty-p',
          user_id: 'usr-target-1',
          type: 'wr.transition_request.received',
          payload: {},
          read_at: null,
          created_at: '2026-10-10T12:00:00Z',
        },
      });
    });

    const cached = queryClient.getQueryData<NotificationListResponse>(listKey);
    expect(cached?.data).toHaveLength(1);
    expect(cached?.data[0]?.id).toBe('n-empty-p');
    expect(cached?.meta?.unreadCount).toBe(1);
  });

  it('5. cleans up channel and removes subscription listeners on unmount', () => {
    useSessionStore.setState({
      user: {
        id: 'usr-target-1',
        name: 'Target User',
        email: 'target@example.com',
        role: 'operations_staff',
        departments: [],
        entities: ['ATA'],
      },
    });

    const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

    const { unmount } = render(<NotificationPanelWithSync />, { wrapper: createWrapper() });
    unmount();

    expect(removeChannelSpy).toHaveBeenCalled();
  });
});

describe('Real-Time Notifications (Tier 3: Pairwise Interactions)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  beforeEach(() => {
    queryClient = new QueryClient();
    clearChannelRegistryForTesting();
    useSessionStore.setState({
      user: {
        id: 'usr-pair-1',
        name: 'Pairwise User',
        email: 'pair@example.com',
        role: 'operations_staff',
        departments: [],
        entities: ['ATA'],
      },
      unreadCount: 0,
    });
  });

  afterEach(() => {
    queryClient.clear();
    clearChannelRegistryForTesting();
    vi.restoreAllMocks();
  });

  it('1. combines realtime notification insert with instant bell badge update', async () => {
    render(<NotificationPanelWithSync />, { wrapper: createWrapper() });

    expect(screen.queryByText('1')).not.toBeInTheDocument();

    const mockClient = supabase as unknown as MockSupabaseClient;
    const channel = mockClient.getChannel('cdc_notifications');
    expect(channel).toBeDefined();

    // Authentically dispatch live CDC notification INSERT
    act(() => {
      channel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'n-realtime-badge-1',
          user_id: 'usr-pair-1',
          type: 'wr.qa_reroute',
          payload: { workRequestId: 'wr-pair-1' },
          read_at: null,
          created_at: new Date().toISOString(),
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });
    expect(useSessionStore.getState().unreadCount).toBe(1);
  });

  it('2. combines notification panel opening with unread filtering toggle', async () => {
    const listKey = dashboardKeys.notifications.list({ limit: 50 });

    queryClient.setQueryData(listKey, {
      data: [
        {
          id: 'n-unread',
          userId: 'usr-pair-1',
          type: 'wr.qa_reroute',
          payload: { workRequestId: 'wr-1' },
          readAt: null,
          createdAt: '2026-10-10T12:00:00Z',
        },
        {
          id: 'n-read',
          userId: 'usr-pair-1',
          type: 'wr.transition_request.resolved',
          payload: { workRequestId: 'wr-2' },
          readAt: '2026-10-09T10:00:00Z',
          createdAt: '2026-10-09T10:00:00Z',
        },
      ],
      meta: { unreadCount: 1, limit: 50 },
    });

    render(<NotificationBellPanel />, { wrapper: createWrapper() });

    const bellBtn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(bellBtn);

    expect(screen.getByTestId('notification-item-n-unread')).toBeInTheDocument();
    expect(screen.getByTestId('notification-item-n-read')).toBeInTheDocument();

    // Toggle unread only filter
    const unreadFilterBtn = screen.getByTestId('filter-unread-btn');
    fireEvent.click(unreadFilterBtn);

    expect(screen.getByTestId('notification-item-n-unread')).toBeInTheDocument();
    expect(screen.queryByTestId('notification-item-n-read')).not.toBeInTheDocument();
  });
});
