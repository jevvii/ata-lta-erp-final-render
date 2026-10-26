/**
 * Document Filter Bar Component
 *
 * Filter bar supporting search, category filter (9 categories), and physical lifecycle filter.
 */

import { Search, RotateCcw, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DOCUMENT_CATEGORIES, DOCUMENT_LIFECYCLE_STAGES } from '../api/types';
import { CATEGORY_LABELS, LIFECYCLE_LABELS } from '../constants';


export interface DocumentFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  category: string;
  onCategoryChange: (value: string) => void;
  lifecycle: string;
  onLifecycleChange: (value: string) => void;
  onReset: () => void;
  onUploadClick?: () => void;
  canUpload?: boolean;
}

export function DocumentFilterBar({
  search,
  onSearchChange,
  category,
  onCategoryChange,
  lifecycle,
  onLifecycleChange,
  onReset,
  onUploadClick,
  canUpload = false,
}: DocumentFilterBarProps) {
  const isFiltered = Boolean(search || category || lifecycle);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-[#FFFFFF] p-3 border-[#E2E8F0] rounded-[6px]">
      <div className="flex flex-1 flex-wrap items-center gap-3">
        {/* Search Input */}
        <div className="relative min-w-[220px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#475569]" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, description..."
            className="pl-9 h-9 text-xs rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]"
            data-testid="document-search-input"
          />
        </div>

        {/* Category Select */}
        <div className="w-[180px]">
          <Select
            value={category || 'all'}
            onValueChange={(val) => onCategoryChange(val === 'all' ? '' : val)}
          >
            <SelectTrigger className="h-9 text-xs rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]" data-testid="document-category-filter">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
              <SelectItem value="all">All Categories</SelectItem>
              {DOCUMENT_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {CATEGORY_LABELS[cat] || cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Lifecycle Select */}
        <div className="w-[180px]">
          <Select
            value={lifecycle || 'all'}
            onValueChange={(val) => onLifecycleChange(val === 'all' ? '' : val)}
          >
            <SelectTrigger className="h-9 text-xs rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]" data-testid="document-lifecycle-filter">
              <SelectValue placeholder="All Stages" />
            </SelectTrigger>
            <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
              <SelectItem value="all">All Stages</SelectItem>
              {DOCUMENT_LIFECYCLE_STAGES.map((stage) => (
                <SelectItem key={stage} value={stage}>
                  {LIFECYCLE_LABELS[stage] || stage}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Reset Filters Button */}
        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-9 text-xs text-[#475569] hover:text-[#1E293B] rounded-[6px]"
            data-testid="document-reset-filters-btn"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
        )}
      </div>

      {/* Upload Action Button */}
      {canUpload && onUploadClick && (
        <div className="flex items-center">
          <Button
            onClick={onUploadClick}
            className="h-9 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs text-xs font-bold"
            data-testid="upload-document-button"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Upload Document
          </Button>
        </div>
      )}
    </div>
  );
}
