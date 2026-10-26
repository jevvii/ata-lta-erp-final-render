import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEntityRealtimeSync, handleRealtimePayload, clearChannelRegistryForTesting } from '../useEntityRealtimeSync';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import { getTabId, resetTabIdForTesting } from '@/lib/tabSync';
import { trackLocalMutation, clearLocalMutationsForTesting } from '../loopPrevention';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';

interface TestRecord {
  id?: string;
  title?: string;
  version?: number;
  entity?: string;
  invoiceNumber?: string;
  referenceNumber?: string;
  data?: TestRecord[];
  meta?: { total?: number };
  phases?: Array<{
    id: string;
    tasks?: Array<{ id: string; title: string; status: string }>;
  }>;
}

describe('useEntityRealtimeSync and Three-Guard CDC Engine (R4 Criteria)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting('tab-self-123');
    useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    localStorage.clear();
    clearLocalMutationsForTesting();
    clearChannelRegistryForTesting();
    resetTabIdForTesting();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Criterion 1: Channel Subscription & Incoming Event Handling
  // =========================================================================
  describe('Criterion 1: Channel Subscription & Incoming Event Handling', () => {
    it('subscribes to canonical postgres_changes channel on mount', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');
    });

    it('receives and processes live postgres_changes events for work_requests', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      const channel = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      expect(channel).toBeDefined();

      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-live-1', entity: 'ATA', title: 'Live Update WR', version: 1 },
        });
      });

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-live-1'));
      expect(cached?.title).toBe('Live Update WR');
    });

    it('receives and processes live postgres_changes events for invoices', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      renderHook(
        () => useEntityRealtimeSync({ table: 'invoices' }),
        { wrapper: createWrapper() }
      );

      const channel = supabase.channel('cdc_invoices') as unknown as MockRealtimeChannel;
      expect(channel).toBeDefined();

      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'inv-live-1', entity: 'ATA', invoiceNumber: 'INV-LIVE-001', version: 1 },
        });
      });

      const cached = queryClient.getQueryData<TestRecord>(billingKeys.invoiceDetail('inv-live-1'));
      expect(cached?.invoiceNumber).toBe('INV-LIVE-001');
    });

    it('receives and processes live postgres_changes events for disbursements', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      renderHook(
        () => useEntityRealtimeSync({ table: 'disbursements' }),
        { wrapper: createWrapper() }
      );

      const channel = supabase.channel('cdc_disbursements') as unknown as MockRealtimeChannel;
      expect(channel).toBeDefined();

      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'disb-live-1', entity: 'ATA', referenceNumber: 'DISB-LIVE-001', version: 1 },
        });
      });

      const cached = queryClient.getQueryData<TestRecord>(disbursementKeys.detail('disb-live-1'));
      expect(cached?.referenceNumber).toBe('DISB-LIVE-001');
    });
  });

  // =========================================================================
  // Criterion 2: Feature Flag Guard
  // =========================================================================
  describe('Criterion 2: Feature Flag Guard', () => {
    it('does not subscribe when realtime_sync feature flag is disabled', () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      expect(channelSpy).not.toHaveBeenCalled();
    });

    it('does not subscribe when options.enabled is explicitly false', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests', enabled: false }),
        { wrapper: createWrapper() }
      );

      expect(channelSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Criterion 3: Tenant Isolation Guard
  // =========================================================================
  describe('Criterion 3: Tenant Isolation Guard', () => {
    it('discards cross-tenant events when activeEntity is ATA and payload is LTA', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      const payloadCrossTenant = {
        eventType: 'UPDATE',
        new: { id: 'wr-999', entity: 'LTA', version: 2, title: 'LTA Request' },
        old: { id: 'wr-999', entity: 'LTA', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadCrossTenant);
      expect(processed).toBe(false);

      const cached = queryClient.getQueryData(operationsKeys.workRequestDetail('wr-999'));
      expect(cached).toBeUndefined();
    });

    it('processes events matching activeEntity (ATA)', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      const payloadSameTenant = {
        eventType: 'UPDATE',
        new: { id: 'wr-1', entity: 'ATA', version: 2, title: 'ATA Updated' },
        old: { id: 'wr-1', entity: 'ATA', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payloadSameTenant);
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-1'));
      expect(cached?.title).toBe('ATA Updated');
    });

    it('processes events when activeEntity is ALL regardless of payload entity', () => {
      useSessionStore.setState({ activeEntity: 'ALL' });

      const payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-2', entity: 'LTA', version: 2, title: 'LTA Handled Under ALL' },
        old: { id: 'wr-2', entity: 'LTA', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-2'));
      expect(cached?.title).toBe('LTA Handled Under ALL');
    });

    it('gracefully allows tables without entity_id such as tasks', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      const taskPayload = {
        eventType: 'UPDATE',
        new: { id: 'task-1', work_request_id: 'wr-1', version: 2, title: 'Task Updated' },
        old: { id: 'task-1', work_request_id: 'wr-1', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'tasks' }, taskPayload);
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.taskDetail('wr-1', 'task-1'));
      expect(cached?.title).toBe('Task Updated');
    });

    it('discards payloads with entity_id: null when activeEntity is ATA', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });
      const payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-null-id', entity_id: null, version: 2 },
      };
      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);
      expect(processed).toBe(false);
    });

    it('matches activeEntityUUID case-insensitively when payload contains uppercase UUID', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });
      const lowerUUID = '123e4567-e89b-12d3-a456-426614174000';
      const upperUUID = '123E4567-E89B-12D3-A456-426614174000';
      const payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-uuid', entity_id: upperUUID, version: 2, title: 'UUID Match' },
      };
      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests', activeEntityUUID: lowerUUID },
        payload
      );
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-uuid'));
      expect(cached?.title).toBe('UUID Match');
    });

    it('discards tenant-scoped payloads when activeEntity is null in unassigned session', () => {
      useSessionStore.setState({ activeEntity: null });
      const payload = {
        eventType: 'UPDATE',
        new: { id: 'wr-unassigned', entity: 'LTA', version: 2 },
      };
      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, payload);
      expect(processed).toBe(false);
    });

    it('resolves ATA entity UUID automatically when payload contains raw ATA entity_id UUID and activeEntity is ATA', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      // CDC row payload from Supabase has raw UUID entity_id and no entity code
      const payload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-ata-cdc',
          entity_id: 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822', // ATA Canonical UUID
          version: 2,
          title: 'ATA Live CDC Update',
        },
        old: {
          id: 'wr-ata-cdc',
          entity_id: 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822',
          version: 1,
        },
      };

      // Notice options.activeEntityUUID is NOT provided
      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        payload
      );
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(
        operationsKeys.workRequestDetail('wr-ata-cdc')
      );
      expect(cached?.title).toBe('ATA Live CDC Update');
    });

    it('discards payload with raw LTA entity_id UUID when activeEntity is ATA (without activeEntityUUID)', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      // Foreign tenant payload with raw LTA UUID
      const payload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-lta-cdc',
          entity_id: '16749820-0129-44a8-9435-a6013d07a370', // LTA Canonical UUID
          version: 2,
          title: 'LTA Live CDC Update',
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        payload
      );
      expect(processed).toBe(false);

      const cached = queryClient.getQueryData(
        operationsKeys.workRequestDetail('wr-lta-cdc')
      );
      expect(cached).toBeUndefined();
    });

    it('resolves LTA entity UUID automatically when payload contains raw LTA entity_id UUID and activeEntity is LTA', () => {
      useSessionStore.setState({ activeEntity: 'LTA' });

      const payload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-lta-match',
          entity_id: '16749820-0129-44a8-9435-a6013d07a370', // LTA Canonical UUID
          version: 2,
          title: 'LTA Live Match',
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        payload
      );
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(
        operationsKeys.workRequestDetail('wr-lta-match')
      );
      expect(cached?.title).toBe('LTA Live Match');
    });

    it('discards payload with raw ATA entity_id UUID when activeEntity is LTA', () => {
      useSessionStore.setState({ activeEntity: 'LTA' });

      const payload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-ata-foreign',
          entity_id: 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822', // ATA Canonical UUID
          version: 2,
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        payload
      );
      expect(processed).toBe(false);
    });

    it('matches raw entity_id UUID with mixed-case and whitespace against activeEntity without activeEntityUUID', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      const payload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-casing-cdc',
          entity_id: '  E83DC90B-D9B5-4854-8ADF-7FE21C2E6822  ', // ATA mixed-case with whitespace
          version: 2,
          title: 'Casing Match',
        },
      };

      const processed = handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        payload
      );
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(
        operationsKeys.workRequestDetail('wr-casing-cdc')
      );
      expect(cached?.title).toBe('Casing Match');
    });
  });

  // =========================================================================
  // Criterion 4: Stale Version Rejection Guard
  // =========================================================================
  describe('Criterion 4: Stale Version Guard', () => {
    it('discards duplicate INSERT payloads where version is equal to cached version', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-10'), {
        id: 'wr-10',
        entity: 'ATA',
        version: 5,
        title: 'Original V5',
      });

      const duplicateInsertPayload = {
        eventType: 'INSERT',
        new: { id: 'wr-10', entity: 'ATA', version: 5, title: 'Duplicate INSERT V5' },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, duplicateInsertPayload);
      expect(processed).toBe(false);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-10'));
      expect(cached?.title).toBe('Original V5');
    });

    it('accepts UPDATE payloads where version is equal to cached version (SPEC-002)', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-10'), {
        id: 'wr-10',
        entity: 'ATA',
        version: 5,
        title: 'Original V5',
      });

      const equalUpdatePayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-10', entity: 'ATA', version: 5, title: 'Duplicate V5' },
        old: { id: 'wr-10', entity: 'ATA', version: 4 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, equalUpdatePayload);
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-10'));
      expect(cached?.title).toBe('Duplicate V5');
      expect(cached?.version).toBe(5);
    });

    it('discards payloads where version is lower than cached version', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-10'), {
        id: 'wr-10',
        entity: 'ATA',
        version: 5,
        title: 'Original V5',
      });

      const stalePayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-10', entity: 'ATA', version: 4, title: 'Stale V4' },
        old: { id: 'wr-10', entity: 'ATA', version: 3 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, stalePayload);
      expect(processed).toBe(false);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-10'));
      expect(cached?.title).toBe('Original V5');
    });

    it('accepts payloads where version is greater than cached version', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-10'), {
        id: 'wr-10',
        entity: 'ATA',
        version: 5,
        title: 'Original V5',
      });

      const newerPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-10', entity: 'ATA', version: 6, title: 'Newer V6' },
        old: { id: 'wr-10', entity: 'ATA', version: 5 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, newerPayload);
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-10'));
      expect(cached?.title).toBe('Newer V6');
      expect(cached?.version).toBe(6);
    });

    it('accepts payloads when cached version is undefined or cache is empty', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      const newRecordPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-new-unversioned', entity: 'ATA', version: 1, title: 'Uncached' },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, newRecordPayload);
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-new-unversioned'));
      expect(cached?.title).toBe('Uncached');
    });
  });

  // =========================================================================
  // Criterion 5: Loop Prevention Guard
  // =========================================================================
  describe('Criterion 5: Loop Prevention Guard', () => {
    it('discards payload with origin_tab_id matching current tab', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });
      const currentTab = getTabId();

      const selfPayload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-20',
          entity: 'ATA',
          version: 2,
          origin_tab_id: currentTab,
          title: 'Self Tab Write',
        },
        old: { id: 'wr-20', entity: 'ATA', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, selfPayload);
      expect(processed).toBe(false);

      const cached = queryClient.getQueryData(operationsKeys.workRequestDetail('wr-20'));
      expect(cached).toBeUndefined();
    });

    it('discards payload registered in local mutation tracker', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      trackLocalMutation('work_requests', 'wr-30', 2);

      const localPayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-30', entity: 'ATA', version: 2, title: 'Dispatched By Tab' },
        old: { id: 'wr-30', entity: 'ATA', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, localPayload);
      expect(processed).toBe(false);

      const cached = queryClient.getQueryData(operationsKeys.workRequestDetail('wr-30'));
      expect(cached).toBeUndefined();
    });

    it('accepts payload originated from a different tab', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      const otherTabPayload = {
        eventType: 'UPDATE',
        new: {
          id: 'wr-25',
          entity: 'ATA',
          version: 2,
          origin_tab_id: 'tab-peer-999',
          title: 'Peer Tab Write',
        },
        old: { id: 'wr-25', entity: 'ATA', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, otherTabPayload);
      expect(processed).toBe(true);

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-25'));
      expect(cached?.title).toBe('Peer Tab Write');
    });
  });

  // =========================================================================
  // Criterion 6: TanStack Query Cache Reconciliation
  // =========================================================================
  describe('Criterion 6: TanStack Query Cache Reconciliation', () => {
    it('patches detail and list caches on UPDATE', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-100'), {
        id: 'wr-100',
        entity: 'ATA',
        title: 'Initial Title',
        version: 1,
      });

      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [
          { id: 'wr-100', entity: 'ATA', title: 'Initial Title', version: 1 },
          { id: 'wr-101', entity: 'ATA', title: 'Other Title', version: 1 },
        ],
        meta: { total: 2, page: 1, limit: 10 },
      });

      const updatePayload = {
        eventType: 'UPDATE',
        new: { id: 'wr-100', entity: 'ATA', title: 'Updated Title', version: 2 },
        old: { id: 'wr-100', entity: 'ATA', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'work_requests' }, updatePayload);
      expect(processed).toBe(true);

      const updatedDetail = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-100'));
      expect(updatedDetail?.title).toBe('Updated Title');
      expect(updatedDetail?.version).toBe(2);

      const updatedList = queryClient.getQueryData<{ data: TestRecord[] }>(operationsKeys.workRequestsList('ATA'));
      expect(updatedList?.data?.[0]?.title).toBe('Updated Title');
      expect(updatedList?.data?.[0]?.version).toBe(2);
      expect(updatedList?.data?.[1]?.title).toBe('Other Title');
    });

    it('prepends new records into list cache and seeds detail cache on INSERT', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(billingKeys.invoicesList('ATA'), {
        data: [{ id: 'inv-1', entity: 'ATA', invoiceNumber: 'INV-001', version: 1 }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      const insertPayload = {
        eventType: 'INSERT',
        new: { id: 'inv-2', entity: 'ATA', invoiceNumber: 'INV-002', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'invoices' }, insertPayload);
      expect(processed).toBe(true);

      const list = queryClient.getQueryData<TestRecord>(billingKeys.invoicesList('ATA'));
      expect(list?.data).toHaveLength(2);
      expect(list?.data?.[0]?.id).toBe('inv-2');
      expect(list?.meta?.total).toBe(2);

      const detail = queryClient.getQueryData<TestRecord>(billingKeys.invoiceDetail('inv-2'));
      expect(detail?.invoiceNumber).toBe('INV-002');
    });

    it('removes records from detail and list caches on DELETE and decrements total', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(disbursementKeys.detail('disb-1'), {
        id: 'disb-1',
        entity: 'ATA',
        referenceNumber: 'DISB-001',
      });

      queryClient.setQueryData(disbursementKeys.list('ATA'), {
        data: [{ id: 'disb-1', entity: 'ATA', referenceNumber: 'DISB-001' }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      const deletePayload = {
        eventType: 'DELETE',
        old: { id: 'disb-1', entity: 'ATA' },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'disbursements' }, deletePayload);
      expect(processed).toBe(true);

      const detail = queryClient.getQueryData(disbursementKeys.detail('disb-1'));
      expect(detail).toBeUndefined();

      const list = queryClient.getQueryData<TestRecord>(disbursementKeys.list('ATA'));
      expect(list?.data).toHaveLength(0);
      expect(list?.meta?.total).toBe(0);
    });

    it('enforces eventType UPDATE precedence: does not treat UPDATE as DELETE when payload.new is absent', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(operationsKeys.workRequestDetail('wr-update-nodelete'), {
        id: 'wr-update-nodelete',
        entity: 'ATA',
        title: 'Preserved Title',
        version: 1,
      });

      // UPDATE event where payloadObj.new is null/empty but payloadObj.old exists
      const edgePayload = {
        eventType: 'UPDATE',
        new: null,
        old: { id: 'wr-update-nodelete', entity: 'ATA', version: 1 },
      };

      handleRealtimePayload(queryClient, { table: 'work_requests' }, edgePayload);

      // Should not be deleted from cache
      const cached = queryClient.getQueryData(operationsKeys.workRequestDetail('wr-update-nodelete'));
      expect(cached).toBeDefined();
    });

    it('enforces eventType UPDATE precedence: does not treat UPDATE as INSERT when payload.old is absent', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(billingKeys.invoicesList('ATA'), {
        data: [{ id: 'inv-upd-1', entity: 'ATA', invoiceNumber: 'INV-EXISTING', version: 1 }],
        meta: { total: 1, page: 1, limit: 10 },
      });

      // UPDATE event where payload.new exists but old is omitted
      const updatePayloadWithoutOld = {
        eventType: 'UPDATE',
        new: { id: 'inv-upd-1', entity: 'ATA', invoiceNumber: 'INV-UPDATED', version: 2 },
      };

      handleRealtimePayload(queryClient, { table: 'invoices' }, updatePayloadWithoutOld);

      const list = queryClient.getQueryData<TestRecord>(billingKeys.invoicesList('ATA'));
      expect(list?.data).toHaveLength(1);
      expect(list?.meta?.total).toBe(1);
    });

    it('infers DELETE when eventType is omitted but only old record is provided', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(disbursementKeys.detail('disb-infer-del'), {
        id: 'disb-infer-del',
        entity: 'ATA',
        referenceNumber: 'DISB-INFER',
      });

      const untypedDeletePayload = {
        old: { id: 'disb-infer-del', entity: 'ATA' },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'disbursements' }, untypedDeletePayload);
      expect(processed).toBe(true);

      const detail = queryClient.getQueryData(disbursementKeys.detail('disb-infer-del'));
      expect(detail).toBeUndefined();
    });

    it('infers INSERT when eventType is omitted but only new record is provided', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(billingKeys.invoicesList('ATA'), {
        data: [],
        meta: { total: 0, page: 1, limit: 10 },
      });

      const untypedInsertPayload = {
        new: { id: 'inv-infer-ins', entity: 'ATA', invoiceNumber: 'INV-INFERRED', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'invoices' }, untypedInsertPayload);
      expect(processed).toBe(true);

      const list = queryClient.getQueryData<TestRecord>(billingKeys.invoicesList('ATA'));
      expect(list?.data).toHaveLength(1);
      expect(list?.data?.[0]?.id).toBe('inv-infer-ins');
    });

    it('updates nested task inside work request phases cache on task UPDATE', () => {
      useSessionStore.setState({
      activeEntity: 'ATA',
      user: {
        id: '00000000-0000-4000-a000-000000000099',
        role: 'Admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
    });

      queryClient.setQueryData(operationsKeys.workRequestsList('ATA'), {
        data: [
          {
            id: 'wr-parent',
            entity: 'ATA',
            phases: [
              {
                id: 'phase-1',
                tasks: [{ id: 'task-nested-1', title: 'Initial Task', status: 'Pending' }],
              },
            ],
          },
        ],
        meta: { total: 1, page: 1, limit: 10 },
      });

      const taskPayload = {
        eventType: 'UPDATE',
        new: {
          id: 'task-nested-1',
          work_request_id: 'wr-parent',
          title: 'Updated Nested Task',
          status: 'Done',
          version: 2,
        },
        old: { id: 'task-nested-1', version: 1 },
      };

      const processed = handleRealtimePayload(queryClient, { table: 'tasks' }, taskPayload);
      expect(processed).toBe(true);

      const list = queryClient.getQueryData<{ data: TestRecord[] }>(operationsKeys.workRequestsList('ATA'));
      const updatedPhaseTask = list?.data?.[0]?.phases?.[0]?.tasks?.[0];
      expect(updatedPhaseTask?.title).toBe('Updated Nested Task');
      expect(updatedPhaseTask?.status).toBe('Done');
    });
  });

  // =========================================================================
  // Criterion 7: Subscription Cleanup on Component Unmount
  // =========================================================================
  describe('Criterion 7: Subscription Cleanup on Component Unmount', () => {
    it('calls supabase.removeChannel when component unmounts', () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const { unmount } = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      expect(channelSpy).toHaveBeenCalledWith('cdc_work_requests');

      unmount();
      expect(removeChannelSpy).toHaveBeenCalled();
    });

    it('preserves channel for remaining subscriber during multi-component multiplexing', () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      // Mount first hook instance
      const hookA = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      // Mount second hook instance on the same table
      const hookB = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      // Unmount Hook A only
      hookA.unmount();

      // Channel should NOT be removed because Hook B is still active
      expect(removeChannelSpy).not.toHaveBeenCalled();

      // Hook B should still be able to receive CDC events
      const channel = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-multiplex-1', entity: 'ATA', title: 'Hook B Alive', version: 1 },
        });
      });

      const cached = queryClient.getQueryData<TestRecord>(operationsKeys.workRequestDetail('wr-multiplex-1'));
      expect(cached?.title).toBe('Hook B Alive');

      // Now unmount Hook B
      hookB.unmount();
      expect(removeChannelSpy).toHaveBeenCalled();
    });

    it('ceases processing events after hook unmount', () => {
      const { unmount } = renderHook(
        () => useEntityRealtimeSync({ table: 'work_requests' }),
        { wrapper: createWrapper() }
      );

      const channel = supabase.channel('cdc_work_requests') as unknown as MockRealtimeChannel;
      unmount();

      act(() => {
        channel.emit('postgres_changes', {
          eventType: 'UPDATE',
          new: { id: 'wr-after-unmount', entity: 'ATA', title: 'Post-Unmount Event', version: 1 },
        });
      });

      const cached = queryClient.getQueryData(operationsKeys.workRequestDetail('wr-after-unmount'));
      expect(cached).toBeUndefined();
    });
  });

  // =========================================================================
  // Criterion 8: Non-Admin & Untrusted CDC Query Invalidation (SHARED-PROJECT-VISIBILITY-20261024)
  // =========================================================================
  describe('Criterion 8: Non-Admin & Untrusted CDC Query Invalidation', () => {
    it('invalidates queries instead of raw injecting when user is non-admin staff', () => {
      useSessionStore.setState({
        activeEntity: 'ATA',
        user: {
          id: 'staff-1',
          role: 'Staff',
          email: 'staff@ata-lta.ph',
          name: 'Staff Member',
          departments: ['Operations'],
          entities: ['ATA'],
        },
      });

      const detailKey = operationsKeys.workRequestDetail('wr-staff-test');
      queryClient.setQueryData(detailKey, { id: 'wr-staff-test', title: 'Before Staff Invalidation', version: 1 });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        {
          eventType: 'UPDATE',
          table: 'work_requests',
          schema: 'public',
          new: { id: 'wr-staff-test', entity: 'ATA', title: 'Attempted Raw Injection', version: 2 },
          old: { id: 'wr-staff-test', entity: 'ATA', title: 'Before Staff Invalidation', version: 1 },
        }
      );

      // Raw injection must NOT occur: cache title should not be modified directly
      const cached = queryClient.getQueryData<TestRecord>(detailKey);
      expect(cached?.title).toBe('Before Staff Invalidation');

      // Instead, query invalidation must be triggered
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: detailKey })
      );
    });

    it('invalidates queries instead of raw injecting when current user is null / unauthenticated', () => {
      useSessionStore.setState({
        activeEntity: 'ATA',
        user: null,
      });

      const detailKey = operationsKeys.workRequestDetail('wr-null-user-test');
      queryClient.setQueryData(detailKey, { id: 'wr-null-user-test', title: 'Before Null User Invalidation', version: 1 });

      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      handleRealtimePayload(
        queryClient,
        { table: 'work_requests' },
        {
          eventType: 'UPDATE',
          table: 'work_requests',
          schema: 'public',
          new: { id: 'wr-null-user-test', entity: 'ATA', title: 'Attempted Untrusted Injection', version: 2 },
          old: { id: 'wr-null-user-test', entity: 'ATA', title: 'Before Null User Invalidation', version: 1 },
        }
      );

      // Cache title must NOT be overwritten
      const cached = queryClient.getQueryData<TestRecord>(detailKey);
      expect(cached?.title).toBe('Before Null User Invalidation');

      // Query invalidation must be triggered
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: detailKey })
      );
    });
  });
});
