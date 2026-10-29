import { DisbursementEditModal } from './DisbursementEditModal';
import { DisbursementCodingDefinitionList } from './workspace/DisbursementCodingGrid';
import { useState, useEffect, useRef } from 'react';
import { useLiveModalContext } from '../lib/useLiveModalContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  User,
  ShieldCheck,
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
import { EditPaymentDetailsModal } from './EditPaymentDetailsModal';
import { ReceiptViewer } from './ReceiptViewer';
import { DisbursementAuditTimeline } from './DisbursementAuditTimeline';
import { useWorkRequestDetail } from '@/features/operations/api/useWorkRequests';
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

export const VALID_DETAIL_TABS = ['attachment', 'information', 'approval', 'payment', 'log'] as const;
export type DisbursementDetailTab = (typeof VALID_DETAIL_TABS)[number];
export const DETAIL_TAB_STORAGE_KEY = 'disb.detailTab';

export function getInitialDetailTab(hasReceipt: boolean): DisbursementDetailTab {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const stored = window.sessionStorage.getItem(DETAIL_TAB_STORAGE_KEY);
      if (stored && (VALID_DETAIL_TABS as readonly string[]).includes(stored)) {
        return stored as DisbursementDetailTab;
      }
    }
  } catch {
    // ignore
  }
  return hasReceipt ? 'attachment' : 'information';
}

export interface DisbursementDetailBodyProps {
  id?: string | null;
  initialDisbursement?: Disbursement | null;
  isOpen?: boolean;
  onClose?: () => void;
  isDocked?: boolean;
  isMobileSheet?: boolean;
}

export function DisbursementDetailBody({
  id,
  initialDisbursement,
  isOpen = true,
  onClose = () => {},
  isDocked = false,
  isMobileSheet = false,
}: DisbursementDetailBodyProps) {
  const queryClient = useQueryClient();
  const user = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const isAdmin = user?.role === 'Admin';
  const canFund =
    isAdmin || user?.role === 'Accounting' || Boolean(user?.departments?.includes('Accounting'));
  const isDocumentation =
    user?.role === 'Documentation' || Boolean(user?.departments?.includes('Documentation'));

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
  const [isPaymentEditModalOpen, setIsPaymentEditModalOpen] = useState(false);
  const [conflictModalState, setConflictModalState] = useState<{
    isOpen: boolean;
    error?: unknown;
    attemptedStatus?: string | null;
  }>({ isOpen: false });

  const hasReceipt = Boolean(
    item?.receipt_filename ||
      item?.receiptFilename ||
      item?.receipt_s3_key ||
      item?.receiptS3Key
  );

  const [activeTab, setActiveTab] = useState<DisbursementDetailTab>(() =>
    isDocked ? 'attachment' : getInitialDetailTab(hasReceipt)
  );

  // Sync tab on voucher change or when receipt status becomes known
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const stored = window.sessionStorage.getItem(DETAIL_TAB_STORAGE_KEY);
        if (stored && (VALID_DETAIL_TABS as readonly string[]).includes(stored)) {
          setActiveTab(stored as DisbursementDetailTab);
          return;
        }
      }
    } catch {
      // ignore
    }
    setActiveTab(isDocked ? 'attachment' : (hasReceipt ? 'attachment' : 'information'));
  }, [effectiveId, hasReceipt, isDocked]);

  const handleTabChange = (val: string) => {
    if ((VALID_DETAIL_TABS as readonly string[]).includes(val)) {
      const nextTab = val as DisbursementDetailTab;
      setActiveTab(nextTab);
      try {
        if (typeof window !== 'undefined' && window.sessionStorage) {
          window.sessionStorage.setItem(DETAIL_TAB_STORAGE_KEY, nextTab);
        }
      } catch {
        // ignore
      }
    }
  };

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
      hasReceipt,
    entity: item?.entity_code || (item as unknown as { entityCode?: string })?.entityCode || undefined,
  });

  useEffect(() => {
    setIsEditModalOpen(false);
    setIsInlineEditing(false);
    setIsReleaseModalOpen(false);
    setIsFundModalOpen(false);
    setIsRejectModalOpen(false);
    setIsApprovalModalOpen(false);
    setIsPrintModalOpen(false);
    setIsPaymentEditModalOpen(false);
    setConflictModalState({ isOpen: false });
  }, [effectiveId, isOpen, user?.id, activeEntity]);

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
  const canEditLinksPostDraft =
    isV2 &&
    item?.status !== 'Rejected' &&
    item?.status !== 'Cancelled' &&
    (isAdmin || canFund || isDocumentation || isOwnRequest);
  const canEditVoucher =
    hasVersion &&
    !item?.archived &&
    (isAdmin ||
      canEditLinksPostDraft ||
      (canFund && isV2 && item?.status === 'Draft') ||
      (isV2 && isOwnRequest && item?.status === 'Draft' && !item?.archived));
  const isNeedsCorrection = item?.status === 'Draft' && item?.review_ready === false;

  const linkedInvNumber =
    item?.linked_invoice_summary?.invoice_number ||
    item?.linked_invoice_number ||
    item?.linked_invoice?.invoice_number ||
    null;
  const linkedInvStatus =
    item?.linked_invoice_summary?.status ||
    item?.linked_invoice_status ||
    item?.linked_invoice?.status ||
    null;
  const linkedInvBalance =
    item?.linked_invoice_summary?.balance ??
    item?.linked_invoice_balance ??
    item?.linked_invoice?.balance ??
    null;
  const linkedTrNumber =
    item?.linked_transmittal_summary?.tracking_number ||
    item?.linked_transmittal_tracking_number ||
    item?.linked_transmittal?.tracking_number ||
    null;
  const linkedTrStatus =
    item?.linked_transmittal_summary?.status ||
    item?.linked_transmittal_status ||
    item?.linked_transmittal?.status ||
    null;
  const linkedTrRecipient =
    item?.linked_transmittal_summary?.recipient_name ||
    item?.linked_transmittal_recipient_name ||
    item?.linked_transmittal?.recipient_name ||
    null;

  const isClientFundVerified = linkedInvStatus === 'Paid';
  const showSopClientFundWarning =
    (item?.fund_source ||
      item?.fundSource ||
      item?.source_of_funds ||
      item?.sourceOfFunds) === 'Client Fund' &&
    item?.status !== 'Rejected' &&
    item?.status !== 'Cancelled' &&
    !isClientFundVerified;

  const disbNumber =
    item?.disbursement_number ||
    item?.disbursementNumber ||
    (item ? `DISB-${item.id.slice(0, 8)}` : '');
  const clientName =
    item?.client_name || item?.clientName || item?.clients?.name || 'Firm Internal';
  const workRequestId = item?.linked_work_request_id || item?.linkedWorkRequestId;
  const rawItemWrName = item?.linked_work_request_name;
  const isWrNameUuid = Boolean(
    rawItemWrName &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawItemWrName.trim())
  );
  const hasValidItemWrName = Boolean(rawItemWrName && !isWrNameUuid);

  const { data: linkedWrDetail } = useWorkRequestDetail(workRequestId ?? undefined, {
    enabled: Boolean(isOpen && canFetchChildren && workRequestId && !hasValidItemWrName),
  });

  const effectiveWrOrder =
    item?.linked_work_request_order_number ||
    linkedWrDetail?.work_order_number ||
    null;
  const effectiveWrName =
    (hasValidItemWrName ? rawItemWrName : null) ||
    linkedWrDetail?.title ||
    null;

  if (isScopeStale || (isOpen !== undefined && !isOpen)) return null;

  return (
    <div
      className={cn('min-w-0', isDocked ? 'w-full h-full flex flex-col overflow-hidden text-xs text-ink' : 'space-y-4 text-xs text-ink')}
      data-testid="disbursement-detail-body"
    >
      {isDenied ? (
        <div className="py-16 text-center space-y-3" data-testid="disbursement-access-denied">
          <div className="w-12 h-12 rounded-full bg-sidebar mx-auto flex items-center justify-center border border-border">
            <Lock className="w-6 h-6 text-placeholder" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-ink">Access Not Available</h3>
            <p className="text-xs text-muted max-w-xs mx-auto">
              You do not have access to this disbursement voucher or access has been revoked.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="mt-2 text-xs min-h-[40px] px-3 cursor-pointer"
            data-testid="disbursement-access-denied-close-btn"
          >
            Close
          </Button>
        </div>
      ) : (
        <>
          {/* Top Voucher Header Block: Rendered when !isDocked (e.g. mobile drawer/modal sheet). On desktop docked view, omitted per eyeshare layout */}
          {!isDocked && (
            <div className="border-b border-border pb-3">
              <div className="flex items-center justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-base font-bold text-ink truncate font-mono">
                      {disbNumber || 'Disbursement Details'}
                    </h2>
                    {item && (
                      <DisbursementStatusBadge
                        status={item.status}
                        reviewReady={item.review_ready}
                      />
                    )}
                    {item?.entity_code && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-[6px] bg-canvas text-muted border border-border">
                        {item.entity_code}
                      </span>
                    )}
                    {effectiveId && (
                      <PresenceAvatars domain="disbursement" roomId={effectiveId} maxAvatars={4} />
                    )}
                  </div>
                  <p className="text-xs text-muted">
                    Created on{' '}
                    {item?.created_at || item?.createdAt
                      ? new Date(item.created_at || item.createdAt || '').toLocaleString()
                      : 'N/A'}
                  </p>
                </div>
                {item && (
                  <div className="text-right shrink-0">
                    <span
                      className="text-lg font-bold text-ink block font-mono tabular-nums"
                      data-testid="drawer-amount"
                    >
                      ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs text-text-secondary font-medium">
                      {item.fund_source || item.fundSource}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Desktop docked presence observer and drawer amount (when header is hidden) */}
          {isDocked && (
            <div className="sr-only">
              {item && (
                <>
                  <span data-testid="drawer-voucher-number">{disbNumber}</span>
                  <span data-testid="drawer-amount">
                    ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                  </span>
                </>
              )}
              {effectiveId && <PresenceAvatars domain="disbursement" roomId={effectiveId} maxAvatars={1} />}
            </div>
          )}

          {isLoading || !item ? (
            <div className="py-12 text-center text-xs text-muted" data-testid="drawer-loading">
              Loading disbursement details...
            </div>
          ) : (
            <div className={cn(isDocked ? 'flex-1 min-h-0 flex flex-col overflow-hidden text-xs text-ink' : 'space-y-4 text-xs text-ink')}>
              {/* Urgent Status Banners (visible at top of detail pane) */}
              {isNeedsCorrection && (
                <div
                  className="p-3 bg-warning-surface border border-warning-border rounded-[8px] text-warning space-y-1"
                  data-testid="drawer-needs-correction-banner"
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs">
                    <AlertCircle className="h-4 w-4 text-warning shrink-0" />
                    <span>Returned for Requester Correction</span>
                  </div>
                  <p className="text-xs text-warning">
                    This voucher was returned to Draft. Requester must edit and correct this request
                    before it can be reviewed or approved.
                  </p>
                </div>
              )}

              {item.status === 'Rejected' && (
                <div
                  className="p-3 bg-danger-surface border border-danger-border rounded-[6px] text-danger space-y-1"
                  data-testid="drawer-rejection-banner"
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs text-danger">
                    <AlertCircle className="h-4 w-4 text-danger-solid shrink-0" />
                    <span>Voucher Rejected</span>
                  </div>
                  <p
                    className="text-xs text-danger whitespace-pre-wrap pl-5"
                    data-testid="drawer-rejection-reason"
                  >
                    {item.rejection_reason || item.rejectionReason || 'No reason specified.'}
                  </p>
                  {(item.rejected_by_name ||
                    item.rejected_by ||
                    item.rejectedBy ||
                    item.rejected_at ||
                    item.rejectedAt) && (
                    <div className="text-xs text-danger pl-5">
                      By {item.rejected_by_name || item.rejected_by || item.rejectedBy || 'Admin'} on{' '}
                      {item.rejected_at || item.rejectedAt
                        ? new Date(item.rejected_at || item.rejectedAt || '').toLocaleString()
                        : 'N/A'}
                    </div>
                  )}
                </div>
              )}

              {(item.edited_by_accounting || item.notes?.includes('Edited by Accounting')) && (
                <div
                  className="p-3 bg-warning-surface border border-warning-border rounded-[6px] flex items-center gap-2 text-xs text-warning"
                  data-testid="modified-by-accounting-banner"
                >
                  <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                  <div>
                    <span className="font-semibold block">Modified by Accounting:</span>
                    <span>Financial amounts or details were adjusted during voucher preparation.</span>
                  </div>
                </div>
              )}

              {showSopClientFundWarning && (
                <div
                  className="p-3 bg-warning-surface border border-warning-border rounded-[6px] text-warning space-y-1"
                  data-testid="sop-step-2-5-warning-banner"
                >
                  <div className="flex items-center gap-1.5 font-bold text-xs text-warning">
                    <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                    <span>SOP Step 2.5 Control Point — Client Fund Verification</span>
                  </div>
                  <p className="text-xs text-warning pl-5">
                    {linkedInvNumber || item.linked_invoice_id || item.linkedInvoiceId ? (
                      <>
                        Linked Invoice{' '}
                        <span className="font-mono font-semibold">
                          {linkedInvNumber || item.linked_invoice_id || item.linkedInvoiceId}
                        </span>{' '}
                        is currently &ldquo;{linkedInvStatus || 'Unpaid'}&rdquo;
                        {linkedInvBalance !== null && linkedInvBalance !== undefined
                          ? ` (Unpaid Balance: ₱${Number(linkedInvBalance).toLocaleString('en-PH', {
                              minimumFractionDigits: 2,
                            })})`
                          : ''}
                        . Verify client payment or standing arrangement before releasing funds.
                      </>
                    ) : (
                      'This voucher uses Client Fund but has no Paid Client Invoice linked yet. Link the client invoice or verify standing arrangement before releasing funds.'
                    )}
                  </p>
                </div>
              )}

              {/* Eyeshare-Style Unified Tab Strip (TOKENS.md §4.3) */}
              <Tabs value={activeTab} onValueChange={handleTabChange} className={cn('w-full', isDocked && 'flex-1 min-h-0 flex flex-col')}>
                <TabsList className="w-full justify-start rounded-none bg-table-header px-1 py-0.5 border-b border-border flex flex-nowrap overflow-x-auto scrollbar-none gap-0.5 h-7 shrink-0">
                  <TabsTrigger
                    value="attachment"
                    onClick={() => handleTabChange('attachment')}
                    className="rounded-[3px] px-1.5 py-0 text-[11px] font-medium text-muted hover:text-ink hover:bg-hover/60 data-[state=active]:bg-surface data-[state=active]:text-primary-dark data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 h-5.5 flex items-center gap-1"
                    data-testid="tab-attachment"
                  >
                    <Receipt className="h-3 w-3 shrink-0" />
                    <span>Attachment</span>
                    <span className="rounded-xs px-1 py-0 text-[10px] font-mono tabular-nums bg-hover text-ink data-[state=active]:bg-primary-light data-[state=active]:text-primary-dark ml-0.5">
                      {hasReceipt ? 1 : 0}
                    </span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="information"
                    onClick={() => handleTabChange('information')}
                    className="rounded-[3px] px-1.5 py-0 text-[11px] font-medium text-muted hover:text-ink hover:bg-hover/60 data-[state=active]:bg-surface data-[state=active]:text-primary-dark data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 h-5.5 flex items-center gap-1"
                    data-testid="tab-information"
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span>Information</span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="approval"
                    onClick={() => handleTabChange('approval')}
                    className="rounded-[3px] px-1.5 py-0 text-[11px] font-medium text-muted hover:text-ink hover:bg-hover/60 data-[state=active]:bg-surface data-[state=active]:text-primary-dark data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 h-5.5 flex items-center gap-1"
                    data-testid="tab-approval"
                  >
                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                    <span>Approval</span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="payment"
                    onClick={() => handleTabChange('payment')}
                    className="rounded-[3px] px-1.5 py-0 text-[11px] font-medium text-muted hover:text-ink hover:bg-hover/60 data-[state=active]:bg-surface data-[state=active]:text-primary-dark data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 h-5.5 flex items-center gap-1"
                    data-testid="tab-payment"
                  >
                    <DollarSign className="h-3 w-3 shrink-0" />
                    <span>Payment</span>
                  </TabsTrigger>

                  <TabsTrigger
                    value="log"
                    onClick={() => handleTabChange('log')}
                    className="rounded-[3px] px-1.5 py-0 text-[11px] font-medium text-muted hover:text-ink hover:bg-hover/60 data-[state=active]:bg-surface data-[state=active]:text-primary-dark data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 h-5.5 flex items-center gap-1"
                    data-testid="tab-log"
                  >
                    <Clock className="h-3 w-3 shrink-0" />
                    <span>Log</span>
                  </TabsTrigger>
                </TabsList>

                {/* Tab 1: Attachment */}
                <TabsContent value="attachment" data-testid="tab-content-attachment" className={cn(isDocked ? "mt-0 flex-1 min-h-0 overflow-y-auto flex flex-col p-1.5 data-[state=inactive]:hidden" : "mt-4 space-y-3 data-[state=inactive]:hidden")}>
                  <ReceiptViewer
                    key={`${item.id}:${item.receipt_s3_key || item.receiptS3Key || item.receipt_filename || item.receiptFilename || ''}`}
                    receiptFileName={item.receipt_filename || item.receiptFilename}
                    receiptS3Key={item.receipt_s3_key || item.receiptS3Key}
                    receiptData={receiptData}
                    isLoadingReceipt={isLoadingReceipt}
                    isFetchingReceipt={isFetchingReceipt}
                    isReceiptError={isReceiptError}
                    receiptError={receiptError}
                    onRefetchReceiptUrl={refetchReceiptUrl}
                    workRequestTitle={effectiveWrName}
                    isDocked={isDocked}
                  />
                </TabsContent>

                {/* Tab 2: Information */}
                <TabsContent value="information" data-testid="tab-content-information" className={cn(isDocked ? "mt-0 flex-1 min-h-0 overflow-y-auto space-y-1.5 p-2 text-[11px] data-[state=inactive]:hidden" : "mt-4 space-y-4 data-[state=inactive]:hidden")}>
                  {/* Voucher Editing Entry Points */}
                  {canEditVoucher && (
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsEditModalOpen(true)}
                          className="min-h-[40px] px-3 text-xs font-medium text-ink bg-surface border-border hover:bg-hover flex items-center gap-1.5 cursor-pointer"
                          data-testid="edit-disbursement-button"
                        >
                          <Pencil className="w-4 h-4 text-primary" />
                          <span>
                            {isV2 && item.status === 'Draft'
                              ? 'Edit Voucher'
                              : isAdmin
                                ? 'Edit Printed Details'
                                : 'Edit Linked Records'}
                          </span>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setIsInlineEditing(!isInlineEditing)}
                          className="min-h-[40px] px-3 text-xs font-medium text-ink bg-surface border-border hover:bg-hover flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>{isInlineEditing ? 'Close inline editor' : 'Edit inline'}</span>
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

                  {/* Below 1024px: eyeshare Accounting Coding Definition List (read-only; edits through Edit modal) */}
                  {isMobileSheet && (
                    <div
                      className="space-y-2"
                      data-testid="sheet-coding-section"
                    >
                      <h4 className="font-semibold text-ink text-xs uppercase tracking-wider">
                        Accounting Coding
                      </h4>
                      <DisbursementCodingDefinitionList
                        disbursement={item}
                        wrName={effectiveWrName}
                        wrOrder={effectiveWrOrder}
                      />
                    </div>
                  )}

                  {/* General Voucher Info Section (Billing-style compressed dl grid) */}
                  <div className="bg-canvas p-2.5 rounded-[6px] border border-border space-y-1.5 text-xs">
                    <span className="font-bold text-[10px] text-text-secondary tracking-wider uppercase">
                      Voucher Information
                    </span>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Voucher Ref</dt>
                        <dd className="font-semibold text-ink font-mono text-xs" data-testid="detail-voucher-number">
                          Voucher #<span>{disbNumber}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Amount</dt>
                        <dd
                          className="font-bold text-ink font-mono tabular-nums text-xs"
                          data-testid="info-tab-amount"
                        >
                          ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Entity</dt>
                        <dd className="font-semibold text-ink text-xs">{item.entity_code || item.entityCode || 'ATA'}</dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Category</dt>
                        <dd className="font-semibold text-ink text-xs">{item.category}</dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Fund Source</dt>
                        <dd className="font-semibold text-ink text-xs">{item.fund_source || item.fundSource}</dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Due Date</dt>
                        <dd className="text-ink flex items-center gap-1 font-mono text-xs">
                          <Calendar className="h-3 w-3 text-muted shrink-0" />
                          <span>{item.due_date || item.dueDate || 'No due date'}</span>
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Parties & Personnel (Billing-style compressed dl grid) */}
                  <div className="bg-surface p-2.5 rounded-[6px] border border-border space-y-1.5 text-xs shadow-2xs">
                    <span className="font-bold text-[10px] text-text-secondary tracking-wider uppercase">
                      Parties & Personnel
                    </span>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Client Association</dt>
                        <dd className="font-semibold text-ink text-xs flex items-center gap-1.5 flex-wrap">
                          <Building className="h-3.5 w-3.5 text-muted shrink-0" />
                          {Boolean(item.clientNumber || item.client_number || item.clients?.clientNumber || item.clients?.client_number) && (
                            <span className="font-mono text-xs font-medium text-text-secondary tabular-nums bg-canvas border border-border px-1 py-0.2 rounded">
                              {item.clientNumber || item.client_number || item.clients?.clientNumber || item.clients?.client_number}
                            </span>
                          )}
                          <span className="truncate">{clientName}</span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Assigned Employee</dt>
                        <dd className="font-semibold text-ink text-xs flex items-center gap-1">
                          <User className="h-3.5 w-3.5 text-muted shrink-0" />
                          <span className="truncate">{item.employee_name || item.employeeName || 'None'}</span>
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted text-[10px] uppercase font-medium">Requester / Prepared By</dt>
                        <dd className="text-ink flex items-center gap-1 font-medium text-xs">
                          <User className="h-3.5 w-3.5 text-muted shrink-0" />
                          <span className="truncate">
                            {item.created_by_name ||
                              item.createdByName ||
                              item.requested_by_name ||
                              item.requestedByName ||
                              item.employee_name ||
                              item.requested_by ||
                              item.created_by ||
                              'User'}
                          </span>
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Linkages Grid (Billing-style compressed dl grid) */}
                  <div className="bg-canvas p-2.5 rounded-[6px] border border-border space-y-1.5 text-xs">
                    <span className="font-bold text-[10px] text-text-secondary tracking-wider uppercase">
                      Linked Records
                    </span>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div className="col-span-2">
                        <dt className="text-muted text-[10px] uppercase font-medium">Linked Work Request</dt>
                        <dd
                          className="text-ink flex items-center gap-1.5 font-medium text-xs flex-wrap"
                          data-testid="drawer-work-request"
                        >
                          <FileText className="h-3.5 w-3.5 text-muted shrink-0" />
                          {Boolean(item.workRequestNumber || item.work_request_number) && (
                            <span className="font-mono text-xs font-medium text-text-secondary tabular-nums bg-canvas border border-border px-1 py-0.2 rounded">
                              {item.workRequestNumber || item.work_request_number}
                            </span>
                          )}
                          <span className="truncate">
                            {effectiveWrOrder && effectiveWrName
                              ? `${effectiveWrOrder} — ${effectiveWrName}`
                              : effectiveWrName ||
                                effectiveWrOrder ||
                                (workRequestId ? '—' : 'None')}
                          </span>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Linked Task</dt>
                        <dd className="text-ink font-mono text-xs" data-testid="drawer-linked-task">
                          {item.linked_task_title || item.linked_task_id || item.linkedTaskId || 'None'}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted text-[10px] uppercase font-medium">Linked Invoice</dt>
                        <dd
                          className="text-ink font-mono text-xs flex items-center gap-1.5 flex-wrap"
                          data-testid="drawer-linked-invoice"
                        >
                          {linkedInvNumber || item.linked_invoice_id || item.linkedInvoiceId ? (
                            <>
                              <span className="font-semibold">
                                {linkedInvNumber || item.linked_invoice_id || item.linkedInvoiceId}
                              </span>
                              {linkedInvStatus && (
                                <span
                                  className={cn(
                                    'px-1.5 py-0.5 rounded-[4px] text-[10px] font-sans font-semibold border',
                                    linkedInvStatus === 'Paid' || linkedInvStatus === 'Partially Paid'
                                      ? 'bg-success-surface text-success border-success-border'
                                      : 'bg-warning-surface text-warning border-warning-border'
                                  )}
                                  data-testid="drawer-linked-invoice-status"
                                >
                                  {linkedInvStatus}
                                </span>
                              )}
                              {linkedInvBalance !== null && linkedInvBalance !== undefined && (
                                <span className="text-[11px] text-muted font-sans">
                                  (Bal: ₱
                                  {Number(linkedInvBalance).toLocaleString('en-PH', {
                                    minimumFractionDigits: 2,
                                  })}
                                  )
                                </span>
                              )}
                            </>
                          ) : (
                            'None'
                          )}
                        </dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="text-muted text-[10px] uppercase font-medium">Linked Transmittal</dt>
                        <dd
                          className="text-ink font-mono text-xs flex items-center gap-1.5 flex-wrap"
                          data-testid="drawer-linked-transmittal"
                        >
                          {linkedTrNumber || item.linked_transmittal_id || item.linkedTransmittalId ? (
                            <>
                              <span className="font-semibold">
                                {linkedTrNumber || item.linked_transmittal_id || item.linkedTransmittalId}
                              </span>
                              {linkedTrStatus && (
                                <span
                                  className="px-1.5 py-0.5 rounded-[4px] text-[10px] font-sans font-semibold bg-canvas text-ink border border-border"
                                  data-testid="drawer-linked-transmittal-status"
                                >
                                  {linkedTrStatus}
                                </span>
                              )}
                              {linkedTrRecipient && (
                                <span className="text-[11px] text-muted font-sans">
                                  — {linkedTrRecipient}
                                </span>
                              )}
                            </>
                          ) : (
                            'None'
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>

                  {/* Expense Description & Internal Notes */}
                  <div className="bg-surface p-2.5 rounded-[6px] border border-border space-y-1.5 text-xs shadow-2xs">
                    <span className="font-bold text-[10px] text-text-secondary tracking-wider uppercase">
                      Expense Description
                    </span>
                    <p className="text-xs text-ink whitespace-pre-wrap">
                      {item.description}
                    </p>
                    {item.notes && (
                      <div className="pt-2 border-t border-border/60">
                        <span className="font-bold text-[10px] text-text-secondary tracking-wider uppercase block mb-0.5">
                          Internal Notes
                        </span>
                        <p className="text-xs text-muted whitespace-pre-wrap">
                          {item.notes}
                        </p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Tab 3: Approval */}
                <TabsContent value="approval" data-testid="tab-content-approval" className={cn(isDocked ? "mt-0 flex-1 min-h-0 overflow-y-auto space-y-1.5 p-2 text-[11px] data-[state=inactive]:hidden" : "mt-4 space-y-4 data-[state=inactive]:hidden")}>
                  {/* Approval Review Status Card */}
                  <div className="p-3.5 bg-surface rounded-md border border-border space-y-3 shadow-soft">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                        Approval State
                      </span>
                      <DisbursementStatusBadge
                        status={item.status}
                        reviewReady={item.review_ready}
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-muted block">Review Readiness:</span>
                        <span className="font-medium text-ink">
                          {item.review_ready ? 'Ready for Review' : 'Needs Correction / Draft'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block">Governance Version:</span>
                        <span className="font-medium text-ink font-mono">
                          v{item.lifecycle_version || 1} (OCC rev {item.version})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Decision Sign-off Information */}
                  <div className="p-3.5 bg-canvas rounded-md border border-border space-y-3">
                    <h4 className="font-semibold text-ink text-xs flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <span>Authorization Records</span>
                    </h4>

                    {(item.approved_by_name || item.approved_by || item.approvedBy) && (
                      <div className="p-3 bg-success-surface border border-success-border rounded-[6px] space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-success">
                          <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                          <span>Approved by Admin</span>
                        </div>
                        <p className="text-xs text-success">
                          Authorized by{' '}
                          <span className="font-semibold">
                            {item.approved_by_name || item.approved_by || item.approvedBy}
                          </span>{' '}
                          on{' '}
                          {item.approved_at || item.approvedAt
                            ? new Date(item.approved_at || item.approvedAt || '').toLocaleString()
                            : 'N/A'}
                        </p>
                      </div>
                    )}

                    {item.status === 'Rejected' && (
                      <div className="p-3 bg-danger-surface border border-danger-border rounded-[6px] space-y-1">
                        <div className="flex items-center gap-1.5 font-bold text-xs text-danger">
                          <XCircle className="h-4 w-4 text-danger-solid shrink-0" />
                          <span>Rejection Justification</span>
                        </div>
                        <p className="text-xs text-danger whitespace-pre-wrap">
                          {item.rejection_reason || item.rejectionReason || 'No reason specified.'}
                        </p>
                        <p className="text-xs text-danger">
                          Recorded by{' '}
                          <span className="font-semibold">
                            {item.rejected_by_name || item.rejected_by || item.rejectedBy || 'Admin'}
                          </span>{' '}
                          on{' '}
                          {item.rejected_at || item.rejectedAt
                            ? new Date(item.rejected_at || item.rejectedAt || '').toLocaleString()
                            : 'N/A'}
                        </p>
                      </div>
                    )}

                    {!item.approved_at && !item.approvedAt && item.status !== 'Rejected' && (
                      <p className="text-xs text-muted">
                        This voucher is currently awaiting partner approval. Once approved, payment
                        preparation will unlock for accounting.
                      </p>
                    )}
                  </div>
                </TabsContent>

                {/* Tab 4: Payment */}
                <TabsContent value="payment" data-testid="tab-content-payment" className={cn(isDocked ? "mt-0 flex-1 min-h-0 overflow-y-auto space-y-1.5 p-2 text-[11px] data-[state=inactive]:hidden" : "mt-4 space-y-4 data-[state=inactive]:hidden")}>
                  <div className="p-3.5 bg-surface rounded-md border border-border space-y-3 shadow-soft">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold text-ink text-xs flex items-center gap-1.5">
                        <DollarSign className="h-4 w-4 text-primary" />
                        <span>Payment Release Details</span>
                      </h4>
                      {(isAdmin || canFund) && (item.status === 'Funded' || item.status === 'Released' || item.payment_method || item.paymentMethod) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsPaymentEditModalOpen(true)}
                          className="min-h-[40px] px-3 text-xs border-border text-ink hover:bg-hover inline-flex items-center gap-1.5 cursor-pointer"
                          data-testid="btn-edit-payment-details"
                        >
                          <Pencil className="h-3.5 w-3.5 text-primary" />
                          <span>Correct Payment Details</span>
                        </Button>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs p-3 bg-canvas rounded-md border border-border">
                      <div className="space-y-0.5">
                        <span className="text-muted block">Payment Method:</span>
                        <span
                          className="font-medium text-ink"
                          data-testid="detail-payment-method"
                        >
                          {item.payment_method || item.paymentMethod || 'N/A'}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-muted block">Payment Reference:</span>
                        <span
                          className="font-medium text-ink font-mono"
                          data-testid="detail-payment-reference"
                        >
                          {item.payment_reference || item.paymentReference || 'N/A'}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-muted block">Bank / Institution:</span>
                        <span className="font-medium text-ink" data-testid="detail-payment-bank">
                          {item.payment_bank || item.paymentBank || 'N/A'}
                        </span>
                      </div>
                      <div className="space-y-0.5">
                        <span className="text-muted block">Payment Date:</span>
                        <span className="font-medium text-ink" data-testid="detail-payment-date">
                          {item.payment_date || item.paymentDate || 'N/A'}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                      <div>
                        <span className="text-muted block">Processed by:</span>
                        <span className="font-medium text-ink">
                          {item.payment_processed_by_name ||
                            item.payment_processed_by ||
                            item.paymentProcessedByName ||
                            item.paymentProcessedBy ||
                            'N/A'}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted block">Funded by:</span>
                        <span className="font-medium text-ink">
                          {item.funded_by_name || item.funded_by || item.fundedBy || 'N/A'}{' '}
                          {item.funded_at || item.fundedAt
                            ? `(${new Date(item.funded_at || item.fundedAt || '').toLocaleDateString()})`
                            : ''}
                        </span>
                      </div>
                      <div className="col-span-2">
                        <span className="text-muted block">Released by:</span>
                        <span className="font-medium text-ink">
                          {item.released_by_name || item.released_by || item.releasedBy || 'N/A'}{' '}
                          {item.released_at || item.releasedAt
                            ? `(${new Date(item.released_at || item.releasedAt || '').toLocaleDateString()})`
                            : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Tab 5: Log */}
                <TabsContent value="log" data-testid="tab-content-log" className={cn(isDocked ? "mt-0 flex-1 min-h-0 overflow-y-auto space-y-1.5 p-2 text-[11px] data-[state=inactive]:hidden" : "mt-4 space-y-3 data-[state=inactive]:hidden")}>
                  <div className="p-3.5 bg-surface rounded-md border border-border space-y-3 shadow-soft">
                    <h4 className="font-semibold text-ink text-xs flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-muted" />
                      <span>Audit & Lifecycle Timeline</span>
                    </h4>

                    <DisbursementAuditTimeline item={item} />
                  </div>
                </TabsContent>
              </Tabs>

              {/* Contextual Action Bar: rendered in sheet/drawer mode (<1024px); on desktop docked view, the action rail covers these actions */}
              {!isDocked && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
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
                            className="min-h-[40px] px-3 text-xs text-danger border-danger-border hover:bg-danger-surface cursor-pointer"
                            data-testid="drawer-reject-btn"
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1 text-danger-solid" />
                            <span>Reject</span>
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
                            className="min-h-[40px] px-3 text-xs bg-success hover:bg-success text-inverse font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            data-testid="drawer-direct-approve-btn"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                            <span>Direct Approve</span>
                          </Button>
                        </>
                      )}

                      {/* Approved -> Prepare Payment (Accounting / Admin) */}
                      {item.status === 'Approved' && canFund && (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => setIsFundModalOpen(true)}
                          className="min-h-[40px] px-3 text-xs bg-primary hover:bg-primary-hover text-inverse font-medium cursor-pointer"
                          data-testid="drawer-fund-btn"
                        >
                          <DollarSign className="h-3.5 w-3.5 mr-1" />
                          <span>Prepare Payment</span>
                        </Button>
                      )}

                      {/* Funded -> Sanction Payment Release (Admin including preparer) */}
                      {item.status === 'Funded' && isAdmin && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setIsRejectModalOpen(true)}
                            className="min-h-[40px] px-3 text-xs text-danger border-danger-border hover:bg-danger-surface cursor-pointer"
                            data-testid="drawer-reject-btn"
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1 text-danger-solid" />
                            <span>Reject</span>
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            title="Sanction payment release"
                            onClick={() => setIsReleaseModalOpen(true)}
                            className="min-h-[40px] px-3 text-xs bg-primary hover:bg-primary-hover text-inverse font-medium disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                            data-testid="drawer-release-btn"
                          >
                            <DollarSign className="h-3.5 w-3.5 mr-1" />
                            <span>Sanction Release</span>
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
                          className="min-h-[40px] px-3 text-xs text-primary-hover border-border hover:bg-primary-light cursor-pointer"
                          data-testid="drawer-resend-draft-btn"
                        >
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                          <span>Return to Draft for Correction</span>
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
                                className="min-h-[40px] px-3 text-xs border-border text-ink hover:bg-hover cursor-pointer"
                                data-testid="drawer-unarchive-btn"
                              >
                                <ArchiveRestore className="h-3.5 w-3.5 mr-1 text-muted" />
                                <span>Restore Voucher</span>
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleArchive}
                                className="min-h-[40px] px-3 text-xs border-border text-ink hover:bg-hover cursor-pointer"
                                data-testid="drawer-archive-btn"
                              >
                                <Archive className="h-3.5 w-3.5 mr-1 text-muted" />
                                <span>Archive Voucher</span>
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
                    className="min-h-[40px] px-3 text-xs font-medium border-border text-ink hover:bg-hover cursor-pointer"
                    data-testid="drawer-print-btn"
                  >
                    <Printer className="h-3.5 w-3.5 mr-1 text-muted" />
                    <span>Print Voucher</span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onClose}
                    className="min-h-[40px] px-3 text-xs ml-auto cursor-pointer"
                  >
                    <span>Close</span>
                  </Button>
                </div>
              )}
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

          {/* Payment Details Edit Modal */}
          {item && (
            <EditPaymentDetailsModal
              isOpen={isPaymentEditModalOpen}
              disbursement={item}
              onClose={() => setIsPaymentEditModalOpen(false)}
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
    </div>
  );
}
