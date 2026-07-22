/**
 * /v1/admin integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

describe('/v1/admin', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('creates and lists users', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .post('/v1/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        email: 'newuser@ata-lta.ph',
        name: 'New User',
        role: 'Accounting',
        entities: ['ATA'],
        departments: ['Accounting'],
        password: 'password123',
      })
      .expect(201);

    expect(res.body.data.email).toBe('newuser@ata-lta.ph');
    expect(res.body.data.departments).toContain('Accounting');

    const list = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('updates a user successfully', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    // Create the user profile row in the mock db first
    mockTables.users.set('user-to-update-id', {
      id: 'user-to-update-id',
      auth_user_id: 'auth-user-to-update',
      email: 'user-to-update@ata-lta.ph',
      name: 'User To Update',
      role: 'Accounting',
      entities: ['ATA'],
      is_active: true,
    });

    const res = await request(app)
      .put('/v1/admin/users/user-to-update-id')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        email: 'updated-email@ata-lta.ph',
        name: 'Updated Name',
        role: 'Operations',
        entities: ['ATA', 'LTA'],
        departments: ['Operations'],
      })
      .expect(200);

    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.email).toBe('updated-email@ata-lta.ph');
  });

  it('rejects invalid department assignments', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const res = await request(app)
      .post('/v1/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        email: 'baddept@ata-lta.ph',
        name: 'Bad Dept',
        role: 'Accounting',
        entities: ['ATA'],
        departments: ['HR'],
        password: 'password123',
      })
      .expect(400);

    expect(res.body.title).toMatch(/validation error/i);
  });

  it('forbids user management without users:manage', async () => {
    const token = registerUser({
      email: 'accounting@ata-lta.ph',
      name: 'Accounting',
      role: 'Accounting',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        email: 'x@ata-lta.ph',
        name: 'X',
        role: 'Operations',
        entities: ['ATA'],
      })
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('enforces the 15-user account cap', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    // Fill the user table to the cap.
    for (let i = 1; i <= 15; i += 1) {
      mockTables.users.set(`capped-user-${i}`, {
        id: `capped-user-${i}`,
        auth_user_id: `auth-capped-${i}`,
        email: `capped${i}@ata-lta.ph`,
        name: `Capped ${i}`,
        role: 'Accounting',
        entities: ['ATA'],
        is_active: true,
      });
    }

    const res = await request(app)
      .post('/v1/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        email: 'overflow@ata-lta.ph',
        name: 'Overflow',
        role: 'Accounting',
        entities: ['ATA'],
        departments: ['Accounting'],
        password: 'password123',
      })
      .expect(403);

    expect(res.body.detail).toMatch(/maximum number of user accounts/i);
  });

  it('lists and approves a pending change', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    const entity = mockTables.entities.get('ent-ata');

    await mockTables.pending_changes.set('pc-1', {
      id: 'pc-1',
      entity_id: entity.id,
      table_name: 'clients',
      parent_record_id: null,
      proposed_data: {
        name: 'Pending Client',
        tin: '000-000-000-00001',
        entity: 'ATA',
      },
      submitted_by: admin,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    const list = await request(app)
      .get('/v1/admin/pending-approvals')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(list.body.data).toHaveLength(1);

    const approve = await request(app)
      .post('/v1/admin/pending-approvals/pc-1/approve')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(approve.body.data.status).toBe('approved');

    const audit = Array.from(mockTables.audit_logs.values());
    expect(audit.some((a) => a.action === 'pending.approved')).toBe(true);
  });

  it('approves a pending work request and creates tasks associated with it', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    const entity = mockTables.entities.get('ent-ata');

    await mockTables.pending_changes.set('pc-wr', {
      id: 'pc-wr',
      entity_id: entity.id,
      table_name: 'work_requests',
      parent_record_id: null,
      proposed_data: {
        title: 'New Proposed Work Request',
        clientId: 'c1111111-1111-1111-1111-111111111111',
        tasks: [
          {
            id: 'temp-task-1',
            title: 'Subtask 1',
            predecessors: [],
          },
          {
            id: 'temp-task-2',
            title: 'Subtask 2',
            predecessors: ['temp-task-1'],
          },
        ],
      },
      submitted_by: 'manager-user-id-xyz',
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    const approve = await request(app)
      .post('/v1/admin/pending-approvals/pc-wr/approve')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(approve.body.data.status).toBe('approved');

    // Verify work request was created
    const workRequests = Array.from(mockTables.work_requests.values());
    expect(workRequests).toHaveLength(1);
    expect(workRequests[0].title).toBe('New Proposed Work Request');
    expect(workRequests[0].requested_by).toBe('manager-user-id-xyz');

    // Verify tasks were created
    const tasks = Array.from(mockTables.tasks.values());
    expect(tasks).toHaveLength(2);

    const task1 = tasks.find((t) => t.title === 'Subtask 1');
    const task2 = tasks.find((t) => t.title === 'Subtask 2');

    expect(task1).toBeDefined();
    expect(task2).toBeDefined();

    expect(task1.work_request_id).toBe(workRequests[0].id);
    expect(task2.work_request_id).toBe(workRequests[0].id);

    // Predecessors should be correctly mapped to the new task UUID
    expect(task2.predecessors).toContain(task1.id);
  });

  it('returns the audit log count for the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    await request(app)
      .post('/v1/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        email: 'audited@ata-lta.ph',
        name: 'Audited User',
        role: 'Accounting',
        entities: ['ATA'],
        departments: ['Accounting'],
        password: 'password123',
      })
      .expect(201);

    const res = await request(app)
      .get('/v1/admin/audit/count')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });
});
