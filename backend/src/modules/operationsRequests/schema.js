/**
 * Operations Requests Zod schemas.
 * Validation for operations request CRUD and workflow transitions.
 */

const { z } = require('zod');

const REQUEST_TYPES = ['billing', 'disbursement', 'transmittal', 'client', 'workflow'];
const REQUEST_STATUSES = ['pending', 'fulfilled', 'rejected', 'cancelled'];

/**
 * Schema for creating an operations request.
 */
const createRequestSchema = z.object({
  type: z.enum(REQUEST_TYPES),
  workRequestId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  amount: z.number().nonnegative().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for updating an operations request.
 */
const updateRequestSchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  notes: z.string().max(2000).optional().nullable(),
  rejectionReason: z.string().max(2000).optional().nullable(),
  fulfilledBy: z.string().uuid().optional().nullable(),
}).refine((data) => {
  if (data.status === 'rejected' && (data.rejectionReason === null || data.rejectionReason === undefined)) {
    return false;
  }
  return true;
}, {
  message: 'rejectionReason is required when status is rejected',
  path: ['rejectionReason'],
});

/**
 * Schema for list query parameters.
 */
const listQuerySchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  workRequestId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  requestedBy: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

module.exports = {
  createRequestSchema,
  updateRequestSchema,
  listQuerySchema,
  REQUEST_TYPES,
  REQUEST_STATUSES,
};
