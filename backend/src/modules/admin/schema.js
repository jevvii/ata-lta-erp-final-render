/**
 * Admin / Users Zod schemas.
 * Phase 8 implementation by Agent A.
 */

const { z } = require('zod');

const ALLOWED_DEPARTMENTS = ['Management', 'Accounting', 'Operations', 'Documentation', 'HR'];

// Spec 2.8 / R-14: minimum length plus character-class complexity so
// admin-provisioned credentials cannot be trivially weak.
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must not exceed 128 characters')
  .regex(/[a-z]/, 'Must include lowercase letter')
  .regex(/[A-Z]/, 'Must include uppercase letter')
  .regex(/[0-9]/, 'Must include number')
  .regex(/[^a-zA-Z0-9]/, 'Must include special character');

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation', 'HR']),
  departments: z.array(z.enum(ALLOWED_DEPARTMENTS)).optional(),
  entities: z.array(z.enum(['ATA', 'LTA'])).min(1),
  isActive: z.boolean().default(true),
  password: passwordSchema.optional(),
});

const updateUserSchema = createUserSchema.partial().extend({
  isActive: z.boolean().optional(),
  status: z.enum(['Active', 'Disabled']).optional(),
  expectedVersion: z.coerce.number().int().positive().optional(),
});

const rejectPendingSchema = z.object({
  reason: z.string().min(1).max(500),
});

const createPendingSchema = z.object({
  tableName: z.string().min(1).max(100),
  parentRecordId: z.string().guid().optional().nullable(),
  proposedData: z.record(z.string(), z.any()),
});

const listAuditQuerySchema = z.object({
  userId: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  table: z.string().min(1).optional(),
  module: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  search: z.string().trim().max(200).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  rejectPendingSchema,
  createPendingSchema,
  listAuditQuerySchema,
  auditQuerySchema: listAuditQuerySchema,
};
