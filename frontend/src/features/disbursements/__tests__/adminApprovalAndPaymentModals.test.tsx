import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReleaseFundsModal } from '../components/FundsReleaseActions';
import { AdminApprovalModal } from '../components/AdminApprovalModal';
import { EditPaymentDetailsModal } from '../components/EditPaymentDetailsModal';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
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

const mockPendingDisbursement: Disbursement = {
  id: 'disb-app-1',
  disbursement_number: 'DISB-ATA-20261017-001',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Filing Fee',
  description: 'BIR Annual Registration Document Filing',
  amount: 4500,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: 'wr-11111111-1111-1111-1111-111111111111',
  version: 2,
  created_at: '2026-10-17T08:00:00Z',
  updated_at: '2026-10-17T08:00:00Z',
};

const mockReleasedDisbursement: Disbursement = {
  ...mockPendingDisbursement,
  id: 'disb-rel-1',
  status: 'Released',
  version: 3,
  payment_method: 'Bank Transfer',
  payment_reference: 'REF-OLD-999',
  payment_bank: 'BDO',
  payment_date: '2026-10-17',
  receipt_filename: 'official_receipt.pdf',
  receipt_s3_key: 'entities/ATA/disbursements/receipts/opaque-uuid-receipt.pdf',
};

const mockLegacyDisbursement: Disbursement = {
  ...mockPendingDisbursement,
  id: 'disb-leg-1',
  status: 'Released',
  lifecycle_version: 1,
  version: 1,
  payment_method: 'Cash',
  payment_date: '2026-09-01',
  receipt_filename: 'legacy_receipt_scan.pdf',
  receipt_s3_key: null, // Legacy record without storage key
};

describe('Direct Admin Approval & Payment Details Corrections (R3 / D2)', () => {
  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-admin',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
        entities: ['ATA'],
      },
      permissions: ['disbursement:view', 'disbursement:approve', 'disbursement:mark_released'],
      activeEntity: 'ATA',
    });
  });

  it('allows Admin to confirm release of an instrument they prepared without replacing payment details', async () => {
    const funded: Disbursement = { ...mockReleasedDisbursement, status: 'Funded', funded_by: 'user-admin', payment_processed_by: 'user-admin' };
    let sent: unknown;
    global.fetch = vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') sent = JSON.parse(String(options.body));
      return { ok: true, status: 200, json: async () => ({ data: { ...funded, status: 'Released', version: funded.version! + 1, released_by: 'user-admin' } }) };
    });
    const { wrapper } = createHarness();
    const close = vi.fn();
    render(<ReleaseFundsModal isOpen disbursement={funded} onClose={close} />, { wrapper });
    expect(screen.queryByTestId('duty-sep-preparer-modal-warning')).not.toBeInTheDocument();
    const submit = screen.getByTestId('submit-release-funds-btn');
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(sent).toEqual({ expectedVersion: funded.version });
  });

  describe('AdminApprovalModal', () => {
    it('submits atomic budget authorization with expectedVersion without requiring payment fields', async () => {
      let approveBody: Record<string, unknown> | null = null;
      let approveUrl = '';

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'POST' && u.includes('/disbursements/disb-app-1/approve')) {
          approveUrl = u;
          approveBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                ...mockPendingDisbursement,
                status: 'Approved',
                version: 3,
                ...approveBody,
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <AdminApprovalModal
          isOpen={true}
          disbursement={mockPendingDisbursement}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      // V2 initial approval does not collect payment method/bank/date
      expect(screen.queryByTestId('select-payment-method')).not.toBeInTheDocument();

      // Submit
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(approveBody).not.toBeNull();
      });

      expect(approveUrl).toContain('/disbursements/disb-app-1/approve');
      expect(approveBody).toEqual({ expectedVersion: 2 });
      expect(onClose).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });

    it('disables submit when voucher has invalid lifecycle or is returned draft awaiting correction', async () => {
      const { wrapper } = createHarness();
      const returnedDisbursement: Disbursement = {
        ...mockPendingDisbursement,
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: false,
      };

      render(
        <AdminApprovalModal
          isOpen={true}
          disbursement={returnedDisbursement}
          onClose={() => {}}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('btn-confirm-approve')).toBeDisabled();
      expect(screen.getByTestId('returned-draft-warning')).toBeInTheDocument();
    });
  });

  describe('EditPaymentDetailsModal', () => {
    it('corrects payment details on Released/Funded vouchers targeting PATCH /payment-details', async () => {
      let patchedBody: Record<string, unknown> | null = null;
      let patchedUrl = '';

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'PATCH' && u.includes('/disbursements/disb-rel-1/payment-details')) {
          patchedUrl = u;
          patchedBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                ...mockReleasedDisbursement,
                version: 4,
                ...patchedBody,
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      const onSuccess = vi.fn();
      const onClose = vi.fn();

      render(
        <EditPaymentDetailsModal
          isOpen={true}
          disbursement={mockReleasedDisbursement}
          onClose={onClose}
          onSuccess={onSuccess}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('edit-payment-details-modal')).toBeInTheDocument();
      expect(screen.getByTestId('input-edit-payment-reference')).toHaveValue('REF-OLD-999');

      // Change payment method, reference, and bank
      fireEvent.change(screen.getByTestId('select-edit-payment-method'), {
        target: { value: 'Check' },
      });
      fireEvent.change(screen.getByTestId('input-edit-payment-reference'), {
        target: { value: 'CHK-CORRECTED-1002' },
      });
      fireEvent.change(screen.getByTestId('input-edit-payment-bank'), {
        target: { value: 'BPI Ayala' },
      });

      fireEvent.click(screen.getByTestId('btn-save-payment-details'));

      await waitFor(() => {
        expect(patchedBody).not.toBeNull();
      });

      expect(patchedUrl).toContain('/disbursements/disb-rel-1/payment-details');
      expect(patchedBody!.method).toBe('Check');
      expect(patchedBody!.reference).toBe('CHK-CORRECTED-1002');
      expect(patchedBody!.bank).toBe('BPI Ayala');
      expect(patchedBody!.expectedVersion).toBe(3);
      expect(onClose).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('shows an existing saved voucher without Legacy badges, status banners or reconciliation controls', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: mockLegacyDisbursement }) });
    const { wrapper } = createHarness();
    render(<DisbursementDetailDrawer isOpen initialDisbursement={mockLegacyDisbursement} onClose={vi.fn()} />, { wrapper });
    expect(await screen.findByTestId('drawer-amount')).toHaveTextContent('4,500');
    expect(screen.getByTestId('disbursement-status-badge')).toHaveTextContent('Released');
    expect(screen.queryByTestId('legacy-badge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-legacy-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-legacy-review-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('drawer-release-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('drawer-print-btn')).toBeEnabled();
  });

  describe('Authorized Receipt Preview & Legacy Unavailable Notice (R5 / D4)', () => {
    it('renders preview button and opens authorized receipt URL for valid S3 key', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-rel-1/receipt-url')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                url: 'https://storage.test/signed/official_receipt.pdf',
                filename: 'official_receipt.pdf',
                contentType: 'application/pdf',
                expiresAt: '2026-10-18T01:00:00Z',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-rel-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockReleasedDisbursement }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={() => {}}
          initialDisbursement={mockReleasedDisbursement}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('btn-download-receipt')).toBeInTheDocument();
      });

      expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute(
        'href',
        'https://storage.test/signed/official_receipt.pdf'
      );
    });

    it('renders explicit legacy attachment unavailable notice when receipt_s3_key is null', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-leg-1/receipt-url')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                status: 'unavailable',
                filename: 'legacy_receipt_scan.pdf',
                reason: 'legacy_attachment_missing',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-leg-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockLegacyDisbursement }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={() => {}}
          initialDisbursement={mockLegacyDisbursement}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('receipt-legacy-unavailable')).toBeInTheDocument();
      });

      expect(screen.getByTestId('receipt-legacy-unavailable')).toHaveTextContent(
        /Supporting document unavailable/i
      );
    });

    it('renders explicit Refresh Link button next to View/Download and refetches signed URL on click', async () => {
      let callCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-rel-1/receipt-url')) {
          callCount++;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                url: `https://storage.test/signed/official_receipt_${callCount}.pdf`,
                filename: 'official_receipt.pdf',
                contentType: 'application/pdf',
                expiresAt: '2026-10-18T01:05:00Z',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-rel-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockReleasedDisbursement }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={() => {}}
          initialDisbursement={mockReleasedDisbursement}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('btn-download-receipt')).toBeInTheDocument();
        expect(screen.getByTestId('btn-refresh-receipt')).toBeInTheDocument();
      });

      expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute(
        'href',
        'https://storage.test/signed/official_receipt_1.pdf'
      );

      // Click explicit refresh button
      fireEvent.click(screen.getByTestId('btn-refresh-receipt'));

      await waitFor(() => {
        expect(callCount).toBeGreaterThanOrEqual(2);
      });

      await waitFor(() => {
        expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute(
          'href',
          'https://storage.test/signed/official_receipt_2.pdf'
        );
      });
    });

    it('renders error retry UI state with Retry button when receipt URL fails (isError: true)', async () => {
      let shouldFail = true;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-rel-1/receipt-url')) {
          if (shouldFail) {
            return {
              ok: false,
              status: 500,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ error: 'Storage network timeout' }),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                url: 'https://storage.test/signed/recovered_receipt.pdf',
                filename: 'official_receipt.pdf',
                contentType: 'application/pdf',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-rel-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockReleasedDisbursement }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={() => {}}
          initialDisbursement={mockReleasedDisbursement}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('receipt-error-state')).toBeInTheDocument();
        expect(screen.getByTestId('btn-retry-receipt')).toBeInTheDocument();
      }, { timeout: 4000 });

      expect(screen.queryByTestId('btn-download-receipt')).not.toBeInTheDocument();

      // Clear failure and click retry
      shouldFail = false;
      fireEvent.click(screen.getByTestId('btn-retry-receipt'));

      await waitFor(() => {
        expect(screen.getByTestId('btn-download-receipt')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('receipt-error-state')).not.toBeInTheDocument();
    });

    it('handles image onError fallback and renders Refresh Image Preview button', async () => {
      let refreshCalled = false;
      const imageDisbursement: Disbursement = {
        ...mockReleasedDisbursement,
        receipt_filename: 'official_receipt.png',
      };

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-rel-1/receipt-url')) {
          if (refreshCalled) {
            return {
              ok: true,
              status: 200,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({
                data: {
                  url: 'https://storage.test/signed/refreshed_image.png',
                  filename: 'official_receipt.png',
                  contentType: 'image/png',
                },
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                url: 'https://storage.test/signed/expired_image.png',
                filename: 'official_receipt.png',
                contentType: 'image/png',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-rel-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: imageDisbursement }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={() => {}}
          initialDisbursement={imageDisbursement}
        />,
        { wrapper }
      );

      await waitFor(() => expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('btn-open-modal-receipt'));
      await waitFor(() => {
        expect(screen.getByTestId('doc-preview-image')).toBeInTheDocument();
      });

      // Simulate expired image failing to load
      fireEvent.error(screen.getByTestId('doc-preview-image'));

      await waitFor(() => {
        expect(screen.getByTestId('attachment-preview-error')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry preview' })).toBeInTheDocument();
      });

      expect(screen.queryByTestId('doc-preview-image')).not.toBeInTheDocument();

      // Click refresh image preview
      refreshCalled = true;
      fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));

      await waitFor(() => {
        expect(screen.getByTestId('doc-preview-image')).toBeInTheDocument();
      });
      expect(screen.getByTestId('doc-preview-image')).toHaveAttribute(
        'src',
        'https://storage.test/signed/refreshed_image.png'
      );
    });

    it('routes drawer direct approve button to AdminApprovalModal confirming expectedVersion', async () => {
      let approveBody: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (init?.method === 'POST' && u.includes('/disbursements/disb-app-1/approve')) {
          approveBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                ...mockPendingDisbursement,
                status: 'Approved',
                version: 3,
                ...approveBody,
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-app-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockPendingDisbursement }),
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: [] }),
        };
      });

      const { wrapper } = createHarness();
      render(
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={() => {}}
          initialDisbursement={mockPendingDisbursement}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('drawer-direct-approve-btn')).toBeInTheDocument();
      });

      // Clicking approve button in drawer must NOT directly send POST /approve without confirmation;
      // It must open AdminApprovalModal
      fireEvent.click(screen.getByTestId('drawer-direct-approve-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });

      expect(approveBody).toBeNull(); // No request sent yet!

      // Confirm in modal
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(approveBody).not.toBeNull();
      });

      expect(approveBody).toEqual({ expectedVersion: 2 });
    });
  });
});
