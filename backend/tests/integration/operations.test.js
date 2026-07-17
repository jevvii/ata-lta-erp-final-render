/**
 * /v1/work-requests integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock } = require('../fixtures/supabaseMock');

const createClient = async (token, entity, overrides = {}) => {
  const res = await request(app)
    .post('/v1/clients')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity)
    .send({
      name: 'Test Client',
      tin: `123-456-789-${String(Math.random()).slice(2, 7)}`,
      entity,
      ...overrides,
    });
  return res.body.data;
};

describe('/v1/work-requests', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('creates and retrieves a work request', async () => {
    const admin = registerUser({ email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', entities: ['ATA', 'LTA'] });
    const client = await createClient(admin, 'ATA');

    const wrRes = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Annual Audit', clientId: client.id, entity: 'ATA' })
      .expect(201);

    expect(wrRes.body.data.title).toBe('Annual Audit');
    expect(wrRes.body.data.status).toBe('Draft');

    const getRes = await request(app)
      .get(`/v1/work-requests/${wrRes.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(getRes.body.data.clientId).toBe(client.id);
  });

  it('rejects invalid status transitions', async () => {
    const admin = registerUser({ email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', entities: ['ATA'] });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Tax Filing', clientId: client.id, entity: 'ATA' })
      .expect(201);

    await request(app)
      .put(`/v1/work-requests/${wr.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'Completed' })
      .expect(400);
  });

  it('allows valid status transitions', async () => {
    const admin = registerUser({ email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', entities: ['ATA'] });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Review', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const updated = await request(app)
      .put(`/v1/work-requests/${wr.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'In Progress' })
      .expect(200);

    expect(updated.body.data.status).toBe('In Progress');
  });

  it('supports task CRUD under a work request', async () => {
    const admin = registerUser({ email: 'admin@ata-lta.ph', name: 'Admin', role: 'Admin', entities: ['ATA'] });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Review', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const task = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Prepare documents', checklist: [{ text: 'SEC cert', completed: false }] })
      .expect(201);

    expect(task.body.data.title).toBe('Prepare documents');
    expect(task.body.data.checklist).toHaveLength(1);

    const tasks = await request(app)
      .get(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(tasks.body.data).toHaveLength(1);

    await request(app)
      .delete(`/v1/work-requests/${wr.body.data.id}/tasks/${task.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);
  });

  it('forbids workflow:edit for staff without permission', async () => {
    const token = registerUser({ email: 'ops@ata-lta.ph', name: 'Ops', role: 'Operations', entities: ['ATA'] });

    const res = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'WR', clientId: 'does-not-matter' })
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });
});
