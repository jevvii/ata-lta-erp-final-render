import { getInvoicePrintDetails, resolvePaymentProperties } from '@/lib/printDocuments';
import { PRINT_DETAIL_FIELDS } from '../utils/printDetailFields';
import { useState, useEffect } from 'react';
import {
  Printer,
  CreditCard,
  Archive,
  Trash2,
  Lock,
  Pencil,
  Check,
  X,
  Send,
  CheckCircle,
  XCircle,
  Clock,
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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useInvoiceDetail } from '../api/useInvoices';
import { useScopedRecordGuard } from '@/lib/useScopedRecordGuard';
import {
  updateInvoiceAction,
  updateClientAddressAction,
  archiveInvoiceAction,
  deleteInvoiceAction,
} from '../api/useBillingMutations';
import { InvoiceEditModal } from './InvoiceEditModal';
import { usePermission } from '@/lib/permissions';
import { formatCurrency, getStatusBadgeVariant } from '../utils/formatters';
import { PresenceAvatars } from '@/components/common/PresenceAvatars';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { billingKeys } from '../api/queryKeys';
import { queryClient, type ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import type { Invoice } from '../api/types';

export interface InvoiceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId?: string | null;
  initialInvoice?: Invoice | null;
  onOpenRecordPayment?: (invoice: Invoice) => void;
  onOpenPrintPreview?: (invoice: Invoice) => void;
}

export function InvoiceDetailModal({
  isOpen,
  onClose,
  invoiceId,
  initialInvoice,
  onOpenRecordPayment,
  onOpenPrintPreview,
}: InvoiceDetailModalProps) {
  const effectiveId = invoiceId || initialInvoice?.id;
  const {
    data: fetchedInvoice,
    isError: isInvoiceError,
    error: invoiceError,
    isPlaceholderData: isInvoicePlaceholder,
    refetch,
  } = useInvoiceDetail(effectiveId, {
    enabled: isOpen && !!effectiveId,
  });

  const {
    record: invoice,
    isDenied,
    isScopeStale,
  } = useScopedRecordGuard<Invoice>({
    recordId: effectiveId,
    isOpen,
    onClose,
    queryError: invoiceError,
    isQueryError: isInvoiceError,
    isPlaceholderData: isInvoicePlaceholder,
    liveRecord: fetchedInvoice,
    initialRecord: initialInvoice,
    queryKey: effectiveId ? billingKeys.invoiceDetail(effectiveId) : undefined,
  });

  // Session & Admin Check
  const user = useSessionStore((state) => state.user);
  const isAdmin = user?.role === 'Admin';

  // Permissions
  const canEdit = usePermission('billing:edit');
  const canRequest = usePermission('billing:request');
  const canEditAddress = usePermission('billing:edit_client_address');
  const canPay = usePermission('billing:payments');
  const canDelete = usePermission('billing:delete');

  // Edit Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isInlineEditing, setIsInlineEditing] = useState(false);

  // Address editing state
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const [addressFeedback, setAddressFeedback] = useState<string | null>(null);

  // Notes editing state
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesInput, setNotesInput] = useState('');

  // Conflict resolution modal state for OCC 409 errors
  const [conflictModalState, setConflictModalState] = useState<{
    isOpen: boolean;
    error?: unknown;
    attemptedStatus?: string | null;
  }>({ isOpen: false });

  useEffect(() => {
    if (invoice) {
      setAddressInput(invoice.address ?? invoice.clients?.address ?? '');
      setNotesInput(invoice.notes || '');
    }
    setIsEditingAddress(false);
    setIsEditingNotes(false);
    setAddressFeedback(null);
  }, [invoice]);

  if (isScopeStale || !isOpen) return null;

  if (isDenied) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md p-6 border-[#E2E8F0] bg-[#FFFFFF] shadow-float text-center space-y-3 rounded-[12px]"
          data-testid="invoice-access-denied-dialog"
        >
          <div className="w-12 h-12 rounded-full bg-[#F1F5F9] mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6 text-[#64748B]" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-[#1E293B]">Access Not Available</h3>
            <p className="text-xs text-[#475569] max-w-xs mx-auto">
              You do not have access to this invoice or access has been revoked.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="mt-2 text-xs"
            data-testid="invoice-access-denied-close-btn"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  if (isInvoiceError && !isDenied) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md p-6 border-[#E2E8F0] bg-[#FFFFFF] shadow-float text-center space-y-3 rounded-[12px]"
          data-testid="invoice-detail-error"
        >
          <div className="w-12 h-12 rounded-full bg-red-50 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-base font-bold text-[#1E293B]">
              Unable to Load Invoice Details
            </DialogTitle>
            <DialogDescription className="text-xs text-[#475569] max-w-xs mx-auto">
              Could not retrieve invoice details from the server.
            </DialogDescription>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
              data-testid="invoice-detail-error-close-btn"
            >
              Close
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => void refetch()}
              className="text-xs"
              data-testid="invoice-detail-error-retry-btn"
            >
              Retry
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!invoice) return null;

  const currentAddress = invoice.address ?? invoice.clients?.address ?? 'No address provided';
  const printDetails = getInvoicePrintDetails(invoice);
  const isReleased = ['Sent', 'Approved', 'Partially Paid', 'Overdue'].includes(invoice.status);
  const hasBalance = Number(invoice.balance || 0) > 0;

  const handleSaveAddress = async () => {
    if (!invoice.id) return;
    try {
      await updateClientAddressAction(
        invoice.id,
        addressInput,
        invoice.version,
        invoice.entity_id
      );
      setAddressFeedback(
        'Updated invoice snapshot address only. Master client record remains unchanged.'
      );
      setIsEditingAddress(false);
      refetch();
    } catch (err: unknown) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
        });
        return;
      }
      // Error handled by BlockingActionModal
    }
  };

  const handleSaveNotes = async () => {
    if (!invoice.id) return;
    try {
      await updateInvoiceAction(
        invoice.id,
        { notes: notesInput, expectedVersion: invoice.version },
        invoice.version,
        invoice.entity_id
      );
      setIsEditingNotes(false);
      refetch();
    } catch (err: unknown) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
        });
        return;
      }
      // Error handled by BlockingActionModal
    }
  };

  const handleTransitionStatus = async (targetStatus: 'Draft' | 'Pending' | 'Sent') => {
    if (!invoice.id) return;
    try {
      await updateInvoiceAction(
        invoice.id,
        { status: targetStatus, expectedVersion: invoice.version },
        invoice.version,
        invoice.entity_id
      );
      refetch();
    } catch (err: unknown) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
          attemptedStatus: targetStatus,
        });
        return;
      }
      // Error handled by BlockingActionModal
    }
  };

  const handleArchive = async () => {
    if (!invoice.id) return;
    try {
      await archiveInvoiceAction(invoice.id, invoice.invoice_number, invoice.entity_id);
      onClose();
    } catch (err: unknown) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
          attemptedStatus: 'Archived',
        });
        return;
      }
      // Error handled by BlockingActionModal
    }
  };

  const handleDelete = async () => {
    if (!invoice.id) return;
    try {
      await deleteInvoiceAction(invoice.id, invoice.invoice_number, invoice.entity_id);
      onClose();
    } catch (err: unknown) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflictModalState({
          isOpen: true,
          error: err,
          attemptedStatus: 'Deleted',
        });
        return;
      }
      // Error handled by BlockingActionModal
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto shadow-float rounded-[6px] rounded-[12px] bg-white bg-[#FFFFFF] p-6 border-[#E2E8F0] max-w-3xl border"
        data-testid="invoice-detail-modal"
      >
        <DialogHeader className="border-b border-[#E2E8F0] pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-bold text-[#1E293B] font-mono">
                  {invoice.invoice_number}
                </DialogTitle>
                {invoice.entity_code && (
                  <Badge variant="outline" className="text-xs">
                    {invoice.entity_code}
                  </Badge>
                )}
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-semibold border ${getStatusBadgeVariant(
                    invoice.status
                  )}`}
                  data-testid="detail-status-badge"
                >
                  {invoice.status}
                </span>
                {effectiveId && (
                  <PresenceAvatars domain="invoice" roomId={effectiveId} maxAvatars={4} />
                )}
              </div>
              <p className="text-xs text-[#475569] mt-0.5">
                Created {invoice.created_at?.slice(0, 10)} • Due {invoice.due_date?.slice(0, 10)}
              </p>
              {Boolean(
                invoice.work_request_number ||
                  invoice.workRequestNumber ||
                  invoice.work_request?.workRequestNumber ||
                  invoice.work_request?.workOrderNumber
              ) && (
                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-[#475569] flex-wrap">
                  <span>Work Request:</span>
                  <span className="font-mono text-xs font-medium text-[#475569] tabular-nums bg-[#F8FAFC] border border-[#E2E8F0] px-1 py-0.2 rounded">
                    {invoice.work_request_number ||
                      invoice.workRequestNumber ||
                      invoice.work_request?.workRequestNumber ||
                      invoice.work_request?.workOrderNumber}
                  </span>
                  {(invoice.work_request?.title || invoice.work_request_title) && (
                    <span className="font-medium text-[#1E293B]">
                      {invoice.work_request?.title || invoice.work_request_title}
                    </span>
                  )}
                </div>
              )}
              {Boolean(
                (invoice as { tracking_number?: string | null; trackingNumber?: string | null })
                  .tracking_number ||
                  (invoice as { tracking_number?: string | null; trackingNumber?: string | null })
                    .trackingNumber
              ) && (
                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-[#475569]">
                  <span>Transmittal:</span>
                  <span className="font-mono text-xs font-medium text-[#475569] tabular-nums bg-[#F8FAFC] border border-[#E2E8F0] px-1 py-0.2 rounded">
                    {(invoice as { tracking_number?: string | null; trackingNumber?: string | null })
                      .tracking_number ||
                      (invoice as { tracking_number?: string | null; trackingNumber?: string | null })
                        .trackingNumber}
                  </span>
                </div>
              )}
              {(invoice.work_request?.creatorName || invoice.work_request_creator_name) && (
                <p className="text-xs text-[#475569] mt-0.5" data-testid="invoice-wr-requester">
                  Work Request Requester:{' '}
                  <span className="font-semibold text-[#1E293B]">
                    {invoice.work_request?.creatorName || invoice.work_request_creator_name}
                  </span>
                </p>
              )}
            </div>

            {/* Quick Actions Bar */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenPrintPreview && onOpenPrintPreview(invoice)}
                className="h-8 text-xs gap-1 cursor-pointer"
                data-testid="detail-btn-print-preview"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Preview</span>
              </Button>

              {canPay && isReleased && hasBalance && onOpenRecordPayment && (
                <Button
                  size="sm"
                  onClick={() => onOpenRecordPayment(invoice)}
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 cursor-pointer"
                  data-testid="detail-btn-record-payment"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Record Payment</span>
                </Button>
              )}

              {(isAdmin || (invoice.status === 'Draft' && canEdit)) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditModalOpen(true)}
                  className="h-8 text-xs gap-1 cursor-pointer border-[#E2E8F0] text-[#1E293B] hover:text-[#1E293B]"
                  data-testid="btn-edit-invoice"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit Invoice</span>
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {isAdmin && <div className="px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => setIsInlineEditing(!isInlineEditing)}>
            {isInlineEditing ? 'Close inline editor' : 'Edit inline'}
          </Button>
          {isInlineEditing && <InvoiceEditModal inline isOpen invoice={invoice} onClose={() => setIsInlineEditing(false)} onUpdated={() => void refetch()} />}
        </div>}
        <div className="px-6 py-3 border-t border-slate-100">
          <h3 className="text-sm font-semibold mb-2">Statement details</h3>
          {(!invoice.payments || invoice.payments.length === 0) && (
            <div className="mb-3 p-2.5 bg-slate-50 border border-slate-200 rounded-[6px] text-xs text-slate-600">
              No payments recorded. Payment details appear after a payment is recorded.
            </div>
          )}
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {PRINT_DETAIL_FIELDS.slice(2).map(([key, label]) => (
              <div key={key}>
                <dt className="text-slate-500">
                  {label}
                  {key === 'notedBy' && (
                    <span className="ml-1 text-xs text-slate-600 font-normal">
                      {invoice.print_details &&
                      Object.prototype.hasOwnProperty.call(invoice.print_details, 'notedBy')
                        ? '(override)'
                        : '(template default)'}
                    </span>
                  )}
                  {(key === 'preparedBy' || key === 'receivedBy') && (
                    <span className="ml-1 text-xs text-slate-600 font-normal">
                      {invoice.print_details &&
                      Object.prototype.hasOwnProperty.call(invoice.print_details, key)
                        ? '(override)'
                        : '(manual)'}
                    </span>
                  )}
                </dt>
                <dd className="font-medium whitespace-pre-wrap">{printDetails[key] || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
        {addressFeedback && (
          <div
            className="p-3 bg-emerald-50 border-emerald-200 rounded-[6px] text-xs text-emerald-800 flex items-center justify-between"
            data-testid="detail-address-success-banner"
          >
            <span>{addressFeedback}</span>
            <button
              type="button"
              onClick={() => setAddressFeedback(null)}
              className="text-emerald-600 hover:text-emerald-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 1. Client Snapshot Box */}
        <div
          className="bg-[#F8FAFC] p-4 rounded-[8px] border-[#E2E8F0] space-y-2 text-xs"
          data-testid="detail-client-snapshot"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-xs text-[#475569] tracking-normal">
              CLIENT SNAPSHOT
            </span>

            {canEditAddress ? (
              !isEditingAddress && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingAddress(true);
                    setAddressInput(currentAddress);
                  }}
                  className="text-xs font-semibold text-[#1E293B] hover:text-[#1E293B] flex items-center gap-1 cursor-pointer"
                  data-testid="detail-edit-address-btn"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Edit Snapshot Address</span>
                </button>
              )
            ) : (
              <span
                className="text-xs text-[#475569] flex items-center gap-1"
                title="billing:edit_client_address permission required"
                data-testid="detail-address-locked"
              >
                <Lock className="w-3 h-3" />
                <span>Address Locked</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Boolean(
                  invoice.client_number ||
                    invoice.clientNumber ||
                    invoice.clients?.clientNumber ||
                    invoice.clients?.client_number
                ) && (
                  <span className="font-mono text-xs font-medium text-[#475569] tabular-nums bg-[#F8FAFC] border border-[#E2E8F0] px-1 py-0.2 rounded">
                    {invoice.client_number ||
                      invoice.clientNumber ||
                      invoice.clients?.clientNumber ||
                      invoice.clients?.client_number}
                  </span>
                )}
                <p className="font-bold text-[#1E293B] text-sm">
                  {printDetails.clientName || '—'}
                </p>
              </div>
              {printDetails.clientTin && (
                <p className="text-[#475569] font-mono text-xs mt-0.5">
                  TIN: {printDetails.clientTin}
                </p>
              )}
            </div>

            <div>
              <span className="text-xs text-[#475569] block">Billing Address Snapshot:</span>
              {isEditingAddress ? (
                <div className="space-y-2 mt-1" data-testid="detail-inline-address-editor">
                  <Input
                    value={addressInput}
                    onChange={(e) => setAddressInput(e.target.value)}
                    placeholder="Enter snapshot address..."
                    className="h-8 text-xs bg-white"
                    data-testid="detail-address-input"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      onClick={handleSaveAddress}
                      className="h-6 text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs px-2 cursor-pointer"
                      data-testid="detail-save-address-btn"
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Save Snapshot
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsEditingAddress(false)}
                      className="h-6 text-xs text-[#475569] px-2 cursor-pointer"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </Button>
                  </div>
                  <p className="text-xs text-[#475569] italic">
                    Updated invoice snapshot address only. Master client record remains unchanged.
                  </p>
                </div>
              ) : (
                <p
                  className="text-[#1E293B] text-xs leading-relaxed mt-0.5"
                  data-testid="detail-client-address"
                >
                  {currentAddress}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 2. Line Items Breakdown Table */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-[#1E293B] tracking-normal">
            Line Items Breakdown
          </h4>
          <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden">
            <Table>
              <TableHeader className="bg-[#F8FAFC]">
                <TableRow>
                  <TableHead className="w-12 text-xs font-semibold">#</TableHead>
                  <TableHead className="text-xs font-semibold">Description</TableHead>
                  <TableHead className="w-36 text-xs font-semibold">Category</TableHead>
                  <TableHead className="w-32 text-xs font-semibold text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(invoice.line_items || []).map((item, idx) => (
                  <TableRow key={item.id || idx}>
                    <TableCell className="text-xs text-[#475569] tabular-nums py-2.5">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-[#1E293B] py-2.5">
                      {item.description}
                    </TableCell>
                    <TableCell className="text-xs text-[#475569] py-2.5">
                      {item.type}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums font-medium text-[#1E293B] text-right py-2.5">
                      {formatCurrency(item.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* 3. Financial Totals & Balance Summary */}
        <div className="flex justify-end">
          <div className="w-64 bg-[#F8FAFC] p-3 rounded-[8px] border-[#E2E8F0] text-xs space-y-1.5">
            <div className="flex justify-between text-[#475569]">
              <span>Subtotal:</span>
              <span className="tabular-nums">{formatCurrency(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between font-bold text-[#1E293B] border-t border-[#E2E8F0] pt-1">
              <span>Total Amount:</span>
              <span className="tabular-nums text-sm" data-testid="detail-total-amount">
                {formatCurrency(invoice.total)}
              </span>
            </div>
            <div className="flex justify-between text-[#475569]">
              <span>Amount Paid:</span>
              <span className="tabular-nums text-emerald-600" data-testid="detail-amount-paid">
                {formatCurrency(invoice.amount_paid || 0)}
              </span>
            </div>
            <div className="flex justify-between font-bold text-[#1E293B] border-t border-[#E2E8F0] pt-1">
              <span>Remaining Balance:</span>
              <span
                className={`tabular-nums text-sm ${
                  Number(invoice.balance || 0) > 0 ? 'text-amber-600' : 'text-[#475569]'
                }`}
                data-testid="detail-balance-amount"
              >
                {formatCurrency(invoice.balance)}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Payment History Table */}
        <div className="space-y-2">
          <h4 className="text-xs font-bold text-[#1E293B] tracking-normal">
            Payment History
          </h4>
          {(!invoice.payments || invoice.payments.length === 0) ? (
            <div className="p-4 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-center text-xs text-[#475569]">
              No payments recorded for this invoice yet.
            </div>
          ) : (
            <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden">
              <Table>
                <TableHeader className="bg-[#F8FAFC]">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold">Method</TableHead>
                    <TableHead className="text-xs font-semibold">Reference</TableHead>
                    <TableHead className="text-xs font-semibold">Notes</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.payments.map((p) => {
                    const resolved = resolvePaymentProperties(p);
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs text-[#1E293B] py-2">
                          {p.payment_date?.slice(0, 10)}
                        </TableCell>
                        <TableCell className="text-xs text-[#1E293B] font-medium py-2">
                          {resolved?.method || '—'}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-[#475569] py-2">
                          {resolved?.reference || '—'}
                        </TableCell>
                        <TableCell className="text-xs text-[#475569] py-2">
                          {p.notes || '—'}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums font-bold text-emerald-600 text-right py-2">
                          {formatCurrency(p.amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* 5. Notes & Terms */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-[#E2E8F0]">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#1E293B]">Invoice Notes:</span>
              {(canEdit || canRequest) && !isEditingNotes && (
                <button
                  type="button"
                  onClick={() => setIsEditingNotes(true)}
                  className="text-xs text-[#1E293B] hover:text-[#1E293B] flex items-center gap-1 cursor-pointer"
                  data-testid="edit-notes-btn"
                >
                  <Pencil className="w-2.5 h-2.5" />
                  <span>Edit</span>
                </button>
              )}
            </div>
            {isEditingNotes ? (
              <div className="space-y-1.5">
                <Input
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Notes..."
                  className="h-8 text-xs"
                />
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    onClick={handleSaveNotes}
                    className="h-6 text-xs bg-[#1D4ED8] text-white hover:bg-[#1E40AF] shadow-2xs px-2 cursor-pointer"
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsEditingNotes(false)}
                    className="h-6 text-xs px-2 cursor-pointer"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-[#475569] bg-[#F8FAFC] p-2 rounded-[8px] border-[#E2E8F0] min-h-[36px]">
                {invoice.notes || 'No notes entered.'}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <span className="font-semibold text-[#1E293B]">Payment Terms:</span>
            <p className="text-[#475569] bg-[#F8FAFC] p-2 rounded-[8px] border-[#E2E8F0] min-h-[36px]">
              {invoice.terms || 'Standard 30-day payment terms apply.'}
            </p>
          </div>
        </div>

        {/* Footer Actions: Status Transition & Danger Zone */}
        <DialogFooter className="border-t border-[#E2E8F0] pt-3 flex flex-col sm:flex-row justify-between items-center gap-2">
          {/* Left: Status Progression Flow */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {(isAdmin || (invoice.status === 'Draft' && canEdit)) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditModalOpen(true)}
                className="text-xs text-[#1E293B] hover:text-[#1E293B] border-[#E2E8F0] gap-1 cursor-pointer"
                data-testid="btn-edit-draft-invoice"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Invoice</span>
              </Button>
            )}

            {invoice.status === 'Draft' && isAdmin && (
              <Button
                size="sm"
                onClick={() => handleTransitionStatus('Sent')}
                className="text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs gap-1 cursor-pointer"
                data-testid="btn-approve-and-issue"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Approve & Issue</span>
              </Button>
            )}

            {invoice.status === 'Draft' && !isAdmin && (canEdit || canRequest) && (
              <Button
                size="sm"
                onClick={() => handleTransitionStatus('Pending')}
                className="text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1 cursor-pointer"
                data-testid="btn-submit-for-approval"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Submit for Approval</span>
              </Button>
            )}

            {invoice.status === 'Pending' && (
              isAdmin ? (
                <>
                  <Button
                    size="sm"
                    onClick={() => handleTransitionStatus('Sent')}
                    className="text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs gap-1 cursor-pointer"
                    data-testid="btn-approve-and-issue"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Approve & Issue (Sent)</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleTransitionStatus('Draft')}
                    className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 gap-1 cursor-pointer"
                    data-testid="btn-reject-to-draft"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject / Return to Draft</span>
                  </Button>
                </>
              ) : (
                <div
                  className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 px-3 py-1.5 rounded-[8px] border-amber-200"
                  data-testid="invoice-pending-admin-notice"
                >
                  <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Pending Admin Approval — Awaiting review and issuance by System Administrator</span>
                </div>
              )
            )}

            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleArchive}
                className="text-xs text-[#475569] gap-1 cursor-pointer"
                data-testid="btn-archive-invoice"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Archive</span>
              </Button>
            )}

            {canDelete && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                className="text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200 gap-1 cursor-pointer"
                data-testid="btn-delete-invoice"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </Button>
            )}
          </div>

          {/* Right: Close */}
          <Button variant="outline" size="sm" onClick={onClose} className="text-xs cursor-pointer">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ConflictResolutionModal
      isOpen={conflictModalState.isOpen}
      onClose={() => setConflictModalState({ isOpen: false })}
      error={conflictModalState.error as ApiError | Error | null}
      entityTitle={invoice.invoice_number}
      entityType="Invoice"
      expectedVersion={invoice.version}
      attemptedStatus={conflictModalState.attemptedStatus ?? undefined}
      currentStatus={invoice.status}
      onRefreshAndKeepLatest={async () => {
        if (effectiveId) {
          await queryClient.invalidateQueries({
            queryKey: billingKeys.invoiceDetail(effectiveId),
          });
        }
        await queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
        refetch();
        setConflictModalState({ isOpen: false });
      }}
      onCancel={() => setConflictModalState({ isOpen: false })}
    />

    {isEditModalOpen && (
      <InvoiceEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        invoice={invoice}
        onUpdated={() => {
          refetch();
        }}
      />
    )}
  </>
);
}
