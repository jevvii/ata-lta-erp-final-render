/**
 * /v1/me integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock } = require('../fixtures/supabaseMock');

describe('GET /v1/me', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

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
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

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

describe('PATCH /v1/me', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('updates name and preferences', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      preferences: { theme: 'light' },
    });

    const res = await request(app)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Admin Updated', preferences: { theme: 'dark' } })
      .expect(200);

    expect(res.body.data.name).toBe('Admin Updated');
    expect(res.body.data.preferences.theme).toBe('dark');
  });

  it('rejects empty payload', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .patch('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({})
      .expect(400);

    expect(res.body.title).toMatch(/bad request/i);
  });
});

describe('PATCH /v1/me/password', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('changes password with valid input', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    await request(app)
      .patch('/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ currentPassword: 'oldpass', newPassword: 'newpass123' })
      .expect(204);
  });

  it('rejects short new password', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .patch('/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ currentPassword: 'oldpass', newPassword: 'short' })
      .expect(400);

    expect(res.body.detail).toMatch(/at least 8 characters/i);
  });
});

describe('POST /v1/me/avatar-upload-url', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('returns a signed upload URL', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .post('/v1/me/avatar-upload-url')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.signedUrl).toMatch(/^https:\/\//);
    expect(res.body.data.publicUrl).toMatch(/^https:\/\//);
    expect(res.body.data.path).toMatch(/^avatars\//);
  });
});
