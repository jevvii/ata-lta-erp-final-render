/**
 * Hook to discover and retrieve scoped Work Requests for the Dashboard Calendar
 *
 * Visibility Gates:
 * - Admin: Sees all work requests across the system
 * - Regular employees (including Managers): Only see work requests they are added to
 *   (as assignedTo lead, coAssignees, or assigned to a task within the work request)
 */

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { isTaskAssignee } from '@/features/operations/lib/taskScope';
import { useTeam, type TeamMember } from '@/features/operations/api/useTeam';
import { dashboardKeys } from './queryKeys';
import type { DashboardWorkRequestItem } from './types';
import type { WorkRequest, Task } from '@/features/operations/api/types';

export function toCalendarWorkRequest(
  wr: WorkRequest,
  teamMap: Map<string, TeamMember>
): DashboardWorkRequestItem {
  const tasks: Task[] = wr.tasks || [];
  const isCompleted =
    String(wr.status || '').toLowerCase() === 'completed' ||
    String(wr.status || '').toLowerCase() === 'done';

  const wrAssigneeId =
    wr.assignedTo ||
    (wr as { assigned_to?: string | null }).assigned_to ||
    null;
  const wrAssigneeName =
    wr.assignedToName ||
    (wr as { assigned_to_name?: string | null }).assigned_to_name ||
    (wrAssigneeId ? 'Assigned Lead' : 'Unassigned');

  const fallbackTaskDue =
    tasks.find((t) => t.dueDate || (t as unknown as { due_date?: string }).due_date)?.dueDate ||
    (tasks.find((t) => (t as unknown as { due_date?: string }).due_date) as unknown as { due_date?: string })?.due_date ||
    null;

  const wrDueDate =
    wr.dueDate ||
    (wr as { due_date?: string | null }).due_date ||
    fallbackTaskDue ||
    null;

  const wrUpdatedAt =
    wr.updatedAt ||
    (wr as { updated_at?: string | null }).updated_at ||
    null;

  const rawCoAssignees =
    wr.coAssignees ||
    (wr as { co_assignees?: unknown[] }).co_assignees ||
    [];

  const coAssignees: string[] = Array.isArray(rawCoAssignees)
    ? rawCoAssignees.map((ca: unknown) =>
        typeof ca === 'string'
          ? ca
          : (ca as { id?: string; userId?: string; user_id?: string })?.id ||
            (ca as { id?: string; userId?: string; user_id?: string })?.userId ||
            (ca as { id?: string; userId?: string; user_id?: string })?.user_id ||
            ''
      ).filter(Boolean)
    : [];

  const leadMember = wrAssigneeId ? teamMap.get(String(wrAssigneeId)) : null;
  const rawWr = wr as unknown as Record<string, unknown>;
  const rawLeadUser = (rawWr.assignedToUser || rawWr.assigned_to_user) as Record<string, unknown> | undefined;
  const leadAvatar =
    (rawLeadUser?.avatarUrl as string) ||
    (rawLeadUser?.avatar_url as string) ||
    (rawWr.avatarUrl as string) ||
    (rawWr.avatar_url as string) ||
    leadMember?.avatarUrl ||
    null;

  const assigneesList: Array<{ id: string; name: string; role?: string; avatarUrl?: string | null }> = [];
  if (wrAssigneeId) {
    assigneesList.push({
      id: wrAssigneeId,
      name: leadMember?.name || wrAssigneeName,
      role: leadMember?.role || 'Lead',
      avatarUrl: leadAvatar,
    });
  }

  for (const caId of coAssignees) {
    if (caId !== wrAssigneeId && !assigneesList.some((a) => a.id === caId)) {
      const member = teamMap.get(String(caId));
      const rawObj = Array.isArray(rawCoAssignees)
        ? (rawCoAssignees.find((ca: unknown) =>
            ca && typeof ca === 'object' &&
            ((ca as { id?: string; userId?: string; user_id?: string }).id === caId ||
             (ca as { id?: string; userId?: string; user_id?: string }).userId === caId ||
             (ca as { id?: string; userId?: string; user_id?: string }).user_id === caId)
          ) as Record<string, unknown> | undefined)
        : undefined;

      const caName = member?.name || (rawObj?.name as string) || 'Team Member';
      const caRole = member?.role || (rawObj?.role as string) || 'Staff';
      const caAvatar = member?.avatarUrl || (rawObj?.avatarUrl as string) || (rawObj?.avatar_url as string) || null;

      assigneesList.push({
        id: caId,
        name: caName,
        role: caRole,
        avatarUrl: caAvatar,
      });
    }
  }

  const completedTasksCount = tasks.filter(
    (t) => String(t.status || '').toLowerCase() === 'completed'
  ).length;

  return {
    id: wr.id,
    title: wr.title,
    work_order_number: (wr as { work_order_number?: string }).work_order_number || null,
    entity: (wr as { entity_code?: string }).entity_code || wr.entity || 'ATA',
    status: wr.status || (isCompleted ? 'Completed' : 'In Progress'),
    phase:
      wr.phase ||
      (wr as { currentPhase?: string | null }).currentPhase ||
      (wr as { current_phase?: string | null }).current_phase ||
      tasks.find((t) => t.phase)?.phase ||
      null,
    clientId: wr.clientId || (wr as { client_id?: string | null }).client_id || null,
    clientName: wr.clientName || wr.client_name || (wr.client && wr.client.name) || null,
    assigneeId: wrAssigneeId,
    assigneeName: wrAssigneeName,
    assigneeRole: 'Lead',
    coAssignees,
    coAssigneeCount: coAssignees.length,
    dueDate: wrDueDate,
    updatedAt: wrUpdatedAt,
    completedAt:
      (wr as { completed_at?: string | null }).completed_at ||
      (wr as { completedAt?: string | null }).completedAt ||
      (isCompleted ? wrUpdatedAt : null),
    priority: wr.priority || null,
    tasksCount: tasks.length,
    completedTasksCount,
    tasks,
    rawWorkRequest: wr,
    assigneesList,
  };
}

export function canUserViewWorkRequest(
  user: { id?: string; email?: string; role?: string } | null | undefined,
  wr: WorkRequest
): boolean {
  if (!user) return false;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || user.email === 'lorein@ata-lta.ph') return true;

  const currentUserId = user.id ? String(user.id).toLowerCase() : null;
  if (!currentUserId) return false;

  // 1. Lead assignee on WR
  const leadId = (wr.assignedTo || (wr as { assigned_to?: string }).assigned_to || '')?.toLowerCase();
  if (leadId === currentUserId) return true;

  // 2. Co-assignees array on WR
  const rawCoAssignees = wr.coAssignees || (wr as { co_assignees?: unknown[] }).co_assignees;
  if (Array.isArray(rawCoAssignees)) {
    const isCoAssignee = rawCoAssignees.some((ca: unknown) => {
      if (typeof ca === 'string') return ca.toLowerCase() === currentUserId;
      if (ca && typeof ca === 'object') {
        const id = (
          (ca as { id?: string; userId?: string; user_id?: string }).id ||
          (ca as { id?: string; userId?: string; user_id?: string }).userId ||
          (ca as { id?: string; userId?: string; user_id?: string }).user_id ||
          ''
        )?.toLowerCase();
        return id === currentUserId;
      }
      return false;
    });
    if (isCoAssignee) return true;
  }

  // 3. Current user is assigned to any task within this work request
  const tasks: Task[] = wr.tasks || [];
  if (tasks.some((t) => isTaskAssignee(user as unknown as Parameters<typeof isTaskAssignee>[0], t))) {
    return true;
  }

  return false;
}

export function useDashboardWorkRequests() {
  const user = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const userId = user?.id;
  const isAdmin = String(user?.role || '').toLowerCase() === 'admin';

  const teamQuery = useTeam();
  const teamList = teamQuery.data ?? [];
  const teamMap = new Map<string, TeamMember>();
  for (const m of teamList) {
    if (m?.id) {
      teamMap.set(String(m.id), m);
    }
  }

  // Sub-scoped under assignedTasks so existing CDC realtime invalidations keep it fresh
  const queryKey = [
    ...dashboardKeys.assignedTasks.scoped(userId),
    'work-requests',
    activeEntity,
    { allForAdmin: isAdmin },
  ];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<DashboardWorkRequestItem[]> => {
      const workRequests: WorkRequest[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const response = await apiRequest<{ data: WorkRequest[]; meta?: { totalPages: number } } | WorkRequest[]>(
          `/operations/work-requests?archived=false&limit=100&includeTasks=true&page=${page}`
        );
        const list = Array.isArray(response) ? response : response?.data || [];
        workRequests.push(...list);
        totalPages = Array.isArray(response) ? 1 : response?.meta?.totalPages || 1;
        page += 1;
      } while (page <= totalPages);

      // Filter by activeEntity if not 'ALL'
      const entityFiltered =
        activeEntity && activeEntity !== 'ALL'
          ? workRequests.filter((wr) => {
              const ent =
                (wr as { entity_code?: string }).entity_code || wr.entity || 'ATA';
              return String(ent).toUpperCase() === String(activeEntity).toUpperCase();
            })
          : workRequests;

      // Visibility Gate: Regular employees including managers only see WRs they are added to; Admin sees all
      const visibleWrs = entityFiltered.filter((wr) => canUserViewWorkRequest(user, wr));

      return visibleWrs.map((wr) => toCalendarWorkRequest(wr, teamMap));
    },
  });

  return {
    workRequests: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
