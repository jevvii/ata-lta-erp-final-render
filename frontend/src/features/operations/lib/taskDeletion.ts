import type { Task, WorkRequest } from '../api/types';

const PHASES = ['pre_processing', 'processing', 'quality_assurance', 'completion'];

export function getTaskDeletionReason(
  task: Pick<Task, 'phase' | 'taskDocuments' | 'hasDocuments'>,
  workRequest?: Pick<WorkRequest, 'phase' | 'status'> | null
): string | null {
  if (task.hasDocuments || task.taskDocuments?.length) {
    return 'You cannot delete this task because it has documents/receipts.';
  }
  if (workRequest?.status === 'Completed' || workRequest?.phase === 'completion') {
    return 'You cannot delete this task because the work request is completed.';
  }
  const taskPhaseIndex = PHASES.indexOf(task.phase);
  if (taskPhaseIndex >= 0 && taskPhaseIndex < PHASES.indexOf(workRequest?.phase ?? '')) {
    return 'You cannot delete this task because the work request has advanced beyond its phase.';
  }
  return null;
}
