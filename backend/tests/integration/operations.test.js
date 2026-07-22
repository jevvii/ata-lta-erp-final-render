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
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
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
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
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
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
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
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
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

    const singleTask = await request(app)
      .get(`/v1/work-requests/${wr.body.data.id}/tasks/${task.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(singleTask.body.data.id).toBe(task.body.data.id);
    expect(singleTask.body.data.title).toBe('Prepare documents');

    await request(app)
      .delete(`/v1/work-requests/${wr.body.data.id}/tasks/${task.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);
  });

  it('supports logging time under a task via POST /time-logs', async () => {
    const admin = registerUser({
      email: 'admin-tl@ata-lta.ph',
      name: 'Admin TL',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');
    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Time Log Test WR', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const task = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Task with time log', checklist: [{ id: '9a217645-7399-4893-99d0-9a2451b11c74', text: 'Subtask 1', completed: false }] })
      .expect(201);

    const checklistItemId = task.body.data.checklist[0].id;

    // Log time
    const updatedTask = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks/${task.body.data.id}/time-logs`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        logs: [
          {
            startTime: '09:00',
            endTime: '17:00',
            date: '2026-07-22',
            hours: 8,
            note: 'Worked on integration test',
            workerName: 'Integration Tester',
            checklistItemId,
          }
        ]
      })
      .expect(201);

    expect(updatedTask.body.data.checklist[0].timeLogs).toHaveLength(1);
    expect(updatedTask.body.data.checklist[0].timeLogs[0].startTime).toBe('09:00');
    expect(updatedTask.body.data.checklist[0].timeLogs[0].endTime).toBe('17:00');
    expect(updatedTask.body.data.checklist[0].timeLogs[0].workerName).toBe('Integration Tester');
  });

  it('forbids workflow:edit for staff without permission', async () => {
    const token = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Ops',
      role: 'Operations',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'WR', clientId: 'does-not-matter' })
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('creates and lists retainer templates', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    await request(app)
      .post('/v1/work-requests/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Monthly Retainer',
        clientId: client.id,
        schedule: 'Monthly',
        pfAmount: 10000,
        tasks: [{ title: 'Prepare FS' }, { title: 'Review FS' }],
      })
      .expect(201);

    const res = await request(app)
      .get('/v1/work-requests/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Monthly Retainer');
  });

  it('updates and deletes a retainer template', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/work-requests/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Quarterly Retainer' })
      .expect(201);

    const updated = await request(app)
      .put(`/v1/work-requests/templates/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ pfAmount: 5000 })
      .expect(200);

    expect(updated.body.data.pf_amount).toBe(5000);

    await request(app)
      .delete(`/v1/work-requests/templates/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);
  });

  it('creates and lists ground workers', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/work-requests/ground-workers')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Juan Dela Cruz' })
      .expect(201);

    const res = await request(app)
      .get('/v1/work-requests/ground-workers')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Juan Dela Cruz');
  });

  it('supports task creation with null/optional fields in checklist and task properties', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Review Null Fields', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const task = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Checklist task with null values',
        assigneeId: null,
        assigneeName: null,
        description: null,
        dueDate: null,
        checklist: [
          {
            text: 'Subtask with null assignee',
            completed: false,
            assigneeId: null,
            assigneeName: null,
            category: null,
          },
        ],
      })
      .expect(201);

    expect(task.body.data.title).toBe('Checklist task with null values');
    expect(task.body.data.checklist).toHaveLength(1);
    expect(task.body.data.checklist[0].assigneeId).toBeNull();
    expect(task.body.data.checklist[0].assigneeName).toBeNull();
  });
});
