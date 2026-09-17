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

/**
 * Schema for creating a transmittal.
 */
const createTransmittalSchema = z.object({
  clientId: z.string().uuid(),
  workRequestId: z.string().uuid(),
  trackingNumber: z.string().min(1).max(50),
  items: z.array(transmittalItemSchema).min(1),
  notes: z.string().max(2000).optional().nullable(),
  recipientName: z.string().max(255).optional().nullable(),
  recipientDetails: z.string().max(1000).optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
});

/**
 * Schema for updating a transmittal (only in Draft status).
 */
const updateTransmittalSchema = z.object({
  clientId: z.string().uuid().optional(),
  workRequestId: z.string().uuid().optional().nullable(),
  trackingNumber: z.string().min(1).max(50).optional(),
  items: z.array(transmittalItemSchema).min(1).optional(),
  notes: z.string().max(2000).optional().nullable(),
  recipientName: z.string().max(255).optional().nullable(),
  recipientDetails: z.string().max(1000).optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  boardOrder: z.number().int().optional(),
  // OCC guard (Spec 2.2 / R-10): update applies only if the stored version matches.
  expectedVersion: z.number().int().positive().optional(),
});

module.exports = {
  transmittalItemSchema,
  createTransmittalSchema,
  updateTransmittalSchema,
};
