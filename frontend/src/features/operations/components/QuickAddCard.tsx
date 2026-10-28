import { DateInput } from '@/components/ui/date-input';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Calendar,
  CornerDownLeft,
  Loader2,
  User,
  X,
} from 'lucide-react';
import { getEligibleStaff, useTeam } from '../api/useTeam';
import { TaskTypeSelect } from '../lib/taskTypes';
import { canEmployeeCreateTask } from '../lib/taskScope';
import { useSessionStore } from '@/lib/session';
import type { CreatablePhase, CreateTaskInput, WorkRequest } from '../api/types';

interface QuickAddCardProps {
  phase: CreatablePhase;
  workRequest: WorkRequest;
  onCreate: (data: CreateTaskInput) => Promise<void>;
  onCancel: () => void;
}

export function QuickAddCard({ phase, workRequest, onCreate, onCancel }: QuickAddCardProps) {
  const [title, setTitle] = useState('');
  const [requiredLinkType, setRequiredLinkType] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [assigneeId, setAssigneeId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const currentUser = useSessionStore((state) => state.user);
  const canCreate = canEmployeeCreateTask(currentUser, workRequest);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const { data: team = [], isLoading: teamLoading, isError: teamError } = useTeam();
  const memberIds = new Set(
    [workRequest.assignedTo, ...(workRequest.coAssignees ?? [])].filter(Boolean)
  );
  const eligible = memberIds.size
    ? team.filter((member) => memberIds.has(member.id))
    : getEligibleStaff(team);
  // Re-check scope on each render so a removed WR member cannot be submitted.
  const assignee = eligible.find((member) => member.id === assigneeId);
  const initials = assignee?.name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean);
  const avatar = initials
    ? `${initials[0] ?? ''}${initials.length > 1 ? initials[initials.length - 1] : ''}`
    : '';

  useLayoutEffect(() => {
    const input = titleRef.current;
    if (input) {
      input.style.height = 'auto';
      input.style.height = `${Math.max(60, input.scrollHeight)}px`;
    }
  }, [title]);

  const submit = async () => {
    if (
      submitting.current ||
      !title.trim() ||
      title.trim().length > 255 ||
      workRequest.status === 'Completed'
    )
      return;
    if (!canCreate) {
      setError('Task creation requires an assigned Manager lead on this work request.');
      return;
    }
    submitting.current = true;
    setPending(true);
    setError('');
    try {
      await onCreate({
        title: title.trim(),
        phase,
        status: assignee ? 'Assigned' : 'Draft',
        requiredLinkType: requiredLinkType || null,
        dueDate: dueDate || null,
        assigneeId: assignee?.id ?? null,
        assigneeName: assignee?.name ?? null,
        assignees: assignee ? [assignee.id] : [],
      });
      if (mounted.current) {
        setRequiredLinkType('');
        onCancel();
      }
    } catch {
      setError('Unable to create task. Please try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  const controlClass =
    'relative flex h-7 items-center justify-center rounded-[6px] text-[#475569] hover:bg-[#F8FAFC] hover:text-[#1E293B] focus-within:ring-1 focus-within:ring-[#1D4ED8]';
  return (
    <form
      className="border-[#E2E8F0] rounded-[6px] p-2.5 bg-[#FFFFFF] shadow-none space-y-2 text-xs animate-in fade-in duration-150"
      data-testid={`quick-add-form-${phase}`}
      aria-label="Quick-add task"
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) {
          event.preventDefault();
          setRequiredLinkType('');
          onCancel();
        }
      }}
    >
      {!canCreate && (
        <div
          role="alert"
          className="p-2 rounded-[6px] bg-[#FEF2F2] border border-[#FCA5A5] text-[#DC2626] text-xs font-medium"
          data-testid="missing-lead-warning"
        >
          Task creation is disabled because this work request does not have an assigned Manager lead.
        </div>
      )}
      <div className="flex items-start gap-1">
        <textarea
          ref={titleRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={canCreate ? 'What needs to be done?' : 'Task creation disabled (missing Manager lead)'}
          aria-label="Task title"
          className="min-h-15 w-full resize-none border-0 bg-transparent p-1 text-sm text-[#1E293B] placeholder:text-[#475569] focus:outline-none disabled:opacity-50"
          rows={2}
          maxLength={255}
          required
          autoFocus={canCreate}
          disabled={pending || !canCreate}
          data-testid={`quick-add-title-input-${phase}`}
        />
        <button
          type="button"
          aria-label="Cancel quick-add task"
          disabled={pending}
          onClick={() => {
            setRequiredLinkType('');
            onCancel();
          }}
          className="rounded-[6px] p-1 text-[#475569] hover:text-[#1E293B] disabled:opacity-40"
          data-testid={`quick-add-cancel-${phase}`}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <fieldset
        disabled={pending}
        className="flex min-w-0 flex-wrap items-center gap-1 disabled:opacity-60"
      >
        <TaskTypeSelect
          value={requiredLinkType}
          onChange={setRequiredLinkType}
          disabled={pending}
          ariaLabel="Task link type"
          data-testid={`quick-add-type-trigger-${phase}`}
        />
        <button
          type="button"
          className={`${controlClass} gap-1 px-1`}
          aria-label="Choose due date"
          aria-expanded={dateOpen}
          onClick={() => setDateOpen(!dateOpen)}
          data-testid={`quick-add-due-date-trigger-${phase}`}
        >
          <Calendar className="h-4 w-4" />
          {dueDate && (
            <span>
              {new Date(`${dueDate}T00:00:00`).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          )}
        </button>
        {dueDate && (
          <button
            type="button"
            aria-label="Clear due date"
            className={controlClass}
            onClick={() => setDueDate('')}
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <label
          className={`${controlClass} w-7 rounded-[6px] ${assignee ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs font-bold' : 'border-dashed border-[#E2E8F0]'}`}
          title={assignee?.name ?? 'Unassigned'}
        >
          {assignee ? avatar.toUpperCase() : <User className="h-4 w-4" />}
          <select
            aria-label="Lead assignee"
            value={assignee?.id ?? ''}
            disabled={teamLoading || teamError}
            onChange={(event) => setAssigneeId(event.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            data-testid={`quick-add-assignee-trigger-${phase}`}
          >
            <option value="">Unassigned</option>
            {eligible.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          aria-label="Create task"
          disabled={pending || !canCreate || !title.trim()}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs disabled:bg-[#F8FAFC] disabled:text-[#475569]/50"
          data-testid={`quick-add-submit-btn-${phase}`}
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CornerDownLeft className="h-4 w-4" />
          )}
        </button>
        {dateOpen && (
          <DateInput
            type="date"
            aria-label="Task due date"
            disabled={pending}
            value={dueDate}
            onValueChange={(value) => setDueDate(value)}
            className="h-8 w-full text-xs rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] tabular-nums"
            autoFocus
          />
        )}
      </fieldset>
      {teamError && <p className="text-[#DC2626] text-xs">Team members could not be loaded.</p>}
      {error && (
        <p role="alert" className="text-[#DC2626] text-xs">
          {error}
        </p>
      )}
    </form>
  );
}
