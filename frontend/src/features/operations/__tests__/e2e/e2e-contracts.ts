import { z } from 'zod';

export type Phase = 'pre_processing' | 'processing' | 'quality_assurance' | 'completion';
export type TaskStatus = 'Draft' | 'Assigned' | 'In Progress' | 'For Review' | 'Completed' | 'Cancelled';
export type QaStatus = 'none' | 'passed' | 'failed';
export type WorkRequestPriority = 'Low' | 'Normal' | 'High' | 'Urgent';
export type WorkRequestEntity = 'ATA' | 'LTA' | 'ALL';
export type RecurrenceType = 'none' | 'annual';

export interface TaskAssignee {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  role?: string;
  assignedBy?: string;
  assignedByName?: string;
  assignedAt: string;
}

export interface Task {
  id: string;
  workRequestId: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  phase: Phase;
  qaStatus: QaStatus;
  assigneeId?: string | null;
  assigneeName?: string | null;
  assignees?: TaskAssignee[];
  dependsOn?: string[] | string | null;
  displayOrder: number;
  dueDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkRequest {
  id: string;
  title: string;
  description?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  entity: 'ATA' | 'LTA';
  status: string;
  phase: Phase;
  priority: WorkRequestPriority;
  requestedBy?: string;
  assignedTo?: string | null;
  assignedToName?: string | null;
  coAssignees?: string[];
  dueDate?: string | null;
  archived: boolean;
  version: number;
  tasks?: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface OperationsRequest {
  id: string;
  requestType: 'wr_phase_transition';
  workRequestId: string;
  fromPhase: Phase;
  toPhase: Phase;
  status: 'pending' | 'fulfilled' | 'rejected' | 'cancelled';
  notes?: string | null;
  rejectionReason?: string | null;
  requestedBy: string;
  requestedByName?: string;
  fulfilledBy?: string | null;
  fulfilledAt?: string | null;
  createdAt: string;
}

export interface RetainerTemplate {
  id: string;
  name: string;
  description?: string | null;
  entity: 'ATA' | 'LTA';
  recurrence: RecurrenceType;
  defaultPriority: WorkRequestPriority;
  active: boolean;
  tasksTemplate?: Array<{ title: string; phase: Phase }>;
  createdAt: string;
}

export interface DmsDocument {
  id: string;
  workRequestId?: string;
  taskId?: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  downloadUrl?: string;
  comments?: Array<{ id: string; author: string; text: string; createdAt: string }>;
  uploadedAt: string;
}

export interface Rfc7807ProblemDetails {
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  code?: string;
  instance?: string;
  errors?: Record<string, string[]>;
}

// Zod Schemas matching authoritative API specifications
export const phaseTaskInputSchema = z.object({
  title: z.string().trim().min(1, 'Task title is required').max(255),
  description: z.string().optional().nullable(),
  assignees: z.array(z.string().guid()).optional().default([]),
  depends_on: z.union([z.string(), z.array(z.string())]).optional().nullable(),
  local_id: z.string().optional().nullable(),
  status: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
});

export const phasesInputSchema = z.object({
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

export const createWorkRequestSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  description: z.string().optional().nullable(),
  clientId: z.string().guid('Invalid client ID').optional().nullable(),
  entity: z.enum(['ATA', 'LTA', 'ALL']).optional(),
  status: z.string().max(50).optional(),
  phase: z.enum(['pre_processing', 'processing']).optional().default('pre_processing'),
  requestedBy: z.string().guid().optional(),
  assignedTo: z.string().guid().optional().nullable(),
  coAssignees: z.array(z.string()).optional().default([]),
  dueDate: z.string().optional().nullable(),
  priority: z.string().max(50).optional().default('Normal'),
  idempotency_key: z.string().optional().nullable(),
  phases: phasesInputSchema.optional().nullable(),
});

export const updateWorkRequestSchema = createWorkRequestSchema.partial().extend({
  archived: z.boolean().optional(),
  status: z.string().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(255),
  description: z.string().optional().nullable(),
  status: z.string().max(50).optional().default('Draft'),
  phase: z.enum(['pre_processing', 'processing']).optional(),
  assigneeId: z.string().guid().optional().nullable(),
  assignees: z.array(z.string().guid()).optional().default([]),
  dueDate: z.string().optional().nullable(),
  displayOrder: z.number().int().optional().default(0),
});

export const updateTaskSchema = createTaskSchema
  .partial()
  .extend({
    phase: z.never().optional(),
    expectedVersion: z.number().int().positive().optional(),
  });

export const advanceWorkRequestSchema = z.object({
  to_phase: z.enum(['processing', 'quality_assurance', 'completion']).optional(),
});

export const qaReviewTaskResultSchema = z.object({
  task_id: z.string().guid('Invalid task ID'),
  qa_status: z.enum(['passed', 'failed']),
});

export const qaReviewSchema = z.object({
  results: z.array(qaReviewTaskResultSchema).min(1, 'At least one task review required'),
});

export const rerouteSchema = z.object({
  to_phase: z.enum(['pre_processing', 'processing']),
  reason: z.string().trim().min(1, 'Reroute reason is mandatory for audit logging'),
});

export const createPhaseTransitionRequestSchema = z.object({
  request_type: z.literal('wr_phase_transition'),
  work_request_id: z.string().guid('Work request ID is required'),
  from_phase: z.enum(['pre_processing', 'processing', 'quality_assurance']),
  to_phase: z.enum(['processing', 'quality_assurance', 'completion']),
  notes: z.string().max(2000).optional(),
});

export const updateOperationsRequestSchema = z
  .object({
    status: z.enum(['pending', 'fulfilled', 'rejected', 'cancelled']),
    rejectionReason: z.string().max(2000).optional().nullable(),
    fulfilledBy: z.string().guid().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.status === 'rejected') {
        return Boolean(data.rejectionReason && data.rejectionReason.trim().length > 0);
      }
      return true;
    },
    { message: 'rejectionReason is required when status is rejected', path: ['rejectionReason'] }
  );

export const generateRetainerTemplateSchema = z.object({
  period_label: z.string().trim().min(1).max(50).optional().nullable(),
  overrides: z
    .object({
      title: z.string().min(1).max(255).optional(),
      description: z.string().max(2000).optional().nullable(),
      clientId: z.string().guid().optional().nullable(),
      priority: z.string().max(50).optional(),
      assignedTo: z.string().guid().optional().nullable(),
      dueDate: z.string().optional().nullable(),
    })
    .optional(),
});

/**
 * Delimiter Tokenizer mirroring backend/src/lib/tokenizer.js
 * Regex: /(?:[,;\n]|\.\s+)/
 */
export function parseTaskDelimiterInput(input: string): {
  tokens: string[];
  count: number;
  exceedsLimit: boolean;
  shouldSplit: boolean;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return { tokens: [], count: 0, exceedsLimit: false, shouldSplit: false };
  }

  // Regex splits on comma, semicolon, newline, or period followed by at least one whitespace
  const splitRegex = /(?:[,;\n]|\.\s+)/;
  const rawParts = input.split(splitRegex);
  const candidates = rawParts
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Splits only if there are >= 2 candidate tokens
  if (candidates.length < 2) {
    return {
      tokens: [trimmed],
      count: 1,
      exceedsLimit: false,
      shouldSplit: false,
    };
  }

  const exceedsLimit = candidates.length > 50;
  return {
    tokens: candidates,
    count: candidates.length,
    exceedsLimit,
    shouldSplit: true,
  };
}

/**
 * Midpoint Board Order Computation
 * First element: first / 2
 * Between elements: (before + after) / 2
 * Last element: last + 1000
 */
export function computeBoardOrder(
  position: 'first' | 'between' | 'last',
  options?: { before?: number; after?: number }
): number {
  if (position === 'first') {
    const next = options?.after ?? 1000;
    return next / 2;
  }
  if (position === 'last') {
    const prev = options?.before ?? 0;
    return prev + 1000;
  }
  const before = options?.before ?? 0;
  const after = options?.after ?? 1000;
  return (before + after) / 2;
}

/**
 * Advancement Gate Verification Rule
 * Evaluates whether tasks satisfy prerequisite criteria to advance phase.
 */
export function evaluateAdvancementGate(
  currentPhase: Phase,
  targetPhase: Phase,
  tasks: Task[]
): {
  allowed: boolean;
  code?: 'GATE_PREREQUISITE_FAILED' | 'INVALID_PHASE_TRANSITION';
  detail?: string;
  incompleteTasks: Task[];
} {
  const phaseOrder: Phase[] = ['pre_processing', 'processing', 'quality_assurance', 'completion'];
  const currentIndex = phaseOrder.indexOf(currentPhase);
  const targetIndex = phaseOrder.indexOf(targetPhase);

  if (targetIndex !== currentIndex + 1) {
    return {
      allowed: false,
      code: 'INVALID_PHASE_TRANSITION',
      detail: `Cannot advance directly from ${currentPhase} to ${targetPhase}. Phases must proceed sequentially.`,
      incompleteTasks: [],
    };
  }

  // Cancelled tasks are strictly excluded from gate checks
  const activeTasks = tasks.filter((t) => t.status !== 'Cancelled');

  if (currentPhase === 'pre_processing') {
    const phaseTasks = activeTasks.filter((t) => t.phase === 'pre_processing');
    const incomplete = phaseTasks.filter((t) => t.status !== 'Completed');
    if (incomplete.length > 0) {
      return {
        allowed: false,
        code: 'GATE_PREREQUISITE_FAILED',
        detail: `Pre-processing phase requires all active tasks to be Completed. Found ${incomplete.length} incomplete tasks.`,
        incompleteTasks: incomplete,
      };
    }
    return { allowed: true, incompleteTasks: [] };
  }

  if (currentPhase === 'processing') {
    const phaseTasks = activeTasks.filter((t) => t.phase === 'processing');
    const incomplete = phaseTasks.filter((t) => t.status !== 'Completed');
    if (incomplete.length > 0) {
      return {
        allowed: false,
        code: 'GATE_PREREQUISITE_FAILED',
        detail: `Processing phase requires all active tasks to be Completed. Found ${incomplete.length} incomplete tasks.`,
        incompleteTasks: incomplete,
      };
    }
    return { allowed: true, incompleteTasks: [] };
  }

  if (currentPhase === 'quality_assurance') {
    const incomplete = activeTasks.filter((t) => t.status !== 'Completed');
    const notPassed = activeTasks.filter((t) => t.qaStatus !== 'passed');
    if (incomplete.length > 0 || notPassed.length > 0) {
      return {
        allowed: false,
        code: 'GATE_PREREQUISITE_FAILED',
        detail: 'Advancement to completion requires all active tasks to be Completed and have qa_status = passed.',
        incompleteTasks: [...new Set([...incomplete, ...notPassed])],
      };
    }
    return { allowed: true, incompleteTasks: [] };
  }

  return { allowed: false, detail: 'Work request is already completed.', incompleteTasks: [] };
}

/**
 * Server-True QA Reroute Logic
 * Reopens ONLY tasks with qa_status === 'failed', setting them to 'In Progress' and qaStatus 'none'.
 * Passed tasks remain untouched.
 */
export function applyQaReroute(
  wr: WorkRequest,
  toPhase: 'pre_processing' | 'processing',
  reason: string
): { updatedWr: WorkRequest; reopenedTasks: Task[] } {
  if (!reason.trim()) {
    throw new Error('Reroute reason is mandatory for audit logging');
  }

  const tasks = wr.tasks ?? [];
  const reopenedTasks: Task[] = [];
  const updatedTasks = tasks.map((t) => {
    if (t.qaStatus === 'failed') {
      const reopened: Task = {
        ...t,
        status: 'In Progress',
        qaStatus: 'none',
        updatedAt: new Date().toISOString(),
      };
      reopenedTasks.push(reopened);
      return reopened;
    }
    return t;
  });

  const updatedWr: WorkRequest = {
    ...wr,
    phase: toPhase,
    version: wr.version + 1,
    tasks: updatedTasks,
    updatedAt: new Date().toISOString(),
  };

  return { updatedWr, reopenedTasks };
}

/**
 * Dependency Graph Cycle Detection
 * Validates dependencies between tasks in a Work Request.
 */
export function validateDependencies(
  tasks: Array<{ id: string; dependsOn?: string[] | string | null }>
): { hasCycle: boolean; error?: string } {
  const adj = new Map<string, string[]>();
  const allIds = new Set(tasks.map((t) => t.id));

  for (const t of tasks) {
    if (!adj.has(t.id)) adj.set(t.id, []);
    if (t.dependsOn === undefined || t.dependsOn === null) continue;

    const deps = Array.isArray(t.dependsOn) ? t.dependsOn : [t.dependsOn];
    for (const d of deps) {
      if (d === '0' || d === '') {
        return { hasCycle: true, error: `Invalid dependency identifier '${d}'` };
      }
      if (d === '*') {
        continue;
      }
      if (!allIds.has(d)) {
        return { hasCycle: true, error: `Dependency target '${d}' does not exist in work request` };
      }
      if (d === t.id) {
        return { hasCycle: true, error: `Self-dependency detected for task '${t.id}'` };
      }
      adj.get(t.id)!.push(d);
    }
  }

  const visited = new Set<string>();
  const recStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recStack.add(node);

    const neighbors = adj.get(node) ?? [];
    for (const n of neighbors) {
      if (!visited.has(n)) {
        if (dfs(n)) return true;
      } else if (recStack.has(n)) {
        return true;
      }
    }

    recStack.delete(node);
    return false;
  }

  for (const t of tasks) {
    if (!visited.has(t.id)) {
      if (dfs(t.id)) {
        return { hasCycle: true, error: `Circular dependency detected involving task '${t.id}'` };
      }
    }
  }

  return { hasCycle: false };
}
