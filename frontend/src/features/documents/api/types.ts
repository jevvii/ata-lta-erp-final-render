/**
 * TypeScript Type Definitions for Documents (DMS) Module (Module #7)
 *
 * Citation: Frozen API Contract documents@2.0.0 (docs/api-contracts/modules/documents.md)
 */

export const DOCUMENT_CATEGORIES = [
  'Owner Details',
  'Business Details',
  'SEC',
  'City Hall',
  'BIR',
  'SSS',
  'PhilHealth',
  'Pag-IBIG',
  'IPO',
  'FDA',
  'Labor',
  'Others',
] as const;

export const LEGACY_DOCUMENT_CATEGORIES = [
  'CONTRACT',
  'PERMIT',
  'FINANCIAL',
  'CORRESPONDENCE',
  'LEGAL',
  'HR',
  'OTHER',
] as const;

export const ALL_DOCUMENT_CATEGORIES = [
  ...DOCUMENT_CATEGORIES,
  ...LEGACY_DOCUMENT_CATEGORIES,
] as const;

export type DocumentCategory =
  | (typeof DOCUMENT_CATEGORIES)[number]
  | (typeof LEGACY_DOCUMENT_CATEGORIES)[number];

export const DOCUMENT_LIFECYCLE_STAGES = [
  'collected',
  'with_documentations',
  'scanned',
  'in_envelope',
  'stored',
] as const;

export type DocumentLifecycle = (typeof DOCUMENT_LIFECYCLE_STAGES)[number];

export const DOCUMENT_STATUSES = ['pending_upload', 'active', 'failed'] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export interface HandoverEntry {
  handed_to: string;
  handed_date: string;
  method: string;
  notes?: string;
}

export interface DmsDocumentComment {
  edited?: boolean;
  edited_at?: string;
  id?: string;
  userId: string;
  user_id?: string;
  userName?: string;
  user_name?: string;
  author?: string;
  date: string;
  created_at?: string;
  text: string;
}

export type DocumentComment = DmsDocumentComment;

export interface DmsDocumentVersion {
  version: number;
  fileName: string;
  uploader: string;
  uploadDate: string;
}

export interface DmsDocument {
  /** Caller-specific comment authorization returned by document detail. */
  can_comment?: boolean;
  id: string;
  file_name: string;
  original_name: string;
  work_request_id: string | null;
  linked_task_id: string | null;
  client_id: string | null;
  document_type: string | null;
  category: DocumentCategory | null;
  uploader_id: string;
  description: string | null;
  entity_id: string;
  status: DocumentStatus;
  document_lifecycle: DocumentLifecycle;
  archived: boolean;
  file_size: number | null;
  content_type: string | null;
  storage_path: string | null;
  external_url: string | null;
  scanned_by?: string | null;
  envelope_id?: string | null;
  stored_location?: string | null;
  handover_log?: HandoverEntry[];
  comments: DmsDocumentComment[];
  versions: DmsDocumentVersion[];
  uploader_name?: string | null;
  work_request_title?: string | null;
  linked_task_title?: string | null;
  upload_date?: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;

  // Compatibility aliases
  fileName?: string;
  originalName?: string;
  uploaderName?: string | null;
  workRequestId?: string | null;
  linkedTaskId?: string | null;
  clientId?: string | null;
  documentType?: string | null;
  fileSize?: number | null;
  contentType?: string | null;
  externalUrl?: string | null;
  uploaderId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type DocumentItem = DmsDocument;

export interface DocumentFilterParams {
  category?: DocumentCategory | string;
  status?: DocumentStatus | string;
  lifecycle?: DocumentLifecycle | string;
  clientId?: string;
  workRequestId?: string;
  linkedTaskId?: string;
  search?: string;
  archived?: boolean;
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

export type DocumentFilters = DocumentFilterParams;

export interface DocumentCounts {
  active: number;
  archived: number;
}

export interface DocumentCountsResponse {
  data: DocumentCounts;
}

export interface DocumentListMeta {
  total: number;
  page: number;
  limit: number;
}

export interface DocumentListResponse {
  data: DmsDocument[];
  meta: DocumentListMeta;
}

export interface DocumentDetailResponse {
  data: DmsDocument;
}

export interface CreateDocumentInput {
  fileName: string;
  contentType?: string | null;
  fileSize?: number | null;
  originalName?: string;
  workRequestId?: string | null;
  linkedTaskId?: string | null;
  clientId?: string | null;
  documentType?: string;
  category?: DocumentCategory;
  description?: string;
  externalUrl?: string | null;
}

export interface CreateDocumentResponse {
  data: {
    document: DmsDocument;
    uploadUrl: string | null;
  };
}

export interface DownloadUrlResponse {
  data: {
    url: string;
    fileName: string;
    contentType?: string;
  };
}

export interface UpdateDocumentInput {
  documentType?: string;
  category?: DocumentCategory;
  description?: string;
  linkedTaskId?: string | null;
  externalUrl?: string | null;
  scannedBy?: string;
  envelopeId?: string;
  storedLocation?: string;
  handoverLog?: HandoverEntry[];
  archived?: boolean;
  comments?: DmsDocumentComment[];
  versions?: DmsDocumentVersion[];
}

export interface UpdateLifecycleInput {
  lifecycle: DocumentLifecycle;
}

export interface UploadDocumentVariables {
  file: File;
  metadata?: Partial<CreateDocumentInput>;
}
