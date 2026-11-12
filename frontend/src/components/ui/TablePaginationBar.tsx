import React from 'react';
import { Button } from './button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TablePaginationBarProps {
  total: number;
  page: number;
  pageSize: number | 'all';
  onPageChange: (newPage: number) => void;
  onPageSizeChange?: (newSize: number | 'all') => void;
  itemLabel?: string;
  pageSizeOptions?: Array<number | 'all'>;
  className?: string;
}

export const TablePaginationBar: React.FC<TablePaginationBarProps> = ({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel,
  pageSizeOptions = [10, 25, 50, 100, 'all'],
  className,
}) => {
  const isAll = pageSize === 'all';
  const totalPages = isAll ? 1 : Math.max(1, Math.ceil(total / (typeof pageSize === 'number' && pageSize > 0 ? pageSize : 1)));

  let startX = 0;
  let endY = 0;
  if (total > 0) {
    if (isAll) {
      startX = 1;
      endY = total;
    } else {
      startX = (page - 1) * pageSize + 1;
      endY = Math.min(page * pageSize, total);
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-center justify-between gap-3 px-6 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/50 text-xs text-[var(--text-secondary)]',
        className
      )}
      data-testid="table-pagination-bar"
    >
      {/* Left side: Showing X to Y of Z & Rows per page */}
      <div className="flex flex-wrap items-center gap-4">
        <div>
          Showing <span className="font-semibold text-[var(--text-primary)]">{startX}</span> to{' '}
          <span className="font-semibold text-[var(--text-primary)]">{endY}</span> of{' '}
          <span className="font-semibold text-[var(--text-primary)]">{total}</span>
          {itemLabel ? ` ${itemLabel}` : ''}
        </div>

        {onPageSizeChange && (
          <div className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">Rows per page:</span>
            <select
              aria-label="Rows per page"
              data-testid="rows-per-page-select"
              value={isAll ? 'all' : String(pageSize)}
              onChange={(e) => {
                const val = e.target.value;
                onPageSizeChange(val === 'all' ? 'all' : Number(val));
              }}
              className="px-2 py-1 text-xs rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)] cursor-pointer"
            >
              {pageSizeOptions.map((opt) => (
                <option key={String(opt)} value={String(opt)}>
                  {opt === 'all' ? 'All' : opt}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Right side: Page indicator & Navigation buttons */}
      <div className="flex items-center gap-3">
        <span className="text-[var(--text-secondary)]" data-testid="page-indicator">
          Page {isAll ? 1 : page} of {totalPages}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page <= 1 || isAll}
            onClick={() => onPageChange(page - 1)}
            data-testid="pagination-prev"
            aria-label="Previous Page"
            className="cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5 mr-1" />
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={page >= totalPages || isAll}
            onClick={() => onPageChange(page + 1)}
            data-testid="pagination-next"
            aria-label="Next Page"
            className="cursor-pointer"
          >
            Next
            <ChevronRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </div>
    </div>
  );
};
