import React from 'react';
import { AlertCircle, RefreshCw, Inbox, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ==========================================
// 1. ReportLoadingState
// ==========================================
export interface ReportLoadingStateProps {
  type?: 'summary' | 'table' | 'full';
  rows?: number;
  columns?: number;
  className?: string;
  dataTestId?: string;
}

export const ReportLoadingState: React.FC<ReportLoadingStateProps> = ({
  type = 'full',
  rows = 5,
  columns = 4,
  className,
  dataTestId = 'report-loading-state',
}) => {
  return (
    <div
      data-testid={dataTestId}
      className={cn('space-y-4 animate-pulse motion-reduce:animate-none', className)}
    >
      {(type === 'full' || type === 'summary') && (
        <div
          className={cn(
            'grid gap-4',
            columns === 1 && 'grid-cols-1',
            columns === 2 && 'grid-cols-1 sm:grid-cols-2',
            columns === 3 && 'grid-cols-1 sm:grid-cols-3',
            columns >= 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
          )}
        >
          {Array.from({ length: columns }).map((_, idx) => (
            <div
              key={idx}
              className="bg-[#FFFFFF] rounded-[8px] border border-[#E2E8F0] p-4 shadow-card"
            >
              <div className="h-4 w-24 bg-[#E2E8F0] rounded-[4px] mb-3" />
              <div className="h-7 w-32 bg-[#E2E8F0] rounded-[4px]" />
            </div>
          ))}
        </div>
      )}

      {(type === 'full' || type === 'table') && (
        <div className="bg-[#FFFFFF] rounded-[8px] border border-[#E2E8F0] shadow-card overflow-hidden">
          <div className="p-4 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between">
            <div className="h-5 w-36 bg-[#CBD5E1] rounded-[4px]" />
            <div className="h-4 w-16 bg-[#CBD5E1] rounded-[4px]" />
          </div>
          <div className="divide-y divide-[#E2E8F0]">
            {Array.from({ length: rows }).map((_, rIdx) => (
              <div
                key={rIdx}
                className="h-11 px-4 flex items-center justify-between gap-4"
              >
                <div className="h-4 w-1/4 bg-[#E2E8F0] rounded-[4px]" />
                <div className="h-4 w-1/4 bg-[#E2E8F0] rounded-[4px]" />
                <div className="h-4 w-1/6 bg-[#E2E8F0] rounded-[4px]" />
                <div className="h-4 w-1/6 bg-[#E2E8F0] rounded-[4px]" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================
// 2. ReportErrorState
// ==========================================
export interface ReportErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  staleDataNotice?: boolean;
  className?: string;
  dataTestId?: string;
}

export const ReportErrorState: React.FC<ReportErrorStateProps> = ({
  title = 'Unable to load report',
  message = 'An error occurred while fetching report data. Please check your connection and try again.',
  onRetry,
  staleDataNotice = false,
  className,
  dataTestId = 'report-error-state',
}) => {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        'p-5 sm:p-6 bg-[#FFFFFF] border border-[#FCA5A5] rounded-[8px] shadow-card text-[#1E293B] space-y-3',
        className
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
        <div className="space-y-1 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold tracking-tight text-[#DC2626] leading-snug">
              {title}
            </h3>
            {staleDataNotice && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-[4px] bg-[#FEFCE8] text-[#854D0E] border border-[#FDE047]">
                <AlertTriangle className="w-3 h-3 text-[#854D0E]" />
                Showing previously loaded data
              </span>
            )}
          </div>
          <p className="text-xs text-[#475569] leading-relaxed">{message}</p>
        </div>

        {onRetry && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onRetry}
            className="text-xs font-semibold h-8 px-3.5 bg-[#FFFFFF] border border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] hover:border-[#94A3B8] rounded-[6px] cursor-pointer shadow-2xs shrink-0 transition-colors"
            data-testid="report-error-retry-btn"
          >
            <RefreshCw className="w-3 h-3 mr-1.5" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
};

// ==========================================
// 3. ReportEmptyState
// ==========================================
export interface ReportEmptyStateProps {
  title: string;
  description?: string;
  onReset?: () => void;
  resetLabel?: string;
  icon?: React.ReactNode;
  className?: string;
  dataTestId?: string;
}

export const ReportEmptyState: React.FC<ReportEmptyStateProps> = ({
  title,
  description,
  onReset,
  resetLabel = 'Clear filters',
  icon,
  className,
  dataTestId = 'report-empty-state',
}) => {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        'p-8 sm:p-10 bg-[#FFFFFF] rounded-[8px] border border-dashed border-[#E2E8F0] text-center shadow-card my-4',
        className
      )}
    >
      <div className="w-10 h-10 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0] text-[#475569] flex items-center justify-center mx-auto mb-3">
        {icon || <Inbox className="w-5 h-5 text-[#475569]" />}
      </div>
      <h3 className="text-sm font-semibold tracking-tight text-[#1E293B]">{title}</h3>
      {description && (
        <p className="text-xs text-[#475569] mt-1 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {onReset && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onReset}
          className="mt-4 text-xs font-semibold h-8 px-3.5 text-[#1D4ED8] border border-[#1D4ED8] bg-[#FFFFFF] hover:bg-[#EFF6FF] rounded-[6px] cursor-pointer shadow-2xs transition-colors"
          data-testid="report-empty-reset-btn"
        >
          {resetLabel}
        </Button>
      )}
    </div>
  );
};
