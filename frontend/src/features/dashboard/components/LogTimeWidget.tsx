import { workDate } from '@/lib/workDate';
import { DateInput } from '@/components/ui/date-input';
import { createContext, useContext, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Clock,
  Play,
  Square,
  RotateCcw,
  Calendar,
  FileText,
  CheckCircle2,
  Trash2,
  Edit2,
  ListOrdered,
  Plus,
  Activity,
  Layers,
  X,
} from 'lucide-react';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import {
  useTimeSummary,
  useTimeEntriesList,
  useCreateTimeEntry,
} from '../api/useTimeEntries';
import { useAssignedTasks } from '../api/useAssignedTasks';
import { TimeEntryEditModal } from './TimeEntryEditModal';
import { TimeEntryDeleteModal } from './TimeEntryDeleteModal';
import { useBlockingModal } from '@/features/operations/components/BlockingActionModal';
import { ApiError } from '@/lib/api';
import type { TimeEntry } from '../api/types';
import {
  useTimeStudioStore,
  getLiveElapsedSeconds,
  formatStopwatch,
} from '../store/useTimeStudioStore';

export const TimeStudioShellContext = createContext<boolean>(false);

export interface LogTimeWidgetProps {
  externalSelectedTaskId?: string | null;
  preselectedTaskId?: string | null;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const TASK_PALETTE = ['#1D4ED8', '#0369A1', '#0F766E', '#CA8A04', '#7C3AED', '#475569'];

export function LogTimeWidget({
  externalSelectedTaskId,
  preselectedTaskId,
  isOpen,
  onOpenChange,
}: LogTimeWidgetProps = {}) {
  const isTimeStudioInShell = useContext(TimeStudioShellContext);

  const storeIsOpen = useTimeStudioStore((state) => state.isOpen);
  const setStoreIsOpen = useTimeStudioStore((state) => state.setIsOpen);

  const selectedTaskId = useTimeStudioStore((state) => state.selectedTaskId);
  const setSelectedTaskId = useTimeStudioStore((state) => state.setSelectedTaskId);

  const selectedDate = useTimeStudioStore((state) => state.selectedDate);
  const setSelectedDate = useTimeStudioStore((state) => state.setSelectedDate);

  const durationMinutes = useTimeStudioStore((state) => state.durationMinutes);
  const setDurationMinutes = useTimeStudioStore((state) => state.setDurationMinutes);

  const durationSeconds = useTimeStudioStore((state) => state.durationSeconds);
  const setDurationSeconds = useTimeStudioStore((state) => state.setDurationSeconds);

  const note = useTimeStudioStore((state) => state.note);
  const setNote = useTimeStudioStore((state) => state.setNote);

  const isTimerRunning = useTimeStudioStore((state) => state.isTimerRunning);
  const timerStartedAt = useTimeStudioStore((state) => state.timerStartedAt);
  const accumulatedSeconds = useTimeStudioStore((state) => state.accumulatedSeconds);
  const startTimer = useTimeStudioStore((state) => state.startTimer);
  const pauseTimer = useTimeStudioStore((state) => state.pauseTimer);
  const resetTimer = useTimeStudioStore((state) => state.resetTimer);

  const effectiveExternalTaskId = externalSelectedTaskId ?? preselectedTaskId;
  const effectiveIsOpen = isOpen !== undefined ? isOpen : (isTimeStudioInShell ? storeIsOpen : true);
  const isDrawerMode = isOpen !== undefined || isTimeStudioInShell;

  const handleToggleOpen = () => {
    const next = !effectiveIsOpen;
    if (onOpenChange) {
      onOpenChange(next);
    }
    setStoreIsOpen(next);
  };

  const handleClose = () => {
    if (onOpenChange) {
      onOpenChange(false);
    }
    setStoreIsOpen(false);
  };

  const user = useSessionStore((state) => state.user);
  const permissions = useSessionStore((state) => state.permissions);

  const canCreateLog = hasPermission(permissions, 'timelog:create');
  const canEditOwn = hasPermission(permissions, 'timelog:edit_own');
  const canEditAll = hasPermission(permissions, 'timelog:edit_all');

  // Form State
  const todayStr = workDate();
  const [validationError, setValidationError] = useState<string | null>(null);

  // Modals for Edit and Delete
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<TimeEntry | null>(null);

  // Queries & Mutations
  const { tasks: assignedTasks, isLoading: isLoadingTasks, isError: taskLoadFailed, refetch: reloadTasks } = useAssignedTasks();
  const { data: summary } = useTimeSummary(selectedDate, user?.id);
  const { data: entries = [], isLoading: isLoadingEntries } = useTimeEntriesList({
    userId: user?.id,
    from: selectedDate,
    to: selectedDate,
  });

  const createMutation = useCreateTimeEntry();
  const { openLoading, openSuccess, openError } = useBlockingModal();

  // Support Escape Key to close peek drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && effectiveIsOpen) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [effectiveIsOpen, onOpenChange]);

  // Synchronize externalSelectedTaskId if provided
  useEffect(() => {
    if (effectiveExternalTaskId) {
      setSelectedTaskId(effectiveExternalTaskId);
    }
  }, [effectiveExternalTaskId, setSelectedTaskId]);

  // Set default task if available and none selected or invalid
  useEffect(() => {
    if (!isLoadingTasks && assignedTasks.length > 0) {
      const isSelectedPresent = assignedTasks.some((task) => task.taskId === selectedTaskId);
      if (!isSelectedPresent) {
        if (effectiveExternalTaskId && assignedTasks.some((task) => task.taskId === effectiveExternalTaskId)) {
          setSelectedTaskId(effectiveExternalTaskId);
        } else {
          setSelectedTaskId(assignedTasks[0]?.taskId || '');
        }
      }
    }
  }, [assignedTasks, selectedTaskId, isLoadingTasks, effectiveExternalTaskId, setSelectedTaskId]);

  // Timer Tick Re-render Trigger
  const [, setLiveTick] = useState(0);
  useEffect(() => {
    if (!isTimerRunning) return;
    const interval = setInterval(() => {
      setLiveTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const elapsedSeconds = getLiveElapsedSeconds(
    { isTimerRunning, timerStartedAt, accumulatedSeconds },
    Date.now()
  );

  const handleStartTimer = () => {
    startTimer();
  };

  const handleStopTimer = () => {
    pauseTimer();
  };

  const handleResetTimer = () => {
    resetTimer();
  };

  const formatTimerDisplay = (sec: number) => {
    return formatStopwatch(sec);
  };

  const handleDurationPreset = (minutes: number) => {
    setDurationMinutes(minutes);
    setDurationSeconds(0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (createMutation.isPending) return;
    if (isTimerRunning) {
      setValidationError('Stop the timer before saving your time entry.');
      return;
    }
    if (!selectedTaskId || !assignedTasks.some((task) => task.taskId === selectedTaskId)) {
      setValidationError('Please select an assigned task to log time against.');
      return;
    }
    const totalDurationSeconds = durationMinutes * 60 + durationSeconds;
    if (
      !Number.isInteger(durationMinutes) ||
      !Number.isInteger(durationSeconds) ||
      durationMinutes < 0 ||
      durationSeconds < 0 ||
      durationSeconds > 59 ||
      totalDurationSeconds < 1 ||
      totalDurationSeconds > 1440 * 60
    ) {
      setValidationError('Duration must be between 1 second and 1440 minutes.');
      return;
    }
    if (!selectedDate || selectedDate > todayStr) {
      setValidationError('Entry date cannot be in the future.');
      return;
    }

    setValidationError(null);

    const effectiveMinutes = Math.min(1440, Math.max(1, Math.ceil(totalDurationSeconds / 60)));

    openLoading({
      title: 'Logging Time Entry',
      message: 'Saving your time entry...',
      actionName: 'create-time-entry',
    });

    try {
      await createMutation.mutateAsync({
        taskId: selectedTaskId,
        entryDate: selectedDate,
        durationMinutes: effectiveMinutes,
        note: note.trim() || null,
      });

      const recordedLabel =
        durationSeconds > 0
          ? `${durationMinutes > 0 ? `${durationMinutes}m ` : ''}${durationSeconds}s`
          : `${durationMinutes} minutes`;

      openSuccess({
        title: 'Time Logged Successfully',
        message: `${recordedLabel} recorded for ${selectedDate}.`,
      });

      // Reset form
      setNote('');
      resetTimer();
    } catch (err) {
      console.error('[LogTimeWidget] Create failed:', err);
      if (err instanceof ApiError) {
        openError({
          code: err.code || 'TIME_ENTRY_ERROR',
          detail: err.detail || err.message,
          status: err.status,
          title: 'Failed to Log Time',
          onRetry: () => handleSubmit(e),
        });
      } else {
        openError({
          detail: err instanceof Error ? err.message : 'Unexpected error logging time',
          title: 'Submission Error',
        });
      }
    }
  };

  const formatMinutes = (total: number) => {
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${m}m`;
  };

  const formatMinutesAndSeconds = (mins: number, secs: number) => {
    if (secs > 0) {
      if (mins === 0) return `${secs}s`;
      return `${formatMinutes(mins)} ${String(secs).padStart(2, '0')}s`;
    }
    return formatMinutes(mins);
  };

  const canEditEntry = (entry: TimeEntry) => {
    if (canEditAll) return true;
    if (canEditOwn && entry.userId === user?.id) return true;
    return false;
  };

  const getTaskDisplayTitle = (taskId: string) => {
    const found = assignedTasks.find((t) => t.taskId === taskId);
    if (found) {
      return `${found.taskTitle} (${found.workRequestTitle})`;
    }
    const summaryItem = summary?.byTask.find((t) => t.taskId === taskId);
    if (summaryItem) {
      return summaryItem.title;
    }
    return taskId;
  };

  // Chronometer ring progress
  const secondsInMinute = elapsedSeconds % 60;
  const ringCircumference = 100.53; // 2 * Math.PI * 16
  const ringOffset = ringCircumference - (ringCircumference * (secondsInMinute / 60));

  // Active Pinned Task Information
  const activeTaskIndex = assignedTasks.findIndex((t) => t.taskId === selectedTaskId);
  const activeTask = activeTaskIndex >= 0 ? assignedTasks[activeTaskIndex] : assignedTasks[0];

  // Capacity Telemetry
  const totalMins = summary?.totalMinutes ?? 0;
  const shiftCapacityPct = Math.round((totalMins / 480) * 100);
  const radialCircumference = 125.66; // 2 * Math.PI * 20
  const radialOffset = radialCircumference - (radialCircumference * Math.min(100, shiftCapacityPct)) / 100;

  return (
    <>
      {/* Main Container / Non-Blocking Right-Side Peek Drawer */}
      <div
        className={
          isDrawerMode
            ? `fixed top-0 right-0 z-40 h-dvh w-full max-w-[540px] xl:max-w-[600px] bg-[#FFFFFF] border-l border-[#CBD5E1] shadow-2xl flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                effectiveIsOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'
              }`
            : 'w-full bg-[#FFFFFF] border border-[#CBD5E1] rounded-[8px] p-5 space-y-4 shadow-2xs flex flex-col'
        }
        data-testid="log-time-widget"
      >
        {/* 1. Sticky Peek Header Bar (Calm, Middle-Aged User-Friendly) */}
        <div className="border-b border-[#CBD5E1] bg-[#FFFFFF] p-4 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-[#0F172A]">Task &amp; Time Studio</h2>
            <p className="text-xs text-[#475569]">
              Inspect assigned task, run live timer, or record shift hours
            </p>
          </div>

          <div className="flex items-center gap-2">
            {isTimerRunning ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#DCFCE7] border border-[#16A34A] text-[#166534] text-xs font-mono font-bold uppercase tracking-wider animate-pulse">
                <span className="h-2 w-2 rounded-full bg-[#16A34A]" />
                Recording
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[4px] bg-[#F1F5F9] border border-[#CBD5E1] text-[#475569] text-xs font-mono font-semibold uppercase tracking-wider">
                <span className="h-2 w-2 rounded-full bg-[#94A3B8]" />
                Ready
              </span>
            )}

            {(onOpenChange || isDrawerMode) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClose}
                className="h-8 px-2.5 text-xs font-semibold rounded-[6px] text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] border border-[#CBD5E1] cursor-pointer"
                data-testid="close-time-peek-btn"
                title="Close Side Peek (Esc)"
              >
                <X className="h-4 w-4 mr-1" />
                <span>Close</span>
              </Button>
            )}
          </div>
        </div>

        {/* Scrollable Peek Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Card 1 — Active Task & Assignee Inspector */}
          <div
            className="p-4 rounded-[8px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-2xs space-y-3"
            data-testid="peek-task-inspector"
            title={activeTask?.taskTitle}
          >
            {/* Scoped Task Picker is the First Element */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#1D4ED8]" />
                  Assigned Task Switcher
                </label>
                <span className="text-xs text-[#475569] font-mono">
                  {assignedTasks.length} available
                </span>
              </div>

              {taskLoadFailed && (
                <div role="alert" className="text-xs text-[#DC2626]">
                  Unable to load assigned tasks.{' '}
                  <button
                    type="button"
                    onClick={() => void reloadTasks()}
                    className="underline font-semibold cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}
              {isLoadingTasks ? (
                <div className="h-10 w-full bg-[#F1F5F9] animate-pulse rounded-[6px] border border-[#CBD5E1]" />
              ) : (
                <select
                  value={selectedTaskId}
                  onChange={(e) => setSelectedTaskId(e.target.value)}
                  disabled={!canCreateLog}
                  className="w-full h-10 text-sm rounded-[6px] border border-[#64748B] bg-[#FFFFFF] px-3 py-2 text-[#0F172A] shadow-none focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] focus:outline-none disabled:bg-[#F1F5F9] disabled:text-[#475569]"
                  data-testid="task-picker-select"
                >
                  {assignedTasks.length === 0 ? (
                    <option value="">No tasks currently assigned to you</option>
                  ) : (
                    assignedTasks.map((task) => (
                      <option key={task.taskId} value={task.taskId}>
                        [{task.entity}] {task.taskTitle} — {task.workRequestTitle}
                      </option>
                    ))
                  )}
                </select>
              )}
            </div>

            {/* Clean Daylight Task Summary Box */}
            <div className="p-3.5 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0] space-y-2.5">
              {/* Badges Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge
                    variant="default"
                    className="text-xs font-mono font-bold uppercase rounded-[4px] bg-[#1D4ED8] text-[#FFFFFF] border border-[#1D4ED8]"
                  >
                    {activeTask?.entity || 'ATA'}
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="text-xs font-mono font-semibold rounded-[4px] bg-[#FFFFFF] text-[#0F172A] border border-[#CBD5E1]"
                  >
                    {activeTask?.status || 'In Progress'}
                  </Badge>
                  {activeTask?.phase && (
                    <Badge
                      variant="outline"
                      className="text-xs font-mono rounded-[4px] border-[#CBD5E1] bg-[#FFFFFF] text-[#475569]"
                    >
                      {activeTask.phase}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className="text-xs font-mono rounded-[4px] border-[#CBD5E1] bg-[#FFFFFF] text-[#475569]"
                  >
                    {activeTask?.priority || 'Normal'}
                  </Badge>
                </div>
                <div className="text-xs font-mono text-[#475569]">
                  Due: {activeTask?.dueDate || 'Rolling / Today'}
                </div>
              </div>

              {/* Explicit Assignee Stamp with Friendly Accent Avatar */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#DBEAFE] text-[#1E40AF] border border-[#93C5FD] font-mono font-bold text-xs">
                    {(activeTask?.assigneeName || user?.name || 'OP')
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </div>
                  <div className="min-w-0 text-xs">
                    <div className="font-bold text-[#0F172A] truncate">
                      Assigned to: {activeTask?.assigneeName || user?.name || 'Operator'}
                    </div>
                    <div className="text-xs text-[#475569] font-mono">
                      {activeTask?.coAssigneeCount && activeTask.coAssigneeCount > 0
                        ? `+${activeTask.coAssigneeCount} co-assignees`
                        : 'Sole Assignee'}
                    </div>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="text-xs font-mono rounded-[4px] border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] shrink-0"
                >
                  {activeTask?.assigneeRole || user?.role || 'Staff'}
                </Badge>
              </div>

              {/* Work Request & Client Metadata */}
              <div className="pt-2 border-t border-[#E2E8F0] text-xs space-y-1">
                <div className="text-[#475569] truncate">
                  <span className="font-semibold text-[#0F172A]">Work Request:</span>{' '}
                  {activeTask?.workRequestTitle || 'General Compliance'}
                </div>
                <div className="text-[#475569] truncate">
                  <span className="font-semibold text-[#0F172A]">Client:</span>{' '}
                  {activeTask?.clientName || 'Firm Client'}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 — Unified Time Recording Studio (Daylight Stopwatch + Manual Entry Form) */}
          <div className="p-4 rounded-[8px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-2xs space-y-4">
            <div className="flex items-center gap-2 border-b border-[#E2E8F0] pb-2.5">
              <Clock className="h-4 w-4 text-[#1D4ED8]" />
              <h3 className="text-sm font-bold text-[#0F172A] uppercase tracking-wide">
                Time Recording Studio
              </h3>
            </div>

            {/* Section 2A: Daylight Stopwatch Bar */}
            <div
              className={`p-3.5 rounded-[8px] transition-all ${
                isTimerRunning
                  ? 'bg-[#EFF6FF] border-[1.5px] border-[#2563EB]'
                  : 'bg-[#F8FAFC] border border-[#CBD5E1]'
              }`}
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                {/* Left: Progress Ring, Label, Digital Display */}
                <div className="flex items-center gap-3">
                  <div className="relative flex items-center justify-center shrink-0">
                    <svg className="w-10 h-10 -rotate-90 transform" viewBox="0 0 40 40">
                      <circle cx="20" cy="20" r="16" stroke="#CBD5E1" strokeWidth="3" fill="none" />
                      <circle
                        cx="20"
                        cy="20"
                        r="16"
                        stroke={isTimerRunning ? '#2563EB' : '#94A3B8'}
                        strokeWidth="3"
                        fill="none"
                        strokeDasharray={ringCircumference}
                        strokeDashoffset={ringOffset}
                        strokeLinecap="round"
                        className="transition-all duration-300"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="relative flex h-2 w-2">
                        {isTimerRunning && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#16A34A] opacity-75" />
                        )}
                        <span
                          className={`relative inline-flex rounded-full h-2 w-2 ${
                            isTimerRunning ? 'bg-[#16A34A]' : 'bg-[#94A3B8]'
                          }`}
                        />
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold tracking-wider text-[#475569] uppercase">
                        LIVE STOPWATCH
                      </span>
                      {isTimerRunning ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#DCFCE7] border border-[#16A34A] text-[#166534] text-xs font-mono font-bold uppercase tracking-wider animate-pulse">
                          RECORDING
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] bg-[#E2E8F0] border border-[#CBD5E1] text-[#475569] text-xs font-mono font-semibold uppercase tracking-wider">
                          READY
                        </span>
                      )}
                    </div>
                    <div
                      className="text-2xl font-bold font-mono tracking-tight tabular-nums text-[#0F172A]"
                      data-testid="timer-display"
                    >
                      {formatTimerDisplay(elapsedSeconds)}
                    </div>
                  </div>
                </div>

                {/* Right: Transport Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {!isTimerRunning ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleStartTimer}
                      disabled={!canCreateLog}
                      className="text-xs h-9 px-3.5 font-bold uppercase tracking-wider rounded-[6px] bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] border border-[#1D4ED8] shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      data-testid="start-timer-btn"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                      Start Timer
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleStopTimer}
                      className="text-xs h-9 px-3.5 font-bold uppercase tracking-wider rounded-[6px] bg-[#CA8A04] hover:bg-[#A16207] text-[#FFFFFF] border border-[#CA8A04] shadow-2xs flex items-center gap-1.5 cursor-pointer animate-pulse"
                      data-testid="stop-timer-btn"
                    >
                      <Square className="h-3.5 w-3.5 fill-current" />
                      Stop &amp; Fill
                    </Button>
                  )}
                  {elapsedSeconds > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleResetTimer}
                      title="Reset timer"
                      className="h-9 w-9 rounded-[6px] text-[#475569] hover:text-[#0F172A] hover:bg-[#E2E8F0] border border-[#CBD5E1] cursor-pointer"
                      data-testid="reset-timer-btn"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Quick-Switch Task Chips Strip (Daylight Styling) */}
              {assignedTasks.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-2.5 mt-2.5 border-t border-[#CBD5E1]">
                  <span className="text-xs font-mono text-[#475569]">Quick Switch:</span>
                  {assignedTasks.slice(0, 4).map((task, idx) => {
                    const isCurrent = task.taskId === selectedTaskId;
                    return (
                      <button
                        key={task.taskId}
                        type="button"
                        onClick={() => setSelectedTaskId(task.taskId)}
                        title={`${task.taskTitle} (${task.workRequestTitle})`}
                        data-testid={`quick-task-pill-${task.taskId}`}
                        className={`px-2 py-1 text-xs font-mono font-semibold rounded-[4px] border transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                            : 'bg-[#FFFFFF] text-[#334155] border-[#CBD5E1] hover:bg-[#F1F5F9]'
                        }`}
                      >
                        #{String(idx + 1).padStart(2, '0')} · {task.entity}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-[#E2E8F0]" />

            {/* Section 2B: Manual Time Entry Form */}
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {validationError && (
                <div
                  className="p-2.5 rounded-[6px] bg-[#FEF2F2] border border-[#FCA5A5] text-xs text-[#991B1B] font-medium"
                  data-testid="time-validation-error"
                >
                  {validationError}
                </div>
              )}

              {/* Work Date */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5 text-[#475569]" />
                  Work Date
                </label>
                <DateInput
                  aria-label="Work date"
                  type="date"
                  max={todayStr}
                  value={selectedDate}
                  onValueChange={(value) => setSelectedDate(value)}
                  className="text-xs h-9 border-[#64748B] bg-[#FFFFFF] text-[#0F172A]"
                  disabled={!canCreateLog}
                  required
                  data-testid="entry-date-input"
                />
              </div>

              {/* Duration Keypad (Minutes + Exact Chronometer Seconds) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#475569]" />
                    Duration (Min &amp; Sec)
                  </label>
                  <span className="text-xs text-[#0F172A] font-mono font-semibold tabular-nums">
                    {formatMinutesAndSeconds(durationMinutes, durationSeconds)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Paired Minutes : Seconds Inputs */}
                  <div className="inline-flex items-center gap-1.5">
                    <div className="relative flex items-center">
                      <Input
                        type="number"
                        min={0}
                        max={1440}
                        value={durationMinutes}
                        onChange={(e) =>
                          setDurationMinutes(
                            Math.max(0, Math.min(1440, parseInt(e.target.value, 10) || 0))
                          )
                        }
                        disabled={!canCreateLog}
                        aria-label="Duration minutes"
                        className="text-xs h-9 w-[72px] pr-6 font-bold font-mono rounded-[6px] border border-[#64748B] bg-[#FFFFFF] text-[#0F172A] tabular-nums"
                        required
                        data-testid="duration-minutes-input"
                      />
                      <span className="pointer-events-none absolute right-2 text-xs font-mono font-semibold text-[#64748B]">
                        m
                      </span>
                    </div>

                    <span className="text-xs font-mono font-bold text-[#475569]">:</span>

                    <div className="relative flex items-center">
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        value={durationSeconds}
                        onChange={(e) => {
                          const raw = parseInt(e.target.value, 10) || 0;
                          if (raw >= 60) {
                            setDurationMinutes((prev) => Math.min(1440, prev + Math.floor(raw / 60)));
                            setDurationSeconds(raw % 60);
                          } else {
                            setDurationSeconds(Math.max(0, raw));
                          }
                        }}
                        disabled={!canCreateLog}
                        aria-label="Duration seconds"
                        className="text-xs h-9 w-[68px] pr-6 font-bold font-mono rounded-[6px] border border-[#64748B] bg-[#FFFFFF] text-[#0F172A] tabular-nums"
                        data-testid="duration-seconds-input"
                      />
                      <span className="pointer-events-none absolute right-2 text-xs font-mono font-semibold text-[#64748B]">
                        s
                      </span>
                    </div>
                  </div>

                  {/* Stepper buttons -15m and +15m */}
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setDurationMinutes((prev) => Math.max(1, prev - 15))}
                      disabled={!canCreateLog}
                      className="text-xs h-9 px-2 rounded-[6px] font-mono font-semibold border border-[#64748B] bg-[#F1F5F9] text-[#0F172A] hover:bg-[#E2E8F0] cursor-pointer"
                      title="Subtract 15 minutes"
                    >
                      -15m
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => setDurationMinutes((prev) => Math.min(1440, prev + 15))}
                      disabled={!canCreateLog}
                      className="text-xs h-9 px-2 rounded-[6px] font-mono font-semibold border border-[#64748B] bg-[#F1F5F9] text-[#0F172A] hover:bg-[#E2E8F0] cursor-pointer"
                      title="Add 15 minutes"
                    >
                      +15m
                    </Button>
                  </div>

                  {/* Tactile Keycap Presets */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => handleDurationPreset(15)}
                      disabled={!canCreateLog}
                      className={`text-xs h-9 px-2 rounded-[6px] font-mono font-semibold cursor-pointer border ${
                        durationMinutes === 15
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                          : 'bg-[#FFFFFF] text-[#0F172A] border-[#64748B] hover:bg-[#F1F5F9]'
                      }`}
                      data-testid="duration-chip-15"
                    >
                      15m
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => handleDurationPreset(30)}
                      disabled={!canCreateLog}
                      className={`text-xs h-9 px-2 rounded-[6px] font-mono font-semibold cursor-pointer border ${
                        durationMinutes === 30
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                          : 'bg-[#FFFFFF] text-[#0F172A] border-[#64748B] hover:bg-[#F1F5F9]'
                      }`}
                      data-testid="duration-chip-30"
                    >
                      30m
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => handleDurationPreset(45)}
                      disabled={!canCreateLog}
                      className={`text-xs h-9 px-2 rounded-[6px] font-mono font-semibold cursor-pointer border ${
                        durationMinutes === 45
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                          : 'bg-[#FFFFFF] text-[#0F172A] border-[#64748B] hover:bg-[#F1F5F9]'
                      }`}
                      data-testid="duration-chip-45"
                    >
                      45m
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => handleDurationPreset(60)}
                      disabled={!canCreateLog}
                      className={`text-xs h-9 px-2 rounded-[6px] font-mono font-semibold cursor-pointer border ${
                        durationMinutes === 60
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                          : 'bg-[#FFFFFF] text-[#0F172A] border-[#64748B] hover:bg-[#F1F5F9]'
                      }`}
                      data-testid="duration-chip-60"
                    >
                      60m
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => handleDurationPreset(120)}
                      disabled={!canCreateLog}
                      className={`text-xs h-9 px-2 rounded-[6px] font-mono font-semibold cursor-pointer border ${
                        durationMinutes === 120
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                          : 'bg-[#FFFFFF] text-[#0F172A] border-[#64748B] hover:bg-[#F1F5F9]'
                      }`}
                      data-testid="duration-chip-120"
                    >
                      2h
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      onClick={() => handleDurationPreset(240)}
                      disabled={!canCreateLog}
                      className={`text-xs h-9 px-2 rounded-[6px] font-mono font-semibold cursor-pointer border ${
                        durationMinutes === 240
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8] shadow-2xs'
                          : 'bg-[#FFFFFF] text-[#0F172A] border-[#64748B] hover:bg-[#F1F5F9]'
                      }`}
                      data-testid="duration-chip-240"
                    >
                      4h
                    </Button>
                  </div>
                </div>

                {/* Live shift-share readout */}
                <div className="p-2 rounded-[4px] bg-[#F8FAFC] border border-[#CBD5E1] text-xs font-mono text-[#475569] tabular-nums flex items-center justify-between">
                  <span className="text-[#0F172A] font-semibold">Shift Share:</span>
                  <span>
                    = {formatMinutes(durationMinutes)} · {Math.round((durationMinutes / 480) * 100)}% of 8h shift
                  </span>
                </div>
              </div>

              {/* Work Description / Note Memo Pad */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-[#475569]" />
                    Work Description / Note (Optional)
                  </label>
                  <span className="text-xs font-mono text-[#475569] tabular-nums">
                    {note.length} / 5000
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="What was completed during this block?"
                  maxLength={5000}
                  disabled={!canCreateLog}
                  className="w-full text-xs rounded-[6px] border border-[#64748B] bg-[#FFFFFF] p-2.5 text-[#0F172A] shadow-none focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] focus:outline-none disabled:bg-[#F1F5F9] disabled:text-[#475569]"
                  data-testid="note-textarea"
                />
              </div>

              {/* Primary Submit Button */}
              <Button
                type="submit"
                size="sm"
                disabled={!canCreateLog || createMutation.isPending || isTimerRunning || !selectedTaskId}
                className="w-full text-xs font-bold uppercase tracking-wider gap-1.5 h-10 rounded-[6px] border border-[#1D4ED8] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs active:translate-x-[1px] active:translate-y-[1px] cursor-pointer disabled:opacity-50"
                data-testid="submit-timelog-btn"
              >
                <Plus className="h-4 w-4" />
                {createMutation.isPending ? 'Logging Time...' : 'Record Time Entry'}
              </Button>
            </form>
          </div>

          {/* Card 3 — Today's Shift Summary & Logged Entries */}
          <div className="p-4 rounded-[8px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-2.5">
              <div className="text-xs font-bold uppercase tracking-wide text-[#0F172A] flex items-center gap-2">
                <ListOrdered className="h-4 w-4 text-[#1D4ED8]" />
                Today&apos;s Shift Summary
              </div>
              <Badge
                variant="secondary"
                className="text-xs tabular-nums font-mono font-bold px-2.5 py-1 rounded-[6px] border border-[#CBD5E1] bg-[#F1F5F9] text-[#0F172A]"
                data-testid="daily-total-badge"
              >
                Total: {formatMinutes(summary?.totalMinutes ?? 0)}
              </Badge>
            </div>

            {/* Daily Shift Capacity & Proportional Timeblock Bar */}
            <div
              className="p-3.5 rounded-[6px] bg-[#F8FAFC] border border-[#E2E8F0] space-y-3"
              data-testid="daily-capacity-bar"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {/* 48x48 SVG Radial Shift Utilization Gauge */}
                  <div
                    className="relative flex items-center justify-center shrink-0"
                    data-testid="shift-capacity-gauge"
                  >
                    <svg className="w-12 h-12 -rotate-90 transform" viewBox="0 0 48 48">
                      <circle cx="24" cy="24" r="20" stroke="#CBD5E1" strokeWidth="4" fill="none" />
                      <circle
                        cx="24"
                        cy="24"
                        r="20"
                        stroke={shiftCapacityPct >= 100 ? '#16A34A' : '#1D4ED8'}
                        strokeWidth="4"
                        fill="none"
                        strokeDasharray={radialCircumference}
                        strokeDashoffset={radialOffset}
                        strokeLinecap="round"
                        className="transition-all duration-500"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-xs font-mono font-bold text-[#0F172A] tabular-nums">
                        {shiftCapacityPct}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-[#0F172A] flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-[#1D4ED8]" />
                      Shift Capacity
                    </div>
                    <div className="text-xs text-[#475569]">8-Hour Workday Benchmark</div>
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-xs font-mono font-bold text-[#0F172A] tabular-nums">
                    {formatMinutes(totalMins)} / 8h 00m
                  </div>
                  <div className="text-xs font-mono text-[#475569] uppercase">
                    {totalMins >= 480 ? 'Target Reached' : `${480 - totalMins}m remaining`}
                  </div>
                </div>
              </div>

              {/* 8h Benchmark Progress Bar & Proportional Timeblock Strip */}
              <div className="space-y-1">
                <div
                  className="h-3.5 w-full bg-[#E2E8F0] rounded-[4px] overflow-hidden flex border border-[#CBD5E1]"
                  data-testid="daily-timeblock-bar"
                >
                  {summary && summary.byTask.length > 0 ? (
                    summary.byTask.map((task, idx) => {
                      const benchmarkBase = Math.max(480, totalMins);
                      const widthPct = (task.minutes / benchmarkBase) * 100;
                      const color = TASK_PALETTE[idx % TASK_PALETTE.length];
                      return (
                        <div
                          key={task.taskId}
                          style={{ width: `${widthPct}%`, backgroundColor: color }}
                          className="h-full transition-all duration-300 cursor-pointer"
                          title={`${task.title}: ${formatMinutes(task.minutes)}`}
                          onClick={() => setSelectedTaskId(task.taskId)}
                        />
                      );
                    })
                  ) : (
                    <div className="h-full w-full bg-[#E2E8F0]" />
                  )}
                </div>
              </div>

              {/* 3-Column Monospace Telemetry Strip */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#E2E8F0]">
                <div className="bg-[#FFFFFF] p-2 rounded-[4px] border border-[#CBD5E1] text-center">
                  <div className="text-xs uppercase font-mono text-[#475569]">Logged Today</div>
                  <div className="text-xs font-mono font-bold text-[#0F172A] tabular-nums">
                    {formatMinutes(totalMins)}
                  </div>
                </div>
                <div className="bg-[#FFFFFF] p-2 rounded-[4px] border border-[#CBD5E1] text-center">
                  <div className="text-xs uppercase font-mono text-[#475569]">Shift Benchmark</div>
                  <div className="text-xs font-mono font-bold text-[#0F172A] tabular-nums">8h 00m</div>
                </div>
                <div className="bg-[#FFFFFF] p-2 rounded-[4px] border border-[#CBD5E1] text-center">
                  <div className="text-xs uppercase font-mono text-[#475569]">Remaining</div>
                  <div
                    className={`text-xs font-mono font-bold tabular-nums ${
                      totalMins > 480 ? 'text-[#CA8A04]' : 'text-[#0F172A]'
                    }`}
                  >
                    {totalMins > 480 ? `+${formatMinutes(totalMins - 480)} OT` : formatMinutes(480 - totalMins)}
                  </div>
                </div>
              </div>
            </div>

            {/* Interactive Task Breakdown Matrix */}
            {summary && summary.byTask.length > 0 && (
              <div
                className="space-y-2"
                data-testid="task-breakdown-section"
              >
                <div
                  className="flex items-center justify-between"
                  data-testid="daily-summary-by-task"
                >
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#475569] flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-[#475569]" />
                    Task Breakdown
                  </span>
                  <span className="text-xs font-mono text-[#475569]">
                    {summary.byTask.length} active tasks
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {summary.byTask.map((task, idx) => {
                    const color = TASK_PALETTE[idx % TASK_PALETTE.length];
                    const isSelected = task.taskId === selectedTaskId;
                    const taskPct = totalMins > 0 ? Math.round((task.minutes / totalMins) * 100) : 0;
                    return (
                      <div
                        key={task.taskId}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedTaskId(task.taskId)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelectedTaskId(task.taskId);
                        }}
                        className={`p-2.5 rounded-[6px] border transition-all text-left cursor-pointer ${
                          isSelected
                            ? 'border-[#1D4ED8] bg-[#EFF6FF] shadow-2xs'
                            : 'border-[#CBD5E1] bg-[#FFFFFF] hover:border-[#64748B] hover:bg-[#F8FAFC]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                            <span className="text-xs font-semibold text-[#0F172A] truncate">
                              {task.title}
                            </span>
                          </div>
                          <Badge
                            variant="outline"
                            className="text-xs font-mono font-bold shrink-0 rounded-[4px] border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] tabular-nums"
                          >
                            {formatMinutes(task.minutes)}
                          </Badge>
                        </div>
                        <div className="text-xs text-[#475569] font-mono truncate mt-1">
                          {task.taskId}
                        </div>
                        <div className="mt-2 h-1.5 w-full bg-[#E2E8F0] rounded-[2px] overflow-hidden">
                          <div
                            className="h-full transition-all duration-300"
                            style={{ width: `${taskPct}%`, backgroundColor: color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Chronological Timesheet Entry Stream */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold uppercase tracking-wider text-[#475569]">
                  Individual Time Entries
                </span>
                <span className="text-xs text-[#475569] font-mono">
                  {entries.length} recorded
                </span>
              </div>

              {isLoadingEntries ? (
                <div className="space-y-2">
                  <div className="h-14 w-full bg-[#F1F5F9] animate-pulse rounded-[6px] border border-[#CBD5E1]" />
                  <div className="h-14 w-full bg-[#F1F5F9] animate-pulse rounded-[6px] border border-[#CBD5E1]" />
                </div>
              ) : entries.length === 0 ? (
                <div
                  className="py-8 text-center text-xs text-[#475569] border border-dashed border-[#CBD5E1] rounded-[6px] bg-[#F8FAFC]"
                  data-testid="no-entries-message"
                >
                  <span data-testid="time-entries-empty">
                    No time entries logged for {selectedDate}. Use the form to record hours.
                  </span>
                </div>
              ) : (
                <div
                  className="space-y-2 max-h-[360px] overflow-y-auto pr-1"
                  data-testid="entries-list"
                >
                  <div className="space-y-2" data-testid="time-entries-table">
                    {entries.map((entry) => {
                      const allowed = canEditEntry(entry);
                      const taskTitle = getTaskDisplayTitle(entry.taskId);

                      return (
                        <div
                          key={entry.id}
                          className="p-3 rounded-[6px] border border-[#CBD5E1] bg-[#FFFFFF] hover:border-[#64748B] hover:bg-[#F8FAFC] transition-colors flex items-start justify-between gap-3 shadow-2xs"
                          data-testid={`time-entry-item-${entry.id}`}
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-[#0F172A] truncate">
                                {taskTitle}
                              </span>
                              <Badge
                                variant="secondary"
                                className="text-xs shrink-0 rounded-[4px] border border-[#CBD5E1] bg-[#F1F5F9] text-[#0F172A] font-mono tabular-nums"
                              >
                                {formatMinutes(entry.durationMinutes)}
                              </Badge>
                            </div>
                            {entry.note && (
                              <p className="text-xs text-[#475569] line-clamp-2">
                                {entry.note}
                              </p>
                            )}
                            <div className="flex items-center gap-3 text-xs text-[#475569] font-mono">
                              <span>Date: {entry.entryDate}</span>
                              <span>•</span>
                              <span>
                                Logged:{' '}
                                {new Date(entry.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          </div>

                          {/* Edit / Delete Actions */}
                          {allowed && (
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setEditingEntry(entry)}
                                className="h-7 w-7 rounded-[4px] text-[#475569] hover:text-[#0F172A] hover:bg-[#F1F5F9] border border-transparent hover:border-[#CBD5E1] cursor-pointer"
                                title="Edit entry"
                                data-testid={`edit-entry-btn-${entry.id}`}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeletingEntry(entry)}
                                className="h-7 w-7 rounded-[4px] text-[#475569] hover:text-[#DC2626] hover:bg-[#FEF2F2] border border-transparent hover:border-[#FCA5A5] cursor-pointer"
                                title="Delete entry"
                                data-testid={`delete-entry-btn-${entry.id}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Live Timer Pill / Minimalist Circular Clock Launcher */}
      {!effectiveIsOpen && (
        <button
          type="button"
          onClick={handleToggleOpen}
          className={
            isTimerRunning
              ? 'fixed bottom-5 right-5 z-40 h-10 px-3.5 rounded-full inline-flex items-center gap-2 border border-[#059669] bg-[#ECFDF5] shadow-sm hover:bg-[#D1FAE5] hover:shadow-md transition-all duration-200 cursor-pointer'
              : 'fixed bottom-5 right-5 z-40 h-10 w-10 rounded-full border border-[#E2E8F0] bg-[#FFFFFF]/95 backdrop-blur-xs text-[#475569] shadow-sm hover:border-[#CBD5E1] hover:bg-[#F8FAFC] hover:text-[#0F172A] hover:shadow-md flex items-center justify-center transition-all duration-200 cursor-pointer'
          }
          data-testid="floating-timer-pill"
          aria-label={
            isTimerRunning
              ? `Task & Time Studio · Running · ${formatStopwatch(elapsedSeconds)}`
              : `Task & Time Studio · ${formatStopwatch(elapsedSeconds)}`
          }
          title={isTimerRunning ? 'Task & Time Studio · Chronometer Running' : 'Task & Time Studio'}
        >
          {isTimerRunning ? (
            <>
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#059669]" />
              </span>
              <Clock className="h-3.5 w-3.5 stroke-[1.75] text-[#059669] shrink-0" />
              <span className="font-mono text-xs font-medium tabular-nums tracking-tight text-[#065F46]">
                {formatStopwatch(elapsedSeconds)}
              </span>
            </>
          ) : (
            <>
              <Clock className="h-4 w-4 stroke-[1.5] text-current transition-transform duration-200 hover:scale-105" />
              <span className="sr-only">Task &amp; Time Studio · {formatStopwatch(elapsedSeconds)}</span>
            </>
          )}
          <span data-testid="open-time-peek-pill-btn" className="sr-only" />
        </button>
      )}

      {/* Edit Entry Modal */}
      {editingEntry && (
        <TimeEntryEditModal
          isOpen={Boolean(editingEntry)}
          onClose={() => setEditingEntry(null)}
          entry={editingEntry}
          tasks={assignedTasks}
        />
      )}

      {/* Delete Entry Confirmation Modal */}
      {deletingEntry && (
        <TimeEntryDeleteModal
          isOpen={Boolean(deletingEntry)}
          onClose={() => setDeletingEntry(null)}
          entry={deletingEntry}
          taskTitle={getTaskDisplayTitle(deletingEntry.taskId)}
        />
      )}
    </>
  );
}
