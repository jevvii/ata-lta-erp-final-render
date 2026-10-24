import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Wallet,
  Clock,
  CheckCircle2,
  DollarSign,
  Plus,
  Layers,
  FileCheck2,
  XCircle,
  Archive,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Forbidden } from '@/components/common/Forbidden';
import { ModulePlaceholder } from '@/components/common/ModulePlaceholder';
import { isModuleEnabled } from '@/lib/flags';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import {
  DisbursementsTable,
  CreateDisbursementModal,
  AdminApprovalQueue,
  DisbursementDetailDrawer,
  DisbursementArchiveTab,
} from '@/features/disbursements/components';
import { useDisbursementCounts } from '@/features/disbursements/api/useDisbursements';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { EntityCode } from '@/features/disbursements/api/types';

export default function DisbursementsPage() {
  // Realtime CDC Subscriptions (Parcel E) — kept active across all tabs
  useEntityRealtimeSync({ table: 'disbursements' });
  const [searchParams, setSearchParams] = useSearchParams();
  const rawActiveTab = searchParams.get('tab') || 'all';

  // Modal Visibility
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDisbursementId, setSelectedDisbursementId] = useState<string | null>(null);

  // Session & RBAC
  const user = useSessionStore((state) => state.user);
  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const setActiveEntity = useSessionStore((state) => state.setActiveEntity);

  const isAdmin = user?.role === 'Admin';
  const isAccounting = Boolean(
    user?.role === 'Accounting' || user?.departments?.includes('Accounting')
  );
  const isPrivilegedCreator = isAdmin || isAccounting;
  const newBtnText = isPrivilegedCreator ? 'New Disbursement' : 'Request Disbursement';

  const canView = hasPermission(permissions, 'disbursement:view');
  const canCreate = hasPermission(permissions, 'disbursement:create');

  // Unsupported/retired tabs fall back to All; staff cannot open the action workspace.
  const isAllowedPendingApprovals = isAdmin || isAccounting;
  const availableTabs = [
    'pending-approvals',
    'all',
    'drafts',
    'approved',
    'funded',
    'released',
    'rejected',
    'archive',
  ];
  let activeTab = availableTabs.includes(rawActiveTab) ? rawActiveTab : 'all';
  if (!isAllowedPendingApprovals && activeTab === 'pending-approvals') {
    activeTab = 'all';
  }

  // Deep-link support from notifications or external references (?disbursementId=... or ?id=...)
  const disbursementIdParam = searchParams.get('disbursementId') || searchParams.get('id');
  useEffect(() => {
    if (disbursementIdParam) {
      setSelectedDisbursementId(disbursementIdParam);
    }
  }, [disbursementIdParam]);

  // Badge Counts Query
  const { data: counts } = useDisbursementCounts({ enabled: canView });

  // 1. Feature Flag Guard
  if (!isModuleEnabled('Disbursements')) {
    return (
      <ModulePlaceholder
        name="Disbursements"
        description="Disbursement vouchers, petty cash entries, and payment authorizations."
      />
    );
  }

  // 2. Permission Guard
  if (!canView) {
    return <Forbidden requiredPermission="disbursement:view" />;
  }

  const handleTabChange = (val: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', val);
      return next;
    });
  };

  const activeCount = counts?.active ?? 0;
  const awaitingReleaseCount = counts?.awaitingRelease ?? 0;
  const rejectedCount = counts?.rejected ?? 0;
  const archivedCount = counts?.archived ?? 0;
  const initialRequestsCount = counts?.initialRequests ?? 0;
  const paymentReleasesCount = counts?.paymentReleases ?? 0;
  const readyForFundingCount = counts?.readyForFunding ?? 0;
  const needsCorrectionCount = counts?.needsCorrection ?? 0;

  return (
    <div className="w-full space-y-6" data-testid="disbursements-page">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">Disbursements</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <Wallet className="h-6 w-6 text-[#1D4ED8]" />
            Disbursements &amp; Expenses
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Manage firm &amp; client expense vouchers from budget approval through payment
            preparation and release.
          </p>
        </div>

        {/* Header Controls: Soft Segmented Entity Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {/* Active Entity Toggle */}
          <div
            className="flex items-center bg-[#F8FAFC] p-1 rounded-[8px] border border-[#E2E8F0]"
            data-testid="disbursements-entity-toggle"
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

          {/* New Disbursement Action */}
          {canCreate && (
            <Button
              type="button"
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
              className="text-xs font-medium gap-1.5 bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] rounded-[6px] h-9 shadow-2xs cursor-pointer"
              data-testid="page-new-disbursement-btn"
            >
              <Plus className="h-4 w-4" /> {newBtnText}
            </Button>
          )}
        </div>
      </div>

      {/* 2. Metric Summary KPI Cards (Unified Structured KPI Band) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Active Vouchers</span>
            <Layers className="h-4 w-4 text-[#1D4ED8]" />
          </div>
          <div
            className="text-2xl font-semibold tabular-nums text-[#1E293B]"
            data-testid="kpi-active-count"
          >
            {activeCount}
          </div>
        </div>

        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Awaiting Release</span>
            <DollarSign className="h-4 w-4 text-[#1D4ED8]" />
          </div>
          <div
            className="text-2xl font-semibold tabular-nums text-[#1E293B]"
            data-testid="kpi-awaiting-release-count"
          >
            {awaitingReleaseCount}
          </div>
        </div>

        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] border-t-2 border-t-[#DC2626] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#991B1B]">
            <span>Rejected</span>
            <XCircle className="h-4 w-4 text-[#DC2626]" />
          </div>
          <div
            className="text-2xl font-semibold tabular-nums text-[#991B1B]"
            data-testid="kpi-rejected-count"
          >
            {rejectedCount}
          </div>
        </div>

        <div className="p-4 bg-[#FFFFFF] border border-[#E2E8F0] rounded-[8px] shadow-card space-y-1">
          <div className="flex items-center justify-between text-xs font-medium text-[#475569]">
            <span>Archived</span>
            <Archive className="h-4 w-4 text-[#475569]" />
          </div>
          <div
            className="text-2xl font-semibold tabular-nums text-[#475569]"
            data-testid="kpi-archived-count"
          >
            {archivedCount}
          </div>
        </div>
      </div>

      {/* 3. Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="w-full justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] gap-1 h-auto overflow-x-auto scrollbar-none flex flex-nowrap">
          {isAllowedPendingApprovals && (
            <TabsTrigger
              value="pending-approvals"
              className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
              data-testid="tab-pending-approvals"
            >
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              <span>{isAdmin ? 'Pending Approvals' : 'Funding Tracking'}</span>
              <Badge
                variant="secondary"
                className="text-xs px-1.5 py-0 bg-amber-100 text-amber-800"
                data-testid="badge-pending-approvals"
              >
                {isAdmin ? initialRequestsCount + paymentReleasesCount : paymentReleasesCount}
              </Badge>
            </TabsTrigger>
          )}

          <TabsTrigger
            value="all"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-all"
          >
            All
          </TabsTrigger>

          <TabsTrigger
            value="drafts"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-drafts"
          >
            <span>Drafts</span>
            {needsCorrectionCount > 0 && (
              <Badge
                variant="secondary"
                className="text-xs px-1.5 py-0 bg-orange-100 text-orange-800 ml-1.5"
                data-testid="badge-needs-correction-count"
              >
                {needsCorrectionCount}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="approved"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-approved"
          >
            <FileCheck2 className="h-3.5 w-3.5" />
            <span>Approved</span>
            {readyForFundingCount > 0 && (
              <Badge
                variant="secondary"
                className="text-xs px-1.5 py-0 bg-[#DBEAFE] text-[#1E40AF]"
                data-testid="badge-approved-count"
              >
                {readyForFundingCount}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="funded"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-funded"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Funded</span>
          </TabsTrigger>

          <TabsTrigger
            value="released"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-released"
          >
            <DollarSign className="h-3.5 w-3.5 text-purple-600" />
            <span>Released</span>
          </TabsTrigger>

          <TabsTrigger
            value="rejected"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-rejected"
          >
            <XCircle className="h-3.5 w-3.5 text-[#DC2626]" />
            <span>Rejected</span>
          </TabsTrigger>

          <TabsTrigger
            value="archive"
            className="rounded-[6px] px-3.5 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] transition-colors cursor-pointer shrink-0 flex items-center gap-1.5"
            data-testid="tab-archive"
          >
            <Archive className="h-3.5 w-3.5" />
            <span>Archive</span>
            {archivedCount > 0 && (
              <Badge
                variant="secondary"
                className="text-xs tabular-nums px-1.5 py-0 rounded-[4px] border border-[#E2E8F0] bg-[#E2E8F0]/70 text-[#1E293B] font-medium"
                data-testid="badge-archived-count"
              >
                {archivedCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Pending Approvals (Dedicated Admin Queue / Accounting Tracking) */}
        {isAllowedPendingApprovals && (
          <TabsContent value="pending-approvals" className="space-y-4">
            <AdminApprovalQueue onSelectDisbursement={(id) => setSelectedDisbursementId(id)} />
          </TabsContent>
        )}

        {/* Tab 2: All */}
        <TabsContent value="all" className="space-y-4">
          <DisbursementsTable onSelectDisbursement={(id) => setSelectedDisbursementId(id)} />
        </TabsContent>

        {/* Tab 3: Drafts */}
        <TabsContent value="drafts" className="space-y-4">
          <DisbursementsTable
            statusFilter="Draft"
            onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
          />
        </TabsContent>

        {/* Tab 4: Approved */}
        <TabsContent value="approved" className="space-y-4">
          <DisbursementsTable
            statusFilter="Approved"
            onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
          />
        </TabsContent>

        {/* Tab 5: Funded */}
        <TabsContent value="funded" className="space-y-4">
          <DisbursementsTable
            statusFilter="Funded"
            onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
          />
        </TabsContent>

        {/* Tab 6: Released */}
        <TabsContent value="released" className="space-y-4">
          <DisbursementsTable
            statusFilter="Released"
            onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
          />
        </TabsContent>

        {/* Tab 7: Rejected */}
        <TabsContent value="rejected" className="space-y-4">
          <DisbursementsTable
            statusFilter="Rejected"
            onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
          />
        </TabsContent>

        {/* Tab 8: Archive */}
        <TabsContent value="archive" className="space-y-4">
          <DisbursementArchiveTab onSelectDisbursement={(id) => setSelectedDisbursementId(id)} />
        </TabsContent>
      </Tabs>

      {/* 4. Modals and Drawers Mounted at Root */}
      <CreateDisbursementModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      <DisbursementDetailDrawer
        id={selectedDisbursementId}
        isOpen={Boolean(selectedDisbursementId)}
        onClose={() => {
          setSelectedDisbursementId(null);
          if (searchParams.has('disbursementId') || searchParams.has('id')) {
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.delete('disbursementId');
              next.delete('id');
              return next;
            });
          }
        }}
      />

      {/* Headless Blocking Action Modal for Zero Optimistic Updates */}
      <BlockingActionModal />
    </div>
  );
}
