import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Trash2,
  Calendar,
  Clock,
  Layers,
  X,
  CheckSquare,
  FileText,
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
import { useRetainerTemplateMutations } from '../api/useRetainerTemplates';
import { useClients } from '@/features/operations/api/useClients';
import { TaskTypeSelect } from '@/features/operations/lib/taskTypes';
import { useUsersList } from '../api/useUsers';
import { usePermission } from '@/lib/permissions';
import type { ChecklistItemData } from '@/features/operations/api/types';
import type {
  RetainerTemplate,
  RetainerTemplateTask,
  CreateRetainerTemplateInput,
  CreatablePhase,
  Priority,
  RecurrenceType,
} from '../api/types';

export interface RetainerTemplateModalProps {
  template: RetainerTemplate | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function RetainerTemplateModal({
  template,
  isOpen,
  onClose,
  onSuccess,
}: RetainerTemplateModalProps) {
  const canEditRetainers = usePermission('retainers:edit');
  const { createTemplate, updateTemplate } = useRetainerTemplateMutations();

  const { data: clients = [] } = useClients(undefined, { enabled: isOpen });
  const { data: users = [] } = useUsersList({ enabled: isOpen && canEditRetainers });

  const isEditing = Boolean(template);

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string>('');
  const [schedule, setSchedule] = useState<string>('monthly');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [pfAmount, setPfAmount] = useState<string | number>('');
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none');
  const [tasks, setTasks] = useState<RetainerTemplateTask[]>([]);
  const taskTitleInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [focusNewTaskIndex, setFocusNewTaskIndex] = useState<number | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

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

  useEffect(() => {
    if (template) {
      setName(template.name);
      setDescription(template.description || '');
      setClientId(template.client_id || template.clientId || '');
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
    } else {
      setName('');
      setDescription('');
      setClientId('');
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
  }, [template, isOpen]);

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
    setFocusNewTaskIndex(newTaskIndex);
  };

  const addChecklistItem = (taskIndex: number) => {
    const updated = [...tasks];
    const target = updated[taskIndex];
    if (target) {
      const currentList = target.checklist || [];
      const newItem: ChecklistItemData = {
        id:
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
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
    }
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
      if (isEditing && template) {
        await updateTemplate(template.id, payload);
      } else {
        await createTemplate(payload);
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
        <DialogContent className="max-w-md border-[#E2E8F0] rounded-[12px] shadow-float p-6 bg-[#FFFFFF] border" data-testid="unauthorized-retainer-modal">
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
      <DialogContent className="max-w-3xl border-[#E2E8F0] rounded-[12px] shadow-float p-6 bg-[#FFFFFF] max-h-[90vh] overflow-y-auto border"
        data-testid="retainer-template-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#1E293B]">
            {isEditing ? `Edit Template: ${template?.name}` : 'New Retainer Template Builder'}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            Configure reusable multi-task blueprint with P0-D phase assignments and recurrence rules.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
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
                onChange={(e) => setName(e.target.value)}
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
              <Select value={clientId || 'none'} onValueChange={(val) => setClientId(val === 'none' ? '' : val)}>
                <SelectTrigger className="h-9 text-xs bg-[#FFFFFF]" data-testid="template-client-select">
                  <SelectValue placeholder="All Clients / Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (Select upon generation)</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name} ({c.entity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Billing Schedule */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#1E293B]">
                Billing Schedule
              </label>
              <Select value={schedule} onValueChange={setSchedule}>
                <SelectTrigger className="h-9 text-xs bg-[#FFFFFF]" data-testid="template-schedule-select">
                  <SelectValue placeholder="Schedule" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="semi-annual">Semi-Annual</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Default Priority */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-[#1E293B]">
                Default Priority
              </label>
              <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
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
                onChange={(e) => setPfAmount(e.target.value)}
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
                    onChange={() => setRecurrence('none')}
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
                    onChange={() => setRecurrence('annual')}
                    className="text-[#1D4ED8] focus:ring-[#1D4ED8] h-3.5 w-3.5"
                    data-testid="recurrence-annual-radio"
                  />
                  <span className="font-semibold text-[#1E293B]">Annual Recurrence</span>
                </label>
              </div>

              {/* Annual Period Label Formatting Guidance */}
              {recurrence === 'annual' && (
                <div
                  className="rounded-[6px] bg-[#EFF6FF] border border-[#BFDBFE] p-2.5 text-xs text-[#1E293B] space-y-1"
                  data-testid="annual-period-hint"
                >
                  <p className="font-semibold flex items-center gap-1 text-[#1D4ED8]">
                    <Clock className="h-3.5 w-3.5 text-[#1D4ED8]" />
                    Annual Period Label Guidance (e.g. FY-2026, FY-2027)
                  </p>
                  <p className="text-xs text-[#475569]">
                    When generating work requests from an annual template, you will be prompted for a period label (e.g. <code className="font-mono font-bold">FY-2026</code>). The system enforces duplicate protection (<code className="font-mono">UNIQUE(template_id, period_label)</code>) to prevent accidental duplicate work request creation.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Interactive Task Blueprint Rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-[#1E293B] flex items-center gap-1.5">
                  <Layers className="h-4 w-4 text-[#1E293B]" />
                  Task Blueprint Graph ({tasks.length} task{tasks.length !== 1 ? 's' : ''})
                </h4>
                <p className="text-xs text-[#475569]">
                  Delimiter hint: Title text containing commas, semicolons, or newlines will be split into sibling tasks upon generation.
                </p>
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
                    className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-none space-y-2.5"
                    data-testid={`task-row-${idx}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[#F8FAFC] text-xs font-bold text-[#475569]">
                          {idx + 1}
                        </span>
                        <TaskTypeSelect
                          value={task.requiredLinkType}
                          onChange={(val) => updateTaskField(idx, 'requiredLinkType', val || null)}
                          ariaLabel="Task type"
                          data-testid={`retainer-template-task-type-${idx}`}
                          className="h-8"
                        />
                        {/* Task Title Input */}
                        <div className="flex-1">
                          <Input
                            ref={(el) => {
                              taskTitleInputRefs.current[idx] = el;
                            }}
                            type="text"
                            placeholder="Task title (e.g. Prepare draft computation; Review schedules)"
                            value={task.title}
                            onChange={(e) => updateTaskField(idx, 'title', e.target.value)}
                            className="h-8 text-xs"
                            data-testid={`task-title-input-${idx}`}
                            required
                          />
                        </div>
                      </div>

                      {/* Phase Selector - STRICTLY pre_processing | processing per P0-D */}
                      <div className="w-36 shrink-0">
                        <Select
                          value={task.phase}
                          onValueChange={(val) => updateTaskField(idx, 'phase', val as CreatablePhase)}
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
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTaskRow(idx)}
                          className="h-8 w-8 p-0 text-[#475569] hover:text-[#DC2626] shrink-0"
                          title="Remove task row"
                          data-testid={`remove-task-btn-${idx}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    {/* Secondary Row: Dependency & Assignees */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-[#E2E8F0]">
                      {/* Depends On Local ID */}
                      <div className="space-y-0.5">
                        <label className="text-xs text-[#475569] font-medium">
                          Prerequisite Task (Dependency)
                        </label>
                        <Select
                          value={task.depends_on_local_id || 'none'}
                          onValueChange={(val) =>
                            updateTaskField(idx, 'depends_on_local_id', val === 'none' ? null : val)
                          }
                        >
                          <SelectTrigger
                            className="h-7 text-xs bg-[#F8FAFC]"
                            data-testid={`task-dependency-select-${idx}`}
                          >
                            <SelectValue placeholder="No prerequisite" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None (Can start immediately)</SelectItem>
                            {predecessorOptions.map((opt) => (
                              <SelectItem key={opt.localId} value={opt.localId} className="text-xs">
                                Depends on: {opt.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Default Assignees Multi-Select / Picker */}
                      <div className="space-y-0.5">
                        <label className="text-xs text-[#475569] font-medium">
                          Default Assigned Staff
                        </label>
                        <Select
                          value={task.default_assignees?.[0] || 'none'}
                          onValueChange={(val) => {
                            if (val === 'none') {
                              updateTaskField(idx, 'default_assignees', []);
                            } else {
                              updateTaskField(idx, 'default_assignees', [val]);
                            }
                          }}
                        >
                          <SelectTrigger
                            className="h-7 text-xs bg-[#F8FAFC]"
                            data-testid={`task-assignee-select-${idx}`}
                          >
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">Unassigned</SelectItem>
                            {users.map((u) => (
                              <SelectItem key={u.id} value={u.id} className="text-xs">
                                {u.name} ({u.role})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Checklist & Documents Sub-Section */}
                    <div className="pt-2 border-t border-[#E2E8F0] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[#1E293B] flex items-center gap-1.5">
                          <CheckSquare className="h-3.5 w-3.5 text-[#1E293B]" />
                          Checklist & Subtasks ({task.checklist?.length || 0})
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => addChecklistItem(idx)}
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
                              {/* Text input */}
                              <input
                                type="text"
                                value={item.text}
                                onChange={(e) =>
                                  updateChecklistItem(idx, ci, 'text', e.target.value)
                                }
                                placeholder="Checklist item or document requirement..."
                                className="flex-1 text-xs border-[#E2E8F0] rounded-[6px] px-2 py-1 bg-[#FFFFFF] text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
                                data-testid={`checklist-item-input-${idx}-${ci}`}
                              />

                              {/* Category toggle: Sub-task vs Doc */}
                              <button
                                type="button"
                                onClick={() => {
                                  const nextCat =
                                    item.category === 'document' ? 'subtask' : 'document';
                                  updateChecklistItem(idx, ci, 'category', nextCat);
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
                                  onChange={(e) =>
                                    updateChecklistItem(
                                      idx,
                                      ci,
                                      'periodYear',
                                      parseInt(e.target.value, 10) || null
                                    )
                                  }
                                  className="w-16 text-xs p-1 border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-center shrink-0"
                                  placeholder="Year"
                                  data-testid={`checklist-period-year-${idx}-${ci}`}
                                />
                              )}

                              {/* Delete button */}
                              <button
                                type="button"
                                onClick={() => removeChecklistItem(idx, ci)}
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

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs h-9"
              data-testid="template-modal-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="text-xs h-9 bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs"
              data-testid="template-modal-submit-btn"
            >
              {isEditing ? 'Save Template Changes' : 'Create Retainer Template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
