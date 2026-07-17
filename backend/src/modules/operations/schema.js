/**
 * Operations / Work Requests Zod schemas.
 * Phase 4 implementation by Agent A.
 */

const { z } = require('zod');

const checklistItemSchema = z.object({
  text: z.string().min(1),
  category: z.string().optional(),
  completed: z.boolean().default(false),
  assigneeId: z.string().uuid().optional(),
  assigneeName: z.string().optional(),
});

const timeLogSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  date: z.string(),
  hours: z.number().nonnegative(),
  userId: z.string().uuid().optional(),
  note: z.string().optional(),
});

const createWorkRequestSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  clientId: z.string().uuid(),
  entity: z.enum(['ATA', 'LTA']),
  status: z.string().max(50).optional(),
  requestedBy: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  dueDate: z.string().optional(),
});

const updateWorkRequestSchema = createWorkRequestSchema.partial();

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  status: z.string().max(50).optional(),
  assigneeId: z.string().uuid().optional(),
  assigneeName: z.string().optional(),
  predecessors: z.array(z.string().uuid()).optional(),
  dueDate: z.string().optional(),
  checklist: z.array(checklistItemSchema).optional(),
});

const updateTaskSchema = createTaskSchema.partial();

module.exports = {
  createWorkRequestSchema,
  updateWorkRequestSchema,
  createTaskSchema,
  updateTaskSchema,
  checklistItemSchema,
  timeLogSchema,
};
