import { useState, useEffect, useMemo } from 'react';
import {
  X,
  Building,
  Calendar,
  User,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Edit,
  Columns,
  FileText,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Eye,
  Download,
  ExternalLink,
  Check,
  Lock,
  Layers,
  ArrowRight,
  Maximize2,
  FileSpreadsheet,
  FileImage,
  FileCode,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import {
  useWorkRequestDetail,
  useWorkRequestMutations,
} from '../api/useWorkRequests';
import { useWorkRequestTasks } from '../api/useTasks';
import { useDocuments, useDocumentDownloadUrl } from '../api/useDocuments';
import { useTeam } from '../api/useTeam';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isUserAdmin } from '../lib/taskScope';
import { getPhaseBadgeInfo, getStatusBadgeInfo } from '../lib/statusBadges';
import { TaskDetailModal } from './TaskDetailModal';
import { DocumentViewerModal } from './DocumentViewerModal';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { PresenceAvatars } from '@/components/common/PresenceAvatars';
import { operationsKeys } from '../api/queryKeys';
import type { ApiError } from '@/lib/api';
import {
  type WorkRequest,
  type Task,
  type Phase,
  type DmsDocument,
  type WorkRequestStatus,
  WORK_REQUEST_STATUS_OPTIONS,
} from '../api/types';

export interface WorkRequestSidePeekProps {
  isOpen: boolean;
  onClose: () => void;
  workRequestId: string | null;
  onEdit?: (wr: WorkRequest) => void;
  onViewInBoard?: (wrId: string) => void;
}

export function WorkRequestSidePeek({
  isOpen,
  onClose,
  workRequestId,
  onEdit,
  onViewInBoard,
}: WorkRequestSidePeekProps) {
  const permissions = useSessionStore((state) => state.permissions);
  const user = useSessionStore((state) => state.user);
  const canEdit = hasPermission(permissions, 'workflow:edit');
  const isAdmin = isUserAdmin(user);

  // Modal inspection states
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [previewDoc, setPreviewDoc] = useState<DmsDocument | null>(null);
  const [viewerDoc, setViewerDoc] = useState<DmsDocument | null>(null);
  const [conflictModalState, setConflictModalState] = useState<{
    isOpen: boolean;
    attemptedStatus: WorkRequestStatus | null;
    error: ApiError | null;
  }>({
    isOpen: false,
    attemptedStatus: null,
    error: null,
  });
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  // Fetch work request detail
  const {
    data: workRequest,
    isLoading: isLoadingWr,
  } = useWorkRequestDetail(workRequestId || '', {
    enabled: Boolean(isOpen && workRequestId),
  });

  const { statusOptimistic, isStatusOptimisticPending: isUpdatingWr } = useWorkRequestMutations();

  // Fetch tasks
  const {
    data: tasks = [],
    isLoading: isLoadingTasks,
  } = useWorkRequestTasks(workRequestId || '', {
    enabled: Boolean(isOpen && workRequestId),
  });

  // Fetch documents
  const { data: rawDocs, isLoading: isLoadingDocs } = useDocuments(
    workRequestId ? { workRequestId } : undefined,
    { enabled: Boolean(isOpen && workRequestId) }
  );

  const documents = useMemo(() => {
    return Array.isArray(rawDocs) ? rawDocs : rawDocs?.data ?? [];
  }, [rawDocs]);

  // Fetch team directory for name resolution (UAT2-5)
  const { data: rawTeam } = useTeam();
  const teamList = useMemo(() => {
    if (Array.isArray(rawTeam)) return rawTeam;
    if (rawTeam && typeof rawTeam === 'object' && 'data' in rawTeam && Array.isArray((rawTeam as { data: unknown[] }).data)) {
      return (rawTeam as { data: Array<{ id: string; name: string }> }).data;
    }
    return [];
  }, [rawTeam]);

  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of teamList) {
      if (m && m.id && m.name) {
        map.set(m.id, m.name);
      }
    }
    return map;
  }, [teamList]);

  const resolveUserName = useMemo(() => {
    return (idOrName: string | null | undefined): string => {
      if (!idOrName) return 'Unassigned';
      if (teamMap.has(idOrName)) {
        return teamMap.get(idOrName)!;
      }
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName);
      if (isUuid) {
        return 'Staff Member';
      }
      return idOrName;
    };
  }, [teamMap]);

  const assignedLeadName = useMemo(() => {
    if (!workRequest) return 'Unassigned';
    if (workRequest.assignedToName) return workRequest.assignedToName;
    if (workRequest.assigned_to_name) return workRequest.assigned_to_name;
    return resolveUserName(workRequest.assignedTo);
  }, [workRequest, resolveUserName]);

  const coAssigneeNames = useMemo(() => {
    if (!workRequest?.coAssignees || !Array.isArray(workRequest.coAssignees)) return [];
    return workRequest.coAssignees.map((val) => resolveUserName(val));
  }, [workRequest, resolveUserName]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't close sidepeek if a submodal (Task or Document) is currently open
      if (e.key === 'Escape' && !selectedTask && !viewerDoc) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, selectedTask, viewerDoc]);

  // Compute blocker info
  const blockerInfo = useMemo(() => {
    if (!workRequest || !tasks.length) return { hasBlockers: false, incomplete: [] };
    const activeTasks = tasks.filter((t) => t.status !== 'Cancelled');
    const phase = workRequest.phase as Phase;

    let incomplete: Task[] = [];
    if (phase === 'pre_processing') {
      incomplete = activeTasks.filter(
        (t) => t.phase === 'pre_processing' && t.status !== 'Completed'
      );
    } else if (phase === 'processing') {
      incomplete = activeTasks.filter(
        (t) => t.phase === 'processing' && t.status !== 'Completed'
      );
    } else if (phase === 'quality_assurance') {
      incomplete = activeTasks.filter(
        (t) => t.status !== 'Completed' || t.qaStatus !== 'passed'
      );
    }

    return {
      hasBlockers: incomplete.length > 0,
      incomplete,
    };
  }, [workRequest, tasks]);

  // Handle Admin status transition with no strict guard — OPTIMISTIC:
  // the badge flips instantly; a failed write rolls the cache back and the
  // verbatim server error surfaces via toast.
  const handleStatusChange = async (newStatus: WorkRequestStatus) => {
    if (!workRequest || workRequest.status === newStatus) return;
    try {
      await statusOptimistic({
        id: workRequest.id,
        status: newStatus,
        entity: workRequest.entity,
        expectedVersion: workRequest.version,
      });
      toast.success(`Work request status updated to "${newStatus}"`);
    } catch (err: unknown) {
      if (isConcurrencyConflictError(err)) {
        setConflictModalState({
          isOpen: true,
          attemptedStatus: newStatus,
          error: err as ApiError,
        });
        return;
      }
      const msg = err instanceof Error ? err.message : 'Failed to update work request status';
      toast.error(msg);
    }
  };

  const toggleTaskExpanded = (taskId: string) => {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const completedTasksCount = useMemo(() => {
    return tasks.filter((t) => t.status === 'Completed').length;
  }, [tasks]);

  const progressPercentage = useMemo(() => {
    if (!tasks.length) return 0;
    return Math.round((completedTasksCount / tasks.length) * 100);
  }, [completedTasksCount, tasks.length]);

  if (!isOpen || !workRequestId) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 overflow-hidden"
        data-testid="wr-side-peek"
        aria-label="Work Request Side Peek"
        role="region"
      >
        {/* Backdrop */}
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-200"
          onClick={onClose}
          aria-hidden="true"
          data-testid="side-peek-backdrop"
        />

        {/* Slide-out Drawer Panel */}
        <div className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10">
          <div className="w-screen max-w-2xl md:max-w-3xl bg-white shadow-2xl border-l border-slate-200 flex flex-col h-full animate-in slide-in-from-right duration-200 text-slate-800">
            {/* Header: Notion-style Breadcrumb & Actions */}
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 backdrop-blur-sm flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1 min-w-0">
                {/* Meta badges & Notion-like status dropdown */}
                <div className="flex flex-wrap items-center gap-2">
                  {workRequest && (
                    <>
                      <Badge
                        variant={workRequest.entity === 'LTA' ? 'lta' : 'ata'}
                        size="compact"
                        className="font-bold tracking-wider"
                      >
                        {workRequest.entity}
                      </Badge>
                      <Badge
                        variant={
                          workRequest.priority === 'Urgent'
                            ? 'destructive'
                            : workRequest.priority === 'High'
                              ? 'warning'
                              : 'secondary'
                        }
                        size="compact"
                        className="font-medium"
                      >
                        {workRequest.priority} Priority
                      </Badge>

                      {/* Phase Indicator */}
                      {(() => {
                        const phaseInfo = getPhaseBadgeInfo(workRequest.phase);
                        const PhaseIcon = phaseInfo.Icon;
                        return (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${phaseInfo.badgeClass}`}
                            data-testid="side-peek-phase"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${phaseInfo.dotClass}`} />
                            <PhaseIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>Phase: {workRequest.phase.replace('_', ' ')}</span>
                          </span>
                        );
                      })()}

                      {/* Status: Editable Dropdown for Admin, Readonly Pill for Non-Admin */}
                      {(() => {
                        const statusInfo = getStatusBadgeInfo(workRequest.status);
                        const StatusIcon = statusInfo.Icon;

                        if (isAdmin) {
                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer hover:shadow-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${statusInfo.badgeClass}`}
                                  data-testid="side-peek-status"
                                  data-admin-status-dropdown="true"
                                  title="Change Work Request Status (Admin: Unconstrained)"
                                  disabled={isUpdatingWr}
                                >
                                  <span className={`w-2 h-2 rounded-full ${statusInfo.dotClass}`} />
                                  <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                                  <span>{statusInfo.label}</span>
                                  <ChevronDown className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-64 p-1.5 bg-white shadow-xl border border-slate-200 rounded-lg max-h-96 overflow-y-auto z-50"
                              >
                                <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-wider text-slate-500 px-2 py-1 flex items-center justify-between">
                                  <span>Set Work Request Status</span>
                                  <span className="text-[10px] text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded font-normal">
                                    Admin Free Change
                                  </span>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator className="my-1 bg-slate-100" />
                                {WORK_REQUEST_STATUS_OPTIONS.map((statusOption) => {
                                  const optInfo = getStatusBadgeInfo(statusOption);
                                  const OptIcon = optInfo.Icon;
                                  const isCurrent = workRequest.status === statusOption;

                                  return (
                                    <DropdownMenuItem
                                      key={statusOption}
                                      onClick={() => handleStatusChange(statusOption)}
                                      className={`flex items-center justify-between px-2.5 py-2 text-xs rounded-md cursor-pointer transition-colors ${
                                        isCurrent
                                          ? 'bg-slate-100 font-bold text-slate-900'
                                          : 'text-slate-700 hover:bg-slate-50'
                                      }`}
                                      data-testid={`status-option-${statusOption}`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <span className={`w-2 h-2 rounded-full ${optInfo.dotClass}`} />
                                        <OptIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                                        <span className="truncate">{statusOption}</span>
                                      </div>
                                      {isCurrent && <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          );
                        }

                        // Readonly status badge for non-admin
                        return (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${statusInfo.badgeClass}`}
                            data-testid="side-peek-status"
                            title="Work request status (Admin only can modify)"
                          >
                            <span className={`w-2 h-2 rounded-full ${statusInfo.dotClass}`} />
                            <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>{statusInfo.label}</span>
                            <Lock className="w-3 h-3 ml-0.5 text-slate-400" />
                          </span>
                        );
                      })()}
                    </>
                  )}
                </div>

                {/* Big, clean Notion-style Title */}
                <h2
                  className="text-xl font-bold text-slate-900 leading-snug break-words"
                  data-testid="side-peek-title"
                >
                  {isLoadingWr ? 'Loading Work Request...' : workRequest?.title || 'Work Request'}
                </h2>
              </div>

              {/* Action buttons in header */}
              <div className="flex items-center gap-1.5 shrink-0">
                {(workRequest || workRequestId) && <PresenceAvatars roomId={workRequest?.id || workRequestId} />}
                {onViewInBoard && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onViewInBoard(workRequestId);
                      onClose();
                    }}
                    className="text-xs gap-1.5 font-medium border-slate-300 hover:bg-slate-100 text-slate-700"
                    data-testid="side-peek-board-btn"
                    title="Open in Kanban Board"
                  >
                    <Columns className="h-3.5 w-3.5 text-blue-600" />
                    Board
                  </Button>
                )}
                {canEdit && onEdit && workRequest && workRequest.status !== 'Completed' && workRequest.phase !== 'completion' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onEdit(workRequest);
                      onClose();
                    }}
                    className="text-xs gap-1.5 font-medium border-slate-300 hover:bg-slate-100 text-slate-700"
                    data-testid="side-peek-edit-btn"
                    title="Edit Work Request"
                  >
                    <Edit className="h-3.5 w-3.5 text-slate-600" />
                    Edit
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  className="text-slate-400 hover:text-slate-700 ml-1 rounded-lg"
                  data-testid="side-peek-close-btn"
                  aria-label="Close Side Peek"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {isLoadingWr ? (
                <div className="p-12 text-center text-sm text-slate-500">
                  <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  Loading work request details...
                </div>
              ) : workRequest ? (
                <>
                  {/* 1. Gate Blocker Warning */}
                  {blockerInfo.hasBlockers && (
                    <div
                      className="p-4 bg-amber-50/90 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1.5 shadow-2xs"
                      data-testid="side-peek-blocker-alert"
                    >
                      <div className="flex items-center gap-2 font-bold text-sm text-amber-900">
                        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                        <span>Phase Advancement Blocked</span>
                      </div>
                      <p className="text-xs text-amber-800 pl-6 leading-relaxed">
                        {blockerInfo.incomplete.length} task(s) in phase &quot;
                        {workRequest.phase.replace('_', ' ')}&quot; must be completed before advancing.
                      </p>
                    </div>
                  )}

                  {/* 2. Notion-Style Properties Grid */}
                  <div className="bg-slate-50/70 border border-slate-200 rounded-xl p-4.5 space-y-3 shadow-2xs">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-slate-400" />
                      Properties
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                      {/* Client */}
                      <div className="flex items-center justify-between p-2 bg-white border border-slate-200/80 rounded-lg">
                        <span className="text-slate-500 font-medium flex items-center gap-1.5">
                          <Building className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          Client
                        </span>
                        <span
                          className="font-bold text-slate-800 truncate max-w-[160px]"
                          data-testid="side-peek-client"
                        >
                          {workRequest.clientName || '—'}
                        </span>
                      </div>

                      {/* Due Date */}
                      <div className="flex items-center justify-between p-2 bg-white border border-slate-200/80 rounded-lg">
                        <span className="text-slate-500 font-medium flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          Due Date
                        </span>
                        <span className="font-semibold text-slate-800">
                          {workRequest.dueDate
                            ? new Date(workRequest.dueDate).toLocaleDateString()
                            : 'No due date'}
                        </span>
                      </div>

                      {/* Assigned Lead */}
                      <div className="flex items-center justify-between p-2 bg-white border border-slate-200/80 rounded-lg">
                        <span className="text-slate-500 font-medium flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          Assigned Lead
                        </span>
                        <span
                          className="font-bold text-slate-800 truncate max-w-[160px]"
                          data-testid="side-peek-assignee"
                        >
                          {assignedLeadName}
                        </span>
                      </div>

                      {/* Created Date */}
                      <div className="flex items-center justify-between p-2 bg-white border border-slate-200/80 rounded-lg">
                        <span className="text-slate-500 font-medium flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          Created Date
                        </span>
                        <span className="font-medium text-slate-700">
                          {workRequest.createdAt
                            ? new Date(workRequest.createdAt).toLocaleDateString()
                            : 'N/A'}
                        </span>
                      </div>

                      {/* Co-Assignees */}
                      {coAssigneeNames.length > 0 && (
                        <div className="sm:col-span-2 p-2.5 bg-white border border-slate-200/80 rounded-lg">
                          <span className="text-[11px] uppercase font-bold text-slate-400 block mb-1.5 flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-slate-400" />
                            Team Members / Co-Assignees
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {coAssigneeNames.map((name, idx) => (
                              <Badge
                                key={`${name}-${idx}`}
                                variant="secondary"
                                size="compact"
                                className="text-xs bg-slate-100 font-medium text-slate-800 border-slate-300"
                                data-testid="side-peek-co-assignee"
                              >
                                <Users className="h-2.5 w-2.5 mr-1 text-slate-500" />
                                {name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 3. Description & Objectives */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-slate-400" />
                      Description & Objectives
                    </h4>
                    <div className="p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 whitespace-pre-wrap leading-relaxed shadow-2xs min-h-[60px]">
                      {workRequest.description || (
                        <span className="text-slate-400 italic">No description provided for this work request.</span>
                      )}
                    </div>
                  </div>

                  {/* 4. Tasks Breakdown with Inspection Affordance */}
                  <div className="space-y-3" data-testid="side-peek-tasks">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                        <CheckSquare className="h-4 w-4 text-indigo-600" />
                        <span>Tasks Breakdown ({completedTasksCount}/{tasks.length})</span>
                      </h4>
                      {tasks.length > 0 && (
                        <span className="text-xs font-semibold text-slate-600">
                          {progressPercentage}% Complete
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {tasks.length > 0 && (
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden border border-slate-200/60">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                    )}

                    {isLoadingTasks ? (
                      <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                        Loading tasks...
                      </div>
                    ) : tasks.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200 italic">
                        No tasks created for this work request yet.
                      </div>
                    ) : (
                      <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white shadow-2xs">
                        {tasks.map((task) => {
                          const isCompleted = task.status === 'Completed';
                          const isExpanded = expandedTaskIds.has(task.id);
                          const hasChecklist = Array.isArray(task.checklist) && task.checklist.length > 0;
                          const checklistDone = hasChecklist
                            ? task.checklist!.filter((c) => c.completed).length
                            : 0;

                          return (
                            <div
                              key={task.id}
                              className="group transition-colors hover:bg-slate-50/80"
                              data-testid={`side-peek-task-${task.id}`}
                            >
                              <div
                                className="p-3.5 flex items-center justify-between gap-3 text-xs cursor-pointer"
                                onClick={() => setSelectedTask(task)}
                                title="Click to view full task details, log time, and upload documents"
                              >
                                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                  <CheckCircle2
                                    className={`h-4.5 w-4.5 shrink-0 mt-0.5 ${
                                      isCompleted ? 'text-emerald-500' : 'text-slate-300'
                                    }`}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span
                                      className={`font-semibold text-sm block truncate ${
                                        isCompleted ? 'line-through text-slate-400' : 'text-slate-900 group-hover:text-indigo-600'
                                      }`}
                                    >
                                      {task.title}
                                    </span>

                                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 pt-1">
                                      <span className="capitalize">{task.phase.replace('_', ' ')}</span>
                                      {(task.assigneeName || task.assigneeId) && (
                                        <>
                                          <span>•</span>
                                          <span className="font-medium text-slate-700">
                                            {task.assigneeName
                                              ? resolveUserName(task.assigneeName)
                                              : resolveUserName(task.assigneeId)}
                                          </span>
                                        </>
                                      )}
                                      {hasChecklist && (
                                        <>
                                          <span>•</span>
                                          <span className="text-slate-600 font-medium bg-slate-100 px-1.5 py-0.2 rounded">
                                            ✓ {checklistDone}/{task.checklist!.length} subtasks
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {task.qaStatus && task.qaStatus !== 'none' && (
                                    <Badge
                                      variant={task.qaStatus === 'passed' ? 'success' : 'destructive'}
                                      size="compact"
                                      className="text-[10px]"
                                    >
                                      QA: {task.qaStatus}
                                    </Badge>
                                  )}
                                  <Badge
                                    variant={isCompleted ? 'success' : 'secondary'}
                                    size="compact"
                                    className="text-[11px] font-medium"
                                  >
                                    {task.status}
                                  </Badge>

                                  {/* View Button */}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className="gap-1 text-slate-600 hover:text-indigo-600 font-medium"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedTask(task);
                                    }}
                                  >
                                    <span>Details</span>
                                    <ArrowRight className="h-3 w-3" />
                                  </Button>

                                  {/* Subtasks expander toggle */}
                                  {hasChecklist && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      className="text-slate-400 hover:text-slate-700"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleTaskExpanded(task.id);
                                      }}
                                      title={isExpanded ? 'Hide Subtasks' : 'View Subtasks'}
                                    >
                                      {isExpanded ? (
                                        <ChevronDown className="h-4 w-4" />
                                      ) : (
                                        <ChevronRight className="h-4 w-4" />
                                      )}
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* Inline subtasks list if expanded */}
                              {isExpanded && hasChecklist && (
                                <div className="px-10 pb-3 space-y-1.5 bg-slate-50/60 border-t border-slate-100">
                                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block pt-2">
                                    Subtasks / Checklist:
                                  </span>
                                  {task.checklist!.map((item) => (
                                    <div
                                      key={item.id}
                                      className="flex items-center gap-2 text-xs text-slate-700 py-0.5"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={item.completed}
                                        disabled
                                        className="rounded border-slate-300 text-indigo-600"
                                      />
                                      <span className={item.completed ? 'line-through text-slate-400' : 'text-slate-800'}>
                                        {item.text}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* 5. Documents Section with Sidepeek Preview & Inspection */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <span>Attached Documents ({documents.length})</span>
                      </h4>
                      {previewDoc && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-slate-500 hover:text-slate-800 text-xs"
                          onClick={() => setPreviewDoc(null)}
                        >
                          Hide Preview
                        </Button>
                      )}
                    </div>

                    {isLoadingDocs ? (
                      <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                        Loading documents...
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200 italic">
                        No documents attached to this work request yet.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Inline Document Preview Box (When a doc is selected) */}
                        {previewDoc && (
                          <InlineDocPreviewPanel
                            document={previewDoc}
                            onClose={() => setPreviewDoc(null)}
                            onOpenFullViewer={() => setViewerDoc(previewDoc)}
                          />
                        )}

                        {/* Document Cards Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {documents.map((doc) => {
                            const name = doc.fileName || doc.file_name || doc.originalName || 'Document';
                            const isSelectedForPreview = previewDoc?.id === doc.id;
                            const isPdf = name.toLowerCase().endsWith('.pdf');
                            const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
                            const isSpreadsheet = /\.(xlsx?|csv)$/i.test(name);

                            return (
                              <div
                                key={doc.id}
                                className={`p-3 bg-white border rounded-xl text-xs flex flex-col justify-between gap-2.5 transition-all shadow-2xs hover:shadow-xs ${
                                  isSelectedForPreview
                                    ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/30'
                                    : 'border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                <div className="flex items-start gap-2.5 min-w-0">
                                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-200/80 shrink-0">
                                    {isPdf ? (
                                      <FileText className="h-4 w-4 text-rose-500" />
                                    ) : isImg ? (
                                      <FileImage className="h-4 w-4 text-violet-500" />
                                    ) : isSpreadsheet ? (
                                      <FileSpreadsheet className="h-4 w-4 text-emerald-500" />
                                    ) : (
                                      <FileCode className="h-4 w-4 text-blue-500" />
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <span
                                      className="font-semibold text-slate-900 block truncate"
                                      title={name}
                                    >
                                      {name}
                                    </span>
                                    <div className="text-[10px] text-slate-400 pt-0.5 flex items-center gap-1.5">
                                      {doc.category && <span className="uppercase">{doc.category}</span>}
                                      {doc.fileSize && (
                                        <>
                                          <span>•</span>
                                          <span>{Math.round(doc.fileSize / 1024)} KB</span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {/* Preview and View Actions */}
                                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                                  <Button
                                    type="button"
                                    variant={isSelectedForPreview ? 'default' : 'outline'}
                                    size="xs"
                                    className="gap-1 text-[11px] font-medium"
                                    onClick={() => setPreviewDoc(isSelectedForPreview ? null : doc)}
                                    title="Preview directly inside sidepeek"
                                  >
                                    <Eye className="h-3 w-3" />
                                    {isSelectedForPreview ? 'Previewing' : 'Preview'}
                                  </Button>

                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    className="gap-1 text-[11px] text-slate-600 hover:text-indigo-600"
                                    onClick={() => setViewerDoc(doc)}
                                    title="Open full document modal with comments"
                                  >
                                    <Maximize2 className="h-3 w-3" />
                                    Full View
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-12 text-center text-sm text-slate-400">
                  Work request not found.
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
              <span className="text-xs text-slate-400">
                ID: {workRequestId}
              </span>
              <div className="flex items-center gap-2">
                {onViewInBoard && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onViewInBoard(workRequestId);
                      onClose();
                    }}
                    className="text-xs gap-1.5 font-medium border-slate-300 text-slate-700"
                  >
                    <Columns className="h-3.5 w-3.5 text-blue-600" />
                    View in Board
                  </Button>
                )}
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={onClose}
                  className="text-xs font-semibold px-4"
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Task Inspection Modal (when a task is selected from the sidepeek) */}
      {selectedTask && (
        <TaskDetailModal
          isOpen={Boolean(selectedTask)}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          workRequest={workRequest}
        />
      )}

      {/* Document Viewer Modal (when Full View is selected) */}
      {viewerDoc && (
        <DocumentViewerModal
          isOpen={Boolean(viewerDoc)}
          onClose={() => setViewerDoc(null)}
          document={viewerDoc}
          workRequest={workRequest}
        />
      )}

      {/* Conflict Resolution Modal for OCC Concurrency Conflicts */}
      <ConflictResolutionModal
        isOpen={conflictModalState.isOpen}
        onClose={() => setConflictModalState((prev) => ({ ...prev, isOpen: false }))}
        error={conflictModalState.error}
        entityTitle={workRequest?.title}
        entityType="Work Request"
        expectedVersion={workRequest?.version}
        attemptedStatus={conflictModalState.attemptedStatus}
        currentStatus={workRequest?.status}
        onRefreshAndKeepLatest={async () => {
          if (workRequest?.id) {
            await queryClient.refetchQueries({
              queryKey: operationsKeys.workRequestDetail(workRequest.id),
            });
            await queryClient.refetchQueries({
              queryKey: operationsKeys.workRequests(),
            });
          }
          setConflictModalState((prev) => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConflictModalState((prev) => ({ ...prev, isOpen: false }))}
      />
    </>
  );
}

/**
 * Inline Document Previewer Box embedded inside the WorkRequestSidePeek
 */
function InlineDocPreviewPanel({
  document,
  onClose,
  onOpenFullViewer,
}: {
  document: DmsDocument;
  onClose: () => void;
  onOpenFullViewer: () => void;
}) {
  const { data: downloadData, isLoading } = useDocumentDownloadUrl(document.id);
  const name = document.fileName || document.file_name || document.originalName || 'Document';
  const downloadUrl = downloadData?.url;

  const isPdf = name.toLowerCase().endsWith('.pdf') || document.contentType?.includes('pdf');
  const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(name) || document.contentType?.startsWith('image/');
  const isText = /\.(txt|json|csv|md|log)$/i.test(name) || document.contentType?.includes('text');

  return (
    <div className="border border-indigo-200 bg-indigo-50/20 rounded-xl p-3.5 space-y-2.5 shadow-sm">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-indigo-100 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-4 w-4 text-indigo-600 shrink-0" />
          <span className="font-bold text-xs text-slate-800 truncate" title={name}>
            Previewing: {name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {downloadUrl && (
            <a href={downloadUrl} download={name} target="_blank" rel="noreferrer">
              <Button size="xs" variant="outline" className="gap-1 text-[11px] h-7">
                <Download className="h-3 w-3" /> Download
              </Button>
            </a>
          )}
          <Button
            size="xs"
            variant="outline"
            className="gap-1 text-[11px] h-7 text-indigo-700 border-indigo-300 hover:bg-indigo-50"
            onClick={onOpenFullViewer}
          >
            <ExternalLink className="h-3 w-3" /> Full View
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 h-7 w-7"
            title="Close Preview"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Panel Body */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden min-h-[220px]">
        {isLoading ? (
          <div className="p-10 text-center text-xs text-slate-500 space-y-2">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
            <p>Loading document preview...</p>
          </div>
        ) : !downloadUrl ? (
          <div className="p-8 text-center text-xs text-slate-500">
            Preview is unavailable for this document.
          </div>
        ) : isPdf ? (
          <iframe
            src={downloadUrl}
            className="w-full h-80 sm:h-96 border-0"
            title={`Preview - ${name}`}
            data-testid="inline-doc-preview-frame"
          />
        ) : isImg ? (
          <div className="w-full h-72 sm:h-80 flex items-center justify-center p-3 bg-slate-50">
            <img
              src={downloadUrl}
              alt={name}
              className="max-h-full max-w-full object-contain rounded shadow-xs"
              data-testid="inline-doc-preview-image"
            />
          </div>
        ) : isText ? (
          <iframe
            src={downloadUrl}
            className="w-full h-72 border-0 font-mono text-xs p-3 bg-slate-50"
            title={`Preview - ${name}`}
            data-testid="inline-doc-preview-frame"
          />
        ) : (
          <div className="p-8 text-center space-y-3">
            <FileText className="h-10 w-10 text-blue-600 mx-auto" />
            <div className="space-y-1">
              <h5 className="font-semibold text-slate-800 text-xs">{name}</h5>
              <p className="text-[11px] text-slate-500">
                This document type cannot be embedded inline. You can download or open it in the full viewer.
              </p>
            </div>
            <a href={downloadUrl} download={name} target="_blank" rel="noreferrer">
              <Button size="sm" className="gap-1.5 text-xs">
                <Download className="h-3.5 w-3.5" /> Download File
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
