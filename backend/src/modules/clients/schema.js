/**
 * Clients module Zod schemas.
 * Phase 2 implementation by Agent A.
 */

const { z } = require('zod');

const contactDetailSchema = z.object({
  type: z.enum(['email', 'mobile', 'phone', 'landline', 'other']),
  value: z.string().min(1).max(255),
  label: z.string().max(50).optional(),
});

const relatedCompanySchema = z.object({
  relatedClientId: z.string().uuid(),
  relationship: z.string().max(100).optional(),
});

const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  tin: z.string().max(50),
  rdoCode: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  entity: z.enum(['ATA', 'LTA']),
  retainer: z.boolean().default(false),
  tradeName: z.string().max(255).optional(),
  contactUserId: z.string().uuid().optional(),
  contactDetails: z.array(contactDetailSchema).optional(),
  relatedCompanies: z.array(relatedCompanySchema).optional(),
});

const updateClientSchema = createClientSchema.partial();

module.exports = {
  createClientSchema,
  updateClientSchema,
  contactDetailSchema,
  relatedCompanySchema,
};
