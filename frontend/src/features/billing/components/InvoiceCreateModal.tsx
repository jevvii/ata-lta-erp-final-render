import { DateInput } from '@/components/ui/date-input';
import { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, FileText, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useClients } from '@/features/operations/api/useClients';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { useSelectableTasks } from '@/features/operations/hooks/useSelectableTasks';
import { TaskBlockingAlert } from '@/features/operations/components/TaskBlockingAlert';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import {
  isTaskAssignee,
  isRoleAdmin,
  isTaskOfWorkRequest,
} from '@/features/operations/lib/taskScope';
import { useInvoices } from '../api/useInvoices';
import { createInvoiceSchema, LINE_ITEM_TYPES } from '../api/schemas';
import { createInvoiceAction } from '../api/useBillingMutations';
import { useSessionStore } from '@/lib/session';
import { formatCurrency, getNextInvoiceNumber } from '../utils/formatters';
import type { LineItemType, CreateLineItemInput } from '../api/types';
import type { Task } from '@/features/operations/api/types';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Frozen Financial Prefill Contract (UAT2-7-contract-side)
 * Integration surface for W2-OPS TaskDetailModal and cross-module deep links.
 * Prefilled fields must be locked where linkage defines them (client from WR).
 */
export interface FinancialPrefill {
  workRequestId?: string;
  taskId?: string;
  clientId?: string;
}

export interface InvoiceCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
  prefill?: FinancialPrefill;
}

// GAP NOTE (UAT2-6): Backend currently accepts `linkedTaskId` (mapping to invoices.linked_task_id).
// When W2-BE lands task_id acceptance on staging, toggle SUPPORT_TASK_ID_PAYLOAD to emit task_id.
export const SUPPORT_TASK_ID_PAYLOAD = false;

interface EditableLineItem {
  id: string;
  description: string;
  amount: string;
  type: LineItemType;
}

export function InvoiceCreateModal({
  isOpen,
  onClose,
  onCreated,
  prefill,
}: InvoiceCreateModalProps) {
  const activeEntity = useSessionStore((state) => state.activeEntity);

  // Form Fields
  const [clientId, setClientId] = useState('');
  const [workRequestId, setWorkRequestId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment due within 30 days of invoice date.');
  const [formError, setFormError] = useState<string | null>(null);

  // Dynamic Line Items
  const [lineItems, setLineItems] = useState<EditableLineItem[]>([
    {
      id: 'item-1',
      description: 'Professional Services Fee',
      amount: '15000',
      type: 'Professional Fee',
    },
  ]);

  // Clients & Work Requests queries
  const { data: clientsData } = useClients();
  const clients = clientsData || [];

  const { data: workRequestsData } = useWorkRequests(
    { clientId: clientId || undefined },
    { enabled: isOpen }
  );
  const workRequests = useMemo(() => workRequestsData?.data || [], [workRequestsData]);

  const queryClient = useQueryClient();
  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = isRoleAdmin(currentUser);
  const effectiveEntity = activeEntity !== 'ALL' ? activeEntity : undefined;

  // Prefill contract synchronization (UAT2-7-contract-side)
  useEffect(() => {
    if (isOpen) {
      setWorkRequestId(prefill?.workRequestId || '');
      setClientId(prefill?.clientId || '');
      setSelectedTaskId(prefill?.taskId || '');
      setFormError(null);
    } else {
      setWorkRequestId('');
      setClientId('');
      setSelectedTaskId('');
      setInvoiceNumber('');
      setNotes('');
      setFormError(null);
    }
  }, [isOpen, prefill]);

  // Auto-detect and populate associated client when work request is selected
  useEffect(() => {
    if (isOpen && workRequestId && workRequests.length > 0 && !prefill?.clientId) {
      const matchedWr = workRequests.find((w) => w.id === workRequestId);
      if (matchedWr?.client_id && matchedWr.client_id !== clientId) {
        setClientId(matchedWr.client_id);
      }
    }
  }, [isOpen, workRequestId, workRequests, prefill?.clientId, clientId]);

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    setWorkRequestId('');
    setSelectedTaskId('');
    setFormError(null);
  };

  const handleWorkRequestChange = (newWrId: string) => {
    setWorkRequestId(newWrId);
    setSelectedTaskId('');
    setFormError(null);
    if (!prefill?.clientId) {
      const matchedWr = workRequests.find((w) => w.id === newWrId);
      if (matchedWr?.client_id) {
        setClientId(matchedWr.client_id);
      }
    }
  };

  const isClientLocked = Boolean(prefill?.clientId || prefill?.workRequestId);
  const isWrLocked = Boolean(prefill?.workRequestId);
  const isTaskLocked = Boolean(prefill?.taskId);

  const selectedWorkRequest = useMemo(
    () => workRequests.find((w) => w.id === workRequestId),
    [workRequests, workRequestId]
  );

  // Work Request Tasks query & selectability hook
  const {
    tasksQuery,
    allWrTasks: tasks,
    options: taskOptions,
    blockingReason,
    blockingMessage,
    isBlocked: isTaskBlocked,
    isNoTasksBlocked,
    isNotAssignedBlocked,
    isPhaseOrPrereqBlocked,
  } = useSelectableTasks({
    workRequestId: workRequestId || undefined,
    workRequestPhase: selectedWorkRequest?.phase,
    recordType: 'invoice',
    isOpen,
    entity: effectiveEntity,
    currentTaskId: prefill?.taskId || null,
    selectedTaskId,
    onSelectTask: (taskId) => setSelectedTaskId(taskId),
    isTaskLocked,
  });

  // Existing Invoices for sequential number calculation
  const { data: existingInvoicesData } = useInvoices({ limit: 100 }, { enabled: isOpen });

  // Auto-generate sequential invoice number matching prototype
  useEffect(() => {
    if (isOpen) {
      const invoices = existingInvoicesData?.data || [];
      const nextNumber = getNextInvoiceNumber(activeEntity, invoices);
      setInvoiceNumber(nextNumber);
    }
  }, [isOpen, activeEntity, existingInvoicesData]);

  // Live calculations (total = subtotal per backend logic)
  const totals = useMemo(() => {
    const subtotal = lineItems.reduce((sum, item) => {
      const val = parseFloat(item.amount);
      return sum + (isNaN(val) || val < 0 ? 0 : val);
    }, 0);
    return {
      subtotal,
      total: subtotal, // Tax removed per prototype v3 / billing@2.0.0
    };
  }, [lineItems]);

  const handleAddLineItem = () => {
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
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleMoveLineItem = (index: number, direction: 'up' | 'down') => {
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
    setLineItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index]!, [field]: value };
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedTaskId = selectedTaskId ? selectedTaskId.trim() : '';

    if (!trimmedTaskId) {
      setFormError('A valid linked task is required.');
      return;
    }

    if (!isTaskLocked && (tasksQuery.isLoading || (tasksQuery.isFetching && tasks.length === 0))) {
      setFormError('Tasks are still loading. Please wait.');
      return;
    }

    if (isTaskBlocked) {
      setFormError(
        blockingMessage ||
          (isNoTasksBlocked
            ? 'This work request has no tasks — create one first.'
            : "You're not assigned to any task on this work request. Ask the task owner or an Admin to add you.")
      );
      return;
    }

    if (tasks.length > 0) {
      const foundTask = tasks.find((t) => t.id === trimmedTaskId);
      if (!foundTask || !isTaskOfWorkRequest(foundTask, workRequestId)) {
        setFormError('Selected task does not belong to the selected work request.');
        return;
      }
      if (!isAdmin && !isTaskAssignee(currentUser, foundTask)) {
        setFormError('You are not assigned to the selected task.');
        return;
      }
    }

    // Live verification of exact current scoped query
    const liveUser = useSessionStore.getState().user;
    const liveIsAdmin = isRoleAdmin(liveUser);
    if (!liveIsAdmin) {
      const exactKey = operationsKeys.tasks(workRequestId, effectiveEntity);
      const queryState = queryClient.getQueryState<Task[]>(exactKey);
      if (!queryState || queryState.status !== 'success' || queryState.isInvalidated || !Array.isArray(queryState.data)) {
        setFormError('Task assignment could not be verified. Please try again.');
        return;
      }
      const liveTask = queryState.data.find((t) => t.id === trimmedTaskId);
      if (!liveTask || !isTaskOfWorkRequest(liveTask, workRequestId)) {
        setFormError('Selected task is no longer available in this work request.');
        return;
      }
      if (!isTaskAssignee(liveUser, liveTask)) {
        setFormError('You are not assigned to the selected task.');
        return;
      }
    }

    const parsedLineItems: CreateLineItemInput[] = lineItems.map((item) => ({
      description: item.description.trim(),
      amount: parseFloat(item.amount) || 0,
      type: item.type,
    }));

    const payload = {
      clientId,
      workRequestId,
      linkedTaskId: !SUPPORT_TASK_ID_PAYLOAD ? (trimmedTaskId || null) : undefined,
      ...(SUPPORT_TASK_ID_PAYLOAD && trimmedTaskId
        ? { taskId: trimmedTaskId, task_id: trimmedTaskId }
        : {}),
      invoiceNumber: invoiceNumber.trim(),
      issueDate,
      dueDate,
      status: 'Draft' as const,
      lineItems: parsedLineItems,
      notes: notes.trim() || null,
      terms: terms.trim() || null,
    };

    const validation = createInvoiceSchema.safeParse(payload);
    if (!validation.success) {
      setFormError(validation.error.issues[0]?.message || 'Validation error');
      return;
    }

    try {
      await createInvoiceAction(payload, activeEntity);
      onClose();
      if (onCreated) {
        onCreated();
      }
    } catch (err: unknown) {
      const apiErr = err as { code?: string; message?: string };
      if (apiErr?.code === 'TASK_REQUIRED') {
        setFormError('A valid linked task is required.');
      } else if (apiErr?.code === 'TASK_WR_MISMATCH') {
        setFormError('Task does not belong to work request.');
      } else if (apiErr?.code === 'TASK_NOT_SELECTABLE') {
        setFormError('Selected task is not selectable.');
      } else if (
        apiErr?.code === 'TASK_ASSIGNMENT_REQUIRED' ||
        apiErr?.code === 'FORBIDDEN_TASK_ATTACHMENT'
      ) {
        setFormError('You must be assigned to this task.');
      } else {
        setFormError(apiErr?.message || 'Failed to create invoice.');
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="overflow-y-auto shadow-float rounded-[6px] max-h-[90vh] rounded-[12px] bg-white bg-[#FFFFFF] p-6 max-w-2xl border-[#E2E8F0] border"
        data-testid="invoice-create-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-base font-bold text-[#1E293B] flex items-center gap-2">
            <FileText className="w-5 h-5 text-[#1E293B]" />
            <span>Create New Invoice</span>
          </DialogTitle>
          <p className="text-xs text-[#475569]">
            Generate an official invoice record with dynamic line items and automated total
            computation.
          </p>
        </DialogHeader>

        {formError && (
          <div
            className="p-3 bg-rose-50 border-rose-200 rounded-[6px] text-xs text-rose-700 flex items-start gap-2"
            data-testid="invoice-create-error"
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
                htmlFor="create-invoice-client"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Client*
              </label>
              <Select value={clientId} onValueChange={handleClientChange} disabled={isClientLocked}>
                <SelectTrigger
                  id="create-invoice-client"
                  className="h-9 text-xs"
                  data-testid="select-client"
                >
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => {
                    const clientNum =
                      (c as { clientNumber?: string | null; client_number?: string | null })?.clientNumber ||
                      (c as { client_number?: string | null })?.client_number;
                    const label = clientNum ? `${clientNum} · ${c.name}` : c.name;
                    return (
                      <SelectItem key={c.id} value={c.id}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label
                htmlFor="create-invoice-wr"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Associated Work Request*
              </label>
              <Select
                value={workRequestId}
                onValueChange={handleWorkRequestChange}
                disabled={isWrLocked}
              >
                <SelectTrigger
                  id="create-invoice-wr"
                  className="h-9 text-xs"
                  data-testid="select-work-request"
                >
                  <SelectValue placeholder="Select work request..." />
                </SelectTrigger>
                <SelectContent>
                  {workRequests.map((wr) => {
                    const wrNum =
                      (wr as {
                        workRequestNumber?: string | null;
                        work_request_number?: string | null;
                        workOrderNumber?: string | null;
                        work_order_number?: string | null;
                      })?.workRequestNumber ||
                      (wr as { work_request_number?: string | null })?.work_request_number ||
                      (wr as { workOrderNumber?: string | null })?.workOrderNumber ||
                      (wr as { work_order_number?: string | null })?.work_order_number;
                    const label = wrNum ? `${wrNum} · ${wr.title}` : wr.title;
                    return (
                      <SelectItem key={wr.id} value={wr.id}>
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label
                htmlFor="create-invoice-task"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Linked Task*
              </label>
              <Select
                value={selectedTaskId}
                onValueChange={(val) => {
                  setSelectedTaskId(val);
                  setFormError(null);
                }}
                disabled={isTaskLocked || !workRequestId || isTaskBlocked}
              >
                <SelectTrigger
                  id="create-invoice-task"
                  className="h-9 text-xs"
                  data-testid="select-work-request-task"
                >
                  <SelectValue
                    placeholder={
                      !workRequestId ? 'Select work request first...' : 'Select task...'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {taskOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id} disabled={opt.disabled}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label
                htmlFor="create-invoice-number"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Invoice Number*
              </label>
              <Input
                id="create-invoice-number"
                type="text"
                value={invoiceNumber}
                readOnly
                placeholder="e.g. ATA-SI-2026-0042"
                className="h-9 text-xs font-mono bg-slate-50 cursor-not-allowed text-[#1E293B]"
                required
                data-testid="input-invoice-number"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  htmlFor="create-invoice-issue-date"
                  className="text-xs font-semibold text-[#1E293B] block mb-1"
                >
                  Issue Date*
                </label>
                <DateInput
                  aria-label="Invoice issue date"
                  id="create-invoice-issue-date"
                  type="date"
                  value={issueDate}
                  onValueChange={(value) => setIssueDate(value)}
                  className="h-9 text-xs"
                  required
                  data-testid="input-issue-date"
                />
              </div>
              <div>
                <label
                  htmlFor="create-invoice-due-date"
                  className="text-xs font-semibold text-[#1E293B] block mb-1"
                >
                  Due Date*
                </label>
                <DateInput
                  id="create-invoice-due-date"
                  aria-label="Invoice due date"
                  type="date"
                  value={dueDate}
                  onValueChange={(value) => setDueDate(value)}
                  className="h-9 text-xs"
                  required
                  data-testid="input-due-date"
                />
              </div>
            </div>
          </div>

          <TaskBlockingAlert
            blockingReason={blockingReason}
            isNoTasksBlocked={isNoTasksBlocked}
            isNotAssignedBlocked={isNotAssignedBlocked}
            isPhaseOrPrereqBlocked={isPhaseOrPrereqBlocked}
            workRequestId={workRequestId}
          />

          {/* 2. Dynamic Line Items Section */}
          <div className="space-y-2 pt-2 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-[#1E293B] uppercase tracking-wide">
                  Line Items
                </h4>
                <p className="text-xs tabular-nums text-[#475569]">
                  Minimum 1 item required. Total = Subtotal (tax-exempt).
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddLineItem}
                className="h-7 text-xs gap-1 cursor-pointer"
                data-testid="btn-add-line-item"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </Button>
            </div>

            <div className="space-y-2" data-testid="line-items-form-list">
              {lineItems.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2.5 bg-[#F8FAFC] border-[#E2E8F0] rounded-[6px]"
                  data-testid={`line-item-row-${index}`}
                >
                  <span className="text-xs text-[#475569] w-4 text-center">
                    {index + 1}
                  </span>

                  {/* Description */}
                  <div className="flex-1">
                    <Input
                      type="text"
                      value={item.description}
                      onChange={(e) => handleUpdateLineItem(index, 'description', e.target.value)}
                      placeholder="Item description..."
                      className="h-8 text-xs bg-white"
                      required
                      data-testid={`line-item-desc-${index}`}
                    />
                  </div>

                  {/* Category Type */}
                  <div className="w-36">
                    <Select
                      value={item.type}
                      onValueChange={(val) => handleUpdateLineItem(index, 'type', val)}
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
                      required
                      data-testid={`line-item-amount-${index}`}
                    />
                  </div>

                  {/* Controls: Reorder & Remove */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => handleMoveLineItem(index, 'up')}
                      className="p-1 text-[#475569] hover:text-[#1E293B] disabled:opacity-30 cursor-pointer"
                      title="Move up"
                      data-testid={`btn-move-up-${index}`}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={index === lineItems.length - 1}
                      onClick={() => handleMoveLineItem(index, 'down')}
                      className="p-1 text-[#475569] hover:text-[#1E293B] disabled:opacity-30 cursor-pointer"
                      title="Move down"
                      data-testid={`btn-move-down-${index}`}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={lineItems.length <= 1}
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
              <div className="w-60 bg-[#F8FAFC] p-2.5 rounded-[8px] border-[#E2E8F0] text-xs space-y-1">
                <div className="flex justify-between text-[#475569]">
                  <span>Subtotal:</span>
                  <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between font-bold text-[#1E293B] border-t border-[#E2E8F0] pt-1">
                  <span>Total Amount:</span>
                  <span className="tabular-nums text-sm" data-testid="calculated-total">
                    {formatCurrency(totals.total)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Notes & Terms */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#E2E8F0]">
            <div>
              <label
                htmlFor="create-invoice-notes"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Notes
              </label>
              <Input
                id="create-invoice-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes to client..."
                className="h-9 text-xs"
                data-testid="input-notes"
              />
            </div>
            <div>
              <label
                htmlFor="create-invoice-terms"
                className="text-xs font-semibold text-[#1E293B] block mb-1"
              >
                Payment Terms
              </label>
              <Input
                id="create-invoice-terms"
                type="text"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="e.g. Net 30"
                className="h-9 text-xs"
                data-testid="input-terms"
              />
            </div>
          </div>

          <DialogFooter className="pt-3">
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
              disabled={isTaskBlocked}
              className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="btn-submit-invoice"
            >
              Create Draft Invoice
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
