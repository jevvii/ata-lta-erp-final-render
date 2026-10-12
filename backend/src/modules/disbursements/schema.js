/**
 * Disbursements Zod schemas.
 * Validation for disbursement CRUD and workflow transitions.
 *
 * Phase 6 — Agent B
 */

const { z } = require('zod');

const FUND_SOURCES = ['Firm Fund', 'Client Fund'];

const DISBURSEMENT_CATEGORIES = [
  'Professional Fee',
  'Government Fee',
  'Supplies',
  'Transportation',
  'Meals',
  'Communication',
  'Printing',
  'Notarial',
  'Filing Fee',
  'Representation',
  'Miscellaneous',
  'Other',
];

/**
 * Schema for creating a disbursement.
 */
const createDisbursementBaseSchema = z.object({
  category: z.string().min(1).max(50),
  description: z.string().min(1).max(2000),
  amount: z.number().positive(),
  fundSource: z.enum(FUND_SOURCES),
  clientId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  linkedInvoiceId: z.string().uuid().optional().nullable(),
  linkedWorkRequestId: z.string().uuid().optional(),
  workRequestId: z.string().uuid().optional(),
  work_request_id: z.string().uuid().optional(),
  taskId: z.string().uuid().optional().nullable(),
  task_id: z.string().uuid().optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  linkedTransmittalId: z.string().uuid().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  receiptS3Key: z.string().max(500).optional().nullable(),
  receiptFilename: z.string().max(255).optional().nullable(),
  status: z.never({
    message: 'Explicit status cannot be set on creation; status forgery is prohibited',
  }).optional(),
});

const createDisbursementSchema = createDisbursementBaseSchema.superRefine((data, ctx) => {
  if (!data.linkedWorkRequestId && !data.workRequestId && !data.work_request_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Work request ID is required (linkedWorkRequestId or workRequestId)',
      path: ['linkedWorkRequestId'],
    });
  }
});

/**
 * Schema for updating a disbursement.
 */
const updateDisbursementSchema = createDisbursementBaseSchema.partial().extend({
  status: z.string().optional(),
  archived: z.boolean().optional(),
  // OCC guard (Spec 2.2 / R-10): update applies only if the stored version matches.
  expectedVersion: z.number().int().positive().optional(),
});

/**
 * Schema for rejecting a disbursement.
 */
const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'Rejection reason is required').max(500),
});

/**
 * Schema for release payment details.
 */
const releasePaymentSchema = z.object({
  method: z.string().max(50).optional(),
  reference: z.string().max(100).optional(),
  bank: z.string().max(100).optional(),
  date: z.string().optional(),
});

/**
 * Schema for a disbursement template.
 */
const disbursementTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().min(1).max(50),
  amount: z.number().nonnegative().default(0),
  fundSource: z.enum(FUND_SOURCES).optional().nullable(),
  schedule: z.string().max(50).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  linkedWorkRequestId: z.string().uuid().optional().nullable(),
  linkedInvoiceId: z.string().uuid().optional().nullable(),
  linkedTransmittalId: z.string().uuid().optional().nullable(),
});

module.exports = {
  createDisbursementSchema,
  updateDisbursementSchema,
  rejectSchema,
  releasePaymentSchema,
  disbursementTemplateSchema,
  FUND_SOURCES,
  DISBURSEMENT_CATEGORIES,
};
