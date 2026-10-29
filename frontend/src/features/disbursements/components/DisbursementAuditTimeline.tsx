import { Badge } from '@/components/ui/badge';
import { UserAvatar } from '../../../components/common/UserAvatar';
import { DisbursementStatusBadge } from './DisbursementStatusBadge';
import { receiptDisplayName } from '../lib/receiptDisplayName';
import { auditActionLabel } from '../lib/auditActionLabel';
import type { Disbursement, DisbursementLifecycleEvent } from '../api/types';

const detailFields: Record<string, string> = {
  amount: 'Amount',
  category: 'Category',
  description: 'Description',
  fund_source: 'Fund source',
  due_date: 'Due date',
  notes: 'Notes',
  receipt_filename: 'Receipt',
  review_ready: 'Ready for review',
  method: 'Method',
  bank: 'Bank',
  reference: 'Reference',
  date: 'Payment date',
};
const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
function detailValue(key: string, value: unknown): string {
  if (value == null || value === '') return 'None';
  if (key === 'amount' && Number.isFinite(Number(value))) return money.format(Number(value));
  if (key === 'receipt_filename' && typeof value === 'string') return receiptDisplayName(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function auditDetails(event: DisbursementLifecycleEvent): string[] {
  const details = event.details || {};
  const before = asRecord(details.before);
  const after = asRecord(details.after);
  const payment = asRecord(details.payment_details);
  const lines: string[] = [];
  for (const [key, label] of Object.entries(detailFields)) {
    if (Object.hasOwn(after, key) && before[key] !== after[key]) {
      const oldValue = Object.hasOwn(before, key) ? `${detailValue(key, before[key])} → ` : '';
      lines.push(`${label}: ${oldValue}${detailValue(key, after[key])}`);
    } else if (Object.hasOwn(payment, key)) {
      lines.push(`${label}: ${detailValue(key, payment[key])}`);
    } else if (Object.hasOwn(details, key) && key !== 'notes') {
      lines.push(`${label}: ${detailValue(key, details[key])}`);
    }
  }
  return lines;
}

function fallbackEvents(item: Disbursement): DisbursementLifecycleEvent[] {
  const events: DisbursementLifecycleEvent[] = [
    {
      action: 'create',
      actor_id: item.created_by || item.createdBy || item.requested_by || item.requestedBy,
      actor_name:
        item.created_by_name ||
        item.createdByName ||
        item.requested_by_name ||
        item.requestedByName,
      actor_role: item.created_by_role,
      created_at: item.created_at || item.createdAt || '',
    },
  ];
  if (item.approved_at || item.approvedAt)
    events.push({
      action: 'approve',
      actor_id: item.approved_by || item.approvedBy,
      actor_name: item.approved_by_name || item.approvedByName,
      actor_role: item.approved_by_role,
      new_status: 'Approved',
      created_at: item.approved_at || item.approvedAt || '',
    });
  if (item.funded_at || item.fundedAt || item.payment_date || item.paymentDate)
    events.push({
      action: item.funded_at || item.fundedAt ? 'fund' : 'payment_details_update',
      actor_id:
        item.funded_by || item.fundedBy || item.payment_processed_by || item.paymentProcessedBy,
      actor_name: item.funded_by_name || item.payment_processed_by_name,
      actor_role: item.funded_by_role,
      new_status: item.funded_at || item.fundedAt ? 'Funded' : undefined,
      created_at: item.funded_at || item.fundedAt || '',
    });
  if (item.released_at || item.releasedAt)
    events.push({
      action: 'release',
      actor_id: item.released_by || item.releasedBy,
      actor_name: item.released_by_name || item.releasedByName,
      actor_role: item.released_by_role,
      new_status: 'Released',
      created_at: item.released_at || item.releasedAt || '',
    });
  if (item.status === 'Rejected' || item.rejected_at || item.rejectedAt)
    events.push({
      action: 'reject',
      actor_id: item.rejected_by || item.rejectedBy,
      actor_name: item.rejected_by_name || item.rejectedByName,
      actor_role: item.rejected_by_role,
      new_status: 'Rejected',
      reason: item.rejection_reason || item.rejectionReason,
      created_at: item.rejected_at || item.rejectedAt || '',
    });
  return events;
}

export function DisbursementAuditTimeline({ item }: { item: Disbursement }) {
  const lifecycle = item.lifecycle_history || item.lifecycleHistory;
  const events: DisbursementLifecycleEvent[] = lifecycle?.length
    ? lifecycle
    : item.audit_logs?.length
      ? item.audit_logs.map((log) => ({ ...log, old_status: log.previous_status }))
      : fallbackEvents(item);

  return (
    <ol className="space-y-4 text-xs text-muted" data-testid="lifecycle-history-timeline">
      {events.map((event, index) => {
        const actorId = event.actor_id || event.actorId;
        const name =
          event.actor_name?.trim() ||
          event.actorName?.trim() ||
          (actorId ? 'Unknown actor' : 'System');
        const role = event.actor_role || event.actorRole;
        const oldStatus = event.old_status || event.from_status || event.fromStatus;
        const newStatus = event.new_status || event.to_status || event.toStatus;
        const timestamp = event.created_at || event.timestamp || event.createdAt || '';
        const date = new Date(timestamp);
        const validDate = timestamp && Number.isFinite(date.getTime());
        const reason =
          event.reason || (typeof event.details?.reason === 'string' ? event.details.reason : null);
        const notes =
          event.notes || (typeof event.details?.notes === 'string' ? event.details.notes : null);
        return (
          <li
            key={event.id || index}
            className="flex items-start gap-2.5"
            data-testid="lifecycle-audit-entry"
          >
            <UserAvatar
              userId={event.actor_id ?? event.actorId}
              name={event.actor_name ?? event.actorName ?? name}
              avatarUrl={event.actor_avatar_url ?? event.actorAvatarUrl}
              size="sm"
              shape="circle"
              className="h-7 w-7 text-[10px]"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink break-words">{name}</span>
                {role && (
                  <Badge
                    variant="outline"
                    size="compact"
                    className="text-xs bg-sidebar text-muted border-border"
                  >
                    {role}
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-ink">
                  {auditActionLabel(event.action, newStatus)}
                </span>
                {oldStatus && oldStatus !== newStatus && (
                  <>
                    <DisbursementStatusBadge status={oldStatus} />
                    <span aria-label="to">→</span>
                  </>
                )}
                {newStatus && <DisbursementStatusBadge status={newStatus} />}
              </div>
              <time dateTime={validDate ? timestamp : undefined} className="block tabular-nums">
                {validDate
                  ? new Intl.DateTimeFormat('en-PH', {
                      timeZone: 'Asia/Manila',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZoneName: 'short',
                    }).format(date)
                  : 'Timestamp unavailable'}
              </time>
              {reason && (
                <p className="text-danger whitespace-pre-wrap break-words">Reason: {reason}</p>
              )}
              {notes && <p className="whitespace-pre-wrap break-words">{notes}</p>}
              {auditDetails(event).map((line, detailIndex) => (
                <p key={detailIndex} className="whitespace-pre-wrap break-words">
                  {line}
                </p>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
