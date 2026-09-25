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
  retainerFee: 5000.5,
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
    expect(res.body.data.retainer).toBe(true);
    expect(res.body.data.retainerFee).toBe(5000.5);
    expect(res.body.data.contactDetails).toHaveLength(1);

    const audit = Array.from(mockTables.audit_logs.values());
    expect(audit.some((a) => a.action === 'client.created' && a.table_name === 'clients')).toBe(
      true
    );
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

    const archivedRes = await request(app)
      .get(`/v1/clients/${created.body.data.id}?includeArchived=true`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(archivedRes.body.data.id).toBe(created.body.data.id);
    expect(archivedRes.body.data.status).toBe('Archived');

    const audit = Array.from(mockTables.audit_logs.values());
    expect(audit.some((a) => a.action === 'client.archived')).toBe(true);
  });

  it('returns client counts for the active entity', async () => {
    const admin = registerUser({
      email: 'admin-counts@ata-lta.ph',
      name: 'Admin Counts',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .get('/v1/clients/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveProperty('active');
    expect(res.body.data).toHaveProperty('archived');
  });

  it('correctly partitions archived clients with null deleted_at into archived counts and lists', async () => {
    const admin = registerUser({
      email: 'admin-partition@ata-lta.ph',
      name: 'Admin Partition',
      role: 'Admin',
      entities: ['ATA'],
    });

    const activeClientRes = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validClient, name: 'Active Client 1', tin: '111-222-333-00001' })
      .expect(201);

    // Insert a legacy record into mockTables directly: status 'Archived' with deleted_at null
    const legacyArchivedId = 'legacy-archived-1';
    mockTables.clients.set(legacyArchivedId, {
      id: legacyArchivedId,
      name: 'Legacy Archived Client',
      entity_id: 'ent-ata',
      entity_code: 'ATA',
      status: 'Archived',
      deleted_at: null,
      version: 1,
    });

    const countsRes = await request(app)
      .get('/v1/clients/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(countsRes.body.data.active).toBe(1);
    expect(countsRes.body.data.archived).toBe(1);

    const listActiveRes = await request(app)
      .get('/v1/clients')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(listActiveRes.body.data.some((c) => c.id === legacyArchivedId)).toBe(false);
    expect(listActiveRes.body.data.some((c) => c.id === activeClientRes.body.data.id)).toBe(true);

    const listArchivedRes = await request(app)
      .get('/v1/clients?status=Archived')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(listArchivedRes.body.data.some((c) => c.id === legacyArchivedId)).toBe(true);
  });
});
