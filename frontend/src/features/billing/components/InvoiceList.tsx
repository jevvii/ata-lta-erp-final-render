import { useState, useMemo } from 'react';
import {
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
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
import { useDebounce } from '../hooks/useDebounce';
import { usePermission } from '@/lib/permissions';
import { formatCurrency, getStatusBadgeVariant } from '../utils/formatters';
import { ViewModeToggle } from './ViewModeToggle';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { Invoice, InvoiceStatus } from '../api/types';

export interface InvoiceListProps {
  onSelectInvoice?: (invoice: Invoice) => void;
  onCreateInvoice?: () => void;
  onRecordPayment?: (invoice: Invoice) => void;
  onPrintPreview?: (invoice: Invoice) => void;
}

const STATUS_TABS: Array<{ label: string; value: InvoiceStatus | 'All' }> = [
  { label: 'All', value: 'All' },
  { label: 'Draft', value: 'Draft' },
  { label: 'Approved', value: 'Approved' },
  { label: 'Pending', value: 'Pending' },
  { label: 'Sent', value: 'Sent' },
  { label: 'Partially Paid', value: 'Partially Paid' },
  { label: 'Paid', value: 'Paid' },
  { label: 'Overdue', value: 'Overdue' },
];

export function InvoiceList({
  onSelectInvoice,
  onCreateInvoice,
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
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Permissions (hooks must be unconditional)
  const canEdit = usePermission('billing:edit');
  const canCreate = canEdit;
  const canRecordPayment = usePermission('billing:payments');

  // Queries
  const { data: clientsData } = useClients();
  const clientsList = clientsData || [];

  const { data: invoicesResponse, isLoading } = useInvoices({
    status: statusFilter,
    clientId: clientFilter !== 'all' ? clientFilter : undefined,
    search: debouncedSearch || undefined,
    archived: false,
    page,
    limit: pageSize,
  });

  const invoices = useMemo(() => invoicesResponse?.data || [], [invoicesResponse?.data]);
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
    setSearchInput('');
    setPage(1);
  };

  const hasActiveFilters =
    statusFilter !== 'All' || clientFilter !== 'all' || searchInput.trim().length > 0;

  return (
    <div className="space-y-4" data-testid="invoice-list-container">
      {/* 1. Stats Bar */}
      <div
        className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xs"
        data-testid="billing-stats-bar"
      >
        <div className="flex flex-col">
          <span className="text-xs font-medium text-slate-500">Total Invoices</span>
          <span className="text-xl font-bold text-slate-900" data-testid="stat-total-invoices">
            {stats.count}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium text-slate-500">Total Value</span>
          <span className="text-xl font-bold text-slate-900" data-testid="stat-total-value">
            {formatCurrency(stats.totalValue)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium text-slate-500">Outstanding Balance</span>
          <span
            className="text-xl font-bold text-amber-600"
            data-testid="stat-outstanding-balance"
          >
            {formatCurrency(stats.outstandingBalance)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium text-slate-500">Overdue Invoices</span>
          <span
            className={`text-xl font-bold ${stats.overdueCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}
            data-testid="stat-overdue-count"
          >
            {stats.overdueCount}
          </span>
        </div>
      </div>

      {/* 2. Status Filter Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-1 overflow-x-auto py-1" data-testid="status-tabs">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => {
                setStatusFilter(tab.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                statusFilter === tab.value
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
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

          {canCreate && onCreateInvoice && (
            <Button
              onClick={onCreateInvoice}
              className="bg-blue-600 hover:bg-blue-700 text-white shadow-xs text-xs h-8 gap-1.5 cursor-pointer"
              data-testid="create-invoice-button"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Invoice</span>
            </Button>
          )}
        </div>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
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
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Client Filter */}
          <div className="w-[180px]">
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

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-9 text-xs text-slate-500 hover:text-slate-900 gap-1 px-2 cursor-pointer"
              data-testid="clear-filters-button"
            >
              <X className="w-3.5 h-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>

        <div className="text-xs text-slate-500 self-center">
          Showing <span className="font-semibold text-slate-700">{invoices.length}</span> of{' '}
          <span className="font-semibold text-slate-700">{totalCount}</span>
        </div>
      </div>

      {/* 4. Content Area: Table or Cards */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
          <p className="text-xs">Loading invoices...</p>
        </div>
      ) : invoices.length === 0 ? (
        <div
          className="p-12 text-center bg-white rounded-xl border border-slate-200 space-y-3"
          data-testid="empty-invoices"
        >
          <FileText className="w-10 h-10 text-slate-300 mx-auto" />
          <h3 className="text-sm font-semibold text-slate-800">No invoices found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs font-semibold text-slate-700">Invoice #</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Client</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Issue Date</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Due Date</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Status</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Total
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Balance
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
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
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    onClick={() => onSelectInvoice && onSelectInvoice(inv)}
                    data-testid={`invoice-row-${inv.id}`}
                  >
                    <TableCell className="font-semibold text-slate-900 text-xs py-3">
                      <div className="flex items-center gap-1.5">
                        {inv.entity_code && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                            {inv.entity_code}
                          </Badge>
                        )}
                        <span>{inv.invoice_number}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700 py-3">
                      {inv.clients?.name || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 py-3">
                      {inv.issue_date?.slice(0, 10) || '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 py-3">
                      {inv.due_date?.slice(0, 10) || '—'}
                    </TableCell>
                    <TableCell className="py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${getStatusBadgeVariant(
                          inv.status
                        )}`}
                        data-testid={`badge-status-${inv.status.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {inv.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-medium text-slate-900 text-right py-3">
                      {formatCurrency(inv.total)}
                    </TableCell>
                    <TableCell className="text-xs font-semibold text-right py-3">
                      <span
                        className={Number(inv.balance || 0) > 0 ? 'text-amber-600' : 'text-slate-400'}
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
                          className="h-7 w-7 text-slate-500 hover:text-slate-900 cursor-pointer"
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
                          className="h-7 w-7 text-slate-500 hover:text-slate-900 cursor-pointer"
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
                className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-slate-300 transition-all cursor-pointer flex flex-col justify-between space-y-3"
                data-testid={`invoice-card-${inv.id}`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5">
                      {inv.entity_code && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
                          {inv.entity_code}
                        </Badge>
                      )}
                      <span className="font-bold text-xs text-slate-900">
                        {inv.invoice_number}
                      </span>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${getStatusBadgeVariant(
                        inv.status
                      )}`}
                    >
                      {inv.status}
                    </span>
                  </div>

                  <p className="text-xs font-medium text-slate-700 flex items-center gap-1">
                    <Building className="w-3 h-3 text-slate-400" />
                    <span className="truncate">{inv.clients?.name || 'No client linked'}</span>
                  </p>

                  <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      Due: {inv.due_date?.slice(0, 10) || '—'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 block">Balance Due</span>
                    <span
                      className={`text-xs font-bold ${
                        Number(inv.balance || 0) > 0 ? 'text-amber-600' : 'text-slate-400'
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
                      className="h-7 w-7 text-slate-500 hover:text-slate-900 cursor-pointer"
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
          className="flex items-center justify-between border-t border-slate-200 pt-3"
          data-testid="invoice-pagination"
        >
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Rows per page:</span>
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
            <span className="text-xs text-slate-500" data-testid="page-indicator">
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
