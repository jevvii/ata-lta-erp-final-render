import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocumentViewerModal } from '../components/DocumentViewerModal';
import { useBlockingModalStore } from '../components/BlockingActionModal';
import { useSessionStore } from '@/lib/session';
import type { DmsDocument, WorkRequest } from '../api/types';

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  return { queryClient, wrapper };
}

const baseMockDoc: DmsDocument = {
  id: 'doc-base',
  file_name: 'file.pdf',
  original_name: 'file.pdf',
  work_request_id: 'wr-1',
  linked_task_id: null,
  client_id: 'c-1',
  document_type: 'pdf',
  category: 'FINANCIAL',
  uploader_id: 'u-1',
  description: null,
  entity_id: 'ATA',
  status: 'active',
  document_lifecycle: 'stored',
  archived: false,
  can_comment: true,
  file_size: 1024,
  content_type: 'application/pdf',
  storage_path: '/files/test.pdf',
  external_url: null,
  comments: [],
  versions: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

const mockDocPdf: DmsDocument = {
  ...baseMockDoc,
  id: 'doc-pdf-1',
  fileName: 'Financial_Statements_2025.pdf',
  originalName: 'Financial_Statements_2025.pdf',
  file_name: 'Financial_Statements_2025.pdf',
  original_name: 'Financial_Statements_2025.pdf',
  contentType: 'application/pdf',
  content_type: 'application/pdf',
  fileSize: 1024 * 1024 * 2, // 2 MB
  file_size: 1024 * 1024 * 2,
  category: 'FINANCIAL',
  status: 'active',
  document_lifecycle: 'stored',
  createdAt: new Date().toISOString(),
  created_at: new Date().toISOString(),
  comments: [
    {
      id: 'c-1',
      userId: 'u-1',
      userName: 'Auditor Boss',
      date: new Date().toISOString(),
      text: 'Please review page 4 balance sheet adjustments.',
    },
  ],
};

const mockDocImage: DmsDocument = {
  ...baseMockDoc,
  id: 'doc-img-1',
  fileName: 'Official_Receipt_BIR.png',
  originalName: 'Official_Receipt_BIR.png',
  file_name: 'Official_Receipt_BIR.png',
  original_name: 'Official_Receipt_BIR.png',
  contentType: 'image/png',
  content_type: 'image/png',
  fileSize: 500 * 1024,
  file_size: 500 * 1024,
  category: 'BIR',
  status: 'active',
  document_lifecycle: 'scanned',
  createdAt: new Date().toISOString(),
  created_at: new Date().toISOString(),
  comments: [],
};

const mockDocDocx: DmsDocument = {
  ...baseMockDoc,
  id: 'doc-docx-1',
  fileName: 'Audit_Engagement_Letter.docx',
  originalName: 'Audit_Engagement_Letter.docx',
  file_name: 'Audit_Engagement_Letter.docx',
  original_name: 'Audit_Engagement_Letter.docx',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  fileSize: 800 * 1024,
  file_size: 800 * 1024,
  category: 'CONTRACT',
  status: 'active',
  document_lifecycle: 'stored',
  createdAt: new Date().toISOString(),
  created_at: new Date().toISOString(),
  comments: [],
};

const mockWorkRequest: WorkRequest = {
  id: 'wr-1',
  title: 'Annual Audit 2025',
  description: null,
  clientId: null,
  entity: 'ATA',
  status: 'In Progress',
  phase: 'processing',
  onHold: false,
  phaseEnteredAt: null,
  priority: 'High',
  requestedBy: null,
  assignedTo: null,
  coAssignees: [],
  dueDate: null,
  archived: false,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('Document Viewer & DMS Integration Flow', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useBlockingModalStore.getState().reset();
    useSessionStore.getState().setSession({
      user: {
        id: 'u-1',
        email: 'user@ata-lta.ph',
        name: 'Staff Reviewer',
        role: 'Staff',
        departments: ['Operations'],
        entities: ['ATA'],
      },
      permissions: ['workflow:view', 'workflow:edit'],
      activeEntity: 'ATA',
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes('/download-url')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              url: 'https://storage.googleapis.com/test-bucket/signed-file.pdf',
              fileName: 'file.pdf',
              contentType: 'application/pdf',
            },
          }),
        } as Response);
      }
      const detailDoc = [mockDocPdf, mockDocImage, mockDocDocx, baseMockDoc].find((doc) => u.includes(`/documents/${doc.id}?`));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: detailDoc || {} }),
      } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('renders DocumentViewerModal with PDF preview mode and comments thread', async () => {
    const { wrapper } = createHarness();
    render(
      <DocumentViewerModal
        isOpen={true}
        document={mockDocPdf}
        workRequest={mockWorkRequest}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('document-viewer-modal')).toBeInTheDocument();
    expect(screen.getByText('Financial_Statements_2025.pdf')).toBeInTheDocument();
    expect(screen.getByText('FINANCIAL')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('doc-preview-pdf')).toBeInTheDocument();
    });

    // Verify threaded comments
    expect(screen.getByText(/Please review page 4 balance sheet adjustments/i)).toBeInTheDocument();
    expect(screen.getByText('Auditor Boss')).toBeInTheDocument();
    expect(screen.getByTestId('new-comment-textarea')).toBeInTheDocument();
  });

  it('renders DocumentViewerModal with image preview for image MIME types', async () => {
    const { wrapper } = createHarness();
    render(
      <DocumentViewerModal
        isOpen={true}
        document={mockDocImage}
        workRequest={mockWorkRequest}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    expect(screen.getByText('Official_Receipt_BIR.png')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('doc-preview-image')).toBeInTheDocument();
    });
  });

  it('renders DOCX download card for Word processing formats', async () => {
    const { wrapper } = createHarness();
    render(
      <DocumentViewerModal
        isOpen={true}
        document={mockDocDocx}
        workRequest={mockWorkRequest}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    expect(screen.getByText('Audit_Engagement_Letter.docx')).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText(/Word Document \(\.docx\) preview is ready for download/i)
      ).toBeInTheDocument();
    });
  });

  it('enforces 50 MB file size limit and displays error on oversize file selection', async () => {
    const { wrapper } = createHarness();
    render(
      <DocumentViewerModal
        isOpen={true}
        document={mockDocPdf}
        workRequest={mockWorkRequest}
        onClose={vi.fn()}
      />,
      { wrapper }
    );

    // Mock an oversized 55 MB file
    const oversizedFile = new File(['x'.repeat(100)], 'large_backup.zip', {
      type: 'application/zip',
    });
    Object.defineProperty(oversizedFile, 'size', {
      value: 55 * 1024 * 1024, // 55 MB
    });

    const fileInput = document.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();

    if (fileInput) {
      fireEvent.change(fileInput, { target: { files: [oversizedFile] } });
    }

    await waitFor(() => {
      expect(
        screen.getByText(/File size exceeds maximum allowed limit of 50 MB/i)
      ).toBeInTheDocument();
    });
  });
});
