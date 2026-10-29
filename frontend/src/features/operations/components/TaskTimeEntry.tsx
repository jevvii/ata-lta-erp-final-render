import { useState, type FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { workDate } from '@/lib/workDate';
import { UserAvatar } from '../../../components/common/UserAvatar';
import { useUpdateTimeEntry, useDeleteTimeEntry } from '@/features/dashboard/api/useTimeEntries';
import type { TimeEntry } from '@/features/dashboard/api/types';

const loggedTimestamp = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(date);
};

export function TaskTimeEntry({ entry, canManage, onDeleteError }: {
  entry: TimeEntry;
  canManage: boolean;
  onDeleteError?: (message: string | null) => void;
}) {
  const update = useUpdateTimeEntry();
  const remove = useDeleteTimeEntry();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [date, setDate] = useState(entry.entryDate);
  const [minutes, setMinutes] = useState(String(entry.durationMinutes));
  const [note, setNote] = useState(entry.note || '');
  const [error, setError] = useState<string | null>(null);
  const pending = update.isPending || remove.isPending;
  const name = entry.userName?.trim() || 'Unknown logger';

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || pending) return;
    const duration = Number(minutes);
    if (!minutes.trim() || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
      setError('Duration must be an integer between 1 and 1440 minutes.');
      return;
    }
    if (!date || date > workDate()) {
      setError('Entry date is required and cannot be in the future.');
      return;
    }
    setError(null);
    try {
      await update.mutateAsync({ id: entry.id, input: {
        entryDate: date, durationMinutes: duration, note: note.trim() || null,
      } });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update time entry.');
    }
  };

  const deleteEntry = async () => {
    if (!canManage || pending) return;
    setError(null);
    onDeleteError?.(null);
    try {
      await remove.mutateAsync(entry.id);
      setConfirmDelete(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete time entry.';
      // The optimistic list removes this row while the request runs. Report to
      // the parent so a failed deletion remains visible after the row remounts.
      if (onDeleteError) onDeleteError(message);
      else setError(message);
    }
  };

  return (
    <div className="p-2.5 space-y-2 text-xs hover:bg-[#F8FAFC] transition-colors" data-testid={`time-entry-item-${entry.id}`}>
      <div className="flex items-start gap-2.5">
        <UserAvatar
          userId={entry.userId}
          name={entry.userName}
          avatarUrl={entry.userAvatarUrl}
          size="sm"
          shape="circle"
          className="h-7 w-7 text-[10px]"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 break-words">
              <span className="font-bold text-[#1E293B]">{name}</span>
              <span className="block text-[#475569]">{entry.userRole || 'Role unavailable'}</span>
            </div>
            <Badge variant="outline" size="compact" className="shrink-0 text-xs rounded-[8px] border-[#E2E8F0]">
              {entry.durationMinutes} min
            </Badge>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[#475569]">
            <span>Work date: <time dateTime={entry.entryDate}>{entry.entryDate}</time></span>
            <span>Logged: <time dateTime={entry.createdAt}>{loggedTimestamp(entry.createdAt)}</time></span>
          </div>
          {entry.note && <p className="text-[#475569] whitespace-pre-wrap break-words">{entry.note}</p>}
          {canManage && !editing && !confirmDelete && (
            <div className="flex gap-3 pt-1">
              <button type="button" disabled={pending} className="text-[#475569] hover:text-[#1E293B] underline disabled:opacity-50"
                onClick={() => {
                  setDate(entry.entryDate); setMinutes(String(entry.durationMinutes));
                  setNote(entry.note || ''); setError(null); setEditing(true);
                }}>Edit</button>
              <button type="button" disabled={pending} className="text-[#475569] hover:text-[#DC2626] underline disabled:opacity-50"
                onClick={() => { setError(null); setConfirmDelete(true); }}>Delete</button>
            </div>
          )}
        </div>
      </div>
      {error && <p role="alert" className="text-[#DC2626]">{error}</p>}
      {canManage && confirmDelete && (
        <div className="flex flex-wrap items-center gap-3 text-[#475569]">
          <span>Delete this time entry?</span>
          <Button type="button" variant="outline" size="xs" disabled={pending} onClick={deleteEntry}>Confirm Delete</Button>
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => setConfirmDelete(false)}>Cancel</Button>
        </div>
      )}
      {canManage && editing && (
        <form onSubmit={save} className="space-y-3 p-3 bg-[#F8FAFC] rounded-[6px]" aria-label="Edit time entry">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="space-y-1 text-[#475569]">Work date
              <DateInput type="date" aria-label="Edit work date" value={date} max={workDate()} onValueChange={setDate} required disabled={pending} />
            </label>
            <label className="space-y-1 text-[#475569]">Duration (Minutes)
              <Input type="number" aria-label="Edit duration in minutes" value={minutes} min={1} max={1440} step={1}
                onChange={(event) => setMinutes(event.target.value)} required disabled={pending} />
            </label>
          </div>
          <label className="block space-y-1 text-[#475569]">Work note
            <textarea aria-label="Edit work note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={5000}
              disabled={pending} rows={3} className="block w-full rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] p-2 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
            <Button type="submit" size="xs" disabled={pending} className="bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF]">{pending ? 'Saving...' : 'Save Changes'}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
