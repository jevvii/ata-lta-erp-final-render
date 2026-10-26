import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import React from 'react';
import { PendingTasksCard } from '../components/PendingTasksCard';
import { useSessionStore } from '@/lib/session';
import * as api from '@/lib/api';
import { PhaseKanbanBoard } from '@/features/operations/components/PhaseKanbanBoard';

describe('Dashboard Work Requests Calendar & Visibility Gating', () => {
  let queryClient: QueryClient;

  const mockWorkRequestsData = [
    {
      id: 'wr-lead-mine',
      title: 'Tax Compliance 2026 - Primary Lead',
      entity_code: 'ATA',
      client_name: 'Alpha Holdings',
      assigned_to: 'user-manager-1',
      assigned_to_name: 'Manager One',
      due_date: '2026-11-01',
      status: 'In Progress',
      current_phase: 'processing',
      tasks: [
        {
          id: 'task-1',
          title: 'Prepare BIR 1702',
          work_request_id: 'wr-lead-mine',
          status: 'In Progress',
          assignee_id: 'user-worker-2',
        },
      ],
    },
    {
      id: 'wr-co-assignee-mine',
      title: 'Annual SEC Filings - Co-Assignee',
      entity_code: 'LTA',
      client_name: 'Beta Global',
      assigned_to: 'user-lead-other',
      assigned_to_name: 'Other Lead',
      co_assignees: ['user-manager-1'],
      due_date: '2026-11-10',
      status: 'In Progress',
      current_phase: 'pre_processing',
      tasks: [],
    },
    {
      id: 'wr-task-assignee-mine',
      title: 'Audit Preparation - Task Assigned',
      entity_code: 'ATA',
      client_name: 'Gamma Corp',
      assigned_to: 'user-lead-other',
      assigned_to_name: 'Other Lead',
      co_assignees: [],
      due_date: '2026-11-15',
      status: 'In Progress',
      current_phase: 'quality_assurance',
      tasks: [
        {
          id: 'task-sub-mine',
          title: 'Review Trial Balance',
          work_request_id: 'wr-task-assignee-mine',
          status: 'In Progress',
          assignee_id: 'user-manager-1',
        },
      ],
    },
    {
      id: 'wr-foreign-unassigned',
      title: 'Foreign Work Request - Unassigned',
      entity_code: 'ATA',
      client_name: 'Delta Corp',
      assigned_to: 'user-stranger',
      assigned_to_name: 'Stranger Lead',
      co_assignees: ['user-stranger-2'],
      due_date: '2026-11-20',
      status: 'In Progress',
      current_phase: 'completion',
      tasks: [
        {
          id: 'task-foreign',
          title: 'Foreign Secret Task',
          work_request_id: 'wr-foreign-unassigned',
          status: 'In Progress',
          assignee_id: 'user-stranger-3',
        },
      ],
    },
  ];

  const LocationTracker = ({ onLocation }: { onLocation: (loc: ReturnType<typeof useLocation>) => void }) => {
    const loc = useLocation();
    React.useEffect(() => {
      onLocation(loc);
    }, [loc, onLocation]);
    return null;
  };

  const createWrapper = (initialRoute = '/dashboard') => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0 },
      },
    });

    let currentLocation: ReturnType<typeof useLocation> | null = null;

    const Wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          MemoryRouter,
          { initialEntries: [initialRoute] },
          React.createElement(LocationTracker, {
            onLocation: (loc) => {
              currentLocation = loc;
            },
          }),
          children
        )
      );

    return {
      Wrapper,
      getLocation: () => currentLocation,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Work Request Calendar Display vs Tasks', () => {
    it('displays only the Work Requests themselves, not individual task cards', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-manager-1',
          name: 'Manager One',
          email: 'manager1@ata-lta.ph',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['operations:read'],
        activeEntity: 'ALL',
      });

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return { data: mockWorkRequestsData } as never;
        }
        return { data: [] } as never;
      });

      const { Wrapper } = createWrapper();
      render(<PendingTasksCard />, { wrapper: Wrapper });

      // Heading reflects Work Requests calendar
      expect(await screen.findByText('Assigned Work Requests')).toBeInTheDocument();

      // Displays work requests themselves
      expect(await screen.findByText('Tax Compliance 2026 - Primary Lead')).toBeInTheDocument();
      expect(screen.getByText('Annual SEC Filings - Co-Assignee')).toBeInTheDocument();
      expect(screen.getByText('Audit Preparation - Task Assigned')).toBeInTheDocument();

      // Does NOT display task titles as standalone cards
      expect(screen.queryByText('Prepare BIR 1702')).not.toBeInTheDocument();
      expect(screen.queryByText('Review Trial Balance')).not.toBeInTheDocument();

      // Work request card contains task count summary indicator
      expect(screen.getAllByText(/1 Task/).length).toBeGreaterThan(0);
    });
  });

  describe('Visibility Gates Enforcement', () => {
    it('non-admin (Manager/Staff) strictly sees only work requests they are added to (lead, co-assignee, or task assignee) and does NOT see foreign requests', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-manager-1',
          name: 'Manager One',
          email: 'manager1@ata-lta.ph',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['operations:read'],
        activeEntity: 'ALL',
      });

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return { data: mockWorkRequestsData } as never;
        }
        return { data: [] } as never;
      });

      const { Wrapper } = createWrapper();
      render(<PendingTasksCard />, { wrapper: Wrapper });

      // Visible: Lead, Co-Assignee, and Task Assignee
      expect(await screen.findByTestId('pending-wr-wr-lead-mine')).toBeInTheDocument();
      expect(screen.getByTestId('pending-wr-wr-co-assignee-mine')).toBeInTheDocument();
      expect(screen.getByTestId('pending-wr-wr-task-assignee-mine')).toBeInTheDocument();

      // Excluded: Foreign work request where user is NOT lead, NOT co-assignee, and NOT on any task
      expect(screen.queryByTestId('pending-wr-wr-foreign-unassigned')).not.toBeInTheDocument();
      expect(screen.queryByText('Foreign Work Request - Unassigned')).not.toBeInTheDocument();
    });

    it('Admin unconditionally sees all work requests system-wide including foreign requests', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-admin',
          name: 'System Admin',
          email: 'admin@ata-lta.ph',
          role: 'Admin',
          departments: ['Management'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['operations:read', 'operations:write'],
        activeEntity: 'ALL',
      });

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return { data: mockWorkRequestsData } as never;
        }
        return { data: [] } as never;
      });

      const { Wrapper } = createWrapper();
      render(<PendingTasksCard />, { wrapper: Wrapper });

      // Admin sees ALL 4 work requests
      expect(await screen.findByTestId('pending-wr-wr-lead-mine')).toBeInTheDocument();
      expect(screen.getByTestId('pending-wr-wr-co-assignee-mine')).toBeInTheDocument();
      expect(screen.getByTestId('pending-wr-wr-task-assignee-mine')).toBeInTheDocument();
      expect(screen.getByTestId('pending-wr-wr-foreign-unassigned')).toBeInTheDocument();
      expect(screen.getByText('Foreign Work Request - Unassigned')).toBeInTheDocument();
    });
  });

  describe('Navigation: Calendar Click to Task Board & Board to Side Peek', () => {
    it('clicking a Work Request item in the dashboard calendar navigates to that work request task board view page', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-manager-1',
          name: 'Manager One',
          email: 'manager1@ata-lta.ph',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['operations:read'],
        activeEntity: 'ATA',
      });

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return { data: mockWorkRequestsData } as never;
        }
        return { data: [] } as never;
      });

      const { Wrapper, getLocation } = createWrapper('/dashboard');
      render(<PendingTasksCard />, { wrapper: Wrapper });

      const card = await screen.findByTestId('pending-wr-wr-lead-mine');
      fireEvent.click(card);

      const loc = getLocation();
      expect(loc?.pathname).toBe('/operations');
      expect(loc?.search).toContain('tab=work-requests');
      expect(loc?.search).toContain('view=board');
      expect(loc?.search).toContain('wrId=wr-lead-mine');
    });

    it('clicking the Task Board action button on the card navigates directly to the task board view page', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-manager-1',
          name: 'Manager One',
          email: 'manager1@ata-lta.ph',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['operations:read'],
        activeEntity: 'ATA',
      });

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return { data: mockWorkRequestsData } as never;
        }
        return { data: [] } as never;
      });

      const { Wrapper, getLocation } = createWrapper('/dashboard');
      render(<PendingTasksCard />, { wrapper: Wrapper });

      const boardBtn = await screen.findByTestId('view-wr-btn-wr-lead-mine');
      fireEvent.click(boardBtn);

      const loc = getLocation();
      expect(loc?.pathname).toBe('/operations');
      expect(loc?.search).toContain('tab=work-requests');
      expect(loc?.search).toContain('view=board');
      expect(loc?.search).toContain('wrId=wr-lead-mine');
    });

    it('in task boards view (PhaseKanbanBoard), renders button for going back to the work request side peek', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'user-manager-1',
          name: 'Manager One',
          email: 'manager1@ata-lta.ph',
          role: 'Manager',
          departments: ['Operations'],
          entities: ['ATA'],
        },
        permissions: ['operations:read', 'operations:write'],
        activeEntity: 'ATA',
      });

      const sampleWr = {
        id: 'wr-lead-mine',
        title: 'Tax Compliance 2026 - Primary Lead',
        entity_code: 'ATA',
        status: 'In Progress',
        tasks: [],
      };

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/tasks')) {
          return { data: [] } as never;
        }
        if (path.includes('/operations/work-requests/wr-lead-mine')) {
          return { data: sampleWr } as never;
        }
        if (path.includes('/operations/work-requests')) {
          return { data: [sampleWr] } as never;
        }
        return { data: [] } as never;
      });

      const onBackToSidePeek = vi.fn();
      const { Wrapper } = createWrapper('/operations?tab=work-requests&view=board&wrId=wr-lead-mine');

      render(
        <PhaseKanbanBoard
          initialWorkRequestId="wr-lead-mine"
          onBackToSidePeek={onBackToSidePeek}
        />,
        { wrapper: Wrapper }
      );

      const backBtn = await screen.findByTestId('kanban-back-sidepeek-btn');
      expect(backBtn).toBeInTheDocument();
      expect(backBtn).toHaveTextContent('Work Request Details');

      fireEvent.click(backBtn);
      expect(onBackToSidePeek).toHaveBeenCalledWith('wr-lead-mine');
    });

    it('renders compact icon-only buttons in week view to prevent typography collision, and full text in agenda view', async () => {
      useSessionStore.setState({
        user: {
          id: 'user-manager-1',
          role: 'Manager',
          name: 'Manager One',
          email: 'manager1@ata-lta.ph',
          departments: ['Operations'],
          entities: ['ATA', 'LTA'],
        },
        activeEntity: 'ATA',
      });

      vi.spyOn(api, 'apiRequest').mockImplementation(async (path: string) => {
        if (path.includes('/operations/work-requests')) {
          return { data: mockWorkRequestsData } as never;
        }
        return { data: [] } as never;
      });

      const { Wrapper } = createWrapper('/dashboard');
      render(<PendingTasksCard />, { wrapper: Wrapper });

      const weekCard = await screen.findByTestId('pending-wr-wr-lead-mine');
      expect(weekCard).toBeInTheDocument();

      // In default week view (calendar grid), the task board button is icon-only (no visible "Task Board" text span)
      const weekTaskBoardBtn = screen.getByTestId('view-wr-btn-wr-lead-mine');
      expect(weekTaskBoardBtn).toHaveClass('w-6');
      expect(weekTaskBoardBtn.querySelector('.sm\\:inline')).toBeNull();

      // Switch to Agenda view
      const agendaBtn = screen.getByRole('button', { name: /Agenda/i });
      fireEvent.click(agendaBtn);

      const agendaCard = await screen.findByTestId('pending-wr-wr-lead-mine');
      expect(agendaCard).toBeInTheDocument();
      const agendaTaskBoardBtn = screen.getByTestId('view-wr-btn-wr-lead-mine');
      expect(agendaTaskBoardBtn.querySelector('.sm\\:inline')).not.toBeNull();
      expect(agendaTaskBoardBtn).toHaveTextContent('Task Board');
    });
  });
});
