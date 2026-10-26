import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Building,
  ChevronLeft,
  ChevronRight,
  Search,
  CalendarDays,
  CalendarRange,
  ListOrdered,
  Kanban,
  User,
  Users,
  Layers,
} from 'lucide-react';
import { useDashboardWorkRequests } from '../api/useDashboardWorkRequests';
import { useSessionStore } from '@/lib/session';
import { isTaskAssignee } from '@/features/operations/lib/taskScope';
import type { DashboardWorkRequestItem } from '../api/types';

export interface PendingTasksCardProps {
  onLogTimeForTask?: (taskId: string) => void;
}

type CalendarView = 'week' | 'month' | 'agenda' | 'board';
type StatusFilter = 'all' | 'not_started' | 'in_progress' | 'completed' | 'blocked';
type AssigneeFilter = 'all' | 'me';

interface CardTheme {
  bg: string;
  border: string;
  hoverBorder: string;
  ink: string;
  muted: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  avatarBg: string;
}

function parseDateString(dStr: string | null | undefined): Date | null {
  if (!dStr) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dStr);
  if (match) {
    const year = parseInt(match[1]!, 10);
    const month = parseInt(match[2]!, 10) - 1;
    const day = parseInt(match[3]!, 10);
    return new Date(year, month, day);
  }
  const parsed = new Date(dStr);
  return isNaN(parsed.getTime())
    ? null
    : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function formatDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDueDate(dueDate: string | null | undefined): string {
  if (!dueDate) return 'No due date';
  const d = parseDateString(dueDate);
  if (!d) return dueDate;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getInitials(name: string): string {
  if (!name) return 'WR';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'WR';
  if (parts.length === 1) return (parts[0]?.slice(0, 2) || 'WR').toUpperCase();
  const first = parts[0]?.[0] || '';
  const last = parts[parts.length - 1]?.[0] || '';
  return (first + last).toUpperCase();
}

/**
 * Color-code calendar Work Request cards strictly by:
 * 1. Completed within/before due date -> Green
 * 2. Overdue OR Completed beyond due date -> Red
 * 3. Incomplete without due date -> Dedicated Violet theme (never Red)
 * 4. Entity LTA -> Warm Gold/Amber
 * 5. Entity ATA (default) -> Sky / Blue
 */
function getWorkRequestTheme(wr: DashboardWorkRequestItem, today: Date): CardTheme {
  const parsedDue = parseDateString(wr.dueDate);

  const completedTheme: CardTheme = {
    bg: 'bg-[#ECFDF5]',
    border: 'border-[#10B981]',
    hoverBorder: 'hover:border-[#059669]',
    ink: 'text-[#065F46]',
    muted: 'text-[#047857]',
    badgeBg: 'bg-[#D1FAE5]',
    badgeText: 'text-[#065F46]',
    badgeBorder: 'border-[#34D399]',
    avatarBg: '#059669',
  };

  const overdueOrLateTheme: CardTheme = {
    bg: 'bg-[#FFF1F2]',
    border: 'border-[#F43F5E]',
    hoverBorder: 'hover:border-[#E11D48]',
    ink: 'text-[#991B1B]',
    muted: 'text-[#BE123C]',
    badgeBg: 'bg-[#FFE4E6]',
    badgeText: 'text-[#991B1B]',
    badgeBorder: 'border-[#FB7185]',
    avatarBg: '#E11D48',
  };

  const isCompleted =
    String(wr.status || '').toLowerCase() === 'completed' ||
    String(wr.status || '').toLowerCase() === 'done';

  // 1. Completed: check if marked completed within/before due date or beyond it
  if (isCompleted) {
    const completedDate = parseDateString(wr.completedAt || wr.updatedAt) || today;
    if (parsedDue && completedDate.getTime() > parsedDue.getTime()) {
      return overdueOrLateTheme;
    }
    return completedTheme;
  }

  // 2. Incomplete without a due date -> Dedicated Violet/Purple theme (never Red)
  if (!parsedDue) {
    return {
      bg: 'bg-[#F5F3FF]',
      border: 'border-[#8B5CF6]',
      hoverBorder: 'hover:border-[#7C3AED]',
      ink: 'text-[#4C1D95]',
      muted: 'text-[#5B21B6]',
      badgeBg: 'bg-[#EDE9FE]',
      badgeText: 'text-[#4C1D95]',
      badgeBorder: 'border-[#A78BFA]',
      avatarBg: '#6D28D9',
    };
  }

  // 3. Incomplete past due date -> Red
  if (parsedDue.getTime() < today.getTime()) {
    return overdueOrLateTheme;
  }

  // 4. Entity LTA -> Warm Gold/Amber
  if (String(wr.entity).toUpperCase() === 'LTA') {
    return {
      bg: 'bg-[#FFFBEB]',
      border: 'border-[#F59E0B]',
      hoverBorder: 'hover:border-[#D97706]',
      ink: 'text-[#78350F]',
      muted: 'text-[#92400E]',
      badgeBg: 'bg-[#FEF3C7]',
      badgeText: 'text-[#78350F]',
      badgeBorder: 'border-[#FBBF24]',
      avatarBg: '#D97706',
    };
  }

  // 5. Entity ATA (default) -> Sky Blue
  return {
    bg: 'bg-[#EFF6FF]',
    border: 'border-[#3B82F6]',
    hoverBorder: 'hover:border-[#2563EB]',
    ink: 'text-[#1E3A8A]',
    muted: 'text-[#1D4ED8]',
    badgeBg: 'bg-[#DBEAFE]',
    badgeText: 'text-[#1E3A8A]',
    badgeBorder: 'border-[#60A5FA]',
    avatarBg: '#1D4ED8',
  };
}

function getWeekDays(referenceDate: Date): Date[] {
  const day = referenceDate.getDay();
  const sunday = new Date(referenceDate);
  sunday.setDate(referenceDate.getDate() - day);
  sunday.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const next = new Date(sunday);
    next.setDate(sunday.getDate() + i);
    days.push(next);
  }
  return days;
}

function getMonthDays(referenceDate: Date): { date: Date; isCurrentMonth: boolean }[] {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const firstDayOfMonth = new Date(year, month, 1);
  const startDayOfWeek = firstDayOfMonth.getDay();

  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(startDate.getDate() - startDayOfWeek);

  const days: { date: Date; isCurrentMonth: boolean }[] = [];
  for (let i = 0; i < 35; i++) {
    const cellDate = new Date(startDate);
    cellDate.setDate(startDate.getDate() + i);
    days.push({
      date: cellDate,
      isCurrentMonth: cellDate.getMonth() === month,
    });
  }
  return days;
}

export function PendingTasksCard({ onLogTimeForTask }: PendingTasksCardProps = {}) {
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const { workRequests, isLoading } = useDashboardWorkRequests();

  // Calendar Navigation & Multi-View State
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [view, setView] = useState<CalendarView>('week');

  // Search & Filtering State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all');

  // Incomplete Work Requests (for badge counter and empty state)
  const pendingWorkRequests = useMemo(() => {
    return workRequests.filter(
      (wr) =>
        String(wr.status || '').toLowerCase() !== 'completed' &&
        String(wr.status || '').toLowerCase() !== 'done' &&
        String(wr.status || '').toLowerCase() !== 'cancelled' &&
        String(wr.status || '').toLowerCase() !== 'archived'
    );
  }, [workRequests]);

  // All active and completed work requests remain visible on calendar
  const calendarWorkRequests = useMemo(() => {
    return workRequests.filter(
      (wr) =>
        String(wr.status || '').toLowerCase() !== 'cancelled' &&
        String(wr.status || '').toLowerCase() !== 'archived'
    );
  }, [workRequests]);

  // Today normalized to midnight
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const todayKey = useMemo(() => formatDateKey(today), [today]);

  // Active Week Days
  const weekDays = useMemo(() => getWeekDays(anchorDate), [anchorDate]);
  const weekDateKeys = useMemo(() => new Set(weekDays.map(formatDateKey)), [weekDays]);

  // Active Month Days
  const monthDays = useMemo(() => getMonthDays(anchorDate), [anchorDate]);

  // Filtered Work Requests according to Search, Status & Assignee filters
  const displayedWorkRequests = useMemo(() => {
    return calendarWorkRequests.filter((wr) => {
      // 1. Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = wr.title.toLowerCase().includes(query);
        const matchesClient = (wr.clientName || '').toLowerCase().includes(query);
        const matchesWo = (wr.work_order_number || '').toLowerCase().includes(query);
        const matchesAssignee = (wr.assigneeName || '').toLowerCase().includes(query);
        if (!matchesTitle && !matchesClient && !matchesWo && !matchesAssignee) {
          return false;
        }
      }

      // 2. Status filter
      const normStatus = String(wr.status || '').toLowerCase();
      if (statusFilter === 'not_started') {
        if (normStatus !== 'draft' && normStatus !== 'pending' && normStatus !== 'not started') {
          return false;
        }
      } else if (statusFilter === 'in_progress') {
        if (normStatus !== 'in progress' && normStatus !== 'for review' && normStatus !== 'under review') {
          return false;
        }
      } else if (statusFilter === 'completed') {
        if (normStatus !== 'completed' && normStatus !== 'done') {
          return false;
        }
      } else if (statusFilter === 'blocked') {
        if (String(wr.priority || '').toLowerCase() !== 'urgent' && normStatus !== 'on hold' && normStatus !== 'blocked') {
          return false;
        }
      }

      // 3. Assignee filter ('me')
      if (assigneeFilter === 'me') {
        const userId = user?.id?.toLowerCase();
        if (!userId) return false;
        const isLead = (wr.assigneeId || '')?.toLowerCase() === userId;
        const isCo = wr.coAssignees.some((ca) => ca.toLowerCase() === userId);
        const isTaskAssigned = wr.tasks.some((t) =>
          isTaskAssignee(user as unknown as Parameters<typeof isTaskAssignee>[0], t)
        );
        if (!isLead && !isCo && !isTaskAssigned) {
          return false;
        }
      }

      return true;
    });
  }, [calendarWorkRequests, searchQuery, statusFilter, assigneeFilter, user]);

  // Navigation Handlers
  const handlePrev = () => {
    const nextDate = new Date(anchorDate);
    if (view === 'month') {
      nextDate.setMonth(nextDate.getMonth() - 1);
    } else {
      nextDate.setDate(nextDate.getDate() - 7);
    }
    setAnchorDate(nextDate);
  };

  const handleNext = () => {
    const nextDate = new Date(anchorDate);
    if (view === 'month') {
      nextDate.setMonth(nextDate.getMonth() + 1);
    } else {
      nextDate.setDate(nextDate.getDate() + 7);
    }
    setAnchorDate(nextDate);
  };

  const handleToday = () => {
    setAnchorDate(new Date());
  };

  /**
   * Clicking a Work Request routes the user to that work request's task board view page:
   * /operations?tab=work-requests&view=board&wrId=${wr.id}
   */
  const handleNavigateToWorkRequestBoard = (wr: DashboardWorkRequestItem) => {
    const params = new URLSearchParams({
      tab: 'work-requests',
      view: 'board',
      wrId: wr.id,
      workRequestId: wr.id,
    });
    navigate(`/operations?${params.toString()}`);
  };

  const handlePinToTimer = (wr: DashboardWorkRequestItem) => {
    const targetTaskId = wr.tasks[0]?.id || wr.id;
    onLogTimeForTask?.(targetTaskId);
    const anchor = document.getElementById('log-time-widget-anchor');
    if (anchor) {
      anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const formatPhase = (phase: string | null | undefined) => {
    if (!phase) return null;
    switch (phase) {
      case 'pre_processing':
        return 'Pre-Processing';
      case 'processing':
        return 'Processing';
      case 'quality_assurance':
        return 'Quality Assurance';
      case 'completion':
        return 'Completion';
      default:
        return phase;
    }
  };

  // Fixed Date Range Label
  const dateRangeLabel = useMemo(() => {
    if (view === 'month') {
      return anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    const start = weekDays[0]!;
    const end = weekDays[6]!;
    const startMonth = start.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = end.toLocaleDateString('en-US', { month: 'short' });
    const startDay = start.getDate();
    const endDay = end.getDate();
    const year = end.getFullYear();

    return `${startMonth} ${startDay} – ${endMonth} ${endDay}, ${year}`;
  }, [view, anchorDate, weekDays]);

  // Work Request Distribution Map for Week View
  const wrsByWeekDay = useMemo(() => {
    const map = new Map<string, DashboardWorkRequestItem[]>();
    for (const d of weekDays) {
      map.set(formatDateKey(d), []);
    }

    const fallbackKey = weekDateKeys.has(todayKey) ? todayKey : formatDateKey(weekDays[0]!);

    for (const wr of displayedWorkRequests) {
      const parsed = parseDateString(wr.dueDate);
      if (parsed) {
        const key = formatDateKey(parsed);
        if (map.has(key)) {
          map.get(key)!.push(wr);
          continue;
        }
      }
      if (map.has(fallbackKey)) {
        map.get(fallbackKey)!.push(wr);
      } else {
        const firstKey = formatDateKey(weekDays[0]!);
        map.get(firstKey)?.push(wr);
      }
    }
    return map;
  }, [displayedWorkRequests, weekDays, weekDateKeys, todayKey]);

  // Work Request Distribution Map for Month View
  const wrsByMonthDay = useMemo(() => {
    const map = new Map<string, DashboardWorkRequestItem[]>();
    for (const cell of monthDays) {
      map.set(formatDateKey(cell.date), []);
    }

    const fallbackKey = map.has(todayKey) ? todayKey : formatDateKey(monthDays[0]!.date);

    for (const wr of displayedWorkRequests) {
      const parsed = parseDateString(wr.dueDate);
      if (parsed) {
        const key = formatDateKey(parsed);
        if (map.has(key)) {
          map.get(key)!.push(wr);
          continue;
        }
      }
      if (map.has(fallbackKey)) {
        map.get(fallbackKey)!.push(wr);
      } else {
        const firstKey = formatDateKey(monthDays[0]!.date);
        map.get(firstKey)?.push(wr);
      }
    }
    return map;
  }, [displayedWorkRequests, monthDays, todayKey]);

  // Uncramped, highly compressed calendar Work Request card
  const renderWorkRequestCard = (wr: DashboardWorkRequestItem) => {
    const theme = getWorkRequestTheme(wr, today);
    const phaseLabel = formatPhase(wr.phase);
    const isCompleted =
      String(wr.status || '').toLowerCase() === 'completed' ||
      String(wr.status || '').toLowerCase() === 'done';

    const assignees = wr.assigneesList && wr.assigneesList.length > 0
      ? wr.assigneesList
      : [
          {
            id: wr.assigneeId || 'lead',
            name: wr.assigneeName || 'Assigned Lead',
            role: 'Lead',
          },
        ];

    const coCount = wr.coAssigneeCount > 0
      ? wr.coAssigneeCount
      : assignees.length > 1
      ? assignees.length - 1
      : 0;

    const isNarrowCalendarView = view === 'week' || view === 'month';
    const maxVisibleAvatars = isNarrowCalendarView ? 2 : 3;
    const visibleAssignees = assignees.slice(0, maxVisibleAvatars);
    const remainingCount = assignees.length > maxVisibleAvatars
      ? assignees.length - maxVisibleAvatars
      : coCount > 0 && assignees.length <= 1
      ? coCount
      : 0;

    const cardPaddingClass = view === 'month' ? 'p-2' : view === 'week' || view === 'agenda' ? 'p-2.5' : 'p-3';
    const avatarSizeClass = isNarrowCalendarView ? 'h-5 w-5 text-[10px]' : 'h-6 w-6 text-xs';
    const pillSizeClass = isNarrowCalendarView ? 'h-5 min-w-[20px] text-[10px]' : 'h-6 min-w-[24px] text-xs';

    return (
      <div
        key={wr.id}
        onClick={() => handleNavigateToWorkRequestBoard(wr)}
        className={`group relative flex flex-col ${cardPaddingClass} rounded-[8px] border-[1.5px] ${theme.bg} ${theme.border} ${theme.hoverBorder} shadow-2xs hover:shadow-md transition-all duration-150 cursor-pointer text-left overflow-hidden min-w-0`}
        data-testid={`pending-wr-${wr.id}`}
        title={`Click to open Task Board: ${wr.title}`}
      >

        {/* 1. Top Meta Row: Entity badge + Phase badge + Status pill + WO Number */}
        <div className="flex flex-wrap items-center gap-1 pb-1">
          <Badge
            variant={wr.entity === 'LTA' ? 'lta' : 'ata'}
            size="compact"
            className="rounded-[4px] text-xs font-bold"
          >
            {wr.entity}
          </Badge>

          {phaseLabel && (
            <Badge
              variant="secondary"
              size="compact"
              className="rounded-[4px] text-xs border border-[#CBD5E1] bg-white/90 text-[#0F172A] font-medium"
            >
              {phaseLabel}
            </Badge>
          )}

          <span
            className={`text-xs font-semibold px-1.5 py-0.2 rounded-[4px] border ${theme.badgeBg} ${theme.badgeText} ${theme.badgeBorder} flex items-center gap-1`}
          >
            {isCompleted ? (
              <CheckCircle2 className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            {wr.status}
          </span>

          {wr.work_order_number && (
            <span className="text-[10px] font-mono font-semibold text-[#475569] bg-white/80 border border-[#CBD5E1] px-1 py-0.2 rounded-[3px]">
              {wr.work_order_number}
            </span>
          )}

          {/* Due date pill rendered in agenda view or when present */}
          {view === 'agenda' && (
            <span className="text-xs font-mono text-[#334155] ml-auto">
              {wr.dueDate ? `Due ${formatDueDate(wr.dueDate)}` : 'Rolling · Today'}
            </span>
          )}
        </div>

        {/* 2. Work Request Title: text-sm bold break-words */}
        <div className="pt-0.5 pb-0.5 min-w-0">
          <h3 className={`font-bold text-sm leading-snug break-words ${theme.ink}`}>
            {wr.title}
          </h3>
        </div>

        {/* 3. Client & Tasks Summary Rows */}
        <div className="space-y-0.5 text-xs text-[#1E293B] min-w-0">
          {wr.clientName && (
            <div className="flex items-center gap-1 min-w-0 text-[#475569]">
              <Building className="h-3.5 w-3.5 shrink-0 text-[#64748B]" />
              <span className="truncate">{wr.clientName}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 min-w-0 pt-0.5 text-[#334155]">
            <Layers className="h-3.5 w-3.5 shrink-0 text-[#2563EB]" />
            <span className="font-semibold text-xs tabular-nums">
              {wr.tasksCount} {wr.tasksCount === 1 ? 'Task' : 'Tasks'}
            </span>
            {wr.tasksCount > 0 && (
              <span className="text-[11px] text-[#64748B]">
                ({wr.completedTasksCount} completed)
              </span>
            )}
          </div>
        </div>

        {/* 4. Bottom Footer Bar: Avatars on Left, Action Buttons on Right */}
        <div className="flex items-center justify-between gap-1.5 pt-1.5 mt-1 border-t border-black/10 min-w-0">
          {/* Left: Lead + Co-assignees Avatars */}
          <div
            className="flex items-center -space-x-1.5 min-w-0 shrink overflow-hidden"
            title={assignees.map((p) => p.name).join(', ')}
          >
            {visibleAssignees.map((person, idx) => (
              <div
                key={person.id || idx}
                className={`${avatarSizeClass} rounded-full border-[1.5px] border-white bg-white font-bold flex items-center justify-center shadow-2xs shrink-0`}
                style={{ backgroundColor: theme.avatarBg, color: '#FFFFFF' }}
                title={`${person.name}${person.role ? ` · ${person.role}` : ''}`}
              >
                {getInitials(person.name)}
              </div>
            ))}
            {remainingCount > 0 && (
              <div
                className={`${pillSizeClass} px-1 rounded-full border-[1.5px] border-white bg-white text-[#0F172A] font-bold flex items-center justify-center shadow-2xs shrink-0 font-mono`}
                title={`+${remainingCount} more assignees`}
              >
                +{remainingCount}
              </div>
            )}
            <span className="sr-only">
              {wr.assigneeName || 'Assigned Lead'} {coCount > 0 ? `+${coCount}` : ''}
            </span>
          </div>

          {/* Right: Action Buttons */}
          <div className="flex items-center gap-1 shrink-0 ml-auto">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handlePinToTimer(wr);
              }}
              className={cn(
                "rounded-[5px] border border-black/15 bg-[#FFFFFF]/85 hover:bg-[#FFFFFF] inline-flex items-center justify-center font-semibold cursor-pointer shadow-2xs transition-colors shrink-0",
                view === 'agenda' ? "h-6 px-1.5 gap-1 text-xs" : "h-6 w-6 p-0"
              )}
              data-testid={`quick-log-task-btn-${wr.id}`}
              title="Pin to Timer"
            >
              <Clock className="h-3 w-3 shrink-0 text-[#1D4ED8]" />
              {view === 'agenda' ? <span>Pin</span> : <span className="sr-only">Pin to Timer</span>}
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNavigateToWorkRequestBoard(wr);
              }}
              className={cn(
                "rounded-[5px] border border-black/15 bg-[#FFFFFF]/85 hover:bg-[#FFFFFF] inline-flex items-center justify-center font-semibold cursor-pointer shadow-2xs transition-colors shrink-0",
                isNarrowCalendarView ? "h-6 w-6 p-0" : "h-6 px-2 gap-1 text-xs"
              )}
              data-testid={`view-wr-btn-${wr.id}`}
              title="Open Task Board"
            >
              <Kanban className="h-3 w-3 shrink-0 text-[#1D4ED8]" />
              {!isNarrowCalendarView && <span className="hidden sm:inline text-[11px]">Task Board</span>}
              <span className="sr-only" data-testid={`view-task-btn-${wr.id}`}>
                View Task Board
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <Card
      data-testid="pending-tasks-card"
      className="border border-[#CBD5E1] bg-[#FFFFFF] rounded-[8px] shadow-card overflow-hidden w-full"
    >
      {/* 1. Top Calendar Command Header */}
      <CardHeader className="p-4 sm:p-5 border-b border-[#CBD5E1] space-y-3.5">
        {/* Row 1: Title + Count Badge (Left) & Date Nav + Range + View Switcher (Right) */}
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          {/* Title + Inline Count Badge */}
          <div className="flex flex-wrap items-center gap-2.5">
            <CardTitle className="text-lg font-bold text-[#0F172A] flex items-center gap-2">
              <CalendarIcon className="h-5 w-5 text-[#1D4ED8]" />
              <span>Assigned Work Requests</span>
              <span className="sr-only">Pending Tasks Assigned to Me</span>
            </CardTitle>
            <Badge
              variant={pendingWorkRequests.length > 0 ? 'warning' : 'success'}
              className="text-xs tabular-nums rounded-[6px] border border-[#CBD5E1] px-2.5 py-1 font-semibold"
              data-testid="pending-tasks-count-badge"
            >
              <span data-testid="pending-tasks-count">
                {pendingWorkRequests.length} {pendingWorkRequests.length === 1 ? 'Work Request' : 'Work Requests'} Incomplete
              </span>
            </Badge>
          </div>

          {/* Right Controls: Date Navigation, Range Pill, and View Switcher */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Date Navigation Bar */}
            <div className="flex items-center bg-[#F1F5F9] p-0.5 rounded-[6px] border border-[#CBD5E1]">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handlePrev}
                className="h-7 w-7 p-0 rounded-[4px] text-[#0F172A] hover:bg-[#E2E8F0]"
                data-testid="calendar-prev-btn"
                title="Previous"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleToday}
                className="h-7 px-2.5 text-xs font-semibold text-[#0F172A] hover:bg-[#E2E8F0]"
                data-testid="calendar-today-btn"
              >
                Today
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleNext}
                className="h-7 w-7 p-0 rounded-[4px] text-[#0F172A] hover:bg-[#E2E8F0]"
                data-testid="calendar-next-btn"
                title="Next"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Active Date Range Readout */}
            <div className="px-2.5 py-1 rounded-[6px] bg-[#FFFFFF] border border-[#CBD5E1] font-mono tabular-nums text-xs font-semibold text-[#0F172A] shadow-2xs">
              {dateRangeLabel}
            </div>

            {/* Multi-View Switcher */}
            <div
              className="flex items-center bg-[#F1F5F9] p-0.5 rounded-[6px] border border-[#CBD5E1]"
              data-testid="calendar-view-switcher"
            >
              <button
                type="button"
                onClick={() => setView('week')}
                className={`px-2.5 py-1 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                  view === 'week'
                    ? 'bg-[#FFFFFF] text-[#0F172A] shadow-2xs font-semibold'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
                data-testid="calendar-view-week"
              >
                <CalendarRange className="h-3.5 w-3.5 text-[#1D4ED8]" />
                Week
              </button>
              <button
                type="button"
                onClick={() => setView('month')}
                className={`px-2.5 py-1 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                  view === 'month'
                    ? 'bg-[#FFFFFF] text-[#0F172A] shadow-2xs font-semibold'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
                data-testid="calendar-view-month"
              >
                <CalendarDays className="h-3.5 w-3.5 text-[#1D4ED8]" />
                Month
              </button>
              <button
                type="button"
                onClick={() => setView('agenda')}
                className={`px-2.5 py-1 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                  view === 'agenda'
                    ? 'bg-[#FFFFFF] text-[#0F172A] shadow-2xs font-semibold'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
                data-testid="calendar-view-agenda"
              >
                <ListOrdered className="h-3.5 w-3.5 text-[#1D4ED8]" />
                Agenda
              </button>
              <button
                type="button"
                onClick={() => setView('board')}
                className={`px-2.5 py-1 rounded-[4px] text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                  view === 'board'
                    ? 'bg-[#FFFFFF] text-[#0F172A] shadow-2xs font-semibold'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
                data-testid="calendar-view-board"
              >
                <Kanban className="h-3.5 w-3.5 text-[#1D4ED8]" />
                Board
              </button>
            </div>
          </div>
        </div>

        {/* Row 2: Search Input (Left), Visual Legend (Center), Status + Assignee Filters (Right) */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 pt-1 border-t border-[#CBD5E1]/60">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#64748B]" />
            <Input
              type="text"
              placeholder="Search work requests, clients, WO#..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-xs bg-[#FFFFFF] border-[#CBD5E1] rounded-[6px] focus-visible:ring-1 focus-visible:ring-[#1D4ED8]"
              data-testid="pending-tasks-search"
            />
          </div>

          {/* Visual Color Key / Legend */}
          <div className="flex items-center gap-2 text-xs font-medium text-[#475569]">
            <span className="text-xs uppercase font-bold text-[#64748B]">Legend:</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#3B82F6] border border-[#2563EB]" />
              <span>ATA</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F59E0B] border border-[#D97706]" />
              <span>LTA</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#8B5CF6] border border-[#7C3AED]" />
              <span>No Due Date</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#F43F5E] border border-[#E11D48]" />
              <span>Overdue</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] border border-[#059669]" />
              <span>Complete</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter Pills */}
            <div className="flex items-center bg-[#F1F5F9] p-0.5 rounded-[6px] border border-[#CBD5E1] text-xs">
              {(
                [
                  { id: 'all', label: 'All Statuses' },
                  { id: 'not_started', label: 'Not Started' },
                  { id: 'in_progress', label: 'In Progress' },
                  { id: 'completed', label: 'Completed' },
                  { id: 'blocked', label: 'Blocked / Urgent' },
                ] as const
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id)}
                  className={`px-2 py-0.5 rounded-[4px] font-medium transition-colors cursor-pointer ${
                    statusFilter === s.id
                      ? 'bg-[#FFFFFF] text-[#0F172A] font-semibold shadow-2xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Assignee Filter Pills */}
            <div className="flex items-center bg-[#F1F5F9] p-0.5 rounded-[6px] border border-[#CBD5E1] text-xs">
              <button
                type="button"
                onClick={() => setAssigneeFilter('all')}
                className={`px-2 py-0.5 rounded-[4px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                  assigneeFilter === 'all'
                    ? 'bg-[#FFFFFF] text-[#0F172A] font-semibold shadow-2xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <Users className="h-3 w-3" />
                All Assignees
              </button>
              <button
                type="button"
                onClick={() => setAssigneeFilter('me')}
                className={`px-2 py-0.5 rounded-[4px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                  assigneeFilter === 'me'
                    ? 'bg-[#FFFFFF] text-[#0F172A] font-semibold shadow-2xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                <User className="h-3 w-3" />
                Assigned to Me
              </button>
            </div>
          </div>
        </div>
      </CardHeader>

      {/* 2. Full-Width Calendar Canvas */}
      <CardContent className="p-4 sm:p-5">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-[#475569]" data-testid="pending-tasks-loading">
            <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-[#CBD5E1] border-r-transparent mb-2 align-middle" />
            <p className="font-medium">Loading schedule and assigned work requests...</p>
          </div>
        ) : calendarWorkRequests.length === 0 ? (
          <div
            className="p-8 text-center bg-[#FFFFFF] border border-[#CBD5E1] rounded-[8px] space-y-2 shadow-2xs"
            data-testid="pending-tasks-empty"
          >
            <CheckCircle2 className="h-8 w-8 text-[#166534] mx-auto" />
            <h4 className="text-sm font-bold text-[#0F172A]">All caught up!</h4>
            <p className="text-xs text-[#475569] max-w-sm mx-auto">
              You have no active work requests assigned to you.
            </p>
          </div>
        ) : (
          <div className="w-full space-y-3" data-testid="pending-tasks-list">
            {pendingWorkRequests.length === 0 && (
              <div
                className="px-3.5 py-2.5 bg-[#ECFDF5] border border-[#10B981] rounded-[8px] flex items-center justify-between gap-2 shadow-2xs"
                data-testid="pending-tasks-empty"
              >
                <div className="flex items-center gap-2 text-xs text-[#065F46]">
                  <CheckCircle2 className="h-4 w-4 text-[#059669] shrink-0" />
                  <span className="font-bold">All caught up!</span>
                  <span>
                    You have no incomplete work requests assigned to you. Completed requests remain visible below.
                  </span>
                </div>
              </div>
            )}

            {/* 1. WEEK VIEW (DEFAULT) */}
            {view === 'week' && (
              <div className="w-full">
                <div className="grid grid-cols-1 md:grid-cols-7 border border-[#CBD5E1] rounded-[8px] overflow-hidden divide-y md:divide-y-0 md:divide-x divide-[#CBD5E1] bg-[#FFFFFF] min-h-[500px]">
                  {weekDays.map((dayDate) => {
                    const dayKey = formatDateKey(dayDate);
                    const isToday = dayKey === todayKey;
                    const dayWrs = wrsByWeekDay.get(dayKey) || [];

                    return (
                      <div key={dayKey} className="flex flex-col min-h-[460px] bg-[#FFFFFF] min-w-0">
                        {/* Column Header */}
                        <div
                          className={`p-2 text-center border-b border-[#CBD5E1] ${
                            isToday ? 'bg-[#EFF6FF]' : 'bg-[#F1F5F9]'
                          }`}
                        >
                          <span className="block text-xs uppercase font-bold tracking-wider text-[#64748B]">
                            {dayDate.toLocaleDateString('en-US', { weekday: 'short' })}
                          </span>
                          <div className="flex items-center justify-center gap-1.5 mt-0.5">
                            <span
                              className={`text-xs font-mono font-bold tabular-nums ${
                                isToday
                                  ? 'bg-[#1D4ED8] text-white px-2 py-0.5 rounded-[4px]'
                                  : 'text-[#0F172A]'
                              }`}
                            >
                              {dayDate.getDate()}
                            </span>
                            {isToday && (
                              <span className="text-xs font-bold text-[#1D4ED8]">TODAY</span>
                            )}
                          </div>
                        </div>

                        {/* Column Work Request List with gap-1.5 */}
                        <div className="p-2 space-y-1.5 flex-1 bg-[#F8FAFC]/50 overflow-y-auto">
                          {dayWrs.map((wr) => renderWorkRequestCard(wr))}
                          {dayWrs.length === 0 && (
                            <div className="h-20 flex items-center justify-center text-xs text-[#94A3B8] italic border border-dashed border-[#CBD5E1]/60 rounded-[6px]">
                              No work requests
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. MONTH VIEW */}
            {view === 'month' && (
              <div className="w-full">
                <div className="grid grid-cols-7 border border-[#CBD5E1] rounded-[8px] overflow-hidden divide-y divide-[#CBD5E1] text-xs bg-white">
                  {/* Header Row */}
                  <div className="col-span-7 grid grid-cols-7 bg-[#F1F5F9] font-bold text-[#64748B] text-center py-2 border-b border-[#CBD5E1]">
                    <span>Sunday</span>
                    <span>Monday</span>
                    <span>Tuesday</span>
                    <span>Wednesday</span>
                    <span>Thursday</span>
                    <span>Friday</span>
                    <span>Saturday</span>
                  </div>

                  {/* Month Matrix Cells */}
                  {monthDays.map((cell, idx) => {
                    const dayKey = formatDateKey(cell.date);
                    const isToday = dayKey === todayKey;
                    const dayWrs = wrsByMonthDay.get(dayKey) || [];

                    return (
                      <div
                        key={idx}
                        className={`min-h-[105px] p-1.5 border-r border-[#CBD5E1] last:border-r-0 flex flex-col min-w-0 ${
                          cell.isCurrentMonth ? 'bg-white' : 'bg-[#F8FAFC]/70'
                        } ${isToday ? 'ring-1 ring-[#1D4ED8] bg-[#EFF6FF]/30' : ''}`}
                      >
                        <div className="flex items-center justify-between pb-1">
                          <span
                            className={`text-xs font-mono font-bold tabular-nums ${
                              isToday
                                ? 'bg-[#1D4ED8] text-white px-1.5 py-0.5 rounded-[4px]'
                                : cell.isCurrentMonth
                                ? 'text-[#0F172A]'
                                : 'text-[#94A3B8]'
                            }`}
                          >
                            {cell.date.getDate()}
                          </span>
                          {isToday && (
                            <span className="text-xs font-bold text-[#1D4ED8]">Today</span>
                          )}
                        </div>

                        <div className="space-y-1.5 flex-1 overflow-y-auto">
                          {dayWrs.map((wr) => renderWorkRequestCard(wr))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. AGENDA VIEW */}
            {view === 'agenda' && (
              <div className="space-y-4 max-w-4xl mx-auto w-full">
                {displayedWorkRequests.length === 0 ? (
                  <div className="p-8 text-center bg-[#F8FAFC] border border-[#CBD5E1] rounded-[6px] text-xs text-[#64748B]">
                    No work requests match the active filters.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {displayedWorkRequests.map((wr) => (
                      <div key={wr.id} className="w-full">
                        {renderWorkRequestCard(wr)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. BOARD / PINBOARD VIEW */}
            {view === 'board' && (
              <div className="bg-[#F8FAFC] bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] [background-size:16px_16px] p-4 rounded-[8px] border border-[#CBD5E1] w-full">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
                  {displayedWorkRequests.map((wr) => renderWorkRequestCard(wr))}
                </div>
              </div>
            )}

            {/* Zero Filter Matches State */}
            {displayedWorkRequests.length === 0 && calendarWorkRequests.length > 0 && (
              <div className="p-8 text-center bg-white rounded-[6px] border border-[#CBD5E1] space-y-2 mt-4">
                <p className="text-xs text-[#475569]">
                  No work requests match the active filters or search query.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setAssigneeFilter('all');
                  }}
                  className="text-xs h-7 rounded-[6px]"
                >
                  Reset All Filters
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
