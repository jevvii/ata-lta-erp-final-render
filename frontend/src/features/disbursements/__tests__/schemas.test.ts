import { describe, it, expect } from 'vitest';
import {
  createDisbursementSchema,
  updateDisbursementSchema,
  rejectDisbursementSchema,
  releasePaymentSchema,
  disbursementCountsSchema,
  createDisbursementTemplateSchema,
  FUND_SOURCES,
  DISBURSEMENT_CATEGORIES,
  DISBURSEMENT_STATUSES,
} from '../api/schemas';

describe('Disbursements Zod Validation Schemas (disbursements@2.0.0)', () => {
  const validUuid = '11111111-1111-1111-1111-111111111111';

  describe('createDisbursementSchema', () => {
    it('validates a valid create payload without status', () => {
      const validPayload = {
        category: 'Professional Fee',
        description: 'Retainer fee for external tax counsel',
        amount: 25000.5,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: validUuid,
        linkedTaskId: validUuid,
        clientId: validUuid,
        dueDate: '2026-11-01',
        notes: 'Pre-approved by managing partner',
      };

      const parsed = createDisbursementSchema.parse(validPayload);
      expect(parsed.amount).toBe(25000.5);
      expect(parsed.category).toBe('Professional Fee');
      expect(parsed.fundSource).toBe('Firm Fund');
      expect(parsed.linkedTaskId).toBe(validUuid);
      // Verify status is undefined
      expect((parsed as Record<string, unknown>).status).toBeUndefined();
    });

    it('rejects payload missing linkedTaskId (Mandatory Linked Task)', () => {
      const payloadWithoutTask = {
        category: 'Professional Fee',
        description: 'Retainer fee for external tax counsel',
        amount: 25000.5,
        fundSource: 'Firm Fund' as const,
        linkedWorkRequestId: validUuid,
      };

      expect(createDisbursementSchema.safeParse(payloadWithoutTask).success).toBe(false);
    });

    it('rejects payload with explicit status (Status Anti-Forgery Guard)', () => {
      const forgedStatuses = ['Pending', 'Draft', 'Approved', 'Released', 'Funded'];

      for (const forgedStatus of forgedStatuses) {
        const payloadWithStatus = {
          category: 'Government Fee',
          description: 'BIR filing fees',
          amount: 5000,
          fundSource: 'Client Fund',
          linkedWorkRequestId: validUuid,
          status: forgedStatus,
        };

        const result = createDisbursementSchema.safeParse(payloadWithStatus);
        expect(result.success).toBe(false);
        if (!result.success) {
          const statusError = result.error.errors.find((e) => e.path.includes('status'));
          expect(statusError).toBeDefined();
          expect(statusError?.message).toContain('status forgery is prohibited');
        }
      }
    });

    it('rejects non-positive amounts (0 and negative)', () => {
      const zeroAmount = {
        category: 'Supplies',
        description: 'Office stationery',
        amount: 0,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: validUuid,
      };
      expect(createDisbursementSchema.safeParse(zeroAmount).success).toBe(false);

      const negativeAmount = {
        ...zeroAmount,
        amount: -1500,
      };
      expect(createDisbursementSchema.safeParse(negativeAmount).success).toBe(false);
    });

    it('rejects invalid fund source', () => {
      const invalidFundSource = {
        category: 'Supplies',
        description: 'Office supplies',
        amount: 500,
        fundSource: 'Personal Account',
        linkedWorkRequestId: validUuid,
      };
      const result = createDisbursementSchema.safeParse(invalidFundSource);
      expect(result.success).toBe(false);
    });

    it('rejects invalid work request UUID format', () => {
      const invalidUuid = {
        category: 'Meals',
        description: 'Client lunch meeting',
        amount: 1200,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: 'not-a-uuid',
      };
      const result = createDisbursementSchema.safeParse(invalidUuid);
      expect(result.success).toBe(false);
    });

    it('rejects description exceeding 2000 characters', () => {
      const longDescription = {
        category: 'Other',
        description: 'A'.repeat(2001),
        amount: 100,
        fundSource: 'Firm Fund',
        linkedWorkRequestId: validUuid,
      };
      const result = createDisbursementSchema.safeParse(longDescription);
      expect(result.success).toBe(false);
    });
  });

  describe('updateDisbursementSchema', () => {
    it('validates partial update with expectedVersion for OCC', () => {
      const updatePayload = {
        description: 'Updated expense description',
        amount: 3000,
        expectedVersion: 2,
      };
      const parsed = updateDisbursementSchema.parse(updatePayload);
      expect(parsed.description).toBe('Updated expense description');
      expect(parsed.amount).toBe(3000);
      expect(parsed.expectedVersion).toBe(2);
    });

    it('rejects negative expectedVersion', () => {
      const invalidVersion = {
        expectedVersion: -1,
      };
      expect(updateDisbursementSchema.safeParse(invalidVersion).success).toBe(false);
    });
  });

  describe('rejectDisbursementSchema (1-500 trimmed characters)', () => {
    it('accepts valid reason within 1 to 500 characters', () => {
      const validReason = 'The official receipt is illegible and requires re-scanning.';
      const parsed = rejectDisbursementSchema.parse({ reason: validReason });
      expect(parsed.reason).toBe(validReason);
    });

    it('accepts single non-whitespace character boundary', () => {
      const parsed = rejectDisbursementSchema.parse({ reason: 'X' });
      expect(parsed.reason).toBe('X');
    });

    it('accepts exact 500 character boundary', () => {
      const maxReason = 'A'.repeat(500);
      const parsed = rejectDisbursementSchema.parse({ reason: maxReason });
      expect(parsed.reason.length).toBe(500);
    });

    it('rejects empty string', () => {
      const result = rejectDisbursementSchema.safeParse({ reason: '' });
      expect(result.success).toBe(false);
    });

    it('rejects whitespace-only string after trimming', () => {
      const result = rejectDisbursementSchema.safeParse({ reason: '     ' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.message).toContain('Rejection reason is required');
      }
    });

    it('rejects string exceeding 500 characters (501 chars)', () => {
      const tooLong = 'B'.repeat(501);
      const result = rejectDisbursementSchema.safeParse({ reason: tooLong });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0]?.message).toContain('cannot exceed 500 characters');
      }
    });
  });

  describe('releasePaymentSchema', () => {
    it('validates optional payment release fields', () => {
      const payment = {
        method: 'Bank Transfer',
        reference: 'TRX-998822',
        bank: 'BDO Unibank',
        date: '2026-10-04',
      };
      const parsed = releasePaymentSchema.parse(payment);
      expect(parsed.method).toBe('Bank Transfer');
      expect(parsed.reference).toBe('TRX-998822');
      expect(parsed.bank).toBe('BDO Unibank');
    });

    it('accepts empty object (all fields optional)', () => {
      const parsed = releasePaymentSchema.parse({});
      expect(parsed).toEqual({});
    });
  });

  describe('disbursementCountsSchema', () => {
    it('validates non-negative badge counts', () => {
      const counts = {
        active: 10,
        archived: 2,
        rejected: 1,
        awaitingRelease: 4,
      };
      const parsed = disbursementCountsSchema.parse(counts);
      expect(parsed.active).toBe(10);
      expect(parsed.awaitingRelease).toBe(4);
    });

    it('rejects negative counts', () => {
      const invalid = {
        active: -1,
        archived: 0,
        rejected: 0,
        awaitingRelease: 0,
      };
      expect(disbursementCountsSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe('createDisbursementTemplateSchema', () => {
    it('validates a valid disbursement template', () => {
      const template = {
        name: 'Monthly BIR Stamp Tax',
        category: 'Government Fee',
        amount: 1500,
        fundSource: 'Firm Fund' as const,
        description: 'Standard recurring monthly tax filing fees',
      };
      const parsed = createDisbursementTemplateSchema.parse(template);
      expect(parsed.name).toBe('Monthly BIR Stamp Tax');
      expect(parsed.amount).toBe(1500);
    });
  });

  describe('Domain Constants', () => {
    it('defines 2 fund sources', () => {
      expect(FUND_SOURCES).toEqual(['Firm Fund', 'Client Fund']);
    });

    it('defines 12 contract categories', () => {
      expect(DISBURSEMENT_CATEGORIES.length).toBe(12);
      expect(DISBURSEMENT_CATEGORIES).toContain('Professional Fee');
      expect(DISBURSEMENT_CATEGORIES).toContain('Government Fee');
      expect(DISBURSEMENT_CATEGORIES).toContain('Supplies');
      expect(DISBURSEMENT_CATEGORIES).toContain('Transportation');
    });

    it('defines 10 contract lifecycle statuses', () => {
      expect(DISBURSEMENT_STATUSES).toEqual([
        'Draft',
        'Submitted',
        'Pending',
        'Pending Admin Approval',
        'Approved',
        'Released',
        'Funded',
        'Rejected',
        'Archived',
        'Cancelled',
      ]);
    });
  });
});
