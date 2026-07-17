/**
 * Admin / Users Zod schemas.
 * Phase 8 implementation by Agent A.
 */

const { z } = require('zod');

const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  role: z.enum(['Admin', 'Manager', 'Accounting', 'Operations', 'Documentation', 'HR']),
  departments: z.array(z.string()).optional(),
  entities: z.array(z.enum(['ATA', 'LTA'])).min(1),
  isActive: z.boolean().default(true),
});

const updateUserSchema = createUserSchema.partial();

const rejectPendingSchema = z.object({
  reason: z.string().min(1).max(500),
});

module.exports = {
  createUserSchema,
  updateUserSchema,
  rejectPendingSchema,
};
