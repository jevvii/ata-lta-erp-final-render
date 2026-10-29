/**
 * Cross-Tab Synchronization Engine (Spec §4.2, Parcel A).
 * Coordinates optimistic state and cache updates across browser tabs via BroadcastChannel.
 */

import type { QueryClient } from '@tanstack/react-query';
import { isFeatureEnabled } from './flags';

export type TabSyncDomain =
  | 'operations'
  | 'tasks'
  | 'billing'
  | 'disbursements'
  | 'documents'
  | 'transmittals'
  | 'clients'
  | 'notifications'
  | 'admin';

export type TabSyncType =
  | 'ENTITY_MUTATED'
  | 'ENTITY_DELETED'
  | 'SESSION_REFRESH';

export interface TabSyncMessage<T = unknown> {
  type: TabSyncType;
  domain: TabSyncDomain;
  entityId: string;
  entityData?: T;
  originTabId: string;
  timestamp: number;
}

export const TAB_SYNC_CHANNEL_NAME = 'ata_lta_erp_tab_sync';
const TAB_SESSION_STORAGE_KEY = 'ata_lta_erp_tab_id';

let sessionTabId: string | null = null;
let broadcastChannelInstance: BroadcastChannel | null = null;

/**
 * Returns a persistent tab UUID per browser session/tab.
 * Survives page refreshes within the same tab using sessionStorage.
 */
export function getTabId(): string {
  if (sessionTabId) {
    return sessionTabId;
  }

  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(TAB_SESSION_STORAGE_KEY);
      if (stored) {
        sessionTabId = stored;
        return stored;
      }
      const newId =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, newId);
      sessionTabId = newId;
      return newId;
    } catch {
      // Fallback if sessionStorage is restricted
    }
  }

  sessionTabId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return sessionTabId;
}

/**
 * Resets or overrides the current tab UUID (used for testing multi-tab flows).
 */
export function resetTabIdForTesting(id?: string, clearSessionStorage = false): void {
  sessionTabId = id ?? null;
  if (clearSessionStorage && typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      sessionStorage.removeItem(TAB_SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
  } else if (id && typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(TAB_SESSION_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }
}


function checkTabSyncEnabled(): boolean {
  try {
    if (typeof isFeatureEnabled === 'function') {
      return isFeatureEnabled('tab_sync');
    }
  } catch {
    // Graceful fallback if @/lib/flags is mocked without isFeatureEnabled
  }
  return true;
}

/**
 * Initializes and returns the native BroadcastChannel singleton,
 * strictly guarded by the 'tab_sync' feature flag.
 */
export function getTabSyncChannel(): BroadcastChannel | null {
  if (!checkTabSyncEnabled()) {
    if (broadcastChannelInstance) {
      try {
        broadcastChannelInstance.close();
      } catch {
        // ignore
      }
      broadcastChannelInstance = null;
    }
    return null;
  }

  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }

  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);
    } catch (err) {
      console.warn('[tabSync] Failed to initialize BroadcastChannel:', err);
      return null;
    }
  }

  return broadcastChannelInstance;
}

/**
 * Closes the active BroadcastChannel instance (used in teardown/tests).
 */
export function closeTabSyncChannel(): void {
  if (broadcastChannelInstance) {
    try {
      broadcastChannelInstance.close();
    } catch {
      // ignore
    }
    broadcastChannelInstance = null;
  }
}

export type BroadcastEntityChangeInput<T = unknown> = Omit<
  TabSyncMessage<T>,
  'originTabId' | 'timestamp' | 'type'
> & {
  type?: TabSyncType;
};


/**
 * Broadcasts an entity mutation or deletion event across browser tabs.
 * Stamps the event with current tab UUID for origin deduplication.
 */
export function broadcastEntityChange<T = unknown>(
  msg: BroadcastEntityChangeInput<T>
): void {
  if (!checkTabSyncEnabled()) {
    return;
  }

  const channel = getTabSyncChannel();
  if (!channel) {
    return;
  }

  const fullMessage: TabSyncMessage<T> = {
    type: msg.type ?? 'ENTITY_MUTATED',
    domain: msg.domain,
    entityId: msg.entityId,
    entityData: msg.entityData,
    originTabId: getTabId(),
    timestamp: Date.now(),
  };

  try {
    channel.postMessage(fullMessage);
  } catch (err) {
    console.warn('[tabSync] Failed to postMessage:', err);
  }
}

/**
 * Processes an incoming tab sync message and updates TanStack Query caches.
 */
export function handleIncomingTabSyncMessage(
  queryClient: QueryClient,
  msg: TabSyncMessage<unknown>
): void {
  const { type, domain, entityId, entityData } = msg;

  if (type === 'SESSION_REFRESH') {
    void queryClient.invalidateQueries();
    return;
  }

  if (type === 'ENTITY_DELETED') {
    // 1. Remove detail queries matching entityId
    queryClient.removeQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === domain &&
          key.some((part) => part === entityId)
        );
      },
    });

    // 2. Remove from cached lists
    const domainQueries = queryClient.getQueriesData({ queryKey: [domain] });
    for (const [key, value] of domainQueries) {
      if (value && typeof value === 'object') {
        if (Array.isArray((value as Record<string, unknown>).data)) {
          const list = (value as { data: Array<{ id?: string }> }).data;
          queryClient.setQueryData(key, {
            ...value,
            data: list.filter((item) => item?.id !== entityId),
          });
        } else if (Array.isArray(value)) {
          queryClient.setQueryData(
            key,
            (value as Array<{ id?: string }>).filter((item) => item?.id !== entityId)
          );
        }
      }
    }

    // 3. Reconcile counters
    void queryClient.invalidateQueries({ queryKey: [domain, 'counts'] });
    if (domain === 'operations') {
      void queryClient.invalidateQueries({ queryKey: ['operations', 'workRequests', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: ['operations', 'requests', 'counts'] });
    }
    if (domain === 'admin') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    }
    return;
  }

  // Handle ENTITY_MUTATED
  if (entityData !== undefined && entityData !== null) {
    // For operations domain: cross-tab mutations must invalidate/refetch, not inject raw permission-bearing rows
    if (domain === 'operations') {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            Array.isArray(key) &&
            key[0] === 'operations' &&
            (key.includes(entityId) ||
              key.includes('workRequests') ||
              key.includes('tasks') ||
              key.includes('requests') ||
              key.includes('creationApprovals'))
          );
        },
      });
      void queryClient.invalidateQueries({ queryKey: ['operations', 'workRequests', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: ['operations', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: ['operations', 'requests', 'counts'] });
      return;
    }

    // 1. Explicit domain detail cache updates
    switch (domain) {
      case 'billing':
        queryClient.setQueryData(
          ['billing', 'invoices', 'detail', entityId],
          (old: unknown) =>
            old && typeof old === 'object'
              ? { ...old, ...(entityData as object) }
              : entityData
        );
        break;
      case 'disbursements':
        queryClient.setQueryData(
          ['disbursements', 'detail', entityId],
          (old: unknown) =>
            old && typeof old === 'object'
              ? { ...old, ...(entityData as object) }
              : entityData
        );
        break;
      case 'clients':
        queryClient.setQueryData(
          ['clients', 'detail', entityId],
          (old: unknown) =>
            old && typeof old === 'object'
              ? { ...old, ...(entityData as object) }
              : entityData
        );
        break;
      case 'transmittals':
        queryClient.setQueryData(
          ['transmittals', 'detail', entityId],
          (old: unknown) =>
            old && typeof old === 'object'
              ? { ...old, ...(entityData as object) }
              : entityData
        );
        break;
    }

    // 2. Scan all queries under domain key to patch matching detail or list caches
    const domainQueries = queryClient.getQueriesData({ queryKey: [domain] });
    for (const [key, value] of domainQueries) {
      // If query key includes entityId and value is an object, patch detail
      if (
        Array.isArray(key) &&
        key.includes(entityId) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        !Array.isArray((value as Record<string, unknown>).data)
      ) {
        queryClient.setQueryData(key, (old: unknown) =>
          old && typeof old === 'object'
            ? { ...old, ...(entityData as object) }
            : entityData
        );
      }

      // If query is a list with { data: [...] }
      if (value && typeof value === 'object') {
        if (Array.isArray((value as Record<string, unknown>).data)) {
          const list = (value as { data: Array<{ id?: string }> }).data;
          if (list.some((item) => item?.id === entityId)) {
            queryClient.setQueryData(key, {
              ...value,
              data: list.map((item) =>
                item?.id === entityId
                  ? { ...item, ...(entityData as object) }
                  : item
              ),
            });
          }
        } else if (Array.isArray(value)) {
          // If query is a raw array of items
          const list = value as Array<{ id?: string }>;
          if (list.some((item) => item?.id === entityId)) {
            queryClient.setQueryData(
              key,
              list.map((item) =>
                item?.id === entityId
                  ? { ...item, ...(entityData as object) }
                  : item
              )
            );
          }
        }
      }
    }

    // 3. Reconcile secondary counters (Spec §4.2)
    void queryClient.invalidateQueries({ queryKey: [domain, 'counts'] });
    if (domain === 'admin') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    }
  } else {
    // If entityData is not provided, mark stale / invalidate the entity and list queries
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          Array.isArray(key) &&
          key[0] === domain &&
          (key.includes(entityId) || key.includes('list') || key.includes('lists') || key.includes('users') || key.includes('audit'))
        );
      },
    });
    void queryClient.invalidateQueries({ queryKey: [domain, 'counts'] });
    if (domain === 'admin') {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    }
  }
}

/**
 * Subscribes to cross-tab broadcast messages and coordinates TanStack Query updates.
 * Returns an unmount / cleanup unsubscribe function.
 */
export function setupTabSyncListener(queryClient: QueryClient): () => void {
  if (!checkTabSyncEnabled()) {
    return () => {};
  }

  const channel = getTabSyncChannel();
  if (!channel) {
    return () => {};
  }

  const handleMessage = (event: MessageEvent<TabSyncMessage<unknown>>) => {
    if (!checkTabSyncEnabled()) {
      return;
    }

    const data = event.data;
    if (!data || typeof data !== 'object') {
      return;
    }

    // Origin tab deduplication: ignore self-sent events
    if (data.originTabId && data.originTabId === getTabId()) {
      return;
    }

    handleIncomingTabSyncMessage(queryClient, data);
  };

  channel.addEventListener('message', handleMessage);

  return () => {
    channel.removeEventListener('message', handleMessage);
  };
}
