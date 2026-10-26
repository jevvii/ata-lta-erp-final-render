/**
 * Transmittal Creation and Editing Modal
 *
 * Implements dynamic line-item manager requiring >= 1 valid document row.
 * Integrates client selector and work request selector.
 */

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, FileText, AlertCircle, Building, Briefcase, User, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const Label = ({
  className = '',
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={`block text-xs font-semibold text-[#1E293B] ${className}`} {...props}>
    {children}
  </label>
);

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = '', ...props }, ref) => (
  <textarea
    ref={ref}
    className={`flex min-h-[60px] w-full rounded-[8px] border-[#E2E8F0] bg-transparent px-3 py-2 text-xs shadow-none placeholder:text-[#475569] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
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
import { useCreateTransmittal, useUpdateTransmittal } from '../api/useTransmittals';
import { DOCUMENT_CATEGORIES } from '../api/schemas';
import type { Transmittal, CreateTransmittalItemInput } from '../api/types';

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

export interface TransmittalFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  transmittalToEdit?: Transmittal | null;
  prefill?: FinancialPrefill;
}

interface FormLineItem {
  id: string; // temporary key for rendering
  description: string;
  documentType: string;
  quantity: number;
}

export function TransmittalFormModal({
  isOpen,
  onClose,
  transmittalToEdit,
  prefill,
}: TransmittalFormModalProps) {
  const isEditMode = Boolean(transmittalToEdit);

  const createMutation = useCreateTransmittal();
  const updateMutation = useUpdateTransmittal();

  // Load clients and work requests for selection
  const { data: clients = [] } = useClients();
  const { data: workRequestsData } = useWorkRequests({ archived: false });
  const workRequests = React.useMemo(() => {
    if (!workRequestsData) return [];
    if (Array.isArray(workRequestsData)) return workRequestsData;
    return workRequestsData.data ?? [];
  }, [workRequestsData]);

  // Form Fields State
  const [clientId, setClientId] = useState('');
  const [workRequestId, setWorkRequestId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientDetails, setRecipientDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<FormLineItem[]>([
    { id: 'item-1', description: '', documentType: 'Contract', quantity: 1 },
  ]);

  // Filter available work requests by clientId when client is selected or prefilled (Contract Rule 3)
  const availableWorkRequests = React.useMemo(() => {
    if (clientId) {
      return workRequests.filter((wr) => (wr.client_id || wr.clientId) === clientId);
    }
    return workRequests;
  }, [workRequests, clientId]);

  // Form validation errors
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isClientLocked = Boolean(!isEditMode && (prefill?.workRequestId || prefill?.clientId));
  const isWrLocked = Boolean(!isEditMode && prefill?.workRequestId);
  const isTaskLocked = Boolean(!isEditMode && prefill?.taskId);

  const originTaskId = transmittalToEdit
    ? (transmittalToEdit.linked_task_id || transmittalToEdit.linkedTaskId || null)
    : null;

  const {
    options: taskOptions,
    isBlocked: isTaskBlocked,
    isNoTasksBlocked,
    isNotAssignedBlocked,
  } = useSelectableTasks({
    workRequestId: workRequestId || undefined,
    recordType: 'transmittal',
    isOpen,
    currentTaskId: originTaskId,
    selectedTaskId,
    onSelectTask: (taskId) => {
      setSelectedTaskId(taskId);
      if (errors.selectedTaskId) {
        setErrors((prev) => {
          const next = { ...prev };
          delete next.selectedTaskId;
          return next;
        });
      }
    },
    isTaskLocked,
  });

  // Reset or Populate form on open/change
  useEffect(() => {
    if (isOpen) {
      if (transmittalToEdit) {
        setClientId(transmittalToEdit.client_id || '');
        setWorkRequestId(transmittalToEdit.work_request_id || '');
        setSelectedTaskId(transmittalToEdit.linked_task_id || transmittalToEdit.linkedTaskId || '');
        setTrackingNumber(transmittalToEdit.tracking_number || '');
        setRecipientName(transmittalToEdit.recipient_name || '');
        setRecipientDetails(transmittalToEdit.recipient_details || '');
        setNotes(transmittalToEdit.notes || '');

        if (transmittalToEdit.items && transmittalToEdit.items.length > 0) {
          setItems(
            transmittalToEdit.items.map((item, idx) => ({
              id: item.id || `item-${idx}`,
              description: item.description,
              documentType: item.document_type || item.documentType || 'Contract',
              quantity: item.quantity || 1,
            }))
          );
        } else {
          setItems([{ id: 'item-1', description: '', documentType: 'Contract', quantity: 1 }]);
        }
      } else {
        // Create defaults
        setTrackingNumber('Auto-generated on Save');
        setWorkRequestId(prefill?.workRequestId || '');
        setClientId(prefill?.clientId || '');
        setSelectedTaskId(prefill?.taskId || '');
        setRecipientName('');
        setRecipientDetails('');
        setNotes('');
        setItems([{ id: 'item-1', description: '', documentType: 'Contract', quantity: 1 }]);
      }
    } else {
      // Modal closed: reset form state so reopening does not leak stale values
      setClientId('');
      setWorkRequestId('');
      setSelectedTaskId('');
      setRecipientName('');
      setRecipientDetails('');
      setNotes('');
      setItems([{ id: 'item-1', description: '', documentType: 'Contract', quantity: 1 }]);
    }
    setErrors({});
  }, [transmittalToEdit, isOpen, prefill]);

  // Auto-detect client from work request in create mode
  useEffect(() => {
    if (isOpen && !isEditMode && workRequestId && workRequests.length > 0 && !prefill?.clientId) {
      const matchedWr = workRequests.find((w) => w.id === workRequestId);
      if (matchedWr?.client_id && matchedWr.client_id !== clientId) {
        setClientId(matchedWr.client_id);
      }
    }
  }, [isOpen, isEditMode, workRequestId, workRequests, prefill?.clientId, clientId]);

  const handleClientChange = (newClientId: string) => {
    setClientId(newClientId);
    if (workRequestId) {
      const currentWr = workRequests.find((w) => w.id === workRequestId);
      if (currentWr && (currentWr.client_id || currentWr.clientId) !== newClientId) {
        setWorkRequestId('');
        setSelectedTaskId('');
      }
    }
  };

  const handleWorkRequestChange = (newWrId: string) => {
    setWorkRequestId(newWrId);
    setSelectedTaskId('');
    if (errors.workRequestId) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy.workRequestId;
        return copy;
      });
    }
    if (errors.selectedTaskId) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy.selectedTaskId;
        return copy;
      });
    }
    if (!prefill?.clientId) {
      const matchedWr = workRequests.find((w) => w.id === newWrId);
      if (matchedWr?.client_id) {
        setClientId(matchedWr.client_id);
      }
    }
  };

  // Line Items Controls
  const handleAddItem = () => {
    const newItem: FormLineItem = {
      id: `item-${Date.now()}-${Math.random()}`,
      description: '',
      documentType: 'Contract',
      quantity: 1,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      setErrors((prev) => ({
        ...prev,
        items: 'At least 1 document line item is required.',
      }));
      return;
    }
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleItemChange = (
    id: string,
    field: keyof Omit<FormLineItem, 'id'>,
    value: string | number
  ) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id === id) {
          return { ...i, [field]: value };
        }
        return i;
      })
    );
    // Clear items error
    if (errors.items) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.items;
        return next;
      });
    }
  };

  // Submit Handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!clientId) {
      newErrors.clientId = 'Please select a client';
    }
    if (!workRequestId && !isEditMode) {
      newErrors.workRequestId = 'Please select a work request';
    }
    if (items.length === 0) {
      newErrors.items = 'At least 1 document row is required';
    }

    const invalidRow = items.find((i) => !i.description.trim());
    if (invalidRow) {
      newErrors.items = 'All document rows must have a valid description';
    }

    if (workRequestId) {
      if (!selectedTaskId) {
        newErrors.selectedTaskId = 'A valid linked task is required';
      } else if (isTaskBlocked && selectedTaskId !== originTaskId) {
        newErrors.selectedTaskId = isNoTasksBlocked
          ? 'This work request has no tasks — create one first'
          : "You're not assigned to any task on this work request. Ask the task owner or an Admin to add you.";
      } else {
        const found = taskOptions.find((t) => t.id === selectedTaskId);
        if (found && found.disabled && found.id !== originTaskId) {
          newErrors.selectedTaskId = 'You are not assigned to this task';
        }
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const sanitizedItems: CreateTransmittalItemInput[] = items.map((i) => ({
      description: i.description.trim(),
      documentType: i.documentType || 'Others',
      quantity: Number(i.quantity) || 1,
    }));

    try {
      if (isEditMode && transmittalToEdit) {
        await updateMutation.mutateAsync({
          id: transmittalToEdit.id,
          data: {
            clientId,
            workRequestId: workRequestId || null,
            linkedTaskId: selectedTaskId || null,
            trackingNumber: (transmittalToEdit.tracking_number || transmittalToEdit.trackingNumber || trackingNumber || '').trim(),
            items: sanitizedItems,
            recipientName: recipientName.trim() || null,
            recipientDetails: recipientDetails.trim() || null,
            notes: notes.trim() || null,
            expectedVersion: transmittalToEdit.version,
          },
        });
      } else {
        await createMutation.mutateAsync({
          clientId,
          workRequestId,
          linkedTaskId: selectedTaskId || null,
          items: sanitizedItems,
          recipientName: recipientName.trim() || null,
          recipientDetails: recipientDetails.trim() || null,
          notes: notes.trim() || null,
        });
      }
      onClose();
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code;
      if (errCode === 'TASK_REQUIRED') {
        setErrors((prev) => ({ ...prev, selectedTaskId: 'A valid linked task is required' }));
      } else if (errCode === 'TASK_WR_MISMATCH') {
        setErrors((prev) => ({ ...prev, selectedTaskId: 'Selected task does not belong to the selected work request' }));
      } else if (errCode === 'TASK_NOT_SELECTABLE') {
        setErrors((prev) => ({ ...prev, selectedTaskId: 'Selected task is not selectable' }));
      } else if (errCode === 'TASK_ASSIGNMENT_REQUIRED' || errCode === 'FORBIDDEN_TASK_ATTACHMENT') {
        setErrors((prev) => ({ ...prev, selectedTaskId: 'You are not assigned to this task' }));
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="border-[#E2E8F0] max-w-2xl border max-h-[90vh] rounded-[12px] bg-[#FFFFFF] shadow-float overflow-y-auto"
        data-testid="transmittal-form-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <FileText className="h-5 w-5 text-[#1E293B]" />
            {isEditMode ? 'Edit Transmittal' : 'Create New Transmittal'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {/* General Information Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Tracking Number */}
            <div className="space-y-1.5">
              <Label
                htmlFor="trackingNumber"
                className="text-xs font-semibold flex items-center gap-1 text-[#1E293B]"
              >
                <Lock className="h-3.5 w-3.5 text-[#475569]" />
                Tracking Number
              </Label>
              <Input
                id="trackingNumber"
                value={
                  isEditMode
                    ? transmittalToEdit?.tracking_number || transmittalToEdit?.trackingNumber || trackingNumber
                    : 'Auto-generated on Save'
                }
                disabled={true}
                readOnly={true}
                placeholder="Auto-generated on Save"
                className="tabular-nums text-xs bg-[#F8FAFC] text-[#475569] cursor-not-allowed"
                data-testid="tracking-number-input"
              />
              <p className="text-xs text-[#475569] flex items-center gap-1">
                {isEditMode
                  ? 'Tracking number cannot be modified once created.'
                  : 'Auto-generated on Save'}
              </p>
            </div>

            {/* Client Picker */}
            <div className="space-y-1.5">
              <Label
                htmlFor="client"
                className="text-xs font-semibold flex items-center gap-1 text-[#1E293B]"
              >
                <Building className="h-3.5 w-3.5" />
                Client *
              </Label>
              <Select value={clientId} onValueChange={handleClientChange} disabled={isClientLocked}>
                <SelectTrigger id="client" className="text-xs" data-testid="client-select">
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} ({c.entity})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.clientId && (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.clientId}
                </p>
              )}
            </div>

            {/* Work Request linkage */}
            <div className="space-y-1.5 md:col-span-2">
              <Label
                htmlFor="workRequest"
                className="text-xs font-semibold flex items-center gap-1 text-[#1E293B]"
              >
                <Briefcase className="h-3.5 w-3.5" />
                Work Request {isEditMode ? '(Optional)' : '*'}
              </Label>
              <Select
                value={workRequestId}
                onValueChange={handleWorkRequestChange}
                disabled={isWrLocked}
              >
                <SelectTrigger
                  id="workRequest"
                  className="text-xs"
                  data-testid="work-request-select"
                >
                  <SelectValue placeholder="Link to work request..." />
                </SelectTrigger>
                <SelectContent>
                  {availableWorkRequests.map((wr) => (
                    <SelectItem key={wr.id} value={wr.id}>
                      {wr.tracking_number || wr.title} — {wr.client_name || 'Client'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.workRequestId && (
                <p className="text-xs text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  {errors.workRequestId}
                </p>
              )}
            </div>

            {/* Linked Task */}
            <div className="space-y-1.5 md:col-span-2">
              <Label
                htmlFor="workRequestTask"
                className="text-xs font-semibold flex items-center gap-1 text-[#1E293B]"
              >
                <Briefcase className="h-3.5 w-3.5" />
                Linked Task {workRequestId ? '*' : '(Optional)'}
              </Label>
              <Select
                value={selectedTaskId || '__none__'}
                onValueChange={(val) => {
                  setSelectedTaskId(val === '__none__' ? '' : val);
                  if (errors.selectedTaskId) {
                    setErrors((prev) => {
                      const next = { ...prev };
                      delete next.selectedTaskId;
                      return next;
                    });
                  }
                }}
                disabled={isTaskLocked || !workRequestId || (isTaskBlocked && selectedTaskId !== originTaskId)}
              >
                <SelectTrigger id="workRequestTask" className="text-xs" data-testid="task-select">
                  <SelectValue
                    placeholder={
                      !workRequestId
                        ? 'Select work request first...'
                        : 'Select task...'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {!workRequestId && (
                    <SelectItem value="__none__">None (No linked task)</SelectItem>
                  )}
                  {taskOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id} disabled={opt.disabled && opt.id !== originTaskId}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.selectedTaskId && (
                <p className="text-xs text-rose-600 flex items-center gap-1" data-testid="task-error-message">
                  <AlertCircle className="h-3 w-3" />
                  {errors.selectedTaskId}
                </p>
              )}
            </div>

            <div className="md:col-span-2">
              <TaskBlockingAlert
                isNoTasksBlocked={isNoTasksBlocked}
                isNotAssignedBlocked={isNotAssignedBlocked}
                workRequestId={workRequestId}
              />
            </div>

            {/* Recipient Person Name */}
            <div className="space-y-1.5">
              <Label
                htmlFor="recipientName"
                className="text-xs font-semibold flex items-center gap-1 text-[#1E293B]"
              >
                <User className="h-3.5 w-3.5" />
                Recipient Name
              </Label>
              <Input
                id="recipientName"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Target contact person..."
                className="text-xs"
                data-testid="recipient-name-input"
              />
            </div>

            {/* Recipient Details / Address */}
            <div className="space-y-1.5">
              <Label htmlFor="recipientDetails" className="text-xs font-semibold text-[#1E293B]">
                Delivery Address / Contact
              </Label>
              <Input
                id="recipientDetails"
                value={recipientDetails}
                onChange={(e) => setRecipientDetails(e.target.value)}
                placeholder="Office suite, building, phone..."
                className="text-xs"
                data-testid="recipient-details-input"
              />
            </div>
          </div>

          {/* Line Items Manager Section */}
          <div className="space-y-3 pt-2 border-t border-[#E2E8F0]">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-xs font-bold text-[#1E293B] tracking-normal">
                  Document Line Items *
                </Label>
                <p className="text-xs text-[#475569]">
                  Add documents to transmit (at least 1 line item required).
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddItem}
                className="h-7 text-xs gap-1 border-[#E2E8F0] text-[#1E293B] hover:bg-[#F8FAFC]"
                data-testid="add-item-row-btn"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Document Row
              </Button>
            </div>

            {errors.items && (
              <div
                className="p-2.5 bg-rose-50 border-rose-200 rounded text-rose-700 text-xs flex items-center gap-2"
                data-testid="items-error-message"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{errors.items}</span>
              </div>
            )}

            {/* Line Items Table */}
            <div className="space-y-2">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 p-2 bg-[#F8FAFC] rounded-[8px] border-[#E2E8F0]"
                  data-testid={`transmittal-form-item-row-${index}`}
                >
                  <span className="text-xs font-semibold text-[#475569] w-5 text-center shrink-0">
                    #{index + 1}
                  </span>

                  {/* Document Category */}
                  <div className="w-36 shrink-0">
                    <Select
                      value={item.documentType}
                      onValueChange={(val) => handleItemChange(item.id, 'documentType', val)}
                    >
                      <SelectTrigger
                        className="h-8 text-xs bg-white"
                        data-testid={`item-category-select-${index}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>
                            {cat}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Description Input */}
                  <div className="flex-1 min-w-0">
                    <Input
                      placeholder="Document title or description..."
                      value={item.description}
                      onChange={(e) => handleItemChange(item.id, 'description', e.target.value)}
                      className="h-8 text-xs bg-white"
                      data-testid={`item-description-input-${index}`}
                    />
                  </div>

                  {/* Quantity Input */}
                  <div className="w-20 shrink-0">
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        handleItemChange(
                          item.id,
                          'quantity',
                          Math.max(1, parseInt(e.target.value, 10) || 1)
                        )
                      }
                      className="h-8 text-xs bg-white text-center"
                      title="Quantity"
                      data-testid={`item-quantity-input-${index}`}
                    />
                  </div>

                  {/* Remove row */}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveItem(item.id)}
                    className="h-8 w-8 p-0 text-[#475569] hover:text-rose-600 hover:bg-rose-50 shrink-0"
                    title="Remove item"
                    data-testid={`remove-item-row-btn-${index}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5 pt-2 border-t border-[#E2E8F0]">
            <Label htmlFor="notes" className="text-xs font-semibold text-[#1E293B]">
              Delivery Notes / Instructions
            </Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Instructions for courier, handling remarks, or client notes..."
              rows={2}
              className="text-xs"
              data-testid="notes-textarea"
            />
          </div>

          {/* Modal Footer */}
          <DialogFooter className="pt-3 border-t border-[#E2E8F0] flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="h-8 text-xs"
              data-testid="cancel-form-btn"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending || Boolean(workRequestId && isTaskBlocked && selectedTaskId !== originTaskId)}
              className="h-8 text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="submit-transmittal-btn"
            >
              {isEditMode ? 'Save Changes' : 'Create Transmittal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
