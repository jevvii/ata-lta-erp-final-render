import { workDate } from '@/lib/workDate';
import { toast } from 'sonner';
import { DateInput } from '@/components/ui/date-input';
import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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
  Clock,
  FileText,
  Plus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Eye,
  Receipt,
  CreditCard,
  Send,
  Upload,
  ExternalLink,
  Link as LinkIcon,
  X,
  Pencil,
  Lock,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useQueryClient } from '@tanstack/react-query';
import { useEntityRealtimeSync } from '@/lib/realtime';
import { useTimeEntriesList, useCreateTimeEntry } from '@/features/dashboard/api/useTimeEntries';
import { InvoiceCreateModal } from '@/features/billing';
import { CreateDisbursementModal } from '@/features/disbursements';
import { TransmittalFormModal } from '@/features/transmittals';
import { DocumentUploadModal, DocumentViewerModal } from '@/features/documents';
import { useDocuments } from '../api/useDocuments';
import {
  useTaskMutations,
  useTaskRelated,
  useWorkRequestTasks,
  useTaskDetail,
} from '../api/useTasks';
import { useTeam } from '../api/useTeam';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import {
  canMutateTaskStatus,
  canLogTaskTime,
  canUploadTaskDocument,
  canLinkInvoice,
  canLinkTransmittal,
  canLinkDisbursement,
  isUserAdmin,
  isTaskAssignee,
  isChecklistEditor,
  filterTaskRelatedRecords,
  canReviewTaskCreation,
  isTaskRejected,
  isTaskPendingApproval,
  canResubmitTask,
} from '../lib/taskScope';
import { runBlockingAction } from './BlockingActionModal';
import { RejectReasonModal } from './RejectReasonModal';
import { TaskResubmitModal } from './TaskResubmitModal';
import { operationsKeys } from '../api/queryKeys';
import { TaskChecklist } from './TaskChecklist';
import { TaskTimeEntry } from './TaskTimeEntry';
import { toChecklistInput } from '../utils/checklist';
import { getPhaseBadgeInfo } from '../lib/statusBadges';
import { TaskTypeSelect, TaskTypeBadge } from '../lib/taskTypes';
import type { Task, WorkRequest, DmsDocument, TaskStatus } from '../api/types';

export interface TaskDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task | null;
  workRequest?: WorkRequest | null;
  onTaskUpdated?: (updatedTask: Task) => void;
}

export function TaskDetailModal({
  isOpen,
  onClose,
  task: initialTask,
  workRequest,
  onTaskUpdated,
}: TaskDetailModalProps) {
  // Live query binding for task details with multi-case workRequestId fallback
  const effectiveWrId =
    initialTask?.workRequestId ||
    (initialTask as { work_request_id?: string } | null | undefined)?.work_request_id ||
    workRequest?.id;
  const effectiveTaskId = initialTask?.id;
  const queryClient = useQueryClient();
  const currentUser = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);

  // Stable denied scope tracking (Directive 1, Interim Review 2):
  // Preserve access-lost state even when query cache is invalidated or cleared,
  // until the targeted taskId, entity, or user account changes.
  const [deniedScope, setDeniedScope] = useState<{
    taskId: string;
    entity: string | null;
    userId: string | null;
  } | null>(null);

  const isScopeMatch = Boolean(
    deniedScope &&
      deniedScope.taskId === effectiveTaskId &&
      deniedScope.entity === activeEntity &&
      deniedScope.userId === (currentUser?.id ?? null)
  );

  // Scope owner tracking (Directive 1, Final Review):
  // Guard against entity or account switching while modal is open with an initialTask prop.
  const [scopeOwner, setScopeOwner] = useState<{
    taskId: string;
    entity: string | null;
    userId: string | null;
  } | null>(() => {
    if (isOpen && effectiveTaskId) {
      return {
        taskId: effectiveTaskId,
        entity: activeEntity,
        userId: currentUser?.id ?? null,
      };
    }
    return null;
  });

  useEffect(() => {
    if (isOpen && effectiveTaskId) {
      setScopeOwner((prev) => {
        if (!prev || prev.taskId !== effectiveTaskId) {
          return {
            taskId: effectiveTaskId,
            entity: activeEntity,
            userId: currentUser?.id ?? null,
          };
        }
        return prev;
      });
    } else if (!isOpen) {
      setScopeOwner(null);
    }
  }, [isOpen, effectiveTaskId, activeEntity, currentUser?.id]);

  const isScopeStale = Boolean(
    scopeOwner &&
      (scopeOwner.entity !== activeEntity ||
        scopeOwner.userId !== (currentUser?.id ?? null))
  );

  useEffect(() => {
    if (isScopeStale && isOpen) {
      onClose?.();
    }
  }, [isScopeStale, isOpen, onClose]);

  const {
    data: rawLiveTask,
    isError: isTaskError,
    isFetching: isTaskFetching,
    refetch: refetchTask,
    isPlaceholderData: isTaskPlaceholder,
    error: taskError,
  } = useTaskDetail(effectiveWrId, effectiveTaskId, {
    enabled: Boolean(effectiveWrId && effectiveTaskId && isOpen && !isScopeStale),
  });

  const isTaskDetailErrorDenied = Boolean(
    isTaskError &&
      ((taskError as { status?: number })?.status === 401 ||
        (taskError as { status?: number })?.status === 403 ||
        (taskError as { status?: number })?.status === 404 ||
        String(taskError?.message || '').includes('401') ||
        String(taskError?.message || '').includes('403') ||
        String(taskError?.message || '').includes('404'))
  );

  const {
    data: rawRelatedRecords,
    isError: isRelatedError,
    error: relatedError,
    refetch: refetchRelated,
  } = useTaskRelated(effectiveTaskId, {
    enabled: Boolean(
      effectiveTaskId &&
        isOpen &&
        !isScopeStale &&
        !isScopeMatch &&
        !isTaskDetailErrorDenied
    ),
  });

  const isRelatedErrorDenied = Boolean(
    isRelatedError &&
      ((relatedError as { status?: number })?.status === 401 ||
        (relatedError as { status?: number })?.status === 403 ||
        (relatedError as { status?: number })?.status === 404 ||
        String(relatedError?.message || '').includes('401') ||
        String(relatedError?.message || '').includes('403') ||
        String(relatedError?.message || '').includes('404'))
  );

  const isTaskDenied = Boolean(
    isScopeMatch || isTaskDetailErrorDenied || isRelatedErrorDenied
  );
  const isRelatedDenied = Boolean(isRelatedErrorDenied || isTaskDenied);

  // When access denial is observed, record denied scope and purge confidential data
  useEffect(() => {
    if ((isTaskDetailErrorDenied || isRelatedErrorDenied) && effectiveTaskId) {
      setDeniedScope({
        taskId: effectiveTaskId,
        entity: activeEntity,
        userId: currentUser?.id ?? null,
      });

      // Cancel in-flight queries and overwrite query cache data with null so no observer holds protected data.
      // CRITICAL: NEVER call removeQueries on taskDetail or taskRelated,
      // as removing the driving query wipes the 403 error and resets active observers.
      if (effectiveWrId) {
        void queryClient.cancelQueries({ queryKey: operationsKeys.taskDetail(effectiveWrId, effectiveTaskId) });
        queryClient.setQueryData(operationsKeys.taskDetail(effectiveWrId, effectiveTaskId), null);
      }
      void queryClient.cancelQueries({ queryKey: operationsKeys.taskRelated(effectiveTaskId) });
      queryClient.setQueryData(operationsKeys.taskRelated(effectiveTaskId), null);
      queryClient.removeQueries({ queryKey: ['operations', 'tasks', effectiveTaskId, 'documents'], exact: false });
      queryClient.removeQueries({ queryKey: ['operations', 'time-entries', { taskId: effectiveTaskId }], exact: false });
    }
  }, [isTaskDetailErrorDenied, isRelatedErrorDenied, effectiveWrId, effectiveTaskId, activeEntity, currentUser?.id, queryClient]);

  const rawTask = Array.isArray(rawLiveTask)
    ? rawLiveTask.find((t) => t?.id === effectiveTaskId)
    : rawLiveTask;

  // Support restored membership on fresh successful authorized read (Directive 2):
  // When genuinely fresh, non-null matching task data arrives without error, clear the denied latch.
  useEffect(() => {
    if (
      rawTask &&
      rawTask.id === effectiveTaskId &&
      !isTaskError &&
      !isTaskPlaceholder &&
      deniedScope
    ) {
      setDeniedScope(null);
      void refetchRelated();
    }
  }, [rawTask, effectiveTaskId, isTaskError, isTaskPlaceholder, deniedScope, refetchRelated]);

  const liveTask = isTaskDenied
    ? (rawTask && !isTaskError && !isTaskPlaceholder ? rawTask : null)
    : rawTask;

  const currentTask = useMemo<Task | null>(() => {
    if (isTaskDenied || isScopeStale) return null;
    if (!liveTask || !liveTask.id) return initialTask;
    if (!initialTask) return liveTask as Task;

    // 1. Explicit unassignment check (applies across all versions):
    // Authoritative live unassignment must completely clear lead and co-assignees,
    // preventing static initialTask props from resurrecting stale assignees.
    const isLiveExplicitlyUnassigned =
      liveTask.assigneeId === null ||
      (liveTask as { assignee_id?: string | null }).assignee_id === null ||
      liveTask.assigneeId === '';

    if (isLiveExplicitlyUnassigned) {
      return {
        ...initialTask,
        ...liveTask,
        assigneeId: null,
        assigneeName: null,
        assignees: [],
        taskAssignees: [],
        task_assignees: [],
      } as Task;
    }

    const initialVersion = typeof initialTask.version === 'number' ? initialTask.version : 0;
    const liveVersion = typeof liveTask.version === 'number' ? liveTask.version : 0;

    // 2. If live query has an explicitly higher version, live CDC update takes precedence
    if (liveVersion > initialVersion) {
      return { ...initialTask, ...liveTask } as Task;
    }

    // 3. When versions are equal (or unversioned):
    // Check if initialTask has richer assignee information (e.g. multi-assignees in test suites or optimistic props)
    const initialAssigneeCount = Math.max(
      initialTask.assignees?.length ?? 0,
      initialTask.taskAssignees?.length ?? 0,
      (initialTask as unknown as { task_assignees?: unknown[] }).task_assignees?.length ?? 0
    );
    const liveAssigneeCount = Math.max(
      liveTask.assignees?.length ?? 0,
      liveTask.taskAssignees?.length ?? 0,
      (liveTask as unknown as { task_assignees?: unknown[] }).task_assignees?.length ?? 0
    );

    if (initialAssigneeCount > liveAssigneeCount) {
      return {
        ...initialTask,
        ...liveTask,
        assigneeId: initialTask.assigneeId ?? liveTask.assigneeId,
        assigneeName: initialTask.assigneeName ?? liveTask.assigneeName,
        assignees: initialTask.assignees ?? liveTask.assignees,
        taskAssignees: initialTask.taskAssignees ?? liveTask.taskAssignees,
      } as Task;
    }

    // Authoritative liveTask fields always override static initialTask prop
    return { ...initialTask, ...liveTask } as Task;
  }, [initialTask, liveTask, isTaskDenied, isScopeStale]);

  const task = currentTask;

  // Instant reactive local state for due date (Task B.7)
  const [localDueDate, setLocalDueDate] = useState<string | null>(task?.dueDate ?? null);
  useEffect(() => {
    setLocalDueDate(task?.dueDate ?? null);
  }, [task?.dueDate]);

  // Instant reactive local state for task link type
  const rawTaskLinkType =
    task?.requiredLinkType ??
    (task as unknown as { required_link_type?: string | null } | null)?.required_link_type ??
    null;
  const [localLinkType, setLocalLinkType] = useState<string | null>(rawTaskLinkType);
  useEffect(() => {
    setLocalLinkType(rawTaskLinkType);
  }, [rawTaskLinkType]);

  // Time logging form state
  const [logDate, setLogDate] = useState(() => workDate());
  const [logMinutes, setLogMinutes] = useState('30');
  const [logNote, setLogNote] = useState('');
  const [showLogForm, setShowLogForm] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [timeEntryError, setTimeEntryError] = useState<string | null>(null);

  useEffect(() => { setTimeEntryError(null); }, [effectiveTaskId, isOpen]);

  // Selected document for preview
  const [selectedDoc, setSelectedDoc] = useState<DmsDocument | null>(null);

  // Collapsible sections state
  const [attachmentsOpen, setAttachmentsOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);

  // Document date formatter for attachment cards
  const formatDocDate = (doc: DmsDocument) => {
    const rawDate = doc.created_at || doc.createdAt || (doc as unknown as { uploaded_at?: string }).uploaded_at;
    if (!rawDate) return `${doc.category || 'General'} • Document`;
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) return `${doc.category || 'General'} • Document`;
    const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${dateStr}, ${timeStr}`;
  };

  // Key state to reset select dropdowns after an action
  const [addSelectKey, setAddSelectKey] = useState(0);
  const [reassignSelectKey, setReassignSelectKey] = useState(0);

  // Live Collaborative Real-Time CDC Subscriptions for Task Time Logs (SPEC-REALTIME-TIME-LOGGING-001)
  useEntityRealtimeSync({
    table: 'time_entries',
    enabled: isOpen && Boolean(task?.id),
  });
  useEntityRealtimeSync({
    table: 'task_time_logs',
    enabled: isOpen && Boolean(task?.id),
  });

  // Time entries for this task
  const { data: timeEntries = [], isLoading: isLoadingTime } = useTimeEntriesList(
    task?.id ? { taskId: task.id } : undefined
  );

  // Documents linked to this work request / task (narrowed by selected task)
  const currentWrId =
    task?.workRequestId ||
    (task as { work_request_id?: string } | null | undefined)?.work_request_id ||
    workRequest?.id;

  const { data: rawDocs, isLoading: isLoadingDocs, refetch: refetchDocs } = useDocuments(
    currentWrId && task?.id
      ? { workRequestId: currentWrId, linkedTaskId: task.id }
      : undefined,
    { enabled: Boolean(currentWrId && task?.id) }
  );

  const linkedDocs: DmsDocument[] = useMemo(() => {
    const docs = Array.isArray(rawDocs) ? rawDocs : Array.isArray(rawDocs?.data) ? rawDocs.data : [];
    if (!task?.id) return [];
    return docs.filter(
      (d) => (d.linkedTaskId ?? d.linked_task_id) === task.id
    );
  }, [rawDocs, task]);

  // Mutations
  const createTimeEntryMutation = useCreateTimeEntry();
  const {
    updateTask,
    updateMutation,
    approveOrRejectTaskCreation,
  } = useTaskMutations(task?.workRequestId || '');

  const permissions = useSessionStore((state) => state.permissions);
  const isAdmin = isUserAdmin(currentUser);
  const isCompletedWr = workRequest?.status === 'Completed';
  const isTaskRejectedState = isTaskRejected(task);
  const isTaskPendingState = isTaskPendingApproval(task);
  const canLeadReview = canReviewTaskCreation(currentUser, task, workRequest);
  const canResubmit = canResubmitTask(currentUser, task, workRequest);

  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const rejectIntent = React.useRef<{ taskId: string; wrId: string; version: number } | null>(null);
  const [isResubmitModalOpen, setIsResubmitModalOpen] = useState(false);

  // Clear review dialogs on task, WR, entity, or account context switch
  useEffect(() => {
    setIsRejectModalOpen(false);
    setIsResubmitModalOpen(false);
  }, [task?.id, effectiveWrId, activeEntity, currentUser?.id]);

  const handleApproveTask = async () => {
    if (!task) return;
    const wrId = effectiveWrId || task.workRequestId;
    if (!wrId) return;
    if (task.workRequestId && task.workRequestId !== wrId) {
      toast.error('Task does not belong to the active work request');
      return;
    }
    await runBlockingAction({
      title: 'Approving Task Creation',
      message: 'Please wait while the task creation is approved...',
      apiCall: async () => {
        const updated = await approveOrRejectTaskCreation({
          workRequestId: wrId,
          taskId: task.id,
          decision: 'approve',
          expectedVersion: task.version ?? 1,
        });
        onTaskUpdated?.(updated);
        return updated;
      },
      successTitle: 'Task Approved',
      successMessage: 'Task creation has been approved successfully.',
      invalidateQueries: [
        operationsKeys.tasks(wrId),
        operationsKeys.taskDetail(wrId, task.id),
        operationsKeys.workRequestDetail(wrId),
      ],
    });
  };

  const checklistReady = !isTaskError && !isTaskPlaceholder && liveTask?.id === task?.id && Array.isArray(liveTask?.checklist);
  const isChecklistLoading = !checklistReady && (isTaskFetching || isTaskPlaceholder);
  const uncheckedChecklistCount = task?.checklist?.filter((item) => !item.completed).length ?? 0;
  const checklistCompletionBlocked = !checklistReady || updateMutation.isPending || uncheckedChecklistCount > 0;
  const checklistCompletionReason = !checklistReady
    ? 'Wait for the checklist to load successfully before completing this task.'
    : updateMutation.isPending
      ? 'Wait for checklist changes to finish saving.'
      : `Check all checklist items first (${uncheckedChecklistCount} remaining).`;

  const canEdit = !isCompletedWr && !isTaskRejectedState && hasPermission(permissions, 'workflow:edit');
  const canEditChecklist = canEdit && isChecklistEditor(currentUser, task);
  const canCompleteChecklist = !isCompletedWr && !isTaskRejectedState && (isChecklistEditor(currentUser, task) || isTaskAssignee(currentUser, task));

  // Task description editing state (OA.5)
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descText, setDescText] = useState(task?.description || '');
  const descriptionVersion = React.useRef(task?.version ?? 1);
  const [isSavingDesc, setIsSavingDesc] = useState(false);

  useEffect(() => {
    if (!isEditingDesc) setDescText(task?.description || '');
  }, [task?.description, isEditingDesc]);

  const handleSaveDescription = async () => {
    if (!task || !task.workRequestId) return;
    setIsSavingDesc(true);
    try {
      const res = await updateTask({
        workRequestId: task.workRequestId,
        taskId: task.id,
        data: { description: descText.trim() || null, expectedVersion: descriptionVersion.current },
      });
      if (res && onTaskUpdated) {
        onTaskUpdated(res as Task);
      }
      setIsEditingDesc(false);
    } catch (err) {
      console.error('Failed to update task description:', err);
      toast.error(err instanceof Error ? err.message : 'Unable to save task description.');
    } finally {
      setIsSavingDesc(false);
    }
  };

  // RBAC permissions for linked financial creation (UAT2-7)
  const canCreateInvoice =
    hasPermission(permissions, 'billing:edit') ||
    hasPermission(permissions, 'billing:create');
  const canCreateDisbursement =
    hasPermission(permissions, 'disbursement:create') ||
    hasPermission(permissions, 'disbursement:edit');
  const canCreateTransmittal =
    hasPermission(permissions, 'transmittal:create') ||
    hasPermission(permissions, 'transmittal:edit');

  // Sibling tasks for parent WR to verify WR membership
  const { data: siblingTasksData = [] } = useWorkRequestTasks(task?.workRequestId, {
    enabled: Boolean(task?.workRequestId && !isTaskDenied && !isScopeStale),
  });
  const siblingTasks = useMemo(() => siblingTasksData || [], [siblingTasksData]);

  // Task B.5: Graceful prerequisite blocker handling
  const incompletePredecessors = useMemo(() => {
    if (!task?.predecessors?.length) return [];
    const predIds = new Set(task.predecessors);
    return siblingTasks.filter(
      (t) => predIds.has(t.id) && t.status !== 'Completed' && t.status !== 'Cancelled'
    );
  }, [task?.predecessors, siblingTasks]);

  const isPrereqBlocked = incompletePredecessors.length > 0;
  const prereqBlockedTooltip = isPrereqBlocked
    ? `Blocked by prerequisite task(s): ${incompletePredecessors.map((p) => p.title).join(', ')}`
    : undefined;

  // Task B.4: Client-side phase gate for non-active phases
  const PHASES_ORDER = ['pre_processing', 'processing', 'quality_assurance', 'completion'];
  const isPhaseBlocked = Boolean(
    workRequest?.phase && task?.phase && task.phase !== workRequest.phase
  );
  const phaseBlockedTooltip = isPhaseBlocked
    ? `Task is locked because the Work Request is currently in the ${getPhaseBadgeInfo(workRequest?.phase).label} phase.`
    : undefined;

  const isInvoicePhaseBlocked = Boolean(
    workRequest?.phase &&
      task?.phase &&
      (workRequest.phase === 'completion' ||
        PHASES_ORDER.indexOf(task.phase) > PHASES_ORDER.indexOf(workRequest.phase))
  );
  const invoicePhaseBlockedTooltip = isInvoicePhaseBlocked
    ? `Task is locked because the Work Request is currently in the ${getPhaseBadgeInfo(workRequest?.phase).label} phase.`
    : undefined;

  // Financial creation modals state (UAT2-7)
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isDisbursementModalOpen, setIsDisbursementModalOpen] = useState(false);
  const [isTransmittalModalOpen, setIsTransmittalModalOpen] = useState(false);

  // Document upload modal state (UAT2-11)
  const [isUploadDocModalOpen, setIsUploadDocModalOpen] = useState(false);

  // Linked records query (UAT2-7) with defensive task-scoping
  const relatedRecords = useMemo(
    () =>
      isTaskDenied
        ? { invoices: [], disbursements: [], transmittals: [] }
        : filterTaskRelatedRecords(rawRelatedRecords, task?.id),
    [isTaskDenied, rawRelatedRecords, task?.id]
  );
  const invoices = relatedRecords.invoices;
  const disbursements = relatedRecords.disbursements;
  const transmittals = relatedRecords.transmittals;

  // Team directory lookup for employee assignment (UAT2-8)
  const { data: rawTeam } = useTeam();
  const teamList = useMemo(() => {
    if (Array.isArray(rawTeam)) return rawTeam;
    if (rawTeam && typeof rawTeam === 'object' && 'data' in rawTeam && Array.isArray((rawTeam as { data: unknown[] }).data)) {
      return (rawTeam as { data: Array<{ id: string; name: string; role: string; departments?: string[] }> }).data;
    }
    return [];
  }, [rawTeam]);

  const allowedWrTeamIds = useMemo(() => {
    const ids = new Set<string>();
    if (workRequest?.assignedTo) ids.add(workRequest.assignedTo);
    if (Array.isArray(workRequest?.coAssignees)) {
      workRequest.coAssignees.forEach((id) => ids.add(id));
    }
    return ids;
  }, [workRequest]);

  const scopedTeamList = useMemo(() => {
    if (allowedWrTeamIds.size === 0) return teamList;
    return teamList.filter((m) => allowedWrTeamIds.has(m.id));
  }, [teamList, allowedWrTeamIds]);

  const currentAssigneeIds = useMemo(() => {
    const ids = new Set<string>();
    if (task?.assigneeId) ids.add(task.assigneeId);
    if (Array.isArray(task?.assignees)) {
      task.assignees.forEach((id) => ids.add(id));
    }
    for (const assignments of [task?.taskAssignees, task?.task_assignees]) {
      assignments?.forEach((ta) => {
        const uId = ta.userId || ta.user_id;
        if (uId) ids.add(uId);
      });
    }
    return ids;
  }, [task]);

  const availableTeamMembers = useMemo(() => {
    return scopedTeamList.filter((m) => {
      if (!m || !m.id || currentAssigneeIds.has(m.id)) return false;
      if (m.role === 'Admin') return false;
      if (m.role === 'Manager' && !allowedWrTeamIds.has(m.id) && !(m.departments && m.departments.includes('Operations'))) {
        return false;
      }
      return true;
    });
  }, [scopedTeamList, currentAssigneeIds, allowedWrTeamIds]);

  // Comprehensive assigned team members (lead + all co-assignees)
  const assignedTeamMembers = useMemo(() => {
    if (!task) return [];
    const members: Array<{
      id: string;
      name: string;
      role?: string;
      isLead: boolean;
    }> = [];

    const leadId = task.assigneeId;

    currentAssigneeIds.forEach((id) => {
      const found = teamList.find((m) => m.id === id);
      const assignment = [...(task.taskAssignees || []), ...(task.task_assignees || [])]
        .find((member) => (member.userId || member.user_id) === id);
      const isLead = id === leadId;
      members.push({
        id,
        name: found?.name || assignment?.userName || (isLead && task.assigneeName ? task.assigneeName : `Staff (${id.slice(0, 8)})`),
        role: found?.role,
        isLead,
      });
    });

    return members.sort((a, b) => {
      if (a.isLead) return -1;
      if (b.isLead) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [task, currentAssigneeIds, teamList]);

  // Task Scoping Rules:
  // 1. Only assigned employee or Admin can mutate status, log time, upload docs (and rejected tasks locked)
  const canMutateStatus = !isCompletedWr && !isTaskRejectedState && canMutateTaskStatus(currentUser, task);
  const canLogTime = !isCompletedWr && !isTaskRejectedState && hasPermission(permissions, 'timelog:create') && canLogTaskTime(currentUser, task);
  const canUploadDoc = !isCompletedWr && !isTaskRejectedState && canUploadTaskDocument(currentUser, task);

  // 2. Financial record linking vs requesting:
  const canLinkInv = !isCompletedWr && !isTaskRejectedState && canLinkInvoice(currentUser, task, workRequest, siblingTasks) && canCreateInvoice;
  const canLinkTrans = !isCompletedWr && !isTaskRejectedState && canLinkTransmittal(currentUser, task, workRequest, siblingTasks) && canCreateTransmittal;
  const canLinkDisb = !isCompletedWr && !isTaskRejectedState && canLinkDisbursement(currentUser, task, canCreateDisbursement);

  // Handle adding a co-assignee (UAT2-8 + multi-assignee)
  const handleAddCoAssignee = async (employeeId: string) => {
    if (!task || !task.workRequestId) return;
    const member = teamList.find((m) => m.id === employeeId);
    if (!member) return;
    const nextAssigneeIds = Array.from(new Set([...currentAssigneeIds, employeeId]));
    const nextAssigneeName = task.assigneeName || member.name;
    const nextAssigneeId = task.assigneeId || member.id;

    setAddSelectKey((k) => k + 1);

    await runBlockingAction({
      title: 'Adding Assignee',
      message: `Assigning ${member.name} to task "${task.title}"...`,
      apiCall: async () => {
        return await updateTask({
          workRequestId: task.workRequestId,
          taskId: task.id,
          data: {
            assigneeId: nextAssigneeId,
            expectedVersion: task.version,
            assigneeName: nextAssigneeName,
            assignees: nextAssigneeIds,
          },
        });
      },
      successTitle: 'Assignee Added',
      successMessage: `${member.name} has been assigned to this task.`,
      onSuccess: (updated) => {
        if (updated && onTaskUpdated) {
          onTaskUpdated(updated as Task);
        }
      },
      invalidateQueries: [
        operationsKeys.tasks(task.workRequestId),
        operationsKeys.workRequestDetail(task.workRequestId),
      ],
    });
  };

  // Handle setting / re-assigning the lead assignee
  const handleSetLeadAssignee = async (employeeId: string) => {
    if (!task || !task.workRequestId) return;
    const member = teamList.find((m) => m.id === employeeId);
    if (!member) return;
    const nextAssigneeIds = Array.from(new Set([...currentAssigneeIds, employeeId]));

    setReassignSelectKey((k) => k + 1);

    await runBlockingAction({
      title: 'Reassigning Lead Assignee',
      message: `Setting ${member.name} as lead assignee for "${task.title}"...`,
      apiCall: async () => {
        return await updateTask({
          workRequestId: task.workRequestId,
          taskId: task.id,
          data: {
            assigneeId: member.id,
            expectedVersion: task.version,
            assigneeName: member.name,
            assignees: nextAssigneeIds,
          },
        });
      },
      successTitle: 'Lead Assignee Updated',
      successMessage: `${member.name} is now the lead assignee for this task.`,
      onSuccess: (updated) => {
        if (updated && onTaskUpdated) {
          onTaskUpdated(updated as Task);
        }
      },
      invalidateQueries: [
        operationsKeys.tasks(task.workRequestId),
        operationsKeys.workRequestDetail(task.workRequestId),
      ],
    });
  };

  // Handle removing an assignee or co-assignee
  const handleRemoveAssignee = async (employeeId: string) => {
    if (!task || !task.workRequestId) return;
    const member = teamList.find((m) => m.id === employeeId);
    const memberName = member?.name || 'Assigned member';

    const nextAssigneeIds = Array.from(currentAssigneeIds).filter((id) => id !== employeeId);
    const isRemovingLead = task.assigneeId === employeeId;

    let nextLeadId: string | null = task.assigneeId;
    let nextLeadName: string | null = task.assigneeName;

    if (isRemovingLead) {
      if (nextAssigneeIds.length > 0) {
        nextLeadId = nextAssigneeIds[0] ?? null;
        const nextLead = teamList.find((m) => m.id === nextLeadId);
        nextLeadName = nextLead?.name || null;
      } else {
        nextLeadId = null;
        nextLeadName = null;
      }
    }

    await runBlockingAction({
      title: 'Removing Assignee',
      message: `Removing ${memberName} from "${task.title}"...`,
      apiCall: async () => {
        return await updateTask({
          workRequestId: task.workRequestId,
          taskId: task.id,
          data: {
            assigneeId: nextLeadId,
            expectedVersion: task.version,
            assigneeName: nextLeadName,
            assignees: nextAssigneeIds,
          },
        });
      },
      successTitle: 'Assignee Removed',
      successMessage: `${memberName} has been removed from this task.`,
      onSuccess: (updated) => {
        if (updated && onTaskUpdated) {
          onTaskUpdated(updated as Task);
        }
      },
      invalidateQueries: [
        operationsKeys.tasks(task.workRequestId),
        operationsKeys.workRequestDetail(task.workRequestId),
      ],
    });
  };

  // Handle setting task status (UAT2-9-frontend, Task B.5)
  const handleSetTaskStatus = async (nextStatus: TaskStatus) => {
    if (!task || !task.workRequestId) return;
    if (nextStatus === 'Completed' && checklistCompletionBlocked) return;

    try {
      await runBlockingAction({
        title: 'Updating Task Status',
        message: `Setting status of "${task.title}" to ${nextStatus}...`,
        apiCall: async () => {
          return await updateTask({
            workRequestId: task.workRequestId,
            taskId: task.id,
            data: { status: nextStatus },
          });
        },
        successTitle: 'Task Updated',
        successMessage: isAdmin
          ? `Task "${task.title}" status changed to ${nextStatus} (Directly approved by Admin).`
          : `Task "${task.title}" status changed to ${nextStatus}.`,
        onSuccess: (updated) => {
          if (updated && onTaskUpdated) {
            onTaskUpdated(updated as Task);
          }
        },
        invalidateQueries: [
          operationsKeys.tasks(task.workRequestId),
          operationsKeys.workRequestDetail(task.workRequestId),
        ],
      });
    } catch {
      // Gracefully handled by BlockingActionModal presentation
    }
  };

  // Calculate total minutes logged
  const totalMinutes = useMemo(() => {
    return timeEntries.reduce((acc, entry) => acc + (entry.durationMinutes || 0), 0);
  }, [timeEntries]);

  const formatHours = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const handleLogTimeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task) return;
    if (createTimeEntryMutation.isPending) return;
    const durationMinutes = Number(logMinutes);
    if (!logMinutes.trim() || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      setLogError('Duration must be an integer between 1 and 1440 minutes.');
      return;
    }
    if (!logDate || logDate > workDate()) {
      setLogError('Entry date is required and cannot be in the future.');
      return;
    }
    setLogError(null);

    try {
      await createTimeEntryMutation.mutateAsync({
        taskId: task.id,
        entryDate: logDate || workDate(),
        durationMinutes,
        note: logNote.trim() || undefined,
      });

      setLogNote('');
      setShowLogForm(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to log time';
      setLogError(msg);
    }
  };

  if (isScopeStale) return null;

  if (isTaskDenied) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md p-6 rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float text-center"
          data-testid="task-access-denied-dialog"
        >
          <div className="flex flex-col items-center justify-center py-6 space-y-3">
            <div className="w-12 h-12 rounded-full bg-[#F1F5F9] flex items-center justify-center">
              <Lock className="w-6 h-6 text-[#64748B]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#1E293B]">Access Not Available</h3>
              <p className="text-xs text-[#475569] max-w-xs mx-auto">
                You do not have access to this task or its parent work request.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="mt-2 text-xs rounded-[6px]"
              data-testid="task-access-denied-close-btn"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!task) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-5xl w-[95vw] max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden bg-white border border-[#E2E8F0] shadow-xl rounded-xl"
          data-testid="task-detail-modal"
        >
          {/* Top Breadcrumb & Context Header */}
          <DialogHeader className="px-6 py-3.5 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-row flex-wrap items-center justify-between gap-3 shrink-0 space-y-0 text-left">
            {/* Left breadcrumb trail */}
            <div className="flex flex-wrap items-center gap-2 min-w-0 pr-4">
              {/* Entity badge */}
              <Badge
                variant={workRequest?.entity === 'LTA' ? 'lta' : 'ata'}
                size="compact"
                className="rounded-[6px] text-xs font-semibold shrink-0"
              >
                {workRequest?.entity || 'ATA'}
              </Badge>

              <span className="text-[#CBD5E1] text-xs select-none">/</span>

              {/* Parent Work Request Breadcrumb */}
              {workRequest ? (
                <div
                  className="flex items-center gap-1.5 text-xs text-[#475569] font-medium truncate max-w-[240px] sm:max-w-[320px]"
                  title={`${workRequest.workRequestNumber || workRequest.work_request_number || (workRequest as unknown as { code?: string }).code || ''} ${workRequest.title}`}
                >
                  <span className="sr-only">Work Request: </span>
                  {(() => {
                    const wrCode = (workRequest as unknown as { code?: string }).code || workRequest.workRequestNumber || workRequest.work_request_number || workRequest.id;
                    return (
                      <>
                        {wrCode && (
                          <span className="font-mono text-xs font-semibold text-[#475569] tabular-nums shrink-0 mr-1">
                            [{wrCode}]
                          </span>
                        )}
                        <span className="font-semibold text-[#1E293B] truncate">{workRequest.title}</span>
                      </>
                    );
                  })()}
                </div>
              ) : (
                <span className="font-mono text-xs text-[#64748B] tabular-nums shrink-0">{task.workRequestId}</span>
              )}

              <span className="text-[#CBD5E1] text-xs select-none">/</span>

              {/* Task Type selector or badge */}
              <div className="shrink-0">
                {canEdit ? (
                  <TaskTypeSelect
                    value={localLinkType}
                    onChange={async (val) => {
                      const nextVal = val || null;
                      setLocalLinkType(nextVal);
                      try {
                        const updated = await updateTask({
                          workRequestId: task.workRequestId,
                          taskId: task.id,
                          data: { requiredLinkType: nextVal, expectedVersion: task.version },
                        });
                        if (updated && onTaskUpdated) {
                          onTaskUpdated(updated as Task);
                        }
                      } catch (err) {
                        console.error('Failed to update task type:', err);
                      }
                    }}
                    showLabel
                    ariaLabel="Task type"
                    data-testid="task-detail-type-select"
                  />
                ) : (
                  <TaskTypeBadge
                    value={localLinkType}
                    showStandardLabel
                    data-testid="task-detail-type-badge"
                  />
                )}
              </div>

              {/* QA status pill */}
              {task.qaStatus === 'passed' || task.qaStatus === 'failed' ? (
                <Badge
                  variant={task.qaStatus === 'passed' ? 'success' : 'destructive'}
                  size="compact"
                  className="rounded-[6px] text-xs font-semibold shrink-0"
                >
                  QA: {task.qaStatus}
                </Badge>
              ) : workRequest?.phase === 'quality_assurance' ? (
                <Badge
                  variant="secondary"
                  size="compact"
                  className="rounded-[6px] text-xs bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A] font-medium shrink-0"
                >
                  QA: Under Review
                </Badge>
              ) : null}

              {/* Pending Creation Approval badge */}
              {isTaskPendingState && (
                <Badge
                  variant="outline"
                  size="compact"
                  className="rounded-[6px] text-xs bg-[#FFFBEB] text-[#92400E] border-[#FDE68A] flex items-center gap-1 shrink-0"
                  data-testid="task-detail-approval-badge"
                >
                  <Clock className="h-3 w-3" />
                  <span>Pending Creation Approval</span>
                </Badge>
              )}

              {/* Creation Rejected badge */}
              {isTaskRejectedState && (
                <Badge
                  variant="destructive"
                  size="compact"
                  className="rounded-[6px] text-xs bg-[#FEF2F2] text-[#DC2626] border-[#FCA5A5] flex items-center gap-1 shrink-0"
                  data-testid="task-detail-approval-badge"
                >
                  <XCircle className="h-3 w-3" />
                  <span>Creation Rejected</span>
                </Badge>
              )}
            </div>

            {/* Right side controls */}
            <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full pr-8">
              {/* Status Badge & Workflow Action Buttons */}
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={task.status === 'Completed' ? 'success' : 'secondary'}
                  size="compact"
                  className="rounded-[6px] text-xs font-semibold"
                  data-testid="task-status-badge"
                >
                  {task.status}
                </Badge>

                {canMutateStatus && (
                  <div className="flex flex-wrap items-center gap-1">
                    {task.status !== 'In Progress' && task.status !== 'Completed' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPhaseBlocked}
                        title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                        onClick={() => handleSetTaskStatus('In Progress')}
                        className="h-7 px-2.5 text-xs font-medium gap-1 rounded-[6px] border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#1E293B]"
                        data-testid="task-status-inprogress-btn"
                      >
                        <Clock className="h-3 w-3 text-[#64748B]" />
                        <span>Mark In Progress</span>
                      </Button>
                    )}

                    {task.status === 'Completed' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPhaseBlocked}
                        title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                        onClick={() => handleSetTaskStatus('In Progress')}
                        className="h-7 px-2.5 text-xs font-medium gap-1 rounded-[6px] border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#1E293B]"
                        data-testid="task-toggle-status-btn"
                      >
                        <CheckCircle2 className="h-3 w-3 text-[#16A34A]" />
                        <span>Mark In Progress</span>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        disabled={isPhaseBlocked || isPrereqBlocked || checklistCompletionBlocked}
                        title={
                          isPhaseBlocked
                            ? phaseBlockedTooltip
                            : isPrereqBlocked
                            ? prereqBlockedTooltip
                            : checklistCompletionBlocked
                            ? checklistCompletionReason
                            : undefined
                        }
                        onClick={() => handleSetTaskStatus('Completed')}
                        className="h-7 px-2.5 text-xs font-bold gap-1 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                        data-testid="task-toggle-status-btn"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Mark Completed</span>
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* Creation Review Approval Controls */}
              {isTaskPendingState && canLeadReview && (
                <div className="flex items-center gap-1.5" data-testid="task-detail-approval-controls">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs font-bold gap-1 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF]"
                    onClick={handleApproveTask}
                    data-testid="task-detail-approve-btn"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Approve Task</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs font-bold gap-1 rounded-[6px] border-[#DC2626] text-[#DC2626] hover:bg-[#FEF2F2]"
                    onClick={() => {
                      rejectIntent.current = { taskId: task.id, wrId: task.workRequestId || effectiveWrId || '', version: task.version ?? 1 };
                      setIsRejectModalOpen(true);
                    }}
                    data-testid="task-detail-reject-btn"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>Reject Task</span>
                  </Button>
                </div>
              )}
            </div>
          </DialogHeader>

          {/* 2-Column Workspace Body */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
            {/* LEFT MAIN PANE */}
            <div className="lg:overflow-y-auto p-6 space-y-6 bg-white min-w-0">
              {/* 1. Title & Banners */}
              <div className="space-y-3">
                <DialogTitle
                  className="text-xl font-bold text-[#0F172A] tracking-tight leading-snug"
                  data-testid="task-title"
                >
                  {task.title}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  Work Request: {workRequest ? `${workRequest.workRequestNumber || workRequest.work_request_number || (workRequest as unknown as { code?: string }).code || ''} ${workRequest.title}` : task.workRequestId}
                </DialogDescription>

                {isTaskRejectedState && (
                  <div
                    className="p-3.5 bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg space-y-2 text-xs"
                    data-testid="task-detail-rejection-banner"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-bold text-[#DC2626]">
                        <Lock className="h-4 w-4" />
                        <span>Task Creation Rejected</span>
                      </div>
                      {canResubmit && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="h-7 text-xs font-semibold gap-1.5 rounded-[6px] border-[#1D4ED8] text-[#1D4ED8] hover:bg-[#EFF6FF]"
                          onClick={() => setIsResubmitModalOpen(true)}
                          data-testid="task-resubmit-btn"
                        >
                          <Pencil className="h-3 w-3" />
                          <span>Edit & Resubmit Task</span>
                        </Button>
                      )}
                    </div>
                    <p className="text-[#991B1B] leading-relaxed">
                      <span className="font-semibold">Reason: </span>
                      {task.rejectionReason ?? (task as { rejection_reason?: string | null }).rejection_reason ?? 'No reason provided.'}
                    </p>
                    <div className="text-[11px] text-[#7F1D1D] flex items-center justify-between border-t border-[#FCA5A5]/60 pt-1.5">
                      <span>This task is locked against status changes, time logging, checklists, and document uploads until resubmitted and approved.</span>
                      {task.reviewedBy && <span>Reviewed by {task.reviewedBy}</span>}
                    </div>
                  </div>
                )}

                {isCompletedWr && (
                  <div
                    className="bg-[#F8FAFC] border border-[#E2E8F0] text-[#1E293B] text-xs px-3.5 py-2.5 rounded-lg flex items-center gap-2"
                    data-testid="completed-wr-lock-banner"
                  >
                    <Lock className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                    <span>Completed Work Request: Task records and attachments are finalized and locked.</span>
                  </div>
                )}

                {isPhaseBlocked && !isCompletedWr && (
                  <div
                    className="bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-xs px-3.5 py-2.5 rounded-lg flex items-center gap-2"
                    data-testid="phase-locked-banner"
                  >
                    <Lock className="h-3.5 w-3.5 text-[#D97706] shrink-0" />
                    <span>{phaseBlockedTooltip}</span>
                  </div>
                )}
              </div>

              {/* 2. Description Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#475569]">
                    Description
                  </h3>
                  {!isCompletedWr && canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        descriptionVersion.current = task.version ?? 1;
                        setIsEditingDesc(!isEditingDesc);
                      }}
                      className="h-6 px-2 text-[#475569] hover:text-[#1E293B] gap-1 rounded-[6px]"
                      title="Edit Task Description"
                      data-testid="edit-task-description-btn"
                    >
                      <Pencil className="h-3 w-3" />
                      <span className="text-xs font-medium">{isEditingDesc ? 'Cancel' : 'Edit'}</span>
                    </Button>
                  )}
                </div>

                {isEditingDesc ? (
                  <div className="space-y-2">
                    <textarea
                      value={descText}
                      onChange={(e) => setDescText(e.target.value)}
                      className="resize-none w-full p-3 border border-[#CBD5E1] bg-[#FFFFFF] rounded-lg text-xs text-[#1E293B] placeholder:text-[#64748B] focus:outline-none focus:ring-2 focus:ring-[#2563EB] min-h-[90px]"
                      placeholder="Enter task description or instructions..."
                      data-testid="task-description-textarea"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => {
                          setDescText(task.description || '');
                          setIsEditingDesc(false);
                        }}
                        className="h-7 text-xs rounded-[6px] border border-[#E2E8F0]"
                        data-testid="cancel-edit-description-btn"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="xs"
                        onClick={handleSaveDescription}
                        disabled={isSavingDesc}
                        className="h-7 text-xs rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs font-semibold"
                        data-testid="save-description-btn"
                      >
                        {isSavingDesc ? 'Saving...' : 'Save Changes'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="p-3.5 bg-[#FFFFFF] border border-[#E2E8F0] rounded-lg text-xs text-[#1E293B] whitespace-pre-wrap leading-relaxed min-h-[60px]"
                    data-testid="task-description"
                  >
                    {task.description || (
                      <span className="text-[#64748B] italic">No description provided for this task.</span>
                    )}
                  </div>
                )}
              </div>

              {/* 3. Jira-Style Attachments Section (placed directly below Description) */}
              <div className="space-y-2.5" data-testid="task-documents-section">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setAttachmentsOpen(!attachmentsOpen)}
                    aria-expanded={attachmentsOpen}
                    className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#475569] hover:text-[#0F172A] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                  >
                    {attachmentsOpen ? <ChevronDown className="h-4 w-4 text-[#64748B]" /> : <ChevronRight className="h-4 w-4 text-[#64748B]" />}
                    <span>Attachments</span>
                    <span className="ml-1 px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded bg-[#F1F5F9] text-[#475569] tabular-nums">
                      {linkedDocs.length}
                    </span>
                  </button>

                  {canUploadDoc && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isPhaseBlocked || isPrereqBlocked}
                      title={
                        isPhaseBlocked
                          ? phaseBlockedTooltip
                          : isPrereqBlocked
                            ? prereqBlockedTooltip
                            : undefined
                      }
                      onClick={() => setIsUploadDocModalOpen(true)}
                      className="text-xs gap-1 rounded-[6px] border border-[#E2E8F0] hover:bg-[#F8FAFC] font-medium"
                      data-testid="task-upload-doc-btn"
                    >
                      <Upload className="h-3 w-3" />
                      <span>Upload Document</span>
                    </Button>
                  )}
                </div>

                {attachmentsOpen && (
                  <>
                    {isLoadingDocs ? (
                      <div className="p-4 text-center text-xs text-[#64748B] bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
                        Loading linked documents...
                      </div>
                    ) : linkedDocs.length === 0 ? (
                      <div className="p-5 text-center text-xs text-[#64748B] bg-[#F8FAFC] rounded-lg border border-dashed border-[#CBD5E1] italic">
                        No documents linked to this task.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        {linkedDocs.map((doc) => {
                          const docName = doc.fileName || doc.file_name || doc.originalName || doc.original_name || 'Document';
                          return (
                            <div
                              key={doc.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedDoc(doc)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setSelectedDoc(doc);
                                }
                              }}
                              className="border border-[#E2E8F0] rounded-lg overflow-hidden bg-white hover:border-[#CBD5E1] hover:shadow-sm transition-all group cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                              data-testid={`linked-doc-item-${doc.id}`}
                            >
                              {/* Top Preview Area */}
                              <div className="h-24 bg-[#F8FAFC] border-b border-[#E2E8F0] relative flex flex-col items-center justify-center p-3 overflow-hidden group-hover:bg-[#F1F5F9]/50 transition-colors">
                                {/* Category pill */}
                                <span className="absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-white/90 border border-[#E2E8F0] text-[#475569] shadow-2xs">
                                  {doc.category || 'General'}
                                </span>

                                {/* Eye preview button */}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDoc(doc);
                                  }}
                                  title="Preview Document"
                                  className="absolute top-2 right-2 p-1 rounded-md bg-white/90 border border-[#E2E8F0] text-[#64748B] hover:text-[#0F172A] opacity-0 group-hover:opacity-100 transition-opacity shadow-2xs"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                {/* Miniature document page representation */}
                                <div className="w-12 h-14 bg-white rounded border border-[#E2E8F0] shadow-2xs flex flex-col items-center justify-center p-1.5 space-y-1">
                                  <FileText className="w-5 h-5 text-[#2563EB]" />
                                  <div className="w-8 h-0.5 bg-[#E2E8F0] rounded-full" />
                                  <div className="w-6 h-0.5 bg-[#E2E8F0] rounded-full" />
                                </div>
                              </div>

                              {/* Bottom Metadata Footer */}
                              <div className="p-2.5 bg-white space-y-0.5">
                                <p
                                  className="text-xs font-semibold text-[#1E293B] truncate group-hover:text-[#2563EB] transition-colors"
                                  title={docName}
                                >
                                  {docName}
                                </p>
                                <p className="text-[11px] text-[#64748B] font-mono tabular-nums truncate">
                                  {formatDocDate(doc)}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 4. Subtasks / Checklist Section */}
              <TaskChecklist
                key={task.id}
                items={task.checklist || []}
                canEdit={canEditChecklist}
                canComplete={canCompleteChecklist}
                ready={checklistReady}
                loading={isChecklistLoading}
                loadError={isTaskError}
                disabled={isPhaseBlocked}
                disabledReason={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                onRetry={() => { void refetchTask(); }}
                onChange={async (items) => {
                  if (isTaskError || isTaskPlaceholder || !Array.isArray(liveTask?.checklist) || !canEditChecklist || isPhaseBlocked) {
                    throw new Error('Reload the checklist before making changes.');
                  }
                  const updated = await updateTask({
                    workRequestId: task.workRequestId,
                    taskId: task.id,
                    data: { checklist: items.map(toChecklistInput), expectedVersion: task.version },
                  });
                  if (updated) onTaskUpdated?.(updated);
                }}
                onToggle={async (id, completed) => {
                  if (isTaskError || isTaskPlaceholder || !Array.isArray(liveTask?.checklist) || !canCompleteChecklist || isPhaseBlocked) {
                    throw new Error('Reload the checklist before making changes.');
                  }
                  const updated = await updateTask({
                    workRequestId: task.workRequestId, taskId: task.id,
                    data: { checklistCompletions: [{ id, completed }], expectedVersion: task.version },
                  });
                  if (updated) onTaskUpdated?.(updated);
                }}
              />

              {/* 5. Linked Financial & Transmittal Records */}
              <div className="space-y-2.5" data-testid="task-linked-records-section">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
                  <div className="flex items-center gap-2">
                    <LinkIcon className="h-4 w-4 text-[#1E293B]" />
                    <h4 className="text-xs font-bold uppercase tracking-wider text-[#1E293B]">
                      Linked Records ({invoices.length + disbursements.length + transmittals.length})
                    </h4>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {canLinkInv && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isInvoicePhaseBlocked || isPrereqBlocked}
                        title={
                          isInvoicePhaseBlocked
                            ? invoicePhaseBlockedTooltip
                            : isPrereqBlocked
                              ? prereqBlockedTooltip
                              : undefined
                        }
                        onClick={() => setIsInvoiceModalOpen(true)}
                        className="text-xs gap-1 rounded-[6px] border border-[#E2E8F0] hover:bg-[#F8FAFC]"
                        data-testid="link-invoice-btn"
                      >
                        <Receipt className="h-3 w-3" /> + Invoice
                      </Button>
                    )}
                    {canLinkDisb && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isPhaseBlocked || isPrereqBlocked}
                        title={
                          isPhaseBlocked
                            ? phaseBlockedTooltip
                            : isPrereqBlocked
                              ? prereqBlockedTooltip
                              : undefined
                        }
                        onClick={() => setIsDisbursementModalOpen(true)}
                        className="text-xs gap-1 rounded-[6px] border border-[#E2E8F0] hover:bg-[#F8FAFC]"
                        data-testid="link-disbursement-btn"
                      >
                        <CreditCard className="h-3 w-3" /> + Disbursement
                      </Button>
                    )}
                    {canLinkTrans && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={isPhaseBlocked || isPrereqBlocked}
                        title={
                          isPhaseBlocked
                            ? phaseBlockedTooltip
                            : isPrereqBlocked
                              ? prereqBlockedTooltip
                              : undefined
                        }
                        onClick={() => setIsTransmittalModalOpen(true)}
                        className="text-xs gap-1 rounded-[6px] border border-[#E2E8F0] hover:bg-[#F8FAFC]"
                        data-testid="link-transmittal-btn"
                      >
                        <Send className="h-3 w-3" /> + Transmittal
                      </Button>
                    )}
                  </div>
                </div>

                {isRelatedDenied ? (
                  <div
                    className="p-3 text-center text-xs text-[#DC2626] bg-[#FEF2F2] rounded-[8px] border border-[#FCA5A5]"
                    data-testid="linked-records-access-denied"
                  >
                    Records cannot be loaded. You are not assigned to this project.
                  </div>
                ) : invoices.length === 0 && disbursements.length === 0 && transmittals.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#64748B] bg-[#F8FAFC] rounded-[8px] border border-[#E2E8F0] italic">
                    No billing invoices, disbursements, or transmittals linked to this task.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Invoices */}
                    {invoices.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-bold tracking-normal text-[#475569] block">
                          Invoices ({invoices.length})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {invoices.map((inv) => {
                            const invTotal = inv.total != null ? inv.total : inv.amount;
                            const clientName =
                              inv.client_name ||
                              inv.clientName ||
                              inv.clients?.name ||
                              workRequest?.clientName ||
                              'Client';

                            return (
                              <a
                                key={inv.id}
                                href={`/billing?invoiceId=${inv.id}`}
                                className="p-2.5 bg-[#FFFFFF] border border-[#E2E8F0] hover:bg-[#F8FAFC] rounded-[6px] flex items-center justify-between gap-2 text-xs transition-colors"
                                data-testid={`linked-invoice-${inv.id}`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <Receipt className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                                  <div className="truncate">
                                    <span className="font-bold text-[#1E293B] block truncate">
                                      {inv.invoice_number || inv.invoiceNumber || 'Invoice'}
                                    </span>
                                    <span className="text-xs text-[#475569] block">
                                      {clientName}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {invTotal != null && (
                                    <span className="tabular-nums text-xs font-bold text-[#1E293B] font-mono">
                                      ₱{Number(invTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
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

                    {/* Disbursements */}
                    {disbursements.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-bold tracking-normal text-[#475569] block">
                          Disbursements ({disbursements.length})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {disbursements.map((d) => {
                            const disbNo = d.disbursement_number || d.disbursementNumber;
                            return (
                              <a
                                key={d.id}
                                href={`/disbursements?disbursementId=${d.id}`}
                                className="p-2.5 bg-[#FFFFFF] border border-[#E2E8F0] hover:bg-[#F8FAFC] rounded-[6px] flex items-center justify-between gap-2 text-xs transition-colors"
                                data-testid={`linked-disbursement-${d.id}`}
                              >
                                <div className="flex items-center gap-2 truncate">
                                  <CreditCard className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                                  <div className="truncate">
                                    {disbNo && (
                                      <span className="font-mono text-xs font-medium text-[#475569] tabular-nums block truncate">
                                        {disbNo}
                                      </span>
                                    )}
                                    <span className="font-bold text-[#1E293B] block truncate">
                                      {d.category || 'Disbursement'}
                                    </span>
                                    <span className="text-xs text-[#475569] block truncate">
                                      {d.description || 'No description'}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {d.amount != null && (
                                    <span className="tabular-nums text-xs font-bold text-[#1E293B] font-mono">
                                      ₱{Number(d.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                    </span>
                                  )}
                                  <ExternalLink className="h-3 w-3 text-[#475569]" />
                                </div>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Transmittals */}
                    {transmittals.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-xs font-bold tracking-normal text-[#475569] block">
                          Transmittals ({transmittals.length})
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {transmittals.map((t) => (
                            <a
                              key={t.id}
                              href={`/transmittals?transmittalId=${t.id}`}
                              className="p-2.5 bg-[#FFFFFF] border border-[#E2E8F0] hover:bg-[#F8FAFC] rounded-[6px] flex items-center justify-between gap-2 text-xs transition-colors"
                              data-testid={`linked-transmittal-${t.id}`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <Send className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                                <div className="truncate">
                                  <span className="font-bold text-[#1E293B] block truncate">
                                    {t.tracking_number || t.trackingNumber || 'Transmittal'}
                                  </span>
                                  <span className="text-xs text-[#475569] block truncate">
                                    {t.recipient_name || t.recipientName || 'Recipient'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {t.status && (
                                  <Badge variant="outline" size="compact" className="text-xs rounded-[8px] border-[#E2E8F0]">
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

              {/* 6. Activity / Work Log Section */}
              <div className="space-y-3" data-testid="task-time-logged-section">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-[#1E293B]" />
                    <h4 className="text-xs font-bold tracking-normal text-[#1E293B]">
                      Time Logged ({formatHours(totalMinutes)})
                    </h4>
                  </div>

                  {canLogTime && !showLogForm && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isPhaseBlocked}
                      title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                      onClick={() => setShowLogForm(true)}
                      className="text-xs gap-1 rounded-[6px] border border-[#CBD5E1] hover:bg-[#F8FAFC] font-medium"
                      data-testid="open-log-time-btn"
                    >
                      <Plus className="h-3 w-3" /> Log Time
                    </Button>
                  )}
                </div>

                {/* Quick Log Time Form */}
                {canLogTime && showLogForm && (
                  <form
                    onSubmit={handleLogTimeSubmit}
                    className="p-4 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[6px] space-y-3 text-xs"
                    data-testid="log-time-form"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#1E293B] tracking-normal">Record Time Spent</span>
                      <button
                        type="button"
                        onClick={() => setShowLogForm(false)}
                        className="text-[#475569] hover:text-[#1E293B] text-xs underline"
                      >
                        Cancel
                      </button>
                    </div>

                    {logError && (
                      <div className="p-2 bg-[#FFFFFF] border-2 border-[#FCA5A5] text-[#DC2626] text-xs flex items-center gap-1.5 font-bold">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{logError}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-bold uppercase text-[#475569] block mb-1">
                          Date
                        </label>
                        <DateInput
                          aria-label="Time log date"
                          type="date"
                          max={workDate()}
                          value={logDate}
                          onValueChange={(value) => setLogDate(value)}
                          className="h-8 text-xs bg-[#FFFFFF] border-[#CBD5E1] rounded-[6px]"
                          required
                          data-testid="log-time-date-input"
                        />
                      </div>

                      <div>
                        <label className="text-xs font-bold uppercase text-[#475569] block mb-1">
                          Duration (Minutes)
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Input
                            type="number"
                            aria-label="Duration in minutes"
                            min={1}
                            max={1440}
                            step={1}
                            value={logMinutes}
                            onChange={(e) => setLogMinutes(e.target.value)}
                            className="h-8 text-xs bg-[#FFFFFF] border-[#CBD5E1] rounded-[6px] w-24"
                            required
                            data-testid="log-time-minutes-input"
                          />
                          <div className="flex items-center gap-1">
                            {[15, 30, 60, 120].map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setLogMinutes(String(preset))}
                                className={`px-2 py-0.5 rounded-[6px] text-xs border transition-colors ${
                                  Number(logMinutes) === preset
                                    ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#1D4ED8] font-bold'
                                    : 'bg-[#FFFFFF] text-[#1E293B] border-[#CBD5E1] hover:bg-[#E2E8F0]'
                                }`}
                              >
                                {preset}m
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase text-[#475569] block mb-1">
                        Work Note / Activity Description
                      </label>
                      <Input
                        type="text"
                        placeholder="e.g., Reviewed and indexed source document"
                        value={logNote}
                        onChange={(e) => setLogNote(e.target.value)}
                        className="h-8 text-xs bg-[#FFFFFF] border-[#CBD5E1] rounded-[6px]"
                        data-testid="log-time-note-input"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => setShowLogForm(false)}
                        className="text-xs rounded-[6px] border border-[#E2E8F0]"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        size="xs"
                        disabled={createTimeEntryMutation.isPending}
                        className="text-xs font-semibold rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                        data-testid="log-time-submit-btn"
                      >
                        {createTimeEntryMutation.isPending ? 'Saving...' : 'Save Time Entry'}
                      </Button>
                    </div>
                  </form>
                )}

                {/* Time Entries List */}
                {timeEntryError && <p role="alert" className="text-xs text-[#DC2626]">{timeEntryError}</p>}
                {isLoadingTime ? (
                  <div className="p-3 text-center text-xs text-[#64748B] bg-[#F8FAFC] rounded-[8px] border border-[#E2E8F0]">
                    Loading time entries...
                  </div>
                ) : timeEntries.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#64748B] bg-[#F8FAFC] rounded-[8px] border border-[#E2E8F0] italic">
                    No time recorded on this task yet. Click &quot;Log Time&quot; to add duration.
                  </div>
                ) : (
                  <div className="border border-[#E2E8F0] rounded-[6px] overflow-hidden bg-[#FFFFFF]">
                    <div className="divide-y divide-[#CBD5E1] max-h-48 overflow-y-auto">
                      {timeEntries.map((entry) => (
                        <TaskTimeEntry
                          key={entry.id}
                          onDeleteError={setTimeEntryError}
                          entry={{
                            ...entry,
                            userName: entry.userName || (entry.userId === currentUser?.id ? currentUser.name : null),
                            userRole: entry.userRole || (entry.userId === currentUser?.id ? currentUser.role : null),
                          }}
                          canManage={hasPermission(permissions, 'timelog:edit_all') ||
                            (entry.userId === currentUser?.id && hasPermission(permissions, 'timelog:edit_own'))}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT DETAILS SIDEBAR */}
            <div className="bg-[#F8FAFC] border-t lg:border-t-0 lg:border-l border-[#E2E8F0] lg:overflow-y-auto p-5 space-y-4 flex flex-col justify-between min-w-0">
              {/* Top Group */}
              <div className="space-y-4">
                {/* Blocker alert if completion is blocked */}
                {task.status !== 'Completed' && canMutateStatus && (isPhaseBlocked || isPrereqBlocked || (checklistReady && uncheckedChecklistCount > 0)) && (
                  <div className="text-[11px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg p-2.5 flex items-start gap-1.5 leading-snug">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#B45309] mt-0.5" />
                    <span>
                      {isPhaseBlocked
                        ? phaseBlockedTooltip
                        : isPrereqBlocked
                        ? prereqBlockedTooltip
                        : checklistCompletionReason}
                    </span>
                  </div>
                )}

                {/* Collapsible Details Card */}
                <div className="bg-white border border-[#E2E8F0] rounded-lg overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    onClick={() => setDetailsOpen(!detailsOpen)}
                    aria-expanded={detailsOpen}
                    className="w-full px-4 py-2.5 bg-[#F8FAFC] border-b border-[#E2E8F0] flex items-center justify-between text-left hover:bg-[#F1F5F9] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
                  >
                    <span className="text-xs font-bold uppercase tracking-wider text-[#475569]">Details</span>
                    {detailsOpen ? <ChevronDown className="h-3.5 w-3.5 text-[#64748B]" /> : <ChevronRight className="h-3.5 w-3.5 text-[#64748B]" />}
                  </button>

                  {detailsOpen && (
                    <div className="p-4 space-y-4 text-xs">
                      {/* Assigned Team Section */}
                      <div className="space-y-3" data-testid="assigned-team-section">
                        {/* Visible Header Row */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-[#475569]">Assigned Team</span>
                          <span
                            className="text-[11px] font-bold text-[#FFFFFF] bg-[#1D4ED8] px-1.5 py-0.5 rounded tabular-nums"
                            data-testid="assigned-team-count"
                          >
                            {assignedTeamMembers.length}
                          </span>
                        </div>

                        {/* Visible Single Unified Vertical Team List */}
                        <div data-testid="assigned-team-list">
                          {assignedTeamMembers.length === 0 ? (
                            <div className="flex items-center gap-2 p-2 rounded-md bg-[#F8FAFC] border border-[#E2E8F0]">
                              <UserAvatar name="?" size="xs" shape="circle" className="h-6 w-6 text-[10px] shrink-0" />
                              <span className="text-xs text-[#64748B] italic" data-testid="task-assignee">Unassigned</span>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {assignedTeamMembers.map((member) => (
                                <div
                                  key={member.id}
                                  data-testid={`assignee-chip-${member.id}`}
                                  className="flex items-center justify-between gap-2 p-1.5 rounded-md border bg-[#F8FAFC] border-[#E2E8F0] hover:border-[#CBD5E1] transition-colors group"
                                >
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <UserAvatar
                                      userId={member.id}
                                      name={member.name}
                                      size="xs"
                                      shape="circle"
                                      className="h-6 w-6 text-[10px] shrink-0"
                                    />
                                    <div className="min-w-0 flex-1 flex items-center gap-1.5">
                                      <span className="font-semibold text-xs text-[#1E293B] truncate" data-testid={member.isLead ? 'task-assignee' : undefined}>{member.name}</span>
                                      {member.isLead ? (
                                        <Badge size="compact" className="bg-[#1D4ED8] text-[#FFFFFF] text-[10px] font-semibold rounded px-1.5 py-0 shrink-0">
                                          Lead
                                        </Badge>
                                      ) : member.role ? (
                                        <span className="text-[10px] text-[#64748B] shrink-0">({member.role})</span>
                                      ) : null}
                                    </div>
                                  </div>

                                  {canEdit && (
                                    <div className="flex items-center gap-1 shrink-0">
                                      {!member.isLead && (
                                        <button
                                          type="button"
                                          onClick={() => handleSetLeadAssignee(member.id)}
                                          className="text-[10px] font-semibold text-[#1D4ED8] hover:bg-[#EFF6FF] px-1.5 py-0.5 rounded transition-colors"
                                          title="Make primary assignee"
                                          data-testid={`make-lead-btn-${member.id}`}
                                        >
                                          Make Lead
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveAssignee(member.id)}
                                        className="text-[#64748B] hover:text-[#DC2626] p-0.5 rounded transition-colors"
                                        title={`Remove ${member.name}`}
                                        data-testid={`remove-assignee-btn-${member.id}`}
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Simplified, Compact Assignment Controls */}
                        {canEdit && (
                          <div className="grid grid-cols-2 gap-1.5 pt-1">
                            {/* Reassign Lead Select */}
                            {scopedTeamList.length > 0 && (
                              <div data-testid="reassign-lead-container">
                                <Select
                                  key={`reassign-${reassignSelectKey}`}
                                  onValueChange={(val) => handleSetLeadAssignee(val)}
                                >
                                  <SelectTrigger
                                    className="h-7 text-xs bg-[#FFFFFF] hover:bg-[#F8FAFC] border-[#CBD5E1] rounded-[6px] text-[#1E293B] w-full"
                                    data-testid="reassign-lead-select"
                                    aria-label="Reassign lead"
                                  >
                                    <SelectValue placeholder={task.assigneeId ? "Change Lead..." : "Assign Lead..."} />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                                    {scopedTeamList.map((m) => (
                                      <SelectItem key={m.id} value={m.id} className="text-xs">
                                        {m.name} {m.id === task.assigneeId ? '(Lead)' : `(${m.role})`}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}

                            {/* Add Member Select */}
                            <div
                              data-testid="assign-employee-container"
                              className={scopedTeamList.length === 0 ? "col-span-2" : ""}
                            >
                              {availableTeamMembers.length > 0 ? (
                                <Select
                                  key={`add-${addSelectKey}`}
                                  onValueChange={(val) => handleAddCoAssignee(val)}
                                >
                                  <SelectTrigger
                                    className="h-7 text-xs bg-[#F8FAFC] hover:bg-[#E2E8F0] border-[#CBD5E1] rounded-[6px] text-[#1E293B] font-medium w-full"
                                    data-testid="assign-employee-select"
                                    aria-label="Add team member"
                                  >
                                    <SelectValue placeholder="+ Add Member..." />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                                    {availableTeamMembers.map((m) => (
                                      <SelectItem key={m.id} value={m.id} className="text-xs">
                                        {m.name} ({m.role})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Select disabled>
                                  <SelectTrigger
                                    className="h-7 text-xs bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-[#64748B] w-full"
                                    data-testid="assign-employee-select"
                                    aria-label="Add team member"
                                  >
                                    <SelectValue placeholder="All assigned" />
                                  </SelectTrigger>
                                  <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]" />
                                </Select>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Due Date row */}
                      <div className="space-y-1 border-t border-[#E2E8F0] pt-3">
                        <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                          Due Date
                        </span>
                        <div className="font-medium text-[#1E293B]">
                          {canEdit ? (
                            <div className="w-full min-w-0">
                              <DateInput
                                aria-label="Task due date"
                                type="date"
                                value={
                                  localDueDate
                                    ? localDueDate.includes('T')
                                      ? new Date(localDueDate).toISOString().split('T')[0]
                                      : localDueDate
                                    : ''
                                }
                                onValueChange={(value) => {
                                  const val = value || null;
                                  setLocalDueDate(val);
                                  if (task.workRequestId) {
                                    updateTask({
                                      workRequestId: task.workRequestId,
                                      taskId: task.id,
                                      data: { dueDate: val, expectedVersion: task.version },
                                    })
                                      .then((res) => {
                                        if (res && onTaskUpdated) {
                                          onTaskUpdated(res as Task);
                                        }
                                      })
                                      .catch(() => {
                                        setLocalDueDate(task.dueDate ?? null);
                                      });
                                  }
                                }}
                                className="h-8 w-full text-xs font-mono tabular-nums bg-[#FFFFFF] border-[#CBD5E1] rounded-[6px]"
                                data-testid="task-due-date-input"
                              />
                              {!localDueDate && <span className="sr-only">Not set</span>}
                            </div>
                          ) : (
                            <span className="font-mono tabular-nums text-xs">
                              {localDueDate
                                ? new Date(localDueDate).toLocaleDateString()
                                : 'Not set'}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Phase & Phase Status */}
                      <div className="space-y-1.5 border-t border-[#E2E8F0] pt-3">
                        <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                          Phase & Lifecycle
                        </span>
                        {(() => {
                          const phaseInfo = getPhaseBadgeInfo(task.phase);
                          const PHASES_ORDER = ['pre_processing', 'processing', 'quality_assurance', 'completion'];
                          const currentWrPhaseIndex = PHASES_ORDER.indexOf(workRequest?.phase || 'pre_processing');
                          const taskPhaseIndex = PHASES_ORDER.indexOf(task.phase);
                          const isTaskActivePhase = !workRequest?.phase || task.phase === workRequest.phase;
                          const isTaskPastPhase = taskPhaseIndex < currentWrPhaseIndex;

                          return (
                            <div className="space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] text-xs font-semibold border ${phaseInfo.badgeClass}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${phaseInfo.dotClass}`} />
                                  <phaseInfo.Icon className="w-3.5 h-3.5 shrink-0" />
                                  <span>{phaseInfo.label}</span>
                                </span>

                                {isTaskActivePhase ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#93C5FD]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#2563EB] animate-pulse" />
                                    <span>Active Phase</span>
                                  </span>
                                ) : isTaskPastPhase ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#F0FDF4] text-[#166534] border border-[#BBF7D0]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#16A34A]" />
                                    <span>Phase Completed (Locked)</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-xs font-medium bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[#D97706]" />
                                    <span>Upcoming Phase (Locked)</span>
                                  </span>
                                )}
                              </div>

                              <div className="text-[11px] text-[#64748B] font-mono tabular-nums flex items-center gap-1">
                                <Clock className="w-3 h-3 text-[#94A3B8]" />
                                {task.phaseEnteredAt ? (
                                  <span>Entered: {new Date(task.phaseEnteredAt).toLocaleDateString()}</span>
                                ) : (
                                  <span className="sr-only"> • N/A</span>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Parent Work Request */}
                      <div className="space-y-1 border-t border-[#E2E8F0] pt-3">
                        <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                          Parent Work Request
                        </span>
                        <p className="text-xs text-[#1E293B]">
                          {workRequest ? (
                            <span className="font-medium text-[#475569]">{workRequest.clientName || 'Parent Workspace'}</span>
                          ) : (
                            <span className="font-mono tabular-nums">{task.workRequestId}</span>
                          )}
                        </p>
                      </div>

                      {/* Predecessors */}
                      {task.predecessors && task.predecessors.length > 0 && (
                        <div className="space-y-1.5 border-t border-[#E2E8F0] pt-3">
                          <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                            Prerequisites ({task.predecessors.length})
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {task.predecessors.map((pId) => {
                              const detail = (task as unknown as { predecessorDetails?: Array<{ id: string; title: string; status: string }> })
                                .predecessorDetails?.find((d) => d.id === pId);
                              const predTask = siblingTasks.find((t) => t.id === pId);
                              const title = detail?.title || predTask?.title || pId.slice(0, 8);
                              const isDone = (detail?.status || predTask?.status) === 'Completed';

                              return (
                                <Badge key={pId} variant="outline" size="compact" className="text-xs rounded border-[#CBD5E1] gap-1 font-normal">
                                  <span>{isDone ? '✓' : '⏳'}</span>
                                  <span className="font-medium truncate max-w-[140px]">{title}</span>
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Total Logged Time */}
                      <div className="space-y-1 border-t border-[#E2E8F0] pt-3">
                        <span className="text-[11px] font-semibold text-[#64748B] uppercase tracking-wider block">
                          Total Logged Time
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-[#2563EB]" />
                          <span className="font-mono font-bold text-[#0F172A] tabular-nums text-sm">
                            {formatHours(totalMinutes)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Bottom Sidebar Footer */}
              <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-between gap-2 shrink-0">
                <div className="text-[11px] font-mono text-[#64748B] tabular-nums truncate">
                  <span title={`Task ID: ${task.id}`}>ID: {task.id.slice(0, 8)}...</span>
                  {task.phaseEnteredAt && (
                    <span className="ml-2 hidden sm:inline">
                      Phase: {new Date(task.phaseEnteredAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  className="text-xs rounded-[6px] border border-[#CBD5E1] bg-white hover:bg-[#F1F5F9] text-[#1E293B] shrink-0 font-medium"
                  data-testid="task-close-btn"
                >
                  Close
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 1. Invoice Create Modal (UAT2-7) */}
      {isInvoiceModalOpen && task && (
        <InvoiceCreateModal
          isOpen={isInvoiceModalOpen}
          onClose={() => {
            setIsInvoiceModalOpen(false);
            refetchRelated();
            if (task.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
          onCreated={() => {
            setIsInvoiceModalOpen(false);
            refetchRelated();
            if (task.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
          prefill={{
            workRequestId: task.workRequestId || workRequest?.id,
            taskId: task.id,
            clientId: workRequest?.clientId || undefined,
          }}
        />
      )}

      {/* 2. Disbursement Create Modal (UAT2-7) */}
      {isDisbursementModalOpen && task && (
        <CreateDisbursementModal
          isOpen={isDisbursementModalOpen}
          onClose={() => {
            setIsDisbursementModalOpen(false);
            refetchRelated();
            if (task.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
          onSuccess={() => {
            setIsDisbursementModalOpen(false);
            refetchRelated();
            if (task.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
          prefill={{
            workRequestId: task.workRequestId || workRequest?.id,
            taskId: task.id,
            clientId: workRequest?.clientId || undefined,
          }}
        />
      )}

      {/* 3. Transmittal Form Modal (UAT2-7) */}
      {isTransmittalModalOpen && task && (
        <TransmittalFormModal
          isOpen={isTransmittalModalOpen}
          onClose={() => {
            setIsTransmittalModalOpen(false);
            refetchRelated();
            if (task.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
          prefill={{
            workRequestId: task.workRequestId || workRequest?.id,
            taskId: task.id,
            clientId: workRequest?.clientId || undefined,
          }}
        />
      )}

      {/* 4. Document Upload Modal (UAT2-11) */}
      {isUploadDocModalOpen && task && (
        <DocumentUploadModal
          isOpen={isUploadDocModalOpen}
          onClose={() => {
            setIsUploadDocModalOpen(false);
            if (task.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
          defaultWorkRequestId={task.workRequestId || workRequest?.id}
          defaultClientId={workRequest?.clientId || undefined}
          defaultTaskId={task.id}
          allowTaskLinking={true}
          onSuccess={() => {
            setIsUploadDocModalOpen(false);
            refetchDocs();
            void queryClient.invalidateQueries({
              queryKey: operationsKeys.documents(),
            });
            if (task.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
        />
      )}

      {/* 5. Linked Document Viewer Modal */}
      {selectedDoc && (
        <DocumentViewerModal
          isOpen={Boolean(selectedDoc)}
          onClose={() => {
            setSelectedDoc(null);
            refetchDocs();
            void queryClient.invalidateQueries({ queryKey: operationsKeys.documents() });
            if (task?.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
          document={selectedDoc}
          workRequest={workRequest}
          onUploadSuccess={(updatedDoc) => {
            setSelectedDoc(updatedDoc);
            refetchDocs();
            void queryClient.invalidateQueries({ queryKey: operationsKeys.documents() });
            if (task?.id) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(task.id) });
            }
          }}
        />
      )}
      {/* 6. Task Creation Rejection Modal */}
      {isRejectModalOpen && task && (
        <RejectReasonModal
          isOpen={isRejectModalOpen}
          requestId={task.id}
          workRequestTitle={workRequest?.title}
          title="Reject Task Creation"
          description="Provide a required explanation for why this task creation is being rejected."
          submitLabel="Reject Task"
          successTitle="Task Rejected"
          successMessage="The task creation has been rejected."
          onClose={() => setIsRejectModalOpen(false)}
          onReject={async (taskId, reason) => {
            const intent = rejectIntent.current;
            if (!intent || intent.taskId !== taskId || intent.wrId !== (effectiveWrId || task.workRequestId)) {
              throw new Error('Task review context changed. Reopen the task to review it.');
            }
            const wrId = intent.wrId;
            const updated = await approveOrRejectTaskCreation({
              workRequestId: wrId,
              taskId,
              decision: 'reject',
              reason,
              expectedVersion: intent.version,
            });
            onTaskUpdated?.(updated);
          }}
          invalidateQueries={[
            operationsKeys.tasks(effectiveWrId || task.workRequestId || ''),
            operationsKeys.taskDetail(effectiveWrId || task.workRequestId || '', task.id),
            operationsKeys.workRequestDetail(effectiveWrId || task.workRequestId || ''),
          ]}
        />
      )}

      {/* 7. Task Resubmit Modal */}
      {isResubmitModalOpen && task && (
        <TaskResubmitModal
          isOpen={isResubmitModalOpen}
          task={task}
          workRequest={workRequest}
          onSuccess={(updated) => {
            onTaskUpdated?.(updated);
            setIsResubmitModalOpen(false);
          }}
          onClose={() => setIsResubmitModalOpen(false)}
        />
      )}
    </>
  );
}
