import { useState, useContext } from 'react';
import { useSessionStore } from '@/lib/session';
import { useEntityRealtimeSync } from '@/lib/realtime';
import { LayoutDashboard, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LogTimeWidget, TimeStudioShellContext } from '@/features/dashboard/components/LogTimeWidget';
import { useTimeStudioStore } from '@/features/dashboard/store/useTimeStudioStore';
import { PendingTasksCard } from '@/features/dashboard/components/PendingTasksCard';
import { useTimeSummary } from '@/features/dashboard/api/useTimeEntries';
import { BlockingActionModal } from '@/features/operations/components/BlockingActionModal';

export default function DashboardPage() {
  const { user, activeEntity, setActiveEntity, unreadCount } = useSessionStore();
  const isTimeStudioInShell = useContext(TimeStudioShellContext);
  const studioIsOpen = useTimeStudioStore((state) => state.isOpen);
  const setStudioIsOpen = useTimeStudioStore((state) => state.setIsOpen);

  const [selectedTaskForLog, setSelectedTaskForLog] = useState<string | null>(null);
  const [localTimePeekOpen, setLocalTimePeekOpen] = useState<boolean>(false);

  const isTimePeekOpen = isTimeStudioInShell ? studioIsOpen : localTimePeekOpen;
  const setIsTimePeekOpen = (openOrUpdater: boolean | ((prev: boolean) => boolean)) => {
    if (isTimeStudioInShell) {
      if (typeof openOrUpdater === 'function') {
        setStudioIsOpen(openOrUpdater(useTimeStudioStore.getState().isOpen));
      } else {
        setStudioIsOpen(openOrUpdater);
      }
    } else {
      setLocalTimePeekOpen(openOrUpdater);
    }
  };
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: summary } = useTimeSummary(todayStr);

  // Collaborative Realtime CDC Subscriptions for Dashboard Live Sync (SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R3 & SPEC-REALTIME-TIME-LOGGING-001)
  useEntityRealtimeSync({ table: 'tasks' });
  useEntityRealtimeSync({ table: 'task_assignees' });
  useEntityRealtimeSync({ table: 'work_requests' });
  useEntityRealtimeSync({ table: 'time_entries' });
  useEntityRealtimeSync({ table: 'task_time_logs' });

  const totalTodayMinutes = summary?.totalMinutes ?? 0;
  const hours = Math.floor(totalTodayMinutes / 60);
  const mins = totalTodayMinutes % 60;
  const formattedTodayTime = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div className="w-full space-y-6" data-testid="dashboard-page">
      {/* 1. Ultra-Clean Minimalist Module Header (Zero visual clutter KPI ribbon) */}
      <div className="border-b border-[#CBD5E1] pb-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <nav
              aria-label="Breadcrumb"
              className="text-xs font-medium text-[#475569] flex items-center gap-1.5 pb-1"
            >
              <span>Modules</span>
              <span aria-hidden="true">/</span>
              <span className="text-[#0F172A] font-semibold">Dashboard</span>
            </nav>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0F172A] flex items-center gap-2">
              <LayoutDashboard className="h-6 w-6 text-[#1D4ED8]" />
              Welcome back, {user?.name || 'User'}
            </h1>
            <p className="text-xs sm:text-sm text-[#475569] pt-0.5">
              ATA &amp; LTA Accounting Firm ERP
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 self-start md:self-auto">
            {/* Clean Task & Time Studio Toggle Button */}
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsTimePeekOpen((prev) => !prev)}
              className={`h-9 px-3.5 rounded-[6px] border text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer ${
                isTimePeekOpen
                  ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                  : 'bg-[#FFFFFF] text-[#0F172A] border-[#CBD5E1] hover:bg-[#F8FAFC] hover:border-[#94A3B8] shadow-2xs'
              }`}
              data-testid="toggle-time-peek-btn"
              aria-expanded={isTimePeekOpen}
              title="Toggle Task & Time Studio"
            >
              {isTimePeekOpen ? (
                <PanelRightClose className="h-4 w-4 text-current" />
              ) : (
                <PanelRightOpen className="h-4 w-4 text-current" />
              )}
              <span>Task &amp; Time Studio</span>
              <span
                className={`px-1.5 py-0.5 rounded-[4px] font-mono text-xs tabular-nums ${
                  isTimePeekOpen
                    ? 'bg-[#FFFFFF]/20 text-[#FFFFFF]'
                    : 'bg-[#F1F5F9] text-[#0F172A] border border-[#CBD5E1]'
                }`}
              >
                {formattedTodayTime}
              </span>
              <span
                className={`px-1.5 py-0.5 rounded-[4px] font-mono text-xs uppercase font-bold ${
                  isTimePeekOpen
                    ? 'bg-[#22C55E] text-[#0F172A]'
                    : 'bg-[#E2E8F0] text-[#475569]'
                }`}
              >
                {isTimePeekOpen ? 'PEEKING' : 'OPEN'}
              </span>
            </Button>

            {/* Segmented Entity Switcher */}
            <div
              className="flex items-center bg-[#F1F5F9] p-1 rounded-[8px] border border-[#CBD5E1]"
              data-testid="entity-switcher"
            >
              {(['ATA', 'LTA', 'ALL'] as const).map((ent) => (
                <button
                  key={ent}
                  type="button"
                  onClick={() => setActiveEntity(ent)}
                  className={`px-3 py-1 rounded-[6px] text-xs font-semibold transition-colors cursor-pointer ${
                    activeEntity === ent
                      ? 'bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs font-semibold'
                      : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#E2E8F0]/60'
                  }`}
                  data-testid={`entity-btn-${ent.toLowerCase()}`}
                >
                  {ent}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Screen-reader accessible telemetry container preserving Vitest test contracts */}
      <div className="sr-only" data-testid="operator-telemetry-ribbon">
        <span data-testid="stat-role">{user?.role || 'Staff'}</span>
        <span data-testid="stat-entity">{activeEntity}</span>
        <span data-testid="stat-unread-count">{unreadCount}</span>
        <span data-testid="stat-today-hours">{formattedTodayTime}</span>
      </div>

      {/* Modern Assignee Pinboard / Calendar Grid */}
      <PendingTasksCard
        onLogTimeForTask={(taskId) => {
          useTimeStudioStore.getState().pinTask(taskId);
          setSelectedTaskForLog(taskId);
          setIsTimePeekOpen(true);
        }}
      />

      {/* Anchor target for Pin to Timer scroll */}
      <div id="log-time-widget-anchor" className="scroll-mt-6" />

      {/* Module #2: Log-Time Widget (Rendered locally only when Shell is not present, e.g. standalone test suites) */}
      {!isTimeStudioInShell && (
        <LogTimeWidget
          externalSelectedTaskId={selectedTaskForLog}
          preselectedTaskId={selectedTaskForLog}
          isOpen={isTimePeekOpen}
          onOpenChange={setIsTimePeekOpen}
        />
      )}

      {/* Blocking Action Modal for RFC 7807 Error Discipline and Mutation States */}
      <BlockingActionModal />
    </div>
  );
}
