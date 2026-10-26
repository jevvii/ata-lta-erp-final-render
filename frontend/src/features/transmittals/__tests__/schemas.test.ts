import { describe, it, expect } from 'vitest';
import {
  transmittalItemSchema,
  createTransmittalSchema,
  updateTransmittalSchema,
  transmittalResponseSchema,
  transmittalsListResponseSchema,
  transmittalCountsResponseSchema,
  DOCUMENT_CATEGORIES,
  TRANSMITTAL_STATUSES,
} from '../api/schemas';

describe('Transmittals Zod Schemas (transmittals@2.0.0)', () => {
  const validUuid = '11111111-1111-1111-1111-111111111111';

  describe('transmittalItemSchema', () => {
    it('validates a valid document line item', () => {
      const item = {
        description: '2025 Annual Income Tax Return',
        documentType: 'Tax',
        quantity: 2,
      };
      const parsed = transmittalItemSchema.parse(item);
      expect(parsed.description).toBe('2025 Annual Income Tax Return');
      expect(parsed.documentType).toBe('Tax');
      expect(parsed.quantity).toBe(2);
    });

    it('defaults quantity to 1 if omitted', () => {
      const item = {
        description: 'SEC General Information Sheet',
      };
      const parsed = transmittalItemSchema.parse(item);
      expect(parsed.quantity).toBe(1);
    });

    it('rejects empty description', () => {
      const item = {
        description: '',
        quantity: 1,
      };
      const res = transmittalItemSchema.safeParse(item);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.errors[0]?.message).toContain('Description is required');
      }
    });

    it('rejects description exceeding 255 characters', () => {
      const item = {
        description: 'a'.repeat(256),
      };
      const res = transmittalItemSchema.safeParse(item);
      expect(res.success).toBe(false);
    });

    it('rejects non-positive quantity', () => {
      expect(transmittalItemSchema.safeParse({ description: 'Doc', quantity: 0 }).success).toBe(false);
      expect(transmittalItemSchema.safeParse({ description: 'Doc', quantity: -5 }).success).toBe(false);
    });

    it('rejects fractional quantity', () => {
      expect(transmittalItemSchema.safeParse({ description: 'Doc', quantity: 1.5 }).success).toBe(false);
    });
  });

  describe('createTransmittalSchema', () => {
    it('validates a complete valid creation payload', () => {
      const payload = {
        clientId: validUuid,
        workRequestId: validUuid,
        trackingNumber: 'TR-ATA-2026-0001',
        items: [
          {
            description: 'Audited Financial Statements',
            documentType: 'SEC',
            quantity: 3,
          },
        ],
        notes: 'Deliver to 12th Floor Reception',
        recipientName: 'Juan Dela Cruz',
        recipientDetails: 'Corporate Center, Makati',
        linkedTaskId: validUuid,
        boardOrder: 2,
      };

      const parsed = createTransmittalSchema.parse(payload);
      expect(parsed.trackingNumber).toBe('TR-ATA-2026-0001');
      expect(parsed.items).toHaveLength(1);
      expect(parsed.boardOrder).toBe(2);
      expect((parsed as Record<string, unknown>).status).toBeUndefined();
    });

    it('allows trackingNumber to be omitted (optional for auto-generation)', () => {
      const payloadWithoutTracking = {
        clientId: validUuid,
        workRequestId: validUuid,
        linkedTaskId: validUuid,
        items: [
          {
            description: 'Audited Financial Statements',
            quantity: 1,
          },
        ],
      };

      const parsed = createTransmittalSchema.parse(payloadWithoutTracking);
      expect(parsed.trackingNumber).toBeUndefined();
      expect(parsed.items).toHaveLength(1);
    });

    it('requires at least 1 document line item (min 1)', () => {
      const payload = {
        clientId: validUuid,
        workRequestId: validUuid,
        trackingNumber: 'TR-ATA-2026-0002',
        items: [],
      };

      const res = createTransmittalSchema.safeParse(payload);
      expect(res.success).toBe(false);
      if (!res.success) {
        const itemError = res.error.errors.find((e) => e.path.includes('items'));
        expect(itemError?.message).toContain('At least 1 item is required');
      }
    });

    it('enforces Status Anti-Forgery: rejects status in creation payload', () => {
      const forgedStatuses = ['Draft', 'Sent', 'Acknowledged', 'Cancelled'];

      for (const forgedStatus of forgedStatuses) {
        const payload = {
          clientId: validUuid,
          workRequestId: validUuid,
          trackingNumber: 'TR-ATA-2026-0003',
          items: [{ description: 'Tax Returns', quantity: 1 }],
          status: forgedStatus,
        };

        const res = createTransmittalSchema.safeParse(payload);
        expect(res.success).toBe(false);
        if (!res.success) {
          const statusError = res.error.errors.find((e) => e.path.includes('status'));
          expect(statusError).toBeDefined();
          expect(statusError?.message).toContain('status forgery is prohibited');
        }
      }
    });

    it('rejects invalid UUID formats', () => {
      const payload = {
        clientId: 'invalid-client-uuid',
        workRequestId: validUuid,
        trackingNumber: 'TR-001',
        items: [{ description: 'Doc 1' }],
      };
      const res = createTransmittalSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it('rejects tracking number exceeding 50 characters', () => {
      const payload = {
        clientId: validUuid,
        workRequestId: validUuid,
        trackingNumber: 'T'.repeat(51),
        items: [{ description: 'Doc 1' }],
      };
      const res = createTransmittalSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });

    it('rejects notes exceeding 2000 characters', () => {
      const payload = {
        clientId: validUuid,
        workRequestId: validUuid,
        trackingNumber: 'TR-001',
        items: [{ description: 'Doc 1' }],
        notes: 'x'.repeat(2001),
      };
      const res = createTransmittalSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });
  });

  describe('updateTransmittalSchema', () => {
    it('validates partial updates and OCC expectedVersion', () => {
      const payload = {
        trackingNumber: 'TR-ATA-2026-0001-REV',
        notes: 'Updated courier delivery instructions',
        expectedVersion: 2,
      };

      const parsed = updateTransmittalSchema.parse(payload);
      expect(parsed.trackingNumber).toBe('TR-ATA-2026-0001-REV');
      expect(parsed.expectedVersion).toBe(2);
    });

    it('validates boardOrder update alone', () => {
      const payload = {
        boardOrder: 5,
      };
      const parsed = updateTransmittalSchema.parse(payload);
      expect(parsed.boardOrder).toBe(5);
    });

    it('if items is supplied, requires at least 1 item', () => {
      const payload = {
        items: [],
      };
      const res = updateTransmittalSchema.safeParse(payload);
      expect(res.success).toBe(false);
    });
  });

  describe('Response Schemas', () => {
    it('validates transmittalResponseSchema', () => {
      const responseData = {
        id: validUuid,
        tracking_number: 'TR-ATA-2026-0001',
        entity_id: validUuid,
        entity_code: 'ATA',
        client_id: validUuid,
        work_request_id: validUuid,
        linked_task_id: null,
        status: 'Draft',
        approved: false,
        board_order: 0,
        notes: 'Notes here',
        recipient_name: 'Recipient Name',
        recipient_details: 'Suite 400',
        sent_at: null,
        sent_by: null,
        acknowledged_at: null,
        acknowledged_by: null,
        archived: false,
        version: 1,
        created_at: new Date().toISOString(),
        clients: { name: 'Acme Philippines' },
        items: [
          {
            id: validUuid,
            description: 'Item 1',
            document_type: 'Contract',
            quantity: 1,
          },
        ],
      };

      const parsed = transmittalResponseSchema.parse(responseData);
      expect(parsed.tracking_number).toBe('TR-ATA-2026-0001');
      expect(parsed.items).toHaveLength(1);
    });

    it('validates transmittalsListResponseSchema', () => {
      const listData = {
        data: [
          {
            id: validUuid,
            tracking_number: 'TR-ATA-2026-0001',
            entity_id: validUuid,
            client_id: validUuid,
            status: 'Draft',
            approved: false,
            board_order: 0,
            archived: false,
            version: 1,
            created_at: new Date().toISOString(),
          },
        ],
        meta: { total: 1, page: 1, limit: 50 },
      };
      const parsed = transmittalsListResponseSchema.parse(listData);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.meta.total).toBe(1);
    });

    it('validates transmittalCountsResponseSchema', () => {
      const countsData = {
        data: {
          active: 8,
          archived: 2,
          total: 10,
        },
      };
      const parsed = transmittalCountsResponseSchema.parse(countsData);
      expect(parsed.data.active).toBe(8);
      expect(parsed.data.archived).toBe(2);
      expect(parsed.data.total).toBe(10);
    });

    it('contains expected categories and statuses constants', () => {
      expect(DOCUMENT_CATEGORIES).toContain('Tax');
      expect(DOCUMENT_CATEGORIES).toContain('SEC');
      expect(DOCUMENT_CATEGORIES).toContain('BIR');
      expect(DOCUMENT_CATEGORIES).toContain('Contract');
      expect(TRANSMITTAL_STATUSES).toEqual(['Draft', 'Sent', 'Acknowledged', 'Cancelled']);
    });
  });
});
