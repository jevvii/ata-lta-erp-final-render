/**
 * /v1/documents integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

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
    mockTables.tasks.set(taskId, { id: taskId, work_request_id: null });

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
    mockTables.tasks.set(taskId, { id: taskId, work_request_id: null });
    mockTables.tasks.set(otherTaskId, { id: otherTaskId, work_request_id: null });

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

  it('validates linked task existence', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const nonExistentTaskId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, linkedTaskId: nonExistentTaskId })
      .expect(400);
  });

  it('validates linked task work request alignment', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const workRequestId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    mockTables.tasks.set(taskId, { id: taskId, work_request_id: 'different-wr-uuid' });

    await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, linkedTaskId: taskId, workRequestId })
      .expect(400);
  });

  it('enforces file size validation guardrail', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, fileSize: 60 * 1024 * 1024 }) // 60 MB
      .expect(400);
  });

  it('handles external url documents by making them active immediately', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        fileName: 'link-attachment',
        originalName: 'Link Attachment',
        externalUrl: 'https://google.com/drive/folder',
      })
      .expect(201);

    expect(created.body.data.document.status).toBe('active');
    expect(created.body.data.document.external_url).toBe('https://google.com/drive/folder');
    expect(created.body.data.uploadUrl).toBeNull();
  });

  it('requires confirm-upload to activate pending documents, and restricts download url for pending ones', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDocument)
      .expect(201);

    const docId = created.body.data.document.id;
    expect(created.body.data.document.status).toBe('pending_upload');

    // Trying to get download url for pending document should yield conflict 409
    await request(app)
      .get(`/v1/documents/${docId}/download-url`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(409);

    // Confirm upload
    const confirmed = await request(app)
      .post(`/v1/documents/${docId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(confirmed.body.data.status).toBe('active');

    // Now get download url works
    const download = await request(app)
      .get(`/v1/documents/${docId}/download-url`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(download.body.data.url).toBeDefined();
  });

  it('allows workflow:task_upload permission users to create and confirm upload', async () => {
    // Operations role only has workflow:task_upload and dms:view, not dms:edit
    const token = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Ops Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDocument)
      .expect(201);

    const docId = created.body.data.document.id;

    await request(app)
      .post(`/v1/documents/${docId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
  });

  it('persists document comments through update and get round-trip', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDocument)
      .expect(201);

    const docId = created.body.data.document.id;
    const comments = [
      { id: 'comment-1', userId: 'user-a', date: new Date().toISOString(), text: 'First comment' },
      { id: 'comment-2', userId: 'user-b', date: new Date().toISOString(), text: 'Second comment' },
    ];

    await request(app)
      .put(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ comments })
      .expect(200);

    const docRes = await request(app)
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(docRes.body.data.comments).toHaveLength(2);
    expect(docRes.body.data.comments[0].text).toBe('First comment');
    expect(docRes.body.data.comments[1].text).toBe('Second comment');
    expect(docRes.body.data.comments[0].id).toBe('comment-1');
  });
});
