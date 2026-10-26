import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DisbursementPrintModal } from '../components/DisbursementPrintModal';
import { DisbursementEditModal } from '../components/DisbursementEditModal';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Disbursement } from '../api/types';
const originalFetch = global.fetch;
const voucher: Disbursement = {
  id: 'd-1',
  disbursement_number: 'ATA-100',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Transportation',
  description: 'Site visit',
  amount: 1500,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  linked_work_request_id: '33333333-3333-3333-3333-333333333333',
  version: 3,
  created_at: '2026-10-19',
  updated_at: '2026-10-19',
  employee_name: 'M. Santos',
  approved_by_name: 'A. Reyes',
  released_by_name: 'R. Tan',
};
function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
beforeEach(() => {
  useBlockingModalStore.getState().reset();
  useSessionStore
    .getState()
    .setSession({
      user: {
        id: 'admin',
        email: 'admin@example.test',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA'],
        departments: [],
      },
      permissions: ['disbursement:view', 'disbursement:edit'],
      activeEntity: 'ATA',
    });
  global.fetch = vi
    .fn()
    .mockImplementation(async (url) => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: String(url).includes('/pdf') ? { url: 'https://example.test/voucher.pdf' } : voucher,
      }),
    }));
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  useBlockingModalStore.getState().reset();
});
describe('Voucher print and admin edit controls', () => {
  it('applies generic and no-company options to preview, print, and PDF and resets on reopen', async () => {
    const write = vi.fn();
    const print = vi.fn();
    const popup = { location: { href: '' }, close: vi.fn() };
    const open = vi
      .spyOn(window, 'open')
      .mockReturnValue({
        document: { open: vi.fn(), write, close: vi.fn(), images: [] },
        focus: vi.fn(),
        print,
      } as unknown as Window);
    const { wrapper } = harness();
    const { rerender } = render(
      <DisbursementPrintModal isOpen disbursement={voucher} onClose={vi.fn()} />,
      { wrapper }
    );
    expect(screen.getByAltText('ATA Logo')).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('disbursement-generic-option'));
    expect(screen.queryByAltText('ATA Logo')).not.toBeInTheDocument();
    expect(screen.getByTestId('disbursement-a4-sheet')).toHaveTextContent(
      'ATA Accounting Services Firm'
    );
    fireEvent.click(screen.getByTestId('disbursement-company-option'));
    expect(screen.getByTestId('disbursement-a4-sheet')).not.toHaveTextContent(
      'Accounting Services Firm'
    );
    fireEvent.click(screen.getByTestId('print-disbursement-button'));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(write.mock.calls[0]![0]).not.toContain('Accounting Services Firm');
    open.mockReturnValue(popup as unknown as Window);
    fireEvent.click(screen.getByTestId('download-disbursement-pdf'));
    await waitFor(() => expect(popup.location.href).toBe('https://example.test/voucher.pdf'));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/pdf?noLogo=true&includeCompanyDetails=false'),
      expect.anything()
    );
    rerender(<DisbursementPrintModal isOpen={false} disbursement={voucher} onClose={vi.fn()} />);
    rerender(<DisbursementPrintModal isOpen disbursement={voucher} onClose={vi.fn()} />);
    expect(screen.getByTestId('disbursement-company-option')).not.toBeChecked();
    expect(screen.getByTestId('disbursement-generic-option')).not.toBeChecked();
  });
  it.each([true, false])(
    'persists released voucher fields and signatures with the current version (inline=%s)',
    async (inline) => {
      let payload: Record<string, unknown> | undefined;
      global.fetch = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
        if (init?.method === 'PUT') payload = JSON.parse(String(init.body));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { ...voucher, amount: 1999.99, version: 4 } }),
        };
      });
      const { wrapper } = harness();
      const close = vi.fn();
      render(
        <DisbursementEditModal isOpen inline={inline} disbursement={voucher} onClose={close} />,
        { wrapper }
      );
      fireEvent.change(screen.getByLabelText('Amount (PHP)'), { target: { value: '1999.99' } });
      fireEvent.change(screen.getByLabelText('Prepared by'), { target: { value: 'P. Cruz' } });
      fireEvent.change(screen.getByLabelText('Approved by'), { target: { value: 'A. Lim' } });
      fireEvent.change(screen.getByLabelText('Released by'), { target: { value: 'R. Tan' } });
      fireEvent.change(screen.getByLabelText('Printed bank / branch'), {
        target: { value: 'BDO Manila' },
      });
      fireEvent.click(screen.getByTestId('save-disbursement-edit'));
      await waitFor(() => expect(close).toHaveBeenCalled());
      expect(payload).toMatchObject({
        amount: 1999.99,
        expectedVersion: 3,
        printDetails: {
          preparedBy: 'P. Cruz',
          approvedBy: 'A. Lim',
          releasedBy: 'R. Tan',
          paymentBank: 'BDO Manila',
        },
      });
    }
  );
  it('keeps edits on version conflict and requires loading latest values', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          title: 'Conflict',
          detail: 'Changed elsewhere',
          code: 'ERR_CONCURRENCY_CONFLICT',
        }),
      });
    const { wrapper } = harness();
    render(<DisbursementEditModal inline isOpen disbursement={voucher} onClose={vi.fn()} />, {
      wrapper,
    });
    fireEvent.change(screen.getByLabelText('Prepared by'), { target: { value: 'Unsaved name' } });
    fireEvent.click(screen.getByTestId('save-disbursement-edit'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('changed elsewhere'));
    expect(screen.getByLabelText('Prepared by')).toHaveValue('Unsaved name');
    expect(screen.getByTestId('save-disbursement-edit')).toBeDisabled();
  });
  it('provides Admin edit entry points and hides them for an unrelated requester', () => {
    const { wrapper } = harness();
    const { unmount } = render(
      <DisbursementDetailDrawer isOpen initialDisbursement={voucher} onClose={vi.fn()} />,
      { wrapper }
    );
    expect(screen.getByTestId('edit-disbursement-button')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit inline' }));
    expect(screen.getByTestId('disbursement-inline-editor')).toBeInTheDocument();
    unmount();
    useSessionStore.setState((s) => ({ user: { ...s.user!, role: 'Employee' } }));
    render(<DisbursementDetailDrawer isOpen initialDisbursement={voucher} onClose={vi.fn()} />, {
      wrapper,
    });
    expect(screen.queryByTestId('edit-disbursement-button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit inline' })).not.toBeInTheDocument();
  });
  it('updates the printed amount and names after saving inline', async () => {
    let current = { ...voucher };
    global.fetch = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        current = { ...current, amount: body.amount, print_details: body.printDetails, version: 4 };
      }
      return { ok: true, status: 200, json: async () => ({ data: current }) };
    });
    const { wrapper } = harness();
    render(<DisbursementPrintModal isOpen disbursement={voucher} onClose={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Edit inline' }));
    fireEvent.change(screen.getByLabelText('Amount (PHP)'), { target: { value: '2500' } });
    fireEvent.change(screen.getByLabelText('Prepared by'), { target: { value: 'P. Cruz' } });
    fireEvent.click(screen.getByTestId('save-disbursement-edit'));
    await waitFor(() =>
      expect(screen.queryByTestId('disbursement-inline-editor')).not.toBeInTheDocument()
    );
    expect(screen.getByTestId('disbursement-total-amount')).toHaveTextContent('2,500.00');
    expect(screen.getByTestId('sig-prepared-by')).toHaveTextContent('P. Cruz');
  });
});
