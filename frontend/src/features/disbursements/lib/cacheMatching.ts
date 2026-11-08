import { resolveEntityCodeFromUUID } from '@/lib/realtime/tenantResolver';

type CacheRecord = Record<string, unknown>;

export function matchesDisbursementEntity(record: object, entity: unknown): boolean {
  const row = record as CacheRecord;
  if (entity === 'ALL') return true;
  if (typeof entity !== 'string' || !entity) return false;
  const rawId = row.entity_id ?? row.entityId;
  const code = row.entity ?? row.entity_code ?? row.entityCode ??
    (typeof rawId === 'string' ? resolveEntityCodeFromUUID(rawId) : undefined);
  return typeof code === 'string' && code.trim().toUpperCase() === entity.trim().toUpperCase();
}

export function matchesDisbursementQueuePredicate(record: object, queue: unknown): boolean {
  const row = record as CacheRecord;
  if (row.archived || (row.lifecycle_version ?? row.lifecycleVersion) !== 2 ||
      typeof row.version !== 'number' || !Number.isFinite(row.version) || row.version <= 0) return false;
  const ready = row.review_ready ?? row.reviewReady;
  switch (queue) {
    case 'initial_requests': return row.status === 'Draft' && ready === true;
    case 'needs_correction': return row.status === 'Draft' && ready === false;
    case 'ready_for_funding': return row.status === 'Approved';
    case 'payment_releases': return row.status === 'Funded';
    default: return false;
  }
}

/** Match only filters that a CDC row can establish without joined server data. */
export function matchesDisbursementList(record: object, filters: Record<string, unknown> = {}): boolean {
  const row = record as CacheRecord;
  if (Boolean(row.archived) !== Boolean(filters.archived)) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.queue && !matchesDisbursementQueuePredicate(row, filters.queue)) return false;
  if (filters.page && Number(filters.page) !== 1) return false;
  const fields: Record<string, unknown> = {
    category: row.category,
    fundSource: row.fund_source ?? row.fundSource,
    workRequestId: row.work_request_id ?? row.linked_work_request_id ?? row.linkedWorkRequestId,
    linkedWorkRequestId: row.work_request_id ?? row.linked_work_request_id ?? row.linkedWorkRequestId,
    linkedInvoiceId: row.linked_invoice_id ?? row.linkedInvoiceId,
    linkedTaskId: row.task_id ?? row.linked_task_id ?? row.linkedTaskId,
    linkedTransmittalId: row.linked_transmittal_id ?? row.linkedTransmittalId,
    clientId: row.client_id ?? row.clientId,
    employeeId: row.employee_id ?? row.employeeId,
  };
  const handled = new Set(['archived', 'status', 'queue', 'page', 'limit']);
  for (const [filter, value] of Object.entries(filters)) {
    if (handled.has(filter) || value === undefined || value === null || value === '') continue;
    // Search and other enriched predicates require an authorized refetch.
    if (!(filter in fields) || fields[filter] !== value) return false;
  }
  return true;
}
