import { AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TaskBlockingAlertProps {
  isNoTasksBlocked: boolean;
  isNotAssignedBlocked: boolean;
  workRequestId?: string | null;
  className?: string;
}

export function TaskBlockingAlert({
  isNoTasksBlocked,
  isNotAssignedBlocked,
  workRequestId,
  className,
}: TaskBlockingAlertProps) {
  if (!isNoTasksBlocked && !isNotAssignedBlocked) {
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
        {isNoTasksBlocked ? (
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
        ) : (
          <span>
            You&apos;re not assigned to any task on this work request. Ask the task owner or an Admin to add you.
          </span>
        )}
      </div>
    </div>
  );
}
