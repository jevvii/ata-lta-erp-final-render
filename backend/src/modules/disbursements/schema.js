/**
 * Disbursements Zod schemas.
 * Validation for disbursement CRUD and workflow transitions.
 *
 * Authorized Disbursement Lifecycle Redesign (v2)
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

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Date must be a valid calendar date');

const uuidOrEmptySchema = z.union([z.string().guid(), z.literal(''), z.null()]).optional();

/**
 * Schema for creating a disbursement.
 */
const createDisbursementBaseSchema = z
  .object({
    category: z.string().min(1).max(50),
    description: z.string().min(1).max(2000),
    amount: z.number().positive(),
    fundSource: z.enum(FUND_SOURCES),
    clientId: uuidOrEmptySchema,
    employeeId: uuidOrEmptySchema,
    linkedInvoiceId: uuidOrEmptySchema,
    linkedWorkRequestId: uuidOrEmptySchema,
    linked_work_request_id: uuidOrEmptySchema,
    workRequestId: uuidOrEmptySchema,
    work_request_id: uuidOrEmptySchema,
    taskId: uuidOrEmptySchema,
    task_id: uuidOrEmptySchema,
    linkedTaskId: uuidOrEmptySchema,
    linked_task_id: uuidOrEmptySchema,
    linkedTransmittalId: uuidOrEmptySchema,
    dueDate: z.string().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    receiptS3Key: z.string().max(500).optional().nullable(),
    receiptFilename: z.string().max(255).optional().nullable(),
    status: z
      .never({
        message: 'Explicit status cannot be set on creation; status forgery is prohibited',
      })
      .optional(),
    version: z
      .never({
        message: 'Explicit version cannot be set on creation',
      })
      .optional(),
    lifecycle_version: z
      .never({
        message: 'Explicit lifecycle_version cannot be set on creation',
      })
      .optional(),
    lifecycleVersion: z
      .never({
        message: 'Explicit lifecycleVersion cannot be set on creation',
      })
      .optional(),
    review_ready: z
      .never({
        message: 'Explicit review_ready cannot be set on creation',
      })
      .optional(),
    reviewReady: z
      .never({
        message: 'Explicit reviewReady cannot be set on creation',
      })
      .optional(),
  })
  .strict();

const createDisbursementSchema = createDisbursementBaseSchema.superRefine((data, ctx) => {
  if (
    !data.linkedWorkRequestId &&
    !data.linked_work_request_id &&
    !data.workRequestId &&
    !data.work_request_id
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Work request ID is required (linkedWorkRequestId or workRequestId)',
      path: ['linkedWorkRequestId'],
    });
  }

  // Enforce paired receipt metadata (R5 / F9)
  if (data.receiptFilename && !data.receiptS3Key) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'receiptS3Key is required when receiptFilename is provided',
      path: ['receiptS3Key'],
    });
  }

  if (data.receiptS3Key && !data.receiptFilename) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'receiptFilename is required when receiptS3Key is provided',
      path: ['receiptFilename'],
    });
  }
});

const printDetailsSchema = z
  .object({
    requesterName: z.string().max(500).optional(),
    referenceNumber: z.string().max(500).optional(),
    submittedDate: z.string().max(500).optional(),
    workRequestName: z.string().max(500).optional(),
    paymentDate: z.string().max(500).optional(),
    paymentMethod: z.string().max(500).optional(),
    paymentReference: z.string().max(500).optional(),
    paymentBank: z.string().max(500).optional(),
    preparedBy: z.string().max(500).optional(),
    approvedBy: z.string().max(500).optional(),
    releasedBy: z.string().max(500).optional(),
  })
  .strict();

/**
 * Schema for updating a disbursement.
 */
const updateDisbursementSchema = createDisbursementBaseSchema
  .partial()
  .extend({
    printDetails: printDetailsSchema.optional(),
    status: z
      .never({
        message: 'Use workflow action endpoints to change status',
      })
      .optional(),
    archived: z
      .never({
        message: 'Use archive/unarchive endpoints',
      })
      .optional(),
    lifecycle_version: z
      .never({
        message: 'Lifecycle version cannot be modified',
      })
      .optional(),
    lifecycleVersion: z
      .never({
        message: 'Lifecycle version cannot be modified',
      })
      .optional(),
    review_ready: z
      .never({
        message: 'Review ready cannot be modified directly',
      })
      .optional(),
    reviewReady: z
      .never({
        message: 'Review ready cannot be modified directly',
      })
      .optional(),
    // OCC guard (Spec 2.2 / R-10 / v2 lifecycle)
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.printDetails !== undefined && data.expectedVersion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expectedVersion is required for printed voucher edits',
        path: ['expectedVersion'],
      });
    }
    // Reject contradictory payload: clearing key while supplying filename
    if (data.receiptS3Key === null && data.receiptFilename) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cannot set receiptFilename when receiptS3Key is null',
        path: ['receiptFilename'],
      });
    }
  });

/**
 * Schema for approving a disbursement (Admin only, v2 Draft -> Approved).
 */
const approveDisbursementSchema = z
  .object({
    expectedVersion: z.number().int().positive('expectedVersion must be a positive integer'),
  })
  .strict();

/**
 * Schema for funding a disbursement (Accounting/Admin, v2 Approved -> Funded).
 */
const fundDisbursementSchema = z
  .object({
    method: z.enum(['Bank Transfer', 'Check', 'Cash', 'GCash / Maya', 'Other']),
    bank: z.string().trim().min(1, 'Bank is required').max(100),
    reference: z.string().trim().min(1, 'Payment reference is required').max(100),
    date: calendarDateSchema,
    expectedVersion: z.number().int().positive('expectedVersion must be a positive integer'),
  })
  .strict();

/**
 * Schema for releasing payment (Admin only, including the preparer, v2 Funded -> Released).
 */
const releaseDisbursementSchema = z
  .object({
    expectedVersion: z.number().int().positive('expectedVersion must be a positive integer'),
  })
  .strict();

/**
 * Schema for rejecting a disbursement (Admin only, v2 Draft or Funded -> Rejected).
 */
const rejectSchema = z
  .object({
    reason: z.string().trim().min(1, 'Rejection reason is required').max(500),
    expectedVersion: z.number().int().positive('expectedVersion must be a positive integer'),
  })
  .strict();

/**
 * Schema for returning a rejected disbursement to draft (Admin only, v2 Rejected -> Draft).
 */
const resendDraftSchema = z
  .object({
    expectedVersion: z.number().int().positive('expectedVersion must be a positive integer'),
  })
  .strict();

/**
 * Schema for archive and unarchive (Admin only, v2 Released).
 */
const archiveDisbursementSchema = z
  .object({
    expectedVersion: z.number().int().positive('expectedVersion must be a positive integer'),
  })
  .strict();

/**
 * Schema for receipt upload reservation.
 */
const createReceiptUploadSchema = z.object({
  filename: z.string().trim().min(1, 'Filename is required').max(255),
  contentType: z.preprocess((val) => {
    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      if (lower === 'image/jpg' || lower === 'image/pjpeg') return 'image/jpeg';
      return lower;
    }
    return val;
  }, z.enum(['application/pdf', 'image/png', 'image/jpeg'], {
    error: 'contentType must be application/pdf, image/png, or image/jpeg',
  })),
  size: z
    .number()
    .int()
    .positive('Size must be positive')
    .max(10485760, 'Size must not exceed 10 MiB'),
});

/**
 * Schema for updating payment details (retained for backward compatibility, blocked on v2 Funded/Released).
 */
const updatePaymentDetailsSchema = z.object({
  method: z.string().trim().min(1, 'Payment method is required').max(50),
  reference: z.string().trim().max(100).optional().nullable(),
  bank: z.string().trim().max(100).optional().nullable(),
  date: calendarDateSchema,
  expectedVersion: z.number().int().positive('expectedVersion must be a positive integer'),
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
  linkedWorkRequestId: z.string().guid().optional().nullable(),
  linkedInvoiceId: z.string().guid().optional().nullable(),
  linkedTransmittalId: z.string().guid().optional().nullable(),
});

module.exports = {
  createDisbursementSchema,
  updateDisbursementSchema,
  approveDisbursementSchema,
  fundDisbursementSchema,
  releaseDisbursementSchema,
  rejectSchema,
  resendDraftSchema,
  archiveDisbursementSchema,
  createReceiptUploadSchema,
  updatePaymentDetailsSchema,
  disbursementTemplateSchema,
  calendarDateSchema,
  FUND_SOURCES,
  DISBURSEMENT_CATEGORIES,
};
