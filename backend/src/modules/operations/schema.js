/**
 * Operations / Work Requests Zod schemas.
 * Phase 4 implementation by Agent A.
 */

const { z } = require('zod');
const { entryDateSchema } = require('../timeEntries/schema');

const timeLogTimestampSchema = z.string().refine((value) =>
  /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value) ||
  (/^\d{4}-\d{2}-\d{2}[T ]/.test(value) && !Number.isNaN(Date.parse(value))),
'Use HH:mm, HH:mm:ss, or a valid timestamp').optional().nullable();

const timeLogSchema = z.object({
  startTime: timeLogTimestampSchema,
  endTime: timeLogTimestampSchema,
  date: entryDateSchema,
  hours: z.number().min(1 / 60).max(24),
  userId: z.string().uuid().optional().nullable(),
  note: z.string().max(5000).optional().nullable(),
  workerName: z.string().optional().nullable(),
  checklistItemId: z.string().uuid().optional().nullable(),
});

const checklistItemSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  text: z.string().min(1),
  category: z.string().optional().nullable(),
  completed: z.boolean().default(false).optional(),
  assigneeId: z.string().uuid().optional().nullable(),
  assignee_id: z.string().uuid().optional().nullable(),
  assigneeName: z.string().optional().nullable(),
  assignee_name: z.string().optional().nullable(),
  dependsOn: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .nullable(),
  depends_on: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .nullable(),
  periodYear: z
    .union([z.string().regex(/^[a-zA-Z0-9\s/-]*$/).max(100), z.number()])
    .optional()
    .nullable(),
  period_year: z
    .union([z.string().regex(/^[a-zA-Z0-9\s/-]*$/).max(100), z.number()])
    .optional()
    .nullable(),
});

const phaseTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  assignees: z.array(z.string()).optional().default([]),
  depends_on: z.any().optional().nullable(),
  dependsOn: z.any().optional().nullable(),
  local_id: z.string().optional().nullable(),
  localId: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  requiredLinkType: z.string().max(50).optional().nullable(),
  required_link_type: z.string().max(50).optional().nullable(),
  checklist: z.array(checklistItemSchema).optional().nullable(),
});

const phasesSchema = z
  .object({
    pre_processing: z
      .object({
        tasks: z.array(phaseTaskSchema).optional().default([]),
      })
      .optional(),
    processing: z
      .object({
        tasks: z.array(phaseTaskSchema).optional().default([]),
      })
      .optional(),
  })
  .passthrough();

const workRequestDueDateSchema = z.string({
  required_error: 'Due date is required',
  invalid_type_error: 'Due date is required',
}).min(1, 'Due date is required').pipe(
  z.union([z.string().date(), z.string().datetime({ offset: true })], {
    errorMap: () => ({ message: 'Due date must be a valid date or ISO timestamp' }),
  })
);

const createWorkRequestSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  entity: z.enum(['ATA', 'LTA', 'ALL']).optional(),
  status: z.string().max(50).optional(),
  phase: z.string().max(50).optional(),
  requestedBy: z.string().uuid().optional(),
  assignedTo: z.preprocess(
    (val) => (val === '' || val === undefined ? null : val),
    z.string().uuid().nullable().optional()
  ),
  coAssignees: z.array(z.string()).optional().default([]),
  dueDate: workRequestDueDateSchema,
  priority: z.string().max(50).optional(),
  idempotency_key: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
  phases: phasesSchema.optional().nullable(),
});

const WR_STATUSES = [
  'Draft',
  'Pre-processing',
  'In Progress',
  'Processing',
  'For Review',
  'Quality Assurance',
  'Billing',
  'Disbursement',
  'On Hold',
  'Completed',
  'Cancelled',
  'Received',
  'For Client Approval',
  'For Requirements',
  'Pending Requirements',
  'For Assignment',
  'For Supervisor Review',
  'For Billing',
  'For Payment',
  'For Submission',
  'For Quality Check',
];

const updateWorkRequestSchema = createWorkRequestSchema.partial().extend({
  dueDate: workRequestDueDateSchema.optional().nullable(),
  archived: z.boolean().optional(),
  status: z.enum(WR_STATUSES).optional(),
  // OCC guard (Spec 2.2 / R-10): update applies only if the stored version matches.
  expectedVersion: z.number().int().positive().optional(),
});

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  status: z.string().max(50).optional(),
  phase: z.enum(['pre_processing', 'processing']).optional(),
  assigneeId: z.string().uuid().optional().nullable(),
  assigneeName: z.string().optional().nullable(),
  assignees: z.array(z.string().uuid()).optional().nullable(),
  predecessors: z.array(z.string().uuid()).optional(),
  dueDate: z.string().optional().nullable(),
  checklist: z.array(checklistItemSchema).optional(),
  coAssignees: z.array(z.string().uuid()).optional().nullable(),
  taskDocuments: z.array(z.any()).optional().nullable(),
  requiredLinkType: z.string().max(50).optional().nullable(),
});

const updateTaskSchema = createTaskSchema
  .partial()
  .extend({
    phase: z.any().optional(),
    // OCC guard (Spec 2.2 / R-10): update applies only if the stored version matches.
    expectedVersion: z.number().int().positive().optional(),
    checklistCompletions: z.array(z.object({
      id: z.string().uuid(),
      completed: z.boolean(),
    }).strict()).min(1).refine((items) => new Set(items.map((item) => item.id)).size === items.length,
      'Checklist item IDs must be unique').optional(),
  })
  .superRefine((data, ctx) => {
    if (data.phase !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Task phase is immutable once created',
        path: ['phase'],
        params: { code: 'TASK_PHASE_IMMUTABLE' },
      });
    }
  });

const nullableUuid = z.preprocess(
  (val) => (val === '' || val === undefined ? null : val),
  z.string().uuid().nullable().optional()
);

const taskTemplateSchema = z.object({
  id: z.string().optional().nullable(),
  local_id: z.string().optional().nullable(),
  localId: z.string().optional().nullable(),
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional().nullable(),
  phase: z.enum(['pre_processing', 'processing']).optional().nullable(),
  assigneeId: nullableUuid,
  assigneeName: z.string().optional().nullable(),
  coAssignees: z.array(z.string()).optional().nullable(),
  default_assignees: z.array(z.string()).optional().nullable(),
  defaultAssignees: z.array(z.string()).optional().nullable(),
  predecessors: z.array(z.string()).optional().nullable(),
  depends_on_local_id: z.string().optional().nullable(),
  dependsOnLocalId: z.string().optional().nullable(),
  requiredLinkType: z.string().max(50).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  checklist: z.array(checklistItemSchema).optional().nullable(),
});

const retainerTemplateBaseSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  clientId: nullableUuid,
  client_id: nullableUuid,
  schedule: z.string().max(50).optional().nullable(),
  priority: z.string().max(50).optional().nullable(),
  pfAmount: z.number().nonnegative().optional().nullable(),
  pf_amount: z.number().nonnegative().optional().nullable(),
  recurrence: z.enum(['none', 'annual']).default('none').optional(),
  templateType: z.enum(['retainer', 'other']).default('retainer').optional(),
  template_type: z.enum(['retainer', 'other']).default('retainer').optional(),
  tasks: z.array(taskTemplateSchema).optional(),
});

const retainerTemplateSchema = retainerTemplateBaseSchema.superRefine((data, ctx) => {
  const hasTitle = Boolean((data.title && data.title.trim()) || (data.name && data.name.trim()));
  if (!hasTitle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Title or name is required',
      path: ['title'],
    });
  }
  const type = data.templateType || data.template_type || 'retainer';
  if (type === 'other') {
    if (!data.tasks || !Array.isArray(data.tasks) || data.tasks.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tasks are required for other templates',
        path: ['tasks'],
      });
    }
  }
});
retainerTemplateSchema.partial = (mask) => retainerTemplateBaseSchema.partial(mask);

const generateTaskOverrideSchema = z.object({
  local_id: z.string().optional().nullable(),
  localId: z.string().optional().nullable(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  phase: z.enum(['pre_processing', 'processing']).optional(),
  assignees: z.array(z.string().uuid()).optional(),
  depends_on: z.string().optional().nullable(),
  dependsOn: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
  requiredLinkType: z.string().max(50).optional().nullable(),
  required_link_type: z.string().max(50).optional().nullable(),
  checklist: z.array(checklistItemSchema).optional().nullable(),
});

const generateRetainerTemplateSchema = z.object({
  period_label: z.string().trim().min(1).max(50).optional().nullable(),
  periodLabel: z.string().trim().min(1).max(50).optional().nullable(),
  overrides: z
    .object({
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(2000).optional().nullable(),
      clientId: nullableUuid,
      client_id: nullableUuid,
      priority: z.string().max(50).optional(),
      assignedTo: nullableUuid,
      assigned_to: nullableUuid,
      coAssignees: z.array(z.string().uuid()).optional(),
      co_assignees: z.array(z.string().uuid()).optional(),
      dueDate: workRequestDueDateSchema.optional(),
      due_date: workRequestDueDateSchema.optional(),
      tasks: z.array(generateTaskOverrideSchema).optional(),
    })
    .optional(),
}).refine((data) => Boolean(data.overrides?.dueDate || data.overrides?.due_date), {
  message: 'Due date is required',
  path: ['overrides', 'dueDate'],
});

const groundWorkerSchema = z.object({
  name: z.string().min(1).max(255),
});

const addTimeLogsSchema = z.object({
  logs: z.array(timeLogSchema),
});

const standardTaskTemplateSchema = z.object({
  title: z.string().min(1).max(255),
  requiredLinkType: z.string().max(50).optional().nullable(),
  defaultChecklist: z
    .array(
      z.object({
        id: z.string().optional().nullable(),
        text: z.string().min(1),
        category: z.string().optional().nullable(),
        periodYear: z.string().optional().nullable(),
      })
    )
    .optional()
    .default([]),
  coAssignees: z.array(z.string()).optional().default([]),
  sortOrder: z.number().int().optional().nullable(),
});

const advanceWorkRequestSchema = z.object({
  to_phase: z.enum(['processing', 'quality_assurance', 'completion']).optional(),
  toPhase: z.enum(['processing', 'quality_assurance', 'completion']).optional(),
});

const qaReviewTaskResultSchema = z
  .object({
    task_id: z.string().uuid().optional(),
    taskId: z.string().uuid().optional(),
    qa_status: z.enum(['passed', 'failed']).optional(),
    qaStatus: z.enum(['passed', 'failed']).optional(),
  })
  .refine(
    (data) => Boolean((data.task_id || data.taskId) && (data.qa_status || data.qaStatus)),
    { message: 'Each result must include task_id and qa_status' }
  );

const qaReviewSchema = z.object({
  results: z.array(qaReviewTaskResultSchema).min(1, 'results array cannot be empty'),
});

const rerouteSchema = z
  .object({
    to_phase: z.enum(['pre_processing', 'processing']).optional(),
    toPhase: z.enum(['pre_processing', 'processing']).optional(),
    reason: z.string().trim().min(1, 'reason is required for reroute'),
  })
  .refine((data) => Boolean(data.to_phase || data.toPhase), {
    message: 'to_phase must be either pre_processing or processing',
  });

const creationApprovalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(2000).optional().nullable(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (data) => data.decision !== 'reject' || (typeof data.reason === 'string' && data.reason.trim().length > 0),
    { message: 'Reason is required when rejecting', path: ['reason'] }
  );

const resubmitCreationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  data: updateWorkRequestSchema.optional(),
});

const taskCreationApprovalDecisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(2000).optional().nullable(),
    expectedVersion: z.number().int().positive(),
  })
  .refine(
    (data) => data.decision !== 'reject' || (typeof data.reason === 'string' && data.reason.trim().length > 0),
    { message: 'Reason is required when rejecting', path: ['reason'] }
  );

const taskResubmitDataSchema = z
  .object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(2000).optional().nullable(),
    dueDate: z.string().optional().nullable(),
    assigneeId: nullableUuid.optional(),
    assignees: z.array(z.string().uuid()).optional().nullable(),
    predecessors: z.array(z.string().uuid()).optional().nullable(),
    requiredLinkType: z.string().max(50).optional().nullable(),
  })
  .strict();

const taskResubmitCreationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  data: taskResubmitDataSchema.optional(),
});

module.exports = {
  workRequestDueDateSchema,
  phaseTaskSchema,
  createWorkRequestSchema,
  updateWorkRequestSchema,
  createTaskSchema,
  updateTaskSchema,
  checklistItemSchema,
  timeLogSchema,
  retainerTemplateSchema,
  groundWorkerSchema,
  addTimeLogsSchema,
  standardTaskTemplateSchema,
  advanceWorkRequestSchema,
  qaReviewSchema,
  rerouteSchema,
  generateRetainerTemplateSchema,
  generateTaskOverrideSchema,
  creationApprovalDecisionSchema,
  resubmitCreationSchema,
  taskCreationApprovalDecisionSchema,
  taskResubmitCreationSchema,
};
