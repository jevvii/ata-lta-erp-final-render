/**
 * Status and Approval badges for Transmittals (Module #5)
 */

import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, Send, XCircle, ShieldCheck, ShieldAlert } from 'lucide-react';
import type { TransmittalStatus } from '../api/types';

export interface TransmittalStatusBadgeProps {
  status: TransmittalStatus;
  className?: string;
}

export function TransmittalStatusBadge({ status, className = '' }: TransmittalStatusBadgeProps) {
  switch (status) {
    case 'Draft':
      return (
        <Badge
          variant="outline"
          className={`bg-[#F8FAFC] text-[#475569] border-[#E2E8F0] rounded-[6px]  text-xs font-medium flex items-center gap-1 ${className}`}
          data-testid="transmittal-status-badge"
          data-status="Draft"
        >
          <Clock className="h-3 w-3 text-[#475569]" />
          Draft
        </Badge>
      );
    case 'Sent':
      return (
        <Badge
          variant="outline"
          className={`bg-[#F0F9FF] text-[#075985] border-[#7DD3FC] rounded-[6px]  text-xs font-medium flex items-center gap-1 ${className}`}
          data-testid="transmittal-status-badge"
          data-status="Sent"
        >
          <Send className="h-3 w-3 text-[#075985]" />
          Sent
        </Badge>
      );
    case 'Acknowledged':
      return (
        <Badge
          variant="outline"
          className={`bg-[#F0FDF4] text-[#166534] border-[#86EFAC] rounded-[6px]  text-xs font-medium flex items-center gap-1 ${className}`}
          data-testid="transmittal-status-badge"
          data-status="Acknowledged"
        >
          <CheckCircle2 className="h-3 w-3 text-[#166534]" />
          Acknowledged
        </Badge>
      );
    case 'Cancelled':
      return (
        <Badge
          variant="outline"
          className={`bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5] rounded-[6px]  text-xs font-medium flex items-center gap-1 ${className}`}
          data-testid="transmittal-status-badge"
          data-status="Cancelled"
        >
          <XCircle className="h-3 w-3 text-[#991B1B]" />
          Cancelled
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className={`rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]  text-xs font-medium ${className}`} data-testid="transmittal-status-badge">
          {status}
        </Badge>
      );
  }
}

export interface TransmittalApprovalBadgeProps {
  approved: boolean;
  status?: TransmittalStatus;
  className?: string;
}

export function TransmittalApprovalBadge({
  approved,
  status,
  className = '',
}: TransmittalApprovalBadgeProps) {
  // If not draft and already sent or acknowledged, approval is inherently granted
  if (status && status !== 'Draft') {
    return null;
  }

  if (approved) {
    return (
      <Badge
        variant="outline"
        className={`bg-[#EFF6FF] text-[#1E40AF] border-[#93C5FD] rounded-[6px] flex items-center gap-1  font-medium text-xs ${className}`}
        data-testid="transmittal-approval-badge"
        data-approved="true"
      >
        <ShieldCheck className="h-3 w-3 text-[#1E40AF]" />
        Approved
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`bg-[#FEFCE8] text-[#854D0E] border-[#FDE047] rounded-[6px] flex items-center gap-1  font-medium text-xs ${className}`}
      data-testid="transmittal-approval-badge"
      data-approved="false"
    >
      <ShieldAlert className="h-3 w-3 text-[#854D0E]" />
      Pending Admin Approval
    </Badge>
  );
}
