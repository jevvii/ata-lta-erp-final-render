/**
 * /v1/invoices integration tests.
 */

jest.mock('../../src/services/supabaseClient', () => {
  const { supabaseAdmin } = require('../fixtures/supabaseMock');
  return { supabaseAdmin };
});

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID_LTA = '22222222-2222-2222-2222-222222222222';
const WORK_REQUEST_ID = '33333333-3333-3333-3333-333333333333';
const TASK_ID = '44444444-4444-4444-4444-444444444444';
const WORK_REQUEST_ID_LTA = '33333333-3333-3333-3333-333333333334';
const TASK_ID_LTA = '44444444-4444-4444-4444-444444444445';

const validInvoice = {
  invoiceNumber: 'ATA-SI-2026-001',
  clientId: CLIENT_ID,
  workRequestId: WORK_REQUEST_ID,
  taskId: TASK_ID,
  issueDate: '2026-07-01',
  dueDate: '2026-07-31',
  status: 'Draft',
  lineItems: [{ description: 'Professional services', amount: 10000, type: 'Professional Fee' }],
  notes: 'Test invoice',
  terms: 'Due within 30 days',
};

const seedClient = () => {
  mockTables.clients.set(CLIENT_ID, {
    id: CLIENT_ID,
    entity_id: 'ent-ata',
    name: 'Acme Corp',
    tin: '123-456-789-00001',
    status: 'Active',
    created_by: 'user-1',
    updated_by: 'user-1',
  });
  mockTables.clients.set(CLIENT_ID_LTA, {
    id: CLIENT_ID_LTA,
    entity_id: 'ent-lta',
    name: 'Beta Corp',
    tin: '123-456-789-00002',
    status: 'Active',
    created_by: 'user-1',
    updated_by: 'user-1',
  });
  mockTables.work_requests.set(WORK_REQUEST_ID, {
    id: WORK_REQUEST_ID,
    entity_id: 'ent-ata',
    client_id: CLIENT_ID,
    title: 'Acme Audit',
    status: 'In Progress',
  });
  mockTables.tasks.set(TASK_ID, {
    id: TASK_ID,
    work_request_id: WORK_REQUEST_ID,
    title: 'Acme Audit Task',
    status: 'In Progress',
  });
  mockTables.work_requests.set(WORK_REQUEST_ID_LTA, {
    id: WORK_REQUEST_ID_LTA,
    entity_id: 'ent-lta',
    client_id: CLIENT_ID_LTA,
    title: 'Beta Audit',
    status: 'In Progress',
  });
  mockTables.tasks.set(TASK_ID_LTA, {
    id: TASK_ID_LTA,
    work_request_id: WORK_REQUEST_ID_LTA,
    title: 'Beta Audit Task',
    status: 'In Progress',
  });
};

describe('/v1/invoices', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedClient();
  });

  it('creates an invoice when user has billing:edit', async () => {
    const accUserId = 'acc-billing-user-1';
    const token = registerUser({
      id: accUserId,
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA'],
    });
    mockTables.tasks.get(TASK_ID).assignee_id = accUserId;

    const res = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    expect(res.body.data.invoice_number).toBe('ATA-SI-2026-001');
    expect(res.body.data.total).toBe(10000);
    expect(res.body.data.balance).toBe(10000);
  });

  it('lists invoices scoped to the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'LTA')
      .send({ ...validInvoice, invoiceNumber: 'LTA-SI-2026-001', clientId: CLIENT_ID_LTA, workRequestId: WORK_REQUEST_ID_LTA, taskId: TASK_ID_LTA })
      .expect(201);

    const res = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entity_id).toBe('ent-ata');
  });

  it('forbids invoice creation without billing:edit', async () => {
    const token = registerUser({
      email: 'ops@ata-lta.ph',
      name: 'Operations Staff',
      role: 'Operations',
      entities: ['ATA'],
    });

    const res = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(403);

    expect(res.body.title).toMatch(/forbidden/i);
  });

  it('gets a single invoice with line items and payments', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    const res = await request(app)
      .get(`/v1/invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.invoice_number).toBe('ATA-SI-2026-001');
    expect(res.body.data.line_items).toHaveLength(1);
    expect(res.body.data.payments).toHaveLength(0);
  });

  it('records a payment and updates invoice balance', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    mockTables.invoices.get(created.body.data.id).status = 'Sent';

    const res = await request(app)
      .post(`/v1/invoices/${created.body.data.id}/payments`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ amount: 5000, method: 'Bank Transfer', reference: 'REF-1', date: '2026-07-15' })
      .expect(201);

    expect(res.body.data.amount).toBe(5000);

    const invoice = await request(app)
      .get(`/v1/invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(invoice.body.data.amount_paid).toBe(5000);
    expect(invoice.body.data.balance).toBe(5000);
    expect(invoice.body.data.status).toBe('Partially Paid');
  });

  it('records a payment on an Approved invoice and updates invoice balance', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    mockTables.invoices.get(created.body.data.id).status = 'Approved';

    const res = await request(app)
      .post(`/v1/invoices/${created.body.data.id}/payments`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ amount: 5000, method: 'Bank Transfer', reference: 'REF-1', date: '2026-07-15' })
      .expect(201);

    expect(res.body.data.amount).toBe(5000);

    const invoice = await request(app)
      .get(`/v1/invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(invoice.body.data.amount_paid).toBe(5000);
    expect(invoice.body.data.balance).toBe(5000);
    expect(invoice.body.data.status).toBe('Partially Paid');
  });

  it('rejects recording payment on a Draft invoice', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validInvoice, invoiceNumber: 'ATA-SI-DRAFT-PAY' })
      .expect(201);

    await request(app)
      .post(`/v1/invoices/${created.body.data.id}/payments`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ amount: 5000, method: 'Bank Transfer', reference: 'REF-1', date: '2026-07-15' })
      .expect(400);
  });

  it('rejects direct transition from Draft to Paid via API without recorded payments', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validInvoice, invoiceNumber: 'ATA-SI-DRAFT-PAID' })
      .expect(201);

    await request(app)
      .put(`/v1/invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'Paid' })
      .expect(400);
  });

  it('soft deletes an invoice', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    await request(app)
      .delete(`/v1/invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(204);

    await request(app)
      .get(`/v1/invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(404);
  });

  it('creates and lists billing templates', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/invoices/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        name: 'Monthly Retainer',
        clientId: CLIENT_ID,
        schedule: 'Monthly',
        pfAmount: 5000,
        lineItems: [{ description: 'Retainer fee', amount: 5000, type: 'Professional Fee' }],
      })
      .expect(201);

    const res = await request(app)
      .get('/v1/invoices/templates')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Monthly Retainer');
  });

  it('returns an aging report with outstanding balances', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validInvoice, dueDate: '2020-01-01' })
      .expect(201);

    const res = await request(app)
      .get('/v1/invoices/aging')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(res.body.data.summary.grandTotal).toBe(10000);
    expect(Object.keys(res.body.data.details)).toEqual(expect.arrayContaining(['90+']));
  });

  it('returns 404 for invoice outside active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    await request(app)
      .get(`/v1/invoices/${created.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'LTA')
      .expect(404);
  });

  it('returns tab-badge counts scoped to the active entity', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA', 'LTA'],
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send(validInvoice)
      .expect(201);

    const counts = await request(app)
      .get('/v1/invoices/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(counts.body.data.active).toBe(1);
    expect(counts.body.data.archived).toBe(0);
    expect(counts.body.data.rejected).toBe(0);

    const invId = created.body.data.id;
    mockTables.invoices.get(invId).status = 'Sent';
    mockTables.invoices.get(invId).amount_paid = 10000;
    mockTables.invoices.get(invId).balance = 0;

    await request(app)
      .put(`/v1/invoices/${invId}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ status: 'Paid', archived: true })
      .expect(200);

    const afterArchive = await request(app)
      .get('/v1/invoices/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(afterArchive.body.data.active).toBe(0);
    expect(afterArchive.body.data.archived).toBe(1);
  });

  it('creates an invoice linked to a task and filters by linkedTaskId', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const taskId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    mockTables.tasks.set(taskId, {
      id: taskId,
      work_request_id: WORK_REQUEST_ID,
      title: 'Audit Task',
    });

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validInvoice, taskId: undefined, linkedTaskId: taskId })
      .expect(201);

    expect(created.body.data.linked_task_id).toBe(taskId);

    const list = await request(app)
      .get(`/v1/invoices?linkedTaskId=${taskId}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].linked_task_id).toBe(taskId);
  });

  it('enforces role-based visibility restrictions on invoices', async () => {
    const admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const OPS_USER_ID = '55555555-5555-5555-5555-555555555555';
    const ops = registerUser({
      id: OPS_USER_ID,
      email: 'ops@ata-lta.ph',
      name: 'Ops',
      role: 'Operations',
      entities: ['ATA'],
    });

    mockTables.tasks.set('task-ops-list', {
      id: 'task-ops-list',
      work_request_id: WORK_REQUEST_ID,
      assignee_id: OPS_USER_ID,
      deleted_at: null,
    });

    // Create a draft invoice
    const draftRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validInvoice, invoiceNumber: 'ATA-SI-2026-DRAFT', status: 'Draft' })
      .expect(201);

    // Create a sent invoice
    await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validInvoice, invoiceNumber: 'ATA-SI-2026-SENT', status: 'Draft' })
      .expect(201);

    // Hardcode status Sent for the second invoice to simulate a released state
    const sentInvoiceId = Array.from(mockTables.invoices.values()).find(
      (i) => i.invoice_number === 'ATA-SI-2026-SENT'
    ).id;
    mockTables.invoices.get(sentInvoiceId).status = 'Sent';

    // 1. Admin lists invoices -> sees both
    const adminList = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(adminList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-DRAFT')).toBe(true);
    expect(adminList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-SENT')).toBe(true);

    // 2. Ops (project teammate on WORK_REQUEST_ID) lists invoices -> sees both Draft and Sent (F07)
    const opsList = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-DRAFT')).toBe(true);
    expect(opsList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-SENT')).toBe(true);

    // 3. Outsider user not on project team cannot see either and is denied direct fetch
    const outsider = registerUser({
      id: '00000000-0000-4000-a000-000000000444',
      email: 'outsider-billing@ata-lta.ph',
      name: 'Outsider User',
      role: 'Operations',
      entities: ['ATA'],
    });

    const outsiderList = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${outsider}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(outsiderList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-DRAFT')).toBe(false);
    expect(outsiderList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-SENT')).toBe(false);

    await request(app)
      .get(`/v1/invoices/${draftRes.body.data.id}`)
      .set('Authorization', `Bearer ${outsider}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);

    // 4. Ops (project teammate) gets counts -> count includes both project invoices (Draft & Sent) (F07, F09)
    const opsCounts = await request(app)
      .get('/v1/invoices/counts')
      .set('Authorization', `Bearer ${ops}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(opsCounts.body.data.active).toBe(2);

    // 4b. Outsider gets counts -> 0 active (F09)
    const outsiderCounts = await request(app)
      .get('/v1/invoices/counts')
      .set('Authorization', `Bearer ${outsider}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(outsiderCounts.body.data.active).toBe(0);

    // 5. Admin gets counts -> count includes both
    const adminCounts = await request(app)
      .get('/v1/invoices/counts')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(adminCounts.body.data.active).toBe(2);
  });

  it('restricts invoice viewing access to concerned work request items only', async () => {
    const _admin = registerUser({
      email: 'admin@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const staff1Id = '00000000-0000-4000-a000-000000000561';
    const staff1 = registerUser({
      id: staff1Id,
      email: 'staff1@ata-lta.ph',
      name: 'Staff One',
      role: 'Operations',
      entities: ['ATA'],
    });

    const staff2Id = '00000000-0000-4000-a000-000000000562';
    const staff2 = registerUser({
      id: staff2Id,
      email: 'staff2@ata-lta.ph',
      name: 'Staff Two',
      role: 'Operations',
      entities: ['ATA'],
    });

    const acctId = '00000000-0000-4000-a000-000000000563';
    const accounting = registerUser({
      id: acctId,
      email: 'acct@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA'],
    });

    // Seed two work requests
    const WR_1 = '11111111-2222-3333-4444-555555555551';
    const WR_2 = '11111111-2222-3333-4444-555555555552';

    mockTables.work_requests.set(WR_1, {
      id: WR_1,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'WR 1',
    });
    mockTables.work_requests.set(WR_2, {
      id: WR_2,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'WR 2',
    });

    // Seed tasks assigning Staff One to WR_1, but no one to WR_2
    const taskIdStaff1 = '22222222-3333-4444-5555-666666666661';
    mockTables.tasks.set(taskIdStaff1, {
      id: taskIdStaff1,
      work_request_id: WR_1,
      assignee_id: staff1Id,
      deleted_at: null,
    });

    // Seed invoices linked to WR_1 and WR_2
    const invoiceWr1 = '33333333-4444-5555-6666-777777777771';
    const invoiceWr2 = '33333333-4444-5555-6666-777777777772';

    mockTables.invoices.set(invoiceWr1, {
      id: invoiceWr1,
      invoice_number: 'ATA-SI-WR1',
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WR_1,
      status: 'Sent',
      archived: false,
    });

    mockTables.invoices.set(invoiceWr2, {
      id: invoiceWr2,
      invoice_number: 'ATA-SI-WR2',
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WR_2,
      status: 'Sent',
      archived: false,
    });

    // 1. Staff One lists invoices -> sees only ATA-SI-WR1
    const res1 = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${staff1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(res1.body.data.some((i) => i.id === invoiceWr1)).toBe(true);
    expect(res1.body.data.some((i) => i.id === invoiceWr2)).toBe(false);

    // 2. Staff Two lists invoices -> sees none (not concerned with either WR)
    const res2 = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${staff2}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(res2.body.data.length).toBe(0);

    // 3. Staff One tries to fetch invoiceWr2 directly -> 403 Forbidden
    await request(app)
      .get(`/v1/invoices/${invoiceWr2}`)
      .set('Authorization', `Bearer ${staff1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);

    // 4. Staff One fetches invoiceWr1 directly -> 200 OK
    await request(app)
      .get(`/v1/invoices/${invoiceWr1}`)
      .set('Authorization', `Bearer ${staff1}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    // 5. Accounting Staff without project membership cannot see unrelated invoices (Finding F03)
    const resAcctOutsider = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${accounting}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(resAcctOutsider.body.data.length).toBe(0);

    // 6. Accounting Staff assigned to WR_1 sees WR_1's invoice
    mockTables.work_requests.get(WR_1).assigned_to = acctId;
    const resAcctAssigned = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${accounting}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);
    expect(resAcctAssigned.body.data.some((i) => i.id === invoiceWr1)).toBe(true);
    expect(resAcctAssigned.body.data.some((i) => i.id === invoiceWr2)).toBe(false);
  });

  it('supports linking a transmittal to an invoice on create, update, and filtering by linkedTransmittalId', async () => {
    const admin = registerUser({
      email: 'admin-transmittal@ata-lta.ph',
      name: 'Admin',
      role: 'Admin',
      entities: ['ATA'],
    });

    const TRANSMITTAL_ID = '44444444-4444-4444-4444-444444444444';
    const TRANSMITTAL_ID_2 = '55555555-5555-5555-5555-555555555555';

    mockTables.transmittals.set(TRANSMITTAL_ID, {
      id: TRANSMITTAL_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      work_request_id: WORK_REQUEST_ID,
      tracking_number: 'ATA-TR-2026-0001',
      status: 'Sent',
    });

    // 1. Create invoice with linkedTransmittalId
    const createRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        ...validInvoice,
        invoiceNumber: 'ATA-SI-2026-TRANS-1',
        linkedTransmittalId: TRANSMITTAL_ID,
      })
      .expect(201);

    expect(createRes.body.data.linked_transmittal_id).toBe(TRANSMITTAL_ID);

    // 2. Create another invoice without transmittal link
    await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        ...validInvoice,
        invoiceNumber: 'ATA-SI-2026-NO-TRANS',
      })
      .expect(201);

    // 3. Filter invoices by linkedTransmittalId
    const filterRes = await request(app)
      .get(`/v1/invoices?linkedTransmittalId=${TRANSMITTAL_ID}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(filterRes.body.data.length).toBe(1);
    expect(filterRes.body.data[0].invoice_number).toBe('ATA-SI-2026-TRANS-1');

    // 4. Update invoice to change linkedTransmittalId
    const updateRes = await request(app)
      .put(`/v1/invoices/${createRes.body.data.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        linkedTransmittalId: TRANSMITTAL_ID_2,
      })
      .expect(200);

    expect(updateRes.body.data.linked_transmittal_id).toBe(TRANSMITTAL_ID_2);
  });

  it('Task A.4: expands invoice view scoping for Work Request managers to see linked draft invoices', async () => {
    const admin = registerUser({
      email: 'admin-wr-inv@ata-lta.ph',
      name: 'Admin WR Inv',
      role: 'Admin',
      entities: ['ATA'],
    });

    const WR_MGR_ID = '99999999-1111-2222-3333-444444444444';
    const wrManagerToken = registerUser({
      id: WR_MGR_ID,
      email: 'wr-manager@ata-lta.ph',
      name: 'WR Manager',
      role: 'Operations',
      entities: ['ATA'],
    });

    const otherOpsToken = registerUser({
      id: '88888888-1111-2222-3333-444444444444',
      email: 'other-ops@ata-lta.ph',
      name: 'Other Ops',
      role: 'Operations',
      entities: ['ATA'],
    });

    const WR_MANAGED_ID = '77777777-1111-2222-3333-444444444444';
    mockTables.work_requests.set(WR_MANAGED_ID, {
      id: WR_MANAGED_ID,
      entity_id: 'ent-ata',
      client_id: CLIENT_ID,
      title: 'Managed Work Request',
      status: 'In Progress',
      assigned_to: WR_MGR_ID,
      deleted_at: null,
    });

    const mgrTaskId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
    mockTables.tasks.set(mgrTaskId, {
      id: mgrTaskId,
      work_request_id: WR_MANAGED_ID,
      title: 'Managed Task',
      status: 'In Progress',
    });

    // Create Draft invoice linked to WR_MANAGED_ID
    const draftRes = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({
        ...validInvoice,
        invoiceNumber: 'ATA-SI-2026-MGR-DRAFT',
        workRequestId: WR_MANAGED_ID,
        taskId: mgrTaskId,
        status: 'Draft',
      })
      .expect(201);

    // 1. WR Manager lists invoices -> CAN see the draft invoice linked to their work request
    const mgrList = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${wrManagerToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(mgrList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-MGR-DRAFT')).toBe(true);

    // 2. WR Manager can fetch the draft invoice directly
    const mgrGet = await request(app)
      .get(`/v1/invoices/${draftRes.body.data.id}`)
      .set('Authorization', `Bearer ${wrManagerToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(mgrGet.body.data.id).toBe(draftRes.body.data.id);

    // 3. Other ops user cannot see this draft invoice in list
    const otherList = await request(app)
      .get('/v1/invoices')
      .set('Authorization', `Bearer ${otherOpsToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(200);

    expect(otherList.body.data.some((i) => i.invoice_number === 'ATA-SI-2026-MGR-DRAFT')).toBe(false);

    // 4. Other ops user receives 403 on direct fetch
    await request(app)
      .get(`/v1/invoices/${draftRes.body.data.id}`)
      .set('Authorization', `Bearer ${otherOpsToken}`)
      .set('X-Active-Entity', 'ATA')
      .expect(403);
  });

  describe('Parcel A: Backend Lifecycle & Governance (Tasks A.1, A.2, A.3)', () => {
    it('Task A.1: Entity resolution Step 4 resolves invoice entity in ALL entity mode', async () => {
      const billingService = require('../../src/modules/billing/service');
      const updateInvoiceSpy = jest.spyOn(billingService, 'updateInvoice');

      const admin = registerUser({
        email: 'admin-all@ata-lta.ph',
        name: 'Admin All',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      });

      // Seed an LTA invoice
      const LTA_INV_ID = '99999999-aaaa-bbbb-cccc-111111111111';
      mockTables.invoices.set(LTA_INV_ID, {
        id: LTA_INV_ID,
        entity_id: 'ent-lta',
        client_id: CLIENT_ID_LTA,
        work_request_id: WORK_REQUEST_ID_LTA,
        task_id: TASK_ID_LTA,
        linked_task_id: TASK_ID_LTA,
        invoice_number: 'LTA-SI-2026-ALL',
        status: 'Draft',
        total: 5000,
        balance: 5000,
        amount_paid: 0,
        archived: false,
      });

      // PUT /v1/invoices/:id with X-Active-Entity: ALL should resolve true entity (ent-lta)
      const res = await request(app)
        .put(`/v1/invoices/${LTA_INV_ID}`)
        .set('Authorization', `Bearer ${admin}`)
        .set('X-Active-Entity', 'ALL')
        .send({ notes: 'Updated in ALL mode' })
        .expect(200);

      expect(res.body.data.notes).toBe('Updated in ALL mode');
      expect(res.body.data.entity_id).toBe('ent-lta');

      // Assert that resolveEntity middleware Step 4 resolved and passed 'ent-lta' to updateInvoice,
      // distinguishing middleware resolution from service fallback (which would have received 'ent-ata').
      expect(updateInvoiceSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'ent-lta',
          id: LTA_INV_ID,
        })
      );

      updateInvoiceSpy.mockRestore();
    });

    it('Task A.1: getInvoiceById falls back to direct query when entityId does not match for authorized user', async () => {
      const billingService = require('../../src/modules/billing/service');
      const admin = {
        id: 'admin-1',
        role: 'Admin',
        entities: ['ATA', 'LTA'],
      };

      const WR_LTA = '77777777-8888-4999-a000-bbbbbbbbbbbb';
      mockTables.work_requests.set(WR_LTA, {
        id: WR_LTA,
        entity_id: 'ent-lta',
        client_id: CLIENT_ID_LTA,
        title: 'LTA Work Request',
      });

      const INV_ID = '88888888-aaaa-bbbb-cccc-222222222222';
      mockTables.invoices.set(INV_ID, {
        id: INV_ID,
        entity_id: 'ent-lta',
        client_id: CLIENT_ID_LTA,
        work_request_id: WR_LTA,
        invoice_number: 'LTA-SI-2026-FB',
        status: 'Draft',
        total: 3000,
        balance: 3000,
        amount_paid: 0,
        archived: false,
      });

      // Mismatched entity ('ent-ata') without fallback throws 404
      await expect(
        billingService.getInvoiceById({
          entityId: 'ent-ata',
          id: INV_ID,
          user: admin,
          allowFallback: false,
        })
      ).rejects.toThrow('Invoice 88888888-aaaa-bbbb-cccc-222222222222 not found');

      // With allowFallback: true, it falls back to direct query and succeeds
      const fallbackResult = await billingService.getInvoiceById({
        entityId: 'ent-ata',
        id: INV_ID,
        user: admin,
        allowFallback: true,
      });
      expect(fallbackResult.entity_id).toBe('ent-lta');
    });

    it('Task A.2: Non-admin attempting to approve invoice to Sent gets HTTP 403 FORBIDDEN_INVOICE_APPROVAL', async () => {
      const jenId = '00000000-0000-4000-a000-000000000781';
      const accountingToken = registerUser({
        id: jenId,
        email: 'jen.andoga@ata-lta.ph',
        name: 'Jen Andoga',
        role: 'Accounting',
        entities: ['ATA'],
      });
      mockTables.work_requests.get(WORK_REQUEST_ID).assigned_to = jenId;

      // Seed a draft invoice
      const INV_DRAFT = '12345678-0000-0000-0000-000000000001';
      mockTables.invoices.set(INV_DRAFT, {
        id: INV_DRAFT,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WORK_REQUEST_ID,
        invoice_number: 'ATA-SI-2026-GOV-1',
        status: 'Draft',
        total: 3000,
        balance: 3000,
        amount_paid: 0,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/invoices/${INV_DRAFT}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Sent' })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN_INVOICE_APPROVAL');
      expect(res.body.detail).toBe('Only System Administrators can approve or reject invoices.');
    });

    it('Task A.2: Non-admin attempting to reject invoice from Pending to Draft gets HTTP 403 FORBIDDEN_INVOICE_APPROVAL', async () => {
      const jenId = '00000000-0000-4000-a000-000000000782';
      const accountingToken = registerUser({
        id: jenId,
        email: 'jen.andoga2@ata-lta.ph',
        name: 'Jen Andoga 2',
        role: 'Accounting',
        entities: ['ATA'],
      });
      mockTables.work_requests.get(WORK_REQUEST_ID).assigned_to = jenId;

      // Seed a pending invoice
      const INV_PENDING = '12345678-0000-0000-0000-000000000002';
      mockTables.invoices.set(INV_PENDING, {
        id: INV_PENDING,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WORK_REQUEST_ID,
        task_id: TASK_ID,
        linked_task_id: TASK_ID,
        invoice_number: 'ATA-SI-2026-GOV-2',
        status: 'Pending',
        total: 4000,
        balance: 4000,
        amount_paid: 0,
        archived: false,
      });

      const res = await request(app)
        .put(`/v1/invoices/${INV_PENDING}`)
        .set('Authorization', `Bearer ${accountingToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Draft' })
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN_INVOICE_APPROVAL');
      expect(res.body.detail).toBe('Only System Administrators can approve or reject invoices.');
    });

    it('Task A.2: Admin can approve invoice to Sent and reject invoice to Draft', async () => {
      const adminToken = registerUser({
        email: 'admin-gov@ata-lta.ph',
        name: 'Admin Gov',
        role: 'Admin',
        entities: ['ATA'],
      });

      // 1. Admin approve Draft -> Sent
      const INV_ADMIN_1 = '12345678-0000-0000-0000-000000000003';
      mockTables.invoices.set(INV_ADMIN_1, {
        id: INV_ADMIN_1,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WORK_REQUEST_ID,
        task_id: TASK_ID,
        linked_task_id: TASK_ID,
        invoice_number: 'ATA-SI-2026-ADMIN-1',
        status: 'Draft',
        total: 5000,
        balance: 5000,
        amount_paid: 0,
        archived: false,
      });

      const approveRes = await request(app)
        .put(`/v1/invoices/${INV_ADMIN_1}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Sent' })
        .expect(200);

      expect(approveRes.body.data.status).toBe('Sent');

      // 2. Admin reject Pending -> Draft
      const INV_ADMIN_2 = '12345678-0000-0000-0000-000000000004';
      mockTables.invoices.set(INV_ADMIN_2, {
        id: INV_ADMIN_2,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WORK_REQUEST_ID,
        task_id: TASK_ID,
        linked_task_id: TASK_ID,
        invoice_number: 'ATA-SI-2026-ADMIN-2',
        status: 'Pending',
        total: 6000,
        balance: 6000,
        amount_paid: 0,
        archived: false,
      });

      const rejectRes = await request(app)
        .put(`/v1/invoices/${INV_ADMIN_2}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .send({ status: 'Draft' })
        .expect(200);

      expect(rejectRes.body.data.status).toBe('Draft');
    });

    it('Task A.3: Track Work Request Creator on getInvoiceById and listInvoices', async () => {
      const adminToken = registerUser({
        email: 'admin-wr@ata-lta.ph',
        name: 'Admin WR',
        role: 'Admin',
        entities: ['ATA'],
      });

      const CREATOR_ID = '00000000-0000-4000-a000-000000000883';
      mockTables.users.set(CREATOR_ID, {
        id: CREATOR_ID,
        name: 'Maria Creator',
        email: 'maria.creator@example.ph',
        role: 'Operations',
      });

      const WR_CREATOR_ID = '00000000-0000-4000-a000-000000000881';
      mockTables.work_requests.set(WR_CREATOR_ID, {
        id: WR_CREATOR_ID,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        title: 'Special Audit Project',
        work_order_number: 'WO-2026-0099',
        created_by: CREATOR_ID,
      });

      const INV_WITH_WR = '00000000-0000-4000-a000-000000000882';
      mockTables.invoices.set(INV_WITH_WR, {
        id: INV_WITH_WR,
        entity_id: 'ent-ata',
        client_id: CLIENT_ID,
        work_request_id: WR_CREATOR_ID,
        invoice_number: 'ATA-SI-2026-WR-META',
        status: 'Sent',
        total: 7500,
        balance: 7500,
        amount_paid: 0,
        archived: false,
      });

      // 1. getInvoiceById exposes work_request details
      const getRes = await request(app)
        .get(`/v1/invoices/${INV_WITH_WR}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      expect(getRes.body.data.work_request).toEqual({
        id: WR_CREATOR_ID,
        title: 'Special Audit Project',
        workOrderNumber: 'WO-2026-0099',
        creatorName: 'Maria Creator',
        creatorEmail: 'maria.creator@example.ph',
      });
      expect(getRes.body.data.work_request_title).toBe('Special Audit Project');
      expect(getRes.body.data.work_request_creator_name).toBe('Maria Creator');

      // 2. listInvoices batch resolves work request details
      const listRes = await request(app)
        .get('/v1/invoices')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('X-Active-Entity', 'ATA')
        .expect(200);

      const foundRow = listRes.body.data.find((i) => i.id === INV_WITH_WR);
      expect(foundRow).toBeDefined();
      expect(foundRow.work_request_title).toBe('Special Audit Project');
      expect(foundRow.work_request_creator_name).toBe('Maria Creator');
      expect(foundRow.work_request).toEqual({
        id: WR_CREATOR_ID,
        title: 'Special Audit Project',
        workOrderNumber: 'WO-2026-0099',
        creatorName: 'Maria Creator',
        creatorEmail: 'maria.creator@example.ph',
      });
    });
  });
});
