jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('./fixtures/supabaseMock');
const { createWorkRequest } = require('../src/modules/operations/service');
const { updateWorkRequestSchema } = require('../src/modules/operations/schema');

const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const invalidDates = [
  undefined,
  null,
  '',
  '   ',
  'invalid',
  '2026-02-30',
  '2026-13-01',
  '12/31/2026',
  42,
];

describe('Work request due dates', () => {
  let token;
  beforeEach(() => {
    resetMock();
    seedDefaults();
    token = registerUser({
      id: ADMIN_ID,
      email: 'due-date-admin@example.com',
      name: 'Due Date Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });
  });

  describe.each(['/v1/work-requests', '/v1/operations/work-requests'])('%s', (path) => {
    it.each(invalidDates)(
      'rejects invalid due date %p before creating records',
      async (dueDate) => {
        const res = await request(app)
          .post(path)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Active-Entity', 'ATA')
          .send({
            title: 'Required deadline',
            dueDate,
            phases: { pre_processing: { tasks: [{ title: 'Intake' }] } },
          });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.detail).toContain('dueDate');
        expect(mockTables.work_requests.size).toBe(0);
        expect(mockTables.tasks.size).toBe(0);
      }
    );

    it.each(['2026-12-31', '2026-12-31T00:00:00.000Z', '2026-12-31T08:00:00+08:00'])(
      'persists valid due date %s',
      async (dueDate) => {
        const res = await request(app)
          .post(path)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Active-Entity', 'ATA')
          .send({ title: 'Dated request', dueDate });
        expect(res.status).toBe(201);
        expect(res.body.data.dueDate).toBe(dueDate);
      }
    );
  });

  it.each(['retainer', 'other'])(
    'requires a date when generating from a %s template',
    async (type) => {
      const id = 'template-due-date';
      mockTables.retainer_templates.set(id, {
        id,
        entity_id: 'ent-ata',
        name: 'Filing',
        template_type: type,
        recurrence: 'none',
        assigned_to: ADMIN_ID,
        tasks: [{ title: 'Intake', phase: 'pre_processing' }],
      });
      for (const prefix of ['/v1/operations/templates', '/v1/operations/retainer-templates']) {
        const res = await request(app)
          .post(`${prefix}/${id}/generate`)
          .set('Authorization', `Bearer ${token}`)
          .set('X-Active-Entity', 'ATA')
          .send({});
        expect(res.status).toBe(400);
        expect(res.body.detail).toContain('Due date is required');
      }
      expect(mockTables.work_requests.size).toBe(0);
      const res = await request(app)
        .post(`/v1/operations/templates/${id}/generate`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send({ overrides: { due_date: '2026-12-31' } });
      expect(res.status).toBe(201);
      expect(res.body.data.dueDate).toBe('2026-12-31');
    }
  );

  it.each(invalidDates)('guards service callers against invalid due date %p', async (dueDate) => {
    await expect(
      createWorkRequest({ entityId: 'ent-ata', data: { title: 'Internal caller', dueDate } })
    ).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(mockTables.work_requests.size).toBe(0);
  });

  it('allows partial updates of legacy requests without a due date', () => {
    expect(updateWorkRequestSchema.safeParse({ title: 'Updated legacy request' }).success).toBe(
      true
    );
    expect(updateWorkRequestSchema.safeParse({ dueDate: null }).success).toBe(true);
  });

  it('keeps archived requests viewable with their tasks', async () => {
    mockTables.work_requests.set('archived-wr', {
      id: 'archived-wr',
      entity_id: 'ent-ata',
      title: 'Archived filing',
      archived: true,
      status: 'Completed',
      phase: 'completion',
      deleted_at: null,
    });
    mockTables.tasks.set('archived-task', {
      id: 'archived-task',
      entity_id: 'ent-ata',
      work_request_id: 'archived-wr',
      title: 'Filed documents',
      phase: 'pre_processing',
      status: 'Completed',
      deleted_at: null,
    });
    const res = await request(app)
      .get('/v1/operations/work-requests/archived-wr')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA');
    expect(res.status).toBe(200);
    expect(res.body.data.archived).toBe(true);
    expect(res.body.data.tasks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'archived-task' })])
    );
  });
});
