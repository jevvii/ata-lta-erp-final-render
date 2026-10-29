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
        password: 'Password123!',
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
        departments: ['Marketing'],
        password: 'Password123!',
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
        password: 'Password123!',
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

    mockTables.clients.set('c1111111-1111-1111-1111-111111111111', {
      id: 'c1111111-1111-1111-1111-111111111111',
      entity_id: entity.id,
      name: 'Client For Pending WR',
      tin: '000-000-000-00002',
    });

    await mockTables.pending_changes.set('pc-wr', {
      id: 'pc-wr',
      entity_id: entity.id,
      table_name: 'work_requests',
      parent_record_id: null,
      proposed_data: {
        title: 'New Proposed Work Request',
        dueDate: '2026-12-31',
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
        password: 'Password123!',
      })
      .expect(201);

    const res = await request(app)
      .get('/v1/admin/audit/count')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.total).toBeGreaterThanOrEqual(1);
  });

  it('returns both active and disabled users in GET /v1/admin/users with version and status', async () => {
    const admin = registerUser({
      id: 'admin-user-1',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });

    registerUser({
      id: 'disabled-user-1',
      email: 'disabled@ata-lta.ph',
      name: 'Disabled Staff',
      role: 'Operations',
      entities: ['ATA'],
      departments: ['Operations'],
      isActive: false,
      version: 3,
    });

    const list = await request(app)
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const activeRow = list.body.data.find((u) => u.id === 'admin-user-1');
    const disabledRow = list.body.data.find((u) => u.id === 'disabled-user-1');

    expect(activeRow).toBeDefined();
    expect(activeRow.isActive).toBe(true);
    expect(activeRow.status).toBe('Active');
    expect(activeRow.version).toBe(1);
    expect(activeRow.departments).toContain('Management');

    expect(disabledRow).toBeDefined();
    expect(disabledRow.isActive).toBe(false);
    expect(disabledRow.status).toBe('Disabled');
    expect(disabledRow.version).toBe(3);
    expect(disabledRow.departments).toContain('Operations');
  });

  it('allows re-enabling a disabled user via status or isActive, prevents self-deactivation, and enforces the 15-active-user cap', async () => {
    const admin = registerUser({
      id: 'admin-self',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    registerUser({
      id: 'disabled-user-reenable',
      email: 'disabled@ata-lta.ph',
      name: 'Disabled User',
      role: 'Accounting',
      entities: ['ATA'],
      isActive: false,
    });

    // Self-deactivation should be rejected
    const selfDisable = await request(app)
      .put('/v1/admin/users/admin-self')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ isActive: false })
      .expect(400);
    expect(selfDisable.body.detail).toMatch(/cannot disable your own account/i);

    // Re-enabling via status: 'Active' works when under cap
    const reenabled = await request(app)
      .put('/v1/admin/users/disabled-user-reenable')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'Active' })
      .expect(200);

    expect(reenabled.body.data.isActive).toBe(true);
    expect(reenabled.body.data.status).toBe('Active');
    expect(reenabled.body.data.version).toBe(2);

    // Disable again via status: 'Disabled'
    const disabledAgain = await request(app)
      .put('/v1/admin/users/disabled-user-reenable')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'Disabled', expectedVersion: 2 })
      .expect(200);

    expect(disabledAgain.body.data.isActive).toBe(false);
    expect(disabledAgain.body.data.status).toBe('Disabled');
    expect(disabledAgain.body.data.version).toBe(3);

    // Fill active users up to 15 (admin-self is 1, add 14 more active users)
    for (let i = 1; i <= 14; i += 1) {
      mockTables.users.set(`cap-active-${i}`, {
        id: `cap-active-${i}`,
        auth_user_id: `auth-cap-${i}`,
        email: `cap${i}@ata-lta.ph`,
        name: `Cap ${i}`,
        role: 'Operations',
        entities: ['ATA'],
        is_active: true,
        version: 1,
      });
    }

    // Re-enabling when 15 active users already exist must be rejected with 403 USER_LIMIT_REACHED
    const capBlocked = await request(app)
      .put('/v1/admin/users/disabled-user-reenable')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ isActive: true })
      .expect(403);

    expect(capBlocked.body.code).toBe('USER_LIMIT_REACHED');
  });

  it('enforces OCC on PUT /v1/admin/users/:id and DELETE /v1/admin/users/:id', async () => {
    const admin = registerUser({
      id: 'admin-occ',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    registerUser({
      id: 'target-occ',
      email: 'target@ata-lta.ph',
      name: 'Target V1',
      role: 'Accounting',
      entities: ['ATA'],
      version: 1,
    });

    // Update with matching expectedVersion=1 -> bumps version to 2
    const updateOk = await request(app)
      .put('/v1/admin/users/target-occ')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Target V2', expectedVersion: 1 })
      .expect(200);

    expect(updateOk.body.data.name).toBe('Target V2');
    expect(updateOk.body.data.version).toBe(2);

    // Stale expectedVersion=1 in body -> 409 ERR_CONCURRENCY_CONFLICT
    const stalePut = await request(app)
      .put('/v1/admin/users/target-occ')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Stale Overwrite', expectedVersion: 1 })
      .expect(409);

    expect(stalePut.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

    // Stale If-Match header on PUT -> 409 ERR_CONCURRENCY_CONFLICT
    const staleIfMatchPut = await request(app)
      .put('/v1/admin/users/target-occ')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .set('If-Match', '"1"')
      .send({ name: 'Stale Header Overwrite' })
      .expect(409);

    expect(staleIfMatchPut.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

    // Stale expectedVersion=1 on DELETE -> 409 ERR_CONCURRENCY_CONFLICT
    const staleDelete = await request(app)
      .delete('/v1/admin/users/target-occ')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .set('If-Match', '1')
      .expect(409);

    expect(staleDelete.body.code).toBe('ERR_CONCURRENCY_CONFLICT');

    // Matching version=2 on DELETE -> 204 No Content and increments version to 3
    await request(app)
      .delete('/v1/admin/users/target-occ')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .set('If-Match', '2')
      .expect(204);

    const updatedRow = mockTables.users.get('target-occ');
    expect(updatedRow.is_active).toBe(false);
    expect(updatedRow.version).toBe(3);
  });

  it('writes exactly 1 audit log row per admin mutation (no duplicate audit rows)', async () => {
    const admin = registerUser({
      id: 'admin-audit-dedup',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    const entity = mockTables.entities.get('ent-ata');

    // 1. POST /v1/admin/users
    const createRes = await request(app)
      .post('/v1/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        email: 'dedup@ata-lta.ph',
        name: 'Dedup User',
        role: 'Accounting',
        entities: ['ATA'],
        departments: ['Accounting'],
        password: 'Password123!',
      })
      .expect(201);

    const createdUserId = createRes.body.data.id;
    let logs = Array.from(mockTables.audit_logs.values());
    expect(logs.filter((l) => l.action === 'user.created' && l.record_id === createdUserId)).toHaveLength(1);

    // 2. PUT /v1/admin/users/:id
    await request(app)
      .put(`/v1/admin/users/${createdUserId}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Dedup User Edited' })
      .expect(200);

    logs = Array.from(mockTables.audit_logs.values());
    const updateLogs = logs.filter((l) => l.action === 'user.updated' && l.record_id === createdUserId);
    expect(updateLogs).toHaveLength(1);
    expect(updateLogs[0].details).toMatchObject({
      name: 'Dedup User Edited',
      email: 'dedup@ata-lta.ph',
      role: 'Accounting',
      status: 'Active',
      isActive: true,
    });

    // 3. DELETE /v1/admin/users/:id
    await request(app)
      .delete(`/v1/admin/users/${createdUserId}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);

    logs = Array.from(mockTables.audit_logs.values());
    expect(logs.filter((l) => l.action === 'user.disabled' && l.record_id === createdUserId)).toHaveLength(1);

    // 4. POST /v1/admin/pending-approvals/:id/approve
    mockTables.pending_changes.set('pc-approve-dedup', {
      id: 'pc-approve-dedup',
      entity_id: entity.id,
      table_name: 'clients',
      parent_record_id: null,
      proposed_data: {
        name: 'Dedup Pending Client',
        tin: '000-000-000-99999',
        entity: 'ATA',
      },
      submitted_by: admin,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    await request(app)
      .post('/v1/admin/pending-approvals/pc-approve-dedup/approve')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    logs = Array.from(mockTables.audit_logs.values());
    expect(logs.filter((l) => l.action === 'pending.approved' && l.record_id === 'pc-approve-dedup')).toHaveLength(1);

    // 5. POST /v1/admin/pending-approvals/:id/reject
    mockTables.pending_changes.set('pc-reject-dedup', {
      id: 'pc-reject-dedup',
      entity_id: entity.id,
      table_name: 'clients',
      parent_record_id: null,
      proposed_data: { name: 'Reject Client' },
      submitted_by: admin,
      status: 'pending',
      created_at: new Date().toISOString(),
    });

    await request(app)
      .post('/v1/admin/pending-approvals/pc-reject-dedup/reject')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ reason: 'Incomplete TIN details' })
      .expect(200);

    logs = Array.from(mockTables.audit_logs.values());
    expect(logs.filter((l) => l.action === 'pending.rejected' && l.record_id === 'pc-reject-dedup')).toHaveLength(1);
  });
});
