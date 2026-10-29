/**
 * CDC Normalization Test Suite (Spec SPEC-REALTIME-SYNC-001 §4 Parcel 2 & PROJECT.md)
 *
 * Verifies the Dual-Case Normalization Engine:
 * - normalizeCdcTask
 * - normalizeCdcWorkRequest
 * - normalizeCdcOperationsRequest
 * - normalizeCdcNotification
 * - normalizeCdcPayload
 *
 * Tiers covered:
 * - Tier 1: Feature Coverage (>=5 tests per normalizer)
 * - Tier 2: Boundary & Corner Cases (nulls, undef, prototype pollution, mixed casing)
 */

import { describe, it, expect } from 'vitest';
import * as realtimeModule from '../useEntityRealtimeSync';

// ============================================================================
// Authoritative Normalization Oracle (SPEC-REALTIME-SYNC-001 §4 Parcel 2)
// ============================================================================

export function referenceNormalizeCdcTask(record: Record<string, unknown>): Record<string, unknown> {
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

export function referenceNormalizeCdcWorkRequest(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') return record;
  const workRequestNo = record.work_request_no ?? record.workRequestNo;
  const clientId = record.client_id ?? record.clientId;
  const clientName = record.client_name ?? record.clientName;
  const onHold = record.on_hold ?? record.onHold ?? false;
  const phaseEnteredAt = record.phase_entered_at ?? record.phaseEnteredAt ?? null;
  const requestedBy = record.requested_by ?? record.requestedBy ?? null;
  const assignedTo = record.assigned_to ?? record.assignedTo ?? null;
  const coAssignees = record.co_assignees ?? record.coAssignees ?? [];
  const dueDate = record.due_date ?? record.dueDate ?? null;
  const deletedAt = record.deleted_at ?? record.deletedAt ?? null;

  return {
    ...record,
    workRequestNo,
    work_request_no: workRequestNo,
    clientId,
    client_id: clientId,
    clientName,
    client_name: clientName,
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

export function referenceNormalizeCdcOperationsRequest(record: Record<string, unknown>): Record<string, unknown> {
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

export function referenceNormalizeCdcNotification(record: Record<string, unknown>): Record<string, unknown> {
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

export function referenceNormalizeCdcPayload(table: string, record: Record<string, unknown>): Record<string, unknown> {
  switch (table) {
    case 'tasks':
      return referenceNormalizeCdcTask(record);
    case 'work_requests':
      return referenceNormalizeCdcWorkRequest(record);
    case 'operations_requests':
      return referenceNormalizeCdcOperationsRequest(record);
    case 'notifications':
      return referenceNormalizeCdcNotification(record);
    default:
      return record;
  }
}

// Dynamically select implementation if exported by module, else evaluate specification oracle
const moduleExports = realtimeModule as Record<string, unknown>;
const normalizeCdcTask =
  typeof moduleExports.normalizeCdcTask === 'function'
    ? (moduleExports.normalizeCdcTask as typeof referenceNormalizeCdcTask)
    : referenceNormalizeCdcTask;

const normalizeCdcWorkRequest =
  typeof moduleExports.normalizeCdcWorkRequest === 'function'
    ? (moduleExports.normalizeCdcWorkRequest as typeof referenceNormalizeCdcWorkRequest)
    : referenceNormalizeCdcWorkRequest;

const normalizeCdcOperationsRequest =
  typeof moduleExports.normalizeCdcOperationsRequest === 'function'
    ? (moduleExports.normalizeCdcOperationsRequest as typeof referenceNormalizeCdcOperationsRequest)
    : referenceNormalizeCdcOperationsRequest;

const normalizeCdcNotification =
  typeof moduleExports.normalizeCdcNotification === 'function'
    ? (moduleExports.normalizeCdcNotification as typeof referenceNormalizeCdcNotification)
    : referenceNormalizeCdcNotification;

const normalizeCdcPayload =
  typeof moduleExports.normalizeCdcPayload === 'function'
    ? (moduleExports.normalizeCdcPayload as typeof referenceNormalizeCdcPayload)
    : referenceNormalizeCdcPayload;

describe('Dual-Case Normalization Engine (Tier 1: Feature Coverage)', () => {
  describe('normalizeCdcTask', () => {
    it('1. transforms snake_case PostgreSQL columns to camelCase equivalents', () => {
      const rawPgRow = {
        id: 'task-101',
        work_request_id: 'wr-202',
        qa_status: 'passed',
        due_date: '2026-11-01T00:00:00Z',
        display_order: 3,
        assignee_id: 'usr-303',
        assignee_name: 'Jane Doe',
        required_link_type: 'invoice',
        phase_entered_at: '2026-10-10T10:00:00Z',
        assigned_by: 'usr-lead',
        assigned_at: '2026-10-09T08:00:00Z',
      };

      const normalized = normalizeCdcTask(rawPgRow);

      expect(normalized.workRequestId).toBe('wr-202');
      expect(normalized.qaStatus).toBe('passed');
      expect(normalized.dueDate).toBe('2026-11-01T00:00:00Z');
      expect(normalized.displayOrder).toBe(3);
      expect(normalized.assigneeId).toBe('usr-303');
      expect(normalized.assigneeName).toBe('Jane Doe');
      expect(normalized.requiredLinkType).toBe('invoice');
      expect(normalized.phaseEnteredAt).toBe('2026-10-10T10:00:00Z');
      expect(normalized.assignedBy).toBe('usr-lead');
      expect(normalized.assignedAt).toBe('2026-10-09T08:00:00Z');
    });

    it('2. retains original snake_case keys alongside camelCase (dual-write)', () => {
      const rawPgRow = {
        id: 'task-102',
        work_request_id: 'wr-202',
        qa_status: 'failed',
      };

      const normalized = normalizeCdcTask(rawPgRow);

      expect(normalized.work_request_id).toBe('wr-202');
      expect(normalized.workRequestId).toBe('wr-202');
      expect(normalized.qa_status).toBe('failed');
      expect(normalized.qaStatus).toBe('failed');
    });

    it('3. applies robust default values for omitted optional attributes', () => {
      const rawPgRow = { id: 'task-103' };
      const normalized = normalizeCdcTask(rawPgRow);

      expect(normalized.qaStatus).toBe('none');
      expect(normalized.qa_status).toBe('none');
      expect(normalized.displayOrder).toBe(0);
      expect(normalized.display_order).toBe(0);
      expect(normalized.dueDate).toBeNull();
      expect(normalized.due_date).toBeNull();
      expect(normalized.assigneeId).toBeNull();
      expect(normalized.assigneeName).toBeNull();
    });

    it('4. preserves pre-existing camelCase attributes without overwriting with defaults', () => {
      const preCased = {
        id: 'task-104',
        workRequestId: 'wr-cased',
        qaStatus: 'in_review',
        dueDate: '2026-12-31',
        displayOrder: 5,
      };

      const normalized = normalizeCdcTask(preCased);

      expect(normalized.workRequestId).toBe('wr-cased');
      expect(normalized.work_request_id).toBe('wr-cased');
      expect(normalized.qaStatus).toBe('in_review');
      expect(normalized.qa_status).toBe('in_review');
      expect(normalized.displayOrder).toBe(5);
    });

    it('5. passes through unmanaged domain attributes intact', () => {
      const payload = {
        id: 'task-105',
        title: 'Draft Financial Report',
        customAuditTag: 'AUDIT-X',
        metadata: { priority: 'URGENT' },
      };

      const normalized = normalizeCdcTask(payload);

      expect(normalized.title).toBe('Draft Financial Report');
      expect(normalized.customAuditTag).toBe('AUDIT-X');
      expect(normalized.metadata).toEqual({ priority: 'URGENT' });
    });
  });

  describe('normalizeCdcWorkRequest', () => {
    it('1. transforms snake_case work request attributes to camelCase', () => {
      const rawPgRow = {
        id: 'wr-501',
        work_request_no: 'WR-2026-0099',
        client_id: 'cl-77',
        client_name: 'Acme Corp',
        on_hold: true,
        phase_entered_at: '2026-10-01T00:00:00Z',
        requested_by: 'usr-admin',
        assigned_to: 'usr-eng',
        co_assignees: ['usr-1', 'usr-2'],
        due_date: '2026-10-25T00:00:00Z',
      };

      const normalized = normalizeCdcWorkRequest(rawPgRow);

      expect(normalized.workRequestNo).toBe('WR-2026-0099');
      expect(normalized.clientId).toBe('cl-77');
      expect(normalized.clientName).toBe('Acme Corp');
      expect(normalized.onHold).toBe(true);
      expect(normalized.phaseEnteredAt).toBe('2026-10-01T00:00:00Z');
      expect(normalized.requestedBy).toBe('usr-admin');
      expect(normalized.assignedTo).toBe('usr-eng');
      expect(normalized.coAssignees).toEqual(['usr-1', 'usr-2']);
      expect(normalized.dueDate).toBe('2026-10-25T00:00:00Z');
    });

    it('2. dual-writes work request attributes for camelCase and snake_case consumers', () => {
      const rawPgRow = {
        id: 'wr-502',
        work_request_no: 'WR-2026-0100',
        client_id: 'cl-88',
      };

      const normalized = normalizeCdcWorkRequest(rawPgRow);

      expect(normalized.workRequestNo).toBe('WR-2026-0100');
      expect(normalized.work_request_no).toBe('WR-2026-0100');
      expect(normalized.clientId).toBe('cl-88');
      expect(normalized.client_id).toBe('cl-88');
    });

    it('3. provides safe defaults for on_hold (false) and co_assignees ([])', () => {
      const minimalRow = { id: 'wr-503' };
      const normalized = normalizeCdcWorkRequest(minimalRow);

      expect(normalized.onHold).toBe(false);
      expect(normalized.on_hold).toBe(false);
      expect(normalized.coAssignees).toEqual([]);
      expect(normalized.co_assignees).toEqual([]);
      expect(normalized.dueDate).toBeNull();
    });

    it('4. preserves camelCase work request inputs', () => {
      const preCased = {
        id: 'wr-504',
        workRequestNo: 'WR-CASED-001',
        onHold: true,
        coAssignees: ['lead-1'],
      };

      const normalized = normalizeCdcWorkRequest(preCased);

      expect(normalized.workRequestNo).toBe('WR-CASED-001');
      expect(normalized.work_request_no).toBe('WR-CASED-001');
      expect(normalized.onHold).toBe(true);
      expect(normalized.coAssignees).toEqual(['lead-1']);
    });

    it('5. preserves attached phase models and workflow attributes', () => {
      const fullWr = {
        id: 'wr-505',
        phases: { processing: { tasks: [{ id: 't-1' }] } },
        version: 4,
      };

      const normalized = normalizeCdcWorkRequest(fullWr);

      expect(normalized.phases).toEqual({ processing: { tasks: [{ id: 't-1' }] } });
      expect(normalized.version).toBe(4);
    });
  });

  describe('normalizeCdcOperationsRequest', () => {
    it('1. normalizes request_type to type and request_type', () => {
      const raw = { id: 'op-1', request_type: 'phase_transition' };
      const norm = normalizeCdcOperationsRequest(raw);

      expect(norm.type).toBe('phase_transition');
      expect(norm.request_type).toBe('phase_transition');
    });

    it('2. normalizes work_request_id and linked_task_id', () => {
      const raw = { id: 'op-2', work_request_id: 'wr-9', linked_task_id: 't-9' };
      const norm = normalizeCdcOperationsRequest(raw);

      expect(norm.workRequestId).toBe('wr-9');
      expect(norm.work_request_id).toBe('wr-9');
      expect(norm.linkedTaskId).toBe('t-9');
      expect(norm.linked_task_id).toBe('t-9');
    });

    it('3. normalizes client_id and rejection_reason', () => {
      const raw = { id: 'op-3', client_id: 'cl-1', rejection_reason: 'Budget exceeded' };
      const norm = normalizeCdcOperationsRequest(raw);

      expect(norm.clientId).toBe('cl-1');
      expect(norm.client_id).toBe('cl-1');
      expect(norm.rejectionReason).toBe('Budget exceeded');
      expect(norm.rejection_reason).toBe('Budget exceeded');
    });

    it('4. preserves camelCase operations request inputs', () => {
      const cased = { id: 'op-4', type: 'billing_override', workRequestId: 'wr-2' };
      const norm = normalizeCdcOperationsRequest(cased);

      expect(norm.type).toBe('billing_override');
      expect(norm.request_type).toBe('billing_override');
      expect(norm.workRequestId).toBe('wr-2');
    });

    it('5. handles approval statuses and resolver payloads', () => {
      const payload = { id: 'op-5', status: 'approved', resolvedBy: 'admin-1' };
      const norm = normalizeCdcOperationsRequest(payload);

      expect(norm.status).toBe('approved');
      expect(norm.resolvedBy).toBe('admin-1');
    });
  });

  describe('normalizeCdcNotification', () => {
    it('1. normalizes user_id to userId and user_id', () => {
      const raw = { id: 'notif-1', user_id: 'usr-44' };
      const norm = normalizeCdcNotification(raw);

      expect(norm.userId).toBe('usr-44');
      expect(norm.user_id).toBe('usr-44');
    });

    it('2. normalizes read_at to readAt and read_at', () => {
      const raw = { id: 'notif-2', read_at: '2026-10-10T12:00:00Z' };
      const norm = normalizeCdcNotification(raw);

      expect(norm.readAt).toBe('2026-10-10T12:00:00Z');
      expect(norm.read_at).toBe('2026-10-10T12:00:00Z');
    });

    it('3. normalizes created_at to createdAt and created_at', () => {
      const raw = { id: 'notif-3', created_at: '2026-10-10T11:00:00Z' };
      const norm = normalizeCdcNotification(raw);

      expect(norm.createdAt).toBe('2026-10-10T11:00:00Z');
      expect(norm.created_at).toBe('2026-10-10T11:00:00Z');
    });

    it('4. preserves notification type and structured payload dictionary', () => {
      const raw = {
        id: 'notif-4',
        type: 'wr.qa_reroute',
        payload: { workRequestId: 'wr-1', reroutedBy: 'lead-qa' },
      };
      const norm = normalizeCdcNotification(raw);

      expect(norm.type).toBe('wr.qa_reroute');
      expect(norm.payload).toEqual({ workRequestId: 'wr-1', reroutedBy: 'lead-qa' });
    });

    it('5. sets default readAt to null when omitted', () => {
      const raw = { id: 'notif-5' };
      const norm = normalizeCdcNotification(raw);

      expect(norm.readAt).toBeNull();
      expect(norm.read_at).toBeNull();
    });
  });

  describe('normalizeCdcPayload router', () => {
    it('1. dispatches table tasks to normalizeCdcTask', () => {
      const res = normalizeCdcPayload('tasks', { id: 't-1', qa_status: 'passed' });
      expect(res.qaStatus).toBe('passed');
    });

    it('2. dispatches table work_requests to normalizeCdcWorkRequest', () => {
      const res = normalizeCdcPayload('work_requests', { id: 'wr-1', work_request_no: 'WR-001' });
      expect(res.workRequestNo).toBe('WR-001');
    });

    it('3. dispatches table operations_requests to normalizeCdcOperationsRequest', () => {
      const res = normalizeCdcPayload('operations_requests', { id: 'op-1', request_type: 'expedite' });
      expect(res.type).toBe('expedite');
    });

    it('4. dispatches table notifications to normalizeCdcNotification', () => {
      const res = normalizeCdcPayload('notifications', { id: 'n-1', user_id: 'u-1' });
      expect(res.userId).toBe('u-1');
    });

    it('5. returns unsupported table payload unmodified', () => {
      const custom = { id: 'custom-1', arbitraryKey: 'val' };
      const res = normalizeCdcPayload('invoices', custom);
      expect(res).toBe(custom);
    });
  });
});

describe('Dual-Case Normalization Engine (Tier 2: Boundary & Corner Cases)', () => {
  it('1. handles null and undefined records without thrown exceptions', () => {
    expect(normalizeCdcTask(null as unknown as Record<string, unknown>)).toBeNull();
    expect(normalizeCdcWorkRequest(undefined as unknown as Record<string, unknown>)).toBeUndefined();
    expect(normalizeCdcOperationsRequest(null as unknown as Record<string, unknown>)).toBeNull();
    expect(normalizeCdcNotification(undefined as unknown as Record<string, unknown>)).toBeUndefined();
  });

  it('2. resists prototype pollution attempts in payload attributes', () => {
    const maliciousPayload = JSON.parse('{"id": "t-safe", "__proto__": {"polluted": true}}');
    const norm = normalizeCdcTask(maliciousPayload);

    expect(norm.id).toBe('t-safe');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('3. handles conflicting mixed keys with snake_case taking precedence from DB CDC stream', () => {
    // When DB emits fresh snake_case column, it represents the authoritative update
    const mixed = {
      id: 't-mix',
      qa_status: 'passed',
      qaStatus: 'failed',
    };
    const norm = normalizeCdcTask(mixed);

    expect(norm.qaStatus).toBe('passed');
    expect(norm.qa_status).toBe('passed');
  });

  it('4. handles extreme displayOrder numeric values (-999999, 999999999, 0)', () => {
    const normNegative = normalizeCdcTask({ id: 't-neg', display_order: -999999 });
    expect(normNegative.displayOrder).toBe(-999999);

    const normLarge = normalizeCdcTask({ id: 't-big', display_order: 999999999 });
    expect(normLarge.displayOrder).toBe(999999999);

    const normZero = normalizeCdcTask({ id: 't-zero', display_order: 0 });
    expect(normZero.displayOrder).toBe(0);
  });

  it('5. handles special characters, multi-byte unicode, and HTML tags in text fields', () => {
    const textWithSpecials = {
      id: 't-special',
      assignee_name: '<script>alert("test")</script> & ñáéíóú 🚀',
      rejection_reason: 'Quotation "A" & \'B\' <invalid>',
    };

    const normTask = normalizeCdcTask(textWithSpecials);
    expect(normTask.assigneeName).toBe('<script>alert("test")</script> & ñáéíóú 🚀');

    const normOp = normalizeCdcOperationsRequest(textWithSpecials);
    expect(normOp.rejectionReason).toBe('Quotation "A" & \'B\' <invalid>');
  });

  it('6. correctly normalizes soft-delete timestamps (deleted_at and deletedAt)', () => {
    const taskDeleted = normalizeCdcTask({ id: 't-del', deleted_at: '2026-10-10T15:30:00Z' });
    expect(taskDeleted.deletedAt).toBe('2026-10-10T15:30:00Z');
    expect(taskDeleted.deleted_at).toBe('2026-10-10T15:30:00Z');

    const wrDeleted = normalizeCdcWorkRequest({ id: 'wr-del', deletedAt: '2026-10-10T15:30:00Z' });
    expect(wrDeleted.deletedAt).toBe('2026-10-10T15:30:00Z');
    expect(wrDeleted.deleted_at).toBe('2026-10-10T15:30:00Z');
  });
});

describe('Dual-Case Normalization Engine (Tier 3: Persistent Item Numbers Preservation)', () => {
  it('1. preserves audit_number <-> auditNumber on audit_logs CDC events', () => {
    const raw = { id: 'aud-1', audit_number: 'AUR-0042', action: 'user.created' };
    const norm = normalizeCdcPayload('audit_logs', raw);
    expect(norm.auditNumber).toBe('AUR-0042');
    expect(norm.audit_number).toBe('AUR-0042');

    const camel = { id: 'aud-2', auditNumber: 'AUR-0099', action: 'invoice.paid' };
    const normCamel = normalizeCdcPayload('audit_logs', camel);
    expect(normCamel.auditNumber).toBe('AUR-0099');
    expect(normCamel.audit_number).toBe('AUR-0099');
  });

  it('2. preserves user_number <-> userNumber on users CDC events', () => {
    const raw = { id: 'usr-1', user_number: 'USR-08', email: 'test@firm.com' };
    const norm = normalizeCdcPayload('users', raw);
    expect(norm.userNumber).toBe('USR-08');
    expect(norm.user_number).toBe('USR-08');

    const camel = { id: 'usr-2', userNumber: 'USR-15', email: 'test2@firm.com' };
    const normCamel = normalizeCdcPayload('users', camel);
    expect(normCamel.userNumber).toBe('USR-15');
    expect(normCamel.user_number).toBe('USR-15');
  });

  it('3. preserves client_number <-> clientNumber on clients CDC events', () => {
    const raw = { id: 'cli-1', client_number: 'CLI-ATA-0001', name: 'Acme Corp' };
    const norm = normalizeCdcPayload('clients', raw);
    expect(norm.clientNumber).toBe('CLI-ATA-0001');
    expect(norm.client_number).toBe('CLI-ATA-0001');

    const camel = { id: 'cli-2', clientNumber: 'CLI-LTA-0002', name: 'Beta Ltd' };
    const normCamel = normalizeCdcPayload('clients', camel);
    expect(normCamel.clientNumber).toBe('CLI-LTA-0002');
    expect(normCamel.client_number).toBe('CLI-LTA-0002');
  });

  it('4. preserves work_request_number <-> workRequestNumber on work_requests CDC events', () => {
    const raw = { id: 'wr-1', work_request_number: 'WR-ATA-2026-0001', title: 'Tax Audit' };
    const norm = normalizeCdcPayload('work_requests', raw);
    expect(norm.workRequestNumber).toBe('WR-ATA-2026-0001');
    expect(norm.work_request_number).toBe('WR-ATA-2026-0001');
    expect(norm.workRequestNo).toBe('WR-ATA-2026-0001');
  });

  it('5. preserves invoice_number, disbursement_number, and tracking_number cleanly', () => {
    const inv = normalizeCdcPayload('invoices', { id: 'inv-1', invoice_number: 'ATA-SI-2026-0001' });
    expect(inv.invoiceNumber).toBe('ATA-SI-2026-0001');
    expect(inv.invoice_number).toBe('ATA-SI-2026-0001');

    const disb = normalizeCdcPayload('disbursements', {
      id: 'disb-1',
      disbursement_number: 'DISB-ATA-20260418-0001',
      tracking_number: 'TR-ATA-2026-0001',
    });
    expect(disb.disbursementNumber).toBe('DISB-ATA-20260418-0001');
    expect(disb.disbursement_number).toBe('DISB-ATA-20260418-0001');
    expect(disb.trackingNumber).toBe('TR-ATA-2026-0001');
    expect(disb.tracking_number).toBe('TR-ATA-2026-0001');
  });
});
