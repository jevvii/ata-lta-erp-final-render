import { useState } from 'react';
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
import { useWorkRequestMutations } from '../api/useWorkRequests';
import { operationsKeys } from '../api/queryKeys';
import { useSessionStore } from '@/lib/session';
import type { WorkRequest } from '../api/types';

export type ArchiveActionType = 'archive' | 'cancel' | 'restore';

export interface ArchiveConfirmModalProps {
  isOpen: boolean;
  actionType: ArchiveActionType;
  workRequest: WorkRequest | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ArchiveConfirmModal({
  isOpen,
  actionType,
  workRequest,
  onClose,
  onSuccess,
}: ArchiveConfirmModalProps) {
  const [cancelReason, setCancelReason] = useState('');
  const { archiveWorkRequest, restoreWorkRequest, cancelWorkRequest } =
    useWorkRequestMutations();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  if (!workRequest) return null;

  const titleText =
    actionType === 'archive'
      ? 'Archive Work Request'
      : actionType === 'cancel'
        ? 'Cancel Work Request'
        : 'Restore Work Request';

  const confirmBtnText =
    actionType === 'archive'
      ? 'Archive Work Request'
      : actionType === 'cancel'
        ? 'Cancel Work Request'
        : 'Restore Work Request';

  const confirmBtnVariant =
    actionType === 'restore' ? 'default' : 'destructive';

  const handleConfirm = async () => {
    const id = workRequest.id;

    await runBlockingAction({
      title:
        actionType === 'archive'
          ? 'Archiving Work Request'
          : actionType === 'cancel'
            ? 'Cancelling Work Request'
            : 'Restoring Work Request',
      message: `Please wait while "${workRequest.title}" is being processed...`,
      apiCall: async () => {
        const payload = { id, entity: workRequest.entity };
        if (actionType === 'archive') {
          return await archiveWorkRequest(payload);
        } else if (actionType === 'restore') {
          return await restoreWorkRequest(payload);
        } else {
          return await cancelWorkRequest(payload);
        }
      },
      successTitle:
        actionType === 'archive'
          ? 'Work Request Archived'
          : actionType === 'cancel'
            ? 'Work Request Cancelled'
            : 'Work Request Restored',
      successMessage: `"${workRequest.title}" has been successfully updated.`,
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeEntity),
        operationsKeys.workRequestDetail(id),
        operationsKeys.tasks(id),
      ],
      onSuccess: () => {
        if (onSuccess) onSuccess();
        onClose();
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md p-6 space-y-4 rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float"
        data-testid="archive-confirm-modal"
      >
        <DialogHeader className="border-b border-[#E2E8F0] pb-3">
          <DialogTitle className="text-base font-semibold uppercase tracking-tight text-[#1E293B]">
            {titleText}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569] pt-1">
            {actionType === 'archive' &&
              `Are you sure you want to archive "${workRequest.title}"? It will be moved to the archive tab and hidden from active work queues.`}
            {actionType === 'cancel' &&
              `Are you sure you want to cancel "${workRequest.title}"? Any incomplete tasks will be cancelled.`}
            {actionType === 'restore' &&
              `Are you sure you want to restore "${workRequest.title}"? It will return to active operations tracking.`}
          </DialogDescription>
        </DialogHeader>

        {/* Cancellation Reason input */}
        {actionType === 'cancel' && (
          <div className="space-y-1">
            <label className="text-xs tracking-normal font-bold text-[#1E293B]">
              Reason for Cancellation (optional):
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Scope revised by client, duplicated request..."
              rows={2}
              className="w-full text-xs p-2 border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
              data-testid="cancel-reason-input"
            />
          </div>
        )}

        <DialogFooter className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0]">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={confirmBtnVariant}
            size="sm"
            onClick={handleConfirm}
            data-testid="archive-confirm-btn"
            className={`text-xs  tracking-normal font-bold rounded-[6px] ${
              actionType === 'restore'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs'
                : 'bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] shadow-2xs'
            }`}
          >
            {confirmBtnText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
