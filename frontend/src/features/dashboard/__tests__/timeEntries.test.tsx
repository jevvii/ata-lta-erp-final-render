import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useTimeSummary,
  useTimeEntriesList,
  useCreateTimeEntry,
  useUpdateTimeEntry,
  useDeleteTimeEntry,
} from '../api/useTimeEntries';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';

describe('Time Entries API Hooks & Contract Compliance (time-entries@2.0.0)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useTimeSummary', () => {
    it('fetches daily aggregated summary correctly', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: {
          date: '2026-10-04',
          total_minutes: 180,
          by_task: [
            {
              task_id: 'task-1',
              work_request_id: 'wr-1',
              title: 'Review Tax Returns',
              minutes: 120,
            },
            {
              task_id: 'task-2',
              work_request_id: 'wr-1',
              title: 'Client Correspondence',
              minutes: 60,
            },
          ],
        },
      });

      const { result } = renderHook(() => useTimeSummary('2026-10-04'), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        date: '2026-10-04',
        totalMinutes: 180,
        byTask: [
          {
            taskId: 'task-1',
            workRequestId: 'wr-1',
            title: 'Review Tax Returns',
            minutes: 120,
          },
          {
            taskId: 'task-2',
            workRequestId: 'wr-1',
            title: 'Client Correspondence',
            minutes: 60,
          },
        ],
      });
    });

    it('handles query parameters including userId for admin view', async () => {
      const apiSpy = vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: {
          date: '2026-10-04',
          total_minutes: 60,
          by_task: [],
        },
      });

      const { result } = renderHook(
        () => useTimeSummary('2026-10-04', 'user-worker-1'),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(apiSpy).toHaveBeenCalledWith(
        expect.stringContaining('/time-entries/summary?date=2026-10-04&user_id=user-worker-1')
      );
    });
  });

  describe('useTimeEntriesList', () => {
    it('fetches and maps individual time entries correctly', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: [
          {
            id: 'entry-1',
            user_id: 'user-1',
            user_name: 'Maria Reyes',
            user_role: 'Staff',
            task_id: 'task-1',
            entry_date: '2026-10-04',
            duration_minutes: 45,
            note: 'Morning filing preparation',
            created_at: '2026-10-04T08:30:00Z',
            updated_at: '2026-10-04T08:30:00Z',
          },
        ],
      });

      const { result } = renderHook(() => useTimeEntriesList({ from: '2026-10-04', to: '2026-10-04' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual([
        {
          id: 'entry-1',
          userId: 'user-1',
          userName: 'Maria Reyes',
          userRole: 'Staff',
          taskId: 'task-1',
          entryDate: '2026-10-04',
          durationMinutes: 45,
          note: 'Morning filing preparation',
          createdAt: '2026-10-04T08:30:00Z',
          updatedAt: '2026-10-04T08:30:00Z',
        },
      ]);
    });
  });

  describe('useCreateTimeEntry', () => {
    it('successfully posts a valid time entry and invalidates cache', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: {
          id: 'entry-new',
          user_id: 'user-current',
          task_id: 'task-1',
          entry_date: '2026-10-04',
          duration_minutes: 60,
          note: 'Completed audit checklist',
          created_at: '2026-10-04T10:00:00Z',
          updated_at: '2026-10-04T10:00:00Z',
        },
      });

      const wrapper = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateTimeEntry(), { wrapper });

      const created = await result.current.mutateAsync({
        taskId: 'task-1',
        entryDate: '2026-10-04',
        durationMinutes: 60,
        note: 'Completed audit checklist',
      });

      expect(created.id).toBe('entry-new');
      expect(created.durationMinutes).toBe(60);
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('surfaces 403 Forbidden RFC 7807 error when user is not assigned to task', async () => {
      vi.spyOn(api, 'apiRequest').mockRejectedValueOnce(
        new ApiError(403, 'Forbidden', 'You are not assigned to this task', 'FORBIDDEN')
      );

      const { result } = renderHook(() => useCreateTimeEntry(), {
        wrapper: createWrapper(),
      });

      await expect(
        result.current.mutateAsync({
          taskId: '35048590-9826-44f6-8a56-29243bf94b66',
          entryDate: '2026-10-04',
          durationMinutes: 30,
        })
      ).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
        detail: 'You are not assigned to this task',
      });
    });

    it('surfaces 400 Bad Request RFC 7807 error when duration is invalid', async () => {
      vi.spyOn(api, 'apiRequest').mockRejectedValueOnce(
        new ApiError(400, 'Bad Request', 'duration_minutes cannot exceed 1440', 'VALIDATION_ERROR')
      );

      const { result } = renderHook(() => useCreateTimeEntry(), {
        wrapper: createWrapper(),
      });

      await expect(
        result.current.mutateAsync({
          taskId: 'task-1',
          entryDate: '2026-10-04',
          durationMinutes: 2000,
        })
      ).rejects.toMatchObject({
        status: 400,
        code: 'VALIDATION_ERROR',
        detail: 'duration_minutes cannot exceed 1440',
      });
    });
  });

  describe('useUpdateTimeEntry & useDeleteTimeEntry', () => {
    it('updates entry and invalidates cache', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce({
        data: {
          id: 'entry-1',
          user_id: 'user-1',
          task_id: 'task-1',
          entry_date: '2026-10-04',
          duration_minutes: 90,
          note: 'Updated notes',
          created_at: '2026-10-04T08:30:00Z',
          updated_at: '2026-10-04T09:30:00Z',
        },
      });

      const wrapper = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateTimeEntry(), { wrapper });

      const updated = await result.current.mutateAsync({
        id: 'entry-1',
        input: { durationMinutes: 90, note: 'Updated notes' },
      });

      expect(updated.durationMinutes).toBe(90);
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('deletes entry and invalidates cache', async () => {
      vi.spyOn(api, 'apiRequest').mockResolvedValueOnce(null);

      const wrapper = createWrapper();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useDeleteTimeEntry(), { wrapper });

      await result.current.mutateAsync('entry-1');
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('surfaces 403 when non-admin attempts to edit coworker entry', async () => {
      vi.spyOn(api, 'apiRequest').mockRejectedValueOnce(
        new ApiError(403, 'Forbidden', 'Cannot edit another user time entry without timelog:edit_all', 'FORBIDDEN')
      );

      const { result } = renderHook(() => useUpdateTimeEntry(), {
        wrapper: createWrapper(),
      });

      await expect(
        result.current.mutateAsync({
          id: 'coworker-entry',
          input: { durationMinutes: 45 },
        })
      ).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
        detail: 'Cannot edit another user time entry without timelog:edit_all',
      });
    });
  });
});
