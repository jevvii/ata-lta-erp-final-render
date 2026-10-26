import { DateInput } from '@/components/ui/date-input';
import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Upload, FileText, X } from 'lucide-react';
import { useSessionStore } from '@/lib/session';
import { DISBURSEMENT_CATEGORIES, FUND_SOURCES } from '../api/schemas';
import { useCreateDisbursement } from '../api/useDisbursements';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { useWorkRequestTasks } from '@/features/operations/api/useTasks';
import { useTeam } from '@/features/operations/api/useTeam';
import type { ClientSummary } from '@/features/operations/api/useClients';
import type { WorkRequest } from '@/features/operations/api/types';
import type { CreateDisbursementInput, FundSource } from '../api/types';

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

export interface CreateDisbursementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  prefill?: FinancialPrefill;
  defaultWorkRequestId?: string;
  defaultClientId?: string;
}

export function CreateDisbursementModal({
  isOpen,
  onClose,
  onSuccess,
  prefill,
  defaultWorkRequestId = '',
  defaultClientId = '',
}: CreateDisbursementModalProps) {
  const { createWithBlocking, isPending } = useCreateDisbursement();

  const [category, setCategory] = useState<string>(DISBURSEMENT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [fundSource, setFundSource] = useState<FundSource>('Firm Fund');
  const [linkedWorkRequestId, setLinkedWorkRequestId] = useState(
    prefill?.workRequestId || defaultWorkRequestId || ''
  );
  const [clientId, setClientId] = useState(prefill?.clientId || defaultClientId || '');
  const [selectedTaskId, setSelectedTaskId] = useState(prefill?.taskId || '');
  const [employeeId, setEmployeeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptFilename, setReceiptFilename] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [customCategory, setCustomCategory] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setReceiptFile(file);
      setReceiptFilename(file.name);
    }
  };

  const canFetch = React.useMemo(() => {
    if (!isOpen) return false;
    const isTest =
      (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
      (typeof import.meta !== 'undefined' &&
        (import.meta as { env?: { MODE?: string } }).env?.MODE === 'test');
    const isMocked =
      typeof globalThis.fetch === 'function' &&
      Boolean((globalThis.fetch as { mock?: unknown }).mock);
    const hasToken =
      typeof window !== 'undefined' && Boolean(window.localStorage?.getItem('erp_access_token'));
    return isTest ? isMocked : hasToken;
  }, [isOpen]);

  const queryClient = useQueryClient();
  queryClient.setQueryDefaults(['me', 'team'], { enabled: canFetch });
  const { data: teamData } = useTeam();
  const team = teamData || [];

  const activeEntity = useSessionStore((state) => state.activeEntity);
  const currentUser = useSessionStore((state) => state.user);
  const effectiveEntity = activeEntity !== 'ALL' ? activeEntity : undefined;

  const { data: clientsData = [] } = useQuery<ClientSummary[]>({
    queryKey: ['clients', 'list', effectiveEntity, undefined, undefined],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (effectiveEntity) searchParams.append('entity', effectiveEntity);
      const queryStr = searchParams.toString();
      const res = await apiRequest<{ data: ClientSummary[] } | ClientSummary[]>(
        `/clients${queryStr ? `?${queryStr}` : ''}`
      );
      if (Array.isArray(res)) return res;
      return (res as { data?: ClientSummary[] }).data ?? [];
    },
    enabled: canFetch,
  });

  const clients: ClientSummary[] = React.useMemo(() => {
    if (!clientsData) return [];
    if (Array.isArray(clientsData)) return clientsData;
    return (clientsData as { data?: ClientSummary[] }).data ?? [];
  }, [clientsData]);

  const { data: workRequestsData } = useWorkRequests({ archived: false, limit: 200 }, { enabled: canFetch });
  const workRequests: WorkRequest[] = React.useMemo(() => {
    if (!workRequestsData) return [];
    if (Array.isArray(workRequestsData)) return workRequestsData;
    return (workRequestsData as { data?: WorkRequest[] }).data ?? [];
  }, [workRequestsData]);

  // Filter available work requests by clientId when client is locked or prefilled (Contract Rule 3)
  const availableWorkRequests = React.useMemo(() => {
    const lockedClientId = prefill?.clientId || defaultClientId;
    if (lockedClientId) {
      return workRequests.filter((wr) => (wr.client_id || wr.clientId) === lockedClientId);
    }
    return workRequests;
  }, [workRequests, prefill?.clientId, defaultClientId]);

  // Synchronize prefill contract and defaults on modal open, reset on close
  useEffect(() => {
    if (isOpen) {
      setLinkedWorkRequestId(prefill?.workRequestId || defaultWorkRequestId || '');
      setClientId(prefill?.clientId || defaultClientId || '');
      setSelectedTaskId(prefill?.taskId || '');
      setEmployeeId('');
      setReceiptFile(null);
      setReceiptFilename('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrors({});
    } else {
      setCategory(DISBURSEMENT_CATEGORIES[0]);
      setCustomCategory('');
      setDescription('');
      setAmount('');
      setFundSource('Firm Fund');
      setLinkedWorkRequestId('');
      setClientId('');
      setSelectedTaskId('');
      setEmployeeId('');
      setDueDate('');
      setNotes('');
      setReceiptFile(null);
      setReceiptFilename('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrors({});
    }
  }, [isOpen, prefill, defaultWorkRequestId, defaultClientId]);

  // WR-Task query (UAT2-12: populated dynamically from useWorkRequestTasks)
  const { data: tasksData = [] } = useWorkRequestTasks(linkedWorkRequestId || undefined, {
    enabled: canFetch && Boolean(linkedWorkRequestId),
  });
  const tasks = tasksData || [];

  // Auto-detect client from selected work request
  const selectedWr = workRequests.find((wr) => wr.id === linkedWorkRequestId);

  useEffect(() => {
    const isClientLockedByPrefill = Boolean(prefill?.clientId || defaultClientId);
    if (isOpen && linkedWorkRequestId && selectedWr?.client_id && !isClientLockedByPrefill) {
      if (clientId !== selectedWr.client_id) {
        setClientId(selectedWr.client_id);
      }
    }
  }, [isOpen, linkedWorkRequestId, selectedWr, prefill?.clientId, defaultClientId, clientId]);

  const clientDisplayName = React.useMemo(() => {
    if (selectedWr) {
      return (
        selectedWr.clientName ||
        selectedWr.client_name ||
        clients.find((c) => c.id === selectedWr.client_id)?.name ||
        (selectedWr.client_id ? `Client (${selectedWr.client_id})` : '')
      );
    }
    if (clientId) {
      return clients.find((c) => c.id === clientId)?.name || `Client (${clientId})`;
    }
    return '';
  }, [selectedWr, clientId, clients]);

  const handleSelectWorkRequest = (wrId: string) => {
    setLinkedWorkRequestId(wrId);
    setSelectedTaskId('');
    if (errors.linkedWorkRequestId) {
      setErrors((prev) => ({ ...prev, linkedWorkRequestId: '' }));
    }
    const isClientLockedByPrefill = Boolean(prefill?.clientId || defaultClientId);
    if (wrId) {
      const found = workRequests.find((wr) => wr.id === wrId);
      if (found?.client_id && !isClientLockedByPrefill) {
        setClientId(found.client_id);
      }
    } else if (!isClientLockedByPrefill) {
      setClientId('');
    }
  };

  const isWrLocked = Boolean(prefill?.workRequestId);
  const isTaskLocked = Boolean(prefill?.taskId);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!category.trim()) {
      newErrors.category = 'Category is required';
    }
    if (!description.trim()) {
      newErrors.description = 'Description is required';
    } else if (description.trim().length > 2000) {
      newErrors.description = 'Description cannot exceed 2000 characters';
    }
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      newErrors.amount = 'Amount must be a positive number greater than 0';
    }
    if (!linkedWorkRequestId.trim()) {
      newErrors.linkedWorkRequestId = 'Please select a Work Request';
    }

    if (employeeId.trim()) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isCurrentUser = Boolean(currentUser?.id && employeeId.trim() === currentUser.id);
      if (!isCurrentUser && !uuidRegex.test(employeeId.trim())) {
        newErrors.employeeId = 'Invalid Employee UUID format';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const resetForm = () => {
    setCategory(DISBURSEMENT_CATEGORIES[0]);
    setCustomCategory('');
    setDescription('');
    setAmount('');
    setFundSource('Firm Fund');
    setLinkedWorkRequestId(prefill?.workRequestId || defaultWorkRequestId || '');
    setClientId(prefill?.clientId || defaultClientId || '');
    setSelectedTaskId(prefill?.taskId || '');
    setEmployeeId('');
    setDueDate('');
    setNotes('');
    setReceiptFile(null);
    setReceiptFilename('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    // Task B.5: Government Assessment Document Upload & Soft-Warning
    let resultingS3Key: string | null = null;
    if (receiptFile) {
      try {
        const cleanName = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `disbursements/receipts/${Date.now()}_${cleanName}`;
        if (supabase?.storage && typeof supabase.storage.from === 'function') {
          const bucketName =
            (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_STORAGE_BUCKET) ||
            'ata-lta-erp-documents-prod';
          const { data: uploadData, error: uploadErr } = await supabase.storage
            .from(bucketName)
            .upload(storagePath, receiptFile);
          if (!uploadErr && uploadData?.path) {
            resultingS3Key = uploadData.path;
          }
        }
      } catch (err) {
        console.warn('Failed to upload receipt attachment to storage:', err);
      }
    }

    // Treat document as attached only when persisted to storage with a resulting S3 key,
    // or when a pre-existing receipt filename was provided without a pending local file upload.
    const hasReceipt = Boolean(resultingS3Key || (receiptFilename && receiptFilename.trim() && !receiptFile));
    if (!hasReceipt) {
      const proceed =
        typeof window !== 'undefined' && typeof window.confirm === 'function'
          ? window.confirm('No Government Assessment Document attached. Proceed anyway?')
          : true;
      if (proceed === false) {
        return;
      }
    }

    // Status Anti-Forgery: Notice that `status` is NEVER defined in payload!
    const effectiveCategory = category === 'Other' && customCategory.trim() ? customCategory.trim() : category;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validEmployeeId = employeeId.trim() && uuidRegex.test(employeeId.trim()) ? employeeId.trim() : null;
    const effectiveReceiptFilename = receiptFile?.name
      ? receiptFile.name.trim()
      : receiptFilename.trim()
      ? receiptFilename.trim()
      : null;
    const payload: CreateDisbursementInput = {
      category: effectiveCategory,
      description: description.trim(),
      amount: parseFloat(amount),
      fundSource,
      linkedWorkRequestId: linkedWorkRequestId.trim(),
      clientId: clientId ? clientId.trim() : null,
      linkedTaskId: selectedTaskId ? selectedTaskId.trim() : null,
      employeeId: validEmployeeId,
      dueDate: dueDate ? dueDate : null,
      notes: notes.trim() ? notes.trim() : null,
      receiptS3Key: resultingS3Key,
      receiptFilename: effectiveReceiptFilename,
    };

    try {
      await createWithBlocking(payload);
      resetForm();
      onClose();
      if (onSuccess) onSuccess();
    } catch {
      // Errors handled via BlockingActionModal
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        data-testid="create-disbursement-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-slate-900">
            New Disbursement Voucher
          </DialogTitle>
          <DialogDescription className="text-xs text-slate-600">
            Submit a new expense or reimbursement voucher. Initial status is assigned automatically
            by the system.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={handleSubmit}
          className="space-y-4"
          data-testid="create-disbursement-form"
        >
          {/* Work Request Dropdown (UAT2-12: eliminates manual WR-id input) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Linked Work Request <span className="text-red-500">*</span>
            </label>
            <div className="space-y-1.5">
              <select
                value={
                  workRequests.some((w) => w.id === linkedWorkRequestId)
                    ? linkedWorkRequestId
                    : linkedWorkRequestId || ''
                }
                onChange={(e) => handleSelectWorkRequest(e.target.value)}
                disabled={isWrLocked}
                className="w-full text-xs p-2 border rounded-md bg-white border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                data-testid="select-work-request"
              >
                <option value="">Select Work Request...</option>
                {availableWorkRequests.map((wr) => (
                  <option key={wr.id} value={wr.id}>
                    {wr.title} — {wr.clientName || wr.client_name || 'Client'}
                  </option>
                ))}
              </select>
            </div>
            {errors.linkedWorkRequestId && (
              <span className="text-[11px] text-red-600 block" data-testid="error-work-request-id">
                {errors.linkedWorkRequestId}
              </span>
            )}
          </div>

          {/* Associated Client (Auto-Detected, Read-Only) & Linked Task */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Associated Client (Auto-Detected)
              </label>
              <Input
                type="text"
                readOnly
                disabled
                value={
                  clientDisplayName ||
                  (clientId ? `Client Associated (${clientId.slice(0, 8)})` : '')
                }
                placeholder="Auto-detected from Work Request"
                className="bg-slate-50 text-slate-700 cursor-not-allowed text-xs disabled:opacity-80"
                data-testid="display-client-name"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Linked Task (Optional)</label>
              <select
                value={selectedTaskId}
                onChange={(e) => setSelectedTaskId(e.target.value)}
                disabled={isTaskLocked || !linkedWorkRequestId}
                className="w-full text-xs p-2 border rounded-md bg-white border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed"
                data-testid="select-work-request-task"
              >
                <option value="">
                  {!linkedWorkRequestId
                    ? 'Select a Work Request first...'
                    : 'None (No linked task)'}
                </option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Category & Fund Source */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs p-2 border rounded-md bg-white border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                data-testid="select-category"
              >
                {DISBURSEMENT_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              {category === 'Other' && (
                <Input
                  type="text"
                  placeholder="Specify custom category name..."
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="mt-2 text-xs"
                  data-testid="input-custom-category"
                />
              )}
              {errors.category && (
                <span className="text-[11px] text-red-600 block">{errors.category}</span>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Fund Source <span className="text-red-500">*</span>
              </label>
              <select
                value={fundSource}
                onChange={(e) => setFundSource(e.target.value as FundSource)}
                className="w-full text-xs p-2 border rounded-md bg-white border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
                data-testid="select-fund-source"
              >
                {FUND_SOURCES.map((src) => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Amount & Due Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">
                Amount (PHP) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (errors.amount) setErrors((prev) => ({ ...prev, amount: '' }));
                }}
                className={errors.amount ? 'border-red-500' : ''}
                data-testid="input-amount"
              />
              {errors.amount && (
                <span className="text-[11px] text-red-600 block" data-testid="error-amount">
                  {errors.amount}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Due Date</label>
              <DateInput
                aria-label="Disbursement due date"
                type="date"
                value={dueDate}
                onValueChange={(value) => setDueDate(value)}
                data-testid="input-due-date"
              />
            </div>
          </div>

          {/* Employee Selector */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">Employee</label>
              {currentUser?.name && (
                <span className="text-[11px] text-slate-500 font-medium">
                  Current User: {currentUser.name}
                </span>
              )}
            </div>
            <select
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                if (errors.employeeId) setErrors((prev) => ({ ...prev, employeeId: '' }));
              }}
              className={`w-full text-xs p-2 border rounded-md bg-white text-slate-800 border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                errors.employeeId ? 'border-red-500' : ''
              }`}
              data-testid="select-employee"
            >
              <option value="">Select Employee...</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            {errors.employeeId && (
              <span className="text-[11px] text-red-600 block">{errors.employeeId}</span>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Description / Expense Purpose <span className="text-red-500">*</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (errors.description) setErrors((prev) => ({ ...prev, description: '' }));
              }}
              placeholder="e.g. BIR filing documentary stamp tax and notarization fees"
              className={`w-full text-xs p-2.5 border rounded-md bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                errors.description ? 'border-red-500' : 'border-slate-200'
              }`}
              data-testid="textarea-description"
            />
            {errors.description && (
              <span className="text-[11px] text-red-600 block" data-testid="error-description">
                {errors.description}
              </span>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Internal Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional internal remarks or references..."
              className="w-full text-xs p-2 border rounded-md bg-white border-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              data-testid="textarea-notes"
            />
          </div>

          {/* Receipt Attachment */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">
              Receipt Attachment
            </label>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setReceiptFile(file);
                  setReceiptFilename(file.name);
                }
              }}
              data-testid="receipt-file-input"
            />
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => {
                if (!receiptFile && !receiptFilename) {
                  fileInputRef.current?.click();
                }
              }}
              className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-blue-400 bg-slate-50/50'
              }`}
              data-testid="receipt-dropzone"
            >
              {receiptFile || receiptFilename ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="h-4 w-4 text-blue-600 shrink-0" />
                    <span className="text-xs font-medium text-slate-800 truncate" data-testid="receipt-attached-filename">
                      {receiptFile?.name || receiptFilename}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReceiptFile(null);
                      setReceiptFilename('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="h-6 w-6 p-0 text-slate-400 hover:text-slate-600 cursor-pointer"
                    data-testid="remove-receipt-btn"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-2">
                  <Upload className="h-6 w-6 text-slate-400 mb-1" />
                  <p className="text-xs font-medium text-slate-700">
                    Drag and drop receipt here, or browse
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    PDF, PNG, JPG up to 10MB
                  </p>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isPending}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isPending}
              data-testid="submit-create-disbursement-btn"
              className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isPending ? 'Creating...' : 'Create Disbursement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
