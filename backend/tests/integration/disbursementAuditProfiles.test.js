jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

describe('Disbursement lifecycle actor profiles', () => {
  const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  let token;
  beforeEach(() => {
    resetMock();
    seedDefaults();
    token = registerUser({ id: actorId, email: 'audit@example.test', name: 'Twinkle Marquez',
      role: 'Admin', entities: ['ATA', 'LTA'] });
    mockTables.disbursements.set(id, { id, entity_id: 'ent-ata', amount: 1500, category: 'Transportation',
      description: 'Client visit', status: 'Approved', created_by: actorId, approved_by: actorId,
      lifecycle_version: 2, version: 2, archived: false, deleted_at: null });
    mockTables.status_history.set('history-create', { id: 'history-create', table_name: 'disbursements',
      record_id: id, old_status: null, new_status: 'Draft', actor_id: actorId,
      details: { action: 'create', amount: 1500 }, created_at: '2026-10-20T01:30:00Z' });
    mockTables.status_history.set('history-approve', { id: 'history-approve', table_name: 'disbursements',
      record_id: id, old_status: 'Draft', new_status: 'Approved', actor_id: actorId,
      details: { action: 'approve', previous_version: 1 }, created_at: '2026-10-20T02:30:00Z' });
  });
  const get = (path, entity = 'ATA') => request(app).get(path)
    .set('Authorization', `Bearer ${token}`).set('X-Active-Entity', entity);

  it('adds actor roles and legacy actor roles without changing actions or audit facts', async () => {
    const { body } = await get(`/v1/disbursements/${id}`).expect(200);
    expect(body.data).toMatchObject({ created_by_name: 'Twinkle Marquez', created_by_role: 'Admin',
      approved_by_name: 'Twinkle Marquez', approved_by_role: 'Admin' });
    expect(body.data.lifecycle_history).toHaveLength(2);
    expect(body.data.lifecycle_history[0]).toMatchObject({ actor_id: actorId,
      actor_name: 'Twinkle Marquez', actor_role: 'Admin', action: 'create', old_status: null,
      new_status: 'Draft', created_at: '2026-10-20T01:30:00Z', details: { action: 'create', amount: 1500 } });
    expect(body.data.lifecycle_history[0]).not.toHaveProperty('email');
  });

  it('includes actor profiles in list results as well as details', async () => {
    const { body } = await get('/v1/disbursements').expect(200);
    expect(body.data[0].lifecycle_history[1]).toMatchObject({
      actor_name: 'Twinkle Marquez', actor_role: 'Admin', action: 'approve',
    });
  });

  it('retains history when an actor profile is missing', async () => {
    const history = mockTables.status_history.get('history-approve');
    history.actor_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const { body } = await get(`/v1/disbursements/${id}`).expect(200);
    expect(body.data.lifecycle_history[1]).toMatchObject({ actor_id: history.actor_id,
      actor_name: null, actor_role: null, action: 'approve', new_status: 'Approved' });
  });

  it('keeps actor history within the selected voucher and entity', async () => {
    mockTables.status_history.set('other-history', { id: 'other-history', table_name: 'disbursements',
      record_id: 'other-voucher', actor_id: actorId, details: { action: 'delete' } });
    const { body } = await get(`/v1/disbursements/${id}`).expect(200);
    expect(body.data.lifecycle_history.map((event) => event.id)).toEqual(['history-create', 'history-approve']);
    await get(`/v1/disbursements/${id}`, 'LTA').expect(404);
  });
});
