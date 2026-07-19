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
      email: 'hr@ata-lta.ph',
      name: 'HR Staff',
      role: 'HR',
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

    const hr = registerUser({
      email: 'hr@ata-lta.ph',
      name: 'HR Staff',
      role: 'HR',
      entities: ['ATA'],
    });

    const counts = await request(app)
      .get('/v1/operations-requests/counts')
      .set('Authorization', `Bearer ${hr}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(counts.body.data.pending).toBe(1);
    expect(counts.body.data.awaitingFulfillment).toBe(0);
  });
});
