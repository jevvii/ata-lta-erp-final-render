import { useState, useMemo } from 'react';
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Printer,
  CreditCard,
  Eye,
  Building,
  Calendar,
  FileText,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useInvoices } from '../api/useInvoices';
import { useClients } from '@/features/operations/api/useClients';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { useTeam } from '@/features/operations/api/useTeam';
import { useSessionStore } from '@/lib/session';
import { matchesDueDate, DUE_DATE_FILTER_OPTIONS } from '@/lib/dateFilters';
import { useDebounce } from '../hooks/useDebounce';
import { usePermission } from '@/lib/permissions';
import { formatCurrency, getStatusBadgeVariant } from '../utils/formatters';
import { ViewModeToggle } from './ViewModeToggle';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { Invoice, InvoiceStatus } from '../api/types';

export interface InvoiceListProps {
  onSelectInvoice?: (invoice: Invoice) => void;
  /** @deprecated Creation moved to BillingPage header */
  onCreateInvoice?: () => void;
  onRecordPayment?: (invoice: Invoice) => void;
  onPrintPreview?: (invoice: Invoice) => void;
}

const STATUS_TABS: Array<{ label: string; value: InvoiceStatus | 'All' }> = [
  { label: 'All', value: 'All' },
  { label: 'Draft', value: 'Draft' },
  { label: 'Sent', value: 'Sent' },
  { label: 'Partially Paid', value: 'Partially Paid' },
  { label: 'Paid', value: 'Paid' },
  { label: 'Overdue', value: 'Overdue' },
  { label: 'Cancelled', value: 'Cancelled' },
];

export function InvoiceList({
  onSelectInvoice,
  onRecordPayment,
  onPrintPreview,
}: InvoiceListProps) {
  // Realtime CDC Subscriptions (Parcel E)
  useEntityRealtimeSync({ table: 'invoices' });

  // View mode
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Filter state
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'All'>('All');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [workRequestFilter, setWorkRequestFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [dueDateFilter, setDueDateFilter] = useState<string>('all');
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Permissions (hooks must be unconditional)
  const canRecordPayment = usePermission('billing:payments');
  const user = useSessionStore((state) => state.user);
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  // Queries
  const { data: clientsData } = useClients();
  const clientsList = clientsData || [];
  const { data: rawWrs } = useWorkRequests({ archived: false });
  const workRequests = useMemo(() => (Array.isArray(rawWrs) ? rawWrs : rawWrs?.data ?? []), [rawWrs]);
  const { data: teamData = [] } = useTeam();

  const effectiveStatus = statusFilter === 'Approved' ? 'Sent' : statusFilter;
  const { data: invoicesResponse, isLoading } = useInvoices({
    status: effectiveStatus,
    clientId: clientFilter !== 'all' ? clientFilter : undefined,
    search: debouncedSearch || undefined,
    archived: false,
    page,
    limit: pageSize,
  });

  const rawInvoices = useMemo(() => invoicesResponse?.data || [], [invoicesResponse?.data]);
  const invoices = useMemo(() => {
    return rawInvoices.filter((inv) => {
      if (workRequestFilter !== 'all') {
        const wrId = inv.work_request_id || inv.work_request?.id;
        if (wrId !== workRequestFilter) return false;
      }
      if (employeeFilter !== 'all') {
        const creator =
          inv.work_request?.creatorName ||
          inv.work_request_creator_name ||
          (inv as unknown as Record<string, unknown>).created_by;
        const matchesNameOrId =
          creator === employeeFilter ||
          teamData.find((t) => t.id === employeeFilter)?.name === creator;
        if (!matchesNameOrId) return false;
      }
      if (dueDateFilter !== 'all') {
        const isFinished = inv.status === 'Paid' || inv.status === 'Cancelled';
        if (!matchesDueDate(inv.due_date, dueDateFilter, isFinished)) return false;
      }
      return true;
    });
  }, [rawInvoices, workRequestFilter, employeeFilter, dueDateFilter, teamData]);
  const totalCount = invoicesResponse?.meta?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Stats calculation
  const stats = useMemo(() => {
    let totalValue = 0;
    let outstandingBalance = 0;
    let overdueCount = 0;

    for (const inv of invoices) {
      totalValue += Number(inv.total || 0);
      outstandingBalance += Number(inv.balance || 0);
      if (inv.status === 'Overdue') {
        overdueCount += 1;
      }
    }

    return {
      totalValue,
      outstandingBalance,
      overdueCount,
      count: totalCount,
    };
  }, [invoices, totalCount]);

  const resetFilters = () => {
    setStatusFilter('All');
    setClientFilter('all');
    setWorkRequestFilter('all');
    setEmployeeFilter('all');
    setDueDateFilter('all');
    setSearchInput('');
    setPage(1);
  };

  const hasActiveFilters =
    statusFilter !== 'All' ||
    clientFilter !== 'all' ||
    workRequestFilter !== 'all' ||
    employeeFilter !== 'all' ||
    dueDateFilter !== 'all' ||
    searchInput.trim().length > 0;

  return (
    <div className="space-y-4" data-testid="invoice-list-container">
      {/* 1. Stats Bar */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-0 divide-x divide-y md:divide-y-0 divide-[#CBD5E1] bg-[#FFFFFF] p-0 rounded-[8px] border-[#E2E8F0] shadow-none"
        data-testid="billing-stats-bar"
      >
        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs font-bold tracking-normal text-[#475569]">Total Invoices</span>
          <span className="text-xl font-semibold text-[#1E293B] tabular-nums" data-testid="stat-total-invoices">
            {stats.count}
          </span>
        </div>
        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs font-bold tracking-normal text-[#475569]">Total Value</span>
          <span className="text-xl font-semibold text-[#1E293B] tabular-nums" data-testid="stat-total-value">
            {formatCurrency(stats.totalValue)}
          </span>
        </div>
        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs font-bold tracking-normal text-[#475569]">Outstanding Balance</span>
          <span
            className="text-xl font-semibold text-[#1E293B] tabular-nums"
            data-testid="stat-outstanding-balance"
          >
            {formatCurrency(stats.outstandingBalance)}
          </span>
        </div>
        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs font-bold tracking-normal text-[#475569]">Overdue Invoices</span>
          <span
            className={`text-xl font-semibold tabular-nums ${stats.overdueCount > 0 ? 'text-[#DC2626]' : 'text-[#1E293B]'}`}
            data-testid="stat-overdue-count"
          >
            {stats.overdueCount}
          </span>
        </div>
      </div>

      {/* 2. Status Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center bg-[#F8FAFC] border-[#E2E8F0] border-b-2 rounded-[6px] divide-x divide-[#CBD5E1] overflow-x-auto p-0" data-testid="status-tabs">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
              }}
              className={`px-3 py-2 text-xs  font-bold rounded-[6px] transition-all whitespace-nowrap cursor-pointer ${
                statusFilter === tab.value
                  ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs '
                  : 'text-[#475569] hover:bg-[#E2E8F0] hover:text-[#1E293B]'
              }`}
              data-testid={`tab-${tab.value.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* View Toggle & Create Button */}
        <div className="flex items-center gap-2">
          <ViewModeToggle
            mode={viewMode}
            onChange={(m) => setViewMode(m as 'table' | 'cards')}
            availableModes={['table', 'cards']}
            testIdPrefix="view-mode"
            className="hidden sm:flex"
          />
        </div>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#475569]" />
            <Input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              placeholder="Search invoice number or notes..."
              className="pl-9 h-9 text-xs"
              data-testid="invoice-search-input"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-2.5 text-[#475569] hover:text-[#475569]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Client Filter */}
          <div className="w-[140px] sm:w-[160px]">
            <Select
              value={clientFilter}
              onValueChange={(val) => {
                setClientFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs" data-testid="client-filter-select">
                <SelectValue placeholder="All Clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clientsList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Work Request Filter */}
          <div className="w-[140px] sm:w-[160px]">
            <Select
              value={workRequestFilter}
              onValueChange={(val) => {
                setWorkRequestFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs" data-testid="work-request-filter-select">
                <SelectValue placeholder="All Work Requests" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Work Requests</SelectItem>
                {workRequests.map((wr) => (
                  <SelectItem key={wr.id} value={wr.id}>
                    {wr.title || wr.work_order_number || wr.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Employee Filter (Admin only) */}
          {isAdmin && (
            <div className="w-[140px] sm:w-[160px]">
              <Select
                value={employeeFilter}
                onValueChange={(val) => {
                  setEmployeeFilter(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 text-xs" data-testid="employee-filter-select">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {teamData.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Due Date Filter */}
          <div className="w-[130px] sm:w-[150px]">
            <Select
              value={dueDateFilter}
              onValueChange={(val) => {
                setDueDateFilter(val);
                setPage(1);
              }}
            >
              <SelectTrigger className="h-9 text-xs" data-testid="due-date-filter-select">
                <SelectValue placeholder="All Due Dates" />
              </SelectTrigger>
              <SelectContent>
                {DUE_DATE_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-9 text-xs text-[#475569] hover:text-[#1E293B] gap-1 px-2 cursor-pointer"
              data-testid="clear-filters-button"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>

        <div className="text-xs text-[#475569] self-center">
          Showing <span className="font-semibold text-[#1E293B]">{invoices.length}</span> of{' '}
          <span className="font-semibold text-[#1E293B]">{totalCount}</span>
        </div>
      </div>

      {/* 4. Content Area: Table or Cards */}
      {isLoading ? (
        <div className="p-12 text-center text-[#475569] bg-white rounded-[8px] border-[#E2E8F0]">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b border-[#E2E8F0] mb-2"></div>
          <p className="text-xs">Loading invoices...</p>
        </div>
      ) : invoices.length === 0 ? (
        <div
          className="p-12 text-center bg-white rounded-[8px] border-[#E2E8F0] space-y-3"
          data-testid="empty-invoices"
        >
          <FileText className="w-10 h-10 text-[#94A3B8] mx-auto" />
          <h3 className="text-sm font-semibold text-[#1E293B]">No invoices found</h3>
          <p className="text-xs text-[#475569] max-w-sm mx-auto">
            {hasActiveFilters
              ? 'No invoices match the selected filters. Try adjusting your query or resetting filters.'
              : 'There are no invoices recorded in the system yet.'}
          </p>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters} className="text-xs">
              Clear filters
            </Button>
          )}
        </div>
      ) : viewMode === 'table' ? (
        <div className="bg-white rounded-[8px] border-[#E2E8F0] shadow-none overflow-hidden">
          <Table>
            <TableHeader className="bg-[#F8FAFC]">
              <TableRow>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Invoice #</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Client</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Issue Date</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Due Date</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B]">Status</TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B] text-right">
                  Total
                </TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B] text-right">
                  Balance
                </TableHead>
                <TableHead className="text-xs font-semibold text-[#1E293B] text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => {
                const isReleased = ['Sent', 'Approved', 'Partially Paid', 'Overdue'].includes(
                  inv.status
                );
                const hasBalance = Number(inv.balance || 0) > 0;

                return (
                  <TableRow
                    key={inv.id}
                    className="hover:bg-[#F8FAFC]/80 transition-colors cursor-pointer"
                    onClick={() => onSelectInvoice && onSelectInvoice(inv)}
                    data-testid={`invoice-row-${inv.id}`}
                  >
                    <TableCell className="font-semibold text-[#1E293B] text-xs py-3">
                      <div className="flex items-center gap-1.5">
                        {inv.entity_code && (
                          <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                            {inv.entity_code}
                          </Badge>
                        )}
                        <span>{inv.invoice_number}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-[#1E293B] py-3">
                      {inv.clients?.name || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-[#475569] py-3">
                      {inv.issue_date?.slice(0, 10) || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-[#475569] py-3">
                      {inv.due_date?.slice(0, 10) || '—'}
                    </TableCell>
                    <TableCell className="py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs  font-medium border ${getStatusBadgeVariant(
                          inv.status
                        )}`}
                        data-testid={`badge-status-${inv.status.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-medium text-[#1E293B] text-right py-3">
                      {formatCurrency(inv.total)}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-right py-3">
                      <span
                        className={Number(inv.balance || 0) > 0 ? 'text-amber-600' : 'text-[#475569]'}
                      >
                        {formatCurrency(inv.balance)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onPrintPreview && onPrintPreview(inv)}
                          title="Print Preview"
                          className="h-7 w-7 text-[#475569] hover:text-[#1E293B] cursor-pointer"
                          data-testid={`btn-print-preview-${inv.id}`}
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </Button>

                        {canRecordPayment && isReleased && hasBalance && onRecordPayment && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => onRecordPayment(inv)}
                            title="Record Payment"
                            className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 cursor-pointer"
                            data-testid={`btn-record-payment-${inv.id}`}
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onSelectInvoice && onSelectInvoice(inv)}
                          title="View Details"
                          className="h-7 w-7 text-[#475569] hover:text-[#1E293B] cursor-pointer"
                          data-testid={`btn-view-${inv.id}`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        /* Card View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="invoice-cards">
          {invoices.map((inv) => {
            const isReleased = ['Sent', 'Approved', 'Partially Paid', 'Overdue'].includes(
              inv.status
            );
            const hasBalance = Number(inv.balance || 0) > 0;

            return (
              <div
                key={inv.id}
                onClick={() => onSelectInvoice && onSelectInvoice(inv)}
                className="bg-white p-4 rounded-[8px] border-[#E2E8F0] shadow-none hover:border-[#E2E8F0] transition-all cursor-pointer flex flex-col justify-between space-y-3"
                data-testid={`invoice-card-${inv.id}`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {inv.entity_code && (
                        <Badge variant="outline" className="text-xs px-1 py-0 h-4">
                          {inv.entity_code}
                        </Badge>
                      )}
                      <span className="font-bold text-xs text-[#1E293B]">
                        {inv.invoice_number}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs  font-medium border ${getStatusBadgeVariant(
                        inv.status
                      )}`}
                    >
                      {inv.status}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-[#1E293B] flex items-center gap-1">
                    <Building className="w-3 h-3 text-[#475569]" />
                    <span className="truncate">{inv.clients?.name || 'No client linked'}</span>
                  </p>

                  <div className="mt-2 pt-2 border-t border-[#E2E8F0] flex items-center justify-between text-xs text-[#475569]">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-[#475569]" />
                      Due: {inv.due_date?.slice(0, 10) || '—'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#E2E8F0] flex items-center justify-between">
                  <div>
                    <span className="text-xs tabular-nums text-[#475569] block">Balance Due</span>
                    <span
                      className={`text-xs font-bold ${
                        Number(inv.balance || 0) > 0 ? 'text-amber-600' : 'text-[#475569]'
                      }`}
                    >
                      {formatCurrency(inv.balance)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onPrintPreview && onPrintPreview(inv)}
                      className="h-7 w-7 text-[#475569] hover:text-[#1E293B] cursor-pointer"
                      title="Print Preview"
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </Button>
                    {canRecordPayment && isReleased && hasBalance && onRecordPayment && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onRecordPayment(inv)}
                        className="h-7 w-7 text-emerald-600 hover:bg-emerald-50 cursor-pointer"
                        title="Record Payment"
                      >
                        <CreditCard className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Pagination Controls */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-between border-t border-[#E2E8F0] pt-3"
          data-testid="invoice-pagination"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#475569]">Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                setPageSize(Number(val));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-[#475569]" data-testid="page-indicator">
              Page {page} of {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-7 w-7 cursor-pointer"
                data-testid="pagination-prev"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 w-7 cursor-pointer"
                data-testid="pagination-next"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
