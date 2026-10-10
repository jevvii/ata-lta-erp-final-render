/**
 * TypeScript Domain Models & Interface Contracts for Operations (Module #1)
 *
 * Citation: Frozen API Contract operations@2.0.0 (docs/api-contracts/modules/operations.md)
 * operationsRequests@2.0.0 (docs/api-contracts/modules/operationsRequests.md)
 * retainer-templates@2.0.0 (docs/api-contracts/modules/retainer-templates.md)
 *
 * Compliance:
 * - Strict TypeScript 5.7+
 * - noUncheckedIndexedAccess: true compliant (all array/record lookups guarded or nullable)
 * - Zero `any` types
 */

// ============================================================================
// 1. Domain Enums and Union Types
// ============================================================================

export type Phase = 'pre_processing' | 'processing' | 'quality_assurance' | 'completion';

export type CreatablePhase = 'pre_processing' | 'processing';

export type TaskStatus =
  | 'Draft'
  | 'Assigned'
  | 'In Progress'
  | 'For Review'
  | 'Completed'
  | 'Cancelled';

export type WorkRequestStatus =
  | 'Received'
  | 'For Client Approval'
  | 'For Requirements'
  | 'Pending Requirements'
  | 'For Assignment'
  | 'In Progress'
  | 'For Supervisor Review'
  | 'For Billing'
  | 'For Payment'
  | 'For Submission'
  | 'For Quality Check'
  | 'Completed'
  | 'Draft'
  | 'Pre-processing'
  | 'Processing'
  | 'For Review'
  | 'Quality Assurance'
  | 'Disbursement'
  | 'On Hold'
  | 'Cancelled';

export const WORK_REQUEST_STATUS_OPTIONS: readonly WorkRequestStatus[] = [
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
] as const;

export type QaStatus = 'none' | 'passed' | 'failed';

export type EntityCode = 'ATA' | 'LTA' | 'ALL';

export type Priority = 'Low' | 'Normal' | 'Medium' | 'High' | 'Urgent';

export type RequestType =
  | 'wr_phase_transition'
  | 'billing'
  | 'disbursement'
  | 'transmittal'
  | 'client'
  | 'workflow';

export type RequestStatus = 'pending' | 'fulfilled' | 'rejected' | 'cancelled';

export type RecurrenceType = 'none' | 'annual';

export type DocumentCategory =
  | 'SEC'
  | 'BIR'
  | 'CONTRACT'
  | 'PERMIT'
  | 'FINANCIAL'
  | 'CORRESPONDENCE'
  | 'LEGAL'
  | 'HR'
  | 'OTHER';

export type DocumentLifecycle =
  | 'collected'
  | 'with_documentations'
  | 'scanned'
  | 'in_envelope'
  | 'stored';

export type DocumentStatus = 'active' | 'pending_upload' | 'failed';

// ============================================================================
// 2. Child Models & Join Entities
// ============================================================================

export interface TaskAssignee {
  id?: string;
  taskId: string;
  userId: string;
  assignedBy: string | null;
  assignedAt: string | null;
  // Dual-write legacy & join aliases
  task_id?: string;
  user_id?: string;
  assigned_by?: string | null;
  assigned_at?: string | null;
  userName?: string;
  userRole?: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  category?: string | null;
  completed: boolean;
  assigneeId?: string | null;
  assigneeName?: string | null;
  dependsOn?: string | null;
  periodYear?: string | null;
  timeLogs?: TaskTimeLog[];
}

export interface TaskTimeLog {
  id: string;
  date: string;
  hours: number;
  startTime?: string | null;
  endTime?: string | null;
  userId?: string | null;
  note?: string | null;
  workerName?: string | null;
  checklistItemId?: string | null;
}

/** Alias to satisfy TimeLog domain model requirement */
export type TimeLog = TaskTimeLog;

export interface TaskTimeLogInput {
  id?: string;
  date: string;
  hours: number;
  startTime?: string | null;
  endTime?: string | null;
  userId?: string | null;
  note?: string | null;
  workerName?: string | null;
  checklistItemId?: string | null;
}

export interface TaskDocumentAttachment {
  documentId: string;
  fileName: string;
  uploadDate: string | null;
  uploaderId: string | null;
}

// ============================================================================
// 3. Core Task & Work Request Entities
// ============================================================================

export interface Task {
  id: string;
  workRequestId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  phase: Phase;
  qaStatus: QaStatus;
  qa_status?: QaStatus;
  phaseEnteredAt: string | null;
  phase_entered_at?: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assignees: string[]; // List of user UUIDs
  taskAssignees?: TaskAssignee[];
  task_assignees?: TaskAssignee[];
  predecessors: string[];
  dueDate: string | null;
  requiredLinkType: string | null;
  displayOrder: number;
  version: number;
  assignedBy?: string | null;
  assigned_by?: string | null;
  assignedAt?: string | null;
  assigned_at?: string | null;
  checklist?: ChecklistItem[];
  timeLogs?: TaskTimeLog[];
  taskDocuments?: TaskDocumentAttachment[];
  createdAt: string;
  updatedAt: string;
}

export interface PhaseContainer {
  tasks: Task[];
}

export interface WorkRequestPhases {
  pre_processing: PhaseContainer;
  processing: PhaseContainer;
  quality_assurance?: PhaseContainer;
  completion?: PhaseContainer;
}

export interface WorkRequest {
  id: string;
  entity: EntityCode;
  title: string;
  description: string | null;
  clientId: string | null;
  client_id?: string | null;
  clientName?: string | null;
  client_name?: string | null;
  client?: { id?: string; name: string } | null;
  status: WorkRequestStatus;
  phase: Phase;
  onHold: boolean;
  on_hold?: boolean;
  phaseEnteredAt: string | null;
  phase_entered_at?: string | null;
  priority: Priority;
  archived: boolean;
  requestedBy: string | null;
  assignedTo: string | null;
  assignedToName?: string | null;
  assigned_to_name?: string | null;
  coAssignees: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  tasks?: Task[];
  phases?: WorkRequestPhases;
}

// ============================================================================
// 4. Operations Request & Transition Entities
// ============================================================================

export interface OperationsRequestPayload {
  work_request_id?: string | null;
  workRequestId?: string | null;
  from_phase?: Phase;
  fromPhase?: Phase;
  to_phase?: Phase;
  toPhase?: Phase;
  user_notes?: string;
  [key: string]: unknown;
}

export interface OperationsRequest {
  id: string;
  entity_id: string;
  entity?: EntityCode;
  type: RequestType;
  work_request_id: string | null;
  workRequestId?: string | null;
  client_id: string | null;
  clientId?: string | null;
  linked_task_id: string | null;
  linkedTaskId?: string | null;
  requested_by: string;
  requestedBy?: string;
  requestedByName?: string | null;
  amount: number | null;
  status: RequestStatus;
  notes: string | null;
  from_phase?: Phase;
  to_phase?: Phase;
  fromPhase?: Phase;
  toPhase?: Phase;
  rejection_reason?: string | null;
  rejectionReason?: string | null;
  fulfilled_by?: string | null;
  fulfilledBy?: string | null;
  fulfilled_at?: string | null;
  fulfilledAt?: string | null;
  created_at: string;
  createdAt?: string;
  updated_at: string;
  updatedAt?: string;
  work_requests?: { title: string } | null;
  workRequestTitle?: string;
  clients?: { name: string } | null;
  clientName?: string;
  requester?: { name: string } | null;
  fulfiller?: { name: string } | null;
  payload?: OperationsRequestPayload;
}

// ============================================================================
// 5. Retainer Templates & Generation Entities
// ============================================================================

export interface RetainerTemplateTask {
  id?: string | null;
  local_id?: string | null;
  localId?: string | null;
  title: string;
  description?: string | null;
  phase: CreatablePhase;
  default_assignees?: string[];
  defaultAssignees?: string[];
  depends_on_local_id?: string | null;
  dependsOnLocalId?: string | null;
  requiredLinkType?: string | null;
  dueDate?: string | null;
}

export interface RetainerTemplate {
  id: string;
  entity_id: string;
  entity?: EntityCode;
  name: string;
  title?: string;
  description: string | null;
  client_id: string | null;
  clientId?: string | null;
  schedule: string | null;
  priority: Priority;
  default_priority?: Priority;
  defaultPriority?: Priority;
  pf_amount: number;
  pfAmount?: number;
  recurrence: RecurrenceType;
  tasks: RetainerTemplateTask[];
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface RetainerGenerationRecord {
  id: string;
  template_id: string;
  work_request_id: string;
  period_label: string | null;
  generated_by: string;
  generated_at: string;
}

// ============================================================================
// 6. DMS Document Entities
// ============================================================================

export interface DmsDocumentComment {
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
  id: string;
  file_name: string;
  fileName?: string;
  original_name: string;
  originalName?: string;
  work_request_id: string | null;
  workRequestId?: string | null;
  linked_task_id: string | null;
  linkedTaskId?: string | null;
  client_id: string | null;
  clientId?: string | null;
  document_type: string | null;
  documentType?: string | null;
  category: DocumentCategory | null;
  uploader_id: string;
  uploaderId?: string;
  description: string | null;
  entity_id: string;
  status: DocumentStatus;
  document_lifecycle: DocumentLifecycle;
  archived: boolean;
  file_size: number | null;
  fileSize?: number | null;
  content_type: string | null;
  contentType?: string | null;
  storage_path: string | null;
  external_url: string | null;
  externalUrl?: string | null;
  comments: DmsDocumentComment[];
  versions: DmsDocumentVersion[];
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  createdAt?: string;
  updatedAt?: string;
}

// ============================================================================
// 7. Input Payloads (Mutations & Actions)
// ============================================================================

export interface CreatePhaseTaskInput {
  title: string;
  description?: string | null;
  assignees?: string[];
  depends_on?: string | string[] | null;
  dependsOn?: string | string[] | null;
  local_id?: string | null;
  localId?: string | null;
  status?: string | null;
  dueDate?: string | null;
}

export type PhaseTaskInput = CreatePhaseTaskInput;

export interface CreateWorkRequestPhasesInput {
  pre_processing?: {
    tasks?: CreatePhaseTaskInput[];
  };
  processing?: {
    tasks?: CreatePhaseTaskInput[];
  };
}

export interface CreateWorkRequestInput {
  title: string;
  description?: string | null;
  clientId?: string | null;
  entity?: EntityCode;
  status?: string;
  phase?: CreatablePhase;
  requestedBy?: string;
  assignedTo?: string | null;
  coAssignees?: string[];
  dueDate?: string | null;
  priority?: Priority;
  idempotency_key?: string | null;
  idempotencyKey?: string | null;
  phases?: CreateWorkRequestPhasesInput | null;
}

export interface UpdateWorkRequestInput extends Partial<Omit<CreateWorkRequestInput, 'phases'>> {
  archived?: boolean;
  status?: WorkRequestStatus;
  expectedVersion?: number;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus | string;
  phase?: CreatablePhase;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assignees?: string[];
  dueDate?: string | null;
  displayOrder?: number;
  checklist?: Array<{
    text: string;
    category?: string | null;
    completed?: boolean;
    assigneeId?: string | null;
    periodYear?: string | null;
  }>;
  timeLogs?: Array<{
    date: string;
    hours: number;
    startTime?: string | null;
    endTime?: string | null;
    note?: string | null;
  }>;
  coAssignees?: string[] | null;
  requiredLinkType?: string | null;
  predecessors?: string[] | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus | string;
  phase?: never; // Permanently immutable once created (TASK_PHASE_IMMUTABLE)
  assigneeId?: string | null;
  assigneeName?: string | null;
  assignees?: string[];
  predecessors?: string[] | null;
  dueDate?: string | null;
  displayOrder?: number;
  expectedVersion?: number;
  checklist?: Array<{
    id?: string | null;
    text: string;
    category?: string | null;
    completed?: boolean;
    assigneeId?: string | null;
    periodYear?: string | null;
  }>;
  timeLogs?: Array<{
    date: string;
    hours: number;
    startTime?: string | null;
    endTime?: string | null;
    note?: string | null;
  }>;
  coAssignees?: string[] | null;
  requiredLinkType?: string | null;
}

export type AdvancePhaseTarget = 'processing' | 'quality_assurance' | 'completion';

export interface AdvancePhaseInput {
  to_phase?: AdvancePhaseTarget;
  toPhase?: AdvancePhaseTarget;
}

export interface TransitionRequestInput {
  request_type: 'wr_phase_transition';
  work_request_id: string;
  from_phase: 'pre_processing' | 'processing' | 'quality_assurance';
  to_phase: 'processing' | 'quality_assurance' | 'completion';
  notes?: string | null;
  type?: 'wr_phase_transition';
  workRequestId?: string;
  fromPhase?: 'pre_processing' | 'processing' | 'quality_assurance';
  toPhase?: 'processing' | 'quality_assurance' | 'completion';
}

export interface QaReviewTaskResult {
  task_id: string;
  qa_status: 'passed' | 'failed';
  taskId?: string;
  qaStatus?: 'passed' | 'failed';
}

export type QaReviewResultItem = QaReviewTaskResult;

export interface QaReviewInput {
  results: QaReviewTaskResult[];
}

export interface RerouteInput {
  to_phase: 'pre_processing' | 'processing';
  reason: string;
  toPhase?: 'pre_processing' | 'processing';
}

export interface RerouteResponse extends WorkRequest {
  reopenedTaskIds?: string[];
}

export interface RetainerGenerateOverrides {
  title?: string;
  description?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  priority?: Priority;
  assignedTo?: string | null;
  assigned_to?: string | null;
  coAssignees?: string[];
  co_assignees?: string[];
  dueDate?: string | null;
  due_date?: string | null;
}

export interface RetainerGenerateInput {
  period_label?: string | null;
  periodLabel?: string | null;
  overrides?: RetainerGenerateOverrides;
}

export type RetainerGenerateResponse = WorkRequest;

export interface CreateRetainerTemplateInput {
  name: string;
  title?: string;
  description?: string | null;
  clientId?: string | null;
  client_id?: string | null;
  schedule?: string | null;
  priority?: Priority;
  pfAmount?: number;
  pf_amount?: number;
  recurrence?: RecurrenceType;
  tasks?: RetainerTemplateTask[];
}

export interface ResolveTransitionRequestInput {
  status: 'fulfilled' | 'rejected' | 'cancelled';
  rejectionReason?: string | null;
  rejection_reason?: string | null;
  fulfilledBy?: string | null;
  fulfilled_by?: string | null;
  notes?: string | null;
}

export interface CreateDocumentInput {
  fileName?: string;
  originalName?: string;
  workRequestId?: string | null;
  linkedTaskId?: string | null;
  clientId?: string | null;
  category?: DocumentCategory;
  description?: string;
  documentType?: string;
}

export interface DocumentFilterParams {
  workRequestId?: string;
  linkedTaskId?: string;
  clientId?: string;
  category?: DocumentCategory;
  status?: DocumentStatus;
  search?: string;
  page?: number;
  limit?: number;
}

// ============================================================================
// 8. Filters & Query Options
// ============================================================================

export interface WorkRequestFilters {
  phase?: Phase | 'all';
  status?: WorkRequestStatus | 'all';
  clientId?: string;
  assigneeId?: string;
  priority?: Priority;
  search?: string;
  archived?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  includeTasks?: boolean;
}

export interface OperationsRequestFilters {
  status?: RequestStatus;
  type?: RequestType;
  workRequestId?: string;
  clientId?: string;
  linkedTaskId?: string;
  requestedBy?: string;
  page?: number;
  limit?: number;
}

export interface OperationsCounts {
  all: number;
  pre_processing: number;
  processing: number;
  quality_assurance: number;
  completion: number;
  archived?: number;
}

export interface OperationsRequestCounts {
  pending: number;
  fulfilled: number;
  rejected: number;
  total: number;
}

// ============================================================================
// 9. API Response Envelopes & RFC 7807 Error
// ============================================================================

export interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  };
}

export type WorkRequestListResponse = ApiResponse<WorkRequest[]>;
export type WorkRequestDetailResponse = ApiResponse<WorkRequest>;
export type WorkRequestCountsResponse = ApiResponse<OperationsCounts>;

export interface WorkRequestRelatedResponse {
  data: {
    workRequest: WorkRequest;
    relatedRequests?: OperationsRequest[];
    documents?: DmsDocument[];
  };
}

export type OperationsRequestListResponse = ApiResponse<OperationsRequest[]>;
export type OperationsRequestSingleResponse = ApiResponse<OperationsRequest>;

export interface ApiErrorResponse {
  status: number;
  title?: string;
  detail?: string;
  code?: string;
  invalidParams?: Array<{
    name: string;
    reason: string;
  }>;
}
