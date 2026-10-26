import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ReportSectionProps {
  title: string;
  badgeCount?: number | string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  collapsible?: boolean;
  dataTestId?: string;
  id?: string;
}

export const ReportSection: React.FC<ReportSectionProps> = ({
  title,
  badgeCount,
  action,
  children,
  className,
  defaultOpen = true,
  collapsible = false,
  dataTestId,
  id,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section
      id={id}
      data-testid={dataTestId}
      className={cn(
        'rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-card overflow-hidden transition-colors',
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] gap-3">
        <div className="flex items-center gap-2.5">
          {collapsible && (
            <button
              type="button"
              onClick={() => setIsOpen(!isOpen)}
              className="p-1 -ml-1 text-[#475569] hover:text-[#1E293B] rounded-[4px] transition-colors cursor-pointer"
              aria-expanded={isOpen}
              aria-label={isOpen ? `Collapse ${title}` : `Expand ${title}`}
            >
              <ChevronDown
                className={cn(
                  'w-4 h-4 transition-transform duration-200',
                  !isOpen && '-rotate-90'
                )}
              />
            </button>
          )}
          <h2 className="text-sm sm:text-base font-semibold tracking-tight text-[#1E293B] leading-none">
            {title}
          </h2>
          {badgeCount !== undefined && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-[4px] bg-[#EFF6FF] text-[#1E40AF] border border-[#BFDBFE] text-xs font-semibold tabular-nums"
              data-testid={`${dataTestId || 'section'}-badge`}
            >
              {badgeCount}
            </span>
          )}
        </div>

        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>

      {isOpen && <div className="p-4 sm:p-5">{children}</div>}
    </section>
  );
};
