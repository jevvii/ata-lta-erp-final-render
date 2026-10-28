import { useEffect, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/date-input';
import { Upload } from 'lucide-react';
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

  // Requesters can edit their own Draft; Admin and Accounting can correct an authorized Draft.
  // Admin can edit financial fields if isFinancialEditable, OR edit print-only fields on other saved stages.
  const canEdit =
    !disbursement.archived &&
    isValidPositiveVersion &&
    (isAdmin || ((isOwner || isAccounting) && isFinancialEditable));

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
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptFilename, setReceiptFilename] = useState<string>('');
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
    setReceiptFile(null);
    setReceiptFilename(disbursement.receipt_filename || disbursement.receiptFilename || '');
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

        if (receiptFile) {
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
        }
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
          {isFinancialEditable && (
            <div className="space-y-1 sm:col-span-2">
              <label className="text-sm font-semibold text-ink">
                Receipt Attachment
              </label>
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
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>{receiptFilename ? 'Change Receipt' : 'Upload Receipt'}</span>
                </Button>
                {receiptFilename && (
                  <span className="text-xs text-muted truncate max-w-xs font-mono">
                    {receiptFilename}
                  </span>
                )}
              </div>
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
