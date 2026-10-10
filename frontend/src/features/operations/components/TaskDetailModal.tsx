import React, { useState, useMemo } from 'react';
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
  Calendar,
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
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useTimeEntriesList, useCreateTimeEntry } from '@/features/dashboard/api/useTimeEntries';
import { InvoiceCreateModal } from '@/features/billing';
import { CreateDisbursementModal } from '@/features/disbursements';
import { TransmittalFormModal } from '@/features/transmittals';
import { DocumentUploadModal, DocumentViewerModal } from '@/features/documents';
import { useDocuments } from '../api/useDocuments';
import { useTaskMutations, useTaskRelated, useWorkRequestTasks } from '../api/useTasks';
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
} from '../lib/taskScope';
import { runBlockingAction } from './BlockingActionModal';
import { operationsKeys } from '../api/queryKeys';
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
  task,
  workRequest,
  onTaskUpdated,
}: TaskDetailModalProps) {
  // Time logging form state
  const [logDate, setLogDate] = useState(() => new Date().toISOString().split('T')[0]);
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

  // Time entries for this task
  const { data: timeEntries = [], isLoading: isLoadingTime } = useTimeEntriesList(
    task?.id ? { taskId: task.id } : undefined
  );

  // Documents linked to this work request / task
  const { data: rawDocs, isLoading: isLoadingDocs, refetch: refetchDocs } = useDocuments(
    task?.workRequestId ? { workRequestId: task.workRequestId } : undefined,
    { enabled: Boolean(task?.workRequestId) }
  );

  const linkedDocs: DmsDocument[] = useMemo(() => {
    const docs = Array.isArray(rawDocs) ? rawDocs : rawDocs?.data ?? [];
    if (!task) return docs;
    // Return docs explicitly linked to this task or all WR docs if none specific
    const taskSpecific = docs.filter(
      (d) => d.linkedTaskId === task.id || d.linked_task_id === task.id
    );
    return taskSpecific.length > 0 ? taskSpecific : docs;
  }, [rawDocs, task]);

  // Mutations
  const createTimeEntryMutation = useCreateTimeEntry();
  const { updateTask } = useTaskMutations(task?.workRequestId || '');

  const queryClient = useQueryClient();
  const permissions = useSessionStore((state) => state.permissions);
  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = isUserAdmin(currentUser);
  const canEdit = hasPermission(permissions, 'workflow:edit');

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
    enabled: Boolean(task?.workRequestId),
  });
  const siblingTasks = siblingTasksData || [];

  // Check pending operations requests for this task
  const { data: rawPendingReqs } = useOperationsRequests(
    {
      linkedTaskId: task?.id,
      status: 'pending',
    },
    { enabled: Boolean(task?.id) }
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

  // Linked records query (UAT2-7)
  const { data: relatedRecords, refetch: refetchRelated } = useTaskRelated(task?.id);
  const invoices = relatedRecords?.invoices || [];
  const disbursements = relatedRecords?.disbursements || [];
  const transmittals = relatedRecords?.transmittals || [];

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
  const canMutateStatus = canMutateTaskStatus(currentUser, task);
  const canLogTime = canLogTaskTime(currentUser, task);
  const canUploadDoc = canUploadTaskDocument(currentUser, task);

  // 2. Financial record linking vs requesting:
  const canLinkInv = canLinkInvoice(currentUser, task, workRequest, siblingTasks) && canCreateInvoice;
  const canLinkTrans = canLinkTransmittal(currentUser, task, workRequest, siblingTasks) && canCreateTransmittal;
  const canLinkDisb = canLinkDisbursement(currentUser, task, canCreateDisbursement);

  const canReqInv = canRequestInvoice(currentUser, task, workRequest, siblingTasks);
  const canReqTrans = canRequestTransmittal(currentUser, task, workRequest, siblingTasks);

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

  // Handle setting task status (UAT2-9-frontend)
  const handleSetTaskStatus = async (nextStatus: TaskStatus) => {
    if (!task || !task.workRequestId) return;

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
    if (logMinutes <= 0) {
      setLogError('Duration must be greater than 0 minutes.');
      return;
    }
    setLogError(null);

    try {
      await createTimeEntryMutation.mutateAsync({
        taskId: task.id,
        entryDate: logDate || new Date().toISOString().split('T')[0]!,
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

  if (!task) return null;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden"
          data-testid="task-detail-modal"
        >
          {/* Header */}
          <DialogHeader className="px-6 py-4 pr-14 border-b border-slate-200 bg-slate-50 flex flex-row items-start justify-between">
            <div className="space-y-1.5 pr-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={workRequest?.entity === 'LTA' ? 'lta' : 'ata'}
                  size="compact"
                >
                  {workRequest?.entity || 'ATA'}
                </Badge>
                <Badge variant="outline" size="compact" className="font-semibold text-blue-700 bg-blue-50">
                  {task.phase.replace('_', ' ')}
                </Badge>
                <Badge
                  variant={task.status === 'Completed' ? 'success' : 'secondary'}
                  size="compact"
                  data-testid="task-status-badge"
                >
                  {task.status}
                </Badge>
                {task.qaStatus && (
                  <Badge
                    variant={task.qaStatus === 'passed' ? 'success' : 'destructive'}
                    size="compact"
                  >
                    QA: {task.qaStatus}
                  </Badge>
                )}
              </div>
              <DialogTitle
                className="text-lg font-bold text-slate-900 leading-tight"
                data-testid="task-title"
              >
                {task.title}
              </DialogTitle>
              {workRequest && (
                <p className="text-xs text-slate-500">
                  Work Request: <span className="font-medium text-slate-700">{workRequest.title}</span>
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
                    onClick={() => handleSetTaskStatus('In Progress')}
                    className="text-xs gap-1.5"
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
                    onClick={() => handleSetTaskStatus('In Progress')}
                    className="text-xs shrink-0 gap-1.5"
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
                    onClick={() => handleSetTaskStatus('Completed')}
                    className="text-xs shrink-0 gap-1.5"
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
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* 1. Meta Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                  Lead Assignee
                </span>
                <div
                  className="flex items-center gap-1.5 font-medium text-slate-800 truncate"
                  data-testid="task-assignee"
                >
                  <User className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{task.assigneeName || 'Unassigned'}</span>
                </div>
                {assignedTeamMembers.length > 1 && (
                  <span className="text-[10px] text-slate-500 font-medium mt-0.5 block truncate">
                    +{assignedTeamMembers.length - 1} co-assignee{assignedTeamMembers.length > 2 ? 's' : ''}
                  </span>
                )}
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                  Due Date
                </span>
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  {canEdit ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="date"
                        value={task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''}
                        onChange={(e) => {
                          updateTask({
                            workRequestId: task.workRequestId || '',
                            taskId: task.id,
                            data: { dueDate: e.target.value || null },
                          });
                        }}
                        className="text-xs bg-transparent border-b border-dashed border-slate-300 focus:outline-none focus:border-blue-500 py-0.5"
                        data-testid="task-due-date-input"
                      />
                      {!task.dueDate && <span className="text-slate-400 text-xs">Not set</span>}
                    </div>
                  ) : (
                    <span>
                      {task.dueDate
                        ? new Date(task.dueDate).toLocaleDateString()
                        : 'Not set'}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                  Phase Entered
                </span>
                <div className="flex items-center gap-1.5 font-medium text-slate-800">
                  <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  <span>
                    {task.phaseEnteredAt
                      ? new Date(task.phaseEnteredAt).toLocaleDateString()
                      : (workRequest?.phaseEnteredAt
                          ? new Date(workRequest.phaseEnteredAt).toLocaleDateString()
                          : 'N/A')}
                  </span>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
                  Total Logged Time
                </span>
                <div className="flex items-center gap-1.5 font-bold text-blue-700">
                  <Clock className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                  <span>{formatHours(totalMinutes)}</span>
                </div>
              </div>
            </div>

            {/* 2. Assigned Team & Co-Assignees */}
            <div className="p-4 bg-white border border-slate-200 rounded-lg space-y-3" data-testid="assigned-team-section">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-blue-50 text-blue-700 rounded-md">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                      Assigned Team
                      <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full" data-testid="assigned-team-count">
                        {assignedTeamMembers.length}
                      </span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Primary lead assignee and co-assignees working on this task
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
                            className="h-7 text-xs bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700"
                            data-testid="reassign-lead-select"
                          >
                            <SelectValue placeholder="Reassign Lead..." />
                          </SelectTrigger>
                          <SelectContent>
                            {scopedTeamList.map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.name} {m.id === task.assigneeId ? '(Lead)' : `(${m.role})`}
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
                            className="h-7 text-xs bg-blue-50/70 hover:bg-blue-50 border-blue-200 text-blue-800 font-medium"
                            data-testid="assign-employee-select"
                          >
                            <SelectValue placeholder="+ Add Co-Assignee..." />
                          </SelectTrigger>
                          <SelectContent>
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
                            className="h-7 text-xs bg-slate-50 border-slate-200 text-slate-400 font-medium"
                            data-testid="assign-employee-select"
                          >
                            <SelectValue placeholder="All team assigned" />
                          </SelectTrigger>
                          <SelectContent />
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Members Chips / Cards */}
              {assignedTeamMembers.length === 0 ? (
                <div className="py-3 text-center text-xs text-slate-400 italic">
                  No team members assigned yet. Use the dropdown above to assign a lead or co-assignee.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-1" data-testid="assigned-team-list">
                  {assignedTeamMembers.map((member) => (
                    <div
                      key={member.id}
                      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs ${
                        member.isLead
                          ? 'bg-blue-50/80 border-blue-200 text-blue-900 shadow-xs'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                      data-testid={`assignee-chip-${member.id}`}
                    >
                      <User className={`h-3.5 w-3.5 ${member.isLead ? 'text-blue-600' : 'text-slate-400'}`} />
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-xs">{member.name}</span>
                        {member.isLead ? (
                          <Badge size="compact" className="bg-blue-600 text-white font-medium text-[10px]">
                            Lead
                          </Badge>
                        ) : (
                          <Badge variant="outline" size="compact" className="text-[10px] text-slate-500">
                            {member.role === 'Admin' || member.name === 'Lorein Wong' ? 'Admin' : (member.role || 'Co-Assignee')}
                          </Badge>
                        )}
                      </div>

                      {canEdit && (
                        <div className="flex items-center gap-1.5 ml-1 pl-1.5 border-l border-slate-200">
                          {!member.isLead && (
                            <button
                              type="button"
                              onClick={() => handleSetLeadAssignee(member.id)}
                              className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline font-medium px-1"
                              title="Make this member the lead assignee"
                              data-testid={`make-lead-btn-${member.id}`}
                            >
                              Make Lead
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveAssignee(member.id)}
                            className="text-slate-400 hover:text-red-600 p-0.5 rounded transition-colors"
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
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Description & Instructions
              </h4>
              <div
                className="p-3.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 whitespace-pre-wrap leading-relaxed min-h-[60px]"
                data-testid="task-description"
              >
                {task.description || (
                  <span className="text-slate-400 italic">No description provided for this task.</span>
                )}
              </div>
            </div>

            {/* 3. Checklist Items */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5" />
                  Checklist ({task.checklist?.filter((c) => c.completed).length || 0}/{task.checklist?.length || 0})
                </span>
              </h4>

              {task.checklist && task.checklist.length > 0 ? (
                <div className="p-2 border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
                  {task.checklist.map((item) => (
                    <div key={item.id} className="py-2 px-2 flex items-center justify-between text-xs">
                      <label className="flex items-center gap-2 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={() => handleToggleChecklist(item.id, !item.completed)}
                          disabled={!canEdit}
                          className="rounded text-blue-600 cursor-pointer"
                        />
                        <span className={item.completed ? 'line-through text-slate-400' : 'text-slate-700 font-medium'}>
                          {item.text}
                        </span>
                      </label>
                      {item.assigneeName && (
                        <span className="text-[10px] text-slate-400">{item.assigneeName}</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-200 italic">
                  No checklist items yet.
                </div>
              )}

              {canEdit && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    placeholder="Add a new checklist item..."
                    value={newChecklistText}
                    onChange={(e) => setNewChecklistText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddChecklistItem();
                      }
                    }}
                    className="h-8 text-xs bg-white"
                  />
                  <Button
                    type="button"
                    size="xs"
                    onClick={handleAddChecklistItem}
                    disabled={!newChecklistText.trim()}
                    className="h-8 text-xs gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              )}
            </div>

            {/* 4. Predecessors */}
            {task.predecessors && task.predecessors.length > 0 && (
              <div className="space-y-1.5">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  Predecessors
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {task.predecessors.map((pId) => {
                    const predTask = siblingTasks.find((t) => t.id === pId);
                    return (
                      <Badge key={pId} variant="outline" size="compact" className="text-[10px] gap-1">
                        <span className="font-semibold">{predTask?.title || pId.slice(0, 8)}</span>
                        {predTask?.status && (
                          <span className="text-[9px] text-slate-500">({predTask.status})</span>
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
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Linked Documents ({linkedDocs.length})
                </h4>
                {canUploadDoc && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setIsUploadDocModalOpen(true)}
                    className="text-xs gap-1"
                    data-testid="task-upload-doc-btn"
                  >
                    <Upload className="h-3 w-3" /> Upload Document
                  </Button>
                )}
              </div>

              {isLoadingDocs ? (
                <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-200">
                  Loading linked documents...
                </div>
              ) : linkedDocs.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-200 italic">
                  No documents linked to this work request or task.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {linkedDocs.map((doc) => {
                    const docName = doc.fileName || doc.file_name || doc.originalName || 'Document';
                    return (
                      <div
                        key={doc.id}
                        onClick={() => setSelectedDoc(doc)}
                        className="p-2.5 bg-white border border-slate-200 hover:border-blue-400 hover:shadow-2xs rounded-lg flex items-center justify-between gap-2 cursor-pointer transition-all"
                        data-testid={`linked-doc-item-${doc.id}`}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileQuestion className="h-4 w-4 text-blue-600 shrink-0" />
                          <div className="truncate">
                            <span className="text-xs font-medium text-slate-800 block truncate">
                              {docName}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              {doc.category || 'General'}
                            </span>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="shrink-0 text-slate-400 hover:text-blue-600"
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
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <LinkIcon className="h-4 w-4 text-slate-500" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Linked Records ({invoices.length + disbursements.length + transmittals.length})
                  </h4>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {canLinkInv && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setIsInvoiceModalOpen(true)}
                      className="text-xs gap-1"
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
                      disabled={hasPendingInvoiceReq}
                      className="text-xs gap-1 text-blue-700 bg-blue-50/50 hover:bg-blue-50 border-blue-200"
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
                      onClick={() => setIsDisbursementModalOpen(true)}
                      className="text-xs gap-1"
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
                      onClick={() => setIsTransmittalModalOpen(true)}
                      className="text-xs gap-1"
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
                      disabled={hasPendingTransmittalReq}
                      className="text-xs gap-1 text-purple-700 bg-purple-50/50 hover:bg-purple-50 border-purple-200"
                      data-testid="request-transmittal-btn"
                    >
                      <Send className="h-3 w-3" />
                      {hasPendingTransmittalReq ? 'Transmittal Requested' : 'Request Transmittal'}
                    </Button>
                  )}
                </div>
              </div>

              {invoices.length === 0 && disbursements.length === 0 && transmittals.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-200 italic">
                  No billing invoices, disbursements, or transmittals linked to this task.
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Invoices */}
                  {invoices.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Invoices ({invoices.length})
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {invoices.map((inv) => (
                          <a
                            key={inv.id}
                            href={`/billing?invoiceId=${inv.id}`}
                            className="p-2.5 bg-white border border-slate-200 hover:border-blue-400 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors"
                            data-testid={`linked-invoice-${inv.id}`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <Receipt className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                              <div className="truncate">
                                <span className="font-semibold text-slate-800 block truncate">
                                  {inv.invoice_number || inv.invoiceNumber || 'Invoice'}
                                </span>
                                <span className="text-[10px] text-slate-400 block">
                                  {inv.clients?.name || 'Client'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {inv.amount != null && (
                                <span className="font-mono text-[11px] text-slate-700">
                                  ₱{Number(inv.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                              )}
                              <ExternalLink className="h-3 w-3 text-slate-400" />
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Disbursements */}
                  {disbursements.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Disbursements ({disbursements.length})
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {disbursements.map((d) => (
                          <a
                            key={d.id}
                            href={`/disbursements?id=${d.id}`}
                            className="p-2.5 bg-white border border-slate-200 hover:border-blue-400 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors"
                            data-testid={`linked-disbursement-${d.id}`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <CreditCard className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                              <div className="truncate">
                                <span className="font-semibold text-slate-800 block truncate">
                                  {d.category || 'Disbursement'}
                                </span>
                                <span className="text-[10px] text-slate-400 block truncate">
                                  {d.description || 'No description'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {d.amount != null && (
                                <span className="font-mono text-[11px] text-slate-700">
                                  ₱{Number(d.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                </span>
                              )}
                              <ExternalLink className="h-3 w-3 text-slate-400" />
                            </div>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Transmittals */}
                  {transmittals.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                        Transmittals ({transmittals.length})
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {transmittals.map((t) => (
                          <a
                            key={t.id}
                            href={`/transmittals?id=${t.id}`}
                            className="p-2.5 bg-white border border-slate-200 hover:border-blue-400 rounded-lg flex items-center justify-between gap-2 text-xs transition-colors"
                            data-testid={`linked-transmittal-${t.id}`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <Send className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                              <div className="truncate">
                                <span className="font-semibold text-slate-800 block truncate">
                                  {t.tracking_number || t.trackingNumber || 'Transmittal'}
                                </span>
                                <span className="text-[10px] text-slate-400 block truncate">
                                  {t.recipient_name || t.recipientName || 'Recipient'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {t.status && (
                                <Badge variant="outline" size="compact" className="text-[10px]">
                                  {t.status}
                                </Badge>
                              )}
                              <ExternalLink className="h-3 w-3 text-slate-400" />
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
            <div className="space-y-3" data-testid="task-time-logged-section">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-slate-500" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Time Logged ({formatHours(totalMinutes)})
                  </h4>
                </div>

                {canLogTime && !showLogForm && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => setShowLogForm(true)}
                    className="text-xs gap-1"
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
                  className="p-4 bg-blue-50/50 border border-blue-200 rounded-lg space-y-3 text-xs"
                  data-testid="log-time-form"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-800">Record Time Spent</span>
                    <button
                      type="button"
                      onClick={() => setShowLogForm(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs"
                    >
                      Cancel
                    </button>
                  </div>

                  {logError && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs flex items-center gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{logError}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                        Date
                      </label>
                      <Input
                        type="date"
                        value={logDate}
                        onChange={(e) => setLogDate(e.target.value)}
                        className="h-8 text-xs bg-white"
                        required
                        data-testid="log-time-date-input"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                        Duration (Minutes)
                      </label>
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min={1}
                          step={5}
                          value={logMinutes}
                          onChange={(e) => setLogMinutes(Number(e.target.value))}
                          className="h-8 text-xs bg-white w-24"
                          required
                          data-testid="log-time-minutes-input"
                        />
                        <div className="flex items-center gap-1">
                          {[15, 30, 60, 120].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => setLogMinutes(preset)}
                              className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                                logMinutes === preset
                                  ? 'bg-blue-600 text-white border-blue-600 font-bold'
                                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
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
                    <label className="text-[10px] font-bold uppercase text-slate-500 block mb-1">
                      Work Note / Activity Description
                    </label>
                    <Input
                      type="text"
                      placeholder="e.g., Reviewed and indexed source document"
                      value={logNote}
                      onChange={(e) => setLogNote(e.target.value)}
                      className="h-8 text-xs bg-white"
                      data-testid="log-time-note-input"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => setShowLogForm(false)}
                      className="text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="xs"
                      disabled={createTimeEntryMutation.isPending}
                      className="text-xs font-semibold"
                      data-testid="log-time-submit-btn"
                    >
                      {createTimeEntryMutation.isPending ? 'Saving...' : 'Save Time Entry'}
                    </Button>
                  </div>
                </form>
              )}

              {/* Time Entries List */}
              {isLoadingTime ? (
                <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-200">
                  Loading time entries...
                </div>
              ) : timeEntries.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded border border-slate-200 italic">
                  No time recorded on this task yet. Click &quot;Log Time&quot; to add duration.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
                  <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                    {timeEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-2.5 flex items-center justify-between text-xs hover:bg-slate-50 transition-colors"
                        data-testid={`time-entry-item-${entry.id}`}
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-800">
                              {formatHours(entry.durationMinutes)}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {entry.entryDate}
                            </span>
                          </div>
                          {entry.note && (
                            <p className="text-[11px] text-slate-600 line-clamp-1">{entry.note}</p>
                          )}
                        </div>
                        <Badge variant="outline" size="compact" className="text-[10px]">
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
          <DialogFooter className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              Task ID: {task.id}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
              data-testid="task-close-btn"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 1. Invoice Create Modal (UAT2-7) */}
      {isInvoiceModalOpen && (
        <InvoiceCreateModal
          isOpen={isInvoiceModalOpen}
          onClose={() => {
            setIsInvoiceModalOpen(false);
            refetchRelated();
          }}
          onCreated={() => {
            setIsInvoiceModalOpen(false);
            refetchRelated();
          }}
          prefill={{
            workRequestId: task.workRequestId,
            taskId: task.id,
            clientId: workRequest?.clientId || undefined,
          }}
        />
      )}

      {/* 2. Disbursement Create Modal (UAT2-7) */}
      {isDisbursementModalOpen && (
        <CreateDisbursementModal
          isOpen={isDisbursementModalOpen}
          onClose={() => {
            setIsDisbursementModalOpen(false);
            refetchRelated();
          }}
          onSuccess={() => {
            setIsDisbursementModalOpen(false);
            refetchRelated();
          }}
          prefill={{
            workRequestId: task.workRequestId,
            taskId: task.id,
            clientId: workRequest?.clientId || undefined,
          }}
        />
      )}

      {/* 3. Transmittal Form Modal (UAT2-7) */}
      {isTransmittalModalOpen && (
        <TransmittalFormModal
          isOpen={isTransmittalModalOpen}
          onClose={() => {
            setIsTransmittalModalOpen(false);
            refetchRelated();
          }}
          prefill={{
            workRequestId: task.workRequestId,
            taskId: task.id,
            clientId: workRequest?.clientId || undefined,
          }}
        />
      )}

      {/* 4. Document Upload Modal (UAT2-11) */}
      {isUploadDocModalOpen && (
        <DocumentUploadModal
          isOpen={isUploadDocModalOpen}
          onClose={() => setIsUploadDocModalOpen(false)}
          defaultWorkRequestId={task.workRequestId}
          defaultClientId={workRequest?.clientId || undefined}
          onSuccess={() => {
            setIsUploadDocModalOpen(false);
            refetchDocs();
            queryClient.invalidateQueries({
              queryKey: operationsKeys.documents(),
            });
          }}
        />
      )}

      {/* 5. Linked Document Viewer Modal */}
      {selectedDoc && (
        <DocumentViewerModal
          isOpen={Boolean(selectedDoc)}
          onClose={() => setSelectedDoc(null)}
          document={selectedDoc}
          workRequest={workRequest}
        />
      )}
    </>
  );
}
