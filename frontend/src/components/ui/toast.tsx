import * as React from 'react';
import { Toaster as Sonner, toast } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-[#FFFFFF] group-[.toaster]:text-[#1E293B] group-[.toaster]:border group-[.toaster]:border-[#E2E8F0] group-[.toaster]:shadow-float group-[.toaster]:rounded-[8px] font-sans',
          description: 'group-[.toast]:text-[#475569]',
          actionButton:
            'group-[.toast]:bg-[#1D4ED8] group-[.toast]:text-[#FFFFFF] group-[.toast]:rounded-[6px] group-[.toast]:border group-[.toast]:border-[#1D4ED8] group-[.toast]:hover:bg-[#1E40AF]',
          cancelButton:
            'group-[.toast]:bg-[#F8FAFC] group-[.toast]:text-[#1E293B] group-[.toast]:rounded-[6px] group-[.toast]:border group-[.toast]:border-[#E2E8F0] group-[.toast]:hover:bg-[#E2E8F0]',
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
