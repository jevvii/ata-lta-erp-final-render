/**
 * Zod Validation Schemas for Operations (Module #1)
 *
 * Citation: Frozen API Contract operations@2.0.0 (docs/api-contracts/modules/operations.md)
 * operationsRequests@2.0.0 (docs/api-contracts/modules/operationsRequests.md)
 * retainer-templates@2.0.0 (docs/api-contracts/modules/retainer-templates.md)
 *
 * Compliance:
 * - Strict client-side validation for form submissions & API payload verification
 * - Rejects task phase mutations (TASK_PHASE_IMMUTABLE)
 * - Enforces dependency validation & mandatory audit notes/reasons
 * - Zero `any` types
 */

import { z } from 'zod';

// ============================================================================
// 1. Primitive Enums & Shared Validators
// ============================================================================

export const phaseEnum = z.enum([
  'pre_processing',
  'processing',
  'quality_assurance',
  'completion',
]);

export const creatablePhaseEnum = z.enum(['pre_processing', 'processing']);

export const taskStatusEnum = z.enum([
  'Draft',
  'Assigned',
  'In Progress',
  'For Review',
  'Completed',
  'Cancelled',
]);

export const workRequestStatusEnum = z.enum([
  'Received',
  'For Client Approval',
  'For Requirements',
  'Pending Requirements',
  'For Assignment',
  'In Progress',
  'For Supervisor Review',
  'For Billing',
  'For Payment',
  'For Submission',
  'For Quality Check',
  'Completed',
  'Draft',
  'Pre-processing',
  'Processing',
  'For Review',
  'Quality Assurance',
  'Disbursement',
  'On Hold',
  'Cancelled',
]);

export const qaStatusEnum = z.enum(['none', 'passed', 'failed']);

export const entityCodeEnum = z.enum(['ATA', 'LTA', 'ALL']);

export const priorityEnum = z.enum(['Low', 'Normal', 'Medium', 'High', 'Urgent']);

export const requestTypeEnum = z.enum([
  'wr_phase_transition',
  'billing',
  'disbursement',
  'transmittal',
  'client',
  'workflow',
]);

export const requestStatusEnum = z.enum(['pending', 'fulfilled', 'rejected', 'cancelled']);

export const recurrenceTypeEnum = z.enum(['none', 'annual']);

export const documentCategoryEnum = z.enum([
  'Owner Details',
  'Business Details',
  'SEC',
  'City Hall',
  'BIR',
  'SSS',
  'PhilHealth',
  'Pag-IBIG',
  'IPO',
  'FDA',
  'Labor',
  'Others',
  'CONTRACT',
  'PERMIT',
  'FINANCIAL',
  'CORRESPONDENCE',
  'LEGAL',
  'HR',
  'OTHER',
]);

export const documentLifecycleEnum = z.enum([
  'collected',
  'with_documentations',
  'scanned',
  'in_envelope',
  'stored',
]);

export const documentStatusEnum = z.enum(['active', 'pending_upload', 'failed']);

// Helper for nullable UUID fields
const nullableUuid = z.preprocess(
  (val) => (val === '' || val === undefined ? null : val),
  z.string().uuid().nullable().optional()
);

// ============================================================================
// 2. Child Schemas: Checklists, Time Logs, Phase Tasks
// ============================================================================

export const timeLogInputSchema = z.object({
  id: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'),
  hours: z.number().nonnegative('Hours must be non-negative'),
  startTime: z.string().optional().nullable(),
  endTime: z.string().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  workerName: z.string().max(255).optional().nullable(),
  checklistItemId: z.string().uuid().optional().nullable(),
});

export const checklistItemInputSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  text: z.string().min(1, 'Checklist text cannot be empty'),
  category: z.string().max(100).optional().nullable(),
  completed: z.boolean().default(false),
  assigneeId: nullableUuid,
  assigneeName: z.string().max(255).optional().nullable(),
  dependsOn: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .nullable(),
  periodYear: z.string().max(50).optional().nullable(),
  timeLogs: z.array(timeLogInputSchema).optional(),
});

export const phaseTaskInputSchema = z.object({
  title: z.string().min(1, 'Task title is required').max(255),
  description: z.string().max(2000).optional().nullable(),
  assignees: z.array(z.string().uuid()).optional().default([]),
  depends_on: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .nullable()
    .refine(
      (val) => {
        if (!val) return true;
        if (typeof val === 'string') return val !== '0' && val.trim() !== '';
        return !val.includes('0') && !val.includes('');
      },
      { message: 'Invalid dependency: "0" or empty string not allowed' }
    ),
  dependsOn: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .nullable(),
  local_id: z.string().optional().nullable(),
  localId: z.string().optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  requiredLinkType: z.string().nullable().optional(),
  required_link_type: z.string().nullable().optional(),
  checklist: z.array(checklistItemInputSchema).optional().nullable(),
});

export const createWorkRequestPhasesSchema = z.object({
  pre_processing: z
    .object({
      tasks: z.array(phaseTaskInputSchema).optional().default([]),
    })
    .optional(),
  processing: z
    .object({
      tasks: z.array(phaseTaskInputSchema).optional().default([]),
    })
    .optional(),
});

// ============================================================================
// 3. Work Request Schemas (Create & Update)
// ============================================================================

const workRequestDueDateSchema = z.string({
  required_error: 'Due date is required',
  invalid_type_error: 'Due date is required',
}).min(1, 'Due date is required').pipe(
  z.union([z.string().date(), z.string().datetime({ offset: true })], {
    errorMap: () => ({ message: 'Due date must be a valid date or ISO timestamp' }),
  })
);

export const createWorkRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional().nullable(),
  clientId: nullableUuid,
  entity: entityCodeEnum.optional(),
  status: z.string().max(50).optional(),
  phase: creatablePhaseEnum.optional().default('pre_processing'),
  requestedBy: z.string().uuid().optional(),
  assignedTo: nullableUuid,
  coAssignees: z.array(z.string()).optional().default([]),
  dueDate: workRequestDueDateSchema,
  priority: priorityEnum.optional().default('Normal'),
  idempotency_key: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
  phases: createWorkRequestPhasesSchema.optional().nullable(),
});

export const updateWorkRequestSchema = createWorkRequestSchema
  .omit({ phases: true })
  .partial()
  .extend({
    dueDate: workRequestDueDateSchema.optional().nullable(),
    archived: z.boolean().optional(),
    status: workRequestStatusEnum.optional(),
    expectedVersion: z.number().int().positive().optional(),
  });

// ============================================================================
// 4. Task Schemas (Create & Update)
// ============================================================================

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional().nullable(),
  status: z.string().max(50).optional().default('Draft'),
  phase: creatablePhaseEnum.optional(),
  assigneeId: nullableUuid,
  assigneeName: z.string().max(255).optional().nullable(),
  assignees: z.array(z.string().uuid()).optional().default([]),
  dueDate: z.string().optional().nullable(),
  displayOrder: z.number().int().optional().default(0),
  checklist: z.array(checklistItemInputSchema).optional(),
  timeLogs: z.array(timeLogInputSchema).optional(),
  coAssignees: z.array(z.string().uuid()).optional().nullable(),
  requiredLinkType: z.string().max(50).optional().nullable(),
});

export const updateTaskSchema = createTaskSchema
  .partial()
  .extend({
    // Explicitly reject any attempt to mutate task phase (Rule R5 / TASK_PHASE_IMMUTABLE)
    phase: z.never({ invalid_type_error: 'Task phase is immutable once created' }).optional(),
    expectedVersion: z.number().int().positive().optional(),
    checklistCompletions: z.array(z.object({
      id: z.string().uuid(),
      completed: z.boolean(),
    }).strict()).min(1).optional(),
  });

// ============================================================================
// 5. Phase Transition & Advance Schemas
// ============================================================================

export const advancePhaseSchema = z.object({
  to_phase: z.enum(['processing', 'quality_assurance', 'completion']).optional(),
  toPhase: z.enum(['processing', 'quality_assurance', 'completion']).optional(),
});

export const createPhaseTransitionRequestSchema = z
  .object({
    request_type: z.literal('wr_phase_transition').default('wr_phase_transition'),
    type: z.literal('wr_phase_transition').optional(),
    work_request_id: z.string().uuid('Work request ID is required').optional(),
    workRequestId: z.string().uuid().optional(),
    from_phase: z.enum(['pre_processing', 'processing', 'quality_assurance']).optional(),
    fromPhase: z.enum(['pre_processing', 'processing', 'quality_assurance']).optional(),
    to_phase: z.enum(['processing', 'quality_assurance', 'completion']).optional(),
    toPhase: z.enum(['processing', 'quality_assurance', 'completion']).optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) => Boolean(data.work_request_id || data.workRequestId),
    { message: 'Work request ID is required', path: ['work_request_id'] }
  )
  .refine(
    (data) => Boolean(data.from_phase || data.fromPhase),
    { message: 'Source phase (from_phase) is required', path: ['from_phase'] }
  )
  .refine(
    (data) => Boolean(data.to_phase || data.toPhase),
    { message: 'Target phase (to_phase) is required', path: ['to_phase'] }
  );

export const resolveTransitionRequestSchema = z
  .object({
    status: z.enum(['pending', 'fulfilled', 'rejected', 'cancelled']),
    rejectionReason: z.string().max(2000).optional().nullable(),
    rejection_reason: z.string().max(2000).optional().nullable(),
    fulfilledBy: nullableUuid,
    fulfilled_by: nullableUuid,
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.status === 'rejected') {
        const reason = (data.rejectionReason || data.rejection_reason || '').trim();
        return reason.length > 0;
      }
      return true;
    },
    {
      message: 'rejectionReason is required when status is rejected',
      path: ['rejectionReason'],
    }
  );

// ============================================================================
// 6. QA Review & Reroute Schemas
// ============================================================================

export const qaReviewTaskResultSchema = z
  .object({
    task_id: z.string().uuid('Invalid task ID').optional(),
    taskId: z.string().uuid().optional(),
    qa_status: z.enum(['passed', 'failed']).optional(),
    qaStatus: z.enum(['passed', 'failed']).optional(),
  })
  .refine(
    (data) => Boolean((data.task_id || data.taskId) && (data.qa_status || data.qaStatus)),
    { message: 'Each evaluation must include task_id and qa_status' }
  );

export const qaReviewSchema = z.object({
  results: z.array(qaReviewTaskResultSchema).min(1, 'At least one task review required'),
});

export const rerouteSchema = z
  .object({
    to_phase: z.enum(['pre_processing', 'processing']).optional(),
    toPhase: z.enum(['pre_processing', 'processing']).optional(),
    reason: z.string().trim().min(1, 'Reroute reason is mandatory for audit logging'),
  })
  .refine((data) => Boolean(data.to_phase || data.toPhase), {
    message: 'to_phase must be either pre_processing or processing',
    path: ['to_phase'],
  });

// ============================================================================
// 7. Retainer Template & Generation Schemas
// ============================================================================

export const retainerTemplateTaskSchema = z.object({
  id: z.string().optional().nullable(),
  local_id: z.string().optional().nullable(),
  localId: z.string().optional().nullable(),
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(2000).optional().nullable(),
  phase: creatablePhaseEnum.default('pre_processing'),
  default_assignees: z.array(z.string().uuid()).optional(),
  defaultAssignees: z.array(z.string().uuid()).optional(),
  depends_on_local_id: z.string().optional().nullable(),
  dependsOnLocalId: z.string().optional().nullable(),
  requiredLinkType: z.string().max(50).optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

export const retainerTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(255),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  clientId: nullableUuid,
  client_id: nullableUuid,
  schedule: z.string().max(50).optional().nullable(),
  priority: priorityEnum.optional().default('Normal'),
  pfAmount: z.number().nonnegative().optional().default(0),
  pf_amount: z.number().nonnegative().optional(),
  recurrence: recurrenceTypeEnum.default('none'),
  tasks: z.array(retainerTemplateTaskSchema).optional().default([]),
});

export const generateRetainerTemplateTaskOverrideSchema = z.object({
  local_id: z.string().min(1).optional(),
  localId: z.string().min(1).optional(),
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional().nullable(),
  phase: z.enum(['pre_processing', 'processing']).optional(),
  assignees: z.array(z.string()).optional(),
  assigneeId: z.string().optional().nullable(),
  coAssignees: z.array(z.string()).optional(),
  depends_on: z.string().optional().nullable(),
  dependsOn: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  due_date: z.string().optional().nullable(),
});

export const generateRetainerTemplateSchema = z.object({
  period_label: z.string().trim().min(1).max(50).optional().nullable(),
  periodLabel: z.string().trim().min(1).max(50).optional().nullable(),
  overrides: z
    .object({
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(2000).optional().nullable(),
      clientId: nullableUuid,
      client_id: nullableUuid,
      priority: priorityEnum.optional(),
      assignedTo: nullableUuid,
      assigned_to: nullableUuid,
      coAssignees: z.array(z.string()).optional(),
      co_assignees: z.array(z.string()).optional(),
      dueDate: workRequestDueDateSchema.optional(),
      due_date: workRequestDueDateSchema.optional(),
      tasks: z.array(generateRetainerTemplateTaskOverrideSchema).optional(),
    })
    .optional(),
}).refine((data) => Boolean(data.overrides?.dueDate || data.overrides?.due_date), {
  message: 'Due date is required',
  path: ['overrides', 'dueDate'],
});

// ============================================================================
// 8. DMS Document Schemas
// ============================================================================

export const createDmsDocumentSchema = z.object({
  fileName: z.string().min(1, 'File name is required').max(255),
  contentType: z.string().max(100).optional().nullable(),
  fileSize: z.number().int().nonnegative().optional().nullable(),
  originalName: z.string().max(255).optional(),
  workRequestId: nullableUuid,
  linkedTaskId: nullableUuid,
  clientId: nullableUuid,
  documentType: z.string().max(100).optional(),
  category: documentCategoryEnum.optional(),
  description: z.string().max(2000).optional(),
  externalUrl: z.string().url().max(2000).optional().nullable(),
});

export const updateDmsDocumentCommentsSchema = z.object({
  comments: z.array(
    z.object({
      id: z.string().optional(),
      userId: z.string().min(1, 'User ID is required'),
      date: z.string().min(1, 'Date is required'),
      text: z.string().min(1, 'Comment text is required'),
    })
  ),
});
