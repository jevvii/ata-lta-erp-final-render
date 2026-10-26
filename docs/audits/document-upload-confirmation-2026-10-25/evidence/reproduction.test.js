/**
 * Empirical Reproduction Suite for Document Upload Confirmation 404 Defect
 *
 * Demonstrates:
 * 1. POST /v1/documents/:id/confirm-upload with X-Active-Entity: ALL fails with 404 "Document <id> not found" for LTA records
 * 2. The document record remains in status 'pending_upload' in the database
 * 3. GET /v1/documents/:id/download-url fails with 409 Conflict because status is 'pending_upload'
 * 4. GET /v1/documents with X-Active-Entity: ALL still returns the document (demonstrating why it "still shows")
 * 5. Other document mutation routes (archive, comments) also fail with 404 for LTA documents when X-Active-Entity: ALL
 */

jest.mock('../../../../backend/src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../../backend/tests/fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../../../../backend/tests/helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../../../../backend/tests/fixtures/supabaseMock');

describe('Empirical Audit: Document Upload Confirmation & Entity Resolution', () => {
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

    // Recreate staging scenario: user has entities ['ATA', 'LTA'], with ATA as first element
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

    // LTA work request and task
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

  it('F01: fails confirm-upload with 404 "Document not found" when uploading LTA task document in ALL view', async () => {
    // Step 1: POST /v1/documents creates metadata (entity resolved via workRequestId to LTA)
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

    // Step 2: Binary transfer occurs (simulated via storage)
    // Step 3: POST /v1/documents/:id/confirm-upload with X-Active-Entity: ALL
    // Defect: resolveEntity() does not check documents table for :id, falls back to user's first entity ('ATA'),
    // resulting in getDocumentById querying entity_id = 'ent-ata' and failing with 404.
    const confirmRes = await request(app)
      .post(`/v1/documents/${docId}/confirm-upload`)
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ALL');

    expect(confirmRes.status).toBe(404);
    expect(confirmRes.body.title).toBe('Not Found');
    expect(confirmRes.body.detail).toBe(`Document ${docId} not found`);

    // Verify DB state: document still persists in database with status 'pending_upload'
    const docInDb = mockTables.documents.get(docId);
    expect(docInDb).toBeDefined();
    expect(docInDb.status).toBe('pending_upload');
    expect(docInDb.entity_id).toBe('ent-lta');
  });

  it('F02: document still shows in list queries despite 404 confirm failure', async () => {
    // Seed existing LTA pending document (mimicking staging record)
    mockTables.documents.set(ltaDocId, {
      id: ltaDocId,
      entity_id: 'ent-lta',
      status: 'pending_upload',
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

    // GET /v1/documents with X-Active-Entity: ALL succeeds (allowAll: true on GET)
    const listRes = await request(app)
      .get('/v1/documents')
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ALL')
      .expect(200);

    const found = listRes.body.data.find((d) => d.id === ltaDocId);
    expect(found).toBeDefined();
    expect(found.original_name).toBe('a_house_in_the_snow.png');
    expect(found.status).toBe('pending_upload');
  });

  it('F03: download-url preview fails with 409 Conflict because status remains stuck in pending_upload', async () => {
    mockTables.documents.set(ltaDocId, {
      id: ltaDocId,
      entity_id: 'ent-lta',
      status: 'pending_upload',
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

    // Preview attempts fail with 409 Conflict because document is not 'active'
    const previewRes = await request(app)
      .get(`/v1/documents/${ltaDocId}/download-url`)
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ALL')
      .expect(409);

    expect(previewRes.body.detail).toBe('Document upload has not been confirmed yet');
  });

  it('F04: subsequent document mutations (archive, comments) also fail with 404 for LTA records in ALL view', async () => {
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

    // Attempting to archive in ALL view with an Admin user holding dms:edit
    const archiveRes = await request(app)
      .post(`/v1/documents/${ltaDocId}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ALL');

    expect(archiveRes.status).toBe(404);
    expect(archiveRes.body.detail).toBe(`Document ${ltaDocId} not found`);

    // Attempting to add comment in ALL view
    const commentRes = await request(app)
      .post(`/v1/documents/${ltaDocId}/comments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ALL')
      .send({ text: 'Reviewing snow photo' });

    expect(commentRes.status).toBe(404);
    expect(commentRes.body.detail).toBe(`Document ${ltaDocId} not found`);
  });
});
