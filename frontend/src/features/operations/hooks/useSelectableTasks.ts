import { useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { useWorkRequestTasks } from '../api/useTasks';
import { operationsKeys } from '../api/queryKeys';
import { useTeam, type TeamMember } from '../api/useTeam';
import {
  isTaskAssignee,
  isRoleAdmin,
  isTaskOfWorkRequest,
} from '../lib/taskScope';
import type { Task, WorkRequest } from '../api/types';

export type RecordType = 'invoice' | 'disbursement' | 'transmittal' | 'document';

export const PHASE_SEQUENCE = [
  'pre_processing',
  'processing',
  'quality_assurance',
  'completion',
] as const;

export type BlockingReason = 'no_tasks' | 'unassigned' | 'phase_or_prereq_locked' | null;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value?: string | null): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

/**
 * Formats a phase slug into a human-readable label (e.g. 'pre_processing' -> 'Pre-processing').
 */
export function formatPhaseLabel(phase?: string | null): string {
  const normalized = String(phase || '').toLowerCase().trim();
  if (normalized === 'pre_processing') return 'Pre-processing';
  if (normalized === 'processing') return 'Processing';
  if (normalized === 'quality_assurance') return 'Quality Assurance';
  if (normalized === 'completion') return 'Completion';
  return phase ? String(phase) : '';
}

/**
 * Determines whether a task is locked due to its phase vs. the work request's active phase.
 * - Current stored task on edit is never locked.
 * - If either task.phase or workRequestPhase is empty/null/undefined, not locked.
 * - For non-invoice records (disbursement, document, transmittal): locked if task.phase !== workRequestPhase.
 * - For invoice records: locked if PHASE_SEQUENCE.indexOf(task.phase) > PHASE_SEQUENCE.indexOf(workRequestPhase).
 */
export function isTaskPhaseLocked(
  task: Task,
  workRequestPhase?: string | null,
  recordType: RecordType = 'disbursement',
  currentTaskId?: string | null
): boolean {
  if (currentTaskId && task.id === currentTaskId) {
    return false;
  }

  const taskPhase = typeof task.phase === 'string' ? task.phase.trim() : '';
  const wrPhase = typeof workRequestPhase === 'string' ? workRequestPhase.trim() : '';

  if (!taskPhase || !wrPhase) {
    return false;
  }

  if (recordType !== 'invoice') {
    return taskPhase !== wrPhase;
  }

  const taskIdx = (PHASE_SEQUENCE as readonly string[]).indexOf(taskPhase);
  const wrIdx = (PHASE_SEQUENCE as readonly string[]).indexOf(wrPhase);

  if (taskIdx !== -1 && wrIdx !== -1) {
    return taskIdx > wrIdx;
  }

  return taskPhase !== wrPhase;
}

function isPredecessorCompleteOrCancelled(status?: string | null): boolean {
  const s = String(status || '').toLowerCase().trim();
  return s === 'completed' || s === 'done' || s === 'cancelled';
}

/**
 * Determines whether a task is locked due to an incomplete prerequisite (predecessor) task.
 * Checks task.predecessors (IDs looked up against allTasksOnWr) and/or task.predecessorDetails.
 */
export function isTaskPrereqLocked(
  task: Task,
  allTasksOnWr: Task[] = [],
  currentTaskId?: string | null
): boolean {
  if (currentTaskId && task.id === currentTaskId) {
    return false;
  }

  const details = [
    ...(task.predecessorDetails || []),
    ...(task.predecessor_details || []),
  ];

  for (const d of details) {
    if (d && d.status !== undefined && d.status !== null) {
      if (!isPredecessorCompleteOrCancelled(d.status)) {
        return true;
      }
    }
  }

  if (Array.isArray(task.predecessors) && task.predecessors.length > 0) {
    for (const predId of task.predecessors) {
      if (!predId) continue;
      const detailMatch = details.find((d) => d && d.id === predId);
      if (detailMatch && detailMatch.status !== undefined && detailMatch.status !== null) {
        if (!isPredecessorCompleteOrCancelled(detailMatch.status)) {
          return true;
        }
        continue;
      }
      const predTask = allTasksOnWr.find((t) => t.id === predId);
      if (predTask) {
        if (!isPredecessorCompleteOrCancelled(predTask.status)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Formats task assignees into a comma-separated display string:
 * e.g. "Juan D., Maria S." or "Unassigned".
 * Defensively resolves IDs against team directory if names are missing.
 */
export function formatTaskAssignees(
  task: Task,
  teamList: TeamMember[] = []
): string {
  const teamMap = new Map<string, string>();
  for (const m of teamList) {
    if (m?.id && m?.name) {
      teamMap.set(m.id, m.name);
    }
  }

  const names: string[] = [];
  const seenIds = new Set<string>();

  // 1.Enriched assigneeDetails / assignee_details from backend toApiTask
  const details = [
    ...(task.assigneeDetails || []),
    ...(task.assignee_details || []),
  ];
  for (const d of details) {
    const uid = d.userId ?? d.user_id;
    if (uid && !seenIds.has(uid)) {
      seenIds.add(uid);
      const name = d.userName ?? d.user_name ?? teamMap.get(uid);
      if (name && !isUuid(name)) {
        names.push(name);
      } else {
        names.push(`Staff (${uid.slice(0, 8)})`);
      }
    }
  }

  // 2. Primary assignee
  const leadId =
    task.assigneeId ??
    (task as { assignee_id?: string | null }).assignee_id ??
    null;
  if (leadId && !seenIds.has(leadId)) {
    seenIds.add(leadId);
    const leadName =
      task.assigneeName ??
      (task as { assignee_name?: string | null }).assignee_name ??
      teamMap.get(leadId);
    if (leadName && !isUuid(leadName)) {
      names.push(leadName);
    } else {
      names.push(`Staff (${leadId.slice(0, 8)})`);
    }
  }

  // 3. Co-assignees from taskAssignees / task_assignees join records
  const relational = [
    ...(task.taskAssignees || []),
    ...(task.task_assignees || []),
  ];
  for (const a of relational) {
    const uid = a.userId ?? a.user_id;
    if (uid && !seenIds.has(uid)) {
      seenIds.add(uid);
      const name = a.userName ?? (a as { user_name?: string }).user_name ?? teamMap.get(uid);
      if (name && !isUuid(name)) {
        names.push(name);
      } else {
        names.push(`Staff (${uid.slice(0, 8)})`);
      }
    }
  }

  // 4. Fallback to assignees array
  if (Array.isArray(task.assignees)) {
    for (const uid of task.assignees) {
      if (uid && typeof uid === 'string' && !seenIds.has(uid)) {
        seenIds.add(uid);
        const name = teamMap.get(uid);
        if (name && !isUuid(name)) {
          names.push(name);
        } else {
          names.push(`Staff (${uid.slice(0, 8)})`);
        }
      }
    }
  }

  // 5. Fallback to assigneeName if present without assigneeId
  if (names.length === 0) {
    const rawLeadName =
      task.assigneeName ??
      (task as { assignee_name?: string | null }).assignee_name ??
      null;
    if (rawLeadName && !isUuid(rawLeadName)) {
      names.push(rawLeadName);
    }
  }

  if (names.length === 0) {
    return 'Unassigned';
  }

  return names.join(', ');
}

/**
 * Determines whether a task is selectable for the given record type.
 * - Cancelled: never selectable (unless current stored task on edit).
 * - Done/Completed: selectable only for invoices (unless current stored task on edit).
 */
export function isTaskSelectableForRecord(
  task: Task,
  recordType: RecordType,
  currentTaskId?: string | null
): boolean {
  if (currentTaskId && task.id === currentTaskId) {
    return true;
  }

  const rawStatus = String(task.status || '').toLowerCase().trim();
  if (rawStatus === 'cancelled') {
    return false;
  }

  const isDone = rawStatus === 'completed' || rawStatus === 'done';
  if (isDone) {
    return recordType === 'invoice';
  }

  return true;
}

/**
 * Checks whether the current user is authorized to select this task.
 * - Current stored task on edit is always authorized.
 * - Admin bypasses assignment check.
 * - Non-Admin must be an assignee (lead or co-assignee).
 */
export function isUserAuthorizedForTask(
  user: UserProfile | null | undefined,
  task: Task,
  currentTaskId?: string | null
): boolean {
  if (currentTaskId && task.id === currentTaskId) {
    return true;
  }
  if (isRoleAdmin(user)) {
    return true;
  }
  return isTaskAssignee(user, task);
}

export interface SelectableTaskOption {
  id: string;
  title: string;
  task: Task;
  assigneeText: string;
  isAssigned: boolean;
  isPhaseLocked: boolean;
  isPrereqLocked: boolean;
  disabled: boolean;
  label: string;
}

export interface UseSelectableTasksOptions {
  workRequestId?: string | null;
  workRequestPhase?: string | null;
  recordType: RecordType;
  isOpen?: boolean;
  entity?: 'ATA' | 'LTA' | string | null;
  currentTaskId?: string | null;
  selectedTaskId?: string | null;
  onSelectTask?: (taskId: string) => void;
  isTaskLocked?: boolean;
}

export function useSelectableTasks({
  workRequestId,
  workRequestPhase,
  recordType,
  isOpen = true,
  entity,
  currentTaskId,
  selectedTaskId,
  onSelectTask,
  isTaskLocked = false,
}: UseSelectableTasksOptions) {
  const queryClient = useQueryClient();
  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = isRoleAdmin(currentUser);

  // Resolve Work Request phase from explicit prop or React Query cache fallback
  const resolvedWrPhase = useMemo(() => {
    if (workRequestPhase !== undefined && workRequestPhase !== null && workRequestPhase !== '') {
      return workRequestPhase;
    }
    if (!workRequestId) return null;

    const detail = queryClient.getQueryData<WorkRequest>(
      operationsKeys.workRequestDetail(workRequestId)
    );
    if (detail?.phase) return detail.phase;

    const lists = queryClient.getQueriesData<{ data?: WorkRequest[] } | WorkRequest[]>({
      queryKey: operationsKeys.workRequests(),
    });
    for (const [, data] of lists) {
      const arr = Array.isArray(data) ? data : data?.data;
      if (Array.isArray(arr)) {
        const hit = arr.find((w) => w.id === workRequestId);
        if (hit?.phase) return hit.phase;
      }
    }
    return null;
  }, [workRequestPhase, workRequestId, queryClient]);

  const { data: rawTeam = [] } = useTeam();
  const teamList: TeamMember[] = useMemo(() => {
    if (Array.isArray(rawTeam)) return rawTeam;
    if (
      rawTeam &&
      typeof rawTeam === 'object' &&
      'data' in rawTeam &&
      Array.isArray((rawTeam as { data: unknown[] }).data)
    ) {
      return (rawTeam as { data: TeamMember[] }).data;
    }
    return [];
  }, [rawTeam]);

  const tasksQuery = useWorkRequestTasks(workRequestId || undefined, {
    enabled: Boolean(isOpen && workRequestId),
    entity: entity ?? undefined,
  });

  // Filter tasks to only those belonging to the given work request (excluding placeholders)
  const allWrTasks: Task[] = useMemo(() => {
    if (!workRequestId) return [];
    if (tasksQuery.isPlaceholderData) return [];
    const raw = tasksQuery.data;
    const list: Task[] = Array.isArray(raw)
      ? raw
      : raw &&
          typeof raw === 'object' &&
          'data' in raw &&
          Array.isArray((raw as { data: unknown[] }).data)
        ? ((raw as { data: Task[] }).data as Task[])
        : [];
    return list.filter((t) => isTaskOfWorkRequest(t, workRequestId));
  }, [workRequestId, tasksQuery.isPlaceholderData, tasksQuery.data]);

  // Candidate tasks for this record type (status selectability: non-cancelled; done only for invoices)
  const candidateTasks: Task[] = useMemo(() => {
    return allWrTasks.filter((t) =>
      isTaskSelectableForRecord(t, recordType, currentTaskId)
    );
  }, [allWrTasks, recordType, currentTaskId]);

  // Build options with assignee labels, phase/prerequisite lock state, and disabled states
  const options: SelectableTaskOption[] = useMemo(() => {
    const list: SelectableTaskOption[] = candidateTasks.map((task) => {
      const assigneeText = formatTaskAssignees(task, teamList);
      const isCurrentStoredTask = Boolean(currentTaskId && task.id === currentTaskId);
      const isAuthorized = isUserAuthorizedForTask(currentUser, task, currentTaskId);
      const isPhaseLocked = isCurrentStoredTask
        ? false
        : isTaskPhaseLocked(task, resolvedWrPhase, recordType, currentTaskId);
      const isPrereqLocked = isCurrentStoredTask
        ? false
        : isTaskPrereqLocked(task, allWrTasks, currentTaskId);

      const disabled = isCurrentStoredTask
        ? false
        : !isAuthorized || isPhaseLocked || isPrereqLocked;

      let label = `${task.title} — ${assigneeText}`;
      if (!isCurrentStoredTask) {
        if (isPhaseLocked) {
          const phaseLabel = formatPhaseLabel(task.phase);
          label = `${task.title} — ${assigneeText} (Locked: ${phaseLabel} phase not active)`;
        } else if (isPrereqLocked) {
          label = `${task.title} — ${assigneeText} (Locked: Waiting on prerequisite task)`;
        } else if (!isAuthorized) {
          label = `${task.title} — ${assigneeText} (Not assigned to you)`;
        }
      }

      return {
        id: task.id,
        title: task.title,
        task,
        assigneeText,
        isAssigned: isAuthorized,
        isPhaseLocked,
        isPrereqLocked,
        disabled,
        label,
      };
    });

    if (currentTaskId && !list.some((o) => o.id === currentTaskId)) {
      list.unshift({
        id: currentTaskId,
        title: currentTaskId,
        task: {
          id: currentTaskId,
          title: currentTaskId,
          status: 'In Progress',
          workRequestId: workRequestId || '',
          assigneeId: null,
          assigneeName: null,
          assignees: [],
          phase: 'pre_processing',
          qaStatus: 'none',
          phaseEnteredAt: null,
          predecessors: [],
          dueDate: null,
          requiredLinkType: null,
          displayOrder: 0,
          version: 1,
          createdAt: '',
          updatedAt: '',
          description: null,
        },
        assigneeText: 'Current',
        isAssigned: true,
        isPhaseLocked: false,
        isPrereqLocked: false,
        disabled: false,
        label: `${currentTaskId} (Current)`,
      });
    }

    return list;
  }, [
    candidateTasks,
    teamList,
    currentUser,
    currentTaskId,
    workRequestId,
    resolvedWrPhase,
    recordType,
    allWrTasks,
  ]);

  // Options that the current user can actually select
  const selectableOptions = useMemo(() => {
    return options.filter((o) => !o.disabled);
  }, [options]);

  // Blocking states: only applicable when work request is selected and query has finished loading
  const isQuerySettled = Boolean(
    workRequestId &&
      !tasksQuery.isLoading &&
      !tasksQuery.isPlaceholderData &&
      tasksQuery.isFetched
  );

  // Whether the user is authorized for at least one status-eligible task on the WR
  const hasAuthorizedCandidateTask = useMemo(() => {
    return candidateTasks.some((t) => isUserAuthorizedForTask(currentUser, t, currentTaskId));
  }, [candidateTasks, currentUser, currentTaskId]);

  const blockingReason: BlockingReason = useMemo(() => {
    if (!isQuerySettled || currentTaskId) {
      return null;
    }
    if (candidateTasks.length === 0) {
      return 'no_tasks';
    }
    if (!hasAuthorizedCandidateTask) {
      return 'unassigned';
    }
    if (selectableOptions.length === 0) {
      return 'phase_or_prereq_locked';
    }
    return null;
  }, [isQuerySettled, currentTaskId, candidateTasks.length, hasAuthorizedCandidateTask, selectableOptions.length]);

  const isNoTasksBlocked = blockingReason === 'no_tasks';
  const isNotAssignedBlocked = blockingReason === 'unassigned';
  const isPhaseOrPrereqBlocked = blockingReason === 'phase_or_prereq_locked';
  const isBlocked = blockingReason !== null;

  const blockingMessage = useMemo(() => {
    if (blockingReason === 'no_tasks') {
      return 'This work request has no tasks — create one first';
    }
    if (blockingReason === 'unassigned') {
      return "You're not assigned to any task on this work request. Ask the task owner or an Admin to add you.";
    }
    if (blockingReason === 'phase_or_prereq_locked') {
      return 'No tasks are available in the current phase yet — complete the active phase or prerequisite tasks first.';
    }
    return null;
  }, [blockingReason]);

  // Auto-selection: exactly one selectable task -> auto-select
  const autoSelectFiredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen || isTaskLocked || !onSelectTask || !isQuerySettled || currentTaskId) {
      return;
    }
    if (selectableOptions.length === 1 && !isBlocked) {
      const singleId = selectableOptions[0]!.id;
      // Auto-select if nothing is currently selected or current selection is not selectable
      if (!selectedTaskId || !selectableOptions.some((o) => o.id === selectedTaskId)) {
        if (autoSelectFiredRef.current !== `${workRequestId}:${singleId}`) {
          autoSelectFiredRef.current = `${workRequestId}:${singleId}`;
          onSelectTask(singleId);
        }
      }
    }
  }, [
    isOpen,
    isTaskLocked,
    onSelectTask,
    isQuerySettled,
    selectableOptions,
    isBlocked,
    selectedTaskId,
    workRequestId,
    currentTaskId,
  ]);

  return {
    tasksQuery,
    isLoading: tasksQuery.isLoading,
    isQuerySettled,
    workRequestPhase: resolvedWrPhase,
    allWrTasks,
    candidateTasks,
    options,
    selectableOptions,
    selectableTasks: selectableOptions,
    blockingReason,
    isNoTasksBlocked,
    isNotAssignedBlocked,
    isPhaseOrPrereqBlocked,
    isBlocked,
    blockingMessage,
    isAdmin,
  };
}
