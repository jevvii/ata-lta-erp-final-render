/** Real SQL regression checks. Use an already migrated, disposable local database only. */
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const migration = require('../../migrations/000080_assigned_task_status_default');
const databaseUrl = process.env.ASSIGNED_STATUS_TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase('Assigned task defaults preserve serialized SQL authorization', () => {
  let db;
  let ids;
  beforeAll(async () => {
    const target = new URL(databaseUrl);
    if (
      !['localhost', '127.0.0.1'].includes(target.hostname) ||
      !/(?:_test|_test_db)$/.test(target.pathname)
    ) {
      throw new Error(
        'Only a disposable local *_test or *_test_db database may run assigned-status acceptance checks'
      );
    }
    db = new Client({ connectionString: databaseUrl });
    await db.connect();
    const statements = [];
    migration.up({ sql: (sql) => statements.push(sql) });
    for (const sql of statements) await db.query(sql);
  });
  beforeEach(async () => {
    ids = {
      entity: randomUUID(),
      admin: randomUUID(),
      manager: randomUUID(),
      employee: randomUUID(),
      client: randomUUID(),
      wr: randomUUID(),
    };
    await db.query('BEGIN');
    const existingEntity = await db.query("SELECT id FROM public.entities WHERE code='ATA'");
    if (existingEntity.rows.length) ids.entity = existingEntity.rows[0].id;
    else
      await db.query(
        "INSERT INTO public.entities(id,code,name) VALUES($1,'ATA','Synthetic Acceptance Entity')",
        [ids.entity]
      );
    for (const role of ['admin', 'manager', 'employee']) {
      const userRole = { admin: 'Admin', manager: 'Manager', employee: 'Operations' }[role];
      await db.query(
        "INSERT INTO public.users(id,auth_user_id,email,name,role,entities,is_active,user_number) VALUES($1,$1,$2,$3,$4,ARRAY['ATA'],true,$5)",
        [
          ids[role],
          `${role}-${ids[role]}@example.test`,
          role,
          userRole,
          `USER-${ids[role].slice(0, 8)}`,
        ]
      );
    }
    await db.query(
      "INSERT INTO public.clients(id,entity_id,name,tin,client_number) VALUES($1,$2,'Synthetic Client','000-000-000-000',$3)",
      [ids.client, ids.entity, `CLIENT-${ids.client}`]
    );
    await db.query(
      "INSERT INTO public.work_requests(id,entity_id,client_id,title,status,phase,creation_approval_status,assigned_to,co_assignees,work_request_number) VALUES($1,$2,$3,'Synthetic WR','Pre-processing','pre_processing','approved',$4,$5::jsonb,$6)",
      [ids.wr, ids.entity, ids.client, ids.manager, JSON.stringify([ids.employee]), `WR-${ids.wr}`]
    );
  });
  afterEach(async () => {
    if (db) await db.query('ROLLBACK');
  });
  afterAll(async () => {
    if (db) await db.end();
  });
  async function create(data = {}, actor = ids.admin, assignees = []) {
    const result = await db.query(
      'SELECT * FROM public.task_creation_review_create($1,$2,$3,$4::jsonb,$5::uuid[])',
      [
        ids.wr,
        ids.entity,
        actor,
        JSON.stringify({ title: 'Synthetic task', phase: 'pre_processing', ...data }),
        assignees,
      ]
    );
    return result.rows[0];
  }
  it('creates assigned tasks as Assigned and unassigned tasks as Draft', async () => {
    expect((await create({ assignee_id: ids.employee }, ids.admin, [ids.employee])).status).toBe(
      'Assigned'
    );
    expect((await create()).status).toBe('Draft');
  });
  it('keeps employee-created assigned tasks pending review', async () => {
    const task = await create({ assignee_id: ids.employee }, ids.employee, [ids.employee]);
    expect(task.status).toBe('Assigned');
    expect(task.approval_status).toBe('pending');
  });
  it.each([{ entities: [] }, { entities: ['LTA'] }])(
    'rejects employee creation when the Manager lead has no entity entitlement: %j',
    async ({ entities }) => {
      await db.query('UPDATE public.users SET entities=$1 WHERE id=$2', [entities, ids.manager]);
      await expect(create({}, ids.employee)).rejects.toMatchObject({
        code: '42501',
        message: expect.stringMatching(/TASK_REVIEW_REQUIRED.*entitled/i),
      });
    }
  );
  it('preserves the supported qaStatus alias on create', async () => {
    expect((await create({ qaStatus: 'none' })).qa_status).toBe('none');
  });
  it('promotes a Draft task on assignment with one version increment', async () => {
    const task = await create();
    const result = await db.query(
      'SELECT * FROM public.task_material_update($1,$2,$3,$4,$5,$6::jsonb,$7::uuid[])',
      [
        task.id,
        ids.wr,
        ids.entity,
        ids.admin,
        task.version,
        JSON.stringify({ assignee_id: ids.employee }),
        [ids.employee],
      ]
    );
    expect(result.rows[0].status).toBe('Assigned');
    expect(result.rows[0].version).toBe(task.version + 1);
  });
  it('preserves the explicit JSON object validation on material updates', async () => {
    const task = await create();
    await expect(
      db.query('SELECT * FROM public.task_material_update($1,$2,$3,$4,$5,$6::jsonb)', [
        task.id,
        ids.wr,
        ids.entity,
        ids.admin,
        task.version,
        '[]',
      ])
    ).rejects.toMatchObject({
      code: '22023',
      message: expect.stringMatching(/TASK_REVIEW_STATE.*jsonb object/i),
    });
  });
  it('retains non-Draft execution status and supports co-assignee-only defaults', async () => {
    expect(
      (
        await create({ status: 'In Progress', assignee_id: ids.employee }, ids.admin, [
          ids.employee,
        ])
      ).status
    ).toBe('In Progress');
    expect((await create({}, ids.admin, [ids.employee])).status).toBe('Assigned');
  });
  it('retains optimistic concurrency checks for material writes', async () => {
    const task = await create();
    await expect(
      db.query('SELECT * FROM public.task_material_update($1,$2,$3,$4,$5,$6::jsonb)', [
        task.id,
        ids.wr,
        ids.entity,
        ids.admin,
        task.version + 1,
        JSON.stringify({ title: 'Stale update' }),
      ])
    ).rejects.toMatchObject({ message: expect.stringMatching(/TASK_REVIEW_CONFLICT/) });
  });
  it.each([
    'public.task_creation_review_create(uuid,uuid,uuid,jsonb,uuid[])',
    'public.task_material_update(uuid,uuid,uuid,uuid,integer,jsonb,uuid[])',
  ])('keeps serialized write RPC restricted to the service role: %s', async (signature) => {
    const result = await db.query(
      "SELECT has_function_privilege('anon',$1,'EXECUTE') AS anon, has_function_privilege('authenticated',$1,'EXECUTE') AS authenticated, has_function_privilege('service_role',$1,'EXECUTE') AS service",
      [signature]
    );
    expect(result.rows[0]).toEqual({ anon: false, authenticated: false, service: true });
  });
  it('can restore the preceding RPCs and reapply the default without deleting tasks', async () => {
    const before = await create();
    const statements = [];
    migration.down({ sql: (sql) => statements.push(sql) });
    for (const sql of statements) await db.query(sql);
    expect((await create({ assignee_id: ids.employee }, ids.admin, [ids.employee])).status).toBe(
      'Draft'
    );
    const next = [];
    migration.up({ sql: (sql) => next.push(sql) });
    for (const sql of next) await db.query(sql);
    expect((await create({ assignee_id: ids.employee }, ids.admin, [ids.employee])).status).toBe(
      'Assigned'
    );
    expect(
      (await db.query('SELECT id FROM public.tasks WHERE id=$1', [before.id])).rows[0].id
    ).toBe(before.id);
  });
});
