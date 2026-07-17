/**
 * /v1/clients integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const validClient = {
  name: 'Acme Corp',
  tin: '123-456-789-00001',
  rdoCode: '034A',
  address: 'Makati City',
  entity: 'ATA',
  retainer: true,
  tradeName: 'Acme',
  contactDetails: [{ type: 'email', value: 'info@acme.test', label: 'Main' }],
  relatedCompanies: [],
};

describe('/v1/clients', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('creates a client when user has clients:edit', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    expect(res.body.data.name).toBe('Acme Corp');
    expect(res.body.data.entity).toBe('ATA');
    expect(res.body.data.contactDetails).toHaveLength(1);

    const audit = Array.from(mockTables.audit_logs.values());
    expect(audit.some((a) => a.action === 'client.created' && a.table_name === 'clients')).toBe(true);
  });

  it('lists clients scoped to the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'LTA')
      .send({ ...validClient, tin: '123-456-789-00002', entity: 'LTA' })
      .expect(201);

    const res = await request(app)
      .get('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entity).toBe('ATA');
  });

  it('forbids clients:edit for users without the permission', async () => {
    const token = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('returns 404 for a client outside the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const created = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    const res = await request(app)
      .get(`/v1/clients/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'LTA')
      .expect(404);

    expect(res.body.title).toMatch(/not found/i);
  });

  it('soft deletes a client and writes an audit log', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validClient)
      .expect(201);

    await request(app)
      .delete(`/v1/clients/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);

    await request(app)
      .get(`/v1/clients/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);

    const audit = Array.from(mockTables.audit_logs.values());
    expect(audit.some((a) => a.action === 'client.archived')).toBe(true);
  });
});
