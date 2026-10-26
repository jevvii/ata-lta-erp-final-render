import React, { useState, useEffect } from 'react';
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
import { Pencil, DollarSign } from 'lucide-react';
import { useUpdatePaymentDetails } from '../api/useDisbursements';
import { updatePaymentDetailsSchema } from '../api/schemas';
import type { Disbursement } from '../api/types';

export interface EditPaymentDetailsModalProps {
  isOpen: boolean;
  disbursement: Disbursement | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function EditPaymentDetailsModal({
  isOpen,
  disbursement,
  onClose,
  onSuccess,
}: EditPaymentDetailsModalProps) {
  const { updatePaymentDetailsWithBlocking } = useUpdatePaymentDetails();

  const [method, setMethod] = useState('Bank Transfer');
  const [reference, setReference] = useState('');
  const [bank, setBank] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0] ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen && disbursement) {
      setMethod(
        disbursement.payment_method ||
        disbursement.paymentMethod ||
        'Bank Transfer'
      );
      setReference(
        disbursement.payment_reference ||
        disbursement.paymentReference ||
        ''
      );
      setBank(
        disbursement.payment_bank ||
        disbursement.paymentBank ||
        ''
      );
      setDate(
        disbursement.payment_date ||
        disbursement.paymentDate ||
        (new Date().toISOString().split('T')[0] as string)
      );
      setErrors({});
    }
  }, [isOpen, disbursement]);

  if (!isOpen || !disbursement) return null;

  const validate = (): boolean => {
    const payload = {
      method: method.trim(),
      reference: reference.trim() || null,
      bank: bank.trim() || null,
      date,
      expectedVersion: disbursement.version ?? 1,
    };

    const result = updatePaymentDetailsSchema.safeParse(payload);
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
    if (!validate()) return;

    try {
      await updatePaymentDetailsWithBlocking({
        id: disbursement.id,
        data: {
          method: method.trim(),
          reference: reference.trim() || null,
          bank: bank.trim() || null,
          date,
          expectedVersion: disbursement.version,
        },
      });
      onClose();
      if (onSuccess) onSuccess();
    } catch {
      // Errors handled via BlockingActionModal / OCC modal
    }
  };

  const disbNumber =
    disbursement.disbursement_number ||
    disbursement.disbursementNumber ||
    `DISB-${disbursement.id.slice(0, 8)}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="space-y-4 border-border border p-6 shadow-float rounded-[12px] bg-surface max-w-md"
        data-testid="edit-payment-details-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-ink flex items-center gap-2">
            <Pencil className="h-4 w-4 text-primary" />
            <span>Correct Payment Details</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted">
            Update release payment information for voucher{' '}
            <span className="font-semibold text-ink">
              {disbNumber}
            </span>
            . Lifecycle status, authorization timestamps, and audit history remain unchanged.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3" data-testid="edit-payment-details-form">
          {/* Payment Method */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">
              Payment Method <span className="text-danger-solid">*</span>
            </label>
            <select
              value={method}
              onChange={(e) => {
                setMethod(e.target.value);
                if (errors.method) setErrors((prev) => ({ ...prev, method: '' }));
              }}
              className={`w-full text-xs p-2 border rounded-[6px] bg-surface border-border focus:outline-none focus:ring-1 focus:ring-primary ${
                errors.method ? 'border-danger-solid' : ''
              }`}
              data-testid="select-edit-payment-method"
            >
              <option value="Bank Transfer">Bank Transfer</option>
              <option value="Check">Check</option>
              <option value="Cash">Cash</option>
              <option value="GCash / Maya">GCash / Maya</option>
              <option value="Other">Other</option>
            </select>
            {errors.method && (
              <span className="text-xs text-danger-solid block">{errors.method}</span>
            )}
          </div>

          {/* Reference */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">
              Payment Reference / Check Number (Optional)
            </label>
            <Input
              type="text"
              placeholder="e.g. CHK-00129 or TXN-99812"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="text-xs h-8"
              data-testid="input-edit-payment-reference"
            />
          </div>

          {/* Bank */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">
              Bank / Institution (Optional)
            </label>
            <Input
              type="text"
              placeholder="e.g. Metrobank, BDO, BPI"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
              className="text-xs h-8"
              data-testid="input-edit-payment-bank"
            />
          </div>

          {/* Date */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">
              Payment Date <span className="text-danger-solid">*</span>
            </label>
            <DateInput
              aria-label="Payment date"
              type="date"
              value={date}
              onValueChange={(val) => {
                setDate(val);
                if (errors.date) setErrors((prev) => ({ ...prev, date: '' }));
              }}
              className="text-xs h-8"
              data-testid="input-edit-payment-date"
            />
            {errors.date && (
              <span className="text-xs text-danger-solid block">{errors.date}</span>
            )}
          </div>

          <DialogFooter className="pt-2 gap-2 flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
              data-testid="btn-cancel-payment-details"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="text-xs bg-primary hover:bg-primary-hover text-inverse font-medium"
              data-testid="btn-save-payment-details"
            >
              <DollarSign className="h-3.5 w-3.5 mr-1" />
              Save Payment Details
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
