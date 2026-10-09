import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Clock,
  Archive as ArchiveIcon,
  Plus,
  Zap,
  LayoutList,
  Columns,
  Layers,
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
import { RetainerTemplateModal } from '@/features/admin';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import { useOperationsRequestCounts } from '@/features/operations/api/usePhaseTransitions';
import { useWorkRequestCounts } from '@/features/operations/api/useWorkRequests';
import { useRetainerTemplates } from '@/features/operations/api/useRetainers';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { WorkRequest, EntityCode, RetainerTemplate } from '@/features/operations/api/types';

export default function OperationsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'work-requests';
  const activeTab =
    rawTab === 'pending' || rawTab === 'pending-items' || rawTab === 'pending-approvals'
      ? 'pending-approvals'
      : rawTab === 'work-requests' || rawTab === 'requests'
        ? 'work-requests'
        : rawTab === 'templates' || rawTab === 'retainer-templates'
          ? 'retainer-templates'
          : rawTab === 'archived' || rawTab === 'archive'
            ? 'archive'
            : rawTab;
  const activeView = searchParams.get('view') || 'list';

  // Modal Visibility States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingWr, setEditingWr] = useState<WorkRequest | null>(null);
  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<RetainerTemplate | null>(null);

  // Session & RBAC
  const user = useSessionStore((state) => state.user);
  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const setActiveEntity = useSessionStore((state) => state.setActiveEntity);

  // Top-level CDC Subscriptions across all Operations views (List & Board)
  useEntityRealtimeSync({ table: 'work_requests' });
  useEntityRealtimeSync({ table: 'tasks' });

  // Permission Checks
  const canViewModule = hasPermission(permissions, 'workflow:view');
  const canEdit = hasPermission(permissions, 'workflow:edit');
  const canUseRetainers = hasPermission(permissions, 'retainers:use');
  const canEditRetainers = hasPermission(permissions, 'retainers:edit') || user?.role === 'Admin';

  // Badge Counts Queries
  const { data: requestCounts } = useOperationsRequestCounts();
  const { data: wrCounts } = useWorkRequestCounts();
  const { data: templates = [] } = useRetainerTemplates({ enabled: canUseRetainers });

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

  const pendingApprovalsCount = requestCounts?.pending ?? 0;
  const archivedCount = wrCounts?.archived ?? 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="operations-page">
      {/* 1. Page Header & Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5 pb-1">
            <span>Modules</span>
            <span>/</span>
            <span className="text-slate-900 font-semibold">Operations</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Operations & Engagements
          </h1>
          <p className="text-xs text-slate-500 pt-0.5">
            Manage client deliverables, 4-phase lifecycle transitions, staff governance, and compliance.
          </p>
        </div>

        {/* Header Controls: Entity Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Active Entity Toggle */}
          <div
            className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200"
            data-testid="operations-entity-toggle"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
              <button
                key={ent}
                type="button"
                onClick={() => setActiveEntity(ent as EntityCode)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                  activeEntity === ent
                    ? ent === 'ATA'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : ent === 'LTA'
                        ? 'bg-slate-700 text-white shadow-xs'
                        : 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
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
              className="text-xs font-semibold gap-1.5"
              data-testid="page-new-template-btn"
            >
              <Plus className="h-4 w-4 text-slate-500" /> New Template
            </Button>
          )}

          {canUseRetainers && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsGenerateModalOpen(true)}
              className="text-xs gap-1.5"
              data-testid="generate-retainer-btn"
            >
              <Zap className="h-3.5 w-3.5 text-amber-500" /> Generate Retainer
            </Button>
          )}

          {canEdit && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditingWr(null);
                setIsCreateModalOpen(true);
              }}
              className="text-xs font-semibold gap-1.5"
              data-testid="page-new-wr-btn"
            >
              <Plus className="h-4 w-4" /> New Work Request
            </Button>
          )}
        </div>
      </div>

      {/* 2. Module Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 pb-px">
          <TabsList className="bg-transparent h-10 p-0 gap-6">
            {/* Tab 1: Work Requests */}
            <TabsTrigger
              value="work-requests"
              className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 rounded-none px-1 pb-2 text-xs font-semibold flex items-center gap-1.5 bg-transparent shadow-none"
              data-testid="tab-work-requests"
            >
              <FileText className="h-4 w-4" />
              <span>Work Requests</span>
            </TabsTrigger>

            {/* Tab 2: Retainer Templates */}
            <TabsTrigger
              value="retainer-templates"
              className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 rounded-none px-1 pb-2 text-xs font-semibold flex items-center gap-1.5 bg-transparent shadow-none"
              data-testid="tab-retainer-templates"
            >
              <Layers className="h-4 w-4" />
              <span>Retainer Templates ({templates.length})</span>
            </TabsTrigger>

            {/* Tab 3: Pending Approvals */}
            <TabsTrigger
              value="pending-approvals"
              className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 rounded-none px-1 pb-2 text-xs font-semibold flex items-center gap-1.5 bg-transparent shadow-none"
              data-testid="tab-pending-approvals"
            >
              <Clock className="h-4 w-4" />
              <span>Pending Approvals</span>
              {pendingApprovalsCount > 0 && (
                <Badge
                  variant="warning"
                  size="compact"
                  className="font-bold px-1.5"
                  data-testid="tab-pending-badge"
                >
                  {pendingApprovalsCount}
                </Badge>
              )}
            </TabsTrigger>

            {/* Tab 4: Archive */}
            <TabsTrigger
              value="archive"
              className="data-[state=active]:border-b-2 data-[state=active]:border-blue-600 data-[state=active]:text-blue-600 rounded-none px-1 pb-2 text-xs font-semibold flex items-center gap-1.5 bg-transparent shadow-none"
              data-testid="tab-archive"
            >
              <ArchiveIcon className="h-4 w-4" />
              <span>Archive</span>
              {archivedCount > 0 && (
                <Badge variant="secondary" size="compact" className="text-[10px]">
                  {archivedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* View Switcher (when on Work Requests tab) */}
          {activeTab === 'work-requests' && (
            <div className="flex items-center gap-1 pb-1">
              <Button
                type="button"
                variant={activeView === 'list' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => handleViewChange('list')}
                className="text-xs gap-1 h-7"
                data-testid="view-switcher-list"
              >
                <LayoutList className="h-3.5 w-3.5" /> List
              </Button>
              <Button
                type="button"
                variant={activeView === 'board' ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => handleViewChange('board')}
                className="text-xs gap-1 h-7"
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
                    <Plus className="h-4 w-4" /> Create Template
                  </Button>
                )}
                {canUseRetainers && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsGenerateModalOpen(true)}
                    className="text-xs gap-1.5"
                    data-testid="tab-generate-template-btn"
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-400" /> Generate from Template
                  </Button>
                )}
              </div>
            </div>

            {templates.length === 0 ? (
              <div
                className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center text-xs text-slate-500 space-y-2"
                data-testid="empty-templates-container"
              >
                <FileText className="h-8 w-8 mx-auto text-slate-400" />
                <p className="font-semibold text-slate-700">No retainer templates created yet</p>
                <p>Create reusable template blueprints to streamline annual or monthly service generations.</p>
                {canEditRetainers && (
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingTemplate(null);
                      setIsTemplateModalOpen(true);
                    }}
                    variant="outline"
                    size="sm"
                    className="text-xs mt-2"
                    data-testid="empty-create-template-btn"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Create First Template
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="template-cards-grid">
                {templates.map((tpl) => (
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
                            className="text-[11px] font-medium text-blue-600 hover:text-blue-800 hover:underline px-1"
                            data-testid={`edit-template-btn-${tpl.id}`}
                          >
                            Edit
                          </button>
                        )}
                        <Badge variant={(tpl.entity || tpl.entity_id) === 'LTA' ? 'lta' : 'ata'} size="compact">
                          {tpl.entity || tpl.entity_id}
                        </Badge>
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
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Tab 3 Content: Pending Approvals Inbox */}
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

        {/* Tab 4 Content: Operations Archive */}
        <TabsContent value="archive" className="mt-0">
          <OperationsArchiveTab />
        </TabsContent>
      </Tabs>

      {/* Global Modals Mounted at Root */}
      <WorkRequestModal
        isOpen={isCreateModalOpen}
        workRequest={editingWr}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingWr(null);
        }}
      />

      <RetainerGenerateModal
        isOpen={isGenerateModalOpen}
        onClose={() => setIsGenerateModalOpen(false)}
      />

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

      <BlockingActionModal />
    </div>
  );
}
