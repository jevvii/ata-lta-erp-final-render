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

const validDisbursement = {
  category: 'Transportation',
  description: 'Site visit transportation',
  amount: 1500,
  fundSource: 'Firm Fund',
  clientId: CLIENT_ID,
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

  it('forbids disbursement creation without disbursement:create', async () => {
    const token = registerUser({
      email: 'hr@ata-lta.ph',
      name: 'HR Staff',
      role: 'HR',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/disbursements')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validDisbursement)
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('returns tab-badge counts scoped to the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const created = await request(app)
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
});
