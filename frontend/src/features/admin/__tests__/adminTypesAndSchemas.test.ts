import { describe, it, expect } from 'vitest';
import {
  createUserSchema,
  updateUserSchema,
  userPasswordSchema,
  adminUserResponseSchema,
  listAuditQuerySchema,
  auditLogResponseSchema,
  problemDetailsSchema,
} from '../api/schemas';
import { generateSecurePassword, PASSWORD_CRITERIA } from '../utils/password';

describe('Admin Module: Types & Zod Schemas', () => {
  describe('Password Complexity Schema (Spec 2.8 / R-14)', () => {
    it('validates a compliant complex password', () => {
      const res = userPasswordSchema.safeParse('SecretP@ss123');
      expect(res.success).toBe(true);
    });

    it('rejects password shorter than 8 characters', () => {
      const res = userPasswordSchema.safeParse('Sh0rt!');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('at least 8 characters');
      }
    });

    it('rejects password without uppercase letter', () => {
      const res = userPasswordSchema.safeParse('lowercase123!');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('uppercase letter');
      }
    });

    it('rejects password without lowercase letter', () => {
      const res = userPasswordSchema.safeParse('UPPERCASE123!');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('lowercase letter');
      }
    });

    it('rejects password without number', () => {
      const res = userPasswordSchema.safeParse('NoNumberHere!');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('number');
      }
    });

    it('rejects password without special character', () => {
      const res = userPasswordSchema.safeParse('NoSpecialChar123');
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toContain('special character');
      }
    });
  });

  describe('Random Password Generator', () => {
    it('generates a 16-character password satisfying all 5 criteria', () => {
      for (let i = 0; i < 20; i++) {
        const pwd = generateSecurePassword(16);
        expect(pwd.length).toBe(16);
        for (const crit of PASSWORD_CRITERIA) {
          expect(crit.test(pwd)).toBe(true);
        }
        const schemaRes = userPasswordSchema.safeParse(pwd);
        expect(schemaRes.success).toBe(true);
      }
    });
  });

  describe('User Creation, Update & Response Schemas (with OCC Version)', () => {
    it('validates a complete valid user creation payload', () => {
      const input = {
        name: 'Maria Santos',
        email: 'maria@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: ['ATA', 'LTA'],
        isActive: true,
        password: 'ValidP@ssword123',
      };
      const res = createUserSchema.safeParse(input);
      expect(res.success).toBe(true);
    });

    it('rejects creation without at least one entity', () => {
      const input = {
        name: 'Maria Santos',
        email: 'maria@ata-lta.ph',
        role: 'Operations',
        departments: ['Operations'],
        entities: [],
      };
      const res = createUserSchema.safeParse(input);
      expect(res.success).toBe(false);
    });

    it('rejects invalid email address', () => {
      const input = {
        name: 'Maria Santos',
        email: 'not-an-email',
        role: 'Operations',
        entities: ['ATA'],
      };
      const res = createUserSchema.safeParse(input);
      expect(res.success).toBe(false);
    });

    it('allows partial update schema with expectedVersion and status for user edits', () => {
      const res = updateUserSchema.safeParse({
        name: 'Maria Santos-Reyes',
        departments: ['Operations', 'Documentation'],
        status: 'Active',
        expectedVersion: 3,
      });
      expect(res.success).toBe(true);
    });

    it('validates adminUserResponseSchema including OCC version', () => {
      const res = adminUserResponseSchema.safeParse({
        id: 'u-1',
        name: 'Juan Dela Cruz',
        email: 'juan@ata-lta.ph',
        role: 'Admin',
        departments: ['Management'],
        entities: ['ATA', 'LTA'],
        isActive: true,
        status: 'Active',
        version: 4,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      expect(res.success).toBe(true);
    });
  });

  describe('Audit Log Filter, Response & Problem Details Schemas', () => {
    it('validates audit log query filter parameters', () => {
      const res = listAuditQuerySchema.safeParse({
        page: 2,
        limit: 20,
        offset: 20,
        module: 'billing',
        actor: 'u-1',
        search: 'INV-2026',
        from: '2026-01-01',
        to: '2026-12-31',
        sortOrder: 'desc',
      });
      expect(res.success).toBe(true);
    });

    it('validates audit log entries and pagination metadata', () => {
      const auditPayload = {
        data: [
          {
            id: 'd9b9328a-7954-4bb2-b362-e6e22f28b495',
            action: 'user.updated',
            tableName: 'users',
            recordId: 'rec-123',
            entity: 'ATA',
            userId: 'user-456',
            details: {
              before: { role: 'Operations' },
              after: { role: 'Manager' },
            },
            createdAt: '2026-10-04T08:00:00Z',
          },
        ],
        meta: {
          total: 1,
          limit: 20,
          offset: 0,
          hasMore: false,
        },
      };

      const res = auditLogResponseSchema.safeParse(auditPayload);
      expect(res.success).toBe(true);
    });

    it('validates RFC 7807 problem details schema', () => {
      const conflictError = {
        status: 409,
        title: 'Conflict',
        code: 'CONCURRENCY_CONFLICT',
        detail: 'User was modified by another session',
      };
      const res = problemDetailsSchema.safeParse(conflictError);
      expect(res.success).toBe(true);
    });
  });
});
