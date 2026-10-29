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
const TASK_ID = '44444444-4444-4444-4444-444444444444';

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
  mockTables.tasks.set(TASK_ID, {
    id: TASK_ID,
    work_request_id: WORK_REQUEST_ID,
    title: 'Acme Disbursement Task',
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
  linkedTaskId: TASK_ID,
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
    const docUserId = 'doc-user-disb-1';
    const token = registerUser({
      id: docUserId,
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });
    mockTables.tasks.get(TASK_ID).assignee_id = docUserId;

    const res = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDisbursement)
      .expect(201);

    expect(res.body.data.status).toBe('Draft');
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

    mockTables.disbursements.set('rejected-disb', {
      id: 'rejected-disb',
      entity_id: 'ent-ata',
      category: 'Meals',
      description: 'Rejected expense',
      amount: 500,
      fund_source: 'Firm Fund',
      status: 'Rejected',
      archived: false,
    });

    const afterSeed = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(afterSeed.body.data.active).toBe(2);
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

    mockTables.disbursements.set('funded-disb', {
      id: 'funded-disb',
      entity_id: 'ent-ata',
      category: 'Meals',
      description: 'Funded expense',
      amount: 800,
      fund_source: 'Firm Fund',
      status: 'Funded',
      lifecycle_version: 2,
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
      .send({ expectedVersion: 1 })
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

    const OPS_WR_ID = '66666666-6666-6666-6666-666666666666';
    mockTables.work_requests.set(OPS_WR_ID, {
      id: OPS_WR_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Ops WR',
      status: 'In Progress',
      assigned_to: OPS_USER_ID,
    });

    // Create a draft disbursement on WORK_REQUEST_ID (where ops is not assigned)
    const draftRes = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDisbursement, category: 'DraftCategory' })
      .expect(201);

    // Create a released disbursement on WORK_REQUEST_ID
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

    // 2. Ops lists disbursements -> cannot see either because Ops is an outsider to WORK_REQUEST_ID
    const opsList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsList.body.data.some((d) => d.category === 'DraftCategory')).toBe(false);
    expect(opsList.body.data.some((d) => d.category === 'ReleasedCategory')).toBe(false);

    // 3. Ops tries to fetch draft disbursement directly -> 403 Forbidden
    await request(app)
      .get(`/v1/disbursements/${draftRes.body.data.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);

    // 3b. Ops tries to fetch released disbursement directly -> 403 Forbidden
    await request(app)
      .get(`/v1/disbursements/${releasedRes.body.data.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);

    // 4. Ops gets counts -> 0 active because Ops is not assigned to any projects with active disbursements
    const opsCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsCounts.body.data.active).toBe(0);

    // 5. Admin gets counts -> count includes both created by admin
    const adminCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(adminCounts.body.data.active).toBe(2);

    // 6. Ops creates their own disbursement on OPS_WR_ID -> Ops can see own disbursement and count is 1
    const opsTaskId = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';
    mockTables.tasks.set(opsTaskId, {
      id: opsTaskId,
      work_request_id: OPS_WR_ID,
      title: 'Ops Task',
      status: 'In Progress',
      assignee_id: OPS_USER_ID,
    });

    const opsCreatedRes = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validDisbursement, linkedWorkRequestId: OPS_WR_ID, linkedTaskId: opsTaskId, category: 'OpsCategory' })
      .expect(201);

    const opsListAfter = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsListAfter.body.data.some((d) => d.category === 'OpsCategory')).toBe(true);
    expect(opsListAfter.body.data.some((d) => d.category === 'ReleasedCategory')).toBe(false);

    const opsGetOwn = await request(app)
      .get(`/v1/disbursements/${opsCreatedRes.body.data.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsGetOwn.body.data.id).toBe(opsCreatedRes.body.data.id);

    const opsCountsAfter = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsCountsAfter.body.data.active).toBe(1);
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

    mockTables.transmittals.set(TRANSMITTAL_ID_2, {
      id: TRANSMITTAL_ID_2,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WORK_REQUEST_ID,
      tracking_number: 'ATA-TR-2026-0003',
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
        expectedVersion: 1,
      })
      .expect(200);

    expect(updateRes.body.data.linked_transmittal_id).toBe(TRANSMITTAL_ID_2);
  });

  it('enforces 360 project team visibility for non-admin users (Draft/Pending readable to teammates, denied to outsiders)', async () => {
    const creatorId = '00000000-0000-4000-a000-000000000701';
    const teammateId = '00000000-0000-4000-a000-000000000702';
    const outsiderId = '00000000-0000-4000-a000-000000000703';

    const creatorToken = registerUser({
      id: creatorId,
      email: 'creator@ata-lta.ph',
      name: 'Creator User',
      role: 'Operations',
      entities: ['ATA'],
    });

    const teammateToken = registerUser({
      id: teammateId,
      email: 'teammate@ata-lta.ph',
      name: 'Teammate User',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const outsiderToken = registerUser({
      id: outsiderId,
      email: 'outsider@ata-lta.ph',
      name: 'Outsider User',
      role: 'Operations',
      entities: ['ATA'],
    });

    // creator and teammate are both on WORK_REQUEST_ID
    mockTables.tasks.set('00000000-0000-4000-a000-000000000711', {
      id: '00000000-0000-4000-a000-000000000711',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: creatorId,
      deleted_at: null,
    });
    mockTables.tasks.set('00000000-0000-4000-a000-000000000712', {
      id: '00000000-0000-4000-a000-000000000712',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: teammateId,
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

    // Seed 2: Pending created by someone else
    mockTables.disbursements.set('disb-pending-other', {
      id: 'disb-pending-other',
      entity_id: 'ent-ata',
      category: 'Travel',
      description: 'Pending travel',
      amount: 250,
      fund_source: 'Firm Fund',
      status: 'Pending',
      created_by: '00000000-0000-4000-a000-000000000999',
      requested_by: teammateId,
      employee_id: teammateId,
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

    // 2. Teammate CAN see both Draft and Pending on their project (F05, F07)
    const teammateListAll = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${teammateToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(teammateListAll.body.data.some((d) => d.id === 'disb-draft-creator')).toBe(true);
    expect(teammateListAll.body.data.some((d) => d.id === 'disb-pending-other')).toBe(true);

    // 3. Teammate can fetch Draft and Pending disbursements directly
    await request(app)
      .get('/v1/disbursements/disb-draft-creator')
      .set('Authorization', `Bearer ${teammateToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    await request(app)
      .get('/v1/disbursements/disb-pending-other')
      .set('Authorization', `Bearer ${teammateToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    // 4. Outsider cannot see Draft or Pending in list
    const outsiderList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(outsiderList.body.data.some((d) => d.id === 'disb-draft-creator')).toBe(false);
    expect(outsiderList.body.data.some((d) => d.id === 'disb-pending-other')).toBe(false);

    // 5. Outsider direct fetch is denied (403 Forbidden)
    await request(app)
      .get('/v1/disbursements/disb-draft-creator')
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);
    await request(app)
      .get('/v1/disbursements/disb-pending-other')
      .set('Authorization', `Bearer ${outsiderToken}`)
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
        client_id: null,
        linked_work_request_id: null,
        disbursement_number: 'DISB-LTA-2026-ALL',
        category: 'Supplies',
        description: 'LTA special stationery',
        amount: 2200,
        fund_source: 'Firm Fund',
        status: 'Draft',
        archived: false,
        lifecycle_version: 2,
        review_ready: true,
        version: 1,
      });

      // PUT /v1/disbursements/:id with X-Active-Entity: ALL
      const res = await request(app)
        .put(`/v1/disbursements/${LTA_DISB_ID}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ALL')
        .send({ notes: 'Updated LTA disb in ALL mode', expectedVersion: 1 })
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

      const EMP_ID = '00000000-0000-4000-a000-000000000111';
      const REQ_ID = '00000000-0000-4000-a000-000000000222';
      const CRE_ID = '00000000-0000-4000-a000-000000000333';
      const APP_ID = '00000000-0000-4000-a000-000000000444';
      const REL_ID = '00000000-0000-4000-a000-000000000555';
      const REJ_ID = '00000000-0000-4000-a000-000000000666';

      mockTables.users.set(EMP_ID, { id: EMP_ID, name: 'Employee Juan' });
      mockTables.users.set(REQ_ID, { id: REQ_ID, name: 'Requester Pedro' });
      mockTables.users.set(CRE_ID, { id: CRE_ID, name: 'Creator Clara' });
      mockTables.users.set(APP_ID, { id: APP_ID, name: 'Approver Maria' });
      mockTables.users.set(REL_ID, { id: REL_ID, name: 'Releaser Carlos' });
      mockTables.users.set(REJ_ID, { id: REJ_ID, name: 'Rejecter Sofia' });

      const WR_ENRICH_ID = '00000000-0000-4000-a000-000000000888';
      mockTables.work_requests.set(WR_ENRICH_ID, {
        id: WR_ENRICH_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        title: 'Manila Office Setup',
        work_order_number: 'WO-2026-MNL-01',
      });

      const DISB_ENRICH_ID = '00000000-0000-4000-a000-000000000999';
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

    it('Task A.5: Standard canonical lifecycle transitions (Draft -> Approved -> Funded -> Released)', async () => {
      const admin = registerUser({
        email: 'admin-lifecycle@ata-lta.ph',
        name: 'Admin Lifecycle',
        role: 'Admin',
        entities: ['ATA'],
      });

      const staffUserId = '00000000-0000-4000-a000-000000000551';
      const staff = registerUser({
        id: staffUserId,
        email: 'staff-lifecycle@ata-lta.ph',
        name: 'Staff Lifecycle',
        role: 'Operations',
        entities: ['ATA'],
      });

      const acctUserId = '00000000-0000-4000-a000-000000000552';
      const accounting = registerUser({
        id: acctUserId,
        email: 'accounting-lifecycle@ata-lta.ph',
        name: 'Accounting Lifecycle',
        role: 'Accounting',
        entities: ['ATA'],
      });

      mockTables.work_requests.get(WORK_REQUEST_ID).assigned_to = staffUserId;
      mockTables.work_requests.get(WORK_REQUEST_ID).co_assignees = [acctUserId];
      mockTables.tasks.get(TASK_ID).assignee_id = staffUserId;

      // 1. Create Draft disbursement
      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${staff}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursement)
        .expect(201);

      const disbId = createRes.body.data.id;
      expect(createRes.body.data.status).toBe('Draft');

      // 2. approve: Draft -> Approved (Admin only)
      const approveRes = await request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 1,
        })
        .expect(200);

      expect(approveRes.body.data.status).toBe('Approved');

      // 3. fund: Approved -> Funded (Accounting)
      const fundRes = await request(app)
        .post(`/v1/disbursements/${disbId}/fund`)
        .set('Authorization', `Bearer ${accounting}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Bank Transfer',
          bank: 'BDO',
          reference: 'REF-A5-BDO',
          date: '2026-10-20',
          expectedVersion: 2,
        })
        .expect(200);

      expect(fundRes.body.data.status).toBe('Funded');

      // 4. release: Funded -> Released (Admin, non-preparer)
      const releaseRes = await request(app)
        .post(`/v1/disbursements/${disbId}/release`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          expectedVersion: 3,
        })
        .expect(200);

      expect(releaseRes.body.data.status).toBe('Released');
    });

    it('Task A.5: Admin can reject a voucher with reason', async () => {
      const adminToken = registerUser({
        email: 'admin.rej@ata-lta.ph',
        name: 'Admin Rejection',
        role: 'Admin',
        entities: ['ATA'],
      });

      // Seed a draft disbursement
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
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        archived: false,
        version: 1,
      });

      const res = await request(app)
        .post(`/v1/disbursements/${DISB_TO_REJECT}/reject`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ reason: 'Duplicate meal reimbursement claim', expectedVersion: 1 })
        .expect(200);

      expect(res.body.data.status).toBe('Rejected');
      expect(res.body.data.rejection_reason).toBe('Duplicate meal reimbursement claim');
    });

    it('Task A.5: Accounting staff modifying financial details prepends notes and sets edited_by_accounting: true', async () => {
      const jenId = '00000000-0000-4000-a000-000000000777';
      const accountingToken = registerUser({
        id: jenId,
        email: 'jen.andoga@ata-lta.ph',
        name: 'Jen Andoga',
        role: 'Accounting',
        entities: ['ATA'],
      });
      mockTables.work_requests.get(WORK_REQUEST_ID).assigned_to = jenId;
      mockTables.tasks.get(TASK_ID).assignee_id = jenId;

      // Seed a Draft voucher
      const DISB_EDIT_ID = 'disb-edit-accounting-8888';
      mockTables.disbursements.set(DISB_EDIT_ID, {
        id: DISB_EDIT_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        task_id: TASK_ID,
        linked_task_id: TASK_ID,
        disbursement_number: 'DISB-ATA-2026-EDIT-01',
        category: 'Transportation',
        description: 'Grab fare to SEC',
        amount: 450,
        fund_source: 'Firm Fund',
        status: 'Draft',
        lifecycle_version: 2,
        review_ready: true,
        notes: 'Original requester note',
        archived: false,
        version: 1,
      });

      const res = await request(app)
        .put(`/v1/disbursements/${DISB_EDIT_ID}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          amount: 500,
          category: 'Miscellaneous',
          notes: 'Adjusted per official receipt',
          expectedVersion: 1,
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

  describe('360° Project Team Visibility Authorization Suite', () => {
    it('returns 401 Unauthorized when requesting GET /:id without authentication', async () => {
      const DISB_ID = 'disb-unauth-check';
      mockTables.disbursements.set(DISB_ID, {
        id: DISB_ID,
        entity_id: 'ent-ata',
        category: 'Supplies',
        description: 'Unauth check',
        amount: 100,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: 'some-creator',
        archived: false,
      });

      await request(app)
        .get(`/v1/disbursements/${DISB_ID}`)
        .expect(401);
    });

    it('unlinked/orphan disbursement with null linked_work_request_id is denied to non-admin creator (404 Not Found)', async () => {
      const creatorId = '00000000-0000-4000-a000-000000000661';
      const creatorToken = registerUser({
        id: creatorId,
        email: 'creator-nowr@ata-lta.ph',
        name: 'Creator No WR',
        role: 'Operations',
        entities: ['ATA'],
      });

      const DISB_ID = 'disb-nowr-1234';
      mockTables.disbursements.set(DISB_ID, {
        id: DISB_ID,
        entity_id: 'ent-ata',
        category: 'Office',
        description: 'Personal office expense without WR',
        amount: 85,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: creatorId,
        linked_work_request_id: null,
        archived: false,
      });

      // Non-admin creator is denied (orphan records fail closed)
      await request(app)
        .get(`/v1/disbursements/${DISB_ID}`)
        .set('Authorization', `Bearer ${creatorToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(404);

      const listRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${creatorToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(listRes.body.data.some((d) => d.id === DISB_ID)).toBe(false);

      // Positive control: Admin can still view unlinked records
      const adminToken = registerUser({
        email: 'admin-nowr@ata-lta.ph',
        name: 'Admin',
        role: 'Admin',
        entities: ['ATA'],
      });
      const adminRes = await request(app)
        .get(`/v1/disbursements/${DISB_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(adminRes.body.data.id).toBe(DISB_ID);
    });

    it('allows project teammates to view Draft and Released disbursements linked to their work request', async () => {
      const managerId = '00000000-0000-4000-a000-000000000662';
      const managerToken = registerUser({
        id: managerId,
        email: 'manager@ata-lta.ph',
        name: 'Manager User',
        role: 'Manager',
        entities: ['ATA'],
      });

      mockTables.work_requests.get(WORK_REQUEST_ID).co_assignees = [managerId];

      const DISB_DRAFT = 'disb-manager-test-draft';
      const DISB_RELEASED = 'disb-manager-test-released';

      mockTables.disbursements.set(DISB_DRAFT, {
        id: DISB_DRAFT,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        category: 'Supplies',
        description: 'Staff draft',
        amount: 200,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: '00000000-0000-4000-a000-000000000663',
        archived: false,
      });

      mockTables.disbursements.set(DISB_RELEASED, {
        id: DISB_RELEASED,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        category: 'Travel',
        description: 'Staff released',
        amount: 300,
        fund_source: 'Firm Fund',
        status: 'Released',
        created_by: '00000000-0000-4000-a000-000000000663',
        archived: false,
      });

      const draftRes = await request(app)
        .get(`/v1/disbursements/${DISB_DRAFT}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(draftRes.body.data.id).toBe(DISB_DRAFT);

      const releasedRes = await request(app)
        .get(`/v1/disbursements/${DISB_RELEASED}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(releasedRes.body.data.id).toBe(DISB_RELEASED);

      const listRes = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(listRes.body.data.some((d) => d.id === DISB_DRAFT)).toBe(true);
      expect(listRes.body.data.some((d) => d.id === DISB_RELEASED)).toBe(true);
    });

    it('denies outsider access across Funded and Rejected statuses (403 Forbidden)', async () => {
      const staffToken = registerUser({
        id: '00000000-0000-4000-a000-000000000664',
        email: 'staff-outsider@ata-lta.ph',
        name: 'Staff Outsider User',
        role: 'Operations',
        entities: ['ATA'],
      });

      const DISB_FUNDED = 'disb-check-funded';
      const DISB_REJECTED = 'disb-check-rejected';

      mockTables.disbursements.set(DISB_FUNDED, {
        id: DISB_FUNDED,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        category: 'Supplies',
        description: 'Funded supplies',
        amount: 400,
        fund_source: 'Firm Fund',
        status: 'Funded',
        created_by: 'original-creator-id',
        archived: false,
      });

      mockTables.disbursements.set(DISB_REJECTED, {
        id: DISB_REJECTED,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        category: 'Supplies',
        description: 'Rejected supplies',
        amount: 400,
        fund_source: 'Firm Fund',
        status: 'Rejected',
        created_by: 'original-creator-id',
        archived: false,
      });

      await request(app)
        .get(`/v1/disbursements/${DISB_FUNDED}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      await request(app)
        .get(`/v1/disbursements/${DISB_REJECTED}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);
    });

    it('denies Accounting user without project assignment (403 Forbidden) and allows assigned Accounting user (200 OK)', async () => {
      const outsiderAcctToken = registerUser({
        id: '00000000-0000-4000-a000-000000000665',
        email: 'acct-outsider@ata-lta.ph',
        name: 'Acct Outsider User',
        role: 'Accounting',
        entities: ['ATA'],
      });

      const assignedAcctId = '00000000-0000-4000-a000-000000000666';
      const assignedAcctToken = registerUser({
        id: assignedAcctId,
        email: 'acct-assigned@ata-lta.ph',
        name: 'Acct Assigned User',
        role: 'Accounting',
        entities: ['ATA'],
      });

      mockTables.work_requests.get(WORK_REQUEST_ID).assigned_to = assignedAcctId;

      const DISB_ID = 'disb-for-acct-check';
      mockTables.disbursements.set(DISB_ID, {
        id: DISB_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        linked_work_request_id: WORK_REQUEST_ID,
        category: 'Travel',
        description: 'Check by accounting',
        amount: 350,
        fund_source: 'Firm Fund',
        status: 'Draft',
        created_by: 'someone-else',
        archived: false,
      });

      // Outsider accounting is denied
      await request(app)
        .get(`/v1/disbursements/${DISB_ID}`)
        .set('Authorization', `Bearer ${outsiderAcctToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      // Assigned accounting is authorized
      const res = await request(app)
        .get(`/v1/disbursements/${DISB_ID}`)
        .set('Authorization', `Bearer ${assignedAcctToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.id).toBe(DISB_ID);
    });
  });

  describe('Disbursement ↔ Invoice & Transmittal Connectivity (SOP Alignment)', () => {
    const INVOICE_ID = '99999999-1111-4111-8111-111111111111';
    const TRANSMITTAL_ID = '99999999-2222-4222-8222-222222222222';
    const OTHER_WR_ID = '99999999-3333-4333-8333-333333333333';
    const OTHER_WR_INVOICE_ID = '99999999-4444-4444-8444-444444444444';

    beforeEach(() => {
      mockTables.invoices.set(INVOICE_ID, {
        id: INVOICE_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WORK_REQUEST_ID,
        invoice_number: 'INV-ATA-2026-0088',
        status: 'Partially Paid',
        total: 15000,
        amount_paid: 5000,
        balance: 10000,
        due_date: '2026-11-30',
        deleted_at: null,
      });

      mockTables.transmittals.set(TRANSMITTAL_ID, {
        id: TRANSMITTAL_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WORK_REQUEST_ID,
        tracking_number: 'TR-ATA-2026-0042',
        status: 'Sent',
        recipient_name: 'BIR RDO 044',
        approved: true,
        deleted_at: null,
      });

      mockTables.work_requests.set(OTHER_WR_ID, {
        id: OTHER_WR_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        title: 'Other Work Request',
        status: 'In Progress',
      });

      mockTables.invoices.set(OTHER_WR_INVOICE_ID, {
        id: OTHER_WR_INVOICE_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: OTHER_WR_ID,
        invoice_number: 'INV-ATA-2026-OTHER',
        status: 'Draft',
        total: 8000,
        amount_paid: 0,
        balance: 8000,
        deleted_at: null,
      });
    });

    it('creates, enriches, and filters disbursements by linkedInvoiceId, linkedTransmittalId, and workRequestId', async () => {
      const admin = registerUser({
        email: 'admin-links@ata-lta.ph',
        name: 'Admin Links',
        role: 'Admin',
        entities: ['ATA'],
      });

      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDisbursement,
          linked_invoice_id: INVOICE_ID,
          linked_transmittal_id: TRANSMITTAL_ID,
        })
        .expect(201);

      expect(createRes.body.data.linked_invoice_id).toBe(INVOICE_ID);
      expect(createRes.body.data.linked_invoice_number).toBe('INV-ATA-2026-0088');
      expect(createRes.body.data.linked_invoice_status).toBe('Partially Paid');
      expect(createRes.body.data.linked_invoice_total).toBe(15000);
      expect(createRes.body.data.linked_invoice_amount_paid).toBe(5000);
      expect(createRes.body.data.linked_invoice_balance).toBe(10000);
      expect(createRes.body.data.linked_invoice).toEqual({
        id: INVOICE_ID,
        invoice_number: 'INV-ATA-2026-0088',
        status: 'Partially Paid',
        total: 15000,
        amount_paid: 5000,
        balance: 10000,
        due_date: '2026-11-30',
      });
      expect(createRes.body.data.linked_transmittal_id).toBe(TRANSMITTAL_ID);
      expect(createRes.body.data.linked_transmittal_tracking_number).toBe('TR-ATA-2026-0042');
      expect(createRes.body.data.linked_transmittal_status).toBe('Sent');
      expect(createRes.body.data.linked_transmittal_recipient_name).toBe('BIR RDO 044');
      expect(createRes.body.data.linked_transmittal).toEqual({
        id: TRANSMITTAL_ID,
        tracking_number: 'TR-ATA-2026-0042',
        status: 'Sent',
        recipient_name: 'BIR RDO 044',
        approved: true,
      });
      expect(createRes.body.data.linked_task_title).toBe('Acme Disbursement Task');

      // Filter by linkedInvoiceId
      const byInvoice = await request(app)
        .get(`/v1/disbursements?linkedInvoiceId=${INVOICE_ID}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(byInvoice.body.data).toHaveLength(1);
      expect(byInvoice.body.data[0].id).toBe(createRes.body.data.id);

      // Filter by workRequestId
      const byWr = await request(app)
        .get(`/v1/disbursements?workRequestId=${WORK_REQUEST_ID}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(byWr.body.data).toHaveLength(1);
      expect(byWr.body.data[0].id).toBe(createRes.body.data.id);
    });

    it('rejects cross-Work-Request invoice or transmittal linkage with 400 REFERENCE_WR_MISMATCH', async () => {
      const admin = registerUser({
        email: 'admin-mismatch@ata-lta.ph',
        name: 'Admin Mismatch',
        role: 'Admin',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          ...validDisbursement,
          linkedInvoiceId: OTHER_WR_INVOICE_ID,
        })
        .expect(400);

      expect(res.body.code).toBe('REFERENCE_WR_MISMATCH');
    });

    it('allows post-Draft (Approved, Funded, Released) updates to linkedInvoiceId and linkedTransmittalId while locking financial fields', async () => {
      const admin = registerUser({
        email: 'admin-postdraft@ata-lta.ph',
        name: 'Admin PostDraft',
        role: 'Admin',
        entities: ['ATA'],
      });

      const acctId = '00000000-0000-4000-a000-000000000777';
      const accounting = registerUser({
        id: acctId,
        email: 'acct-postdraft@ata-lta.ph',
        name: 'Acct PostDraft',
        role: 'Accounting',
        entities: ['ATA'],
      });
      mockTables.work_requests.get(WORK_REQUEST_ID).assigned_to = acctId;

      const createRes = await request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursement)
        .expect(201);

      const disbId = createRes.body.data.id;

      // Transition Draft -> Approved
      await request(app)
        .post(`/v1/disbursements/${disbId}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ expectedVersion: 1 })
        .expect(200);

      // 1. Financial field edit on Approved is rejected with 409 CONFLICT_CURRENT_STATUS
      const finErr = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${accounting}`)
        .set('X-Active-Entity', 'ATA')
        .send({ amount: 9999, linkedInvoiceId: INVOICE_ID, expectedVersion: 2 })
        .expect(409);
      expect(finErr.body.code).toBe('CONFLICT_CURRENT_STATUS');

      // 2. Link-only update on Approved succeeds and bumps version to 3
      const linkApproved = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${accounting}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedInvoiceId: INVOICE_ID, expectedVersion: 2 })
        .expect(200);
      expect(linkApproved.body.data.linked_invoice_id).toBe(INVOICE_ID);
      expect(linkApproved.body.data.linked_invoice_number).toBe('INV-ATA-2026-0088');
      expect(linkApproved.body.data.version).toBe(3);

      // Transition Approved -> Funded
      await request(app)
        .post(`/v1/disbursements/${disbId}/fund`)
        .set('Authorization', `Bearer ${accounting}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          method: 'Bank Transfer',
          bank: 'BDO',
          reference: 'BDO-REF-001',
          date: '2026-10-28',
          expectedVersion: 3,
        })
        .expect(200);

      // 3. Link-only update on Funded succeeds and bumps version to 5
      const linkFunded = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${accounting}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTransmittalId: TRANSMITTAL_ID, expectedVersion: 4 })
        .expect(200);
      expect(linkFunded.body.data.linked_transmittal_id).toBe(TRANSMITTAL_ID);
      expect(linkFunded.body.data.linked_transmittal_tracking_number).toBe('TR-ATA-2026-0042');
      expect(linkFunded.body.data.version).toBe(5);

      // Transition Funded -> Released
      await request(app)
        .post(`/v1/disbursements/${disbId}/release`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ expectedVersion: 5 })
        .expect(200);

      // 4. Clearing and re-attaching link on Released succeeds and records link_update in lifecycle_history
      const linkReleased = await request(app)
        .put(`/v1/disbursements/${disbId}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedInvoiceId: null, expectedVersion: 6 })
        .expect(200);
      expect(linkReleased.body.data.linked_invoice_id).toBeNull();
      expect(linkReleased.body.data.version).toBe(7);
      expect(
        linkReleased.body.data.lifecycle_history.some((h) => h.action === 'link_update')
      ).toBe(true);
    });
  });
});
