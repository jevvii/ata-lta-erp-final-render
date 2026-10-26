import React from 'react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DisbursementWorkspaceProps {
  rail?: React.ReactNode;
  grid: React.ReactNode;
  detail?: React.ReactNode;
  bottom?: React.ReactNode;
  detailCollapsed: boolean;
  onToggleDetail: () => void;
  className?: string;
}

export function DisbursementWorkspace({
  rail,
  grid,
  detail,
  bottom,
  detailCollapsed,
  onToggleDetail,
  className,
}: DisbursementWorkspaceProps) {
  return (
    <div
      className={cn('flex flex-col w-full border border-border bg-surface overflow-hidden', bottom && 'mb-64 lg:mb-72', className)}
      data-testid="disbursement-workspace"
    >
      {/* 3-Pane Center Layout: Action Rail | Queue Grid | Detail Pane */}
      <div className="flex flex-col lg:flex-row items-stretch min-h-[500px] lg:h-[calc(100vh-280px)] w-full overflow-hidden">
        {/* Left Action Rail Slot (Rendered only if rail content is passed) */}
        {rail ? (
          <aside
            className="hidden lg:flex flex-col w-[var(--pane-rail-width,150px)] shrink-0 bg-surface border-r border-border overflow-y-auto overscroll-contain"
            data-testid="disbursement-workspace-rail"
          >
            {rail}
          </aside>
        ) : null}

        {/* Center Queue Grid */}
        <section
          className="flex-1 min-w-0 bg-surface overflow-hidden flex flex-col"
          data-testid="disbursement-workspace-grid"
        >
          {grid}
        </section>

        {/* Right Detail Pane Slot (Desktop >=1024px only; on <1024px drawer modal is used) */}
        <aside
          id="disbursement-detail-pane"
          className={cn(
            'hidden lg:flex flex-col shrink-0 bg-surface border-l border-border overflow-hidden transition-[width] duration-150 motion-safe:ease-out',
            detailCollapsed
              ? 'w-[var(--pane-detail-collapsed)]'
              : 'w-[var(--pane-detail-width)]'
          )}
          style={{
            width: detailCollapsed
              ? 'var(--pane-detail-collapsed)'
              : 'var(--pane-detail-width)',
          }}
          data-testid="disbursement-workspace-detail"
        >
          {detailCollapsed ? (
            <div className="flex flex-col items-center py-2 px-1 h-full w-full">
              <Button
                type="button"
                variant="ghost"
                onClick={onToggleDetail}
                aria-expanded={false}
                aria-controls="disbursement-detail-pane"
                className="h-auto w-full py-3 px-1 text-xs font-semibold text-muted hover:text-ink hover:bg-hover/60 rounded-[4px] flex flex-col items-center gap-2.5 cursor-pointer transition-colors"
                data-testid="disb-toggle-detail"
                aria-label="Show details"
                title="Show details"
              >
                <PanelRightOpen className="h-4 w-4 text-primary shrink-0" />
                <span className="[writing-mode:vertical-rl] text-[11px] font-semibold tracking-wider text-text-secondary uppercase select-none leading-normal">
                  Show details
                </span>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col h-full min-h-0 overflow-hidden">
              <div className="flex items-center justify-between px-2.5 py-1 border-b border-border bg-sidebar shrink-0 h-7">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                  Voucher Details
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onToggleDetail}
                  aria-expanded={true}
                  aria-controls="disbursement-detail-pane"
                  className="h-6 px-1.5 text-[11px] font-medium text-muted hover:text-ink hover:bg-hover/60 rounded-[4px] flex items-center gap-1 cursor-pointer transition-colors"
                  data-testid="disb-toggle-detail"
                  aria-label="Hide details"
                >
                  <PanelRightClose className="h-3 w-3 text-muted" />
                  <span>Hide details</span>
                </Button>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                {detail}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Bottom Coding Pane Slot (Desktop >=1024px only) spanning full browser width as sticky footer over left sidebar */}
      <div
        className={cn(
          'hidden lg:block fixed bottom-0 inset-x-0 z-40 w-full bg-surface border-t border-border shadow-float shrink-0 overflow-hidden pb-16 lg:pb-20 pr-16',
          !bottom && 'hidden'
        )}
        data-testid="disbursement-workspace-bottom"
      >
        {bottom}
      </div>
    </div>
  );
}
