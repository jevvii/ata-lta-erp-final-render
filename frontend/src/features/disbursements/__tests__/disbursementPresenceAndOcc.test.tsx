import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import {
  useApproveDisbursement,
  useRejectDisbursement,
  useFundDisbursement,
  useReleaseDisbursement,
} from '../api/useDisbursements';
import { disbursementKeys } from '../api/queryKeys';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
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

const mockDisbursementDetail: Disbursement = {
  id: 'disb-201',
  disbursement_number: 'DISB-ATA-20261004-201',
  entity_id: 'ent-1',
  entity_code: 'ATA',
  category: 'Transportation',
  description: 'Urgent messenger dispatch to Court of Appeals',
  amount: 850,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: 'wr-101',
  version: 2,
  created_at: '2026-10-09T08:00:00Z',
  updated_at: '2026-10-09T08:00:00Z',
  client_name: 'Acme Philippines Corp',
};

describe('Disbursements Presence & Optimistic Concurrency Control (Milestone 4 / Parcel 2C & 2D)', () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  beforeEach(() => {
    localStorage.clear();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
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
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    localStorage.clear();
    await supabase.removeAllChannels();
    useBlockingModalStore.getState().reset();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. Ephemeral Presence Subsystem in DisbursementDetailDrawer
  // =========================================================================
  describe('1. Disbursement Ephemeral Presence Subsystem', () => {
    it('mounts PresenceAvatars in DialogHeader with domain="disbursement" and roomId=id', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-201')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursementDetail }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Verify channel derivation
      expect(channelSpy).toHaveBeenCalledWith('presence:disbursement:disb-201');

      // Emulate reviewer joining
      const channel = supabase.channel('presence:disbursement:disb-201') as unknown as MockRealtimeChannel;
      act(() => {
        channel.setPresenceState({
          'u-admin-1': [{ userId: 'u-admin-1', name: 'Admin User' }],
          'user-reviewer-1': [
            {
              userId: 'user-reviewer-1',
              name: 'Atty. Santos',
              email: 'santos@ata-lta.ph',
              role: 'Partner',
            },
          ],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
        expect(screen.getByTestId('presence-avatar-user-reviewer-1')).toBeInTheDocument();
      });
    });

    it('bypasses presence and renders zero channels when realtime_sync is false', async () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-201')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursementDetail }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(channelSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId('presence-avatars')).not.toBeInTheDocument();
    });

    it('cleanly untracks and removes channel when drawer is closed or unmounted', async () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-201')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursementDetail }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper, queryClient } = createHarness();
      const { unmount } = render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const channel = supabase.channel('presence:disbursement:disb-201') as unknown as MockRealtimeChannel;
      const untrackSpy = vi.spyOn(channel, 'untrack');

      unmount();

      expect(untrackSpy).toHaveBeenCalled();
      expect(removeChannelSpy).toHaveBeenCalledWith(channel);
      queryClient.clear();
    });
  });

  // =========================================================================
  // 2. Strict OCC Mutation Payload Contract
  // =========================================================================
  describe('2. Strict OCC Mutation Payload Contract in Hooks', () => {
    it('useApproveDisbursement passes expectedVersion when strict_occ is enabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'true');

      let capturedBody: unknown = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursementDetail, status: 'Approved', version: 3 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

      // Object argument with expectedVersion
      await result.current.approveDisbursement({ id: 'disb-201', expectedVersion: 2 });
      expect(capturedBody).toEqual({ expectedVersion: 2 });

      // Positional argument with expectedVersion via approveWithBlocking
      await result.current.approveWithBlocking('disb-201', 2);
      expect(capturedBody).toEqual({ expectedVersion: 2 });
    });

    it('useApproveDisbursement unconditionally passes expectedVersion even when strict_occ is disabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'false');

      let capturedBody: unknown = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursementDetail, status: 'Approved', version: 3 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useApproveDisbursement(), { wrapper });

      await result.current.approveDisbursement({ id: 'disb-201', expectedVersion: 2 });
      expect(capturedBody).toEqual({ expectedVersion: 2 });
    });

    it('useRejectDisbursement passes expectedVersion when strict_occ is enabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'true');

      let capturedBody: unknown = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursementDetail, status: 'Rejected', version: 3 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useRejectDisbursement(), { wrapper });

      await result.current.rejectDisbursement({
        id: 'disb-201',
        reason: 'Missing official receipt',
        expectedVersion: 2,
      });

      expect(capturedBody).toEqual({
        reason: 'Missing official receipt',
        expectedVersion: 2,
      });
    });

    it('useRejectDisbursement unconditionally passes expectedVersion even when strict_occ is disabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'false');

      let capturedBody: unknown = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursementDetail, status: 'Rejected', version: 3 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useRejectDisbursement(), { wrapper });

      await result.current.rejectDisbursement({
        id: 'disb-201',
        reason: 'Missing official receipt',
        expectedVersion: 2,
      });

      expect(capturedBody).toEqual({
        reason: 'Missing official receipt',
        expectedVersion: 2,
      });
      expect((capturedBody as { expectedVersion: number }).expectedVersion).toBe(2);
    });

    it('useFundDisbursement passes expectedVersion when strict_occ is enabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'true');

      let capturedBody: unknown = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursementDetail, status: 'Funded', version: 4 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useFundDisbursement(), { wrapper });

      await result.current.fundDisbursement({ id: 'disb-201', expectedVersion: 3 });
      expect(capturedBody).toEqual({ expectedVersion: 3 });

      await result.current.fundWithBlocking('disb-201', 3);
      expect(capturedBody).toEqual({ expectedVersion: 3 });
    });

    it('useReleaseDisbursement passes expectedVersion when strict_occ is enabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'true');

      let capturedBody: unknown = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = opts?.body ? JSON.parse(String(opts.body)) : null;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: { ...mockDisbursementDetail, status: 'Released', version: 4 },
          }),
        } as Response);
      });

      const { wrapper } = createHarness();
      const { result } = renderHook(() => useReleaseDisbursement(), { wrapper });

      await result.current.releaseDisbursement({
        id: 'disb-201',
        expectedVersion: 3,
      });

      expect(capturedBody).toEqual({
        expectedVersion: 3,
      });
    });
  });

  // =========================================================================
  // 3. Concurrency Conflict Interception in DisbursementDetailDrawer
  // =========================================================================
  describe('3. Concurrency Conflict Interception in Drawer', () => {
    it('intercepts HTTP 409 on approve action, closes BlockingActionModal, and mounts ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursementDetail }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-201/approve') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Voucher was modified by another reviewer.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });

      // Click Approve Voucher button
      const approveBtn = screen.getByTestId('drawer-direct-approve-btn');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // Verify BlockingActionModal was dismissed
      expect(useBlockingModalStore.getState().isOpen).toBe(false);

      // Verify conflict modal content
      expect(screen.getByText('Record Out of Sync')).toBeInTheDocument();
      expect(screen.getByTestId('error-code-badge')).toHaveTextContent('ERR_CONCURRENCY_CONFLICT');
    });

    it('intercepts HTTP 409 on archive action, closes BlockingActionModal, and mounts ConflictResolutionModal', async () => {
      const releasedDisb = {
        ...mockDisbursementDetail,
        status: 'Released',
      };

      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: releasedDisb }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-201/archive') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Voucher was modified concurrently by another user.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-archive-btn')).toBeInTheDocument();
      });

      const archiveBtn = screen.getByTestId('drawer-archive-btn');
      fireEvent.click(archiveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      expect(useBlockingModalStore.getState().isOpen).toBe(false);
      expect(screen.getByText('Record Out of Sync')).toBeInTheDocument();
    });

    it('intercepts HTTP 409 on resend draft action from Rejected status', async () => {
      const rejectedDisb = {
        ...mockDisbursementDetail,
        status: 'Rejected',
      };

      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: rejectedDisb }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-201/resend_draft') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Voucher was already updated.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-resend-draft-btn')).toBeInTheDocument();
      });

      const resendBtn = screen.getByTestId('drawer-resend-draft-btn');
      fireEvent.click(resendBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      expect(useBlockingModalStore.getState().isOpen).toBe(false);
    });

    it('intercepts HTTP 409 in RejectReasonModal submission, closes reject modal, and mounts ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursementDetail }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-201/reject') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Voucher was already rejected or modified concurrently.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-reject-btn')).toBeInTheDocument();
      });

      // Open reject reason modal
      const rejectBtn = screen.getByTestId('drawer-reject-btn');
      fireEvent.click(rejectBtn);

      await waitFor(() => {
        expect(screen.getByPlaceholderText('e.g. Ineligible reimbursement item...')).toBeInTheDocument();
      });

      const reasonInput = screen.getByPlaceholderText('e.g. Ineligible reimbursement item...');
      fireEvent.change(reasonInput, { target: { value: 'Ineligible expense claim' } });

      const submitRejectBtn = screen.getByRole('button', { name: 'Reject Voucher' });
      fireEvent.click(submitRejectBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // Reject modal dismissed, blocking modal closed
      expect(screen.queryByPlaceholderText('e.g. Ineligible reimbursement item...')).not.toBeInTheDocument();
      expect(useBlockingModalStore.getState().isOpen).toBe(false);
    });
  });

  // =========================================================================
  // 4. Cache Invalidation on "Refresh & Keep Latest"
  // =========================================================================
  describe('4. Cache Invalidation & Resolution Protocol', () => {
    it('"Refresh & Keep Latest" invalidates disbursementKeys.detail(id) and disbursementKeys.lists()', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursementDetail }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-201/approve') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Concurrent edit detected.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper, queryClient } = createHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });

      const approveBtn = screen.getByTestId('drawer-direct-approve-btn');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // Click "Refresh & Keep Latest"
      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: disbursementKeys.detail('disb-201'),
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: disbursementKeys.lists(),
        });
      });

      // Modal closes
      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });
    });

    it('Cancel button closes ConflictResolutionModal without cache mutation', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockDisbursementDetail }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-201/approve') && method === 'POST') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Concurrent edit detected.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      const { wrapper, queryClient } = createHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });

      const approveBtn = screen.getByTestId('drawer-direct-approve-btn');
      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      const cancelBtn = screen.getByTestId('conflict-cancel-btn');
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });

      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: disbursementKeys.detail('disb-201'),
      });
    });

    it('allows Admin to directly approve Draft voucher to Approved', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-admin-1',
          email: 'admin@ata-lta.ph',
          name: 'Admin User',
          role: 'Admin',
          departments: ['Operations'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['disbursement:view', 'disbursement:approve'],
        activeEntity: 'ATA',
      });

      const draftVoucher = {
        ...mockDisbursementDetail,
        status: 'Draft',
      };

      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/disbursements/disb-201') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: draftVoucher }),
          } as Response);
        }

        if (u.includes('/disbursements/disb-201/approve') && method === 'POST') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: { ...draftVoucher, status: 'Approved' } }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response);
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          id="disb-201"
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('drawer-submit-btn')).not.toBeInTheDocument();

      const directApproveBtn = screen.getByTestId('drawer-direct-approve-btn');
      fireEvent.click(directApproveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/disbursements/disb-201/approve'),
          expect.objectContaining({
            method: 'POST',
          })
        );
      });
    });
  });
});
