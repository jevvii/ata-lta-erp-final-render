jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const { randomUUID } = require('crypto');
const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, resetMock, seedDefaults, mockTables, supabaseAdmin } = require('./fixtures/supabaseMock');

describe('Checklist persistence and failed reads', () => {
  let token;
  let wr;
  let task;
  let doc;
  let prerequisite;
  const path = () => `/v1/operations/work-requests/${wr.id}/tasks/${task.id}`;
  const authorized = (req) => req.set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA');

  beforeEach(() => {
    resetMock();
    seedDefaults();
    const userId = randomUUID();
    token = registerUser({ id: userId, role: 'Admin', name: 'Checklist owner', entities: ['ATA'], email: 'checklist@example.test' });
    wr = { id: randomUUID(), entity_id: 'ent-ata', title: 'Checklist request', phase: 'pre_processing', status: 'Pre-processing', version: 1, deleted_at: null };
    task = { id: randomUUID(), work_request_id: wr.id, title: 'Prepare filing', phase: 'pre_processing', status: 'Draft', version: 1, deleted_at: null };
    prerequisite = { id: randomUUID(), task_id: task.id, text: 'Collect records', category: 'subtask', completed: false, created_at: '2026-10-01T00:00:00Z' };
    doc = { id: randomUUID(), task_id: task.id, text: 'Tax certificate', category: 'document', completed: false,
      period_year: '2025/2026', depends_on: [prerequisite.id], assignee_id: userId, assignee_name: 'Checklist owner', created_at: '2026-10-02T00:00:00Z' };
    mockTables.work_requests.set(wr.id, wr);
    mockTables.tasks.set(task.id, task);
    mockTables.task_checklists.set(doc.id, doc);
    mockTables.task_checklists.set(prerequisite.id, prerequisite);
  });

  afterEach(() => jest.restoreAllMocks());

  const failChecklistReads = () => {
    const original = supabaseAdmin.from;
    jest.spyOn(supabaseAdmin, 'from').mockImplementation((name) => {
      const query = original(name);
      if (name === 'task_checklists') {
        query.then = (resolve) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'Checklist storage unavailable' } }).then(resolve);
      }
      return query;
    });
  };

  const readRoutes = [
    () => path(),
    () => `/v1/operations/work-requests/${wr.id}/tasks`,
    () => `/v1/operations/work-requests/${wr.id}`,
    () => '/v1/operations/work-requests?includeTasks=true',
  ];

  it.each(readRoutes)('reads saved checklists without a nonexistent sort_order column (%#)', async (route) => {
    const original = supabaseAdmin.from;
    jest.spyOn(supabaseAdmin, 'from').mockImplementation((name) => {
      const query = original(name);
      if (name === 'task_checklists') {
        const order = query.order;
        query.order = (column, options) => {
          if (column === 'sort_order') {
            query.then = (resolve) => Promise.resolve({ data: null, error: { code: '42703', message: 'column task_checklists.sort_order does not exist' } }).then(resolve);
          }
          return order(column, options);
        };
      }
      return query;
    });
    const res = await authorized(request(app).get(route())).expect(200);
    const graph = Array.isArray(res.body.data) ? res.body.data[0] : res.body.data;
    const readTask = graph.tasks?.[0] || graph;
    expect(readTask.checklist.map((item) => item.id)).toEqual([prerequisite.id, doc.id]);
    expect(readTask.checklist[1]).toMatchObject({ category: 'document', periodYear: '2025/2026', dependsOn: [prerequisite.id] });
  });

  it.each(readRoutes)('reports a checklist query failure instead of a successful empty checklist (%#)', async (route) => {
    failChecklistReads();
    const res = await authorized(request(app).get(route())).expect(500);
    expect(res.body.code).toBe('TASK_CHECKLIST_READ_FAILED');
  });

  it('rejects a replacement when the current checklist could not be read', async () => {
    const before = [...mockTables.task_checklists.values()].map((item) => ({ ...item }));
    failChecklistReads();
    await authorized(request(app).put(path())).send({ checklist: [{ text: 'New item', completed: false }] }).expect(500);
    expect([...mockTables.task_checklists.values()]).toEqual(before);
    expect(mockTables.tasks.get(task.id).version).toBe(1);
  });

  it('preserves omitted metadata when a legacy client adds an item', async () => {
    const log = { id: randomUUID(), task_id: task.id, checklist_item_id: doc.id, date: '2026-10-01', hours: 1 };
    mockTables.task_time_logs.set(log.id, log);
    await authorized(request(app).put(path())).send({ checklist: [
      { id: prerequisite.id, text: prerequisite.text, completed: true },
      { id: doc.id, text: doc.text, completed: false },
      { text: 'Review filing', category: 'subtask', completed: false },
    ] }).expect(200);
    expect(mockTables.task_checklists.get(doc.id)).toMatchObject(doc);
    expect(mockTables.task_time_logs.get(log.id)).toEqual(log);
    expect(mockTables.task_checklists.size).toBe(3);
  });

  it('allows explicitly clearing metadata on retained items', async () => {
    await authorized(request(app).put(path())).send({ checklist: [
      { id: prerequisite.id, text: prerequisite.text, completed: false },
      { id: doc.id, text: doc.text, completed: false, category: 'subtask', periodYear: null,
        assigneeId: null, assigneeName: null, dependsOn: [] },
    ] }).expect(200);
    expect(mockTables.task_checklists.get(doc.id)).toMatchObject({ category: 'subtask', period_year: null,
      assignee_id: null, assignee_name: null, depends_on: [] });
  });

  it('rejects a stale checklist snapshot without replacing newer items', async () => {
    mockTables.tasks.get(task.id).version = 2;
    const before = [...mockTables.task_checklists.values()].map((item) => ({ ...item }));
    const res = await authorized(request(app).put(path())).send({
      expectedVersion: 1, checklist: [{ text: 'Stale replacement', completed: false }],
    }).expect(409);
    expect(res.body.code).toBe('ERR_CONCURRENCY_CONFLICT');
    expect([...mockTables.task_checklists.values()]).toEqual(before);
  });

  describe('Task completion requires a checked checklist', () => {
    it.each([
      () => path(), () => `/v1/operations/tasks/${task.id}`,
      () => `/v1/work-requests/${wr.id}/tasks/${task.id}`, () => `/v1/tasks/${task.id}`,
    ])('rejects completion through route alias %# while any item is unchecked', async (route) => {
      const res = await authorized(request(app).patch(route())).send({ status: 'Completed' }).expect(409);
      expect(res.body.code).toBe('TASK_CHECKLIST_INCOMPLETE');
      expect(mockTables.tasks.get(task.id)).toMatchObject({ status: 'Draft', version: 1 });
    });

    it('allows completion after every saved checklist item is checked', async () => {
      prerequisite.completed = true;
      doc.completed = true;
      const res = await authorized(request(app).patch(path())).send({ status: 'Completed' }).expect(200);
      expect(res.body.data.status).toBe('Completed');
    });

    it('allows a task without checklist items to be completed', async () => {
      mockTables.task_checklists.clear();
      await authorized(request(app).patch(path())).send({ status: 'Completed' }).expect(200);
    });

    it('still allows starting work while checklist items are incomplete', async () => {
      await authorized(request(app).patch(path())).send({ status: 'In Progress' }).expect(200);
    });

    it('does not accept an unsaved checked snapshot as proof of completion', async () => {
      const res = await authorized(request(app).put(path())).send({ status: 'Completed', checklist: [
        { id: prerequisite.id, text: prerequisite.text, completed: true },
        { id: doc.id, text: doc.text, completed: true },
      ] }).expect(409);
      expect(res.body.code).toBe('TASK_CHECKLIST_INCOMPLETE');
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('rejects adding an unchecked item in the same request that completes the task', async () => {
      prerequisite.completed = true;
      doc.completed = true;
      await authorized(request(app).put(path())).send({ status: 'Completed', checklist: [
        { id: prerequisite.id, text: prerequisite.text, completed: true },
        { id: doc.id, text: doc.text, completed: true }, { text: 'New unfinished item', completed: false },
      ] }).expect(409);
      expect(mockTables.tasks.get(task.id).status).toBe('Draft');
    });

    it('does not mark a task complete if its checklist could not be read', async () => {
      failChecklistReads();
      await authorized(request(app).patch(path())).send({ status: 'Completed' }).expect(500);
      expect(mockTables.tasks.get(task.id)).toMatchObject({ status: 'Draft', version: 1 });
    });

    it('rejects completion when a concurrent checklist edit changes the task version', async () => {
      prerequisite.completed = true;
      doc.completed = true;
      const original = supabaseAdmin.from;
      jest.spyOn(supabaseAdmin, 'from').mockImplementation((name) => {
        const query = original(name);
        if (name === 'tasks') {
          const update = query.update;
          query.update = (fields) => {
            if (fields.status === 'Completed') { task.version = 2; prerequisite.completed = false; }
            return update(fields);
          };
        }
        return query;
      });
      await authorized(request(app).patch(path())).send({ status: 'Completed' }).expect(409);
      expect(mockTables.tasks.get(task.id).status).toBe('Draft');
    });
  });

  describe('Checklist content and completion permissions', () => {
    const staff = (assigned = true, departments = ['Operations']) => {
      const id = randomUUID();
      const staffToken = registerUser({ id, role: 'Operations', name: 'Assigned worker', departments,
        entities: ['ATA'], email: `${id}@example.test` });
      wr.assigned_to = id;
      if (assigned) task.assignee_id = id;
      return { id, token: staffToken };
    };
    const update = (authToken, body, method = 'put', target = path()) => request(app)[method](target)
      .set('Authorization', `Bearer ${authToken}`).set('X-Active-Entity', 'ATA').send(body);

    it.each(['put', 'patch'])('allows an assigned worker to check and uncheck items through %s without changing metadata', async (method) => {
      const worker = staff();
      const before = { ...doc };
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: true }], expectedVersion: 1 }, method).expect(200);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(true);
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: false }], expectedVersion: 2 }, method).expect(200);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
      expect(mockTables.task_checklists.get(doc.id)).toEqual(before);
    });

    it('allows co-assignees from the task join table to check an item', async () => {
      const worker = staff(false);
      const assignment = { id: randomUUID(), task_id: task.id, user_id: worker.id };
      mockTables.task_assignees.set(assignment.id, assignment);
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: true }] }).expect(200);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(true);
    });

    it.each([['Operations'], ['Management']])('blocks non-assignees even with %s department access', async (department) => {
      const worker = staff(false, [department]);
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: true }] }).expect(403);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it.each([['Operations'], ['Management']])('blocks content edits by assigned workers with %s access', async (department) => {
      const worker = staff(true, [department]);
      await update(worker.token, { checklist: [{ id: doc.id, text: 'Changed content', completed: true }] }).expect(403);
      expect(mockTables.task_checklists.get(doc.id).text).toBe(doc.text);
      expect(mockTables.task_checklists.size).toBe(2);
    });

    it.each(['Admin', 'Manager'])('allows %s to edit checklist text and clear an optional year', async (role) => {
      const id = randomUUID();
      const editorToken = registerUser({ id, role, departments: ['Management'], entities: ['ATA'], email: `${id}@example.test` });
      wr.assigned_to = id;
      await update(editorToken, { checklist: [
        { id: prerequisite.id, text: prerequisite.text, completed: false },
        { id: doc.id, text: 'Updated document title', category: 'document', periodYear: null, completed: false },
      ] }).expect(200);
      expect(mockTables.task_checklists.get(doc.id)).toMatchObject({ text: 'Updated document title', period_year: null });
    });

    it('rejects content smuggled into a completion update', async () => {
      const worker = staff();
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: true, text: 'Changed' }] }).expect(400);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('rejects checklist items from another task', async () => {
      const worker = staff();
      await update(worker.token, { checklistCompletions: [{ id: randomUUID(), completed: true }] }).expect(404);
      expect(mockTables.tasks.get(task.id).version).toBe(1);
    });

    it('rejects completion until prerequisites are complete', async () => {
      const worker = staff();
      const res = await update(worker.token, { checklistCompletions: [{ id: doc.id, completed: true }] }).expect(409);
      expect(res.body.code).toBe('CHECKLIST_PREREQUISITE');
      expect(mockTables.task_checklists.get(doc.id).completed).toBe(false);
    });

    it('keeps completed work requests and past phases locked', async () => {
      const worker = staff();
      wr.status = 'Completed';
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: true }] }).expect(400);
      wr.status = 'Processing';
      wr.phase = 'processing';
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: true }] }).expect(409);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('does not bump versions or update completions after a failed checklist read', async () => {
      const worker = staff();
      failChecklistReads();
      await update(worker.token, { checklistCompletions: [{ id: prerequisite.id, completed: true }] }).expect(500);
      expect(mockTables.tasks.get(task.id).version).toBe(1);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('prevents non-editors from creating tasks with checklist content', async () => {
      const worker = staff(true, ['Management']);
      await update(worker.token, { title: 'New task', checklist: [{ text: 'New content', completed: false }] },
        'post', `/v1/operations/work-requests/${wr.id}/tasks`).expect(403);
      expect(mockTables.tasks.size).toBe(1);
    });
  });

  it('creates same-title tasks with their own checklist IDs, document periods and prerequisites', async () => {
    const clientId = randomUUID();
    mockTables.clients.set(clientId, { id: clientId, entity_id: 'ent-ata', name: 'Filing client', deleted_at: null });
    const firstId = randomUUID();
    const secondId = randomUUID();
    const thirdId = randomUUID();
    const res = await authorized(request(app).post('/v1/operations/work-requests')).send({
      title: 'New checklist request', clientId, entity: 'ATA', dueDate: '2026-12-31',
      phases: {
        pre_processing: { tasks: [{ title: 'Filing', local_id: 'pre', checklist: [
          { id: firstId, text: 'Collect', category: 'subtask', completed: false },
          { id: secondId, text: 'Certificate', category: 'document', periodYear: '2025/2026', dependsOn: firstId, completed: false },
        ] }] },
        processing: { tasks: [{ title: 'Filing', local_id: 'proc', checklist: [
          { id: thirdId, text: 'Submit', category: 'subtask', completed: false },
        ] }] },
      },
    }).expect(201);
    const [pre, proc] = res.body.data.tasks;
    expect(pre.checklist.map((item) => item.id)).toEqual([firstId, secondId]);
    expect(proc.checklist.map((item) => item.id)).toEqual([thirdId]);
    const saved = await authorized(request(app).get(`/v1/operations/work-requests/${res.body.data.id}`)).expect(200);
    expect(saved.body.data.tasks.find((item) => item.id === pre.id).checklist.find((item) => item.id === secondId))
      .toMatchObject({ periodYear: '2025/2026', dependsOn: [firstId], category: 'document' });
  });

  describe('checklist roles and completion-only updates', () => {
    const become = (role, assigned = true, departments) => {
      const id = randomUUID();
      token = registerUser({ id, role, name: 'Checklist user', email: `${id}@example.test`, entities: ['ATA'], departments });
      // Visibility alone is not task assignment.
      wr.assigned_to = id;
      if (assigned) task.assignee_id = id;
      return id;
    };
    const complete = (items = [{ id: prerequisite.id, completed: true }], version = 1) =>
      authorized(request(app).put(path())).send({ checklistCompletions: items, expectedVersion: version });

    it.each(['primary', 'co-assignee'])('allows a task %s to tick and untick without changing content', async (assignment) => {
      const id = become('Operations', assignment === 'primary');
      if (assignment === 'co-assignee') {
        mockTables.task_assignees.set('co-assignee', { id: 'co-assignee', task_id: task.id, user_id: id });
      }
      await complete().expect(200);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(true);
      expect(mockTables.task_checklists.get(doc.id)).toEqual(doc);
      expect(mockTables.task_checklists.size).toBe(2);
      await complete([{ id: prerequisite.id, completed: false }], 2).expect(200);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it.each(['Operations', 'Accounting', 'Documentation', 'HR'])('denies checklist content edits by assigned %s staff', async (role) => {
      become(role);
      const res = await authorized(request(app).put(path())).send({ checklist: [{ id: doc.id, text: 'Changed text', completed: true }] }).expect(403);
      expect(res.body.detail).toMatch(/status|managers and admins/i);
      expect(mockTables.task_checklists.get(doc.id).text).toBe(doc.text);
      expect(mockTables.task_checklists.size).toBe(2);
    });

    it('denies content edits even when a non-manager has workflow:edit', async () => {
      become('Staff', true, ['Management']);
      const res = await authorized(request(app).put(path())).send({ checklist: [] }).expect(403);
      expect(res.body.code).toBe('CHECKLIST_EDIT_FORBIDDEN');
      expect(mockTables.task_checklists.size).toBe(2);
    });

    it.each(['Admin', 'Manager'])('allows an authenticated %s to edit text, classification and optional year', async (role) => {
      become(role, false);
      await authorized(request(app).put(path())).send({ checklist: [
        { id: prerequisite.id, text: prerequisite.text, completed: false },
        { id: doc.id, text: 'Updated certificate', category: 'document', periodYear: null, completed: false },
      ] }).expect(200);
      expect(mockTables.task_checklists.get(doc.id)).toMatchObject({ text: 'Updated certificate', period_year: null, category: 'document' });
    });

    it('denies completion for a parent work request member who is not assigned to the task', async () => {
      become('Operations', false);
      await complete().expect(403);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('denies completion for an unassigned non-manager with workflow:edit', async () => {
      become('Staff', false, ['Management']);
      const res = await complete().expect(403);
      expect(res.body.code).toBe('CHECKLIST_COMPLETION_FORBIDDEN');
    });

    it('rejects metadata hidden in a completion update', async () => {
      become('Operations');
      await complete([{ id: prerequisite.id, completed: true, text: 'Unauthorized edit' }]).expect(400);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('rejects duplicate checklist IDs', async () => {
      become('Operations');
      await complete([{ id: prerequisite.id, completed: true }, { id: prerequisite.id, completed: false }]).expect(400);
    });

    it('rejects checklist items from another task without applying earlier changes', async () => {
      become('Operations');
      const res = await complete([{ id: prerequisite.id, completed: true }, { id: randomUUID(), completed: true }]).expect(404);
      expect(res.body.code).toBe('CHECKLIST_ITEM_NOT_FOUND');
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('enforces prerequisites before completion', async () => {
      become('Operations');
      const res = await complete([{ id: doc.id, completed: true }]).expect(409);
      expect(res.body.code).toBe('CHECKLIST_PREREQUISITE');
      await complete().expect(200);
      await complete([{ id: doc.id, completed: true }], 2).expect(200);
      expect(mockTables.task_checklists.get(doc.id).completed).toBe(true);
    });

    it.each(['Completed', 'past phase'])('keeps %s work locked', async (state) => {
      become('Operations');
      if (state === 'Completed') wr.status = 'Completed';
      else wr.phase = 'processing';
      await complete().expect(state === 'Completed' ? 400 : 409);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('keeps stale completion writes from changing current data', async () => {
      become('Operations');
      task.version = 2;
      await complete().expect(409);
      expect(mockTables.task_checklists.get(prerequisite.id).completed).toBe(false);
    });

    it('fails closed on a checklist read failure', async () => {
      become('Operations');
      failChecklistReads();
      await complete().expect(500);
      expect(mockTables.tasks.get(task.id).version).toBe(1);
    });

    it('prevents checklist content creation through the task creation API', async () => {
      become('Operations');
      await authorized(request(app).post(`/v1/operations/work-requests/${wr.id}/tasks`))
        .send({ title: 'New task', checklist: [{ text: 'Unauthorized checklist' }] }).expect(403);
      expect(mockTables.tasks.size).toBe(1);
    });
  });
});
