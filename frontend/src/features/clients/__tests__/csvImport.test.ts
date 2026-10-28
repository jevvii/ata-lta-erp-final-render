import { describe, it, expect, vi } from 'vitest';
import {
  parseCSV,
  validateCsvData,
  generateCsvTemplate,
  downloadCsvTemplate,
  CSV_TEMPLATE_HEADERS,
  CSV_TEMPLATE_SAMPLE_ROWS,
} from '../lib/csvImport';
import type { RegisteredUser } from '../api/types';

describe('csvImport lib: pure parsing, validation, and template utilities', () => {
  const mockUsers: RegisteredUser[] = [
    { id: 'u-1', name: 'John Doe', email: 'john@example.com' },
    { id: 'u-2', name: 'Jane Smith', email: 'jane@example.com' },
  ];

  describe('parseCSV', () => {
    it('parses basic comma-separated rows with LF', () => {
      const csv = 'Name,TIN,Entity\nAcme Corp,123-456-789-00001,ATA\nBeta Co,987-654-321-00002,LTA';
      const result = parseCSV(csv);
      expect(result).toEqual([
        ['Name', 'TIN', 'Entity'],
        ['Acme Corp', '123-456-789-00001', 'ATA'],
        ['Beta Co', '987-654-321-00002', 'LTA'],
      ]);
    });

    it('parses CRLF line endings', () => {
      const csv = 'Name,TIN,Entity\r\nAcme Corp,123-456-789-00001,ATA\r\nBeta Co,987-654-321-00002,LTA';
      const result = parseCSV(csv);
      expect(result).toHaveLength(3);
      expect(result[1]).toEqual(['Acme Corp', '123-456-789-00001', 'ATA']);
    });

    it('handles quotes with embedded commas and newlines', () => {
      const csv = '"Name, Inc.","123-456-789-00001","Multi\nLine Address"';
      const result = parseCSV(csv);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(['Name, Inc.', '123-456-789-00001', 'Multi\nLine Address']);
    });

    it('handles escaped quotes ("")', () => {
      const csv = '"He said ""Hello""","TIN","ATA"';
      const result = parseCSV(csv);
      expect(result).toHaveLength(1);
      expect(result[0]![0]).toBe('He said "Hello"');
    });

    it('strips UTF-8 BOM prefix', () => {
      const csv = '\uFEFFName,TIN,Entity\nAcme,123,ATA';
      const result = parseCSV(csv);
      expect(result[0]![0]).toBe('Name');
    });

    it('handles trailing newline without producing trailing empty row', () => {
      const csv = 'Name,TIN,Entity\nAcme,123,ATA\n';
      const result = parseCSV(csv);
      expect(result).toHaveLength(2);
    });
  });

  describe('generateCsvTemplate and downloadCsvTemplate', () => {
    it('generates expected CSV template with headers and sample rows', () => {
      const template = generateCsvTemplate();
      const lines = template.split('\n');
      expect(lines[0]).toBe(CSV_TEMPLATE_HEADERS.join(','));
      expect(lines).toHaveLength(1 + CSV_TEMPLATE_SAMPLE_ROWS.length);
    });

    it('downloads CSV template by creating a temporary anchor tag', () => {
      const clickMock = vi.fn();
      const appendChildSpy = vi.spyOn(document.body, 'appendChild');
      const removeChildSpy = vi.spyOn(document.body, 'removeChild');
      const createObjectURLMock = vi.fn().mockReturnValue('blob:mock-url');
      const revokeObjectURLMock = vi.fn();

      window.URL.createObjectURL = createObjectURLMock;
      window.URL.revokeObjectURL = revokeObjectURLMock;

      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        const el = origCreateElement(tagName);
        if (tagName === 'a') {
          el.click = clickMock;
        }
        return el;
      });

      downloadCsvTemplate();

      expect(createObjectURLMock).toHaveBeenCalled();
      expect(clickMock).toHaveBeenCalled();
      expect(appendChildSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  describe('validateCsvData', () => {
    const validHeader = [
      'Name',
      'TIN',
      'Entity',
      'On Retainer',
      "Retainer's Fee",
      'RDO Code',
      'Trade Name',
      'Business Address',
      'Point of Contact',
    ];

    it('rejects empty rows or header-only file', () => {
      expect(validateCsvData([])).toEqual({
        isValid: false,
        error: 'The uploaded file is empty or missing data rows.',
        records: [],
        errors: [],
      });

      expect(validateCsvData([validHeader])).toEqual({
        isValid: false,
        error: 'The uploaded file is empty or missing data rows.',
        records: [],
        errors: [],
      });
    });

    it('rejects missing required headers (case-insensitive and trimmed check)', () => {
      const invalidHeaders = ['Name', 'TIN', 'Entity']; // missing 'On Retainer'
      const rows = [invalidHeaders, ['Acme', '123-456-789-00001', 'ATA']];
      const result = validateCsvData(rows);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Required headers missing');
    });

    it('accepts headers in different cases and extra spaces', () => {
      const customHeaders = [' NAME ', 'tin', 'EnTiTy', 'ON RETAINER', "retainer's fee"];
      const rows = [
        customHeaders,
        ['Acme Corp', '123-456-789-00001', 'ata', 'yes', '5000'],
      ];
      const result = validateCsvData(rows, mockUsers);
      expect(result.isValid).toBe(true);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.record.name).toBe('Acme Corp');
      expect(result.records[0]!.record.entity).toBe('ATA');
      expect(result.records[0]!.record.retainer).toBe(true);
      expect(result.records[0]!.record.retainerFee).toBe(5000);
    });

    it('skips empty/whitespace rows', () => {
      const rows = [
        validHeader,
        ['', '', ''],
        ['   '],
        ['Acme Corp', '123-456-789-00001', 'ATA', 'no', '', '', '', '', ''],
        [],
      ];
      const result = validateCsvData(rows);
      expect(result.isValid).toBe(true);
      expect(result.records).toHaveLength(1);
      expect(result.errors).toHaveLength(0);
      expect(result.records[0]!.rowNum).toBe(4); // row 4 in 1-based spreadsheet indexing
    });

    it('validates name requirements', () => {
      const rows = [
        validHeader,
        ['', '123-456-789-00001', 'ATA', 'no', '', '', '', '', ''],
        ['A'.repeat(256), '123-456-789-00001', 'ATA', 'no', '', '', '', '', ''],
      ];
      const result = validateCsvData(rows);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]!.messages).toContain('Name is required');
      expect(result.errors[1]!.messages).toContain('Name must be less than 255 characters');
    });

    it('validates TIN requirements', () => {
      const rows = [
        validHeader,
        ['Valid Name', '', 'ATA', 'no', '', '', '', '', ''],
        ['Valid Name 2', '123456789', 'ATA', 'no', '', '', '', '', ''],
        ['Valid Name 3', '123-456-789-00001', 'ATA', 'no', '', '', '', '', ''],
      ];
      const result = validateCsvData(rows);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]!.messages).toContain('TIN is required');
      expect(result.errors[1]!.messages).toContain('TIN must be in format XXX-XXX-XXX-XXXXX');
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.record.tin).toBe('123-456-789-00001');
    });

    it('validates Entity requirements (ATA or LTA only)', () => {
      const rows = [
        validHeader,
        ['Valid Name', '123-456-789-00001', '', 'no', '', '', '', '', ''],
        ['Valid Name 2', '123-456-789-00002', 'XYZ', 'no', '', '', '', '', ''],
        ['Valid Name 3', '123-456-789-00003', 'lta', 'no', '', '', '', '', ''],
      ];
      const result = validateCsvData(rows);
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]!.messages).toContain('Entity is required');
      expect(result.errors[1]!.messages).toContain('Entity must be either ATA or LTA');
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.record.entity).toBe('LTA');
    });

    it('recognizes retainer truthy values and validates retainer fee', () => {
      const truthyVals = ['yes', 'YES', 'true', '1', 'on'];
      for (const val of truthyVals) {
        const rows = [
          validHeader,
          ['Retainer Co', '123-456-789-00001', 'ATA', val, '1500.50', '', '', '', ''],
        ];
        const res = validateCsvData(rows);
        expect(res.records[0]!.record.retainer).toBe(true);
        expect(res.records[0]!.record.retainerFee).toBe(1500.5);
      }

      // Missing fee when retainer is true
      const missingFee = validateCsvData([
        validHeader,
        ['Retainer Co', '123-456-789-00001', 'ATA', 'yes', '', '', '', '', ''],
      ]);
      expect(missingFee.errors[0]!.messages).toContain(
        "Retainer's Fee is required when On Retainer is checked"
      );

      // Negative fee
      const negativeFee = validateCsvData([
        validHeader,
        ['Retainer Co', '123-456-789-00001', 'ATA', 'yes', '-100', '', '', '', ''],
      ]);
      expect(negativeFee.errors[0]!.messages).toContain(
        "Retainer's Fee must be a non-negative number"
      );

      // Non-numeric fee
      const nonNumFee = validateCsvData([
        validHeader,
        ['Retainer Co', '123-456-789-00001', 'ATA', 'yes', 'abc', '', '', '', ''],
      ]);
      expect(nonNumFee.errors[0]!.messages).toContain(
        "Retainer's Fee must be a non-negative number"
      );

      // Non-retainer with empty fee is fine
      const nonRetainer = validateCsvData([
        validHeader,
        ['Non Retainer Co', '123-456-789-00001', 'ATA', 'no', '', '', '', '', ''],
      ]);
      expect(nonRetainer.records[0]!.record.retainer).toBe(false);
      expect(nonRetainer.records[0]!.record.retainerFee).toBeNull();
    });

    it('validates RDO Code format (up to 4 alphanumeric characters)', () => {
      const rows = [
        validHeader,
        ['Valid Name', '123-456-789-00001', 'ATA', 'no', '', '034A', '', '', ''],
        ['Invalid RDO 1', '123-456-789-00002', 'ATA', 'no', '', '12345', '', '', ''],
        ['Invalid RDO 2', '123-456-789-00003', 'ATA', 'no', '', '03-A', '', '', ''],
      ];
      const result = validateCsvData(rows);
      expect(result.records).toHaveLength(1);
      expect(result.records[0]!.record.rdoCode).toBe('034A');
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0]!.messages).toContain('RDO Code must be up to 4 alphanumeric characters');
      expect(result.errors[1]!.messages).toContain('RDO Code must be up to 4 alphanumeric characters');
    });

    it('matches Point of Contact to registered users by name (case-insensitive)', () => {
      const rows = [
        validHeader,
        ['Client 1', '123-456-789-00001', 'ATA', 'no', '', '', '', '', 'john doe'],
        ['Client 2', '123-456-789-00002', 'ATA', 'no', '', '', '', '', 'External POC'],
        ['Client 3', '123-456-789-00003', 'ATA', 'no', '', '', '', '', ''],
      ];
      const result = validateCsvData(rows, mockUsers);
      expect(result.isValid).toBe(true);
      expect(result.records).toHaveLength(3);

      // Matched registered user
      expect(result.records[0]!.record.contactUserId).toBe('u-1');
      expect(result.records[0]!.record.contactPerson).toBe('john doe');

      // Unmatched custom POC
      expect(result.records[1]!.record.contactUserId).toBeNull();
      expect(result.records[1]!.record.contactPerson).toBe('External POC');

      // Empty POC
      expect(result.records[2]!.record.contactUserId).toBeNull();
      expect(result.records[2]!.record.contactPerson).toBeNull();
    });

    it('populates empty arrays for contactDetails and relatedCompanies', () => {
      const rows = [
        validHeader,
        ['Acme Corp', '123-456-789-00001', 'ATA', 'no', '', '034', 'Trade', 'Address', ''],
      ];
      const result = validateCsvData(rows);
      expect(result.records[0]!.record.contactDetails).toEqual([]);
      expect(result.records[0]!.record.relatedCompanies).toEqual([]);
      expect(result.records[0]!.record.tradeName).toBe('Trade');
      expect(result.records[0]!.record.address).toBe('Address');
    });
  });
});
