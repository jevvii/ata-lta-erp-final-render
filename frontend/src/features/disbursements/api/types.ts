import type { DisbursementPrintDetails } from '@/lib/disbursementDocument';
/**
 * TypeScript Domain Models & Interface Contracts for Disbursements (Module #4)
 *
 * Citation: Frozen API Contract disbursements@2.0.0 (docs/api-contracts/modules/disbursements.md)
 *
 * Compliance:
 * - Strict TypeScript 5.7+
 * - noUncheckedIndexedAccess: true compliant
 * - Zero backend imports
 * - Zero `any` types
 */

// ============================================================================
// 1. Domain Enums and Union Types
// ============================================================================

export type DisbursementStatus =
  | 'Draft'
  | 'Submitted'
  | 'Pending'
  | 'Pending Admin Approval'
  | 'Approved'
  | 'Released'
  | 'Funded'
  | 'Rejected'
  | 'Archived'
  | 'Cancelled';

export type FundSource = 'Firm Fund' | 'Client Fund';

export type DisbursementCategory =
  | 'Professional Fee'
  | 'Government Fee'
  | 'Supplies'
  | 'Transportation'
  | 'Meals'
  | 'Communication'
  | 'Printing'
  | 'Notarial'
  | 'Filing Fee'
  | 'Representation'
  | 'Miscellaneous'
  | 'Other';

export type EntityCode = 'ATA' | 'LTA' | 'ALL';

// ============================================================================
// 2. Core Domain Entity
// ============================================================================

export interface DisbursementClient {
  id?: string;
  name: string;
  address?: string | null;
  tin?: string | null;
  client_number?: string | null;
  clientNumber?: string | null;
}

export interface DisbursementAuditLog {
  id: string;
  disbursement_id: string;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  previous_status?: string | null;
  new_status?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

export interface Disbursement {
  print_details?: DisbursementPrintDetails | null;
  id: string;
  disbursement_number?: string | null;
  disbursementNumber?: string | null;
  entity_id: string;
  entityId?: string;
  entity_code?: string;
  entityCode?: string;
  category: DisbursementCategory | string;
  description: string;
  amount: number;
  fund_source: FundSource;
  fundSource?: FundSource;
  status: DisbursementStatus;
  linked_work_request_id: string;
  linkedWorkRequestId?: string;
  linked_invoice_id?: string | null;
  linkedInvoiceId?: string | null;
  linked_task_id?: string | null;
  linkedTaskId?: string | null;
  linked_transmittal_id?: string | null;
  linkedTransmittalId?: string | null;
  client_id?: string | null;
  clientId?: string | null;
  employee_id?: string | null;
  employeeId?: string | null;
  requested_by?: string | null;
  requestedBy?: string | null;
  due_date?: string | null;
  dueDate?: string | null;
  approved_by?: string | null;
  approvedBy?: string | null;
  approved_at?: string | null;
  approvedAt?: string | null;
  released_by?: string | null;
  releasedBy?: string | null;
  released_at?: string | null;
  releasedAt?: string | null;
  funded_by?: string | null;
  fundedBy?: string | null;
  funded_at?: string | null;
  fundedAt?: string | null;
  rejected_by?: string | null;
  rejectedBy?: string | null;
  rejected_at?: string | null;
  rejectedAt?: string | null;
  rejection_reason?: string | null;
  rejectionReason?: string | null;
  payment_method?: string | null;
  paymentMethod?: string | null;
  payment_reference?: string | null;
  paymentReference?: string | null;
  payment_bank?: string | null;
  paymentBank?: string | null;
  payment_date?: string | null;
  paymentDate?: string | null;
  payment_processed_by?: string | null;
  paymentProcessedBy?: string | null;
  receipt_s3_key?: string | null;
  receiptS3Key?: string | null;
  receipt_filename?: string | null;
  receiptFilename?: string | null;
  archived?: boolean;
  archived_at?: string | null;
  archivedAt?: string | null;
  archived_by?: string | null;
  archivedBy?: string | null;
  notes?: string | null;
  version: number;
  created_at: string;
  createdAt?: string;
  updated_at: string;
  updatedAt?: string;
  created_by?: string | null;
  createdBy?: string | null;
  updated_by?: string | null;
  updatedBy?: string | null;
  deleted_at?: string | null;
  deletedAt?: string | null;
  client_number?: string | null;
  clientNumber?: string | null;
  work_request_number?: string | null;
  workRequestNumber?: string | null;
  clients?: DisbursementClient | null;
  client_name?: string | null;
  clientName?: string | null;
  audit_logs?: DisbursementAuditLog[];
  lifecycle_version?: number;
  lifecycleVersion?: number;
  review_ready?: boolean;
  reviewReady?: boolean;
  funded_by_name?: string | null;
  funded_by_role?: string | null;
  fundedByName?: string | null;
  payment_processed_by_name?: string | null;
  paymentProcessedByName?: string | null;
  lifecycle_history?: DisbursementLifecycleEvent[];
  lifecycleHistory?: DisbursementLifecycleEvent[];
  linked_work_request_name?: string | null;
  linked_work_request_order_number?: string | null;
  employee_name?: string | null;
  employeeName?: string | null;
  requested_by_name?: string | null;
  requestedByName?: string | null;
  created_by_name?: string | null;
  created_by_role?: string | null;
  createdByName?: string | null;
  approved_by_name?: string | null;
  approved_by_role?: string | null;
  approvedByName?: string | null;
  released_by_name?: string | null;
  released_by_role?: string | null;
  releasedByName?: string | null;
  rejected_by_name?: string | null;
  rejected_by_role?: string | null;
  rejectedByName?: string | null;
  edited_by_accounting?: boolean | null;
}

export interface DisbursementLifecycleEvent {
  id?: string;
  disbursement_id?: string;
  disbursementId?: string;
  from_status?: string | null;
  fromStatus?: string | null;
  to_status?: string | null;
  toStatus?: string | null;
  action?: string;
  actor_id?: string | null;
  actorId?: string | null;
  actor_name?: string | null;
  actorName?: string | null;
  actor_role?: string | null;
  actorRole?: string | null;
  actor_avatar_url?: string | null;
  actorAvatarUrl?: string | null;
  reason?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
  createdAt?: string;
  old_status?: string | null;
  new_status?: string | null;
  timestamp?: string | null;
  notes?: string | null;
}

export type DisbursementAuditEvent = DisbursementLifecycleEvent;

export type DisbursementQueue =
  | 'initial_requests'
  | 'payment_releases'
  | 'ready_for_funding'
  | 'needs_correction';

// ============================================================================
// 3. Disbursement Template Entity
// ============================================================================

export interface DisbursementTemplate {
  id: string;
  entity_id: string;
  entityId?: string;
  name: string;
  category: DisbursementCategory | string;
  amount: number;
  fund_source?: FundSource | null;
  fundSource?: FundSource | null;
  schedule?: string | null;
  description?: string | null;
  linked_work_request_id?: string | null;
  linkedWorkRequestId?: string | null;
  linked_invoice_id?: string | null;
  linkedInvoiceId?: string | null;
  linked_transmittal_id?: string | null;
  linkedTransmittalId?: string | null;
  created_by?: string | null;
  createdBy?: string | null;
  created_at: string;
  createdAt?: string;
  updated_at: string;
  updatedAt?: string;
  deleted_at?: string | null;
  deletedAt?: string | null;
}

// ============================================================================
// 4. Query Filter & Pagination Parameters
// ============================================================================

export interface DisbursementFilters {
  status?: DisbursementStatus;
  category?: string;
  fundSource?: FundSource;
  linkedTaskId?: string;
  linkedTransmittalId?: string;
  search?: string;
  archived?: boolean | string;
  queue?: 'initial_requests' | 'payment_releases' | 'ready_for_funding' | 'needs_correction';
  page?: number;
  limit?: number;
}

// ============================================================================
// 5. Request Input Payloads
// ============================================================================

/**
 * Payload for POST /v1/disbursements
 * Anti-forgery guard: status MUST NOT be included.
 */
export interface CreateDisbursementInput {
  disbursementNumber?: string | null;
  disbursement_number?: string | null;
  clientNumber?: string | null;
  client_number?: string | null;
  workRequestNumber?: string | null;
  work_request_number?: string | null;
  category: DisbursementCategory | string;
  description: string;
  amount: number;
  fundSource: FundSource;
  linkedWorkRequestId: string;
  clientId?: string | null;
  employeeId?: string | null;
  linkedInvoiceId?: string | null;
  linkedTaskId?: string | null;
  linkedTransmittalId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  receiptS3Key?: string | null;
  receiptFilename?: string | null;
  /** Anti-forgery compile-time guard: explicitly forbidden */
  status?: never;
}

/**
 * Payload for PUT /v1/disbursements/:id
 */
export interface UpdateDisbursementInput {
  disbursementNumber?: string | null;
  disbursement_number?: string | null;
  clientNumber?: string | null;
  client_number?: string | null;
  workRequestNumber?: string | null;
  work_request_number?: string | null;
  printDetails?: DisbursementPrintDetails;
  category?: DisbursementCategory | string;
  description?: string;
  amount?: number;
  fundSource?: FundSource;
  linkedWorkRequestId?: string;
  clientId?: string | null;
  employeeId?: string | null;
  linkedInvoiceId?: string | null;
  linkedTaskId?: string | null;
  linkedTransmittalId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  receiptS3Key?: string | null;
  receiptFilename?: string | null;
  archived?: boolean;
  expectedVersion?: number;
}

/**
 * Payload for POST /v1/disbursements/:id/reject
 */
export interface RejectDisbursementInput {
  reason: string;
  expectedVersion?: number;
}

/**
 * Payload for POST /v1/disbursements/:id/release
 */
export interface ReleasePaymentInput {
  method?: string;
  reference?: string | null;
  bank?: string | null;
  date?: string;
  expectedVersion?: number;
}

export interface ReleaseDisbursementInput {
  expectedVersion: number;
}

/**
 * Payload for POST /v1/disbursements/:id/approve
 */
export interface ApproveDisbursementInput {
  expectedVersion: number;
  method?: string;
  reference?: string | null;
  bank?: string | null;
  date?: string;
}

/**
 * Payload for POST /v1/disbursements/:id/fund
 */
export interface FundDisbursementInput {
  method: string;
  bank: string;
  reference: string;
  date: string;
  expectedVersion: number;
}

/**
 * Payload for POST /v1/disbursements/:id/resend_draft
 */
export interface ResendDraftInput {
  expectedVersion: number;
}

/**
 * Payload for PATCH /v1/disbursements/:id/payment-details
 */
export interface UpdatePaymentDetailsInput {
  method: string;
  reference?: string | null;
  bank?: string | null;
  date: string;
  expectedVersion: number;
}

/**
 * Pre-signed receipt upload types
 */
export interface CreateReceiptUploadReservationInput {
  filename: string;
  contentType: 'application/pdf' | 'image/png' | 'image/jpeg' | string;
  size: number;
}

/**
 * Receipt & Voucher Target Entity Transport Options
 * Canonical entity transport: X-Active-Entity: ATA|LTA
 */
export interface ReceiptTargetOptions {
  entity?: 'ATA' | 'LTA';
}

export interface UploadReceiptOptions extends ReceiptTargetOptions {
  isCurrent?: () => boolean;
}

export type CreateDisbursementOptions = ReceiptTargetOptions;

export type CreateDisbursementMutationArg =
  | CreateDisbursementInput
  | {
      data: CreateDisbursementInput;
      entity?: 'ATA' | 'LTA';
    };

export interface ReceiptUploadReservation {
  uploadId: string;
  uploadUrl: string;
  objectKey: string;
  expiresAt: string;
}

export interface ReceiptUrlData {
  status?: 'unavailable';
  reason?: string;
  url?: string;
  filename?: string;
  contentType?: string;
  expiresAt?: string;
}

/**
 * Payload for POST /v1/disbursements/templates
 */
export interface CreateDisbursementTemplateInput {
  name: string;
  category: DisbursementCategory | string;
  amount?: number;
  fundSource?: FundSource | null;
  schedule?: string | null;
  description?: string | null;
  linkedWorkRequestId?: string | null;
  linkedInvoiceId?: string | null;
  linkedTransmittalId?: string | null;
}

// ============================================================================
// 6. API Response Wrappers & Badge Counts
// ============================================================================

export interface DisbursementListResponse {
  data: Disbursement[];
  meta?: {
    total: number;
    page: number;
    limit: number;
  };
  count?: number;
}

export interface DisbursementDetailResponse {
  data: Disbursement;
}

export interface DisbursementCounts {
  active: number;
  archived: number;
  rejected: number;
  awaitingRelease: number;
  pending?: number;
  initialRequests?: number;
  paymentReleases?: number;
  readyForFunding?: number;
  needsCorrection?: number;
}

export interface DisbursementCountsResponse {
  data: DisbursementCounts;
}

export interface DisbursementTemplatesResponse {
  data: DisbursementTemplate[];
}

export interface DisbursementTemplateDetailResponse {
  data: DisbursementTemplate;
}
