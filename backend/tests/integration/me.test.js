/**
 * /v1/me integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser } = require('../fixtures/supabaseMock');

describe('GET /v1/me', () => {
  it('returns the current user profile and permissions', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA');

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('admin@ata-lta.ph');
    expect(res.body.data.activeEntity).toBe('ATA');
    expect(res.body.data.permissions).toContain('users:manage');
  });

  it('rejects requests without an entity header', async () => {
    const token = registerUser({
      email: 'noentity@ata-lta.ph',
      name: 'No Entity',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('rejects access to an unauthorized entity', async () => {
    const token = registerUser({
      email: 'ataonly@ata-lta.ph',
      name: 'ATA Only',
      role: 'Accounting',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'LTA');

    expect(res.status).toBe(403);
  });
});

describe('GET /v1/me/permissions', () => {
  it('returns the permission set for an Accounting user', async () => {
    const token = registerUser({
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/me/permissions')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA');

    expect(res.status).toBe(200);
    expect(res.body.data).toContain('clients:view');
    expect(res.body.data).toContain('billing:edit');
    expect(res.body.data).not.toContain('users:manage');
  });
});
