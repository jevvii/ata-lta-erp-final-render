/**
 * Time Entries module validation schemas.
 */

const { z } = require('zod');

// Use the firm's calendar, independent of the deployment server timezone.
const getMaxAllowedDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Date must be a valid calendar date');
const entryDateSchema = calendarDateSchema.refine((value) => value <= getMaxAllowedDate(), {
  message: 'entry_date cannot be in the future',
});

const createTimeEntrySchema = z.object({
  task_id: z.string().guid('task_id must be a valid UUID'),
  entry_date: entryDateSchema,
  duration_minutes: z
    .number()
    .int('duration_minutes must be an integer')
    .min(1, 'duration_minutes must be at least 1')
    .max(1440, 'duration_minutes cannot exceed 1440'),
  note: z.string().max(5000).optional().nullable(),
  user_id: z.string().optional(), // Ignored in service/controller, caller forced
});

const updateTimeEntrySchema = z.object({
  task_id: z.string().guid('task_id must be a valid UUID').optional(),
  entry_date: entryDateSchema.optional(),
  duration_minutes: z
    .number()
    .int('duration_minutes must be an integer')
    .min(1, 'duration_minutes must be at least 1')
    .max(1440, 'duration_minutes cannot exceed 1440')
    .optional(),
  note: z.string().max(5000).optional().nullable(),
});

const listQuerySchema = z.object({
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
  task_id: z.string().guid('task_id must be a valid UUID').optional(),
  user_id: z.string().guid('user_id must be a valid UUID').optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, 'from must not be after to');

const summaryQuerySchema = z.object({
  date: calendarDateSchema,
  user_id: z.string().guid('user_id must be a valid UUID').optional(),
});

const entryParamsSchema = z.object({
  id: z.string().guid('id must be a valid UUID'),
});

module.exports = {
  createTimeEntrySchema,
  updateTimeEntrySchema,
  listQuerySchema,
  summaryQuerySchema,
  entryParamsSchema,
  getMaxAllowedDate,
  entryDateSchema,
};
