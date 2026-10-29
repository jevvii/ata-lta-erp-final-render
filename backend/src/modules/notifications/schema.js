/**
 * Notifications module validation schemas.
 */

const { z } = require('zod');

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z
    .string()
    .optional()
    .refine((val) => !val || !isNaN(Date.parse(val)), {
      message: 'cursor must be a valid ISO date string',
    }),
});

const markReadParamsSchema = z.object({
  id: z.string().guid(),
});

module.exports = {
  listQuerySchema,
  markReadParamsSchema,
};
