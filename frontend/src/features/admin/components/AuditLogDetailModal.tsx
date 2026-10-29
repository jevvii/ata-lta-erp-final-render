import { useState, useEffect } from 'react';
import {
  ArrowRight,
  ExternalLink,
  Code2,
  GitCompare,
  ShieldCheck,
  Briefcase,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSessionStore } from '@/lib/session';
import {
  buildAuditRouteHref,
  formatAuditAction,
  getAuditActionBadgeStyle,
  getAuditItemIdentifier,
  getAuditItemRouteLink,
  getAuditModuleLabel,
  parseAuditDiffRows,
  resolveAuditBusinessContext,
  type AuditItemRouteLink,
} from '../utils/auditFormatters';
import type { AdminUser, AuditLogEntry, EntityCode } from '../api/types';
import { UserAvatar } from '@/components/common/UserAvatar';

export interface AuditLogDetailModalProps {
  entry: AuditLogEntry | null;
  usersMap?: Map<string, AdminUser>;
  isOpen: boolean;
  onClose: () => void;
}

function formatFullTimestamp(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function AuditLogDetailModal({
  entry,
  usersMap,
  isOpen,
  onClose,
}: AuditLogDetailModalProps) {
  const navigate = useNavigate();
  const activeEntity = useSessionStore((s) => s.activeEntity);
  const setActiveEntity = useSessionStore((s) => s.setActiveEntity);
  const currentUser = useSessionStore((s) => s.user);

  const [viewMode, setViewMode] = useState<'diff' | 'json'>('diff');

  useEffect(() => {
    if (isOpen) {
      setViewMode('diff');
    }
  }, [entry?.id, isOpen]);

  if (!entry) return null;

  const actorId = entry.userId ?? entry.user_id ?? (entry as { actor_id?: string }).actor_id ?? null;
  const actorUser = actorId && usersMap ? usersMap.get(actorId) : undefined;
  const actorName = entry.actorName || actorUser?.name || (actorId ? actorId : 'System');
  const actorEmail = entry.actorEmail || actorUser?.email || (entry as { actor_email?: string }).actor_email || null;
  const actorRole = actorUser?.role ?? (actorId ? 'User' : 'Automated');
  const actorAvatarUrl = entry.actorAvatarUrl || (entry as { actor_avatar_url?: string }).actor_avatar_url || actorUser?.avatarUrl || null;
  const timestamp = entry.timestamp ?? entry.createdAt ?? entry.created_at;
  const entityLabel = entry.entity || 'System';
  const actionLabel = formatAuditAction(entry);
  const actionBadgeClass = getAuditActionBadgeStyle(entry);
  const moduleLabel = getAuditModuleLabel(entry);
  const targetIdentifier = getAuditItemIdentifier(entry, usersMap);
  const routeLink = getAuditItemRouteLink(entry);
  const businessContext = resolveAuditBusinessContext(entry, usersMap);
  const diffRows = parseAuditDiffRows(entry.details, usersMap);

  const auditCode =
    entry.auditNumber ||
    entry.audit_number ||
    `AUR-${entry.id.slice(0, 8).toUpperCase()}`;

  const attachedItemNumber = (
    entry.details?.workRequestNumber ||
    entry.details?.work_request_number ||
    entry.details?.workRequestNo ||
    entry.details?.work_request_no ||
    entry.details?.clientNumber ||
    entry.details?.client_number ||
    entry.details?.userNumber ||
    entry.details?.user_number ||
    entry.details?.invoiceNumber ||
    entry.details?.invoice_number ||
    entry.details?.disbursementNumber ||
    entry.details?.disbursement_number ||
    entry.details?.voucherNumber ||
    entry.details?.voucher_number ||
    entry.details?.trackingNumber ||
    entry.details?.tracking_number
  ) as string | undefined;

  const navigateToLink = (link: AuditItemRouteLink | null | undefined) => {
    if (!link) return;
    const targetEntity = (entry.entity || '').toUpperCase();
    if (
      (targetEntity === 'ATA' || targetEntity === 'LTA') &&
      activeEntity !== targetEntity &&
      currentUser?.entities?.includes(targetEntity as EntityCode)
    ) {
      setActiveEntity(targetEntity);
    }
    onClose();
    navigate(buildAuditRouteHref(link));
  };

  const handleViewRecord = () => {
    navigateToLink(routeLink);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-[12px] border border-[#E2E8F0] bg-[#FFFFFF] p-6 shadow-float space-y-4"
        data-testid="audit-detail-modal"
      >
        <DialogHeader className="border-b border-[#E2E8F0] pb-4">
          <div className="flex items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#1D4ED8]" />
              <DialogTitle className="text-lg font-semibold tracking-tight text-[#1E293B]">
                Audit Entry Details
              </DialogTitle>
            </div>
            <Badge
              variant="outline"
              data-testid="audit-detail-aur-badge"
              className="rounded-[6px] border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-0.5 font-mono text-xs font-semibold text-[#1D4ED8] tabular-nums"
            >
              {auditCode} · {moduleLabel}
            </Badge>
          </div>
          <DialogDescription className="text-xs text-[#475569] pt-1">
            Immutable record of system activity, actor identity, and field-level state changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary Metadata Card */}
          <div className="rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {/* Action */}
              <div>
                <div className="text-xs font-medium text-[#475569]">
                  Action
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-[6px] border px-2 py-0.5 text-xs font-medium ${actionBadgeClass}`}
                    data-testid="audit-detail-action-badge"
                  >
                    {actionLabel}
                  </span>
                  <span className="font-mono text-[11px] text-[#475569]">
                    ({entry.action})
                  </span>
                </div>
              </div>

              {/* Actor / User */}
              <div>
                <div className="text-xs font-medium text-[#475569]">
                  Performed By
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <UserAvatar
                    userId={actorId}
                    name={actorName}
                    email={actorEmail}
                    avatarUrl={actorAvatarUrl}
                    size="sm"
                    shape="rounded"
                    className="h-8 w-8 rounded-[6px] text-[12px]"
                  />
                  <div className="min-w-0">
                    <span
                      className="truncate text-xs font-semibold text-[#1E293B]"
                      data-testid="audit-detail-actor-name"
                    >
                      {actorName}
                    </span>
                    <span className="ml-1.5 inline-flex items-center rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] px-1.5 py-0.5 text-[10px] font-medium text-[#475569]">
                      {actorRole}
                    </span>
                  </div>
                </div>
              </div>

              {/* Timestamp */}
              <div>
                <div className="text-xs font-medium text-[#475569]">
                  Timestamp
                </div>
                <div
                  className="mt-1 font-mono text-xs font-medium text-[#1E293B] tabular-nums"
                  data-testid="audit-detail-timestamp"
                >
                  {formatFullTimestamp(timestamp)}
                </div>
              </div>

              {/* Entity & Target Record */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs font-medium text-[#475569]">
                    Entity
                  </div>
                  <div className="mt-1">
                    <Badge
                      variant="outline"
                      className={
                        entityLabel === 'ATA'
                          ? 'bg-[#1D4ED8] text-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                          : 'bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] rounded-[6px] text-xs font-bold px-2 py-0.5'
                      }
                      data-testid="audit-detail-entity"
                    >
                      {entityLabel}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-[#475569]">
                    Target Record
                  </div>
                  <div className="mt-1 min-w-0 flex items-center gap-1.5 flex-wrap">
                    {attachedItemNumber && !targetIdentifier.includes(attachedItemNumber) && (
                      <Badge
                        variant="outline"
                        className="rounded-[6px] border-[#BFDBFE] bg-[#EFF6FF] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#1D4ED8] tabular-nums"
                        data-testid="audit-detail-attached-badge"
                      >
                        {attachedItemNumber}
                      </Badge>
                    )}
                    {routeLink && targetIdentifier !== '—' ? (
                      <button
                        type="button"
                        onClick={handleViewRecord}
                        title={routeLink.label}
                        className="inline-flex max-w-full items-center gap-1 font-mono text-xs font-semibold text-[#1D4ED8] hover:text-[#1E40AF] hover:underline cursor-pointer text-left"
                        data-testid="audit-detail-target-link"
                      >
                        <span className="truncate">{targetIdentifier}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </button>
                    ) : (
                      <span
                        className="truncate font-mono text-xs text-[#475569] tabular-nums"
                        title={targetIdentifier}
                        data-testid="audit-detail-id"
                      >
                        {targetIdentifier !== '—' ? targetIdentifier : entry.id}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Business Context Section */}
          {(businessContext.length > 0 || targetIdentifier !== '—') && (
            <div
              className="rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-3.5"
              data-testid="audit-detail-business-context"
            >
              <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-[#1E293B]">
                  <Briefcase className="h-3.5 w-3.5 text-[#1D4ED8]" />
                  Business Context
                </span>
                {routeLink && targetIdentifier !== '—' ? (
                  <button
                    type="button"
                    onClick={handleViewRecord}
                    title={routeLink.label}
                    className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-[#1D4ED8] hover:text-[#1E40AF] hover:underline cursor-pointer"
                  >
                    <span>{targetIdentifier}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </button>
                ) : (
                  <span className="font-mono text-xs font-semibold text-[#1E293B]">
                    {targetIdentifier}
                  </span>
                )}
              </div>
              {businessContext.length > 0 && (
                <div className="grid grid-cols-1 gap-2.5 border-t border-[#E2E8F0] pt-2.5 sm:grid-cols-2">
                  {businessContext.map((ctx, idx) => (
                    <div key={`${ctx.label}-${idx}`} className="flex flex-col items-start">
                      <span className="text-xs text-[#475569]">
                        {ctx.label}
                      </span>
                      {ctx.routeLink ? (
                        <button
                          type="button"
                          onClick={() => navigateToLink(ctx.routeLink)}
                          title={ctx.routeLink.label}
                          className={`mt-0.5 inline-flex items-center gap-1 text-xs text-[#1D4ED8] hover:text-[#1E40AF] hover:underline cursor-pointer text-left ${
                            ctx.isCode || ctx.isAmount
                              ? 'font-mono font-semibold tabular-nums'
                              : 'font-medium'
                          }`}
                        >
                          <span>{ctx.value}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </button>
                      ) : (
                        <span
                          className={`mt-0.5 text-xs text-[#1E293B] ${
                            ctx.isCode || ctx.isAmount
                              ? 'font-mono font-semibold tabular-nums'
                              : 'font-medium'
                          }`}
                        >
                          {ctx.value}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Audit Change Details Section with Segmented View Switcher */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#1E293B]">
                Audit Change Details
              </span>

              <div className="inline-flex rounded-[8px] border border-[#E2E8F0] bg-[#F8FAFC] p-1 gap-1">
                <button
                  type="button"
                  onClick={() => setViewMode('diff')}
                  className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    viewMode === 'diff'
                      ? 'bg-[#FFFFFF] text-[#1E40AF] font-semibold shadow-2xs border-b-2 border-[#1D4ED8]'
                      : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                  }`}
                  data-testid="audit-view-visual-diff"
                >
                  <GitCompare className="h-3.5 w-3.5" />
                  Visual Diff
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('json')}
                  className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                    viewMode === 'json'
                      ? 'bg-[#FFFFFF] text-[#1E40AF] font-semibold shadow-2xs border-b-2 border-[#1D4ED8]'
                      : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0]/60'
                  }`}
                  data-testid="audit-view-raw-json"
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Raw JSON
                </button>
              </div>
            </div>

            {viewMode === 'diff' ? (
              <div
                className="rounded-[8px] border border-[#E2E8F0] bg-[#FFFFFF] overflow-hidden"
                data-testid="audit-visual-diff-container"
              >
                {diffRows.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#475569]">
                    No additional field-level payload recorded for this action.
                  </div>
                ) : (
                  <div className="divide-y divide-[#E2E8F0]">
                    {diffRows.map((row) => (
                      <div
                        key={row.field}
                        className="flex flex-col justify-between gap-1.5 px-3.5 py-2.5 sm:flex-row sm:items-center"
                        data-testid={`audit-diff-row-${row.field}`}
                      >
                        <span className="text-xs font-medium text-[#475569]">
                          {row.label}
                        </span>
                        {row.isDiff ? (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span
                              className="inline-flex items-center rounded-[6px] border border-[#FECACA] bg-[#FEF2F2] px-2 py-0.5 font-mono text-xs text-[#991B1B] line-through"
                              data-testid={`audit-diff-before-${row.field}`}
                            >
                              {row.before ?? 'None'}
                            </span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#475569]" />
                            <span
                              className="inline-flex items-center rounded-[6px] border border-[#BBF7D0] bg-[#F0FDF4] px-2 py-0.5 font-mono text-xs font-semibold text-[#166534]"
                              data-testid={`audit-diff-after-${row.field}`}
                            >
                              {row.after}
                            </span>
                          </div>
                        ) : (
                          <span
                            className="font-mono text-xs font-medium text-[#1E293B]"
                            data-testid={`audit-diff-value-${row.field}`}
                          >
                            {row.after}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <pre
                className="max-h-72 overflow-auto rounded-[8px] border border-[#1E293B] bg-[#0F172A] p-3.5 font-mono text-xs leading-relaxed text-[#F8FAFC]"
                data-testid="audit-raw-json-pre"
              >
                {JSON.stringify(entry.details ?? {}, null, 2)}
              </pre>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-[#E2E8F0] pt-4 flex items-center justify-between gap-2 sm:justify-between">
          <div className="flex items-center gap-2">
            {attachedItemNumber && (
              <Badge
                variant="outline"
                className="rounded-[6px] border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 font-mono text-xs font-semibold text-[#1E293B] tabular-nums"
                data-testid="audit-detail-attached-number"
              >
                {attachedItemNumber}
              </Badge>
            )}
            {routeLink && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleViewRecord}
                className="h-9 gap-1.5 rounded-[6px] border-[#BFDBFE] bg-[#EFF6FF] text-xs font-medium text-[#1D4ED8] hover:bg-[#DBEAFE] hover:text-[#1E40AF] cursor-pointer"
                data-testid="audit-view-record-btn"
              >
                <span>View Record</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-9 rounded-[6px] border-[#E2E8F0] bg-[#FFFFFF] text-xs font-medium text-[#1E293B] hover:bg-[#F8FAFC] cursor-pointer"
            data-testid="audit-detail-close-btn"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
