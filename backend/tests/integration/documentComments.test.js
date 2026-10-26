jest.mock('../../src/services/supabaseClient', () => ({
  supabaseAdmin: require('../fixtures/supabaseMock').supabaseAdmin,
}));
const request = require('supertest');
const { randomUUID } = require('crypto');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables, supabaseAdmin } = require('../fixtures/supabaseMock');

// Set this ONLY to a disposable database initialized by the comments SQL harness.
// The same HTTP scenarios then execute the actual migration function under contention.
const { Pool } = require('pg');
if (process.env.DOCUMENT_COMMENTS_TEST_DATABASE_URL && !new URL(process.env.DOCUMENT_COMMENTS_TEST_DATABASE_URL).pathname.endsWith('/astra_comments_test')) {
  throw new Error('Database comment tests require the disposable astra_comments_test database');
}
const pool = process.env.DOCUMENT_COMMENTS_TEST_DATABASE_URL
  ? new Pool({ connectionString: process.env.DOCUMENT_COMMENTS_TEST_DATABASE_URL, max: 20 }) : null;
const entityIds = { ATA: randomUUID(), LTA: randomUUID() };
let rpcSpy;
beforeAll(() => {
  if (pool) {
    const original = supabaseAdmin.rpc.bind(supabaseAdmin);
    rpcSpy = jest.spyOn(supabaseAdmin, 'rpc').mockImplementation(async (name, p) => {
      if (name !== 'mutate_document_comment') return original(name, p);
      try {
        const result = await pool.query('SELECT public.mutate_document_comment($1,$2,$3,$4,$5,$6) AS data',
          [p.p_entity_id, p.p_document_id, p.p_comment_id, p.p_user_id, p.p_text, p.p_action]);
        const data = { ...mockTables.documents.get(p.p_document_id), ...result.rows[0].data };
        mockTables.documents.set(data.id, data);
        return { data, error: null };
      } catch (error) { return { data: null, error }; }
    });
  }
});
afterAll(async () => { rpcSpy?.mockRestore(); if (pool) await pool.end(); });

describe('document comment HTTP API', () => {
  let author, peer, admin, viewer, id, authorId, peerId, viewerId;
  const call = (method, token, suffix = '', entity = 'ATA') => request(app)[method](`/v1/documents/${id}/comments${suffix}`)
    .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', entity);
  beforeEach(async () => {
    resetMock(); seedDefaults();
    mockTables.entities.clear();
    for (const [code, entityId] of Object.entries(entityIds)) {
      mockTables.entities.set(entityId, { id: entityId, code, name: code });
    }
    const makeUser = (name, role, edit = true) => {
      const userId = randomUUID();
      const token = registerUser({ id: userId, email: `${userId}@example.test`, name, role, entities: ['ATA', 'LTA'] });
      if (edit) {
        const dept = [...mockTables.departments.values()].find((d) => d.name === 'Documentation');
        mockTables.user_departments.set(randomUUID(), { user_id: userId, department_id: dept.id });
        mockTables.users.get(userId).user_departments = [{ departments: { name: dept.name } }];
      }
      return [token, userId];
    };
    [author, authorId] = makeUser('Author', 'Employee');
    [peer, peerId] = makeUser('Peer', 'Employee');
    [admin] = makeUser('Admin', 'Admin');
    [viewer, viewerId] = makeUser('Viewer', 'Operations', false);
    const created = await request(app).post('/v1/documents').set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA').send({ fileName: 'review.txt' }).expect(201);
    id = created.body.data.document.id;
    // Keep the standalone document inside a shared project: orphan documents
    // are intentionally inaccessible to non-admins under project visibility.
    const wrId = randomUUID();
    mockTables.work_requests.set(wrId, { id: wrId, entity_id: entityIds.ATA,
      co_assignees: [authorId, peerId, viewerId], deleted_at: null });
    mockTables.documents.get(id).work_request_id = wrId;
    if (pool) {
      await pool.query('TRUNCATE documents, users');
      for (const user of mockTables.users.values()) {
        await pool.query('INSERT INTO users(id, name, role, is_active) VALUES($1,$2,$3,$4)', [user.id, user.name, user.role, user.is_active]);
      }
      await pool.query('INSERT INTO documents(id, entity_id, comments) VALUES($1,$2,$3)', [id, mockTables.documents.get(id).entity_id, '[]']);
    }
  });
  it('posts with server identity, edits with metadata, and deletes', async () => {
    const post = await call('post', author).send({ text: '  Review complete  ', userId: 'forged', userName: 'forged' }).expect(201);
    const comment = post.body.data.comments[0];
    expect(comment).toMatchObject({ text: 'Review complete', userId: authorId, userName: 'Author' });
    expect(comment.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(Number.isNaN(Date.parse(comment.date))).toBe(false);
    const edit = await call('put', author, `/${comment.id}`).send({ text: 'Revised' }).expect(200);
    expect(edit.body.data.comments[0]).toMatchObject({ id: comment.id, text: 'Revised', edited: true, userId: authorId });
    expect(edit.body.data.comments[0].edited_at).toBeTruthy();
    const removed = await call('delete', author, `/${comment.id}`).expect(200);
    expect(removed.body.data.comments).toEqual([]);
  });
  it('enforces author-only editing and author-or-admin deletion', async () => {
    const post = await call('post', author).send({ text: 'Owned' }).expect(201);
    const suffix = `/${post.body.data.comments[0].id}`;
    await call('put', peer, suffix).send({ text: 'Not yours' }).expect(403);
    await call('put', admin, suffix).send({ text: 'Not yours' }).expect(403);
    await call('delete', peer, suffix).expect(403);
    await call('delete', admin, suffix).expect(200);
  });
  it.each(['', '  ', 'x'.repeat(4001), null])('rejects invalid text %#', async (text) => {
    await call('post', author).send({ text }).expect(400);
    await call('put', author, '/missing').send({ text }).expect(400);
  });
  it('enforces authentication, permission, tenant, missing and deleted document boundaries', async () => {
    await request(app).post(`/v1/documents/${id}/comments`).send({ text: 'No auth' }).expect(401);
    await call('post', viewer).send({ text: 'No permission' }).expect(403);
    await call('post', author, '', 'LTA').send({ text: 'Wrong tenant' }).expect(404);
    await call('put', author, '/missing').send({ text: 'Missing' }).expect(404);
    await call('delete', author, '/missing').expect(404);
    mockTables.documents.get(id).deleted_at = new Date().toISOString();
    if (pool) await pool.query('UPDATE documents SET deleted_at = now() WHERE id = $1', [id]);
    await call('post', author).send({ text: 'Deleted' }).expect(404);
    id = randomUUID();
    await call('post', author).send({ text: 'Missing doc' }).expect(404);
  });
  it('preserves every concurrent post and unrelated comment during edit/delete contention', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, n) => call('post', n % 2 ? author : peer)
      .send({ text: `Message ${n}` }).expect(201)));
    const first = results[0].body.data.comments.find((c) => c.text === 'Message 0');
    const second = results[1].body.data.comments.find((c) => c.text === 'Message 1');
    await Promise.all([
      call('put', peer, `/${first.id}`).send({ text: 'Edited concurrently' }).expect(200),
      call('delete', author, `/${second.id}`).expect(200),
      call('post', author).send({ text: 'New concurrent message' }).expect(201),
    ]);
    const doc = pool ? (await pool.query('SELECT comments FROM documents WHERE id = $1', [id])).rows[0] : mockTables.documents.get(id);
    expect(doc.comments).toHaveLength(20);
    expect(new Set(doc.comments.map((c) => c.id)).size).toBe(20);
    expect(doc.comments.find((c) => c.id === first.id).text).toBe('Edited concurrently');
    expect(doc.comments.some((c) => c.id === second.id)).toBe(false);
    expect(doc.comments.some((c) => c.text === 'New concurrent message')).toBe(true);
  });
});
