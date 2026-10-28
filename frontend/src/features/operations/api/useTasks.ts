import { operationsViewerRefresh } from './viewerRefresh';
import { dashboardKeys } from '@/features/dashboard/api/queryKeys';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError, getScopeGeneration } from '@/lib/api';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useSessionStore } from '@/lib/session';
import { broadcastEntityChange } from '@/lib/tabSync';
import { operationsKeys } from './queryKeys';
import { filterTaskRelatedRecords } from '../lib/taskScope';
import type {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  TaskTimeLogInput,
  TaskStatus,
  TaskRelatedRecords,
  TaskRelatedInvoice,
  TaskRelatedDisbursement,
  TaskRelatedTransmittal,
} from './types';

export type {
  TaskRelatedRecords,
  TaskRelatedInvoice,
  TaskRelatedDisbursement,
  TaskRelatedTransmittal,
};



// ============================================================================
// Queries
// ============================================================================

export function useWorkRequestTasks(
  workRequestId: string | undefined,
  options?: { enabled?: boolean; entity?: string | null }
) {
  return useQuery({
    queryKey: operationsKeys.tasks(workRequestId ?? '', options?.entity),
    queryFn: async ({ signal }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const searchParams = new URLSearchParams();
      if (options?.entity) searchParams.append('entity', options.entity);
      const queryStr = searchParams.toString();
      const res = await apiRequest<{ data: Task[] }>(
        `/operations/work-requests/${workRequestId}/tasks${queryStr ? `?${queryStr}` : ''}`,
        { signal }
      );
      return res.data;
    },
    enabled: Boolean(workRequestId) && (options?.enabled ?? true),
    ...operationsViewerRefresh,
  // Instant feel: kanban columns/list keep previous rows during refetch of the SAME WR.
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey?.[3] === workRequestId ? previousData : undefined,
  });
}

export function useTaskDetail(
  workRequestId: string | undefined,
  taskId: string | undefined,
  options?: { enabled?: boolean }
) {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.taskDetail(workRequestId ?? '', taskId ?? ''),
    queryFn: async ({ signal }): Promise<Task | null> => {
      if (!workRequestId || !taskId) throw new Error('IDs are required');
      const res = await apiRequest<{ data: Task | Task[] }>(
        `/operations/work-requests/${workRequestId}/tasks/${taskId}`,
        { signal }
      );
      if (Array.isArray(res?.data)) {
        const found = res.data.find((t) => t?.id === taskId);
        if (!found) return null;
        const taskWrId = found.workRequestId ?? (found as { work_request_id?: string }).work_request_id;
        if (taskWrId && taskWrId !== workRequestId) return null;
        return found as Task;
      }
      const single = (res?.data ?? null) as Task | null;
      if (single) {
        if (single.id !== taskId) return null;
        const taskWrId = single.workRequestId ?? (single as { work_request_id?: string }).work_request_id;
        if (taskWrId && taskWrId !== workRequestId) return null;
      }
      return single;
    },
    enabled: Boolean(workRequestId && taskId) && (options?.enabled ?? true),
    ...operationsViewerRefresh,
    // Instant feel: seed from the work request's task list cache while the
    // detail fetch completes. Placeholder never persists into the cache.
    placeholderData: (_prev): Task | undefined => {
      if (!workRequestId || !taskId) return undefined;
      const tasks = queryClient.getQueryData<Task[]>(operationsKeys.tasks(workRequestId, activeEntity));
      return tasks?.find((t) => t.id === taskId);
    },
  });
}

export function useTaskRelated(
  taskId: string | undefined,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: operationsKeys.taskRelated(taskId ?? '', activeEntity),
    queryFn: async ({ signal }) => {
      if (!taskId) throw new Error('Task ID is required');
      const res = await apiRequest<{ data: TaskRelatedRecords }>(
        `/operations/tasks/${taskId}/related`,
        { signal }
      );
      return res.data ?? { invoices: [], disbursements: [], transmittals: [] };
    },
    enabled: Boolean(taskId) && (options?.enabled ?? true),
    select: (data) => filterTaskRelatedRecords(data, taskId),
  });
}

// ============================================================================
// Mutations (Zero Optimistic Updates Doctrine — sanctioned exception: a
// status-ONLY task update is optimistic-with-rollback, mirroring the admin
// WR status dropdown, so assignee status flips render instantly)
// ============================================================================

export interface CreateTaskVariables {
  workRequestId?: string;
  data: CreateTaskInput;
}

export interface UpdateTaskVariables {
  workRequestId?: string;
  taskId: string;
  data: UpdateTaskInput;
}

export interface DeleteTaskVariables {
  workRequestId?: string;
  taskId: string;
}

export interface ReorderTasksVariables {
  workRequestId?: string;
  updates: Array<{ taskId: string; displayOrder: number; status?: TaskStatus }>;
}

export interface AddTimeLogsVariables {
  workRequestId?: string;
  taskId: string;
  logs: TaskTimeLogInput[];
}

export interface TaskCreationApprovalVariables {
  workRequestId?: string;
  taskId: string;
  decision: 'approve' | 'reject';
  reason?: string;
  expectedVersion: number;
}

export interface ResubmitTaskCreationVariables {
  workRequestId?: string;
  taskId: string;
  expectedVersion: number;
  data?: UpdateTaskInput;
}

export function useTaskMutations(boundWorkRequestId?: string) {
  const queryClient = useQueryClient();
  const activeEntity = useSessionStore((state) => state.activeEntity);

  // 1. Create Task
  const createMutation = useMutation<Task, ApiError, CreateTaskVariables>({
    mutationFn: async ({ workRequestId = boundWorkRequestId, data }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const res = await apiRequest<{ data: Task }>(
        `/operations/work-requests/${workRequestId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onSuccess: (task, variables) => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.assignedTasks.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.timeEntries.all });
      const wrId = variables.workRequestId || boundWorkRequestId || task.workRequestId;
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
      queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
    },
  });

  // 2. Update Task (Phase is immutable)
  // Status-ONLY payloads ({status}) take the optimistic path: the per-WR
  // task list and the task detail cache flip instantly, restore from
  // snapshots on failure, and reconcile on settle. Multi-field edits (title,
  // checklist, dates...) remain plain mutate→await→invalidate.
  const updateMutation = useMutation<
    Task,
    ApiError,
    UpdateTaskVariables,
    { wrId: string; prevList?: Task[]; prevDetail?: Task; scopeGeneration: number; optimisticStatus?: string } | undefined
  >({
    mutationFn: async ({ workRequestId = boundWorkRequestId, taskId, data }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const dataKeys = Object.keys(data);
      const isStatusOnly = dataKeys.length === 1 && dataKeys[0] === 'status';
      const res = await apiRequest<{ data: Task }>(
        `/operations/work-requests/${workRequestId}/tasks/${taskId}`,
        {
          method: isStatusOnly ? 'PATCH' : 'PUT',
          body: JSON.stringify(data),
        }
      );
      return res.data;
    },
    onMutate: async (variables) => {
      const scopeGeneration = getScopeGeneration();
      const wrId = variables.workRequestId || boundWorkRequestId;
      if (!wrId) return undefined;

      await queryClient.cancelQueries({ queryKey: operationsKeys.tasks(wrId) });
      await queryClient.cancelQueries({
        queryKey: operationsKeys.taskDetail(wrId, variables.taskId),
      });

      // Recheck scope generation after await cancelQueries before writing to optimistic cache
      if (scopeGeneration !== getScopeGeneration()) {
        throw new ApiError(499, 'Action cancelled: account or entity changed.');
      }

      const prevList = queryClient.getQueryData<Task[]>(operationsKeys.tasks(wrId, activeEntity))
        ?? queryClient.getQueryData<Task[]>(operationsKeys.tasks(wrId));
      const prevDetail = queryClient.getQueryData<Task>(
        operationsKeys.taskDetail(wrId, variables.taskId)
      );

      const dataKeys = Object.keys(variables.data);
      const optimisticStatus = variables.data.status && dataKeys.every((key) => ['status', 'expectedVersion'].includes(key))
        ? variables.data.status : undefined;
      if (optimisticStatus) {
        const status = (variables.data as { status: TaskStatus }).status;
        for (const [key, rows] of queryClient.getQueriesData<Task[]>({ queryKey: operationsKeys.tasks(wrId) })) {
          if (Array.isArray(rows)) queryClient.setQueryData(key,
            rows.map((row) => row.id === variables.taskId ? { ...row, status } : row));
        }
        if (prevDetail) {
          queryClient.setQueryData<Task>(
            operationsKeys.taskDetail(wrId, variables.taskId),
            { ...prevDetail, status }
          );
        }
      }

      return { wrId, prevList, prevDetail, scopeGeneration, optimisticStatus };
    },
    onError: (_err, variables, context) => {
      if (!context) return;
      if (context.scopeGeneration !== getScopeGeneration()) {
        return;
      }
      if (context.optimisticStatus) {
        const restore = (current: Task, previous?: Task) =>
          previous && current.id === variables.taskId &&
          current.status === context.optimisticStatus &&
          (current.version ?? 0) <= (previous.version ?? 0)
            ? previous : current;
        for (const [key, rows] of queryClient.getQueriesData<Task[]>({ queryKey: operationsKeys.tasks(context.wrId) })) {
          if (Array.isArray(rows)) queryClient.setQueryData(key, rows.map((row) =>
            restore(row, context.prevList?.find((previous) => previous.id === row.id))));
        }
        queryClient.setQueryData<Task>(operationsKeys.taskDetail(context.wrId, variables.taskId),
          (current) => current ? restore(current, context.prevDetail) : current);
      }
      // An error can mean another viewer won; reconcile instead of replaying.
      void queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(context.wrId) });
    },
    onSuccess: (updatedTask, variables, context) => {
      if (context?.scopeGeneration !== undefined && context.scopeGeneration !== getScopeGeneration()) {
        return;
      }
      const wrId = variables.workRequestId || boundWorkRequestId || updatedTask.workRequestId;
      if (wrId) {
        // Pin authoritative server truth into detail cache
        queryClient.setQueryData<Task>(
          operationsKeys.taskDetail(wrId, updatedTask.id),
          (current) => current && (current.version ?? 0) > (updatedTask.version ?? 0) ? current : updatedTask
        );
        // Pin authoritative server truth into task list cache
        for (const [key, rows] of queryClient.getQueriesData<Task[]>({ queryKey: operationsKeys.tasks(wrId) })) {
          if (Array.isArray(rows)) queryClient.setQueryData(key, rows.map((row) =>
            row.id === updatedTask.id && (row.version ?? 0) <= (updatedTask.version ?? 0)
              ? { ...row, ...updatedTask } : row));
        }
      }

      // Broadcast entity change cross-tab
      broadcastEntityChange({
        domain: 'operations',
        entityId: updatedTask.id,
        entityData: updatedTask,
      });
    },
    onSettled: (task, _err, variables, context) => {
      if (context?.scopeGeneration !== undefined && context.scopeGeneration !== getScopeGeneration()) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: dashboardKeys.assignedTasks.all });
      const wrId = variables.workRequestId || boundWorkRequestId || task?.workRequestId;
      if (!wrId) return;
      // Invalidate ONLY secondary queries (parent WR detail, counters).
      // Never invalidate the newly pinned task detail or task list to strictly eliminate flash-revert.
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId), exact: true });
      queryClient.invalidateQueries({
        queryKey: operationsKeys.workRequestCounts(activeEntity),
      });
    },
  });

  // 3. Delete Task
  const deleteMutation = useMutation<void, ApiError, DeleteTaskVariables>({
    mutationFn: async ({ workRequestId = boundWorkRequestId, taskId }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      await apiRequest<void>(
        `/operations/work-requests/${workRequestId}/tasks/${taskId}`,
        {
          method: 'DELETE',
        }
      );
    },
    onSuccess: (_res, variables) => {
      const wrId = variables.workRequestId || boundWorkRequestId;
      if (wrId) {
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
        queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      }
    },
  });

  // 4. Reorder Tasks (Intra-phase drag and drop midpoint calculation)
  const reorderMutation = useMutation<Task[], ApiError, ReorderTasksVariables>({
    mutationFn: async ({ workRequestId = boundWorkRequestId, updates }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const promises = updates.map((u) =>
        apiRequest<{ data: Task }>(
          `/operations/work-requests/${workRequestId}/tasks/${u.taskId}`,
          {
            method: 'PUT',
            body: JSON.stringify({ displayOrder: u.displayOrder, status: u.status }),
          }
        ).then((res) => res.data)
      );
      return Promise.all(promises);
    },
    onSuccess: (_tasks, variables) => {
      const wrId = variables.workRequestId || boundWorkRequestId;
      if (wrId) {
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
        queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
      }
    },
  });

  // 5. Add Time Logs
  const addTimeLogsMutation = useMutation<Task, ApiError, AddTimeLogsVariables>({
    mutationFn: async ({ workRequestId = boundWorkRequestId, taskId, logs }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const res = await apiRequest<{ data: Task }>(
        `/operations/work-requests/${workRequestId}/tasks/${taskId}/time-logs`,
        {
          method: 'POST',
          body: JSON.stringify({ logs }),
        }
      );
      return res.data;
    },
    onSuccess: (task, variables) => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.assignedTasks.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.timeEntries.all });
      const wrId = variables.workRequestId || boundWorkRequestId || task.workRequestId;
      queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
      queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
    },
  });

  // 6. Task Creation Approval (Lead Manager decision)
  const creationApprovalMutation = useMutation<Task, ApiError, TaskCreationApprovalVariables>({
    mutationFn: async ({
      workRequestId = boundWorkRequestId,
      taskId,
      decision,
      reason,
      expectedVersion,
    }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const res = await apiRequest<{ data: Task }>(
        `/operations/work-requests/${workRequestId}/tasks/${taskId}/creation-approval`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, reason, expectedVersion }),
        }
      );
      return res.data;
    },
    onSuccess: (updatedTask, variables) => {
      const wrId = variables.workRequestId || boundWorkRequestId || updatedTask.workRequestId;
      if (wrId) {
        queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
        queryClient.invalidateQueries({
          queryKey: operationsKeys.taskDetail(wrId, updatedTask.id),
        });
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
      }
    },
    onError: (err, variables) => {
      if (isConcurrencyConflictError(err)) {
        const wrId = variables.workRequestId || boundWorkRequestId;
        if (wrId) {
          void queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
          void queryClient.invalidateQueries({
            queryKey: operationsKeys.taskDetail(wrId, variables.taskId),
          });
          void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
          void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
        }
      }
    },
  });

  // 7. Resubmit Task Creation (Creator correction after rejection)
  const resubmitCreationMutation = useMutation<Task, ApiError, ResubmitTaskCreationVariables>({
    mutationFn: async ({
      workRequestId = boundWorkRequestId,
      taskId,
      expectedVersion,
      data,
    }) => {
      if (!workRequestId) throw new Error('Work request ID is required');
      const res = await apiRequest<{ data: Task }>(
        `/operations/work-requests/${workRequestId}/tasks/${taskId}/resubmit-creation`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedVersion, data }),
        }
      );
      return res.data;
    },
    onSuccess: (updatedTask, variables) => {
      const wrId = variables.workRequestId || boundWorkRequestId || updatedTask.workRequestId;
      if (wrId) {
        queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
        queryClient.invalidateQueries({
          queryKey: operationsKeys.taskDetail(wrId, updatedTask.id),
        });
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
        queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
      }
    },
    onError: (err, variables) => {
      if (isConcurrencyConflictError(err)) {
        const wrId = variables.workRequestId || boundWorkRequestId;
        if (wrId) {
          void queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(wrId) });
          void queryClient.invalidateQueries({
            queryKey: operationsKeys.taskDetail(wrId, variables.taskId),
          });
          void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
          void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
        }
      }
    },
  });

  return {
    createTask: async (arg: CreateTaskInput | CreateTaskVariables) => {
      const payload: CreateTaskVariables =
        'title' in arg
          ? { workRequestId: boundWorkRequestId, data: arg as CreateTaskInput }
          : (arg as CreateTaskVariables);
      return createMutation.mutateAsync(payload);
    },
    updateTask: async (
      arg1: string | UpdateTaskVariables,
      arg2?: UpdateTaskInput
    ) => {
      const payload: UpdateTaskVariables =
        typeof arg1 === 'string'
          ? { workRequestId: boundWorkRequestId, taskId: arg1, data: arg2! }
          : arg1;
      return updateMutation.mutateAsync(payload);
    },
    deleteTask: async (arg: string | DeleteTaskVariables) => {
      const payload: DeleteTaskVariables =
        typeof arg === 'string'
          ? { workRequestId: boundWorkRequestId, taskId: arg }
          : arg;
      return deleteMutation.mutateAsync(payload);
    },
    reorderTasks: reorderMutation.mutateAsync,
    addTimeLogs: addTimeLogsMutation.mutateAsync,
    approveOrRejectTaskCreation: creationApprovalMutation.mutateAsync,
    resubmitTaskCreation: resubmitCreationMutation.mutateAsync,
    createMutation,
    updateMutation,
    deleteMutation,
    reorderMutation,
    addTimeLogsMutation,
    creationApprovalMutation,
    resubmitCreationMutation,
    isPending:
      createMutation.isPending ||
      updateMutation.isPending ||
      deleteMutation.isPending ||
      reorderMutation.isPending ||
      addTimeLogsMutation.isPending ||
      creationApprovalMutation.isPending ||
      resubmitCreationMutation.isPending,
  };
}
