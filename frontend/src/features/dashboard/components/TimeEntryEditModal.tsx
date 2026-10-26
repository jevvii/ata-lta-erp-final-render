import { workDate } from '@/lib/workDate';
import { DateInput } from '@/components/ui/date-input';
import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Clock, Calendar, FileText, CheckCircle2 } from 'lucide-react';
import { useUpdateTimeEntry } from '../api/useTimeEntries';
import { useBlockingModal } from '@/features/operations/components/BlockingActionModal';
import { ApiError } from '@/lib/api';
import type { TimeEntry, AssignableTaskOption } from '../api/types';

interface TimeEntryEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: TimeEntry | null;
  tasks: AssignableTaskOption[];
}

export function TimeEntryEditModal({
  isOpen,
  onClose,
  entry,
  tasks,
}: TimeEntryEditModalProps) {
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [entryDate, setEntryDate] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [taskId, setTaskId] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const updateMutation = useUpdateTimeEntry();
  const { openLoading, openSuccess, openError } = useBlockingModal();

  const todayStr = workDate();

  useEffect(() => {
    if (entry) {
      setDurationMinutes(entry.durationMinutes);
      setEntryDate(entry.entryDate);
      setNote(entry.note || '');
      setTaskId(entry.taskId);
      setValidationError(null);
    }
  }, [entry]);

  const handleQuickChip = (minutes: number) => {
    setDurationMinutes((prev) => Math.min(1440, prev + minutes));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entry) return;

    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      setValidationError('Duration must be between 1 and 1440 minutes (24h).');
      return;
    }
    if (!entryDate || entryDate > todayStr) {
      setValidationError('Entry date cannot be in the future.');
      return;
    }
    if (note && note.length > 5000) {
      setValidationError('Note cannot exceed 5000 characters.');
      return;
    }

    setValidationError(null);

    openLoading({
      title: 'Updating Time Entry',
      message: 'Saving your changes...',
      actionName: 'update-time-entry',
    });

    try {
      await updateMutation.mutateAsync({
        id: entry.id,
        input: {
          taskId: taskId !== entry.taskId ? taskId : undefined,
          entryDate,
          durationMinutes,
          note: note.trim() || null,
        },
      });

      openSuccess({
        title: 'Time Entry Updated',
        message: 'Your time log has been successfully updated.',
      });

      onClose();
    } catch (err) {
      console.error('[TimeEntryEditModal] Update failed:', err);
      if (err instanceof ApiError) {
        openError({
          code: err.code || 'TIME_UPDATE_FAILED',
          detail: err.detail || err.message,
          status: err.status,
          title: 'Update Error',
          onRetry: () => handleSubmit(e),
        });
      } else {
        openError({
          detail: err instanceof Error ? err.message : 'Failed to update time entry',
          title: 'Unexpected Error',
        });
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[480px] rounded-[8px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-[4px_4px_0px_#0F172A] p-6" data-testid="time-entry-edit-modal">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader className="border-b border-[#CBD5E1] pb-3">
            <DialogTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-[#0F172A]">
              <Clock className="h-4 w-4 text-[#1D4ED8]" />
              Edit Time Entry
            </DialogTitle>
            <DialogDescription className="text-xs text-[#475569]">
              Modify the recorded duration, work date, or note for this entry.
            </DialogDescription>
          </DialogHeader>

          {validationError && (
            <div
              className="p-2.5 rounded-[6px] bg-[#FEF2F2] border border-[#FCA5A5] text-xs text-[#DC2626] font-medium"
              data-testid="edit-validation-error"
            >
              {validationError}
            </div>
          )}

          {/* Task Selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#475569]" />
              Task
            </label>
            <select
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full text-xs rounded-[6px] border border-[#64748B] bg-[#FFFFFF] px-3 py-2 text-[#0F172A] shadow-none focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] focus:outline-none"
              data-testid="edit-task-select"
            >
              {tasks.map((t) => (
                <option key={t.taskId} value={t.taskId}>
                  [{t.entity}] {t.taskTitle} ({t.workRequestTitle})
                </option>
              ))}
              {!tasks.some((t) => t.taskId === taskId) && entry && (
                <option value={entry.taskId}>Task ID: {entry.taskId}</option>
              )}
            </select>
          </div>

          {/* Date Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#0F172A] flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-[#475569]" />
              Work Date
            </label>
            <DateInput
              aria-label="Work date"
              type="date"
              max={todayStr}
              value={entryDate}
              onValueChange={(value) => setEntryDate(value)}
              className="text-xs h-9 rounded-[6px] border-[#64748B] bg-[#FFFFFF] text-[#0F172A]"
              required
              data-testid="edit-entry-date-input"
            />
          </div>

          {/* Duration Minutes with Quick-Chips */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-[#0F172A] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#475569]" />
                Duration (minutes)
              </span>
              <span className="text-xs text-[#0F172A] font-mono font-semibold tabular-nums">
                {Math.floor(durationMinutes / 60)}h {durationMinutes % 60}m
              </span>
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={1440}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10) || 0)}
                className="text-xs h-9 w-24 rounded-[6px] border border-[#64748B] bg-[#FFFFFF] text-[#0F172A] font-mono font-bold tabular-nums"
                required
                data-testid="edit-duration-input"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleQuickChip(15)}
                  className="text-xs h-9 px-2.5 rounded-[6px] border border-[#CBD5E1] bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] font-mono font-semibold cursor-pointer shadow-[1px_1px_0px_#CBD5E1]"
                  data-testid="edit-chip-15"
                >
                  +15m
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleQuickChip(30)}
                  className="text-xs h-9 px-2.5 rounded-[6px] border border-[#CBD5E1] bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] font-mono font-semibold cursor-pointer shadow-[1px_1px_0px_#CBD5E1]"
                  data-testid="edit-chip-30"
                >
                  +30m
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => handleQuickChip(60)}
                  className="text-xs h-9 px-2.5 rounded-[6px] border border-[#CBD5E1] bg-[#F1F5F9] hover:bg-[#E2E8F0] text-[#0F172A] font-mono font-semibold cursor-pointer shadow-[1px_1px_0px_#CBD5E1]"
                  data-testid="edit-chip-60"
                >
                  +1h
                </Button>
              </div>
            </div>
          </div>

          {/* Note Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#0F172A] flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[#475569]" />
                Note (optional)
              </span>
              <span className="text-xs font-mono text-[#475569] tabular-nums">
                {note.length} / 5000
              </span>
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe tasks completed, meetings attended, etc."
              maxLength={5000}
              className="w-full text-xs rounded-[6px] border border-[#64748B] bg-[#FFFFFF] p-2.5 text-[#0F172A] shadow-none focus:border-[#1D4ED8] focus:ring-1 focus:ring-[#1D4ED8] focus:outline-none"
              data-testid="edit-note-textarea"
            />
          </div>

          <DialogFooter className="pt-3 border-t border-[#CBD5E1] flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs font-semibold rounded-[6px] border border-[#CBD5E1] bg-[#FFFFFF] hover:bg-[#F1F5F9] text-[#0F172A] cursor-pointer"
              data-testid="edit-cancel-btn"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="text-xs font-bold uppercase tracking-wider rounded-[6px] bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] border border-[#1D4ED8] shadow-[2px_2px_0px_#1E3A8A] cursor-pointer"
              disabled={updateMutation.isPending}
              data-testid="edit-submit-btn"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
