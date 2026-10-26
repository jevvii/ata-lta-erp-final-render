/** Transmittal preview and print options; document rows match the complete manifest. */

import { useRef, useState, useEffect } from 'react';
import { Printer, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { printTransmittalDocument, defaultTransmittalCompany, printableTransmittalItems } from '@/lib/printDocuments';
import { Input } from '@/components/ui/input';
import { useSessionStore } from '@/lib/session';
import { hasPermission } from '@/lib/permissions';
import type { Transmittal, TransmittalItem, CreateTransmittalItemInput } from '../api/types';

export interface TransmittalPrintModalProps {
  transmittal: Transmittal | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (transmittal: Transmittal) => void;
  onSaveItems?: (items: CreateTransmittalItemInput[]) => Promise<void>;
}

export function TransmittalPrintModal({
  transmittal,
  isOpen,
  onClose,
  onEdit,
  onSaveItems,
}: TransmittalPrintModalProps) {
  const printAreaRef = useRef<HTMLDivElement>(null);

  const [company, setCompany] = useState(() => defaultTransmittalCompany(transmittal?.entity_code));
  const [editingItems, setEditingItems] = useState(false);
  const [draftItems, setDraftItems] = useState<TransmittalItem[]>([]);
  const [savingItems, setSavingItems] = useState(false);
  const [itemsError, setItemsError] = useState('');
  useEffect(() => {
    setEditingItems(false);
    setItemsError('');
  }, [isOpen, transmittal?.id]);
  const user = useSessionStore((state) => state.user);
  const permissions = useSessionStore((state) => state.permissions);
  useEffect(() => {
    if (isOpen) setCompany(defaultTransmittalCompany(transmittal?.entity_code));
  }, [isOpen, transmittal?.id, transmittal?.entity_code]);

  if (!isOpen || !transmittal) return null;

  const entityCode = transmittal.entity_code || 'ATA';
  const isATA = entityCode === 'ATA';

  const { companyName, companyAddress, includeCompanyDetails } = company;
  const companyTin = isATA ? 'TIN: 234-567-890-000' : 'TIN: 345-678-901-000';

  // Date formatting (Entity-aware: ATA = uppercase full month, LTA = M/D/YYYY)
  const formattedDate = (() => {
    const rawDate = transmittal.sent_at || transmittal.created_at || new Date().toISOString();
    const d = new Date(rawDate);
    if (isATA) {
      return d
        .toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
        .toUpperCase();
    }
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  })();

  const isAcknowledged = transmittal.status === 'Acknowledged';
  const acknowledgedDateFormatted = transmittal.acknowledged_at
    ? new Date(transmittal.acknowledged_at)
        .toLocaleDateString('en-US', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
        .toUpperCase()
    : '';

  // TO parsing per prototype lines 2848-2873
  const clientName = transmittal.clients?.name || '';
  const pocName = transmittal.recipient_name || '';
  const toLine1 = pocName || clientName || '';
  let toLine2 = '';
  if (pocName && clientName) {
    toLine2 = isATA ? `(${clientName})` : clientName;
  }

  const address = transmittal.clients?.address || '';
  let toLine3 = '';
  let toLine4 = '';
  if (address) {
    const firstComma = address.indexOf(',');
    if (firstComma !== -1) {
      toLine3 = address.slice(0, firstComma).trim();
      toLine4 = address.slice(firstComma + 1).trim();
    } else {
      toLine3 = address;
    }
  }

  // Acknowledgment info for signature block
  let sigName = '';
  let sigDate = '';
  if (isAcknowledged) {
    sigName = (transmittal.received_by_name || transmittal.recipient_name || '').toUpperCase();
    if (transmittal.acknowledged_at) {
      const dObj = new Date(transmittal.acknowledged_at);
      sigDate = `${dObj.getMonth() + 1}/${dObj.getDate()}/${String(dObj.getFullYear()).slice(-2)}`;
    }
  }

  // Item-rows-only: strictly map real items without filler rows
  const canEditItems = user?.role === 'Admin' && hasPermission(permissions, 'transmittal:edit');
  const items = printableTransmittalItems(editingItems ? draftItems : transmittal.items);
  const updateDraftItem = (index: number, patch: Partial<TransmittalItem>) => {
    setDraftItems((previous) => previous.map((item, i) => i === index ? { ...item, ...patch } : item));
    setItemsError('');
  };
  const saveItems = async () => {
    if (!canEditItems || !onSaveItems || savingItems) return;
    if (!draftItems.length || draftItems.some((item) => !item.description.trim() || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      setItemsError('Add at least one document. Each row needs a description and a positive whole-number quantity.');
      return;
    }
    setSavingItems(true);
    setItemsError('');
    try {
      await onSaveItems(draftItems.map((item) => ({
        description: item.description.trim(),
        documentType: (item.document_type || item.documentType || 'Others').trim(),
        quantity: item.quantity,
      })));
      setEditingItems(false);
    } catch {
      setItemsError('Documents were not saved. Your edits are still here; please try again.');
    } finally {
      setSavingItems(false);
    }
  };

  const handlePrint = () => {
    printTransmittalDocument(transmittal, company);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 rounded-[12px] border border-[#CBD5E1] bg-[#FFFFFF] shadow-float print:p-0 print:m-0 print:max-w-none print:max-h-none print:w-full print:static print:transform-none print:border-none print:shadow-none print:overflow-visible print:bg-white print:rounded-none"
        data-testid="transmittal-print-modal"
      >
        {/* Print Stylesheet: ensures document prints authentically without modal screenshot artifacts */}
        <style>{`
          @media print {
            @page {
              size: letter portrait;
              margin: 10mm 15mm;
            }
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #ffffff !important;
              color: #000000 !important;
              width: 100% !important;
              height: auto !important;
              min-height: 0 !important;
              overflow: visible !important;
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
            #root,
            [data-state*="open"][class*="fixed"][class*="inset-0"],
            div[class*="backdrop-blur"],
            body > *:not([role="dialog"]):not([data-testid*="modal"]) {
              display: none !important;
              visibility: hidden !important;
            }
            [data-testid="transmittal-print-modal"],
            [role="dialog"] {
              position: static !important;
              inset: auto !important;
              top: 0 !important;
              left: 0 !important;
              transform: none !important;
              margin: 0 !important;
              padding: 0 !important;
              width: 100% !important;
              max-width: 100% !important;
              max-height: none !important;
              height: auto !important;
              box-shadow: none !important;
              border: none !important;
              border-radius: 0 !important;
              background: #ffffff !important;
              overflow: visible !important;
            }
            [data-testid="transmittal-print-modal"] > header,
            [data-testid="transmittal-print-modal"] > footer,
            [data-testid="transmittal-print-modal"] button,
            [data-testid="print-action-btn"],
            [data-testid="print-close-btn"],
            button[class*="absolute right-4 top-4"],
            .print\\:hidden {
              display: none !important;
              visibility: hidden !important;
            }
            #transmittal-print-area {
              display: block !important;
              visibility: visible !important;
              position: static !important;
              top: 0 !important;
              left: 0 !important;
              margin: 0 !important;
              margin-left: 0 !important;
              margin-right: 0 !important;
              margin-top: 0 !important;
              padding: 0 !important;
              padding-top: 0 !important;
              width: 100% !important;
              max-width: 100% !important;
              box-shadow: none !important;
              border: none !important;
            }
            #transmittal-print-area * {
              visibility: visible !important;
            }
            #transmittal-print-area table {
              width: 100% !important;
              border-collapse: collapse !important;
              page-break-inside: auto;
            }
            #transmittal-print-area tr {
              page-break-inside: avoid;
            }
          }
        `}</style>

        <DialogHeader className="p-4 pr-14 border-b border-[#CBD5E1] bg-[#F1F5F9] flex flex-row flex-wrap gap-3 items-center justify-between print:hidden">
          <DialogTitle className="text-base font-semibold text-[#0F172A] flex items-center gap-2">
            <Printer className="h-4 w-4 text-[#1D4ED8]" />
            Transmittal Letter Preview
          </DialogTitle>
          <div className="flex items-center gap-2">
            {canEditItems && (onSaveItems || onEdit) && (
              <Button size="sm" variant="outline" disabled={editingItems} className="rounded-[6px] border-[#CBD5E1] bg-[#FFFFFF] hover:bg-[#F1F5F9] text-[#0F172A] text-xs font-medium" onClick={() => {
                if (onSaveItems) {
                  setDraftItems((transmittal.items || []).map((item) => ({ ...item })));
                  setItemsError('');
                  setEditingItems(true);
                } else {
                  onEdit?.(transmittal);
                }
              }}>
                Edit contents
              </Button>
            )}
            <Button
              size="sm"
              onClick={handlePrint}
              disabled={editingItems || savingItems}
              title={editingItems ? 'Save or cancel document edits before printing' : undefined}
              className="h-8 text-xs bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] gap-1 cursor-pointer print:hidden rounded-[6px] font-medium shadow-2xs"
              data-testid="print-action-btn"
            >
              <Printer className="h-3.5 w-3.5" />
              Print Document
            </Button>
          </div>
        </DialogHeader>

        <section className="mx-4 mb-4 rounded-[8px] border border-[#CBD5E1] bg-[#F1F5F9] p-4 space-y-3 print:hidden" aria-label="Print options">
          <label className="flex items-center gap-2 text-sm font-semibold text-[#0F172A] cursor-pointer">
            <input type="checkbox" checked={includeCompanyDetails} className="rounded-[4px] accent-[#1D4ED8]"
              onChange={(event) => setCompany({ ...company, includeCompanyDetails: event.target.checked })} />
            Include company details (FROM)
          </label>
          {includeCompanyDetails && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs font-medium text-[#475569]">
                <span>Company Name</span>
                <Input value={companyName} className="bg-[#FFFFFF] border-[#CBD5E1] rounded-[6px]" onChange={(event) => setCompany({ ...company, companyName: event.target.value })} />
              </label>
              <label className="space-y-1 text-xs font-medium text-[#475569]">
                <span>Company Address</span>
                <textarea rows={3} value={companyAddress}
                  onChange={(event) => setCompany({ ...company, companyAddress: event.target.value })}
                  className="w-full rounded-[6px] border border-[#CBD5E1] bg-[#FFFFFF] px-3 py-2 text-sm text-[#0F172A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1D4ED8]" />
              </label>
            </div>
          )}
          <p className="text-xs text-[#475569]">These company details apply to this print preview and PDF. They do not change the company record.</p>
        </section>

        {editingItems && canEditItems && (
          <section className="mx-4 mb-4 rounded-[8px] border border-[#CBD5E1] bg-[#FFFFFF] p-4 space-y-3 print:hidden" aria-label="Edit document rows">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Documents ({draftItems.length})</h3>
                <p className="text-xs text-slate-500">Save your changes to update the transmittal and printout.</p>
              </div>
              <Button size="sm" variant="outline" disabled={savingItems} onClick={() => {
                setDraftItems((previous) => [...previous, { id: crypto.randomUUID(), description: '', document_type: 'Others', quantity: 1 }]);
                setItemsError('');
              }}><Plus className="mr-1 h-3.5 w-3.5" />Add document row</Button>
            </div>
            <fieldset disabled={savingItems} className="space-y-2">
              {draftItems.map((item, index) => (
                <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] gap-2 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[9rem_minmax(0,1fr)_5rem_2rem]">
                  <label className="col-span-3 text-xs font-medium text-slate-600 sm:col-span-1">Category
                    <Input aria-label={`Document ${index + 1} category`} maxLength={50} value={item.document_type || item.documentType || ''}
                      onChange={(event) => updateDraftItem(index, { document_type: event.target.value, documentType: event.target.value })} />
                  </label>
                  <label className="text-xs font-medium text-slate-600">Document
                    <Input aria-label={`Document ${index + 1} description`} maxLength={255} value={item.description}
                      onChange={(event) => updateDraftItem(index, { description: event.target.value })} />
                  </label>
                  <label className="text-xs font-medium text-slate-600">Quantity
                    <Input aria-label={`Document ${index + 1} quantity`} type="number" min={1} step={1} value={item.quantity || ''}
                      onChange={(event) => updateDraftItem(index, { quantity: Number(event.target.value) })} />
                  </label>
                  <Button size="icon" variant="ghost" className="self-end" aria-label={`Remove document ${index + 1}`}
                    onClick={() => setDraftItems((previous) => previous.filter((_, i) => i !== index))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </fieldset>
            {itemsError && <p role="alert" className="text-xs text-red-700">{itemsError}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {onEdit && <Button size="sm" variant="ghost" disabled={savingItems} onClick={() => onEdit(transmittal)}>Edit other details</Button>}
              <Button size="sm" variant="outline" disabled={savingItems} onClick={() => { setEditingItems(false); setItemsError(''); }}>Cancel edits</Button>
              <Button size="sm" disabled={savingItems} onClick={saveItems}>{savingItems ? 'Saving…' : 'Save documents'}</Button>
            </div>
          </section>
        )}

        {/* Printable Document Sheet (Verbatim 1:1 Prototype Boxed Form) */}
        <div
          ref={printAreaRef}
          className="p-6 pt-2 bg-white text-black font-sans text-xs space-y-4 w-full box-border text-left m-0 ml-0 mr-auto print:p-0 print:m-0 print:pt-0 print:mt-0 print:w-full print:max-w-none print:space-y-4"
          id="transmittal-print-area"
        >
          {/* Header Box Table (preview-header-table) */}
          <table
            className="w-full border-2 border-black border-collapse mb-4 table-fixed"
            style={{ border: '2px solid #000' }}
          >
            <colgroup>
              <col style={{ width: '55%' }} />
              <col style={{ width: '45%' }} />
            </colgroup>
            <tbody>
              {/* Row 1: Title */}
              <tr>
                <td
                  colSpan={2}
                  className="border-2 border-black text-center font-bold text-[12pt] tracking-[0.5px] p-2 text-black"
                  style={{ border: '2px solid #000' }}
                >
                  DOCUMENT TRANSMITTAL FORM
                </td>
              </tr>

              {/* Row 2: Tracking Number & Date */}
              <tr>
                <td
                  className="border-2 border-black p-2.5 align-top break-words text-black"
                  style={{ width: '55%', border: '2px solid #000' }}
                >
                  <span className="text-[#c2272d] font-bold mr-1.5">TRANSMITTAL DOC NO.:</span>
                  <span className="font-bold font-mono" data-testid="print-tracking-number">
                    {transmittal.tracking_number}
                  </span>
                </td>
                <td
                  className="border-2 border-black p-2.5 align-top break-words text-black"
                  style={{ width: '45%', border: '2px solid #000' }}
                >
                  <span className="font-bold mr-1.5">DATE:</span>
                  <span className="font-bold">{formattedDate}</span>
                </td>
              </tr>

              {/* Row 3: FROM & TO */}
              <tr>
                {includeCompanyDetails && <td
                  className="border-2 border-black p-2.5 align-top break-words leading-relaxed text-black"
                  style={{ width: '55%', border: '2px solid #000' }}
                >
                  <strong>FROM:</strong> <strong>{companyName}</strong>
                  <br />
                  <span className="whitespace-pre-line">{companyAddress}</span>
                  <br />
                  <span className="text-[10px] font-mono text-slate-500">{companyTin}</span>
                </td>}
                <td
                  colSpan={includeCompanyDetails ? 1 : 2}
                  className="border-2 border-black p-2.5 align-top break-words leading-relaxed text-black"
                  style={{ width: includeCompanyDetails ? '45%' : '100%', border: '2px solid #000' }}
                >
                  <div className="flex gap-2 items-start">
                    <strong className="mt-0.5">TO:</strong>
                    <div className="flex-1 flex flex-col">
                      <div
                        className="border-b-[1.5px] border-black min-h-[16px] mt-0.5 pb-0.5 font-bold text-black"
                        data-testid="print-recipient-name"
                      >
                        {toLine1}
                      </div>
                      <div
                        className="border-b-[1.5px] border-black min-h-[16px] mt-0.5 pb-0.5 font-bold text-black"
                        data-testid="print-client-name"
                      >
                        {toLine2}
                      </div>
                      <div className="border-b-[1.5px] border-black min-h-[16px] mt-0.5 pb-0.5 font-bold text-black">
                        {toLine3}
                      </div>
                      <div className="border-b-[1.5px] border-black min-h-[16px] mt-0.5 pb-0.5 font-bold text-black">
                        {toLine4}
                      </div>
                      {transmittal.recipient_details?.trim() && (
                        <div className="mt-1 whitespace-pre-line">{transmittal.recipient_details}</div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Document Box Container (preview-document-box) */}
          <div
            className="border-2 border-black relative mb-4 w-full box-border"
            style={{ border: '2px solid #000' }}
          >
            <div
              className="font-bold px-2.5 py-1.5 border-b-2 border-black bg-white text-[10pt] text-black"
              style={{ borderBottom: '2px solid #000' }}
            >
              Received the following documents and/or records:
            </div>

            {/* Document Table (preview-document-table) */}
            <table className="w-full border-collapse table-fixed" data-testid="print-items-table">
              <colgroup>
                <col style={{ width: '35%' }} />
                <col style={{ width: '65%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th
                    className="border-b-2 border-r-2 border-black px-2.5 py-1.5 font-bold text-left text-[10pt] text-black bg-white"
                    style={{
                      width: '35%',
                      borderBottom: '2px solid #000',
                      borderRight: '2px solid #000',
                    }}
                  >
                    CATEGORY
                  </th>
                  <th
                    className="border-b-2 border-black px-2.5 py-1.5 font-bold text-left text-[10pt] text-black bg-white"
                    style={{ width: '65%', borderBottom: '2px solid #000' }}
                  >
                    DOCUMENT
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr
                    key={item.id || `manifest-row-${idx}`}
                    className="break-inside-avoid"
                    data-testid={`print-item-row-${idx}`}
                  >
                    <td
                      className="px-2.5 py-1 text-[10pt] font-bold align-top break-words text-black border-r border-black"
                      style={{
                        width: '35%',
                        borderRight: '1px solid #000',
                        borderBottom: idx < items.length - 1 ? '1px solid #000' : 'none',
                      }}
                    >
                      {(item.document_type || item.documentType || 'Others').toUpperCase()}
                    </td>
                    <td
                      className="px-2.5 py-1 text-[10pt] align-top break-words text-black"
                      style={{
                        width: '65%',
                        borderBottom: idx < items.length - 1 ? '1px solid #000' : 'none',
                      }}
                    >
                      {(item.description || '').toUpperCase()}
                      {item.quantity && item.quantity > 1 ? ` (QTY: ${item.quantity})` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Dynamic "RECEIVED" Stamp */}
            {isAcknowledged && (
              <div
                className="absolute right-[12%] top-1/2 -translate-y-1/2 border-4 border-double border-blue-800 text-blue-900 px-3 py-1.5 text-center bg-white/95 rounded-xl font-mono font-bold pointer-events-none z-10"
                style={{ transform: 'translateY(-50%) rotate(-7deg)' }}
                data-testid="print-received-stamp"
              >
                <div className="text-base font-extrabold tracking-widest border-b-2 border-blue-800 pb-0.5 mb-1">
                  RECEIVED
                </div>
                {(transmittal.received_by_name || transmittal.recipient_name) && (
                  <div
                    className="text-[10px] font-bold uppercase"
                    data-testid="stamp-recipient-name"
                  >
                    {transmittal.received_by_name || transmittal.recipient_name}
                  </div>
                )}
                <div
                  className="text-[10px] text-blue-700 font-semibold"
                  data-testid="stamp-acknowledged-date"
                >
                  {acknowledgedDateFormatted || 'Date Recorded'}
                </div>
              </div>
            )}
          </div>

          {/* Notes (if any) */}
          {transmittal.notes && (
            <div className="my-2.5 italic text-[9.5pt] text-slate-600">
              Notes: {transmittal.notes}
            </div>
          )}

          {/* Centered Signature Box (preview-signature-container) */}
          <div className="mt-8 w-full max-w-[400px] mx-auto text-center">
            <div className="flex justify-between px-5 font-bold text-[11pt] min-h-[20px] text-black">
              <span className="flex-[2] text-center">{sigName}</span>
              <span className="flex-1 text-right">{sigDate}</span>
            </div>
            <div className="border-t-[1.5px] border-black mt-0.5" />
            <div className="text-[9pt] text-slate-600 mt-1.5">
              Signature over Printed name / Date Received
            </div>
          </div>
        </div>

        <DialogFooter className="p-3 border-t bg-slate-50 flex items-center justify-end print:hidden">
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="h-8 text-xs cursor-pointer print:hidden"
            data-testid="print-close-btn"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
