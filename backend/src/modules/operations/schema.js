/**
 * Operations / Work Requests Zod schemas.
 * Phase 4 implementation by Agent A.
 */

const { z } = require('zod');

const timeLogSchema = z.object({
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  date: z.string(),
  hours: z.number().nonnegative(),
  userId: z.string().uuid().optional().nullable(),
  note: z.string().optional().nullable(),
  workerName: z.string().optional().nullable(),
  checklistItemId: z.string().uuid().optional().nullable(),
});

const checklistItemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  text: z.string().min(1),
  category: z.string().optional().nullable(),
  completed: z.boolean().default(false),
  assigneeId: z.string().uuid().optional().nullable(),
  assigneeName: z.string().optional().nullable(),
  dependsOn: z.union([z.string().uuid(), z.array(z.string().uuid())]).optional().nullable(),
  timeLogs: z.array(timeLogSchema).optional(),
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
  timeLogs: z.array(timeLogSchema).optional(),
  coAssignees: z.array(z.string().uuid()).optional().nullable(),
  taskDocuments: z.array(z.any()).optional().nullable(),
});

const updateTaskSchema = createTaskSchema.partial();

const nullableUuid = z.preprocess(val => (val === '' || val === undefined) ? null : val, z.string().uuid().nullable().optional());

const taskTemplateSchema = z.object({
  id: z.string().optional().nullable(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  assigneeId: nullableUuid,
  assigneeName: z.string().optional().nullable(),
  coAssignees: z.array(z.string().uuid()).optional().nullable(),
  predecessors: z.array(z.string()).optional().nullable(),
});

const retainerTemplateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  clientId: nullableUuid,
  schedule: z.string().max(50).optional().nullable(),
  priority: z.string().max(50).optional().nullable(),
  assignedTo: nullableUuid,
  pfAmount: z.number().nonnegative().optional().nullable(),
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
