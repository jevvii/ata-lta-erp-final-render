/**
 * Test Suite: workRequestAssigneeVisibility.test.js
 *
 * Verifies SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R1:
 * 1. canViewWorkRequest grants visibility when user.id is in t.relational_assignees.
 * 2. canViewWorkRequest denies visibility when non-admin user is not assigned to WR or tasks.
 * 3. loadTasksForWorkRequests queries task_assignees join table and attaches relational_assignees.
 * 4. listWorkRequests and getWorkRequestById correctly enforce multi-assignee visibility.
 * 5. includeTasks=false (and 'false') strictly conserves bandwidth by omitting tasks and phases.
 * 6. includeTasks=true embeds loaded tasks and phases.
 */

jest.mock('../../../services/supabaseClient', () => {
  const { supabaseAdmin } = require('../../../../tests/fixtures/supabaseMock');
  return { supabaseAdmin };
});

const {
  loadTasksForWorkRequests,
  canViewWorkRequest,
  listWorkRequests,
  getWorkRequestById,
} = require('../service');

const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('../../../../tests/fixtures/supabaseMock');

describe('SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R1: Backend Multi-Assignee Resolution & Visibility', () => {
  const ENTITY_ID = 'ent-ata';
  const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
  const WR_ID = '22222222-2222-2222-2222-222222222222';
  const TASK_ID_1 = '33333333-3333-3333-3333-333333333331';
  const TASK_ID_2 = '33333333-3333-3333-3333-333333333332';

  let adminUser;
  let ownerUser;
  let relationalAssigneeUser;
  let unassignedUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminUser = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    };
    registerUser(adminUser);

    ownerUser = {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      email: 'owner@ata-lta.ph',
      name: 'Owner User',
      role: 'Operations',
      entities: ['ATA'],
    };
    registerUser(ownerUser);

    relationalAssigneeUser = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      email: 'assignee@ata-lta.ph',
      name: 'Relational Assignee User',
      role: 'Operations',
      entities: ['ATA'],
    };
    registerUser(relationalAssigneeUser);

    unassignedUser = {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      email: 'unassigned@ata-lta.ph',
      name: 'Unassigned User',
      role: 'Operations',
      entities: ['ATA'],
    };
    registerUser(unassignedUser);

    // Seed client
    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENTITY_ID,
      name: 'Test Client Corporation',
      status: 'Active',
      version: 1,
    });

    // Seed work request owned by ownerUser
    mockTables.work_requests.set(WR_ID, {
      id: WR_ID,
      entity_id: ENTITY_ID,
      client_id: CLIENT_ID,
      title: 'Tax Compliance Q3',
      description: 'Quarterly compliance filing',
      status: 'Pre-processing',
      phase: 'pre_processing',
      submitted_by: ownerUser.id,
      requested_by: ownerUser.id,
      assigned_to: ownerUser.id,
      co_assignees: [],
      archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });

    // Seed task 1 with no direct assignee_id, assigned to relationalAssigneeUser via task_assignees
    mockTables.tasks.set(TASK_ID_1, {
      id: TASK_ID_1,
      work_request_id: WR_ID,
      title: 'Prepare Trial Balance',
      status: 'In Progress',
      phase: 'pre_processing',
      display_order: 1,
      assignee_id: null,
      assignee_name: null,
      co_assignees: [],
      predecessors: [],
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });

    // Seed task 2 with no assignees
    mockTables.tasks.set(TASK_ID_2, {
      id: TASK_ID_2,
      work_request_id: WR_ID,
      title: 'Manager Review',
      status: 'Pending',
      phase: 'processing',
      display_order: 2,
      assignee_id: null,
      assignee_name: null,
      co_assignees: [],
      predecessors: [],
      deleted_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });

    // Seed task_assignees row linking TASK_ID_1 to relationalAssigneeUser
    mockTables.task_assignees.set('ta-1', {
      id: 'ta-1',
      task_id: TASK_ID_1,
      user_id: relationalAssigneeUser.id,
      assigned_by: ownerUser.id,
      assigned_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  });

  describe('Unit: canViewWorkRequest predicate', () => {
    it('grants visibility unconditionally to Admin users', () => {
      const wr = { id: 'wr-1', submitted_by: 'other-user', tasks: [] };
      expect(canViewWorkRequest(wr, adminUser, null)).toBe(true);
    });

    it('denies visibility to submitter/requester alone (F10) and grants to assigned_to/co_assignees', () => {
      const wrSubmitted = { id: 'wr-1', submitted_by: ownerUser.id, tasks: [] };
      expect(canViewWorkRequest(wrSubmitted, ownerUser, null)).toBe(false);

      const wrRequested = { id: 'wr-1', requested_by: ownerUser.id, tasks: [] };
      expect(canViewWorkRequest(wrRequested, ownerUser, null)).toBe(false);

      const wrAssigned = { id: 'wr-1', assigned_to: ownerUser.id, tasks: [] };
      expect(canViewWorkRequest(wrAssigned, ownerUser, null)).toBe(true);

      const wrCo = { id: 'wr-1', co_assignees: [ownerUser.id], tasks: [] };
      expect(canViewWorkRequest(wrCo, ownerUser, null)).toBe(true);
    });

    it('grants visibility when user.id is in task relational_assignees (string UUID)', () => {
      const wr = {
        id: 'wr-1',
        submitted_by: 'other-user',
        tasks: [
          {
            id: 'task-1',
            assignee_id: null,
            relational_assignees: [relationalAssigneeUser.id],
          },
        ],
      };
      expect(canViewWorkRequest(wr, relationalAssigneeUser, null)).toBe(true);
    });

    it('grants visibility when taskMap contains relational_assignees matching user.id', () => {
      const wr = { id: 'wr-1', submitted_by: 'other-user' };
      const taskMap = new Map();
      taskMap.set('wr-1', [
        {
          id: 'task-1',
          assignee_id: null,
          relational_assignees: [relationalAssigneeUser.id],
        },
      ]);
      expect(canViewWorkRequest(wr, relationalAssigneeUser, taskMap)).toBe(true);
    });

    it('grants visibility when relational_assignees contains object shapes { user_id } or { userId }', () => {
      const wrObj1 = {
        id: 'wr-1',
        submitted_by: 'other-user',
        tasks: [{ id: 'task-1', relational_assignees: [{ user_id: relationalAssigneeUser.id }] }],
      };
      expect(canViewWorkRequest(wrObj1, relationalAssigneeUser, null)).toBe(true);

      const wrObj2 = {
        id: 'wr-1',
        submitted_by: 'other-user',
        tasks: [{ id: 'task-1', relational_assignees: [{ userId: relationalAssigneeUser.id }] }],
      };
      expect(canViewWorkRequest(wrObj2, relationalAssigneeUser, null)).toBe(true);
    });

    it('denies visibility to non-admin user when not assigned to WR or any tasks', () => {
      const wr = {
        id: 'wr-1',
        submitted_by: 'other-user',
        tasks: [
          {
            id: 'task-1',
            assignee_id: 'someone-else',
            relational_assignees: ['someone-else'],
          },
        ],
      };
      expect(canViewWorkRequest(wr, unassignedUser, null)).toBe(false);
    });

    it('returns false when user is null or undefined', () => {
      const wr = { id: 'wr-1', tasks: [] };
      expect(canViewWorkRequest(wr, null, null)).toBe(false);
      expect(canViewWorkRequest(wr, undefined, null)).toBe(false);
    });
  });

  describe('Unit: loadTasksForWorkRequests', () => {
    it('returns empty Map when given empty wrIds array', async () => {
      const result = await loadTasksForWorkRequests([]);
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });

    it('queries task_assignees join table and attaches relational_assignees to each task', async () => {
      const taskMap = await loadTasksForWorkRequests([WR_ID]);
      expect(taskMap.has(WR_ID)).toBe(true);

      const tasks = taskMap.get(WR_ID);
      expect(tasks).toHaveLength(2);

      const task1 = tasks.find((t) => t.id === TASK_ID_1);
      expect(task1).toBeDefined();
      expect(task1.relational_assignees).toEqual([relationalAssigneeUser.id]);

      const task2 = tasks.find((t) => t.id === TASK_ID_2);
      expect(task2).toBeDefined();
      expect(task2.relational_assignees).toEqual([]);
    });
  });

  describe('Integration: listWorkRequests visibility and includeTasks behavior', () => {
    it('allows relational assignee user to view work request via task_assignees', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: relationalAssigneeUser,
        includeTasks: true,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(WR_ID);
      expect(result.data[0].tasks).toBeDefined();
      expect(result.data[0].tasks).toHaveLength(2);

      const task1 = result.data[0].tasks.find((t) => t.id === TASK_ID_1);
      expect(task1).toBeDefined();
      expect(task1.assignees).toContain(relationalAssigneeUser.id);
      expect(task1.relational_assignees).toContain(relationalAssigneeUser.id);
    });

    it('excludes work request for non-assigned user', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: unassignedUser,
        includeTasks: true,
      });

      expect(result.data).toHaveLength(0);
    });

    it('restricts managers to work requests they are added to (excludes unassigned manager)', async () => {
      const managerUser = {
        id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
        email: 'manager@ata-lta.ph',
        name: 'Manager User',
        role: 'Manager',
        entities: ['ATA'],
      };
      registerUser(managerUser);

      // Unassigned manager cannot see WR_ID
      const excludedResult = await listWorkRequests({
        entityId: ENTITY_ID,
        user: managerUser,
        includeTasks: true,
      });
      expect(excludedResult.data).toHaveLength(0);

      // Added manager as co_assignee can see WR_ID
      const currentWr = mockTables.work_requests.get(WR_ID);
      mockTables.work_requests.set(WR_ID, {
        ...currentWr,
        co_assignees: [managerUser.id],
      });

      const includedResult = await listWorkRequests({
        entityId: ENTITY_ID,
        user: managerUser,
        includeTasks: true,
      });
      expect(includedResult.data).toHaveLength(1);
      expect(includedResult.data[0].id).toBe(WR_ID);
    });

    it('does NOT embed tasks or phases when includeTasks is false', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: false,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe(WR_ID);
      expect(result.data[0].tasks).toBeUndefined();
      expect(result.data[0].phases).toBeUndefined();
    });

    it('does NOT embed tasks or phases when includeTasks is string "false"', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: 'false',
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].tasks).toBeUndefined();
      expect(result.data[0].phases).toBeUndefined();
    });

    it('embeds tasks and phases when includeTasks is true', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: true,
      });

      expect(result.data).toHaveLength(1);
      expect(Array.isArray(result.data[0].tasks)).toBe(true);
      expect(result.data[0].tasks).toHaveLength(2);
      expect(result.data[0].phases).toBeDefined();
      expect(result.data[0].phases.pre_processing).toBeDefined();
      expect(result.data[0].phases.processing).toBeDefined();
    });
  });

  describe('Integration: getWorkRequestById visibility and includeTasks behavior', () => {
    it('allows relational assignee user to retrieve work request by ID', async () => {
      const wr = await getWorkRequestById({
        id: WR_ID,
        entityId: ENTITY_ID,
        user: relationalAssigneeUser,
        includeTasks: true,
      });

      expect(wr).not.toBeNull();
      expect(wr.id).toBe(WR_ID);
      expect(wr.tasks).toHaveLength(2);
    });

    it('returns null when non-assigned user attempts to retrieve work request', async () => {
      const wr = await getWorkRequestById({
        id: WR_ID,
        entityId: ENTITY_ID,
        user: unassignedUser,
        includeTasks: true,
      });

      expect(wr).toBeNull();
    });

    it('omits tasks and phases when includeTasks is false', async () => {
      const wr = await getWorkRequestById({
        id: WR_ID,
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: false,
      });

      expect(wr).not.toBeNull();
      expect(wr.id).toBe(WR_ID);
      expect(wr.tasks).toBeUndefined();
      expect(wr.phases).toBeUndefined();
    });

    it('omits tasks and phases when includeTasks is string "false"', async () => {
      const wr = await getWorkRequestById({
        id: WR_ID,
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: 'false',
      });

      expect(wr).not.toBeNull();
      expect(wr.tasks).toBeUndefined();
      expect(wr.phases).toBeUndefined();
    });

    it('embeds tasks and phases when includeTasks is true', async () => {
      const wr = await getWorkRequestById({
        id: WR_ID,
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: true,
      });

      expect(wr).not.toBeNull();
      expect(wr.id).toBe(WR_ID);
      expect(Array.isArray(wr.tasks)).toBe(true);
      expect(wr.tasks).toHaveLength(2);
      expect(wr.phases).toBeDefined();
      expect(wr.phases.pre_processing.tasks).toHaveLength(1);
      expect(wr.phases.processing.tasks).toHaveLength(1);
    });
  });
});
