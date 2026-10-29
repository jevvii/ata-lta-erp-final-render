/**
 * Optimistic Concurrency Control integration tests (Spec 2.2 / R-10).
 *
 * Verifies that updates carrying expectedVersion (body or If-Match header)
 * are applied only when the stored row still has that version, and that a
 * stale version is rejected with 409 ERR_CONCURRENCY_CONFLICT instead of
 * silently overwriting a concurrent edit. Both channels are optional, so a
 * final test pins the backward-compatible behavior when neither is sent.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const baseClient = {
  name: 'OCC Test Co',
  tin: '555-666-777-00001',
  entity: 'ATA',
  retainer: false,
};

const CONFLICT_DETAIL =
  'The record was modified by another user. Please reload the latest version before editing.';

describe('Optimistic Concurrency Control', () => {
  let token;

  beforeEach(() => {
    resetMock();
    seedDefaults();
    token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
  });

  const createClient = async () => {
    const res = await request(app)
      .post('/v1/clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(baseClient)
      .expect(201);
    return res.body.data;
  };

  it('surfaces the record version in client API responses', async () => {
    const created = await createClient();
    expect(created.version).toBe(1);

    const fetched = await request(app)
      .get(`/v1/clients/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(fetched.body.data.version).toBe(1);
  });

  it('applies an update with the correct expectedVersion and bumps the version', async () => {
    const created = await createClient();

    const res = await request(app)
      .put(`/v1/clients/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Renamed Co', expectedVersion: 1 })
      .expect(200);

    expect(res.body.data.name).toBe('Renamed Co');
    expect(mockTables.clients.get(created.id).version).toBe(2);
  });

  it('rejects an update with a stale expectedVersion with 409', async () => {
    const created = await createClient();

    // First editor wins and bumps the row to version 2.
    await request(app)
      .put(`/v1/clients/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'First Editor Co', expectedVersion: 1 })
      .expect(200);

    // Second editor still holds version 1 and must be rejected.
    const res = await request(app)
      .put(`/v1/clients/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Second Editor Co', expectedVersion: 1 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ERR_CONCURRENCY_CONFLICT');
    expect(res.body.detail).toBe(CONFLICT_DETAIL);

    // The losing write must not overwrite the winning one.
    expect(mockTables.clients.get(created.id).name).toBe('First Editor Co');
    expect(mockTables.clients.get(created.id).version).toBe(2);
  });

  it('accepts the If-Match header as a fallback expectedVersion channel', async () => {
    const created = await createClient();

    const res = await request(app)
      .put(`/v1/clients/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .set('If-Match', '"1"')
      .send({ name: 'Header Guarded Co' })
      .expect(200);

    expect(res.body.data.name).toBe('Header Guarded Co');
    expect(mockTables.clients.get(created.id).version).toBe(2);

    // And the same stale header must conflict once the row has moved on.
    const stale = await request(app)
      .put(`/v1/clients/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .set('If-Match', '"1"')
      .send({ name: 'Stale Header Co' });

    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ERR_CONCURRENCY_CONFLICT');
  });

  it('keeps updates without any version hint working unchanged (backward compat)', async () => {
    const created = await createClient();

    const res = await request(app)
      .put(`/v1/clients/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Legacy Co' })
      .expect(200);

    expect(res.body.data.name).toBe('Legacy Co');
    // No expectedVersion -> no version bump (unchanged legacy semantics).
    expect(mockTables.clients.get(created.id).version).toBe(1);
  });

  it('enforces the version guard on the transactional invoice update RPC', async () => {
    // Seed the FK targets with real UUID shapes (invoice schema requires
    // uuid-formatted client/work-request ids).
    const CLIENT_UUID = '11111111-1111-1111-1111-111111111111';
    const WR_UUID = '33333333-3333-3333-3333-333333333333';
    mockTables.clients.set(CLIENT_UUID, {
      id: CLIENT_UUID,
      entity_id: 'ent-ata',
      name: 'OCC Invoice Client',
      tin: '555-666-777-00009',
      status: 'Active',
    });
    mockTables.work_requests.set(WR_UUID, {
      id: WR_UUID,
      entity_id: 'ent-ata',
      client_id: CLIENT_UUID,
      title: 'OCC Audit',
      status: 'In Progress',
    });

    const TASK_UUID = '44444444-4444-4444-4444-444444444444';
    mockTables.tasks.set(TASK_UUID, {
      id: TASK_UUID,
      work_request_id: WR_UUID,
      title: 'OCC Task',
      status: 'In Progress',
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        invoiceNumber: 'ATA-SI-2026-900',
        clientId: CLIENT_UUID,
        workRequestId: WR_UUID,
        taskId: TASK_UUID,
        issueDate: '2026-07-01',
        dueDate: '2026-07-31',
        status: 'Draft',
        lineItems: [{ description: 'Professional services', amount: 10000, type: 'Professional Fee' }],
      })
      .expect(201);

    const invoiceId = created.body.data.id;
    expect(mockTables.invoices.get(invoiceId).version).toBe(1);

    // Correct version applies and bumps.
    const ok = await request(app)
      .put(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ notes: 'Updated with OCC', expectedVersion: 1 })
      .expect(200);

    expect(ok.body.data.notes).toBe('Updated with OCC');
    expect(mockTables.invoices.get(invoiceId).version).toBe(2);

    // Stale version conflicts.
    const stale = await request(app)
      .put(`/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ notes: 'Stale write', expectedVersion: 1 });

    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ERR_CONCURRENCY_CONFLICT');
    expect(mockTables.invoices.get(invoiceId).notes).toBe('Updated with OCC');
  });
});
