/**
 * CSV Import parsing, validation, and template utilities for Clients Module
 *
 * Replicates the business logic of erp_prototype/js/clients.js (lines 2762-3124).
 */

import type { CreateClientInput, RegisteredUser } from '../api/types';

export const CSV_TEMPLATE_HEADERS = [
  'Name',
  'TIN',
  'Entity',
  'On Retainer',
  "Retainer's Fee",
  'RDO Code',
  'Trade Name',
  'Business Address',
  'Point of Contact',
] as const;

export const CSV_TEMPLATE_SAMPLE_ROWS = [
  [
    'Acme Corp',
    '123-456-789-00001',
    'ATA',
    'yes',
    '5000.00',
    '034A',
    'Acme DBA',
    '123 Makati Ave, Makati City',
    'John Doe',
  ],
  [
    'Beta Link Co',
    '987-654-321-00002',
    'LTA',
    'no',
    '',
    '040',
    '',
    '456 Ortigas St, Pasig City',
    'Jane Smith',
  ],
];

/**
 * Generate CSV template text with standard headers and sample rows.
 */
export function generateCsvTemplate(): string {
  const headerLine = CSV_TEMPLATE_HEADERS.join(',');
  const rowLines = CSV_TEMPLATE_SAMPLE_ROWS.map((row) =>
    row.map((val) => `"${val.replace(/"/g, '""')}"`).join(',')
  );
  return [headerLine, ...rowLines].join('\n');
}

/**
 * Trigger browser file download of the CSV template.
 */
export function downloadCsvTemplate(): void {
  const csvContent = generateCsvTemplate();
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'clients_import_template.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * RFC4180-compliant CSV parser:
 * - Strips UTF-8 BOM if present
 * - Handles quoted fields with embedded commas, line breaks (CRLF or LF)
 * - Handles escaped quotes ("")
 */
export function parseCSV(text: string): string[][] {
  let content = text;
  if (content.charCodeAt(0) === 0xfeff || content.startsWith('\uFEFF')) {
    content = content.slice(1);
  }

  const lines: string[][] = [];
  let row: string[] = [''];
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        const lastIdx = row.length - 1;
        row[lastIdx] = (row[lastIdx] ?? '') + '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push('');
    } else if ((c === '\r' || c === '\n') && !inQuotes) {
      if (c === '\r' && next === '\n') {
        i++;
      }
      lines.push(row);
      row = [''];
    } else if (c !== undefined) {
      const lastIdx = row.length - 1;
      row[lastIdx] = (row[lastIdx] ?? '') + c;
    }
  }

  const firstInRow = row[0];
  if (row.length > 1 || (firstInRow !== undefined && firstInRow !== '')) {
    lines.push(row);
  }

  return lines;
}

export interface RowValidationError {
  rowNum: number;
  name: string;
  messages: string[];
}

export interface ValidatedClientRecord {
  rowNum: number;
  record: CreateClientInput;
}

export interface CsvValidationResult {
  isValid: boolean;
  error?: string;
  records: ValidatedClientRecord[];
  errors: RowValidationError[];
}

/**
 * Validates parsed CSV lines against Client master record rules and matches
 * Point of Contact names to registered users.
 */
export function validateCsvData(
  rows: string[][],
  registeredUsers: RegisteredUser[] = []
): CsvValidationResult {
  const firstRow = rows[0];
  if (!firstRow || rows.length <= 1) {
    return {
      isValid: false,
      error: 'The uploaded file is empty or missing data rows.',
      records: [],
      errors: [],
    };
  }

  const headerRow = firstRow.map((h) => h.trim().toLowerCase());
  const nameIdx = headerRow.indexOf('name');
  const tinIdx = headerRow.indexOf('tin');
  const entityIdx = headerRow.indexOf('entity');
  const retainerIdx = headerRow.indexOf('on retainer');
  const feeIdx = headerRow.indexOf("retainer's fee");
  const rdoIdx = headerRow.indexOf('rdo code');
  const tradeIdx = headerRow.indexOf('trade name');
  const addrIdx = headerRow.indexOf('business address');
  const pocIdx = headerRow.indexOf('point of contact');

  if (nameIdx === -1 || tinIdx === -1 || entityIdx === -1 || retainerIdx === -1) {
    return {
      isValid: false,
      error: 'Required headers missing. Please ensure your file includes: Name, TIN, Entity, and On Retainer.',
      records: [],
      errors: [],
    };
  }

  const validatedRecords: ValidatedClientRecord[] = [];
  const errors: RowValidationError[] = [];

  const dataRows = rows.slice(1);
  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2;

    const firstCell = row[0];
    // Skip empty lines
    if (
      row.length === 0 ||
      (row.length === 1 && (!firstCell || firstCell.trim() === '')) ||
      row.every((cell) => !cell.trim())
    ) {
      return;
    }

    const name = row[nameIdx]?.trim() || '';
    const tin = row[tinIdx]?.trim() || '';
    const entity = row[entityIdx]?.trim().toUpperCase() || '';
    const retainerRaw = row[retainerIdx]?.trim().toLowerCase() || '';
    const feeRaw = feeIdx !== -1 ? row[feeIdx]?.trim() : '';
    const rdoCode = rdoIdx !== -1 ? row[rdoIdx]?.trim().toUpperCase() : '';
    const tradeName = tradeIdx !== -1 ? row[tradeIdx]?.trim() : '';
    const address = addrIdx !== -1 ? row[addrIdx]?.trim() : '';
    const contactPersonRaw = pocIdx !== -1 ? row[pocIdx]?.trim() : '';

    const rowErrors: string[] = [];

    if (!name) {
      rowErrors.push('Name is required');
    } else if (name.length > 255) {
      rowErrors.push('Name must be less than 255 characters');
    }

    if (!tin) {
      rowErrors.push('TIN is required');
    } else if (!/^\d{3}-\d{3}-\d{3}-\d{5}$/.test(tin)) {
      rowErrors.push('TIN must be in format XXX-XXX-XXX-XXXXX');
    }

    if (!entity) {
      rowErrors.push('Entity is required');
    } else if (entity !== 'ATA' && entity !== 'LTA') {
      rowErrors.push('Entity must be either ATA or LTA');
    }

    const retainer = ['yes', 'true', '1', 'on'].includes(retainerRaw);
    let retainerFee: number | null = null;
    if (retainer) {
      if (!feeRaw) {
        rowErrors.push("Retainer's Fee is required when On Retainer is checked");
      } else {
        const fee = parseFloat(feeRaw);
        if (isNaN(fee) || fee < 0) {
          rowErrors.push("Retainer's Fee must be a non-negative number");
        } else {
          retainerFee = fee;
        }
      }
    }

    if (rdoCode && !/^[A-Z0-9]{1,4}$/.test(rdoCode)) {
      rowErrors.push('RDO Code must be up to 4 alphanumeric characters');
    }

    let contactUserId: string | null = null;
    const contactPerson = contactPersonRaw || null;
    if (contactPersonRaw) {
      const matched = registeredUsers.find(
        (u) => u.name.trim().toLowerCase() === contactPersonRaw.toLowerCase()
      );
      if (matched) {
        contactUserId = matched.id;
      }
    }

    if (rowErrors.length > 0) {
      errors.push({
        rowNum,
        name: name || `Row ${rowNum}`,
        messages: rowErrors,
      });
    } else {
      validatedRecords.push({
        rowNum,
        record: {
          name,
          tin,
          entity: entity as 'ATA' | 'LTA',
          retainer,
          retainerFee,
          rdoCode: rdoCode || undefined,
          address: address || undefined,
          tradeName: tradeName || undefined,
          contactUserId,
          contactPerson,
          contactDetails: [],
          relatedCompanies: [],
        },
      });
    }
  });

  return {
    isValid: true,
    records: validatedRecords,
    errors,
  };
}
