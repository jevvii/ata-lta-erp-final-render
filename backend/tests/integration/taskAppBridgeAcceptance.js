/**
 * Local PostgreSQL Acceptance Bridge for Task Write RPC Integration
 *
 * Requirements:
 * - Exercises actual service RPC arguments against real local PostgreSQL schemas.
 * - Prevents fake fixture mocks from hiding p_data or RPC signature drift.
 * - Verifies employee creation (pending) -> manager lead decision (approved) -> employee material update (pending reset).
 * - Enforces transactional rollback so no mutations persist in the local database.
 * - Loopback safety guard ensures testing is strictly on 127.0.0.1 / localhost.
 * - Outside default Jest discovery pattern (*.test.js / *.spec.js); run explicitly.
 */

if (typeof jest !== 'undefined') {
  jest.mock('../../src/services/supabaseClient', () => {
    const { supabaseAdmin } = require('../fixtures/supabaseMock');
    return { supabaseAdmin, verifyToken: jest.fn() };
  });
  jest.mock('../../src/config/supabase', () => {
    const { supabaseAdmin } = require('../fixtures/supabaseMock');
    return { supabaseAdmin };
  });
}

const assert = require('node:assert/strict');
const { Client } = require('pg');

const fixture = require('../fixtures/supabaseMock');
const service = require('../../src/modules/operations/service');

const dbUrl = process.env.TASK_APP_TEST_DATABASE_URL;
if (!dbUrl) {
  throw new Error('TASK_APP_TEST_DATABASE_URL is required for the explicit local acceptance suite.');
}

function assertSafeLoopbackTarget(urlStr) {
  const parsed = new URL(urlStr);
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `Safety guard: only local loopback targets allowed, got ${parsed.hostname}`
    );
  }
  const dbName = parsed.pathname.replace(/^\//, '');
  if (['postgres', 'read_scope_test', 'task_review_test'].includes(dbName)) {
    throw new Error(
      `Safety guard triggered: database '${dbName}' is reserved and cannot be modified. Never use root postgres/read_scope_test/task_review_test state.`
    );
  }
  if (dbName !== 'task_app_integration_test') {
    throw new Error(
      `Safety guard triggered: expected dedicated DB 'task_app_integration_test', got '${dbName}'`
    );
  }
}

describe('Task Write Real PostgreSQL Acceptance Bridge Suite', () => {
  let db;
  const recordedRpcCalls = [];

  const ENTITY_ATA_ID = 'e0000000-0000-4000-8000-000000000001';
  const WR_ID = 'f0000000-0000-4000-8000-000000000001';
  const USER_EMPLOYEE_ID = 'c0000000-0000-4000-8000-000000000001';
  const USER_OTHER_EMPLOYEE_ID = 'c0000000-0000-4000-8000-000000000002';
  const USER_LEAD_ID = 'b0000000-0000-4000-8000-000000000001';
  const USER_ADMIN_ID = 'a0000000-0000-4000-8000-000000000001';

  let employeeUser;
  let managerLeadUser;
  let adminUser;

  beforeAll(async () => {
    assertSafeLoopbackTarget(dbUrl);

    db = new Client({ connectionString: dbUrl });
    await db.connect();

    // Start overarching transaction for isolation
    await db.query('BEGIN');

    fixture.resetMock();
    fixture.seedDefaults();

    // Populate mock tables with PostgreSQL baseline data
    for (const table of [
      'entities',
      'users',
      'clients',
      'work_requests',
      'tasks',
      'task_assignees',
    ]) {
      const rows = (await db.query(`SELECT * FROM public.${table}`)).rows;
      for (const row of rows) {
        fixture.mockTables[table].set(row.id, row);
      }
    }

    employeeUser = fixture.mockTables.users.get(USER_EMPLOYEE_ID);
    managerLeadUser = fixture.mockTables.users.get(USER_LEAD_ID);
    adminUser = fixture.mockTables.users.get(USER_ADMIN_ID);

    // Route write RPCs through actual PostgreSQL connection
    const originalRpc = fixture.supabaseAdmin.rpc.bind(fixture.supabaseAdmin);
    fixture.supabaseAdmin.rpc = async (name, args) => {
      const bridgeRpcs = [
        'task_creation_review_create',
        'task_material_update',
        'task_creation_review_decide',
        'task_creation_review_resubmit',
      ];

      if (!bridgeRpcs.includes(name)) {
        return originalRpc(name, args);
      }

      const keys = Object.keys(args);
      recordedRpcCalls.push({ name, keys, args });

      const savepoint = `sp_rpc_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      await db.query(`SAVEPOINT ${savepoint}`);
      try {
        const query = `SELECT * FROM public.${name}(${keys
          .map((k, i) => `${k} => $${i + 1}`)
          .join(', ')})`;
        const values = keys.map((k) => args[k]);
        const res = await db.query(query, values);
        await db.query(`RELEASE SAVEPOINT ${savepoint}`);

        for (const row of res.rows) {
          fixture.mockTables.tasks.set(row.id, row);
        }

        const assigneesRes = await db.query(
          'SELECT * FROM public.task_assignees'
        );
        fixture.mockTables.task_assignees.clear();
        for (const row of assigneesRes.rows) {
          fixture.mockTables.task_assignees.set(row.id, row);
        }

        return { data: res.rows, error: null };
      } catch (err) {
        await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
        return {
          data: null,
          error: { message: err.message, code: err.code || 'PGRPC_ERROR' },
        };
      }
    };
  });

  afterAll(async () => {
    try {
      if (db) {
        await db.query('ROLLBACK');
      }
    } finally {
      if (db) {
        await db.end();
      }
    }
  });

  it('verifies employee creation, lead decision, material reset, and admin denial against real PostgreSQL', async () => {
    // 1. Employee creates task -> routes to real task_creation_review_create RPC in Postgres
    const created = await service.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ATA_ID,
      user: employeeUser,
      data: {
        title: 'Real PG Acceptance Task',
        description: 'Initial scope created by employee',
        phase: 'pre_processing',
        status: 'Draft',
        assigneeId: USER_EMPLOYEE_ID,
        assignees: [USER_EMPLOYEE_ID],
      },
    });

    assert.equal(created.approvalStatus, 'pending');
    assert.equal(created.createdBy, USER_EMPLOYEE_ID);
    assert.equal(created.version, 1);

    const createCall = recordedRpcCalls.find(
      (c) => c.name === 'task_creation_review_create'
    );
    assert.ok(createCall, 'Expected task_creation_review_create RPC call');
    assert.deepEqual(
      createCall.keys.sort(),
      [
        'p_actor_id',
        'p_assignees',
        'p_data',
        'p_entity_id',
        'p_work_request_id',
      ].sort()
    );

    // 2. Admin decision override is strictly denied by both service and PostgreSQL (Policy R5)
    await assert.rejects(
      async () => {
        await service.decideTaskCreationApproval({
          workRequestId: WR_ID,
          taskId: created.id,
          entityId: ENTITY_ATA_ID,
          user: adminUser,
          decision: 'approve',
          expectedVersion: created.version,
        });
      },
      (err) => err.statusCode === 403 && err.code === 'TASK_REVIEW_FORBIDDEN'
    );

    // Also assert real PostgreSQL function rejects Admin with 42501 (TASK_REVIEW_FORBIDDEN)
    await db.query('SAVEPOINT sp_admin_denial');
    try {
      await assert.rejects(
        async () => {
          await db.query(
            'SELECT * FROM public.task_creation_review_decide($1, $2, $3, $4, $5, $6, $7)',
            [
              created.id,
              WR_ID,
              ENTITY_ATA_ID,
              USER_ADMIN_ID,
              created.version,
              'approve',
              null,
            ]
          );
        },
        (err) => err.code === '42501'
      );
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT sp_admin_denial');
    }

    // 3. Manager lead approves task -> routes to real task_creation_review_decide RPC in Postgres
    const decided = await service.decideTaskCreationApproval({
      workRequestId: WR_ID,
      taskId: created.id,
      entityId: ENTITY_ATA_ID,
      user: managerLeadUser,
      decision: 'approve',
      expectedVersion: created.version,
    });

    assert.equal(decided.approvalStatus, 'approved');
    assert.equal(decided.reviewedBy, USER_LEAD_ID);
    assert.equal(decided.version, 2);

    const decideCall = recordedRpcCalls.find(
      (c) => c.name === 'task_creation_review_decide'
    );
    assert.ok(decideCall, 'Expected task_creation_review_decide RPC call');
    assert.deepEqual(
      decideCall.keys.sort(),
      [
        'p_actor_id',
        'p_decision',
        'p_entity_id',
        'p_expected_version',
        'p_reason',
        'p_task_id',
        'p_work_request_id',
      ].sort()
    );

    // 4. Employee material update -> routes to real task_material_update RPC in Postgres, resets to pending
    const updated = await service.updateTask({
      workRequestId: WR_ID,
      taskId: created.id,
      entityId: ENTITY_ATA_ID,
      user: employeeUser,
      data: {
        description: 'Updated scope from authorized employee caller',
        expectedVersion: decided.version,
      },
    });

    assert.equal(updated.approvalStatus, 'pending');
    assert.equal(updated.version, 3);

    const materialCall = recordedRpcCalls.find(
      (c) => c.name === 'task_material_update'
    );
    assert.ok(materialCall, 'Expected task_material_update RPC call');
    assert.deepEqual(
      materialCall.keys.sort(),
      [
        'p_actor_id',
        'p_assignees',
        'p_data',
        'p_entity_id',
        'p_expected_version',
        'p_task_id',
        'p_work_request_id',
      ].sort()
    );

    // 5. Verify task review audit trail was recorded in PostgreSQL
    const eventRows = (
      await db.query(
        'SELECT event_type, decision, actor_id FROM public.task_creation_review_events WHERE task_id = $1 ORDER BY created_at ASC',
        [created.id]
      )
    ).rows;

    assert.ok(
      eventRows.length >= 2,
      `Expected >= 2 audit events, got ${eventRows.length}`
    );
    assert.equal(eventRows[0].event_type, 'decision');
    assert.equal(eventRows[0].decision, 'approved');
    assert.equal(eventRows[0].actor_id, USER_LEAD_ID);
    assert.equal(eventRows[1].event_type, 'material_update');
    assert.equal(eventRows[1].actor_id, USER_EMPLOYEE_ID);
  });

  it('preserves approved status during routine assignee status transitions without triggering material-update RPC', async () => {
    // 1. Manager lead re-approves the updated task
    const redecided = await service.decideTaskCreationApproval({
      workRequestId: WR_ID,
      taskId: (await service.getTaskById({ workRequestId: WR_ID, taskId: recordedRpcCalls[0].args.p_data.id || (await db.query('SELECT id FROM public.tasks ORDER BY created_at DESC LIMIT 1')).rows[0].id, entityId: ENTITY_ATA_ID, user: employeeUser })).id,
      entityId: ENTITY_ATA_ID,
      user: managerLeadUser,
      decision: 'approve',
      expectedVersion: 3,
    });
    assert.equal(redecided.approvalStatus, 'approved');
    assert.equal(redecided.version, 4);

    const callCountBefore = recordedRpcCalls.length;

    // 2. Assignee performs routine status transition (In Progress)
    const statusUpdated = await service.updateTask({
      workRequestId: WR_ID,
      taskId: redecided.id,
      entityId: ENTITY_ATA_ID,
      user: employeeUser,
      data: {
        status: 'In Progress',
        expectedVersion: redecided.version,
      },
    });

    // Routine execution status updates must NOT trigger task_material_update and MUST preserve approved status
    assert.equal(statusUpdated.status, 'In Progress');
    assert.equal(statusUpdated.approvalStatus, 'approved');
    assert.equal(recordedRpcCalls.length, callCountBefore); // No new RPC called!
  });

  it('verifies rejection and canonical creator resubmit flow against real PostgreSQL', async () => {
    // 1. Employee creates a second task
    const task2 = await service.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ATA_ID,
      user: employeeUser,
      data: {
        title: 'Task to be rejected and resubmitted',
        phase: 'pre_processing',
        status: 'Draft',
        assigneeId: USER_EMPLOYEE_ID,
        assignees: [USER_EMPLOYEE_ID],
      },
    });
    assert.equal(task2.approvalStatus, 'pending');

    // 2. Manager lead rejects the task with required reason
    const rejected = await service.decideTaskCreationApproval({
      workRequestId: WR_ID,
      taskId: task2.id,
      entityId: ENTITY_ATA_ID,
      user: managerLeadUser,
      decision: 'reject',
      reason: 'Scope too vague; please elaborate',
      expectedVersion: task2.version,
    });
    assert.equal(rejected.approvalStatus, 'rejected');
    assert.equal(rejected.rejectionReason, 'Scope too vague; please elaborate');

    // 3. Creator resubmits with revised data -> routes to real task_creation_review_resubmit in Postgres
    const resubmitted = await service.resubmitTaskCreation({
      workRequestId: WR_ID,
      taskId: task2.id,
      entityId: ENTITY_ATA_ID,
      user: employeeUser,
      expectedVersion: rejected.version,
      data: {
        title: 'Detailed task scope after correction',
        description: 'Comprehensive scope description',
      },
    });
    assert.equal(resubmitted.approvalStatus, 'pending');
    assert.equal(resubmitted.title, 'Detailed task scope after correction');
    assert.equal(resubmitted.rejectionReason, null);

    const resubmitCall = recordedRpcCalls.find(
      (c) => c.name === 'task_creation_review_resubmit'
    );
    assert.ok(resubmitCall, 'Expected task_creation_review_resubmit RPC call');
    assert.deepEqual(
      resubmitCall.keys.sort(),
      [
        'p_actor_id',
        'p_data',
        'p_entity_id',
        'p_expected_version',
        'p_task_id',
        'p_work_request_id',
      ].sort()
    );
  });

  it('routes service.createTask by Manager to real PostgreSQL deriving approved status directly with multiple assignees', async () => {
    const mgrTask = await service.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ATA_ID,
      user: managerLeadUser,
      data: {
        title: 'Manager Direct Approved Task',
        description: 'Lead creating task is auto-approved by PostgreSQL',
        phase: 'pre_processing',
        status: 'Draft',
        assigneeId: USER_EMPLOYEE_ID,
        assignees: [USER_EMPLOYEE_ID, USER_OTHER_EMPLOYEE_ID],
      },
    });

    assert.equal(mgrTask.approvalStatus, 'approved');
    assert.equal(mgrTask.createdBy, USER_LEAD_ID);
    assert.equal(mgrTask.reviewedBy, null);
    assert.equal(mgrTask.reviewedAt, null);
    assert.equal(mgrTask.version, 1);

    // Verify in real PostgreSQL: task was created with approved status
    const pgTask = (
      await db.query('SELECT * FROM public.tasks WHERE id = $1', [mgrTask.id])
    ).rows[0];
    assert.equal(pgTask.approval_status, 'approved');
    assert.equal(pgTask.created_by, USER_LEAD_ID);
    assert.equal(pgTask.reviewed_by, null);

    // Verify task_assignees synchronized atomically in real PostgreSQL
    const pgAssignees = (
      await db.query(
        'SELECT user_id FROM public.task_assignees WHERE task_id = $1 ORDER BY user_id ASC',
        [mgrTask.id]
      )
    ).rows.map((r) => r.user_id);
    assert.deepEqual(
      pgAssignees.sort(),
      [USER_EMPLOYEE_ID, USER_OTHER_EMPLOYEE_ID].sort()
    );
  });

  it('rejects stale expectedVersion on material update with TASK_REVIEW_CONFLICT in real PostgreSQL', async () => {
    // 1. Employee creates a task
    const task = await service.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ATA_ID,
      user: employeeUser,
      data: {
        title: 'OCC Verification Task',
        phase: 'pre_processing',
      },
    });

    // 2. Manager approves (version becomes 2)
    const approved = await service.decideTaskCreationApproval({
      workRequestId: WR_ID,
      taskId: task.id,
      entityId: ENTITY_ATA_ID,
      user: managerLeadUser,
      decision: 'approve',
      expectedVersion: task.version,
    });
    assert.equal(approved.version, 2);

    // 3. Employee attempts material update with stale expectedVersion = 1
    await db.query('SAVEPOINT sp_occ_conflict');
    try {
      await assert.rejects(
        async () => {
          await service.updateTask({
            workRequestId: WR_ID,
            taskId: approved.id,
            entityId: ENTITY_ATA_ID,
            user: employeeUser,
            data: {
              title: 'Stale Title Revision',
              expectedVersion: 1, // Stale! Current version is 2
            },
          });
        },
        (err) =>
          err.statusCode === 409 &&
          (err.code === 'TASK_REVIEW_CONFLICT' ||
            /concurrent/i.test(err.message))
      );
    } finally {
      await db.query('ROLLBACK TO SAVEPOINT sp_occ_conflict');
    }
  });

  it('strictly rejects combining status updates with material updates when material reset is triggered', async () => {
    // 1. Employee creates a task
    const task = await service.createTask({
      workRequestId: WR_ID,
      entityId: ENTITY_ATA_ID,
      user: employeeUser,
      data: {
        title: 'Mixed Update Task',
        phase: 'pre_processing',
      },
    });

    // 2. Manager approves
    const approved = await service.decideTaskCreationApproval({
      workRequestId: WR_ID,
      taskId: task.id,
      entityId: ENTITY_ATA_ID,
      user: managerLeadUser,
      decision: 'approve',
      expectedVersion: task.version,
    });

    // 3. Employee attempts mixed status + title change
    await assert.rejects(
      async () => {
        await service.updateTask({
          workRequestId: WR_ID,
          taskId: approved.id,
          entityId: ENTITY_ATA_ID,
          user: employeeUser,
          data: {
            status: 'In Progress',
            title: 'Changed Title In Same Request',
            expectedVersion: approved.version,
          },
        });
      },
      (err) =>
        err.statusCode === 400 && err.code === 'INVALID_MIXED_TASK_UPDATE'
    );
  });
});
