import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
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
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useUserMutations } from '../api/useUsers';
import { adminKeys } from '../api/queryKeys';
import { useSessionStore } from '@/lib/session';
import type { AdminUser } from '../api/types';

export interface UserDisableModalProps {
  user: AdminUser | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function UserDisableModal({
  user,
  isOpen,
  onClose,
  onSuccess,
}: UserDisableModalProps) {
  const queryClient = useQueryClient();
  const currentUser = useSessionStore((state) => state.user);
  const { disableUser } = useUserMutations();
  const [conflictOpen, setConflictOpen] = useState(false);

  const isSelf = user?.id === currentUser?.id;

  const handleConfirm = async () => {
    if (!user || isSelf) return;

    try {
      await disableUser(user.id, user.name, user.version ?? 1);
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().reset();
        setConflictOpen(true);
        return;
      }
      // Errors handled verbatim by runBlockingAction
    }
  };

  const handleConflictReload = async () => {
    setConflictOpen(false);
    await queryClient.invalidateQueries({ queryKey: adminKeys.allUsers() });
    if (user?.id) {
      await queryClient.invalidateQueries({ queryKey: adminKeys.userDetail(user.id) });
    }
    onClose();
  };

  return (
    <>
      <Dialog open={isOpen && !conflictOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 shadow-float space-y-4"
          data-testid="user-disable-modal"
        >
          <DialogHeader className="border-b border-[#E2E8F0] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-semibold tracking-tight text-[#1E293B]">
                  Disable User Account
                </DialogTitle>
                <DialogDescription className="text-xs text-[#475569] pt-0.5">
                  Confirmation required before deactivating access.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {isSelf ? (
            <div className="rounded-[8px] bg-[#FEF2F2] border border-[#FECACA] p-3.5 text-xs text-[#991B1B]">
              <strong>Self-Action Blocked:</strong> You cannot disable your own active administrator account ({user?.email}). Another administrator must make this change.
            </div>
          ) : (
            <div className="space-y-3 text-xs text-[#475569]">
              <p>
                Are you sure you want to deactivate account access for{' '}
                <strong className="text-[#1E293B]">{user?.name}</strong> (
                <span className="font-mono tabular-nums text-[#1E293B]">{user?.email}</span>)?
              </p>
              <div className="rounded-[8px] bg-[#FFFBEB] border border-[#FDE68A] p-3 text-xs text-[#92400E] space-y-1">
                <p className="font-semibold">Consequences of soft-disabling:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>User session tokens will be evicted immediately.</li>
                  <li>User will be barred from authenticating to the platform.</li>
                  <li>Historic tasks, time entries, and audit logs remain intact.</li>
                  <li>Account can be re-enabled later by an administrator.</li>
                </ul>
              </div>
            </div>
          )}

          <DialogFooter className="border-t border-[#E2E8F0] pt-4 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs h-9 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] cursor-pointer"
              data-testid="disable-user-cancel-btn"
            >
              Cancel
            </Button>
            {!isSelf && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleConfirm}
                className="text-xs h-9 rounded-[6px] bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] font-medium shadow-2xs cursor-pointer"
                data-testid="disable-user-confirm-btn"
              >
                Disable Account
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConflictResolutionModal
        open={conflictOpen}
        onOpenChange={setConflictOpen}
        entityType="User Account"
        onRefreshLatest={() => {
          void handleConflictReload();
        }}
      />
    </>
  );
}
