/**
 * Document Zod schemas.
 * Validation schemas for document metadata CRUD and lifecycle transitions.
 *
 * Phase 3 — Agent B
 */

const { z } = require('zod');

const DOCUMENT_CATEGORIES = [
  'SEC',
  'BIR',
  'CONTRACT',
  'PERMIT',
  'FINANCIAL',
  'CORRESPONDENCE',
  'LEGAL',
  'HR',
  'OTHER',
];

const LIFECYCLE_STATES = ['collected', 'with_documentations', 'scanned', 'in_envelope', 'stored'];

const MAX_FILE_SIZE_BYTES = process.env.MAX_FILE_SIZE_BYTES
  ? parseInt(process.env.MAX_FILE_SIZE_BYTES, 10)
  : 50 * 1024 * 1024; // 50 MB

/**
 * Schema for creating document metadata (step 1 of upload flow).
 */
const createDocumentSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100).optional().nullable(),
  fileSize: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .nullable()
    .refine((val) => {
      if (val === null || val === undefined) return true;
      return val <= MAX_FILE_SIZE_BYTES;
    }, {
      message: `File size exceeds maximum allowed limit of ${MAX_FILE_SIZE_BYTES} bytes`,
    }),
  originalName: z.string().max(255).optional(),
  workRequestId: z.string().uuid().optional().nullable(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  documentType: z.string().max(100).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  description: z.string().max(2000).optional(),
  externalUrl: z.string().max(2000).optional().nullable(),
});

/**
 * Schema for updating document metadata.
 */
const updateDocumentSchema = z.object({
  documentType: z.string().max(100).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  description: z.string().max(2000).optional(),
  linkedTaskId: z.string().uuid().optional().nullable(),
  externalUrl: z.string().max(2000).optional().nullable(),
  scannedBy: z.string().max(255).optional(),
  envelopeId: z.string().max(100).optional(),
  storedLocation: z.string().max(255).optional(),
  handoverLog: z
    .array(
      z.object({
        handed_to: z.string().min(1),
        handed_date: z.string().min(1),
        method: z.string().min(1),
        notes: z.string().optional(),
      })
    )
    .optional(),
  archived: z.boolean().optional(),
  comments: z
    .array(
      z.object({
        userId: z.string().min(1),
        date: z.string().min(1),
        text: z.string().min(1),
      })
    )
    .optional(),
  versions: z
    .array(
      z.object({
        version: z.number().int().positive(),
        fileName: z.string().min(1),
        uploader: z.string().min(1),
        uploadDate: z.string().min(1),
      })
    )
    .optional(),
});

/**
 * Schema for lifecycle state transitions.
 */
const lifecycleSchema = z.object({
  lifecycle: z.enum(LIFECYCLE_STATES),
});

module.exports = {
  createDocumentSchema,
  updateDocumentSchema,
  lifecycleSchema,
  DOCUMENT_CATEGORIES,
  LIFECYCLE_STATES,
};
