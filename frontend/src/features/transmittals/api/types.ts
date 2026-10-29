/**
 * Domain types for Transmittals (Module #5)
 *
 * Citation: Frozen API Contract transmittals@2.0.0 (docs/api-contracts/modules/transmittals.md)
 * Strict requirement: Pure TypeScript domain types hand-written from the contract.
 * NO backend imports.
 */

export type TransmittalStatus = 'Draft' | 'Sent' | 'Acknowledged' | 'Cancelled';

export type EntityCode = 'ATA' | 'LTA' | 'ALL';

export type DocumentCategory =
  | 'Tax'
  | 'SEC'
  | 'BIR'
  | 'Contract'
  | 'Original Copy'
  | 'Photocopy'
  | 'Board Resolution'
  | 'Secretary Certificate'
  | 'Others';

export interface TransmittalClientInfo {
  name: string;
  address?: string | null;
  tin?: string | null;
  client_number?: string | null;
  clientNumber?: string | null;
}

export interface TransmittalItem {
  id: string;
  transmittal_id?: string;
  transmittalId?: string;
  description: string;
  document_type?: string | null;
  documentType?: string | null;
  quantity: number;
  sort_order?: number;
  sortOrder?: number;
  created_at?: string;
  createdAt?: string;
  version?: number;
}

export interface Transmittal {
  id: string;
  tracking_number: string;
  trackingNumber?: string;
  entity_id: string;
  entityId?: string;
  entity_code?: string;
  entityCode?: string;
  client_id: string;
  clientId?: string;
  client_number?: string | null;
  clientNumber?: string | null;
  client_name?: string | null;
  clientName?: string | null;
  work_request_id?: string | null;
  workRequestId?: string | null;
  work_request_number?: string | null;
  workRequestNumber?: string | null;
  work_request_title?: string | null;
  workRequestTitle?: string | null;
  linked_task_id?: string | null;
  linkedTaskId?: string | null;
  status: TransmittalStatus;
  approved: boolean;
  board_order: number;
  boardOrder?: number;
  notes?: string | null;
  recipient_name?: string | null;
  recipientName?: string | null;
  recipient_details?: string | null;
  recipientDetails?: string | null;
  received_by_name?: string | null;
  receivedByName?: string | null;
  sent_at?: string | null;
  sentAt?: string | null;
  sent_by?: string | null;
  sentBy?: string | null;
  acknowledged_at?: string | null;
  acknowledgedAt?: string | null;
  acknowledged_by?: string | null;
  acknowledgedBy?: string | null;
  archived: boolean;
  version: number;
  created_at: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  created_by?: string | null;
  createdBy?: string | null;
  updated_by?: string | null;
  updatedBy?: string | null;
  deleted_at?: string | null;
  deletedAt?: string | null;
  clients?: TransmittalClientInfo | null;
  items?: TransmittalItem[];
}

export interface TransmittalWithItems extends Transmittal {
  items: TransmittalItem[];
}

export type TransmittalListItem = Transmittal;

export interface TransmittalCounts {
  active: number;
  archived: number;
  total: number;
}

// ============================================================================
// Input Payloads
// ============================================================================

export interface CreateTransmittalItemInput {
  description: string;
  documentType?: string | null;
  quantity?: number;
}

export interface CreateTransmittalInput {
  clientId: string;
  clientNumber?: string | null;
  client_number?: string | null;
  workRequestId: string;
  workRequestNumber?: string | null;
  work_request_number?: string | null;
  trackingNumber?: string;
  items: CreateTransmittalItemInput[];
  notes?: string | null;
  recipientName?: string | null;
  recipientDetails?: string | null;
  linkedTaskId?: string | null;
  boardOrder?: number;
}

export interface UpdateTransmittalInput {
  clientId?: string;
  clientNumber?: string | null;
  client_number?: string | null;
  workRequestId?: string | null;
  workRequestNumber?: string | null;
  work_request_number?: string | null;
  trackingNumber?: string;
  items?: CreateTransmittalItemInput[];
  notes?: string | null;
  recipientName?: string | null;
  recipientDetails?: string | null;
  linkedTaskId?: string | null;
  boardOrder?: number;
  expectedVersion?: number;
}

export interface SendTransmittalInput {
  boardOrder?: number;
}

export interface AcknowledgeTransmittalInput {
  boardOrder?: number;
}

export interface TransmittalFilters {
  status?: TransmittalStatus | string;
  clientId?: string;
  search?: string;
  archived?: boolean | string;
  includeDeleted?: boolean | string;
  page?: number;
  limit?: number;
}

// ============================================================================
// API Response Wrappers
// ============================================================================

export interface TransmittalListResponse {
  data: TransmittalListItem[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

export interface TransmittalDetailResponse {
  data: TransmittalWithItems;
}

export interface TransmittalCountsResponse {
  data: TransmittalCounts;
}
