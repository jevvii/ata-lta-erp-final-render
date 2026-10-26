/**
 * Zod Validation Schemas for Disbursements (Module #4)
 *
 * Citation: Frozen API Contract disbursements@2.0.0 (docs/api-contracts/modules/disbursements.md)
 */

import { z } from 'zod';

export const FUND_SOURCES = ['Firm Fund', 'Client Fund'] as const;

export const DISBURSEMENT_CATEGORIES = [
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
] as const;

export const DISBURSEMENT_STATUSES = [
  'Draft',
  'Submitted',
  'Pending',
  'Pending Admin Approval',
  'Approved',
  'Released',
  'Funded',
  'Rejected',
  'Archived',
  'Cancelled',
] as const;

/**
 * Client validation schema for creating a disbursement record.
 * Strictly prohibits client-supplied initial status (Anti-Forgery Guard).
 */
export const createDisbursementSchema = z.object({
  category: z
    .string()
    .min(1, 'Category is required')
    .max(50, 'Category cannot exceed 50 characters'),
  description: z
    .string()
    .min(1, 'Description is required')
    .max(2000, 'Description cannot exceed 2000 characters'),
  amount: z.number().positive('Amount must be greater than 0'),
  fundSource: z.enum(FUND_SOURCES, {
    errorMap: () => ({ message: 'Fund source must be Firm Fund or Client Fund' }),
  }),
  linkedWorkRequestId: z.string().uuid('Valid Work Request UUID is required'),
  clientId: z.string().uuid('Invalid Client UUID').nullable().optional(),
  employeeId: z.string().uuid('Invalid Employee UUID').nullable().optional(),
  linkedInvoiceId: z.string().uuid('Invalid Invoice UUID').nullable().optional(),
  linkedTaskId: z.string().uuid('Invalid Task UUID').nullable().optional(),
  linkedTransmittalId: z.string().uuid('Invalid Transmittal UUID').nullable().optional(),
  dueDate: z.string().nullable().optional(),
  notes: z.string().max(2000, 'Notes cannot exceed 2000 characters').nullable().optional(),
  receiptS3Key: z.string().max(500, 'Receipt S3 key cannot exceed 500 characters').nullable().optional(),
  receiptFilename: z.string().max(255, 'Receipt filename cannot exceed 255 characters').nullable().optional(),
  // Anti-forgery guard: status MUST NOT be set by the caller
  status: z
    .never({
      message: 'Explicit status cannot be set on creation; status forgery is prohibited',
    })
    .optional(),
});

/**
 * Client validation schema for updating a disbursement.
 */
export const updateDisbursementSchema = createDisbursementSchema.partial().extend({
  archived: z.boolean().optional(),
  expectedVersion: z.number().int().positive('Expected version must be a positive integer').optional(),
});

/**
 * Client validation schema for rejecting a disbursement.
 * Enforces non-empty trimmed reason between 1 and 500 characters.
 */
export const rejectDisbursementSchema = z.object({
  reason: z
    .string({ required_error: 'Rejection reason is required' })
    .trim()
    .min(1, 'Rejection reason is required')
    .max(500, 'Rejection reason cannot exceed 500 characters'),
});

export const rejectSchema = rejectDisbursementSchema;

/**
 * Client validation schema for releasing payment details.
 */
export const releasePaymentSchema = z.object({
  method: z.string().max(50, 'Payment method cannot exceed 50 characters').optional(),
  reference: z.string().max(100, 'Payment reference cannot exceed 100 characters').optional(),
  bank: z.string().max(100, 'Bank name cannot exceed 100 characters').optional(),
  date: z.string().optional(),
});

/**
 * Client validation schema for disbursement query filters.
 */
export const disbursementFiltersSchema = z.object({
  status: z.enum(DISBURSEMENT_STATUSES).optional(),
  category: z.string().optional(),
  fundSource: z.enum(FUND_SOURCES).optional(),
  linkedTaskId: z.string().uuid('Invalid Task UUID').optional(),
  linkedTransmittalId: z.string().uuid('Invalid Transmittal UUID').optional(),
  search: z.string().optional(),
  archived: z.union([z.boolean(), z.string()]).optional(),
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

/**
 * Client validation schema for disbursement badge counts.
 */
export const disbursementCountsSchema = z.object({
  active: z.number().nonnegative(),
  archived: z.number().nonnegative(),
  rejected: z.number().nonnegative(),
  awaitingRelease: z.number().nonnegative(),
});

/**
 * Client validation schema for creating a disbursement template.
 */
export const createDisbursementTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(255),
  category: z.string().min(1, 'Category is required').max(50),
  amount: z.number().nonnegative('Amount must be 0 or positive').default(0),
  fundSource: z.enum(FUND_SOURCES).nullable().optional(),
  schedule: z.string().max(50).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  linkedWorkRequestId: z.string().uuid().nullable().optional(),
  linkedInvoiceId: z.string().uuid().nullable().optional(),
  linkedTransmittalId: z.string().uuid().nullable().optional(),
});
