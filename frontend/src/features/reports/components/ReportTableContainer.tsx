import React from 'react';
import { cn } from '@/lib/utils';

export interface ReportTableContainerProps {
  children: React.ReactNode;
  className?: string;
  minWidth?: string; // e.g. 'min-w-[640px]'
  dataTestId?: string;
  ariaLabel?: string;
}

export const ReportTableContainer: React.FC<ReportTableContainerProps> = ({
  children,
  className,
  minWidth = 'min-w-[640px]',
  dataTestId = 'report-table-container',
  ariaLabel = 'Report data table',
}) => {
  return (
    <div
      role="region"
      aria-label={ariaLabel}
      tabIndex={0}
      data-testid={dataTestId}
      className={cn(
        'w-full overflow-x-auto rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-card focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]',
        '[&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-xs sm:[&_table]:text-sm',
        '[&_thead]:bg-[#F8FAFC] [&_thead]:border-b [&_thead]:border-[#E2E8F0]',
        '[&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-[#334155] [&_th]:whitespace-nowrap',
        '[&_tbody_tr]:border-b [&_tbody_tr]:border-[#E2E8F0] [&_tbody_tr]:transition-colors [&_tbody_tr]:hover:bg-[#F8FAFC]',
        '[&_tbody_tr]:h-10 sm:[&_tbody_tr]:h-11',
        '[&_td]:px-4 [&_td]:py-2.5 [&_td]:text-[#1E293B] [&_td]:align-middle',
        '[&_.tabular-nums]: [&_.tabular-nums]:tabular-nums',
        className
      )}
    >
      <div className={minWidth}>{children}</div>
    </div>
  );
};
