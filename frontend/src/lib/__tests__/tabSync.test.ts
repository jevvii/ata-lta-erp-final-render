import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  broadcastEntityChange,
  setupTabSyncListener,
  handleIncomingTabSyncMessage,
  getTabSyncChannel,
  closeTabSyncChannel,
  getTabId,
  resetTabIdForTesting,
  TAB_SYNC_CHANNEL_NAME,
  type TabSyncMessage,
} from '../tabSync';
import { isFeatureEnabled } from '../flags';
import { queryClient as apiQueryClient } from '../api';

describe('Parcel A: Feature Flags & Cross-Tab Sync Engine', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    resetTabIdForTesting(undefined, true);
    closeTabSyncChannel();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    closeTabSyncChannel();
    resetTabIdForTesting(undefined, true);
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('Feature Flags (flags.ts)', () => {
    it('defaults to true when no override is present', () => {
      expect(isFeatureEnabled('realtime_sync')).toBe(true);
      expect(isFeatureEnabled('tab_sync')).toBe(true);
      expect(isFeatureEnabled('strict_occ')).toBe(true);
    });

    it('respects localStorage override erp_feature_override_${flag}', () => {
      localStorage.setItem('erp_feature_override_tab_sync', 'false');
      expect(isFeatureEnabled('tab_sync')).toBe(false);

      localStorage.setItem('erp_feature_override_tab_sync', 'true');
      expect(isFeatureEnabled('tab_sync')).toBe(true);

      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      expect(isFeatureEnabled('realtime_sync')).toBe(false);

      localStorage.setItem('erp_feature_override_strict_occ', 'false');
      expect(isFeatureEnabled('strict_occ')).toBe(false);
    });

    it('handles case-insensitive whitespace-tolerant overrides', () => {
      localStorage.setItem('erp_feature_override_tab_sync', '  FALSE  ');
      expect(isFeatureEnabled('tab_sync')).toBe(false);

      localStorage.setItem('erp_feature_override_tab_sync', '  TRUE  ');
      expect(isFeatureEnabled('tab_sync')).toBe(true);
    });

    it('ignores invalid override values and falls back gracefully', () => {
      localStorage.setItem('erp_feature_override_tab_sync', 'invalid_value');
      expect(isFeatureEnabled('tab_sync')).toBe(true);
    });
  });

  describe('Tab Identity (tabSync.ts getTabId)', () => {
    it('generates a stable persistent UUID per tab session in sessionStorage', () => {
      const id1 = getTabId();
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);

      // Subsequent calls return identical tab UUID
      const id2 = getTabId();
      expect(id2).toBe(id1);

      // Verify persistence in sessionStorage
      expect(sessionStorage.getItem('ata_lta_erp_tab_id')).toBe(id1);
    });

    it('reuses existing tab UUID if already set in sessionStorage', () => {
      sessionStorage.setItem('ata_lta_erp_tab_id', 'existing-tab-uuid-1234');
      resetTabIdForTesting(undefined, false);

      expect(getTabId()).toBe('existing-tab-uuid-1234');
    });

    it('allows testing overrides via resetTabIdForTesting', () => {
      resetTabIdForTesting('tab-override-abc');
      expect(getTabId()).toBe('tab-override-abc');

      resetTabIdForTesting('tab-override-xyz');
      expect(getTabId()).toBe('tab-override-xyz');
    });
  });

  describe('BroadcastChannel Lifecycle & Flag Guard', () => {
    it('initializes BroadcastChannel with channel name ata_lta_erp_tab_sync when tab_sync is enabled', () => {
      const channel = getTabSyncChannel();
      expect(channel).not.toBeNull();
      expect(channel?.name).toBe(TAB_SYNC_CHANNEL_NAME);
    });

    it('returns null and closes existing channel when tab_sync is disabled', () => {
      const channelBefore = getTabSyncChannel();
      expect(channelBefore).not.toBeNull();

      localStorage.setItem('erp_feature_override_tab_sync', 'false');
      const channelAfter = getTabSyncChannel();
      expect(channelAfter).toBeNull();
    });

    it('closes channel cleanly via closeTabSyncChannel', () => {
      const channel = getTabSyncChannel();
      expect(channel).not.toBeNull();

      const closeSpy = vi.spyOn(channel!, 'close');
      closeTabSyncChannel();
      expect(closeSpy).toHaveBeenCalled();
    });
  });

  describe('broadcastEntityChange Dispatching', () => {
    it('dispatches full TabSyncMessage with originTabId and timestamp', () => {
      const channel = getTabSyncChannel();
      expect(channel).not.toBeNull();
      const postMessageSpy = vi.spyOn(channel!, 'postMessage');

      resetTabIdForTesting('tab-origin-1');

      broadcastEntityChange({
        domain: 'operations',
        entityId: 'wr-101',
        entityData: { id: 'wr-101', status: 'In Progress' },
      });

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const dispatched = postMessageSpy.mock.calls[0]?.[0] as TabSyncMessage;
      expect(dispatched.type).toBe('ENTITY_MUTATED');
      expect(dispatched.domain).toBe('operations');
      expect(dispatched.entityId).toBe('wr-101');
      expect(dispatched.entityData).toEqual({ id: 'wr-101', status: 'In Progress' });
      expect(dispatched.originTabId).toBe('tab-origin-1');
      expect(typeof dispatched.timestamp).toBe('number');
    });

    it('supports custom message types such as ENTITY_DELETED', () => {
      const channel = getTabSyncChannel();
      const postMessageSpy = vi.spyOn(channel!, 'postMessage');

      broadcastEntityChange({
        type: 'ENTITY_DELETED',
        domain: 'disbursements',
        entityId: 'disb-999',
      });

      expect(postMessageSpy).toHaveBeenCalledTimes(1);
      const dispatched = postMessageSpy.mock.calls[0]?.[0] as TabSyncMessage;
      expect(dispatched.type).toBe('ENTITY_DELETED');
      expect(dispatched.domain).toBe('disbursements');
      expect(dispatched.entityId).toBe('disb-999');
    });

    it('bypasses broadcast entirely when tab_sync is false', () => {
      localStorage.setItem('erp_feature_override_tab_sync', 'false');

      const channel = getTabSyncChannel();
      expect(channel).toBeNull();

      // Should not throw and should not dispatch
      broadcastEntityChange({
        domain: 'billing',
        entityId: 'inv-404',
      });
    });
  });

  describe('Origin Tab Deduplication & Listener Handling', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      queryClient = new QueryClient();
    });

    afterEach(() => {
      queryClient.clear();
    });

    it('ignores self-sent messages matching current tab UUID (origin deduplication)', async () => {
      resetTabIdForTesting('current-tab-uuid');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

      const cleanup = setupTabSyncListener(queryClient);

      // Create a separate sender BroadcastChannel mimicking self posting
      const senderChannel = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);

      const selfMessage: TabSyncMessage = {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-self',
        entityData: { id: 'wr-self', status: 'Done' },
        originTabId: 'current-tab-uuid', // SAME TAB
        timestamp: Date.now(),
      };

      senderChannel.postMessage(selfMessage);

      // Allow message dispatch macrotask to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Cache should NOT be touched for self-sent message
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(setQueryDataSpy).not.toHaveBeenCalled();

      senderChannel.close();
      cleanup();
    });

    it('processes messages arriving from another tab (different originTabId)', async () => {
      resetTabIdForTesting('current-tab-uuid');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const cleanup = setupTabSyncListener(queryClient);
      const senderChannel = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);

      const externalMessage: TabSyncMessage = {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-external',
        entityData: { id: 'wr-external', status: 'Completed' },
        originTabId: 'other-tab-uuid', // DIFFERENT TAB
        timestamp: Date.now(),
      };

      senderChannel.postMessage(externalMessage);

      await vi.waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['operations', 'counts'],
        });
      });

      senderChannel.close();
      cleanup();
    });

    it('returns a cleanup function that cleanly unmounts the listener', async () => {
      resetTabIdForTesting('current-tab-uuid');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const cleanup = setupTabSyncListener(queryClient);
      cleanup(); // Immediately unmount

      const senderChannel = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);
      const externalMessage: TabSyncMessage = {
        type: 'SESSION_REFRESH',
        domain: 'operations',
        entityId: 'any',
        originTabId: 'other-tab-uuid',
        timestamp: Date.now(),
      };

      senderChannel.postMessage(externalMessage);

      await new Promise((resolve) => setTimeout(resolve, 50));

      // After unmounting, event should NOT be handled
      expect(invalidateSpy).not.toHaveBeenCalled();

      senderChannel.close();
    });

    it('returns a no-op cleanup when tab_sync is disabled', () => {
      localStorage.setItem('erp_feature_override_tab_sync', 'false');

      const cleanup = setupTabSyncListener(queryClient);
      expect(typeof cleanup).toBe('function');
      cleanup(); // Safe to execute
    });
  });

  describe('Cache Patching & Invalidation Logic (handleIncomingTabSyncMessage)', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      queryClient = new QueryClient();
    });

    afterEach(() => {
      queryClient.clear();
    });

    it('invalidates operations detail and list caches without injecting cross-tab row data', () => {
      // Seed detail and list caches
      const detailKey = ['operations', 'workRequests', 'detail', 'wr-200'];
      const listKey = ['operations', 'workRequests', 'list', 'ATA', {}];

      queryClient.setQueryData(detailKey, {
        id: 'wr-200',
        title: 'Original Title',
        status: 'Pending',
        version: 1,
      });

      queryClient.setQueryData(listKey, {
        data: [
          { id: 'wr-199', title: 'Other WR', status: 'Done' },
          { id: 'wr-200', title: 'Original Title', status: 'Pending', version: 1 },
        ],
      });

      const message: TabSyncMessage = {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-200',
        entityData: { id: 'wr-200', title: 'Updated Title', status: 'Approved', version: 2 },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      };

      handleIncomingTabSyncMessage(queryClient, message);

      // Verify detail cache is patched
      const updatedDetail = queryClient.getQueryData<{ title: string; status: string; version: number }>(detailKey);
      expect(updatedDetail?.title).toBe('Original Title');
      expect(updatedDetail?.status).toBe('Pending');
      expect(updatedDetail?.version).toBe(1);
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);

      // Verify list item is patched while other items are preserved
      const updatedList = queryClient.getQueryData<{ data: Array<{ id: string; title: string; status: string }> }>(listKey);
      expect(updatedList).toBeDefined();
      expect(updatedList!.data[0]?.id).toBe('wr-199');
      expect(updatedList!.data[0]?.title).toBe('Other WR');
      expect(updatedList!.data[1]?.id).toBe('wr-200');
      expect(updatedList!.data[1]?.title).toBe('Original Title');
      expect(updatedList!.data[1]?.status).toBe('Pending');
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    });

    it('patches raw array list caches on ENTITY_MUTATED', () => {
      const rawListKey = ['billing', 'invoices', 'list'];
      queryClient.setQueryData(rawListKey, [
        { id: 'inv-1', total: 100 },
        { id: 'inv-2', total: 200 },
      ]);

      const message: TabSyncMessage = {
        type: 'ENTITY_MUTATED',
        domain: 'billing',
        entityId: 'inv-2',
        entityData: { id: 'inv-2', total: 250, status: 'PAID' },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      };

      handleIncomingTabSyncMessage(queryClient, message);

      const updated = queryClient.getQueryData<Array<{ id: string; total: number; status?: string }>>(rawListKey);
      expect(updated?.[1]).toEqual({ id: 'inv-2', total: 250, status: 'PAID' });
      expect(updated?.[0]).toEqual({ id: 'inv-1', total: 100 });
    });

    it('patches across all core domains (disbursements, clients, transmittals)', () => {
      // Disbursements
      queryClient.setQueryData(['disbursements', 'detail', 'd-1'], { id: 'd-1', status: 'Pending' });
      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'disbursements',
        entityId: 'd-1',
        entityData: { id: 'd-1', status: 'Released' },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });
      expect(queryClient.getQueryData(['disbursements', 'detail', 'd-1'])).toEqual({ id: 'd-1', status: 'Released' });

      // Clients
      queryClient.setQueryData(['clients', 'detail', 'c-1'], { id: 'c-1', name: 'Old Corp' });
      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'clients',
        entityId: 'c-1',
        entityData: { id: 'c-1', name: 'New Corp' },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });
      expect(queryClient.getQueryData(['clients', 'detail', 'c-1'])).toEqual({ id: 'c-1', name: 'New Corp' });

      // Transmittals
      queryClient.setQueryData(['transmittals', 'detail', 't-1'], { id: 't-1', status: 'Draft' });
      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'transmittals',
        entityId: 't-1',
        entityData: { id: 't-1', status: 'Sent' },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });
      expect(queryClient.getQueryData(['transmittals', 'detail', 't-1'])).toEqual({ id: 't-1', status: 'Sent' });
    });

    it('marks queries stale / invalidates when ENTITY_MUTATED has no entityData', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const message: TabSyncMessage = {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-300',
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      };

      handleIncomingTabSyncMessage(queryClient, message);

      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('removes detail cache and filters out list items on ENTITY_DELETED', () => {
      const detailKey = ['operations', 'workRequests', 'detail', 'wr-delete-me'];
      const listKey = ['operations', 'workRequests', 'list'];

      queryClient.setQueryData(detailKey, { id: 'wr-delete-me', name: 'To be deleted' });
      queryClient.setQueryData(listKey, {
        data: [
          { id: 'wr-keep-me', name: 'Keep this' },
          { id: 'wr-delete-me', name: 'To be deleted' },
        ],
      });

      const message: TabSyncMessage = {
        type: 'ENTITY_DELETED',
        domain: 'operations',
        entityId: 'wr-delete-me',
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      };

      handleIncomingTabSyncMessage(queryClient, message);

      // Detail should be removed from cache
      expect(queryClient.getQueryData(detailKey)).toBeUndefined();

      // List should have the item filtered out
      const list = queryClient.getQueryData<{ data: Array<{ id: string }> }>(listKey);
      expect(list).toBeDefined();
      expect(list!.data.length).toBe(1);
      expect(list!.data[0]?.id).toBe('wr-keep-me');
    });

    it('triggers global query invalidation on SESSION_REFRESH', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const message: TabSyncMessage = {
        type: 'SESSION_REFRESH',
        domain: 'operations',
        entityId: 'all',
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      };

      handleIncomingTabSyncMessage(queryClient, message);

      expect(invalidateSpy).toHaveBeenCalledWith();
    });
  });

  describe('Client Bootstrap & QueryClient Configuration (api.ts)', () => {
    it('configures queryClient defaultOptions with required settings', () => {
      const defaultOptions = apiQueryClient.getDefaultOptions();

      expect(defaultOptions.queries?.staleTime).toBe(30 * 1000);
      const retry = defaultOptions.queries?.retry;
      expect(typeof retry).toBe('function');
      if (typeof retry !== 'function') throw new Error('Expected an access-aware retry policy');
      expect(retry(0, new Error('Temporary failure'))).toBe(true);
      expect(retry(1, new Error('Temporary failure'))).toBe(false);
      for (const status of [401, 403, 404]) {
        expect(retry(0, Object.assign(new Error('Access denied'), { status }))).toBe(false);
      }
      expect(defaultOptions.queries?.refetchOnWindowFocus).toBe(true);
      expect(defaultOptions.queries?.refetchOnReconnect).toBe(true);
    });
  });
});
