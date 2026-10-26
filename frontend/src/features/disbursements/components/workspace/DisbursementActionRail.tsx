/**
 * Action Inventory & RBAC Matrix for Disbursement Workspace Action Rail
 * ====================================================================
 *
 * Audited Sources:
 * 1. Drawer / Sheet: `DisbursementDetailBody.tsx` (lines 311-318, 543-575, 803-812, 1070-1215)
 * 2. Table Row Actions: `DisbursementsTable.tsx` (lines 572-585) & `FundsReleaseActions.tsx` (lines 266-307)
 * 3. Approval Queue Cards: `AdminApprovalQueue.tsx` (lines 468-525)
 * 4. Archive Tab Actions: `DisbursementArchiveTab.tsx` (lines 36-43, 83-98, 266-279)
 *
 * Roles & Guards:
 * - `isAdmin`: currentUser?.role === 'Admin'
 * - `isAccounting`: currentUser?.role === 'Accounting' || currentUser?.departments?.includes('Accounting')
 * - `canFund`: isAdmin || isAccounting
 * - `isOwnRequest`: currentUser?.id && (item.created_by === user.id || item.createdBy === user.id || item.requested_by === user.id || item.requestedBy === user.id)
 * - `hasVersion`: Number.isInteger(item?.version) && (item?.version ?? 0) > 0
 * - `isV2`: item?.lifecycle_version === 2 && hasVersion
 * - `isArchived`: item?.archived === true || Boolean(item?.archived_at || item?.archivedAt) || isArchiveTab
 * - `isNeedsCorrection`: item?.status === 'Draft' && item?.review_ready === false
 *
 * -------------------------------------------------------------------------------------------------------------------------------------------------
 * Action Name           | Group    | Visibility Condition                                        | Enable / Disabled Condition    | Action Target
 * -------------------------------------------------------------------------------------------------------------------------------------------------
 * Direct Approve        | Primary  | isAdmin && item.status === 'Draft' && isV2 && !isArchived   | disabled if isNeedsCorrection  | Opens AdminApprovalModal
 * Submit Draft          | Workflow | (Auto-submitted on creation in current system;             | Hidden in current UI           | N/A (Hidden - no dead button)
 *                       |          |  corrections submitted via Edit Voucher saving)            | (no dead buttons)              |
 * Prepare Payment (Fund)| Workflow | canFund && item.status === 'Approved' && isV2 && !isArchived| Always enabled when visible    | Opens FundDisbursementModal
 * Sanction Release      | Workflow | isAdmin && item.status === 'Funded' && isV2 && !isArchived  | Always enabled when visible    | Opens ReleaseFundsModal
 * Return to Draft       | Workflow | isAdmin && item.status === 'Rejected' && isV2 && !isArchived| Always enabled when visible    | Calls resendDraft mutation
 * Edit Voucher          | Record   | hasVersion && !isArchived &&                               | Always enabled when visible    | Opens DisbursementEditModal
 *                       |          | (isAdmin || (canFund && isV2 && item.status === 'Draft')   |                                |
 *                       |          |  || (isV2 && isOwnRequest && item.status === 'Draft'))     |                                |
 * Edit Payment Details  | Record   | canFund && isV2 && !isArchived &&                          | Always enabled when visible    | Opens EditPaymentDetailsModal
 *                       |          | (item.status === 'Funded' || item.status === 'Released')   |                                |
 * Print Voucher         | Record   | Boolean(item) && !isDenied (any loaded record, v1 or v2)   | Always enabled when visible    | Opens DisbursementPrintModal
 * Reject Voucher        | Danger   | isAdmin && isV2 && !isArchived &&                          | Always enabled when visible    | Opens RejectReasonModal
 *                       |          | (item.status === 'Draft' || item.status === 'Funded')      |                                |
 * Archive Voucher       | Danger   | isAdmin && item.status === 'Released' && isV2 && !isArchived| Always enabled when visible    | Calls archiveWithBlocking
 * Restore Voucher       | Archive  | isAdmin && item.status === 'Released' && isV2 && isArchived | Always enabled when visible    | Calls restoreWithBlocking
 * -------------------------------------------------------------------------------------------------------------------------------------------------
 */

import { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  DollarSign,
  Pencil,
  CreditCard,
  Printer,
  XCircle,
  Archive,
  ArchiveRestore,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/lib/session';
import {
  useDisbursementDetail,
  useRejectDisbursement,
  useResendDraft,
  useArchiveDisbursement,
  useRestoreDisbursement,
} from '../../api/useDisbursements';
import { disbursementKeys } from '../../api/queryKeys';
import { useLiveModalContext } from '../../lib/useLiveModalContext';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useQueryClient } from '@tanstack/react-query';
import { AdminApprovalModal } from '../AdminApprovalModal';
import { FundDisbursementModal } from '../FundDisbursementModal';
import { ReleaseFundsModal } from '../FundsReleaseActions';
import { DisbursementEditModal } from '../DisbursementEditModal';
import { EditPaymentDetailsModal } from '../EditPaymentDetailsModal';
import { DisbursementPrintModal } from '../DisbursementPrintModal';
import { RejectReasonModal } from '@/features/operations/components/RejectReasonModal';
import type { Disbursement } from '../../api/types';
import type { ApiError } from '@/lib/api';

export interface DisbursementActionRailProps {
  selectedId?: string | null;
  selectedDisbursement?: Disbursement | null;
  isArchiveTab?: boolean;
  onDeselect?: () => void;
  className?: string;
}

export function DisbursementActionRail({
  selectedId,
  selectedDisbursement,
  isArchiveTab = false,
  onDeselect,
  className,
}: DisbursementActionRailProps) {
  const queryClient = useQueryClient();
  const user = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const effectiveId = selectedId || selectedDisbursement?.id;

  const { data: fetchedItem, isLoading: isFetching } = useDisbursementDetail(
    effectiveId ?? undefined,
    {
      enabled: Boolean(effectiveId) && !selectedDisbursement,
    }
  );

  const item: Disbursement | null = selectedDisbursement || fetchedItem || null;

  // Live modal concurrency context
  const { captureContext } = useLiveModalContext({
    isOpen: Boolean(effectiveId),
    disbursementId: effectiveId ?? undefined,
    version: item?.version,
  });
  const actionPending = useRef(false);

  // Mutations
  const { rejectDisbursement } = useRejectDisbursement();
  const { resendDraft } = useResendDraft();
  const { archiveWithBlocking } = useArchiveDisbursement();
  const { restoreWithBlocking } = useRestoreDisbursement();

  // Modals state
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPaymentEditModalOpen, setIsPaymentEditModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [conflictModalState, setConflictModalState] = useState<{
    isOpen: boolean;
    error?: unknown;
    attemptedStatus?: string | null;
  }>({ isOpen: false });

  // Close modals when selection or user/entity changes
  useEffect(() => {
    setIsApprovalModalOpen(false);
    setIsFundModalOpen(false);
    setIsReleaseModalOpen(false);
    setIsEditModalOpen(false);
    setIsPaymentEditModalOpen(false);
    setIsPrintModalOpen(false);
    setIsRejectModalOpen(false);
    setConflictModalState({ isOpen: false });
  }, [effectiveId, user?.id, activeEntity]);

  // If nothing is selected, render the disabled-looking hint
  if (!effectiveId || (!item && !isFetching)) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center p-6 text-center h-full min-h-[300px] text-muted space-y-2 select-none',
          className
        )}
        data-testid="disbursement-action-rail-empty"
      >
        <div className="w-10 h-10 rounded-full bg-sidebar flex items-center justify-center border border-border">
          <FileText className="h-5 w-5 text-muted" />
        </div>
        <p className="text-xs font-medium text-muted">
          Select a voucher to act on it
        </p>
      </div>
    );
  }

  // Loading skeleton when switching vouchers
  if (!item && isFetching) {
    return (
      <div
        className={cn('p-4 space-y-3 w-full h-full animate-pulse', className)}
        data-testid="disbursement-action-rail-loading"
      >
        <div className="h-4 bg-sidebar rounded-[4px] w-2/3" />
        <div className="h-10 bg-sidebar rounded-[6px] w-full" />
        <div className="h-10 bg-sidebar rounded-[6px] w-full" />
        <div className="h-10 bg-sidebar rounded-[6px] w-full" />
      </div>
    );
  }

  if (!item) return null;

  // RBAC & Lifecycle variables
  const isAdmin = user?.role === 'Admin';
  const isAccounting = Boolean(
    user?.role === 'Accounting' || user?.departments?.includes('Accounting')
  );
  const canFund = isAdmin || isAccounting;

  const isOwnRequest = Boolean(
    user?.id &&
      ((item.created_by && item.created_by === user.id) ||
        (item.createdBy && item.createdBy === user.id) ||
        (item.requested_by && item.requested_by === user.id) ||
        (item.requestedBy && item.requestedBy === user.id))
  );

  const hasVersion = Number.isInteger(item.version) && (item.version ?? 0) > 0;
  const isV2 = item.lifecycle_version === 2 && hasVersion;
  const isArchived = Boolean(item.archived || item.archived_at || item.archivedAt || isArchiveTab);
  const isNeedsCorrection = item.status === 'Draft' && item.review_ready === false;

  const canEditVoucher =
    hasVersion &&
    !isArchived &&
    (isAdmin ||
      (canFund && isV2 && item.status === 'Draft') ||
      (isV2 && isOwnRequest && item.status === 'Draft'));

  const disbNumber =
    item.disbursement_number ||
    item.disbursementNumber ||
    `DISB-${item.id.slice(0, 8)}`;

  // Mutation Handlers
  const handleResendDraft = async () => {
    if (!item || actionPending.current) return;
    actionPending.current = true;
    const context = captureContext();
    try {
      await resendDraft({ id: item.id, expectedVersion: item.version });
    } catch (err: unknown) {
      if (context.isStale()) return;
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
          attemptedStatus: 'Draft',
        });
      }
    } finally {
      actionPending.current = false;
    }
  };

  const handleArchive = async () => {
    if (!item || actionPending.current) return;
    actionPending.current = true;
    const context = captureContext();
    try {
      await archiveWithBlocking({
        id: item.id,
        reference: disbNumber,
        expectedVersion: item.version,
      });
      if (!context.isStale() && onDeselect) {
        onDeselect();
      }
    } catch (err: unknown) {
      if (context.isStale()) return;
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
          attemptedStatus: 'Archived',
        });
      }
    } finally {
      actionPending.current = false;
    }
  };

  const handleRestore = async () => {
    if (!item || actionPending.current) return;
    actionPending.current = true;
    const context = captureContext();
    try {
      await restoreWithBlocking({
        id: item.id,
        reference: disbNumber,
        expectedVersion: item.version,
      });
      if (!context.isStale() && onDeselect) {
        onDeselect();
      }
    } catch (err: unknown) {
      if (context.isStale()) return;
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
          attemptedStatus: 'Released',
        });
      }
    } finally {
      actionPending.current = false;
    }
  };

  // Visibility Flags
  const showApprove = isAdmin && item.status === 'Draft' && isV2 && !isArchived;
  const showFund = item.status === 'Approved' && isV2 && canFund && !isArchived;
  const showRelease = item.status === 'Funded' && isV2 && isAdmin && !isArchived;
  const showResend = item.status === 'Rejected' && isV2 && isAdmin && !isArchived;
  const showEdit = canEditVoucher;
  const showEditPayment =
    (item.status === 'Funded' || item.status === 'Released') && isV2 && canFund && !isArchived;
  const showPrint = true; // Print Voucher is available on any loaded voucher
  const showReject = isAdmin && isV2 && (item.status === 'Draft' || item.status === 'Funded') && !isArchived;
  const showArchive = item.status === 'Released' && isV2 && isAdmin && !isArchived;
  const showRestore = item.status === 'Released' && isV2 && isAdmin && isArchived;

  const hasPrimaryDecision = showApprove;
  const hasWorkflow = showFund || showRelease || showResend;
  const hasRecord = showEdit || showEditPayment || showPrint;
  const hasDanger = showReject || showArchive;
  const hasArchiveGroup = showRestore;

  return (
    <div
      className={cn('flex flex-col w-full h-full min-h-0 select-none', className)}
      data-testid="disbursement-action-rail"
      role="region"
      aria-label="Voucher Actions"
    >
      {/* Rail Header */}
      <div className="px-2.5 py-1 border-b border-border bg-sidebar/50 shrink-0 h-7 flex items-center">
        <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">
          Actions
        </span>
      </div>

      {/* Button Groups Container */}
      <div className="flex-1 overflow-y-auto overscroll-contain p-1.5 flex flex-col gap-1">
        {/* 1. Primary Decision Group (Approve — the single filled primary per view) */}
        {hasPrimaryDecision && (
          <div className="flex flex-col gap-1" data-testid="rail-group-primary">
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={isNeedsCorrection}
              title={
                isNeedsCorrection
                  ? 'Returned draft awaiting requester correction'
                  : 'Direct Approve'
              }
              onClick={() => setIsApprovalModalOpen(true)}
              className="w-full h-7 px-1.5 py-1 text-[11px] font-semibold justify-start gap-1 rounded-[4px] bg-primary hover:bg-primary-hover text-inverse shadow-2xs transition-[background-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="rail-approve-btn"
            >
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-inverse" />
              <span className="truncate">Direct Approve</span>
            </Button>
          </div>
        )}

        {/* Divider if Primary and subsequent groups exist */}
        {hasPrimaryDecision && (hasWorkflow || hasRecord || hasDanger || hasArchiveGroup) && (
          <div className="my-0.5 border-b border-border" role="separator" />
        )}

        {/* 2. Workflow Group (Submit / Fund / Release / Resend) */}
        {hasWorkflow && (
          <div className="flex flex-col gap-1" data-testid="rail-group-workflow">
            {showFund && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsFundModalOpen(true)}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-hover text-ink border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-fund-btn"
              >
                <DollarSign className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">Prepare Payment</span>
              </Button>
            )}

            {showRelease && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                title="Sanction payment release"
                onClick={() => setIsReleaseModalOpen(true)}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-hover text-ink border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-release-btn"
              >
                <DollarSign className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">Sanction Release</span>
              </Button>
            )}

            {showResend && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleResendDraft}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-primary-light text-primary border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-resend-draft-btn"
              >
                <RefreshCw className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">Return to Draft</span>
              </Button>
            )}
          </div>
        )}

        {/* Divider if Workflow and subsequent groups exist */}
        {hasWorkflow && (hasRecord || hasDanger || hasArchiveGroup) && (
          <div className="my-0.5 border-b border-border" role="separator" />
        )}

        {/* 3. Record Group (Edit Voucher, Edit Payment, Print) */}
        {hasRecord && (
          <div className="flex flex-col gap-1" data-testid="rail-group-record">
            {showEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditModalOpen(true)}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-hover text-ink border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-edit-btn"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">
                  {isV2 && item.status === 'Draft' ? 'Edit Voucher' : 'Edit Printed Details'}
                </span>
              </Button>
            )}

            {showEditPayment && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPaymentEditModalOpen(true)}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-hover text-ink border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-edit-payment-btn"
              >
                <CreditCard className="h-3.5 w-3.5 shrink-0 text-primary" />
                <span className="truncate">Edit Payment Details</span>
              </Button>
            )}

            {showPrint && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPrintModalOpen(true)}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-hover text-ink border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-print-btn"
              >
                <Printer className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">Print Voucher</span>
              </Button>
            )}
          </div>
        )}

        {/* Divider if Record and Danger exist */}
        {hasRecord && (hasDanger || hasArchiveGroup) && (
          <div className="my-0.5 border-b border-border" role="separator" />
        )}

        {/* 4. Danger Group (Reject, Archive) */}
        {hasDanger && (
          <div className="flex flex-col gap-1" data-testid="rail-group-danger">
            {showReject && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsRejectModalOpen(true)}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-danger-surface text-danger border border-danger-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-reject-btn"
              >
                <XCircle className="h-3.5 w-3.5 shrink-0 text-danger-solid" />
                <span className="truncate">Reject Voucher</span>
              </Button>
            )}

            {showArchive && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleArchive}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-hover text-ink border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-archive-btn"
              >
                <Archive className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">Archive Voucher</span>
              </Button>
            )}
          </div>
        )}

        {/* Divider if Danger and ArchiveGroup exist */}
        {hasDanger && hasArchiveGroup && (
          <div className="my-0.5 border-b border-border" role="separator" />
        )}

        {/* 5. Archive Context Group (Restore) */}
        {hasArchiveGroup && (
          <div className="flex flex-col gap-1" data-testid="rail-group-archive">
            {showRestore && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRestore}
                className="w-full h-7 px-1.5 py-1 text-[11px] font-medium justify-start gap-1 rounded-[4px] bg-surface hover:bg-hover text-ink border border-border transition-[background-color,border-color,color,box-shadow,transform] duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96] cursor-pointer"
                data-testid="rail-restore-btn"
              >
                <ArchiveRestore className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">Restore Voucher</span>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Root Mounted Modals */}
      {isApprovalModalOpen && item && (
        <AdminApprovalModal
          isOpen={isApprovalModalOpen}
          disbursement={item}
          onClose={() => setIsApprovalModalOpen(false)}
          onSuccess={() => setIsApprovalModalOpen(false)}
          onConflict={(err) => {
            setIsApprovalModalOpen(false);
            setConflictModalState({
              isOpen: true,
              error: err,
              attemptedStatus: 'Approved',
            });
          }}
        />
      )}

      {isFundModalOpen && item && (
        <FundDisbursementModal
          isOpen={isFundModalOpen}
          disbursement={item}
          onClose={() => setIsFundModalOpen(false)}
        />
      )}

      {isReleaseModalOpen && item && (
        <ReleaseFundsModal
          isOpen={isReleaseModalOpen}
          disbursement={item}
          onClose={() => setIsReleaseModalOpen(false)}
        />
      )}

      {isEditModalOpen && item && canEditVoucher && (
        <DisbursementEditModal
          isOpen={isEditModalOpen}
          disbursement={item}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}

      {isPaymentEditModalOpen && item && (
        <EditPaymentDetailsModal
          isOpen={isPaymentEditModalOpen}
          disbursement={item}
          onClose={() => setIsPaymentEditModalOpen(false)}
        />
      )}

      {isPrintModalOpen && item && (
        <DisbursementPrintModal
          isOpen={isPrintModalOpen}
          disbursement={item}
          onClose={() => setIsPrintModalOpen(false)}
        />
      )}

      {isRejectModalOpen && item && (
        <RejectReasonModal
          isOpen={isRejectModalOpen}
          requestId={item.id}
          title="Reject Disbursement Voucher"
          description={`Provide a justification for rejecting voucher ${disbNumber} (1–500 characters).`}
          placeholder="e.g. Ineligible reimbursement item..."
          submitLabel="Reject Voucher"
          maxLength={500}
          onReject={async (reqId, reason) => {
            const context = captureContext();
            try {
              await rejectDisbursement({ id: reqId, reason, expectedVersion: item.version });
            } catch (err: unknown) {
              if (context.isStale()) return;
              if (isConcurrencyConflictError(err)) {
                useBlockingModalStore.getState().close();
                setIsRejectModalOpen(false);
                setConflictModalState({
                  isOpen: true,
                  error: err,
                  attemptedStatus: 'Rejected',
                });
                return;
              }
              throw err;
            }
          }}
          invalidateQueries={[disbursementKeys.all]}
          onClose={() => setIsRejectModalOpen(false)}
          onSuccess={() => setIsRejectModalOpen(false)}
        />
      )}

      {/* Concurrency Conflict Resolution Modal */}
      <ConflictResolutionModal
        isOpen={conflictModalState.isOpen}
        onClose={() => setConflictModalState({ isOpen: false })}
        error={conflictModalState.error as ApiError | Error | null}
        entityTitle={item?.disbursement_number || effectiveId || undefined}
        entityType="Disbursement"
        expectedVersion={item?.version}
        attemptedStatus={conflictModalState.attemptedStatus ?? undefined}
        currentStatus={item?.status}
        onRefreshAndKeepLatest={async () => {
          if (effectiveId) {
            await queryClient.invalidateQueries({
              queryKey: disbursementKeys.detail(effectiveId),
            });
          }
          await queryClient.invalidateQueries({ queryKey: disbursementKeys.lists() });
        }}
      />
    </div>
  );
}
