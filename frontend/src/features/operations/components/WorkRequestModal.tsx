import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AssignerSelect } from './AssignerSelect';
import { TaskLineItems, type TaskItemData } from './TaskLineItems';
import { runBlockingAction } from './BlockingActionModal';
import { useClients } from '../api/useClients';
import { useTeam } from '../api/useTeam';
import {
  useWorkRequestMutations,
} from '../api/useWorkRequests';
import { useTaskMutations } from '../api/useTasks';
import { operationsKeys } from '../api/queryKeys';
import { validateDependencies } from '../utils/dependencyValidator';
import { parseTaskDelimiterInput } from '../hooks/useTokenizer';
import { useSessionStore } from '@/lib/session';
import type {
  WorkRequest,
  Priority,
  CreateWorkRequestInput,
  UpdateWorkRequestInput,
  PhaseTaskInput,
} from '../api/types';

export interface WorkRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  workRequest?: WorkRequest | null;
  onSuccess?: (wr: WorkRequest) => void;
}

const DEFAULT_TASKS: TaskItemData[] = [
  {
    localId: 'tmp-1',
    title: '',
    phase: 'pre_processing',
    coAssignees: [],
    checklist: [],
    dependsOn: null,
  },
  {
    localId: 'tmp-2',
    title: '',
    phase: 'pre_processing',
    coAssignees: [],
    checklist: [],
    dependsOn: null,
  },
];

export function WorkRequestModal({
  isOpen,
  onClose,
  workRequest,
  onSuccess,
}: WorkRequestModalProps) {
  const isEditMode = Boolean(workRequest?.id);
  const activeSessionEntity = useSessionStore((state) => state.activeEntity);

  // Queries
  const { data: clients = [] } = useClients();
  const { data: team = [] } = useTeam();
  const { createWorkRequest, updateWorkRequest } = useWorkRequestMutations();
  const { createTask, updateTask, deleteTask } = useTaskMutations(workRequest?.id);

  // Form State
  const [title, setTitle] = useState('');
  const [entity, setEntity] = useState<'ATA' | 'LTA'>('ATA');
  const [clientId, setClientId] = useState<string>('');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [dueDate, setDueDate] = useState<string>('');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [coAssignees, setCoAssignees] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [tasks, setTasks] = useState<TaskItemData[]>(DEFAULT_TASKS);

  // Validation & Draft State
  const [managerError, setManagerError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const draftKey = `erp_wr_draft_${workRequest?.id || 'new'}`;

  // Entity locking: if client is selected and belongs to ATA/LTA, entity is locked
  const selectedClient = useMemo(
    () => clients.find((c) => c.id === clientId),
    [clients, clientId]
  );
  const isEntityLocked = Boolean(selectedClient?.entity);

  // Initialize or reset form
  const resetForm = useCallback(() => {
    if (workRequest) {
      setTitle(workRequest.title);
      setEntity(workRequest.entity === 'LTA' ? 'LTA' : 'ATA');
      setClientId(workRequest.clientId || '');
      setPriority(workRequest.priority || 'Normal');
      setDueDate(
        workRequest.dueDate
          ? new Date(workRequest.dueDate).toISOString().slice(0, 10)
          : ''
      );
      setAssignedTo(workRequest.assignedTo || null);
      setCoAssignees(workRequest.coAssignees || []);
      setDescription(workRequest.description || '');

      if (workRequest.tasks && workRequest.tasks.length > 0) {
        setTasks(
          workRequest.tasks.map((t) => ({
            localId: t.id,
            id: t.id,
            title: t.title,
            description: t.description || undefined,
            phase: t.phase === 'processing' ? 'processing' : 'pre_processing',
            assigneeId: t.assigneeId || null,
            coAssignees:
              t.taskAssignees?.map((a) => a.userId) ||
              t.assignees ||
              [],
            dependsOn: t.predecessors?.length ? t.predecessors : null,
            checklist: t.checklist?.map((c) => ({
              id: c.id,
              text: c.text,
              completed: c.completed,
              category: (c.category as 'subtask' | 'document') || 'subtask',
              periodYear: c.periodYear ? parseInt(c.periodYear, 10) : null,
              dependsOn: typeof c.dependsOn === 'string' ? c.dependsOn : null,
            })),
          }))
        );
      } else {
        setTasks(DEFAULT_TASKS);
      }
    } else {
      const defaultEnt = activeSessionEntity === 'LTA' ? 'LTA' : 'ATA';
      setTitle('');
      setEntity(defaultEnt);
      setClientId('');
      setPriority('Normal');
      setDueDate('');
      setAssignedTo(null);
      setCoAssignees([]);
      setDescription('');
      setTasks(DEFAULT_TASKS);
    }
    setManagerError(null);
    setTitleError(null);
    setIsDirty(false);
  }, [workRequest, activeSessionEntity]);

  // Handle Mount & Draft Loading
  useEffect(() => {
    if (!isOpen) return;

    resetForm();

    // Check for existing unsaved draft (only for new work requests)
    if (!workRequest?.id) {
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          setHasDraftBanner(true);
        }
      } catch {
        // ignore
      }
    }
  }, [isOpen, resetForm, draftKey, workRequest?.id]);

  // Client Entity Auto-Sync
  const handleClientChange = (newClientId: string) => {
    const cid = newClientId === 'unselected' ? '' : newClientId;
    setClientId(cid);
    setIsDirty(true);
    if (!cid) return;

    const matched = clients.find((c) => c.id === cid);
    if (matched?.entity) {
      setEntity(matched.entity);
    }
  };

  // Restore Draft
  const handleRestoreDraft = () => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          title?: string;
          entity?: 'ATA' | 'LTA';
          clientId?: string;
          priority?: Priority;
          dueDate?: string;
          assignedTo?: string | null;
          coAssignees?: string[];
          description?: string;
          tasks?: TaskItemData[];
        };
        if (parsed.title !== undefined) setTitle(parsed.title);
        if (parsed.entity) setEntity(parsed.entity);
        if (parsed.clientId !== undefined) setClientId(parsed.clientId);
        if (parsed.priority) setPriority(parsed.priority);
        if (parsed.dueDate !== undefined) setDueDate(parsed.dueDate);
        if (parsed.assignedTo !== undefined) setAssignedTo(parsed.assignedTo);
        if (parsed.coAssignees) setCoAssignees(parsed.coAssignees);
        if (parsed.description !== undefined) setDescription(parsed.description);
        if (parsed.tasks) setTasks(parsed.tasks);
        setIsDirty(true);
      }
    } catch {
      // ignore
    }
    setHasDraftBanner(false);
  };

  const handleDiscardDraft = () => {
    try {
      localStorage.removeItem(draftKey);
    } catch {
      // ignore
    }
    setHasDraftBanner(false);
    resetForm();
    setIsDirty(false);
  };

  // Auto-save draft on changes (1s debounce)
  // Only fires when dirty, not in draft prompt, and in create mode
  useEffect(() => {
    if (!isOpen || !isDirty || hasDraftBanner || isEditMode) return;
    const timer = setTimeout(() => {
      try {
        const stateToSave = {
          title,
          entity,
          clientId,
          priority,
          dueDate,
          assignedTo,
          coAssignees,
          description,
          tasks,
        };
        localStorage.setItem(draftKey, JSON.stringify(stateToSave));
      } catch {
        // ignore
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    isOpen,
    isDirty,
    hasDraftBanner,
    isEditMode,
    draftKey,
    title,
    entity,
    clientId,
    priority,
    dueDate,
    assignedTo,
    coAssignees,
    description,
    tasks,
  ]);

  // Project Team Members (Manager + selected coAssignees)
  const projectTeam = useMemo(() => {
    return team.filter(
      (m) => (assignedTo && m.id === assignedTo) || coAssignees.includes(m.id)
    );
  }, [team, assignedTo, coAssignees]);

  // Form Submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Title Validation
    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }
    setTitleError(null);

    // 2. Mandatory Manager Validation
    if (!assignedTo) {
      setManagerError('Manager is required');
      return;
    }
    setManagerError(null);

    // 3. Client-side Dependency DAG Check
    const depCheck = validateDependencies(
      tasks.map((t) => ({ id: t.localId, dependsOn: t.dependsOn }))
    );
    if (depCheck.hasCycle) {
      alert(depCheck.error || 'Circular dependency detected between tasks');
      return;
    }

    // 4. Tokenizer Cap Check (Total tasks cannot exceed 50)
    let totalProjectedTasks = 0;
    for (const t of tasks) {
      if (!t.title.trim()) continue;
      const tok = parseTaskDelimiterInput(t.title);
      totalProjectedTasks += tok.shouldSplit ? tok.count : 1;
    }
    if (totalProjectedTasks > 50) {
      alert(`Exceeds maximum limit of 50 tasks per request (${totalProjectedTasks} tasks detected).`);
      return;
    }

    // 5. Submit via Blocking Modal
    await runBlockingAction({
      title: isEditMode ? 'Saving Work Request' : 'Creating Work Request',
      message: isEditMode
        ? `Please wait while "${title}" is being updated...`
        : 'Please wait while the work request is being created...',
      apiCall: async () => {
        if (isEditMode && workRequest) {
          const updatePayload: UpdateWorkRequestInput = {
            title: title.trim(),
            description: description.trim() || null,
            clientId: clientId || null,
            entity,
            priority,
            dueDate: dueDate ? new Date(dueDate).toISOString() : null,
            assignedTo,
            coAssignees,
            expectedVersion: workRequest.version,
          };
          const savedWr = await updateWorkRequest({
            id: workRequest.id,
            data: updatePayload,
            entity,
          });

          // Sync task modifications per operations@2.0.0 §3.8
          const existingTasks = workRequest.tasks || [];
          const currentTaskIds = new Set(tasks.map((t) => t.id).filter(Boolean));

          // 1. Delete tasks removed from form
          for (const ext of existingTasks) {
            if (!currentTaskIds.has(ext.id)) {
              await deleteTask({ workRequestId: workRequest.id, taskId: ext.id });
            }
          }

          // 2. Maintain ID map for dependency resolution (F4.1)
          const tempToRealIdMap = new Map<string, string>();
          for (const ext of existingTasks) {
            tempToRealIdMap.set(ext.id, ext.id);
          }
          for (const t of tasks) {
            if (t.id && existingTasks.some((ext) => ext.id === t.id)) {
              tempToRealIdMap.set(t.id, t.id);
              if (t.localId) {
                tempToRealIdMap.set(t.localId, t.id);
              }
            }
          }

          const resolvePredecessors = (
            dependsOn: string | string[] | null | undefined
          ): string[] => {
            if (!dependsOn) return [];
            const rawList = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
            return rawList
              .map((id) => tempToRealIdMap.get(id) || id)
              .filter((id) => Boolean(id) && !id.startsWith('tmp-'));
          };

          // 3. First pass: Create all new tasks so they obtain real server UUIDs
          const newlyCreatedTasks: Array<{
            realId: string;
            task: TaskItemData;
            assignees: string[];
            initialPredecessors: string[];
          }> = [];

          for (const t of tasks) {
            if (!t.title.trim()) continue;
            const isExisting = Boolean(t.id && existingTasks.some((ext) => ext.id === t.id));
            if (!isExisting) {
              const assignees = Array.from(
                new Set([
                  ...(t.assigneeId ? [t.assigneeId] : []),
                  ...t.coAssignees,
                ])
              ).filter(Boolean);

              const initialPredecessors = resolvePredecessors(t.dependsOn);

              const createdTask = await createTask({
                workRequestId: workRequest.id,
                data: {
                  title: t.title.trim(),
                  description: t.description?.trim() || null,
                  phase: t.phase,
                  assigneeId: t.assigneeId || null,
                  assignees,
                  predecessors: initialPredecessors,
                  checklist: t.checklist
                    ?.filter((c) => c.text.trim())
                    .map((c) => ({
                      text: c.text.trim(),
                      completed: c.completed,
                      category: c.category,
                      periodYear: c.periodYear ? String(c.periodYear) : null,
                    })),
                },
              });

              const returnedId =
                (createdTask as { id?: string })?.id ||
                (createdTask as { data?: { id?: string } })?.data?.id;

              if (returnedId) {
                if (t.localId) tempToRealIdMap.set(t.localId, returnedId);
                if (t.id) tempToRealIdMap.set(t.id, returnedId);
                newlyCreatedTasks.push({
                  realId: returnedId,
                  task: t,
                  assignees,
                  initialPredecessors,
                });
              }
            }
          }

          // 4. Second pass: Update existing tasks with resolved predecessors
          for (const t of tasks) {
            if (!t.title.trim()) continue;
            const isExisting = Boolean(t.id && existingTasks.some((ext) => ext.id === t.id));
            if (isExisting && t.id) {
              const assignees = Array.from(
                new Set([
                  ...(t.assigneeId ? [t.assigneeId] : []),
                  ...t.coAssignees,
                ])
              ).filter(Boolean);

              await updateTask({
                workRequestId: workRequest.id,
                taskId: t.id,
                data: {
                  title: t.title.trim(),
                  description: t.description?.trim() || null,
                  assigneeId: t.assigneeId || null,
                  assignees,
                  predecessors: resolvePredecessors(t.dependsOn),
                  checklist: t.checklist?.map((c) => ({
                    id: c.id,
                    text: c.text,
                    completed: c.completed,
                    category: c.category,
                    periodYear: c.periodYear ? String(c.periodYear) : null,
                    dependsOn: c.dependsOn || null,
                  })),
                },
              });
            }
          }

          // 5. Update dependencies for newly created tasks if predecessors were resolved after creation
          for (const item of newlyCreatedTasks) {
            const finalPredecessors = resolvePredecessors(item.task.dependsOn);
            const needsUpdate =
              finalPredecessors.length !== item.initialPredecessors.length ||
              finalPredecessors.some((p, idx) => p !== item.initialPredecessors[idx]);

            if (needsUpdate) {
              await updateTask({
                workRequestId: workRequest.id,
                taskId: item.realId,
                data: {
                  title: item.task.title.trim(),
                  description: item.task.description?.trim() || null,
                  assigneeId: item.task.assigneeId || null,
                  assignees: item.assignees,
                  predecessors: finalPredecessors,
                  checklist: item.task.checklist?.map((c) => ({
                    id: c.id,
                    text: c.text,
                    completed: c.completed,
                    category: c.category,
                    periodYear: c.periodYear ? String(c.periodYear) : null,
                    dependsOn: c.dependsOn || null,
                  })),
                },
              });
            }
          }

          return savedWr;
        } else {
          // Map task rows to create payload
          const preTasks: PhaseTaskInput[] = [];
          const procTasks: PhaseTaskInput[] = [];

          for (const t of tasks) {
            if (!t.title.trim()) continue;
            const assignees = [
              ...(t.assigneeId ? [t.assigneeId] : []),
              ...t.coAssignees,
            ];

            const taskInput: PhaseTaskInput = {
              title: t.title.trim(),
              description: t.description?.trim() || null,
              local_id: t.localId,
              assignees,
              depends_on: t.dependsOn || undefined,
            };

            if (t.phase === 'processing') {
              procTasks.push(taskInput);
            } else {
              preTasks.push(taskInput);
            }
          }

          const createPayload: CreateWorkRequestInput = {
            title: title.trim(),
            description: description.trim() || null,
            clientId: clientId || null,
            entity,
            priority,
            dueDate: dueDate ? new Date(dueDate).toISOString() : null,
            assignedTo,
            coAssignees,
            phases: {
              pre_processing: { tasks: preTasks },
              processing: { tasks: procTasks },
            },
          };
          const savedWr = await createWorkRequest(createPayload);

          // Persist checklist/subtasks for newly created tasks if any
          const tasksWithChecklist = tasks.filter(
            (t) => t.title.trim() && t.checklist && t.checklist.some((c) => c.text.trim())
          );

          if (tasksWithChecklist.length > 0 && savedWr?.id) {
            const createdTasks = [
              ...(savedWr.tasks || []),
              ...(savedWr.phases?.pre_processing?.tasks || []),
              ...(savedWr.phases?.processing?.tasks || []),
            ];

            for (const t of tasksWithChecklist) {
              const matchedTask = createdTasks.find((ct) => {
                const ctLocal = ct as unknown as { localId?: string; local_id?: string };
                return (
                  (ctLocal.localId && ctLocal.localId === t.localId) ||
                  (ctLocal.local_id && ctLocal.local_id === t.localId) ||
                  ct.title?.trim() === t.title.trim()
                );
              });

              if (matchedTask?.id) {
                const validChecklist = t.checklist!
                  .filter((c) => c.text.trim())
                  .map((c) => ({
                    id: c.id,
                    text: c.text.trim(),
                    completed: c.completed,
                    category: c.category,
                    periodYear: c.periodYear ? String(c.periodYear) : null,
                    dependsOn: c.dependsOn || null,
                  }));

                if (validChecklist.length > 0) {
                  try {
                    await updateTask({
                      workRequestId: savedWr.id,
                      taskId: matchedTask.id,
                      data: {
                        checklist: validChecklist,
                      },
                    });
                  } catch (chkErr) {
                    console.error('Failed to save task checklist:', chkErr);
                  }
                }
              }
            }
          }

          return savedWr;
        }
      },
      successTitle: isEditMode ? 'Work Request Updated' : 'Work Request Created',
      successMessage: isEditMode
        ? 'Work request has been successfully updated.'
        : 'Work request has been successfully created.',
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeSessionEntity),
        ...(isEditMode && workRequest
          ? [
              operationsKeys.workRequestDetail(workRequest.id),
              operationsKeys.tasks(workRequest.id),
            ]
          : []),
      ],
      onSuccess: (savedWr) => {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
        setIsDirty(false);
        if (onSuccess && savedWr) {
          onSuccess(savedWr as WorkRequest);
        }
        onClose();
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden"
        data-testid="work-request-modal"
      >
        <DialogHeader className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-bold text-slate-900">
              {isEditMode ? 'Edit Work Request' : 'New Work Request'}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Draft Restore Alert Banner */}
        {hasDraftBanner && (
          <div
            className="px-6 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between text-xs text-amber-800"
            data-testid="draft-restore-banner"
          >
            <span>You have an unsaved draft from a previous session.</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={handleRestoreDraft}
                className="bg-white border-amber-300 text-amber-900"
              >
                Restore
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={handleDiscardDraft}
                className="text-amber-700 hover:text-amber-900"
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Work Request Title */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Title <span className="text-red-500">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setIsDirty(true);
                if (titleError) setTitleError(null);
              }}
              placeholder="e.g. Annual Corporate Income Tax Return 2025"
              autoFocus
              className={`h-9 ${titleError ? 'border-red-500' : ''}`}
              data-testid="wr-modal-title-input"
            />
            {titleError && (
              <span className="text-[11px] text-red-600 block">{titleError}</span>
            )}
          </div>

          {/* Entity Scoping Bar (ATA vs LTA) */}
          <div className="flex items-center justify-between p-2.5 bg-slate-50 rounded-md border border-slate-200">
            <div className="space-y-0.5">
              <span className="text-xs font-semibold text-slate-700 block">
                Operating Entity
              </span>
              <span className="text-[11px] text-slate-400">
                {isEntityLocked
                  ? "Locked to client's registered entity"
                  : 'Select ATA or LTA entity for this engagement'}
              </span>
            </div>
            <div className="flex gap-1.5" data-testid="wr-modal-entity-toggle">
              <Button
                type="button"
                variant={entity === 'ATA' ? 'ata' : 'outline'}
                size="sm"
                disabled={isEntityLocked}
                onClick={() => {
                  setEntity('ATA');
                  setIsDirty(true);
                }}
                className="text-xs font-semibold h-7 px-3"
              >
                ATA
              </Button>
              <Button
                type="button"
                variant={entity === 'LTA' ? 'lta' : 'outline'}
                size="sm"
                disabled={isEntityLocked}
                onClick={() => {
                  setEntity('LTA');
                  setIsDirty(true);
                }}
                className="text-xs font-semibold h-7 px-3"
              >
                LTA
              </Button>
            </div>
          </div>

          {/* Core Properties Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Client Select */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Client</label>
              <Select value={clientId || 'unselected'} onValueChange={handleClientChange}>
                <SelectTrigger
                  className="h-9 bg-white"
                  data-testid="wr-modal-client-select"
                >
                  <SelectValue placeholder="Select Client..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unselected">— No Client —</SelectItem>
                  {clients
                    .filter((c) => !isEntityLocked || c.entity === entity)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.entity})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Priority</label>
              <Select
                value={priority}
                onValueChange={(val) => {
                  setPriority(val as Priority);
                  setIsDirty(true);
                }}
              >
                <SelectTrigger className="h-9 bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Due Date */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Due Date</label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value);
                  setIsDirty(true);
                }}
                className="h-9 bg-white text-xs"
                data-testid="wr-modal-due-date"
              />
            </div>
          </div>

          {/* Team Governance Section */}
          <div className="p-3 bg-slate-50/70 border border-slate-200 rounded-md space-y-3">
            <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Team Governance
            </h4>
            <AssignerSelect
              availableStaff={team}
              primaryAssigneeId={assignedTo}
              selectedCoAssigneeIds={coAssignees}
              managerOnlyPrimary={true}
              onPrimaryChange={(newMgr) => {
                setAssignedTo(newMgr);
                setIsDirty(true);
                if (managerError) setManagerError(null);
              }}
              onCoAssigneesChange={(newCo) => {
                setCoAssignees(newCo);
                setIsDirty(true);
              }}
            />
            {managerError && (
              <span className="text-[11px] text-red-600 block" data-testid="manager-error">
                {managerError}
              </span>
            )}
          </div>

          {/* Description Textarea */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Description / Notes
            </label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setIsDirty(true);
              }}
              placeholder="Scope summary, special requirements, client instructions..."
              rows={2}
              className="w-full text-xs p-2.5 border border-slate-200 rounded-md bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Task Line Items (Notion-style) */}
          <TaskLineItems
            tasks={tasks}
            onChange={(newTasks) => {
              setTasks(newTasks);
              setIsDirty(true);
            }}
            projectTeam={projectTeam}
            isEditMode={isEditMode}
          />
        </form>

        <DialogFooter className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleSubmit}
            data-testid="wr-modal-submit-btn"
            className="text-xs font-semibold"
          >
            {isEditMode ? 'Save Changes' : 'Create Work Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
