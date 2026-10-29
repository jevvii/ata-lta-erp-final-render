import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '@/components/common/UserAvatar';
import type { AdminUser, EntityCode, UserRole } from '../api/types';

export interface UserDetailModalProps {
  user: AdminUser | null;
  isOpen?: boolean;
  open?: boolean;
  onClose?: () => void;
  onOpenChange?: (open: boolean) => void;
}

const ROLE_SUMMARIES: Record<UserRole, string> = {
  Admin:
    'Full administrative super-user access across all system modules, user provisioning, retainer template authoring, and system audit logs.',
  Manager:
    'Departmental leadership access including work request oversight, review approvals, retainer generation, and team workload visibility.',
  Accounting:
    'Financial operations access covering billing invoices, client statements, payment tracking, and disbursement vouchers.',
  Operations:
    'Core operational execution access covering work requests, task workflows, checklists, and time logging.',
  Documentation:
    'Document management and compliance access covering DMS records, physical/digital handovers, and transmittal logs.',
  HR:
    'Human resources and internal administration access covering personnel coordination and departmental support.',
};

const ENTITY_LABELS: Record<EntityCode, string> = {
  ATA: 'ATA (Asuncion & Tan Accountancy)',
  LTA: 'LTA (Lopez & Tan Advisory)',
};

function formatTimestamp(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function UserDetailModal({
  user,
  isOpen,
  open,
  onClose,
  onOpenChange,
}: UserDetailModalProps) {
  const modalOpen = isOpen ?? open ?? false;

  const handleClose = () => {
    if (onClose) onClose();
    if (onOpenChange) onOpenChange(false);
  };

  if (!user) return null;

  const isActive =
    typeof user.isActive === 'boolean'
      ? user.isActive
      : user.status !== 'Disabled';
  const version = user.version ?? 1;
  const userCode = user.userNumber || user.user_number;

  return (
    <Dialog open={modalOpen} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent
        className="max-w-lg rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 shadow-float space-y-5"
        data-testid="user-detail-modal"
      >
        <DialogHeader className="border-b border-[#E2E8F0] pb-4">
          <div className="flex items-start justify-between gap-3 pr-6">
            <div className="flex items-center gap-3">
              <UserAvatar
                userId={user.id}
                name={user.name}
                email={user.email}
                avatarUrl={user.avatarUrl}
                size="lg"
                shape="rounded"
                initialsTestId="user-detail-initials"
                className="h-10 w-10 rounded-[8px] text-[14px]"
              />
              <div>
                <DialogTitle
                  className="text-lg font-semibold tracking-tight text-[#1E293B]"
                  data-testid="user-detail-name"
                >
                  {user.name}
                </DialogTitle>
                <DialogDescription
                  className="font-mono text-xs text-[#475569]"
                  data-testid="user-detail-email"
                >
                  {user.email}
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {userCode && (
                <Badge
                  variant="outline"
                  data-testid="user-detail-code"
                  className="rounded-[6px] border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-[#1D4ED8]"
                >
                  {userCode}
                </Badge>
              )}
              <Badge
                variant="outline"
                data-testid="user-detail-version"
                className="rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-[#475569]"
              >
                v{version}
              </Badge>
              <Badge
                variant="outline"
                data-testid="user-detail-status"
                className={
                  isActive
                    ? 'rounded-[6px] border-[#A7F3D0] bg-[#ECFDF5] px-2 py-0.5 text-xs font-medium text-[#047857]'
                    : 'rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 text-xs font-medium text-[#475569]'
                }
              >
                {isActive ? 'Active' : 'Disabled'}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 text-xs text-[#1E293B]">
          {/* 1. System Role & Role Summary */}
          <div className="rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1E293B]">
                System Role
              </span>
              <Badge
                variant="outline"
                data-testid="user-detail-role"
                className="rounded-[6px] border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 font-mono text-xs font-semibold text-[#1D4ED8]"
              >
                {user.role}
              </Badge>
            </div>
            <p className="leading-relaxed text-[#475569]" data-testid="user-detail-role-summary">
              {ROLE_SUMMARIES[user.role] ?? 'Standard operational role access.'}
            </p>
          </div>

          {/* 2. Authorized Entities */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-[#1E293B]">
              Authorized Entities
            </div>
            <div
              className="flex flex-wrap gap-2"
              data-testid="user-detail-entities"
            >
              {user.entities && user.entities.length > 0 ? (
                user.entities.map((ent) => (
                  <div
                    key={ent}
                    className="flex items-center gap-2 rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2"
                  >
                    <Badge
                      variant="outline"
                      className={
                        ent === 'ATA'
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                          : 'bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                      }
                    >
                      {ent}
                    </Badge>
                    <span className="text-xs font-medium text-[#1E293B]">
                      {ENTITY_LABELS[ent] ?? ent}
                    </span>
                  </div>
                ))
              ) : (
                <span className="italic text-[#475569]">No entities assigned</span>
              )}
            </div>
          </div>

          {/* 3. Assigned Departments */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-[#1E293B]">
              Assigned Departments
            </div>
            <div
              className="flex flex-wrap gap-1.5"
              data-testid="user-detail-departments"
            >
              {user.departments && user.departments.length > 0 ? (
                user.departments.map((dept) => (
                  <Badge
                    key={dept}
                    variant="outline"
                    className="rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1 text-xs font-medium text-[#1E293B]"
                  >
                    {dept}
                  </Badge>
                ))
              ) : (
                <span className="italic text-[#475569]" data-testid="user-detail-no-departments">
                  No departments assigned
                </span>
              )}
            </div>
          </div>

          {/* 4. Account Metadata */}
          <div className="rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
            <div className="mb-2 text-xs font-semibold text-[#1E293B]">
              Account Metadata
            </div>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-medium text-[#475569]">
                  User ID
                </dt>
                <dd
                  className="truncate font-mono text-xs font-medium tabular-nums text-[#1E293B]"
                  title={user.id}
                  data-testid="user-detail-id"
                >
                  {user.id}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-[#475569]">
                  Created At
                </dt>
                <dd
                  className="font-mono text-xs tabular-nums text-[#1E293B]"
                  data-testid="user-detail-created-at"
                >
                  {formatTimestamp(user.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-medium text-[#475569]">
                  Updated At
                </dt>
                <dd
                  className="font-mono text-xs tabular-nums text-[#1E293B]"
                  data-testid="user-detail-updated-at"
                >
                  {formatTimestamp(user.updatedAt)}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <DialogFooter className="border-t border-[#E2E8F0] pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            data-testid="user-detail-close-btn"
            className="h-9 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] px-4 text-xs font-medium text-[#1E293B] hover:bg-[#F8FAFC] cursor-pointer"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
