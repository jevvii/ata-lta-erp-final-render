import { describe, it, expect } from 'vitest';
import {
  contactDetailSchema,
  relatedCompanySchema,
  createClientSchema,
  updateClientSchema,
  clientSchema,
  clientCountsSchema,
} from '../api/schemas';

describe('Clients Module Schemas & Validation (clients@2.0.0)', () => {
  describe('contactDetailSchema', () => {
    it('validates a correct email contact detail', () => {
      const valid = {
        type: 'email',
        value: 'info@acme.com',
        label: 'Main Office',
      };
      const parsed = contactDetailSchema.parse(valid);
      expect(parsed.type).toBe('email');
      expect(parsed.value).toBe('info@acme.com');
      expect(parsed.label).toBe('Main Office');
    });

    it('rejects an invalid contact type', () => {
      const invalid = {
        type: 'fax_machine',
        value: '1234567',
      };
      expect(() => contactDetailSchema.parse(invalid)).toThrow();
    });

    it('rejects empty contact value', () => {
      const invalid = {
        type: 'mobile',
        value: '',
      };
      expect(() => contactDetailSchema.parse(invalid)).toThrow();
    });
  });

  describe('relatedCompanySchema', () => {
    it('validates a related company entry with UUID', () => {
      const valid = {
        relatedClientId: '11111111-1111-1111-1111-111111111111',
        relationship: 'Subsidiary',
      };
      const parsed = relatedCompanySchema.parse(valid);
      expect(parsed.relatedClientId).toBe('11111111-1111-1111-1111-111111111111');
      expect(parsed.relationship).toBe('Subsidiary');
    });

    it('rejects non-UUID relatedClientId', () => {
      const invalid = {
        relatedClientId: 'not-a-uuid',
      };
      expect(() => relatedCompanySchema.parse(invalid)).toThrow();
    });
  });

  describe('createClientSchema', () => {
    it('validates a complete client payload', () => {
      const payload = {
        name: 'Alpha Beta Holdings Inc.',
        tin: '123-456-789-000',
        rdoCode: '044',
        address: 'Makati City',
        entity: 'ATA',
        retainer: true,
        retainerFee: 25000,
        tradeName: 'Alpha Beta',
        contactPerson: 'Juan Dela Cruz',
        contactDetails: [
          { type: 'email', value: 'juan@alphabeta.com', label: 'Work' },
        ],
        relatedCompanies: [
          {
            relatedClientId: '22222222-2222-2222-2222-222222222222',
            relationship: 'Affiliate',
          },
        ],
      };

      const parsed = createClientSchema.parse(payload);
      expect(parsed.name).toBe('Alpha Beta Holdings Inc.');
      expect(parsed.tin).toBe('123-456-789-000');
      expect(parsed.entity).toBe('ATA');
      expect(parsed.retainer).toBe(true);
      expect(parsed.retainerFee).toBe(25000);
    });

    it('rejects payload missing required name', () => {
      const invalid = {
        tin: '123-456-789-000',
        entity: 'ATA',
      };
      expect(() => createClientSchema.parse(invalid)).toThrow();
    });

    it('rejects payload missing required tin', () => {
      const invalid = {
        name: 'Acme Corp',
        entity: 'ATA',
      };
      expect(() => createClientSchema.parse(invalid)).toThrow();
    });

    it('rejects invalid entity code', () => {
      const invalid = {
        name: 'Acme Corp',
        tin: '123-456-789-000',
        entity: 'XYZ',
      };
      expect(() => createClientSchema.parse(invalid)).toThrow();
    });

    it('rejects negative retainer fee', () => {
      const invalid = {
        name: 'Acme Corp',
        tin: '123-456-789-000',
        entity: 'ATA',
        retainer: true,
        retainerFee: -500,
      };
      expect(() => createClientSchema.parse(invalid)).toThrow();
    });
  });

  describe('updateClientSchema', () => {
    it('accepts partial update with expectedVersion for OCC', () => {
      const payload = {
        address: 'New Office, Taguig City',
        expectedVersion: 3,
      };
      const parsed = updateClientSchema.parse(payload);
      expect(parsed.address).toBe('New Office, Taguig City');
      expect(parsed.expectedVersion).toBe(3);
    });
  });

  describe('clientSchema', () => {
    it('validates a complete client record', () => {
      const valid = {
        id: 'c-test-1',
        entity: 'ATA',
        name: 'Megaworld Prime Corp',
        tin: '111-222-333-000',
        rdoCode: '044',
        address: 'Uptown Mall, Taguig',
        tradeName: 'Megaworld',
        contactUserId: null,
        contactPerson: 'Andrew Tan',
        retainer: true,
        retainerFee: 50000,
        status: 'Active',
        createdBy: 'u-1',
        updatedBy: 'u-1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
        contactDetails: [{ type: 'email', value: 'contact@megaworld.com' }],
        relatedCompanies: [],
      };
      const parsed = clientSchema.parse(valid);
      expect(parsed.id).toBe('c-test-1');
      expect(parsed.name).toBe('Megaworld Prime Corp');
    });
  });

  describe('clientCountsSchema', () => {
    it('validates client count breakdown numbers', () => {
      const valid = { active: 15, archived: 2 };
      const parsed = clientCountsSchema.parse(valid);
      expect(parsed.active).toBe(15);
      expect(parsed.archived).toBe(2);
    });

    it('rejects negative counts', () => {
      const invalid = { active: -1, archived: 0 };
      expect(() => clientCountsSchema.parse(invalid)).toThrow();
    });
  });
});
