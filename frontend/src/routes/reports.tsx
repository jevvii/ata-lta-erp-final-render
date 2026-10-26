import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Forbidden } from '@/components/common/Forbidden';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import {
  AnalyticsOverviewTab,
  DailyActivityTab,
  WeeklySummaryTab,
  MonthlyPendingTab,
  AgingReportTab,
  ReportScopePrompt,
} from '@/features/reports';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';

export default function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Session & RBAC
  const permissions = useSessionStore((state) => state.permissions);
  const user = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const setActiveEntity = useSessionStore((state) => state.setActiveEntity);

  const isAdmin = user?.role === 'Admin' || hasPermission(permissions, 'users:manage');
  const canViewReports = hasPermission(permissions, 'reports:view');
  const canViewBilling = hasPermission(permissions, 'billing:view');

  // Determine available tabs based on permissions
  const availableTabs = useMemo(() => {
    const tabs: string[] = [];
    if (canViewReports) {
      tabs.push('overview', 'daily', 'weekly', 'monthly');
    }
    if (canViewBilling) {
      tabs.push('aging');
    }
    return tabs;
  }, [canViewReports, canViewBilling]);

  // Normalize incoming tab parameter to support ?tab=analytics alias for overview
  const normalizeTab = (tab: string | null): string => {
    if (!tab) return '';
    if (tab === 'analytics' || tab === 'overview') return 'overview';
    return tab;
  };

  const requestedTab = searchParams.get('tab');
  const normalizedRequestedTab = normalizeTab(requestedTab);
  const defaultTab = canViewReports ? 'overview' : 'aging';
  const activeTab =
    normalizedRequestedTab && availableTabs.includes(normalizedRequestedTab)
      ? normalizedRequestedTab
      : defaultTab;

  // Sync URL if requested tab is invalid or missing
  useEffect(() => {
    if (!canViewReports && !canViewBilling) return;
    const isOverviewAlias = requestedTab === 'analytics' && canViewReports;
    if (!requestedTab || (!availableTabs.includes(requestedTab) && !isOverviewAlias)) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', defaultTab);
          return next;
        },
        { replace: true }
      );
    }
  }, [canViewReports, canViewBilling, requestedTab, defaultTab, availableTabs, setSearchParams]);

  // Enforce admin-only access when user profile is loaded
  if (user && !isAdmin) {
    return <Forbidden requiredPermission="users:manage" />;
  }

  // If user has neither permission, show Forbidden screen
  if (!canViewReports && !canViewBilling) {
    return <Forbidden requiredPermission="reports:view" />;
  }

  const handleTabChange = (val: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', val);
      return next;
    });
  };

  const tabDisplayTitles: Record<string, string> = {
    overview: 'Overview',
    daily: 'Daily activity',
    weekly: 'Weekly summary',
    monthly: 'Monthly pending',
    aging: 'AR aging',
  };

  return (
    <div className="w-full space-y-6" data-testid="reports-page">
      {/* 1. Unified Module Header */}
      <div className="border-b border-[#E2E8F0] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
          >
            <span>Modules</span>
            <span aria-hidden="true">/</span>
            <span>Reports</span>
            <span aria-hidden="true">/</span>
            <span className="text-[#1E293B] font-semibold">
              {tabDisplayTitles[activeTab] || 'Overview'}
            </span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight text-[#1E293B] flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-[#1D4ED8]" />
            Reports
          </h1>
          <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
            Review activity, balances, and pending items.
          </p>
        </div>

        {/* Header Controls: Soft Segmented Entity Switcher */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div
            className="flex items-center bg-[#F8FAFC] p-1 rounded-[8px] border border-[#E2E8F0]"
            data-testid="entity-switcher"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
              <button
                key={ent}
                type="button"
                onClick={() => setActiveEntity(ent)}
                className={`px-3 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                  activeEntity === ent
                    ? 'bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs'
                    : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                }`}
                data-testid={`entity-btn-${ent.toLowerCase()}`}
              >
                {ent}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Unified Inner Tab Strip */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="w-full justify-start rounded-[8px] bg-[#F8FAFC] p-1 border border-[#E2E8F0] gap-1 h-auto overflow-x-auto scrollbar-none">
          {canViewReports && (
            <>
              <TabsTrigger
                value="overview"
                className="rounded-[6px] px-4 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] data-[state=active]:shadow-2xs transition-colors cursor-pointer"
                data-testid="tab-trigger-overview"
              >
                Overview
              </TabsTrigger>

              <TabsTrigger
                value="daily"
                className="rounded-[6px] px-4 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] data-[state=active]:shadow-2xs transition-colors cursor-pointer"
                data-testid="tab-trigger-daily"
              >
                Daily activity
              </TabsTrigger>

              <TabsTrigger
                value="weekly"
                className="rounded-[6px] px-4 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] data-[state=active]:shadow-2xs transition-colors cursor-pointer"
                data-testid="tab-trigger-weekly"
              >
                Weekly summary
              </TabsTrigger>

              <TabsTrigger
                value="monthly"
                className="rounded-[6px] px-4 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] data-[state=active]:shadow-2xs transition-colors cursor-pointer"
                data-testid="tab-trigger-monthly"
              >
                Monthly pending
              </TabsTrigger>
            </>
          )}

          {canViewBilling && (
            <TabsTrigger
              value="aging"
              className="rounded-[6px] px-4 py-2 text-xs sm:text-sm font-medium text-[#475569] hover:bg-[#E2E8F0]/70 hover:text-[#1E293B] data-[state=active]:bg-[#FFFFFF] data-[state=active]:text-[#1E40AF] data-[state=active]:font-semibold data-[state=active]:border-b-2 data-[state=active]:border-[#1D4ED8] data-[state=active]:shadow-2xs transition-colors cursor-pointer"
              data-testid="tab-trigger-aging"
            >
              AR aging
            </TabsTrigger>
          )}
        </TabsList>

        {/* Tab Contents: Detail Tabs in ALL Scope Render ReportScopePrompt */}
        {canViewReports && (
          <>
            <TabsContent value="overview" className="mt-4 focus-visible:outline-hidden">
              <AnalyticsOverviewTab />
            </TabsContent>

            <TabsContent value="daily" className="mt-4 focus-visible:outline-hidden">
              {activeEntity === 'ALL' ? <ReportScopePrompt /> : <DailyActivityTab />}
            </TabsContent>

            <TabsContent value="weekly" className="mt-4 focus-visible:outline-hidden">
              {activeEntity === 'ALL' ? <ReportScopePrompt /> : <WeeklySummaryTab />}
            </TabsContent>

            <TabsContent value="monthly" className="mt-4 focus-visible:outline-hidden">
              {activeEntity === 'ALL' ? <ReportScopePrompt /> : <MonthlyPendingTab />}
            </TabsContent>
          </>
        )}

        {canViewBilling && (
          <TabsContent value="aging" className="mt-4 focus-visible:outline-hidden">
            {activeEntity === 'ALL' ? <ReportScopePrompt /> : <AgingReportTab />}
          </TabsContent>
        )}
      </Tabs>

      {/* Root Modal Mount */}
      <BlockingActionModal />
    </div>
  );
}
