import { Search, RotateCcw, Building2, Archive, CheckCircle2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
      {/* Tab Switcher: Active vs Archived */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onTabChange('active')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'active'
                ? 'bg-blue-50 text-blue-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            data-testid="clients-tab-active"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Active Clients</span>
            {counts !== undefined && (
              <Badge
                variant="secondary"
                className={`ml-1 text-[11px] px-1.5 py-0 h-4 ${
                  activeTab === 'active' ? 'bg-blue-200/60 text-blue-800' : 'bg-slate-200 text-slate-700'
                }`}
                data-testid="clients-count-active"
              >
                {counts.active}
              </Badge>
            )}
          </button>

          <button
            type="button"
            onClick={() => onTabChange('archived')}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
              activeTab === 'archived'
                ? 'bg-amber-50 text-amber-700 shadow-sm'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            data-testid="clients-tab-archived"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Archived Clients</span>
            {counts !== undefined && (
              <Badge
                variant="secondary"
                className={`ml-1 text-[11px] px-1.5 py-0 h-4 ${
                  activeTab === 'archived' ? 'bg-amber-200/60 text-amber-800' : 'bg-slate-200 text-slate-700'
                }`}
                data-testid="clients-count-archived"
              >
                {counts.archived}
              </Badge>
            )}
          </button>
        </div>
      </div>

      {/* Filter controls row */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            type="text"
            placeholder="Search by client name, TIN, or trade name..."
            value={filters.search ?? ''}
            onChange={(e) => onFilterChange({ search: e.target.value, page: 1 })}
            className="pl-8 text-xs h-9 bg-white"
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
            <SelectTrigger className="text-xs h-9 bg-white" data-testid="clients-retainer-select">
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Retainer Types</SelectItem>
              <SelectItem value="retainer">Retainer Clients Only</SelectItem>
              <SelectItem value="non-retainer">Non-Retainer Clients</SelectItem>
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
              <SelectTrigger className="text-xs h-9 bg-white" data-testid="clients-entity-select">
                <Building2 className="h-3.5 w-3.5 mr-1 text-slate-400" />
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Entities</SelectItem>
                <SelectItem value="ATA">ATA</SelectItem>
                <SelectItem value="LTA">LTA</SelectItem>
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
          className="text-xs h-9 text-slate-600 hover:text-slate-900 bg-white"
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
