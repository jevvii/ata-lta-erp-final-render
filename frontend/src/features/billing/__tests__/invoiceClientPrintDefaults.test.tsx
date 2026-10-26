import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InvoiceEditModal } from '../components/InvoiceEditModal';
import { useSessionStore } from '@/lib/session';
import type { Invoice } from '../api/types';

const mutations = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('../api/useBillingMutations', () => ({ updateInvoiceAction: mutations.update }));
vi.mock('@/features/operations/api/useClients', () => ({
  useClients: () => ({
    data: [
      { id: 'client-original', name: 'Harbor Trading', tin: '111-222-333-000', entity: 'ATA' },
      { id: 'client-next', name: 'Bayline Services', tin: '987-654-321-000', entity: 'ATA' },
    ],
  }),
}));
vi.mock('@/features/operations/api/useWorkRequests', () => ({
  useWorkRequests: () => ({ data: [] }),
}));
vi.mock('@/features/operations/api/useTasks', () => ({
  useWorkRequestTasks: () => ({ data: [], isPlaceholderData: false }),
}));

// Test editor state and payloads independently of Radix portal/focus behavior.
// The real select is also exercised by the coordinator's Chromium acceptance.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
    disabled,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
    disabled?: boolean;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

const invoice: Invoice = {
  id: 'invoice-client-defaults',
  entity_id: 'ent-ata',
  invoice_number: 'ATA-2026-0142',
  client_id: 'client-original',
  status: 'Draft',
  issue_date: '2026-10-01',
  due_date: '2026-10-28',
  subtotal: 1500,
  total: 1500,
  balance: 1500,
  amount_paid: 0,
  version: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  clients: { name: 'Harbor Trading', tin: '111-222-333-000' },
  print_details: {},
  line_items: [{ description: 'Permit services', amount: 1500, type: 'Professional Fee' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mutations.update.mockResolvedValue({ ...invoice, version: 2 });
  useSessionStore.getState().setSession({
    user: {
      id: 'admin-client-test',
      name: 'Mara Santos',
      email: 'review@example.test',
      role: 'Admin',
      entities: ['ATA'],
      departments: ['Administration'],
    },
    permissions: ['billing:edit'],
    activeEntity: 'ATA',
  });
});

function mount(record: Invoice) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <InvoiceEditModal inline isOpen invoice={record} onClose={() => {}} />
    </QueryClientProvider>
  );
  fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: 'client-next' } });
}

describe('invoice client selection and print provenance', () => {
  it('updates inherited name/TIN without creating saved overrides', async () => {
    mount(invoice);
    expect(screen.getByLabelText('Bill to name')).toHaveValue('Bayline Services');
    expect(screen.getByLabelText('Bill to TIN')).toHaveValue('987-654-321-000');
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));
    await waitFor(() => expect(mutations.update).toHaveBeenCalled());
    expect(mutations.update.mock.calls[0]?.[1]).toMatchObject({
      clientId: 'client-next',
      printDetails: {},
    });
  });

  it('retains explicit bill-to values and resets a field to the newly selected client', async () => {
    mount({
      ...invoice,
      print_details: { clientName: 'Custom recipient', clientTin: '', receivedBy: 'Elena Cruz' },
    });
    expect(screen.getByLabelText('Bill to name')).toHaveValue('Custom recipient');
    expect(screen.getByLabelText('Bill to TIN')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Use automatic for Bill to name' }));
    expect(screen.getByLabelText('Bill to name')).toHaveValue('Bayline Services');
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));
    await waitFor(() => expect(mutations.update).toHaveBeenCalled());
    expect(mutations.update.mock.calls[0]?.[1]).toMatchObject({
      printDetails: { clientTin: '', receivedBy: 'Elena Cruz' },
    });
  });
});
