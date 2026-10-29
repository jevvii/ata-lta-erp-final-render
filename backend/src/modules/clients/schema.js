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
  relatedClientId: z.string().guid(),
  relationship: z.string().max(100).optional(),
});

const createClientSchema = z.object({
  name: z.string().min(1).max(255),
  tin: z.string().max(50),
  rdoCode: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  entity: z.enum(['ATA', 'LTA']),
  retainer: z.boolean().default(false),
  retainerFee: z.preprocess(
    (val) => (val === '' || val === undefined || val === null ? null : Number(val)),
    z.number().nonnegative().nullable().optional()
  ),
  tradeName: z.string().max(255).optional(),
  contactUserId: z.preprocess(
    (val) => (val === '' || val === undefined || val === null ? null : val),
    z.string().guid().nullable().optional()
  ),
  contactPerson: z.string().max(255).optional().nullable(),
  contactDetails: z.array(contactDetailSchema).optional(),
  relatedCompanies: z.array(relatedCompanySchema).optional(),
});

// expectedVersion carries the OCC guard (Spec 2.2 / R-10): when present, the
// update only applies if the stored row still has this version.
const updateClientSchema = createClientSchema.partial().extend({
  expectedVersion: z.number().int().positive().optional(),
});

module.exports = {
  createClientSchema,
  updateClientSchema,
  contactDetailSchema,
  relatedCompanySchema,
};
