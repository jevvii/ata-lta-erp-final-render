/**
 * Operations / Work Requests Zod schemas.
 * Phase 4 implementation by Agent A.
 */

const { z } = require('zod');

const checklistItemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  text: z.string().min(1),
  category: z.string().optional().nullable(),
  completed: z.boolean().default(false),
  assigneeId: z.string().uuid().optional().nullable(),
  assigneeName: z.string().optional().nullable(),
  dependsOn: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional().nullable(),
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
  description: z.string().optional().nullable(),
  clientId: z.string().uuid(),
  entity: z.enum(['ATA', 'LTA']),
  status: z.string().max(50).optional(),
  requestedBy: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  dueDate: z.string().optional(),
  priority: z.string().max(50).optional(),
});

const WR_STATUSES = [
  'Draft',
  'Pre-processing',
  'In Progress',
  'Processing',
  'For Review',
  'Billing',
  'Disbursement',
  'On Hold',
  'Completed',
  'Cancelled',
];

const updateWorkRequestSchema = createWorkRequestSchema.partial().extend({
  archived: z.boolean().optional(),
  status: z.enum(WR_STATUSES).optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  status: z.string().max(50).optional(),
  assigneeId: z.string().uuid().optional().nullable(),
  assigneeName: z.string().optional().nullable(),
  predecessors: z.array(z.string().uuid()).optional(),
  dueDate: z.string().optional().nullable(),
  checklist: z.array(checklistItemSchema).optional(),
});

const updateTaskSchema = createTaskSchema.partial();

const taskTemplateSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
});

const retainerTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  schedule: z.string().max(50).optional().nullable(),
  pfAmount: z.number().nonnegative().optional(),
  tasks: z.array(taskTemplateSchema).optional(),
});

const groundWorkerSchema = z.object({
  name: z.string().min(1).max(255),
});

module.exports = {
  createWorkRequestSchema,
  updateWorkRequestSchema,
  createTaskSchema,
  updateTaskSchema,
  checklistItemSchema,
  timeLogSchema,
  retainerTemplateSchema,
  groundWorkerSchema,
};
