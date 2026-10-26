/**
 * Parcel P0-E: Retainer Templates & Recurrence Test Suite
 *
 * Verifies:
 * - RBAC Permission Matrix (AC-1 / R1):
 *   - Managers can view templates and generate work requests (retainers:use)
 *   - Managers receive 403 on create/update/delete (retainers:edit)
 *   - Admins can create, update, delete, view, and generate (retainers:use + retainers:edit)
 *   - Operations/Accounting staff receive 403 on all template routes
 * - Template Generation Pipeline (AC-2 / R2):
 *   - Reuses P0-D createWorkRequest pipeline directly
 *   - Materializes phase-model graph (pre_processing, processing)
 *   - Delimiter tokenization on task titles expands into sibling tasks
 *   - Assignee attribution dual-writes to task_assignees
 *   - Returns full WR graph with generation record attached
 * - Annual Recurrence & Duplicate Period Guard (AC-3 / R3, R5):
 *   - Template with recurrence: 'annual' requires period_label (400 if missing)
 *   - Generates initial period (e.g. 'FY-2026') -> 201 Created
 *   - Second generation with identical period_label -> 409 Conflict (PERIOD_ALREADY_GENERATED)
 *   - Generation with distinct period_label (e.g. 'FY-2027') -> 201 Created, distinct records
 * - Idempotency Replay (AC-4 / R4):
 *   - Retrying with same Idempotency-Key header returns stored 201 with Idempotent-Replay: true
 *   - Replay does not duplicate work requests or generation records
 * - Boundary Cases & Entity Scoping:
 *   - Non-existent or deleted template -> 404
 *   - Cross-entity template isolation -> 404
 *   - Non-recurring template generation without period_label -> 201 Created
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('./fixtures/supabaseMock');

describe('Parcel P0-E: Retainer Templates & Recurrence', () => {
  let adminToken;
  let managerToken;
  let managerId;
  let opsToken;
  let acctToken;
  let staffWorker;
  let testClient;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // 1. Admin (has retainers:use and retainers:edit)
    adminToken = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'System Admin',
      role: 'Admin',
      departments: ['Management'],
      entities: ['ATA', 'LTA'],
    });

    // 2. Manager (has retainers:use, lacks retainers:edit)
    managerId = '22222222-2222-4222-8222-222222222222';
    managerToken = registerUser({
      id: managerId,
      email: 'manager@ata-lta.ph',
      name: 'Operations Manager',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA', 'LTA'],
    });

    // 3. Operations Staff (lacks retainers:use and retainers:edit)
    opsToken = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Ops Worker',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });

    // 4. Accounting Staff (lacks retainers:use and retainers:edit)
    acctToken = registerUser({
      email: 'acct@ata-lta.ph',
      name: 'Acct Worker',
      role: 'Accounting',
      departments: ['Accounting'],
      entities: ['ATA', 'LTA'],
    });

    // 5. Staff Worker for task assignments
    const workerId = '55555555-5555-5555-5555-555555555555';
    registerUser({
      id: workerId,
      email: 'worker@ata-lta.ph',
      name: 'Juan Staff',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });
    staffWorker = { id: workerId, name: 'Juan Staff' };

    // 6. Test Client
    testClient = {
      id: '11111111-2222-3333-4444-555555555555',
      entity_id: 'ent-ata',
      name: 'Megacorp PH',
      tin: '123-456-789-00000',
      status: 'Active',
    };
    mockTables.clients.set(testClient.id, testClient);
  });

  describe('1. RBAC Permission Matrix (AC-1 / R1)', () => {
    it('allows Admin to create a retainer template (201 Created)', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          name: 'Annual Audit Retainer',
          description: 'Standard annual audit package',
          clientId: testClient.id,
          priority: 'Normal',
          schedule: 'Annual',
          pfAmount: 50000,
          recurrence: 'annual',
          tasks: [
            {
              title: 'Initial Review',
              phase: 'pre_processing',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toBe('Annual Audit Retainer');
      expect(res.body.data.recurrence).toBe('annual');
    });

    it('rejects Manager attempting to create a retainer template with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          name: 'Manager Created Retainer',
          clientId: testClient.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('rejects Manager attempting to create on /retainer-templates alias with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/v1/operations/retainer-templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          name: 'Manager Created Retainer',
          clientId: testClient.id,
        });

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('rejects Operations staff attempting to create a template with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          name: 'Ops Retainer',
        });

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('rejects Manager attempting to update a template with 403 Forbidden', async () => {
      const templateId = 'tpl-update-test';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Pre-existing Template',
        recurrence: 'annual',
      });

      const res = await request(app)
        .put(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          name: 'Manager Updated Name',
        });

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('rejects Manager attempting to delete a template with 403 Forbidden', async () => {
      const templateId = 'tpl-delete-test';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Pre-existing Template',
        recurrence: 'none',
      });

      const res = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);
    });

    it('allows Manager and Admin to list templates (200 OK)', async () => {
      const templateId = 'tpl-list-test';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Visible Retainer',
        recurrence: 'annual',
      });

      // Manager can list
      const mgrRes = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(mgrRes.status).toBe(200);
      expect(Array.isArray(mgrRes.body.data)).toBe(true);
      expect(mgrRes.body.data).toHaveLength(1);
      expect(mgrRes.body.data[0].name).toBe('Visible Retainer');

      // Admin can list
      const adminRes = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.data).toHaveLength(1);

      // Verify /retainer-templates alias
      const aliasRes = await request(app)
        .get('/v1/operations/retainer-templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(aliasRes.status).toBe(200);
      expect(aliasRes.body.data).toHaveLength(1);
    });

    it('rejects non-management staff from listing templates with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);

      const acctRes = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${acctToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(acctRes.status).toBe(403);
    });

    it('allows Admin to update and delete a template (200 / 204)', async () => {
      const templateId = 'tpl-admin-modify';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Original Name',
        recurrence: 'none',
      });

      const updateRes = await request(app)
        .put(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          name: 'Updated Name',
          recurrence: 'annual',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Updated Name');
      expect(updateRes.body.data.recurrence).toBe('annual');

      const delRes = await request(app)
        .delete(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(delRes.status).toBe(204);
      expect(mockTables.retainer_templates.get(templateId).deleted_at).toBeDefined();
    });
  });

  describe('2. Template Generation Pipeline & P0-D Parity (AC-2 / R2)', () => {
    it('generates a full phase-model work request using P0-D pipeline directly', async () => {
      const templateId = 'tpl-gen-phase-test';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Quarterly Bookkeeping',
        description: 'Periodic closing and report generation',
        client_id: testClient.id,
        priority: 'Normal',
        recurrence: 'none',
        assigned_to: managerId,
        co_assignees: [staffWorker.id],
        tasks: [
          {
            local_id: 't_intake',
            title: 'Collect Source Documents, Organize Receipts',
            description: 'Intake step with delimiters to test tokenization',
            phase: 'pre_processing',
            default_assignees: [staffWorker.id],
          },
          {
            local_id: 't_entry',
            title: 'Journal Entries Posting',
            description: 'Main processing step',
            phase: 'processing',
            depends_on_local_id: 't_intake',
            default_assignees: [staffWorker.id],
          },
        ],
      });

      // Manager generates work request
      const res = await request(app)
        .post(`/v1/operations/templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: {
            dueDate: '2026-12-31',
            priority: 'High',
          },
        });

      expect(res.status).toBe(201);
      const graph = res.body.data;

      // 1. Root work request shape matches P0-D
      expect(graph.id).toBeDefined();
      expect(graph.title).toBe('Quarterly Bookkeeping');
      expect(graph.priority).toBe('High'); // overridden
      expect(graph.clientId).toBe(testClient.id);
      expect(graph.phases).toBeDefined();
      expect(graph.phases.pre_processing).toBeDefined();
      expect(graph.phases.processing).toBeDefined();

      // 2. Delimiter tokenization verified: "Collect Source Documents, Organize Receipts"
      // was expanded into 2 sibling tasks in pre_processing!
      const preTasks = graph.phases.pre_processing.tasks;
      expect(preTasks).toHaveLength(2);
      expect(preTasks[0].title).toBe('Collect Source Documents');
      expect(preTasks[1].title).toBe('Organize Receipts');
      expect(preTasks[0].description).toContain('[audit_note] Original submission:');

      // Processing task verified
      const procTasks = graph.phases.processing.tasks;
      expect(procTasks).toHaveLength(1);
      expect(procTasks[0].title).toBe('Journal Entries Posting');
      expect(procTasks[0].phase).toBe('processing');

      // 3. Multi-assignee attribution verified in task_assignees table
      const assigneesEntries = Array.from(mockTables.task_assignees.values());
      expect(assigneesEntries.length).toBeGreaterThanOrEqual(2);
      const matched = assigneesEntries.filter((a) => a.user_id === staffWorker.id);
      expect(matched.length).toBeGreaterThanOrEqual(2);
      // assigned_by must attribute the manager who triggered generation
      expect(matched[0].assigned_by).toBeDefined();

      // 4. Generation audit record verified
      expect(graph.generation).toBeDefined();
      expect(graph.generation.template_id).toBe(templateId);
      expect(graph.generation.work_request_id).toBe(graph.id);
      expect(graph.generation.period_label).toBeNull();

      const storedGen = mockTables.retainer_template_generations.get(graph.generation.id);
      expect(storedGen).toBeDefined();
      expect(storedGen.template_id).toBe(templateId);
    });

    it('works via the /retainer-templates/:templateId/generate alias', async () => {
      const templateId = 'tpl-alias-gen';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Alias Test Retainer',
        client_id: testClient.id,
        recurrence: 'none',
        assigned_to: managerId,
        tasks: [{ title: 'Single Task', phase: 'pre_processing' }],
      });

      const res = await request(app)
        .post(`/v1/operations/retainer-templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ overrides: { dueDate: '2026-12-31' },});

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.title).toBe('Alias Test Retainer');
    });

    it('rejects Operations staff attempting to generate with 403 Forbidden', async () => {
      const templateId = 'tpl-ops-forbidden';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Ops Forbidden',
        recurrence: 'none',
      });

      const res = await request(app)
        .post(`/v1/operations/templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${opsToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ overrides: { dueDate: '2026-12-31' },});

      expect(res.status).toBe(403);
      expect(res.body.title).toMatch(/forbidden/i);
    });
  });

  describe('3. Annual Recurrence & Duplicate Period Guard (AC-3 / R3, R5)', () => {
    let annualTemplate;

    beforeEach(() => {
      annualTemplate = {
        id: 'tpl-annual-recurrence',
        entity_id: 'ent-ata',
        name: 'Annual Tax Compliance',
        description: 'Complete annual filing package',
        client_id: testClient.id,
        priority: 'Normal',
        recurrence: 'annual',
        assigned_to: managerId,
        tasks: [
          {
            local_id: 't_audit',
            title: 'Audit Preparation',
            phase: 'pre_processing',
          },
          {
            local_id: 't_file',
            title: 'BIR Form 1702 Submission',
            phase: 'processing',
            depends_on_local_id: 't_audit',
          },
        ],
      };
      mockTables.retainer_templates.set(annualTemplate.id, annualTemplate);
    });

    it('requires period_label when template recurrence is annual (400 Bad Request)', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${annualTemplate.id}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: { dueDate: '2026-12-31' },
          // missing period_label
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PERIOD_LABEL_REQUIRED');
      expect(res.body.detail).toMatch(/period_label is required/i);
    });

    it('generates work request for period "FY-2026" and sets title with period suffix', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${annualTemplate.id}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: { dueDate: '2026-12-31' },
          period_label: 'FY-2026',
        });

      expect(res.status).toBe(201);
      const graph = res.body.data;
      expect(graph.title).toBe('Annual Tax Compliance - FY-2026');
      expect(graph.generation).toBeDefined();
      expect(graph.generation.period_label).toBe('FY-2026');

      // Verify row logged in retainer_template_generations
      const generations = Array.from(mockTables.retainer_template_generations.values());
      expect(generations).toHaveLength(1);
      expect(generations[0].template_id).toBe(annualTemplate.id);
      expect(generations[0].period_label).toBe('FY-2026');
      expect(generations[0].work_request_id).toBe(graph.id);
    });

    it('returns 409 Conflict when generating twice for the same period_label', async () => {
      // First generation succeeds
      const firstRes = await request(app)
        .post(`/v1/operations/templates/${annualTemplate.id}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: { dueDate: '2026-12-31' },
          period_label: 'FY-2026',
        });
      expect(firstRes.status).toBe(201);

      // Second generation with same period_label fails with 409 Conflict
      const secondRes = await request(app)
        .post(`/v1/operations/templates/${annualTemplate.id}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: { dueDate: '2026-12-31' },
          period_label: 'FY-2026',
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.code).toBe('PERIOD_ALREADY_GENERATED');
      expect(secondRes.body.detail).toMatch(/already generated for this template/i);

      // Verify no second work request was left behind
      const workRequests = Array.from(mockTables.work_requests.values()).filter(
        (wr) => wr.title.includes('Annual Tax Compliance')
      );
      expect(workRequests).toHaveLength(1);

      // Verify only 1 generation log exists
      const generations = Array.from(mockTables.retainer_template_generations.values());
      expect(generations).toHaveLength(1);
    });

    it('allows generating second work request with distinct period_label ("FY-2027")', async () => {
      // First generation (FY-2026)
      const res1 = await request(app)
        .post(`/v1/operations/templates/${annualTemplate.id}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: { dueDate: '2026-12-31' },
          period_label: 'FY-2026',
        });
      expect(res1.status).toBe(201);

      // Second generation with distinct period_label (FY-2027)
      const res2 = await request(app)
        .post(`/v1/operations/templates/${annualTemplate.id}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: { dueDate: '2026-12-31' },
          period_label: 'FY-2027',
        });
      expect(res2.status).toBe(201);

      expect(res1.body.data.id).not.toBe(res2.body.data.id);
      expect(res2.body.data.title).toBe('Annual Tax Compliance - FY-2027');

      // Verify two distinct generation audit rows exist
      const generations = Array.from(mockTables.retainer_template_generations.values());
      expect(generations).toHaveLength(2);
      const labels = generations.map((g) => g.period_label).sort();
      expect(labels).toEqual(['FY-2026', 'FY-2027']);
    });
  });

  describe('4. Idempotency-Key Replay (AC-4 / R4)', () => {
    it('returns cached response on retry with same Idempotency-Key without duplicates', async () => {
      const templateId = 'tpl-idempotency-test';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Idempotency Retainer',
        client_id: testClient.id,
        recurrence: 'annual',
        assigned_to: managerId,
        tasks: [{ title: 'Single Step', phase: 'pre_processing' }],
      });

      const idempotencyKey = '99999999-8888-7777-6666-555555555555';

      // 1. Initial request with Idempotency-Key
      const res1 = await request(app)
        .post(`/v1/operations/templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          overrides: { dueDate: '2026-12-31' },
          period_label: 'FY-2026',
        });

      expect(res1.status).toBe(201);
      expect(res1.header['idempotent-replay']).toBeUndefined();
      const firstWrId = res1.body.data.id;

      // 2. Replay with identical payload and Idempotency-Key
      const res2 = await request(app)
        .post(`/v1/operations/templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .set('Idempotency-Key', idempotencyKey)
        .send({
          overrides: { dueDate: '2026-12-31' },
          period_label: 'FY-2026',
        });

      expect(res2.status).toBe(201);
      expect(res2.header['idempotent-replay']).toBe('true');
      expect(res2.body.data.id).toBe(firstWrId);

      // Verify exactly ONE work request was created
      const wrs = Array.from(mockTables.work_requests.values()).filter(
        (w) => w.title.includes('Idempotency Retainer')
      );
      expect(wrs).toHaveLength(1);

      // Verify exactly ONE generation row was recorded
      const gens = Array.from(mockTables.retainer_template_generations.values());
      expect(gens).toHaveLength(1);
    });
  });

  describe('5. Boundary Cases & Scoping Integrity', () => {
    it('returns 404 Not Found when template does not exist', async () => {
      const res = await request(app)
        .post('/v1/operations/templates/non-existent-uuid/generate')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ overrides: { dueDate: '2026-12-31' }, period_label: 'FY-2026' });

      expect(res.status).toBe(404);
      expect(res.body.title).toMatch(/not found/i);
    });

    it('returns 404 Not Found when template belongs to another entity (entity isolation)', async () => {
      const templateId = 'tpl-lta-only';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-lta', // LTA entity
        name: 'LTA Only Retainer',
        recurrence: 'none',
      });

      // Caller is in ATA entity context
      const res = await request(app)
        .post(`/v1/operations/templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ overrides: { dueDate: '2026-12-31' },});

      expect(res.status).toBe(404);
    });

    it('returns 404 Not Found when template is soft-deleted', async () => {
      const templateId = 'tpl-deleted';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Deleted Retainer',
        recurrence: 'none',
        deleted_at: new Date().toISOString(),
      });

      const res = await request(app)
        .post(`/v1/operations/templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ overrides: { dueDate: '2026-12-31' },});

      expect(res.status).toBe(404);
    });

    it('generates non-recurring template with period_label: null when period_label is omitted', async () => {
      const templateId = 'tpl-no-recurrence';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: 'ent-ata',
        name: 'Ad-hoc Retainer',
        recurrence: 'none',
        assigned_to: managerId,
        tasks: [{ title: 'Ad-hoc Step', phase: 'pre_processing' }],
      });

      const res = await request(app)
        .post(`/v1/operations/templates/${templateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ overrides: { dueDate: '2026-12-31' },});

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('Ad-hoc Retainer');
      expect(res.body.data.generation).toBeDefined();
      expect(res.body.data.generation.period_label).toBeNull();
    });
  });
});
