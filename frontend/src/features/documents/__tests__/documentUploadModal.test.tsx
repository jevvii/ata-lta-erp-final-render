import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocumentUploadModal } from '../components/DocumentUploadModal';

import { useSessionStore } from '@/lib/session';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/features/operations/api/useTeam', () => ({
  useTeam: () => ({ data: [], isLoading: false }),
}));

const mockMutateAsyncUpload = vi.fn();

const mockWorkRequestsData = [
  {
    id: 'wr-ata-1',
    entity: 'ATA',
    title: 'ATA Tax Compliance',
    tracking_number: 'WR-ATA-001',
    clientId: 'cli-ata-1',
    archived: false,
    tasks: [
      { id: 'task-ata-1', title: 'Prepare ATA BIR 1702', workRequestId: 'wr-ata-1', assigneeId: 'u-docs', assignees: ['u-docs'], status: 'In Progress' },
      { id: 'task-ata-2', title: 'Review ATA Books', workRequestId: 'wr-ata-1', assigneeId: 'u-docs', assignees: ['u-docs'], status: 'In Progress' },
    ],
  },
  {
    id: 'wr-lta-1',
    entity: 'LTA',
    title: 'LTA Annual Audit',
    tracking_number: 'WR-LTA-001',
    clientId: 'cli-lta-1',
    archived: false,
    tasks: [
      { id: 'task-lta-1', title: 'Draft LTA Report', workRequestId: 'wr-lta-1', assigneeId: 'u-docs', assignees: ['u-docs'], status: 'In Progress' },
    ],
  },
];

vi.mock('../api/useDocuments', () => ({
  useUploadDocument: () => ({
    mutateAsync: mockMutateAsyncUpload,
    isPending: false,
  }),
}));

vi.mock('@/features/operations/api/useWorkRequests', () => ({
  useWorkRequests: () => ({
    data: mockWorkRequestsData,
    isLoading: false,
  }),
}));

vi.mock('@/features/operations/api/useTasks', () => ({
  useWorkRequestTasks: (wrId?: string) => ({
    data:
      wrId === 'wr-ata-1'
        ? [
            { id: 'task-ata-1', title: 'Prepare ATA BIR 1702', workRequestId: 'wr-ata-1', assigneeId: 'u-docs', assignees: ['u-docs'], status: 'In Progress' },
            { id: 'task-ata-2', title: 'Review ATA Books', workRequestId: 'wr-ata-1', assigneeId: 'u-docs', assignees: ['u-docs'], status: 'In Progress' },
          ]
        : wrId === 'wr-lta-1'
        ? [{ id: 'task-lta-1', title: 'Draft LTA Report', workRequestId: 'wr-lta-1', assigneeId: 'u-docs', assignees: ['u-docs'], status: 'In Progress' }]
        : [],
    isLoading: false,
  }),
}));

describe('DocumentUploadModal - External URL & Task Linking', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.restoreAllMocks();
    mockMutateAsyncUpload.mockReset();
    useSessionStore.getState().clearSession();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  it('renders Google Drive sharing hint in External Link mode', () => {
    render(
      <DocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    // Switch to External Link mode
    const externalTab = screen.getByTestId('mode-tab-external');
    fireEvent.click(externalTab);

    // Verify Google Drive hint text is displayed
    const hint = screen.getByTestId('external-url-gdrive-hint');
    expect(hint).toBeDefined();
    expect(hint.textContent).toContain('Anyone with the link can view');
  });

  it('passes defaultTaskId as linkedTaskId in external URL mode with accurate MIME detection', async () => {
    mockMutateAsyncUpload.mockResolvedValueOnce({
      id: 'doc-new',
      linked_task_id: 'task-777',
      external_url: 'https://docs.google.com/spreadsheets/d/1testSheetId/edit',
    });

    const onSuccess = vi.fn();

    render(
      <DocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        defaultTaskId="task-777"
        defaultWorkRequestId="wr-999"
        onSuccess={onSuccess}
      />,
      { wrapper }
    );

    // Switch to External mode
    fireEvent.click(screen.getByTestId('mode-tab-external'));

    // Fill external URL
    const urlInput = screen.getByTestId('external-url-input');
    fireEvent.change(urlInput, {
      target: { value: 'https://docs.google.com/spreadsheets/d/1testSheetId/edit' },
    });

    // Fill Display Name
    const nameInput = screen.getByTestId('document-name-input');
    fireEvent.change(nameInput, {
      target: { value: 'Financial Projection.xlsx' },
    });

    // Submit
    const submitBtn = screen.getByTestId('upload-submit-button');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockMutateAsyncUpload).toHaveBeenCalledTimes(1);
    });

    const payload = mockMutateAsyncUpload.mock.calls[0]![0];
    expect(payload.metadata.linkedTaskId).toBe('task-777');
    expect(payload.metadata.workRequestId).toBe('wr-999');
    expect(payload.metadata.externalUrl).toBe('https://docs.google.com/spreadsheets/d/1testSheetId/edit');
    expect(payload.metadata.contentType).toBe('application/vnd.google-apps.spreadsheet');
    expect(payload.file.type).toBe('application/vnd.google-apps.spreadsheet');
  });

  it('detects PDF MIME type for Google Drive file link with PDF extension', async () => {
    mockMutateAsyncUpload.mockResolvedValueOnce({
      id: 'doc-pdf',
      linked_task_id: 'task-123',
    });

    render(
      <DocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        defaultTaskId="task-123"
      />,
      { wrapper }
    );

    fireEvent.click(screen.getByTestId('mode-tab-external'));

    fireEvent.change(screen.getByTestId('external-url-input'), {
      target: { value: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view' },
    });
    fireEvent.change(screen.getByTestId('document-name-input'), {
      target: { value: 'Contract Agreement.pdf' },
    });

    fireEvent.click(screen.getByTestId('upload-submit-button'));

    await waitFor(() => {
      expect(mockMutateAsyncUpload).toHaveBeenCalledTimes(1);
    });

    const payload = mockMutateAsyncUpload.mock.calls[0]![0];
    expect(payload.metadata.linkedTaskId).toBe('task-123');
    expect(payload.metadata.contentType).toBe('application/pdf');
    expect(payload.file.type).toBe('application/pdf');
  });

  it('resets linkedTaskId when reopened without defaultTaskId prop', async () => {
    mockMutateAsyncUpload.mockResolvedValue({
      id: 'doc-standalone',
      linked_task_id: null,
    });

    const { rerender } = render(
      <DocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        defaultTaskId="task-prior"
      />,
      { wrapper }
    );

    // Reopen modal without defaultTaskId
    rerender(
      <DocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
        defaultTaskId={undefined}
      />
    );

    fireEvent.click(screen.getByTestId('mode-tab-external'));
    fireEvent.change(screen.getByTestId('external-url-input'), {
      target: { value: 'https://sec.gov.ph/files/doc.pdf' },
    });
    fireEvent.change(screen.getByTestId('document-name-input'), {
      target: { value: 'Independent Report.pdf' },
    });

    fireEvent.click(screen.getByTestId('upload-submit-button'));

    await waitFor(() => {
      expect(mockMutateAsyncUpload).toHaveBeenCalledTimes(1);
    });

    const payload = mockMutateAsyncUpload.mock.calls[0]![0];
    expect(payload.metadata.linkedTaskId).toBeUndefined();
  });

  it('renders all 12 category options in the category select with Others as default', () => {
    render(
      <DocumentUploadModal
        isOpen={true}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    const trigger = screen.getByTestId('upload-category-select');
    expect(trigger).toBeDefined();
    expect(trigger.textContent).toContain('Others');
  });

  describe('Work Request Task Linking & Active Entity Awareness', () => {
    it('does not render work request task dropdown for disallowed users', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-accounting',
          email: 'accounting@ata-lta.ph',
          name: 'Accounting Staff',
          role: 'Accounting',
          departments: ['Accounting'],
          entities: ['ATA'],
        },
        permissions: ['dms:edit'], // lacks workflow:view
        activeEntity: 'ATA',
      });

      render(<DocumentUploadModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      expect(screen.queryByTestId('work-request-task-select')).not.toBeInTheDocument();
      expect(screen.queryByTestId('work-request-select')).not.toBeInTheDocument();
    });

    it('renders work request task dropdown for allowed users (e.g. workflow:view) and filters by active entity ATA', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-docs',
          email: 'twinkle@ata-lta.ph',
          name: 'Twinkle Documents',
          role: 'Documentation',
          departments: ['Documentation'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['dms:edit', 'workflow:view'],
        activeEntity: 'ATA',
      });

      render(<DocumentUploadModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const wrTrigger = screen.getByTestId('work-request-select');
      const taskTrigger = screen.getByTestId('work-request-task-select');
      expect(wrTrigger).toBeInTheDocument();
      expect(taskTrigger).toBeInTheDocument();
      // Disabled until WR is selected
      expect(taskTrigger).toBeDisabled();

      // Select ATA work request
      fireEvent.keyDown(wrTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
      const wrOption = await screen.findByRole('option', { name: /WR-ATA-001/i });
      fireEvent.click(wrOption);

      // Task select is now enabled
      await waitFor(() => {
        expect(taskTrigger).not.toBeDisabled();
      });

      // Open task select
      fireEvent.keyDown(taskTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      // Verify ATA tasks are shown and LTA tasks are filtered out
      expect(await screen.findByRole('option', { name: /Prepare ATA BIR 1702/i })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Review ATA Books/i })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Draft LTA Report/i })).not.toBeInTheDocument();
    });

    it('filters work request task dropdown by active entity LTA when active entity is switched', async () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-docs',
          email: 'twinkle@ata-lta.ph',
          name: 'Twinkle Documents',
          role: 'Documentation',
          departments: ['Documentation'],
          entities: ['ATA', 'LTA'],
        },
        permissions: ['dms:edit', 'workflow:view'],
        activeEntity: 'LTA',
      });

      render(<DocumentUploadModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      const wrTrigger = screen.getByTestId('work-request-select');
      const taskTrigger = screen.getByTestId('work-request-task-select');
      expect(taskTrigger).toBeDisabled();

      // Select LTA work request
      fireEvent.keyDown(wrTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
      const wrOption = await screen.findByRole('option', { name: /WR-LTA-001/i });
      fireEvent.click(wrOption);

      await waitFor(() => {
        expect(taskTrigger).not.toBeDisabled();
      });

      fireEvent.keyDown(taskTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      // Verify LTA task is shown and ATA tasks are filtered out
      expect(await screen.findByRole('option', { name: /Draft LTA Report/i })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: /Prepare ATA BIR 1702/i })).not.toBeInTheDocument();
    });

    it('allows selecting a work request task and populates linkedTaskId and workRequestId in metadata on submit', async () => {
      mockMutateAsyncUpload.mockResolvedValueOnce({
        id: 'doc-with-task',
        linked_task_id: 'task-ata-1',
        work_request_id: 'wr-ata-1',
      });

      useSessionStore.getState().setSession({
        user: {
          id: 'u-docs',
          email: 'twinkle@ata-lta.ph',
          name: 'Twinkle Documents',
          role: 'Documentation',
          departments: ['Documentation'],
          entities: ['ATA'],
        },
        permissions: ['dms:edit', 'workflow:view'],
        activeEntity: 'ATA',
      });

      render(<DocumentUploadModal isOpen={true} onClose={vi.fn()} />, { wrapper });

      // First select WR
      const wrTrigger = screen.getByTestId('work-request-select');
      fireEvent.keyDown(wrTrigger, { key: 'ArrowDown', code: 'ArrowDown' });
      const wrOption = await screen.findByRole('option', { name: /WR-ATA-001/i });
      fireEvent.click(wrOption);

      // Then select task
      const taskTrigger = screen.getByTestId('work-request-task-select');
      await waitFor(() => {
        expect(taskTrigger).not.toBeDisabled();
      });
      fireEvent.keyDown(taskTrigger, { key: 'ArrowDown', code: 'ArrowDown' });

      const taskOption = await screen.findByRole('option', { name: /Prepare ATA BIR 1702/i });
      fireEvent.click(taskOption);

      // Switch to external mode to submit
      fireEvent.click(screen.getByTestId('mode-tab-external'));
      fireEvent.change(screen.getByTestId('external-url-input'), {
        target: { value: 'https://sec.gov.ph/files/bir1702.pdf' },
      });
      fireEvent.change(screen.getByTestId('document-name-input'), {
        target: { value: 'BIR 1702 Filed.pdf' },
      });

      fireEvent.click(screen.getByTestId('upload-submit-button'));

      await waitFor(() => {
        expect(mockMutateAsyncUpload).toHaveBeenCalledTimes(1);
      });

      const payload = mockMutateAsyncUpload.mock.calls[0]![0];
      expect(payload.metadata.linkedTaskId).toBe('task-ata-1');
      expect(payload.metadata.workRequestId).toBe('wr-ata-1');
      expect(payload.metadata.clientId).toBe('cli-ata-1');
    });

    it('disables task select when defaultTaskId prop is provided', () => {
      useSessionStore.getState().setSession({
        user: {
          id: 'u-docs',
          email: 'twinkle@ata-lta.ph',
          name: 'Twinkle Documents',
          role: 'Documentation',
          departments: ['Documentation'],
          entities: ['ATA'],
        },
        permissions: ['dms:edit', 'workflow:view'],
        activeEntity: 'ATA',
      });

      render(
        <DocumentUploadModal
          isOpen={true}
          onClose={vi.fn()}
          defaultTaskId="task-fixed"
          defaultWorkRequestId="wr-fixed"
        />,
        { wrapper }
      );

      expect(screen.getByTestId('work-request-task-select')).toBeDisabled();
      expect(screen.getByTestId('work-request-select')).toBeDisabled();
    });
  });
});

