import { describe, it, expect } from 'vitest';
import {
  createDocumentSchema,
  updateDocumentSchema,
  lifecycleSchema,
  documentFilterParamsSchema,
  DOCUMENT_CATEGORIES,
  DOCUMENT_LIFECYCLE_STAGES,
  DOCUMENT_STATUSES,
  MAX_FILE_SIZE_BYTES,
} from '../api/schemas';

describe('Documents Zod Schemas (documents@2.0.0)', () => {
  describe('createDocumentSchema', () => {
    const validWrId = '22222222-2222-4222-8222-222222222222';
    const validTaskId = '44444444-4444-4444-8444-444444444444';

    it('validates valid file creation metadata with mandatory workRequestId and linkedTaskId', () => {
      const valid = {
        fileName: 'BIR_Form_2307.pdf',
        contentType: 'application/pdf',
        fileSize: 1024 * 500,
        originalName: 'BIR Form 2307 Q3.pdf',
        workRequestId: validWrId,
        linkedTaskId: validTaskId,
        category: 'BIR',
        documentType: 'Tax Form',
        description: 'Withholding tax certificate for Q3',
      };
      const parsed = createDocumentSchema.safeParse(valid);
      expect(parsed.success).toBe(true);
    });

    it('rejects missing fileName or empty fileName', () => {
      expect(createDocumentSchema.safeParse({}).success).toBe(false);
      expect(
        createDocumentSchema.safeParse({
          fileName: '',
          workRequestId: validWrId,
          linkedTaskId: validTaskId,
        }).success
      ).toBe(false);
    });

    it('rejects missing workRequestId or linkedTaskId (no floating documents)', () => {
      expect(
        createDocumentSchema.safeParse({
          fileName: 'test.pdf',
          linkedTaskId: validTaskId,
        }).success
      ).toBe(false);
      expect(
        createDocumentSchema.safeParse({
          fileName: 'test.pdf',
          workRequestId: validWrId,
        }).success
      ).toBe(false);
      expect(
        createDocumentSchema.safeParse({
          fileName: 'test.pdf',
          workRequestId: null,
          linkedTaskId: null,
        }).success
      ).toBe(false);
    });

    it('enforces 50 MB max file size limit', () => {
      const underLimit = {
        fileName: 'test.pdf',
        workRequestId: validWrId,
        linkedTaskId: validTaskId,
        fileSize: MAX_FILE_SIZE_BYTES,
      };
      expect(createDocumentSchema.safeParse(underLimit).success).toBe(true);

      const overLimit = {
        fileName: 'large.pdf',
        workRequestId: validWrId,
        linkedTaskId: validTaskId,
        fileSize: MAX_FILE_SIZE_BYTES + 1,
      };
      const res = createDocumentSchema.safeParse(overLimit);
      expect(res.success).toBe(false);
    });

    it('allows externalUrl for linked web documents', () => {
      const ext = {
        fileName: 'SEC Online GIS',
        workRequestId: validWrId,
        linkedTaskId: validTaskId,
        externalUrl: 'https://sec.gov.ph/gis-portal/12345',
        category: 'SEC',
      };
      expect(createDocumentSchema.safeParse(ext).success).toBe(true);
    });
  });

  describe('updateDocumentSchema', () => {
    it('validates partial metadata updates', () => {
      const update = {
        documentType: 'Audited Statement',
        category: 'FINANCIAL',
        description: 'Updated financial notes',
        archived: true,
      };
      expect(updateDocumentSchema.safeParse(update).success).toBe(true);
    });

    it('validates comments array payload', () => {
      const update = {
        comments: [
          {
            id: 'c-1',
            userId: '11111111-1111-1111-1111-111111111111',
            date: '2026-10-04T08:00:00.000Z',
            text: 'Audited copy signed and stamped by CPA.',
          },
        ],
      };
      expect(updateDocumentSchema.safeParse(update).success).toBe(true);
    });

    it('validates physical custody handover log', () => {
      const update = {
        handoverLog: [
          {
            handed_to: 'Atty. Maria Santos',
            handed_date: '2026-10-04T09:30:00.000Z',
            method: 'Personal Courier',
            notes: 'Original board resolution delivered',
          },
        ],
      };
      expect(updateDocumentSchema.safeParse(update).success).toBe(true);
    });
  });

  describe('lifecycleSchema', () => {
    it('validates all 5 physical lifecycle stages', () => {
      for (const stage of DOCUMENT_LIFECYCLE_STAGES) {
        expect(lifecycleSchema.safeParse({ lifecycle: stage }).success).toBe(true);
      }
    });

    it('rejects invalid lifecycle stages', () => {
      expect(lifecycleSchema.safeParse({ lifecycle: 'invalid_stage' }).success).toBe(false);
      expect(lifecycleSchema.safeParse({ lifecycle: 'in_progress' }).success).toBe(false);
    });
  });

  describe('documentFilterParamsSchema', () => {
    it('validates query filter params and pagination bounds', () => {
      const filter = {
        category: 'CONTRACT',
        lifecycle: 'collected',
        search: 'lease',
        page: 1,
        limit: 50,
      };
      expect(documentFilterParamsSchema.safeParse(filter).success).toBe(true);
    });

    it('accepts boolean or string archived flags', () => {
      expect(documentFilterParamsSchema.safeParse({ archived: true }).success).toBe(true);
      expect(documentFilterParamsSchema.safeParse({ archived: 'true' }).success).toBe(true);
      expect(documentFilterParamsSchema.safeParse({ archived: false }).success).toBe(true);
    });
  });

  describe('Domain Constants', () => {
    it('exposes exactly 12 categories', () => {
      expect(DOCUMENT_CATEGORIES.length).toBe(12);
      expect(DOCUMENT_CATEGORIES).toEqual([
        'Owner Details',
        'Business Details',
        'SEC',
        'City Hall',
        'BIR',
        'SSS',
        'PhilHealth',
        'Pag-IBIG',
        'IPO',
        'FDA',
        'Labor',
        'Others',
      ]);
    });

    it('exposes exactly 5 physical lifecycle stages', () => {
      expect(DOCUMENT_LIFECYCLE_STAGES.length).toBe(5);
      expect(DOCUMENT_LIFECYCLE_STAGES).toEqual([
        'collected',
        'with_documentations',
        'scanned',
        'in_envelope',
        'stored',
      ]);
    });

    it('exposes 3 document statuses', () => {
      expect(DOCUMENT_STATUSES).toEqual(['pending_upload', 'active', 'failed']);
    });
  });
});
