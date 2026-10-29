import React, { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Send,
  ArrowRight,
  User,
  Calendar,
  Layers,
  CheckSquare,
  Edit3,
  Plus,
  MoreVertical,
  Trash2,
  PanelRightOpen,
  Clock,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
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
} from '@/components/ui/dropdown-menu';
import { PresenceAvatars } from '@/components/common/PresenceAvatars';
import {
  useWorkRequests,
  useWorkRequestDetail,
} from '../api/useWorkRequests';
import { useWorkRequestTasks, useTaskMutations } from '../api/useTasks';
import { usePhaseTransitions } from '../api/usePhaseTransitions';
import { useQaReview } from '../api/useQaReview';
import { runBlockingAction } from './BlockingActionModal';
import { RerouteModal } from './RerouteModal';
import { WorkRequestModal } from './WorkRequestModal';
import { TaskDetailModal } from './TaskDetailModal';
import { WorkRequestSidePeek } from './WorkRequestSidePeek';
import { QuickAddCard } from './QuickAddCard';
import { RejectReasonModal } from './RejectReasonModal';
import { TaskResubmitModal } from './TaskResubmitModal';
import { TaskTypeBadge } from '../lib/taskTypes';
import { operationsKeys } from '../api/queryKeys';
import { getPhaseBadgeInfo, getStatusBadgeInfo } from '../lib/statusBadges';
import { useSearchParams, useInRouterContext } from 'react-router-dom';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { getTaskDeletionReason } from '../lib/taskDeletion';
import {
  isUserAdmin,
  canReviewTaskCreation,
  canEmployeeCreateTask,
  isTaskRejected,
  isTaskPendingApproval,
  canResubmitTask,
} from '../lib/taskScope';
import type {
  Phase,
  Task,
  WorkRequest,
  AdvancePhaseTarget,
} from '../api/types';

const PHASES: Array<{ id: Phase; label: string; number: number }> = [
  { id: 'pre_processing', label: 'Pre-processing', number: 1 },
  { id: 'processing', label: 'Processing', number: 2 },
  { id: 'quality_assurance', label: 'Quality Assurance', number: 3 },
  { id: 'completion', label: 'Completion', number: 4 },
];

export interface PhaseKanbanBoardProps {
  initialWorkRequestId?: string;
  onEditWorkRequest?: (wr: WorkRequest) => void;
  onBackToSidePeek?: (wrId: string) => void;
}

interface PhaseKanbanBoardInnerProps extends PhaseKanbanBoardProps {
  searchParams: URLSearchParams;
  setSearchParams: (setter: (prev: URLSearchParams) => URLSearchParams) => void;
}

function PhaseKanbanBoardInner({
  initialWorkRequestId,
  onEditWorkRequest,
  onBackToSidePeek,
  searchParams,
  setSearchParams,
}: PhaseKanbanBoardInnerProps) {
  // Session & RBAC
  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = isUserAdmin(currentUser);
  const canAdvance = hasPermission(permissions, 'workflow:phase_transition');
  const canRequestTransition =
    hasPermission(permissions, 'workflow:transition_request') ||
    hasPermission(permissions, 'workflow:edit');
  const canQaReview = hasPermission(permissions, 'workflow:qa_review');
  const canEdit = hasPermission(permissions, 'workflow:edit');

  // Work Request Selection
  const { data: rawRequests, isLoading: isLoadingWrs } = useWorkRequests({
    archived: false,
  });
  const workRequests: WorkRequest[] = useMemo(() => {
    const list = Array.isArray(rawRequests) ? rawRequests : rawRequests?.data ?? [];
    return list.filter(
      (wr) =>
        wr.creationApprovalStatus !== 'pending' &&
        wr.creationApprovalStatus !== 'rejected'
    );
  }, [rawRequests]);

  const [selectedWrId, setSelectedWrId] = useState<string>(() => {
    return searchParams.get('wrId') || initialWorkRequestId || '';
  });

  const urlWrId = searchParams.get('wrId');
  React.useEffect(() => {
    if (urlWrId && urlWrId !== selectedWrId && workRequests.some((w) => w.id === urlWrId)) {
      setSelectedWrId(urlWrId);
    }
  }, [urlWrId, selectedWrId, workRequests]);

  // Keep selected ID in sync if empty or invalid for active entity (e.g. after entity switch)
  React.useEffect(() => {
    if (workRequests.length > 0) {
      const exists = workRequests.some((w) => w.id === selectedWrId);
      if (!selectedWrId || !exists) {
        const fallbackId = workRequests[0]?.id || '';
        if (fallbackId) {
          setSelectedWrId(fallbackId);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set('wrId', fallbackId);
            return next;
          });
        }
      }
    }
  }, [selectedWrId, workRequests, setSearchParams]);

  const handleSelectWr = (id: string) => {
    setSelectedWrId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('wrId', id);
      return next;
    });
  };

  const effectiveWrId = selectedWrId || (workRequests[0]?.id ?? '');

  // Active Work Request Details & Tasks
  const { data: currentWr } = useWorkRequestDetail(effectiveWrId);
  const activeWr = currentWr || workRequests.find((w) => w.id === effectiveWrId);
  const activeWrCode = activeWr
    ? activeWr.workRequestNumber || activeWr.work_request_number
    : undefined;
  const activeWrFullLabel = activeWr
    ? `${activeWrCode ? `${activeWrCode} · ` : ''}${activeWr.title} (${activeWr.entity})`
    : undefined;
  const { data: tasks = [] } = useWorkRequestTasks(effectiveWrId, {
    enabled: Boolean(effectiveWrId),
  });

  // Mutations
  const { advancePhase, requestTransition } = usePhaseTransitions(effectiveWrId);
  const { submitQaReview } = useQaReview(effectiveWrId);
  const {
    createTask,
    deleteTask,
    approveOrRejectTaskCreation,
  } = useTaskMutations(effectiveWrId);

  const canEmployeeCreate = canEmployeeCreateTask(currentUser, activeWr);
  const isEmployeeMissingLead = Boolean(
    currentUser?.role !== 'Admin' &&
      currentUser?.role !== 'Manager' &&
      !canEmployeeCreate
  );
  const canAddTask =
    canEmployeeCreate &&
    (hasPermission(permissions, 'workflow:task_add') ||
      hasPermission(permissions, 'workflow:edit'));

  const [taskToReject, setTaskToReject] = useState<Task | null>(null);
  const [taskToResubmit, setTaskToResubmit] = useState<Task | null>(null);

  // Clear pending dialogs on WR, entity, or user account change to prevent cross-WR / stale decisions
  React.useEffect(() => {
    setTaskToReject(null);
    setTaskToResubmit(null);
    setTaskToDelete(null);
  }, [effectiveWrId, activeEntity, currentUser?.id, currentUser?.role]);

  const handleApproveTask = async (task: Task) => {
    if (!activeWr) return;
    if (task.workRequestId && task.workRequestId !== activeWr.id) {
      toast.error('Task does not belong to the active work request');
      return;
    }
    await runBlockingAction({
      title: 'Approving Task Creation',
      message: 'Please wait while the task creation is approved...',
      apiCall: async () => {
        return await approveOrRejectTaskCreation({
          workRequestId: activeWr.id,
          taskId: task.id,
          decision: 'approve',
          expectedVersion: task.version ?? 1,
        });
      },
      successTitle: 'Task Approved',
      successMessage: 'Task creation has been approved successfully.',
      invalidateQueries: [
        operationsKeys.tasks(effectiveWrId),
        operationsKeys.taskDetail(effectiveWrId, task.id),
        operationsKeys.workRequestDetail(effectiveWrId),
        operationsKeys.workRequestCounts(activeEntity),
      ],
    });
  };

  const [taskToDelete, setTaskToDelete] = useState<{
    id: string;
    title: string;
    assigneeName?: string | null;
  } | null>(null);
  const [isDeletingTask, setIsDeletingTask] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isSidePeekOpen, setIsSidePeekOpen] = useState(false);

  const handleConfirmDeleteTask = async () => {
    if (!taskToDelete) return;
    const latestTask = tasks.find((task) => task.id === taskToDelete.id);
    const reason = latestTask ? getTaskDeletionReason(latestTask, currentWr) : null;
    if (reason) {
      setDeleteError(reason);
      return;
    }
    setDeleteError(null);
    setIsDeletingTask(true);
    try {
      await deleteTask(taskToDelete.id);
      if (selectedTask?.id === taskToDelete.id) {
        setSelectedTask(null);
      }
      setTaskToDelete(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete task. Please try again.');
    } finally {
      setIsDeletingTask(false);
    }
  };

  // Quick-Add Task State (UAT2-10)
  const [quickAddPhase, setQuickAddPhase] = useState<Phase | null>(null);
  // Dismiss drafts when the board context changes; each card owns its input state.
  useEffect(() => {
    setQuickAddPhase(null);
  }, [effectiveWrId, activeEntity, canAddTask, currentWr?.status]);

  // Modal States
  const [isRerouteOpen, setIsRerouteOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Task Detail Modal State (UAT-OPS4)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Keep selectedTask synchronized with live TanStack Query cache
  useEffect(() => {
    if (selectedTask?.id && tasks.length > 0) {
      const latest = tasks.find((t) => t.id === selectedTask.id);
      if (!latest) {
        // If task was purged from tasks list while belonging to this WR, deselect
        if (selectedTask.workRequestId === effectiveWrId) {
          setSelectedTask(null);
        }
        return;
      }

      const recLatest = (latest as unknown as Record<string, unknown>) || {};
      const recSelected = (selectedTask as unknown as Record<string, unknown>) || {};

      // If task was soft-deleted, deselect immediately
      if (recLatest.deletedAt || recLatest.deleted_at) {
        setSelectedTask(null);
        return;
      }

      // Synchronize if version, status, QA status, or attributes have mutated
      if (
        latest.version !== selectedTask.version ||
        latest.qaStatus !== selectedTask.qaStatus ||
        latest.status !== selectedTask.status ||
        recLatest.qa_status !== recSelected.qa_status ||
        latest.assigneeId !== selectedTask.assigneeId ||
        latest.assigneeName !== selectedTask.assigneeName ||
        latest.title !== selectedTask.title ||
        latest.description !== selectedTask.description ||
        latest.dueDate !== selectedTask.dueDate ||
        latest.phase !== selectedTask.phase
      ) {
        setSelectedTask(latest);
      }
    }
  }, [tasks, selectedTask, effectiveWrId]);

  // Support deep link ?taskId=xxx with soft-delete exclusion
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const taskIdParam = urlParams.get('taskId');
        if (taskIdParam && tasks.length > 0) {
          const found = tasks.find((t) => {
            const rec = (t as unknown as Record<string, unknown>) || {};
            return t.id === taskIdParam && !rec.deletedAt && !rec.deleted_at;
          });
          if (found) {
            setSelectedTask(found);
          }
        }
      }
    } catch {
      // ignore
    }
  }, [tasks]);

  const currentPhase: Phase = (activeWr?.phase as Phase) || 'pre_processing';

  // Task Gate & Blocker Logic
  const gateInfo = useMemo(() => {
    const nonDeletedTasks = tasks.filter((t) => {
      const rec = (t as unknown as Record<string, unknown>) || {};
      return !rec.deletedAt && !rec.deleted_at;
    });
    const reviewBlockers = nonDeletedTasks.filter((t) => isTaskPendingApproval(t) || isTaskRejected(t));
    const activeTasks = nonDeletedTasks.filter((t) => t.status !== 'Cancelled');
    const preTasks = activeTasks.filter((t) => t.phase === 'pre_processing');
    const procTasks = activeTasks.filter((t) => t.phase === 'processing');

    const preIncomplete = preTasks.filter((t) => t.status !== 'Completed');
    const procIncomplete = procTasks.filter((t) => t.status !== 'Completed');
    const qaIncomplete = activeTasks.filter((t) => {
      const rec = (t as unknown as Record<string, unknown>) || {};
      return t.status !== 'Completed' || (t.qaStatus !== 'passed' && rec.qa_status !== 'passed');
    });
    // Rerouting reopens every non-deleted QA failure, including cancelled tasks.
    const qaFailed = nonDeletedTasks.filter((t) => {
      const rec = (t as unknown as Record<string, unknown>) || {};
      return t.qaStatus === 'failed' || rec.qa_status === 'failed';
    });

    return {
      reviewBlockers,
      pre: {
        total: preTasks.length,
        completed: preTasks.filter((t) => t.status === 'Completed').length,
        incomplete: preIncomplete,
        canAdvance: preTasks.length > 0 && preIncomplete.length === 0 && reviewBlockers.length === 0,
      },
      proc: {
        total: procTasks.length,
        completed: procTasks.filter((t) => t.status === 'Completed').length,
        incomplete: procIncomplete,
        canAdvance: procTasks.length > 0 && procIncomplete.length === 0 && reviewBlockers.length === 0,
      },
      qa: {
        total: activeTasks.length,
        completed: activeTasks.filter(
          (t) => t.status === 'Completed' && t.qaStatus === 'passed'
        ).length,
        incomplete: qaIncomplete,
        failed: qaFailed,
        canAdvance: activeTasks.length > 0 && qaIncomplete.length === 0 && reviewBlockers.length === 0,
      },
    };
  }, [tasks]);

  // Handle Advance Phase
  const handleAdvance = async (targetPhase: AdvancePhaseTarget) => {
    if (!effectiveWrId) return;

    await runBlockingAction({
      title: 'Advancing Lifecycle Phase',
      message: `Advancing work request to ${targetPhase.replace('_', ' ')}...`,
      apiCall: async () => {
        return await advancePhase({
          workRequestId: effectiveWrId,
          to_phase: targetPhase,
        });
      },
      successTitle: 'Phase Advanced',
      successMessage: `Successfully advanced to ${targetPhase.replace('_', ' ')}.`,
      invalidateQueries: [
        operationsKeys.workRequestDetail(effectiveWrId),
        operationsKeys.tasks(effectiveWrId),
        operationsKeys.workRequests(),
      ],
    });
  };

  // Handle Manager Transition Request
  const handleRequestTransition = async (from: Phase, to: Phase) => {
    if (!effectiveWrId) return;

    await runBlockingAction({
      title: 'Submitting Transition Request',
      message: `Requesting advancement from ${from.replace('_', ' ')} to ${to.replace('_', ' ')}...`,
      apiCall: async () => {
        return await requestTransition({
          workRequestId: effectiveWrId,
          from_phase: from,
          to_phase: to,
          notes: 'Prerequisites met. Ready for administrative review.',
        });
      },
      successTitle: 'Transition Requested',
      successMessage: 'Admin has been notified for phase advancement review.',
      invalidateQueries: [
        operationsKeys.requests(),
        operationsKeys.requestCounts(activeEntity),
      ],
    });
  };

  // Handle QA Pass / Fail
  const handleQaReview = async (taskId: string, verdict: 'passed' | 'failed') => {
    if (!effectiveWrId) return;

    await runBlockingAction({
      title: verdict === 'passed' ? 'Approving QA Task' : 'Rejecting QA Task',
      message: `Setting compliance status to ${verdict}...`,
      apiCall: async () => {
        return await submitQaReview({
          workRequestId: effectiveWrId,
          results: [
            {
              task_id: taskId,
              qa_status: verdict,
              taskId,
              qaStatus: verdict,
            },
          ],
        });
      },
      successTitle: 'QA Review Recorded',
      successMessage: `Task marked as ${verdict}.`,
      invalidateQueries: [
        operationsKeys.tasks(effectiveWrId),
        operationsKeys.workRequestDetail(effectiveWrId),
      ],
    });
  };

  if (isLoadingWrs) {
    return (
      <div className="p-12 text-center text-xs tracking-normal text-[#475569] bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]">
        Loading operations kanban board...
      </div>
    );
  }

  if (workRequests.length === 0) {
    return (
      <div
        className="p-12 text-center bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] space-y-3"
        data-testid="kanban-empty-state"
      >
        <div className="p-3 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] text-[#1E293B] w-fit mx-auto">
          <Layers className="h-8 w-8" />
        </div>
        <h4 className="text-sm font-bold text-[#1E293B] tracking-normal">
          No active work requests found
        </h4>
        <p className="text-xs text-[#475569]">
          Create a new work request to view and govern its 4-phase lifecycle kanban board.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="phase-kanban-board">
      {/* 1. Header Toolbar & Work Request Selector */}
      <div
        className="p-4 bg-[#FFFFFF] border-[#E2E8F0] rounded-[8px] shadow-card flex flex-nowrap items-end justify-between gap-3 overflow-x-auto"
        data-testid="kanban-header-toolbar"
      >
        <div className="flex flex-nowrap items-end gap-2.5 flex-1">
          <div
            className="w-64 xl:w-72 min-w-[170px] shrink"
            data-testid="kanban-wr-select-wrapper"
          >
            <label className="text-xs tracking-normal font-bold text-[#1E293B] block mb-1 whitespace-nowrap">
              Select Work Request
            </label>
            <Select value={effectiveWrId} onValueChange={handleSelectWr}>
              <SelectTrigger
                className="h-9 text-xs rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B]"
                data-testid="kanban-wr-select"
                title={activeWrFullLabel}
              >
                <SelectValue placeholder="Choose a work request" />
              </SelectTrigger>
              <SelectContent className="max-w-[min(36rem,calc(100vw-2rem))] rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                {workRequests.map((wr) => {
                  const wrCode = wr.workRequestNumber || wr.work_request_number;
                  return (
                    <SelectItem key={wr.id} value={wr.id} className="text-xs">
                      {wrCode ? `${wrCode} · ` : ''}{wr.title} ({wr.entity})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {activeWr && (
            <div
              className="flex flex-nowrap items-center gap-1.5 h-9 shrink-0"
              data-testid="kanban-wr-badges"
            >
              {activeWrCode && (
                <span
                  className="font-mono text-xs font-semibold text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 rounded-[6px] tabular-nums whitespace-nowrap shrink-0"
                  data-testid="kanban-wr-number"
                >
                  {activeWrCode}
                </span>
              )}
              <Badge
                variant={activeWr.entity === 'LTA' ? 'lta' : 'ata'}
                size="compact"
                className="whitespace-nowrap shrink-0"
              >
                {activeWr.entity}
              </Badge>
              {activeWr.priority && (
                <Badge
                  variant={
                    activeWr.priority === 'Urgent'
                      ? 'destructive'
                      : activeWr.priority === 'High'
                        ? 'warning'
                        : 'secondary'
                  }
                  size="compact"
                  className="whitespace-nowrap shrink-0"
                >
                  {activeWr.priority.endsWith('Priority') ? activeWr.priority : `${activeWr.priority} Priority`}
                </Badge>
              )}
              {(() => {
                const phaseInfo = getPhaseBadgeInfo(activeWr.phase);
                const statusInfo = getStatusBadgeInfo(activeWr.status);
                const PhaseIcon = phaseInfo.Icon;
                const StatusIcon = statusInfo.Icon;
                return (
                  <>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] border text-xs font-semibold whitespace-nowrap shrink-0 ${phaseInfo.badgeClass}`}
                      title={`Phase: ${phaseInfo.label}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${phaseInfo.dotClass}`} />
                      <PhaseIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>Phase: {phaseInfo.label}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] border text-xs font-semibold whitespace-nowrap shrink-0 ${statusInfo.badgeClass}`}
                      title={`Status: ${statusInfo.label}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusInfo.dotClass}`} />
                      <StatusIcon className="w-3 h-3 shrink-0" />
                      <span>{statusInfo.label}</span>
                    </span>
                    {activeWr.dueDate && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] tabular-nums text-xs font-bold bg-[#F8FAFC] text-[#1E293B] border border-[#E2E8F0] whitespace-nowrap shrink-0">
                        <Calendar className="w-3 h-3 text-[#475569] shrink-0" />
                        <span>Due: {new Date(activeWr.dueDate).toLocaleDateString()}</span>
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        <div className="flex flex-nowrap items-center gap-2 h-9 shrink-0" data-testid="kanban-header-actions">
          {effectiveWrId && <PresenceAvatars roomId={effectiveWrId} />}
          {activeWr && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (onBackToSidePeek) {
                  onBackToSidePeek(activeWr.id);
                }
                setIsSidePeekOpen(true);
              }}
              className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              data-testid="kanban-back-sidepeek-btn"
              title="Go back to Work Request Side Peek"
            >
              <PanelRightOpen className="h-3.5 w-3.5 text-[#475569]" />
              Work Request Details
            </Button>
          )}
          {activeWr && canEdit && activeWr.status !== 'Completed' && activeWr.phase !== 'completion' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (onEditWorkRequest) onEditWorkRequest(activeWr);
                else setIsEditModalOpen(true);
              }}
              className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B] gap-1.5 cursor-pointer shadow-2xs whitespace-nowrap shrink-0"
              data-testid="kanban-edit-wr-btn"
            >
              <Edit3 className="h-3.5 w-3.5 text-[#475569]" />
              Edit Work Request
            </Button>
          )}
        </div>
      </div>

      {gateInfo.reviewBlockers.length > 0 && (
        <div role="status" className="rounded-[6px] border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]" data-testid="task-review-signoff-blocker">
          {gateInfo.reviewBlockers.length} task(s) require Manager lead approval before phase sign-off or completion.
        </div>
      )}

      {/* 4-Phase Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="kanban-phase-grid">
        {PHASES.map((col) => {
          const isCurrentPhase = currentPhase === col.id;
          const currentPhaseIndex = PHASES.findIndex((p) => p.id === currentPhase);
          const colIndex = PHASES.findIndex((p) => p.id === col.id);
          const isPastPhase = colIndex < currentPhaseIndex;
          const isUpcomingPhase = colIndex > currentPhaseIndex;

          // Filter tasks belonging to this phase zone
          const phaseTasks = tasks.filter((t) => {
            const rec = (t as unknown as Record<string, unknown>) || {};
            if (t.status === 'Cancelled' || rec.deletedAt || rec.deleted_at) {
              return false;
            }
            if (col.id === 'pre_processing') return t.phase === 'pre_processing';
            if (col.id === 'processing') return t.phase === 'processing';
            if (col.id === 'quality_assurance') {
              // During QA, active tasks participate in QA review
              return currentPhase === 'quality_assurance';
            }
            if (col.id === 'completion') {
              // During completion, show completed tasks
              return currentPhase === 'completion' && t.status === 'Completed';
            }
            return false;
          });

          // Compute gate completion count
          const completedCount = phaseTasks.filter((t) => t.status === 'Completed').length;
          const totalCount = phaseTasks.length;

          // Gate Prerequisite Incomplete Items
          let incompleteGateTasks: Task[] = [];
          if (col.id === 'pre_processing') incompleteGateTasks = gateInfo.pre.incomplete;
          if (col.id === 'processing') incompleteGateTasks = gateInfo.proc.incomplete;
          if (col.id === 'quality_assurance') incompleteGateTasks = gateInfo.qa.incomplete;

          const hasGateBlockers = incompleteGateTasks.length > 0;
          const blockerTooltip = hasGateBlockers
            ? `Prerequisite gate not met: ${incompleteGateTasks.length} task(s) remaining (${incompleteGateTasks.map((t) => t.title).join(', ')})`
            : undefined;

          return (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'none';
              }}
              onDrop={(e) => {
                e.preventDefault();
              }}
              className={`flex flex-col rounded-[6px] p-3 min-h-[560px] space-y-3 transition-none ${
                isCurrentPhase
                  ? 'bg-[#EFF6FF]/75 border-2 border-[#2563EB] ring-4 ring-[#2563EB]/10 shadow-card'
                  : isPastPhase
                  ? 'bg-[#F0FDF4]/60 border border-[#BBF7D0]'
                  : 'bg-[#F8FAFC] border border-dashed border-[#E2E8F0]'
              }`}
              data-testid={`kanban-phase-column-${col.id}`}
            >
              {/* Phase Column Header */}
              <div className={`space-y-1.5 pb-2 border-b ${
                isCurrentPhase
                  ? 'bg-[#DBEAFE]/80 border-[#93C5FD] -mx-3 -mt-3 p-3 rounded-t-[5px]'
                  : isPastPhase
                  ? 'border-[#BBF7D0]'
                  : 'border-[#E2E8F0]'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-bold ${isCurrentPhase ? 'text-[#1D4ED8]' : isPastPhase ? 'text-[#166534]' : 'text-[#64748B]'}`}>
                      #{col.number}
                    </span>
                    <h3 className={`font-semibold text-xs tracking-normal ${isCurrentPhase ? 'text-[#1E40AF]' : 'text-[#1E293B]'}`}>
                      {col.label}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isCurrentPhase && (
                      <Badge variant="default" size="compact" className="text-xs font-semibold rounded-[6px] px-2 py-0.5 bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs">
                        Active Phase
                      </Badge>
                    )}
                    {isPastPhase && (
                      <Badge variant="outline" size="compact" className="text-xs font-semibold rounded-[6px] px-2 py-0.5 bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]">
                        Completed
                      </Badge>
                    )}
                    {isUpcomingPhase && (
                      <Badge variant="outline" size="compact" className="text-xs font-medium rounded-[6px] px-2 py-0.5 bg-[#F8FAFC] text-[#64748B] border-[#E2E8F0]">
                        Upcoming
                      </Badge>
                    )}
                    {canAddTask && activeWr && activeWr.status !== 'Completed' && (col.id === 'pre_processing' || col.id === 'processing') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          if (quickAddPhase === col.id) {
                            setQuickAddPhase(null);
                          } else {
                            setQuickAddPhase(col.id);
                          }
                        }}
                        className="h-5 w-5 p-0 rounded-[6px] text-[#1E293B] hover:bg-[#F8FAFC] hover:border hover:border-[#E2E8F0]"
                        title={`Quick-add task to ${col.label}`}
                        data-testid={`quick-add-task-${col.id}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {isEmployeeMissingLead && activeWr && activeWr.status !== 'Completed' && (col.id === 'pre_processing' || col.id === 'processing') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled
                        className="h-5 w-5 p-0 rounded-[6px] text-[#94A3B8] cursor-not-allowed opacity-50"
                        title="Task creation requires an assigned Manager lead on this work request."
                        data-testid={`quick-add-task-disabled-${col.id}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Gate Progress Indicator */}
                <div className="flex items-center justify-between text-xs text-[#475569]">
                  <span className="flex items-center gap-1 font-bold tracking-normal">
                    <CheckSquare className="h-3 w-3 text-[#475569]" />
                    Gate Progress:
                  </span>
                  <span
                    className="font-bold text-[#1E293B] tabular-nums"
                    data-testid={`gate-progress-${col.id}`}
                  >
                    {totalCount === 0 ? '0/0' : `${completedCount}/${totalCount} completed`}
                  </span>
                </div>

                {/* Gate Blocker Warning */}
                {isCurrentPhase && hasGateBlockers && (
                  <div
                    className="p-1.5 bg-[#FEF2F2] border-[#FCA5A5] rounded-[6px] text-xs text-[#DC2626] flex items-center gap-1 cursor-help"
                    title={blockerTooltip}
                    data-testid={`gate-blocker-${col.id}`}
                  >
                    <AlertTriangle className="h-3 w-3 text-[#DC2626] shrink-0" />
                    <span>{incompleteGateTasks.length} task(s) block advancement</span>
                  </div>
                )}

                {/* QA Failed Badge */}
                {col.id === 'quality_assurance' && gateInfo.qa.failed.length > 0 && (
                  <div className="pt-0.5">
                    <Badge
                      variant="destructive"
                      size="compact"
                      className="text-xs gap-1 font-bold uppercase rounded-[6px] bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] shadow-2xs border-[#E2E8F0]"
                      data-testid="qa-column-failed-badge"
                    >
                      <XCircle className="h-3 w-3" />
                      {gateInfo.qa.failed.length} Failed QA
                    </Badge>
                  </div>
                )}
              </div>

              {/* Tasks List Drop Area */}
              <div className="flex-1 space-y-2 overflow-y-auto min-h-36">
                {isEmployeeMissingLead && activeWr && (col.id === 'pre_processing' || col.id === 'processing') && (
                  <div
                    className="p-2 rounded-[6px] bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-xs flex items-center gap-1.5"
                    data-testid="missing-lead-guard"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span>Task creation requires an assigned Manager lead on this work request.</span>
                  </div>
                )}
                {/* Inline Quick-Add Form (UAT2-10) */}
                {quickAddPhase === col.id && canAddTask && activeWr && activeWr.status !== 'Completed' &&
                  (col.id === 'pre_processing' || col.id === 'processing') && (
                  <QuickAddCard
                    key={`${activeEntity}-${effectiveWrId}-${col.id}`}
                    phase={col.id}
                    workRequest={activeWr}
                    onCancel={() => setQuickAddPhase(null)}
                    onCreate={async (data) => {
                      await createTask({ workRequestId: effectiveWrId, data });
                    }}
                  />
                )}
                {phaseTasks.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#475569] italic">
                    No tasks in this phase
                  </div>
                ) : (
                  phaseTasks.map((task) => {
                    const isRejected = isTaskRejected(task);
                    const isPendingApproval = isTaskPendingApproval(task);
                    const canLeadReview = canReviewTaskCreation(currentUser, task, activeWr);
                    const canResubmit = canResubmitTask(currentUser, task, activeWr);
                    const deletionReason = isRejected
                      ? 'Rejected tasks cannot be deleted.'
                      : getTaskDeletionReason(task, activeWr);
                    const isTaskFailed = task.qaStatus === 'failed';
                    const isTaskPassed = task.qaStatus === 'passed';

                    return (
                      <div
                        key={task.id}
                        draggable={false}
                        onClick={() => setSelectedTask(task)}
                        className={`p-3 bg-[#FFFFFF] border rounded-[8px] shadow-card space-y-2 hover:bg-[#F8FAFC] hover:border-[#E2E8F0] transition-none cursor-pointer ${
                          isRejected
                            ? 'border-2 border-[#FCA5A5] bg-[#FEF2F2]/20'
                            : isTaskFailed
                              ? 'border-2 border-[#FCA5A5] bg-[#DC2626]/5'
                              : isPendingApproval
                                ? 'border-[#FDE68A] bg-[#FFFBEB]/10'
                                : isTaskPassed
                                  ? 'border-[#E2E8F0] bg-[#FFFFFF]'
                                  : 'border-[#E2E8F0]'
                        }`}
                        data-testid={`kanban-task-card-${task.id}`}
                      >
                        {/* Task Card Header */}
                        <div className="flex items-start justify-between gap-1.5">
                          <div className="min-w-0 flex-1 flex flex-wrap items-center gap-1.5">
                            <TaskTypeBadge
                              value={
                                task.requiredLinkType ??
                                (task as unknown as { required_link_type?: string | null }).required_link_type
                              }
                              data-testid={`kanban-task-type-${task.id}`}
                            />
                            {isPendingApproval && (
                              <Badge
                                variant="outline"
                                size="compact"
                                className="text-xs font-semibold rounded-[6px] bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] flex items-center gap-1"
                                data-testid={`task-approval-badge-${task.id}`}
                              >
                                <Clock className="h-3 w-3" />
                                <span>Pending Approval</span>
                              </Badge>
                            )}
                            {isRejected && (
                              <Badge
                                variant="destructive"
                                size="compact"
                                className="text-xs font-semibold rounded-[6px] bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5] flex items-center gap-1"
                                data-testid={`task-approval-badge-${task.id}`}
                              >
                                <XCircle className="h-3 w-3" />
                                <span>Creation Rejected</span>
                              </Badge>
                            )}
                            <span className="font-semibold text-xs text-[#1E293B] leading-tight block w-full mt-0.5">
                              {task.title}
                            </span>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <Badge
                              variant={task.status === 'Completed' ? 'success' : 'secondary'}
                              size="compact"
                              className="text-xs font-medium rounded-[6px]"
                            >
                              {task.status}
                            </Badge>

                            {(canEdit || isAdmin) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="xs"
                                    className="h-5 w-5 p-0 rounded-[6px] text-[#475569] hover:text-[#1E293B] focus:outline-none"
                                    onClick={(e) => e.stopPropagation()}
                                    data-testid={`task-menu-btn-${task.id}`}
                                    aria-label="Task options"
                                  >
                                    <MoreVertical className="h-3.5 w-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]" onClick={(e) => e.stopPropagation()}>
                                  <DropdownMenuItem
                                    className="text-xs tracking-normal text-[#DC2626] focus:text-[#FFFFFF] focus:bg-[#DC2626] cursor-pointer gap-1.5 rounded-[6px]"
                                    disabled={Boolean(deletionReason)}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (deletionReason) return;
                                      setDeleteError(null);
                                      setTaskToDelete({
                                        id: task.id,
                                        title: task.title,
                                        assigneeName: task.assigneeName,
                                      });
                                    }}
                                    data-testid={`menu-delete-task-btn-${task.id}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    Delete Task
                                  </DropdownMenuItem>
                                  {deletionReason && (
                                    <p className="max-w-64 px-2 py-1.5 text-sm text-[#475569]" data-testid={`task-delete-reason-${task.id}`}>
                                      {deletionReason}
                                    </p>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </div>

                        {isRejected && (
                          <div
                            className="p-2 rounded-[6px] bg-[#FEF2F2] border border-[#FCA5A5] text-xs text-[#DC2626] space-y-1.5"
                            data-testid={`task-rejection-box-${task.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center gap-1 font-semibold text-[#B91C1C]">
                              <XCircle className="h-3.5 w-3.5 shrink-0" />
                              <span>Task Creation Rejected</span>
                            </div>
                            <p
                              className="text-[#991B1B] text-xs line-clamp-2 pl-4"
                              data-testid={`task-rejection-reason-${task.id}`}
                            >
                              Reason: {task.rejectionReason ??
                                (task as { rejection_reason?: string | null }).rejection_reason ??
                                'No rejection reason provided.'}
                            </p>
                            {canResubmit && (
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                className="w-full text-xs font-semibold h-6 gap-1 rounded-[6px] border-[#1D4ED8] text-[#1D4ED8] hover:bg-[#EFF6FF]"
                                onClick={() => setTaskToResubmit(task)}
                                data-testid={`task-resubmit-btn-${task.id}`}
                              >
                                <Pencil className="h-3 w-3" />
                                <span>Edit & Resubmit</span>
                              </Button>
                            )}
                          </div>
                        )}

                        {task.description && (
                          <p className="text-xs text-[#475569] line-clamp-2">
                            {task.description}
                          </p>
                        )}

                        {/* Task Meta Footer */}
                        <div className="flex items-center justify-between pt-1 border-t border-[#E2E8F0] text-xs text-[#475569]">
                          <div className="flex items-center gap-1 truncate max-w-32">
                            <User className="h-3 w-3 text-[#475569] shrink-0" />
                            <span className="truncate">
                              {task.assigneeName || 'Unassigned'}
                            </span>
                          </div>
                          {task.dueDate && (
                            <div className="flex items-center gap-1 tabular-nums">
                              <Calendar className="h-3 w-3 text-[#475569]" />
                              <span>{new Date(task.dueDate).toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>

                        {/* Lead Manager Creation Approval Controls */}
                        {isPendingApproval && canLeadReview && (
                          <div
                            className="pt-2 border-t border-[#E2E8F0] flex items-center gap-1.5"
                            data-testid={`task-approval-controls-${task.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Button
                              type="button"
                              size="xs"
                              className="flex-1 text-xs font-bold h-6 gap-1 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                              onClick={() => handleApproveTask(task)}
                              data-testid={`task-approve-btn-${task.id}`}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              Approve
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              className="flex-1 text-xs font-bold h-6 gap-1 rounded-[6px] border-[#DC2626] text-[#DC2626] hover:bg-[#FEF2F2] shadow-2xs"
                              onClick={() => setTaskToReject(task)}
                              data-testid={`task-reject-btn-${task.id}`}
                            >
                              <XCircle className="h-3 w-3" />
                              Reject
                            </Button>
                          </div>
                        )}

                        {/* QA Compliance Controls (in Quality Assurance column) */}
                        {col.id === 'quality_assurance' && (
                          <div
                            className="pt-2 border-t border-[#E2E8F0] space-y-1.5"
                            data-testid={`qa-task-controls-${task.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between text-xs uppercase font-bold text-[#1E293B]">
                              <span>QA Compliance:</span>
                              {task.qaStatus === 'passed' || task.qaStatus === 'failed' ? (
                                <Badge
                                  variant={task.qaStatus === 'passed' ? 'success' : 'destructive'}
                                  size="compact"
                                  className="text-xs font-bold uppercase rounded-[6px]"
                                  data-testid={`qa-status-badge-${task.id}`}
                                >
                                  {task.qaStatus === 'passed' ? 'Passed' : 'Failed'}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  size="compact"
                                  className="text-xs font-bold uppercase rounded-[6px] bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]"
                                  data-testid={`qa-status-badge-${task.id}`}
                                >
                                  Under Review
                                </Badge>
                              )}
                            </div>

                            {canQaReview && (
                              <div className="flex items-center gap-1 pt-0.5">
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={task.qaStatus === 'passed' ? 'default' : 'outline'}
                                  disabled={task.qaStatus === 'passed'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQaReview(task.id, 'passed');
                                  }}
                                  className="flex-1 text-xs tracking-normal font-bold h-6 gap-1 rounded-[8px] border-[#E2E8F0] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                                  data-testid={`qa-pass-btn-${task.id}`}
                                >
                                  <CheckCircle2 className="h-3 w-3" />
                                  Pass
                                </Button>
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={task.qaStatus === 'failed' ? 'destructive' : 'outline'}
                                  disabled={task.qaStatus === 'failed'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQaReview(task.id, 'failed');
                                  }}
                                  className="flex-1 text-xs tracking-normal font-bold h-6 gap-1 rounded-[6px] bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] disabled:bg-[#E2E8F0] disabled:text-[#64748B] disabled:border-[#CBD5E1] disabled:opacity-100 shadow-2xs"
                                  data-testid={`qa-fail-btn-${task.id}`}
                                >
                                  <XCircle className="h-3 w-3" />
                                  Fail
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Phase Footer Actions */}
              {isCurrentPhase && (
                <div
                  className="pt-2 border-t border-[#E2E8F0] space-y-2"
                  data-testid={`phase-footer-${col.id}`}
                >
                  {/* Pre-processing -> Processing */}
                  {col.id === 'pre_processing' && (
                    <div className="space-y-1.5">
                      {/* Manager Action: Notify Admin */}
                      {canRequestTransition && !isAdmin && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!gateInfo.pre.canAdvance}
                          title={blockerTooltip}
                          onClick={() =>
                            handleRequestTransition('pre_processing', 'processing')
                          }
                          className="w-full text-xs tracking-normal font-bold gap-1.5 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B]"
                          data-testid="manager-notify-admin-btn"
                        >
                          <Send className="h-3.5 w-3.5 text-[#1E293B]" />
                          Notify Admin — ready for review
                        </Button>
                      )}

                      {/* Admin Direct Advance */}
                      {canAdvance && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={!gateInfo.pre.canAdvance}
                          title={blockerTooltip}
                          onClick={() => handleAdvance('processing')}
                          className="w-full text-xs tracking-normal font-bold gap-1.5 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                          data-testid="admin-advance-btn"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          Advance to Processing
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Processing -> Quality Assurance */}
                  {col.id === 'processing' && (
                    <div className="space-y-1.5">
                      {canRequestTransition && !isAdmin && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!gateInfo.proc.canAdvance}
                          title={blockerTooltip}
                          onClick={() =>
                            handleRequestTransition('processing', 'quality_assurance')
                          }
                          className="w-full text-xs tracking-normal font-bold gap-1.5 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B]"
                          data-testid="manager-notify-admin-btn"
                        >
                          <Send className="h-3.5 w-3.5 text-[#1E293B]" />
                          Notify Admin — ready for review
                        </Button>
                      )}

                      {canAdvance && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={!gateInfo.proc.canAdvance}
                          title={blockerTooltip}
                          onClick={() => handleAdvance('quality_assurance')}
                          className="w-full text-xs tracking-normal font-bold gap-1.5 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                          data-testid="admin-advance-btn"
                        >
                          <ArrowRight className="h-3.5 w-3.5" />
                          Advance to QA
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Quality Assurance Footer Controls */}
                  {col.id === 'quality_assurance' && (
                    <div className="space-y-1.5">
                      {/* Reroute Trigger */}
                      {canQaReview && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsRerouteOpen(true)}
                          className="w-full text-xs tracking-normal font-bold gap-1.5 rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#1E293B]"
                          data-testid="qa-reroute-btn"
                        >
                          <RotateCcw className="h-3.5 w-3.5 text-[#1E293B]" />
                          Reroute
                        </Button>
                      )}

                      {/* Advance to Completion */}
                      {canAdvance && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={!gateInfo.qa.canAdvance}
                          title={
                            gateInfo.qa.canAdvance
                              ? undefined
                              : 'All tasks must be Completed and marked Passed before advancing to Completion'
                          }
                          onClick={() => handleAdvance('completion')}
                          className="w-full text-xs tracking-normal font-bold gap-1.5 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                          data-testid="admin-advance-completion-btn"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Advance to Completion
                        </Button>
                      )}
                    </div>
                  )}

                  {/* Completion Status */}
                  {col.id === 'completion' && (
                    <div className="p-2 bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs rounded-[6px] text-center text-xs tracking-normal font-bold">
                      Work Request Completed
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reroute Dialog */}
      {effectiveWrId && (
        <RerouteModal
          isOpen={isRerouteOpen}
          onClose={() => setIsRerouteOpen(false)}
          workRequestId={effectiveWrId}
          failedTasks={gateInfo.qa.failed.map((t) => ({ id: t.id, title: t.title, phase: t.phase }))}
        />
      )}

      {/* Work Request Edit Modal */}
      {activeWr && (
        <WorkRequestModal
          isOpen={isEditModalOpen}
          workRequest={activeWr}
          onClose={() => setIsEditModalOpen(false)}
        />
      )}

      {/* Task Detail Modal (UAT-OPS4) */}
      {selectedTask && (
        <TaskDetailModal
          isOpen={Boolean(selectedTask)}
          onClose={() => setSelectedTask(null)}
          task={selectedTask}
          workRequest={activeWr}
          onTaskUpdated={(updated) => {
            setSelectedTask(updated);
          }}
        />
      )}

      {/* Delete Task Confirmation Modal (Task OA.4) */}
      <Dialog
        open={Boolean(taskToDelete)}
        onOpenChange={(open) => !open && setTaskToDelete(null)}
      >
        <DialogContent
          className="max-w-md rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float p-6"
          data-testid="delete-task-modal"
        >
          <DialogHeader className="border-b border-[#E2E8F0] pb-3">
            <DialogTitle className="flex items-center gap-2 text-[#DC2626] text-base font-semibold uppercase tracking-tight">
              <AlertTriangle className="h-5 w-5 text-[#DC2626] shrink-0" />
              Delete Task
            </DialogTitle>
            <DialogDescription className="text-xs text-[#475569] pt-1">
              Are you sure you want to delete this task? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {taskToDelete && (
            <div className="p-3 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-xs space-y-1.5">
              <div className="text-[#1E293B]">
                <span className="font-bold">Task: </span>
                <span className="font-medium text-[#1E293B]">{taskToDelete.title}</span>
              </div>
              {taskToDelete.assigneeName && (
                <div className="text-[#475569]">
                  <span className="font-bold">Assignee: </span>
                  <span>{taskToDelete.assigneeName}</span>
                </div>
              )}
              <div className="text-xs text-[#DC2626] font-bold pt-0.5">
                Warning: Any dependencies or records linked to this task will be affected.
              </div>
            </div>
          )}

          {deleteError && <p role="alert" className="text-sm text-[#DC2626]">{deleteError}</p>}

          <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-[#E2E8F0]">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setTaskToDelete(null)}
              disabled={isDeletingTask}
              className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#F8FAFC] text-[#1E293B]"
              data-testid="cancel-delete-task-btn"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmDeleteTask}
              disabled={isDeletingTask}
              className="text-xs tracking-normal font-bold rounded-[6px] bg-[#DC2626] hover:bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
              data-testid="confirm-delete-task-btn"
            >
              {isDeletingTask ? 'Deleting...' : 'Delete Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Side Peek Panel directly mounted in Kanban Board */}
      <WorkRequestSidePeek
        isOpen={isSidePeekOpen}
        workRequestId={activeWr?.id || null}
        onClose={() => setIsSidePeekOpen(false)}
        onViewInBoard={() => setIsSidePeekOpen(false)}
        onEdit={(wr) => {
          setIsSidePeekOpen(false);
          if (onEditWorkRequest) onEditWorkRequest(wr);
          else setIsEditModalOpen(true);
        }}
      />

      {/* Reject Reason Modal for Task Creation Rejection */}
      {taskToReject && (
        <RejectReasonModal
          isOpen={Boolean(taskToReject)}
          requestId={taskToReject.id}
          workRequestTitle={activeWr?.title}
          title="Reject Task Creation"
          description="Provide a required explanation for why this task creation is being rejected. The employee creator will be able to correct and resubmit."
          placeholder="State what needs to be corrected or why this task cannot proceed..."
          submitLabel="Reject Task"
          successTitle="Task Rejected"
          successMessage="The task creation has been rejected with feedback."
          onClose={() => setTaskToReject(null)}
          onReject={async (taskId, reason) => {
            if (!activeWr || (taskToReject.workRequestId && taskToReject.workRequestId !== activeWr.id)) {
              throw new Error('Task does not belong to the active work request');
            }
            await approveOrRejectTaskCreation({
              workRequestId: activeWr.id,
              taskId,
              decision: 'reject',
              reason,
              expectedVersion: taskToReject.version ?? 1,
            });
          }}
          invalidateQueries={[
            operationsKeys.tasks(effectiveWrId),
            operationsKeys.taskDetail(effectiveWrId, taskToReject.id),
            operationsKeys.workRequestDetail(effectiveWrId),
            operationsKeys.workRequestCounts(activeEntity),
          ]}
        />
      )}

      {/* Task Resubmit Modal for Rejected Task Correction */}
      {taskToResubmit && (
        <TaskResubmitModal
          isOpen={Boolean(taskToResubmit)}
          task={taskToResubmit}
          workRequest={activeWr}
          onClose={() => setTaskToResubmit(null)}
        />
      )}
    </div>
  );
}

function PhaseKanbanBoardWithRouter(props: PhaseKanbanBoardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  return <PhaseKanbanBoardInner {...props} searchParams={searchParams} setSearchParams={setSearchParams} />;
}

function PhaseKanbanBoardWithoutRouter(props: PhaseKanbanBoardProps) {
  const [searchParams, setSearchParams] = useState<URLSearchParams>(
    () => new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  );
  return <PhaseKanbanBoardInner {...props} searchParams={searchParams} setSearchParams={setSearchParams} />;
}

export function PhaseKanbanBoard(props: PhaseKanbanBoardProps) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <PhaseKanbanBoardWithRouter {...props} />;
  }
  return <PhaseKanbanBoardWithoutRouter {...props} />;
}
