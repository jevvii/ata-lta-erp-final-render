import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { WorkRequest } from '@/features/operations/api/types';

// Mock session store
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  const { create } = await import('zustand');
  const isolatedStore = create((set) => ({
    user: null,
    permissions: new Set<string>(),
    activeEntity: 'ALL',
    unreadCount: 0,
    isAuthenticated: true,
    isLoading: false,

    setSession: ({
      user,
      permissions,
      activeEntity,
      unreadCount,
    }: {
      user?: unknown;
      permissions?: unknown;
      activeEntity?: string;
      unreadCount?: number;
    }) => {
      const permSet =
        permissions instanceof Set
          ? (permissions as Set<string>)
          : new Set<string>(Array.isArray(permissions) ? permissions : []);
      set({
        user,
        permissions: permSet,
        activeEntity: activeEntity || 'ALL',
        unreadCount: unreadCount ?? 0,
        isAuthenticated: true,
        isLoading: false,
      });
    },
    setActiveEntity: (entity: string) => set({ activeEntity: entity }),
    setUnreadCount: (count: number) => set({ unreadCount: count }),
    clearSession: () =>
      set({
        user: null,
        permissions: new Set<string>(),
        activeEntity: null,
        unreadCount: 0,
        isAuthenticated: false,
        isLoading: false,
      }),
    setLoading: (isLoading: boolean) => set({ isLoading }),
  }));

  return {
    ...actual,
    useSessionStore: isolatedStore,
  };
});

let activeQueryClients: QueryClient[] = [];

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  activeQueryClients.push(queryClient);

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const mockWorkRequests: WorkRequest[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    entity: 'LTA',
    title: 'SEC Registration Filing',
    description: 'LTA Corporate Filing',
    clientId: '33333333-3333-4333-8333-333333333333',
    client_id: '33333333-3333-4333-8333-333333333333',
    clientName: 'LTA Corp Client',
    client_name: 'LTA Corp Client',
    status: 'In Progress',
    phase: 'processing',
    onHold: false,
    phaseEnteredAt: null,
    coAssignees: [],
    dueDate: null,
    version: 1,
    priority: 'Normal',
    archived: false,
    requestedBy: 'user-1',
    assignedTo: 'user-1',
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    entity: 'ATA',
    title: 'BIR Tax Assessment Docket',
    description: 'ATA Tax Representation',
    clientId: '44444444-4444-4444-8444-444444444444',
    client_id: '44444444-4444-4444-8444-444444444444',
    clientName: 'ATA Tax Client',
    client_name: 'ATA Tax Client',
    status: 'In Progress',
    phase: 'processing',
    onHold: false,
    phaseEnteredAt: null,
    coAssignees: [],
    dueDate: null,
    version: 1,
    priority: 'Normal',
    archived: false,
    requestedBy: 'user-1',
    assignedTo: 'user-1',
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
  },
];

describe('RECEIPT-ENTITY-20261021 Frontend Contract & Lifecycle Tests', () => {
  const originalFetch = global.fetch;

  const setDualEntitySession = (activeEntity = 'ALL') => {
    (
      useSessionStore.getState() as unknown as {
        setSession: (s: {
          user: unknown;
          permissions: string[];
          activeEntity: string;
        }) => void;
      }
    ).setSession({
      user: {
        id: 'u-dual-1',
        email: 'staff@ata-lta.ph',
        name: 'Dual Staff Member',
        role: 'Admin',
        departments: ['Administration', 'Accounting'],
        entities: ['ATA', 'LTA'],
      },
      permissions: [
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
      ],
      activeEntity,
    });
  };

  beforeEach(() => {
    sessionStorage.clear();
    setDualEntitySession('ALL');
    useBlockingModalStore.getState().reset();
  });

  afterEach(() => {
    activeQueryClients.forEach((qc) => {
      qc.cancelQueries();
      qc.clear();
    });
    activeQueryClients = [];
    vi.restoreAllMocks();
    useBlockingModalStore.getState().reset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('ALL → LTA: sends X-Active-Entity: LTA on reserve, complete, and create while global session remains ALL', async () => {
    const interceptedRequests: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const headersRecord: Record<string, string> = {};

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headersRecord[k.toLowerCase()] = v;
          });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([k, v]) => {
            headersRecord[k.toLowerCase()] = v;
          });
        } else {
          Object.entries(init.headers).forEach(([k, v]) => {
            headersRecord[k.toLowerCase()] = String(v);
          });
        }
      }

      let parsedBody: unknown = undefined;
      if (init?.body && typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }

      interceptedRequests.push({ url, method, headers: headersRecord, body: parsedBody });

      if (url.includes('/operations/work-requests')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockWorkRequests }),
        };
      }

      if (url.includes('/clients')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: [
              { id: '33333333-3333-4333-8333-333333333333', name: 'LTA Corp Client' },
              { id: '44444444-4444-4444-8444-444444444444', name: 'ATA Tax Client' },
            ],
          }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads/') && url.includes('/complete')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: 'entities/LTA/receipts/res-lta-001.pdf',
              receiptFilename: 'lta-receipt.pdf',
            },
          }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads')) {
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: 'upload-lta-001',
              uploadUrl: 'https://storage.test/put-lta-receipt',
              objectKey: 'entities/LTA/receipts/res-lta-001.pdf',
              expiresAt: '2026-10-21T21:00:00Z',
            },
          }),
        };
      }

      if (url.includes('/put-lta-receipt')) {
        return { ok: true, status: 200 };
      }

      if (url.includes('/disbursements') && method === 'POST') {
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              id: 'disb-lta-001',
              status: 'Draft',
              ...(parsedBody as Record<string, unknown>),
            },
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      };
    });

    const { wrapper } = createHarness();
    const onClose = vi.fn();

    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={onClose}
        defaultWorkRequestId="11111111-1111-4111-8111-111111111111"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-work-request')).toHaveValue('11111111-1111-4111-8111-111111111111');
    });

    // Fill form
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '3500' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'SEC filing documentation fees' },
    });

    // Attach receipt
    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['%PDF-1.4 test receipt'], 'lta-receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('lta-receipt.pdf');
    });

    // Submit
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    // Verify wire requests
    const reserveReq = interceptedRequests.find((r) => r.url.includes('/disbursements/receipt-uploads') && !r.url.includes('/complete'));
    expect(reserveReq).toBeDefined();
    expect(reserveReq!.headers['x-active-entity']).toBe('LTA');
    expect(reserveReq!.body).toEqual({
      filename: 'lta-receipt.pdf',
      contentType: 'application/pdf',
      size: testFile.size,
    });

    const binaryReq = interceptedRequests.find((r) => r.url.includes('/put-lta-receipt'));
    expect(binaryReq).toBeDefined();
    expect(binaryReq!.method).toBe('PUT');

    const completeReq = interceptedRequests.find((r) => r.url.includes('/disbursements/receipt-uploads/upload-lta-001/complete'));
    expect(completeReq).toBeDefined();
    expect(completeReq!.headers['x-active-entity']).toBe('LTA');

    const createReq = interceptedRequests.find((r) => r.url.endsWith('/disbursements') && r.method === 'POST');
    expect(createReq).toBeDefined();
    expect(createReq!.headers['x-active-entity']).toBe('LTA');

    // Anti-pollution doctrine: CreateDisbursementInput must NOT contain transport metadata
    const createBody = createReq!.body as Record<string, unknown>;
    expect(createBody.entity).toBeUndefined();
    expect(createBody.linkedWorkRequestId).toBe('11111111-1111-4111-8111-111111111111');
    expect(createBody.receiptS3Key).toBe('entities/LTA/receipts/res-lta-001.pdf');
    expect(createBody.receiptFilename).toBe('lta-receipt.pdf');

    // Session doctrine: global session MUST remain ALL
    expect(useSessionStore.getState().activeEntity).toBe('ALL');
  });

  it('ALL → ATA: sends X-Active-Entity: ATA on reserve, complete, and create while global session remains ALL', async () => {
    const interceptedRequests: Array<{ url: string; method: string; headers: Record<string, string>; body?: unknown }> = [];

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const headersRecord: Record<string, string> = {};

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headersRecord[k.toLowerCase()] = v;
          });
        } else {
          Object.entries(init.headers as Record<string, string>).forEach(([k, v]) => {
            headersRecord[k.toLowerCase()] = String(v);
          });
        }
      }

      let parsedBody: unknown = undefined;
      if (init?.body && typeof init.body === 'string') {
        try {
          parsedBody = JSON.parse(init.body);
        } catch {
          parsedBody = init.body;
        }
      }

      interceptedRequests.push({ url, method, headers: headersRecord, body: parsedBody });

      if (url.includes('/operations/work-requests')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockWorkRequests }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads/') && url.includes('/complete')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: 'entities/ATA/receipts/res-ata-002.pdf',
              receiptFilename: 'ata-receipt.pdf',
            },
          }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads')) {
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: 'upload-ata-002',
              uploadUrl: 'https://storage.test/put-ata-receipt',
              objectKey: 'entities/ATA/receipts/res-ata-002.pdf',
              expiresAt: '2026-10-21T21:00:00Z',
            },
          }),
        };
      }

      if (url.includes('/put-ata-receipt')) {
        return { ok: true, status: 200 };
      }

      if (url.includes('/disbursements') && method === 'POST') {
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              id: 'disb-ata-002',
              status: 'Draft',
              ...(parsedBody as Record<string, unknown>),
            },
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      };
    });

    const { wrapper } = createHarness();
    const onClose = vi.fn();

    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={onClose}
        defaultWorkRequestId="22222222-2222-4222-8222-222222222222"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-work-request')).toHaveValue('22222222-2222-4222-8222-222222222222');
    });

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '4500' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'BIR Documentary Stamp Tax' },
    });

    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['%PDF-1.4 ata receipt'], 'ata-receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('ata-receipt.pdf');
    });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    const reserveReq = interceptedRequests.find((r) => r.url.includes('/disbursements/receipt-uploads') && !r.url.includes('/complete'));
    expect(reserveReq!.headers['x-active-entity']).toBe('ATA');

    const completeReq = interceptedRequests.find((r) => r.url.includes('/disbursements/receipt-uploads/upload-ata-002/complete'));
    expect(completeReq!.headers['x-active-entity']).toBe('ATA');

    const createReq = interceptedRequests.find((r) => r.url.endsWith('/disbursements') && r.method === 'POST');
    expect(createReq!.headers['x-active-entity']).toBe('ATA');
    expect((createReq!.body as Record<string, unknown>).entity).toBeUndefined();

    expect(useSessionStore.getState().activeEntity).toBe('ALL');
  });

  it('fails closed in ALL if work request is unselected: blocks before upload without network calls', async () => {
    let uploadAttempted = false;

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/receipt-uploads')) {
        uploadAttempted = true;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: mockWorkRequests }),
      };
    });

    const { wrapper } = createHarness();
    render(<CreateDisbursementModal isOpen={true} onClose={vi.fn()} />, { wrapper });

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1500' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Unscoped test' },
    });

    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['test'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-work-request-id')).toHaveTextContent(/Please select a Work Request/i);
    });

    expect(uploadAttempted).toBe(false);
  });

  it('target change after completed upload invalidates cached receipt and uploads afresh under new entity', async () => {
    const uploadEntities: string[] = [];
    const createEntities: string[] = [];

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      const headersRecord: Record<string, string> = {};

      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            headersRecord[k.toLowerCase()] = v;
          });
        } else {
          Object.entries(init.headers as Record<string, string>).forEach(([k, v]) => {
            headersRecord[k.toLowerCase()] = String(v);
          });
        }
      }

      if (url.includes('/operations/work-requests')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockWorkRequests }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads/') && url.includes('/complete')) {
        const entity = headersRecord['x-active-entity'] || 'UNKNOWN';
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: `entities/${entity}/receipts/key-${entity}.pdf`,
              receiptFilename: 'receipt.pdf',
            },
          }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads')) {
        const entity = headersRecord['x-active-entity'] || 'UNKNOWN';
        uploadEntities.push(entity);
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: `up-${entity}`,
              uploadUrl: `https://storage.test/put-${entity}`,
              objectKey: `entities/${entity}/receipts/key-${entity}.pdf`,
              expiresAt: '2026-10-21T21:00:00Z',
            },
          }),
        };
      }

      if (url.includes('/put-')) {
        return { ok: true, status: 200 };
      }

      if (url.includes('/disbursements') && method === 'POST') {
        const entity = headersRecord['x-active-entity'] || 'UNKNOWN';
        createEntities.push(entity);

        if (entity === 'ATA') {
          // First attempt with ATA fails with 400 rejection
          return {
            ok: false,
            status: 400,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              status: 400,
              code: 'VALIDATION_ERROR',
              message: 'Invalid ATA tax code reference',
            }),
          };
        }

        // Second attempt with LTA succeeds
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              id: 'disb-success-200',
              status: 'Draft',
            },
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      };
    });

    const { wrapper } = createHarness();
    const onClose = vi.fn();

    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={onClose}
        defaultWorkRequestId="22222222-2222-4222-8222-222222222222"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-work-request')).toHaveValue('22222222-2222-4222-8222-222222222222');
    });

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '2000' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Target change test' },
    });

    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['sample bytes'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
    });

    // 1st submit with ATA -> upload succeeds, create fails with 400
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(uploadEntities).toEqual(['ATA']);
      expect(createEntities).toEqual(['ATA']);
    });

    // User switches target work request to LTA
    fireEvent.change(screen.getByTestId('select-work-request'), {
      target: { value: '11111111-1111-4111-8111-111111111111' },
    });

    // 2nd submit -> must NOT reuse ATA receipt key! Must issue fresh upload reservation with LTA
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(uploadEntities).toEqual(['ATA', 'LTA']);
    expect(createEntities).toEqual(['ATA', 'LTA']);
  });

  it('proven ownership mismatch (403 RECEIPT_RESERVATION_MISMATCH) clears cached receipt and guides re-upload', async () => {
    let uploadCount = 0;

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';

      if (url.includes('/operations/work-requests')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockWorkRequests }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads/') && url.includes('/complete')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: `entities/LTA/receipts/key-${uploadCount}.pdf`,
              receiptFilename: 'receipt.pdf',
            },
          }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads')) {
        uploadCount++;
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: `up-${uploadCount}`,
              uploadUrl: `https://storage.test/put-${uploadCount}`,
              objectKey: `entities/LTA/receipts/key-${uploadCount}.pdf`,
              expiresAt: '2026-10-21T21:00:00Z',
            },
          }),
        };
      }

      if (url.includes('/put-')) {
        return { ok: true, status: 200 };
      }

      if (url.includes('/disbursements') && method === 'POST') {
        if (uploadCount === 1) {
          return {
            ok: false,
            status: 403,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              status: 403,
              code: 'RECEIPT_RESERVATION_MISMATCH',
              message: 'Receipt reservation does not belong to the authenticated user or entity',
            }),
          };
        }

        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: { id: 'disb-recovered-101', status: 'Draft' },
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      };
    });

    const { wrapper } = createHarness();
    const onClose = vi.fn();

    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={onClose}
        defaultWorkRequestId="11111111-1111-4111-8111-111111111111"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-work-request')).toHaveValue('11111111-1111-4111-8111-111111111111');
    });

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '5000' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Mismatch recovery test' },
    });

    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['sample bytes'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

    // First submit fails with 403 RECEIPT_RESERVATION_MISMATCH
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-receipt')).toHaveTextContent(/Receipt reservation does not belong/i);
    });

    // Inputs remain intact
    expect(screen.getByTestId('input-amount')).toHaveValue(5000);
    expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');

    // Second submit triggers fresh re-upload (uploadCount incremented to 2)
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(uploadCount).toBe(2);
  });

  it('specific entity mismatch guard: ATA session blocks LTA work request selection before upload', async () => {
    setDualEntitySession('ATA'); // Specific ATA session
    let uploadAttempted = false;

    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/receipt-uploads')) {
        uploadAttempted = true;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: mockWorkRequests }),
      };
    });

    const { wrapper } = createHarness();
    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={vi.fn()}
        defaultWorkRequestId="11111111-1111-4111-8111-111111111111" // LTA WR in ATA session
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-work-request')).toHaveValue('11111111-1111-4111-8111-111111111111');
    });

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1000' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Cross-entity test' },
    });

    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['test'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-work-request-id')).toHaveTextContent(/Selected work request belongs to LTA, but active session is ATA/i);
    });

    expect(uploadAttempted).toBe(false);
  });

  it('5xx / timeout keeps form blocked under uncertainty doctrine even across target changes', async () => {
    global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';

      if (url.includes('/operations/work-requests')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: mockWorkRequests }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads/') && url.includes('/complete')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: 'entities/LTA/receipts/k1.pdf',
              receiptFilename: 'receipt.pdf',
            },
          }),
        };
      }

      if (url.includes('/disbursements/receipt-uploads')) {
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: 'up-1',
              uploadUrl: 'https://storage.test/put-1',
              objectKey: 'entities/LTA/receipts/k1.pdf',
              expiresAt: '2026-10-21T21:00:00Z',
            },
          }),
        };
      }

      if (url.includes('/put-1')) return { ok: true, status: 200 };

      if (url.includes('/disbursements') && method === 'POST') {
        return {
          ok: false,
          status: 504,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            status: 504,
            code: 'GATEWAY_TIMEOUT',
            message: 'Gateway Timeout: downstream ledger slow',
          }),
        };
      }

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      };
    });

    const { wrapper } = createHarness();
    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={vi.fn()}
        defaultWorkRequestId="11111111-1111-4111-8111-111111111111"
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('select-work-request')).toHaveValue('11111111-1111-4111-8111-111111111111');
    });

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '8000' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Uncertainty test' },
    });

    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['test'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

    // Submit -> triggers 504
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('create-outcome-uncertain')).toBeInTheDocument();
    });

    const submitBtn = screen.getByTestId('submit-create-disbursement-btn');
    expect(submitBtn).toBeDisabled();

    // Changing target work request does NOT unlock the form
    fireEvent.change(screen.getByTestId('select-work-request'), {
      target: { value: '22222222-2222-4222-8222-222222222222' },
    });
    expect(submitBtn).toBeDisabled();

    // Only acknowledging inspection clears the lock
    fireEvent.click(screen.getByTestId('confirm-creation-inspected'));
    expect(submitBtn).not.toBeDisabled();
  });
});
