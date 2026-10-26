/**
 * Billing / Invoices Zod schemas.
 * Validation for invoices, payments, and billing templates.
 *
 * Phase 5 — Agent B
 */

const { z } = require('zod');

const LINE_ITEM_TYPES = ['Professional Fee', 'Government Fee', 'Other'];

/**
 * Schema for a single invoice line item.
 */
const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().nonnegative(),
  type: z.enum(LINE_ITEM_TYPES).default('Professional Fee'),
});

const uuidOrEmptySchema = z.union([z.string().uuid(), z.literal(''), z.null()]).optional();

/**
 * Schema for creating an invoice.
 */
const createInvoiceSchema = z
  .object({
    clientId: z.string().uuid(),
    workRequestId: z.string().uuid().optional(),
    work_request_id: z.string().uuid().optional(),
    linkedWorkRequestId: z.string().uuid().optional(),
    linked_work_request_id: z.string().uuid().optional(),
    taskId: uuidOrEmptySchema,
    task_id: uuidOrEmptySchema,
    linkedTaskId: uuidOrEmptySchema,
    linked_task_id: uuidOrEmptySchema,
    linkedTransmittalId: z.string().uuid().optional().nullable(),
    invoiceNumber: z.string().min(1).max(50),
    issueDate: z.string().min(1),
    dueDate: z.string().min(1),
    status: z.string().max(50).optional(),
    lineItems: z.array(lineItemSchema).min(1),
    notes: z.string().max(2000).optional().nullable(),
    terms: z.string().max(2000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (!data.workRequestId && !data.work_request_id && !data.linkedWorkRequestId && !data.linked_work_request_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['workRequestId'],
        message: 'workRequestId is required',
      });
    }
  });

const printDetailsSchema = z
  .object({
    clientName: z.string().max(500).optional(),
    clientTin: z.string().max(500).optional(),
    paymentDate: z.string().max(500).optional(),
    cash: z.string().max(500).optional(),
    checkNumber: z.string().max(500).optional(),
    bankBranch: z.string().max(500).optional(),
    notedBy: z.string().max(500).optional(),
    preparedBy: z.string().max(500).optional(),
    receivedBy: z.string().max(500).optional(),
  })
  .strict();

/**
 * Schema for updating an invoice.
 */
const FINANCIAL_FIELDS = [
  'clientId',
  'invoiceNumber',
  'issueDate',
  'dueDate',
  'lineItems',
  'terms',
];

const updateInvoiceSchema = z
  .object({
    printDetails: printDetailsSchema.optional(),
    clientId: z.string().uuid().optional(),
    workRequestId: uuidOrEmptySchema,
    work_request_id: uuidOrEmptySchema,
    linkedWorkRequestId: uuidOrEmptySchema,
    linked_work_request_id: uuidOrEmptySchema,
    taskId: uuidOrEmptySchema,
    task_id: uuidOrEmptySchema,
    linkedTaskId: uuidOrEmptySchema,
    linked_task_id: uuidOrEmptySchema,
    linkedTransmittalId: z.string().uuid().optional().nullable(),
    invoiceNumber: z.string().min(1).max(50).optional(),
    issueDate: z.string().optional(),
    dueDate: z.string().optional(),
    status: z.string().max(50).optional(),
    lineItems: z.array(lineItemSchema).min(1).optional(),
    notes: z.string().max(2000).optional().nullable(),
    terms: z.string().max(2000).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    clientAddress: z.string().max(500).optional().nullable(),
    archived: z.boolean().optional(),
    // OCC guard (Spec 2.2 / R-10): update applies only if the stored version matches.
    expectedVersion: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    const hasFinancialEdit = FINANCIAL_FIELDS.some((field) => data[field] !== undefined);
    if (
      (hasFinancialEdit || data.printDetails !== undefined) &&
      (data.expectedVersion === undefined || data.expectedVersion === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expectedVersion'],
        message: 'expectedVersion is required for financial field and line item edits',
      });
    }
  });

/**
 * Schema for recording a payment.
 */
const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().min(1).max(50),
  reference: z.string().max(100).optional().nullable(),
  date: z.string().min(1),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * Schema for a billing template.
 */
const billingTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  clientId: z.string().uuid().optional().nullable(),
  schedule: z.string().max(50).optional().nullable(),
  pfAmount: z.number().nonnegative().optional(),
  lineItems: z.array(lineItemSchema).optional(),
});

module.exports = {
  lineItemSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  recordPaymentSchema,
  billingTemplateSchema,
};
