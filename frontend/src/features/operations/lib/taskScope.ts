import type { UserProfile } from '@/lib/session';
import type {
  Task,
  WorkRequest,
  TaskRelatedRecords,
  TaskRelatedInvoice,
  TaskRelatedDisbursement,
  TaskRelatedTransmittal,
} from '../api/types';

/**
 * Checks if the user is an assigned employee on this specific task
 * (either primary lead assignee or in the co-assignees / task_assignees list).
 */
export function isTaskAssignee(user: UserProfile | string | null | undefined, task: Task | null | undefined): boolean {
  const userId = typeof user === 'string' ? user : user?.id;
  if (!userId || !task) return false;
  if ((task.assigneeId || (task as Task & { assignee_id?: string }).assignee_id) === userId) return true;
  const aliases = task as Task & {
    coAssignees?: unknown; co_assignees?: unknown;
    relationalAssignees?: unknown; relational_assignees?: unknown;
  };
  const lists = [task.assignees, task.taskAssignees, task.task_assignees,
    aliases.coAssignees, aliases.co_assignees, aliases.relationalAssignees, aliases.relational_assignees];
  if (lists.some((list) => Array.isArray(list) && list.some((entry: unknown) => {
    if (typeof entry === 'string') return entry === userId;
    if (!entry || typeof entry !== 'object') return false;
    const member = entry as { userId?: string; user_id?: string; id?: string };
    return member.userId === userId || member.user_id === userId || member.id === userId;
  }))) return true;
  return false;
}

export function isUserDocumentation(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return (
    String(user.role || '').toLowerCase() === 'documentation' ||
    (Array.isArray(user.departments) &&
      user.departments.some((d) => String(d).toLowerCase() === 'documentation'))
  );
}

export function isUserAccounting(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return (
    String(user.role || '').toLowerCase() === 'accounting' ||
    (Array.isArray(user.departments) &&
      user.departments.some((d) => String(d).toLowerCase() === 'accounting'))
  );
}

/**
 * Checks if a task is of type 'billing' (requiredLinkType === 'billing' or legacy 'invoice').
 */
export function isBillingTask(task: Task | null | undefined): boolean {
  if (!task) return false;
  const raw =
    task.requiredLinkType ??
    (task as Task & { required_link_type?: string | null }).required_link_type ??
    '';
  const normalized = String(raw || '').toLowerCase().trim();
  return normalized === 'billing' || normalized === 'invoice';
}

/**
 * Checks if a user is part of the parent Work Request:
 * - Lead manager/assignee on the WR
 * - Listed in the WR's co-assignees
 * - OR assigned to ANY task within this Work Request
 */
export function isWrTeamMember(
  user: UserProfile | string | null | undefined,
  workRequest: WorkRequest | null | undefined,
  tasks: Task[] = []
): boolean {
  if (!user || !workRequest) return false;
  const userId = typeof user === 'string' ? user : user.id;
  if (!userId) return false;

  const leadId =
    workRequest.assignedTo ??
    (workRequest as { assigned_to?: string | null }).assigned_to;
  if (leadId === userId) return true;

  const coAssignees =
    workRequest.coAssignees ??
    (workRequest as { co_assignees?: unknown }).co_assignees;
  if (
    Array.isArray(coAssignees) &&
    coAssignees.some((id: unknown) => id === userId)
  ) {
    return true;
  }

  const effectiveTasks = tasks.length > 0 ? tasks : (Array.isArray(workRequest.tasks) ? workRequest.tasks : []);
  if (effectiveTasks.some((t) => isTaskAssignee(user, t))) return true;
  return false;
}

/**
 * Checks if a user is an Admin
 */
export function isUserAdmin(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'Admin' || user.email === 'lorein@ata-lta.ph';
}

/**
 * Checks if a Manager also belongs to the Operations department
 */
export function isManagerWithOperations(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return (
    user.role === 'Manager' &&
    Array.isArray(user.departments) &&
    user.departments.some((d) => String(d).toLowerCase() === 'operations')
  );
}

/**
 * Only the assigned employee (or Admin) can mark task as In Progress or Complete.
 * Non-Admin Accounting users can only mutate status on 'billing' tasks assigned to them.
 */
export function canMutateTaskStatus(user: UserProfile | null | undefined, task: Task | null | undefined): boolean {
  if (!user || !task) return false;
  if (isUserAdmin(user)) return true;
  if (isUserAccounting(user)) {
    return isTaskAssignee(user, task) && isBillingTask(task);
  }
  return isTaskAssignee(user, task);
}

/**
 * Time is always attributed to the caller, who must be assigned (including Admins).
 * Non-Admin Accounting users can only log time on 'billing' tasks assigned to them.
 */
export function canLogTaskTime(user: UserProfile | null | undefined, task: Task | null | undefined): boolean {
  if (!user || !task) return false;
  if (!isUserAdmin(user) && isUserAccounting(user)) {
    return isTaskAssignee(user, task) && isBillingTask(task);
  }
  return isTaskAssignee(user, task);
}

/**
 * Only the assigned employee (or Admin) can upload documents to this task.
 * Non-Admin Accounting users can only upload documents to 'billing' tasks assigned to them.
 */
export function canUploadTaskDocument(user: UserProfile | null | undefined, task: Task | null | undefined): boolean {
  if (!user || !task) return false;
  if (isUserAdmin(user)) return true;
  if (isUserAccounting(user)) {
    return isTaskAssignee(user, task) && isBillingTask(task);
  }
  return isTaskAssignee(user, task);
}

/**
 * Linking Billing (Invoices):
 * Allowed for:
 * 1. Admin
 * 2. Non-Admin Accounting users ONLY on 'billing' tasks assigned to them
 * 3. Assigned employee on the task (non-Accounting)
 */
export function canLinkInvoice(
  user: UserProfile | null | undefined,
  task: Task | null | undefined,
  _workRequest?: WorkRequest | null | undefined,
  _tasks: Task[] = []
): boolean {
  if (!user || !task) return false;
  if (isUserAdmin(user)) return true;
  if (isUserAccounting(user)) {
    return isTaskAssignee(user, task) && isBillingTask(task);
  }
  if (isTaskAssignee(user, task)) return true;
  return false;
}

/**
 * Linking Disbursement:
 * Allowed for:
 * 1. Admin
 * 2. Assigned employee on the task (who holds disbursement permission, excluding non-Admin Accounting users)
 */
export function canLinkDisbursement(
  user: UserProfile | null | undefined,
  task: Task | null | undefined,
  hasDisbursementPermission: boolean
): boolean {
  if (!user || !task) return false;
  if (isUserAdmin(user)) return true;
  if (isUserAccounting(user)) return false;
  return isTaskAssignee(user, task) && hasDisbursementPermission;
}

/**
 * Linking Transmittal:
 * Allowed for:
 * 1. Admin
 * 2. Assigned employee on the task (Documentation users strictly require isTaskAssignee; non-Admin Accounting excluded)
 */
export function canLinkTransmittal(
  user: UserProfile | null | undefined,
  task: Task | null | undefined,
  _workRequest?: WorkRequest | null | undefined,
  _tasks: Task[] = []
): boolean {
  if (!user || !task) return false;
  if (isUserAdmin(user)) return true;
  if (isUserAccounting(user)) return false;
  if (isUserDocumentation(user)) {
    return isTaskAssignee(user, task);
  }
  return isTaskAssignee(user, task);
}

/**
 * Checks if a user has the authenticated Admin role (not email-only privilege).
 * Standalone filtering and submission exemptions must align with backend authenticated role.
 */
export function isRoleAdmin(user: UserProfile | null | undefined): boolean {
  if (!user) return false;
  return String(user.role || '').trim().toLowerCase() === 'admin';
}

/**
 * Checks if a task belongs to the specified work request, accounting for camelCase and snake_case API aliases.
 * Fails closed if task is nullish or has missing parent IDs.
 */
export function isTaskOfWorkRequest(
  task: Task | null | undefined,
  workRequestId: string | null | undefined
): boolean {
  if (!task || !workRequestId) return false;
  const parentId =
    task.workRequestId ??
    (task as { work_request_id?: string | null }).work_request_id ??
    null;
  if (!parentId || typeof parentId !== 'string') return false;
  return parentId.trim().toLowerCase() === workRequestId.trim().toLowerCase();
}


/**
 * Request Invoice from Accounting:
 * Allowed for Operations, HR, Management, or assigned employee when invoice is needed.
 * Strictly requires target-task assignment (isTaskAssignee). Parent/sibling WR fallback eliminated.
 * Non-Admin accounts with effective Documentation membership cannot request invoice billing.
 */
export function canRequestInvoice(
  user: UserProfile | null | undefined,
  task: Task | null | undefined,
  _workRequest?: WorkRequest | null | undefined,
  _tasks: Task[] = []
): boolean {
  if (!user || !task) return false;
  if (!isTaskAssignee(user, task)) return false;
  if (isUserAdmin(user)) return false; // Admin links directly
  const isAccounting = isUserAccounting(user);
  if (isAccounting) return false; // Accounting links directly

  // Non-Admin Documentation cannot request invoice billing (even if assigned or in Operations)
  if (isUserDocumentation(user)) return false;

  const allowedDepts = ['operations', 'hr', 'management'];
  const hasAllowedDept =
    (Array.isArray(user.departments) &&
      user.departments.some((d) => allowedDepts.includes(String(d).toLowerCase()))) ||
    ['manager', 'operations', 'hr'].includes(String(user.role || '').toLowerCase()) ||
    user.role === 'Staff';

  return hasAllowedDept;
}

/**
 * Request Transmittal from Documentation:
 * Allowed for Operations, HR, Management, or assigned employee when transmittal is needed.
 * Strictly requires target-task assignment (isTaskAssignee). Parent/sibling WR fallback eliminated.
 */
export function canRequestTransmittal(
  user: UserProfile | null | undefined,
  task: Task | null | undefined,
  _workRequest?: WorkRequest | null | undefined,
  _tasks: Task[] = []
): boolean {
  if (!user || !task) return false;
  if (!isTaskAssignee(user, task)) return false;
  if (isUserAdmin(user)) return false; // Admin links directly
  if (isUserDocumentation(user)) return false; // Documentation links directly
  if (isUserAccounting(user)) return false; // Accounting only uploads docs and links invoices on assigned billing tasks

  const allowedDepts = ['operations', 'hr', 'management'];
  const hasAllowedDept =
    (Array.isArray(user.departments) &&
      user.departments.some((d) => allowedDepts.includes(String(d).toLowerCase()))) ||
    ['manager', 'operations', 'hr'].includes(String(user.role || '').toLowerCase()) ||
    user.role === 'Staff';

  return hasAllowedDept;
}

/**
 * Checks whether an invoice or disbursement is owned by the specified task.
 *
 * Rules per CROSS_TASK_DOCUMENT_ISOLATION_AGY_20261024:
 * 1. task_id / taskId is canonical.
 * 2. linked_task_id / linkedTaskId is legacy fallback, used ONLY when canonical is null/missing (not empty string).
 *    Empty string is malformed canonical data and fails closed.
 * 3. Conflicting links: If canonical is present and does not match targetTaskId, the record
 *    must NOT match targetTaskId even if legacy matches (canonical precedence).
 * 4. Missing task ownership fails closed (returns false). Shared parent WR alone is never task ownership.
 */
export function isRecordOwnedByTask(
  record:
    | TaskRelatedInvoice
    | TaskRelatedDisbursement
    | {
        task_id?: string | null;
        taskId?: string | null;
        linked_task_id?: string | null;
        linkedTaskId?: string | null;
      }
    | null
    | undefined,
  targetTaskId: string | null | undefined
): boolean {
  if (!record || !targetTaskId) return false;

  const canonicalTaskId = record.task_id ?? record.taskId;
  if (canonicalTaskId !== undefined && canonicalTaskId !== null) {
    // Canonical is present: empty string is malformed and fails closed. Never fall back to legacy if canonical is present.
    return canonicalTaskId === targetTaskId;
  }

  const legacyTaskId = record.linked_task_id ?? record.linkedTaskId;
  if (legacyTaskId !== undefined && legacyTaskId !== null && legacyTaskId !== '') {
    return legacyTaskId === targetTaskId;
  }

  // Missing task ownership fails closed in a task panel
  return false;
}

/**
 * Checks whether a transmittal is owned by the specified task.
 *
 * Rules per CROSS_TASK_DOCUMENT_ISOLATION_AGY_20261024:
 * 1. Transmittals use linked_task_id / linkedTaskId ONLY. No fallback to task_id / taskId.
 * 2. If missing or null (e.g. parent-only transmittal or only task_id), fails closed (returns false).
 */
export function isTransmittalOwnedByTask(
  record:
    | TaskRelatedTransmittal
    | {
        linked_task_id?: string | null;
        linkedTaskId?: string | null;
      }
    | null
    | undefined,
  targetTaskId: string | null | undefined
): boolean {
  if (!record || !targetTaskId) return false;

  const taskId = record.linked_task_id ?? record.linkedTaskId;
  if (taskId !== undefined && taskId !== null && taskId !== '') {
    return taskId === targetTaskId;
  }

  // Missing task ownership fails closed in a task panel
  return false;
}

/**
 * Defensively filters related financial records to only those explicitly owned by targetTaskId.
 * Missing/empty collections fail closed gracefully into empty arrays, maintaining the response shape.
 */
export function filterTaskRelatedRecords(
  records: TaskRelatedRecords | null | undefined,
  targetTaskId: string | null | undefined
): TaskRelatedRecords {
  if (!records || !targetTaskId) {
    return { invoices: [], disbursements: [], transmittals: [] };
  }

  return {
    invoices: Array.isArray(records.invoices)
      ? records.invoices.filter((inv) => isRecordOwnedByTask(inv, targetTaskId))
      : [],
    disbursements: Array.isArray(records.disbursements)
      ? records.disbursements.filter((disb) => isRecordOwnedByTask(disb, targetTaskId))
      : [],
    transmittals: Array.isArray(records.transmittals)
      ? records.transmittals.filter((tx) => isTransmittalOwnedByTask(tx, targetTaskId))
      : [],
  };
}
