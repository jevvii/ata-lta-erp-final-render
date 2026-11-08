import { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Upload, Link as LinkIcon, Trash2 } from 'lucide-react';
import { parseExternalUrl } from '@/features/documents/utils/googleDrive';
import { useSessionStore } from '@/lib/session';
import { apiRequest } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import {
  useUpdateDisbursement,
  uploadReceiptFile,
  isValidReceiptMimeType,
} from '../api/useDisbursements';
import { disbursementKeys } from '../api/queryKeys';
import { isConcurrencyConflictError } from '@/components/common/ConflictResolutionModal';
import { useBlockingModalStore } from '@/features/operations/components/BlockingActionModal';
import {
  getDisbursementPrintDetails,
  type DisbursementPrintDetails,
} from '@/lib/disbursementDocument';
import { useInvoices } from '@/features/billing/api/useInvoices';
import { useTransmittals } from '@/features/transmittals/api/useTransmittals';
import type { Disbursement, FundSource, UpdateDisbursementInput } from '../api/types';
import { useLiveModalContext } from '../lib/useLiveModalContext';

const printFields: Array<[keyof DisbursementPrintDetails, string]> = [
  ['requesterName', 'Printed requester name'],
  ['referenceNumber', 'Printed reference number'],
  ['submittedDate', 'Printed submission date'],
  ['workRequestName', 'Printed work request'],
  ['paymentDate', 'Printed payment date'],
  ['paymentMethod', 'Printed payment method'],
  ['paymentReference', 'Printed check / reference'],
  ['paymentBank', 'Printed bank / branch'],
  ['preparedBy', 'Prepared by'],
  ['approvedBy', 'Approved by'],
  ['releasedBy', 'Released by'],
];
export function DisbursementEditModal({
  disbursement,
  isOpen,
  onClose,
  inline = false,
}: {
  disbursement: Disbursement;
  isOpen: boolean;
  onClose: () => void;
  inline?: boolean;
}) {
  const currentUser = useSessionStore((s) => s.user);
  const isAdmin = currentUser?.role === 'Admin';
  const isAccounting =
    currentUser?.role === 'Accounting' || Boolean(currentUser?.departments?.includes('Accounting'));
  const isDocumentation =
    currentUser?.role === 'Documentation' || Boolean(currentUser?.departments?.includes('Documentation'));
  const isOwner =
    Boolean(currentUser?.id) &&
    (disbursement.created_by === currentUser?.id ||
      disbursement.createdBy === currentUser?.id ||
      disbursement.requested_by === currentUser?.id ||
      disbursement.requestedBy === currentUser?.id);

  const isLifecycleV2 = disbursement.lifecycle_version === 2;
  const isValidPositiveVersion =
    typeof disbursement.version === 'number' &&
    Number.isInteger(disbursement.version) &&
    disbursement.version > 0;
  const isDraft = disbursement.status === 'Draft';
  const isFinancialEditable = isLifecycleV2 && isDraft;
  const canEditLinks =
    isLifecycleV2 &&
    disbursement.status !== 'Rejected' &&
    disbursement.status !== 'Cancelled' &&
    (isAdmin || isAccounting || isDocumentation || isOwner);

  // Requesters can edit their own Draft; Admin and Accounting can correct an authorized Draft.
  // Admin can edit financial fields if isFinancialEditable, OR edit print-only fields on other saved stages.
  // Post-Draft link attaching (Q4): Admin, Accounting, Documentation, or Owner can update linkedInvoiceId/linkedTransmittalId.
  const canEdit =
    !disbursement.archived &&
    isValidPositiveVersion &&
    (isAdmin || canEditLinks || ((isOwner || isAccounting) && isFinancialEditable));

  const { captureContext, contextKey } = useLiveModalContext({
    isOpen,
    disbursementId: disbursement.id,
    version: disbursement.version,
  });

  const { updateWithBlocking } = useUpdateDisbursement();
  const queryClient = useQueryClient();
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [fundSource, setFundSource] = useState<FundSource>('Firm Fund');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [linkedInvoiceId, setLinkedInvoiceId] = useState('');
  const [linkedTransmittalId, setLinkedTransmittalId] = useState('');
  const [receiptMode, setReceiptMode] = useState<'file' | 'link'>('file');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptFilename, setReceiptFilename] = useState<string>('');
  const [externalUrl, setExternalUrl] = useState<string>('');
  const [isReceiptCleared, setIsReceiptCleared] = useState(false);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [printDetails, setPrintDetails] = useState<DisbursementPrintDetails>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const isSubmittingRef = useRef(false);
  useEffect(() => {
    isSubmittingRef.current = false;
    setSaving(false);
  }, [contextKey]);

  const loadedContext = useRef<string | null>(null);
  const formVersion = useRef(disbursement.version);
  useEffect(() => {
    if (!isOpen) {
      loadedContext.current = null;
      return;
    }
    if (loadedContext.current === contextKey) return;
    loadedContext.current = contextKey;
    formVersion.current = disbursement.version;
    setCategory(disbursement.category);
    setDescription(disbursement.description);
    setAmount(String(disbursement.amount));
    setFundSource(disbursement.fund_source || disbursement.fundSource || 'Firm Fund');
    setDueDate((disbursement.due_date || disbursement.dueDate || '').slice(0, 10));
    setNotes(disbursement.notes || '');
    setLinkedInvoiceId(disbursement.linked_invoice_id || disbursement.linkedInvoiceId || '');
    setLinkedTransmittalId(
      disbursement.linked_transmittal_id || disbursement.linkedTransmittalId || ''
    );
    const currentS3Key = disbursement.receipt_s3_key || disbursement.receiptS3Key || '';
    const currentExternalUrl =
      disbursement.external_url ||
      disbursement.externalUrl ||
      (/^https?:\/\//i.test(currentS3Key) ? currentS3Key : '');
    const currentFilename = disbursement.receipt_filename || disbursement.receiptFilename || '';

    if (currentExternalUrl) {
      setReceiptMode('link');
      setExternalUrl(currentExternalUrl);
    } else {
      setReceiptMode('file');
      setExternalUrl('');
    }
    setReceiptFile(null);
    setReceiptFilename(currentFilename);
    setIsReceiptCleared(false);
    setIsUploadingReceipt(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPrintDetails(getDisbursementPrintDetails(disbursement));
    setError('');
    setConflict(false);
  }, [isOpen, disbursement, contextKey]);

  useEffect(() => {
    if (!isOpen || !canEdit) return;

    const handlePaste = (e: ClipboardEvent) => {
      if (saving || isUploadingReceipt) return;

      const clipboardData = e.clipboardData;
      if (!clipboardData) return;

      let imageFile: File | null = null;
      const files = clipboardData.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file && file.type.startsWith('image/')) {
            imageFile = file;
            break;
          }
        }
      }

      if (!imageFile && clipboardData.items) {
        for (let i = 0; i < clipboardData.items.length; i++) {
          const item = clipboardData.items[i];
          if (item && item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            if (blob) {
              imageFile = blob;
              break;
            }
          }
        }
      }

      if (imageFile) {
        e.preventDefault();
        e.stopPropagation();

        const ext = imageFile.type === 'image/jpeg' ? 'jpg' : 'png';
        const rawName = imageFile.name;
        const finalName =
          rawName && rawName !== 'image.png' && rawName !== 'blob'
            ? rawName
            : `clipboard-receipt-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString().slice(-4)}.${ext}`;

        const namedFile =
          imageFile.name === finalName
            ? imageFile
            : new File([imageFile], finalName, { type: imageFile.type || 'image/png' });

        if (!isValidReceiptMimeType(namedFile.type, namedFile.name)) {
          setError('Only PDF, PNG, and JPEG files are allowed');
          return;
        }
        if (namedFile.size > 10 * 1024 * 1024) {
          setError('File size cannot exceed 10 MiB');
          return;
        }

        setReceiptFile(namedFile);
        setReceiptFilename(namedFile.name);
        setError('');
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, [isOpen, canEdit, saving, isUploadingReceipt]);

  const handleClearReceipt = () => {
    setReceiptFile(null);
    setReceiptFilename('');
    setExternalUrl('');
    setIsReceiptCleared(true);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const wrId = disbursement.linked_work_request_id || disbursement.linkedWorkRequestId || undefined;
  const isValidWrUuid = Boolean(
    wrId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(wrId.trim())
  );
  const { data: wrInvoicesData } = useInvoices(
    { workRequestId: wrId, archived: false, limit: 100 },
    { enabled: isOpen && canEdit && isValidWrUuid }
  );
  const availableInvoices = (
    Array.isArray(wrInvoicesData?.data) ? wrInvoicesData.data : []
  ).filter(
    (inv) =>
      !inv.archived &&
      inv.status !== 'Cancelled' &&
      (!inv.work_request_id || inv.work_request_id === wrId)
  );

  const { data: wrTransmittalsData } = useTransmittals(
    { workRequestId: wrId, archived: false, limit: 100 },
    { enabled: isOpen && canEdit && isValidWrUuid }
  );
  const availableTransmittals = (
    Array.isArray(wrTransmittalsData?.data) ? wrTransmittalsData.data : []
  ).filter(
    (tr) =>
      !tr.archived &&
      tr.status !== 'Cancelled' &&
      (!(tr.work_request_id || tr.workRequestId) ||
        (tr.work_request_id || tr.workRequestId) === wrId)
  );

  if (!isOpen || !canEdit) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    if (!isValidPositiveVersion) {
      setError('Voucher version metadata is missing or invalid.');
      return;
    }

    if (isFinancialEditable) {
      const total = Math.round(Number(amount) * 100) / 100;
      if (
        !amount.trim() ||
        !Number.isFinite(total) ||
        total <= 0 ||
        !category.trim() ||
        !description.trim()
      ) {
        setError('Enter a category, description, and an amount greater than zero.');
        return;
      }
    }

    isSubmittingRef.current = true;
    setSaving(true);
    setError('');

    const { startId, isStale } = captureContext();

    try {
      const payload: Record<string, unknown> = {
        expectedVersion: formVersion.current,
      };

      if (isFinancialEditable) {
        const total = Math.round(Number(amount) * 100) / 100;
        payload.category = category.trim();
        payload.description = description.trim();
        payload.amount = total;
        payload.fundSource = fundSource;
        payload.dueDate = dueDate || null;
        payload.notes = notes.trim() || null;

        if (isReceiptCleared) {
          payload.receiptS3Key = null;
          payload.receiptFilename = null;
          payload.externalUrl = null;
        } else if (receiptMode === 'link') {
          if (externalUrl.trim()) {
            try {
              const parsed = new URL(externalUrl.trim());
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                setError('External URL must start with http:// or https://');
                return;
              }
            } catch {
              setError('Please enter a valid external URL (e.g. https://...)');
              return;
            }
            payload.receiptS3Key = externalUrl.trim();
            payload.externalUrl = externalUrl.trim();
            payload.receiptFilename = receiptFilename.trim() || 'External Receipt';
          } else {
            payload.receiptS3Key = null;
            payload.receiptFilename = null;
            payload.externalUrl = null;
          }
        } else if (receiptFile) {
          setIsUploadingReceipt(true);
          const rawEntity =
            disbursement.entity_code ||
            (disbursement as unknown as { entityCode?: string }).entityCode ||
            (disbursement as unknown as { entity?: string }).entity ||
            'ATA';
          const targetEntity: 'ATA' | 'LTA' = rawEntity === 'LTA' ? 'LTA' : 'ATA';
          const uploadResult = await uploadReceiptFile(receiptFile, () => !isStale(), {
            entity: targetEntity,
          });
          if (isStale()) return;
          payload.receiptS3Key = uploadResult.receiptS3Key;
          payload.receiptFilename = uploadResult.receiptFilename;
          payload.externalUrl = null;
        }
      }

      const initialInvoiceId = disbursement.linked_invoice_id || disbursement.linkedInvoiceId || '';
      const initialTransmittalId =
        disbursement.linked_transmittal_id || disbursement.linkedTransmittalId || '';
      if (linkedInvoiceId !== initialInvoiceId || (!isFinancialEditable && !isAdmin)) {
        payload.linkedInvoiceId = linkedInvoiceId ? linkedInvoiceId.trim() : null;
      }
      if (linkedTransmittalId !== initialTransmittalId || (!isFinancialEditable && !isAdmin)) {
        payload.linkedTransmittalId = linkedTransmittalId ? linkedTransmittalId.trim() : null;
      }

      if (isAdmin && Object.keys(printDetails).length > 0) {
        payload.printDetails = printDetails;
      }

      await updateWithBlocking({
        id: startId!,
        data: payload as UpdateDisbursementInput,
      });

      if (isStale()) return;
      onClose();
    } catch (err) {
      if (isStale()) return;
      if (isConcurrencyConflictError(err)) {
        useBlockingModalStore.getState().close();
        setConflict(true);
        setError(
          'This voucher changed elsewhere. Your edits are preserved. Load the latest values before editing again.'
        );
      } else setError(err instanceof Error ? err.message : 'Unable to save the voucher.');
    } finally {
      if (!isStale()) {
        isSubmittingRef.current = false;
        setSaving(false);
        setIsUploadingReceipt(false);
      }
    }
  };

  const loadLatest = async () => {
    try {
      const latest = await apiRequest<{ data: Disbursement }>(`/disbursements/${disbursement.id}`);
      loadedContext.current = null;
      queryClient.setQueryData(disbursementKeys.detail(disbursement.id), latest.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh the voucher.');
    }
  };

  const title = `Edit Voucher ${disbursement.disbursement_number || disbursement.disbursementNumber || ''}`;
  const content = (
    <>
      {inline ? (
        <h3 className="text-base font-semibold">{title}</h3>
      ) : (
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
      )}

      {disbursement.status === 'Draft' && disbursement.review_ready === false && (
        <div
          className="p-3 bg-amber-50 border border-amber-200 rounded-[6px] text-xs text-amber-900 mb-2"
          data-testid="edit-correction-banner"
        >
          <strong>Returned for Correction:</strong> Please make and save the necessary adjustments
          to resubmit this voucher for Admin budget approval.
        </div>
      )}

      {!isFinancialEditable && (
        <div
          className="p-3 bg-canvas border border-border rounded-[6px] text-xs text-ink mb-2"
          data-testid="edit-print-only-banner"
        >
          <strong>Print Customization Mode:</strong> Financial fields are locked for this workflow
          stage. Only print presentation details below may be customized.
        </div>
      )}

      <form onSubmit={save} className="space-y-4" noValidate>
        {error && (
          <div role="alert" className="text-sm text-danger">
            {error}
            {conflict && (
              <Button type="button" variant="outline" size="sm" onClick={loadLatest}>
                Load latest values
              </Button>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            Category
            <Input
              aria-label="Category"
              value={category}
              maxLength={50}
              disabled={!isFinancialEditable}
              onChange={(e) => setCategory(e.target.value)}
            />
          </label>
          <label className="text-sm space-y-1">
            Amount (PHP)
            <Input
              aria-label="Amount (PHP)"
              type="number"
              min="0.01"
              step="0.01"
              disabled={!isFinancialEditable}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label className="text-sm space-y-1 sm:col-span-2">
            Description
            <textarea
              aria-label="Description"
              className="w-full border border-border rounded-[6px] p-2 disabled:bg-canvas disabled:text-muted"
              rows={3}
              maxLength={2000}
              disabled={!isFinancialEditable}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label className="text-sm space-y-1">
            Fund source
            <select
              aria-label="Fund source"
              className="w-full border border-border rounded-[6px] p-2 disabled:bg-canvas disabled:text-muted"
              value={fundSource}
              disabled={!isFinancialEditable}
              onChange={(e) => setFundSource(e.target.value as FundSource)}
            >
              <option>Firm Fund</option>
              <option>Client Fund</option>
            </select>
          </label>
          <label className="text-sm space-y-1">
            Due date
            <DateInput
              aria-label="Due date"
              value={dueDate}
              disabled={!isFinancialEditable}
              onValueChange={setDueDate}
            />
          </label>
          <label className="text-sm space-y-1 sm:col-span-2">
            Notes
            <textarea
              aria-label="Notes"
              className="w-full border border-border rounded-[6px] p-2 disabled:bg-canvas disabled:text-muted"
              rows={2}
              maxLength={2000}
              disabled={!isFinancialEditable}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <label className="text-sm space-y-1">
            Linked Invoice (Optional)
            <select
              aria-label="Linked Invoice"
              className="w-full border border-border rounded-[6px] p-2 bg-surface text-ink"
              value={linkedInvoiceId}
              onChange={(e) => setLinkedInvoiceId(e.target.value)}
              data-testid="edit-select-linked-invoice"
            >
              <option value="">None (No linked invoice)</option>
              {availableInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoice_number} — {inv.status} — ₱
                  {Number(inv.total || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm space-y-1">
            Linked Transmittal (Optional)
            <select
              aria-label="Linked Transmittal"
              className="w-full border border-border rounded-[6px] p-2 bg-surface text-ink"
              value={linkedTransmittalId}
              onChange={(e) => setLinkedTransmittalId(e.target.value)}
              data-testid="edit-select-linked-transmittal"
            >
              <option value="">None (No linked transmittal)</option>
              {availableTransmittals.map((tr) => (
                <option key={tr.id} value={tr.id}>
                  {tr.tracking_number} — {tr.status}
                  {tr.recipient_name || tr.recipientName
                    ? ` — ${tr.recipient_name || tr.recipientName}`
                    : ''}
                </option>
              ))}
            </select>
          </label>
          {isFinancialEditable && (
            <div className="space-y-2 sm:col-span-2 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-ink">Receipt Attachment</label>
                <div className="flex items-center gap-1 bg-surface border border-border rounded p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptMode('file');
                      setIsReceiptCleared(false);
                    }}
                    disabled={saving || isUploadingReceipt}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                      receiptMode === 'file'
                        ? 'bg-primary text-white font-semibold'
                        : 'text-muted hover:text-ink'
                    }`}
                    data-testid="edit-receipt-mode-file-btn"
                  >
                    <Upload className="h-3 w-3" />
                    File Upload
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReceiptMode('link');
                      setIsReceiptCleared(false);
                    }}
                    disabled={saving || isUploadingReceipt}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                      receiptMode === 'link'
                        ? 'bg-primary text-white font-semibold'
                        : 'text-muted hover:text-ink'
                    }`}
                    data-testid="edit-receipt-mode-link-btn"
                  >
                    <LinkIcon className="h-3 w-3" />
                    External Link
                  </button>
                </div>
              </div>

              {receiptMode === 'file' ? (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                    disabled={saving || isUploadingReceipt}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (!isValidReceiptMimeType(file.type, file.name)) {
                          setError('Only PDF, PNG, and JPEG files are allowed');
                          return;
                        }
                        if (file.size > 10 * 1024 * 1024) {
                          setError('File size cannot exceed 10 MiB');
                          return;
                        }
                        setReceiptFile(file);
                        setReceiptFilename(file.name);
                        setIsReceiptCleared(false);
                        setError('');
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={saving || isUploadingReceipt}
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs flex items-center gap-1.5"
                      data-testid="btn-upload-receipt-edit"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      <span>{receiptFilename && !isReceiptCleared ? 'Change Receipt' : 'Upload Receipt'}</span>
                    </Button>
                    {receiptFilename && !isReceiptCleared && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted truncate max-w-xs font-mono">
                          {receiptFilename}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleClearReceipt}
                          className="h-6 w-6 p-0 text-muted hover:text-danger cursor-pointer"
                          title="Remove receipt"
                          data-testid="clear-receipt-btn"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="space-y-2.5 p-3 rounded-[6px] border border-border bg-canvas/50">
                  <div className="space-y-1">
                    <label htmlFor="edit-disbursement-external-url" className="text-xs font-medium text-ink">
                      External URL
                    </label>
                    <Input
                      id="edit-disbursement-external-url"
                      type="url"
                      value={externalUrl}
                      onChange={(e) => {
                        const nextUrl = e.target.value;
                        setExternalUrl(nextUrl);
                        setIsReceiptCleared(false);
                        setError('');
                        if (nextUrl.trim()) {
                          const parsed = parseExternalUrl(nextUrl, receiptFilename);
                          if (parsed.isGoogleDrive && !receiptFilename.trim()) {
                            setReceiptFilename('Google Drive Receipt');
                          }
                        }
                      }}
                      placeholder="https://drive.google.com/file/d/..."
                      className="h-8 text-xs bg-surface"
                      data-testid="edit-disbursement-external-url-input"
                    />
                    {externalUrl.trim() && parseExternalUrl(externalUrl).isGoogleDrive && (
                      <div
                        className="flex items-center gap-1.5 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded p-1.5"
                        data-testid="edit-gdrive-preview-badge"
                      >
                        <span>Google Drive link detected — will be configured for inline preview</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label htmlFor="edit-disbursement-external-name" className="text-xs font-medium text-ink">
                      Receipt / Document Name
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="edit-disbursement-external-name"
                        type="text"
                        value={receiptFilename}
                        onChange={(e) => {
                          setReceiptFilename(e.target.value);
                          setIsReceiptCleared(false);
                        }}
                        placeholder="e.g., Official Receipt - BIR"
                        className="h-8 text-xs bg-surface flex-1"
                        data-testid="edit-disbursement-external-name-input"
                      />
                      {(externalUrl || receiptFilename) && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={handleClearReceipt}
                          className="h-8 px-2 text-xs text-muted hover:text-danger cursor-pointer"
                          data-testid="clear-link-receipt-btn"
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <fieldset className="border-t border-border pt-3 space-y-3">
          <legend className="text-sm font-semibold">Printed voucher details</legend>
          <p className="text-xs text-muted">
            These values appear on the document. Use Edit Payment Details to correct the recorded
            payment.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {printFields.map(([key, label]) => (
              <label key={key} className="text-sm space-y-1">
                {label}
                <Input
                  aria-label={label}
                  value={printDetails[key] ?? ''}
                  maxLength={500}
                  onChange={(e) => setPrintDetails({ ...printDetails, [key]: e.target.value })}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || conflict} data-testid="save-disbursement-edit">
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </>
  );
  return inline ? (
    <section
      className="bg-surface border-border rounded-[6px] p-4 space-y-3"
      data-testid="disbursement-inline-editor"
    >
      {content}
    </section>
  ) : (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
        data-testid="disbursement-edit-modal"
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}
