import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { RerouteModal } from '../components/RerouteModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { operationsKeys } from '../api/queryKeys';
import type { WorkRequest, Task } from '../api/types';

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

const mockWorkRequests = [
  {
    id: 'wr-101',
    title: 'Annual Tax Filing 2025',
    entity: 'ATA',
    status: 'In Progress',
    phase: 'pre_processing',
    priority: 'High',
    clientId: 'client-1',
    clientName: 'Acme Philippines Corp',
    archived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    tasks: [],
  },
  {
    id: 'wr-102',
    title: 'SEC Statutory Compliance 2026',
    entity: 'ATA',
    status: 'In Progress',
    phase: 'processing',
    priority: 'Medium',
    clientId: 'client-2',
    clientName: 'Global Maritime Ltd',
    archived: false,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    tasks: [],
  },
  {
    id: 'wr-103',
    title: 'Quarterly VAT Q1',
    entity: 'LTA',
    status: 'Draft',
    phase: 'pre_processing',
    priority: 'Low',
    clientId: 'client-3',
    clientName: 'Pacific Trading Corp',
    archived: false,
    createdAt: '2026-01-03T00:00:00Z',
    updatedAt: '2026-01-03T00:00:00Z',
    tasks: [],
  },
] as unknown as WorkRequest[];

const mockPreTasks = [
  {
    id: 'task-1',
    workRequestId: 'wr-101',
    title: 'Gather BIR 2307 Certificates',
    phase: 'pre_processing',
    status: 'In Progress',
    boardOrder: 1000,
    qaStatus: undefined,
    checklist: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'task-2',
    workRequestId: 'wr-101',
    title: 'Verify General Ledger Entries',
    phase: 'pre_processing',
    status: 'Completed',
    boardOrder: 2000,
    qaStatus: undefined,
    checklist: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
] as unknown as Task[];

describe('Phase Kanban Board & Routing Features (Milestone 3)', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn();
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(async () => {
    await supabase.removeAllChannels();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin Test',
        role: 'Admin',
        departments: ['Operations'],
        entities: ['ALL'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
        'workflow:transition_request',
        'workflow:qa_review',
        'workflow:task_add',
      ],
      activeEntity: 'ALL',
    });
  });

  it('renders all 4 phase columns and displays gate progress', async () => {
    const { wrapper } = createTestHarness();

    // Mock API responses
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    // Assert 4 phase columns rendered
    expect(await screen.findByTestId('kanban-phase-column-pre_processing')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-phase-column-processing')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-phase-column-quality_assurance')).toBeInTheDocument();
    expect(screen.getByTestId('kanban-phase-column-completion')).toBeInTheDocument();

    // Assert gate progress in pre-processing column
    const gateProgress = await screen.findByTestId('gate-progress-pre_processing');
    expect(gateProgress).toHaveTextContent('1/2 completed');

    // Assert task cards rendered
    expect(screen.getByText('Gather BIR 2307 Certificates')).toBeInTheDocument();
    expect(screen.getByText('Verify General Ledger Entries')).toBeInTheDocument();
  });

  it('disables phase advance actions with tooltip when gate prerequisites are not met', async () => {
    const { wrapper } = createTestHarness();

    // Ensure session uses a Manager (non-admin) role so manager actions are rendered genuinely
    useSessionStore.getState().setSession({
      user: {
        id: 'u-mgr-1',
        email: 'manager@ata-lta.ph',
        name: 'Manager Test',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ALL'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
        'workflow:transition_request',
        'workflow:qa_review',
        'workflow:task_add',
      ],
      activeEntity: 'ALL',
    });

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    // Blocker warning badge is present
    const blockerWarning = await screen.findByTestId('gate-blocker-pre_processing');
    expect(blockerWarning).toHaveTextContent('1 task(s) block advancement');

    // Manager action button is disabled
    const managerBtn = screen.getByTestId('manager-notify-admin-btn');
    expect(managerBtn).toBeDisabled();
    expect(managerBtn).toHaveAttribute('title');
    expect(managerBtn.getAttribute('title')).toContain('Gather BIR 2307 Certificates');

    // Admin advance button is disabled
    const adminBtn = screen.getByTestId('admin-advance-btn');
    expect(adminBtn).toBeDisabled();
  });

  it('suppresses manager notify-admin button for Admin users (Issue 16)', async () => {
    const { wrapper } = createTestHarness();

    // Default beforeEach user is Admin (role: 'Admin')
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    await screen.findByTestId('kanban-phase-column-pre_processing');

    // Admin user should NOT see manager-notify-admin-btn
    expect(screen.queryByTestId('manager-notify-admin-btn')).not.toBeInTheDocument();

    // Admin user should see admin-advance-btn
    expect(screen.getByTestId('admin-advance-btn')).toBeInTheDocument();
  });

  it('deletes task from board with confirmation prompt calling deleteTask (Issue 15)', async () => {
    const { wrapper } = createTestHarness();

    let deletedTaskId: string | null = null;
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks/task-1') && init?.method === 'DELETE') {
        deletedTaskId = 'task-1';
        return new Response(null, { status: 204 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    await screen.findByTestId('kanban-task-card-task-1');

    // Open task context menu
    const menuBtn = screen.getByTestId('task-menu-btn-task-1');
    fireEvent.click(menuBtn);

    // Click delete task option
    const deleteBtn = screen.getByTestId('delete-task-btn-task-1');
    fireEvent.click(deleteBtn);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(deletedTaskId).toBe('task-1');
    });
  });

  it('strictly blocks cross-phase drag-and-drop in the UI', async () => {
    const { wrapper } = createTestHarness();

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    const taskCard = await screen.findByTestId('kanban-task-card-task-1');
    const targetProcessingCol = screen.getByTestId('kanban-phase-column-processing');

    const dataTransfer = {
      data: {} as Record<string, string>,
      setData(key: string, val: string) {
        this.data[key] = val;
      },
      getData(key: string) {
        return this.data[key] || '';
      },
      dropEffect: 'none',
    };

    // 1. Drag starts on pre_processing task
    fireEvent.dragStart(taskCard, { dataTransfer });

    // 2. Drag over processing column (cross-phase)
    fireEvent.dragOver(targetProcessingCol, { dataTransfer });

    // Cross-phase drops are prohibited in UI
    expect(dataTransfer.dropEffect).toBe('none');

    // 3. Drop on processing column should be rejected
    const fetchCallsBefore = vi.mocked(global.fetch).mock.calls.length;
    fireEvent.drop(targetProcessingCol, { dataTransfer });

    // No mutation should have been fired
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(fetchCallsBefore);
  });

  it('renders QA review controls and submits pass/fail evaluation', async () => {
    const { wrapper } = createTestHarness();

    const qaWorkRequest = {
      ...mockWorkRequests[0]!,
      phase: 'quality_assurance',
      status: 'In Progress',
    } as unknown as WorkRequest;

    const qaTasks = [
      {
        id: 'task-qa-1',
        workRequestId: 'wr-101',
        title: 'BIR Form 1702Q QA Inspection',
        phase: 'processing',
        status: 'Completed',
        boardOrder: 1000,
        qaStatus: undefined,
        checklist: [],
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ] as unknown as Task[];

    let postBody: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: [qaWorkRequest] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: qaTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/qa-review')) {
        postBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ data: { ...qaWorkRequest } }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: qaWorkRequest }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    // QA controls are rendered on the task card
    const passBtn = await screen.findByTestId('qa-pass-btn-task-qa-1');
    expect(passBtn).toBeInTheDocument();

    // Click Pass button
    fireEvent.click(passBtn);

    await waitFor(() => {
      expect(postBody).toEqual({
        results: [
          {
            task_id: 'task-qa-1',
            qa_status: 'passed',
            taskId: 'task-qa-1',
            qaStatus: 'passed',
          },
        ],
      });
    });
  });

  it('RerouteModal requires a non-empty reason and submits reroute payload', async () => {
    let rerouteBody: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/operations/work-requests/wr-101/reroute')) {
        rerouteBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            data: { id: 'wr-101', phase: 'processing', status: 'In Progress', reopenedTaskIds: ['task-failed-1'] },
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    });

    const onClose = vi.fn();
    const onSuccess = vi.fn();
    const { wrapper } = createTestHarness();

    render(
      <RerouteModal
        isOpen={true}
        onClose={onClose}
        workRequestId="wr-101"
        failedTasks={[{ id: 'task-failed-1', title: 'Withholding Tax Calculation' }]}
        onSuccess={onSuccess}
      />,
      { wrapper }
    );

    // Assert failed task listed in modal
    expect(screen.getByText('Withholding Tax Calculation')).toBeInTheDocument();
    expect(screen.getByTestId('reroute-failed-badge')).toHaveTextContent('1 Failed');

    // 1. Submit empty reason -> blocked
    const confirmBtn = screen.getByTestId('confirm-reroute-btn');
    fireEvent.click(confirmBtn);

    expect(await screen.findByTestId('reroute-reason-error')).toHaveTextContent(
      'A non-empty reroute reason is required'
    );
    expect(rerouteBody).toBeNull();

    // 2. Type reason and submit
    const reasonInput = screen.getByTestId('reroute-reason-input');
    fireEvent.change(reasonInput, {
      target: { value: 'Discrepancy in line 14 deductions requires recalculation' },
    });

    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(rerouteBody).toEqual({
        to_phase: 'processing',
        reason: 'Discrepancy in line 14 deductions requires recalculation',
      });
    });
  });

  it('mounts PresenceAvatars with roomId=effectiveWrId in the header toolbar', async () => {
    const { wrapper } = createTestHarness();

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('kanban-wr-select')).toBeInTheDocument();
    });

    // MockRealtimeChannel sets up presence for 'presence:work_request:wr-101'
    const channel = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;
    act(() => {
      channel.setPresenceState({
        'u-admin-1': [{ userId: 'u-admin-1', name: 'Admin Test' }],
        'user-colleague-1': [
          {
            userId: 'user-colleague-1',
            name: 'Jane Doe',
            email: 'jane@ata-lta.ph',
            role: 'Senior Reviewer',
          },
        ],
      });
      channel.emit('presence', { event: 'sync' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
      expect(screen.getByTestId('presence-avatar-user-colleague-1')).toBeInTheDocument();
    });
  });

  it('reactively re-renders activeWr, phase column highlight, and gate progress on query cache updates', async () => {
    const { queryClient, wrapper } = createTestHarness();

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests?')) {
        return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101/tasks')) {
        return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-101')) {
        return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText('Phase: Pre-processing')).toBeInTheDocument();
    });

    // Simulate TanStack Query cache update from a work_requests CDC event changing phase to processing
    act(() => {
      queryClient.setQueryData(
        operationsKeys.workRequestDetail('wr-101'),
        (old: any) => ({
          ...old,
          phase: 'processing',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Phase: Processing')).toBeInTheDocument();
    });

    // Simulate TanStack Query cache update from a tasks CDC event completing remaining task
    act(() => {
      queryClient.setQueryData(
        operationsKeys.tasks('wr-101'),
        mockPreTasks.map((t) => ({ ...t, status: 'Completed' }))
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('gate-progress-pre_processing')).toHaveTextContent('2/2 completed');
    });
  });

  // =========================================================================
  // Milestone 4: Dynamic Dropdown Presence Switching (Parcel 2D)
  // =========================================================================
  describe('Milestone 4: Dynamic Dropdown Presence Switching (Parcel 2D)', () => {
    it('switches presence channels cleanly when work request is changed via dropdown', async () => {
      const { wrapper } = createTestHarness();
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-101/tasks')) {
          return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-102/tasks')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-101')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-102')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[1] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-wr-select')).toBeInTheDocument();
      });

      // 1. Initial presence subscription to wr-101
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-101');
      const channel101 = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;
      const untrack101Spy = vi.spyOn(channel101, 'untrack');

      // Colleague joins wr-101 room
      act(() => {
        channel101.setPresenceState({
          'u-admin-1': [{ userId: 'u-admin-1', name: 'Admin Test' }],
          'user-colleague-1': [
            {
              userId: 'user-colleague-1',
              name: 'Jane Doe',
              email: 'jane@ata-lta.ph',
              role: 'Senior Reviewer',
            },
          ],
        });
        channel101.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatar-user-colleague-1')).toBeInTheDocument();
      });

      // 2. Open dropdown and switch to wr-102
      const selectTrigger = screen.getByTestId('kanban-wr-select');
      fireEvent.pointerDown(selectTrigger, { button: 0, ctrlKey: false });
      fireEvent.keyDown(selectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        expect(screen.getByText('SEC Statutory Compliance 2026 (ATA)')).toBeInTheDocument();
      });

      const option102 = screen.getByText('SEC Statutory Compliance 2026 (ATA)');
      fireEvent.click(option102);

      // 3. Verify previous channel untracked and removed
      await waitFor(() => {
        expect(untrack101Spy).toHaveBeenCalled();
        expect(removeChannelSpy).toHaveBeenCalledWith(channel101);
      });

      // 4. Verify new channel subscribed for wr-102
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-102');

      // 5. Old viewer from wr-101 must be eagerly cleared
      expect(screen.queryByTestId('presence-avatar-user-colleague-1')).not.toBeInTheDocument();

      // 6. Colleague joins wr-102 room
      const channel102 = supabase.channel('presence:work_request:wr-102') as unknown as MockRealtimeChannel;
      act(() => {
        channel102.setPresenceState({
          'u-admin-1': [{ userId: 'u-admin-1', name: 'Admin Test' }],
          'user-colleague-2': [
            {
              userId: 'user-colleague-2',
              name: 'Bob Partner',
              email: 'bob@ata-lta.ph',
              role: 'Managing Partner',
            },
          ],
        });
        channel102.emit('presence', { event: 'sync' });
      });

      await waitFor(() => {
        expect(screen.getByTestId('presence-avatar-user-colleague-2')).toBeInTheDocument();
      });
    });

    it('handles sequential dropdown switching without leaking subscriptions or orphan channels', async () => {
      const { wrapper } = createTestHarness();
      const channelSpy = vi.spyOn(supabase, 'channel');
      const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/tasks')) {
          return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-101')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-102')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[1] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-103')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[2] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-wr-select')).toBeInTheDocument();
      });

      const channel101 = supabase.channel('presence:work_request:wr-101') as unknown as MockRealtimeChannel;

      // Switch wr-101 -> wr-102
      const selectTrigger = screen.getByTestId('kanban-wr-select');
      fireEvent.pointerDown(selectTrigger, { button: 0, ctrlKey: false });
      fireEvent.keyDown(selectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        expect(screen.getByText('SEC Statutory Compliance 2026 (ATA)')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('SEC Statutory Compliance 2026 (ATA)'));

      await waitFor(() => {
        expect(removeChannelSpy).toHaveBeenCalledWith(channel101);
      });

      const channel102 = supabase.channel('presence:work_request:wr-102') as unknown as MockRealtimeChannel;

      // Switch wr-102 -> wr-103
      fireEvent.pointerDown(selectTrigger, { button: 0, ctrlKey: false });
      fireEvent.keyDown(selectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        expect(screen.getByText('Quarterly VAT Q1 (LTA)')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('Quarterly VAT Q1 (LTA)'));

      await waitFor(() => {
        expect(removeChannelSpy).toHaveBeenCalledWith(channel102);
      });

      // Confirm presence:work_request:wr-103 channel created
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-103');
    });

    it('verifies zero database writes occur across dropdown presence transitions', async () => {
      const { wrapper } = createTestHarness();
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/tasks')) {
          return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-101')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-102')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[1] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-wr-select')).toBeInTheDocument();
      });

      const selectTrigger = screen.getByTestId('kanban-wr-select');
      fireEvent.pointerDown(selectTrigger, { button: 0, ctrlKey: false });
      fireEvent.keyDown(selectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        expect(screen.getByText('SEC Statutory Compliance 2026 (ATA)')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('SEC Statutory Compliance 2026 (ATA)'));

      // Check all fetch calls - none are mutations for presence (e.g. POST, PUT, DELETE to presence)
      for (const call of fetchSpy.mock.calls) {
        const url = String(call[0]);
        const opts = call[1] as RequestInit | undefined;
        const method = opts?.method || 'GET';
        expect(url).not.toContain('/presence');
        if (method !== 'GET') {
          // No mutation occurred simply from switching presence dropdown
          expect(['POST', 'PUT', 'DELETE', 'PATCH']).not.toContain(method);
        }
      }
    });

    it('bypasses presence and creates 0 channels across dropdown switches when realtime_sync is false', async () => {
      localStorage.setItem('erp_feature_override_realtime_sync', 'false');
      const { wrapper } = createTestHarness();
      const channelSpy = vi.spyOn(supabase, 'channel');

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/tasks')) {
          return new Response(JSON.stringify({ data: mockPreTasks }), { status: 200 });
        }
        if (url.includes('/operations/work-requests?')) {
          return new Response(JSON.stringify({ data: mockWorkRequests }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-101')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[0] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-102')) {
          return new Response(JSON.stringify({ data: mockWorkRequests[1] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-wr-select')).toBeInTheDocument();
      });

      expect(channelSpy).not.toHaveBeenCalled();

      const selectTrigger = screen.getByTestId('kanban-wr-select');
      fireEvent.pointerDown(selectTrigger, { button: 0, ctrlKey: false });
      fireEvent.keyDown(selectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      await waitFor(() => {
        expect(screen.getByText('SEC Statutory Compliance 2026 (ATA)')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByText('SEC Statutory Compliance 2026 (ATA)'));

      // Still 0 channel calls
      expect(channelSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId('presence-avatars')).not.toBeInTheDocument();
    });
  });
});

