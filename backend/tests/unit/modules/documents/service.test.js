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
  assertTaskDocumentMutationAllowed,
} = require('../../../../src/modules/documents/service');
const { supabaseAdmin } = require('../../../../src/services/supabaseClient');

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

  describe('assertTaskDocumentMutationAllowed', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('returns empty result when taskId is falsy', async () => {
      const res = await assertTaskDocumentMutationAllowed({ taskId: null });
      expect(res).toEqual({ task: null, workRequest: null });
    });

    it('throws 400 when task does not exist or is deleted', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
      });

      await expect(
        assertTaskDocumentMutationAllowed({ taskId: '11111111-1111-1111-1111-111111111111' })
      ).rejects.toThrow(/Linked task 11111111-1111-1111-1111-111111111111 does not exist/);
    });

    it('throws 409 TASK_REJECTED_LOCKED when task is rejected (attachment action)', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'task-1', approval_status: 'rejected' },
          error: null,
        }),
      });

      await expect(
        assertTaskDocumentMutationAllowed({
          taskId: 'task-1',
          action: 'attachment',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'TASK_REJECTED_LOCKED',
        detail: 'Task is rejected and locked against document attachments',
      });
    });

    it('throws 409 TASK_REJECTED_LOCKED when task is rejected (modification action)', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'task-1', approval_status: 'rejected' },
          error: null,
        }),
      });

      await expect(
        assertTaskDocumentMutationAllowed({
          taskId: 'task-1',
          action: 'modification',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'TASK_REJECTED_LOCKED',
        detail: 'Task is rejected and locked against document modifications',
      });
    });

    it('throws 400 when task does not belong to specified work request', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'task-1', work_request_id: 'wr-1', approval_status: 'approved' },
          error: null,
        }),
      });

      await expect(
        assertTaskDocumentMutationAllowed({
          taskId: 'task-1',
          workRequestId: 'wr-2',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'Linked task task-1 does not belong to work request wr-2',
      });
    });

    it('throws 404 when parent work request has creation_approval_status !== approved', async () => {
      // 1. Task query
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'task-1', work_request_id: 'wr-pending', approval_status: 'approved' },
          error: null,
        }),
      });
      // 2. WR query
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'wr-pending', entity_id: 'ent-ata', creation_approval_status: 'pending' },
          error: null,
        }),
      });

      await expect(
        assertTaskDocumentMutationAllowed({
          taskId: 'task-1',
          entityId: 'ent-ata',
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        detail: 'Parent work request not found or deleted',
      });
    });

    it('throws 400 when parent work request belongs to different entity', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'task-1', work_request_id: 'wr-lta', approval_status: 'approved' },
          error: null,
        }),
      });
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'wr-lta', entity_id: 'ent-lta', creation_approval_status: 'approved' },
          error: null,
        }),
      });

      await expect(
        assertTaskDocumentMutationAllowed({
          taskId: 'task-1',
          entityId: 'ent-ata',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'Linked task task-1 does not belong to active entity',
      });
    });

    it('throws 403 FORBIDDEN_TASK_ATTACHMENT when requireAssignment is true and user is unassigned non-admin', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'task-1', work_request_id: null, assignee_id: 'other-user', approval_status: 'approved' },
          error: null,
        }),
      });
      // task_assignees query
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockImplementation(function () {
          return {
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          };
        }),
      });

      await expect(
        assertTaskDocumentMutationAllowed({
          taskId: 'task-1',
          user: { id: 'user-1', role: 'Operations' },
          requireAssignment: true,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'FORBIDDEN_TASK_ATTACHMENT',
      });
    });

    it('allows mutation when task is valid, pending, and user is assigned', async () => {
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'task-1', work_request_id: 'wr-1', assignee_id: 'user-1', approval_status: 'pending' },
          error: null,
        }),
      });
      supabaseAdmin.from.mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({
          data: { id: 'wr-1', entity_id: 'ent-ata', creation_approval_status: 'approved' },
          error: null,
        }),
      });

      const res = await assertTaskDocumentMutationAllowed({
        taskId: 'task-1',
        entityId: 'ent-ata',
        user: { id: 'user-1', role: 'Operations' },
        requireAssignment: true,
      });

      expect(res.task.id).toBe('task-1');
      expect(res.workRequest.id).toBe('wr-1');
    });
  });
});
