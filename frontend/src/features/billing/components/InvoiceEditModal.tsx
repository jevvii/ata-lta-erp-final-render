import { useSessionStore } from '@/lib/session';
import { getInvoicePrintDetails, type InvoicePrintDetails } from '@/lib/printDocuments';
import { InvoicePrintDetailsFields } from './InvoicePrintDetailsFields';
import { DateInput } from '@/components/ui/date-input';
import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Pencil, AlertCircle, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClients, type ClientSummary } from '@/features/operations/api/useClients';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { useWorkRequestTasks } from '@/features/operations/api/useTasks';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import {
  isTaskAssignee,
  isRoleAdmin,
  isTaskOfWorkRequest,
} from '@/features/operations/lib/taskScope';
import type { Task } from '@/features/operations/api/types';
import { LINE_ITEM_TYPES } from '../api/schemas';
import { updateInvoiceAction } from '../api/useBillingMutations';
import { formatCurrency, getStatusBadgeVariant } from '../utils/formatters';
import { useQueryClient } from '@tanstack/react-query';
import {
  ConflictResolutionModal,
  isConcurrencyConflictError,
} from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import { apiRequest, type ApiError } from '@/lib/api';
import { billingKeys } from '../api/queryKeys';
import type { LineItemType, CreateLineItemInput, UpdateInvoiceInput, Invoice } from '../api/types';

export interface InvoiceEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice | null;
  onUpdated?: (updatedInvoice: Invoice) => void;
  inline?: boolean;
}

interface EditableLineItem {
  id: string;
  description: string;
  amount: string;
  type: LineItemType;
}

export function InvoiceEditModal({
  isOpen,
  onClose,
  invoice,
  onUpdated,
  inline = false,
}: InvoiceEditModalProps) {
  const queryClient = useQueryClient();
  const isAdmin = useSessionStore((s) => isRoleAdmin(s.user));
  const currentUser = useSessionStore((state) => state.user);
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const effectiveEntity = activeEntity !== 'ALL' ? activeEntity : undefined;
  const originEntity = invoice?.entity_id || effectiveEntity;

  const canEditFinancials = isAdmin || invoice?.status === 'Draft';
  const [printDetails, setPrintDetails] = useState<InvoicePrintDetails>({});
  const [address, setAddress] = useState('');

  // Form Fields
  const [clientId, setClientId] = useState('');
  const [workRequestId, setWorkRequestId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [originTaskId, setOriginTaskId] = useState('');
  const [originWrId, setOriginWrId] = useState('');
  const [storedLinkageError, setStoredLinkageError] = useState<string | null>(null);
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [currentVersion, setCurrentVersion] = useState<number>(1);
  const [formError, setFormError] = useState<string | null>(null);

  // Authoritative origin task query (independently scoped with exact entity/WR)
  const originTasksQuery = useWorkRequestTasks(originWrId || undefined, {
    enabled: isOpen && Boolean(originWrId && originTaskId),
    entity: originEntity,
  });

  const originTask = useMemo(() => {
    if (!originTaskId || !originWrId) return null;
    if (originTasksQuery.isPlaceholderData) return null;
    const list = originTasksQuery.data || [];
    return list.find((t) => t.id === originTaskId) || null;
  }, [originTaskId, originWrId, originTasksQuery.isPlaceholderData, originTasksQuery.data]);

  // Dynamic Line Items
  const [lineItems, setLineItems] = useState<EditableLineItem[]>([]);

  // Conflict Modal State
  const [conflictState, setConflictState] = useState<{
    isOpen: boolean;
    error?: unknown;
    serverVersion?: number;
  }>({ isOpen: false });

  // Initialize/reset form from invoice prop
  useEffect(() => {
    if (isOpen && invoice) {
      setPrintDetails(invoice.print_details ? { ...invoice.print_details } : {});
      setAddress(invoice.address ?? invoice.clients?.address ?? '');
      setClientId(invoice.client_id || '');
      setWorkRequestId(invoice.work_request_id || '');

      // Preserve canonical task_id precedence over linked_task_id; detect malformed or conflicting IDs
      const rawCanonical = (invoice as { task_id?: string | null }).task_id;
      const rawLegacy =
        invoice.linked_task_id ??
        (invoice as { linkedTaskId?: string | null }).linkedTaskId ??
        null;

      const hasCanonical = rawCanonical !== undefined && rawCanonical !== null;
      const hasLegacy = rawLegacy !== undefined && rawLegacy !== null;

      let initialTaskId = '';
      let initialLinkageError: string | null = null;

      if (hasCanonical && hasLegacy) {
        const c = String(rawCanonical).trim();
        const l = String(rawLegacy).trim();
        if (c && l && c !== l) {
          initialLinkageError =
            'Stored task linkage is corrupt: canonical task_id conflicts with legacy linked_task_id.';
          initialTaskId = c;
        } else if (c === '') {
          initialLinkageError = 'Stored canonical task_id is malformed.';
          initialTaskId = l;
        } else {
          initialTaskId = c;
        }
      } else if (hasCanonical) {
        const c = String(rawCanonical).trim();
        if (c === '') {
          initialLinkageError = 'Stored canonical task_id is malformed.';
        } else {
          initialTaskId = c;
        }
      } else if (hasLegacy) {
        const l = String(rawLegacy).trim();
        if (l === '') {
          initialLinkageError = 'Stored legacy linked_task_id is malformed.';
        } else {
          initialTaskId = l;
        }
      }

      setSelectedTaskId(initialTaskId);
      setOriginTaskId(initialTaskId);
      const initialWrId =
        invoice.work_request_id || (invoice as { workRequestId?: string }).workRequestId || '';
      setOriginWrId(initialWrId);
      setStoredLinkageError(initialLinkageError);

      setInvoiceNumber(invoice.invoice_number || '');
      setIssueDate(invoice.issue_date ? invoice.issue_date.slice(0, 10) : '');
      setDueDate(invoice.due_date ? invoice.due_date.slice(0, 10) : '');
      setNotes(invoice.notes || '');
      setTerms(invoice.terms || '');
      setCurrentVersion(
        typeof invoice.version === 'number' && invoice.version > 0 ? invoice.version : 1
      );
      setFormError(null);
      setConflictState({ isOpen: false });

      if (invoice.line_items && invoice.line_items.length > 0) {
        setLineItems(
          invoice.line_items.map((li, idx) => ({
            id: li.id || `item-${idx}-${Date.now()}`,
            description: li.description || '',
            amount: li.amount !== undefined ? String(li.amount) : '0',
            type: li.type || 'Professional Fee',
          }))
        );
      } else {
        setLineItems([
          {
            id: `item-1-${Date.now()}`,
            description: '',
            amount: '0',
            type: 'Professional Fee',
          },
        ]);
      }
    } else if (!isOpen) {
      setSelectedTaskId('');
      setOriginTaskId('');
      setOriginWrId('');
      setStoredLinkageError(null);
      setFormError(null);
    }
  }, [isOpen, invoice]);

  // Clients & Work Requests queries
  const { data: clientsData } = useClients(undefined, { enabled: isOpen });
  const clients = useMemo(() => {
    if (!clientsData) return [];
    if (Array.isArray(clientsData)) return clientsData;
    if (Array.isArray((clientsData as unknown as { data: unknown[] }).data)) {
      return (clientsData as unknown as { data: ClientSummary[] }).data;
    }
    return [];
  }, [clientsData]);

  const automaticDetails = useMemo(() => {
    if (!invoice) return {};
    const selectedClient =
      clientId === invoice.client_id
        ? invoice.clients
        : (clients.find((client) => client.id === clientId) ?? null);
    return getInvoicePrintDetails({ ...invoice, clients: selectedClient, print_details: {} });
  }, [invoice, clientId, clients]);

  const { data: workRequestsData } = useWorkRequests(
    { clientId: clientId || undefined },
    { enabled: isOpen }
  );
  const workRequests = useMemo(() => {
    if (!workRequestsData) return [];
    if (Array.isArray(workRequestsData)) return workRequestsData;
    if (Array.isArray((workRequestsData as unknown as { data: unknown[] }).data)) {
      return (
        workRequestsData as unknown as {
          data: Array<{ id: string; title: string; client_id?: string | null }>;
        }
      ).data;
    }
    return [];
  }, [workRequestsData]);

  // Work Request Tasks query (entity-scoped, excludes placeholder data)
  const tasksQuery = useWorkRequestTasks(workRequestId || undefined, {
    enabled: isOpen && Boolean(workRequestId),
    entity: effectiveEntity,
  });
  const tasks = useMemo(() => {
    if (tasksQuery.isPlaceholderData) return [];
    const list = tasksQuery.data || [];
    if (!workRequestId) return [];
    return list.filter((t) => isTaskOfWorkRequest(t, workRequestId));
  }, [tasksQuery.isPlaceholderData, tasksQuery.data, workRequestId]);

  const availableTasks = useMemo(() => {
    if (!workRequestId) return [];
    if (isAdmin) return tasks;
    return tasks.filter((t) => isTaskAssignee(currentUser, t));
  }, [tasks, workRequestId, isAdmin, currentUser]);

  const handleClientChange = (newClientId: string) => {
    if (!newClientId) return;
    if (isAdmin && newClientId !== clientId) {
      setAddress('');
    }
    setClientId(newClientId);
    setWorkRequestId('');
    setSelectedTaskId('');
  };

  const handleWorkRequestChange = (newWrId: string) => {
    setWorkRequestId(newWrId);
    setSelectedTaskId('');
    const matchedWr = workRequests.find((w) => w.id === newWrId);
    if (matchedWr?.client_id) {
      setClientId(matchedWr.client_id);
    }
  };

  // Live calculations (total = subtotal per backend contract)
  const totals = useMemo(() => {
    const subtotal = lineItems.reduce((sum, item) => {
      const val = parseFloat(item.amount);
      return sum + (isNaN(val) || val < 0 ? 0 : Math.round(val * 100));
    }, 0);
    const amountPaid = Number(invoice?.amount_paid || 0);
    return {
      subtotal: subtotal / 100,
      total: subtotal / 100,
      amountPaid,
      balance: Math.max(0, subtotal / 100 - amountPaid),
    };
  }, [lineItems, invoice?.amount_paid]);

  const handleAddLineItem = () => {
    if (!canEditFinancials) return;
    setLineItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: '',
        amount: '0',
        type: 'Professional Fee',
      },
    ]);
  };

  const handleRemoveLineItem = (index: number) => {
    if (!canEditFinancials || lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleMoveLineItem = (index: number, direction: 'up' | 'down') => {
    if (!canEditFinancials) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= lineItems.length) return;

    setLineItems((prev) => {
      const copy = [...prev];
      const temp = copy[index]!;
      copy[index] = copy[targetIndex]!;
      copy[targetIndex] = temp;
      return copy;
    });
  };

  const handleUpdateLineItem = (index: number, field: keyof EditableLineItem, value: string) => {
    if (!canEditFinancials) return;
    setLineItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index]!, [field]: value };
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoice?.id) return;
    setFormError(null);

    // Administrators may correct released invoices; other editors require a draft.
    if (!canEditFinancials) {
      setFormError(
        'Financial fields and line items can only be modified while invoice is in Draft status.'
      );
      return;
    }

    if (!currentVersion || currentVersion < 1) {
      setFormError('Invoice version must be a valid positive integer.');
      return;
    }

    if (!invoiceNumber.trim()) {
      setFormError('Invoice number is required.');
      return;
    }

    if (!clientId) {
      setFormError('Please select a valid client.');
      return;
    }

    if (!issueDate) {
      setFormError('Issue date is required.');
      return;
    }

    if (!dueDate) {
      setFormError('Due date is required.');
      return;
    }

    if (lineItems.some((item) => !item.amount.trim())) {
      setFormError('Each line item requires an amount.');
      return;
    }

    const parsedLineItems: CreateLineItemInput[] = lineItems.map((item, idx) => ({
      description: item.description.trim(),
      amount: Math.round(Number(item.amount) * 100) / 100,
      type: item.type,
      sortOrder: idx + 1,
    }));

    if (parsedLineItems.length === 0) {
      setFormError('At least one line item is required.');
      return;
    }

    for (let i = 0; i < parsedLineItems.length; i++) {
      const item = parsedLineItems[i]!;
      if (!item.description) {
        setFormError(`Line item #${i + 1} requires a description.`);
        return;
      }
      if (!Number.isFinite(item.amount) || item.amount < 0) {
        setFormError(`Line item #${i + 1} amount cannot be negative.`);
        return;
      }
    }

    if (totals.total < Number(invoice.amount_paid || 0)) {
      setFormError('Total amount cannot be less than payments already recorded.');
      return;
    }

    // Relink/unlink checks
    const effectiveSelectedTask = selectedTaskId ? selectedTaskId.trim() : '';
    const effectiveOriginTask = originTaskId ? originTaskId.trim() : '';
    const effectiveWr = (workRequestId || '').trim();
    const effectiveOriginWr = (originWrId || '').trim();

    const isLinkageChanged =
      effectiveSelectedTask !== effectiveOriginTask || effectiveWr !== effectiveOriginWr;

    if (isLinkageChanged) {
      if (storedLinkageError) {
        setFormError(storedLinkageError);
        return;
      }

      // 1. Authorize origin task detachment if an origin task was linked
      if (effectiveOriginTask) {
        if (!effectiveOriginWr) {
          setFormError('Original work request is missing for the linked task.');
          return;
        }
        const originKey = operationsKeys.tasks(effectiveOriginWr, originEntity);
        const originState = queryClient.getQueryState<Task[]>(originKey);
        if (
          originTasksQuery.isLoading ||
          originTasksQuery.isError ||
          originTasksQuery.isPlaceholderData ||
          !originState ||
          originState.status !== 'success' ||
          originState.isInvalidated ||
          !Array.isArray(originState.data)
        ) {
          setFormError(
            'Original linked task data is currently loading or unavailable. Please try again.'
          );
          return;
        }
        const liveOriginTask = originState.data.find((t) => t.id === effectiveOriginTask);
        if (!liveOriginTask || !isTaskOfWorkRequest(liveOriginTask, effectiveOriginWr)) {
          setFormError(
            'Original linked task could not be verified or does not belong to the original work request.'
          );
          return;
        }
        if (!isAdmin && !isTaskAssignee(currentUser, liveOriginTask)) {
          setFormError('You are not authorized to unlink or relink the existing task.');
          return;
        }
      }

      // 2. Authorize destination task attachment if a destination task is selected
      if (effectiveSelectedTask) {
        if (!effectiveWr) {
          setFormError('Please select a work request for the destination task.');
          return;
        }
        const destKey = operationsKeys.tasks(effectiveWr, effectiveEntity);
        const destState = queryClient.getQueryState<Task[]>(destKey);
        if (
          tasksQuery.isLoading ||
          tasksQuery.isError ||
          tasksQuery.isPlaceholderData ||
          !destState ||
          destState.status !== 'success' ||
          destState.isInvalidated ||
          !Array.isArray(destState.data)
        ) {
          setFormError(
            'Destination task data is currently loading or unavailable. Please try again.'
          );
          return;
        }
        const liveDestTask = destState.data.find((t) => t.id === effectiveSelectedTask);
        if (!liveDestTask || !isTaskOfWorkRequest(liveDestTask, effectiveWr)) {
          setFormError('Destination task does not belong to the selected work request.');
          return;
        }
        if (!isAdmin && !isTaskAssignee(currentUser, liveDestTask)) {
          setFormError('You are not assigned to the destination task.');
          return;
        }
      }
    }

    const payload: UpdateInvoiceInput = {
      ...(isAdmin ? { printDetails, address } : {}),
      clientId,
      workRequestId: workRequestId || null,
      linkedTaskId: selectedTaskId || null,
      invoiceNumber: invoiceNumber.trim(),
      issueDate,
      dueDate,
      lineItems: parsedLineItems,
      notes: notes.trim() || null,
      terms: terms.trim() || null,
      expectedVersion: currentVersion,
    };

    try {
      const updated = await updateInvoiceAction(
        invoice.id,
        payload,
        currentVersion,
        invoice.entity_id
      );
      if (onUpdated) {
        onUpdated(updated);
      }
      onClose();
    } catch (err: unknown) {
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        // Preserve user form state and show conflict resolution
        setConflictState({
          isOpen: true,
          error: err,
        });
        setFormError(
          'A concurrency conflict occurred (Version mismatch). The invoice was updated elsewhere. Your modifications have been preserved below.'
        );
        return;
      }
      setFormError((err as Error)?.message || 'Failed to update invoice');
    }
  };

  if (!invoice) return null;

  const EditorTitle = inline ? 'h3' : DialogTitle;
  const editorContent = (
    <>
      <DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <EditorTitle className="text-base font-bold text-[#1E293B] flex items-center gap-2">
            <Pencil className="w-5 h-5 text-[#1E293B]" />
            <span>Edit Invoice {invoice.invoice_number}</span>
          </EditorTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#475569]">v{currentVersion}</span>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-[6px] text-xs font-semibold border ${getStatusBadgeVariant(
                invoice.status
              )}`}
              data-testid="edit-status-badge"
            >
              {invoice.status}
            </span>
          </div>
        </div>
        <p className="text-xs text-[#475569]">
          Edit invoice fields and statement details. Changes are checked against the latest saved
          version.
        </p>
      </DialogHeader>

      {/* Non-Draft Guard Warning Banner */}
      {!canEditFinancials && (
        <div
          className="p-3 bg-amber-50 border-amber-200 rounded-[6px] text-xs text-amber-800 flex items-start gap-2"
          data-testid="non-draft-warning"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <span>
            <strong>Draft Editing Guard</strong>: Financial fields and line items can only be
            modified while invoice is in <strong>Draft</strong> status. Current status is{' '}
            <strong>{invoice.status}</strong>.
          </span>
        </div>
      )}

      {/* 409 Conflict Alert Banner */}
      {Boolean(conflictState.error) && (
        <div
          className="p-3 bg-rose-50 border-rose-200 rounded-[6px] text-xs text-rose-800 flex items-center justify-between gap-2"
          data-testid="edit-conflict-alert"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>
              Concurrency conflict (version mismatch). Your modifications are preserved below.
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs bg-white text-rose-700 border-rose-300 hover:bg-rose-100 cursor-pointer"
            data-testid="btn-resolve-conflict"
            onClick={() => setConflictState({ ...conflictState, isOpen: true })}
          >
            Resolve Conflict
          </Button>
        </div>
      )}

      {formError && (
        <div
          className="p-3 bg-rose-50 border-rose-200 rounded-[6px] text-xs text-rose-700 flex items-start gap-2"
          data-testid="invoice-edit-error"
        >
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* 1. Header Information Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="edit-invoice-client"
              className="text-xs font-semibold text-[#1E293B] block mb-1"
            >
              Client*
            </label>
            <Select
              value={clientId}
              onValueChange={handleClientChange}
              disabled={!canEditFinancials}
            >
              <SelectTrigger
                id="edit-invoice-client"
                className="h-9 text-xs"
                data-testid="select-edit-client"
              >
                <SelectValue placeholder="Select a client..." />
              </SelectTrigger>
              <SelectContent>
                {clientId && !clients.some((c) => c.id === clientId) && (
                  <SelectItem value={clientId}>{invoice.clients?.name || clientId}</SelectItem>
                )}
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="edit-invoice-wr"
              className="text-xs font-semibold text-[#1E293B] block mb-1"
            >
              Associated Work Request
            </label>
            <Select
              value={workRequestId || '__none__'}
              onValueChange={(val) => handleWorkRequestChange(val === '__none__' ? '' : val)}
              disabled={!canEditFinancials}
            >
              <SelectTrigger
                id="edit-invoice-wr"
                className="h-9 text-xs"
                data-testid="select-edit-work-request"
              >
                <SelectValue placeholder="Select work request..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (Direct Client Invoice)</SelectItem>
                {workRequestId && !workRequests.some((wr) => wr.id === workRequestId) && (
                  <SelectItem value={workRequestId}>{workRequestId}</SelectItem>
                )}
                {workRequests.map((wr) => (
                  <SelectItem key={wr.id} value={wr.id}>
                    {wr.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="edit-invoice-task"
              className="text-xs font-semibold text-[#1E293B] block mb-1"
            >
              Linked Task (Optional)
            </label>
            <Select
              value={selectedTaskId || '__none__'}
              onValueChange={(val) => setSelectedTaskId(val === '__none__' ? '' : val)}
              disabled={!canEditFinancials || !workRequestId}
            >
              <SelectTrigger
                id="edit-invoice-task"
                className="h-9 text-xs"
                data-testid="select-edit-task"
              >
                <SelectValue
                  placeholder={
                    !workRequestId ? 'Select work request first...' : 'Select task (optional)...'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None (No linked task)</SelectItem>
                {selectedTaskId && !availableTasks.some((task) => task.id === selectedTaskId) && (
                  <SelectItem value={selectedTaskId}>
                    {originTask?.title ? `${originTask.title} (Current)` : selectedTaskId}
                  </SelectItem>
                )}
                {availableTasks.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    {task.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label
              htmlFor="edit-invoice-number"
              className="text-xs font-semibold text-[#1E293B] block mb-1"
            >
              Invoice Number*
            </label>
            <Input
              id="edit-invoice-number"
              type="text"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="e.g. ATA-SI-2026-0042"
              className="h-9 text-xs font-mono"
              disabled={!canEditFinancials}
              required
              data-testid="input-edit-invoice-number"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:col-span-2">
            <div>
              <label
                htmlFor="edit-invoice-issue-date"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Issue Date*
              </label>
              <DateInput
                id="edit-invoice-issue-date"
                aria-label="Invoice issue date"
                type="date"
                value={issueDate}
                onValueChange={(value) => setIssueDate(value)}
                className="h-9 text-xs"
                disabled={!canEditFinancials}
                required
                data-testid="input-edit-issue-date"
              />
            </div>
            <div>
              <label
                htmlFor="edit-invoice-due-date"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Due Date*
              </label>
              <DateInput
                id="edit-invoice-due-date"
                aria-label="Invoice due date"
                type="date"
                value={dueDate}
                onValueChange={(value) => setDueDate(value)}
                className="h-9 text-xs"
                disabled={!canEditFinancials}
                required
                data-testid="input-edit-due-date"
              />
            </div>
          </div>
        </div>

        {/* 2. Dynamic Line Items Section */}
        <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-[#1E293B] uppercase tracking-wide">
                Line Items
              </h4>
              <p className="text-xs text-[#475569]">At least 1 item required. Total = Subtotal.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddLineItem}
              disabled={!canEditFinancials}
              className="h-7 text-xs gap-1 cursor-pointer"
              data-testid="btn-add-line-item"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Item</span>
            </Button>
          </div>

          <div className="space-y-2" data-testid="line-items-edit-list">
            {lineItems.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-2 p-2.5 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px]"
                data-testid={`line-item-row-${index}`}
              >
                <span className="text-xs text-[#475569] w-4 text-center">{index + 1}</span>

                {/* Description */}
                <div className="flex-1">
                  <Input
                    type="text"
                    value={item.description}
                    onChange={(e) => handleUpdateLineItem(index, 'description', e.target.value)}
                    placeholder="Item description..."
                    className="h-8 text-xs bg-white"
                    disabled={!canEditFinancials}
                    required
                    data-testid={`line-item-desc-${index}`}
                  />
                </div>

                {/* Category Type */}
                <div className="w-36">
                  <Select
                    value={item.type}
                    onValueChange={(val) =>
                      handleUpdateLineItem(index, 'type', val as LineItemType)
                    }
                    disabled={!canEditFinancials}
                  >
                    <SelectTrigger
                      className="h-8 text-xs bg-white"
                      data-testid={`line-item-type-${index}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LINE_ITEM_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Amount */}
                <div className="w-28">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.amount}
                    onChange={(e) => handleUpdateLineItem(index, 'amount', e.target.value)}
                    placeholder="0.00"
                    className="h-8 text-xs bg-white text-right tabular-nums"
                    disabled={!canEditFinancials}
                    required
                    data-testid={`line-item-amount-${index}`}
                  />
                </div>

                {/* Controls: Reorder & Remove */}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    disabled={!canEditFinancials || index === 0}
                    onClick={() => handleMoveLineItem(index, 'up')}
                    className="p-1 text-[#475569] hover:text-[#1E293B] disabled:opacity-30 cursor-pointer"
                    title="Move up"
                    data-testid={`btn-move-up-${index}`}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!canEditFinancials || index === lineItems.length - 1}
                    onClick={() => handleMoveLineItem(index, 'down')}
                    className="p-1 text-[#475569] hover:text-[#1E293B] disabled:opacity-30 cursor-pointer"
                    title="Move down"
                    data-testid={`btn-move-down-${index}`}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={!canEditFinancials || lineItems.length <= 1}
                    onClick={() => handleRemoveLineItem(index)}
                    className="p-1 text-[#475569] hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                    title="Delete item"
                    data-testid={`btn-remove-item-${index}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Subtotal & Total display */}
          <div className="flex justify-end pt-2">
            <div className="w-64 bg-[#F8FAFC] p-2.5 rounded-[8px] border-[#E2E8F0] text-xs space-y-1">
              <div className="flex justify-between text-[#475569]">
                <span>Subtotal:</span>
                <span className="tabular-nums" data-testid="edit-calc-subtotal">
                  {formatCurrency(totals.subtotal)}
                </span>
              </div>
              <div className="flex justify-between font-bold text-[#1E293B] border-t border-[#E2E8F0] pt-1">
                <span>Total Amount:</span>
                <span className="tabular-nums text-sm" data-testid="edit-calc-total">
                  {formatCurrency(totals.total)}
                </span>
              </div>
              {totals.amountPaid > 0 && (
                <div className="flex justify-between text-[#475569]">
                  <span>Amount Paid:</span>
                  <span className="tabular-nums">{formatCurrency(totals.amountPaid)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold text-[#1E293B] border-t border-[#E2E8F0] pt-1">
                <span>Balance:</span>
                <span className="tabular-nums" data-testid="edit-calc-balance">
                  {formatCurrency(totals.balance)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {isAdmin && (
          <>
            <label className="block text-xs font-medium space-y-1">
              Invoice snapshot address
              <Input
                aria-label="Invoice snapshot address"
                value={address}
                maxLength={500}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <InvoicePrintDetailsFields
              value={printDetails}
              automaticValues={automaticDetails}
              onChange={setPrintDetails}
            />
          </>
        )}
        {/* 3. Notes & Terms */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
          <div>
            <label
              htmlFor="edit-invoice-notes"
              className="text-xs font-semibold text-[#1E293B] block mb-1"
            >
              Notes
            </label>
            <textarea
              id="edit-invoice-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes to client..."
              rows={2}
              className="w-full text-xs rounded-[8px] border-[#E2E8F0] p-2 text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              data-testid="textarea-edit-notes"
            />
          </div>
          <div>
            <label
              htmlFor="edit-invoice-terms"
              className="text-xs font-semibold text-[#1E293B] block mb-1"
            >
              Payment Terms
            </label>
            <textarea
              id="edit-invoice-terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="e.g. Net 30"
              rows={2}
              disabled={!canEditFinancials}
              className="w-full text-xs rounded-[8px] border-[#E2E8F0] p-2 text-[#1E293B] focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none disabled:bg-[#F8FAFC] disabled:cursor-not-allowed"
              data-testid="input-edit-terms"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={!canEditFinancials}
            className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs text-xs cursor-pointer disabled:opacity-50"
            data-testid="btn-save-invoice-edit"
          >
            Save Changes
          </Button>
        </div>
      </form>
    </>
  );
  return (
    <>
      {inline ? (
        <section
          className="p-4 bg-white border-[#E2E8F0] rounded-[6px]"
          data-testid="invoice-inline-editor"
        >
          {editorContent}
        </section>
      ) : (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
          <DialogContent
            className="max-w-3xl max-h-[92vh] overflow-y-auto p-6 rounded-[12px] bg-white"
            data-testid="invoice-edit-modal"
          >
            {editorContent}
          </DialogContent>
        </Dialog>
      )}
      {/* Optimistic Concurrency Conflict Modal */}
      <ConflictResolutionModal
        isOpen={conflictState.isOpen}
        onClose={() => setConflictState({ isOpen: false })}
        error={conflictState.error as ApiError | Error | null}
        entityTitle={invoice.invoice_number}
        entityType="Invoice"
        expectedVersion={currentVersion}
        currentStatus={invoice.status}
        onRefreshAndKeepLatest={async () => {
          if (invoice.id) {
            await queryClient.invalidateQueries({
              queryKey: billingKeys.invoiceDetail(invoice.id),
            });
            try {
              const latest = await apiRequest<{ data: Invoice }>(`/invoices/${invoice.id}`);
              if (latest?.data?.version) {
                setCurrentVersion(latest.data.version);
              }
            } catch {
              setCurrentVersion((v) => v + 1);
            }
          }
          setConflictState({ isOpen: false });
          setFormError(null);
        }}
        onCancel={() => setConflictState({ isOpen: false })}
      />
    </>
  );
}
