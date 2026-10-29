import { Search, RotateCcw, Building2, Archive, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ClientFilters, ClientCounts } from '../api/types';

export interface ClientFilterBarProps {
  filters: ClientFilters;
  counts?: ClientCounts;
  onFilterChange: (newFilters: Partial<ClientFilters>) => void;
  onReset: () => void;
  activeTab: 'active' | 'archived';
  onTabChange: (tab: 'active' | 'archived') => void;
}

export function ClientFilterBar({
  filters,
  counts,
  onFilterChange,
  onReset,
  activeTab,
  onTabChange,
}: ClientFilterBarProps) {
  return (
    <div className="space-y-3" data-testid="clients-filter-bar">
      {/* Architectural Tab Strip: Active vs Archived */}
      <div className="w-full justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] flex flex-nowrap overflow-x-auto scrollbar-none gap-1">
        <button
          type="button"
          onClick={() => onTabChange('active')}
          className={`inline-flex items-center justify-center whitespace-nowrap rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors cursor-pointer shrink-0 select-none ${
            activeTab === 'active'
              ? 'bg-[#FFFFFF] text-[#1E40AF] font-semibold shadow-2xs border-b-2 border-[#1D4ED8]'
              : 'text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B]'
          }`}
          data-testid="clients-tab-active"
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
          <span>Active Clients</span>
          {counts !== undefined && (
            <span
              className="ml-2 px-1.5 py-0 text-xs rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B] tabular-nums"
              data-testid="clients-count-active"
            >
              {counts.active}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => onTabChange('archived')}
          className={`inline-flex items-center justify-center whitespace-nowrap rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium transition-colors cursor-pointer shrink-0 select-none ${
            activeTab === 'archived'
              ? 'bg-[#FFFFFF] text-[#1E40AF] font-semibold shadow-2xs border-b-2 border-[#1D4ED8]'
              : 'text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B]'
          }`}
          data-testid="clients-tab-archived"
        >
          <Archive className="h-3.5 w-3.5 mr-2" />
          <span>Archived Clients</span>
          {counts !== undefined && (
            <span
              className="ml-2 px-1.5 py-0 text-xs rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B] tabular-nums"
              data-testid="clients-count-archived"
            >
              {counts.archived}
            </span>
          )}
        </button>
      </div>

      {/* Filter controls row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#475569]" />
          <Input
            type="text"
            placeholder="Search by ID, client name, TIN, or contact..."
            value={filters.search ?? ''}
            onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
            className="pl-8 text-xs h-9 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0] focus-visible:border-[#1D4ED8]"
            data-testid="clients-search-input"
          />
        </div>

        {/* Retainer Filter */}
        <div className="w-full sm:w-44">
          <Select
            value={filters.retainer === true ? 'retainer' : filters.retainer === false ? 'non-retainer' : 'all'}
            onValueChange={(val) => {
              if (val === 'retainer') onFilterChange({ retainer: true, page: 1 });
              else if (val === 'non-retainer') onFilterChange({ retainer: false, page: 1 });
              else onFilterChange({ retainer: undefined, page: 1 });
            }}
          >
            <SelectTrigger className="text-xs h-9 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0]" data-testid="clients-retainer-select">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              <SelectItem value="all" className="rounded-[6px]">All Retainer Types</SelectItem>
              <SelectItem value="retainer" className="rounded-[6px]">Retainer Clients Only</SelectItem>
              <SelectItem value="non-retainer" className="rounded-[6px]">Non-Retainer Clients</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Entity Filter (when needed) */}
        {filters.entity !== undefined && (
          <div className="w-full sm:w-36">
            <Select
              value={filters.entity ?? 'ALL'}
              onValueChange={(val) => onFilterChange({ entity: val === 'ALL' ? undefined : val, page: 1 })}
            >
              <SelectTrigger className="text-xs h-9 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0]" data-testid="clients-entity-select">
                <Building2 className="h-3.5 w-3.5 mr-1 text-[#475569]" />
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
                <SelectItem value="ALL" className="rounded-[6px]">All Entities</SelectItem>
                <SelectItem value="ATA" className="rounded-[6px]">ATA</SelectItem>
                <SelectItem value="LTA" className="rounded-[6px]">LTA</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Reset Filter Button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onReset}
          className="text-xs font-medium h-9 text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/70 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0] cursor-pointer"
          data-testid="clients-reset-filters-btn"
          title="Reset Filters"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Reset
        </Button>
      </div>
    </div>
  );
}
