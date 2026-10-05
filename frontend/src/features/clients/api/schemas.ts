/**
 * Zod validation schemas for Clients Module (Parcel CLI / Module #8)
 *
 * Citation: Frozen API Contract clients@2.0.0 (docs/api-contracts/modules/clients.md)
 */

import { z } from 'zod';

export const contactDetailSchema = z.object({
  id: z.string().optional(),
  type: z.enum(['email', 'mobile', 'phone', 'landline', 'other']),
  value: z.string().min(1, 'Contact value is required').max(255),
  label: z.string().max(50).optional().nullable(),
});

export const relatedCompanySchema = z.object({
  id: z.string().optional(),
  relatedClientId: z.string().uuid('Related client must be a valid UUID'),
  relationship: z.string().max(100).optional().nullable(),
});

export const createClientSchema = z.object({
  name: z.string().min(1, 'Client name is required').max(255),
  tin: z.string().min(1, 'TIN is required').max(50),
  rdoCode: z.string().max(20).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  entity: z.enum(['ATA', 'LTA']),
  retainer: z.boolean().default(false),
  retainerFee: z.preprocess(
    (val) => (val === '' || val === undefined || val === null ? null : Number(val)),
    z.number().nonnegative('Retainer fee must be non-negative').nullable().optional()
  ),
  tradeName: z.string().max(255).optional().nullable(),
  contactUserId: z.preprocess(
    (val) => (val === '' || val === undefined || val === null ? null : val),
    z.string().uuid('Invalid user UUID').nullable().optional()
  ),
  contactPerson: z.string().max(255).optional().nullable(),
  contactDetails: z.array(contactDetailSchema).optional(),
  relatedCompanies: z.array(relatedCompanySchema).optional(),
});

export const updateClientSchema = createClientSchema.partial().extend({
  expectedVersion: z.number().int().positive().optional(),
});

export const clientSchema = z.object({
  id: z.string(),
  entity: z.string(),
  name: z.string(),
  tin: z.string(),
  rdoCode: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  tradeName: z.string().nullable().optional(),
  contactUserId: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  retainer: z.boolean(),
  retainerFee: z.number().nullable().optional(),
  status: z.string(),
  createdBy: z.string().nullable().optional(),
  updatedBy: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable().optional(),
  version: z.number(),
  contactDetails: z.array(contactDetailSchema).optional(),
  relatedCompanies: z.array(relatedCompanySchema).optional(),
});

export const clientCountsSchema = z.object({
  active: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
