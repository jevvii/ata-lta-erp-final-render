import { z } from 'zod';

export const LINE_ITEM_TYPES = ['Professional Fee', 'Government Fee', 'Other'] as const;

export const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required').max(500, 'Max 500 characters'),
  amount: z.number().min(0, 'Amount must be non-negative'),
  type: z.enum(LINE_ITEM_TYPES).default('Professional Fee'),
  sortOrder: z.number().int().optional(),
});

export const createInvoiceSchema = z
  .object({
    clientId: z.string().uuid('Please select a valid client'),
    workRequestId: z.string().uuid('Please select an associated work request'),
    linkedTaskId: z.string().uuid('Please select a valid linked task').optional().nullable(),
    taskId: z.string().uuid('Please select a valid linked task').optional().nullable(),
    task_id: z.string().uuid('Please select a valid linked task').optional().nullable(),
    linkedTransmittalId: z.string().uuid().optional().nullable(),
    invoiceNumber: z.string().min(1, 'Invoice number is required').max(50, 'Max 50 characters'),
    issueDate: z.string().min(1, 'Issue date is required'),
    dueDate: z.string().min(1, 'Due date is required'),
    status: z.enum(['Draft', 'Pending']).optional().default('Draft'),
    lineItems: z.array(lineItemSchema).min(1, 'At least one line item is required'),
    notes: z.string().max(2000, 'Notes cannot exceed 2000 characters').optional().nullable(),
    terms: z.string().max(2000, 'Terms cannot exceed 2000 characters').optional().nullable(),
  })
  .refine(
    (data) => Boolean(data.linkedTaskId || data.taskId || data.task_id),
    {
      message: 'A valid linked task is required',
      path: ['linkedTaskId'],
    }
  );

export const updateInvoiceSchema = z.object({
  clientId: z.string().uuid().optional(),
  workRequestId: z.string().uuid().optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  linkedTransmittalId: z.string().uuid().optional().nullable(),
  invoiceNumber: z.string().min(1).max(50).optional(),
  issueDate: z.string().optional(),
  dueDate: z.string().optional(),
  status: z.string().max(50).optional(),
  lineItems: z.array(lineItemSchema).min(1).optional(),
  notes: z.string().max(2000).optional().nullable(),
  terms: z.string().max(2000).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  clientAddress: z.string().max(500).optional().nullable(),
  archived: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const updateClientAddressSchema = z.object({
  address: z.string().min(1, 'Address cannot be empty').max(500, 'Max 500 characters'),
});

export const recordPaymentSchema = z.object({
  amount: z.number().positive('Payment amount must be greater than zero'),
  method: z.string().min(1, 'Payment method is required').max(50),
  reference: z.string().max(100, 'Reference cannot exceed 100 characters').optional().nullable(),
  date: z.string().min(1, 'Payment date is required'),
  notes: z.string().max(500, 'Notes cannot exceed 500 characters').optional().nullable(),
});
