/**
 * Kanban Transmittal Card
 *
 * Renders tracking number, client name, item count, date, approval status badge,
 * and context-aware action buttons with native HTML5 drag-and-drop.
 */

import React from 'react';
import {
  GripVertical,
  Eye,
  Edit2,
  Printer,
  Send,
  CheckCircle2,
  ShieldCheck,
  Trash2,
  FileText,
  User,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './Tooltip';
import { TransmittalStatusBadge, TransmittalApprovalBadge } from './TransmittalStatusBadge';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import type { Transmittal } from '../api/types';

export interface TransmittalCardProps {
  transmittal: Transmittal;
  onView: (id: string) => void;
  onEdit?: (transmittal: Transmittal) => void;
  onPrint: (transmittal: Transmittal) => void;
  onApprove?: (id: string) => void;
  onSend?: (transmittal: Transmittal) => void;
  onAcknowledge?: (transmittal: Transmittal) => void;
  onDelete?: (id: string) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, transmittal: Transmittal) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent, targetTransmittal: Transmittal) => void;
}

export function TransmittalCard({
  transmittal,
  onView,
  onEdit,
  onPrint,
  onApprove,
  onSend,
  onAcknowledge,
  onDelete,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
}: TransmittalCardProps) {
  const permissions = useSessionStore((state) => state.permissions);
  const user = useSessionStore((state) => state.user);

  const isAdmin = user?.role === 'Admin';
  const canEdit = hasPermission(permissions, 'transmittal:edit') && (isAdmin || transmittal.status === 'Draft');
  const canApprove = hasPermission(permissions, 'transmittal:approve') && transmittal.status === 'Draft';
  const canMark = hasPermission(permissions, 'transmittal:mark');
  const canDelete = hasPermission(permissions, 'transmittal:delete');

  const itemCount = transmittal.items?.length ?? 0;
  const clientName = transmittal.clients?.name || 'Client not assigned';

  // Format relevant display date
  const displayDate = React.useMemo(() => {
    let dateStr = transmittal.created_at;
    let label = 'Created';
    if (transmittal.status === 'Sent' && transmittal.sent_at) {
      dateStr = transmittal.sent_at;
      label = 'Sent';
    } else if (transmittal.status === 'Acknowledged' && transmittal.acknowledged_at) {
      dateStr = transmittal.acknowledged_at;
      label = 'Recv';
    }
    if (!dateStr) return null;
    try {
      const d = new Date(dateStr);
      return `${label}: ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } catch {
      return null;
    }
  }, [transmittal]);

  // Dual-path send condition:
  // Non-Admin requires approved === true; Admin can send unconditionally
  const isSendDisabled = !isAdmin && !transmittal.approved;
  const sendDisabledReason = 'Requires Admin approval before sending';

  return (
    <div
      className="bg-white border rounded-[6px] p-3.5 shadow-none hover:shadow transition-all space-y-3 cursor-grab active:cursor-grabbing border-[#E2E8F0]"
      data-testid={`transmittal-card-${transmittal.id}`}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, transmittal)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop?.(e, transmittal)}
    >
      {/* Top row: Drag handle, Tracking Number, Entity badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {draggable && (
            <GripVertical className="h-4 w-4 text-[#475569] shrink-0 cursor-grab hover:text-[#475569]" />
          )}
          <span
            className="font-mono text-xs font-bold text-[#1E293B] truncate"
            data-testid="transmittal-card-tracking"
            title={transmittal.tracking_number}
          >
            {transmittal.tracking_number}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {transmittal.entity_code && (
            <Badge variant="secondary" className="text-xs py-0 px-1.5 font-semibold">
              {transmittal.entity_code}
            </Badge>
          )}
          <TransmittalStatusBadge status={transmittal.status} className="text-xs py-0 px-1.5" />
        </div>
      </div>

      {/* Client Name & Approval Badge */}
      <div className="space-y-1">
        <div
          className="text-sm font-semibold text-[#1E293B] line-clamp-1 flex items-center gap-1.5 flex-wrap"
          data-testid="transmittal-card-client"
          title={clientName}
        >
          {Boolean(
            transmittal.clientNumber ||
              transmittal.client_number ||
              transmittal.clients?.clientNumber ||
              transmittal.clients?.client_number
          ) && (
            <span className="font-mono text-xs font-medium text-[#475569] tabular-nums bg-[#F8FAFC] border border-[#E2E8F0] px-1 py-0.2 rounded">
              {transmittal.clientNumber ||
                transmittal.client_number ||
                transmittal.clients?.clientNumber ||
                transmittal.clients?.client_number}
            </span>
          )}
          <span>{clientName}</span>
        </div>
        {Boolean(
          transmittal.workRequestNumber ||
            transmittal.work_request_number ||
            transmittal.work_request_title ||
            transmittal.workRequestTitle
        ) && (
          <div className="text-[11px] text-[#475569] flex items-center gap-1 truncate font-mono">
            {Boolean(transmittal.workRequestNumber || transmittal.work_request_number) && (
              <span className="font-medium tabular-nums">
                {transmittal.workRequestNumber || transmittal.work_request_number}
              </span>
            )}
            {(transmittal.work_request_title || transmittal.workRequestTitle) && (
              <span className="font-sans truncate">· {transmittal.work_request_title || transmittal.workRequestTitle}</span>
            )}
          </div>
        )}
        {transmittal.status === 'Draft' && (
          <div className="pt-0.5">
            <TransmittalApprovalBadge approved={transmittal.approved} status={transmittal.status} />
          </div>
        )}
      </div>

      {/* Metadata items: item count, recipient, date */}
      <div className="text-xs text-[#475569] space-y-1 pt-1 border-t border-[#E2E8F0]">
        <div className="flex items-center gap-1.5 text-[#475569]">
          <FileText className="h-3.5 w-3.5 shrink-0 text-[#475569]" />
          <span>
            {itemCount} {itemCount === 1 ? 'document' : 'documents'}
          </span>
        </div>

        {transmittal.recipient_name && (
          <div className="flex items-center gap-1.5 text-[#475569] truncate" title={transmittal.recipient_name}>
            <User className="h-3.5 w-3.5 shrink-0 text-[#475569]" />
            <span className="truncate">To: {transmittal.recipient_name}</span>
          </div>
        )}

        {displayDate && (
          <div className="flex items-center gap-1.5 text-[#475569] text-xs">
            <Calendar className="h-3 w-3 shrink-0" />
            <span>{displayDate}</span>
          </div>
        )}
      </div>

      {/* Card Footer Actions */}
      <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0] gap-1">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
            title="View Details"
            onClick={() => onView(transmittal.id)}
            data-testid="view-transmittal-btn"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>

          {canEdit && onEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
              title="Edit Transmittal"
              onClick={() => onEdit(transmittal)}
              data-testid="edit-transmittal-btn"
            >
              <Edit2 className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
            title="Print Transmittal Letter"
            onClick={() => onPrint(transmittal)}
            data-testid="print-transmittal-btn"
          >
            <Printer className="h-3.5 w-3.5" />
          </Button>

          {canDelete && onDelete && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
              title="Delete Transmittal"
              onClick={() => onDelete(transmittal.id)}
              data-testid="delete-transmittal-btn"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Workflow actions */}
        <div className="flex items-center gap-1">
          {/* Admin Direct Approve */}
          {transmittal.status === 'Draft' && canApprove && onApprove && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50 gap-1"
              onClick={() => onApprove(transmittal.id)}
              data-testid="approve-transmittal-btn"
            >
              <ShieldCheck className="h-3 w-3" />
              Approve
            </Button>
          )}

          {/* Mark Sent (Dual-path: Admin or Approved Staff) */}
          {transmittal.status === 'Draft' && canMark && onSend && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2 text-[#1E293B] border-[#E2E8F0] hover:bg-[#F8FAFC] gap-1 disabled:opacity-50 disabled:pointer-events-none"
                      disabled={isSendDisabled}
                      onClick={() => onSend(transmittal)}
                      data-testid="send-transmittal-btn"
                    >
                      <Send className="h-3 w-3" />
                      Mark Sent
                    </Button>
                  </span>
                </TooltipTrigger>
                {isSendDisabled && (
                  <TooltipContent
                    side="top"
                    className="max-w-xs text-xs"
                    data-testid="send-disabled-tooltip"
                  >
                    {sendDisabledReason}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Acknowledge Receipt */}
          {transmittal.status === 'Sent' && canMark && onAcknowledge && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2 text-emerald-700 border-emerald-300 hover:bg-emerald-50 gap-1"
              onClick={() => onAcknowledge(transmittal)}
              data-testid="acknowledge-transmittal-btn"
            >
              <CheckCircle2 className="h-3 w-3" />
              Acknowledge
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
