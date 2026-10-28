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

const DEFAULT_WR_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_TASK_ID = '00000000-0000-4000-8000-000000000002';

const validDocument = {
  fileName: 'contract.pdf',
  contentType: 'application/pdf',
  fileSize: 1024,
  originalName: 'Contract.pdf',
  workRequestId: DEFAULT_WR_ID,
  linkedTaskId: DEFAULT_TASK_ID,
};

describe('/v1/documents', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    mockTables.work_requests.set(DEFAULT_WR_ID, {
      id: DEFAULT_WR_ID,
      entity_id: 'ent-ata',
      title: 'Default WR',
      status: 'In Progress',
      deleted_at: null,
    });
    mockTables.tasks.set(DEFAULT_TASK_ID, {
      id: DEFAULT_TASK_ID,
      work_request_id: DEFAULT_WR_ID,
      title: 'Default Task',
      status: 'In Progress',
      deleted_at: null,
    });
  });

  it('creates a document linked to a task and lists by linkedTaskId', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mockTables.tasks.set(taskId, { id: taskId, work_request_id: DEFAULT_WR_ID });

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
    mockTables.tasks.set(taskId, { id: taskId, work_request_id: DEFAULT_WR_ID });
    mockTables.tasks.set(otherTaskId, { id: otherTaskId, work_request_id: DEFAULT_WR_ID });

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
        workRequestId: DEFAULT_WR_ID,
        linkedTaskId: DEFAULT_TASK_ID,
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
    const opsUserId = '00000000-0000-4000-a000-000000000888';
    const wrId = 'aaaaaaaa-1111-4111-8111-111111111111';
    const taskId = 'bbbbbbbb-2222-4222-8222-222222222222';

    mockTables.work_requests.set(wrId, {
      id: wrId,
      entity_id: 'ent-ata',
      title: 'Ops Project',
      status: 'In Progress',
      assigned_to: opsUserId,
    });
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: wrId,
      assignee_id: opsUserId,
      deleted_at: null,
    });

    const token = registerUser({
      id: opsUserId,
      email: 'ops@ata-lta.ph',
      name: 'Ops Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, linkedTaskId: taskId, workRequestId: wrId })
      .expect(201);

    const docId = created.body.data.document.id;

    await request(app)
      .post(`/v1/documents/${docId}/confirm-upload`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
  });

  it('rejects legacy whole-thread replacement', async () => {
    const token = registerUser({ email: 'admin@example.test', name: 'Admin', role: 'Admin', entities: ['ATA'] });
    const created = await request(app).post('/v1/documents')
      .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA').send(validDocument).expect(201);
    await request(app).put(`/v1/documents/${created.body.data.document.id}`)
      .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA')
      .send({ comments: [] }).expect(400);
  });

  it('Task A.8: enforces server-side task assignee authorization on POST /v1/documents (FORBIDDEN_TASK_ATTACHMENT)', async () => {
    const assigneeStaff = registerUser({
      id: '11111111-2222-3333-4444-555555555555',
      email: 'assignee@ata-lta.ph',
      name: 'Assignee Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const nonAssigneeStaff = registerUser({
      id: '66666666-7777-8888-9999-000000000000',
      email: 'non-assignee@ata-lta.ph',
      name: 'Non Assignee Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const taskId = 'aaaaaaaa-1111-2222-3333-444444444444';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: DEFAULT_WR_ID,
      assignee_id: '11111111-2222-3333-4444-555555555555',
    });

    // 1. Non-assignee staff receives 403 FORBIDDEN_TASK_ATTACHMENT
    const forbiddenRes = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${nonAssigneeStaff}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, linkedTaskId: taskId });

    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.code).toBe('FORBIDDEN_TASK_ATTACHMENT');
    expect(forbiddenRes.body.detail).toMatch(/not assigned to this task/i);

    // 2. Assignee staff succeeds with 201 Created
    const allowedRes = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${assigneeStaff}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDocument, linkedTaskId: taskId });

    expect(allowedRes.status).toBe(201);
    expect(allowedRes.body.data.document.linked_task_id).toBe(taskId);
  });

  it('returns external_url when requesting download-url for external link documents', async () => {
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
        fileName: 'google-drive-contract',
        originalName: 'Google Drive Contract.pdf',
        externalUrl: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing',
        category: 'CONTRACT',
        workRequestId: DEFAULT_WR_ID,
        linkedTaskId: DEFAULT_TASK_ID,
      })
      .expect(201);

    const docId = created.body.data.document.id;

    const res = await request(app)
      .get(`/v1/documents/${docId}/download-url`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.url).toBe(
      'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view?usp=sharing'
    );
    expect(res.body.data.fileName).toBe('Google Drive Contract.pdf');
  });

  it('falls back to file_name when original_name is not provided for external link documents', async () => {
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
        fileName: 'google-sheets-tracker.xlsx',
        externalUrl: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/edit',
        category: 'FINANCIAL',
        workRequestId: DEFAULT_WR_ID,
        linkedTaskId: DEFAULT_TASK_ID,
      })
      .expect(201);

    const docId = created.body.data.document.id;

    const res = await request(app)
      .get(`/v1/documents/${docId}/download-url`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.url).toBe(
      'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/edit'
    );
    expect(res.body.data.fileName).toBe('google-sheets-tracker.xlsx');
  });

  it('trims whitespace on external_url when requesting download-url', async () => {
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
        fileName: 'presentation.pptx',
        originalName: 'Company Pitch.pptx',
        externalUrl: '  https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/edit  ',
        category: 'OTHER',
        workRequestId: DEFAULT_WR_ID,
        linkedTaskId: DEFAULT_TASK_ID,
      })
      .expect(201);

    const docId = created.body.data.document.id;

    const res = await request(app)
      .get(`/v1/documents/${docId}/download-url`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.url).toBe(
      'https://docs.google.com/presentation/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/edit'
    );
    expect(res.body.data.fileName).toBe('Company Pitch.pptx');
  });

  it('throws 404 if document has empty or whitespace-only external_url and no storage_path', async () => {
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
        fileName: 'contract.pdf',
        externalUrl: 'https://example.com/contract.pdf',
        category: 'CONTRACT',
        workRequestId: DEFAULT_WR_ID,
        linkedTaskId: DEFAULT_TASK_ID,
      })
      .expect(201);

    const docId = created.body.data.document.id;

    await request(app)
      .put(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        externalUrl: '   ',
      })
      .expect(200);

    const res = await request(app)
      .get(`/v1/documents/${docId}/download-url`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);

    expect(res.body.detail).toBe('Document has no associated file');
  });

  it('enriches document records with uploader_name, work_request_title, and linked_task_title', async () => {
    const userId = '11111111-1111-1111-1111-111111111111';
    const token = registerUser({
      id: userId,
      email: 'twinkle@ata-lta.ph',
      name: 'Twinkle Documents',
      role: 'Admin',
      entities: ['ATA'],
    });

    const wrId = '22222222-2222-2222-2222-222222222222';
    mockTables.work_requests.set(wrId, {
      id: wrId,
      entity_id: 'ent-ata',
      title: 'Tax Compliance 2026',
    });

    const taskId = '33333333-3333-3333-3333-333333333333';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: wrId,
      title: 'Prepare BIR 1702',
      assignee_id: userId,
    });

    const created = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        ...validDocument,
        workRequestId: wrId,
        linkedTaskId: taskId,
      })
      .expect(201);

    const docId = created.body.data.document.id;

    // Verify getDocumentById enrichment
    const singleRes = await request(app)
      .get(`/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(singleRes.body.data.uploader_name).toBe('Twinkle Documents');
    expect(singleRes.body.data.work_request_title).toBe('Tax Compliance 2026');
    expect(singleRes.body.data.linked_task_title).toBe('Prepare BIR 1702');

    // Verify listDocuments enrichment
    const listRes = await request(app)
      .get(`/v1/documents?linkedTaskId=${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].uploader_name).toBe('Twinkle Documents');
    expect(listRes.body.data[0].work_request_title).toBe('Tax Compliance 2026');
    expect(listRes.body.data[0].linked_task_title).toBe('Prepare BIR 1702');
  });
  describe('Uploaded previews in consolidated view', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    let token;
    beforeEach(() => {
      token = registerUser({ email: 'preview-admin@ata-lta.ph', name: 'Admin', role: 'Admin', entities: ['ATA', 'LTA'] });
      mockTables.documents.set(id, {
        id, entity_id: 'ent-lta', status: 'active', storage_path: 'lta/preview.pdf',
        file_name: 'preview.pdf', original_name: 'Preview.pdf', content_type: 'application/pdf', deleted_at: null,
      });
    });
    it.each(['ALL', undefined])('returns a signed preview URL for LTA with entity %s', async (entity) => {
      const req = request(app).get(`/v1/documents/${id}/download-url`).set('Authorization', `Bearer ${token}`);
      if (entity) req.set('X-Active-Entity', entity);
      const res = await req.expect(200);
      expect(res.body.data.url).toBeTruthy();
      expect(res.body.data.fileName).toBe('Preview.pdf');
    });
    it('retains explicit entity and consolidated-access restrictions', async () => {
      await request(app).get(`/v1/documents/${id}/download-url`)
        .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA').expect(404);
      const restricted = registerUser({ email: 'restricted-preview@ata-lta.ph', name: 'Admin', role: 'Admin', entities: ['ATA'] });
      await request(app).get(`/v1/documents/${id}/download-url`)
        .set('Authorization', `Bearer ${restricted}`).set('X-Active-Entity', 'ALL').expect(403);
    });
  });

});
