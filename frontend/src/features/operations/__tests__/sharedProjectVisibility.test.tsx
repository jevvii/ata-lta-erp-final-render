import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { apiRequest, ApiError, getScopeGeneration } from '@/lib/api';
import { handleRealtimePayload } from '@/lib/realtime/useEntityRealtimeSync';
import { WorkRequestSidePeek } from '../components/WorkRequestSidePeek';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { filterTaskRelatedRecords, isWrTeamMember } from '../lib/taskScope';
import { operationsKeys } from '../api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';
import { transmittalKeys } from '@/features/transmittals/api/queryKeys';
import { documentKeys } from '@/features/documents/api/queryKeys';
import { dashboardKeys } from '@/features/dashboard/api/queryKeys';
import type { Task, WorkRequest, DmsDocument } from '../api/types';

describe('360° Shared Project Team Visibility (SHARED-PROJECT-VISIBILITY-20261024)', () => {
  const originalFetch = window.fetch;
  let testQueryClient: QueryClient;

  const mockUserStaff: UserProfile = {
    id: '00000000-0000-4000-a000-000000000001',
    name: 'Mara Santos',
    email: 'mara@ata-lta.ph',
    role: 'Staff',
    departments: ['Operations'],
    entities: ['ATA'],
  };

  const mockUserAdmin: UserProfile = {
    id: '00000000-0000-4000-a000-000000000099',
    name: 'Admin User',
    email: 'admin@ata-lta.ph',
    role: 'Admin',
    departments: ['Management'],
    entities: ['ATA', 'LTA'],
  };

  const mockWr: WorkRequest = {
    id: 'qa-wr',
    title: 'Business permit renewal',
    description: 'Renew the client business permit and assemble final delivery.',
    entity: 'ATA',
    clientId: 'qa-client',
    clientName: 'Harbor Trading Philippines',
    status: 'In Progress',
    phase: 'processing',
    phaseEnteredAt: '2026-10-20T00:00:00Z',
    priority: 'High',
    archived: false,
    onHold: false,
    requestedBy: 'qa-requester',
    dueDate: '2026-10-28',
    assignedTo: 'qa-lead',
    assignedToName: 'Elena Cruz',
    coAssignees: [mockUserStaff.id],
    version: 1,
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-24T00:00:00Z',
  };

  const mockTask: Task = {
    id: 'qa-task-2',
    workRequestId: 'qa-wr',
    title: 'Agency filing and permit release',
    description: 'Obtain the city business permit and upload receipt.',
    status: 'In Progress',
    phase: 'processing',
    phaseEnteredAt: '2026-10-20T00:00:00Z',
    qaStatus: 'none',
    assigneeId: 'qa-liaison-2',
    assigneeName: 'Nico Reyes',
    assignees: ['qa-liaison-2'],
    predecessors: [],
    dueDate: '2026-10-28',
    requiredLinkType: 'disbursement',
    displayOrder: 1,
    version: 1,
    checklist: [{ id: 'chk-1', text: 'Collect agency approval', completed: true }],
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-24T00:00:00Z',
  };

  const mockDoc: DmsDocument = {
    id: 'qa-doc',
    file_name: 'City-business-permit.pdf',
    fileName: 'City-business-permit.pdf',
    original_name: 'City-business-permit.pdf',
    originalName: 'City-business-permit.pdf',
    work_request_id: 'qa-wr',
    workRequestId: 'qa-wr',
    linked_task_id: mockTask.id,
    linkedTaskId: mockTask.id,
    client_id: 'qa-client',
    category: 'PERMIT',
    uploader_id: 'qa-liaison-2',
    description: null,
    document_lifecycle: 'collected',
    storage_path: '/files/permit.pdf',
    external_url: null,
    created_at: '2026-10-20T00:00:00Z',
    updated_at: '2026-10-24T00:00:00Z',
    document_type: 'Government approval',
    documentType: 'Government approval',
    entity_id: 'ATA',
    status: 'active',
    archived: false,
    file_size: 46080,
    fileSize: 46080,
    content_type: 'application/pdf',
    comments: [],
    versions: [],
  };

  const mockRelated = {
    invoices: [
      {
        id: 'qa-invoice',
        invoice_number: 'ATA-2026-0142',
        status: 'Paid',
        total: 12500,
        balance: 0,
        work_request_id: 'qa-wr',
        task_id: mockTask.id,
        client_name: mockWr.clientName,
      },
    ],
    disbursements: [
      {
        id: 'qa-voucher',
        disbursement_number: 'DV-2026-0086',
        status: 'Released',
        category: 'Filing fees',
        description: 'City permit filing and transportation',
        amount: 2350,
        linked_work_request_id: 'qa-wr',
        task_id: mockTask.id,
      },
    ],
    transmittals: [
      {
        id: 'qa-transmittal',
        tracking_number: 'TR-2026-0041',
        status: 'Sent',
        recipient_name: mockWr.clientName,
        work_request_id: 'qa-wr',
        linked_task_id: mockTask.id,
      },
    ],
    documents: [mockDoc],
  };

  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false },
      },
    });

    useSessionStore.getState().setSession({
      user: mockUserStaff,
      permissions: [
        'workflow:view',
        'billing:view',
        'disbursement:view',
        'transmittal:view',
        'dms:view',
        'timelog:view',
      ],
      activeEntity: 'ATA',
    });
  });

  afterEach(() => {
    cleanup();
    window.fetch = originalFetch;
    testQueryClient.clear();
  });

  // =========================================================================
  // 1. WorkRequestSidePeek Rendered Integration: Successful Read -> 403 Invalidation -> Stable Denied UI
  // =========================================================================
  describe('WorkRequestSidePeek Access Revocation & UI Stability', () => {
    it('renders project financials, handles 403 on invalidation, and maintains stable wr-access-lost UI', async () => {
      let isRevoked = false;

      window.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(urlStr, 'http://localhost');
        const p = url.pathname;

        if (isRevoked && !p.includes('/me/team')) {
          return new Response(
            JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Project access is unavailable' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        let data: unknown = [];
        if (p.endsWith('/me/team')) {
          data = [mockUserStaff, { id: 'qa-lead', name: 'Elena Cruz', role: 'Manager' }];
        } else if (p.endsWith('/related')) {
          data = mockRelated;
        } else if (p.endsWith('/tasks')) {
          data = [mockTask];
        } else if (p.includes('/tasks/')) {
          data = mockTask;
        } else if (p.endsWith('/work-requests/qa-wr')) {
          data = mockWr;
        } else if (p.endsWith('/documents')) {
          data = [mockDoc];
        } else if (p.endsWith('/time-entries')) {
          data = [];
        }

        return new Response(
          JSON.stringify({ data, meta: { total: Array.isArray(data) ? data.length : 1 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <WorkRequestSidePeek isOpen onClose={() => {}} workRequestId="qa-wr" />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // Verify successful initial read: Title, client, and project records
      await waitFor(() => {
        expect(screen.getByText('Business permit renewal')).toBeInTheDocument();
      });

      // Verify invoice row renders total, balance and status
      expect(screen.getByText('ATA-2026-0142')).toBeInTheDocument();
      expect(screen.getByText('₱12,500.00')).toBeInTheDocument();
      expect(screen.getByText('Paid in full')).toBeInTheDocument();
      expect(screen.getByText('Paid')).toBeInTheDocument();

      // Verify disbursement row renders category and amount
      expect(screen.getByText('Filing fees')).toBeInTheDocument();
      expect(screen.getByText('₱2,350.00')).toBeInTheDocument();

      // Verify transmittal row renders
      expect(screen.getByText('TR-2026-0041')).toBeInTheDocument();

      // Now simulate relational assignment revocation:
      // The backend will now return 403 on refetch.
      isRevoked = true;

      await act(async () => {
        await testQueryClient.invalidateQueries();
      });

      // The UI must display the wr-access-lost container
      await waitFor(() => {
        expect(screen.getByTestId('wr-access-lost')).toBeInTheDocument();
      });

      // Confidential information must be absent
      expect(screen.queryByText('Harbor Trading Philippines')).not.toBeInTheDocument();
      expect(screen.queryByText('ATA-2026-0142')).not.toBeInTheDocument();
      expect(screen.queryByText('Agency filing and permit release')).not.toBeInTheDocument();

      // The UI must STABLY stay on Access Not Available and NOT revert to perpetual loading
      expect(screen.getByText('Access Not Available')).toBeInTheDocument();
      expect(screen.queryByText('Loading Work Request...')).not.toBeInTheDocument();
      expect(screen.queryByText('Loading work request details...')).not.toBeInTheDocument();
    });

    it('supports restored team membership: 200 -> 403 -> fresh 200 re-enables record visibility', async () => {
      let mode: 'granted' | 'revoked' | 'restored' = 'granted';

      window.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(urlStr, 'http://localhost');
        const p = url.pathname;

        if (mode === 'revoked' && !p.includes('/me/team')) {
          return new Response(
            JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Revoked' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        let data: unknown = [];
        if (p.endsWith('/me/team')) data = [mockUserStaff];
        else if (p.includes('/related')) data = mockRelated;
        else if (p.endsWith('/tasks')) data = [mockTask];
        else if (p.includes('/work-requests/qa-wr')) data = mockWr;
        else if (p.endsWith('/documents')) data = [mockDoc];

        return new Response(
          JSON.stringify({ data, meta: { total: Array.isArray(data) ? data.length : 1 } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <WorkRequestSidePeek isOpen onClose={() => {}} workRequestId="qa-wr" />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // 1. Initial 200 success
      await waitFor(() => {
        expect(screen.getByText('Business permit renewal')).toBeInTheDocument();
      });

      // 2. Revocation 403
      mode = 'revoked';
      await act(async () => {
        await testQueryClient.invalidateQueries();
      });

      await waitFor(() => {
        expect(screen.getByTestId('wr-access-lost')).toBeInTheDocument();
      });
      expect(screen.queryByText('Business permit renewal')).not.toBeInTheDocument();

      // 3. Fresh 200 restoration: former member re-added
      mode = 'restored';
      await act(async () => {
        await testQueryClient.invalidateQueries();
      });

      await waitFor(() => {
        expect(screen.getByText('Business permit renewal')).toBeInTheDocument();
        expect(screen.getByText('ATA-2026-0142')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('wr-access-lost')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. TaskDetailModal Related Denial & Isolation Tests
  // =========================================================================
  describe('TaskDetailModal Linked Records Denial Handling', () => {
    it('shows non-jargon access denied dialog when useTaskRelated encounters 403', async () => {
      window.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(urlStr, 'http://localhost');
        const p = url.pathname;

        if (p.includes('/related')) {
          return new Response(
            JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Task related records access denied' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (p.endsWith('/me/team')) {
          return new Response(JSON.stringify({ data: [mockUserStaff] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(
          JSON.stringify({ data: mockTask }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={() => {}}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('task-access-denied-dialog')).toBeInTheDocument();
      });

      expect(screen.getByText('Access Not Available')).toBeInTheDocument();
      expect(
        screen.getByText('You do not have access to this task or its parent work request.')
      ).toBeInTheDocument();
    });

    it('renders task-access-denied-dialog when task detail query returns 403', async () => {
      window.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Task access denied' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={() => {}}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('task-access-denied-dialog')).toBeInTheDocument();
      });

      expect(screen.getByText('Access Not Available')).toBeInTheDocument();
      expect(
        screen.getByText('You do not have access to this task or its parent work request.')
      ).toBeInTheDocument();
    });

    it('retains initialTask prop initially, but completely suppresses initialTask data upon 403 revocation', async () => {
      let isRevoked = false;

      window.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(urlStr, 'http://localhost');
        const p = url.pathname;

        if (isRevoked && !p.includes('/me/team')) {
          return new Response(
            JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Access revoked' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (p.endsWith('/me/team')) {
          return new Response(JSON.stringify({ data: [mockUserStaff] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (p.includes('/related')) {
          return new Response(JSON.stringify({ data: mockRelated }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(
          JSON.stringify({ data: mockTask }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={() => {}}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // Initially, task details are rendered
      await waitFor(() => {
        expect(screen.getByText('Agency filing and permit release')).toBeInTheDocument();
      });

      // Trigger revocation refetch
      isRevoked = true;
      await act(async () => {
        await testQueryClient.invalidateQueries();
      });

      // After revocation, task-access-denied-dialog must be rendered
      await waitFor(() => {
        expect(screen.getByTestId('task-access-denied-dialog')).toBeInTheDocument();
      });

      // Confidential text from initialTask prop must be completely absent from the DOM
      expect(screen.queryByText('Agency filing and permit release')).not.toBeInTheDocument();
      expect(screen.queryByText('Obtain the city business permit and upload receipt.')).not.toBeInTheDocument();
      expect(screen.queryByText('ATA-2026-0142')).not.toBeInTheDocument();
      expect(screen.queryByText('Harbor Trading Philippines')).not.toBeInTheDocument();

      // Denied state must be stable
      expect(screen.getByText('Access Not Available')).toBeInTheDocument();
    });

    it('supports restored task membership: 200 -> 403 -> fresh 200 re-enables task view', async () => {
      let mode: 'granted' | 'revoked' | 'restored' = 'granted';

      window.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(urlStr, 'http://localhost');
        const p = url.pathname;

        if (mode === 'revoked' && !p.includes('/me/team')) {
          return new Response(
            JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Revoked' }),
            { status: 403, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (p.endsWith('/me/team')) {
          return new Response(JSON.stringify({ data: [mockUserStaff] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (p.includes('/related')) {
          return new Response(JSON.stringify({ data: mockRelated }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (p.includes('/documents')) {
          return new Response(JSON.stringify({ data: [mockDoc] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (p.includes('/operations/requests') || p.includes('/time-entries')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(
          JSON.stringify({ data: mockTask }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={() => {}}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // 1. Initial 200 view
      await waitFor(() => {
        expect(screen.getByText('Agency filing and permit release')).toBeInTheDocument();
      });

      // 2. Revocation 403
      mode = 'revoked';
      await act(async () => {
        await testQueryClient.invalidateQueries();
      });

      await waitFor(() => {
        expect(screen.getByTestId('task-access-denied-dialog')).toBeInTheDocument();
      });
      expect(screen.queryByText('Agency filing and permit release')).not.toBeInTheDocument();

      // 3. Restored fresh 200
      mode = 'restored';
      await act(async () => {
        await testQueryClient.invalidateQueries();
      });

      await waitFor(() => {
        expect(screen.getByText('Agency filing and permit release')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('task-access-denied-dialog')).not.toBeInTheDocument();
    });

    it('proves placeholder response from list query cannot prematurely clear the denied latch', async () => {
      let resolveTaskFetch: ((res: Response) => void) | null = null;
      let isDelayed = false;

      window.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const p = new URL(urlStr, 'http://localhost').pathname;

        if (p.includes('/related')) {
          return new Response(
            JSON.stringify({ invoices: [], disbursements: [], transmittals: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (p.includes('/documents') || p.includes('/operations/requests') || p.includes('/time-entries')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }

        if (isDelayed) {
          return new Promise<Response>((resolve) => {
            resolveTaskFetch = resolve;
          });
        }

        return new Response(
          JSON.stringify({ data: mockTask }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={() => {}}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // 1. Initial authorized 200 view
      await waitFor(() => {
        expect(screen.getByText('Agency filing and permit release')).toBeInTheDocument();
      });

      // 2. Simulate 403 access denial
      window.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Revoked access' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      });

      await act(async () => {
        await testQueryClient.invalidateQueries();
      });

      // Assert access denied dialog is visible
      await waitFor(() => {
        expect(screen.getByTestId('task-access-denied-dialog')).toBeInTheDocument();
      });

      // 3. Now seed the task list query with placeholder data
      testQueryClient.setQueryData(operationsKeys.tasks(mockWr.id, 'ATA'), [mockTask]);

      // Make the task detail fetch delayed so it stays in placeholder state
      isDelayed = true;
      window.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
        const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const p = new URL(urlStr, 'http://localhost').pathname;
        if (p.includes('/work-requests/') && p.includes('/tasks/')) {
          return new Promise<Response>((resolve) => {
            resolveTaskFetch = resolve;
          });
        }
        if (p.includes('/related')) {
          return new Response(
            JSON.stringify({ invoices: [], disbursements: [], transmittals: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      });

      // Reset the detail query so it falls back to placeholderData while fetch is in-flight
      await act(async () => {
        testQueryClient.resetQueries({
          queryKey: operationsKeys.taskDetail(mockWr.id, mockTask.id),
        });
      });

      // 4. Assert that placeholderData does NOT clear the denied latch
      // The access denied dialog must remain visible, and confidential details hidden
      expect(screen.getByTestId('task-access-denied-dialog')).toBeInTheDocument();
      expect(screen.queryByText('Agency filing and permit release')).not.toBeInTheDocument();

      // 5. Fresh server 200 completes
      await act(async () => {
        if (resolveTaskFetch) {
          resolveTaskFetch(
            new Response(
              JSON.stringify({ data: mockTask }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
        await testQueryClient.invalidateQueries({
          queryKey: operationsKeys.taskRelated(mockTask.id),
        });
      });

      // 6. Denied latch is now legitimately cleared by real server 200 (!isTaskPlaceholder)
      await waitFor(() => {
        expect(screen.getByText('Agency filing and permit release')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('task-access-denied-dialog')).not.toBeInTheDocument();
    });

    it('immediately suppresses retained initialTask and child views when active entity changes during delayed read', async () => {
      // Slow network: new read takes a while to complete
      window.fetch = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return new Response(
          JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Entity access denied' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const handleClose = vi.fn();

      const { rerender } = render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={handleClose}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // Initially authorized under ATA
      expect(screen.getByText('Agency filing and permit release')).toBeInTheDocument();

      // User switches active entity to LTA while new server read is delayed
      act(() => {
        useSessionStore.getState().setActiveEntity('LTA');
      });

      rerender(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={handleClose}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // Old initialTask must be IMMEDIATELY hidden from view; no secret leakage during delayed read
      expect(screen.queryByText('Agency filing and permit release')).not.toBeInTheDocument();
      expect(screen.queryByText('Nico Reyes')).not.toBeInTheDocument();
      expect(handleClose).toHaveBeenCalled();
    });

    it('immediately suppresses retained initialTask and child views when active account changes during delayed read', async () => {
      window.fetch = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 1000));
        return new Response(
          JSON.stringify({ status: 403, title: 'Forbidden', detail: 'Account access denied' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const handleClose = vi.fn();

      const { rerender } = render(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={handleClose}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // Initially authorized under Mara Santos
      expect(screen.getByText('Agency filing and permit release')).toBeInTheDocument();

      // Account changes to another user while server read is delayed
      act(() => {
        useSessionStore.getState().setSession({
          user: {
            ...mockUserStaff,
            id: '00000000-0000-4000-a000-000000000888',
            email: 'other@ata-lta.ph',
          },
          permissions: ['workflow:view'],
          activeEntity: 'ATA',
        });
      });

      rerender(
        <QueryClientProvider client={testQueryClient}>
          <BrowserRouter>
            <TaskDetailModal
              isOpen
              onClose={handleClose}
              task={mockTask}
              workRequest={mockWr}
            />
          </BrowserRouter>
        </QueryClientProvider>
      );

      // Stale initialTask must be IMMEDIATELY hidden
      expect(screen.queryByText('Agency filing and permit release')).not.toBeInTheDocument();
      expect(screen.queryByText('Nico Reyes')).not.toBeInTheDocument();
      expect(handleClose).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. apiRequest Async Scope Safety (Transitions, Logout, Signal Abort)
  // =========================================================================
  describe('apiRequest Stale-Scope Protection', () => {
    it('aborts with ApiError(499) when user logs out during in-flight request', async () => {
      let resolveFetch!: (res: Response) => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      window.fetch = vi.fn().mockReturnValue(fetchPromise);

      const requestPromise = apiRequest('/operations/work-requests/qa-wr');

      // User logs out while request is in flight
      useSessionStore.getState().clearSession();

      // Response finally arrives
      resolveFetch(
        new Response(JSON.stringify({ data: mockWr }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(requestPromise).rejects.toThrow(ApiError);
      await expect(requestPromise).rejects.toMatchObject({ status: 499 });
    });

    it('aborts with ApiError(499) on A->B->A session switch via scope generation', async () => {
      const initialGen = getScopeGeneration();
      let resolveFetch!: (res: Response) => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      window.fetch = vi.fn().mockReturnValue(fetchPromise);

      const requestPromise = apiRequest('/operations/work-requests/qa-wr');

      // Switch to User B, then switch back to User A (same user ID, but different generation)
      useSessionStore.getState().setSession({
        user: mockUserAdmin,
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });
      useSessionStore.getState().setSession({
        user: mockUserStaff,
        permissions: ['workflow:view'],
        activeEntity: 'ATA',
      });

      expect(getScopeGeneration()).toBeGreaterThan(initialGen);

      resolveFetch(
        new Response(JSON.stringify({ data: mockWr }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(requestPromise).rejects.toThrow(ApiError);
      await expect(requestPromise).rejects.toMatchObject({ status: 499 });
    });

    it('aborts with ApiError(499) when activeEntity switches during in-flight request', async () => {
      let resolveFetch!: (res: Response) => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      window.fetch = vi.fn().mockReturnValue(fetchPromise);

      const requestPromise = apiRequest('/operations/work-requests/qa-wr');

      // Entity switches from ATA to LTA while in flight
      useSessionStore.getState().setActiveEntity('LTA');

      resolveFetch(
        new Response(JSON.stringify({ data: mockWr }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      await expect(requestPromise).rejects.toThrow(ApiError);
      await expect(requestPromise).rejects.toMatchObject({ status: 499 });
    });

    it('allows skipAuth requests to complete even across session state transitions', async () => {
      let resolveFetch!: (res: Response) => void;
      const fetchPromise = new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

      window.fetch = vi.fn().mockReturnValue(fetchPromise);

      const requestPromise = apiRequest('/auth/login', {
        method: 'POST',
        skipAuth: true,
      });

      // Clear session during in-flight call
      useSessionStore.getState().clearSession();

      resolveFetch(
        new Response(JSON.stringify({ data: { token: 'new-token' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const res = await requestPromise;
      expect(res).toEqual({ data: { token: 'new-token' } });
    });
  });

  // =========================================================================
  // 4. Realtime CDC Invalidation for Non-Admin & task_assignees
  // =========================================================================
  describe('Realtime CDC Invalidation for task_assignees & Non-Admins', () => {
    it('does not discard task_assignees events that lack entity_id, and invalidates protected caches', () => {
      const cancelSpy = vi.spyOn(testQueryClient, 'cancelQueries');
      const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');

      // Actual PostgreSQL CDC payload for relational task assignment (has NO entity_id)
      const cdcPayload = {
        eventType: 'INSERT',
        new: {
          task_id: 'qa-task-2',
          user_id: mockUserStaff.id,
          assigned_at: '2026-10-24T18:00:00Z',
        },
        old: null,
      };

      const handled = handleRealtimePayload(
        testQueryClient,
        { table: 'task_assignees', activeEntity: 'ATA' },
        cdcPayload
      );

      expect(handled).toBe(true);
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: operationsKeys.all });
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.all });
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: transmittalKeys.all });
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: documentKeys.all });
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: dashboardKeys.assignedTasks.all });
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: dashboardKeys.timeEntries.all });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: operationsKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: disbursementKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: transmittalKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: documentKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dashboardKeys.assignedTasks.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: dashboardKeys.timeEntries.all });
    });

    it('does not discard task_assignees DELETE events, and clears protected caches', () => {
      const cancelSpy = vi.spyOn(testQueryClient, 'cancelQueries');
      const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');

      const cdcDeletePayload = {
        eventType: 'DELETE',
        new: null,
        old: {
          task_id: 'qa-task-2',
          user_id: mockUserStaff.id,
        },
      };

      const handled = handleRealtimePayload(
        testQueryClient,
        { table: 'task_assignees', activeEntity: 'ATA' },
        cdcDeletePayload
      );

      expect(handled).toBe(true);
      expect(cancelSpy).toHaveBeenCalledWith({ queryKey: operationsKeys.all });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: operationsKeys.all });
    });

    it('invalidates rather than injecting raw payloads for non-admin on protected domain tables', () => {
      const setQueryDataSpy = vi.spyOn(testQueryClient, 'setQueryData');
      const invalidateSpy = vi.spyOn(testQueryClient, 'invalidateQueries');

      const cdcInvoicePayload = {
        eventType: 'INSERT',
        new: {
          id: 'inv-secret',
          invoice_number: 'INV-2026-9999',
          total: 50000,
          entity_id: 'ATA',
        },
      };

      const handled = handleRealtimePayload(
        testQueryClient,
        { table: 'invoices', activeEntity: 'ATA' },
        cdcInvoicePayload
      );

      expect(handled).toBe(true);
      // Raw injection into detail cache must NOT happen
      expect(setQueryDataSpy).not.toHaveBeenCalledWith(
        billingKeys.invoiceDetail('inv-secret'),
        expect.anything()
      );
      // Invalidation must be triggered instead
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: billingKeys.invoices() });
    });
  });

  // =========================================================================
  // 5. Relational Task Assignee Team Membership Parity & Task Scope
  // =========================================================================
  describe('isWrTeamMember and Task Scope Parity', () => {
    it('recognizes relational task assignees as WR team members with read access', () => {
      const wrWithRelationalAssignee: WorkRequest = {
        ...mockWr,
        assignedTo: 'different-lead',
        coAssignees: [],
        tasks: [
          {
            ...mockTask,
            assigneeId: null,
            assignees: [],
            task_assignees: [
              {
                taskId: mockTask.id,
                userId: mockUserStaff.id,
                task_id: mockTask.id,
                user_id: mockUserStaff.id,
                assignedBy: 'lead-1',
                assignedAt: '2026-10-20T00:00:00Z',
              },
            ],
          },
        ],
      };

      const isMember = isWrTeamMember(mockUserStaff.id, wrWithRelationalAssignee);
      expect(isMember).toBe(true);
    });

    it('denies outsiders who have no WR lead, WR co-assignee, or task assignment', () => {
      const outsiderWr: WorkRequest = {
        ...mockWr,
        assignedTo: 'lead-other',
        coAssignees: ['other-co'],
        tasks: [
          {
            ...mockTask,
            assigneeId: 'other-worker',
            assignees: ['other-worker'],
          },
        ],
      };

      const isMember = isWrTeamMember(mockUserStaff.id, outsiderWr);
      expect(isMember).toBe(false);
    });

    it('preserves task-level record isolation via filterTaskRelatedRecords', () => {
      const mixedRecords = {
        invoices: [
          { id: 'inv-1', task_id: 'qa-task-2' },
          { id: 'inv-other', task_id: 'other-task-999' },
        ],
        disbursements: [
          { id: 'dv-1', task_id: 'qa-task-2' },
          { id: 'dv-other', task_id: 'other-task-999' },
        ],
        transmittals: [
          { id: 'tr-1', linked_task_id: 'qa-task-2' },
          { id: 'tr-other', linked_task_id: 'other-task-999' },
        ],
      };

      const filtered = filterTaskRelatedRecords(mixedRecords, 'qa-task-2');
      expect(filtered.invoices).toHaveLength(1);
      expect(filtered.invoices[0]?.id).toBe('inv-1');
      expect(filtered.disbursements).toHaveLength(1);
      expect(filtered.disbursements[0]?.id).toBe('dv-1');
      expect(filtered.transmittals).toHaveLength(1);
      expect(filtered.transmittals[0]?.id).toBe('tr-1');
    });
  });
});
