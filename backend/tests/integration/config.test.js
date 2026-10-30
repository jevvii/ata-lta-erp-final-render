/**
 * Public runtime config & HTTP Cache-Control integration tests.
 * Validates Milestone M1 (Parcel R1):
 * - GET /v1/config/public is unauthenticated and returns 200 with supabaseUrl, supabaseAnonKey, entities
 * - Strict no-store/no-cache headers on /v1 operational routes
 * - Fallback entity resiliency when database query fails
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

// Runtime configuration tests must not depend on a developer's local credentials.
process.env.SUPABASE_ANON_KEY = 'sb_publishable_test_public_key';

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { supabaseAdmin } = require('../../src/services/supabaseClient');
const { resetMock, seedDefaults } = require('../fixtures/supabaseMock');

describe('Milestone M1: Public Runtime Config & HTTP Cache-Control', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  describe('GET /v1/config/public', () => {
    it('returns 200 without authentication and provides runtime config', async () => {
      const res = await request(app).get('/v1/config/public');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      const { data } = res.body;

      expect(typeof data.supabaseUrl).toBe('string');
      expect(data.supabaseUrl.length).toBeGreaterThan(0);

      expect(typeof data.supabaseAnonKey).toBe('string');
      expect(data.supabaseAnonKey.length).toBeGreaterThan(0);

      expect(Array.isArray(data.entities)).toBe(true);
      expect(data.entities.length).toBeGreaterThanOrEqual(2);

      const ataEntity = data.entities.find((e) => e.code === 'ATA');
      expect(ataEntity).toBeDefined();
      expect(ataEntity).toHaveProperty('id');
      expect(ataEntity).toHaveProperty('name');

      const ltaEntity = data.entities.find((e) => e.code === 'LTA');
      expect(ltaEntity).toBeDefined();
      expect(ltaEntity).toHaveProperty('id');
      expect(ltaEntity).toHaveProperty('name');
    });

    it('sets strict no-store/no-cache headers on /v1/config/public', async () => {
      const res = await request(app).get('/v1/config/public');

      expect(res.status).toBe(200);
      const cacheControl = res.headers['cache-control'];
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('no-cache');
      expect(cacheControl).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');

      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['expires']).toBe('0');
      expect(res.headers['vary']).toContain('X-Active-Entity');
      expect(res.headers['vary']).toContain('Authorization');
    });

    it('falls back to default entities when Supabase query fails', async () => {
      const fromSpy = jest.spyOn(supabaseAdmin, 'from').mockImplementationOnce(() => {
        throw new Error('Database connection failed');
      });

      const res = await request(app).get('/v1/config/public');

      expect(res.status).toBe(200);
      const { data } = res.body;
      expect(Array.isArray(data.entities)).toBe(true);
      expect(data.entities).toEqual([
        {
          id: 'e83dc90b-d9b5-4854-8adf-7fe21c2e6822',
          code: 'ATA',
          name: 'ATA Accounting Firm',
        },
        {
          id: '16749820-0129-44a8-9435-a6013d07a370',
          code: 'LTA',
          name: 'LTA Accounting Firm',
        },
      ]);

      fromSpy.mockRestore();
    });
  });

  describe('Strict Cache-Control across /v1 routes', () => {
    it('sets strict no-store/no-cache headers on operational GET /v1 endpoints', async () => {
      const res = await request(app).get('/v1/me');

      // Unauthenticated request to /v1/me returns 401, but the /v1 middleware sets headers
      const cacheControl = res.headers['cache-control'];
      expect(cacheControl).toBeDefined();
      expect(cacheControl).toContain('no-store');
      expect(cacheControl).toContain('no-cache');
      expect(res.headers['pragma']).toBe('no-cache');
      expect(res.headers['expires']).toBe('0');
      expect(res.headers['vary']).toContain('X-Active-Entity');
      expect(res.headers['vary']).toContain('Authorization');
    });
  });
});
