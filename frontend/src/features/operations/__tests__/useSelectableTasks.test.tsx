import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSessionStore } from '@/lib/session';
import {
  useSelectableTasks,
  formatTaskAssignees,
  isTaskSelectableForRecord,
  isUserAuthorizedForTask,
} from '../hooks/useSelectableTasks';
import type { Task, TaskStatus } from '../api/types';

const WR_ID = '11111111-1111-4111-8111-111111111111';
const USER_ALICE = '22222222-2222-4222-8222-222222222222';
const USER_BOB = '33333333-3333-4333-8333-333333333333';

const mockTeam = [
  { id: USER_ALICE, name: 'Alice Santos', email: 'alice@ata-lta.ph', role: 'Staff' },
  { id: USER_BOB, name: 'Bob Reyes', email: 'bob@ata-lta.ph', role: 'Staff' },
];

vi.mock('../api/useTeam', () => ({
  useTeam: () => ({ data: mockTeam, isLoading: false }),
}));

function createTestTask(
  partial: Partial<Task> & { id: string; title: string; status: TaskStatus; assigneeId: string }
): Task {
  return {
    workRequestId: WR_ID,
    phase: 'pre_processing',
    qaStatus: 'none',
    phaseEnteredAt: null,
    assigneeName: null,
    assignees: [],
    predecessors: [],
    dueDate: null,
    requiredLinkType: null,
    displayOrder: 1,
    version: 1,
    createdAt: '',
    updatedAt: '',
    description: null,
    ...partial,
  };
}

let mockTasks: Task[] = [];
let mockIsLoading = false;
let mockIsFetched = true;

vi.mock('../api/useTasks', () => ({
  useWorkRequestTasks: () => ({
    data: mockTasks,
    isLoading: mockIsLoading,
    isPlaceholderData: false,
    isFetched: mockIsFetched,
  }),
}));

describe('useSelectableTasks hook', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockTasks = [];
    mockIsLoading = false;
    mockIsFetched = true;
    useSessionStore.getState().setSession({
      user: {
        id: USER_ALICE,
        email: 'alice@ata-lta.ph',
        name: 'Alice Santos',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('formats task assignees accurately with lead and co-assignees', () => {
    const task = createTestTask({
      id: 'task-1',
      title: 'Draft Documents',
      status: 'In Progress',
      assigneeId: USER_ALICE,
      assigneeName: 'Alice Santos',
      assignees: [USER_ALICE, USER_BOB],
      taskAssignees: [
        { taskId: 'task-1', userId: USER_BOB, userName: 'Bob Reyes', assignedBy: null, assignedAt: null },
      ],
    });

    const text = formatTaskAssignees(task, mockTeam);
    expect(text).toBe('Alice Santos, Bob Reyes');
  });

  it('prefers assigneeDetails / assignee_details when present without requiring team directory lookup', () => {
    const task = createTestTask({
      id: 'task-details',
      title: 'Enriched Task',
      status: 'In Progress',
      assigneeId: '99999999-9999-4999-8999-999999999991',
      assigneeName: null,
      assignees: [
        '99999999-9999-4999-8999-999999999991',
        '99999999-9999-4999-8999-999999999992',
      ],
      assigneeDetails: [
        {
          userId: '99999999-9999-4999-8999-999999999991',
          userName: 'Juan D.',
          isPrimary: true,
        },
        {
          userId: '99999999-9999-4999-8999-999999999992',
          user_name: 'Maria S.',
          isPrimary: false,
        },
      ],
    });

    const text = formatTaskAssignees(task, []);
    expect(text).toBe('Juan D., Maria S.');
  });

  it('selectability: cancelled tasks are never selectable', () => {
    const cancelledTask = createTestTask({
      id: 't-canc',
      title: 'Cancelled Task',
      status: 'Cancelled',
      assigneeId: USER_ALICE,
      assigneeName: 'Alice',
      assignees: [USER_ALICE],
    });

    expect(isTaskSelectableForRecord(cancelledTask, 'invoice')).toBe(false);
    expect(isTaskSelectableForRecord(cancelledTask, 'disbursement')).toBe(false);
    expect(isTaskSelectableForRecord(cancelledTask, 'transmittal')).toBe(false);
    expect(isTaskSelectableForRecord(cancelledTask, 'document')).toBe(false);
  });

  it('selectability: completed tasks are selectable ONLY for invoices', () => {
    const completedTask = createTestTask({
      id: 't-comp',
      title: 'Completed Task',
      status: 'Completed',
      phase: 'completion',
      qaStatus: 'passed',
      assigneeId: USER_ALICE,
      assigneeName: 'Alice',
      assignees: [USER_ALICE],
    });

    expect(isTaskSelectableForRecord(completedTask, 'invoice')).toBe(true);
    expect(isTaskSelectableForRecord(completedTask, 'disbursement')).toBe(false);
    expect(isTaskSelectableForRecord(completedTask, 'transmittal')).toBe(false);
    expect(isTaskSelectableForRecord(completedTask, 'document')).toBe(false);
  });

  it('on edit: current stored task is always selectable even if completed or cancelled', () => {
    const completedTask = createTestTask({
      id: 't-old',
      title: 'Old Task',
      status: 'Completed',
      phase: 'completion',
      qaStatus: 'passed',
      assigneeId: USER_BOB,
      assigneeName: 'Bob',
      assignees: [USER_BOB],
    });

    expect(isTaskSelectableForRecord(completedTask, 'disbursement', 't-old')).toBe(true);
    expect(
      isUserAuthorizedForTask(
        {
          id: USER_ALICE,
          email: 'alice@ata-lta.ph',
          name: 'Alice',
          role: 'Staff',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        completedTask,
        't-old'
      )
    ).toBe(true);
  });

  it('marks unassigned tasks as disabled with "(Not assigned to you)" for non-Admin', () => {
    mockTasks = [
      createTestTask({
        id: 't-bob',
        title: 'Bobs Task',
        status: 'In Progress',
        assigneeId: USER_BOB,
        assigneeName: 'Bob Reyes',
        assignees: [USER_BOB],
      }),
      createTestTask({
        id: 't-alice',
        title: 'Alices Task',
        status: 'In Progress',
        assigneeId: USER_ALICE,
        assigneeName: 'Alice Santos',
        assignees: [USER_ALICE],
        displayOrder: 2,
      }),
    ];

    const { result } = renderHook(
      () =>
        useSelectableTasks({
          workRequestId: WR_ID,
          recordType: 'disbursement',
        }),
      { wrapper }
    );

    expect(result.current.options).toHaveLength(2);
    const bobOpt = result.current.options.find((o) => o.id === 't-bob');
    const aliceOpt = result.current.options.find((o) => o.id === 't-alice');

    expect(bobOpt?.disabled).toBe(true);
    expect(bobOpt?.label).toContain('Not assigned to you');
    expect(aliceOpt?.disabled).toBe(false);
    expect(aliceOpt?.label).not.toContain('Not assigned to you');
  });

  it('allows Admin to pick any task without "(Not assigned to you)"', () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    mockTasks = [
      createTestTask({
        id: 't-bob',
        title: 'Bobs Task',
        status: 'In Progress',
        assigneeId: USER_BOB,
        assigneeName: 'Bob Reyes',
        assignees: [USER_BOB],
      }),
    ];

    const { result } = renderHook(
      () =>
        useSelectableTasks({
          workRequestId: WR_ID,
          recordType: 'disbursement',
        }),
      { wrapper }
    );

    expect(result.current.options[0]?.disabled).toBe(false);
    expect(result.current.options[0]?.label).not.toContain('Not assigned to you');
    expect(result.current.isNotAssignedBlocked).toBe(false);
  });

  it('triggers blocking state 1 when WR has no candidate tasks', () => {
    mockTasks = [];

    const { result } = renderHook(
      () =>
        useSelectableTasks({
          workRequestId: WR_ID,
          recordType: 'invoice',
        }),
      { wrapper }
    );

    expect(result.current.isNoTasksBlocked).toBe(true);
    expect(result.current.blockingMessage).toBe('This work request has no tasks — create one first');
    expect(result.current.isBlocked).toBe(true);
  });

  it('triggers blocking state 2 when non-Admin is not assigned to any task', () => {
    mockTasks = [
      createTestTask({
        id: 't-bob',
        title: 'Bobs Task',
        status: 'In Progress',
        assigneeId: USER_BOB,
        assigneeName: 'Bob Reyes',
        assignees: [USER_BOB],
      }),
    ];

    const { result } = renderHook(
      () =>
        useSelectableTasks({
          workRequestId: WR_ID,
          recordType: 'invoice',
        }),
      { wrapper }
    );

    expect(result.current.isNoTasksBlocked).toBe(false);
    expect(result.current.isNotAssignedBlocked).toBe(true);
    expect(result.current.blockingMessage).toBe(
      "You're not assigned to any task on this work request. Ask the task owner or an Admin to add you."
    );
    expect(result.current.isBlocked).toBe(true);
  });

  it('auto-selects when exactly one selectable task is available', () => {
    mockTasks = [
      createTestTask({
        id: 't-alice',
        title: 'Alices Task',
        status: 'In Progress',
        assigneeId: USER_ALICE,
        assigneeName: 'Alice Santos',
        assignees: [USER_ALICE],
      }),
    ];

    const onSelectTask = vi.fn();

    renderHook(
      () =>
        useSelectableTasks({
          workRequestId: WR_ID,
          recordType: 'invoice',
          onSelectTask,
        }),
      { wrapper }
    );

    expect(onSelectTask).toHaveBeenCalledWith('t-alice');
  });
});
