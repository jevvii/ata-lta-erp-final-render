import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  RotateCcw,
  Eye,
  ChevronLeft,
  ChevronRight,
  FileSearch,
  ExternalLink,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSessionStore } from '@/lib/session';
import { useAuditLogsList } from '../api/useAuditLogs';
import { useUsersList } from '../api/useUsers';
import {
  buildAuditRouteHref,
  formatAuditAction,
  getAuditActionBadgeStyle,
  getAuditItemIdentifier,
  getAuditItemRouteLink,
  getAuditModuleLabel,
} from '../utils/auditFormatters';
import { AuditLogDetailModal } from './AuditLogDetailModal';
import type { AdminUser, AuditLogEntry, AuditLogFilterParams, EntityCode } from '../api/types';

const PAGE_LIMIT = 50;

const MODULE_FILTER_OPTIONS = [
  { value: 'ALL', label: 'All Modules' },
  { value: 'users', label: 'Users & Access' },
  { value: 'work_requests', label: 'Operations / Work Requests' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'invoices', label: 'Billing & Invoices' },
  { value: 'disbursements', label: 'Disbursements' },
  { value: 'documents', label: 'Documents' },
  { value: 'transmittals', label: 'Transmittals' },
  { value: 'clients', label: 'Clients' },
] as const;

function formatTableTimestamp(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '—', time: '' };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: iso, time: '' };
  return {
    date: d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }),
    time: d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  };
}

export function AuditLogView() {
  const navigate = useNavigate();
  const activeEntity = useSessionStore((s) => s.activeEntity);
  const setActiveEntity = useSessionStore((s) => s.setActiveEntity);
  const currentUser = useSessionStore((s) => s.user);

  // Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('ALL');
  const [userFilter, setUserFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [page, setPage] = useState<number>(1);

  // Selected entry for Detail Modal
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  // Users directory for actor/target resolution
  const { data: users = [] } = useUsersList();
  const usersMap = useMemo(() => {
    const map = new Map<string, AdminUser>();
    for (const u of users) {
      map.set(u.id, u);
    }
    return map;
  }, [users]);

  const filterParams = useMemo<AuditLogFilterParams>(() => {
    const params: AuditLogFilterParams = {
      page,
      limit: PAGE_LIMIT,
      sortOrder,
    };
    if (searchQuery.trim()) {
      params.search = searchQuery.trim();
    }
    if (moduleFilter !== 'ALL') {
      params.tableName = moduleFilter;
    }
    if (userFilter !== 'ALL') {
      params.userId = userFilter;
    }
    if (dateFrom) {
      params.from = dateFrom;
    }
    if (dateTo) {
      params.to = dateTo;
    }
    return params;
  }, [page, sortOrder, searchQuery, moduleFilter, userFilter, dateFrom, dateTo]);

  const { data: auditResponse, isLoading, error } = useAuditLogsList(filterParams);

  const entries = auditResponse?.data ?? [];
  const totalEntries = auditResponse?.meta?.total ?? entries.length;
  const currentLimit = auditResponse?.meta?.limit ?? PAGE_LIMIT;
  const totalPages = Math.max(1, Math.ceil(totalEntries / currentLimit));

  const startIndex = totalEntries === 0 ? 0 : (page - 1) * currentLimit + 1;
  const endIndex = Math.min(totalEntries, page * currentLimit);

  const handleResetFilters = () => {
    setSearchQuery('');
    setModuleFilter('ALL');
    setUserFilter('ALL');
    setDateFrom('');
    setDateTo('');
    setSortOrder('desc');
    setPage(1);
  };

  if (isLoading && !auditResponse) {
    return (
      <div
        className="space-y-3"
        data-testid="audit-loading-skeleton"
      >
        <div className="h-9 w-full animate-pulse rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0]" />
        <div className="h-72 w-full animate-pulse rounded-[8px] bg-[#F8FAFC] border border-[#E2E8F0]" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-[8px] border border-[#FECACA] bg-[#FEF2F2] p-4 text-xs font-medium text-[#991B1B]"
        data-testid="audit-error-alert"
      >
        Failed to load audit log: {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="audit-log-view">
      {/* Flat Filter Toolbar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          {/* Search Input */}
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#475569]" />
            <Input
              type="text"
              placeholder="Search by AUR ID, description, user, or item number..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              className="h-9 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] pl-9 text-xs text-[#1E293B] focus-visible:border-[#1D4ED8]"
              data-testid="audit-search-input"
            />
          </div>

          {/* Module / Category Filter */}
          <Select
            value={moduleFilter}
            onValueChange={(val) => {
              setModuleFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              className="h-9 w-[190px] rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-xs text-[#1E293B]"
              data-testid="audit-module-filter"
            >
              <SelectValue placeholder="All Modules" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              {MODULE_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* User Filter */}
          <Select
            value={userFilter}
            onValueChange={(val) => {
              setUserFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger
              className="h-9 w-[175px] rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-xs text-[#1E293B]"
              data-testid="audit-user-filter"
            >
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              <SelectItem value="ALL" className="text-xs">
                All Users
              </SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name} ({u.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Range: From */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-[#475569]">
              From
            </label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="h-9 w-[140px] rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] font-mono text-xs text-[#1E293B] tabular-nums focus-visible:border-[#1D4ED8]"
              data-testid="audit-date-from"
            />
          </div>

          {/* Date Range: To */}
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-medium text-[#475569]">
              To
            </label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="h-9 w-[140px] rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] font-mono text-xs text-[#1E293B] tabular-nums focus-visible:border-[#1D4ED8]"
              data-testid="audit-date-to"
            />
          </div>

          {/* Sort Order */}
          <Select
            value={sortOrder}
            onValueChange={(val) => {
              setSortOrder(val as 'desc' | 'asc');
              setPage(1);
            }}
          >
            <SelectTrigger
              className="h-9 w-[155px] rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-xs text-[#1E293B]"
              data-testid="audit-sort-order"
            >
              <SelectValue placeholder="Sort Order" />
            </SelectTrigger>
            <SelectContent className="rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] shadow-float">
              <SelectItem value="desc" className="text-xs">
                Newest First (DESC)
              </SelectItem>
              <SelectItem value="asc" className="text-xs">
                Oldest First (ASC)
              </SelectItem>
            </SelectContent>
          </Select>

          {/* Reset Filters Button */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            className="text-xs font-medium h-9 text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/70 bg-[#FFFFFF] rounded-[6px] border border-[#E2E8F0] gap-1.5 cursor-pointer"
            data-testid="audit-reset-filters"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </Button>
        </div>

        {/* Compliance Sequence Reference Pill */}
        <div className="flex items-center gap-2 shrink-0">
          <Badge
            variant="outline"
            className="bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE] rounded-[6px] px-2.5 py-1 font-mono text-xs font-semibold tabular-nums"
            data-testid="audit-aur-badge"
          >
            AUR-001
          </Badge>
        </div>
      </div>

      {/* Brutalist-Minimalist Table */}
      <div
        className="rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] overflow-hidden"
        data-testid="audit-log-table"
      >
        <Table>
          <TableHeader className="bg-[#F8FAFC] border-b border-[#E2E8F0]">
            <TableRow className="hover:bg-[#F8FAFC] border-b border-[#E2E8F0]">
              <TableHead className="w-[95px] font-bold tracking-normal text-xs text-[#1E293B]">
                ID
              </TableHead>
              <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                Timestamp
              </TableHead>
              <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                User
              </TableHead>
              <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                Action
              </TableHead>
              <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                Module
              </TableHead>
              <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                Target Record
              </TableHead>
              <TableHead className="font-bold tracking-normal text-xs text-[#1E293B]">
                Entity
              </TableHead>
              <TableHead className="text-right font-bold tracking-normal text-xs text-[#1E293B]">
                Details
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="px-4 py-12 text-center text-[#475569]">
                  <div className="flex flex-col items-center justify-center gap-1.5">
                    <FileSearch className="h-6 w-6 text-[#475569]" />
                    <p className="text-xs font-semibold text-[#1E293B]">
                      No audit entries match the current filters
                    </p>
                    <p className="text-xs text-[#475569]">
                      Adjust your search query, module filter, or date range to inspect historical records.
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => {
                const aurCode =
                  entry.auditNumber ||
                  entry.audit_number ||
                  `AUR-${entry.id.slice(0, 8).toUpperCase()}`;
                const ts = formatTableTimestamp(
                  entry.timestamp ?? entry.createdAt ?? entry.created_at
                );
                const actorId = entry.userId ?? entry.user_id ?? null;
                const actorUser =
                  actorId && usersMap ? usersMap.get(actorId) : undefined;
                const actorName =
                  actorUser?.name ?? (actorId ? actorId : 'System');
                const actorRole = actorUser?.role;
                const actionLabel = formatAuditAction(entry);
                const actionBadgeStyle = getAuditActionBadgeStyle(entry);
                const moduleLabel = getAuditModuleLabel(entry);
                const tableRaw = entry.tableName ?? entry.table_name ?? '';
                const targetIdentifier = getAuditItemIdentifier(entry, usersMap);
                const routeLink = getAuditItemRouteLink(entry);
                const entityDisplay = entry.entity || 'System';

                const handleTargetClick = (e: React.MouseEvent) => {
                  e.stopPropagation();
                  if (!routeLink) return;
                  const targetEntity = (entry.entity || '').toUpperCase();
                  if (
                    (targetEntity === 'ATA' || targetEntity === 'LTA') &&
                    activeEntity !== targetEntity &&
                    currentUser?.entities?.includes(targetEntity as EntityCode)
                  ) {
                    setActiveEntity(targetEntity);
                  }
                  navigate(buildAuditRouteHref(routeLink));
                };

                return (
                  <TableRow
                    key={entry.id}
                    onClick={() => setSelectedEntry(entry)}
                    className="hover:bg-[#F8FAFC] cursor-pointer transition-colors border-b border-[#E2E8F0]"
                    data-testid={`audit-row-${entry.id}`}
                  >
                    {/* 1. Sequence ID */}
                    <TableCell className="py-3 font-mono text-xs font-medium text-[#475569] tabular-nums">
                      {aurCode}
                    </TableCell>

                    {/* 2. Timestamp */}
                    <TableCell className="py-3 whitespace-nowrap font-mono text-xs text-[#475569] tabular-nums">
                      <div className="font-medium text-[#1E293B]">{ts.date}</div>
                      {ts.time && (
                        <div className="text-[11px] text-[#475569]">{ts.time}</div>
                      )}
                    </TableCell>

                    {/* 3. User */}
                    <TableCell className="py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-[#1E293B]">
                          {actorName}
                        </span>
                        {actorRole && (
                          <Badge
                            variant="outline"
                            className="rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC] px-1.5 py-0 text-[10px] font-medium text-[#475569]"
                          >
                            {actorRole}
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    {/* 4. Action */}
                    <TableCell className="py-3">
                      <span
                        className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-xs font-medium ${actionBadgeStyle}`}
                        data-testid={`audit-action-badge-${entry.id}`}
                      >
                        {actionLabel}
                      </span>
                    </TableCell>

                    {/* 5. Module / Table */}
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className="rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC] px-2 py-0.5 font-mono text-xs font-medium text-[#1E293B]"
                      >
                        {tableRaw || moduleLabel}
                      </Badge>
                    </TableCell>

                    {/* 6. Target Record */}
                    <TableCell className="py-3">
                      {routeLink && targetIdentifier !== '—' ? (
                        <button
                          type="button"
                          onClick={handleTargetClick}
                          title={routeLink.label}
                          className="inline-flex items-center gap-1 font-mono text-xs font-medium text-[#1D4ED8] hover:text-[#1E40AF] hover:underline cursor-pointer text-left"
                          data-testid={`audit-target-${entry.id}`}
                        >
                          <span>{targetIdentifier}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </button>
                      ) : (
                        <span
                          className="font-mono text-xs font-medium text-[#1E293B]"
                          data-testid={`audit-target-${entry.id}`}
                        >
                          {targetIdentifier}
                        </span>
                      )}
                    </TableCell>

                    {/* 7. Entity */}
                    <TableCell className="py-3">
                      <Badge
                        variant="outline"
                        className={
                          entityDisplay === 'ATA'
                            ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                            : 'bg-[#F8FAFC] text-[#1E293B] border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                        }
                      >
                        {entityDisplay}
                      </Badge>
                    </TableCell>

                    {/* 8. Details */}
                    <TableCell
                      className="py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedEntry(entry)}
                        title="View Audit Details"
                        className="h-7 gap-1 rounded-[6px] px-2.5 text-xs font-medium text-[#1D4ED8] hover:bg-[#EFF6FF] hover:text-[#1E40AF] cursor-pointer"
                        data-testid={`audit-details-btn-${entry.id}`}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Details</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Server-Side Pagination Bar */}
        <div
          className="flex flex-col items-center justify-between gap-2 border-t border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 text-xs text-[#475569] sm:flex-row"
          data-testid="audit-pagination-bar"
        >
          <div className="font-mono tabular-nums" data-testid="audit-pagination-summary">
            Showing {startIndex}–{endIndex} of {totalEntries} audit entries
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-[#475569] tabular-nums">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 gap-1 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] px-2.5 text-xs font-medium text-[#1E293B] hover:bg-[#F8FAFC] disabled:opacity-50 cursor-pointer"
              data-testid="audit-prev-page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 gap-1 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] px-2.5 text-xs font-medium text-[#1E293B] hover:bg-[#F8FAFC] disabled:opacity-50 cursor-pointer"
              data-testid="audit-next-page"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Audit Detail Modal */}
      <AuditLogDetailModal
        entry={selectedEntry}
        usersMap={usersMap}
        isOpen={Boolean(selectedEntry)}
        onClose={() => setSelectedEntry(null)}
      />
    </div>
  );
}
