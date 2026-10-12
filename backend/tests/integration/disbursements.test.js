/**
 * /v1/disbursements integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WORK_REQUEST_ID = '33333333-3333-3333-3333-333333333333';

const seedClient = () => {
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

const validDisbursement = {
  category: 'Transportation',
  description: 'Site visit transportation',
  amount: 1500,
  fundSource: 'Firm Fund',
  clientId: CLIENT_ID,
  linkedWorkRequestId: WORK_REQUEST_ID,
  dueDate: '2026-07-31',
  notes: 'Test disbursement',
};

describe('/v1/disbursements', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedClient();
  });

  it('creates a disbursement when user has disbursement:create', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDisbursement)
      .expect(201);

    expect(res.body.data.category).toBe('Transportation');
    expect(res.body.data.amount).toBe(1500);
    expect(res.body.data.status).toBe('Draft');
  });

  it('allows disbursement creation for any department (P0-A §3.2) — non-admin creates land in Pending for the P0-G approval gate', async () => {
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
      .send(validDisbursement)
      .expect(201);

    expect(res.body.data.status).toBe('Pending');
  });

  it('returns tab-badge counts scoped to the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const _created = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDisbursement)
      .expect(201);

    const counts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(counts.body.data.active).toBe(1);
    expect(counts.body.data.archived).toBe(0);
    expect(counts.body.data.rejected).toBe(0);

    // Seed a cancelled disbursement and a rejected pending change to verify
    // archived and rejected counters without relying on status endpoints.
    mockTables.disbursements.set('cancelled-disb', {
      id: 'cancelled-disb',
      entity_id: 'ent-ata',
      category: 'Meals',
      description: 'Cancelled expense',
      amount: 500,
      fund_source: 'Firm Fund',
      status: 'Cancelled',
      archived: false,
    });

    mockTables.pending_changes.set('rejected-pc', {
      id: 'rejected-pc',
      entity_id: 'ent-ata',
      table_name: 'disbursements',
      proposed_data: {},
      submitted_by: admin,
      status: 'rejected',
    });

    const afterSeed = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(afterSeed.body.data.active).toBe(1);
    expect(afterSeed.body.data.archived).toBe(1);
    expect(afterSeed.body.data.rejected).toBe(1);
  });

  it('creates and lists disbursement templates', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/disbursements/templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Monthly Transport',
        category: 'Transportation',
        amount: 1500,
        fundSource: 'Firm Fund',
        schedule: 'Monthly',
        description: 'Recurring monthly transport allowance',
      })
      .expect(201);

    const res = await request(app)
      .get('/v1/disbursements/templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Monthly Transport');
  });

  it('updates and deletes a disbursement template', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/disbursements/templates')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Stationery',
        category: 'Supplies',
        amount: 500,
      })
      .expect(201);

    const updated = await request(app)
      .put(`/v1/disbursements/templates/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ amount: 750 })
      .expect(200);

    expect(updated.body.data.amount).toBe(750);

    await request(app)
      .delete(`/v1/disbursements/templates/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);
  });

  it('creates a disbursement linked to a task and filters by linkedTaskId', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      title: 'Site Visit Task',
    });

    const created = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDisbursement, linkedTaskId: taskId })
      .expect(201);

    expect(created.body.data.linked_task_id).toBe(taskId);

    const list = await request(app)
      .get(`/v1/disbursements?linkedTaskId=${taskId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].linked_task_id).toBe(taskId);
  });

  it('returns awaitingRelease count only for users who can release', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    mockTables.disbursements.set('approved-disb', {
      id: 'approved-disb',
      entity_id: 'ent-ata',
      category: 'Meals',
      description: 'Approved expense',
      amount: 800,
      fund_source: 'Firm Fund',
      status: 'Approved',
      archived: false,
    });

    const adminCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(adminCounts.body.data.awaitingRelease).toBe(1);

    const ops = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const opsCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(opsCounts.body.data.awaitingRelease).toBe(0);
  });

  it('soft deletes a disbursement', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDisbursement)
      .expect(201);

    await request(app)
      .delete(`/v1/disbursements/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);

    await request(app)
      .get(`/v1/disbursements/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);
  });

  it('enforces role-based visibility restrictions on disbursements', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const OPS_USER_ID = '55555555-5555-5555-5555-555555555555';
    const ops = registerUser({
      id: OPS_USER_ID,
      email: 'ops@ata-lta.ph',
      name: 'Ops',
      role: 'Operations',
      entities: ['ATA'],
    });

    mockTables.tasks.set('task-ops-list', {
      id: 'task-ops-list',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: OPS_USER_ID,
      deleted_at: null,
    });

    // Create a draft disbursement
    const draftRes = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDisbursement, category: 'DraftCategory' })
      .expect(201);

    // Create a released disbursement
    const releasedRes = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDisbursement, category: 'ReleasedCategory' })
      .expect(201);

    // Hardcode status Released for the second disbursement
    mockTables.disbursements.get(releasedRes.body.data.id).status = 'Released';

    // 1. Admin lists disbursements -> sees both
    const adminList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(adminList.body.data.some((d) => d.category === 'DraftCategory')).toBe(true);
    expect(adminList.body.data.some((d) => d.category === 'ReleasedCategory')).toBe(true);

    // 2. Ops lists disbursements -> sees only Released
    const opsList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsList.body.data.some((d) => d.category === 'DraftCategory')).toBe(false);
    expect(opsList.body.data.some((d) => d.category === 'ReleasedCategory')).toBe(true);

    // 3. Ops tries to fetch draft disbursement directly -> 403 Forbidden
    await request(app)
      .get(`/v1/disbursements/${draftRes.body.data.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);

    // 4. Ops gets counts -> count does not include draft/pending
    const opsCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsCounts.body.data.active).toBe(1); // Only the Released one

    // 5. Admin gets counts -> count includes both
    const adminCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(adminCounts.body.data.active).toBe(2);
  });

  it('supports linking a transmittal to a disbursement on create, update, and filtering by linkedTransmittalId', async () => {
    const admin = registerUser({
      email: 'admin-disb-transmittal@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const TRANSMITTAL_ID = '66666666-6666-6666-6666-666666666666';
    const TRANSMITTAL_ID_2 = '77777777-7777-7777-7777-777777777777';

    mockTables.transmittals.set(TRANSMITTAL_ID, {
      id: TRANSMITTAL_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WORK_REQUEST_ID,
      tracking_number: 'ATA-TR-2026-0002',
      status: 'Sent',
    });

    // 1. Create disbursement with linkedTransmittalId
    const createRes = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        ...validDisbursement,
        category: 'TransmittalExpense',
        linkedTransmittalId: TRANSMITTAL_ID,
      })
      .expect(201);

    expect(createRes.body.data.linked_transmittal_id).toBe(TRANSMITTAL_ID);

    // 2. Create another disbursement without transmittal link
    await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        ...validDisbursement,
        category: 'NoTransmittalExpense',
      })
      .expect(201);

    // 3. Filter disbursements by linkedTransmittalId
    const filterRes = await request(app)
      .get(`/v1/disbursements?linkedTransmittalId=${TRANSMITTAL_ID}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(filterRes.body.data.length).toBe(1);
    expect(filterRes.body.data[0].category).toBe('TransmittalExpense');

    // 4. Update disbursement to change linkedTransmittalId
    const updateRes = await request(app)
      .put(`/v1/disbursements/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        linkedTransmittalId: TRANSMITTAL_ID_2,
      })
      .expect(200);

    expect(updateRes.body.data.linked_transmittal_id).toBe(TRANSMITTAL_ID_2);
  });

  it('allows non-admin creator and employee to view their own Draft/Pending disbursements (Task A.9)', async () => {
    const creatorId = 'creator-user-1111';
    const employeeId = 'employee-user-2222';
    const otherId = 'other-user-3333';

    const creatorToken = registerUser({
      id: creatorId,
      email: 'creator@ata-lta.ph',
      name: 'Creator User',
      role: 'Operations',
      entities: ['ATA'],
    });

    const employeeToken = registerUser({
      id: employeeId,
      email: 'employee@ata-lta.ph',
      name: 'Employee User',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const otherToken = registerUser({
      id: otherId,
      email: 'other@ata-lta.ph',
      name: 'Other User',
      role: 'Operations',
      entities: ['ATA'],
    });

    // Make sure all users are concerned with WORK_REQUEST_ID
    mockTables.tasks.set('task-creator', {
      id: 'task-creator',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: creatorId,
      deleted_at: null,
    });
    mockTables.tasks.set('task-employee', {
      id: 'task-employee',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: employeeId,
      deleted_at: null,
    });
    mockTables.tasks.set('task-other', {
      id: 'task-other',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: otherId,
      deleted_at: null,
    });

    // Seed 1: Draft created by creatorId
    mockTables.disbursements.set('disb-draft-creator', {
      id: 'disb-draft-creator',
      entity_id: 'ent-ata',
      category: 'Supplies',
      description: 'Creator draft supplies',
      amount: 100,
      fund_source: 'Firm Fund',
      status: 'Draft',
      created_by: creatorId,
      employee_id: null,
      linked_work_request_id: WORK_REQUEST_ID,
      archived: false,
    });

    // Seed 2: Pending where employee is employeeId
    mockTables.disbursements.set('disb-pending-employee', {
      id: 'disb-pending-employee',
      entity_id: 'ent-ata',
      category: 'Travel',
      description: 'Employee pending travel',
      amount: 250,
      fund_source: 'Firm Fund',
      status: 'Pending',
      created_by: 'some-other-person',
      employee_id: employeeId,
      linked_work_request_id: WORK_REQUEST_ID,
      archived: false,
    });

    // 1. Creator listing Draft status sees their draft disbursement
    const creatorListDraft = await request(app)
      .get('/v1/disbursements?status=Draft')
      .set('Authorization', `Bearer ${creatorToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(creatorListDraft.body.data.some((d) => d.id === 'disb-draft-creator')).toBe(true);

    // 2. Creator listing without status filter sees their draft disbursement
    const creatorListAll = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${creatorToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(creatorListAll.body.data.some((d) => d.id === 'disb-draft-creator')).toBe(true);
    expect(creatorListAll.body.data.some((d) => d.id === 'disb-pending-employee')).toBe(false);

    // 3. Employee listing Pending status sees disbursement where they are employee_id
    const empListPending = await request(app)
      .get('/v1/disbursements?status=Pending')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(empListPending.body.data.some((d) => d.id === 'disb-pending-employee')).toBe(true);

    // 4. Employee can fetch their disbursement directly by ID (isSelf via employee_id)
    const empGetRes = await request(app)
      .get('/v1/disbursements/disb-pending-employee')
      .set('Authorization', `Bearer ${employeeToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(empGetRes.body.data.id).toBe('disb-pending-employee');

    // 5. Other user listing Draft or Pending cannot see creator's or employee's disbursement
    const otherListDraft = await request(app)
      .get('/v1/disbursements?status=Draft')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(otherListDraft.body.data.some((d) => d.id === 'disb-draft-creator')).toBe(false);

    // 6. Other user cannot fetch employee's pending disbursement directly
    await request(app)
      .get('/v1/disbursements/disb-pending-employee')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);
  });

  describe('Parcel A: Backend Lifecycle & Governance (Tasks A.1, A.4, A.5)', () => {
    it('Task A.1: Entity resolution Step 4 resolves disbursement entity in ALL entity mode', async () => {
      const admin = registerUser({
        email: 'admin-disb-all@ata-lta.ph',
        name: 'Admin Disb All',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      // Seed an LTA disbursement
      const LTA_DISB_ID = '88888888-dddd-eeee-ffff-222222222222';
      mockTables.disbursements.set(LTA_DISB_ID, {
        id: LTA_DISB_ID,
        entity_id: 'ent-lta',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        disbursement_number: 'DISB-LTA-2026-ALL',
        category: 'Supplies',
        description: 'LTA special stationery',
        amount: 2200,
        fund_source: 'Firm Fund',
        status: 'Draft',
        archived: false,
      });

      // PUT /v1/disbursements/:id with X-Active-Entity: ALL
      const res = await request(app)
        .put(`/v1/disbursements/${LTA_DISB_ID}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ALL')
        .send({ notes: 'Updated LTA disb in ALL mode' })
        .expect(200);

      expect(res.body.data.notes).toBe('Updated LTA disb in ALL mode');
      expect(res.body.data.entity_id).toBe('ent-lta');
    });

    it('Task A.4: enrichDisbursementExtras resolves linked work request and human-readable names', async () => {
      const admin = registerUser({
        email: 'admin-enrich@ata-lta.ph',
        name: 'Admin Enrich',
        role: 'Admin',
        entities: ['ATA'],
      });

      const EMP_ID = 'emp-user-1111';
      const REQ_ID = 'req-user-2222';
      const CRE_ID = 'cre-user-3333';
      const APP_ID = 'app-user-4444';
      const REL_ID = 'rel-user-5555';
      const REJ_ID = 'rej-user-6666';

      mockTables.users.set(EMP_ID, { id: EMP_ID, name: 'Employee Juan' });
      mockTables.users.set(REQ_ID, { id: REQ_ID, name: 'Requester Pedro' });
      mockTables.users.set(CRE_ID, { id: CRE_ID, name: 'Creator Clara' });
      mockTables.users.set(APP_ID, { id: APP_ID, name: 'Approver Maria' });
      mockTables.users.set(REL_ID, { id: REL_ID, name: 'Releaser Carlos' });
      mockTables.users.set(REJ_ID, { id: REJ_ID, name: 'Rejecter Sofia' });

      const WR_ENRICH_ID = 'wr-enrich-5555';
      mockTables.work_requests.set(WR_ENRICH_ID, {
        id: WR_ENRICH_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        title: 'Manila Office Setup',
        work_order_number: 'WO-2026-MNL-01',
      });

      const DISB_ENRICH_ID = 'disb-enrich-7777';
      mockTables.disbursements.set(DISB_ENRICH_ID, {
        id: DISB_ENRICH_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WR_ENRICH_ID,
        disbursement_number: 'DISB-ATA-2026-ENRICH',
        category: 'Supplies',
        description: 'Full audit supplies',
        amount: 8800,
        fund_source: 'Firm Fund',
        status: 'Released',
        employee_id: EMP_ID,
        requested_by: REQ_ID,
        created_by: CRE_ID,
        approved_by: APP_ID,
        released_by: REL_ID,
        rejected_by: REJ_ID,
        notes: 'Sample notes',
        archived: false,
      });

      // 1. Check getDisbursementById
      const getRes = await request(app)
        .get(`/v1/disbursements/${DISB_ENRICH_ID}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(getRes.body.data.linked_work_request_name).toBe('Manila Office Setup');
      expect(getRes.body.data.linked_work_request_order_number).toBe('WO-2026-MNL-01');
      expect(getRes.body.data.employee_name).toBe('Employee Juan');
      expect(getRes.body.data.requested_by_name).toBe('Requester Pedro');
      expect(getRes.body.data.created_by_name).toBe('Creator Clara');
      expect(getRes.body.data.approved_by_name).toBe('Approver Maria');
      expect(getRes.body.data.released_by_name).toBe('Releaser Carlos');
      expect(getRes.body.data.rejected_by_name).toBe('Rejecter Sofia');
      expect(getRes.body.data.edited_by_accounting).toBe(false);

      // 2. Check listDisbursements
      const listRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const found = listRes.body.data.find((d) => d.id === DISB_ENRICH_ID);
      expect(found).toBeDefined();
      expect(found.linked_work_request_name).toBe('Manila Office Setup');
      expect(found.linked_work_request_order_number).toBe('WO-2026-MNL-01');
      expect(found.employee_name).toBe('Employee Juan');
    });

    it('Task A.5: Standard 5-stage lifecycle transitions (Draft -> Submitted -> Pending Admin Approval -> Released -> Funded)', async () => {
      const admin = registerUser({
        email: 'admin-lifecycle@ata-lta.ph',
        name: 'Admin Lifecycle',
        role: 'Admin',
        entities: ['ATA'],
      });

      // 1. Create Draft disbursement
      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursement)
        .expect(201);

      const disbId = createRes.body.data.id;
      expect(createRes.body.data.status).toBe('Draft');

      // 2. submit: Draft -> Submitted
      const submitRes = await request(app)
        .post(`/v1/disbursements/${disbId}/submit`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(submitRes.body.data.status).toBe('Submitted');

      // 3. forward_admin: Submitted -> Pending Admin Approval
      const forwardRes = await request(app)
        .post(`/v1/disbursements/${disbId}/forward_admin`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(forwardRes.body.data.status).toBe('Pending Admin Approval');

      // 4. approve: Pending Admin Approval -> Released
      const approveRes = await request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(approveRes.body.data.status).toBe('Released');

      // 5. fund: Released -> Funded
      const fundRes = await request(app)
        .post(`/v1/disbursements/${disbId}/fund`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(fundRes.body.data.status).toBe('Funded');
    });

    it('Task A.5: Accounting staff can reject a voucher with reason', async () => {
      const accountingToken = registerUser({
        email: 'jen.andoga@ata-lta.ph',
        name: 'Jen Andoga',
        role: 'Accounting',
        entities: ['ATA'],
      });

      // Seed a submitted disbursement
      const DISB_TO_REJECT = 'disb-reject-9999';
      mockTables.disbursements.set(DISB_TO_REJECT, {
        id: DISB_TO_REJECT,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        disbursement_number: 'DISB-ATA-2026-REJ-01',
        category: 'Meals',
        description: 'Team dinner',
        amount: 3200,
        fund_source: 'Firm Fund',
        status: 'Submitted',
        archived: false,
      });

      const res = await request(app)
        .post(`/v1/disbursements/${DISB_TO_REJECT}/reject`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason: 'Duplicate meal reimbursement claim' })
        .expect(200);

      expect(res.body.data.status).toBe('Rejected');
      expect(res.body.data.rejection_reason).toBe('Duplicate meal reimbursement claim');
    });

    it('Task A.5: Accounting staff modifying financial details prepends notes and sets edited_by_accounting: true', async () => {
      const accountingToken = registerUser({
        email: 'jen.andoga@ata-lta.ph',
        name: 'Jen Andoga',
        role: 'Accounting',
        entities: ['ATA'],
      });

      // Seed a Pending voucher
      const DISB_EDIT_ID = 'disb-edit-accounting-8888';
      mockTables.disbursements.set(DISB_EDIT_ID, {
        id: DISB_EDIT_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        disbursement_number: 'DISB-ATA-2026-EDIT-01',
        category: 'Transportation',
        description: 'Grab fare to SEC',
        amount: 450,
        fund_source: 'Firm Fund',
        status: 'Pending',
        notes: 'Original requester note',
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${DISB_EDIT_ID}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          amount: 500,
          category: 'Miscellaneous',
          notes: 'Adjusted per official receipt',
        })
        .expect(200);

      expect(res.body.data.amount).toBe(500);
      expect(res.body.data.category).toBe('Miscellaneous');
      expect(res.body.data.edited_by_accounting).toBe(true);
      expect(res.body.data.notes).toContain('[Edited by Accounting on ');
      expect(res.body.data.notes).toContain('by Jen Andoga]');
      expect(res.body.data.notes).toContain('Adjusted per official receipt');
    });
  });
});
