/**
 * Transmittal Detail Modal / Drawer
 *
 * Full details view including client info, exact child line items,
 * and comprehensive audit trail metadata.
 */

import {
  FileText,
  Building,
  User,
  Printer,
  Edit2,
  Send,
  CheckCircle2,
  ShieldCheck,
  Trash2,
  Layers,
  MapPin,
  Lock,
} from 'lucide-react';
import { transmittalKeys } from '../api/queryKeys';
import { useScopedRecordGuard } from '@/lib/useScopedRecordGuard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './Tooltip';
import { TransmittalStatusBadge, TransmittalApprovalBadge } from './TransmittalStatusBadge';
import { useTransmittalDetail } from '../api/useTransmittals';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import type { Transmittal } from '../api/types';

export interface TransmittalDetailModalProps {
  transmittalId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (transmittal: Transmittal) => void;
  onPrint?: (transmittal: Transmittal) => void;
  onApprove?: (id: string) => void;
  onSend?: (transmittal: Transmittal) => void;
  onAcknowledge?: (transmittal: Transmittal) => void;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function TransmittalDetailModal({
  transmittalId,
  isOpen,
  onClose,
  onEdit,
  onPrint,
  onApprove,
  onSend,
  onAcknowledge,
  onArchive: _onArchive,
  onUnarchive: _onUnarchive,
  onDelete,
}: TransmittalDetailModalProps) {
  const {
    data: liveTransmittal,
    isLoading,
    isError: isTransmittalError,
    error: transmittalError,
    isPlaceholderData: isTransmittalPlaceholder,
    refetch,
    isFetching,
  } = useTransmittalDetail(transmittalId ?? undefined, {
    enabled: isOpen && Boolean(transmittalId),
  });

  const {
    record: transmittal,
    isDenied,
    isScopeStale,
  } = useScopedRecordGuard<Transmittal>({
    recordId: transmittalId,
    isOpen,
    onClose,
    queryError: transmittalError,
    isQueryError: isTransmittalError,
    isPlaceholderData: isTransmittalPlaceholder,
    liveRecord: liveTransmittal,
    initialRecord: null,
    queryKey: transmittalId ? transmittalKeys.detail(transmittalId) : undefined,
  });

  const permissions = useSessionStore((state) => state.permissions);
  const user = useSessionStore((state) => state.user);
  const isAdmin = user?.role === 'Admin';

  const canEdit = hasPermission(permissions, 'transmittal:edit') && (isAdmin || transmittal?.status === 'Draft');
  const canApprove = hasPermission(permissions, 'transmittal:approve') && transmittal?.status === 'Draft';
  const canMark = hasPermission(permissions, 'transmittal:mark');
  const canDelete = hasPermission(permissions, 'transmittal:delete');

  const isSendDisabled = !isAdmin && !transmittal?.approved;

  if (isScopeStale || !isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-[#E2E8F0] max-w-2xl border max-h-[90vh] rounded-[12px] bg-[#FFFFFF] shadow-float overflow-y-auto"
        data-testid="transmittal-detail-modal"
      >
        {isDenied ? (
          <div className="py-16 text-center space-y-3" data-testid="transmittal-access-denied">
            <div className="w-12 h-12 rounded-full bg-[#F1F5F9] mx-auto flex items-center justify-center">
              <Lock className="w-6 h-6 text-[#64748B]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#1E293B]">Access Not Available</h3>
              <p className="text-xs text-[#475569] max-w-xs mx-auto">
                You do not have access to this transmittal or access has been revoked.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="mt-2 text-xs"
              data-testid="transmittal-access-denied-close-btn"
            >
              Close
            </Button>
          </div>
        ) : (
          <>
            <DialogHeader className="border-b pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#1E293B]" />
              <DialogTitle className="font-mono text-lg font-bold text-[#1E293B]" data-testid="detail-tracking-number">
                {transmittal?.tracking_number || 'Loading...'}
              </DialogTitle>
              {transmittal?.entity_code && (
                <Badge variant="secondary" className="font-semibold text-xs">
                  {transmittal.entity_code}
                </Badge>
              )}
            </div>
            {transmittal && (
              <div className="flex items-center gap-1.5">
                <TransmittalStatusBadge status={transmittal.status} />
                {transmittal.status === 'Draft' && (
                  <TransmittalApprovalBadge approved={transmittal.approved} status={transmittal.status} />
                )}
              </div>
            )}
          </div>
        </DialogHeader>

        {transmittalError ? (
          <div role="alert" className="space-y-3 py-10 text-center text-sm text-[#475569]">
            <p>{transmittalError.message || 'Unable to load this transmittal.'}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>Retry</Button>
          </div>
        ) : isLoading || !transmittal ? (
          <div className="py-16 text-center text-xs text-[#475569]">Loading details...</div>
        ) : (
          <div className="space-y-6 pt-2">
            {/* Client and Recipient Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Client Info */}
              <div className="bg-[#F8FAFC] p-3.5 rounded-[8px] border-[#E2E8F0] space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#1E293B] tracking-normal">
                  <Building className="h-3.5 w-3.5 text-[#475569]" />
                  Client Details
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Boolean(
                    transmittal.clientNumber ||
                      transmittal.client_number ||
                      transmittal.clients?.clientNumber ||
                      transmittal.clients?.client_number
                  ) && (
                    <span className="font-mono text-xs font-medium text-[#475569] tabular-nums bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.5 rounded">
                      {transmittal.clientNumber ||
                        transmittal.client_number ||
                        transmittal.clients?.clientNumber ||
                        transmittal.clients?.client_number}
                    </span>
                  )}
                  <div className="text-sm font-semibold text-[#1E293B]" data-testid="detail-client-name">
                    {transmittal.clients?.name || 'Client not assigned'}
                  </div>
                </div>
                {transmittal.clients?.address && (
                  <div className="text-xs text-[#475569] flex items-start gap-1">
                    <MapPin className="h-3 w-3 mt-0.5 text-[#475569] shrink-0" />
                    <span>{transmittal.clients.address}</span>
                  </div>
                )}
                {transmittal.clients?.tin && (
                  <div className="text-xs text-[#475569]">
                    <span className="font-medium">TIN:</span> {transmittal.clients.tin}
                  </div>
                )}
              </div>

              {/* Recipient Info */}
              <div className="bg-[#F8FAFC] p-3.5 rounded-[8px] border-[#E2E8F0] space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#1E293B] tracking-normal">
                  <User className="h-3.5 w-3.5 text-[#475569]" />
                  Delivery Recipient
                </div>
                <div className="text-sm font-semibold text-[#1E293B]" data-testid="detail-recipient-name">
                  {transmittal.recipient_name || 'No recipient person specified'}
                </div>
                {transmittal.recipient_details && (
                  <div className="text-xs text-[#475569]" data-testid="detail-recipient-details">
                    {transmittal.recipient_details}
                  </div>
                )}
              </div>
            </div>

            {/* Linked Work Request */}
            {Boolean(
              transmittal.workRequestNumber ||
                transmittal.work_request_number ||
                transmittal.work_request_title ||
                transmittal.workRequestTitle ||
                transmittal.work_request_id ||
                transmittal.workRequestId
            ) && (
              <div className="bg-[#F8FAFC] p-3 rounded-[8px] border-[#E2E8F0] flex items-center justify-between text-xs">
                <span className="font-semibold text-[#1E293B]">Linked Work Request:</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {Boolean(transmittal.workRequestNumber || transmittal.work_request_number) && (
                    <span className="font-mono text-xs font-medium text-[#475569] tabular-nums bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.5 rounded">
                      {transmittal.workRequestNumber || transmittal.work_request_number}
                    </span>
                  )}
                  <span className="text-[#1E293B]">
                    {transmittal.work_request_title ||
                      transmittal.workRequestTitle ||
                      transmittal.work_request_id ||
                      transmittal.workRequestId}
                  </span>
                </div>
              </div>
            )}

            {/* Document Line Items Table (Item-rows-only fix) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[#1E293B] tracking-normal flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-[#1E293B]" />
                  Manifest Documents ({transmittal.items?.length ?? 0})
                </h4>
              </div>

              <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden">
                <table className="w-full text-left text-xs" data-testid="detail-items-table">
                  <thead className="bg-[#F8FAFC] text-[#1E293B] font-semibold border-b text-xs">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">#</th>
                      <th className="py-2.5 px-3 w-28">Category</th>
                      <th className="py-2.5 px-3">Description</th>
                      <th className="py-2.5 px-3 w-16 text-center">Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {(!transmittal.items || transmittal.items.length === 0) ? (
                      <tr>
                        <td colSpan={4} className="py-6 text-center text-[#475569]">
                          No document line items attached.
                        </td>
                      </tr>
                    ) : (
                      transmittal.items.map((item, idx) => (
                        <tr key={item.id || idx} className="hover:bg-[#F8FAFC]/50">
                          <td className="py-2.5 px-3 tabular-nums text-center text-[#475569]">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge variant="outline" className="text-xs py-0 px-1 font-medium bg-[#F8FAFC]">
                              {item.document_type || item.documentType || 'Others'}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-[#1E293B]">
                            {item.description}
                          </td>
                          <td className="py-2.5 px-3 tabular-nums font-semibold text-center text-[#1E293B]">
                            {item.quantity}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Notes Section */}
            {transmittal.notes && (
              <div className="p-3 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] space-y-1">
                <div className="text-xs font-semibold text-[#1E293B]">Delivery Notes:</div>
                <p className="text-xs text-[#475569] whitespace-pre-wrap">{transmittal.notes}</p>
              </div>
            )}

            {/* Audit Trail Metadata */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-[#F8FAFC]/75 rounded-[8px] border-[#E2E8F0] text-xs text-[#475569]">
              <div>
                <span className="font-semibold block text-[#1E293B]">Created At:</span>
                <span>{new Date(transmittal.created_at).toLocaleString()}</span>
              </div>
              <div>
                <span className="font-semibold block text-[#1E293B]">Sent At:</span>
                <span>{transmittal.sent_at ? new Date(transmittal.sent_at).toLocaleString() : 'Not sent'}</span>
              </div>
              <div>
                <span className="font-semibold block text-[#1E293B]">Acknowledged:</span>
                <span>
                  {transmittal.acknowledged_at
                    ? new Date(transmittal.acknowledged_at).toLocaleString()
                    : 'Not acknowledged'}
                </span>
              </div>
              <div>
                <span className="font-semibold block text-[#1E293B]">OCC Version:</span>
                <span className="">v{transmittal.version}</span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="pt-4 border-t border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
          {/* Left Actions: Print, Edit, Delete */}
          <div className="flex items-center gap-1.5">
            {transmittal && onPrint && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onPrint(transmittal)}
                className="h-8 text-xs gap-1"
                data-testid="detail-print-btn"
              >
                <Printer className="h-3.5 w-3.5" />
                Print Letter
              </Button>
            )}

            {canEdit && onEdit && transmittal && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(transmittal)}
                className="h-8 text-xs gap-1"
                data-testid="detail-edit-btn"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit
              </Button>
            )}

            {canDelete && onDelete && transmittal && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDelete(transmittal.id)}
                className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                data-testid="detail-delete-btn"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Right Workflow Actions */}
          <div className="flex items-center gap-1.5">
            {transmittal?.status === 'Draft' && canApprove && onApprove && (
              <Button
                size="sm"
                onClick={() => onApprove(transmittal.id)}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                data-testid="detail-approve-btn"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Approve (Admin)
              </Button>
            )}

            {transmittal?.status === 'Draft' && canMark && onSend && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        size="sm"
                        disabled={isSendDisabled}
                        onClick={() => onSend(transmittal)}
                        className="h-8 text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs gap-1 disabled:opacity-50"
                        data-testid="detail-send-btn"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Mark Sent
                      </Button>
                    </span>
                  </TooltipTrigger>
                  {isSendDisabled && (
                    <TooltipContent side="top" className="text-xs">
                      Requires Admin approval before sending
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
            )}

            {transmittal?.status === 'Sent' && canMark && onAcknowledge && (
              <Button
                size="sm"
                onClick={() => onAcknowledge(transmittal)}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                data-testid="detail-acknowledge-btn"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Acknowledge Receipt
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={onClose}
              className="h-8 text-xs"
              data-testid="detail-close-btn"
            >
              Close
            </Button>
          </div>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
