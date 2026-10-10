/**
 * Challenger V2 Empirical Test Suite (Adversarial Verification for Parcel B1 Remediation)
 *
 * Exercises:
 * 1. Deep relational department evaluation in validateProjectTeamRoles (edge cases, casing, nulls, joins)
 * 2. task_assignees lead unassign synchronization & multi-assignee semantics in updateTask
 * 3. Work request lock and phase immutability
 * 4. Billing request draft invoice fallback, idempotency, and error handling
 */

jest.mock('../src/services/supabaseClient', () => {
  const mockClient = {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: {} }, error: null }),
    },
  };
  return { supabaseAdmin: mockClient, verifyToken: jest.fn() };
});

jest.mock('../src/services/auditService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/services/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
  FROZEN_NOTIFICATION_TYPES: [],
}));

const { supabaseAdmin } = require('../src/services/supabaseClient');
const operationsService = require('../src/modules/operations/service');
const operationsRequestsService = require('../src/modules/operationsRequests/service');

describe('Challenger V2: Empirical Stress Test Suite (Parcel B1)', () => {
  let tableMockHandlers = {};

  const createMockQueryBuilder = (table) => {
    const queryState = {
      table,
      selectCols: '*',
      filters: {},
      inFilters: {},
      isFilters: {},
      action: 'select',
      insertPayload: null,
      updatePayload: null,
    };

    const builder = {
      _queryState: queryState,
      select: jest.fn((cols = '*') => {
        queryState.selectCols = cols;
        return builder;
      }),
      insert: jest.fn((payload) => {
        queryState.action = 'insert';
        queryState.insertPayload = payload;
        return builder;
      }),
      update: jest.fn((payload) => {
        queryState.action = 'update';
        queryState.updatePayload = payload;
        return builder;
      }),
      delete: jest.fn(() => {
        queryState.action = 'delete';
        return builder;
      }),
      eq: jest.fn((col, val) => {
        queryState.filters[col] = val;
        return builder;
      }),
      in: jest.fn((col, vals) => {
        queryState.inFilters[col] = vals;
        return builder;
      }),
      is: jest.fn((col, val) => {
        queryState.isFilters[col] = val;
        return builder;
      }),
      or: jest.fn(() => builder),
      neq: jest.fn((col, val) => {
        queryState.neqFilters = queryState.neqFilters || {};
        queryState.neqFilters[col] = val;
        return builder;
      }),
      gt: jest.fn(() => builder),
      gte: jest.fn(() => builder),
      lt: jest.fn(() => builder),
      lte: jest.fn(() => builder),
      like: jest.fn(() => builder),
      ilike: jest.fn(() => builder),
      order: jest.fn(() => builder),
      range: jest.fn(() => builder),
      maybeSingle: jest.fn(async () => {
        const handler = tableMockHandlers[table];
        if (typeof handler === 'function') {
          return handler(queryState, 'maybeSingle');
        }
        return { data: null, error: null };
      }),
      single: jest.fn(async () => {
        const handler = tableMockHandlers[table];
        if (typeof handler === 'function') {
          return handler(queryState, 'single');
        }
        return { data: null, error: null };
      }),
      then: (resolve, reject) => {
        const handler = tableMockHandlers[table];
        let res;
        if (typeof handler === 'function') {
          res = handler(queryState, 'then');
        } else {
          res = { data: [], error: null };
        }
        return Promise.resolve(res).then(resolve, reject);
      },
    };

    return builder;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tableMockHandlers = {};
    supabaseAdmin.from.mockImplementation((table) => createMockQueryBuilder(table));
  });

  describe('Adversarial Challenge 1: Relational Department Lookup Edge Cases', () => {
    it('accepts manager when user_departments has uppercase OPERATIONS', async () => {
      const userId = '018f45a2-8921-789a-bcde-012345678901';
      tableMockHandlers.users = () => ({
        data: [
          {
            id: userId,
            name: 'Uppercase Ops Mgr',
            role: 'Manager',
            user_departments: [{ departments: { name: 'OPERATIONS' } }],
          },
        ],
        error: null,
      });

      await expect(
        operationsService.validateProjectTeamRoles({ coAssignees: [userId] })
      ).resolves.toBeUndefined();
    });

    it('accepts admin when user_departments has multiple departments including Operations', async () => {
      const userId = '018f45a2-8921-789a-bcde-012345678902';
      tableMockHandlers.users = () => ({
        data: [
          {
            id: userId,
            name: 'Multi Dept Admin',
            role: 'Admin',
            user_departments: [
              { departments: { name: 'Executive' } },
              { departments: { name: 'Accounting' } },
              { departments: { name: 'Operations' } },
            ],
          },
        ],
        error: null,
      });

      await expect(
        operationsService.validateProjectTeamRoles({ coAssignees: [userId] })
      ).resolves.toBeUndefined();
    });

    it('safely rejects manager when user_departments contains malformed entries without throwing unhandled exceptions', async () => {
      const userId = '018f45a2-8921-789a-bcde-012345678903';
      tableMockHandlers.users = () => ({
        data: [
          {
            id: userId,
            name: 'Malformed Dept Mgr',
            role: 'Manager',
            user_departments: [
              { departments: null },
              { departments: { name: null } },
              {},
            ],
          },
        ],
        error: null,
      });

      await expect(
        operationsService.validateProjectTeamRoles({ coAssignees: [userId] })
      ).rejects.toMatchObject({
        statusCode: 400,
        title: 'Invalid Team Member',
      });
    });

    it('permits staff role regardless of user_departments contents', async () => {
      const userId = '018f45a2-8921-789a-bcde-012345678904';
      tableMockHandlers.users = () => ({
        data: [
          {
            id: userId,
            name: 'Staff Member',
            role: 'Staff',
            user_departments: [{ departments: { name: 'Legal' } }],
          },
        ],
        error: null,
      });

      await expect(
        operationsService.validateProjectTeamRoles({ coAssignees: [userId] })
      ).resolves.toBeUndefined();
    });

    it('falls back to legacy departments array when user_departments is undefined', async () => {
      const userId = '018f45a2-8921-789a-bcde-012345678905';
      tableMockHandlers.users = () => ({
        data: [
          {
            id: userId,
            name: 'Legacy Dept Manager',
            role: 'Manager',
            departments: ['Operations'],
          },
        ],
        error: null,
      });

      await expect(
        operationsService.validateProjectTeamRoles({ coAssignees: [userId] })
      ).resolves.toBeUndefined();
    });

    it('correctly handles lookup by name string instead of UUID', async () => {
      const nonUuidName = 'Jane NonUUID Name';
      tableMockHandlers.users = (qs) => {
        if (qs.inFilters.name && qs.inFilters.name.includes(nonUuidName)) {
          return {
            data: [
              {
                id: '018f45a2-8921-789a-bcde-012345678906',
                name: nonUuidName,
                role: 'Manager',
                user_departments: [{ departments: { name: 'Executive' } }],
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };

      await expect(
        operationsService.validateProjectTeamRoles({ coAssignees: [nonUuidName] })
      ).rejects.toMatchObject({
        statusCode: 400,
        title: 'Invalid Team Member',
      });
    });

    it('rejects non-manager user assigned as project manager (assignedTo)', async () => {
      const userId = '018f45a2-8921-789a-bcde-012345678907';
      tableMockHandlers.users = () => ({
        data: {
          id: userId,
          name: 'Staff Not Manager',
          role: 'Staff',
        },
        error: null,
      });

      await expect(
        operationsService.validateProjectTeamRoles({ assignedTo: userId })
      ).rejects.toMatchObject({
        statusCode: 400,
        title: 'Invalid Manager',
      });
    });
  });

  describe('Adversarial Challenge 2: task_assignees Synchronization & updateTask', () => {
    it('deletes from task_assignees when existing task only has snake_case assignee_id', async () => {
      const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';
      const leadUserId = '018f45a2-8921-789a-bcde-0123456789aa';
      let deleteCalledOnTaskAssignees = false;
      let deleteFilters = null;

      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                title: 'Existing Task',
                assignee_id: leadUserId,
                assignee_name: 'Lead Person',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'update') {
            return {
              data: [{ id: taskId, ...qs.updatePayload }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        task_assignees: (qs) => {
          if (qs.action === 'delete') {
            deleteCalledOnTaskAssignees = true;
            deleteFilters = qs.filters;
            return { data: [], error: null };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await operationsService.updateTask({
        taskId,
        data: { assigneeId: null },
        user: { id: 'admin' },
      });

      expect(deleteCalledOnTaskAssignees).toBe(true);
      expect(deleteFilters.task_id).toBe(taskId);
      expect(deleteFilters.user_id).toBe(leadUserId);
    });

    it('does NOT invoke task_assignees delete when existing task had NO assignee to begin with', async () => {
      const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';
      let deleteCalledOnTaskAssignees = false;

      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                title: 'Unassigned Task',
                assignee_id: null,
                assignee_name: null,
                status: 'Draft',
                phase: 'pre_processing',
                predecessors: [],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'update') {
            return {
              data: [{ id: taskId, ...qs.updatePayload }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        task_assignees: (qs) => {
          if (qs.action === 'delete') {
            deleteCalledOnTaskAssignees = true;
            return { data: [], error: null };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await operationsService.updateTask({
        taskId,
        data: { assigneeId: null },
        user: { id: 'admin' },
      });

      expect(deleteCalledOnTaskAssignees).toBe(false);
    });

    it('does NOT invoke task_assignees delete when assigneeId is omitted (undefined)', async () => {
      const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';
      const leadUserId = '018f45a2-8921-789a-bcde-0123456789aa';
      let deleteCalledOnTaskAssignees = false;
      let taskUpdatePayload = null;

      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                title: 'Assigned Task',
                assignee_id: leadUserId,
                assignee_name: 'Lead Person',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'update') {
            taskUpdatePayload = qs.updatePayload;
            return {
              data: [{ id: taskId, ...qs.updatePayload }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        task_assignees: (qs) => {
          if (qs.action === 'delete') {
            deleteCalledOnTaskAssignees = true;
            return { data: [], error: null };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await operationsService.updateTask({
        taskId,
        data: { title: 'Updated Title' },
        user: { id: 'admin' },
      });

      expect(deleteCalledOnTaskAssignees).toBe(false);
      expect(taskUpdatePayload.assignee_id).toBe(leadUserId);
      expect(taskUpdatePayload.assignee_name).toBe('Lead Person');
    });

    it('rejects attempt to mutate task phase with TASK_PHASE_IMMUTABLE', async () => {
      const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';

      await expect(
        operationsService.updateTask({
          taskId,
          data: { phase: 'processing' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'TASK_PHASE_IMMUTABLE',
      });
    });

    it('blocks advancing processing task out of Draft when pre_processing tasks are incomplete (PHASE_PREREQUISITE)', async () => {
      const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';
      const wrId = '018f45a2-8921-789a-bcde-0123456789bb';

      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Processing Task',
                status: 'Draft',
                phase: 'processing',
                predecessors: [],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.filters.phase === 'pre_processing') {
            return {
              data: [
                {
                  id: 'pre-task-1',
                  title: 'Prerequisite Setup',
                  status: 'In Progress', // Not completed!
                },
              ],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
        task_assignees: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'In Progress' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'PHASE_PREREQUISITE',
      });
    });
  });

  describe('Adversarial Challenge 3: Billing Request Fulfillment & Invoicing Edge Cases', () => {
    it('safely handles missing parent work request by defaulting client_id to null without crashing', async () => {
      const reqId = '018f45a2-8921-789a-bcde-012345678910';
      const wrId = '018f45a2-8921-789a-bcde-012345678920';
      const entityId = '018f45a2-8921-789a-bcde-012345678930';

      let invoicePayload = null;

      tableMockHandlers = {
        operations_requests: () => ({
          data: {
            id: reqId,
            entity_id: entityId,
            type: 'billing',
            status: 'pending',
            work_request_id: wrId,
            client_id: null,
            requested_by: 'requester-id',
          },
          error: null,
        }),
        work_requests: () => ({
          data: null, // parent work request not found in database!
          error: null,
        }),
        invoices: (qs) => {
          if (qs.action === 'select') return { data: [], error: null };
          if (qs.action === 'insert') {
            invoicePayload = qs.insertPayload;
            return { data: [qs.insertPayload], error: null };
          }
          return { data: [], error: null };
        },
        users: () => ({ data: [], error: null }),
        clients: () => ({ data: [], error: null }),
        tasks: () => ({ data: [], error: null }),
      };

      supabaseAdmin.rpc = jest.fn().mockResolvedValue({
        data: [{ id: reqId, status: 'fulfilled' }],
        error: null,
      });

      await operationsRequestsService.updateRequest({
        entityId,
        id: reqId,
        userId: 'admin-id',
        data: { status: 'fulfilled' },
      });

      expect(invoicePayload).toBeDefined();
      expect(invoicePayload.client_id).toBeNull();
      expect(invoicePayload.work_request_id).toBe(wrId);
    });

    it('does NOT query work_requests for client_id fallback when operations_requests already has a non-null client_id', async () => {
      const reqId = '018f45a2-8921-789a-bcde-012345678911';
      const wrId = '018f45a2-8921-789a-bcde-012345678921';
      const directClientId = '018f45a2-8921-789a-bcde-012345678931';
      const entityId = '018f45a2-8921-789a-bcde-012345678941';

      let fallbackClientIdQueried = false;
      let invoicePayload = null;

      tableMockHandlers = {
        operations_requests: () => ({
          data: {
            id: reqId,
            entity_id: entityId,
            type: 'billing',
            status: 'pending',
            work_request_id: wrId,
            client_id: directClientId,
            requested_by: 'requester-id',
          },
          error: null,
        }),
        work_requests: (qs, method) => {
          if (qs.selectCols === 'client_id' && method === 'maybeSingle') {
            fallbackClientIdQueried = true;
          }
          return { data: [{ id: wrId, title: 'WR' }], error: null };
        },
        invoices: (qs) => {
          if (qs.action === 'select') return { data: [], error: null };
          if (qs.action === 'insert') {
            invoicePayload = qs.insertPayload;
            return { data: [qs.insertPayload], error: null };
          }
          return { data: [], error: null };
        },
        users: () => ({ data: [], error: null }),
        clients: () => ({ data: [], error: null }),
        tasks: () => ({ data: [], error: null }),
      };

      supabaseAdmin.rpc = jest.fn().mockResolvedValue({
        data: [{ id: reqId, status: 'fulfilled' }],
        error: null,
      });

      await operationsRequestsService.updateRequest({
        entityId,
        id: reqId,
        userId: 'admin-id',
        data: { status: 'fulfilled' },
      });

      expect(fallbackClientIdQueried).toBe(false);
      expect(invoicePayload.client_id).toBe(directClientId);
    });
  });

  describe('Adversarial Challenge 4: Parcel B2 Completed WR Lock & Mutation Resistance (B2.1)', () => {
    const wrId = '018f45a2-8921-789a-bcde-0123456789c0';
    const entityId = 'ent-ata';

    const testUser = {
      id: '018f45a2-8921-789a-bcde-012345678901',
      name: 'Admin Tester',
      role: 'Admin',
    };

    const mockCompletedWr = {
      id: wrId,
      entity_id: entityId,
      title: 'Original Completed WR',
      description: 'Original Description',
      status: 'Completed',
      priority: 'Normal',
      version: 2,
      archived: false,
    };

    it('rejects modifying each mutable business field individually when reopening completed WR', async () => {
      const fieldMatrix = [
        { field: 'title', value: 'Adversarial Title' },
        { field: 'description', value: 'Adversarial Description' },
        { field: 'clientId', value: '018f45a2-8921-789a-bcde-012345678999' },
        { field: 'priority', value: 'Urgent' },
        { field: 'dueDate', value: '2026-12-31' },
        { field: 'assignedTo', value: '018f45a2-8921-789a-bcde-012345678901' },
        { field: 'coAssignees', value: ['018f45a2-8921-789a-bcde-012345678901'] },
        { field: 'archived', value: true },
      ];

      tableMockHandlers = {
        work_requests: () => ({ data: mockCompletedWr, error: null }),
        users: () => ({ data: [], error: null }),
      };

      for (const item of fieldMatrix) {
        await expect(
          operationsService.updateWorkRequest({
            id: wrId,
            entityId,
            data: { status: 'Draft', [item.field]: item.value },
            user: testUser,
          })
        ).rejects.toMatchObject({
          statusCode: 400,
          code: 'COMPLETED_WR_MODIFICATION_DISALLOWED',
          detail: expect.stringContaining(item.field),
        });
      }
    });

    it('rejects multiple business fields submitted simultaneously while reopening to Processing', async () => {
      tableMockHandlers = {
        work_requests: () => ({ data: mockCompletedWr, error: null }),
        users: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateWorkRequest({
          id: wrId,
          entityId,
          data: {
            status: 'Processing',
            title: 'Hacked Title',
            priority: 'High',
            archived: true,
          },
          user: testUser,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'COMPLETED_WR_MODIFICATION_DISALLOWED',
        detail: expect.stringMatching(/title.*priority.*archived/),
      });
    });

    it('rejects modifying completed WR when status is omitted entirely', async () => {
      tableMockHandlers = {
        work_requests: () => ({ data: mockCompletedWr, error: null }),
        users: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateWorkRequest({
          id: wrId,
          entityId,
          data: { title: 'Unauthorized Modification' },
          user: testUser,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'Completed Work Requests are locked and cannot be modified',
      });
    });

    it('rejects invalid non-reopen status transitions from Completed (In Progress or Cancelled)', async () => {
      tableMockHandlers = {
        work_requests: () => ({ data: mockCompletedWr, error: null }),
        users: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateWorkRequest({
          id: wrId,
          entityId,
          data: { status: 'In Progress' },
          user: testUser,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'Completed Work Requests are locked and cannot be modified',
      });

      await expect(
        operationsService.updateWorkRequest({
          id: wrId,
          entityId,
          data: { status: 'Cancelled' },
          user: testUser,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        detail: 'Completed Work Requests are locked and cannot be modified',
      });
    });

    it('allows reopening completed WR when only status is passed (Draft or Processing)', async () => {
      let updateExecuted = false;
      tableMockHandlers = {
        work_requests: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                ...mockCompletedWr,
                status: updateExecuted ? 'Draft' : 'Completed',
              },
              error: null,
            };
          }
          if (qs.action === 'update') {
            updateExecuted = true;
            return {
              data: [{ ...mockCompletedWr, status: qs.updatePayload.status }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        users: () => ({ data: [], error: null }),
      };

      const result = await operationsService.updateWorkRequest({
        id: wrId,
        entityId,
        data: { status: 'Draft' },
        user: testUser,
      });

      expect(updateExecuted).toBe(true);
      expect(result.status).toBe('Draft');
    });
  });

  describe('Adversarial Challenge 5: Parcel B2 Atomic Status Guards & OCC Conflict Handling (B2.2)', () => {
    const wrId = '018f45a2-8921-789a-bcde-0123456789c1';
    const entityId = 'ent-ata';
    const testUser = { id: 'admin-id', role: 'Admin' };

    it('conditions on .neq("status", "Completed") and throws 409 CONCURRENT_MODIFICATION if WR was completed in race condition', async () => {
      let capturedQuery = null;
      tableMockHandlers = {
        work_requests: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: { id: wrId, entity_id: entityId, status: 'In Progress', version: 1 },
              error: null,
            };
          }
          if (qs.action === 'update') {
            capturedQuery = qs;
            return { data: [], error: null }; // 0 rows updated due to concurrent completion
          }
          return { data: [], error: null };
        },
      };

      await expect(
        operationsService.updateWorkRequest({
          id: wrId,
          entityId,
          data: { title: 'Concurrent Race Edit' },
          user: testUser,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONCURRENT_MODIFICATION',
        detail: 'Work request was modified or completed concurrently. Please reload.',
      });

      expect(capturedQuery.neqFilters).toBeDefined();
      expect(capturedQuery.neqFilters.status).toBe('Completed');
    });

    it('conditions on .eq("status", "Completed") when reopening and throws 409 CONCURRENT_MODIFICATION if WR was already altered', async () => {
      let capturedQuery = null;
      tableMockHandlers = {
        work_requests: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: { id: wrId, entity_id: entityId, status: 'Completed', version: 1 },
              error: null,
            };
          }
          if (qs.action === 'update') {
            capturedQuery = qs;
            return { data: [], error: null }; // 0 rows updated
          }
          return { data: [], error: null };
        },
      };

      await expect(
        operationsService.updateWorkRequest({
          id: wrId,
          entityId,
          data: { status: 'Draft' },
          user: testUser,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONCURRENT_MODIFICATION',
      });

      expect(capturedQuery.filters.status).toBe('Completed');
    });

    it('throws 500 Database Error when work request update query fails', async () => {
      tableMockHandlers = {
        work_requests: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: { id: wrId, entity_id: entityId, status: 'In Progress', version: 1 },
              error: null,
            };
          }
          if (qs.action === 'update') {
            return { data: null, error: { message: 'relation deadlock' } };
          }
          return { data: [], error: null };
        },
      };

      await expect(
        operationsService.updateWorkRequest({
          id: wrId,
          entityId,
          data: { title: 'DB Fail' },
          user: testUser,
        })
      ).rejects.toMatchObject({
        statusCode: 500,
        title: 'Database Error',
        detail: 'Unable to update work request',
      });
    });
  });

  describe('Adversarial Challenge 6: Parcel B2 Task Predecessor Verification, Query Failure, & Scoping (B2.3, B2.4)', () => {
    const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';
    const wrId = '018f45a2-8921-789a-bcde-0123456789c2';
    const predId1 = '018f45a2-8921-789a-bcde-0123456789e1';
    const predId2 = '018f45a2-8921-789a-bcde-0123456789e2';

    it('throws 500 Database Error if predecessor verification query fails', async () => {
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Task with Preds',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [predId1],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.inFilters.id) {
            return { data: null, error: { message: 'connection pool exhausted' } };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 500,
        title: 'Database Error',
        detail: expect.stringContaining('Failed to verify prerequisite tasks: connection pool exhausted'),
      });
    });

    it('throws 400 TASK_PREDECESSORS_NOT_FOUND when one or more predecessors do not exist in DB', async () => {
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Task with Multiple Preds',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [predId1, predId2],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.inFilters.id) {
            // DB only has predId1, predId2 is missing!
            return {
              data: [{ id: predId1, title: 'Existing Prereq', status: 'Completed' }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'TASK_PREDECESSORS_NOT_FOUND',
        detail: expect.stringContaining(predId2),
      });
    });

    it('strictly scopes predecessor lookup by work_request_id and rejects cross-WR predecessors', async () => {
      const foreignWrPredId = '018f45a2-8921-789a-bcde-0123456789f9';
      let capturedPredQuery = null;

      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Task with Foreign Pred',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [foreignWrPredId],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.inFilters.id) {
            capturedPredQuery = qs;
            // Cross-WR filter matches 0 rows because task belongs to another WR
            return { data: [], error: null };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'TASK_PREDECESSORS_NOT_FOUND',
        detail: expect.stringContaining(foreignWrPredId),
      });

      expect(capturedPredQuery.filters.work_request_id).toBe(wrId);
    });

    it('rejects completing task when predecessor is in non-Completed status', async () => {
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Task with Incomplete Pred',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [predId1],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.inFilters.id) {
            return {
              data: [{ id: predId1, title: 'Unfinished Pred', status: 'In Progress' }],
              error: null,
            };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'TASK_PREDECESSORS_INCOMPLETE',
        detail: expect.stringContaining('"Unfinished Pred" (In Progress)'),
      });
    });
  });

  describe('Adversarial Challenge 7: Parcel B2 Atomic Completion Guard & Predecessor Race (B2.5)', () => {
    const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';
    const wrId = '018f45a2-8921-789a-bcde-0123456789c3';
    const predId = '018f45a2-8921-789a-bcde-0123456789e3';

    it('detects prerequisite reopened between initial check and write, blocking completion', async () => {
      let selectCount = 0;
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Race Condition Task',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [predId],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.inFilters.id) {
            selectCount++;
            if (selectCount === 1) {
              return { data: [{ id: predId, title: 'Prereq', status: 'Completed' }], error: null };
            }
            // Reopened right before write!
            return { data: [{ id: predId, status: 'Draft' }], error: null };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'TASK_PREDECESSORS_INCOMPLETE',
      });

      expect(selectCount).toBe(2);
    });

    it('detects prerequisite deleted between initial check and write, blocking completion', async () => {
      let selectCount = 0;
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Race Delete Task',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [predId],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.inFilters.id) {
            selectCount++;
            if (selectCount === 1) {
              return { data: [{ id: predId, title: 'Prereq', status: 'Completed' }], error: null };
            }
            // Prerequisite deleted before write!
            return { data: [], error: null };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'TASK_PREDECESSORS_INCOMPLETE',
      });

      expect(selectCount).toBe(2);
    });

    it('handles DB error on completion recheck gracefully with 500 Database Error', async () => {
      let selectCount = 0;
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Recheck Error Task',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [predId],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'select' && qs.inFilters.id) {
            selectCount++;
            if (selectCount === 1) {
              return { data: [{ id: predId, title: 'Prereq', status: 'Completed' }], error: null };
            }
            return { data: null, error: { message: 'socket closed abruptly' } };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 500,
        title: 'Database Error',
        detail: expect.stringContaining('Failed to verify prerequisite tasks: socket closed abruptly'),
      });
    });

    it('applies .neq("status", "Completed") on task completion write and throws 409 CONCURRENT_MODIFICATION on 0 rows', async () => {
      let capturedTaskQuery = null;
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'No Pred Task',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'update') {
            capturedTaskQuery = qs;
            return { data: [], error: null }; // 0 rows updated
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { status: 'Completed' },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONCURRENT_MODIFICATION',
        detail: 'Task was modified or completed concurrently. Please reload.',
      });

      expect(capturedTaskQuery.neqFilters.status).toBe('Completed');
    });
  });

  describe('Adversarial Challenge 8: Parcel B2 Assignee Clearance Error Handling (B2.6)', () => {
    const taskId = '05c93540-c3d3-460f-90e9-74d47c2bc386';
    const wrId = '018f45a2-8921-789a-bcde-0123456789c4';
    const leadUserId = '018f45a2-8921-789a-bcde-0123456789a1';

    it('throws 500 Database Error when task_assignees delete returns delError', async () => {
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Task With Lead',
                assignee_id: leadUserId,
                assignee_name: 'Lead User',
                status: 'In Progress',
                phase: 'processing',
                predecessors: [],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'update') {
            return { data: [{ id: taskId, ...qs.updatePayload }], error: null };
          }
          return { data: [], error: null };
        },
        task_assignees: (qs) => {
          if (qs.action === 'delete') {
            return { data: null, error: { message: 'permission denied for table task_assignees' } };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await expect(
        operationsService.updateTask({
          workRequestId: wrId,
          taskId,
          data: { assigneeId: null },
          user: { id: 'admin' },
        })
      ).rejects.toMatchObject({
        statusCode: 500,
        title: 'Database Error',
        detail: expect.stringContaining('Failed to clear assignee from task_assignees: permission denied for table task_assignees'),
      });
    });

    it('safely skips task_assignees delete when task already had no assignee', async () => {
      let deleteCalled = false;
      tableMockHandlers = {
        tasks: (qs, method) => {
          if (qs.action === 'select' && method === 'maybeSingle') {
            return {
              data: {
                id: taskId,
                work_request_id: wrId,
                title: 'Unassigned Task',
                assignee_id: null,
                assigneeId: null,
                status: 'Draft',
                phase: 'pre_processing',
                predecessors: [],
                version: 1,
              },
              error: null,
            };
          }
          if (qs.action === 'update') {
            return { data: [{ id: taskId, ...qs.updatePayload }], error: null };
          }
          return { data: [], error: null };
        },
        task_assignees: (qs) => {
          if (qs.action === 'delete') {
            deleteCalled = true;
            return { data: [], error: null };
          }
          return { data: [], error: null };
        },
        task_checklists: () => ({ data: [], error: null }),
        task_time_logs: () => ({ data: [], error: null }),
        documents: () => ({ data: [], error: null }),
      };

      await operationsService.updateTask({
        workRequestId: wrId,
        taskId,
        data: { assigneeId: null },
        user: { id: 'admin' },
      });

      expect(deleteCalled).toBe(false);
    });
  });

  describe('Adversarial Challenge 9: Parcel B2 Collision-Safe Invoice Generation Exhaustion & Retries (B2.7)', () => {
    const reqId = '018f45a2-8921-789a-bcde-0123456789d1';
    const wrId = '018f45a2-8921-789a-bcde-0123456789d2';
    const clientId = '018f45a2-8921-789a-bcde-0123456789d3';
    const entityId = 'ent-ata';

    it('retries up to 5 attempts when unique constraint violation 23505 occurs, then successfully persists', async () => {
      let attempts = 0;
      let insertedRow = null;

      tableMockHandlers = {
        operations_requests: () => ({
          data: {
            id: reqId,
            entity_id: entityId,
            type: 'billing',
            status: 'pending',
            work_request_id: wrId,
            client_id: clientId,
            requested_by: 'requester-id',
          },
          error: null,
        }),
        work_requests: () => ({ data: [], error: null }),
        invoices: (qs) => {
          if (qs.action === 'insert') {
            attempts++;
            if (attempts <= 2) {
              return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
            }
            insertedRow = qs.insertPayload;
            return { data: [qs.insertPayload], error: null };
          }
          return { data: [], error: null };
        },
        users: () => ({ data: [], error: null }),
        clients: () => ({ data: [], error: null }),
        tasks: () => ({ data: [], error: null }),
      };

      supabaseAdmin.rpc = jest.fn().mockResolvedValue({
        data: [{ id: reqId, status: 'fulfilled' }],
        error: null,
      });

      await operationsRequestsService.updateRequest({
        entityId,
        id: reqId,
        userId: 'admin-id',
        data: { status: 'fulfilled' },
      });

      expect(attempts).toBe(3);
      expect(insertedRow).toBeDefined();
      expect(insertedRow.invoice_number).toMatch(/^INV-\d{4}-\d{4}-\d{4}$/);
    });

    it('retries when error message contains "unique" without explicit code 23505', async () => {
      let attempts = 0;
      let insertedRow = null;

      tableMockHandlers = {
        operations_requests: () => ({
          data: {
            id: reqId,
            entity_id: entityId,
            type: 'billing',
            status: 'pending',
            work_request_id: wrId,
            client_id: clientId,
            requested_by: 'requester-id',
          },
          error: null,
        }),
        work_requests: () => ({ data: [], error: null }),
        invoices: (qs) => {
          if (qs.action === 'insert') {
            attempts++;
            if (attempts === 1) {
              return { data: null, error: { message: 'unique constraint invoices_invoice_number_key violated' } };
            }
            insertedRow = qs.insertPayload;
            return { data: [qs.insertPayload], error: null };
          }
          return { data: [], error: null };
        },
        users: () => ({ data: [], error: null }),
        clients: () => ({ data: [], error: null }),
        tasks: () => ({ data: [], error: null }),
      };

      supabaseAdmin.rpc = jest.fn().mockResolvedValue({
        data: [{ id: reqId, status: 'fulfilled' }],
        error: null,
      });

      await operationsRequestsService.updateRequest({
        entityId,
        id: reqId,
        userId: 'admin-id',
        data: { status: 'fulfilled' },
      });

      expect(attempts).toBe(2);
      expect(insertedRow).toBeDefined();
    });

    it('exhausts 5 attempts on persistent collision without crashing or infinite loop', async () => {
      let attempts = 0;

      tableMockHandlers = {
        operations_requests: () => ({
          data: {
            id: reqId,
            entity_id: entityId,
            type: 'billing',
            status: 'pending',
            work_request_id: wrId,
            client_id: clientId,
            requested_by: 'requester-id',
          },
          error: null,
        }),
        work_requests: () => ({ data: [], error: null }),
        invoices: (qs) => {
          if (qs.action === 'insert') {
            attempts++;
            return { data: null, error: { code: '23505', message: 'collision' } };
          }
          return { data: [], error: null };
        },
        users: () => ({ data: [], error: null }),
        clients: () => ({ data: [], error: null }),
        tasks: () => ({ data: [], error: null }),
      };

      supabaseAdmin.rpc = jest.fn().mockResolvedValue({
        data: [{ id: reqId, status: 'fulfilled' }],
        error: null,
      });

      // Should complete without unhandled crash even if all 5 invoice inserts collide
      await operationsRequestsService.updateRequest({
        entityId,
        id: reqId,
        userId: 'admin-id',
        data: { status: 'fulfilled' },
      });

      expect(attempts).toBe(5);
    });

    it('immediately aborts loop on non-unique DB error without retrying 5 times', async () => {
      let attempts = 0;

      tableMockHandlers = {
        operations_requests: () => ({
          data: {
            id: reqId,
            entity_id: entityId,
            type: 'billing',
            status: 'pending',
            work_request_id: wrId,
            client_id: clientId,
            requested_by: 'requester-id',
          },
          error: null,
        }),
        work_requests: () => ({ data: [], error: null }),
        invoices: (qs) => {
          if (qs.action === 'insert') {
            attempts++;
            return { data: null, error: { code: '42P01', message: 'relation invoices does not exist' } };
          }
          return { data: [], error: null };
        },
        users: () => ({ data: [], error: null }),
        clients: () => ({ data: [], error: null }),
        tasks: () => ({ data: [], error: null }),
      };

      supabaseAdmin.rpc = jest.fn().mockResolvedValue({
        data: [{ id: reqId, status: 'fulfilled' }],
        error: null,
      });

      await operationsRequestsService.updateRequest({
        entityId,
        id: reqId,
        userId: 'admin-id',
        data: { status: 'fulfilled' },
      });

      // Non-unique error throws out of while loop immediately on attempt 1
      expect(attempts).toBe(1);
    });
  });
});

