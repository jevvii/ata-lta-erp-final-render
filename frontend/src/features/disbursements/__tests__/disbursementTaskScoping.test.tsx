import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('@/components/ui/date-input', () => ({ DateInput: () => null }));
import { CreateDisbursementModal } from '../components/CreateDisbursementModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { operationsKeys } from '@/features/operations/api/queryKeys';

const WR_1 = '22222222-2222-4222-8222-222222222222';
const WR_2 = '22222222-2222-4222-8222-333333333333';
const CLIENT_1 = '11111111-1111-4111-8111-111111111111';
const TASK_ASSIGNED = '33333333-3333-4333-8333-333333333333';
const TASK_ASSIGNED_2 = '66666666-6666-4666-8666-666666666666';
const TASK_UNASSIGNED = '44444444-4444-4444-8444-444444444444';
const CALLER_USER_ID = 'user-disbursement-caller';

let client: QueryClient;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useBlockingModalStore.getState().reset();
});

function setupMockFetch(
  posts: { url: string; body: Record<string, unknown> }[],
  options?: {
    uploadCompleteDeferred?: Promise<Response>;
  }
) {
  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ data }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && /\/disbursements$/.test(url)) {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        return respond({ id: 'disb-created', status: 'Draft', ...body }, 201);
      }
      if (url.includes('/disbursements/receipt-uploads/') && url.includes('/complete')) {
        if (options?.uploadCompleteDeferred) {
          return await options.uploadCompleteDeferred;
        }
        return respond({
          receiptS3Key: 'entities/ATA/disbursements/receipts/receipt.png',
          receiptFilename: 'receipt.png',
        });
      }
      if (url.includes('/disbursements/receipt-uploads')) {
        return respond(
          {
            uploadId: 'up-reservation-1',
            uploadUrl: 'https://storage.test/upload-binary',
            objectKey: 'entities/ATA/disbursements/receipts/receipt.png',
            expiresAt: '2026-12-31T23:59:59Z',
          },
          201
        );
      }
      if (url.includes('https://storage.test/upload-binary')) {
        return new Response(null, { status: 200 });
      }
      if (url.includes(`/operations/work-requests/${WR_1}/tasks`)) {
        return respond([
          {
            id: TASK_ASSIGNED,
            workRequestId: WR_1,
            title: 'Assigned Voucher Task',
            assigneeId: CALLER_USER_ID,
            assignees: [CALLER_USER_ID],
          },
          {
            id: TASK_ASSIGNED_2,
            workRequestId: WR_1,
            title: 'Second Assigned Task',
            assigneeId: CALLER_USER_ID,
            assignees: [CALLER_USER_ID],
          },
          {
            id: TASK_UNASSIGNED,
            workRequestId: WR_1,
            title: 'Unassigned Foreign Task',
            assigneeId: 'someone-else',
            assignees: ['someone-else'],
          },
        ]);
      }
      if (url.includes(`/operations/work-requests/${WR_2}/tasks`)) {
        return respond([]);
      }
      if (url.includes('/operations/work-requests')) {
        return respond([
          {
            id: WR_1,
            title: 'Operations WR 1',
            client_id: CLIENT_1,
            clientId: CLIENT_1,
            status: 'In Progress',
            entity: 'ATA',
          },
          {
            id: WR_2,
            title: 'Operations WR 2',
            client_id: CLIENT_1,
            clientId: CLIENT_1,
            status: 'In Progress',
            entity: 'ATA',
          },
        ]);
      }
      if (url.includes('/clients')) {
        return respond([{ id: CLIENT_1, name: 'Client 1', entity: 'ATA' }]);
      }
      return respond([]);
    })
  );
}

describe('F02: Standalone Disbursements Task Scoping & Lifecycle', () => {
  it('filters task options to only assigned tasks for non-admin callers across roles (F02)', async () => {
    for (const role of ['Operations', 'Documentation', 'Accounting', 'Manager']) {
      useSessionStore.getState().setSession({
        user: {
          id: CALLER_USER_ID,
          name: `${role} Caller`,
          email: `${role.toLowerCase()}@ata-lta.ph`,
          role,
          departments: [role === 'Manager' ? 'Management' : role],
          entities: ['ATA'],
        },
        permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
        activeEntity: 'ATA',
      });

      const posts: { url: string; body: Record<string, unknown> }[] = [];
      setupMockFetch(posts);
      client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

      const { unmount } = render(
        <QueryClientProvider client={client}>
          <CreateDisbursementModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }} />
        </QueryClientProvider>
      );

      // Wait for task options to load
      await waitFor(() => {
        const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
        expect(qState?.status).toBe('success');
      });

      const taskSelectTrigger = screen.getByTestId('select-work-request-task');
      fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      // Assigned task must be in dropdown and enabled
      const assignedOpt = await screen.findByRole('option', { name: /Assigned Voucher Task/i });
      expect(assignedOpt).toBeInTheDocument();
      expect(assignedOpt).not.toHaveAttribute('aria-disabled', 'true');

      // Foreign unassigned task must be in dropdown but marked as not assigned
      const unassignedOpt = await screen.findByRole('option', {
        name: /Unassigned Foreign Task.*Not assigned to you/i,
      });
      expect(unassignedOpt).toBeInTheDocument();
      expect(unassignedOpt).toHaveAttribute('aria-disabled', 'true');

      unmount();
      cleanup();
    }
  });

  it('shows all tasks to Admin users', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'admin-caller',
        name: 'Admin Caller',
        email: 'admin@ata-lta.ph',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    const taskSelectTrigger = screen.getByTestId('select-work-request-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

    const assignedOpt = await screen.findByRole('option', { name: /Assigned Voucher Task/i });
    const unassignedOpt = await screen.findByRole('option', { name: /Unassigned Foreign Task/i });
    expect(assignedOpt).toBeInTheDocument();
    expect(unassignedOpt).toBeInTheDocument();
    expect(unassignedOpt).not.toHaveAttribute('aria-disabled', 'true');
    expect(unassignedOpt.textContent).not.toContain('Not assigned to you');
  });

  it('denies admin exemption to email lorein@ata-lta.ph when role is Staff', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Lorein Staff',
        email: 'lorein@ata-lta.ph',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    const taskSelectTrigger = screen.getByTestId('select-work-request-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

    const assignedOpt = await screen.findByRole('option', { name: /Assigned Voucher Task/i });
    expect(assignedOpt).toBeInTheDocument();
    const unassignedOpt = await screen.findByRole('option', {
      name: /Unassigned Foreign Task.*Not assigned to you/i,
    });
    expect(unassignedOpt).toBeInTheDocument();
    expect(unassignedOpt).toHaveAttribute('aria-disabled', 'true');
  });

  it('blocks submission and shows visible error for invalid/unassigned prefilled task', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Ops Worker',
        email: 'ops@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal
          isOpen
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_1, clientId: CLIENT_1, taskId: TASK_UNASSIGNED }}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'Expense for task' } });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '500' } });
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    // Error must be visible on the form and no POST dispatched
    await waitFor(() => {
      expect(screen.getByTestId('error-selected-task')).toHaveTextContent(/not assigned/i);
    });
    expect(posts).toHaveLength(0);
  });

  it('enforces mandatory linked task: rejects disbursement creation when no task is selected', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Ops Worker',
        email: 'ops@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal isOpen onClose={vi.fn()} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByTestId('textarea-description'), { target: { value: 'WR general expense' } });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '250' } });

    // Submit with no linked task
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-selected-task')).toHaveTextContent(/linked task is required/i);
    });
    expect(posts).toHaveLength(0);
  });

  it('Assigned task-linked disbursement success must POST proper task ID', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Ops Worker',
        email: 'ops@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal
          isOpen
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_1, clientId: CLIENT_1, taskId: TASK_ASSIGNED }}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Disbursement for assigned task' },
    });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '1250' } });

    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    // Confirm no-receipt modal
    const confirmBtn = await screen.findByTestId('btn-confirm-no-receipt');
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.body).toMatchObject({
      linkedWorkRequestId: WR_1,
      linkedTaskId: TASK_ASSIGNED,
      amount: 1250,
    });
  });

  it('switching work request clears selected task and resets target generation', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Ops Worker',
        email: 'ops@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    const taskSelectTrigger = screen.getByTestId('select-work-request-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const opt = await screen.findByRole('option', { name: /Assigned Voucher Task/i });
    fireEvent.click(opt);
    expect(taskSelectTrigger).toHaveTextContent(/Assigned Voucher Task/i);

    // Switch work request
    const wrSelect = screen.getByTestId('select-work-request');
    fireEvent.change(wrSelect, { target: { value: WR_2 } });

    // Task selection must be cleared immediately
    expect(taskSelectTrigger).not.toHaveTextContent(/Assigned Voucher Task/i);
  });

  it('Deferred receipt upload followed by assignment revocation/invalidation => no create POST', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Ops Worker',
        email: 'ops@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    let resolveUploadComplete!: (value: Response) => void;
    const uploadCompleteDeferred = new Promise<Response>((resolve) => {
      resolveUploadComplete = resolve;
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts, { uploadCompleteDeferred });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal
          isOpen
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_1, clientId: CLIENT_1, taskId: TASK_ASSIGNED }}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Attach receipt file
    const file = new File(['dummy binary'], 'receipt.png', { type: 'image/png' });
    const fileInput = screen.getByTestId('receipt-file-input');
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Expense with deferred upload' },
    });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '880' } });

    // Click submit: starts async receipt upload pipeline
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    // Wait until upload is in flight (reservation created and binary upload done, waiting on complete)
    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
        String(url).includes('/disbursements/receipt-uploads')
      )).toBe(true);
    });

    // While upload is in flight: revoke caller's assignment in query state
    client.setQueryData(operationsKeys.tasks(WR_1, 'ATA'), [
      {
        id: TASK_ASSIGNED,
        workRequestId: WR_1,
        title: 'Revoked Task',
        assigneeId: 'revoked-user',
        assignees: ['revoked-user'],
      },
    ]);

    // Now resolve the upload completion
    resolveUploadComplete(
      new Response(
        JSON.stringify({
          data: {
            receiptS3Key: 'entities/ATA/disbursements/receipts/receipt.png',
            receiptFilename: 'receipt.png',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    // Live verification should detect revoked assignment and fail closed
    await waitFor(() => {
      expect(screen.getByTestId('error-selected-task')).toHaveTextContent(/not assigned/i);
    });

    // Ensure zero create disbursements POSTs were dispatched
    expect(posts).toHaveLength(0);
  });

  it('changing an unlocked task while upload completion is pending discards the old target', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Ops Worker',
        email: 'ops@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'disbursement:view', 'disbursement:create'],
      activeEntity: 'ATA',
    });

    let resolveUploadComplete!: (value: Response) => void;
    const uploadCompleteDeferred = new Promise<Response>((resolve) => {
      resolveUploadComplete = resolve;
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts, { uploadCompleteDeferred });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <CreateDisbursementModal
          isOpen
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    const taskSelectTrigger = screen.getByTestId('select-work-request-task');
    expect(taskSelectTrigger).not.toBeDisabled();
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const opt = await screen.findByRole('option', { name: /Assigned Voucher Task/i });
    fireEvent.click(opt);

    // Attach receipt file
    const file = new File(['dummy binary'], 'receipt.png', { type: 'image/png' });
    const fileInput = screen.getByTestId('receipt-file-input');
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.change(screen.getByTestId('textarea-description'), {
      target: { value: 'Expense target race' },
    });
    fireEvent.change(screen.getByTestId('input-amount'), { target: { value: '450' } });

    // Submit attempt 1 with Task A
    fireEvent.click(screen.getByTestId('submit-create-disbursement-btn'));

    await waitFor(() => {
      expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.some(([url]) =>
        String(url).includes('/disbursements/receipt-uploads/') && String(url).includes('/complete')
      )).toBe(true);
    });

    // While upload completion is pending, the user changes task selection
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const secondOpt = await screen.findByRole('option', { name: /Second Assigned Task/i });
    fireEvent.click(secondOpt);

    // Now resolve the upload completion for attempt 1
    resolveUploadComplete(
      new Response(
        JSON.stringify({
          data: {
            receiptS3Key: 'entities/ATA/disbursements/receipts/receipt.png',
            receiptFilename: 'receipt.png',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    // Stale upload response should be discarded by isCurrent() check
    // No create disbursement POST dispatched with old target
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toHaveLength(0);
  });
});
