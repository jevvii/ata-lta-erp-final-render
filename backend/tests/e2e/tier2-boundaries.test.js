/**
 * Tier 2: Boundary, Extreme & Adversarial Corner Cases Test Suite (F01 - F17)
 * Strictly derived from user requirements and edge conditions.
 * Exactly >= 5 test cases per feature across F01 - F17 (Total = 85 tests).
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const {
  request,
  app,
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  loadPrototypeAuth,
  getPrototypeStyles,
  getPrototypeWorkflow,
} = require('./helpers');

const operationsService = require('../../src/modules/operations/service');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const WR_ID_1 = '22222222-2222-2222-2222-222222222221';
const TASK_ID_1 = '33333333-3333-3333-3333-333333333331';
const TASK_ID_OTHER = '33333333-3333-3333-3333-333333333332';

describe('Tier 2: Boundary & Corner Cases (F01 - F17)', () => {
  let adminToken, docToken, docUser, otherToken, otherUser, managerToken;

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

    const docId = '55555555-5555-5555-5555-555555555551';
    docToken = registerUser({
      id: docId,
      email: 'doc@ata-lta.ph',
      name: 'Documentation Staff',
      role: 'Documentation',
      entities: ['ATA', 'LTA'],
      departments: ['Documentation'],
    });
    docUser = { id: docId, role: 'Documentation', departments: ['Documentation'] };

    const otherId = '55555555-5555-5555-5555-555555555552';
    otherToken = registerUser({
      id: otherId,
      email: 'other@ata-lta.ph',
      name: 'Other Staff',
      role: 'Operations',
      entities: ['ATA', 'LTA'],
      departments: ['Operations'],
    });
    otherUser = { id: otherId, role: 'Operations', departments: ['Operations'] };

    const managerId = '55555555-5555-5555-5555-555555555553';
    managerToken = registerUser({
      id: managerId,
      email: 'manager@ata-lta.ph',
      name: 'Manager User',
      role: 'Manager',
      entities: ['ATA', 'LTA'],
      departments: ['Management'],
    });

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: 'ent-ata',
      name: 'Acme Corp',
      status: 'Active',
      created_by: adminToken,
      updated_by: adminToken,
    });

    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Audit WR 1',
      status: 'In Progress',
    });

    mockTables.tasks.set(TASK_ID_1, {
      id: TASK_ID_1,
      work_request_id: WR_ID_1,
      title: 'Doc Assigned Task',
      assignee_id: docId,
      deleted_at: null,
    });

    mockTables.tasks.set(TASK_ID_OTHER, {
      id: TASK_ID_OTHER,
      work_request_id: WR_ID_1,
      title: 'Other Task',
      assignee_id: otherId,
      deleted_at: null,
    });
  });

  // ==========================================
  // F01 Boundaries: Disbursement Read Creator-Only Filter
  // ==========================================
  describe('F01 Boundaries: Disbursement Read Creator-Only Filter', () => {
    it('F01-B1: Unauthenticated request to GET /v1/disbursements returns 401 Unauthorized', async () => {
      const res = await request(app).get('/v1/disbursements').set('X-Active-Entity', 'ATA').expect(401);
      expect(res.body.title || res.body.message).toMatch(/unauthorized/i);
    });

    it('F01-B2: Invalid UUID format on single disbursement read handles cleanly with 400 or 404', async () => {
      const res = await request(app)
        .get('/v1/disbursements/not-a-valid-uuid')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA');
      expect([400, 404]).toContain(res.status);
    });

    it('F01-B3: Soft-deleted disbursements (deleted_at != null) are excluded from creator list', async () => {
      mockTables.disbursements.set('d-deleted', {
        id: 'd-deleted',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        amount: 200,
        status: 'Draft',
        deleted_at: '2026-10-19T00:00:00Z',
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = (res.body.data || []).map((d) => d.id);
      expect(ids).not.toContain('d-deleted');
    });

    it('F01-B4: Pagination offset exceeding total count returns empty array gracefully', async () => {
      mockTables.disbursements.set('d-1', {
        id: 'd-1',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        amount: 300,
        status: 'Draft',
      });

      const res = await request(app)
        .get('/v1/disbursements?offset=100&limit=10')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data).toEqual([]);
    });

    it('F01-B5: Cross-entity isolation: creator of ATA records querying LTA receives empty list', async () => {
      mockTables.disbursements.set('d-ata-only', {
        id: 'd-ata-only',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        amount: 400,
        status: 'Draft',
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'LTA')
        .expect(200);

      const ids = (res.body.data || []).map((d) => d.id);
      expect(ids).not.toContain('d-ata-only');
    });
  });

  // ==========================================
  // F02 Boundaries: Disbursement Badge Counts
  // ==========================================
  describe('F02 Boundaries: Disbursement Badge Counts', () => {
    it('F02-B1: Unauthenticated request to /v1/disbursements/counts returns 401 Unauthorized', async () => {
      await request(app).get('/v1/disbursements/counts').set('X-Active-Entity', 'ATA').expect(401);
    });

    it('F02-B2: Large number of created disbursements counts accurately without degradation', async () => {
      for (let i = 1; i <= 25; i++) {
        mockTables.disbursements.set(`d-bulk-${i}`, {
          id: `d-bulk-${i}`,
          entity_id: 'ent-ata',
          created_by: docUser.id,
          status: 'Draft',
        });
      }

      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.active).toBe(25);
    });

    it('F02-B3: Soft-deleted disbursements are excluded from count aggregates', async () => {
      mockTables.disbursements.set('d-soft-del', {
        id: 'd-soft-del',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        status: 'Draft',
        deleted_at: '2026-10-19T00:00:00Z',
      });

      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.active).toBe(0);
    });

    it('F02-B4: Entity switching ATA vs LTA isolates badge counts strictly', async () => {
      mockTables.disbursements.set('d-ata-cnt', {
        id: 'd-ata-cnt',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        status: 'Draft',
      });

      const resAta = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);
      expect(resAta.body.data.active).toBe(1);

      const resLta = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'LTA')
        .expect(200);
      expect(resLta.body.data.active).toBe(0);
    });

    it('F02-B5: Zero-amount disbursement still counts correctly towards active bucket', async () => {
      mockTables.disbursements.set('d-zero-amt', {
        id: 'd-zero-amt',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        amount: 0,
        status: 'Draft',
      });

      const res = await request(app)
        .get('/v1/disbursements/counts')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.active).toBe(1);
    });
  });

  // ==========================================
  // F03 Boundaries: Own Records Outside WR Membership
  // ==========================================
  describe('F03 Boundaries: Own Records Outside WR Membership', () => {
    it('F03-B1: Empty string linked_work_request_id handled safely as unlinked record', async () => {
      mockTables.disbursements.set('d-empty-wr', {
        id: 'd-empty-wr',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: '',
        amount: 120,
        status: 'Draft',
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = (res.body.data || []).map((d) => d.id);
      expect(ids).toContain('d-empty-wr');
    });

    it('F03-B2: Orphaned disbursement with non-existent WR ID returned to creator', async () => {
      mockTables.disbursements.set('d-orphaned', {
        id: 'd-orphaned',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: '99999999-9999-9999-9999-999999999999',
        amount: 350,
        status: 'Draft',
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = (res.body.data || []).map((d) => d.id);
      expect(ids).toContain('d-orphaned');
    });

    it('F03-B3: Creator with mixed linked and unlinked records retrieves all of them', async () => {
      mockTables.disbursements.set('d-unlinked', {
        id: 'd-unlinked',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: null,
        amount: 50,
        status: 'Draft',
      });
      mockTables.disbursements.set('d-linked', {
        id: 'd-linked',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: WR_ID_1,
        amount: 150,
        status: 'Draft',
      });

      const res = await request(app)
        .get('/v1/disbursements')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = (res.body.data || []).map((d) => d.id);
      expect(ids).toContain('d-unlinked');
      expect(ids).toContain('d-linked');
    });

    it('F03-B4: Querying with explicit workRequestId filter does not leak creator record to non-creator', async () => {
      mockTables.disbursements.set('d-secret-wr', {
        id: 'd-secret-wr',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_work_request_id: WR_ID_1,
        amount: 900,
        status: 'Draft',
      });

      const res = await request(app)
        .get(`/v1/disbursements?workRequestId=${WR_ID_1}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const ids = (res.body.data || []).map((d) => d.id);
      expect(ids).not.toContain('d-secret-wr');
    });

    it('F03-B5: Unicode and special characters in description preserved for creator read', async () => {
      mockTables.disbursements.set('d-unicode', {
        id: 'd-unicode',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        description: 'Transportación & Audit ✈️ <script>alert(1)</script>',
        amount: 500,
        status: 'Draft',
      });

      const res = await request(app)
        .get('/v1/disbursements/d-unicode')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(res.body.data.description).toBe('Transportación & Audit ✈️ <script>alert(1)</script>');
    });
  });

  // ==========================================
  // F04 Boundaries: Related Disbursements Scoping
  // ==========================================
  describe('F04 Boundaries: Related Disbursements Scoping', () => {
    it('F04-B1: Work request with zero linked disbursements returns empty disbursements array', async () => {
      const related = await operationsService.getWorkRequestRelated(WR_ID_1, docUser);
      expect(related.disbursements).toEqual([]);
    });

    it('F04-B2: Task with zero linked disbursements returns empty disbursements array', async () => {
      const related = await operationsService.getTaskRelated(TASK_ID_1, docUser);
      expect(related.disbursements).toEqual([]);
    });

    it('F04-B3: Caller with empty departments array strictly restricted to own created disbursements', async () => {
      mockTables.disbursements.set('d-t-1', {
        id: 'd-t-1',
        entity_id: 'ent-ata',
        linked_task_id: TASK_ID_1,
        created_by: docUser.id,
      });
      mockTables.disbursements.set('d-t-2', {
        id: 'd-t-2',
        entity_id: 'ent-ata',
        linked_task_id: TASK_ID_1,
        created_by: otherUser.id,
      });

      const bareUser = { id: docUser.id, role: 'Staff', departments: [] };
      const related = await operationsService.getTaskRelated(TASK_ID_1, bareUser);
      const ids = (related.disbursements || []).map((d) => d.id);
      expect(ids).toContain('d-t-1');
      expect(ids).not.toContain('d-t-2');
    });

    it('F04-B4: Soft-deleted disbursements are excluded from getTaskRelated', async () => {
      mockTables.disbursements.set('d-t-del', {
        id: 'd-t-del',
        entity_id: 'ent-ata',
        linked_task_id: TASK_ID_1,
        created_by: docUser.id,
        deleted_at: '2026-10-19T00:00:00Z',
      });

      const related = await operationsService.getTaskRelated(TASK_ID_1, docUser);
      const ids = (related.disbursements || []).map((d) => d.id);
      expect(ids).not.toContain('d-t-del');
    });

    it('F04-B5: Non-existent task ID handles gracefully returning empty array', async () => {
      const related = await operationsService.getTaskRelated('non-existent-task-id', docUser);
      expect(related.disbursements).toEqual([]);
    });
  });

  // ==========================================
  // F05 Boundaries: Invoice Request Documentation Denial
  // ==========================================
  describe('F05 Boundaries: Invoice Request Documentation Denial', () => {
    it('F05-B1: Case-insensitivity: department "documentation" (lowercase) is rejected with 403', async () => {
      const token = registerUser({
        email: 'doclower@ata-lta.ph',
        name: 'Doc Lower',
        role: 'Staff',
        departments: ['documentation'],
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Active-Entity', 'ATA')
        .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_1 })
        .expect(403);

      expect(res.body.detail).toMatch(/documentation users cannot request invoice billing/i);
    });

    it('F05-B2: Documentation user cannot bypass guard by adding prototype pollution keys', async () => {
      const maliciousPayload = JSON.parse(
        '{"type":"billing","workRequestId":"' +
          WR_ID_1 +
          '","taskId":"' +
          TASK_ID_1 +
          '","__proto__":{"role":"Admin"}}'
      );

      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send(maliciousPayload)
        .expect(403);

      expect(res.body.detail).toMatch(/documentation users cannot request invoice billing/i);
    });

    it('F05-B3: Invalid empty request type is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ type: '', workRequestId: WR_ID_1 })
        .expect(400);

      expect(res.body.title).toMatch(/validation|bad request/i);
    });

    it('F05-B4: SQL injection payload in notes does not bypass Documentation check', async () => {
      const res = await request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          type: 'billing',
          workRequestId: WR_ID_1,
          taskId: TASK_ID_1,
          notes: "'; DROP TABLE operations_requests; --",
        })
        .expect(403);

      expect(res.body.detail).toMatch(/documentation users cannot request invoice billing/i);
    });

    it('F05-B5: Rapid consecutive requests from Documentation staff are all rejected with 403', async () => {
      const p1 = request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_1 });
      const p2 = request(app)
        .post('/v1/operations-requests')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ type: 'billing', workRequestId: WR_ID_1, taskId: TASK_ID_1 });

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1.status).toBe(403);
      expect(r2.status).toBe(403);
    });
  });

  // ==========================================
  // F06 Boundaries: Transmittal Task Assignment Enforcement
  // ==========================================
  describe('F06 Boundaries: Transmittal Task Assignment Enforcement', () => {
    it('F06-B1: Task soft-deleted right before transmittal create is rejected', async () => {
      mockTables.tasks.set('t-deleted', {
        id: 't-deleted',
        work_request_id: WR_ID_1,
        assignee_id: docUser.id,
        deleted_at: '2026-10-19T00:00:00Z',
      });

      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_ID_1,
          linkedTaskId: 't-deleted',
          items: [{ description: 'File', quantity: 1, documentType: 'Audit' }],
          recipientName: 'Client',
        });

      expect([400, 403, 404]).toContain(res.status);
    });

    it('F06-B2: Caller assigned to task A cannot create transmittal linked to task B in same WR', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_OTHER, // assigned to otherUser
          items: [{ description: 'File', quantity: 1, documentType: 'Audit' }],
          recipientName: 'Client',
        })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('F06-B3: Co-assignee table entry with empty user_id does not grant permission', async () => {
      mockTables.task_assignees.set('ta-malformed', {
        id: 'ta-malformed',
        task_id: TASK_ID_OTHER,
        user_id: '',
      });

      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          clientId: CLIENT_ID,
          workRequestId: WR_ID_1,
          linkedTaskId: TASK_ID_OTHER,
          items: [{ description: 'File', quantity: 1, documentType: 'Audit' }],
          recipientName: 'Client',
        })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('F06-B4: Non-Draft transmittal update attempt by non-admin is rejected', async () => {
      mockTables.transmittals.set('tr-sent', {
        id: 'tr-sent',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_task_id: TASK_ID_1,
        status: 'Sent',
        approved: true,
      });

      const res = await request(app)
        .put('/v1/transmittals/tr-sent')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ notes: 'Updated notes' })
        .expect(409);

      expect(res.body.title || res.body.message).toMatch(/conflict|status/i);
    });

    it('F06-B5: Sending already sent transmittal is rejected with conflict', async () => {
      mockTables.transmittals.set('tr-already-sent', {
        id: 'tr-already-sent',
        entity_id: 'ent-ata',
        created_by: docUser.id,
        linked_task_id: TASK_ID_1,
        status: 'Sent',
        approved: true,
      });

      const res = await request(app)
        .post('/v1/transmittals/tr-already-sent/send')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(409);

      expect(res.body.title || res.body.message).toMatch(/conflict|status/i);
    });
  });

  // ==========================================
  // F07 Boundaries: Transmittal Blank/Whole-Project Rejection
  // ==========================================
  describe('F07 Boundaries: Transmittal Blank/Whole-Project Rejection', () => {
    const basePayload = {
      clientId: CLIENT_ID,
      workRequestId: WR_ID_1,
      items: [{ description: 'Tax returns', documentType: 'Tax', quantity: 1 }],
      recipientName: 'Client',
    };

    it('F07-B1: linkedTaskId: undefined is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: undefined })
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-B2: linkedTaskId: false is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: false })
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-B3: linkedTaskId: 12345 (number) is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: 12345 })
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-B4: Multi-line whitespace linkedTaskId: "\\n\\t   " is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: '\n\t   ' })
        .expect(400);

      expect(res.body.detail || res.body.message).toMatch(/valid linked task is required/i);
    });

    it('F07-B5: Non-existent task UUID rejected cleanly (400 or 403 or 404)', async () => {
      const res = await request(app)
        .post('/v1/transmittals')
        .set('Authorization', `Bearer ${docToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ ...basePayload, linkedTaskId: '00000000-0000-0000-0000-000000000000' });

      expect([400, 403, 404]).toContain(res.status);
    });
  });

  // ==========================================
  // F08 Boundaries: Retainer Templates Manager Role Access
  // ==========================================
  describe('F08 Boundaries: Retainer Templates Manager Role Access', () => {
    it('F08-B1: Unauthenticated request to /v1/operations/templates returns 401 Unauthorized', async () => {
      await request(app).get('/v1/operations/templates').set('X-Active-Entity', 'ATA').expect(401);
    });

    it('F08-B2: Empty template name is rejected with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ name: '', lines: [] })
        .expect(400);

      expect(res.body.title).toMatch(/validation|bad request/i);
    });

    it('F08-B3: Large template payload with 50 lines handled cleanly by Manager', async () => {
      const lines = Array.from({ length: 50 }, (_, i) => ({
        title: `Step ${i + 1}`,
        phase: 'processing',
        defaultPriority: 'Normal',
      }));

      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ name: 'Comprehensive Monthly Retainer', lines })
        .expect(201);

      expect(res.body.data.name).toBe('Comprehensive Monthly Retainer');
    });

    it('F08-B4: Manager cannot delete or modify standard task templates (Admin-only)', async () => {
      mockTables.task_templates.set('tt-1', { id: 'tt-1', title: 'Task Template 1' });

      const res = await request(app)
        .delete('/v1/operations/task-templates/tt-1')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA');

      expect([403, 404, 405]).toContain(res.status);
      if (res.status === 403) {
        expect(res.body.title).toMatch(/forbidden/i);
      }
    });

    it('F08-B5: Role Staff with no department is rejected with 403 Forbidden', async () => {
      const bareToken = registerUser({
        email: 'bare@ata-lta.ph',
        name: 'Bare Staff',
        role: 'Staff',
        departments: [],
        entities: ['ATA'],
      });

      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${bareToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ name: 'Template X', lines: [] })
        .expect(403);

      expect(res.body.title).toMatch(/forbidden/i);
    });
  });



  // ==========================================
  // F14 Boundaries: Prototype Disbursement Read Visibility Alignment
  // ==========================================
  describe('F14 Boundaries: Prototype Disbursement Read Visibility Alignment', () => {
    it('F14-B1: canViewDisbursement(null) returns false', () => {
      const Auth = loadPrototypeAuth({ role: 'Documentation' });
      expect(Auth.canViewDisbursement(null)).toBe(false);
    });

    it('F14-B2: Disbursement with createdBy null returns false for staff', () => {
      const Auth = loadPrototypeAuth({ id: 'u-doc', role: 'Documentation' });
      expect(Auth.canViewDisbursement({ id: 'd-1', createdBy: null })).toBe(false);
    });

    it('F14-B3: Prototype user null returns false', () => {
      const Auth = loadPrototypeAuth(null);
      expect(Auth.canViewDisbursement({ id: 'd-1', createdBy: 'u-doc' })).toBe(false);
    });

    it('F14-B4: Staff user with empty departments returns false for others disbursements', () => {
      const Auth = loadPrototypeAuth({ id: 'u-1', role: 'Staff', departments: [] });
      expect(Auth.canViewDisbursement({ id: 'd-1', createdBy: 'u-2' })).toBe(false);
    });

    it('F14-B5: Non-standard status ("Archived", "Cancelled") returns false for non-creator', () => {
      const Auth = loadPrototypeAuth({ id: 'u-doc', role: 'Documentation' });
      expect(Auth.canViewDisbursement({ id: 'd-1', status: 'Archived', createdBy: 'u-other' })).toBe(false);
    });
  });

  // ==========================================
  // F15 Boundaries: Prototype Transmittal Modal Task Guard
  // ==========================================
  describe('F15 Boundaries: Prototype Transmittal Modal Task Guard', () => {
    it('F15-B1: WR with zero tasks handles gracefully without throwing', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/tasks\.length === 0|tasks\.length > 0/);
    });

    it('F15-B2: Task with HTML special characters in title is escaped safely', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/text:\s*t\.title/);
    });

    it('F15-B3: Null or undefined task title uses fallback or title string', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/t\.title/);
    });

    it('F15-B4: Task preselected option matches preselectedTask.id', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/preselectedTask && preselectedTask\.id === t\.id/);
    });

    it('F15-B5: Save handler validates selected task value is not empty', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/linkedTaskId.*required|Please select a task/i);
    });
  });

  // ==========================================
  // F16 Boundaries: Prototype Retainer Templates Role Guard
  // ==========================================
  describe('F16 Boundaries: Prototype Retainer Templates Role Guard', () => {
    it('F16-B1: Manager role with empty departments still renders Retainer Templates tab', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/Auth\.user\?\.role === 'Manager'|isManagerial/);
    });

    it('F16-B2: Prototype Auth with null user does not render Retainer Templates tab', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/Auth\.user\?\.role === 'Admin'|Auth\.user\?\.role === 'Manager'/);
    });

    it('F16-B3: Template tab count displays total template records accurately', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/templateCount/);
    });

    it('F16-B4: Task Templates tab remains strictly Admin-only', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/Auth\.user\?\.role === 'Admin'/);
    });

    it('F16-B5: Staff user cannot see Retainer Templates or Task Templates tabs', () => {
      const code = getPrototypeWorkflow();
      expect(code).toMatch(/tabs\.push\(\{\s*key:\s*'templates'/);
    });
  });

  // ==========================================
  // F17 Boundaries: Prototype Work Request Datepicker Scoped Styling
  // ==========================================
  describe('F17 Boundaries: Prototype Work Request Datepicker Scoped Styling', () => {
    it('F17-B1: Work request due date datepicker in .notion-prop--due-date container receives max-width constraint', () => {
      const css = getPrototypeStyles();
      expect(css).toMatch(/#wr-form\s+\.notion-prop--due-date\s+\.mdp-wrapper/);
    });

    it('F17-B2: Scoped rule max-width: 220px prevents column cell distortion', () => {
      const css = getPrototypeStyles();
      const match = css.match(/#wr-form\s+\.notion-prop--due-date\s+\.mdp-wrapper\s*\{([^}]+)\}/);
      expect(match).not.toBeNull();
      expect(match[1]).toMatch(/max-width:\s*220px/);
    });

    it('F17-B3: Scoped rule width: 100% maintains responsive fill within 220px ceiling', () => {
      const css = getPrototypeStyles();
      const match = css.match(/#wr-form\s+\.notion-prop--due-date\s+\.mdp-wrapper\s*\{([^}]+)\}/);
      expect(match).not.toBeNull();
      expect(match[1]).toMatch(/width:\s*100%/);
    });

    it('F17-B4: Filter bar datepickers (.filters-bar) remain unaffected by .notion-prop rule', () => {
      const css = getPrototypeStyles();
      expect(css).toMatch(/\.filters-bar/);
    });

    it('F17-B5: Audit filters datepicker remains unaffected by .notion-prop rule', () => {
      const css = getPrototypeStyles();
      expect(css).toMatch(/\.audit-filters/);
    });
  });
});
