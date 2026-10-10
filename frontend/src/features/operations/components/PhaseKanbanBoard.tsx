import React, { useState, useMemo, useEffect } from 'react';
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
  X,
  MoreVertical,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { operationsKeys } from '../api/queryKeys';
import { getPhaseBadgeInfo, getStatusBadgeInfo } from '../lib/statusBadges';
import { useSearchParams, useInRouterContext } from 'react-router-dom';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isUserAdmin } from '../lib/taskScope';
import type {
  Phase,
  CreatablePhase,
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
}

interface PhaseKanbanBoardInnerProps extends PhaseKanbanBoardProps {
  searchParams: URLSearchParams;
  setSearchParams: (setter: (prev: URLSearchParams) => URLSearchParams) => void;
}

function PhaseKanbanBoardInner({
  initialWorkRequestId,
  onEditWorkRequest,
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
    if (Array.isArray(rawRequests)) return rawRequests;
    return rawRequests?.data ?? [];
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
  const { data: tasks = [] } = useWorkRequestTasks(effectiveWrId, {
    enabled: Boolean(effectiveWrId),
  });

  // Mutations
  const { advancePhase, requestTransition } = usePhaseTransitions(effectiveWrId);
  const { submitQaReview } = useQaReview(effectiveWrId);
  const { createTask, deleteTask } = useTaskMutations(effectiveWrId);
  const canAddTask =
    hasPermission(permissions, 'workflow:task_add') ||
    hasPermission(permissions, 'workflow:edit');

  const handleDeleteTask = async (taskId: string, taskTitle?: string) => {
    const isConfirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(
            `Are you sure you want to delete "${taskTitle || 'this task'}"? This action cannot be undone.`
          )
        : true;

    if (!isConfirmed) return;

    try {
      await deleteTask(taskId);
      if (selectedTask?.id === taskId) {
        setSelectedTask(null);
      }
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  // Quick-Add Task State (UAT2-10)
  const [quickAddPhase, setQuickAddPhase] = useState<Phase | null>(null);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddDescription, setQuickAddDescription] = useState('');
  const [isQuickAdding, setIsQuickAdding] = useState(false);

  const handleQuickAddSubmit = async (phase: Phase) => {
    if (!quickAddTitle.trim() || !effectiveWrId) return;
    setIsQuickAdding(true);
    try {
      await createTask({
        workRequestId: effectiveWrId,
        data: {
          title: quickAddTitle.trim(),
          description: quickAddDescription.trim() || null,
          phase: phase as CreatablePhase,
        },
      });
      setQuickAddTitle('');
      setQuickAddDescription('');
      setQuickAddPhase(null);
    } catch (err) {
      console.error('Failed to quick-add task', err);
    } finally {
      setIsQuickAdding(false);
    }
  };

  // Modal States
  const [isRerouteOpen, setIsRerouteOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Task Detail Modal State (UAT-OPS4)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Support deep link ?taskId=xxx
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const taskIdParam = urlParams.get('taskId');
        if (taskIdParam && tasks.length > 0) {
          const found = tasks.find((t) => t.id === taskIdParam);
          if (found) {
            setSelectedTask(found);
          }
        }
      }
    } catch {
      // ignore
    }
  }, [tasks]);

  const activeWr = currentWr || workRequests.find((w) => w.id === effectiveWrId);
  const currentPhase: Phase = (activeWr?.phase as Phase) || 'pre_processing';

  // Task Gate & Blocker Logic
  const gateInfo = useMemo(() => {
    const activeTasks = tasks.filter((t) => t.status !== 'Cancelled');
    const preTasks = activeTasks.filter((t) => t.phase === 'pre_processing');
    const procTasks = activeTasks.filter((t) => t.phase === 'processing');

    const preIncomplete = preTasks.filter((t) => t.status !== 'Completed');
    const procIncomplete = procTasks.filter((t) => t.status !== 'Completed');
    const qaIncomplete = activeTasks.filter(
      (t) => t.status !== 'Completed' || t.qaStatus !== 'passed'
    );
    const qaFailed = activeTasks.filter((t) => t.qaStatus === 'failed');

    return {
      pre: {
        total: preTasks.length,
        completed: preTasks.filter((t) => t.status === 'Completed').length,
        incomplete: preIncomplete,
        canAdvance: preTasks.length > 0 && preIncomplete.length === 0,
      },
      proc: {
        total: procTasks.length,
        completed: procTasks.filter((t) => t.status === 'Completed').length,
        incomplete: procIncomplete,
        canAdvance: procTasks.length > 0 && procIncomplete.length === 0,
      },
      qa: {
        total: activeTasks.length,
        completed: activeTasks.filter(
          (t) => t.status === 'Completed' && t.qaStatus === 'passed'
        ).length,
        incomplete: qaIncomplete,
        failed: qaFailed,
        canAdvance: activeTasks.length > 0 && qaIncomplete.length === 0,
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
      <div className="p-12 text-center text-xs text-slate-400 bg-white border border-slate-200 rounded-lg">
        Loading operations kanban board...
      </div>
    );
  }

  if (workRequests.length === 0) {
    return (
      <div
        className="p-12 text-center bg-white border border-slate-200 rounded-lg space-y-3"
        data-testid="kanban-empty-state"
      >
        <Layers className="h-8 w-8 text-slate-400 mx-auto" />
        <h4 className="text-sm font-semibold text-slate-800">
          No active work requests found
        </h4>
        <p className="text-xs text-slate-500">
          Create a new work request to view and govern its 4-phase lifecycle kanban board.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="phase-kanban-board">
      {/* 1. Header Toolbar & Work Request Selector */}
      <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-72">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
              Select Work Request
            </label>
            <Select value={effectiveWrId} onValueChange={handleSelectWr}>
              <SelectTrigger
                className="h-9 text-xs bg-slate-50 font-medium"
                data-testid="kanban-wr-select"
              >
                <SelectValue placeholder="Choose a work request" />
              </SelectTrigger>
              <SelectContent>
                {workRequests.map((wr) => (
                  <SelectItem key={wr.id} value={wr.id} className="text-xs">
                    {wr.title} ({wr.entity})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {activeWr && (
            <div className="flex items-center gap-2 pt-4">
              <Badge variant={activeWr.entity === 'LTA' ? 'lta' : 'ata'} size="compact">
                {activeWr.entity}
              </Badge>
              <Badge
                variant={
                  activeWr.priority === 'Urgent'
                    ? 'destructive'
                    : activeWr.priority === 'High'
                      ? 'warning'
                      : 'secondary'
                }
                size="compact"
              >
                {activeWr.priority.endsWith('Priority') ? activeWr.priority : `${activeWr.priority} Priority`}
              </Badge>
              {(() => {
                const phaseInfo = getPhaseBadgeInfo(activeWr.phase);
                const statusInfo = getStatusBadgeInfo(activeWr.status);
                const PhaseIcon = phaseInfo.Icon;
                const StatusIcon = statusInfo.Icon;
                return (
                  <>
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${phaseInfo.badgeClass}`}
                      title={`Phase: ${phaseInfo.label}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${phaseInfo.dotClass}`} />
                      <PhaseIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>Phase: {phaseInfo.label}</span>
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${statusInfo.badgeClass}`}
                      title={`Status: ${statusInfo.label}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${statusInfo.dotClass}`} />
                      <StatusIcon className="w-3 h-3 shrink-0" />
                      <span>{statusInfo.label}</span>
                    </span>
                    {activeWr.dueDate && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                        <Calendar className="w-3 h-3 text-slate-500" />
                        <span>Due: {new Date(activeWr.dueDate).toLocaleDateString()}</span>
                      </span>
                    )}
                  </>
                );
              })()}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {effectiveWrId && <PresenceAvatars roomId={effectiveWrId} />}
          {activeWr && canEdit && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (onEditWorkRequest) onEditWorkRequest(activeWr);
                else setIsEditModalOpen(true);
              }}
              className="text-xs gap-1.5"
              data-testid="kanban-edit-wr-btn"
            >
              <Edit3 className="h-3.5 w-3.5 text-slate-500" />
              Edit Work Request
            </Button>
          )}
        </div>
      </div>

      {/* 2. 4-Phase Kanban Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4" data-testid="kanban-phase-grid">
        {PHASES.map((col) => {
          const isCurrentPhase = currentPhase === col.id;

          // Filter tasks belonging to this phase zone
          const phaseTasks = tasks.filter((t) => {
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
              className={`flex flex-col bg-slate-50 border rounded-lg p-3 min-h-[560px] space-y-3 transition-colors ${
                isCurrentPhase
                  ? 'border-blue-400 ring-1 ring-blue-200 bg-blue-50/20'
                  : 'border-slate-200'
              }`}
              data-testid={`kanban-phase-column-${col.id}`}
            >
              {/* Phase Column Header */}
              <div className="space-y-1.5 border-b border-slate-200 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-400">
                      #{col.number}
                    </span>
                    <h3 className="font-bold text-xs text-slate-900 tracking-tight">
                      {col.label}
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isCurrentPhase && (
                      <Badge variant="default" size="compact" className="text-[9px] px-1 py-0">
                        Current
                      </Badge>
                    )}
                    {canAddTask && (col.id === 'pre_processing' || col.id === 'processing') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          if (quickAddPhase === col.id) {
                            setQuickAddPhase(null);
                          } else {
                            setQuickAddPhase(col.id);
                            setQuickAddTitle('');
                            setQuickAddDescription('');
                          }
                        }}
                        className="h-5 w-5 p-0 text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                        title={`Quick-add task to ${col.label}`}
                        data-testid={`quick-add-task-${col.id}`}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Gate Progress Indicator */}
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span className="flex items-center gap-1 font-medium">
                    <CheckSquare className="h-3 w-3 text-slate-400" />
                    Gate Progress:
                  </span>
                  <span
                    className={`font-semibold ${
                      completedCount === totalCount && totalCount > 0
                        ? 'text-emerald-700'
                        : 'text-slate-700'
                    }`}
                    data-testid={`gate-progress-${col.id}`}
                  >
                    {totalCount === 0 ? '0/0' : `${completedCount}/${totalCount} completed`}
                  </span>
                </div>

                {/* Gate Blocker Warning */}
                {isCurrentPhase && hasGateBlockers && (
                  <div
                    className="p-1.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-800 flex items-center gap-1 cursor-help"
                    title={blockerTooltip}
                    data-testid={`gate-blocker-${col.id}`}
                  >
                    <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                    <span>{incompleteGateTasks.length} task(s) block advancement</span>
                  </div>
                )}

                {/* QA Failed Badge */}
                {col.id === 'quality_assurance' && gateInfo.qa.failed.length > 0 && (
                  <div className="pt-0.5">
                    <Badge
                      variant="destructive"
                      size="compact"
                      className="text-[10px] gap-1 font-bold"
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
                {/* Inline Quick-Add Form (UAT2-10) */}
                {quickAddPhase === col.id && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleQuickAddSubmit(col.id);
                    }}
                    className="p-2.5 bg-white border border-blue-300 rounded-md shadow-xs space-y-2 text-xs"
                    data-testid={`quick-add-form-${col.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800 text-[11px]">
                        Add {col.label} Task
                      </span>
                      <button
                        type="button"
                        onClick={() => setQuickAddPhase(null)}
                        className="text-slate-400 hover:text-slate-600"
                        data-testid={`quick-add-cancel-${col.id}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <Input
                      type="text"
                      placeholder="Task title..."
                      value={quickAddTitle}
                      onChange={(e) => setQuickAddTitle(e.target.value)}
                      className="h-7 text-xs bg-slate-50"
                      autoFocus
                      required
                      data-testid={`quick-add-title-input-${col.id}`}
                    />
                    <Input
                      type="text"
                      placeholder="Description (optional)..."
                      value={quickAddDescription}
                      onChange={(e) => setQuickAddDescription(e.target.value)}
                      className="h-7 text-xs bg-slate-50"
                      data-testid={`quick-add-desc-input-${col.id}`}
                    />
                    <div className="flex justify-end gap-1.5 pt-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setQuickAddPhase(null)}
                        className="h-6 text-[10px]"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="xs"
                        disabled={isQuickAdding || !quickAddTitle.trim()}
                        className="h-6 text-[10px] font-semibold bg-blue-600 hover:bg-blue-700"
                        data-testid={`quick-add-submit-btn-${col.id}`}
                      >
                        {isQuickAdding ? 'Adding...' : 'Add Task'}
                      </Button>
                    </div>
                  </form>
                )}
                {phaseTasks.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400 italic">
                    No tasks in this phase
                  </div>
                ) : (
                  phaseTasks.map((task) => {
                    const isTaskFailed = task.qaStatus === 'failed';
                    const isTaskPassed = task.qaStatus === 'passed';

                    return (
                      <div
                        key={task.id}
                        draggable={false}
                        onClick={() => setSelectedTask(task)}
                        className={`p-3 bg-white border rounded-md shadow-2xs space-y-2 hover:border-blue-400 hover:shadow-xs transition-all cursor-pointer ${
                          isTaskFailed
                            ? 'border-red-300 bg-red-50/20'
                            : isTaskPassed
                              ? 'border-emerald-300 bg-emerald-50/20'
                              : 'border-slate-200'
                        }`}
                        data-testid={`kanban-task-card-${task.id}`}
                      >
                        {/* Task Card Header */}
                        <div className="flex items-start justify-between gap-1.5">
                          <span className="font-semibold text-xs text-slate-900 leading-tight">
                            {task.title}
                          </span>

                          <div className="flex items-center gap-1 shrink-0">
                            <Badge
                              variant={task.status === 'Completed' ? 'success' : 'secondary'}
                              size="compact"
                              className="text-[10px]"
                            >
                              {task.status}
                            </Badge>

                            {(canEdit || isAdmin) && (
                              <div className="flex items-center gap-0.5">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="xs"
                                  className="h-5 w-5 p-0 text-slate-400 hover:text-red-600 focus:outline-none"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteTask(task.id, task.title);
                                  }}
                                  data-testid={`delete-task-btn-${task.id}`}
                                  title="Delete Task"
                                  aria-label="Delete Task"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>

                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="xs"
                                      className="h-5 w-5 p-0 text-slate-400 hover:text-slate-600 focus:outline-none"
                                      onClick={(e) => e.stopPropagation()}
                                      data-testid={`task-menu-btn-${task.id}`}
                                      aria-label="Task options"
                                    >
                                      <MoreVertical className="h-3.5 w-3.5" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                    <DropdownMenuItem
                                      className="text-xs text-red-600 focus:text-red-700 focus:bg-red-50 cursor-pointer gap-1.5"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteTask(task.id, task.title);
                                      }}
                                      data-testid={`menu-delete-task-btn-${task.id}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Delete Task
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )}
                          </div>
                        </div>

                        {task.description && (
                          <p className="text-[11px] text-slate-600 line-clamp-2">
                            {task.description}
                          </p>
                        )}

                        {/* Task Meta Footer */}
                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px] text-slate-500">
                          <div className="flex items-center gap-1 truncate max-w-32">
                            <User className="h-3 w-3 text-slate-400 shrink-0" />
                            <span className="truncate">
                              {task.assigneeName || 'Unassigned'}
                            </span>
                          </div>
                          {task.dueDate && (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3 w-3 text-slate-400" />
                              <span>{new Date(task.dueDate).toLocaleDateString()}</span>
                            </div>
                          )}
                        </div>

                        {/* QA Compliance Controls (in Quality Assurance column) */}
                        {col.id === 'quality_assurance' && (
                          <div
                            className="pt-2 border-t border-slate-100 space-y-1.5"
                            data-testid={`qa-task-controls-${task.id}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-600">
                              <span>QA Compliance:</span>
                              {task.qaStatus ? (
                                <Badge
                                  variant={task.qaStatus === 'passed' ? 'success' : 'destructive'}
                                  size="compact"
                                  className="text-[9px]"
                                  data-testid={`qa-status-badge-${task.id}`}
                                >
                                  {task.qaStatus === 'passed' ? 'Passed' : 'Failed'}
                                </Badge>
                              ) : (
                                <span className="text-slate-400 italic">Pending Review</span>
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
                                  className="flex-1 text-[10px] h-6 gap-1"
                                  data-testid={`qa-pass-btn-${task.id}`}
                                >
                                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                  Pass
                                </Button>
                                <Button
                                  type="button"
                                  size="xs"
                                  variant={task.qaStatus === 'failed' ? 'destructive' : 'outline'}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQaReview(task.id, 'failed');
                                  }}
                                  className="flex-1 text-[10px] h-6 gap-1"
                                  data-testid={`qa-fail-btn-${task.id}`}
                                >
                                  <XCircle className="h-3 w-3 text-red-600" />
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
                  className="pt-2 border-t border-slate-200 space-y-2"
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
                          className="w-full text-xs font-semibold gap-1.5 bg-white text-slate-800"
                          data-testid="manager-notify-admin-btn"
                        >
                          <Send className="h-3.5 w-3.5 text-blue-600" />
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
                          className="w-full text-xs font-semibold gap-1.5"
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
                          className="w-full text-xs font-semibold gap-1.5 bg-white text-slate-800"
                          data-testid="manager-notify-admin-btn"
                        >
                          <Send className="h-3.5 w-3.5 text-blue-600" />
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
                          className="w-full text-xs font-semibold gap-1.5"
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
                          className="w-full text-xs font-semibold gap-1.5 text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-300"
                          data-testid="qa-reroute-btn"
                        >
                          <RotateCcw className="h-3.5 w-3.5 text-amber-600" />
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
                          className="w-full text-xs font-semibold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
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
                    <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-center text-xs text-emerald-800 font-semibold">
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
          failedTasks={gateInfo.qa.failed.map((t) => ({ id: t.id, title: t.title }))}
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
