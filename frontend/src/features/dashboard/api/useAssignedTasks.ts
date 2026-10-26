/**
 * Hook to discover and retrieve assigned tasks for the Log-Time Task Picker
 *
 * Scoping Rule (Spec §4.2):
 * - Scoped to tasks assigned to the current user (via `assigneeId` or `assignees` array)
 * - Sources tasks from active Work Requests (`/v1/operations/work-requests?archived=false`)
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { isTaskAssignee } from '@/features/operations/lib/taskScope';
import { dashboardKeys } from './queryKeys';
import type { AssignableTaskOption } from './types';
import type { WorkRequest, Task } from '@/features/operations/api/types';

export interface UseAssignedTasksOptions {
  allTasksForAdmin?: boolean;
}

export function useAssignedTasks(options: UseAssignedTasksOptions = {}) {
  const { allTasksForAdmin = false } = options;
  const user = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const userId = user?.id;
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  // Strictly Admin-only when allTasksForAdmin is requested
  const effectiveAllTasksForAdmin = Boolean(allTasksForAdmin && isAdmin);
  const queryKey = effectiveAllTasksForAdmin
    ? [...dashboardKeys.assignedTasks.scoped(userId), activeEntity, { allTasksForAdmin: true }]
    : [...dashboardKeys.assignedTasks.scoped(userId), activeEntity];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<AssignableTaskOption[]> => {
      // The operations list omits tasks unless explicitly requested. Fetch every page.
      const workRequests: WorkRequest[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const response = await apiRequest<{ data: WorkRequest[]; meta?: { totalPages: number } }>(
          `/operations/work-requests?archived=false&limit=100&includeTasks=true&page=${page}`
        );
        workRequests.push(...(response.data || []));
        totalPages = response.meta?.totalPages || 1;
        page += 1;
      } while (page <= totalPages);

      const optionsList: AssignableTaskOption[] = [];

      for (const wr of workRequests) {
        const tasks: Task[] = wr.tasks || [];

        if (tasks.length === 0 && effectiveAllTasksForAdmin) {
          const wrAssigneeId =
            wr.assignedTo ||
            (wr as { assigned_to?: string | null }).assigned_to ||
            null;
          const wrAssigneeName =
            wr.assignedToName ||
            (wr as { assigned_to_name?: string | null }).assigned_to_name ||
            'Unassigned';
          const wrDueDate =
            wr.dueDate ||
            (wr as { due_date?: string | null }).due_date ||
            null;
          const wrUpdatedAt =
            wr.updatedAt ||
            (wr as { updated_at?: string | null }).updated_at ||
            null;
          const isWrDone =
            String(wr.status || '').toLowerCase() === 'completed' ||
            String(wr.status || '').toLowerCase() === 'done';

          optionsList.push({
            taskId: wr.id,
            taskTitle: wr.title,
            workRequestId: wr.id,
            workRequestTitle: wr.title,
            entity: (wr as { entity_code?: string }).entity_code || wr.entity || 'ATA',
            status: isWrDone ? 'Completed' : 'In Progress',
            phase:
              wr.phase ||
              (wr as { currentPhase?: string | null }).currentPhase ||
              (wr as { current_phase?: string | null }).current_phase ||
              null,
            clientName: wr.clientName || wr.client_name || (wr.client && wr.client.name) || null,
            assigneeId: wrAssigneeId,
            assigneeName: wrAssigneeName,
            assigneeRole: 'Manager',
            coAssigneeCount: Array.isArray(wr.coAssignees) ? wr.coAssignees.length : 0,
            dueDate: wrDueDate,
            updatedAt: wrUpdatedAt,
            completedAt: isWrDone ? wrUpdatedAt : null,
            priority: wr.priority || null,
            assigneesList: [
              {
                id: wrAssigneeId || 'wr-owner',
                name: wrAssigneeName,
                role: 'Manager',
              },
            ],
            rawWorkRequest: wr,
          });
          continue;
        }

        for (const task of tasks) {
          const isCurrentUserAssigned = isTaskAssignee(user, task);
          const isAssigned = effectiveAllTasksForAdmin || isCurrentUserAssigned;

          if (isAssigned) {
            const taskAssigneesList = task.taskAssignees || task.task_assignees || [];
            const matchingAssignee = Array.isArray(taskAssigneesList)
              ? taskAssigneesList.find((a) => {
                  const aUserId = a.userId || a.user_id;
                  return (
                    (task.assigneeId &&
                      aUserId &&
                      String(aUserId).toLowerCase() === String(task.assigneeId).toLowerCase()) ||
                    (isCurrentUserAssigned &&
                      user?.id &&
                      aUserId &&
                      String(aUserId).toLowerCase() === String(user.id).toLowerCase())
                  );
                }) || taskAssigneesList[0]
              : undefined;

            const assigneeName =
              task.assigneeName ||
              (task as { assignee_name?: string | null }).assignee_name ||
              matchingAssignee?.userName ||
              (matchingAssignee as { user_name?: string | null } | undefined)?.user_name ||
              (isCurrentUserAssigned ? user?.name : null) ||
              'Assigned Operator';

            const assigneeRole =
              matchingAssignee?.userRole ||
              (matchingAssignee as { user_role?: string | null } | undefined)?.user_role ||
              (isCurrentUserAssigned ? user?.role : null) ||
              'Staff';

            const coAssigneeCount =
              Array.isArray(task.assignees) && task.assignees.length > 1
                ? task.assignees.length - 1
                : 0;

            const dueDate =
              task.dueDate ||
              (task as { due_date?: string | null }).due_date ||
              null;

            const updatedAt =
              task.updatedAt ||
              (task as { updated_at?: string | null }).updated_at ||
              null;

            const completedAt =
              (task as { completedAt?: string | null }).completedAt ||
              (task as { completed_at?: string | null }).completed_at ||
              (task.status === 'Completed' ? updatedAt : null);

            const priority = wr.priority || null;
            const assigneeId =
              task.assigneeId ||
              (task as { assignee_id?: string | null }).assignee_id ||
              matchingAssignee?.userId ||
              matchingAssignee?.user_id ||
              (isCurrentUserAssigned ? user?.id : null) ||
              null;

            const assigneesList: Array<{ id: string; name: string; role?: string }> = [];
            const seenAssigneeIds = new Set<string>();

            for (const a of taskAssigneesList) {
              const aId = String(a.userId || a.user_id || a.id || '');
              if (!aId || seenAssigneeIds.has(aId.toLowerCase())) continue;
              seenAssigneeIds.add(aId.toLowerCase());

              const aName =
                a.userName ||
                (a as { user_name?: string | null }).user_name ||
                (user?.id && aId.toLowerCase() === String(user.id).toLowerCase() ? user.name : null) ||
                (task.assigneeId && aId.toLowerCase() === String(task.assigneeId).toLowerCase() ? task.assigneeName : null) ||
                'Operator';

              const aRole = a.userRole || (a as { user_role?: string | null }).user_role || 'Staff';

              assigneesList.push({
                id: aId,
                name: aName,
                role: aRole,
              });
            }

            if (assigneeId && !seenAssigneeIds.has(String(assigneeId).toLowerCase())) {
              seenAssigneeIds.add(String(assigneeId).toLowerCase());
              assigneesList.unshift({
                id: String(assigneeId),
                name: assigneeName,
                role: assigneeRole,
              });
            } else if (assigneesList.length === 0) {
              assigneesList.push({
                id: assigneeId || 'primary',
                name: assigneeName,
                role: assigneeRole,
              });
            }

            if (Array.isArray(task.assignees)) {
              for (const uid of task.assignees) {
                const sUid = String(uid);
                if (!seenAssigneeIds.has(sUid.toLowerCase())) {
                  seenAssigneeIds.add(sUid.toLowerCase());
                  assigneesList.push({
                    id: sUid,
                    name: 'Co-Assignee',
                    role: 'Staff',
                  });
                }
              }
            }

            optionsList.push({
              taskId: task.id,
              taskTitle: task.title,
              workRequestId: wr.id,
              workRequestTitle: wr.title,
              entity: (wr as { entity_code?: string }).entity_code || wr.entity || 'ATA',
              status: task.status,
              phase: task.phase || null,
              clientName: wr.clientName || wr.client_name || (wr.client && wr.client.name) || null,
              assigneeId,
              assigneeName,
              assigneeRole,
              coAssigneeCount,
              dueDate,
              updatedAt,
              completedAt,
              priority,
              assigneesList,
              rawTask: {
                ...task,
                workRequestId: task.workRequestId || wr.id,
              },
              rawWorkRequest: wr,
            });
          }
        }
      }

      return optionsList;
    },
    enabled: Boolean(userId),
    staleTime: 60 * 1000,
  });

  const taskOptions = useMemo(() => query.data || [], [query.data]);

  return {
    ...query,
    tasks: taskOptions,
  };
}
