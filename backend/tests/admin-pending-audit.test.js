/**
 * Admin pending-approvals and audit-log integration tests.
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('./fixtures/supabaseMock');

const seedPendingChanges = () => {
  mockTables.pending_changes.set('pc-1', {
    id: 'pc-1',
    entity_id: 'ent-ata',
    table_name: 'clients',
    parent_record_id: null,
    proposed_data: { name: 'New Client' },
    submitted_by: 'user-staff',
    status: 'pending',
    created_at: '2026-07-19T10:00:00.000Z',
  });

  mockTables.pending_changes.set('pc-2', {
    id: 'pc-2',
    entity_id: 'ent-ata',
    table_name: 'clients',
    parent_record_id: 'client-1',
    proposed_data: { name: 'Updated Client' },
    submitted_by: 'user-staff',
    status: 'rejected',
    created_at: '2026-07-19T09:00:00.000Z',
  });

  mockTables.pending_changes.set('pc-3', {
    id: 'pc-3',
    entity_id: 'ent-ata',
    table_name: 'work_requests',
    parent_record_id: null,
    proposed_data: { title: 'New WR' },
    submitted_by: 'user-other',
    status: 'pending',
    created_at: '2026-07-19T08:00:00.000Z',
  });
};

const seedAuditLogs = (count = 25) => {
  for (let i = 0; i < count; i += 1) {
    const id = `audit-${String(i).padStart(3, '0')}`;
    mockTables.audit_logs.set(id, {
      id,
      action: i % 2 === 0 ? 'user.updated' : 'user.created',
      table_name: 'users',
      record_id: `record-${i}`,
      entity: 'ATA',
      user_id: 'user-admin',
      details: { index: i },
      created_at: `2026-07-19T${String(23 - (i % 24)).padStart(2, '0')}:00:00.000Z`,
    });
  }
};

describe('/v1/admin pending approvals and audit', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedPendingChanges();
  });

  it('creates a pending change for any authenticated user', async () => {
    const token = registerUser({
      id: 'user-staff',
      email: 'staff@ata-lta.ph',
      name: 'Staff User',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/admin/pending-approvals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        tableName: 'clients',
        parentRecordId: null,
        proposedData: { name: 'Submitted Client' },
      })
      .expect(201);

    expect(res.body.data.tableName).toBe('clients');
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.submittedBy).toBe('user-staff');
    expect(res.body.data.proposedData).toEqual({ name: 'Submitted Client' });
  });

  it('lists pending approvals with a status filter', async () => {
    const token = registerUser({
      id: 'user-manager',
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals?status=pending')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((item) => item.status === 'pending')).toBe(true);
  });

  it('lists rejected changes filtered by tableName', async () => {
    const token = registerUser({
      id: 'user-manager',
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals?status=rejected&tableName=clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('pc-2');
    expect(res.body.data[0].status).toBe('rejected');
    expect(res.body.data[0].tableName).toBe('clients');
  });

  it('filters pending approvals by parentRecordId and submittedBy', async () => {
    const token = registerUser({
      id: 'user-manager',
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get(
        '/v1/admin/pending-approvals?status=rejected&parentRecordId=client-1&submittedBy=user-staff'
      )
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('pc-2');
  });

  it('gets a pending change by id', async () => {
    const token = registerUser({
      id: 'user-manager',
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals/pc-1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.id).toBe('pc-1');
    expect(res.body.data.tableName).toBe('clients');
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 404 for missing pending change', async () => {
    const token = registerUser({
      id: 'user-manager',
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals/pc-missing')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);

    expect(res.body.title).toMatch(/not found/i);
  });

  it('lists audit logs with pagination', async () => {
    seedAuditLogs(25);

    const token = registerUser({
      id: 'user-admin',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/audit?limit=10&offset=0')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta).toMatchObject({
      limit: 10,
      offset: 0,
    });
    expect(typeof res.body.meta.total).toBe('number');
    expect(typeof res.body.meta.hasMore).toBe('boolean');
  });

  it('filters audit logs by action', async () => {
    seedAuditLogs(10);

    const token = registerUser({
      id: 'user-admin',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/audit?action=user.updated')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.every((row) => row.action === 'user.updated')).toBe(true);
  });

  it('rejects invalid audit query params', async () => {
    const token = registerUser({
      id: 'user-admin',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/audit?limit=200')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(400);

    expect(res.body.title).toMatch(/validation error/i);
  });
});
