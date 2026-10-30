/**
 * Test Suite: tests/challenger_m4_empirical_visibility.test.js
 *
 * Adversarial Empirical Verification for SPEC-DASHBOARD-ASSIGNED-TASKS-REALTIME-001 §R1:
 * 1. canViewWorkRequest edge cases:
 *    - Admin unconditional access
 *    - Sole relational assignee (string UUIDs, multi-assignees, object shapes, camelCase, alias keys)
 *    - Non-assignee denial (empty, null, undefined, other users, partial UUID prefixes)
 *    - Legacy assignee paths (submitter, requester, assigned_to, co_assignees, task assignee, checklist)
 *    - Identified security vulnerabilities:
 *        * Missing user.id guard: empty user {} or user lacking id matches wr.submittedBy (undefined === undefined)
 *        * Missing user.name guard: user lacking name matches task.assigneeName (undefined === undefined)
 *        * Null task in tasks array triggers uncaught TypeError
 * 2. loadTasksForWorkRequests:
 *    - Empty array handling
 *    - Multi-WR batching
 *    - Soft-delete filtering (deleted_at != null)
 *    - Relational assignee mapping (zero, single, multiple)
 * 3. Bandwidth Conservation: includeTasks=false vs true:
 *    - Boolean false, string 'false', undefined -> tasks & phases omitted in listWorkRequests & getWorkRequestById
 *    - Boolean true, string 'true' -> tasks & phases embedded
 *    - Sole relational assignee visibility preserved even when includeTasks=false (WR returned, tasks omitted)
 *    - Non-assigned user strictly denied in both includeTasks modes
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const {
  canViewWorkRequest,
  loadTasksForWorkRequests,
  listWorkRequests,
  getWorkRequestById,
} = require('../src/modules/operations/service');

const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('./fixtures/supabaseMock');

describe('Empirical Challenger M4: Backend Visibility & Bandwidth Conservation Stress Harness', () => {
  const ENTITY_ID = 'ent-ata';
  const CLIENT_ID = '00000000-0000-0000-0000-000000000001';
  const WR_ID_1 = '10000000-0000-0000-0000-000000000001';
  const WR_ID_2 = '10000000-0000-0000-0000-000000000002';
  const TASK_ID_1 = '20000000-0000-0000-0000-000000000001';
  const TASK_ID_2 = '20000000-0000-0000-0000-000000000002';
  const TASK_ID_3 = '20000000-0000-0000-0000-000000000003';
  const TASK_DELETED_ID = '20000000-0000-0000-0000-000000000004';

  let adminUser;
  let opsUser1;
  let opsUser2;
  let hrUser;
  let externalUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();

    adminUser = {
      id: 'aaaa0000-0000-0000-0000-000000000001',
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    };
    registerUser(adminUser);

    opsUser1 = {
      id: 'bbbb0000-0000-0000-0000-000000000001',
      email: 'ops1@ata-lta.ph',
      name: 'Operations User 1',
      role: 'Operations',
      entities: ['ATA'],
    };
    registerUser(opsUser1);

    opsUser2 = {
      id: 'cccc0000-0000-0000-0000-000000000001',
      email: 'ops2@ata-lta.ph',
      name: 'Operations User 2',
      role: 'Operations',
      entities: ['ATA'],
    };
    registerUser(opsUser2);

    hrUser = {
      id: 'dddd0000-0000-0000-0000-000000000001',
      email: 'hr@ata-lta.ph',
      name: 'HR User',
      role: 'HR',
      entities: ['ATA'],
    };
    registerUser(hrUser);

    externalUser = {
      id: 'eeee0000-0000-0000-0000-000000000001',
      email: 'ext@ata-lta.ph',
      name: 'External Non-Assigned User',
      role: 'Operations',
      entities: ['ATA'],
    };
    registerUser(externalUser);

    // Seed Client
    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENTITY_ID,
      name: 'Challenger Corp',
      status: 'Active',
      version: 1,
    });

    // Seed WR 1: owned by opsUser1
    mockTables.work_requests.set(WR_ID_1, {
      id: WR_ID_1,
      entity_id: ENTITY_ID,
      client_id: CLIENT_ID,
      title: 'WR 1 Owned by Ops1',
      description: 'Audit engagement',
      status: 'Pre-processing',
      phase: 'pre_processing',
      submitted_by: opsUser1.id,
      requested_by: opsUser1.id,
      assigned_to: opsUser1.id,
      co_assignees: [],
      archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });

    // Seed WR 2: owned by hrUser
    mockTables.work_requests.set(WR_ID_2, {
      id: WR_ID_2,
      entity_id: ENTITY_ID,
      client_id: CLIENT_ID,
      title: 'WR 2 Owned by HR',
      description: 'Payroll compliance',
      status: 'Processing',
      phase: 'processing',
      submitted_by: hrUser.id,
      requested_by: hrUser.id,
      assigned_to: hrUser.id,
      co_assignees: [],
      archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version: 1,
    });

    // Seed Task 1 in WR 1: relational assignee is opsUser2
    mockTables.tasks.set(TASK_ID_1, {
      id: TASK_ID_1,
      work_request_id: WR_ID_1,
      title: 'Task 1 in WR 1',
      status: 'In Progress',
      phase: 'pre_processing',
      display_order: 1,
      assignee_id: null,
      assignee_name: null,
      co_assignees: [],
      deleted_at: null,
      version: 1,
    });

    // Seed Task 2 in WR 1: unassigned
    mockTables.tasks.set(TASK_ID_2, {
      id: TASK_ID_2,
      work_request_id: WR_ID_1,
      title: 'Task 2 in WR 1',
      status: 'Pending',
      phase: 'processing',
      display_order: 2,
      assignee_id: null,
      assignee_name: null,
      co_assignees: [],
      deleted_at: null,
      version: 1,
    });

    // Seed Task 3 in WR 2: multi-assigned to opsUser1 and opsUser2 via task_assignees
    mockTables.tasks.set(TASK_ID_3, {
      id: TASK_ID_3,
      work_request_id: WR_ID_2,
      title: 'Task 3 in WR 2',
      status: 'Pending',
      phase: 'processing',
      display_order: 1,
      assignee_id: null,
      assignee_name: null,
      co_assignees: [],
      deleted_at: null,
      version: 1,
    });

    // Seed Soft-deleted task in WR 1
    mockTables.tasks.set(TASK_DELETED_ID, {
      id: TASK_DELETED_ID,
      work_request_id: WR_ID_1,
      title: 'Deleted Task in WR 1',
      status: 'Cancelled',
      phase: 'pre_processing',
      display_order: 99,
      assignee_id: null,
      deleted_at: new Date().toISOString(),
      version: 1,
    });

    // Link Task 1 to opsUser2
    mockTables.task_assignees.set('ta-1', {
      id: 'ta-1',
      task_id: TASK_ID_1,
      user_id: opsUser2.id,
      assigned_by: opsUser1.id,
      assigned_at: new Date().toISOString(),
    });

    // Link Task 3 to opsUser1 and opsUser2
    mockTables.task_assignees.set('ta-3a', {
      id: 'ta-3a',
      task_id: TASK_ID_3,
      user_id: opsUser1.id,
      assigned_by: hrUser.id,
      assigned_at: new Date().toISOString(),
    });
    mockTables.task_assignees.set('ta-3b', {
      id: 'ta-3b',
      task_id: TASK_ID_3,
      user_id: opsUser2.id,
      assigned_by: hrUser.id,
      assigned_at: new Date().toISOString(),
    });
  });

  describe('Adversarial Stress: canViewWorkRequest Predicate', () => {
    it('Admin user always granted access even on empty, null, or foreign work requests', () => {
      expect(canViewWorkRequest({}, adminUser, null)).toBe(true);
      expect(canViewWorkRequest({ id: 'any', tasks: [] }, adminUser, null)).toBe(true);
      expect(canViewWorkRequest({ submitted_by: 'stranger' }, adminUser, new Map())).toBe(true);
    });

    it('denies access if user is null or undefined', () => {
      const wr = { id: 'wr-1', submitted_by: opsUser1.id, tasks: [] };
      expect(canViewWorkRequest(wr, null, null)).toBe(false);
      expect(canViewWorkRequest(wr, undefined, null)).toBe(false);
    });

    it('grants access when user is sole relational assignee in t.relational_assignees (string UUID)', () => {
      const wr = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relational_assignees: [opsUser2.id] }],
      };
      expect(canViewWorkRequest(wr, opsUser2, null)).toBe(true);
    });

    it('grants access when user is one of multiple relational assignees in t.relational_assignees', () => {
      const wr = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relational_assignees: ['other-user-1', opsUser2.id, 'other-user-2'] }],
      };
      expect(canViewWorkRequest(wr, opsUser2, null)).toBe(true);
    });

    it('grants access when relational_assignees uses object structure { user_id } or { userId }', () => {
      const wrObj1 = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relational_assignees: [{ user_id: opsUser2.id }] }],
      };
      expect(canViewWorkRequest(wrObj1, opsUser2, null)).toBe(true);

      const wrObj2 = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relational_assignees: [{ userId: opsUser2.id }] }],
      };
      expect(canViewWorkRequest(wrObj2, opsUser2, null)).toBe(true);
    });

    it('grants access when relational assignees are passed via relationalAssignees or assignees or taskAssignees', () => {
      const wrCamel = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relationalAssignees: [opsUser2.id] }],
      };
      expect(canViewWorkRequest(wrCamel, opsUser2, null)).toBe(true);

      const wrAssignees = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', assignees: [opsUser2.id] }],
      };
      expect(canViewWorkRequest(wrAssignees, opsUser2, null)).toBe(true);

      const wrTaskAssignees = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', task_assignees: [{ user_id: opsUser2.id }] }],
      };
      expect(canViewWorkRequest(wrTaskAssignees, opsUser2, null)).toBe(true);
    });

    it('denies access when relational_assignees is empty, null, undefined, or other users', () => {
      const wrEmpty = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relational_assignees: [] }],
      };
      expect(canViewWorkRequest(wrEmpty, opsUser2, null)).toBe(false);

      const wrNull = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relational_assignees: null }],
      };
      expect(canViewWorkRequest(wrNull, opsUser2, null)).toBe(false);

      const wrUndefined = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1' }],
      };
      expect(canViewWorkRequest(wrUndefined, opsUser2, null)).toBe(false);

      const wrOthers = {
        id: 'wr-1',
        submitted_by: 'other',
        tasks: [{ id: 't1', relational_assignees: ['user-x', 'user-y'] }],
      };
      expect(canViewWorkRequest(wrOthers, opsUser2, null)).toBe(false);
    });

    it('strictly denies non-assigned external user across all WR assignments', () => {
      const wr = {
        id: 'wr-1',
        submitted_by: opsUser1.id,
        requested_by: opsUser1.id,
        assigned_to: opsUser1.id,
        co_assignees: [hrUser.id],
        tasks: [
          { id: 't1', assignee_id: opsUser1.id, relational_assignees: [opsUser2.id] },
          { id: 't2', assignee_id: hrUser.id, relational_assignees: [hrUser.id] },
        ],
      };
      expect(canViewWorkRequest(wr, externalUser, null)).toBe(false);
    });

    it('uses UUID assignments and rejects submitter, display-name, and checklist-only access', () => {
      // Submitter
      expect(canViewWorkRequest({ submitted_by: opsUser1.id, tasks: [] }, opsUser1, null)).toBe(false);
      expect(canViewWorkRequest({ submittedBy: opsUser1.id, tasks: [] }, opsUser1, null)).toBe(false);

      // Requester
      expect(canViewWorkRequest({ requested_by: opsUser1.id, tasks: [] }, opsUser1, null)).toBe(false);
      expect(canViewWorkRequest({ requestedBy: opsUser1.id, tasks: [] }, opsUser1, null)).toBe(false);

      // Assigned to
      expect(canViewWorkRequest({ assigned_to: opsUser1.id, tasks: [] }, opsUser1, null)).toBe(true);
      expect(canViewWorkRequest({ assignedTo: opsUser1.id, tasks: [] }, opsUser1, null)).toBe(true);

      // Co-assignee on WR (by ID or Name)
      expect(canViewWorkRequest({ co_assignees: [opsUser1.id], tasks: [] }, opsUser1, null)).toBe(true);
      expect(canViewWorkRequest({ coAssignees: [opsUser1.name], tasks: [] }, opsUser1, null)).toBe(false);

      // Direct task assignee (by ID or Name)
      expect(
        canViewWorkRequest(
          { submitted_by: 'other', tasks: [{ assignee_id: opsUser1.id }] },
          opsUser1,
          null
        )
      ).toBe(true);
      expect(
        canViewWorkRequest(
          { submitted_by: 'other', tasks: [{ assigneeName: opsUser1.name }] },
          opsUser1,
          null
        )
      ).toBe(false);

      // Task co-assignee
      expect(
        canViewWorkRequest(
          { submitted_by: 'other', tasks: [{ co_assignees: [opsUser1.id] }] },
          opsUser1,
          null
        )
      ).toBe(false);

      // Checklist item assignee
      expect(
        canViewWorkRequest(
          { submitted_by: 'other', tasks: [{ checklist: [{ assignee_id: opsUser1.id }] }] },
          opsUser1,
          null
        )
      ).toBe(false);
    });

    describe('Regression guards for malformed identity and task payloads', () => {
      it('denies an empty user object even when submitter aliases are absent', () => {
        const wr = { id: 'wr-1', submitted_by: opsUser1.id, tasks: [] };
        // Missing identities must never match missing record fields.
        const leakResult = canViewWorkRequest(wr, {}, null);
        expect(leakResult).toBe(false);
      });

      it('denies unrelated users whose display name is absent', () => {
        const wr = {
          id: 'wr-1',
          submitted_by: opsUser1.id,
          tasks: [{ id: 't1', assignee_id: opsUser1.id }], // no assigneeName
        };
        const userWithoutName = { id: 'unrelated-stranger', role: 'Operations' }; // no name
        // Display names do not confer project membership.
        const leakResult = canViewWorkRequest(wr, userWithoutName, null);
        expect(leakResult).toBe(false);
      });

      it('ignores null task entries and preserves legitimate relational assignee access', () => {
        const wr = {
          id: 'wr-1',
          submitted_by: 'other',
          tasks: [null, { id: 't1', relational_assignees: [opsUser2.id] }],
        };
        expect(() => canViewWorkRequest(wr, opsUser2, null)).not.toThrow();
        expect(canViewWorkRequest(wr, opsUser2, null)).toBe(true);
      });
    });
  });

  describe('Adversarial Stress: loadTasksForWorkRequests', () => {
    it('returns empty Map when passed empty array or null-ish inputs', async () => {
      const res1 = await loadTasksForWorkRequests([]);
      expect(res1).toBeInstanceOf(Map);
      expect(res1.size).toBe(0);
    });

    it('loads tasks across multiple WRs in batch and maps relational_assignees correctly', async () => {
      const taskMap = await loadTasksForWorkRequests([WR_ID_1, WR_ID_2]);
      expect(taskMap.size).toBe(2);

      const wr1Tasks = taskMap.get(WR_ID_1);
      expect(wr1Tasks).toHaveLength(2); // Task 1 and Task 2 (soft-deleted task excluded)

      const t1 = wr1Tasks.find((t) => t.id === TASK_ID_1);
      expect(t1.relational_assignees).toEqual([opsUser2.id]);

      const t2 = wr1Tasks.find((t) => t.id === TASK_ID_2);
      expect(t2.relational_assignees).toEqual([]);

      const wr2Tasks = taskMap.get(WR_ID_2);
      expect(wr2Tasks).toHaveLength(1); // Task 3

      const t3 = wr2Tasks.find((t) => t.id === TASK_ID_3);
      expect(t3.relational_assignees).toEqual(expect.arrayContaining([opsUser1.id, opsUser2.id]));
      expect(t3.relational_assignees).toHaveLength(2);
    });

    it('strictly excludes soft-deleted tasks (deleted_at != null)', async () => {
      const taskMap = await loadTasksForWorkRequests([WR_ID_1]);
      const wr1Tasks = taskMap.get(WR_ID_1);
      const deleted = wr1Tasks.find((t) => t.id === TASK_DELETED_ID);
      expect(deleted).toBeUndefined();
    });
  });

  describe('Adversarial Stress: Bandwidth Conservation (includeTasks=false vs true)', () => {
    it('listWorkRequests omits tasks and phases when includeTasks is false (boolean)', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: false,
      });

      expect(result.data).toHaveLength(2);
      result.data.forEach((wr) => {
        expect(wr.tasks).toBeUndefined();
        expect(wr.phases).toBeUndefined();
      });
    });

    it('listWorkRequests omits tasks and phases when includeTasks is "false" (string)', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: 'false',
      });

      expect(result.data).toHaveLength(2);
      result.data.forEach((wr) => {
        expect(wr.tasks).toBeUndefined();
        expect(wr.phases).toBeUndefined();
      });
    });

    it('listWorkRequests omits tasks and phases when includeTasks is omitted / undefined', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
      });

      expect(result.data).toHaveLength(2);
      result.data.forEach((wr) => {
        expect(wr.tasks).toBeUndefined();
        expect(wr.phases).toBeUndefined();
      });
    });

    it('listWorkRequests embeds tasks and phases when includeTasks is true (boolean)', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: true,
      });

      expect(result.data).toHaveLength(2);
      const wr1 = result.data.find((w) => w.id === WR_ID_1);
      expect(Array.isArray(wr1.tasks)).toBe(true);
      expect(wr1.tasks).toHaveLength(2);
      expect(wr1.phases).toBeDefined();
      expect(wr1.phases.pre_processing).toBeDefined();
      expect(wr1.phases.processing).toBeDefined();
    });

    it('listWorkRequests embeds tasks and phases when includeTasks is "true" (string)', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: 'true',
      });

      expect(result.data).toHaveLength(2);
      const wr1 = result.data.find((w) => w.id === WR_ID_1);
      expect(Array.isArray(wr1.tasks)).toBe(true);
      expect(wr1.tasks).toHaveLength(2);
    });

    it('getWorkRequestById omits tasks and phases when includeTasks is false or "false"', async () => {
      const wrBool = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: false,
      });
      expect(wrBool.id).toBe(WR_ID_1);
      expect(wrBool.tasks).toBeUndefined();
      expect(wrBool.phases).toBeUndefined();

      const wrStr = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: 'false',
      });
      expect(wrStr.id).toBe(WR_ID_1);
      expect(wrStr.tasks).toBeUndefined();
      expect(wrStr.phases).toBeUndefined();
    });

    it('getWorkRequestById embeds tasks and phases when includeTasks is true or "true"', async () => {
      const wrBool = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: true,
      });
      expect(wrBool.id).toBe(WR_ID_1);
      expect(Array.isArray(wrBool.tasks)).toBe(true);
      expect(wrBool.tasks).toHaveLength(2);
      expect(wrBool.phases).toBeDefined();

      const wrStr = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: adminUser,
        includeTasks: 'true',
      });
      expect(wrStr.id).toBe(WR_ID_1);
      expect(Array.isArray(wrStr.tasks)).toBe(true);
      expect(wrStr.tasks).toHaveLength(2);
    });
  });

  describe('Adversarial Stress: Relational Assignee Visibility + Bandwidth Conservation Interaction', () => {
    it('sole relational assignee (opsUser2) can list WR 1 even when includeTasks=false (bandwidth conserved)', async () => {
      const result = await listWorkRequests({
        entityId: ENTITY_ID,
        user: opsUser2,
        includeTasks: false,
      });

      // opsUser2 is relational assignee on WR 1 (task 1) and WR 2 (task 3)
      expect(result.data).toHaveLength(2);
      const wr1 = result.data.find((w) => w.id === WR_ID_1);
      expect(wr1).toBeDefined();
      expect(wr1.tasks).toBeUndefined(); // Bandwidth conserved
      expect(wr1.phases).toBeUndefined();
    });

    it('sole relational assignee (opsUser2) can get WR 1 by ID even when includeTasks=false', async () => {
      const wr = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: opsUser2,
        includeTasks: false,
      });

      expect(wr).not.toBeNull();
      expect(wr.id).toBe(WR_ID_1);
      expect(wr.tasks).toBeUndefined(); // Bandwidth conserved
      expect(wr.phases).toBeUndefined();
    });

    it('sole relational assignee (opsUser2) receives tasks and phases when includeTasks=true', async () => {
      const wr = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: opsUser2,
        includeTasks: true,
      });

      expect(wr).not.toBeNull();
      expect(wr.id).toBe(WR_ID_1);
      expect(Array.isArray(wr.tasks)).toBe(true);
      expect(wr.tasks).toHaveLength(2);
      const t1 = wr.tasks.find((t) => t.id === TASK_ID_1);
      expect(t1.relational_assignees).toContain(opsUser2.id);
      expect(t1.assignees).toContain(opsUser2.id);
    });

    it('external non-assigned user is strictly denied both in list and getWorkRequestById regardless of includeTasks', async () => {
      // List
      const listFalse = await listWorkRequests({
        entityId: ENTITY_ID,
        user: externalUser,
        includeTasks: false,
      });
      expect(listFalse.data).toHaveLength(0);

      const listTrue = await listWorkRequests({
        entityId: ENTITY_ID,
        user: externalUser,
        includeTasks: true,
      });
      expect(listTrue.data).toHaveLength(0);

      // Get by ID
      const getFalse = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: externalUser,
        includeTasks: false,
      });
      expect(getFalse).toBeNull();

      const getTrue = await getWorkRequestById({
        id: WR_ID_1,
        entityId: ENTITY_ID,
        user: externalUser,
        includeTasks: true,
      });
      expect(getTrue).toBeNull();
    });
  });
});
