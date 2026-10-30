/**
 * Generic CDC Realtime Sync Hook (Spec §4.3 & §5, Parcel E)
 *
 * Subscribes to PostgreSQL CDC changes on public schema tables via Supabase Realtime.
 * Enforces three mandatory safety guards:
 * 1. Tenant Isolation Guard: Discards cross-tenant payloads when activeEntity !== 'ALL'.
 * 2. Stale Version Rejection Guard: Discards duplicate INSERTs when version <= localCachedVersion, and stale UPDATEs when version < localCachedVersion.
 * 3. Loop Prevention Guard: Discards payloads originated by current browser tab or local mutation registry.
 *
 * Reconciles TanStack Query detail and list caches via queryClient.setQueryData.
 * Guarantees clean teardown on unmount via supabase.removeChannel(channel).
 */

import { useEffect, useRef } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { isFeatureEnabled } from '@/lib/flags';
import { useSessionStore } from '@/lib/session';
import { isSelfOriginatedPayload, isLocalMutation } from './loopPrevention';
import { documentKeys } from '@/features/documents/api/queryKeys';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { billingKeys } from '@/features/billing/api/queryKeys';
import { disbursementKeys } from '@/features/disbursements/api/queryKeys';
import { transmittalKeys } from '@/features/transmittals/api/queryKeys';
import { dashboardKeys } from '@/features/dashboard/api/queryKeys';
import { resolveEntityUUID, resolveEntityCodeFromUUID } from './tenantResolver';

export type RealtimeTable =
  | 'work_requests'
  | 'tasks'
  | 'invoices'
  | 'disbursements'
  | 'time_entries'
  | 'task_time_logs'
  | 'users'
  | 'user_departments'
  | 'audit_logs'
  | 'clients'
  | string;

export interface UseEntityRealtimeSyncOptions<T = Record<string, unknown>> {
  table: RealtimeTable;
  detailQueryKey?: (id: string, record?: T) => readonly unknown[];
  listRootKey?: readonly unknown[];
  activeEntity?: string | null;
  activeEntityUUID?: string;
  channelName?: string;
  filter?: string;
  enabled?: boolean;
}

interface GenericEntityRecord {
  id?: string;
  version?: number;
  entity_id?: string;
  entityId?: string;
  entity?: string;
  entity_code?: string;
  work_request_id?: string;
  workRequestId?: string;
  phases?: Record<string, { tasks?: Array<{ id?: string }> }>;
  [key: string]: unknown;
}

interface GenericListResponse {
  data: GenericEntityRecord[];
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    unreadCount?: number;
    unread_count?: number;
    [key: string]: unknown;
  };
}

/**
 * Computes default detail query key for supported domain tables.
 */
export function getDefaultDetailQueryKey(
  table: string,
  id: string,
  record?: GenericEntityRecord
): readonly unknown[] | undefined {
  switch (table) {
    case 'work_requests':
      return operationsKeys.workRequestDetail(id);
    case 'tasks': {
      const wrId = record?.work_request_id ?? record?.workRequestId;
      return wrId ? operationsKeys.taskDetail(wrId, id) : undefined;
    }
    case 'invoices':
      return billingKeys.invoiceDetail(id);
    case 'disbursements':
      return disbursementKeys.detail(id);
    case 'transmittals':
      return transmittalKeys.detail(id);
    case 'operations_requests':
      return operationsKeys.requestDetail(id);
    case 'documents':
      return documentKeys.detail(id);
    case 'time_entries':
    case 'task_time_logs':
      return dashboardKeys.timeEntries.detail(id);
    case 'users':
      return ['admin', 'users', 'detail', id];
    case 'user_departments':
      return undefined;
    case 'audit_logs':
      return ['admin', 'audit', 'detail', id];
    default:
      return [table, 'detail', id];
  }
}

/**
 * Computes default list root query key for supported domain tables.
 */
export function getDefaultListRootKey(table: string): readonly unknown[] {
  switch (table) {
    case 'work_requests':
      return operationsKeys.workRequests();
    case 'tasks':
      return ['operations', 'tasks'];
    case 'invoices':
      return billingKeys.invoices();
    case 'disbursements':
      return disbursementKeys.lists();
    case 'transmittals':
      return transmittalKeys.lists();
    case 'operations_requests':
      return operationsKeys.requests();
    case 'documents':
      return operationsKeys.documents();
    case 'time_entries':
    case 'task_time_logs':
      return dashboardKeys.timeEntries.all;
    case 'users':
    case 'user_departments':
      return ['admin', 'users'];
    case 'audit_logs':
      return ['admin', 'audit'];
    default:
      return [table, 'list'];
  }
}

// ============================================================================
// Model Normalization Engine (Spec SPEC-REALTIME-SYNC-001 §4 Parcel 2)
// ============================================================================

/**
 * Normalizes PostgreSQL CDC task records into unified objects with both
 * camelCase and snake_case properties to ensure full TanStack Query and UI compatibility.
 */
export function normalizeCdcTask(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const workRequestId = record.work_request_id ?? record.workRequestId;
  const qaStatus = record.qa_status ?? record.qaStatus ?? 'none';
  const dueDate = record.due_date ?? record.dueDate ?? null;
  const displayOrder = record.display_order ?? record.displayOrder ?? 0;
  const assigneeId = record.assignee_id !== undefined ? record.assignee_id : (record.assigneeId ?? null);
  const assigneeName = record.assignee_name !== undefined ? record.assignee_name : (record.assigneeName ?? null);
  const requiredLinkType = record.required_link_type !== undefined ? record.required_link_type : (record.requiredLinkType ?? null);
  const phaseEnteredAt = record.phase_entered_at ?? record.phaseEnteredAt ?? null;
  const assignedBy = record.assigned_by ?? record.assignedBy ?? null;
  const assignedAt = record.assigned_at ?? record.assignedAt ?? null;
  const deletedAt = record.deleted_at ?? record.deletedAt ?? null;

  return {
    ...record,
    workRequestId,
    work_request_id: workRequestId,
    qaStatus,
    qa_status: qaStatus,
    dueDate,
    due_date: dueDate,
    displayOrder,
    display_order: displayOrder,
    assigneeId,
    assignee_id: assigneeId,
    assigneeName,
    assignee_name: assigneeName,
    requiredLinkType,
    required_link_type: requiredLinkType,
    phaseEnteredAt,
    phase_entered_at: phaseEnteredAt,
    assignedBy,
    assigned_by: assignedBy,
    assignedAt,
    assigned_at: assignedAt,
    deletedAt,
    deleted_at: deletedAt,
  };
}

/**
 * Normalizes PostgreSQL CDC work_request records into unified objects with both
 * camelCase and snake_case properties.
 */
export function normalizeCdcWorkRequest(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const workRequestNo = record.work_request_no ?? record.workRequestNo;
  const workRequestNumber =
    record.work_request_number !== undefined
      ? record.work_request_number
      : (record.workRequestNumber ?? workRequestNo);
  const finalWorkRequestNo = workRequestNo ?? workRequestNumber;
  const clientId = record.client_id ?? record.clientId;
  const clientName = record.client_name ?? record.clientName;
  const clientNumber =
    record.client_number !== undefined
      ? record.client_number
      : (record.clientNumber ?? null);
  const onHold = record.on_hold ?? record.onHold ?? false;
  const phaseEnteredAt = record.phase_entered_at ?? record.phaseEnteredAt ?? null;
  const requestedBy = record.requested_by ?? record.requestedBy ?? null;
  const assignedTo = record.assigned_to ?? record.assignedTo ?? null;
  const coAssignees = record.co_assignees ?? record.coAssignees ?? [];
  const dueDate = record.due_date ?? record.dueDate ?? null;
  const deletedAt = record.deleted_at ?? record.deletedAt ?? null;

  return {
    ...record,
    workRequestNo: finalWorkRequestNo,
    work_request_no: finalWorkRequestNo,
    workRequestNumber: workRequestNumber ?? finalWorkRequestNo,
    work_request_number: workRequestNumber ?? finalWorkRequestNo,
    clientId,
    client_id: clientId,
    clientName,
    client_name: clientName,
    clientNumber,
    client_number: clientNumber,
    onHold,
    on_hold: onHold,
    phaseEnteredAt,
    phase_entered_at: phaseEnteredAt,
    requestedBy,
    requested_by: requestedBy,
    assignedTo,
    assigned_to: assignedTo,
    coAssignees,
    co_assignees: coAssignees,
    dueDate,
    due_date: dueDate,
    deletedAt,
    deleted_at: deletedAt,
  };
}

/**
 * Normalizes PostgreSQL CDC operations_request records into unified objects with both
 * camelCase and snake_case properties.
 */
export function normalizeCdcOperationsRequest(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const type = record.request_type ?? record.type;
  const workRequestId = record.work_request_id ?? record.workRequestId;
  const linkedTaskId = record.linked_task_id ?? record.linkedTaskId;
  const clientId = record.client_id ?? record.clientId;
  const rejectionReason = record.rejection_reason ?? record.rejectionReason;

  return {
    ...record,
    type,
    request_type: type,
    workRequestId,
    work_request_id: workRequestId,
    linkedTaskId,
    linked_task_id: linkedTaskId,
    clientId,
    client_id: clientId,
    rejectionReason,
    rejection_reason: rejectionReason,
  };
}

/**
 * Normalizes PostgreSQL CDC notification records into unified objects with both
 * camelCase and snake_case properties.
 */
export function normalizeCdcNotification(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const userId = record.user_id ?? record.userId;
  const readAt = record.read_at ?? record.readAt ?? null;
  const createdAt = record.created_at ?? record.createdAt;

  return {
    ...record,
    userId,
    user_id: userId,
    readAt,
    read_at: readAt,
    createdAt,
    created_at: createdAt,
  };
}

/**
 * Normalizes PostgreSQL CDC task_assignees records into unified objects with both
 * camelCase and snake_case properties.
 */
export function normalizeCdcTaskAssignee(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const taskId = record.task_id ?? record.taskId;
  const userId = record.user_id ?? record.userId;
  const assignedBy = record.assigned_by !== undefined ? record.assigned_by : (record.assignedBy ?? null);
  const assignedAt = record.assigned_at !== undefined ? record.assigned_at : (record.assignedAt ?? null);
  return {
    ...record,
    taskId,
    task_id: taskId,
    userId,
    user_id: userId,
    assignedBy,
    assigned_by: assignedBy,
    assignedAt,
    assigned_at: assignedAt,
  };
}

/**
 * Normalizes PostgreSQL CDC time_entries records into unified objects with both
 * camelCase and snake_case properties to ensure full TanStack Query and UI compatibility.
 */
export function normalizeCdcTimeEntry(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const durationMinutes = record.duration_minutes ?? record.durationMinutes ?? 0;
  const taskId = record.task_id ?? record.taskId;
  const userId = record.user_id ?? record.userId;
  const entryDate = record.entry_date ?? record.entryDate;
  const note = record.note ?? null;
  const userAvatarUrl = (record.userAvatarUrl as string) || (record.user_avatar_url as string) || null;
  return {
    ...record,
    durationMinutes: Number(durationMinutes),
    duration_minutes: Number(durationMinutes),
    taskId,
    task_id: taskId,
    userId,
    user_id: userId,
    userAvatarUrl,
    user_avatar_url: userAvatarUrl,
    entryDate,
    entry_date: entryDate,
    note,
  };
}

/**
 * Normalizes PostgreSQL CDC task_time_logs records into unified objects with both
 * camelCase and snake_case properties converting legacy hours to durationMinutes.
 */
export function normalizeCdcTaskTimeLog(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const hours = Number(record.hours ?? 0);
  const durationMinutes = Math.round(hours * 60);
  const taskId = record.task_id ?? record.taskId ?? record.linked_task_id;
  const userId = record.user_id ?? record.userId;
  const entryDate = record.date ?? record.entry_date ?? record.entryDate;
  const note = record.note ?? null;
  return {
    ...record,
    durationMinutes,
    duration_minutes: durationMinutes,
    taskId,
    task_id: taskId,
    userId,
    user_id: userId,
    entryDate,
    entry_date: entryDate,
    note,
  };
}

/**
 * Normalizes PostgreSQL CDC users records into unified objects with both
 * camelCase and snake_case properties.
 */
export function normalizeCdcUser(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const rawIsActive = record.is_active !== undefined ? record.is_active : record.isActive;
  const isActive =
    rawIsActive !== undefined
      ? Boolean(rawIsActive)
      : record.status !== undefined
        ? record.status !== 'Disabled'
        : true;
  const status = isActive === false ? 'Disabled' : 'Active';
  const createdAt = record.created_at ?? record.createdAt;
  const updatedAt = record.updated_at ?? record.updatedAt;
  const version = Number(record.version ?? 1);
  const userNumber =
    record.user_number !== undefined
      ? record.user_number
      : (record.userNumber ?? null);

  const normalized: Record<string, unknown> = {
    ...record,
    userNumber,
    user_number: userNumber,
    isActive,
    is_active: isActive,
    status,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
    version,
  };

  if (Array.isArray(record.entities)) {
    normalized.entities = record.entities;
  }
  if (Array.isArray(record.departments)) {
    normalized.departments = record.departments;
  }

  return normalized;
}

/**
 * Normalizes PostgreSQL CDC audit_logs records into unified objects with both
 * camelCase and snake_case properties.
 */
export function normalizeCdcAuditLog(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const userId = record.user_id ?? record.userId ?? null;
  const tableName = record.table_name ?? record.tableName ?? null;
  const recordId = record.record_id ?? record.recordId ?? null;
  const createdAt = record.created_at ?? record.createdAt;
  const timestamp = record.timestamp ?? createdAt;
  const auditNumber =
    record.audit_number !== undefined
      ? record.audit_number
      : (record.auditNumber ?? null);

  return {
    ...record,
    auditNumber,
    audit_number: auditNumber,
    userId,
    user_id: userId,
    tableName,
    table_name: tableName,
    recordId,
    record_id: recordId,
    createdAt,
    created_at: createdAt,
    timestamp,
  };
}

/**
 * Normalizes PostgreSQL CDC clients records into unified objects with both
 * camelCase and snake_case properties.
 */
export function normalizeCdcClient(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const clientNumber =
    record.client_number !== undefined
      ? record.client_number
      : (record.clientNumber ?? null);
  return {
    ...record,
    clientNumber,
    client_number: clientNumber,
  };
}

/**
 * Ensures snake_case <-> camelCase fields for persistent item numbers are preserved/mapped cleanly
 * across all domain records:
 * - audit_number <-> auditNumber
 * - user_number <-> userNumber
 * - client_number <-> clientNumber
 * - work_request_number <-> workRequestNumber
 * - invoice_number <-> invoiceNumber
 * - disbursement_number <-> disbursementNumber
 * - tracking_number <-> trackingNumber
 */
export function normalizePersistentItemNumbers(
  record: Record<string, unknown>
): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;

  let hasChange = false;
  const out = { ...record };

  if (record.audit_number !== undefined && record.auditNumber === undefined) {
    out.auditNumber = record.audit_number;
    hasChange = true;
  } else if (record.auditNumber !== undefined && record.audit_number === undefined) {
    out.audit_number = record.auditNumber;
    hasChange = true;
  }

  if (record.user_number !== undefined && record.userNumber === undefined) {
    out.userNumber = record.user_number;
    hasChange = true;
  } else if (record.userNumber !== undefined && record.user_number === undefined) {
    out.user_number = record.userNumber;
    hasChange = true;
  }

  if (record.client_number !== undefined && record.clientNumber === undefined) {
    out.clientNumber = record.client_number;
    hasChange = true;
  } else if (record.clientNumber !== undefined && record.client_number === undefined) {
    out.client_number = record.clientNumber;
    hasChange = true;
  }

  if (record.work_request_number !== undefined && record.workRequestNumber === undefined) {
    out.workRequestNumber = record.work_request_number;
    hasChange = true;
  } else if (record.workRequestNumber !== undefined && record.work_request_number === undefined) {
    out.work_request_number = record.workRequestNumber;
    hasChange = true;
  }

  if (record.invoice_number !== undefined && record.invoiceNumber === undefined) {
    out.invoiceNumber = record.invoice_number;
    hasChange = true;
  } else if (record.invoiceNumber !== undefined && record.invoice_number === undefined) {
    out.invoice_number = record.invoiceNumber;
    hasChange = true;
  }

  if (record.disbursement_number !== undefined && record.disbursementNumber === undefined) {
    out.disbursementNumber = record.disbursement_number;
    hasChange = true;
  } else if (record.disbursementNumber !== undefined && record.disbursement_number === undefined) {
    out.disbursement_number = record.disbursementNumber;
    hasChange = true;
  }

  if (record.tracking_number !== undefined && record.trackingNumber === undefined) {
    out.trackingNumber = record.tracking_number;
    hasChange = true;
  } else if (record.trackingNumber !== undefined && record.tracking_number === undefined) {
    out.tracking_number = record.trackingNumber;
    hasChange = true;
  }

  return hasChange ? out : record;
}

/**
 * Dispatches raw incoming CDC payloads to table-specific normalizers.
 */
export function normalizeCdcPayload(
  table: string,
  record: Record<string, unknown>
): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  let normalized = record;
  switch (table) {
    case 'tasks':
      normalized = normalizeCdcTask(record);
      break;
    case 'work_requests':
      normalized = normalizeCdcWorkRequest(record);
      break;
    case 'operations_requests':
      normalized = normalizeCdcOperationsRequest(record);
      break;
    case 'notifications':
      normalized = normalizeCdcNotification(record);
      break;
    case 'task_assignees':
      normalized = normalizeCdcTaskAssignee(record);
      break;
    case 'time_entries':
      normalized = normalizeCdcTimeEntry(record);
      break;
    case 'task_time_logs':
      normalized = normalizeCdcTaskTimeLog(record);
      break;
    case 'users':
      normalized = normalizeCdcUser(record);
      break;
    case 'audit_logs':
      normalized = normalizeCdcAuditLog(record);
      break;
    case 'clients':
      normalized = normalizeCdcClient(record);
      break;
    default:
      normalized = record;
      break;
  }
  return normalizePersistentItemNumbers(normalized);
}

/**
 * Checks whether an incoming CDC record represents a soft-deleted entity.
 */
export function isSoftDeleteRecord(record: Record<string, unknown> | null | undefined): boolean {
  if (!record || typeof record !== 'object') return false;
  return Boolean(record.deleted_at) || Boolean(record.deletedAt);
}

/**
 * Scoped query matcher ensuring tasks are only prepended to the matching parent work request.
 * Checks that the query key is an array, includes 'tasks', and includes targetWrId.
 */
export function isTaskListOfTargetWr(qKey: unknown, targetWrId: string): boolean {
  return (
    Array.isArray(qKey) &&
    qKey.includes('tasks') &&
    qKey.includes(targetWrId)
  );
}

/**
 * Safely compares two UUIDs or user IDs with trimming and RFC 4122 case-insensitivity.
 * Handles both primitive strings and user object structures.
 */
export function isMatchingUserId(idA: unknown, idB: unknown): boolean {
  if (!idA || !idB) return false;
  const extractId = (val: unknown): string | undefined => {
    if (typeof val === 'string') return val;
    if (typeof val === 'object' && val !== null) {
      const obj = val as { id?: unknown; userId?: unknown; user_id?: unknown };
      if (typeof obj.id === 'string') return obj.id;
      if (typeof obj.userId === 'string') return obj.userId;
      if (typeof obj.user_id === 'string') return obj.user_id;
    }
    return undefined;
  };
  const strA = extractId(idA);
  const strB = extractId(idB);
  if (!strA || !strB) return false;
  return strA.trim().toLowerCase() === strB.trim().toLowerCase();
}

/**
 * Invalidates dashboard assigned tasks cache with strict user isolation (SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R3).
 *
 * Scoping rules:
 * - For tasks events: only invalidate if currentUserId matches new.assignee_id or old.assignee_id (or camelCase new.assigneeId / old.assigneeId).
 * - For task_assignees events: only invalidate if currentUserId matches new.user_id or old.user_id (or camelCase new.userId / old.userId).
 * - For work_requests events: invalidate on status, archive, or deletion state changes (e.g. status change, is_archived/archived, deleted_at).
 * - Cross-user CDC events: discarded with zero invalidations to dashboardKeys.assignedTasks.all for uninvolved users.
 * - Retrieve currentUserId synchronously via useSessionStore.getState().user?.id.
 */
export function triggerAssignedTasksCoInvalidation(
  queryClient: QueryClient,
  table: string,
  record?: Record<string, unknown> | null,
  oldRecord?: Record<string, unknown> | null,
  isDelete?: boolean
): void {
  const currentUser = useSessionStore.getState().user;
  const currentUserId = currentUser?.id;
  if (!currentUserId) return;
  const isAdmin = String(currentUser?.role || '').toLowerCase() === 'admin';

  if (table === 'tasks') {
    const newAssignee = record?.assignee_id ?? record?.assigneeId;
    const oldAssignee = oldRecord?.assignee_id ?? oldRecord?.assigneeId;

    const matchesNew =
      isMatchingUserId(newAssignee, currentUserId) ||
      (Array.isArray(record?.assignees) &&
        record.assignees.some((a) => isMatchingUserId(a, currentUserId)));
    const matchesOld =
      isMatchingUserId(oldAssignee, currentUserId) ||
      (Array.isArray(oldRecord?.assignees) &&
        oldRecord.assignees.some((a) => isMatchingUserId(a, currentUserId)));

    if (isAdmin || matchesNew || matchesOld) {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.assignedTasks.all });
    }
  } else if (table === 'task_assignees') {
    const newUserId = record?.user_id ?? record?.userId;
    const oldUserId = oldRecord?.user_id ?? oldRecord?.userId;

    if (isAdmin || isMatchingUserId(newUserId, currentUserId) || isMatchingUserId(oldUserId, currentUserId)) {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.assignedTasks.all });
    }
  } else if (table === 'work_requests') {
    const isStatusChange = Boolean(
      (record?.status || oldRecord?.status) &&
      record?.status !== oldRecord?.status
    );
    const isArchiveChange =
      Boolean(
        (record?.archived !== undefined || oldRecord?.archived !== undefined) &&
        Boolean(record?.archived) !== Boolean(oldRecord?.archived)
      ) ||
      Boolean(
        (record?.is_archived !== undefined || oldRecord?.is_archived !== undefined) &&
        Boolean(record?.is_archived) !== Boolean(oldRecord?.is_archived)
      );
    const isDeletionChange = Boolean(
      isDelete ||
      isSoftDeleteRecord(record) ||
      (record?.deleted_at !== oldRecord?.deleted_at) ||
      (record?.deletedAt !== oldRecord?.deletedAt)
    );

    if (isStatusChange || isArchiveChange || isDeletionChange) {
      void queryClient.invalidateQueries({ queryKey: dashboardKeys.assignedTasks.all });
    }
  }
}

/**
 * Invalidates related domain queries when a task is mutated (INSERT, UPDATE, DELETE).
 * - operationsKeys.workRequestDetail(targetWrId) -> re-evaluates gate status and blockers
 * - operationsKeys.workRequestCounts(activeEntity) -> updates task & work request counts
 * - operationsKeys.taskRelated(taskId) -> updates linked financial & document records
 */
export function triggerTaskCoInvalidations(
  queryClient: QueryClient,
  targetWrId: string,
  taskId: string,
  activeEntity?: string | null,
  record?: Record<string, unknown> | null,
  oldRecord?: Record<string, unknown> | null
): void {
  if (targetWrId) {
    void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(targetWrId) });
  }
  if (activeEntity) {
    void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
  } else {
    void queryClient.invalidateQueries({ queryKey: ['operations', 'workRequests', 'counts'] });
  }
  if (taskId) {
    void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(taskId) });
  }
  if (record || oldRecord) {
    triggerAssignedTasksCoInvalidation(queryClient, 'tasks', record, oldRecord);
  }
}

/**
 * Propagates real-time events across domain boundaries:
 * - invoices / disbursements with task_id -> invalidate operationsKeys.taskRelated(taskId)
 * - transmittals with linked_task_id -> invalidate operationsKeys.taskRelated(taskId)
 * - documents -> invalidate operationsKeys.documents(); if linked_task_id -> invalidate operationsKeys.taskRelated(taskId)
 * - operations_requests -> invalidate operationsKeys.requests(), operationsKeys.requestCounts(activeEntity),
 *   and if work_request_id exists -> invalidate operationsKeys.workRequestDetail(workRequestId)
 * - task_assignees with task_id -> invalidate ['operations', 'tasks', taskId]
 */
export function triggerCrossDomainCoInvalidations(
  queryClient: QueryClient,
  table: string,
  record: Record<string, unknown>,
  activeEntity?: string | null
): void {
  const taskId = (
    record?.task_id ??
    record?.taskId ??
    record?.linked_task_id ??
    record?.linkedTaskId
  ) as string | undefined;

  switch (table) {
    case 'invoices':
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(taskId) });
      }
      void queryClient.invalidateQueries({ queryKey: disbursementKeys.all });
      void queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      break;
    case 'disbursements':
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(taskId) });
      }
      void queryClient.invalidateQueries({ queryKey: billingKeys.invoices() });
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
      void queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
      break;
    case 'transmittals':
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(taskId) });
      }
      void queryClient.invalidateQueries({ queryKey: disbursementKeys.all });
      void queryClient.invalidateQueries({ queryKey: billingKeys.all });
      break;
    case 'documents':
      void queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
      if (record?.id) {
        void queryClient.invalidateQueries({ queryKey: documentKeys.detail(String(record.id)) });
        void queryClient.invalidateQueries({ queryKey: operationsKeys.documentDetail(String(record.id)) });
      }
      void queryClient.invalidateQueries({ queryKey: operationsKeys.documents() });
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(taskId) });
      }
      break;
    case 'operations_requests': {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.requests() });
      if (activeEntity) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.requestCounts(activeEntity) });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['operations', 'requests', 'counts'] });
      }
      const wrId = (record?.work_request_id ?? record?.workRequestId) as string | undefined;
      if (wrId) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(wrId) });
      }
      break;
    }
    case 'task_assignees':
      if (taskId) {
        void queryClient.invalidateQueries({ queryKey: ['operations', 'tasks', taskId] });
      }
      break;
  }
}

/**
 * Preserves API-enriched summary/join fields across raw PostgreSQL CDC updates
 * when foreign key IDs have not changed, or clears stale enriched summaries and
 * signals a targeted refetch (`linksChanged: true`) when a foreign key ID is modified or cleared.
 */
export function mergeCdcRecordPreservingEnrichedLinks(
  table: string,
  cached: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>
): { merged: Record<string, unknown>; linksChanged: boolean } {
  if (!cached || typeof cached !== 'object') {
    const hasLinkOnIncoming =
      (table === 'disbursements' &&
        Boolean(
          incoming.linked_invoice_id ||
            incoming.linkedInvoiceId ||
            incoming.linked_transmittal_id ||
            incoming.linkedTransmittalId
        )) ||
      (table === 'invoices' &&
        Boolean(incoming.linked_transmittal_id || incoming.linkedTransmittalId));
    return { merged: { ...incoming }, linksChanged: hasLinkOnIncoming };
  }

  const merged: Record<string, unknown> = { ...cached, ...incoming };
  let linksChanged = false;

  if (table === 'disbursements') {
    const oldInvId = (cached.linked_invoice_id ?? cached.linkedInvoiceId ?? null) as string | null;
    const hasNewInvKey = 'linked_invoice_id' in incoming || 'linkedInvoiceId' in incoming;
    const newInvId = hasNewInvKey
      ? ((incoming.linked_invoice_id ?? incoming.linkedInvoiceId ?? null) as string | null)
      : oldInvId;

    if (oldInvId !== newInvId) {
      linksChanged = true;
      if (!newInvId || !('linked_invoice_summary' in incoming)) {
        merged.linked_invoice_summary = null;
        merged.linked_invoice_number = null;
        merged.linked_invoice_status = null;
        merged.linked_invoice_total = null;
      }
    } else if (newInvId && !('linked_invoice_summary' in incoming) && cached.linked_invoice_summary) {
      merged.linked_invoice_summary = cached.linked_invoice_summary;
      merged.linked_invoice_number = cached.linked_invoice_number;
      merged.linked_invoice_status = cached.linked_invoice_status;
      merged.linked_invoice_total = cached.linked_invoice_total;
    }

    const oldTrxId = (cached.linked_transmittal_id ?? cached.linkedTransmittalId ?? null) as string | null;
    const hasNewTrxKey = 'linked_transmittal_id' in incoming || 'linkedTransmittalId' in incoming;
    const newTrxId = hasNewTrxKey
      ? ((incoming.linked_transmittal_id ?? incoming.linkedTransmittalId ?? null) as string | null)
      : oldTrxId;

    if (oldTrxId !== newTrxId) {
      linksChanged = true;
      if (!newTrxId || !('linked_transmittal_summary' in incoming)) {
        merged.linked_transmittal_summary = null;
        merged.linked_transmittal_number = null;
        merged.linked_transmittal_status = null;
      }
    } else if (newTrxId && !('linked_transmittal_summary' in incoming) && cached.linked_transmittal_summary) {
      merged.linked_transmittal_summary = cached.linked_transmittal_summary;
      merged.linked_transmittal_number = cached.linked_transmittal_number;
      merged.linked_transmittal_status = cached.linked_transmittal_status;
    }
  } else if (table === 'invoices') {
    const oldTrxId = (cached.linked_transmittal_id ?? cached.linkedTransmittalId ?? null) as string | null;
    const hasNewTrxKey = 'linked_transmittal_id' in incoming || 'linkedTransmittalId' in incoming;
    const newTrxId = hasNewTrxKey
      ? ((incoming.linked_transmittal_id ?? incoming.linkedTransmittalId ?? null) as string | null)
      : oldTrxId;

    if (oldTrxId !== newTrxId) {
      linksChanged = true;
      if (!newTrxId || !('linked_transmittal_summary' in incoming)) {
        merged.linked_transmittal_summary = null;
        merged.linked_transmittal_number = null;
        merged.linked_transmittal_status = null;
      }
    } else if (newTrxId && !('linked_transmittal_summary' in incoming) && cached.linked_transmittal_summary) {
      merged.linked_transmittal_summary = cached.linked_transmittal_summary;
      merged.linked_transmittal_number = cached.linked_transmittal_number;
      merged.linked_transmittal_status = cached.linked_transmittal_status;
    }

    if (!('linked_disbursements' in incoming) && cached.linked_disbursements) {
      merged.linked_disbursements = cached.linked_disbursements;
    }
  }

  return { merged, linksChanged };
}

/**
 * Invalidates time entries and task-related caches on CDC events (SPEC-REALTIME-TIME-LOGGING-001 §4.1).
 */
export function triggerTimeEntryCoInvalidation(
  queryClient: QueryClient,
  _table: string,
  record?: Record<string, unknown> | null,
  oldRecord?: Record<string, unknown> | null
): void {
  // Invalidate all time entries queries (task lists, date lists, daily summaries)
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.timeEntries.all });

  // If taskId is present, also invalidate operations task-related details
  const taskId = (
    record?.task_id ??
    record?.taskId ??
    oldRecord?.task_id ??
    oldRecord?.taskId
  ) as string | undefined;

  if (taskId) {
    void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(taskId) });
  }
}

/**
 * Invalidates domain counters upon CDC events.
 */
function invalidateCounts(queryClient: QueryClient, table: string): void {
  switch (table) {
    case 'work_requests':
      void queryClient.invalidateQueries({ queryKey: ['operations', 'workRequests', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: ['operations', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCreationApprovals() });
      break;
    case 'tasks':
      void queryClient.invalidateQueries({ queryKey: ['operations', 'workRequests', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: ['operations', 'counts'] });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCreationApprovals() });
      break;
    case 'invoices':
      void queryClient.invalidateQueries({ queryKey: ['billing', 'counts'] });
      break;
    case 'disbursements':
      void queryClient.invalidateQueries({ queryKey: ['disbursements', 'counts'] });
      break;
    case 'operations_requests':
      void queryClient.invalidateQueries({ queryKey: ['operations', 'requests', 'counts'] });
      break;
    case 'notifications':
      void queryClient.invalidateQueries({ queryKey: ['notifications', 'unread-count'] });
      break;
    case 'users':
    case 'user_departments':
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit', 'count'] });
      break;
    case 'audit_logs':
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'audit', 'count'] });
      break;
    default:
      void queryClient.invalidateQueries({ queryKey: [table, 'counts'] });
      break;
  }
}

/**
 * Updates tasks embedded in WorkRequest phases containers if present.
 */
function patchTaskInPhases(
  workRequest: GenericEntityRecord,
  taskId: string,
  updatedTask?: GenericEntityRecord
): GenericEntityRecord {
  if (!workRequest?.phases || typeof workRequest.phases !== 'object') {
    return workRequest;
  }

  let modified = false;
  const newPhases = { ...workRequest.phases };

  for (const phaseKey of Object.keys(newPhases)) {
    const container = newPhases[phaseKey];
    if (container && Array.isArray(container.tasks)) {
      if (container.tasks.some((t) => t?.id === taskId)) {
        modified = true;
        if (updatedTask) {
          newPhases[phaseKey] = {
            ...container,
            tasks: container.tasks.map((t) =>
              t?.id === taskId ? ({ ...t, ...updatedTask } as { id?: string }) : t
            ),
          };
        } else {
          newPhases[phaseKey] = {
            ...container,
            tasks: container.tasks.filter((t) => t?.id !== taskId),
          };
        }
      }
    }
  }

  return modified ? { ...workRequest, phases: newPhases } : workRequest;
}

/**
 * Scans the TanStack Query cache to locate the parent work_request_id for a given taskId
 * when CDC DELETE or soft-delete payloads lack parent foreign keys.
 */
export function findWrIdForTaskFromCache(queryClient: QueryClient, taskId: string): string | undefined {
  if (!taskId) return undefined;

  const allQueries = queryClient.getQueryCache().getAll();

  // 1. Inspect task detail query keys: ['operations', 'workRequests', 'detail', wrId, 'tasks', taskId]
  for (const query of allQueries) {
    const qKey = query.queryKey;
    if (Array.isArray(qKey) && qKey.includes(taskId)) {
      const qData = query.state.data as GenericEntityRecord | undefined;
      const wrId = qData?.work_request_id ?? qData?.workRequestId;
      if (typeof wrId === 'string' && wrId) {
        return wrId;
      }
      const tasksIdx = qKey.indexOf('tasks');
      if (tasksIdx > 0 && typeof qKey[tasksIdx - 1] === 'string') {
        return qKey[tasksIdx - 1] as string;
      }
    }
  }

  // 2. Inspect cached task lists and work requests with phases
  for (const query of allQueries) {
    const qData = query.state.data;
    if (!qData) continue;

    if (Array.isArray(qData)) {
      const found = qData.find((item: GenericEntityRecord) => item?.id === taskId);
      const wrId = found?.work_request_id ?? found?.workRequestId;
      if (typeof wrId === 'string' && wrId) return wrId;
    } else if (typeof qData === 'object' && 'data' in qData && Array.isArray((qData as GenericListResponse).data)) {
      const found = (qData as GenericListResponse).data.find((item) => item?.id === taskId);
      const wrId = found?.work_request_id ?? found?.workRequestId;
      if (typeof wrId === 'string' && wrId) return wrId;
    }

    if (typeof qData === 'object' && (qData as GenericEntityRecord).phases) {
      const phases = (qData as GenericEntityRecord).phases!;
      for (const phaseKey of Object.keys(phases)) {
        const container = phases[phaseKey];
        if (container?.tasks && Array.isArray(container.tasks)) {
          if (container.tasks.some((t) => t?.id === taskId)) {
            const wrId = (qData as GenericEntityRecord).id;
            if (typeof wrId === 'string' && wrId) return wrId;
          }
        }
      }
    }
  }

  return undefined;
}

function invalidateAllProjectProtectedCaches(queryClient: QueryClient, activeEntity?: string | null) {
  // Cancel in-flight scope reads so revoked data cannot be restored
  void queryClient.cancelQueries({ queryKey: operationsKeys.all });
  void queryClient.cancelQueries({ queryKey: billingKeys.all });
  void queryClient.cancelQueries({ queryKey: disbursementKeys.all });
  void queryClient.cancelQueries({ queryKey: transmittalKeys.all });
  void queryClient.cancelQueries({ queryKey: documentKeys.all });
  void queryClient.cancelQueries({ queryKey: dashboardKeys.assignedTasks.all });
  void queryClient.cancelQueries({ queryKey: dashboardKeys.timeEntries.all });
  void queryClient.cancelQueries({ queryKey: ['operations', 'time-entries'] });
  void queryClient.cancelQueries({ queryKey: ['operations', 'requests'] });

  // Invalidate so authorized views refetch via backend permissions
  void queryClient.invalidateQueries({ queryKey: operationsKeys.all });
  void queryClient.invalidateQueries({ queryKey: billingKeys.all });
  void queryClient.invalidateQueries({ queryKey: disbursementKeys.all });
  void queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
  void queryClient.invalidateQueries({ queryKey: documentKeys.all });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.assignedTasks.all });
  void queryClient.invalidateQueries({ queryKey: dashboardKeys.timeEntries.all });
  void queryClient.invalidateQueries({ queryKey: ['operations', 'time-entries'] });
  void queryClient.invalidateQueries({ queryKey: ['operations', 'requests'] });
  if (activeEntity) {
    void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
    void queryClient.invalidateQueries({ queryKey: operationsKeys.requestCounts(activeEntity) });
  }
}

/**
 * Core event handler for PostgreSQL CDC payloads.
 * Returns true if event was processed, false if dropped by one of the guards.
 */
export function handleRealtimePayload<T = Record<string, unknown>>(
  queryClient: QueryClient,
  options: UseEntityRealtimeSyncOptions<T>,
  payload: unknown
): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const rawPayload = payload as {
    eventType?: string;
    event?: string;
    new?: GenericEntityRecord;
    old?: GenericEntityRecord;
    commit_timestamp?: string;
  };

  const rawEventType = rawPayload.eventType || rawPayload.event;
  const eventType = rawEventType ? String(rawEventType).toUpperCase() : '';

  const payloadObj = {
    ...rawPayload,
    new:
      rawPayload.new &&
      typeof rawPayload.new === 'object' &&
      Object.keys(rawPayload.new).length > 0
        ? (normalizeCdcPayload(
            options.table,
            rawPayload.new as Record<string, unknown>
          ) as GenericEntityRecord)
        : rawPayload.new,
    old:
      rawPayload.old &&
      typeof rawPayload.old === 'object' &&
      Object.keys(rawPayload.old).length > 0
        ? (normalizeCdcPayload(
            options.table,
            rawPayload.old as Record<string, unknown>
          ) as GenericEntityRecord)
        : rawPayload.old,
  };

  if (rawPayload.new && typeof rawPayload.new === 'object') {
    try {
      rawPayload.new = payloadObj.new;
    } catch {
      // ignore non-extensible payload
    }
  }
  if (rawPayload.old && typeof rawPayload.old === 'object') {
    try {
      rawPayload.old = payloadObj.old;
    } catch {
      // ignore non-extensible payload
    }
  }

  const incomingRecord =
    payloadObj.new && Object.keys(payloadObj.new).length > 0 ? payloadObj.new : payloadObj.old;
  if (!incomingRecord) {
    return false;
  }

  const id =
    incomingRecord.id ??
    payloadObj.new?.id ??
    payloadObj.old?.id ??
    (options.table === 'task_assignees'
      ? ((incomingRecord.task_id || incomingRecord.taskId) &&
        (incomingRecord.user_id || incomingRecord.userId)
          ? `${String(incomingRecord.task_id ?? incomingRecord.taskId)}:${String(incomingRecord.user_id ?? incomingRecord.userId)}`
          : undefined)
      : options.table === 'user_departments'
        ? ((incomingRecord.user_id || incomingRecord.userId)
            ? `${String(incomingRecord.user_id ?? incomingRecord.userId)}:${String(incomingRecord.department_id ?? incomingRecord.departmentId ?? incomingRecord.department ?? 'dept')}`
            : undefined)
        : undefined);
  if (!id) {
    return false;
  }

  // User Isolation Guard for Notifications
  if (options.table === 'notifications') {
    const currentUserId = useSessionStore.getState().user?.id;
    const payloadUserId = incomingRecord.user_id ?? incomingRecord.userId;

    if (!payloadUserId || !currentUserId) {
      return false; // Discard: unassigned, null user, or unauthenticated
    }

    const matchesUser =
      String(payloadUserId).trim().toLowerCase() ===
      String(currentUserId).trim().toLowerCase();

    if (!matchesUser) {
      return false; // Discard: notification belongs to another user
    }
  }

  // =========================================================================
  // Guard 1: Tenant Isolation Guard
  // =========================================================================
  const activeEntity =
    options.activeEntity !== undefined
      ? options.activeEntity
      : useSessionStore.getState().activeEntity;
  const targetUUID = options.activeEntityUUID || resolveEntityUUID(activeEntity);

  if (
    options.table === 'task_assignees' ||
    options.table === 'users' ||
    options.table === 'user_departments' ||
    options.table === 'audit_logs'
  ) {
    // task_assignees, users, user_departments, and audit_logs are cross-entity or relational tables.
    // Never discard mounted assignment or admin events via single-entity tenant guards.
  } else if (activeEntity !== 'ALL') {
    // Preserve explicit null values; do not coalesce null into undefined
    const recordEntityId =
      incomingRecord.entity_id !== undefined
        ? incomingRecord.entity_id
        : incomingRecord.entityId;
    const recordEntity =
      incomingRecord.entity !== undefined
        ? incomingRecord.entity
        : incomingRecord.entity_code;

    // Gracefully allow tables like `tasks` where entity_id and entity are not present
    const hasEntityField = recordEntityId !== undefined || recordEntity !== undefined;
    if (hasEntityField) {
      // Discard if session is unassigned
      if (!activeEntity) {
        return false;
      }

      // Discard if payload has explicit null for entity identifiers
      if (recordEntityId === null && recordEntity === null) {
        return false;
      }
      if (recordEntityId === null && recordEntity === undefined) {
        return false;
      }
      if (recordEntity === null && recordEntityId === undefined) {
        return false;
      }

      const recordCode =
        recordEntity ||
        (recordEntityId != null
          ? (String(recordEntityId).trim().toUpperCase() === 'ATA' || String(recordEntityId).trim().toUpperCase() === 'LTA'
              ? String(recordEntityId).trim().toUpperCase()
              : resolveEntityCodeFromUUID(String(recordEntityId)))
          : undefined);
      const recordUUID =
        (recordEntityId != null && String(recordEntityId).includes('-') ? String(recordEntityId) : undefined) ||
        (recordCode != null ? resolveEntityUUID(String(recordCode)) : undefined);

      // 1. UUID matching: Case-insensitive and trimmed (RFC 4122 compliance)
      const matchesUUID = Boolean(
        targetUUID &&
        recordUUID &&
        String(recordUUID).trim().toLowerCase() === String(targetUUID).trim().toLowerCase()
      );

      // 2. Entity code matching: Case-insensitive and trimmed
      const matchesEntityCode = Boolean(
        activeEntity &&
        recordCode &&
        String(recordCode).trim().toUpperCase() === String(activeEntity).trim().toUpperCase()
      );

      const matches = matchesUUID || matchesEntityCode;

      if (!matches) {
        // Discard: cross-tenant, null-tenant, or unassigned-session event
        return false;
      }
    }
  }

  // =========================================================================
  // Query Keys & Soft-Delete Detection (Pre-Guard 2)
  // =========================================================================
  const detailKey = options.detailQueryKey
    ? options.detailQueryKey(id, incomingRecord as T)
    : getDefaultDetailQueryKey(options.table, id, incomingRecord);
  const listRootKey = options.listRootKey ?? getDefaultListRootKey(options.table);

  // Soft-delete detection and event classification (executed before Guard 2)
  const isSoftDeleted = isSoftDeleteRecord(incomingRecord);
  const isDelete =
    eventType === 'DELETE' ||
    isSoftDeleted ||
    (eventType !== 'UPDATE' && !payloadObj.new && Boolean(payloadObj.old));
  const isInsert =
    !isDelete &&
    (eventType === 'INSERT' ||
      (eventType !== 'UPDATE' && Boolean(payloadObj.new) && !payloadObj.old));

  // =========================================================================
  // Guard 2: Stale Version Rejection Guard
  // =========================================================================
  const incomingVersion = payloadObj.new?.version;

  // Soft-deletes and hard deletes bypass Guard 2 version checks so they are never dropped by version equality
  if (!isDelete && typeof incomingVersion === 'number') {
    let localCachedVersion: number | undefined = undefined;

    // 1. Inspect detail cache
    if (detailKey) {
      const detailData = queryClient.getQueryData<GenericEntityRecord>(detailKey);
      if (detailData && typeof detailData.version === 'number') {
        localCachedVersion = detailData.version;
      }
    }

    // 2. Inspect list caches under listRootKey
    if (listRootKey) {
      const matchingQueries = queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
        queryKey: listRootKey,
      });
      for (const [, listData] of matchingQueries) {
        if (!listData) continue;
        let itemVersion: number | undefined = undefined;

        if (Array.isArray(listData)) {
          const found = listData.find((item) => item?.id === id);
          if (found && typeof found.version === 'number') {
            itemVersion = found.version;
          }
        } else if (Array.isArray(listData?.data)) {
          const found = listData.data.find((item) => item?.id === id);
          if (found && typeof found.version === 'number') {
            itemVersion = found.version;
          }
        }

        if (typeof itemVersion === 'number') {
          if (localCachedVersion === undefined || itemVersion > localCachedVersion) {
            localCachedVersion = itemVersion;
          }
        }
      }
    }

    if (typeof localCachedVersion === 'number') {
      const isStale = isInsert
        ? incomingVersion <= localCachedVersion
        : incomingVersion < localCachedVersion;
      if (isStale) {
        return false;
      }
    }
  }

  // =========================================================================
  // Guard 3: Loop Prevention Guard
  // =========================================================================
  if (isSelfOriginatedPayload(payload)) {
    // Discard: originated by current browser tab
    return false;
  }

  if (isLocalMutation(options.table, id, incomingVersion)) {
    // Discard: local mutation recently dispatched in this tab
    return false;
  }

  // =========================================================================
  // Guards Passed: TanStack Query Cache Reconciliation
  // =========================================================================
  if (isDelete) {
    // Resolve targetWrId for tasks with fallback scan across TanStack query cache
    let targetWrId = (
      payloadObj.new?.work_request_id ??
      payloadObj.new?.workRequestId ??
      payloadObj.old?.work_request_id ??
      payloadObj.old?.workRequestId ??
      incomingRecord.work_request_id ??
      incomingRecord.workRequestId
    ) as string | undefined;

    if (options.table === 'tasks' && !targetWrId) {
      targetWrId = findWrIdForTaskFromCache(queryClient, id);
    }

    // If detailKey was undefined due to missing work_request_id in bare DELETE payload, reconstruct it
    const effectiveDetailKey =
      detailKey ?? (options.table === 'tasks' && targetWrId ? operationsKeys.taskDetail(targetWrId, id) : undefined);

    // Remove detail cache
    if (effectiveDetailKey) {
      queryClient.removeQueries({ queryKey: effectiveDetailKey });
    } else if (options.table === 'tasks') {
      // Fallback: remove any taskDetail query matching this taskId
      queryClient.removeQueries({
        predicate: (query) => {
          const qKey = query.queryKey;
          return Array.isArray(qKey) && qKey.includes('tasks') && qKey.includes(id);
        },
      });
    }

    // Filter out from matching list caches
    if (listRootKey) {
      const matchingQueries = queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
        queryKey: listRootKey,
      });
      if (options.table === 'disbursements') {
        matchingQueries.push(
          ...queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
            queryKey: ['disbursements', 'all-for-queue'],
          }),
          ...queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
            queryKey: ['disbursements', 'all-for-status'],
          })
        );
      }
      let deletedUnreadNotification = false;
      for (const [qKey, listData] of matchingQueries) {
        if (!listData) continue;

        if (Array.isArray(listData)) {
          if (listData.some((item) => item?.id === id)) {
            queryClient.setQueryData(
              qKey,
              listData.filter((item) => item?.id !== id)
            );
          }
        } else if (Array.isArray(listData?.data)) {
          if (listData.data.some((item) => item?.id === id)) {
            const deletedItem = listData.data.find((item) => item?.id === id);
            const wasUnread =
              options.table === 'notifications' &&
              Boolean(deletedItem && !deletedItem.read_at && !deletedItem.readAt);

            if (wasUnread) {
              deletedUnreadNotification = true;
            }

            queryClient.setQueryData(qKey, {
              ...listData,
              data: listData.data.filter((item) => item?.id !== id),
              meta: listData.meta
                ? {
                    ...listData.meta,
                    total: Math.max(0, (listData.meta.total ?? listData.data.length) - 1),
                    unreadCount:
                      wasUnread && typeof listData.meta.unreadCount === 'number'
                        ? Math.max(0, listData.meta.unreadCount - 1)
                        : listData.meta.unreadCount,
                    unread_count:
                      wasUnread && typeof listData.meta.unread_count === 'number'
                        ? Math.max(0, listData.meta.unread_count - 1)
                        : listData.meta.unread_count,
                  }
                : listData.meta,
            });
          }
        }

        if (options.table === 'tasks') {
          if (!Array.isArray(listData) && typeof listData === 'object' && 'phases' in listData) {
            const candidateRecord = listData as unknown as GenericEntityRecord;
            queryClient.setQueryData(qKey, patchTaskInPhases(candidateRecord, id, undefined));
          } else if (
            typeof listData === 'object' &&
            'data' in listData &&
            Array.isArray((listData as GenericListResponse).data)
          ) {
            const resp = listData as GenericListResponse;
            const hasPhases = resp.data.some((item) => Boolean(item?.phases));
            if (hasPhases) {
              queryClient.setQueryData(qKey, {
                ...resp,
                data: resp.data.map((wr) => patchTaskInPhases(wr, id, undefined)),
              });
            }
          }
        }
      }

      if (options.table === 'tasks') {
        const wrQueries = queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
          queryKey: operationsKeys.workRequests(),
        });
        for (const [wrQKey, wrListData] of wrQueries) {
          if (!wrListData) continue;
          if (!Array.isArray(wrListData) && typeof wrListData === 'object' && 'phases' in wrListData) {
            const candidateRecord = wrListData as unknown as GenericEntityRecord;
            queryClient.setQueryData(wrQKey, patchTaskInPhases(candidateRecord, id, undefined));
          } else if (
            typeof wrListData === 'object' &&
            'data' in wrListData &&
            Array.isArray((wrListData as GenericListResponse).data)
          ) {
            const resp = wrListData as GenericListResponse;
            const hasPhases = resp.data.some((item) => Boolean(item?.phases));
            if (hasPhases) {
              queryClient.setQueryData(wrQKey, {
                ...resp,
                data: resp.data.map((wr) => patchTaskInPhases(wr, id, undefined)),
              });
            }
          }
        }
      }

      if (options.table === 'notifications') {
        const wasUnread =
          deletedUnreadNotification ||
          Boolean(
            payloadObj.old &&
              (payloadObj.old.read_at !== undefined || payloadObj.old.readAt !== undefined) &&
              !payloadObj.old.read_at &&
              !payloadObj.old.readAt
          );
        if (wasUnread) {
          const deleteTimestamp =
            payloadObj.new?.deleted_at ??
            payloadObj.new?.deletedAt ??
            payloadObj.old?.deleted_at ??
            payloadObj.old?.deletedAt ??
            rawPayload.commit_timestamp ??
            'deleted';
          const eventToken = `notifications:delete:${id}:${deleteTimestamp}`;
          if (recordNotificationEvent(eventToken)) {
            const currentUnread = useSessionStore.getState().unreadCount;
            useSessionStore.getState().setUnreadCount(Math.max(0, currentUnread - 1));
          }
        }
      }
    }

    // Purge embedded task objects from workRequestDetail if targetWrId is known
    if (options.table === 'tasks') {
      if (!targetWrId) {
        targetWrId = findWrIdForTaskFromCache(queryClient, id);
      }

      if (targetWrId) {
        const wrDetailKey = operationsKeys.workRequestDetail(targetWrId);
        const wrData = queryClient.getQueryData<GenericEntityRecord>(wrDetailKey);
        if (wrData?.phases) {
          queryClient.setQueryData(wrDetailKey, patchTaskInPhases(wrData, id, undefined));
        }
        triggerTaskCoInvalidations(queryClient, targetWrId, id, activeEntity);
      }
    }

    if (options.table === 'task_assignees') {
      invalidateAllProjectProtectedCaches(queryClient, activeEntity);
    }
  } else if (
    ['work_requests', 'tasks', 'operations_requests', 'user_departments'].includes(options.table) ||
    (String(useSessionStore.getState().user?.role || '').trim().toLowerCase() !== 'admin' &&
    ['invoices', 'disbursements', 'transmittals', 'documents', 'time_entries', 'task_time_logs', 'task_assignees'].includes(options.table))
  ) {
    // 360° Shared Project Team Visibility Rule (F01–F10, Directive 3):
    // For operations tables and non-admin users, raw CDC INSERT/UPDATE payloads must NOT be injected directly into query caches.
    // Instead, invalidate queries so TanStack Query refetches freshly authorized data through backend authorization.
    if (detailKey) {
      void queryClient.invalidateQueries({ queryKey: detailKey });
    }
    if (listRootKey) {
      void queryClient.invalidateQueries({ queryKey: listRootKey });
    }
    if (options.table === 'disbursements') {
      void queryClient.invalidateQueries({ queryKey: ['disbursements', 'all-for-queue'] });
      void queryClient.invalidateQueries({ queryKey: ['disbursements', 'all-for-status'] });
    }
    if (options.table === 'tasks') {
      let targetWrId = (
        payloadObj.new?.work_request_id ??
        payloadObj.new?.workRequestId ??
        payloadObj.old?.work_request_id ??
        payloadObj.old?.workRequestId ??
        incomingRecord.work_request_id ??
        incomingRecord.workRequestId
      ) as string | undefined;
      if (!targetWrId) {
        targetWrId = findWrIdForTaskFromCache(queryClient, id);
      }
      if (targetWrId) {
        void queryClient.invalidateQueries({ queryKey: operationsKeys.tasks(targetWrId) });
        void queryClient.invalidateQueries({ queryKey: operationsKeys.taskDetail(targetWrId, id) });
        void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(targetWrId) });
      }
      void queryClient.invalidateQueries({ queryKey: [...operationsKeys.workRequests(), 'list'] });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.taskRelated(id) });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
    }
    if (options.table === 'work_requests') {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestDetail(id) });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestRelated(id) });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequests() });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCounts(activeEntity) });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.workRequestCreationApprovals() });
    }
    if (options.table === 'operations_requests') {
      void queryClient.invalidateQueries({ queryKey: operationsKeys.requests() });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.requestCounts(activeEntity) });
      void queryClient.invalidateQueries({ queryKey: operationsKeys.requestDetail(id) });
    }

    // Check for assignment changes on work_requests, tasks, or task_assignees
    const isWrAssignmentChange =
      options.table === 'work_requests' &&
      ((payloadObj.new?.assigned_to ?? payloadObj.new?.assignedTo) !== (payloadObj.old?.assigned_to ?? payloadObj.old?.assignedTo) ||
        JSON.stringify(payloadObj.new?.co_assignees ?? payloadObj.new?.coAssignees) !== JSON.stringify(payloadObj.old?.co_assignees ?? payloadObj.old?.coAssignees));

    const isTaskAssignmentChange =
      options.table === 'tasks' &&
      ((payloadObj.new?.assignee_id ?? payloadObj.new?.assigneeId) !== (payloadObj.old?.assignee_id ?? payloadObj.old?.assigneeId) ||
        JSON.stringify(payloadObj.new?.assignees) !== JSON.stringify(payloadObj.old?.assignees));

    if (isWrAssignmentChange || isTaskAssignmentChange || options.table === 'task_assignees') {
      invalidateAllProjectProtectedCaches(queryClient, activeEntity);
    }
  } else if (isInsert) {
    // Populate detail cache
    if (detailKey && payloadObj.new) {
      queryClient.setQueryData(detailKey, payloadObj.new);
    }

    // Prepend to matching list caches
    if (listRootKey && payloadObj.new) {
      const targetWrId = (
        payloadObj.new.work_request_id ??
        payloadObj.new.workRequestId ??
        incomingRecord.work_request_id ??
        incomingRecord.workRequestId
      ) as string | undefined;

      const matchingQueries = queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
        queryKey: listRootKey,
      });
      if (options.table === 'disbursements') {
        matchingQueries.push(
          ...queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
            queryKey: ['disbursements', 'all-for-queue'],
          }),
          ...queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
            queryKey: ['disbursements', 'all-for-status'],
          })
        );
      }

      // Deduplication check: for notifications, verify whether notification ID already exists in query list
      let alreadyExistsInList = false;
      if (options.table === 'notifications') {
        for (const [, listData] of matchingQueries) {
          if (!listData) continue;
          if (Array.isArray(listData)) {
            if (listData.some((item) => item?.id === id)) {
              alreadyExistsInList = true;
              break;
            }
          } else if (Array.isArray(listData?.data)) {
            if (listData.data.some((item) => item?.id === id)) {
              alreadyExistsInList = true;
              break;
            }
          }
        }
      }

      if (!alreadyExistsInList) {
        for (const [qKey, listData] of matchingQueries) {
          if (!listData) continue;

          // Scoped matcher for tasks: only prepend to matching parent work request query
          if (options.table === 'tasks') {
            // Guard: Never prepend task records to work request list queries
            if (
              Array.isArray(qKey) &&
              qKey.length >= 3 &&
              qKey[0] === 'operations' &&
              qKey[1] === 'workRequests' &&
              qKey[2] === 'list'
            ) {
              continue;
            }
            if (!targetWrId || !isTaskListOfTargetWr(qKey, targetWrId)) {
              continue;
            }
          }

          // Scoped matcher for time entries: only prepend to matching task query if query is filtered by taskId
          if (options.table === 'time_entries' || options.table === 'task_time_logs') {
            const entryTaskId = (payloadObj.new?.task_id ?? payloadObj.new?.taskId) as string | undefined;
            const filterObj = Array.isArray(qKey)
              ? (qKey.find((k) => k && typeof k === 'object' && ('taskId' in k || 'task_id' in k)) as { taskId?: string; task_id?: string } | undefined)
              : undefined;
            const filterTaskId = filterObj?.taskId ?? filterObj?.task_id;
            if (filterTaskId && entryTaskId && filterTaskId !== entryTaskId) {
              continue;
            }
          }

          if (Array.isArray(listData)) {
            if (!listData.some((item) => item?.id === id)) {
              queryClient.setQueryData(qKey, [payloadObj.new, ...listData]);
            }
          } else if (Array.isArray(listData?.data)) {
            if (!listData.data.some((item) => item?.id === id)) {
              const isUnread =
                options.table === 'notifications' &&
                !payloadObj.new.read_at &&
                !payloadObj.new.readAt;

              queryClient.setQueryData(qKey, {
                ...listData,
                data: [payloadObj.new, ...listData.data],
                meta: listData.meta
                  ? {
                      ...listData.meta,
                      total: (listData.meta.total ?? listData.data.length) + 1,
                      unreadCount:
                        isUnread
                          ? (listData.meta.unreadCount ?? 0) + 1
                          : listData.meta.unreadCount,
                      unread_count:
                        isUnread
                          ? (listData.meta.unread_count ?? 0) + 1
                          : listData.meta.unread_count,
                    }
                  : listData.meta,
              });
            }
          }
        }

        // If notification insert is unread, increment sessionStore unreadCount in real time (deduplicated)
        if (options.table === 'notifications' && !payloadObj.new.read_at && !payloadObj.new.readAt) {
          const createTimestamp =
            payloadObj.new.created_at ??
            payloadObj.new.createdAt ??
            rawPayload.commit_timestamp ??
            'created';
          const eventToken = `notifications:insert:${id}:${createTimestamp}`;
          if (recordNotificationEvent(eventToken)) {
            const currentUnread = useSessionStore.getState().unreadCount;
            useSessionStore.getState().setUnreadCount(currentUnread + 1);
          }
        }
      }
    }

    if (
      payloadObj.new &&
      (options.table === 'disbursements' || options.table === 'invoices') &&
      Boolean(
        payloadObj.new.linked_invoice_id ||
          payloadObj.new.linkedInvoiceId ||
          payloadObj.new.linked_transmittal_id ||
          payloadObj.new.linkedTransmittalId
      )
    ) {
      if (detailKey) {
        void queryClient.invalidateQueries({ queryKey: detailKey });
      }
      if (listRootKey) {
        void queryClient.invalidateQueries({ queryKey: listRootKey });
      }
    }
  } else {
    // UPDATE
    let anyLinksChanged = false;

    if (
      (options.table === 'disbursements' || options.table === 'invoices') &&
      payloadObj.old &&
      payloadObj.new
    ) {
      const oldCheck = mergeCdcRecordPreservingEnrichedLinks(
        options.table,
        payloadObj.old as Record<string, unknown>,
        payloadObj.new
      );
      if (oldCheck.linksChanged) {
        anyLinksChanged = true;
      }
    }

    // Patch detail cache
    if (detailKey && payloadObj.new) {
      queryClient.setQueryData(detailKey, (old: unknown) => {
        if (!old || typeof old !== 'object') {
          const res = mergeCdcRecordPreservingEnrichedLinks(options.table, undefined, payloadObj.new!);
          if (res.linksChanged) anyLinksChanged = true;
          return payloadObj.new;
        }
        const res = mergeCdcRecordPreservingEnrichedLinks(
          options.table,
          old as Record<string, unknown>,
          payloadObj.new!
        );
        if (res.linksChanged) anyLinksChanged = true;
        return res.merged;
      });
    }

    // Patch matching list caches
    if (listRootKey && payloadObj.new) {
      const matchingQueries = queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
        queryKey: listRootKey,
      });
      if (options.table === 'disbursements') {
        matchingQueries.push(
          ...queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
            queryKey: ['disbursements', 'all-for-queue'],
          }),
          ...queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
            queryKey: ['disbursements', 'all-for-status'],
          })
        );
      }
      let transitionedToRead = false;
      for (const [qKey, listData] of matchingQueries) {
        if (!listData) continue;

        if (Array.isArray(listData)) {
          if (listData.some((item) => item?.id === id)) {
            queryClient.setQueryData(
              qKey,
              listData.map((item) => {
                if (item?.id !== id) return item;
                const res = mergeCdcRecordPreservingEnrichedLinks(
                  options.table,
                  item as Record<string, unknown>,
                  payloadObj.new!
                );
                if (res.linksChanged) anyLinksChanged = true;
                return res.merged;
              })
            );
          }
        } else if (Array.isArray(listData?.data)) {
          if (listData.data.some((item) => item?.id === id)) {
            const oldItem = listData.data.find((item) => item?.id === id);
            const wasUnread =
              options.table === 'notifications' &&
              Boolean(oldItem && !oldItem.read_at && !oldItem.readAt);
            const isNowRead =
              options.table === 'notifications' &&
              Boolean(payloadObj.new.read_at || payloadObj.new.readAt);
            const isTransitionToRead = wasUnread && isNowRead;

            if (isTransitionToRead) {
              transitionedToRead = true;
            }

            queryClient.setQueryData(qKey, {
              ...listData,
              data: listData.data.map((item) => {
                if (item?.id !== id) return item;
                const res = mergeCdcRecordPreservingEnrichedLinks(
                  options.table,
                  item as Record<string, unknown>,
                  payloadObj.new!
                );
                if (res.linksChanged) anyLinksChanged = true;
                return res.merged;
              }),
              meta:
                listData.meta && isTransitionToRead
                  ? {
                      ...listData.meta,
                      unreadCount:
                        typeof listData.meta.unreadCount === 'number'
                          ? Math.max(0, listData.meta.unreadCount - 1)
                          : listData.meta.unreadCount,
                      unread_count:
                        typeof listData.meta.unread_count === 'number'
                          ? Math.max(0, listData.meta.unread_count - 1)
                          : listData.meta.unread_count,
                    }
                  : listData.meta,
            });
          }
        }

        if (options.table === 'tasks') {
          if (!Array.isArray(listData) && typeof listData === 'object' && 'phases' in listData) {
            const candidateRecord = listData as unknown as GenericEntityRecord;
            queryClient.setQueryData(qKey, patchTaskInPhases(candidateRecord, id, payloadObj.new));
          } else if (
            typeof listData === 'object' &&
            'data' in listData &&
            Array.isArray((listData as GenericListResponse).data)
          ) {
            const resp = listData as GenericListResponse;
            const hasPhases = resp.data.some((item) => Boolean(item?.phases));
            if (hasPhases) {
              queryClient.setQueryData(qKey, {
                ...resp,
                data: resp.data.map((wr) => patchTaskInPhases(wr, id, payloadObj.new)),
              });
            }
          }
        }
      }

      if (options.table === 'tasks') {
        const wrQueries = queryClient.getQueriesData<GenericListResponse | GenericEntityRecord[]>({
          queryKey: operationsKeys.workRequests(),
        });
        for (const [wrQKey, wrListData] of wrQueries) {
          if (!wrListData) continue;
          if (!Array.isArray(wrListData) && typeof wrListData === 'object' && 'phases' in wrListData) {
            const candidateRecord = wrListData as unknown as GenericEntityRecord;
            queryClient.setQueryData(wrQKey, patchTaskInPhases(candidateRecord, id, payloadObj.new));
          } else if (
            typeof wrListData === 'object' &&
            'data' in wrListData &&
            Array.isArray((wrListData as GenericListResponse).data)
          ) {
            const resp = wrListData as GenericListResponse;
            const hasPhases = resp.data.some((item) => Boolean(item?.phases));
            if (hasPhases) {
              queryClient.setQueryData(wrQKey, {
                ...resp,
                data: resp.data.map((wr) => patchTaskInPhases(wr, id, payloadObj.new)),
              });
            }
          }
        }
      }

      if (options.table === 'notifications') {
        const wasTransitionToRead =
          transitionedToRead ||
          Boolean(
            payloadObj.old &&
              (payloadObj.old.read_at !== undefined || payloadObj.old.readAt !== undefined) &&
              !payloadObj.old.read_at &&
              !payloadObj.old.readAt &&
              (payloadObj.new.read_at || payloadObj.new.readAt)
          );
        if (wasTransitionToRead) {
          const readTimestamp =
            payloadObj.new.read_at ??
            payloadObj.new.readAt ??
            payloadObj.new.updated_at ??
            payloadObj.new.updatedAt ??
            rawPayload.commit_timestamp ??
            'read';
          const eventToken = `notifications:read:${id}:${readTimestamp}`;
          if (recordNotificationEvent(eventToken)) {
            const currentUnread = useSessionStore.getState().unreadCount;
            useSessionStore.getState().setUnreadCount(Math.max(0, currentUnread - 1));
          }
        }
      }
    }

    // Update phases in workRequestDetail directly if targetWrId is known
    if (options.table === 'tasks' && payloadObj.new) {
      const targetWrId = (
        payloadObj.new?.work_request_id ??
        payloadObj.new?.workRequestId ??
        incomingRecord.work_request_id ??
        incomingRecord.workRequestId
      ) as string | undefined;

      if (targetWrId) {
        const wrDetailKey = operationsKeys.workRequestDetail(targetWrId);
        const wrData = queryClient.getQueryData<GenericEntityRecord>(wrDetailKey);
        if (wrData?.phases) {
          queryClient.setQueryData(wrDetailKey, patchTaskInPhases(wrData, id, payloadObj.new));
        }
      }
    }

    if (anyLinksChanged) {
      if (detailKey) {
        void queryClient.invalidateQueries({ queryKey: detailKey });
      }
      if (listRootKey) {
        void queryClient.invalidateQueries({ queryKey: listRootKey });
      }
    }
  }

  // Invalidate domain counter queries
  invalidateCounts(queryClient, options.table);

  // Trigger task mutation co-invalidations
  if (options.table === 'tasks') {
    let targetWrId = (
      payloadObj.new?.work_request_id ??
      payloadObj.new?.workRequestId ??
      payloadObj.old?.work_request_id ??
      payloadObj.old?.workRequestId ??
      incomingRecord.work_request_id ??
      incomingRecord.workRequestId
    ) as string | undefined;

    if (!targetWrId) {
      targetWrId = findWrIdForTaskFromCache(queryClient, id);
    }

    if (targetWrId) {
      triggerTaskCoInvalidations(queryClient, targetWrId, id, activeEntity);
    }
  }

  // Trigger cross-domain co-invalidations
  triggerCrossDomainCoInvalidations(
    queryClient,
    options.table,
    incomingRecord as Record<string, unknown>,
    activeEntity
  );

  // Trigger assigned tasks co-invalidation with strict user isolation (SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R3)
  triggerAssignedTasksCoInvalidation(
    queryClient,
    options.table,
    payloadObj.new as Record<string, unknown> | undefined,
    payloadObj.old as Record<string, unknown> | undefined,
    isDelete
  );

  // Trigger time entries co-invalidation (SPEC-REALTIME-TIME-LOGGING-001)
  if (options.table === 'time_entries' || options.table === 'task_time_logs') {
    triggerTimeEntryCoInvalidation(
      queryClient,
      options.table,
      payloadObj.new as Record<string, unknown> | undefined,
      payloadObj.old as Record<string, unknown> | undefined
    );
  }

  return true;
}

/**
 * Shared channel subscription entry managing multi-component multiplexing.
 */
interface ChannelSubscriptionEntry {
  channel: ReturnType<typeof supabase.channel>;
  subscribers: Set<(payload: unknown) => void>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Module-level tracking of processed notification counter mutation tokens
 * to prevent duplicate increments/decrements across multiple subscribers and replayed events.
 */
const MAX_PROCESSED_NOTIFICATION_EVENTS = 2000;
const processedNotificationEvents = new Set<string>();

function recordNotificationEvent(token: string): boolean {
  if (processedNotificationEvents.has(token)) {
    return false;
  }
  if (processedNotificationEvents.size >= MAX_PROCESSED_NOTIFICATION_EVENTS) {
    const oldest = processedNotificationEvents.keys().next().value;
    if (oldest !== undefined) {
      processedNotificationEvents.delete(oldest);
    }
  }
  processedNotificationEvents.add(token);
  return true;
}

/**
 * Module-level channel subscription registry for reference counting and
 * preventing cross-component unmount teardown collision.
 */
const activeChannelRegistry = new Map<string, ChannelSubscriptionEntry>();

/**
 * Testing helper to reset channel registry state between test suites.
 */
export function clearChannelRegistryForTesting(): void {
  for (const entry of activeChannelRegistry.values()) clearTimeout(entry.reconnectTimer);
  activeChannelRegistry.clear();
  processedNotificationEvents.clear();
}

/**
 * Testing helper to inspect active channel registry size.
 */
export function getActiveChannelRegistrySizeForTesting(): number {
  return activeChannelRegistry.size;
}

/**
 * Generic React hook for subscribing to Supabase PostgreSQL CDC changes.
 */
export function useEntityRealtimeSync<T = Record<string, unknown>>(
  options: UseEntityRealtimeSyncOptions<T>
): void {
  const queryClient = useQueryClient();
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    // Early exit if globally disabled or explicitly disabled via options
    if (options.enabled === false) {
      return;
    }

    if (!isFeatureEnabled('realtime_sync')) {
      return;
    }

    const channelName = options.channelName ?? `cdc_${options.table}`;
    const registryKey = options.channelName
      ? `custom:${options.channelName}`
      : `table:${options.table}${options.filter ? `:${options.filter}` : ''}`;

    // Handler for this specific hook instance
    const handlePayload = (payload: unknown) => {
      handleRealtimePayload(queryClient, optionsRef.current, payload);
    };

    let entry = activeChannelRegistry.get(registryKey);

    if (!entry) {
      const subscribers = new Set<(payload: unknown) => void>();
      let reconnectAttempt = 0;
      const connect = () => {
        // First component subscribing: create Supabase channel and bind single listener
        const channel = supabase.channel(channelName);

        channel.on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: options.table,
            ...(options.filter ? { filter: options.filter } : {}),
          },
          (payload) => {
            const currentEntry = activeChannelRegistry.get(registryKey);
            if (currentEntry?.channel === channel) {
              for (const subCallback of currentEntry.subscribers) {
                try {
                  subCallback(payload);
                } catch (err) {
                  console.error('[Realtime] Error in subscriber callback:', err);
                }
              }
            }
          }
        );

        const newEntry: ChannelSubscriptionEntry = { channel, subscribers };
        activeChannelRegistry.set(registryKey, newEntry);
        channel.subscribe((status, err) => {
          // Ignore late callbacks from channels intentionally removed/replaced.
          if (activeChannelRegistry.get(registryKey) !== newEntry) return;
          if (status === 'SUBSCRIBED') {
            clearTimeout(newEntry.reconnectTimer);
            newEntry.reconnectTimer = undefined;
            reconnectAttempt = 0;
            // Reconcile changes missed while this operations channel was disconnected.
            if (['work_requests', 'tasks', 'operations_requests'].includes(options.table)) {
              void queryClient.invalidateQueries({ queryKey: operationsKeys.all });
            }
            return;
          }
          const error = err as { message?: string; cause?: { code?: number; wasClean?: boolean } } | undefined;
          const cleanClose = error?.cause?.wasClean || [1000, 1001].includes(error?.cause?.code ?? 0) || /socket closed: 100[01]/.test(error?.message || '');
          if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && !cleanClose) {
            console.warn(`[Realtime] Subscription error (${status}) on ${options.table}:`, err);
          }
          // Transport errors/timeouts are retried by the SDK. Removing the channel
          // here destroys its subscribers and prevents that automatic recovery.
          if (status === 'CLOSED' && !newEntry.reconnectTimer) {
            newEntry.reconnectTimer = setTimeout(() => {
              if (activeChannelRegistry.get(registryKey) !== newEntry || !subscribers.size) return;
              void supabase.removeChannel(channel).then(() => {
                if (subscribers.size && activeChannelRegistry.get(registryKey) === newEntry) connect();
              });
            }, Math.min(1000 * 2 ** reconnectAttempt++, 30000));
          }
        });
        return newEntry;
      };
      entry = connect();
    }

    // Register this component's callback
    entry.subscribers.add(handlePayload);

    // Teardown: unregister callback and remove channel ONLY when last subscriber unmounts
    return () => {
      entry.subscribers.delete(handlePayload);
      const currentEntry = activeChannelRegistry.get(registryKey);
      if (currentEntry) {

        if (currentEntry.subscribers.size === 0) {
          activeChannelRegistry.delete(registryKey);
          clearTimeout(currentEntry.reconnectTimer);
          void supabase.removeChannel(currentEntry.channel);
        }
      }
    };
  }, [queryClient, options.table, options.channelName, options.enabled, options.filter]);
}
