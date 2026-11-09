import { useMemo } from 'react';
import {
  Layers,
  Pencil,
  Trash2,
  CheckSquare,
  Building2,
  User,
  Calendar,
  DollarSign,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermission } from '@/lib/permissions';
import { useSessionStore } from '@/lib/session';
import { useTeam } from '../api/useTeam';
import { useUsersList } from '@/features/admin/api/useUsers';
import { useClients } from '../api/useClients';
import { resolveEntityCodeFromUUID } from '@/lib/realtime';
import type { RetainerTemplate, RetainerTemplateTask } from '../api/types';

export interface TemplateDetailModalProps {
  template: RetainerTemplate | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (template: RetainerTemplate) => void;
  onDelete?: (template: RetainerTemplate) => void;
}

export function TemplateDetailModal({
  template,
  isOpen,
  onClose,
  onEdit,
  onDelete,
}: TemplateDetailModalProps) {
  const user = useSessionStore((state) => state.user);
  const hasEditPermission = usePermission('retainers:edit');
  const canEdit = hasEditPermission || user?.role === 'Admin';

  const isOther = Boolean(
    template &&
      (template.template_type === 'other' || template.templateType === 'other')
  );

  const entityCode = useMemo(() => {
    if (!template) return 'ATA';
    return (
      (template.entity && template.entity.length <= 4 ? template.entity : undefined) ||
      (template.entities?.code && template.entities.code.length <= 4
        ? template.entities.code
        : undefined) ||
      resolveEntityCodeFromUUID(template.entity_id) ||
      'ATA'
    );
  }, [template]);

  const { data: clientsData = [] } = useClients(
    { entity: entityCode },
    { enabled: isOpen && !isOther }
  );

  const clients = useMemo(() => {
    return Array.isArray(clientsData) ? clientsData : [];
  }, [clientsData]);

  const { data: users = [] } = useUsersList({ enabled: isOpen });
  const { data: teamMembers = [] } = useTeam();

  const assignedManagerId = template?.assigned_to || template?.assignedTo;
  const managerName = useMemo(() => {
    if (!assignedManagerId) return 'Unassigned';
    const foundUser = users.find((u) => u.id === assignedManagerId);
    if (foundUser) return foundUser.name;
    const foundMember = teamMembers.find((m) => m.id === assignedManagerId);
    if (foundMember) return foundMember.name;
    return 'Unassigned';
  }, [assignedManagerId, users, teamMembers]);

  const rawClient = template?.client_name || template?.clients?.name;
  const clientId = template?.client_id || template?.clientId;
  const clientName = useMemo(() => {
    if (rawClient) return rawClient;
    if (!clientId) return 'All / Unspecified';
    const found = clients.find((c) => c.id === clientId);
    return found?.name || 'All / Unspecified';
  }, [rawClient, clientId, clients]);

  const priority = useMemo(() => {
    return (
      template?.defaultPriority ||
      template?.default_priority ||
      template?.priority ||
      'Normal'
    );
  }, [template]);

  const tasks: RetainerTemplateTask[] = useMemo(() => {
    return template?.tasks || [];
  }, [template]);

  const resolvePredecessorTitle = (task: RetainerTemplateTask) => {
    const depId =
      task.depends_on ||
      task.dependsOn ||
      task.depends_on_local_id ||
      task.dependsOnLocalId;
    if (!depId) return null;
    const predecessor = tasks.find(
      (t) =>
        (t.id && t.id === depId) ||
        (t.local_id && t.local_id === depId) ||
        (t.localId && t.localId === depId)
    );
    return predecessor ? predecessor.title : depId;
  };

  const resolveAssignees = (task: RetainerTemplateTask) => {
    const rawList =
      task.assignees ||
      task.default_assignees ||
      task.defaultAssignees ||
      (task.assigneeId ? [task.assigneeId] : task.assigned_to ? [task.assigned_to] : []);
    if (!rawList || rawList.length === 0) return [];
    return rawList
      .map((id) => {
        const u = users.find((x) => x.id === id) || teamMembers.find((x) => x.id === id);
        return u ? u.name : id;
      })
      .filter(Boolean);
  };

  if (!isOpen || !template) return null;

  const pfValue = Number(template.pf_amount ?? template.pfAmount ?? 0);
  const formattedPf = `₱${pfValue.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col p-6 bg-[#FFFFFF] border border-[#E2E8F0] shadow-lg rounded-xl overflow-hidden"
        data-testid="template-detail-modal"
      >
        <DialogHeader className="pb-3 border-b border-[#E2E8F0] space-y-2">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="text-lg font-bold text-[#1E293B] tracking-tight">
              {template.name || template.title}
            </DialogTitle>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <Badge variant={entityCode === 'LTA' ? 'lta' : 'ata'} size="compact">
              {entityCode}
            </Badge>
            <Badge
              variant="outline"
              size="compact"
              className={
                isOther
                  ? 'border-[#E2E8F0] text-[#475569] bg-[#F8FAFC]'
                  : 'border-[#1D4ED8]/30 text-[#1D4ED8] bg-[#EFF6FF]'
              }
            >
              {isOther ? 'Other Template' : 'Retainer Template'}
            </Badge>
            {!isOther && (
              <>
                <Badge variant="secondary" size="compact">
                  {priority} Priority
                </Badge>
                <Badge
                  variant="outline"
                  size="compact"
                  className="capitalize text-[#475569] bg-[#F8FAFC] border-[#E2E8F0]"
                >
                  {template.recurrence || 'none'} recurrence
                </Badge>
              </>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1 -mr-1">
          {/* Metadata Grid for Retainer Templates */}
          {!isOther && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-3 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0]">
              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-[#475569] flex items-center gap-1">
                  <Building2 className="h-3 w-3 text-[#1D4ED8]" /> Client
                </span>
                <p className="text-xs font-medium text-[#1E293B] truncate" title={clientName}>
                  {clientName}
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-[#475569] flex items-center gap-1">
                  <User className="h-3 w-3 text-[#1D4ED8]" /> Default Lead / Manager
                </span>
                <p className="text-xs font-medium text-[#1E293B] truncate" title={managerName}>
                  {managerName}
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-[#475569] flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-[#1D4ED8]" /> Recurrence &amp; Schedule
                </span>
                <p className="text-xs font-medium text-[#1E293B] capitalize">
                  {template.recurrence || 'none'} ({template.schedule || '—'})
                </p>
              </div>

              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-[#475569] flex items-center gap-1">
                  <DollarSign className="h-3 w-3 text-[#1D4ED8]" /> Professional Fee
                </span>
                <p className="text-xs font-medium text-[#1E293B]">
                  {formattedPf}
                </p>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-[#1E293B]">Description</h4>
            <p className="text-xs text-[#475569] whitespace-pre-wrap">
              {template.description ? (
                template.description
              ) : (
                <span className="italic">No description provided.</span>
              )}
            </p>
          </div>

          {/* Task Blueprints */}
          <div className="space-y-3 pt-2 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#1E293B] flex items-center gap-1.5">
                <Layers className="h-4 w-4 text-[#1D4ED8]" />
                Task Blueprints ({tasks.length})
              </h4>
            </div>

            {tasks.length === 0 ? (
              <div className="text-xs text-[#475569] italic py-2">
                No tasks defined in this template.
              </div>
            ) : (
              <div className="space-y-2.5">
                {tasks.map((task, idx) => {
                  const predecessorTitle = resolvePredecessorTitle(task);
                  const assignees = resolveAssignees(task);
                  const linkType = task.requiredLinkType || task.required_link_type;

                  return (
                    <div
                      key={task.id || task.local_id || task.localId || idx}
                      className="p-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-[#475569]">
                            #{idx + 1}
                          </span>
                          <span className="text-xs font-bold text-[#1E293B]">
                            {task.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant={task.phase === 'processing' ? 'info' : 'secondary'}
                            size="compact"
                          >
                            {task.phase === 'processing' ? 'Processing' : 'Pre-Processing'}
                          </Badge>
                          {linkType && (
                            <Badge
                              variant="outline"
                              size="compact"
                              className="text-[11px] bg-[#FFFFFF] border-[#E2E8F0] text-[#475569]"
                            >
                              {linkType}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {task.description && (
                        <p className="text-xs text-[#475569]">{task.description}</p>
                      )}

                      {(predecessorTitle || assignees.length > 0) && (
                        <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#475569] pt-1">
                          {predecessorTitle && (
                            <div className="flex items-center gap-1">
                              <span className="font-semibold text-[#1E293B]">
                                Depends on:
                              </span>{' '}
                              <span>{predecessorTitle}</span>
                            </div>
                          )}
                          {assignees.length > 0 && (
                            <div className="flex items-center gap-1">
                              <span className="font-semibold text-[#1E293B]">
                                Default Assignees:
                              </span>{' '}
                              <span>{assignees.join(', ')}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Checklist / Subtasks */}
                      {task.checklist && task.checklist.length > 0 && (
                        <div className="pt-2 border-t border-[#E2E8F0]/60 space-y-1.5">
                          <div className="text-[11px] font-semibold text-[#475569] flex items-center gap-1">
                            <CheckSquare className="h-3 w-3 text-[#1D4ED8]" />
                            Sub-tasks &amp; Document Requirements ({task.checklist.length})
                          </div>
                          <div className="space-y-1 pl-1">
                            {task.checklist.map((item, itemIdx) => {
                              const isDoc =
                                item.category === 'document';
                              return (
                                <div
                                  key={item.id || itemIdx}
                                  className="flex items-center justify-between text-xs py-1 px-2 rounded bg-[#FFFFFF] border border-[#E2E8F0]"
                                  data-testid={`checklist-item-${idx}-${itemIdx}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(item.completed)}
                                      readOnly
                                      disabled
                                      className="h-3.5 w-3.5 rounded border-[#E2E8F0] text-[#1D4ED8] focus:ring-0 cursor-default"
                                    />
                                    <span
                                      className={
                                        item.completed
                                          ? 'line-through text-[#475569]'
                                          : 'text-[#1E293B]'
                                      }
                                    >
                                      {item.text}
                                    </span>
                                  </div>
                                  <div>
                                    {isDoc ? (
                                      <Badge
                                        variant="outline"
                                        size="compact"
                                        className="text-[10px] bg-[#F8FAFC] text-[#1D4ED8] border-[#1D4ED8]/30 font-medium"
                                      >
                                        Doc{item.periodYear ? ` · ${item.periodYear}` : ''}
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="outline"
                                        size="compact"
                                        className="text-[10px] bg-[#F8FAFC] text-[#475569] border-[#E2E8F0] font-medium"
                                      >
                                        Sub-task
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="pt-3 border-t border-[#E2E8F0] flex items-center justify-between sm:justify-between w-full">
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onDelete?.(template)}
              className="text-xs h-8 gap-1.5 border-[#DC2626]/30 text-[#DC2626] hover:bg-[#DC2626]/10 cursor-pointer"
              data-testid="detail-delete-template-btn"
            >
              <Trash2 className="h-3.5 w-3.5 text-[#DC2626]" />
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
              className="text-xs h-8 border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] cursor-pointer"
              data-testid="detail-close-template-btn"
            >
              Close
            </Button>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onClose();
                  onEdit?.(template);
                }}
                className="text-xs h-8 gap-1.5 bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs cursor-pointer"
                data-testid="detail-edit-template-btn"
              >
                <Pencil className="h-3.5 w-3.5" />
                Edit Template
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
