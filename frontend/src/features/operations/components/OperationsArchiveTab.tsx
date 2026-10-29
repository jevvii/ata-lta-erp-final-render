import { useState, useMemo } from 'react';
import {
  RotateCcw,
  Search,
  Eye,
  Archive,
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
import { ArchiveConfirmModal } from './ArchiveConfirmModal';
import { useWorkRequests } from '../api/useWorkRequests';
import type { WorkRequest } from '../api/types';

export interface OperationsArchiveTabProps {
  onRestoreWr?: (wr: WorkRequest) => void;
  onViewWr?: (wr: WorkRequest) => void;
}

export function OperationsArchiveTab({
  onRestoreWr,
  onViewWr,
}: OperationsArchiveTabProps) {
  const [category, setCategory] = useState<'All' | 'Completed' | 'Cancelled'>('All');
  const [search, setSearch] = useState('');
  const [restoreTargetWr, setRestoreTargetWr] = useState<WorkRequest | null>(null);

  // Queries archived work requests
  const { data: rawArchived, isLoading, refetch } = useWorkRequests({
    archived: true,
  });
  const archivedRequests: WorkRequest[] = useMemo(() => {
    if (Array.isArray(rawArchived)) return rawArchived;
    return rawArchived?.data ?? [];
  }, [rawArchived]);

  // Filter by category and search
  const filteredList = useMemo(() => {
    return archivedRequests.filter((wr) => {
      // Category filter
      if (category === 'Completed' && wr.status !== 'Completed') return false;
      if (category === 'Cancelled' && wr.status !== 'Cancelled') return false;

      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const titleMatch = wr.title.toLowerCase().includes(q);
        const clientMatch = wr.clientName?.toLowerCase().includes(q) || false;
        const wrNum = wr.workRequestNumber || wr.work_request_number;
        const wrNumMatch = wrNum ? wrNum.toLowerCase().includes(q) : false;
        const clientNum = wr.clientNumber || wr.client_number;
        const clientNumMatch = clientNum ? clientNum.toLowerCase().includes(q) : false;
        if (!titleMatch && !clientMatch && !wrNumMatch && !clientNumMatch) return false;
      }

      return true;
    });
  }, [archivedRequests, category, search]);

  const handleOpenRestore = (wr: WorkRequest) => {
    if (onRestoreWr) {
      onRestoreWr(wr);
    } else {
      setRestoreTargetWr(wr);
    }
  };

  return (
    <div className="space-y-4" data-testid="operations-archive-tab">
      {/* Header controls: Search & Category Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]">
        {/* Category buttons */}
        <div className="flex items-center gap-1.5" data-testid="archive-category-filters">
          <Button
            type="button"
            variant={category === 'All' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCategory('All')}
            className={`text-xs  tracking-normal rounded-[6px] ${
              category === 'All'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:bg-[#E2E8F0]'
            }`}
            data-testid="archive-cat-all"
          >
            All Archived ({archivedRequests.length})
          </Button>
          <Button
            type="button"
            variant={category === 'Completed' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCategory('Completed')}
            className={`text-xs  tracking-normal rounded-[6px] ${
              category === 'Completed'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:bg-[#E2E8F0]'
            }`}
            data-testid="archive-cat-completed"
          >
            Accomplished
          </Button>
          <Button
            type="button"
            variant={category === 'Cancelled' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setCategory('Cancelled')}
            className={`text-xs  tracking-normal rounded-[6px] ${
              category === 'Cancelled'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:bg-[#E2E8F0]'
            }`}
            data-testid="archive-cat-cancelled"
          >
            Cancelled
          </Button>
        </div>

        {/* Search Input */}
        <div className="w-full sm:w-64 relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-[#475569]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search archive..."
            className="h-8 pl-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-[#1E293B] placeholder:text-[#475569]"
            data-testid="archive-search-input"
          />
        </div>
      </div>

      {/* Archive Table */}
      <div className="border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] overflow-hidden shadow-none">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F8FAFC] hover:bg-[#F8FAFC] border-b border-[#E2E8F0]">
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B] whitespace-nowrap">
                ID
              </TableHead>
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B] w-1/3">
                Work Request
              </TableHead>
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B]">Client</TableHead>
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B]">Entity</TableHead>
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B]">Priority</TableHead>
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B]">Status</TableHead>
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B]">Archived Date</TableHead>
              <TableHead className="text-xs font-bold tracking-normal text-[#1E293B] text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-xs text-[#475569]">
                  Loading archived requests...
                </TableCell>
              </TableRow>
            ) : filteredList.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center justify-center space-y-2 text-[#475569]">
                    <Archive className="h-8 w-8 text-[#475569]/50" />
                    <p className="text-xs font-medium">No archived work requests found</p>
                    <p className="text-xs text-[#475569]">
                      Completed or cancelled requests will appear here once archived.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredList.map((wr) => (
                <TableRow key={wr.id} className="hover:bg-[#F8FAFC]/60 border-b border-[#E2E8F0]" data-testid={`archive-row-${wr.id}`}>
                  {/* ID */}
                  <TableCell className="font-mono text-xs font-medium text-[#475569] tabular-nums whitespace-nowrap">
                    {wr.workRequestNumber || wr.work_request_number || '—'}
                  </TableCell>

                  {/* Title */}
                  <TableCell className="text-xs text-[#1E293B]">
                    <div className="flex flex-col">
                      <span className="font-semibold">{wr.title}</span>
                      {wr.description && (
                        <span className="text-xs text-[#475569] truncate max-w-xs">
                          {wr.description}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Client */}
                  <TableCell className="text-xs text-[#1E293B]">
                    <div className="flex flex-col">
                      <span>{wr.clientName || '—'}</span>
                      {(wr.clientNumber || wr.client_number) && (
                        <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                          {wr.clientNumber || wr.client_number}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  {/* Entity */}
                  <TableCell>
                    <Badge variant={wr.entity === 'LTA' ? 'lta' : 'ata'} size="compact" className="rounded-[6px] text-xs">
                      {wr.entity}
                    </Badge>
                  </TableCell>

                  {/* Priority */}
                  <TableCell>
                    <Badge
                      variant={
                        wr.priority === 'Urgent'
                          ? 'destructive'
                          : wr.priority === 'High'
                            ? 'warning'
                            : 'secondary'
                      }
                      size="compact"
                      className="rounded-[6px] text-xs"
                    >
                      {wr.priority}
                    </Badge>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Badge
                      variant={
                        wr.status === 'Completed'
                          ? 'success'
                          : wr.status === 'Cancelled'
                            ? 'destructive'
                            : 'secondary'
                      }
                      size="compact"
                      className="rounded-[6px] text-xs"
                    >
                      {wr.status}
                    </Badge>
                  </TableCell>

                  {/* Date */}
                  <TableCell className="text-xs tabular-nums text-[#475569]">
                    {wr.updatedAt ? new Date(wr.updatedAt).toLocaleDateString() : '—'}
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {onViewWr && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => onViewWr(wr)}
                          title="View Details"
                          className="rounded-[6px] text-[#475569] hover:text-[#1E293B] hover:bg-[#F8FAFC]"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => handleOpenRestore(wr)}
                        className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] text-xs tracking-normal gap-1"
                        data-testid={`restore-btn-${wr.id}`}
                      >
                        <RotateCcw className="h-3 w-3" />
                        Restore
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Internal Archive Confirm Modal for restore */}
      {restoreTargetWr && (
        <ArchiveConfirmModal
          isOpen={Boolean(restoreTargetWr)}
          actionType="restore"
          workRequest={restoreTargetWr}
          onClose={() => setRestoreTargetWr(null)}
          onSuccess={() => {
            setRestoreTargetWr(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}
