/**
 * Disbursement Print Preview Modal
 *
 * Verbatim port of erp_prototype/js/disbursement.js:3590-3735
 * Features Expense Report / Payment Voucher A4 sheet layout with 3 signature lines:
 * 1. Prepared By / Date
 * 2. Approved By / Date
 * 3. Released By / Date
 */

import { useRef } from 'react';
import { Printer } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { Disbursement } from '../api/types';

export interface DisbursementPrintModalProps {
  disbursement: Disbursement | null;
  isOpen: boolean;
  onClose: () => void;
}

function numberToWords(num: number): string {
  const ones = [
    '',
    'One',
    'Two',
    'Three',
    'Four',
    'Five',
    'Six',
    'Seven',
    'Eight',
    'Nine',
    'Ten',
    'Eleven',
    'Twelve',
    'Thirteen',
    'Fourteen',
    'Fifteen',
    'Sixteen',
    'Seventeen',
    'Eighteen',
    'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const convert = (n: number): string => {
    if (n < 20) return ones[n] || '';
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + convert(n % 100) : '');
    if (n < 1000000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '');
    if (n < 1000000000) return convert(Math.floor(n / 1000000)) + ' Million' + (n % 1000000 ? ' ' + convert(n % 1000000) : '');
    return '';
  };

  const whole = Math.floor(num);
  const dec = Math.round((num - whole) * 100);
  let result = convert(whole) || 'Zero';
  if (dec > 0) result += ' and ' + convert(dec) + ' Centavos';
  return result.toUpperCase();
}

export function DisbursementPrintModal({
  disbursement,
  isOpen,
  onClose,
}: DisbursementPrintModalProps) {
  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!isOpen || !disbursement) return null;

  const entity = disbursement.entity_code || disbursement.entityCode || 'ATA';
  const isReleased = disbursement.status === 'Released' || disbursement.status === 'Funded';
  const amountNumber = typeof disbursement.amount === 'number' ? disbursement.amount : 0;
  const amountFormatted = `₱${amountNumber.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  const amountInWords = `${numberToWords(amountNumber)} PESOS ONLY`;
  const cleanAmountString = amountNumber.toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const refNumber =
    disbursement.disbursement_number ||
    disbursement.disbursementNumber ||
    disbursement.id;

  const employeeName =
    disbursement.employee_name ||
    disbursement.employeeName ||
    disbursement.requested_by_name ||
    disbursement.requestedByName ||
    disbursement.created_by_name ||
    disbursement.createdByName ||
    disbursement.requested_by ||
    disbursement.requestedBy ||
    disbursement.employee_id ||
    'Authorized Staff';

  const approverName =
    disbursement.approved_by_name ||
    disbursement.approvedByName ||
    disbursement.approved_by ||
    disbursement.approvedBy ||
    (disbursement.status === 'Approved' || isReleased ? 'Authorized Manager' : '________________________');

  const releaserName =
    disbursement.released_by_name ||
    disbursement.releasedByName ||
    disbursement.released_by ||
    disbursement.releasedBy ||
    (isReleased ? 'Disbursing Officer' : '________________________');

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-4xl max-h-[92vh] overflow-y-auto p-0 rounded-xl bg-slate-100"
        data-testid="disbursement-print-modal"
      >
        <DialogHeader className="p-4 bg-white border-b border-slate-200 sticky top-0 z-10 flex flex-row items-center justify-between">
          <div>
            <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Printer className="w-4 h-4 text-blue-600" />
              <span>Payment Voucher / Expense Report Preview</span>
              <Badge variant="outline" className="text-xs">
                {refNumber}
              </Badge>
            </DialogTitle>
            <p className="text-xs text-slate-500">
              Official payment authorization sheet. Click &quot;Print Document&quot; to print.
            </p>
          </div>

          <div className="flex items-center gap-2 pr-8">
            <Button
              onClick={handlePrint}
              className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 gap-1.5 shadow-xs cursor-pointer"
              data-testid="print-disbursement-button"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Document</span>
            </Button>
          </div>
        </DialogHeader>

        {/* A4 Sheet Container */}
        <div className="p-6 flex justify-center">
          <div
            ref={printAreaRef}
            className="w-full max-w-[210mm] min-h-[297mm] bg-white text-slate-900 p-10 shadow-lg rounded-sm border border-slate-200 flex flex-col justify-between"
            data-testid="disbursement-a4-sheet"
          >
            <div>
              {/* Header Container */}
              <div className="header-container flex justify-between items-end mb-6 border-b-2 border-slate-900 pb-3">
                <div className="logo-box flex items-center gap-3">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-xl text-white ${
                      entity === 'LTA' ? 'bg-[#007cc0]' : 'bg-[#00A3E0]'
                    }`}
                  >
                    {entity}
                  </div>
                  <div>
                    <span className="text-lg font-bold text-slate-950 tracking-wide block">
                      {entity} Accounting Services Firm
                    </span>
                    <span className="text-xs text-slate-500">
                      Disbursement & Payment Authorization
                    </span>
                  </div>
                </div>
                <div className="title-box text-right">
                  <h1 className="doc-title text-2xl font-black uppercase tracking-wider text-slate-900">
                    Expense Report
                  </h1>
                  <span className="text-xs font-semibold text-slate-600">
                    Payment Voucher
                  </span>
                </div>
              </div>

              {/* Two Column Requester / Ref Box */}
              <div className="two-col flex justify-between gap-6 mb-6 text-xs">
                {/* Employee / Requester Box */}
                <div className="col-left flex-1 border-[1.5px] border-slate-900 p-3.5 bg-white space-y-1.5" data-testid="requester-box">
                  <h3 className="text-[11px] font-bold text-slate-600 uppercase border-b border-slate-300 pb-1 mb-2 tracking-wide">
                    Employee / Requester
                  </h3>
                  <p className="font-bold text-sm text-slate-900">
                    {employeeName}
                  </p>
                  <p className="text-slate-600 text-[11px]">
                    Status: <span className="font-semibold">{disbursement.status}</span>
                  </p>
                  <p className="text-slate-500 text-[10px]">
                    Fund Source: {disbursement.fund_source || disbursement.fundSource || 'Firm Fund'}
                  </p>
                </div>

                {/* Right Meta Column */}
                <div className="col-right w-[42%] border-[1.5px] border-dashed border-slate-400 p-3.5 bg-slate-50/50 flex flex-col justify-center space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-semibold uppercase text-[10px] tracking-wide">
                      Ref No.:
                    </span>
                    <span className="font-mono font-bold text-slate-900">
                      {refNumber}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500 font-semibold uppercase text-[10px] tracking-wide">
                      Date Submitted:
                    </span>
                    <span className="font-mono text-slate-800">
                      {disbursement.created_at?.slice(0, 10)}
                    </span>
                  </div>
                  {(disbursement.linked_work_request_name ||
                    disbursement.linked_work_request_order_number ||
                    disbursement.linked_work_request_id) && (
                    <div className="flex justify-between items-center text-xs pt-1.5 border-t border-dashed border-slate-300">
                      <span className="text-slate-500 font-semibold uppercase text-[10px] tracking-wide">
                        Work Request:
                      </span>
                      <span className="font-mono text-[11px] text-blue-800 truncate max-w-[200px]" data-testid="print-work-request">
                        {disbursement.linked_work_request_name ||
                          disbursement.linked_work_request_order_number ||
                          disbursement.linked_work_request_id}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Items / Category Table */}
              <div className="mb-6">
                <table className="w-full text-xs border-collapse border-[1.5px] border-slate-900" data-testid="disbursement-items-table">
                  <thead>
                    <tr className="bg-slate-100 border-b border-slate-900 text-slate-900">
                      <th className="border border-slate-900 py-2 px-3 text-left w-36 font-bold uppercase">
                        Category
                      </th>
                      <th className="border border-slate-900 py-2 px-3 text-left font-bold uppercase">
                        Description
                      </th>
                      <th className="border border-slate-900 py-2 px-3 text-left w-32 font-bold uppercase">
                        Fund Source
                      </th>
                      <th className="border border-slate-900 py-2 px-3 text-right w-36 font-bold uppercase">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-900 text-slate-900">
                      <td className="border border-slate-900 py-2.5 px-3 font-semibold text-slate-900">
                        {disbursement.category}
                      </td>
                      <td className="border border-slate-900 py-2.5 px-3 text-slate-800">
                        {disbursement.description}
                      </td>
                      <td className="border border-slate-900 py-2.5 px-3 text-slate-700">
                        {disbursement.fund_source || disbursement.fundSource || 'Firm Fund'}
                      </td>
                      <td className="border border-slate-900 py-2.5 px-3 text-right font-mono font-bold text-slate-950">
                        {amountFormatted}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Totals & Amount in Words Container */}
              <div className="totals-container grid grid-cols-1 sm:grid-cols-2 gap-6 mb-6 items-stretch">
                <div className="amount-words-box border-[1.5px] border-slate-900 p-3 bg-white flex flex-col justify-between text-xs">
                  <span className="font-bold uppercase text-[10px] text-slate-600 block mb-1">
                    Amount in Words
                  </span>
                  <p className="font-semibold text-slate-900 uppercase tracking-wide leading-relaxed" data-testid="amount-in-words">
                    {amountInWords}
                  </p>
                </div>

                <div className="amount-val-box border-2 border-double border-slate-900 p-3 bg-slate-50 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800 uppercase text-xs">
                    Total Amount:
                  </span>
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-xs text-slate-600">PHP</span>
                    <span className="font-mono font-black text-xl text-slate-950" data-testid="disbursement-total-amount">
                      {cleanAmountString}
                    </span>
                  </div>
                </div>
              </div>

              {/* Payment Details Box */}
              <div className="bottom-layout mb-6">
                <div className="payment-details-box border-[1.5px] border-slate-900 p-3.5 bg-white text-xs space-y-2">
                  <h4 className="font-bold uppercase text-[11px] text-slate-800 border-b border-slate-300 pb-1 mb-2">
                    Payment Details
                  </h4>
                  {isReleased ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Date:</span>
                        <span className="font-mono font-semibold text-slate-900">
                          {disbursement.released_at?.slice(0, 10) || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Method:</span>
                        <span className="font-medium text-slate-900">
                          {disbursement.payment_method || disbursement.paymentMethod || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Check/Ref No.:</span>
                        <span className="font-mono text-slate-900">
                          {disbursement.payment_reference || disbursement.paymentReference || '—'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Bank/Branch:</span>
                        <span className="text-slate-900">
                          {disbursement.payment_bank || disbursement.paymentBank || '—'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Date:</span>
                        <div className="border-b border-dotted border-slate-400 h-5" />
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Method:</span>
                        <div className="border-b border-dotted border-slate-400 h-5" />
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Check/Ref No.:</span>
                        <div className="border-b border-dotted border-slate-400 h-5" />
                      </div>
                      <div>
                        <span className="text-slate-500 font-semibold block text-[10px] uppercase">Bank/Branch:</span>
                        <div className="border-b border-dotted border-slate-400 h-5" />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 3-Signature Row matching prototype */}
              <div className="signature-row flex justify-between gap-8 mt-12 mb-6" data-testid="signatures-section">
                <div className="signature-box flex-1 flex flex-col justify-between text-center">
                  <div className="h-10" />
                  <div className="border-t-[1.5px] border-slate-900 pt-1.5">
                    <div className="font-bold text-xs text-slate-950 uppercase" data-testid="sig-prepared-by">
                      {employeeName}
                    </div>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      Prepared By / Date
                    </span>
                  </div>
                </div>

                <div className="signature-box flex-1 flex flex-col justify-between text-center">
                  <div className="h-10" />
                  <div className="border-t-[1.5px] border-slate-900 pt-1.5">
                    <div className="font-bold text-xs text-slate-950 uppercase" data-testid="sig-approved-by">
                      {approverName}
                    </div>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      Approved By / Date
                    </span>
                  </div>
                </div>

                <div className="signature-box flex-1 flex flex-col justify-between text-center">
                  <div className="h-10" />
                  <div className="border-t-[1.5px] border-slate-900 pt-1.5">
                    <div className="font-bold text-xs text-slate-950 uppercase" data-testid="sig-released-by">
                      {releaserName}
                    </div>
                    <span className="text-[10px] text-slate-500 block mt-0.5">
                      Released By / Date
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="footer text-center border-t border-slate-300 pt-4 mt-6 text-xs text-slate-500">
              <div className="thank-you font-bold text-sm uppercase text-slate-800 tracking-wider mb-1">
                THANK YOU !!!
              </div>
              <p className="text-[10px]">
                {entity} Accounting Services Firm • Official Internal Payment Authorization
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="p-3 border-t bg-slate-50 flex items-center justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
            className="h-8 text-xs cursor-pointer"
            data-testid="close-disbursement-print-button"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
