/**
 * Admin / Users Zod schemas.
 * Phase 8 implementation by Agent A.
 */

const { z } = require('zod');

const ALLOWED_DEPARTMENTS = ['Management', 'Accounting', 'Operations', 'Documentation'];

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation']),
  departments: z.array(z.enum(ALLOWED_DEPARTMENTS)).optional(),
  entities: z.array(z.enum(['ATA', 'LTA'])).min(1),
  isActive: z.boolean().default(true),
});

const updateUserSchema = createUserSchema.partial();

const rejectPendingSchema = z.object({
  reason: z.string().min(1).max(500),
});

const createPendingSchema = z.object({
  tableName: z.string().min(1).max(100),
  parentRecordId: z.string().uuid().optional().nullable(),
  proposedData: z.record(z.any()),
});

const listAuditQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  rejectPendingSchema,
  createPendingSchema,
  listAuditQuerySchema,
};
