/**
 * Document Upload Modal
 *
 * Implements client-side 50 MB file size guard and 3-step pre-signed URL upload pipeline
 * or direct external URL registration.
 */

import React, { useState, useRef } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload,
  Link as LinkIcon,
  FileText,
  AlertCircle,
  Briefcase,
  X,
} from 'lucide-react';
import {
  DOCUMENT_CATEGORIES,
  MAX_FILE_SIZE_BYTES,
} from '../api/schemas';
import type {
  DmsDocument,
  DocumentCategory,
  CreateDocumentInput,
} from '../api/types';
import { CATEGORY_LABELS } from '../constants';
import { formatFileSize } from '../utils/formatters';
import { parseExternalUrl } from '../utils/googleDrive';
import { useUploadDocument } from '../api/useDocuments';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import { isUserAdmin } from '@/features/operations/lib/taskScope';
import { useWorkRequests } from '@/features/operations/api/useWorkRequests';
import { useSelectableTasks } from '@/features/operations/hooks/useSelectableTasks';
import { TaskBlockingAlert } from '@/features/operations/components/TaskBlockingAlert';
import type { WorkRequest } from '@/features/operations/api/types';

export interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (doc: DmsDocument) => void;
  defaultWorkRequestId?: string;
  defaultClientId?: string;
  defaultTaskId?: string;
  allowTaskLinking?: boolean;
}


export function DocumentUploadModal({
  isOpen,
  onClose,
  onSuccess,
  defaultWorkRequestId,
  defaultClientId,
  defaultTaskId,
  allowTaskLinking,
}: DocumentUploadModalProps) {
  const [mode, setMode] = useState<'file' | 'external'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [category, setCategory] = useState<DocumentCategory>('Others');
  const [documentType, setDocumentType] = useState('');
  const [description, setDescription] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [workRequestId, setWorkRequestId] = useState(defaultWorkRequestId || '');
  const [clientId, setClientId] = useState(defaultClientId || '');
  const [linkedTaskId, setLinkedTaskId] = useState(defaultTaskId || '');
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);

  const currentUser = useSessionStore((state) => state.user);
  const permissions = useSessionStore((state) => state.permissions);
  const activeEntity = useSessionStore((state) => state.activeEntity);

  const isAllowedUser = Boolean(
    allowTaskLinking ??
      (currentUser &&
        (isUserAdmin(currentUser) ||
          hasPermission(permissions, 'workflow:view') ||
          hasPermission(permissions, 'workflow:task_upload') ||
          hasPermission(permissions, 'workflow:edit')))
  );

  React.useEffect(() => {
    if (isOpen) {
      setLinkedTaskId(defaultTaskId || '');
      setWorkRequestId(defaultWorkRequestId || '');
      setClientId(defaultClientId || '');
      setTaskError(null);
    }
  }, [isOpen, defaultTaskId, defaultWorkRequestId, defaultClientId]);

  // Load active work requests with embedded tasks for allowed users
  const { data: rawWorkRequests } = useWorkRequests(
    { archived: false, includeTasks: true, limit: 200 },
    { enabled: isOpen && isAllowedUser }
  );

  const workRequests: WorkRequest[] = React.useMemo(() => {
    if (!rawWorkRequests) return [];
    const list = Array.isArray(rawWorkRequests) ? rawWorkRequests : rawWorkRequests.data ?? [];
    return list.filter((wr) => {
      if (wr.archived) return false;
      if (activeEntity && activeEntity !== 'ALL') {
        const wrEntity = (wr as { entity_code?: string; entity?: string }).entity_code || wr.entity;
        if (wrEntity && wrEntity !== activeEntity) return false;
      }
      return true;
    });
  }, [rawWorkRequests, activeEntity]);

  const isTaskLocked = Boolean(defaultTaskId);

  const selectedWorkRequest = React.useMemo(
    () => workRequests.find((w) => w.id === workRequestId),
    [workRequests, workRequestId]
  );

  const {
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
    recordType: 'document',
    isOpen: isOpen && isAllowedUser,
    entity: activeEntity !== 'ALL' ? (activeEntity as 'ATA' | 'LTA') : undefined,
    currentTaskId: defaultTaskId || null,
    selectedTaskId: linkedTaskId,
    onSelectTask: (taskId) => {
      setLinkedTaskId(taskId);
      setTaskError(null);
    },
    isTaskLocked,
  });

  const handleWorkRequestChange = (val: string) => {
    const nextWrId = val === '__none__' ? '' : val;
    setWorkRequestId(nextWrId);
    setLinkedTaskId('');
    setTaskError(null);
    if (nextWrId) {
      const parentWr = workRequests.find((w) => w.id === nextWrId);
      if (parentWr?.clientId || parentWr?.client_id) {
        setClientId(parentWr.clientId || parentWr.client_id || '');
      }
    } else {
      setClientId('');
    }
  };

  const handleTaskChange = (val: string) => {
    const nextTaskId = val === '__none__' ? '' : val;
    setLinkedTaskId(nextTaskId);
    setTaskError(null);
  };

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadMutation = useUploadDocument();

  const resetForm = () => {
    setSelectedFile(null);
    setFileName('');
    setCategory('Others');
    setDocumentType('');
    setDescription('');
    setExternalUrl('');
    setWorkRequestId(defaultWorkRequestId || '');
    setClientId(defaultClientId || '');
    setLinkedTaskId(defaultTaskId || '');
    setSizeError(null);
    setTaskError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSizeError(
        `File size (${formatFileSize(file.size)}) exceeds maximum allowed limit of 50 MB (52,428,800 bytes).`
      );
      setSelectedFile(null);
      setFileName('');
      return;
    }

    setSizeError(null);
    setSelectedFile(file);
    setFileName(file.name);
  };

  const effectiveWrId = workRequestId.trim() || defaultWorkRequestId?.trim() || '';
  const effectiveTaskId = linkedTaskId.trim() || defaultTaskId?.trim() || '';
  const canSubmit = Boolean(effectiveWrId && effectiveTaskId && !isTaskBlocked);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!effectiveWrId) {
      setTaskError('Work request is required');
      return;
    }

    if (!effectiveTaskId) {
      setTaskError('A valid linked task is required');
      return;
    }

    if (isTaskBlocked) {
      setTaskError(
        blockingMessage ||
          (isNoTasksBlocked
            ? 'This work request has no tasks — create one first'
            : "You're not assigned to any task on this work request. Ask the task owner or an Admin to add you.")
      );
      return;
    }

    if (mode === 'file') {
      if (!selectedFile) return;

      const metadata: Partial<CreateDocumentInput> = {
        fileName: fileName.trim() || selectedFile.name,
        originalName: selectedFile.name,
        category,
        documentType: documentType.trim() || undefined,
        description: description.trim() || undefined,
        workRequestId: effectiveWrId,
        clientId: clientId.trim() || defaultClientId?.trim() || undefined,
        linkedTaskId: effectiveTaskId,
      };

      try {
        const uploadedDoc = await uploadMutation.mutateAsync({
          file: selectedFile,
          metadata,
        });
        if (onSuccess) onSuccess(uploadedDoc);
        handleClose();
      } catch (err: unknown) {
        const apiErr = err as { code?: string; message?: string };
        if (apiErr?.code === 'TASK_REQUIRED') {
          setTaskError('A valid linked task is required');
        } else if (apiErr?.code === 'TASK_WR_MISMATCH') {
          setTaskError('Task does not belong to work request');
        } else if (apiErr?.code === 'TASK_NOT_SELECTABLE') {
          setTaskError('Selected task is not selectable');
        } else if (
          apiErr?.code === 'TASK_ASSIGNMENT_REQUIRED' ||
          apiErr?.code === 'FORBIDDEN_TASK_ATTACHMENT'
        ) {
          setTaskError('You must be assigned to this task');
        }
      }
    } else {
      if (!externalUrl.trim() || !fileName.trim()) return;

      const parsed = parseExternalUrl(externalUrl, fileName);
      // Create dummy 0-byte file object with detected MIME type for external URL payload flow
      const dummyFile = new File([''], fileName.trim(), { type: parsed.detectedMimeType });
      const metadata: Partial<CreateDocumentInput> = {
        fileName: fileName.trim(),
        originalName: fileName.trim(),
        externalUrl: parsed.originalUrl || externalUrl.trim(),
        category,
        contentType: parsed.detectedMimeType,
        documentType: documentType.trim() || undefined,
        description: description.trim() || undefined,
        workRequestId: effectiveWrId,
        clientId: clientId.trim() || defaultClientId?.trim() || undefined,
        linkedTaskId: effectiveTaskId,
      };

      try {
        const createdDoc = await uploadMutation.mutateAsync({
          file: dummyFile,
          metadata,
        });
        if (onSuccess) onSuccess(createdDoc);
        handleClose();
      } catch (err: unknown) {
        const apiErr = err as { code?: string; message?: string };
        if (apiErr?.code === 'TASK_REQUIRED') {
          setTaskError('A valid linked task is required');
        } else if (apiErr?.code === 'TASK_WR_MISMATCH') {
          setTaskError('Task does not belong to work request');
        } else if (apiErr?.code === 'TASK_NOT_SELECTABLE') {
          setTaskError('Selected task is not selectable');
        } else if (
          apiErr?.code === 'TASK_ASSIGNMENT_REQUIRED' ||
          apiErr?.code === 'FORBIDDEN_TASK_ATTACHMENT'
        ) {
          setTaskError('You must be assigned to this task');
        }
      }
    }
  };

  const isSubmitDisabled =
    uploadMutation.isPending ||
    (mode === 'file' ? !selectedFile || Boolean(sizeError) : !externalUrl.trim() || !fileName.trim()) ||
    !canSubmit;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="bg-[#FFFFFF] shadow-float border-[#E2E8F0] rounded-[12px] max-w-lg border" data-testid="document-upload-modal">
        <DialogHeader>
          <DialogTitle>Upload Document</DialogTitle>
          <DialogDescription>
            Add a new document to the Document Management System with compliance categorization.
          </DialogDescription>
        </DialogHeader>

        {/* Mode Selector */}
        <div className="flex border-b border-[#E2E8F0] -mx-6 px-6 pb-3 gap-4 text-sm font-medium">
          <button
            type="button"
            onClick={() => {
              setMode('file');
              setSizeError(null);
            }}
            className={`flex items-center gap-2 pb-1 border-b-2 transition-colors ${
              mode === 'file'
                ? 'border-[#E2E8F0] text-[#1E293B]'
                : 'border-transparent text-[#475569] hover:text-[#1E293B]'
            }`}
            data-testid="mode-tab-file"
          >
            <Upload className="h-4 w-4" />
            File Upload
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('external');
              setSizeError(null);
            }}
            className={`flex items-center gap-2 pb-1 border-b-2 transition-colors ${
              mode === 'external'
                ? 'border-[#E2E8F0] text-[#1E293B]'
                : 'border-transparent text-[#475569] hover:text-[#1E293B]'
            }`}
            data-testid="mode-tab-external"
          >
            <LinkIcon className="h-4 w-4" />
            External Link
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {mode === 'file' ? (
            /* File Picker / Dropzone */
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                data-testid="document-file-input"
              />

              {!selectedFile ? (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#E2E8F0] hover:border-[#E2E8F0] rounded-[6px] p-6 text-center cursor-pointer transition-colors bg-[#FFFFFF]"
                  data-testid="file-dropzone"
                >
                  <Upload className="h-8 w-8 mx-auto text-[#475569] mb-2" />
                  <p className="text-sm font-medium text-[#1E293B]">
                    Click to select a document file
                  </p>
                  <p className="text-xs text-[#475569] mt-1">
                    PDF, Word, Excel, images, or text documents up to 50 MB
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]">
                  <div className="flex items-center gap-3 truncate">
                    <FileText className="h-6 w-6 text-[#1E293B] shrink-0" />
                    <div className="truncate">
                      <p className="text-sm font-medium text-[#1E293B] truncate">
                        {selectedFile.name}
                      </p>
                      <p className="text-xs text-[#475569]">
                        {formatFileSize(selectedFile.size)} • {selectedFile.type || 'binary'}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedFile(null);
                      setFileName('');
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="h-8 w-8 p-0 text-[#475569] hover:text-[#1E293B]"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* 50 MB Limit Guard Error */}
              {sizeError && (
                <div
                  className="flex items-start gap-2 p-3 text-xs text-rose-700 bg-rose-50 border-rose-200 rounded-[6px]"
                  data-testid="file-size-error-banner"
                >
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{sizeError}</span>
                </div>
              )}
            </div>
          ) : (
            /* External URL Input */
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#1E293B]">
                External URL <span className="text-rose-500">*</span>
              </label>
              <Input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://sec.gov.ph/verification/doc-12345"
                required
                data-testid="external-url-input"
              />
              <p className="text-xs text-[#475569] mt-1" data-testid="external-url-gdrive-hint">
                Tip for Google Drive: Ensure the link is shared as &quot;Anyone with the link can view&quot; so team members can preview it without authentication prompts.
              </p>
            </div>
          )}

          {/* Document / File Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Document Display Name <span className="text-rose-500">*</span>
            </label>
            <Input
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="e.g. 2026 Amended Articles of Incorporation.pdf"
              required
              data-testid="document-name-input"
            />
          </div>

          {/* Category & Document Type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#1E293B]">
                Category <span className="text-rose-500">*</span>
              </label>
              <Select
                value={category}
                onValueChange={(val) => setCategory(val as DocumentCategory)}
              >
                <SelectTrigger data-testid="upload-category-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat] || cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#1E293B]">
                Document Type
              </label>
              <Input
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="e.g. Tax Return, Board Resolution"
                data-testid="document-type-input"
              />
            </div>
          </div>

          {/* Work Request & Task Link (for allowed users) */}
          {isAllowedUser && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-[8px] border-[#E2E8F0] bg-[#FFFFFF]/50">
              <div className="space-y-1.5">
                <label
                  htmlFor="workRequest"
                  className="text-xs font-medium text-[#1E293B] flex items-center gap-1"
                >
                  <Briefcase className="h-3.5 w-3.5 text-[#475569]" />
                  Work Request <span className="text-rose-500">*</span>
                </label>
                <Select
                  value={workRequestId}
                  onValueChange={handleWorkRequestChange}
                  disabled={Boolean(defaultWorkRequestId)}
                >
                  <SelectTrigger
                    id="workRequest"
                    className="text-xs bg-white"
                    data-testid="work-request-select"
                  >
                    <SelectValue placeholder="Link to work request..." />
                  </SelectTrigger>
                  <SelectContent>
                    {workRequests.map((wr) => {
                      const wrNum = (wr as { work_request_number?: string; workRequestNumber?: string }).work_request_number || (wr as { work_request_number?: string; workRequestNumber?: string }).workRequestNumber;
                      const titlePart = (wr as { tracking_number?: string }).tracking_number || wr.title;
                      const clientPart = wr.clientName || wr.client_name ? ` — ${wr.clientName || wr.client_name}` : '';
                      const displayTitle = wrNum ? `${wrNum} · ${titlePart}${clientPart}` : `${titlePart}${clientPart}`;
                      return (
                        <SelectItem key={wr.id} value={wr.id}>
                          {displayTitle}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="workRequestTask"
                  className="text-xs font-medium text-[#1E293B] flex items-center gap-1"
                >
                  <Briefcase className="h-3.5 w-3.5 text-[#475569]" />
                  Linked Task <span className="text-rose-500">*</span>
                </label>
                <Select
                  value={linkedTaskId}
                  onValueChange={handleTaskChange}
                  disabled={Boolean(defaultTaskId) || !workRequestId || isTaskBlocked}
                >
                  <SelectTrigger
                    id="workRequestTask"
                    className="text-xs bg-white"
                    data-testid="work-request-task-select"
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
                {taskError && (
                  <p className="text-xs text-rose-600 flex items-center gap-1" data-testid="error-document-task">
                    <AlertCircle className="h-3 w-3" />
                    {taskError}
                  </p>
                )}
              </div>
            </div>
          )}

          {isAllowedUser && (
            <TaskBlockingAlert
              blockingReason={blockingReason}
              isNoTasksBlocked={isNoTasksBlocked}
              isNotAssignedBlocked={isNotAssignedBlocked}
              isPhaseOrPrereqBlocked={isPhaseOrPrereqBlocked}
              workRequestId={workRequestId}
            />
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#1E293B]">
              Description (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes, compliance references, or custody notes..."
              rows={2}
              className="w-full text-sm rounded-[8px] border-[#E2E8F0] bg-transparent p-2 focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
              data-testid="document-description-input"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={uploadMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitDisabled}
              className="bg-[#1D4ED8] hover:bg-[#1E40AF] text-white shadow-2xs"
              data-testid="upload-submit-button"
            >
              {uploadMutation.isPending ? 'Uploading...' : 'Confirm Upload'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
