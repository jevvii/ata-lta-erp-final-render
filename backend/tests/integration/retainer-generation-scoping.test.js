/**
 * Retainer Template Generation Flow & Team Scoping Parity Integration Tests
 *
 * Verifies Requirement R1:
 * - Role verification passes:
 *   - Manager and Admin are permitted as assignedTo (Manager Lead).
 *   - Non-Manager / Non-Admin (e.g. Staff) is rejected with 400 Invalid Manager.
 *   - Admins in coAssignees are strictly rejected with 400 Invalid Team Member.
 *   - Operations managers and staff in coAssignees are accepted.
 * - Missing Manager Lead:
 *   - Missing or null overrides.assignedTo returns 400 Bad Request with code MANAGER_REQUIRED.
 * - Strict Task Assignee Scoping Validation:
 *   - Task assignees outside [assignedTo, ...coAssignees] return 400 TASK_ASSIGNEE_NOT_IN_TEAM.
 *   - Template default assignees outside [assignedTo, ...coAssignees] return 400 TASK_ASSIGNEE_NOT_IN_TEAM.
 *   - Valid task assignees within [assignedTo, ...coAssignees] succeed with 201 Created.
 * - Concurrency & Duplicate Period Conflict with Atomic Rollback:
 *   - Duplicate generation with identical (template_id, period_label) returns 409 PERIOD_ALREADY_GENERATED.
 *   - Failed generation insertion rolls back atomically, deleting created work requests and tasks.
 * - Task and header overrides propagation:
 *   - Forward validated task overrides, priority, dueDate, and team metadata into createWorkRequestGraph.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const createClient = async (token, entity, overrides = {}) => {
  const res = await request(app)
    .post('/v1/clients')
    .set('Authorization', `Bearer ${token}`)
    .set('X-Active-Entity', entity)
    .send({
      name: 'Test Retainer Client',
      tin: `123-456-789-${String(Math.random()).slice(2, 7)}`,
      entity,
      ...overrides,
    });
  return res.body.data;
};

describe('Retainer Generation & Team Scoping (Requirement R1)', () => {
  const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
  const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
  const OPS_MANAGER_ID = '33333333-3333-4333-8333-333333333333';
  const NON_OPS_MGR_ID = '44444444-4444-4444-8444-444444444444';
  const STAFF_1_ID = '55555555-5555-4555-8555-555555555555';
  const STAFF_2_ID = '66666666-6666-4666-8666-666666666666';
  const OUTSIDE_USER_ID = '77777777-7777-4777-8777-777777777777';

  let adminToken;
  let managerToken;
  let testClient;
  let baseTemplateId;

  beforeEach(async () => {
    resetMock();
    seedDefaults();

    // 1. Admin user
    adminToken = registerUser({
      id: ADMIN_ID,
      email: 'admin@ata-lta.ph',
      name: 'System Admin',
      role: 'Admin',
      departments: ['Management', 'Operations'],
      entities: ['ATA', 'LTA'],
    });

    // 2. Manager user (assignedTo)
    managerToken = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager Lead',
      role: 'Manager',
      departments: ['Management', 'Operations'],
      entities: ['ATA', 'LTA'],
    });

    // 3. Operations Manager (eligible for coAssignees)
    registerUser({
      id: OPS_MANAGER_ID,
      email: 'opsmgr@ata-lta.ph',
      name: 'Operations Manager Two',
      role: 'Manager',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });
    mockTables.users.get(OPS_MANAGER_ID).user_departments = [{ departments: { name: 'Operations' } }];
    mockTables.users.get(OPS_MANAGER_ID).departments = ['Operations'];

    // 4. Non-Operations Manager (in Legal, ineligible for coAssignees)
    registerUser({
      id: NON_OPS_MGR_ID,
      email: 'legalmgr@ata-lta.ph',
      name: 'Legal Manager',
      role: 'Manager',
      departments: ['Legal'],
      entities: ['ATA', 'LTA'],
    });
    mockTables.users.get(NON_OPS_MGR_ID).user_departments = [{ departments: { name: 'Legal' } }];
    mockTables.users.get(NON_OPS_MGR_ID).departments = ['Legal'];

    // 5. Staff users
    registerUser({
      id: STAFF_1_ID,
      email: 'staff1@ata-lta.ph',
      name: 'Staff One',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });
    mockTables.users.get(STAFF_1_ID).user_departments = [{ departments: { name: 'Operations' } }];
    mockTables.users.get(STAFF_1_ID).departments = ['Operations'];

    registerUser({
      id: STAFF_2_ID,
      email: 'staff2@ata-lta.ph',
      name: 'Staff Two',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });
    mockTables.users.get(STAFF_2_ID).user_departments = [{ departments: { name: 'Operations' } }];
    mockTables.users.get(STAFF_2_ID).departments = ['Operations'];

    // 6. Outside User (not in project team)
    registerUser({
      id: OUTSIDE_USER_ID,
      email: 'outside@ata-lta.ph',
      name: 'Outside Staff',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });
    mockTables.users.get(OUTSIDE_USER_ID).user_departments = [{ departments: { name: 'Operations' } }];
    mockTables.users.get(OUTSIDE_USER_ID).departments = ['Operations'];

    testClient = await createClient(adminToken, 'ATA');

    baseTemplateId = 'tpl-scoping-annual';
    mockTables.retainer_templates.set(baseTemplateId, {
      id: baseTemplateId,
      entity_id: 'ent-ata',
      name: 'Annual Tax Compliance Retainer',
      description: 'End-to-end annual tax reporting',
      client_id: testClient.id,
      priority: 'Normal',
      recurrence: 'annual',
      tasks: [
        {
          local_id: 't_intake',
          title: 'Document Intake & Source Verification',
          phase: 'pre_processing',
          default_assignees: [STAFF_1_ID],
        },
        {
          local_id: 't_processing',
          title: 'Tax Schedule Preparation',
          phase: 'processing',
          depends_on_local_id: 't_intake',
          default_assignees: [STAFF_1_ID],
        },
      ],
    });
  });

  describe('1. Mandatory Manager Lead (assignedTo)', () => {
    it('returns 400 Bad Request with code MANAGER_REQUIRED when assignedTo is missing', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            priority: 'High',
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MANAGER_REQUIRED');
      expect(res.body.detail).toBe('Manager (assignedTo) is required to generate work requests.');
    });

    it('returns 400 Bad Request with code MANAGER_REQUIRED when assignedTo is null', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: null,
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MANAGER_REQUIRED');
      expect(res.body.detail).toBe('Manager (assignedTo) is required to generate work requests.');
    });

    it('returns validation error when overrides and due date are omitted', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.detail).toContain('Due date is required');
    });
  });

  describe('2. Project Team Role Verification', () => {
    it('allows Manager as assignedTo (201 Created)', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assignedTo).toBe(MANAGER_ID);
      expect(res.body.data.coAssignees).toContain(STAFF_1_ID);
    });

    it('allows Admin as assignedTo (201 Created)', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: ADMIN_ID,
            coAssignees: [STAFF_1_ID],
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.assignedTo).toBe(ADMIN_ID);
      expect(res.body.data.coAssignees).toContain(STAFF_1_ID);
    });

    it('rejects Staff assigned as Lead with 400 Invalid Manager', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: STAFF_1_ID,
            coAssignees: [],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Invalid Manager');
      expect(res.body.detail).toMatch(/does not have the Manager role/i);
    });

    it('strictly rejects Admin in coAssignees with 400 Invalid Team Member (even if in Operations)', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [ADMIN_ID],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Invalid Team Member');
      expect(res.body.detail).toMatch(/cannot be added as a team member/i);
    });

    it('rejects Non-Operations Manager in coAssignees with 400 Invalid Team Member', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [NON_OPS_MGR_ID],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('Invalid Team Member');
      expect(res.body.detail).toMatch(/cannot be added as a team member/i);
    });

    it('allows Operations Manager in coAssignees (201 Created)', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [OPS_MANAGER_ID, STAFF_1_ID],
          },
        });

      expect(res.status).toBe(201);
      expect(res.body.data.coAssignees).toContain(OPS_MANAGER_ID);
      expect(res.body.data.coAssignees).toContain(STAFF_1_ID);
    });
  });

  describe('3. Strict Task Assignee Scoping Validation', () => {
    it('returns 400 TASK_ASSIGNEE_NOT_IN_TEAM when override task assignee does not belong to project team', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
            tasks: [
              {
                local_id: 't_intake',
                title: 'Intake step',
                phase: 'pre_processing',
                assignees: [OUTSIDE_USER_ID], // Outside project team!
              },
            ],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_ASSIGNEE_NOT_IN_TEAM');
      expect(res.body.detail).toBe(
        `Task assignee ${OUTSIDE_USER_ID} does not belong to the selected project team.`
      );
    });

    it('returns 400 TASK_ASSIGNEE_NOT_IN_TEAM when template default assignee is not in project team', async () => {
      // Template has default_assignees: [STAFF_1_ID].
      // If we generate with team [MANAGER_ID, STAFF_2_ID] without overriding tasks, STAFF_1_ID is outside team!
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_2_ID], // STAFF_1_ID is missing from team
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_ASSIGNEE_NOT_IN_TEAM');
      expect(res.body.detail).toBe(
        `Task assignee ${STAFF_1_ID} does not belong to the selected project team.`
      );
    });

    it('succeeds (201 Created) when all task assignees belong to project team [assignedTo, ...coAssignees]', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID, STAFF_2_ID],
            tasks: [
              {
                local_id: 't_intake',
                title: 'Intake Step Overridden',
                phase: 'pre_processing',
                assignees: [STAFF_1_ID],
              },
              {
                local_id: 't_processing',
                title: 'Processing Step Overridden',
                phase: 'processing',
                assignees: [STAFF_2_ID, MANAGER_ID], // Manager Lead is also in projectTeam
              },
            ],
          },
        });

      expect(res.status).toBe(201);
      const graph = res.body.data;
      expect(graph.assignedTo).toBe(MANAGER_ID);
      expect(graph.coAssignees).toContain(STAFF_1_ID);
      expect(graph.coAssignees).toContain(STAFF_2_ID);

      // Check materialized tasks
      const preTasks = graph.phases?.pre_processing?.tasks || [];
      const procTasks = graph.phases?.processing?.tasks || [];
      expect(preTasks.length).toBeGreaterThan(0);
      expect(procTasks.length).toBeGreaterThan(0);
      expect(preTasks[0].title).toBe('Intake Step Overridden');
      expect(procTasks[0].title).toBe('Processing Step Overridden');
    });

    it('forwards header overrides (title, priority, dueDate, clientId) cleanly into work request graph', async () => {
      const customDueDate = '2026-12-31T23:59:59.000Z';
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            title: 'Custom Work Request Title FY-2026',
            priority: 'Urgent',
            dueDate: customDueDate,
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
          },
        });

      expect(res.status).toBe(201);
      const graph = res.body.data;
      expect(graph.title).toBe('Custom Work Request Title FY-2026');
      expect(graph.priority).toBe('Urgent');
      expect(graph.dueDate).toBe(customDueDate);
      expect(graph.generation?.period_label).toBe('FY-2026');
    });
  });

  describe('4. Concurrency Guard, Duplicate Period Conflict & Atomic Rollback', () => {
    it('returns 409 Conflict (PERIOD_ALREADY_GENERATED) on duplicate generation for same period_label', async () => {
      // First generation succeeds
      const firstRes = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
          },
        });

      expect(firstRes.status).toBe(201);
      const firstWrId = firstRes.body.data.id;

      // Second generation with same period_label fails with 409
      const secondRes = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
          },
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body.code).toBe('PERIOD_ALREADY_GENERATED');
      expect(secondRes.body.detail).toMatch(/already generated for this template/i);

      // Verify that no extra work request was added
      const allWrs = Array.from(mockTables.work_requests.values()).filter(
        (w) => w.title && w.title.includes('Annual Tax Compliance Retainer')
      );
      expect(allWrs.length).toBe(1);
      expect(allWrs[0].id).toBe(firstWrId);
    });

    it('rolls back atomically on DB insert error 23505 without leaving orphan records', async () => {
      // Simulate a concurrent duplicate insert on retainer_template_generations
      // Pre-seed retainer_template_generations directly to trigger constraint 23505 on insert
      const initialWrCount = mockTables.work_requests.size;
      const initialTaskCount = mockTables.tasks.size;

      // Seed mock table with an existing generation row for FY-2028
      mockTables.retainer_template_generations.set('existing-gen-row', {
        id: 'existing-gen-row',
        template_id: baseTemplateId,
        period_label: 'FY-2028',
        work_request_id: 'prior-wr-id',
        generated_by: MANAGER_ID,
        generated_at: new Date().toISOString(),
      });

      // Try generating for FY-2028: it should hit the duplicate conflict
      const res = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2028',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
          },
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PERIOD_ALREADY_GENERATED');

      // Verify atomic rollback: work_requests and tasks count did not increase
      expect(mockTables.work_requests.size).toBe(initialWrCount);
      expect(mockTables.tasks.size).toBe(initialTaskCount);
    });

    it('allows generating a subsequent period with distinct period_label', async () => {
      const res2026 = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2026',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
          },
        });
      expect(res2026.status).toBe(201);

      const res2027 = await request(app)
        .post(`/v1/operations/templates/${baseTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          period_label: 'FY-2027',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_1_ID],
          },
        });
      expect(res2027.status).toBe(201);
      expect(res2027.body.data.id).not.toBe(res2026.body.data.id);
    });
  });
});
