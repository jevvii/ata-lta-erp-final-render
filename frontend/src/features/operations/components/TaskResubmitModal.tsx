import React, { useState, useEffect, useRef } from 'react';
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
import { DateInput } from '@/components/ui/date-input';
import { XCircle, Loader2 } from 'lucide-react';
import { TaskTypeSelect } from '../lib/taskTypes';
import { useTaskMutations } from '../api/useTasks';
import { useSessionStore } from '@/lib/session';
import type { Task, WorkRequest } from '../api/types';

export interface TaskResubmitModalProps {
  isOpen: boolean;
  onClose: () => void;
  task: Task;
  workRequest?: WorkRequest | null;
  onSuccess?: (updatedTask: Task) => void;
}

export function TaskResubmitModal({
  isOpen,
  onClose,
  task,
  workRequest,
  onSuccess,
}: TaskResubmitModalProps) {
  const [title, setTitle] = useState(task.title || '');
  const [description, setDescription] = useState(task.description || '');
  const [requiredLinkType, setRequiredLinkType] = useState<string | null>(
    task.requiredLinkType ?? (task as { required_link_type?: string | null }).required_link_type ?? null
  );
  const [dueDate, setDueDate] = useState<string | null>(
    task.dueDate
      ? task.dueDate.includes('T')
        ? (task.dueDate.split('T')[0] ?? null)
        : task.dueDate
      : null
  );
  const [error, setError] = useState<string | null>(null);

  const currentUser = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const initialUserRef = useRef(currentUser?.id);
  const initialEntityRef = useRef(activeEntity);
  const capturedTaskIdRef = useRef<string | null>(null);
  const capturedVersionRef = useRef<number>(task.version ?? 1);
  const capturedWrIdRef = useRef<string | undefined>(task.workRequestId || workRequest?.id);

  // Initialize form ONLY on modal open or task identity change.
  // Never overwrite in-progress user drafts or rebase expectedVersion on background refresh.
  useEffect(() => {
    if (isOpen) {
      if (capturedTaskIdRef.current !== task.id) {
        capturedTaskIdRef.current = task.id;
        capturedVersionRef.current = task.version ?? 1;
        capturedWrIdRef.current = task.workRequestId || workRequest?.id;
        setTitle(task.title || '');
        setDescription(task.description || '');
        setRequiredLinkType(
          task.requiredLinkType ?? (task as { required_link_type?: string | null }).required_link_type ?? null
        );
        setDueDate(
          task.dueDate
            ? (task.dueDate.includes('T')
              ? (task.dueDate.split('T')[0] ?? null)
              : task.dueDate)
            : null
        );
        setError(null);
      }
    } else {
      capturedTaskIdRef.current = null;
    }
  }, [isOpen, task, workRequest?.id]);

  // Strict session/account isolation: close modal on user or entity switch
  useEffect(() => {
    if (
      isOpen &&
      (currentUser?.id !== initialUserRef.current ||
        activeEntity !== initialEntityRef.current)
    ) {
      onClose();
    }
  }, [currentUser?.id, activeEntity, isOpen, onClose]);

  const effectiveWrId = task.workRequestId || workRequest?.id;
  const { resubmitTaskCreation, resubmitCreationMutation } = useTaskMutations(effectiveWrId);
  const isPending = resubmitCreationMutation.isPending;

  const rejectionReason =
    task.rejectionReason ??
    (task as { rejection_reason?: string | null }).rejection_reason ??
    'No rejection reason provided.';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Task title is required.');
      return;
    }
    if (trimmedTitle.length > 255) {
      setError('Task title cannot exceed 255 characters.');
      return;
    }
    setError(null);

    try {
      const targetWrId = capturedWrIdRef.current || effectiveWrId;
      const targetVersion = capturedVersionRef.current;
      const updated = await resubmitTaskCreation({
        workRequestId: targetWrId,
        taskId: task.id,
        expectedVersion: targetVersion,
        data: {
          title: trimmedTitle,
          description: description.trim() || undefined,
          requiredLinkType: requiredLinkType || null,
          dueDate: dueDate || null,
        },
      });

      onSuccess?.(updated);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to resubmit task creation.';
      setError(msg);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isPending && onClose()}>
      <DialogContent
        className="max-w-md bg-[#FFFFFF] border-[#E2E8F0] rounded-[8px] p-5 shadow-lg"
        data-testid="task-resubmit-modal"
      >
        <DialogHeader className="space-y-1.5 pb-2 border-b border-[#E2E8F0]">
          <DialogTitle className="text-base font-bold text-[#1E293B]">
            Edit & Resubmit Task
          </DialogTitle>
          <DialogDescription className="text-xs text-[#475569]">
            Correct the task details according to the lead Manager&apos;s feedback and resubmit for review.
          </DialogDescription>
        </DialogHeader>

        {/* Rejection Feedback Box */}
        <div
          className="p-3 bg-[#FEF2F2] border border-[#FCA5A5] rounded-[6px] space-y-1 text-xs"
          data-testid="task-resubmit-rejection-reason"
        >
          <div className="flex items-center gap-1.5 font-semibold text-[#DC2626]">
            <XCircle className="h-4 w-4 shrink-0" />
            <span>Rejection Reason from Manager Lead:</span>
          </div>
          <p className="text-[#991B1B] pl-5.5 whitespace-pre-wrap">{rejectionReason}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          {error && (
            <div
              role="alert"
              className="p-2.5 rounded-[6px] bg-[#FEF2F2] border border-[#FCA5A5] text-[#DC2626] text-xs font-medium"
              data-testid="task-resubmit-error"
            >
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label
              htmlFor="task-resubmit-title"
              className="text-xs font-bold uppercase tracking-wider text-[#475569]"
            >
              Task Title <span className="text-[#DC2626]">*</span>
            </label>
            <Input
              id="task-resubmit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs to be done?"
              maxLength={255}
              disabled={isPending}
              className="h-8 text-xs border-[#E2E8F0] focus-visible:ring-1 focus-visible:ring-[#1D4ED8]"
              data-testid="task-resubmit-title-input"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="task-resubmit-desc"
              className="text-xs font-bold uppercase tracking-wider text-[#475569]"
            >
              Description
            </label>
            <textarea
              id="task-resubmit-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional scope or clarification notes..."
              rows={3}
              disabled={isPending}
              className="w-full text-xs p-2 rounded-[6px] border border-[#E2E8F0] bg-transparent resize-none focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
              data-testid="task-resubmit-desc-input"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-[#475569] block">
                Link Type
              </label>
              <TaskTypeSelect
                value={requiredLinkType ?? ''}
                onChange={(val) => setRequiredLinkType(val || null)}
                disabled={isPending}
                ariaLabel="Task link type"
                data-testid="task-resubmit-link-type-select"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold uppercase tracking-wider text-[#475569] block">
                Due Date
              </label>
              <DateInput
                type="date"
                value={dueDate || ''}
                onValueChange={(val) => setDueDate(val || null)}
                disabled={isPending}
                className="h-8 text-xs rounded-[6px] border-[#E2E8F0]"
                data-testid="task-resubmit-due-date-input"
              />
            </div>
          </div>

          <DialogFooter className="pt-3 border-t border-[#E2E8F0] gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={onClose}
              className="text-xs rounded-[6px] border-[#E2E8F0]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending || !title.trim()}
              className="text-xs rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs gap-1.5"
              data-testid="task-resubmit-submit-btn"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Resubmitting...</span>
                </>
              ) : (
                <span>Resubmit for Approval</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
