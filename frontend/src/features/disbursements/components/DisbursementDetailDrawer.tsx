import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { DisbursementDetailBody } from './DisbursementDetailBody';
import type { Disbursement } from '../api/types';

export interface DisbursementDetailDrawerProps {
  id?: string | null;
  initialDisbursement?: Disbursement | null;
  isOpen: boolean;
  onClose: () => void;
}

export function DisbursementDetailDrawer({
  id,
  initialDisbursement,
  isOpen,
  onClose,
}: DisbursementDetailDrawerProps) {
  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="h-full sm:h-auto max-h-[100dvh] sm:max-h-[90vh] w-full max-w-full sm:max-w-2xl border-border overflow-y-auto overscroll-contain border p-4 sm:p-6 shadow-float rounded-none sm:rounded-[12px] bg-surface top-0 left-0 translate-x-0 translate-y-0 sm:top-[50%] sm:left-[50%] sm:translate-x-[-50%] sm:translate-y-[-50%] space-y-4"
        data-testid="disbursement-detail-drawer"
      >
        <DialogTitle className="sr-only">Disbursement Details</DialogTitle>
        <DialogDescription className="sr-only">Disbursement voucher detail sheet</DialogDescription>
        <DisbursementDetailBody
          id={id}
          initialDisbursement={initialDisbursement}
          isOpen={isOpen}
          onClose={onClose}
          isDocked={false}
          isMobileSheet={true}
        />
      </DialogContent>
    </Dialog>
  );
}
