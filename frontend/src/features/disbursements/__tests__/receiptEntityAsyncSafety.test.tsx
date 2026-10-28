import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { completeReceiptUpload, requestReceiptUploadReservation, uploadReceiptFile } from '../api/useDisbursements';
import type { ReceiptTargetOptions } from '../api/types';

const ATA_WR = '11111111-1111-4111-8111-111111111111';
const LTA_WR = '22222222-2222-4222-8222-222222222222';
const OWNER = '55555555-5555-4555-8555-555555555555';
const requests = [
  { id: ATA_WR, entity: 'ATA', title: 'ATA Work', clientId: '33333333-3333-4333-8333-333333333333', clientName: 'ATA Client' },
  { id: LTA_WR, entity: 'LTA', title: 'LTA Work', clientId: '44444444-4444-4444-8444-444444444444', clientName: 'LTA Client' },
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const pdf = (name = 'receipt.pdf') => new File(['%PDF-test'], name, { type: 'application/pdf' });
const originalFetch = globalThis.fetch;
const clients: QueryClient[] = [];
type Stage = 'reserve' | 'put' | 'complete' | 'create';

beforeEach(() => {
  sessionStorage.clear();
  useSessionStore.setState({
    user: { id: OWNER, email: 'owner@example.test', name: 'Owner', role: 'Admin', departments: [], entities: ['ATA', 'LTA'] },
    permissions: new Set(['disbursement:create', 'disbursement:view']),
    activeEntity: 'ALL', isAuthenticated: true, isLoading: false,
  });
  useBlockingModalStore.getState().reset();
});
afterEach(() => {
  cleanup();
  clients.forEach(client => client.clear());
  clients.length = 0;
  useBlockingModalStore.getState().reset();
  sessionStorage.clear();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function harness(block: Stage) {
  const calls: Array<{ stage: Stage; entity: string | null; body: Record<string, unknown> }> = [];
  const reservations = new Map<string, { key: string; filename: string }>();
  let resume!: (response: Response) => void;
  const deferred = new Promise<Response>(resolve => { resume = resolve; });
  let responseAtGate!: Response;
  let gated = false;
  let sequence = 0;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const entity = new Headers(init?.headers).get('X-Active-Entity');
    const body: Record<string, unknown> = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    let stage: Stage;
    let response: Response;
    if (url.hostname === 'storage.test') {
      stage = 'put'; response = json({});
    } else if (path.endsWith('/receipt-uploads')) {
      stage = 'reserve';
      const id = `upload-${++sequence}`;
      const key = `entities/${entity}/receipts/${id}.pdf`;
      reservations.set(id, { key, filename: String(body.filename) });
      response = json({ data: { uploadId: id, uploadUrl: `https://storage.test/${id}`, objectKey: key, expiresAt: '2030-01-01T00:00:00Z' } }, 201);
    } else if (path.includes('/receipt-uploads/') && path.endsWith('/complete')) {
      stage = 'complete';
      const id = path.split('/').at(-2)!;
      const reservation = reservations.get(id)!;
      response = json({ data: { receiptS3Key: reservation.key, receiptFilename: reservation.filename } });
    } else if (path.endsWith('/disbursements') && init?.method === 'POST') {
      stage = 'create'; response = json({ data: { id: 'created-voucher', status: 'Draft' } }, 201);
    } else if (path.includes('/tasks')) {
      const match = requests.find((r) => path.includes(r.id));
      const wrId = match ? match.id : requests[0]?.id;
      return json({
        data: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            workRequestId: wrId,
            title: 'Safety Task',
            status: 'In Progress',
            assigneeId: 'admin-1',
            assignees: ['admin-1'],
          },
        ],
      });
    } else if (path.includes('/operations/work-requests')) {
      return json({ data: requests });
    } else if (path.endsWith('/clients')) {
      return json({ data: requests.map(wr => ({ id: wr.clientId, name: wr.clientName })) });
    } else {
      return json({ data: [] });
    }
    calls.push({ stage, entity, body });
    if (stage === block && !gated) {
      gated = true; responseAtGate = response;
      return deferred;
    }
    return response;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const onClose = vi.fn();
  const form = (open = true, wr = ATA_WR) => <CreateDisbursementModal isOpen={open} onClose={onClose} defaultWorkRequestId={wr} />;
  const view = render(form(), { wrapper });
  return {
    calls, onClose, form, view,
    finish: async (body?: unknown, status = 200) => {
      await act(async () => { resume(body === undefined ? responseAtGate : json(body, status)); await deferred; });
    },
    prepare: async () => {
      await waitFor(() => expect(screen.getByTestId('display-client-name')).toHaveValue('ATA Client'));
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '100' } });
      fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Receipt context regression' } });
      fireEvent.drop(screen.getByTestId('receipt-dropzone'), { dataTransfer: { files: [pdf()] } });
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      await waitFor(() => expect(calls.some(call => call.stage === block)).toBe(true));
    },
  };
}

describe('Receipt target lifetime under deferred responses', () => {
  it.each<Stage>(['reserve', 'put', 'complete'])('aborts stale %s work and permits a fresh upload under the new work request', async stage => {
    const h = harness(stage);
    await h.prepare();
    fireEvent.change(screen.getByTestId('select-work-request'), { target: { value: LTA_WR } });
    await h.finish();
    await waitFor(() => expect(screen.getByTestId('submit-create-disbursement-btn')).not.toBeDisabled());
    expect(h.calls.filter(call => call.stage === 'create')).toHaveLength(0);
    if (stage !== 'complete') expect(h.calls.filter(call => call.stage === 'complete')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
    await waitFor(() => expect(h.onClose).toHaveBeenCalledOnce());
    expect(h.calls.filter(call => call.stage === 'reserve')).toHaveLength(2);
    const create = h.calls.filter(call => call.stage === 'create');
    expect(create).toHaveLength(1);
    expect(create[0]?.entity).toBe('LTA');
    expect(create[0]?.body.linkedWorkRequestId).toBe(LTA_WR);
    expect(create[0]?.body.receiptS3Key).toContain('entities/LTA/');
    expect(useSessionStore.getState().activeEntity).toBe('ALL');
  });

  it.each(['remove', 'replace'])('blocks file %s while its PUT is pending and keeps the original attachment', async action => {
    const h = harness('put');
    await h.prepare();
    expect(screen.getByTestId('remove-receipt-btn')).toBeDisabled();
    if (action === 'remove') fireEvent.click(screen.getByTestId('remove-receipt-btn'));
    else fireEvent.drop(screen.getByTestId('receipt-dropzone'), { dataTransfer: { files: [pdf('replacement.pdf')] } });
    expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
    await h.finish();
    await waitFor(() => expect(h.onClose).toHaveBeenCalledOnce());
    expect(h.calls.filter(call => call.stage === 'reserve')).toHaveLength(1);
    expect(h.calls.filter(call => call.stage === 'create')).toHaveLength(1);
    expect(h.calls.find(call => call.stage === 'create')?.body.receiptFilename).toBe('receipt.pdf');
  });

  it.each(['target', 'session', 'modal'])('does not apply a late mismatch error to a changed %s context', async context => {
    const h = harness('create');
    await h.prepare();
    if (context === 'target') fireEvent.change(screen.getByTestId('select-work-request'), { target: { value: LTA_WR } });
    else if (context === 'session') act(() => useSessionStore.setState({ activeEntity: 'LTA' }));
    else h.view.rerender(h.form(false));
    await h.finish({ detail: 'Receipt reservation does not belong to the authenticated user or entity.', code: 'RECEIPT_RESERVATION_MISMATCH' }, 403);
    if (context === 'modal') h.view.rerender(h.form());
    await waitFor(() => expect(useBlockingModalStore.getState().status).toBe('error'));
    expect(screen.queryByTestId('error-receipt')).not.toBeInTheDocument();
    expect(h.onClose).not.toHaveBeenCalled();
    expect(h.calls.filter(call => call.stage === 'create')).toHaveLength(1);
  });

  it('keeps an uncertain create blocked after a target change and modal reopen', async () => {
    const h = harness('create');
    await h.prepare();
    fireEvent.change(screen.getByTestId('select-work-request'), { target: { value: LTA_WR } });
    await h.finish({ detail: 'Response lost after possible persistence' }, 503);
    await waitFor(() => expect(screen.getByTestId('create-outcome-uncertain')).toBeInTheDocument());
    h.view.rerender(h.form(false));
    h.view.rerender(h.form());
    await waitFor(() => expect(screen.getByTestId('submit-create-disbursement-btn')).toBeDisabled());
    fireEvent.submit(screen.getByTestId('create-disbursement-form'));
    expect(h.calls.filter(call => call.stage === 'create')).toHaveLength(1);
    expect(h.onClose).not.toHaveBeenCalled();
  });

  it('invalidates an upload when the parent changes its prefilled work request', async () => {
    const h = harness('complete');
    await h.prepare();
    h.view.rerender(h.form(true, LTA_WR));
    await h.finish();
    await waitFor(() => expect(screen.getByTestId('submit-create-disbursement-btn')).not.toBeDisabled());
    expect(h.calls.filter(call => call.stage === 'create')).toHaveLength(0);
    expect(h.onClose).not.toHaveBeenCalled();
  });
});

describe('Receipt helper entity boundary', () => {
  it.each([null, 'ALL', 'UNKNOWN', ''])('makes no receipt request without a concrete target in session %s', async activeEntity => {
    useSessionStore.setState({ activeEntity });
    const fetch = vi.fn(); globalThis.fetch = fetch;
    await expect(requestReceiptUploadReservation({ filename: 'receipt.pdf', contentType: 'application/pdf', size: 9 })).rejects.toThrow('specific ATA or LTA');
    await expect(completeReceiptUpload('upload')).rejects.toThrow('specific ATA or LTA');
    await expect(uploadReceiptFile(pdf())).rejects.toThrow('specific ATA or LTA');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([null, '', false, 0, 'ALL'])('rejects malformed runtime entity option %s before any request', async entity => {
    const fetch = vi.fn(); globalThis.fetch = fetch;
    const options = { entity } as unknown as ReceiptTargetOptions;
    await expect(requestReceiptUploadReservation({ filename: 'receipt.pdf', contentType: 'application/pdf', size: 9 }, options)).rejects.toThrow('Invalid target entity');
    await expect(completeReceiptUpload('upload', options)).rejects.toThrow('Invalid target entity');
    await expect(uploadReceiptFile(pdf(), options)).rejects.toThrow('Invalid target entity');
    expect(fetch).not.toHaveBeenCalled();
  });
});
