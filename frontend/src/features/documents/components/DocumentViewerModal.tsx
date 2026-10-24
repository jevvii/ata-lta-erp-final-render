/**
 * Document Viewer Modal Component
 *
 * Canonical DMS viewer supporting:
 * - Direct native DmsDocument typing
 * - Enlarged windowed modal sizing (max-w-6xl w-[95vw] h-[88vh])
 * - Full-page view mode (full-viewport overlay) with toggle button
 * - Native DMS query hooks (useDocumentDownloadUrl, dedicated comment mutations, useUploadDocument)
 * - PDF inline iframe, image preview, text preview, fallback download cards
 * - Comments pane (view, add, edit, delete)
 * - File replace/upload with 50 MB limit guard
 * - Shared design tokens (#0F172A, #F1F5F9, #CBD5E1, #475569)
 */

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PresenceAvatars } from '@/components/common/PresenceAvatars';
import {
  Download,
  Upload,
  MessageSquare,
  Trash2,
  Edit2,
  FileText,
  AlertCircle,
  FileQuestion,
  Maximize2,
  Minimize2,
  ExternalLink,
  Lock,
} from 'lucide-react';
import { documentKeys } from '../api/queryKeys';
import { useScopedRecordGuard } from '@/lib/useScopedRecordGuard';
import {
  useDocumentDownloadUrl,
  useDocumentDetail,
  useAddDocumentComment,
  useEditDocumentComment,
  useDeleteDocumentComment,
  useUploadDocument,
} from '../api/useDocuments';
import { MAX_FILE_SIZE_BYTES } from '../api/schemas';
import type { DmsDocument } from '../api/types';
import { useSessionStore } from '@/lib/session';
import { parseExternalUrl } from '../utils/googleDrive';
import { useEntityRealtimeSync } from '@/lib/realtime/useEntityRealtimeSync';
import { useTeam } from '@/features/operations/api/useTeam';

function commentTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return '';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return new Date(time).toLocaleDateString();
}

export interface ViewerWorkRequest {
  id: string;
  clientId?: string | null;
  title?: string;
  status?: string;
  archived?: boolean;
}

export interface DocumentViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  document?: DmsDocument | null;
  doc?: DmsDocument | null;
  workRequest?: ViewerWorkRequest | null;
  workRequests?: ViewerWorkRequest[] | null;
  onUploadSuccess?: (doc: DmsDocument) => void;
  readOnly?: boolean;
}

export function DocumentViewerModal({
  isOpen,
  onClose,
  document: propDocument,
  doc: propDoc,
  workRequest: propWorkRequest,
  workRequests: propWorkRequests,
  onUploadSuccess,
  readOnly = false,
}: DocumentViewerModalProps) {
  const initialDoc = propDocument ?? propDoc ?? null;
  const workRequest = propWorkRequest ?? (propWorkRequests && propWorkRequests[0]) ?? null;
  const [selectedDoc, setDoc] = useState<DmsDocument | null>(initialDoc);

  useEffect(() => {
    if (initialDoc && initialDoc.id !== selectedDoc?.id) {
      setDoc(initialDoc);
    }
  }, [initialDoc, selectedDoc?.id]);

  const {
    data: liveDoc,
    isError: isDocError,
    error: docError,
    isPlaceholderData: isDocPlaceholder,
  } = useDocumentDetail(selectedDoc?.id, { enabled: isOpen && Boolean(selectedDoc?.id) });

  const {
    record: doc,
    isDenied: isDocDenied,
    isScopeStale,
    canFetchChildren,
  } = useScopedRecordGuard<DmsDocument>({
    recordId: selectedDoc?.id,
    isOpen,
    onClose,
    queryError: docError,
    isQueryError: isDocError,
    isPlaceholderData: isDocPlaceholder,
    liveRecord: liveDoc,
    initialRecord: selectedDoc,
    queryKey: selectedDoc?.id ? documentKeys.detail(selectedDoc.id) : undefined,
  });
  useEntityRealtimeSync({ table: 'documents', enabled: isOpen && Boolean(doc?.id) });
  const commentsRef = useRef<HTMLDivElement | null>(null);
  const followComments = useRef(true);
  // Radix mounts portal content after the parent's effects on some opens.
  const attachCommentsRef = useCallback((node: HTMLDivElement | null) => {
    commentsRef.current = node;
    if (node) node.scrollTop = node.scrollHeight;
  }, []);
  const sending = useRef(false);
  const currentDocumentId = useRef(doc?.id);
  currentDocumentId.current = doc?.id;
  const [commentError, setCommentError] = useState<string | null>(null);
  const [isFullPage, setIsFullPage] = useState(false);
  const [newCommentText, setNewCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentText, setEditingCommentText] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentUserId = useSessionStore((state) => state.user?.id);
  const isAdmin = useSessionStore((state) => state.user?.role?.toLowerCase() === 'admin');

  const { data: rawTeam } = useTeam();
  const teamMap = useMemo(() => {
    const list = Array.isArray(rawTeam)
      ? rawTeam
      : rawTeam && typeof rawTeam === 'object' && 'data' in rawTeam && Array.isArray((rawTeam as { data: unknown[] }).data)
      ? (rawTeam as { data: Array<{ id: string; name?: string }> }).data
      : [];
    const map = new Map<string, string>();
    list.forEach((m) => {
      if (m && m.id && m.name) map.set(m.id, m.name);
    });
    return map;
  }, [rawTeam]);

  const formattedUploadDate = useMemo(() => {
    const rawDate = doc?.upload_date || doc?.created_at;
    if (!rawDate) return 'Unknown';
    try {
      const d = new Date(rawDate);
      return Number.isNaN(d.getTime()) ? rawDate : d.toLocaleString();
    } catch {
      return rawDate;
    }
  }, [doc?.upload_date, doc?.created_at]);

  // Keep doc synced with initialDoc
  useEffect(() => {
    setDoc(initialDoc);
  }, [initialDoc]);

  useEffect(() => {
    followComments.current = true;
    setCommentError(null);
    setUploadError(null);
    setEditingCommentId(null);
    setEditingCommentText('');
    setNewCommentText('');
  }, [doc?.id, isOpen]);

  useEffect(() => {
    const container = commentsRef.current;
    if (isOpen && container && followComments.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [isOpen, doc?.id, doc?.comments]);

  // Reset full page view when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsFullPage(false);
    }
  }, [isOpen]);

  // Handle ESC in full-page mode to return to windowed mode first
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullPage) {
        e.stopPropagation();
        setIsFullPage(false);
      }
    };
    if (isFullPage) {
      window.addEventListener('keydown', handleKeyDown, true);
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isFullPage]);

  const documentId = doc?.id;
  const {
    data: downloadData,
    isLoading: isDownloadLoading,
    isError: isDownloadError,
    error: downloadError,
    refetch: retryDownload,
    isFetching: isDownloadFetching,
  } = useDocumentDownloadUrl(documentId, {
    enabled:
      isOpen &&
      Boolean(documentId) &&
      canFetchChildren &&
      !(doc?.external_url?.trim() || doc?.externalUrl?.trim()),
  });

  const isDownloadDenied = Boolean(
    isDownloadError &&
      ((downloadError as { status?: number })?.status === 403 ||
        (downloadError as { status?: number })?.status === 404 ||
        String((downloadError as { message?: string })?.message || '').includes('403') ||
        String((downloadError as { message?: string })?.message || '').includes('404'))
  );

  const isDenied = Boolean(isDocDenied || isDownloadDenied);

  const addComment = useAddDocumentComment();
  const editComment = useEditDocumentComment();
  const deleteComment = useDeleteDocumentComment();
  const uploadMutation = useUploadDocument();

  const isReadOnly =
    readOnly ||
    workRequest?.status === 'Cancelled' ||
    Boolean(workRequest?.archived) ||
    Boolean(doc?.archived);

  // File attributes (original name takes precedence for user display)
  const fileName =
    doc?.original_name ||
    doc?.originalName ||
    doc?.file_name ||
    doc?.fileName ||
    'Document';
  const contentType = doc?.contentType || doc?.content_type || '';
  const effectiveExternalUrl =
    (doc?.external_url && doc.external_url.trim()) ||
    (doc?.externalUrl && doc.externalUrl.trim()) ||
    null;
  const rawUrl = effectiveExternalUrl || downloadData?.url || null;
  const parsedExternal = parseExternalUrl(rawUrl || '', fileName);
  const previewUrl = parsedExternal.isGoogleDrive ? parsedExternal.previewUrl : rawUrl;
  const isExternal = Boolean(
    effectiveExternalUrl ||
    parsedExternal.isGoogleDrive
  );
  const downloadUrl = isExternal ? null : rawUrl;

  // File Upload Handler (3-step signed upload)
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 50 MB file size limit check
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError('File size exceeds maximum allowed limit of 50 MB.');
      return;
    }
    setUploadError(null);

    try {
      const uploadedDoc = await uploadMutation.mutateAsync({
        file,
        metadata: {
          workRequestId: workRequest?.id || doc?.work_request_id || undefined,
          clientId: workRequest?.clientId || doc?.client_id || undefined,
          category: doc?.category || 'OTHER',
          fileName: file.name,
          originalName: file.name,
        },
      });
      if (uploadedDoc) {
        setDoc(uploadedDoc);
        if (onUploadSuccess) onUploadSuccess(uploadedDoc);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to upload document');
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!doc || !newCommentText.trim() || isReadOnly || sending.current || addComment.isPending) return;
    const id = doc.id;
    const submitted = newCommentText;
    sending.current = true;
    setCommentError(null);
    try {
      await addComment.mutateAsync({ id, text: submitted.trim() });
      if (currentDocumentId.current === id) {
        setNewCommentText((current) => current === submitted ? '' : current);
      }
    } catch (err) {
      if (currentDocumentId.current === id) setCommentError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      sending.current = false;
    }
  };

  const handleSaveEditComment = async (commentId: string) => {
    if (!doc || !editingCommentText.trim() || isReadOnly || editComment.isPending) return;
    const id = doc.id;
    setCommentError(null);
    try {
      await editComment.mutateAsync({ id, commentId, text: editingCommentText.trim() });
      if (currentDocumentId.current === id) {
        setEditingCommentId(null);
        setEditingCommentText('');
      }
    } catch (err) {
      if (currentDocumentId.current === id) setCommentError(err instanceof Error ? err.message : 'Failed to edit comment');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!doc || isReadOnly || deleteComment.isPending) return;
    const id = doc.id;
    setCommentError(null);
    try {
      await deleteComment.mutateAsync({ id, commentId });
    } catch (err) {
      if (currentDocumentId.current === id) setCommentError(err instanceof Error ? err.message : 'Failed to delete comment');
    }
  };

  // Determine Preview Component
  const renderPreview = () => {
    if (!doc) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-[#475569] p-8 space-y-3">
          <Upload className="h-12 w-12 text-[#475569]" />
          <p className="text-sm">No document selected. Upload a file to preview.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="border-[#E2E8F0] text-[#1E293B]"
          >
            Select Document
          </Button>
        </div>
      );
    }

    if (isDownloadLoading && !doc?.external_url && !doc?.externalUrl) {
      return (
        <div className="h-full flex items-center justify-center text-[#475569] text-sm">
          Loading document preview...
        </div>
      );
    }

    if (downloadError && !effectiveExternalUrl) {
      return (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-[#475569]">
          <p className="text-sm font-medium">Unable to load document preview</p>
          <p className="text-xs">{downloadError.message}</p>
          <Button type="button" variant="outline" size="sm" disabled={isDownloadFetching} onClick={() => void retryDownload()}>
            Retry preview
          </Button>
        </div>
      );
    }

    if (parsedExternal.isGoogleDrive && previewUrl) {
      return (
        <div className="w-full h-full flex flex-col">
          <div className="bg-[#F8FAFC] border-b border-blue-100 px-4 py-2 flex items-center justify-between text-xs text-[#1E293B]">
            <span>Google Drive Document Preview</span>
            <a
              href={parsedExternal.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline hover:text-blue-950 flex items-center gap-1"
            >
              Open Original <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <iframe
            src={previewUrl}
            className="w-full flex-1 border-0"
            title={fileName}
            allow="autoplay"
            data-testid="doc-preview-gdrive"
          />
        </div>
      );
    }

    // External Document Non-Embeddable Card (Architecture Spec Section 2 RENDER -> FALLBACK)
    if (isExternal) {
      const openUrl = effectiveExternalUrl || parsedExternal.originalUrl;
      return (
        <div className="h-full flex flex-col items-center justify-center p-8 space-y-4 text-center">
          <ExternalLink className="h-16 w-16 text-[#1E293B]" />
          <div className="space-y-1">
            <h4 className="font-semibold text-[#1E293B] text-sm">{fileName}</h4>
            <p className="text-xs text-[#475569] max-w-sm">
              This external document cannot be embedded inline. You can open the external link directly in your browser.
            </p>
          </div>
          {openUrl && (
            <a href={openUrl} target="_blank" rel="noopener noreferrer">
              <Button type="button" size="sm" className="gap-2 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs">
                <ExternalLink className="h-4 w-4" /> Open External Link
              </Button>
            </a>
          )}
        </div>
      );
    }

    const isPdf =
      contentType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
    const isImage =
      contentType.startsWith('image/') ||
      /\.(png|jpe?g|gif|webp|svg)$/i.test(fileName);
    const isText =
      contentType.startsWith('text/') ||
      /\.(txt|csv|json|md)$/i.test(fileName);
    const isDocx =
      contentType.includes('wordprocessingml') ||
      fileName.toLowerCase().endsWith('.docx');
    const isLegacyDoc = fileName.toLowerCase().endsWith('.doc');

    if (previewUrl && isPdf) {
      return (
        <iframe
          src={previewUrl}
          className="w-full h-full border-0 rounded-[6px]"
          title={fileName}
          data-testid="doc-preview-pdf"
        />
      );
    }

    if (previewUrl && isImage) {
      return (
        <div className="w-full h-full flex items-center justify-center p-4">
          <img
            src={previewUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain shadow-none rounded"
            data-testid="doc-preview-image"
          />
        </div>
      );
    }

    if (isText && previewUrl) {
      return (
        <iframe
          src={previewUrl}
          className="w-full h-full border-0 p-4 text-xs bg-white rounded"
          title={fileName}
          data-testid="doc-preview-text"
        />
      );
    }

    if (isDocx || isLegacyDoc) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-8 space-y-4 text-center">
          <FileText className="h-16 w-16 text-[#1E293B]" />
          <div className="space-y-1">
            <h4 className="font-semibold text-[#1E293B] text-sm">{fileName}</h4>
            <p className="text-xs text-[#475569] max-w-sm">
              {isLegacyDoc
                ? 'Legacy Word document (.doc) cannot be previewed inline. Please download to view.'
                : 'Word Document (.docx) preview is ready for download.'}
            </p>
          </div>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={fileName}
              target="_blank"
              rel="noreferrer"
            >
              <Button type="button" size="sm" className="gap-2 bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs">
                <Download className="h-4 w-4" /> Download to View
              </Button>
            </a>
          )}
        </div>
      );
    }

    // Generic / Fallback
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 space-y-4 text-center">
        <FileQuestion className="h-16 w-16 text-[#475569]" />
        <div className="space-y-1">
          <h4 className="font-semibold text-[#1E293B] text-sm">{fileName}</h4>
          <p className="text-xs text-[#475569] max-w-sm">
            This file type does not support inline preview. You can download the file to inspect its contents.
          </p>
        </div>
        {downloadUrl && (
          <a
            href={downloadUrl}
            download={fileName}
            target="_blank"
            rel="noreferrer"
          >
            <Button type="button" size="sm" variant="outline" className="gap-2 border-[#E2E8F0] text-[#1E293B]">
              <Download className="h-4 w-4" /> Download File
            </Button>
          </a>
        )}
      </div>
    );
  };

  const contentClasses = isFullPage
    ? 'fixed inset-0 left-0 top-0 translate-x-0 translate-y-0 w-screen h-screen max-w-none max-h-none rounded-[8px] border-0 p-0 flex flex-col overflow-hidden z-50 bg-white gap-0'
    : 'max-w-6xl w-[95vw] h-[88vh] max-h-[92vh] flex flex-col p-0 overflow-hidden border-[#E2E8F0] bg-white gap-0';

  if (isScopeStale || !isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={contentClasses}
        data-testid="document-viewer-modal"
      >
        {isDenied ? (
          <div className="py-24 text-center space-y-3" data-testid="document-access-denied">
            <div className="w-12 h-12 rounded-full bg-[#F1F5F9] mx-auto flex items-center justify-center">
              <Lock className="w-6 h-6 text-[#64748B]" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-[#1E293B]">Access Not Available</h3>
              <p className="text-xs text-[#475569] max-w-xs mx-auto">
                You do not have access to this document or access has been revoked.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="mt-2 text-xs"
              data-testid="document-access-denied-close-btn"
            >
              Close
            </Button>
          </div>
        ) : !doc ? (
          <div className="py-24 text-center text-xs text-[#475569]">Loading document...</div>
        ) : (
          <>
            {/* Header */}
            <DialogHeader className="px-6 py-3 border-b border-[#E2E8F0] flex flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2 min-w-0">
            <DialogTitle className="text-base font-bold text-[#1E293B] truncate max-w-md">
              {fileName}
            </DialogTitle>
            {doc?.category && (
              <Badge variant="outline" size="compact" className="text-xs">
                {doc.category}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 pr-6">
            {(doc?.id || initialDoc?.id) && (
              <PresenceAvatars
                domain="document"
                roomId={doc?.id || initialDoc?.id || ''}
                maxAvatars={4}
              />
            )}
            {/* Full-Page Toggle Button */}
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setIsFullPage(!isFullPage)}
              className="gap-1.5 text-xs text-[#1E293B] border-[#E2E8F0] hover:bg-[#F8FAFC]"
              title={isFullPage ? 'Exit full-page view' : 'Full-page preview'}
              data-testid="toggle-fullpage-preview"
            >
              {isFullPage ? (
                <>
                  <Minimize2 className="h-3.5 w-3.5" />
                  <span>Exit Full Page</span>
                </>
              ) : (
                <>
                  <Maximize2 className="h-3.5 w-3.5" />
                  <span>Full Page</span>
                </>
              )}
            </Button>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              data-testid="viewer-file-input"
            />
            {!isReadOnly && (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1 text-xs text-[#1E293B] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                data-testid="upload-doc-btn"
              >
                <Upload className="h-3.5 w-3.5" /> Replace / Upload
              </Button>
            )}
            {isExternal ? (
              <a
                href={effectiveExternalUrl || parsedExternal.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="xs" className="gap-1.5 text-xs text-[#1E293B]">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {parsedExternal.isGoogleDrive ? 'Open in Google Drive' : 'Open External Link'}
                </Button>
              </a>
            ) : downloadUrl ? (
              <a href={downloadUrl} download={fileName} target="_blank" rel="noreferrer">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="gap-1 text-xs text-[#1E293B] border-[#E2E8F0] hover:bg-[#F8FAFC]"
                  data-testid="download-doc-btn"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              </a>
            ) : null}
          </div>
        </DialogHeader>

        {/* Upload Error Banner */}
        {uploadError && (
          <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{uploadError}</span>
          </div>
        )}

        {/* 2-Column Viewer & Comments Body */}
        <div className="flex-1 flex overflow-hidden min-h-[520px]">
          {/* Left: Document Preview */}
          <div className="flex-1 bg-[#FFFFFF] border-r border-[#E2E8F0] p-2 overflow-auto flex flex-col items-center justify-center">
            {renderPreview()}
          </div>

          {/* Right: Threaded Comments */}
          <div className="w-80 sm:w-96 flex flex-col bg-white">
            {/* Document Details Metadata Panel */}
            <div
              className="p-3 border-b border-[#E2E8F0] bg-[#FFFFFF] text-xs space-y-2 shrink-0"
              data-testid="document-details-panel"
            >
              <div className="font-semibold text-[#1E293B] text-xs">
                Document Details
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[#475569] shrink-0">Uploader:</span>
                  <span
                    className="font-medium text-[#1E293B] text-right truncate"
                    data-testid="doc-uploader-name"
                  >
                    {doc?.uploader_name || doc?.uploaderName || (doc?.uploader_id ? teamMap.get(doc.uploader_id) : undefined) || 'Unknown User'}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[#475569] shrink-0">Date Uploaded:</span>
                  <span
                    className="font-medium text-[#1E293B] text-right truncate"
                    data-testid="doc-upload-date"
                  >
                    {formattedUploadDate}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[#475569] shrink-0">Work Request:</span>
                  <span
                    className="font-medium text-[#1E293B] text-right truncate"
                    data-testid="doc-work-request"
                  >
                    {doc?.work_request_title || workRequest?.title || 'None / Not Linked'}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[#475569] shrink-0">Linked Task:</span>
                  <span
                    className="font-medium text-[#1E293B] text-right truncate"
                    data-testid="doc-linked-task"
                  >
                    {doc?.linked_task_title || 'None / Not Linked'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3 border-b border-[#E2E8F0] flex items-center gap-1.5 text-xs font-semibold text-[#1E293B]">
              <MessageSquare className="h-3.5 w-3.5 text-[#1E293B]" />
              <span>Comments ({doc?.comments?.length || 0})</span>
            </div>

            {/* Comments List */}
            <div ref={attachCommentsRef} data-testid="comments-scroll-container"
              onScroll={(e) => {
                const el = e.currentTarget;
                followComments.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
              }} className="flex-1 p-3 overflow-y-auto space-y-3">
              {doc?.comments && doc.comments.length > 0 ? (
                doc.comments.map((comment, index) => {
                  const commentId = comment.id || `comm-${index}`;
                  const isEditing = editingCommentId === commentId;
                  const isAuthor = Boolean(currentUserId) && (comment.userId || comment.user_id) === currentUserId;
                  const sender = comment.userName || comment.user_name || comment.author || teamMap.get(comment.userId) || 'Author';

                  return (
                    <div
                      key={commentId}
                      className="p-2.5 rounded-[6px] bg-[#FFFFFF] border-[#E2E8F0] text-xs space-y-1.5"
                      data-testid={`comment-item-${commentId}`}
                    >
                      <div className="flex items-center justify-between text-xs text-[#475569]">
                        <span className="font-semibold text-[#1E293B]">
                          <span aria-hidden="true" className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-[6px] bg-[#F8FAFC] text-[#1E293B]">
                            {sender.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                          </span>{sender}
                        </span>
                        <span>
                          {comment.date || comment.created_at
                            ? commentTime(comment.date || comment.created_at || '')
                            : ''}{comment.edited && ' · edited'}
                        </span>
                      </div>

                      {isEditing ? (
                        <div className="space-y-1.5">
                          <textarea
                            value={editingCommentText}
                            onChange={(e) => setEditingCommentText(e.target.value)}
                            maxLength={4000}
                            aria-label="Edit comment"
                            rows={2}
                            className="w-full text-xs p-1.5 border-[#E2E8F0] rounded bg-white text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
                          />
                          <div className="flex justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={() => setEditingCommentId(null)}
                              className="h-5 text-xs"
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              disabled={editComment.isPending || !editingCommentText.trim()}
                              onClick={() => handleSaveEditComment(commentId)}
                              className="h-5 text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs"
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[#1E293B] whitespace-pre-wrap">
                          {comment.text}
                        </p>
                      )}

                      {!isReadOnly && !isEditing && Boolean(comment.id) && (isAuthor || isAdmin) && (
                        <div className="flex justify-end gap-2 pt-1 border-t border-[#E2E8F0] text-xs text-[#475569]">
                          {isAuthor && <button
                            type="button"
                            onClick={() => {
                              setEditingCommentId(commentId);
                              setEditingCommentText(comment.text);
                            }}
                            className="hover:text-[#1E293B] flex items-center gap-0.5 cursor-pointer"
                          >
                            <Edit2 className="h-2.5 w-2.5" /> Edit
                          </button>}
                          <button
                            type="button"
                            disabled={deleteComment.isPending}
                            onClick={() => handleDeleteComment(commentId)}
                            className="hover:text-rose-600 flex items-center gap-0.5 cursor-pointer"
                          >
                            <Trash2 className="h-2.5 w-2.5" /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-[#475569] italic py-4 text-center">
                  No comments yet. Start the conversation below.
                </div>
              )}
            </div>

            {commentError && <p role="alert" className="px-3 py-2 text-xs text-rose-700">{commentError}</p>}
            {/* Add Comment Box */}
            {!isReadOnly && (
              <form onSubmit={handleAddComment} className="p-3 border-t border-[#E2E8F0] space-y-2">
                <textarea
                  maxLength={4000}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void handleAddComment(e);
                    }
                  }}
                  value={newCommentText}
                  onChange={(e) => setNewCommentText(e.target.value)}
                  placeholder="Add a comment or review note..."
                  rows={2}
                  className="w-full text-xs p-2 border-[#E2E8F0] rounded-[6px] bg-white text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
                  data-testid="new-comment-textarea"
                />
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="xs"
                    disabled={!newCommentText.trim() || addComment.isPending}
                    data-testid="post-comment-btn"
                    className="text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs"
                  >
                    {addComment.isPending ? 'Sending...' : 'Post Comment'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-2.5 border-t border-[#E2E8F0] bg-[#FFFFFF] flex items-center justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-[#1E293B] hover:bg-[#F8FAFC]"
          >
            Close
          </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
