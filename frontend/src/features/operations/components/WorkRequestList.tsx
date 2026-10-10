import { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  X,
  LayoutGrid,
  Table as TableIcon,
  AlertTriangle,
  Eye,
  Edit,
  ArrowRight,
  Archive,
  Ban,
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar,
  Building,
  ChevronDown,
  Check,
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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { ArchiveConfirmModal, type ArchiveActionType } from './ArchiveConfirmModal';
import { WorkRequestSidePeek } from './WorkRequestSidePeek';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { runBlockingAction } from './BlockingActionModal';
import { useWorkRequests, useWorkRequestMutations, prefetchWorkRequestDetail } from '../api/useWorkRequests';
import { usePhaseTransitions } from '../api/usePhaseTransitions';
import { useClients } from '../api/useClients';
import { useTeam } from '../api/useTeam';
import { useDebounce } from '../hooks/useDebounce';
import { operationsKeys } from '../api/queryKeys';
import { getPhaseBadgeInfo, getStatusBadgeInfo } from '../lib/statusBadges';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isUserAdmin } from '../lib/taskScope';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { ApiError } from '@/lib/api';
import {
  type WorkRequest,
  type Phase,
  type AdvancePhaseTarget,
  type WorkRequestStatus,
  WORK_REQUEST_STATUS_OPTIONS,
} from '../api/types';

export interface WorkRequestListProps {
  onViewDetails?: (id: string) => void;
  onEdit?: (wr: WorkRequest) => void;
  onCreateNew?: () => void;
}

export function WorkRequestList({
  onViewDetails,
  onEdit,
  onCreateNew,
}: WorkRequestListProps) {
  // Realtime CDC Subscriptions (Parcel E)
  useEntityRealtimeSync({ table: 'work_requests' });
  useEntityRealtimeSync({ table: 'tasks' });

  // View mode: Table vs Compact Card List
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  // Side Peek state (UAT-GEN2)
  const [peekWrId, setPeekWrId] = useState<string | null>(null);

  // Filters State
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [phaseFilter, setPhaseFilter] = useState<string>('all');

  // Pagination State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Archive Confirm Modal State
  const [archiveModalConfig, setArchiveModalConfig] = useState<{
    isOpen: boolean;
    actionType: ArchiveActionType;
    workRequest: WorkRequest | null;
  }>({
    isOpen: false,
    actionType: 'archive',
    workRequest: null,
  });

  // OCC Conflict Resolution Modal State
  const [conflictState, setConflictState] = useState<{
    isOpen: boolean;
    workRequest: WorkRequest | null;
    attemptedStatus: WorkRequestStatus | null;
    error: ApiError | null;
  }>({
    isOpen: false,
    workRequest: null,
    attemptedStatus: null,
    error: null,
  });

  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const permissions = useSessionStore((state) => state.permissions);
  const user = useSessionStore((state) => state.user);
  const canEdit = hasPermission(permissions, 'workflow:edit');
  const canAdvance = hasPermission(permissions, 'workflow:phase_transition');
  const isAdmin = isUserAdmin(user);

  // Data Queries
  const { data: rawWorkRequests, isLoading } = useWorkRequests({
    search: debouncedSearch || undefined,
    archived: false,
  });
  const workRequests: WorkRequest[] = useMemo(() => {
    if (Array.isArray(rawWorkRequests)) return rawWorkRequests;
    return rawWorkRequests?.data ?? [];
  }, [rawWorkRequests]);
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const { advancePhase } = usePhaseTransitions();
  const { archiveWorkRequest, cancelWorkRequest, statusOptimistic } = useWorkRequestMutations();

  // Filter application
  const filteredRequests = useMemo(() => {
    return workRequests.filter((wr) => {
      // Phase Filter
      if (phaseFilter !== 'all' && wr.phase !== phaseFilter) return false;

      // Status Filter
      if (statusFilter !== 'all' && wr.status !== statusFilter) return false;

      // Priority Filter
      if (priorityFilter !== 'all' && wr.priority !== priorityFilter) return false;

      // Client Filter
      if (clientFilter !== 'all' && wr.clientId !== clientFilter) return false;

      // Assignee Filter
      if (assigneeFilter !== 'all') {
        if (assigneeFilter === 'unassigned') {
          if (wr.assignedTo) return false;
        } else {
          if (wr.assignedTo !== assigneeFilter) return false;
        }
      }

      // Date Range Filter
      if (dateFilter !== 'all' && wr.dueDate) {
        const due = new Date(wr.dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (dateFilter === 'overdue') {
          if (due >= today || wr.status === 'Completed' || wr.status === 'Cancelled') {
            return false;
          }
        } else if (dateFilter === 'today') {
          const isToday =
            due.getDate() === today.getDate() &&
            due.getMonth() === today.getMonth() &&
            due.getFullYear() === today.getFullYear();
          if (!isToday) return false;
        } else if (dateFilter === 'this_week') {
          const weekFromNow = new Date(today);
          weekFromNow.setDate(today.getDate() + 7);
          if (due < today || due > weekFromNow) return false;
        } else if (dateFilter === 'this_month') {
          if (due.getMonth() !== today.getMonth() || due.getFullYear() !== today.getFullYear()) {
            return false;
          }
        }
      } else if (dateFilter === 'no_date') {
        if (wr.dueDate) return false;
      }

      return true;
    });
  }, [
    workRequests,
    phaseFilter,
    statusFilter,
    priorityFilter,
    clientFilter,
    assigneeFilter,
    dateFilter,
  ]);

  // Pagination calculation
  const totalItems = filteredRequests.length;
  const totalPages = Math.ceil(totalItems / pageSize) || 1;
  const paginatedRequests = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRequests.slice(start, start + pageSize);
  }, [filteredRequests, page, pageSize]);

  const hasActiveFilters =
    Boolean(searchInput.trim()) ||
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    clientFilter !== 'all' ||
    assigneeFilter !== 'all' ||
    dateFilter !== 'all' ||
    phaseFilter !== 'all';

  const handleClearFilters = () => {
    setSearchInput('');
    setStatusFilter('all');
    setPriorityFilter('all');
    setClientFilter('all');
    setAssigneeFilter('all');
    setDateFilter('all');
    setPhaseFilter('all');
    setPage(1);
  };

  // Selection handlers
  const handleSelectAllOnPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const next = new Set(selectedIds);
      paginatedRequests.forEach((r) => next.add(r.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      paginatedRequests.forEach((r) => next.delete(r.id));
      setSelectedIds(next);
    }
  };

  const handleToggleSelectRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Direct Advance Phase action
  const handleDirectAdvance = async (wr: WorkRequest) => {
    const nextPhase: Record<Phase, AdvancePhaseTarget | null> = {
      pre_processing: 'processing',
      processing: 'quality_assurance',
      quality_assurance: 'completion',
      completion: null,
    };
    const target = nextPhase[wr.phase];
    if (!target) return;

    await runBlockingAction({
      title: 'Advancing Phase',
      message: `Advancing "${wr.title}" to ${target.replace('_', ' ')}...`,
      apiCall: async () => {
        return await advancePhase({ workRequestId: wr.id, to_phase: target });
      },
      successTitle: 'Phase Advanced',
      successMessage: `"${wr.title}" is now in ${target.replace('_', ' ')}.`,
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeEntity),
        operationsKeys.workRequestDetail(wr.id),
      ],
    });
  };

  // Bulk Actions
  const handleBulkArchive = async () => {
    const completedSelected = filteredRequests.filter(
      (r) => selectedIds.has(r.id) && r.status === 'Completed'
    );
    if (completedSelected.length === 0) return;

    await runBlockingAction({
      title: 'Archiving Selected Requests',
      message: `Archiving ${completedSelected.length} completed work requests...`,
      apiCall: async () => {
        for (const wr of completedSelected) {
          await archiveWorkRequest(wr.id);
        }
      },
      successTitle: 'Work Requests Archived',
      successMessage: `${completedSelected.length} work requests have been moved to the archive.`,
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeEntity),
      ],
      onSuccess: () => setSelectedIds(new Set()),
    });
  };

  const handleBulkCancel = async () => {
    const activeSelected = filteredRequests.filter(
      (r) => selectedIds.has(r.id) && r.status !== 'Completed' && r.status !== 'Cancelled'
    );
    if (activeSelected.length === 0) return;

    await runBlockingAction({
      title: 'Cancelling Selected Requests',
      message: `Cancelling ${activeSelected.length} active work requests...`,
      apiCall: async () => {
        for (const wr of activeSelected) {
          await cancelWorkRequest(wr.id);
        }
      },
      successTitle: 'Work Requests Cancelled',
      successMessage: `${activeSelected.length} work requests have been cancelled.`,
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeEntity),
      ],
      onSuccess: () => setSelectedIds(new Set()),
    });
  };

  // Blocker helper
  const getBlockerInfo = (wr: WorkRequest) => {
    const tasks = wr.tasks || [];
    const activeTasks = tasks.filter((t) => t.status !== 'Cancelled');
    let incomplete: typeof activeTasks = [];

    if (wr.phase === 'pre_processing') {
      incomplete = activeTasks.filter(
        (t) => t.phase === 'pre_processing' && t.status !== 'Completed'
      );
    } else if (wr.phase === 'processing') {
      incomplete = activeTasks.filter(
        (t) => t.phase === 'processing' && t.status !== 'Completed'
      );
    } else if (wr.phase === 'quality_assurance') {
      const notDone = activeTasks.filter((t) => t.status !== 'Completed');
      const notPassed = activeTasks.filter((t) => t.qaStatus !== 'passed');
      incomplete = [...new Set([...notDone, ...notPassed])];
    }

    return {
      hasBlockers: incomplete.length > 0,
      count: incomplete.length,
      taskTitles: incomplete.map((t) => t.title),
    };
  };

  return (
    <div className="space-y-4" data-testid="work-request-list">
      {/* 1. Header Toolbar */}
      <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-3">
        {/* Search, View Switcher & Action Button */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Input with Debounce */}
          <div className="flex-1 relative max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-2.5 text-slate-400" />
            <Input
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.target.value);
                setPage(1);
              }}
              placeholder="Search work requests, clients, tasks..."
              className="h-9 pl-9 text-xs bg-slate-50 focus:bg-white"
              data-testid="wr-search-input"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Right Toolbar: View Switcher & New Request */}
          <div className="flex items-center gap-2">
            {/* View Switcher: Table vs Cards */}
            <div className="flex items-center border border-slate-200 rounded-md p-0.5 bg-slate-50">
              <Button
                type="button"
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="icon-xs"
                onClick={() => setViewMode('table')}
                title="Table View"
                data-testid="view-mode-table"
              >
                <TableIcon className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                size="icon-xs"
                onClick={() => setViewMode('cards')}
                title="Card List View"
                data-testid="view-mode-cards"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* + New Work Request */}
            {canEdit && onCreateNew && (
              <Button
                type="button"
                size="sm"
                onClick={onCreateNew}
                className="text-xs font-semibold gap-1.5"
                data-testid="new-wr-btn"
              >
                <Plus className="h-4 w-4" /> New Work Request
              </Button>
            )}
          </div>
        </div>

        {/* Filter Group */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 text-xs">
          <span className="text-slate-400 font-medium flex items-center gap-1 text-[11px]">
            <Filter className="h-3 w-3" /> Filters:
          </span>

          {/* Phase Filter */}
          <Select
            value={phaseFilter}
            onValueChange={(val) => {
              setPhaseFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 text-[11px] w-auto min-w-28 bg-slate-50">
              <SelectValue placeholder="Phase" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Phases</SelectItem>
              <SelectItem value="pre_processing">Pre-processing</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="quality_assurance">Quality Assurance</SelectItem>
              <SelectItem value="completion">Completion</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onValueChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 text-[11px] w-auto min-w-28 bg-slate-50">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {WORK_REQUEST_STATUS_OPTIONS.map((st) => (
                <SelectItem key={st} value={st}>
                  {st}
                </SelectItem>
              ))}
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Pre-processing">Pre-processing</SelectItem>
              <SelectItem value="Processing">Processing</SelectItem>
              <SelectItem value="For Review">For Review</SelectItem>
              <SelectItem value="Disbursement">Disbursement</SelectItem>
              <SelectItem value="On Hold">On Hold</SelectItem>
              <SelectItem value="Cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>

          {/* Priority Filter */}
          <Select
            value={priorityFilter}
            onValueChange={(val) => {
              setPriorityFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 text-[11px] w-auto min-w-24 bg-slate-50">
              <SelectValue placeholder="Priority" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="Urgent">Urgent</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Normal">Normal</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>

          {/* Client Filter */}
          <Select
            value={clientFilter}
            onValueChange={(val) => {
              setClientFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 text-[11px] w-auto min-w-32 bg-slate-50">
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Clients</SelectItem>
              {clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Assignee Filter */}
          <Select
            value={assigneeFilter}
            onValueChange={(val) => {
              setAssigneeFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 text-[11px] w-auto min-w-28 bg-slate-50">
              <SelectValue placeholder="Assignee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assignees</SelectItem>
              <SelectItem value="unassigned">— Unassigned —</SelectItem>
              {team.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Due Date Filter */}
          <Select
            value={dateFilter}
            onValueChange={(val) => {
              setDateFilter(val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-7 text-[11px] w-auto min-w-28 bg-slate-50">
              <SelectValue placeholder="Due Date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Date</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="today">Due Today</SelectItem>
              <SelectItem value="this_week">Due This Week</SelectItem>
              <SelectItem value="this_month">Due This Month</SelectItem>
              <SelectItem value="no_date">No Date Set</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleClearFilters}
              className="text-xs text-blue-600 hover:text-blue-800 h-7 px-2"
              data-testid="clear-filters-btn"
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* 2. Bulk Actions Bar (conditional) */}
      {selectedIds.size > 0 && (
        <div
          className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between text-xs text-blue-900"
          data-testid="bulk-actions-bar"
        >
          <div className="flex items-center gap-2 font-semibold">
            <span>{selectedIds.size} work requests selected</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setSelectedIds(new Set())}
              className="text-blue-700 hover:text-blue-900 text-xs h-6 px-1.5"
            >
              Deselect all
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={handleBulkArchive}
              className="bg-white text-xs gap-1"
              data-testid="bulk-archive-btn"
            >
              <Archive className="h-3 w-3" /> Archive Completed
            </Button>
            {canEdit && (
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={handleBulkCancel}
                className="text-xs gap-1"
                data-testid="bulk-cancel-btn"
              >
                <Ban className="h-3 w-3" /> Cancel Selected
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 3. Main View Area (Table vs Cards) */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-lg">
          Loading operations work requests...
        </div>
      ) : paginatedRequests.length === 0 ? (
        /* Empty States: Filtered vs Zero Total */
        <div className="p-12 text-center bg-white border border-slate-200 rounded-lg space-y-3">
          {hasActiveFilters ? (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-800">
                No work requests match your filters
              </h4>
              <p className="text-xs text-slate-500">
                Try adjusting your search criteria or clearing all active filters.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClearFilters}
                className="mt-2 text-xs"
              >
                Clear all filters
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <h4 className="text-sm font-semibold text-slate-800">No work requests yet</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Create your first work request to start tracking client deliverables and phase progress.
              </p>
              {canEdit && onCreateNew && (
                <Button
                  type="button"
                  size="sm"
                  onClick={onCreateNew}
                  className="mt-2 text-xs font-semibold gap-1"
                >
                  <Plus className="h-4 w-4" /> Add Work Request
                </Button>
              )}
            </div>
          )}
        </div>
      ) : viewMode === 'table' ? (
        /* TABLE VIEW */
        <div className="border border-slate-200 rounded-lg bg-white overflow-hidden shadow-xs">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50 hover:bg-slate-50">
                <TableHead className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      paginatedRequests.length > 0 &&
                      paginatedRequests.every((r) => selectedIds.has(r.id))
                    }
                    onChange={handleSelectAllOnPage}
                    className="rounded text-blue-600"
                    aria-label="Select all on page"
                  />
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 w-1/3">
                  Work Request
                </TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Client</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Priority</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Phase & Status</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700">Due Date</TableHead>
                <TableHead className="text-xs font-semibold text-slate-700 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRequests.map((wr) => {
                const isSelected = selectedIds.has(wr.id);
                const blocker = getBlockerInfo(wr);

                return (
                  <TableRow
                    key={wr.id}
                    onMouseEnter={() => prefetchWorkRequestDetail(wr.id)}
                    className={`hover:bg-slate-50/70 transition-colors ${
                      isSelected ? 'bg-blue-50/40' : ''
                    }`}
                    data-testid={`wr-row-${wr.id}`}
                  >
                    {/* Checkbox */}
                    <TableCell className="text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleSelectRow(wr.id)}
                        className="rounded text-blue-600"
                        aria-label={`Select ${wr.title}`}
                      />
                    </TableCell>

                    {/* Title & Badges */}
                    <TableCell className="font-medium text-xs text-slate-900">
                      <div className="flex flex-col space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            onClick={() => setPeekWrId(wr.id)}
                            className="font-semibold text-slate-900 hover:text-blue-600 cursor-pointer"
                          >
                            {wr.title}
                          </span>
                          {/* Blocker Badge with Tooltip */}
                          {blocker.hasBlockers && (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100/70 border border-amber-300 rounded px-1.5 py-0.2 cursor-help"
                              title={`Incomplete Gate Tasks:\n${blocker.taskTitles.join('\n')}`}
                              data-testid={`blocker-badge-${wr.id}`}
                            >
                              <AlertTriangle className="h-3 w-3 text-amber-600" />
                              {blocker.count} blocker{blocker.count > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                        {wr.description && (
                          <span className="text-[11px] text-slate-500 truncate max-w-sm">
                            {wr.description}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Client & Entity */}
                    <TableCell className="text-xs text-slate-700">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">
                          {wr.clientName || clients.find((c) => c.id === wr.clientId)?.name || '—'}
                        </span>
                        <Badge variant={wr.entity === 'LTA' ? 'lta' : 'ata'} size="compact">
                          {wr.entity}
                        </Badge>
                      </div>
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
                      >
                        {wr.priority}
                      </Badge>
                    </TableCell>

                    {/* Phase & Status */}
                    <TableCell>
                      {(() => {
                        const phaseInfo = getPhaseBadgeInfo(wr.phase);
                        const statusInfo = getStatusBadgeInfo(wr.status);
                        const PhaseIcon = phaseInfo.Icon;
                        const StatusIcon = statusInfo.Icon;
                        return (
                          <div className="flex flex-col gap-1 items-start">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${phaseInfo.badgeClass}`}
                              title={`Phase: ${phaseInfo.label}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${phaseInfo.dotClass}`} />
                              <PhaseIcon className="w-3 h-3 shrink-0" />
                              <span>{phaseInfo.label}</span>
                            </span>
                            {isAdmin ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-all cursor-pointer hover:shadow-xs ${statusInfo.badgeClass}`}
                                    title="Change Work Request Status (Admin)"
                                  >
                                    <span className={`w-1 h-1 rounded-full ${statusInfo.dotClass}`} />
                                    <StatusIcon className="w-2.5 h-2.5 shrink-0" />
                                    <span>{statusInfo.label}</span>
                                    <ChevronDown className="w-2.5 h-2.5 ml-0.5 opacity-60" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="start"
                                  className="w-56 p-1 bg-white shadow-lg border border-slate-200 rounded-lg max-h-80 overflow-y-auto z-50"
                                >
                                  <DropdownMenuLabel className="text-[10px] uppercase font-bold text-slate-500 px-2 py-1">
                                    Set Status (Admin)
                                  </DropdownMenuLabel>
                                  <DropdownMenuSeparator className="my-1 bg-slate-100" />
                                  {WORK_REQUEST_STATUS_OPTIONS.map((opt) => (
                                    <DropdownMenuItem
                                      key={opt}
                                      onClick={async () => {
                                        try {
                                          // Optimistic-with-rollback: the chip flips
                                          // instantly; on failure caches restore and
                                          // the verbatim error toasts.
                                          await statusOptimistic({
                                            id: wr.id,
                                            status: opt,
                                            entity: wr.entity,
                                            expectedVersion: wr.version,
                                          });
                                          toast.success(`Status updated to "${opt}"`);
                                        } catch (e: unknown) {
                                          if (isConcurrencyConflictError(e)) {
                                            setConflictState({
                                              isOpen: true,
                                              workRequest: wr,
                                              attemptedStatus: opt,
                                              error: e as ApiError,
                                            });
                                            return;
                                          }
                                          toast.error(e instanceof Error ? e.message : 'Update failed');
                                        }
                                      }}
                                      className={`text-xs px-2 py-1.5 cursor-pointer flex items-center justify-between hover:bg-slate-50 ${
                                        wr.status === opt ? 'font-bold bg-slate-100' : ''
                                      }`}
                                    >
                                      <span>{opt}</span>
                                      {wr.status === opt && <Check className="w-3 h-3 text-emerald-600" />}
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : (
                              <span
                                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusInfo.badgeClass}`}
                                title={`Status: ${statusInfo.label}`}
                              >
                                <span className={`w-1 h-1 rounded-full ${statusInfo.dotClass}`} />
                                <StatusIcon className="w-2.5 h-2.5 shrink-0" />
                                <span>{statusInfo.label}</span>
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>

                    {/* Due Date */}
                    <TableCell className="text-xs text-slate-600">
                      {wr.dueDate ? (
                        <span
                          className={
                            new Date(wr.dueDate) < new Date() &&
                            wr.status !== 'Completed' &&
                            wr.status !== 'Cancelled'
                              ? 'text-red-600 font-semibold'
                              : ''
                          }
                        >
                          {new Date(wr.dueDate).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">No date</span>
                      )}
                    </TableCell>

                    {/* Row Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* View */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => setPeekWrId(wr.id)}
                          title="View Details"
                          className="text-slate-500 hover:text-slate-900"
                          data-testid={`action-view-${wr.id}`}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>

                        {/* Edit */}
                        {canEdit && onEdit && wr.status !== 'Completed' && wr.phase !== 'completion' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => onEdit(wr)}
                            title="Edit Work Request"
                            className="text-slate-500 hover:text-blue-600"
                            data-testid={`action-edit-${wr.id}`}
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Advance */}
                        {canAdvance && wr.phase !== 'completion' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => handleDirectAdvance(wr)}
                            title="Advance Phase"
                            className="text-blue-600 hover:text-blue-800"
                            data-testid={`action-advance-${wr.id}`}
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Archive (Completed only) */}
                        {canEdit && wr.status === 'Completed' && !wr.archived && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() =>
                              setArchiveModalConfig({
                                isOpen: true,
                                actionType: 'archive',
                                workRequest: wr,
                              })
                            }
                            title="Archive"
                            className="text-slate-500 hover:text-amber-700"
                            data-testid={`action-archive-${wr.id}`}
                          >
                            <Archive className="h-3.5 w-3.5" />
                          </Button>
                        )}

                        {/* Cancel (Active only) */}
                        {canEdit &&
                          wr.status !== 'Completed' &&
                          wr.status !== 'Cancelled' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              onClick={() =>
                                setArchiveModalConfig({
                                  isOpen: true,
                                  actionType: 'cancel',
                                  workRequest: wr,
                                })
                              }
                              title="Cancel Work Request"
                              className="text-slate-400 hover:text-red-600"
                              data-testid={`action-cancel-${wr.id}`}
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        /* COMPACT CARD LIST VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="card-list-view">
          {paginatedRequests.map((wr) => {
            const blocker = getBlockerInfo(wr);

            return (
              <div
                key={wr.id}
                className="p-4 bg-white border border-slate-200 rounded-lg space-y-3 hover:border-slate-300 transition-colors shadow-xs"
                data-testid={`wr-card-${wr.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <h4
                      onClick={() => setPeekWrId(wr.id)}
                      className="font-bold text-xs text-slate-900 hover:text-blue-600 cursor-pointer line-clamp-1"
                    >
                      {wr.title}
                    </h4>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Building className="h-3 w-3" />
                      <span className="truncate max-w-40">
                        {wr.clientName || clients.find((c) => c.id === wr.clientId)?.name || '—'}
                      </span>
                      <Badge variant={wr.entity === 'LTA' ? 'lta' : 'ata'} size="compact">
                        {wr.entity}
                      </Badge>
                    </div>
                  </div>

                  <Badge
                    variant={
                      wr.priority === 'Urgent'
                        ? 'destructive'
                        : wr.priority === 'High'
                          ? 'warning'
                          : 'secondary'
                    }
                    size="compact"
                  >
                    {wr.priority}
                  </Badge>
                </div>

                {/* Phase & Status Pills */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {(() => {
                    const phaseInfo = getPhaseBadgeInfo(wr.phase);
                    const statusInfo = getStatusBadgeInfo(wr.status);
                    const PhaseIcon = phaseInfo.Icon;
                    const StatusIcon = statusInfo.Icon;
                    return (
                      <>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${phaseInfo.badgeClass}`}
                          title={`Phase: ${phaseInfo.label}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${phaseInfo.dotClass}`} />
                          <PhaseIcon className="w-3 h-3 shrink-0" />
                          <span>{phaseInfo.label}</span>
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${statusInfo.badgeClass}`}
                          title={`Status: ${statusInfo.label}`}
                        >
                          <span className={`w-1 h-1 rounded-full ${statusInfo.dotClass}`} />
                          <StatusIcon className="w-2.5 h-2.5 shrink-0" />
                          <span>{statusInfo.label}</span>
                        </span>
                      </>
                    );
                  })()}
                </div>

                {/* Blocker Alert */}
                {blocker.hasBlockers && (
                  <div
                    className="p-1.5 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 flex items-center gap-1.5"
                    title={`Incomplete:\n${blocker.taskTitles.join('\n')}`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span>{blocker.count} incomplete gate blocker(s)</span>
                  </div>
                )}

                {/* Footer Metadata & Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs">
                  <div className="flex items-center gap-2 text-slate-500 text-[11px]">
                    {wr.dueDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(wr.dueDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {onEdit && canEdit && wr.status !== 'Completed' && wr.phase !== 'completion' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => onEdit(wr)}
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canAdvance && wr.phase !== 'completion' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => handleDirectAdvance(wr)}
                        className="text-blue-600"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Pagination Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-2 py-3 text-xs text-slate-500" data-testid="wr-pagination">
        <div>
          Showing{' '}
          <span className="font-semibold text-slate-700">
            {totalItems === 0 ? 0 : (page - 1) * pageSize + 1}
          </span>{' '}
          to{' '}
          <span className="font-semibold text-slate-700">
            {Math.min(page * pageSize, totalItems)}
          </span>{' '}
          of <span className="font-semibold text-slate-700">{totalItems}</span> work requests
        </div>

        <div className="flex items-center gap-3">
          {/* Page size select */}
          <div className="flex items-center gap-1.5">
            <span>Per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => {
                setPageSize(Number(val));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-16 text-xs bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Prev / Next Buttons */}
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(p - 1, 1))}
              aria-label="Previous Page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-2 text-xs font-medium text-slate-700">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
              aria-label="Next Page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Archive / Cancel Confirm Modal */}
      {archiveModalConfig.isOpen && (
        <ArchiveConfirmModal
          isOpen={archiveModalConfig.isOpen}
          actionType={archiveModalConfig.actionType}
          workRequest={archiveModalConfig.workRequest}
          onClose={() =>
            setArchiveModalConfig({
              isOpen: false,
              actionType: 'archive',
              workRequest: null,
            })
          }
        />
      )}

      {/* Side Peek Panel (UAT-GEN2) */}
      <WorkRequestSidePeek
        isOpen={Boolean(peekWrId)}
        workRequestId={peekWrId}
        onClose={() => setPeekWrId(null)}
        onEdit={onEdit}
        onViewInBoard={onViewDetails}
      />

      {/* OCC Concurrency Conflict Resolution Modal */}
      <ConflictResolutionModal
        isOpen={conflictState.isOpen}
        onClose={() => setConflictState((prev) => ({ ...prev, isOpen: false }))}
        error={conflictState.error}
        entityTitle={conflictState.workRequest?.title}
        entityType="Work Request"
        expectedVersion={conflictState.workRequest?.version}
        attemptedStatus={conflictState.attemptedStatus}
        currentStatus={conflictState.workRequest?.status}
        onRefreshAndKeepLatest={async () => {
          await queryClient.refetchQueries({
            queryKey: operationsKeys.workRequests(),
          });
          if (conflictState.workRequest?.id) {
            await queryClient.refetchQueries({
              queryKey: operationsKeys.workRequestDetail(conflictState.workRequest.id),
            });
          }
          setConflictState((prev) => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConflictState((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
