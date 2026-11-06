import { describe, it, expect } from 'vitest';
import {
  getClientTradeName,
  getClientNumber,
  getClientTin,
  getDuplicateClientIds,
  matchesClientSearch,
  formatAutoDetectedClientDisplay,
  type ClientSelectItemLike,
} from '../lib/clientSelectUtils';

describe('clientSelectUtils', () => {
  describe('getClientTradeName', () => {
    it('returns null when client is missing or DBA is empty', () => {
      expect(getClientTradeName(null)).toBeNull();
      expect(getClientTradeName(undefined)).toBeNull();
      expect(getClientTradeName({ id: '1', name: 'Acme Corp' })).toBeNull();
      expect(getClientTradeName({ id: '1', name: 'Acme Corp', tradeName: '  ' })).toBeNull();
      expect(getClientTradeName({ id: '1', name: 'Acme Corp', trade_name: '' })).toBeNull();
    });

    it('returns null when tradeName matches client name case-insensitively', () => {
      expect(getClientTradeName({ id: '1', name: 'Acme Corp', tradeName: 'acme corp' })).toBeNull();
      expect(getClientTradeName({ id: '1', name: 'Acme Corp', trade_name: ' ACME CORP ' })).toBeNull();
    });

    it('returns trimmed trade name when different from client name', () => {
      expect(getClientTradeName({ id: '1', name: 'Acme Corp', tradeName: '  Acme Express  ' })).toBe('Acme Express');
      expect(getClientTradeName({ id: '1', name: 'Acme Corp', trade_name: 'Roadrunner Supplies' })).toBe('Roadrunner Supplies');
    });
  });

  describe('getClientNumber', () => {
    it('returns null when client number is absent', () => {
      expect(getClientNumber(null)).toBeNull();
      expect(getClientNumber({ id: '1', name: 'Acme' })).toBeNull();
      expect(getClientNumber({ id: '1', name: 'Acme', clientNumber: '  ' })).toBeNull();
    });

    it('returns trimmed client number from clientNumber or client_number', () => {
      expect(getClientNumber({ id: '1', name: 'Acme', clientNumber: '  C-0001 ' })).toBe('C-0001');
      expect(getClientNumber({ id: '1', name: 'Acme', client_number: 'C-0002' })).toBe('C-0002');
    });
  });

  describe('getClientTin', () => {
    it('returns null when tin is absent or empty', () => {
      expect(getClientTin(null)).toBeNull();
      expect(getClientTin({ id: '1', name: 'Acme' })).toBeNull();
      expect(getClientTin({ id: '1', name: 'Acme', tin: ' ' })).toBeNull();
    });

    it('returns trimmed tin', () => {
      expect(getClientTin({ id: '1', name: 'Acme', tin: ' 123-456-789-000 ' })).toBe('123-456-789-000');
    });
  });

  describe('getDuplicateClientIds', () => {
    it('identifies collision across names and tradeNames', () => {
      const clients: ClientSelectItemLike[] = [
        { id: 'c1', name: 'Alpha Corp' },
        { id: 'c2', name: 'alpha corp' }, // duplicates c1
        { id: 'c3', name: 'Beta Ltd', tradeName: 'Gamma' },
        { id: 'c4', name: 'Gamma Enterprises' },
        { id: 'c5', name: 'Gamma' }, // duplicates tradeName of c3
        { id: 'c6', name: 'Unique Inc' },
      ];

      const duplicates = getDuplicateClientIds(clients);
      expect(duplicates.has('c1')).toBe(true);
      expect(duplicates.has('c2')).toBe(true);
      expect(duplicates.has('c3')).toBe(true);
      expect(duplicates.has('c5')).toBe(true);
      expect(duplicates.has('c4')).toBe(false);
      expect(duplicates.has('c6')).toBe(false);
    });
  });

  describe('matchesClientSearch', () => {
    const client: ClientSelectItemLike = {
      id: 'c1',
      name: 'Pacific Trading Corp',
      entity: 'ATA',
      tradeName: 'PTC Logistics',
      clientNumber: 'C-1042',
      tin: '123-456-789-00001',
    };

    it('matches by name', () => {
      expect(matchesClientSearch(client, 'pacific')).toBe(true);
      expect(matchesClientSearch(client, 'Trading')).toBe(true);
    });

    it('matches by DBA / trade name', () => {
      expect(matchesClientSearch(client, 'logistics')).toBe(true);
      expect(matchesClientSearch(client, 'ptc')).toBe(true);
    });

    it('matches by client number', () => {
      expect(matchesClientSearch(client, 'c-1042')).toBe(true);
      expect(matchesClientSearch(client, '1042')).toBe(true);
    });

    it('matches by formatted TIN and digits-only branch code', () => {
      expect(matchesClientSearch(client, '123-456')).toBe(true);
      expect(matchesClientSearch(client, '00001')).toBe(true);
      expect(matchesClientSearch(client, '12345678900001')).toBe(true);
      expect(matchesClientSearch(client, '456789')).toBe(true);
    });

    it('matches by entity', () => {
      expect(matchesClientSearch(client, 'ata')).toBe(true);
      expect(matchesClientSearch(client, 'lta')).toBe(false);
    });

    it('returns false when no match', () => {
      expect(matchesClientSearch(client, 'random nonexistent')).toBe(false);
    });

    it('returns true on empty query', () => {
      expect(matchesClientSearch(client, '')).toBe(true);
      expect(matchesClientSearch(client, '   ')).toBe(true);
    });
  });

  describe('formatAutoDetectedClientDisplay', () => {
    it('appends TIN when client has TIN', () => {
      const client = { id: 'c1', name: 'ABC Corp', tin: '123-456-789-000' };
      expect(formatAutoDetectedClientDisplay(client)).toBe('ABC Corp • TIN 123-456-789-000');
    });

    it('returns name only when client has no TIN', () => {
      const client = { id: 'c1', name: 'ABC Corp' };
      expect(formatAutoDetectedClientDisplay(client)).toBe('ABC Corp');
    });

    it('uses fallback name if client is null', () => {
      expect(formatAutoDetectedClientDisplay(null, 'Fallback Client')).toBe('Fallback Client');
      expect(formatAutoDetectedClientDisplay(null, null)).toBe('');
    });
  });
});
