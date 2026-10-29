/**
 * Tests for Parcel 1: Work Request Creation Gate
 * Covers CONTRACT.md Policy R1, R2, and HTTP endpoints.
 */

jest.mock('../../../services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../../tests/fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../../../../tests/helpers/testServer');
const { registerUser, seedDefaults, resetMock } = require('../../../../tests/fixtures/supabaseMock');
const { invalidateAnalytics } = require('../../reports/service');

describe('Parcel 1: Work Request Creation Admission Gate', () => {
  let adminToken;
  let managerToken;
  let manager2Token;
  let manager2Id;
  let employeeToken;
  let employeeId;
  let client;
  let ltaClient;

  beforeEach(async () => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      email: 'admin-gate@ata-lta.ph',
      name: 'Admin Gate',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    managerToken = registerUser({
      email: 'manager-gate@ata-lta.ph',
      name: 'Manager Gate',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
    });

    manager2Id = '77777777-7777-4777-a777-777777777777';
    manager2Token = registerUser({
      id: manager2Id,
      email: 'manager2-gate@ata-lta.ph',
      name: 'Manager Gate 2',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
    });

    employeeId = '55555555-5555-4555-a555-555555555555';
    employeeToken = registerUser({
      id: employeeId,
      email: 'staff-gate@ata-lta.ph',
      name: 'Staff Gate',
      role: 'Operations', // Employee role (not Admin or Manager)
      entities: ['ATA', 'LTA'],
    });

    // Create client via admin
    const clientRes = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Gate Client Corp',
        tin: '111-222-333-000',
        entity: 'ATA',
      })
      .expect(201);
    client = clientRes.body.data;

    // Create LTA client
    const ltaClientRes = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'LTA')
      .send({
        name: 'LTA Gate Client Corp',
        tin: '999-888-777-000',
        entity: 'LTA',
      })
      .expect(201);
    ltaClient = ltaClientRes.body.data;
  });

  describe('Policy R1: Creation Gate & Role Enforcement', () => {
    it('Admin creates an approved work request with review attribution and no fake phase op req', async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Admin Created WR',
          clientId: client.id,
          entity: 'ATA',
          dueDate: '2026-12-31',
        })
        .expect(201);

      const wr = res.body.data;
      expect(wr.title).toBe('Admin Created WR');
      expect(wr.creationApprovalStatus).toBe('approved');
      expect(wr.reviewedBy).toBeTruthy();
      expect(wr.reviewedAt).toBeTruthy();
      expect(wr.rejectionReason).toBeNull();
      expect(wr.phase).toBe('pre_processing'); // Preserved initial phase, not auto-advanced
    });

    it('Manager creates a pending work request without auto-advancing phase', async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Manager Created Pending WR',
          clientId: client.id,
          entity: 'ATA',
          dueDate: '2026-12-31',
        })
        .expect(201);

      const wr = res.body.data;
      expect(wr.title).toBe('Manager Created Pending WR');
      expect(wr.creationApprovalStatus).toBe('pending');
      expect(wr.reviewedBy).toBeNull();
      expect(wr.reviewedAt).toBeNull();
      expect(wr.rejectionReason).toBeNull();
      expect(wr.canReviewCreation).toBe(false);
      expect(wr.canResubmit).toBe(false);
      expect(wr.phase).toBe('pre_processing');
    });

    it('denies work request creation to regular employees', async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Employee WR',
          clientId: client.id,
          entity: 'ATA',
          dueDate: '2026-12-31',
        })
        .expect(403);

      expect(res.body.title).toBe('Forbidden');
    });

    it('strips client-forged approval fields on creation', async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Manager Attempting Spoof',
          clientId: client.id,
          entity: 'ATA',
          dueDate: '2026-12-31',
          creationApprovalStatus: 'approved',
          reviewedBy: 'some-fake-id',
          reviewedAt: '2026-01-01T00:00:00Z',
        })
        .expect(201);

      const wr = res.body.data;
      // Must ignore the forged 'approved' status and force 'pending' for Manager
      expect(wr.creationApprovalStatus).toBe('pending');
      expect(wr.reviewedBy).toBeNull();
      expect(wr.reviewedAt).toBeNull();
    });
  });

  describe('Policy R2: Visibility Gating', () => {
    let pendingWrId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Hidden Pending WR',
          clientId: client.id,
          entity: 'ATA',
          dueDate: '2026-12-31',
        })
        .expect(201);
      pendingWrId = res.body.data.id;
    });

    it('excludes pending work requests from ordinary listWorkRequests', async () => {
      const listRes = await request(app)
        .get('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const found = listRes.body.data.find((w) => w.id === pendingWrId);
      expect(found).toBeUndefined();
    });

    it('excludes pending work requests from counts', async () => {
      const countsRes = await request(app)
        .get('/v1/work-requests/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      // Pending WR should not increment active/all count
      expect(countsRes.body.data.active).toBe(0);
      expect(countsRes.body.data.all).toBe(0);
    });

    it('returns 404 for pending work requests on normal getWorkRequestById for regular employees', async () => {
      await request(app)
        .get(`/v1/work-requests/${pendingWrId}`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);
    });

    it('returns 404 for pending work requests on normal getWorkRequestById for non-review context', async () => {
      await request(app)
        .get(`/v1/work-requests/${pendingWrId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);
    });
  });

  describe('Policy R2 & HTTP Contract: Creation Approvals Endpoints', () => {
    let pendingWr;

    beforeEach(async () => {
      const res = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Manager WR for Review',
          clientId: client.id,
          entity: 'ATA',
          dueDate: '2026-12-31',
        })
        .expect(201);
      pendingWr = res.body.data;
    });

    it('GET /creation-approvals: Admin lists all pending submissions with canReviewCreation: true', async () => {
      const res = await request(app)
        .get('/v1/operations/work-requests/creation-approvals?status=pending&scope=all')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      const found = res.body.data.find((w) => w.id === pendingWr.id);
      expect(found).toBeDefined();
      expect(found.creationApprovalStatus).toBe('pending');
      expect(found.canReviewCreation).toBe(true);
      expect(found.canResubmit).toBe(false);
      expect(Array.isArray(found.tasks)).toBe(true);
    });

    it('GET /creation-approvals: Manager sees own submissions with canResubmit: false while pending', async () => {
      const res = await request(app)
        .get('/v1/operations/work-requests/creation-approvals?status=pending&scope=mine')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const found = res.body.data.find((w) => w.id === pendingWr.id);
      expect(found).toBeDefined();
      expect(found.canReviewCreation).toBe(false);
      expect(found.canResubmit).toBe(false);
    });

    it('GET /creation-approvals: rejects ordinary employees with 403', async () => {
      await request(app)
        .get('/v1/operations/work-requests/creation-approvals')
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);
    });

    it('POST /creation-approval: Admin approves pending WR', async () => {
      const res = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      expect(res.body.data.creationApprovalStatus).toBe('approved');
      expect(res.body.data.reviewedBy).toBeTruthy();
      expect(res.body.data.reviewedAt).toBeTruthy();
      expect(res.body.data.version).toBe(pendingWr.version + 1);

      // Now it appears in ordinary list
      const listRes = await request(app)
        .get('/v1/work-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      const found = listRes.body.data.find((w) => w.id === pendingWr.id);
      expect(found).toBeDefined();
    });

    it('POST /creation-approval: Admin rejects pending WR (requires reason)', async () => {
      // Rejection without reason fails
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          expectedVersion: pendingWr.version,
        })
        .expect(400);

      // Rejection with reason succeeds
      const res = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Scope is too vague',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      expect(res.body.data.creationApprovalStatus).toBe('rejected');
      expect(res.body.data.rejectionReason).toBe('Scope is too vague');
      expect(res.body.data.version).toBe(pendingWr.version + 1);
    });

    it('POST /creation-approval: Manager cannot approve/reject WR (403)', async () => {
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingWr.version,
        })
        .expect(403);
    });

    it('POST /creation-approval: returns 409 on version conflict', async () => {
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: 999, // Stale version
        })
        .expect(409);
    });

    it('POST /resubmit-creation: Creator corrects and resubmits rejected WR', async () => {
      // First reject it
      const rejectRes = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Needs clearer deliverables',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      const rejectedWr = rejectRes.body.data;
      expect(rejectedWr.creationApprovalStatus).toBe('rejected');

      // Resubmit by non-creator fails (403)
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${employeeToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedWr.version,
        })
        .expect(403);

      // Resubmit by creator with updated description succeeds
      const resubmitRes = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedWr.version,
          data: {
            description: 'Updated with detailed deliverable list',
          },
        })
        .expect(200);

      const resubmitted = resubmitRes.body.data;
      expect(resubmitted.creationApprovalStatus).toBe('pending');
      expect(resubmitted.description).toBe('Updated with detailed deliverable list');
      expect(resubmitted.rejectionReason).toBeNull();
      expect(resubmitted.version).toBe(rejectedWr.version + 1);
    });

    it('denies ordinary PUT /v1/work-requests/:id updates on unadmitted (pending or rejected) work requests', async () => {
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Direct Update Lock Test',
          description: 'Cannot update via ordinary PUT before admission',
          clientId: client.id,
          dueDate: '2026-12-31',
          entity: 'ATA',
        })
        .expect(201);

      const pendingWr = createRes.body.data;
      expect(pendingWr.creationApprovalStatus).toBe('pending');

      // Ordinary PUT update on pending WR returns 404
      await request(app)
        .put(`/v1/work-requests/${pendingWr.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Direct Update Attempt',
        })
        .expect(404);

      // Even Admin calling ordinary PUT update on unadmitted WR returns 404
      await request(app)
        .put(`/v1/work-requests/${pendingWr.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Admin Direct Update Attempt',
        })
        .expect(404);

      // Reject the WR
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Needs correction via resubmit',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      // Ordinary PUT update on rejected WR also returns 404
      await request(app)
        .put(`/v1/work-requests/${pendingWr.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Direct Update After Rejection',
        })
        .expect(404);
    });

    it('canonical creator check: nominated requested_by cannot view or resubmit pending/rejected WR created by another user', async () => {
      // Manager 1 creates a WR, nominating Manager 2 as requestedBy
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Nominated Requester Isolation Test',
          description: 'Testing canonical creator vs nominated requester',
          clientId: client.id,
          dueDate: '2026-12-31',
          entity: 'ATA',
          requestedBy: manager2Id,
        })
        .expect(201);

      const pendingWr = createRes.body.data;
      expect(pendingWr.createdBy).toBeDefined();
      expect(pendingWr.requestedBy).toBe(manager2Id);

      // Manager 2 checks their creation approvals (scope=mine) -> should NOT see it
      const otherListRes = await request(app)
        .get('/v1/operations/work-requests/creation-approvals?scope=mine')
        .set('Authorization', `Bearer ${manager2Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const found = otherListRes.body.data.find((w) => w.id === pendingWr.id);
      expect(found).toBeUndefined();

      // Reject the WR
      const rejectRes = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Correction required by actual creator',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      const rejectedWr = rejectRes.body.data;

      // Manager 2 attempts to resubmit -> 403 Forbidden
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${manager2Token}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedWr.version,
          data: { description: 'Malicious hijack attempt by nominated requester' },
        })
        .expect(403);

      // Actual creator resubmitting -> 200 OK
      const resubmitRes = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedWr.version,
          data: { description: 'Legitimate correction by canonical creator' },
        })
        .expect(200);

      expect(resubmitRes.body.data.creationApprovalStatus).toBe('pending');
      expect(resubmitRes.body.data.description).toBe('Legitimate correction by canonical creator');
    });

    it('validates client entity and team roles during resubmission', async () => {
      // Manager creates a pending WR
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Resubmit Validation Target',
          clientId: client.id,
          dueDate: '2026-12-31',
          entity: 'ATA',
        })
        .expect(201);

      const pendingWr = createRes.body.data;

      // Reject it
      const rejectRes = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Needs correction',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      const rejectedWr = rejectRes.body.data;

      // 1. Resubmit with client belonging to another entity (LTA client on ATA WR) -> 400
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedWr.version,
          data: {
            clientId: ltaClient.id,
          },
        })
        .expect(400);

      // 2. Resubmit with invalid assignedTo (employee role) -> 400
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedWr.version,
          data: {
            assignedTo: employeeId,
          },
        })
        .expect(400);

      // 3. Resubmit with valid data -> 200
      const validRes = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedWr.version,
          data: {
            title: 'Corrected Resubmit Title',
            description: 'Now has valid metadata',
          },
        })
        .expect(200);

      expect(validRes.body.data.creationApprovalStatus).toBe('pending');
      expect(validRes.body.data.title).toBe('Corrected Resubmit Title');
    });

    it('denies task, archive, advance, and related paths for Admin when work request is pending or rejected', async () => {
      // 1. Manager creates a pending WR
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Isolation Gate Test WR',
          clientId: client.id,
          dueDate: '2026-12-31',
          entity: 'ATA',
        })
        .expect(201);

      const pendingWr = createRes.body.data;
      expect(pendingWr.creationApprovalStatus).toBe('pending');

      // Admin calls tasks on pending WR -> 404
      await request(app)
        .get(`/v1/work-requests/${pendingWr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      await request(app)
        .post(`/v1/work-requests/${pendingWr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Admin Task on Pending WR',
        })
        .expect(404);

      // Admin calls archive on pending WR -> 404
      await request(app)
        .post(`/v1/work-requests/${pendingWr.id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      // Admin calls advance on pending WR -> 404
      await request(app)
        .post(`/v1/work-requests/${pendingWr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ toPhase: 'processing' })
        .expect(404);

      // Admin calls related on pending WR -> 404
      await request(app)
        .get(`/v1/work-requests/${pendingWr.id}/related`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      // 2. Reject the WR
      const rejectRes = await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Testing rejected isolation',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      const rejectedWr = rejectRes.body.data;
      expect(rejectedWr.creationApprovalStatus).toBe('rejected');

      // Admin calls tasks on rejected WR -> 404
      await request(app)
        .get(`/v1/work-requests/${pendingWr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      await request(app)
        .post(`/v1/work-requests/${pendingWr.id}/tasks`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Admin Task on Rejected WR',
        })
        .expect(404);

      // Admin calls archive on rejected WR -> 404
      await request(app)
        .post(`/v1/work-requests/${pendingWr.id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      // Admin calls advance on rejected WR -> 404
      await request(app)
        .post(`/v1/work-requests/${pendingWr.id}/advance`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ toPhase: 'processing' })
        .expect(404);

      // Admin calls related on rejected WR -> 404
      await request(app)
        .get(`/v1/work-requests/${pendingWr.id}/related`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);
    });

    it('ensures dashboard report does not leak pending or rejected work requests to Admin', async () => {
      invalidateAnalytics('ent-ata');
      // Fetch baseline dashboard summary
      const baseReport = await request(app)
        .get('/v1/reports/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const baseTotal = baseReport.body.data?.workRequests?.total || 0;

      // Manager creates pending WR
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Dashboard Leak Test WR',
          clientId: client.id,
          dueDate: '2026-12-31',
          entity: 'ATA',
        })
        .expect(201);

      const pendingWr = createRes.body.data;

      invalidateAnalytics('ent-ata');
      // Admin checks dashboard -> total should remain unchanged
      const pendingReport = await request(app)
        .get('/v1/reports/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(pendingReport.body.data?.workRequests?.total).toBe(baseTotal);

      // Admin approves the WR
      await request(app)
        .post(`/v1/operations/work-requests/${pendingWr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: pendingWr.version,
        })
        .expect(200);

      invalidateAnalytics('ent-ata');
      // Admin checks dashboard -> total increments by 1
      const approvedReport = await request(app)
        .get('/v1/reports/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(approvedReport.body.data?.workRequests?.total).toBe(baseTotal + 1);
    });

    it('approved submissions API does not confer ongoing task data access to non-member creator (CONTRACT R2)', async () => {
      // Manager creates pending WR assigned to manager2 without self membership
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Non-member Creator Test WR',
          clientId: client.id,
          assignedTo: manager2Id,
          dueDate: '2026-12-31',
          entity: 'ATA',
        })
        .expect(201);

      const wrId = createRes.body.data.id;
      const expectedVersion = createRes.body.data.version;

      // While pending, creator can see it in own submissions
      const pendingList = await request(app)
        .get('/v1/operations/work-requests/creation-approvals?status=pending&scope=mine')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(pendingList.body.data.some((w) => w.id === wrId)).toBe(true);

      // Admin approves the WR
      await request(app)
        .post(`/v1/operations/work-requests/${wrId}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion,
        })
        .expect(200);

      // Once approved, non-member creator cannot use approved submissions API to access it or its tasks
      const approvedList = await request(app)
        .get('/v1/operations/work-requests/creation-approvals?status=approved&scope=mine')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(approvedList.body.data.some((w) => w.id === wrId)).toBe(false);

      // Nor can creator access ordinary WR details
      await request(app)
        .get(`/v1/operations/work-requests/${wrId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      // In contrast, assigned lead (manager2) has access to ordinary WR details
      const leadWr = await request(app)
        .get(`/v1/operations/work-requests/${wrId}`)
        .set('Authorization', `Bearer ${manager2Token}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(leadWr.body.data.id).toBe(wrId);
    });

    it('rejects competing decision requests on same version with 409 CONCURRENT_MODIFICATION', async () => {
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Competing Decisions WR',
          clientId: client.id,
          dueDate: '2026-12-31',
          entity: 'ATA',
        })
        .expect(201);

      const wr = createRes.body.data;
      const initialVersion = wr.version;

      const approveReq = request(app)
        .post(`/v1/operations/work-requests/${wr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'approve',
          expectedVersion: initialVersion,
        });

      const rejectReq = request(app)
        .post(`/v1/operations/work-requests/${wr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Competing rejection landed late',
          expectedVersion: initialVersion,
        });

      const [res1, res2] = await Promise.all([approveReq, rejectReq]);
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });

    it('rejects competing resubmission requests on same version with 409 CONCURRENT_MODIFICATION', async () => {
      const createRes = await request(app)
        .post('/v1/work-requests')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Competing Resubmit WR',
          clientId: client.id,
          dueDate: '2026-12-31',
          entity: 'ATA',
        })
        .expect(201);

      const wr = createRes.body.data;
      // Reject it first
      const rejectRes = await request(app)
        .post(`/v1/operations/work-requests/${wr.id}/creation-approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          decision: 'reject',
          reason: 'Needs correction',
          expectedVersion: wr.version,
        })
        .expect(200);

      const rejectedWr = rejectRes.body.data;
      const rejectedVersion = rejectedWr.version;

      const resubmit1 = request(app)
        .post(`/v1/operations/work-requests/${wr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedVersion,
          data: { description: 'Correction attempt 1' },
        });

      const resubmit2 = request(app)
        .post(`/v1/operations/work-requests/${wr.id}/resubmit-creation`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: rejectedVersion,
          data: { description: 'Correction attempt 2' },
        });

      const [r1, r2] = await Promise.all([resubmit1, resubmit2]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([200, 409]);
    });
  });
});
