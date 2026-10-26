/**
 * Post-Remediation Verification Suite
 * Proves that the Document Upload Confirmation 404 defect is resolved.
 */

jest.mock('../../../../backend/src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../../backend/tests/fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../../../../backend/tests/helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../../../../backend/tests/fixtures/supabaseMock');

describe('Post-Remediation Verification: Document Upload Confirmation & Entity Resolution', () => {
  const opsUserId = '455f521b-e301-4b98-9b01-870b67adbd49';
  const adminUserId = '11111111-2222-3333-4444-555555555555';
  const wrId = 'ca85bc39-2afb-48b7-b754-44e821d4a105';
  const taskId = '480ef431-2f33-404c-9c62-192603da267c';
  const ltaDocId = '2deabc18-31a7-4419-80c3-e0a854864d7d';

  let opsToken;
  let adminToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    opsToken = registerUser({
      id: opsUserId,
      email: 'loida@ata-lta.ph',
      name: 'Loida Delgaco',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
    });

    adminToken = registerUser({
      id: adminUserId,
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    mockTables.work_requests.set(wrId, {
      id: wrId,
      entity_id: 'ent-lta',
      title: 'LTA Client Compliance',
      status: 'In Progress',
      assigned_to: opsUserId,
      deleted_at: null,
    });

    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: wrId,
      assignee_id: opsUserId,
      deleted_at: null,
    });
  });

  it('V01: confirm-upload succeeds with 200 OK and status active for LTA documents in ALL view', async () => {
    const createRes = await request(app)
      .post('/v1/documents')
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ALL')
      .send({
        fileName: 'a_house_in_the_snow.png',
        originalName: 'a_house_in_the_snow.png',
        contentType: 'image/png',
        fileSize: 12345,
        workRequestId: wrId,
        linkedTaskId: taskId,
        category: 'OTHER',
      })
      .expect(201);

    const docId = createRes.body.data.document.id;
    expect(createRes.body.data.document.status).toBe('pending_upload');
    expect(createRes.body.data.document.entity_id).toBe('ent-lta');

    // Confirm upload with X-Active-Entity: ALL
    const confirmRes = await request(app)
      .post(`/v1/documents/${docId}/confirm-upload`)
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ALL')
      .expect(200);

    expect(confirmRes.body.data.status).toBe('active');
    expect(confirmRes.body.data.updated_by).toBe(opsUserId);

    const docInDb = mockTables.documents.get(docId);
    expect(docInDb.status).toBe('active');
    expect(docInDb.updated_by).toBe(opsUserId);
  });

  it('V02: download-url preview succeeds with 200 OK once confirmed', async () => {
    mockTables.documents.set(ltaDocId, {
      id: ltaDocId,
      entity_id: 'ent-lta',
      status: 'active',
      storage_path: 'entities/LTA/clients/.../client-documents',
      file_name: 'client-documents',
      original_name: 'a_house_in_the_snow.png',
      content_type: 'image/png',
      work_request_id: wrId,
      linked_task_id: taskId,
      uploader_id: opsUserId,
      archived: false,
      deleted_at: null,
      created_at: new Date().toISOString(),
    });

    const previewRes = await request(app)
      .get(`/v1/documents/${ltaDocId}/download-url`)
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ALL')
      .expect(200);

    expect(previewRes.body.data.url).toBeDefined();
  });

  it('V03: document mutations (archive, comments) succeed for LTA records in ALL view', async () => {
    mockTables.documents.set(ltaDocId, {
      id: ltaDocId,
      entity_id: 'ent-lta',
      status: 'active',
      storage_path: 'entities/LTA/clients/.../client-documents',
      file_name: 'client-documents',
      original_name: 'a_house_in_the_snow.png',
      content_type: 'image/png',
      work_request_id: wrId,
      linked_task_id: taskId,
      uploader_id: opsUserId,
      archived: false,
      deleted_at: null,
      comments: [],
      created_at: new Date().toISOString(),
    });

    const archiveRes = await request(app)
      .post(`/v1/documents/${ltaDocId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ALL')
      .expect(200);

    expect(archiveRes.body.data.archived).toBe(true);

    const commentRes = await request(app)
      .post(`/v1/documents/${ltaDocId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ALL')
      .send({ text: 'Reviewing snow photo' })
      .expect(201);

    expect(commentRes.body.data.comments).toHaveLength(1);
    expect(commentRes.body.data.comments[0].text).toBe('Reviewing snow photo');
  });
});
