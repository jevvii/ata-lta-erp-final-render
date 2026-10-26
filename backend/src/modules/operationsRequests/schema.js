/**
 * Operations Requests Zod schemas.
 * Validation for operations request CRUD and workflow transitions.
 */

const { z } = require('zod');

const REQUEST_TYPES = [
  'billing',
  'disbursement',
  'transmittal',
  'client',
  'workflow',
  'wr_phase_transition',
];
const REQUEST_STATUSES = ['pending', 'fulfilled', 'rejected', 'cancelled'];

const uuidOrEmptySchema = z.union([z.string().uuid(), z.literal(''), z.null()]).optional();

/**
 * Schema for creating an operations request.
 */
const createRequestSchema = z
  .object({
    type: z.enum(REQUEST_TYPES).optional(),
    request_type: z.enum(REQUEST_TYPES).optional(),
    workRequestId: uuidOrEmptySchema,
    work_request_id: uuidOrEmptySchema,
    linkedWorkRequestId: uuidOrEmptySchema,
    linked_work_request_id: uuidOrEmptySchema,
    clientId: uuidOrEmptySchema,
    client_id: uuidOrEmptySchema,
    linkedTaskId: uuidOrEmptySchema,
    linked_task_id: uuidOrEmptySchema,
    taskId: uuidOrEmptySchema,
    task_id: uuidOrEmptySchema,
    amount: z.number().nonnegative().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    from_phase: z.string().optional().nullable(),
    fromPhase: z.string().optional().nullable(),
    to_phase: z.string().optional().nullable(),
    toPhase: z.string().optional().nullable(),
    payload: z
      .object({
        work_request_id: uuidOrEmptySchema,
        workRequestId: uuidOrEmptySchema,
        linkedWorkRequestId: uuidOrEmptySchema,
        linked_work_request_id: uuidOrEmptySchema,
        linkedTaskId: uuidOrEmptySchema,
        linked_task_id: uuidOrEmptySchema,
        taskId: uuidOrEmptySchema,
        task_id: uuidOrEmptySchema,
        from_phase: z.string().optional().nullable(),
        fromPhase: z.string().optional().nullable(),
        to_phase: z.string().optional().nullable(),
        toPhase: z.string().optional().nullable(),
      })
      .passthrough()
      .optional()
      .nullable(),
  })
  .passthrough()
  .refine(
    (data) => Boolean(data.type || data.request_type),
    {
      message: 'Either type or request_type is required',
      path: ['type'],
    }
  );

/**
 * Schema for updating an operations request.
 */
const updateRequestSchema = z
  .object({
    status: z.enum(REQUEST_STATUSES).optional(),
    notes: z.string().max(2000).optional().nullable(),
    rejectionReason: z.string().max(2000).optional().nullable(),
    rejection_reason: z.string().max(2000).optional().nullable(),
    fulfilledBy: z.string().uuid().optional().nullable(),
    fulfilled_by: z.string().uuid().optional().nullable(),
  })
  .passthrough()
  .refine(
    (data) => {
      if (data.status === 'rejected') {
        const reason = data.rejectionReason || data.rejection_reason;
        if (!reason || reason.trim() === '') {
          return false;
        }
      }
      return true;
    },
    {
      message: 'rejectionReason is required when status is rejected',
      path: ['rejectionReason'],
    }
  );

/**
 * Schema for list query parameters.
 */
const listQuerySchema = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  workRequestId: z.string().uuid().optional(),
  clientId: z.string().uuid().optional(),
  linkedTaskId: z.string().uuid().optional(),
  requestedBy: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
});

module.exports = {
  createRequestSchema,
  updateRequestSchema,
  listQuerySchema,
  REQUEST_TYPES,
  REQUEST_STATUSES,
};
