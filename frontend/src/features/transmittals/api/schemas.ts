/**
 * Zod validation schemas for Transmittals (Module #5)
 *
 * Citation: Frozen API Contract transmittals@2.0.0 (docs/api-contracts/modules/transmittals.md)
 */

import { z } from 'zod';

export const TRANSMITTAL_STATUSES = ['Draft', 'Sent', 'Acknowledged', 'Cancelled'] as const;

export const DOCUMENT_CATEGORIES = [
  'Tax',
  'SEC',
  'BIR',
  'Contract',
  'Original Copy',
  'Photocopy',
  'Board Resolution',
  'Secretary Certificate',
  'Others',
] as const;

/**
 * Line item schema for document transmittal rows.
 */
export const transmittalItemSchema = z.object({
  description: z
    .string()
    .min(1, 'Description is required')
    .max(255, 'Description must be at most 255 characters'),
  documentType: z
    .string()
    .max(50, 'Document category must be at most 50 characters')
    .optional()
    .nullable(),
  quantity: z
    .number()
    .int('Quantity must be an integer')
    .positive('Quantity must be greater than 0')
    .default(1),
});

/**
 * Schema for creating a new transmittal manifest.
 * Enforces status anti-forgery: creation payload never contains status (server assigns Draft).
 */
export const createTransmittalSchema = z
  .object({
    clientId: z.string().guid('Client ID must be a valid UUID'),
    clientNumber: z.string().max(50).optional().nullable(),
    client_number: z.string().max(50).optional().nullable(),
    workRequestId: z.string().guid('Work request ID must be a valid UUID'),
    workRequestNumber: z.string().max(50).optional().nullable(),
    work_request_number: z.string().max(50).optional().nullable(),
    trackingNumber: z
      .string()
      .min(1, 'Tracking number is required')
      .max(50, 'Tracking number must be at most 50 characters')
      .optional(),
    items: z.array(transmittalItemSchema).min(1, 'At least 1 item is required'),
    notes: z.string().max(2000, 'Notes must be at most 2000 characters').optional().nullable(),
    recipientName: z
      .string()
      .max(255, 'Recipient name must be at most 255 characters')
      .optional()
      .nullable(),
    recipientDetails: z
      .string()
      .max(1000, 'Recipient details must be at most 1000 characters')
      .optional()
      .nullable(),
    linkedTaskId: z
      .string()
      .guid('Linked task ID must be a valid UUID'),
    boardOrder: z.number().int().optional().default(0),
    status: z.never({ message: 'status forgery is prohibited: server assigns initial Draft status' }).optional(),
  })
  .superRefine((data, ctx) => {
    if ('status' in data && data.status !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'status forgery is prohibited: server assigns initial Draft status',
        path: ['status'],
      });
    }
  });

/**
 * Schema for updating an existing transmittal.
 * In non-Draft status, backend allows only boardOrder updates.
 */
export const updateTransmittalSchema = z
  .object({
    clientId: z.string().guid('Client ID must be a valid UUID').optional(),
    clientNumber: z.string().max(50).optional().nullable(),
    client_number: z.string().max(50).optional().nullable(),
    workRequestId: z.string().guid('Work request ID must be a valid UUID').optional(),
    workRequestNumber: z.string().max(50).optional().nullable(),
    work_request_number: z.string().max(50).optional().nullable(),
    trackingNumber: z
      .string()
      .min(1, 'Tracking number is required')
      .max(50, 'Tracking number must be at most 50 characters')
      .optional(),
    items: z
      .array(transmittalItemSchema)
      .min(1, 'Items array if provided must contain at least 1 item')
      .optional(),
    notes: z.string().max(2000, 'Notes must be at most 2000 characters').optional().nullable(),
    recipientName: z
      .string()
      .max(255, 'Recipient name must be at most 255 characters')
      .optional()
      .nullable(),
    recipientDetails: z
      .string()
      .max(1000, 'Recipient details must be at most 1000 characters')
      .optional()
      .nullable(),
    linkedTaskId: z.string().guid('Linked task ID must be a valid UUID').optional(),
    boardOrder: z.number().int().optional(),
    expectedVersion: z.number().int().positive().optional(),
  })
  .refine((data) => !data.workRequestId || Boolean(data.linkedTaskId), {
    message: 'Linked task is required when a work request is associated',
    path: ['linkedTaskId'],
  })
  .refine((data) => !data.linkedTaskId || Boolean(data.workRequestId), {
    message: 'Work request is required when a linked task is associated',
    path: ['workRequestId'],
  });

/**
 * Schema for send action body.
 */
export const sendTransmittalSchema = z.object({
  boardOrder: z.number().int().optional(),
});

/**
 * Schema for acknowledge action body.
 */
export const acknowledgeTransmittalSchema = z.object({
  boardOrder: z.number().int().optional(),
});

// ============================================================================
// Response Schemas
// ============================================================================

export const transmittalItemResponseSchema = z.object({
  id: z.string(),
  transmittal_id: z.string().optional(),
  transmittalId: z.string().optional(),
  description: z.string(),
  document_type: z.string().nullable().optional(),
  documentType: z.string().nullable().optional(),
  quantity: z.number(),
  sort_order: z.number().optional(),
  sortOrder: z.number().optional(),
  created_at: z.string().optional(),
  createdAt: z.string().optional(),
  version: z.number().optional(),
});

export const transmittalResponseSchema = z.object({
  id: z.string(),
  tracking_number: z.string(),
  entity_id: z.string(),
  entity_code: z.string().optional(),
  client_id: z.string(),
  work_request_id: z.string().nullable().optional(),
  linked_task_id: z.string().nullable().optional(),
  status: z.enum(TRANSMITTAL_STATUSES),
  approved: z.boolean(),
  board_order: z.number(),
  notes: z.string().nullable().optional(),
  recipient_name: z.string().nullable().optional(),
  recipient_details: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
  sent_by: z.string().nullable().optional(),
  acknowledged_at: z.string().nullable().optional(),
  acknowledged_by: z.string().nullable().optional(),
  archived: z.boolean(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string().optional(),
  created_by: z.string().nullable().optional(),
  updated_by: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  clients: z
    .object({
      name: z.string(),
      address: z.string().nullable().optional(),
      tin: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  items: z.array(transmittalItemResponseSchema).optional(),
});

export const transmittalsListResponseSchema = z.object({
  data: z.array(transmittalResponseSchema),
  meta: z.object({
    total: z.number(),
    page: z.number(),
    limit: z.number(),
  }),
});

export const transmittalCountsResponseSchema = z.object({
  data: z.object({
    active: z.number(),
    archived: z.number(),
    total: z.number(),
  }),
});
