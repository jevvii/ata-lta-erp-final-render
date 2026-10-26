import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[6px] text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
  {
    variants: {
      variant: {
        default: 'border border-[#1D4ED8] bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs hover:bg-[#1E40AF] hover:border-[#1E40AF]',
        destructive: 'border border-[#DC2626] bg-[#DC2626] text-[#FFFFFF] shadow-2xs hover:bg-[#991B1B] hover:border-[#991B1B]',
        outline: 'border border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] shadow-2xs hover:bg-[#F8FAFC] hover:border-[#94A3B8]',
        secondary: 'border border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:bg-[#E2E8F0] hover:border-[#94A3B8]',
        ghost: 'text-[#334155] hover:bg-[#F8FAFC] hover:text-[#1E293B]',
        link: 'text-[#1D4ED8] underline-offset-4 hover:underline p-0 h-auto font-normal',
        ata: 'border border-[#1E3A8A] bg-[#1E3A8A] text-[#FFFFFF] hover:bg-[#1E40AF] hover:border-[#1E40AF]',
        lta: 'border border-[#0369A1] bg-[#0369A1] text-[#FFFFFF] hover:bg-[#075985] hover:border-[#075985]',
      },
      size: {
        default: 'h-9 px-4 py-2 text-sm',
        sm: 'h-8 px-3 text-xs',
        xs: 'h-7 px-2.5 text-xs',
        lg: 'h-10 px-6 text-base font-semibold',
        icon: 'h-9 w-9 p-0',
        'icon-sm': 'h-8 w-8 p-0',
        'icon-xs': 'h-7 w-7 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  density?: 'standard' | 'compact';
  static?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, density, static: isStatic = false, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    const effectiveSize = density === 'compact' && (!size || size === 'default') ? 'sm' : size;
    const shouldScale = !isStatic && variant !== 'link';

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size: effectiveSize }),
          shouldScale && 'motion-safe:enabled:active:scale-[0.96]',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button, buttonVariants };
