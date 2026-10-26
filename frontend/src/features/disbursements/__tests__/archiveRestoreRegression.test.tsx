import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { DisbursementsTable } from '../components/DisbursementsTable';
import { DisbursementArchiveTab } from '../components/DisbursementArchiveTab';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import type { Disbursement } from '../api/types';

const originalFetch = global.fetch;
const voucher: Disbursement = {
  id: '98c27066-de37-45af-b566-b28ebf868c0a',
  disbursement_number: 'DISB-ATA-20261020-007',
  entity_id: 'entity-ata',
  linked_work_request_id: 'wr-ata',
  category: 'Supplies',
  description: 'Archive regression',
  amount: 100,
  fund_source: 'Firm Fund',
  status: 'Released',
  lifecycle_version: 2,
  archived: true,
  version: 7,
  created_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
};
const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json' },
});
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

beforeEach(() => {
  queryClient.clear();
  useBlockingModalStore.getState().reset();
  useSessionStore.getState().setSession({
    user: { id: 'admin', name: 'Admin', email: 'admin@example.test', role: 'Admin', entities: ['ATA'], departments: [] },
    permissions: ['disbursement:view', 'disbursement:edit'], activeEntity: 'ATA',
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  queryClient.clear();
  useBlockingModalStore.getState().reset();
  vi.restoreAllMocks();
});

describe('Archive and Released separation', () => {
  it('excludes archived vouchers from Released and All while retaining the archive-specific query', async () => {
    const requested: URL[] = [];
    global.fetch = vi.fn(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      requested.push(url);
      const rows = url.searchParams.get('archived') === 'true' ? [voucher] : [];
      return json({ data: rows, meta: { total: rows.length, page: 1, limit: 25 } });
    });
    const { unmount } = render(<DisbursementsTable statusFilter="Released" onSelectDisbursement={vi.fn()} />, { wrapper });
    await screen.findByTestId('table-empty');
    expect(requested.some((u) => u.searchParams.get('status') === 'Released' && u.searchParams.get('archived') === 'false')).toBe(true);
    unmount();
    const all = render(<DisbursementsTable onSelectDisbursement={vi.fn()} />, { wrapper });
    await screen.findByTestId('table-empty');
    expect(requested.some((u) => !u.searchParams.has('status') && u.searchParams.get('archived') === 'false')).toBe(true);
    all.unmount();
    render(<DisbursementArchiveTab />, { wrapper });
    await screen.findByTestId(`archived-disbursement-row-${voucher.id}`);
    expect(requested.some((u) => u.searchParams.get('archived') === 'true')).toBe(true);
  });

  it('sends each selected voucher version during bulk restore', async () => {
    const second = { ...voucher, id: '2e1cad9f-a4b6-4fd3-9d21-5fa34368256b', disbursement_number: 'DISB-ATA-20261020-008', version: 12 };
    const posts: { url: string; body: unknown }[] = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return json({ data: { ...(url.includes(second.id) ? second : voucher), archived: false } });
      }
      return json({ data: [voucher, second], meta: { total: 2 } });
    });
    render(<DisbursementArchiveTab />, { wrapper });
    await screen.findByTestId(`restore-action-${voucher.id}`);
    fireEvent.click(screen.getByLabelText('Select all archived disbursements'));
    fireEvent.click(screen.getByTestId('bulk-restore-btn'));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts).toEqual([
      { url: expect.stringContaining(`/${voucher.id}/unarchive`), body: { expectedVersion: 7 } },
      { url: expect.stringContaining(`/${second.id}/unarchive`), body: { expectedVersion: 12 } },
    ]);
  });

  it('blocks restore against old search results until the new filter has finished', async () => {
    const posts: string[] = [];
    global.fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      if (init?.method === 'POST') posts.push(url.pathname);
      const rows = url.searchParams.has('search') ? [] : [voucher];
      return json({ data: rows, meta: { total: rows.length } });
    });
    render(<DisbursementArchiveTab />, { wrapper });
    const restore = await screen.findByTestId(`restore-action-${voucher.id}`);
    await waitFor(() => expect(restore).toBeEnabled());
    fireEvent.click(screen.getByLabelText('Select all archived disbursements'));
    fireEvent.change(screen.getByTestId('search-archived-disbursements-input'), { target: { value: 'another request' } });
    expect(restore).toBeDisabled();
    expect(screen.getByLabelText('Select all archived disbursements')).toBeDisabled();
    expect(screen.queryByTestId('bulk-restore-btn')).not.toBeInTheDocument();
    fireEvent.click(restore);
    expect(posts).toEqual([]);
    await screen.findByTestId('archive-empty');
  });

  it('keeps older saved vouchers viewable without offering an unsupported restore', async () => {
    global.fetch = vi.fn(async () => json({ data: [{ ...voucher, lifecycle_version: 1 }], meta: { total: 1 } }));
    render(<DisbursementArchiveTab />, { wrapper });
    await screen.findByTestId(`archived-disbursement-row-${voucher.id}`);
    expect(screen.getByTestId(`view-action-${voucher.id}`)).toBeEnabled();
    expect(screen.queryByTestId(`restore-action-${voucher.id}`)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select all archived disbursements')).toBeDisabled();
  });

  it.each([
    { archived: false, button: 'drawer-archive-btn', endpoint: 'archive', verb: 'archived' },
    { archived: true, button: 'drawer-unarchive-btn', endpoint: 'unarchive', verb: 'restored' },
  ])('uses the voucher number and closes the drawer after $endpoint succeeds', async ({ archived, button, endpoint, verb }) => {
    const close = vi.fn();
    const posts: { url: string; body: unknown }[] = [];
    global.fetch = vi.fn(async (input, init) => {
      if (init?.method === 'POST') {
        posts.push({ url: String(input), body: JSON.parse(String(init.body)) });
        return json({ data: { ...voucher, archived: !archived, version: 8 } });
      }
      return json({ data: { ...voucher, archived } });
    });
    render(<DisbursementDetailDrawer initialDisbursement={{ ...voucher, archived }} isOpen onClose={close} />, { wrapper });
    fireEvent.click(await screen.findByTestId(button));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(posts).toEqual([{ url: expect.stringContaining(`/${voucher.id}/${endpoint}`), body: { expectedVersion: 7 } }]);
    expect(useBlockingModalStore.getState().message).toBe(`Disbursement voucher ${voucher.disbursement_number} was ${verb}.`);
    expect(useBlockingModalStore.getState().message).not.toContain(voucher.id);
  });
});
