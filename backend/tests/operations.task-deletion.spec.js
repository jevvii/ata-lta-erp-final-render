jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});
const { randomUUID } = require('crypto');
const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables, supabaseAdmin } = require('./fixtures/supabaseMock');
const routes = [
  (wr, task) => `/v1/operations/work-requests/${wr}/tasks/${task}`,
  (wr, task) => `/v1/operations/${wr}/tasks/${task}`,
  (wr, task) => `/v1/operations/tasks/${task}`,
  (wr, task) => `/v1/work-requests/${wr}/tasks/${task}`,
  (wr, task) => `/v1/tasks/${task}`,
];
describe('Task deletion preserves phase history and supporting documents', () => {
  let token;
  let wr;
  let task;
  beforeEach(() => {
    resetMock();
    seedDefaults();
    token = registerUser({ id: randomUUID(), role: 'Admin', entities: ['ATA'], email: 'deletion-admin@example.test' });
    wr = { id: randomUUID(), entity_id: 'ent-ata', title: 'Protected request', phase: 'pre_processing', status: 'Pre-processing', deleted_at: null };
    task = { id: randomUUID(), work_request_id: wr.id, title: 'Task', phase: 'pre_processing', status: 'Draft', deleted_at: null };
    mockTables.work_requests.set(wr.id, wr);
    mockTables.tasks.set(task.id, task);
  });
  afterEach(() => jest.restoreAllMocks());
  const remove = (route = routes[0]) => request(app).delete(route(wr.id, task.id))
    .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA');
  const link = (table, fields = {}) => {
    const row = { id: randomUUID(), work_request_id: wr.id, entity_id: wr.entity_id, linked_task_id: task.id, deleted_at: null, ...fields };
    mockTables[table].set(row.id, row);
    return row;
  };
  const expectProtected = async (code, route) => {
    const res = await remove(route);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe(code);
    expect(mockTables.tasks.get(task.id).deleted_at).toBeNull();
    return res;
  };
  it.each(routes)('blocks past-phase deletion through every route alias (%#)', async (route) => {
    wr.phase = 'processing';
    wr.status = 'Processing';
    await expectProtected('PAST_PHASE_TASK_LOCKED', route);
  });
  it.each(['Draft', 'Assigned', 'In Progress', 'Completed', 'Cancelled'])('protects %s past-phase tasks', async (status) => {
    wr.phase = 'quality_assurance';
    task.status = status;
    task.phase = 'processing';
    await expectProtected('PAST_PHASE_TASK_LOCKED');
  });
  it.each(routes)('blocks uploaded documents through every route alias (%#)', async (route) => {
    link('documents', { file_name: 'receipt.pdf' });
    const res = await expectProtected('TASK_HAS_DOCUMENTS', route);
    expect(res.body.detail).toMatch(/cannot delete.*documents\/receipts/i);
  });
  it.each([
    ['invoices', 'task_id'], ['invoices', 'linked_task_id'],
    ['disbursements', 'task_id'], ['disbursements', 'linked_task_id'],
    ['transmittals', 'linked_task_id'],
  ])('protects linked %s via %s and exposes the guard in task reads', async (table, field) => {
    link(table, { linked_task_id: null, [field]: task.id, receipt_s3_key: 'receipt.png' });
    await expectProtected('TASK_HAS_DOCUMENTS');
    for (const path of [
      `/v1/operations/work-requests/${wr.id}/tasks`,
      `/v1/operations/work-requests/${wr.id}/tasks/${task.id}`,
      `/v1/operations/work-requests/${wr.id}?includeTasks=true`,
    ]) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${token}`).set('X-Active-Entity', 'ATA');
      expect(res.status).toBe(200);
      const data = Array.isArray(res.body.data) ? res.body.data[0] : res.body.data.tasks?.[0] || res.body.data;
      expect(data.hasDocuments).toBe(true);
    }
  });
  it('allows an unlinked current-phase task to be deleted', async () => {
    expect((await remove()).status).toBe(204);
    expect(mockTables.tasks.get(task.id).deleted_at).toBeTruthy();
  });
  it('allows an unlinked future-phase task to be deleted', async () => {
    task.phase = 'processing';
    expect((await remove()).status).toBe(204);
  });
  it('ignores deleted documents and unrelated tasks, including stale legacy financial links', async () => {
    link('documents', { deleted_at: new Date().toISOString() });
    link('disbursements', { deleted_at: new Date().toISOString() });
    link('invoices', { task_id: randomUUID() });
    link('documents', { linked_task_id: randomUUID() });
    expect((await remove()).status).toBe(204);
  });
  it.each(['documents', 'invoices', 'disbursements', 'transmittals'])('fails closed if %s cannot be checked', async (table) => {
    const original = supabaseAdmin.from;
    jest.spyOn(supabaseAdmin, 'from').mockImplementation((name) => {
      const query = original(name);
      if (name === table) query.then = (resolve) => Promise.resolve({ data: null, error: { message: 'Unavailable' } }).then(resolve);
      return query;
    });
    expect((await remove()).status).toBe(500);
    expect(mockTables.tasks.get(task.id).deleted_at).toBeNull();
  });
  it('keeps completed work requests locked even for Admin', async () => {
    wr.phase = 'completion';
    const res = await remove();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COMPLETED_WR_LOCKED');
    expect(mockTables.tasks.get(task.id).deleted_at).toBeNull();
  });
  it('does not reveal document protection across entities', async () => {
    wr.entity_id = 'ent-lta';
    link('documents');
    expect((await remove()).status).toBe(404);
    expect(mockTables.tasks.get(task.id).deleted_at).toBeNull();
  });
});
