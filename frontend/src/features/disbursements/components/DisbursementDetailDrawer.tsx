import { DisbursementEditModal } from './DisbursementEditModal';
import { useState, useEffect, useRef } from 'react';
import { useLiveModalContext } from '../lib/useLiveModalContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Building,
  Calendar,
  DollarSign,
  Receipt,
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Printer,
  Pencil,
  RefreshCw,
  Archive,
  ArchiveRestore,
  Lock,
} from 'lucide-react';
import { useScopedRecordGuard } from '@/lib/useScopedRecordGuard';
import {
  useDisbursementDetail,
  useRejectDisbursement,
  useResendDraft,
  useArchiveDisbursement,
  useRestoreDisbursement,
  useDisbursementReceiptUrl,
} from '../api/useDisbursements';
import { DisbursementStatusBadge } from './DisbursementStatusBadge';
import { ReleaseFundsModal } from './FundsReleaseActions';
import { FundDisbursementModal } from './FundDisbursementModal';
import { RejectReasonModal } from '@/features/operations/components/RejectReasonModal';
import { DisbursementPrintModal } from './DisbursementPrintModal';
import { AdminApprovalModal } from './AdminApprovalModal';
import { useSessionStore } from '@/lib/session';
import { disbursementKeys } from '../api/queryKeys';
import { PresenceAvatars } from '@/components/common/PresenceAvatars';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import type { ApiError } from '@/lib/api';
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
  const queryClient = useQueryClient();
  const user = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const isAdmin = user?.role === 'Admin';
  const canFund =
    isAdmin || user?.role === 'Accounting' || Boolean(user?.departments?.includes('Accounting'));

  const effectiveId = id || initialDisbursement?.id;
  const {
    data: fetchedItem,
    isLoading: isFetching,
    isError: isDisbursementError,
    error: disbursementError,
    isPlaceholderData: isDisbursementPlaceholder,
  } = useDisbursementDetail(
    effectiveId ?? undefined,
    {
      enabled: isOpen && Boolean(effectiveId),
    }
  );

  const {
    record: item,
    isDenied,
    isScopeStale,
    canFetchChildren,
  } = useScopedRecordGuard<Disbursement>({
    recordId: effectiveId,
    isOpen,
    onClose,
    queryError: disbursementError,
    isQueryError: isDisbursementError,
    isPlaceholderData: isDisbursementPlaceholder,
    liveRecord: fetchedItem,
    initialRecord: initialDisbursement,
    queryKey: effectiveId ? disbursementKeys.detail(effectiveId) : undefined,
  });

  const isLoading = !item && isFetching && !isDenied;
  const voucher = item;
  const { captureContext } = useLiveModalContext({
    isOpen,
    disbursementId: effectiveId,
    version: item?.version,
  });
  const actionPending = useRef(false);

  const { rejectDisbursement } = useRejectDisbursement();
  const { resendDraft } = useResendDraft();
  const { archiveWithBlocking } = useArchiveDisbursement();
  const { restoreWithBlocking } = useRestoreDisbursement();

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isInlineEditing, setIsInlineEditing] = useState(false);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);
  const [isFundModalOpen, setIsFundModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const [conflictModalState, setConflictModalState] = useState<{
    isOpen: boolean;
    error?: unknown;
    attemptedStatus?: string | null;
  }>({ isOpen: false });

  const {
    data: receiptData,
    isLoading: isLoadingReceipt,
    isError: isReceiptError,
    error: receiptError,
    refetch: refetchReceiptUrl,
    isFetching: isFetchingReceipt,
  } = useDisbursementReceiptUrl(item?.id, {
    enabled:
      isOpen &&
      Boolean(item?.id) &&
      canFetchChildren &&
      Boolean(
        item?.receipt_filename ||
        item?.receiptFilename ||
        item?.receipt_s3_key ||
        item?.receiptS3Key
      ),
  });

  useEffect(() => {
    setImageLoadError(false);
  }, [receiptData?.url]);

  useEffect(() => {
    setIsEditModalOpen(false);
    setIsInlineEditing(false);
    setIsReleaseModalOpen(false);
    setIsFundModalOpen(false);
    setIsRejectModalOpen(false);
    setIsApprovalModalOpen(false);
    setIsPrintModalOpen(false);
    setConflictModalState({ isOpen: false });
  }, [effectiveId, isOpen, user?.id, activeEntity]);
  if (!isOpen) return null;

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
        reference:
          item.disbursement_number || item.disbursementNumber || `DISB-${item.id.slice(0, 8)}`,
        expectedVersion: item.version,
      });
      if (!context.isStale()) onClose();
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
        reference:
          item.disbursement_number || item.disbursementNumber || `DISB-${item.id.slice(0, 8)}`,
        expectedVersion: item.version,
      });
      if (!context.isStale()) onClose();
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

  const isOwnRequest = Boolean(
    user?.id &&
    item &&
    ((item.created_by && item.created_by === user.id) ||
      (item.createdBy && item.createdBy === user.id) ||
      (item.requested_by && item.requested_by === user.id) ||
      (item.requestedBy && item.requestedBy === user.id))
  );

  const hasVersion = Number.isInteger(item?.version) && (item?.version ?? 0) > 0;
  const isV2 = item?.lifecycle_version === 2 && hasVersion;
  const canEditVoucher =
    hasVersion &&
    !item?.archived &&
    (isAdmin ||
      (canFund && isV2 && item?.status === 'Draft') ||
      (isV2 && isOwnRequest && item?.status === 'Draft' && !item?.archived));
  const isNeedsCorrection = item?.status === 'Draft' && item?.review_ready === false;

  const disbNumber =
    item?.disbursement_number ||
    item?.disbursementNumber ||
    (item ? `DISB-${item.id.slice(0, 8)}` : '');
  const clientName =
    item?.client_name || item?.clientName || item?.clients?.name || 'Firm Internal';
  const workRequestId = item?.linked_work_request_id || item?.linkedWorkRequestId;

  if (isScopeStale || !isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] space-y-5 border-[#E2E8F0] overflow-y-auto border p-6 shadow-float rounded-[12px] max-w-2xl bg-[#FFFFFF]"
        data-testid="disbursement-detail-drawer"
      >
        {isDenied ? (
          <div className="py-16 text-center space-y-3" data-testid="disbursement-access-denied">
            <div className="w-12 h-12 rounded-full bg-[#F1F5F9] mx-auto flex items-center justify-center">
              <Lock className="w-6 h-6 text-[#64748B]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#1E293B]">Access Not Available</h3>
              <p className="text-xs text-[#475569] max-w-xs mx-auto">
                You do not have access to this disbursement voucher or access has been revoked.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="mt-2 text-xs"
              data-testid="disbursement-access-denied-close-btn"
            >
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader className="border-b border-[#E2E8F0] pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-bold text-[#1E293B]">
                  {disbNumber || 'Disbursement Details'}
                </DialogTitle>
                {item && (
                  <DisbursementStatusBadge status={item.status} reviewReady={item.review_ready} />
                )}
                {item?.entity_code && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-[6px] bg-[#F8FAFC] text-[#475569]">
                    {item.entity_code}
                  </span>
                )}
                {effectiveId && (
                  <PresenceAvatars domain="disbursement" roomId={effectiveId} maxAvatars={4} />
                )}
              </div>
              <DialogDescription className="text-xs text-[#475569]">
                Created on{' '}
                {item?.created_at || item?.createdAt
                  ? new Date(item.created_at || item.createdAt || '').toLocaleString()
                  : 'N/A'}
              </DialogDescription>
            </div>
            {item && (
              <div className="text-right">
                <span
                  className="text-lg font-bold text-[#1E293B] block"
                  data-testid="drawer-amount"
                >
                  ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </span>
                <span className="text-xs text-[#1E293B] font-medium">
                  {item.fund_source || item.fundSource}
                </span>
              </div>
            )}
          </div>
        </DialogHeader>

        {isLoading || !item ? (
          <div className="py-12 text-center text-xs text-[#475569]" data-testid="drawer-loading">
            Loading disbursement details...
          </div>
        ) : (
          <div className="space-y-5 text-xs text-[#1E293B]">
            {canEditVoucher && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditModalOpen(true)}
                    data-testid="edit-disbursement-button"
                  >
                    <Pencil className="w-4 h-4" />
                    {isV2 && item.status === 'Draft' ? 'Edit Voucher' : 'Edit Printed Details'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsInlineEditing(!isInlineEditing)}
                  >
                    {isInlineEditing ? 'Close inline editor' : 'Edit inline'}
                  </Button>
                </div>
                {isInlineEditing && (
                  <DisbursementEditModal
                    inline
                    isOpen
                    disbursement={item}
                    onClose={() => setIsInlineEditing(false)}
                  />
                )}
              </div>
            )}

            {/* Needs Correction Alert Banner */}
            {isNeedsCorrection && (
              <div
                className="p-3 bg-orange-50 border border-orange-200 rounded-[8px] text-orange-900 space-y-1"
                data-testid="drawer-needs-correction-banner"
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <AlertCircle className="h-4 w-4 text-orange-600 shrink-0" />
                  Returned for Requester Correction
                </div>
                <p className="text-xs text-orange-800">
                  This voucher was returned to Draft. Requester must edit and correct this request
                  before it can be reviewed or approved.
                </p>
              </div>
            )}

            {/* Duty Separation Warnings */}
            {/* Rejection Alert Banner */}
            {item.status === 'Rejected' && (
              <div
                className="p-3 bg-rose-50 border border-rose-200 rounded-[6px] text-rose-900 space-y-1"
                data-testid="drawer-rejection-banner"
              >
                <div className="flex items-center gap-1.5 font-bold text-xs">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  Voucher Rejected
                </div>
                <p
                  className="text-xs text-rose-800 whitespace-pre-wrap pl-5"
                  data-testid="drawer-rejection-reason"
                >
                  {item.rejection_reason || item.rejectionReason || 'No reason specified.'}
                </p>
                {(item.rejected_by_name ||
                  item.rejected_by ||
                  item.rejectedBy ||
                  item.rejected_at ||
                  item.rejectedAt) && (
                  <div className="text-xs text-rose-600 pl-5">
                    By {item.rejected_by_name || item.rejected_by || item.rejectedBy || 'Admin'} on{' '}
                    {item.rejected_at || item.rejectedAt
                      ? new Date(item.rejected_at || item.rejectedAt || '').toLocaleString()
                      : 'N/A'}
                  </div>
                )}
              </div>
            )}

            {/* Modified by Accounting Alert Banner */}
            {(item.edited_by_accounting || item.notes?.includes('Edited by Accounting')) && (
              <div
                className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] flex items-center gap-2 text-xs text-amber-900"
                data-testid="modified-by-accounting-banner"
              >
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <div>
                  <span className="font-semibold block">Modified by Accounting:</span>
                  <span>
                    Financial amounts or details were adjusted during voucher preparation.
                  </span>
                </div>
              </div>
            )}

            {/* General Information Grid */}
            <div className="grid grid-cols-2 gap-4 p-3 bg-[#F8FAFC] rounded-[8px] border border-[#E2E8F0]">
              <div className="space-y-1">
                <span className="text-[#475569] block text-xs">Category</span>
                <span className="font-semibold text-[#1E293B]">{item.category}</span>
              </div>
              <div className="space-y-1">
                <span className="text-[#475569] block text-xs">Client Association</span>
                <span className="font-semibold text-[#1E293B] flex items-center gap-1">
                  <Building className="h-3 w-3 text-[#475569]" />
                  {clientName}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[#475569] block text-xs">Linked Work Request</span>
                <span
                  className="text-[#1E293B] flex items-center gap-1"
                  data-testid="drawer-work-request"
                >
                  <FileText className="h-3 w-3 text-[#475569]" />
                  {item.linked_work_request_order_number && item.linked_work_request_name
                    ? `${item.linked_work_request_order_number} — ${item.linked_work_request_name}`
                    : item.linked_work_request_name ||
                      item.linked_work_request_order_number ||
                      (workRequestId ? 'Work Request Linked' : 'None')}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[#475569] block text-xs">Due Date</span>
                <span className="text-[#1E293B] flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-[#475569]" />
                  {item.due_date || item.dueDate || 'No due date'}
                </span>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <h4 className="font-semibold text-[#1E293B] text-xs">Expense Description</h4>
              <p className="text-xs text-[#1E293B] bg-[#FFFFFF] p-3 rounded-[8px] border border-[#E2E8F0] whitespace-pre-wrap">
                {item.description}
              </p>
            </div>

            {/* Notes */}
            {item.notes && (
              <div className="space-y-1">
                <h4 className="font-semibold text-[#1E293B] text-xs">Internal Notes</h4>
                <p className="text-xs text-[#475569] bg-[#FFFFFF] p-3 rounded-[8px] border border-[#E2E8F0] whitespace-pre-wrap">
                  {item.notes}
                </p>
              </div>
            )}

            {/* Receipt Attachment */}
            {(item.receipt_filename ||
              item.receiptFilename ||
              item.receipt_s3_key ||
              item.receiptS3Key) && (
              <div className="p-3 bg-[#F8FAFC]/60 border border-[#E2E8F0]/80 rounded-[6px] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-[#1E293B]" />
                    <div>
                      <span className="font-medium text-[#1E3A8A] block text-xs">
                        {item.receipt_filename || item.receiptFilename || 'Supporting Document'}
                      </span>
                      {(item.receipt_s3_key || item.receiptS3Key) && (
                        <span className="text-xs text-[#1E293B] block">
                          {item.receipt_s3_key || item.receiptS3Key}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Receipt Action / Status */}
                  {isReceiptError ? (
                    <div className="flex items-center gap-2" data-testid="receipt-error-state">
                      <span className="text-xs text-rose-600 font-medium flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
                        {(receiptError as Error)?.message || 'Preview unavailable'}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setImageLoadError(false);
                          void refetchReceiptUrl();
                        }}
                        className="text-xs h-6 px-2 text-rose-700 border-rose-200 hover:bg-rose-50 cursor-pointer"
                        data-testid="btn-retry-receipt"
                      >
                        <RefreshCw
                          className={cn('h-3 w-3 mr-1', isFetchingReceipt && 'animate-spin')}
                        />
                        Retry
                      </Button>
                    </div>
                  ) : receiptData?.status === 'unavailable' ? (
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200"
                      data-testid="receipt-legacy-unavailable"
                    >
                      Supporting document unavailable
                    </span>
                  ) : receiptData?.url ? (
                    <div className="flex items-center gap-1.5">
                      <a
                        href={receiptData.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs cursor-pointer"
                        data-testid="btn-preview-receipt"
                      >
                        <FileText className="h-3 w-3" />
                        View / Download
                      </a>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setImageLoadError(false);
                          void refetchReceiptUrl();
                        }}
                        className="text-xs h-6 px-2 text-[#1E293B] border-[#E2E8F0] hover:bg-[#F8FAFC] cursor-pointer"
                        title="Refresh signed URL (valid for 5 minutes)"
                        data-testid="btn-refresh-receipt"
                      >
                        <RefreshCw
                          className={cn('h-3 w-3 mr-1', isFetchingReceipt && 'animate-spin')}
                        />
                        Refresh Link
                      </Button>
                    </div>
                  ) : isLoadingReceipt || isFetchingReceipt ? (
                    <span className="text-xs text-[#475569] flex items-center gap-1">
                      <RefreshCw className="h-3 w-3 animate-spin text-blue-500" />
                      Loading document link...
                    </span>
                  ) : null}
                </div>

                {/* Inline image preview if available */}
                {receiptData?.url && receiptData.contentType?.startsWith('image/') && (
                  <div className="pt-2 border-t border-[#BFDBFE]">
                    {imageLoadError ? (
                      <div
                        className="p-3 bg-amber-50/80 border border-amber-200 rounded-[6px] text-center space-y-1.5"
                        data-testid="receipt-image-error"
                      >
                        <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-amber-800">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                          <span>Image preview failed to load or signed link expired</span>
                        </div>
                        <p className="text-xs text-amber-700">
                          Signed receipt URLs expire after 5 minutes. Refresh to obtain a new signed
                          preview.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setImageLoadError(false);
                            void refetchReceiptUrl();
                          }}
                          className="text-xs h-6 px-2 border-amber-300 text-amber-800 hover:bg-amber-100 cursor-pointer"
                          data-testid="btn-retry-image-preview"
                        >
                          <RefreshCw
                            className={cn('h-3 w-3 mr-1', isFetchingReceipt && 'animate-spin')}
                          />
                          Refresh Image Preview
                        </Button>
                      </div>
                    ) : (
                      <img
                        src={receiptData.url}
                        alt={item.receipt_filename || item.receiptFilename || 'Receipt Preview'}
                        className="max-h-48 rounded border border-[#E2E8F0] object-contain mx-auto"
                        onError={() => setImageLoadError(true)}
                        data-testid="receipt-preview-image"
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Payment & Settlement Details */}
            {(item.status === 'Released' ||
              item.status === 'Funded' ||
              item.payment_method ||
              item.paymentMethod) && (
              <div className="p-3 bg-purple-50/50 border border-purple-200/70 rounded-[6px] space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-purple-900 text-xs flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-purple-600" />
                    Payment Release Information
                  </h4>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[#475569]">Method: </span>
                    <span
                      className="font-medium text-[#1E293B]"
                      data-testid="detail-payment-method"
                    >
                      {item.payment_method || item.paymentMethod || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#475569]">Reference: </span>
                    <span
                      className="font-medium text-[#1E293B]"
                      data-testid="detail-payment-reference"
                    >
                      {item.payment_reference || item.paymentReference || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#475569]">Bank: </span>
                    <span className="font-medium text-[#1E293B]" data-testid="detail-payment-bank">
                      {item.payment_bank || item.paymentBank || 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[#475569]">Payment Date: </span>
                    <span className="font-medium text-[#1E293B]" data-testid="detail-payment-date">
                      {item.payment_date || item.paymentDate || 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Lifecycle Audit Trail */}
            <div className="space-y-2 border-t border-[#E2E8F0] pt-3">
              <h4 className="font-semibold text-[#1E293B] text-xs flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#475569]" />
                Lifecycle Audit Timeline
              </h4>
              {item.lifecycle_history && item.lifecycle_history.length > 0 ? (
                <div
                  className="space-y-2 text-xs text-[#475569] pl-2"
                  data-testid="lifecycle-history-timeline"
                >
                  {item.lifecycle_history.map((evt, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-2 border-l-2 border-[#93C5FD] pl-2 py-0.5"
                    >
                      <span className="w-2 h-2 rounded-[6px] bg-blue-500 mt-1 shrink-0" />
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-[#1E293B]">
                            {evt.action || evt.new_status}
                          </span>
                          {evt.old_status && evt.new_status && (
                            <span className="text-xs text-[#475569]">
                              ({evt.old_status} → {evt.new_status})
                            </span>
                          )}
                          <span className="text-xs text-[#475569]">
                            {new Date(evt.created_at || evt.timestamp || '').toLocaleString()}
                          </span>
                        </div>
                        <div className="text-[#475569]">
                          By{' '}
                          <span className="font-medium text-[#1E293B]">
                            {evt.actor_name || evt.actor_id || 'System'}
                          </span>
                        </div>
                        {evt.reason && (
                          <div className="text-rose-700 bg-rose-50 px-2 py-0.5 rounded text-xs">
                            Reason: {evt.reason}
                          </div>
                        )}
                        {evt.notes && <div className="text-[#475569] text-xs">{evt.notes}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5 text-xs text-[#475569] pl-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-[6px] bg-slate-400 shrink-0" />
                    <span>
                      Created by{' '}
                      <span className="font-medium text-[#1E293B]">
                        {item.created_by_name ||
                          item.createdByName ||
                          item.requested_by_name ||
                          item.requestedByName ||
                          item.employee_name ||
                          item.employeeName ||
                          item.requested_by ||
                          item.requestedBy ||
                          item.created_by ||
                          item.createdBy ||
                          'User'}
                      </span>{' '}
                      on {new Date(item.created_at || item.createdAt || '').toLocaleString()}
                    </span>
                  </div>
                  {(item.approved_at || item.approvedAt) && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-[6px] bg-blue-500 shrink-0" />
                      <span>
                        Approved by{' '}
                        <span className="font-medium text-[#1E293B]">
                          {item.approved_by_name ||
                            item.approvedByName ||
                            item.approved_by ||
                            item.approvedBy ||
                            'Admin'}
                        </span>{' '}
                        on {new Date(item.approved_at || item.approvedAt || '').toLocaleString()}
                      </span>
                    </div>
                  )}
                  {(item.funded_at || item.fundedAt || item.payment_date || item.paymentDate) && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-[6px] bg-indigo-500 shrink-0" />
                      <span>
                        Payment prepared / funded by{' '}
                        <span className="font-medium text-[#1E293B]">
                          {item.funded_by_name ||
                            item.funded_by ||
                            item.fundedBy ||
                            item.payment_processed_by ||
                            item.paymentProcessedBy ||
                            'Accounting'}
                        </span>{' '}
                        {item.funded_at || item.fundedAt
                          ? `on ${new Date(item.funded_at || item.fundedAt || '').toLocaleString()}`
                          : ''}
                      </span>
                    </div>
                  )}
                  {(item.released_at || item.releasedAt) && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-[6px] bg-purple-500 shrink-0" />
                      <span>
                        Released by{' '}
                        <span className="font-medium text-[#1E293B]">
                          {item.released_by_name ||
                            item.releasedByName ||
                            item.released_by ||
                            item.releasedBy ||
                            'Admin'}
                        </span>{' '}
                        on {new Date(item.released_at || item.releasedAt || '').toLocaleString()}
                      </span>
                    </div>
                  )}
                  {(item.status === 'Rejected' || item.rejected_at || item.rejectedAt) && (
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-[6px] bg-rose-500 shrink-0" />
                      <span>
                        Rejected by{' '}
                        <span className="font-medium text-[#1E293B]">
                          {item.rejected_by_name ||
                            item.rejectedByName ||
                            item.rejected_by ||
                            item.rejectedBy ||
                            'Admin'}
                        </span>{' '}
                        {item.rejected_at || item.rejectedAt
                          ? `on ${new Date(item.rejected_at || item.rejectedAt || '').toLocaleString()}`
                          : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contextual Action Bar */}
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E2E8F0] pt-3">
              {isV2 ? (
                <>
                  {/* New Draft is already queued; Admin can approve or reject. */}
                  {item.status === 'Draft' && isAdmin && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsRejectModalOpen(true)}
                        className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                        data-testid="drawer-reject-btn"
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1 text-rose-600" />
                        Reject
                      </Button>
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
                        className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="drawer-direct-approve-btn"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Direct Approve
                      </Button>
                    </>
                  )}

                  {/* Approved -> Prepare Payment (Accounting / Admin) */}
                  {item.status === 'Approved' && canFund && (
                    <>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => setIsFundModalOpen(true)}
                        className="text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-medium"
                        data-testid="drawer-fund-btn"
                      >
                        <DollarSign className="h-3.5 w-3.5 mr-1" />
                        Prepare Payment
                      </Button>
                    </>
                  )}

                  {/* Funded -> Sanction Payment Release (Admin including preparer) */}
                  {item.status === 'Funded' && isAdmin && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsRejectModalOpen(true)}
                        className="text-xs text-rose-600 border-rose-200 hover:bg-rose-50"
                        data-testid="drawer-reject-btn"
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1 text-rose-600" />
                        Reject
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        title="Sanction payment release"
                        onClick={() => setIsReleaseModalOpen(true)}
                        className="text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        data-testid="drawer-release-btn"
                      >
                        <DollarSign className="h-3.5 w-3.5 mr-1" />
                        Sanction Release
                      </Button>
                    </>
                  )}

                  {/* Rejected -> Return to Draft (Admin) */}
                  {item.status === 'Rejected' && isAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleResendDraft}
                      className="text-xs text-[#1E40AF] border-[#93C5FD] hover:bg-[#EFF6FF]"
                      data-testid="drawer-resend-draft-btn"
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Return to Draft for Correction
                    </Button>
                  )}

                  {/* Released -> Archive/Restore */}
                  {item.status === 'Released' && (
                    <>
                      {isAdmin &&
                        (item.archived || item.archived_at || item.archivedAt ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleRestore}
                            className="text-xs border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC]"
                            data-testid="drawer-unarchive-btn"
                          >
                            <ArchiveRestore className="h-3.5 w-3.5 mr-1 text-[#475569]" />
                            Restore Voucher
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleArchive}
                            className="text-xs border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC]"
                            data-testid="drawer-archive-btn"
                          >
                            <Archive className="h-3.5 w-3.5 mr-1 text-[#475569]" />
                            Archive Voucher
                          </Button>
                        ))}
                    </>
                  )}
                </>
              ) : null}

              {/* Print Voucher Action (available even on legacy records) */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsPrintModalOpen(true)}
                className="text-xs font-medium border-[#E2E8F0]"
                data-testid="drawer-print-btn"
              >
                <Printer className="h-3.5 w-3.5 mr-1 text-[#475569]" />
                Print Voucher
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="text-xs ml-auto"
              >
                Close
              </Button>
            </div>
          </div>
        )}

        {item && canEditVoucher && isEditModalOpen && (
          <DisbursementEditModal
            isOpen
            disbursement={item}
            onClose={() => setIsEditModalOpen(false)}
          />
        )}
        {/* Print Modal */}
        {item && (
          <DisbursementPrintModal
            isOpen={isPrintModalOpen}
            disbursement={item}
            onClose={() => setIsPrintModalOpen(false)}
          />
        )}

        {/* Fund Modal (Approved -> Funded payment preparation) */}
        {item && (
          <FundDisbursementModal
            isOpen={isFundModalOpen}
            disbursement={item}
            onClose={() => setIsFundModalOpen(false)}
          />
        )}

        {/* Release Modal (Funded -> Released payment sanction) */}
        {item && (
          <ReleaseFundsModal
            isOpen={isReleaseModalOpen}
            disbursement={item}
            onClose={() => setIsReleaseModalOpen(false)}
          />
        )}

        {/* Reject Modal */}
        {item && (
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

        {/* Conflict Resolution Modal */}
        <ConflictResolutionModal
          isOpen={conflictModalState.isOpen}
          onClose={() => setConflictModalState({ isOpen: false })}
          error={conflictModalState.error as ApiError | Error | null}
          entityTitle={voucher?.disbursement_number || effectiveId || undefined}
          entityType="Disbursement"
          expectedVersion={voucher?.version}
          attemptedStatus={conflictModalState.attemptedStatus ?? undefined}
          currentStatus={voucher?.status}
          onRefreshAndKeepLatest={async () => {
            if (effectiveId) {
              await queryClient.invalidateQueries({ queryKey: disbursementKeys.detail(effectiveId) });
            }
            await queryClient.invalidateQueries({ queryKey: disbursementKeys.lists() });
          }}
        />

        {/* Admin Direct Approval Modal */}
        {item && isApprovalModalOpen && (
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
