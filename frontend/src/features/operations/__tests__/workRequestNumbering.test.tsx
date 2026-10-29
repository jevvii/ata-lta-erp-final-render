import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { WorkRequestList } from '../components/WorkRequestList';
import { WorkRequestSidePeek } from '../components/WorkRequestSidePeek';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { OperationsArchiveTab } from '../components/OperationsArchiveTab';
import { PhaseKanbanBoard } from '../components/PhaseKanbanBoard';
import { useSessionStore } from '@/lib/session';
import type { WorkRequest, Task, WorkRequestRelatedData } from '../api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MemoryRouter, null, children)
    );

  return { queryClient, wrapper };
}

const mockWorkRequests: WorkRequest[] = [
  {
    id: 'wr-101',
    workRequestNumber: 'WR-ATA-2026-0001',
    work_request_number: 'WR-ATA-2026-0001',
    title: 'Annual Corporate Income Tax Return',
    description: 'Corporate annual tax return filing for FY2025',
    clientId: 'c-1',
    clientNumber: 'CLI-ATA-001',
    client_number: 'CLI-ATA-001',
    clientName: 'Acme Philippines Corp',
    entity: 'ATA',
    status: 'In Progress',
    phase: 'pre_processing',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'Urgent',
    requestedBy: null,
    assignedTo: 'u-mgr-1',
    assignedToName: 'Maria Santos',
    coAssignees: [],
    dueDate: '2026-04-15T00:00:00.000Z',
    archived: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    tasks: [],
  },
  {
    id: 'wr-102',
    workRequestNumber: 'WR-LTA-2026-0002',
    work_request_number: 'WR-LTA-2026-0002',
    title: 'General Information Sheet 2026',
    description: 'SEC GIS annual filing',
    clientId: 'c-2',
    clientNumber: 'CLI-LTA-002',
    client_number: 'CLI-LTA-002',
    clientName: 'Beta Holdings Inc',
    entity: 'LTA',
    status: 'Completed',
    phase: 'completion',
    onHold: false,
    phaseEnteredAt: null,
    priority: 'Normal',
    requestedBy: null,
    assignedTo: 'u-mgr-1',
    assignedToName: 'Maria Santos',
    coAssignees: [],
    dueDate: '2026-05-30T00:00:00.000Z',
    archived: false,
    version: 1,
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    tasks: [],
  },
];

const mockTask: Task = {
  id: 'task-101',
  workRequestId: 'wr-101',
  workRequestNumber: 'WR-ATA-2026-0001',
  title: 'Gather BIR Certificates',
  description: 'Collect Form 2307 and audited statements',
  status: 'In Progress',
  phase: 'pre_processing',
  qaStatus: 'none',
  phaseEnteredAt: null,
  assigneeId: 'u-mgr-1',
  assigneeName: 'Maria Santos',
  assignees: ['u-mgr-1'],
  predecessors: [],
  dueDate: '2026-04-10T00:00:00.000Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockRelatedData: WorkRequestRelatedData = {
  invoices: [
    {
      id: 'inv-1',
      taskId: 'task-101',
      linked_task_id: 'task-101',
      invoice_number: 'INV-ATA-2026-0001',
      invoiceNumber: 'INV-ATA-2026-0001',
      amount: 15000,
      status: 'Paid',
    },
  ],
  disbursements: [
    {
      id: 'disb-1',
      taskId: 'task-101',
      linked_task_id: 'task-101',
      disbursement_number: 'DISB-ATA-20260418-0001',
      disbursementNumber: 'DISB-ATA-20260418-0001',
      category: 'BIR DST & Penalties',
      description: 'Documentary stamp tax on filing',
      amount: 4500,
      status: 'Released',
    },
  ],
  transmittals: [
    {
      id: 'trans-1',
      taskId: 'task-101',
      linked_task_id: 'task-101',
      transmittal_number: 'TR-ATA-2026-0001',
      tracking_number: 'TRK-ATA-2026-0001',
      recipient_name: 'BIR RDO 47',
      status: 'Delivered',
    },
  ],
};

describe('Work Request Persistent Numbering & Linked Identifiers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-mgr-1',
        email: 'maria@ata-lta.ph',
        name: 'Maria Santos',
        role: 'Manager',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'workflow:view',
        'workflow:edit',
        'workflow:phase_transition',
      ],
      activeEntity: 'ALL',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/related')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockRelatedData }),
        } as Response);
      }
      if (u.includes('/tasks/task-101') || u.endsWith('/task-101')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockTask }),
        } as Response);
      }
      if (u.includes('/tasks')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [mockTask] }),
        } as Response);
      }
      if (u.includes('/clients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'c-1', name: 'Acme Philippines Corp', clientNumber: 'CLI-ATA-001', entity: 'ATA' },
              { id: 'c-2', name: 'Beta Holdings Inc', clientNumber: 'CLI-LTA-002', entity: 'LTA' },
            ],
          }),
        } as Response);
      }
      if (u.includes('/me/team')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ id: 'u-mgr-1', name: 'Maria Santos', role: 'Manager' }],
          }),
        } as Response);
      }
      if (u.includes('/operations/work-requests/wr-101')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockWorkRequests[0] }),
        } as Response);
      }
      if (u.includes('/operations/work-requests')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: mockWorkRequests, meta: { total: 2 } }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: {} }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('1. WorkRequestList View Modes & Search', () => {
    it('renders ID as the first data column in table view with WR-ATA-2026-0001 and client number', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('wr-row-wr-101')).toBeInTheDocument();
      });

      // Verify Table Header has ID
      const table = screen.getByRole('table');
      const headers = table.querySelectorAll('th');
      expect(headers[1]?.textContent?.trim()).toBe('ID');
      expect(headers[2]?.textContent?.trim()).toBe('Work Request');

      // Verify row renders persistent WR Number in monospace
      const row = screen.getByTestId('wr-row-wr-101');
      expect(row).toHaveTextContent('WR-ATA-2026-0001');

      // Verify row renders client code
      expect(row).toHaveTextContent('CLI-ATA-001');
    });

    it('renders WR-ATA-2026-0001 and client number in cards view', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('view-mode-cards')).toBeInTheDocument();
      });

      // Switch to cards view
      fireEvent.click(screen.getByTestId('view-mode-cards'));

      await waitFor(() => {
        expect(screen.getByTestId('wr-card-wr-101')).toBeInTheDocument();
      });

      const card = screen.getByTestId('wr-card-wr-101');
      expect(card).toHaveTextContent('WR-ATA-2026-0001');
      expect(card).toHaveTextContent('CLI-ATA-001');
    });

    it('filters client-side by work request number and client number', async () => {
      const { wrapper } = createHarness();
      render(<WorkRequestList />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('wr-row-wr-101')).toBeInTheDocument();
        expect(screen.getByTestId('wr-row-wr-102')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search/i);

      // Search by WR number
      fireEvent.change(searchInput, { target: { value: 'WR-ATA-2026-0001' } });
      await waitFor(() => {
        expect(screen.getByTestId('wr-row-wr-101')).toBeInTheDocument();
        expect(screen.queryByTestId('wr-row-wr-102')).not.toBeInTheDocument();
      });

      // Search by Client number
      fireEvent.change(searchInput, { target: { value: 'CLI-LTA-002' } });
      await waitFor(() => {
        expect(screen.queryByTestId('wr-row-wr-101')).not.toBeInTheDocument();
        expect(screen.getByTestId('wr-row-wr-102')).toBeInTheDocument();
      });
    });
  });

  describe('2. WorkRequestSidePeek Display & Linked Disbursements', () => {
    it('renders WR-ATA-2026-0001 badge, client number, and linked disbursement DISB-ATA-20260418-0001', async () => {
      const { wrapper } = createHarness();
      render(
        <WorkRequestSidePeek
          isOpen={true}
          workRequestId="wr-101"
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-wr-number')).toBeInTheDocument();
      });

      // Work request persistent code badge
      expect(screen.getByTestId('side-peek-wr-number')).toHaveTextContent('WR-ATA-2026-0001');

      // Client name and client number
      const clientEl = screen.getByTestId('side-peek-client');
      expect(clientEl).toHaveTextContent('Acme Philippines Corp');
      expect(screen.getByText('(CLI-ATA-001)')).toBeInTheDocument();

      // Linked Disbursement Number
      await waitFor(() => {
        expect(screen.getByTestId('side-peek-disbursement-disb-1')).toBeInTheDocument();
      });

      const disbEl = screen.getByTestId('side-peek-disbursement-disb-1');
      expect(disbEl).toHaveTextContent('DISB-ATA-20260418-0001');
      expect(disbEl).toHaveTextContent('BIR DST & Penalties');
    });
  });

  describe('3. TaskDetailModal Linked Records & Work Request Number', () => {
    it('attaches disbursement_number cleanly to linked disbursements and shows parent work request number', async () => {
      const { wrapper } = createHarness();
      render(
        <TaskDetailModal
          isOpen={true}
          task={mockTask}
          workRequest={mockWorkRequests[0]}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
      });

      // Parent WR persistent number
      expect(screen.getByText(/\[WR-ATA-2026-0001\]/)).toBeInTheDocument();
      expect(screen.getByText('Annual Corporate Income Tax Return')).toBeInTheDocument();

      // Linked Disbursement Number
      await waitFor(() => {
        expect(screen.getByTestId('linked-disbursement-disb-1')).toBeInTheDocument();
      });

      const disbItem = screen.getByTestId('linked-disbursement-disb-1');
      expect(disbItem).toHaveTextContent('DISB-ATA-20260418-0001');
      expect(disbItem).toHaveTextContent('BIR DST & Penalties');
    });
  });

  describe('4. OperationsArchiveTab ID Column', () => {
    it('renders ID as the first data column in archived table', async () => {
      const { wrapper } = createHarness();
      render(<OperationsArchiveTab />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('archive-row-wr-101')).toBeInTheDocument();
      });

      const table = screen.getByRole('table');
      const headers = table.querySelectorAll('th');
      expect(headers[0]?.textContent?.trim()).toBe('ID');
      expect(headers[1]?.textContent?.trim()).toBe('Work Request');

      const row = screen.getByTestId('archive-row-wr-101');
      expect(row).toHaveTextContent('WR-ATA-2026-0001');
      expect(row).toHaveTextContent('CLI-ATA-001');
    });
  });

  describe('5. PhaseKanbanBoard Selector & Header Badge', () => {
    it('renders single-line header toolbar with non-wrapping selector, badges, and actions', async () => {
      const { wrapper } = createHarness();
      render(<PhaseKanbanBoard initialWorkRequestId="wr-101" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-wr-select')).toBeInTheDocument();
      });

      // 1. Header Toolbar Card
      const toolbar = screen.getByTestId('kanban-header-toolbar');
      expect(toolbar).toBeInTheDocument();
      expect(toolbar.className).toContain('flex-nowrap');
      expect(toolbar.className).toContain('overflow-x-auto');
      expect(toolbar.className).not.toContain('flex-wrap');
      expect(toolbar.className).not.toContain('flex-col');

      // 2. Work Request Selector Wrapper
      const selectWrapper = screen.getByTestId('kanban-wr-select-wrapper');
      expect(selectWrapper).toBeInTheDocument();
      expect(selectWrapper.className).toContain('w-64');
      expect(selectWrapper.className).toContain('xl:w-72');
      expect(selectWrapper.className).toContain('min-w-[170px]');
      expect(selectWrapper.className).toContain('shrink');

      // SelectTrigger classes and title
      const selectTrigger = screen.getByTestId('kanban-wr-select');
      expect(selectTrigger).toHaveAttribute(
        'title',
        'WR-ATA-2026-0001 · Annual Corporate Income Tax Return (ATA)'
      );
      expect(selectTrigger.className).toContain('overflow-hidden');
      expect(selectTrigger.className).toContain('text-left');
      expect(selectTrigger.className).toContain('[&>span]:truncate');

      // 3. Header badge & inline metadata badges strip
      const badgesContainer = screen.getByTestId('kanban-wr-badges');
      expect(badgesContainer).toBeInTheDocument();
      expect(badgesContainer.className).toContain('flex-nowrap');
      expect(badgesContainer.className).toContain('h-9');
      expect(badgesContainer.className).toContain('shrink-0');
      expect(badgesContainer.className).not.toContain('flex-wrap');

      // Check chips inside badges container
      const numberBadge = screen.getByTestId('kanban-wr-number');
      expect(numberBadge).toHaveTextContent('WR-ATA-2026-0001');
      expect(badgesContainer).toHaveTextContent('ATA');
      expect(badgesContainer).toHaveTextContent('Urgent Priority');
      expect(badgesContainer).toHaveTextContent('Phase: Pre-processing');
      expect(badgesContainer).toHaveTextContent('In Progress');
      expect(badgesContainer).toHaveTextContent('Due:');

      // 4. Header Actions
      const headerActions = screen.getByTestId('kanban-header-actions');
      expect(headerActions).toBeInTheDocument();
      expect(headerActions.className).toContain('flex-nowrap');
      expect(headerActions.className).toContain('h-9');
      expect(headerActions.className).toContain('shrink-0');
    });

    it('sets title and responsive overflow-hidden layout for very long work request title', async () => {
      const { wrapper } = createHarness();
      const longTitleWr: WorkRequest = {
        ...mockWorkRequests[0]!,
        id: 'wr-103',
        workRequestNumber: 'WR-ATA-2026-0003',
        work_request_number: 'WR-ATA-2026-0003',
        title: 'E2E Full Lifecycle Master Compliance & Regulatory Licensing (2026)',
        entity: 'ATA',
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('/tasks')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [mockTask] }),
          } as Response);
        }
        if (u.includes('/operations/work-requests/wr-103')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: longTitleWr }),
          } as Response);
        }
        if (u.includes('/operations/work-requests')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [longTitleWr], meta: { total: 1 } }),
          } as Response);
        }
        if (u.includes('/clients')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
          } as Response);
        }
        if (u.includes('/me/team')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({ data: [] }),
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: {} }),
        } as Response);
      });

      render(<PhaseKanbanBoard initialWorkRequestId="wr-103" />, { wrapper });

      await waitFor(() => {
        expect(screen.getByTestId('kanban-wr-select')).toBeInTheDocument();
      });

      const selectTrigger = screen.getByTestId('kanban-wr-select');
      expect(selectTrigger).toHaveAttribute(
        'title',
        'WR-ATA-2026-0003 · E2E Full Lifecycle Master Compliance & Regulatory Licensing (2026) (ATA)'
      );
      expect(selectTrigger.className).toContain('overflow-hidden');
      expect(selectTrigger.className).toContain('text-left');
      expect(selectTrigger.className).toContain('[&>span]:truncate');

      const selectWrapper = screen.getByTestId('kanban-wr-select-wrapper');
      expect(selectWrapper.className).toContain('w-64');
      expect(selectWrapper.className).toContain('xl:w-72');
      expect(selectWrapper.className).toContain('min-w-[170px]');
      expect(selectWrapper.className).toContain('shrink');

      const toolbar = screen.getByTestId('kanban-header-toolbar');
      expect(toolbar.className).toContain('flex-nowrap');
      expect(toolbar.className).toContain('overflow-x-auto');
      expect(toolbar.className).not.toContain('flex-wrap');
    });
  });
});
