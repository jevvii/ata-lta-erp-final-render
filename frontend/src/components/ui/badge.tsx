import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full text-xs font-medium transition-colors border select-none focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'bg-[#EFF6FF] text-[#1E40AF] border-[#BFDBFE]',
        secondary: 'bg-[#F8FAFC] text-[#334155] border-[#E2E8F0]',
        destructive: 'bg-[#FEF2F2] text-[#991B1B] border-[#FCA5A5]',
        success: 'bg-[#F0FDF4] text-[#166534] border-[#86EFAC]',
        warning: 'bg-[#FEFCE8] text-[#854D0E] border-[#FDE047]',
        info: 'bg-[#F0F9FF] text-[#075985] border-[#7DD3FC]',
        outline: 'bg-[#FFFFFF] text-[#334155] border-[#E2E8F0]',
        ata: 'bg-[#EFF6FF] text-[#1E3A8A] border-[#93C5FD] font-semibold',
        lta: 'bg-[#F0F9FF] text-[#075985] border-[#7DD3FC] font-semibold',
      },
      size: {
        default: 'px-2.5 py-0.5 text-xs',
        compact: 'px-2 py-0 text-xs leading-tight',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  density?: 'standard' | 'compact';
}

function Badge({ className, variant, size, density, ...props }: BadgeProps) {
  const effectiveSize = density === 'compact' && (!size || size === 'default') ? 'compact' : size;
  return (
    <div className={cn(badgeVariants({ variant, size: effectiveSize }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
