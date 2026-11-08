import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Layers, Calendar, Search, AlertTriangle, ArrowUpDown, AlertCircle } from 'lucide-react';
import { useRetainerTemplates, useRetainerMutations } from '../api/useRetainers';
import { useClients } from '../api/useClients';
import {
  getDuplicateClientIds,
  matchesClientSearch,
  sortClients,
  DEFAULT_CLIENT_SORT,
  CLIENT_SORT_OPTIONS,
  type ClientSortOption,
} from '@/features/clients/lib/clientSelectUtils';
import { ClientSelectOptionContent } from '@/components/ui/client-select-option';
import { useTeam, type TeamMember } from '../api/useTeam';
import { useUsersList } from '@/features/admin/api/useUsers';
import { resolveEntityCodeFromUUID } from '@/lib/realtime';
import { AssignerSelect } from './AssignerSelect';
import { TaskTypeBadge } from '../lib/taskTypes';
import { runBlockingAction } from './BlockingActionModal';
import { operationsKeys } from '../api/queryKeys';
import { useSessionStore } from '@/lib/session';
import { toast } from '@/components/ui/toast';
import type {
  RetainerGenerateResponse,
  RetainerTemplateTask,
  ChecklistItemData,
  Priority,
  CreatablePhase,
} from '../api/types';

export interface OtherTemplateGenerateModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedTemplateId?: string | null;
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

export function OtherTemplateGenerateModal({
  isOpen,
  onClose,
  preselectedTemplateId,
  onSuccess,
}: OtherTemplateGenerateModalProps) {
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState<string>('');
  const [clientId, setClientId] = useState<string>('');
  const [clientSearch, setClientSearch] = useState<string>('');
  const [clientSort, setClientSort] = useState<ClientSortOption>(DEFAULT_CLIENT_SORT);
  const [dueDate, setDueDate] = useState<string>('');
  const [priority, setPriority] = useState<Priority>('Normal');
  const [description, setDescription] = useState<string>('');
  const [assignedTo, setAssignedTo] = useState<string | null>(null);
  const [coAssignees, setCoAssignees] = useState<string[]>([]);
  const [blueprintTasks, setBlueprintTasks] = useState<BlueprintTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [managerError, setManagerError] = useState<string | null>(null);

  const { data: allTemplates = [], isLoading: isTemplatesLoading } =
    useRetainerTemplates({ enabled: isOpen, type: 'other' });
  const { data: clients = [] } = useClients(undefined, { enabled: isOpen });
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

  // Filter templates to only 'other' templates
  const otherTemplates = useMemo(() => {
    return allTemplates.filter(
      (t) => (t.template_type || t.templateType) === 'other' || !t.schedule
    );
  }, [allTemplates]);

  // Set initial template
  useEffect(() => {
    if (preselectedTemplateId) {
      setTemplateId(preselectedTemplateId);
    } else if (otherTemplates.length > 0 && !templateId && otherTemplates[0]) {
      setTemplateId(otherTemplates[0].id);
    }
  }, [preselectedTemplateId, otherTemplates, templateId]);

  const selectedTemplate = otherTemplates.find((t) => t.id === templateId);

  const selectedTemplateEntity = useMemo(() => {
    if (!selectedTemplate) return null;
    if (selectedTemplate.entity === 'ATA' || selectedTemplate.entity === 'LTA') return selectedTemplate.entity;
    if (selectedTemplate.entities?.code === 'ATA' || selectedTemplate.entities?.code === 'LTA') {
      return selectedTemplate.entities.code;
    }
    return resolveEntityCodeFromUUID(selectedTemplate.entity_id);
  }, [selectedTemplate]);

  // Scoped clients by selected template entity
  const scopedClients = useMemo(() => {
    if (selectedTemplateEntity === 'ATA' || selectedTemplateEntity === 'LTA') {
      return clients.filter((c) => !c.entity || c.entity === selectedTemplateEntity);
    }
    return clients;
  }, [clients, selectedTemplateEntity]);

  // Reset clientId if selected client is not allowed for the template entity
  useEffect(() => {
    if (clientId && scopedClients.length > 0) {
      const isAllowed = scopedClients.some((c) => c.id === clientId);
      if (!isAllowed) {
        setClientId('');
      }
    }
  }, [selectedTemplateEntity, scopedClients, clientId]);

  // Sync template description and tasks when selected
  useEffect(() => {
    if (!selectedTemplate) {
      setDescription('');
      setBlueprintTasks([]);
      return;
    }

    setDescription(selectedTemplate.description || '');

    const tasksFromTemplate = Array.isArray(selectedTemplate.tasks)
      ? selectedTemplate.tasks
      : [];

    setBlueprintTasks(
      tasksFromTemplate.map((t: RetainerTemplateTask, idx: number) => {
        const localId =
          t.local_id || t.localId || t.id || `task_${idx + 1}`;
        const rawAssignees =
          Array.isArray(t.assignees) && t.assignees.length > 0
            ? t.assignees
            : Array.isArray(t.default_assignees) && t.default_assignees.length > 0
            ? t.default_assignees
            : Array.isArray(t.defaultAssignees) && t.defaultAssignees.length > 0
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

  const duplicateClientIds = useMemo(() => getDuplicateClientIds(scopedClients), [scopedClients]);

  // Search filter and sort for clients
  const filteredClients = useMemo(() => {
    const list = clientSearch.trim()
      ? scopedClients.filter((c) => matchesClientSearch(c, clientSearch))
      : scopedClients;
    return sortClients(list, clientSort);
  }, [scopedClients, clientSearch, clientSort]);

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
    setError(null);
    setClientError(null);
    setManagerError(null);

    if (!templateId) {
      setError('Please select an Other Template.');
      return;
    }

    // Mandatory Client
    if (!clientId) {
      setClientError('Client selection is required.');
      setError('Client selection is required.');
      return;
    }

    // Mandatory Manager Lead governance
    if (!assignedTo) {
      setManagerError('Manager Lead (assignedTo) is required.');
      setError('Manager Lead (assignedTo) is required.');
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

    await runBlockingAction({
      title: 'Generating Work Request',
      message: `Generating work request from template "${selectedTemplate?.name}"...`,
      apiCall: async () => {
        return await generateFromTemplate({
          templateId,
          period_label: null,
          overrides: {
            clientId,
            priority,
            dueDate,
            assignedTo,
            coAssignees,
            description: description.trim() || undefined,
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
      successTitle: 'Work Request Created',
      successMessage: 'Successfully generated work request from Other Template.',
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeEntity),
        operationsKeys.templates(),
      ],
      onSuccess: (data) => {
        toast.success('Work Request generated successfully');
        if (onSuccess && data) {
          onSuccess(data as RetainerGenerateResponse);
        }
        if (data && 'id' in data) {
          navigate(`/operations?tab=work-requests&view=board&wrId=${data.id}`);
        }
        onClose();
      },
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-[12px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float"
        data-testid="other-template-generate-modal"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-base font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#1E293B]" />
            Generate from Other Template
          </DialogTitle>
          <DialogDescription className="text-xs tabular-nums text-[#475569] pt-1">
            Create an ad-hoc work request with client assignment, manager lead governance, and scoped tasks.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleGenerate} className="space-y-4 min-w-0 max-w-full overflow-x-hidden">
          {error && (
            <div
              className="p-3 bg-[#FFFFFF] border-[#FCA5A5] rounded-[6px] flex items-center gap-2 text-xs tabular-nums text-[#DC2626]"
              data-testid="generate-error-banner"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-[#DC2626]" />
              <span data-testid="generate-error">{error}</span>
            </div>
          )}

          {/* 1. Template Dropdown */}
          <div className="space-y-1">
            <label className="text-xs tracking-normal text-[#475569] block">
              Other Template <span className="text-[#DC2626]">*</span>
            </label>
            <Select
              value={templateId}
              onValueChange={(val) => {
                setTemplateId(val);
                setError(null);
              }}
              disabled={isTemplatesLoading}
            >
              <SelectTrigger
                className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B]"
                data-testid="other-template-select"
              >
                <SelectValue placeholder="Select an Other Template..." />
              </SelectTrigger>
              <SelectContent className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                {otherTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">
                    {t.name || t.title} ({(t.tasks || []).length} tasks)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 2. Client Selection (Searchable & Required) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs tracking-normal text-[#475569]">
                Client <span className="text-[#DC2626]">*</span>
              </label>
              {clientSearch && (
                <button
                  type="button"
                  onClick={() => setClientSearch('')}
                  className="text-xs text-[#475569] hover:text-[#1E293B]"
                >
                  Clear search
                </button>
              )}
            </div>

            {/* Optional search filter input + sort */}
            <div className="flex items-center gap-1.5 mb-1">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[#475569]" />
                <Input
                  type="text"
                  placeholder="Search client name or TIN..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="h-8 pl-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-[#1E293B] placeholder:text-[#475569]"
                  data-testid="client-search-input"
                />
              </div>
              <div className="relative shrink-0 flex items-center">
                <ArrowUpDown className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-[#64748B] pointer-events-none" />
                <select
                  value={clientSort}
                  onChange={(e) => setClientSort(e.target.value as ClientSortOption)}
                  aria-label="Sort clients"
                  data-testid="client-select-sort"
                  className="h-8 pl-5 pr-1.5 text-[11px] font-medium bg-[#FFFFFF] border border-[#E2E8F0] rounded-[6px] text-[#475569] hover:text-[#0F172A] focus:outline-none focus:border-[#0F172A] cursor-pointer"
                >
                  {CLIENT_SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Select
              value={clientId}
              onValueChange={(val) => {
                setClientId(val);
                setClientError(null);
                if (error) setError(null);
              }}
            >
              <SelectTrigger
                className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B]"
                data-testid="other-template-client-select"
              >
                <SelectValue placeholder="Select target client..." />
              </SelectTrigger>
              <SelectContent data-radix-select-viewport="" className="rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                {(() => {
                  const selectedClient = scopedClients.find((c) => c.id === clientId);
                  const selectedIsFilteredOut = selectedClient && !filteredClients.some((c) => c.id === selectedClient.id);

                  return (
                    <>
                      {selectedIsFilteredOut && (
                        <SelectItem key={selectedClient.id} value={selectedClient.id} className="hidden">
                          <ClientSelectOptionContent
                            client={selectedClient}
                            isDuplicate={duplicateClientIds.has(selectedClient.id)}
                            showEntity
                          />
                        </SelectItem>
                      )}
                      {filteredClients.length === 0 ? (
                        <div className="p-2 text-xs text-[#475569] text-center">
                          No matching clients found
                        </div>
                      ) : (
                        filteredClients.map((c) => (
                          <SelectItem key={c.id} value={c.id} className="text-xs">
                            <ClientSelectOptionContent
                              client={c}
                              isDuplicate={duplicateClientIds.has(c.id)}
                              showEntity
                            />
                          </SelectItem>
                        ))
                      )}
                    </>
                  );
                })()}
              </SelectContent>
            </Select>
            {clientError && (
              <p className="text-xs text-[#DC2626]" data-testid="client-error">
                {clientError}
              </p>
            )}
          </div>

          {/* 3. Priority & Due Date Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Priority */}
            <div className="space-y-1">
              <label className="text-xs tracking-normal text-[#475569] block">
                Priority
              </label>
              <Select
                value={priority}
                onValueChange={(val) => setPriority(val as Priority)}
              >
                <SelectTrigger
                  className="h-9 bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs text-[#1E293B]"
                  data-testid="other-template-priority-select"
                >
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

            {/* Due Date */}
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
                data-testid="other-template-due-date-input"
              />
            </div>
          </div>

          {/* 4. Description / Notes */}
          <div className="space-y-1">
            <label className="text-xs tracking-normal text-[#475569] block">
              Description / Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope details, custom instructions, or client background..."
              className="resize-none w-full rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] p-2.5 text-xs text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
              data-testid="other-template-description-textarea"
            />
          </div>

          {/* 5. Team Governance (Mandatory) */}
          <div className="p-3 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#1E293B] tracking-normal">
                Team Governance (Mandatory)
              </h4>
              <span className="text-xs text-[#475569]">
                Lead Manager + Operations Co-Assignees
              </span>
            </div>

            <AssignerSelect
              availableStaff={mergedStaff}
              primaryAssigneeId={assignedTo}
              selectedCoAssigneeIds={coAssignees}
              managerOnlyPrimary={true}
              onPrimaryChange={(newMgr) => {
                setAssignedTo(newMgr);
                setError(null);
                setManagerError(null);
              }}
              onCoAssigneesChange={(newCo) => {
                setCoAssignees(newCo);
                setError(null);
              }}
            />

            {managerError && (
              <p className="text-xs text-[#DC2626]" data-testid="manager-error">
                {managerError}
              </p>
            )}
          </div>

          {/* 6. Blueprint Tasks Scoping Preview */}
          {blueprintTasks.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-[#E2E8F0]" data-testid="task-blueprint-preview">
              <div className="flex items-center justify-between">
                <label className="text-xs tracking-normal text-[#475569] flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-[#475569]" />
                  <span>Task Blueprint Scoping ({blueprintTasks.length} tasks)</span>
                </label>
                {unmappedTasks.length > 0 ? (
                  <Badge variant="destructive" size="compact" className="rounded-[6px] text-xs">
                    {unmappedTasks.length} unmapped assignee{unmappedTasks.length !== 1 ? 's' : ''}
                  </Badge>
                ) : (
                  <span className="text-xs text-[#475569]">
                    Assignees strictly scoped to project team
                  </span>
                )}
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
                            data-testid={`other-generate-task-type-${task.local_id || idx}`}
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

          <DialogFooter className="pt-4 border-t border-[#E2E8F0]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="rounded-[8px] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] tabular-nums text-xs tracking-normal"
              data-testid="other-template-generate-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs tabular-nums text-xs tracking-normal"
              data-testid="other-template-generate-submit-btn"
            >
              Generate Work Request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
