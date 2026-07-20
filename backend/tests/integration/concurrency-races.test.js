/**
 * Concurrency race-condition tests for the six critical flows.
 *
 * These tests prove that concurrent mutating requests cannot corrupt
 * state for: disbursement approvals, invoice payments, pending approvals,
 * operations-request fulfillment, client TIN uniqueness, and disbursement
 * number uniqueness.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID_LTA = '22222222-2222-2222-2222-222222222222';

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
  mockTables.clients.set(CLIENT_ID_LTA, {
    id: CLIENT_ID_LTA,
    entity_id: 'ent-lta',
    name: 'Beta Corp',
    tin: '123-456-789-00002',
    status: 'Active',
    created_by: 'user-1',
    updated_by: 'user-1',
  });
};

const validDisbursement = {
  category: 'Transportation',
  description: 'Site visit transportation',
  amount: 1500,
  fundSource: 'Firm Fund',
  clientId: CLIENT_ID,
  dueDate: '2026-07-31',
  notes: 'Test disbursement',
};

const validInvoice = {
  invoiceNumber: 'ATA-SI-2026-001',
  clientId: CLIENT_ID,
  workRequestId: null,
  issueDate: '2026-07-01',
  dueDate: '2026-07-31',
  status: 'Draft',
  lineItems: [{ description: 'Professional services', amount: 10000, type: 'Professional Fee' }],
  notes: 'Test invoice',
  terms: 'Due within 30 days',
};

const createPendingChange = (submitterUserId, tableName = 'clients', parentId = null) => {
  const id = `pending-${Math.random().toString(36).slice(2)}`;
  mockTables.pending_changes.set(id, {
    id,
    entity_id: 'ent-ata',
    table_name: tableName,
    parent_record_id: parentId,
    proposed_data: { name: 'New Client', tin: '000-000-000-00000', status: 'Active' },
    submitted_by: submitterUserId,
    status: 'pending',
  });
  return id;
};

beforeEach(() => {
  resetMock();
  seedDefaults();
  seedClient();
});

const ADMIN_USER_ID = 'admin-user';

const adminFor = (entities = ['ATA']) => {
  return registerUser({
    id: ADMIN_USER_ID,
    email: `admin-${entities.join('-')}@ata-lta.ph`,
    name: 'Admin',
    role: 'Admin',
    entities,
  });
};

describe('Concurrency race conditions', () => {
  test('1. Two concurrent disbursement approvals: only one succeeds', async () => {
    const admin = adminFor(['ATA']);

    const created = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDisbursement)
      .expect(201);

    const id = created.body.data.id;

    await request(app)
      .post(`/v1/disbursements/${id}/submit`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/v1/disbursements/${id}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA'),
      request(app)
        .post(`/v1/disbursements/${id}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA'),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = res1.status === 200 ? res1 : res2;
    expect(winner.body.data.status).toBe('Approved');

    const final = await request(app)
      .get(`/v1/disbursements/${id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(final.body.data.status).toBe('Approved');
  });

  test('2. Two concurrent invoice payments cannot overpay', async () => {
    const admin = adminFor(['ATA']);

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    const id = created.body.data.id;

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/v1/invoices/${id}/payments`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ amount: 6000, method: 'Bank Transfer', reference: 'REF-A', date: '2026-07-15' }),
      request(app)
        .post(`/v1/invoices/${id}/payments`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ amount: 6000, method: 'Bank Transfer', reference: 'REF-B', date: '2026-07-15' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const final = await request(app)
      .get(`/v1/invoices/${id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    // The total paid must not exceed the invoice total.
    expect(Number(final.body.data.amount_paid)).toBeLessThanOrEqual(10000);
    expect(Number(final.body.data.balance)).toBeGreaterThanOrEqual(0);
  });

  test('3. Two concurrent pending-approval approvals: only one succeeds', async () => {
    const admin = adminFor(['ATA']);
    const pendingId = createPendingChange(ADMIN_USER_ID);

    const [res1, res2] = await Promise.all([
      request(app)
        .post(`/v1/admin/pending-approvals/${pendingId}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA'),
      request(app)
        .post(`/v1/admin/pending-approvals/${pendingId}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA'),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = res1.status === 200 ? res1 : res2;
    expect(winner.body.data.status).toBe('approved');

    const final = mockTables.pending_changes.get(pendingId);
    expect(final.status).toBe('approved');
  });

  test('4. Two concurrent operations-request fulfillments: only one succeeds', async () => {
    const admin = adminFor(['ATA']);
    const ops = registerUser({ id: 'ops-user', email: 'ops@ata-lta.ph', name: 'Ops', role: 'Operations', entities: ['ATA'] });

    const created = await request(app)
      .post('/v1/operations-requests')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .send({ type: 'billing', amount: 5000, notes: 'Need billing' })
      .expect(201);

    const id = created.body.data.id;

    const [res1, res2] = await Promise.all([
      request(app)
        .put(`/v1/operations-requests/${id}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'fulfilled' }),
      request(app)
        .put(`/v1/operations-requests/${id}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'fulfilled' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([200, 409]);

    const final = await request(app)
      .get(`/v1/operations-requests/${id}`)
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(final.body.data.status).toBe('fulfilled');
  });

  test('5. Two concurrent clients with the same TIN: only one succeeds', async () => {
    const admin = adminFor(['ATA']);
    const sharedTin = '999-999-999-99999';

    const payload = {
      name: 'Concurrent Corp',
      tin: sharedTin,
      rdoCode: '001',
      address: 'Test address',
      entity: 'ATA',
    };

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/v1/clients')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send(payload),
      request(app)
        .post('/v1/clients')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...payload, name: 'Concurrent Corp 2' }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);

    const activeClients = Array.from(mockTables.clients.values()).filter(
      (c) => c.entity_id === 'ent-ata' && c.tin === sharedTin && !c.deleted_at
    );
    expect(activeClients).toHaveLength(1);
  });

  test('6. Two concurrent disbursement creations get unique generated numbers', async () => {
    const admin = adminFor(['ATA']);

    const [res1, res2] = await Promise.all([
      request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send(validDisbursement),
      request(app)
        .post('/v1/disbursements')
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validDisbursement, description: 'Second concurrent' }),
    ]);

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);

    const num1 = res1.body.data.disbursement_number;
    const num2 = res2.body.data.disbursement_number;
    expect(num1).not.toBe(num2);

    const allNumbers = Array.from(mockTables.disbursements.values())
      .filter((d) => d.entity_id === 'ent-ata')
      .map((d) => d.disbursement_number);
    expect(new Set(allNumbers).size).toBe(allNumbers.length);
  });
});
