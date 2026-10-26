import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useSessionStore } from '@/lib/session';
import { operationsKeys } from '../api/queryKeys';
import {
  isRecordOwnedByTask,
  isTransmittalOwnedByTask,
  filterTaskRelatedRecords,
} from '../lib/taskScope';
import { useTaskRelated } from '../api/useTasks';
import { TaskDetailModal } from '../components/TaskDetailModal';
import type { Task, WorkRequest, TaskRelatedRecords, DmsDocument } from '../api/types';

// ============================================================================
// Fixtures
// ============================================================================

const mockTask1: Task = {
  id: 'task-1',
  workRequestId: 'wr-shared-1',
  title: 'Task 1 - Initial Preparation',
  description: 'First sibling task',
  status: 'In Progress',
  phase: 'processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  assigneeId: 'user-emp-1',
  assigneeName: 'Elena Santos',
  assignees: ['user-emp-1'],
  taskAssignees: [
    {
      taskId: 'task-1',
      userId: 'user-emp-1',
      assignedBy: null,
      assignedAt: null,
      userName: 'Elena Santos',
    },
  ],
  predecessors: [],
  dueDate: '2026-04-15T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

const mockTask3: Task = {
  id: 'task-3',
  workRequestId: 'wr-shared-1',
  title: 'Task 3 - Final Filing',
  description: 'Third sibling task in same work request',
  status: 'In Progress',
  phase: 'processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  assigneeId: 'user-emp-1',
  assigneeName: 'Elena Santos',
  assignees: ['user-emp-1'],
  taskAssignees: [
    {
      taskId: 'task-3',
      userId: 'user-emp-1',
      assignedBy: null,
      assignedAt: null,
      userName: 'Elena Santos',
    },
  ],
  predecessors: [],
  dueDate: '2026-04-20T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 3,
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

const mockWorkRequest: WorkRequest = {
  id: 'wr-shared-1',
  title: 'Corporate Compliance Filing',
  description: 'Parent work request shared by Task 1 and Task 3',
  entity: 'ATA',
  clientId: 'client-corp-1',
  clientName: 'Philippine Horizon Holdings',
  phase: 'processing',
  status: 'In Progress',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  dueDate: '2026-04-30T00:00:00Z',
  requestedBy: 'user-emp-1',
  assignedTo: 'user-emp-1',
  assignedToName: 'Elena Santos',
  coAssignees: [],
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  tasks: [mockTask1, mockTask3],
};

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

describe('Cross-Task Document Isolation & Scoping Specification (AGY-20261024)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession({
      user: {
        id: 'user-emp-1',
        email: 'elena@ata-lta.ph',
        name: 'Elena Santos',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'timelog:create',
        'billing:create',
        'billing:edit',
        'disbursement:create',
        'disbursement:edit',
        'transmittal:create',
        'transmittal:edit',
      ],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    cleanup();
  });

  // ==========================================================================
  // 1. Ownership & Defensive Scoping Unit Tests
  // ==========================================================================
  describe('Unit Rules: isRecordOwnedByTask, isTransmittalOwnedByTask, filterTaskRelatedRecords', () => {
    it('1.1 canonical task_id / taskId is canonical for invoices and disbursements', () => {
      // Matching canonical task_id
      expect(isRecordOwnedByTask({ task_id: 'task-1' }, 'task-1')).toBe(true);
      expect(isRecordOwnedByTask({ taskId: 'task-1' }, 'task-1')).toBe(true);
      expect(isRecordOwnedByTask({ task_id: 'task-1' }, 'task-3')).toBe(false);

      // Canonical takes precedence even if linked_task_id has a different value
      expect(isRecordOwnedByTask({ task_id: 'task-1', linked_task_id: 'task-3' }, 'task-1')).toBe(true);
      expect(isRecordOwnedByTask({ task_id: 'task-1', linked_task_id: 'task-3' }, 'task-3')).toBe(false);
      expect(isRecordOwnedByTask({ taskId: 'task-1', linkedTaskId: 'task-3' }, 'task-3')).toBe(false);
    });

    it('1.2 legacy linked_task_id / linkedTaskId is used ONLY when canonical is null/missing (not empty string)', () => {
      // Null canonical falls back to legacy
      expect(isRecordOwnedByTask({ task_id: null, linked_task_id: 'task-3' }, 'task-3')).toBe(true);
      expect(isRecordOwnedByTask({ taskId: null, linkedTaskId: 'task-3' }, 'task-3')).toBe(true);
      expect(isRecordOwnedByTask({ linked_task_id: 'task-3' }, 'task-3')).toBe(true);
      expect(isRecordOwnedByTask({ linkedTaskId: 'task-3' }, 'task-3')).toBe(true);

      // Empty string canonical is malformed and fails closed: it must NOT fall back to legacy
      expect(isRecordOwnedByTask({ task_id: '', linked_task_id: 'task-3' }, 'task-3')).toBe(false);
      expect(isRecordOwnedByTask({ taskId: '', linkedTaskId: 'task-3' }, 'task-3')).toBe(false);
    });

    it('1.3 missing task ownership fails closed (parent-only records are excluded)', () => {
      // Both null
      expect(isRecordOwnedByTask({ task_id: null, linked_task_id: null }, 'task-1')).toBe(false);
      expect(isRecordOwnedByTask({ taskId: undefined, linkedTaskId: undefined }, 'task-3')).toBe(false);
      // Empty record / null record
      expect(isRecordOwnedByTask({}, 'task-1')).toBe(false);
      expect(isRecordOwnedByTask(null, 'task-1')).toBe(false);
      expect(isRecordOwnedByTask({ task_id: 'task-1' }, null)).toBe(false);
    });

    it('1.4 transmittals use linked_task_id / linkedTaskId only (negative test for task_id only)', () => {
      expect(isTransmittalOwnedByTask({ linked_task_id: 'task-3' }, 'task-3')).toBe(true);
      expect(isTransmittalOwnedByTask({ linkedTaskId: 'task-3' }, 'task-3')).toBe(true);
      expect(isTransmittalOwnedByTask({ linked_task_id: 'task-1' }, 'task-3')).toBe(false);

      // Negative test per coordinator review: transmittals with only task_id/taskId MUST return false (no fallback path)
      expect(
        isTransmittalOwnedByTask(
          { task_id: 'task-3' } as unknown as { linked_task_id?: string },
          'task-3'
        )
      ).toBe(false);
      expect(
        isTransmittalOwnedByTask(
          { taskId: 'task-3' } as unknown as { linkedTaskId?: string },
          'task-3'
        )
      ).toBe(false);

      // Parent-only transmittal (null linked_task_id) fails closed
      expect(isTransmittalOwnedByTask({ linked_task_id: null }, 'task-3')).toBe(false);
      expect(isTransmittalOwnedByTask({}, 'task-3')).toBe(false);
      expect(isTransmittalOwnedByTask(null, 'task-3')).toBe(false);
    });

    it('1.5 filterTaskRelatedRecords defensive scoping against mixed server responses', () => {
      const mixedPayload: TaskRelatedRecords = {
        invoices: [
          { id: 'inv-task-1', task_id: 'task-1', invoice_number: 'INV-001', amount: 1000 },
          { id: 'inv-task-3', task_id: 'task-3', invoice_number: 'INV-003', amount: 3000 },
          { id: 'inv-task-3-legacy', linked_task_id: 'task-3', invoice_number: 'INV-003-LEGACY', amount: 3500 },
          { id: 'inv-conflict', task_id: 'task-1', linked_task_id: 'task-3', invoice_number: 'INV-CONFLICT', amount: 9999 },
          { id: 'inv-parent-only', task_id: null, linked_task_id: null, invoice_number: 'INV-PARENT', amount: 500 },
        ],
        disbursements: [
          { id: 'disb-task-1', task_id: 'task-1', category: 'Filing', amount: 200 },
          { id: 'disb-task-3', task_id: 'task-3', category: 'Courier', amount: 400 },
          { id: 'disb-parent-only', task_id: null, linked_task_id: null, category: 'General', amount: 100 },
          { id: 'disb-conflict', taskId: 'task-1', linkedTaskId: 'task-3', category: 'Conflict', amount: 800 },
        ],
        transmittals: [
          { id: 'tx-task-1', linked_task_id: 'task-1', tracking_number: 'TR-001' },
          { id: 'tx-task-3', linked_task_id: 'task-3', tracking_number: 'TR-003' },
          { id: 'tx-parent-only', linked_task_id: null, tracking_number: 'TR-PARENT' },
        ],
      };

      // Filter for Task #3
      const scopedForTask3 = filterTaskRelatedRecords(mixedPayload, 'task-3');
      expect(scopedForTask3.invoices.map((i) => i.id)).toEqual(['inv-task-3', 'inv-task-3-legacy']);
      expect(scopedForTask3.disbursements.map((d) => d.id)).toEqual(['disb-task-3']);
      expect(scopedForTask3.transmittals.map((t) => t.id)).toEqual(['tx-task-3']);

      // Filter for Task #1
      const scopedForTask1 = filterTaskRelatedRecords(mixedPayload, 'task-1');
      expect(scopedForTask1.invoices.map((i) => i.id)).toEqual(['inv-task-1', 'inv-conflict']);
      expect(scopedForTask1.disbursements.map((d) => d.id)).toEqual(['disb-task-1', 'disb-conflict']);
      expect(scopedForTask1.transmittals.map((t) => t.id)).toEqual(['tx-task-1']);

      // Empty task (e.g. Task #5)
      const scopedForEmpty = filterTaskRelatedRecords(mixedPayload, 'task-empty-5');
      expect(scopedForEmpty.invoices).toEqual([]);
      expect(scopedForEmpty.disbursements).toEqual([]);
      expect(scopedForEmpty.transmittals).toEqual([]);
    });
  });

  // ==========================================================================
  // 2. Query Hook Behavioral Tests (useTaskRelated)
  // ==========================================================================
  describe('Hook Integration: useTaskRelated', () => {
    it('2.1 scopes server response to requested task via select transform', async () => {
      const { wrapper } = createTestHarness();

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/tasks/task-3/related')) {
          return new Response(
            JSON.stringify({
              data: {
                invoices: [
                  { id: 'inv-1', task_id: 'task-1', invoice_number: 'INV-1' },
                  { id: 'inv-3', task_id: 'task-3', invoice_number: 'INV-3' },
                  { id: 'inv-parent', task_id: null, linked_task_id: null },
                ],
                disbursements: [
                  { id: 'disb-1', task_id: 'task-1', category: 'Task 1 Fee' },
                  { id: 'disb-3', task_id: 'task-3', category: 'Task 3 Fee' },
                ],
                transmittals: [
                  { id: 'tx-1', linked_task_id: 'task-1', tracking_number: 'TX-1' },
                  { id: 'tx-3', linked_task_id: 'task-3', tracking_number: 'TX-3' },
                ],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const { result } = renderHook(() => useTaskRelated('task-3'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.invoices).toHaveLength(1);
      expect(result.current.data?.invoices[0]?.id).toBe('inv-3');
      expect(result.current.data?.disbursements).toHaveLength(1);
      expect(result.current.data?.disbursements[0]?.id).toBe('disb-3');
      expect(result.current.data?.transmittals).toHaveLength(1);
      expect(result.current.data?.transmittals[0]?.id).toBe('tx-3');
    });

    it('2.2 queryKey incorporates activeEntity for cache differentiation and invalidation', async () => {
      const { wrapper } = createTestHarness();

      useSessionStore.getState().setActiveEntity('ATA');

      // Check queryKey helper
      const keyAta = operationsKeys.taskRelated('task-3', 'ATA');
      expect(keyAta).toEqual(['operations', 'tasks', 'task-3', 'related', 'ATA']);

      const keyPrefix = operationsKeys.taskRelated('task-3');
      expect(keyPrefix).toEqual(['operations', 'tasks', 'task-3', 'related']);

      let fetchCount = 0;
      vi.spyOn(global, 'fetch').mockImplementation(async () => {
        fetchCount++;
        return new Response(
          JSON.stringify({
            data: { invoices: [], disbursements: [], transmittals: [] },
          }),
          { status: 200 }
        );
      });

      const { rerender } = renderHook(() => useTaskRelated('task-3'), { wrapper });
      await waitFor(() => expect(fetchCount).toBe(1));

      // Switch active entity to LTA -> triggers cache differentiation / separate query
      act(() => {
        useSessionStore.getState().setActiveEntity('LTA');
      });
      rerender();

      await waitFor(() => expect(fetchCount).toBe(2));
    });

    it('2.3 stale Task #1 response resolving after task selection switch does not bleed into Task #3', async () => {
      const { wrapper } = createTestHarness();

      let resolveTask1Fetch!: (response: Response) => void;
      const task1Promise = new Promise<Response>((resolve) => {
        resolveTask1Fetch = resolve;
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/tasks/task-1/related')) {
          return task1Promise;
        }
        if (url.includes('/operations/tasks/task-3/related')) {
          return new Response(
            JSON.stringify({
              data: {
                invoices: [{ id: 'inv-3', task_id: 'task-3', invoice_number: 'INV-3' }],
                disbursements: [],
                transmittals: [],
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      let currentTaskId = 'task-1';
      const { result, rerender } = renderHook(() => useTaskRelated(currentTaskId), { wrapper });

      // User quickly switches selection to Task #3 while Task #1 is still pending
      act(() => {
        currentTaskId = 'task-3';
      });
      rerender();

      // Task #3 completes fast
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data?.invoices.map((i) => i.id)).toEqual(['inv-3']);

      // Now the delayed Task #1 response finally arrives with Task #1 records
      act(() => {
        resolveTask1Fetch(
          new Response(
            JSON.stringify({
              data: {
                invoices: [{ id: 'inv-1', task_id: 'task-1', invoice_number: 'INV-1' }],
                disbursements: [],
                transmittals: [],
              },
            }),
            { status: 200 }
          )
        );
      });

      // Verify Task #3 data has NOT been polluted or overridden by Task #1's late response
      expect(result.current.data?.invoices.map((i) => i.id)).toEqual(['inv-3']);
    });
  });

  // ==========================================================================
  // 3. Rendered Component Integration Tests (TaskDetailModal)
  // ==========================================================================
  describe('Rendered Component Scoping: TaskDetailModal', () => {
    const setupHttpMocks = (options?: {
      task1Records?: TaskRelatedRecords;
      task3Records?: TaskRelatedRecords;
      dmsRecords?: Array<Partial<DmsDocument>>;
    }) => {
      const task1Records = options?.task1Records ?? {
        invoices: [{ id: 'inv-t1', task_id: 'task-1', invoice_number: 'INV-2026-001', amount: 25000 }],
        disbursements: [{ id: 'disb-t1', task_id: 'task-1', category: 'Notary Fee', amount: 1500 }],
        transmittals: [{ id: 'tx-t1', linked_task_id: 'task-1', tracking_number: 'TR-2026-001' }],
      };

      const task3Records = options?.task3Records ?? {
        invoices: [{ id: 'inv-t3', task_id: 'task-3', invoice_number: 'INV-2026-003', amount: 50000 }],
        disbursements: [{ id: 'disb-t3', task_id: 'task-3', category: 'SEC Registration', amount: 7500 }],
        transmittals: [{ id: 'tx-t3', linked_task_id: 'task-3', tracking_number: 'TR-2026-003' }],
      };

      const dmsRecords = options?.dmsRecords ?? [
        {
          id: 'doc-t1',
          file_name: 'Task1_Doc.pdf',
          work_request_id: 'wr-shared-1',
          linked_task_id: 'task-1',
        },
        {
          id: 'doc-t3',
          file_name: 'Task3_Doc.pdf',
          work_request_id: 'wr-shared-1',
          linked_task_id: 'task-3',
        },
        {
          id: 'doc-parent',
          file_name: 'Parent_Only_Doc.pdf',
          work_request_id: 'wr-shared-1',
          linked_task_id: null,
        },
      ];

      const capturedDmsUrls: string[] = [];

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);

        if (url.includes('/operations/tasks/task-1/related')) {
          return new Response(JSON.stringify({ data: task1Records }), { status: 200 });
        }
        if (url.includes('/operations/tasks/task-3/related')) {
          return new Response(JSON.stringify({ data: task3Records }), { status: 200 });
        }
        if (url.includes('/documents')) {
          capturedDmsUrls.push(url);
          return new Response(JSON.stringify({ data: dmsRecords }), { status: 200 });
        }
        if (url.includes('/time-entries')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (url.includes('/me/team')) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 'user-emp-1', name: 'Elena Santos', role: 'Staff' },
              ],
            }),
            { status: 200 }
          );
        }
        if (url.includes('/operations-requests')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      return { capturedDmsUrls };
    };

    it('3.1 Task #1 to Task #3 switching displays only owned records and isolates siblings', async () => {
      setupHttpMocks();
      const { wrapper } = createTestHarness();

      const { rerender } = render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask1}
          workRequest={mockWorkRequest}
        />,
        { wrapper }
      );

      // Task 1 records render
      expect(await screen.findByTestId('linked-invoice-inv-t1')).toHaveTextContent('INV-2026-001');
      expect(screen.getByTestId('linked-disbursement-disb-t1')).toHaveTextContent('Notary Fee');
      expect(screen.getByTestId('linked-transmittal-tx-t1')).toHaveTextContent('TR-2026-001');

      // Task 3 records must NOT appear in Task 1
      expect(screen.queryByTestId('linked-invoice-inv-t3')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-disbursement-disb-t3')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-transmittal-tx-t3')).not.toBeInTheDocument();

      // Switch to Task #3
      rerender(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask3}
          workRequest={mockWorkRequest}
        />
      );

      // Task 3 records render
      expect(await screen.findByTestId('linked-invoice-inv-t3')).toHaveTextContent('INV-2026-003');
      expect(screen.getByTestId('linked-disbursement-disb-t3')).toHaveTextContent('SEC Registration');
      expect(screen.getByTestId('linked-transmittal-tx-t3')).toHaveTextContent('TR-2026-003');

      // Task 1 records must NOT appear in Task 3
      expect(screen.queryByTestId('linked-invoice-inv-t1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-disbursement-disb-t1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-transmittal-tx-t1')).not.toBeInTheDocument();
    });

    it('3.2 empty Task #3 renders empty state and retains creation action buttons', async () => {
      setupHttpMocks({
        task3Records: { invoices: [], disbursements: [], transmittals: [] },
      });
      const { wrapper } = createTestHarness();

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask3}
          workRequest={mockWorkRequest}
        />,
        { wrapper }
      );

      const section = await screen.findByTestId('task-linked-records-section');
      expect(section).toBeInTheDocument();

      // Linked Records count header shows 0
      expect(screen.getByText(/Linked Records \(0\)/)).toBeInTheDocument();
      expect(
        screen.getByText('No billing invoices, disbursements, or transmittals linked to this task.')
      ).toBeInTheDocument();

      // Action buttons remain accessible
      expect(screen.getByTestId('link-invoice-btn')).toBeInTheDocument();
      expect(screen.getByTestId('link-disbursement-btn')).toBeInTheDocument();
      expect(screen.getByTestId('link-transmittal-btn')).toBeInTheDocument();
    });

    it('3.3 mixed server response with leaked sibling & parent records is defensively filtered in TaskDetailModal', async () => {
      // Leaking Task 1 and parent records inside Task 3 response (reproducing the audit finding)
      setupHttpMocks({
        task3Records: {
          invoices: [
            { id: 'inv-leaked-t1', task_id: 'task-1', invoice_number: 'LEAKED-INV-1' },
            { id: 'inv-t3', task_id: 'task-3', invoice_number: 'VALID-INV-3' },
            { id: 'inv-parent-only', task_id: null, linked_task_id: null, invoice_number: 'PARENT-INV' },
          ],
          disbursements: [
            { id: 'disb-leaked-t1', task_id: 'task-1', category: 'Leaked Fee' },
            { id: 'disb-t3', task_id: 'task-3', category: 'Valid Task 3 Fee' },
            { id: 'disb-parent-only', task_id: null, category: 'Parent WR Fee' },
          ],
          transmittals: [
            { id: 'tx-leaked-t1', linked_task_id: 'task-1', tracking_number: 'LEAKED-TX-1' },
            { id: 'tx-t3', linked_task_id: 'task-3', tracking_number: 'VALID-TX-3' },
            { id: 'tx-parent-only', linked_task_id: null, tracking_number: 'PARENT-TX' },
          ],
        },
      });
      const { wrapper } = createTestHarness();

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask3}
          workRequest={mockWorkRequest}
        />,
        { wrapper }
      );

      // Only Task 3 records are visible
      expect(await screen.findByTestId('linked-invoice-inv-t3')).toHaveTextContent('VALID-INV-3');
      expect(screen.getByTestId('linked-disbursement-disb-t3')).toHaveTextContent('Valid Task 3 Fee');
      expect(screen.getByTestId('linked-transmittal-tx-t3')).toHaveTextContent('VALID-TX-3');

      // Leaked Task 1 records are completely excluded
      expect(screen.queryByTestId('linked-invoice-inv-leaked-t1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-disbursement-disb-leaked-t1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-transmittal-tx-leaked-t1')).not.toBeInTheDocument();

      // Parent-only records are completely excluded
      expect(screen.queryByTestId('linked-invoice-inv-parent-only')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-disbursement-disb-parent-only')).not.toBeInTheDocument();
      expect(screen.queryByTestId('linked-transmittal-tx-parent-only')).not.toBeInTheDocument();

      // Count matches 3 (one of each type for Task 3)
      expect(screen.getByText(/Linked Records \(3\)/)).toBeInTheDocument();
    });

    it('3.4 canonical/legacy conflict: canonical Task #1 link excludes record from Task #3 even if legacy links Task #3', async () => {
      setupHttpMocks({
        task3Records: {
          invoices: [
            {
              id: 'inv-conflicting',
              task_id: 'task-1', // Canonical owner is Task 1
              linked_task_id: 'task-3', // Conflicting legacy alias pointing to Task 3
              invoice_number: 'INV-CONFLICT-101',
              amount: 8888,
            },
          ],
          disbursements: [],
          transmittals: [],
        },
      });
      const { wrapper } = createTestHarness();

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask3}
          workRequest={mockWorkRequest}
        />,
        { wrapper }
      );

      await screen.findByTestId('task-linked-records-section');

      // Conflicting record must NOT appear in Task 3 because canonical task_id is Task 1
      expect(screen.queryByTestId('linked-invoice-inv-conflicting')).not.toBeInTheDocument();
      expect(screen.getByText(/Linked Records \(0\)/)).toBeInTheDocument();
    });

    it('3.5 DMS query scoping passes workRequestId and linkedTaskId into request and retains client filtering', async () => {
      const { capturedDmsUrls } = setupHttpMocks({
        dmsRecords: [
          {
            id: 'doc-task-3-owned',
            file_name: 'Permit_Task3.pdf',
            original_name: 'Permit Task 3.pdf',
            work_request_id: 'wr-shared-1',
            linked_task_id: 'task-3',
            linkedTaskId: 'task-3',
            status: 'active',
          },
          {
            id: 'doc-task-1-foreign',
            file_name: 'Permit_Task1.pdf',
            original_name: 'Permit Task 1.pdf',
            work_request_id: 'wr-shared-1',
            linked_task_id: 'task-1',
            linkedTaskId: 'task-1',
            status: 'active',
          },
        ],
      });
      const { wrapper } = createTestHarness();

      render(
        <TaskDetailModal
          isOpen={true}
          onClose={vi.fn()}
          task={mockTask3}
          workRequest={mockWorkRequest}
        />,
        { wrapper }
      );

      // Verify DMS query was called with both workRequestId and linkedTaskId
      await waitFor(() => {
        expect(capturedDmsUrls.length).toBeGreaterThan(0);
        const lastUrl = capturedDmsUrls[capturedDmsUrls.length - 1];
        expect(lastUrl).toContain('workRequestId=wr-shared-1');
        expect(lastUrl).toContain('linkedTaskId=task-3');
      });

      // Verify client-side filtering retains only doc-task-3-owned
      expect(await screen.findByTestId('linked-doc-item-doc-task-3-owned')).toBeInTheDocument();
      expect(screen.queryByTestId('linked-doc-item-doc-task-1-foreign')).not.toBeInTheDocument();
    });
  });
});
