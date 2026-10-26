import { useState, useEffect } from 'react';
import { Printer, Download, Lock, Pencil, X, AlertTriangle } from 'lucide-react';
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
import { useInvoiceDetail } from '../api/useInvoices';
import { billingKeys } from '../api/queryKeys';
import { useScopedRecordGuard } from '@/lib/useScopedRecordGuard';
import { updateClientAddressAction, fetchInvoicePdfUrl } from '../api/useBillingMutations';
import { usePermission } from '@/lib/permissions';
import { useSessionStore } from '@/lib/session';
import {
  buildStatementDocument,
  printStatementDocument,
  STATEMENT_CSS,
} from '@/lib/printDocuments';
import { InvoiceEditModal } from './InvoiceEditModal';
import type { Invoice } from '../api/types';

export interface PrintPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoiceId?: string | null;
  initialInvoice?: Invoice | null;
}

export function PrintPreviewModal({
  isOpen,
  onClose,
  invoiceId,
  initialInvoice,
}: PrintPreviewModalProps) {
  const effectiveId = invoiceId || initialInvoice?.id;
  const {
    data: fetchedInvoice,
    isError: isInvoiceError,
    error: invoiceError,
    isPlaceholderData: isInvoicePlaceholder,
    refetch,
  } = useInvoiceDetail(effectiveId, {
    enabled: isOpen && !!effectiveId,
  });

  const {
    record: invoice,
    isDenied,
    isScopeStale,
  } = useScopedRecordGuard<Invoice>({
    recordId: effectiveId,
    isOpen,
    onClose,
    queryError: invoiceError,
    isQueryError: isInvoiceError,
    isPlaceholderData: isInvoicePlaceholder,
    liveRecord: fetchedInvoice,
    initialRecord: initialInvoice,
    queryKey: effectiveId ? billingKeys.invoiceDetail(effectiveId) : undefined,
  });
  const isAdmin = useSessionStore((s) => s.user?.role === 'Admin');
  const canEditAddress = usePermission('billing:edit_client_address');
  const [isEditingAddress, setIsEditingAddress] = useState(false);
  const [isEditingInvoice, setIsEditingInvoice] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hideCompanyDetails, setHideCompanyDetails] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    setHideCompanyDetails(false);
    setIsEditingInvoice(false);
    setFeedback(null);
  }, [effectiveId, isOpen]);
  useEffect(() => {
    setAddressInput(invoice?.address ?? invoice?.clients?.address ?? '');
    setIsEditingAddress(false);
  }, [invoice]);
  if (isScopeStale || !isOpen) return null;

  if (isDenied) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md p-6 border-[#E2E8F0] bg-[#FFFFFF] shadow-float text-center space-y-3 rounded-[12px]"
          data-testid="print-preview-access-denied-dialog"
        >
          <div className="w-12 h-12 rounded-full bg-[#F1F5F9] mx-auto flex items-center justify-center">
            <Lock className="w-6 h-6 text-[#64748B]" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-[#1E293B]">Access Not Available</h3>
            <p className="text-xs text-[#475569] max-w-xs mx-auto">
              You do not have access to this invoice or access has been revoked.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="mt-2 text-xs"
            data-testid="print-preview-access-denied-close-btn"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  if (isInvoiceError && !isDenied) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className="max-w-md p-6 border-[#E2E8F0] bg-[#FFFFFF] shadow-float text-center space-y-3 rounded-[12px]"
          data-testid="print-preview-error"
        >
          <div className="w-12 h-12 rounded-full bg-red-50 mx-auto flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-base font-bold text-[#1E293B]">
              Unable to Load Print Preview
            </DialogTitle>
            <DialogDescription className="text-xs text-[#475569] max-w-xs mx-auto">
              Could not retrieve invoice details from the server to generate statement preview.
            </DialogDescription>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
              data-testid="print-preview-error-close-btn"
            >
              Close
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => void refetch()}
              className="text-xs"
              data-testid="print-preview-error-retry-btn"
            >
              Retry
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!invoice) return null;

  const saveAddress = async () => {
    try {
      await updateClientAddressAction(invoice.id, addressInput, invoice.version, invoice.entity_id);
      setIsEditingAddress(false);
      setFeedback('Updated invoice snapshot address only. Master client record remains unchanged.');
      void refetch();
    } catch {
      /* BlockingActionModal displays the error. */
    }
  };
  const downloadPdf = async () => {
    setDownloading(true);
    setFeedback(null);
    // Reserve the window during the click so popup blockers allow the async PDF.
    const pdfWindow = window.open('', '_blank');
    try {
      const url = await fetchInvoicePdfUrl(invoice.id, !hideCompanyDetails);
      if (pdfWindow) pdfWindow.location.href = url;
      else window.open(url, '_blank');
    } catch {
      pdfWindow?.close();
      setFeedback('Unable to generate the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 bg-[#F1F5F9] rounded-[12px] border border-[#CBD5E1] shadow-float"
        data-testid="print-preview-modal"
      >
        <style>
          {STATEMENT_CSS.replace('body {', '.statement-document {') +
            `
          .statement-document { box-sizing: border-box; width: 210mm; min-height: 297mm; padding: 15mm 20mm; background: white; }
          .statement-document p { margin: 2px 0; }
          .statement-document img { max-width: none; }
          .statement-document strong { font-weight: bold; }
          @media print {
            body > *:not([role="dialog"]) { display: none !important; }
            [role="dialog"] { position: static !important; transform: none !important; max-height: none !important; width: 100% !important; max-width: none !important; border: 0 !important; padding: 0 !important; overflow: visible !important; }
            .billing-print-controls { display: none !important; }
            .billing-sheet-scroll { padding: 0 !important; overflow: visible !important; }
            .statement-document { width: auto; min-height: 0; padding: 0; box-shadow: none; }
          }
        `}
        </style>
        <DialogHeader className="billing-print-controls p-5 bg-white border-b border-[#CBD5E1]">
          <DialogTitle>Print Preview — {invoice.invoice_number}</DialogTitle>
          <div className="flex flex-wrap items-center gap-3 pt-3 pr-6">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={hideCompanyDetails}
                onChange={(e) => setHideCompanyDetails(e.target.checked)}
                data-testid="company-details-checkbox"
              />
              No company details and logo
            </label>
            {isAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditingInvoice(!isEditingInvoice)}
              >
                <Pencil className="w-4 h-4 mr-1" />
                {isEditingInvoice ? 'Close inline editor' : 'Edit inline'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={downloadPdf}
              disabled={downloading}
              data-testid="download-pdf-button"
            >
              <Download className="w-4 h-4 mr-1" />
              {downloading ? 'Generating PDF…' : 'Download PDF'}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                printStatementDocument(invoice, { includeCompanyDetails: !hideCompanyDetails })
              }
              data-testid="print-document-button"
            >
              <Printer className="w-4 h-4 mr-1" />
              Print Document
            </Button>
          </div>
        </DialogHeader>
        <div className="billing-print-controls px-5 space-y-3">
          {feedback && (
            <div
              role="status"
              className="text-sm flex justify-between"
              data-testid="address-update-success-banner"
            >
              {feedback}
              <button type="button" aria-label="Dismiss message" onClick={() => setFeedback(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          {canEditAddress ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsEditingAddress(true)}
              data-testid="edit-client-address-button"
            >
              Edit Address
            </Button>
          ) : (
            <span
              className="text-xs text-[#475569] flex items-center gap-1"
              data-testid="address-locked-indicator"
            >
              <Lock className="w-3 h-3" />
              Address Locked
            </span>
          )}
          {isEditingAddress && (
            <div className="flex flex-wrap items-center gap-2" data-testid="inline-address-editor">
              <Input
                aria-label="Invoice snapshot address"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                data-testid="address-input"
              />
              <Button size="sm" onClick={saveAddress} data-testid="save-address-button">
                Save Snapshot
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsEditingAddress(false)}>
                Cancel
              </Button>
            </div>
          )}
          {isAdmin && isEditingInvoice && (
            <InvoiceEditModal
              inline
              isOpen
              invoice={invoice}
              onClose={() => setIsEditingInvoice(false)}
              onUpdated={() => void refetch()}
            />
          )}
        </div>
        <div className="billing-sheet-scroll overflow-x-auto p-5">
          <div
            className="statement-document mx-auto shadow-sm"
            data-testid="a4-document-sheet"
            dangerouslySetInnerHTML={{
              __html: buildStatementDocument(invoice, {
                includeCompanyDetails: !hideCompanyDetails,
              }),
            }}
          />
        </div>
        <DialogFooter className="billing-print-controls p-4 bg-white border-t border-[#CBD5E1]">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
