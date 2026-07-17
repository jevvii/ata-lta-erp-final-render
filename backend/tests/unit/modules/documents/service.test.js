/**
 * Document service unit tests.
 * Tests for S3 key generation and file name sanitization (pure functions).
 *
 * These tests mock out the Supabase/S3 dependencies to isolate
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

jest.mock('../../../../src/services/s3Service', () => ({
  getSignedUploadUrl: jest.fn().mockResolvedValue('https://s3.example.com/upload'),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/download'),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../src/services/auditService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

const {
  sanitizeFileName,
  generateS3Key,
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

  describe('generateS3Key', () => {
    const baseParams = {
      entityCode: 'ATA',
      documentId: '123e4567-e89b-12d3-a456-426614174000',
      fileName: 'Test File.pdf',
    };

    it('generates client-based key when clientId is provided', () => {
      const key = generateS3Key({
        ...baseParams,
        clientId: 'client-uuid',
        workRequestId: null,
      });
      expect(key).toBe('entities/ATA/clients/client-uuid/documents/123e4567-e89b-12d3-a456-426614174000/test-file.pdf');
    });

    it('generates work-request-based key when workRequestId is provided', () => {
      const key = generateS3Key({
        ...baseParams,
        clientId: null,
        workRequestId: 'wr-uuid',
      });
      expect(key).toBe('entities/ATA/work-requests/wr-uuid/documents/123e4567-e89b-12d3-a456-426614174000/test-file.pdf');
    });

    it('generates general key when neither clientId nor workRequestId', () => {
      const key = generateS3Key({
        ...baseParams,
        clientId: null,
        workRequestId: null,
      });
      expect(key).toBe('entities/ATA/general/documents/123e4567-e89b-12d3-a456-426614174000/test-file.pdf');
    });

    it('prefers clientId over workRequestId when both provided', () => {
      const key = generateS3Key({
        ...baseParams,
        clientId: 'client-uuid',
        workRequestId: 'wr-uuid',
      });
      expect(key).toContain('/clients/');
      expect(key).not.toContain('/work-requests/');
    });
  });
});
