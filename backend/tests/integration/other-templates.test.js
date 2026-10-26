/**
 * Other Templates Integration Tests
 *
 * Verifies:
 * 1. Creation of Other Template with strictly title and tasks (no client, no schedule, no pf, no recurrence)
 * 2. List Other Templates filtering by query param type=other / type=retainer
 * 3. RBAC verification:
 *    - Admins can create and edit
 *    - Managers can view and generate
 *    - Managers receive 403 on create/edit
 *    - Non-operations staff without permissions receive 403
 * 4. Ad-hoc Generation of Work Request from Other Template with overrides:
 *    - Client, Priority, Due Date, Manager Lead (assignedTo), Co-Assignees
 *    - period_label is null
 *    - Governance validation (manager required, team member scoping)
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

describe('Other Templates API & Engine Integration Tests', () => {
  const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
  const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
  const OPS_STAFF_ID = '33333333-3333-4333-8333-333333333333';
  const OTHER_STAFF_ID = '44444444-4444-4444-8444-444444444444';

  let adminToken;
  let managerToken;
  let opsStaffToken;
  let testClient;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    // 1. Admin
    adminToken = registerUser({
      id: ADMIN_ID,
      email: 'admin@ata-lta.ph',
      name: 'System Admin',
      role: 'Admin',
      departments: ['Management', 'Operations'],
      entities: ['ATA', 'LTA'],
    });

    // 2. Manager
    managerToken = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Operations Manager',
      role: 'Manager',
      departments: ['Management', 'Operations'],
      entities: ['ATA', 'LTA'],
    });

    // 3. Operations Staff (no retainers:use or retainers:edit)
    opsStaffToken = registerUser({
      id: OPS_STAFF_ID,
      email: 'staff@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });

    // 4. Another staff member for co-assignee
    registerUser({
      id: OTHER_STAFF_ID,
      email: 'other_staff@ata-lta.ph',
      name: 'Team Member Staff',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });

    // Test Client
    testClient = {
      id: '99999999-9999-4999-8999-999999999999',
      entity_id: 'ent-ata',
      name: 'Acme Advisory Corp',
      tin: '123-456-789-00001',
      status: 'Active',
    };
    mockTables.clients.set(testClient.id, testClient);
  });

  describe('1. Creation of Other Template', () => {
    it('creates an Other Template with strictly title and tasks', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'SEC Amendment Workflow',
          description: 'Standard procedure for SEC company charter amendments',
          templateType: 'other',
          tasks: [
            {
              title: 'Draft Board Resolution',
              phase: 'pre_processing',
            },
            {
              title: 'File Documents with SEC',
              phase: 'processing',
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toBe('SEC Amendment Workflow');
      expect(res.body.data.template_type).toBe('other');
      expect(res.body.data.client_id).toBeNull();
      expect(res.body.data.schedule).toBeNull();
      expect(Number(res.body.data.pf_amount)).toBe(0);
      expect(res.body.data.recurrence).toBe('none');
      expect(res.body.data.tasks).toHaveLength(2);
    });

    it('creates an Other Template with tasks containing checklist items (subtask and document)', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'SEC Amendment with Checklists',
          templateType: 'other',
          tasks: [
            {
              title: 'Draft Board Resolution',
              phase: 'pre_processing',
              checklist: [
                {
                  text: 'Confirm quorum with corporate secretary',
                  category: 'subtask',
                  completed: false,
                },
                {
                  text: 'Articles of Incorporation',
                  category: 'document',
                  periodYear: 2026,
                  completed: false,
                },
              ],
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.tasks).toHaveLength(1);
      expect(res.body.data.tasks[0].checklist).toHaveLength(2);
      expect(res.body.data.tasks[0].checklist[0].category).toBe('subtask');
      expect(res.body.data.tasks[0].checklist[1].category).toBe('document');
      expect(Number(res.body.data.tasks[0].checklist[1].periodYear)).toBe(2026);
    });

    it('rejects Other Template creation without title', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          templateType: 'other',
          tasks: [{ title: 'Some Task' }],
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/title/i);
    });

    it('rejects Other Template creation without tasks', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Empty Template',
          templateType: 'other',
          tasks: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toMatch(/tasks/i);
    });
  });

  describe('2. List and Filter Other Templates by type', () => {
    beforeEach(async () => {
      // Create a Retainer Template
      await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          name: 'Monthly Retainer Workflow',
          clientId: testClient.id,
          templateType: 'retainer',
          tasks: [{ title: 'Monthly Reconciliation' }],
        });

      // Create an Other Template
      await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Ad-hoc FDA Renewal',
          templateType: 'other',
          tasks: [{ title: 'FDA Renewal Submission' }],
        });
    });

    it('filters templates by type=other', async () => {
      const res = await request(app)
        .get('/v1/operations/templates?type=other')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Ad-hoc FDA Renewal');
      expect(res.body.data[0].template_type).toBe('other');
    });

    it('filters templates by type=retainer', async () => {
      const res = await request(app)
        .get('/v1/operations/templates?type=retainer')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Monthly Retainer Workflow');
      expect(res.body.data[0].template_type).toBe('retainer');
    });

    it('returns all templates when no type query param is provided', async () => {
      const res = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('3. RBAC Verification', () => {
    it('allows Admin to create and update an Other Template', async () => {
      const createRes = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Initial Title',
          templateType: 'other',
          tasks: [{ title: 'Task 1' }],
        });

      expect(createRes.status).toBe(201);
      const templateId = createRes.body.data.id;

      const updateRes = await request(app)
        .put(`/v1/operations/templates/${templateId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Updated Title',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.name).toBe('Updated Title');
    });

    it('allows Manager with retainers:use to list Other Templates', async () => {
      const res = await request(app)
        .get('/v1/operations/templates?type=other')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(res.status).toBe(200);
    });

    it('blocks Manager lacking retainers:edit from creating an Other Template', async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Manager Template',
          templateType: 'other',
          tasks: [{ title: 'Task 1' }],
        });

      expect(res.status).toBe(403);
    });

    it('blocks non-authorized staff without retainers:use from listing or creating templates', async () => {
      const listRes = await request(app)
        .get('/v1/operations/templates')
        .set('Authorization', `Bearer ${opsStaffToken}`)
        .set('X-Active-Entity', 'ATA');

      expect(listRes.status).toBe(403);

      const createRes = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${opsStaffToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Staff Template',
          templateType: 'other',
          tasks: [{ title: 'Task 1' }],
        });

      expect(createRes.status).toBe(403);
    });
  });

  describe('4. Work Request Generation from Other Template with Overrides', () => {
    let otherTemplateId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'Tax Assessment Representation',
          description: 'BIR assessment response and protest filing',
          templateType: 'other',
          tasks: [
            {
              local_id: 'task-1',
              title: 'Review Letter of Authority',
              phase: 'pre_processing',
            },
            {
              local_id: 'task-2',
              title: 'Draft Protest Letter',
              phase: 'processing',
            },
          ],
        });
      otherTemplateId = res.body.data.id;
    });

    it('generates a Work Request with mandatory governance and overrides', async () => {
      const dueDate = '2026-11-15T00:00:00.000Z';
      const res = await request(app)
        .post(`/v1/operations/templates/${otherTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: {
            clientId: testClient.id,
            priority: 'Urgent',
            dueDate,
            assignedTo: MANAGER_ID,
            coAssignees: [OTHER_STAFF_ID],
            description: 'Custom notes for this tax assessment',
          },
        });

      expect(res.status).toBe(201);
      const wr = res.body.data;
      expect(wr.id).toBeDefined();
      expect(wr.clientId || wr.client_id).toBe(testClient.id);
      expect(wr.priority).toBe('Urgent');
      expect(wr.assignedTo || wr.assigned_to).toBe(MANAGER_ID);
      const coList = wr.coAssignees || wr.co_assignees;
      expect(coList).toContain(OTHER_STAFF_ID);
      expect(wr.dueDate || wr.due_date).toBe(dueDate);
      expect(wr.description).toBe('Custom notes for this tax assessment');
      expect(wr.generation).toBeDefined();
      expect(wr.generation.period_label).toBeNull();
    });

    it('rejects generation when Manager Lead (assignedTo) is missing', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${otherTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: {
            dueDate: '2026-12-31',
            clientId: testClient.id,
            priority: 'High',
            coAssignees: [OTHER_STAFF_ID],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MANAGER_REQUIRED');
    });

    it('rejects generation when task assignee is outside project team', async () => {
      const res = await request(app)
        .post(`/v1/operations/templates/${otherTemplateId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: {
            dueDate: '2026-12-31',
            clientId: testClient.id,
            assignedTo: MANAGER_ID,
            coAssignees: [],
            tasks: [
              {
                local_id: 'task-1',
                assignees: [OTHER_STAFF_ID], // not in project team
              },
            ],
          },
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('TASK_ASSIGNEE_NOT_IN_TEAM');
    });

    it('generates a Work Request materializing checklist items into task_checklists table', async () => {
      // 1. Create template with checklist
      const tplRes = await request(app)
        .post('/v1/operations/templates')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          title: 'BIR Audit Template with Checklist',
          templateType: 'other',
          tasks: [
            {
              local_id: 'task-bir-1',
              title: 'Gather Audit Docs',
              phase: 'pre_processing',
              checklist: [
                {
                  text: 'Request bank reconciliation',
                  category: 'subtask',
                },
                {
                  text: 'BIR Form 1702-RT',
                  category: 'document',
                  periodYear: 2025,
                },
              ],
            },
          ],
        });
      expect(tplRes.status).toBe(201);
      const tplId = tplRes.body.data.id;

      // 2. Generate Work Request
      const genRes = await request(app)
        .post(`/v1/operations/templates/${tplId}/generate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({
          overrides: {
            dueDate: '2026-12-31',
            clientId: testClient.id,
            assignedTo: MANAGER_ID,
          },
        });

      expect(genRes.status).toBe(201);
      const wr = genRes.body.data;
      expect(wr.id).toBeDefined();

      // Check task_checklists table
      const clRows = Array.from(mockTables.task_checklists.values());
      const subtaskRow = clRows.find((r) => r.text === 'Request bank reconciliation');
      const docRow = clRows.find((r) => r.text === 'BIR Form 1702-RT');

      expect(subtaskRow).toBeDefined();
      expect(subtaskRow.category).toBe('subtask');
      expect(subtaskRow.completed).toBe(false);

      expect(docRow).toBeDefined();
      expect(docRow.category).toBe('document');
      expect(docRow.period_year).toBe(2025);

      // Check returned apiTasks checklist
      const preTasks = wr.phases?.pre_processing?.tasks || wr.tasks;
      const targetTask = preTasks.find((t) => t.title === 'Gather Audit Docs');
      expect(targetTask).toBeDefined();
      expect(targetTask.checklist).toHaveLength(2);
    });
  });
});
