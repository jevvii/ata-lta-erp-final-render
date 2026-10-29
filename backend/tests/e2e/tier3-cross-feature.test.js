/**
 * Tier 3: Cross-Feature Combinations & Pairwise Interaction Test Suite
 * Strictly exercises interaction contracts between features (F01 - F17).
 * Total = 12 pairwise integration tests.
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

const operationsService = require('../../src/modules/operations/service');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WR_ID_1 = '22222222-2222-2222-2222-222222222221';
const WR_ID_EXTERNAL = '22222222-2222-2222-2222-222222222222';
const TASK_ID_ASSIGNED = '33333333-3333-3333-3333-333333333331';
const TASK_ID_UNASSIGNED = '33333333-3333-3333-3333-333333333332';

describe('Tier 3: Cross-Feature Combinations & Pairwise Interactions', () => {
  let adminToken, accountingToken, docToken, docUser, otherToken, otherUser, managerToken;

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
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA', 'LTA'],
      departments: ['Accounting'],
    });

    const docId = '66666666-6666-6666-6666-666666666661';
    docToken = registerUser({
      id: docId,
      email: 'doc@ata-lta.ph',
      name: 'Documentation Staff',
      role: 'Documentation',
      entities: ['ATA', 'LTA'],
      departments: ['Documentation'],
    });
    docUser = { id: docId, role: 'Documentation', departments: ['Documentation'] };

    const otherId = '66666666-6666-6666-6666-666666666662';
    otherToken = registerUser({
      id: otherId,
      email: 'other@ata-lta.ph',
      name: 'Other Staff',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
    otherUser = { id: otherId, role: 'Operations', departments: ['Operations'] };

    const managerId = '66666666-6666-6666-6666-666666666663';
    managerToken = registerUser({
      id: managerId,
      email: 'manager@ata-lta.ph',
      name: 'Manager User',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Acme Corp',
      status: 'Active',
      created_by: adminToken,
      updated_by: adminToken,
    });

    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'WR 1',
      status: 'In Progress',
    });

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
  });

  // Pair 1: F01 + F02
  it('Pair 1 (F01 + F02): Disbursement list items match tab badge count for both creator and admin', async () => {
    mockTables.disbursements.set('d-doc', {
      id: 'd-doc',
      entity_id: 'ent-ata',
      created_by: docUser.id,
      amount: 100,
      status: 'Draft',
    });
    mockTables.disbursements.set('d-other', {
      id: 'd-other',
      entity_id: 'ent-ata',
      created_by: otherUser.id,
      amount: 200,
      status: 'Draft',
    });

    const docList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const docCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(docList.body.data.length).toBe(1);
    expect(docCounts.body.data.active).toBe(docList.body.data.length);

    const adminList = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const adminCounts = await request(app)
      .get('/v1/disbursements/counts')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(adminList.body.data.length).toBe(2);
    expect(adminCounts.body.data.active).toBe(adminList.body.data.length);
  });

  // Pair 2: F01 + F03
  it('Pair 2 (F01 + F03): Creator reads unlinked disbursement and foreign-WR disbursement; peers read neither', async () => {
    mockTables.disbursements.set('d-unlinked', {
      id: 'd-unlinked',
      entity_id: 'ent-ata',
      created_by: docUser.id,
      linked_work_request_id: null,
      amount: 300,
      status: 'Draft',
    });
    mockTables.disbursements.set('d-foreign', {
      id: 'd-foreign',
      entity_id: 'ent-ata',
      created_by: docUser.id,
      linked_work_request_id: WR_ID_EXTERNAL,
      amount: 400,
      status: 'Draft',
    });

    const docRes = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const docIds = docRes.body.data.map((d) => d.id);
    expect(docIds).toContain('d-unlinked');
    expect(docIds).toContain('d-foreign');

    const peerRes = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const peerIds = (peerRes.body.data || []).map((d) => d.id);
    expect(peerIds).not.toContain('d-unlinked');
    expect(peerIds).not.toContain('d-foreign');
  });

  // Pair 3: F01 + F04
  it('Pair 3 (F01 + F04): Task related disbursements and disbursements list adhere to same creator boundary', async () => {
    mockTables.disbursements.set('d-t-own', {
      id: 'd-t-own',
      entity_id: 'ent-ata',
      linked_task_id: TASK_ID_ASSIGNED,
      created_by: docUser.id,
      amount: 150,
      status: 'Draft',
    });
    mockTables.disbursements.set('d-t-other', {
      id: 'd-t-other',
      entity_id: 'ent-ata',
      linked_task_id: TASK_ID_ASSIGNED,
      created_by: otherUser.id,
      amount: 250,
      status: 'Draft',
    });

    const related = await operationsService.getTaskRelated(TASK_ID_ASSIGNED, docUser);
    const relatedIds = (related.disbursements || []).map((d) => d.id);

    const listRes = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const listIds = listRes.body.data.map((d) => d.id);
    expect(relatedIds).toEqual(['d-t-own']);
    expect(listIds).toContain('d-t-own');
    expect(listIds).not.toContain('d-t-other');
  });

  // Pair 4: F05 + F06
  it('Pair 4 (F05 + F06): Documentation user denied invoice request, permitted task-assigned transmittal', async () => {
    // Attempt billing request -> Denied
    const billingRes = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_ASSIGNED })
      .expect(403);
    expect(billingRes.body.detail).toMatch(/documentation users cannot request invoice billing/i);

    // Attempt transmittal on assigned task -> Allowed
    const transmittalRes = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: TASK_ID_ASSIGNED,
        trackingNumber: 'TR-PAIR-4',
        items: [{ description: 'Docs', documentType: 'Tax', quantity: 1 }],
        recipientName: 'Recipient',
      })
      .expect(201);
    expect(transmittalRes.body.data.linked_task_id).toBe(TASK_ID_ASSIGNED);
  });

  // Pair 5: F06 + F07
  it('Pair 5 (F06 + F07): Documentation user blank task rejected (400), unassigned rejected (403), assigned succeeds (201)', async () => {
    const base = {
      clientId: CLIENT_ID,
      workRequestId: WR_ID_1,
      items: [{ description: 'Audit Paper', documentType: 'Audit', quantity: 1 }],
      recipientName: 'Client',
    };

    // Blank task -> 400
    const rBlank = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...base, linkedTaskId: '' })
      .expect(400);
    expect(rBlank.body.detail || rBlank.body.message).toMatch(/valid linked task is required/i);

    // Unassigned task -> 403
    const rUnassigned = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...base, linkedTaskId: TASK_ID_UNASSIGNED, trackingNumber: 'TR-P5-UN' })
      .expect(403);
    expect(rUnassigned.body.title).toMatch(/forbidden/i);

    // Assigned task -> 201
    const rAssigned = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...base, linkedTaskId: TASK_ID_ASSIGNED, trackingNumber: 'TR-P5-OK' })
      .expect(201);
    expect(rAssigned.body.data.linked_task_id).toBe(TASK_ID_ASSIGNED);
  });

  // Pair 6: F06 Transmittal task assignment enforcement
  it('Pair 6 (F06): Backend transmittal create allows assigned task and rejects unassigned task', async () => {
    const apiAssigned = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: TASK_ID_ASSIGNED,
        trackingNumber: 'TR-P6-A',
        items: [{ description: 'Paper', documentType: 'Audit', quantity: 1 }],
        recipientName: 'Client',
      });
    expect(apiAssigned.status).toBe(201);

    const apiUnassigned = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: TASK_ID_UNASSIGNED,
        trackingNumber: 'TR-P6-B',
        items: [{ description: 'Paper', documentType: 'Audit', quantity: 1 }],
        recipientName: 'Client',
      });
    expect(apiUnassigned.status).toBe(403);
  });

  // Pair 7: F08 Role Manager retainers:edit
  it('Pair 7 (F08): Role Manager has backend retainers:edit permission to create templates', async () => {
    const templateRes = await request(app)
      .post('/v1/operations/templates')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Cross Feature Template', lines: [] });
    expect(templateRes.status).toBe(201);
  });

  // Pair 8: F08 + F16
  it('Pair 8 (F08 + F16): Role Manager access to Retainer Templates aligned across backend and prototype', async () => {
    // Backend allows Manager
    const apiRes = await request(app)
      .get('/v1/operations/templates')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA');
    expect(apiRes.status).toBe(200);

    // Prototype allows Manager
    const code = getPrototypeWorkflow();
    expect(code).toMatch(/Auth\.user\?\.role === 'Manager'|role === 'Manager'/);
  });

  // Pair 9: F05 Documentation user denied invoice billing requests
  it('Pair 9 (F05): Documentation user denied invoice billing requests', async () => {
    const billingRes = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_ASSIGNED });
    expect(billingRes.status).toBe(403);
  });

  // Pair 10: F14 + F15
  it('Pair 10 (F14 + F15): Prototype user restricted to own disbursements and assigned tasks for transmittals', () => {
    const Auth = loadPrototypeAuth({ id: docUser.id, role: 'Documentation', departments: ['Documentation'] });

    // F14 check
    expect(Auth.canViewDisbursement({ id: 'd-1', status: 'Released', createdBy: 'other-id' })).toBe(false);
    expect(Auth.canViewDisbursement({ id: 'd-2', status: 'Draft', createdBy: docUser.id })).toBe(true);

    // F15 check
    const workflowCode = getPrototypeWorkflow();
    expect(workflowCode).toMatch(/isTaskAssignee|assigneeId.*===.*Auth\.user/);
  });

  // Pair 11: F01 + F14
  it('Pair 11 (F01 + F14): Backend disbursement read scope and Prototype canViewDisbursement produce identical results', async () => {
    mockTables.disbursements.set('d-parity-own', {
      id: 'd-parity-own',
      entity_id: 'ent-ata',
      created_by: docUser.id,
      amount: 100,
      status: 'Released',
    });
    mockTables.disbursements.set('d-parity-other', {
      id: 'd-parity-other',
      entity_id: 'ent-ata',
      created_by: otherUser.id,
      amount: 200,
      status: 'Released',
    });

    // Backend
    const backendRes = await request(app)
      .get('/v1/disbursements')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const backendIds = backendRes.body.data.map((d) => d.id);
    expect(backendIds).toContain('d-parity-own');
    expect(backendIds).not.toContain('d-parity-other');

    // Prototype
    const Auth = loadPrototypeAuth({ id: docUser.id, role: 'Documentation', departments: ['Documentation'] });
    expect(Auth.canViewDisbursement({ id: 'd-parity-own', status: 'Released', createdBy: docUser.id })).toBe(true);
    expect(Auth.canViewDisbursement({ id: 'd-parity-other', status: 'Released', createdBy: otherUser.id })).toBe(false);
  });

  // Pair 12: F06 + F15
  it('Pair 12 (F06 + F15): Backend task assignment and Prototype task selection filter enforce same assignee rule', async () => {
    // Backend
    const res = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${docToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        clientId: CLIENT_ID,
        workRequestId: WR_ID_1,
        linkedTaskId: TASK_ID_UNASSIGNED,
        items: [{ description: 'Paper', documentType: 'Audit', quantity: 1 }],
        recipientName: 'Client',
      });
    expect(res.status).toBe(403);

    // Prototype filters unassigned tasks
    const workflowCode = getPrototypeWorkflow();
    expect(workflowCode).toMatch(/isTaskAssignee|assigneeId.*===.*Auth\.user/);
  });
});
