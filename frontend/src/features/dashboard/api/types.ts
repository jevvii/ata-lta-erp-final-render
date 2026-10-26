/**
 * TypeScript Domain Models & Interface Contracts for Dashboard Widgets (Module #2)
 *
 * Citations:
 * - Frozen API Contract time-entries@2.0.0 (docs/api-contracts/modules/time-entries.md)
 * - Frozen API Contract notifications@2.0.0 (docs/api-contracts/modules/notifications.md)
 *
 * Compliance:
 * - Strict TypeScript 5.7+
 * - noUncheckedIndexedAccess: true compliant (all array/record lookups guarded or nullable)
 * - Zero `any` types
 */

// ============================================================================
// 1. Time Entries Domain Types
// ============================================================================

export interface TimeEntry {
  id: string;
  userId: string;
  userName?: string | null;
  userRole?: string | null;
  taskId: string;
  entryDate: string; // YYYY-MM-DD
  durationMinutes: number; // 1 - 1440
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RawTimeEntryApi {
  id: string;
  user_id: string;
  user_name?: string | null;
  user_role?: string | null;
  task_id: string;
  entry_date: string;
  duration_minutes: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskSummaryItem {
  taskId: string;
  workRequestId: string;
  title: string;
  minutes: number;
}

export interface RawTaskSummaryItemApi {
  task_id: string;
  work_request_id: string;
  title: string;
  minutes: number;
}

export interface TimeSummary {
  date: string;
  totalMinutes: number;
  byTask: TaskSummaryItem[];
}

export interface RawTimeSummaryApi {
  date: string;
  total_minutes: number;
  by_task: RawTaskSummaryItemApi[];
}

export interface CreateTimeEntryInput {
  taskId: string;
  entryDate: string; // YYYY-MM-DD
  durationMinutes: number; // 1 - 1440
  note?: string | null;
}

export interface UpdateTimeEntryInput {
  taskId?: string;
  entryDate?: string; // YYYY-MM-DD
  durationMinutes?: number; // 1 - 1440
  note?: string | null;
}

export interface TimeEntryListFilters {
  from?: string;
  to?: string;
  taskId?: string;
  userId?: string;
}

// ============================================================================
// 2. Notifications Domain Types
// ============================================================================

export type NotificationType =
  | 'wr.transition_request.received'
  | 'wr.transition_request.resolved'
  | 'pending_request.resolved'
  | 'wr.qa_reroute'
  | 'disbursement.lifecycle';

export interface TransitionRequestReceivedPayload {
  requestId?: string;
  request_id?: string;
  workRequestId?: string;
  work_request_id?: string;
  workRequestTitle?: string;
  work_request_title?: string;
  wr_title?: string;
  fromPhase?: string;
  from_phase?: string;
  toPhase?: string;
  to_phase?: string;
  requestedById?: string;
  requested_by_id?: string;
  requestedByName?: string;
  requested_by_name?: string;
}

export interface TransitionRequestResolvedPayload {
  requestId?: string;
  request_id?: string;
  workRequestId?: string;
  work_request_id?: string;
  workRequestTitle?: string;
  work_request_title?: string;
  wr_title?: string;
  outcome?: string;
  resolvedPhase?: string;
  resolved_phase?: string;
  toPhase?: string;
  to_phase?: string;
  rejectionReason?: string | null;
  rejection_reason?: string | null;
  resolvedById?: string;
  resolved_by_id?: string;
  resolvedByName?: string;
  resolved_by_name?: string;
  via?: string;
}

export interface PendingRequestResolvedPayload {
  requestId?: string;
  request_id?: string;
  resourceType?: string;
  resource_type?: string;
  resourceId?: string;
  resource_id?: string;
  action?: string;
  rejectionReason?: string | null;
  rejection_reason?: string | null;
  resolvedByName?: string;
  resolved_by_name?: string;
}

export interface QaReroutePayload {
  workRequestId?: string;
  work_request_id?: string;
  workRequestTitle?: string;
  work_request_title?: string;
  wr_title?: string;
  targetPhase?: string;
  target_phase?: string;
  to_phase?: string;
  reopenedTaskIds?: string[];
  reopened_task_ids?: string[];
  failedTaskIds?: string[];
  failed_task_ids?: string[];
  reason?: string;
  reroutedById?: string;
  rerouted_by_id?: string;
  reroutedByName?: string;
  rerouted_by_name?: string;
}

export interface DisbursementLifecyclePayload {
  action?: 'approved' | 'funded' | 'released' | 'rejected' | 'returned_for_correction' | string;
  table_name?: 'disbursements' | string;
  tableName?: string;
  request_id?: string;
  requestId?: string;
  entity?: string;
  disbursement_number?: string;
  disbursementNumber?: string;
  title?: string;
  reason?: string | null;
}

export type NotificationPayload =
  | TransitionRequestReceivedPayload
  | TransitionRequestResolvedPayload
  | PendingRequestResolvedPayload
  | QaReroutePayload
  | DisbursementLifecyclePayload
  | Record<string, unknown>;

export interface NotificationItem {
  id: string;
  userId: string;
  type: NotificationType;
  payload: NotificationPayload;
  readAt: string | null;
  createdAt: string;
}

export interface RawNotificationItemApi {
  id: string;
  user_id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface NotificationMeta {
  unreadCount?: number;
  unread_count?: number;
  hasMore?: boolean;
  has_more?: boolean;
  nextCursor?: string | null;
  next_cursor?: string | null;
  limit?: number;
}

export interface NotificationListResponse {
  data: NotificationItem[];
  meta: NotificationMeta;
}

export interface RawNotificationListApiResponse {
  data: RawNotificationItemApi[];
  meta?: {
    unread_count?: number;
    has_more?: boolean;
    next_cursor?: string | null;
    limit?: number;
  };
}

// ============================================================================
// 3. Assigned Task for Picker
// ============================================================================

import type { Task, WorkRequest } from '@/features/operations/api/types';

export interface AssignableTaskOption {
  taskId: string;
  taskTitle: string;
  workRequestId: string;
  workRequestTitle: string;
  entity: string;
  status: string;
  phase?: string | null;
  clientName?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assigneeRole?: string | null;
  coAssigneeCount?: number;
  dueDate?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  priority?: string | null;
  assigneesList?: Array<{ id: string; name: string; role?: string }>;
  rawTask?: Task;
  rawWorkRequest?: WorkRequest;
}

export interface DashboardWorkRequestItem {
  id: string;
  title: string;
  work_order_number?: string | null;
  entity: string;
  status: string;
  phase: string | null;
  clientId?: string | null;
  clientName?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assigneeRole?: string | null;
  coAssignees: string[];
  coAssigneeCount: number;
  dueDate: string | null;
  updatedAt: string | null;
  completedAt?: string | null;
  priority: string | null;
  tasksCount: number;
  completedTasksCount: number;
  tasks: Task[];
  rawWorkRequest: WorkRequest;
  assigneesList: Array<{ id: string; name: string; role?: string }>;
}
