import type { InvoicePrintDetails } from '@/lib/printDocuments';

export const PRINT_DETAIL_FIELDS: Array<[keyof InvoicePrintDetails, string]> = [
  ['clientName', 'Bill to name'],
  ['clientTin', 'Bill to TIN'],
  ['paymentDate', 'Payment date'],
  ['cash', 'Cash'],
  ['checkNumber', 'Date / check number'],
  ['bankBranch', 'Bank / branch'],
  ['notedBy', 'Noted by'],
  ['preparedBy', 'Prepared by'],
  ['receivedBy', 'Received by'],
];
