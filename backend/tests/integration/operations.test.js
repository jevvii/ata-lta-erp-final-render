/**
 * /v1/work-requests integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock } = require('../fixtures/supabaseMock');

const createClient = async (token, entity, overrides = {}) => {
  const res = await request(app)
    .post('/v1/clients')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity)
    .send({
      name: 'Test Client',
      tin: `123-456-789-${String(Math.random()).slice(2, 7)}`,
      entity,
      ...overrides,
    });
  return res.body.data;
};

describe('/v1/work-requests', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
  });

  it('creates and retrieves a work request', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    const client = await createClient(admin, 'ATA');

    const wrRes = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Annual Audit', clientId: client.id, entity: 'ATA' })
      .expect(201);

    expect(wrRes.body.data.title).toBe('Annual Audit');
    expect(wrRes.body.data.status).toBe('Draft');

    const getRes = await request(app)
      .get(`/v1/work-requests/${wrRes.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(getRes.body.data.clientId).toBe(client.id);
  });

  it('deduplicates rapid consecutive submissions of the same work request', async () => {
    const admin = registerUser({
      email: 'admin-wr-dup@ata-lta.ph',
      name: 'Admin WR Dup',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wrRes1 = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Rapid Audit WR', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const wrRes2 = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Rapid Audit WR', clientId: client.id, entity: 'ATA' })
      .expect(201);

    expect(wrRes2.body.data.id).toBe(wrRes1.body.data.id);
  });

  it('rejects invalid status transitions', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Tax Filing', clientId: client.id, entity: 'ATA' })
      .expect(201);

    await request(app)
      .put(`/v1/work-requests/${wr.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'Completed' })
      .expect(400);
  });

  it('allows valid status transitions', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Review', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const updated = await request(app)
      .put(`/v1/work-requests/${wr.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'In Progress' })
      .expect(200);

    expect(updated.body.data.status).toBe('In Progress');
  });

  it('supports task CRUD under a work request', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Review', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const task = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Prepare documents', checklist: [{ text: 'SEC cert', completed: false }], requiredLinkType: 'transmittal' })
      .expect(201);

    expect(task.body.data.title).toBe('Prepare documents');
    expect(task.body.data.checklist).toHaveLength(1);
    expect(task.body.data.requiredLinkType).toBe('transmittal');

    const tasks = await request(app)
      .get(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(tasks.body.data).toHaveLength(1);

    const singleTask = await request(app)
      .get(`/v1/work-requests/${wr.body.data.id}/tasks/${task.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(singleTask.body.data.id).toBe(task.body.data.id);
    expect(singleTask.body.data.title).toBe('Prepare documents');

    await request(app)
      .delete(`/v1/work-requests/${wr.body.data.id}/tasks/${task.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);
  });

  it('GET /v1/work-requests/:id embeds tasks so deep links open the detail view directly', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Deep Link WR', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const task = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Deep link task', checklist: [{ text: 'Item 1', completed: false }] })
      .expect(201);

    const res = await request(app)
      .get(`/v1/work-requests/${wr.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(Array.isArray(res.body.data.tasks)).toBe(true);
    expect(res.body.data.tasks).toHaveLength(1);
    expect(res.body.data.tasks[0].id).toBe(task.body.data.id);
    expect(res.body.data.tasks[0].title).toBe('Deep link task');
    expect(res.body.data.tasks[0].workRequestId).toBe(wr.body.data.id);
    expect(res.body.data.tasks[0].checklist).toHaveLength(1);
  });

  it('supports logging time under a task via POST /time-logs', async () => {
    const admin = registerUser({
      email: 'admin-tl@ata-lta.ph',
      name: 'Admin TL',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');
    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Time Log Test WR', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const task = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Task with time log',
        checklist: [
          { id: '9a217645-7399-4893-99d0-9a2451b11c74', text: 'Subtask 1', completed: false },
        ],
      })
      .expect(201);

    const checklistItemId = task.body.data.checklist[0].id;

    // Log time
    const updatedTask = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks/${task.body.data.id}/time-logs`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        logs: [
          {
            startTime: '09:00',
            endTime: '17:00',
            date: '2026-07-22',
            hours: 8,
            note: 'Worked on integration test',
            workerName: 'Integration Tester',
            checklistItemId,
          },
        ],
      })
      .expect(201);

    expect(updatedTask.body.data.checklist[0].timeLogs).toHaveLength(1);
    expect(updatedTask.body.data.checklist[0].timeLogs[0].startTime).toBe('09:00');
    expect(updatedTask.body.data.checklist[0].timeLogs[0].endTime).toBe('17:00');
    expect(updatedTask.body.data.checklist[0].timeLogs[0].workerName).toBe('Integration Tester');
  });

  it('forbids workflow:edit for staff without permission', async () => {
    const token = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Ops',
      role: 'Operations',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'WR', clientId: 'does-not-matter' })
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('creates and lists retainer templates', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    await request(app)
      .post('/v1/work-requests/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Monthly Retainer',
        clientId: client.id,
        schedule: 'Monthly',
        pfAmount: 10000,
        tasks: [{ title: 'Prepare FS' }, { title: 'Review FS' }],
      })
      .expect(201);

    const res = await request(app)
      .get('/v1/work-requests/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Monthly Retainer');
  });

  it('updates and deletes a retainer template', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/work-requests/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Quarterly Retainer' })
      .expect(201);

    const updated = await request(app)
      .put(`/v1/work-requests/templates/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ pfAmount: 5000 })
      .expect(200);

    expect(updated.body.data.pf_amount).toBe(5000);

    await request(app)
      .delete(`/v1/work-requests/templates/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);
  });

  it('creates and lists ground workers', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/work-requests/ground-workers')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ name: 'Juan Dela Cruz' })
      .expect(201);

    const res = await request(app)
      .get('/v1/work-requests/ground-workers')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Juan Dela Cruz');
  });

  it('supports task creation with null/optional fields in checklist and task properties', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Review Null Fields', clientId: client.id, entity: 'ATA' })
      .expect(201);

    const task = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Checklist task with null values',
        assigneeId: null,
        assigneeName: null,
        description: null,
        dueDate: null,
        checklist: [
          {
            text: 'Subtask with null assignee',
            completed: false,
            assigneeId: null,
            assigneeName: null,
            category: null,
          },
        ],
      })
      .expect(201);

    expect(task.body.data.title).toBe('Checklist task with null values');
    expect(task.body.data.checklist).toHaveLength(1);
    expect(task.body.data.checklist[0].assigneeId).toBeNull();
    expect(task.body.data.checklist[0].assigneeName).toBeNull();
  });

  it('creates work request in consolidated ALL view auto-detecting client entity without throwing enum error', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    const client = await createClient(admin, 'LTA');

    // 1. With entity: 'ALL' in body
    const wrRes1 = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ALL')
      .send({ title: 'Consolidated WR 1', clientId: client.id, entity: 'ALL' })
      .expect(201);

    expect(wrRes1.body.data.title).toBe('Consolidated WR 1');
    expect(wrRes1.body.data.entity).toBe('LTA');

    // 2. Without entity in body
    const wrRes2 = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ALL')
      .send({ title: 'Consolidated WR 2', clientId: client.id })
      .expect(201);

    expect(wrRes2.body.data.title).toBe('Consolidated WR 2');
    expect(wrRes2.body.data.entity).toBe('LTA');

    // 3. With non-string entity in body (should return 400 validation error, not 500 TypeError)
    await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ALL')
      .send({ title: 'Malformed Entity WR', clientId: client.id, entity: 123 })
      .expect(400);
  });

  it('auto-resolves assigneeName from users table when assigneeId is provided or assigneeName is a raw UUID', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });
    const staffId = '22222222-2222-4222-8222-222222222222';
    registerUser({
      id: staffId,
      email: 'staff@ata-lta.ph',
      name: 'Elena Rostova',
      role: 'Staff',
      entities: ['ATA'],
    });
    const client = await createClient(admin, 'ATA');

    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ title: 'Assignee Resolution Test', clientId: client.id, entity: 'ATA' })
      .expect(201);

    // 1. Create task with assigneeId and NO assigneeName -> should resolve to 'Elena Rostova'
    const task1 = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Task With Assignee ID Only',
        assigneeId: staffId,
      })
      .expect(201);

    expect(task1.body.data.assigneeId).toBe(staffId);
    expect(task1.body.data.assigneeName).toBe('Elena Rostova');

    // 2. Create task where assigneeName was accidentally passed as a raw UUID
    const task2 = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Task With UUID Assignee Name',
        assigneeId: staffId,
        assigneeName: staffId,
      })
      .expect(201);

    expect(task2.body.data.assigneeId).toBe(staffId);
    expect(task2.body.data.assigneeName).toBe('Elena Rostova');

    // 3. Checklist items with assigneeId
    const task3 = await request(app)
      .post(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Task With Checklist Assignee',
        checklist: [
          {
            text: 'Checklist Item 1',
            assigneeId: staffId,
            assigneeName: staffId,
          },
        ],
      })
      .expect(201);

    expect(task3.body.data.checklist[0].assigneeId).toBe(staffId);
    expect(task3.body.data.checklist[0].assigneeName).toBe('Elena Rostova');

    // 4. List tasks verifies name is resolved
    const listRes = await request(app)
      .get(`/v1/work-requests/${wr.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const t1InList = listRes.body.data.find((t) => t.id === task1.body.data.id);
    expect(t1InList.assigneeName).toBe('Elena Rostova');
  });

  it('allows cross-entity work request retrieval by id with fallback', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
    const client = await createClient(admin, 'LTA');

    // Create in LTA
    const wr = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'LTA')
      .send({ title: 'Cross Entity WR', clientId: client.id, entity: 'LTA' })
      .expect(201);

    // Retrieve while active entity is ATA (cross-entity lookup)
    const getRes = await request(app)
      .get(`/v1/work-requests/${wr.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(getRes.body.data.id).toBe(wr.body.data.id);
    expect(getRes.body.data.title).toBe('Cross Entity WR');
  });

  it('persists assignedTo and coAssignees and restricts Manager visibility to assigned work requests', async () => {
    const admin = registerUser({
      email: 'admin-team@ata-lta.ph',
      name: 'Admin Team',
      role: 'Admin',
      entities: ['ATA'],
    });

    const manager1Id = '44444444-1111-1111-1111-111111111111';
    const manager1 = registerUser({
      id: manager1Id,
      email: 'manager1@ata-lta.ph',
      name: 'Manager One',
      role: 'Manager',
      entities: ['ATA'],
    });

    const manager2Id = '44444444-2222-2222-2222-222222222222';
    const manager2 = registerUser({
      id: manager2Id,
      email: 'manager2@ata-lta.ph',
      name: 'Manager Two',
      role: 'Manager',
      entities: ['ATA'],
    });

    const staff1Id = '55555555-1111-1111-1111-111111111111';
    registerUser({
      id: staff1Id,
      email: 'staff1@ata-lta.ph',
      name: 'Staff One',
      role: 'Operations',
      entities: ['ATA'],
    });

    const client = await createClient(admin, 'ATA');

    // 1. Admin creates WR1 with Manager1 as assignedTo and Staff1 as coAssignee
    const wr1Res = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Project Alpha',
        clientId: client.id,
        entity: 'ATA',
        assignedTo: manager1Id,
        coAssignees: ['Staff One'],
      })
      .expect(201);

    expect(wr1Res.body.data.assignedTo).toBe(manager1Id);
    expect(wr1Res.body.data.coAssignees).toEqual(['Staff One']);

    // 2. Admin creates WR2 with Manager2 as assignedTo
    const wr2Res = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Project Beta',
        clientId: client.id,
        entity: 'ATA',
        assignedTo: manager2Id,
        coAssignees: [],
      })
      .expect(201);

    expect(wr2Res.body.data.assignedTo).toBe(manager2Id);

    // 3. Admin sees both WR1 and WR2
    const adminList = await request(app)
      .get('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    const adminWrIds = adminList.body.data.map((w) => w.id);
    expect(adminWrIds).toContain(wr1Res.body.data.id);
    expect(adminWrIds).toContain(wr2Res.body.data.id);

    // 4. Manager1 only sees WR1 (where they are manager), NOT WR2
    const mgr1List = await request(app)
      .get('/v1/work-requests')
      .set('Authorization', `Bearer ${manager1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    const mgr1WrIds = mgr1List.body.data.map((w) => w.id);
    expect(mgr1WrIds).toContain(wr1Res.body.data.id);
    expect(mgr1WrIds).not.toContain(wr2Res.body.data.id);

    // Manager1 can get WR1
    await request(app)
      .get(`/v1/work-requests/${wr1Res.body.data.id}`)
      .set('Authorization', `Bearer ${manager1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    // Manager1 cannot get WR2 (returns 404 since it's filtered out of view)
    await request(app)
      .get(`/v1/work-requests/${wr2Res.body.data.id}`)
      .set('Authorization', `Bearer ${manager1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);

    // 5. Manager2 only sees WR2, NOT WR1
    const mgr2List = await request(app)
      .get('/v1/work-requests')
      .set('Authorization', `Bearer ${manager2}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    const mgr2WrIds = mgr2List.body.data.map((w) => w.id);
    expect(mgr2WrIds).toContain(wr2Res.body.data.id);
    expect(mgr2WrIds).not.toContain(wr1Res.body.data.id);

    // 6. Admin assigns a task in WR2 to Manager1
    await request(app)
      .post(`/v1/work-requests/${wr2Res.body.data.id}/tasks`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Review financials for Beta',
        assigneeId: manager1Id,
        assigneeName: 'Manager One',
      })
      .expect(201);

    // 7. Manager1 now sees BOTH WR1 and WR2 because they are assigned to a task in WR2!
    const mgr1ListUpdated = await request(app)
      .get('/v1/work-requests')
      .set('Authorization', `Bearer ${manager1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    const mgr1UpdatedIds = mgr1ListUpdated.body.data.map((w) => w.id);
    expect(mgr1UpdatedIds).toContain(wr1Res.body.data.id);
    expect(mgr1UpdatedIds).toContain(wr2Res.body.data.id);

    // Manager1 can now get WR2 as well
    await request(app)
      .get(`/v1/work-requests/${wr2Res.body.data.id}`)
      .set('Authorization', `Bearer ${manager1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    // 8. Role enforcement: assignedTo must have role 'Manager'
    const invalidMgrRes = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Project Invalid Manager',
        clientId: client.id,
        entity: 'ATA',
        assignedTo: staff1Id, // staff1 has role 'Operations', not 'Manager'
        coAssignees: [],
      })
      .expect(400);
    expect(invalidMgrRes.body.title).toBe('Invalid Manager');

    // 9. Role enforcement: coAssignees cannot be Manager or Admin
    const invalidMemberRes = await request(app)
      .post('/v1/work-requests')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        title: 'Project Invalid Member',
        clientId: client.id,
        entity: 'ATA',
        assignedTo: manager1Id,
        coAssignees: ['Manager Two'], // Manager Two has role 'Manager'
      })
      .expect(400);
    expect(invalidMemberRes.body.title).toBe('Invalid Team Member');
  });
});

