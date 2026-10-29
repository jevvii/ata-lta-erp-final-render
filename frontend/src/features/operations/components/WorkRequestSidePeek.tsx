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
  XCircle,
  Pencil,
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
  Receipt,
  CreditCard,
  Send,
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
  useWorkRequestRelated,
} from '../api/useWorkRequests';
import { useWorkRequestTasks, useTaskMutations } from '../api/useTasks';
import { useDocuments, useDocumentDownloadUrl } from '../api/useDocuments';
import { useTeam } from '../api/useTeam';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import {
  isUserAdmin,
  canReviewTaskCreation,
  isTaskRejected,
  isTaskPendingApproval,
  canResubmitTask,
} from '../lib/taskScope';
import { getPhaseBadgeInfo, getStatusBadgeInfo } from '../lib/statusBadges';
import { TaskTypeBadge } from '../lib/taskTypes';
import { TaskDetailModal } from './TaskDetailModal';
import { DocumentViewerModal } from './DocumentViewerModal';
import { RejectReasonModal } from './RejectReasonModal';
import { TaskResubmitModal } from './TaskResubmitModal';
import { parseExternalUrl } from '@/features/documents';
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

  const activeEntity = useSessionStore((state) => state.activeEntity);

  // Scope owner tracking (Directive 1, Final Review):
  // Guard against entity or account switching while sidepeek is open.
  const [peekScopeOwner, setPeekScopeOwner] = useState<{
    id: string;
    entity: string | null;
    userId: string | null;
  } | null>(() => {
    if (isOpen && workRequestId) {
      return {
        id: workRequestId,
        entity: activeEntity,
        userId: user?.id ?? null,
      };
    }
    return null;
  });

  useEffect(() => {
    if (isOpen && workRequestId) {
      setPeekScopeOwner((prev) => {
        if (!prev || prev.id !== workRequestId) {
          return {
            id: workRequestId,
            entity: activeEntity,
            userId: user?.id ?? null,
          };
        }
        return prev;
      });
    } else if (!isOpen) {
      setPeekScopeOwner(null);
    }
  }, [isOpen, workRequestId, activeEntity, user?.id]);

  const isPeekScopeStale = Boolean(
    peekScopeOwner &&
      (peekScopeOwner.entity !== activeEntity ||
        peekScopeOwner.userId !== (user?.id ?? null))
  );

  useEffect(() => {
    if (isPeekScopeStale && isOpen) {
      onClose?.();
    }
  }, [isPeekScopeStale, isOpen, onClose]);

  // Fetch work request detail
  const {
    data: rawWorkRequest,
    isLoading: isLoadingWr,
    isError: isWrError,
    isPlaceholderData: isWrPlaceholder,
    error: wrError,
  } = useWorkRequestDetail(workRequestId || '', {
    enabled: Boolean(isOpen && workRequestId && !isPeekScopeStale),
  });

  // Stable denied scope tracking (Directive 1 & Coordinator Interim Review):
  // Preserve access-lost state even when query cache is invalidated or cleared,
  // until the targeted workRequestId, entity, or user account changes.
  const [deniedScope, setDeniedScope] = useState<{
    id: string;
    entity: string | null;
    userId: string | null;
  } | null>(null);

  const isScopeMatch = Boolean(
    deniedScope &&
    deniedScope.id === workRequestId &&
    deniedScope.entity === activeEntity &&
    deniedScope.userId === (user?.id ?? null)
  );

  const isCurrentWrErrorDenied = Boolean(
    isWrError &&
      ((wrError as { status?: number })?.status === 401 ||
        (wrError as { status?: number })?.status === 403 ||
        (wrError as { status?: number })?.status === 404 ||
        String(wrError?.message || '').includes('401') ||
        String(wrError?.message || '').includes('403') ||
        String(wrError?.message || '').includes('404'))
  );

  const isWrDenied = Boolean(isScopeMatch || isCurrentWrErrorDenied);

  // Suppress confidential child queries when access is denied or scope is stale
  const canFetchChildren = Boolean(isOpen && workRequestId && !isWrDenied && !isPeekScopeStale);

  // Support restored membership on fresh successful authorized read (Directive 2):
  // When genuinely fresh, non-null matching record arrives without error, clear the denied latch.
  useEffect(() => {
    if (rawWorkRequest && rawWorkRequest.id === workRequestId && !isWrError && !isWrPlaceholder && deniedScope) {
      setDeniedScope(null);
    }
  }, [rawWorkRequest, workRequestId, isWrError, isWrPlaceholder, deniedScope]);

  // When access denial is observed, record denied scope and purge confidential data
  useEffect(() => {
    if (isCurrentWrErrorDenied && workRequestId) {
      setDeniedScope({
        id: workRequestId,
        entity: activeEntity,
        userId: user?.id ?? null,
      });

      // Cancel in-flight queries and overwrite WR detail cache with null
      // CRITICAL: Never call queryClient.removeQueries on workRequestDetail(workRequestId),
      // as removing the driving query resets the active observer to an indefinite 'loading' state.
      void queryClient.cancelQueries({ queryKey: operationsKeys.workRequestDetail(workRequestId) });
      queryClient.setQueryData(operationsKeys.workRequestDetail(workRequestId), null);
      queryClient.removeQueries({ queryKey: operationsKeys.tasks(workRequestId), exact: false });
      queryClient.removeQueries({ queryKey: operationsKeys.workRequestRelated(workRequestId), exact: false });
    }
  }, [isCurrentWrErrorDenied, workRequestId, activeEntity, user?.id, queryClient]);

  // If work request was denied, do not hold onto stale/observer data
  const workRequest = isWrDenied ? null : rawWorkRequest;

  const { statusOptimistic, isStatusOptimisticPending: isUpdatingWr } = useWorkRequestMutations();
  const { approveOrRejectTaskCreation } = useTaskMutations(workRequestId || '');
  const [taskToReject, setTaskToReject] = useState<Task | null>(null);
  const [taskToResubmit, setTaskToResubmit] = useState<Task | null>(null);

  // Clear pending review dialogs on WR, entity, or account context switch to prevent stale retargeting
  useEffect(() => {
    setTaskToReject(null);
    setTaskToResubmit(null);
  }, [workRequestId, activeEntity, user?.id, user?.role]);

  const handleApproveTask = async (task: Task) => {
    if (!workRequestId) return;
    if (task.workRequestId && task.workRequestId !== workRequestId) {
      toast.error('Task does not belong to the active work request');
      return;
    }
    try {
      await approveOrRejectTaskCreation({
        workRequestId,
        taskId: task.id,
        decision: 'approve',
        expectedVersion: task.version ?? 1,
      });
      toast.success('Task creation approved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve task creation');
    }
  };

  // Fetch tasks (suppressed when WR is denied)
  const {
    data: tasks = [],
    isLoading: isLoadingTasks,
  } = useWorkRequestTasks(workRequestId || '', {
    enabled: canFetchChildren,
  });

  // Fetch documents (suppressed when WR is denied)
  const { data: rawDocs, isLoading: isLoadingDocs } = useDocuments(
    workRequestId ? { workRequestId } : undefined,
    { enabled: canFetchChildren }
  );

  const documents = useMemo(() => {
    return Array.isArray(rawDocs) ? rawDocs : (Array.isArray(rawDocs?.data) ? rawDocs.data : []);
  }, [rawDocs]);

  // Fetch WR-level related records: 360° Shared Project Team Visibility (Directive 4)
  const {
    data: wrRelatedData,
    isLoading: isLoadingWrRelated,
  } = useWorkRequestRelated(workRequestId || '', {
    enabled: canFetchChildren,
  });

  const relatedInvoices = useMemo(() => wrRelatedData?.invoices || [], [wrRelatedData]);
  const relatedDisbursements = useMemo(() => wrRelatedData?.disbursements || [], [wrRelatedData]);
  const relatedTransmittals = useMemo(() => wrRelatedData?.transmittals || [], [wrRelatedData]);

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
    const resolved = workRequest.coAssignees
      .map((val) => resolveUserName(val))
      .filter(Boolean);
    return Array.from(new Set(resolved));
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
    if (!workRequest || !tasks.length) return { hasBlockers: false, incomplete: [], reviewBlockers: [] };
    const nonDeletedTasks = tasks.filter((t) => {
      const record = t as Task & { deletedAt?: string | null; deleted_at?: string | null };
      return !record.deletedAt && !record.deleted_at;
    });
    const reviewBlockers = nonDeletedTasks.filter((t) => isTaskPendingApproval(t) || isTaskRejected(t));
    const activeTasks = nonDeletedTasks.filter((t) => t.status !== 'Cancelled');
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
      hasBlockers: incomplete.length > 0 || reviewBlockers.length > 0,
      incomplete,
      reviewBlockers,
    };
  }, [workRequest, tasks]);

  // Handle Admin status transition with no strict guard — OPTIMISTIC:
  // the badge flips instantly; a failed write rolls the cache back and the
  // verbatim server error surfaces via toast.
  const handleStatusChange = async (newStatus: WorkRequestStatus) => {
    if (!workRequest || workRequest.status === newStatus) return;
    if (newStatus === 'Completed' && blockerInfo.reviewBlockers.length > 0) {
      toast.error('Manager lead approval is required before completing this work request.');
      return;
    }
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

  if (!isOpen || !workRequestId || isPeekScopeStale) return null;

  if (isWrDenied) {
    return (
      <div
        className="fixed inset-0 z-50 overflow-hidden"
        data-testid="wr-side-peek"
        aria-label="Work Request Side Peek"
        role="region"
      >
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-200"
          onClick={onClose}
          aria-hidden="true"
          data-testid="side-peek-backdrop"
        />

        <div className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10 z-50">
          <div className="w-screen max-w-2xl md:max-w-3xl bg-[#FFFFFF] shadow-2xl border-l border-[#E2E8F0] flex flex-col h-full animate-in slide-in-from-right duration-200 text-[#1E293B]">
            <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#1E293B]">Work Request</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                className="text-[#475569] hover:text-[#1E293B] rounded-[6px]"
                data-testid="side-peek-close-btn"
                aria-label="Close Side Peek"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div
              className="flex-1 overflow-y-auto p-12 flex flex-col items-center justify-center text-center space-y-3"
              data-testid="wr-access-lost"
            >
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-[#475569] mb-1">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-[#1E293B]">Access Not Available</h3>
              <p className="text-xs text-[#475569] max-w-xs leading-relaxed">
                You are not an assigned member of this project team, or access has been revoked.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-xs rounded-[6px] border-[#E2E8F0] mt-2"
                data-testid="access-lost-close-btn"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
        <div className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10 z-50">
          <div className="w-screen max-w-2xl md:max-w-3xl bg-[#FFFFFF] shadow-2xl border-l border-[#E2E8F0] flex flex-col h-full animate-in slide-in-from-right duration-200 text-[#1E293B]">
            {/* Header: Notion-style Breadcrumb & Actions */}
            <div className="px-6 py-4 border-b border-[#E2E8F0] bg-[#F8FAFC] flex items-start justify-between gap-4">
              <div className="space-y-2 flex-1 min-w-0">
                {/* Meta badges & Notion-like status dropdown */}
                <div className="flex flex-wrap items-center gap-2">
                  {workRequest && (
                    <>
                      {(() => {
                        const wrCode = workRequest.workRequestNumber || workRequest.work_request_number;
                        if (!wrCode) return null;
                        return (
                          <span
                            className="font-mono text-xs font-semibold text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 rounded-[6px] tabular-nums"
                            data-testid="side-peek-wr-number"
                          >
                            {wrCode}
                          </span>
                        );
                      })()}
                      <Badge
                        variant={workRequest.entity === 'LTA' ? 'lta' : 'ata'}
                        size="compact"
                        className="font-bold tracking-wider rounded-[6px] text-xs"
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
                        className="font-medium rounded-[6px] text-xs"
                      >
                        {workRequest.priority} Priority
                      </Badge>

                      {/* Phase Indicator */}
                      {(() => {
                        const phaseInfo = getPhaseBadgeInfo(workRequest.phase);
                        const PhaseIcon = phaseInfo.Icon;
                        return (
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-xs font-semibold border ${phaseInfo.badgeClass}`}
                            data-testid="side-peek-phase"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${phaseInfo.dotClass}`} />
                            <PhaseIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>Phase: {workRequest.phase ? workRequest.phase.replace('_', ' ') : phaseInfo.label}</span>
                          </span>
                        );
                      })()}

                      {/* Status: Editable Dropdown for Admin, Readonly Pill for Non-Admin */}
                      {(() => {
                        const statusInfo = getStatusBadgeInfo(workRequest.status);
                        const StatusIcon = statusInfo.Icon;

                        if (isAdmin && workRequest.status !== 'Completed') {
                          return (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
    type="button"
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-semibold border ${statusInfo.badgeClass} cursor-pointer hover:opacity-90 focus:outline-none`}
                                  data-testid="side-peek-status"
                                  data-admin-status-dropdown="true"
                                  title="Change Work Request Status (Admin: Unconstrained)"
                                  disabled={isUpdatingWr}
                                >
                                  <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                                  <span>{statusInfo.label}</span>
                                  <ChevronDown className="w-3.5 h-3.5 ml-0.5 opacity-70" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="start"
                                className="w-64 p-1.5 bg-[#FFFFFF] shadow-float border-[#E2E8F0] rounded-[6px] max-h-96 overflow-y-auto z-50"
                              >
                                <DropdownMenuLabel className="text-xs font-bold tracking-normal text-[#475569] px-2 py-1 flex items-center justify-between">
                                  <span>Set Work Request Status</span>
                                  <span className="text-xs text-[#FFFFFF] bg-[#1D4ED8] px-1.5 py-0.5 rounded-[6px] font-normal">
                                    Admin Free Change
                                  </span>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator className="my-1 bg-[#1D4ED8]" />
                                {WORK_REQUEST_STATUS_OPTIONS.map((statusOption) => {
                                  const optInfo = getStatusBadgeInfo(statusOption);
                                  const OptIcon = optInfo.Icon;
                                  const isCurrent = workRequest.status === statusOption;

                                  return (
                                    <DropdownMenuItem
                                      key={statusOption}
                                      onClick={() => handleStatusChange(statusOption)}
                                      className={`flex items-center justify-between px-2.5 py-2 text-xs rounded-[6px] cursor-pointer  ${
                                        isCurrent
                                          ? 'bg-[#1D4ED8] font-bold text-[#FFFFFF]'
                                          : 'text-[#1E293B] hover:bg-[#F8FAFC]'
                                      }`}
                                      data-testid={`status-option-${statusOption}`}
                                    >
                                      <div className="flex items-center gap-2">
                                        <OptIcon className="w-3.5 h-3.5 shrink-0" />
                                        <span className="truncate">{statusOption}</span>
                                      </div>
                                      {isCurrent && <Check className="w-3.5 h-3.5 text-[#FFFFFF] shrink-0" />}
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
    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-semibold border ${statusInfo.badgeClass}`}
    data-testid="side-peek-status"
                            title="Work request status (Admin only can modify)"
                          >
                            <StatusIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>{statusInfo.label}</span>
                            <Lock className="w-3 h-3 ml-0.5 text-[#475569]" />
                          </span>
                        );
                      })()}
                    </>
                  )}
                </div>

                {/* Big, clean Notion-style Title */}
                <h2
                  className="text-xl font-semibold tracking-tight text-[#1E293B] leading-snug break-words"
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
                    }}
                    className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] gap-1.5"
                    data-testid="side-peek-board-btn"
                    title="Open in Kanban Board"
                  >
                    <Columns className="h-3.5 w-3.5 text-[#1E293B]" />
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
                    className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] gap-1.5"
                    data-testid="side-peek-edit-btn"
                    title="Edit Work Request"
                  >
                    <Edit className="h-3.5 w-3.5 text-[#1E293B]" />
                    Edit
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={onClose}
                  className="text-[#475569] hover:text-[#1E293B] hover:bg-[#F8FAFC] ml-1 rounded-[6px]"
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
                <div className="p-12 text-center text-sm text-[#475569]">
                  <div className="w-8 h-8 border-[#E2E8F0] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                  Loading work request details...
                </div>
              ) : workRequest ? (
                <>
                  {/* Completed Work Request Read-Only Lock Banner */}
                  {workRequest.status === 'Completed' && (
                    <div
                      className="bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B] text-xs px-3.5 py-2.5 rounded-[6px] flex items-center gap-2.5"
                      data-testid="completed-wr-lock-banner"
                    >
                      <Lock className="h-4 w-4 text-[#1E293B] shrink-0" />
                      <span>Completed Work Request: This record is finalized and locked against edits or mutations.</span>
                    </div>
                  )}

                  {/* 1. Gate Blocker Warning */}
                  {blockerInfo.hasBlockers && (
                    <div
                      className="p-4 bg-[#FFFFFF] border-2 border-[#FCA5A5] rounded-[6px] text-xs text-[#DC2626] space-y-1.5"
                      data-testid="side-peek-blocker-alert"
                    >
                      <div className="flex items-center gap-2 font-bold text-sm text-[#DC2626]">
                        <AlertTriangle className="h-4 w-4 text-[#DC2626] shrink-0" />
                        <span>Phase Advancement Blocked</span>
                      </div>
                      <p className="text-xs text-[#DC2626] pl-6 leading-relaxed">
                        {blockerInfo.reviewBlockers.length > 0
                          ? `${blockerInfo.reviewBlockers.length} task(s) require Manager lead approval before phase sign-off or completion.`
                          : `${blockerInfo.incomplete.length} task(s) in phase "${workRequest.phase.replace('_', ' ')}" must be completed before advancing.`}
                      </p>
                    </div>
                  )}

                  {/* 2. Notion-Style Properties Grid */}
                  <div className="bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] p-4 space-y-3">
                    <h3 className="text-xs font-bold tracking-normal text-[#1E293B] mb-1 flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-[#1E293B]" />
                      Properties
                    </h3>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-xs">
                      {/* Client */}
                      <div className="flex items-center justify-between p-2 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]">
                        <span className="text-[#475569] font-medium flex items-center gap-1.5">
                          <Building className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                          Client
                        </span>
                        <div className="flex items-center gap-1.5 truncate max-w-[200px]">
                          <span
                            className="font-bold text-[#1E293B] truncate"
                            data-testid="side-peek-client"
                          >
                            {workRequest.clientName || '—'}
                          </span>
                          {(workRequest.clientNumber || workRequest.client_number) && (
                            <span className="font-mono text-[11px] text-[#64748B] tabular-nums shrink-0">
                              ({workRequest.clientNumber || workRequest.client_number})
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Due Date */}
                      <div className="flex items-center justify-between p-2 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]">
                        <span className="text-[#475569] font-medium flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                          Due Date
                        </span>
                        <span className="font-semibold text-[#1E293B]">
                          {workRequest.dueDate
                            ? new Date(workRequest.dueDate).toLocaleDateString()
                            : 'No due date'}
                        </span>
                      </div>

                      {/* Assigned Lead */}
                      <div className="flex items-center justify-between p-2 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]">
                        <span className="text-[#475569] font-medium flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                          Assigned Lead
                        </span>
                        <span
                          className="font-bold text-[#1E293B] truncate max-w-[160px]"
                          data-testid="side-peek-assignee"
                        >
                          {assignedLeadName}
                        </span>
                      </div>

                      {/* Created Date */}
                      <div className="flex items-center justify-between p-2 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]">
                        <span className="text-[#475569] font-medium flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                          Created Date
                        </span>
                        <span className="font-medium text-[#1E293B]">
                          {workRequest.createdAt
                            ? new Date(workRequest.createdAt).toLocaleDateString()
                            : 'N/A'}
                        </span>
                      </div>

                      {/* Co-Assignees */}
                      {coAssigneeNames.length > 0 && (
                        <div className="sm:col-span-2 p-2.5 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]">
                          <span className="text-xs uppercase font-bold text-[#475569] block mb-1.5 flex items-center gap-1.5">
                            <Users className="h-3.5 w-3.5 text-[#475569]" />
                            Team Members / Co-Assignees
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {coAssigneeNames.map((name, idx) => (
                              <Badge
                                key={`${name}-${idx}`}
                                variant="secondary"
                                size="compact"
                                className="text-xs rounded-[6px] bg-[#F8FAFC] font-medium text-[#1E293B] border-[#E2E8F0]"
                                data-testid="side-peek-co-assignee"
                              >
                                <Users className="h-2.5 w-2.5 mr-1 text-[#475569]" />
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
                    <h4 className="text-xs font-bold tracking-normal text-[#1E293B] flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-[#475569]" />
                      Description & Objectives
                    </h4>
                    <div className="p-4 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B] whitespace-pre-wrap leading-relaxed min-h-[60px]">
                      {workRequest.description || (
                        <span className="text-[#475569] italic">No description provided for this work request.</span>
                      )}
                    </div>
                  </div>

                  {/* 4. Tasks Breakdown with Inspection Affordance */}
                  <div className="space-y-3" data-testid="side-peek-tasks">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold tracking-normal text-[#1E293B] flex items-center gap-2">
                        <CheckSquare className="h-4 w-4 text-[#1E293B]" />
                        <span>Tasks Breakdown ({completedTasksCount}/{tasks.length})</span>
                      </h4>
                      {tasks.length > 0 && (
                        <span className="text-xs font-semibold text-[#1E293B]">
                          {progressPercentage}% Complete
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {tasks.length > 0 && (
                      <div className="w-full bg-[#F8FAFC] rounded-[6px] h-2 overflow-hidden border-[#E2E8F0]">
                        <div
                          className="bg-[#1D4ED8] h-full rounded-[6px] transition-all duration-300"
                          style={{ width: `${progressPercentage}%` }}
                        />
                      </div>
                    )}

                    {isLoadingTasks ? (
                      <div className="p-6 text-center text-xs text-[#475569] bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0]">
                        Loading tasks...
                      </div>
                    ) : tasks.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#475569] bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0] italic">
                        No tasks created for this work request yet.
                      </div>
                    ) : (
                      <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden divide-y divide-[#CBD5E1] bg-[#FFFFFF]">
                        {tasks.map((task) => {
                          const isCompleted = task.status === 'Completed';
                          const isExpanded = expandedTaskIds.has(task.id);
                          const hasChecklist = Array.isArray(task.checklist) && task.checklist.length > 0;
                          const checklistDone = hasChecklist
                            ? task.checklist!.filter((c) => c.completed).length
                            : 0;

                          const PHASES_ORDER = ['pre_processing', 'processing', 'quality_assurance', 'completion'];
                          const currentWrPhaseIndex = PHASES_ORDER.indexOf(workRequest?.phase || 'pre_processing');
                          const taskPhaseIndex = PHASES_ORDER.indexOf(task.phase);
                          const isTaskActivePhase = task.phase === workRequest?.phase;
                          const isTaskPastPhase = taskPhaseIndex < currentWrPhaseIndex;
                          const taskPhaseInfo = getPhaseBadgeInfo(task.phase);
                          const isTaskPending = isTaskPendingApproval(task);
                          const isRejected = isTaskRejected(task);
                          const canLeadReview = canReviewTaskCreation(user, task, workRequest);
                          const canResubmit = canResubmitTask(user, task, workRequest);

                          return (
                            <div
                              key={task.id}
                              className={`group transition-colors ${
                                isRejected
                                  ? 'border-l-4 border-l-[#DC2626] bg-[#FEF2F2]/25 hover:bg-[#FEF2F2]/40'
                                  : isTaskActivePhase
                                    ? 'border-l-4 border-l-[#2563EB] bg-[#EFF6FF]/25 hover:bg-[#EFF6FF]/40'
                                    : 'hover:bg-[#F8FAFC]'
                              }`}
                              data-testid={`side-peek-task-${task.id}`}
                            >
                              <div
                                className="p-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3 text-xs cursor-pointer"
                                onClick={() => setSelectedTask(task)}
                                title="Click to view full task details, log time, and upload documents"
                              >
                                <div className="flex items-start gap-2.5 min-w-0 w-full sm:flex-1">
                                  <TaskTypeBadge
                                    value={
                                      task.requiredLinkType ??
                                      (task as unknown as { required_link_type?: string | null }).required_link_type
                                    }
                                    className="mt-1"
                                    data-testid={`side-peek-task-type-${task.id}`}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span
                                      className={`font-semibold text-sm block truncate ${
                                        isCompleted ? 'line-through text-[#475569]' : 'text-[#1E293B]'
                                      }`}
                                    >
                                      {task.title}
                                    </span>

                                    {isRejected && (
                                      <p
                                        className="text-xs text-[#DC2626] bg-[#FEF2F2] px-2 py-1 rounded-[4px] border border-[#FCA5A5] mt-1"
                                        data-testid={`side-peek-task-rejection-reason-${task.id}`}
                                      >
                                        Reason: {task.rejectionReason ?? (task as { rejection_reason?: string }).rejection_reason ?? 'No reason provided'}
                                      </p>
                                    )}

                                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#475569] pt-1">
                                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] border text-xs font-medium ${taskPhaseInfo.badgeClass}`}>
                                        <span className={`w-1.5 h-1.5 rounded-full ${taskPhaseInfo.dotClass}`} />
                                        <span>{taskPhaseInfo.label}</span>
                                      </span>
                                      {isTaskActivePhase ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#93C5FD]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] animate-pulse" />
                                          <span>Active Phase</span>
                                        </span>
                                      ) : isTaskPastPhase ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                                          <span>Phase Completed</span>
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]">
                                          <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
                                          <span>Upcoming Phase (Locked)</span>
                                        </span>
                                      )}
                                      {(task.assigneeName || task.assigneeId) && (
                                        <>
                                          <span>•</span>
                                          <span className="font-medium text-[#1E293B]">
                                            {task.assigneeName
                                              ? resolveUserName(task.assigneeName)
                                              : resolveUserName(task.assigneeId)}
                                          </span>
                                        </>
                                      )}
                                      {hasChecklist && (
                                        <>
                                          <span>•</span>
                                          <span className="text-[#1E293B] font-medium bg-[#F8FAFC] px-1.5 py-0.5 rounded-[8px] border-[#E2E8F0]">
                                            ✓ {checklistDone}/{task.checklist!.length} subtasks
                                          </span>
                                        </>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 w-full sm:w-auto sm:shrink-0 justify-start sm:justify-end">
                                  {isTaskPending && (
                                    <Badge
                                      variant="outline"
                                      size="compact"
                                      className="text-xs rounded-[6px] bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] flex items-center gap-1"
                                      data-testid={`side-peek-task-approval-${task.id}`}
                                    >
                                      <Clock className="h-3 w-3" />
                                      <span>Pending Review</span>
                                    </Badge>
                                  )}
                                  {isRejected && (
                                    <Badge
                                      variant="destructive"
                                      size="compact"
                                      className="text-xs rounded-[6px] bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5] flex items-center gap-1"
                                      data-testid={`side-peek-task-approval-${task.id}`}
                                    >
                                      <XCircle className="h-3 w-3" />
                                      <span>Rejected</span>
                                    </Badge>
                                  )}
                                  {isTaskPending && canLeadReview && (
                                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                      <Button
                                        type="button"
                                        size="xs"
                                        className="h-6 text-xs font-bold gap-1 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleApproveTask(task);
                                        }}
                                        data-testid={`side-peek-task-approve-${task.id}`}
                                      >
                                        <CheckCircle2 className="h-3 w-3" />
                                        <span>Approve</span>
                                      </Button>
                                      <Button
                                        type="button"
                                        size="xs"
                                        variant="outline"
                                        className="h-6 text-xs font-bold gap-1 rounded-[6px] border-[#DC2626] text-[#DC2626] hover:bg-[#FEF2F2]"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setTaskToReject(task);
                                        }}
                                        data-testid={`side-peek-task-reject-${task.id}`}
                                      >
                                        <XCircle className="h-3 w-3" />
                                        <span>Reject</span>
                                      </Button>
                                    </div>
                                  )}
                                  {isRejected && canResubmit && (
                                    <Button
                                      type="button"
                                      size="xs"
                                      variant="outline"
                                      className="h-6 text-xs font-bold gap-1 rounded-[6px] border-[#1D4ED8] text-[#1D4ED8] hover:bg-[#EFF6FF]"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setTaskToResubmit(task);
                                      }}
                                      data-testid={`side-peek-task-resubmit-${task.id}`}
                                    >
                                      <Pencil className="h-3 w-3" />
                                      <span>Resubmit</span>
                                    </Button>
                                  )}
                                  {task.qaStatus === 'passed' || task.qaStatus === 'failed' ? (
                                    <Badge
                                      variant={task.qaStatus === 'passed' ? 'success' : 'destructive'}
                                      size="compact"
                                      className="text-xs rounded-[6px]"
                                    >
                                      QA: {task.qaStatus}
                                    </Badge>
                                  ) : workRequest?.phase === 'quality_assurance' ? (
                                    <Badge
                                      variant="secondary"
                                      size="compact"
                                      className="text-xs rounded-[6px] bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]"
                                    >
                                      QA: Under Review
                                    </Badge>
                                  ) : null}
                                  <Badge
                                    variant={isCompleted ? 'success' : 'secondary'}
                                    size="compact"
                                    className="text-xs rounded-[6px] font-medium"
                                  >
                                    {task.status}
                                  </Badge>

                                  {/* View Button */}
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="xs"
                                    className="gap-1 text-[#1E293B] hover:bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] text-xs uppercase"
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
                                      className="text-[#475569] hover:text-[#1E293B] rounded-[6px]"
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
                                <div className="px-10 pb-3 space-y-1.5 bg-[#F8FAFC]/60 border-t border-[#E2E8F0]">
                                  <span className="text-xs font-bold tracking-normal text-[#475569] block pt-2">
                                    Subtasks / Checklist:
                                  </span>
                                  {task.checklist!.map((item) => (
                                    <div
                                      key={item.id}
                                      className="flex items-center gap-2 text-xs text-[#1E293B] py-0.5"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={item.completed}
                                        disabled
                                        className="rounded-[8px] border-[#E2E8F0] text-[#1E293B]"
                                      />
                                      <span className={item.completed ? 'line-through text-[#475569]' : 'text-[#1E293B]'}>
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
                      <h4 className="text-xs font-bold tracking-normal text-[#1E293B] flex items-center gap-2">
                        <FileText className="h-4 w-4 text-[#1E293B]" />
                        <span>Attached Documents ({documents.length})</span>
                      </h4>
                      {previewDoc && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="text-[#475569] hover:text-[#1E293B] text-xs rounded-[6px] uppercase"
                          onClick={() => setPreviewDoc(null)}
                        >
                          Hide Preview
                        </Button>
                      )}
                    </div>

                    {isLoadingDocs ? (
                      <div className="p-6 text-center text-xs text-[#475569] bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0]">
                        Loading documents...
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#475569] bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0] italic">
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
                                className={`p-3 bg-[#FFFFFF] border rounded-[6px] text-xs flex flex-col justify-between gap-2.5 transition-all ${
                                  isSelectedForPreview
                                    ? 'border-[#E2E8F0] bg-[#F8FAFC]'
                                    : 'border-[#E2E8F0] hover:bg-[#F8FAFC]/40'
                                }`}
                              >
                                <div className="flex items-start gap-2.5 min-w-0">
                                  <div className="p-2 rounded-[6px] bg-[#F8FAFC] border-[#E2E8F0] shrink-0">
                                    {isPdf ? (
                                      <FileText className="h-4 w-4 text-[#1E293B]" />
                                    ) : isImg ? (
                                      <FileImage className="h-4 w-4 text-[#1E293B]" />
                                    ) : isSpreadsheet ? (
                                      <FileSpreadsheet className="h-4 w-4 text-[#1E293B]" />
                                    ) : (
                                      <FileCode className="h-4 w-4 text-[#1E293B]" />
                                    )}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <span
                                      className="font-semibold text-[#1E293B] block truncate"
                                      title={name}
                                    >
                                      {name}
                                    </span>
                                    <div className="text-xs text-[#475569] pt-0.5 flex items-center gap-1.5">
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
                                <div className="flex items-center justify-between pt-1 border-t border-[#E2E8F0]">
                                  <Button
                                    type="button"
                                    variant={isSelectedForPreview ? 'default' : 'outline'}
                                    size="xs"
                                    className={`gap-1 text-xs  tracking-normal rounded-[6px] ${
                                      isSelectedForPreview
                                        ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs'
                                        : 'border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC]'
                                    }`}
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
                                    className="gap-1 text-xs tracking-normal text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px]"
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

                  {/* 6. Financials & Transmittals (360° Project Records) */}
                  <div className="space-y-3" data-testid="side-peek-project-records">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold tracking-normal text-[#1E293B] flex items-center gap-2">
                        <Receipt className="h-4 w-4 text-[#1E293B]" />
                        <span>Project Financials & Transmittals</span>
                      </h4>
                    </div>

                    {isLoadingWrRelated ? (
                      <div className="p-4 text-center text-xs text-[#475569] bg-[#FFFFFF] rounded-[6px] border-[#E2E8F0]">
                        Loading project records...
                      </div>
                    ) : relatedInvoices.length === 0 && relatedDisbursements.length === 0 && relatedTransmittals.length === 0 ? (
                      <div className="p-4 text-center text-xs text-[#475569] bg-[#FFFFFF] rounded-[6px] border-[#E2E8F0] italic">
                        No linked invoices, disbursements, or transmittals for this work request.
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Invoices Group */}
                        {relatedInvoices.length > 0 && (
                          <div className="space-y-1.5" data-testid="side-peek-invoices-group">
                            <span className="text-xs font-bold tracking-normal text-[#475569] block">
                              Invoices ({relatedInvoices.length})
                            </span>
                            <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden divide-y divide-[#E2E8F0] bg-[#FFFFFF]">
                              {relatedInvoices.map((inv) => {
                                const invTotal = inv.total != null ? inv.total : inv.amount;
                                const invBalance = inv.balance != null ? inv.balance : null;
                                const clientName =
                                  inv.client_name ||
                                  inv.clientName ||
                                  inv.clients?.name ||
                                  rawWorkRequest?.clientName ||
                                  'Client';

                                return (
                                  <a
                                    key={inv.id}
                                    href={`/billing?invoiceId=${inv.id}`}
                                    className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-[#F8FAFC] transition-colors"
                                    data-testid={`side-peek-invoice-${inv.id}`}
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                      <Receipt className="h-4 w-4 text-[#475569] shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        <span className="font-semibold text-xs text-[#1E293B] block truncate">
                                          {inv.invoice_number || inv.invoiceNumber || 'Invoice'}
                                        </span>
                                        <span className="text-xs text-[#475569] block truncate">
                                          {clientName}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {invTotal != null && (
                                        <div className="flex flex-col items-end">
                                          <span className="tabular-nums text-xs font-bold text-[#1E293B]">
                                            ₱{Number(invTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                          </span>
                                          {invBalance != null && Number(invBalance) > 0 ? (
                                            <span className="tabular-nums text-[10px] text-amber-600 font-medium">
                                              Bal: ₱{Number(invBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                            </span>
                                          ) : invBalance === 0 || inv.status === 'Paid' ? (
                                            <span className="tabular-nums text-[10px] text-emerald-600 font-medium">
                                              Paid in full
                                            </span>
                                          ) : null}
                                        </div>
                                      )}
                                      {inv.status && (
                                        <Badge
                                          variant={inv.status === 'Paid' ? 'success' : inv.status === 'Draft' ? 'secondary' : 'outline'}
                                          size="compact"
                                          className="text-xs rounded-[6px]"
                                        >
                                          {inv.status}
                                        </Badge>
                                      )}
                                      <ExternalLink className="h-3 w-3 text-[#475569]" />
                                    </div>
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Disbursements Group */}
                        {relatedDisbursements.length > 0 && (
                          <div className="space-y-1.5" data-testid="side-peek-disbursements-group">
                            <span className="text-xs font-bold tracking-normal text-[#475569] block">
                              Disbursements ({relatedDisbursements.length})
                            </span>
                            <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden divide-y divide-[#E2E8F0] bg-[#FFFFFF]">
                              {relatedDisbursements.map((d) => {
                                const disbNo = d.disbursement_number || d.disbursementNumber;
                                return (
                                  <a
                                    key={d.id}
                                    href={`/disbursements?disbursementId=${d.id}`}
                                    className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-[#F8FAFC] transition-colors"
                                    data-testid={`side-peek-disbursement-${d.id}`}
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                      <CreditCard className="h-4 w-4 text-[#475569] shrink-0" />
                                      <div className="min-w-0 flex-1">
                                        {disbNo && (
                                          <span className="font-mono text-xs font-medium text-[#475569] tabular-nums block truncate">
                                            {disbNo}
                                          </span>
                                        )}
                                        <span className="font-semibold text-xs text-[#1E293B] block truncate">
                                          {d.category || 'Disbursement'}
                                        </span>
                                        <span className="text-xs text-[#475569] block truncate">
                                          {d.description || 'No description'}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {d.amount != null && (
                                        <span className="tabular-nums text-xs font-bold text-[#1E293B]">
                                          ₱{Number(d.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                        </span>
                                      )}
                                      {d.status && (
                                        <Badge variant={d.status === 'Released' ? 'success' : 'outline'} size="compact" className="text-xs rounded-[6px]">
                                          {d.status}
                                        </Badge>
                                      )}
                                      <ExternalLink className="h-3 w-3 text-[#475569]" />
                                    </div>
                                  </a>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Transmittals Group */}
                        {relatedTransmittals.length > 0 && (
                          <div className="space-y-1.5" data-testid="side-peek-transmittals-group">
                            <span className="text-xs font-bold tracking-normal text-[#475569] block">
                              Transmittals ({relatedTransmittals.length})
                            </span>
                            <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden divide-y divide-[#E2E8F0] bg-[#FFFFFF]">
                              {relatedTransmittals.map((t) => (
                                <a
                                  key={t.id}
                                  href={`/transmittals?transmittalId=${t.id}`}
                                  className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-[#F8FAFC] transition-colors"
                                  data-testid={`side-peek-transmittal-${t.id}`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <Send className="h-4 w-4 text-[#475569] shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <span className="font-semibold text-xs text-[#1E293B] block truncate">
                                        {t.tracking_number || t.trackingNumber || 'Transmittal'}
                                      </span>
                                      <span className="text-xs text-[#475569] block truncate">
                                        {t.recipient_name || t.recipientName || 'Recipient'}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    {t.status && (
                                      <Badge variant={t.status === 'Acknowledged' ? 'success' : 'outline'} size="compact" className="text-xs rounded-[6px]">
                                        {t.status}
                                      </Badge>
                                    )}
                                    <ExternalLink className="h-3 w-3 text-[#475569]" />
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="p-12 text-center text-sm text-[#475569]">
                  Work request not found.
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-3.5 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
              <span className="text-xs text-[#475569]">
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
                    }}
                    className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] gap-1.5"
                  >
                    <Columns className="h-3.5 w-3.5 text-[#1E293B]" />
                    View in Board
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  onClick={onClose}
                  className="rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs text-xs tracking-normal px-4"
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

      {/* Task Creation Reject Modal */}
      {taskToReject && (
        <RejectReasonModal
          isOpen={Boolean(taskToReject)}
          requestId={taskToReject.id}
          workRequestTitle={workRequest?.title}
          title="Reject Task Creation"
          description="Provide a required explanation for why this task creation is being rejected."
          submitLabel="Reject Task"
          successTitle="Task Rejected"
          successMessage="The task creation has been rejected."
          onClose={() => setTaskToReject(null)}
          onReject={async (taskId, reason) => {
            if (!workRequestId) return;
            if (taskToReject.workRequestId && taskToReject.workRequestId !== workRequestId) {
              throw new Error('Task does not belong to the active work request');
            }
            await approveOrRejectTaskCreation({
              workRequestId,
              taskId,
              decision: 'reject',
              reason,
              expectedVersion: taskToReject.version ?? 1,
            });
          }}
          invalidateQueries={[
            operationsKeys.tasks(workRequestId || ''),
            operationsKeys.workRequestDetail(workRequestId || ''),
          ]}
        />
      )}

      {/* Task Resubmit Modal */}
      {taskToResubmit && (
        <TaskResubmitModal
          isOpen={Boolean(taskToResubmit)}
          task={taskToResubmit}
          workRequest={workRequest}
          onClose={() => setTaskToResubmit(null)}
        />
      )}
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
  const effectiveExternalUrl =
    (document.external_url && document.external_url.trim()) ||
    (document.externalUrl && document.externalUrl.trim()) ||
    null;
  const rawUrl = effectiveExternalUrl || downloadData?.url || null;
  const parsedExternal = parseExternalUrl(rawUrl || '', name);
  const previewUrl = parsedExternal.isGoogleDrive ? parsedExternal.previewUrl : rawUrl;
  const isExternal = Boolean(
    effectiveExternalUrl ||
    parsedExternal.isGoogleDrive
  );
  const downloadUrl = isExternal ? null : rawUrl;

  const contentType = document.contentType || document.content_type || '';
  const isPdf = name.toLowerCase().endsWith('.pdf') || contentType.includes('pdf');
  const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(name) || contentType.startsWith('image/');
  const isText = /\.(txt|json|csv|md|log)$/i.test(name) || contentType.includes('text');

  return (
    <div className="border-[#E2E8F0] bg-[#F8FAFC] rounded-[6px] p-3.5 space-y-2.5 shadow-none">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-4 w-4 text-[#1E293B] shrink-0" />
          <span className="font-bold text-xs text-[#1E293B] truncate" title={name}>
            Previewing: {name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isExternal ? (
            <a
              href={effectiveExternalUrl || parsedExternal.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="xs" variant="outline" className="gap-1 text-xs tracking-normal h-7 text-[#1E293B] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] rounded-[6px]">
                <ExternalLink className="h-3 w-3" />
                {parsedExternal.isGoogleDrive ? 'Open in Drive' : 'Open Link'}
              </Button>
            </a>
          ) : downloadUrl ? (
            <a href={downloadUrl} download={name} target="_blank" rel="noreferrer">
              <Button size="xs" variant="outline" className="gap-1 text-xs tracking-normal h-7 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC]">
                <Download className="h-3 w-3" /> Download
              </Button>
            </a>
          ) : null}
          <Button
            size="xs"
            variant="outline"
            className="gap-1 text-xs tracking-normal h-7 text-[#1E293B] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] rounded-[6px]"
            onClick={onOpenFullViewer}
          >
            <ExternalLink className="h-3 w-3" /> Full View
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            className="text-[#475569] hover:text-[#1E293B] hover:bg-[#F8FAFC] h-7 w-7 rounded-[6px]"
            title="Close Preview"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Panel Body */}
      <div className="bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0] overflow-hidden min-h-[220px]">
        {isLoading && !document.external_url && !document.externalUrl ? (
          <div className="p-10 text-center text-xs text-[#475569] space-y-2">
            <div className="w-6 h-6 border-[#E2E8F0] border-t-transparent rounded-full animate-spin mx-auto" />
            <p>Loading document preview...</p>
          </div>
        ) : !previewUrl ? (
          <div className="p-8 text-center text-xs text-[#475569]">
            Preview is unavailable for this document.
          </div>
        ) : parsedExternal.isGoogleDrive && previewUrl ? (
          <div className="w-full flex flex-col">
            <div className="bg-[#F8FAFC] border-b border-[#E2E8F0] px-3 py-1.5 flex items-center justify-between text-xs text-[#1E293B]">
              <span>Google Drive Preview</span>
              <a
                href={parsedExternal.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline hover:text-[#1D4ED8] flex items-center gap-1"
              >
                Open Original <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <iframe
              src={previewUrl}
              className="w-full h-80 sm:h-96 border-0"
              title={`Preview - ${name}`}
              allow="autoplay"
              data-testid="inline-doc-preview-gdrive"
            />
          </div>
        ) : isExternal ? (
          <div className="p-8 text-center space-y-3">
            <ExternalLink className="h-10 w-10 text-[#1E293B] mx-auto" />
            <div className="space-y-1">
              <h5 className="font-semibold text-[#1E293B] text-xs">{name}</h5>
              <p className="text-xs text-[#475569] max-w-xs mx-auto">
                This external link cannot be embedded inline. You can open the link directly in a new tab.
              </p>
            </div>
            <a
              href={effectiveExternalUrl || parsedExternal.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button size="sm" className="gap-1.5 text-xs text-[#FFFFFF] bg-[#1D4ED8] hover:bg-[#1E40AF] rounded-[6px] tracking-normal">
                <ExternalLink className="h-3.5 w-3.5" /> Open External Link
              </Button>
            </a>
          </div>
        ) : isPdf ? (
          <iframe
            src={previewUrl}
            className="w-full h-80 sm:h-96 border-0"
            title={`Preview - ${name}`}
            data-testid="inline-doc-preview-frame"
          />
        ) : isImg ? (
          <div className="w-full h-72 sm:h-80 flex items-center justify-center p-3 bg-[#F8FAFC]/40">
            <img
              src={previewUrl}
              alt={name}
              className="max-h-full max-w-full object-contain rounded-[8px] shadow-card"
              data-testid="inline-doc-preview-image"
            />
          </div>
        ) : isText ? (
          <iframe
            src={previewUrl}
            className="w-full h-72 border-0 text-xs p-3 bg-[#FFFFFF]"
            title={`Preview - ${name}`}
            data-testid="inline-doc-preview-frame"
          />
        ) : (
          <div className="p-8 text-center space-y-3">
            <FileText className="h-10 w-10 text-[#1E293B] mx-auto" />
            <div className="space-y-1">
              <h5 className="font-semibold text-[#1E293B] text-xs">{name}</h5>
              <p className="text-xs text-[#475569]">
                This document type cannot be embedded inline. You can download or open it in the full viewer.
              </p>
            </div>
            {downloadUrl ? (
              <a href={downloadUrl} download={name} target="_blank" rel="noreferrer">
                <Button size="sm" className="gap-1.5 text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC]">
                  <Download className="h-3.5 w-3.5" /> Download File
                </Button>
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
