import React, { useState } from 'react';
import {
  GripVertical,
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
import type { TeamMember } from '../api/useTeam';
import type { CreatablePhase } from '../api/types';

export interface ChecklistItemData {
  id: string;
  text: string;
  completed: boolean;
  category?: 'subtask' | 'document';
  periodYear?: number | null;
  dependsOn?: string | null;
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
}

export interface TaskLineItemsProps {
  tasks: TaskItemData[];
  onChange: (tasks: TaskItemData[]) => void;
  projectTeam: TeamMember[];
  disabled?: boolean;
  isEditMode?: boolean;
}

export function TaskLineItems({
  tasks,
  onChange,
  projectTeam,
  disabled = false,
  isEditMode: _isEditMode = false,
}: TaskLineItemsProps) {
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
      phase: 'pre_processing',
      coAssignees: [],
      checklist: [],
      dependsOn: null,
    };
    onChange([...tasks, newTask]);
    setExpandedRow(newLocalId);
  };

  const handleRemoveTask = (index: number) => {
    const target = tasks[index];
    if (!target) return;
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
        <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
          Tasks ({tasks.length})
        </h4>
        <span className="text-[11px] text-slate-400">
          Notion-style line items • Paste a list — we'll split it
        </span>
      </div>

      {/* Cycle Detection Warning Banner */}
      {cycleResult.hasCycle && (
        <div
          className="p-2.5 bg-red-50 border border-red-200 rounded-md flex items-center gap-2 text-xs text-red-700"
          data-testid="dependency-cycle-warning"
        >
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
          <span>{cycleResult.error || 'Circular dependency detected between tasks.'}</span>
        </div>
      )}

      {/* Line Items Container */}
      <div className="border border-slate-200 rounded-md divide-y divide-slate-100 bg-white">
        {tasks.map((task, index) => {
          const isExpanded = expandedRow === task.localId;
          const tokenizer = parseTaskDelimiterInput(task.title);

          // Predecessors candidate calculation:
          // Named tasks only, excluding self
          const namedCandidates = tasks.filter(
            (t) => t.localId !== task.localId && t.title.trim().length > 0
          );
          const precedingNamed = tasks
            .slice(0, index)
            .filter((t) => t.title.trim().length > 0);

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
                isExpanded ? 'bg-slate-50/70' : 'hover:bg-slate-50/40'
              }`}
              data-testid={`task-row-${task.localId}`}
            >
              {/* Primary Row Controls */}
              <div className="flex items-center gap-2">
                {/* Drag handle placeholder */}
                <div className="text-slate-400 cursor-grab px-0.5">
                  <GripVertical className="h-4 w-4" />
                </div>

                {/* Expand / Collapse Toggle */}
                <button
                  type="button"
                  onClick={() => toggleExpand(task.localId)}
                  className="text-slate-500 hover:text-slate-800 p-0.5 rounded focus:outline-none"
                  aria-label="Toggle task details"
                  data-testid={`task-expand-toggle-${task.localId}`}
                >
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                {/* Task Title Input */}
                <div className="flex-1 min-w-0">
                  <Input
                    value={task.title}
                    onChange={(e) => handleUpdateTask(index, 'title', e.target.value)}
                    placeholder="Task title (paste a list — we'll split it)..."
                    disabled={disabled}
                    className="h-8 text-xs bg-white"
                    data-testid={`task-title-input-${task.localId}`}
                  />
                </div>

                {/* Phase Badge / Selector (immutable in edit mode) */}
                <div className="w-28 shrink-0">
                  <Select
                    value={task.phase}
                    onValueChange={(val) =>
                      handleUpdateTask(index, 'phase', val as CreatablePhase)
                    }
                    disabled={disabled || Boolean(task.id)}
                  >
                    <SelectTrigger className="h-8 text-[11px] bg-white">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pre_processing" className="text-xs">
                        Pre-processing
                      </SelectItem>
                      <SelectItem value="processing" className="text-xs">
                        Processing
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Primary Assignee Dropdown */}
                <div className="w-36 shrink-0">
                  <Select
                    value={task.assigneeId || 'unassigned'}
                    onValueChange={(val) => {
                      const newId = val === 'unassigned' ? null : val;
                      handleUpdateTask(index, 'assigneeId', newId);
                    }}
                    disabled={disabled}
                  >
                    <SelectTrigger className="h-8 text-[11px] bg-white">
                      <SelectValue placeholder="Assignee" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">— Unassigned —</SelectItem>
                      {projectTeam.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-xs">
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                    className="h-8 px-2 max-w-36 truncate text-[11px] font-normal border border-slate-200 rounded-md bg-white text-slate-600 hover:bg-slate-50 flex items-center gap-1 focus:outline-none"
                    data-testid={`task-dep-btn-${task.localId}`}
                    title={depDisplayText}
                  >
                    <span className="truncate">{depDisplayText}</span>
                  </button>

                  {/* Dependency Dropdown Popover */}
                  {activeDepDropdown === task.localId && (
                    <div className="absolute right-0 top-9 z-50 w-56 p-2 bg-white rounded-md shadow-lg border border-slate-200 text-xs space-y-1">
                      <div className="font-semibold text-slate-500 pb-1 border-b text-[10px] uppercase">
                        Select Predecessor Tasks
                      </div>

                      {namedCandidates.length === 0 ? (
                        <div className="text-slate-400 italic py-1 text-center text-xs">
                          No named tasks available
                        </div>
                      ) : (
                        <div className="max-h-40 overflow-y-auto space-y-1 py-1">
                          {/* Preceding all wildcard */}
                          {precedingNamed.length > 0 && (
                            <label className="flex items-center gap-2 p-1 hover:bg-slate-50 rounded cursor-pointer font-medium text-blue-700">
                              <input
                                type="checkbox"
                                checked={currentDeps.includes('*')}
                                onChange={() => handleToggleDependency(index, '*')}
                                className="rounded text-blue-600"
                              />
                              <span>All Tasks (*)</span>
                            </label>
                          )}

                          {namedCandidates.map((cand) => (
                            <label
                              key={cand.localId}
                              className="flex items-center gap-2 p-1 hover:bg-slate-50 rounded cursor-pointer text-slate-700"
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
                                className="rounded text-blue-600"
                              />
                              <span className="truncate">{cand.title}</span>
                            </label>
                          ))}
                        </div>
                      )}

                      <div className="pt-1 border-t text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setActiveDepDropdown(null)}
                          className="h-6 text-[11px]"
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
                  disabled={disabled || tasks.length <= 1}
                  className="text-slate-400 hover:text-red-600"
                  aria-label="Remove task"
                  data-testid={`task-remove-btn-${task.localId}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Delimiter Tokenizer Live Preview */}
              {tokenizer.shouldSplit && (
                <div
                  className="p-2 bg-blue-50/70 border border-blue-100 rounded text-xs space-y-1.5 ml-6"
                  data-testid={`task-tokenizer-preview-${task.localId}`}
                >
                  <div className="flex items-center justify-between text-blue-800 font-medium">
                    <span>
                      Delimiter detected: will split into {tokenizer.count} sibling tasks
                    </span>
                    {tokenizer.exceedsLimit && (
                      <Badge variant="destructive" size="compact">
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
                        className="bg-white border text-slate-700 text-[10px]"
                      >
                        {tok}
                      </Badge>
                    ))}
                    {tokenizer.tokens.length > 10 && (
                      <span className="text-[10px] text-blue-600 font-medium self-center">
                        +{tokenizer.tokens.length - 10} more
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Co-Assignees & Subtasks Action Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pl-6 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-slate-400 text-[11px] shrink-0">Co-Assignees:</span>
                  <div className="flex flex-wrap gap-1 items-center">
                    {task.coAssignees.map((cid) => {
                      const member = staffById.get(cid);
                      return (
                        <Badge
                          key={cid}
                          variant="secondary"
                          size="compact"
                          className="bg-slate-100 text-slate-700 text-[10px] flex items-center gap-1"
                        >
                          <span>{member?.name || cid}</span>
                          {!disabled && (
                            <button
                              type="button"
                              onClick={() => {
                                const filtered = task.coAssignees.filter((id) => id !== cid);
                                handleUpdateTask(index, 'coAssignees', filtered);
                              }}
                              className="text-slate-400 hover:text-slate-700 focus:outline-none"
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
                        <SelectTrigger className="h-5 text-[10px] px-1.5 py-0 border-dashed w-auto min-w-20 bg-transparent text-slate-500">
                          <SelectValue placeholder="+ Co-worker" />
                        </SelectTrigger>
                        <SelectContent>
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
                      className="h-5 text-[10px] px-1.5 py-0 bg-blue-50/70 border-blue-200 text-blue-700 hover:bg-blue-100 flex items-center gap-1 font-medium"
                      title={isExpanded ? 'Collapse subtasks checklist' : 'Expand subtasks checklist'}
                      data-testid={`task-checklist-badge-${task.localId}`}
                    >
                      <CheckSquare className="h-2.5 w-2.5 text-blue-600" />
                      <span>
                        Subtasks ({task.checklist.filter((c) => c.completed).length}/{task.checklist.length})
                      </span>
                    </Button>
                  ) : null}

                  {!disabled && (
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
                          id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                          text: '',
                          completed: false,
                          category: 'subtask',
                        };
                        handleUpdateTask(index, 'checklist', [...current, newItem]);
                      }}
                      className="h-5 text-[10px] px-1.5 py-0 border border-dashed border-slate-200 text-slate-500 hover:text-blue-600 hover:border-blue-300 flex items-center gap-1"
                      data-testid={`task-add-checklist-btn-${task.localId}`}
                    >
                      <Plus className="h-2.5 w-2.5 text-slate-400" />
                      <span>+ Subtask</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Expanded Sub-Panel: Description & Checklist Items */}
              {isExpanded && (
                <div className="pl-6 pt-2 space-y-3 border-t border-slate-100 mt-2">
                  {/* Task Description */}
                  <div>
                    <label className="text-[11px] font-medium text-slate-500 mb-1 block">
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
                      className="w-full text-xs p-2 border border-slate-200 rounded bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Checklist Items */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                        <CheckSquare className="h-3.5 w-3.5 text-blue-600" />
                        Checklist & Subtasks ({task.checklist?.length || 0})
                      </span>
                      {!disabled && (
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          onClick={() => {
                            const currentChecklist = task.checklist || [];
                            const newItem: ChecklistItemData = {
                              id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                              text: '',
                              completed: false,
                              category: 'subtask',
                            };
                            handleUpdateTask(index, 'checklist', [
                              ...currentChecklist,
                              newItem,
                            ]);
                          }}
                          className="h-6 text-[11px] text-blue-600 hover:bg-blue-50 border-blue-200 gap-1"
                          data-testid={`add-subtask-btn-${task.localId}`}
                        >
                          <Plus className="h-3 w-3 mr-0.5" />
                          Add Subtask
                        </Button>
                      )}
                    </div>

                    {task.checklist && task.checklist.length > 0 ? (
                      <div className="space-y-1.5 bg-white p-2 rounded border border-slate-100">
                        {task.checklist.map((item, ci) => {
                          const isBlocked =
                            item.dependsOn &&
                            task.checklist?.some(
                              (other) =>
                                other.id === item.dependsOn && !other.completed
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
                                disabled={disabled || Boolean(isBlocked)}
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
                                className="rounded text-blue-600"
                              />

                              {/* Title input */}
                              <input
                                type="text"
                                value={item.text}
                                disabled={disabled}
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
                                className="flex-1 text-xs border-0 bg-transparent focus:ring-0 p-0 text-slate-800 placeholder:text-slate-400"
                              />

                              {/* Category toggle: Doc vs Subtask */}
                              <button
                                type="button"
                                disabled={disabled}
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
                                className="px-1.5 py-0.5 text-[10px] rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                              >
                                {item.category === 'document' ? (
                                  <span className="flex items-center gap-1 text-blue-700">
                                    <FileText className="h-2.5 w-2.5" /> Doc
                                  </span>
                                ) : (
                                  <span>Sub-task</span>
                                )}
                              </button>

                              {/* Period Year (if document) */}
                              {item.category === 'document' && (
                                <input
                                  type="number"
                                  value={item.periodYear || new Date().getFullYear()}
                                  disabled={disabled}
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
                                  className="w-14 text-[10px] p-0.5 border border-slate-200 rounded text-center"
                                />
                              )}

                              {/* Blocked lock icon */}
                              {isBlocked && (
                                <span
                                  className="text-[10px] text-amber-600 flex items-center gap-0.5"
                                  title={`🔒 Waiting for prerequisite`}
                                >
                                  <Lock className="h-3 w-3" />
                                </span>
                              )}

                              {/* Remove checklist item */}
                              {!disabled && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedChecklist = (
                                      task.checklist || []
                                    ).filter((_, i) => i !== ci);
                                    handleUpdateTask(index, 'checklist', updatedChecklist);
                                  }}
                                  className="text-slate-300 hover:text-red-500"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic">
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
          className="w-full border-dashed text-xs text-slate-600 hover:text-slate-900 h-8"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add task
        </Button>
      )}
    </div>
  );
}
