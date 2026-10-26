import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RejectReasonModal } from '@/features/operations/components/RejectReasonModal';
import {
  useDisbursementsList,
  useApproveDisbursement,
  useRejectDisbursement,
} from '../api/useDisbursements';
import { DisbursementStatusBadge } from './DisbursementStatusBadge';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { disbursementKeys } from '../api/queryKeys';
import type { Disbursement } from '../api/types';

export interface AdminApprovalQueueProps {
  onSelectDisbursement?: (id: string) => void;
}

export function AdminApprovalQueue({ onSelectDisbursement }: AdminApprovalQueueProps) {
  const [search, setSearch] = useState('');
  const [rejectingItem, setRejectingItem] = useState<Disbursement | null>(null);

  const permissions = useSessionStore((state) => state.permissions);
  const currentUser = useSessionStore((state) => state.user);
  const canApprove = hasPermission(permissions, 'disbursement:approve');

  // Query pending and pending admin approval items
  const { data: responsePending, isLoading: isLoadingPending } = useDisbursementsList({
    status: 'Pending',
  });
  const { data: responsePendingAdmin, isLoading: isLoadingPendingAdmin } = useDisbursementsList({
    status: 'Pending Admin Approval',
  });
  const isLoading = isLoadingPending || isLoadingPendingAdmin;

  const items = useMemo(() => {
    const listPending = responsePending?.data ?? [];
    const listPendingAdmin = responsePendingAdmin?.data ?? [];
    const map = new Map<string, Disbursement>();
    for (const item of listPending) map.set(item.id, item);
    for (const item of listPendingAdmin) map.set(item.id, item);
    const raw = Array.from(map.values());
    if (canApprove) return raw;
    return raw.filter((item) => {
      const creator = item.created_by || item.createdBy;
      const emp = item.employee_id || item.employeeId;
      return (creator && creator === currentUser?.id) || (emp && emp === currentUser?.id);
    });
  }, [responsePending, responsePendingAdmin, canApprove, currentUser?.id]);

  // Mutations
  const { approveWithBlocking } = useApproveDisbursement();
  const { rejectDisbursement } = useRejectDisbursement();

  // Filtered items
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

  const handleApprove = async (item: Disbursement) => {
    try {
      await approveWithBlocking(item.id);
    } catch {
      // Captured by BlockingActionModal
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-approval-queue">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            {canApprove ? 'Admin Approval Queue' : 'My Submitted Approvals'}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {canApprove
              ? 'Review and adjudicate pending disbursement requests. Approved vouchers proceed to funds release.'
              : 'View status of your submitted disbursement vouchers awaiting administrative approval.'}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <Input
            type="text"
            placeholder={canApprove ? 'Search pending vouchers...' : 'Search my submissions...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 text-xs h-8"
            data-testid="pending-queue-search-input"
          />
        </div>
      </div>

      {/* Loading state */}
      {isLoading ? (
        <div className="p-8 text-center text-xs text-slate-500" data-testid="pending-queue-loading">
          Loading pending approval items...
        </div>
      ) : filteredItems.length === 0 ? (
        /* Empty state */
        <div
          className="p-10 text-center bg-slate-50 border border-slate-200 rounded-xl"
          data-testid="pending-queue-empty"
        >
          <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
          <h3 className="text-sm font-bold text-slate-800">
            {canApprove ? 'Queue is Clear' : 'No Pending Submissions'}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {canApprove
              ? 'There are no pending disbursements requiring administrative review.'
              : 'You do not have any pending disbursement vouchers awaiting approval.'}
          </p>
        </div>
      ) : (
        /* Items list */
        <div className="grid gap-3" data-testid="pending-queue-items-list">
          {filteredItems.map((item) => {
            const disbNumber =
              item.disbursement_number || item.disbursementNumber || `DISB-${item.id.slice(0, 8)}`;
            const clientName =
              item.client_name || item.clientName || item.clients?.name || 'Firm Internal';
            const workRequestId = item.linked_work_request_id || item.linkedWorkRequestId;

            return (
              <div
                key={item.id}
                className="p-4 bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-colors shadow-2xs space-y-3"
                data-testid={`pending-item-${item.id}`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-900">
                        {disbNumber}
                      </span>
                      <DisbursementStatusBadge status={item.status} />
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                        {item.category}
                      </span>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
                        {item.fund_source || item.fundSource}
                      </span>
                    </div>
                    <p className="text-xs text-slate-800 font-medium line-clamp-2">
                      {item.description}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-sm font-bold text-slate-900 block" data-testid={`item-amount-${item.id}`}>
                      ₱{item.amount.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(item.created_at || item.createdAt || '').toLocaleDateString()}
                    </span>
                  </div>
                </div>

                {/* Metadata strip */}
                <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                  <span className="flex items-center gap-1">
                    <Building className="h-3 w-3 text-slate-400" />
                    {clientName}
                  </span>
                  {(item.linked_work_request_name || item.linked_work_request_order_number || workRequestId) && (
                    <span className="flex items-center gap-1">
                      <FileText className="h-3 w-3 text-slate-400" />
                      WR:{' '}
                      <span className="font-mono">
                        {item.linked_work_request_name ||
                          item.linked_work_request_order_number ||
                          `${(workRequestId || '').slice(0, 8)}...`}
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
                      <User className="h-3 w-3 text-slate-400" />
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
                    <span className="flex items-center gap-1 text-blue-600">
                      <Receipt className="h-3 w-3" />
                      {item.receipt_filename || item.receiptFilename}
                    </span>
                  )}
                </div>

                {/* Rejection notice on rejected vouchers */}
                {item.status === 'Rejected' && (
                  <div
                    className="p-2.5 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-900 space-y-1 mt-2"
                    data-testid={`rejection-display-${item.id}`}
                  >
                    <div className="font-semibold text-rose-800 flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                      <span>Voucher Rejected</span>
                    </div>
                    <p className="text-rose-700 pl-4.5">
                      Reason: {item.rejection_reason || item.rejectionReason || 'No reason specified'}
                    </p>
                    <p className="text-[10px] text-rose-600 pl-4.5">
                      Rejected by: {item.rejected_by_name || item.rejectedByName || item.rejected_by || item.rejectedBy || 'Admin'}
                      {(item.rejected_at || item.rejectedAt) &&
                        ` on ${new Date(item.rejected_at || item.rejectedAt || '').toLocaleString()}`}
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
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
                  {canApprove && item.status !== 'Rejected' && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRejectingItem(item)}
                        className="text-xs h-7 text-rose-600 border-rose-200 hover:bg-rose-50"
                        data-testid={`reject-btn-${item.id}`}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1 text-rose-600" />
                        Reject
                      </Button>
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => handleApprove(item)}
                        className="text-xs h-7 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                        data-testid={`approve-btn-${item.id}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                        Approve
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Generalized Reject Modal */}
      {rejectingItem && (
        <RejectReasonModal
          isOpen={Boolean(rejectingItem)}
          requestId={rejectingItem.id}
          title="Reject Disbursement Voucher"
          description={`Provide a justification for rejecting voucher ${
            rejectingItem.disbursement_number || rejectingItem.disbursementNumber || rejectingItem.id
          } (1–500 characters).`}
          placeholder="e.g. Ineligible reimbursement item without valid receipt..."
          submitLabel="Reject Voucher"
          maxLength={500}
          onReject={async (id, reason) => {
            await rejectDisbursement({ id, reason });
          }}
          invalidateQueries={[disbursementKeys.all]}
          onClose={() => setRejectingItem(null)}
          onSuccess={() => setRejectingItem(null)}
        />
      )}
    </div>
  );
}
