/**
 * /v1/transmittals integration tests.
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

const validTransmittal = {
  clientId: CLIENT_ID,
  workRequestId: WORK_REQUEST_ID,
  trackingNumber: 'TR-12345',
  items: [{ description: 'Tax returns', documentType: 'Tax', quantity: 1 }],
  notes: 'Urgent',
  recipientName: 'Juan Dela Cruz',
  recipientDetails: 'Office address',
};

describe('/v1/transmittals', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedClient();
  });

  it('creates a transmittal in Draft status with approved = false', async () => {
    const token = registerUser({
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validTransmittal)
      .expect(201);

    expect(res.body.data.status).toBe('Draft');
    expect(res.body.data.approved).toBe(false);
  });

  it('includes transmittal items in the list response', async () => {
    const USER_ID = '44444444-4444-4444-4444-444444444444';
    const token = registerUser({
      id: USER_ID,
      email: 'doc2@ata-lta.ph',
      name: 'Doc Staff Two',
      role: 'Documentation',
      entities: ['ATA'],
    });

    mockTables.tasks.set('task-trans-list', {
      id: 'task-trans-list',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    const createRes = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validTransmittal)
      .expect(201);

    const listRes = await request(app)
      .get('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const row = (listRes.body.data || []).find((t) => t.id === createRes.body.data.id);
    expect(row).toBeDefined();
    expect(Array.isArray(row.items)).toBe(true);
    expect(row.items.length).toBe(validTransmittal.items.length);
    expect(row.items[0].description).toBe(validTransmittal.items[0].description);
  });

  it('blocks a non-admin user from approving a transmittal', async () => {
    const token = registerUser({
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    // Seed a draft transmittal
    const transmittalId = 'trans-1';
    mockTables.transmittals.set(transmittalId, {
      id: transmittalId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      tracking_number: 'TR-12345',
      status: 'Draft',
      approved: false,
    });

    await request(app)
      .post(`/v1/transmittals/${transmittalId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);
  });

  it('allows an admin user to approve a transmittal', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA'],
    });

    // Seed a draft transmittal
    const transmittalId = 'trans-1';
    mockTables.transmittals.set(transmittalId, {
      id: transmittalId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      tracking_number: 'TR-12345',
      status: 'Draft',
      approved: false,
    });

    const res = await request(app)
      .post(`/v1/transmittals/${transmittalId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.approved).toBe(true);

    // Check in mock database
    const dbRecord = mockTables.transmittals.get(transmittalId);
    expect(dbRecord.approved).toBe(true);
  });

  it('blocks a non-admin user from sending an unapproved transmittal', async () => {
    const token = registerUser({
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    // Seed a draft transmittal
    const transmittalId = 'trans-1';
    mockTables.transmittals.set(transmittalId, {
      id: transmittalId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      tracking_number: 'TR-12345',
      status: 'Draft',
      approved: false,
    });

    const res = await request(app)
      .post(`/v1/transmittals/${transmittalId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);

    expect(res.body.detail).toContain('approved by Admin');
  });

  it('allows a non-admin user to send an approved transmittal', async () => {
    const token = registerUser({
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    // Seed an approved draft transmittal
    const transmittalId = 'trans-1';
    mockTables.transmittals.set(transmittalId, {
      id: transmittalId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      tracking_number: 'TR-12345',
      status: 'Draft',
      approved: true,
    });

    const res = await request(app)
      .post(`/v1/transmittals/${transmittalId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.status).toBe('Sent');
  });

  it('allows an admin to send an unapproved transmittal directly', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA'],
    });

    // Seed an unapproved draft transmittal
    const transmittalId = 'trans-1';
    mockTables.transmittals.set(transmittalId, {
      id: transmittalId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      tracking_number: 'TR-12345',
      status: 'Draft',
      approved: false,
    });

    const res = await request(app)
      .post(`/v1/transmittals/${transmittalId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.status).toBe('Sent');
  });

  it('allows an admin user to create a transmittal when active entity is ALL (resolves to fallback)', async () => {
    const token = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ALL')
      .send(validTransmittal)
      .expect(201);

    expect(res.body.data.status).toBe('Draft');
    expect(res.body.data.entity_id).toBe('ent-ata'); // Fallback resolves to first entity UUID/ID
  });
});
