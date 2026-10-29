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
    clientId: z.string().guid('Please select a valid client'),
    workRequestId: z.string().guid('Please select an associated work request'),
    linkedTaskId: z.string().guid('Please select a valid linked task').optional().nullable(),
    taskId: z.string().guid('Please select a valid linked task').optional().nullable(),
    task_id: z.string().guid('Please select a valid linked task').optional().nullable(),
    linkedTransmittalId: z.string().guid().optional().nullable(),
    invoiceNumber: z.string().max(50, 'Max 50 characters').optional().nullable(),
    clientNumber: z.string().max(50).optional().nullable(),
    client_number: z.string().max(50).optional().nullable(),
    workRequestNumber: z.string().max(50).optional().nullable(),
    work_request_number: z.string().max(50).optional().nullable(),
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
  clientId: z.string().guid().optional(),
  clientNumber: z.string().max(50).optional().nullable(),
  client_number: z.string().max(50).optional().nullable(),
  workRequestId: z.string().guid().optional().nullable(),
  workRequestNumber: z.string().max(50).optional().nullable(),
  work_request_number: z.string().max(50).optional().nullable(),
  linkedTaskId: z.string().guid().optional().nullable(),
  linkedTransmittalId: z.string().guid().optional().nullable(),
  invoiceNumber: z.string().max(50).optional().nullable(),
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
