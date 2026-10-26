import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';

// Mock session store
vi.mock('@/lib/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/session')>();
  const { create } = await import('zustand');
  const isolatedStore = create((set) => ({
    user: null,
    permissions: new Set<string>(),
    activeEntity: 'ATA',
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
        activeEntity: activeEntity || 'ATA',
        unreadCount: unreadCount ?? 0,
        isAuthenticated: true,
        isLoading: false,
      });
    },
    setActiveEntity: (entity: string) => set({ activeEntity: entity }),
    setUnreadCount: (count: number) => set({ unreadCount: count }),
    clearSession: () => set({
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

describe('CreateDisbursementModal Upload Retention on Retry (R7 / V8 & R5)', () => {
  const originalFetch = global.fetch;

  const setAdminSession = () => {
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
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        departments: ['Administration'],
        entities: ['ATA'],
      },
      permissions: [
        'disbursement:view',
        'disbursement:create',
        'disbursement:edit',
        'disbursement:approve',
        'disbursement:mark_released',
      ],
      activeEntity: 'ATA',
    });
  };

  beforeEach(() => {
    setAdminSession();
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

  it('retains completed upload reservation across submission attempts on retry after failed voucher creation', async () => {
    let uploadReservationCount = 0;
    let uploadBinaryCount = 0;
    let completeCount = 0;
    const createPayloads: Record<string, unknown>[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads/') && u.includes('/complete')) {
        completeCount++;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: 'entities/ATA/disbursements/receipts/res-1.pdf',
              receiptFilename: 'receipt.pdf',
            },
          }),
        };
      }

      if (u.includes('/disbursements/receipt-uploads')) {
        uploadReservationCount++;
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: 'res-upload-1',
              uploadUrl: 'https://storage.test/upload-binary',
              objectKey: 'entities/ATA/disbursements/receipts/res-1.pdf',
              expiresAt: '2026-10-18T18:00:00.000Z',
            },
          }),
        };
      }

      if (u.includes('upload-binary') && init?.method === 'PUT') {
        uploadBinaryCount++;
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => '',
        };
      }

      if (u.includes('/disbursements') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        createPayloads.push(body);

        // Fail first attempt with 409 Conflict (e.g. concurrent conflict or validation error)
        if (createPayloads.length === 1) {
          return {
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              type: 'https://errors.ata-lta.com/conflict',
              title: 'Conflict',
              status: 409,
              detail: 'Disbursement draft generation collision. Please retry.',
              code: 'DISBURSEMENT_CONFLICT',
            }),
          };
        }

        // Second attempt succeeds
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              id: 'disb-success-101',
              status: 'Draft',
              ...body,
            },
          }),
        };
      }

      // Default GET mocks
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ data: [] }),
      };
    });

    const { wrapper } = createHarness();
    const onClose = vi.fn();
    const onSuccess = vi.fn();

    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    // Fill form
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '2500' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Filing fees with receipt upload' },
    });

    // Attach receipt
    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['dummy-receipt-bytes'], 'receipt.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [testFile] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
    });

    // First submit -> upload succeeds, create fails
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(createPayloads.length).toBe(1);
    });

    expect(uploadReservationCount).toBe(1);
    expect(uploadBinaryCount).toBe(1);
    expect(completeCount).toBe(1);
    expect(createPayloads[0]!.receiptS3Key).toBe('entities/ATA/disbursements/receipts/res-1.pdf');
    expect(createPayloads[0]!.receiptFilename).toBe('receipt.pdf');

    // Modal remains open with form intact
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');

    // Second submit (Retry!) -> must REUSE completed reservation without re-uploading
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(createPayloads.length).toBe(2);
    });

    // CRITICAL R7 / V8 ASSERTION:
    // Upload reservation, binary PUT, and complete endpoints MUST NOT have been called again!
    expect(uploadReservationCount).toBe(1);
    expect(uploadBinaryCount).toBe(1);
    expect(completeCount).toBe(1);

    // Second payload reuses the same completed key and filename
    expect(createPayloads[1]!.receiptS3Key).toBe('entities/ATA/disbursements/receipts/res-1.pdf');
    expect(createPayloads[1]!.receiptFilename).toBe('receipt.pdf');

    // Upon successful create, modal closes and triggers onSuccess
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('resets retained upload state and re-uploads when user selects a different file', async () => {
    let uploadReservationCount = 0;
    let uploadBinaryCount = 0;
    let completeCount = 0;
    const createPayloads: Record<string, unknown>[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads/') && u.includes('/complete')) {
        completeCount++;
        const currentFile = completeCount === 1 ? 'fileA.pdf' : 'fileB.pdf';
        const currentKey = completeCount === 1 ? 'keys/fileA.pdf' : 'keys/fileB.pdf';
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: currentKey,
              receiptFilename: currentFile,
            },
          }),
        };
      }

      if (u.includes('/disbursements/receipt-uploads')) {
        uploadReservationCount++;
        const currentKey = uploadReservationCount === 1 ? 'keys/fileA.pdf' : 'keys/fileB.pdf';
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: `res-upload-${uploadReservationCount}`,
              uploadUrl: `https://storage.test/upload-binary-${uploadReservationCount}`,
              objectKey: currentKey,
              expiresAt: '2026-10-18T18:00:00.000Z',
            },
          }),
        };
      }

      if (u.includes('upload-binary') && init?.method === 'PUT') {
        uploadBinaryCount++;
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => '',
        };
      }

      if (u.includes('/disbursements') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        createPayloads.push(body);

        if (createPayloads.length === 1) {
          return {
            ok: false,
            status: 400,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ title: 'Bad Request', detail: 'Invalid parameters' }),
          };
        }

        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: { id: 'disb-ok', status: 'Draft', ...body } }),
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
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1800' } });
    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Test description' } });

    // Drop File A
    const dropzone = screen.getByTestId('receipt-dropzone');
    const fileA = new File(['content-a'], 'fileA.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [fileA] } });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('fileA.pdf');
    });

    // Submit File A -> fails
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(createPayloads.length).toBe(1);
    });
    expect(uploadReservationCount).toBe(1);
    expect(createPayloads[0]!.receiptFilename).toBe('fileA.pdf');

    // User chooses a DIFFERENT file (File B)
    const fileB = new File(['content-b'], 'fileB.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [fileB] } });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('fileB.pdf');
    });

    // Submit File B -> must trigger a NEW upload for File B!
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(createPayloads.length).toBe(2);
    });

    // R7 Requirement: selecting different file must re-upload
    expect(uploadReservationCount).toBe(2);
    expect(uploadBinaryCount).toBe(2);
    expect(completeCount).toBe(2);
    expect(createPayloads[1]!.receiptS3Key).toBe('keys/fileB.pdf');
    expect(createPayloads[1]!.receiptFilename).toBe('fileB.pdf');
  });

  it('resets retained upload state when user clicks remove receipt button', async () => {
    let uploadReservationCount = 0;
    const createPayloads: Record<string, unknown>[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads/') && u.includes('/complete')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: 'keys/fileA.pdf',
              receiptFilename: 'fileA.pdf',
            },
          }),
        };
      }

      if (u.includes('/disbursements/receipt-uploads')) {
        uploadReservationCount++;
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: 'res-upload-1',
              uploadUrl: 'https://storage.test/upload-binary-1',
              objectKey: 'keys/fileA.pdf',
              expiresAt: '2026-10-18T18:00:00.000Z',
            },
          }),
        };
      }

      if (u.includes('upload-binary') && init?.method === 'PUT') {
        return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
      }

      if (u.includes('/disbursements') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        createPayloads.push(body);

        if (createPayloads.length === 1) {
          return {
            ok: false,
            status: 400,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ title: 'Bad Request' }),
          };
        }

        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: { id: 'disb-ok', status: 'Draft', ...body } }),
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
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '990' } });
    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Courier receipt' } });

    // Drop file & submit -> fails
    const dropzone = screen.getByTestId('receipt-dropzone');
    const fileA = new File(['content-a'], 'fileA.pdf', { type: 'application/pdf' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [fileA] } });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('fileA.pdf');
    });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(createPayloads.length).toBe(1);
    });

    // User removes receipt
    fireEvent.click(screen.getByTestId('remove-receipt-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('receipt-attached-filename')).not.toBeInTheDocument();
    });

    // User submits again without receipt -> triggers in-app confirmation
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('no-receipt-confirm-dialog')).toBeInTheDocument();
    });

    // Confirm creation without receipt
    fireEvent.click(screen.getByTestId('btn-confirm-no-receipt'));

    await waitFor(() => {
      expect(createPayloads.length).toBe(2);
    });

    // Dispatched second payload must have null for both receipt fields
    expect(createPayloads[1]!.receiptS3Key).toBeNull();
    expect(createPayloads[1]!.receiptFilename).toBeNull();
    // No additional upload reservation was created
    expect(uploadReservationCount).toBe(1);
  });

  it('never permits submitting receiptFilename without a verified receiptS3Key (R5 / F9 rejection of filename-only create fallback)', async () => {
    let dispatchedBody: Record<string, unknown> | null = null;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('/disbursements') && init?.method === 'POST') {
        dispatchedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: { id: 'disb-no-receipt', status: 'Draft', ...dispatchedBody },
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
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'No receipt voucher' } });

    // Submit with no file attached
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('no-receipt-confirm-dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('btn-confirm-no-receipt'));

    await waitFor(() => {
      expect(dispatchedBody).not.toBeNull();
    });

    // Invariant: receiptFilename must be null when receiptS3Key is null
    expect(dispatchedBody!.receiptS3Key).toBeNull();
    expect(dispatchedBody!.receiptFilename).toBeNull();
  });

  it('displays administrator guidance for RECEIPT_STORE_NOT_CONFIGURED 503, retains file and inputs, and prevents PUT/complete/create and no-receipt confirmation', async () => {
    let reservationCalls = 0;
    let putCalls = 0;
    let completeCalls = 0;
    let createCalls = 0;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads')) {
        reservationCalls++;
        return {
          ok: false,
          status: 503,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            type: 'https://errors.ata-lta.com/service-unavailable',
            title: 'Receipt store unavailable',
            status: 503,
            detail: 'Set RESERVATION_STORE_PATH to an absolute path on a shared durable volume.',
            code: 'RECEIPT_STORE_NOT_CONFIGURED',
          }),
        };
      }

      if (u.includes('upload-binary') && init?.method === 'PUT') {
        putCalls++;
        return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
      }

      if (u.includes('/complete')) {
        completeCalls++;
        return { ok: true, status: 200, headers: new Headers(), json: async () => ({ data: {} }) };
      }

      if (u.includes('/disbursements') && init?.method === 'POST') {
        createCalls++;
        return { ok: true, status: 201, headers: new Headers(), json: async () => ({ data: {} }) };
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
    const onSuccess = vi.fn();

    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    // Fill form
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '3500.50' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Court filing fees with official receipt' },
    });

    // Attach receipt
    const dropzone = screen.getByTestId('receipt-dropzone');
    const testFile = new File(['receipt-binary-content'], 'court_receipt.pdf', {
      type: 'application/pdf',
    });
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [testFile] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('court_receipt.pdf');
    });

    // Submit
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    // Wait for error feedback
    await waitFor(() => {
      expect(screen.getByTestId('error-receipt')).toBeInTheDocument();
    });

    // 1. Assert exact administrator guidance message per Spec C6
    expect(screen.getByTestId('error-receipt')).toHaveTextContent(
      'Receipt uploads are unavailable. Please contact your administrator. Your request has not been submitted.'
    );

    // 2. Assert selected file is retained
    expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('court_receipt.pdf');

    // 3. Assert form inputs are retained
    expect(screen.getByTestId('input-amount')).toHaveValue(3500.5);
    expect(screen.getByTestId('textarea-description')).toHaveValue(
      'Court filing fees with official receipt'
    );

    // 4. Assert reservation was attempted, but no PUT, complete, or voucher create occurred
    expect(reservationCalls).toBe(1);
    expect(putCalls).toBe(0);
    expect(completeCalls).toBe(0);
    expect(createCalls).toBe(0);

    // 5. Assert no-receipt confirmation dialog is NOT shown
    expect(screen.queryByTestId('no-receipt-confirm-dialog')).not.toBeInTheDocument();

    // 6. Assert submit button loading lock is released and modal is not closed
    const submitBtn = screen.getByTestId('submit-create-disbursement-btn');
    expect(submitBtn).not.toBeDisabled();
    expect(submitBtn).toHaveTextContent('Create Disbursement');
    expect(onClose).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('displays sanitized storage unavailable message for RECEIPT_STORE_DATABASE_UNAVAILABLE without exposing internals', async () => {
    let createCalls = 0;

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads')) {
        return {
          ok: false,
          status: 503,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            type: 'https://errors.ata-lta.com/service-unavailable',
            title: 'Receipt store database unavailable',
            status: 503,
            detail: 'connection refused to postgresql://super_admin:secret@db.internal:5432/ata_lta_erp',
            code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
          }),
        };
      }

      if (u.includes('/disbursements') && init?.method === 'POST') {
        createCalls++;
        return { ok: true, status: 201, headers: new Headers(), json: async () => ({ data: {} }) };
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
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1200' } });
    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'DB test' } });

    const dropzone = screen.getByTestId('receipt-dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['bytes'], 'receipt.png', { type: 'image/png' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.png');
    });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-receipt')).toBeInTheDocument();
    });

    // Sanitized storage-unavailable message without exposing backend internals
    const errorText = screen.getByTestId('error-receipt').textContent || '';
    expect(errorText).toBe(
      'Receipt storage is unavailable. Your request has not been submitted. Please try again later or contact your administrator.'
    );
    expect(errorText).not.toMatch(/postgresql|secret|connection refused/);
    expect(createCalls).toBe(0);
    expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.png');
    expect(screen.queryByTestId('no-receipt-confirm-dialog')).not.toBeInTheDocument();
  });

  it('displays sanitized storage unavailable message for RECEIPT_STORE_IO_ERROR without exposing filesystem paths', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads')) {
        return {
          ok: false,
          status: 503,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            type: 'https://errors.ata-lta.com/service-unavailable',
            title: 'Receipt store IO error',
            status: 503,
            detail: 'EACCES: permission denied, open /var/data/receipts/reservations.json',
            code: 'RECEIPT_STORE_IO_ERROR',
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
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '800' } });
    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'IO error test' } });

    const dropzone = screen.getByTestId('receipt-dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['bytes'], 'receipt.jpg', { type: 'image/jpeg' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.jpg');
    });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-receipt')).toBeInTheDocument();
    });

    const errorText = screen.getByTestId('error-receipt').textContent || '';
    expect(errorText).toBe(
      'Receipt storage is unavailable. Your request has not been submitted. Please try again later or contact your administrator.'
    );
    expect(errorText).not.toMatch(/EACCES|\/var\/data/);
  });

  it('retains retry guidance for RECEIPT_STORE_BUSY without duplicate punctuation', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads')) {
        return {
          ok: false,
          status: 503,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            type: 'https://errors.ata-lta.com/service-unavailable',
            title: 'Receipt store busy',
            status: 503,
            detail: 'Receipt store is busy. Retry this operation.',
            code: 'RECEIPT_STORE_BUSY',
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
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Busy test' } });

    const dropzone = screen.getByTestId('receipt-dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['bytes'], 'receipt.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
    });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-receipt')).toBeInTheDocument();
    });

    const errorText = screen.getByTestId('error-receipt').textContent || '';
    expect(errorText).toBe('Receipt upload failed: Receipt store is busy. Retry this operation.');
    expect(errorText).not.toContain('..');
  });

  it('retains retry guidance for network failures and avoids duplicate punctuation on unknown errors', async () => {
    // 1. Test network error
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/disbursements/receipt-uploads')) {
        throw new TypeError('Failed to fetch');
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
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Net test' } });

    const dropzone = screen.getByTestId('receipt-dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['bytes'], 'receipt.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
    });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-receipt')).toBeInTheDocument();
    });

    let errorText = screen.getByTestId('error-receipt').textContent || '';
    expect(errorText).toBe('Receipt upload failed: Failed to fetch. Please retry.');
    expect(errorText).not.toContain('..');

    // 2. Test unknown error ending with a period -> avoid duplicate punctuation
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes('/disbursements/receipt-uploads')) {
        return {
          ok: false,
          status: 500,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            detail: 'Unexpected upstream storage termination.',
            code: 'UNKNOWN_STORAGE_ERROR',
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

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      errorText = screen.getByTestId('error-receipt').textContent || '';
      expect(errorText).toBe(
        'Receipt upload failed: Unexpected upstream storage termination. Please retry.'
      );
    });
    expect(errorText).not.toContain('..');
  });

  it('allows deliberate retry after service restoration without re-selecting file', async () => {
    let attempts = 0;
    const createPayloads: Record<string, unknown>[] = [];

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);

      if (u.includes('/disbursements/receipt-uploads/') && u.includes('/complete')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              receiptS3Key: 'entities/ATA/disbursements/receipts/restored-res.pdf',
              receiptFilename: 'receipt.pdf',
            },
          }),
        };
      }

      if (u.includes('/disbursements/receipt-uploads')) {
        attempts++;
        if (attempts === 1) {
          // First attempt: DB unavailable
          return {
            ok: false,
            status: 503,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              detail: 'Storage DB down',
              code: 'RECEIPT_STORE_DATABASE_UNAVAILABLE',
            }),
          };
        }
        // Second attempt: restored!
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            data: {
              uploadId: 'upload-restored-1',
              uploadUrl: 'https://storage.test/upload-binary-restored',
              objectKey: 'entities/ATA/disbursements/receipts/restored-res.pdf',
              expiresAt: '2026-10-18T18:00:00.000Z',
            },
          }),
        };
      }

      if (u.includes('upload-binary-restored') && init?.method === 'PUT') {
        return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
      }

      if (u.includes('/disbursements') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        createPayloads.push(body);
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ data: { id: 'disb-restored-ok', status: 'Draft', ...body } }),
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
    const onSuccess = vi.fn();

    render(
      <CreateDisbursementModal
        isOpen={true}
        onClose={onClose}
        onSuccess={onSuccess}
        defaultWorkRequestId="11111111-1111-1111-1111-111111111111"
      />,
      { wrapper }
    );

    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '4200' } });
    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Restored service expense' },
    });

    const dropzone = screen.getByTestId('receipt-dropzone');
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['bytes'], 'receipt.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() => {
      expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');
    });

    // 1st attempt: fails
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-receipt')).toHaveTextContent(
        'Receipt storage is unavailable. Your request has not been submitted. Please try again later or contact your administrator.'
      );
    });

    expect(createPayloads.length).toBe(0);
    expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('receipt.pdf');

    // 2nd attempt: user clicks retry after restoration WITHOUT having to re-select file
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(createPayloads.length).toBe(1);
    });

    expect(createPayloads[0]!.receiptS3Key).toBe(
      'entities/ATA/disbursements/receipts/restored-res.pdf'
    );
    expect(createPayloads[0]!.receiptFilename).toBe('receipt.pdf');
    expect(onClose).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });
});
