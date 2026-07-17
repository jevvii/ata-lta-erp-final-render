/**
 * Disbursements Zod schemas.
 * Validation for disbursement CRUD and workflow transitions.
 *
 * Phase 6 — Agent B
 */

const { z } = require('zod');

const FUND_SOURCES = ['Firm Fund', 'Client Fund'];

const DISBURSEMENT_CATEGORIES = [
  'Professional Fee', 'Government Fee', 'Supplies', 'Transportation',
  'Meals', 'Communication', 'Printing', 'Notarial', 'Filing Fee',
  'Representation', 'Miscellaneous', 'Other',
];

/**
 * Schema for creating a disbursement.
 */
const createDisbursementSchema = z.object({
  category: z.string().min(1).max(50),
  description: z.string().min(1).max(2000),
  amount: z.number().positive(),
  fundSource: z.enum(FUND_SOURCES),
  clientId: z.string().uuid().optional().nullable(),
  employeeId: z.string().uuid().optional().nullable(),
  linkedInvoiceId: z.string().uuid().optional().nullable(),
  linkedWorkRequestId: z.string().uuid().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for updating a disbursement (only in Draft status).
 */
const updateDisbursementSchema = createDisbursementSchema.partial();

/**
 * Schema for rejecting a disbursement.
 */
const rejectSchema = z.object({
  reason: z.string().min(1).max(500),
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

module.exports = {
  createDisbursementSchema,
  updateDisbursementSchema,
  rejectSchema,
  releasePaymentSchema,
  FUND_SOURCES,
  DISBURSEMENT_CATEGORIES,
};
