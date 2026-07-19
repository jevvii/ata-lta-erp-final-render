/**
 * /v1/documents integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock } = require('../fixtures/supabaseMock');

const validDocument = {
  fileName: 'contract.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  originalName: 'Contract.pdf',
};

describe('/v1/documents', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('creates a document linked to a task and lists by linkedTaskId', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, linkedTaskId: taskId })
      .expect(201);

    expect(created.body.data.document.linked_task_id).toBe(taskId);

    const list = await request(app)
      .get(`/v1/documents?linkedTaskId=${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].linked_task_id).toBe(taskId);
  });

  it('updates a document linked_task_id', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const otherTaskId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, linkedTaskId: taskId })
      .expect(201);

    const updated = await request(app)
      .put(`/v1/documents/${created.body.data.document.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ linkedTaskId: otherTaskId })
      .expect(200);

    expect(updated.body.data.linked_task_id).toBe(otherTaskId);
  });
});
