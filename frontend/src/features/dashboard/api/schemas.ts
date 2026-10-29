/**
 * Zod Schemas for Runtime Validation of Dashboard API Contracts
 *
 * Citations:
 * - time-entries@2.0.0 (docs/api-contracts/modules/time-entries.md)
 * - notifications@2.0.0 (docs/api-contracts/modules/notifications.md)
 */

import { z } from 'zod';

export const getMaxAllowedDate = (): string => {
  const utc = new Date().toISOString().slice(0, 10);
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return utc > local ? utc : local;
};

// ============================================================================
// 1. Time Entries Schemas
// ============================================================================

export const createTimeEntrySchema = z.object({
  task_id: z.string().guid('task_id must be a valid UUID'),
  entry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'entry_date must be in YYYY-MM-DD format')
    .refine((val) => val <= getMaxAllowedDate(), {
      message: 'entry_date cannot be in the future',
    }),
  duration_minutes: z
    .number()
    .int('duration_minutes must be an integer')
    .min(1, 'duration_minutes must be at least 1')
    .max(1440, 'duration_minutes cannot exceed 1440'),
  note: z.string().max(5000, 'note cannot exceed 5000 characters').optional().nullable(),
  user_id: z.string().optional(),
});

export const updateTimeEntrySchema = z.object({
  task_id: z.string().guid('task_id must be a valid UUID').optional(),
  entry_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'entry_date must be in YYYY-MM-DD format')
    .refine((val) => val <= getMaxAllowedDate(), {
      message: 'entry_date cannot be in the future',
    })
    .optional(),
  duration_minutes: z
    .number()
    .int('duration_minutes must be an integer')
    .min(1, 'duration_minutes must be at least 1')
    .max(1440, 'duration_minutes cannot exceed 1440')
    .optional(),
  note: z.string().max(5000, 'note cannot exceed 5000 characters').optional().nullable(),
});

export const rawTimeEntryApiSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  user_name: z.string().nullable().optional(),
  user_role: z.string().nullable().optional(),
  task_id: z.string(),
  entry_date: z.string(),
  duration_minutes: z.number().int(),
  note: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const rawTaskSummaryItemApiSchema = z.object({
  task_id: z.string(),
  work_request_id: z.string(),
  title: z.string(),
  minutes: z.number().int(),
});

export const rawTimeSummaryApiSchema = z.object({
  date: z.string(),
  total_minutes: z.number().int(),
  by_task: z.array(rawTaskSummaryItemApiSchema).default([]),
});

// ============================================================================
// 2. Notifications Schemas
// ============================================================================

export const rawNotificationItemApiSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  type: z.enum([
    'wr.transition_request.received',
    'wr.transition_request.resolved',
    'pending_request.resolved',
    'wr.qa_reroute',
    'disbursement.lifecycle',
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
  read_at: z.string().nullable().optional(),
  created_at: z.string(),
});

export const rawNotificationListApiResponseSchema = z.object({
  data: z.array(rawNotificationItemApiSchema).default([]),
  meta: z
    .object({
      unread_count: z.number().int().optional(),
      has_more: z.boolean().optional(),
      next_cursor: z.string().nullable().optional(),
      limit: z.number().int().optional(),
    })
    .optional(),
});
