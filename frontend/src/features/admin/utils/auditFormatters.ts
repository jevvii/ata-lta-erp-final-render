import type { AdminUser, AuditLogEntry } from '../api/types';

const EXACT_ACTION_MAP: Record<string, string> = {
  'user.created': 'Created User',
  'user.create': 'Created User',
  'user.updated': 'Updated User',
  'user.update': 'Updated User',
  'user.disabled': 'Disabled User',
  'user.disable': 'Disabled User',
  'user.enabled': 'Enabled User',
  'user.enable': 'Enabled User',
  'pending.created': 'Submitted Approval Request',
  'pending.approved': 'Approved Pending Change',
  'pending.rejected': 'Rejected Pending Change',
  'client.created': 'Created Client',
  'client.create': 'Created Client',
  'client.updated': 'Updated Client',
  'client.update': 'Updated Client',
  'client.archived': 'Archived Client',
  'client.archive': 'Archived Client',
  'client.unarchived': 'Restored Client',
  'client.restored': 'Restored Client',
  'invoice.create': 'Created Invoice',
  'invoice.created': 'Created Invoice',
  'invoice.update': 'Updated Invoice',
  'invoice.updated': 'Updated Invoice',
  'invoice.payment': 'Marked Invoice Paid',
  'invoice.paid': 'Marked Invoice Paid',
  'invoice.archive': 'Archived Invoice',
  'invoice.archived': 'Archived Invoice',
  'invoice.unarchive': 'Restored Invoice',
  'invoice.restored': 'Restored Invoice',
  'disbursement.create': 'Created Disbursement',
  'disbursement.created': 'Created Disbursement',
  'disbursement.update': 'Updated Disbursement',
  'disbursement.updated': 'Updated Disbursement',
  'disbursement.archive': 'Archived Disbursement',
  'disbursement.archived': 'Archived Disbursement',
  'disbursement.unarchive': 'Restored Disbursement',
  'disbursement.restored': 'Restored Disbursement',
  'disbursement.submit': 'Submitted Disbursement',
  'disbursement.submitted': 'Submitted Disbursement',
  'disbursement.approve': 'Approved Disbursement',
  'disbursement.approved': 'Approved Disbursement',
  'disbursement.release': 'Released Disbursement',
  'disbursement.released': 'Released Disbursement',
  'disbursement.fund': 'Funded Disbursement',
  'disbursement.funded': 'Funded Disbursement',
  'disbursement.reject': 'Rejected Disbursement',
  'disbursement.rejected': 'Rejected Disbursement',
  'disbursement.delete': 'Deleted Disbursement',
  'disbursement.deleted': 'Deleted Disbursement',
  'document.create': 'Stored Document',
  'document.created': 'Stored Document',
  'document.delete': 'Deleted Document',
  'document.deleted': 'Deleted Document',
  'document.archive': 'Archived Document',
  'document.archived': 'Archived Document',
  'document.unarchive': 'Restored Document',
  'document.restored': 'Restored Document',
  'document.lifecycle': 'Updated Document Status',
  'transmittal.create': 'Created Transmittal',
  'transmittal.created': 'Created Transmittal',
  'transmittal.send': 'Sent Transmittal',
  'transmittal.sent': 'Sent Transmittal',
  'transmittal.acknowledge': 'Acknowledged Transmittal',
  'transmittal.acknowledged': 'Acknowledged Transmittal',
  'transmittal.archive': 'Archived Transmittal',
  'transmittal.archived': 'Archived Transmittal',
  'transmittal.unarchive': 'Restored Transmittal',
  'transmittal.restored': 'Restored Transmittal',
  'transmittal.delete': 'Deleted Transmittal',
  'transmittal.deleted': 'Deleted Transmittal',
  'work_request.created': 'Created Work Request',
  'work_request.create': 'Created Work Request',
  'work_request.updated': 'Updated Work Request',
  'work_request.update': 'Updated Work Request',
  'work_request.deleted': 'Deleted Work Request',
  'work_request.delete': 'Deleted Work Request',
  'work_request.archived': 'Archived Work Request',
  'work_request.archive': 'Archived Work Request',
  'work_request.unarchived': 'Restored Work Request',
  'work_request.restored': 'Restored Work Request',
  'work_request.phase_advance': 'Advanced Work Request Phase',
  'work_request.creation_approved': 'Approved Work Request Creation',
  'work_request.creation_rejected': 'Rejected Work Request Creation',
  'document.confirm-upload': 'Uploaded Document',
  'document.comment.add': 'Added Document Comment',
  'disbursement.create_from_task': 'Created Disbursement from Task',
  'invoice.from_wr': 'Generated Invoice from Work Request',
  'transmittal.receive': 'Received Transmittal',
  'task.created': 'Created Task',
  'task.create': 'Created Task',
  'task.updated': 'Updated Task',
  'task.update': 'Updated Task',
  'task.completed': 'Completed Task',
  'task.complete': 'Completed Task',
  'task.deleted': 'Deleted Task',
  'task.delete': 'Deleted Task',
  'retainer-template.created': 'Created Retainer Template',
  'retainer-template.updated': 'Updated Retainer Template',
  'retainer-template.deleted': 'Deleted Retainer Template',
  'ground-worker.created': 'Added Ground Worker',
  'operations_request.create': 'Submitted Operations Request',
  'operations_request.created': 'Submitted Operations Request',
  'operations_request.update': 'Updated Operations Request',
  'operations_request.updated': 'Updated Operations Request',
  'operations_request.delete': 'Deleted Operations Request',
  'operations_request.deleted': 'Deleted Operations Request',
  login: 'User Logged In',
  logout: 'User Logged Out',
};

const VERB_PAST_MAP: Record<string, string> = {
  create: 'Created',
  created: 'Created',
  add: 'Added',
  added: 'Added',
  update: 'Updated',
  updated: 'Updated',
  edit: 'Updated',
  edited: 'Updated',
  delete: 'Deleted',
  deleted: 'Deleted',
  remove: 'Deleted',
  removed: 'Deleted',
  archive: 'Archived',
  archived: 'Archived',
  unarchive: 'Restored',
  unarchived: 'Restored',
  restore: 'Restored',
  restored: 'Restored',
  approve: 'Approved',
  approved: 'Approved',
  reject: 'Rejected',
  rejected: 'Rejected',
  submit: 'Submitted',
  submitted: 'Submitted',
  release: 'Released',
  released: 'Released',
  fund: 'Funded',
  funded: 'Funded',
  send: 'Sent',
  sent: 'Sent',
  acknowledge: 'Acknowledged',
  acknowledged: 'Acknowledged',
  complete: 'Completed',
  completed: 'Completed',
  disable: 'Disabled',
  disabled: 'Disabled',
  enable: 'Enabled',
  enabled: 'Enabled',
};

const SUBJECT_MAP: Record<string, string> = {
  client: 'Client',
  clients: 'Client',
  invoice: 'Invoice',
  invoices: 'Invoice',
  billing: 'Invoice',
  disbursement: 'Disbursement',
  disbursements: 'Disbursement',
  transmittal: 'Transmittal',
  transmittals: 'Transmittal',
  work_request: 'Work Request',
  work_requests: 'Work Request',
  workrequest: 'Work Request',
  workrequests: 'Work Request',
  task: 'Task',
  tasks: 'Task',
  user: 'User',
  users: 'User',
  document: 'Document',
  documents: 'Document',
  pending: 'Approval Request',
  pending_changes: 'Approval Request',
  operations_request: 'Operations Request',
  operations_requests: 'Operations Request',
};

/**
 * Formats a code-like audit action string (e.g. 'invoice.archive', 'user.created')
 * into a descriptive, human-readable action label (e.g. 'Archived Invoice', 'Created User').
 */
export function formatAuditAction(entry: AuditLogEntry | string | null | undefined): string {
  if (!entry) return 'Activity';
  const actionRaw = (typeof entry === 'string' ? entry : entry.action || '').trim();
  if (!actionRaw) return 'Activity';

  const actionLower = actionRaw.toLowerCase();
  const tableLower =
    typeof entry === 'object'
      ? (entry.tableName || entry.table_name || '').toLowerCase()
      : '';

  if (EXACT_ACTION_MAP[actionLower]) {
    return EXACT_ACTION_MAP[actionLower];
  }

  let subject = '';
  let verb = '';

  if (actionLower.includes('.')) {
    const parts = actionLower.split('.');
    subject = parts[0] || '';
    verb = parts[1] || '';
  } else if (actionLower.includes('_')) {
    const parts = actionLower.split('_');
    const lastPart = parts[parts.length - 1] || '';
    const firstPart = parts[0] || '';
    if (
      [
        'create',
        'created',
        'update',
        'updated',
        'delete',
        'deleted',
        'archive',
        'archived',
        'unarchive',
        'restored',
        'disabled',
        'enabled',
      ].includes(lastPart)
    ) {
      verb = parts.pop() || '';
      subject = parts.join('_');
    } else if (
      [
        'create',
        'created',
        'update',
        'updated',
        'delete',
        'deleted',
        'archive',
        'archived',
        'unarchive',
        'restored',
        'disabled',
        'enabled',
      ].includes(firstPart)
    ) {
      verb = parts.shift() || '';
      subject = parts.join('_');
    } else {
      verb = lastPart;
      subject = parts.slice(0, parts.length - 1).join(' ');
    }
  } else {
    verb = actionLower;
  }

  const verbFormatted =
    VERB_PAST_MAP[verb] ||
    (verb ? verb.charAt(0).toUpperCase() + verb.slice(1) : 'Activity');

  let subjectFormatted = SUBJECT_MAP[subject];
  if (!subjectFormatted && tableLower) {
    subjectFormatted = SUBJECT_MAP[tableLower];
  }
  if (!subjectFormatted && subject) {
    subjectFormatted = subject
      .split(/[\s_-]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  if (subjectFormatted) {
    return `${verbFormatted} ${subjectFormatted}`;
  }

  return verbFormatted || actionRaw;
}

/**
 * Returns Brutalist-Minimalist semantic badge classes for an audit action.
 */
export function getAuditActionBadgeStyle(entry: AuditLogEntry | string): string {
  const actionStr =
    typeof entry === 'string'
      ? entry
      : `${entry.action || ''} ${formatAuditAction(entry)}`;
  const normalized = actionStr.toLowerCase().replace(/_/g, ' ');

  // Danger: Delete / Disable / Reject / Archive
  if (
    normalized.includes('delete') ||
    normalized.includes('remove') ||
    normalized.includes('disable') ||
    normalized.includes('reject') ||
    normalized.includes('archive')
  ) {
    if (!normalized.includes('unarchive') && !normalized.includes('restore')) {
      return 'border-[#FECACA] bg-[#FEE2E2] text-[#991B1B]';
    }
  }

  // Success: Create / Add / Enable / Restore / Approve / Complete
  if (
    normalized.includes('create') ||
    normalized.includes('add') ||
    normalized.includes('enable') ||
    normalized.includes('restore') ||
    normalized.includes('unarchive') ||
    normalized.includes('approve') ||
    normalized.includes('complete')
  ) {
    return 'border-[#BBF7D0] bg-[#DCFCE7] text-[#166534]';
  }

  // Warning / Financial: Release / Paid / Funded / Sent / Stored
  if (
    normalized.includes('release') ||
    normalized.includes('paid') ||
    normalized.includes('payment') ||
    normalized.includes('fund') ||
    normalized.includes('sent') ||
    normalized.includes('send') ||
    normalized.includes('stored')
  ) {
    return 'border-[#FDE68A] bg-[#FEF3C7] text-[#B45309]';
  }

  // Info / Primary: Update / Edit / Submit / Login
  if (
    normalized.includes('update') ||
    normalized.includes('edit') ||
    normalized.includes('submit') ||
    normalized.includes('login') ||
    normalized.includes('acknowledge')
  ) {
    return 'border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]';
  }

  return 'border-[#CBD5E1] bg-[#F1F5F9] text-[#475569]';
}

/**
 * Resolves the human-readable Module Category label for an audit entry.
 */
export function getAuditModuleLabel(entry: AuditLogEntry): string {
  const tableLower = (entry.tableName || entry.table_name || '').toLowerCase();
  const actionLower = (entry.action || '').toLowerCase();

  if (tableLower.includes('user') || actionLower.includes('user') || actionLower === 'login' || actionLower === 'logout') {
    return 'Users';
  }
  if (tableLower.includes('task') || actionLower.includes('task')) {
    return 'Tasks';
  }
  if (
    tableLower.includes('work_request') ||
    tableLower.includes('operations_request') ||
    tableLower.includes('retainer') ||
    actionLower.includes('work_request') ||
    actionLower.includes('operations_request') ||
    actionLower.includes('retainer')
  ) {
    return 'Operations';
  }
  if (
    tableLower.includes('invoice') ||
    tableLower.includes('billing') ||
    actionLower.includes('invoice') ||
    actionLower.includes('billing')
  ) {
    return 'Billing';
  }
  if (tableLower.includes('disbursement') || actionLower.includes('disbursement')) {
    return 'Disbursements';
  }
  if (tableLower.includes('document') || actionLower.includes('document')) {
    return 'Documents';
  }
  if (tableLower.includes('transmittal') || actionLower.includes('transmittal')) {
    return 'Transmittals';
  }
  if (tableLower.includes('client') || actionLower.includes('client')) {
    return 'Clients';
  }

  if (tableLower) {
    return tableLower
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
  return 'System';
}

/**
 * Extracts a human-readable identifier for the target record of an audit log entry.
 */
export function getAuditItemIdentifier(
  entry: AuditLogEntry | null | undefined,
  usersMap?: Map<string, AdminUser>
): string {
  if (!entry) return '—';
  const d =
    entry.details && typeof entry.details === 'object' ? entry.details : {};
  const actionLower = (entry.action || '').toLowerCase();
  const tableLower = (entry.tableName || entry.table_name || '').toLowerCase();

  // Helper to format "CODE · TITLE" without duplicate prefix
  const formatCodeAndText = (code: string | number, text?: unknown): string => {
    const codeStr = String(code).trim();
    if (!text) return codeStr;
    const textStr = String(text).trim();
    if (!textStr || textStr === codeStr) return codeStr;
    if (textStr.startsWith(codeStr)) return textStr;
    return `${codeStr} · ${textStr}`;
  };

  // 1. Task special handling
  if (tableLower.includes('task') || actionLower.includes('task')) {
    const taskName =
      (d.name as string) ||
      (d.title as string) ||
      (d.taskTitle as string) ||
      (d.task_title as string);
    const wrTitle =
      (d.workRequestNumber as string) ||
      (d.work_request_number as string) ||
      (d.workRequestNo as string) ||
      (d.work_request_no as string) ||
      (d.workRequestTitle as string) ||
      (d.work_request_title as string);
    if (taskName && wrTitle) {
      return `${taskName} (WR: ${wrTitle})`;
    }
    if (taskName) {
      return String(taskName);
    }
  }

  // 2. Cross-module enriched formatting for work requests, clients, users
  const wrCode =
    (d.workRequestNumber as string) ||
    (d.work_request_number as string) ||
    (d.workRequestNo as string) ||
    (d.work_request_no as string);
  const wrTitle =
    (d.title as string) ||
    (d.name as string) ||
    (d.workRequestTitle as string) ||
    (d.work_request_title as string);

  if (wrCode && (tableLower.includes('work_request') || actionLower.includes('work_request'))) {
    return formatCodeAndText(wrCode, wrTitle);
  }

  const clientCode =
    (d.clientNumber as string) ||
    (d.client_number as string);
  const clientTitle =
    (d.clientName as string) ||
    (d.client_name as string) ||
    (d.name as string) ||
    (d.tradeName as string) ||
    (d.trade_name as string);

  if (clientCode && (tableLower.includes('client') || actionLower.includes('client'))) {
    return formatCodeAndText(clientCode, clientTitle);
  }

  const recId =
    (d.recordId as string) ||
    (d.record_id as string) ||
    (d.id as string) ||
    (d.parentRecordId as string) ||
    entry.recordId ||
    entry.record_id;

  if (tableLower.includes('user') || actionLower.includes('user')) {
    const targetUser = recId && usersMap ? usersMap.get(String(recId)) : undefined;
    const userCode =
      (d.userNumber as string) ||
      (d.user_number as string) ||
      targetUser?.userNumber ||
      targetUser?.user_number;
    const userName =
      (d.name as string) ||
      targetUser?.name ||
      (d.email as string) ||
      targetUser?.email;

    if (userCode && userName) {
      return formatCodeAndText(userCode, userName);
    }
    if (userCode) {
      return String(userCode);
    }
    if (userName) {
      return String(userName);
    }
  }

  // 3. Explicit business numbers and titles in details
  const businessId =
    d.disbursementNumber ||
    d.disbursement_number ||
    d.trackingNumber ||
    d.tracking_number ||
    d.invoiceNumber ||
    d.invoice_number ||
    d.voucherNumber ||
    d.voucher_number ||
    d.workRequestNumber ||
    d.work_request_number ||
    d.workRequestNo ||
    d.work_request_no ||
    d.clientNumber ||
    d.client_number ||
    d.userNumber ||
    d.user_number ||
    d.workRequestTitle ||
    d.work_request_title ||
    d.title ||
    d.name ||
    d.code ||
    d.email ||
    d.description;

  if (businessId && (typeof businessId === 'string' || typeof businessId === 'number')) {
    return String(businessId);
  }

  // 4. Resolve target record ID from details or root log object
  if (!recId) return '—';

  // Lookup in usersMap if user table/action
  if (
    usersMap &&
    (tableLower.includes('user') || actionLower.includes('user'))
  ) {
    const targetUser = usersMap.get(String(recId));
    if (targetUser?.name || targetUser?.email) {
      return targetUser.name || targetUser.email;
    }
  }

  const recIdStr = String(recId);
  return recIdStr.length > 20 ? `${recIdStr.slice(0, 8)}...` : recIdStr;
}

export interface AuditItemRouteLink {
  to: string;
  search?: Record<string, string>;
  label: string;
}

/**
 * Formats an AuditItemRouteLink into a full URL string with query parameters.
 */
export function buildAuditRouteHref(link: AuditItemRouteLink): string {
  const searchParams = new URLSearchParams(link.search ?? {});
  const qs = searchParams.toString();
  return qs ? `${link.to}?${qs}` : link.to;
}

/**
 * Resolves the v2 router destination for an audit log's target record.
 */
export function getAuditItemRouteLink(
  entry: AuditLogEntry | null | undefined
): AuditItemRouteLink | null {
  if (!entry) return null;
  const d =
    entry.details && typeof entry.details === 'object' ? entry.details : {};
  const recId =
    (d.recordId as string) ||
    (d.record_id as string) ||
    (d.id as string) ||
    (d.parentRecordId as string) ||
    entry.recordId ||
    entry.record_id;
  const actionLower = (entry.action || '').toLowerCase();
  const tableLower = (entry.tableName || entry.table_name || '').toLowerCase();

  // 1. Task -> /operations?tab=work-requests&view=board&wrId=...&taskId=...
  if (tableLower.includes('task') || actionLower.includes('task')) {
    const wrId =
      (d.workRequestId as string) ||
      (d.work_request_id as string) ||
      (d.linkedWorkRequestId as string) ||
      (d.linked_work_request_id as string) ||
      (d.parentRecordId as string);
    const taskId =
      (d.taskId as string) ||
      (d.task_id as string) ||
      (recId ? String(recId) : undefined);
    return {
      to: '/operations',
      search: {
        tab: 'work-requests',
        view: 'board',
        ...(wrId ? { wrId: String(wrId) } : {}),
        ...(taskId ? { taskId: String(taskId) } : {}),
      },
      label: 'View Task in Operations',
    };
  }

  // 2. Retainer Templates -> /operations?tab=retainer-templates
  if (tableLower.includes('retainer') || actionLower.includes('retainer')) {
    return {
      to: '/operations',
      search: { tab: 'retainer-templates' },
      label: 'View Retainer Templates',
    };
  }

  // 3. Operations Requests / Pending Approvals -> /operations
  if (
    tableLower.includes('operations_request') ||
    tableLower.includes('pending') ||
    actionLower.includes('operations_request') ||
    actionLower.includes('pending')
  ) {
    const wrId =
      (d.workRequestId as string) ||
      (d.work_request_id as string) ||
      (d.linkedWorkRequestId as string) ||
      (d.linked_work_request_id as string);
    const taskId = (d.taskId as string) || (d.task_id as string);
    const invId =
      (d.invoiceId as string) ||
      (d.invoice_id as string) ||
      (d.linkedInvoiceId as string) ||
      (d.linked_invoice_id as string);
    const disbId =
      (d.disbursementId as string) || (d.disbursement_id as string);

    if (wrId) {
      return {
        to: '/operations',
        search: {
          tab: 'work-requests',
          view: 'board',
          wrId: String(wrId),
          ...(taskId ? { taskId: String(taskId) } : {}),
        },
        label: 'View in Operations',
      };
    }
    if (invId) {
      return {
        to: '/billing',
        search: { invoiceId: String(invId) },
        label: 'View in Billing',
      };
    }
    if (disbId) {
      return {
        to: '/disbursements',
        search: { disbursementId: String(disbId) },
        label: 'View in Disbursements',
      };
    }
    return {
      to: '/operations',
      search: { tab: 'pending-approvals' },
      label: 'View Pending Approvals',
    };
  }

  // 4. Work Request -> /operations
  if (
    tableLower.includes('work') ||
    tableLower.includes('request') ||
    actionLower.includes('work') ||
    actionLower.includes('request')
  ) {
    const wrId =
      (recId ? String(recId) : undefined) ||
      (d.workRequestId as string) ||
      (d.work_request_id as string);
    const isArchived =
      (actionLower.includes('archive') && !actionLower.includes('unarchive')) ||
      d.archived === true;

    if (isArchived) {
      return {
        to: '/operations',
        search: {
          tab: 'archive',
          ...(wrId ? { wrId: String(wrId) } : {}),
        },
        label: 'View in Operations Archive',
      };
    }

    return {
      to: '/operations',
      search: wrId
        ? { tab: 'work-requests', view: 'board', wrId: String(wrId) }
        : { tab: 'work-requests' },
      label: 'View in Operations',
    };
  }

  // 5. Billing / Invoice -> /billing?invoiceId=...
  if (
    tableLower.includes('billing') ||
    tableLower.includes('invoice') ||
    actionLower.includes('invoice') ||
    actionLower.includes('billing')
  ) {
    const invId =
      (d.invoiceId as string) ||
      (d.invoice_id as string) ||
      (recId ? String(recId) : undefined);
    return {
      to: '/billing',
      search: invId ? { invoiceId: String(invId) } : undefined,
      label: 'View in Billing',
    };
  }

  // 6. Disbursement -> /disbursements?disbursementId=...
  if (tableLower.includes('disbursement') || actionLower.includes('disbursement')) {
    const disbId =
      (d.disbursementId as string) ||
      (d.disbursement_id as string) ||
      (recId ? String(recId) : undefined);
    return {
      to: '/disbursements',
      search: disbId ? { disbursementId: String(disbId) } : undefined,
      label: 'View in Disbursements',
    };
  }

  // 7. Transmittal -> /transmittals?transmittalId=...
  if (tableLower.includes('transmittal') || actionLower.includes('transmittal')) {
    const trkId =
      (d.transmittalId as string) ||
      (d.transmittal_id as string) ||
      (recId ? String(recId) : undefined);
    return {
      to: '/transmittals',
      search: trkId ? { transmittalId: String(trkId) } : undefined,
      label: 'View in Transmittals',
    };
  }

  // 8. Document -> /documents?docId=...
  if (tableLower.includes('document') || actionLower.includes('document')) {
    const docId =
      (d.documentId as string) ||
      (d.document_id as string) ||
      (recId ? String(recId) : undefined);
    return {
      to: '/documents',
      search: docId ? { docId: String(docId) } : undefined,
      label: 'View in Documents',
    };
  }

  // 9. Client -> /clients?clientId=...
  if (tableLower.includes('client') || actionLower.includes('client')) {
    const clientId =
      (d.clientId as string) ||
      (d.client_id as string) ||
      (recId ? String(recId) : undefined);
    return {
      to: '/clients',
      search: clientId ? { clientId: String(clientId) } : undefined,
      label: 'View in Clients',
    };
  }

  // 10. User -> /admin?tab=users&userId=...
  if (tableLower.includes('user') || actionLower.includes('user')) {
    const userId =
      (d.userId as string) ||
      (d.user_id as string) ||
      (recId ? String(recId) : undefined);
    return {
      to: '/admin',
      search: {
        tab: 'users',
        ...(userId ? { userId: String(userId) } : {}),
      },
      label: 'View in User Management',
    };
  }

  return null;
}

export interface AuditBusinessContextItem {
  label: string;
  value: string;
  isCode?: boolean;
  isStatus?: boolean;
  isPriority?: boolean;
  isAmount?: boolean;
  routeLink?: AuditItemRouteLink;
}

function formatPhpCurrency(amount: number): string {
  return `₱${amount.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Alias for getAuditItemRouteLink for backward compatibility with target route resolvers.
 */
export const getAuditTargetRoute = getAuditItemRouteLink;

/**
 * Resolves contextual business metadata from an audit log entry for the Detail Modal.
 */
export function resolveAuditBusinessContext(
  entry: AuditLogEntry | null | undefined,
  usersMap?: Map<string, AdminUser>
): AuditBusinessContextItem[] {
  if (!entry) return [];
  const d =
    entry.details && typeof entry.details === 'object' ? entry.details : {};
  const actionLower = (entry.action || '').toLowerCase();
  const tableLower = (entry.tableName || entry.table_name || '').toLowerCase();
  const items: AuditBusinessContextItem[] = [];
  const primaryRouteLink = getAuditItemRouteLink(entry);

  const resolveUserDisplay = (val: unknown): string => {
    if (!val) return '';
    const str = String(val);
    const u = usersMap?.get(str);
    return u ? `${u.name} (${u.role})` : str;
  };

  if (tableLower.includes('user') || actionLower.includes('user')) {
    const recId = (d.id as string) || entry.recordId || entry.record_id;
    const targetUser = recId ? usersMap?.get(String(recId)) : undefined;
    const userNo =
      (d.userNumber as string) ||
      (d.user_number as string) ||
      targetUser?.userNumber ||
      targetUser?.user_number;
    const userName = (d.name as string) || targetUser?.name;
    const userEmail = (d.email as string) || targetUser?.email;
    const userRole = (d.role as string) || targetUser?.role;

    if (userNo) {
      items.push({ label: 'User ID', value: String(userNo), isCode: true });
    }
    if (userName) {
      items.push({
        label: 'Target User',
        value: String(userName),
        routeLink: primaryRouteLink ?? undefined,
      });
    }
    if (userEmail) items.push({ label: 'Email', value: String(userEmail) });
    if (userRole) items.push({ label: 'Role', value: String(userRole), isStatus: true });
    if (Array.isArray(d.entities) && d.entities.length > 0) {
      items.push({ label: 'Entities', value: d.entities.join(', '), isCode: true });
    }
    if (Array.isArray(d.departments) && d.departments.length > 0) {
      items.push({ label: 'Departments', value: d.departments.join(', ') });
    }
  } else {
    const recId =
      (d.recordId as string) ||
      (d.record_id as string) ||
      (d.id as string) ||
      entry.recordId ||
      entry.record_id;
    const wrId =
      (d.workRequestId as string) ||
      (d.work_request_id as string) ||
      (d.linkedWorkRequestId as string) ||
      (d.linked_work_request_id as string) ||
      (tableLower.includes('work_request') && recId ? String(recId) : undefined);
    const taskId =
      (d.taskId as string) ||
      (d.task_id as string) ||
      (tableLower.includes('task') && recId ? String(recId) : undefined);
    const invId =
      (d.invoiceId as string) ||
      (d.invoice_id as string) ||
      (d.linkedInvoiceId as string) ||
      (d.linked_invoice_id as string) ||
      (tableLower.includes('invoice') && recId ? String(recId) : undefined);
    const disbId =
      (d.disbursementId as string) ||
      (d.disbursement_id as string) ||
      (tableLower.includes('disbursement') && recId ? String(recId) : undefined);
    const trkId =
      (d.transmittalId as string) ||
      (d.transmittal_id as string) ||
      (d.linkedTransmittalId as string) ||
      (d.linked_transmittal_id as string) ||
      (tableLower.includes('transmittal') && recId ? String(recId) : undefined);
    const clientId =
      (d.clientId as string) ||
      (d.client_id as string) ||
      (tableLower.includes('client') && recId ? String(recId) : undefined);

    const wrLink: AuditItemRouteLink | undefined = wrId
      ? {
          to: '/operations',
          search: { tab: 'work-requests', view: 'board', wrId: String(wrId) },
          label: 'View Work Request in Operations',
        }
      : undefined;

    const taskLink: AuditItemRouteLink | undefined = taskId
      ? {
          to: '/operations',
          search: {
            tab: 'work-requests',
            view: 'board',
            ...(wrId ? { wrId: String(wrId) } : {}),
            taskId: String(taskId),
          },
          label: 'View Task in Operations',
        }
      : undefined;

    const invLink: AuditItemRouteLink | undefined = invId
      ? {
          to: '/billing',
          search: { invoiceId: String(invId) },
          label: 'View Invoice in Billing',
        }
      : undefined;

    const disbLink: AuditItemRouteLink | undefined = disbId
      ? {
          to: '/disbursements',
          search: { disbursementId: String(disbId) },
          label: 'View Disbursement',
        }
      : undefined;

    const trkLink: AuditItemRouteLink | undefined = trkId
      ? {
          to: '/transmittals',
          search: { transmittalId: String(trkId) },
          label: 'View Transmittal',
        }
      : undefined;

    const clientLink: AuditItemRouteLink | undefined = clientId
      ? {
          to: '/clients',
          search: { clientId: String(clientId) },
          label: 'View Client',
        }
      : undefined;

    const wrNo =
      d.workRequestNumber ||
      d.work_request_number ||
      d.workRequestNo ||
      d.work_request_no;
    const wrTitle = d.workRequestTitle || d.work_request_title;
    const taskTitle =
      tableLower.includes('task') || actionLower.includes('task')
        ? d.title || d.name || d.taskTitle || d.task_title
        : undefined;
    const generalTitle =
      !taskTitle && (d.title || d.name) ? String(d.title || d.name) : undefined;
    const invNo = d.invoiceNumber || d.invoice_number;
    const disbNo = d.disbursementNumber || d.disbursement_number || d.voucherNumber || d.voucher_number;
    const trkNo = d.trackingNumber || d.tracking_number;
    const clientNo = d.clientNumber || d.client_number;
    const clientName = d.clientName || d.client_name;
    const statusVal = d.status || d.newStatus || d.new_status;
    const priorityVal = d.priority;
    const assignedVal = d.assignedTo || d.assigned_to || d.assigneeId || d.assignee_id;
    const amountVal = d.amount ?? d.total ?? d.pfAmount ?? d.pf_amount;

    if (wrNo) items.push({ label: 'Work Request No.', value: String(wrNo), isCode: true, routeLink: wrLink });
    if (wrTitle) items.push({ label: 'Work Request', value: String(wrTitle), routeLink: wrLink });
    if (clientNo) items.push({ label: 'Client No.', value: String(clientNo), isCode: true, routeLink: clientLink });
    if (clientName) items.push({ label: 'Client', value: String(clientName), routeLink: clientLink });
    if (taskTitle) items.push({ label: 'Task Title', value: String(taskTitle), routeLink: taskLink });
    if (generalTitle && generalTitle !== wrTitle) {
      items.push({ label: 'Record Name', value: generalTitle, routeLink: primaryRouteLink ?? undefined });
    }
    if (invNo) items.push({ label: 'Invoice No.', value: String(invNo), isCode: true, routeLink: invLink });
    if (disbNo) items.push({ label: 'Disbursement No.', value: String(disbNo), isCode: true, routeLink: disbLink });
    if (trkNo) items.push({ label: 'Tracking No.', value: String(trkNo), isCode: true, routeLink: trkLink });
    if (assignedVal && typeof assignedVal === 'string') {
      items.push({ label: 'Assigned To', value: resolveUserDisplay(assignedVal) });
    }
    if (statusVal && typeof statusVal === 'string') {
      items.push({ label: 'Status', value: statusVal, isStatus: true });
    }
    if (priorityVal && typeof priorityVal === 'string') {
      items.push({ label: 'Priority', value: priorityVal, isPriority: true });
    }
    if (amountVal !== undefined && amountVal !== null && !Number.isNaN(Number(amountVal))) {
      items.push({
        label: 'Amount',
        value: formatPhpCurrency(Number(amountVal)),
        isAmount: true,
      });
    }
  }

  return items;
}

export interface AuditDiffRow {
  field: string;
  label: string;
  before?: string;
  after: string;
  isDiff: boolean;
}

const INTERNAL_AUDIT_KEYS = new Set([
  'recordId',
  'record_id',
  'id',
  'parentRecordId',
  'parent_record_id',
  'workRequestId',
  'work_request_id',
  'taskId',
  'task_id',
  'clientId',
  'client_id',
  'entityId',
  'entity_id',
  'originTabId',
  'origin_tab_id',
  'password',
  'passwordHash',
  'password_hash',
]);

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  pfAmount: 'Professional Fee',
  pf_amount: 'Professional Fee',
  isActive: 'Active Status',
  is_active: 'Active Status',
  dueDate: 'Due Date',
  due_date: 'Due Date',
  assignedTo: 'Assigned To',
  assigned_to: 'Assigned To',
  assigneeId: 'Assignee',
  assignee_id: 'Assignee',
  requestedBy: 'Requested By',
  requested_by: 'Requested By',
  approvedBy: 'Approved By',
  approved_by: 'Approved By',
  invoiceNumber: 'Invoice Number',
  invoice_number: 'Invoice Number',
  disbursementNumber: 'Disbursement Number',
  disbursement_number: 'Disbursement Number',
  trackingNumber: 'Tracking Number',
  tracking_number: 'Tracking Number',
  workRequestNo: 'Work Request No.',
  work_request_no: 'Work Request No.',
  qaStatus: 'QA Status',
  qa_status: 'QA Status',
};

function formatFieldLabel(key: string): string {
  if (FIELD_LABEL_OVERRIDES[key]) {
    return FIELD_LABEL_OVERRIDES[key]!;
  }
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFieldValue(
  key: string,
  val: unknown,
  usersMap?: Map<string, AdminUser>
): string {
  if (val === null || val === undefined || val === '') {
    return 'None';
  }
  if (typeof val === 'boolean') {
    return val ? 'Yes' : 'No';
  }
  const keyLower = key.toLowerCase();
  if (
    typeof val === 'number' &&
    (keyLower.includes('amount') ||
      keyLower.includes('total') ||
      keyLower.includes('price') ||
      keyLower.includes('fee'))
  ) {
    return formatPhpCurrency(val);
  }
  if (
    typeof val === 'string' &&
    usersMap &&
    (keyLower.includes('user') ||
      keyLower.includes('assign') ||
      keyLower.includes('request') ||
      keyLower.includes('approv'))
  ) {
    const matched = usersMap.get(val);
    if (matched) return `${matched.name} (${matched.role})`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return 'None';
    return val
      .map((item) => {
        if (typeof item === 'string' && usersMap?.has(item)) {
          return usersMap.get(item)!.name;
        }
        if (item && typeof item === 'object') {
          return JSON.stringify(item);
        }
        return String(item);
      })
      .join(', ');
  }
  if (typeof val === 'object') {
    return JSON.stringify(val);
  }
  return String(val);
}

/**
 * Parses `entry.details` into structured Visual Diff rows (`before -> after` or snapshot values).
 */
export function parseAuditDiffRows(
  details: Record<string, unknown> | null | undefined,
  usersMap?: Map<string, AdminUser>
): AuditDiffRow[] {
  if (!details || typeof details !== 'object') {
    return [];
  }

  const rows: AuditDiffRow[] = [];

  // Case 1: Explicit top-level `changes` or `diff` object, or `before` & `after` objects
  if (
    details.before &&
    typeof details.before === 'object' &&
    details.after &&
    typeof details.after === 'object'
  ) {
    const beforeObj = details.before as Record<string, unknown>;
    const afterObj = details.after as Record<string, unknown>;
    const allKeys = Array.from(
      new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])
    );
    for (const key of allKeys) {
      if (INTERNAL_AUDIT_KEYS.has(key)) continue;
      const bVal = formatFieldValue(key, beforeObj[key], usersMap);
      const aVal = formatFieldValue(key, afterObj[key], usersMap);
      rows.push({
        field: key,
        label: formatFieldLabel(key),
        before: bVal,
        after: aVal,
        isDiff: bVal !== aVal,
      });
    }
    return rows;
  }

  // Case 2: Inspect each key in `details`
  for (const [key, rawVal] of Object.entries(details)) {
    if (INTERNAL_AUDIT_KEYS.has(key)) continue;

    if (
      rawVal &&
      typeof rawVal === 'object' &&
      !Array.isArray(rawVal)
    ) {
      const objVal = rawVal as Record<string, unknown>;
      const hasFromTo = 'from' in objVal && 'to' in objVal;
      const hasOldNew = 'old' in objVal && 'new' in objVal;
      const hasPrevCurr = 'previous' in objVal && 'current' in objVal;
      const hasBeforeAfter = 'before' in objVal && 'after' in objVal;

      if (hasFromTo || hasOldNew || hasPrevCurr || hasBeforeAfter) {
        const beforeRaw = hasFromTo
          ? objVal.from
          : hasOldNew
            ? objVal.old
            : hasPrevCurr
              ? objVal.previous
              : objVal.before;
        const afterRaw = hasFromTo
          ? objVal.to
          : hasOldNew
            ? objVal.new
            : hasPrevCurr
              ? objVal.current
              : objVal.after;

        rows.push({
          field: key,
          label: formatFieldLabel(key),
          before: formatFieldValue(key, beforeRaw, usersMap),
          after: formatFieldValue(key, afterRaw, usersMap),
          isDiff: true,
        });
        continue;
      }
    }

    rows.push({
      field: key,
      label: formatFieldLabel(key),
      after: formatFieldValue(key, rawVal, usersMap),
      isDiff: false,
    });
  }

  return rows;
}
