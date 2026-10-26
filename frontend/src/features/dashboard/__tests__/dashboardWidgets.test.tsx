import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';
import { LogTimeWidget } from '../components/LogTimeWidget';
import { PendingTasksCard } from '../components/PendingTasksCard';
import DashboardPage from '@/routes/dashboard';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import * as api from '@/lib/api';
import { ApiError } from '@/lib/api';

describe('Dashboard Widgets (LogTimeWidget & DashboardPage)', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
        mutations: { retry: false },
      },
    });
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(BrowserRouter, null, children)
      );
  };

  const sampleTasksResponse = {
    data: [
      {
        id: 'wr-1',
        title: 'Tax Compliance 2026',
        entity_code: 'ATA',
        client_name: 'Acme Corp',
        tasks: [
          {
            id: 'task-assigned-1',
            title: 'Gather BIR Form 2307',
            work_request_id: 'wr-1',
            assignee_id: 'user-worker',
            assignees: ['user-worker'],
            status: 'In Progress',
            phase: 'processing',
          },
          {
            id: 'task-unassigned-2',
            title: 'Financial Statements Audit',
            work_request_id: 'wr-1',
            assignee_id: 'user-other',
            assignees: ['user-other'],
            status: 'In Progress',
            phase: 'processing',
          },
        ],
      },
    ],
  };

  const sampleSummaryResponse = {
    data: {
      date: new Date().toISOString().slice(0, 10),
      total_minutes: 90,
      by_task: [
        {
          task_id: 'task-assigned-1',
          work_request_id: 'wr-1',
          title: 'Gather BIR Form 2307',
          minutes: 90,
        },
      ],
    },
  };

  const sampleEntriesResponse = {
    data: [
      {
        id: 'entry-1',
        user_id: 'user-worker',
        task_id: 'task-assigned-1',
        entry_date: new Date().toISOString().slice(0, 10),
        duration_minutes: 90,
        note: 'Gathered quarterly tax credits',
        created_at: '2026-10-04T08:00:00Z',
        updated_at: '2026-10-04T08:00:00Z',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-worker',
        email: 'dev-docs@ata-lta.ph',
        name: 'Dev Documentation',
        role: 'Manager',
        departments: [],
        entities: ['ATA'],
      },
      permissions: ['timelog:create', 'timelog:view', 'timelog:edit_own', 'notifications:view'],
      unreadCount: 4,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('LogTimeWidget Form & Scoped Task Picker', () => {
    it('renders assigned task picker with scoped tasks only', async () => {
      vi.spyOn(api, 'apiRequest')
        .mockImplementation(async (path: string) => {
          if (path.includes('/operations/work-requests')) {
            return sampleTasksResponse as never;
          }
          if (path.includes('/time-entries/summary')) {
            return sampleSummaryResponse as never;
          }
          if (path.includes('/time-entries')) {
            return sampleEntriesResponse as never;
          }
          return { data: [] } as never;
        });

      render(<LogTimeWidget />, { wrapper: createWrapper() });

      const select = await screen.findByTestId('task-picker-select');
      expect(select).toBeInTheDocument();

      // Assigned tasks must be in the options
      expect(screen.getAllByText(/Gather BIR Form 2307/).length).toBeGreaterThan(0);
      // Unassigned task should NOT be in the options for non-admin user
      expect(screen.queryByText(/Financial Statements Audit/)).not.toBeInTheDocument();
    });

    it('updates duration input when clicking duration quick-chips', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) return sampleTasksResponse as never;
        if (path.includes('/time-entries/summary')) return sampleSummaryResponse as never;
        if (path.includes('/time-entries')) return sampleEntriesResponse as never;
        return { data: [] } as never;
      });

      render(<LogTimeWidget />, { wrapper: createWrapper() });

      const durationInput = (await screen.findByTestId('duration-minutes-input')) as HTMLInputElement;
      expect(durationInput.value).toBe('30');

      // Click 15m preset
      fireEvent.click(screen.getByTestId('duration-chip-15'));
      expect(durationInput.value).toBe('15');

      // Click 60m preset
      fireEvent.click(screen.getByTestId('duration-chip-60'));
      expect(durationInput.value).toBe('60');

      // Click 2h preset
      fireEvent.click(screen.getByTestId('duration-chip-120'));
      expect(durationInput.value).toBe('120');
    });

    it('supports timer toggle to start, count elapsed, and stop & fill duration', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) return sampleTasksResponse as never;
        if (path.includes('/time-entries/summary')) return sampleSummaryResponse as never;
        if (path.includes('/time-entries')) return sampleEntriesResponse as never;
        return { data: [] } as never;
      });

      render(<LogTimeWidget />, { wrapper: createWrapper() });

      // Start timer
      const startBtn = await screen.findByTestId('start-timer-btn');
      fireEvent.click(startBtn);

      // Advance time by 65 seconds
      act(() => {
        vi.advanceTimersByTime(65000);
      });

      // Stop & Fill
      const stopBtn = screen.getByTestId('stop-timer-btn');
      fireEvent.click(stopBtn);

      // 65 seconds records exact 1 minute and 5 seconds
      const durationInput = screen.getByTestId('duration-minutes-input') as HTMLInputElement;
      const secondsInput = screen.getByTestId('duration-seconds-input') as HTMLInputElement;
      expect(durationInput.value).toBe('1');
      expect(secondsInput.value).toBe('5');

      vi.useRealTimers();
    });

    it('submits time entry and surfaces RFC 7807 error verbatim on 403 Forbidden', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string, options?: api.RequestOptions) => {
        if (path.includes('/operations/work-requests')) return sampleTasksResponse as never;
        if (path.includes('/time-entries/summary')) return sampleSummaryResponse as never;
        if (path.includes('/time-entries') && options?.method === 'POST') {
          throw new ApiError(403, 'Forbidden', 'You are not assigned to this task', 'FORBIDDEN');
        }
        if (path.includes('/time-entries')) return sampleEntriesResponse as never;
        return { data: [] } as never;
      });

      render(<LogTimeWidget />, { wrapper: createWrapper() });

      const submitBtn = await screen.findByTestId('submit-timelog-btn');
      await waitFor(() => expect(submitBtn).not.toBeDisabled());
      fireEvent.click(submitBtn);

      await waitFor(() => {
        const errorState = useBlockingModalStore.getState();
        expect(errorState.isOpen).toBe(true);
        expect(errorState.status).toBe('error');
        expect(errorState.error?.code).toBe('FORBIDDEN');
        expect(errorState.error?.detail).toBe('You are not assigned to this task');
      });
    });

    it('renders edit modal on clicking edit entry button', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) return sampleTasksResponse as never;
        if (path.includes('/time-entries/summary')) return sampleSummaryResponse as never;
        if (path.includes('/time-entries')) return sampleEntriesResponse as never;
        return { data: [] } as never;
      });

      render(<LogTimeWidget />, { wrapper: createWrapper() });

      const editBtn = await screen.findByTestId('edit-entry-btn-entry-1');
      fireEvent.click(editBtn);

      expect(screen.getByTestId('time-entry-edit-modal')).toBeInTheDocument();
      expect(screen.getByTestId('edit-duration-input')).toHaveValue(90);
    });

    it('renders delete modal on clicking delete entry button', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) return sampleTasksResponse as never;
        if (path.includes('/time-entries/summary')) return sampleSummaryResponse as never;
        if (path.includes('/time-entries')) return sampleEntriesResponse as never;
        return { data: [] } as never;
      });

      render(<LogTimeWidget />, { wrapper: createWrapper() });

      const deleteBtn = await screen.findByTestId('delete-entry-btn-entry-1');
      fireEvent.click(deleteBtn);

      expect(screen.getByTestId('time-entry-delete-modal')).toBeInTheDocument();
      expect(screen.getByTestId('delete-confirm-btn')).toBeInTheDocument();
    });
  });

  describe('DashboardPage Route Integration', () => {
    it('renders dashboard stat cards, role, entity, unread count, and today logged hours', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) return sampleTasksResponse as never;
        if (path.includes('/time-entries/summary')) return sampleSummaryResponse as never;
        if (path.includes('/time-entries')) return sampleEntriesResponse as never;
        return { data: [] } as never;
      });

      render(<DashboardPage />, { wrapper: createWrapper() });

      expect(screen.getByTestId('dashboard-page')).toBeInTheDocument();
      expect(screen.getByTestId('stat-role')).toHaveTextContent('Manager');
      expect(screen.getByTestId('stat-entity')).toHaveTextContent('ATA');
      expect(screen.getByTestId('stat-unread-count')).toHaveTextContent('4');
      await waitFor(() => {
        expect(screen.getByTestId('stat-today-hours')).toHaveTextContent('1h 30m');
      });
      expect(screen.getByTestId('log-time-widget')).toBeInTheDocument();
      expect(screen.getByTestId('pending-tasks-card')).toBeInTheDocument();
    });
  });

  describe('PendingTasksCard Component (UAT-SH4)', () => {
    beforeEach(() => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-worker',
          email: 'worker@ata-lta.ph',
          name: 'Worker User',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['timelog:create'],
        activeEntity: 'ATA',
      });
    });

    it('renders assigned incomplete work requests with entity and phase badges, and filters out unassigned work requests', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) return sampleTasksResponse as never;
        return { data: [] } as never;
      });

      render(<PendingTasksCard />, { wrapper: createWrapper() });

      expect(screen.getByTestId('pending-tasks-card')).toBeInTheDocument();
      expect(screen.getByText('Assigned Work Requests')).toBeInTheDocument();

      // Assigned Work Request should appear
      const wrItem = await screen.findByTestId('pending-wr-wr-1');
      expect(wrItem).toBeInTheDocument();
      expect(screen.getByText('Tax Compliance 2026')).toBeInTheDocument();
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByTestId('view-wr-btn-wr-1')).toBeInTheDocument();

      // Only Work Request themselves are shown, not separate task cards
      expect(screen.queryByTestId('pending-wr-wr-unassigned')).not.toBeInTheDocument();
    });

    it('renders empty state when there are no incomplete work requests', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return {
            data: [
              {
                id: 'wr-empty',
                title: 'Finished WR',
                status: 'Completed',
                assigned_to: 'user-worker',
                tasks: [
                  {
                    id: 'task-completed-1',
                    title: 'Completed Review',
                    assignee_id: 'user-worker',
                    status: 'Completed',
                  },
                ],
              },
            ],
          } as never;
        }
        return { data: [] } as never;
      });

      render(<PendingTasksCard />, { wrapper: createWrapper() });

      await waitFor(() => {
        expect(screen.getByTestId('pending-tasks-empty')).toBeInTheDocument();
      });
      expect(screen.getByText('All caught up!')).toBeInTheDocument();
      // Completed work request remains visible on the calendar
      expect(screen.getByTestId('pending-wr-wr-empty')).toBeInTheDocument();
    });

    it('color-codes work requests green when completed on/before due date and red when completed beyond due date or overdue', async () => {
      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return {
            data: [
              {
                id: 'wr-completed-ontime',
                title: 'Completed On Time WR',
                assigned_to: 'user-worker',
                status: 'Completed',
                due_date: '2026-10-25',
                updated_at: '2026-10-20T10:00:00.000Z',
                tasks: [],
              },
              {
                id: 'wr-completed-late',
                title: 'Completed Late WR',
                assigned_to: 'user-worker',
                status: 'Completed',
                due_date: '2026-10-15',
                updated_at: '2026-10-20T10:00:00.000Z',
                tasks: [],
              },
              {
                id: 'wr-overdue-incomplete',
                title: 'Overdue Incomplete WR',
                assigned_to: 'user-worker',
                status: 'In Progress',
                due_date: '2020-01-01',
                tasks: [],
              },
              {
                id: 'wr-no-due-date',
                title: 'Unscheduled WR Without Due Date',
                assigned_to: 'user-worker',
                status: 'In Progress',
                due_date: null,
                tasks: [],
              },
            ],
          } as never;
        }
        return { data: [] } as never;
      });

      render(<PendingTasksCard />, { wrapper: createWrapper() });

      const onTimeCard = await screen.findByTestId('pending-wr-wr-completed-ontime');
      const lateCard = await screen.findByTestId('pending-wr-wr-completed-late');
      const overdueCard = await screen.findByTestId('pending-wr-wr-overdue-incomplete');
      const noDueCard = await screen.findByTestId('pending-wr-wr-no-due-date');

      // Completed on/before due date -> Green
      expect(onTimeCard.className).toContain('bg-[#ECFDF5]');
      expect(onTimeCard.className).toContain('border-[#10B981]');

      // Completed beyond specified due date -> Red
      expect(lateCard.className).toContain('bg-[#FFF1F2]');
      expect(lateCard.className).toContain('border-[#F43F5E]');

      // Not marked completed before due date -> Red
      expect(overdueCard.className).toContain('bg-[#FFF1F2]');
      expect(overdueCard.className).toContain('border-[#F43F5E]');

      // Work Request without due date -> Dedicated Violet theme (never Red)
      expect(noDueCard.className).toContain('bg-[#F5F3FF]');
      expect(noDueCard.className).toContain('border-[#8B5CF6]');
      expect(noDueCard.className).not.toContain('bg-[#FFF1F2]');
    });
  });
});

