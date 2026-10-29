import { usePendingWorkRequestCreationCount } from '../api/useWorkRequests';
import { useState, useMemo, useEffect } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowRight,
  RotateCcw,
  Check,
  X,
  Search,
  Building,
  User,
  Users,
  CheckSquare,
  Receipt,
  Send,
  CreditCard,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { RejectReasonModal } from './RejectReasonModal';
import { runBlockingAction } from './BlockingActionModal';
import { WorkRequestModal } from './WorkRequestModal';
import {
  useOperationsRequests,
  useOperationsRequestCounts,
  usePhaseTransitions,
} from '../api/usePhaseTransitions';
import {
  useWorkRequestDetail,
  useWorkRequestCreationApprovals,
  useWorkRequestMutations,
} from '../api/useWorkRequests';
import { useTeam } from '../api/useTeam';
import { operationsKeys } from '../api/queryKeys';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isUserAdmin } from '../lib/taskScope';
import { TaskTypeBadge } from '../lib/taskTypes';
import { useEntityRealtimeSync } from '@/lib/realtime';
import type { Phase, OperationsRequest, WorkRequest } from '../api/types';

export interface PendingApprovalsInboxProps {
  onNavigateToWr?: (wrId: string) => void;
}

export function PendingApprovalsInbox({ onNavigateToWr }: PendingApprovalsInboxProps) {
  const [category, setCategory] = useState<'transitions' | 'wr-creations'>('transitions');
  const [activeSubTab, setActiveSubTab] = useState<'pending' | 'rejected' | 'fulfilled' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [resubmitNotes, setResubmitNotes] = useState('');
  const [isResubmitting, setIsResubmitting] = useState(false);

  const activeEntity = useSessionStore((state) => state.activeEntity);
  const permissions = useSessionStore((state) => state.permissions);
  const currentUser = useSessionStore((state) => state.user);
  const currentUserId = currentUser?.id;
  const isAdmin = isUserAdmin(currentUser);
  const isManager = currentUser?.role === 'Manager';

  // WR Creation Approvals State
  const [wrCreationTab, setWrCreationTab] = useState<'pending' | 'rejected' | 'approved'>('pending');
  const [wrSearch, setWrSearch] = useState('');
  const [selectedWrId, setSelectedWrId] = useState<string | null>(null);
  const [rejectingWrIntent, setRejectingWrIntent] = useState<{
    id: string;
    expectedVersion: number;
    title: string;
  } | null>(null);
  const [resubmitWr, setResubmitWr] = useState<WorkRequest | null>(null);

  const canApprove = hasPermission(permissions, 'workflow:phase_transition');
  const canRequest = hasPermission(permissions, 'workflow:transition_request');

  // Real-time CDC subscription for operations requests
  useEntityRealtimeSync({
    table: 'operations_requests',
    listRootKey: operationsKeys.requests(),
    detailQueryKey: (id) => operationsKeys.requestDetail(id),
    activeEntity,
  });

  // Queries
  const { data: rawRequests, isLoading, isError, error: reqError, refetch } = useOperationsRequests({
    status: activeSubTab === 'all' ? undefined : activeSubTab,
  });

  const isReqErrorDenied = Boolean(
    isError &&
      ((reqError as { status?: number })?.status === 401 ||
        (reqError as { status?: number })?.status === 403 ||
        (reqError as { status?: number })?.status === 404)
  );

  const requests = useMemo((): OperationsRequest[] => {
    if (isReqErrorDenied) return [];
    if (Array.isArray(rawRequests)) return rawRequests as OperationsRequest[];
    if (
      rawRequests &&
      typeof rawRequests === 'object' &&
      'data' in rawRequests &&
      Array.isArray((rawRequests as { data: unknown[] }).data)
    ) {
      return (rawRequests as { data: OperationsRequest[] }).data;
    }
    return [];
  }, [rawRequests, isReqErrorDenied]);

  const { data: counts } = useOperationsRequestCounts();
  const pendingCount = counts?.pending ?? 0;

  // Team directory lookup for resolving assignee names (UAT2-4)
  const { data: rawTeam } = useTeam();
  const teamList = useMemo(() => {
    if (Array.isArray(rawTeam)) return rawTeam;
    if (rawTeam && typeof rawTeam === 'object' && 'data' in rawTeam && Array.isArray((rawTeam as { data: unknown[] }).data)) {
      return (rawTeam as { data: Array<{ id: string; name: string }> }).data;
    }
    return [];
  }, [rawTeam]);

  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of teamList) {
      if (m && m.id && m.name) {
        map.set(m.id, m.name);
      }
    }
    return map;
  }, [teamList]);

  const resolveName = useMemo(() => {
    return (idOrName: string | null | undefined): string => {
      if (!idOrName) return 'Unassigned';
      if (teamMap.has(idOrName)) return teamMap.get(idOrName)!;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrName);
      if (isUuid) return 'Staff Member';
      return idOrName;
    };
  }, [teamMap]);

  // Mutations
  const { fulfillRequest, cancelRequest, requestTransition } = usePhaseTransitions();
  const { approveOrRejectCreation } = useWorkRequestMutations();

  // WR Creation Approvals Queries & Mutations
  const wrScope = isAdmin ? 'all' : 'mine';
  const {
    data: rawCreationApprovals,
    isLoading: isLoadingCreationApprovals,
    isError: isCreationApprovalsError,
    error: creationApprovalsError,
    refetch: refetchCreationApprovals,
  } = useWorkRequestCreationApprovals(
    {
      status: wrCreationTab,
      scope: wrScope,
    },
    { enabled: isAdmin || isManager }
  );

  const isCreationDenied = Boolean(
    isCreationApprovalsError &&
      ((creationApprovalsError as { status?: number })?.status === 401 ||
        (creationApprovalsError as { status?: number })?.status === 403 ||
        (creationApprovalsError as { status?: number })?.status === 404)
  );

  const creationApprovals = useMemo((): WorkRequest[] => {
    if (isCreationDenied) return [];
    if (Array.isArray(rawCreationApprovals)) return rawCreationApprovals;
    return (rawCreationApprovals as unknown as { data?: WorkRequest[] })?.data ?? [];
  }, [rawCreationApprovals, isCreationDenied]);

  const pendingWrCreationCount = usePendingWorkRequestCreationCount();

  const filteredCreationApprovals = useMemo(() => {
    return creationApprovals.filter((wr) => {
      const q = wrSearch.toLowerCase();
      const title = wr.title || '';
      const client = wr.clientName || wr.client?.name || '';
      const creator = wr.assignedToName || resolveName(wr.assignedTo);
      const wrNum = wr.workRequestNumber || wr.work_request_number || '';
      const clientNum = wr.clientNumber || wr.client_number || '';
      return (
        title.toLowerCase().includes(q) ||
        client.toLowerCase().includes(q) ||
        creator.toLowerCase().includes(q) ||
        wrNum.toLowerCase().includes(q) ||
        clientNum.toLowerCase().includes(q)
      );
    });
  }, [creationApprovals, wrSearch, resolveName]);

  const selectedWr = useMemo(() => {
    if (!selectedWrId && filteredCreationApprovals.length > 0) {
      return filteredCreationApprovals[0] || null;
    }
    return (
      filteredCreationApprovals.find((w) => w.id === selectedWrId) ||
      null
    );
  }, [filteredCreationApprovals, selectedWrId]);

  // Clear dialogs and selections on account, entity, or category change to prevent stale retargeting
  useEffect(() => {
    setIsRejectModalOpen(false);
    setRejectingWrIntent(null);
    setResubmitWr(null);
    setSelectedWrId(null);
    setSelectedRequestId(null);
  }, [activeEntity, currentUserId, category, activeSubTab, wrCreationTab]);

  const handleApproveWrCreation = async (wr: WorkRequest) => {
    await runBlockingAction({
      title: 'Approving Work Request',
      message: `Approving "${wr.title}" and activating it on the active board...`,
      apiCall: async () => {
        return await approveOrRejectCreation({
          id: wr.id,
          decision: 'approve',
          expectedVersion: wr.version,
        });
      },
      successTitle: 'Work Request Approved',
      successMessage: 'The work request has been approved and is now active.',
      invalidateQueries: [
        operationsKeys.workRequests(),
        operationsKeys.workRequestCounts(activeEntity),
        operationsKeys.workRequestCreationApprovals(),
      ],
      onSuccess: () => {
        void refetchCreationApprovals();
      },
    });
  };

  const handleRejectWrCreation = async (wrId: string, reason: string) => {
    // Exact match verification against captured review intent
    if (!rejectingWrIntent || rejectingWrIntent.id !== wrId) {
      setRejectingWrIntent(null);
      return;
    }
    const wr = creationApprovals.find((w) => w.id === wrId);
    if (!wr) {
      // Intended WR removed or changed; abort without retargeting any other WR
      setRejectingWrIntent(null);
      return;
    }
    await approveOrRejectCreation({
      id: wr.id,
      decision: 'reject',
      reason,
      expectedVersion: rejectingWrIntent.expectedVersion,
    });
    setRejectingWrIntent(null);
    void refetchCreationApprovals();
  };

  // Filter requests
  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      const title = r.work_requests?.title || (r as unknown as { workRequestTitle?: string }).workRequestTitle || '';
      const requester = r.requester?.name || r.requestedByName || '';
      const notes = r.notes || '';
      const q = search.toLowerCase();
      return (
        title.toLowerCase().includes(q) ||
        requester.toLowerCase().includes(q) ||
        notes.toLowerCase().includes(q)
      );
    });
  }, [requests, search]);

  // Selected request
  const selectedRequest = useMemo(() => {
    if (!selectedRequestId && filteredRequests.length > 0) {
      return filteredRequests[0] || null;
    }
    return filteredRequests.find((r) => r.id === selectedRequestId) || filteredRequests[0] || null;
  }, [filteredRequests, selectedRequestId]);

  const wrId = selectedRequest?.work_request_id || (selectedRequest as unknown as { workRequestId?: string })?.workRequestId;
  const { data: wrDetail } = useWorkRequestDetail(wrId || '', { enabled: Boolean(wrId) });

  // Gate Prerequisite Evaluation
  const gateEvaluation = useMemo(() => {
    if (!wrDetail || !selectedRequest) return null;

    const fromPhase = selectedRequest.from_phase || (selectedRequest as unknown as { fromPhase?: Phase })?.fromPhase;
    const tasks = wrDetail.tasks || [];
    const activeTasks = tasks.filter(
      (t) =>
        t.status !== 'Cancelled' &&
        !(t as unknown as { deletedAt?: string | null; deleted_at?: string | null }).deletedAt &&
        !(t as unknown as { deletedAt?: string | null; deleted_at?: string | null }).deleted_at
    );

    if (fromPhase === 'pre_processing') {
      const preTasks = activeTasks.filter((t) => t.phase === 'pre_processing');
      const incomplete = preTasks.filter((t) => t.status !== 'Completed');
      return {
        passed: incomplete.length === 0,
        total: preTasks.length,
        completedCount: preTasks.length - incomplete.length,
        incompleteTasks: incomplete,
        gateName: 'Pre-processing Gate',
      };
    } else if (fromPhase === 'processing') {
      const procTasks = activeTasks.filter((t) => t.phase === 'processing');
      const incomplete = procTasks.filter((t) => t.status !== 'Completed');
      return {
        passed: incomplete.length === 0,
        total: procTasks.length,
        completedCount: procTasks.length - incomplete.length,
        incompleteTasks: incomplete,
        gateName: 'Processing Gate',
      };
    } else if (fromPhase === 'quality_assurance') {
      const incomplete = activeTasks.filter((t) => t.status !== 'Completed');
      const unpassed = activeTasks.filter(
        (t) =>
          t.qaStatus !== 'passed' &&
          (t as unknown as { qa_status?: string }).qa_status !== 'passed'
      );
      const blockers = [...new Set([...incomplete, ...unpassed])];
      return {
        passed: blockers.length === 0,
        total: activeTasks.length,
        completedCount: activeTasks.length - blockers.length,
        incompleteTasks: blockers,
        gateName: 'QA & Compliance Gate',
      };
    }

    return null;
  }, [wrDetail, selectedRequest]);

  // Handle Approve & Advance / Fulfill
  const handleApprove = async () => {
    if (!selectedRequest) return;
    const reqId = selectedRequest.id;
    const isTransition = selectedRequest.type === 'wr_phase_transition' || !selectedRequest.type;

    await runBlockingAction({
      title: isTransition ? 'Approving Phase Transition' : 'Approving Request',
      message: isTransition
        ? 'Fulfilling request and advancing work request phase...'
        : 'Fulfilling request and notifying requester...',
      apiCall: async () => {
        return await fulfillRequest(reqId);
      },
      successTitle: isAdmin ? 'Approved by Admin' : (isTransition ? 'Phase Transition Approved' : 'Request Approved'),
      successMessage: isAdmin
        ? 'Request has been approved and fulfilled directly by Admin.'
        : (isTransition ? 'Work request phase has been advanced successfully.' : 'Request has been approved and fulfilled successfully.'),
      invalidateQueries: [
        operationsKeys.requests(),
        operationsKeys.requestCounts(activeEntity),
        operationsKeys.workRequests(),
        ...(wrId ? [operationsKeys.workRequestDetail(wrId), operationsKeys.tasks(wrId)] : []),
      ],
    });
  };

  // Handle Withdraw
  const handleWithdraw = async () => {
    if (!selectedRequest) return;
    const reqId = selectedRequest.id;

    await runBlockingAction({
      title: 'Withdrawing Request',
      message: 'Cancelling transition request...',
      apiCall: async () => {
        return await cancelRequest(reqId);
      },
      successTitle: 'Request Withdrawn',
      successMessage: 'Transition request has been withdrawn.',
      invalidateQueries: [
        operationsKeys.requests(),
        operationsKeys.requestCounts(activeEntity),
      ],
    });
  };

  // Handle Resubmit
  const handleResubmit = async () => {
    if (!selectedRequest || !wrId) return;

    const fromPhase = selectedRequest.from_phase || (selectedRequest as unknown as { fromPhase?: Phase })?.fromPhase || 'pre_processing';
    const toPhase = selectedRequest.to_phase || (selectedRequest as unknown as { toPhase?: Phase })?.toPhase || 'processing';

    await runBlockingAction({
      title: 'Resubmitting Transition Request',
      message: 'Submitting updated phase transition request...',
      apiCall: async () => {
        return await requestTransition({
          workRequestId: wrId,
          from_phase: fromPhase,
          to_phase: toPhase,
          notes: resubmitNotes.trim() || undefined,
        });
      },
      successTitle: 'Transition Resubmitted',
      successMessage: 'New phase transition request has been queued for review.',
      invalidateQueries: [
        operationsKeys.requests(),
        operationsKeys.requestCounts(activeEntity),
      ],
      onSuccess: () => {
        setIsResubmitting(false);
        setResubmitNotes('');
        setActiveSubTab('pending');
      },
    });
  };

  return (
    <div className="flex flex-col h-[700px] border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] overflow-hidden" data-testid="pending-approvals-inbox">
      {/* Category Navigation Bar (Phase Transitions vs WR Creation Approvals / Submissions) */}
      {(isAdmin || isManager) && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-[#E2E8F0] bg-[#FFFFFF]" data-testid="inbox-category-toggle">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCategory('transitions')}
              className={`px-3 py-1 rounded-[6px] text-xs font-semibold cursor-pointer transition-colors ${
                category === 'transitions'
                  ? 'bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs'
                  : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#F1F5F9]'
              }`}
              data-testid="inbox-category-transitions"
            >
              Phase Transitions
            </button>
            <button
              type="button"
              onClick={() => setCategory('wr-creations')}
              className={`px-3 py-1 rounded-[6px] text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5 ${
                category === 'wr-creations'
                  ? 'bg-[#1D4ED8] text-[#FFFFFF] shadow-2xs'
                  : 'text-[#475569] hover:text-[#1E293B] hover:bg-[#F1F5F9]'
              }`}
              data-testid="inbox-category-wr-creation"
            >
              <span>{isAdmin ? 'WR Creation Approvals' : 'My WR Submissions'}</span>
              {pendingWrCreationCount > 0 && (
                <Badge
                  variant="warning"
                  size="compact"
                  className="px-1.5 py-0 text-xs font-bold rounded-[4px] bg-[#FEFCE8] text-[#854D0E] border-[#FDE047]"
                  data-testid="wr-creation-pending-badge"
                >
                  {pendingWrCreationCount}
                </Badge>
              )}
            </button>
          </div>
        </div>
      )}

      {category === 'transitions' ? (
        <>
          {/* Top Bar with Sub-Tabs */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
        <div className="flex items-center gap-1.5" data-testid="inbox-subtabs">
          <Button
            type="button"
            variant={activeSubTab === 'pending' ? 'default' : 'outline'}
            size="xs"
            onClick={() => setActiveSubTab('pending')}
            className={`text-xs  tracking-normal rounded-[6px] gap-1.5 ${
              activeSubTab === 'pending'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#E2E8F0]'
            }`}
            data-testid="tab-pending"
          >
            <span>Pending</span>
            {pendingCount > 0 && (
              <Badge variant="secondary" size="compact" className="bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] font-bold px-1.5 rounded-[6px] tabular-nums text-xs" data-testid="pending-badge-count">
                {pendingCount}
              </Badge>
            )}
          </Button>
          <Button
            type="button"
            variant={activeSubTab === 'rejected' ? 'default' : 'outline'}
            size="xs"
            onClick={() => setActiveSubTab('rejected')}
            className={`text-xs  tracking-normal rounded-[6px] gap-1.5 ${
              activeSubTab === 'rejected'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#E2E8F0]'
            }`}
            data-testid="tab-rejected"
          >
            <span>Rejected</span>
            {(counts?.rejected ?? 0) > 0 && (
              <Badge variant="secondary" size="compact" className="bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] font-bold px-1.5 rounded-[6px] tabular-nums text-xs" data-testid="rejected-badge-count">
                {counts?.rejected}
              </Badge>
            )}
          </Button>
          <Button
            type="button"
            variant={activeSubTab === 'fulfilled' ? 'default' : 'outline'}
            size="xs"
            onClick={() => setActiveSubTab('fulfilled')}
            className={`text-xs  tracking-normal rounded-[6px] gap-1.5 ${
              activeSubTab === 'fulfilled'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#E2E8F0]'
            }`}
            data-testid="tab-fulfilled"
          >
            <span>Fulfilled</span>
            {(counts?.fulfilled ?? 0) > 0 && (
              <Badge variant="secondary" size="compact" className="bg-[#FFFFFF] text-[#1E293B] border-[#E2E8F0] font-bold px-1.5 rounded-[6px] tabular-nums text-xs" data-testid="fulfilled-badge-count">
                {counts?.fulfilled}
              </Badge>
            )}
          </Button>
          <Button
            type="button"
            variant={activeSubTab === 'all' ? 'default' : 'outline'}
            size="xs"
            onClick={() => setActiveSubTab('all')}
            className={`text-xs  tracking-normal rounded-[6px] ${
              activeSubTab === 'all'
                ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#E2E8F0]'
            }`}
            data-testid="tab-all"
          >
            All History
          </Button>
        </div>

        <div className="w-56 relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-[#475569]" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search queue..."
            className="h-8 pl-8 text-xs bg-[#FFFFFF] border-[#E2E8F0] rounded-[6px] text-[#1E293B] placeholder:text-[#475569]"
          />
        </div>
      </div>

      {/* Main 2-Column Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column: Queue Cards (40% width) */}
        <div className="w-[380px] border-r border-[#E2E8F0] overflow-y-auto divide-y divide-[#CBD5E1] bg-[#F8FAFC]/30">
          {isLoading ? (
            <div className="p-8 text-center text-xs text-[#475569]">Loading transition queue...</div>
          ) : isError ? (
            <div className="p-8 text-center text-xs text-[#DC2626] space-y-2">
              <p>Failed to load transition requests.</p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => refetch()}
                className="text-xs rounded-[8px] border-[#E2E8F0]"
              >
                Retry
              </Button>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#475569] italic">
              No {activeSubTab} transition requests found.
            </div>
          ) : (
            filteredRequests.map((req) => {
              const isSelected = selectedRequest?.id === req.id;
              const reqTitle =
                req.work_requests?.title ||
                (req as unknown as { workRequestTitle?: string }).workRequestTitle ||
                'Work Request';
              const submitter = req.requester?.name || req.requestedByName || 'Staff';
              const fromP = req.from_phase || (req as unknown as { fromPhase?: Phase }).fromPhase || 'pre_processing';
              const toP = req.to_phase || (req as unknown as { toPhase?: Phase }).toPhase || 'processing';

              return (
                <div
                  key={req.id}
                  onClick={() => setSelectedRequestId(req.id)}
                  className={`p-3 cursor-pointer transition-colors space-y-1.5 ${
                    isSelected
                      ? 'bg-[#FFFFFF] border-l-4 border-l-[#1D4ED8]'
                      : 'hover:bg-[#F8FAFC]/60 border-l-4 border-l-transparent'
                  }`}
                  data-testid={`approval-item-${req.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-[#1E293B] truncate max-w-[240px]">
                      {reqTitle}
                    </span>
                    <Badge
                      variant={
                        req.status === 'pending'
                          ? 'warning'
                          : req.status === 'fulfilled'
                            ? 'success'
                            : req.status === 'rejected'
                              ? 'destructive'
                              : 'secondary'
                      }
                      size="compact"
                      className="text-xs uppercase tracking-wide rounded-[6px]"
                    >
                      {req.status}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-[#475569]">
                    <Badge variant={(req.entity || req.entity_id) === 'LTA' ? 'lta' : 'ata'} size="compact" className="text-xs rounded-[6px]">
                      {req.entity || (req.entity_id === 'LTA' || req.entity_id === 'ATA' ? req.entity_id : 'ATA')}
                    </Badge>
                    <span className="truncate max-w-[200px]" data-testid={`approval-client-${req.id}`}>
                      {req.clients?.name || (req as unknown as { clientName?: string }).clientName || '—'}
                    </span>
                  </div>

                  {/* Route Badge or Request Type Badge */}
                  {req.type === 'billing' ? (
                    <div className="flex items-center gap-1.5 text-xs text-[#1E293B] font-medium">
                      <Receipt className="h-3.5 w-3.5 shrink-0" />
                      <span>Invoice Request</span>
                    </div>
                  ) : req.type === 'transmittal' ? (
                    <div className="flex items-center gap-1.5 text-xs text-[#1E293B] font-medium">
                      <Send className="h-3.5 w-3.5 shrink-0" />
                      <span>Transmittal Request</span>
                    </div>
                  ) : req.type === 'disbursement' ? (
                    <div className="flex items-center gap-1.5 text-xs text-[#1E293B] font-medium">
                      <CreditCard className="h-3.5 w-3.5 shrink-0" />
                      <span>Disbursement Request</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-[#475569]">
                      <span className="font-medium capitalize text-[#1E293B]">{fromP.replace('_', ' ')}</span>
                      <ArrowRight className="h-3 w-3 text-[#475569]" />
                      <span className="font-medium capitalize text-[#1E293B]">{toP.replace('_', ' ')}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-[#475569] pt-0.5">
                    <span>By {submitter}</span>
                    <span>{req.createdAt ? new Date(req.createdAt).toLocaleDateString() : ''}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Column: Diff & Validation Inspector (60% width) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 bg-[#FFFFFF] tabular-nums">
          {selectedRequest ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between border-b border-[#E2E8F0] pb-4">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={(wrDetail?.entity || selectedRequest.entity || selectedRequest.entity_id) === 'LTA' ? 'lta' : 'ata'}
                      size="compact"
                      className="rounded-[6px] text-xs"
                      data-testid="request-detail-entity"
                    >
                      {wrDetail?.entity || selectedRequest.entity || (selectedRequest.entity_id === 'LTA' || selectedRequest.entity_id === 'ATA' ? selectedRequest.entity_id : 'ATA')}
                    </Badge>
                    <h3 className="font-bold text-base text-[#1E293B]" data-testid="request-detail-title">
                      {selectedRequest.work_requests?.title ||
                        wrDetail?.title ||
                        (selectedRequest as unknown as { workRequestTitle?: string }).workRequestTitle ||
                        'Work Request'}
                    </h3>
                    {wrId && onNavigateToWr && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => onNavigateToWr(wrId)}
                        className="text-xs text-[#1E293B] hover:text-[#1D4ED8] hover:bg-[#F8FAFC] rounded-[6px] h-6 px-1.5 underline"
                      >
                        Open Details
                      </Button>
                    )}
                  </div>
                  <div className="text-xs text-[#475569]">
                    Requested by{' '}
                    <span className="font-semibold text-[#1E293B]">
                      {selectedRequest.requester?.name || selectedRequest.requestedByName || 'Staff'}
                    </span>{' '}
                    on {selectedRequest.createdAt ? new Date(selectedRequest.createdAt).toLocaleString() : ''}
                  </div>
                </div>

                <Badge
                  variant={
                    selectedRequest.status === 'pending'
                      ? 'warning'
                      : selectedRequest.status === 'fulfilled'
                        ? 'success'
                        : selectedRequest.status === 'rejected'
                          ? 'destructive'
                          : 'secondary'
                  }
                  size="default"
                  className="capitalize rounded-[6px] text-xs"
                  data-testid="request-detail-status"
                >
                  {selectedRequest.status}
                </Badge>
              </div>

              {/* Full WR Detail Card (UAT2-4) */}
              <div className="grid grid-cols-2 gap-3 p-3.5 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px] text-xs" data-testid="request-wr-detail-card">
                <div>
                  <span className="text-xs uppercase font-bold text-[#475569] block mb-0.5">
                    Client
                  </span>
                  <div className="flex items-center gap-1.5 font-semibold text-[#1E293B] truncate" data-testid="request-client-name">
                    <Building className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                    <span className="truncate">
                      {wrDetail?.clientName || wrDetail?.client?.name || selectedRequest.clients?.name || (selectedRequest as unknown as { clientName?: string }).clientName || '—'}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-xs uppercase font-bold text-[#475569] block mb-0.5">
                    Assigned Lead
                  </span>
                  <div className="flex items-center gap-1.5 font-semibold text-[#1E293B] truncate" data-testid="request-assigned-lead">
                    <User className="h-3.5 w-3.5 text-[#475569] shrink-0" />
                    <span className="truncate">
                      {wrDetail?.assignedToName || resolveName(wrDetail?.assignedTo) || 'Unassigned'}
                    </span>
                  </div>
                </div>

                {wrDetail?.coAssignees && wrDetail.coAssignees.length > 0 && (
                  <div className="col-span-2 pt-1 border-t border-[#E2E8F0]">
                    <span className="text-xs uppercase font-bold text-[#475569] block mb-1">
                      Co-Assignees / Team
                    </span>
                    <div className="flex flex-wrap gap-1.5" data-testid="request-co-assignees">
                      {wrDetail.coAssignees.map((val, idx) => (
                        <Badge key={`${val}-${idx}`} variant="secondary" size="compact" className="text-xs rounded-[6px] bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B]">
                          <Users className="h-2.5 w-2.5 mr-1" />
                          {resolveName(val)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Side-by-side Flow or Non-Transition Request Card */}
              {selectedRequest.type === 'billing' || selectedRequest.type === 'transmittal' || selectedRequest.type === 'disbursement' ? (
                <div className="p-4 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0]">
                      {selectedRequest.type === 'billing' && <Receipt className="h-5 w-5 text-[#1E293B]" />}
                      {selectedRequest.type === 'transmittal' && <Send className="h-5 w-5 text-[#1E293B]" />}
                      {selectedRequest.type === 'disbursement' && <CreditCard className="h-5 w-5 text-[#1E293B]" />}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold tracking-normal text-[#1E293B]">
                        {selectedRequest.type === 'billing'
                          ? 'Invoice Generation Request'
                          : selectedRequest.type === 'transmittal'
                          ? 'Transmittal Documentation Request'
                          : 'Disbursement Voucher Request'}
                      </h4>
                      <p className="text-xs text-[#475569]">
                        {selectedRequest.type === 'billing'
                          ? 'Request submitted to Accounting to issue and link an invoice.'
                          : selectedRequest.type === 'transmittal'
                          ? 'Request submitted to Documentation to generate and link a transmittal.'
                          : 'Request submitted for financial disbursement approval.'}
                      </p>
                    </div>
                  </div>

                  {selectedRequest.linked_task_id && (
                    <div className="text-xs text-[#1E293B] bg-[#FFFFFF] p-2.5 rounded-[8px] border-[#E2E8F0] flex items-center justify-between">
                      <span className="text-[#475569] font-medium">Linked Task:</span>
                      <span className="font-semibold text-[#1E293B]">
                        {wrDetail?.tasks?.find((t) => t.id === selectedRequest.linked_task_id)?.title || selectedRequest.linked_task_id}
                      </span>
                    </div>
                  )}

                  {selectedRequest.notes && (
                    <div className="text-xs text-[#1E293B] bg-[#FFFFFF] p-2.5 rounded-[8px] border-[#E2E8F0]">
                      <span className="font-semibold text-[#1E293B]">Submitter Notes: </span>
                      {(() => {
                        const raw = selectedRequest.notes;
                        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
                          try {
                            const parsed = JSON.parse(raw);
                            return parsed.user_notes || parsed.notes || raw;
                          } catch { return raw; }
                        }
                        return raw;
                      })()}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0] space-y-2">
                  <h4 className="text-xs font-semibold text-[#1E293B] tracking-normal">
                    Phase Transition Flow
                  </h4>
                  <div className="flex items-center justify-center gap-4 py-3">
                    <div className="px-4 py-2 bg-[#FFFFFF] rounded-[8px] border-[#E2E8F0] text-xs font-semibold text-[#1E293B] capitalize">
                      {(selectedRequest.from_phase || (selectedRequest as unknown as { fromPhase?: Phase }).fromPhase || 'pre_processing').replace('_', ' ')}
                    </div>
                    <ArrowRight className="h-5 w-5 text-[#1E293B]" />
                    <div className="px-4 py-2 bg-[#FFFFFF] border-[#E2E8F0] text-xs font-semibold text-[#1E293B] capitalize">
                      {(selectedRequest.to_phase || (selectedRequest as unknown as { toPhase?: Phase }).toPhase || 'processing').replace('_', ' ')}
                    </div>
                  </div>
                  {selectedRequest.notes && (
                    <div className="text-xs text-[#1E293B] bg-[#FFFFFF] p-2.5 rounded-[8px] border-[#E2E8F0]">
                      <span className="font-semibold text-[#1E293B]">Submitter Notes: </span>
                      {(() => {
                        const raw = selectedRequest.notes;
                        if (typeof raw === 'string' && raw.trim().startsWith('{')) {
                          try {
                            const parsed = JSON.parse(raw);
                            return parsed.user_notes || parsed.notes || raw;
                          } catch { return raw; }
                        }
                        return raw;
                      })()}
                    </div>
                  )}
                </div>
              )}

              {/* Gate Prerequisite Inspector (Only for phase transitions) */}
              {(selectedRequest.type === 'wr_phase_transition' || !selectedRequest.type) && (
                <div className="space-y-3" data-testid="gate-inspector">
                  <h4 className="text-xs font-semibold text-[#1E293B] tracking-normal">
                    Phase Gate Checklist Inspector
                  </h4>

                {gateEvaluation ? (
                  <div className="space-y-3">
                    <div
                      className={`p-3 rounded-[8px] border-2 flex items-center justify-between text-xs  ${
                        gateEvaluation.passed
                          ? 'bg-[#FFFFFF] border-[#E2E8F0] text-[#1E293B]'
                          : 'bg-[#FFFFFF] border-[#FCA5A5] text-[#DC2626]'
                      }`}
                      data-testid="gate-status-banner"
                    >
                      <div className="flex items-center gap-2">
                        {gateEvaluation.passed ? (
                          <CheckCircle2 className="h-4 w-4 text-[#1E293B] shrink-0" />
                        ) : (
                          <Clock className="h-4 w-4 text-[#475569] shrink-0" />
                        )}
                        <span className="font-medium">
                          {gateEvaluation.passed
                            ? `All ${gateEvaluation.total} prerequisite gate tasks are Completed.`
                            : `Prerequisite gate incomplete: ${gateEvaluation.incompleteTasks.length} blocker task(s) remaining.`}
                        </span>
                      </div>
                      <Badge
                        variant={gateEvaluation.passed ? 'success' : 'warning'}
                        size="compact"
                        className="rounded-[6px] tabular-nums text-xs"
                      >
                        {gateEvaluation.completedCount} / {gateEvaluation.total} Done
                      </Badge>
                    </div>

                    {/* Blocker Tasks List */}
                    {gateEvaluation.incompleteTasks.length > 0 && (
                      <div className="space-y-1.5 bg-[#F8FAFC] p-3 rounded-[8px] border-[#E2E8F0] text-xs">
                        <span className="font-semibold text-[#1E293B] block">
                          Incomplete Gate Tasks (Blockers):
                        </span>
                        <ul className="space-y-1 pl-4 list-disc text-[#475569]">
                          {gateEvaluation.incompleteTasks.map((t) => (
                            <li key={t.id} className="text-xs">
                              <span className="font-medium text-[#1E293B]">{t.title}</span> —{' '}
                              <Badge variant="outline" size="compact" className="text-xs rounded-[8px] border-[#E2E8F0]">
                                {t.status}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-[#475569] italic">
                    Loading work request tasks for gate inspection...
                  </div>
                )}
              </div>
            )}

              {/* Full Work Request Tasks Breakdown (UAT2-4) */}
              {wrDetail && wrDetail.tasks && wrDetail.tasks.length > 0 && (
                <div className="space-y-2" data-testid="request-tasks-breakdown">
                  <h4 className="text-xs font-semibold text-[#1E293B] tracking-normal flex items-center gap-1.5">
                    <CheckSquare className="h-3.5 w-3.5" />
                    Work Request Tasks ({wrDetail.tasks.filter((t) => t.status === 'Completed').length}/{wrDetail.tasks.length} Completed)
                  </h4>
                  <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden divide-y divide-[#CBD5E1] bg-[#FFFFFF]">
                    {wrDetail.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="p-2.5 flex items-center justify-between gap-2 text-xs hover:bg-[#F8FAFC]/60 transition-colors"
                        data-testid={`request-task-row-${task.id}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <TaskTypeBadge
                              value={
                                task.requiredLinkType ??
                                (task as unknown as { required_link_type?: string | null }).required_link_type
                              }
                              data-testid={`request-task-type-${task.id}`}
                            />
                            <span className={`font-medium block truncate ${task.status === 'Completed' ? 'line-through text-[#475569]' : 'text-[#1E293B]'}`}>
                              {task.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-[#475569] pt-0.5">
                            <span className="capitalize">{task.phase.replace('_', ' ')}</span>
                            <span>•</span>
                            <span data-testid={`request-task-assignee-${task.id}`}>
                              {task.assigneeName || resolveName(task.assigneeId)}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant={task.status === 'Completed' ? 'success' : 'secondary'}
                          size="compact"
                          className="text-xs rounded-[6px]"
                        >
                          {task.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Rejection Details (if rejected) */}
              {selectedRequest.status === 'rejected' && (
                <div
                  className="p-3.5 bg-[#FFFFFF] border-2 border-[#FCA5A5] rounded-[6px] space-y-1.5 text-xs text-[#DC2626]"
                  data-testid="rejection-history-card"
                >
                  <div className="flex items-center gap-2 font-bold text-[#DC2626]">
                    <XCircle className="h-4 w-4 text-[#DC2626]" />
                    <span>Rejection Reason:</span>
                  </div>
                  <p className="whitespace-pre-wrap pl-6">
                    {selectedRequest.rejection_reason || selectedRequest.rejectionReason || 'No reason provided.'}
                  </p>
                  {selectedRequest.fulfilledAt && (
                    <div className="text-xs text-[#DC2626]/80 pl-6">
                      Resolved on {new Date(selectedRequest.fulfilledAt).toLocaleString()}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons Footer */}
              <div className="pt-4 border-t border-[#E2E8F0] flex items-center justify-between">
                <div>
                  {selectedRequest.status === 'pending' &&
                    selectedRequest.requested_by === currentUserId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleWithdraw}
                        className="text-xs text-[#475569] hover:text-[#DC2626] rounded-[6px]"
                        data-testid="withdraw-btn"
                      >
                        Withdraw Request
                      </Button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Admin Approve / Reject actions for Pending */}
                  {selectedRequest.status === 'pending' && canApprove && (
                    <>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => setIsRejectModalOpen(true)}
                        className="text-xs tracking-normal rounded-[6px] bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] shadow-2xs gap-1"
                        data-testid="reject-btn"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleApprove}
                        className="text-xs tracking-normal rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs gap-1"
                        data-testid="approve-btn"
                      >
                        <Check className="h-3.5 w-3.5" />{' '}
                        {selectedRequest.type === 'wr_phase_transition' || !selectedRequest.type
                          ? 'Approve & Advance'
                          : 'Approve Request'}
                      </Button>
                    </>
                  )}

                  {/* Resubmit action for Rejected requests */}
                  {selectedRequest.status === 'rejected' && canRequest && (
                    <>
                      {isResubmitting ? (
                        <div className="w-full space-y-2">
                          <textarea
                            value={resubmitNotes}
                            onChange={(e) => setResubmitNotes(e.target.value)}
                            placeholder="Add explanation or audit notes for resubmission..."
                            rows={2}
                            className="w-full text-xs p-2 border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-[#1E293B] placeholder:text-[#475569] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
                            data-testid="resubmit-notes-input"
                          />
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="rounded-[8px] border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC] text-xs tracking-normal"
                              onClick={() => setIsResubmitting(false)}
                            >
                              Cancel
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              className="rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs text-xs tracking-normal"
                              onClick={handleResubmit}
                              data-testid="confirm-resubmit-btn"
                            >
                              Confirm Resubmit
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setIsResubmitting(true)}
                          className="text-xs tracking-normal rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#F8FAFC] gap-1"
                          data-testid="resubmit-btn"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Resubmit Transition
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-[#475569]">
              Select a request from the queue to inspect details and gate tasks.
            </div>
          )}
        </div>
      </div>
      </>
      ) : (
        /* WR Creation Approvals / Submissions View */
        <div className="flex flex-col flex-1 min-h-0" data-testid="wr-creation-inbox">
          {/* Sub-tabs for WR Creation */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#E2E8F0] bg-[#F8FAFC]">
            <div className="flex items-center gap-1.5" data-testid="wr-creation-subtabs">
              {(['pending', 'rejected', 'approved'] as const).map((tab) => (
                <Button
                  key={tab}
                  type="button"
                  variant={wrCreationTab === tab ? 'default' : 'outline'}
                  size="xs"
                  onClick={() => setWrCreationTab(tab)}
                  className={`text-xs tracking-normal rounded-[6px] capitalize gap-1.5 ${
                    wrCreationTab === tab
                      ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs hover:bg-[#1D4ED8]'
                      : 'border-[#E2E8F0] bg-[#FFFFFF] text-[#1E293B] hover:bg-[#E2E8F0]'
                  }`}
                  data-testid={`wr-creation-tab-${tab}`}
                >
                  <span>{tab}</span>
                </Button>
              ))}
            </div>

            <div className="w-64">
              <div className="relative">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[#475569]" />
                <Input
                  type="text"
                  placeholder="Search work requests..."
                  value={wrSearch}
                  onChange={(e) => setWrSearch(e.target.value)}
                  className="h-7 pl-8 text-xs border-[#E2E8F0] rounded-[6px] bg-[#FFFFFF] text-[#1E293B] placeholder:text-[#475569] focus-visible:ring-1 focus-visible:ring-[#1D4ED8]"
                  data-testid="wr-creation-search-input"
                />
              </div>
            </div>
          </div>

          {/* Two-Pane Body for WR Creation */}
          <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-hidden divide-y md:divide-y-0 md:divide-x divide-[#E2E8F0]">
            {/* Left Column: Work Request List */}
            <div className="md:col-span-4 h-full overflow-y-auto bg-[#FFFFFF] divide-y divide-[#E2E8F0]">
              {isLoadingCreationApprovals ? (
                <div className="p-8 text-center text-xs text-[#475569]">
                  Loading work requests...
                </div>
              ) : filteredCreationApprovals.length === 0 ? (
                <div className="p-8 text-center text-xs text-[#475569]">
                  No work requests found for this filter.
                </div>
              ) : (
                filteredCreationApprovals.map((wr) => (
                  <div
                    key={wr.id}
                    onClick={() => setSelectedWrId(wr.id)}
                    data-testid={`wr-creation-card-${wr.id}`}
                    className={`p-3 cursor-pointer transition-colors ${
                      selectedWr?.id === wr.id
                        ? 'bg-[#EFF6FF] border-l-4 border-l-[#1D4ED8]'
                        : 'hover:bg-[#F8FAFC]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5 pb-1">
                      <div className="flex items-center gap-1.5">
                        {(() => {
                          const wrCode = wr.workRequestNumber || wr.work_request_number;
                          if (!wrCode) return null;
                          return (
                            <span className="font-mono text-[11px] font-semibold text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-1.5 py-0.5 rounded-[4px] tabular-nums">
                              {wrCode}
                            </span>
                          );
                        })()}
                        <Badge
                          variant="secondary"
                          size="compact"
                          className="text-xs font-semibold px-1.5 py-0.5 rounded-[4px] border border-[#CBD5E1] bg-[#F1F5F9] text-[#1E293B]"
                        >
                          {wr.entity}
                        </Badge>
                        <Badge
                          variant={
                            wr.priority === 'Urgent' || wr.priority === 'High'
                              ? 'destructive'
                              : 'outline'
                          }
                          size="compact"
                          className="text-xs font-semibold px-1.5 py-0.5 rounded-[4px]"
                        >
                          {wr.priority}
                        </Badge>
                      </div>
                      {wr.creationApprovalStatus === 'rejected' ? (
                        <Badge
                          variant="destructive"
                          size="compact"
                          className="text-xs font-semibold px-1.5 py-0.5 rounded-[4px] bg-[#FEF2F2] text-[#DC2626] border border-[#FCA5A5]"
                          data-testid={`wr-creation-status-rejected-${wr.id}`}
                        >
                          Rejected
                        </Badge>
                      ) : wr.creationApprovalStatus === 'approved' ? (
                        <Badge
                          variant="secondary"
                          size="compact"
                          className="text-xs font-semibold px-1.5 py-0.5 rounded-[4px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]"
                          data-testid={`wr-creation-status-approved-${wr.id}`}
                        >
                          Approved
                        </Badge>
                      ) : (
                        <Badge
                          variant="warning"
                          size="compact"
                          className="text-xs font-semibold px-1.5 py-0.5 rounded-[4px] bg-[#FEFCE8] text-[#854D0E] border border-[#FDE047]"
                          data-testid={`wr-creation-status-pending-${wr.id}`}
                        >
                          Pending Review
                        </Badge>
                      )}
                    </div>

                    <h4 className="text-sm font-semibold text-[#1E293B] truncate pt-0.5">
                      {wr.title}
                    </h4>
                    <p className="text-xs text-[#475569] truncate">
                      {wr.clientName || wr.client?.name || 'Unassigned Client'}
                    </p>

                    <div className="flex items-center justify-between text-xs text-[#64748B] pt-1.5">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {wr.assignedToName || resolveName(wr.assignedTo)}
                      </span>
                      {wr.dueDate && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(wr.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Right Column: Work Request Details */}
            <div className="md:col-span-8 h-full overflow-y-auto bg-[#FFFFFF] flex flex-col">
              {selectedWr ? (
                <div className="flex flex-col h-full overflow-y-auto" data-testid="wr-creation-detail-pane">
                  {/* Detail Header */}
                  <div className="p-4 border-b border-[#E2E8F0] bg-[#F8FAFC] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const wrCode = selectedWr.workRequestNumber || selectedWr.work_request_number;
                          if (!wrCode) return null;
                          return (
                            <span className="font-mono text-xs font-semibold text-[#475569] bg-[#F8FAFC] border border-[#E2E8F0] px-2 py-0.5 rounded-[6px] tabular-nums">
                              {wrCode}
                            </span>
                          );
                        })()}
                        <Badge
                          variant="secondary"
                          size="compact"
                          className="text-xs font-bold px-2 py-0.5 rounded-[4px] border border-[#94A3B8] bg-[#F1F5F9] text-[#1E293B]"
                        >
                          {selectedWr.entity}
                        </Badge>
                        <h3 className="text-base font-bold text-[#1E293B] tracking-tight">
                          {selectedWr.title}
                        </h3>
                      </div>
                      {selectedWr.creationApprovalStatus === 'rejected' ? (
                        <Badge
                          variant="destructive"
                          size="compact"
                          className="text-xs font-semibold px-2 py-1 rounded-[6px] bg-[#FEF2F2] text-[#DC2626] border border-[#FCA5A5]"
                          data-testid="selected-wr-status-rejected"
                        >
                          Rejected
                        </Badge>
                      ) : selectedWr.creationApprovalStatus === 'approved' ? (
                        <Badge
                          variant="secondary"
                          size="compact"
                          className="text-xs font-semibold px-2 py-1 rounded-[6px] bg-[#ECFDF5] text-[#047857] border border-[#A7F3D0]"
                          data-testid="selected-wr-status-approved"
                        >
                          Approved
                        </Badge>
                      ) : (
                        <Badge
                          variant="warning"
                          size="compact"
                          className="text-xs font-semibold px-2 py-1 rounded-[6px] bg-[#FEFCE8] text-[#854D0E] border border-[#FDE047]"
                          data-testid="selected-wr-status-pending"
                        >
                          Pending Admin Review
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-[#475569]">
                      <div>
                        <span className="font-semibold text-[#1E293B]">Client: </span>
                        {selectedWr.clientName || selectedWr.client?.name || 'None'}
                      </div>
                      <div>
                        <span className="font-semibold text-[#1E293B]">Priority: </span>
                        {selectedWr.priority}
                      </div>
                      <div>
                        <span className="font-semibold text-[#1E293B]">Due Date: </span>
                        {selectedWr.dueDate ? new Date(selectedWr.dueDate).toLocaleDateString() : 'None'}
                      </div>
                      <div>
                        <span className="font-semibold text-[#1E293B]">Manager / Lead: </span>
                        {selectedWr.assignedToName || resolveName(selectedWr.assignedTo)}
                      </div>
                    </div>
                  </div>

                  {/* Rejection Alert Box */}
                  {selectedWr.creationApprovalStatus === 'rejected' && (
                    <div
                      className="m-4 p-3 rounded-[6px] border border-[#FCA5A5] bg-[#FEF2F2] text-[#991B1B] text-xs space-y-1"
                      data-testid="wr-creation-rejection-notice"
                    >
                      <div className="font-semibold flex items-center gap-1.5 text-[#DC2626]">
                        <XCircle className="h-4 w-4 shrink-0" />
                        <span>Rejection Reason:</span>
                      </div>
                      <p className="pl-5.5 text-xs text-[#991B1B]">
                        {selectedWr.rejectionReason || 'No reason specified.'}
                      </p>
                      {selectedWr.reviewedAt && (
                        <p className="pl-5.5 text-[11px] text-[#B91C1C]">
                          Reviewed at {new Date(selectedWr.reviewedAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Description & Overview */}
                  <div className="p-4 space-y-4 flex-1">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B] pb-1">
                        Description
                      </h4>
                      <p className="text-xs text-[#1E293B] bg-[#F8FAFC] p-3 rounded-[6px] border border-[#E2E8F0]">
                        {selectedWr.description || 'No description provided for this work request.'}
                      </p>
                    </div>

                    {/* Tasks breakdown preview */}
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-[#64748B] pb-2">
                        Requested Tasks ({(selectedWr.tasks || []).length})
                      </h4>
                      <div className="space-y-2">
                        {(selectedWr.tasks || []).length === 0 ? (
                          <p className="text-xs text-[#64748B] italic">No tasks specified.</p>
                        ) : (
                          (selectedWr.tasks || []).map((t, idx) => (
                            <div
                              key={t.id || `task-${idx}`}
                              className="p-2.5 rounded-[6px] border border-[#E2E8F0] bg-[#FFFFFF] flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" size="compact" className="text-[11px] uppercase">
                                  {t.phase === 'processing' ? 'Processing' : 'Pre-processing'}
                                </Badge>
                                <TaskTypeBadge
                                  value={
                                    t.requiredLinkType ??
                                    (t as unknown as { required_link_type?: string | null }).required_link_type
                                  }
                                  data-testid={`approval-task-type-${t.id || idx}`}
                                />
                                <span className="font-medium text-[#1E293B]">{t.title}</span>
                              </div>
                              <div className="flex items-center gap-3 text-[#64748B]">
                                <span>{t.assigneeName || resolveName(t.assigneeId)}</span>
                                {t.dueDate && <span>{new Date(t.dueDate).toLocaleDateString()}</span>}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Footer */}
                  <div className="p-4 border-t border-[#E2E8F0] bg-[#F8FAFC] flex items-center justify-between">
                    <div>
                      <span className="text-xs text-[#64748B]">
                        Version: {selectedWr.version}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Admin Review Actions for Pending */}
                      {selectedWr.creationApprovalStatus === 'pending' && isAdmin && (
                        <div className="flex items-center gap-2" data-testid="admin-wr-creation-actions">
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            onClick={() => {
                              setRejectingWrIntent({
                                id: selectedWr.id,
                                expectedVersion: selectedWr.version,
                                title: selectedWr.title,
                              });
                            }}
                            className="text-xs tracking-normal rounded-[6px] bg-[#DC2626] text-[#FFFFFF] hover:bg-[#B91C1C] shadow-2xs gap-1"
                            data-testid="reject-wr-creation-btn"
                          >
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleApproveWrCreation(selectedWr)}
                            className="text-xs tracking-normal rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs gap-1"
                            data-testid="approve-wr-creation-btn"
                          >
                            <Check className="h-3.5 w-3.5" /> Approve Work Request
                          </Button>
                        </div>
                      )}

                      {/* Manager Resubmit Action for Rejected */}
                      {selectedWr.creationApprovalStatus === 'rejected' && (isManager || selectedWr.canResubmit) && (
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => setResubmitWr(selectedWr)}
                          className="text-xs tracking-normal rounded-[6px] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs gap-1"
                          data-testid="resubmit-wr-creation-btn"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Edit &amp; Resubmit
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-[#64748B]">
                  Select a work request from the queue to inspect details.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reject Reason Modal for Phase Transitions */}
      {selectedRequest && (
        <RejectReasonModal
          isOpen={isRejectModalOpen}
          requestId={selectedRequest.id}
          workRequestTitle={
            selectedRequest.work_requests?.title ||
            (selectedRequest as unknown as { workRequestTitle?: string }).workRequestTitle
          }
          onClose={() => setIsRejectModalOpen(false)}
        />
      )}

      {/* Reject Reason Modal for WR Creation Approvals */}
      {rejectingWrIntent && (
        <RejectReasonModal
          isOpen={Boolean(rejectingWrIntent)}
          requestId={rejectingWrIntent.id}
          workRequestTitle={rejectingWrIntent.title}
          title="Reject Work Request Creation"
          description="Please provide an explicit rejection reason for the submitter. This will be visible to the Manager to correct and resubmit."
          submitLabel="Reject Work Request"
          successTitle="Work Request Rejected"
          successMessage="The work request creation has been rejected with feedback."
          onReject={handleRejectWrCreation}
          onClose={() => setRejectingWrIntent(null)}
          onSuccess={() => {
            setRejectingWrIntent(null);
            void refetchCreationApprovals();
          }}
          invalidateQueries={[
            operationsKeys.workRequests(),
            operationsKeys.workRequestCounts(activeEntity),
            operationsKeys.workRequestCreationApprovals(),
          ]}
        />
      )}

      {/* Work Request Resubmit Modal */}
      {resubmitWr && (
        <WorkRequestModal
          isOpen={Boolean(resubmitWr)}
          workRequest={resubmitWr}
          onClose={() => setResubmitWr(null)}
          onSuccess={() => {
            setResubmitWr(null);
            void refetchCreationApprovals();
          }}
        />
      )}
    </div>
  );
}
