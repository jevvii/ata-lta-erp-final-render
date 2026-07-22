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

const validInvoice = {
  invoiceNumber: 'ATA-SI-2026-001',
  clientId: CLIENT_ID,
  workRequestId: null,
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
};

describe('/v1/invoices', () => {
  beforeEach(() => {
    resetMock();
    seedDefaults();
    seedClient();
  });

  it('creates an invoice when user has billing:edit', async () => {
    const token = registerUser({
      email: 'accounting@ata-lta.ph',
      name: 'Accounting Staff',
      role: 'Accounting',
      entities: ['ATA'],
    });

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
      .send({ ...validInvoice, invoiceNumber: 'LTA-SI-2026-001', clientId: CLIENT_ID_LTA })
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

    const created = await request(app)
      .post('/v1/invoices')
      .set('Authorization', `Bearer ${admin}`)
      .set('X-Active-Entity', 'ATA')
      .send({ ...validInvoice, linkedTaskId: taskId })
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
});
