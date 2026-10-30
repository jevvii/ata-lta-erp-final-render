/**
 * Empirical Challenger Test Suite for Backend OCC & Monotonic Version Bumping
 * SPEC-REALTIME-UAT-REMEDIATION-002
 *
 * Verifies:
 * 1. updateWorkRequest increments version monotonically with and without expectedVersion.
 * 2. updateTask increments version monotonically with and without expectedVersion.
 * 3. qaReviewWorkRequest bumps task versions monotonically.
 * 4. rerouteWorkRequest bumps failed tasks and work request versions monotonically.
 * 5. updateRequest (operationsRequests) bumps version monotonically.
 */

jest.mock('../../../../src/services/supabaseClient', () => {
  const mockClient = {
    from: jest.fn(),
    rpc: jest.fn(),
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: {} }, error: null }),
    },
  };
  return { supabaseAdmin: mockClient, verifyToken: jest.fn() };
});

jest.mock('../../../../src/services/auditService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../../../src/services/notify', () => ({
  notify: jest.fn().mockResolvedValue(undefined),
  FROZEN_NOTIFICATION_TYPES: [],
}));

const { supabaseAdmin } = require('../../../../src/services/supabaseClient');
const operationsService = require('../../../../src/modules/operations/service');
const operationsRequestsService = require('../../../../src/modules/operationsRequests/service');

describe('SPEC-REALTIME-UAT-REMEDIATION-002: Backend Version Increment Empirical Challenges', () => {
  let tableMockHandlers = {};
  let executedQueries = [];
  const adminUser = { id: '018f45a2-9999-7000-8000-000000000099', role: 'Admin', email: 'admin@test.com' };

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
        executedQueries.push({ ...queryState, filters: { ...queryState.filters } });
        const handler = tableMockHandlers[table];
        if (typeof handler === 'function') {
          return handler(queryState, 'maybeSingle');
        }
        return { data: null, error: null };
      }),
      single: jest.fn(async () => {
        executedQueries.push({ ...queryState, filters: { ...queryState.filters } });
        const handler = tableMockHandlers[table];
        if (typeof handler === 'function') {
          return handler(queryState, 'single');
        }
        return { data: null, error: null };
      }),
      then: (resolve, reject) => {
        executedQueries.push({ ...queryState, filters: { ...queryState.filters } });
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
    executedQueries = [];
    supabaseAdmin.from.mockImplementation((table) => createMockQueryBuilder(table));
  });

  describe('updateWorkRequest: Monotonic Version Increments', () => {
    const validWrId = '018f45a2-0000-7000-8000-000000000001';

    it('increments version monotonically when expectedVersion IS omitted', async () => {
      tableMockHandlers.work_requests = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validWrId,
              entity_id: 'ATA',
              status: 'In Progress',
              phase: 'Phase 1',
              version: 7,
              co_assignees: [],
            },
            error: null,
          };
        }
        if (qState.action === 'update') {
          return {
            data: [{
              id: validWrId,
              entity_id: 'ATA',
              status: 'In Progress',
              version: qState.updatePayload.version,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      };

      await operationsService.updateWorkRequest({
        id: validWrId,
        entityId: 'ATA',
        data: { notes: 'Updated notes without expectedVersion' },
        user: adminUser,
      });

      const wrUpdate = executedQueries.find((u) => u.table === 'work_requests' && u.action === 'update');
      expect(wrUpdate).toBeDefined();
      expect(wrUpdate.updatePayload.version).toBe(8); // 7 + 1
      expect(wrUpdate.filters.version).toBe(7); // Server-side CAS protects the version read before mutation
    });

    it('increments version and enforces OCC filter when expectedVersion IS provided', async () => {
      tableMockHandlers.work_requests = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validWrId,
              entity_id: 'ATA',
              status: 'In Progress',
              phase: 'Phase 1',
              version: 7,
              co_assignees: [],
            },
            error: null,
          };
        }
        if (qState.action === 'update') {
          return {
            data: [{
              id: validWrId,
              entity_id: 'ATA',
              status: 'In Progress',
              version: qState.updatePayload.version,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      };

      await operationsService.updateWorkRequest({
        id: validWrId,
        entityId: 'ATA',
        data: { notes: 'Updated notes with expectedVersion', expectedVersion: 7 },
        user: adminUser,
      });

      const wrUpdate = executedQueries.find((u) => u.table === 'work_requests' && u.action === 'update');
      expect(wrUpdate).toBeDefined();
      expect(wrUpdate.updatePayload.version).toBe(8); // 7 + 1
      expect(wrUpdate.filters.version).toBe(7); // OCC filter present
    });

    it('defaults to version 2 when existing row has null/undefined version', async () => {
      tableMockHandlers.work_requests = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validWrId,
              entity_id: 'ATA',
              status: 'In Progress',
              phase: 'Phase 1',
              version: null,
              co_assignees: [],
            },
            error: null,
          };
        }
        if (qState.action === 'update') {
          return {
            data: [{
              id: validWrId,
              entity_id: 'ATA',
              status: 'In Progress',
              version: qState.updatePayload.version,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      };

      await operationsService.updateWorkRequest({
        id: validWrId,
        entityId: 'ATA',
        data: { notes: 'First version bump' },
        user: adminUser,
      });

      const wrUpdate = executedQueries.find((u) => u.table === 'work_requests' && u.action === 'update');
      expect(wrUpdate).toBeDefined();
      expect(wrUpdate.updatePayload.version).toBe(2); // (null || 1) + 1
    });
  });

  describe('updateTask: Monotonic Version Increments', () => {
    const validTaskId = '018f45a2-0000-7000-8000-000000000002';
    const validWrId = '018f45a2-0000-7000-8000-000000000001';

    beforeEach(() => {
      tableMockHandlers.work_requests = () => ({
        data: { id: validWrId, entity_id: 'ATA', status: 'In Progress' },
        error: null,
      });
      tableMockHandlers.task_assignees = () => ({
        data: [],
        error: null,
      });
    });

    it('increments task version monotonically when expectedVersion IS omitted', async () => {
      tableMockHandlers.tasks = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validTaskId,
              work_request_id: validWrId,
              status: 'In Progress',
              version: 4,
              phase: 'Phase 1',
              prerequisite_task_ids: [],
            },
            error: null,
          };
        }
        if (qState.action === 'update') {
          return {
            data: [{
              id: validTaskId,
              work_request_id: validWrId,
              status: 'In Progress',
              version: qState.updatePayload.version,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      };

      await operationsService.updateTask({
        workRequestId: validWrId,
        taskId: validTaskId,
        entityId: 'ATA',
        data: { title: 'Updated task without OCC' },
        user: adminUser,
      });

      const taskUpdate = executedQueries.find((u) => u.table === 'tasks' && u.action === 'update');
      expect(taskUpdate).toBeDefined();
      expect(taskUpdate.updatePayload.version).toBe(5); // 4 + 1
      expect(taskUpdate.filters.version).toBe(4); // Server-side CAS still protects callers omitting a client version
    });

    it('increments task version and enforces OCC filter when expectedVersion IS provided', async () => {
      tableMockHandlers.tasks = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validTaskId,
              work_request_id: validWrId,
              status: 'In Progress',
              version: 4,
              phase: 'Phase 1',
              prerequisite_task_ids: [],
            },
            error: null,
          };
        }
        if (qState.action === 'update') {
          return {
            data: [{
              id: validTaskId,
              work_request_id: validWrId,
              status: 'In Progress',
              version: qState.updatePayload.version,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      };

      await operationsService.updateTask({
        workRequestId: validWrId,
        taskId: validTaskId,
        entityId: 'ATA',
        data: { title: 'Updated task with OCC', expectedVersion: 4 },
        user: adminUser,
      });

      const taskUpdate = executedQueries.find((u) => u.table === 'tasks' && u.action === 'update');
      expect(taskUpdate).toBeDefined();
      expect(taskUpdate.updatePayload.version).toBe(5); // 4 + 1
      expect(taskUpdate.filters.version).toBe(4);
    });
  });

  describe('qaReviewWorkRequest: Task Version Increments', () => {
    const validWrId = '018f45a2-0000-7000-8000-000000000001';
    const taskId1 = '018f45a2-0000-7000-8000-000000000011';
    const taskId2 = '018f45a2-0000-7000-8000-000000000012';

    it('bumps task versions monotonically during QA review', async () => {
      tableMockHandlers.work_requests = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validWrId,
              entity_id: 'ATA',
              status: 'Under Review',
              phase: 'quality_assurance',
              co_assignees: [],
            },
            error: null,
          };
        }
        return { data: [{ id: validWrId }], error: null };
      };

      tableMockHandlers.tasks = (qState) => {
        if (qState.action === 'select') {
          return {
            data: [
              { id: taskId1, title: 'Task 1', qa_status: 'none', version: 3 },
              { id: taskId2, title: 'Task 2', qa_status: 'none', version: null },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };

      await operationsService.qaReviewWorkRequest({
        id: validWrId,
        entityId: 'ATA',
        results: [
          { taskId: taskId1, qaStatus: 'passed' },
          { taskId: taskId2, qaStatus: 'failed' },
        ],
        user: adminUser,
      });

      const taskUpdates = executedQueries.filter((u) => u.table === 'tasks' && u.action === 'update');
      expect(taskUpdates.length).toBe(2);

      const update1 = taskUpdates.find((u) => u.filters.id === taskId1);
      expect(update1).toBeDefined();
      expect(update1.updatePayload.version).toBe(4); // 3 + 1
      expect(update1.updatePayload.qa_status).toBe('passed');

      const update2 = taskUpdates.find((u) => u.filters.id === taskId2);
      expect(update2).toBeDefined();
      expect(update2.updatePayload.version).toBe(2); // (null || 1) + 1
      expect(update2.updatePayload.qa_status).toBe('failed');
    });
  });

  describe('rerouteWorkRequest: Failed Tasks & Work Request Version Increments', () => {
    const validWrId = '018f45a2-0000-7000-8000-000000000001';
    const failedTaskId = '018f45a2-0000-7000-8000-000000000021';

    it('bumps versions for reopened failed tasks and the work request row', async () => {
      tableMockHandlers.work_requests = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validWrId,
              entity_id: 'ATA',
              status: 'Under Review',
              phase: 'quality_assurance',
              version: 10,
              co_assignees: [],
            },
            error: null,
          };
        }
        return { data: [], error: null };
      };

      tableMockHandlers.tasks = (qState) => {
        if (qState.action === 'select') {
          return {
            data: [
              { id: failedTaskId, title: 'Failed Task', status: 'Completed', qa_status: 'failed', version: 5 },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      };

      await operationsService.rerouteWorkRequest({
        id: validWrId,
        entityId: 'ATA',
        toPhase: 'pre_processing',
        reason: 'Rerouting due to QA failure',
        user: adminUser,
      });

      const taskUpdates = executedQueries.filter((u) => u.table === 'tasks' && u.action === 'update');
      expect(taskUpdates.length).toBe(1);
      expect(taskUpdates[0].updatePayload.version).toBe(6); // 5 + 1
      expect(taskUpdates[0].updatePayload.status).toBe('In Progress');
      expect(taskUpdates[0].updatePayload.qa_status).toBe('none');

      const wrUpdates = executedQueries.filter((u) => u.table === 'work_requests' && u.action === 'update');
      expect(wrUpdates.length).toBe(1);
      expect(wrUpdates[0].updatePayload.version).toBe(11); // 10 + 1
      expect(wrUpdates[0].updatePayload.phase).toBe('pre_processing');
    });
  });

  describe('operationsRequests: updateRequest Version Increments', () => {
    const validReqId = '018f45a2-0000-7000-8000-000000000031';

    it('bumps operations_requests version on updateRequest', async () => {
      tableMockHandlers.operations_requests = (qState) => {
        if (qState.action === 'select') {
          return {
            data: {
              id: validReqId,
              entity_id: 'ATA',
              status: 'pending',
              version: 2,
            },
            error: null,
          };
        }
        if (qState.action === 'update') {
          return {
            data: [{
              id: validReqId,
              entity_id: 'ATA',
              status: 'approved',
              version: qState.updatePayload.version,
            }],
            error: null,
          };
        }
        return { data: null, error: null };
      };

      await operationsRequestsService.updateRequest({
        entityId: 'ATA',
        id: validReqId,
        userId: adminUser.id,
        data: { status: 'approved' },
      });

      const reqUpdate = executedQueries.find((u) => u.table === 'operations_requests' && u.action === 'update');
      expect(reqUpdate).toBeDefined();
      expect(reqUpdate.updatePayload.version).toBe(3); // 2 + 1
      expect(reqUpdate.updatePayload.status).toBe('approved');
    });
  });
});
