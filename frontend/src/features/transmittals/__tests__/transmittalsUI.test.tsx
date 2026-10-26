import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TransmittalCard } from '../components/TransmittalCard';
import { TransmittalKanbanBoard } from '../components/TransmittalKanbanBoard';
import { TransmittalTable } from '../components/TransmittalTable';
import { TransmittalFormModal } from '../components/TransmittalFormModal';
import { TransmittalPrintModal } from '../components/TransmittalPrintModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Transmittal } from '../api/types';

function createHarness() {
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

const mockTransmittals: Transmittal[] = [
  {
    id: 'tx-101',
    tracking_number: 'TR-ATA-2026-0101',
    entity_id: 'ent-1',
    entity_code: 'ATA',
    client_id: '11111111-1111-1111-1111-111111111111',
    status: 'Draft',
    approved: false,
    board_order: 0,
    version: 1,
    recipient_name: 'Juan Dela Cruz',
    created_at: new Date().toISOString(),
    archived: false,
    clients: { name: 'Acme Corp', address: 'Makati City', tin: '123-456' },
    items: [
      {
        id: 'i-1',
        description: 'BIR Annual Return',
        document_type: 'Tax',
        quantity: 2,
      },
      {
        id: 'i-2',
        description: 'SEC GIS 2026',
        document_type: 'SEC',
        quantity: 1,
      },
    ],
  },
  {
    id: 'tx-102',
    tracking_number: 'TR-ATA-2026-0102',
    entity_id: 'ent-1',
    entity_code: 'ATA',
    client_id: '11111111-1111-1111-1111-111111111111',
    status: 'Draft',
    approved: true, // Approved by Admin!
    board_order: 1,
    version: 1,
    recipient_name: 'Maria Santos',
    created_at: new Date().toISOString(),
    archived: false,
    clients: { name: 'Apex Logistics' },
    items: [
      {
        id: 'i-3',
        description: 'Board Resolution',
        document_type: 'Contract',
        quantity: 1,
      },
    ],
  },
  {
    id: 'tx-103',
    tracking_number: 'TR-ATA-2026-0103',
    entity_id: 'ent-1',
    entity_code: 'ATA',
    client_id: '11111111-1111-1111-1111-111111111111',
    status: 'Sent',
    approved: true,
    board_order: 0,
    version: 1,
    sent_at: '2026-10-04T05:30:00.000Z',
    recipient_name: 'Pedro Reyes',
    created_at: new Date().toISOString(),
    archived: false,
    clients: { name: 'Zenith Holdings' },
    items: [
      {
        id: 'i-4',
        description: 'Articles of Incorporation',
        document_type: 'SEC',
        quantity: 1,
      },
    ],
  },
  {
    id: 'tx-104',
    tracking_number: 'TR-ATA-2026-0104',
    entity_id: 'ent-1',
    entity_code: 'ATA',
    client_id: '11111111-1111-1111-1111-111111111111',
    status: 'Acknowledged',
    approved: true,
    board_order: 0,
    version: 1,
    sent_at: '2026-10-04T05:00:00.000Z',
    acknowledged_at: '2026-10-04T06:15:00.000Z',
    recipient_name: 'Elena Ramos',
    created_at: new Date().toISOString(),
    archived: false,
    clients: { name: 'Titan Industries' },
    items: [
      {
        id: 'i-5',
        description: 'Original Contract Copy',
        document_type: 'Contract',
        quantity: 1,
      },
    ],
  },
];

describe('Transmittals UI Integration & Behavioral Parity', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    useBlockingModalStore.getState().reset();
  });

  // ==========================================================================
  // 1. Kanban Board & DnD Structure
  // ==========================================================================

  describe('Kanban Board Swimlanes & Card Rendering', () => {
    it('renders the 3 required swimlanes: Draft, Sent, Acknowledged', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-1', email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', departments: ['Operations'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:create', 'transmittal:edit', 'transmittal:approve', 'transmittal:mark'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalKanbanBoard
          transmittals={mockTransmittals}
          onView={vi.fn()}
          onEdit={vi.fn()}
          onPrint={vi.fn()}
          onApprove={vi.fn()}
          onSend={vi.fn()}
          onAcknowledge={vi.fn()}
          onDelete={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('kanban-column-draft')).toBeInTheDocument();
      expect(screen.getByTestId('kanban-column-sent')).toBeInTheDocument();
      expect(screen.getByTestId('kanban-column-acknowledged')).toBeInTheDocument();

      // Check counts: 2 Drafts, 1 Sent, 1 Acknowledged
      expect(screen.getByTestId('kanban-count-draft')).toHaveTextContent('2');
      expect(screen.getByTestId('kanban-count-sent')).toHaveTextContent('1');
      expect(screen.getByTestId('kanban-count-acknowledged')).toHaveTextContent('1');
    });

    it('persists board_order upon HTML5 drop without speculative cache mutation', async () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-1', email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', departments: ['Operations'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:edit'],
        activeEntity: 'ATA',
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: { ...mockTransmittals[0], board_order: 1 } }),
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalKanbanBoard
          transmittals={mockTransmittals}
          onView={vi.fn()}
          onEdit={vi.fn()}
          onPrint={vi.fn()}
          onApprove={vi.fn()}
          onSend={vi.fn()}
          onAcknowledge={vi.fn()}
          onDelete={vi.fn()}
        />,
        { wrapper }
      );

      const draftColumn = screen.getByTestId('kanban-column-draft');

      // Trigger HTML5 drop event
      fireEvent.drop(draftColumn, {
        dataTransfer: {
          getData: () => 'tx-101',
        },
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
        const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(fetchCall).toBeDefined();
        expect(fetchCall![0]).toContain('/transmittals/tx-101');
        const body = JSON.parse(fetchCall![1]?.body as string);
        expect(body.boardOrder).toBeDefined();
      });
    });
  });

  // ==========================================================================
  // 2. Dual-Path Admin Approval & Send Semantics
  // ==========================================================================

  describe('Dual-Path Admin Approval & Delegation UX', () => {
    it('Admin sees Approve button on Draft transmittals', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-admin', email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', departments: ['Operations'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:approve', 'transmittal:mark'],
        activeEntity: 'ATA',
      });

      const onApproveMock = vi.fn();
      const { wrapper } = createHarness();
      render(
        <TransmittalCard
          transmittal={mockTransmittals[0]!} // Draft unapproved
          onView={vi.fn()}
          onPrint={vi.fn()}
          onApprove={onApproveMock}
          onSend={vi.fn()}
        />,
        { wrapper }
      );

      const approveBtn = screen.getByTestId('approve-transmittal-btn');
      expect(approveBtn).toBeInTheDocument();
      fireEvent.click(approveBtn);
      expect(onApproveMock).toHaveBeenCalledWith('tx-101');
    });

    it('Non-Admin (Documentation/Manager) cannot see Approve button', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-doc', email: 'doc@ata-lta.ph', name: 'Doc Staff', role: 'Manager', departments: ['Documentation'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:mark'], // lacks transmittal:approve
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalCard
          transmittal={mockTransmittals[0]!} // Draft unapproved
          onView={vi.fn()}
          onPrint={vi.fn()}
          onApprove={vi.fn()}
          onSend={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.queryByTestId('approve-transmittal-btn')).not.toBeInTheDocument();
    });

    it('Non-Admin sees Mark Sent DISABLED with explanatory tooltip on UNAPPROVED draft', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-doc', email: 'doc@ata-lta.ph', name: 'Doc Staff', role: 'Manager', departments: ['Documentation'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:mark'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalCard
          transmittal={mockTransmittals[0]!} // approved === false
          onView={vi.fn()}
          onPrint={vi.fn()}
          onSend={vi.fn()}
        />,
        { wrapper }
      );

      const sendBtn = screen.getByTestId('send-transmittal-btn');
      expect(sendBtn).toBeDisabled();

      // Tooltip contains required explanation
      expect(screen.getByTestId('send-disabled-tooltip')).toHaveTextContent(
        'Requires Admin approval before sending'
      );
    });

    it('Non-Admin sees Mark Sent ENABLED when draft has approved === true', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-doc', email: 'doc@ata-lta.ph', name: 'Doc Staff', role: 'Manager', departments: ['Documentation'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:mark'],
        activeEntity: 'ATA',
      });

      const onSendMock = vi.fn();
      const { wrapper } = createHarness();
      render(
        <TransmittalCard
          transmittal={mockTransmittals[1]!} // approved === true
          onView={vi.fn()}
          onPrint={vi.fn()}
          onSend={onSendMock}
        />,
        { wrapper }
      );

      const sendBtn = screen.getByTestId('send-transmittal-btn');
      expect(sendBtn).not.toBeDisabled();

      fireEvent.click(sendBtn);
      expect(onSendMock).toHaveBeenCalledWith(mockTransmittals[1]);
    });
  });

  // ==========================================================================
  // 3. Print Modal: Item-Rows-Only & Received Stamp
  // ==========================================================================

  describe('Print Modal Item-Rows-Only & Dynamic RECEIVED Stamp', () => {
    it('renders item-rows-only manifest table with Manila address (prototype parity)', () => {
      const transmittal = mockTransmittals[0]!; // 2 items
      render(
        <TransmittalPrintModal
          transmittal={transmittal}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      // Verify exact 2 data item rows exist
      expect(screen.getByTestId('print-item-row-0')).toBeInTheDocument();
      expect(screen.getByTestId('print-item-row-1')).toBeInTheDocument();
      // Verify no empty filler rows (e.g. 11) exist
      expect(screen.queryByTestId('print-item-row-11')).not.toBeInTheDocument();

      // Verify Manila address is rendered
      expect(
        within(document.getElementById('transmittal-print-area')!).getByText(/RM 307 Republic Supermarket Bldg, Soler St\., cor\. F\.Torres St\., Sta\. Cruz, Manila/i)
      ).toBeInTheDocument();

      // Item-rows-only manifest: exactly 1 table header row + 2 data item rows = 3 rows in items table
      const itemsTable = screen.getByTestId('print-items-table');
      const tableRows = within(itemsTable).getAllByRole('row');
      expect(tableRows).toHaveLength(3);
    });

    it('renders dynamic RECEIVED stamp when status is Acknowledged', () => {
      const ackTransmittal = mockTransmittals[3]!; // status === 'Acknowledged'
      render(
        <TransmittalPrintModal
          transmittal={ackTransmittal}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      const stamp = screen.getByTestId('print-received-stamp');
      expect(stamp).toBeInTheDocument();
      expect(stamp).toHaveTextContent('RECEIVED');
      expect(screen.getByTestId('stamp-recipient-name')).toHaveTextContent('Elena Ramos');
    });

    it('does NOT render RECEIVED stamp on Draft or Sent transmittals', () => {
      const draftTransmittal = mockTransmittals[0]!; // Draft
      const { rerender } = render(
        <TransmittalPrintModal
          transmittal={draftTransmittal}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByTestId('print-received-stamp')).not.toBeInTheDocument();

      const sentTransmittal = mockTransmittals[2]!; // Sent
      rerender(
        <TransmittalPrintModal
          transmittal={sentTransmittal}
          isOpen={true}
          onClose={vi.fn()}
        />
      );

      expect(screen.queryByTestId('print-received-stamp')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // 4. Form Modal Line Items Manager Validation
  // ==========================================================================

  describe('Line Item Manager Validation in Form Modal', () => {
    it('requires at least 1 valid document row before creation', async () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-1', email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', departments: ['Operations'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:create'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalFormModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      // Submit with empty description in default row
      const submitBtn = screen.getByTestId('submit-transmittal-btn');
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByTestId('items-error-message')).toBeInTheDocument();
      });
    });

    it('allows adding and removing rows', () => {
      const { wrapper } = createHarness();
      render(
        <TransmittalFormModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('transmittal-form-item-row-0')).toBeInTheDocument();
      expect(screen.queryByTestId('transmittal-form-item-row-1')).not.toBeInTheDocument();

      // Click Add Document Row
      fireEvent.click(screen.getByTestId('add-item-row-btn'));

      expect(screen.getByTestId('transmittal-form-item-row-1')).toBeInTheDocument();

      // Remove row
      fireEvent.click(screen.getByTestId('remove-item-row-btn-1'));
      expect(screen.queryByTestId('transmittal-form-item-row-1')).not.toBeInTheDocument();
    });

    it('renders tracking number as disabled/read-only displaying "Auto-generated on Save" in create mode', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-1', email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', departments: ['Operations'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:create'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalFormModal
          isOpen={true}
          onClose={vi.fn()}
        />,
        { wrapper }
      );

      const trackingInput = screen.getByTestId('tracking-number-input');
      expect(trackingInput).toBeDisabled();
      expect(trackingInput).toHaveValue('Auto-generated on Save');
    });

    it('renders tracking number as disabled/read-only displaying existing tracking number in edit mode', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-1', email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', departments: ['Operations'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view', 'transmittal:edit'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalFormModal
          isOpen={true}
          onClose={vi.fn()}
          transmittalToEdit={mockTransmittals[0]}
        />,
        { wrapper }
      );

      const trackingInput = screen.getByTestId('tracking-number-input');
      expect(trackingInput).toBeDisabled();
      expect(trackingInput).toHaveValue(mockTransmittals[0]!.tracking_number);
    });
  });

  // ==========================================================================
  // 5. Transmittal Table Filtering
  // ==========================================================================

  describe('Transmittal Table Filtering', () => {
    it('filters rows by search term across tracking number and recipient', () => {
      useSessionStore.getState().setSession({
        user: { id: 'u-1', email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', departments: ['Operations'], entities: ['ATA', 'LTA'] },
        permissions: ['transmittal:view'],
        activeEntity: 'ATA',
      });

      const { wrapper } = createHarness();
      render(
        <TransmittalTable
          transmittals={mockTransmittals}
          onView={vi.fn()}
          onEdit={vi.fn()}
          onPrint={vi.fn()}
          onApprove={vi.fn()}
          onSend={vi.fn()}
          onAcknowledge={vi.fn()}
          onArchive={vi.fn()}
          onUnarchive={vi.fn()}
          onDelete={vi.fn()}
        />,
        { wrapper }
      );

      expect(screen.getByTestId('transmittal-row-tx-101')).toBeInTheDocument();
      expect(screen.getByTestId('transmittal-row-tx-102')).toBeInTheDocument();

      // Search for Elena
      const searchInput = screen.getByTestId('transmittal-search-input');
      fireEvent.change(searchInput, { target: { value: 'Elena' } });

      expect(screen.getByTestId('transmittal-row-tx-104')).toBeInTheDocument();
      expect(screen.queryByTestId('transmittal-row-tx-101')).not.toBeInTheDocument();
    });
  });
});
