import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRightCircle,
  ExternalLink,
  Wallet,
  Receipt,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useSessionStore } from '@/lib/session';
import {
  useNotifications,
  useNotificationRealtimeSync,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '../api/useNotifications';
import type { NotificationItem, NotificationType } from '../api/types';

export function NotificationBellPanel() {
  useNotificationRealtimeSync();
  const [isOpen, setIsOpen] = useState(false);
  const [filterUnreadOnly, setFilterUnreadOnly] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const unreadCount = useSessionStore((state) => state.unreadCount);

  const { data: notificationsData, isLoading } = useNotifications({ limit: 50 });
  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();

  const notifications = notificationsData?.data || [];

  // Close panel on click outside or escape key
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Sort unread first, then by createdAt desc
  const sortedNotifications = [...notifications].sort((a, b) => {
    if (!a.readAt && b.readAt) return -1;
    if (a.readAt && !b.readAt) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const displayedNotifications = filterUnreadOnly
    ? sortedNotifications.filter((n) => !n.readAt)
    : sortedNotifications;

  const handleMarkAllRead = async () => {
    try {
      await markAllReadMutation.mutateAsync();
    } catch (err) {
      console.error('[NotificationBellPanel] Mark all read failed:', err);
    }
  };

  const handleNotificationClick = async (item: NotificationItem) => {
    const originalUserId = useSessionStore.getState().user?.id;
    // 1. Mark as read if not already read
    if (!item.readAt) {
      try {
        await markReadMutation.mutateAsync(item.id);
      } catch (err) {
        console.warn('[NotificationBellPanel] Mark read failed:', err);
      }
    }

    if (useSessionStore.getState().user?.id !== originalUserId) return;

    // 2. Perform deep-link navigation based on payload ids
    setIsOpen(false);
    const p = item.payload as Record<string, unknown>;

    switch (item.type) {
      case 'wr.transition_request.received': {
        navigate('/operations?tab=pending-approvals');
        break;
      }

      case 'wr.transition_request.resolved': {
        const wrId = p.workRequestId || p.work_request_id;
        if (wrId) {
          navigate(`/operations?tab=work-requests&view=board&wrId=${String(wrId)}`);
        } else {
          navigate('/operations');
        }
        break;
      }

      case 'pending_request.resolved': {
        const resourceType = String(p.resourceType || p.resource_type || '').toLowerCase();
        if (resourceType === 'disbursement') {
          navigate('/disbursements');
        } else if (resourceType === 'billing') {
          navigate('/billing');
        } else {
          navigate('/dashboard');
        }
        break;
      }

      case 'wr.qa_reroute': {
        const wrId = p.workRequestId || p.work_request_id;
        if (wrId) {
          navigate(`/operations?tab=work-requests&view=board&wrId=${String(wrId)}`);
        } else {
          navigate('/operations');
        }
        break;
      }

      case 'disbursement.lifecycle': {
        const session = useSessionStore.getState();
        const entity = String(p.entity || '').toUpperCase();
        if (session.user?.entities?.includes(entity)) session.setActiveEntity(entity);
        const reqId = p.request_id || p.requestId;
        if (reqId) {
          navigate(`/disbursements?disbursementId=${encodeURIComponent(String(reqId))}`);
        } else {
          navigate('/disbursements');
        }
        break;
      }

      default:
        navigate('/dashboard');
        break;
    }
  };

  const renderIcon = (type: NotificationType, payload: Record<string, unknown>) => {
    switch (type) {
      case 'wr.transition_request.received':
        return (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B]">
            <ArrowRightCircle className="h-4 w-4" />
          </div>
        );
      case 'wr.transition_request.resolved': {
        const outcome = String(payload.outcome || '').toLowerCase();
        if (outcome === 'approved') {
          return (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B]">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          );
        }
        return (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] text-[#DC2626]">
            <XCircle className="h-4 w-4" />
          </div>
        );
      }
      case 'pending_request.resolved': {
        const resourceType = String(payload.resourceType || payload.resource_type || '').toLowerCase();
        return (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B]">
            {resourceType === 'disbursement' ? (
              <Wallet className="h-4 w-4" />
            ) : (
              <Receipt className="h-4 w-4" />
            )}
          </div>
        );
      }
      case 'wr.qa_reroute':
        return (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B]">
            <AlertTriangle className="h-4 w-4" />
          </div>
        );
      case 'disbursement.lifecycle': {
        const action = String(payload.action || '').toLowerCase();
        if (['approve', 'approved', 'release', 'released'].includes(action)) {
          return (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          );
        }
        if (action === 'fund' || action === 'funded') {
          return (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
              <Wallet className="h-4 w-4" />
            </div>
          );
        }
        if (['reject', 'rejected', 'resend_draft', 'returned_for_correction'].includes(action)) {
          return (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <XCircle className="h-4 w-4" />
            </div>
          );
        }
        return (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600">
            <Wallet className="h-4 w-4" />
          </div>
        );
      }
      default:
        return (
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border-[#E2E8F0] bg-[#F8FAFC] text-[#475569]">
            <Clock className="h-4 w-4" />
          </div>
        );
    }
  };

  const getTitle = (item: NotificationItem) => {
    const p = item.payload as Record<string, unknown>;
    const wrTitle = p.workRequestTitle || p.work_request_title || p.wr_title || 'Work Request';

    switch (item.type) {
      case 'wr.transition_request.received':
        return `Phase Review Requested: ${String(wrTitle)}`;
      case 'wr.transition_request.resolved': {
        const outcome = String(p.outcome || 'resolved');
        return `Transition ${outcome.toUpperCase()}: ${String(wrTitle)}`;
      }
      case 'pending_request.resolved': {
        const action = String(p.action || 'resolved');
        const res = String(p.resourceType || p.resource_type || 'Request');
        return `${res.toUpperCase()} ${action.toUpperCase()}`;
      }
      case 'wr.qa_reroute':
        return `QA Reroute Rework: ${String(wrTitle)}`;
      case 'disbursement.lifecycle': {
        const action = String(p.action || 'updated');
        const disbNum = p.disbursement_number || p.disbursementNumber || 'Voucher';
        const label: Record<string, string> = { create: 'New request', corrected: 'Corrected request', approve: 'Budget approved', fund: 'Payment prepared', release: 'Payment released', reject: 'Rejected', resend_draft: 'Returned for correction' };
        return `${String(disbNum)} — ${label[action] || action.replace(/_/g, ' ')}`;
      }
      default:
        return 'Notification';
    }
  };

  const getMessage = (item: NotificationItem) => {
    const p = item.payload as Record<string, unknown>;
    switch (item.type) {
      case 'wr.transition_request.received':
        return `Requested by ${String(p.requestedByName || p.requested_by_name || 'Manager')} (${String(p.fromPhase || p.from_phase)} → ${String(p.toPhase || p.to_phase)})`;
      case 'wr.transition_request.resolved': {
        const reason = p.rejectionReason || p.rejection_reason;
        if (reason) {
          return `Rejected: ${String(reason)}`;
        }
        return `Advanced to phase ${String(p.resolvedPhase || p.resolved_phase || p.toPhase || p.to_phase)}`;
      }
      case 'pending_request.resolved': {
        const reason = p.rejectionReason || p.rejection_reason;
        if (reason) {
          return `Reason: ${String(reason)}`;
        }
        return `Resolved by ${String(p.resolvedByName || p.resolved_by_name || 'Admin')}`;
      }
      case 'wr.qa_reroute':
        return `Reason: ${String(p.reason || 'QA failed tasks reopened')}`;
      case 'disbursement.lifecycle': {
        const reason = p.reason;
        if (reason) {
          return `Reason: ${String(reason)}`;
        }
        const action = String(p.action || 'updated').replace(/_/g, ' ');
        const entity = p.entity ? `[${String(p.entity)}] ` : '';
        const disbNum = p.disbursement_number || p.disbursementNumber || '';
        return `${entity}${disbNum ? `${disbNum}: ` : ''}${action}.`;
      }
      default:
        return '';
    }
  };

  const formatRelativeTime = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);

    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="relative" ref={panelRef} data-testid="notification-bell">
      {/* Bell Button with Badge */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative flex h-9 w-9 items-center justify-center rounded-[6px] text-[#1E293B] hover:bg-[#F8FAFC] transition-colors cursor-pointer"
        aria-label="Notifications"
        aria-expanded={isOpen}
        data-testid="notification-bell-btn"
      >
        <Bell className="h-5 w-5 text-[#1E293B]" />
        {unreadCount > 0 && (
          <span
            data-testid="unread-badge"
            className="absolute -top-1 -right-1 flex min-w-5 h-5 items-center justify-center rounded-[6px] bg-[#DC2626] px-1 text-xs tabular-nums font-bold text-[#FFFFFF] border-[#E2E8F0]"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Flyout Panel */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-96 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF] shadow-float z-50 overflow-hidden flex flex-col max-h-[520px]"
          data-testid="notifications-dropdown"
        >
          {/* Header */}
          <div className="p-3.5 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
            <div className="flex items-center gap-2">
              <h3 className="text-xs tabular-nums font-bold tracking-normal text-[#1E293B]">Notifications</h3>
              {unreadCount > 0 && (
                <Badge variant="default" className="text-xs tabular-nums px-1.5 py-0.5 rounded-[8px] border-[#E2E8F0] bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs">
                  {unreadCount} unread
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleMarkAllRead}
                  disabled={markAllReadMutation.isPending}
                  className="text-xs rounded-[6px] text-[#475569] hover:text-[#1E293B] hover:bg-[#E2E8F0] h-7 gap-1 cursor-pointer"
                  data-testid="mark-all-read-btn"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </Button>
              )}
            </div>
          </div>

          {/* Filters Bar */}
          <div className="px-3.5 py-1.5 border-b border-[#E2E8F0] flex items-center gap-2 text-xs bg-[#F8FAFC]">
            <button
              type="button"
              onClick={() => setFilterUnreadOnly(false)}
              className={`px-2 py-0.5 rounded-[6px] text-xs  transition-colors cursor-pointer ${
                !filterUnreadOnly
                  ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs font-semibold'
                  : 'text-[#475569] hover:text-[#1E293B]'
              }`}
              data-testid="filter-all-btn"
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterUnreadOnly(true)}
              className={`px-2 py-0.5 rounded-[6px] text-xs  transition-colors cursor-pointer ${
                filterUnreadOnly
                  ? 'bg-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF] shadow-2xs font-semibold'
                  : 'text-[#475569] hover:text-[#1E293B]'
              }`}
              data-testid="filter-unread-btn"
            >
              Unread ({notifications.filter((n) => !n.readAt).length})
            </button>
          </div>

          {/* Notifications List */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#CBD5E1]" data-testid="notifications-list">
            {isLoading ? (
              <div className="p-4 space-y-3">
                <div className="h-12 bg-[#F8FAFC] animate-pulse rounded-[8px] border-[#E2E8F0]" />
                <div className="h-12 bg-[#F8FAFC] animate-pulse rounded-[8px] border-[#E2E8F0]" />
                <div className="h-12 bg-[#F8FAFC] animate-pulse rounded-[8px] border-[#E2E8F0]" />
              </div>
            ) : displayedNotifications.length === 0 ? (
              <div
                className="py-10 text-center text-xs text-[#475569]"
                data-testid="no-notifications-message"
              >
                {filterUnreadOnly
                  ? 'No unread notifications'
                  : 'No notifications yet'}
              </div>
            ) : (
              displayedNotifications.map((item) => {
                const isUnread = !item.readAt;
                const p = item.payload as Record<string, unknown>;

                return (
                  <div
                    key={item.id}
                    onClick={() => handleNotificationClick(item)}
                    className={`p-3 text-left transition-colors cursor-pointer flex items-start gap-3 hover:bg-[#F8FAFC] ${
                      isUnread ? 'bg-[#FFFFFF] border-l-2 border-l-[#1D4ED8]' : 'bg-[#FFFFFF]'
                    }`}
                    data-testid={`notification-item-${item.id}`}
                  >
                    {renderIcon(item.type, p)}

                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="flex items-start justify-between gap-1">
                        <span
                          className={`text-xs leading-snug line-clamp-1 ${
                            isUnread ? 'font-bold text-[#1E293B]' : 'font-medium text-[#475569]'
                          }`}
                        >
                          {getTitle(item)}
                        </span>
                        {isUnread && (
                          <span
                            className="h-2 w-2 rounded-[6px] bg-[#DC2626] shrink-0 mt-1"
                            data-testid="unread-dot"
                          />
                        )}
                      </div>

                      <p className="text-xs text-[#475569] line-clamp-2">
                        {getMessage(item)}
                      </p>

                      <div className="flex items-center justify-between pt-1 text-xs text-[#475569]">
                        <span>
                          {formatRelativeTime(item.createdAt)}
                        </span>
                        <span className="text-[#1E293B] font-medium flex items-center gap-0.5 hover:underline">
                          View details <ExternalLink className="h-2.5 w-2.5" />
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
