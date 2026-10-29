import { usePendingWorkRequestCreationCount } from '@/features/operations/api/useWorkRequests';
import { operationsViewerRefresh } from '@/features/operations/api/viewerRefresh';
import { WorkRequestSidePeek } from '@/features/operations/components/WorkRequestSidePeek';
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import {
  FileText,
  Clock,
  Archive as ArchiveIcon,
  Plus,
  Zap,
  LayoutList,
  Columns,
  Layers,
  Briefcase,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Forbidden } from '@/components/common/Forbidden';
import { WorkRequestList } from '@/features/operations/components/WorkRequestList';
import { PhaseKanbanBoard } from '@/features/operations/components/PhaseKanbanBoard';
import { WorkRequestModal } from '@/features/operations/components/WorkRequestModal';
import { PendingApprovalsInbox } from '@/features/operations/components/PendingApprovalsInbox';
import { OperationsArchiveTab } from '@/features/operations/components/OperationsArchiveTab';
import { RetainerGenerateModal } from '@/features/operations/components/RetainerGenerateModal';
import { RetainerTemplateModal } from '@/features/operations/components/RetainerTemplateModal';
import { OtherTemplateModal } from '@/features/operations/components/OtherTemplateModal';
import { OtherTemplateGenerateModal } from '@/features/operations/components/OtherTemplateGenerateModal';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import { useWorkRequestCounts } from '@/features/operations/api/useWorkRequests';
import { useRetainerTemplates, useRetainerMutations } from '@/features/operations/api/useRetainers';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { useEntityRealtimeSync, resolveEntityCodeFromUUID } from '@/lib/realtime';
import type { WorkRequest, EntityCode, RetainerTemplate } from '@/features/operations/api/types';

// eslint-disable-next-line react-refresh/only-export-components
export const allowedTabs = ['work-requests', 'templates', 'other-templates', 'pending-approvals', 'archive'];
export const ALLOWED_TABS = allowedTabs;

export default function OperationsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  // Session & RBAC
  const user = useSessionStore((state) => state.user);
  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const setActiveEntity = useSessionStore((state) => state.setActiveEntity);

  // Permission Checks
  const canViewModule = hasPermission(permissions, 'workflow:view');
  const canEdit = hasPermission(permissions, 'workflow:edit');
  const canCreateWr = (user?.role === 'Admin' || user?.role === 'Manager') && canEdit;
  const canUseRetainers = hasPermission(permissions, 'retainers:use');
  const canEditRetainers = hasPermission(permissions, 'retainers:edit') || user?.role === 'Admin';

  const canAccessRetainerTemplates = Boolean(
    user?.role === 'Admin' || (user?.role === 'Manager' && canUseRetainers)
  );

  const isAccounting =
    String(user?.role || '').toLowerCase() === 'accounting' ||
    (Array.isArray(user?.departments) &&
      user.departments.some((d) => String(d).toLowerCase() === 'accounting'));

  // Approval authority check: Admin, Manager, Accounting (for bills/disbursements), or explicit approval permission.
  // Personal submissions remain accessible for individual users via requestedBy / my-submissions filtering.
  const canApprove = Boolean(
    user?.role === 'Admin' ||
    user?.role === 'Manager' ||
    isAccounting ||
    hasPermission(permissions, 'workflow:phase_transition') ||
    hasPermission(permissions, 'workflow:qa_review') ||
    hasPermission(permissions, 'workflow:transition_request') ||
    hasPermission(permissions, 'workflow:task_approve') ||
    hasPermission(permissions, 'disbursement:approve') ||
    hasPermission(permissions, 'transmittal:approve') ||
    hasPermission(permissions, 'approve_change:disbursements') ||
    hasPermission(permissions, 'approve_change:invoices') ||
    hasPermission(permissions, 'approve_change:tasks') ||
    hasPermission(permissions, 'approve_change:*')
  );
  const canViewPendingApprovals = canApprove;
  const hasApprovalAuthority = canViewPendingApprovals;

  const rawTab = searchParams.get('tab') || 'work-requests';
  const activeTab = useMemo(() => {
    if (rawTab === 'pending' || rawTab === 'pending-items' || rawTab === 'pending-approvals') {
      return hasApprovalAuthority ? 'pending-approvals' : 'work-requests';
    }
    if (rawTab === 'templates' || rawTab === 'retainer-templates') {
      return canAccessRetainerTemplates ? 'retainer-templates' : 'work-requests';
    }
    if (rawTab === 'other-templates' || rawTab === 'other-template') {
      return canUseRetainers ? 'other-templates' : 'work-requests';
    }
    if (rawTab === 'archived' || rawTab === 'archive') {
      return 'archive';
    }
    if (rawTab === 'work-requests' || rawTab === 'requests') {
      return 'work-requests';
    }
    return allowedTabs.includes(rawTab) ? rawTab : 'work-requests';
  }, [rawTab, hasApprovalAuthority, canAccessRetainerTemplates, canUseRetainers]);

  const isPendingApprovalsTab = activeTab === 'pending-approvals';

  useEffect(() => {
    if (
      (rawTab === 'pending' || rawTab === 'pending-items' || rawTab === 'pending-approvals') &&
      !hasApprovalAuthority
    ) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'work-requests');
        return next;
      }, { replace: true });
    } else if (
      (rawTab === 'templates' || rawTab === 'retainer-templates') &&
      !canAccessRetainerTemplates
    ) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('tab', 'work-requests');
        return next;
      }, { replace: true });
    }
  }, [rawTab, hasApprovalAuthority, canAccessRetainerTemplates, setSearchParams]);

  const activeView = searchParams.get('view') || 'list';

  // Modal Visibility States
  const [archivedWorkRequestId, setArchivedWorkRequestId] = useState<string | null>(null);
  const urlWrId = searchParams.get('wrId');

  useEffect(() => {
    if (activeTab === 'archive' && urlWrId) {
      setArchivedWorkRequestId(urlWrId);
    }
  }, [activeTab, urlWrId]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingWr, setEditingWr] = useState<WorkRequest | null>(null);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RetainerTemplate | null>(null);
  const [isOtherTemplateModalOpen, setIsOtherTemplateModalOpen] = useState(false);
  const [editingOtherTemplate, setEditingOtherTemplate] = useState<RetainerTemplate | null>(null);
  const [isOtherGenerateModalOpen, setIsOtherGenerateModalOpen] = useState(false);
  const [generateOtherTemplateId, setGenerateOtherTemplateId] = useState<string | null>(null);

  const { deleteTemplate } = useRetainerMutations();

  // Top-level CDC Subscriptions across all Operations views (List & Board)
  useEntityRealtimeSync({
    table: 'work_requests',
    listRootKey: operationsKeys.workRequests(),
    activeEntity,
    enabled: canViewModule,
  });
  useEntityRealtimeSync({
    table: 'tasks',
    activeEntity,
    enabled: canViewModule,
  });
  useEntityRealtimeSync({
    table: 'task_assignees',
    activeEntity,
    enabled: canViewModule,
  });
  useEntityRealtimeSync({
    table: 'operations_requests',
    listRootKey: operationsKeys.requests(),
    detailQueryKey: (id) => operationsKeys.requestDetail(id),
    activeEntity,
    enabled: Boolean(canViewModule && hasApprovalAuthority),
  });

  // Collaborative Realtime CDC Subscriptions for Time Logging across Operations (SPEC-REALTIME-TIME-LOGGING-001)
  const isTimeLoggingEnabled = Boolean(canViewModule && !isPendingApprovalsTab);
  useEntityRealtimeSync({ table: 'time_entries', enabled: isTimeLoggingEnabled });
  useEntityRealtimeSync({ table: 'task_time_logs', enabled: isTimeLoggingEnabled });

  // Badge Counts Queries
  const { data: requestCounts } = useQuery({
    queryKey: operationsKeys.requestCounts(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<{ data: Record<string, number> }>(
        '/operations-requests/counts'
      );
      return res.data;
    },
    enabled: Boolean(canViewModule && hasApprovalAuthority),
    ...operationsViewerRefresh,
  });
  const pendingWrCreationCount = usePendingWorkRequestCreationCount({ enabled: canViewModule });
  const { data: wrCounts } = useWorkRequestCounts();
  const { data: retainerTemplates = [] } = useRetainerTemplates({ enabled: canAccessRetainerTemplates, type: 'retainer' });
  const { data: otherTemplates = [] } = useRetainerTemplates({ enabled: canUseRetainers, type: 'other' });
  const templates = retainerTemplates;

  const toAdminTemplate = (
    tpl: RetainerTemplate | null
  ): React.ComponentProps<typeof RetainerTemplateModal>['template'] => {
    if (!tpl) return null;
    const mapPriority = (p?: string): 'Low' | 'Normal' | 'High' | 'Urgent' => {
      if (p === 'Medium' || p === 'Normal') return 'Normal';
      if (p === 'Low') return 'Low';
      if (p === 'Urgent') return 'Urgent';
      return 'High';
    };

    return {
      ...tpl,
      entity: tpl.entity === 'LTA' ? 'LTA' : 'ATA',
      priority: mapPriority(tpl.priority),
      defaultPriority: mapPriority(tpl.defaultPriority || tpl.default_priority),
      default_priority: mapPriority(tpl.default_priority || tpl.defaultPriority),
      recurrence: tpl.recurrence === 'annual' ? 'annual' : 'none',
      tasks: (tpl.tasks || []).map((t) => ({
        ...t,
        phase: t.phase === 'processing' ? 'processing' : 'pre_processing',
      })),
    };
  };

  if (!canViewModule) {
    return <Forbidden requiredPermission="workflow:view" />;
  }

  const handleTabChange = (val: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', val);
      return next;
    });
  };

  const handleViewChange = (val: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', val);
      return next;
    });
  };

  const pendingApprovalsCount = (requestCounts?.pending ?? 0) + pendingWrCreationCount;
  const archivedCount = wrCounts?.archived ?? 0;
  const workRequestsCount = wrCounts?.active ?? wrCounts?.all ?? 0;

  return (
    <div className="w-full space-y-6" data-testid="operations-page">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Operations</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-[#1D4ED8]" />
            Operations &amp; Engagements
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Manage client deliverables, 4-phase lifecycle transitions, staff governance, and compliance.
          </p>
        </div>

        {/* Header Controls: Soft Segmented Entity Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {/* Active Entity Toggle */}
          <div
            className="flex items-center bg-[#F8FAFC] p-1 rounded-[8px] border border-[#E2E8F0]"
            data-testid="operations-entity-toggle"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
              <button
                key={ent}
                type="button"
                onClick={() => setActiveEntity(ent as EntityCode)}
                className={`px-3 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                  activeEntity === ent
                    ? 'bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs font-semibold'
                    : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                }`}
                data-testid={`entity-btn-${ent.toLowerCase()}`}
              >
                {ent}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          {canEditRetainers && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditingTemplate(null);
                setIsTemplateModalOpen(true);
              }}
              className="text-xs font-medium rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] gap-1.5 shadow-2xs cursor-pointer"
              data-testid="page-new-template-btn"
            >
              <Plus className="h-4 w-4 text-[#475569]" /> New Template
            </Button>
          )}

          {canUseRetainers && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsGenerateModalOpen(true)}
              className="text-xs font-medium rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] gap-1.5 shadow-2xs cursor-pointer"
              data-testid="generate-retainer-btn"
            >
              <Zap className="h-3.5 w-3.5 text-[#1D4ED8]" /> Generate Retainer
            </Button>
          )}

          {canCreateWr && activeTab !== 'work-requests' && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingWr(null);
                setIsCreateModalOpen(true);
              }}
              className="text-xs font-medium rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] gap-1.5 shadow-2xs cursor-pointer"
              data-testid="page-new-wr-btn"
            >
              <Plus className="h-4 w-4" /> New Work Request
            </Button>
          )}
        </div>
      </div>

      {/* 2. Module Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#E2E8F0] pb-2">
          <TabsList className="w-full sm:w-auto justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] gap-1 h-auto overflow-x-auto scrollbar-none flex flex-nowrap">
            {/* Tab 1: Work Requests */}
            <TabsTrigger
              value="work-requests"
              className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              data-testid="tab-work-requests"
            >
              <FileText className="h-4 w-4" />
              <span>Work Requests</span>
              <Badge
                variant="secondary"
                size="compact"
                className="text-xs tabular-nums rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]"
                data-testid="tab-work-requests-badge"
              >
                {workRequestsCount}
              </Badge>
            </TabsTrigger>

            {/* Tab 2: Retainer Templates */}
            {canAccessRetainerTemplates && (
              <TabsTrigger
                value="retainer-templates"
                className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
                data-testid="tab-retainer-templates"
              >
                <Layers className="h-4 w-4" />
                <span>Retainer Templates ({templates.length})</span>
              </TabsTrigger>
            )}

            {/* Tab 2.5: Other Templates */}
            {canUseRetainers && (
              <TabsTrigger
                value="other-templates"
                className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
                data-testid="tab-other-templates"
              >
                <Layers className="h-4 w-4" />
                <span>Other Template ({otherTemplates.length})</span>
              </TabsTrigger>
            )}

            {/* Tab 3: Pending Approvals */}
            {hasApprovalAuthority && (
              <TabsTrigger
                value="pending-approvals"
                className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
                data-testid="tab-pending-approvals"
              >
                <Clock className="h-4 w-4" />
                <span>Pending Approvals</span>
                {pendingApprovalsCount > 0 && (
                  <Badge
                    variant="warning"
                    size="compact"
                    className="font-medium px-1.5 rounded-[4px] border border-[#FDE047] bg-[#FEFCE8] text-[#854D0E]"
                    data-testid="tab-pending-badge"
                  >
                    {pendingApprovalsCount}
                  </Badge>
                )}
              </TabsTrigger>
            )}

            {/* Tab 4: Archive */}
            <TabsTrigger
              value="archive"
              className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              data-testid="tab-archive"
            >
              <ArchiveIcon className="h-4 w-4" />
              <span>Archive</span>
              {archivedCount > 0 && (
                <Badge variant="secondary" size="compact" className="text-xs tabular-nums rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B]">
                  {archivedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* View Switcher (when on Work Requests tab) */}
          {activeTab === 'work-requests' && (
            <div className="flex items-center bg-[#F8FAFC] p-1 rounded-[8px] border border-[#E2E8F0] gap-1 self-end sm:self-auto">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => handleViewChange('list')}
                className={`text-xs font-medium rounded-[6px] h-7 gap-1 px-2.5 transition-colors cursor-pointer ${
                  activeView === 'list'
                    ? 'bg-[#FFFFFF] text-[#1E40AF] font-semibold shadow-2xs'
                    : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                }`}
                data-testid="view-switcher-list"
              >
                <LayoutList className="h-3.5 w-3.5" /> List
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => handleViewChange('board')}
                className={`text-xs font-medium rounded-[6px] h-7 gap-1 px-2.5 transition-colors cursor-pointer ${
                  activeView === 'board'
                    ? 'bg-[#FFFFFF] text-[#1E40AF] font-semibold shadow-2xs'
                    : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                }`}
                data-testid="view-switcher-board"
              >
                <Columns className="h-3.5 w-3.5" /> Board
              </Button>
            </div>
          )}
        </div>

        {/* Tab 1 Content: Work Requests */}
        <TabsContent value="work-requests" className="mt-0">
          {activeView === 'list' ? (
            <WorkRequestList
              onEdit={(wr) => {
                setEditingWr(wr);
                setIsCreateModalOpen(true);
              }}
              onCreateNew={() => {
                setEditingWr(null);
                setIsCreateModalOpen(true);
              }}
              onViewDetails={(wrId) => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('tab', 'work-requests');
                  next.set('view', 'board');
                  next.set('wrId', wrId);
                  next.delete('peekWrId');
                  return next;
                });
              }}
            />
          ) : (
            <PhaseKanbanBoard
              initialWorkRequestId={searchParams.get('wrId') || undefined}
              onEditWorkRequest={(wr) => {
                setEditingWr(wr);
                setIsCreateModalOpen(true);
              }}
            />
          )}
        </TabsContent>

        {/* Tab 2 Content: Retainer Templates */}
        {canAccessRetainerTemplates && (
          <TabsContent value="retainer-templates" className="mt-0">
          <div className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Retainer Templates Directory</h3>
                <p className="text-xs text-slate-500">
                  Recurring engagement templates used to generate standard work requests.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {canEditRetainers && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      setEditingTemplate(null);
                      setIsTemplateModalOpen(true);
                    }}
                    className="text-xs font-semibold gap-1.5"
                    data-testid="create-template-btn"
                  >
                    <Plus className="h-4 w-4" /> Create Work Request Template
                  </Button>
                )}
                {canUseRetainers && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsGenerateModalOpen(true)}
                    className="text-xs gap-1.5"
                    data-testid="generate-template-btn"
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-400" /> Generate from Template
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map((tpl) => {
                const entityCode =
                  (tpl.entity && tpl.entity.length <= 4 ? tpl.entity : undefined) ||
                  ((tpl as { entities?: { code?: string } }).entities?.code && (tpl as { entities?: { code?: string } }).entities!.code!.length <= 4
                    ? (tpl as { entities?: { code?: string } }).entities!.code
                    : undefined) ||
                  resolveEntityCodeFromUUID(tpl.entity_id);

                return (
                  <div
                    key={tpl.id}
                    className="p-4 bg-slate-50/60 border border-slate-200 rounded-lg space-y-2 hover:border-slate-300 transition-colors"
                    data-testid={`template-card-${tpl.id}`}
                  >
                    <div className="flex items-start justify-between">
                      <h4 className="font-bold text-xs text-slate-900">{tpl.name}</h4>
                      <div className="flex items-center gap-1.5">
                        {canEditRetainers && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTemplate(tpl);
                              setIsTemplateModalOpen(true);
                            }}
                            className="text-xs font-medium hover:underline px-1 text-[#1D4ED8]"
                            data-testid={`edit-template-btn-${tpl.id}`}
                          >
                            Edit
                          </button>
                        )}
                        {entityCode && (
                          <Badge variant={entityCode === 'LTA' ? 'lta' : 'ata'} size="compact">
                            {entityCode}
                          </Badge>
                        )}
                      </div>
                    </div>
                  {tpl.description && (
                    <p className="text-xs text-slate-600 line-clamp-2">{tpl.description}</p>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs text-slate-500">
                    <span className="capitalize">{tpl.recurrence} recurrence</span>
                    <Badge variant="secondary" size="compact">
                      {tpl.defaultPriority || tpl.priority} Priority
                    </Badge>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </TabsContent>
        )}

        {/* Tab 2.5 Content: Other Templates */}
        {canUseRetainers && (
          <TabsContent value="other-templates" className="mt-0" data-testid="other-templates-tab-content">
            <div className="p-6 bg-white border border-slate-200 rounded-lg space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Other Templates Directory</h3>
                  <p className="text-xs text-slate-500">
                    Ad-hoc and repeatable service workflow templates without recurring subscriptions.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canEditRetainers && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setEditingOtherTemplate(null);
                        setIsOtherTemplateModalOpen(true);
                      }}
                      className="text-xs font-semibold gap-1.5"
                      data-testid="create-other-template-btn"
                    >
                      <Plus className="h-4 w-4" /> + New Other Template
                    </Button>
                  )}
                  {canUseRetainers && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setGenerateOtherTemplateId(null);
                        setIsOtherGenerateModalOpen(true);
                      }}
                      className="text-xs gap-1.5"
                      data-testid="generate-other-template-btn"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-500" /> Generate from Other Template
                    </Button>
                  )}
                </div>
              </div>

              {otherTemplates.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-lg space-y-2">
                  <Layers className="h-8 w-8 text-slate-400 mx-auto" />
                  <h4 className="text-xs font-semibold text-slate-700">No Other Templates Found</h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Create reusable task blueprints for non-recurring operational workflows.
                  </p>
                  {canEditRetainers && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingOtherTemplate(null);
                        setIsOtherTemplateModalOpen(true);
                      }}
                      className="text-xs mt-2"
                    >
                      + New Other Template
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {otherTemplates.map((tpl) => {
                    const entityCode =
                      (tpl.entity && tpl.entity.length <= 4 ? tpl.entity : undefined) ||
                      ((tpl as { entities?: { code?: string } }).entities?.code && (tpl as { entities?: { code?: string } }).entities!.code!.length <= 4
                        ? (tpl as { entities?: { code?: string } }).entities!.code
                        : undefined) ||
                      resolveEntityCodeFromUUID(tpl.entity_id);

                    return (
                      <div
                        key={tpl.id}
                        className="p-4 bg-slate-50/60 border border-slate-200 rounded-lg space-y-2 hover:border-slate-300 transition-colors"
                        data-testid={`other-template-card-${tpl.id}`}
                      >
                        <div className="flex items-start justify-between">
                          <h4 className="font-bold text-xs text-slate-900">{tpl.name || tpl.title}</h4>
                          <div className="flex items-center gap-1.5">
                            {entityCode && (
                              <Badge variant={entityCode === 'LTA' ? 'lta' : 'ata'} size="compact">
                                {entityCode}
                              </Badge>
                            )}
                          </div>
                        </div>
                      {tpl.description && (
                        <p className="text-xs text-slate-600 line-clamp-2">{tpl.description}</p>
                      )}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs text-slate-500">
                        <Badge variant="secondary" size="compact" data-testid={`task-count-pill-${tpl.id}`}>
                          {(tpl.tasks || []).length} tasks
                        </Badge>
                        <div className="flex items-center gap-2">
                          {canEditRetainers && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingOtherTemplate(tpl);
                                  setIsOtherTemplateModalOpen(true);
                                }}
                                className="text-xs font-medium hover:underline px-1 text-[#1D4ED8]"
                                data-testid={`edit-other-template-btn-${tpl.id}`}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (confirm(`Delete template "${tpl.name || tpl.title}"?`)) {
                                    await deleteTemplate(tpl.id);
                                  }
                                }}
                                className="text-xs font-medium hover:underline px-1 text-[#DC2626]"
                                data-testid={`delete-other-template-btn-${tpl.id}`}
                              >
                                Delete
                              </button>
                            </>
                          )}
                          {canUseRetainers && (
                            <button
                              type="button"
                              onClick={() => {
                                setGenerateOtherTemplateId(tpl.id);
                                setIsOtherGenerateModalOpen(true);
                              }}
                              className="text-xs font-medium hover:underline flex items-center gap-0.5 px-1 text-[#1D4ED8]"
                              data-testid={`generate-card-other-template-btn-${tpl.id}`}
                            >
                              <Zap className="h-3 w-3" /> Generate
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          </TabsContent>
        )}

        {/* Tab 3 Content: Pending Approvals Inbox */}
        {hasApprovalAuthority && (
          <TabsContent value="pending-approvals" className="mt-0">
            <PendingApprovalsInbox
              onNavigateToWr={(wrId) => {
                setSearchParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('tab', 'work-requests');
                  next.set('wrId', wrId);
                  return next;
                });
              }}
            />
          </TabsContent>
        )}

        {/* Tab 4 Content: Operations Archive */}
        <TabsContent value="archive" className="mt-0">
          <OperationsArchiveTab onViewWr={(wr) => setArchivedWorkRequestId(wr.id)} />
        </TabsContent>
      </Tabs>

      <WorkRequestSidePeek
        workRequestId={archivedWorkRequestId}
        isOpen={Boolean(archivedWorkRequestId)}
        onClose={() => {
          setArchivedWorkRequestId(null);
          if (activeTab === 'archive' && urlWrId) {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('wrId');
              return next;
            }, { replace: true });
          }
        }}
      />

      {/* Global Modals Mounted at Root */}
      <WorkRequestModal
        isOpen={isCreateModalOpen}
        workRequest={editingWr}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingWr(null);
        }}
      />

      {isGenerateModalOpen && (
        <RetainerGenerateModal
          isOpen={isGenerateModalOpen}
          onClose={() => setIsGenerateModalOpen(false)}
        />
      )}

      {isTemplateModalOpen && (
        <RetainerTemplateModal
          isOpen={isTemplateModalOpen}
          template={toAdminTemplate(editingTemplate)}
          onClose={() => {
            setIsTemplateModalOpen(false);
            setEditingTemplate(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: operationsKeys.templates() });
          }}
        />
      )}

      {isOtherTemplateModalOpen && (
        <OtherTemplateModal
          isOpen={isOtherTemplateModalOpen}
          template={editingOtherTemplate}
          onClose={() => {
            setIsOtherTemplateModalOpen(false);
            setEditingOtherTemplate(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: operationsKeys.templates() });
          }}
        />
      )}

      {isOtherGenerateModalOpen && (
        <OtherTemplateGenerateModal
          isOpen={isOtherGenerateModalOpen}
          preselectedTemplateId={generateOtherTemplateId}
          onClose={() => {
            setIsOtherGenerateModalOpen(false);
            setGenerateOtherTemplateId(null);
          }}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: operationsKeys.templates() });
          }}
        />
      )}

      <BlockingActionModal />
    </div>
  );
}
