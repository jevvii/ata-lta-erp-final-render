import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { InvoiceDetailModal } from '../components/InvoiceDetailModal';
import {
  updateInvoiceAction,
  updateClientAddressAction,
} from '../api/useBillingMutations';
import { billingKeys } from '../api/queryKeys';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { queryClient as apiQueryClient } from '@/lib/api';
import type { Invoice } from '../api/types';

function createHarness() {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: apiQueryClient }, children);

  return { queryClient: apiQueryClient, wrapper };
}

const mockInvoiceDetail: Invoice = {
  id: 'inv-detail-101',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  invoice_number: 'ATA-SI-2026-0099',
  client_id: 'c-1',
  issue_date: '2026-10-10',
  due_date: '2026-11-10',
  status: 'Draft',
  subtotal: 50000,
  total: 50000,
  amount_paid: 20000,
  balance: 30000,
  address: '100 Ayala Avenue, Makati City',
  notes: 'Quarterly compliance notes',
  terms: 'Net 30 days',
  version: 3,
  created_at: '2026-10-10T08:00:00Z',
  updated_at: '2026-10-10T08:00:00Z',
  clients: {
    name: 'Acme Philippines Corp',
    tin: '123-456-789-000',
    address: '100 Ayala Avenue, Makati City',
  },
  line_items: [
    {
      id: 'li-1',
      description: 'Tax Planning & Compliance',
      amount: 30000,
      type: 'Professional Fee',
    },
    {
      id: 'li-2',
      description: 'SEC Statutory Filing Fees',
      amount: 20000,
      type: 'Government Fee',
    },
  ],
  payments: [
    {
      id: 'pay-1',
      invoice_id: 'inv-detail-101',
      amount: 20000,
      payment_method: 'Check',
      reference_number: 'CHK-998877',
      payment_date: '2026-10-12',
      notes: 'Initial deposit check',
    },
  ],
};

describe('Billing Presence & Optimistic Concurrency Control (Milestone 4 / Parcel 2B & 2D)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'staff@ata-lta.ph',
        name: 'Staff User',
        role: 'Staff',
        departments: ['Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'billing:view',
        'billing:edit',
        'billing:payments',
        'billing:edit_client_address',
        'billing:delete',
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
  // 1. Ephemeral Presence in InvoiceDetailModal
  // =========================================================================
  describe('1. Invoice Ephemeral Presence Subsystem', () => {
    it('mounts PresenceAvatars in DialogHeader with domain="invoice" and roomId=effectiveId', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      // Verify channel derived with invoice domain
      expect(channelSpy).toHaveBeenCalledWith('presence:invoice:inv-detail-101');

      // Emulate second reviewer presence sync
      const channel = supabase.channel('presence:invoice:inv-detail-101') as unknown as MockRealtimeChannel;
      act(() => {
        channel.setPresenceState({
          'u-admin-1': [{ userId: 'u-admin-1', name: 'Admin User' }],
          'user-colleague-2': [
            {
              userId: 'user-colleague-2',
              name: 'Maria Santos',
              email: 'maria@ata-lta.ph',
              role: 'Billing Specialist',
            },
          ],
        });
        channel.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
        expect(screen.getByTestId('presence-avatar-user-colleague-2')).toBeInTheDocument();
      });
    });

    it('bypasses presence connection and renders zero channels when realtime_sync is false', () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const channelSpy = vi.spyOn(supabase, 'channel');

      const { wrapper } = createHarness();
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      expect(channelSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId('presence-avatars')).not.toBeInTheDocument();
    });

    it('cleanly untracks and removes invoice presence channel upon modal unmount or close', async () => {
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      const { wrapper, queryClient } = createHarness();
      const { unmount } = render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      const channel = supabase.channel('presence:invoice:inv-detail-101') as unknown as MockRealtimeChannel;
      const untrackSpy = vi.spyOn(channel, 'untrack');

      unmount();

      expect(untrackSpy).toHaveBeenCalled();
      expect(removeChannelSpy).toHaveBeenCalledWith(channel);
      queryClient.clear();
    });
  });

  // =========================================================================
  // 2. Strict OCC Mutation Payload Handling
  // =========================================================================
  describe('2. Strict OCC Mutation Payload Contract', () => {
    it('passes expectedVersion in updateInvoiceAction when strict_occ is enabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'true');

      let capturedBody: any = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockInvoiceDetail, version: 4 } }),
        } as Response);
      });

      // Explicit version passed as parameter
      await updateInvoiceAction(
        'inv-detail-101',
        { notes: 'Updated notes' },
        3,
        'ATA'
      );

      expect(capturedBody).toEqual({
        notes: 'Updated notes',
        expectedVersion: 3,
      });

      // Explicit version passed in data object
      await updateInvoiceAction(
        'inv-detail-101',
        { notes: 'Updated notes again', expectedVersion: 3 },
        undefined,
        'ATA'
      );

      expect(capturedBody).toEqual({
        notes: 'Updated notes again',
        expectedVersion: 3,
      });
    });

    it('unconditionally passes expectedVersion in updateInvoiceAction even when strict_occ is disabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'false');

      let capturedBody: any = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockInvoiceDetail, version: 4 } }),
        } as Response);
      });

      await updateInvoiceAction(
        'inv-detail-101',
        { notes: 'Updated notes', expectedVersion: 3 },
        3,
        'ATA'
      );

      expect(capturedBody).toEqual({
        notes: 'Updated notes',
        expectedVersion: 3,
      });
      expect(capturedBody.expectedVersion).toBe(3);
    });

    it('passes expectedVersion in updateClientAddressAction when strict_occ is enabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'true');

      let capturedBody: any = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockInvoiceDetail, version: 4 } }),
        } as Response);
      });

      await updateClientAddressAction(
        'inv-detail-101',
        '200 BGC Taguig City',
        3,
        'ATA'
      );

      expect(capturedBody).toEqual({
        address: '200 BGC Taguig City',
        expectedVersion: 3,
      });
    });

    it('unconditionally passes expectedVersion in updateClientAddressAction even when strict_occ is disabled', async () => {
      localStorage.setItem('erp_feature_override_strict_occ', 'false');

      let capturedBody: any = null;
      global.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
        capturedBody = JSON.parse(String(opts?.body || '{}'));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...mockInvoiceDetail, version: 4 } }),
        } as Response);
      });

      await updateClientAddressAction(
        'inv-detail-101',
        '200 BGC Taguig City',
        3,
        'ATA'
      );

      expect(capturedBody).toEqual({
        address: '200 BGC Taguig City',
        expectedVersion: 3,
      });
      expect(capturedBody.expectedVersion).toBe(3);
    });
  });

  // =========================================================================
  // 3. Concurrency Conflict Interception in InvoiceDetailModal
  // =========================================================================
  describe('3. Concurrency Conflict Interception & Modal Surfacing', () => {
    it('intercepts HTTP 409 on address update, closes BlockingActionModal, and mounts ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-detail-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoiceDetail }),
          } as Response);
        }

        if (u.includes('/invoices/inv-detail-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Invoice was modified by another user. Current server version is 4.',
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
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      // Open address editor
      const editAddressBtn = screen.getByTestId('detail-edit-address-btn');
      fireEvent.click(editAddressBtn);

      const addressInput = screen.getByTestId('detail-address-input');
      fireEvent.change(addressInput, { target: { value: 'New Conflict Address' } });

      const saveAddressBtn = screen.getByTestId('detail-save-address-btn');
      fireEvent.click(saveAddressBtn);

      // Verify BlockingActionModal is closed and ConflictResolutionModal is mounted
      await waitFor(() => {
        expect(useBlockingModalStore.getState().isOpen).toBe(false);
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // Verify conflict modal surfaces invoice title and RFC 7807 error
      expect(screen.getByText('Record Out of Sync')).toBeInTheDocument();
      expect(screen.getByTestId('error-code-badge')).toHaveTextContent('ERR_CONCURRENCY_CONFLICT');
    });

    it('intercepts HTTP 409 on status transition and passes attemptedStatus to ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-detail-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoiceDetail }),
          } as Response);
        }

        if (u.includes('/invoices/inv-detail-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'CONCURRENCY_CONFLICT',
              detail: 'Status conflict: invoice already advanced.',
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
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      // Click submit for approval
      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      expect(useBlockingModalStore.getState().isOpen).toBe(false);
      expect(screen.getByText('Record Out of Sync')).toBeInTheDocument();
    });

    it('intercepts HTTP 409 on notes modification and mounts ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-detail-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoiceDetail }),
          } as Response);
        }

        if (u.includes('/invoices/inv-detail-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Notes update conflict: stale expectedVersion.',
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
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      // Open notes editor
      const editNotesBtn = screen.getByTestId('edit-notes-btn');
      fireEvent.click(editNotesBtn);

      const notesInput = screen.getByPlaceholderText('Notes...');
      fireEvent.change(notesInput, { target: { value: 'Conflicting notes edit' } });

      const saveNotesBtn = screen.getByText('Save');
      fireEvent.click(saveNotesBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });
      expect(useBlockingModalStore.getState().isOpen).toBe(false);
    });
  });

  // =========================================================================
  // 4. Cache Invalidation on "Refresh & Keep Latest"
  // =========================================================================
  describe('4. Cache Invalidation & Resolution Protocol', () => {
    it('"Refresh & Keep Latest" invalidates billingKeys.invoiceDetail and billingKeys.invoices', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-detail-101') && method === 'GET') {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoiceDetail }),
          } as Response);
        }

        if (u.includes('/invoices/inv-detail-101') && method === 'PATCH') {
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
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      // Trigger conflict via submit for approval
      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // Click "Refresh & Keep Latest"
      const refreshBtn = screen.getByTestId('conflict-refresh-btn');
      fireEvent.click(refreshBtn);

      await waitFor(() => {
        // Query keys contract check
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: billingKeys.invoiceDetail('inv-detail-101'),
        });
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: billingKeys.invoices(),
        });
      });

      // Conflict modal closes
      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });
    });

    it('Cancel button closes ConflictResolutionModal without cache mutation', async () => {
      global.fetch = vi.fn().mockImplementation((url: string, opts?: RequestInit) => {
        const u = String(url);
        const method = opts?.method || 'GET';

        if (u.includes('/invoices/inv-detail-101') && method === 'PATCH') {
          return Promise.resolve({
            ok: false,
            status: 409,
            statusText: 'Conflict',
            json: async () => ({
              status: 409,
              code: 'ERR_CONCURRENCY_CONFLICT',
              detail: 'Concurrent modification.',
            }),
          } as Response);
        }

        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockInvoiceDetail }),
        } as Response);
      });

      const { wrapper, queryClient } = createHarness();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
          initialInvoice={mockInvoiceDetail}
        />,
        { wrapper }
      );

      const submitBtn = screen.getByTestId('btn-submit-for-approval');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      const cancelBtn = screen.getByTestId('conflict-cancel-btn');
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('conflict-resolution-modal')).not.toBeInTheDocument();
      });

      // Invalidate should not have been called for invoiceDetail
      expect(invalidateSpy).not.toHaveBeenCalledWith({
        queryKey: billingKeys.invoiceDetail('inv-detail-101'),
      });
    });
  });

  // =========================================================================
  // 5. Hook Order & Asynchronous Data Resolution Regression
  // =========================================================================
  describe('5. Hook Order & Asynchronous Data Resolution Regression', () => {
    it('mounts cleanly without initialInvoice under asynchronous data resolution without hook order violation', async () => {
      const channelSpy = vi.spyOn(supabase, 'channel');
      global.fetch = vi.fn().mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/invoices/inv-detail-101')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: mockInvoiceDetail }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [] }),
        } as Response);
      });

      const { wrapper } = createHarness();

      // Render without initialInvoice - initial render has invoice = undefined (triggers early return)
      // When fetch resolves, subsequent render executes all hooks including conflictModalState
      render(
        <InvoiceDetailModal
          isOpen={true}
          onClose={vi.fn()}
          invoiceId="inv-detail-101"
        />,
        { wrapper }
      );

      // Verify that after asynchronous resolution, the modal renders content cleanly without crashing
      await waitFor(() => {
        expect(screen.getByText('ATA-SI-2026-0099')).toBeInTheDocument();
      });

      // Confirm presence channel registered and client info renders cleanly
      expect(channelSpy).toHaveBeenCalledWith('presence:invoice:inv-detail-101');
      expect(screen.getByTestId('invoice-detail-modal')).toBeInTheDocument();
      expect(screen.getByText('Acme Philippines Corp')).toBeInTheDocument();
    });
  });
});

