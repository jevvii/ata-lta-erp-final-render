import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { DollarSign, AlertCircle } from 'lucide-react';
import { useFundDisbursement } from '../api/useDisbursements';
import { fundDisbursementSchema } from '../api/schemas';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Disbursement } from '../api/types';

import { useLiveModalContext } from '../lib/useLiveModalContext';

function getLocalTodayDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface FundDisbursementModalProps {
  isOpen: boolean;
  disbursement: Disbursement | null;
  onClose: () => void;
  onSuccess?: () => void;
  onConflict?: (err: unknown) => void;
}

export function FundDisbursementModal({
  isOpen,
  disbursement,
  onClose,
  onSuccess,
  onConflict,
}: FundDisbursementModalProps) {
  const { fundWithBlocking, isPending } = useFundDisbursement();

  const [method, setMethod] = useState('Bank Transfer');
  const [bank, setBank] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(() => getLocalTodayDate());
  const [sopVerified, setSopVerified] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);

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
      setMethod(disbursement.payment_method || disbursement.paymentMethod || 'Bank Transfer');
      setBank(disbursement.payment_bank || disbursement.paymentBank || '');
      setReference(disbursement.payment_reference || disbursement.paymentReference || '');
      setDate(disbursement.payment_date || disbursement.paymentDate || getLocalTodayDate());
      setSopVerified(false);
      setErrors({});
    }
  }, [isOpen, disbursement, contextKey]);

  useEffect(() => {
    isSubmittingRef.current = false;
    setIsSubmitting(false);
  }, [contextKey]);

  if (!isOpen || !disbursement) return null;

  const isInvalidLifecycle = disbursement.lifecycle_version !== 2;
  const isMissingVersion = typeof disbursement.version !== 'number' || disbursement.version < 1;
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

  const validate = (): boolean => {
    if (isInvalidLifecycle) {
      setErrors({
        general:
          'This saved voucher is view-only. Create a new request to use the current workflow.',
      });
      return false;
    }
    if (isMissingVersion) {
      setErrors({ general: 'Voucher version metadata is missing or invalid.' });
      return false;
    }

    const payload = {
      method: method.trim(),
      bank: bank.trim(),
      reference: reference.trim(),
      date,
      expectedVersion: disbursement.version,
    };

    const result = fundDisbursementSchema.safeParse(payload);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        const field = issue.path[0];
        if (field) {
          fieldErrors[String(field)] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return false;
    }

    setErrors({});
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
      await fundWithBlocking({
        id: startId!,
        data: {
          method: method.trim(),
          bank: bank.trim(),
          reference: reference.trim(),
          date,
          expectedVersion: startVersion!,
        },
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
      // Handled via BlockingActionModal
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6 space-y-4" data-testid="fund-disbursement-modal">
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-ink flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" />
            <span>Prepare Payment Instrument (Fund Voucher)</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted">
            Record and verify payment details for voucher{' '}
            <span className="tabular-nums font-semibold text-ink">{disbNumber}</span>. This
            transitions the voucher to <strong className="text-success">Funded</strong> status,
            awaiting final Admin release.
          </DialogDescription>
        </DialogHeader>

        {/* Voucher summary */}
        <div className="p-3 bg-canvas border border-border rounded-[6px] text-xs space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-muted">Authorized Amount:</span>
            <span className="font-bold text-ink text-sm" data-testid="fund-amount">
              ₱{disbursement.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted">Fund Source:</span>
            <span className="font-semibold text-primary-hover">
              {disbursement.fund_source || disbursement.fundSource}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted">Category:</span>
            <span className="text-ink">{disbursement.category}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3" data-testid="fund-disbursement-form">
          {/* Payment Method */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink flex items-center gap-1">
              Payment Method <span className="text-danger-solid">*</span>
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="select-fund-method"
            >
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Check">Check</option>
              <option value="Cash">Cash</option>
              <option value="GCash / Maya">GCash / Maya</option>
              <option value="Other">Other</option>
            </select>
            {errors.method && (
              <p
                className="text-xs text-danger-solid flex items-center gap-1"
                data-testid="error-fund-method"
              >
                <AlertCircle className="h-3 w-3" />
                {errors.method}
              </p>
            )}
          </div>

          {/* Bank / Institution / Cash Source */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink flex items-center gap-1">
              {method === 'Cash' ? 'Cash Source / Box' : 'Bank / Institution'}{' '}
              <span className="text-danger-solid">*</span>
            </label>
            <Input
              type="text"
              placeholder={
                method === 'Cash'
                  ? 'e.g. Petty Cash Box A / Office Cash Safe'
                  : 'e.g. BDO Makati, BPI Corporate, Metrobank'
              }
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              data-testid="input-fund-bank"
            />
            {errors.bank && (
              <p
                className="text-xs text-danger-solid flex items-center gap-1"
                data-testid="error-fund-bank"
              >
                <AlertCircle className="h-3 w-3" />
                {errors.bank}
              </p>
            )}
          </div>

          {/* Payment Reference / Check Number */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink flex items-center gap-1">
              {method === 'Cash' ? 'Cash Receipt / Voucher #' : 'Payment Reference / Check #'}{' '}
              <span className="text-danger-solid">*</span>
            </label>
            <Input
              type="text"
              placeholder={
                method === 'Cash'
                  ? 'e.g. PCV-2026-0042 / Cash Slip # 108'
                  : 'e.g. CHK-2026-9021 or Ref # 882910'
              }
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              data-testid="input-fund-reference"
            />
            {errors.reference && (
              <p
                className="text-xs text-danger-solid flex items-center gap-1"
                data-testid="error-fund-reference"
              >
                <AlertCircle className="h-3 w-3" />
                {errors.reference}
              </p>
            )}
          </div>

          {/* Payment Date */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink flex items-center gap-1">
              Payment Preparation Date <span className="text-danger-solid">*</span>
            </label>
            <DateInput
              aria-label="Payment date"
              type="date"
              value={date}
              onValueChange={(value) => setDate(value)}
              data-testid="input-fund-date"
            />
            {errors.date && (
              <p
                className="text-xs text-danger-solid flex items-center gap-1"
                data-testid="error-fund-date"
              >
                <AlertCircle className="h-3 w-3" />
                {errors.date}
              </p>
            )}
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
              disabled={
                isPending ||
                isSubmitting ||
                isInvalidLifecycle ||
                isMissingVersion ||
                (requiresSopVerification && !sopVerified)
              }
              className="text-xs font-semibold bg-primary hover:bg-primary-hover text-inverse disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="btn-confirm-fund"
            >
              {isPending || isSubmitting ? 'Saving...' : 'Confirm Payment Instrument'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
