/**
 * Action and Confirmation Dialogs for Transmittals
 *
 * Implements:
 * 1. Admin Approve Dialog (POST /:id/approve)
 * 2. Send Dialog (POST /:id/send) with dual-path admin/staff validation
 * 3. Acknowledge Receipt Dialog (POST /:id/acknowledge)
 * 4. Soft Delete Dialog (DELETE /:id)
 * 5. Archive / Unarchive Dialog (POST /:id/archive, POST /:id/unarchive)
 */

import {
  ShieldCheck,
  Send,
  CheckCircle2,
  Trash2,
  Archive,
  ArchiveRestore,
  AlertTriangle,
} from 'lucide-react';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './Tooltip';
import {
  useApproveTransmittal,
  useSendTransmittal,
  useAcknowledgeTransmittal,
  useArchiveTransmittal,
  useUnarchiveTransmittal,
  useDeleteTransmittal,
} from '../api/useTransmittals';
import { useSessionStore } from '@/lib/session';
import type { Transmittal } from '../api/types';

// ============================================================================
// 1. Admin Approve Dialog
// ============================================================================

export interface ApproveDialogProps {
  transmittal: Transmittal | null;
  isOpen: boolean;
  onClose: () => void;
}

export function ApproveDialog({ transmittal, isOpen, onClose }: ApproveDialogProps) {
  const approveMutation = useApproveTransmittal();

  if (!isOpen || !transmittal) return null;

  const handleConfirm = async () => {
    try {
      await approveMutation.mutateAsync(transmittal.id);
      onClose();
    } catch {
      // Handled by BlockingActionModal
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="approve-transmittal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-emerald-800">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Approve Transmittal
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            As an Administrator, approving transmittal{' '}
            <span className="font-mono font-bold text-[#1E293B]">{transmittal.tracking_number}</span>{' '}
            will mark it as approved and transition its status directly to <span className="font-semibold text-[#1E293B]">Sent</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-emerald-50 border-emerald-200 rounded text-xs text-emerald-800">
          Recipient: <span className="font-medium">{transmittal.recipient_name || transmittal.clients?.name}</span>
          <br />
          Line items: <span className="font-medium">{transmittal.items?.length ?? 0} documents</span>
        </div>

        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} data-testid="cancel-approve-btn">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="confirm-approve-btn"
          >
            Confirm Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 2. Send Dialog (Dual-Path)
// ============================================================================

export interface SendDialogProps {
  transmittal: Transmittal | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SendDialog({ transmittal, isOpen, onClose }: SendDialogProps) {
  const sendMutation = useSendTransmittal();
  const user = useSessionStore((state) => state.user);
  const isAdmin = user?.role === 'Admin';

  if (!isOpen || !transmittal) return null;

  const isApproved = transmittal.approved;
  const isSendBlocked = !isAdmin && !isApproved;

  const handleConfirm = async () => {
    if (isSendBlocked) return;
    try {
      await sendMutation.mutateAsync({ id: transmittal.id });
      onClose();
    } catch {
      // Handled by BlockingActionModal
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="send-transmittal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#1E293B]">
            <Send className="h-5 w-5 text-[#1E293B]" />
            Mark Transmittal as Sent
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            Confirm dispatch of transmittal{' '}
            <span className="font-mono font-bold text-[#1E293B]">{transmittal.tracking_number}</span> to{' '}
            <span className="font-semibold text-[#1E293B]">{transmittal.recipient_name || transmittal.clients?.name}</span>.
          </DialogDescription>
        </DialogHeader>

        {isSendBlocked ? (
          <div
            className="p-3 bg-amber-50 border-amber-200 rounded text-xs text-amber-800 flex items-start gap-2"
            data-testid="send-blocked-warning"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Requires Admin approval before sending</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Staff users cannot mark unapproved transmittals as sent. Please request an Administrator to approve this draft first.
              </p>
            </div>
          </div>
        ) : (
          <div className="p-3 bg-[#F8FAFC] border-[#E2E8F0] rounded text-xs text-[#1E293B]">
            {isAdmin && !isApproved ? (
              <p>As Admin, confirming dispatch will automatically grant approval and record transmission.</p>
            ) : (
              <p>This transmittal has been approved by Admin and is ready for courier delivery dispatch.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} data-testid="cancel-send-btn">
            Cancel
          </Button>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    disabled={isSendBlocked}
                    onClick={handleConfirm}
                    className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs disabled:opacity-50"
                    data-testid="confirm-send-btn"
                  >
                    Confirm Dispatch
                  </Button>
                </span>
              </TooltipTrigger>
              {isSendBlocked && (
                <TooltipContent side="top" className="text-xs">
                  Requires Admin approval before sending
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 3. Acknowledge Dialog
// ============================================================================

export interface AcknowledgeDialogProps {
  transmittal: Transmittal | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AcknowledgeDialog({ transmittal, isOpen, onClose }: AcknowledgeDialogProps) {
  const ackMutation = useAcknowledgeTransmittal();

  if (!isOpen || !transmittal) return null;

  const handleConfirm = async () => {
    try {
      await ackMutation.mutateAsync({ id: transmittal.id });
      onClose();
    } catch {
      // Handled by BlockingActionModal
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="acknowledge-transmittal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-emerald-800">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Acknowledge Receipt
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            Confirm that documents for transmittal{' '}
            <span className="font-mono font-bold text-[#1E293B]">{transmittal.tracking_number}</span> were physically received and signed by the recipient.
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-emerald-50 border-emerald-200 rounded text-xs text-emerald-800">
          This will stamp the manifest as <span className="font-semibold">Acknowledged</span> and capture the receipt timestamp.
        </div>

        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} data-testid="cancel-ack-btn">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            data-testid="confirm-ack-btn"
          >
            Confirm Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 4. Delete Dialog
// ============================================================================

export interface DeleteDialogProps {
  transmittalId: string | null;
  trackingNumber?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function DeleteDialog({ transmittalId, trackingNumber, isOpen, onClose }: DeleteDialogProps) {
  const deleteMutation = useDeleteTransmittal();

  if (!isOpen || !transmittalId) return null;

  const handleConfirm = async () => {
    try {
      await deleteMutation.mutateAsync(transmittalId);
      onClose();
    } catch {
      // Handled by BlockingActionModal
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="delete-transmittal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-rose-700">
            <Trash2 className="h-5 w-5 text-rose-600" />
            Delete Transmittal
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            Are you sure you want to soft-delete transmittal{' '}
            <span className="font-mono font-bold text-[#1E293B]">{trackingNumber || transmittalId}</span>?
          </DialogDescription>
        </DialogHeader>

        <div className="p-3 bg-rose-50 border-rose-200 rounded text-xs text-rose-800">
          This transmittal will be removed from active lists and kanban swimlanes.
        </div>

        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} data-testid="cancel-delete-btn">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            className="bg-rose-600 hover:bg-rose-700 text-white"
            data-testid="confirm-delete-btn"
          >
            Delete Transmittal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// 5. Archive / Unarchive Dialog
// ============================================================================

export interface ArchiveDialogProps {
  transmittalId: string | null;
  isArchived: boolean;
  isOpen: boolean;
  onClose: () => void;
}

export function ArchiveDialog({ transmittalId, isArchived, isOpen, onClose }: ArchiveDialogProps) {
  const archiveMutation = useArchiveTransmittal();
  const unarchiveMutation = useUnarchiveTransmittal();

  if (!isOpen || !transmittalId) return null;

  const handleConfirm = async () => {
    try {
      if (isArchived) {
        await unarchiveMutation.mutateAsync(transmittalId);
      } else {
        await archiveMutation.mutateAsync(transmittalId);
      }
      onClose();
    } catch {
      // Handled by BlockingActionModal
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="archive-transmittal-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#1E293B]">
            {isArchived ? (
              <>
                <ArchiveRestore className="h-5 w-5 text-[#1E293B]" />
                Restore Transmittal
              </>
            ) : (
              <>
                <Archive className="h-5 w-5 text-[#475569]" />
                Archive Transmittal
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            {isArchived
              ? 'Restore this transmittal back to the active list.'
              : 'Archive this transmittal. It will be moved to the Archived tab.'}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2">
          <Button size="sm" variant="outline" onClick={onClose} data-testid="cancel-archive-btn">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleConfirm}
            className="bg-slate-800 hover:bg-[#1D4ED8] text-white hover:bg-[#1E40AF] shadow-2xs"
            data-testid="confirm-archive-btn"
          >
            {isArchived ? 'Restore' : 'Archive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
