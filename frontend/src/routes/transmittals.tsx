/**
 * Transmittals Route Page (Module #5)
 *
 * Citation: Frozen API Contract transmittals@2.0.0 (docs/api-contracts/modules/transmittals.md)
 * Gated by transmittal:view permission and 'Transmittals' feature flag.
 * Mounts BlockingActionModal at root.
 */

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Send,
  Plus,
  Layers,
  Clock,
  CheckCircle2,
  Archive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Forbidden } from '@/components/common/Forbidden';
import { ModulePlaceholder } from '@/components/common/ModulePlaceholder';
import { isModuleEnabled } from '@/lib/flags';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import {
  TransmittalKanbanBoard,
  TransmittalTable,
  TransmittalFormModal,
  TransmittalDetailModal,
  TransmittalPrintModal,
  ApproveDialog,
  SendDialog,
  AcknowledgeDialog,
  DeleteDialog,
  ArchiveDialog,
} from '@/features/transmittals/components';
import { ViewModeToggle } from '@/features/billing/components/ViewModeToggle';
import {
  useTransmittalsList,
  useTransmittalCounts,
  useUpdateTransmittal,
} from '@/features/transmittals/api/useTransmittals';
import type { Transmittal, EntityCode } from '@/features/transmittals/api/types';

export default function TransmittalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'active';
  const viewMode = (searchParams.get('view') || 'kanban') as 'kanban' | 'table';

  // Modal Visibility States
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [formEditTarget, setFormEditTarget] = useState<Transmittal | null>(null);

  // Deep-link read detail support (?transmittalId=... or ?id=...)
  const deepLinkedTransmittalId = searchParams.get('transmittalId') || searchParams.get('id');
  const [detailModalId, setDetailModalId] = useState<string | null>(deepLinkedTransmittalId);

  useEffect(() => {
    if (deepLinkedTransmittalId) {
      setDetailModalId(deepLinkedTransmittalId);
    }
  }, [deepLinkedTransmittalId]);

  const handleCloseDetailModal = () => {
    setDetailModalId(null);
    if (searchParams.has('transmittalId') || searchParams.has('id')) {
      const next = new URLSearchParams(searchParams);
      next.delete('transmittalId');
      next.delete('id');
      setSearchParams(next, { replace: true });
    }
  };

  const [printTarget, setPrintTarget] = useState<Transmittal | null>(null);
  const updateTransmittal = useUpdateTransmittal();

  // Workflow Dialog States
  const [approveTargetId, setApproveTargetId] = useState<string | null>(null);
  const [sendTarget, setSendTarget] = useState<Transmittal | null>(null);
  const [acknowledgeTarget, setAcknowledgeTarget] = useState<Transmittal | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [isArchiveMode, setIsArchiveMode] = useState<boolean>(false);

  // Session & RBAC
  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const setActiveEntity = useSessionStore((state) => state.setActiveEntity);

  const canView = hasPermission(permissions, 'transmittal:view');
  const canCreate = hasPermission(permissions, 'transmittal:create');

  // Queries
  const isArchivedTab = activeTab === 'archived';
  const { data: listResponse, isLoading: isListLoading } = useTransmittalsList(
    {
      archived: isArchivedTab,
      limit: 100,
    },
    { enabled: canView }
  );

  const { data: counts } = useTransmittalCounts({ enabled: canView });

  const transmittals = useMemo(() => {
    return listResponse?.data || [];
  }, [listResponse]);

  // Derive counts
  const activeCount = counts?.active ?? 0;
  const archivedCount = counts?.archived ?? 0;

  const draftCount = useMemo(
    () => transmittals.filter((t) => t.status === 'Draft').length,
    [transmittals]
  );
  const sentCount = useMemo(
    () => transmittals.filter((t) => t.status === 'Sent').length,
    [transmittals]
  );
  const ackCount = useMemo(
    () => transmittals.filter((t) => t.status === 'Acknowledged').length,
    [transmittals]
  );

  // 1. Feature Flag Guard
  if (!isModuleEnabled('Transmittals')) {
    return (
      <ModulePlaceholder
        name="Transmittals"
        description="Document transmittal tracking, client receipts, and acknowledgement receipts."
      />
    );
  }

  // 2. Permission Guard
  if (!canView) {
    return <Forbidden requiredPermission="transmittal:view" />;
  }

  const handleTabChange = (val: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', val);
      return next;
    });
  };

  const handleViewChange = (mode: 'kanban' | 'table') => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('view', mode);
      return next;
    });
  };

  // Find target objects for dialogs
  const approveTargetTransmittal = transmittals.find((t) => t.id === approveTargetId) || null;
  const deleteTargetTransmittal = transmittals.find((t) => t.id === deleteTargetId) || null;

  return (
    <div className="w-full space-y-6" data-testid="transmittals-page">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Transmittals</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <Send className="h-6 w-6 text-[#1D4ED8]" />
            Document Transmittals
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Document manifests, courier dispatch manifests, dual-path approval, and receipt tracking.
          </p>
        </div>

        {/* Header Controls: Soft Segmented Entity Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {/* Active Entity Toggle */}
          <div
            className="flex items-center bg-[#F8FAFC] p-1 rounded-[8px] border border-[#E2E8F0]"
            data-testid="transmittals-entity-toggle"
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

          {/* New Transmittal Action */}
          {canCreate && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setFormEditTarget(null);
                setIsFormModalOpen(true);
              }}
              className="text-xs font-medium gap-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] rounded-[6px] h-9 shadow-2xs cursor-pointer"
              data-testid="new-transmittal-btn"
            >
              <Plus className="h-4 w-4" /> New Transmittal
            </Button>
          )}
        </div>
      </div>

      {/* 2. Metric Summary KPI Cards (Unified Structured KPI Band) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Active Manifests</span>
            <Layers className="h-4 w-4 text-[#1D4ED8]" />
          </div>
          <div className="text-2xl font-semibold tabular-nums text-[#1E293B]" data-testid="kpi-active-count">
            {activeCount}
          </div>
        </div>

        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Drafts</span>
            <Clock className="h-4 w-4 text-[#1D4ED8]" />
          </div>
          <div className="text-xl font-semibold tabular-nums text-[#1E293B]" data-testid="kpi-draft-count">
            {draftCount}
          </div>
        </div>

        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>In Transit / Sent</span>
            <Send className="h-4 w-4 text-[#1D4ED8]" />
          </div>
          <div className="text-xl font-semibold tabular-nums text-[#1E293B]" data-testid="kpi-sent-count">
            {sentCount}
          </div>
        </div>

        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Acknowledged</span>
            <CheckCircle2 className="h-4 w-4 text-[#1D4ED8]" />
          </div>
          <div className="text-xl font-semibold tabular-nums text-[#1E293B]" data-testid="kpi-acknowledged-count">
            {ackCount}
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs and View Switcher Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-b border-[#E2E8F0] pb-2">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full sm:w-auto">
          <TabsList className="w-full sm:w-auto justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] gap-1 h-auto overflow-x-auto scrollbar-none flex flex-nowrap" data-testid="transmittal-tabs">
            <TabsTrigger
              value="active"
              className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              data-testid="tab-active"
            >
              <Layers className="h-3.5 w-3.5" />
              Active Transmittals
              <Badge variant="secondary" className="text-xs tabular-nums py-0 px-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B] font-medium ml-1.5">
                {activeCount}
              </Badge>
            </TabsTrigger>

            <TabsTrigger
              value="archived"
              className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              data-testid="tab-archived"
            >
              <Archive className="h-3.5 w-3.5" />
              Archived
              <Badge variant="secondary" className="text-xs tabular-nums py-0 px-1.5 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B] font-medium ml-1.5">
                {archivedCount}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* View mode toggle: Kanban vs Table */}
        <ViewModeToggle
          mode={viewMode}
          onChange={(m) => handleViewChange(m as 'kanban' | 'table')}
          availableModes={['kanban', 'table']}
          testIdPrefix="view-toggle"
          className="self-end sm:self-auto mb-2 sm:mb-0"
        />
      </div>

      {/* 4. Main Body: Kanban Board vs Table View */}
      {viewMode === 'kanban' && !isArchivedTab ? (
        <TransmittalKanbanBoard
          transmittals={transmittals}
          isLoading={isListLoading}
          onView={(id) => setDetailModalId(id)}
          onEdit={(t) => {
            setFormEditTarget(t);
            setIsFormModalOpen(true);
          }}
          onPrint={(t) => setPrintTarget(t)}
          onApprove={(id) => setApproveTargetId(id)}
          onSend={(t) => setSendTarget(t)}
          onAcknowledge={(t) => setAcknowledgeTarget(t)}
          onDelete={(id) => setDeleteTargetId(id)}
        />
      ) : (
        <TransmittalTable
          transmittals={transmittals}
          isLoading={isListLoading}
          onView={(id) => setDetailModalId(id)}
          onEdit={(t) => {
            setFormEditTarget(t);
            setIsFormModalOpen(true);
          }}
          onPrint={(t) => setPrintTarget(t)}
          onApprove={(id) => setApproveTargetId(id)}
          onSend={(t) => setSendTarget(t)}
          onAcknowledge={(t) => setAcknowledgeTarget(t)}
          onArchive={(id) => {
            setArchiveTargetId(id);
            setIsArchiveMode(false);
          }}
          onUnarchive={(id) => {
            setArchiveTargetId(id);
            setIsArchiveMode(true);
          }}
          onDelete={(id) => setDeleteTargetId(id)}
        />
      )}

      {/* 5. Modals & Dialogs */}
      {/* Create / Edit Modal */}
      <TransmittalFormModal
        isOpen={isFormModalOpen}
        onClose={() => {
          setIsFormModalOpen(false);
          setFormEditTarget(null);
        }}
        transmittalToEdit={formEditTarget}
      />

      {/* Detail Modal */}
      <TransmittalDetailModal
        transmittalId={detailModalId}
        isOpen={Boolean(detailModalId)}
        onClose={handleCloseDetailModal}
        onEdit={(t) => {
          setDetailModalId(null);
          setFormEditTarget(t);
          setIsFormModalOpen(true);
        }}
        onPrint={(t) => setPrintTarget(t)}
        onApprove={(id) => setApproveTargetId(id)}
        onSend={(t) => setSendTarget(t)}
        onAcknowledge={(t) => setAcknowledgeTarget(t)}
        onDelete={(id) => setDeleteTargetId(id)}
      />

      {/* Print Preview Modal (Item-rows-only fix) */}
      <TransmittalPrintModal
        transmittal={printTarget}
        onSaveItems={async (items) => {
          if (!printTarget) return;
          const updated = await updateTransmittal.mutateAsync({
            id: printTarget.id,
            data: { items, expectedVersion: printTarget.version },
          });
          if (!updated) throw new Error('Transmittal update did not return a record');
          setPrintTarget((current) => current?.id === updated.id ? { ...current, ...updated } : current);
        }}
        onEdit={(t) => {
          setPrintTarget(null);
          setDetailModalId(null);
          setFormEditTarget(t);
          setIsFormModalOpen(true);
        }}
        isOpen={Boolean(printTarget)}
        onClose={() => setPrintTarget(null)}
      />

      {/* Admin Approve Dialog */}
      <ApproveDialog
        transmittal={approveTargetTransmittal}
        isOpen={Boolean(approveTargetId)}
        onClose={() => setApproveTargetId(null)}
      />

      {/* Dual-Path Send Dialog */}
      <SendDialog
        transmittal={sendTarget}
        isOpen={Boolean(sendTarget)}
        onClose={() => setSendTarget(null)}
      />

      {/* Acknowledge Dialog */}
      <AcknowledgeDialog
        transmittal={acknowledgeTarget}
        isOpen={Boolean(acknowledgeTarget)}
        onClose={() => setAcknowledgeTarget(null)}
      />

      {/* Soft Delete Dialog */}
      <DeleteDialog
        transmittalId={deleteTargetId}
        trackingNumber={deleteTargetTransmittal?.tracking_number}
        isOpen={Boolean(deleteTargetId)}
        onClose={() => setDeleteTargetId(null)}
      />

      {/* Archive / Unarchive Dialog */}
      <ArchiveDialog
        transmittalId={archiveTargetId}
        isArchived={isArchiveMode}
        isOpen={Boolean(archiveTargetId)}
        onClose={() => setArchiveTargetId(null)}
      />

      {/* 6. Non-dismissible Blocking Action Modal (Root Mount) */}
      <BlockingActionModal />
    </div>
  );
}
