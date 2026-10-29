import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, Eye, ChevronLeft, ChevronRight, Filter, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { DISBURSEMENT_CATEGORIES, DISBURSEMENT_STATUSES, FUND_SOURCES } from '../api/schemas';
import { useDisbursementsList } from '../api/useDisbursements';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { useClients } from '@/features/operations/api/useClients';
import { useTeam } from '@/features/operations/api/useTeam';
import { matchesDueDate, DUE_DATE_FILTER_OPTIONS } from '@/lib/dateFilters';
import { DisbursementStatusBadge } from './DisbursementStatusBadge';
import { FundsReleaseActions } from './FundsReleaseActions';
import { calculateDeadline } from '../lib/deadline';
import { useEntityRealtimeSync } from '@/lib/realtime';
import { useSessionStore } from '@/lib/session';
import type { Disbursement, DisbursementStatus, FundSource, DisbursementQueue } from '../api/types';

export interface DisbursementsTableProps {
  onSelectDisbursement: (id: string) => void;
  selectedId?: string | null;
  statusFilter?: DisbursementStatus;
  queueFilter?: DisbursementQueue;
}

export function DisbursementsTable({
  onSelectDisbursement,
  selectedId,
  statusFilter,
  queueFilter,
}: DisbursementsTableProps) {
  // Realtime CDC Subscriptions (Parcel E)
  useEntityRealtimeSync({ table: 'disbursements' });

  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<DisbursementStatus | ''>(statusFilter || '');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedFundSource, setSelectedFundSource] = useState<FundSource | ''>('');
  const [selectedWorkRequest, setSelectedWorkRequest] = useState<string>('');
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [selectedDueDate, setSelectedDueDate] = useState<string>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  const user = useSessionStore((state) => state.user);
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  const { data: rawWrs } = useWorkRequests({ archived: false });
  const workRequests = useMemo(() => (Array.isArray(rawWrs) ? rawWrs : rawWrs?.data ?? []), [rawWrs]);
  const { data: clientsData = [] } = useClients();
  const { data: teamData = [] } = useTeam();

  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const activeSelectedId = selectedId !== undefined ? selectedId : internalSelectedId;
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const handleSelectRow = (id: string) => {
    setInternalSelectedId(id);
    onSelectDisbursement(id);
  };

  // Active query
  const queryFilters = useMemo(() => {
    const filters: {
      search?: string;
      status?: DisbursementStatus;
      archived: false;
      category?: string;
      fundSource?: FundSource;
      queue?: DisbursementQueue;
      page: number;
      limit: number;
    } = { page, limit, archived: false };

    if (search.trim()) filters.search = search.trim();
    if (statusFilter) {
      filters.status = statusFilter;
    } else if (selectedStatus) {
      filters.status = selectedStatus;
    }
    if (selectedCategory) filters.category = selectedCategory;
    if (selectedFundSource) filters.fundSource = selectedFundSource;
    if (queueFilter) filters.queue = queueFilter;

    return filters;
  }, [
    search,
    statusFilter,
    selectedStatus,
    selectedCategory,
    selectedFundSource,
    queueFilter,
    page,
  ]);

  const { data: response, isLoading, isFetching, isError, error, refetch } = useDisbursementsList(queryFilters);
  const rawDisbursements = useMemo(() => response?.data ?? [], [response]);

  const disbursements = useMemo(() => {
    return rawDisbursements.filter((d) => {
      if (selectedWorkRequest) {
        const wrId = d.linked_work_request_id || d.linkedWorkRequestId;
        if (wrId !== selectedWorkRequest) return false;
      }
      if (selectedClient) {
        const cId = d.client_id || d.clientId;
        if (cId !== selectedClient) return false;
      }
      if (selectedEmployee) {
        const empId =
          d.employee_id ||
          d.employeeId ||
          d.requested_by ||
          d.requestedBy ||
          (d as unknown as Record<string, unknown>).created_by;
        if (empId !== selectedEmployee) return false;
      }
      if (selectedDueDate && selectedDueDate !== 'all') {
        const dd = d.due_date || d.dueDate;
        const isFinished =
          d.status === 'Funded' || d.status === 'Cancelled' || d.status === 'Rejected';
        if (!matchesDueDate(dd, selectedDueDate, isFinished)) return false;
      }
      return true;
    });
  }, [
    rawDisbursements,
    selectedWorkRequest,
    selectedClient,
    selectedEmployee,
    selectedDueDate,
  ]);
  const total = response?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const selectedIndex = useMemo(
    () => disbursements.findIndex((d) => d.id === activeSelectedId),
    [disbursements, activeSelectedId]
  );

  const activeEntity = useSessionStore((state) => state.activeEntity);
  const autoSelectedEntityRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      autoSelectedEntityRef.current !== activeEntity &&
      !isLoading &&
      disbursements.length > 0 &&
      onSelectDisbursement
    ) {
      autoSelectedEntityRef.current = activeEntity;
      // If a specific disbursement was already selected and belongs to this new list, preserve it
      if (selectedId && disbursements.some((d) => d.id === selectedId)) {
        return;
      }
      if (disbursements[0]) {
        onSelectDisbursement(disbursements[0].id);
      }
    }
  }, [disbursements, activeEntity, isLoading, selectedId, onSelectDisbursement]);

  const [focusedIndex, setFocusedIndex] = useState<number>(() => {
    return selectedIndex !== -1 ? selectedIndex : 0;
  });

  useEffect(() => {
    if (selectedIndex !== -1) {
      setFocusedIndex(selectedIndex);
    }
  }, [selectedIndex]);

  useEffect(() => {
    if (disbursements.length > 0 && focusedIndex >= disbursements.length) {
      setFocusedIndex(disbursements.length - 1);
    }
  }, [disbursements.length, focusedIndex]);

  const handleRowKeyDown = (
    e: React.KeyboardEvent<HTMLTableRowElement>,
    itemId: string,
    index: number
  ) => {
    // Only handle keys when the row itself is focused, not inner controls (e.g. action buttons)
    if (e.target !== e.currentTarget) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = Math.min(index + 1, disbursements.length - 1);
      setFocusedIndex(nextIndex);
      rowRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = Math.max(index - 1, 0);
      setFocusedIndex(prevIndex);
      rowRefs.current[prevIndex]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusedIndex(0);
      rowRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      const lastIndex = Math.max(0, disbursements.length - 1);
      setFocusedIndex(lastIndex);
      rowRefs.current[lastIndex]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSelectRow(itemId);
    }
  };

  const resetFilters = () => {
    setSearch('');
    if (!statusFilter) setSelectedStatus('');
    setSelectedCategory('');
    setSelectedFundSource('');
    setSelectedWorkRequest('');
    setSelectedClient('');
    setSelectedEmployee('');
    setSelectedDueDate('all');
    setPage(1);
  };

  const hasActiveFilters = Boolean(
    search ||
      (!statusFilter && selectedStatus) ||
      selectedCategory ||
      selectedFundSource ||
      selectedWorkRequest ||
      selectedClient ||
      selectedEmployee ||
      (selectedDueDate && selectedDueDate !== 'all')
  );

  return (
    <div className="flex flex-col h-full w-full overflow-hidden" data-testid="disbursements-table-container">
      {/* Compact Filter and Search Toolbar (Flush border, no gaps) */}
      <div className="flex items-center justify-between px-2 py-1 gap-1.5 bg-table-header border-b border-border shrink-0 h-8">
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none">
          {/* Search */}
          <div className="relative w-28 sm:w-32 lg:w-36 shrink-0">
            <Search className="h-2.5 w-2.5 absolute left-1.5 top-1.5 text-muted" />
            <Input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-5 text-[11px] h-6 rounded-[4px] bg-surface border-border py-0"
              data-testid="search-disbursements-input"
            />
          </div>

          {/* Status Filter (if not tab-locked) */}
          {!statusFilter && (
            <select
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value as DisbursementStatus | '');
                setPage(1);
              }}
              className="text-[11px] h-6 px-1 py-0 border rounded-[4px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary shrink-0 max-w-[76px] sm:max-w-[86px] truncate"
              data-testid="filter-status-select"
            >
              <option value="">All Statuses</option>
              {DISBURSEMENT_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          )}

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => {
              setSelectedCategory(e.target.value);
              setPage(1);
            }}
            className="text-[11px] h-6 px-1 py-0 border rounded-[4px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary shrink-0 max-w-[80px] sm:max-w-[92px] truncate"
            data-testid="filter-category-select"
          >
            <option value="">All Categories</option>
            {DISBURSEMENT_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          {/* Fund Source Filter */}
          <select
            value={selectedFundSource}
            onChange={(e) => {
              setSelectedFundSource(e.target.value as FundSource | '');
              setPage(1);
            }}
            className="text-[11px] h-6 px-1 py-0 border rounded-[4px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary shrink-0 max-w-[82px] sm:max-w-[94px] truncate"
            data-testid="filter-fund-source-select"
          >
            <option value="">All Fund Sources</option>
            {FUND_SOURCES.map((fs) => (
              <option key={fs} value={fs}>
                {fs}
              </option>
            ))}
          </select>

          {/* Work Request Filter */}
          <select
            value={selectedWorkRequest}
            onChange={(e) => {
              setSelectedWorkRequest(e.target.value);
              setPage(1);
            }}
            className="text-[11px] h-6 px-1 py-0 border rounded-[4px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary shrink-0 max-w-[88px] sm:max-w-[102px] truncate"
            data-testid="filter-work-request-select"
            title="Filter by Work Request"
          >
            <option value="">All Work Requests</option>
            {workRequests.map((wr) => (
              <option key={wr.id} value={wr.id}>
                {wr.title || wr.work_order_number || wr.id}
              </option>
            ))}
          </select>

          {/* Clients Filter */}
          <select
            value={selectedClient}
            onChange={(e) => {
              setSelectedClient(e.target.value);
              setPage(1);
            }}
            className="text-[11px] h-6 px-1 py-0 border rounded-[4px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary shrink-0 max-w-[76px] sm:max-w-[88px] truncate"
            data-testid="filter-client-select"
            title="Filter by Client"
          >
            <option value="">All Clients</option>
            {clientsData.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Employee Filter (Admin only) */}
          {isAdmin && (
            <select
              value={selectedEmployee}
              onChange={(e) => {
                setSelectedEmployee(e.target.value);
                setPage(1);
              }}
              className="text-[11px] h-6 px-1 py-0 border rounded-[4px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary shrink-0 max-w-[76px] sm:max-w-[88px] truncate"
              data-testid="filter-employee-select"
              title="Filter by Employee (Admin only)"
            >
              <option value="">All Employees</option>
              {teamData.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          {/* Due Date Filter */}
          <select
            value={selectedDueDate}
            onChange={(e) => {
              setSelectedDueDate(e.target.value);
              setPage(1);
            }}
            className="text-[11px] h-6 px-1 py-0 border rounded-[4px] bg-surface border-border text-ink focus:outline-none focus:ring-1 focus:ring-primary shrink-0 max-w-[76px] sm:max-w-[86px] truncate"
            data-testid="filter-due-date-select"
            title="Filter by Due Date"
          >
            {DUE_DATE_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-[11px] h-6 px-1 text-muted hover:text-ink cursor-pointer shrink-0"
              data-testid="reset-filters-btn"
            >
              Reset
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="text-xs h-6 px-1.5 text-muted hover:text-ink cursor-pointer"
            title="Refresh"
            data-testid="refresh-table-btn"
          >
            <RefreshCw className={`h-3 w-3 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
          <span className="text-xs text-muted">
            Total: <span className="font-semibold text-ink">{total}</span>
          </span>
        </div>
      </div>

      {/* Table Data (Edge to edge, flex-1) */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto [&>div]:border-none [&>div]:shadow-none [&>div]:rounded-none">
        <Table
          role="grid"
          aria-label="Disbursement vouchers"
          data-testid="disbursements-table"
        >
          <TableHeader className="sticky top-0 z-10 bg-sidebar border-b border-border shadow-xs">
            <TableRow role="row" className="bg-sidebar hover:bg-sidebar border-b border-border h-8">
                {/* 1. Selection indicator */}
                <TableHead role="columnheader" className="w-2 p-0 bg-sidebar sticky top-0 z-10" aria-label="Selection indicator" />
                {/* 2. Voucher # (mono) */}
                <TableHead role="columnheader" className="w-36 text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10">
                  Voucher #
                </TableHead>
                {/* 4. Entity badge */}
                <TableHead role="columnheader" className="w-20 text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10 text-center">
                  Entity
                </TableHead>
                {/* 5. Description (truncate + title) */}
                <TableHead role="columnheader" className="text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10">
                  Description
                </TableHead>
                {/* 6. Category */}
                <TableHead role="columnheader" className="w-28 text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10">
                  Category
                </TableHead>
                {/* 7. Fund source */}
                <TableHead role="columnheader" className="w-28 text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10">
                  Fund Source
                </TableHead>
                {/* 8. Amount (PHP, right, tabular-nums) */}
                <TableHead role="columnheader" className="w-32 text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10 text-right">
                  Amount (PHP)
                </TableHead>
                {/* 9. Status badge */}
                <TableHead role="columnheader" className="w-28 text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10 text-center">
                  Status
                </TableHead>
                {/* 10. Actions (only below 1024px / lg:hidden) */}
                <TableHead role="columnheader" className="w-24 text-xs font-semibold text-text-secondary bg-sidebar sticky top-0 z-10 text-right lg:hidden">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            {isLoading ? (
              <TableBody data-testid="table-loading" aria-busy="true">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <TableRow
                    key={`skeleton-${idx}`}
                    role="row"
                    className="h-[var(--row-height-default,48px)] border-b border-border bg-surface select-none"
                  >
                    {/* Selection indicator */}
                    <TableCell role="gridcell" className="w-2 p-0 text-center">
                      <div className="w-[3px] h-8 bg-transparent" />
                    </TableCell>
                    {/* Voucher # */}
                    <TableCell role="gridcell" className="w-36">
                      <div className="h-3.5 w-24 bg-sidebar rounded-[4px] animate-pulse" />
                    </TableCell>
                    {/* Entity */}
                    <TableCell role="gridcell" className="w-20 text-center">
                      <div className="h-4 w-10 bg-sidebar rounded-[4px] mx-auto animate-pulse" />
                    </TableCell>
                    {/* Description */}
                    <TableCell role="gridcell" className="min-w-[180px]">
                      <div className="space-y-1">
                        <div className="h-3.5 w-40 bg-sidebar rounded-[4px] animate-pulse" />
                        <div className="h-2.5 w-24 bg-sidebar rounded-[4px] animate-pulse" />
                        {idx === 0 && (
                          <span className="sr-only">Loading disbursements...</span>
                        )}
                      </div>
                    </TableCell>
                    {/* Category */}
                    <TableCell role="gridcell" className="w-28">
                      <div className="h-3.5 w-20 bg-sidebar rounded-[4px] animate-pulse" />
                    </TableCell>
                    {/* Fund source */}
                    <TableCell role="gridcell" className="w-28">
                      <div className="h-4 w-16 bg-sidebar rounded-[4px] animate-pulse" />
                    </TableCell>
                    {/* Amount */}
                    <TableCell role="gridcell" className="w-32 text-right">
                      <div className="h-3.5 w-16 bg-sidebar rounded-[4px] ml-auto animate-pulse" />
                    </TableCell>
                    {/* Status */}
                    <TableCell role="gridcell" className="w-28 text-center">
                      <div className="h-4 w-16 bg-sidebar rounded-[4px] mx-auto animate-pulse" />
                    </TableCell>
                    {/* Actions (lg:hidden) */}
                    <TableCell role="gridcell" className="w-24 text-right lg:hidden">
                      <div className="h-6 w-12 bg-sidebar rounded-[4px] ml-auto animate-pulse" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            ) : isError ? (
              <TableBody>
                <TableRow role="row">
                  <TableCell
                    role="gridcell"
                    colSpan={10}
                    className="h-48 text-center text-xs text-muted"
                    data-testid="table-error"
                  >
                    <div className="py-8 space-y-2.5">
                      <div className="w-10 h-10 rounded-full bg-danger-surface flex items-center justify-center mx-auto border border-danger-border">
                        <AlertCircle className="h-5 w-5 text-danger" />
                      </div>
                      <p className="text-sm font-semibold text-ink">Failed to load disbursements</p>
                      <p className="text-xs text-muted max-w-sm mx-auto">
                        {error instanceof Error ? error.message : 'An error occurred while fetching vouchers.'}
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => refetch()}
                        className="text-xs h-8 px-3 text-ink border-border hover:bg-hover cursor-pointer"
                        data-testid="table-retry-btn"
                      >
                        Retry
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : disbursements.length === 0 ? (
              <TableBody>
                <TableRow role="row">
                  <TableCell
                    role="gridcell"
                    colSpan={10}
                    className="h-48 text-center text-xs text-muted"
                    data-testid="table-empty"
                  >
                    <div className="py-8 space-y-2">
                      <div className="w-10 h-10 rounded-full bg-sidebar flex items-center justify-center mx-auto border border-border">
                        <Filter className="h-5 w-5 text-muted" />
                      </div>
                      <p className="text-sm font-semibold text-ink">No disbursements found</p>
                      <p className="text-xs text-muted max-w-sm mx-auto">
                        Try adjusting your search criteria, clearing active filters, or creating a new voucher.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              </TableBody>
            ) : (
              <TableBody>
                {disbursements.map((item: Disbursement, index: number) => {
                  const disbNumber =
                    item.disbursement_number ||
                    item.disbursementNumber ||
                    `DISB-${item.id.slice(0, 8)}`;

                  const entityCode =
                    item.entity_code ||
                    item.entityCode ||
                    (item.disbursement_number?.includes('LTA')
                      ? 'LTA'
                      : item.disbursement_number?.includes('ATA')
                        ? 'ATA'
                        : undefined);

                  const deadline = calculateDeadline(item.due_date || item.dueDate);
                  const isSelected = activeSelectedId === item.id;
                  const isTabbable = focusedIndex === index;

                  return (
                    <TableRow
                      key={item.id}
                      ref={(el) => {
                        rowRefs.current[index] = el;
                      }}
                      tabIndex={isTabbable ? 0 : -1}
                      role="row"
                      aria-selected={isSelected}
                      onClick={() => handleSelectRow(item.id)}
                      onFocus={() => setFocusedIndex(index)}
                      onKeyDown={(e) => handleRowKeyDown(e, item.id, index)}
                      className={cn(
                        'cursor-pointer border-b border-border h-[var(--row-height-default,48px)] transition-colors duration-150 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
                        isSelected ? 'bg-selected text-ink' : 'hover:bg-hover/60 text-ink'
                      )}
                      data-testid={`disbursement-row-${item.id}`}
                    >
                      {/* 1. Selection indicator */}
                      <TableCell role="gridcell" className="w-2 p-0 text-center">
                        <div
                          className={cn(
                            'w-[3px] h-8 rounded-r-xs transition-[background-color] duration-150 motion-safe:ease-out',
                            isSelected ? 'bg-primary' : 'bg-transparent'
                          )}
                          aria-hidden="true"
                        />
                        <span className="sr-only" data-testid={`deadline-indicator-${item.id}`}>
                          {deadline.urgency === 'none' ? '—' : deadline.label}
                        </span>
                      </TableCell>

                      {/* 2. Voucher # (mono) */}
                      <TableCell role="gridcell" className="w-36 font-mono text-xs font-semibold tabular-nums text-ink">
                        {disbNumber}
                      </TableCell>

                      {/* 4. Entity badge */}
                      <TableCell role="gridcell" className="w-20 text-center">
                        {entityCode === 'ATA' ? (
                          <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-[6px] bg-blue-50 text-ata border border-blue-300">
                            ATA
                          </span>
                        ) : entityCode === 'LTA' ? (
                          <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-[6px] bg-sky-50 text-sky-800 border border-sky-300">
                            LTA
                          </span>
                        ) : entityCode ? (
                          <span className="inline-block text-xs font-semibold px-2 py-0.5 rounded-[6px] bg-sidebar text-text-secondary border border-border">
                            {entityCode}
                          </span>
                        ) : (
                          <span className="text-xs text-muted font-mono">—</span>
                        )}
                      </TableCell>

                      {/* 5. Description (truncate + title) */}
                      <TableCell role="gridcell" className="min-w-[180px]">
                        <div className="space-y-0.5">
                          <p
                            className="text-xs font-medium text-ink truncate max-w-sm"
                            title={item.description}
                          >
                            {item.description}
                          </p>
                          <p className="text-xs tabular-nums text-muted truncate max-w-sm flex items-center gap-1 flex-wrap">
                            <span>{new Date(item.created_at || item.createdAt || '').toLocaleDateString()}</span>
                            {Boolean(item.clientNumber || item.client_number || item.clients?.clientNumber || item.clients?.client_number) && (
                              <span className="font-mono text-xs font-medium text-text-secondary tabular-nums bg-canvas border border-border px-1 py-0.2 rounded">
                                {item.clientNumber || item.client_number || item.clients?.clientNumber || item.clients?.client_number}
                              </span>
                            )}
                            {item.client_name ? <span>• {item.client_name}</span> : null}
                            {Boolean(item.workRequestNumber || item.work_request_number || item.linked_work_request_order_number) && (
                              <span className="font-mono text-xs font-medium text-text-secondary tabular-nums bg-canvas border border-border px-1 py-0.2 rounded">
                                {item.workRequestNumber || item.work_request_number || item.linked_work_request_order_number}
                              </span>
                            )}
                            {item.linked_work_request_name ? (
                              <span>• {item.linked_work_request_name}</span>
                            ) : null}
                          </p>
                        </div>
                      </TableCell>

                      {/* 6. Category */}
                      <TableCell role="gridcell" className="w-28 text-xs text-ink">{item.category}</TableCell>

                      {/* 7. Fund source */}
                      <TableCell role="gridcell" className="w-28">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-[6px] bg-sidebar border border-border text-text-secondary inline-block">
                          {item.fund_source || item.fundSource}
                        </span>
                      </TableCell>

                      {/* 8. Amount (PHP, right, tabular-nums) */}
                      <TableCell role="gridcell" className="w-32 text-xs font-bold text-ink text-right tabular-nums">
                        ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                      </TableCell>

                      {/* 9. Status badge */}
                      <TableCell role="gridcell" className="w-28 text-center">
                        <DisbursementStatusBadge
                          status={item.status}
                          reviewReady={item.review_ready}
                        />
                      </TableCell>

                      {/* 10. Actions (only below 1024px / lg:hidden) */}
                      <TableCell role="gridcell" className="w-24 text-right lg:hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <FundsReleaseActions disbursement={item} />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSelectRow(item.id)}
                            className="h-7 w-7 p-0 text-muted hover:text-ink"
                            title="View Details"
                            data-testid={`view-action-${item.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            )}
          </Table>
        </div>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-canvas/50 text-xs text-muted">
            <span>
              Page <span className="font-semibold text-ink">{page}</span> of{' '}
              <span className="font-semibold text-ink">{totalPages}</span>
            </span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="h-7 px-2 text-xs"
                data-testid="pagination-prev-btn"
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-0.5" /> Prev
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                className="h-7 px-2 text-xs"
                data-testid="pagination-next-btn"
              >
                Next <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
  );
}
