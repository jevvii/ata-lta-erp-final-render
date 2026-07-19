/**
 * Billing / Invoices Zod schemas.
 * Validation for invoices, payments, and billing templates.
 *
 * Phase 5 — Agent B
 */

const { z } = require('zod');

const LINE_ITEM_TYPES = ['Professional Fee', 'Government Fee', 'Other'];

/**
 * Schema for a single invoice line item.
 */
const lineItemSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().nonnegative(),
  type: z.enum(LINE_ITEM_TYPES).default('Professional Fee'),
});

/**
 * Schema for creating an invoice.
 */
const createInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  workRequestId: z.string().uuid().optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  invoiceNumber: z.string().min(1).max(50),
  issueDate: z.string().min(1),
  dueDate: z.string().min(1),
  status: z.string().max(50).optional(),
  lineItems: z.array(lineItemSchema).min(1),
  notes: z.string().max(2000).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for updating an invoice.
 */
const updateInvoiceSchema = z.object({
  clientId: z.string().uuid().optional(),
  workRequestId: z.string().uuid().optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  invoiceNumber: z.string().min(1).max(50).optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.string().max(50).optional(),
  lineItems: z.array(lineItemSchema).min(1).optional(),
  notes: z.string().max(2000).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
  archived: z.boolean().optional(),
});

/**
 * Schema for recording a payment.
 */
const recordPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.string().min(1).max(50),
  reference: z.string().max(100).optional().nullable(),
  date: z.string().min(1),
  notes: z.string().max(500).optional().nullable(),
});

/**
 * Schema for a billing template.
 */
const billingTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  clientId: z.string().uuid().optional().nullable(),
  schedule: z.string().max(50).optional().nullable(),
  pfAmount: z.number().nonnegative().optional(),
  lineItems: z.array(lineItemSchema).optional(),
});

module.exports = {
  lineItemSchema,
  createInvoiceSchema,
  updateInvoiceSchema,
  recordPaymentSchema,
  billingTemplateSchema,
};
