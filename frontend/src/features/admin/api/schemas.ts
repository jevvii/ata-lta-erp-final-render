import { z } from 'zod';

// ============================================================================
// 1. Enums & Shared Validators
// ============================================================================

export const departmentEnum = z.enum([
  'Management',
  'Accounting',
  'Operations',
  'Documentation',
  'HR',
]);

export const userRoleEnum = z.enum([
  'Admin',
  'Manager',
  'Accounting',
  'Operations',
  'Documentation',
  'HR',
]);

export const entityCodeEnum = z.enum(['ATA', 'LTA']);

export const userStatusEnum = z.enum(['Active', 'Disabled']);

export const nullableUuid = z
  .string()
  .guid()
  .nullable()
  .optional()
  .or(z.literal('').transform(() => null));

/**
 * Password complexity schema matching Spec 2.8 & R-14:
 * - Minimum 8 characters, maximum 128 characters
 * - At least one lowercase letter ([a-z])
 * - At least one uppercase letter ([A-Z])
 * - At least one digit ([0-9])
 * - At least one special character ([^A-Za-z0-9])
 */
export const userPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password cannot exceed 128 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

// ============================================================================
// 2. User Schemas
// ============================================================================

export const createUserSchema = z.object({
  email: z.string().trim().email('Valid email address is required').max(255),
  name: z.string().trim().min(1, 'Name is required').max(255),
  role: userRoleEnum,
  departments: z.array(departmentEnum).default([]),
  entities: z.array(entityCodeEnum).min(1, 'At least one entity (ATA/LTA) must be selected'),
  isActive: z.boolean().optional().default(true),
  password: userPasswordSchema.optional(),
});

export const updateUserSchema = z.object({
  email: z.string().trim().email('Valid email address is required').max(255).optional(),
  name: z.string().trim().min(1, 'Name is required').max(255).optional(),
  role: userRoleEnum.optional(),
  departments: z.array(departmentEnum).optional(),
  entities: z.array(entityCodeEnum).min(1, 'At least one entity (ATA/LTA) must be selected').optional(),
  isActive: z.boolean().optional(),
  status: userStatusEnum.optional(),
  password: userPasswordSchema.optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export const adminUserResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: userRoleEnum,
  departments: z.array(departmentEnum),
  entities: z.array(entityCodeEnum),
  isActive: z.boolean(),
  status: userStatusEnum.optional(),
  version: z.number().int().positive().optional(),
  avatarUrl: z.string().nullable().optional(),
  userNumber: z.string().nullable().optional(),
  user_number: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const userSchema = adminUserResponseSchema;

export const adminUsersListResponseSchema = z.object({
  data: z.array(adminUserResponseSchema),
});

// ============================================================================
// 3. Audit Log Schemas
// ============================================================================

export const listAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  module: z.string().trim().optional(),
  action: z.string().trim().optional(),
  table: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  actor: z.string().trim().optional(),
  search: z.string().trim().optional(),
  date: z.string().trim().optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
});

export const auditLogFilterSchema = listAuditQuerySchema;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  tableName: z.string().nullable(),
  recordId: z.string().nullable(),
  entity: z.string().nullable(),
  userId: z.string().nullable(),
  actorName: z.string().nullable().optional(),
  actorEmail: z.string().nullable().optional(),
  actorAvatarUrl: z.string().nullable().optional(),
  actor_avatar_url: z.string().nullable().optional(),
  ipAddress: z.string().nullable().optional(),
  auditNumber: z.string().nullable().optional(),
  audit_number: z.string().nullable().optional(),
  details: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export const auditLogResponseSchema = z.object({
  data: z.array(auditLogEntrySchema),
  meta: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  }),
});

// ============================================================================
// 4. RFC 7807 Problem Details Schema
// ============================================================================

export const problemDetailsSchema = z.object({
  type: z.string().optional(),
  title: z.string(),
  status: z.number(),
  detail: z.string(),
  code: z.string().optional(),
  errors: z.record(z.string(), z.array(z.string())).optional(),
});
