/**
 * Test Suite: requiredLinkType.test.js
 *
 * Verifies end-to-end support for task `requiredLinkType` ('billing' | 'documents' | null):
 * 1. `phaseTaskSchema` and `generateTaskOverrideSchema` accept `requiredLinkType` and `required_link_type`.
 * 2. `createWorkRequest` (via `createWorkRequestGraph`) persists `required_link_type` onto `tasks`
 *    and returns `requiredLinkType` on `apiTasks` (including for delimiter-split tasks).
 * 3. `generateRetainerTemplate` forwards `requiredLinkType` from template tasks and overrides
 *    into `createWorkRequestGraph`.
 */

jest.mock('../../../services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../../tests/fixtures/supabaseMock');
  return { supabaseAdmin };
});

const {
  phaseTaskSchema,
  createWorkRequestSchema,
  generateTaskOverrideSchema,
  generateRetainerTemplateSchema,
} = require('../schema');

const {
  createWorkRequest,
  generateRetainerTemplate,
  getWorkRequestCounts,
  updateTask,
  addTimeLogs,
  rerouteWorkRequest,
} = require('../service');

const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('../../../../tests/fixtures/supabaseMock');

describe('Task requiredLinkType Schema & Service Support', () => {
  const ENTITY_ID = 'ent-ata';
  const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
  const MANAGER_ID = '22222222-2222-4222-8222-222222222222';
  const STAFF_ID = '33333333-3333-4333-8333-333333333333';
  const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

  let managerUser;
  let adminUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminUser = {
      id: ADMIN_ID,
      email: 'admin@ata-lta.ph',
      name: 'System Admin',
      role: 'Admin',
      departments: ['Management', 'Operations'],
      entities: ['ATA', 'LTA'],
    };
    registerUser(adminUser);

    managerUser = {
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager Lead',
      role: 'Manager',
      departments: ['Management', 'Operations'],
      entities: ['ATA', 'LTA'],
    };
    registerUser(managerUser);
    mockTables.users.get(MANAGER_ID).user_departments = [
      { departments: { name: 'Management' } },
      { departments: { name: 'Operations' } },
    ];

    registerUser({
      id: STAFF_ID,
      email: 'staff@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA', 'LTA'],
    });
    mockTables.users.get(STAFF_ID).user_departments = [
      { departments: { name: 'Operations' } },
    ];

    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENTITY_ID,
      name: 'Test Client Corp',
      status: 'Active',
      version: 1,
    });
  });

  describe('1. Zod Schemas (phaseTaskSchema & generateTaskOverrideSchema)', () => {
    it('accepts requiredLinkType: "billing" | "documents" | null in phaseTaskSchema', () => {
      for (const linkType of ['billing', 'documents', null]) {
        const parsed = phaseTaskSchema.parse({
          title: 'Test Task',
          requiredLinkType: linkType,
        });
        expect(parsed.requiredLinkType).toBe(linkType);
      }

      const parsedSnake = phaseTaskSchema.parse({
        title: 'Test Task Snake',
        required_link_type: 'billing',
      });
      expect(parsedSnake.required_link_type).toBe('billing');
    });

    it('preserves requiredLinkType through createWorkRequestSchema phases', () => {
      const parsed = createWorkRequestSchema.parse({
        dueDate: '2026-12-31',
        title: 'WR with Linked Tasks',
        phases: {
          pre_processing: {
            tasks: [{ title: 'Collect Docs', requiredLinkType: 'documents' }],
          },
          processing: {
            tasks: [{ title: 'Issue Invoice', requiredLinkType: 'billing' }],
          },
        },
      });
      expect(parsed.phases.pre_processing.tasks[0].requiredLinkType).toBe('documents');
      expect(parsed.phases.processing.tasks[0].requiredLinkType).toBe('billing');
    });

    it('accepts requiredLinkType: "billing" | "documents" | null in generateTaskOverrideSchema', () => {
      for (const linkType of ['billing', 'documents', null]) {
        const parsed = generateTaskOverrideSchema.parse({
          local_id: 't_1',
          requiredLinkType: linkType,
        });
        expect(parsed.requiredLinkType).toBe(linkType);
      }

      const parsedGen = generateRetainerTemplateSchema.parse({
        period_label: '2026-Q1',
        overrides: {
          dueDate: '2026-12-31',
          assignedTo: MANAGER_ID,
          tasks: [
            { local_id: 't_1', requiredLinkType: 'billing' },
            { local_id: 't_2', required_link_type: 'documents' },
          ],
        },
      });
      expect(parsedGen.overrides.tasks[0].requiredLinkType).toBe('billing');
      expect(parsedGen.overrides.tasks[1].required_link_type).toBe('documents');
    });
  });

  describe('2. createWorkRequestGraph persistence & response mapping', () => {
    it('persists required_link_type onto tasks and returns requiredLinkType on apiTasks (including delimiter-split tasks)', async () => {
      const result = await createWorkRequest({
        entityId: ENTITY_ID,
        user: managerUser,
        data: {
          dueDate: '2026-12-31',
          title: 'Graph Creation Test WR',
          clientId: CLIENT_ID,
          assignedTo: MANAGER_ID,
          coAssignees: [STAFF_ID],
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_doc',
                  title: 'Upload BIR Form; Upload SEC GIS',
                  assignees: [STAFF_ID],
                  requiredLinkType: 'documents',
                },
                {
                  local_id: 't_std',
                  title: 'Standard Checklist Review',
                  assignees: [STAFF_ID],
                  requiredLinkType: null,
                },
              ],
            },
            processing: {
              tasks: [
                {
                  local_id: 't_bill',
                  title: 'Generate Billing Statement',
                  assignees: [STAFF_ID],
                  depends_on: 't_doc',
                  required_link_type: 'billing',
                },
              ],
            },
          },
        },
      });

      expect(result.tasks).toHaveLength(4);

      const splitFirst = result.tasks.find((t) => t.localId === 't_doc');
      const splitSecond = result.tasks.find((t) => t.localId === 't_doc_s1');
      const standardTask = result.tasks.find((t) => t.localId === 't_std');
      const billingTask = result.tasks.find((t) => t.localId === 't_bill');

      expect(splitFirst.requiredLinkType).toBe('documents');
      expect(splitSecond.requiredLinkType).toBe('documents');
      expect(standardTask.requiredLinkType).toBeNull();
      expect(billingTask.requiredLinkType).toBe('billing');

      // Verify DB rows in mockTables.tasks
      expect(mockTables.tasks.get(splitFirst.id).required_link_type).toBe('documents');
      expect(mockTables.tasks.get(splitSecond.id).required_link_type).toBe('documents');
      expect(mockTables.tasks.get(standardTask.id).required_link_type).toBeNull();
      expect(mockTables.tasks.get(billingTask.id).required_link_type).toBe('billing');
    });
  });

  describe('3. generateRetainerTemplate forwarding of requiredLinkType', () => {
    it('forwards requiredLinkType from template tasks and overrides into createWorkRequestGraph', async () => {
      const templateId = 'tpl-link-type-test';
      mockTables.retainer_templates.set(templateId, {
        id: templateId,
        entity_id: ENTITY_ID,
        name: 'Monthly Retainer Template',
        description: 'Retainer with typed tasks',
        client_id: CLIENT_ID,
        priority: 'Normal',
        recurrence: 'none',
        tasks: [
          {
            local_id: 'tpl_t1',
            title: 'Gather Source Documents',
            phase: 'pre_processing',
            default_assignees: [STAFF_ID],
            requiredLinkType: 'documents',
          },
          {
            local_id: 'tpl_t2',
            title: 'Draft Billing Invoice',
            phase: 'processing',
            default_assignees: [STAFF_ID],
            requiredLinkType: null,
          },
          {
            local_id: 'tpl_t3',
            title: 'Task to Override to Standard',
            phase: 'processing',
            default_assignees: [STAFF_ID],
            requiredLinkType: 'billing',
          },
        ],
      });

      const generated = await generateRetainerTemplate({
        entityId: ENTITY_ID,
        templateId,
        user: managerUser,
        data: {
          period_label: '2026-10',
          overrides: {
            dueDate: '2026-12-31',
            assignedTo: MANAGER_ID,
            coAssignees: [STAFF_ID],
            tasks: [
              // Override tpl_t2 from null to 'billing'
              {
                local_id: 'tpl_t2',
                requiredLinkType: 'billing',
              },
              // Override tpl_t3 from 'billing' back to null (standard task)
              {
                local_id: 'tpl_t3',
                requiredLinkType: null,
              },
            ],
          },
        },
      });

      expect(generated.tasks).toHaveLength(3);
      const t1 = generated.tasks.find((t) => t.localId === 'tpl_t1');
      const t2 = generated.tasks.find((t) => t.localId === 'tpl_t2');
      const t3 = generated.tasks.find((t) => t.localId === 'tpl_t3');

      expect(t1.requiredLinkType).toBe('documents');
      expect(t2.requiredLinkType).toBe('billing');
      expect(t3.requiredLinkType).toBeNull();

      expect(mockTables.tasks.get(t1.id).required_link_type).toBe('documents');
      expect(mockTables.tasks.get(t2.id).required_link_type).toBe('billing');
      expect(mockTables.tasks.get(t3.id).required_link_type).toBeNull();
    });
  });

  describe('4. getWorkRequestCounts active & all counts', () => {
    it('returns { active, all, archived } with both active and all populated', async () => {
      mockTables.work_requests.set('wr-active-1', {
        id: 'wr-active-1',
        entity_id: ENTITY_ID,
        title: 'Active WR 1',
        archived: null,
        deleted_at: null,
      });
      mockTables.work_requests.set('wr-active-2', {
        id: 'wr-active-2',
        entity_id: ENTITY_ID,
        title: 'Active WR 2',
        archived: null,
        deleted_at: null,
      });
      mockTables.work_requests.set('wr-archived-1', {
        id: 'wr-archived-1',
        entity_id: ENTITY_ID,
        title: 'Archived WR 1',
        archived: true,
        deleted_at: null,
      });

      const counts = await getWorkRequestCounts({ entityId: ENTITY_ID });
      expect(counts).toEqual({
        active: 2,
        all: 2,
        archived: 1,
      });
    });
  });

  describe('5. Active Phase Gate Locking in updateTask', () => {
    it('blocks status changes on tasks belonging to inactive phases and unlocks upon QA reroute', async () => {
      const wr = await createWorkRequest({
        entityId: ENTITY_ID,
        user: adminUser,
        data: {
          dueDate: '2026-12-31',
          title: 'Phase Lock Test WR',
          clientId: CLIENT_ID,
          assignedTo: MANAGER_ID,
          coAssignees: [STAFF_ID],
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 'pre_t1',
                  title: 'Pre-processing Task',
                  assignees: [STAFF_ID],
                },
              ],
            },
            processing: {
              tasks: [
                {
                  local_id: 'proc_t1',
                  title: 'Processing Task',
                  assignees: [STAFF_ID],
                },
              ],
            },
          },
        },
      });

      const preTask = wr.tasks.find((t) => t.localId === 'pre_t1');
      const procTask = wr.tasks.find((t) => t.localId === 'proc_t1');

      // Complete preTask while WR is in pre_processing
      await updateTask({
        workRequestId: wr.id,
        taskId: preTask.id,
        entityId: ENTITY_ID,
        data: { status: 'Completed' },
        user: adminUser,
      });

      // Move WR to processing phase
      mockTables.work_requests.get(wr.id).phase = 'processing';
      mockTables.work_requests.get(wr.id).status = 'Processing';

      // Attempting to change pre_processing task status while WR is in processing -> 409 WORK_REQUEST_PHASE_NOT_ACTIVE
      await expect(
        updateTask({
          workRequestId: wr.id,
          taskId: preTask.id,
          entityId: ENTITY_ID,
          data: { status: 'In Progress' },
          user: adminUser,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'WORK_REQUEST_PHASE_NOT_ACTIVE',
        detail:
          'Cannot modify task status: task belongs to "pre_processing" phase while parent work request is in "processing" phase.',
      });

      // Complete processing task while WR is in processing
      await updateTask({
        workRequestId: wr.id,
        taskId: procTask.id,
        entityId: ENTITY_ID,
        data: { status: 'Completed' },
        user: adminUser,
      });

      // Move WR to quality_assurance phase
      mockTables.work_requests.get(wr.id).phase = 'quality_assurance';
      mockTables.work_requests.get(wr.id).status = 'Quality Assurance';

      // Both pre_processing and processing task status transitions are blocked during quality_assurance
      await expect(
        updateTask({
          workRequestId: wr.id,
          taskId: procTask.id,
          entityId: ENTITY_ID,
          data: { status: 'In Progress' },
          user: adminUser,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'WORK_REQUEST_PHASE_NOT_ACTIVE',
        detail:
          'Cannot modify task status: task belongs to "processing" phase while parent work request is in "quality_assurance" phase.',
      });

      // Mark procTask as failed QA and reroute back to processing
      mockTables.tasks.get(procTask.id).qa_status = 'failed';
      await rerouteWorkRequest({
        id: wr.id,
        entityId: ENTITY_ID,
        toPhase: 'processing',
        reason: 'Fix calculation',
        user: adminUser,
      });

      // Now WR phase is 'processing' -> procTask is unlocked and can transition to Completed
      const updatedProc = await updateTask({
        workRequestId: wr.id,
        taskId: procTask.id,
        entityId: ENTITY_ID,
        data: { status: 'Completed' },
        user: adminUser,
      });
      expect(updatedProc.status).toBe('Completed');
    });
  });

  describe('6. Accounting User Billing Task Scope in addTimeLogs', () => {
    it('allows non-Admin Accounting user to log time only on billing tasks assigned to them', async () => {
      const ACCOUNTING_ID = '44444444-4444-4444-8444-444444444444';
      const accountingUser = {
        id: ACCOUNTING_ID,
        email: 'accounting@ata-lta.ph',
        name: 'Accounting Staff',
        role: 'Accounting',
        departments: ['Accounting', 'Operations'],
        entities: ['ATA', 'LTA'],
      };
      registerUser(accountingUser);
      mockTables.users.get(ACCOUNTING_ID).user_departments = [
        { departments: { name: 'Accounting' } },
        { departments: { name: 'Operations' } },
      ];

      const wr = await createWorkRequest({
        entityId: ENTITY_ID,
        user: adminUser,
        data: {
          dueDate: '2026-12-31',
          title: 'Accounting Time Log Scope WR',
          clientId: CLIENT_ID,
          assignedTo: MANAGER_ID,
          coAssignees: [ACCOUNTING_ID],
          phases: {
            pre_processing: {
              tasks: [
                {
                  local_id: 't_std',
                  title: 'Standard Task',
                  assignees: [ACCOUNTING_ID],
                  requiredLinkType: null,
                },
                {
                  local_id: 't_doc',
                  title: 'Documents Task',
                  assignees: [ACCOUNTING_ID],
                  requiredLinkType: 'documents',
                },
                {
                  local_id: 't_bill',
                  title: 'Billing Task',
                  assignees: [ACCOUNTING_ID],
                  requiredLinkType: 'billing',
                },
              ],
            },
          },
        },
      });

      const stdTask = wr.tasks.find((t) => t.localId === 't_std');
      const docTask = wr.tasks.find((t) => t.localId === 't_doc');
      const billTask = wr.tasks.find((t) => t.localId === 't_bill');

      const sampleLogs = [
        {
          date: '2026-10-23',
          startTime: '09:00',
          endTime: '10:30',
          hours: 1.5,
          note: 'Worked on billing statement',
        },
      ];

      // Rejected on standard task (requiredLinkType: null)
      await expect(
        addTimeLogs({
          workRequestId: wr.id,
          taskId: stdTask.id,
          entityId: ENTITY_ID,
          logs: sampleLogs,
          user: accountingUser,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        detail: 'Accounting users can only log time on billing tasks assigned to them',
      });

      // Rejected on documents task (requiredLinkType: 'documents')
      await expect(
        addTimeLogs({
          workRequestId: wr.id,
          taskId: docTask.id,
          entityId: ENTITY_ID,
          logs: sampleLogs,
          user: accountingUser,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        detail: 'Accounting users can only log time on billing tasks assigned to them',
      });

      // Permitted on billing task (requiredLinkType: 'billing')
      const updatedBillTask = await addTimeLogs({
        workRequestId: wr.id,
        taskId: billTask.id,
        entityId: ENTITY_ID,
        logs: sampleLogs,
        user: accountingUser,
      });
      expect(updatedBillTask.timeLogs).toHaveLength(1);
      expect(updatedBillTask.timeLogs[0].hours).toBe(1.5);
    });
  });
});
