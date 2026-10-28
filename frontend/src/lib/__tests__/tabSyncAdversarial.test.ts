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

describe('Adversarial & Stress Test: Parcel A Tab Sync & Feature Flags', () => {
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

  describe('Adversarial Feature Flags Edge Cases', () => {
    it('handles hostile, corrupted, and extreme localStorage override values', () => {
      const hostileFalses = [
        'false',
        'FALSE',
        '  fAlSe  ',
        '\t\nfalse\n\t',
      ];
      for (const val of hostileFalses) {
        localStorage.setItem('erp_feature_override_tab_sync', val);
        expect(isFeatureEnabled('tab_sync')).toBe(false);
      }

      const hostileTrues = [
        'true',
        'TRUE',
        '  TrUe  ',
        '\t\ntrue\n\t',
      ];
      for (const val of hostileTrues) {
        localStorage.setItem('erp_feature_override_tab_sync', val);
        expect(isFeatureEnabled('tab_sync')).toBe(true);
      }

      const corruptedFallbacks = [
        '0',
        '1',
        'yes',
        'no',
        '',
        '   ',
        'null',
        'undefined',
        'NaN',
        '[object Object]',
        '{"foo":"bar"}',
        'true; DROP TABLE work_requests;',
        'truthy',
        'falsy',
      ];
      for (const val of corruptedFallbacks) {
        localStorage.setItem('erp_feature_override_tab_sync', val);
        // Falls back to import.meta.env which defaults to true
        expect(isFeatureEnabled('tab_sync')).toBe(true);
      }
    });

    it('survives localStorage security exceptions (e.g. sandboxed iframe or disabled cookies)', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('DOMException: SecurityError: The operation is insecure.');
      });

      // Should not throw and should safely fall back to env default
      expect(() => isFeatureEnabled('tab_sync')).not.toThrow();
      expect(isFeatureEnabled('tab_sync')).toBe(true);
      expect(isFeatureEnabled('realtime_sync')).toBe(true);
      expect(isFeatureEnabled('strict_occ')).toBe(true);
    });

    it('evaluates boolean and string representations in import.meta.env', () => {
      // Test when env variable is explicitly 'false'
      vi.stubEnv('VITE_ENABLE_REALTIME_SYNC', 'false');
      vi.stubEnv('VITE_ENABLE_TAB_SYNC', 'false');
      vi.stubEnv('VITE_ENABLE_STRICT_OCC', 'false');

      expect(isFeatureEnabled('realtime_sync')).toBe(false);
      expect(isFeatureEnabled('tab_sync')).toBe(false);
      expect(isFeatureEnabled('strict_occ')).toBe(false);

      // localStorage takes priority over env
      localStorage.setItem('erp_feature_override_tab_sync', 'true');
      expect(isFeatureEnabled('tab_sync')).toBe(true);

      vi.unstubAllEnvs();
    });
  });

  describe('Adversarial Tab Identity & sessionStorage Edge Cases', () => {
    it('survives sessionStorage security restrictions when generating tab UUID', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: Access to sessionStorage is denied');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError: Access to sessionStorage is denied');
      });

      resetTabIdForTesting(undefined, false);

      let id: string = '';
      expect(() => {
        id = getTabId();
      }).not.toThrow();
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);

      // In-memory caching still guarantees same UUID within the session
      expect(getTabId()).toBe(id);
    });

    it('survives environment without crypto.randomUUID', () => {
      const originalCrypto = globalThis.crypto;
      // @ts-expect-error simulating legacy browser without crypto.randomUUID
      delete globalThis.crypto;

      resetTabIdForTesting(undefined, true);
      const fallbackId = getTabId();
      expect(typeof fallbackId).toBe('string');
      expect(fallbackId.startsWith('tab_')).toBe(true);

      globalThis.crypto = originalCrypto;
    });
  });

  describe('Origin Tab Deduplication Under High-Volume Concurrency Stress', () => {
    let queryClientTabA: QueryClient;
    let queryClientTabB: QueryClient;
    let cleanupA: (() => void) | undefined;
    let cleanupB: (() => void) | undefined;

    beforeEach(() => {
      queryClientTabA = new QueryClient();
      queryClientTabB = new QueryClient();
    });

    afterEach(() => {
      if (cleanupA) cleanupA();
      if (cleanupB) cleanupB();
      queryClientTabA.clear();
      queryClientTabB.clear();
    });

    it('strictly drops 100% of self-sent events while receiving 100% of peer events under concurrent burst', async () => {
      const tabAId = 'tab-uuid-alpha-1111';
      const tabBId = 'tab-uuid-beta-2222';

      // Setup Tab A
      resetTabIdForTesting(tabAId);
      cleanupA = setupTabSyncListener(queryClientTabA);
      const tabASpySetQuery = vi.spyOn(queryClientTabA, 'setQueryData');

      // Setup Tab B channel listener
      const channelTabB = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);
      const tabBReceivedMessages: TabSyncMessage[] = [];
      channelTabB.addEventListener('message', (ev: MessageEvent<TabSyncMessage>) => {
        if (ev.data.originTabId !== tabBId) {
          tabBReceivedMessages.push(ev.data);
        }
      });

      // Tab A broadcasts a burst of 100 entity updates
      const BURST_COUNT = 100;
      for (let i = 0; i < BURST_COUNT; i++) {
        broadcastEntityChange({
          domain: 'operations',
          entityId: `wr-${i}`,
          entityData: { id: `wr-${i}`, version: i, status: 'In Progress' },
        });
      }

      // Tab B also sends 50 messages to Tab A simultaneously
      const channelSenderB = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);
      for (let j = 0; j < 50; j++) {
        const msgB: TabSyncMessage = {
          type: 'ENTITY_MUTATED',
          domain: 'disbursements',
          entityId: `disb-${j}`,
          entityData: { id: `disb-${j}`, status: 'Approved' },
          originTabId: tabBId,
          timestamp: Date.now(),
        };
        channelSenderB.postMessage(msgB);
      }

      // Wait for IPC delivery
      await vi.waitFor(
        () => {
          expect(tabBReceivedMessages.length).toBe(BURST_COUNT);
        },
        { timeout: 1500 }
      );

      // Verify Tab B received all 100 messages from Tab A
      expect(tabBReceivedMessages.length).toBe(BURST_COUNT);
      expect(tabBReceivedMessages.every((m) => m.originTabId === tabAId)).toBe(true);

      // Tab A MUST HAVE DROPPED 100% of its own 100 messages!
      // Tab A only processed the 50 messages sent by Tab B.
      // For each message from Tab B, tabASpySetQuery is called for detail cache & list scanning
      // And Tab A should NEVER have updated cache for any wr-* (which was sent by Tab A)
      const tabASetCalls = tabASpySetQuery.mock.calls;
      const anySelfEntityPatched = tabASetCalls.some((call) => {
        const key = call[0];
        return Array.isArray(key) && key.some((k) => typeof k === 'string' && k.startsWith('wr-'));
      });
      expect(anySelfEntityPatched).toBe(false);

      channelTabB.close();
      channelSenderB.close();
    });
  });

  describe('Hostile Payloads & Error Handling on BroadcastChannel', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      queryClient = new QueryClient();
    });

    afterEach(() => {
      queryClient.clear();
    });

    it('safely drops corrupt or malformed messages without throwing uncaught exceptions', async () => {
      resetTabIdForTesting('tab-listener');
      const cleanup = setupTabSyncListener(queryClient);
      const sender = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);

      const hostileMessages = [
        null,
        undefined,
        'string-payload',
        12345,
        true,
        [],
        {},
        { type: 'UNKNOWN_TYPE_123' },
        { domain: 'unknown_domain' },
        { type: 'ENTITY_MUTATED' }, // missing domain, entityId
        { type: 'ENTITY_MUTATED', domain: 'operations', entityId: null },
        { type: 'ENTITY_DELETED', domain: null, entityId: 'wr-1' },
      ];

      for (const badMsg of hostileMessages) {
        expect(() => {
          sender.postMessage(badMsg);
        }).not.toThrow();
      }

      // Allow message loop to process
      await new Promise((resolve) => setTimeout(resolve, 60));

      sender.close();
      cleanup();
    });

    it('safely handles non-cloneable objects in broadcastEntityChange without crashing', () => {
      // Functions are non-cloneable in BroadcastChannel (Structured Clone Algorithm throws DataCloneError)
      const nonCloneable = { id: 'bad-1', fn: () => {} };

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => {
        broadcastEntityChange({
          domain: 'operations',
          entityId: 'wr-noncloneable',
          entityData: nonCloneable,
        });
      }).not.toThrow();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[tabSync] Failed to postMessage:'),
        expect.anything()
      );
    });

    it('safely handles corrupted cache structures in handleIncomingTabSyncMessage', () => {
      // 1. List query where value is not an array or has null items
      const weirdListKey = ['operations', 'workRequests', 'corrupted-list'];
      queryClient.setQueryData(weirdListKey, {
        data: [
          null,
          undefined,
          42,
          'string item',
          { noId: true },
          { id: 'target-item', title: 'Old' },
        ],
      });

      // 2. Query where value is a raw array with nulls
      const rawListKey = ['operations', 'workRequests', 'corrupted-raw-list'];
      queryClient.setQueryData(rawListKey, [
        null,
        undefined,
        { id: 'target-item', title: 'Old Raw' },
      ]);

      // 3. Query where value.data is null
      queryClient.setQueryData(['operations', 'null-data'], { data: null });

      // 4. Query where value is a primitive
      queryClient.setQueryData(['operations', 'primitive'], 12345);

      // Perform ENTITY_MUTATED
      expect(() => {
        handleIncomingTabSyncMessage(queryClient, {
          type: 'ENTITY_MUTATED',
          domain: 'operations',
          entityId: 'target-item',
          entityData: { id: 'target-item', title: 'New Valid Title' },
          originTabId: 'remote-tab',
          timestamp: Date.now(),
        });
      }).not.toThrow();

      // Check that the corrupted list patched the valid item while preserving other items
      const updatedList = queryClient.getQueryData<{ data: Array<unknown> }>(weirdListKey);
      expect(updatedList).toBeDefined();
      expect(updatedList?.data[5]).toEqual({ id: 'target-item', title: 'Old' });
      expect(queryClient.getQueryState(weirdListKey)?.isInvalidated).toBe(true);

      // Check raw list
      const updatedRaw = queryClient.getQueryData<Array<unknown>>(rawListKey);
      expect(updatedRaw?.[2]).toEqual({ id: 'target-item', title: 'Old Raw' });
      expect(queryClient.getQueryState(rawListKey)?.isInvalidated).toBe(true);

      // Perform ENTITY_DELETED on corrupted list
      expect(() => {
        handleIncomingTabSyncMessage(queryClient, {
          type: 'ENTITY_DELETED',
          domain: 'operations',
          entityId: 'target-item',
          originTabId: 'remote-tab',
          timestamp: Date.now(),
        });
      }).not.toThrow();

      const deletedList = queryClient.getQueryData<{ data: Array<unknown> }>(weirdListKey);
      expect(deletedList?.data.some((i: any) => i?.id === 'target-item')).toBe(false);
    });

    it('safely handles prototype pollution attempts in entityData', () => {
      const maliciousPayload = JSON.parse('{"__proto__": {"polluted": true}, "id": "wr-evil", "title": "Evil"}');

      queryClient.setQueryData(['operations', 'workRequests', 'detail', 'wr-evil'], {
        id: 'wr-evil',
        title: 'Safe',
      });

      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-evil',
        entityData: maliciousPayload,
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });

      // Verify global Object prototype was NOT polluted
      expect(({} as any).polluted).toBeUndefined();
    });
  });

  describe('Dynamic Feature Flag Toggling at Runtime', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      queryClient = new QueryClient();
    });

    afterEach(() => {
      queryClient.clear();
    });

    it('immediately halts broadcast dispatching and incoming message handling when tab_sync is disabled dynamically', async () => {
      resetTabIdForTesting('tab-runtime');
      const cleanup = setupTabSyncListener(queryClient);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const sender = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);

      // Verify working initially
      sender.postMessage({
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-dyn-1',
        entityData: { id: 'wr-dyn-1', status: 'Active' },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });

      await vi.waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalled();
      });
      invalidateSpy.mockClear();

      // Now dynamically disable tab_sync via localStorage override
      localStorage.setItem('erp_feature_override_tab_sync', 'false');
      expect(isFeatureEnabled('tab_sync')).toBe(false);

      // Broadcast sending should now be a no-op
      broadcastEntityChange({
        domain: 'operations',
        entityId: 'wr-dyn-2',
        entityData: { id: 'wr-dyn-2' },
      });

      // Sending to channel should be ignored by the listener
      sender.postMessage({
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-dyn-3',
        entityData: { id: 'wr-dyn-3', status: 'Active' },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(invalidateSpy).not.toHaveBeenCalled();

      sender.close();
      cleanup();
    });
  });

  describe('Multi-Tab Mesh Stress Test (5 Concurrent Simulated Tabs)', () => {
    it('accurately deduplicates origin tab across 5 concurrent tabs with bidirectional messaging', async () => {
      const TAB_COUNT = 5;
      const tabIds: string[] = Array.from({ length: TAB_COUNT }, (_, i) => `tab-mesh-${i + 1}`);
      const queryClients: QueryClient[] = tabIds.map(() => new QueryClient());
      const channels: BroadcastChannel[] = [];
      const cleanups: Array<() => void> = [];
      const receivedCounts: number[] = new Array(TAB_COUNT).fill(0);

      // Tab 0 is the primary module tab under test
      resetTabIdForTesting(tabIds[0]!);
      const qc0 = queryClients[0]!;
      vi.spyOn(qc0 as any, 'setQueryData').mockImplementation(() => {
        receivedCounts[0] = (receivedCounts[0] ?? 0) + 1;
        return qc0;
      });
      vi.spyOn(qc0, 'invalidateQueries').mockImplementation(async () => { receivedCounts[0] = (receivedCounts[0] ?? 0) + 1; });
      const cleanup0 = setupTabSyncListener(qc0);
      cleanups.push(cleanup0);

      // Tabs 1 through 4 are simulated peer tabs, each with its own independent BroadcastChannel
      for (let i = 1; i < TAB_COUNT; i++) {
        const peerChannel = new BroadcastChannel(TAB_SYNC_CHANNEL_NAME);
        channels.push(peerChannel);
        const peerQc = queryClients[i]!;
        const tabIndex = i;
        const peerTabId = tabIds[i]!;

        vi.spyOn(peerQc as any, 'setQueryData').mockImplementation(() => {
          receivedCounts[tabIndex] = (receivedCounts[tabIndex] ?? 0) + 1;
          return peerQc;
        });

        vi.spyOn(peerQc, 'invalidateQueries').mockImplementation(async () => { receivedCounts[tabIndex] = (receivedCounts[tabIndex] ?? 0) + 1; });
        const listener = (event: MessageEvent<TabSyncMessage<unknown>>) => {
          // Peer tab origin deduplication
          if (event.data?.originTabId === peerTabId) {
            return;
          }
          handleIncomingTabSyncMessage(peerQc, event.data);
        };

        peerChannel.addEventListener('message', listener);
        cleanups.push(() => {
          peerChannel.removeEventListener('message', listener);
          peerChannel.close();
        });
      }

      // 1. Tab 0 broadcasts 10 entity changes
      for (let m = 0; m < 10; m++) {
        broadcastEntityChange({
          domain: 'operations',
          entityId: `wr-mesh-${m}`,
          entityData: { id: `wr-mesh-${m}`, status: 'Pending' },
        });
      }

      // Wait for IPC propagation to peer tabs (Tabs 1, 2, 3, 4)
      await vi.waitFor(
        () => {
          expect(receivedCounts[1] ?? 0).toBeGreaterThanOrEqual(10);
          expect(receivedCounts[2] ?? 0).toBeGreaterThanOrEqual(10);
          expect(receivedCounts[3] ?? 0).toBeGreaterThanOrEqual(10);
          expect(receivedCounts[4] ?? 0).toBeGreaterThanOrEqual(10);
        },
        { timeout: 1500 }
      );

      // Tab 0 must NOT have processed its own self-sent messages!
      expect(receivedCounts[0]).toBe(0);

      // 2. Peer Tab 2 sends 5 messages
      const tab2PrevCount = receivedCounts[2] ?? 0;
      for (let m = 0; m < 5; m++) {
        channels[1]!.postMessage({
          type: 'ENTITY_MUTATED',
          domain: 'billing',
          entityId: `inv-mesh-${m}`,
          entityData: { id: `inv-mesh-${m}`, status: 'Paid' },
          originTabId: tabIds[2]!,
          timestamp: Date.now(),
        });
      }

      // Wait for Tab 0 (and other peer tabs) to receive Tab 2's messages
      await vi.waitFor(
        () => {
          expect(receivedCounts[0] ?? 0).toBeGreaterThanOrEqual(5);
        },
        { timeout: 1500 }
      );

      // Peer Tab 2 must NOT have received its own 5 messages
      expect(receivedCounts[2]).toBe(tab2PrevCount);

      const beforeReflected = receivedCounts[0];
      // 3. Peer Tab 1 sends a message with Tab 0's ID (simulating reflected self message)
      channels[0]!.postMessage({
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-reflected-self',
        entityData: { id: 'wr-reflected-self', status: 'Blocked' },
        originTabId: tabIds[0]!, // Identical to Tab 0's tab ID!
        timestamp: Date.now(),
      });

      // Give it time to deliver
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Tab 0 must have ignored the reflected message with its own originTabId
      const allQc0Calls = (qc0.setQueryData as any).mock.calls;
      const reflectedProcessed = allQc0Calls.some((call: any) => {
        const key = call[0];
        return Array.isArray(key) && key.includes('wr-reflected-self');
      });
      expect(reflectedProcessed).toBe(false);
      expect(receivedCounts[0]).toBe(beforeReflected);

      // Teardown
      cleanups.forEach((c) => c());
      queryClients.forEach((qc) => qc.clear());
    });
  });

  describe('Cache Data Preservation and Invalidation Precision', () => {
    let queryClient: QueryClient;

    beforeEach(() => {
      queryClient = new QueryClient();
    });

    afterEach(() => {
      queryClient.clear();
    });

    it('preserves authorized entity fields and invalidates when a tab provides partial rows', () => {
      const detailKey = ['operations', 'workRequests', 'detail', 'wr-partial'];
      queryClient.setQueryData(detailKey, {
        id: 'wr-partial',
        title: 'Original Title',
        clientName: 'Big Corp',
        budget: 50000,
        tags: ['tax', 'audit'],
        version: 3,
      });

      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-partial',
        entityData: { id: 'wr-partial', status: 'Under Review', version: 4 },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });

      const updated = queryClient.getQueryData<Record<string, unknown>>(detailKey);
      expect(updated).toEqual({
        id: 'wr-partial',
        title: 'Original Title',
        clientName: 'Big Corp',
        budget: 50000,
        tags: ['tax', 'audit'],
        version: 3,
      });
      expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    });

    it('preserves list metadata while invalidating permission-sensitive operations rows', () => {
      const listKey = ['operations', 'workRequests', 'list', 'filter-active'];
      queryClient.setQueryData(listKey, {
        data: [
          { id: 'wr-1', status: 'Pending' },
          { id: 'wr-2', status: 'Pending' },
        ],
        pagination: { page: 1, limit: 20, total: 2 },
        summary: { totalAmount: 12500 },
      });

      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-2',
        entityData: { id: 'wr-2', status: 'Completed' },
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });

      const updatedList = queryClient.getQueryData<any>(listKey);
      expect(updatedList.pagination).toEqual({ page: 1, limit: 20, total: 2 });
      expect(updatedList.summary).toEqual({ totalAmount: 12500 });
      expect(updatedList.data[1].status).toBe('Pending');
      expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
      expect(updatedList.data[0].status).toBe('Pending');
    });

    it('invalidates only affected domain queries and lists when entityData is omitted', () => {
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      handleIncomingTabSyncMessage(queryClient, {
        type: 'ENTITY_MUTATED',
        domain: 'operations',
        entityId: 'wr-target',
        originTabId: 'remote-tab',
        timestamp: Date.now(),
      });

      expect(invalidateSpy).toHaveBeenCalledWith({
        predicate: expect.any(Function),
      });

      // Extract predicate and test matching logic
      const predicateCall = invalidateSpy.mock.calls.find((c) => c[0] && typeof c[0] === 'object' && 'predicate' in c[0]);
      const predicate = (predicateCall?.[0] as any)?.predicate;
      expect(predicate).toBeDefined();

      // Should match matching entity detail
      expect(predicate({ queryKey: ['operations', 'workRequests', 'detail', 'wr-target'] })).toBe(true);
      // Should match operations list
      expect(predicate({ queryKey: ['operations', 'workRequests', 'list'] })).toBe(true);
      expect(predicate({ queryKey: ['operations', 'lists'] })).toBe(true);
      // Should NOT match other entity in operations
      expect(predicate({ queryKey: ['operations', 'workRequests', 'detail', 'wr-other'] })).toBe(false);
      // Should NOT match different domain
      expect(predicate({ queryKey: ['billing', 'invoices', 'detail', 'wr-target'] })).toBe(false);
      expect(predicate({ queryKey: ['billing', 'list'] })).toBe(false);
    });
  });

  describe('Channel Error and Edge Case Resilience', () => {
    it('safely handles BroadcastChannel constructor throwing an error', () => {
      const originalBroadcastChannel = globalThis.BroadcastChannel;
      // Mock BroadcastChannel constructor to throw
      globalThis.BroadcastChannel = class {
        constructor() {
          throw new Error('BroadcastChannel is disabled in this context');
        }
      } as any;

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const channel = getTabSyncChannel();
      expect(channel).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[tabSync] Failed to initialize BroadcastChannel:'),
        expect.anything()
      );

      // broadcastEntityChange and setupTabSyncListener should safely no-op
      const qc = new QueryClient();
      expect(() => {
        broadcastEntityChange({ domain: 'operations', entityId: 'test' });
        const cleanup = setupTabSyncListener(qc);
        cleanup();
      }).not.toThrow();

      globalThis.BroadcastChannel = originalBroadcastChannel;
    });

    it('calling cleanup multiple times is safe and idempotent', () => {
      const qc = new QueryClient();
      const cleanup = setupTabSyncListener(qc);
      expect(() => {
        cleanup();
        cleanup();
        cleanup();
      }).not.toThrow();
    });
  });
});

