import * as React from 'react';
import { cn } from '@/lib/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  density?: 'standard' | 'compact';
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, density = 'standard', ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] shadow-card',
        density === 'compact' ? 'p-3' : 'p-5 sm:p-6',
        className
      )}
      {...props}
    />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { density?: 'standard' | 'compact' }
>(({ className, density = 'standard', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex flex-col',
      density === 'compact' ? 'space-y-1 pb-2' : 'space-y-1.5 pb-4',
      className
    )}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement> & { density?: 'standard' | 'compact' }
>(({ className, density = 'standard', ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      'font-semibold leading-tight tracking-tight text-[#1E293B]',
      density === 'compact' ? 'text-sm' : 'text-base sm:text-lg',
      className
    )}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement> & { density?: 'standard' | 'compact' }
>(({ className, density = 'standard', ...props }, ref) => (
  <p
    ref={ref}
    className={cn(
      'text-[#475569]',
      density === 'compact' ? 'text-xs' : 'text-xs sm:text-sm',
      className
    )}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { density?: 'standard' | 'compact' }
>(({ className, density = 'standard', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center',
      density === 'compact' ? 'pt-2' : 'pt-4',
      className
    )}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
