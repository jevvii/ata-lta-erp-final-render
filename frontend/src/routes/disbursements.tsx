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
  FileText,
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
  DisbursementDetailBody,
  DisbursementArchiveTab,
  DisbursementWorkspace,
  DisbursementActionRail,
  DisbursementCodingGrid,
} from '@/features/disbursements/components';
import { useDisbursementCounts } from '@/features/disbursements/api/useDisbursements';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { EntityCode } from '@/features/disbursements/api/types';

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(min-width: 1024px)').matches;
    }
    return window.innerWidth >= 1024;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (typeof window.matchMedia === 'function') {
      const media = window.matchMedia('(min-width: 1024px)');
      setIsDesktop(media.matches);
      const listener = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
      media.addEventListener('change', listener);
      return () => media.removeEventListener('change', listener);
    }
    const handleResize = () => setIsDesktop(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isDesktop;
}

export default function DisbursementsPage() {
  // Realtime CDC Subscriptions (Parcel E) — kept active across all tabs
  useEntityRealtimeSync({ table: 'disbursements' });
  useEntityRealtimeSync({ table: 'invoices' });
  useEntityRealtimeSync({ table: 'transmittals' });
  const [searchParams, setSearchParams] = useSearchParams();
  const rawActiveTab = searchParams.get('tab') || 'all';

  // Modal Visibility & Workspace Shell State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedDisbursementId, setSelectedDisbursementId] = useState<string | null>(null);
  const [detailCollapsed, setDetailCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('disb.detailCollapsed') === 'true';
    } catch {
      return false;
    }
  });

  const isDesktop = useIsDesktop();

  const handleToggleDetail = () => {
    setDetailCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('disb.detailCollapsed', String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

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

  const handleCloseDetail = () => {
    setSelectedDisbursementId(null);
    if (searchParams.has('disbursementId') || searchParams.has('id')) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('disbursementId');
        next.delete('id');
        return next;
      });
    }
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
      <div className="border-b border-border pb-4 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-muted flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span className="text-ink font-semibold">Disbursements</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-ink flex items-center gap-2">
            <Wallet className="h-6 w-6 text-primary" />
            Disbursements &amp; Expenses
          </h1>
          <p className="text-xs sm:text-sm text-muted pt-0.5">
            Manage firm &amp; client expense vouchers from budget approval through payment
            preparation and release.
          </p>
        </div>

        {/* Header Controls: Soft Segmented Entity Switcher & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {/* Active Entity Toggle */}
          <div
            className="flex items-center bg-sidebar p-1 rounded-[8px] border border-border"
            data-testid="disbursements-entity-toggle"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
              <button
                key={ent}
                type="button"
                onClick={() => {
                  setActiveEntity(ent as EntityCode);
                  setSelectedDisbursementId(null);
                }}
                className={`px-3 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                  activeEntity === ent
                    ? 'bg-primary text-inverse shadow-2xs font-semibold'
                    : 'text-muted hover:text-ink hover:bg-hover/60'
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
              className="text-xs font-medium gap-1.5 bg-primary hover:bg-primary-hover text-inverse rounded-[6px] h-9 shadow-2xs cursor-pointer"
              data-testid="page-new-disbursement-btn"
            >
              <Plus className="h-4 w-4" /> {newBtnText}
            </Button>
          )}
        </div>
      </div>

      {/* Tabs Container wrapping Queue Bar and Multi-Pane Grid */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-3">
        {/* Accessible fallback select preserved for test harness and a11y */}
        <div className="sr-only">
          <label htmlFor="queue-select">Queue:</label>
          <select
            id="queue-select"
            value={activeTab}
            onChange={(e) => handleTabChange(e.target.value)}
            data-testid="queue-selector-select"
          >
            {isAllowedPendingApprovals && (
              <option value="pending-approvals">
                {isAdmin ? 'Pending Approvals' : 'Funding Tracking'} (
                {isAdmin ? initialRequestsCount + paymentReleasesCount : paymentReleasesCount})
              </option>
            )}
            <option value="all">All</option>
            <option value="drafts">
              Drafts {needsCorrectionCount > 0 ? `(${needsCorrectionCount})` : ''}
            </option>
            <option value="approved">
              Approved {readyForFundingCount > 0 ? `(${readyForFundingCount})` : ''}
            </option>
            <option value="funded">Funded</option>
            <option value="released">Released</option>
            <option value="rejected">
              Rejected {rejectedCount > 0 ? `(${rejectedCount})` : ''}
            </option>
            <option value="archive">
              Archive {archivedCount > 0 ? `(${archivedCount})` : ''}
            </option>
          </select>
        </div>

        {/* 2. Segmented Control (TabsList) & Inline KPI Chips (Always in line with inner navbar regardless of screen size) */}
        <div
          className="flex items-center justify-between gap-2 w-full overflow-x-auto scrollbar-none flex-nowrap"
          data-testid="disbursements-queue-bar"
        >
          <TabsList
            className="w-auto justify-start rounded-[8px] bg-sidebar p-0.5 border border-border gap-0.5 h-auto flex flex-nowrap shrink-0"
            data-testid="queue-selector-segmented"
          >
            {isAllowedPendingApprovals && (
              <TabsTrigger
                value="pending-approvals"
                className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
                data-testid="tab-pending-approvals"
              >
                <Clock className="h-3 w-3 text-warning" />
                <span>{isAdmin ? 'Pending Approvals' : 'Funding Tracking'}</span>
                <Badge
                  variant="secondary"
                  className="text-[11px] px-1 py-0 bg-warning-surface text-warning border border-warning-border"
                  data-testid="badge-pending-approvals"
                >
                  {isAdmin ? initialRequestsCount + paymentReleasesCount : paymentReleasesCount}
                </Badge>
              </TabsTrigger>
            )}

            <TabsTrigger
              value="all"
              className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              data-testid="tab-all"
            >
              All
            </TabsTrigger>

            <TabsTrigger
              value="drafts"
              className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              data-testid="tab-drafts"
            >
              <span>Drafts</span>
              {needsCorrectionCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[11px] px-1 py-0 bg-warning-surface text-warning border border-warning-border ml-1"
                  data-testid="badge-needs-correction-count"
                >
                  {needsCorrectionCount}
                </Badge>
              )}
            </TabsTrigger>

            <TabsTrigger
              value="approved"
              className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              data-testid="tab-approved"
            >
              <FileCheck2 className="h-3 w-3" />
              <span>Approved</span>
              {readyForFundingCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[11px] px-1 py-0 bg-selected text-primary-hover"
                  data-testid="badge-approved-count"
                >
                  {readyForFundingCount}
                </Badge>
              )}
            </TabsTrigger>

            <TabsTrigger
              value="funded"
              className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              data-testid="tab-funded"
            >
              <CheckCircle2 className="h-3 w-3" />
              <span>Funded</span>
            </TabsTrigger>

            <TabsTrigger
              value="released"
              className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              data-testid="tab-released"
            >
              <DollarSign className="h-3 w-3 text-info" />
              <span>Released</span>
            </TabsTrigger>

            <TabsTrigger
              value="rejected"
              className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              data-testid="tab-rejected"
            >
              <XCircle className="h-3 w-3 text-danger-solid" />
              <span>Rejected</span>
            </TabsTrigger>

            <TabsTrigger
              value="archive"
              className="rounded-[6px] px-2 sm:px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover/70 hover:text-ink data-[state=active]:bg-surface data-[state=active]:text-primary-hover data-[state=active]:font-semibold data-[state=active]:shadow-2xs data-[state=active]:border-b-2 data-[state=active]:border-primary transition-colors cursor-pointer shrink-0 flex items-center gap-1"
              data-testid="tab-archive"
            >
              <Archive className="h-3 w-3" />
              <span>Archive</span>
              {archivedCount > 0 && (
                <Badge
                  variant="secondary"
                  className="text-[11px] tabular-nums px-1 py-0 rounded-[4px] border border-border bg-hover/70 text-ink font-medium"
                  data-testid="badge-archived-count"
                >
                  {archivedCount}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Right: Inline KPI Chips (Always in line with inner navbar regardless of screen size) */}
          <div
            className="flex items-center gap-1 sm:gap-1.5 shrink-0 flex-nowrap py-0.5"
            data-testid="queue-bar-kpi-chips"
          >
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-sidebar border border-border text-[11px] shrink-0">
              <Layers className="h-3 w-3 text-primary shrink-0" />
              <span className="text-muted font-medium whitespace-nowrap">Active:</span>
              <span className="font-semibold tabular-nums text-ink" data-testid="kpi-active-count">
                {activeCount}
              </span>
            </div>

            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-sidebar border border-border text-[11px] shrink-0">
              <DollarSign className="h-3 w-3 text-primary shrink-0" />
              <span className="text-muted font-medium whitespace-nowrap">Awaiting:</span>
              <span
                className="font-semibold tabular-nums text-ink"
                data-testid="kpi-awaiting-release-count"
              >
                {awaitingReleaseCount}
              </span>
            </div>

            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-danger-surface border border-danger-border text-[11px] shrink-0">
              <XCircle className="h-3 w-3 text-danger-solid shrink-0" />
              <span className="text-danger font-medium whitespace-nowrap">Rejected:</span>
              <span
                className="font-semibold tabular-nums text-danger"
                data-testid="kpi-rejected-count"
              >
                {rejectedCount}
              </span>
            </div>

            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-[5px] bg-sidebar border border-border text-[11px] shrink-0">
              <Archive className="h-3 w-3 text-muted shrink-0" />
              <span className="text-muted font-medium whitespace-nowrap">Archived:</span>
              <span
                className="font-semibold tabular-nums text-muted"
                data-testid="kpi-archived-count"
              >
                {archivedCount}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Eyeshare-Style Multi-Pane Workspace */}
        <DisbursementWorkspace
          rail={
            <DisbursementActionRail
              selectedId={selectedDisbursementId}
              isArchiveTab={activeTab === 'archive'}
              onDeselect={handleCloseDetail}
            />
          }
          grid={
            <div className="h-full">
              {isAllowedPendingApprovals && (
                <TabsContent value="pending-approvals" className="mt-0 space-y-4">
                  <AdminApprovalQueue onSelectDisbursement={(id) => setSelectedDisbursementId(id)} />
                </TabsContent>
              )}

              <TabsContent value="all" className="mt-0 space-y-4">
                <DisbursementsTable
                  selectedId={selectedDisbursementId}
                  onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
                />
              </TabsContent>

              <TabsContent value="drafts" className="mt-0 space-y-4">
                <DisbursementsTable
                  selectedId={selectedDisbursementId}
                  statusFilter="Draft"
                  onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
                />
              </TabsContent>

              <TabsContent value="approved" className="mt-0 space-y-4">
                <DisbursementsTable
                  selectedId={selectedDisbursementId}
                  statusFilter="Approved"
                  onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
                />
              </TabsContent>

              <TabsContent value="funded" className="mt-0 space-y-4">
                <DisbursementsTable
                  selectedId={selectedDisbursementId}
                  statusFilter="Funded"
                  onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
                />
              </TabsContent>

              <TabsContent value="released" className="mt-0 space-y-4">
                <DisbursementsTable
                  selectedId={selectedDisbursementId}
                  statusFilter="Released"
                  onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
                />
              </TabsContent>

              <TabsContent value="rejected" className="mt-0 space-y-4">
                <DisbursementsTable
                  selectedId={selectedDisbursementId}
                  statusFilter="Rejected"
                  onSelectDisbursement={(id) => setSelectedDisbursementId(id)}
                />
              </TabsContent>

              <TabsContent value="archive" className="mt-0 space-y-4">
                <DisbursementArchiveTab onSelectDisbursement={(id) => setSelectedDisbursementId(id)} />
              </TabsContent>
            </div>
          }
          detail={
            isDesktop && selectedDisbursementId ? (
              <DisbursementDetailBody
                id={selectedDisbursementId}
                onClose={handleCloseDetail}
                isDocked={true}
              />
            ) : (
              <div
                className="flex flex-col items-center justify-center text-center p-8 h-full min-h-[300px] space-y-3"
                data-testid="disbursement-detail-empty"
              >
                <div className="w-12 h-12 rounded-full bg-sidebar flex items-center justify-center border border-border">
                  <FileText className="h-6 w-6 text-muted" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-ink">
                    Select a voucher to see its details
                  </h3>
                  <p className="text-xs text-muted max-w-xs">
                    Choose a voucher from the queue to review its payment info, line items, and audit history.
                  </p>
                </div>
              </div>
            )
          }
          detailCollapsed={detailCollapsed}
          onToggleDetail={handleToggleDetail}
          bottom={
            <DisbursementCodingGrid
              disbursementId={selectedDisbursementId}
            />
          }
        />
      </Tabs>

      {/* 4. Modals and Drawers Mounted at Root */}
      <CreateDisbursementModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />

      {/* Mobile/Tablet (<1024px) Detail Drawer */}
      <DisbursementDetailDrawer
        id={selectedDisbursementId}
        isOpen={!isDesktop && Boolean(selectedDisbursementId)}
        onClose={handleCloseDetail}
      />

      {/* Headless Blocking Action Modal for Zero Optimistic Updates */}
      <BlockingActionModal />
    </div>
  );
}
