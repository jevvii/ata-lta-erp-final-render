/**
 * Challenger 1: Empirical Adversarial Verification Suite
 * Target: Backend Server-Side Authorization Enforcement (RBAC)
 *
 * Vectors Probed:
 * 1. Disbursement list/detail/counts leaks (parameter tampering, status manipulation, unauthenticated caller injection, payee/manager/WR bypass attempts, related disbursements).
 * 2. Operations request billing invoice creation (mixed departments: Doc+Ops, Doc+Mgmt, Doc+Acct; case variations; forged payloads).
 * 3. Transmittal creation, relinking, and sending (unassigned tasks, null/blank tasks, cross-WR task hijacking, unassignment race conditions).
 * 4. Retainer template mutations & task template escalation attacks (non-Manager staff, department-only Management, Manager permissions, Admin-only task templates).
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
} = require('../e2e/helpers');

const operationsService = require('../../src/modules/operations/service');

const CLIENT_ID_1 = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID_2 = '11111111-1111-1111-1111-111111111112';
const WR_ID_1 = '22222222-2222-2222-2222-222222222221';
const WR_ID_2 = '22222222-2222-2222-2222-222222222222';
const TASK_ID_1 = '33333333-3333-3333-3333-333333333331';
const TASK_ID_2 = '33333333-3333-3333-3333-333333333332';
const TASK_ID_UNASSIGNED = '33333333-3333-3333-3333-333333333339';

describe('Challenger 1: Backend RBAC Adversarial Verification Suite', () => {
  let adminToken, adminUser;
  let accountingToken, accountingUser;
  let managerToken, managerUser;
  let docToken, docUser;
  let opsToken, opsUser;
  let staffUser1Token, staffUser1;
  let staffUser2Token, staffUser2;
  let deptMgmtStaffToken, deptMgmtStaffUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // 1. Admin
    const adminId = '99999999-9999-9999-9999-999999999999';
    adminToken = registerUser({
      id: adminId,
      email: 'admin@ata-lta.ph',
      name: 'Admin Boss',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });
    adminUser = { id: adminId, role: 'Admin', departments: ['Management'] };

    // 2. Accounting
    const acctId = '88888888-8888-8888-8888-888888888888';
    accountingToken = registerUser({
      id: acctId,
      email: 'acct@ata-lta.ph',
      name: 'Accounting Officer',
      role: 'Accounting',
      entities: ['ATA', 'LTA'],
      departments: ['Accounting'],
    });
    accountingUser = { id: acctId, role: 'Accounting', departments: ['Accounting'] };

    // 3. Manager
    const mgrId = '77777777-7777-7777-7777-777777777777';
    managerToken = registerUser({
      id: mgrId,
      email: 'manager@ata-lta.ph',
      name: 'Manager Alice',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });
    managerUser = { id: mgrId, role: 'Manager', departments: ['Management'] };

    // 4. Documentation Staff
    const docId = '55555555-5555-5555-5555-555555555551';
    docToken = registerUser({
      id: docId,
      email: 'doc@ata-lta.ph',
      name: 'Documentation Dave',
      role: 'Documentation',
      entities: ['ATA', 'LTA'],
      departments: ['Documentation'],
    });
    docUser = { id: docId, role: 'Documentation', departments: ['Documentation'] };

    // 5. Operations Staff
    const opsId = '55555555-5555-5555-5555-555555555552';
    opsToken = registerUser({
      id: opsId,
      email: 'ops@ata-lta.ph',
      name: 'Operations Olivia',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
    opsUser = { id: opsId, role: 'Operations', departments: ['Operations'] };

    // 6. Generic Staff User 1
    const staff1Id = '66666666-6666-6666-6666-666666666661';
    staffUser1Token = registerUser({
      id: staff1Id,
      email: 'staff1@ata-lta.ph',
      name: 'Staff One',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
    staffUser1 = { id: staff1Id, role: 'Operations', departments: ['Operations'] };

    // 7. Generic Staff User 2
    const staff2Id = '66666666-6666-6666-6666-666666666662';
    staffUser2Token = registerUser({
      id: staff2Id,
      email: 'staff2@ata-lta.ph',
      name: 'Staff Two',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
    staffUser2 = { id: staff2Id, role: 'Operations', departments: ['Operations'] };

    // 8. Staff with Department Management (not role Manager)
    const deptMgmtId = '66666666-6666-6666-6666-666666666663';
    deptMgmtStaffToken = registerUser({
      id: deptMgmtId,
      email: 'deptmgmt@ata-lta.ph',
      name: 'Dept Management Staff',
      role: 'Staff',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });
    deptMgmtStaffUser = { id: deptMgmtId, role: 'Staff', departments: ['Management'] };

    // Seed mock clients
    mockTables.clients.set(CLIENT_ID_1, {
      id: CLIENT_ID_1,
      name: 'Acme Corporation',
      code: 'ACM',
      entity_id: 'ent-ata',
      deleted_at: null,
    });
    mockTables.clients.set(CLIENT_ID_2, {
      id: CLIENT_ID_2,
      name: 'Beta Global Industries',
      code: 'BET',
      entity_id: 'ent-ata',
      deleted_at: null,
    });

    // Seed Work Requests
    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID_1,
      title: 'Tax Compliance Project Alpha',
      work_order_number: 'WR-ATA-2026-0001',
      status: 'In Progress',
      phase: 'execution',
      team_members: [docUser.id, staffUser1.id],
      deleted_at: null,
    });

    mockTables.work_requests.set(WR_ID_2, {
      id: WR_ID_2,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID_2,
      title: 'Cross-Entity Audit Beta',
      work_order_number: 'WR-ATA-2026-0002',
      status: 'In Progress',
      phase: 'execution',
      team_members: [staffUser2.id],
      deleted_at: null,
    });

    // Seed Tasks
    mockTables.tasks.set(TASK_ID_1, {
      id: TASK_ID_1,
      work_request_id: WR_ID_1,
      title: 'Prepare BIR 1702 Document',
      assignee_id: docUser.id,
      status: 'In Progress',
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_2, {
      id: TASK_ID_2,
      work_request_id: WR_ID_2,
      title: 'Audit Report Review Task',
      assignee_id: staffUser2.id,
      status: 'In Progress',
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_UNASSIGNED, {
      id: TASK_ID_UNASSIGNED,
      work_request_id: WR_ID_1,
      title: 'Unassigned Floating Task',
      assignee_id: null,
      status: 'Pending',
      deleted_at: null,
    });

    // Task assignees join table
    mockTables.task_assignees.set(`${TASK_ID_1}:${docUser.id}`, {
      id: `ta-1`,
      task_id: TASK_ID_1,
      user_id: docUser.id,
    });
    mockTables.task_assignees.set(`${TASK_ID_2}:${staffUser2.id}`, {
      id: `ta-2`,
      task_id: TASK_ID_2,
      user_id: staffUser2.id,
    });
  });

  // =========================================================================
  // VECTOR 1: Disbursement list/detail/counts leaks
  // =========================================================================
  describe('Vector 1: Disbursement Authorization & Leakage Adversarial Probes', () => {
    let disbStaff2Draft, disbStaff2Released, disbStaff2Funded, disbStaff2Rejected, disbStaff2Approved;

    beforeEach(() => {
      // Seed Staff 2 disbursements across all statuses
      disbStaff2Draft = {
        id: '44444444-4444-4444-4444-444444444401',
        entity_id: 'ent-ata',
        disbursement_number: 'DISB-ATA-20261019-0001',
        description: 'Staff 2 Draft Supplies',
        category: 'Supplies',
        fund_source: 'Petty Cash',
        amount: 1500,
        status: 'Draft',
        created_by: staffUser2.id,
        employee_id: staffUser1.id, // Staff 1 is payee!
        requested_by: managerUser.id, // Manager requested it!
        linked_work_request_id: WR_ID_1, // Linked to WR 1 where Staff 1 is member!
        archived: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
      };
      mockTables.disbursements.set(disbStaff2Draft.id, disbStaff2Draft);

      disbStaff2Released = {
        id: '44444444-4444-4444-4444-444444444402',
        entity_id: 'ent-ata',
        disbursement_number: 'DISB-ATA-20261019-0002',
        description: 'Staff 2 Released Transport',
        category: 'Transportation',
        fund_source: 'Bank Transfer',
        amount: 2500,
        status: 'Released',
        created_by: staffUser2.id,
        employee_id: staffUser1.id, // Staff 1 is payee!
        requested_by: staffUser2.id,
        linked_work_request_id: WR_ID_1,
        archived: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
      };
      mockTables.disbursements.set(disbStaff2Released.id, disbStaff2Released);

      disbStaff2Funded = {
        id: '44444444-4444-4444-4444-444444444403',
        entity_id: 'ent-ata',
        disbursement_number: 'DISB-ATA-20261019-0003',
        description: 'Staff 2 Funded Courier',
        category: 'Courier',
        fund_source: 'Bank Transfer',
        amount: 3500,
        status: 'Funded',
        created_by: staffUser2.id,
        employee_id: staffUser2.id,
        requested_by: staffUser2.id,
        linked_work_request_id: WR_ID_2,
        archived: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
      };
      mockTables.disbursements.set(disbStaff2Funded.id, disbStaff2Funded);

      disbStaff2Rejected = {
        id: '44444444-4444-4444-4444-444444444404',
        entity_id: 'ent-ata',
        disbursement_number: 'DISB-ATA-20261019-0004',
        description: 'Staff 2 Rejected Meals',
        category: 'Meals',
        fund_source: 'Petty Cash',
        amount: 800,
        status: 'Rejected',
        created_by: staffUser2.id,
        employee_id: staffUser2.id,
        requested_by: staffUser2.id,
        linked_work_request_id: null,
        archived: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
      };
      mockTables.disbursements.set(disbStaff2Rejected.id, disbStaff2Rejected);

      disbStaff2Approved = {
        id: '44444444-4444-4444-4444-444444444405',
        entity_id: 'ent-ata',
        disbursement_number: 'DISB-ATA-20261019-0005',
        description: 'Staff 2 Approved Permits',
        category: 'Permits',
        fund_source: 'Bank Transfer',
        amount: 5000,
        status: 'Approved',
        created_by: staffUser2.id,
        employee_id: staffUser2.id,
        requested_by: staffUser2.id,
        linked_work_request_id: null,
        archived: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
      };
      mockTables.disbursements.set(disbStaff2Approved.id, disbStaff2Approved);

      // Seed Staff 1's own disbursement
      mockTables.disbursements.set('44444444-4444-4444-4444-444444444410', {
        id: '44444444-4444-4444-4444-444444444410',
        entity_id: 'ent-ata',
        disbursement_number: 'DISB-ATA-20261019-0010',
        description: 'Staff 1 Own Filing Fee',
        category: 'Filing',
        fund_source: 'Petty Cash',
        amount: 1200,
        status: 'Submitted',
        created_by: staffUser1.id,
        employee_id: staffUser1.id,
        requested_by: staffUser1.id,
        linked_work_request_id: WR_ID_1,
        archived: false,
        deleted_at: null,
        created_at: new Date().toISOString(),
      });
    });

    test('1.1 Parameter tampering: injecting created_by query param does NOT leak third-party disbursements', async () => {
      // Staff 1 queries disbursements while tampering with ?created_by=staffUser2.id
      const res = await request(app)
        .get(`/v1/disbursements?created_by=${staffUser2.id}&createdBy=${staffUser2.id}`)
        .set('Authorization', `Bearer ${staffUser1Token}`)
        .set('x-active-entity', 'ATA');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      // Must ONLY contain Staff 1's own records, zero records from Staff 2
      res.body.data.forEach((item) => {
        expect(item.created_by).toBe(staffUser1.id);
      });
      expect(res.body.data.some((d) => d.created_by === staffUser2.id)).toBe(false);
    });

    test('1.2 Parameter tampering: extreme limits, negative offsets, and SQL characters do not crash or leak', async () => {
      const res = await request(app)
        .get(`/v1/disbursements?limit=999999&offset=-10&search=%27%20OR%201=1%20--`)
        .set('Authorization', `Bearer ${staffUser1Token}`)
        .set('x-active-entity', 'ATA');

      expect(res.status).toBe(200);
      res.body.data.forEach((item) => {
        expect(item.created_by).toBe(staffUser1.id);
      });
    });

    test('1.3 Status manipulation: querying specific statuses does NOT leak third-party records', async () => {
      const statuses = ['Released', 'Funded', 'Rejected', 'Approved', 'Draft'];
      for (const status of statuses) {
        const res = await request(app)
          .get(`/v1/disbursements?status=${status}`)
          .set('Authorization', `Bearer ${staffUser1Token}`)
          .set('x-active-entity', 'ATA');

        expect(res.status).toBe(200);
        res.body.data.forEach((item) => {
          expect(item.created_by).toBe(staffUser1.id);
        });
        expect(res.body.data.some((d) => d.created_by === staffUser2.id)).toBe(false);
      }
    });

    test('1.4 Status manipulation: single-record fetch across all statuses returns 403 Forbidden for non-creator', async () => {
      const ids = [
        disbStaff2Draft.id,
        disbStaff2Released.id,
        disbStaff2Funded.id,
        disbStaff2Rejected.id,
        disbStaff2Approved.id,
      ];
      for (const id of ids) {
        const res = await request(app)
          .get(`/v1/disbursements/${id}`)
          .set('Authorization', `Bearer ${staffUser1Token}`)
          .set('x-active-entity', 'ATA');

        expect(res.status).toBe(403);
        expect(res.body.title).toBe('Forbidden');
      }
    });

    test('1.5 Payee bypass attempt: employee_id matching caller ID does NOT grant read access to other user record', async () => {
      // In disbStaff2Released, employee_id === staffUser1.id, but created_by === staffUser2.id
      const res = await request(app)
        .get(`/v1/disbursements/${disbStaff2Released.id}`)
        .set('Authorization', `Bearer ${staffUser1Token}`)
        .set('x-active-entity', 'ATA');

      expect(res.status).toBe(403);
      expect(res.body.title).toBe('Forbidden');
    });

    test('1.6 Manager role bypass attempt: role Manager does NOT bypass creator-only read rule', async () => {
      // Manager is NOT creator of disbStaff2Released
      const res = await request(app)
        .get(`/v1/disbursements/${disbStaff2Released.id}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA');

      expect(res.status).toBe(403);
      expect(res.body.title).toBe('Forbidden');

      // Manager list does not contain Staff 2's records (Manager can only see own records unless Admin/Accounting)
      const listRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA');

      expect(listRes.status).toBe(200);
      listRes.body.data.forEach((item) => {
        expect(item.created_by).toBe(managerUser.id);
      });
    });

    test('1.7 Requester & WR team membership bypass attempt: requested_by and WR membership do not grant read access', async () => {
      // disbStaff2Draft has requested_by: managerUser.id and linked_work_request_id: WR_ID_1 (where staffUser1 is a member)
      const res = await request(app)
        .get(`/v1/disbursements/${disbStaff2Draft.id}`)
        .set('Authorization', `Bearer ${staffUser1Token}`)
        .set('x-active-entity', 'ATA');

      expect(res.status).toBe(403);
    });

    test('1.8 Unauthenticated caller injection: blocked with 401 Unauthorized across list, detail, and counts', async () => {
      const listRes = await request(app).get('/v1/disbursements').set('x-active-entity', 'ATA');
      expect(listRes.status).toBe(401);

      const detailRes = await request(app)
        .get(`/v1/disbursements/${disbStaff2Draft.id}`)
        .set('x-active-entity', 'ATA');
      expect(detailRes.status).toBe(401);

      const countsRes = await request(app).get('/v1/disbursements/counts').set('x-active-entity', 'ATA');
      expect(countsRes.status).toBe(401);

      const invalidTokenRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', 'Bearer forged-bad-token')
        .set('x-active-entity', 'ATA');
      expect(invalidTokenRes.status).toBe(401);
    });

    test('1.9 Status forgery on creation is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staffUser1Token}`)
        .set('x-active-entity', 'ATA')
        .send({
          description: 'Hacked Released Disbursement',
          category: 'Supplies',
          fundSource: 'Petty Cash',
          amount: 1000,
          status: 'Released', // Status forgery attempt!
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('status forgery is prohibited');
    });

    test('1.10 Badge counts do NOT leak other users disbursements', async () => {
      const countsRes = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${staffUser1Token}`)
        .set('x-active-entity', 'ATA');

      expect(countsRes.status).toBe(200);
      // Staff 1 only created 1 record (Submitted, active)
      expect(countsRes.body.data.active).toBe(1);
      expect(countsRes.body.data.archived).toBe(0);
      expect(countsRes.body.data.rejected).toBe(0);
      expect(countsRes.body.data.awaitingRelease).toBe(0);

      // Accounting sees aggregate total counts
      const acctCounts = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('x-active-entity', 'ATA');

      expect(acctCounts.status).toBe(200);
      expect(acctCounts.body.data.active).toBeGreaterThan(1);
    });

    test('1.11 Related disbursements scoping in operations service hides non-owned records from staff', async () => {
      const relatedStaff1 = await operationsService.getWorkRequestRelated({
        id: WR_ID_1,
        entityId: 'ent-ata',
        caller: staffUser1,
      });

      expect(Array.isArray(relatedStaff1.disbursements)).toBe(true);
      relatedStaff1.disbursements.forEach((d) => {
        expect(d.created_by).toBe(staffUser1.id);
      });
      expect(relatedStaff1.disbursements.some((d) => d.created_by === staffUser2.id)).toBe(false);

      // Accounting caller sees all disbursements linked to the WR
      const relatedAcct = await operationsService.getWorkRequestRelated({
        id: WR_ID_1,
        entityId: 'ent-ata',
        caller: accountingUser,
      });
      expect(relatedAcct.disbursements.some((d) => d.created_by === staffUser2.id)).toBe(true);
      expect(relatedAcct.disbursements.some((d) => d.created_by === staffUser1.id)).toBe(true);
    });
  });

  // =========================================================================
  // VECTOR 2: Operations request billing invoice creation
  // =========================================================================
  describe('Vector 2: Operations Request Billing Creation Adversarial Probes', () => {
    test('2.1 Mixed department: Documentation + Operations is strictly rejected (403 Forbidden)', async () => {
      const hybridToken = registerUser({
        email: 'doc-ops@ata-lta.ph',
        name: 'Hybrid Doc Ops',
        role: 'Operations',
        entities: ['ATA', 'LTA'],
        departments: ['Documentation', 'Operations'],
      });

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${hybridToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          amount: 15000,
          notes: 'Attempting billing request from mixed Doc+Ops user',
        });

      expect(res.status).toBe(403);
      expect(res.body.title).toBe('Forbidden');
      expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
    });

    test('2.2 Mixed department: Documentation + Management is strictly rejected (403 Forbidden)', async () => {
      const hybridToken = registerUser({
        email: 'doc-mgmt@ata-lta.ph',
        name: 'Hybrid Doc Mgmt',
        role: 'Staff',
        entities: ['ATA', 'LTA'],
        departments: ['Documentation', 'Management'],
      });

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${hybridToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          amount: 25000,
        });

      expect(res.status).toBe(403);
      expect(res.body.title).toBe('Forbidden');
      expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
    });

    test('2.3 Case variations in department name (documentation, DOCUMENTATION, dOcUmEnTaTiOn) are rejected', async () => {
      const casings = ['documentation', 'DOCUMENTATION', 'dOcUmEnTaTiOn'];
      for (const casing of casings) {
        const token = registerUser({
          email: `casing-${casing}@ata-lta.ph`,
          name: `Casing ${casing}`,
          role: 'Staff',
          entities: ['ATA', 'LTA'],
          departments: [casing, 'Operations'],
        });

        const res = await request(app)
          .post('/v1/operations-requests')
          .set('Authorization', `Bearer ${token}`)
          .set('x-active-entity', 'ATA')
          .send({
            type: 'billing',
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            amount: 5000,
          });

        expect(res.status).toBe(403);
        expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
      }
    });

    test('2.4 Case variations in role name (documentation, DOCUMENTATION) are rejected', async () => {
      const casings = ['documentation', 'DOCUMENTATION'];
      for (const casing of casings) {
        const token = registerUser({
          email: `role-${casing}@ata-lta.ph`,
          name: `Role Casing ${casing}`,
          role: casing,
          entities: ['ATA', 'LTA'],
          departments: ['Operations'],
        });

        const res = await request(app)
          .post('/v1/operations-requests')
          .set('Authorization', `Bearer ${token}`)
          .set('x-active-entity', 'ATA')
          .send({
            type: 'billing',
            workRequestId: WR_ID_1,
            linkedTaskId: TASK_ID_1,
            amount: 5000,
          });

        expect(res.status).toBe(403);
        expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
      }
    });

    test('2.5 Forged payloads: request_type fallback and prototype pollution keys are blocked', async () => {
      // Documentation user using request_type instead of type
      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          request_type: 'billing',
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          amount: 10000,
          __proto__: { role: 'Admin' },
        });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
    });

    test('2.6 Legitimate Operations-only user can create billing request (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${opsToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          amount: 12000,
          notes: 'Legitimate ops request',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.type).toBe('billing');
      expect(res.body.data.status).toBe('pending');
    });
  });

  // =========================================================================
  // VECTOR 3: Transmittal creation, relinking, and sending
  // =========================================================================
  describe('Vector 3: Transmittal Assignment & Lifecycle Adversarial Probes', () => {
    test('3.1 Unassigned task creation is rejected with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_UNASSIGNED,
          items: [{ description: 'Tax Returns Copy' }],
        });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('You are not assigned to this task');
    });

    test('3.2 Null, empty string, whitespace, and omitted linkedTaskId are rejected with 400 Bad Request', async () => {
      const badTasks = [null, '', '   ', undefined];
      for (const badTask of badTasks) {
        const payload = {
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          items: [{ description: 'Tax Filing Items' }],
        };
        if (badTask !== undefined) {
          payload.linkedTaskId = badTask;
        }

        const res = await request(app)
          .post('/v1/transmittals')
          .set('Authorization', `Bearer ${docToken}`)
          .set('x-active-entity', 'ATA')
          .send(payload);

        expect(res.status).toBe(400);
        expect(res.body.detail).toBe('A valid linked task is required for transmittals');
      }
    });

    test('3.3 Assigned task creation succeeds (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1, // docUser is assigned!
          items: [{ description: 'BIR Stamped 1702 Form', quantity: 2 }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('Draft');
      expect(res.body.data.linked_task_id).toBe(TASK_ID_1);
    });

    test('3.4 Relinking to an unassigned task is rejected with 403 Forbidden', async () => {
      // First create valid transmittal
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          items: [{ description: 'BIR Form' }],
        });
      expect(createRes.status).toBe(201);
      const transmittalId = createRes.body.data.id;

      // Attempt to relink to TASK_ID_2 (where staffUser2 is assigned, docUser is NOT)
      const updateRes = await request(app)
        .put(`/v1/transmittals/${transmittalId}`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          linkedTaskId: TASK_ID_2,
        });

      expect(updateRes.status).toBe(403);
      expect(updateRes.body.detail).toBe('You are not assigned to this task');
    });

    test('3.5 Relinking attempting to clear linkedTaskId to null is rejected with 400 Bad Request', async () => {
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          items: [{ description: 'SEC General Information Sheet' }],
        });
      expect(createRes.status).toBe(201);
      const transmittalId = createRes.body.data.id;

      const clearRes = await request(app)
        .put(`/v1/transmittals/${transmittalId}`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          linkedTaskId: null,
        });

      expect(clearRes.status).toBe(400);
      expect(clearRes.body.detail).toBe('A valid linked task is required for transmittals');
    });

    test('3.6 Unassignment race condition: user unassigned between creation and send is rejected with 403 Forbidden', async () => {
      // 1. Documentation user creates transmittal while assigned
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          items: [{ description: 'Original Articles of Incorporation' }],
        });
      expect(createRes.status).toBe(201);
      const transmittalId = createRes.body.data.id;

      // 2. Transmittal has approved: true while remaining in Draft
      const existingRow = mockTables.transmittals.get(transmittalId);
      mockTables.transmittals.set(transmittalId, { ...existingRow, approved: true });

      // 3. User is unassigned from Task 1 (removed from task_assignees and tasks.assignee_id cleared)
      mockTables.task_assignees.delete(`${TASK_ID_1}:${docUser.id}`);
      const task = mockTables.tasks.get(TASK_ID_1);
      mockTables.tasks.set(TASK_ID_1, { ...task, assignee_id: null });

      // 4. Documentation user attempts to send
      const sendRes = await request(app)
        .post(`/v1/transmittals/${transmittalId}/send`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA');

      expect(sendRes.status).toBe(403);
      expect(sendRes.body.detail).toBe('You are not assigned to this task');
    });

    test('3.7 Unassignment race condition: user unassigned between creation and update is rejected with 403 Forbidden', async () => {
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_1,
          items: [{ description: 'Mayor Permit Assessment' }],
        });
      expect(createRes.status).toBe(201);
      const transmittalId = createRes.body.data.id;

      // User is unassigned from Task 1
      mockTables.task_assignees.delete(`${TASK_ID_1}:${docUser.id}`);
      const task = mockTables.tasks.get(TASK_ID_1);
      mockTables.tasks.set(TASK_ID_1, { ...task, assignee_id: null });

      // Documentation user attempts to update notes
      const updateRes = await request(app)
        .put(`/v1/transmittals/${transmittalId}`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          notes: 'Updated notes after unassignment',
        });

      expect(updateRes.status).toBe(403);
      expect(updateRes.body.detail).toBe('You are not assigned to this task');
    });

    test('3.8 Admin can create whole-project transmittal without task selection', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: null,
          items: [{ description: 'Whole project master docket' }],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.linked_task_id).toBeNull();
    });

    test('3.9 Cross-WR task hijacking probe: attempting to pair assigned task from WR 1 with foreign WR 2', async () => {
      // docUser is assigned to TASK_ID_1 (which belongs to WR_ID_1).
      // docUser is NOT a member of WR_ID_2.
      // Attempt to create a transmittal specifying workRequestId: WR_ID_2 but linkedTaskId: TASK_ID_1.
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_2,
          workRequestId: WR_ID_2,
          linkedTaskId: TASK_ID_1,
          items: [{ description: 'Cross-WR Hijack Attempt Docket' }],
        });

      // Must be strictly rejected because TASK_ID_1 does not belong to WR_ID_2
      expect(res.status).toBe(400);
      expect(res.body.detail).toBe(
        'Linked task does not belong to the specified work request'
      );
      const persisted = [...mockTables.transmittals.values()].some(
        (t) => t.work_request_id === WR_ID_2 && t.linked_task_id === TASK_ID_1
      );
      expect(persisted).toBe(false);
    });

    test('3.10 Cross-WR task hijacking: unassigned task from WR 2 is strictly blocked (403 Forbidden)', async () => {
      // docUser attempts to create transmittal under WR_ID_1 with TASK_ID_2 (from WR_ID_2, assigned to staffUser2)
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          clientId: CLIENT_ID_1,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_2,
          items: [{ description: 'Hijacked Task 2 Docket' }],
        });

      expect(res.status).toBe(403);
      expect(res.body.detail).toBe('You are not assigned to this task');
    });
  });

  // =========================================================================
  // VECTOR 4: Retainer template mutations & task template escalation attacks
  // =========================================================================
  describe('Vector 4: Retainer Templates & Task Templates Escalation Adversarial Probes', () => {
    let retainerTemplateId;

    beforeEach(() => {
      retainerTemplateId = '77777777-7777-7777-7777-777777777701';
      mockTables.retainer_templates.set(retainerTemplateId, {
        id: retainerTemplateId,
        entity_id: 'ent-ata',
        name: 'Standard Monthly Accounting Retainer',
        description: 'Monthly bookkeeping and tax compliance',
        client_id: CLIENT_ID_1,
        frequency: 'monthly',
        day_of_month: 1,
        is_active: true,
        deleted_at: null,
      });
    });

    test('4.1 Non-Manager staff cannot create, update, or delete retainer templates (403 Forbidden)', async () => {
      // Operations staff create attempt
      const createRes = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${opsToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          name: 'Unauthorized Ops Retainer',
          clientId: CLIENT_ID_1,
          frequency: 'monthly',
          dayOfMonth: 1,
        });
      expect(createRes.status).toBe(403);

      // Documentation staff update attempt
      const updateRes = await request(app)
        .put(`/v1/operations/templates/${retainerTemplateId}`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          name: 'Tampered Retainer by Doc',
        });
      expect(updateRes.status).toBe(403);

      // Accounting staff delete attempt
      const deleteRes = await request(app)
        .delete(`/v1/operations/templates/${retainerTemplateId}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('x-active-entity', 'ATA');
      expect(deleteRes.status).toBe(403);
    });

    test('4.2 Department-only Management staff (role Staff, dept Management) is rejected with 403 Forbidden', async () => {
      // deptMgmtStaffUser has departments: ['Management'] but role: 'Staff'
      const createRes = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${deptMgmtStaffToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          name: 'Dept Management Fake Escalation',
          clientId: CLIENT_ID_1,
          frequency: 'monthly',
          dayOfMonth: 1,
        });
      expect(createRes.status).toBe(403);

      const updateRes = await request(app)
        .put(`/v1/operations/templates/${retainerTemplateId}`)
        .set('Authorization', `Bearer ${deptMgmtStaffToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          name: 'Dept Management Update',
        });
      expect(updateRes.status).toBe(403);

      const deleteRes = await request(app)
        .delete(`/v1/operations/templates/${retainerTemplateId}`)
        .set('Authorization', `Bearer ${deptMgmtStaffToken}`)
        .set('x-active-entity', 'ATA');
      expect(deleteRes.status).toBe(403);
    });

    test('4.3 Role Manager has retainers:edit permission and can manage retainer templates', async () => {
      const createRes = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          name: 'Manager Authorized Retainer',
          clientId: CLIENT_ID_1,
          frequency: 'monthly',
          dayOfMonth: 5,
        });
      expect([200, 201]).toContain(createRes.status);

      const updateRes = await request(app)
        .put(`/v1/operations/templates/${retainerTemplateId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          name: 'Manager Renamed Retainer',
        });
      expect(updateRes.status).toBe(200);

      const deleteRes = await request(app)
        .delete(`/v1/operations/templates/${retainerTemplateId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA');
      expect([200, 204]).toContain(deleteRes.status);
    });

    test('4.4 Task Template Escalation: Manager is strictly blocked from Standard Task Templates (Admin-only)', async () => {
      // Manager attempts to create a standard task template
      const createRes = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          title: 'Escalated Standard Task',
          phase: 'execution',
        });
      expect(createRes.status).toBe(403);

      // Manager attempts to update a standard task template
      const updateRes = await request(app)
        .put('/v1/operations/task-templates/tpl-1')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          title: 'Escalated Task Update',
        });
      expect(updateRes.status).toBe(403);

      // Manager attempts to reset defaults
      const resetRes = await request(app)
        .post('/v1/operations/task-templates/reset-defaults')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('x-active-entity', 'ATA');
      expect(resetRes.status).toBe(403);
    });

    test('4.5 Standard Task Templates mutations are strictly Admin-only', async () => {
      // Non-manager staff
      const staffRes = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${staffUser1Token}`)
        .set('x-active-entity', 'ATA')
        .send({
          title: 'Staff Standard Task',
        });
      expect(staffRes.status).toBe(403);

      // Admin user
      const adminRes = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-active-entity', 'ATA')
        .send({
          title: 'Admin Created Standard Task',
          phase: 'execution',
          default_assignee_role: 'Operations',
        });
      expect([200, 201]).toContain(adminRes.status);
    });
  });
});
