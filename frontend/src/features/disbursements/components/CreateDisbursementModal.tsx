import { DateInput } from '@/components/ui/date-input';
import React, { useState, useEffect, useLayoutEffect } from 'react';
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
import { Upload, FileText, X, AlertCircle } from 'lucide-react';
import { useSessionStore } from '@/lib/session';
import { DISBURSEMENT_CATEGORIES, FUND_SOURCES } from '../api/schemas';
import {
  useCreateDisbursement,
  uploadReceiptFile,
  isValidReceiptMimeType,
} from '../api/useDisbursements';
import { apiRequest, ApiError } from '@/lib/api';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { operationsKeys } from '@/features/operations/api/queryKeys';
import { useSelectableTasks } from '@/features/operations/hooks/useSelectableTasks';
import { TaskBlockingAlert } from '@/features/operations/components/TaskBlockingAlert';
import {
  isTaskAssignee,
  isRoleAdmin,
  isTaskOfWorkRequest,
} from '@/features/operations/lib/taskScope';
import { useTeam } from '@/features/operations/api/useTeam';
import type { ClientSummary } from '@/features/operations/api/useClients';
import type { WorkRequest, Task } from '@/features/operations/api/types';
import type { CreateDisbursementInput, FundSource } from '../api/types';
import { useLiveModalContext } from '../lib/useLiveModalContext';

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
  defaultTaskId?: string;
}

// Keep an uncertain submission blocked across attachment replacement, modal reopen and page refresh.
// Only the requester can clear this after inspecting their persisted vouchers.
const pendingCreates = new Set<string>();
function hasPendingCreate(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === 'pending';
  } catch {
    return pendingCreates.has(key);
  }
}
function markPendingCreate(key: string, pending: boolean): void {
  if (pending) pendingCreates.add(key);
  else pendingCreates.delete(key);
  try {
    if (pending) sessionStorage.setItem(key, 'pending');
    else sessionStorage.removeItem(key);
  } catch {
    /* In-memory protection remains if browser storage is unavailable. */
  }
}

/**
 * Classify receipt upload errors according to RFC 7807 codes and Spec C6.
 */
function classifyReceiptUploadError(err: unknown): string {
  const code = err instanceof ApiError ? err.code : (err as { code?: string })?.code;

  if (code === 'RECEIPT_STORE_NOT_CONFIGURED') {
    return 'Receipt uploads are unavailable. Please contact your administrator. Your request has not been submitted.';
  }

  if (code === 'RECEIPT_STORE_DATABASE_UNAVAILABLE' || code === 'RECEIPT_STORE_IO_ERROR') {
    return 'Receipt storage is unavailable. Your request has not been submitted. Please try again later or contact your administrator.';
  }

  if (code === 'RECEIPT_ENTITY_REQUIRED') {
    return 'Select a specific ATA or LTA entity for this receipt upload.';
  }

  const rawMsg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : (err as { message?: string })?.message || 'Receipt upload failed';

  const cleanMsg = rawMsg.trim().replace(/\.+$/, '');

  if (
    /please retry/i.test(cleanMsg) ||
    /retry this operation/i.test(cleanMsg) ||
    /please upload again/i.test(cleanMsg) ||
    /try again/i.test(cleanMsg)
  ) {
    return `Receipt upload failed: ${cleanMsg}.`;
  }

  return `Receipt upload failed: ${cleanMsg}. Please retry.`;
}

export function CreateDisbursementModal({
  isOpen,
  onClose,
  onSuccess,
  prefill,
  defaultWorkRequestId = '',
  defaultClientId = '',
  defaultTaskId = '',
}: CreateDisbursementModalProps) {
  const { createWithBlocking, isPending } = useCreateDisbursement();
  const { data: team = [] } = useTeam();

  const [category, setCategory] = useState<string>(DISBURSEMENT_CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<string>('');
  const [fundSource, setFundSource] = useState<FundSource>('Firm Fund');
  const [linkedWorkRequestId, setLinkedWorkRequestId] = useState(
    prefill?.workRequestId || defaultWorkRequestId || ''
  );
  const [clientId, setClientId] = useState(prefill?.clientId || defaultClientId || '');
  const [selectedTaskId, setSelectedTaskId] = useState(prefill?.taskId || defaultTaskId || '');
  const [employeeId, setEmployeeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [receiptFilename, setReceiptFilename] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [customCategory, setCustomCategory] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isNoReceiptConfirmOpen, setIsNoReceiptConfirmOpen] = useState(false);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [uploadedReceipt, setUploadedReceipt] = useState<{
    file: File;
    receiptS3Key: string;
    receiptFilename: string;
    targetWorkRequestId: string;
    targetClientId: string;
    targetTaskId?: string | null;
    targetEntity: 'ATA' | 'LTA';
    targetGeneration: number;
  } | null>(null);
  const isSubmittingRef = React.useRef(false);
  const attemptIdRef = React.useRef(0);
  const [needsCreateReview, setNeedsCreateReview] = useState(false);
  const { captureContext, contextKey } = useLiveModalContext({
    isOpen,
  });

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

  const handleSelectFile = (file: File) => {
    if (isUploadingReceipt || isPending) return;
    if (!isValidReceiptMimeType(file.type, file.name)) {
      setErrors((prev) => ({ ...prev, receipt: 'Only PDF, PNG, and JPEG files are allowed' }));
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrors((prev) => ({ ...prev, receipt: 'File size cannot exceed 10 MiB' }));
      return;
    }
    setReceiptFile(file);
    setReceiptFilename(file.name);
    setUploadedReceipt(null);
    setErrors((prev) => {
      const copy = { ...prev };
      delete copy.receipt;
      return copy;
    });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (isUploadingReceipt || isPending) return;
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleSelectFile(file);
    }
  };

  const processClipboardData = (clipboardData: DataTransfer | null): boolean => {
    if (isUploadingReceipt || isPending || !clipboardData) return false;

    let imageFile: File | null = null;

    // 1. Check clipboard files
    const files = clipboardData.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (
          file &&
          (file.type.startsWith('image/') ||
            file.type === 'application/pdf' ||
            /\.(png|jpe?g|webp|gif|bmp|pdf)$/i.test(file.name))
        ) {
          imageFile = file;
          break;
        }
      }
    }

    // 2. Check clipboard items
    if (!imageFile && clipboardData.items) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (item) {
          if (item.type.startsWith('image/') || item.type === 'application/pdf') {
            const blob = item.getAsFile();
            if (blob) {
              imageFile = blob;
              break;
            }
          } else if (item.kind === 'file') {
            const blob = item.getAsFile();
            if (
              blob &&
              (blob.type.startsWith('image/') ||
                blob.type === 'application/pdf' ||
                /\.(png|jpe?g|webp|gif|bmp|pdf)$/i.test(blob.name))
            ) {
              imageFile = blob;
              break;
            }
          }
        }
      }
    }

    if (imageFile) {
      const ext =
        imageFile.type === 'image/jpeg'
          ? 'jpg'
          : imageFile.type === 'application/pdf'
            ? 'pdf'
            : 'png';
      const rawName = imageFile.name;
      const finalName =
        rawName && rawName !== 'image.png' && rawName !== 'blob'
          ? rawName
          : `clipboard-receipt-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}.${ext}`;

      const namedFile =
        imageFile.name === finalName
          ? imageFile
          : new File([imageFile], finalName, {
              type: imageFile.type || (ext === 'pdf' ? 'application/pdf' : 'image/png'),
            });

      handleSelectFile(namedFile);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!isOpen) return;

    const handlePaste = (e: ClipboardEvent) => {
      const handled = processClipboardData(e.clipboardData);
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('paste', handlePaste, { capture: true });
    document.addEventListener('paste', handlePaste, { capture: true });
    return () => {
      window.removeEventListener('paste', handlePaste, { capture: true });
      document.removeEventListener('paste', handlePaste, { capture: true });
    };
  }, [isOpen, isUploadingReceipt, isPending]);

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
  const activeEntity = useSessionStore((state) => state.activeEntity);
  const currentUser = useSessionStore((state) => state.user);
  const isAdmin = isRoleAdmin(currentUser);
  const effectiveEntity = activeEntity !== 'ALL' ? activeEntity : undefined;
  const pendingCreateKey = `erp_disbursement_creation_pending:${currentUser?.id}:${activeEntity}`;
  useEffect(() => {
    isSubmittingRef.current = false;
    setIsUploadingReceipt(false);
    setIsNoReceiptConfirmOpen(false);
    setNeedsCreateReview(hasPendingCreate(pendingCreateKey));
  }, [contextKey, pendingCreateKey]);

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

  const { data: workRequestsData } = useWorkRequests(
    { archived: false, limit: 200 },
    { enabled: canFetch }
  );
  const workRequests: WorkRequest[] = React.useMemo(() => {
    if (!workRequestsData) return [];
    if (Array.isArray(workRequestsData)) return workRequestsData;
    return (workRequestsData as { data?: WorkRequest[] }).data ?? [];
  }, [workRequestsData]);

  // Filter available work requests by clientId when client is locked or prefilled (Contract Rule 3)
  // and scope by activeEntity when not ALL, while preserving the explicitly requested/default WR
  const availableWorkRequests = React.useMemo(() => {
    const lockedClientId = prefill?.clientId || defaultClientId;
    const preservedWrId = prefill?.workRequestId || defaultWorkRequestId || linkedWorkRequestId;
    let list = workRequests;
    if (lockedClientId) {
      list = list.filter((wr) => (wr.client_id || wr.clientId) === lockedClientId || wr.id === preservedWrId);
    }
    if (activeEntity && activeEntity !== 'ALL') {
      list = list.filter((wr) => {
        if (preservedWrId && wr.id === preservedWrId) return true;
        const wrEntity =
          wr.entity ||
          (wr as unknown as { entity_code?: string }).entity_code ||
          (wr as unknown as { entityCode?: string }).entityCode;
        if (wrEntity && (wrEntity === 'ATA' || wrEntity === 'LTA')) {
          return wrEntity === activeEntity;
        }
        return true;
      });
    }
    return list;
  }, [
    workRequests,
    prefill?.clientId,
    defaultClientId,
    prefill?.workRequestId,
    defaultWorkRequestId,
    linkedWorkRequestId,
    activeEntity,
  ]);

  const prevIsOpenRef = React.useRef(isOpen);
  // Synchronize prefill contract and defaults on modal open, reset on close
  useEffect(() => {
    const wasOpen = prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      setLinkedWorkRequestId(prefill?.workRequestId || defaultWorkRequestId || '');
      setClientId(prefill?.clientId || defaultClientId || '');
      setSelectedTaskId(prefill?.taskId || defaultTaskId || '');
      setEmployeeId('');
      setReceiptFile(null);
      setReceiptFilename('');
      setUploadedReceipt(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrors({});
    } else if (!isOpen && wasOpen) {
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
      setUploadedReceipt(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrors({});
    } else if (isOpen) {
      // Modal is already open; only update prefilled fields if explicitly provided and changed,
      // without wiping user-attached receipts or in-progress inputs.
      if (prefill?.workRequestId && prefill.workRequestId !== linkedWorkRequestId) {
        setLinkedWorkRequestId(prefill.workRequestId);
      }
      if (prefill?.clientId && prefill.clientId !== clientId) {
        setClientId(prefill.clientId);
      }
      if (prefill?.taskId && prefill.taskId !== selectedTaskId) {
        setSelectedTaskId(prefill.taskId);
      }
    }
  }, [
    isOpen,
    prefill?.workRequestId,
    prefill?.clientId,
    prefill?.taskId,
    defaultWorkRequestId,
    defaultClientId,
    defaultTaskId,
    linkedWorkRequestId,
    clientId,
    selectedTaskId,
  ]);

  // Auto-detect client and target entity from selected work request
  const selectedWr = workRequests.find((wr) => wr.id === linkedWorkRequestId);

  const resolvedTargetEntity: 'ATA' | 'LTA' | undefined = React.useMemo(() => {
    if (activeEntity !== 'ALL') {
      return activeEntity === 'ATA' || activeEntity === 'LTA' ? activeEntity : undefined;
    }
    const wrEntity = selectedWr?.entity;
    if (wrEntity === 'ATA' || wrEntity === 'LTA') {
      return wrEntity;
    }
    return undefined;
  }, [activeEntity, selectedWr?.entity]);

  const isWrLocked = Boolean(prefill?.workRequestId);
  const isTaskLocked = Boolean(prefill?.taskId || defaultTaskId);

  // WR-Task query & selectability hook
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
    workRequestId: linkedWorkRequestId || undefined,
    workRequestPhase: selectedWr?.phase,
    recordType: 'disbursement',
    isOpen: canFetch,
    entity: resolvedTargetEntity,
    currentTaskId: prefill?.taskId || defaultTaskId || null,
    selectedTaskId,
    onSelectTask: (taskId) => setSelectedTaskId(taskId),
    isTaskLocked,
  });

  const targetGenerationRef = React.useRef(0);
  const formSeed = JSON.stringify([
    prefill?.workRequestId, prefill?.clientId, prefill?.taskId,
    defaultWorkRequestId, defaultClientId,
  ]);
  const liveTargetRef = React.useRef({
    workRequestId: linkedWorkRequestId,
    clientId,
    taskId: selectedTaskId,
    entity: resolvedTargetEntity,
    file: receiptFile,
    formSeed,
    generation: 0,
  });

  // Invalidate callbacks before pending responses can use a changed target or file.
  useLayoutEffect(() => {
    const prev = liveTargetRef.current;
    if (
      prev.workRequestId !== linkedWorkRequestId ||
      prev.clientId !== clientId ||
      prev.taskId !== selectedTaskId ||
      prev.entity !== resolvedTargetEntity ||
      prev.file !== receiptFile ||
      prev.formSeed !== formSeed
    ) {
      targetGenerationRef.current += 1;
      liveTargetRef.current = {
        workRequestId: linkedWorkRequestId,
        clientId,
        taskId: selectedTaskId,
        entity: resolvedTargetEntity,
        file: receiptFile,
        formSeed,
        generation: targetGenerationRef.current,
      };
      setUploadedReceipt(null);
    }
  }, [linkedWorkRequestId, clientId, selectedTaskId, resolvedTargetEntity, receiptFile, formSeed]);

  useEffect(() => {
    const isClientLockedByPrefill = Boolean(prefill?.clientId || defaultClientId);
    const wrClientId = selectedWr?.clientId || selectedWr?.client_id;
    if (isOpen && linkedWorkRequestId && wrClientId && !isClientLockedByPrefill) {
      if (clientId !== wrClientId) {
        setClientId(wrClientId);
      }
    }
  }, [isOpen, linkedWorkRequestId, selectedWr, prefill?.clientId, defaultClientId, clientId]);

  const clientDisplayName = React.useMemo(() => {
    if (selectedWr) {
      return (
        selectedWr.clientName ||
        selectedWr.client_name ||
        clients.find((c) => c.id === (selectedWr.clientId || selectedWr.client_id))?.name ||
        ((selectedWr.clientId || selectedWr.client_id)
          ? `Client (${selectedWr.clientId || selectedWr.client_id})`
          : '')
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
    if (wrId !== linkedWorkRequestId) setUploadedReceipt(null);
    if (errors.linkedWorkRequestId) {
      setErrors((prev) => ({ ...prev, linkedWorkRequestId: '' }));
    }
    if (errors.selectedTaskId) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy.selectedTaskId;
        return copy;
      });
    }
    if (errors.receipt) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy.receipt;
        return copy;
      });
    }
    const isClientLockedByPrefill = Boolean(prefill?.clientId || defaultClientId);
    if (wrId) {
      const found = workRequests.find((wr) => wr.id === wrId);
      const wrClientId = found?.clientId || found?.client_id;
      if (wrClientId && !isClientLockedByPrefill) {
        setClientId(wrClientId);
      }
    } else if (!isClientLockedByPrefill) {
      setClientId('');
    }
  };

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
    } else {
      if (activeEntity === 'ALL') {
        const wrEntity = selectedWr?.entity;
        if (!wrEntity || (wrEntity !== 'ATA' && wrEntity !== 'LTA')) {
          newErrors.linkedWorkRequestId = 'Selected Work Request must belong to a specific ATA or LTA entity';
        }
      } else if (selectedWr?.entity && selectedWr.entity !== activeEntity) {
        newErrors.linkedWorkRequestId = `Selected work request belongs to ${selectedWr.entity}, but active session is ${activeEntity}`;
      }
    }

    if (!selectedTaskId.trim()) {
      newErrors.selectedTaskId = 'Linked task is required';
    } else if (isTaskBlocked) {
      newErrors.selectedTaskId =
        blockingMessage ||
        (isNoTasksBlocked
          ? 'This work request has no tasks — create one first'
          : "You're not assigned to any task on this work request. Ask the task owner or an Admin to add you.");
    } else {
      const trimmedTask = selectedTaskId.trim();
      if (!isTaskLocked && (tasksQuery.isLoading || (tasksQuery.isFetching && tasks.length === 0))) {
        newErrors.selectedTaskId = 'Tasks are still loading. Please wait.';
      } else if (tasks.length > 0) {
        const foundTask = tasks.find((t) => t.id === trimmedTask);
        if (!foundTask || !isTaskOfWorkRequest(foundTask, linkedWorkRequestId)) {
          newErrors.selectedTaskId = 'Selected task does not belong to the selected work request';
        } else if (!isAdmin && !isTaskAssignee(currentUser, foundTask)) {
          newErrors.selectedTaskId = 'You are not assigned to this task';
        }
      }
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
    setUploadedReceipt(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setErrors({});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || hasPendingCreate(pendingCreateKey)) return;
    if (!validate()) return;

    // Distinguish absent file selection from failed upload
    const hasReceipt = Boolean(receiptFile || uploadedReceipt);
    if (!hasReceipt) {
      setIsNoReceiptConfirmOpen(true);
      return;
    }

    await doSubmit(false);
  };

  const doSubmit = async (bypassReceipt: boolean) => {
    if (isSubmittingRef.current || hasPendingCreate(pendingCreateKey)) return;
    if (!validate()) return;
    isSubmittingRef.current = true;
    const currentAttemptId = ++attemptIdRef.current;

    const { isStale } = captureContext();
    const capturedTarget = { ...liveTargetRef.current };
    let creationStarted = false;

    // Upload, submission and error responses must belong to this exact form attempt.
    const isCurrent = () => {
      if (isStale()) return false;
      if (attemptIdRef.current !== currentAttemptId) return false;
      const live = liveTargetRef.current;
      return (
        live.generation === capturedTarget.generation &&
        live.workRequestId === capturedTarget.workRequestId &&
        live.clientId === capturedTarget.clientId &&
        live.taskId === capturedTarget.taskId &&
        live.entity === capturedTarget.entity &&
        live.file === capturedTarget.file
      );
    };

    let resultingS3Key: string | null = null;
    let resultingFilename: string | null = null;

    try {
      if (!bypassReceipt && (receiptFile || uploadedReceipt)) {
        // Target entity validation before any upload network call (C1, R1, R4)
        if (activeEntity === 'ALL') {
          if (!capturedTarget.workRequestId) {
            setErrors((prev) => ({ ...prev, linkedWorkRequestId: 'Please select a Work Request' }));
            return;
          }
          if (
            !capturedTarget.entity ||
            (capturedTarget.entity !== 'ATA' && capturedTarget.entity !== 'LTA')
          ) {
            setErrors((prev) => ({
              ...prev,
              receipt: 'Select a specific ATA or LTA entity for this receipt upload.',
            }));
            return;
          }
        } else if (selectedWr?.entity && selectedWr.entity !== activeEntity) {
          setErrors((prev) => ({
            ...prev,
            linkedWorkRequestId: `Selected work request belongs to ${selectedWr.entity}, but active session is ${activeEntity}`,
          }));
          return;
        }

        const canReuseReceipt =
          uploadedReceipt !== null &&
          receiptFile !== null &&
          uploadedReceipt.file === receiptFile &&
          uploadedReceipt.targetWorkRequestId === capturedTarget.workRequestId &&
          uploadedReceipt.targetClientId === capturedTarget.clientId &&
          (uploadedReceipt as { targetTaskId?: string | null }).targetTaskId === capturedTarget.taskId &&
          uploadedReceipt.targetEntity === capturedTarget.entity &&
          uploadedReceipt.targetGeneration === capturedTarget.generation;

        if (canReuseReceipt) {
          // Reuse already uploaded and completed receipt reservation without re-uploading
          resultingS3Key = uploadedReceipt.receiptS3Key;
          resultingFilename = uploadedReceipt.receiptFilename;
        } else if (receiptFile) {
          // Validate MIME and size before upload
          if (!isValidReceiptMimeType(receiptFile.type, receiptFile.name)) {
            setErrors((prev) => ({ ...prev, receipt: 'Only PDF, PNG, and JPEG files are allowed' }));
            return;
          }
          if (receiptFile.size > 10 * 1024 * 1024) {
            setErrors((prev) => ({ ...prev, receipt: 'File size cannot exceed 10 MiB' }));
            return;
          }

          setIsUploadingReceipt(true);
          try {
            if (!isCurrent()) {
              return;
            }

            // Check assignment immediately before receipt upload
            if (capturedTarget.taskId && !isAdmin) {
              const preTask = tasks.find((t) => t.id === capturedTarget.taskId);
              if (!preTask || !isTaskAssignee(currentUser, preTask)) {
                setErrors((prev) => ({ ...prev, selectedTaskId: 'You are not assigned to this task' }));
                return;
              }
            }

            const uploadResult = await uploadReceiptFile(
              receiptFile,
              isCurrent,
              capturedTarget.entity ? { entity: capturedTarget.entity } : undefined
            );

            if (!isCurrent()) {
              return;
            }

            // Ensure assignment was not revoked during async upload before continuing with receipt
            if (capturedTarget.taskId) {
              const liveUser = useSessionStore.getState().user;
              const liveIsAdmin = isRoleAdmin(liveUser);
              if (!liveIsAdmin) {
                const exactKey = operationsKeys.tasks(capturedTarget.workRequestId, capturedTarget.entity);
                const qState = queryClient.getQueryState<Task[]>(exactKey);
                if (!qState || qState.status !== 'success' || qState.isInvalidated || !Array.isArray(qState.data)) {
                  setErrors((prev) => ({
                    ...prev,
                    selectedTaskId: 'Task assignment could not be verified. Please try again.',
                  }));
                  return;
                }
                const liveTask = qState.data.find((t) => t.id === capturedTarget.taskId);
                if (!liveTask || !isTaskAssignee(liveUser, liveTask)) {
                  setErrors((prev) => ({
                    ...prev,
                    selectedTaskId: 'You are not assigned to this task',
                  }));
                  return;
                }
              }
            }

            setUploadedReceipt({
              file: receiptFile,
              receiptS3Key: uploadResult.receiptS3Key,
              receiptFilename: uploadResult.receiptFilename,
              targetWorkRequestId: capturedTarget.workRequestId,
              targetClientId: capturedTarget.clientId,
              targetTaskId: capturedTarget.taskId,
              targetEntity: capturedTarget.entity!,
              targetGeneration: capturedTarget.generation,
            });
            resultingS3Key = uploadResult.receiptS3Key;
            resultingFilename = uploadResult.receiptFilename;
          } catch (err: unknown) {
            if (!isCurrent()) {
              return;
            }
            setIsUploadingReceipt(false);
            setUploadedReceipt(null);
            setErrors((prev) => ({
              ...prev,
              receipt: classifyReceiptUploadError(err),
            }));
            return; // ABORT creation!
          } finally {
            if (attemptIdRef.current === currentAttemptId) {
              setIsUploadingReceipt(false);
            }
          }
        }
      }

      if (!isCurrent()) {
        return;
      }

      // Live assignment & eligibility check immediately before create after async receipt upload
      if (capturedTarget.taskId) {
        const liveUser = useSessionStore.getState().user;
        const liveIsAdmin = isRoleAdmin(liveUser);
        if (!liveIsAdmin) {
          const exactKey = operationsKeys.tasks(capturedTarget.workRequestId, capturedTarget.entity);
          const queryState = queryClient.getQueryState<Task[]>(exactKey);
          if (!queryState || queryState.status !== 'success' || queryState.isInvalidated || !Array.isArray(queryState.data)) {
            setErrors((prev) => ({
              ...prev,
              selectedTaskId: 'Task assignment could not be verified. Please try again.',
            }));
            return;
          }
          const liveTask = queryState.data.find((t) => t.id === capturedTarget.taskId);
          if (!liveTask || !isTaskOfWorkRequest(liveTask, capturedTarget.workRequestId)) {
            setErrors((prev) => ({
              ...prev,
              selectedTaskId: 'Selected task is no longer available in this work request',
            }));
            return;
          }
          if (!isTaskAssignee(liveUser, liveTask)) {
            setErrors((prev) => ({
              ...prev,
              selectedTaskId: 'You are not assigned to this task',
            }));
            return;
          }
        }
      }

      const effectiveCategory =
        category === 'Other' && customCategory.trim() ? customCategory.trim() : category;
      const payload: CreateDisbursementInput = {
        category: effectiveCategory,
        description: description.trim(),
        amount: parseFloat(amount),
        fundSource,
        linkedWorkRequestId: capturedTarget.workRequestId.trim(),
        clientId: capturedTarget.clientId ? capturedTarget.clientId.trim() : null,
        linkedTaskId: capturedTarget.taskId ? capturedTarget.taskId.trim() : null,
        employeeId: currentUser?.id || null, // Locked to session user
        dueDate: dueDate ? dueDate : null,
        notes: notes.trim() ? notes.trim() : null,
        receiptS3Key: resultingS3Key,
        receiptFilename: resultingS3Key !== null ? resultingFilename : null,
      };

      creationStarted = true;
      markPendingCreate(pendingCreateKey, true);
      await createWithBlocking(
        payload,
        capturedTarget.entity ? { entity: capturedTarget.entity } : undefined
      );
      markPendingCreate(pendingCreateKey, false);
      if (!isCurrent()) return;
      resetForm();
      onClose();
      if (onSuccess) onSuccess();
    } catch (error) {
      if (creationStarted) {
        // A validation/permission conflict is a proven rejection. A network/5xx/timeout
        // may follow persistence; do not create again just because the response was lost.
        const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500;
        if (rejected) markPendingCreate(pendingCreateKey, false);
        if (!isStale()) setNeedsCreateReview(!rejected);

        const errCode = (error as { code?: string })?.code;
        if (errCode === 'TASK_REQUIRED') {
          setErrors((prev) => ({ ...prev, selectedTaskId: 'A valid linked task is required' }));
        } else if (errCode === 'TASK_WR_MISMATCH') {
          setErrors((prev) => ({ ...prev, selectedTaskId: 'Selected task does not belong to the selected work request' }));
        } else if (errCode === 'TASK_NOT_SELECTABLE') {
          setErrors((prev) => ({ ...prev, selectedTaskId: 'Selected task is not selectable' }));
        } else if (errCode === 'TASK_ASSIGNMENT_REQUIRED' || errCode === 'FORBIDDEN_TASK_ATTACHMENT') {
          setErrors((prev) => ({ ...prev, selectedTaskId: 'You are not assigned to this task' }));
        }

        const isMismatch =
          error instanceof ApiError &&
          (error.status === 403 || error.status === 400) &&
          (error.code === 'RECEIPT_RESERVATION_MISMATCH' ||
            error.code === 'UPLOAD_RESERVATION_MISMATCH' ||
            error.code === 'RECEIPT_ENTITY_REQUIRED' ||
            /receipt/i.test(error.message));

        // A response from an earlier form must not change the current attachment.
        if (isMismatch && isCurrent()) {
          setUploadedReceipt(null);
          setErrors((prev) => ({
            ...prev,
            receipt:
              error instanceof ApiError && error.message
                ? `${error.message} Please re-upload the receipt for the selected work request.`
                : 'Receipt entity mismatch. Please re-upload your receipt for this Work Request.',
          }));
        }
      }
    } finally {
      if (attemptIdRef.current === currentAttemptId) {
        setIsUploadingReceipt(false);
        isSubmittingRef.current = false;
      }
    }
  };

  const isPrivilegedUser = Boolean(
    currentUser?.role === 'Admin' ||
    currentUser?.role === 'Accounting' ||
    currentUser?.departments?.includes('Accounting')
  );
  const modalTitle = isPrivilegedUser ? 'New Disbursement Voucher' : 'Request Disbursement Voucher';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[90vh] space-y-4 overflow-y-auto border p-6 border-border shadow-float rounded-[12px] bg-surface max-w-lg"
        data-testid="create-disbursement-modal"
        onPaste={(e) => {
          if (processClipboardData(e.clipboardData)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-ink">{modalTitle}</DialogTitle>
          <DialogDescription className="text-xs text-muted">
            Submit a new expense or reimbursement voucher. New vouchers enter Draft status awaiting
            administrative budget authorization.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          onSubmit={handleSubmit}
          className="space-y-4"
          data-testid="create-disbursement-form"
        >
          {needsCreateReview && (
            <div
              className="rounded-[6px] border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
              role="alert"
              data-testid="create-outcome-uncertain"
            >
              The previous request may already have created a voucher. Close this form and inspect
              your vouchers before submitting again. Changing the receipt does not make retrying
              safe.
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                data-testid="confirm-creation-inspected"
                onClick={() => {
                  markPendingCreate(pendingCreateKey, false);
                  setNeedsCreateReview(false);
                  setUploadedReceipt(null);
                }}
              >
                I checked my vouchers
              </Button>
            </div>
          )}

          {/* Work Request Dropdown (UAT2-12: eliminates manual WR-id input) */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">
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
                className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-canvas disabled:cursor-not-allowed"
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
              <span className="text-xs text-red-600 block" data-testid="error-work-request-id">
                {errors.linkedWorkRequestId}
              </span>
            )}
          </div>

          {/* Associated Client (Auto-Detected, Read-Only) & Linked Task */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">
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
                className="bg-canvas text-ink cursor-not-allowed text-xs disabled:opacity-80"
                data-testid="display-client-name"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">
                Linked Task <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedTaskId}
                onChange={(e) => {
                  setSelectedTaskId(e.target.value);
                  if (errors.selectedTaskId) {
                    setErrors((prev) => {
                      const copy = { ...prev };
                      delete copy.selectedTaskId;
                      return copy;
                    });
                  }
                }}
                disabled={isTaskLocked || !linkedWorkRequestId || isTaskBlocked}
                className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-canvas disabled:cursor-not-allowed"
                data-testid="select-work-request-task"
              >
                <option value="">
                  {!linkedWorkRequestId
                    ? 'Select a Work Request first...'
                    : 'Select a task...'}
                </option>
                {taskOptions.map((opt) => (
                  <option key={opt.id} value={opt.id} disabled={opt.disabled}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors.selectedTaskId && (
                <span className="text-xs text-red-600 block" data-testid="error-selected-task">
                  {errors.selectedTaskId}
                </span>
              )}
            </div>
          </div>

          <TaskBlockingAlert
            blockingReason={blockingReason}
            isNoTasksBlocked={isNoTasksBlocked}
            isNotAssignedBlocked={isNotAssignedBlocked}
            isPhaseOrPrereqBlocked={isPhaseOrPrereqBlocked}
            workRequestId={linkedWorkRequestId}
          />

          {/* Category & Fund Source */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">
                Category <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border focus:outline-none focus:ring-1 focus:ring-primary"
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
                <span className="text-xs text-red-600 block">{errors.category}</span>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">
                Fund Source <span className="text-red-500">*</span>
              </label>
              <select
                value={fundSource}
                onChange={(e) => setFundSource(e.target.value as FundSource)}
                className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border focus:outline-none focus:ring-1 focus:ring-primary"
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
              <label className="text-xs font-semibold text-ink">
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
                <span
                  className="text-xs tabular-nums text-red-600 block"
                  data-testid="error-amount"
                >
                  {errors.amount}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink">Due Date</label>
              <DateInput
                aria-label="Disbursement due date"
                type="date"
                value={dueDate}
                onValueChange={(value) => setDueDate(value)}
                data-testid="input-due-date"
              />
            </div>
          </div>

          {/* Locked Requester Display */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">Requester</label>
            <div
              className="w-full text-xs p-2.5 border rounded-[6px] bg-canvas text-ink border-border flex items-center justify-between"
              data-testid="requester-locked-display"
            >
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink">
                  {currentUser?.name || 'Authenticated Staff'}
                </span>
                <span className="text-xs text-muted">
                  ({currentUser?.email || 'session user'})
                </span>
              </div>
              <span className="text-xs font-semibold text-muted px-2 py-0.5 rounded bg-hover">
                Session Locked
              </span>
            </div>
            {/* Compatibility hidden select for test harness compatibility */}
            <select
              value={employeeId}
              onChange={(e) => {
                setEmployeeId(e.target.value);
                if (errors.employeeId) setErrors((prev) => ({ ...prev, employeeId: '' }));
              }}
              className="hidden"
              data-testid="select-employee"
            >
              <option value="">Select Employee...</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">
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
              className={`w-full text-xs p-2.5 border rounded-[6px] bg-surface text-ink resize-none focus:outline-none focus:ring-1 focus:ring-primary ${
                errors.description ? 'border-red-500' : 'border-border'
              }`}
              data-testid="textarea-description"
            />
            {errors.description && (
              <span className="text-xs text-red-600 block" data-testid="error-description">
                {errors.description}
              </span>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">
              Internal Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional internal remarks or references..."
              className="w-full text-xs p-2 border rounded-[6px] bg-surface border-border resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="textarea-notes"
            />
          </div>

          {/* Receipt Attachment */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink">Receipt Attachment</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
              disabled={isPending || isUploadingReceipt}
              className="hidden"
              onChange={(e) => {
                if (isPending || isUploadingReceipt) return;
                const file = e.target.files?.[0];
                if (file) {
                  handleSelectFile(file);
                }
              }}
              data-testid="receipt-file-input"
            />
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={(e) => {
                if (processClipboardData(e.clipboardData)) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              onClick={() => {
                if (isPending || isUploadingReceipt) return;
                if (!receiptFile && !receiptFilename) {
                  fileInputRef.current?.click();
                }
              }}
              className={`border-2 border-dashed rounded-[6px] p-4 text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-primary bg-canvas'
                  : 'border-border hover:border-border bg-canvas/50'
              }`}
              data-testid="receipt-dropzone"
            >
              {receiptFile || receiptFilename ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 truncate">
                    <FileText className="h-4 w-4 text-ink shrink-0" />
                    <span
                      className="text-xs font-medium text-ink truncate"
                      data-testid="receipt-attached-filename"
                    >
                      {receiptFile?.name || receiptFilename}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending || isUploadingReceipt}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isPending || isUploadingReceipt) return;
                      setReceiptFile(null);
                      setReceiptFilename('');
                      setUploadedReceipt(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      setErrors((prev) => {
                        const copy = { ...prev };
                        delete copy.receipt;
                        return copy;
                      });
                    }}
                    className="h-6 w-6 p-0 text-muted hover:text-muted cursor-pointer"
                    data-testid="remove-receipt-btn"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-2">
                  <Upload className="h-6 w-6 text-muted mb-1" />
                  <p className="text-xs font-medium text-ink">
                    Drag and drop receipt here, or browse
                  </p>
                  <p className="text-xs text-muted mt-0.5">PDF, PNG, JPG up to 10MB</p>
                </div>
              )}
            </div>
            {errors.receipt && (
              <span className="text-xs text-red-600 block mt-1" data-testid="error-receipt">
                {errors.receipt}
              </span>
            )}
          </div>

          <DialogFooter className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isPending || isUploadingReceipt || needsCreateReview}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isPending || isUploadingReceipt || needsCreateReview || isTaskBlocked}
              data-testid="submit-create-disbursement-btn"
              className="text-xs font-semibold bg-primary hover:bg-primary-hover text-inverse shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploadingReceipt
                ? 'Uploading Receipt...'
                : isPending
                  ? 'Creating...'
                  : 'Create Disbursement'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* In-App Non-Blocking Confirmation for Missing Supporting Document */}
      <Dialog open={isNoReceiptConfirmOpen} onOpenChange={setIsNoReceiptConfirmOpen}>
        <DialogContent
          className="border-border border p-6 shadow-float rounded-[12px] bg-surface space-y-3 max-w-md"
          data-testid="no-receipt-confirm-dialog"
        >
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-ink flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              <span>No Supporting Document Attached</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted">
              No supporting document attached. Create this voucher anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2 gap-2 flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsNoReceiptConfirmOpen(false)}
              className="text-xs cursor-pointer"
              data-testid="btn-cancel-no-receipt"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setIsNoReceiptConfirmOpen(false);
                doSubmit(true);
              }}
              className="text-xs bg-primary hover:bg-primary-hover text-inverse shadow-2xs font-medium cursor-pointer"
              data-testid="btn-confirm-no-receipt"
            >
              Create Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
