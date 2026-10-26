import * as React from 'react';
import { cn } from '@/lib/utils';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-[6px] bg-[#E2E8F0]', className)}
      {...props}
    />
  );
}

export { Skeleton };
