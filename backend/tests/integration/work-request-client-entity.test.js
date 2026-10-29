jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

describe('work request client entity validation', () => {
  let token;
  let clients;

  beforeEach(async () => {
    resetMock();
    seedDefaults();
    token = registerUser({
      email: 'client-entity-admin@ata-lta.ph',
      name: 'Client Entity Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    clients = {};
    for (const entity of ['ATA', 'LTA']) {
      const res = await request(app)
        .post('/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', entity)
        .send({ name: `${entity} Client`, tin: `${entity}-client-entity-test`, entity })
        .expect(201);
      clients[entity] = res.body.data;
    }
  });

  const create = (entity, clientId, extra = {}, header = entity) => request(app)
    .post('/v1/work-requests')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', header)
    .send({ title: 'Entity scoped work request', dueDate: '2026-12-31', entity, clientId, ...extra });

  it.each([
    ['ATA', 'LTA', 'ATA', false],
    ['LTA', 'ATA', 'LTA', false],
    ['ATA', 'LTA', 'ALL', false],
    ['LTA', 'ATA', 'ALL', false],
    ['ATA', 'LTA', 'ALL', true],
    ['LTA', 'ATA', 'ALL', true],
  ])('rejects %s work request with %s client in %s view (graph: %s)', async (entity, other, header, graph) => {
    const res = await create(entity, clients[other].id, graph ? {
      phases: { pre_processing: { tasks: [{ title: 'Collect records', local_id: 't1' }] } },
    } : {}, header).expect(400);

    expect(res.body.code).toBe('CLIENT_ENTITY_MISMATCH');
    expect(mockTables.work_requests.size).toBe(0);
    expect(mockTables.tasks.size).toBe(0);
  });

  it.each(['ATA', 'LTA'])('accepts matching %s clients in consolidated view', async (entity) => {
    const res = await create(entity, clients[entity].id, {}, 'ALL').expect(201);
    expect(res.body.data.entity).toBe(entity);
    expect(res.body.data.clientId).toBe(clients[entity].id);
  });

  it('rejects a nonexistent client before creating records', async () => {
    const res = await create('ATA', '00000000-0000-4000-8000-000000000099').expect(400);
    expect(res.body.code).toBe('CLIENT_ENTITY_MISMATCH');
    expect(mockTables.work_requests.size).toBe(0);
  });

  it.each([['ATA', 400], ['ALL', 404]])('rejects cross-entity client replacement in %s view without changing the record', async (header, status) => {
    const created = await create('ATA', clients.ATA.id).expect(201);
    const id = created.body.data.id;
    const before = { ...mockTables.work_requests.get(id) };
    const res = await request(app)
      .put(`/v1/work-requests/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', header)
      .send({ clientId: clients.LTA.id, title: 'Must not persist' })
      .expect(status);

    // ALL resolves the route using the submitted client, so an existing work
    // request in the other entity is rejected before reaching the service.
    if (status === 400) expect(res.body.code).toBe('CLIENT_ENTITY_MISMATCH');
    expect(mockTables.work_requests.get(id)).toEqual(before);
  });

  it('does not rebind an existing work request through an ALL-view entity hint', async () => {
    const created = await create('ATA', clients.ATA.id).expect(201);
    const id = created.body.data.id;
    const res = await request(app)
      .put(`/v1/work-requests/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ALL')
      .send({ entity: 'LTA', clientId: clients.LTA.id })
      .expect(404);

    expect(res.body.title).toBe('Not Found');
    expect(mockTables.work_requests.get(id).client_id).toBe(clients.ATA.id);
  });

  it('validates client replacement against the stored entity in an unscoped service lookup', async () => {
    const created = await create('ATA', clients.ATA.id).expect(201);
    const { updateWorkRequest } = require('../../src/modules/operations/service');
    await expect(updateWorkRequest({
      id: created.body.data.id,
      entityId: null,
      data: { clientId: clients.LTA.id },
      user: { role: 'Admin', entities: ['ATA', 'LTA'] },
    })).rejects.toMatchObject({ statusCode: 400, code: 'CLIENT_ENTITY_MISMATCH' });
    expect(mockTables.work_requests.get(created.body.data.id).client_id).toBe(clients.ATA.id);
  });

  it('accepts a same-entity client update', async () => {
    const created = await create('ATA', clients.ATA.id).expect(201);
    const updated = await request(app)
      .put(`/v1/work-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ALL')
      .send({ clientId: clients.ATA.id, title: 'Updated within ATA' })
      .expect(200);
    expect(updated.body.data.clientId).toBe(clients.ATA.id);
    expect(updated.body.data.title).toBe('Updated within ATA');
  });
});
