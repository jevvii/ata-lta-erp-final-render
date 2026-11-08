import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { supabase, MockRealtimeChannel } from '@/lib/supabase';
import { useSessionStore, type UserProfile } from '@/lib/session';
import { WorkRequestSidePeek } from '../components/WorkRequestSidePeek';
import { WORK_REQUEST_STATUS_OPTIONS, type WorkRequest, type Task, type DmsDocument } from '../api/types';

const mockTask: Task = {
  id: 'task-peek-1',
  workRequestId: 'wr-peek-1',
  title: 'Review Financial Statements',
  description: 'Detailed analysis of Q1 statements',
  status: 'In Progress',
  phase: 'processing',
  qaStatus: 'none',
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  assigneeId: 'user-emp-1',
  assigneeName: 'Alice Staff',
  assignees: ['user-emp-1'],
  predecessors: [],
  dueDate: '2026-04-15T00:00:00Z',
  requiredLinkType: null,
  displayOrder: 1,
  version: 1,
  checklist: [
    { id: 'chk-1', text: 'Verify income entries', completed: true },
    { id: 'chk-2', text: 'Cross-check bank reconciliation', completed: false },
  ],
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
};

const mockDoc: DmsDocument = {
  id: 'doc-peek-1',
  fileName: 'Financial_Report_Q1.pdf',
  file_name: 'Financial_Report_Q1.pdf',
  originalName: 'Financial_Report_Q1.pdf',
  original_name: 'Financial_Report_Q1.pdf',
  workRequestId: 'wr-peek-1',
  work_request_id: 'wr-peek-1',
  linkedTaskId: 'task-peek-1',
  linked_task_id: 'task-peek-1',
  clientId: 'c-1',
  client_id: 'c-1',
  documentType: 'PDF',
  document_type: 'PDF',
  category: 'FINANCIAL',
  uploaderId: 'user-admin',
  uploader_id: 'user-admin',
  description: 'Preliminary Q1 balance sheet',
  entity_id: 'ATA',
  status: 'active',
  document_lifecycle: 'collected',
  archived: false,
  fileSize: 1048576,
  file_size: 1048576,
  contentType: 'application/pdf',
  content_type: 'application/pdf',
  storage_path: 'documents/wr-peek-1/Financial_Report_Q1.pdf',
  external_url: null,
  comments: [],
  versions: [],
  createdAt: '2026-03-01T00:00:00Z',
  created_at: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const mockWr: WorkRequest = {
  id: 'wr-peek-1',
  title: 'Corporate Year-End Audit',
  description: 'Perform complete statutory audit and financial compliance',
  entity: 'ATA',
  clientId: 'c-1',
  clientName: 'Alpha Logistics Phils',
  status: 'In Progress',
  phase: 'processing',
  priority: 'High',
  archived: false,
  onHold: false,
  phaseEnteredAt: '2026-03-01T00:00:00Z',
  dueDate: '2026-04-30T00:00:00Z',
  requestedBy: 'user-client',
  assignedTo: 'user-mgr-1',
  assignedToName: 'Jane Manager',
  coAssignees: ['user-emp-1'],
  version: 1,
  createdAt: '2026-03-01T00:00:00Z',
  updatedAt: '2026-03-01T00:00:00Z',
  tasks: [mockTask],
};

const userAdmin: UserProfile = {
  id: 'user-admin',
  email: 'lorein@ata-lta.ph',
  name: 'Lorein Wong',
  role: 'Admin',
  departments: ['Management'],
  entities: ['ATA', 'LTA'],
};

const userStaff: UserProfile = {
  id: 'user-emp-1',
  email: 'alice@ata-lta.ph',
  name: 'Alice Staff',
  role: 'Staff',
  departments: ['Operations'],
  entities: ['ATA'],
};

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return { queryClient, wrapper };
}

describe('WorkRequestSidePeek Enhanced Notion-like Features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
        return new Response(JSON.stringify({ data: [mockTask] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-peek-1')) {
        return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
      }
      if (url.includes('/documents/doc-peek-1/download-url')) {
        return new Response(
          JSON.stringify({
            data: {
              url: 'https://storage.supabase.co/Financial_Report_Q1.pdf',
              fileName: 'Financial_Report_Q1.pdf',
              contentType: 'application/pdf',
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/documents')) {
        return new Response(JSON.stringify({ data: [mockDoc] }), { status: 200 });
      }
      if (url.includes('/me/team')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: 'user-mgr-1', name: 'Jane Manager', role: 'Manager' },
              { id: 'user-emp-1', name: 'Alice Staff', role: 'Staff' },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders all 12 status options in WORK_REQUEST_STATUS_OPTIONS', () => {
    expect(WORK_REQUEST_STATUS_OPTIONS).toEqual([
      'Received',
      'For Client Approval',
      'For Requirements',
      'Pending Requirements',
      'For Assignment',
      'In Progress',
      'For Supervisor Review',
      'For Billing',
      'For Payment',
      'For Submission',
      'For Quality Check',
      'Completed',
    ]);
  });

  it('allows Admin to open the status dropdown and select a new status freely', async () => {
    useSessionStore.getState().setSession({
      user: userAdmin,
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    let patchedData: unknown = null;
    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/operations/work-requests/wr-peek-1') && init?.method === 'PUT') {
        patchedData = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ data: { ...mockWr, status: 'For Supervisor Review' } }), {
          status: 200,
        });
      }
      if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
        return new Response(JSON.stringify({ data: [mockTask] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-peek-1')) {
        return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
      }
      if (url.includes('/documents')) {
        return new Response(JSON.stringify({ data: [mockDoc] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    const { wrapper } = createTestHarness();
    render(
      <WorkRequestSidePeek
        isOpen={true}
        workRequestId="wr-peek-1"
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    // Wait for title
    await waitFor(() => {
      expect(screen.getByTestId('side-peek-title')).toHaveTextContent('Corporate Year-End Audit');
    });

    // Check status dropdown trigger
    const statusBtn = screen.getByTestId('side-peek-status');
    expect(statusBtn).toHaveAttribute('data-admin-status-dropdown', 'true');

    // Trigger dropdown opening
    fireEvent.pointerDown(statusBtn, { button: 0, ctrlKey: false });
    fireEvent.keyDown(statusBtn, { key: 'ArrowDown', code: 'ArrowDown' });

    // Verify status options are rendered
    await waitFor(() => {
      expect(screen.getByTestId('status-option-For Supervisor Review')).toBeInTheDocument();
      expect(screen.getByTestId('status-option-Received')).toBeInTheDocument();
      expect(screen.getByTestId('status-option-Completed')).toBeInTheDocument();
    });

    // Click "For Supervisor Review"
    fireEvent.click(screen.getByTestId('status-option-For Supervisor Review'));

    await waitFor(() => {
      expect(patchedData).toEqual({
        status: 'For Supervisor Review',
        entity: 'ATA',
        expectedVersion: 1,
      });
    });
  });

  it('renders read-only status pill for non-admin users without dropdown trigger', async () => {
    useSessionStore.getState().setSession({
      user: userStaff,
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createTestHarness();
    render(
      <WorkRequestSidePeek
        isOpen={true}
        workRequestId="wr-peek-1"
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByTestId('side-peek-title')).toHaveTextContent('Corporate Year-End Audit');
    });

    const statusBadge = screen.getByTestId('side-peek-status');
    expect(statusBadge.tagName.toLowerCase()).toBe('span');
    expect(statusBadge).not.toHaveAttribute('data-admin-status-dropdown');
  });

  it('renders attached documents with preview capability inside sidepeek', async () => {
    useSessionStore.getState().setSession({
      user: userAdmin,
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createTestHarness();
    render(
      <WorkRequestSidePeek
        isOpen={true}
        workRequestId="wr-peek-1"
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText('Financial_Report_Q1.pdf')).toBeInTheDocument();
    });

    // Click Preview button
    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    fireEvent.click(previewBtn);

    // Verify inline previewer panel appears and resolves iframe
    await waitFor(() => {
      expect(screen.getByText(/Previewing: Financial_Report_Q1.pdf/i)).toBeInTheDocument();
      expect(screen.getByTestId('inline-doc-preview-frame')).toBeInTheDocument();
    });
  });

  it('renders attached Google Drive document with /preview iframe and Open in Drive link inside sidepeek', async () => {
    const mockGdriveDoc: DmsDocument = {
      ...mockDoc,
      id: 'doc-peek-gdrive',
      fileName: 'Master_Contract.pdf',
      originalName: 'Master_Contract.pdf',
      external_url: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing',
      storage_path: null,
    };

    // Override fetch for this test
    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
        return new Response(JSON.stringify({ data: [mockTask] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-peek-1')) {
        return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
      }
      if (url.includes('/documents/doc-peek-gdrive/download-url')) {
        return new Response(
          JSON.stringify({
            data: {
              url: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing',
              fileName: 'Master_Contract.pdf',
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/documents')) {
        return new Response(JSON.stringify({ data: [mockGdriveDoc] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    useSessionStore.getState().setSession({
      user: userAdmin,
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createTestHarness();
    render(
      <WorkRequestSidePeek
        isOpen={true}
        workRequestId="wr-peek-1"
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText('Master_Contract.pdf')).toBeInTheDocument();
    });

    // Click Preview button
    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    fireEvent.click(previewBtn);

    // Verify Google Drive iframe and Open in Drive link
    await waitFor(() => {
      const iframe = screen.getByTestId('inline-doc-preview-gdrive');
      expect(iframe).toBeInTheDocument();
      expect(iframe).toHaveAttribute(
        'src',
        'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/preview'
      );
      expect(screen.getByText('Open in Drive')).toBeInTheDocument();
    });
  });

  it('renders attached generic external document with Open External Link fallback in sidepeek', async () => {
    const mockGenericExtDoc: DmsDocument = {
      ...mockDoc,
      id: 'doc-peek-generic-ext',
      fileName: 'Government_Notice.pdf',
      originalName: 'Government_Notice.pdf',
      external_url: 'https://sec.gov.ph/notices/notice-999.pdf',
      storage_path: null,
      contentType: 'application/pdf',
    };

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
        return new Response(JSON.stringify({ data: [mockTask] }), { status: 200 });
      }
      if (url.includes('/operations/work-requests/wr-peek-1')) {
        return new Response(JSON.stringify({ data: mockWr }), { status: 200 });
      }
      if (url.includes('/documents/doc-peek-generic-ext/download-url')) {
        return new Response(
          JSON.stringify({
            data: {
              url: 'https://sec.gov.ph/notices/notice-999.pdf',
              fileName: 'Government_Notice.pdf',
            },
          }),
          { status: 200 }
        );
      }
      if (url.includes('/documents')) {
        return new Response(JSON.stringify({ data: [mockGenericExtDoc] }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });

    useSessionStore.getState().setSession({
      user: userAdmin,
      permissions: ['workflow:view'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createTestHarness();
    render(
      <WorkRequestSidePeek
        isOpen={true}
        workRequestId="wr-peek-1"
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText('Government_Notice.pdf')).toBeInTheDocument();
    });

    const previewBtn = screen.getByRole('button', { name: /Preview/i });
    fireEvent.click(previewBtn);

    await waitFor(() => {
      expect(screen.getByText(/This external link cannot be embedded inline/i)).toBeInTheDocument();
      expect(screen.queryByTestId('inline-doc-preview-frame')).not.toBeInTheDocument();
      expect(screen.queryByTestId('inline-doc-preview-gdrive')).not.toBeInTheDocument();
      expect(screen.getByText('Open Link')).toBeInTheDocument();
      expect(screen.getByText('Open External Link')).toBeInTheDocument();
    });
  });

  it('allows clicking tasks or details to open TaskDetailModal', async () => {
    useSessionStore.getState().setSession({
      user: userAdmin,
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    const { wrapper } = createTestHarness();
    render(
      <WorkRequestSidePeek
        isOpen={true}
        workRequestId="wr-peek-1"
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText('Review Financial Statements')).toBeInTheDocument();
    });

    // Click "Details" button on task
    const detailsBtn = screen.getByRole('button', { name: /Details/i });
    fireEvent.click(detailsBtn);

    // Verify TaskDetailModal is mounted
    await waitFor(() => {
      expect(screen.getByTestId('task-detail-modal')).toBeInTheDocument();
    });
  });

  it('mounts PresenceAvatars in header bar and shows active viewers of the work request', async () => {
    useSessionStore.getState().setSession({
      user: userAdmin,
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    const channelSpy = vi.spyOn(supabase, 'channel');
    const { wrapper } = createTestHarness();

    const { unmount } = render(
      <WorkRequestSidePeek
        isOpen={true}
        workRequestId="wr-peek-1"
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    await waitFor(() => {
      expect(channelSpy).toHaveBeenCalledWith('presence:work_request:wr-peek-1');
    });

    const channel = supabase.channel('presence:work_request:wr-peek-1') as unknown as MockRealtimeChannel;

    // Simulate another colleague viewing the same WR
    act(() => {
      channel.setPresenceState({
        [userAdmin.id]: [{ ...userAdmin, userId: userAdmin.id }],
        'user-colleague-2': [
          {
            userId: 'user-colleague-2',
            name: 'Bob Accountant',
            email: 'bob@ata-lta.ph',
            role: 'Accounting',
          },
        ],
      });
      channel.emit('presence', { event: 'sync' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('presence-avatars')).toBeInTheDocument();
      expect(screen.getByTestId('presence-avatar-user-colleague-2')).toBeInTheDocument();
    });

    // Verify hover tooltip
    const avatar = screen.getByTestId('presence-avatar-user-colleague-2');
    fireEvent.mouseEnter(avatar);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Viewing now: Bob Accountant (Accounting)');

    // Verify clean channel untrack and removal on drawer unmount
    const untrackSpy = vi.spyOn(channel, 'untrack');
    const removeChannelSpy = vi.spyOn(supabase, 'removeChannel');

    unmount();
    expect(untrackSpy).toHaveBeenCalled();
    expect(removeChannelSpy).toHaveBeenCalledWith(channel);
  });

  describe('Tasks Breakdown Adaptive Hybrid UserAvatar Display', () => {
    const taskZero: Task = {
      ...mockTask,
      id: 'task-zero',
      title: 'Task With Zero Assignees',
      assigneeId: null,
      assigneeName: null,
      assignees: [],
    };

    const taskOne: Task = {
      ...mockTask,
      id: 'task-one',
      title: 'Task With Single Assignee',
      assigneeId: 'user-emp-1',
      assigneeName: 'Alice Staff',
      assignees: ['user-emp-1'],
    };

    const taskTwo: Task = {
      ...mockTask,
      id: 'task-two',
      title: 'Task With Two Assignees',
      assigneeId: 'user-emp-1',
      assigneeName: 'Alice Staff',
      assignees: ['user-emp-1', 'user-emp-2'],
      assigneeDetails: [
        { userId: 'user-emp-1', userName: 'Alice Staff' },
        { userId: 'user-emp-2', userName: 'Bob Smith' },
      ],
    };

    const taskFour: Task = {
      ...mockTask,
      id: 'task-four',
      title: 'Task With Four Assignees',
      assigneeId: 'user-emp-1',
      assigneeName: 'Alice Staff',
      assignees: ['user-emp-1', 'user-emp-2', 'user-emp-3', 'user-emp-4'],
      assigneeDetails: [
        { userId: 'user-emp-1', userName: 'Alice Staff' },
        { userId: 'user-emp-2', userName: 'Bob Smith' },
        { userId: 'user-emp-3', userName: 'Carlos Diaz' },
        { userId: 'user-emp-4', userName: 'Diana Prince' },
      ],
    };

    it('renders 0 assignees as "?" avatar and "Unassigned" text', async () => {
      useSessionStore.getState().setSession({
        user: userAdmin,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
          return new Response(JSON.stringify({ data: [taskZero] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-peek-1')) {
          return new Response(JSON.stringify({ data: { ...mockWr, tasks: [taskZero] } }), { status: 200 });
        }
        if (url.includes('/me/team')) {
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const { wrapper } = createTestHarness();
      render(
        <WorkRequestSidePeek isOpen={true} workRequestId="wr-peek-1" onClose={vi.fn()} />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-task-assignees-task-zero')).toBeInTheDocument();
      });

      const container = screen.getByTestId('side-peek-task-assignees-task-zero');
      expect(container).toHaveAttribute('title', 'Unassigned');

      const label = screen.getByTestId('side-peek-task-assignee-label-task-zero');
      expect(label).toHaveTextContent('Unassigned');
      expect(label).toHaveClass('italic');
      expect(container).toHaveTextContent('?');
    });

    it('renders 1 assignee as Lead UserAvatar and full name label', async () => {
      useSessionStore.getState().setSession({
        user: userAdmin,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
          return new Response(JSON.stringify({ data: [taskOne] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-peek-1')) {
          return new Response(JSON.stringify({ data: { ...mockWr, tasks: [taskOne] } }), { status: 200 });
        }
        if (url.includes('/me/team')) {
          return new Response(
            JSON.stringify({
              data: [{ id: 'user-emp-1', name: 'Alice Staff', role: 'Staff' }],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const { wrapper } = createTestHarness();
      render(
        <WorkRequestSidePeek isOpen={true} workRequestId="wr-peek-1" onClose={vi.fn()} />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-task-assignees-task-one')).toBeInTheDocument();
      });

      const container = screen.getByTestId('side-peek-task-assignees-task-one');
      expect(container).toHaveAttribute('title', 'Alice Staff (Lead)');

      const label = screen.getByTestId('side-peek-task-assignee-label-task-one');
      expect(label).toHaveTextContent('Alice Staff');
      expect(container).toHaveTextContent('AS');
    });

    it('renders 2 assignees as stacked avatars and "First1, First2" label with accessible sr-only text', async () => {
      useSessionStore.getState().setSession({
        user: userAdmin,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
          return new Response(JSON.stringify({ data: [taskTwo] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-peek-1')) {
          return new Response(JSON.stringify({ data: { ...mockWr, tasks: [taskTwo] } }), { status: 200 });
        }
        if (url.includes('/me/team')) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 'user-emp-1', name: 'Alice Staff', role: 'Staff' },
                { id: 'user-emp-2', name: 'Bob Smith', role: 'Staff' },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const { wrapper } = createTestHarness();
      render(
        <WorkRequestSidePeek isOpen={true} workRequestId="wr-peek-1" onClose={vi.fn()} />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-task-assignees-task-two')).toBeInTheDocument();
      });

      const container = screen.getByTestId('side-peek-task-assignees-task-two');
      expect(container).toHaveAttribute('title', 'Alice Staff (Lead), Bob Smith');

      const label = screen.getByTestId('side-peek-task-assignee-label-task-two');
      expect(label).toHaveTextContent('Alice, Bob');

      // Both avatars present
      expect(container).toHaveTextContent('AS');
      expect(container).toHaveTextContent('BS');

      // Accessible full names
      const srOnly = container.querySelector('.sr-only');
      expect(srOnly).toHaveTextContent('Alice Staff, Bob Smith');
    });

    it('renders 4 assignees as 3 stacked avatars, +1 overflow badge, and "LeadFirst +3" label', async () => {
      useSessionStore.getState().setSession({
        user: userAdmin,
        permissions: ['workflow:view', 'workflow:edit'],
        activeEntity: 'ATA',
      });

      vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/operations/work-requests/wr-peek-1/tasks')) {
          return new Response(JSON.stringify({ data: [taskFour] }), { status: 200 });
        }
        if (url.includes('/operations/work-requests/wr-peek-1')) {
          return new Response(JSON.stringify({ data: { ...mockWr, tasks: [taskFour] } }), { status: 200 });
        }
        if (url.includes('/me/team')) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 'user-emp-1', name: 'Alice Staff', role: 'Staff' },
                { id: 'user-emp-2', name: 'Bob Smith', role: 'Staff' },
                { id: 'user-emp-3', name: 'Carlos Diaz', role: 'Staff' },
                { id: 'user-emp-4', name: 'Diana Prince', role: 'Staff' },
              ],
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

      const { wrapper } = createTestHarness();
      render(
        <WorkRequestSidePeek isOpen={true} workRequestId="wr-peek-1" onClose={vi.fn()} />,
        { wrapper }
      );

      await waitFor(() => {
        expect(screen.getByTestId('side-peek-task-assignees-task-four')).toBeInTheDocument();
      });

      const container = screen.getByTestId('side-peek-task-assignees-task-four');
      expect(container).toHaveAttribute(
        'title',
        'Alice Staff (Lead), Bob Smith, Carlos Diaz, Diana Prince'
      );

      const label = screen.getByTestId('side-peek-task-assignee-label-task-four');
      expect(label).toHaveTextContent('Alice +3');

      // Overflow pill
      const overflowBadge = screen.getByTestId('side-peek-task-assignee-overflow-task-four');
      expect(overflowBadge).toHaveTextContent('+1');

      // Accessible full names
      const srOnly = container.querySelector('.sr-only');
      expect(srOnly).toHaveTextContent('Alice Staff, Bob Smith, Carlos Diaz, Diana Prince');
    });
  });
});
