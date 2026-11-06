import React from 'react';
import { Search, X } from 'lucide-react';
import {
  getClientNumber,
  getClientTin,
  type ClientSelectItemLike,
} from '@/features/clients/lib/clientSelectUtils';

export interface ClientSelectOptionContentProps {
  client: ClientSelectItemLike;
  isDuplicate?: boolean;
  showEntity?: boolean;
  showClientNumber?: boolean;
  extraBadge?: React.ReactNode;
}

export function ClientSelectOptionContent({
  client,
  isDuplicate = false,
  showEntity = false,
  showClientNumber = false,
  extraBadge,
}: ClientSelectOptionContentProps) {
  const clientNum = getClientNumber(client);
  const tin = getClientTin(client);

  return (
    <span className="inline-flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 w-full">
      <span className="truncate font-medium">
        {showClientNumber && clientNum ? `${clientNum} · ` : ''}
        {client.name}
        {showEntity && client.entity ? ` (${client.entity})` : ''}
      </span>
      <span className="inline-flex items-center gap-1.5 shrink-0">
        {tin &&
          (isDuplicate ? (
            <span
              className="inline-flex items-center font-mono tabular-nums text-[11px] font-normal text-[#475569] [[data-radix-select-viewport]_&]:bg-[#F8FAFC] [[data-radix-select-viewport]_&]:border [[data-radix-select-viewport]_&]:border-[#E2E8F0] [[data-radix-select-viewport]_&]:px-1.5 [[data-radix-select-viewport]_&]:py-0.5 [[data-radix-select-viewport]_&]:rounded"
              data-testid="client-option-tin"
            >
              <span className="[[data-radix-select-viewport]_&]:hidden">&nbsp;•&nbsp;</span>
              {tin}
            </span>
          ) : (
            <span
              className="hidden [[data-radix-select-viewport]_&]:inline-flex items-center font-mono tabular-nums text-[11px] font-normal text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.5 rounded"
              data-testid="client-option-tin"
            >
              {tin}
            </span>
          ))}
        {extraBadge && (
          <span className="hidden [[data-radix-select-viewport]_&]:inline-flex items-center">
            {extraBadge}
          </span>
        )}
      </span>
    </span>
  );
}

export interface ClientSelectSearchHeaderProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  'data-testid'?: string;
}

export function ClientSelectSearchHeader({
  value,
  onChange,
  placeholder,
  ...props
}: ClientSelectSearchHeaderProps) {
  return (
    <div
      className="sticky top-0 z-10 bg-white px-2 pt-1.5 pb-1.5 border-b border-[#E2E8F0]"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="relative flex items-center">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94A3B8] pointer-events-none" />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={placeholder ?? 'Search name or TIN...'}
          data-testid={props['data-testid'] ?? 'client-select-search-input'}
          className="w-full h-7 pl-7 pr-6 text-xs bg-[#F8FAFC] border border-[#E2E8F0] rounded focus:outline-none focus:border-[#0F172A] text-[#0F172A] placeholder:text-[#94A3B8]"
        />
        {value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-[#94A3B8] hover:text-[#0F172A] focus:outline-none"
            aria-label="Clear search"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
