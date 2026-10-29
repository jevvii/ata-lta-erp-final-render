/**
 * TanStack Query Hooks for Time Entries API Contract (time-entries@2.0.0)
 *
 * Rules:
 * - R2: No optimistic updates (blocking-flow doctrine: mutate -> await -> invalidate)
 *   Sanctioned exception: update/delete of the user's own time entries are
 *   optimistic-with-rollback — user-scoped, unnumbered rows restored from
 *   snapshots on failure and reconciled on settle. Create stays blocking.
 * - R3: Verbatim RFC 7807 error surfacing
 * - Citation: docs/api-contracts/modules/time-entries.md
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';
import { dashboardKeys } from './queryKeys';
import type {
  TimeEntry,
  RawTimeEntryApi,
  TimeSummary,
  RawTimeSummaryApi,
  RawTaskSummaryItemApi,
  CreateTimeEntryInput,
  UpdateTimeEntryInput,
  TimeEntryListFilters,
} from './types';
import { rawTimeSummaryApiSchema, rawTimeEntryApiSchema } from './schemas';

// ============================================================================
// 1. Data Transformers
// ============================================================================

export function mapRawTimeEntry(raw: RawTimeEntryApi): TimeEntry {
  return {
    id: raw.id,
    userId: raw.user_id,
    userName: raw.user_name ?? null,
    userRole: raw.user_role ?? null,
    userAvatarUrl: (raw.userAvatarUrl as string) || (raw.user_avatar_url as string) || null,
    taskId: raw.task_id,
    entryDate: raw.entry_date,
    durationMinutes: raw.duration_minutes,
    note: raw.note ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export function mapRawTimeSummary(raw: RawTimeSummaryApi): TimeSummary {
  return {
    date: raw.date,
    totalMinutes: raw.total_minutes ?? 0,
    byTask: (raw.by_task || []).map((t: RawTaskSummaryItemApi) => ({
      taskId: t.task_id,
      workRequestId: t.work_request_id,
      title: t.title,
      minutes: t.minutes,
    })),
  };
}

// ============================================================================
// 2. Query Hooks
// ============================================================================

/**
 * Fetch daily aggregated summary of time entries for a given date.
 * Single indexed query on /v1/time-entries/summary?date=YYYY-MM-DD
 */
export function useTimeSummary(date: string, userId?: string) {
  const viewerId = useSessionStore((state) => state.user?.id);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  return useQuery({
    queryKey: [...dashboardKeys.timeEntries.summary(date, userId), { viewerId, activeEntity }],
    queryFn: async (): Promise<TimeSummary> => {
      const params = new URLSearchParams({ date });
      if (userId) {
        params.set('user_id', userId);
      }
      const response = await apiRequest<{ data?: RawTimeSummaryApi; date?: string; total_minutes?: number; by_task?: RawTaskSummaryItemApi[] }>(
        `/time-entries/summary?${params.toString()}`
      );
      const raw = response.data || (response as RawTimeSummaryApi);
      if (process.env.NODE_ENV !== 'production') {
        const parsed = rawTimeSummaryApiSchema.safeParse(raw);
        if (!parsed.success) {
          console.warn('[useTimeSummary] Response schema validation warning:', parsed.error);
        }
      }
      return mapRawTimeSummary(raw);
    },
    enabled: Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date)),
    staleTime: 30 * 1000,
  });
}

/**
 * List time entries with optional date range, task, or user filters.
 */
export function useTimeEntriesList(filters?: TimeEntryListFilters) {
  const viewerId = useSessionStore((state) => state.user?.id);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  return useQuery({
    queryKey: [...dashboardKeys.timeEntries.list(filters), { viewerId, activeEntity }],
    queryFn: async (): Promise<TimeEntry[]> => {
      const params = new URLSearchParams();
      if (filters?.from) params.set('from', filters.from);
      if (filters?.to) params.set('to', filters.to);
      if (filters?.taskId) params.set('task_id', filters.taskId);
      if (filters?.userId) params.set('user_id', filters.userId);

      const qs = params.toString();
      const path = qs ? `/time-entries?${qs}` : '/time-entries';
      const response = await apiRequest<{ data: RawTimeEntryApi[] }>(path);
      const items = response.data || [];
      return items.map(mapRawTimeEntry);
    },
    staleTime: 30 * 1000,
  });
}

// ============================================================================
// 3. Mutation Hooks (update/delete optimistic-with-rollback per the
// sanctioned exception noted above; create stays blocking)
// ============================================================================

/**
 * Create a new duration-based time entry against a task.
 */
export function useCreateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateTimeEntryInput): Promise<TimeEntry> => {
      const payload = {
        task_id: input.taskId,
        entry_date: input.entryDate,
        duration_minutes: input.durationMinutes,
        note: input.note || null,
      };

      const response = await apiRequest<{ data: RawTimeEntryApi }>(
        '/time-entries',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );

      if (process.env.NODE_ENV !== 'production') {
        const parsed = rawTimeEntryApiSchema.safeParse(response.data);
        if (!parsed.success) {
          console.warn('[useCreateTimeEntry] Schema validation warning:', parsed.error);
        }
      }

      return mapRawTimeEntry(response.data);
    },
    onSuccess: async () => {
      // Invalidate time-entries cache (summaries and lists)
      await queryClient.invalidateQueries({
        queryKey: dashboardKeys.timeEntries.all,
      });
      // Also invalidate operations work-requests in case task detail view displays time logs
      await queryClient.invalidateQueries({
        queryKey: ['operations'],
      });
    },
  });
}

/**
 * Update an existing time entry (duration, date, note, or task).
 * Optimistic-with-rollback on the list caches; summaries and operations
 * caches reconcile on settle.
 */
export function useUpdateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: UpdateTimeEntryInput;
    }): Promise<TimeEntry> => {
      const payload: Record<string, unknown> = {};
      if (input.taskId !== undefined) payload.task_id = input.taskId;
      if (input.entryDate !== undefined) payload.entry_date = input.entryDate;
      if (input.durationMinutes !== undefined) payload.duration_minutes = input.durationMinutes;
      if (input.note !== undefined) payload.note = input.note;

      const response = await apiRequest<{ data: RawTimeEntryApi }>(
        `/time-entries/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );

      return mapRawTimeEntry(response.data);
    },
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.timeEntries.all });

      const snapshots = queryClient.getQueriesData<TimeEntry[]>({
        queryKey: dashboardKeys.timeEntries.lists(),
      });

      for (const [key, val] of snapshots) {
        if (!Array.isArray(val)) continue;
        queryClient.setQueryData(
          key,
          val.map((te) =>
            te.id === id
              ? {
                  ...te,
                  ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
                  ...(input.entryDate !== undefined ? { entryDate: input.entryDate } : {}),
                  ...(input.durationMinutes !== undefined
                    ? { durationMinutes: input.durationMinutes }
                    : {}),
                  ...(input.note !== undefined ? { note: input.note } : {}),
                  updatedAt: new Date().toISOString(),
                }
              : te
          )
        );
      }

      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      if (!context) return;
      for (const [key, val] of context.snapshots) {
        queryClient.setQueryData(key, val);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardKeys.timeEntries.all,
      });
      // Also invalidate operations work-requests in case task detail view displays time logs
      await queryClient.invalidateQueries({
        queryKey: ['operations'],
      });
    },
  });
}

/**
 * Delete a time entry.
 * Optimistic-with-rollback: the row vanishes instantly and is restored from
 * the snapshot if the server rejects the delete.
 */
export function useDeleteTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiRequest<void>(`/time-entries/${id}`, {
        method: 'DELETE',
      });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.timeEntries.all });

      const snapshots = queryClient.getQueriesData<TimeEntry[]>({
        queryKey: dashboardKeys.timeEntries.lists(),
      });

      for (const [key, val] of snapshots) {
        if (!Array.isArray(val)) continue;
        queryClient.setQueryData(
          key,
          val.filter((te) => te.id !== id)
        );
      }

      return { snapshots };
    },
    onError: (_err, _id, context) => {
      if (!context) return;
      for (const [key, val] of context.snapshots) {
        queryClient.setQueryData(key, val);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: dashboardKeys.timeEntries.all,
      });
      await queryClient.invalidateQueries({
        queryKey: ['operations'],
      });
    },
  });
}
