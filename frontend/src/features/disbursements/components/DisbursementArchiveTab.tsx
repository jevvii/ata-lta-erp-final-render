import { useState } from 'react';
import { Archive, RotateCcw, Search, ChevronLeft, ChevronRight, Eye, Wallet } from 'lucide-react';
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
import { useDisbursementsList, restoreDisbursementAction } from '../api/useDisbursements';
import { DisbursementStatusBadge } from './DisbursementStatusBadge';
import { useDebounce } from '@/features/billing/hooks/useDebounce';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { Disbursement } from '../api/types';

export interface DisbursementArchiveTabProps {
  onSelectDisbursement?: (id: string) => void;
}

export function DisbursementArchiveTab({ onSelectDisbursement }: DisbursementArchiveTabProps) {
  useEntityRealtimeSync({ table: 'disbursements' });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const user = useSessionStore((state) => state.user);
  const canEdit = user?.role === 'Admin' && hasPermission(permissions, 'disbursement:edit');
  const canRestore = (item: Disbursement) =>
    canEdit &&
    (item.lifecycle_version ?? item.lifecycleVersion) === 2 &&
    item.status === 'Released' &&
    item.archived === true &&
    Number.isInteger(item.version) &&
    item.version > 0;

  const {
    data: response,
    isLoading,
    isFetching,
    refetch,
  } = useDisbursementsList({
    archived: true,
    search: debouncedSearch || undefined,
    page,
    limit: 25,
  });

  const isFiltering = searchInput !== debouncedSearch || isFetching;
  const disbursements: Disbursement[] = response?.data || [];
  const totalCount = response?.meta?.total ?? disbursements.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / 25));

  const restorable = disbursements.filter(canRestore);

  const toggleSelectAll = () => {
    if (restorable.length > 0 && restorable.every((d) => selectedIds.has(d.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(restorable.map((d) => d.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleRestoreSingle = async (disb: Disbursement) => {
    if (isFiltering || !canRestore(disb)) return;
    const refNum =
      disb.disbursement_number || disb.disbursementNumber || `DISB-${disb.id.slice(0, 8)}`;
    try {
      await restoreDisbursementAction(disb.id, refNum, activeEntity, disb.version);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(disb.id);
        return next;
      });
      refetch();
    } catch {
      // Handled by BlockingActionModal
    }
  };

  const handleBulkRestore = async () => {
    if (isFiltering) return;
    const toRestore = restorable.filter((d) => selectedIds.has(d.id));
    for (const disb of toRestore) {
      const refNum =
        disb.disbursement_number || disb.disbursementNumber || `DISB-${disb.id.slice(0, 8)}`;
      try {
        await restoreDisbursementAction(disb.id, refNum, activeEntity, disb.version);
      } catch {
        break;
      }
    }
    setSelectedIds(new Set());
    refetch();
  };

  return (
    <div className="space-y-4" data-testid="disbursement-archive-tab">
      {/* Search and Action Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-surface p-3 rounded-[8px] border border-border">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
          <Input
            type="text"
            placeholder="Search archived disbursements..."
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setPage(1);
              setSelectedIds(new Set());
            }}
            className="pl-8 text-xs h-9"
            data-testid="search-archived-disbursements-input"
          />
        </div>

        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && canEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkRestore}
              disabled={isFiltering}
              className="text-xs h-9 gap-1.5 border-blue-300 text-primary-hover hover:bg-primary-light"
              data-testid="bulk-restore-btn"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore Selected ({selectedIds.size})
            </Button>
          )}
        </div>
      </div>

      {/* Archived Disbursements Table */}
      <div className="border border-border rounded-[8px] overflow-hidden bg-surface shadow-none">
        <Table>
          <TableHeader>
            <TableRow className="bg-sidebar text-ink hover:bg-sidebar">
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  aria-label="Select all archived disbursements"
                  checked={restorable.length > 0 && restorable.every((d) => selectedIds.has(d.id))}
                  disabled={isFiltering || restorable.length === 0}
                  onChange={toggleSelectAll}
                  className="rounded border-border text-ink focus:ring-primary"
                />
              </TableHead>
              <TableHead className="w-40 text-xs font-bold">Voucher #</TableHead>
              <TableHead className="text-xs font-bold">Description / Requester</TableHead>
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
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-xs text-muted"
                  data-testid="archive-loading"
                >
                  Loading archived disbursements...
                </TableCell>
              </TableRow>
            ) : disbursements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-xs text-muted"
                  data-testid="archive-empty"
                >
                  <div className="space-y-1">
                    <Archive className="h-6 w-6 text-placeholder mx-auto" />
                    <p className="font-medium text-ink">No archived disbursements</p>
                    <p className="text-xs text-muted">
                      Archived expense and payment vouchers will appear here.
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
                const isSelected = selectedIds.has(item.id);

                return (
                  <TableRow
                    key={item.id}
                    className={`hover:bg-hover/60 cursor-pointer transition-colors ${
                      isSelected ? 'bg-selected/40' : ''
                    }`}
                    onClick={() => onSelectDisbursement?.(item.id)}
                    data-testid={`archived-disbursement-row-${item.id}`}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${disbNumber}`}
                        checked={isSelected}
                        disabled={isFiltering || !canRestore(item)}
                        onChange={() => toggleSelectOne(item.id)}
                        className="rounded border-border text-ink focus:ring-primary"
                      />
                    </TableCell>
                    <TableCell className="text-xs font-bold text-ink">
                      <div className="flex items-center gap-1.5">
                        <Wallet className="h-3.5 w-3.5 text-muted" />
                        <span>{disbNumber}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-ink line-clamp-1">
                          {item.description}
                        </p>
                        <p className="text-xs tabular-nums text-muted">
                          {new Date(item.created_at || item.createdAt || '').toLocaleDateString()}
                          {item.client_name ? ` • ${item.client_name}` : ''}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-ink">{item.category}</TableCell>
                    <TableCell>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-[6px] bg-canvas text-ink">
                        {item.fund_source || item.fundSource}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs font-bold text-ink">
                      ₱
                      {(typeof item.amount === 'number' ? item.amount : 0).toLocaleString('en-PH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell className="text-center">
                      <DisbursementStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {canRestore(item) && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRestoreSingle(item)}
                            disabled={isFiltering}
                            className="h-7 w-7 p-0 text-muted hover:text-primary hover:bg-primary-light"
                            title="Restore voucher"
                            data-testid={`restore-action-${item.id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => onSelectDisbursement?.(item.id)}
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
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-canvas/50 text-xs text-muted">
            <span>
              Page <span className="font-semibold text-ink">{page}</span> of{' '}
              <span className="font-semibold text-ink">{totalPages}</span>
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-7 px-2 text-xs"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-7 px-2 text-xs"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
