import React, { useState, useEffect, useMemo } from 'react';
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
import { DateInput } from '@/components/ui/date-input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertCircle, Layers, Calendar } from 'lucide-react';
import { useRetainerTemplates, useRetainerMutations } from '../api/useRetainers';
import { useClients } from '../api/useClients';
import {
  getDuplicateClientIds,
  matchesClientSearch,
  sortClients,
  DEFAULT_CLIENT_SORT,
  type ClientSortOption,
} from '@/features/clients/lib/clientSelectUtils';
import { ClientSelectOptionContent, ClientSelectSearchHeader } from '@/components/ui/client-select-option';
import { useTeam, type TeamMember } from '../api/useTeam';
import { useUsersList } from '@/features/admin/api/useUsers';
import { AssignerSelect } from './AssignerSelect';
import { TaskTypeBadge } from '../lib/taskTypes';
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
  requiredLinkType?: string | null;
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
  const [clientSearch, setClientSearch] = useState<string>('');
  const [clientSort, setClientSort] = useState<ClientSortOption>(DEFAULT_CLIENT_SORT);
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
  const duplicateClientIds = useMemo(() => getDuplicateClientIds(clients), [clients]);
  const sortedClients = useMemo(() => sortClients(clients, clientSort), [clients, clientSort]);

  const { data: team = [] } = useTeam();
  const { data: usersData = [] } = useUsersList({ enabled: isOpen });

  // Merge team and usersData into a consolidated staff directory
  const mergedStaff = useMemo(() => {
    const map = new Map<string, TeamMember>();
    for (const m of team) {
      if (m && m.id) {
        map.set(m.id.toLowerCase(), m);
      }
    }
    for (const u of usersData) {
      if (u && u.id && !map.has(u.id.toLowerCase())) {
        map.set(u.id.toLowerCase(), {
          id: u.id,
          name: u.name || u.email,
          email: u.email,
          role: u.role || 'Staff',
          departments: u.departments || [],
          entities: u.entities || [],
        });
      }
    }
    return Array.from(map.values());
  }, [team, usersData]);

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
          requiredLinkType: t.requiredLinkType ?? t.required_link_type ?? null,
          checklist: t.checklist || [],
        };
      })
    );
  }, [selectedTemplate]);

  // ID normalizer for case-insensitive and trimmed ID matching
  const normId = (id: string | null | undefined) => String(id || '').trim().toLowerCase();

  // Project team IDs derived directly from assignedTo and coAssignees
  const projectTeamIds = useMemo(() => {
    const ids = new Set<string>();
    if (assignedTo) {
      ids.add(assignedTo);
      ids.add(normId(assignedTo));
    }
    for (const id of coAssignees) {
      if (id) {
        ids.add(id);
        ids.add(normId(id));
      }
    }
    return ids;
  }, [assignedTo, coAssignees]);

  // Project Team Members strictly: Manager (assignedTo) + Co-Assignees
  const projectTeam = useMemo(() => {
    const governanceIds = [assignedTo, ...coAssignees].filter(Boolean) as string[];
    const result: TeamMember[] = [];
    const seen = new Set<string>();

    for (const gid of governanceIds) {
      const nid = normId(gid);
      if (seen.has(nid)) continue;
      seen.add(nid);

      const found = mergedStaff.find((m) => normId(m.id) === nid || m.id === gid);
      if (found) {
        result.push(found);
      } else {
        result.push({
          id: gid,
          name: gid,
          email: '',
          role: gid === assignedTo ? 'Manager' : 'Staff',
        });
      }
    }
    return result;
  }, [assignedTo, coAssignees, mergedStaff]);

  // Check for any tasks assigned to members outside the project team
  const unmappedTasks = useMemo(() => {
    return blueprintTasks.filter(
      (t) =>
        t.assignees.length > 0 &&
        t.assignees.some((id) => !projectTeamIds.has(id) && !projectTeamIds.has(normId(id)))
    );
  }, [blueprintTasks, projectTeamIds]);

  // Automatically clear assignee blocker error as soon as all unmapped tasks are resolved
  useEffect(() => {
    if (
      error ===
      'All task assignees must belong to the selected project team. Please update unmapped assignees.'
    ) {
      if (unmappedTasks.length === 0) {
        setError(null);
      }
    }
  }, [unmappedTasks.length, error]);

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

    if (!dueDate) {
      setError('Due date is required to generate work requests.');
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
            dueDate,
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
              requiredLinkType: t.requiredLinkType || null,
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
        className="max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden bg-white border-[#E2E8F0] text-[#0F172A] shadow-xl p-6 space-y-4 rounded-[12px] border"
        data-testid="retainer-generate-modal"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight text-[#1E293B]">
            Generate from Retainer Template
          </DialogTitle>
          <DialogDescription className="text-xs tabular-nums text-[#475569] pt-1">
            Create recurring work requests with full project team governance and scoped tasks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleGenerate} className="space-y-4 min-w-0 max-w-full overflow-x-hidden">
          {/* Template Selection */}
          <div className="space-y-1">
            <label className="text-xs tracking-normal text-[#475569] block">
              Retainer Template <span className="text-[#DC2626]">*</span>
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
                className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B]"
                data-testid="template-select"
              >
                <SelectValue placeholder="Select Template..." />
              </SelectTrigger>
              <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                <SelectItem value="unselected" className="text-xs">— Choose Template —</SelectItem>
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
                    <SelectItem key={tpl.id} value={tpl.id} className="text-xs">
                      {tpl.name}{meta}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Period Label Prompt */}
          <div className="space-y-1">
            <label className="text-xs tracking-normal text-[#475569] block">
              Period Label
              {selectedTemplate?.recurrence === 'annual' && (
                <span className="text-[#DC2626]"> *</span>
              )}
            </label>
            <Input
              value={periodLabel}
              onChange={(e) => {
                setPeriodLabel(e.target.value);
                if (error) setError(null);
              }}
              placeholder="e.g. 2026, Q1 2026, January 2026"
              className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B] placeholder:text-[#475569]"
              data-testid="period-label-input"
            />
            <span className="text-xs tabular-nums text-[#475569] block">
              Appended to generated work request titles (e.g. "Annual Tax Return - 2026")
            </span>
          </div>

          {/* Header Overrides Grid: Client, Due Date, Priority */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Target Client Override */}
            <div className="space-y-1">
              <label className="text-xs tracking-normal text-[#475569] block">
                Target Client
              </label>
              <Select
                value={clientId || 'all'}
                onValueChange={(val) => setClientId(val === 'all' ? '' : val)}
              >
                <SelectTrigger className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B]" data-testid="client-select">
                  <SelectValue placeholder="All retainer clients" />
                </SelectTrigger>
                <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                  <ClientSelectSearchHeader
                    value={clientSearch}
                    onChange={setClientSearch}
                    sortBy={clientSort}
                    onSortChange={setClientSort}
                  />
                  <SelectItem value="all" className="text-xs">— All Retainer Clients —</SelectItem>
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

            {/* Due Date Override */}
            <div className="space-y-1">
              <label className="text-xs tracking-normal text-[#475569] flex items-center gap-1">
                <Calendar className="h-3 w-3 text-[#475569]" />
                <span>Due Date *</span>
              </label>
              <DateInput
                type="date"
                value={dueDate}
                onValueChange={(val) => setDueDate(val)}
                className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] tabular-nums text-xs text-[#1E293B]"
                aria-label="Due Date"
                required
                data-testid="due-date-input"
              />
            </div>

            {/* Priority Override */}
            <div className="space-y-1">
              <label className="text-xs tracking-normal text-[#475569] block">
                Priority
              </label>
              <Select
                value={priority}
                onValueChange={(val) => setPriority(val as Priority)}
              >
                <SelectTrigger className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B]" data-testid="priority-select">
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                  <SelectItem value="Low" className="text-xs">Low</SelectItem>
                  <SelectItem value="Normal" className="text-xs">Normal</SelectItem>
                  <SelectItem value="High" className="text-xs">High</SelectItem>
                  <SelectItem value="Urgent" className="text-xs">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Team Governance Section */}
          <div className="p-3 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] space-y-3">
            <h4 className="text-xs font-bold text-[#1E293B] tracking-normal">
              Team Governance
            </h4>
            <AssignerSelect
              availableStaff={mergedStaff}
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
              <span className="text-xs text-[#DC2626] block" data-testid="manager-error">
                {managerError}
              </span>
            )}
          </div>

          {/* Task Blueprint Preview & Mapping */}
          {selectedTemplate && blueprintTasks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#E2E8F0]" data-testid="task-blueprint-preview">
              <div className="flex items-center justify-between">
                <label className="text-xs tracking-normal text-[#475569] flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-[#475569]" />
                  <span>Task Blueprint Preview & Mapping ({blueprintTasks.length})</span>
                </label>
                <span className="text-xs text-[#475569]">
                  Assignees strictly scoped to project team
                </span>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {blueprintTasks.map((task, idx) => {
                  const isUnmapped =
                    task.assignees.length > 0 &&
                    task.assignees.some((id) => !projectTeamIds.has(id) && !projectTeamIds.has(normId(id)));
                  const unmappedMember = isUnmapped
                    ? mergedStaff.find((m) => task.assignees.some((id) => m.id === id || normId(m.id) === normId(id)))
                    : null;
                  const unmappedName = unmappedMember?.name || (isUnmapped ? task.assignees[0] : null);

                  const matchedMember = projectTeam.find(
                    (m) =>
                      task.assignees[0] &&
                      (m.id === task.assignees[0] || normId(m.id) === normId(task.assignees[0]))
                  );
                  const selectValue =
                    task.assignees[0] && (projectTeamIds.has(task.assignees[0]) || projectTeamIds.has(normId(task.assignees[0])))
                      ? (matchedMember ? matchedMember.id : task.assignees[0])
                      : isUnmapped
                      ? '__unmapped__'
                      : 'unassigned';

                  return (
                    <div
                      key={task.local_id || idx}
                      data-testid={`blueprint-task-${task.local_id}`}
                      className={`p-3 rounded-lg border space-y-2 transition-colors min-w-0 max-w-full overflow-hidden text-xs ${
                        isUnmapped
                          ? 'bg-[#FFFFFF] border-[#FCA5A5]'
                          : 'bg-[#FFFFFF] border-[#E2E8F0]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span className="text-xs text-[#475569] shrink-0">
                            #{idx + 1}
                          </span>
                          <TaskTypeBadge
                            value={task.requiredLinkType}
                            data-testid={`retainer-generate-task-type-${task.local_id || idx}`}
                          />
                          <span className="font-semibold text-[#1E293B] truncate min-w-0 flex-1" title={task.title}>
                            {task.title}
                          </span>
                        </div>
                        <Badge
                          variant={task.phase === 'processing' ? 'default' : 'secondary'}
                          className="text-xs shrink-0 rounded-[6px] uppercase"
                        >
                          {task.phase === 'processing' ? 'Processing' : 'Pre-Processing'}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[10px] text-[#64748B] min-w-0">
                          {task.depends_on && (
                            <span className="truncate">
                              Prerequisite: <span className="font-medium text-[#1E293B]">{task.depends_on}</span>
                            </span>
                          )}
                          {task.dueDate && (
                            <span>Due: {new Date(task.dueDate).toLocaleDateString()}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 min-w-0 max-w-full sm:max-w-[220px]">
                          <Select
                            value={selectValue}
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
                              className="w-44 sm:w-48 max-w-full min-w-0 text-xs py-1 h-7 truncate [&>span]:truncate bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-[#1E293B]"
                              data-testid={`task-assignee-select-${task.local_id}`}
                            >
                              <SelectValue placeholder="— Unassigned —" />
                            </SelectTrigger>
                            <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                              {isUnmapped && (
                                <SelectItem value="__unmapped__" disabled className="text-xs text-[#DC2626]">
                                  ⚠️ Unmapped ({unmappedName || 'Template Default'})
                                </SelectItem>
                              )}
                              <SelectItem value="unassigned" className="text-xs">— Unassigned —</SelectItem>
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
                          className="flex items-start gap-1.5 text-[11px] text-[#DC2626] font-medium pt-0.5 min-w-0 break-words"
                          data-testid={`unmapped-assignee-alert-${task.local_id}`}
                        >
                          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                          <span
                            className="min-w-0 break-words flex-1"
                            data-testid={`unmapped-assignee-alert-${idx}`}
                          >
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
            <div className="text-xs tabular-nums text-[#DC2626] font-medium" data-testid="generate-error">
              {error}
            </div>
          )}

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="rounded-[8px] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] text-xs tracking-normal"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={!templateId}
              data-testid="generate-submit-btn"
              className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] rounded-[8px] text-xs tracking-normal shadow-2xs font-medium"
            >
              Generate Work Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
