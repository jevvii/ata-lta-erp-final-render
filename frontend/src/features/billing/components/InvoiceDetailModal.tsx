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
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  updateInvoiceAction,
  updateClientAddressAction,
  archiveInvoiceAction,
  deleteInvoiceAction,
} from '../api/useBillingMutations';
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
import { isUserAdmin } from '@/features/operations/lib/taskScope';
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
  const { data: fetchedInvoice, refetch } = useInvoiceDetail(effectiveId, {
    enabled: isOpen && !!effectiveId,
  });

  const invoice = fetchedInvoice || initialInvoice;

  // Session & Admin Check
  const user = useSessionStore((state) => state.user);
  const isAdmin = isUserAdmin(user);

  // Permissions
  const canEdit = usePermission('billing:edit');
  const canRequest = usePermission('billing:request');
  const canEditAddress = usePermission('billing:edit_client_address');
  const canPay = usePermission('billing:payments');
  const canDelete = usePermission('billing:delete');

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
      setAddressInput(invoice.address || invoice.clients?.address || '');
      setNotesInput(invoice.notes || '');
    }
    setIsEditingAddress(false);
    setIsEditingNotes(false);
    setAddressFeedback(null);
  }, [invoice]);

  if (!invoice) return null;

  const currentAddress = invoice.address || invoice.clients?.address || 'No address provided';
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
      <DialogContent
        className="max-w-3xl max-h-[92vh] overflow-y-auto p-6 rounded-xl bg-white"
        data-testid="invoice-detail-modal"
      >
        <DialogHeader className="border-b border-slate-200 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-lg font-bold text-slate-900">
                  {invoice.invoice_number}
                </DialogTitle>
                {invoice.entity_code && (
                  <Badge variant="outline" className="text-xs">
                    {invoice.entity_code}
                  </Badge>
                )}
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadgeVariant(
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
              <p className="text-xs text-slate-500 mt-0.5">
                Created {invoice.created_at?.slice(0, 10)} • Due {invoice.due_date?.slice(0, 10)}
              </p>
              {(invoice.work_request?.creatorName || invoice.work_request_creator_name) && (
                <p className="text-xs text-slate-600 mt-0.5" data-testid="invoice-wr-requester">
                  Work Request Requester:{' '}
                  <span className="font-semibold text-slate-800">
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
            </div>
          </div>
        </DialogHeader>

        {addressFeedback && (
          <div
            className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between"
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
          className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2 text-xs"
          data-testid="detail-client-snapshot"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-[11px] text-slate-500 uppercase tracking-wider">
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
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                  data-testid="detail-edit-address-btn"
                >
                  <Pencil className="w-3 h-3" />
                  <span>Edit Snapshot Address</span>
                </button>
              )
            ) : (
              <span
                className="text-[10px] text-slate-400 flex items-center gap-1"
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
              <p className="font-bold text-slate-900 text-sm">
                {invoice.clients?.name || 'Client Name Unavailable'}
              </p>
              {invoice.clients?.tin && (
                <p className="text-slate-600 font-mono text-xs mt-0.5">
                  TIN: {invoice.clients.tin}
                </p>
              )}
            </div>

            <div>
              <span className="text-[11px] text-slate-500 block">Billing Address Snapshot:</span>
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
                      className="h-6 text-[11px] bg-blue-600 hover:bg-blue-700 text-white px-2 cursor-pointer"
                      data-testid="detail-save-address-btn"
                    >
                      <Check className="w-3 h-3 mr-1" />
                      Save Snapshot
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setIsEditingAddress(false)}
                      className="h-6 text-[11px] text-slate-600 px-2 cursor-pointer"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancel
                    </Button>
                  </div>
                  <p className="text-[10px] text-slate-500 italic">
                    Updated invoice snapshot address only. Master client record remains unchanged.
                  </p>
                </div>
              ) : (
                <p
                  className="text-slate-700 text-xs leading-relaxed mt-0.5"
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
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Line Items Breakdown
          </h4>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <Table>
              <TableHeader className="bg-slate-50">
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
                    <TableCell className="font-mono text-xs text-slate-500 py-2.5">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-slate-800 py-2.5">
                      {item.description}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 py-2.5">
                      {item.type}
                    </TableCell>
                    <TableCell className="text-xs font-mono font-medium text-slate-900 text-right py-2.5">
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
          <div className="w-64 bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1.5">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal:</span>
              <span className="font-mono">{formatCurrency(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1">
              <span>Total Amount:</span>
              <span className="font-mono text-sm" data-testid="detail-total-amount">
                {formatCurrency(invoice.total)}
              </span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Amount Paid:</span>
              <span className="font-mono text-emerald-600" data-testid="detail-amount-paid">
                {formatCurrency(invoice.amount_paid || 0)}
              </span>
            </div>
            <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1">
              <span>Remaining Balance:</span>
              <span
                className={`font-mono text-sm ${
                  Number(invoice.balance || 0) > 0 ? 'text-amber-600' : 'text-slate-500'
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
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
            Payment History
          </h4>
          {(!invoice.payments || invoice.payments.length === 0) ? (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg text-center text-xs text-slate-500">
              No payments recorded for this invoice yet.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold">Method</TableHead>
                    <TableHead className="text-xs font-semibold">Reference</TableHead>
                    <TableHead className="text-xs font-semibold">Notes</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-xs text-slate-700 py-2">
                        {p.payment_date?.slice(0, 10)}
                      </TableCell>
                      <TableCell className="text-xs text-slate-800 font-medium py-2">
                        {p.payment_method}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-slate-500 py-2">
                        {p.reference_number || '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-500 py-2">
                        {p.notes || '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono font-bold text-emerald-600 text-right py-2">
                        {formatCurrency(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* 5. Notes & Terms */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-slate-200">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">Invoice Notes:</span>
              {(canEdit || canRequest) && !isEditingNotes && (
                <button
                  type="button"
                  onClick={() => setIsEditingNotes(true)}
                  className="text-[11px] text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
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
                    className="h-6 text-[10px] bg-blue-600 text-white px-2 cursor-pointer"
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsEditingNotes(false)}
                    className="h-6 text-[10px] px-2 cursor-pointer"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-slate-600 bg-slate-50 p-2 rounded-md border border-slate-200 min-h-[36px]">
                {invoice.notes || 'No notes entered.'}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <span className="font-semibold text-slate-700">Payment Terms:</span>
            <p className="text-slate-600 bg-slate-50 p-2 rounded-md border border-slate-200 min-h-[36px]">
              {invoice.terms || 'Standard 30-day payment terms apply.'}
            </p>
          </div>
        </div>

        {/* Footer Actions: Status Transition & Danger Zone */}
        <DialogFooter className="border-t border-slate-200 pt-3 flex flex-col sm:flex-row justify-between items-center gap-2">
          {/* Left: Status Progression Flow */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {invoice.status === 'Draft' && isAdmin && (
              <Button
                size="sm"
                onClick={() => handleTransitionStatus('Sent')}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1 cursor-pointer"
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
                    className="text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1 cursor-pointer"
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
                  className="flex items-center gap-1.5 text-xs text-amber-800 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-200"
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
                className="text-xs text-slate-600 gap-1 cursor-pointer"
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
  </>
);
}
