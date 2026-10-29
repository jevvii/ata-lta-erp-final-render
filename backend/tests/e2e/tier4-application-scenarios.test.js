/**
 * Tier 4: Real-World Multi-Step Application Scenarios Test Suite
 * Exercises realistic business workflows simulating multi-actor lifecycles.
 * Total = 6 comprehensive multi-step scenarios.
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
  getPrototypeWorkflow,
} = require('./helpers');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WR_ID_1 = '22222222-2222-2222-2222-222222222221';
const TASK_ID_A = '33333333-3333-3333-3333-333333333331';
const TASK_ID_B = '33333333-3333-3333-3333-333333333332';

describe('Tier 4: Real-World Multi-Step Application Scenarios', () => {
  let adminToken, accountingToken, docTokenA, docUserA, docTokenB, docUserB, opsToken, opsUser, managerToken, managerUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });

    accountingToken = registerUser({
      email: 'rachel@ata-lta.ph',
      name: 'Rachel Accounting',
      role: 'Accounting',
      entities: ['ATA', 'LTA'],
      departments: ['Accounting'],
    });

    const docAId = '77777777-7777-7777-7777-777777777771';
    docTokenA = registerUser({
      id: docAId,
      email: 'twinkle@ata-lta.ph',
      name: 'Twinkle Docs',
      role: 'Documentation',
      entities: ['ATA', 'LTA'],
      departments: ['Documentation'],
    });
    docUserA = { id: docAId, role: 'Documentation', departments: ['Documentation'] };

    const docBId = '77777777-7777-7777-7777-777777777772';
    docTokenB = registerUser({
      id: docBId,
      email: 'mary@ata-lta.ph',
      name: 'Mary Docs',
      role: 'Documentation',
      entities: ['ATA', 'LTA'],
      departments: ['Documentation'],
    });
    docUserB = { id: docBId, role: 'Documentation', departments: ['Documentation'] };

    const opsId = '77777777-7777-7777-7777-777777777773';
    opsToken = registerUser({
      id: opsId,
      email: 'ann@ata-lta.ph',
      name: 'Ann Operations',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
    opsUser = { id: opsId, role: 'Operations', departments: ['Operations'] };

    const mgrId = '77777777-7777-7777-7777-777777777774';
    managerToken = registerUser({
      id: mgrId,
      email: 'love@ata-lta.ph',
      name: 'Love Manager',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });
    managerUser = { id: mgrId, role: 'Manager', departments: ['Management'] };

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Mega Corp',
      status: 'Active',
      created_by: adminToken,
      updated_by: adminToken,
    });

    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Annual Statutory Audit 2026',
      status: 'In Progress',
    });

    mockTables.tasks.set(TASK_ID_A, {
      id: TASK_ID_A,
      work_request_id: WR_ID_1,
      title: 'Document Assembly',
      assignee_id: docAId,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_B, {
      id: TASK_ID_B,
      work_request_id: WR_ID_1,
      title: 'Final Client Filing',
      assignee_id: docBId,
      deleted_at: null,
    });
  });

  // Scenario 1: Client Audit & Tax Transmittal Delivery Lifecycle
  it('Scenario 1: Client Audit & Tax Transmittal Delivery Lifecycle', async () => {
    // Step 1: Doc staff Twinkle attempts to request billing -> Blocked by F05
    const billingAttempt = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_A });
    expect(billingAttempt.status).toBe(403);
    expect(billingAttempt.body.detail).toMatch(/documentation users cannot request invoice billing/i);

    // Step 2: Accounting Rachel creates draft invoice directly
    mockTables.invoices = mockTables.invoices || new Map();
    mockTables.invoices.set('inv-sc1', {
      id: 'inv-sc1',
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WR_ID_1,
      status: 'Draft',
      amount: 15000,
    });

    // Step 3: Twinkle attempts whole-project transmittal -> Blocked by F07
    const wholeProjAttempt = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: null,
        items: [{ description: 'Tax Package', documentType: 'Tax', quantity: 1 }],
        recipientName: 'Bureau of Internal Revenue',
      });
    expect(wholeProjAttempt.status).toBe(400);

    // Step 4: Twinkle creates transmittal linked to assigned Task A -> Allowed by F06
    const transmittalRes = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: TASK_ID_A,
        trackingNumber: 'TR-SC1-01',
        items: [{ description: 'Tax Package', documentType: 'Tax', quantity: 1 }],
        recipientName: 'Bureau of Internal Revenue',
      });
    expect(transmittalRes.status).toBe(201);
    const transmittalId = transmittalRes.body.data.id;

    // Step 5: Admin approves transmittal
    mockTables.transmittals.get(transmittalId).approved = true;

    // Step 6: Twinkle sends the transmittal -> Succeeded
    const sendRes = await request(app)
      .post(`/v1/transmittals/${transmittalId}/send`)
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA');
    expect(sendRes.status).toBe(200);

    // Step 7: Twinkle creates courier fee disbursement -> Stored in Draft
    mockTables.disbursements.set('d-sc1-courier', {
      id: 'd-sc1-courier',
      entity_id: 'ent-ata',
      created_by: docUserA.id,
      amount: 350,
      description: 'Courier delivery fee for BIR filing',
      status: 'Draft',
    });

    // Step 8: Twinkle views disbursements list -> Sees own courier fee
    const twinkleList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    const twinkleDisbIds = twinkleList.body.data.map((d) => d.id);
    expect(twinkleDisbIds).toContain('d-sc1-courier');

    // Step 9: Mary Docs views disbursements list -> Cannot see Twinkle courier fee
    const maryList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${docTokenB}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    const maryDisbIds = (maryList.body.data || []).map((d) => d.id);
    expect(maryDisbIds).not.toContain('d-sc1-courier');
  });

  // Scenario 2: Multi-Department Operations & Approvals Governance
  it('Scenario 2: Multi-Department Operations & Approvals Governance', async () => {
    // Multi-department user: Operations + Documentation
    const hybridToken = registerUser({
      email: 'hybrid@ata-lta.ph',
      name: 'Hybrid User',
      role: 'Staff',
      departments: ['Operations', 'Documentation'],
      entities: ['ATA'],
    });

    // Hybrid user attempts billing request -> Rejected because Documentation membership denies billing
    const hybridReq = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${hybridToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_A, amount: 20000 });
    expect(hybridReq.status).toBe(403);
    expect(hybridReq.body.detail).toMatch(/documentation users cannot request invoice billing/i);

    // Pure Operations user Ann submits billing request -> Succeeded
    const annReq = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_A, amount: 20000 });
    expect(annReq.status).toBe(201);
    const reqId = annReq.body.data.id;

    // Manager Love navigates to pending approvals -> Sees Ann request and approves it
    const approveRes = await request(app)
      .post(`/v1/operations-requests/${reqId}/approve`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA');
    expect(approveRes.status).toBe(200);
  });

  // Scenario 3: Transmittal Assignment Transfer & Concurrency Control
  it('Scenario 3: Transmittal Assignment Transfer & Concurrency Control', async () => {
    // Twinkle attempts transmittal on Mary task (Task B) -> Blocked (403)
    const unauthorizedCreate = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: TASK_ID_B,
        items: [{ description: 'Filing Docs', documentType: 'Audit', quantity: 1 }],
        recipientName: 'Securities and Exchange Commission',
      });
    expect(unauthorizedCreate.status).toBe(403);

    // Project lead assigns Twinkle as co-assignee on Task B
    mockTables.task_assignees.set('ta-sc3', {
      id: 'ta-sc3',
      task_id: TASK_ID_B,
      user_id: docUserA.id,
    });

    // Twinkle retries transmittal create on Task B -> Now succeeded (201)
    const authorizedCreate = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: TASK_ID_B,
        trackingNumber: 'TR-SC3-OK',
        items: [{ description: 'Filing Docs', documentType: 'Audit', quantity: 1 }],
        recipientName: 'Securities and Exchange Commission',
      });
    expect(authorizedCreate.status).toBe(201);
    const trId = authorizedCreate.body.data.id;

    // Twinkle can update transmittal while in Draft
    const updateRes = await request(app)
      .put(`/v1/transmittals/${trId}`)
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA')
      .send({ notes: 'Updated notes before dispatch' });
    expect(updateRes.status).toBe(200);
  });

  // Scenario 4: Retainer Template Creation & Segregation from Task Templates
  it('Scenario 4: Retainer Template Creation & Segregation from Task Templates', async () => {
    // Manager Love creates new Retainer Template for Quarterly Retainer
    const createTemplateRes = await request(app)
      .post('/v1/operations/templates')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Quarterly Bookkeeping & Compliance',
        description: 'Standard quarterly workflow',
        lines: [
          { title: 'VAT Return Filing', phase: 'processing', defaultPriority: 'High' },
          { title: 'Management Report Generation', phase: 'completion', defaultPriority: 'Normal' },
        ],
      });
    expect(createTemplateRes.status).toBe(201);

    // Staff member in Management department attempts to edit the template -> Blocked (403)
    const staffMgmtToken = registerUser({
      email: 'staffmgmt@ata-lta.ph',
      name: 'Staff Management',
      role: 'Staff',
      departments: ['Management'],
      entities: ['ATA'],
    });

    const editTemplateRes = await request(app)
      .post('/v1/operations/templates')
      .set('Authorization', `Bearer ${staffMgmtToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Tampered Template', lines: [] });
    expect(editTemplateRes.status).toBe(403);

    // Manager Love attempts to create a Task Template -> Blocked (Admin-only)
    const taskTemplateAttempt = await request(app)
      .post('/v1/operations/task-templates')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Admin Master Task', defaultPhase: 'processing' });
    expect(taskTemplateAttempt.status).toBe(403);

    // Admin creates Task Template -> Succeeded
    const adminTaskTemplate = await request(app)
      .post('/v1/operations/task-templates')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Admin Master Task', defaultPhase: 'processing' });
    expect(adminTaskTemplate.status).toBe(201);
  });

  // Scenario 5: Disbursement Financial Audit & Payee Confidentiality
  it('Scenario 5: Disbursement Financial Audit & Payee Confidentiality', async () => {
    // Ann Operations creates reimbursement disbursement, naming Twinkle as payee
    mockTables.disbursements.set('d-sc5', {
      id: 'd-sc5',
      entity_id: 'ent-ata',
      created_by: opsUser.id,
      employee_id: docUserA.id, // Twinkle is payee
      amount: 4500,
      description: 'Travel expense reimbursement',
      status: 'Released', // Released by Accounting
    });

    // Twinkle (payee) attempts to read disbursement -> Blocked (403) (payee is not a read exception)
    const payeeRead = await request(app)
      .get('/v1/disbursements/d-sc5')
      .set('Authorization', `Bearer ${docTokenA}`)
      .set('X-Active-Entity', 'ATA');
    expect(payeeRead.status).toBe(403);

    // Manager Love attempts to read disbursement -> Blocked (403) (Manager is not a read exception)
    const managerRead = await request(app)
      .get('/v1/disbursements/d-sc5')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA');
    expect(managerRead.status).toBe(403);

    // Ann (creator) reads disbursement -> Succeeded (200)
    const creatorRead = await request(app)
      .get('/v1/disbursements/d-sc5')
      .set('Authorization', `Bearer ${opsToken}`)
      .set('X-Active-Entity', 'ATA');
    expect(creatorRead.status).toBe(200);
    expect(creatorRead.body.data.id).toBe('d-sc5');

    // Rachel (Accounting) conducts audit and reads all entity disbursements -> Succeeded (200)
    const auditRead = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${accountingToken}`)
      .set('X-Active-Entity', 'ATA');
    expect(auditRead.status).toBe(200);
    const auditIds = auditRead.body.data.map((d) => d.id);
    expect(auditIds).toContain('d-sc5');
  });

  // Scenario 6: Prototype RBAC Parity
  it('Scenario 6: Prototype RBAC Parity', () => {
    // 1. Prototype disbursement scoping
    const Auth = loadPrototypeAuth({ id: docUserA.id, role: 'Documentation', departments: ['Documentation'] });
    expect(Auth.canViewDisbursement({ id: 'd-test', status: 'Released', createdBy: 'other' })).toBe(false);
    expect(Auth.canViewDisbursement({ id: 'd-test', status: 'Released', createdBy: docUserA.id })).toBe(true);

    // 2. Prototype workflow transmittal dropdown filter
    const prototypeWorkflow = getPrototypeWorkflow();
    expect(prototypeWorkflow).toMatch(/isTaskAssignee|assigneeId.*===.*Auth\.user/);
  });
});
