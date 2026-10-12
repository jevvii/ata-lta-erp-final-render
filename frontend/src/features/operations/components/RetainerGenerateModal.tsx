import React, { useState, useMemo, useEffect } from 'react';
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
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, Layers, Calendar } from 'lucide-react';
import { useRetainerTemplates, useRetainerMutations } from '../api/useRetainers';
import { useClients } from '../api/useClients';
import { useTeam } from '../api/useTeam';
import { AssignerSelect } from './AssignerSelect';
import { runBlockingAction } from './BlockingActionModal';
import { operationsKeys } from '../api/queryKeys';
import { useSessionStore } from '@/lib/session';
import { resolveEntityCodeFromUUID } from '@/lib/realtime';
import type {
  RetainerGenerateResponse,
  RetainerTemplateTask,
  ChecklistItemData,
  Priority,
  CreatablePhase,
} from '../api/types';

export interface RetainerGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (res: RetainerGenerateResponse) => void;
}

interface BlueprintTask {
  local_id: string;
  title: string;
  description?: string | null;
  phase: CreatablePhase;
  assignees: string[];
  depends_on?: string | null;
  dueDate?: string | null;
  checklist?: ChecklistItemData[];
}

export function RetainerGenerateModal({
  isOpen,
  onClose,
  onSuccess,
}: RetainerGenerateModalProps) {
  const [templateId, setTemplateId] = useState<string>('');
  const [periodLabel, setPeriodLabel] = useState<string>(
    String(new Date().getFullYear())
  );
  const [clientId, setClientId] = useState<string>('');
  const [dueDate, setDueDate] = useState<string>('');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [coAssignees, setCoAssignees] = useState<string[]>([]);
  const [blueprintTasks, setBlueprintTasks] = useState<BlueprintTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);

  const { data: templates = [], isLoading: isTemplatesLoading } =
    useRetainerTemplates({ enabled: isOpen });
  const { data: clients = [] } = useClients(undefined, { enabled: isOpen });
  const { data: team = [] } = useTeam();
  const { generateFromTemplate } = useRetainerMutations();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const selectedTemplate = templates.find((t) => t.id === templateId);

  // Sync template defaults when template is selected
  useEffect(() => {
    if (!selectedTemplate) {
      setBlueprintTasks([]);
      return;
    }

    if (selectedTemplate.clientId || selectedTemplate.client_id) {
      setClientId(selectedTemplate.clientId || selectedTemplate.client_id || '');
    }
    const tplPriority =
      selectedTemplate.priority ||
      selectedTemplate.defaultPriority ||
      selectedTemplate.default_priority;
    if (tplPriority) {
      setPriority(tplPriority as Priority);
    }

    const tasksFromTemplate = Array.isArray(selectedTemplate.tasks)
      ? selectedTemplate.tasks
      : [];

    setBlueprintTasks(
      tasksFromTemplate.map((t: RetainerTemplateTask, idx: number) => {
        const localId =
          t.local_id || t.localId || t.id || `tpl_task_${idx + 1}`;
        const rawAssignees =
          (Array.isArray(t.assignees) && t.assignees.length > 0)
            ? t.assignees
            : (Array.isArray(t.default_assignees) && t.default_assignees.length > 0)
            ? t.default_assignees
            : (Array.isArray(t.defaultAssignees) && t.defaultAssignees.length > 0)
            ? t.defaultAssignees
            : [
                t.assigneeId,
                t.assigned_to,
                ...(Array.isArray(t.coAssignees) ? t.coAssignees : []),
                ...(Array.isArray(t.co_assignees) ? t.co_assignees : []),
              ].filter((id): id is string => typeof id === 'string' && Boolean(id));

        const dependsOn =
          t.depends_on ??
          t.dependsOn ??
          t.depends_on_local_id ??
          t.dependsOnLocalId ??
          null;

        return {
          local_id: localId,
          title: t.title,
          description: t.description || null,
          phase: (t.phase === 'processing'
            ? 'processing'
            : 'pre_processing') as CreatablePhase,
          assignees: Array.isArray(rawAssignees) ? rawAssignees : [],
          depends_on: dependsOn,
          dueDate: t.dueDate || t.due_date || null,
          checklist: t.checklist || [],
        };
      })
    );
  }, [selectedTemplate]);

  // Project Team Members strictly: Manager (assignedTo) + Co-Assignees
  const projectTeam = useMemo(() => {
    return team.filter(
      (m) => (assignedTo && m.id === assignedTo) || coAssignees.includes(m.id)
    );
  }, [team, assignedTo, coAssignees]);

  const projectTeamIds = useMemo(() => {
    return new Set(projectTeam.map((m) => m.id));
  }, [projectTeam]);

  // Check for any tasks assigned to members outside the project team
  const unmappedTasks = useMemo(() => {
    return blueprintTasks.filter((t) =>
      t.assignees.some((id) => !projectTeamIds.has(id))
    );
  }, [blueprintTasks, projectTeamIds]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId) {
      setError('Please select a retainer template.');
      return;
    }

    if (selectedTemplate?.recurrence === 'annual' && !periodLabel.trim()) {
      setError('Period label is required for annual recurring templates.');
      return;
    }

    // Mandatory Manager Lead governance
    if (!assignedTo) {
      setManagerError('Manager is required to generate work requests.');
      setError('Manager is required to generate work requests.');
      return;
    }

    // Strict task assignee scoping check
    if (unmappedTasks.length > 0) {
      setError(
        'All task assignees must belong to the selected project team. Please update unmapped assignees.'
      );
      return;
    }

    setError(null);
    setManagerError(null);

    await runBlockingAction({
      title: 'Generating Work Requests',
      message: `Generating work requests from template "${selectedTemplate?.name}"...`,
      apiCall: async () => {
        return await generateFromTemplate({
          templateId,
          period_label: periodLabel.trim() || undefined,
          overrides: {
            clientId: clientId || selectedTemplate?.clientId || selectedTemplate?.client_id || undefined,
            priority,
            dueDate: dueDate || undefined,
            assignedTo,
            coAssignees,
            tasks: blueprintTasks.map((t) => ({
              local_id: t.local_id,
              title: t.title,
              description: t.description || null,
              phase: t.phase,
              assignees: t.assignees,
              depends_on: t.depends_on || null,
              dueDate: t.dueDate || null,
              checklist: t.checklist || [],
            })),
          },
        });
      },
      successTitle: 'Work Requests Generated',
      successMessage: 'Successfully generated work requests from retainer template.',
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeEntity),
        operationsKeys.templates(),
      ],
      onSuccess: (data) => {
        if (onSuccess && data) {
          onSuccess(data as RetainerGenerateResponse);
        }
        onClose();
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        data-testid="retainer-generate-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-slate-900">
            Generate from Retainer Template
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600 pt-1">
            Create recurring work requests with full project team governance and scoped tasks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleGenerate} className="space-y-4">
          {/* Template Selection */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Retainer Template <span className="text-red-500">*</span>
            </label>
            <Select
              value={templateId || 'unselected'}
              onValueChange={(val) => {
                setTemplateId(val === 'unselected' ? '' : val);
                if (error) setError(null);
              }}
              disabled={isTemplatesLoading}
            >
              <SelectTrigger
                className="h-9 bg-white"
                data-testid="template-select"
              >
                <SelectValue placeholder="Select Template..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unselected">— Choose Template —</SelectItem>
                {templates.map((tpl) => {
                  const entityCode =
                    (tpl.entity && tpl.entity.length <= 4 ? tpl.entity : undefined) ||
                    ((tpl as any).entities?.code && (tpl as any).entities.code.length <= 4
                      ? (tpl as any).entities.code
                      : undefined) ||
                    resolveEntityCodeFromUUID(tpl.entity_id);
                  const metaParts: string[] = [];
                  if (entityCode) {
                    metaParts.push(entityCode);
                  }
                  if (tpl.recurrence && tpl.recurrence !== 'none') {
                    metaParts.push(tpl.recurrence);
                  }
                  const meta = metaParts.length > 0 ? ` (${metaParts.join(' • ')})` : '';

                  return (
                    <SelectItem key={tpl.id} value={tpl.id}>
                      {tpl.name}{meta}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Period Label Prompt */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Period Label
              {selectedTemplate?.recurrence === 'annual' && (
                <span className="text-red-500"> *</span>
              )}
            </label>
            <Input
              value={periodLabel}
              onChange={(e) => {
                setPeriodLabel(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. 2026, Q1 2026, January 2026"
              className="h-9 bg-white text-xs"
              data-testid="period-label-input"
            />
            <span className="text-[11px] text-slate-400">
              Appended to generated work request titles (e.g. "Annual Tax Return - 2026")
            </span>
          </div>

          {/* Header Overrides Grid: Client, Due Date, Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Target Client Override */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Target Client
              </label>
              <Select
                value={clientId || 'all'}
                onValueChange={(val) => setClientId(val === 'all' ? '' : val)}
              >
                <SelectTrigger className="h-9 bg-white text-xs" data-testid="client-select">
                  <SelectValue placeholder="All retainer clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">— All Retainer Clients —</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">
                      {c.name} ({c.entity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Due Date Override */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                <Calendar className="h-3 w-3 text-slate-500" />
                <span>Due Date</span>
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="h-9 bg-white text-xs"
                data-testid="due-date-input"
              />
            </div>

            {/* Priority Override */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Priority
              </label>
              <Select
                value={priority}
                onValueChange={(val) => setPriority(val as Priority)}
              >
                <SelectTrigger className="h-9 bg-white text-xs" data-testid="priority-select">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low" className="text-xs">Low</SelectItem>
                  <SelectItem value="Normal" className="text-xs">Normal</SelectItem>
                  <SelectItem value="High" className="text-xs">High</SelectItem>
                  <SelectItem value="Urgent" className="text-xs">Urgent</SelectItem>
                </SelectContent>
              </Select>
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
                if (error) setError(null);
                if (managerError) setManagerError(null);
              }}
              onCoAssigneesChange={(newCo) => {
                setCoAssignees(newCo);
                if (error) setError(null);
              }}
            />
            {managerError && (
              <span className="text-[11px] text-red-600 block" data-testid="manager-error">
                {managerError}
              </span>
            )}
          </div>

          {/* Task Blueprint Preview & Mapping */}
          {selectedTemplate && blueprintTasks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-200" data-testid="task-blueprint-preview">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-slate-500" />
                  <span>Task Blueprint Preview & Mapping ({blueprintTasks.length})</span>
                </label>
                <span className="text-[11px] text-slate-400">
                  Assignees strictly scoped to project team
                </span>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {blueprintTasks.map((task, idx) => {
                  const isUnmapped = task.assignees.some((id) => !projectTeamIds.has(id));
                  const unmappedMember = isUnmapped
                    ? team.find((m) => task.assignees.includes(m.id))
                    : null;
                  const unmappedName = unmappedMember?.name || (isUnmapped ? task.assignees[0] : null);

                  return (
                    <div
                      key={task.local_id || idx}
                      data-testid={`blueprint-task-${task.local_id}`}
                      className={`p-2.5 rounded-md border text-xs space-y-1.5 ${
                        isUnmapped
                          ? 'bg-amber-50/50 border-amber-200'
                          : 'bg-slate-50/60 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-[11px] font-mono text-slate-400 shrink-0">
                            #{idx + 1}
                          </span>
                          <span className="font-medium text-slate-800 truncate" title={task.title}>
                            {task.title}
                          </span>
                        </div>
                        <Badge
                          variant={task.phase === 'processing' ? 'default' : 'secondary'}
                          className="text-[10px] shrink-0 font-normal uppercase"
                        >
                          {task.phase === 'processing' ? 'Processing' : 'Pre-Processing'}
                        </Badge>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="text-[11px] text-slate-500 truncate">
                          {task.depends_on && (
                            <span>
                              Prerequisite: <span className="font-mono">{task.depends_on}</span>
                            </span>
                          )}
                        </div>

                        <div className="w-48 shrink-0">
                          <Select
                            value={
                              task.assignees[0] && projectTeamIds.has(task.assignees[0])
                                ? task.assignees[0]
                                : isUnmapped
                                ? '__unmapped__'
                                : 'unassigned'
                            }
                            onValueChange={(val) => {
                              if (!val || val === '__unmapped__') return;
                              const newAssignees = val === 'unassigned' ? [] : [val];
                              setBlueprintTasks((prev) =>
                                prev.map((t) =>
                                  t.local_id === task.local_id
                                    ? { ...t, assignees: newAssignees }
                                    : t
                                )
                              );
                              if (error) setError(null);
                            }}
                          >
                            <SelectTrigger
                              className="h-8 text-xs bg-white"
                              data-testid={`task-assignee-select-${task.local_id}`}
                            >
                              <SelectValue placeholder="— Unassigned —" />
                            </SelectTrigger>
                            <SelectContent>
                              {isUnmapped && (
                                <SelectItem value="__unmapped__" disabled className="text-xs text-amber-600">
                                  ⚠️ Unmapped ({unmappedName || 'Template Default'})
                                </SelectItem>
                              )}
                              <SelectItem value="unassigned">— Unassigned —</SelectItem>
                              {projectTeam.map((m) => (
                                <SelectItem key={m.id} value={m.id} className="text-xs">
                                  {m.name} ({m.role})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {isUnmapped && (
                        <div
                          className="text-[11px] text-amber-700 bg-amber-100/60 p-1.5 rounded flex items-center gap-1.5"
                          data-testid={`unmapped-assignee-alert-${task.local_id}`}
                        >
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <span>
                            Template default assignee {unmappedName ? `"${unmappedName}" ` : ''}is not in the assigned team. Please select an assignee from the team or add them to Team Members.
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 font-medium" data-testid="generate-error">
              {error}
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
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
              type="submit"
              size="sm"
              disabled={!templateId}
              data-testid="generate-submit-btn"
              className="text-xs font-semibold"
            >
              Generate Work Requests
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
