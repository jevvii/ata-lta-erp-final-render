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
const DEFAULT_TASK_ID = 'e1111111-1111-4111-8111-111111111111';

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
  mockTables.tasks.set(DEFAULT_TASK_ID, {
    id: DEFAULT_TASK_ID,
    work_request_id: WORK_REQUEST_ID,
    title: 'Default Transmittal Task',
    status: 'In Progress',
  });
};

const validTransmittal = {
  clientId: CLIENT_ID,
  workRequestId: WORK_REQUEST_ID,
  linkedTaskId: DEFAULT_TASK_ID,
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
    const USER_ID = 'doc-staff-draft-1';
    const token = registerUser({
      id: USER_ID,
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const taskId = 'd1111111-1111-4111-8111-111111111111';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    const res = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validTransmittal, linkedTaskId: taskId })
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

    const taskId = 'd2222222-2222-4222-8222-222222222222';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    const createRes = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validTransmittal, linkedTaskId: taskId })
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
    const USER_ID = '22222222-3333-4444-8555-666666666666';
    const token = registerUser({
      id: USER_ID,
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const taskId = 'c1111111-2222-4333-8444-555555555555';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    // Seed a draft transmittal
    const transmittalId = 'trans-1';
    mockTables.transmittals.set(transmittalId, {
      id: transmittalId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WORK_REQUEST_ID,
      linked_task_id: taskId,
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
    const USER_ID = '11111111-2222-4333-8444-555555555555';
    const token = registerUser({
      id: USER_ID,
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const taskId = 'b1111111-1111-4111-8111-111111111111';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    // Seed an approved draft transmittal with linked_task_id
    const transmittalId = 'trans-1';
    mockTables.transmittals.set(transmittalId, {
      id: transmittalId,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WORK_REQUEST_ID,
      linked_task_id: taskId,
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

  it('creates a transmittal linked to a task', async () => {
    const USER_ID = 'doc-staff-linked-task-1';
    const token = registerUser({
      id: USER_ID,
      email: 'doc@ata-lta.ph',
      name: 'Doc Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const taskId = 'd3b07384-d113-460b-80a2-234567890123';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    const res = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validTransmittal, linkedTaskId: taskId })
      .expect(201);

    expect(res.body.data.linked_task_id).toBe(taskId);
  });

  it('allocates sequential unique tracking numbers when trackingNumber is omitted', async () => {
    const USER_ID = 'doc-seq-staff-1';
    const token = registerUser({
      id: USER_ID,
      email: 'doc-seq@ata-lta.ph',
      name: 'Doc Seq Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const taskId = 'b2222222-2222-4222-8222-222222222222';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    const year = new Date().getFullYear();
    const payloadWithoutTracking = {
      clientId: CLIENT_ID,
      workRequestId: WORK_REQUEST_ID,
      linkedTaskId: taskId,
      items: [{ description: 'Document Batch 1', documentType: 'Contract', quantity: 1 }],
    };

    const res1 = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(payloadWithoutTracking)
      .expect(201);

    expect(res1.body.data.tracking_number).toBe(`TR-ATA-${year}-0001`);

    const res2 = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(payloadWithoutTracking)
      .expect(201);

    expect(res2.body.data.tracking_number).toBe(`TR-ATA-${year}-0002`);
  });

  it('disallows updating tracking_number on existing transmittal', async () => {
    const USER_ID = '33333333-4444-4555-8666-777777777777';
    const token = registerUser({
      id: USER_ID,
      email: 'doc-update@ata-lta.ph',
      name: 'Doc Update Staff',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const taskId = 'b3333333-3333-4333-8333-333333333333';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      assignee_id: USER_ID,
      deleted_at: null,
    });

    const createRes = await request(app)
      .post('/v1/transmittals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validTransmittal, linkedTaskId: taskId })
      .expect(201);

    const initialTracking = createRes.body.data.tracking_number;
    expect(initialTracking).toBe('TR-12345');

    const updateRes = await request(app)
      .put(`/v1/transmittals/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        trackingNumber: 'TR-TAMPERED-9999',
        notes: 'Updated notes',
      })
      .expect(200);

    expect(updateRes.body.data.notes).toBe('Updated notes');
    expect(updateRes.body.data.tracking_number).toBe('TR-12345');
  });
  describe('Consolidated transmittal entity resolution', () => {
    const id = 'fae8185a-7ea3-4096-b10d-a74c5bd580ca';
    const wrIdLta = '44444444-5555-4666-8777-888888888888';
    let token;
    beforeEach(() => {
      token = registerUser({ email: 'admin-consolidated@ata-lta.ph', name: 'Admin', role: 'Admin', entities: ['ATA', 'LTA'] });
      mockTables.work_requests.set(wrIdLta, {
        id: wrIdLta,
        entity_id: 'ent-lta',
        client_id: CLIENT_ID,
        title: 'LTA Work Request',
        status: 'In Progress',
      });
      const taskIdLta = 'e2222222-2222-4222-8222-222222222222';
      mockTables.tasks.set(taskIdLta, {
        id: taskIdLta,
        work_request_id: wrIdLta,
        title: 'LTA Task',
        status: 'In Progress',
      });
      mockTables.transmittals.set(id, {
        id, entity_id: 'ent-lta', client_id: CLIENT_ID, work_request_id: wrIdLta, linked_task_id: taskIdLta, status: 'Acknowledged', version: 1,
      });
    });

    it.each(['ALL', undefined])('reads LTA details with entity header %s', async (entity) => {
      const req = request(app).get(`/v1/transmittals/${id}`).set('Authorization', `Bearer ${token}`);
      if (entity) req.set('X-Active-Entity', entity);
      const res = await req.expect(200);
      expect(res.body.data.entity_code).toBe('LTA');
    });

    it('saves inline items without requiring clientId in ALL view', async () => {
      const res = await request(app).put(`/v1/transmittals/${id}`)
        .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ALL')
        .send({ items: [{ description: 'Added inline', documentType: 'Original Copy', quantity: 1 }], expectedVersion: 1 })
        .expect(200);
      expect(res.body.data.items[0].description).toBe('Added inline');
      expect(res.body.data.entity_id).toBe('ent-lta');
      expect(res.body.data.status).toBe('Acknowledged');
    });

    it('rejects non-Admin edits and ignores a forged Admin role in the body', async () => {
      const staffId = '55555555-6666-4777-8888-999999999999';
      const staff = registerUser({ id: staffId, email: 'doc-lta@ata-lta.ph', name: 'Doc', role: 'Documentation', entities: ['LTA'] });
      mockTables.work_requests.get(wrIdLta).assigned_to = staffId;
      await request(app).put(`/v1/transmittals/${id}`)
        .set('Authorization', `Bearer ${staff}`).set('X-Active-Entity', 'LTA')
        .send({ items: [{ description: 'Forbidden edit' }], user: { role: 'Admin' } }).expect(409);
    });

    it('does not remove saved items when the inline version is stale', async () => {
      mockTables.transmittals.get(id).version = 2;
      mockTables.transmittal_items.set('saved-item', { id: 'saved-item', transmittal_id: id, description: 'Saved', quantity: 1 });
      await request(app).put(`/v1/transmittals/${id}`)
        .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ALL')
        .send({ items: [{ description: 'Stale edit' }], expectedVersion: 1 }).expect(409);
      expect(mockTables.transmittal_items.get('saved-item').description).toBe('Saved');
    });

    it('retains explicit ATA scoping and rejects access by ATA-only users', async () => {
      await request(app).get(`/v1/transmittals/${id}`)
        .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA').expect(404);
      const restricted = registerUser({ email: 'ata-only@ata-lta.ph', name: 'Restricted', role: 'Admin', entities: ['ATA'] });
      await request(app).get(`/v1/transmittals/${id}`)
        .set('Authorization', `Bearer ${restricted}`).set('X-Active-Entity', 'ALL').expect(403);
    });
  });

  describe('Task assignment and mandatory task linking enforcement (F06, F07)', () => {
    const DOC_USER_ID = 'e1111111-1111-4111-8111-111111111111';
    const PRIMARY_TASK_ID = 'e2222222-2222-4222-8222-222222222222';
    const COASSIGNEE_TASK_ID = 'e3333333-3333-4333-8333-333333333333';
    const UNASSIGNED_TASK_ID = 'e4444444-4444-4444-8444-444444444444';
    let docToken;

    beforeEach(() => {
      docToken = registerUser({
        id: DOC_USER_ID,
        email: 'doc-scope@ata-lta.ph',
        name: 'Doc Scope Staff',
        role: 'Documentation',
        entities: ['ATA'],
      });

      // Primary assignee task
      mockTables.tasks.set(PRIMARY_TASK_ID, {
        id: PRIMARY_TASK_ID,
        work_request_id: WORK_REQUEST_ID,
        assignee_id: DOC_USER_ID,
        deleted_at: null,
      });

      // Co-assignee task
      mockTables.tasks.set(COASSIGNEE_TASK_ID, {
        id: COASSIGNEE_TASK_ID,
        work_request_id: WORK_REQUEST_ID,
        assignee_id: 'other-primary-assignee',
        deleted_at: null,
      });
      mockTables.task_assignees.set('assignee-int-1', {
        id: 'assignee-int-1',
        task_id: COASSIGNEE_TASK_ID,
        user_id: DOC_USER_ID,
      });

      // Unassigned task
      mockTables.tasks.set(UNASSIGNED_TASK_ID, {
        id: UNASSIGNED_TASK_ID,
        work_request_id: WORK_REQUEST_ID,
        assignee_id: 'other-assignee',
        deleted_at: null,
      });
    });

    it('rejects creation without linkedTaskId for Documentation user (400 Bad Request)', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: null })
        .expect(400);

      expect(res.body.detail).toBe('A valid linked task is required for transmittals');
    });

    it('rejects creation for Documentation user when not assigned to task (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: UNASSIGNED_TASK_ID })
        .expect(403);

      expect(res.body.detail).toBe('You are not assigned to this task');
    });

    it('allows creation when Documentation user is primary assignee (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: PRIMARY_TASK_ID })
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(PRIMARY_TASK_ID);
      expect(res.body.data.status).toBe('Draft');
    });

    it('allows creation when Documentation user is co-assignee (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: COASSIGNEE_TASK_ID })
        .expect(201);

      expect(res.body.data.linked_task_id).toBe(COASSIGNEE_TASK_ID);
      expect(res.body.data.status).toBe('Draft');
    });

    it('prevents Documentation user from clearing linkedTaskId on update (400 Bad Request)', async () => {
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: PRIMARY_TASK_ID })
        .expect(201);

      const transmittalId = createRes.body.data.id;

      const res = await request(app)
        .put(`/v1/transmittals/${transmittalId}`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: null })
        .expect(400);

      expect(res.body.detail).toBe('A valid linked task is required for transmittals');
    });

    it('rejects update to an unassigned task for Documentation user (403 Forbidden)', async () => {
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: PRIMARY_TASK_ID })
        .expect(201);

      const transmittalId = createRes.body.data.id;

      const res = await request(app)
        .put(`/v1/transmittals/${transmittalId}`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ linkedTaskId: UNASSIGNED_TASK_ID })
        .expect(403);

      expect(res.body.detail).toBe('You are not assigned to this task');
    });

    it('allows Documentation user to send approved transmittal when assigned', async () => {
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: PRIMARY_TASK_ID })
        .expect(201);

      const transmittalId = createRes.body.data.id;
      // Mark approved by admin
      mockTables.transmittals.get(transmittalId).approved = true;

      const sendRes = await request(app)
        .post(`/v1/transmittals/${transmittalId}/send`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(sendRes.body.data.status).toBe('Sent');
    });

    it('rejects send if Documentation user is unassigned at send time (403 Forbidden)', async () => {
      const createRes = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...validTransmittal, linkedTaskId: PRIMARY_TASK_ID })
        .expect(201);

      const transmittalId = createRes.body.data.id;
      mockTables.transmittals.get(transmittalId).approved = true;

      // Unassign the user from the task before sending
      mockTables.tasks.get(PRIMARY_TASK_ID).assignee_id = 'different-user';

      const sendRes = await request(app)
        .post(`/v1/transmittals/${transmittalId}/send`)
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(403);

      expect(sendRes.body.detail).toBe('You are not assigned to this task');
    });
  });
});
