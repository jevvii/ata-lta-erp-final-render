import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
vi.mock('@/components/ui/date-input', () => ({ DateInput: () => null }));
import { InvoiceCreateModal } from '../components/InvoiceCreateModal';
import { InvoiceEditModal } from '../components/InvoiceEditModal';
import { useSessionStore } from '@/lib/session';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import type { Invoice } from '../api/types';

const WR_1 = '22222222-2222-4222-8222-222222222222';
const WR_2 = '22222222-2222-4222-8222-333333333333';
const CLIENT_1 = '11111111-1111-4111-8111-111111111111';
const TASK_ASSIGNED = '33333333-3333-4333-8333-333333333333';
const TASK_UNASSIGNED = '44444444-4444-4444-8444-444444444444';
const TASK_WR2 = '55555555-5555-4555-8555-555555555555';
const CALLER_USER_ID = 'user-accounting-caller';

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

function setupMockFetch(posts: { url: string; body: Record<string, unknown> }[]) {
  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ data }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST' && /\/invoices$/.test(url)) {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        return respond({ id: 'inv-created', status: 'Draft', ...body }, 201);
      }
      if ((init?.method === 'PUT' || init?.method === 'PATCH') && /\/invoices\//.test(url)) {
        const body = JSON.parse(String(init.body));
        posts.push({ url, body });
        return respond({ id: 'inv-updated', status: 'Draft', ...body }, 200);
      }
      if (url.includes(`/operations/work-requests/${WR_1}/tasks`)) {
        return respond([
          {
            id: TASK_ASSIGNED,
            workRequestId: WR_1,
            title: 'Assigned Billing Task',
            assigneeId: CALLER_USER_ID,
            assignees: [CALLER_USER_ID],
          },
          {
            id: 'task-assigned-2',
            workRequestId: WR_1,
            title: 'Second Assigned Task',
            assigneeId: CALLER_USER_ID,
            assignees: [CALLER_USER_ID],
          },
          {
            id: TASK_UNASSIGNED,
            workRequestId: WR_1,
            title: 'Unassigned Other Task',
            assigneeId: 'other-emp',
            assignees: ['other-emp'],
          },
        ]);
      }
      if (url.includes(`/operations/work-requests/${WR_2}/tasks`)) {
        return respond([
          {
            id: TASK_WR2,
            workRequestId: WR_2,
            title: 'WR2 Task',
            assigneeId: CALLER_USER_ID,
            assignees: [CALLER_USER_ID],
          },
        ]);
      }
      if (url.includes('/operations/work-requests')) {
        return respond([
          {
            id: WR_1,
            title: 'Client WR 1',
            client_id: CLIENT_1,
            clientId: CLIENT_1,
            status: 'In Progress',
            entity: 'ATA',
          },
          {
            id: WR_2,
            title: 'Client WR 2',
            client_id: CLIENT_1,
            clientId: CLIENT_1,
            status: 'In Progress',
            entity: 'ATA',
          },
        ]);
      }
      if (url.includes('/clients')) {
        return respond([{ id: CLIENT_1, name: 'Alpha Client', entity: 'ATA' }]);
      }
      if (url.includes('/invoices')) {
        return respond([]);
      }
      throw new Error(`Unhandled mock URL: ${url}`);
    })
  );
}

describe('F04: Invoice Standalone Task Scoping & Validation', () => {
  it('shows only assigned tasks for non-admin Accounting users and excludes unassigned sibling tasks', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }} />
      </QueryClientProvider>
    );

    // Open task dropdown
    const taskSelectTrigger = await screen.findByTestId('select-work-request-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

    // Assigned task MUST be present and enabled
    const assignedOpt = await screen.findByRole('option', { name: /Assigned Billing Task/i });
    expect(assignedOpt).toBeInTheDocument();
    expect(assignedOpt).not.toHaveAttribute('aria-disabled', 'true');

    // Unassigned task MUST be present but disabled with "(Not assigned to you)" for non-admin
    const unassignedOpt = await screen.findByRole('option', { name: /Unassigned Other Task.*Not assigned to you/i });
    expect(unassignedOpt).toBeInTheDocument();
    expect(unassignedOpt).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows all tasks for Admin users', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'admin-user',
        name: 'Admin Worker',
        email: 'admin@ata-lta.ph',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }} />
      </QueryClientProvider>
    );

    const taskSelectTrigger = await screen.findByTestId('select-work-request-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

    // Both tasks are available to Admin without "(Not assigned to you)"
    const assignedOpt = await screen.findByRole('option', { name: /Assigned Billing Task/i });
    const unassignedOpt = await screen.findByRole('option', { name: /Unassigned Other Task/i });
    expect(assignedOpt).toBeInTheDocument();
    expect(unassignedOpt).toBeInTheDocument();
    expect(unassignedOpt).not.toHaveAttribute('aria-disabled', 'true');
    expect(unassignedOpt.textContent).not.toContain('Not assigned to you');
  });

  it('denies admin exemption to lorein@ata-lta.ph when authenticated role is Staff (Correction 4)', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Lorein Wong (Staff Role)',
        email: 'lorein@ata-lta.ph',
        role: 'Staff',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_1, clientId: CLIENT_1 }} />
      </QueryClientProvider>
    );

    const taskSelectTrigger = await screen.findByTestId('select-work-request-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

    // Only assigned task selectable, unassigned task disabled with Not assigned to you despite email
    const assignedOpt = await screen.findByRole('option', { name: /Assigned Billing Task/i });
    expect(assignedOpt).toBeInTheDocument();
    const unassignedOpt = await screen.findByRole('option', { name: /Unassigned Other Task.*Not assigned to you/i });
    expect(unassignedOpt).toBeInTheDocument();
    expect(unassignedOpt).toHaveAttribute('aria-disabled', 'true');
  });

  it('blocks submission and shows visible error for invalid/unassigned prefilled task without converting to WR-only (Correction 5)', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal
          isOpen
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_1, clientId: CLIENT_1, taskId: TASK_UNASSIGNED }}
        />
      </QueryClientProvider>
    );

    // Wait for work request task query to successfully resolve
    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Attempt submit with unassigned prefilled task
    fireEvent.click(screen.getByTestId('btn-submit-invoice'));

    // Must show visible error and block POST
    await waitFor(() => {
      expect(screen.getByTestId('invoice-create-error')).toHaveTextContent(/not assigned/i);
    });
    expect(posts).toHaveLength(0);
  });

  it('enforces mandatory linked task: rejects invoice submission when no task is selected', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal isOpen onClose={vi.fn()} />
      </QueryClientProvider>
    );

    // Attempt submit with no task selected
    fireEvent.click(screen.getByTestId('btn-submit-invoice'));

    await waitFor(() => {
      expect(screen.getByTestId('invoice-create-error')).toHaveTextContent(/linked task is required/i);
    });
    expect(posts).toHaveLength(0);
  });

  it('InvoiceCreateModal: assigned task-linked invoice creation successfully POSTs proper task ID', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal
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

    fireEvent.click(screen.getByTestId('btn-submit-invoice'));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toMatch(/\/invoices$/);
    expect(posts[0]!.body).toMatchObject({
      workRequestId: WR_1,
      linkedTaskId: TASK_ASSIGNED,
    });
  });

  it('InvoiceEditModal: failed/missing origin lookup + unlink => no PUT', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    const mockInvoice: Invoice & { task_id?: string | null } = {
      id: 'inv-missing-origin',
      invoice_number: 'ATA-SI-2026-0002',
      client_id: CLIENT_1,
      work_request_id: WR_1,
      task_id: 'non-existent-task-id',
      linked_task_id: 'non-existent-task-id',
      issue_date: '2026-03-01T00:00:00Z',
      due_date: '2026-04-01T00:00:00Z',
      status: 'Draft',
      subtotal: 15000,
      total: 15000,
      amount_paid: 0,
      balance: 15000,
      version: 1,
      entity_id: 'ATA',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
      line_items: [{ id: 'li-1', description: 'Consulting', amount: 15000, type: 'Professional Fee' }],
    };

    render(
      <QueryClientProvider client={client}>
        <InvoiceEditModal isOpen onClose={vi.fn()} invoice={mockInvoice} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Relink the task
    const taskSelectTrigger = await screen.findByTestId('select-edit-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const otherOption = await screen.findByRole('option', { name: /Second Assigned Task/i });
    fireEvent.click(otherOption);

    // Attempt save
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('invoice-edit-error')).toHaveTextContent(
        /Original linked task could not be verified/i
      );
    });
    const putRequests = posts.filter((p) => p.url.includes('/invoices/'));
    expect(putRequests).toHaveLength(0);
  });

  it('InvoiceEditModal: foreign origin + unlink => no PUT', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    const mockInvoice: Invoice & { task_id?: string | null } = {
      id: 'inv-foreign-origin',
      invoice_number: 'ATA-SI-2026-0003',
      client_id: CLIENT_1,
      work_request_id: WR_1,
      task_id: TASK_UNASSIGNED,
      linked_task_id: TASK_UNASSIGNED,
      issue_date: '2026-03-01T00:00:00Z',
      due_date: '2026-04-01T00:00:00Z',
      status: 'Draft',
      subtotal: 15000,
      total: 15000,
      amount_paid: 0,
      balance: 15000,
      version: 1,
      entity_id: 'ATA',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
      line_items: [{ id: 'li-1', description: 'Consulting', amount: 15000, type: 'Professional Fee' }],
    };

    render(
      <QueryClientProvider client={client}>
        <InvoiceEditModal isOpen onClose={vi.fn()} invoice={mockInvoice} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Relink the task
    const taskSelectTrigger = await screen.findByTestId('select-edit-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const otherOption = await screen.findByRole('option', { name: /Second Assigned Task/i });
    fireEvent.click(otherOption);

    // Attempt save
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('invoice-edit-error')).toHaveTextContent(
        'You are not authorized to unlink or relink the existing task.'
      );
    });
    const putRequests = posts.filter((p) => p.url.includes('/invoices/'));
    expect(putRequests).toHaveLength(0);
  });

  it('InvoiceEditModal: valid origin and destination relink => calls PUT', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    const mockInvoice: Invoice & { task_id?: string | null } = {
      id: 'inv-valid-relink',
      invoice_number: 'ATA-SI-2026-0004',
      client_id: CLIENT_1,
      work_request_id: WR_1,
      task_id: TASK_ASSIGNED,
      linked_task_id: TASK_ASSIGNED,
      issue_date: '2026-03-01T00:00:00Z',
      due_date: '2026-04-01T00:00:00Z',
      status: 'Draft',
      subtotal: 15000,
      total: 15000,
      amount_paid: 0,
      balance: 15000,
      version: 1,
      entity_id: 'ATA',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
      line_items: [{ id: 'li-1', description: 'Consulting', amount: 15000, type: 'Professional Fee' }],
    };

    render(
      <QueryClientProvider client={client}>
        <InvoiceEditModal isOpen onClose={vi.fn()} invoice={mockInvoice} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Relink own task to another assigned task
    const taskSelectTrigger = await screen.findByTestId('select-edit-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const secondOption = await screen.findByRole('option', { name: /Second Assigned Task/i });
    fireEvent.click(secondOption);

    // Save
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => {
      const putRequests = posts.filter((p) => p.url.includes('/invoices/inv-valid-relink'));
      expect(putRequests).toHaveLength(1);
      expect(putRequests[0]!.body).toMatchObject({
        linkedTaskId: 'task-assigned-2',
      });
    });
  });

  it('InvoiceEditModal: unchanged-link ordinary edit preserved without assignment requirement', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    // Stored task is foreign (TASK_UNASSIGNED), but user makes ordinary edit to notes without touching task link
    const mockInvoice: Invoice & { task_id?: string | null } = {
      id: 'inv-ordinary-edit',
      invoice_number: 'ATA-SI-2026-0005',
      client_id: CLIENT_1,
      work_request_id: WR_1,
      task_id: TASK_UNASSIGNED,
      linked_task_id: TASK_UNASSIGNED,
      issue_date: '2026-03-01T00:00:00Z',
      due_date: '2026-04-01T00:00:00Z',
      status: 'Draft',
      subtotal: 15000,
      total: 15000,
      amount_paid: 0,
      balance: 15000,
      version: 1,
      entity_id: 'ATA',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
      line_items: [{ id: 'li-1', description: 'Consulting', amount: 15000, type: 'Professional Fee' }],
      notes: 'Initial note',
    };

    render(
      <QueryClientProvider client={client}>
        <InvoiceEditModal isOpen onClose={vi.fn()} invoice={mockInvoice} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Update notes without touching linkage
    const notesInput = screen.getByDisplayValue('Initial note');
    fireEvent.change(notesInput, { target: { value: 'Updated ordinary notes' } });

    // Save
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => {
      const putRequests = posts.filter((p) => p.url.includes('/invoices/inv-ordinary-edit'));
      expect(putRequests).toHaveLength(1);
      expect(putRequests[0]!.body).toMatchObject({
        notes: 'Updated ordinary notes',
        linkedTaskId: TASK_UNASSIGNED,
      });
    });
  });

  it('InvoiceEditModal: conflicting canonical and legacy stored IDs blocks linkage change with visible error', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    // Conflicting stored task IDs
    const mockInvoice: Invoice & { task_id?: string | null } = {
      id: 'inv-corrupt-linkage',
      invoice_number: 'ATA-SI-2026-0006',
      client_id: CLIENT_1,
      work_request_id: WR_1,
      task_id: TASK_ASSIGNED,
      linked_task_id: TASK_UNASSIGNED,
      issue_date: '2026-03-01T00:00:00Z',
      due_date: '2026-04-01T00:00:00Z',
      status: 'Draft',
      subtotal: 15000,
      total: 15000,
      amount_paid: 0,
      balance: 15000,
      version: 1,
      entity_id: 'ATA',
      created_at: '2026-03-01T00:00:00Z',
      updated_at: '2026-03-01T00:00:00Z',
      line_items: [{ id: 'li-1', description: 'Consulting', amount: 15000, type: 'Professional Fee' }],
    };

    render(
      <QueryClientProvider client={client}>
        <InvoiceEditModal isOpen onClose={vi.fn()} invoice={mockInvoice} />
      </QueryClientProvider>
    );

    // Relink the task
    const taskSelectTrigger = await screen.findByTestId('select-edit-task');
    fireEvent.keyDown(taskSelectTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
    const otherOption = await screen.findByRole('option', { name: /Second Assigned Task/i });
    fireEvent.click(otherOption);

    // Save
    fireEvent.click(screen.getByTestId('btn-save-invoice-edit'));

    await waitFor(() => {
      expect(screen.getByTestId('invoice-edit-error')).toHaveTextContent(
        /Stored task linkage is corrupt/i
      );
    });
    const putRequests = posts.filter((p) => p.url.includes('/invoices/'));
    expect(putRequests).toHaveLength(0);
  });

  it('pre-fills the Linked Task field from attached disbursement for allowed Admin users', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: 'admin-user',
        name: 'Admin Worker',
        email: 'admin@ata-lta.ph',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal
          isOpen
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_1,
            clientId: CLIENT_1,
            taskId: TASK_UNASSIGNED,
            attachedDisbursement: {
              id: '11111111-1111-4111-8111-111111111191',
              disbursement_number: 'DISB-ATA-20261029-001',
              description: 'SEC Certified True Copy',
              amount: 3500,
              category: 'Government Fee',
            },
          }}
        />
      </QueryClientProvider>
    );

    // Wait for tasks query to succeed
    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Submit invoice as Admin
    fireEvent.click(screen.getByTestId('btn-submit-invoice'));

    await waitFor(() => {
      expect(posts.length).toBe(1);
    });
    expect(posts[0].body.linkedTaskId || posts[0].body.taskId).toBe(TASK_UNASSIGNED);
    expect(posts[0].body.linkedDisbursementIds).toEqual(['11111111-1111-4111-8111-111111111191']);
  });

  it('pre-fills the Linked Task field from attached disbursement for assigned task workers', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal
          isOpen
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_1,
            clientId: CLIENT_1,
            taskId: TASK_ASSIGNED,
            attachedDisbursement: {
              id: '11111111-1111-4111-8111-111111111192',
              disbursement_number: 'DISB-ATA-20261029-002',
              description: 'Accounting Document Delivery',
              amount: 500,
              category: 'Other',
            },
          }}
        />
      </QueryClientProvider>
    );

    // Wait for tasks query
    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Submit invoice as assigned worker
    fireEvent.click(screen.getByTestId('btn-submit-invoice'));

    await waitFor(() => {
      expect(posts.length).toBe(1);
    });
    expect(posts[0].body.linkedTaskId || posts[0].body.taskId).toBe(TASK_ASSIGNED);
    expect(posts[0].body.linkedDisbursementIds).toEqual(['11111111-1111-4111-8111-111111111192']);
  });

  it('auto-selects assignable billing task when attached disbursement has a task assigned to someone else', async () => {
    useSessionStore.getState().setSession({
      user: {
        id: CALLER_USER_ID,
        name: 'Accounting Worker',
        email: 'acct@ata-lta.ph',
        role: 'Accounting',
        departments: ['Accounting'],
        entities: ['ATA'],
      },
      permissions: ['billing:view', 'billing:edit', 'billing:create'],
      activeEntity: 'ATA',
    });

    const posts: { url: string; body: Record<string, unknown> }[] = [];
    setupMockFetch(posts);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

    render(
      <QueryClientProvider client={client}>
        <InvoiceCreateModal
          isOpen
          onClose={vi.fn()}
          prefill={{
            workRequestId: WR_1,
            clientId: CLIENT_1,
            taskId: TASK_UNASSIGNED,
            attachedDisbursement: {
              id: '11111111-1111-4111-8111-111111111193',
              disbursement_number: 'DISB-ATA-20261029-003',
              description: 'Ops Filing Fee',
              amount: 1500,
              category: 'Government Fee',
            },
          }}
        />
      </QueryClientProvider>
    );

    // Wait for tasks query and auto-selection of first assignable task
    await waitFor(() => {
      const qState = client.getQueryState(operationsKeys.tasks(WR_1, 'ATA'));
      expect(qState?.status).toBe('success');
    });

    // Submit invoice
    fireEvent.click(screen.getByTestId('btn-submit-invoice'));

    await waitFor(() => {
      expect(posts.length).toBe(1);
    });
    // Auto-selected CALLER_USER_ID's assignable task instead of unassigned task
    expect(posts[0].body.linkedTaskId || posts[0].body.taskId).toBe(TASK_ASSIGNED);
    expect(posts[0].body.linkedDisbursementIds).toEqual(['11111111-1111-4111-8111-111111111193']);
  });
});
