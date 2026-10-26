/**
 * TanStack Query Hooks for Documents (DMS) Module (Module #7)
 *
 * Citation: Frozen API Contract documents@2.0.0 (docs/api-contracts/modules/documents.md)
 * Metadata actions use blocking execution; collaborative comments use inline async state.
 */

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api';
import { useSessionStore } from '@/lib/session';
import { runBlockingAction } from '@/features/operations/components/BlockingActionModal';
import { documentKeys } from './queryKeys';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import {
  MAX_FILE_SIZE_BYTES,
  createDocumentSchema,
  updateDocumentSchema,
  lifecycleSchema,
} from './schemas';
import type {
  DmsDocument,
  DocumentCounts,
  DocumentCountsResponse,
  DocumentListResponse,
  DocumentDetailResponse,
  CreateDocumentResponse,
  DownloadUrlResponse,
  DocumentFilterParams,
  UpdateDocumentInput,
  DocumentLifecycle,
  UploadDocumentVariables,
} from './types';

/**
 * Helper to identify and filter out disbursement receipts from DMS documents.
 * Disbursement receipts belong exclusively to the disbursements workflow.
 */
export function isDisbursementReceiptDocument(doc: {
  storage_path?: string | null;
  category?: string | null;
  document_type?: string | null;
  original_name?: string | null;
  file_name?: string | null;
}): boolean {
  if (!doc) return false;
  const path = (doc.storage_path || '').toLowerCase();
  if (path.includes('/disbursements/receipts/') || path.includes('/disbursements/')) return true;
  const cat = (doc.category || '').toLowerCase();
  if (['receipt', 'receipts', 'disbursement', 'disbursement_receipt'].includes(cat)) return true;
  const type = (doc.document_type || '').toLowerCase();
  if (type === 'disbursement_receipt' || type === 'disbursement receipt') return true;
  return false;
}

// ============================================================================
// 1. Data Query Hooks
// ============================================================================

/**
 * 1. Fetch filtered and paginated documents list for active entity.
 * Endpoint: GET /v1/documents
 */
export function useDocumentsList(
  filters?: DocumentFilterParams,
  options?: { enabled?: boolean }
) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery({
    queryKey: documentKeys.list(activeEntity, filters),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.category) params.append('category', String(filters.category));
      if (filters?.status) params.append('status', String(filters.status));
      if (filters?.lifecycle) params.append('lifecycle', String(filters.lifecycle));
      if (filters?.clientId) params.append('clientId', String(filters.clientId));
      if (filters?.workRequestId) params.append('workRequestId', String(filters.workRequestId));
      if (filters?.linkedTaskId) params.append('linkedTaskId', String(filters.linkedTaskId));
      if (filters?.search) params.append('search', String(filters.search));
      if (filters?.archived !== undefined) params.append('archived', String(filters.archived));
      if (filters?.page) params.append('page', String(filters.page));
      if (filters?.limit) params.append('limit', String(filters.limit));
      params.append('_t', String(Date.now()));

      const queryStr = params.toString();
      const path = `/documents${queryStr ? `?${queryStr}` : ''}`;
      const res = await apiRequest<DocumentListResponse>(path);
      if (res && Array.isArray(res.data)) {
        const filtered = res.data.filter((doc) => !isDisbursementReceiptDocument(doc));
        return {
          ...res,
          data: filtered,
          meta: res.meta
            ? { ...res.meta, total: Math.min(res.meta.total ?? filtered.length, filtered.length) }
            : res.meta,
        };
      }
      return res;
    },
    placeholderData: keepPreviousData,
    enabled: options?.enabled ?? true,
  });
}

/**
 * 2. Fetch active vs. archived tab badge counts for active entity.
 * Endpoint: GET /v1/documents/counts
 */
export function useDocumentCounts(options?: { enabled?: boolean }) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  return useQuery<DocumentCounts>({
    queryKey: documentKeys.counts(activeEntity),
    queryFn: async () => {
      const res = await apiRequest<DocumentCountsResponse>(`/documents/counts?_t=${Date.now()}`);
      return res.data;
    },
    enabled: options?.enabled ?? true,
    staleTime: 0,
  });
}

/**
 * 3. Fetch full metadata for a single document.
 * Endpoint: GET /v1/documents/:id
 */
export function useDocumentDetail(
  id: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery<DmsDocument>({
    queryKey: documentKeys.detail(id),
    queryFn: async () => {
      if (!id) throw new Error('Document ID is required');
      const res = await apiRequest<DocumentDetailResponse>(`/documents/${id}?_t=${Date.now()}`);
      return res.data;
    },
    enabled: Boolean(id) && (options?.enabled ?? true),
  });
}

/**
 * 4. Fetch 300-second pre-signed download URL for a stored document.
 * Endpoint: GET /v1/documents/:id/download-url
 */
export function useDocumentDownloadUrl(
  id: string | undefined,
  options?: { enabled?: boolean }
) {
  return useQuery<{ url: string; fileName: string; contentType?: string }>({
    queryKey: documentKeys.downloadUrl(id),
    queryFn: async () => {
      if (!id) throw new Error('Document ID is required');
      const res = await apiRequest<DownloadUrlResponse>(
        `/documents/${id}/download-url?_t=${Date.now()}`
      );
      return res.data;
    },
    enabled: Boolean(id) && (options?.enabled ?? true),
    staleTime: 5 * 60 * 1000, // 5 minutes cache per contract
  });
}

// ============================================================================
// 2. Mutation Hooks (Zero Optimistic Updates Doctrine)
// ============================================================================

/**
 * 5. 3-step signed upload pipeline wrapped in runBlockingAction.
 * Step 1: POST /v1/documents
 * Step 2: direct PUT to pre-signed URL (if provided)
 * Step 3: POST /v1/documents/:id/confirm-upload
 */
export function useUploadDocument() {
  const queryClient = useQueryClient();

  return useMutation<DmsDocument, ApiError, UploadDocumentVariables>({
    mutationFn: async ({ file, metadata = {} }) => {
      // Client-side guard: enforce 50 MB limit
      if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new ApiError(
          400,
          'Bad Request',
          `File size exceeds maximum allowed limit of ${MAX_FILE_SIZE_BYTES} bytes`,
          'VALIDATION_ERROR'
        );
      }

      const uploadPayload = {
        fileName: metadata.fileName || file.name,
        contentType: file.type || 'application/octet-stream',
        fileSize: file.size,
        originalName: metadata.originalName || file.name,
        workRequestId: metadata.workRequestId,
        linkedTaskId: metadata.linkedTaskId,
        clientId: metadata.clientId,
        documentType: metadata.documentType,
        category: metadata.category ?? 'Others',
        description: metadata.description,
        externalUrl: metadata.externalUrl,
      };

      // Validate metadata schema
      createDocumentSchema.parse(uploadPayload);

      return runBlockingAction<DmsDocument>({
        title: 'Uploading Document',
        message: `Uploading ${uploadPayload.originalName}...`,
        actionName: 'document.upload',
        invalidateQueries: [documentKeys.all],
        apiCall: async () => {
          // Step 1: Register metadata
          const initRes = await apiRequest<CreateDocumentResponse>('/documents', {
            method: 'POST',
            body: JSON.stringify(uploadPayload),
          });

          const { document, uploadUrl } = initRes.data;

          // If external URL or no upload URL returned, document is already active
          if (!uploadUrl) {
            return document;
          }

          // Step 2: Binary transfer directly to storage
          const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type || 'application/octet-stream',
            },
            body: file,
          });

          if (!uploadRes.ok) {
            throw new ApiError(
              uploadRes.status,
              uploadRes.statusText,
              'Failed to upload document binary to cloud storage',
              'STORAGE_ERROR'
            );
          }

          // Step 3: Confirm storage upload completion
          const confirmRes = await apiRequest<{ data: DmsDocument }>(
            `/documents/${document.id}/confirm-upload`,
            {
              method: 'POST',
            }
          );

          return confirmRes.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      queryClient.refetchQueries({ queryKey: documentKeys.all });
    },
  });
}

/**
 * 6. Update document metadata, locations, comments, or versions.
 * Endpoint: PUT /v1/documents/:id
 */
export function useUpdateDocument() {
  const queryClient = useQueryClient();

  return useMutation<
    DmsDocument,
    ApiError,
    { id: string; data: UpdateDocumentInput }
  >({
    mutationFn: async ({ id, data }) => {
      const validated = updateDocumentSchema.parse(data);

      return runBlockingAction<DmsDocument>({
        title: 'Updating Document',
        message: 'Saving document changes...',
        actionName: 'document.update',
        invalidateQueries: [documentKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: DmsDocument }>(`/documents/${id}`, {
            method: 'PUT',
            body: JSON.stringify(validated),
          });
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      queryClient.refetchQueries({ queryKey: documentKeys.all });
    },
  });
}

/**
 * 7. Transition physical lifecycle stage.
 * Endpoint: PUT /v1/documents/:id/lifecycle
 * Guarded by dms:handover.
 */
export function useLifecycleTransition() {
  const queryClient = useQueryClient();

  return useMutation<
    DmsDocument,
    ApiError,
    { id: string; lifecycle: DocumentLifecycle }
  >({
    mutationFn: async ({ id, lifecycle }) => {
      lifecycleSchema.parse({ lifecycle });

      return runBlockingAction<DmsDocument>({
        title: 'Updating Lifecycle Stage',
        message: `Transitioning stage to "${lifecycle}"...`,
        actionName: 'document.lifecycle',
        invalidateQueries: [documentKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: DmsDocument }>(
            `/documents/${id}/lifecycle`,
            {
              method: 'PUT',
              body: JSON.stringify({ lifecycle }),
            }
          );
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      queryClient.refetchQueries({ queryKey: documentKeys.all });
    },
  });
}

/**
 * 8. Archive a document (sets archived = true).
 * Endpoint: POST /v1/documents/:id/archive
 * Guarded by dms:edit.
 */
export function useArchiveDocument() {
  const queryClient = useQueryClient();

  return useMutation<DmsDocument, ApiError, string | { id: string }>({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;

      return runBlockingAction<DmsDocument>({
        title: 'Archiving Document',
        message: 'Moving document to archive...',
        actionName: 'document.archive',
        invalidateQueries: [documentKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: DmsDocument }>(
            `/documents/${id}/archive`,
            {
              method: 'POST',
            }
          );
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      queryClient.refetchQueries({ queryKey: documentKeys.all });
    },
  });
}

/**
 * 9. Unarchive / Restore a document (sets archived = false).
 * Endpoint: POST /v1/documents/:id/unarchive
 * Guarded by dms:edit.
 */
export function useUnarchiveDocument() {
  const queryClient = useQueryClient();

  return useMutation<DmsDocument, ApiError, string | { id: string }>({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;

      return runBlockingAction<DmsDocument>({
        title: 'Restoring Document',
        message: 'Restoring document from archive...',
        actionName: 'document.unarchive',
        invalidateQueries: [documentKeys.all],
        apiCall: async () => {
          const res = await apiRequest<{ data: DmsDocument }>(
            `/documents/${id}/unarchive`,
            {
              method: 'POST',
            }
          );
          return res.data;
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      queryClient.refetchQueries({ queryKey: documentKeys.all });
    },
  });
}

/**
 * 10. Soft-delete document (sets deleted_at = now()).
 * Endpoint: DELETE /v1/documents/:id
 * Guarded by dms:delete.
 */
export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, string | { id: string }>({
    mutationFn: async (arg) => {
      const id = typeof arg === 'string' ? arg : arg.id;

      return runBlockingAction<void>({
        title: 'Deleting Document',
        message: 'Permanently removing document...',
        actionName: 'document.delete',
        invalidateQueries: [documentKeys.all],
        apiCall: async () => {
          await apiRequest<void>(`/documents/${id}`, {
            method: 'DELETE',
          });
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.all });
      queryClient.refetchQueries({ queryKey: documentKeys.all });
    },
  });
}

// Comments use inline pending/error states; they never open BlockingActionModal.
type CommentVariables = { id: string; text?: string; commentId?: string };
function useDocumentCommentMutation<T extends CommentVariables>(method: 'POST' | 'PUT' | 'DELETE') {
  const queryClient = useQueryClient();
  return useMutation<DmsDocument, ApiError, T>({
    mutationFn: async ({ id, commentId, text }) => {
      const suffix = method === 'POST' ? '' : `/${encodeURIComponent(commentId!)}`;
      const result = await apiRequest<DocumentDetailResponse>(
        `/documents/${id}/comments${suffix}`,
        { method, ...(method !== 'DELETE' ? { body: JSON.stringify({ text }) } : {}) }
      );
      return result.data;
    },
    onSuccess: async (_document, { id }) => {
      // Refetch instead of replacing with a response that may precede a newer CDC event.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: documentKeys.detail(id) }),
        queryClient.invalidateQueries({ queryKey: documentKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: operationsKeys.documents() }),
      ]);
    },
  });
}
export function useAddDocumentComment() { return useDocumentCommentMutation<{ id: string; text: string }>('POST'); }
export function useEditDocumentComment() { return useDocumentCommentMutation<{ id: string; commentId: string; text: string }>('PUT'); }
export function useDeleteDocumentComment() { return useDocumentCommentMutation<{ id: string; commentId: string }>('DELETE'); }
