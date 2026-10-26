import { useState, useMemo } from 'react';
import {
  Search,
  Eye,
  ChevronLeft,
  ChevronRight,
  Filter,
  RefreshCw,
} from 'lucide-react';
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
import {
  DISBURSEMENT_CATEGORIES,
  DISBURSEMENT_STATUSES,
  FUND_SOURCES,
} from '../api/schemas';
import { useDisbursementsList } from '../api/useDisbursements';
import { DisbursementStatusBadge } from './DisbursementStatusBadge';
import { FundsReleaseActions } from './FundsReleaseActions';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type {
  Disbursement,
  DisbursementStatus,
  FundSource,
} from '../api/types';

export interface DisbursementsTableProps {
  onSelectDisbursement: (id: string) => void;
  statusFilter?: DisbursementStatus;
}

export function DisbursementsTable({
  onSelectDisbursement,
  statusFilter,
}: DisbursementsTableProps) {
  // Realtime CDC Subscriptions (Parcel E)
  useEntityRealtimeSync({ table: 'disbursements' });

  const [search, setSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<DisbursementStatus | ''>(
    statusFilter || ''
  );
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedFundSource, setSelectedFundSource] = useState<FundSource | ''>('');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Active query
  const queryFilters = useMemo(() => {
    const filters: {
      search?: string;
      status?: DisbursementStatus;
      category?: string;
      fundSource?: FundSource;
      page: number;
      limit: number;
    } = { page, limit };

    if (search.trim()) filters.search = search.trim();
    if (statusFilter) {
      filters.status = statusFilter;
    } else if (selectedStatus) {
      filters.status = selectedStatus;
    }
    if (selectedCategory) filters.category = selectedCategory;
    if (selectedFundSource) filters.fundSource = selectedFundSource;

    return filters;
  }, [search, statusFilter, selectedStatus, selectedCategory, selectedFundSource, page]);

  const { data: response, isLoading, isFetching, refetch } = useDisbursementsList(queryFilters);
  const disbursements = useMemo(() => response?.data ?? [], [response]);
  const total = response?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / limit) || 1;

  const resetFilters = () => {
    setSearch('');
    if (!statusFilter) setSelectedStatus('');
    setSelectedCategory('');
    setSelectedFundSource('');
    setPage(1);
  };

  return (
    <div className="space-y-3" data-testid="disbursements-table-container">
      {/* Filter and Search Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 bg-white p-3 rounded-lg border border-slate-200">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {/* Search */}
          <div className="relative w-full sm:w-60">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
            <Input
              type="text"
              placeholder="Search description, number..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-8 text-xs h-8"
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
              className="text-xs h-8 px-2.5 border rounded-md bg-white border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="text-xs h-8 px-2.5 border rounded-md bg-white border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
            className="text-xs h-8 px-2.5 border rounded-md bg-white border-slate-200 text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            data-testid="filter-fund-source-select"
          >
            <option value="">All Fund Sources</option>
            {FUND_SOURCES.map((fs) => (
              <option key={fs} value={fs}>
                {fs}
              </option>
            ))}
          </select>

          {(search || (!statusFilter && selectedStatus) || selectedCategory || selectedFundSource) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="text-xs h-8 text-slate-500 hover:text-slate-800"
              data-testid="reset-filters-btn"
            >
              Reset
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 self-end md:self-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="text-xs h-8 px-2 text-slate-500 hover:text-slate-800"
            title="Refresh"
            data-testid="refresh-table-btn"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
          <span className="text-xs text-slate-500">
            Total: <span className="font-semibold text-slate-800">{total}</span>
          </span>
        </div>
      </div>

      {/* Table Data */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-2xs">
        <Table data-testid="disbursements-table">
          <TableHeader>
            <TableRow className="bg-slate-50/80 text-slate-700 hover:bg-slate-50/80">
              <TableHead className="w-40 text-xs font-bold">Voucher #</TableHead>
              <TableHead className="text-xs font-bold">Description</TableHead>
              <TableHead className="w-32 text-xs font-bold">Category</TableHead>
              <TableHead className="w-28 text-xs font-bold">Fund Source</TableHead>
              <TableHead className="w-32 text-xs font-bold text-right">Amount (PHP)</TableHead>
              <TableHead className="w-28 text-xs font-bold text-center">Status</TableHead>
              <TableHead className="w-28 text-xs font-bold text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-xs text-slate-500" data-testid="table-loading">
                  Loading disbursements...
                </TableCell>
              </TableRow>
            ) : disbursements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-xs text-slate-500" data-testid="table-empty">
                  <div className="space-y-1">
                    <Filter className="h-6 w-6 text-slate-300 mx-auto" />
                    <p className="font-medium text-slate-700">No disbursements found</p>
                    <p className="text-[11px] text-slate-400">
                      Try adjusting your search criteria or create a new voucher.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              disbursements.map((item: Disbursement) => {
                const disbNumber =
                  item.disbursement_number ||
                  item.disbursementNumber ||
                  `DISB-${item.id.slice(0, 8)}`;

                return (
                  <TableRow
                    key={item.id}
                    className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                    onClick={() => onSelectDisbursement(item.id)}
                    data-testid={`disbursement-row-${item.id}`}
                  >
                    <TableCell className="font-mono text-xs font-bold text-blue-700">
                      {disbNumber}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-slate-900 line-clamp-1">
                          {item.description}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {new Date(item.created_at || item.createdAt || '').toLocaleDateString()}
                          {item.client_name ? ` • ${item.client_name}` : ''}
                          {item.linked_work_request_name
                            ? ` • ${item.linked_work_request_name}`
                            : item.linked_work_request_order_number
                            ? ` • ${item.linked_work_request_order_number}`
                            : ''}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">{item.category}</TableCell>
                    <TableCell>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                        {item.fund_source || item.fundSource}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs font-bold text-slate-900 text-right">
                      ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">
                      <DisbursementStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <FundsReleaseActions disbursement={item} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onSelectDisbursement(item.id)}
                          className="h-7 w-7 p-0 text-slate-500 hover:text-slate-900"
                          title="View Details"
                          data-testid={`view-action-${item.id}`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-600">
            <span>
              Page <span className="font-semibold text-slate-800">{page}</span> of{' '}
              <span className="font-semibold text-slate-800">{totalPages}</span>
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
    </div>
  );
}
