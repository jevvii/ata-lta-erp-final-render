/**
 * Retainer Template & Other Template Entity Resolution & Deletion Tests
 *
 * Verifies:
 * 1. Soft-deleting retainer templates (template_type: 'retainer') across ATA, LTA, and ALL entity scopes.
 * 2. Soft-deleting other templates (template_type: 'other') across ATA, LTA, and ALL entity scopes.
 * 3. Both /templates/:templateId and /retainer-templates/:templateId routes work seamlessly.
 * 4. Header resolution works with X-Active-Entity, X-Entity, and in ALL mode (header omitted).
 * 5. 404 Not Found is returned when:
 *    - Template does not exist
 *    - Template is already soft-deleted (deleted_at is not null)
 *    - Template belongs to another entity scope (e.g. deleting LTA template with X-Active-Entity: ATA)
 * 6. RBAC enforcement (retainers:edit required).
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

describe('Retainer & Other Templates Delete Scoping & Resolution', () => {
  const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
  const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
  const OPS_STAFF_ID = '33333333-3333-4333-8333-333333333333';

  let adminToken;
  let managerToken;
  let opsStaffToken;
  let testClientATA;
  let testClientLTA;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // 1. Admin (has retainers:edit and retainers:use, access to ATA and LTA)
    adminToken = registerUser({
      id: ADMIN_ID,
      email: 'admin@ata-lta.ph',
      name: 'System Admin',
      role: 'Admin',
      departments: ['Management'],
      entities: ['ATA', 'LTA'],
    });

    // 2. Manager (has role-specific retainers:edit and retainers:use, access to ATA and LTA)
    managerToken = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Operations Manager',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA', 'LTA'],
    });

    // 3. Operations Staff (lacks retainers:edit)
    opsStaffToken = registerUser({
      id: OPS_STAFF_ID,
      email: 'ops@ata-lta.ph',
      name: 'Ops Staff',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });

    // Seed test clients
    testClientATA = {
      id: '11111111-2222-3333-4444-555555555555',
      entity_id: 'ent-ata',
      name: 'ATA Client Corp',
      tin: '111-222-333-00000',
      status: 'Active',
    };
    mockTables.clients.set(testClientATA.id, testClientATA);

    testClientLTA = {
      id: '22222222-3333-4444-5555-666666666666',
      entity_id: 'ent-lta',
      name: 'LTA Client Inc',
      tin: '444-555-666-00000',
      status: 'Active',
    };
    mockTables.clients.set(testClientLTA.id, testClientLTA);
  });

  describe('1. Retainer Templates Deletion (template_type: retainer)', () => {
    it('deletes an ATA retainer template under ATA entity scope (X-Active-Entity: ATA)', async () => {
      const templateId = 'tpl-ata-retainer';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'ATA Monthly Retainer',
        template_type: 'retainer',
        client_id: testClientATA.id,
        recurrence: 'none',
        priority: 'Normal',
        tasks: [],
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(204);
      const stored = mockTables.retainer_templates.get(templateId);
      expect(stored.deleted_at).toBeDefined();
    });

    it('deletes an LTA retainer template under LTA entity scope (X-Entity: LTA)', async () => {
      const templateId = 'tpl-lta-retainer';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-lta',
        name: 'LTA Quarterly Retainer',
        template_type: 'retainer',
        client_id: testClientLTA.id,
        recurrence: 'none',
        priority: 'Normal',
        tasks: [],
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Entity', 'LTA');

      expect(res.status).toBe(204);
      const stored = mockTables.retainer_templates.get(templateId);
      expect(stored.deleted_at).toBeDefined();
    });

    it('deletes an LTA retainer template in ALL scope (header omitted, resolving ent-lta from templateId)', async () => {
      const templateId = 'tpl-lta-all-delete';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-lta',
        name: 'LTA Retainer in ALL Mode',
        template_type: 'retainer',
        client_id: testClientLTA.id,
        recurrence: 'none',
        priority: 'Normal',
        tasks: [],
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      // X-Active-Entity omitted -> ALL mode

      expect(res.status).toBe(204);
      const stored = mockTables.retainer_templates.get(templateId);
      expect(stored.deleted_at).toBeDefined();
    });

    it('deletes an ATA retainer template using /retainer-templates/:templateId alias in ALL mode (X-Active-Entity: ALL)', async () => {
      const templateId = 'tpl-ata-alias-delete';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'ATA Retainer Alias Delete',
        template_type: 'retainer',
        client_id: testClientATA.id,
        recurrence: 'none',
        priority: 'Normal',
        tasks: [],
      });

      const res = await request(app)
        .delete(`/v1/operations/retainer-templates/${templateId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ALL');

      expect(res.status).toBe(204);
      const stored = mockTables.retainer_templates.get(templateId);
      expect(stored.deleted_at).toBeDefined();
    });
  });

  describe('2. Other Templates Deletion (template_type: other)', () => {
    it('deletes an ATA other template under ATA entity scope (X-Active-Entity: ATA)', async () => {
      const templateId = 'tpl-ata-other';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'ATA Ad-hoc Template',
        template_type: 'other',
        client_id: null,
        recurrence: 'none',
        priority: 'Normal',
        tasks: [{ title: 'Ad-hoc Task 1', phase: 'pre_processing' }],
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(204);
      const stored = mockTables.retainer_templates.get(templateId);
      expect(stored.deleted_at).toBeDefined();
    });

    it('deletes an LTA other template under LTA entity scope (X-Entity: LTA)', async () => {
      const templateId = 'tpl-lta-other';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-lta',
        name: 'LTA Ad-hoc Template',
        template_type: 'other',
        client_id: null,
        recurrence: 'none',
        priority: 'Normal',
        tasks: [{ title: 'Ad-hoc Task 2', phase: 'processing' }],
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Entity', 'LTA');

      expect(res.status).toBe(204);
      const stored = mockTables.retainer_templates.get(templateId);
      expect(stored.deleted_at).toBeDefined();
    });

    it('deletes an LTA other template in ALL mode (no entity header)', async () => {
      const templateId = 'tpl-lta-other-all';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-lta',
        name: 'LTA Ad-hoc ALL Mode',
        template_type: 'other',
        client_id: null,
        recurrence: 'none',
        priority: 'Normal',
        tasks: [{ title: 'Ad-hoc Task 3', phase: 'processing' }],
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${managerToken}`);
      // X-Active-Entity omitted -> ALL mode

      expect(res.status).toBe(204);
      const stored = mockTables.retainer_templates.get(templateId);
      expect(stored.deleted_at).toBeDefined();
    });
  });

  describe('3. Error Handling: 404 on Missing, Already-Deleted, or Cross-Entity Scope', () => {
    it('returns 404 Not Found when deleting a non-existent template ID', async () => {
      const res = await request(app)
        .delete('/v1/operations/templates/non-existent-template-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(404);
      expect(res.body.title).toMatch(/not found/i);
    });

    it('returns 404 Not Found when deleting an already soft-deleted template', async () => {
      const templateId = 'tpl-already-deleted';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Already Deleted Template',
        template_type: 'retainer',
        recurrence: 'none',
        deleted_at: new Date().toISOString(),
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(404);
      expect(res.body.title).toMatch(/not found/i);
    });

    it('returns 404 Not Found when second delete is executed consecutively', async () => {
      const templateId = 'tpl-double-delete';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Double Delete Template',
        template_type: 'retainer',
        recurrence: 'none',
      });

      // First delete -> 204
      const firstRes = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');
      expect(firstRes.status).toBe(204);

      // Second delete -> 404
      const secondRes = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');
      expect(secondRes.status).toBe(404);
      expect(secondRes.body.title).toMatch(/not found/i);
    });

    it('returns 404 Not Found when attempting to delete an LTA template while scoped to ATA', async () => {
      const templateId = 'tpl-lta-cross-entity';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-lta',
        name: 'LTA Scoped Template',
        template_type: 'retainer',
        recurrence: 'none',
      });

      // Scoped to ATA
      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(404);
      expect(res.body.title).toMatch(/not found/i);
      // Template must remain untouched
      expect(mockTables.retainer_templates.get(templateId).deleted_at).toBeUndefined();
    });

    it('returns 404 Not Found when attempting to delete an ATA template while scoped to LTA', async () => {
      const templateId = 'tpl-ata-cross-entity';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'ATA Scoped Template',
        template_type: 'other',
        recurrence: 'none',
      });

      // Scoped to LTA
      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'LTA');

      expect(res.status).toBe(404);
      expect(res.body.title).toMatch(/not found/i);
      // Template must remain untouched
      expect(mockTables.retainer_templates.get(templateId).deleted_at).toBeUndefined();
    });
  });

  describe('4. RBAC Authorization Guard', () => {
    it('rejects staff without retainers:edit with 403 Forbidden', async () => {
      const templateId = 'tpl-rbac-guard';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Guarded Template',
        template_type: 'retainer',
        recurrence: 'none',
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${opsStaffToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);
      expect(mockTables.retainer_templates.get(templateId).deleted_at).toBeUndefined();
    });
  });
});
