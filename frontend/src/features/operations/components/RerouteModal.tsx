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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import type { Phase } from '../api/types';
import { useQaReview } from '../api/useQaReview';
import { runBlockingAction } from './BlockingActionModal';
import { operationsKeys } from '../api/queryKeys';

export interface RerouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  workRequestId: string;
  failedTasks: Array<{ id: string; title: string; phase?: Phase | null }>;
  onSuccess?: () => void;
}

export function RerouteModal({
  isOpen,
  onClose,
  workRequestId,
  failedTasks,
  onSuccess,
}: RerouteModalProps) {
  const [toPhase, setToPhase] = useState<'pre_processing' | 'processing'>('processing');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canRerouteToProcessing =
    failedTasks.length > 0 &&
    failedTasks.every((t) => t.phase === 'processing');

  const effectivePhase: 'pre_processing' | 'processing' =
    !canRerouteToProcessing ? 'pre_processing' : toPhase;

  const { submitReroute } = useQaReview(workRequestId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('A non-empty reroute reason is required for audit compliance.');
      return;
    }
    setError(null);

    const targetPhase = effectivePhase;

    await runBlockingAction({
      title: 'Rerouting Work Request',
      message: `Rerouting to ${targetPhase === 'pre_processing' ? 'Pre-processing' : 'Processing'} and reopening failed tasks...`,
      apiCall: async () => {
        return await submitReroute({
          workRequestId,
          to_phase: targetPhase,
          reason: trimmed,
        });
      },
      successTitle: 'Work Request Rerouted',
      successMessage: `Successfully rerouted work request back to ${targetPhase.replace('_', ' ')}.`,
      invalidateQueries: [
        operationsKeys.workRequestDetail(workRequestId),
        operationsKeys.tasks(workRequestId),
        operationsKeys.workRequests(),
      ],
      onSuccess: () => {
        setReason('');
        setError(null);
        if (onSuccess) onSuccess();
        onClose();
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6 space-y-4 rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float" data-testid="reroute-modal">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-[#1E293B]">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold tracking-tight text-[#1E293B]">
                Reroute Work Request
              </DialogTitle>
              <DialogDescription className="text-xs text-[#475569] pt-0.5">
                Return this engagement from QA back to an earlier phase. Only tasks marked as failed will be reopened.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Target Phase Selection */}
          <div className="space-y-1.5">
            <label className="text-xs tracking-normal text-[#475569]">
              Return to Phase *
            </label>
            <Select
              value={effectivePhase}
              onValueChange={(val) => setToPhase(val as 'pre_processing' | 'processing')}
            >
              <SelectTrigger className="w-full h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B]" data-testid="reroute-to-phase-select">
                <SelectValue placeholder="Select target phase" />
              </SelectTrigger>
              <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                <SelectItem
                  value="processing"
                  disabled={!canRerouteToProcessing}
                  className="text-xs"
                  data-testid="reroute-option-processing"
                >
                  Processing (Phase 2)
                </SelectItem>
                <SelectItem
                  value="pre_processing"
                  className="text-xs"
                  data-testid="reroute-option-pre-processing"
                >
                  Pre-processing (Phase 1)
                </SelectItem>
              </SelectContent>
            </Select>
            {!canRerouteToProcessing && (
              <p
                className="text-xs text-[#475569] flex items-center gap-1.5 pt-1"
                data-testid="reroute-processing-disabled-explanation"
                role="status"
              >
                <AlertCircle className="h-3.5 w-3.5 text-[#EAB308] shrink-0" />
                <span>
                  {failedTasks.length === 0
                    ? 'Mark failed tasks in QA before rerouting to Processing.'
                    : 'Processing is available only when every failed task belongs to Processing. Reroute to Pre-processing to address these failures.'}
                </span>
              </p>
            )}
          </div>

          {/* Reopened Tasks Summary */}
          <div className="space-y-1.5 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] p-3">
            <div className="flex items-center justify-between text-xs tabular-nums font-medium text-[#1E293B]">
              <span className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-[#1E293B]" />
                Tasks to be Reopened ({failedTasks.length})
              </span>
              {failedTasks.length > 0 && (
                <Badge variant="destructive" size="compact" className="rounded-[6px] text-xs" data-testid="reroute-failed-badge">
                  {failedTasks.length} Failed
                </Badge>
              )}
            </div>

            {failedTasks.length === 0 ? (
              <p className="text-xs text-[#475569] italic pt-1">
                No tasks currently marked failed. (Mark failing tasks with QA controls before rerouting).
              </p>
            ) : (
              <ul className="space-y-1 pt-1 max-h-32 overflow-y-auto" data-testid="reroute-reopened-tasks-list">
                {failedTasks.map((t) => (
                  <li
                    key={t.id}
                    className="text-xs text-[#1E293B] flex items-center justify-between py-1 border-b border-[#E2E8F0] last:border-none"
                  >
                    <span className="truncate pr-2">{t.title}</span>
                    <Badge variant="destructive" size="compact" className="rounded-[6px] text-xs">
                      Reopen
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Audit Reason Textarea */}
          <div className="space-y-1.5">
            <label className="text-xs tracking-normal text-[#475569] flex items-center justify-between">
              <span>Audit Rationale (Required) *</span>
              <span className="text-xs text-[#475569] normal-case">
                Dispatched to task assignees
              </span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Detail the QA compliance failure or required corrections..."
              rows={3}
              className={`w-full text-xs  p-2.5 border rounded-[6px] bg-[#FFFFFF] text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 ${
                error
                  ? 'border-[#FCA5A5] focus:ring-[#DC2626]'
                  : 'border-[#E2E8F0] focus:ring-[#1D4ED8]'
              }`}
              data-testid="reroute-reason-input"
            />
            {error && (
              <p className="text-xs text-[#DC2626] flex items-center gap-1" data-testid="reroute-reason-error">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>

          <DialogFooter className="pt-2 flex items-center justify-end gap-2">
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
              className="rounded-[6px] bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] shadow-2xs text-xs tracking-normal gap-1.5"
              data-testid="confirm-reroute-btn"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Confirm & Reroute
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
