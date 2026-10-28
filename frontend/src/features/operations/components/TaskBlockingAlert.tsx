import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BlockingReason } from '../hooks/useSelectableTasks';

export interface TaskBlockingAlertProps {
  isNoTasksBlocked?: boolean;
  isNotAssignedBlocked?: boolean;
  isPhaseOrPrereqBlocked?: boolean;
  blockingReason?: BlockingReason;
  workRequestId?: string | null;
  className?: string;
}

export function TaskBlockingAlert({
  isNoTasksBlocked,
  isNotAssignedBlocked,
  isPhaseOrPrereqBlocked,
  blockingReason,
  workRequestId,
  className,
}: TaskBlockingAlertProps) {
  const effectiveReason: BlockingReason =
    blockingReason ??
    (isNoTasksBlocked
      ? 'no_tasks'
      : isPhaseOrPrereqBlocked
        ? 'phase_or_prereq_locked'
        : isNotAssignedBlocked
          ? 'unassigned'
          : null);

  if (!effectiveReason) {
    return null;
  }

  return (
    <div
      className={cn(
        'p-3 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-800 flex items-start gap-2',
        className
      )}
      role="alert"
      data-testid="task-blocking-alert"
    >
      <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="leading-relaxed">
        {effectiveReason === 'no_tasks' ? (
          <>
            <span>This work request has no tasks — create one first</span>
            {workRequestId && (
              <>
                .{' '}
                <a
                  href={`/operations?tab=work-requests&wrId=${encodeURIComponent(workRequestId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-semibold hover:text-amber-950 inline-flex items-center gap-0.5"
                  data-testid="task-blocking-wr-link"
                >
                  View Work Request
                </a>
              </>
            )}
          </>
        ) : effectiveReason === 'phase_or_prereq_locked' ? (
          <>
            <span>
              No tasks are available in the current phase yet — complete the active phase or prerequisite tasks first.
            </span>
            {workRequestId && (
              <>
                {' '}
                <a
                  href={`/operations?tab=work-requests&wrId=${encodeURIComponent(workRequestId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-semibold hover:text-amber-950 inline-flex items-center gap-0.5"
                  data-testid="task-blocking-wr-link"
                >
                  Go to Work Request →
                </a>
              </>
            )}
          </>
        ) : (
          <span>
            You&apos;re not assigned to any task on this work request. Ask the task owner or an Admin to add you.
          </span>
        )}
      </div>
    </div>
  );
}
