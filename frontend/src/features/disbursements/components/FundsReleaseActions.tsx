import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DollarSign, CreditCard, ShieldAlert, AlertCircle } from 'lucide-react';
import { useReleaseDisbursement } from '../api/useDisbursements';
import { FundDisbursementModal } from './FundDisbursementModal';
import { useSessionStore } from '@/lib/session';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Disbursement } from '../api/types';
import { useLiveModalContext } from '../lib/useLiveModalContext';

export interface ReleaseFundsModalProps {
  isOpen: boolean;
  disbursement: Disbursement | null;
  onClose: () => void;
  onSuccess?: () => void;
  onConflict?: (err: unknown) => void;
}

export function ReleaseFundsModal({
  isOpen,
  disbursement,
  onClose,
  onSuccess,
  onConflict,
}: ReleaseFundsModalProps) {
  const { releaseWithBlocking } = useReleaseDisbursement();
  const currentUser = useSessionStore((state) => state.user);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sopVerified, setSopVerified] = useState(false);
  const isSubmittingRef = useRef(false);

  const { captureContext, contextKey } = useLiveModalContext({
    isOpen,
    disbursementId: disbursement?.id,
    version: disbursement?.version,
  });

  useEffect(() => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
    setSopVerified(false);
  }, [contextKey]);

  if (!isOpen || !disbursement) return null;

  const isInvalidLifecycle = disbursement.lifecycle_version !== 2;
  const isMissingVersion = typeof disbursement.version !== 'number' || disbursement.version < 1;

  const isAdmin = currentUser?.role === 'Admin';
  const isClientFund =
    (disbursement.fund_source ||
      disbursement.fundSource ||
      disbursement.source_of_funds ||
      disbursement.sourceOfFunds) === 'Client Fund';
  const linkedInvStatus =
    disbursement.linked_invoice_summary?.status ||
    disbursement.linked_invoice_status ||
    disbursement.linked_invoice?.status ||
    null;
  const isClientFundPaid = linkedInvStatus === 'Paid';
  const requiresSopVerification = isClientFund && !isClientFundPaid;

  const canSubmit =
    !isSubmitting &&
    isAdmin &&
    !isInvalidLifecycle &&
    !isMissingVersion &&
    (!requiresSopVerification || sopVerified);

  const validate = (): boolean => {
    if (isInvalidLifecycle) {
      setError(
        'This saved voucher is view-only. Create a new request to use the current workflow.'
      );
      return false;
    }
    if (isMissingVersion) {
      setError('Voucher version metadata is missing or invalid.');
      return false;
    }
    if (!isAdmin) {
      setError('Only Admin can release a disbursement.');
      return false;
    }
    setError('');
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    if (!validate()) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    const { startId, startVersion, isStale } = captureContext();

    try {
      // In v2, release sends ONLY expectedVersion. Prepared payment details are immutable during sanction.
      await releaseWithBlocking({
        id: startId!,
        expectedVersion: startVersion!,
      });

      if (isStale()) return;

      onClose();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      if (isStale()) return;

      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        onClose();
        if (onConflict) {
          onConflict(err);
          return;
        }
      }
      setError(
        err instanceof Error ? err.message : 'Failed to sanction payment release. Please retry.'
      );
    } finally {
      if (!isStale()) {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const disbNumber =
    disbursement.disbursement_number ||
    disbursement.disbursementNumber ||
    `DISB-${disbursement.id.slice(0, 8)}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="max-w-md p-6 space-y-4" data-testid="release-funds-modal">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-ink flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <span>Sanction Payment Release</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted">
            Confirm and sanction actual payment handover / check release for voucher{' '}
            <span className="tabular-nums font-semibold text-ink">{disbNumber}</span>.
            Sanctioning release records actual execution and handover to the recipient.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3" data-testid="release-funds-form">
          <div className="p-3 bg-canvas border border-border rounded-[6px] text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted">Amount to Release:</span>
              <span className="font-bold text-ink" data-testid="release-amount">
                ₱{disbursement.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Fund Source:</span>
              <span className="font-semibold text-ink">
                {disbursement.fund_source || disbursement.fundSource}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Category:</span>
              <span className="font-medium text-ink">{disbursement.category}</span>
            </div>
          </div>

          {/* Prepared payment instrument details (read-only) */}
          <div className="p-3 bg-primary-light/60 border border-blue-300 rounded-[6px] space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-semibold text-ink">
              <CreditCard className="h-4 w-4 text-primary" />
              <span>Prepared Payment Instrument</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-primary-hover pt-1 border-t border-border">
              <div>
                <span className="text-muted block">Method:</span>
                <span className="font-semibold" data-testid="prep-method">
                  {disbursement.payment_method || disbursement.paymentMethod || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted block">Reference:</span>
                <span className="font-semibold tabular-nums" data-testid="prep-reference">
                  {disbursement.payment_reference || disbursement.paymentReference || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted block">Bank / Source:</span>
                <span className="font-semibold" data-testid="prep-bank">
                  {disbursement.payment_bank || disbursement.paymentBank || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted block">Prepared Date:</span>
                <span className="font-semibold" data-testid="prep-date">
                  {disbursement.payment_date || disbursement.paymentDate || 'N/A'}
                </span>
              </div>
            </div>
            {(disbursement.funded_by_name || disbursement.payment_processed_by_name) && (
              <div className="text-xs text-muted pt-1 border-t border-border">
                <span>
                  Prepared by:{' '}
                  {disbursement.funded_by_name || disbursement.payment_processed_by_name}
                </span>
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-muted pt-1 border-t border-border">
              <ShieldAlert className="h-3 w-3 shrink-0" />
              <span>
                Prepared instrument is locked. Release records actual payment handover without
                replacing details.
              </span>
            </div>
          </div>

          {requiresSopVerification && (
            <div
              className="p-3 bg-warning-surface border border-warning-border rounded-[6px] space-y-2 text-xs text-warning"
              data-testid="sop-client-fund-gate"
            >
              <div className="flex items-center gap-1.5 font-bold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>SOP Step 2.5 — Client Fund Verification Required</span>
              </div>
              <p className="text-xs">
                This Client Fund voucher does not have a Paid/Partially Paid client invoice linked.
              </p>
              <label className="flex items-start gap-2 cursor-pointer font-medium text-ink pt-1">
                <input
                  type="checkbox"
                  checked={sopVerified}
                  onChange={(e) => setSopVerified(e.target.checked)}
                  className="mt-0.5 rounded border-border"
                  data-testid="sop-client-fund-confirm-checkbox"
                />
                <span>
                  I confirm client payment has been verified or an approved standing arrangement
                  applies (SOP Step 2.5 / Section 7.1).
                </span>
              </label>
            </div>
          )}

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
              disabled={isSubmitting}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={!canSubmit}
              data-testid="submit-release-funds-btn"
              className="text-xs font-semibold bg-primary hover:bg-primary-hover text-inverse disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Sanctioning...' : 'Sanction Release'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface FundsReleaseActionsProps {
  disbursement: Disbursement;
  onSuccess?: () => void;
}

export function FundsReleaseActions({ disbursement, onSuccess }: FundsReleaseActionsProps) {
  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = currentUser?.role === 'Admin';
  const isAccounting = Boolean(
    currentUser?.role === 'Accounting' || currentUser?.departments?.includes('Accounting')
  );

  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);

  // Legacy records have no financial actions
  if (disbursement.lifecycle_version === 1) {
    return null;
  }

  const canShowFund = disbursement.status === 'Approved' && (isAdmin || isAccounting);
  const canShowRelease = disbursement.status === 'Funded' && isAdmin;

  if (!canShowFund && !canShowRelease) {
    return null;
  }

  return (
    <div className="flex items-center gap-2" data-testid="funds-release-actions">
      {/* Approved -> Prepare Payment (Accounting or Admin) */}
      {canShowFund && (
        <Button
          type="button"
          size="sm"
          onClick={() => setIsFundModalOpen(true)}
          className="text-xs font-semibold bg-primary hover:bg-primary-hover text-inverse"
          data-testid="action-fund-btn"
        >
          <DollarSign className="h-3.5 w-3.5 mr-1" />
          Prepare Payment
        </Button>
      )}

      {/* Funded -> Sanction Payment Release (Admin only, including the preparer) */}
      {disbursement.status === 'Funded' && isAdmin && (
        <Button
          type="button"
          size="sm"
          title="Sanction payment release"
          onClick={() => setIsReleaseModalOpen(true)}
          className="text-xs font-semibold bg-primary hover:bg-primary-hover text-inverse disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="action-release-btn"
        >
          <DollarSign className="h-3.5 w-3.5 mr-1" />
          Sanction Release
        </Button>
      )}

      {/* Fund Modal */}
      {isFundModalOpen && (
        <FundDisbursementModal
          isOpen={isFundModalOpen}
          disbursement={disbursement}
          onClose={() => setIsFundModalOpen(false)}
          onSuccess={() => {
            setIsFundModalOpen(false);
            if (onSuccess) onSuccess();
          }}
        />
      )}

      {/* Release Modal */}
      {isReleaseModalOpen && (
        <ReleaseFundsModal
          isOpen={isReleaseModalOpen}
          disbursement={disbursement}
          onClose={() => setIsReleaseModalOpen(false)}
          onSuccess={() => {
            setIsReleaseModalOpen(false);
            if (onSuccess) onSuccess();
          }}
        />
      )}
    </div>
  );
}
