import React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DisbursementStatus } from '../api/types';

export interface DisbursementStatusBadgeProps {
  status: DisbursementStatus | string;
  className?: string;
  reviewReady?: boolean;
}

const statusStyles: Record<string, { label: string; className: string }> = {
  Draft: {
    label: 'Draft',
    className: 'bg-canvas text-text-secondary border-border hover:bg-canvas',
  },
  Submitted: {
    label: 'Submitted',
    className: 'bg-primary-light text-primary-hover border-blue-300 hover:bg-primary-light',
  },
  Pending: {
    label: 'Pending',
    className: 'bg-warning-surface text-warning border-warning-border hover:bg-warning-surface',
  },
  'Pending Admin Approval': {
    label: 'Pending Admin Approval',
    className: 'bg-warning-surface text-warning border-warning-border hover:bg-warning-surface',
  },
  Approved: {
    label: 'Approved',
    className: 'bg-primary-light text-primary-hover border-blue-300 hover:bg-primary-light',
  },
  Released: {
    label: 'Released',
    className: 'bg-info-surface text-info border-info-border hover:bg-info-surface',
  },
  Funded: {
    label: 'Funded',
    className: 'bg-success-surface text-success border-success-border hover:bg-success-surface',
  },
  Rejected: {
    label: 'Rejected',
    className: 'bg-danger-surface text-danger border-danger-border hover:bg-danger-surface',
  },
  Archived: {
    label: 'Archived',
    className: 'bg-sidebar text-muted border-border hover:bg-sidebar',
  },
  Cancelled: {
    label: 'Cancelled',
    className: 'bg-canvas text-muted border-border hover:bg-canvas',
  },
};

export const DisbursementStatusBadge: React.FC<DisbursementStatusBadgeProps> = ({
  status,
  className,
  reviewReady,
}) => {
  const config = statusStyles[status] || {
    label: status,
    className: 'bg-canvas text-text-secondary border-border',
  };

  return (
    <div className="inline-flex items-center gap-1.5">
      <Badge
        variant="outline"
        data-testid="disbursement-status-badge"
        data-test-status={status.toLowerCase()}
        className={cn(
          'font-medium text-xs px-2.5 py-0.5 rounded-[6px] border transition-none',
          config.className,
          className
        )}
      >
        {config.label}
      </Badge>
      {status === 'Draft' && reviewReady === false && (
        <Badge
          variant="outline"
          data-testid="badge-needs-correction"
          className="bg-danger-surface text-danger border-danger-border font-medium text-xs px-2 py-0.5 rounded-[6px]"
          title="Returned for correction — must be edited and saved before approval"
        >
          Needs Correction
        </Badge>
      )}
    </div>
  );
};
