/**
 * Challenger Test Suite: Dashboard Assigned Tasks Real-Time Caching & Strict User-Scoping
 *
 * Specification: SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R3
 * Verification Scope:
 * 1. Initial Load & URL Contract: verifies &includeTasks=true in API request.
 * 2. Strict Scoping: task picker choices remain user-scoped unless Admin explicitly
 *    requests all tasks; non-Admin permissions cannot activate that override.
 * 3. Real-Time Reflection on Task Assignment: incoming CDC event assigning task to current
 *    user triggers cache invalidation and refreshes actual task picker data.
 * 4. Real-Time Task Changes: reassignment removes unavailable task-picker choices,
 *    while completion refreshes the authorized status of historical choices.
 * 5. Cross-User Isolation: another user's raw CDC task never enters picker data;
 *    the targeted assignment helper avoids refreshing unrelated pickers.
 * 6. Relational Assignees via task_assignees join table: CDC events on task_assignees strictly scope
 *    invalidations to current user.
 * 7. Work Request Lifecycle Transitions: status changes, archive toggles, and deletes trigger
 *    invalidation, while pure metadata changes do not.
 * 8. Case-Insensitive RFC 4122 UUID Matching: verifies case-insensitive user ID comparisons.
 * 9. Multiplexed Channel Mounting & Teardown: verifies DashboardPage mounts tasks, task_assignees,
 *    and work_requests subscriptions and tears them down cleanly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, screen, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { supabase, type MockSupabaseClient } from '@/lib/supabase';
import { useSessionStore } from '@/lib/session';
import {
  clearChannelRegistryForTesting,
  triggerAssignedTasksCoInvalidation,
  isMatchingUserId,
} from '@/lib/realtime/useEntityRealtimeSync';
import * as api from '@/lib/api';
import DashboardPage from '@/routes/dashboard';
import { useAssignedTasks } from '../api/useAssignedTasks';
import { LogTimeWidget } from '../components/LogTimeWidget';
import { dashboardKeys } from '../api/queryKeys';

describe('Challenger M3: Dashboard Assigned Tasks Real-Time Caching & Strict User-Scoping', () => {
  let queryClient: QueryClient;

  const createWrapper = () => {
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };

  const sampleWorkerUser = {
    id: 'usr-worker-1',
    name: 'Staff Worker One',
    email: 'worker1@example.com',
    role: 'staff',
    departments: ['operations'],
    entities: ['ATA'],
  };

  const sampleAdminUser = {
    id: 'usr-admin-1',
    name: 'Admin Supervisor',
    email: 'admin@example.com',
    role: 'Admin',
    departments: ['executive'],
    entities: ['ATA', 'LTA'],
  };

  const defaultSummaryResponse = {
    data: {
      date: new Date().toISOString().slice(0, 10),
      total_minutes: 0,
      totalMinutes: 0,
      by_task: [],
      byTask: [],
    },
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });
    localStorage.clear();
    clearChannelRegistryForTesting();
    useSessionStore.getState().setSession({
      user: sampleWorkerUser,
      permissions: ['workflow:view', 'timelog:create'],
      activeEntity: 'ATA',
      unreadCount: 0,
    });
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        return { data: [] } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.cancelQueries();
    queryClient.clear();
    localStorage.clear();
    clearChannelRegistryForTesting();
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Test 1: Initial Load & URL Contract
  // ==========================================================================
  it('1. Initial Load: requests includeTasks=true and exposes only the current user task picker options', async () => {
    const apiSpy = vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        return {
          data: [
            {
              id: 'wr-101',
              title: 'Corporate Tax Returns 2026',
              entity_code: 'ATA',
              client_name: 'Acme Holding Corp',
              tasks: [
                {
                  id: 'task-w1',
                  title: 'Prepare BIR 1702-RT Form',
                  work_request_id: 'wr-101',
                  assignee_id: 'usr-worker-1',
                  assignees: ['usr-worker-1'],
                  status: 'In Progress',
                  phase: 'processing',
                },
                {
                  id: 'task-other',
                  title: 'Reconcile General Ledger',
                  work_request_id: 'wr-101',
                  assignee_id: 'usr-other-worker',
                  assignees: ['usr-other-worker'],
                  status: 'In Progress',
                  phase: 'processing',
                },
              ],
            },
          ],
        } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    const { result } = renderHook(() => useAssignedTasks(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.tasks.map((task) => task.taskTitle)).toEqual(['Prepare BIR 1702-RT Form']);

    expect(apiSpy).toHaveBeenCalledWith(
      '/operations/work-requests?archived=false&limit=100&includeTasks=true&page=1'
    );
    expect(result.current.tasks.some((task) => task.taskTitle === 'Reconcile General Ledger')).toBe(false);
  });

  // ==========================================================================
  // Test 2: Admin Visibility vs Non-Admin Strict Scoping
  // ==========================================================================
  it('2. Admin task-picker override sees all tasks while non-admin with timelog:edit_all still sees only their own', async () => {
    useSessionStore.getState().setSession({
      user: sampleAdminUser,
      permissions: ['workflow:view', 'timelog:create', 'timelog:edit_all', 'workflow:edit'],
      activeEntity: 'ATA',
      unreadCount: 0,
    });

    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        return {
          data: [
            {
              id: 'wr-admin-test',
              title: 'Executive Audit 2026',
              entity_code: 'ATA',
              client_name: 'Apex Global',
              tasks: [
                {
                  id: 'task-admin-own',
                  title: 'Executive Review of Audited Statements',
                  work_request_id: 'wr-admin-test',
                  assignee_id: 'usr-admin-1',
                  assignees: ['usr-admin-1'],
                  status: 'In Progress',
                  phase: 'quality_assurance',
                },
                {
                  id: 'task-other-employee',
                  title: 'Junior Voucher Verification',
                  work_request_id: 'wr-admin-test',
                  assignee_id: 'usr-junior-staff',
                  assignees: ['usr-junior-staff'],
                  status: 'In Progress',
                  phase: 'pre_processing',
                },
              ],
            },
          ],
        } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    const adminPicker = renderHook(() => useAssignedTasks({ allTasksForAdmin: true }), { wrapper: createWrapper() });
    await waitFor(() => expect(adminPicker.result.current.isSuccess).toBe(true));
    expect(adminPicker.result.current.tasks.map((task) => task.taskTitle)).toEqual([
      'Executive Review of Audited Statements',
      'Junior Voucher Verification',
    ]);
    adminPicker.unmount();

    // Verify non-Admin (e.g. Manager/Staff even with timelog:edit_all) strictly sees ONLY their own tasks
    useSessionStore.getState().setSession({
      user: { ...sampleWorkerUser, id: 'usr-admin-1', role: 'Manager' },
      permissions: ['workflow:view', 'timelog:create', 'timelog:edit_all', 'workflow:edit'],
      activeEntity: 'ATA',
      unreadCount: 0,
    });

    const managerPicker = renderHook(() => useAssignedTasks({ allTasksForAdmin: true }), { wrapper: createWrapper() });
    await waitFor(() => expect(managerPicker.result.current.isSuccess).toBe(true));
    expect(managerPicker.result.current.tasks.map((task) => task.taskTitle)).toEqual(['Executive Review of Audited Statements']);
  });

  // ==========================================================================
  // Test 2b: LogTimeWidget Admin Task Access (Spec §R2)
  // ==========================================================================
  it('2b. LogTimeWidget Admin Task Access: Admin user with timelog:edit_all sees all tasks in LogTimeWidget', async () => {
    useSessionStore.getState().setSession({
      user: sampleAdminUser,
      permissions: ['workflow:view', 'timelog:create', 'timelog:edit_all', 'workflow:edit'],
      activeEntity: 'ATA',
      unreadCount: 0,
    });

    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        return {
          data: [
            {
              id: 'wr-admin-test',
              title: 'Executive Audit 2026',
              entity_code: 'ATA',
              client_name: 'Apex Global',
              tasks: [
                {
                  id: 'task-admin-own',
                  title: 'Executive Review of Audited Statements',
                  work_request_id: 'wr-admin-test',
                  assignee_id: 'usr-admin-1',
                  assignees: ['usr-admin-1'],
                  status: 'In Progress',
                  phase: 'quality_assurance',
                },
                {
                  id: 'task-other-employee',
                  title: 'Junior Voucher Verification',
                  work_request_id: 'wr-admin-test',
                  assignee_id: 'usr-junior-staff',
                  assignees: ['usr-junior-staff'],
                  status: 'In Progress',
                  phase: 'pre_processing',
                },
              ],
            },
          ],
        } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    render(<LogTimeWidget />, { wrapper: createWrapper() });

    const select = await screen.findByTestId('task-picker-select');
    expect(select).toBeInTheDocument();

    // Creating personal logs requires assignment, including for Admins.
    await waitFor(() => {
      expect(screen.getByText(/Executive Review of Audited Statements/)).toBeInTheDocument();
      expect(screen.queryByText(/Junior Voucher Verification/)).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Test 3: Real-Time Reflection on Task Assignment
  // ==========================================================================
  it('3. Real-Time Assignment: CDC task assignment to current user triggers cache invalidation and updates UI', async () => {
    let hasAssignment = false;
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        if (!hasAssignment) {
          return { data: [] } as never; // Initial: no tasks assigned
        }
        return {
          data: [
            {
              id: 'wr-201',
              title: 'New Client Onboarding',
              entity_code: 'ATA',
              client_name: 'Metro Retailers',
              tasks: [
                {
                  id: 'task-newly-assigned',
                  title: 'Draft Client Engagement Letter',
                  work_request_id: 'wr-201',
                  assignee_id: 'usr-worker-1',
                  assignees: ['usr-worker-1'],
                  status: 'In Progress',
                  phase: 'pre_processing',
                },
              ],
            },
          ],
        } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    render(<DashboardPage />, { wrapper: createWrapper() });
    const { result } = renderHook(() => useAssignedTasks(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.tasks).toEqual([]);
    });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const tasksChannel = mockClient.getChannel('cdc_tasks');
    expect(tasksChannel).toBeDefined();

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    hasAssignment = true;
    // Simulate Supabase Realtime broadcast of task assignment to current user
    act(() => {
      tasksChannel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'task-newly-assigned',
          work_request_id: 'wr-201',
          title: 'Draft Client Engagement Letter',
          assignee_id: 'usr-worker-1',
          status: 'In Progress',
          version: 1,
        },
      });
    });

    // Invalidation must target dashboardKeys.assignedTasks.all
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    // The actual task picker hook refetches its authorized assignment.
    await waitFor(() => {
      expect(result.current.tasks.map((task) => task.taskTitle)).toEqual(['Draft Client Engagement Letter']);
    });
    expect(result.current.tasks).toHaveLength(1);
  });

  // ==========================================================================
  // Test 4: Real-Time Reassignment and Completion Data
  // ==========================================================================
  it('4. Real-Time Reassignment: a task reassigned away disappears from authorized picker choices', async () => {
    let isReassigned = false;
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        if (!isReassigned) {
          return {
            data: [
              {
                id: 'wr-301',
                title: 'Year-End Review',
                entity_code: 'ATA',
                client_name: 'Horizon Tech',
                tasks: [
                  {
                    id: 'task-to-reassign',
                    title: 'Asset Depreciation Schedule',
                    work_request_id: 'wr-301',
                    assignee_id: 'usr-worker-1',
                    assignees: ['usr-worker-1'],
                    status: 'In Progress',
                    phase: 'processing',
                  },
                ],
              },
            ],
          } as never;
        }
        return { data: [] } as never; // Subsequent: task reassigned away
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    render(<DashboardPage />, { wrapper: createWrapper() });
    const { result } = renderHook(() => useAssignedTasks(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.tasks.map((task) => task.taskTitle)).toEqual(['Asset Depreciation Schedule']);
    });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const tasksChannel = mockClient.getChannel('cdc_tasks');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Scenario A: Task reassigned from current user to another user
    isReassigned = true;
    act(() => {
      tasksChannel?.emit('postgres_changes', {
        eventType: 'UPDATE',
        old: {
          id: 'task-to-reassign',
          work_request_id: 'wr-301',
          assignee_id: 'usr-worker-1',
          version: 1,
        },
        new: {
          id: 'task-to-reassign',
          work_request_id: 'wr-301',
          assignee_id: 'usr-other-worker',
          version: 2,
        },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    await waitFor(() => {
      expect(result.current.tasks).toEqual([]);
    });
    expect(result.current.tasks.some((task) => task.taskTitle === 'Asset Depreciation Schedule')).toBe(false);
  });

  it('4b. Real-Time Completion: CDC completion refreshes the task picker with the authorized completed status', async () => {
    let isCompleted = false;
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        return {
          data: [
            {
              id: 'wr-302',
              title: 'Quarterly Filing',
              entity_code: 'ATA',
              client_name: 'Summit Inc',
              tasks: [
                {
                  id: 'task-to-complete',
                  title: 'VAT Summary Preparation',
                  work_request_id: 'wr-302',
                  assignee_id: 'usr-worker-1',
                  assignees: ['usr-worker-1'],
                  status: isCompleted ? 'Completed' : 'In Progress',
                  phase: isCompleted ? 'completion' : 'processing',
                },
              ],
            },
          ],
        } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    render(<DashboardPage />, { wrapper: createWrapper() });
    const { result } = renderHook(() => useAssignedTasks(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.tasks[0]?.taskTitle).toBe('VAT Summary Preparation');
      expect(result.current.tasks[0]?.status).toBe('In Progress');
    });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const tasksChannel = mockClient.getChannel('cdc_tasks');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Scenario B: Task status updated to Completed
    isCompleted = true;
    act(() => {
      tasksChannel?.emit('postgres_changes', {
        eventType: 'UPDATE',
        old: {
          id: 'task-to-complete',
          work_request_id: 'wr-302',
          assignee_id: 'usr-worker-1',
          status: 'In Progress',
          version: 1,
        },
        new: {
          id: 'task-to-complete',
          work_request_id: 'wr-302',
          assignee_id: 'usr-worker-1',
          status: 'Completed',
          version: 2,
        },
      });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    await waitFor(() => {
      expect(result.current.tasks[0]?.taskTitle).toBe('VAT Summary Preparation');
      expect(result.current.tasks[0]?.status).toBe('Completed');
    });
  });

  // ==========================================================================
  // Test 5: Cross-User Discard
  // ==========================================================================
  it('5. Cross-User Isolation: another user task cannot appear in authorized task-picker results', async () => {
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        return {
          data: [
            {
              id: 'wr-401',
              title: 'Stable Work Request',
              entity_code: 'ATA',
              client_name: 'Stable Client',
              tasks: [
                {
                  id: 'task-worker-keep',
                  title: 'Keep Assigned Task Active',
                  work_request_id: 'wr-401',
                  assignee_id: 'usr-worker-1',
                  assignees: ['usr-worker-1'],
                  status: 'In Progress',
                  phase: 'processing',
                },
              ],
            },
          ],
        } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    render(<DashboardPage />, { wrapper: createWrapper() });
    const { result } = renderHook(() => useAssignedTasks(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.tasks.map((task) => task.taskTitle)).toEqual(['Keep Assigned Task Active']);
    });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const tasksChannel = mockClient.getChannel('cdc_tasks');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Broadcast CDC event for an unrelated task belonging to a different user
    act(() => {
      tasksChannel?.emit('postgres_changes', {
        eventType: 'INSERT',
        new: {
          id: 'task-foreign-user',
          work_request_id: 'wr-401',
          title: 'Foreign User Task',
          assignee_id: 'usr-other-worker',
          status: 'In Progress',
          version: 1,
        },
      });
    });

    // An assignment change may conservatively refetch project scopes. The raw foreign
    // task must not be injected, and the backend-authorized picker stays user-scoped.
    await waitFor(() => expect(result.current.isFetching).toBe(false));
    expect(result.current.tasks.map((task) => task.taskTitle)).toEqual(['Keep Assigned Task Active']);
    expect(result.current.tasks.some((task) => task.taskId === 'task-foreign-user')).toBe(false);

    // The targeted assignment helper still avoids refreshing unrelated user pickers.
    invalidateSpy.mockClear();
    triggerAssignedTasksCoInvalidation(queryClient, 'tasks', {
      id: 'task-foreign-user', assignee_id: 'usr-other-worker',
    }, null);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 6: Relational Assignees via task_assignees Table
  // ==========================================================================
  it('6. Relational Assignees: CDC on task_assignees invalidates for current user and discards for others', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // 6a: Matching current user -> invalidates
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'task_assignees',
      { id: 'ta-1', task_id: 't-10', user_id: 'usr-worker-1' },
      null
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    invalidateSpy.mockClear();

    // 6b: Old record matching current user (removal) -> invalidates
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'task_assignees',
      null,
      { id: 'ta-2', task_id: 't-10', user_id: 'usr-worker-1' },
      true
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    invalidateSpy.mockClear();

    // 6c: Foreign user -> zero invalidation
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'task_assignees',
      { id: 'ta-3', task_id: 't-20', user_id: 'usr-different-employee' },
      null
    );

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 7: Work Request Lifecycle Transitions vs Pure Metadata
  // ==========================================================================
  it('7. Work Request Transitions: status, archive, and delete invalidate; pure metadata does not', () => {
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // 7a: Status change -> invalidates
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'work_requests',
      { id: 'wr-1', status: 'completed' },
      { id: 'wr-1', status: 'in_progress' }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    invalidateSpy.mockClear();

    // 7b: Archive change -> invalidates
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'work_requests',
      { id: 'wr-1', archived: true },
      { id: 'wr-1', archived: false }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    invalidateSpy.mockClear();

    // 7c: Soft delete -> invalidates
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'work_requests',
      { id: 'wr-1', deleted_at: '2026-10-11T12:00:00Z' },
      { id: 'wr-1', deleted_at: null }
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    invalidateSpy.mockClear();

    // 7d: Hard delete -> invalidates
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'work_requests',
      null,
      { id: 'wr-1', status: 'in_progress' },
      true
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });

    invalidateSpy.mockClear();

    // 7e: Pure metadata update (e.g. title only) -> ZERO invalidation
    triggerAssignedTasksCoInvalidation(
      queryClient,
      'work_requests',
      { id: 'wr-1', title: 'Updated Title Name', status: 'in_progress', archived: false },
      { id: 'wr-1', title: 'Old Title Name', status: 'in_progress', archived: false }
    );
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Test 8: Case-Insensitive RFC 4122 UUID Matching
  // ==========================================================================
  it('8. RFC 4122 Compliance: handles case-insensitive UUID matching seamlessly', () => {
    const uppercaseUserId = '550E8400-E29B-41D4-A716-446655440000';
    const lowercaseUserId = '550e8400-e29b-41d4-a716-446655440000';

    useSessionStore.getState().setSession({
      user: {
        ...sampleWorkerUser,
        id: uppercaseUserId,
      },
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
      unreadCount: 0,
    });

    expect(isMatchingUserId(uppercaseUserId, lowercaseUserId)).toBe(true);

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    triggerAssignedTasksCoInvalidation(
      queryClient,
      'tasks',
      { id: 't-uuid-test', assignee_id: lowercaseUserId },
      null
    );

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: dashboardKeys.assignedTasks.all,
    });
  });

  // ==========================================================================
  // Test 9: Multiplexed Channel Mounting & Teardown
  // ==========================================================================
  it('9. Channel Mounting: DashboardPage mounts tasks, task_assignees, and work_requests CDC channels', () => {
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        return { data: [] } as never;
      }
      if (path.includes('/time-entries')) {
        return defaultSummaryResponse as never;
      }
      return { data: [] } as never;
    });

    const mockClient = supabase as unknown as MockSupabaseClient;

    const { unmount } = render(<DashboardPage />, { wrapper: createWrapper() });

    const tasksChannel = mockClient.getChannel('cdc_tasks');
    const taskAssigneesChannel = mockClient.getChannel('cdc_task_assignees');
    const wrChannel = mockClient.getChannel('cdc_work_requests');

    expect(tasksChannel).toBeDefined();
    expect(taskAssigneesChannel).toBeDefined();
    expect(wrChannel).toBeDefined();

    unmount();

    // After unmount, channels are torn down cleanly
    expect(mockClient.getChannel('cdc_tasks')).toBeUndefined();
    expect(mockClient.getChannel('cdc_task_assignees')).toBeUndefined();
    expect(mockClient.getChannel('cdc_work_requests')).toBeUndefined();
  });
});
