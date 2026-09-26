/**
 * /v1/operations/task-templates integration tests.
 * Verifies RBAC (Admin-only mutations) and CRUD operations.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock } = require('../fixtures/supabaseMock');

describe('Standard Task Templates API', () => {
  let adminToken;
  let staffToken;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminToken = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });

    staffToken = registerUser({
      email: 'staff@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
  });

  describe('GET /v1/operations/task-templates', () => {
    it('allows staff with workflow:view to read templates', async () => {
      const res = await request(app)
        .get('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(9);
      const first = res.body.data[0];
      expect(first).toHaveProperty('title');
      expect(first).toHaveProperty('defaultChecklist');
    });

    it('works via /v1/work-requests/task-templates route as well', async () => {
      const res = await request(app)
        .get('/v1/work-requests/task-templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(9);
    });
  });

  describe('POST /v1/operations/task-templates (Admin Only)', () => {
    const newTemplate = {
      title: 'Custom Admin Task Template',
      requiredLinkType: 'Audit Report',
      defaultChecklist: [
        { text: 'Verify bank confirmations' },
        { text: 'Check inventory counts' },
      ],
      coAssignees: ['Senior Auditor'],
      sortOrder: 10,
    };

    it('rejects creation from non-admin staff with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${staffToken}`)
        .send(newTemplate)
        .expect(403);

      expect(res.body.detail || res.body.message).toMatch(/Admin/i);
    });

    it('allows Admin to create a standard task template', async () => {
      const res = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(newTemplate)
        .expect(201);

      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.title).toBe(newTemplate.title);
      expect(res.body.data.requiredLinkType).toBe('Audit Report');
      expect(res.body.data.defaultChecklist).toHaveLength(2);
      expect(res.body.data.coAssignees).toEqual(['Senior Auditor']);
    });
  });

  describe('PUT /v1/operations/task-templates/:templateId (Admin Only)', () => {
    it('rejects updates from non-admin with 403', async () => {
      // Create first as admin
      const created = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Template to Update' })
        .expect(201);

      await request(app)
        .put(`/v1/operations/task-templates/${created.body.data.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ title: 'Hacked Title' })
        .expect(403);
    });

    it('allows Admin to update a template', async () => {
      const created = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Original Title' })
        .expect(201);

      const res = await request(app)
        .put(`/v1/operations/task-templates/${created.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Updated Title by Admin' })
        .expect(200);

      expect(res.body.data.title).toBe('Updated Title by Admin');
    });
  });

  describe('DELETE /v1/operations/task-templates/:templateId (Admin Only)', () => {
    it('rejects deletion from non-admin with 403', async () => {
      const created = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Template to Delete' })
        .expect(201);

      await request(app)
        .delete(`/v1/operations/task-templates/${created.body.data.id}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('allows Admin to delete a template', async () => {
      const created = await request(app)
        .post('/v1/operations/task-templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Template for Deletion' })
        .expect(201);

      await request(app)
        .delete(`/v1/operations/task-templates/${created.body.data.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });
  });

  describe('POST /v1/operations/task-templates/reset-defaults (Admin Only)', () => {
    it('rejects reset from non-admin with 403', async () => {
      await request(app)
        .post('/v1/operations/task-templates/reset-defaults')
        .set('Authorization', `Bearer ${staffToken}`)
        .expect(403);
    });

    it('allows Admin to reset templates to defaults', async () => {
      const res = await request(app)
        .post('/v1/operations/task-templates/reset-defaults')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data).toHaveLength(9);
    });
  });
});
