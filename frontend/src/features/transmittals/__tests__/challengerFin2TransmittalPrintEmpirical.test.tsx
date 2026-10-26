import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TransmittalPrintModal } from '../components/TransmittalPrintModal';
import type { Transmittal, TransmittalItem } from '../api/types';

function createMockTransmittal(overrides: Partial<Transmittal> = {}): Transmittal {
  return {
    id: 'tx-empirical-01',
    tracking_number: 'TR-2026-00099',
    entity_id: 'ent-ata',
    entity_code: 'ATA',
    client_id: 'c-100',
    clients: {
      name: 'Alpha Mega Corporation',
      address: 'Suite 801 Ayala Tower One, Ayala Avenue, Makati City',
      tin: '123-456-789-000',
    },
    work_request_id: 'wr-200',
    linked_task_id: null,
    status: 'Draft',
    approved: true,
    board_order: 1,
    notes: 'Urgent BIR transmittal package.',
    recipient_name: 'Atty. Maria Santos',
    recipient_details: 'General Counsel',
    received_by_name: null,
    sent_at: '2026-10-05T08:30:00.000Z',
    created_at: '2026-10-05T08:00:00.000Z',
    archived: false,
    version: 1,
    items: [],
    ...overrides,
  };
}

function generateItems(count: number): TransmittalItem[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `item-gen-${idx + 1}`,
    transmittal_id: 'tx-empirical-01',
    description: `Official Document Record ${idx + 1}`,
    document_type: idx % 2 === 0 ? 'Tax' : 'Contract',
    quantity: (idx % 3) + 1,
    sort_order: idx + 1,
  }));
}

describe('CHALLENGER FIN 2: Transmittal Print Empirical Verification Suite', () => {
  // =========================================================================
  // 1. Stress-test Item Counts: 0, 1, 5, 15 items & Filler Row Elimination
  // =========================================================================
  describe('Manifest Row Cardinality & 12-Row Filler Elimination', () => {
    it('verifies 0 items: exactly 0 data rows, NO filler rows, exactly 1 table header row', () => {
      const transmittal = createMockTransmittal({ items: [] });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      const itemsTable = screen.getByTestId('print-items-table');
      const tableRows = within(itemsTable).getAllByRole('row');

      // Exactly 1 row total in the table (the header row CATEGORY | DOCUMENT)
      expect(tableRows).toHaveLength(1);

      // No data row testids exist
      expect(screen.queryByTestId('print-item-row-0')).not.toBeInTheDocument();
      expect(screen.queryByTestId('print-item-row-11')).not.toBeInTheDocument();

      // Table tbody has 0 child tr elements
      const tbody = itemsTable.querySelector('tbody');
      expect(tbody).toBeInTheDocument();
      expect(tbody?.children).toHaveLength(0);
    });

    it('verifies 1 item: exactly 1 data row, NO filler rows, exactly 2 table rows', () => {
      const transmittal = createMockTransmittal({
        items: generateItems(1),
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      const itemsTable = screen.getByTestId('print-items-table');
      const tableRows = within(itemsTable).getAllByRole('row');

      // Exactly 2 rows: 1 thead + 1 tbody
      expect(tableRows).toHaveLength(2);

      // print-item-row-0 exists
      const row0 = screen.getByTestId('print-item-row-0');
      expect(row0).toBeInTheDocument();
      expect(row0).toHaveTextContent('TAX');
      expect(row0).toHaveTextContent('OFFICIAL DOCUMENT RECORD 1');

      // No filler rows (row 1, 11, etc. must not exist)
      expect(screen.queryByTestId('print-item-row-1')).not.toBeInTheDocument();
      expect(screen.queryByTestId('print-item-row-11')).not.toBeInTheDocument();

      const tbody = itemsTable.querySelector('tbody');
      expect(tbody?.children).toHaveLength(1);
    });

    it('verifies 5 items: exactly 5 data rows, NO filler rows, exactly 6 table rows', () => {
      const transmittal = createMockTransmittal({
        items: generateItems(5),
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      const itemsTable = screen.getByTestId('print-items-table');
      const tableRows = within(itemsTable).getAllByRole('row');

      // Exactly 6 rows: 1 thead + 5 tbody
      expect(tableRows).toHaveLength(6);

      // Verify all 5 rows exist with their respective index testids
      for (let i = 0; i < 5; i++) {
        expect(screen.getByTestId(`print-item-row-${i}`)).toBeInTheDocument();
      }

      // No row 5 or filler row 11
      expect(screen.queryByTestId('print-item-row-5')).not.toBeInTheDocument();
      expect(screen.queryByTestId('print-item-row-11')).not.toBeInTheDocument();

      const tbody = itemsTable.querySelector('tbody');
      expect(tbody?.children).toHaveLength(5);
    });

    it('verifies 15 items: renders ALL 15 items, surpassing prototype 12-row cap without truncation', () => {
      const transmittal = createMockTransmittal({
        items: generateItems(15),
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      const itemsTable = screen.getByTestId('print-items-table');
      const tableRows = within(itemsTable).getAllByRole('row');

      // Exactly 16 rows: 1 thead + 15 tbody
      expect(tableRows).toHaveLength(16);

      // Verify all 15 rows exist (0 through 14)
      for (let i = 0; i < 15; i++) {
        expect(screen.getByTestId(`print-item-row-${i}`)).toBeInTheDocument();
      }

      // Row 15 must not exist
      expect(screen.queryByTestId('print-item-row-15')).not.toBeInTheDocument();

      const tbody = itemsTable.querySelector('tbody');
      expect(tbody?.children).toHaveLength(15);
    });
  });

  // =========================================================================
  // 2. Manila Office Header & Entity Details
  // =========================================================================
  describe('Manila Office Header Verbatim Rendering', () => {
    it('renders verbatim Manila company address and ATA entity particulars', () => {
      const transmittal = createMockTransmittal({
        entity_code: 'ATA',
        sent_at: '2026-10-05T08:30:00.000Z',
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      // Form title
      expect(screen.getByText('DOCUMENT TRANSMITTAL FORM')).toBeInTheDocument();

      // Company Name
      expect(screen.getByText('ATA BUSINESS CONSULTANCY SERVICES')).toBeInTheDocument();

      // Verbatim Manila Address
      expect(
        within(document.getElementById('transmittal-print-area')!).getByText(
          /RM 307 Republic Supermarket Bldg, Soler St\., cor\. F\.Torres St\., Sta\. Cruz, Manila/i
        )
      ).toBeInTheDocument();

      // ATA TIN
      expect(screen.getByText('TIN: 234-567-890-000')).toBeInTheDocument();

      // Tracking number
      expect(screen.getByTestId('print-tracking-number')).toHaveTextContent('TR-2026-00099');

      // Date in uppercase full month for ATA
      expect(screen.getByText(/OCTOBER \d+, 2026/)).toBeInTheDocument();

      // TO 4-line block
      expect(screen.getByTestId('print-recipient-name')).toHaveTextContent('Atty. Maria Santos');
      expect(screen.getByTestId('print-client-name')).toHaveTextContent('(Alpha Mega Corporation)');
      expect(screen.getByText('Suite 801 Ayala Tower One')).toBeInTheDocument();
      expect(screen.getByText('Ayala Avenue, Makati City')).toBeInTheDocument();
    });

    it('renders LTA entity particulars and numeric date format', () => {
      const transmittal = createMockTransmittal({
        entity_code: 'LTA',
        tracking_number: 'LTA-TR-2026-088',
        sent_at: '2026-10-05T08:30:00.000Z',
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      // LTA Company Name
      expect(screen.getByText('LTA BUSINESS CONSULTANCY SERVICES')).toBeInTheDocument();

      // LTA TIN
      expect(screen.getByText('TIN: 345-678-901-000')).toBeInTheDocument();

      // Manila address is constant across entities
      expect(
        within(document.getElementById('transmittal-print-area')!).getByText(
          /RM 307 Republic Supermarket Bldg, Soler St\., cor\. F\.Torres St\., Sta\. Cruz, Manila/i
        )
      ).toBeInTheDocument();

      // Tracking number
      expect(screen.getByTestId('print-tracking-number')).toHaveTextContent('LTA-TR-2026-088');

      // LTA client name without parentheses
      expect(screen.getByTestId('print-client-name')).toHaveTextContent('Alpha Mega Corporation');

      // LTA Date format is M/D/YYYY
      expect(screen.getByText('10/5/2026')).toBeInTheDocument();
    });

    it('renders empty string on Line 2 (print-client-name) when recipient_name is empty, avoiding company name duplication', () => {
      const transmittal = createMockTransmittal({
        entity_code: 'ATA',
        recipient_name: '',
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      // Line 1 displays client name
      expect(screen.getByTestId('print-recipient-name')).toHaveTextContent(
        'Alpha Mega Corporation'
      );

      // Line 2 MUST be empty string (no duplicate (Alpha Mega Corporation))
      const clientNameEl = screen.getByTestId('print-client-name');
      expect(clientNameEl).toHaveTextContent('');
      expect(screen.queryByText('(Alpha Mega Corporation)')).toBeNull();
    });
  });

  // =========================================================================
  // 3. Signature Block & Dynamic Status Stamps
  // =========================================================================
  describe('Signature Block and Status Stamps', () => {
    it('renders centered signature block with empty name/date on Draft transmittal', () => {
      const transmittal = createMockTransmittal({
        status: 'Draft',
        received_by_name: null,
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      // Signature block label
      expect(screen.getByText('Signature over Printed name / Date Received')).toBeInTheDocument();

      // No received stamp on Draft
      expect(screen.queryByTestId('print-received-stamp')).not.toBeInTheDocument();
    });

    it('does NOT render RECEIVED stamp on Sent transmittal', () => {
      const transmittal = createMockTransmittal({
        status: 'Sent',
        sent_at: '2026-10-05T09:00:00.000Z',
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      expect(screen.queryByTestId('print-received-stamp')).not.toBeInTheDocument();
    });

    it('renders rotated RECEIVED stamp and populated signature block on Acknowledged transmittal', () => {
      const transmittal = createMockTransmittal({
        status: 'Acknowledged',
        received_by_name: 'Elena Ramos',
        acknowledged_at: '2026-10-05T14:45:00.000Z',
      });

      render(<TransmittalPrintModal transmittal={transmittal} isOpen={true} onClose={vi.fn()} />);

      // Received stamp must be present
      const stamp = screen.getByTestId('print-received-stamp');
      expect(stamp).toBeInTheDocument();
      expect(stamp).toHaveTextContent('RECEIVED');

      // Stamp recipient name
      expect(screen.getByTestId('stamp-recipient-name')).toHaveTextContent('Elena Ramos');

      // Stamp date
      expect(screen.getByTestId('stamp-acknowledged-date')).toBeInTheDocument();

      // Signature block populated with uppercase name
      expect(screen.getByText('ELENA RAMOS')).toBeInTheDocument();

      // Signature block date format (M/D/YY)
      expect(screen.getByText('10/5/26')).toBeInTheDocument();
    });
  });
});
