import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DocumentViewerModal } from '../components/DocumentViewerModal';
import type { DmsDocument } from '../api/types';
import { useSessionStore } from '@/lib/session';

// Mock TanStack hooks from useDocuments
const mockMutateAsyncComment = vi.fn();
const mockMutateAsyncUpload = vi.fn();
let mockCommentDoc: DmsDocument | undefined;
let mockDownloadError: Error | null = null;
const mockRetryDownload = vi.fn();
let mockDownloadData: { url: string; fileName: string; contentType?: string } | undefined = {
  url: 'https://storage.test/docs/doc-101.pdf',
  fileName: 'test-document.pdf',
};

vi.mock('../api/useDocuments', () => ({
  useDocumentDownloadUrl: () => ({
    data: mockDownloadData,
    error: mockDownloadError,
    refetch: mockRetryDownload,
    isLoading: false,
  }),
  useDocumentDetail: () => ({ data: mockCommentDoc }),
  useEditDocumentComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDocumentComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddDocumentComment: () => ({
    mutateAsync: mockMutateAsyncComment,
    isPending: false,
  }),
  useUploadDocument: () => ({
    mutateAsync: mockMutateAsyncUpload,
    isPending: false,
  }),
}));

describe('DocumentViewerModal (UAT2-14)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.restoreAllMocks();
    mockCommentDoc = undefined;
    mockDownloadError = null;
    mockRetryDownload.mockReset();
    mockMutateAsyncComment.mockReset();
    mockMutateAsyncUpload.mockReset();
    mockDownloadData = {
      url: 'https://storage.test/docs/doc-101.pdf',
      fileName: 'test-document.pdf',
    };

    useSessionStore.setState({
      user: {
        id: 'usr-100',
        name: 'Jane Doe',
        email: 'jane@ata-lta.com',
        role: 'manager',
        departments: ['DMS', 'Operations'],
        entities: ['ATA'],
      },
      permissions: new Set(['dms:view', 'dms:edit']),
      activeEntity: 'ATA',
    });
  });

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);

  const baseDoc: DmsDocument = {
    id: 'doc-101',
    file_name: 'compliance_report_2026.pdf',
    original_name: 'Compliance Report 2026.pdf',
    work_request_id: 'wr-1',
    linked_task_id: 'task-1',
    client_id: 'cli-1',
    document_type: 'Annual Compliance Report',
    category: 'SEC',
    uploader_id: 'usr-100',
    description: 'Corporate filings and custody',
    entity_id: 'ATA',
    status: 'active',
    document_lifecycle: 'collected',
    archived: false,
    file_size: 1024 * 500, // 500 KB
    content_type: 'application/pdf',
    storage_path: 'entities/ATA/documents/doc-101.pdf',
    external_url: null,
    comments: [
      {
        id: 'comm-1',
        userId: 'usr-100',
        userName: 'Jane Doe',
        date: '2026-10-01T10:00:00.000Z',
        text: 'Initial review complete.',
      },
    ],
    versions: [],
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
  };

  it('renders enlarged windowed modal with correct header, category badge, and styling', () => {
    const handleClose = vi.fn();

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={handleClose}
        document={baseDoc}
      />,
      { wrapper }
    );

    // Modal dialog content rendered
    const modalContent = screen.getByTestId('document-viewer-modal');
    expect(modalContent).toBeDefined();

    // Verify windowed enlarged layout classes
    expect(modalContent.className).toContain('max-w-6xl');
    expect(modalContent.className).toContain('w-[95vw]');
    expect(modalContent.className).toContain('h-[88vh]');

    // Title and category badge
    expect(screen.getByText('Compliance Report 2026.pdf')).toBeDefined();
    expect(screen.getByText('SEC')).toBeDefined();

    // Toggle button present
    const toggleBtn = screen.getByTestId('toggle-fullpage-preview');
    expect(toggleBtn).toBeDefined();
    expect(toggleBtn.textContent).toContain('Full Page');
  });

  it('toggles full-page view mode (full-viewport overlay) when toggle button is clicked', () => {
    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
      />,
      { wrapper }
    );

    const toggleBtn = screen.getByTestId('toggle-fullpage-preview');
    const modalContent = screen.getByTestId('document-viewer-modal');

    // Initially windowed
    expect(modalContent.className).toContain('max-w-6xl');
    expect(modalContent.className).not.toContain('w-screen');

    // Click to enter full page
    fireEvent.click(toggleBtn);

    // Now full-viewport overlay mode
    expect(toggleBtn.textContent).toContain('Exit Full Page');
    expect(modalContent.className).toContain('w-screen');
    expect(modalContent.className).toContain('h-screen');
    expect(modalContent.className).toContain('max-w-none');
    expect(modalContent.className).toContain('fixed');
    expect(modalContent.className).toContain('inset-0');

    // Click again to exit full page
    fireEvent.click(toggleBtn);
    expect(toggleBtn.textContent).toContain('Full Page');
    expect(modalContent.className).toContain('max-w-6xl');
    expect(modalContent.className).not.toContain('w-screen');
  });

  it('exits full-page overlay mode when Escape key is pressed', () => {
    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
      />,
      { wrapper }
    );

    const toggleBtn = screen.getByTestId('toggle-fullpage-preview');
    const modalContent = screen.getByTestId('document-viewer-modal');

    // Enter full page
    fireEvent.click(toggleBtn);
    expect(modalContent.className).toContain('w-screen');

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    // Restores windowed mode
    expect(modalContent.className).toContain('max-w-6xl');
    expect(modalContent.className).not.toContain('w-screen');
  });

  it('renders inline iframe for PDF preview', () => {
    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
      />,
      { wrapper }
    );

    const pdfIframe = screen.getByTestId('doc-preview-pdf') as HTMLIFrameElement;
    expect(pdfIframe).toBeDefined();
    expect(pdfIframe.src).toBe('https://storage.test/docs/doc-101.pdf');
  });

  it('renders inline image preview for image documents', () => {
    const imageDoc: DmsDocument = {
      ...baseDoc,
      file_name: 'site_photo.png',
      original_name: 'Site Photo.png',
      content_type: 'image/png',
    };
    mockDownloadData = {
      url: 'https://storage.test/docs/site_photo.png',
      fileName: 'site_photo.png',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={imageDoc}
      />,
      { wrapper }
    );

    const img = screen.getByTestId('doc-preview-image') as HTMLImageElement;
    expect(img).toBeDefined();
    expect(img.src).toBe('https://storage.test/docs/site_photo.png');
    expect(img.alt).toBe('Site Photo.png');
  });

  it('renders inline text viewer for text documents', () => {
    const textDoc: DmsDocument = {
      ...baseDoc,
      file_name: 'notes.txt',
      original_name: 'Notes.txt',
      content_type: 'text/plain',
    };
    mockDownloadData = {
      url: 'https://storage.test/docs/notes.txt',
      fileName: 'notes.txt',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={textDoc}
      />,
      { wrapper }
    );

    const textIframe = screen.getByTestId('doc-preview-text') as HTMLIFrameElement;
    expect(textIframe).toBeDefined();
    expect(textIframe.src).toBe('https://storage.test/docs/notes.txt');
  });

  it('renders download card for Word documents (.docx)', () => {
    const wordDoc: DmsDocument = {
      ...baseDoc,
      file_name: 'contract.docx',
      original_name: 'Contract.docx',
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={wordDoc}
      />,
      { wrapper }
    );

    expect(screen.getByText(/Word Document \(\.docx\) preview is ready for download/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Download to View/i })).toBeDefined();
  });

  it('renders download card for unsupported/generic binary files', () => {
    const zipDoc: DmsDocument = {
      ...baseDoc,
      file_name: 'archive.zip',
      original_name: 'Archive.zip',
      content_type: 'application/zip',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={zipDoc}
      />,
      { wrapper }
    );

    expect(screen.getByText(/This file type does not support inline preview/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Download File/i })).toBeDefined();
  });

  it('renders download button in header when downloadUrl is available', () => {
    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
      />,
      { wrapper }
    );

    const downloadBtn = screen.getByTestId('download-doc-btn');
    expect(downloadBtn).toBeDefined();
    const anchor = downloadBtn.closest('a');
    expect(anchor).toBeDefined();
    expect(anchor?.href).toBe('https://storage.test/docs/doc-101.pdf');
  });

  it('handles comments: displays existing and posts new comment', async () => {
    mockCommentDoc = { ...baseDoc, can_comment: true };
    mockMutateAsyncComment.mockResolvedValueOnce({
      ...baseDoc,
      comments: [
        ...baseDoc.comments,
        {
          id: 'comm-2',
          userId: 'usr-100',
          userName: 'Jane Doe',
          date: '2026-10-05T12:00:00.000Z',
          text: 'Verified BIR stamped copy.',
        },
      ],
    });

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
      />,
      { wrapper }
    );

    // Initial comment visible
    expect(screen.getByText('Initial review complete.')).toBeDefined();
    expect(screen.getByTestId('comment-item-comm-1')).toBeDefined();

    // Type new comment
    const textarea = screen.getByTestId('new-comment-textarea');
    fireEvent.change(textarea, { target: { value: 'Verified BIR stamped copy.' } });

    // Submit new comment
    const postBtn = screen.getByTestId('post-comment-btn');
    fireEvent.click(postBtn);

    await waitFor(() => {
      expect(mockMutateAsyncComment).toHaveBeenCalledTimes(1);
    });

    const callArgs = mockMutateAsyncComment.mock.calls[0]![0];
    expect(callArgs.id).toBe('doc-101');
    expect(callArgs.text).toBe('Verified BIR stamped copy.');
    expect(callArgs.data).toBeUndefined();
  });

  it('enforces 50 MB file size limit and displays error banner when exceeded', async () => {
    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
      />,
      { wrapper }
    );

    const fileInput = screen.getByTestId('viewer-file-input');

    // 52 MB file (exceeds 50 MB limit)
    const largeFile = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(largeFile, 'size', { value: 52 * 1024 * 1024 });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    // Surfaces 50 MB error banner
    await waitFor(() => {
      expect(screen.getByText(/File size exceeds maximum allowed limit of 50 MB/i)).toBeDefined();
    });

    // Upload mutation NOT called
    expect(mockMutateAsyncUpload).not.toHaveBeenCalled();
  });

  it('triggers document upload when valid file (<50 MB) is selected', async () => {
    const uploadedResult = {
      ...baseDoc,
      file_name: 'updated.pdf',
      original_name: 'updated.pdf',
    };
    mockMutateAsyncUpload.mockResolvedValueOnce(uploadedResult);
    const onUploadSuccess = vi.fn();

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
        onUploadSuccess={onUploadSuccess}
      />,
      { wrapper }
    );

    const fileInput = screen.getByTestId('viewer-file-input');
    const validFile = new File(['content'], 'updated.pdf', { type: 'application/pdf' });
    Object.defineProperty(validFile, 'size', { value: 1024 * 1024 * 5 }); // 5 MB

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(mockMutateAsyncUpload).toHaveBeenCalledTimes(1);
    });

    expect(mockMutateAsyncUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        file: validFile,
        metadata: expect.objectContaining({
          workRequestId: 'wr-1',
          linkedTaskId: 'task-1',
          clientId: 'cli-1',
        }),
      })
    );
    expect(onUploadSuccess).toHaveBeenCalledWith(uploadedResult);
  });

  it('disables Replace / Upload button with explanatory tooltip when document has no linked task', () => {
    const legacyFloatingDoc: DmsDocument = {
      ...baseDoc,
      id: 'doc-legacy-floating',
      linked_task_id: null,
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={legacyFloatingDoc}
      />,
      { wrapper }
    );

    const replaceBtn = screen.getByTestId('upload-doc-btn');
    expect(replaceBtn).toBeDisabled();
    expect(replaceBtn).toHaveAttribute(
      'title',
      'Cannot replace a legacy document that has no linked task'
    );
    expect(screen.getByTestId('viewer-file-input')).toBeDisabled();
  });

  it('respects readOnly mode by hiding upload button and comment form', () => {
    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={baseDoc}
        readOnly={true}
      />,
      { wrapper }
    );

    // Replace / Upload button hidden
    expect(screen.queryByTestId('upload-doc-btn')).toBeNull();

    // Comment form hidden
    expect(screen.queryByTestId('new-comment-textarea')).toBeNull();
    expect(screen.queryByTestId('post-comment-btn')).toBeNull();
  });

  it('renders Google Drive document with /preview iframe and Open in Google Drive CTA', () => {
    const gdriveDoc: DmsDocument = {
      ...baseDoc,
      id: 'doc-gdrive',
      original_name: 'Master Contract.pdf',
      external_url: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing',
      storage_path: null,
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={gdriveDoc}
      />,
      { wrapper }
    );

    // Google Drive iframe preview rendered with transformed preview URL
    const iframe = screen.getByTestId('doc-preview-gdrive');
    expect(iframe).toBeDefined();
    expect(iframe.getAttribute('src')).toBe(
      'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/preview'
    );

    // Open in Google Drive CTA button rendered
    expect(screen.getByText('Open in Google Drive')).toBeDefined();
  });

  it('falls back to doc.external_url when downloadData is null or absent', () => {
    const gdriveDoc: DmsDocument = {
      ...baseDoc,
      id: 'doc-gdrive-fallback',
      original_name: 'Financial Model.xlsx',
      external_url: 'https://docs.google.com/spreadsheets/d/1spreadSheetId123/edit',
      storage_path: null,
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={gdriveDoc}
      />,
      { wrapper }
    );

    const iframe = screen.getByTestId('doc-preview-gdrive');
    expect(iframe).toBeDefined();
    expect(iframe.getAttribute('src')).toBe(
      'https://docs.google.com/spreadsheets/d/1spreadSheetId123/preview'
    );
  });

  it('renders informative external fallback card and Open External Link CTA for non-embeddable external URLs', () => {
    const genericExternalDoc: DmsDocument = {
      ...baseDoc,
      id: 'doc-generic-external',
      original_name: 'SEC Company Registration Verification',
      content_type: null,
      contentType: null,
      external_url: 'https://sec.gov.ph/verification/company-12345',
      storage_path: null,
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={genericExternalDoc}
      />,
      { wrapper }
    );

    // Fallback card text
    expect(
      screen.getByText(/This external document cannot be embedded inline/i)
    ).toBeDefined();

    // CTA button rendered
    const openBtns = screen.getAllByText('Open External Link');
    expect(openBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('handles camelCase externalUrl compatibility alias', () => {
    const camelCaseDoc = {
      ...baseDoc,
      id: 'doc-camel',
      original_name: 'Presentation.pptx',
      external_url: null,
      externalUrl: 'https://docs.google.com/presentation/d/1presentationId/edit',
      storage_path: null,
    } as unknown as DmsDocument;

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={camelCaseDoc}
      />,
      { wrapper }
    );

    const iframe = screen.getByTestId('doc-preview-gdrive');
    expect(iframe).toBeDefined();
    expect(iframe.getAttribute('src')).toBe(
      'https://docs.google.com/presentation/d/1presentationId/preview'
    );
    expect(screen.getByText('Open in Google Drive')).toBeDefined();
  });

  it('supports doc prop alias and correctly renders DocumentViewerModal', () => {
    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        doc={baseDoc}
      />,
      { wrapper }
    );

    expect(screen.getByText('Compliance Report 2026.pdf')).toBeDefined();
  });

  it('keeps internal documents with undefined storage_path downloadable without falsely marking as external', () => {
    const internalDocWithoutStoragePath: DmsDocument = {
      ...baseDoc,
      id: 'doc-internal-no-path',
      original_name: 'Raw_Data_Export.csv',
      fileName: 'Raw_Data_Export.csv',
      external_url: null,
      externalUrl: null,
      storage_path: undefined as unknown as null,
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={internalDocWithoutStoragePath}
      />,
      { wrapper }
    );

    // Download button is rendered in header and not marked as Open External Link
    expect(screen.queryByText('Open External Link')).toBeNull();
    expect(screen.getByText('Download')).toBeDefined();
  });

  it('renders informative external fallback card and Open External Link CTA for external .docx documents', () => {
    const externalDocx: DmsDocument = {
      ...baseDoc,
      id: 'doc-ext-docx',
      original_name: 'board_resolution.docx',
      fileName: 'board_resolution.docx',
      external_url: 'https://sec.gov.ph/files/board_resolution.docx',
      storage_path: null,
      content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={externalDocx}
      />,
      { wrapper }
    );

    // Fallback card text is shown instead of broken Word download view
    expect(
      screen.getByText(/This external document cannot be embedded inline/i)
    ).toBeDefined();

    const openBtns = screen.getAllByText('Open External Link');
    expect(openBtns.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Download to View')).toBeNull();
  });

  it('correctly handles internal documents with camelCase storagePath without false external classification', () => {
    const camelCaseInternalDoc = {
      ...baseDoc,
      id: 'doc-internal-camel',
      original_name: 'Spreadsheet.xlsx',
      fileName: 'Spreadsheet.xlsx',
      storage_path: null,
      storagePath: 'entity/storage/Spreadsheet.xlsx',
      external_url: null,
      externalUrl: null,
    } as unknown as DmsDocument;

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={camelCaseInternalDoc}
      />,
      { wrapper }
    );

    expect(screen.queryByText('Open External Link')).toBeNull();
    expect(screen.getByText('Download')).toBeDefined();
  });

  it('renders informative external fallback card and Open External Link CTA for external .pdf documents', () => {
    const externalPdf: DmsDocument = {
      ...baseDoc,
      id: 'doc-ext-pdf',
      original_name: 'SEC_Registration_Certificate.pdf',
      fileName: 'SEC_Registration_Certificate.pdf',
      external_url: 'https://sec.gov.ph/files/registration.pdf',
      storage_path: null,
      content_type: 'application/pdf',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={externalPdf}
      />,
      { wrapper }
    );

    // Fallback card text is shown instead of broken cross-origin PDF iframe
    expect(
      screen.getByText(/This external document cannot be embedded inline/i)
    ).toBeDefined();

    expect(screen.queryByTestId('doc-preview-pdf')).toBeNull();

    const openBtns = screen.getAllByText('Open External Link');
    expect(openBtns.length).toBeGreaterThanOrEqual(1);
    const anchor = openBtns[0]?.closest('a');
    expect(anchor?.href).toBe('https://sec.gov.ph/files/registration.pdf');
  });

  it('renders informative external fallback card for external text documents', () => {
    const externalText: DmsDocument = {
      ...baseDoc,
      id: 'doc-ext-txt',
      original_name: 'server_log.txt',
      fileName: 'server_log.txt',
      external_url: 'https://example.com/logs/server_log.txt',
      storage_path: null,
      content_type: 'text/plain',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={externalText}
      />,
      { wrapper }
    );

    expect(
      screen.getByText(/This external document cannot be embedded inline/i)
    ).toBeDefined();
    expect(screen.queryByTestId('doc-preview-text')).toBeNull();
  });

  it('does not falsely classify document as external when external_url is only whitespace', () => {
    const whitespaceExternalDoc: DmsDocument = {
      ...baseDoc,
      id: 'doc-whitespace-ext',
      original_name: 'Internal_Report.pdf',
      fileName: 'Internal_Report.pdf',
      external_url: '   ',
      externalUrl: '   ',
      storage_path: 'entities/ATA/documents/Internal_Report.pdf',
      content_type: 'application/pdf',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={whitespaceExternalDoc}
      />,
      { wrapper }
    );

    // Rendered as internal PDF preview and download button, not external link
    expect(screen.queryByText('Open External Link')).toBeNull();
    expect(screen.getByText('Download')).toBeDefined();
    expect(screen.getByTestId('doc-preview-pdf')).toBeDefined();
  });

  it('renders Document Details metadata panel with uploader, date, work request, and linked task', () => {
    const docWithMetadata: DmsDocument = {
      ...baseDoc,
      uploader_name: 'Twinkle Documents',
      work_request_title: 'Annual Tax Returns 2026',
      linked_task_title: 'BIR Form 1702 Preparation',
      created_at: '2026-10-12T01:30:00.000Z',
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={docWithMetadata}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('document-details-panel')).toBeInTheDocument();
    expect(screen.getByTestId('doc-uploader-name')).toHaveTextContent('Twinkle Documents');
    expect(screen.getByTestId('doc-work-request')).toHaveTextContent('Annual Tax Returns 2026');
    expect(screen.getByTestId('doc-linked-task')).toHaveTextContent('BIR Form 1702 Preparation');
    expect(screen.getByTestId('doc-upload-date')).not.toHaveTextContent('Unknown');
  });

  it('renders Document Details fallbacks when metadata fields are missing or not linked', () => {
    const docWithoutMetadata: DmsDocument = {
      ...baseDoc,
      uploader_name: undefined,
      uploaderName: undefined,
      uploader_id: 'unknown-user-id',
      work_request_title: undefined,
      linked_task_title: undefined,
    };

    render(
      <DocumentViewerModal
        isOpen={true}
        onClose={vi.fn()}
        document={docWithoutMetadata}
      />,
      { wrapper }
    );

    expect(screen.getByTestId('document-details-panel')).toBeInTheDocument();
    expect(screen.getByTestId('doc-uploader-name')).toHaveTextContent('Unknown User');
    expect(screen.getByTestId('doc-work-request')).toHaveTextContent('None / Not Linked');
    expect(screen.getByTestId('doc-linked-task')).toHaveTextContent('None / Not Linked');
  });
  it('shows the preview failure and allows retry instead of an unsupported-file message', () => {
    mockDownloadData = undefined;
    mockDownloadError = new Error('Document not found');
    render(<QueryClientProvider client={queryClient}>
      <DocumentViewerModal isOpen onClose={vi.fn()} document={baseDoc} />
    </QueryClientProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('Document not found');
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }));
    expect(mockRetryDownload).toHaveBeenCalledTimes(1);
  });

});

