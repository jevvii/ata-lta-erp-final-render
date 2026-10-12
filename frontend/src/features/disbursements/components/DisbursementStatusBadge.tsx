import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DisbursementStatus } from '../api/types';

export interface DisbursementStatusBadgeProps {
  status: DisbursementStatus | string;
  className?: string;
}

const statusStyles: Record<string, { label: string; className: string }> = {
  Draft: {
    label: 'Draft',
    className: 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-100',
  },
  Submitted: {
    label: 'Submitted',
    className: 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100',
  },
  Pending: {
    label: 'Pending',
    className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
  },
  'Pending Admin Approval': {
    label: 'Pending Admin Approval',
    className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
  },
  Approved: {
    label: 'Approved',
    className: 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100',
  },
  Released: {
    label: 'Released',
    className: 'bg-purple-100 text-purple-800 border-purple-300 hover:bg-purple-100',
  },
  Funded: {
    label: 'Funded',
    className: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100',
  },
  Rejected: {
    label: 'Rejected',
    className: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100',
  },
  Archived: {
    label: 'Archived',
    className: 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-100',
  },
  Cancelled: {
    label: 'Cancelled',
    className: 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-100',
  },
};

export const DisbursementStatusBadge: React.FC<DisbursementStatusBadgeProps> = ({
  status,
  className,
}) => {
  const config = statusStyles[status] || {
    label: status,
    className: 'bg-slate-100 text-slate-700 border-slate-300',
  };

  return (
    <Badge
      variant="outline"
      data-testid="disbursement-status-badge"
      data-test-status={status.toLowerCase()}
      className={cn(
        'font-medium text-xs px-2.5 py-0.5 rounded-full border transition-none',
        config.className,
        className
      )}
    >
      {config.label}
    </Badge>
  );
};
