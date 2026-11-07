import { describe, it, expect } from 'vitest';
import {
  getClientTradeName,
  getClientNumber,
  getClientTin,
  getClientRdo,
  getDuplicateClientIds,
  matchesClientSearch,
  formatAutoDetectedClientDisplay,
  sortClients,
  DEFAULT_CLIENT_SORT,
  CLIENT_SORT_OPTIONS,
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

  describe('getClientRdo', () => {
    it('returns null when RDO is absent or empty', () => {
      expect(getClientRdo(null)).toBeNull();
      expect(getClientRdo({ id: '1', name: 'Acme' })).toBeNull();
      expect(getClientRdo({ id: '1', name: 'Acme', rdoCode: ' ' })).toBeNull();
      expect(getClientRdo({ id: '1', name: 'Acme', rdo_code: '' })).toBeNull();
    });

    it('returns trimmed RDO from rdoCode or rdo_code', () => {
      expect(getClientRdo({ id: '1', name: 'Acme', rdoCode: ' 044 ' })).toBe('044');
      expect(getClientRdo({ id: '1', name: 'Acme', rdo_code: '047' })).toBe('047');
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

  describe('sortClients', () => {
    const sample: ClientSelectItemLike[] = [
      { id: '10', clientNumber: 'CLI-10', name: 'Zeta Corp', tin: '999-000-000-000', rdoCode: '048' },
      { id: '2', clientNumber: 'CLI-2', name: 'Alpha Ltd', tin: '111-000-000-000', rdoCode: '044' },
      { id: '1', clientNumber: 'CLI-1', name: 'Beta Inc', tin: null, rdoCode: '047' },
      { id: 'no-num-b', name: 'Delta LLC', tin: '222-000-000-000', rdoCode: null },
      { id: 'no-num-a', name: 'Charlie LLC', tin: null, rdoCode: '' },
    ];

    it('defaults to id_asc with numeric awareness and clientNumber first', () => {
      const sorted = sortClients(sample);
      // CLI-1, CLI-2, CLI-10 (numeric order), then no-num-a, no-num-b sorted by id
      expect(sorted.map((c) => c.id)).toEqual(['1', '2', '10', 'no-num-a', 'no-num-b']);
    });

    it('sorts id_desc with clients having clientNumber first, in reverse numeric order', () => {
      const sorted = sortClients(sample, 'id_desc');
      // CLI-10, CLI-2, CLI-1, then no-num-b, no-num-a
      expect(sorted.map((c) => c.id)).toEqual(['10', '2', '1', 'no-num-b', 'no-num-a']);
    });

    it('sorts name_asc and name_desc alphabetically', () => {
      const asc = sortClients(sample, 'name_asc');
      expect(asc.map((c) => c.name)).toEqual([
        'Alpha Ltd',
        'Beta Inc',
        'Charlie LLC',
        'Delta LLC',
        'Zeta Corp',
      ]);

      const desc = sortClients(sample, 'name_desc');
      expect(desc.map((c) => c.name)).toEqual([
        'Zeta Corp',
        'Delta LLC',
        'Charlie LLC',
        'Beta Inc',
        'Alpha Ltd',
      ]);
    });

    it('sorts tin_asc and tin_desc with TIN clients first', () => {
      const asc = sortClients(sample, 'tin_asc');
      // Clients with TIN: 111 (id 2), 222 (id no-num-b), 999 (id 10), then missing TINs sorted by name
      expect(asc.map((c) => c.id)).toEqual(['2', 'no-num-b', '10', '1', 'no-num-a']);

      const desc = sortClients(sample, 'tin_desc');
      // Clients with TIN: 999 (id 10), 222 (id no-num-b), 111 (id 2), then missing TINs sorted by name
      expect(desc.map((c) => c.id)).toEqual(['10', 'no-num-b', '2', '1', 'no-num-a']);
    });

    it('sorts rdo_asc and rdo_desc with RDO clients first', () => {
      const asc = sortClients(sample, 'rdo_asc');
      // Clients with RDO: 044 (id 2), 047 (id 1), 048 (id 10), then missing RDOs sorted by name
      expect(asc.map((c) => c.id)).toEqual(['2', '1', '10', 'no-num-a', 'no-num-b']);

      const desc = sortClients(sample, 'rdo_desc');
      // Clients with RDO: 048 (id 10), 047 (id 1), 044 (id 2), then missing RDOs sorted by name
      expect(desc.map((c) => c.id)).toEqual(['10', '1', '2', 'no-num-a', 'no-num-b']);
    });

    it('does not mutate the original array (immutability)', () => {
      const original = [...sample];
      sortClients(sample, 'name_asc');
      expect(sample).toEqual(original);
    });

    it('exports DEFAULT_CLIENT_SORT as id_asc and 8 valid options', () => {
      expect(DEFAULT_CLIENT_SORT).toBe('id_asc');
      expect(CLIENT_SORT_OPTIONS).toHaveLength(8);
    });
  });
});
