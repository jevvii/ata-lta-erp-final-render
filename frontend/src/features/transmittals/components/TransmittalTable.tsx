/**
 * Transmittal Table View
 *
 * Tabular layout with search, status filter, client filter, and actions.
 */

import { useState, useMemo } from 'react';
import {
  Eye,
  Edit2,
  Printer,
  Send,
  CheckCircle2,
  ShieldCheck,
  Trash2,
  Archive,
  ArchiveRestore,
  Search,
  FileText,
  RotateCcw,
} from 'lucide-react';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { useClients } from '@/features/operations/api/useClients';
import { useTeam } from '@/features/operations/api/useTeam';
import { matchesDueDate, DUE_DATE_FILTER_OPTIONS } from '@/lib/dateFilters';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './Tooltip';
import { TransmittalStatusBadge, TransmittalApprovalBadge } from './TransmittalStatusBadge';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import type { Transmittal } from '../api/types';

export interface TransmittalTableProps {
  transmittals: Transmittal[];
  isLoading?: boolean;
  onView: (id: string) => void;
  onEdit: (transmittal: Transmittal) => void;
  onPrint: (transmittal: Transmittal) => void;
  onApprove: (id: string) => void;
  onSend: (transmittal: Transmittal) => void;
  onAcknowledge: (transmittal: Transmittal) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
}

export function TransmittalTable({
  transmittals,
  isLoading = false,
  onView,
  onEdit,
  onPrint,
  onApprove,
  onSend,
  onAcknowledge,
  onArchive,
  onUnarchive,
  onDelete,
}: TransmittalTableProps) {
  const permissions = useSessionStore((state) => state.permissions);
  const user = useSessionStore((state) => state.user);
  const isAdmin = user?.role === 'Admin';

  const canEditPermission = hasPermission(permissions, 'transmittal:edit');
  const canApprovePermission = hasPermission(permissions, 'transmittal:approve');
  const canMarkPermission = hasPermission(permissions, 'transmittal:mark');
  const canDeletePermission = hasPermission(permissions, 'transmittal:delete');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [workRequestFilter, setWorkRequestFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [dueDateFilter, setDueDateFilter] = useState<string>('all');

  const { data: rawWrs } = useWorkRequests({ archived: false });
  const workRequests = useMemo(() => (Array.isArray(rawWrs) ? rawWrs : rawWrs?.data ?? []), [rawWrs]);
  const { data: clientsData = [] } = useClients();
  const { data: teamData = [] } = useTeam();

  const handleResetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setWorkRequestFilter('all');
    setClientFilter('all');
    setEmployeeFilter('all');
    setDueDateFilter('all');
  };

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    statusFilter !== 'all' ||
    workRequestFilter !== 'all' ||
    clientFilter !== 'all' ||
    employeeFilter !== 'all' ||
    dueDateFilter !== 'all';

  const filteredTransmittals = useMemo(() => {
    return transmittals.filter((t) => {
      // Status filter
      if (statusFilter !== 'all' && t.status !== statusFilter) {
        return false;
      }

      // Work Request filter
      if (workRequestFilter !== 'all') {
        const wrId = t.work_request_id || t.workRequestId;
        if (wrId !== workRequestFilter) return false;
      }

      // Client filter
      if (clientFilter !== 'all') {
        const cId = t.client_id || t.clientId;
        if (cId !== clientFilter) return false;
      }

      // Employee filter (Admin only)
      if (employeeFilter !== 'all') {
        const empId = t.created_by || t.createdBy || t.sent_by || t.sentBy;
        if (empId !== employeeFilter) return false;
      }

      // Due Date filter
      if (dueDateFilter !== 'all') {
        const targetDate = t.sent_at || t.sentAt || t.created_at || t.createdAt;
        const isFinished = t.status === 'Acknowledged' || t.status === 'Cancelled';
        if (!matchesDueDate(targetDate, dueDateFilter, isFinished)) return false;
      }

      // Search filter
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchTracking = t.tracking_number.toLowerCase().includes(query);
        const matchClient = (t.clients?.name || '').toLowerCase().includes(query);
        const matchRecipient = (t.recipient_name || '').toLowerCase().includes(query);
        const matchNotes = (t.notes || '').toLowerCase().includes(query);
        if (!matchTracking && !matchClient && !matchRecipient && !matchNotes) {
          return false;
        }
      }

      return true;
    });
  }, [
    transmittals,
    statusFilter,
    workRequestFilter,
    clientFilter,
    employeeFilter,
    dueDateFilter,
    searchTerm,
  ]);

  return (
    <div className="space-y-4" data-testid="transmittal-table-container">
      {/* Search and Filters Bar */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2.5 bg-white p-3 rounded-[8px] border-[#E2E8F0]">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <div className="relative min-w-[180px] flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#475569]" />
            <Input
              placeholder="Search tracking, client, recipient..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
              data-testid="transmittal-search-input"
            />
          </div>

          {/* Status Filter */}
          <div className="w-[125px] sm:w-[135px]">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 text-xs" data-testid="transmittal-status-filter">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="Draft">Draft</SelectItem>
                <SelectItem value="Sent">Sent</SelectItem>
                <SelectItem value="Acknowledged">Acknowledged</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Work Request Filter */}
          <div className="w-[135px] sm:w-[150px]">
            <Select value={workRequestFilter} onValueChange={setWorkRequestFilter}>
              <SelectTrigger className="h-9 text-xs" data-testid="transmittal-work-request-filter">
                <SelectValue placeholder="All Work Requests" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Work Requests</SelectItem>
                {workRequests.map((wr) => (
                  <SelectItem key={wr.id} value={wr.id}>
                    {wr.title || wr.work_order_number || wr.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Client Filter */}
          <div className="w-[130px] sm:w-[145px]">
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="h-9 text-xs" data-testid="transmittal-client-filter">
                <SelectValue placeholder="All Clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Clients</SelectItem>
                {clientsData.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Employee Filter (Admin only) */}
          {isAdmin && (
            <div className="w-[130px] sm:w-[145px]">
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger className="h-9 text-xs" data-testid="transmittal-employee-filter">
                  <SelectValue placeholder="All Employees" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Employees</SelectItem>
                  {teamData.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Due Date Filter */}
          <div className="w-[125px] sm:w-[135px]">
            <Select value={dueDateFilter} onValueChange={setDueDateFilter}>
              <SelectTrigger className="h-9 text-xs" data-testid="transmittal-due-date-filter">
                <SelectValue placeholder="All Due Dates" />
              </SelectTrigger>
              <SelectContent>
                {DUE_DATE_FILTER_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetFilters}
              className="h-9 text-xs text-[#475569] hover:text-[#1E293B] px-2 cursor-pointer shrink-0"
              data-testid="transmittal-reset-filters-btn"
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Table Container */}
      <div className="border-[#E2E8F0] rounded-[6px] overflow-hidden bg-white shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-[#475569]" data-testid="transmittal-table">
            <thead className="bg-[#F8FAFC] text-[#1E293B] font-semibold border-b border-[#E2E8F0] tracking-normal text-xs">
              <tr>
                <th className="py-3 px-4">Tracking #</th>
                <th className="py-3 px-4">Entity</th>
                <th className="py-3 px-4">Client</th>
                <th className="py-3 px-4">Status & Approval</th>
                <th className="py-3 px-4">Items</th>
                <th className="py-3 px-4">Recipient</th>
                <th className="py-3 px-4">Created Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && filteredTransmittals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#475569]">
                    Loading transmittals...
                  </td>
                </tr>
              ) : filteredTransmittals.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-[#475569]">
                    No transmittals found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredTransmittals.map((t) => {
                  const itemsCount = t.items?.length ?? 0;
                  const canEdit = canEditPermission && (isAdmin || t.status === 'Draft');
                  const canApprove = canApprovePermission && t.status === 'Draft';
                  const isSendDisabled = !isAdmin && !t.approved;

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-[#F8FAFC]/75 transition-colors"
                      data-testid={`transmittal-row-${t.id}`}
                    >
                      {/* Tracking Number */}
                      <td className="py-3 px-4 font-mono font-bold text-[#1E293B]">
                        {t.tracking_number}
                      </td>

                      {/* Entity */}
                      <td className="py-3 px-4">
                        {t.entity_code ? (
                          <Badge variant="secondary" className="text-xs font-semibold py-0 px-1.5">
                            {t.entity_code}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Client */}
                      <td className="py-3 px-4 font-medium text-[#1E293B] max-w-[180px] truncate" title={t.clients?.name}>
                        {t.clients?.name || '—'}
                      </td>

                      {/* Status & Approval */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          <TransmittalStatusBadge status={t.status} />
                          {t.status === 'Draft' && (
                            <TransmittalApprovalBadge approved={t.approved} status={t.status} />
                          )}
                        </div>
                      </td>

                      {/* Document Items */}
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-[#475569]">
                          <FileText className="h-3 w-3 text-[#475569]" />
                          {itemsCount} {itemsCount === 1 ? 'doc' : 'docs'}
                        </span>
                      </td>

                      {/* Recipient */}
                      <td className="py-3 px-4 max-w-[140px] truncate" title={t.recipient_name || ''}>
                        {t.recipient_name || '—'}
                      </td>

                      {/* Created Date */}
                      <td className="py-3 px-4 text-[#475569] whitespace-nowrap">
                        {new Date(t.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
                            title="View Details"
                            onClick={() => onView(t.id)}
                            data-testid={`view-transmittal-btn-${t.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>

                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
                              title="Edit"
                              onClick={() => onEdit(t)}
                              data-testid={`edit-transmittal-btn-${t.id}`}
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
                            title="Print Transmittal Letter"
                            onClick={() => onPrint(t)}
                            data-testid={`print-transmittal-btn-${t.id}`}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>

                          {/* Admin Approve */}
                          {t.status === 'Draft' && canApprove && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              title="Approve (Admin)"
                              onClick={() => onApprove(t.id)}
                              data-testid={`approve-transmittal-btn-${t.id}`}
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {/* Mark Sent */}
                          {t.status === 'Draft' && canMarkPermission && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 p-0 text-[#1E293B] hover:text-[#1E293B] hover:bg-[#F8FAFC] disabled:opacity-40"
                                      disabled={isSendDisabled}
                                      title={isSendDisabled ? 'Requires Admin approval before sending' : 'Mark Sent'}
                                      onClick={() => onSend(t)}
                                      data-testid={`send-transmittal-btn-${t.id}`}
                                    >
                                      <Send className="h-3.5 w-3.5" />
                                    </Button>
                                  </span>
                                </TooltipTrigger>
                                {isSendDisabled && (
                                  <TooltipContent side="top" className="text-xs">
                                    Requires Admin approval before sending
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </TooltipProvider>
                          )}

                          {/* Acknowledge */}
                          {t.status === 'Sent' && canMarkPermission && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              title="Acknowledge Receipt"
                              onClick={() => onAcknowledge(t)}
                              data-testid={`acknowledge-transmittal-btn-${t.id}`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {/* Archive / Unarchive */}
                          {canMarkPermission && (
                            t.archived ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
                                title="Restore from Archive"
                                onClick={() => onUnarchive(t.id)}
                                data-testid={`unarchive-transmittal-btn-${t.id}`}
                              >
                                <ArchiveRestore className="h-3.5 w-3.5" />
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-[#475569] hover:text-[#1E293B]"
                                title="Archive"
                                onClick={() => onArchive(t.id)}
                                data-testid={`archive-transmittal-btn-${t.id}`}
                              >
                                <Archive className="h-3.5 w-3.5" />
                              </Button>
                            )
                          )}

                          {/* Delete */}
                          {canDeletePermission && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-rose-500 hover:text-rose-700 hover:bg-rose-50"
                              title="Delete"
                              onClick={() => onDelete(t.id)}
                              data-testid={`delete-transmittal-btn-${t.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
