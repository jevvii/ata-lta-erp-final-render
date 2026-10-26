jest.mock('../../src/services/supabaseClient', () => ({
  supabaseAdmin: require('../fixtures/supabaseMock').supabaseAdmin,
}));
const request = require('supertest');
const { randomUUID } = require('crypto');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables, supabaseAdmin } = require('../fixtures/supabaseMock');

describe('task document comment assignment', () => {
  let id, userId, token, task, wr;
  const call = (method, suffix = '', entity = 'ATA') => request(app)[method](`/v1/documents/${id}${suffix}`)
    .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', entity);
  const actor = (role) => {
    userId = randomUUID();
    token = registerUser({ id: userId, name: 'Task reviewer', email: `${userId}@example.test`, role, entities: ['ATA', 'LTA'] });
    wr.co_assignees = [userId]; // Project membership permits viewing, never commenting by itself.
  };
  const assign = (kind) => {
    if (kind === 'primary') task.assignee_id = userId;
    else {
      const assignmentId = randomUUID();
      mockTables.task_assignees.set(assignmentId, { id: assignmentId, task_id: task.id, user_id: userId });
    }
  };
  beforeEach(() => {
    resetMock(); seedDefaults();
    id = randomUUID();
    wr = { id: randomUUID(), entity_id: 'ent-ata', deleted_at: null, co_assignees: [] };
    task = { id: randomUUID(), work_request_id: wr.id, assignee_id: null, deleted_at: null };
    mockTables.work_requests.set(wr.id, wr);
    mockTables.tasks.set(task.id, task);
    mockTables.documents.set(id, { id, entity_id: 'ent-ata', work_request_id: wr.id, linked_task_id: task.id, comments: [], deleted_at: null });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(['Operations', 'Accounting', 'HR', 'Documentation', 'Manager'])('allows primary and co-assigned %s reviewers to post, edit, and delete their comments', async (role) => {
    actor(role);
    assign('co');
    expect((await call('get').expect(200)).body.data.can_comment).toBe(true);
    const post = await call('post', '/comments').send({ text: 'Co-assignee review' }).expect(201);
    const suffix = `/comments/${post.body.data.comments[0].id}`;
    await call('put', suffix).send({ text: 'Updated review' }).expect(200);
    await call('delete', suffix).expect(200);
    mockTables.task_assignees.clear();
    assign('primary');
    await call('post', '/comments').send({ text: 'Primary review' }).expect(201);
  });

  it.each(['Operations', 'Accounting', 'Documentation', 'Manager'])('denies unassigned %s despite parent project membership or DMS edit permission', async (role) => {
    actor(role);
    expect((await call('get').expect(200)).body.data.can_comment).toBe(false);
    await call('post', '/comments').send({ text: 'Not assigned' }).expect(403);
    expect(mockTables.documents.get(id).comments).toEqual([]);
  });

  it('allows an unassigned admin, preserving author-only edits and admin deletion', async () => {
    actor('Operations'); assign('co');
    const post = await call('post', '/comments').send({ text: 'Owned review' }).expect(201);
    const suffix = `/comments/${post.body.data.comments[0].id}`;
    actor('Admin');
    expect((await call('get').expect(200)).body.data.can_comment).toBe(true);
    await call('post', '/comments').send({ text: 'Admin review' }).expect(201);
    await call('put', suffix).send({ text: 'Someone else' }).expect(403);
    await call('delete', suffix).expect(200);
  });

  it('revokes posting, editing, and deleting after unassignment', async () => {
    actor('Manager'); assign('co');
    const post = await call('post', '/comments').send({ text: 'Before removal' }).expect(201);
    mockTables.task_assignees.clear();
    const suffix = `/comments/${post.body.data.comments[0].id}`;
    await call('post', '/comments').send({ text: 'After removal' }).expect(403);
    await call('put', suffix).send({ text: 'After removal' }).expect(403);
    await call('delete', suffix).expect(403);
  });

  it('does not accept assignment to a sibling task', async () => {
    actor('Operations');
    const sibling = { id: randomUUID(), work_request_id: wr.id, assignee_id: userId };
    mockTables.tasks.set(sibling.id, sibling);
    await call('post', '/comments').send({ text: 'Sibling only' }).expect(403);
  });

  it('retains entity and deleted-task boundaries for assigned users', async () => {
    actor('Operations'); assign('co');
    await call('post', '/comments', 'LTA').send({ text: 'Wrong entity' }).expect(404);
    task.deleted_at = new Date().toISOString();
    await call('post', '/comments').send({ text: 'Deleted task' }).expect(404);
  });

  it('fails closed without mutating comments if assignment lookup fails', async () => {
    actor('Operations'); assign('co');
    const original = supabaseAdmin.from;
    jest.spyOn(supabaseAdmin, 'from').mockImplementation((name) => {
      const query = original(name);
      if (name === 'task_assignees') query.maybeSingle = async () => ({ data: null, error: { message: 'Assignment storage unavailable' } });
      return query;
    });
    await call('post', '/comments').send({ text: 'Failed lookup' }).expect(500);
    expect(mockTables.documents.get(id).comments).toEqual([]);
  });
});
