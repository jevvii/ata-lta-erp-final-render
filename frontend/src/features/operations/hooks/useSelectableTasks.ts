import { useMemo, useEffect, useRef } from 'react';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { useWorkRequestTasks } from '../api/useTasks';
import { useTeam, type TeamMember } from '../api/useTeam';
import {
  isTaskAssignee,
  isRoleAdmin,
  isTaskOfWorkRequest,
} from '../lib/taskScope';
import type { Task } from '../api/types';

export type RecordType = 'invoice' | 'disbursement' | 'transmittal' | 'document';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(value?: string | null): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
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
  disabled: boolean;
  label: string;
}

export interface UseSelectableTasksOptions {
  workRequestId?: string | null;
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
  recordType,
  isOpen = true,
  entity,
  currentTaskId,
  selectedTaskId,
  onSelectTask,
  isTaskLocked = false,
}: UseSelectableTasksOptions) {
  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = isRoleAdmin(currentUser);

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

  // Build options with assignee labels and disabled states
  const options: SelectableTaskOption[] = useMemo(() => {
    const list: SelectableTaskOption[] = candidateTasks.map((task) => {
      const assigneeText = formatTaskAssignees(task, teamList);
      const isAssigned = isUserAuthorizedForTask(currentUser, task, currentTaskId);
      const disabled = !isAssigned;
      const label = isAssigned
        ? `${task.title} — ${assigneeText}`
        : `${task.title} — ${assigneeText} (Not assigned to you)`;

      return {
        id: task.id,
        title: task.title,
        task,
        assigneeText,
        isAssigned,
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
        disabled: false,
        label: `${currentTaskId} (Current)`,
      });
    }

    return list;
  }, [candidateTasks, teamList, currentUser, currentTaskId, workRequestId]);

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

  const isNoTasksBlocked = Boolean(
    isQuerySettled && candidateTasks.length === 0 && !currentTaskId
  );
  const isNotAssignedBlocked = Boolean(
    isQuerySettled &&
      candidateTasks.length > 0 &&
      selectableOptions.length === 0 &&
      !currentTaskId
  );
  const isBlocked = isNoTasksBlocked || isNotAssignedBlocked;

  const blockingMessage = useMemo(() => {
    if (isNoTasksBlocked) {
      return 'This work request has no tasks — create one first';
    }
    if (isNotAssignedBlocked) {
      return "You're not assigned to any task on this work request. Ask the task owner or an Admin to add you.";
    }
    return null;
  }, [isNoTasksBlocked, isNotAssignedBlocked]);

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
    allWrTasks,
    candidateTasks,
    options,
    selectableOptions,
    isNoTasksBlocked,
    isNotAssignedBlocked,
    isBlocked,
    blockingMessage,
    isAdmin,
  };
}
