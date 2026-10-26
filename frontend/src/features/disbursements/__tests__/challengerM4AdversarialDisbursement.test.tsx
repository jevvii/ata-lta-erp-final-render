import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { DisbursementDetailDrawer } from '../components/DisbursementDetailDrawer';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import type { Disbursement } from '../api/types';

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

    setSession: ({ user, permissions, activeEntity, unreadCount }: { user: UserProfile; permissions: Set<string> | string[]; activeEntity?: string; unreadCount?: number }) => {
      const permSet = permissions instanceof Set ? permissions : new Set(permissions);
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

const mockDraftDisbursement: Disbursement = {
  id: 'disb-draft-1',
  disbursement_number: 'DISB-ATA-20261018-001',
  entity_id: 'ent-ata',
  entity_code: 'ATA',
  category: 'Supplies',
  description: 'Stationery and postage',
  amount: 1200,
  fund_source: 'Firm Fund',
  status: 'Draft',
  lifecycle_version: 2,
  review_ready: true,
  linked_work_request_id: '11111111-1111-1111-1111-111111111111',
  version: 1,
  created_at: '2026-10-18T10:00:00Z',
  updated_at: '2026-10-18T10:00:00Z',
};

const mockImageDisbursement: Disbursement = {
  ...mockDraftDisbursement,
  id: 'disb-img-1',
  status: 'Released',
  version: 3,
  payment_method: 'Bank Transfer',
  payment_date: '2026-10-18',
  receipt_filename: 'receipt_scan.png',
  receipt_s3_key: 'entities/ATA/disbursements/receipts/receipt_scan.png',
};

describe('Adversarial Challenge: CreateDisbursementModal & DisbursementDetailDrawer (F15 & F16 / R7 / V8, V9)', () => {
  const originalFetch = global.fetch;

  const VALID_M4_TASK_ID = '22222222-2222-4222-8222-222222222222';
  const mockDefaultTasks = [
    {
      id: VALID_M4_TASK_ID,
      workRequestId: '11111111-1111-1111-1111-111111111111',
      title: 'Cascade Task',
      status: 'In Progress',
      assigneeId: 'u-admin-1',
      assignees: ['u-admin-1'],
    },
  ];

  const setAdminSession = () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'u-admin-1',
        email: 'admin@ata-lta.ph',
        name: 'Admin Challenger',
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
    sessionStorage.clear();
    useBlockingModalStore.getState().reset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('Challenge 1: Upload Retry Preservation Across Cascade Failures (409, 500, Network Rejection)', () => {
    it('reuses a verified upload after a proven rejection but blocks retry after an ambiguous server failure', async () => {
      let uploadReservationCalls = 0;
      let uploadBinaryCalls = 0;
      let uploadCompleteCalls = 0;
      const dispatchedPayloads: Record<string, unknown>[] = [];
      let attemptCount = 0;

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);

        // Upload reservation endpoint
        if (u.includes('/disbursements/receipt-uploads') && !u.includes('/complete')) {
          uploadReservationCalls++;
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                uploadId: 'upl-cascade-1',
                uploadUrl: 'https://storage.test/upload-binary-cascade',
                objectKey: 'entities/ATA/receipts/cascade-key.pdf',
                expiresAt: '2026-10-18T19:00:00.000Z',
              },
            }),
          };
        }

        // Upload binary PUT
        if (u.includes('upload-binary-cascade') && init?.method === 'PUT') {
          uploadBinaryCalls++;
          return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
        }

        // Upload complete endpoint
        if (u.includes('/disbursements/receipt-uploads/upl-cascade-1/complete')) {
          uploadCompleteCalls++;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                receiptS3Key: 'entities/ATA/receipts/cascade-key.pdf',
                receiptFilename: 'cascade_receipt.pdf',
              },
            }),
          };
        }

        // Voucher creation endpoint POST /disbursements
        if (u.includes('/disbursements') && init?.method === 'POST') {
          attemptCount++;
          const body = JSON.parse(init.body as string);
          dispatchedPayloads.push(body);

          if (attemptCount === 1) {
            // Attempt 1 fails with 409 Conflict
            return {
              ok: false,
              status: 409,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ title: 'Conflict', detail: 'Voucher number collision' }),
            };
          }

          if (attemptCount === 2) {
            // Attempt 2 fails with 500 Internal Server Error
            return {
              ok: false,
              status: 500,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ title: 'Server Error', detail: 'Database transaction lock timeout' }),
            };
          }

          if (attemptCount === 3) {
            // Attempt 3 fails with Network Error (fetch throws)
            throw new Error('Failed to fetch: Network disconnection');
          }

          // Attempt 4 succeeds with 201 Created
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                id: 'disb-cascade-final',
                status: 'Draft',
                ...body,
              },
            }),
          };
        }

        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
          };
        }

        // Fallback for auxiliary lookups (work requests, clients, etc.)
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
          defaultTaskId={VALID_M4_TASK_ID}
        />,
        { wrapper }
      );

      // Fill valid form
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '3500' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Cascade retry test expense' },
      });

      // Attach file
      const dropzone = screen.getByTestId('receipt-dropzone');
      const testFile = new File(['cascade-binary-content'], 'cascade_receipt.pdf', {
        type: 'application/pdf',
      });
      fireEvent.drop(dropzone, { dataTransfer: { files: [testFile] } });

      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('cascade_receipt.pdf');
      });

      const submitBtn = screen.getByTestId('submit-create-disbursement-btn');

      // Attempt 1: Uploads file, hits 409 conflict
      fireEvent.click(submitBtn);
      await waitFor(() => expect(dispatchedPayloads.length).toBe(1));
      expect(uploadReservationCalls).toBe(1);
      expect(uploadBinaryCalls).toBe(1);
      expect(uploadCompleteCalls).toBe(1);
      expect(dispatchedPayloads[0]!.receiptS3Key).toBe('entities/ATA/receipts/cascade-key.pdf');

      // Attempt 2: Retries after 409, hits 500 error
      fireEvent.click(submitBtn);
      await waitFor(() => expect(dispatchedPayloads.length).toBe(2));
      expect(uploadReservationCalls).toBe(1); // No new upload!
      expect(uploadBinaryCalls).toBe(1);
      expect(uploadCompleteCalls).toBe(1);
      expect(dispatchedPayloads[1]!.receiptS3Key).toBe('entities/ATA/receipts/cascade-key.pdf');

      await waitFor(() => expect(screen.getByTestId('create-outcome-uncertain')).toBeInTheDocument());
      expect(submitBtn).toBeDisabled();
      const replacement = new File(['replacement'], 'replacement.pdf', { type: 'application/pdf' });
      fireEvent.drop(screen.getByTestId('receipt-dropzone'), { dataTransfer: { files: [replacement] } });
      fireEvent.click(submitBtn);
      expect(dispatchedPayloads).toHaveLength(2);
      expect(submitBtn).toBeDisabled();
      expect(onSuccess).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('preserves retained upload reservation even when user modifies other form fields between retries', async () => {
      let uploadReservationCalls = 0;
      const dispatchedPayloads: Record<string, unknown>[] = [];
      let attempt = 0;

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);

        if (u.includes('/disbursements/receipt-uploads') && !u.includes('/complete')) {
          uploadReservationCalls++;
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                uploadId: 'upl-field-edit',
                uploadUrl: 'https://storage.test/upload-binary-fe',
                objectKey: 'entities/ATA/receipts/field-edit-key.pdf',
                expiresAt: '2026-10-18T19:00:00.000Z',
              },
            }),
          };
        }

        if (u.includes('upload-binary-fe') && init?.method === 'PUT') {
          return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
        }

        if (u.includes('/disbursements/receipt-uploads/upl-field-edit/complete')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                receiptS3Key: 'entities/ATA/receipts/field-edit-key.pdf',
                receiptFilename: 'field_edit.pdf',
              },
            }),
          };
        }

        if (u.includes('/disbursements') && init?.method === 'POST') {
          attempt++;
          const body = JSON.parse(init.body as string);
          dispatchedPayloads.push(body);

          if (attempt === 1) {
            return {
              ok: false,
              status: 400,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ title: 'Bad Request', detail: 'Description too short' }),
            };
          }

          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'disb-fe-ok', status: 'Draft', ...body } }),
          };
        }

        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
          defaultTaskId={VALID_M4_TASK_ID}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1000' } });
      fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Original desc' } });

      const testFile = new File(['content'], 'field_edit.pdf', { type: 'application/pdf' });
      fireEvent.drop(screen.getByTestId('receipt-dropzone'), { dataTransfer: { files: [testFile] } });

      await waitFor(() => {
        expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('field_edit.pdf');
      });

      // Submit attempt 1 -> fails with 400
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      await waitFor(() => expect(dispatchedPayloads.length).toBe(1));
      expect(uploadReservationCalls).toBe(1);
      expect(dispatchedPayloads[0]!.amount).toBe(1000);
      expect(dispatchedPayloads[0]!.description).toBe('Original desc');
      expect(dispatchedPayloads[0]!.receiptS3Key).toBe('entities/ATA/receipts/field-edit-key.pdf');

      // User fixes fields: updates amount and description
      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '2500' } });
      fireEvent.change(screen.getByTestId('textarea-description'), {
        target: { value: 'Amended detailed description for accounting' },
      });

      // Submit attempt 2 (Retry with amended fields)
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      await waitFor(() => expect(dispatchedPayloads.length).toBe(2));

      // Reservation call MUST NOT be repeated
      expect(uploadReservationCalls).toBe(1);
      // New payload reflects edited fields AND retained receipt
      expect(dispatchedPayloads[1]!.amount).toBe(2500);
      expect(dispatchedPayloads[1]!.description).toBe('Amended detailed description for accounting');
      expect(dispatchedPayloads[1]!.receiptS3Key).toBe('entities/ATA/receipts/field-edit-key.pdf');
      expect(dispatchedPayloads[1]!.receiptFilename).toBe('field_edit.pdf');
    });
  });

  describe('Challenge 2: Invalidation Rigor & Reset Verification', () => {
    it('completely purges retained reservation when file is removed and creates a new reservation if a different file is selected', async () => {
      let uploadReservationCount = 0;
      const uploadedKeys: string[] = [];
      const createPayloads: Record<string, unknown>[] = [];

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);

        if (u.includes('/disbursements/receipt-uploads') && !u.includes('/complete')) {
          uploadReservationCount++;
          const currentKey = `entities/ATA/receipts/file-${uploadReservationCount}.pdf`;
          uploadedKeys.push(currentKey);
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                uploadId: `res-id-${uploadReservationCount}`,
                uploadUrl: `https://storage.test/put-${uploadReservationCount}`,
                objectKey: currentKey,
                expiresAt: '2026-10-18T19:00:00.000Z',
              },
            }),
          };
        }

        if (u.includes('https://storage.test/put-') && init?.method === 'PUT') {
          return { ok: true, status: 200, headers: new Headers(), text: async () => '' };
        }

        if (u.includes('/disbursements/receipt-uploads/res-id-') && u.includes('/complete')) {
          const match = u.match(/res-id-(\d+)/);
          const num = match ? match[1] : '1';
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                receiptS3Key: `entities/ATA/receipts/file-${num}.pdf`,
                receiptFilename: `file-${num}.pdf`,
              },
            }),
          };
        }

        if (u.includes('/disbursements') && init?.method === 'POST') {
          const body = JSON.parse(init.body as string);
          createPayloads.push(body);
          return {
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ title: 'Simulated failure' }),
          };
        }

        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
          defaultTaskId={VALID_M4_TASK_ID}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '450' } });
      fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Invalidation test' } });

      const dropzone = screen.getByTestId('receipt-dropzone');

      // 1. Drop File 1 & Submit -> fails
      const file1 = new File(['file-1-bytes'], 'file-1.pdf', { type: 'application/pdf' });
      fireEvent.drop(dropzone, { dataTransfer: { files: [file1] } });
      await waitFor(() => expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('file-1.pdf'));

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      await waitFor(() => expect(createPayloads.length).toBe(1));
      expect(uploadReservationCount).toBe(1);
      expect(createPayloads[0]!.receiptS3Key).toBe('entities/ATA/receipts/file-1.pdf');

      // 2. Click Remove button -> clears file
      fireEvent.click(screen.getByTestId('remove-receipt-btn'));
      await waitFor(() => expect(screen.queryByTestId('receipt-attached-filename')).not.toBeInTheDocument());

      // 3. Drop File 2 & Submit -> MUST create reservation 2, never reuse 1
      const file2 = new File(['file-2-bytes'], 'file-2.pdf', { type: 'application/pdf' });
      fireEvent.drop(dropzone, { dataTransfer: { files: [file2] } });
      await waitFor(() => expect(screen.getByTestId('receipt-attached-filename')).toHaveTextContent('file-2.pdf'));

      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      await waitFor(() => expect(createPayloads.length).toBe(2));
      expect(uploadReservationCount).toBe(2);
      expect(createPayloads[1]!.receiptS3Key).toBe('entities/ATA/receipts/file-2.pdf');
      expect(createPayloads[1]!.receiptFilename).toBe('file-2.pdf');
    });

    it('rejects forbidden file types and oversized files without invoking upload reservation', async () => {
      let uploadReservationCount = 0;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/receipt-uploads')) {
          uploadReservationCount++;
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
          defaultTaskId={VALID_M4_TASK_ID}
        />,
        { wrapper }
      );

      const dropzone = screen.getByTestId('receipt-dropzone');

      // Attempt forbidden MIME type (.exe)
      const executableFile = new File(['binary-exe'], 'exploit.exe', { type: 'application/x-msdownload' });
      fireEvent.drop(dropzone, { dataTransfer: { files: [executableFile] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-receipt')).toHaveTextContent('Only PDF, PNG, and JPEG files are allowed');
      });
      expect(screen.queryByTestId('receipt-attached-filename')).not.toBeInTheDocument();
      expect(uploadReservationCount).toBe(0);

      // Attempt oversized file (> 10 MiB)
      const oversizedFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'huge.pdf', {
        type: 'application/pdf',
      });
      fireEvent.drop(dropzone, { dataTransfer: { files: [oversizedFile] } });

      await waitFor(() => {
        expect(screen.getByTestId('error-receipt')).toHaveTextContent('File size cannot exceed 10 MiB');
      });
      expect(screen.queryByTestId('receipt-attached-filename')).not.toBeInTheDocument();
      expect(uploadReservationCount).toBe(0);
    });
  });

  describe('Challenge 3: Paired Metadata Enforcement (R5 / F9 Rejection of Filename-Only Creates)', () => {
    it('strictly sends null receiptFilename whenever receiptS3Key is null', async () => {
      let postedBody: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements') && init?.method === 'POST') {
          postedBody = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: { id: 'disb-no-rec-1', status: 'Draft', ...postedBody } }),
          };
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
          defaultTaskId={VALID_M4_TASK_ID}
        />,
        { wrapper }
      );

      fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '850' } });
      fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'No document attached' } });

      // Click create without receipt -> dialog asks confirmation
      fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));
      await waitFor(() => expect(screen.getByTestId('no-receipt-confirm-dialog')).toBeInTheDocument());

      // Confirm "Create Anyway"
      fireEvent.click(screen.getByTestId('btn-confirm-no-receipt'));
      await waitFor(() => expect(postedBody).not.toBeNull());

      // Strict paired null contract:
      expect(postedBody!.receiptS3Key).toBeNull();
      expect(postedBody!.receiptFilename).toBeNull();
    });
  });

  describe('Challenge 4: Drawer Receipt Signed URL Expiry, Refresh, and Error Recovery (F16 / R7 / V9)', () => {
    it('refetches signed URL when explicit refresh link button is clicked', async () => {
      let fetchCount = 0;
      const disbWithReceipt: Disbursement = {
        ...mockDraftDisbursement,
        receipt_s3_key: 'entities/ATA/receipts/token.pdf',
        receipt_filename: 'invoice_receipt.pdf',
      };

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-draft-1/receipt-url')) {
          fetchCount++;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                url: `https://storage.test/signed/token-v${fetchCount}.pdf`,
                filename: 'invoice_receipt.pdf',
                contentType: 'application/pdf',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-draft-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: disbWithReceipt }),
          };
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          initialDisbursement={disbWithReceipt}
        />,
        { wrapper }
      );

      // Initial link
      await waitFor(() => {
        expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute(
          'href',
          'https://storage.test/signed/token-v1.pdf'
        );
      });
      expect(fetchCount).toBe(1);

      // Click "Refresh Link" button
      fireEvent.click(screen.getByTestId('btn-refresh-receipt'));

      // Link updates to newly signed token URL
      await waitFor(() => {
        expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute(
          'href',
          'https://storage.test/signed/token-v2.pdf'
        );
      });
      expect(fetchCount).toBe(2);
    });

    it('renders error retry state and recovers when retry button is pressed', async () => {
      let fail = true;
      const disbWithReceipt: Disbursement = {
        ...mockDraftDisbursement,
        receipt_s3_key: 'entities/ATA/receipts/token.pdf',
        receipt_filename: 'invoice_receipt.pdf',
      };

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-draft-1/receipt-url')) {
          if (fail) {
            return {
              ok: false,
              status: 403,
              headers: new Headers({ 'content-type': 'application/json' }),
              json: async () => ({ error: 'Signed URL expired or forbidden' }),
            };
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                url: 'https://storage.test/signed/recovered.pdf',
                filename: 'invoice_receipt.pdf',
                contentType: 'application/pdf',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-draft-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: disbWithReceipt }),
          };
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          initialDisbursement={disbWithReceipt}
        />,
        { wrapper }
      );

      // Expect error state
      await waitFor(() => {
        expect(screen.getByTestId('receipt-error-state')).toBeInTheDocument();
        expect(screen.getByTestId('btn-retry-receipt')).toBeInTheDocument();
      }, { timeout: 4000 });

      // Recover and click Retry
      fail = false;
      fireEvent.click(screen.getByTestId('btn-retry-receipt'));

      await waitFor(() => {
        expect(screen.getByTestId('btn-download-receipt')).toHaveAttribute(
          'href',
          'https://storage.test/signed/recovered.pdf'
        );
      });
      expect(screen.queryByTestId('receipt-error-state')).not.toBeInTheDocument();
    });

    it('handles image preview error event with fallback UI and successful refresh', async () => {
      let isRefreshed = false;
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-img-1/receipt-url')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                url: isRefreshed
                  ? 'https://storage.test/signed/fresh_image.png'
                  : 'https://storage.test/signed/expired_image.png',
                filename: 'receipt_scan.png',
                contentType: 'image/png',
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-img-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockImageDisbursement }),
          };
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          initialDisbursement={mockImageDisbursement}
        />,
        { wrapper }
      );

      // Inline image is rendered initially
      await waitFor(() => expect(screen.getByTestId('btn-open-modal-receipt')).toBeInTheDocument());
      fireEvent.click(screen.getByTestId('btn-open-modal-receipt'));
      await waitFor(() => {
        expect(screen.getByTestId('doc-preview-image')).toBeInTheDocument();
      });

      // Simulate image 403 load error
      fireEvent.error(screen.getByTestId('doc-preview-image'));

      // Fallback UI replaces broken image
      await waitFor(() => {
        expect(screen.getByTestId('attachment-preview-error')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry preview' })).toBeInTheDocument();
      });
      expect(screen.queryByTestId('doc-preview-image')).not.toBeInTheDocument();

      // Click refresh image preview
      isRefreshed = true;
      fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));

      // New image loads and error banner is dismissed
      await waitFor(() => {
        expect(screen.getByTestId('doc-preview-image')).toBeInTheDocument();
      });
      expect(screen.getByTestId('doc-preview-image')).toHaveAttribute(
        'src',
        'https://storage.test/signed/fresh_image.png'
      );
      expect(screen.queryByTestId('attachment-preview-error')).not.toBeInTheDocument();
    });
  });

  describe('Challenge 5: Closure of Direct Approval Bypass & Mandatory Admin Approval Routing (R1 & R7)', () => {
    it('verifies clicking Direct Approve from Draft opens AdminApprovalModal and submits expectedVersion', async () => {
      let approvedPayload: Record<string, unknown> | null = null;
      let approveEndpointCalled = false;

      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-draft-1/approve') && init?.method === 'POST') {
          approveEndpointCalled = true;
          approvedPayload = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                ...mockDraftDisbursement,
                status: 'Approved',
                version: 2,
                ...approvedPayload,
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-draft-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDraftDisbursement }),
          };
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          initialDisbursement={mockDraftDisbursement}
        />,
        { wrapper }
      );

      // Direct approve button in drawer
      const directApproveBtn = screen.getByTestId('drawer-direct-approve-btn');
      expect(directApproveBtn).toBeInTheDocument();

      // Clicking Direct Approve MUST NOT fire the approve endpoint directly!
      fireEvent.click(directApproveBtn);
      expect(approveEndpointCalled).toBe(false);

      // It must open AdminApprovalModal
      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });

      // Confirm in modal (v2 initial approval does not collect payment fields)
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(approveEndpointCalled).toBe(true);
        expect(approvedPayload).not.toBeNull();
      });

      // Strict validation contract compliance: sends expectedVersion
      expect(approvedPayload).toEqual({ expectedVersion: 1 });
    });

    it('verifies v2 initial draft approval submits expectedVersion without payment fields', async () => {
      let approvedPayload: Record<string, unknown> | null = null;
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-draft-1/approve') && init?.method === 'POST') {
          approvedPayload = JSON.parse(init.body as string);
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              data: {
                ...mockDraftDisbursement,
                status: 'Approved',
                version: 2,
                ...approvedPayload,
              },
            }),
          };
        }
        if (u.includes('/disbursements/disb-draft-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDraftDisbursement }),
          };
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          initialDisbursement={mockDraftDisbursement}
        />,
        { wrapper }
      );

      const approveBtn = screen.getByTestId('drawer-direct-approve-btn');
      expect(approveBtn).toBeInTheDocument();

      fireEvent.click(approveBtn);

      await waitFor(() => {
        expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('select-payment-method')).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      await waitFor(() => {
        expect(approvedPayload).not.toBeNull();
      });

      expect(approvedPayload).toEqual({ expectedVersion: 1 });
    });

    it('propagates OCC 409 Conflict during AdminApprovalModal submission to ConflictResolutionModal', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/disbursements/disb-draft-1/approve') && init?.method === 'POST') {
          return {
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({
              type: 'https://errors.ata-lta.com/conflict',
              title: 'Conflict',
              status: 409,
              detail: 'Voucher was modified concurrently by another user',
              currentVersion: 3,
            }),
          };
        }
        if (u.includes('/disbursements/disb-draft-1')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDraftDisbursement }),
          };
        }
        if (u.includes('/tasks')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            json: async () => ({ data: mockDefaultTasks }),
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
        <DisbursementDetailDrawer
          isOpen={true}
          onClose={vi.fn()}
          initialDisbursement={mockDraftDisbursement}
        />,
        { wrapper }
      );

      fireEvent.click(screen.getByTestId('drawer-direct-approve-btn'));
      await waitFor(() => expect(screen.getByTestId('admin-approval-modal')).toBeInTheDocument());

      fireEvent.click(screen.getByTestId('btn-confirm-approve'));

      // Conflict modal should be triggered
      await waitFor(() => {
        expect(screen.getByTestId('conflict-resolution-modal')).toBeInTheDocument();
      });

      // AdminApprovalModal is dismissed
      expect(screen.queryByTestId('admin-approval-modal')).not.toBeInTheDocument();
    });
  });
});
