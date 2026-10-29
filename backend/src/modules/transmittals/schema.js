/**
 * Transmittals Zod schemas.
 * Validation for transmittal CRUD and workflow transitions.
 *
 * Phase 6 — Agent B
 */

const { z } = require('zod');

/**
 * Schema for a transmittal line item.
 */
const transmittalItemSchema = z.object({
  description: z.string().min(1).max(255),
  documentType: z.string().max(50).optional().nullable(),
  quantity: z.number().int().positive().default(1),
});

const linkedTaskIdSchema = z
  .preprocess(
    (val) => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === 'string' && val.trim() === '') return null;
      if (typeof val !== 'string') return '__INVALID_UUID__';
      return val;
    },
    z
      .string()
      .guid({ message: 'A valid linked task is required for transmittals' })
      .optional()
      .nullable()
  );

/**
 * Schema for creating a transmittal.
 */
const createTransmittalSchema = z.object({
  clientId: z.string().guid(),
  workRequestId: z.string().guid(),
  trackingNumber: z.string().min(1).max(50).optional(),
  items: z.array(transmittalItemSchema).min(1),
  notes: z.string().max(2000).optional().nullable(),
  recipientName: z.string().max(255).optional().nullable(),
  recipientDetails: z.string().max(1000).optional().nullable(),
  linkedTaskId: linkedTaskIdSchema,
  linkedDisbursementIds: z.array(z.string().uuid()).optional(),
  linkedInvoiceIds: z.array(z.string().uuid()).optional(),
});

/**
 * Schema for updating a transmittal (Draft status, or Admin corrections).
 */
const updateTransmittalSchema = z.object({
  clientId: z.string().guid().optional(),
  workRequestId: linkedTaskIdSchema,
  items: z.array(transmittalItemSchema).min(1).optional(),
  notes: z.string().max(2000).optional().nullable(),
  recipientName: z.string().max(255).optional().nullable(),
  recipientDetails: z.string().max(1000).optional().nullable(),
  linkedTaskId: linkedTaskIdSchema,
  linkedDisbursementIds: z.array(z.string().uuid()).optional(),
  linkedInvoiceIds: z.array(z.string().uuid()).optional(),
  boardOrder: z.number().int().optional(),
  // OCC guard (Spec 2.2 / R-10): update applies only if the stored version matches.
  expectedVersion: z.number().int().positive().optional(),
});

module.exports = {
  transmittalItemSchema,
  createTransmittalSchema,
  updateTransmittalSchema,
};
