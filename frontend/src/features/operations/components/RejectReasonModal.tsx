import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { runBlockingAction } from './BlockingActionModal';
import { usePhaseTransitions } from '../api/usePhaseTransitions';
import { operationsKeys } from '../api/queryKeys';
import { useSessionStore } from '@/lib/session';

export interface RejectReasonModalProps {
  isOpen: boolean;
  requestId: string;
  workRequestTitle?: string;
  onClose: () => void;
  onSuccess?: () => void;
  title?: string;
  description?: string;
  placeholder?: string;
  submitLabel?: string;
  maxLength?: number;
  onReject?: (requestId: string, reason: string) => Promise<unknown>;
  invalidateQueries?: Array<readonly unknown[]>;
  successTitle?: string;
  successMessage?: string;
}

export function RejectReasonModal({
  isOpen,
  requestId,
  workRequestTitle,
  onClose,
  onSuccess,
  title,
  description,
  placeholder,
  submitLabel,
  maxLength = 2000,
  onReject,
  invalidateQueries,
  successTitle,
  successMessage,
}: RejectReasonModalProps) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { rejectRequest } = usePhaseTransitions();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();

    if (!trimmed || trimmed.length < 1) {
      setError('Rejection reason is required (minimum 1 character)');
      return;
    }
    if (trimmed.length > maxLength) {
      setError(`Rejection reason cannot exceed ${maxLength} characters`);
      return;
    }
    setError(null);

    if (onReject) {
      await runBlockingAction({
        title: title || 'Rejecting Disbursement',
        message: 'Please wait while the rejection is processed...',
        apiCall: async () => {
          return await onReject(requestId, trimmed);
        },
        successTitle: successTitle || 'Disbursement Rejected',
        successMessage:
          successMessage || 'The disbursement has been rejected and the submitter notified.',
        invalidateQueries: invalidateQueries || [],
        onSuccess: () => {
          setReason('');
          if (onSuccess) onSuccess();
          onClose();
        },
      });
      return;
    }

    await runBlockingAction({
      title: 'Rejecting Phase Transition',
      message: 'Please wait while the transition request rejection is processed...',
      apiCall: async () => {
        return await rejectRequest(requestId, trimmed);
      },
      successTitle: 'Transition Request Rejected',
      successMessage: 'The request has been rejected and the submitter notified.',
      invalidateQueries: [
        operationsKeys.requests(),
        operationsKeys.requestCounts(activeEntity),
      ],
      onSuccess: () => {
        setReason('');
        if (onSuccess) onSuccess();
        onClose();
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md p-6 space-y-4 rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float"
        data-testid="reject-reason-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight text-[#1E293B]">
            {title || 'Reject Phase Transition'}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569] pt-1">
            {description ||
              (workRequestTitle
                ? `Provide a specific, actionable reason for rejecting the transition for "${workRequestTitle}".`
                : 'Provide a specific reason for rejecting this transition request.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs tracking-normal text-[#475569] block">
              Rejection Reason <span className="text-[#DC2626]">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              rows={4}
              placeholder={placeholder || 'e.g. Pre-processing checklist item #3 missing BIR stamp...'}
              className={`w-full text-xs  p-2.5 border rounded-[6px] bg-[#FFFFFF] text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] ${
                error ? 'border-[#FCA5A5]' : 'border-[#E2E8F0]'
              }`}
              data-testid="reject-reason-textarea"
            />
            {error && (
              <span
                className="text-xs text-[#DC2626] block"
                data-testid="reject-reason-error"
              >
                {error}
              </span>
            )}
            <div className="text-xs text-[#475569] text-right">
              {reason.trim().length} / {maxLength} characters
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="rounded-[8px] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] text-xs tracking-normal"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              data-testid="reject-reason-submit-btn"
              className="rounded-[6px] bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] shadow-2xs text-xs tracking-normal"
            >
              {submitLabel || 'Reject Transition'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
