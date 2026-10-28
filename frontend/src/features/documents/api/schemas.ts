/**
 * Zod validation schemas for Documents (DMS) Module (Module #7)
 *
 * Citation: Frozen API Contract documents@2.0.0 (docs/api-contracts/modules/documents.md)
 */

import { z } from 'zod';
import {
  DOCUMENT_CATEGORIES,
  ALL_DOCUMENT_CATEGORIES,
  DOCUMENT_LIFECYCLE_STAGES,
  DOCUMENT_STATUSES,
} from './types';

export {
  DOCUMENT_CATEGORIES,
  ALL_DOCUMENT_CATEGORIES,
  DOCUMENT_LIFECYCLE_STAGES,
  DOCUMENT_STATUSES,
};

export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB (52,428,800 bytes)

export const handoverLogEntrySchema = z.object({
  handed_to: z.string().min(1, 'Recipient name is required'),
  handed_date: z.string().min(1, 'Handed date is required'),
  method: z.string().min(1, 'Method is required'),
  notes: z.string().optional(),
});

export const documentCommentSchema = z.object({
  id: z.string().optional(),
  userId: z.string().min(1, 'User ID is required'),
  user_id: z.string().optional(),
  userName: z.string().optional(),
  user_name: z.string().optional(),
  author: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  created_at: z.string().optional(),
  text: z.string().min(1, 'Comment text cannot be empty'),
});

export const documentVersionSchema = z.object({
  version: z.number().int().min(1),
  fileName: z.string().min(1),
  uploader: z.string().min(1),
  uploadDate: z.string().min(1),
});

export const createDocumentSchema = z.object({
  fileName: z.string().min(1, 'File name is required').max(255),
  contentType: z.string().min(1).max(100).nullable().optional(),
  fileSize: z
    .number()
    .int()
    .min(0)
    .max(
      MAX_FILE_SIZE_BYTES,
      `File size exceeds maximum allowed limit of ${MAX_FILE_SIZE_BYTES} bytes`
    )
    .nullable()
    .optional(),
  originalName: z.string().max(255).optional(),
  workRequestId: z.string().uuid('Work request is required'),
  linkedTaskId: z.string().uuid('A valid linked task is required'),
  taskId: z.string().uuid('Invalid task ID').nullable().optional(),
  task_id: z.string().uuid('Invalid task ID').nullable().optional(),
  clientId: z.string().uuid('Invalid client ID').nullable().optional(),
  documentType: z.string().max(100).optional(),
  category: z.enum(ALL_DOCUMENT_CATEGORIES).optional(),
  description: z.string().max(2000).optional(),
  externalUrl: z.string().max(2000).nullable().optional(),
});

export const updateDocumentSchema = z.object({
  documentType: z.string().max(100).optional(),
  category: z.enum(ALL_DOCUMENT_CATEGORIES).optional(),
  description: z.string().max(2000).optional(),
  linkedTaskId: z.string().uuid('Invalid task ID').nullable().optional(),
  externalUrl: z.string().max(2000).nullable().optional(),
  scannedBy: z.string().max(255).optional(),
  envelopeId: z.string().max(100).optional(),
  storedLocation: z.string().max(255).optional(),
  handoverLog: z.array(handoverLogEntrySchema).optional(),
  archived: z.boolean().optional(),
  comments: z.array(documentCommentSchema).optional(),
  versions: z.array(documentVersionSchema).optional(),
});

export const lifecycleSchema = z.object({
  lifecycle: z.enum(DOCUMENT_LIFECYCLE_STAGES),
});

export const documentFilterParamsSchema = z.object({
  category: z.enum(ALL_DOCUMENT_CATEGORIES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  lifecycle: z.enum(DOCUMENT_LIFECYCLE_STAGES).optional(),
  clientId: z.string().uuid().optional(),
  workRequestId: z.string().uuid().optional(),
  linkedTaskId: z.string().uuid().optional(),
  search: z.string().optional(),
  archived: z.union([z.boolean(), z.string()]).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

export const documentCountsSchema = z.object({
  data: z.object({
    active: z.number().int().min(0),
    archived: z.number().int().min(0),
  }),
});

export const documentItemSchema = z.object({
  id: z.string().uuid(),
  file_name: z.string(),
  original_name: z.string(),
  work_request_id: z.string().uuid().nullable().optional(),
  linked_task_id: z.string().uuid().nullable().optional(),
  client_id: z.string().uuid().nullable().optional(),
  document_type: z.string().nullable().optional(),
  category: z.enum(ALL_DOCUMENT_CATEGORIES).nullable().optional(),
  uploader_id: z.string(),
  description: z.string().nullable().optional(),
  entity_id: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  document_lifecycle: z.enum(DOCUMENT_LIFECYCLE_STAGES),
  archived: z.boolean(),
  file_size: z.number().int().nullable().optional(),
  content_type: z.string().nullable().optional(),
  storage_path: z.string().nullable().optional(),
  external_url: z.string().nullable().optional(),
  scanned_by: z.string().nullable().optional(),
  envelope_id: z.string().nullable().optional(),
  stored_location: z.string().nullable().optional(),
  handover_log: z.array(handoverLogEntrySchema).default([]),
  comments: z.array(documentCommentSchema).default([]),
  versions: z.array(documentVersionSchema).default([]),
  upload_date: z.string().nullable().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
  fileName: z.string().optional(),
  originalName: z.string().optional(),
  workRequestId: z.string().uuid().nullable().optional(),
  linkedTaskId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  documentType: z.string().nullable().optional(),
  fileSize: z.number().int().nullable().optional(),
  contentType: z.string().nullable().optional(),
  externalUrl: z.string().nullable().optional(),
  uploaderId: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const documentListResponseSchema = z.object({
  data: z.array(documentItemSchema),
  meta: z.object({
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
  }),
});

export const documentDetailResponseSchema = z.object({
  data: documentItemSchema,
});

export const createDocumentResponseSchema = z.object({
  data: z.object({
    document: documentItemSchema,
    uploadUrl: z.string().nullable(),
  }),
});

export const downloadUrlResponseSchema = z.object({
  data: z.object({
    url: z.string().url(),
    fileName: z.string(),
    contentType: z.string().optional(),
  }),
});

/**
 * Sanitizes raw filenames according to documents@2.0.0 §1
 */
export function sanitizeFileName(rawName: string): string {
  const lower = rawName.toLowerCase();
  const replacedSpaces = lower.replace(/\s+/g, '-');
  const stripped = replacedSpaces.replace(/[^a-z0-9._-]/g, '');
  const collapsed = stripped.replace(/-+/g, '-');
  return collapsed.slice(0, 200);
}

export interface StoragePathParams {
  entityCode: string;
  documentId: string;
  safeName: string;
  clientId?: string | null;
  workRequestId?: string | null;
}

/**
 * Computes deterministic storage paths per documents@2.0.0 §1
 */
export function computeStoragePath(params: StoragePathParams): string {
  const { entityCode, documentId, safeName, clientId, workRequestId } = params;
  if (clientId) {
    return `entities/${entityCode}/clients/${clientId}/documents/${documentId}/${safeName}`;
  }
  if (workRequestId) {
    return `entities/${entityCode}/work-requests/${workRequestId}/documents/${documentId}/${safeName}`;
  }
  return `entities/${entityCode}/general/documents/${documentId}/${safeName}`;
}
