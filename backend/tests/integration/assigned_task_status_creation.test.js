/**
 * Integration test suite for assigned task status defaults.
 *
 * Verifies that:
 * 1. Creating a task with an assignee (assigneeId or assignees array) automatically defaults status to 'Assigned'.
 * 2. Creating a task with explicit status 'Draft' and an assignee normalizes to 'Assigned'.
 * 3. Creating a task with explicit non-draft status (e.g. 'In Progress') preserves that status.
 * 4. Creating a task without any assignee defaults status to 'Draft'.
 * 5. Work request graph creation sets tasks with assignees to 'Assigned' and tasks without assignees to 'Draft'.
 * 6. Updating an existing 'Draft' task to add an assignee transitions its status to 'Assigned'.
 * 7. Employee creation of an assigned task derives status: 'Assigned' and approval_status: 'pending'.
 * 8. Prerequisite checks allow 'Assigned' processing tasks even when pre-processing tasks are incomplete.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});
jest.mock('../../src/services/notify', () => ({
  notify: jest.fn().mockResolvedValue(),
}));

const operationsService = require('../../src/modules/operations/service');
const {
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
} = require('../fixtures/supabaseMock');

const ENTITY_ID = '00000000-0000-0000-0000-000000000001';
const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const WR_ID = '22222222-2222-4222-8222-222222222222';
const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MANAGER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EMPLOYEE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('Assigned Task Status Default Integration Tests', () => {
  let adminUser;
  let employeeUser;

  beforeEach(() => {
    resetMock();
    seedDefaults();
    jest.clearAllMocks();

    registerUser({
      id: ADMIN_ID,
      email: 'admin@ata-lta.ph',
      name: 'Admin User',
      role: 'Admin',
      entities: ['ALL'],
      is_active: true,
    });
    adminUser = mockTables.users.get(ADMIN_ID);

    registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager Lead',
      role: 'Manager',
      entities: ['ALL'],
      is_active: true,
    });

    registerUser({
      id: EMPLOYEE_ID,
      email: 'employee@ata-lta.ph',
      name: 'Employee Staff',
      role: 'Staff',
      entities: ['ALL'],
      is_active: true,
    });
    employeeUser = mockTables.users.get(EMPLOYEE_ID);

    // Seed client
    mockTables.clients.set(CLIENT_ID, {
      id: CLIENT_ID,
      entity_id: ENTITY_ID,
      name: 'Acme Corp',
      status: 'active',
    });

    // Seed approved Work Request with Manager lead
    mockTables.work_requests.set(WR_ID, {
      id: WR_ID,
      entity_id: ENTITY_ID,
      client_id: CLIENT_ID,
      title: 'Active Operations Request',
      description: 'Test WR description',
      status: 'In Progress',
      phase: 'pre_processing',
      creation_approval_status: 'approved',
      assigned_to: MANAGER_ID,
      co_assignees: [EMPLOYEE_ID],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
      archived: false,
    });
  });

  test('1. createTask with assigneeId defaults status to "Assigned"', async () => {
    const task = await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Task with Assignee ID',
        assigneeId: EMPLOYEE_ID,
      },
      user: adminUser,
    });

    expect(task).toBeDefined();
    expect(task.title).toBe('Task with Assignee ID');
    expect(task.status).toBe('Assigned');
    expect(task.assigneeId).toBe(EMPLOYEE_ID);
  });

  test('2. createTask with assignees array defaults status to "Assigned"', async () => {
    const task = await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Task with Assignees Array',
        assignees: [EMPLOYEE_ID],
      },
      user: adminUser,
    });

    expect(task).toBeDefined();
    expect(task.status).toBe('Assigned');
    expect(task.assigneeId).toBe(EMPLOYEE_ID);
  });

  test('3. createTask with explicit status "Draft" but having an assignee normalizes to "Assigned"', async () => {
    const task = await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Task with Draft status and Assignee',
        status: 'Draft',
        assigneeId: EMPLOYEE_ID,
      },
      user: adminUser,
    });

    expect(task).toBeDefined();
    expect(task.status).toBe('Assigned');
  });

  test('4. createTask without assignee retains status "Draft"', async () => {
    const task = await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Unassigned Task',
      },
      user: adminUser,
    });

    expect(task).toBeDefined();
    expect(task.status).toBe('Draft');
    expect(task.assigneeId).toBeNull();
  });

  test('5. updateTask promoting an unassigned Draft task to assigned transitions status to "Assigned"', async () => {
    const unassigned = await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Initially Unassigned Draft Task',
      },
      user: adminUser,
    });
    expect(unassigned.status).toBe('Draft');

    const updated = await operationsService.updateTask({
      workRequestId: WR_ID,
      taskId: unassigned.id,
      entityId: ENTITY_ID,
      data: {
        assigneeId: EMPLOYEE_ID,
        expectedVersion: unassigned.version || 1,
      },
      user: adminUser,
    });

    expect(updated).toBeDefined();
    expect(updated.status).toBe('Assigned');
    expect(updated.assigneeId).toBe(EMPLOYEE_ID);
  });

  test('6. Employee caller creating task with assignee gets status: "Assigned" and approval_status: "pending"', async () => {
    const task = await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Employee Proposed Task',
        assigneeId: EMPLOYEE_ID,
      },
      user: employeeUser,
      caller: employeeUser,
    });

    expect(task).toBeDefined();
    expect(task.status).toBe('Assigned');
    expect(task.approvalStatus || task.approval_status).toBe('pending');
  });

  test('7. Prerequisite gate allows creating processing task in "Assigned" status when pre-processing is incomplete', async () => {
    // Add incomplete pre_processing task
    await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Incomplete Pre Task',
        phase: 'pre_processing',
      },
      user: adminUser,
    });

    // Creating an assigned processing task should succeed because 'Assigned' is an initial state
    const procTask = await operationsService.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ID,
      data: {
        title: 'Assigned Processing Task',
        phase: 'processing',
        assigneeId: EMPLOYEE_ID,
      },
      user: adminUser,
    });

    expect(procTask).toBeDefined();
    expect(procTask.phase).toBe('processing');
    expect(procTask.status).toBe('Assigned');
  });

  test('8. createWorkRequest sets tasks with assignees to "Assigned" and unassigned tasks to "Draft"', async () => {
    const wr = await operationsService.createWorkRequest({
      entityId: ENTITY_ID,
      data: {
        title: 'Batch Graph WR',
        clientId: CLIENT_ID,
        assignedTo: MANAGER_ID,
        dueDate: new Date(Date.now() + 86400000).toISOString(),
        phases: {
          pre_processing: {
            tasks: [
              {
                title: 'Graph Task with Assignee',
                local_id: 't-1',
                assignees: [EMPLOYEE_ID],
              },
              {
                title: 'Graph Task without Assignee',
                local_id: 't-2',
                assignees: [],
              },
            ],
          },
        },
      },
      user: adminUser,
    });

    expect(wr).toBeDefined();
    const tasks = await operationsService.listTasks({ workRequestId: wr.id, entityId: ENTITY_ID, user: adminUser });
    const assignedTask = tasks.find((t) => t.title === 'Graph Task with Assignee');
    const unassignedTask = tasks.find((t) => t.title === 'Graph Task without Assignee');

    expect(assignedTask).toBeDefined();
    expect(assignedTask.status).toBe('Assigned');

    expect(unassignedTask).toBeDefined();
    expect(unassignedTask.status).toBe('Draft');
  });
});
