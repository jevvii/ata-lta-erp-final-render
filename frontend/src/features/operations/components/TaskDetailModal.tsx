import { workDate } from '@/lib/workDate';
import { DateInput } from '@/components/ui/date-input';
import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  CheckSquare,
  User,
  Users,
  Plus,
  CheckCircle2,
  AlertCircle,
  FileQuestion,
  Eye,
  Layers,
  Receipt,
  CreditCard,
  Send,
  Upload,
  ExternalLink,
  Link as LinkIcon,
  X,
  Pencil,
  Lock,
} from 'lucide-react';
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
import { useCreateOperationsRequest, useOperationsRequests } from '../api/usePhaseTransitions';
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
  canRequestInvoice,
  canRequestTransmittal,
  isUserAdmin,
  filterTaskRelatedRecords,
} from '../lib/taskScope';
import { runBlockingAction } from './BlockingActionModal';
import { operationsKeys } from '../api/queryKeys';
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
    isPlaceholderData: isTaskPlaceholder,
    error: taskError,
  } = useTaskDetail(effectiveWrId, effectiveTaskId, {
    enabled: Boolean(effectiveWrId && effectiveTaskId && isOpen && !isScopeStale),
  });

  const isTaskDetailErrorDenied = Boolean(
    isTaskError &&
      ((taskError as { status?: number })?.status === 403 ||
        (taskError as { status?: number })?.status === 404 ||
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
      ((relatedError as { status?: number })?.status === 403 ||
        (relatedError as { status?: number })?.status === 404 ||
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

  const liveTask = Array.isArray(rawLiveTask)
    ? rawLiveTask.find((t) => t?.id === effectiveTaskId) || rawLiveTask[0]
    : rawLiveTask;

  // Support restored membership on fresh successful authorized read (Directive 2):
  // When genuinely fresh, non-null matching task data arrives without error, clear the denied latch.
  useEffect(() => {
    if (
      liveTask &&
      liveTask.id === effectiveTaskId &&
      !isTaskError &&
      !isTaskPlaceholder &&
      deniedScope
    ) {
      setDeniedScope(null);
      void refetchRelated();
    }
  }, [liveTask, effectiveTaskId, isTaskError, isTaskPlaceholder, deniedScope, refetchRelated]);

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
  const [logMinutes, setLogMinutes] = useState<number>(30);
  const [logNote, setLogNote] = useState('');
  const [showLogForm, setShowLogForm] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // Selected document for preview
  const [selectedDoc, setSelectedDoc] = useState<DmsDocument | null>(null);

  // Key state to reset select dropdowns after an action
  const [addSelectKey, setAddSelectKey] = useState(0);
  const [reassignSelectKey, setReassignSelectKey] = useState(0);
  const [newChecklistText, setNewChecklistText] = useState('');

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
  const { updateTask } = useTaskMutations(task?.workRequestId || '');

  const permissions = useSessionStore((state) => state.permissions);
  const isAdmin = isUserAdmin(currentUser);
  const isCompletedWr = workRequest?.status === 'Completed';
  const canEdit = !isCompletedWr && hasPermission(permissions, 'workflow:edit');

  // Task description editing state (OA.5)
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descText, setDescText] = useState(task?.description || '');
  const [isSavingDesc, setIsSavingDesc] = useState(false);

  useEffect(() => {
    setDescText(task?.description || '');
  }, [task?.description]);

  const handleSaveDescription = async () => {
    if (!task || !task.workRequestId) return;
    setIsSavingDesc(true);
    try {
      const res = await updateTask({
        workRequestId: task.workRequestId,
        taskId: task.id,
        data: { description: descText.trim() || null },
      });
      if (res && onTaskUpdated) {
        onTaskUpdated(res as Task);
      }
      setIsEditingDesc(false);
    } catch (err) {
      console.error('Failed to update task description:', err);
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
    return siblingTasks.filter((t) => predIds.has(t.id) && t.status !== 'Completed');
  }, [task?.predecessors, siblingTasks]);

  const isPrereqBlocked = incompletePredecessors.length > 0;
  const prereqBlockedTooltip = isPrereqBlocked
    ? `Blocked by prerequisite task(s): ${incompletePredecessors.map((p) => p.title).join(', ')}`
    : undefined;

  // Task B.4: Client-side phase gate for non-active phases
  const isPhaseBlocked = Boolean(
    workRequest?.phase && task?.phase && task.phase !== workRequest.phase
  );
  const phaseBlockedTooltip = isPhaseBlocked
    ? `Task is locked because the Work Request is currently in the ${getPhaseBadgeInfo(workRequest?.phase).label} phase.`
    : undefined;

  // Check pending operations requests for this task
  const { data: rawPendingReqs } = useOperationsRequests(
    {
      linkedTaskId: task?.id,
      status: 'pending',
    },
    { enabled: Boolean(task?.id && !isTaskDenied && !isScopeStale) }
  );
  const pendingReqs = useMemo(() => {
    if (Array.isArray(rawPendingReqs)) return rawPendingReqs;
    if (
      rawPendingReqs &&
      typeof rawPendingReqs === 'object' &&
      'data' in rawPendingReqs &&
      Array.isArray((rawPendingReqs as { data: unknown[] }).data)
    ) {
      return (rawPendingReqs as { data: Array<{ id: string; type: string }> }).data;
    }
    return [];
  }, [rawPendingReqs]);

  const hasPendingInvoiceReq = pendingReqs.some((r) => r.type === 'billing');
  const hasPendingTransmittalReq = pendingReqs.some((r) => r.type === 'transmittal');

  const createRequestMutation = useCreateOperationsRequest();

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
    if (Array.isArray(task?.taskAssignees)) {
      task.taskAssignees.forEach((ta) => {
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
      const isLead = id === leadId;
      members.push({
        id,
        name: found?.name || (isLead && task.assigneeName ? task.assigneeName : `Staff (${id.slice(0, 8)})`),
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
  // 1. Only assigned employee or Admin can mutate status, log time, upload docs
  const canMutateStatus = !isCompletedWr && canMutateTaskStatus(currentUser, task);
  const canLogTime = !isCompletedWr && hasPermission(permissions, 'timelog:create') && canLogTaskTime(currentUser, task);
  const canUploadDoc = !isCompletedWr && canUploadTaskDocument(currentUser, task);

  // 2. Financial record linking vs requesting:
  const canLinkInv = !isCompletedWr && canLinkInvoice(currentUser, task, workRequest, siblingTasks) && canCreateInvoice;
  const canLinkTrans = !isCompletedWr && canLinkTransmittal(currentUser, task, workRequest, siblingTasks) && canCreateTransmittal;
  const canLinkDisb = !isCompletedWr && canLinkDisbursement(currentUser, task, canCreateDisbursement);

  const canReqInv = !isCompletedWr && canRequestInvoice(currentUser, task, workRequest, siblingTasks);
  const canReqTrans = !isCompletedWr && canRequestTransmittal(currentUser, task, workRequest, siblingTasks);

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

  // Handle requesting billing invoice from accounting
  const handleRequestInvoice = async () => {
    if (!task || !task.workRequestId) return;
    await runBlockingAction({
      title: 'Requesting Invoice',
      message: `Submitting request to Accounting for task "${task.title}"...`,
      apiCall: async () => {
        return await createRequestMutation.mutateAsync({
          type: 'billing',
          workRequestId: task.workRequestId,
          linkedTaskId: task.id,
          clientId: workRequest?.clientId || undefined,
          notes: `Invoice requested for task "${task.title}"`,
        });
      },
      successTitle: 'Invoice Requested',
      successMessage: 'Invoice request has been queued for Accounting review.',
      invalidateQueries: [operationsKeys.requests()],
    });
  };

  // Handle requesting transmittal from documentation
  const handleRequestTransmittal = async () => {
    if (!task || !task.workRequestId) return;
    await runBlockingAction({
      title: 'Requesting Transmittal',
      message: `Submitting request to Documentation for task "${task.title}"...`,
      apiCall: async () => {
        return await createRequestMutation.mutateAsync({
          type: 'transmittal',
          workRequestId: task.workRequestId,
          linkedTaskId: task.id,
          clientId: workRequest?.clientId || undefined,
          notes: `Transmittal requested for task "${task.title}"`,
        });
      },
      successTitle: 'Transmittal Requested',
      successMessage: 'Transmittal request has been queued for Documentation review.',
      invalidateQueries: [operationsKeys.requests()],
    });
  };

  const handleToggleChecklist = async (itemId: string, completed: boolean) => {
    if (!task || !task.workRequestId) return;
    const currentList = task.checklist || [];
    const updated = currentList.map((c) =>
      c.id === itemId ? { ...c, completed } : c
    );
    await updateTask({
      workRequestId: task.workRequestId,
      taskId: task.id,
      data: {
        checklist: updated.map((c) => ({
          id: c.id,
          text: c.text,
          completed: c.completed,
          category: c.category,
          periodYear: c.periodYear ? String(c.periodYear) : null,
          dependsOn: c.dependsOn || null,
        })),
      },
    });
  };

  const handleAddChecklistItem = async () => {
    if (!newChecklistText.trim() || !task || !task.workRequestId) return;
    const currentList = task.checklist || [];
    const generateChecklistId = (): string => {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    };

    const newItem = {
      id: generateChecklistId(),
      text: newChecklistText.trim(),
      completed: false,
    };
    await updateTask({
      workRequestId: task.workRequestId,
      taskId: task.id,
      data: {
        checklist: [...currentList, newItem].map((c) => ({
          id: c.id,
          text: c.text,
          completed: c.completed,
        })),
      },
    });
    setNewChecklistText('');
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
    if (!Number.isInteger(logMinutes) || logMinutes < 1 || logMinutes > 1440) {
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
        durationMinutes: Number(logMinutes),
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
          className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float"
          data-testid="task-detail-modal"
        >
          {/* Header */}
          <DialogHeader className="px-6 py-4 pr-14 border-b border-[#E2E8F0] bg-[#F8FAFC] flex flex-row flex-wrap gap-3 items-start justify-between">
            <div className="space-y-1.5 pr-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={workRequest?.entity === 'LTA' ? 'lta' : 'ata'}
                  size="compact"
                  className="rounded-[6px] text-xs"
                >
                  {workRequest?.entity || 'ATA'}
                </Badge>
                {(() => {
                  const phaseInfo = getPhaseBadgeInfo(task.phase);
                  const PHASES_ORDER = ['pre_processing', 'processing', 'quality_assurance', 'completion'];
                  const currentWrPhaseIndex = PHASES_ORDER.indexOf(workRequest?.phase || 'pre_processing');
                  const taskPhaseIndex = PHASES_ORDER.indexOf(task.phase);
                  const isTaskActivePhase = !workRequest?.phase || task.phase === workRequest.phase;
                  const isTaskPastPhase = taskPhaseIndex < currentWrPhaseIndex;

                  return (
                    <>
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] text-xs font-semibold border ${phaseInfo.badgeClass}`}>
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
                    </>
                  );
                })()}
                <Badge
                  variant={task.status === 'Completed' ? 'success' : 'secondary'}
                  size="compact"
                  className="rounded-[6px] text-xs"
                  data-testid="task-status-badge"
                >
                  {task.status}
                </Badge>
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
                          data: { requiredLinkType: nextVal },
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
                {task.qaStatus === 'passed' || task.qaStatus === 'failed' ? (
                  <Badge
                    variant={task.qaStatus === 'passed' ? 'success' : 'destructive'}
                    size="compact"
                    className="rounded-[6px] text-xs"
                  >
                    QA: {task.qaStatus}
                  </Badge>
                ) : workRequest?.phase === 'quality_assurance' ? (
                  <Badge
                    variant="secondary"
                    size="compact"
                    className="rounded-[6px] text-xs bg-[#FFFBEB] text-[#92400E] border border-[#FDE68A]"
                  >
                    QA: Under Review
                  </Badge>
                ) : null}
              </div>
              <DialogTitle
                className="text-lg font-bold text-[#1E293B] leading-tight"
                data-testid="task-title"
              >
                {task.title}
              </DialogTitle>
              {workRequest && (
                <p className="text-xs text-[#475569]">
                  Work Request: <span className="font-semibold text-[#1E293B]">{workRequest.title}</span>
                </p>
              )}
            </div>

            {canMutateStatus && (
              <div className="flex items-center gap-2 shrink-0">
                {task.status !== 'In Progress' && task.status !== 'Completed' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPhaseBlocked}
                    title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                    onClick={() => handleSetTaskStatus('In Progress')}
                    className="text-xs gap-1.5 rounded-[8px] border-[#E2E8F0] hover:bg-[#FFFFFF]"
                    data-testid="task-status-inprogress-btn"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    Mark In Progress
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
                    className="text-xs shrink-0 gap-1.5 rounded-[8px] border-[#E2E8F0] hover:bg-[#FFFFFF]"
                    data-testid="task-toggle-status-btn"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark In Progress
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={isPhaseBlocked || isPrereqBlocked}
                    title={
                      isPhaseBlocked
                        ? phaseBlockedTooltip
                        : isPrereqBlocked
                        ? prereqBlockedTooltip
                        : undefined
                    }
                    onClick={() => handleSetTaskStatus('Completed')}
                    className="text-xs shrink-0 gap-1.5 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                    data-testid="task-toggle-status-btn"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Mark Completed
                  </Button>
                )}
              </div>
            )}
          </DialogHeader>

          {/* Modal Body: Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#FFFFFF]">
            {isCompletedWr && (
              <div
                className="bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B] text-xs px-3 py-2 rounded-[6px] flex items-center gap-2"
                data-testid="completed-wr-lock-banner"
              >
                <Lock className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                <span>Completed Work Request: Task records and attachments are finalized and locked.</span>
              </div>
            )}
            {isPhaseBlocked && !isCompletedWr && (
              <div
                className="bg-[#FFFBEB] border border-[#FDE68A] text-[#92400E] text-xs px-3 py-2 rounded-[6px] flex items-center gap-2"
                data-testid="phase-locked-banner"
              >
                <Lock className="h-3.5 w-3.5 text-[#D97706] shrink-0" />
                <span>{phaseBlockedTooltip}</span>
              </div>
            )}

            {/* 1. Meta Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(11rem,1.2fr)] lg:grid-cols-[minmax(0,1fr)_minmax(11rem,1.2fr)_minmax(0,1.2fr)_minmax(0,1fr)] gap-3.5 p-3.5 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-xs">
              <div className="min-w-0">
                <span className="text-xs uppercase font-bold text-[#475569] block mb-0.5">
                  Primary Assignee
                </span>
                <div
                  className="flex items-center gap-1.5 font-medium text-[#1E293B] truncate min-w-0"
                  data-testid="task-assignee"
                >
                  <User className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                  <span className="truncate">{task.assigneeName || 'Unassigned'}</span>
                </div>
                {assignedTeamMembers.length > 1 && (
                  <span className="text-xs text-[#475569] font-medium mt-0.5 block truncate">
                    +{assignedTeamMembers.length - 1} co-assignee{assignedTeamMembers.length > 2 ? 's' : ''}
                  </span>
                )}
              </div>

              <div className="min-w-0">
                <span className="text-xs uppercase font-bold text-[#475569] block mb-0.5">
                  Due Date
                </span>
                <div className="flex items-center gap-1.5 font-medium text-[#1E293B] min-w-0 truncate">
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
                              data: { dueDate: val },
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
                        className="h-8 w-full text-xs tabular-nums bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]"
                        data-testid="task-due-date-input"
                      />
                      {!localDueDate && <span className="sr-only">Not set</span>}
                    </div>
                  ) : (
                    <span className="truncate">
                      {localDueDate
                        ? new Date(localDueDate).toLocaleDateString()
                        : 'Not set'}
                    </span>
                  )}
                </div>
              </div>

              <div className="min-w-0">
                <span className="text-xs uppercase font-bold text-[#475569] block mb-0.5">
                  Phase Entered
                </span>
                <div className="flex items-center gap-1.5 font-medium text-[#1E293B] min-w-0 truncate">
                  <Clock className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                  <span className="capitalize truncate">
                    {task.phase?.replace('_', ' ')}
                    {task.phaseEnteredAt ? (
                      ` • ${new Date(task.phaseEnteredAt).toLocaleDateString()}`
                    ) : (
                      <span className="sr-only"> • N/A</span>
                    )}
                  </span>
                </div>
              </div>

              <div className="min-w-0">
                <span className="text-xs uppercase font-bold text-[#475569] block mb-0.5">
                  Total Logged Time
                </span>
                <div className="flex items-center gap-1.5 font-bold text-[#1E293B] min-w-0 truncate">
                  <Clock className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                  <span className="truncate">{formatHours(totalMinutes)}</span>
                </div>
              </div>
            </div>

            {/* 2. Assigned Team & Co-Assignees */}
            <div className="p-4 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] space-y-3" data-testid="assigned-team-section">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B] rounded-[6px]">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold tracking-normal text-[#1E293B] flex items-center gap-1.5">
                      Assigned Team
                      <span className="text-xs font-bold text-[#FFFFFF] bg-[#1D4ED8] px-1.5 py-0.5 rounded-[6px] tabular-nums" data-testid="assigned-team-count">
                        {assignedTeamMembers.length}
                      </span>
                    </h4>
                    <p className="text-xs text-[#475569]">
                      Primary assignee and co-assignees working on this task
                    </p>
                  </div>
                </div>

                {canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Reassign Lead Select */}
                    {scopedTeamList.length > 0 && (
                      <div className="w-40 sm:w-44" data-testid="reassign-lead-container">
                        <Select
                          key={`reassign-${reassignSelectKey}`}
                          onValueChange={(val) => handleSetLeadAssignee(val)}
                        >
                          <SelectTrigger
                            className="h-7 text-xs bg-[#FFFFFF] hover:bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-[#1E293B]"
                            data-testid="reassign-lead-select"
                          >
                            <SelectValue placeholder="Select Primary Assignee..." />
                          </SelectTrigger>
                          <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                            {scopedTeamList.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.name} {m.id === task.assigneeId ? '(Primary)' : `(${m.role})`}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Add Co-Assignee Select */}
                    {availableTeamMembers.length > 0 ? (
                      <div className="w-40 sm:w-44" data-testid="assign-employee-container">
                        <Select
                          key={`add-${addSelectKey}`}
                          onValueChange={(val) => handleAddCoAssignee(val)}
                        >
                          <SelectTrigger
                            className="h-7 text-xs bg-[#F8FAFC] hover:bg-[#E2E8F0] border-[#E2E8F0] rounded-[6px] text-[#1E293B] font-semibold"
                            data-testid="assign-employee-select"
                          >
                            <SelectValue placeholder="+ Add Co-Assignee..." />
                          </SelectTrigger>
                          <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                            {availableTeamMembers.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.name} ({m.role})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="w-40 sm:w-44" data-testid="assign-employee-container">
                        <Select disabled>
                          <SelectTrigger
                            className="h-7 text-xs bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-[#475569]"
                            data-testid="assign-employee-select"
                          >
                            <SelectValue placeholder="All team assigned" />
                          </SelectTrigger>
                          <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]" />
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Members Chips / Cards */}
              {assignedTeamMembers.length === 0 ? (
                <div className="py-3 text-center text-xs text-[#475569] italic">
                  No team members assigned yet. Use the dropdown above to assign a primary or co-assignee.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-1" data-testid="assigned-team-list">
                  {assignedTeamMembers.map((member) => (
                    <div
                      key={member.id}
                      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] border text-xs ${
                        member.isLead
                          ? 'bg-[#F8FAFC] border-[#E2E8F0] text-[#1E293B]'
                          : 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B]'
                      }`}
                      data-testid={`assignee-chip-${member.id}`}
                    >
                      <User className="h-3.5 w-3.5 text-[#1E293B]" />
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs">{member.name}</span>
                        {member.isLead ? (
                          <Badge size="compact" className="bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs font-semibold text-xs rounded-[6px]">
                            Primary
                          </Badge>
                        ) : (
                          <Badge variant="outline" size="compact" className="text-xs rounded-[8px] border-[#E2E8F0] text-[#475569]">
                            {member.role === 'Admin' || member.name === 'Lorein Wong' ? 'Admin' : (member.role || 'Co-Assignee')}
                          </Badge>
                        )}
                      </div>

                      {canEdit && (
                        <div className="flex items-center gap-1.5 ml-1 pl-1.5 border-l border-[#E2E8F0]">
                          {!member.isLead && (
                            <button
                              type="button"
                              onClick={() => handleSetLeadAssignee(member.id)}
                              className="text-xs text-[#1E293B] hover:underline font-bold px-1"
                              title="Make this member the primary assignee"
                              data-testid={`make-lead-btn-${member.id}`}
                            >
                              Make Primary
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveAssignee(member.id)}
                            className="text-[#475569] hover:text-[#DC2626] p-0.5 rounded-[6px] transition-colors"
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

            {/* 3. Description / Requirements */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold tracking-normal text-[#475569]">
                  Description & Instructions
                </h4>
                {!isCompletedWr && canEdit && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setIsEditingDesc(!isEditingDesc)}
                    className="h-6 px-1.5 text-[#475569] hover:text-[#1E293B] gap-1 rounded-[6px]"
                    title="Edit Task Description"
                    data-testid="edit-task-description-btn"
                  >
                    <Pencil className="h-3 w-3" />
                    <span className="text-xs">{isEditingDesc ? 'Cancel' : 'Edit'}</span>
                  </Button>
                )}
              </div>

              {isEditingDesc ? (
                <div className="space-y-2">
                  <textarea
                    value={descText}
                    onChange={(e) => setDescText(e.target.value)}
                    className="w-full p-2.5 border-[#E2E8F0] bg-[#FFFFFF] rounded-[6px] text-xs text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8] min-h-[80px]"
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
                      className="h-7 text-xs rounded-[8px] border-[#E2E8F0]"
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
                      className="h-7 text-xs rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                      data-testid="save-description-btn"
                    >
                      {isSavingDesc ? 'Saving...' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  className="p-3.5 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B] whitespace-pre-wrap leading-relaxed min-h-[60px]"
                  data-testid="task-description"
                >
                  {task.description || (
                    <span className="text-[#475569] italic">No description provided for this task.</span>
                  )}
                </div>
              )}
            </div>

            {/* 3. Checklist Items */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold tracking-normal text-[#475569] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5" />
                  Checklist ({task.checklist?.filter((c) => c.completed).length || 0}/{task.checklist?.length || 0})
                </span>
              </h4>

              {task.checklist && task.checklist.length > 0 ? (
                <div className="p-2 border-[#E2E8F0] rounded-[6px] divide-y divide-[#CBD5E1] bg-[#FFFFFF]">
                  {task.checklist.map((item) => (
                    <div key={item.id} className="py-2 px-2 flex items-center justify-between text-xs">
                      <label className="flex items-center gap-2 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={() => handleToggleChecklist(item.id, !item.completed)}
                          disabled={!canEdit || isPhaseBlocked}
                          title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                          className="rounded-[6px] accent-[#1D4ED8] text-[#1E293B] cursor-pointer"
                        />
                        <span className={item.completed ? 'line-through text-[#475569]' : 'text-[#1E293B] font-medium'}>
                          {item.text}
                        </span>
                      </label>
                      {item.assigneeName && (
                        <span className="text-xs text-[#475569]">{item.assigneeName}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-center text-xs text-[#475569] bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] italic">
                  No checklist items yet.
                </div>
              )}

              {canEdit && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    placeholder="Add a new checklist item..."
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    disabled={isPhaseBlocked}
                    title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklistItem();
                      }
                    }}
                    className="h-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]"
                  />
                  <Button
                    type="button"
                    size="xs"
                    onClick={handleAddChecklistItem}
                    disabled={!newChecklistText.trim() || isPhaseBlocked}
                    title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                    className="h-8 text-xs gap-1 rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              )}
            </div>

            {/* 4. Predecessors */}
            {task.predecessors && task.predecessors.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold tracking-normal text-[#475569] flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  Predecessors
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {task.predecessors.map((pId) => {
                    const detail = (task as unknown as { predecessorDetails?: Array<{ id: string; title: string; status: string }> })
                      .predecessorDetails?.find((d) => d.id === pId);
                    const predTask = siblingTasks.find((t) => t.id === pId);
                    const title = detail?.title || predTask?.title || pId.slice(0, 8);
                    const status = detail?.status || predTask?.status;

                    return (
                      <Badge key={pId} variant="outline" size="compact" className="text-xs rounded-[8px] border-[#E2E8F0] gap-1">
                        <span className="font-semibold">{title}</span>
                        {status && (
                          <span className="text-xs text-[#475569]">({status})</span>
                        )}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 5. Linked Documents Section */}
            <div className="space-y-2.5" data-testid="task-documents-section">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold tracking-normal text-[#475569] flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Linked Documents ({linkedDocs.length})
                </h4>
                {canUploadDoc && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={isPhaseBlocked}
                    title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                    onClick={() => setIsUploadDocModalOpen(true)}
                    className="text-xs gap-1 rounded-[8px] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                    data-testid="task-upload-doc-btn"
                  >
                    <Upload className="h-3 w-3" /> Upload Document
                  </Button>
                )}
              </div>

              {isLoadingDocs ? (
                <div className="p-4 text-center text-xs text-[#475569] bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0]">
                  Loading linked documents...
                </div>
              ) : linkedDocs.length === 0 ? (
                <div className="p-4 text-center text-xs text-[#475569] bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] italic">
                  No documents linked to this task.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {linkedDocs.map((doc) => {
                    const docName = doc.fileName || doc.file_name || doc.originalName || 'Document';
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setSelectedDoc(doc)}
                        className="p-2.5 bg-[#FFFFFF] border-[#E2E8F0] hover:bg-[#F8FAFC] rounded-[6px] flex items-center justify-between gap-2 cursor-pointer transition-colors"
                        data-testid={`linked-doc-item-${doc.id}`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileQuestion className="h-4 w-4 text-[#1E293B] shrink-0" />
                          <div className="truncate">
                            <span className="text-xs font-bold text-[#1E293B] block truncate">
                              {docName}
                            </span>
                            <span className="text-xs text-[#475569] block">
                              {doc.category || 'General'}
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-[#475569] hover:text-[#1E293B] rounded-[6px]"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Linked Records Section (UAT2-7) */}
            <div className="space-y-2.5" data-testid="task-linked-records-section">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-[#1E293B]" />
                  <h4 className="text-xs font-bold tracking-normal text-[#1E293B]">
                    Linked Records ({invoices.length + disbursements.length + transmittals.length})
                  </h4>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {canLinkInv && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isPhaseBlocked}
                      title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                      onClick={() => setIsInvoiceModalOpen(true)}
                      className="text-xs gap-1 rounded-[8px] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                      data-testid="link-invoice-btn"
                    >
                      <Receipt className="h-3 w-3" /> + Invoice
                    </Button>
                  )}
                  {canReqInv && invoices.length === 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={handleRequestInvoice}
                      disabled={hasPendingInvoiceReq || isPhaseBlocked}
                      title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                      className="text-xs gap-1 rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#1E293B]"
                      data-testid="request-invoice-btn"
                    >
                      <Receipt className="h-3 w-3" />
                      {hasPendingInvoiceReq ? 'Invoice Requested' : 'Request Invoice'}
                    </Button>
                  )}
                  {canLinkDisb && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={isPhaseBlocked}
                      title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                      onClick={() => setIsDisbursementModalOpen(true)}
                      className="text-xs gap-1 rounded-[8px] border-[#E2E8F0] hover:bg-[#F8FAFC]"
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
                      disabled={isPhaseBlocked}
                      title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                      onClick={() => setIsTransmittalModalOpen(true)}
                      className="text-xs gap-1 rounded-[8px] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                      data-testid="link-transmittal-btn"
                    >
                      <Send className="h-3 w-3" /> + Transmittal
                    </Button>
                  )}
                  {canReqTrans && transmittals.length === 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={handleRequestTransmittal}
                      disabled={hasPendingTransmittalReq || isPhaseBlocked}
                      title={isPhaseBlocked ? phaseBlockedTooltip : undefined}
                      className="text-xs gap-1 rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] hover:bg-[#E2E8F0] text-[#1E293B]"
                      data-testid="request-transmittal-btn"
                    >
                      <Send className="h-3 w-3" />
                      {hasPendingTransmittalReq ? 'Transmittal Requested' : 'Request Transmittal'}
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
                <div className="p-3 text-center text-xs text-[#475569] bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] italic">
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
                              className="p-2.5 bg-[#FFFFFF] border-[#E2E8F0] hover:bg-[#F8FAFC] rounded-[6px] flex items-center justify-between gap-2 text-xs transition-colors"
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
                                  <span className="tabular-nums text-xs font-bold text-[#1E293B]">
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
                        {disbursements.map((d) => (
                          <a
                            key={d.id}
                            href={`/disbursements?disbursementId=${d.id}`}
                            className="p-2.5 bg-[#FFFFFF] border-[#E2E8F0] hover:bg-[#F8FAFC] rounded-[6px] flex items-center justify-between gap-2 text-xs transition-colors"
                            data-testid={`linked-disbursement-${d.id}`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <CreditCard className="h-3.5 w-3.5 text-[#1E293B] shrink-0" />
                              <div className="truncate">
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
                                <span className="tabular-nums text-xs font-bold text-[#1E293B]">
                                  ₱{Number(d.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                              )}
                              <ExternalLink className="h-3 w-3 text-[#475569]" />
                            </div>
                          </a>
                        ))}
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
                            className="p-2.5 bg-[#FFFFFF] border-[#E2E8F0] hover:bg-[#F8FAFC] rounded-[6px] flex items-center justify-between gap-2 text-xs transition-colors"
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

            {/* 6. Time Logged Summary & Quick Log Entry */}
            <div className="space-y-3 tabular-nums" data-testid="task-time-logged-section">
              <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2">
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
                    className="text-xs gap-1 rounded-[8px] border-[#E2E8F0] hover:bg-[#F8FAFC]"
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
                  className="p-4 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] space-y-3 text-xs"
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
                        className="h-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]"
                        required
                        data-testid="log-time-date-input"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase text-[#475569] block mb-1">
                        Duration (Minutes)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={1}
                          step={5}
                          value={logMinutes}
                          onChange={(e) => setLogMinutes(Number(e.target.value))}
                          className="h-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] w-24"
                          required
                          data-testid="log-time-minutes-input"
                        />
                        <div className="flex items-center gap-1">
                          {[15, 30, 60, 120].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setLogMinutes(preset)}
                              className={`px-2 py-0.5 rounded-[6px] text-xs  border transition-colors ${
                                logMinutes === preset
                                  ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs border-[#E2E8F0] font-bold'
                                  : 'bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] hover:bg-[#E2E8F0]'
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
                      className="h-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px]"
                      data-testid="log-time-note-input"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowLogForm(false)}
                      className="text-xs rounded-[8px] border-[#E2E8F0]"
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
              {isLoadingTime ? (
                <div className="p-3 text-center text-xs text-[#475569] bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0]">
                  Loading time entries...
                </div>
              ) : timeEntries.length === 0 ? (
                <div className="p-3 text-center text-xs text-[#475569] bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] italic">
                  No time recorded on this task yet. Click &quot;Log Time&quot; to add duration.
                </div>
              ) : (
                <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden bg-[#FFFFFF]">
                  <div className="divide-y divide-[#CBD5E1] max-h-48 overflow-y-auto">
                    {timeEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-2.5 flex items-center justify-between text-xs hover:bg-[#F8FAFC] transition-colors"
                        data-testid={`time-entry-item-${entry.id}`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-[#1E293B]">
                              {formatHours(entry.durationMinutes)}
                            </span>
                            <span className="text-xs text-[#475569]">
                              {entry.entryDate}
                            </span>
                          </div>
                          {entry.note && (
                            <p className="text-xs text-[#475569] line-clamp-1">{entry.note}</p>
                          )}
                        </div>
                        <Badge variant="outline" size="compact" className="text-xs rounded-[8px] border-[#E2E8F0]">
                          {entry.durationMinutes} min
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <DialogFooter className="px-6 py-3 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
            <span className="text-xs text-[#475569]">
              Task ID: {task.id}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] hover:bg-[#E2E8F0] text-[#1E293B]"
              data-testid="task-close-btn"
            >
              Close
            </Button>
          </DialogFooter>
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
    </>
  );
}
