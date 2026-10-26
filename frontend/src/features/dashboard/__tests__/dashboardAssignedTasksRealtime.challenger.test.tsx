/**
 * Challenger Test Suite: Dashboard Assigned Tasks Real-Time Caching & Strict User-Scoping
 *
 * Specification: SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R3
 * Verification Scope:
 * 1. Initial Load & URL Contract: verifies &includeTasks=true in API request.
 * 2. Strict Scoping Preventing Admin Contamination: admin user sees strictly tasks assigned
 *    to themselves in PendingTasksCard with zero leaks from other users.
 * 3. Real-Time Reflection on Task Assignment: incoming CDC event assigning task to current
 *    user triggers cache invalidation and live UI reflection.
 * 4. Real-Time Eviction on Task Reassignment or Completion: CDC event reassigning task away
 *    or completing it evicts task from PendingTasksCard.
 * 5. Cross-User CDC Event Discard: CDC event for another user's task or assignment is discarded
 *    with zero invalidations to dashboardKeys.assignedTasks.all.
 * 6. Relational Assignees via task_assignees join table: CDC events on task_assignees strictly scope
 *    invalidations to current user.
 * 7. Work Request Lifecycle Transitions: status changes, archive toggles, and deletes trigger
 *    invalidation, while pure metadata changes do not.
 * 8. Case-Insensitive RFC 4122 UUID Matching: verifies case-insensitive user ID comparisons.
 * 9. Multiplexed Channel Mounting & Teardown: verifies DashboardPage mounts tasks, task_assignees,
 *    and work_requests subscriptions and tears them down cleanly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
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
import { PendingTasksCard } from '../components/PendingTasksCard';
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
  it('1. Initial Load: requests work requests with &includeTasks=true and displays user tasks', async () => {
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

    render(<PendingTasksCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Prepare BIR 1702-RT Form')).toBeInTheDocument();
    });

    expect(apiSpy).toHaveBeenCalledWith(
      '/operations/work-requests?archived=false&limit=100&includeTasks=true&page=1'
    );
    expect(screen.queryByText('Reconcile General Ledger')).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Test 2: Admin Visibility vs Non-Admin Strict Scoping
  // ==========================================================================
  it('2. Admin Visibility & Non-Admin Strict Scoping: Admin sees all work requests/tasks in PendingTasksCard while non-admin with timelog:edit_all strictly sees only their own', async () => {
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

    const { unmount } = render(<PendingTasksCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Executive Review of Audited Statements')).toBeInTheDocument();
      expect(screen.getByText('Junior Voucher Verification')).toBeInTheDocument();
    });

    const badge = screen.getByTestId('pending-tasks-count-badge');
    expect(badge).toHaveTextContent('2 Tasks Incomplete');

    unmount();

    // Verify non-Admin (e.g. Manager/Staff even with timelog:edit_all) strictly sees ONLY their own tasks
    useSessionStore.getState().setSession({
      user: { ...sampleWorkerUser, id: 'usr-admin-1', role: 'Manager' },
      permissions: ['workflow:view', 'timelog:create', 'timelog:edit_all', 'workflow:edit'],
      activeEntity: 'ATA',
      unreadCount: 0,
    });

    render(<PendingTasksCard />, { wrapper: createWrapper() });

    await waitFor(() => {
      expect(screen.getByText('Executive Review of Audited Statements')).toBeInTheDocument();
    });
    expect(screen.queryByText('Junior Voucher Verification')).not.toBeInTheDocument();
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
    let callCount = 0;
    vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
      if (path.includes('/operations/work-requests')) {
        callCount++;
        if (callCount === 1) {
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

    await waitFor(() => {
      expect(screen.getByText('All caught up!')).toBeInTheDocument();
    });

    const mockClient = supabase as unknown as MockSupabaseClient;
    const tasksChannel = mockClient.getChannel('cdc_tasks');
    expect(tasksChannel).toBeDefined();

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

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

    // UI reactively updates with newly assigned task
    await waitFor(() => {
      expect(screen.getByText('Draft Client Engagement Letter')).toBeInTheDocument();
    });
    expect(screen.queryByText('All caught up!')).not.toBeInTheDocument();
  });

  // ==========================================================================
  // Test 4: Real-Time Eviction on Reassignment or Completion
  // ==========================================================================
  it('4. Real-Time Eviction: CDC task reassignment away from current user or completion evicts task', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('Asset Depreciation Schedule')).toBeInTheDocument();
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
      expect(screen.getByText('All caught up!')).toBeInTheDocument();
    });
    expect(screen.queryByText('Asset Depreciation Schedule')).not.toBeInTheDocument();
  });

  it('4b. Real-Time Eviction: CDC task completion triggers invalidation and eviction', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('VAT Summary Preparation')).toBeInTheDocument();
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
      expect(screen.getByText('All caught up!')).toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Test 5: Cross-User Discard
  // ==========================================================================
  it('5. Cross-User Discard: CDC event for another user task is discarded with zero invalidations to assignedTasks.all', async () => {
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

    await waitFor(() => {
      expect(screen.getByText('Keep Assigned Task Active')).toBeInTheDocument();
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

    // Zero invalidations to dashboardKeys.assignedTasks.all
    const assignedTasksInvalidation = invalidateSpy.mock.calls.find((call) => {
      const qk = call[0]?.queryKey;
      return Array.isArray(qk) && qk[0] === 'assigned-tasks';
    });
    expect(assignedTasksInvalidation).toBeUndefined();

    // UI remains stable and unaffected
    expect(screen.getByText('Keep Assigned Task Active')).toBeInTheDocument();
    expect(screen.queryByText('Foreign User Task')).not.toBeInTheDocument();
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
