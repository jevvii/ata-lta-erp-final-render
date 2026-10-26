import React from 'react';
import { cn } from '@/lib/utils';

export interface SummaryMetricItem {
  label: string;
  value: string;
  subtext?: string;
  attention?: boolean;
  dataTestId?: string;
}

export interface ReportSummaryCardProps {
  label: string;
  value: string;
  subtext?: string;
  attention?: boolean;
  dataTestId?: string;
  className?: string;
  children?: React.ReactNode;
}

export const ReportSummaryCard: React.FC<ReportSummaryCardProps> = ({
  label,
  value,
  subtext,
  attention = false,
  dataTestId,
  className,
  children,
}) => {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        'rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] p-4 shadow-card transition-colors',
        attention
          ? 'border-warning-border border-t-2 border-t-[#D97706] bg-[#FEFCE8]/40'
          : 'hover:bg-[#F8FAFC]',
        className
      )}
    >
      <div className="text-xs font-medium text-[#475569]">
        {label}
      </div>
      <div className="text-2xl font-bold text-[#1E293B] tabular-nums tracking-tight mt-1">
        {value}
      </div>
      {subtext && <div className="text-xs text-[#475569] mt-1">{subtext}</div>}
      {children}
    </div>
  );
};

export interface ReportSummaryBandProps {
  metrics?: SummaryMetricItem[];
  children?: React.ReactNode;
  columns?: 1 | 2 | 3 | 4 | 5 | 6;
  className?: string;
  isLoading?: boolean;
}

export const ReportSummaryBand: React.FC<ReportSummaryBandProps> = ({
  metrics,
  children,
  columns,
  className,
  isLoading = false,
}) => {
  // Determine column count based on prop or number of metrics
  const colCount = columns || (metrics ? Math.min(Math.max(metrics.length, 1), 6) : 3);

  const getGridColsClass = (cols: number) => {
    switch (cols) {
      case 1:
        return 'grid-cols-1';
      case 2:
        return 'grid-cols-1 sm:grid-cols-2';
      case 3:
        return 'grid-cols-1 sm:grid-cols-3';
      case 4:
        return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';
      case 5:
        return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5';
      case 6:
        return 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6';
      default:
        return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
    }
  };

  if (isLoading) {
    const skeletonCount = metrics?.length || columns || 3;
    return (
      <div
        className={cn(
          'grid gap-4',
          getGridColsClass(colCount),
          className
        )}
        data-testid="report-summary-band-loading"
      >
        {Array.from({ length: skeletonCount }).map((_, idx) => (
          <div
            key={idx}
            className="rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] p-4 shadow-card animate-pulse motion-reduce:animate-none"
          >
            <div className="h-4 w-24 bg-[#E2E8F0] rounded-[4px] mb-3" />
            <div className="h-7 w-32 bg-[#E2E8F0] rounded-[4px]" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'grid gap-4',
        getGridColsClass(colCount),
        className
      )}
      data-testid="report-summary-band"
    >
      {metrics?.map((metric, idx) => (
        <ReportSummaryCard
          key={idx}
          label={metric.label}
          value={metric.value}
          subtext={metric.subtext}
          attention={metric.attention}
          dataTestId={metric.dataTestId}
        />
      ))}
      {children}
    </div>
  );
};
