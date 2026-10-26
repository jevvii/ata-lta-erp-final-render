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
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { useApproveDisbursement } from '../api/useDisbursements';
import { approveDisbursementSchema } from '../api/schemas';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Disbursement } from '../api/types';

import { useLiveModalContext } from '../lib/useLiveModalContext';

export interface AdminApprovalModalProps {
  isOpen: boolean;
  disbursement: Disbursement | null;
  onClose: () => void;
  onSuccess?: () => void;
  onConflict?: (err: unknown) => void;
}

export function AdminApprovalModal({
  isOpen,
  disbursement,
  onClose,
  onSuccess,
  onConflict,
}: AdminApprovalModalProps) {
  const { approveWithBlocking } = useApproveDisbursement();
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

  const { captureContext, contextKey } = useLiveModalContext({
    isOpen,
    disbursementId: disbursement?.id,
    version: disbursement?.version,
  });

  useEffect(() => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }, [contextKey]);

  if (!isOpen || !disbursement) return null;

  const isInvalidLifecycle = disbursement.lifecycle_version !== 2;
  const isMissingVersion = typeof disbursement.version !== 'number' || disbursement.version < 1;
  const isReturnedDraft = disbursement.status === 'Draft' && disbursement.review_ready === false;

  const canSubmit = !isSubmitting && !isInvalidLifecycle && !isMissingVersion && !isReturnedDraft;

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
    if (isReturnedDraft) {
      setError('Voucher is returned awaiting requester correction.');
      return false;
    }

    const result = approveDisbursementSchema.safeParse({
      expectedVersion: disbursement.version,
    });

    if (!result.success) {
      setError(result.error.issues[0]?.message || 'Validation failed');
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
      await approveWithBlocking({
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
      setError(err instanceof Error ? err.message : 'Approval failed. Please retry.');
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
      <DialogContent className="max-w-md p-6 space-y-4" data-testid="admin-approval-modal">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-ink flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <span>Admin Budget Approval</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted">
            Authorize budget for disbursement{' '}
            <span className="tabular-nums font-semibold text-ink">{disbNumber}</span>. Budget
            authorization advances this request to{' '}
            <strong className="text-primary-hover">Approved</strong> status for payment instrument
            preparation by Accounting.
          </DialogDescription>
        </DialogHeader>

        {/* Financial Summary Card */}
        <div className="p-3 bg-canvas border border-border rounded-[6px] text-xs space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="text-muted">Authorized Amount:</span>
            <span className="font-bold text-ink text-sm" data-testid="approval-amount">
              ₱{disbursement.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted">Fund Source:</span>
            <span className="font-semibold text-ink">
              {disbursement.fund_source || disbursement.fundSource}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted">Category:</span>
            <span className="font-medium text-ink">{disbursement.category}</span>
          </div>
          <div className="pt-1 border-t border-border text-muted line-clamp-2">
            <span className="text-muted">Purpose: </span>
            {disbursement.description}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" data-testid="admin-approval-form">
          <div className="p-3 bg-primary-light/80 border border-blue-300 rounded-[6px] text-xs text-primary-hover space-y-1">
            <span className="font-semibold block text-primary-hover">Budget Authorization Notice:</span>
            <p className="text-xs text-primary-hover">
              Authorizing this expense confirms budget availability. In compliance with separation
              of duties, payment instruments are recorded separately during the subsequent Funding
              stage.
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

          {isReturnedDraft && (
            <div
              className="p-2.5 bg-warning-surface border border-warning-border rounded-[6px] text-xs text-warning flex items-center gap-1.5"
              data-testid="returned-draft-warning"
            >
              <AlertCircle className="h-4 w-4 text-warning shrink-0" />
              <span>
                Voucher was returned for correction. Requester must edit and resubmit before budget
                authorization.
              </span>
            </div>
          )}

          <DialogFooter className="pt-2 gap-2 flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isSubmitting}
              onClick={onClose}
              className="text-xs"
              data-testid="btn-cancel-approve"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!canSubmit}
              className="text-xs bg-success hover:bg-success text-inverse font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="btn-confirm-approve"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              {isSubmitting ? 'Authorizing...' : 'Authorize Budget'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
