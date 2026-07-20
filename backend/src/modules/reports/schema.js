/**
 * Reports Zod schemas.
 * Query parameter validation for report endpoints.
 *
 * Phase 7 — Agent B
 */

const { z } = require('zod');

/**
 * Schema for analytics query parameters.
 */
const analyticsQuerySchema = z
  .object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  })
  .optional();

/**
 * Schema for daily report query parameters.
 */
const dailyQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

/**
 * Schema for weekly report query parameters.
 */
const weeklyQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
});

/**
 * Schema for monthly pending query parameters.
 */
const monthlyPendingQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format')
    .optional(),
});

/**
 * Schema for aging report query parameters.
 */
const agingQuerySchema = z
  .object({
    clientId: z.string().uuid().optional(),
  })
  .optional();

module.exports = {
  analyticsQuerySchema,
  dailyQuerySchema,
  weeklyQuerySchema,
  monthlyPendingQuerySchema,
  agingQuerySchema,
};
