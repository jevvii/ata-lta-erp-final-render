import React from 'react';

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function Tooltip({ children }: { children: React.ReactNode }) {
  return <span className="relative group inline-flex">{children}</span>;
}

export function TooltipTrigger({
  asChild: _asChild,
  children,
  ...props
}: {
  asChild?: boolean;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className="inline-flex" {...props}>
      {children}
    </span>
  );
}

export interface TooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function TooltipContent({
  side: _side = 'top',
  className = '',
  children,
  ...props
}: TooltipContentProps) {
  return (
    <div
      role="tooltip"
      className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-50 px-2 py-1 text-xs text-[#FFFFFF] bg-[#1D4ED8] rounded-[8px] border-[#E2E8F0]  shadow-none whitespace-nowrap pointer-events-none ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
