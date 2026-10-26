import React, { useState } from 'react';
import {
  Link2,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  X,
  AlertTriangle,
  Lock,
  FileText,
  CheckSquare,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { parseTaskDelimiterInput } from '../hooks/useTokenizer';
import { validateDependencies } from '../utils/dependencyValidator';
import { TaskTypeSelect } from '../lib/taskTypes';
import type { TeamMember } from '../api/useTeam';
import type { CreatablePhase } from '../api/types';

export interface ChecklistItemData {
  id: string;
  text: string;
  completed: boolean;
  category?: 'subtask' | 'document';
  periodYear?: number | string | null;
  dependsOn?: string | string[] | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
}

export interface TaskItemData {
  localId: string;
  id?: string;
  title: string;
  description?: string;
  phase: CreatablePhase;
  assigneeId?: string | null;
  coAssignees: string[];
  dependsOn?: string[] | string | null;
  checklist?: ChecklistItemData[];
  dueDate?: string | null;
  requiredLinkType?: string | null;
  deletionBlockedReason?: string | null;
}

export interface TaskLineItemsProps {
  tasks: TaskItemData[];
  onChange: (tasks: TaskItemData[]) => void;
  projectTeam: TeamMember[];
  disabled?: boolean;
  isEditMode?: boolean;
  checklistEditable?: boolean;
  defaultPhase?: CreatablePhase;
}

export function TaskLineItems({
  tasks,
  onChange,
  projectTeam,
  disabled = false,
  isEditMode = false,
  checklistEditable = true,
  defaultPhase,
}: TaskLineItemsProps) {
  const checklistDisabled = disabled || !checklistEditable;
  const [yearFields, setYearFields] = useState<Set<string>>(() => new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [activeDepDropdown, setActiveDepDropdown] = useState<string | null>(null);

  // Validate dependencies DAG
  const cycleResult = React.useMemo(() => {
    const formatted = tasks.map((t) => ({
      id: t.localId,
      dependsOn: t.dependsOn,
    }));
    return validateDependencies(formatted);
  }, [tasks]);

  const toggleExpand = (localId: string) => {
    setExpandedRow((prev) => (prev === localId ? null : localId));
  };

  const handleUpdateTask = (
    index: number,
    field: keyof TaskItemData,
    value: unknown
  ) => {
    const updated = [...tasks];
    const target = updated[index];
    if (!target) return;

    if (field === 'title') {
      const newTitle = String(value);
      // If title is cleared, prune stale dependencies on other tasks
      if (!newTitle.trim()) {
        const clearedId = target.localId;
        updated.forEach((t, i) => {
          if (i !== index && t.dependsOn) {
            const currentDeps = Array.isArray(t.dependsOn)
              ? t.dependsOn
              : [t.dependsOn];
            const pruned = currentDeps.filter((d) => d !== clearedId);
            t.dependsOn = pruned.length > 0 ? pruned : null;
          }
        });
      }
    }

    updated[index] = {
      ...target,
      [field]: value,
    };
    onChange(updated);
  };

  const handleAddTask = () => {
    const newLocalId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newTask: TaskItemData = {
      localId: newLocalId,
      title: '',
      phase: defaultPhase || 'pre_processing',
      coAssignees: [],
      checklist: [],
      dependsOn: null,
      dueDate: null,
      requiredLinkType: null,
    };
    onChange([...tasks, newTask]);
    setExpandedRow(newLocalId);
  };

  const handleRemoveTask = (index: number) => {
    const target = tasks[index];
    if (!target || target.deletionBlockedReason) return;
    const removedId = target.localId;

    // Prune dependencies on removed task
    const nextTasks = tasks
      .filter((_, i) => i !== index)
      .map((t) => {
        if (!t.dependsOn) return t;
        const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [t.dependsOn];
        const pruned = deps.filter((d) => d !== removedId);
        return {
          ...t,
          dependsOn: pruned.length > 0 ? pruned : null,
        };
      });

    onChange(nextTasks);
    if (expandedRow === removedId) {
      setExpandedRow(null);
    }
  };

  const handleToggleDependency = (taskIndex: number, targetLocalId: string) => {
    const target = tasks[taskIndex];
    if (!target) return;

    let nextDeps: string[] = [];
    const currentDeps = target.dependsOn
      ? Array.isArray(target.dependsOn)
        ? [...target.dependsOn]
        : [target.dependsOn]
      : [];

    if (targetLocalId === '*') {
      // Toggle wildcard
      if (currentDeps.includes('*')) {
        nextDeps = [];
      } else {
        nextDeps = ['*'];
      }
    } else {
      // Toggle specific ID (remove wildcard if present)
      const cleaned = currentDeps.filter((d) => d !== '*');
      if (cleaned.includes(targetLocalId)) {
        nextDeps = cleaned.filter((d) => d !== targetLocalId);
      } else {
        nextDeps = [...cleaned, targetLocalId];
      }
    }

    handleUpdateTask(taskIndex, 'dependsOn', nextDeps.length > 0 ? nextDeps : null);
  };

  const staffById = React.useMemo(() => {
    const map = new Map<string, TeamMember>();
    projectTeam.forEach((m) => map.set(m.id, m));
    return map;
  }, [projectTeam]);

  return (
    <div className="space-y-3 notion-line-items" data-testid="task-line-items">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-bold text-[#1E293B] tracking-normal">
          Tasks ({tasks.length})
        </h4>
        <span className="text-xs text-[#475569]">
          Paste a list — we'll split it
        </span>
      </div>

      {/* Cycle Detection Warning Banner */}
      {cycleResult.hasCycle && (
        <div
          className="p-2.5 bg-[#FFFFFF] border-2 border-[#FCA5A5] rounded-[6px] flex items-center gap-2 text-xs text-[#DC2626]"
          data-testid="dependency-cycle-warning"
        >
          <AlertTriangle className="h-4 w-4 text-[#DC2626] shrink-0" />
          <span>{cycleResult.error || 'Circular dependency detected between tasks.'}</span>
        </div>
      )}

      {/* Line Items Container */}
      <div className="border-[#E2E8F0] rounded-[6px] divide-y divide-[#CBD5E1] bg-[#FFFFFF]">
        {tasks.map((task, index) => {
          const isExpanded = expandedRow === task.localId;
          const tokenizer = parseTaskDelimiterInput(task.title);

          // Predecessors candidate calculation:
          // Named tasks only, excluding self
          const namedCandidates = tasks.filter((t) => {
            if (t.localId !== task.localId && t.title.trim().length > 0) {
              if (task.phase === 'pre_processing' && t.phase === 'processing') return false;
              return true;
            }
            return false;
          });
          const precedingNamed = tasks
            .slice(0, index)
            .filter((t) => {
              if (!t.title.trim()) return false;
              if (task.phase === 'pre_processing' && t.phase === 'processing') return false;
              return true;
            });

          const currentDeps = task.dependsOn
            ? Array.isArray(task.dependsOn)
              ? task.dependsOn
              : [task.dependsOn]
            : [];

          const depDisplayText = (() => {
            if (currentDeps.includes('*')) return 'All Tasks (*)';
            if (currentDeps.length === 0) return '— No dependency —';
            const titles = currentDeps
              .map((id) => tasks.find((t) => t.localId === id)?.title || id)
              .filter(Boolean);
            return titles.join(', ') || '— No dependency —';
          })();

          return (
            <div
              key={task.localId}
              className={`p-2.5 space-y-2 transition-colors ${
                isExpanded ? 'bg-[#F8FAFC]' : 'hover:bg-[#F8FAFC]/50'
              }`}
              data-testid={`task-row-${task.localId}`}
            >
              {/* Primary Row Controls */}
              <div className="flex flex-wrap items-center gap-1.5">

                {/* Expand / Collapse Toggle */}
                <button
                  type="button"
                  onClick={() => toggleExpand(task.localId)}
                  className="text-[#475569] hover:text-[#1E293B] p-0.5 rounded-[6px] focus:outline-none"
                  aria-label="Toggle task details"
                  data-testid={`task-expand-toggle-${task.localId}`}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                {/* Task Type Selector */}
                <TaskTypeSelect
                  value={task.requiredLinkType}
                  onChange={(val) => handleUpdateTask(index, 'requiredLinkType', val || null)}
                  disabled={disabled}
                  ariaLabel="Task type"
                  data-testid={`task-type-select-${index}`}
                  className="h-8"
                />

                {/* Task Title Input */}
                <div className="min-w-48 flex-[1_1_12rem]">
                  <Input
                    value={task.title}
                    onChange={(e) => handleUpdateTask(index, 'title', e.target.value)}
                    placeholder="Task title"
                    aria-label={`Task ${index + 1} title`}
                    disabled={disabled}
                    className="h-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-[#1E293B]"
                    data-testid={`task-title-input-${task.localId}`}
                  />
                </div>

                {/* Phase Badge / Selector (immutable in edit mode) */}
                <div className="w-24 shrink-0">
                  <Select
                    value={task.phase}
                    onValueChange={(val) =>
                      handleUpdateTask(index, 'phase', val as CreatablePhase)
                    }
                    disabled={disabled || Boolean(task.id)}
                  >
                    <SelectTrigger className={`h-8 text-xs font-medium rounded-[6px] px-2 ${
                      task.phase === 'pre_processing'
                        ? 'bg-[#EEF2FF] text-[#3730A3] border-[#C7D2FE]'
                        : 'bg-[#EFF6FF] text-[#1E40AF] border-[#93C5FD]'
                    }`} aria-label="Task phase">
                      <SelectValue>{task.phase === 'pre_processing' ? 'Pre-process' : 'Processing'}</SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                      <SelectItem
                        value="pre_processing"
                        className="text-xs"
                        disabled={isEditMode && defaultPhase === 'processing'}
                      >
                        Pre-processing{isEditMode && defaultPhase === 'processing' ? ' (Phase Ended)' : ''}
                      </SelectItem>
                      <SelectItem value="processing" className="text-xs">
                        Processing
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Primary Assignee Dropdown */}
                <div className="w-28 shrink-0">
                  <Select
                    value={task.assigneeId || 'unassigned'}
                    onValueChange={(val) => {
                      const newId = val === 'unassigned' ? null : val;
                      handleUpdateTask(index, 'assigneeId', newId);
                    }}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] px-2 [&>span]:truncate text-[#1E293B]" aria-label="Primary assignee">
                      <SelectValue placeholder="Assignee" />
                    </SelectTrigger>
                    <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                      <SelectItem value="unassigned" className="text-xs">Unassigned</SelectItem>
                      {projectTeam.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-xs">
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Task Due Date */}
                <div className="w-40 shrink-0">
                  <DateInput
                    type="date"
                    value={task.dueDate ? (task.dueDate.includes('T') ? task.dueDate.split('T')[0] : task.dueDate) : ''}
                    onValueChange={(val) => handleUpdateTask(index, 'dueDate', val || null)}
                    disabled={disabled}
                    className="h-8 text-xs tabular-nums bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-[#1E293B]"
                    aria-label="Task due date"
                    title="Task Due Date"
                    data-testid={`task-due-date-input-${task.localId}`}
                  />
                </div>

                {/* Dependency Selector Dropdown Trigger */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setActiveDepDropdown(
                        activeDepDropdown === task.localId ? null : task.localId
                      )
                    }
                    disabled={disabled}
                    className="h-8 px-2 shrink-0 text-xs border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] flex items-center gap-1 focus:outline-none"
                    data-testid={`task-dep-btn-${task.localId}`}
                    title={`Dependencies: ${depDisplayText}`}
                    aria-label={`Dependencies: ${depDisplayText}`}
                    aria-expanded={activeDepDropdown === task.localId}
                  >
                    <Link2 className="h-3.5 w-3.5" />
                    <span>{currentDeps.includes('*') ? 'All' : currentDeps.length || '—'}</span>
                  </button>

                  {/* Dependency Dropdown Popover */}
                  {activeDepDropdown === task.localId && (
                    <div className="absolute right-0 top-9 z-50 w-80 max-w-[calc(100vw-3rem)] p-2 bg-[#FFFFFF] rounded-[6px] shadow-float border-[#E2E8F0] text-xs space-y-1">
                      <div className="font-bold text-[#1E293B] pb-1 border-b border-[#E2E8F0] text-xs tracking-normal">
                        Select Predecessor Tasks
                      </div>

                      {namedCandidates.length === 0 ? (
                        <div className="text-[#475569] italic py-1 text-center text-xs">
                          No named tasks available
                        </div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto space-y-1 py-1">
                          {/* Preceding all wildcard */}
                          {precedingNamed.length > 0 && (
                            <label className="flex items-center gap-2 p-1 hover:bg-[#F8FAFC] rounded-[6px] cursor-pointer font-bold text-[#1E293B]">
                              <input
                                type="checkbox"
                                checked={currentDeps.includes('*')}
                                onChange={() => handleToggleDependency(index, '*')}
                                className="rounded-[6px] text-[#1E293B]"
                              />
                              <span>All Tasks (*)</span>
                            </label>
                          )}

                          {namedCandidates.map((cand) => (
                            <label
                              key={cand.localId}
                              className="flex items-center gap-2 p-1 hover:bg-[#F8FAFC] rounded-[6px] cursor-pointer text-[#1E293B]"
                            >
                              <input
                                type="checkbox"
                                checked={
                                  currentDeps.includes(cand.localId) ||
                                  currentDeps.includes('*')
                                }
                                disabled={currentDeps.includes('*')}
                                onChange={() =>
                                  handleToggleDependency(index, cand.localId)
                                }
                                className="rounded-[6px] text-[#1E293B]"
                              />
                              <span className="truncate">{cand.title}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      <div className="pt-1 border-t border-[#E2E8F0] text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setActiveDepDropdown(null)}
                          className="h-6 text-xs text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] uppercase"
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Remove Task Row */}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleRemoveTask(index)}
                  disabled={disabled || tasks.length <= 1 || Boolean(task.deletionBlockedReason)}
                  className="text-[#475569] hover:text-[#DC2626] hover:bg-[#F8FAFC] rounded-[6px]"
                  aria-label="Remove task"
                  data-testid={`task-remove-btn-${task.localId}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {task.deletionBlockedReason && (
                <p className="text-sm text-[#475569]" data-testid={`task-delete-reason-${task.localId}`}>
                  {task.deletionBlockedReason}
                </p>
              )}

              {/* Delimiter Tokenizer Live Preview */}
              {tokenizer.shouldSplit && (
                <div
                  className="p-2 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-xs space-y-1.5 ml-6"
                  data-testid={`task-tokenizer-preview-${task.localId}`}
                >
                  <div className="flex items-center justify-between text-[#1E293B] font-semibold">
                    <span>
                      Delimiter detected: will split into {tokenizer.count} sibling tasks
                    </span>
                    {tokenizer.exceedsLimit && (
                      <Badge variant="destructive" size="compact" className="rounded-[6px] text-xs">
                        Exceeds 50 task limit!
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tokenizer.tokens.slice(0, 10).map((tok, ti) => (
                      <Badge
                        key={ti}
                        variant="secondary"
                        size="compact"
                        className="bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] text-xs rounded-[6px]"
                      >
                        {tok}
                      </Badge>
                    ))}
                    {tokenizer.tokens.length > 10 && (
                      <span className="text-xs text-[#1E293B] font-semibold self-center">
                        +{tokenizer.tokens.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Co-Assignees & Subtasks Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pl-6 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[#475569] text-xs tracking-normal shrink-0">Co-Assignees:</span>
                  <div className="flex flex-wrap gap-1 items-center">
                    {task.coAssignees.map((cid) => {
                      const member = staffById.get(cid);
                      return (
                        <Badge
                          key={cid}
                          variant="secondary"
                          size="compact"
                          className="bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] text-xs rounded-[6px] flex items-center gap-1"
                        >
                          <span>{member?.name || cid}</span>
                          {!disabled && (
                            <button
                              type="button"
                              onClick={() => {
                                const filtered = task.coAssignees.filter((id) => id !== cid);
                                handleUpdateTask(index, 'coAssignees', filtered);
                              }}
                              className="text-[#475569] hover:text-[#DC2626] focus:outline-none"
                            >
                              <X className="h-2.5 w-2.5" />
                            </button>
                          )}
                        </Badge>
                      );
                    })}
                    {!disabled && (
                      <Select
                        value=""
                        onValueChange={(val) => {
                          if (val && !task.coAssignees.includes(val)) {
                            handleUpdateTask(index, 'coAssignees', [
                              ...task.coAssignees,
                              val,
                            ]);
                          }
                        }}
                      >
                        <SelectTrigger className="h-6 text-xs px-1.5 py-0 border-dashed border-[#E2E8F0] rounded-[6px] w-auto min-w-20 bg-[#FFFFFF] text-[#475569]">
                          <SelectValue placeholder="+ Co-worker" />
                        </SelectTrigger>
                        <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                          {projectTeam
                            .filter(
                              (m) =>
                                m.id !== task.assigneeId &&
                                !task.coAssignees.includes(m.id)
                            )
                            .map((m) => (
                              <SelectItem key={m.id} value={m.id} className="text-xs">
                                {m.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                {/* Subtasks / Checklist Quick Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {task.checklist && task.checklist.length > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => toggleExpand(task.localId)}
                      className="h-6 text-xs px-1.5 py-0 bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] flex items-center gap-1 font-medium"
                      title={isExpanded ? 'Collapse subtasks checklist' : 'Expand subtasks checklist'}
                      data-testid={`task-checklist-badge-${task.localId}`}
                    >
                      <CheckSquare className="h-3 w-3 text-[#1E293B]" />
                      <span>
                        Subtasks ({task.checklist.filter((c) => c.completed).length}/{task.checklist.length})
                      </span>
                    </Button>
                  ) : null}

                  {!checklistDisabled && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        if (!isExpanded) {
                          setExpandedRow(task.localId);
                        }
                        const current = task.checklist || [];
                        const newItem: ChecklistItemData = {
                          id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                            ? crypto.randomUUID()
                            : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                                const r = (Math.random() * 16) | 0;
                                return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
                              }),
                          text: '',
                          completed: false,
                          category: 'subtask',
                        };
                        handleUpdateTask(index, 'checklist', [...current, newItem]);
                      }}
                      className="h-6 text-xs px-1.5 py-0 border-dashed border-[#E2E8F0] rounded-[6px] text-[#1E293B] hover:bg-[#F8FAFC] flex items-center gap-1"
                      data-testid={`task-add-checklist-btn-${task.localId}`}
                    >
                      <Plus className="h-3 w-3 text-[#1E293B]" />
                      <span>Subtask</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded Sub-Panel: Description & Checklist Items */}
              {isExpanded && (
                <div className="pl-6 pt-2 space-y-3 border-t border-[#E2E8F0] mt-2">
                  {/* Task Description */}
                  <div>
                    <label className="text-xs tracking-normal text-[#475569] mb-1 block">
                      Description & Deliverables
                    </label>
                    <textarea
                      value={task.description || ''}
                      onChange={(e) =>
                        handleUpdateTask(index, 'description', e.target.value)
                      }
                      placeholder="Add details, instructions, or acceptance criteria (paste a list — we'll split it)..."
                      disabled={disabled}
                      rows={2}
                      className="resize-none w-full text-xs p-2 border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
                    />
                  </div>

                  {/* Checklist Items */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold tracking-normal text-[#1E293B] flex items-center gap-1.5">
                        <CheckSquare className="h-3.5 w-3.5 text-[#1E293B]" />
                        Checklist & Subtasks ({task.checklist?.length || 0})
                      </span>
                      {!checklistDisabled && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            const currentChecklist = task.checklist || [];
                            const newItem: ChecklistItemData = {
                              id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                                ? crypto.randomUUID()
                                : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                                    const r = (Math.random() * 16) | 0;
                                    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
                                  }),
                              text: '',
                              completed: false,
                              category: 'subtask',
                            };
                            handleUpdateTask(index, 'checklist', [
                              ...currentChecklist,
                              newItem,
                            ]);
                          }}
                          className="h-6 text-xs tracking-normal text-[#1E293B] hover:bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] gap-1"
                          data-testid={`add-subtask-btn-${task.localId}`}
                        >
                          <Plus className="h-3 w-3 mr-0.5" />
                          Add Subtask
                        </Button>
                      )}
                    </div>

                    {task.checklist && task.checklist.length > 0 ? (
                      <div className="space-y-1.5 bg-[#F8FAFC] p-2 rounded-[8px] border-[#E2E8F0]">
                        {task.checklist.map((item, ci) => {
                          const isBlocked =
                            item.dependsOn &&
                            task.checklist?.some(
                              (other) =>
                                [item.dependsOn].flat().includes(other.id) && !other.completed
                            );

                          return (
                            <div
                              key={item.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              {/* Checkbox */}
                              <input
                                type="checkbox"
                                checked={item.completed}
                                disabled={checklistDisabled || Boolean(isBlocked)}
                                onChange={(e) => {
                                  const updatedChecklist = [...(task.checklist || [])];
                                  const targetItem = updatedChecklist[ci];
                                  if (targetItem) {
                                    updatedChecklist[ci] = {
                                      ...targetItem,
                                      completed: e.target.checked,
                                    };
                                    handleUpdateTask(index, 'checklist', updatedChecklist);
                                  }
                                }}
                                className="rounded-[6px] text-[#1E293B]"
                              />

                              {/* Title input */}
                              <input
                                type="text"
                                value={item.text}
                                disabled={checklistDisabled}
                                onChange={(e) => {
                                  const updatedChecklist = [...(task.checklist || [])];
                                  const targetItem = updatedChecklist[ci];
                                  if (targetItem) {
                                    updatedChecklist[ci] = {
                                      ...targetItem,
                                      text: e.target.value,
                                    };
                                    handleUpdateTask(index, 'checklist', updatedChecklist);
                                  }
                                }}
                                placeholder="Checklist item text..."
                                className="flex-1 text-xs border-0 bg-transparent focus:ring-0 p-0 text-[#1E293B] placeholder:text-[#475569]"
                              />

                              {/* Category toggle: Doc vs Subtask */}
                              <button
                                type="button"
                                disabled={checklistDisabled}
                                onClick={() => {
                                  const updatedChecklist = [...(task.checklist || [])];
                                  const targetItem = updatedChecklist[ci];
                                  if (targetItem) {
                                    const nextCat =
                                      targetItem.category === 'document'
                                        ? 'subtask'
                                        : 'document';
                                    updatedChecklist[ci] = {
                                      ...targetItem,
                                      category: nextCat,
                                    };
                                    handleUpdateTask(index, 'checklist', updatedChecklist);
                                  }
                                }}
                                className={`px-1.5 py-0.5 text-xs rounded-[6px] border ${item.category === 'document' ? 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]' : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]'}`}
                              >
                                {item.category === 'document' ? (
                                  <span className="flex items-center gap-1">
                                    <FileText className="h-2.5 w-2.5" /> Doc
                                  </span>
                                ) : (
                                  <span>Sub-task</span>
                                )}
                              </button>

                              {/* Period Year (if document) */}
                              {item.category === 'document' && !item.periodYear && !yearFields.has(item.id) && !checklistDisabled && (
                                <button type="button" className="text-xs text-[#475569]"
                                  onClick={() => setYearFields((current) => new Set([...current, item.id]))}>+ Year</button>
                              )}
                              {item.category === 'document' && (Boolean(item.periodYear) || yearFields.has(item.id)) && (
                                <input
                                  type="number"
                                  value={item.periodYear ?? ''}
                                  aria-label={`Document year for ${item.text || 'new checklist item'}`}
                                  placeholder="Year"
                                  onBlur={(event) => {
                                    if (!event.target.value) setYearFields((current) => {
                                      const next = new Set(current); next.delete(item.id); return next;
                                    });
                                  }}
                                  disabled={checklistDisabled}
                                  onChange={(e) => {
                                    const updatedChecklist = [...(task.checklist || [])];
                                    const targetItem = updatedChecklist[ci];
                                    if (targetItem) {
                                      updatedChecklist[ci] = {
                                        ...targetItem,
                                        periodYear: parseInt(e.target.value, 10) || null,
                                      };
                                      handleUpdateTask(
                                        index,
                                        'checklist',
                                        updatedChecklist
                                      );
                                    }
                                  }}
                                  className="w-14 text-xs p-0.5 border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-center"
                                />
                              )}

                              {/* Blocked lock icon */}
                              {isBlocked && (
                                <span
                                  className="text-xs text-[#DC2626] flex items-center gap-0.5"
                                  title={`🔒 Waiting for prerequisite`}
                                >
                                  <Lock className="h-3 w-3" />
                                </span>
                              )}

                              {/* Remove checklist item */}
                              {!checklistDisabled && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedChecklist = (
                                      task.checklist || []
                                    ).filter((_, i) => i !== ci);
                                    handleUpdateTask(index, 'checklist', updatedChecklist);
                                  }}
                                  className="text-[#475569] hover:text-[#DC2626]"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-[#475569] italic">
                        No checklist items.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add Task Button */}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddTask}
          data-testid="add-task-btn"
          className="w-full border-dashed border-[#E2E8F0] text-xs tracking-normal text-[#1E293B] hover:bg-[#F8FAFC] rounded-[6px] h-8"
        >
          <Plus className="h-3.5 w-3.5 mr-1 text-[#1E293B]" />
          Add task
        </Button>
      )}
    </div>
  );
}
