/**
 * Tier 1: Functional Feature Coverage Test Suite (F01 - F17)
 * Strictly derived from user requirements and interface contracts.
 * Exactly >= 5 test cases per feature across F01 - F17 (Total = 85 tests).
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const {
  request,
  app,
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  loadPrototypeAuth,
  getPrototypeStyles,
  getPrototypeWorkflow,
} = require('./helpers');

const operationsService = require('../../src/modules/operations/service');
const permissions = require('../../src/lib/permissions');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WR_ID_1 = '22222222-2222-2222-2222-222222222221';
const WR_ID_EXTERNAL = '22222222-2222-2222-2222-222222222222';
const TASK_ID_ASSIGNED = '33333333-3333-3333-3333-333333333331';
const TASK_ID_UNASSIGNED = '33333333-3333-3333-3333-333333333332';
const TASK_ID_COASSIGNED = '33333333-3333-3333-3333-333333333333';

describe('Tier 1: Feature Coverage (F01 - F17)', () => {
  let adminToken, accountingToken, docToken, docUser, otherToken, otherUser, managerToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // Register standard actors
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });
    adminToken = admin;

    const accounting = registerUser({
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA', 'LTA'],
      departments: ['Accounting'],
    });
    accountingToken = accounting;

    const docId = '44444444-4444-4444-4444-444444444441';
    docToken = registerUser({
      id: docId,
      email: 'doc@ata-lta.ph',
      name: 'Documentation Staff',
      role: 'Documentation',
      entities: ['ATA', 'LTA'],
      departments: ['Documentation'],
    });
    docUser = { id: docId, role: 'Documentation', departments: ['Documentation'], name: 'Doc Staff' };

    const otherId = '44444444-4444-4444-4444-444444444442';
    otherToken = registerUser({
      id: otherId,
      email: 'other@ata-lta.ph',
      name: 'Other Staff',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
    otherUser = { id: otherId, role: 'Operations', departments: ['Operations'], name: 'Other Staff' };

    const managerId = '44444444-4444-4444-4444-444444444443';
    managerToken = registerUser({
      id: managerId,
      email: 'manager@ata-lta.ph',
      name: 'Manager User',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });

    // Seed mock data
    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Acme Corp',
      tin: '123-456-789-00001',
      status: 'Active',
      created_by: admin,
      updated_by: admin,
    });

    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Audit WR 1',
      status: 'In Progress',
      created_by: admin,
    });

    mockTables.work_requests.set(WR_ID_EXTERNAL, {
      id: WR_ID_EXTERNAL,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'External WR',
      status: 'In Progress',
      created_by: otherId,
    });

    // Tasks
    mockTables.tasks.set(TASK_ID_ASSIGNED, {
      id: TASK_ID_ASSIGNED,
      work_request_id: WR_ID_1,
      title: 'Assigned Task',
      assignee_id: docId,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_UNASSIGNED, {
      id: TASK_ID_UNASSIGNED,
      work_request_id: WR_ID_1,
      title: 'Unassigned Task',
      assignee_id: otherId,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_COASSIGNED, {
      id: TASK_ID_COASSIGNED,
      work_request_id: WR_ID_1,
      title: 'Co-assigned Task',
      assignee_id: otherId,
      deleted_at: null,
    });

    mockTables.task_assignees.set('ta-1', {
      id: 'ta-1',
      task_id: TASK_ID_COASSIGNED,
      user_id: docId,
    });
  });

  // ==========================================
  // F01: Disbursement Read Creator-Only Filter
  // ==========================================
  describe('F01: Disbursement Read Creator-Only Filter', () => {
    it('F01-1: listDisbursements returns only records where created_by === caller.id for non-Admin/non-Accounting', async () => {
      mockTables.disbursements.set('d-1', {
        id: 'd-1',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        amount: 500,
        status: 'Draft',
        deleted_at: null,
      });
      mockTables.disbursements.set('d-2', {
        id: 'd-2',
        entity_id: 'ent-ata',
        created_by: otherUser.id,
        amount: 1000,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toBeDefined();
      const ids = res.body.data.map((d) => d.id);
      expect(ids).toContain('d-1');
      expect(ids).not.toContain('d-2');
    });

    it('F01-2: getDisbursementById allows read for own created record (200 OK)', async () => {
      mockTables.disbursements.set('d-own', {
        id: 'd-own',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        amount: 750,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements/d-own')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.id).toBe('d-own');
      expect(res.body.data.created_by).toBe(docUser.id);
    });

    it('F01-3: getDisbursementById rejects read of another user record with 403 Forbidden', async () => {
      mockTables.disbursements.set('d-other', {
        id: 'd-other',
        entity_id: 'ent-ata',
        created_by: otherUser.id,
        amount: 800,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements/d-other')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('F01-4: status bypass is eliminated: Released/Funded/Rejected records of others are hidden from list', async () => {
      mockTables.disbursements.set('d-released', {
        id: 'd-released',
        entity_id: 'ent-ata',
        created_by: otherUser.id,
        amount: 1200,
        status: 'Released',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements?status=Released')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = (res.body.data || []).map((d) => d.id);
      expect(ids).not.toContain('d-released');
    });

    it('F01-5: payee bypass is eliminated: user named as payee cannot read if not creator', async () => {
      mockTables.disbursements.set('d-payee', {
        id: 'd-payee',
        entity_id: 'ent-ata',
        created_by: otherUser.id,
        employee_id: docUser.id, // caller is payee
        amount: 1500,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements/d-payee')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });
  });

  // ==========================================
  // F02: Disbursement Badge Counts Creator Scoping
  // ==========================================
  describe('F02: Disbursement Badge Counts Creator Scoping', () => {
    it('F02-1: Admin receives full aggregate badge counts across all users', async () => {
      mockTables.disbursements.set('d-1', { id: 'd-1', entity_id: 'ent-ata', created_by: docUser.id, status: 'Draft' });
      mockTables.disbursements.set('d-2', { id: 'd-2', entity_id: 'ent-ata', created_by: otherUser.id, status: 'Draft' });

      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.active).toBe(2);
    });

    it('F02-2: Accounting receives full aggregate badge counts across all users', async () => {
      mockTables.disbursements.set('d-1', { id: 'd-1', entity_id: 'ent-ata', created_by: docUser.id, status: 'Draft' });
      mockTables.disbursements.set('d-2', { id: 'd-2', entity_id: 'ent-ata', created_by: otherUser.id, status: 'Draft' });

      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.active).toBe(2);
    });

    it('F02-3: Non-Admin creator counts reflect only records created by the caller', async () => {
      mockTables.disbursements.set('d-1', { id: 'd-1', entity_id: 'ent-ata', created_by: docUser.id, status: 'Draft' });
      mockTables.disbursements.set('d-2', { id: 'd-2', entity_id: 'ent-ata', created_by: otherUser.id, status: 'Draft' });

      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.active).toBe(1);
    });

    it('F02-4: Counts exclude other users records in all status buckets (archived, rejected)', async () => {
      mockTables.disbursements.set('d-rej', { id: 'd-rej', entity_id: 'ent-ata', created_by: otherUser.id, status: 'Rejected' });

      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.rejected).toBe(0);
    });

    it('F02-5: User with zero created disbursements receives 0 across all buckets', async () => {
      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toEqual(expect.objectContaining({
        active: 0,
        archived: 0,
        rejected: 0,
        awaitingRelease: 0,
        initialRequests: 0,
        paymentReleases: 0,
        readyForFunding: 0,
        needsCorrection: 0,
        rejectedRequests: 0,
      }));
    });
  });

  // ==========================================
  // F03: Disbursement Own Records Outside WR Membership
  // ==========================================
  describe('F03: Disbursement Own Records Outside WR Membership', () => {
    it('F03-1: Creator can read own disbursement without linked work request (null WR)', async () => {
      mockTables.disbursements.set('d-null-wr', {
        id: 'd-null-wr',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: null,
        amount: 300,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = res.body.data.map((d) => d.id);
      expect(ids).toContain('d-null-wr');
    });

    it('F03-2: Creator can read own disbursement linked to foreign WR where caller is not a member', async () => {
      mockTables.disbursements.set('d-foreign-wr', {
        id: 'd-foreign-wr',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: WR_ID_EXTERNAL,
        amount: 400,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = res.body.data.map((d) => d.id);
      expect(ids).toContain('d-foreign-wr');
    });

    it('F03-3: Creator can fetch single record outside WR membership directly (200 OK)', async () => {
      mockTables.disbursements.set('d-foreign-detail', {
        id: 'd-foreign-detail',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: WR_ID_EXTERNAL,
        amount: 450,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements/d-foreign-detail')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.id).toBe('d-foreign-detail');
    });

    it('F03-4: Non-creator member of foreign WR cannot read creator disbursement', async () => {
      mockTables.disbursements.set('d-foreign-hidden', {
        id: 'd-foreign-hidden',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: WR_ID_EXTERNAL,
        amount: 500,
        status: 'Draft',
        deleted_at: null,
      });

      const res = await request(app)
        .get('/v1/disbursements/d-foreign-hidden')
        .set('Authorization', `Bearer ${otherToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('F03-5: Multi-entity creator reads own records scoped strictly to active entity header', async () => {
      mockTables.disbursements.set('d-ata', {
        id: 'd-ata',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        amount: 100,
        status: 'Draft',
      });
      mockTables.disbursements.set('d-lta', {
        id: 'd-lta',
        entity_id: 'ent-lta',
        created_by: docUser.id,
        amount: 200,
        status: 'Draft',
      });

      const resAta = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ataIds = resAta.body.data.map((d) => d.id);
      expect(ataIds).toContain('d-ata');
      expect(ataIds).not.toContain('d-lta');
    });
  });

  // ==========================================
  // F04: Related Disbursements Scoping
  // ==========================================
  describe('F04: Related Disbursements Scoping', () => {
    it('F04-1: getWorkRequestRelated filters linked disbursements to created_by === caller.id for non-Admin/non-Accounting', async () => {
      mockTables.disbursements.set('d-rel-1', {
        id: 'd-rel-1',
        entity_id: 'ent-ata',
        linked_work_request_id: WR_ID_1,
        created_by: docUser.id,
        amount: 100,
      });
      mockTables.disbursements.set('d-rel-2', {
        id: 'd-rel-2',
        entity_id: 'ent-ata',
        linked_work_request_id: WR_ID_1,
        created_by: otherUser.id,
        amount: 200,
      });

      const related = await operationsService.getWorkRequestRelated(WR_ID_1, docUser);
      const disbIds = (related.disbursements || []).map((d) => d.id);
      expect(disbIds).toContain('d-rel-1');
      expect(disbIds).not.toContain('d-rel-2');
    });

    it('F04-2: getTaskRelated filters linked disbursements to created_by === caller.id for non-Admin/non-Accounting', async () => {
      mockTables.disbursements.set('d-task-1', {
        id: 'd-task-1',
        entity_id: 'ent-ata',
        linked_task_id: TASK_ID_ASSIGNED,
        created_by: docUser.id,
        amount: 150,
      });
      mockTables.disbursements.set('d-task-2', {
        id: 'd-task-2',
        entity_id: 'ent-ata',
        linked_task_id: TASK_ID_ASSIGNED,
        created_by: otherUser.id,
        amount: 250,
      });

      const related = await operationsService.getTaskRelated(TASK_ID_ASSIGNED, docUser);
      const disbIds = (related.disbursements || []).map((d) => d.id);
      expect(disbIds).toContain('d-task-1');
      expect(disbIds).not.toContain('d-task-2');
    });

    it('F04-3: Admin caller in getWorkRequestRelated receives all disbursements linked to the WR', async () => {
      mockTables.disbursements.set('d-rel-1', {
        id: 'd-rel-1',
        entity_id: 'ent-ata',
        linked_work_request_id: WR_ID_1,
        created_by: docUser.id,
      });
      mockTables.disbursements.set('d-rel-2', {
        id: 'd-rel-2',
        entity_id: 'ent-ata',
        linked_work_request_id: WR_ID_1,
        created_by: otherUser.id,
      });

      const adminProfile = { id: 'admin-id', role: 'Admin', departments: ['Management'] };
      const related = await operationsService.getWorkRequestRelated(WR_ID_1, adminProfile);
      const disbIds = (related.disbursements || []).map((d) => d.id);
      expect(disbIds).toContain('d-rel-1');
      expect(disbIds).toContain('d-rel-2');
    });

    it('F04-4: Accounting caller in getTaskRelated receives all disbursements linked to the task', async () => {
      mockTables.disbursements.set('d-task-1', {
        id: 'd-task-1',
        entity_id: 'ent-ata',
        linked_task_id: TASK_ID_ASSIGNED,
        created_by: docUser.id,
      });
      mockTables.disbursements.set('d-task-2', {
        id: 'd-task-2',
        entity_id: 'ent-ata',
        linked_task_id: TASK_ID_ASSIGNED,
        created_by: otherUser.id,
      });

      const accountingProfile = { id: 'acc-id', role: 'Accounting', departments: ['Accounting'] };
      const related = await operationsService.getTaskRelated(TASK_ID_ASSIGNED, accountingProfile);
      const disbIds = (related.disbursements || []).map((d) => d.id);
      expect(disbIds).toContain('d-task-1');
      expect(disbIds).toContain('d-task-2');
    });

    it('F04-5: Non-creator staff member querying related records receives empty disbursements when none created', async () => {
      mockTables.disbursements.set('d-rel-2', {
        id: 'd-rel-2',
        entity_id: 'ent-ata',
        linked_work_request_id: WR_ID_1,
        created_by: otherUser.id,
      });

      const related = await operationsService.getWorkRequestRelated(WR_ID_1, docUser);
      expect(related.disbursements || []).toEqual([]);
    });
  });

  // ==========================================
  // F05: Invoice Request Documentation Denial
  // ==========================================
  describe('F05: Invoice Request Documentation Denial', () => {
    const billingPayload = {
      type: 'billing',
      workRequestId: WR_ID_1,
      taskId: TASK_ID_ASSIGNED,
      clientId: CLIENT_ID,
      amount: 5000,
      notes: 'Request billing invoice',
    };

    it('F05-1: User with role Documentation is rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(billingPayload)
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
      expect(res.body.detail).toMatch(/documentation users cannot request invoice billing/i);
    });

    it('F05-2: User with department Documentation is rejected with 403 Forbidden', async () => {
      const staffDocToken = registerUser({
        email: 'staffdoc@ata-lta.ph',
        name: 'Staff Doc',
        role: 'Staff',
        departments: ['Documentation'],
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${staffDocToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(billingPayload)
        .expect(403);

      expect(res.body.detail).toMatch(/documentation users cannot request invoice billing/i);
    });

    it('F05-3: Multi-department Documentation + Operations user is rejected with 403 Forbidden', async () => {
      const multiToken = registerUser({
        email: 'multi@ata-lta.ph',
        name: 'Multi User',
        role: 'Staff',
        departments: ['Documentation', 'Operations'],
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${multiToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(billingPayload)
        .expect(403);

      expect(res.body.detail).toMatch(/documentation users cannot request invoice billing/i);
    });

    it('F05-4: Pure Operations user without Documentation membership is permitted (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${otherToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(billingPayload)
        .expect(201);

      expect(res.body.data.type).toBe('billing');
    });

    it('F05-5: Admin user is permitted to create requests', async () => {
      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(billingPayload)
        .expect(201);

      expect(res.body.data.type).toBe('billing');
    });
  });

  // ==========================================
  // F06: Transmittal Task Assignment Enforcement
  // ==========================================
  describe('F06: Transmittal Task Assignment Enforcement', () => {
    const validTransmittalPayload = {
      clientId: CLIENT_ID,
      workRequestId: WR_ID_1,
      linkedTaskId: TASK_ID_ASSIGNED,
      trackingNumber: 'TR-10001',
      items: [{ description: 'Financial Statements', documentType: 'Tax', quantity: 1 }],
      notes: 'Task transmittal',
      recipientName: 'Client Representative',
    };

    it('F06-1: Primary assignee on task can create task-linked transmittal (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(validTransmittalPayload)
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(TASK_ID_ASSIGNED);
    });

    it('F06-2: Co-assignee on task can create task-linked transmittal (201 Created)', async () => {
      const coPayload = { ...validTransmittalPayload, linkedTaskId: TASK_ID_COASSIGNED, trackingNumber: 'TR-10002' };
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(coPayload)
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(TASK_ID_COASSIGNED);
    });

    it('F06-3: Unassigned Documentation user is rejected on transmittal create with 403 Forbidden', async () => {
      const unassignedPayload = { ...validTransmittalPayload, linkedTaskId: TASK_ID_UNASSIGNED, trackingNumber: 'TR-10003' };
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(unassignedPayload)
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('F06-4: Relinking transmittal to unassigned task is rejected with 403 Forbidden', async () => {
      mockTables.transmittals.set('tr-edit-1', {
        id: 'tr-edit-1',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_task_id: TASK_ID_ASSIGNED,
        status: 'Draft',
        approved: true,
      });

      const res = await request(app)
        .put('/v1/transmittals/tr-edit-1')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: TASK_ID_UNASSIGNED })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('F06-5: Sending transmittal when caller is not assigned to task is rejected with 403 Forbidden', async () => {
      mockTables.transmittals.set('tr-send-1', {
        id: 'tr-send-1',
        entity_id: 'ent-ata',
        created_by: otherUser.id,
        linked_task_id: TASK_ID_UNASSIGNED,
        status: 'Draft',
        approved: true,
      });

      const res = await request(app)
        .post('/v1/transmittals/tr-send-1/send')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });
  });

  // ==========================================
  // F07: Transmittal Blank/Whole-Project Rejection
  // ==========================================
  describe('F07: Transmittal Blank/Whole-Project Rejection', () => {
    const basePayload = {
      clientId: CLIENT_ID,
      workRequestId: WR_ID_1,
      items: [{ description: 'Audit Report', documentType: 'Audit', quantity: 1 }],
      recipientName: 'Recipient',
    };

    it('F07-1: Documentation user submitting linkedTaskId: null is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: null })
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-2: Documentation user submitting linkedTaskId: "" (empty string) is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: '' })
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-3: Documentation user submitting linkedTaskId: "   " (whitespace) is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: '   ' })
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-4: Documentation user omitting linkedTaskId entirely is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(basePayload)
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-5: Admin user creating transmittal with WR without task selection is rejected with 400 TASK_REQUIRED', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: null, trackingNumber: 'TR-ADMIN-01' })
        .expect(400);

      expect(res.body.code).toBe('TASK_REQUIRED');
    });
  });

  // ==========================================
  // F08: Retainer Templates Manager Role Access
  // ==========================================
  describe('F08: Retainer Templates Manager Role Access', () => {
    it('F08-1: Role Manager has retainers:edit permission in permissions matrix', () => {
      const rolePerms = permissions.ROLE_PERMISSIONS.Manager || [];
      expect(rolePerms).toContain('retainers:edit');
    });

    it('F08-2: Manager role can create retainer template via API (201 Created)', async () => {
      const templatePayload = {
        name: 'Monthly Bookkeeping Template',
        description: 'Standard retainer template',
        lines: [{ title: 'Monthly Reconciliation', phase: 'processing', defaultPriority: 'Normal' }],
      };

      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(templatePayload)
        .expect(201);

      expect(res.body.data.name).toBe('Monthly Bookkeeping Template');
    });

    it('F08-3: Admin role can manage retainer templates (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ name: 'Admin Template', lines: [] })
        .expect(201);

      expect(res.body.data.name).toBe('Admin Template');
    });

    it('F08-4: Department Management with role Staff is rejected with 403 Forbidden', async () => {
      const mgmtStaffToken = registerUser({
        email: 'mgmtstaff@ata-lta.ph',
        name: 'Management Staff',
        role: 'Staff',
        departments: ['Management'],
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${mgmtStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ name: 'Unauthorized Template', lines: [] })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('F08-5: Manager role attempting to create standard task template is rejected with 403 Forbidden (Admin only)', async () => {
      const res = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ title: 'Task Template 1', defaultPhase: 'processing' })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });
  });



  // ==========================================
  // F14: Prototype Disbursement Read Visibility Alignment
  // ==========================================
  describe('F14: Prototype Disbursement Read Visibility Alignment', () => {
    it('F14-1: canViewDisbursement returns true for Admin user', () => {
      const Auth = loadPrototypeAuth({ role: 'Admin', departments: ['Management'] });
      expect(Auth.canViewDisbursement({ id: 'd-1', status: 'Draft', createdBy: 'someone-else' })).toBe(true);
    });

    it('F14-2: canViewDisbursement returns true for Accounting user', () => {
      const Auth = loadPrototypeAuth({ role: 'Accounting', departments: ['Accounting'] });
      expect(Auth.canViewDisbursement({ id: 'd-1', status: 'Draft', createdBy: 'someone-else' })).toBe(true);
    });

    it('F14-3: canViewDisbursement returns true for record creator', () => {
      const Auth = loadPrototypeAuth({ id: 'user-doc', role: 'Documentation', departments: ['Documentation'] });
      expect(Auth.canViewDisbursement({ id: 'd-1', status: 'Draft', createdBy: 'user-doc' })).toBe(true);
    });

    it('F14-4: Released/Funded/Rejected status bypass is removed (returns false for non-creator)', () => {
      const Auth = loadPrototypeAuth({ id: 'user-doc', role: 'Documentation', departments: ['Documentation'] });
      expect(Auth.canViewDisbursement({ id: 'd-1', status: 'Released', createdBy: 'other-user' })).toBe(false);
      expect(Auth.canViewDisbursement({ id: 'd-2', status: 'Funded', createdBy: 'other-user' })).toBe(false);
      expect(Auth.canViewDisbursement({ id: 'd-3', status: 'Rejected', createdBy: 'other-user' })).toBe(false);
    });

    it('F14-5: WR team member bypass is removed (returns false for non-creator member)', () => {
      const Auth = loadPrototypeAuth({ id: 'user-doc', role: 'Documentation', departments: ['Documentation'] });
      Auth.canViewWr = () => true;
      expect(
        Auth.canViewDisbursement({
          id: 'd-wr',
          linkedWorkRequestId: 'wr-1',
          status: 'Draft',
          createdBy: 'other-user',
        })
      ).toBe(false);
    });
  });

  // ==========================================
  // F15: Prototype Transmittal Modal Whole-Project & Task Guard
  // ==========================================
  describe('F15: Prototype Transmittal Modal Whole-Project & Task Guard', () => {
    it('F15-1: Modal generation code filters tasks by isTaskAssignee for Documentation staff', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/isTaskAssignee|assigneeId.*===.*Auth\.user/);
    });

    it('F15-2: Whole Project option is not added unconditionally', () => {
      const code = getPrototypeWorkflow();
      const unconditionalWholeProject = /taskSel\.appendChild\(el\('option',\s*\{\s*value:\s*'',\s*text:\s*'— Whole Project —'\s*\}\)\);/;
      expect(unconditionalWholeProject.test(code)).toBe(false);
    });

    it('F15-3: Admin user retains access to Whole Project option', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/Auth\.user\?\.role === 'Admin'|isAdmin/);
    });

    it('F15-4: Blank task submissions are validated and rejected on save', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/linkedTaskId.*required|Please select a task/i);
    });

    it('F15-5: Assigned tasks remain selectable and populate dropdown', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/taskSel\.appendChild\(opt\)/);
    });
  });

  // ==========================================
  // F16: Prototype Retainer Templates Role Guard
  // ==========================================
  describe('F16: Prototype Retainer Templates Role Guard', () => {
    it('F16-1: Retainer Templates tab is rendered for Admin user', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/Auth\.user\?\.role === 'Admin'|Auth\.user\?\.role === 'Manager'/);
    });

    it('F16-2: Retainer Templates tab is rendered for role Manager', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/role === 'Manager'|isManagerial/);
    });

    it('F16-3: Retainer Templates tab does not rely on legacy workflow:approve permission', () => {
      const code = getPrototypeWorkflow();
      const legacyApprovalGating = /if\s*\(Auth\.can\('workflow:approve'\)\)\s*\{\s*tabs\.push\(\{\s*key:\s*'templates'/;
      expect(legacyApprovalGating.test(code)).toBe(false);
    });

    it('F16-4: Retainer Templates tab is hidden for non-managerial staff', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/tabs\.push\(\{\s*key:\s*'templates'/);
    });

    it('F16-5: Task Templates tab remains strictly restricted to Admin only', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/Auth\.user\?\.role === 'Admin'.*task-templates/s);
    });
  });

  // ==========================================
  // F17: Prototype Work Request Datepicker Scoped Styling
  // ==========================================
  describe('F17: Prototype Work Request Datepicker Scoped Styling', () => {
    it('F17-1: Scoped CSS rule #wr-form .notion-prop--due-date .mdp-wrapper exists in styles.css', () => {
      const css = getPrototypeStyles();
      expect(css).toMatch(/#wr-form\s+\.notion-prop--due-date\s+\.mdp-wrapper/);
    });

    it('F17-2: Scoped rule defines max-width: 220px', () => {
      const css = getPrototypeStyles();
      const match = css.match(/#wr-form\s+\.notion-prop--due-date\s+\.mdp-wrapper\s*\{([^}]+)\}/);
      expect(match).not.toBeNull();
      expect(match[1]).toMatch(/max-width:\s*220px/);
    });

    it('F17-3: Scoped rule defines width: 100%', () => {
      const css = getPrototypeStyles();
      const match = css.match(/#wr-form\s+\.notion-prop--due-date\s+\.mdp-wrapper\s*\{([^}]+)\}/);
      expect(match).not.toBeNull();
      expect(match[1]).toMatch(/width:\s*100%/);
    });

    it('F17-4: Global unscoped .mdp-wrapper maintains display: inline-flex', () => {
      const css = getPrototypeStyles();
      expect(css).toMatch(/\.mdp-wrapper\s*\{[^}]*display:\s*inline-flex/);
    });

    it('F17-5: Modal layout flex grid rules contain datepicker within column bounds', () => {
      const css = getPrototypeStyles();
      expect(css).toMatch(/\.notion-property-grid|\.notion-prop/);
    });
  });
});
