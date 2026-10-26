import { useState } from 'react';
import {
  Archive,
  RotateCcw,
  Search,
  ChevronLeft,
  ChevronRight,
  FileText,
  Eye,
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
import { useInvoices } from '../api/useInvoices';
import { restoreInvoiceAction } from '../api/useBillingMutations';
import { useDebounce } from '../hooks/useDebounce';
import { usePermission } from '@/lib/permissions';
import { useEntityRealtimeSync } from '@/lib/realtime';
import { formatCurrency, getStatusBadgeVariant } from '../utils/formatters';
import type { Invoice } from '../api/types';

export interface InvoiceArchiveTabProps {
  onSelectInvoice?: (invoice: Invoice) => void;
}

export function InvoiceArchiveTab({ onSelectInvoice }: InvoiceArchiveTabProps) {
  useEntityRealtimeSync({ table: 'invoices' });
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const canEdit = usePermission('billing:edit');

  const { data: invoicesResponse, isLoading, refetch } = useInvoices({
    archived: true,
    search: debouncedSearch || undefined,
    page,
    limit: 25,
  });

  const invoices = invoicesResponse?.data || [];
  const totalCount = invoicesResponse?.meta?.total || 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / 25));

  const toggleSelectAll = () => {
    if (selectedIds.size === invoices.length && invoices.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(invoices.map((inv) => inv.id)));
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

  const handleRestoreSingle = async (inv: Invoice) => {
    try {
      await restoreInvoiceAction(inv.id, inv.invoice_number, inv.entity_id);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(inv.id);
        return next;
      });
      refetch();
    } catch {
      // Handled by BlockingActionModal
    }
  };

  const handleBulkRestore = async () => {
    const toRestore = invoices.filter((inv) => selectedIds.has(inv.id));
    for (const inv of toRestore) {
      try {
        await restoreInvoiceAction(inv.id, inv.invoice_number, inv.entity_id);
      } catch {
        break;
      }
    }
    setSelectedIds(new Set());
    refetch();
  };

  return (
    <div className="space-y-4" data-testid="invoice-archive-tab">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#1E293B] flex items-center gap-2">
            <Archive className="w-5 h-5 text-[#1E293B]" />
            <span>Archived & Cancelled Invoices</span>
          </h2>
          <p className="text-xs text-[#475569]">
            View historical invoices and restore them back to active billing records.
          </p>
        </div>

        {/* Bulk Action Controls */}
        {selectedIds.size > 0 && canEdit && (
          <div
            className="flex items-center gap-2 bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs px-3 py-1.5 rounded-[8px] border-[#E2E8F0]"
            data-testid="bulk-action-bar"
          >
            <span className="text-xs font-medium">
              {selectedIds.size} invoice(s) selected
            </span>
            <Button
              size="sm"
              onClick={handleBulkRestore}
              className="h-7 text-xs bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] gap-1 cursor-pointer rounded-[6px] font-bold"
              data-testid="btn-bulk-restore"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Restore Selected</span>
            </Button>
          </div>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-[#475569]" />
        <Input
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setPage(1);
          }}
          placeholder="Search archived invoices..."
          className="pl-9 h-9 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]"
          data-testid="archive-search-input"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="p-12 text-center text-[#475569] bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0]">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-[#E2E8F0] border-t-transparent mb-2"></div>
          <p className="text-xs">Loading archived invoices...</p>
        </div>
      ) : invoices.length === 0 ? (
        <div
          className="p-12 text-center bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0] space-y-2"
          data-testid="empty-archive"
        >
          <FileText className="w-10 h-10 text-[#475569] mx-auto" />
          <h3 className="text-sm font-bold text-[#1E293B]">Archive is empty</h3>
          <p className="text-xs text-[#475569] max-w-sm mx-auto">
            No archived or cancelled invoices found in the system.
          </p>
        </div>
      ) : (
        <div className="bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0] shadow-none overflow-hidden">
          <Table>
            <TableHeader className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
              <TableRow>
                {canEdit && (
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all archived invoices"
                      checked={selectedIds.size === invoices.length && invoices.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded-[6px] accent-[#1D4ED8] text-[#1E293B] cursor-pointer"
                      data-testid="select-all-checkbox"
                    />
                  </TableHead>
                )}
                <TableHead className="text-xs font-bold text-[#1E293B] tracking-normal">Invoice #</TableHead>
                <TableHead className="text-xs font-bold text-[#1E293B] tracking-normal">Client</TableHead>
                <TableHead className="text-xs font-bold text-[#1E293B] tracking-normal">Issue Date</TableHead>
                <TableHead className="text-xs font-bold text-[#1E293B] tracking-normal tabular-nums">Status</TableHead>
                <TableHead className="text-xs font-bold text-[#1E293B] tracking-normal tabular-nums text-right">
                  Total
                </TableHead>
                <TableHead className="text-xs font-bold text-[#1E293B] tracking-normal tabular-nums text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow
                  key={inv.id}
                  className="hover:bg-[#F8FAFC] transition-colors border-b border-[#E2E8F0]"
                  data-testid={`archive-row-${inv.id}`}
                >
                  {canEdit && (
                    <TableCell className="w-10">
                      <input
                        type="checkbox"
                        aria-label={`Select invoice ${inv.invoice_number}`}
                        checked={selectedIds.has(inv.id)}
                        onChange={() => toggleSelectOne(inv.id)}
                        className="rounded-[6px] accent-[#1D4ED8] text-[#1E293B] cursor-pointer"
                        data-testid={`select-invoice-${inv.id}`}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-bold text-[#1E293B] text-xs py-3">
                    <div className="flex items-center gap-1.5">
                      {inv.entity_code && (
                        <Badge variant="outline" className="text-xs px-1 py-0 h-4 rounded-[8px] border-[#E2E8F0]">
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
                  <TableCell className="py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs  font-bold border-[#E2E8F0] ${getStatusBadgeVariant(
                        inv.status
                      )}`}
                    >
                      {inv.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs tabular-nums font-bold text-[#1E293B] text-right py-3">
                    {formatCurrency(inv.total)}
                  </TableCell>
                  <TableCell className="text-right py-3">
                    <div className="flex items-center justify-end gap-1">
                      {onSelectInvoice && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onSelectInvoice(inv)}
                          className="h-7 w-7 text-[#475569] hover:text-[#1E293B] rounded-[6px] cursor-pointer"
                          title="View Details"
                          data-testid={`archive-view-btn-${inv.id}`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestoreSingle(inv)}
                          className="h-7 text-xs text-[#1E293B] hover:bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] gap-1 cursor-pointer"
                          data-testid={`restore-invoice-btn-${inv.id}`}
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restore</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-3 tabular-nums">
          <span className="text-xs text-[#475569]">
            Page {page} of {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-7 w-7 cursor-pointer rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC]"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-7 w-7 cursor-pointer rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC]"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
