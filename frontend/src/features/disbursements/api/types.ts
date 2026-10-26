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
}

export interface DisbursementAuditLog {
  id: string;
  disbursement_id: string;
  action: string;
  actor_id?: string | null;
  actor_name?: string | null;
  previous_status?: string | null;
  new_status?: string | null;
  details?: Record<string, unknown> | null;
  created_at: string;
}

export interface Disbursement {
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
  clients?: DisbursementClient | null;
  client_name?: string | null;
  clientName?: string | null;
  audit_logs?: DisbursementAuditLog[];
  linked_work_request_name?: string | null;
  linked_work_request_order_number?: string | null;
  employee_name?: string | null;
  employeeName?: string | null;
  requested_by_name?: string | null;
  requestedByName?: string | null;
  created_by_name?: string | null;
  createdByName?: string | null;
  approved_by_name?: string | null;
  approvedByName?: string | null;
  released_by_name?: string | null;
  releasedByName?: string | null;
  rejected_by_name?: string | null;
  rejectedByName?: string | null;
  edited_by_accounting?: boolean | null;
}

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
}

/**
 * Payload for POST /v1/disbursements/:id/release
 */
export interface ReleasePaymentInput {
  method?: string;
  reference?: string;
  bank?: string;
  date?: string;
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
  meta: {
    total: number;
    page: number;
    limit: number;
  };
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
