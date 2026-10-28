import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ReceiptViewer } from '../components/ReceiptViewer';
import { DisbursementsTable } from '../components/DisbursementsTable';
import { InvoiceList } from '@/features/billing/components/InvoiceList';
import { DocumentFilterBar } from '@/features/documents/components/DocumentFilterBar';
import { TransmittalTable } from '@/features/transmittals/components/TransmittalTable';
import { PhaseKanbanBoard } from '@/features/operations/components/PhaseKanbanBoard';
import { WorkRequestList } from '@/features/operations/components/WorkRequestList';
import { PendingTasksCard } from '@/features/dashboard/components/PendingTasksCard';
import { matchesDueDate } from '@/lib/dateFilters';
import { useSessionStore } from '@/lib/session';
import type { Transmittal } from '@/features/transmittals/api/types';

vi.mock('@/lib/realtime', () => ({
  useEntityRealtimeSync: vi.fn(),
}));

vi.mock('@/features/operations/api/useWorkRequests', () => ({
  useWorkRequests: () => ({
    data: [
      { id: 'wr-1', title: 'Work Request Alpha', work_order_number: 'WO-001' },
      { id: 'wr-2', title: 'Work Request Beta', work_order_number: 'WO-002' },
    ],
    isLoading: false,
  }),
  useWorkRequestDetail: (id?: string) => ({
    data: { id: id || 'wr-1', title: 'Work Request Alpha', work_order_number: 'WO-001', phase: 'pre_processing', status: 'In Progress' },
    isLoading: false,
  }),
  useWorkRequestTasks: () => ({
    data: [],
    isLoading: false,
  }),
  useWorkRequestMutations: () => ({
    createWorkRequest: vi.fn(),
    updateWorkRequest: vi.fn(),
  }),
  useWorkRequestRelated: () => ({
    data: { tasks: [], documents: [], invoices: [], disbursements: [], transmittals: [] },
    isLoading: false,
  }),
}));

vi.mock('@/features/operations/api/useClients', () => ({
  useClients: () => ({
    data: [
      { id: 'cli-1', name: 'Acme Corp' },
      { id: 'cli-2', name: 'Beta Ltd' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/features/operations/api/useTeam', () => ({
  useTeam: () => ({
    data: [
      { id: 'usr-1', name: 'Alice Manager' },
      { id: 'usr-2', name: 'Bob Staff' },
    ],
    isLoading: false,
  }),
}));

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>{children}</MemoryRouter>
  </QueryClientProvider>
);

describe('Unified Filters, Receipt Toolbar, and Board Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      user: {
        id: 'usr-admin',
        email: 'admin@ata.ph',
        role: 'Admin',
        name: 'Admin User',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: new Set(['disbursement:view', 'billing:view', 'dms:view', 'transmittal:view', 'workflow:view']),
      activeEntity: 'ATA',
    });
  });

  describe('1. ReceiptViewer: Top Card Removal and Compact Toolbar', () => {
    it('does NOT render the top file name/preview action section, but provides compact toolbar with Modal, New tab, and Download', () => {
      render(
        <ReceiptViewer
          receiptFileName="receipt-photo.png"
          receiptS3Key="receipt-photo.png"
          receiptData={{
            filename: 'receipt-photo.png',
            url: 'https://storage.test/receipt.png',
            contentType: 'image/png',
          }}
          onRefetchReceiptUrl={vi.fn()}
        />,
        { wrapper }
      );

      // Verify the removed card does NOT exist
      expect(screen.queryByTestId('receipt-attachment-row')).not.toBeInTheDocument();

      // Verify the compact toolbar controls exist
      expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument();
      expect(screen.getByTestId('btn-open-newtab-receipt')).toBeInTheDocument();
      expect(screen.getByTestId('btn-download-receipt')).toBeInTheDocument();
      expect(screen.getByTestId('btn-refresh-receipt')).toBeInTheDocument();
    });
  });

  describe('2. DisbursementsTable Filters: Work Request, Client, Employee (Admin Only), Due Date', () => {
    it('renders all 4 unified filters for Admin users in a compact single-row toolbar', () => {
      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      expect(screen.getByTestId('filter-work-request-select')).toBeInTheDocument();
      expect(screen.getByTestId('filter-client-select')).toBeInTheDocument();
      expect(screen.getByTestId('filter-employee-select')).toBeInTheDocument();
      expect(screen.getByTestId('filter-due-date-select')).toBeInTheDocument();
    });

    it('hides Employee filter for non-Admin users', () => {
      useSessionStore.setState({
        user: {
          id: 'usr-staff',
          email: 'staff@ata.ph',
          role: 'Staff',
          name: 'Regular Staff',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
      });

      render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });

      expect(screen.getByTestId('filter-work-request-select')).toBeInTheDocument();
      expect(screen.getByTestId('filter-client-select')).toBeInTheDocument();
      expect(screen.queryByTestId('filter-employee-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('filter-due-date-select')).toBeInTheDocument();
    });
  });

  describe('3. InvoiceList Filters: Work Request, Employee (Admin Only), Due Date', () => {
    it('renders Work Request, Client, Employee (Admin only), and Due Date filters', () => {
      render(<InvoiceList />, { wrapper });

      expect(screen.getByTestId('client-filter-select')).toBeInTheDocument();
      expect(screen.getByTestId('work-request-filter-select')).toBeInTheDocument();
      expect(screen.getByTestId('employee-filter-select')).toBeInTheDocument();
      expect(screen.getByTestId('due-date-filter-select')).toBeInTheDocument();
    });

    it('hides Employee filter in InvoiceList for non-Admin users', () => {
      useSessionStore.setState({
        user: {
          id: 'usr-staff',
          email: 'staff@ata.ph',
          role: 'Billing Staff',
          name: 'Billing Staff',
          departments: ['Billing'],
          entities: ['ATA'],
        },
      });

      render(<InvoiceList />, { wrapper });

      expect(screen.getByTestId('client-filter-select')).toBeInTheDocument();
      expect(screen.getByTestId('work-request-filter-select')).toBeInTheDocument();
      expect(screen.queryByTestId('employee-filter-select')).not.toBeInTheDocument();
      expect(screen.getByTestId('due-date-filter-select')).toBeInTheDocument();
    });
  });

  describe('4. DocumentFilterBar: Work Request, Client, Employee (Admin Only), Due Date', () => {
    it('renders all filter selects when handlers and admin role are provided', () => {
      render(
        <DocumentFilterBar
          search=""
          onSearchChange={vi.fn()}
          category=""
          onCategoryChange={vi.fn()}
          lifecycle=""
          onLifecycleChange={vi.fn()}
          workRequest="all"
          onWorkRequestChange={vi.fn()}
          client="all"
          onClientChange={vi.fn()}
          employee="all"
          onEmployeeChange={vi.fn()}
          dueDate="all"
          onDueDateChange={vi.fn()}
          workRequests={[{ id: 'wr-1', title: 'Work Request Alpha' }]}
          clients={[{ id: 'cli-1', name: 'Acme Corp' }]}
          team={[{ id: 'usr-1', name: 'Alice Manager' }]}
          isAdmin={true}
          onReset={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('document-work-request-filter')).toBeInTheDocument();
      expect(screen.getByTestId('document-client-filter')).toBeInTheDocument();
      expect(screen.getByTestId('document-employee-filter')).toBeInTheDocument();
      expect(screen.getByTestId('document-due-date-filter')).toBeInTheDocument();
    });

    it('hides Employee filter in DocumentFilterBar when isAdmin is false', () => {
      render(
        <DocumentFilterBar
          search=""
          onSearchChange={vi.fn()}
          category=""
          onCategoryChange={vi.fn()}
          lifecycle=""
          onLifecycleChange={vi.fn()}
          workRequest="all"
          onWorkRequestChange={vi.fn()}
          client="all"
          onClientChange={vi.fn()}
          employee="all"
          onEmployeeChange={vi.fn()}
          dueDate="all"
          onDueDateChange={vi.fn()}
          isAdmin={false}
          onReset={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('document-work-request-filter')).toBeInTheDocument();
      expect(screen.getByTestId('document-client-filter')).toBeInTheDocument();
      expect(screen.queryByTestId('document-employee-filter')).not.toBeInTheDocument();
      expect(screen.getByTestId('document-due-date-filter')).toBeInTheDocument();
    });
  });

  describe('5. TransmittalTable Filters: Work Request, Client, Employee (Admin Only), Due Date', () => {
    const mockTransmittals: Transmittal[] = [
      {
        id: 'trans-1',
        tracking_number: 'TR-202610-001',
        entity_id: 'ent-1',
        client_id: 'cli-1',
        work_request_id: 'wr-1',
        status: 'Draft',
        approved: false,
        board_order: 1,
        archived: false,
        version: 1,
        created_at: new Date().toISOString(),
        created_by: 'usr-1',
        clients: { name: 'Acme Corp' },
      },
    ];

    const transmittalHandlers = {
      onView: vi.fn(),
      onEdit: vi.fn(),
      onPrint: vi.fn(),
      onApprove: vi.fn(),
      onSend: vi.fn(),
      onAcknowledge: vi.fn(),
      onArchive: vi.fn(),
      onUnarchive: vi.fn(),
      onDelete: vi.fn(),
    };

    it('renders Work Request, Client, Employee (Admin only), and Due Date in transmittal filters bar', () => {
      render(<TransmittalTable transmittals={mockTransmittals} {...transmittalHandlers} />, { wrapper });

      expect(screen.getByTestId('transmittal-status-filter')).toBeInTheDocument();
      expect(screen.getByTestId('transmittal-work-request-filter')).toBeInTheDocument();
      expect(screen.getByTestId('transmittal-client-filter')).toBeInTheDocument();
      expect(screen.getByTestId('transmittal-employee-filter')).toBeInTheDocument();
      expect(screen.getByTestId('transmittal-due-date-filter')).toBeInTheDocument();
    });

    it('hides Employee filter in TransmittalTable for non-Admin users', () => {
      useSessionStore.setState({
        user: {
          id: 'usr-staff',
          email: 'staff@ata.ph',
          role: 'Documentation',
          name: 'Documentation Staff',
          departments: ['Documentation'],
          entities: ['ATA'],
        },
      });

      render(<TransmittalTable transmittals={mockTransmittals} {...transmittalHandlers} />, { wrapper });

      expect(screen.getByTestId('transmittal-work-request-filter')).toBeInTheDocument();
      expect(screen.getByTestId('transmittal-client-filter')).toBeInTheDocument();
      expect(screen.queryByTestId('transmittal-employee-filter')).not.toBeInTheDocument();
      expect(screen.getByTestId('transmittal-due-date-filter')).toBeInTheDocument();
    });
  });

  describe('6. matchesDueDate Utility', () => {
    it('correctly matches overdue, today, this_week, and this_month', () => {
      const todayStr = new Date().toISOString();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 2);
      const overdueStr = yesterday.toISOString();
      const nextThreeDays = new Date();
      nextThreeDays.setDate(nextThreeDays.getDate() + 3);
      const nextThreeDaysStr = nextThreeDays.toISOString();

      expect(matchesDueDate(overdueStr, 'overdue', false)).toBe(true);
      expect(matchesDueDate(overdueStr, 'overdue', true)).toBe(false); // finished items not overdue
      expect(matchesDueDate(todayStr, 'today')).toBe(true);
      expect(matchesDueDate(nextThreeDaysStr, 'this_week')).toBe(true);
      expect(matchesDueDate(todayStr, 'all')).toBe(true);
      expect(matchesDueDate(null, 'no_date')).toBe(true);
      expect(matchesDueDate(todayStr, 'no_date')).toBe(false);
    });
  });

  describe('7. PhaseKanbanBoard Side Peek: opens directly over board and closes on 1st click', () => {
    it('opens WorkRequestSidePeek on clicking Work Request Details without navigating away from the board', async () => {
      render(<PhaseKanbanBoard initialWorkRequestId="wr-1" />, { wrapper });

      const wrDetailsBtn = await screen.findByTestId('kanban-back-sidepeek-btn');
      expect(wrDetailsBtn).toBeInTheDocument();

      // Click Work Request Details
      fireEvent.click(wrDetailsBtn);

      // Side Peek opens directly over the board
      const sidePeek = await screen.findByTestId('wr-side-peek');
      expect(sidePeek).toBeInTheDocument();

      // Click "Board" button inside side peek -> closes on very first click!
      const boardBtn = screen.getByTestId('side-peek-board-btn');
      fireEvent.click(boardBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('wr-side-peek')).not.toBeInTheDocument();
      });

      // User remains on the board!
      expect(screen.getByTestId('kanban-back-sidepeek-btn')).toBeInTheDocument();
    });
  });

  describe('8. Operations & Dashboard: Removal of Assigned to Me Quick Filter', () => {
    it('does NOT render Assigned to Me toggle button in WorkRequestList', () => {
      render(<WorkRequestList />, { wrapper });
      expect(screen.queryByTestId('assigned-to-me-btn')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /assigned to me/i })).not.toBeInTheDocument();
    });

    it('does NOT render Assigned to Me filter pill in PendingTasksCard', () => {
      render(<PendingTasksCard />, { wrapper });
      expect(screen.queryByRole('button', { name: /^assigned to me$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^all assignees$/i })).not.toBeInTheDocument();
    });
  });
});
