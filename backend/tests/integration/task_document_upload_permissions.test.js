/**
 * task_document_upload_permissions.test.js
 *
 * Integration test suite verifying that all users can upload documents to tasks
 * assigned to them (as primary assignee or co-assignee via task_assignees),
 * while unassigned non-Admin users are strictly rejected with 403 FORBIDDEN_TASK_ATTACHMENT.
 * Also verifies Admin override and 409 Conflict lock on rejected tasks.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { randomUUID } = require('crypto');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

describe('Task Document Upload Permissions Integration', () => {
  const entityId = 'ent-ata';

  let adminUserToken, adminUserId;
  let accountingStaffToken, accountingStaffId;
  let coAssigneeStaffToken, coAssigneeStaffId;
  let unassignedStaffToken, unassignedStaffId;
  let otherUserId;

  let approvedWrId;
  let nonBillingTaskId;
  let billingTaskId;
  let disbursementTaskId;
  let unlinkedTypeTaskId;
  let coAssignedTaskId;
  let rejectedTaskId;

  const validDocumentPayload = {
    fileName: 'supporting-doc.pdf',
    contentType: 'application/pdf',
    fileSize: 4096,
    originalName: 'Supporting Document.pdf',
    category: 'FINANCIAL',
  };

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Ensure entity exists
    mockTables.entities.set(entityId, { id: entityId, code: 'ATA', name: 'ATA Philippines' });

    // 1. Admin user
    adminUserId = randomUUID();
    adminUserToken = registerUser({
      id: adminUserId,
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA'],
    });

    // 2. Accounting staff (Primary assignee)
    accountingStaffId = randomUUID();
    accountingStaffToken = registerUser({
      id: accountingStaffId,
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA'],
      departments: ['Accounting'],
    });
    const acctDept = [...mockTables.departments.values()].find((d) => d.name === 'Accounting') || { id: randomUUID() };
    mockTables.user_departments.set(randomUUID(), { user_id: accountingStaffId, department_id: acctDept.id });
    mockTables.users.get(accountingStaffId).user_departments = [{ departments: { name: 'Accounting' } }];

    // 3. Co-assignee staff (assigned via task_assignees join table)
    coAssigneeStaffId = randomUUID();
    coAssigneeStaffToken = registerUser({
      id: coAssigneeStaffId,
      email: 'coassignee@ata-lta.ph',
      name: 'Co-Assignee Staff',
      role: 'Documentation',
      entities: ['ATA'],
      departments: ['Documentation'],
    });
    const docDept = [...mockTables.departments.values()].find((d) => d.name === 'Documentation') || { id: randomUUID() };
    mockTables.user_departments.set(randomUUID(), { user_id: coAssigneeStaffId, department_id: docDept.id });
    mockTables.users.get(coAssigneeStaffId).user_departments = [{ departments: { name: 'Documentation' } }];

    // 4. Unassigned staff
    unassignedStaffId = randomUUID();
    unassignedStaffToken = registerUser({
      id: unassignedStaffId,
      email: 'unassigned@ata-lta.ph',
      name: 'Unassigned Staff',
      role: 'HR',
      entities: ['ATA'],
      departments: ['HR'],
    });
    const hrDept = [...mockTables.departments.values()].find((d) => d.name === 'HR') || { id: randomUUID() };
    mockTables.user_departments.set(randomUUID(), { user_id: unassignedStaffId, department_id: hrDept.id });
    mockTables.users.get(unassignedStaffId).user_departments = [{ departments: { name: 'HR' } }];

    // Lead user for tasks assigned to someone else
    otherUserId = randomUUID();

    // Work request
    approvedWrId = randomUUID();
    mockTables.work_requests.set(approvedWrId, {
      id: approvedWrId,
      entity_id: entityId,
      title: 'Corporate Client Project',
      creation_approval_status: 'approved',
      assigned_to: accountingStaffId,
      co_assignees: [accountingStaffId, coAssigneeStaffId, unassignedStaffId],
      phase: 'processing',
      deleted_at: null,
    });

    // Task 1: Non-billing task assigned to Accounting staff as primary assignee (required_link_type = 'documents')
    nonBillingTaskId = randomUUID();
    mockTables.tasks.set(nonBillingTaskId, {
      id: nonBillingTaskId,
      work_request_id: approvedWrId,
      assignee_id: accountingStaffId,
      approval_status: 'approved',
      status: 'in_progress',
      phase: 'processing',
      required_link_type: 'documents',
      title: 'Document Collection Task',
      deleted_at: null,
    });

    // Task 2: Billing task assigned to Accounting staff (required_link_type = 'billing')
    billingTaskId = randomUUID();
    mockTables.tasks.set(billingTaskId, {
      id: billingTaskId,
      work_request_id: approvedWrId,
      assignee_id: accountingStaffId,
      approval_status: 'approved',
      status: 'in_progress',
      phase: 'processing',
      required_link_type: 'billing',
      title: 'Billing Preparation Task',
      deleted_at: null,
    });

    // Task 3: Disbursement task assigned to Accounting staff (required_link_type = 'disbursement')
    disbursementTaskId = randomUUID();
    mockTables.tasks.set(disbursementTaskId, {
      id: disbursementTaskId,
      work_request_id: approvedWrId,
      assignee_id: accountingStaffId,
      approval_status: 'approved',
      status: 'in_progress',
      phase: 'processing',
      required_link_type: 'disbursement',
      title: 'Disbursement Audit Task',
      deleted_at: null,
    });

    // Task 4: Task with null required_link_type
    unlinkedTypeTaskId = randomUUID();
    mockTables.tasks.set(unlinkedTypeTaskId, {
      id: unlinkedTypeTaskId,
      work_request_id: approvedWrId,
      assignee_id: accountingStaffId,
      approval_status: 'approved',
      status: 'in_progress',
      phase: 'processing',
      required_link_type: null,
      title: 'General Review Task',
      deleted_at: null,
    });

    // Task 5: Primary assignee is otherUserId, but coAssigneeStaffId is assigned via task_assignees
    coAssignedTaskId = randomUUID();
    mockTables.tasks.set(coAssignedTaskId, {
      id: coAssignedTaskId,
      work_request_id: approvedWrId,
      assignee_id: otherUserId,
      approval_status: 'approved',
      status: 'in_progress',
      phase: 'processing',
      title: 'Co-Assigned Task',
      deleted_at: null,
    });
    const taId = randomUUID();
    mockTables.task_assignees.set(taId, {
      id: taId,
      task_id: coAssignedTaskId,
      user_id: coAssigneeStaffId,
    });

    // Task 6: Rejected task assigned to Accounting staff
    rejectedTaskId = randomUUID();
    mockTables.tasks.set(rejectedTaskId, {
      id: rejectedTaskId,
      work_request_id: approvedWrId,
      assignee_id: accountingStaffId,
      approval_status: 'rejected',
      status: 'in_progress',
      phase: 'processing',
      title: 'Rejected Task',
      deleted_at: null,
    });
  });

  describe('Requirement 1: Accounting staff assigned as primary assignee', () => {
    it('allows Accounting staff assigned to non-billing task to create document and confirm upload', async () => {
      // 1. Create document metadata
      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${accountingStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocumentPayload,
          linkedTaskId: nonBillingTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.document).toBeDefined();
      expect(createRes.body.data.document.linked_task_id).toBe(nonBillingTaskId);
      expect(createRes.body.data.document.status).toBe('pending_upload');
      expect(createRes.body.data.uploadUrl).toBeDefined();

      const docId = createRes.body.data.document.id;

      // 2. Confirm storage upload completed
      const confirmRes = await request(app)
        .post(`/v1/documents/${docId}/confirm-upload`)
        .set('Authorization', `Bearer ${accountingStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.id).toBe(docId);
      expect(confirmRes.body.data.status).toBe('active');
    });

    it('allows Accounting staff to upload documents to task with ANY required_link_type (billing, disbursement, null)', async () => {
      for (const targetTaskId of [billingTaskId, disbursementTaskId, unlinkedTypeTaskId]) {
        const createRes = await request(app)
          .post('/v1/documents')
          .set('Authorization', `Bearer ${accountingStaffToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            ...validDocumentPayload,
            fileName: `doc-for-${targetTaskId}.pdf`,
            linkedTaskId: targetTaskId,
            workRequestId: approvedWrId,
          });

        expect(createRes.status).toBe(201);
        const docId = createRes.body.data.document.id;

        const confirmRes = await request(app)
          .post(`/v1/documents/${docId}/confirm-upload`)
          .set('Authorization', `Bearer ${accountingStaffToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({});

        expect(confirmRes.status).toBe(200);
        expect(confirmRes.body.data.status).toBe('active');
      }
    });
  });

  describe('Requirement 2: Staff assigned as co-assignee via task_assignees', () => {
    it('allows staff assigned as co-assignee via task_assignees to create document and confirm upload', async () => {
      // Co-assignee is NOT primary assignee (task.assignee_id is otherUserId)
      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${coAssigneeStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocumentPayload,
          linkedTaskId: coAssignedTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.document.linked_task_id).toBe(coAssignedTaskId);
      expect(createRes.body.data.document.status).toBe('pending_upload');

      const docId = createRes.body.data.document.id;

      const confirmRes = await request(app)
        .post(`/v1/documents/${docId}/confirm-upload`)
        .set('Authorization', `Bearer ${coAssigneeStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.id).toBe(docId);
      expect(confirmRes.body.data.status).toBe('active');
    });

    it('verifies all departments (Operations, Documentation, Management, HR, Accounting) can upload when assigned', async () => {
      const depts = [
        { role: 'Operations', dept: 'Operations' },
        { role: 'Documentation', dept: 'Documentation' },
        { role: 'Manager', dept: 'Management' },
        { role: 'HR', dept: 'HR' },
        { role: 'Accounting', dept: 'Accounting' },
      ];

      for (const { role, dept } of depts) {
        const uId = randomUUID();
        const uToken = registerUser({
          id: uId,
          email: `${dept.toLowerCase()}@ata-lta.ph`,
          name: `${dept} Staff`,
          role,
          entities: ['ATA'],
          departments: [dept],
        });
        const deptObj = [...mockTables.departments.values()].find((d) => d.name === dept) || { id: randomUUID() };
        mockTables.user_departments.set(randomUUID(), { user_id: uId, department_id: deptObj.id });
        mockTables.users.get(uId).user_departments = [{ departments: { name: dept } }];

        // Create task assigned to this user
        const tId = randomUUID();
        mockTables.tasks.set(tId, {
          id: tId,
          work_request_id: approvedWrId,
          assignee_id: uId,
          approval_status: 'approved',
          status: 'in_progress',
          phase: 'processing',
          title: `${dept} Task`,
          deleted_at: null,
        });

        const res = await request(app)
          .post('/v1/documents')
          .set('Authorization', `Bearer ${uToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            ...validDocumentPayload,
            fileName: `${dept.toLowerCase()}-doc.pdf`,
            linkedTaskId: tId,
            workRequestId: approvedWrId,
          });

        expect(res.status).toBe(201);

        const confirm = await request(app)
          .post(`/v1/documents/${res.body.data.document.id}/confirm-upload`)
          .set('Authorization', `Bearer ${uToken}`)
          .set('X-Active-Entity', 'ATA')
          .send({});

        expect(confirm.status).toBe(200);
        expect(confirm.body.data.status).toBe('active');
      }
    });
  });

  describe('Requirement 3: Unassigned staff user strictly rejected', () => {
    it('rejects unassigned staff attempting to attach document to the task with 403 FORBIDDEN_TASK_ATTACHMENT', async () => {
      // unassignedStaffId is neither primary assignee nor in task_assignees for nonBillingTaskId
      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${unassignedStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocumentPayload,
          linkedTaskId: nonBillingTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(403);
      expect(createRes.body.code).toBe('FORBIDDEN_TASK_ATTACHMENT');
      expect(createRes.body.detail).toBe('You are not assigned to this task and cannot attach documents to it.');
    });

    it('rejects unassigned staff with no relation to work request with 403 FORBIDDEN_TASK_ATTACHMENT', async () => {
      const outsiderId = randomUUID();
      const outsiderToken = registerUser({
        id: outsiderId,
        email: 'outsider@ata-lta.ph',
        name: 'Outsider Staff',
        role: 'Documentation',
        entities: ['ATA'],
        departments: ['Documentation'],
      });
      const docDept = [...mockTables.departments.values()].find((d) => d.name === 'Documentation') || { id: randomUUID() };
      mockTables.user_departments.set(randomUUID(), { user_id: outsiderId, department_id: docDept.id });
      mockTables.users.get(outsiderId).user_departments = [{ departments: { name: 'Documentation' } }];

      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${outsiderToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocumentPayload,
          linkedTaskId: nonBillingTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(403);
      expect(createRes.body.code).toBe('FORBIDDEN_TASK_ATTACHMENT');
      expect(createRes.body.detail).toBe('You are not assigned to this task and cannot attach documents to it.');
    });

    it('rejects unassigned staff attempting to confirm-upload on a task with 403 FORBIDDEN_TASK_ATTACHMENT', async () => {
      // Pre-seed a document in pending_upload linked to nonBillingTaskId
      const pendingDocId = randomUUID();
      mockTables.documents.set(pendingDocId, {
        id: pendingDocId,
        entity_id: entityId,
        work_request_id: approvedWrId,
        linked_task_id: nonBillingTaskId,
        status: 'pending_upload',
        storage_path: 'entities/ATA/work-requests/test/pending.pdf',
        deleted_at: null,
      });

      const confirmRes = await request(app)
        .post(`/v1/documents/${pendingDocId}/confirm-upload`)
        .set('Authorization', `Bearer ${unassignedStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(confirmRes.status).toBe(403);
      expect(confirmRes.body.code).toBe('FORBIDDEN_TASK_ATTACHMENT');
      expect(confirmRes.body.detail).toBe('You are not assigned to this task and cannot attach documents to it.');
    });
  });

  describe('Requirement 4: Admin user can attach documents without being assigned', () => {
    it('allows Admin to attach document and confirm upload even if not assigned', async () => {
      // Admin is not assignee_id and not in task_assignees
      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminUserToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocumentPayload,
          linkedTaskId: nonBillingTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.data.document.linked_task_id).toBe(nonBillingTaskId);

      const docId = createRes.body.data.document.id;

      const confirmRes = await request(app)
        .post(`/v1/documents/${docId}/confirm-upload`)
        .set('Authorization', `Bearer ${adminUserToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(confirmRes.status).toBe(200);
      expect(confirmRes.body.data.status).toBe('active');
    });
  });

  describe('Requirement 5: Rejected task remains locked against attachments', () => {
    it('rejects document creation on a rejected task with 409 TASK_REJECTED_LOCKED even for assigned user', async () => {
      // accountingStaffId is primary assignee of rejectedTaskId
      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${accountingStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocumentPayload,
          linkedTaskId: rejectedTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(409);
      expect(createRes.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(createRes.body.detail).toMatch(/Task is rejected and locked against document attachments/i);
    });

    it('rejects document creation on a rejected task with 409 TASK_REJECTED_LOCKED for Admin', async () => {
      const createRes = await request(app)
        .post('/v1/documents')
        .set('Authorization', `Bearer ${adminUserToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDocumentPayload,
          linkedTaskId: rejectedTaskId,
          workRequestId: approvedWrId,
        });

      expect(createRes.status).toBe(409);
      expect(createRes.body.code).toBe('TASK_REJECTED_LOCKED');
      expect(createRes.body.detail).toMatch(/Task is rejected and locked against document attachments/i);
    });

    it('rejects confirm-upload on a document linked to a rejected task with 409 TASK_REJECTED_LOCKED', async () => {
      const pendingDocId = randomUUID();
      mockTables.documents.set(pendingDocId, {
        id: pendingDocId,
        entity_id: entityId,
        work_request_id: approvedWrId,
        linked_task_id: rejectedTaskId,
        status: 'pending_upload',
        storage_path: 'entities/ATA/work-requests/test/rejected.pdf',
        deleted_at: null,
      });

      const confirmRes = await request(app)
        .post(`/v1/documents/${pendingDocId}/confirm-upload`)
        .set('Authorization', `Bearer ${accountingStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({});

      expect(confirmRes.status).toBe(409);
      expect(confirmRes.body.code).toBe('TASK_REJECTED_LOCKED');
    });
  });
});
