/**
 * /v1/operations-requests integration tests.
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('./fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WORK_REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const FULFILLER_ID = '33333333-3333-3333-3333-333333333333';

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
};

const seedWorkRequest = () => {
  mockTables.work_requests.set(WORK_REQUEST_ID, {
    id: WORK_REQUEST_ID,
    entity_id: 'ent-ata',
    title: 'Prepare financial statements',
    status: 'Open',
  });
};

const validRequest = {
  type: 'disbursement',
  workRequestId: WORK_REQUEST_ID,
  clientId: CLIENT_ID,
  amount: 2500,
  notes: 'Request disbursement for site visit',
};

describe('/v1/operations-requests', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedClient();
    seedWorkRequest();
  });

  it('creates an operations request when user has workflow:edit', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    expect(res.body.data.type).toBe('disbursement');
    expect(res.body.data.amount).toBe(2500);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.work_request_id).toBe(WORK_REQUEST_ID);
    expect(res.body.data.client_id).toBe(CLIENT_ID);
  });

  it('forbids creation without workflow:edit', async () => {
    const token = registerUser({
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('lists requests and supports filters', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', notes: 'Billing request' })
      .expect(201);

    const list = await request(app)
      .get('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(list.body.data.length).toBe(2);
    expect(list.body.meta.total).toBe(2);

    const listLimit1000 = await request(app)
      .get('/v1/operations-requests?limit=1000')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(listLimit1000.body.meta.limit).toBe(1000);

    await request(app)
      .get('/v1/operations-requests?limit=1001')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(400);

    const filtered = await request(app)
      .get('/v1/operations-requests?type=billing')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(filtered.body.data.length).toBe(1);
    expect(filtered.body.data[0].type).toBe('billing');
  });

  it('gets a request by id', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    const res = await request(app)
      .get(`/v1/operations-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.id).toBe(created.body.data.id);
    expect(res.body.data.type).toBe('disbursement');
  });

  it('fulfills a pending request', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const fulfiller = registerUser({
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
      id: FULFILLER_ID,
    });

    const created = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    const res = await request(app)
      .put(`/v1/operations-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${fulfiller}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'fulfilled', fulfilledBy: FULFILLER_ID })
      .expect(200);

    expect(res.body.data.status).toBe('fulfilled');
    expect(res.body.data.fulfilled_by).toBe(FULFILLER_ID);
    expect(res.body.data.fulfilled_at).toBeTruthy();
  });

  it('rejects a pending request with a reason', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    const res = await request(app)
      .put(`/v1/operations-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'rejected', rejectionReason: 'Insufficient documentation' })
      .expect(200);

    expect(res.body.data.status).toBe('rejected');
    expect(res.body.data.rejection_reason).toBe('Insufficient documentation');
  });

  it('cancels a pending request', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    const res = await request(app)
      .put(`/v1/operations-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'cancelled' })
      .expect(200);

    expect(res.body.data.status).toBe('cancelled');
  });

  it('soft-deletes a request by marking it cancelled', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    await request(app)
      .delete(`/v1/operations-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);

    const get = await request(app)
      .get(`/v1/operations-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);

    expect(get.body.title).toMatch(/not found/i);
  });

  it('returns counts grouped by status', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    await request(app)
      .put(`/v1/operations-requests/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'fulfilled' })
      .expect(200);

    // Leave a second request pending so awaitingFulfillment is non-zero.
    await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', notes: 'Pending billing request' })
      .expect(201);

    // Seed a rejected request directly for count coverage
    mockTables.operations_requests.set('rejected-req', {
      id: 'rejected-req',
      entity_id: 'ent-ata',
      type: 'billing',
      requested_by: 'user-1',
      amount: 100,
      status: 'rejected',
      rejection_reason: 'Duplicate',
    });

    const counts = await request(app)
      .get('/v1/operations-requests/counts')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(counts.body.data.total).toBe(3);
    expect(counts.body.data.fulfilled).toBe(1);
    expect(counts.body.data.rejected).toBe(1);
    expect(counts.body.data.pending).toBe(1);
    expect(counts.body.data.awaitingFulfillment).toBe(1);
  });

  it('hides awaitingFulfillment count from users who cannot fulfill', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    const accounting = registerUser({
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA'],
    });

    const counts = await request(app)
      .get('/v1/operations-requests/counts')
      .set('Authorization', `Bearer ${accounting}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(counts.body.data.pending).toBe(1);
    expect(counts.body.data.awaitingFulfillment).toBe(0);
  });

  it('deduplicates rapid consecutive submissions of the same operations request', async () => {
    const admin = registerUser({
      email: 'admin-dup@ata-lta.ph',
      name: 'Admin Dup',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res1 = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    const res2 = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validRequest)
      .expect(201);

    expect(res2.body.data.id).toBe(res1.body.data.id);
  });

  it('creates operations_requests record when a manager creates a work request (UAT2-4-server)', async () => {
    const managerToken = registerUser({
      id: 'manager-user-001',
      email: 'UAT-manager-ops@ata-lta.ph',
      name: 'Manager Ops',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA'],
    });

    const createWrRes = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        dueDate: '2026-12-31',
        clientId: CLIENT_ID,
        title: 'Manager Project Request',
        phases: {
          pre_processing: {
            tasks: [
              { title: 'Intake and document collection', local_id: 't_1' },
            ],
          },
          processing: {
            tasks: [
              { title: 'Draft financial assessment', local_id: 't_2' },
            ],
          },
        },
      })
      .expect(201);

    const wrId = createWrRes.body.data.id;

    // Check that an operations_requests record was created for wrId
    const opReq = Array.from(mockTables.operations_requests.values()).find(
      (r) => r.work_request_id === wrId
    );
    expect(opReq).toBeDefined();
    expect(opReq.type).toBe('wr_phase_transition');
    expect(opReq.status).toBe('pending');
    expect(opReq.requested_by).toBe('manager-user-001');

    const parsedNotes = JSON.parse(opReq.notes);
    expect(parsedNotes.from_phase).toBe('pre_processing');
    expect(parsedNotes.to_phase).toBe('processing');
    expect(parsedNotes.work_request_id).toBe(wrId);
  });

  it('returns enriched client code, work_request with tasks, and requester info in operations requests (UAT2-4-server)', async () => {
    const adminToken = registerUser({
      id: 'admin-enrich-001',
      email: 'UAT-admin-enrich@ata-lta.ph',
      name: 'Admin Enrich',
      role: 'Admin',
      entities: ['ATA'],
    });

    // Seed client with code
    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Acme Corp',
      code: 'ACM-001',
      status: 'Active',
    });

    // Seed task for WORK_REQUEST_ID
    const taskId = 'task-wr-enrich-001';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      title: 'Analyze statements',
      status: 'Pending',
      phase: 'processing',
      qa_status: 'none',
    });

    // Create operations request
    const createRes = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        type: 'wr_phase_transition',
        workRequestId: WORK_REQUEST_ID,
        clientId: CLIENT_ID,
        fromPhase: 'pre_processing',
        toPhase: 'processing',
        notes: 'Advancing to processing',
      })
      .expect(201);

    const reqId = createRes.body.data.id;

    // Verify GET /v1/operations-requests/:id enrichment
    const getRes = await request(app)
      .get(`/v1/operations-requests/${reqId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const data = getRes.body.data;
    expect(data.clients).toBeDefined();
    expect(data.clients.code).toBe('ACM-001');
    expect(data.work_requests).toBeDefined();
    expect(data.work_requests.id).toBe(WORK_REQUEST_ID);
    expect(Array.isArray(data.work_requests.tasks)).toBe(true);
    expect(data.work_requests.tasks.some((t) => t.id === taskId)).toBe(true);
    expect(data.requester).toBeDefined();
    expect(data.requester.id).toBe('admin-enrich-001');
    expect(data.requester.email).toBe('UAT-admin-enrich@ata-lta.ph');

    // Verify GET /v1/operations-requests listing enrichment
    const listRes = await request(app)
      .get(`/v1/operations-requests?workRequestId=${WORK_REQUEST_ID}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const listItem = listRes.body.data.find((r) => r.id === reqId);
    expect(listItem).toBeDefined();
    expect(listItem.clients.code).toBe('ACM-001');
    expect(listItem.work_requests.tasks.some((t) => t.id === taskId)).toBe(true);
    expect(listItem.requester.email).toBe('UAT-admin-enrich@ata-lta.ph');
  });

  describe('Billing request policy enforcement (F05)', () => {
    it('denies billing request for Documentation-only user with 403 Forbidden', async () => {
      const docToken = registerUser({
        id: 'doc-only-user',
        email: 'doc-billing@ata-lta.ph',
        name: 'Doc Billing Staff',
        role: 'Documentation',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WORK_REQUEST_ID,
          clientId: CLIENT_ID,
          notes: 'Request invoice for audit task',
        })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
      expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
    });

    it('denies billing request for multi-department Documentation+Operations user with 403 Forbidden', async () => {
      const multiId = 'multi-doc-ops-user';
      const multiToken = registerUser({
        id: multiId,
        email: 'multi-doc-ops@ata-lta.ph',
        name: 'Multi Doc Ops Staff',
        role: 'Operations',
        entities: ['ATA'],
      });
      // Attach both departments
      mockTables.users.get(multiId).user_departments = [
        { departments: { name: 'Operations' } },
        { departments: { name: 'Documentation' } },
      ];

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${multiToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WORK_REQUEST_ID,
          clientId: CLIENT_ID,
          notes: 'Multi-dept billing request',
        })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
      expect(res.body.detail).toBe('Documentation users cannot request invoice billing');
    });

    it('allows Operations-only user without Documentation to create billing request', async () => {
      const opsId = 'ops-only-user';
      const opsToken = registerUser({
        id: opsId,
        email: 'ops-only@ata-lta.ph',
        name: 'Ops Only Staff',
        role: 'Operations',
        entities: ['ATA'],
      });
      mockTables.users.get(opsId).user_departments = [{ departments: { name: 'Operations' } }];

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WORK_REQUEST_ID,
          clientId: CLIENT_ID,
          notes: 'Operations billing request',
        })
        .expect(201);

      expect(res.body.data.type).toBe('billing');
      expect(res.body.data.status).toBe('pending');
    });

    it('allows Admin to create billing operations request and preserves direct linking', async () => {
      const adminToken = registerUser({
        id: 'admin-billing-user',
        email: 'admin-billing@ata-lta.ph',
        name: 'Admin Billing',
        role: 'Admin',
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WORK_REQUEST_ID,
          clientId: CLIENT_ID,
          notes: 'Admin billing request',
        })
        .expect(201);

      expect(res.body.data.type).toBe('billing');
      expect(res.body.data.status).toBe('pending');
    });
  });
});
