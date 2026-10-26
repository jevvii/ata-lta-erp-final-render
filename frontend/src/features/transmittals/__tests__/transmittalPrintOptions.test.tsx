import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { TransmittalCard } from '../components/TransmittalCard';
import { TransmittalPrintModal } from '../components/TransmittalPrintModal';
import { printTransmittalDocument } from '@/lib/printDocuments';
import { useSessionStore } from '@/lib/session';
import type { Transmittal } from '../api/types';

const transmittal: Transmittal = {
  id: 'tx-options', tracking_number: 'TR-001', entity_id: 'ata', entity_code: 'ATA',
  client_id: 'client', status: 'Sent', approved: true, board_order: 0, archived: false,
  version: 1, created_at: '2026-10-01', recipient_details: 'Deliver to reception', clients: { name: 'Client' },
  items: [{ id: 'doc-1', description: 'Tax return', document_type: 'Tax', quantity: 2 }],
};

function capturePrint() {
  const write = vi.fn();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { open: vi.fn(), write, close: vi.fn() }, focus: vi.fn(), print: vi.fn(),
  } as unknown as Window);
  return () => new DOMParser().parseFromString(write.mock.calls.at(-1)?.[0] as string, 'text/html');
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Transmittal company options and complete print manifest', () => {
  it('omits the received stamp from final PDF HTML while retaining acknowledgment signature details', () => {
    const printed = capturePrint();
    printTransmittalDocument({ ...transmittal, status: 'Acknowledged', acknowledged_at: '2026-10-12', received_by_name: 'Recipient' });
    expect(printed().querySelector('.received-stamp')).toBeNull();
    expect(printed().querySelector('.sig-name')?.textContent).toBe('RECIPIENT');
    expect(printed().querySelector('style')?.textContent).toContain('@page { size: letter; margin: 0; }');
  });

  it('uses edited company details in preview and escaped final print/PDF HTML', () => {
    const printed = capturePrint();
    render(<TransmittalPrintModal isOpen transmittal={transmittal} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: '<Acme & Co>' } });
    fireEvent.change(screen.getByLabelText('Company Address'), { target: { value: 'Floor 3\nManila' } });
    const sheet = document.getElementById('transmittal-print-area')!;
    expect(within(sheet).getByText('<Acme & Co>')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('print-action-btn'));
    expect(printed().querySelector('.from-cell')?.textContent).toContain('<Acme & Co>');
    expect(printed().querySelector('.from-cell')?.innerHTML).toContain('Floor 3<br>Manila');
    expect(printed().querySelector('.from-cell acme')).toBeNull();
    expect(printed().querySelector('.document-cell')?.textContent).toContain('(QTY: 2)');
    expect(printed().querySelector('.to-cell')?.textContent).toContain('Deliver to reception');
    expect(within(sheet).getByText('Deliver to reception')).toBeInTheDocument();
  });

  it('omits FROM and expands TO in both preview and final output', () => {
    const printed = capturePrint();
    render(<TransmittalPrintModal isOpen transmittal={transmittal} onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Include company details (FROM)'));
    expect(screen.queryByText('FROM:')).not.toBeInTheDocument();
    expect(screen.getByText('TO:').closest('td')).toHaveAttribute('colspan', '2');
    fireEvent.click(screen.getByTestId('print-action-btn'));
    expect(printed().querySelector('.from-cell')).toBeNull();
    expect(printed().querySelector('.to-cell')?.getAttribute('colspan')).toBe('2');
  });

  it.each([0, 1, 15])('prints exactly %i nonblank documents without padding or truncation', (count) => {
    const printed = capturePrint();
    const items = Array.from({ length: count }, (_, index) => ({
      id: String(index), description: `Document ${index + 1}`, quantity: 1,
    }));
    const data = { ...transmittal, items: [...items, { id: 'blank', description: '  ', quantity: 1 }] };
    render(<TransmittalPrintModal isOpen transmittal={data} onClose={vi.fn()} />);
    expect(screen.getByTestId('print-items-table').querySelectorAll('tbody tr')).toHaveLength(count);
    printTransmittalDocument(data);
    expect(printed().querySelectorAll('.document-table tbody tr')).toHaveLength(count);
    if (count) expect(printed().body.textContent).toContain(`DOCUMENT ${count}`);
  });

  it('resets company options when changing transmittals', () => {
    const { rerender } = render(<TransmittalPrintModal isOpen transmittal={transmittal} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Company Name'), { target: { value: 'Custom sender' } });
    rerender(<TransmittalPrintModal isOpen transmittal={{ ...transmittal, id: 'lta', entity_code: 'LTA' }} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Company Name')).toHaveValue('LTA BUSINESS CONSULTANCY SERVICES');
  });

  it.each(['Admin', 'Documentation'] as const)('exposes saved-content editing only to Admin (%s)', (role) => {
    useSessionStore.getState().setSession({
      user: { id: 'user', name: 'User', email: 'user@example.com', role, entities: ['ATA'], departments: [] },
      permissions: ['transmittal:view', 'transmittal:edit'], activeEntity: 'ATA',
    });
    const onEdit = vi.fn();
    render(<TransmittalPrintModal isOpen transmittal={transmittal} onClose={vi.fn()} onEdit={onEdit} />);
    if (role === 'Admin') {
      fireEvent.click(screen.getByRole('button', { name: 'Edit contents' }));
      expect(onEdit).toHaveBeenCalledWith(transmittal);
    } else {
      expect(screen.queryByRole('button', { name: 'Edit contents' })).not.toBeInTheDocument();
    }
  });
  it.each(['Sent', 'Acknowledged'] as const)('allows Admin to open the existing editor for %s records', (status) => {
    useSessionStore.getState().setSession({
      user: { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'Admin', entities: ['ATA'], departments: [] },
      permissions: ['transmittal:edit'], activeEntity: 'ATA',
    });
    const onEdit = vi.fn();
    render(<TransmittalCard transmittal={{ ...transmittal, status }} onView={vi.fn()} onPrint={vi.fn()} onEdit={onEdit} />);
    fireEvent.click(screen.getByTestId('edit-transmittal-btn'));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ status }));
  });

  it('adds and saves actual document rows from the preview, then prints the saved list', async () => {
    useSessionStore.getState().setSession({
      user: { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'Admin', entities: ['ATA'], departments: [] },
      permissions: ['transmittal:edit'], activeEntity: 'ATA',
    });
    const printed = capturePrint();
    const onSaveItems = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<TransmittalPrintModal isOpen transmittal={transmittal} onClose={vi.fn()} onSaveItems={onSaveItems} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit contents' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add document row' }));
    fireEvent.change(screen.getByLabelText('Document 2 description'), { target: { value: 'Birth certificate' } });
    fireEvent.change(screen.getByLabelText('Document 2 category'), { target: { value: 'Original Copy' } });
    expect(screen.getByTestId('print-action-btn')).toBeDisabled();
    expect(screen.getByTestId('print-items-table').querySelectorAll('tbody tr')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Save documents' }));
    await waitFor(() => expect(onSaveItems).toHaveBeenCalledWith([
      { description: 'Tax return', documentType: 'Tax', quantity: 2 },
      { description: 'Birth certificate', documentType: 'Original Copy', quantity: 1 },
    ]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save documents' })).not.toBeInTheDocument());
    rerender(<TransmittalPrintModal isOpen transmittal={{ ...transmittal, version: 2, items: [
      ...transmittal.items!, { id: 'new-row', description: 'Birth certificate', document_type: 'Original Copy', quantity: 1 },
    ] }} onClose={vi.fn()} onSaveItems={onSaveItems} />);
    fireEvent.click(screen.getByTestId('print-action-btn'));
    expect(printed().querySelectorAll('.document-table tbody tr')).toHaveLength(2);
    expect(printed().body.textContent).toContain('BIRTH CERTIFICATE');
  });

  it('validates blank rows, retains failed saves, and discards changes on cancel', async () => {
    useSessionStore.getState().setSession({
      user: { id: 'admin', name: 'Admin', email: 'admin@example.com', role: 'Admin', entities: ['ATA'], departments: [] },
      permissions: ['transmittal:edit'], activeEntity: 'ATA',
    });
    const onSaveItems = vi.fn().mockRejectedValue(new Error('Conflict'));
    render(<TransmittalPrintModal isOpen transmittal={transmittal} onClose={vi.fn()} onSaveItems={onSaveItems} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit contents' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add document row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save documents' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Each row needs a description');
    expect(onSaveItems).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Remove document 2'));
    fireEvent.change(screen.getByLabelText('Document 1 description'), { target: { value: 'Correction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save documents' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Documents were not saved'));
    expect(screen.getByLabelText('Document 1 description')).toHaveValue('Correction');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edits' }));
    expect(screen.getByTestId('print-items-table')).toHaveTextContent('TAX RETURN');
    expect(screen.getByTestId('print-action-btn')).toBeEnabled();
  });

});
