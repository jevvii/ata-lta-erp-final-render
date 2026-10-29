/**
 * documentTaskLocks.test.js
 *
 * Integration test suite for document locks on rejected/pending tasks and work requests.
 * Enforces:
 * - Rejected task locks all ordinary work (upload, confirm-upload, edit, relink, delete, archive, lifecycle, comments)
 *   with 409 TASK_REJECTED_LOCKED.
 * - Read access, history, and downloads on rejected task documents are preserved.
 * - Pending task remains usable within existing permissions.
 * - Pending/rejected WR parent documents are inaccessible via DMS (404 / filtered).
 * - Cross-WR and cross-entity linkage leakage is denied.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { randomUUID } = require('crypto');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const validDocument = {
  fileName: 'test-evidence.pdf',
  contentType: 'application/pdf',
  fileSize: 2048,
  originalName: 'Test Evidence.pdf',
};

describe('Document task and WR locks integration', () => {
  const entityId = 'ent-ata';
  const otherEntityId = 'ent-lta';

  let adminToken, adminUserId;
  let assignedUserToken, assignedUserId;
  let otherUserToken, otherUserId;

  let approvedWrId, pendingWrId, rejectedWrId, otherEntityWrId;
  let approvedTaskId, pendingTaskId, rejectedTaskId, otherWrTaskId, otherEntityTaskId;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Setup entities
    mockTables.entities.set(entityId, { id: entityId, code: 'ATA', name: 'ATA Philippines' });
    mockTables.entities.set(otherEntityId, { id: otherEntityId, code: 'LTA', name: 'LTA Philippines' });

    // Users
    adminUserId = randomUUID();
    adminToken = registerUser({
      id: adminUserId,
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    assignedUserId = randomUUID();
    assignedUserToken = registerUser({
      id: assignedUserId,
      email: 'assigned@ata-lta.ph',
      name: 'Assigned Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    otherUserId = randomUUID();
    otherUserToken = registerUser({
      id: otherUserId,
      email: 'other@ata-lta.ph',
      name: 'Other Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    // Departments for permissions
    const dept = [...mockTables.departments.values()].find((d) => d.name === 'Documentation') || { id: randomUUID() };
    mockTables.user_departments.set(randomUUID(), { user_id: assignedUserId, department_id: dept.id });
    mockTables.users.get(assignedUserId).user_departments = [{ departments: { name: 'Operations' } }];
    mockTables.user_departments.set(randomUUID(), { user_id: otherUserId, department_id: dept.id });
    mockTables.users.get(otherUserId).user_departments = [{ departments: { name: 'Operations' } }];

    // Work Requests
    approvedWrId = randomUUID();
    mockTables.work_requests.set(approvedWrId, {
      id: approvedWrId,
      entity_id: entityId,
      title: 'Approved WR',
      creation_approval_status: 'approved',
      assigned_to: assignedUserId,
      co_assignees: [assignedUserId, otherUserId],
      deleted_at: null,
    });

    pendingWrId = randomUUID();
    mockTables.work_requests.set(pendingWrId, {
      id: pendingWrId,
      entity_id: entityId,
      title: 'Pending WR',
      creation_approval_status: 'pending',
      assigned_to: assignedUserId,
      co_assignees: [assignedUserId],
      deleted_at: null,
    });

    rejectedWrId = randomUUID();
    mockTables.work_requests.set(rejectedWrId, {
      id: rejectedWrId,
      entity_id: entityId,
      title: 'Rejected WR',
      creation_approval_status: 'rejected',
      assigned_to: assignedUserId,
      deleted_at: null,
    });

    otherEntityWrId = randomUUID();
    mockTables.work_requests.set(otherEntityWrId, {
      id: otherEntityWrId,
      entity_id: otherEntityId,
      title: 'LTA Work Request',
      creation_approval_status: 'approved',
      assigned_to: adminUserId,
      deleted_at: null,
    });

    // Tasks under Approved WR
    approvedTaskId = randomUUID();
    mockTables.tasks.set(approvedTaskId, {
      id: approvedTaskId,
      work_request_id: approvedWrId,
      assignee_id: assignedUserId,
      approval_status: 'approved',
      title: 'Approved Task',
      deleted_at: null,
    });

    pendingTaskId = randomUUID();
    mockTables.tasks.set(pendingTaskId, {
      id: pendingTaskId,
      work_request_id: approvedWrId,
      assignee_id: assignedUserId,
      approval_status: 'pending',
      title: 'Pending Review Task',
      deleted_at: null,
    });

    rejectedTaskId = randomUUID();
    mockTables.tasks.set(rejectedTaskId, {
      id: rejectedTaskId,
      work_request_id: approvedWrId,
      assignee_id: assignedUserId,
      approval_status: 'rejected',
      title: 'Rejected Task',
      deleted_at: null,
    });

    // Task under separate WR / Entity
    otherWrTaskId = randomUUID();
    const otherWrId = randomUUID();
    mockTables.work_requests.set(otherWrId, {
      id: otherWrId,
      entity_id: entityId,
      title: 'Separate Project WR',
      creation_approval_status: 'approved',
      assigned_to: adminUserId,
      deleted_at: null,
    });
    mockTables.tasks.set(otherWrTaskId, {
      id: otherWrTaskId,
      work_request_id: otherWrId,
      assignee_id: adminUserId,
      approval_status: 'approved',
      deleted_at: null,
    });

    otherEntityTaskId = randomUUID();
    mockTables.tasks.set(otherEntityTaskId, {
      id: otherEntityTaskId,
      work_request_id: otherEntityWrId,
      assignee_id: adminUserId,
      approval_status: 'approved',
      deleted_at: null,
    });
  });

  describe('1. Rejected task locks all ordinary work (Negative Tests)', () => {
    let existingDocId;
    let commentId;

    beforeEach(() => {
      existingDocId = randomUUID();
      commentId = randomUUID();
      mockTables.documents.set(existingDocId, {
        id: existingDocId,
        entity_id: entityId,
        work_request_id: approvedWrId,
        linked_task_id: rejectedTaskId,
        file_name: 'existing.pdf',
        original_name: 'Existing.pdf',
        status: 'active',
        storage_path: 'entities/ATA/work-requests/test/existing.pdf',
        document_lifecycle: 'collected',
        archived: false,
        comments: [
          {
            id: commentId,
            userId: assignedUserId,
            userName: 'Assigned Staff',
            text: 'Historical comment before rejection',
            date: new Date().toISOString(),
          },
        ],
        deleted_at: null,
      });
    });

    it('rejects POST /v1/documents (attachment on rejected task) with 409 TASK_REJECTED_LOCKED', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validDocument, linkedTaskId: rejectedTaskId, workRequestId: approvedWrId });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(res.body.detail).toMatch(/Task is rejected and locked/i);
    });

    it('rejects POST /v1/documents/:id/confirm-upload on document linked to rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      const pendingDocId = randomUUID();
      mockTables.documents.set(pendingDocId, {
        id: pendingDocId,
        entity_id: entityId,
        work_request_id: approvedWrId,
        linked_task_id: rejectedTaskId,
        status: 'pending_upload',
        storage_path: 'path.pdf',
        deleted_at: null,
      });

      const res = await request(app)
        .post(`/v1/documents/${pendingDocId}/confirm-upload`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
    });

    it('rejects PUT /v1/documents/:id metadata edit on document linked to rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      const res = await request(app)
        .put(`/v1/documents/${existingDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Attempted edit after rejection' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
    });

    it('rejects relinking document away from rejected task or to another rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      // 1. Relinking away from rejected task to approved task is blocked
      const res1 = await request(app)
        .put(`/v1/documents/${existingDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: approvedTaskId });

      expect(res1.status).toBe(409);
      expect(res1.body.code).toBe('TASK_REJECTED_LOCKED');

      // 2. Relinking a document on approved task TO a rejected task is blocked
      const docOnApprovedId = randomUUID();
      mockTables.documents.set(docOnApprovedId, {
        id: docOnApprovedId,
        entity_id: entityId,
        work_request_id: approvedWrId,
        linked_task_id: approvedTaskId,
        status: 'active',
        deleted_at: null,
      });

      const res2 = await request(app)
        .put(`/v1/documents/${docOnApprovedId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: rejectedTaskId });

      expect(res2.status).toBe(409);
      expect(res2.body.code).toBe('TASK_REJECTED_LOCKED');
    });

    it('rejects DELETE /v1/documents/:id on document linked to rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      const res = await request(app)
        .delete(`/v1/documents/${existingDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(mockTables.documents.get(existingDocId).deleted_at).toBeNull();
    });

    it('rejects POST /v1/documents/:id/archive on document linked to rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      const res = await request(app)
        .post(`/v1/documents/${existingDocId}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(mockTables.documents.get(existingDocId).archived).toBe(false);
    });

    it('rejects POST /v1/documents/:id/unarchive on document linked to rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      mockTables.documents.get(existingDocId).archived = true;

      const res = await request(app)
        .post(`/v1/documents/${existingDocId}/unarchive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(mockTables.documents.get(existingDocId).archived).toBe(true);
    });

    it('rejects PUT /v1/documents/:id/lifecycle on document linked to rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      const res = await request(app)
        .put(`/v1/documents/${existingDocId}/lifecycle`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ lifecycle: 'scanned' });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(mockTables.documents.get(existingDocId).document_lifecycle).toBe('collected');
    });

    it('rejects comment mutations (add, edit, delete) on document linked to rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      // 1. Add comment
      const addRes = await request(app)
        .post(`/v1/documents/${existingDocId}/comments`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ text: 'Attempting to add comment to rejected task document' });

      expect(addRes.status).toBe(409);
      expect(addRes.body.code).toBe('TASK_REJECTED_LOCKED');

      // 2. Edit comment
      const editRes = await request(app)
        .put(`/v1/documents/${existingDocId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ text: 'Attempting to edit comment on rejected task document' });

      expect(editRes.status).toBe(409);
      expect(editRes.body.code).toBe('TASK_REJECTED_LOCKED');

      // 3. Delete comment
      const delRes = await request(app)
        .delete(`/v1/documents/${existingDocId}/comments/${commentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(delRes.status).toBe(409);
      expect(delRes.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(mockTables.documents.get(existingDocId).comments).toHaveLength(1);
    });
  });

  describe('2. Rejected task preserves read access and history', () => {
    let existingDocId;

    beforeEach(() => {
      existingDocId = randomUUID();
      mockTables.documents.set(existingDocId, {
        id: existingDocId,
        entity_id: entityId,
        work_request_id: approvedWrId,
        linked_task_id: rejectedTaskId,
        file_name: 'existing.pdf',
        original_name: 'Existing.pdf',
        status: 'active',
        storage_path: 'entities/ATA/work-requests/test/existing.pdf',
        document_lifecycle: 'collected',
        archived: false,
        comments: [{ id: randomUUID(), userId: assignedUserId, text: 'Visible history' }],
        deleted_at: null,
      });
    });

    it('allows GET /v1/documents/:id, shows history, and reports can_comment: false', async () => {
      const res = await request(app)
        .get(`/v1/documents/${existingDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(existingDocId);
      expect(res.body.data.comments).toHaveLength(1);
      expect(res.body.data.can_comment).toBe(false);
    });

    it('allows GET /v1/documents/:id/download-url for active documents on rejected tasks', async () => {
      const res = await request(app)
        .get(`/v1/documents/${existingDocId}/download-url`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
      expect(res.body.data.url).toBeDefined();
    });

    it('lists documents by linkedTaskId for rejected tasks', async () => {
      const res = await request(app)
        .get(`/v1/documents?linkedTaskId=${rejectedTaskId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(existingDocId);
    });
  });

  describe('3. Pending task remains usable within existing permissions (Positive Tests)', () => {
    it('allows assigned user to create document, confirm upload, edit, comment, and delete on pending task', async () => {
      // 1. Create document on pending task
      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${assignedUserToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocument,
          linkedTaskId: pendingTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(201);
      const docId = createRes.body.data.document.id;
      expect(createRes.body.data.document.linked_task_id).toBe(pendingTaskId);

      // 2. Confirm upload on pending task document
      const confirmRes = await request(app)
        .post(`/v1/documents/${docId}/confirm-upload`)
        .set('Authorization', `Bearer ${assignedUserToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.status).toBe('active');

      // 3. Edit document metadata on pending task document (using Admin for dms:edit)
      const updateRes = await request(app)
        .put(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ description: 'Updated while task is pending' });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.description).toBe('Updated while task is pending');

      // 4. View document reports can_comment: true for assigned user
      const getRes = await request(app)
        .get(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${assignedUserToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.can_comment).toBe(true);

      // 5. Add comment on pending task document
      const commentRes = await request(app)
        .post(`/v1/documents/${docId}/comments`)
        .set('Authorization', `Bearer ${assignedUserToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ text: 'Comment on pending task document' });

      expect(commentRes.status).toBe(201);
      expect(commentRes.body.data.comments).toHaveLength(1);

      // 6. Delete document on pending task (using Admin for dms:delete)
      const deleteRes = await request(app)
        .delete(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(deleteRes.status).toBe(204);
      expect(mockTables.documents.get(docId).deleted_at).toBeTruthy();
    });
  });

  describe('4. Cross-WR, Cross-Entity, and WR Admission Boundaries', () => {
    it('rejects document creation when linked task does not belong to specified work request (400)', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocument,
          linkedTaskId: approvedTaskId,
          workRequestId: otherWrTaskId, // mismatch
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/does not belong to work request/i);
    });

    it('rejects document creation when linked task belongs to a different entity (400)', async () => {
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocument,
          linkedTaskId: otherEntityTaskId,
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/does not belong to (work request|active entity)/i);
    });

    it('rejects relinking document to a task in a different entity (400)', async () => {
      const docId = randomUUID();
      mockTables.documents.set(docId, {
        id: docId,
        entity_id: entityId,
        work_request_id: approvedWrId,
        linked_task_id: approvedTaskId,
        status: 'active',
        deleted_at: null,
      });

      const res = await request(app)
        .put(`/v1/documents/${docId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: otherEntityTaskId });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/does not belong to (work request|active entity)/i);
    });

    it('denies DMS access to documents whose parent work request is pending or rejected (404 / filtered)', async () => {
      const pendingWrDocId = randomUUID();
      mockTables.documents.set(pendingWrDocId, {
        id: pendingWrDocId,
        entity_id: entityId,
        work_request_id: pendingWrId,
        file_name: 'pending-wr-doc.pdf',
        original_name: 'Pending WR Doc.pdf',
        status: 'active',
        storage_path: 'entities/ATA/work-requests/pending/doc.pdf',
        archived: false,
        deleted_at: null,
      });

      const rejectedWrDocId = randomUUID();
      mockTables.documents.set(rejectedWrDocId, {
        id: rejectedWrDocId,
        entity_id: entityId,
        work_request_id: rejectedWrId,
        file_name: 'rejected-wr-doc.pdf',
        original_name: 'Rejected WR Doc.pdf',
        status: 'active',
        storage_path: 'entities/ATA/work-requests/rejected/doc.pdf',
        archived: false,
        deleted_at: null,
      });

      // 1. GET by ID returns 404 for documents belonging to pending WR
      const res1 = await request(app)
        .get(`/v1/documents/${pendingWrDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res1.status).toBe(404);

      // 2. GET by ID returns 404 for documents belonging to rejected WR
      const res2 = await request(app)
        .get(`/v1/documents/${rejectedWrDocId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res2.status).toBe(404);

      // 3. GET /v1/documents list excludes both documents
      const listRes = await request(app)
        .get('/v1/documents')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(listRes.status).toBe(200);
      const returnedIds = listRes.body.data.map((d) => d.id);
      expect(returnedIds).not.toContain(pendingWrDocId);
      expect(returnedIds).not.toContain(rejectedWrDocId);
    });

    it('rejects unassigned non-admin user with 403 FORBIDDEN_TASK_ATTACHMENT', async () => {
      // otherUser is not assigned to approvedTaskId
      const res = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${otherUserToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocument,
          linkedTaskId: approvedTaskId,
        });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN_TASK_ATTACHMENT');
    });
  });
});
