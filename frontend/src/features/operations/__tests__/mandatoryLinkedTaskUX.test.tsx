import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSessionStore } from '@/lib/session';
import { InvoiceCreateModal } from '@/features/billing/components/InvoiceCreateModal';
import { CreateDisbursementModal } from '@/features/disbursements/components/CreateDisbursementModal';
import { DocumentUploadModal } from '@/features/documents/components/DocumentUploadModal';
import { TransmittalFormModal } from '@/features/transmittals/components/TransmittalFormModal';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WR_EMPTY = '22222222-2222-4222-8222-000000000000';
const WR_SINGLE = '22222222-2222-4222-8222-111111111111';
const WR_MULTI = '22222222-2222-4222-8222-222222222222';
const WR_UNASSIGNED = '22222222-2222-4222-8222-333333333333';

const USER_STAFF_ID = 'user-staff-id';
const USER_OTHER_ID = 'user-other-id';
const USER_ADMIN_ID = 'user-admin-id';

const TASK_SINGLE = '44444444-4444-4444-8444-111111111111';
const TASK_MULTI_1 = '44444444-4444-4444-8444-222222222221';
const TASK_MULTI_2 = '44444444-4444-4444-8444-222222222222';
const TASK_FOREIGN = '44444444-4444-4444-8444-333333333333';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

const mockTeam = [
  { id: USER_STAFF_ID, name: 'Juan Dela Cruz', email: 'juan@ata-lta.ph', role: 'Staff' },
  { id: USER_OTHER_ID, name: 'Maria Santos', email: 'maria@ata-lta.ph', role: 'Staff' },
  { id: USER_ADMIN_ID, name: 'Admin Boss', email: 'admin@ata-lta.ph', role: 'Admin' },
];

vi.mock('@/features/operations/api/useTeam', () => ({
  useTeam: () => ({ data: mockTeam, isLoading: false }),
}));

let postCalls: Array<{ url: string; body: Record<string, unknown> }> = [];

function setupMocks() {
  postCalls = [];

  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify({ data }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';

      if (method === 'POST') {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        postCalls.push({ url, body });
        return respond({ id: 'created-id', status: 'Draft', ...body }, 201);
      }

      if (url.includes('/clients')) {
        return respond([{ id: CLIENT_ID, name: 'Test Client Corp.', entity: 'ATA' }]);
      }

      if (url.includes('/operations/work-requests') || url.includes('/work-requests')) {
        if (url.includes(`/tasks`)) {
          if (url.includes(WR_EMPTY)) {
            return respond([]);
          }
          if (url.includes(WR_SINGLE)) {
            return respond([
              {
                id: TASK_SINGLE,
                workRequestId: WR_SINGLE,
                title: 'Only Single Task',
                status: 'In Progress',
                assigneeId: USER_STAFF_ID,
                assigneeName: 'Juan Dela Cruz',
                assignees: [USER_STAFF_ID],
              },
            ]);
          }
          if (url.includes(WR_MULTI)) {
            return respond([
              {
                id: TASK_MULTI_1,
                workRequestId: WR_MULTI,
                title: 'Multi Task One',
                status: 'In Progress',
                assigneeId: USER_STAFF_ID,
                assigneeName: 'Juan Dela Cruz',
                assignees: [USER_STAFF_ID],
              },
              {
                id: TASK_MULTI_2,
                workRequestId: WR_MULTI,
                title: 'Multi Task Two',
                status: 'In Progress',
                assigneeId: USER_OTHER_ID,
                assigneeName: 'Maria Santos',
                assignees: [USER_OTHER_ID],
              },
            ]);
          }
          if (url.includes(WR_UNASSIGNED)) {
            return respond([
              {
                id: TASK_FOREIGN,
                workRequestId: WR_UNASSIGNED,
                title: 'Foreign Task Only',
                status: 'In Progress',
                assigneeId: USER_OTHER_ID,
                assigneeName: 'Maria Santos',
                assignees: [USER_OTHER_ID],
              },
            ]);
          }
        }

        return respond([
          { id: WR_EMPTY, title: 'WR Empty Tasks', client_id: CLIENT_ID, clientId: CLIENT_ID, entity: 'ATA', status: 'In Progress' },
          { id: WR_SINGLE, title: 'WR Single Task', client_id: CLIENT_ID, clientId: CLIENT_ID, entity: 'ATA', status: 'In Progress' },
          { id: WR_MULTI, title: 'WR Multi Tasks', client_id: CLIENT_ID, clientId: CLIENT_ID, entity: 'ATA', status: 'In Progress' },
          { id: WR_UNASSIGNED, title: 'WR Unassigned', client_id: CLIENT_ID, clientId: CLIENT_ID, entity: 'ATA', status: 'In Progress' },
        ]);
      }

      if (url.includes('/invoices')) {
        return respond([]);
      }

      return respond({});
    })
  );
}

describe('Mandatory Linked Task UX Contract Verification Suite', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    setupMocks();
    useSessionStore.getState().setSession({
      user: {
        id: USER_STAFF_ID,
        email: 'juan@ata-lta.ph',
        name: 'Juan Dela Cruz',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'billing:create', 'disbursement:create', 'transmittal:create', 'dms:edit'],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  describe('1. InvoiceCreateModal UX', () => {
    it('renders required label "Linked Task*" and excludes "None (No linked task)" option', async () => {
      render(
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_MULTI, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      expect(screen.getByText(/Linked Task\*/i)).toBeInTheDocument();

      const taskTrigger = await screen.findByTestId('select-work-request-task');
      fireEvent.keyDown(taskTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      expect(screen.queryByRole('option', { name: /None \(No linked task\)/i })).not.toBeInTheDocument();
    });

    it('greys out unassigned tasks with "(Not assigned to you)" for non-Admin', async () => {
      render(
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_MULTI, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      const taskTrigger = await screen.findByTestId('select-work-request-task');
      fireEvent.keyDown(taskTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      const assignedOpt = await screen.findByRole('option', { name: /Multi Task One — Juan Dela Cruz/i });
      expect(assignedOpt).toBeInTheDocument();
      expect(assignedOpt).not.toHaveAttribute('aria-disabled', 'true');

      const unassignedOpt = await screen.findByRole('option', { name: /Multi Task Two — Maria Santos \(Not assigned to you\)/i });
      expect(unassignedOpt).toBeInTheDocument();
      expect(unassignedOpt).toHaveAttribute('aria-disabled', 'true');
    });

    it('auto-selects when exactly one selectable task is available', async () => {
      render(
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_SINGLE, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      await waitFor(() => {
        const taskTrigger = screen.getByTestId('select-work-request-task');
        expect(taskTrigger.textContent).toContain('Only Single Task');
      });
    });

    it('locks task field when prefilled from TaskDetailModal (prefill.taskId)', async () => {
      render(
        <InvoiceCreateModal
          isOpen
          onClose={vi.fn()}
          prefill={{ workRequestId: WR_MULTI, clientId: CLIENT_ID, taskId: TASK_MULTI_1 }}
        />,
        { wrapper }
      );

      const taskTrigger = await screen.findByTestId('select-work-request-task');
      expect(taskTrigger).toBeDisabled();
    });

    it('shows blocking state 1 and disables submit when WR has no tasks', async () => {
      render(
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_EMPTY, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      const alert = await screen.findByTestId('task-blocking-alert');
      expect(alert).toHaveTextContent(/This work request has no tasks — create one first/i);
      expect(screen.getByTestId('task-blocking-wr-link')).toHaveAttribute(
        'href',
        expect.stringContaining(WR_EMPTY)
      );

      const submitBtn = screen.getByTestId('btn-submit-invoice');
      expect(submitBtn).toBeDisabled();
    });

    it('shows blocking state 2 and disables submit when user is not assigned to any task', async () => {
      render(
        <InvoiceCreateModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_UNASSIGNED, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      const alert = await screen.findByTestId('task-blocking-alert');
      expect(alert).toHaveTextContent(
        /You're not assigned to any task on this work request\. Ask the task owner or an Admin to add you\./i
      );

      const submitBtn = screen.getByTestId('btn-submit-invoice');
      expect(submitBtn).toBeDisabled();
    });
  });

  describe('2. CreateDisbursementModal UX', () => {
    it('renders required label "Linked Task *" and displays assignees', async () => {
      render(
        <CreateDisbursementModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_MULTI, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      expect(screen.getByText(/Linked Task/i)).toBeInTheDocument();

      const taskSelect = await screen.findByTestId('select-work-request-task');
      await waitFor(() => {
        expect(taskSelect.textContent).toContain('Multi Task One');
      });

      expect(taskSelect.textContent).toContain('Multi Task One — Juan Dela Cruz');
      expect(taskSelect.textContent).toContain('Multi Task Two — Maria Santos (Not assigned to you)');
    });

    it('disables submit and renders blocking state 1 when WR has no tasks', async () => {
      render(
        <CreateDisbursementModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_EMPTY, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      const alert = await screen.findByTestId('task-blocking-alert');
      expect(alert).toHaveTextContent(/This work request has no tasks — create one first/i);

      const submitBtn = screen.getByTestId('submit-create-disbursement-btn');
      expect(submitBtn).toBeDisabled();
    });

    it('disables submit and renders blocking state 2 when non-Admin is not assigned to any task', async () => {
      render(
        <CreateDisbursementModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_UNASSIGNED, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      const alert = await screen.findByTestId('task-blocking-alert');
      expect(alert).toHaveTextContent(/You're not assigned to any task on this work request/i);

      const submitBtn = screen.getByTestId('submit-create-disbursement-btn');
      expect(submitBtn).toBeDisabled();
    });
  });

  describe('3. DocumentUploadModal UX', () => {
    it('disables task select when no WR is selected, keeping None option', () => {
      render(<DocumentUploadModal isOpen onClose={vi.fn()} />, { wrapper });

      const taskTrigger = screen.getByTestId('work-request-task-select');
      expect(taskTrigger).toBeDisabled();
    });

    it('enables and requires task select once a WR is selected', async () => {
      render(<DocumentUploadModal isOpen onClose={vi.fn()} />, { wrapper });

      const wrTrigger = screen.getByTestId('work-request-select');
      fireEvent.keyDown(wrTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
      const wrOpt = await screen.findByRole('option', { name: /WR Multi Tasks/i });
      fireEvent.click(wrOpt);

      const taskTrigger = screen.getByTestId('work-request-task-select');
      await waitFor(() => {
        expect(taskTrigger).not.toBeDisabled();
      });

      // Once WR is picked, label shows required indicator
      expect(screen.getByText(/Linked Task/i)).toBeInTheDocument();

      fireEvent.keyDown(taskTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
      expect(screen.queryByRole('option', { name: /None \(No linked task\)/i })).not.toBeInTheDocument();
    });

    it('allows submission without WR and without task (documents no-WR path still submits)', async () => {
      render(<DocumentUploadModal isOpen onClose={vi.fn()} />, { wrapper });

      // External mode without WR
      fireEvent.click(screen.getByTestId('mode-tab-external'));
      fireEvent.change(screen.getByTestId('external-url-input'), {
        target: { value: 'https://sec.gov.ph/document/doc-general.pdf' },
      });
      fireEvent.change(screen.getByTestId('document-name-input'), {
        target: { value: 'General Standalone Document.pdf' },
      });

      const submitBtn = screen.getByTestId('upload-submit-button');
      expect(submitBtn).not.toBeDisabled();

      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(postCalls.some((p) => p.url.includes('/documents'))).toBe(true);
      });
    });

    it('maps backend FORBIDDEN_TASK_ATTACHMENT error code to task error message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          const method = init?.method || 'GET';
          if (method === 'POST' && url.includes('/documents')) {
            return new Response(
              JSON.stringify({
                status: 403,
                code: 'FORBIDDEN_TASK_ATTACHMENT',
                detail: 'Forbidden task attachment',
              }),
              { status: 403, headers: { 'content-type': 'application/json' } }
            );
          }
          if (url.includes('/tasks')) {
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: TASK_SINGLE,
                    workRequestId: WR_SINGLE,
                    title: 'Only Single Task',
                    status: 'In Progress',
                    assigneeId: USER_STAFF_ID,
                    assigneeName: 'Juan Dela Cruz',
                    assignees: [USER_STAFF_ID],
                  },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          if (url.includes('/work-requests')) {
            return new Response(
              JSON.stringify({
                data: [
                  { id: WR_SINGLE, title: 'WR Single Task', client_id: CLIENT_ID, clientId: CLIENT_ID, entity: 'ATA', status: 'In Progress' },
                ],
              }),
              { status: 200, headers: { 'content-type': 'application/json' } }
            );
          }
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        })
      );

      render(
        <DocumentUploadModal
          isOpen
          onClose={vi.fn()}
          defaultWorkRequestId={WR_SINGLE}
          defaultTaskId={TASK_SINGLE}
        />,
        { wrapper }
      );

      fireEvent.click(screen.getByTestId('mode-tab-external'));
      fireEvent.change(screen.getByTestId('external-url-input'), {
        target: { value: 'https://sec.gov.ph/document/doc-1.pdf' },
      });
      fireEvent.change(screen.getByTestId('document-name-input'), {
        target: { value: 'Doc 1.pdf' },
      });

      const submitBtn = screen.getByTestId('upload-submit-button');
      await waitFor(() => expect(submitBtn).not.toBeDisabled());
      fireEvent.click(submitBtn);

      const errEl = await screen.findByTestId('error-document-task');
      expect(errEl).toHaveTextContent(/You must be assigned to this task/i);
    });
  });

  describe('4. TransmittalFormModal UX', () => {
    it('requires task whenever WR is set and blocks submit without a task', async () => {
      render(
        <TransmittalFormModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_MULTI, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      expect(screen.getByText(/Linked Task \*/i)).toBeInTheDocument();

      fireEvent.change(screen.getByTestId('item-description-input-0'), {
        target: { value: 'Legal Brief Transmittal' },
      });

      fireEvent.click(screen.getByTestId('submit-transmittal-btn'));

      await waitFor(() => {
        expect(screen.getByTestId('task-error-message')).toHaveTextContent(/A valid linked task is required/i);
      });
    });

    it('auto-selects when exactly one selectable task is available', async () => {
      render(
        <TransmittalFormModal isOpen onClose={vi.fn()} prefill={{ workRequestId: WR_SINGLE, clientId: CLIENT_ID }} />,
        { wrapper }
      );

      await waitFor(() => {
        const taskTrigger = screen.getByTestId('task-select');
        expect(taskTrigger.textContent).toContain('Only Single Task');
      });
    });
  });
});
