/**
 * Admin pending-approvals and audit-log integration tests.
 */

jest.mock('../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('./fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('./helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('./fixtures/supabaseMock');

const SEEDED_WR_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_1_ID = 'c1111111-1111-1111-1111-111111111111';
const STAFF_ID = '55555555-1111-1111-1111-111111111111';
const MANAGER_ID = '66666666-1111-1111-1111-111111111111';
const ACCOUNTING_ID = '77777777-1111-1111-1111-111111111111';
const OTHER_USER_ID = '88888888-1111-1111-1111-111111111111';

const seedPendingChanges = () => {
  mockTables.clients.set(CLIENT_1_ID, {
    id: CLIENT_1_ID,
    entity_id: 'ent-ata',
    name: 'Existing Client',
    tin: '000-000-000-00001',
  });

  mockTables.work_requests.set(SEEDED_WR_ID, {
    id: SEEDED_WR_ID,
    entity_id: 'ent-ata',
    client_id: CLIENT_1_ID,
    title: 'Seeded Project WR',
    assigned_to: MANAGER_ID,
    co_assignees: [ACCOUNTING_ID, STAFF_ID],
    creation_approval_status: 'approved',
  });

  mockTables.pending_changes.set('pc-1', {
    id: 'pc-1',
    entity_id: 'ent-ata',
    table_name: 'clients',
    parent_record_id: CLIENT_1_ID,
    proposed_data: { name: 'New Client' },
    submitted_by: STAFF_ID,
    status: 'pending',
    created_at: '2026-07-19T10:00:00.000Z',
  });

  mockTables.pending_changes.set('pc-2', {
    id: 'pc-2',
    entity_id: 'ent-ata',
    table_name: 'clients',
    parent_record_id: CLIENT_1_ID,
    proposed_data: { name: 'Updated Client' },
    submitted_by: STAFF_ID,
    status: 'rejected',
    created_at: '2026-07-19T09:00:00.000Z',
  });

  mockTables.pending_changes.set('pc-3', {
    id: 'pc-3',
    entity_id: 'ent-ata',
    table_name: 'work_requests',
    parent_record_id: SEEDED_WR_ID,
    proposed_data: { title: 'New WR' },
    submitted_by: OTHER_USER_ID,
    status: 'pending',
    created_at: '2026-07-19T08:00:00.000Z',
  });
};

const seedAuditLogs = (count = 25) => {
  for (let i = 0; i < count; i += 1) {
    const id = `audit-${String(i).padStart(3, '0')}`;
    mockTables.audit_logs.set(id, {
      id,
      action: i % 2 === 0 ? 'user.updated' : 'user.created',
      table_name: 'users',
      record_id: `record-${i}`,
      entity: 'ATA',
      user_id: 'user-admin',
      details: { index: i },
      created_at: `2026-07-19T${String(23 - (i % 24)).padStart(2, '0')}:00:00.000Z`,
    });
  }
};

describe('/v1/admin pending approvals and audit', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedPendingChanges();
  });

  it('creates a pending change for any authenticated user', async () => {
    const token = registerUser({
      id: STAFF_ID,
      email: 'staff@ata-lta.ph',
      name: 'Staff User',
      role: 'Documentation',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/admin/pending-approvals')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        tableName: 'clients',
        parentRecordId: null,
        proposedData: { name: 'Submitted Client' },
      })
      .expect(201);

    expect(res.body.data.tableName).toBe('clients');
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.submittedBy).toBe(STAFF_ID);
    expect(res.body.data.proposedData).toEqual({ name: 'Submitted Client' });
  });

  it('lists pending approvals with a status filter', async () => {
    const token = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals?status=pending')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((item) => item.status === 'pending')).toBe(true);
  });

  it('lists rejected changes filtered by tableName', async () => {
    const token = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals?status=rejected&tableName=clients')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('pc-2');
    expect(res.body.data[0].status).toBe('rejected');
    expect(res.body.data[0].tableName).toBe('clients');
  });

  it('filters pending approvals by parentRecordId and submittedBy', async () => {
    const token = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get(
        `/v1/admin/pending-approvals?status=rejected&parentRecordId=${CLIENT_1_ID}&submittedBy=${STAFF_ID}`
      )
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('pc-2');
  });

  it('gets a pending change by id', async () => {
    const token = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals/pc-1')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.id).toBe('pc-1');
    expect(res.body.data.tableName).toBe('clients');
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 404 for missing pending change', async () => {
    const token = registerUser({
      id: MANAGER_ID,
      email: 'manager@ata-lta.ph',
      name: 'Manager',
      role: 'Manager',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/pending-approvals/pc-missing')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);

    expect(res.body.title).toMatch(/not found/i);
  });

  it('allows table-specific approvers (Accounting) to view/list authorized tables but blocks unauthorized', async () => {
    // Dynamically seed pc-4 disbursements change so it doesn't pollute other tests
    mockTables.pending_changes.set('pc-4', {
      id: 'pc-4',
      entity_id: 'ent-ata',
      table_name: 'disbursements',
      parent_record_id: null,
      proposed_data: { amount: 1500, category: 'Travel', workRequestId: SEEDED_WR_ID },
      submitted_by: OTHER_USER_ID,
      status: 'pending',
      created_at: '2026-07-19T07:00:00.000Z',
    });

    const token = registerUser({
      id: ACCOUNTING_ID,
      email: 'accounting@ata-lta.ph',
      name: 'Accounting User',
      role: 'Accounting',
      entities: ['ATA'],
      departments: ['Accounting'],
    });

    // 1. List pending approvals: Accounting can see pc-4 (disbursements) but not pc-3 (work_requests) or pc-1 (clients, submitted by other)
    const listRes = await request(app)
      .get('/v1/admin/pending-approvals?status=pending')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    const visibleIds = listRes.body.data.map((item) => item.id);
    expect(visibleIds).toContain('pc-4');
    expect(visibleIds).not.toContain('pc-3');
    expect(visibleIds).not.toContain('pc-1');

    // 2. Get pending approval by ID: should allow viewing pc-4
    const getOk = await request(app)
      .get('/v1/admin/pending-approvals/pc-4')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(getOk.body.data.id).toBe('pc-4');

    // 3. Get pending approval by ID: should block viewing pc-3 (work_requests)
    await request(app)
      .get('/v1/admin/pending-approvals/pc-3')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);
  });

  it('lists audit logs with pagination', async () => {
    seedAuditLogs(25);

    const token = registerUser({
      id: 'user-admin',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/audit?limit=10&offset=0')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.meta).toMatchObject({
      limit: 10,
      offset: 0,
    });
    expect(typeof res.body.meta.total).toBe('number');
    expect(typeof res.body.meta.hasMore).toBe('boolean');
  });

  it('filters audit logs by action', async () => {
    seedAuditLogs(10);

    const token = registerUser({
      id: 'user-admin',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/audit?action=user.updated')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.every((row) => row.action === 'user.updated')).toBe(true);
  });

  it('rejects invalid audit query params', async () => {
    const token = registerUser({
      id: 'user-admin',
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const res = await request(app)
      .get('/v1/admin/audit?limit=200')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(400);

    expect(res.body.title).toMatch(/validation error/i);
  });

  it('filters audit logs by module, actor, date, page, and enriches actor metadata', async () => {
    const adminUser = {
      id: '11111111-2222-3333-4444-555555555555',
      email: 'UAT-audit-admin@ata-lta.ph',
      name: 'UAT Audit Admin',
      role: 'Admin',
      entities: ['ATA'],
    };
    const token = registerUser(adminUser);

    const staffUser = {
      id: '22222222-3333-4444-5555-666666666666',
      email: 'UAT-staff-audit@ata-lta.ph',
      name: 'Jane Audit Specialist',
      role: 'Operations',
      entities: ['ATA'],
    };
    registerUser(staffUser);

    // Seed audit logs across tables and users
    mockTables.audit_logs.set('audit-mod-1', {
      id: 'audit-mod-1',
      action: 'work_request.created',
      table_name: 'work_requests',
      record_id: 'wr-1',
      entity: 'ATA',
      user_id: staffUser.id,
      details: {},
      created_at: '2026-10-05T09:00:00.000Z',
    });
    mockTables.audit_logs.set('audit-mod-2', {
      id: 'audit-mod-2',
      action: 'invoice.created',
      table_name: 'invoices',
      record_id: 'inv-1',
      entity: 'ATA',
      user_id: adminUser.id,
      details: {},
      created_at: '2026-10-05T10:00:00.000Z',
    });
    mockTables.audit_logs.set('audit-mod-3', {
      id: 'audit-mod-3',
      action: 'task.updated',
      table_name: 'tasks',
      record_id: 'task-1',
      entity: 'ATA',
      user_id: staffUser.id,
      details: {},
      created_at: '2026-10-06T11:00:00.000Z',
    });

    // 1. Filter by module=operations
    const opsRes = await request(app)
      .get('/v1/admin/audit?module=operations')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsRes.body.data).toHaveLength(2);
    expect(opsRes.body.data.every((r) => ['work_requests', 'tasks'].includes(r.tableName))).toBe(true);

    // 2. Filter by actor (search by substring "Jane" or email) and verify enrichment
    const actorRes = await request(app)
      .get('/v1/admin/audit?actor=Jane')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(actorRes.body.data.length).toBeGreaterThan(0);
    expect(actorRes.body.data[0].userName).toBe('Jane Audit Specialist');
    expect(actorRes.body.data[0].userEmail).toBe('UAT-staff-audit@ata-lta.ph');
    expect(actorRes.body.data[0].actor).toMatchObject({
      id: staffUser.id,
      name: 'Jane Audit Specialist',
      email: 'UAT-staff-audit@ata-lta.ph',
      role: 'Operations',
    });

    // 3. Filter by date (UTC window 2026-10-05)
    const dateRes = await request(app)
      .get('/v1/admin/audit?date=2026-10-05')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(dateRes.body.data).toHaveLength(2);

    // 4. Page pagination
    const pageRes = await request(app)
      .get('/v1/admin/audit?page=1&limit=2')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(pageRes.body.meta.page).toBe(1);
    expect(pageRes.body.meta.limit).toBe(2);
    expect(pageRes.body.data).toHaveLength(2);

    // 5. Relaxed date string from/to
    const relaxedRes = await request(app)
      .get('/v1/admin/audit?from=2026-10-05&to=2026-10-06')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(relaxedRes.body.data.length).toBeGreaterThan(0);
  });

  it('allows access with audit:view_all permission and rejects unauthorized users with 403', async () => {
    // User with audit:view_all (e.g. Management dept)
    const managerToken = registerUser({
      id: '33333333-4444-5555-6666-777777777777',
      email: 'UAT-manager@ata-lta.ph',
      name: 'Manager User',
      role: 'Manager',
      departments: ['Management'],
      entities: ['ATA'],
    });

    const managerRes = await request(app)
      .get('/v1/admin/audit')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Active-Entity', 'ATA');
    expect(managerRes.status).toBe(200);

    // User without users:view or audit:view_all (Operations staff)
    const opsStaffToken = registerUser({
      id: '44444444-5555-6666-7777-888888888888',
      email: 'UAT-ops@ata-lta.ph',
      name: 'Ops User',
      role: 'Operations',
      departments: ['Operations'],
      entities: ['ATA'],
    });

    const opsRes = await request(app)
      .get('/v1/admin/audit')
      .set('Authorization', `Bearer ${opsStaffToken}`)
      .set('X-Active-Entity', 'ATA');
    expect(opsRes.status).toBe(403);
  });

  it('supports server-backed search and sortOrder=asc/desc across GET /v1/admin/audit and GET /v1/admin/audit/count', async () => {
    const adminUser = {
      id: 'aaaa1111-2222-3333-4444-555555555555',
      email: 'carlos.reyes@ata-lta.ph',
      name: 'Carlos Reyes',
      role: 'Admin',
      entities: ['ATA'],
    };
    const token = registerUser(adminUser);

    const billingUser = {
      id: 'bbbb2222-3333-4444-5555-666666666666',
      email: 'elena.santos@ata-lta.ph',
      name: 'Elena Santos',
      role: 'Accounting',
      entities: ['ATA'],
    };
    registerUser(billingUser);

    mockTables.audit_logs.set('audit-search-1', {
      id: 'audit-search-1',
      action: 'work_request.created',
      table_name: 'work_requests',
      record_id: 'wr-alpha-001',
      entity: 'ATA',
      user_id: adminUser.id,
      details: { title: 'Annual SEC Gis Filing', clientName: 'Vanguard Corp' },
      created_at: '2026-10-01T08:00:00.000Z',
    });

    mockTables.audit_logs.set('audit-search-2', {
      id: 'audit-search-2',
      action: 'invoice.issued',
      table_name: 'invoices',
      record_id: 'inv-beta-002',
      entity: 'ATA',
      user_id: billingUser.id,
      details: { invoiceNumber: 'INV-2026-0099', amount: 45000 },
      created_at: '2026-10-02T09:00:00.000Z',
    });

    mockTables.audit_logs.set('audit-search-3', {
      id: 'audit-search-3',
      action: 'user.disabled',
      table_name: 'users',
      record_id: 'usr-gamma-003',
      entity: 'ATA',
      user_id: adminUser.id,
      details: { reason: 'Contract ended' },
      created_at: '2026-10-03T10:00:00.000Z',
    });

    // 1. Default sortOrder is desc (newest first)
    const descRes = await request(app)
      .get('/v1/admin/audit')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(descRes.body.data.map((r) => r.id)).toEqual([
      'audit-search-3',
      'audit-search-2',
      'audit-search-1',
    ]);

    // 2. sortOrder=asc orders oldest first
    const ascRes = await request(app)
      .get('/v1/admin/audit?sortOrder=asc')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(ascRes.body.data.map((r) => r.id)).toEqual([
      'audit-search-1',
      'audit-search-2',
      'audit-search-3',
    ]);

    // 3. Search by details JSON substring ("INV-2026-0099")
    const detailsSearch = await request(app)
      .get('/v1/admin/audit?search=INV-2026-0099')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(detailsSearch.body.data).toHaveLength(1);
    expect(detailsSearch.body.data[0].id).toBe('audit-search-2');
    expect(detailsSearch.body.meta.total).toBe(1);

    const detailsCount = await request(app)
      .get('/v1/admin/audit/count?search=INV-2026-0099')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(detailsCount.body.data.total).toBe(1);

    // 4. Search by human-readable action words ("work request created")
    const actionSearch = await request(app)
      .get('/v1/admin/audit?search=work%20request%20created')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(actionSearch.body.data).toHaveLength(1);
    expect(actionSearch.body.data[0].id).toBe('audit-search-1');

    // 5. Search by record_id ("usr-gamma-003")
    const recordIdSearch = await request(app)
      .get('/v1/admin/audit?search=usr-gamma-003')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(recordIdSearch.body.data).toHaveLength(1);
    expect(recordIdSearch.body.data[0].id).toBe('audit-search-3');

    // 6. Search by actor name ("Elena Santos") across audit list and count
    const actorNameSearch = await request(app)
      .get('/v1/admin/audit?search=Elena%20Santos')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(actorNameSearch.body.data).toHaveLength(1);
    expect(actorNameSearch.body.data[0].id).toBe('audit-search-2');

    const actorCount = await request(app)
      .get('/v1/admin/audit/count?search=Carlos')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(actorCount.body.data.total).toBe(2);
  });
});
