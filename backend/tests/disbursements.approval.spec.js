/**
 * Disbursements approval workflow & status routing tests (AC-1, AC-2, AC-3).
 * Covers Parcel P0-G requirements:
 * - AC-1: Staff creation -> Pending; Management/Accounting/Admin creation -> Draft; Status forgery -> 400.
 * - AC-2: Admin-only approve gate (Staff 403, Admin 200 on Pending, Approved->Approved 409).
 * - AC-3: Reject requires reason (400 if empty), Pending only (409 otherwise), persists reason, notifies creator.
 */

const mockNotify = jest.fn().mockResolvedValue();
// This service exists; a virtual mock can resolve inconsistently across suites.
jest.mock('../src/services/notify', () => ({ notify: mockNotify }));

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

// NOTE: the temporary jest.mock of src/lib/permissions (pre-P0-A compensation)
// is removed — the real manifest now grants disbursement:create to all five
// departments and disbursement:approve to Admin.

const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('./fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WORK_REQUEST_ID = '33333333-3333-3333-3333-333333333333';

const seedClientAndWr = () => {
  mockTables.clients.set(CLIENT_ID, {
    id: CLIENT_ID,
    entity_id: 'ent-ata',
    name: 'Acme Corp',
    tin: '123-456-789-00001',
    status: 'Active',
    created_by: 'user-1',
    updated_by: 'user-1',
  });
  mockTables.work_requests.set(WORK_REQUEST_ID, {
    id: WORK_REQUEST_ID,
    entity_id: 'ent-ata',
    client_id: CLIENT_ID,
    title: 'Acme Audit',
    status: 'In Progress',
  });
};

const validDisbursementPayload = {
  category: 'Transportation',
  description: 'Site visit travel expense',
  amount: 2500,
  fundSource: 'Firm Fund',
  clientId: CLIENT_ID,
  linkedWorkRequestId: WORK_REQUEST_ID,
  dueDate: '2026-10-31',
  notes: 'Client visit transportation',
};

describe('Parcel P0-G: Disbursement Approvals & Status Routing', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedClientAndWr();
    mockNotify.mockClear();
  });

  describe('AC-1 & R1: Dynamic Creation Status & Status Forgery Rejection', () => {
    it('creates disbursement with status "Pending" when created by Operations staff', async () => {
      const token = registerUser({
        email: 'ops@ata-lta.ph',
        name: 'Ops Staff',
        role: 'Operations',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      expect(res.body.data.status).toBe('Pending');
      expect(res.body.data.amount).toBe(2500);
      expect(res.body.data.disbursement_number).toMatch(/^DISB-ATA-/);
    });

    it('creates disbursement with status "Pending" when created by HR staff', async () => {
      const token = registerUser({
        email: 'hr@ata-lta.ph',
        name: 'HR Staff',
        role: 'HR',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      expect(res.body.data.status).toBe('Pending');
    });

    it('creates disbursement with status "Pending" when created by Documentation staff', async () => {
      const token = registerUser({
        email: 'doc@ata-lta.ph',
        name: 'Doc Staff',
        role: 'Documentation',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      expect(res.body.data.status).toBe('Pending');
    });

    it('creates disbursement with status "Draft" when created by Accounting', async () => {
      const token = registerUser({
        email: 'acct@ata-lta.ph',
        name: 'Accounting Staff',
        role: 'Accounting',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      expect(res.body.data.status).toBe('Draft');
    });

    it('creates disbursement with status "Draft" when created by Management (Manager)', async () => {
      const token = registerUser({
        email: 'manager@ata-lta.ph',
        name: 'Manager User',
        role: 'Manager',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      expect(res.body.data.status).toBe('Draft');
    });

    it('creates disbursement with status "Draft" when created by Admin', async () => {
      const token = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      expect(res.body.data.status).toBe('Draft');
    });

    it('rejects client-supplied status forgery with 400 Bad Request (attempting "Approved")', async () => {
      const token = registerUser({
        email: 'ops@ata-lta.ph',
        name: 'Ops Staff',
        role: 'Operations',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validDisbursementPayload, status: 'Approved' })
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
    });

    it('rejects client-supplied status forgery with 400 Bad Request (attempting "Draft" as staff)', async () => {
      const token = registerUser({
        email: 'ops@ata-lta.ph',
        name: 'Ops Staff',
        role: 'Operations',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validDisbursementPayload, status: 'Draft' })
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
    });

    it('rejects client-supplied status forgery with 400 Bad Request (attempting "Pending")', async () => {
      const token = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validDisbursementPayload, status: 'Pending' })
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
    });
  });

  describe('AC-2, R2 & R3: Admin Approval Gate', () => {
    let pendingDisbursementId;
    let creatorId;

    beforeEach(async () => {
      creatorId = 'ops-creator-id';
      const opsToken = registerUser({
        id: creatorId,
        email: 'ops-creator@ata-lta.ph',
        name: 'Ops Creator',
        role: 'Operations',
        entities: ['ATA'],
      });

      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      pendingDisbursementId = createRes.body.data.id;
    });

    it('forbids staff users from approving disbursements (403 Forbidden)', async () => {
      const opsToken = registerUser({
        email: 'other-ops@ata-lta.ph',
        name: 'Other Ops',
        role: 'Operations',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/approve`)
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('forbids manager / accounting from approving disbursements (403 Forbidden)', async () => {
      const mgrToken = registerUser({
        email: 'mgr@ata-lta.ph',
        name: 'Manager',
        role: 'Manager',
        entities: ['ATA'],
      });

      await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/approve`)
        .set('Authorization', `Bearer ${mgrToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);
    });

    it('allows Admin to approve a Pending disbursement (200 OK)', async () => {
      const adminToken = registerUser({
        id: 'admin-approver-id',
        email: 'admin@ata-lta.ph',
        name: 'Admin Approver',
        role: 'Admin',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(['Approved', 'Released']).toContain(res.body.data.status);
      expect(res.body.data.approved_by).toBe('admin-approver-id');
      expect(res.body.data.approved_at).toBeDefined();

      // Notification sent to creator
      expect(mockNotify).toHaveBeenCalledWith(
        [creatorId],
        'pending_request.resolved',
        expect.objectContaining({
          outcome: 'approved',
          request_id: pendingDisbursementId,
          table_name: 'disbursements',
        })
      );
    });

    it('returns 409 Conflict when attempting to approve an already-approved disbursement', async () => {
      const adminToken = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin Approver',
        role: 'Admin',
        entities: ['ATA'],
      });

      // First approval succeeds
      await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      // Second approval must return 409 Conflict
      const secondRes = await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(409);

      expect(secondRes.body.title).toMatch(/invalid transition|conflict/i);
    });

    it('allows Admin to directly approve a Draft disbursement (200 OK) (Task B.5)', async () => {
      const adminToken = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin Approver',
        role: 'Admin',
        entities: ['ATA'],
      });

      // Create a draft disbursement as Admin
      const draftRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      expect(draftRes.body.data.status).toBe('Draft');

      // Approving from Draft directly succeeds for Admin (Task B.5 / Defect 2)
      const approveRes = await request(app)
        .post(`/v1/disbursements/${draftRes.body.data.id}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(['Approved', 'Released']).toContain(approveRes.body.data.status);
    });
  });

  describe('AC-3, R2 & R5: Disbursement Rejection Flow', () => {
    let pendingDisbursementId;
    let creatorId;

    beforeEach(async () => {
      creatorId = 'ops-creator-id-2';
      const opsToken = registerUser({
        id: creatorId,
        email: 'ops-creator-2@ata-lta.ph',
        name: 'Ops Creator 2',
        role: 'Operations',
        entities: ['ATA'],
      });

      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      pendingDisbursementId = createRes.body.data.id;
    });

    it('forbids staff from rejecting disbursements (403 Forbidden)', async () => {
      const opsToken = registerUser({
        email: 'ops-rejecter@ata-lta.ph',
        name: 'Ops Rejecter',
        role: 'Operations',
        entities: ['ATA'],
      });

      await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/reject`)
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason: 'Exceeds budget allowance' })
        .expect(403);
    });

    it('rejects with 400 Bad Request when reason is missing', async () => {
      const adminToken = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({})
        .expect(400);

      expect(res.body.title).toMatch(/validation error|bad request/i);
    });

    it('rejects with 400 Bad Request when reason is empty or whitespace', async () => {
      const adminToken = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason: '   ' })
        .expect(400);
    });

    it('rejects a Pending disbursement with reason (200 OK, reason stored, notification dispatched)', async () => {
      const adminToken = registerUser({
        id: 'admin-rejecter-id',
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      const reason = 'Exceeds quarterly budget allocation for site visits';

      const res = await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason })
        .expect(200);

      expect(res.body.data.status).toBe('Rejected');
      expect(res.body.data.rejection_reason).toBe(reason);
      expect(res.body.data.rejected_by).toBe('admin-rejecter-id');
      expect(res.body.data.rejected_at).toBeDefined();

      // Check DB directly
      const inDb = mockTables.disbursements.get(pendingDisbursementId);
      expect(inDb.status).toBe('Rejected');
      expect(inDb.rejection_reason).toBe(reason);

      // Verify notification dispatched to creator
      expect(mockNotify).toHaveBeenCalledWith(
        [creatorId],
        'pending_request.resolved',
        expect.objectContaining({
          outcome: 'rejected',
          reason,
          request_id: pendingDisbursementId,
          table_name: 'disbursements',
        })
      );
    });

    it('returns 409 Conflict when attempting to reject from Approved status (R2)', async () => {
      const adminToken = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      // Approve first
      await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/approve`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      // Attempt to reject an Approved disbursement -> 409 Conflict
      const res = await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason: 'Late rejection' })
        .expect(409);

      expect(res.body.title).toMatch(/invalid transition|conflict/i);
    });

    it('returns 409 Conflict when attempting to reject from Funded status', async () => {
      const adminToken = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      // Create draft and move to Funded
      const draftRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursementPayload)
        .expect(201);

      mockTables.disbursements.get(draftRes.body.data.id).status = 'Funded';

      await request(app)
        .post(`/v1/disbursements/${draftRes.body.data.id}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason: 'Invalid draft' })
        .expect(409);
    });

    it('notification failure does not fail the rejection operation (R5 non-blocking)', async () => {
      const adminToken = registerUser({
        email: 'admin@ata-lta.ph',
        name: 'Admin User',
        role: 'Admin',
        entities: ['ATA'],
      });

      // Force notify failure
      mockNotify.mockRejectedValueOnce(new Error('Notification DB down'));

      const res = await request(app)
        .post(`/v1/disbursements/${pendingDisbursementId}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason: 'Non-blocking notification test' })
        .expect(200);

      expect(res.body.data.status).toBe('Rejected');
    });
  });
});
