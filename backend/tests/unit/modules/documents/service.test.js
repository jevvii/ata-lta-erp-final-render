/**
 * Document service unit tests.
 * Tests for storage path generation and file name sanitization (pure functions).
 *
 * These tests mock out the Supabase/storage dependencies to isolate
 * the pure logic in the service module.
 */

// Mock all external dependencies before requiring the service
jest.mock('../../../../src/services/supabaseClient', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: {}, error: null }),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    })),
  },
}));

jest.mock('../../../../src/services/storageService', () => ({
  getSignedUploadUrl: jest.fn().mockResolvedValue('https://storage.example.com/upload'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.example.com/download'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../src/services/auditService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

const {
  sanitizeFileName,
  generateStoragePath,
} = require('../../../../src/modules/documents/service');

describe('Documents Service', () => {
  describe('sanitizeFileName', () => {
    it('lowercases the filename', () => {
      expect(sanitizeFileName('MyFile.PDF')).toBe('myfile.pdf');
    });

    it('replaces spaces with hyphens', () => {
      expect(sanitizeFileName('my file name.pdf')).toBe('my-file-name.pdf');
    });

    it('removes special characters', () => {
      expect(sanitizeFileName('file@#$%^&.pdf')).toBe('file.pdf');
    });

    it('collapses multiple hyphens', () => {
      expect(sanitizeFileName('file - - name.pdf')).toBe('file-name.pdf');
    });

    it('truncates to 200 characters', () => {
      const longName = 'a'.repeat(250) + '.pdf';
      expect(sanitizeFileName(longName).length).toBeLessThanOrEqual(200);
    });

    it('handles empty string edge case', () => {
      expect(sanitizeFileName('')).toBe('');
    });
  });

  describe('generateStoragePath', () => {
    const baseParams = {
      entityCode: 'ATA',
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      fileName: 'Test File.pdf',
    };

    it('generates client-based path when clientId is provided', () => {
      const path = generateStoragePath({
        ...baseParams,
        clientId: 'client-uuid',
        workRequestId: null,
      });
      expect(path).toBe(
        'entities/ATA/clients/client-uuid/documents/123e4567-e89b-12d3-a456-426614174000/test-file.pdf'
      );
    });

    it('generates work-request-based path when workRequestId is provided', () => {
      const path = generateStoragePath({
        ...baseParams,
        clientId: null,
        workRequestId: 'wr-uuid',
      });
      expect(path).toBe(
        'entities/ATA/work-requests/wr-uuid/documents/123e4567-e89b-12d3-a456-426614174000/test-file.pdf'
      );
    });

    it('generates general path when neither clientId nor workRequestId', () => {
      const path = generateStoragePath({
        ...baseParams,
        clientId: null,
        workRequestId: null,
      });
      expect(path).toBe(
        'entities/ATA/general/documents/123e4567-e89b-12d3-a456-426614174000/test-file.pdf'
      );
    });

    it('prefers clientId over workRequestId when both provided', () => {
      const path = generateStoragePath({
        ...baseParams,
        clientId: 'client-uuid',
        workRequestId: 'wr-uuid',
      });
      expect(path).toContain('/clients/');
      expect(path).not.toContain('/work-requests/');
    });
  });
});
