/**
 * Comprehensive Test Suite for Avatar Storage & Upload Configuration
 *
 * Validates:
 * 1. Environment configuration (env.storage.avatarBucket)
 * 2. Storage service bucket parameter support (storageService.getSignedUploadUrl)
 * 3. Me service avatar upload URL generation with MIME types & public URL routing
 * 4. Me controller extraction of contentType from request body
 * 5. Integration endpoint POST /v1/me/avatar-upload-url
 * 6. Migration 000065 bucket creation/update logic and SQL URL regex rewrite
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const env = require('../src/config/env');
const storageService = require('../src/services/storageService');
const meService = require('../src/modules/me/service');
const { meController } = require('../src/modules/me/controller');
const migration000065 = require('../migrations/000065_fix_avatar_storage_public_bucket');
const { registerUser, resetMock, seedDefaults, supabaseAdmin } = require('./fixtures/supabaseMock');

describe('Avatar Storage & Upload Configuration (Milestone 1)', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  describe('1. Environment Configuration', () => {
    it('defines avatarBucket in env.storage defaulting to "avatars"', () => {
      expect(env.storage).toBeDefined();
      expect(typeof env.storage.avatarBucket).toBe('string');
      expect(env.storage.avatarBucket).toBe(process.env.SUPABASE_AVATARS_BUCKET || 'avatars');
    });
  });

  describe('2. Storage Service Pre-Signed Upload URL Bucket Override', () => {
    it('targets custom bucket when bucket parameter is explicitly provided', async () => {
      const fromSpy = jest.spyOn(supabaseAdmin.storage, 'from');

      const url = await storageService.getSignedUploadUrl({
        bucket: 'avatars',
        path: 'test-user/12345.png',
        contentType: 'image/png',
      });

      expect(fromSpy).toHaveBeenCalledWith('avatars');
      expect(url).toBe('https://storage.example.com/upload');
      fromSpy.mockRestore();
    });

    it('falls back to default env.storage.bucket when bucket parameter is omitted', async () => {
      const fromSpy = jest.spyOn(supabaseAdmin.storage, 'from');

      const url = await storageService.getSignedUploadUrl({
        path: 'documents/doc-1.pdf',
      });

      expect(fromSpy).toHaveBeenCalledWith(env.storage.bucket);
      expect(url).toBe('https://storage.example.com/upload');
      fromSpy.mockRestore();
    });

    it('throws AppError if active bucket resolves to empty string', async () => {
      const origBucket = env.storage.bucket;
      env.storage.bucket = '';

      await expect(
        storageService.getSignedUploadUrl({
          path: 'test.png',
        })
      ).rejects.toThrow('Storage bucket is not configured');

      env.storage.bucket = origBucket;
    });
  });

  describe('3. Me Service getAvatarUploadUrl Contract & MIME Mapping', () => {
    it('resolves image/png to .png extension and public avatars URL', async () => {
      const result = await meService.getAvatarUploadUrl({
        userId: 'user-uuid-1',
        contentType: 'image/png',
      });

      expect(result.signedUrl).toBe('https://storage.example.com/upload');
      expect(result.path).toMatch(/^user-uuid-1\/\d+\.png$/);
      expect(result.publicUrl).toBe(
        `${env.supabase.url}/storage/v1/object/public/${env.storage.avatarBucket || 'avatars'}/${result.path}`
      );
      expect(result.maxSizeMb).toBe(5);
    });

    it('resolves image/jpeg and image/jpg to .jpg extension', async () => {
      const resJpeg = await meService.getAvatarUploadUrl({
        userId: 'user-uuid-2',
        contentType: 'image/jpeg',
      });
      expect(resJpeg.path).toMatch(/^user-uuid-2\/\d+\.jpg$/);

      const resJpg = await meService.getAvatarUploadUrl({
        userId: 'user-uuid-2',
        contentType: 'image/jpg',
      });
      expect(resJpg.path).toMatch(/^user-uuid-2\/\d+\.jpg$/);
    });

    it('resolves image/webp to .webp extension', async () => {
      const result = await meService.getAvatarUploadUrl({
        userId: 'user-uuid-3',
        contentType: 'image/webp',
      });
      expect(result.path).toMatch(/^user-uuid-3\/\d+\.webp$/);
      expect(result.publicUrl).toContain('.webp');
    });

    it('handles uppercase and mixed-case MIME types correctly', async () => {
      const result = await meService.getAvatarUploadUrl({
        userId: 'user-uuid-4',
        contentType: 'IMAGE/WEBP',
      });
      expect(result.path).toMatch(/^user-uuid-4\/\d+\.webp$/);
    });

    it('defaults to .png when contentType is unknown or omitted', async () => {
      const resOmitted = await meService.getAvatarUploadUrl({
        userId: 'user-uuid-5',
      });
      expect(resOmitted.path).toMatch(/^user-uuid-5\/\d+\.png$/);

      const resUnknown = await meService.getAvatarUploadUrl({
        userId: 'user-uuid-5',
        contentType: 'application/octet-stream',
      });
      expect(resUnknown.path).toMatch(/^user-uuid-5\/\d+\.png$/);
    });
  });

  describe('4. Me Controller getAvatarUploadUrl Request Body Handling', () => {
    it('extracts contentType from req.body and calls meService.getAvatarUploadUrl', async () => {
      const mockReq = {
        user: { id: 'user-test-id' },
        body: { contentType: 'image/webp' },
      };
      let jsonResponse = null;
      let statusCode = null;
      const mockRes = {
        status: (code) => {
          statusCode = code;
          return mockRes;
        },
        json: (data) => {
          jsonResponse = data;
          return mockRes;
        },
      };
      const mockNext = jest.fn();

      await meController.getAvatarUploadUrl(mockReq, mockRes, mockNext);

      expect(statusCode).toBe(200);
      expect(jsonResponse?.data).toBeDefined();
      expect(jsonResponse.data.path).toMatch(/^user-test-id\/\d+\.webp$/);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('falls back to image/png when req.body is undefined', async () => {
      const mockReq = {
        user: { id: 'user-test-id-2' },
        body: undefined,
      };
      let jsonResponse = null;
      const mockRes = {
        status: () => mockRes,
        json: (data) => {
          jsonResponse = data;
          return mockRes;
        },
      };
      const mockNext = jest.fn();

      await meController.getAvatarUploadUrl(mockReq, mockRes, mockNext);

      expect(jsonResponse?.data?.path).toMatch(/^user-test-id-2\/\d+\.png$/);
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('5. Integration Endpoint POST /v1/me/avatar-upload-url', () => {
    it('returns public avatar URL pointing to avatars bucket with custom contentType', async () => {
      const token = registerUser({
        email: 'avatar.tester@ata-lta.ph',
        name: 'Avatar Tester',
        role: 'Staff',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/me/avatar-upload-url')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send({ contentType: 'image/webp' })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.signedUrl).toMatch(/^https:\/\//);
      expect(res.body.data.publicUrl).toMatch(
        /\/storage\/v1\/object\/public\/avatars\/mock-\d+\/\d+\.webp$/
      );
      expect(res.body.data.path).toMatch(/^mock-\d+\/\d+\.webp$/);
      expect(res.body.data.maxSizeMb).toBe(5);
    });

    it('returns HTTP 401 when unauthenticated', async () => {
      await request(app)
        .post('/v1/me/avatar-upload-url')
        .send({ contentType: 'image/png' })
        .expect(401);
    });
  });

  describe('6. Migration 000065 Contract & SQL Backfill Logic', () => {
    it('exports up and down functions', () => {
      expect(typeof migration000065.up).toBe('function');
      expect(typeof migration000065.down).toBe('function');
    });

    it('checks for avatars bucket and creates it if not existing', async () => {
      const listSpy = jest
        .spyOn(supabaseAdmin.storage, 'listBuckets')
        .mockResolvedValueOnce({ data: [{ name: 'documents' }], error: null });
      const createSpy = jest
        .spyOn(supabaseAdmin.storage, 'createBucket')
        .mockResolvedValueOnce({ data: { name: 'avatars' }, error: null });
      const updateSpy = jest.spyOn(supabaseAdmin.storage, 'updateBucket');

      let capturedSql = '';
      const mockPgm = {
        sql: (statement) => {
          capturedSql = statement;
        },
      };

      await migration000065.up(mockPgm);

      expect(listSpy).toHaveBeenCalled();
      expect(createSpy).toHaveBeenCalledWith('avatars', {
        public: true,
        fileSizeLimit: 5242880,
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
      });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(capturedSql).toContain('UPDATE users');

      listSpy.mockRestore();
      createSpy.mockRestore();
      updateSpy.mockRestore();
    });

    it('updates avatars bucket if it already exists', async () => {
      const listSpy = jest
        .spyOn(supabaseAdmin.storage, 'listBuckets')
        .mockResolvedValueOnce({ data: [{ name: 'avatars' }], error: null });
      const createSpy = jest.spyOn(supabaseAdmin.storage, 'createBucket');
      const updateSpy = jest
        .spyOn(supabaseAdmin.storage, 'updateBucket')
        .mockResolvedValueOnce({ data: { name: 'avatars' }, error: null });

      let capturedSql = '';
      const mockPgm = {
        sql: (statement) => {
          capturedSql = statement;
        },
      };

      await migration000065.up(mockPgm);

      expect(listSpy).toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith('avatars', { public: true });
      expect(capturedSql).toContain('UPDATE users');

      listSpy.mockRestore();
      createSpy.mockRestore();
      updateSpy.mockRestore();
    });

    it('handles offline/unreachable Supabase storage without throwing', async () => {
      const listSpy = jest
        .spyOn(supabaseAdmin.storage, 'listBuckets')
        .mockRejectedValueOnce(new Error('Storage service unreachable'));

      let capturedSql = '';
      const mockPgm = {
        sql: (statement) => {
          capturedSql = statement;
        },
      };

      await expect(migration000065.up(mockPgm)).resolves.not.toThrow();
      expect(capturedSql).toContain('UPDATE users');

      listSpy.mockRestore();
    });

    it('executes regexp_replace SQL query that rewrites legacy storage URLs', async () => {
      let capturedSql = '';
      const mockPgm = {
        sql: (statement) => {
          capturedSql = statement;
        },
      };

      await migration000065.up(mockPgm);

      expect(capturedSql).toMatch(/UPDATE\s+users/i);
      expect(capturedSql).toMatch(/SET\s+avatar_url\s*=\s*regexp_replace/i);
      expect(capturedSql).toContain(
        "'/storage/v1/object/public/[^/]+/(entities/)?avatars/'"
      );
      expect(capturedSql).toContain("'/storage/v1/object/public/avatars/'");
      expect(capturedSql).toContain("WHERE avatar_url LIKE '%/storage/v1/object/public/%'");
      expect(capturedSql).toContain(
        "AND avatar_url NOT LIKE '%/storage/v1/object/public/avatars/%'"
      );
    });

    it('validates SQL regex behavior matching both legacy patterns and preserving migrated URLs', () => {
      const regexPattern = /\/storage\/v1\/object\/public\/[^/]+\/(entities\/)?avatars\//;
      const replacement = '/storage/v1/object/public/avatars/';

      // Legacy with entities prefix
      const legacyWithEntities =
        'https://xyz.supabase.co/storage/v1/object/public/ata-lta-docs/entities/avatars/user-1/123.png';
      expect(legacyWithEntities.replace(regexPattern, replacement)).toBe(
        'https://xyz.supabase.co/storage/v1/object/public/avatars/user-1/123.png'
      );

      // Legacy without entities prefix
      const legacyWithoutEntities =
        'https://xyz.supabase.co/storage/v1/object/public/ata-lta-docs/avatars/user-1/123.png';
      expect(legacyWithoutEntities.replace(regexPattern, replacement)).toBe(
        'https://xyz.supabase.co/storage/v1/object/public/avatars/user-1/123.png'
      );

      // Already migrated URL
      const migratedUrl =
        'https://xyz.supabase.co/storage/v1/object/public/avatars/user-1/123.png';
      const isAlreadyMigrated =
        migratedUrl.includes('/storage/v1/object/public/') &&
        !migratedUrl.includes('/storage/v1/object/public/avatars/');
      expect(isAlreadyMigrated).toBe(false); // correctly excluded by WHERE clause
    });
  });
});
