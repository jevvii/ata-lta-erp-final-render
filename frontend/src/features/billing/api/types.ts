import type { InvoicePrintDetails } from '@/lib/printDocuments';
/**
 * Billing Module TypeScript interfaces.
 * Frozen at billing@2.0.0 (docs/api-contracts/modules/billing.md).
 */

export type EntityCode = 'ATA' | 'LTA';

export type InvoiceStatus =
  'Draft' | 'Pending' | 'Approved' | 'Sent' | 'Partially Paid' | 'Paid' | 'Overdue' | 'Cancelled';

export type LineItemType = 'Professional Fee' | 'Government Fee' | 'Other';

export interface InvoiceLineItem {
  id?: string;
  invoice_id?: string;
  description: string;
  amount: number;
  type: LineItemType;
  sort_order?: number;
  created_at?: string;
}

export interface InvoicePayment {
  id: string;
  invoice_id: string;
  entity_id?: string;
  amount: number;
  /** Canonical method name matching table and API responses. */
  method?: string;
  /** Canonical reference matching table and API responses. */
  reference?: string | null;
  /** Legacy fallback for method. */
  payment_method?: string;
  /** Legacy fallback for reference. */
  reference_number?: string | null;
  payment_date: string;
  notes?: string | null;
  recorded_by?: string;
  created_at?: string;
}

export interface ClientSnapshot {
  name: string;
  tin?: string | null;
  address?: string | null;
  clientNumber?: string | null;
  client_number?: string | null;
}

export interface Invoice {
  print_details?: InvoicePrintDetails | null;
  id: string;
  entity_id: string;
  entity_code?: EntityCode;
  invoice_number: string;
  invoiceNumber?: string;
  client_id: string;
  clientId?: string;
  client_number?: string | null;
  clientNumber?: string | null;
  work_request_id?: string | null;
  workRequestId?: string | null;
  work_request_number?: string | null;
  workRequestNumber?: string | null;
  tracking_number?: string | null;
  trackingNumber?: string | null;
  task_id?: string | null;
  taskId?: string | null;
  linked_task_id?: string | null;
  linked_transmittal_id?: string | null;
  issue_date: string;
  due_date: string;
  status: InvoiceStatus;
  subtotal: number;
  total: number;
  amount_paid?: number;
  balance: number;
  address?: string | null;
  notes?: string | null;
  terms?: string | null;
  archived?: boolean;
  version?: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  clients?: ClientSnapshot;
  line_items?: InvoiceLineItem[];
  payments?: InvoicePayment[];
  work_request?: {
    id: string;
    title: string;
    workOrderNumber?: string | null;
    workRequestNumber?: string | null;
    work_request_number?: string | null;
    creatorName?: string | null;
    creatorEmail?: string | null;
  } | null;
  work_request_title?: string | null;
  work_request_creator_name?: string | null;
}

export interface InvoiceFilters {
  status?: InvoiceStatus | 'All';
  clientId?: string;
  linkedTaskId?: string;
  linkedTransmittalId?: string;
  search?: string;
  archived?: boolean;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
}

export interface InvoiceListResponse {
  data: Invoice[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

export interface InvoiceCounts {
  active: number;
  archived: number;
  rejected: number;
  templates: number;
}

export interface InvoiceCountsResponse {
  data: InvoiceCounts;
}

export interface AgingEntry {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientId: string;
  dueDate: string;
  total: number;
  balance: number;
  daysOverdue: number;
}

export interface AgingBucket {
  total: number;
  invoices: AgingEntry[];
}

export interface AgingReportData {
  summary: {
    current: number;
    '1-30': number;
    '31-60': number;
    '61-90': number;
    '90+': number;
    grandTotal: number;
  };
  details: {
    current: AgingBucket;
    '1-30': AgingBucket;
    '31-60': AgingBucket;
    '61-90': AgingBucket;
    '90+': AgingBucket;
  };
}

export interface AgingReportResponse {
  data: AgingReportData;
}

export interface CreateLineItemInput {
  description: string;
  amount: number;
  type?: LineItemType;
  sortOrder?: number;
}

export interface CreateInvoiceInput {
  clientId: string;
  workRequestId: string;
  clientNumber?: string | null;
  client_number?: string | null;
  workRequestNumber?: string | null;
  work_request_number?: string | null;
  linkedTaskId?: string | null;
  taskId?: string | null;
  task_id?: string | null;
  linkedTransmittalId?: string | null;
  invoiceNumber?: string;
  issueDate: string;
  dueDate: string;
  status?: InvoiceStatus;
  lineItems: CreateLineItemInput[];
  notes?: string | null;
  terms?: string | null;
}

export interface UpdateInvoiceInput {
  printDetails?: InvoicePrintDetails;
  clientId?: string;
  clientNumber?: string | null;
  client_number?: string | null;
  workRequestId?: string | null;
  workRequestNumber?: string | null;
  work_request_number?: string | null;
  linkedTaskId?: string | null;
  linkedTransmittalId?: string | null;
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  status?: InvoiceStatus;
  lineItems?: CreateLineItemInput[];
  notes?: string | null;
  terms?: string | null;
  address?: string | null;
  clientAddress?: string | null;
  archived?: boolean;
  expectedVersion?: number;
}

export interface RecordPaymentInput {
  amount: number;
  method: string;
  reference?: string | null;
  date: string;
  notes?: string | null;
}
