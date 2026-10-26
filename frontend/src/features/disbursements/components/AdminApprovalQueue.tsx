import { useState, useMemo, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Receipt,
  FileText,
  User,
  Building,
  AlertCircle,
  DollarSign,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RejectReasonModal } from '@/features/operations/components/RejectReasonModal';
import { AdminApprovalModal } from './AdminApprovalModal';
import { ReleaseFundsModal } from './FundsReleaseActions';
import { FundDisbursementModal } from './FundDisbursementModal';
import {
  useAllDisbursementsForQueue,
  useDisbursementCounts,
  useRejectDisbursement,
} from '../api/useDisbursements';
import { DisbursementStatusBadge } from './DisbursementStatusBadge';
import { useSessionStore } from '@/lib/session';
import { useEntityRealtimeSync } from '@/lib/realtime';
import { disbursementKeys } from '../api/queryKeys';
import type { Disbursement } from '../api/types';

export interface AdminApprovalQueueProps {
  onSelectDisbursement?: (id: string) => void;
}

export type QueueSegment = 'all' | 'initial_requests' | 'payment_releases' | 'ready_for_funding';

export function AdminApprovalQueue({ onSelectDisbursement }: AdminApprovalQueueProps) {
  useEntityRealtimeSync({ table: 'disbursements' });
  const [search, setSearch] = useState('');
  const [rejectingItem, setRejectingItem] = useState<Disbursement | null>(null);
  const [approvingItem, setApprovingItem] = useState<Disbursement | null>(null);
  const [releasingItem, setReleasingItem] = useState<Disbursement | null>(null);
  const [fundingItem, setFundingItem] = useState<Disbursement | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = currentUser?.role === 'Admin';
  const isAccounting = Boolean(
    currentUser?.role === 'Accounting' || currentUser?.departments?.includes('Accounting')
  );
  const canAccessQueue = isAdmin || isAccounting;

  const [segment, setSegment] = useState<QueueSegment>(isAdmin ? 'all' : 'payment_releases');

  // Complete traversal queries for queues with exact predicates
  const {
    data: initialResponse,
    isLoading: isLoadingInitial,
    isError: isErrorInitial,
    refetch: refetchInitial,
  } = useAllDisbursementsForQueue('initial_requests', {
    enabled: canAccessQueue,
  });
  const {
    data: releaseResponse,
    isLoading: isLoadingRelease,
    isError: isErrorRelease,
    refetch: refetchRelease,
  } = useAllDisbursementsForQueue('payment_releases', {
    enabled: canAccessQueue,
  });
  const {
    data: fundingResponse,
    isLoading: isLoadingFunding,
    isError: isErrorFunding,
    refetch: refetchFunding,
  } = useAllDisbursementsForQueue('ready_for_funding', {
    enabled: canAccessQueue,
  });

  const isLoading =
    (segment === 'initial_requests' && isLoadingInitial) ||
    (segment === 'payment_releases' && isLoadingRelease) ||
    (segment === 'ready_for_funding' && isLoadingFunding) ||
    (segment === 'all' && (isLoadingInitial || isLoadingRelease));

  // Server counts
  const { data: counts } = useDisbursementCounts({ enabled: canAccessQueue });
  const initialRequestsCount = counts?.initialRequests ?? initialResponse?.data?.length ?? 0;
  const paymentReleasesCount = counts?.paymentReleases ?? releaseResponse?.data?.length ?? 0;
  const readyForFundingCount = counts?.readyForFunding ?? fundingResponse?.data?.length ?? 0;

  // Strict v2 items with predicate enforcement
  const items = useMemo(() => {
    const rawInitial = (initialResponse?.data ?? []).filter(
      (item) =>
        item.lifecycle_version === 2 &&
        item.status === 'Draft' &&
        item.review_ready === true &&
        Number.isInteger(item.version) &&
        (item.version ?? 0) > 0 &&
        !item.archived
    );
    const rawRelease = (releaseResponse?.data ?? []).filter(
      (item) =>
        item.lifecycle_version === 2 &&
        item.status === 'Funded' &&
        Number.isInteger(item.version) &&
        (item.version ?? 0) > 0 &&
        !item.archived
    );
    const rawFunding = (fundingResponse?.data ?? []).filter(
      (item) =>
        item.lifecycle_version === 2 &&
        item.status === 'Approved' &&
        Number.isInteger(item.version) &&
        (item.version ?? 0) > 0 &&
        !item.archived
    );

    if (segment === 'initial_requests') {
      return rawInitial;
    }
    if (segment === 'payment_releases') {
      return rawRelease;
    }
    if (segment === 'ready_for_funding') {
      return rawFunding;
    }

    // 'all' combines actionable initial requests and payment releases
    const map = new Map<string, Disbursement>();
    for (const item of rawInitial) map.set(item.id, item);
    for (const item of rawRelease) map.set(item.id, item);
    const combined = Array.from(map.values());
    combined.sort((a, b) => {
      const timeA = new Date(a.created_at || a.createdAt || 0).getTime();
      const timeB = new Date(b.created_at || b.createdAt || 0).getTime();
      return timeB - timeA;
    });
    return combined;
  }, [segment, initialResponse?.data, releaseResponse?.data, fundingResponse?.data]);

  useEffect(() => {
    setPage(1);
  }, [search, segment]);

  // Mutations
  const { rejectDisbursement } = useRejectDisbursement();

  // Search filtering
  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      const num = item.disbursement_number || item.disbursementNumber || '';
      const desc = item.description || '';
      const cat = item.category || '';
      const client = item.client_name || item.clientName || item.clients?.name || '';
      return (
        num.toLowerCase().includes(q) ||
        desc.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q) ||
        client.toLowerCase().includes(q)
      );
    });
  }, [items, search]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, page, pageSize]);

  const handleApprove = (item: Disbursement) => {
    setApprovingItem(item);
  };

  if (!canAccessQueue) {
    return (
      <div
        className="p-8 text-center bg-canvas border border-border rounded-[12px] space-y-2"
        data-testid="admin-approval-queue-unauthorized"
      >
        <ShieldAlert className="h-8 w-8 text-warning mx-auto" />
        <h3 className="text-sm font-bold text-ink">Access Restricted</h3>
        <p className="text-xs text-muted">
          The pending approvals queue is restricted to Admin and Accounting roles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-approval-queue">
      {(isErrorInitial || isErrorRelease || isErrorFunding) && (
        <div
          role="alert"
          className="rounded border border-warning-border bg-warning-surface p-3 text-xs text-warning"
        >
          The queue could not be refreshed. Review current records before taking action.
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void refetchInitial();
              void refetchRelease();
              void refetchFunding();
            }}
          >
            Refresh queues
          </Button>
        </div>
      )}
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <Clock className="h-5 w-5 text-warning" />
            {isAdmin ? 'Admin Approval Queue' : 'Accounting Funds Tracking'}
          </h2>
          <p className="text-xs text-muted mt-0.5">
            {isAdmin
              ? 'Review and authorize pending disbursement requests and sanction released payments.'
              : 'Track funded vouchers across authorized entities and prepare payment instruments for approved requests.'}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted" />
          <Input
            type="text"
            placeholder={isAdmin ? 'Search pending vouchers...' : 'Search vouchers...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs h-8"
            data-testid="pending-queue-search-input"
          />
        </div>
      </div>

      {/* Queue Segmentation Sub-tabs */}
      <div
        className="flex items-center gap-1.5 p-1 bg-sidebar rounded-[8px] border border-border text-xs w-full overflow-x-auto whitespace-nowrap"
        data-testid="queue-segmentation-tabs"
      >
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSegment('all')}
            className={`px-3 py-1 rounded-[6px] font-medium transition-[background-color,border-color,color,box-shadow] ${
              segment === 'all'
                ? 'bg-surface text-primary-hover shadow-2xs font-semibold'
                : 'text-muted hover:text-ink'
            }`}
            data-testid="queue-subtab-all"
          >
            All Pending ({initialRequestsCount + paymentReleasesCount})
          </button>
        )}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setSegment('initial_requests')}
            className={`px-3 py-1 rounded-[6px] font-medium transition-[background-color,border-color,color,box-shadow] ${
              segment === 'initial_requests'
                ? 'bg-surface text-primary-hover shadow-2xs font-semibold'
                : 'text-muted hover:text-ink'
            }`}
            data-testid="queue-subtab-initial"
          >
            Initial Requests ({initialRequestsCount})
          </button>
        )}
        <button
          type="button"
          onClick={() => setSegment('payment_releases')}
          className={`px-3 py-1 rounded-[6px] font-medium transition-[background-color,border-color,color,box-shadow] ${
            segment === 'payment_releases'
              ? 'bg-surface text-primary-hover shadow-2xs font-semibold'
              : 'text-muted hover:text-ink'
          }`}
          data-testid="queue-subtab-payment-releases"
        >
          {isAdmin
            ? `Payment Releases (${paymentReleasesCount})`
            : `Funded Tracking (${paymentReleasesCount})`}
        </button>
        <button
          type="button"
          onClick={() => setSegment('ready_for_funding')}
          className={`px-3 py-1 rounded-[6px] font-medium transition-[background-color,border-color,color,box-shadow] ${
            segment === 'ready_for_funding'
              ? 'bg-surface text-primary-hover shadow-2xs font-semibold'
              : 'text-muted hover:text-ink'
          }`}
          data-testid="queue-subtab-funding"
        >
          Ready for Funding ({readyForFundingCount})
        </button>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-muted" data-testid="pending-queue-loading">
          Loading approval items...
        </div>
      ) : filteredItems.length === 0 ? (
        /* Empty state */
        <div
          className="p-10 text-center bg-canvas border border-border rounded-[8px]"
          data-testid="pending-queue-empty"
        >
          <CheckCircle2 className="h-10 w-10 text-success mx-auto mb-3" />
          <h3 className="text-sm font-bold text-ink">
            {isAdmin ? 'Queue is Clear' : 'No Vouchers in Queue'}
          </h3>
          <p className="text-xs text-muted mt-1">
            {isAdmin
              ? 'There are no pending disbursements requiring administrative action.'
              : 'There are no vouchers currently in this tracking queue.'}
          </p>
        </div>
      ) : (
        /* Items list */
        <div className="grid gap-3" data-testid="pending-queue-items-list">
          {paginatedItems.map((item) => {
            const disbNumber =
              item.disbursement_number || item.disbursementNumber || `DISB-${item.id.slice(0, 8)}`;
            const clientName =
              item.client_name || item.clientName || item.clients?.name || 'Firm Internal';
            const workRequestId = item.linked_work_request_id || item.linkedWorkRequestId;

            const isReturnedDraft = item.status === 'Draft' && item.review_ready === false;
            const cannotApprove = isReturnedDraft;
            const approveTitle = isReturnedDraft
              ? 'Returned voucher awaiting requester correction'
              : 'Approve voucher';

            return (
              <div
                key={item.id}
                className="p-4 bg-surface border border-border rounded-[6px] hover:border-border transition-colors shadow-none space-y-3"
                data-testid={`pending-item-${item.id}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-ink">{disbNumber}</span>
                      <DisbursementStatusBadge
                        status={item.status}
                        reviewReady={item.review_ready}
                      />
                      <span className="text-xs font-medium px-2 py-0.5 rounded-[6px] bg-canvas text-muted">
                        {item.category}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-[6px] bg-canvas text-ink">
                        {item.fund_source || item.fundSource}
                      </span>
                    </div>
                    <p className="text-xs text-ink font-medium line-clamp-2">
                      {item.description}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className="text-sm font-bold text-ink block"
                      data-testid={`item-amount-${item.id}`}
                    >
                      ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs tabular-nums text-muted">
                      {new Date(item.created_at || item.createdAt || '').toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Metadata strip */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted pt-1 border-t border-border">
                  <span className="flex items-center gap-1">
                    <Building className="h-3 w-3 text-muted" />
                    {clientName}
                  </span>
                  {(item.linked_work_request_name ||
                    item.linked_work_request_order_number ||
                    workRequestId) && (
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3 text-muted" />
                      WR:{' '}
                      <span className="tabular-nums" data-testid={`pending-item-wr-${item.id}`}>
                        {item.linked_work_request_order_number && item.linked_work_request_name
                          ? `${item.linked_work_request_order_number} — ${item.linked_work_request_name}`
                          : item.linked_work_request_name ||
                            item.linked_work_request_order_number ||
                            'Work Request Linked'}
                      </span>
                    </span>
                  )}
                  {(item.employee_name ||
                    item.employeeName ||
                    item.requested_by_name ||
                    item.requestedByName ||
                    item.created_by_name ||
                    item.createdByName ||
                    item.requested_by ||
                    item.requestedBy ||
                    item.created_by ||
                    item.createdBy) && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3 text-muted" />
                      {item.employee_name ||
                        item.employeeName ||
                        item.requested_by_name ||
                        item.requestedByName ||
                        item.created_by_name ||
                        item.createdByName ||
                        item.requested_by ||
                        item.requestedBy ||
                        item.created_by ||
                        item.createdBy}
                    </span>
                  )}
                  {(item.receipt_filename || item.receiptFilename) && (
                    <span className="flex items-center gap-1 text-ink">
                      <Receipt className="h-3 w-3" />
                      {item.receipt_filename || item.receiptFilename}
                    </span>
                  )}
                </div>

                {/* Duty Separation & Readiness Notices */}
                {isReturnedDraft && (
                  <div
                    className="flex items-center gap-1.5 text-xs font-medium text-warning bg-warning-surface px-2.5 py-1 rounded border border-warning-border"
                    data-testid={`needs-correction-notice-${item.id}`}
                  >
                    <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0" />
                    <span>Awaiting Requester Correction</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                  {onSelectDisbursement && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onSelectDisbursement(item.id)}
                      className="text-xs h-7 mr-auto"
                      data-testid={`view-detail-btn-${item.id}`}
                    >
                      View Details
                    </Button>
                  )}

                  {/* Approved status: Accounting or Admin can prepare payment */}
                  {item.status === 'Approved' && (isAdmin || isAccounting) && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => setFundingItem(item)}
                      className="text-xs h-7 bg-primary hover:bg-primary-hover text-inverse font-medium"
                      data-testid={`fund-btn-${item.id}`}
                    >
                      <DollarSign className="h-3.5 w-3.5 mr-1" />
                      Prepare Payment
                    </Button>
                  )}

                  {/* Admin actions on Draft or Funded */}
                  {isAdmin && item.status !== 'Rejected' && item.status !== 'Approved' && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRejectingItem(item)}
                        className="text-xs h-7 text-danger border-danger-border hover:bg-danger-surface"
                        data-testid={`reject-btn-${item.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1 text-danger-solid" />
                        Reject
                      </Button>
                      {item.status === 'Funded' ? (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          title="Release payment funds"
                          onClick={() => setReleasingItem(item)}
                          className="text-xs h-7 bg-primary hover:bg-primary-hover text-inverse font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          data-testid={`release-btn-${item.id}`}
                        >
                          <DollarSign className="h-3.5 w-3.5 mr-1" />
                          Release
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={cannotApprove}
                          title={approveTitle}
                          onClick={() => handleApprove(item)}
                          className="text-xs h-7 bg-success hover:bg-success text-inverse font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          data-testid={`approve-btn-${item.id}`}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Approve
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls */}
      {filteredItems.length > pageSize && (
        <div
          className="flex items-center justify-between px-2 pt-2 text-xs text-muted border-t border-border"
          data-testid="queue-pagination-bar"
        >
          <span data-testid="queue-page-info">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredItems.length)} of{' '}
            {filteredItems.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              data-testid="queue-prev-page"
              className="h-7 px-2 text-xs"
            >
              Previous
            </Button>
            <span data-testid="queue-page-indicator">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              data-testid="queue-next-page"
              className="h-7 px-2 text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Generalized Reject Modal */}
      {rejectingItem && (
        <RejectReasonModal
          isOpen={Boolean(rejectingItem)}
          requestId={rejectingItem.id}
          title="Reject Disbursement Voucher"
          description={`Provide a justification for rejecting voucher ${
            rejectingItem.disbursement_number ||
            rejectingItem.disbursementNumber ||
            rejectingItem.id
          } (1–500 characters).`}
          placeholder="e.g. Ineligible reimbursement item without valid receipt..."
          submitLabel="Reject Voucher"
          maxLength={500}
          onReject={async (id, reason) => {
            await rejectDisbursement({ id, reason, expectedVersion: rejectingItem.version });
          }}
          invalidateQueries={[disbursementKeys.all]}
          onClose={() => setRejectingItem(null)}
          onSuccess={() => setRejectingItem(null)}
        />
      )}

      {/* Admin Direct Approval Modal */}
      {approvingItem && (
        <AdminApprovalModal
          isOpen={Boolean(approvingItem)}
          disbursement={approvingItem}
          onClose={() => setApprovingItem(null)}
          onSuccess={() => setApprovingItem(null)}
        />
      )}

      {/* Release Funds Modal for Payment Releases */}
      {releasingItem && (
        <ReleaseFundsModal
          isOpen={Boolean(releasingItem)}
          disbursement={releasingItem}
          onClose={() => setReleasingItem(null)}
          onSuccess={() => setReleasingItem(null)}
        />
      )}

      {/* Fund Modal for Preparing Payment */}
      {fundingItem && (
        <FundDisbursementModal
          isOpen={Boolean(fundingItem)}
          disbursement={fundingItem}
          onClose={() => setFundingItem(null)}
          onSuccess={() => setFundingItem(null)}
        />
      )}
    </div>
  );
}
