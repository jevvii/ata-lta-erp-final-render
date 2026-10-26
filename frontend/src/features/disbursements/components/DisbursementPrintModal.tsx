import { useEffect, useState } from 'react';
import { Printer, Download, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/lib/session';
import { useDisbursementDetail, fetchDisbursementPdfUrl } from '../api/useDisbursements';
import {
  buildDisbursementDocument,
  DISBURSEMENT_DOCUMENT_CSS,
  printDisbursementDocument,
} from '@/lib/disbursementDocument';
import { DisbursementEditModal } from './DisbursementEditModal';
import type { Disbursement } from '../api/types';

export interface DisbursementPrintModalProps {
  disbursement: Disbursement | null;
  isOpen: boolean;
  onClose: () => void;
}
export function DisbursementPrintModal({
  disbursement,
  isOpen,
  onClose,
}: DisbursementPrintModalProps) {
  const { data } = useDisbursementDetail(disbursement?.id, {
    enabled: isOpen && !!disbursement?.id,
  });
  const item = data || disbursement;
  const isAdmin = useSessionStore((s) => s.user?.role === 'Admin');
  const [noLogo, setNoLogo] = useState(false);
  const [hideCompany, setHideCompany] = useState(false);
  const [editing, setEditing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setNoLogo(false);
    setHideCompany(false);
    setEditing(false);
    setError('');
  }, [isOpen, disbursement?.id]);
  if (!isOpen || !item) return null;
  const options = { noLogo, includeCompanyDetails: !hideCompany };
  const download = async () => {
    const popup = window.open('', '_blank');
    setDownloading(true);
    setError('');
    try {
      const url = await fetchDisbursementPdfUrl(item.id, options);
      if (popup) popup.location.href = url;
      else window.open(url, '_blank');
    } catch {
      popup?.close();
      setError('Unable to generate the PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 bg-sidebar rounded-[12px] border border-border shadow-float"
        data-testid="disbursement-print-modal"
      >
        <style>
          {DISBURSEMENT_DOCUMENT_CSS +
            '.disbursement-document { box-sizing:border-box; width:210mm; min-height:297mm; padding:15mm 20mm; }'}
        </style>
        <DialogHeader className="p-5 bg-surface border-b border-border space-y-3">
          <DialogTitle>Payment Voucher / Expense Report Preview</DialogTitle>
          <div className="flex flex-wrap items-center gap-3 pr-5">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={noLogo}
                disabled={hideCompany}
                onChange={(e) => setNoLogo(e.target.checked)}
                data-testid="disbursement-generic-option"
              />
              No Logo (Generic)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={hideCompany}
                onChange={(e) => setHideCompany(e.target.checked)}
                data-testid="disbursement-company-option"
              />
              No company details and logo
            </label>
            {isAdmin && (
              <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
                <Pencil className="w-4 h-4" />
                {editing ? 'Close inline editor' : 'Edit inline'}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={download}
              disabled={downloading}
              data-testid="download-disbursement-pdf"
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Generating PDF…' : 'Download PDF'}
            </Button>
            <Button
              size="sm"
              onClick={() => printDisbursementDocument(item, options)}
              data-testid="print-disbursement-button"
            >
              <Printer className="w-4 h-4" />
              Print Document
            </Button>
          </div>
        </DialogHeader>
        {error && (
          <p role="alert" className="px-5 text-sm text-red-700">
            {error}
          </p>
        )}
        {editing && isAdmin && (
          <div className="px-5">
            <DisbursementEditModal
              inline
              isOpen
              disbursement={item}
              onClose={() => setEditing(false)}
            />
          </div>
        )}
        <div className="overflow-x-auto p-5">
          <div
            className="disbursement-document mx-auto shadow-sm"
            data-testid="disbursement-a4-sheet"
            dangerouslySetInnerHTML={{ __html: buildDisbursementDocument(item, options) }}
          />
        </div>
        <DialogFooter className="p-4 border-t border-border bg-surface">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            data-testid="close-disbursement-print-button"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
