import { useState, useEffect, useMemo, useRef } from 'react';
import { Link2, Plus, AlertCircle, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { useUpdateDisbursement } from '../api/useDisbursements';
import { disbursementKeys } from '../api/queryKeys';
import { useLiveModalContext } from '../lib/useLiveModalContext';
import { useInvoices } from '@/features/billing/api/useInvoices';
import { useTransmittals } from '@/features/transmittals/api/useTransmittals';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Disbursement } from '../api/types';
import type { ApiError } from '@/lib/api';

export interface LinkBillingTransmittalModalProps {
  isOpen: boolean;
  disbursement: Disbursement | null;
  onClose: () => void;
  onOpenCreateBilling?: () => void;
  onConflict?: (err: unknown) => void;
}

export function LinkBillingTransmittalModal({
  isOpen,
  disbursement,
  onClose,
  onOpenCreateBilling,
  onConflict,
}: LinkBillingTransmittalModalProps) {
  const queryClient = useQueryClient();
  const { updateWithBlocking, isPending } = useUpdateDisbursement();

  const [linkedInvoiceId, setLinkedInvoiceId] = useState('');
  const [linkedTransmittalId, setLinkedTransmittalId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [conflictModalState, setConflictModalState] = useState<{
    isOpen: boolean;
    error?: unknown;
  }>({ isOpen: false });

  const { captureContext, contextKey } = useLiveModalContext({
    isOpen,
    disbursementId: disbursement?.id,
    version: disbursement?.version,
  });

  const initializedContext = useRef<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      initializedContext.current = null;
      return;
    }
    if (initializedContext.current === contextKey) return;
    initializedContext.current = contextKey;
    if (isOpen && disbursement) {
      setLinkedInvoiceId(
        disbursement.linked_invoice_id ||
          disbursement.linkedInvoiceId ||
          disbursement.linked_invoice_summary?.id ||
          ''
      );
      setLinkedTransmittalId(
        disbursement.linked_transmittal_id ||
          disbursement.linkedTransmittalId ||
          disbursement.linked_transmittal_summary?.id ||
          ''
      );
      setError(null);
    }
  }, [isOpen, disbursement, contextKey]);

  useEffect(() => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }, [contextKey]);

  const workRequestId =
    disbursement?.linked_work_request_id ||
    disbursement?.linkedWorkRequestId ||
    disbursement?.work_request_id ||
    disbursement?.workRequestId ||
    '';

  const { data: wrInvoicesData } = useInvoices(
    { workRequestId: workRequestId || undefined, archived: false, limit: 100 },
    { enabled: isOpen && Boolean(workRequestId) }
  );
  const availableInvoices = useMemo(() => {
    if (!workRequestId) return [];
    const list = Array.isArray(wrInvoicesData?.data) ? wrInvoicesData.data : [];
    return list.filter(
      (inv) =>
        !inv.archived &&
        inv.status !== 'Cancelled' &&
        (!inv.work_request_id || inv.work_request_id === workRequestId)
    );
  }, [wrInvoicesData, workRequestId]);

  const { data: wrTransmittalsData } = useTransmittals(
    { workRequestId: workRequestId || undefined, archived: false, limit: 100 },
    { enabled: isOpen && Boolean(workRequestId) }
  );
  const availableTransmittals = useMemo(() => {
    if (!workRequestId) return [];
    const list = Array.isArray(wrTransmittalsData?.data) ? wrTransmittalsData.data : [];
    return list.filter(
      (tr) =>
        !tr.archived &&
        tr.status !== 'Cancelled' &&
        (!(tr.work_request_id || tr.workRequestId) ||
          (tr.work_request_id || tr.workRequestId) === workRequestId)
    );
  }, [wrTransmittalsData, workRequestId]);

  if ((!isOpen && !conflictModalState.isOpen) || !disbursement) return null;

  const disbNumber =
    disbursement.disbursement_number ||
    disbursement.disbursementNumber ||
    `DISB-${disbursement.id.slice(0, 8)}`;

  const fundSource =
    disbursement.fund_source ||
    disbursement.fundSource ||
    disbursement.source_of_funds ||
    disbursement.sourceOfFunds ||
    'Firm Fund';

  const isInvalidLifecycle = disbursement.lifecycle_version !== 2;
  const isMissingVersion = typeof disbursement.version !== 'number' || disbursement.version < 1;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;

    if (isInvalidLifecycle) {
      setError('This saved voucher is view-only. Create a new request to use the current workflow.');
      return;
    }
    if (isMissingVersion) {
      setError('Voucher version metadata is missing or invalid.');
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);

    const { startId, startVersion, isStale } = captureContext();

    try {
      await updateWithBlocking({
        id: startId!,
        data: {
          linkedInvoiceId: linkedInvoiceId ? linkedInvoiceId : null,
          linkedTransmittalId: linkedTransmittalId ? linkedTransmittalId : null,
          expectedVersion: startVersion!,
        },
      });

      if (isStale()) return;

      await queryClient.invalidateQueries({
        queryKey: disbursementKeys.detail(startId!),
      });
      await queryClient.invalidateQueries({
        queryKey: disbursementKeys.lists(),
      });

      onClose();
    } catch (err: unknown) {
      if (isStale()) return;

      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        if (onConflict) {
          onClose();
          onConflict(err);
          return;
        }
        setConflictModalState({
          isOpen: true,
          error: err,
        });
        return;
      }
      setError(
        err instanceof Error ? err.message : 'Failed to update linked billing & transmittal.'
      );
    } finally {
      if (!isStale()) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
        <DialogContent
          className="max-w-md p-6 space-y-4"
          data-testid="link-billing-transmittal-modal"
        >
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ink flex items-center gap-2">
              <Link2 className="h-5 w-5 text-primary" />
              <span>Link Billing &amp; Transmittal</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted">
              Attach or update the linked Billing Invoice and Document Transmittal for voucher{' '}
              <span className="font-mono font-semibold text-ink">{disbNumber}</span>.
            </DialogDescription>
          </DialogHeader>

          {/* Voucher Summary */}
          <div className="p-3 bg-canvas border border-border rounded-[6px] text-xs space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-muted">Voucher Amount:</span>
              <span className="font-bold text-ink font-mono tabular-nums">
                ₱{disbursement.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Fund Source:</span>
              <span className="font-semibold text-ink">{fundSource}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted">Category:</span>
              <span className="text-ink">{disbursement.category}</span>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="space-y-4"
            data-testid="link-billing-transmittal-form"
          >
            {/* Linked Billing (Invoice) Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="modal-link-invoice-select"
                  className="text-xs font-semibold text-ink flex items-center gap-1"
                >
                  <FileText className="h-3.5 w-3.5 text-muted" />
                  <span>Linked Billing (Invoice)</span>
                </label>

                {!linkedInvoiceId && onOpenCreateBilling && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onClose();
                      onOpenCreateBilling();
                    }}
                    className="h-6 px-2 text-xs font-semibold text-primary hover:bg-hover gap-1 cursor-pointer"
                    data-testid="modal-create-billing-shortcut-btn"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Create New Billing for this Voucher</span>
                  </Button>
                )}
              </div>

              <select
                id="modal-link-invoice-select"
                value={linkedInvoiceId}
                onChange={(e) => setLinkedInvoiceId(e.target.value)}
                disabled={!workRequestId || isPending || isSubmitting}
                className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                data-testid="modal-select-linked-invoice"
              >
                <option value="">None (Unlinked)</option>
                {availableInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoice_number} — {inv.status} — ₱
                    {Number(inv.total ?? 0).toLocaleString('en-PH', {
                      minimumFractionDigits: 2,
                    })}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted">
                Linking a client invoice enables SOP Step 2.5 Client Fund payment verification and
                reimbursable expense tracking.
              </p>
            </div>

            {/* Linked Transmittal Selector */}
            <div className="space-y-1.5">
              <label
                htmlFor="modal-link-transmittal-select"
                className="text-xs font-semibold text-ink flex items-center gap-1"
              >
                <FileText className="h-3.5 w-3.5 text-muted" />
                <span>Linked Transmittal</span>
              </label>
              <select
                id="modal-link-transmittal-select"
                value={linkedTransmittalId}
                onChange={(e) => setLinkedTransmittalId(e.target.value)}
                disabled={!workRequestId || isPending || isSubmitting}
                className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
                data-testid="modal-select-linked-transmittal"
              >
                <option value="">None (Unlinked)</option>
                {availableTransmittals.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.tracking_number} — {tr.status}
                    {tr.recipient_name || tr.recipientName
                      ? ` — ${tr.recipient_name || tr.recipientName}`
                      : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted">
                Linking a transmittal associates Official Receipt handover or courier delivery with
                this voucher (SOP Step 2.7).
              </p>
            </div>

            {error && (
              <div
                className="p-2.5 bg-danger-surface border border-danger-border rounded-[6px] text-xs text-danger flex items-center gap-1.5"
                role="alert"
              >
                <AlertCircle className="h-4 w-4 text-danger-solid shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <DialogFooter className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={isPending || isSubmitting}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={isPending || isSubmitting || isInvalidLifecycle || isMissingVersion}
                className="text-xs font-semibold bg-primary hover:bg-primary-hover text-inverse disabled:opacity-50 disabled:cursor-not-allowed"
                data-testid="submit-link-billing-transmittal-btn"
              >
                {isPending || isSubmitting ? 'Saving...' : 'Save Links'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConflictResolutionModal
        isOpen={conflictModalState.isOpen}
        onClose={() => {
          setConflictModalState({ isOpen: false });
          onClose();
        }}
        error={conflictModalState.error as ApiError | Error | null}
        entityTitle={disbNumber}
        entityType="Disbursement"
        expectedVersion={disbursement.version}
        attemptedStatus={disbursement.status}
        currentStatus={disbursement.status}
        onRefreshAndKeepLatest={async () => {
          await queryClient.invalidateQueries({
            queryKey: disbursementKeys.detail(disbursement.id),
          });
          await queryClient.invalidateQueries({
            queryKey: disbursementKeys.lists(),
          });
        }}
      />
    </>
  );
}
