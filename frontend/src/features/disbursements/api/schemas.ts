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
  employeeId: z.string().max(100).nullable().optional(),
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
  printDetails: z.object({
    requesterName: z.string().max(500).optional(), referenceNumber: z.string().max(500).optional(),
    submittedDate: z.string().max(500).optional(), workRequestName: z.string().max(500).optional(),
    paymentDate: z.string().max(500).optional(), paymentMethod: z.string().max(500).optional(),
    paymentReference: z.string().max(500).optional(), paymentBank: z.string().max(500).optional(),
    preparedBy: z.string().max(500).optional(), approvedBy: z.string().max(500).optional(), releasedBy: z.string().max(500).optional(),
  }).strict().optional(),
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
  expectedVersion: z.number().int().positive().optional(),
});

export const rejectSchema = rejectDisbursementSchema;

/**
 * Client validation schema for releasing payment details (legacy and v2).
 */
export const releasePaymentSchema = z.object({
  method: z.string().max(50, 'Payment method cannot exceed 50 characters').optional(),
  reference: z.string().max(100, 'Payment reference cannot exceed 100 characters').optional(),
  bank: z.string().max(100, 'Bank name cannot exceed 100 characters').optional(),
  date: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

/**
 * Client validation schema for v2 final release (Admin including the preparer).
 */
export const releaseDisbursementSchema = z.object({
  expectedVersion: z
    .number({ required_error: 'Expected version is required' })
    .int('Expected version must be an integer')
    .positive('Expected version must be a positive integer'),
});

/**
 * Client validation schema for Admin budget approval (POST /:id/approve).
 * V2 budget authorization requires only expectedVersion; payment fields belong to Funding.
 */
export const approveDisbursementSchema = z.object({
  expectedVersion: z
    .number({ required_error: 'Expected version is required' })
    .int('Expected version must be an integer')
    .positive('Expected version must be a positive integer'),
});

/**
 * Client validation schema for v2 payment preparation (POST /:id/fund).
 * Requires all four trimmed valid fields and expectedVersion.
 */
export const fundDisbursementSchema = z.object({
  method: z
    .string({ required_error: 'Payment method is required' })
    .trim()
    .min(1, 'Payment method is required')
    .max(50, 'Payment method cannot exceed 50 characters'),
  bank: z
    .string({ required_error: 'Bank or payment source is required' })
    .trim()
    .min(1, 'Bank or payment source is required')
    .max(100, 'Bank name cannot exceed 100 characters'),
  reference: z
    .string({ required_error: 'Payment reference is required' })
    .trim()
    .min(1, 'Payment reference is required')
    .max(100, 'Payment reference cannot exceed 100 characters'),
  date: z
    .string({ required_error: 'Payment date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid date YYYY-MM-DD is required'),
  expectedVersion: z
    .number({ required_error: 'Expected version is required' })
    .int('Expected version must be an integer')
    .positive('Expected version must be a positive integer'),
});

/**
 * Client validation schema for resending a rejected voucher to draft (POST /:id/resend_draft).
 */
export const resendDraftSchema = z.object({
  expectedVersion: z
    .number({ required_error: 'Expected version is required' })
    .int('Expected version must be an integer')
    .positive('Expected version must be a positive integer'),
});

/**
 * Client validation schema for payment detail updates.
 */
export const updatePaymentDetailsSchema = z.object({
  method: z
    .string({ required_error: 'Payment method is required' })
    .trim()
    .min(1, 'Payment method is required')
    .max(50, 'Payment method cannot exceed 50 characters'),
  reference: z
    .string()
    .trim()
    .max(100, 'Payment reference cannot exceed 100 characters')
    .nullable()
    .optional(),
  bank: z
    .string()
    .trim()
    .max(100, 'Bank name cannot exceed 100 characters')
    .nullable()
    .optional(),
  date: z
    .string({ required_error: 'Payment date is required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid date YYYY-MM-DD is required'),
  expectedVersion: z
    .number({ required_error: 'Expected version is required' })
    .int('Expected version must be an integer')
    .positive('Expected version must be a positive integer'),
});

/**
 * Client validation schema for pre-signed receipt upload reservation.
 */
export const receiptUploadReservationSchema = z.object({
  filename: z
    .string({ required_error: 'Filename is required' })
    .trim()
    .min(1, 'Filename is required')
    .max(255, 'Filename cannot exceed 255 characters'),
  contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg'], {
    errorMap: () => ({ message: 'Only PDF, PNG, and JPEG files are allowed' }),
  }),
  size: z
    .number({ required_error: 'File size is required' })
    .int()
    .positive('File size must be positive')
    .max(10485760, 'File size cannot exceed 10 MiB'),
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
  queue: z
    .enum([
      'initial_requests',
      'payment_releases',
      'ready_for_funding',
      'needs_correction',
    ])
    .optional(),
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
  pending: z.number().nonnegative().optional(),
  initialRequests: z.number().nonnegative().optional(),
  paymentReleases: z.number().nonnegative().optional(),
  readyForFunding: z.number().nonnegative().optional(),
  needsCorrection: z.number().nonnegative().optional(),
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
