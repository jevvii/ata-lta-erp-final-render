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

  it('defaults to the first available entity when entity header is missing', async () => {
    const token = registerUser({
      email: 'noentity@ata-lta.ph',
      name: 'No Entity',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app).get('/v1/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.activeEntity).toBe('ATA');
  });

  it('rejects requests without an entity header if user has no valid entities', async () => {
    const token = registerUser({
      email: 'novalidentities@ata-lta.ph',
      name: 'No Valid Entities',
      role: 'Admin',
      entities: ['XYZ'],
    });

    const res = await request(app).get('/v1/me').set('Authorization', `Bearer ${token}`);

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

describe('GET /v1/me/team', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('returns visible users scoped by shared entity', async () => {
    const ataUser = registerUser({
      email: 'ataonly@ata-lta.ph',
      name: 'ATA Staff',
      role: 'Accounting',
      entities: ['ATA'],
    });

    registerUser({
      email: 'ltaonly@ata-lta.ph',
      name: 'LTA Staff',
      role: 'Operations',
      entities: ['LTA'],
    });

    const res = await request(app)
      .get('/v1/me/team')
      .set('Authorization', `Bearer ${ataUser}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const names = res.body.data.map((u) => u.name);
    expect(names).toContain('ATA Staff');
    expect(names).not.toContain('LTA Staff');
  });

  it('returns all users for an admin', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA'],
    });

    registerUser({
      email: 'ltaonly@ata-lta.ph',
      name: 'LTA Staff',
      role: 'Operations',
      entities: ['LTA'],
    });

    const res = await request(app)
      .get('/v1/me/team')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const names = res.body.data.map((u) => u.name);
    expect(names).toContain('LTA Staff');
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
      password: 'initialpassword1',
    });

    await request(app)
      .patch('/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ currentPassword: 'initialpassword1', newPassword: 'newpass123' })
      .expect(204);

    // Old password should now fail
    const failRes = await request(app)
      .patch('/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ currentPassword: 'initialpassword1', newPassword: 'anotherpass123' })
      .expect(400);
    expect(failRes.body.detail).toMatch(/current password is incorrect/i);

    // New password should succeed
    await request(app)
      .patch('/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ currentPassword: 'newpass123', newPassword: 'anotherpass123' })
      .expect(204);
  });

  it('rejects incorrect current password', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Administrator',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      password: 'correctpassword1',
    });

    const res = await request(app)
      .patch('/v1/me/password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ currentPassword: 'wrongpassword', newPassword: 'newpass123' })
      .expect(400);

    expect(res.body.detail).toMatch(/current password is incorrect/i);
  });

  it('rejects missing current password', async () => {
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
      .send({ newPassword: 'newpass123' })
      .expect(400);

    expect(res.body.detail).toMatch(/current password and new password are required/i);
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
    expect(res.body.data.publicUrl).toContain('/storage/v1/object/public/avatars/');
    expect(res.body.data.path).toMatch(/^mock-\d+\/\d+\.png$/);
  });
});

describe('GET /v1/me — P0-A frozen keys (spec: docs/enterprise-migration/P0-A)', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('Manager embed includes workflow:transition_request and excludes workflow:phase_transition', async () => {
    const token = registerUser({
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA');

    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toContain('workflow:transition_request');
    expect(res.body.data.permissions).toContain('retainers:use');
    expect(res.body.data.permissions).not.toContain('workflow:phase_transition');
    expect(res.body.data.permissions).not.toContain('disbursement:approve');
  });

  it('staff embed includes timelog:create but not timelog:edit_all', async () => {
    const token = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Ops Staff',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA');

    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toContain('timelog:create');
    expect(res.body.data.permissions).toContain('notifications:view');
    expect(res.body.data.permissions).not.toContain('timelog:edit_all');
  });

  it('embeds permissions as a sorted array matching /v1/me/permissions as a set', async () => {
    const token = registerUser({
      email: 'manager2@ata-lta.ph',
      name: 'Manager Two',
      role: 'Manager',
      entities: ['ATA'],
    });

    const me = await request(app)
      .get('/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA');
    const list = await request(app)
      .get('/v1/me/permissions')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA');

    expect(me.status).toBe(200);
    expect(list.status).toBe(200);
    expect(me.body.data.permissions).toEqual([...me.body.data.permissions].sort());
    expect(new Set(me.body.data.permissions)).toEqual(new Set(list.body.data));
  });
});
