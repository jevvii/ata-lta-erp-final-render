import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  TrendingUp,
  Calendar,
  CalendarRange,
  Clock,
  Receipt,
  AlertTriangle,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Forbidden } from '@/components/common/Forbidden';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';
import {
  AnalyticsOverviewTab,
  DailyActivityTab,
  WeeklySummaryTab,
  MonthlyPendingTab,
  AgingReportTab,
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

  // Enforce admin-only access when user profile is loaded
  if (user && !isAdmin) {
    return <Forbidden requiredPermission="users:manage" />;
  }

  // Determine available tabs based on permissions
  const availableTabs = useMemo(() => {
    const tabs: string[] = [];
    if (canViewReports) {
      tabs.push('analytics', 'daily', 'weekly', 'monthly');
    }
    if (canViewBilling) {
      tabs.push('aging');
    }
    return tabs;
  }, [canViewReports, canViewBilling]);

  // Determine current active tab
  const requestedTab = searchParams.get('tab');
  const defaultTab = canViewReports ? 'analytics' : 'aging';
  const activeTab =
    requestedTab && availableTabs.includes(requestedTab) ? requestedTab : defaultTab;

  // Sync URL if requested tab is invalid or missing
  useEffect(() => {
    if (!canViewReports && !canViewBilling) return;
    if (!requestedTab || !availableTabs.includes(requestedTab)) {
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

  const isSingleEntityTab = ['daily', 'weekly', 'monthly', 'aging'].includes(activeTab);
  const showAllEntityWarning = activeEntity === 'ALL' && isSingleEntityTab;

  const tabLabels: Record<string, string> = {
    analytics: 'Overview & Analytics',
    daily: 'Daily Activity Report',
    weekly: 'Weekly Summary Report',
    monthly: 'Monthly Pending Report',
    aging: 'Accounts Receivable Aging',
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="reports-page">
      {/* 1. Page Header & Breadcrumbs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500 flex items-center gap-1.5 pb-1">
            <span>Modules</span>
            <span>/</span>
            <span className="text-slate-500 font-semibold">Reports</span>
            <span>/</span>
            <span className="text-slate-900 font-semibold">{tabLabels[activeTab]}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            <span>Reports & Analytics</span>
          </h1>
          <p className="text-xs text-slate-500 pt-0.5">
            Financial analytics, operational metrics, activity audits, and accounts receivable tracking.
          </p>
        </div>

        {/* Header Controls: Entity Switcher */}
        <div className="flex items-center gap-2">
          <div
            className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200"
            data-testid="entity-switcher"
          >
            {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
              <button
                key={ent}
                type="button"
                onClick={() => setActiveEntity(ent)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  activeEntity === ent
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                data-testid={`entity-btn-${ent.toLowerCase()}`}
              >
                {ent}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Entity Warning Banner for Single-Entity Scoped Tabs */}
      {showAllEntityWarning && (
        <div
          className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900"
          data-testid="entity-all-warning"
        >
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <div className="text-xs">
              <span className="font-bold block sm:inline">
                Single-Entity Scope Required:{' '}
              </span>
              <span>
                The <strong>{tabLabels[activeTab]}</strong> is scoped to a concrete entity. When viewing consolidated <strong>ALL</strong>, itemized records are empty. Please switch to ATA or LTA to view this report.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveEntity('ATA')}
              className="text-xs h-7 bg-white border-amber-300 text-amber-800 hover:bg-amber-100 cursor-pointer"
            >
              <Building2 className="w-3 h-3 mr-1" />
              Switch to ATA
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setActiveEntity('LTA')}
              className="text-xs h-7 bg-white border-amber-300 text-amber-800 hover:bg-amber-100 cursor-pointer"
            >
              <Building2 className="w-3 h-3 mr-1" />
              Switch to LTA
            </Button>
          </div>
        </div>
      )}

      {/* 3. Main Navigation Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="bg-slate-100 p-1 border border-slate-200 rounded-xl">
          {canViewReports && (
            <>
              <TabsTrigger
                value="analytics"
                className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
                data-testid="tab-trigger-analytics"
              >
                <TrendingUp className="w-3.5 h-3.5" />
                <span>Overview & Analytics</span>
              </TabsTrigger>

              <TabsTrigger
                value="daily"
                className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
                data-testid="tab-trigger-daily"
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Daily Activity</span>
              </TabsTrigger>

              <TabsTrigger
                value="weekly"
                className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
                data-testid="tab-trigger-weekly"
              >
                <CalendarRange className="w-3.5 h-3.5" />
                <span>Weekly Summary</span>
              </TabsTrigger>

              <TabsTrigger
                value="monthly"
                className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
                data-testid="tab-trigger-monthly"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Monthly Pending</span>
              </TabsTrigger>
            </>
          )}

          {canViewBilling && (
            <TabsTrigger
              value="aging"
              className="text-xs gap-1.5 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-xs rounded-lg cursor-pointer"
              data-testid="tab-trigger-aging"
            >
              <Receipt className="w-3.5 h-3.5" />
              <span>AR Aging Report</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Tab Contents */}
        {canViewReports && (
          <>
            <TabsContent value="analytics" className="mt-4 focus-visible:outline-hidden">
              <AnalyticsOverviewTab />
            </TabsContent>

            <TabsContent value="daily" className="mt-4 focus-visible:outline-hidden">
              <DailyActivityTab />
            </TabsContent>

            <TabsContent value="weekly" className="mt-4 focus-visible:outline-hidden">
              <WeeklySummaryTab />
            </TabsContent>

            <TabsContent value="monthly" className="mt-4 focus-visible:outline-hidden">
              <MonthlyPendingTab />
            </TabsContent>
          </>
        )}

        {canViewBilling && (
          <TabsContent value="aging" className="mt-4 focus-visible:outline-hidden">
            <AgingReportTab />
          </TabsContent>
        )}
      </Tabs>

      {/* Root Modal Mount */}
      <BlockingActionModal />
    </div>
  );
}
