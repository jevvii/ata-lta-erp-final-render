import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Calendar,
  Layers,
  X,
  CheckSquare,
  FileText,
  GripVertical,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import { useRetainerMutations } from '@/features/operations/api/useRetainers';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { runBlockingAction } from '@/features/operations/components/BlockingActionModal';
import { useClients, type ClientSummary } from '@/features/operations/api/useClients';
import {
  getDuplicateClientIds,
  matchesClientSearch,
  sortClients,
  DEFAULT_CLIENT_SORT,
  type ClientSortOption,
} from '@/features/clients/lib/clientSelectUtils';
import { ClientSelectOptionContent, ClientSelectSearchHeader } from '@/components/ui/client-select-option';
import { TaskTypeSelect } from '@/features/operations/lib/taskTypes';
import { useUsersList } from '@/features/admin/api/useUsers';
import { usePermission } from '@/lib/permissions';
import { useSessionStore } from '@/lib/session';
import type {
  ChecklistItemData,
  RetainerTemplate,
  RetainerTemplateTask,
  CreateRetainerTemplateInput,
  CreatablePhase,
  Priority,
  RecurrenceType,
} from '@/features/operations/api/types';

export interface RetainerTemplateModalProps {
  template: RetainerTemplate | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  defaultClientId?: string | null;
  onDelete?: (template: RetainerTemplate) => void;
}

const DRAFT_STORAGE_KEY = 'erp_retainer_template_draft_new';

interface RetainerTemplateDraft {
  name: string;
  description: string;
  entity: 'ATA' | 'LTA';
  clientId: string | null;
  schedule: string;
  priority: Priority;
  pfAmount: string | number;
  recurrence: RecurrenceType;
  tasks: RetainerTemplateTask[];
  updatedAt?: string;
}

export function RetainerTemplateModal({
  template,
  isOpen,
  onClose,
  onSuccess,
  defaultClientId = null,
  onDelete,
}: RetainerTemplateModalProps) {
  const canEditRetainers = usePermission('retainers:edit');
  const { createTemplate, updateTemplate } = useRetainerMutations();
  const activeEntity = useSessionStore((s) => s.activeEntity);

  const isEditing = Boolean(template);
  const templateId = template?.id;

  // Form State
  const [isDirty, setIsDirty] = useState(false);
  const [hasDraftBanner, setHasDraftBanner] = useState(false);
  const [entity, setEntity] = useState<'ATA' | 'LTA'>(activeEntity === 'LTA' ? 'LTA' : 'ATA');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string | null>(defaultClientId || null);
  const [clientSearch, setClientSearch] = useState<string>('');
  const [clientSort, setClientSort] = useState<ClientSortOption>(DEFAULT_CLIENT_SORT);
  const [schedule, setSchedule] = useState<string>('monthly');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [pfAmount, setPfAmount] = useState<string | number>('');
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [tasks, setTasks] = useState<RetainerTemplateTask[]>([]);
  const taskTitleInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusNewTaskIndex, setFocusNewTaskIndex] = useState<number | null>(null);
  const [draggedTaskIndex, setDraggedTaskIndex] = useState<number | null>(null);
  const [dragOverTaskIndex, setDragOverTaskIndex] = useState<number | null>(null);
  const [dragEnabledIndex, setDragEnabledIndex] = useState<number | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Client query scoped to template's entity
  const { data: clientsData = [] } = useClients({ entity }, { enabled: isOpen });
  const clients: ClientSummary[] = useMemo(() => {
    const rawList = Array.isArray(clientsData) ? clientsData : (clientsData as any)?.items ?? [];
    return rawList.filter((c: ClientSummary) => !c.entity || c.entity === entity);
  }, [clientsData, entity]);
  const duplicateClientIds = useMemo(() => getDuplicateClientIds(clients), [clients]);
  const sortedClients = useMemo(() => sortClients(clients, clientSort), [clients, clientSort]);

  const { data: users = [] } = useUsersList({ enabled: isOpen && canEditRetainers });

  useEffect(() => {
    if (focusNewTaskIndex !== null) {
      const el = taskTitleInputRefs.current[focusNewTaskIndex];
      if (el) {
        if (typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        el.focus?.();
      }
      setFocusNewTaskIndex(null);
    }
  }, [focusNewTaskIndex, tasks.length]);

  // Synchronize entity if activeEntity changes and creating new template
  useEffect(() => {
    if (!isEditing && activeEntity !== 'ALL') {
      setEntity(activeEntity === 'LTA' ? 'LTA' : 'ATA');
    }
  }, [activeEntity, isEditing]);

  // Initialize or restore form state
  useEffect(() => {
    if (!isOpen) return;

    if (isEditing && template) {
      setName(template.name || '');
      setDescription(template.description || '');
      setEntity(template.entity === 'LTA' ? 'LTA' : 'ATA');
      setClientId(template.client_id || template.clientId || null);
      setSchedule(template.schedule || 'monthly');
      setPriority(template.priority || 'Normal');
      setPfAmount(
        template.pf_amount != null
          ? (template.pf_amount === 0 ? '' : String(template.pf_amount))
          : template.pfAmount != null
            ? (template.pfAmount === 0 ? '' : String(template.pfAmount))
            : ''
      );
      setRecurrence(template.recurrence || 'none');
      setTasks(
        (template.tasks || []).map((t, idx) => ({
          ...t,
          local_id: t.local_id || t.localId || `task_${idx + 1}`,
          phase: t.phase || 'pre_processing',
          default_assignees: t.default_assignees || t.defaultAssignees || [],
          requiredLinkType: t.requiredLinkType ?? t.required_link_type ?? null,
          checklist: t.checklist || [],
        }))
      );
      setErrors({});
      setClientSearch('');
      setClientSort(DEFAULT_CLIENT_SORT);
      setIsDirty(false);
      setHasDraftBanner(false);
    } else {
      // New template creation: check for existing draft
      try {
        const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          const hasContent = Boolean(
            parsed.name?.trim() ||
            parsed.description?.trim() ||
            parsed.clientId ||
            parsed.pfAmount ||
            (parsed.tasks && parsed.tasks.some((t: any) => t.title?.trim() || (t.checklist && t.checklist.length > 0)))
          );
          if (hasContent) {
            setHasDraftBanner(true);
          }
        }
      } catch {
        // ignore
      }

      if (!isDirty) {
        setName('');
        setDescription('');
        setEntity(activeEntity === 'LTA' ? 'LTA' : 'ATA');
        setClientId(defaultClientId || null);
        setClientSearch('');
        setClientSort(DEFAULT_CLIENT_SORT);
        setSchedule('monthly');
        setPriority('Normal');
        setPfAmount('');
        setRecurrence('none');
        setTasks([
          {
            local_id: 'task_1',
            title: '',
            description: '',
            phase: 'pre_processing',
            default_assignees: [],
            depends_on_local_id: null,
            requiredLinkType: null,
            checklist: [],
          },
        ]);
        setErrors({});
      }
    }
  }, [isOpen, templateId]);

  // Draft apply & discard
  const applyDraft = () => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        const parsed: RetainerTemplateDraft = JSON.parse(saved);
        if (parsed.name !== undefined) setName(parsed.name);
        if (parsed.description !== undefined) setDescription(parsed.description);
        if (parsed.entity) setEntity(parsed.entity);
        if (parsed.clientId !== undefined) setClientId(parsed.clientId || null);
        if (parsed.schedule !== undefined) setSchedule(parsed.schedule);
        if (parsed.priority !== undefined) setPriority(parsed.priority);
        if (parsed.pfAmount !== undefined) setPfAmount(parsed.pfAmount);
        if (parsed.recurrence !== undefined) setRecurrence(parsed.recurrence);
        if (Array.isArray(parsed.tasks) && parsed.tasks.length > 0) setTasks(parsed.tasks);
        setIsDirty(true);
      }
    } catch {
      // ignore
    }
    setHasDraftBanner(false);
  };

  const discardDraft = () => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      // ignore
    }
    setHasDraftBanner(false);
    setName('');
    setDescription('');
    setEntity(activeEntity === 'LTA' ? 'LTA' : 'ATA');
    setClientId(defaultClientId || null);
    setClientSearch('');
    setClientSort(DEFAULT_CLIENT_SORT);
    setSchedule('monthly');
    setPriority('Normal');
    setPfAmount('');
    setRecurrence('none');
    setTasks([
      {
        local_id: 'task_1',
        title: '',
        description: '',
        phase: 'pre_processing',
        default_assignees: [],
        depends_on_local_id: null,
        requiredLinkType: null,
        checklist: [],
      },
    ]);
    setErrors({});
    setIsDirty(false);
  };

  // Debounced auto-save draft (1000ms)
  useEffect(() => {
    if (!isOpen || isEditing || !isDirty || hasDraftBanner) return;

    const timer = setTimeout(() => {
      try {
        const draft: RetainerTemplateDraft = {
          name,
          description,
          entity,
          clientId: clientId || null,
          schedule,
          priority,
          pfAmount,
          recurrence,
          tasks,
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
        setHasDraftBanner(false);
      } catch {
        // ignore
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    isOpen,
    isEditing,
    isDirty,
    hasDraftBanner,
    name,
    description,
    entity,
    clientId,
    schedule,
    priority,
    pfAmount,
    recurrence,
    tasks,
  ]);

  // Task Helpers
  const addTaskRow = () => {
    const nextIdx = tasks.length + 1;
    const newTaskIndex = tasks.length;
    setTasks([
      ...tasks,
      {
        local_id: `task_${nextIdx}`,
        title: '',
        description: '',
        phase: 'pre_processing',
        default_assignees: [],
        depends_on_local_id: null,
        requiredLinkType: null,
        checklist: [],
      },
    ]);
    setIsDirty(true);
    setFocusNewTaskIndex(newTaskIndex);
  };

  const addChecklistItem = (taskIndex: number) => {
    const updated = [...tasks];
    const target = updated[taskIndex];
    if (target) {
      const currentList = target.checklist || [];
      const newItem: ChecklistItemData = {
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
              }),
        text: '',
        completed: false,
        category: 'subtask',
      };
      updated[taskIndex] = {
        ...target,
        checklist: [...currentList, newItem],
      };
      setTasks(updated);
      setIsDirty(true);
    }
  };

  const updateChecklistItem = <K extends keyof ChecklistItemData>(
    taskIndex: number,
    itemIndex: number,
    field: K,
    val: ChecklistItemData[K]
  ) => {
    const updated = [...tasks];
    const target = updated[taskIndex];
    if (target) {
      const currentList = [...(target.checklist || [])];
      const item = currentList[itemIndex];
      if (item) {
        currentList[itemIndex] = { ...item, [field]: val };
        updated[taskIndex] = { ...target, checklist: currentList };
        setTasks(updated);
        setIsDirty(true);
      }
    }
  };

  const removeChecklistItem = (taskIndex: number, itemIndex: number) => {
    const updated = [...tasks];
    const target = updated[taskIndex];
    if (target) {
      const currentList = (target.checklist || []).filter((_, i) => i !== itemIndex);
      updated[taskIndex] = { ...target, checklist: currentList };
      setTasks(updated);
      setIsDirty(true);
    }
  };

  const removeTaskRow = (index: number) => {
    if (tasks.length <= 1) return;
    const removedId = tasks[index]?.local_id;
    const newTasks = tasks.filter((_, i) => i !== index);
    // Clear dependencies referencing removed task
    setTasks(
      newTasks.map((t) =>
        t.depends_on_local_id === removedId
          ? { ...t, depends_on_local_id: null }
          : t
      )
    );
    setIsDirty(true);
  };

  const updateTaskField = <K extends keyof RetainerTemplateTask>(
    index: number,
    field: K,
    val: RetainerTemplateTask[K]
  ) => {
    const updated = [...tasks];
    const target = updated[index];
    if (target) {
      updated[index] = { ...target, [field]: val };
      setTasks(updated);
      setIsDirty(true);
    }
  };

  const handleMoveTask = (fromIndex: number, toIndex: number) => {
    if (
      Number.isNaN(fromIndex) ||
      Number.isNaN(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= tasks.length ||
      toIndex >= tasks.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const reordered = [...tasks];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) return;
    reordered.splice(toIndex, 0, moved);

    const cleanedReordered = reordered.map((t, currentIdx) => {
      const depId = t.depends_on_local_id || t.dependsOnLocalId || null;
      if (!depId) return t;

      const depIdx = reordered.findIndex(
        (cand) => (cand.local_id || cand.localId) === depId
      );

      if (depIdx === -1 || depIdx >= currentIdx) {
        return {
          ...t,
          depends_on_local_id: null,
          ...(t.dependsOnLocalId !== undefined ? { dependsOnLocalId: null } : {}),
        };
      }
      return t;
    });

    setIsDirty(true);
    setTasks(cleanedReordered);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    if (!name.trim()) {
      setErrors({ name: 'Template name is required.' });
      return;
    }

    if (tasks.length === 0) {
      setErrors({ tasks: 'Template must contain at least one task blueprint.' });
      return;
    }

    // Validate tasks
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (!task?.title.trim()) {
        setErrors({ [`task_${i}`]: 'Task title is required.' });
        return;
      }
      // Ensure phase is strictly pre_processing or processing
      if (task.phase !== 'pre_processing' && task.phase !== 'processing') {
        setErrors({ [`task_phase_${i}`]: 'Phase must be either Pre-Processing or Processing.' });
        return;
      }
    }

    const payload: CreateRetainerTemplateInput = {
      name: name.trim(),
      description: description.trim() || null,
      entity,
      clientId: clientId || null,
      schedule,
      priority,
      pfAmount: Number(pfAmount) || 0,
      recurrence,
      tasks: tasks.map((t) => ({
        local_id: t.local_id,
        title: t.title.trim(),
        description: t.description?.trim() || null,
        phase: t.phase,
        default_assignees: t.default_assignees || [],
        depends_on_local_id: t.depends_on_local_id || null,
        requiredLinkType: t.requiredLinkType || null,
        checklist: (t.checklist || []).map((c) => ({
          id: c.id,
          text: c.text.trim(),
          completed: Boolean(c.completed),
          category: c.category || 'subtask',
          periodYear: c.category === 'document' ? (c.periodYear ?? new Date().getFullYear()) : null,
          dependsOn: c.dependsOn || null,
        })),
      })),
    };

    try {
      await runBlockingAction({
        title: isEditing ? 'Updating Retainer Template' : 'Creating Retainer Template',
        message: isEditing
          ? 'Persisting template modifications to server...'
          : `Saving retainer blueprint "${payload.name}" with ${payload.tasks?.length ?? 0} task(s)...`,
        actionName: isEditing ? 'Update Retainer Template' : 'Create Retainer Template',
        successTitle: isEditing ? 'Template Updated' : 'Template Created',
        successMessage: isEditing
          ? 'Retainer template updated successfully.'
          : `Retainer template "${payload.name}" created successfully.`,
        apiCall: async () => {
          if (isEditing && template) {
            return await updateTemplate({ id: template.id, data: payload });
          }
          const res = await createTemplate(payload);
          try {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
          } catch {
            // ignore
          }
          setIsDirty(false);
          return res;
        },
        invalidateQueries: [operationsKeys.templates()],
      });

      if (!isEditing) {
        try {
          localStorage.removeItem(DRAFT_STORAGE_KEY);
        } catch {
          // ignore
        }
        setIsDirty(false);
      }

      if (onSuccess) onSuccess();
      onClose();
    } catch {
      // 409 Conflict and other errors surfaced verbatim by runBlockingAction
    }
  };

  if (!canEditRetainers) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md border-[#E2E8F0] rounded-[12px] shadow-float p-6 bg-[#FFFFFF] border overflow-x-hidden"
          data-testid="unauthorized-retainer-modal"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-[#1E293B]">
              Access Restricted
            </DialogTitle>
            <DialogDescription className="text-xs text-[#DC2626]">
              You do not have permission to author or edit retainer templates (<code className="font-mono">retainers:edit</code> required).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" onClick={onClose} className="text-xs">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl border-[#E2E8F0] rounded-[12px] shadow-float p-6 bg-[#FFFFFF] max-h-[90vh] overflow-y-auto overflow-x-hidden border"
        data-testid="retainer-template-modal"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#1E293B]">
            {isEditing ? `Edit Template: ${template?.name}` : 'New Retainer Template Builder'}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            Configure reusable multi-task blueprint with P0-D phase assignments and recurrence rules.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2 min-w-0 max-w-full overflow-x-hidden">
          {/* Draft Restore Alert Banner */}
          {hasDraftBanner && (
            <div
              className="px-4 py-2 bg-[#FEF2F2] border-b border-[#FCA5A5] rounded-[8px] flex items-center justify-between text-xs text-[#DC2626]"
              data-testid="draft-restore-banner"
            >
              <span>You have an unsaved draft from a previous session.</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={applyDraft}
                  data-testid="restore-draft-btn"
                  className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] text-xs uppercase"
                >
                  Restore
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={discardDraft}
                  data-testid="discard-draft-btn"
                  className="rounded-[6px] text-[#DC2626] hover:bg-[#DC2626]/20 text-xs uppercase"
                >
                  Discard
                </Button>
              </div>
            </div>
          )}

          {/* Operating Entity Scoping Bar (visible only when activeEntity === 'ALL') */}
          {activeEntity === 'ALL' && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC]">
              <div className="space-y-0.5">
                <span className="text-xs tracking-normal font-bold text-[#1E293B] block">
                  Operating Entity
                </span>
                <span className="text-xs text-[#475569]">
                  Select ATA or LTA entity for this retainer template
                </span>
              </div>
              <div
                className="flex border border-[#E2E8F0] divide-x divide-[#CBD5E1] bg-[#FFFFFF] rounded-[6px] overflow-hidden"
                data-testid="retainer-template-entity-toggle"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="retainer-template-entity-ata"
                  onClick={() => {
                    if (entity !== 'ATA') {
                      setEntity('ATA');
                      setIsDirty(true);
                      const currentClient = clients.find((c) => c.id === clientId);
                      if (currentClient && currentClient.entity && currentClient.entity !== 'ATA') {
                        setClientId(null);
                      }
                    }
                  }}
                  className={`text-xs font-bold uppercase rounded-none h-7 px-3 ${
                    entity === 'ATA'
                      ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs'
                      : 'bg-transparent text-[#1E293B] hover:bg-[#F8FAFC]'
                  }`}
                >
                  ATA
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  data-testid="retainer-template-entity-lta"
                  onClick={() => {
                    if (entity !== 'LTA') {
                      setEntity('LTA');
                      setIsDirty(true);
                      const currentClient = clients.find((c) => c.id === clientId);
                      if (currentClient && currentClient.entity && currentClient.entity !== 'LTA') {
                        setClientId(null);
                      }
                    }
                  }}
                  className={`text-xs font-bold uppercase rounded-none h-7 px-3 ${
                    entity === 'LTA'
                      ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs'
                      : 'bg-transparent text-[#1E293B] hover:bg-[#F8FAFC]'
                  }`}
                >
                  LTA
                </Button>
              </div>
            </div>
          )}

          {/* Header Metadata Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC]/50 p-3.5 text-xs">
            {/* Template Name */}
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold text-[#1E293B]">
                Template Name <span className="text-[#DC2626]">*</span>
              </label>
              <Input
                type="text"
                placeholder="e.g. Annual BIR Compliance & Tax Filing"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setIsDirty(true);
                  if (errors.name) setErrors((prev) => ({ ...prev, name: '' }));
                }}
                className="h-9 text-xs bg-[#FFFFFF]"
                data-testid="template-name-input"
                required
              />
              {errors.name && <p className="text-xs text-[#DC2626]">{errors.name}</p>}
            </div>

            {/* Client (Optional default) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#1E293B]">
                Default Client (Optional)
              </label>
              <Select
                value={clientId || 'none'}
                onValueChange={(val) => {
                  setClientId(val === 'none' ? null : val);
                  setIsDirty(true);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-[#FFFFFF]" data-testid="template-client-select">
                  <SelectValue placeholder="All Clients / Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <ClientSelectSearchHeader
                    value={clientSearch}
                    onChange={setClientSearch}
                    sortBy={clientSort}
                    onSortChange={setClientSort}
                  />
                  <SelectItem value="none">None (Select upon generation)</SelectItem>
                  {(() => {
                    const filtered = sortedClients.filter((c) => matchesClientSearch(c, clientSearch));
                    const selectedClient = sortedClients.find((c) => c.id === clientId);
                    const selectedIsFilteredOut = selectedClient && !filtered.some((c) => c.id === selectedClient.id);

                    return (
                      <>
                        {selectedIsFilteredOut && (
                          <SelectItem key={selectedClient.id} value={selectedClient.id} className="hidden">
                            <ClientSelectOptionContent
                              client={selectedClient}
                              isDuplicate={duplicateClientIds.has(selectedClient.id)}
                            />
                          </SelectItem>
                        )}
                        {filtered.length === 0 ? (
                          <div className="py-3 px-2 text-center text-xs text-[#64748B]">
                            No matching clients found
                          </div>
                        ) : (
                          filtered.map((c) => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              <ClientSelectOptionContent
                                client={c}
                                isDuplicate={duplicateClientIds.has(c.id)}
                              />
                            </SelectItem>
                          ))
                        )}
                      </>
                    );
                  })()}
                </SelectContent>
              </Select>
            </div>

            {/* Recurrence Schedule Interval */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#1E293B]">
                Schedule Cadence
              </label>
              <Select
                value={schedule}
                onValueChange={(v) => {
                  setSchedule(v);
                  setIsDirty(true);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-[#FFFFFF]" data-testid="template-schedule-select">
                  <SelectValue placeholder="Schedule" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="one-off">One-Off Deliverable</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Default Priority */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#1E293B]">
                Default Priority
              </label>
              <Select
                value={priority}
                onValueChange={(v) => {
                  setPriority(v as Priority);
                  setIsDirty(true);
                }}
              >
                <SelectTrigger className="h-9 text-xs bg-[#FFFFFF]" data-testid="template-priority-select">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Normal">Normal</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                  <SelectItem value="Urgent">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* PF Amount */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#1E293B]">
                Professional Fee (PHP)
              </label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={pfAmount}
                onChange={(e) => {
                  setPfAmount(e.target.value);
                  setIsDirty(true);
                }}
                className="h-9 text-xs bg-[#FFFFFF]"
                data-testid="template-pf-input"
              />
            </div>

            {/* Recurrence Toggle */}
            <div className="space-y-1.5 md:col-span-2 pt-1 border-t border-[#E2E8F0]">
              <label className="text-xs font-semibold text-[#1E293B] flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-[#1D4ED8]" />
                <span>Recurrence Frequency:</span>
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-[#1E293B] cursor-pointer">
                  <input
                    type="radio"
                    name="recurrence"
                    value="none"
                    checked={recurrence === 'none'}
                    onChange={() => {
                      setRecurrence('none');
                      setIsDirty(true);
                    }}
                    className="text-[#1D4ED8] focus:ring-[#1D4ED8] h-3.5 w-3.5"
                    data-testid="recurrence-none-radio"
                  />
                  <span>None / Ad-Hoc</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-[#1E293B] cursor-pointer">
                  <input
                    type="radio"
                    name="recurrence"
                    value="annual"
                    checked={recurrence === 'annual'}
                    onChange={() => {
                      setRecurrence('annual');
                      setIsDirty(true);
                    }}
                    className="text-[#1D4ED8] focus:ring-[#1D4ED8] h-3.5 w-3.5"
                    data-testid="recurrence-annual-radio"
                  />
                  <span className="font-semibold text-[#1E293B]">Annual Recurrence</span>
                </label>
              </div>

              {/* Annual Period Label Formatting Guidance */}
              {recurrence === 'annual' && (
                <div
                  className="rounded-[6px] border border-[#BFDBFE] bg-[#EFF6FF] p-2 text-xs text-[#1E40AF] mt-1 space-y-0.5"
                  data-testid="annual-period-label-notice"
                >
                  <span className="font-semibold block">Annual Period Suffix Pattern:</span>
                  <span className="text-xs text-[#1E40AF]">
                    When generating from this template, a period label (e.g. &quot;2025&quot;) will be appended to the work request title to produce clean unique deliverables (e.g. &quot;{name || 'Template Name'} - 2025&quot;).
                  </span>
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold text-[#1E293B]">
                Template Description (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="Scope of service, standard filing deadlines, and client deliverables..."
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setIsDirty(true);
                }}
                className="w-full text-xs p-2 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
                data-testid="template-description-input"
              />
            </div>
          </div>

          {/* Task Blueprint Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-[#1D4ED8]" />
                <h3 className="text-xs font-bold text-[#1E293B] uppercase tracking-normal">
                  Task Blueprints ({tasks.length})
                </h3>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTaskRow}
                className="h-8 gap-1 text-xs text-[#1E293B] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                data-testid="add-task-row-btn"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Task Row
              </Button>
            </div>

            {errors.tasks && <p className="text-xs text-[#DC2626]">{errors.tasks}</p>}

            {/* Task Rows List */}
            <div className="space-y-2.5" data-testid="task-rows-container">
              {tasks.map((task, idx) => {
                const predecessorOptions = tasks
                  .filter((_, i) => i < idx)
                  .map((t) => ({ localId: t.local_id || `task_${idx}`, title: t.title || `Task #${tasks.indexOf(t) + 1}` }));

                return (
                  <div
                    key={task.local_id || idx}
                    draggable={tasks.length > 1 && (dragEnabledIndex === null || dragEnabledIndex === idx)}
                    onDragStart={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.tagName === 'INPUT' ||
                        target.tagName === 'TEXTAREA' ||
                        target.tagName === 'SELECT' ||
                        (target.tagName === 'BUTTON' && !target.closest(`[data-testid="task-drag-handle-${idx}"]`))
                      ) {
                        e.preventDefault();
                        return;
                      }
                      setDraggedTaskIndex(idx);
                      e.dataTransfer?.setData('text/plain', String(idx));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedTaskIndex !== null && draggedTaskIndex !== idx) {
                        setDragOverTaskIndex(idx);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverTaskIndex === idx) {
                        setDragOverTaskIndex(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromIdx = draggedTaskIndex ?? Number(e.dataTransfer?.getData('text/plain'));
                      handleMoveTask(fromIdx, idx);
                      setDraggedTaskIndex(null);
                      setDragOverTaskIndex(null);
                      setDragEnabledIndex(null);
                    }}
                    onDragEnd={() => {
                      setDraggedTaskIndex(null);
                      setDragOverTaskIndex(null);
                      setDragEnabledIndex(null);
                    }}
                    className={`rounded-[8px] border bg-[#FFFFFF] p-3 shadow-none space-y-2.5 min-w-0 max-w-full overflow-hidden transition-colors ${
                      draggedTaskIndex === idx ? 'opacity-60' : ''
                    } ${
                      dragOverTaskIndex === idx && draggedTaskIndex !== idx
                        ? 'border-[#1D4ED8] bg-[#F8FAFC] ring-1 ring-[#1D4ED8]'
                        : 'border-[#E2E8F0]'
                    }`}
                    data-testid={`task-row-${idx}`}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {/* Drag Handle */}
                        {tasks.length > 1 && (
                          <button
                            type="button"
                            draggable={true}
                            onMouseDown={() => setDragEnabledIndex(idx)}
                            onMouseUp={() => setDragEnabledIndex(null)}
                            onDragStart={(e) => {
                              setDraggedTaskIndex(idx);
                              e.dataTransfer?.setData('text/plain', String(idx));
                            }}
                            className="cursor-grab active:cursor-grabbing text-[#94A3B8] hover:text-[#475569] p-0.5 rounded-[4px] shrink-0 select-none focus:outline-none"
                            aria-label={`Drag to reorder task ${idx + 1}`}
                            title="Drag to reorder task"
                            data-testid={`task-drag-handle-${idx}`}
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                        )}
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#F8FAFC] text-xs font-bold text-[#475569]">
                          {idx + 1}
                        </span>
                        <TaskTypeSelect
                          value={task.requiredLinkType}
                          onChange={(val) => {
                            updateTaskField(idx, 'requiredLinkType', val || null);
                            setIsDirty(true);
                          }}
                          ariaLabel="Task type"
                          data-testid={`retainer-template-task-type-${idx}`}
                          className="h-8"
                        />
                        {/* Task Title Input */}
                        <div className="flex-1 min-w-0">
                          <Input
                            ref={(el) => {
                              taskTitleInputRefs.current[idx] = el;
                            }}
                            type="text"
                            placeholder="Task title (e.g. Prepare draft computation; Review schedules)"
                            value={task.title}
                            onChange={(e) => {
                              updateTaskField(idx, 'title', e.target.value);
                              setIsDirty(true);
                            }}
                            className="h-8 text-xs min-w-0"
                            data-testid={`task-title-input-${idx}`}
                            required
                          />
                        </div>
                      </div>

                      {/* Phase Selector - STRICTLY pre_processing | processing per P0-D */}
                      <div className="w-36 shrink-0">
                        <Select
                          value={task.phase}
                          onValueChange={(val) => {
                            updateTaskField(idx, 'phase', val as CreatablePhase);
                            setIsDirty(true);
                          }}
                        >
                          <SelectTrigger
                            className="h-8 text-xs bg-[#FFFFFF] font-medium"
                            data-testid={`task-phase-select-${idx}`}
                          >
                            <SelectValue placeholder="Phase" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pre_processing" className="text-xs text-[#1E293B]">
                              Pre-Processing
                            </SelectItem>
                            <SelectItem value="processing" className="text-xs text-[#1E293B]">
                              Processing
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Delete Task Row Button */}
                      {tasks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            removeTaskRow(idx);
                            setIsDirty(true);
                          }}
                          className="text-[#475569] hover:text-[#DC2626] p-1.5 rounded-[6px] hover:bg-[#F8FAFC] shrink-0"
                          title="Remove task blueprint"
                          data-testid={`remove-task-row-btn-${idx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {errors[`task_${idx}`] && (
                      <p className="text-xs text-[#DC2626]">{errors[`task_${idx}`]}</p>
                    )}
                    {errors[`task_phase_${idx}`] && (
                      <p className="text-xs text-[#DC2626]">{errors[`task_phase_${idx}`]}</p>
                    )}

                    {/* Task Details Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {/* Depends On Local ID */}
                      <div className="space-y-1">
                        <label className="text-[11px] text-[#475569]">
                          Predecessor Dependency (Sequential Flow)
                        </label>
                        <Select
                          value={task.depends_on_local_id || 'none'}
                          onValueChange={(val) => {
                            updateTaskField(idx, 'depends_on_local_id', val === 'none' ? null : val);
                            setIsDirty(true);
                          }}
                        >
                          <SelectTrigger
                            className="h-7 text-xs bg-[#FFFFFF]"
                            data-testid={`task-depends-select-${idx}`}
                          >
                            <SelectValue placeholder="None (Can start immediately)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None (Can start immediately)</SelectItem>
                            {predecessorOptions.map((opt) => (
                              <SelectItem key={opt.localId} value={opt.localId} className="text-xs">
                                {opt.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Default Assignees (Staff) */}
                      <div className="space-y-1">
                        <label className="text-[11px] text-[#475569]">
                          Default Assignees (Optional)
                        </label>
                        <Select
                          value={task.default_assignees?.[0] || 'unassigned'}
                          onValueChange={(val) => {
                            const newAssignees = val === 'unassigned' ? [] : [val];
                            updateTaskField(idx, 'default_assignees', newAssignees);
                            setIsDirty(true);
                          }}
                        >
                          <SelectTrigger
                            className="h-7 text-xs bg-[#FFFFFF]"
                            data-testid={`task-assignee-select-${idx}`}
                          >
                            <SelectValue placeholder="— Unassigned —" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">— Unassigned —</SelectItem>
                            {users.map((u) => (
                              <SelectItem key={u.id} value={u.id} className="text-xs">
                                {u.name} ({u.role})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Subtasks / Checklist Items Area */}
                    <div className="pt-2 border-t border-[#E2E8F0]/60 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-[#475569] flex items-center gap-1">
                          <CheckSquare className="h-3 w-3 text-[#1D4ED8]" />
                          Sub-tasks &amp; Document Requirements ({task.checklist?.length || 0})
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            addChecklistItem(idx);
                            setIsDirty(true);
                          }}
                          className="h-6 text-xs text-[#1E293B] hover:bg-[#F8FAFC] border-[#E2E8F0] gap-1"
                          data-testid={`add-subtask-btn-${idx}`}
                        >
                          <Plus className="h-3 w-3 mr-0.5" />
                          Add Subtask
                        </Button>
                      </div>

                      {task.checklist && task.checklist.length > 0 ? (
                        <div className="space-y-1.5 bg-[#F8FAFC]/50 p-2 rounded-[8px] border-[#E2E8F0]">
                          {task.checklist.map((item, ci) => (
                            <div key={item.id || ci} className="flex items-center gap-2 text-xs">
                              {/* Completion Checkbox */}
                              <input
                                type="checkbox"
                                checked={Boolean(item.completed)}
                                onChange={(e) => {
                                  updateChecklistItem(idx, ci, 'completed', e.target.checked);
                                  setIsDirty(true);
                                }}
                                data-testid={`template-checklist-checkbox-${idx}-${ci}`}
                                className="h-3.5 w-3.5 rounded border-[#CBD5E1] text-[#1E293B] focus:ring-[#1E293B] cursor-pointer shrink-0"
                              />

                              {/* Text input */}
                              <input
                                type="text"
                                value={item.text}
                                onChange={(e) => {
                                  updateChecklistItem(idx, ci, 'text', e.target.value);
                                  setIsDirty(true);
                                }}
                                placeholder="Checklist item or document requirement..."
                                className={`flex-1 text-xs border-[#E2E8F0] rounded-[6px] px-2 py-1 bg-[#FFFFFF] ${
                                  item.completed ? 'line-through text-[#94A3B8]' : 'text-[#0F172A]'
                                } placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]`}
                                data-testid={`checklist-item-input-${idx}-${ci}`}
                              />

                              {/* Category toggle: Sub-task vs Doc */}
                              <button
                                type="button"
                                onClick={() => {
                                  const nextCat =
                                    item.category === 'document' ? 'subtask' : 'document';
                                  updateChecklistItem(idx, ci, 'category', nextCat);
                                  setIsDirty(true);
                                }}
                                className="px-2 py-1 text-xs rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-[#475569] hover:bg-[#F8FAFC] font-medium shrink-0"
                                data-testid={`checklist-category-toggle-${idx}-${ci}`}
                              >
                                {item.category === 'document' ? (
                                  <span className="flex items-center gap-1 text-[#1E293B]">
                                    <FileText className="h-3 w-3" /> Doc
                                  </span>
                                ) : (
                                  <span>Sub-task</span>
                                )}
                              </button>

                              {/* Period Year (if document) */}
                              {item.category === 'document' && (
                                <input
                                  type="number"
                                  value={item.periodYear ?? new Date().getFullYear()}
                                  onChange={(e) => {
                                    updateChecklistItem(
                                      idx,
                                      ci,
                                      'periodYear',
                                      parseInt(e.target.value, 10) || null
                                    );
                                    setIsDirty(true);
                                  }}
                                  className="w-16 text-xs p-1 border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-center shrink-0"
                                  placeholder="Year"
                                  data-testid={`checklist-period-year-${idx}-${ci}`}
                                />
                              )}

                              {/* Delete button */}
                              <button
                                type="button"
                                onClick={() => {
                                  removeChecklistItem(idx, ci);
                                  setIsDirty(true);
                                }}
                                className="text-[#475569] hover:text-[#DC2626] p-0.5 shrink-0"
                                title="Remove item"
                                data-testid={`checklist-remove-btn-${idx}-${ci}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-xs text-[#475569] italic">
                          No checklist items.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Add Task Button matching TaskLineItems.tsx */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTaskRow}
              data-testid="add-task-btn"
              className="w-full border-dashed text-xs text-[#475569] hover:text-[#1E293B] hover:bg-[#F8FAFC] h-8"
            >
              <Plus className="h-3.5 w-3.5 mr-1 text-[#475569]" />
              Add task
            </Button>
          </div>

          <DialogFooter className="pt-2 flex items-center justify-between sm:justify-between w-full">
            {isEditing && template && onDelete ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onDelete(template)}
                className="text-xs h-9 border-[#DC2626]/30 text-[#DC2626] hover:bg-[#DC2626]/10 mr-auto cursor-pointer"
                data-testid="template-modal-delete-btn"
              >
                <Trash2 className="h-3.5 w-3.5 mr-1 text-[#DC2626]" />
                Delete Template
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-xs h-9 cursor-pointer"
                data-testid="template-modal-cancel-btn"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="text-xs h-9 bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs cursor-pointer"
                data-testid="template-modal-submit-btn"
              >
                {isEditing ? 'Save Template Changes' : 'Create Retainer Template'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
